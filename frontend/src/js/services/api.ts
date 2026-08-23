/**
 * Arbesk API Service
 *
 * Centralized frontend API client with auth signing, generation,
 * parametric version saving, and standardized error handling.
 */

import { on, EVENTS } from "../asset-core/events/bus.ts";
import * as wallet from "../blockchain/wallet.ts";
import { walletState } from "../state/wallet-state.ts";
import {
  getContractAddress as getNetworkContractAddress,
} from "../blockchain/network-config.ts";
import { log, warn, error } from "../utils/log.ts";
import { base64ToBytes } from "../asset-core/utils/encoding.ts";
import { identityMatrix } from "../asset-core/utils/collections.ts";

/** Base URL for all API calls */
const API_BASE = "/api/v1";

export function announceStatus(message: string): void {
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
function parseErrorBody(data: any): ParsedErrorBody {
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
function cacheSession(token: string, expiresAt: number, address: string): void {
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
 * Create a new session by proving wallet ownership via SIWE (EIP-4361).
 *
 * CDP smart accounts (ERC-4337) sign the SIWE message with the owner EOA;
 * the backend verifies the EOA signature and binds the session to the
 * smart account address.
 */
export async function createSession(): Promise<{ token: string; expiresAt: number }> {
  const { walletAddress, eoaAddress, chainId: walletChainId } = walletState.get();
  if (!wallet.web3 || !walletAddress) {
    throw new ApiError("Not signed in", 401, "WALLET_NOT_CONNECTED");
  }

  // Build SIWE (EIP-4361) message
  const { buildSiweMessage, generateNonce } = await import(
    "../blockchain/siwe.ts"
  );
  const nonce = generateNonce();
  const chainId = Number(walletChainId || 1);

  const domain = window.location.origin;
  const message = buildSiweMessage(domain, walletAddress, nonce, chainId);

  // CDP smart accounts (ERC-4337) may restrict isValidSignature to approved
  // targets. Sign the SIWE message with the owner EOA instead; the backend
  // verifies the EOA signature and keeps the smart account as the session address.
  const signerAddress = eoaAddress || walletAddress;
  let signature: string;
  const _tSign = performance.now();
  try {
    signature = await wallet.web3.eth.personal.sign(message, signerAddress, "");
    console.log(`[LOGIN-TIMING] siweSign: ${Math.round(performance.now() - _tSign)}ms`);
  } catch (err) {
    const cause = err as any;
    // Log the reason inline: wallets bury it in nested objects that render
    // as a collapsed "Object" in the console and never reach bug reports.
    error(
      `Session sign failed (signer=${signerAddress}, code=${cause?.code ?? "?"}):`,
      cause?.message || cause?.error?.message || String(cause)
    );
    throw new ApiError(
      `Failed to sign session creation message: ${cause?.message || cause?.error?.message || "unknown wallet error"}`,
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
  console.log(`[LOGIN-TIMING] sessionsPost: ${Math.round(performance.now() - _tSign)}ms (incl. sign)`);

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
 *
 * If the backend rejects the cached token (e.g. server restart wiped the
 * session store), the stale token is cleared, a fresh session is created,
 * and the request is retried exactly once.
 *
 * @param path - path relative to API_BASE (e.g. "/generations")
 */
async function fetchWithSession(path: string, { method = "POST", body, headers = {} }: FetchWithSessionOptions = {}): Promise<Response> {
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

// ─── Config ─────────────────────────────────────────────────────────────────

let _configPromise: Promise<any> | null = null;

/**
 * GET /api/v1/config
 * Config is immutable for the page lifetime, so the (successful) result is
 * memoized; a failed fetch clears the cache so the next call can retry.
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
 * Prefers network-config for the current chain, falls back to backend.
 */
export async function getContractAddress(): Promise<string | null> {
  try {
    const chainId = Number(await wallet.web3.eth.getChainId());
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
 * GET /api/v1/indexer/owned?address=0x...&chainId=...
 * Returns token IDs owned by the address on the given chain, or null on failure.
 */
export async function getOwnedTokens(address: string, chainId: number, force = false): Promise<string[] | null> {
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
    warn("[SESSION] indexer query failed, falling back to scan:", (err as Error).message);
    return null;
  }
}

/**
 * GET /api/v1/indexer/shared?address=0x...&chainId=...
 * Returns token IDs where the address is an editor but not the owner,
 * or null on failure.
 */
export async function getSharedTokens(address: string, chainId: number, force = false): Promise<string[] | null> {
  try {
    const forceParam = force ? "&force=true" : "";
    const res = await fetch(
      `${API_BASE}/indexer/shared?address=${encodeURIComponent(address)}&chainId=${chainId}${forceParam}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`indexer returned ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.shared)) throw new Error("invalid indexer response");
    return data.shared.map(String);
  } catch (err) {
    warn("[SESSION] shared indexer query failed:", (err as Error).message);
    return null;
  }
}

// ─── Generations ─────────────────────────────────────────────────────────────

const GENERATION_POLL_INTERVAL_MS = 3_000;
const GENERATION_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes

export interface GenerationProgress {
  stage: string | null;
  progress: number;
}

/**
 * Poll an async Tripo3D generation task until it succeeds, fails, is
 * cancelled via the signal, or times out.
 *
 * @param signal - aborts the wait (the upstream task may
 *   still finish; the result is discarded)
 * @param onProgress
 *   - called on each queued/running poll with the provider-reported progress
 *   (0..100) and, for chained animate tasks, the current stage label
 * @returns { assetData, format, path }
 */
async function pollGeneration(taskId: string, signal?: AbortSignal, onProgress?: (update: GenerationProgress) => void): Promise<any> {
  const start = Date.now();

  while (Date.now() - start < GENERATION_TIMEOUT_MS) {
    if (signal?.aborted) {
      throw new ApiError("Generation cancelled", 0, "GENERATION_CANCELLED");
    }
    const response = await fetchWithSession(`/generations/${taskId}`, {
      method: "GET",
    });
    const pollData = await response.json().catch(() => ({}));

    if (!response.ok) {
      const { message, code } = parseErrorBody(pollData);
      throw new ApiError(
        message || `Polling failed (HTTP ${response.status})`,
        response.status,
        code
      );
    }

    if (pollData.status === "success") {
      return pollData;
    }

    if (pollData.status === "failed") {
      const { message, code } = parseErrorBody(pollData);
      throw new ApiError(message || "Generation failed", 500, code);
    }

    // queued or running — surface progress to screen readers
    const progress =
      typeof pollData.progress === "number" ? pollData.progress : 0;
    announceStatus(
      pollData.stage
        ? `${pollData.stage}… ${progress}%`
        : `Generating 3D asset on Tripo3D… ${progress}%`
    );
    onProgress?.({ stage: pollData.stage ?? null, progress });

    await new Promise((resolve) => setTimeout(resolve, GENERATION_POLL_INTERVAL_MS));
  }

  if (signal?.aborted) {
    throw new ApiError("Generation cancelled", 0, "GENERATION_CANCELLED");
  }
  throw new ApiError("Generation timed out", 504, "GENERATION_TIMEOUT");
}

/**
 * DELETE /api/v1/generations/:taskId
 *
 * Stop tracking an in-flight generation task: the backend evicts the
 * registry entry (further polls 404) and sends a best-effort upstream
 * cancel. Provider credits already consumed are not refunded.
 */
export async function cancelGenerationTask(taskId: string): Promise<{ status: string; upstreamCancelled: boolean }> {
  const response = await fetchWithSession(`/generations/${taskId}`, {
    method: "DELETE",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    throw new ApiError(
      message || `Cancel failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }
  return data;
}

// ─── Provider Balance (BYOK) ───

/**
 * POST /api/v1/generations/balance
 *
 * Fetches the Tripo3D credit balance for the user's BYOK key. The key is
 * sent per-request and never persisted server-side.
 */
export async function getProviderBalance(providerKey: string): Promise<{ balance: number; frozen: number }> {
  const response = await fetchWithSession("/generations/balance", {
    body: { providerKey },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    throw new ApiError(
      message || `Balance check failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }
  return data;
}

/**
 * Best-effort scale compensation for Tripo follow-ups: the rig and
 * retarget endpoints re-normalize model size (observed live 2026-08-06:
 * generation 2.0 → rig 1.0 → retarget 0.5 units tall), so a follow-up
 * result comes back smaller than its source. Measure both and return the
 * uniform scale that keeps the new version at the source's visual size.
 * Never throws — compensation is cosmetic and must not fail a generation.
 * @param sourceCid - the follow-up's source asset CID
 * @param resultBytes - raw bytes of the new asset
 * @returns scale factor, or null to leave default
 */
async function followupScaleCompensation(sourceCid: string, resultBytes: Uint8Array): Promise<number | null> {
  try {
    const { getArrayBufferFromRemoteIPFS } = await import(
      "../ipfs/remote-ipfs.ts"
    );
    const { boundsFromGlbBytes, computeGltfBounds, compensationScale } =
      await import("../asset-core/gltf/bounds.ts");
    const toBounds = (bytes: Uint8Array) =>
      boundsFromGlbBytes(bytes) ??
      computeGltfBounds(JSON.parse(new TextDecoder().decode(bytes)));
    const srcBounds = toBounds(await getArrayBufferFromRemoteIPFS(sourceCid));
    const scale = compensationScale(srcBounds, toBounds(resultBytes));
    if (scale) {
      log(
        `[GEN] follow-up scale compensation ×${scale.toFixed(3)} (provider re-normalized the model)`
      );
    }
    return scale;
  } catch (e) {
    warn(
      `[GEN] scale compensation skipped: ${e instanceof Error ? e.message : e}`
    );
    return null;
  }
}

export interface GenerateImageInput {
  imageData: string;
  imageMime: string;
  imageName?: string;
  view: string;
}

export interface GenerateAssetParams {
  prompt: string;
  nodeId: string;
  /** legacy payment tx hash (unused, kept for call-site compat) */
  txHash?: string;
  provider?: string;
  assetId?: string;
  prevAssetManifestCid?: string;
  transformMatrix?: number[];
  /** 0=Basic, 1=Standard, 2=Premium, 3=Pro */
  tier?: number;
  /** BYOK provider API key, sent per-request */
  providerKey?: string;
  /** CID of a completed generation's GLB; the source for retexture/retopo/animate follow-ups */
  sourceAssetCid?: string;
  /** backend registry task id of the task that produced sourceAssetCid; drives the retarget-only shortcut for animating an already-rigged result */
  sourceTaskId?: string;
  /** texture/material-only refine of sourceAssetCid (tripo3d) */
  retexture?: boolean;
  /** rebuild sourceAssetCid with clean triangulated topology (quad output forces FBX, unusable in-app) (tripo3d) */
  retopo?: boolean;
  /** rig & animate sourceAssetCid (tripo3d) */
  animate?: boolean;
  /** retarget presets (e.g. ["preset:idle"]), max 5; required with animate unless rigOnly */
  animations?: string[];
  /** stop after the rig step (rigged model, Tripo-native skeleton, no baked animation) */
  rigOnly?: boolean;
  /** Tripo rig endpoint model override (e.g. biped fallback) */
  rigModel?: string;
  /** retarget with animate_in_place (no root displacement) */
  animateInPlace?: boolean;
  /** target faces for retopo (adaptive when omitted) */
  faceLimit?: number;
  /** "detailed" for HD textures (tripo3d) */
  textureQuality?: string;
  /** base64 image bytes for Tripo3D image-to-3D (starts a fresh model; skips refine) */
  imageData?: string;
  /** MIME type of imageData (image/jpeg, image/png, image/webp) */
  imageMime?: string;
  /** original filename of imageData; the reference image is uploaded to IPFS and recorded in the manifest */
  imageName?: string;
  /** multiview image-to-3D (2-4 views, canonical order); replaces imageData on the wire — imageName is used for the manifest only, never sent */
  images?: GenerateImageInput[];
  /** aborts polling (GENERATION_CANCELLED); the upstream task may still finish */
  signal?: AbortSignal;
  /** called with the backend task id once the provider task starts (used for cancel) */
  onTaskId?: (taskId: string) => void;
  /** provider-reported poll progress (0..100) plus stage label for chained animate tasks */
  onProgress?: (update: GenerationProgress) => void;
}

export interface GenerateAssetResult {
  assetManifestCid: string;
  sourceAssetCid: string;
  format: string;
  path: string;
  tier?: number;
  taskId?: string;
  providerTaskId?: string;
}

interface ReferenceImage {
  cid: string;
  mime?: string;
  name: string;
  view?: string;
}

/**
 * POST /api/v1/generations
 *
 * The backend validates the session, checks the rate limit, calls the
 * adapter, and returns raw asset bytes. The browser uploads the asset
 * to IPFS, constructs the manifest, and writes it to IPFS directly -
 * no server-side IPFS writes.
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
  sourceAssetCid,
  sourceTaskId,
  retexture,
  retopo,
  animate,
  rigOnly,
  rigModel,
  animateInPlace,
  animations,
  faceLimit,
  textureQuality,
  imageData,
  imageMime,
  imageName,
  images,
  signal,
  onTaskId,
  onProgress,
}: GenerateAssetParams): Promise<GenerateAssetResult> {
  announceStatus("Authenticating…");

  const rawChainId = walletState.get().chainId;
  const chainId = rawChainId ? Number(rawChainId) : null;

  const body: Record<string, any> = {
    prompt,
    nodeId,
    provider,
    ...(chainId && { chainId }),
    ...(providerKey && { providerKey }),
    ...(sourceAssetCid && {
      sourceAssetCid,
      ...(sourceTaskId && { sourceTaskId }),
      ...(retexture && { retexture: true }),
      ...(retopo && { retopo: true, ...(faceLimit && { faceLimit }) }),
      ...(animate && { animate: true, ...(rigOnly ? { rigOnly: true } : { animations, ...(animateInPlace && { animateInPlace: true }) }), ...(rigModel && { rigModel }) }),
    }),
    ...(textureQuality && { textureQuality }),
    ...(imageData && { imageData, imageMime }),
    // Multiview (2+ images): canonical-ordered views, no legacy imageData,
    // no imageName on the wire.
    ...(Array.isArray(images) &&
      images.length > 0 && {
        images: images.map(({ imageData: d, imageMime: m, view }) => ({
          imageData: d,
          imageMime: m,
          view,
        })),
      }),
  };

  announceStatus("Generating 3D asset…");
  const response = await fetchWithSession("/generations", {
    body,
    headers: chainId ? { "x-chain-id": String(chainId) } : {},
  });
  const data = await response.json().catch(() => ({}));

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

  // Async Tripo3D flow: the backend returned a task ID; poll until the
  // provider finishes, then merge the final payload into `data` so the
  // existing browser-side IPFS upload flow runs unchanged.
  if (data.taskId) {
    onTaskId?.(data.taskId);
    announceStatus("Generating 3D asset on Tripo3D…");
    const final = await pollGeneration(data.taskId, signal, onProgress);
    Object.assign(data, final);
  }

  // Browser uploads the asset bytes to IPFS, constructs the manifest,
  // and uploads the manifest - no server-side IPFS writes.
  announceStatus("Uploading asset to IPFS…");
  const { writeToIPFS, writeJSONToIPFS } = await import(
    "../ipfs/write-to-ipfs.ts"
  );
  const { getFromRemoteIPFS } = await import("../ipfs/remote-ipfs.ts");

  // Decode base64 asset data from the backend response
  const assetBytes = base64ToBytes(data.assetData);
  const assetCid = await writeToIPFS(
    assetBytes,
    data.path || `asset.${data.format}`
  );
  log(`[GEN] browser uploaded source asset → ${assetCid}`);

  // Follow-ups (retopo/rig/animate) come back re-normalized by the
  // provider — measure and compensate so versions keep a consistent size.
  const scaleCompensation = sourceAssetCid
    ? await followupScaleCompensation(sourceAssetCid, assetBytes)
    : null;

  // Reference image (image-to-3D): pin it on IPFS and record it in the
  // manifest so the provenance chain keeps what the model was made from.
  let referenceImage: ReferenceImage | null = null;
  if (imageData) {
    const imageBytes = base64ToBytes(imageData);
    const imageExt = (imageMime || "image/png").split("/")[1] || "png";
    const referenceImageCid = await writeToIPFS(
      imageBytes,
      imageName || `reference.${imageExt}`
    );
    log(`[GEN] browser uploaded reference image → ${referenceImageCid}`);
    referenceImage = {
      cid: referenceImageCid,
      mime: imageMime,
      name: imageName || `reference.${imageExt}`,
    };
  }

  // Multiview reference images: pin each view on IPFS and record them all in
  // the manifest; the front view also fills the legacy singular
  // reference_image for back-compat with existing readers.
  let referenceImages: ReferenceImage[] | null = null;
  if (Array.isArray(images) && images.length > 0) {
    referenceImages = [];
    for (const view of images) {
      const viewExt = (view.imageMime || "image/png").split("/")[1] || "png";
      const viewName = view.imageName || `reference-${view.view}.${viewExt}`;
      const viewCid = await writeToIPFS(base64ToBytes(view.imageData), viewName);
      log(`[GEN] browser uploaded reference image (${view.view}) → ${viewCid}`);
      referenceImages.push({
        cid: viewCid,
        mime: view.imageMime,
        name: viewName,
        view: view.view,
      });
    }
    referenceImage =
      referenceImages.find((entry) => entry.view === "front") ||
      referenceImages[0];
  }

  // Build the manifest (same logic previously done server-side)
  const displayName = prompt
    ? prompt.slice(0, 60) + (prompt.length > 60 ? "…" : "")
    : nodeId;

  let manifest: any = null;
  if (prevAssetManifestCid) {
    try {
      manifest = await getFromRemoteIPFS(prevAssetManifestCid);
      log(`[GEN] previous manifest loaded - v${manifest.version}`);
    } catch (e) {
      warn(
        `[GEN] could not read previous manifest ${prevAssetManifestCid}: ${(e as Error).message}`
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
        cid: assetCid,
        path: data.path || `asset.${data.format}`,
        format: data.format,
      },
      // Reference image the model was generated from (image-to-3D only).
      ...(referenceImage && { reference_image: referenceImage }),
      // Multiview: all reference views (canonical order); reference_image
      // above still carries the front view for existing readers.
      ...(referenceImages && { reference_images: referenceImages }),
      transform_matrix:
        Array.isArray(transformMatrix) && transformMatrix.length === 16
          ? transformMatrix
          : identityMatrix(),
      post_processor: scaleCompensation
        ? { color: null, scale: { x: scaleCompensation, y: scaleCompensation, z: scaleCompensation } }
        : { color: null, scale: { x: 1, y: 1, z: 1 } },
    },
  ];

  announceStatus("Uploading manifest to IPFS…");
  const assetManifestCid = await writeJSONToIPFS(manifest, null as any, {
    assetId: manifest.asset_id,
  });
  log(`[GEN] browser uploaded manifest → ${assetManifestCid}`);

  announceStatus("Asset generated successfully.");
  return {
    assetManifestCid,
    sourceAssetCid: assetCid,
    format: data.format,
    path: data.path || `asset.${data.format}`,
    ...(tier !== undefined && tier !== null && { tier: Number(tier) }),
    ...(data.taskId && { taskId: data.taskId }),
    ...(data.providerTaskId && { providerTaskId: data.providerTaskId }),
  };
}

// ─── Comments Archive ────────────────────────────────────────────────────────

/**
 * POST /api/v1/assets/snapshot-comments
 *
 * Snapshots the Nostr comment thread for a published asset to a
 * content-addressed IPFS archive. Called before manifest upload so
 * the archive CID can be embedded in the manifest.
 */
export async function snapshotCommentsArchive(publishContext: { tokenId: string | number; chainId?: number; contractAddress?: string; assetId: string }): Promise<{ cid: string; eventCount: number }> {
  announceStatus("Archiving comments…");
  const response = await fetchWithSession("/assets/snapshot-comments", {
    body: publishContext,
  });
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

// ─── Users (CDP email resolution) ────────────────────────────────────────────

/**
 * POST /api/v1/users/resolve-email
 * Resolve a full email to the CDP end user's smart account address.
 * Exact match only — the backend never lists or autocompletes emails.
 */
export async function resolveUserEmail(email: string): Promise<{ exists: boolean; address?: string | null }> {
  const response = await fetchWithSession("/users/resolve-email", {
    body: { email },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    throw new ApiError(
      message || `Email resolution failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }
  return data;
}

// ─── IPFS Upload Credential ───────────────────────────────────────────────────

export interface UploadCredential {
  backend: string;
  url?: string;
  gateway?: string;
  apiUrl?: string;
}

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
 * Mint `count` short-lived upload credentials in one call. Pinata signed URLs
 * are single-use, so batch upload flows (e.g. decomposing a glTF into many
 * buffers/images) request one credential per file up front instead of paying
 * a backend + Pinata round trip per file.
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
 * Unpin all CIDs in a manifest chain (called before token burn, or after
 * removing an asset from a collection). The backend verifies on-chain that
 * the session wallet owns (or edits) the token and that `cid` belongs to it,
 * so callers must pass the token context.
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

  const response = await fetchWithSession("/ipfs/unpin", { body });
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
