import express from "express";
import type { Request, Response } from "express";
import { serializeGLB } from "@arbesk/asset-core/formats/gltf/gltf-core.js";
import {
  isGzipped,
  decompress,
} from "@arbesk/asset-core/utils/compression.js";
import type { ArbeskCore } from "@arbesk/asset-core/facade.js";
import {
  createGenerationProvider,
  TripoApiError,
} from "@arbesk/ai-asset-gen/index.js";
import type { GenerationProvider } from "@arbesk/ai-asset-gen/facade.js";
import type {
  GenerationCapability,
  GenerationStatus,
  SourceRef,
  MultiviewImage,
} from "@arbesk/ai-asset-gen/types.js";
import {
  registerTask,
  getTask,
  getCompletedTask,
  markTaskComplete,
  updateTaskEntry,
  evictTask,
} from "../generation-tasks.ts";
import type { TaskEntry } from "../generation-tasks.ts";
import type { StorageAdapter } from "../storage/index.ts";
import authenticate from "../authentication.ts";
import { generationRateLimit } from "../rate-limiter.ts";
import { validateBody } from "../validation.ts";
import { generateAssetSchema, providerBalanceSchema } from "../schemas.ts";
import { verifyOnChainGeneration } from "../generation-verify.ts";
import { CHAIN_IDS } from "../../../constants/chains.js";

const Router = express.Router;

/** Capabilities the mock provider declares (text-only, synchronous samples). */
const MOCK_CAPABILITIES: GenerationCapability[] = ["text-to-3d"];

/** Capabilities the Tripo3D provider declares (full generation + follow-up pipeline). */
const TRIPO_CAPABILITIES: GenerationCapability[] = [
  "text-to-3d",
  "image-to-3d",
  "multiview-to-3d",
  "retexture",
  "retopo",
  "rig-check",
  "rig",
  "animate",
  "balance",
];

/** Tripo's file upload limit for source GLBs (file_token flow). */
const TRIPO_SOURCE_GLB_LIMIT_BYTES = 150 * 1024 * 1024;

/** glTF 2.0 GLB magic number. */
const GLB_MAGIC = 0x46546C67;

/** 400 message for sources Tripo follow-ups cannot consume (→ SOURCE_ASSET_UNSUPPORTED_FORMAT). */
const MSG_SOURCE_UNSUPPORTED =
  "Source asset is not glTF/GLB — Tripo follow-ups (retexture, retopo, auto-rig, animate) require a glTF or GLB model";

/** 400 message prefix for glTF JSON with references we cannot inline (→ SOURCE_ASSET_UNSUPPORTED_FORMAT). */
const MSG_SOURCE_UNRESOLVABLE_PREFIX = "Source glTF has external references that cannot be resolved";

/**
 * Check whether a buffer is a binary GLB (magic "glTF", 0x46546C67).
 */
function isGlb(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === GLB_MAGIC;
}

/**
 * Check whether a buffer looks like glTF JSON (starts with `{`). Any glTF
 * JSON — composite with `ipfs://` refs or self-contained with data URIs —
 * is composed to GLB before upload. Only the first byte is checked: a
 * fixed head window misses composites whose `ipfs://` refs sit deeper in
 * the document, and those then fail Tripo-side with code 1004.
 */
function looksLikeGltfJson(buf: Buffer): boolean {
  return buf.length >= 1 && buf[0] === 0x7B; // '{'
}

/**
 * Resolve a glTF JSON document into a self-contained GLB binary buffer
 * suitable for Tripo upload, via the asset-core compose pipeline (facade):
 * `compose` inlines `ipfs://<CID>` refs as base64 data URIs and strips dedup
 * metadata (reading through the backend IpfsReadPort, with the same
 * gzip/dedup-metadata handling as the browser composer); `serializeGLB` packs
 * the result. Data URIs pass through; any other external URI (relative path,
 * http(s)) cannot be inlined here and fails fast with a 400 TripoApiError
 * instead of producing a corrupt GLB.
 *
 * We only run this for the Tripo file_token path — browser rendering uses
 * the frontend compose (composer.js).
 *
 * @param compositeBuf - raw bytes of the glTF JSON
 * @returns self-contained GLB binary
 */
