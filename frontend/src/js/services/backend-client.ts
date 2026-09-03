/**
 * Low-level, wallet-free backend HTTP client leaf module.
 * @remarks Holds the session cache, authenticated-fetch plumbing, and plain
 *   backend endpoints. blockchain/ and ipfs/ modules must not import api.ts —
 *   it imports the wallet barrel for SIWE signing, closing an import cycle — so
 *   session creation stays in api.ts, injected via registerSessionFactory().
 */

import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { walletState } from "../state/wallet-state.ts";
import { log, warn } from "../utils/log.ts";
import { getReadClient } from "../blockchain/viem-clients.ts";
import { getContractAddress as getNetworkContractAddress } from "../blockchain/network-config.ts";
import type { UploadCredential } from "@arbesk/asset-core/storage/ipfs/upload-with-credential.js";

export type { UploadCredential };

/** Base URL for all API calls */
export const API_BASE = "/api/v1";

/**
 * Custom API error with status and backend error code.
 */
export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}

interface ParsedErrorBody {
  message: string;
  code: string | null;
  details: any;
}

/**
 * Parse a standardized error response body.
 */
export function parseErrorBody(data: any): ParsedErrorBody {
  if (data?.error && typeof data.error === "object") {
    return {
      message: data.error.message || "Unknown error",
      code: data.error.code || null,
      details: data.error.details || null,
    };
  }
  // Fallback for legacy error formats
  return { message: data?.error || "Unknown error", code: null, details: null };
}

// ─── Session Management ─────────────────────────────────────────────────────

const SESSION_STORAGE_KEY = "arbesk_session";

export interface CachedSession {
  token: string;
  expiresAt: number;
  address: string;
}

/**
 * Read the cached session token from localStorage.
 */
export function getCachedSession(): CachedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      log("[SESSION] no cached session in localStorage");
      return null;
    }
    const session = JSON.parse(raw);
    if (!session.token || !session.expiresAt || !session.address) {
      warn("[SESSION] cached session malformed");
      return null;
    }
    // Check expiry (with 60s grace period for clock skew)
    if (session.expiresAt <= Date.now() - 60_000) {
      log("[SESSION] cached session expired");
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    log(
      `[SESSION] cached valid - addr=${session.address.slice(
        0,
        8
      )}… expires=${new Date(session.expiresAt).toLocaleTimeString()}`
    );
    return session;
  } catch {
    return null;
  }
}

/**
 * Store session token in localStorage.
 */
export function cacheSession(token: string, expiresAt: number, address: string): void {
  try {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token, expiresAt, address: address.toLowerCase() })
    );
  } catch {
    // localStorage may be full or unavailable
  }
}

/**
 * Clear the cached session (e.g. on disconnect).
 */
export function clearSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

// Auto-clear session when wallet disconnects
on(EVENTS.WALLET_DISCONNECTED, () => {
  clearSession();
});

/**
 * @remarks Session creation needs SIWE signing, which lives in api.ts; it
 *   registers its factory here so this leaf never imports the wallet barrel.
 */
type SessionFactory = () => Promise<{ token: string; expiresAt: number }>;
let sessionFactory: SessionFactory | null = null;

export function registerSessionFactory(factory: SessionFactory): void {
  sessionFactory = factory;
}

/**
 * Get a valid session token, creating one if necessary.
 * @remarks Concurrent callers share one in-flight creation promise, so only
 *   one wallet pop-up is shown.
 * @returns session token
 */
let sessionCreationPromise: Promise<string> | null = null;

export async function getOrCreateSession(): Promise<string> {
  // Try cached session first
  const cached = getCachedSession();
  if (
    cached &&
    cached.address === walletState.get().walletAddress?.toLowerCase()
  ) {
    log("[SESSION] reused cached token");
    return cached.token;
  }

  // If another call is already creating a session, wait on that same promise.
  if (sessionCreationPromise) {
    log("[SESSION] waiting on in-flight session creation…");
    return sessionCreationPromise;
  }

  if (!sessionFactory) {
    throw new ApiError(
      "Session factory not registered — services/api.ts must be loaded first",
      500,
      "SESSION_FACTORY_MISSING"
    );
  }

  log("[SESSION] no cached token - creating new session…");
  // Create new session (triggers ONE MetaMask pop-up)
  sessionCreationPromise = sessionFactory()
    .then((session) => {
      log(
        "[SESSION] created - token=" + session.token.slice(0, 8) + "…"
      );
      return session.token;
    })
    .finally(() => {
      sessionCreationPromise = null;
    });

  return sessionCreationPromise;
}

// ─── Authenticated Fetch ─────────────────────────────────────────────────────

interface FetchWithSessionOptions {
  method?: string;
  /** JSON-serialized unless already a string */
  body?: Record<string, any> | string;
  /** extra request headers */
  headers?: Record<string, string>;
}

/**
 * fetch() with a session token, retrying once on 401.
 * @remarks A rejected cached token (e.g. after a server restart) is cleared
 *   and the request retried once with a fresh session.
 * @param path - path relative to API_BASE (e.g. "/generations")
 */
