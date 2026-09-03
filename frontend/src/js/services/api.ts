/**
 * Arbesk API Service
 *
 * Centralized frontend API client with auth signing, generation,
 * parametric version saving, and standardized error handling.
 */

import * as wallet from "../blockchain/wallet.ts";
import { walletState } from "../state/wallet-state.ts";
import { log, warn, error } from "../utils/log.ts";
import { base64ToBytes } from "@arbesk/asset-core/utils/encoding.js";
import { identityMatrix } from "@arbesk/asset-core/utils/collections.js";
import {
  API_BASE,
  ApiError,
  parseErrorBody,
  cacheSession,
  fetchWithSession,
  fetchJsonOrThrow,
  registerSessionFactory,
} from "./backend-client.ts";

// Backward-compatible re-exports — the session cache, auth fetch plumbing,
// and plain backend endpoints live in backend-client.ts (a wallet-free leaf
// that blockchain/ and ipfs/ modules import without closing an import cycle).
export {
  ApiError,
  getCachedSession,
  clearSession,
  getOrCreateSession,
  relayWrite,
  getConfig,
  getContractAddress,
  getContractArtifact,
  getUploadCredential,
  getUploadCredentials,
  unpinAssetCids,
  resolveUserEmail,
} from "./backend-client.ts";
export type {
  CachedSession,
  UploadCredential,
  UnpinTokenContext,
} from "./backend-client.ts";

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
 * Create a new session by proving wallet ownership via SIWE (EIP-4361).
 * @remarks CDP smart accounts sign the SIWE message with the owner EOA; the
 *   backend verifies the EOA signature and binds the session to the smart
 *   account address.
 */
export async function createSession(): Promise<{ token: string; expiresAt: number }> {
  const { walletAddress, chainId: walletChainId } = walletState.get();
  const signer = wallet.getSigner();
  if (!signer || !walletAddress) {
    throw new ApiError("Not signed in", 401, "WALLET_NOT_CONNECTED");
  }

  const chainId = Number(walletChainId || 1);
  const domain = window.location.origin;

  // Build + sign a SIWE proof via the injected signer (the wallet
  // AuthMechanism's authenticate step). The backend verifies the signature and
  // keeps the smart account as the session address via the eoaAddress fallback.
  const { buildSiweProof } = await import("@arbesk/wallet/facade.js");
  let proof;
  const _tSign = performance.now();
  try {
    proof = await buildSiweProof({
      signer,
      address: walletAddress,
      chainId,
      domain,
    });
    console.log(`[LOGIN-TIMING] siweSign: ${Math.round(performance.now() - _tSign)}ms`);
  } catch (err) {
    const cause = err as any;
    // Log the reason inline: wallets bury it in nested objects that render
    // as a collapsed "Object" in the console and never reach bug reports.
    error(
      `Session sign failed (signer=${signer.getSignerAddress()}, code=${cause?.code ?? "?"}):`,
      cause?.message || cause?.error?.message || String(cause)
    );
    throw new ApiError(
      `Failed to sign session creation message: ${cause?.message || cause?.error?.message || "unknown wallet error"}`,
      401,
      "SIGN_FAILED"
    );
  }

  const body = { proof };

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

// Hand SIWE session creation to the backend-client leaf, whose
// getOrCreateSession() calls back into this without importing the wallet.
registerSessionFactory(createSession);

/**
 * GET /api/v1/indexer/:kind?address=0x...&chainId=...
 * Returns token IDs from the given indexer list ("owned" | "shared"), or null
 * on failure.
 */
async function getIndexerTokens(
  kind: "owned" | "shared",
  address: string,
  chainId: number,
  force: boolean
): Promise<string[] | null> {
  try {
    const forceParam = force ? "&force=true" : "";
    const res = await fetch(`${API_BASE}/indexer/${kind}?address=${encodeURIComponent(address)}&chainId=${chainId}${forceParam}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`indexer returned ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data[kind])) throw new Error("invalid indexer response");
    return data[kind].map(String);
  } catch (err) {
    warn(`[SESSION] ${kind} indexer query failed:`, (err as Error).message);
    return null;
  }
}

/**
 * GET /api/v1/indexer/owned?address=0x...&chainId=...
 * Returns token IDs owned by the address on the given chain, or null on failure.
 */