function validateComposedUris(composed: any): void {
  for (const buf of composed.buffers || []) {
    if (buf.uri && !buf.uri.startsWith("data:")) {
      console.log(`[GEN] source glTF has unresolvable buffer uri=${buf.uri}`);
      throw new TripoApiError(`${MSG_SOURCE_UNRESOLVABLE_PREFIX} (buffer uri: ${buf.uri})`, 0, 400);
    }
  }
  for (const img of composed.images || []) {
    if (img.uri && !img.uri.startsWith("data:")) {
      console.log(`[GEN] source glTF has unresolvable image uri=${img.uri}`);
      throw new TripoApiError(`${MSG_SOURCE_UNRESOLVABLE_PREFIX} (image uri: ${img.uri})`, 0, 400);
    }
  }
}

function packComposedBuffers(composed: any): Buffer {
  const binParts: Buffer[] = [];
  const bufOffsets: number[] = [];
  let cumulative = 0;
  for (const buf of composed.buffers || []) {
    bufOffsets.push(cumulative);
    if (buf.uri && buf.uri.startsWith("data:")) {
      const b64 = buf.uri.split(",")[1];
      const bytes = Buffer.from(b64, "base64");
      binParts.push(bytes);
      cumulative += bytes.length;
    } else {
      const len = buf.byteLength || 0;
      binParts.push(Buffer.alloc(len));
      cumulative += len;
    }
  }

  for (let i = 0; i < (composed.buffers || []).length; i++) {
    composed.buffers[i] = { byteLength: binParts[i].length };
  }

  if (composed.bufferViews) {
    for (const bv of composed.bufferViews) {
      if (bv.buffer > 0 && bv.buffer < bufOffsets.length) {
        bv.byteOffset = (bv.byteOffset || 0) + bufOffsets[bv.buffer];
        bv.buffer = 0;
      }
    }
  }

  return Buffer.concat(binParts);
}

async function resolveCompositeToGlb(
  compositeBuf: Buffer,
  core: ArbeskCore,
): Promise<Buffer> {
  let gltf: any;
  try {
    gltf = JSON.parse(compositeBuf.toString("utf-8"));
  } catch {
    console.log("[GEN] source asset starts with '{' but is not valid JSON");
    throw new TripoApiError(MSG_SOURCE_UNSUPPORTED, 0, 400);
  }

  // The facade compose returns a Blob of the composed glTF JSON (application/
  // json); parse it back for the GLB packing step below.
  const composed = JSON.parse(
    await (await core.compose(gltf)).text()
  ) as any;

  // Fail fast on references that are neither ipfs:// nor data: — a relative
  // or http(s) URI would otherwise be silently zero-filled into a corrupt GLB.
  validateComposedUris(composed);

  // Pack data-URI buffers into a single BIN chunk (in place).
  const bin = packComposedBuffers(composed);
  const glb = Buffer.from(serializeGLB(composed, bin));

  console.log(
    `[GEN] composite composed → GLB buffers=${(composed.buffers || []).length} bin=${bin.length}B total=${glb.length}B`,
  );
  return glb;
}

/**
 * Map a Tripo adapter error status to the documented API error code.
 */
function providerErrorCode(status: number): string {
  if (status === 401) return "PROVIDER_AUTH_FAILED";
  if (status === 402) return "PROVIDER_CREDITS_EXHAUSTED";
  return "PROVIDER_ERROR";
}

/**
 * Shared error-response tail: TripoApiErrors keep their HTTP status with the
 * documented provider code; anything unexpected is a 500 with `serverCode`.
 */
function sendProviderOrServerError(
  res: Response,
  err: Error,
  serverCode: string,
): Response {
  if (err instanceof TripoApiError) {
    return res.status(err.status).json({
      error: {
        code: providerErrorCode(err.status),
        message: err.message,
      },
    });
  }
  return res.status(500).json({
    error: {
      code: serverCode,
      message: err.message,
    },
  });
}

/** Source-asset 400s: message matcher → documented error code. */
const SOURCE_ERROR_RULES: { match: (message: string) => boolean; code: string }[] = [
  {
    match: (m) => m === "Source asset unavailable in IPFS",
    code: "SOURCE_ASSET_UNAVAILABLE",
  },
  {
    match: (m) => m === "Source asset exceeds the 150 MB upload limit",
    code: "SOURCE_ASSET_TOO_LARGE",
  },
  {
    match: (m) => m === MSG_SOURCE_UNSUPPORTED || m.startsWith(MSG_SOURCE_UNRESOLVABLE_PREFIX),
    code: "SOURCE_ASSET_UNSUPPORTED_FORMAT",
  },
];

/**
 * Send the documented error response for a POST /generations failure:
 * source-asset 400s keep their dedicated codes, other TripoApiErrors map by
 * HTTP status, and anything unexpected is a 500 GENERATION_FAILED.
 */