export async function fetchWithSession(path: string, { method = "POST", body, headers = {} }: FetchWithSessionOptions = {}): Promise<Response> {
  const doFetch = (token: string) =>
    fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Session ${token}`,
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  let token = await getOrCreateSession();
  let response = await doFetch(token);

  if (response.status === 401) {
    log(`[SESSION] ${path} rejected cached token - re-authenticating`);
    clearSession();
    token = await getOrCreateSession();
    response = await doFetch(token);
  }

  return response;
}

/**
 * fetchWithSession + standard error mapping: parse the JSON body and throw an
 * ApiError carrying the backend's message/code on non-2xx responses.
 */
export async function fetchJsonOrThrow(
  path: string,
  options: FetchWithSessionOptions,
  fallbackMessage: string
): Promise<any> {
  const response = await fetchWithSession(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    throw new ApiError(
      message || `${fallbackMessage} (HTTP ${response.status})`,
      response.status,
      code
    );
  }
  return data;
}

// ─── Config ─────────────────────────────────────────────────────────────────

let _configPromise: Promise<any> | null = null;

/**
 * GET /api/v1/config
 * @remarks Config is immutable for the page lifetime, so the result is
 *   memoized; a failed fetch clears the cache so the next call can retry.
 * @returns { contractAddress, ipfsGatewayUrl, hardhatRpcUrl, mockGeneration }
 */
export async function getConfig(): Promise<any> {
  if (_configPromise) return _configPromise;
  _configPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/config`);
      return await res.json();
    } catch {
      _configPromise = null;
      return null;
    }
  })();
  return _configPromise;
}

/**
 * GET /api/v1/config → contractAddress only
 */
export async function getContractAddress(): Promise<string | null> {
  try {
    const chainId = await getReadClient().getChainId();
    const networkAddr = getNetworkContractAddress(chainId);
    if (networkAddr) return networkAddr;
    const config = await getConfig();
    return config?.contractAddress || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/v1/contracts/:name/abi
 * @param contractName - e.g. "ArbeskAsset"
 * @returns Full Hardhat artifact
 */
export async function getContractArtifact(contractName = "ArbeskAsset"): Promise<Record<string, any> | null> {
  try {
    const res = await fetch(`${API_BASE}/contracts/${contractName}/abi`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Relay an on-chain write through the backend (server-wallet / delegated).
 * @remarks No browser transaction and no private key on the client.
 */
export async function relayWrite(
  op: "publish" | "updateUri" | "updateEditors" | "burn",
  tokenId: string | number,
  params: Record<string, unknown>,
): Promise<Record<string, any>> {
  const data = await fetchJsonOrThrow(
    "/wallet/relay",
    { method: "POST", body: { op, tokenId, params } },
    "Relay failed"
  );
  return data.receipt ?? data;
}

// ─── IPFS Upload Credential ───────────────────────────────────────────────────

/**
 * POST /api/v1/ipfs/upload-url
 * Mint a short-lived client upload credential (Pinata presigned URL or Kubo API URL).
 */
export async function getUploadCredential(): Promise<UploadCredential> {
  const res = await fetchWithSession("/ipfs/upload-url", { body: "{}" });

  if (!res.ok) {
    throw new Error(`upload-url failed: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * POST /api/v1/ipfs/upload-urls
 * Mints `count` short-lived upload credentials in one call.
 * @remarks Pinata signed URLs are single-use, so batch flows request one
 *   credential per file up front instead of a round trip per file.
 */
export async function getUploadCredentials(count: number): Promise<UploadCredential[]> {
  const res = await fetchWithSession("/ipfs/upload-urls", { body: { count } });

  if (!res.ok) {
    throw new Error(`upload-urls failed: HTTP ${res.status}`);
  }
  const { credentials } = await res.json();
  return credentials;
}

// ─── IPFS Unpin ────────────────────────────────────────────────────────────────

export interface UnpinTokenContext {
  /** Collection token ID */
  tokenId?: string | number;
  chainId?: number;
  /** Contract override */
  contractAddress?: string | null;
  /** Merkle editor proof (non-owners) */
  proof?: string[];
}

/**
 * POST /api/v1/ipfs/unpin
 * Unpins all CIDs in a manifest chain.
 * @remarks The backend verifies on-chain ownership/edit rights and that `cid`
 *   belongs to the token, so callers must pass the token context.
 * @param cid - Manifest CID to start unpinning from
 */
export async function unpinAssetCids(
  cid: string,
  { tokenId, chainId, contractAddress, proof }: UnpinTokenContext = {}
): Promise<{ unpinned: string[]; count: number; errors?: string[] }> {
  const body: { cid: string; tokenId?: string; chainId?: number; contractAddress?: string; proof?: string[] } = { cid };
  if (tokenId != null) body.tokenId = String(tokenId);
  if (typeof chainId === "number" && Number.isFinite(chainId) && chainId > 0)
    body.chainId = chainId;
  if (contractAddress) body.contractAddress = contractAddress;
  if (Array.isArray(proof) && proof.length > 0) body.proof = proof;

  return fetchJsonOrThrow("/ipfs/unpin", { body }, "Unpin failed");
}

// ─── Users (CDP email resolution) ────────────────────────────────────────────

/**
 * POST /api/v1/users/resolve-email
 * Resolve a full email to the CDP end user's smart account address.
 * @remarks Exact match only — the backend never lists or autocompletes emails.
 */
export async function resolveUserEmail(email: string): Promise<{ exists: boolean; address?: string | null }> {
  return fetchJsonOrThrow("/users/resolve-email", { body: { email } }, "Email resolution failed");
}
