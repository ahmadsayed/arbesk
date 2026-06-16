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
  getNetworkConfig,
} from "../blockchain/network-config.js";

/** Base URL for all API calls */
const API_BASE = "/api/v1";

function announceStatus(message) {
  const el = document.getElementById("srStatus");
  if (el) {
    el.textContent = "";
    requestAnimationFrame(() => { el.textContent = message; });
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
      console.log("[SESSION] no cached session in localStorage");
      return null;
    }
    const session = JSON.parse(raw);
    if (!session.token || !session.expiresAt || !session.address) {
      console.warn("[SESSION] cached session malformed");
      return null;
    }
    // Check expiry (with 60s grace period for clock skew)
    if (session.expiresAt <= Date.now() - 60_000) {
      console.log("[SESSION] cached session expired");
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    console.log(`[SESSION] cached valid — addr=${session.address.slice(0, 8)}… expires=${new Date(session.expiresAt).toLocaleTimeString()}`);
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
 * Create a new session by signing a session-creation message.
 * This triggers ONE MetaMask pop-up to prove wallet ownership.
 *
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
export async function createSession() {
  const { walletAddress, chainId: walletChainId } = walletState.get();
  if (!web3 || !walletAddress) {
    throw new ApiError("Wallet not connected", 401, "WALLET_NOT_CONNECTED");
  }

  // Build SIWE (EIP-4361) message
  const { buildSiweMessage, generateNonce } = await import("../blockchain/siwe.js");
  const nonce = generateNonce();
  const chainId = Number(walletChainId || 1);

  const domain = window.location.origin;
  const message = buildSiweMessage(domain, walletAddress, nonce, chainId);

  let signature;
  try {
    signature = await web3.eth.personal.sign(message, walletAddress, "");
  } catch (err) {
    console.error("Session sign failed:", err);
    throw new ApiError(
      "Failed to sign session creation message",
      401,
      "SIGN_FAILED"
    );
  }

  const response = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
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
 * @returns {Promise<string>} session token
 */
export async function getOrCreateSession() {
  // Try cached session first
  const cached = getCachedSession();
  if (cached && cached.address === walletState.get().walletAddress?.toLowerCase()) {
    console.log("[SESSION] reused cached token");
    return cached.token;
  }

  console.log("[SESSION] no cached token — creating new session…");
  // Create new session (triggers ONE MetaMask pop-up)
  const session = await createSession();
  console.log("[SESSION] created — token=" + session.token.slice(0, 8) + "…");
  return session.token;
}

// ─── Config ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/config
 * @returns {Promise<Object>} { contractAddress, ipfsGatewayUrl, hardhatRpcUrl, mockGeneration }
 */
export async function getConfig() {
  try {
    const res = await fetch(`${API_BASE}/config`);
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
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
 * @param {string} contractName — e.g. "ArbeskAsset"
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

// ─── Generations ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/generations
 * @param {Object} params
 * @param {string} params.prompt
 * @param {string} params.nodeId
 * @param {string} params.txHash
 * @param {string} [params.provider]
 * @param {string} [params.assetId]
 * @param {string} [params.prevAssetManifestCid]
 * @param {number[]} [params.transformMatrix]
 * @param {number} [params.tier] — 0=Basic, 1=Standard, 2=Premium, 3=Pro
 * @returns {Promise<{assetManifestCid: string, sourceAssetCid: string}>}
 */
export async function generateAsset({
  prompt,
  nodeId,
  txHash,
  provider = "mock",
  assetId,
  prevAssetManifestCid,
  transformMatrix,
  tier,
}) {
  announceStatus("Authenticating…");
  // Session auth reuses the ONE pop-up from createSession() across all
  // generation calls in a 24-hour window.
  const sessionToken = await getOrCreateSession();
  let authHeader = `Session ${sessionToken}`;

  const rawChainId = walletState.get().chainId;
  const chainId = rawChainId ? Number(rawChainId) : null;

  const body = {
    prompt,
    nodeId,
    txHash,
    provider,
    ...(chainId && { chainId }),
    ...(assetId && { assetId }),
    ...(prevAssetManifestCid && { prevAssetManifestCid }),
    ...(transformMatrix && { transform_matrix: transformMatrix }),
    ...(tier !== undefined && tier !== null && { tier: Number(tier) }),
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

  // Auto-retry once with a fresh session if the backend lost our token
  // (common during development when the Node server restarts).
  if (response.status === 401) {
    const { code } = parseErrorBody(data);
    if (code === "INVALID_SESSION" || code === "MISSING_AUTH") {
      console.log("[SESSION] backend rejected token — creating fresh session…");
      clearSession();
      const freshToken = await createSession();
      authHeader = `Session ${freshToken.token}`;
      response = await doFetch(authHeader);
      data = await response.json().catch(() => ({}));
    }
  }

  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    announceStatus("Generation failed: " + (message || `HTTP ${response.status}`));
    throw new ApiError(
      message || `Generation failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }

  announceStatus("Asset generated successfully.");
  return data;
}

// ─── Manifests ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/manifests
 * Create or update a draft manifest.
 * @param {Object} manifest — Full manifest object
 * @returns {Promise<{cid: string, assetId: string, version: number}>}
 */
export async function saveManifest(manifest) {
  announceStatus("Uploading manifest to IPFS…");
  const response = await fetch(`${API_BASE}/manifests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(manifest),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    announceStatus("Save failed: " + (message || `HTTP ${response.status}`));
    throw new ApiError(
      message || `Save failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }

  announceStatus("Manifest saved.");
  return data;
}

/**
 * POST /api/v1/manifests/:cid/publish
 * Publish a manifest to IPFS with optional thumbnail.
 * @param {string} prevCid — Previous manifest CID (for URL)
 * @param {Object} manifest — Full manifest object
 * @returns {Promise<{cid: string}>}
 */
export async function publishManifest(prevCid, manifest) {
  announceStatus("Publishing manifest to IPFS…");
  const response = await fetch(`${API_BASE}/manifests/${prevCid}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(manifest),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    announceStatus("Publish failed: " + (message || `HTTP ${response.status}`));
    throw new ApiError(
      message || `Publish failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }

  announceStatus("Manifest published.");
  return data;
}

/**
 * GET /api/v1/manifests/:cid/history
 * Walk the manifest version chain.
 * @param {string} cid — Manifest CID to start from
 * @returns {Promise<{chain: Array}>}
 */
export async function getManifestHistory(cid) {
  const response = await fetch(
    `${API_BASE}/manifests/${encodeURIComponent(cid)}/history`
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    throw new ApiError(
      message || `History fetch failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }

  return data;
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/tokens/:tokenId/manifest
 * Resolve a token ID to its manifest.
 * @param {string|number} tokenId
 * @returns {Promise<{tokenId: string, manifestCid: string, manifest: Object}>}
 */
export async function getTokenManifest(tokenId) {
  const response = await fetch(
    `${API_BASE}/tokens/${encodeURIComponent(tokenId)}/manifest`
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    throw new ApiError(
      message || `Token resolution failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }

  return data;
}

// ─── IPFS Unpin ────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/ipfs/unpin
 * Unpin all CIDs in a manifest chain (called after token burn).
 * @param {string} cid — Manifest CID to start unpinning from
 * @param {string} [actorAddress] — Wallet address of the burner
 * @returns {Promise<{unpinned: string[], count: number, errors?: string[]}>}
 */
export async function unpinAssetCids(cid, actorAddress) {
  const response = await fetch(`${API_BASE}/ipfs/unpin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cid, ...(actorAddress && { actorAddress }) }),
  });

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