function sendGenerationError(res: Response, err: Error): Response {
  console.error("[GEN] error:", err.message);
  const rule =
    err instanceof TripoApiError && err.status === 400
      ? SOURCE_ERROR_RULES.find((r) => r.match(err.message))
      : undefined;
  if (rule) {
    return res.status(400).json({
      error: {
        code: rule.code,
        message: err.message,
      },
    });
  }
  return sendProviderOrServerError(res, err, "GENERATION_FAILED");
}

/**
 * BYOK (Bring Your Own Key) gate: real providers require a user-supplied API
 * key. The user pays the provider directly, so the on-chain quota/payment
 * gate is bypassed entirely. The key is used transiently and is never logged
 * or persisted. The mock provider needs no key.
 * @returns true when the request was rejected with 400 MISSING_PROVIDER_KEY
 */
function rejectMissingProviderKey(
  res: Response,
  effectiveProvider: string,
  providerKey: unknown,
): boolean {
  if (effectiveProvider !== "mock") {
    if (
      typeof providerKey !== "string" ||
      providerKey.trim().length === 0
    ) {
      console.log(
        "[GEN] rejected - providerKey required for real provider",
      );
      res.status(400).json({
        error: {
          code: "MISSING_PROVIDER_KEY",
          message: "providerKey is required for the selected provider",
        },
      });
      return true;
    }
    console.log(
      `[GEN] byok provider=${effectiveProvider} key=*** (len=${providerKey.trim().length}) - on-chain gate bypassed`,
    );
  }
  return false;
}

/**
 * Run a mock-provider generation and return the sample asset bytes as base64.
 * The mock provider only does text-to-3D; image-only requests fall back to a
 * placeholder prompt (image input is Tripo3D-only).
 */
async function runMockGeneration(
  res: Response,
  prompt: string | undefined,
): Promise<Response> {
  const mockPrompt = prompt || "image";
  console.log(`[GEN] using MOCK adapter for "${mockPrompt}"`);
  const mockProvider = createGenerationProvider({
    id: "mock",
    capabilities: MOCK_CAPABILITIES,
  });
  const taskId = await mockProvider.textToModel({ prompt: mockPrompt });
  const poll = await mockProvider.poll(taskId);
  const bytes = await mockProvider.download(taskId);
  const assetFormat = poll.format || "gltf";
  const assetBase64 = Buffer.from(bytes).toString("base64");
  console.log(
    `[GEN] mock returned provider=mock size=${bytes.length} bytes (${assetFormat})`,
  );
  return res.json({
    assetData: assetBase64,
    format: assetFormat,
    path: `asset.${assetFormat}`,
    provider: "mock",
  });
}

/**
 * Fetch a source GLB from IPFS and upload it to Tripo, returning the
 * file_token. Throws TripoApiError(400, SOURCE_ASSET_UNAVAILABLE-shaped)
 * when the CID cannot be read or yields an empty buffer,
 * TripoApiError(400, SOURCE_ASSET_UNSUPPORTED_FORMAT-shaped) when the
 * content is neither glTF JSON nor GLB (or has unresolvable external
 * references), and TripoApiError(400, SOURCE_ASSET_TOO_LARGE-shaped)
 * when the GLB exceeds Tripo's 150 MB file limit.
 * @returns file_token
 */