export async function getOwnedTokens(address: string, chainId: number, force = false): Promise<string[] | null> {
  return getIndexerTokens("owned", address, chainId, force);
}

/**
 * GET /api/v1/indexer/shared?address=0x...&chainId=...
 * Returns token IDs where the address is an editor but not the owner,
 * or null on failure.
 */
export async function getSharedTokens(address: string, chainId: number, force = false): Promise<string[] | null> {
  return getIndexerTokens("shared", address, chainId, force);
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
 * Stop tracking an in-flight generation task.
 * @remarks Provider credits already consumed are not refunded.
 */
export async function cancelGenerationTask(taskId: string): Promise<{ status: string; upstreamCancelled: boolean }> {
  return fetchJsonOrThrow(`/generations/${taskId}`, { method: "DELETE" }, "Cancel failed");
}

// ─── Provider Balance (BYOK) ───

/**
 * POST /api/v1/generations/balance
 * Fetches the Tripo3D credit balance for the user's BYOK key.
 * @remarks The key is sent per-request and never persisted server-side.
 */
export async function getProviderBalance(providerKey: string): Promise<{ balance: number; frozen: number }> {
  return fetchJsonOrThrow("/generations/balance", { body: { providerKey } }, "Balance check failed");
}

/**
 * Best-effort scale compensation for Tripo follow-ups.
 * @remarks Rig/retarget re-normalize model size, so a follow-up returns smaller
 *   than its source; compensation is cosmetic and must never fail a generation.
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
      await import("@arbesk/asset-core/formats/gltf/bounds.js");
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
/**
 * Assemble the POST /generations request body.
 */
function buildGenerationBody(args: any, chainId: number | null): Record<string, any> {
  const {
    prompt,
    nodeId,
    provider,
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
    images,
  } = args;

  return {
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
}

/**
 * Pin the image-to-3D reference image(s) to IPFS and build the reference
 * entries recorded in the manifest.
 * @remarks For multiview, the front view also fills the legacy singular
 *   reference_image for back-compat.
 */
async function uploadReferenceImages(
  args: { imageData?: string; imageMime?: string; imageName?: string; images?: any[] },
  writeToIPFS: any
): Promise<{ referenceImage: ReferenceImage | null; referenceImages: ReferenceImage[] | null }> {
  const { imageData, imageMime, imageName, images } = args;

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

  return { referenceImage, referenceImages };
}

/**
 * Build the single source node for a generation.
 */
function buildGenerationNode(args: any) {
  const {
    nodeId,
    displayName,
    assetCid,
    data,
    referenceImage,
    referenceImages,
    transformMatrix,
    scaleCompensation,
  } = args;
  return {
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
  };
}

/**
 * Build the asset manifest for this generation.
 */
async function buildGenerationManifest(args: any): Promise<any> {
  const {
    prompt,
    nodeId,
    assetId,
    prevAssetManifestCid,
    transformMatrix,
    assetCid,
    data,
    referenceImage,
    referenceImages,
    scaleCompensation,
    getFromRemoteIPFS,
  } = args;

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
    buildGenerationNode({
      nodeId,
      displayName,
      assetCid,
      data,
      referenceImage,
      referenceImages,
      transformMatrix,
      scaleCompensation,
    }),
  ];

  return manifest;
}

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

  const body = buildGenerationBody(
    {
      prompt,
      nodeId,
      provider,
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
      images,
    },
    chainId
  );

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

  // Reference image (image-to-3D) + multiview views: pin to IPFS, record in
  // the manifest (front view fills the legacy singular reference_image).
  const { referenceImage, referenceImages } = await uploadReferenceImages(
    { imageData, imageMime, imageName, images },
    writeToIPFS
  );

  // Build the manifest (same logic previously done server-side)
  const manifest = await buildGenerationManifest({
    prompt,
    nodeId,
    assetId,
    prevAssetManifestCid,
    transformMatrix,
    assetCid,
    data,
    referenceImage,
    referenceImages,
    scaleCompensation,
    getFromRemoteIPFS,
  });

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
 * Snapshots the Nostr comment thread for a published asset to a
 * content-addressed IPFS archive.
 * @remarks Runs before manifest upload so the archive CID can be embedded in
 *   the manifest.
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


