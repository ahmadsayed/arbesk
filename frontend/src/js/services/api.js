// @ts-nocheck
/**
 * Arbesk API Service
 *
 * Centralized frontend API client with auth signing, generation,
 * parametric version saving, and standardized error handling.
 */

import { on, EVENTS } from "../events/bus.js";
import { web3 } from "../blockchain/wallet.js";
import { walletState } from "../state/wallet-state.js";
import {
  getContractAddress as getNetworkContractAddress,
} from "../blockchain/network-config.js";
import { log, warn, error } from "../utils/log.js";

/** Base URL for all API calls */
const API_BASE = "/api/v1";

function announceStatus(message) {
  const el = document.getElementById("srStatus");
  if (el) {
    el.textContent = "";
    requestAnimationFrame(() => {
      el.textContent = message;
    });
  }
}

/**
 * Custom API error with status and backend error code.
 */
export class ApiError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}

/**
 * Parse a standardized error response body.
 */
function parseErrorBody(data) {
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

/**
 * Read the cached session token from localStorage.
 * @returns {{ token: string, expiresAt: number, address: string } | null}
 */
export function getCachedSession() {
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
function cacheSession(token, expiresAt, address) {
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
export function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

// Auto-clear session when wallet disconnects
on(EVENTS.WALLET_DISCONNECTED, () => {
  clearSession();
});

/**
 * Create a new session by proving wallet ownership via SIWE (EIP-4361).
 *
 * CDP smart accounts (ERC-4337) sign the SIWE message with the owner EOA;
 * the backend verifies the EOA signature and binds the session to the
 * smart account address.
 *
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
export async function createSession() {
  const { walletAddress, eoaAddress, chainId: walletChainId } = walletState.get();
  if (!web3 || !walletAddress) {
    throw new ApiError("Not signed in", 401, "WALLET_NOT_CONNECTED");
  }

  // Build SIWE (EIP-4361) message
  const { buildSiweMessage, generateNonce } = await import(
    "../blockchain/siwe.js"
  );
  const nonce = generateNonce();
  const chainId = Number(walletChainId || 1);

  const domain = window.location.origin;
  const message = buildSiweMessage(domain, walletAddress, nonce, chainId);

  // CDP smart accounts (ERC-4337) may restrict isValidSignature to approved
  // targets. Sign the SIWE message with the owner EOA instead; the backend
  // verifies the EOA signature and keeps the smart account as the session address.
  const signerAddress = eoaAddress || walletAddress;
  let signature;
  try {
    signature = await web3.eth.personal.sign(message, signerAddress, "");
  } catch (err) {
    error("Session sign failed:", err);
    throw new ApiError(
      "Failed to sign session creation message",
      401,
      "SIGN_FAILED"
    );
  }

  const body = {
    message,
    signature,
    eoaAddress: eoaAddress || undefined,
  };

  const response = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const { message: errMsg, code } = parseErrorBody(data);
    throw new ApiError(
      errMsg || `Session creation failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }

  cacheSession(data.token, data.expiresAt, walletAddress);
  return data;
}

/**
 * Get a valid session token, creating one if necessary.
 * Reuses cached token from localStorage when valid.
 *
 * Concurrent callers that all need a new session share a single in-flight
 * session-creation promise, so only ONE MetaMask pop-up is shown.
 *
 * @returns {Promise<string>} session token
 */
let sessionCreationPromise = null;

export async function getOrCreateSession() {
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

  log("[SESSION] no cached token - creating new session…");
  // Create new session (triggers ONE MetaMask pop-up)
  sessionCreationPromise = createSession()
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

// ─── Config ─────────────────────────────────────────────────────────────────

let _configPromise = null;

/**
 * GET /api/v1/config
 * Config is immutable for the page lifetime, so the (successful) result is
 * memoized; a failed fetch clears the cache so the next call can retry.
 * @returns {Promise<Object>} { contractAddress, ipfsGatewayUrl, hardhatRpcUrl, mockGeneration }
 */
export async function getConfig() {
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
 * Prefers network-config for the current chain, falls back to backend.
 * @returns {Promise<string|null>}
 */
export async function getContractAddress() {
  try {
    const chainId = Number(await web3.eth.getChainId());
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
 * @param {string} contractName - e.g. "ArbeskAsset"
 * @returns {Promise<Object|null>} Full Hardhat artifact
 */
export async function getContractArtifact(contractName = "ArbeskAsset") {
  try {
    const res = await fetch(`${API_BASE}/contracts/${contractName}/abi`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * GET /api/v1/indexer/owned?address=0x...&chainId=...
 * Returns token IDs owned by the address on the given chain, or null on failure.
 *
 * @param {string} address
 * @param {number} chainId
 * @returns {Promise<string[]|null>}
 */
export async function getOwnedTokens(address, chainId, force = false) {
  try {
    const forceParam = force ? "&force=true" : "";
    const res = await fetch(`${API_BASE}/indexer/owned?address=${encodeURIComponent(address)}&chainId=${chainId}${forceParam}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`indexer returned ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.owned)) throw new Error("invalid indexer response");
    return data.owned.map(String);
  } catch (err) {
    warn("[SESSION] indexer query failed, falling back to scan:", err.message);
    return null;
  }
}

// ─── Generations ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/generations
 *
 * The backend validates the session, checks the rate limit, calls the
 * adapter, and returns raw asset bytes. The browser uploads the asset
 * to IPFS, constructs the manifest, and writes it to IPFS directly -
 * no server-side IPFS writes.
 *
 * @param {Object} params
 * @param {string} params.prompt
 * @param {string} params.nodeId
 * @param {string} [params.provider]
 * @param {string} [params.assetId]
 * @param {string} [params.prevAssetManifestCid]
 * @param {number[]} [params.transformMatrix]
 * @param {number} [params.tier] - 0=Basic, 1=Standard, 2=Premium, 3=Pro
 * @returns {Promise<{assetManifestCid: string, sourceAssetCid: string}>}
 */
export async function generateAsset({
  prompt,
  nodeId,
  txHash: _txHash,
  provider = "mock",
  assetId,
  prevAssetManifestCid,
  transformMatrix,
  tier,
  providerKey,
}) {
  announceStatus("Authenticating…");
  const sessionToken = await getOrCreateSession();
  let authHeader = `Session ${sessionToken}`;

  const rawChainId = walletState.get().chainId;
  const chainId = rawChainId ? Number(rawChainId) : null;

  const body = {
    prompt,
    nodeId,
    provider,
    ...(chainId && { chainId }),
    ...(providerKey && { providerKey }),
  };

  async function doFetch(authorization) {
    return fetch(`${API_BASE}/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
        ...(chainId && { "x-chain-id": String(chainId) }),
      },
      body: JSON.stringify(body),
    });
  }

  announceStatus("Generating 3D asset…");
  let response = await doFetch(authHeader);
  let data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    const { code } = parseErrorBody(data);
    if (code === "INVALID_SESSION" || code === "MISSING_AUTH") {
      log("[SESSION] backend rejected token - creating fresh session…");
      clearSession();
      const freshToken = await createSession();
      authHeader = `Session ${freshToken.token}`;
      response = await doFetch(authHeader);
      data = await response.json().catch(() => ({}));
    }
  }

  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    announceStatus(
      "Generation failed: " + (message || `HTTP ${response.status}`)
    );
    throw new ApiError(
      message || `Generation failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }

  // Browser uploads the asset bytes to IPFS, constructs the manifest,
  // and uploads the manifest - no server-side IPFS writes.
  announceStatus("Uploading asset to IPFS…");
  const { writeToIPFS, writeJSONToIPFS } = await import(
    "../ipfs/write-to-ipfs.js"
  );
  const { getFromRemoteIPFS } = await import("../ipfs/remote-ipfs.js");

  // Decode base64 asset data from the backend response
  const assetBytes = Uint8Array.from(atob(data.assetData), (c) =>
    c.charCodeAt(0)
  );
  const sourceAssetCid = await writeToIPFS(
    assetBytes,
    data.path || `asset.${data.format}`
  );
  log(`[GEN] browser uploaded source asset → ${sourceAssetCid}`);

  // Build the manifest (same logic previously done server-side)
  const displayName = prompt
    ? prompt.slice(0, 60) + (prompt.length > 60 ? "…" : "")
    : nodeId;

  let manifest = null;
  if (prevAssetManifestCid) {
    try {
      manifest = await getFromRemoteIPFS(prevAssetManifestCid);
      log(`[GEN] previous manifest loaded - v${manifest.version}`);
    } catch (e) {
      warn(
        `[GEN] could not read previous manifest ${prevAssetManifestCid}: ${e.message}`
      );
    }
  }

  if (!manifest) {
    manifest = {
      asset_id: assetId || `asset_${Date.now()}`,
      version: 0,
      timestamp: Date.now(),
      prev_asset_manifest_cid: null,
      scene: { nodes: [] },
    };
  }

  manifest.version = (manifest.version || 0) + 1;
  manifest.timestamp = Date.now();
  if (prevAssetManifestCid !== undefined) {
    manifest.prev_asset_manifest_cid = prevAssetManifestCid || null;
  }
  manifest.scene ||= { nodes: [] };
  manifest.scene.nodes ||= [];

  // Replace or create the single node for this generation
  manifest.scene.nodes = [
    {
      node_id: nodeId,
      type: "source_asset",
      name: displayName,
      source: {
        cid: sourceAssetCid,
        path: data.path || `asset.${data.format}`,
        format: data.format,
      },
      transform_matrix:
        Array.isArray(transformMatrix) && transformMatrix.length === 16
          ? transformMatrix
          : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      post_processor: { color: null, scale: { x: 1, y: 1, z: 1 } },
    },
  ];

  announceStatus("Uploading manifest to IPFS…");
  const assetManifestCid = await writeJSONToIPFS(manifest, null, {
    assetId: manifest.asset_id,
  });
  log(`[GEN] browser uploaded manifest → ${assetManifestCid}`);

  announceStatus("Asset generated successfully.");
  return {
    assetManifestCid,
    sourceAssetCid,
    ...(tier !== undefined && tier !== null && { tier: Number(tier) }),
  };
}

// ─── Comments Archive ────────────────────────────────────────────────────────

/**
 * POST /api/v1/assets/snapshot-comments
 *
 * Snapshots the Nostr comment thread for a published asset to a
 * content-addressed IPFS archive. Called before manifest upload so
 * the archive CID can be embedded in the manifest.
 *
 * @param {{ tokenId: string|number, chainId?: number, contractAddress?: string, assetId: string }} publishContext
 * @returns {Promise<{cid: string, eventCount: number}>}
 */
export async function snapshotCommentsArchive(publishContext) {
  announceStatus("Archiving comments…");
  let token = await getOrCreateSession();
  let response = await fetch(`${API_BASE}/assets/snapshot-comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Session ${token}`,
    },
    body: JSON.stringify(publishContext),
  });

  // If the server lost its session store (e.g. restart), re-authenticate once.
  if (response.status === 401) {
    log("[SESSION] snapshot-comments rejected cached token - re-authenticating");
    clearSession();
    token = await getOrCreateSession();
    response = await fetch(`${API_BASE}/assets/snapshot-comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Session ${token}`,
      },
      body: JSON.stringify(publishContext),
    });
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    announceStatus("Archive failed: " + (message || `HTTP ${response.status}`));
    throw new ApiError(
      message || `Archive failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }

  announceStatus(`Comments archived (${data.eventCount} events).`);
  return data;
}

// ─── IPFS Upload Credential ───────────────────────────────────────────────────

/**
 * POST /api/v1/ipfs/upload-url
 * Mint a short-lived client upload credential (Pinata presigned URL or Kubo API URL).
 * @returns {Promise<{backend:string, url?:string, gateway?:string, apiUrl?:string}>}
 */
export async function getUploadCredential() {
  let token = await getOrCreateSession();
  let res = await fetch(`${API_BASE}/ipfs/upload-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Session ${token}`,
    },
    body: "{}",
  });

  // If the server lost its session store (e.g. restart), clear the stale
  // cached token and re-authenticate once.
  if (res.status === 401) {
    log(
      "[SESSION] upload-url rejected cached token - re-authenticating"
    );
    clearSession();
    token = await getOrCreateSession();
    res = await fetch(`${API_BASE}/ipfs/upload-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Session ${token}`,
      },
      body: "{}",
    });
  }

  if (!res.ok) {
    throw new Error(`upload-url failed: HTTP ${res.status}`);
  }
  return res.json();
}

// ─── IPFS Unpin ────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/ipfs/unpin
 * Unpin all CIDs in a manifest chain (called after token burn).
 * @param {string} cid - Manifest CID to start unpinning from
 * @param {string} [actorAddress] - Wallet address of the burner
 * @returns {Promise<{unpinned: string[], count: number, errors?: string[]}>}
 */
export async function unpinAssetCids(cid, actorAddress) {
  let token = await getOrCreateSession();
  let response = await fetch(`${API_BASE}/ipfs/unpin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Session ${token}`,
    },
    body: JSON.stringify({ cid, ...(actorAddress && { actorAddress }) }),
  });

  // If the server lost its session store (e.g. restart), re-authenticate once.
  if (response.status === 401) {
    log("[SESSION] unpin rejected cached token - re-authenticating");
    clearSession();
    token = await getOrCreateSession();
    response = await fetch(`${API_BASE}/ipfs/unpin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Session ${token}`,
      },
      body: JSON.stringify({ cid, ...(actorAddress && { actorAddress }) }),
    });
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    throw new ApiError(
      message || `Unpin failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }

  return data;
}

// ─── Ledger ──────────────────────────────────────────────────────────────────