async function resolveSourceGlb(
  cid: string,
  core: ArbeskCore,
  storage: StorageAdapter,
): Promise<Buffer> {
  let glb: Buffer;
  try {
    glb = await storage.catBytes(cid);
  } catch (e) {
    const err = e as Error;
    console.log(`[GEN] source GLB fetch failed cid=${cid}: ${err.message}`);
    throw new TripoApiError("Source asset unavailable in IPFS", 0, 400);
  }
  if (!glb || glb.length === 0) {
    console.log(`[GEN] source GLB empty cid=${cid}`);
    throw new TripoApiError("Source asset unavailable in IPFS", 0, 400);
  }
  // Decomposed assets are stored gzipped — decompress before any
  // format detection (gzip magic would otherwise read as "not glTF").
  if (isGzipped(glb)) {
    console.log(`[GEN] source asset is gzipped — decompressing cid=${cid}`);
    glb = Buffer.from(decompress(glb));
  }
  // Raw size gate first: an oversized source is too large regardless of
  // format (and composing would only make it bigger).
  if (glb.length > TRIPO_SOURCE_GLB_LIMIT_BYTES) {
    console.log(`[GEN] source GLB too large cid=${cid} bytes=${glb.length}`);
    throw new TripoApiError("Source asset exceeds the 150 MB upload limit", 0, 400);
  }
  // Saved assets store glTF JSON (composite with ipfs:// buffer URIs, or
  // self-contained with data URIs) — compose it into a binary GLB before
  // uploading. Anything else (3MF, FBX, ...) is rejected up front: Tripo's
  // rig-check accepts GLB only and fails other formats with code 1004.
  if (!isGlb(glb)) {
    if (!looksLikeGltfJson(glb)) {
      console.log(`[GEN] source asset is not glTF/GLB cid=${cid}`);
      throw new TripoApiError(MSG_SOURCE_UNSUPPORTED, 0, 400);
    }
    console.log(`[GEN] source asset is glTF JSON — composing to GLB cid=${cid}`);
    glb = await resolveCompositeToGlb(glb, core);
  }
  if (glb.length > TRIPO_SOURCE_GLB_LIMIT_BYTES) {
    console.log(`[GEN] source GLB too large cid=${cid} bytes=${glb.length}`);
    throw new TripoApiError("Source asset exceeds the 150 MB upload limit", 0, 400);
  }
  return glb;
}

/** Request-body fields the Tripo3D generation flow consumes (Zod-validated). */
interface TripoGenerationInput {
  prompt?: string;
  sourceAssetCid?: string;
  sourceTaskId?: string;
  retexture?: boolean;
  retopo?: boolean;
  animate?: boolean;
  rigOnly?: boolean;
  rigModel?: string;
  animateInPlace?: boolean;
  animations?: string[];
  faceLimit?: number;
  textureQuality?: string;
  imageData?: string;
  imageMime?: string;
  images?: { imageData: string; imageMime: string; view: string }[];
}

/**
 * Registry lookup for the retarget-only shortcut: the caller references a
 * completed rig-only entry whose skeleton still lives Tripo-side (registry
 * TTL). Skipped when the caller explicitly picked a different rig model —
 * the full chain with the user's chosen model is needed then. Everything
 * else goes through the GLB — the canonical, expiry-free path.
 */
function findRigSource(
  userAddress: string,
  body: TripoGenerationInput,
): TaskEntry | undefined {
  const { animate, sourceTaskId, rigModel, rigOnly } = body;
  if (!animate || !sourceTaskId || rigModel) return undefined;
  const rigSource = getCompletedTask(sourceTaskId, userAddress);
  if (!rigSource || rigSource.kind !== "animate" || rigSource.phase !== "rig" || rigOnly) {
    return undefined;
  }
  return rigSource;
}

/** Fire the retarget task off a completed rig and register it. */
async function startRetarget(
  res: Response,
  provider: GenerationProvider,
  key: string,
  userAddress: string,
  rigSource: TaskEntry,
  body: TripoGenerationInput,
): Promise<Response> {
  const { animations, animateInPlace } = body;
  console.log(`[GEN] retarget-only: source rig=${rigSource.tripoTaskId} animations=${(animations || []).join(",")}`);
  const retargetId = await provider.animate({
    rigTaskId: rigSource.tripoTaskId,
    animations: animations || [],
    animateInPlace: Boolean(animateInPlace),
    rigModel: rigSource.rigModel,
  });
  const taskId = registerTask({ tripoTaskId: retargetId, providerKey: key, userAddress, kind: "animate", phase: "retarget", animations });
  return res.status(202).json({ taskId, provider: "tripo3d", status: "running", animating: true });
}

/**
 * Retarget-only shortcut.
 * @returns the 202 response when the shortcut applied, undefined otherwise
 */
async function tryRetargetOnly(
  res: Response,
  provider: GenerationProvider,
  key: string,
  userAddress: string,
  body: TripoGenerationInput,
): Promise<Response | undefined> {
  const rigSource = findRigSource(userAddress, body);
  if (!rigSource) return undefined;
  return startRetarget(res, provider, key, userAddress, rigSource, body);
}

/**
 * Start a follow-up task (animate chain, retopo, or retexture) on a source
 * asset: upload the source GLB to Tripo, then dispatch on the action flag.
 * @returns the 202 response when an action flag matched, undefined otherwise
 *   (the caller then falls through to fresh generation — unreachable in
 *   practice: the schema guarantees exactly one action flag)
 */
async function startSourceFollowUp(
  res: Response,
  provider: GenerationProvider,
  key: string,
  userAddress: string,
  sourceAssetCid: string,
  body: TripoGenerationInput,
): Promise<Response | undefined> {
  const { prompt, retexture, retopo, animate, rigOnly, rigModel, animateInPlace, animations, faceLimit, textureQuality } = body;
  const fileToken = await provider.uploadSource({ kind: "cid", cid: sourceAssetCid });
  const source: SourceRef = { kind: "fileToken", fileToken };

  if (animate) {
    console.log(`[GEN] starting animate chain source=${sourceAssetCid} animations=${(animations || []).join(",")} rigOnly=${Boolean(rigOnly)} inPlace=${Boolean(animateInPlace)}`);
    const rigCheckId = await provider.rigCheck({ source });
    const taskId = registerTask({
      tripoTaskId: rigCheckId, providerKey: key, userAddress,
      kind: "animate", phase: "rig-check", animations, rigOnly: Boolean(rigOnly), animateInPlace: Boolean(animateInPlace), sourceFileToken: fileToken, rigModel,
    });
    return res.status(202).json({ taskId, provider: "tripo3d", status: "running", animating: true });
  }

  if (retopo) {
    console.log(`[GEN] starting retopo source=${sourceAssetCid} faceLimit=${faceLimit ?? "adaptive"}`);
    const decimateId = await provider.retopo({ source, faceLimit });
    const taskId = registerTask({ tripoTaskId: decimateId, providerKey: key, userAddress });
    return res.status(202).json({ taskId, provider: "tripo3d", status: "running", retopo: true });
  }

  // retexture (schema guarantees exactly one action flag)
  if (retexture) {
    console.log(`[GEN] starting retexture source=${sourceAssetCid}`);
    const refineId = await provider.retexture({ prompt: prompt as string, source, textureQuality });
    const taskId = registerTask({ tripoTaskId: refineId, providerKey: key, userAddress });
    return res.status(202).json({ taskId, provider: "tripo3d", status: "running", refined: true });
  }
  return undefined;
}

/**
 * Start a fresh Tripo3D generation (multiview, image, or text) and register
 * the task. Action flags without sourceAssetCid are ignored here — the
 * prompt/image starts a new model.
 */
async function startFreshGeneration(
  res: Response,
  provider: GenerationProvider,
  key: string,
  userAddress: string,
  body: TripoGenerationInput,
): Promise<Response> {
  const { prompt, textureQuality, imageData, imageMime, images } = body;
  console.log(
    `[GEN] using Tripo3D adapter for "${prompt || (images ? "(multiview)" : "(image)")}" image=${Boolean(imageData)}${images ? ` views=${images.length}` : ""}`,
  );
  const tripoTaskId = images
    ? await provider.multiviewToModel({
        views: images.map((img: { imageData: string; imageMime: string; view: string }) => ({
          view: img.view,
          image: Buffer.from(img.imageData, "base64"),
          mime: img.imageMime,
        })) as MultiviewImage[],
        textureQuality,
      })
    : imageData
      ? await provider.imageToModel({
          image: Buffer.from(imageData, "base64"),
          mime: imageMime as string,
          textureQuality,
        })
      : await provider.textToModel({ prompt: prompt as string, textureQuality });
  const taskId = registerTask({
    tripoTaskId,
    providerKey: key,
    userAddress,
  });
  console.log(
    `[GEN] tripo task registered public=${taskId} tripo=${tripoTaskId}`,
  );
  return res.status(202).json({
    taskId,
    provider: "tripo3d",
    status: "running",
  });
}

/**
 * Poll body for in-flight tasks, with the chain stage label for animate
 * tasks so the UI can say which step is running.
 */
function buildProgressBody(
  entry: TaskEntry,
  poll: GenerationStatus,
): Record<string, unknown> {
  const stageLabels = {
    "rig-check": "Checking rig compatibility",
    rig: "Rigging skeleton",
    retarget: "Baking animations",
  };
  return {
    status: poll.status,
    progress: poll.progress ?? 0,
    ...(entry.kind === "animate" && {
      stage: stageLabels[entry.phase || "rig-check"],
    }),
  };
}

/**
 * Error mapping for GET /generations/:taskId: TripoApiErrors keep their HTTP
 * status (auth/credit failures are terminal for the task — evict the entry
 * and its transient BYOK key instead of waiting for the TTL); anything
 * unexpected is a 500 GENERATION_FAILED.
 */
function sendPollError(res: Response, err: Error, taskId: string): Response {
  console.error("[GEN] get error:", err.message);
  // Auth/credit failures are terminal for the task: evict the entry
  // (and its transient BYOK key) instead of waiting for the TTL.
  if (err instanceof TripoApiError && (err.status === 401 || err.status === 402)) {
    evictTask(taskId);
  }
  return sendProviderOrServerError(res, err, "GENERATION_FAILED");
}

/**
 * Terminal failure/cancel: evict the task and report PROVIDER_TASK_FAILED,
 * including the chain stage so the user knows which step died (the upstream
 * message alone says "Task failed").
 */
function sendTaskFailed(
  res: Response,
  entry: TaskEntry,
  taskId: string,
  poll: GenerationStatus,
): Response {
  evictTask(taskId);
  const failStage =
    entry.kind === "animate"
      ? {
          "rig-check": "Rig compatibility check",
          rig: "Rigging",
          retarget: "Animation bake",
        }[entry.phase || "rig-check"]
      : null;
  const failMessage = poll.error || "Task failed";
  console.log(
    `[GEN] task failed taskId=${taskId} stage=${failStage || "generate"} error=${failMessage}`,
  );
  return res.json({
    status: "failed",
    error: {
      code: "PROVIDER_TASK_FAILED",
      message: failStage ? `${failStage} failed — ${failMessage}` : failMessage,
    },
  });
}

/**
 * Terminal success: download the GLB, mark the task complete (kept in the
 * registry for the retarget-only shortcut), and return the bytes as base64.
 */
async function completeTask(
  res: Response,
  provider: GenerationProvider,
  entry: TaskEntry,
  taskId: string,
  userAddress: string,
  poll: GenerationStatus,
): Promise<Response> {
  if (!poll.glbUrl) {
    throw new Error("Tripo success response missing model URL");
  }
  const buffer = await provider.download(poll.glbUrl);
  markTaskComplete(taskId, userAddress);
  console.log(
    `[GEN] task complete taskId=${taskId} size=${buffer.length}`,
  );
  return res.json({
    status: "success",
    assetData: Buffer.from(buffer).toString("base64"),
    format: "glb",
    path: "asset.glb",
    provider: "tripo3d",
    providerTaskId: entry.tripoTaskId,
  });
}

/**
 * Animate chain: a succeeded rig-check or rig task starts the next phase
 * instead of finishing. rig-check → rig (failing fast when Tripo reports the
 * model is not riggable); rig → retarget with the requested presets.
 */
async function advanceAnimateChain(
  res: Response,
  provider: GenerationProvider,
  entry: TaskEntry,
  taskId: string,
  userAddress: string,
  poll: GenerationStatus,
): Promise<Response> {
  if (entry.phase === "rig-check") {
    const rigOutput = (
      poll.output
    ) as { riggable?: boolean; rig_type?: string } | undefined;
    if (!rigOutput?.riggable) {
      evictTask(taskId);
      console.log(`[GEN] animate chain: model not riggable taskId=${taskId}`);
      return res.json({
        status: "failed",
        error: {
          code: "MODEL_NOT_RIGGABLE",
          message:
            "Tripo reports this model is not riggable. Generate a full-body humanoid or creature (T-pose works best) and try again.",
        },
      });
    }
    const rig = await provider.rig({
      source: { kind: "fileToken", fileToken: entry.sourceFileToken || "" },
      rigType: rigOutput.rig_type || "biped",
      model: entry.rigModel,
    });
    updateTaskEntry(taskId, userAddress, {
      tripoTaskId: rig.taskId,
      phase: "rig",
      rigModel: rig.model,
    });
    console.log(
      `[GEN] animate chain: rig started taskId=${taskId} tripo=${rig.taskId} rig_type=${rigOutput.rig_type} model=${rig.model}`,
    );
    return res.json({
      status: "running",
      progress: 40,
      stage: "Rigging skeleton",
    });
  }
  // phase === "rig" → start retarget with the requested presets
  const retargetId = await provider.animate({
    rigTaskId: entry.tripoTaskId,
    animations: entry.animations || [],
    animateInPlace: Boolean(entry.animateInPlace),
    rigModel: entry.rigModel,
  });
  updateTaskEntry(taskId, userAddress, {
    tripoTaskId: retargetId,
    phase: "retarget",
  });
  console.log(
    `[GEN] animate chain: retarget started taskId=${taskId} tripo=${retargetId}`,
  );
  return res.json({
    status: "running",
    progress: 75,
    stage: "Baking animations",
  });
}

/**
 * Resolve the requested provider: defaults to "mock", and the mock adapter
 * also serves provider-less requests when MOCK_3D_GENERATION=true.
 */
function resolveProvider(provider: string | undefined): {
  effectiveProvider: string;
  useMockAdapter: boolean;
} {
  const effectiveProvider = provider || "mock";
  const useMockAdapter =
    effectiveProvider === "mock" ||
    (!provider && process.env.MOCK_3D_GENERATION === "true");
  return { effectiveProvider, useMockAdapter };
}

/**
 * Tripo3D dispatch: source follow-ups (retarget-only shortcut, then the
 * animate/retopo/retexture chain) when sourceAssetCid is set, fresh
 * generation otherwise.
 */
async function handleTripoRequest(
  res: Response,
  buildTripoProvider: (apiKey: string) => GenerationProvider,
  providerKey: string,
  userAddress: string,
  body: TripoGenerationInput,
): Promise<Response> {
  const { sourceAssetCid } = body;
  const key = providerKey.trim();
  const provider = buildTripoProvider(key);

  if (sourceAssetCid) {
    const retargeted = await tryRetargetOnly(res, provider, key, userAddress, body);
    if (retargeted) return retargeted;

    const followUp = await startSourceFollowUp(
      res, provider, key, userAddress, sourceAssetCid, body,
    );
    if (followUp) return followUp;
  }

  // await (not bare return) so provider errors land in the route's try/catch.
  return await startFreshGeneration(res, provider, key, userAddress, body);
}

/**
 * Respond to a task poll: progress while in flight, advance the animate
 * chain on intermediate successes, download the GLB on terminal success,
 * otherwise report the failure.
 */
async function respondToPoll(
  res: Response,
  provider: GenerationProvider,
  entry: TaskEntry,
  taskId: string,
  userAddress: string,
  poll: GenerationStatus,
): Promise<Response> {
  if (poll.status === "queued" || poll.status === "running") {
    return res.json(buildProgressBody(entry, poll));
  }

  // Animate chain: a succeeded rig-check or rig task starts the next phase
  // instead of finishing. Terminal phases: retarget (animate), or rig when
  // rigOnly was requested (rigged model, no animation).
  const chainTerminal =
    entry.phase === "retarget" || (entry.rigOnly && entry.phase === "rig");
  if (
    entry.kind === "animate" &&
    poll.status === "success" &&
    !chainTerminal
  ) {
    return await advanceAnimateChain(res, provider, entry, taskId, userAddress, poll);
  }

  if (poll.status === "success") {
    return await completeTask(res, provider, entry, taskId, userAddress, poll);
  }

  // failed or cancelled
  return sendTaskFailed(res, entry, taskId, poll);
}

/**
 * Generation route factory. Receives the asset-core facade (for composing
 * glTF JSON sources to GLB) and the storage adapter (for reading source GLBs)
 * from the composition root — no on-demand lookups.
 */
export default function generateAssetNode(
  core: ArbeskCore,
  storage: StorageAdapter,
) {
  const router = Router();

  /** CID → self-contained GLB bytes (decompress + compose glTF JSON as needed). */
  const sourceResolver = (cid: string): Promise<Buffer> =>
    resolveSourceGlb(cid, core, storage);

  /** Build a per-request Tripo provider (BYOK key is transient per request). */
  const buildTripoProvider = (apiKey: string): GenerationProvider =>
    createGenerationProvider({
      id: "tripo3d",
      apiKey,
      sourceResolver,
      capabilities: TRIPO_CAPABILITIES,
    });

  /**
   * POST /api/v1/generations
   *
   * Validates the session, checks the rate limit, calls the generation
   * adapter (mock or cloud), and returns the raw asset bytes to the
   * browser. The browser uploads the asset to IPFS, constructs the
   * manifest, and writes it to IPFS directly - no server-side IPFS
   * writes. The only server-side concerns are auth, rate limiting,
   * and the adapter call (which may need filesystem or API key access).
   */
  router.post(
    "/",
    authenticate,
    generationRateLimit,
    validateBody(generateAssetSchema),
    async (req: Request, res: Response) => {
      try {
        const { prompt, nodeId, provider, providerKey, imageData } = req.body;

        const { effectiveProvider, useMockAdapter } = resolveProvider(provider);

        console.log(
          `[GEN] prompt="${prompt || (imageData ? "(image)" : "")}" nodeId=${nodeId} provider=${effectiveProvider} mock=${useMockAdapter}`,
        );

        if (rejectMissingProviderKey(res, effectiveProvider, providerKey)) {
          return;
        }

        // On-chain generation verification (#48): when the client claims an
        // on-chain generation/payment transaction, verify it before spending
        // provider credits. Opt-in — mock/BYOK requests omit the txHash.
        if (req.body.generationTxHash) {
          const verification = await verifyOnChainGeneration({
            chainId: Number(req.body.chainId) || CHAIN_IDS.BASE_TESTNET,
            userAddress: res.locals.userAddress,
            nodeId,
            txHash: req.body.generationTxHash,
          });
          if (!verification.ok) {
            return res.status(402).json({
              error: {
                code: verification.reason || "GENERATION_NOT_VERIFIED",
                message: "On-chain generation verification failed",
              },
            });
          }
        }

        if (useMockAdapter) {
          // await (not bare return) so a throw lands in the try/catch below.
          return await runMockGeneration(res, prompt);
        }

        if (effectiveProvider === "tripo3d") {
          // await (not bare return) so provider errors land in the try/catch.
          return await handleTripoRequest(
            res, buildTripoProvider, providerKey, res.locals.userAddress, req.body,
          );
        }

        console.log("[GEN] cloud adapter not implemented - rejecting");
        return res.status(501).json({
          error: {
            code: "NOT_IMPLEMENTED",
            message: "Cloud adapters not yet implemented",
          },
        });
      } catch (error) {
        return sendGenerationError(res, error as Error);
      }
    },
  );

  /**
   * POST /api/v1/generations/balance
   *
   * Returns the Tripo3D credit balance for a user-supplied BYOK key. The key
   * is used transiently for this single upstream call — never logged or
   * persisted. Session-gated so the route cannot be used as an anonymous
   * key-probing oracle. No rate limit: balance checks are cheap and do not
   * consume generation quota.
   */
  router.post(
    "/balance",
    authenticate,
    validateBody(providerBalanceSchema),
    async (req: Request, res: Response) => {
      try {
        const key = req.body.providerKey.trim();
        const provider = buildTripoProvider(key);
        const result = await provider.getBalance();
        console.log("[GEN] balance fetched for BYOK key=***");
        return res.json(result);
      } catch (error) {
        const err = error as Error;
        console.error("[GEN] balance error:", err.message);
        return sendProviderOrServerError(res, err, "BALANCE_FAILED");
      }
    },
  );

  /**
   * DELETE /api/v1/generations/:taskId
   *
   * Stop an in-flight task: the registry entry is evicted (the GET poll then
   * 404s, so the browser stops waiting) and a best-effort cancel is sent
   * upstream. Provider credits already consumed are not refunded — the
   * frontend warns the user before calling this.
   */
  router.delete("/:taskId", authenticate, async (req: Request, res: Response) => {
    const taskId = String(req.params.taskId);
    const entry = getTask(taskId, res.locals.userAddress);
    if (!entry) {
      return res.status(404).json({
        error: {
          code: "GENERATION_TASK_NOT_FOUND",
          message: "Generation task not found",
        },
      });
    }
    evictTask(taskId);
    console.log(`[GEN] task cancelled taskId=${taskId} tripo=${entry.tripoTaskId}`);
    const provider = buildTripoProvider(entry.providerKey);
    const upstreamCancelled = await provider.cancel(entry.tripoTaskId);
    return res.json({ status: "cancelled", upstreamCancelled });
  });

  /**
   * GET /api/v1/generations/:taskId
   *
   * Polls an in-flight Tripo3D generation task. Requires a valid session;
   * the task must belong to the authenticated wallet. On success the GLB is
   * downloaded, the task entry is evicted, and the model bytes are returned
   * to the browser for client-side IPFS upload.
   */
  router.get("/:taskId", authenticate, async (req: Request, res: Response) => {
    try {
      const taskId = String(req.params.taskId);
      const entry = getTask(taskId, res.locals.userAddress);

      if (!entry) {
        console.log(`[GEN] task not found taskId=${taskId}`);
        return res.status(404).json({
          error: {
            code: "GENERATION_TASK_NOT_FOUND",
            message: "Generation task not found",
          },
        });
      }

      console.log(`[GEN] polling taskId=${taskId} tripo=${entry.tripoTaskId}`);
      const provider = buildTripoProvider(entry.providerKey);
      const poll = await provider.poll(entry.tripoTaskId);

      return await respondToPoll(
        res, provider, entry, taskId, res.locals.userAddress, poll,
      );
    } catch (error) {
      return sendPollError(res, error as Error, String(req.params.taskId));
    }
  });

  return router;
}
