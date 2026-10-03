import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { serializeGLB } from "@arbesk/asset-core/formats/gltf/gltf-core.js";
import {
  isCompressedPayload,
  decompressAuto,
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
import { resolveCadRuntime, createCadGenerationProvider } from "../generation-providers.ts";
import type { GenerationProvidersDeps } from "../generation-providers.ts";
import {
  acquireCadSlot,
  releaseCadSlot,
  refundCadUnit,
} from "../cad-quota.ts";
import { refuseAdmission, setQuotaHeaders as setCadQuotaHeaders } from "../routes/cad.ts";
import type { CadRuntimeConfig } from "../routes/cad.ts";
import authenticate from "../authentication.ts";
import type { AuthEnv } from "../authentication.ts";
import { generationRateLimit } from "../rate-limiter.ts";
import { validateBody } from "../validation.ts";
import { generateAssetSchema, providerBalanceSchema } from "../schemas.ts";
import { verifyOnChainGeneration } from "../generation-verify.ts";
import { CHAIN_IDS } from "../../../constants/chains.js";

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

/** Capabilities the CAD provider declares (design-on-the-wire, text-only). */
const CAD_CAPABILITIES: GenerationCapability[] = ["text-to-3d"];

/** Tripo's file upload limit for source GLBs (file_token flow). */
const TRIPO_SOURCE_GLB_LIMIT_BYTES = 150 * 1024 * 1024;

/** glTF 2.0 GLB magic number. */
const GLB_MAGIC = 0x46546C67;

/** 400 message for sources Tripo follow-ups cannot consume (→ SOURCE_ASSET_UNSUPPORTED_FORMAT). */
const MSG_SOURCE_UNSUPPORTED =
  "Source asset is not glTF/GLB — Tripo follow-ups (retexture, retopo, auto-rig, animate) require a glTF or GLB model";

/** 400 message prefix for glTF JSON with references we cannot inline (→ SOURCE_ASSET_UNSUPPORTED_FORMAT). */
const MSG_SOURCE_UNRESOLVABLE_PREFIX = "Source glTF has external references that cannot be resolved";

/** Checks whether a buffer is a binary GLB. */
function isGlb(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === GLB_MAGIC;
}

/**
 * Checks whether a buffer looks like glTF JSON (starts with `{`).
 * @remarks Any glTF JSON (composite or self-contained) is composed to GLB
 *   before upload. Only the first byte is checked: a fixed head window misses
 *   composites whose `ipfs://` refs sit deeper, and those then fail
 *   Tripo-side with code 1004.
 */
function looksLikeGltfJson(buf: Buffer): boolean {
  return buf.length >= 1 && buf[0] === 0x7B; // '{'
}

/**
 * Validates that a composed glTF has no external (non-data-URI) buffer/image refs.
 * @throws TripoApiError (400) when any buffer or image URI is not a data URI.
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
  c: Context,
  err: Error,
  serverCode: string,
): Response {
  if (err instanceof TripoApiError) {
    return c.json({
      error: {
        code: providerErrorCode(err.status),
        message: err.message,
      },
    }, err.status as ContentfulStatusCode);
  }
  return c.json({
    error: {
      code: serverCode,
      message: err.message,
    },
  }, 500);
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
function sendGenerationError(c: Context, err: Error): Response {
  console.error("[GEN] error:", err.message);
  const rule =
    err instanceof TripoApiError && err.status === 400
      ? SOURCE_ERROR_RULES.find((r) => r.match(err.message))
      : undefined;
  if (rule) {
    return c.json({
      error: {
        code: rule.code,
        message: err.message,
      },
    }, 400);
  }
  return sendProviderOrServerError(c, err, "GENERATION_FAILED");
}

/**
 * BYOK (Bring Your Own Key) gate: the Tripo3D provider requires a user-supplied
 * API key.
 * @remarks The user pays the provider directly, so the on-chain quota/payment
 *   gate is bypassed entirely. The key is used transiently and never logged or
 *   persisted. Server-paid providers (mock, cad) need no key; an unknown
 *   provider never reaches a provider call, so it falls through to the 501 arm
 *   regardless of the key.
 * @returns the 400 MISSING_PROVIDER_KEY response, or null when the key is fine
 */
function rejectMissingProviderKey(
  c: Context,
  effectiveProvider: string,
  providerKey: unknown,
): Response | null {
  if (effectiveProvider === "tripo3d") {
    if (
      typeof providerKey !== "string" ||
      providerKey.trim().length === 0
    ) {
      console.log(
        "[GEN] rejected - providerKey required for real provider",
      );
      return c.json({
        error: {
          code: "MISSING_PROVIDER_KEY",
          message: "providerKey is required for the selected provider",
        },
      }, 400);
    }
    console.log(
      `[GEN] byok provider=${effectiveProvider} key=*** (len=${providerKey.trim().length}) - on-chain gate bypassed`,
    );
  }
  return null;
}

/**
 * @remarks Mock is text-to-3D only; image-only requests fall back to a
 *   placeholder prompt (image input is Tripo3D-only).
 */
async function runMockGeneration(
  c: Context,
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
  return c.json({
    assetData: assetBase64,
    format: assetFormat,
    path: `asset.${assetFormat}`,
    provider: "mock",
  });
}

/**
 * Fetches a source asset from IPFS and returns it as a self-contained GLB.
 * @remarks Decompresses brotli/gzipped assets and composes glTF JSON to GLB.
 * @throws TripoApiError (400) when the source is unavailable, unsupported, or >150 MB.
 * @returns self-contained GLB Buffer
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
  // Decomposed assets are stored compressed — decompress before any
  // format detection (the brotli frame or gzip magic would otherwise read
  // as "not glTF").
  if (isCompressedPayload(glb)) {
    console.log(`[GEN] source asset is compressed — decompressing cid=${cid}`);
    glb = Buffer.from(await decompressAuto(glb));
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
  nodeId: string;
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
 * TTL).
 * @remarks Skipped when the caller explicitly picked a different rig model
 *   (the full chain with the chosen model is needed then); everything else
 *   goes through the GLB — the canonical, expiry-free path.
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
  c: Context,
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
  return c.json({ taskId, provider: "tripo3d", status: "running", animating: true }, 202);
}

/**
 * Retarget-only shortcut.
 * @returns the 202 response when the shortcut applied, undefined otherwise
 */
async function tryRetargetOnly(
  c: Context,
  provider: GenerationProvider,
  key: string,
  userAddress: string,
  body: TripoGenerationInput,
): Promise<Response | undefined> {
  const rigSource = findRigSource(userAddress, body);
  if (!rigSource) return undefined;
  return startRetarget(c, provider, key, userAddress, rigSource, body);
}

/**
 * Starts a follow-up task (animate chain, retopo, or retexture) on a source
 * asset: uploads the source GLB to Tripo, then dispatches on the action flag.
 * @returns the 202 response when an action flag matched, undefined otherwise
 */
async function startSourceFollowUp(
  c: Context,
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
    return c.json({ taskId, provider: "tripo3d", status: "running", animating: true }, 202);
  }

  if (retopo) {
    console.log(`[GEN] starting retopo source=${sourceAssetCid} faceLimit=${faceLimit ?? "adaptive"}`);
    const decimateId = await provider.retopo({ source, faceLimit });
    const taskId = registerTask({ tripoTaskId: decimateId, providerKey: key, userAddress });
    return c.json({ taskId, provider: "tripo3d", status: "running", retopo: true }, 202);
  }

  // retexture (schema guarantees exactly one action flag)
  if (retexture) {
    console.log(`[GEN] starting retexture source=${sourceAssetCid}`);
    const refineId = await provider.retexture({ prompt: prompt as string, source, textureQuality });
    const taskId = registerTask({ tripoTaskId: refineId, providerKey: key, userAddress });
    return c.json({ taskId, provider: "tripo3d", status: "running", refined: true }, 202);
  }
  return undefined;
}

/**
 * Starts a fresh Tripo3D generation (multiview, image, or text) and registers
 * the task.
 * @remarks Action flags without sourceAssetCid are ignored here — the
 *   prompt/image starts a new model.
 */
async function startFreshGeneration(
  c: Context,
  provider: GenerationProvider,
  key: string,
  userAddress: string,
  body: TripoGenerationInput,
): Promise<Response> {
  const { prompt, textureQuality, imageData, imageMime, images } = body;
  // Do not log user-authored prompt text — it may contain PII. Log only the
  // non-sensitive input mode (text / image / multiview).
  const inputKind = images ? "multiview" : imageData ? "image" : "text";
  console.log(
    `[GEN] using Tripo3D adapter input=${inputKind}${images ? ` views=${images.length}` : ""}`,
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
  return c.json({
    taskId,
    provider: "tripo3d",
    status: "running",
  }, 202);
}

/**
 * Builds the poll body for in-flight tasks, with the chain stage label for
 * animate tasks.
 * @remarks Lets the UI show which step is running.
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
 * Error mapping for GET /generations/:taskId.
 * @remarks TripoApiErrors keep their HTTP status (auth/credit failures are
 *   terminal — evict the entry and its transient BYOK key instead of waiting
 *   for the TTL); anything unexpected is a 500 GENERATION_FAILED.
 */
function sendPollError(c: Context, err: Error, taskId: string): Response {
  console.error("[GEN] get error:", err.message);
  // Auth/credit failures are terminal for the task: evict the entry
  // (and its transient BYOK key) instead of waiting for the TTL.
  if (err instanceof TripoApiError && (err.status === 401 || err.status === 402)) {
    evictTask(taskId);
  }
  return sendProviderOrServerError(c, err, "GENERATION_FAILED");
}

/**
 * Terminal failure/cancel: evicts the task and reports PROVIDER_TASK_FAILED.
 * @remarks Includes the chain stage so the user knows which step died (the
 *   upstream message alone says "Task failed").
 */
function sendTaskFailed(
  c: Context,
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
  return c.json({
    status: "failed",
    error: {
      code: "PROVIDER_TASK_FAILED",
      message: failStage ? `${failStage} failed — ${failMessage}` : failMessage,
    },
  });
}

/**
 * Terminal success: downloads the GLB and marks the task complete.
 * @remarks The completed entry stays in the registry for the retarget-only
 *   shortcut.
 */
async function completeTask(
  c: Context,
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
  return c.json({
    status: "success",
    assetData: Buffer.from(buffer).toString("base64"),
    format: "glb",
    path: "asset.glb",
    provider: "tripo3d",
    providerTaskId: entry.tripoTaskId,
  });
}

/**
 * Terminal success for a CAD task: the design document IS the payload —
 * no download, no geometry (the server never runs the kernel, cad-gen S11).
 */
async function completeCadTask(
  c: Context,
  entry: TaskEntry,
  taskId: string,
  userAddress: string,
  poll: GenerationStatus,
): Promise<Response> {
  const result = poll.output as {
    design: unknown;
    runtime: unknown;
    provider: unknown;
    attribution: unknown;
    diagnostics: unknown;
  };
  markTaskComplete(taskId, userAddress);
  console.log(`[GEN] cad task complete taskId=${taskId}`);
  return c.json({
    status: "success",
    format: "cad-design",
    design: result.design,
    runtime: result.runtime,
    provider: result.provider,
    attribution: result.attribution,
    diagnostics: result.diagnostics,
    providerTaskId: entry.tripoTaskId,
  });
}

/**
 * Animate chain: a succeeded rig-check or rig task starts the next phase
 * instead of finishing.
 * @remarks rig-check → rig (failing fast when Tripo reports the model is not
 *   riggable); rig → retarget with the requested presets.
 */
async function advanceAnimateChain(
  c: Context,
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
      return c.json({
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
    return c.json({
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
  return c.json({
    status: "running",
    progress: 75,
    stage: "Baking animations",
  });
}

/**
 * Resolves the requested provider.
 * @remarks Defaults to "mock"; the mock adapter also serves provider-less
 *   requests when MOCK_3D_GENERATION=true.
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
 * CAD dispatch: server-paid, design-on-the-wire. Admits through the cad
 * quota (daily rounds + one in-flight per wallet), starts the in-process
 * task, and wires settle-time metering (slot release; unsuitable refund).
 * @remarks The provider is built AFTER admission so onSettle can close over
 *   the admitted slot token; the route — not the provider — owns metering.
 */
async function handleCadRequest(
  c: Context,
  userAddress: string,
  body: { prompt?: string; nodeId: string },
  cadDeps: GenerationProvidersDeps,
): Promise<Response> {
  const prompt = body.prompt?.trim();
  if (!prompt) {
    return c.json({
      error: { code: "VALIDATION_ERROR", message: "prompt is required for the cad provider" },
    }, 400);
  }

  const runtime = resolveCadRuntime(cadDeps);
  if (!runtime.ok) {
    return c.json(
      { error: { code: runtime.code, message: runtime.message } },
      runtime.status as ContentfulStatusCode,
    );
  }
  const config: CadRuntimeConfig = runtime.config;

  const decision = acquireCadSlot(userAddress, config.quota);
  if (!decision.ok) {
    return refuseAdmission(c, userAddress, config, decision);
  }

  setCadQuotaHeaders(c, userAddress, config);
  const provider = createCadGenerationProvider(config.generator, (taskId, outcome) => {
    releaseCadSlot(userAddress, decision.token);
    if (!outcome.ok && outcome.error.code === "CAD_REQUEST_UNSUITABLE") {
      refundCadUnit(userAddress, config.quota);
    }
  }, CAD_CAPABILITIES);

  console.log(`[GEN] cad generation started nodeId=${body.nodeId}`);
  const cadTaskId = await provider.textToModel({ prompt });
  const taskId = registerTask({
    tripoTaskId: cadTaskId,
    providerKey: "",
    userAddress,
    provider: "cad",
  });
  return c.json({ taskId, provider: "cad", status: "running" }, 202);
}

/**
 * Tripo3D dispatch: source follow-ups (retarget-only shortcut, then the
 * animate/retopo/retexture chain) when sourceAssetCid is set, fresh
 * generation otherwise.
 */
async function handleTripoRequest(
  c: Context,
  buildTripoProvider: (apiKey: string) => GenerationProvider,
  providerKey: string,
  userAddress: string,
  body: TripoGenerationInput,
): Promise<Response> {
  const { sourceAssetCid } = body;
  const key = providerKey.trim();
  const provider = buildTripoProvider(key);

  if (sourceAssetCid) {
    const retargeted = await tryRetargetOnly(c, provider, key, userAddress, body);
    if (retargeted) return retargeted;

    const followUp = await startSourceFollowUp(
      c, provider, key, userAddress, sourceAssetCid, body,
    );
    if (followUp) return followUp;
  }

  // await (not bare return) so provider errors land in the route's try/catch.
  return await startFreshGeneration(c, provider, key, userAddress, body);
}

/**
 * Terminal success for a poll: advance the animate chain on intermediate
 * successes, hand a CAD design payload to completeCadTask, download the GLB
 * for a tripo success.
 * @remarks Only called when poll.status === "success".
 */
async function completePollSuccess(
  c: Context,
  provider: GenerationProvider,
  entry: TaskEntry,
  taskId: string,
  userAddress: string,
  poll: GenerationStatus,
): Promise<Response> {
  // Animate chain: a succeeded rig-check or rig task starts the next phase
  // instead of finishing. Terminal phases: retarget (animate), or rig when
  // rigOnly was requested (rigged model, no animation).
  const chainTerminal =
    entry.phase === "retarget" || (entry.rigOnly && entry.phase === "rig");
  if (entry.kind === "animate" && !chainTerminal) {
    return await advanceAnimateChain(c, provider, entry, taskId, userAddress, poll);
  }

  if (poll.format === "cad-design") {
    return await completeCadTask(c, entry, taskId, userAddress, poll);
  }

  return await completeTask(c, provider, entry, taskId, userAddress, poll);
}

/**
 * Terminal failure for a poll: the CAD unsuitable arm (refunded at settle
 * time, this is the report), then the generic provider failure.
 */
function respondToTaskFailure(
  c: Context,
  entry: TaskEntry,
  taskId: string,
  poll: GenerationStatus,
): Response {
  if (poll.status === "failed") {
    const details = poll.output as { code?: string; suitability?: number; alternative?: unknown } | undefined;
    if (details?.code === "CAD_REQUEST_UNSUITABLE") {
      // Refunded at settle time (the POST branch's onSettle); this is the report.
      evictTask(taskId);
      console.log(`[GEN] cad task unsuitable taskId=${taskId} suitability=${details.suitability}`);
      return c.json({
        status: "failed",
        error: {
          code: "CAD_REQUEST_UNSUITABLE",
          message: poll.error || "Request unsuitable for CAD generation",
          suitability: details.suitability,
          alternative: details.alternative,
        },
      });
    }
  }

  // failed or cancelled
  return sendTaskFailed(c, entry, taskId, poll);
}

/**
 * Respond to a task poll: progress while in flight, complete on terminal
 * success, otherwise report the failure.
 */
async function respondToPoll(
  c: Context,
  provider: GenerationProvider,
  entry: TaskEntry,
  taskId: string,
  userAddress: string,
  poll: GenerationStatus,
): Promise<Response> {
  if (poll.status === "queued" || poll.status === "running") {
    return c.json(buildProgressBody(entry, poll));
  }

  if (poll.status === "success") {
    return await completePollSuccess(c, provider, entry, taskId, userAddress, poll);
  }

  return respondToTaskFailure(c, entry, taskId, poll);
}

/**
 * Generation route factory.
 * @remarks Receives the asset-core facade and the storage adapter from the
 *   composition root — no on-demand lookups.
 */
export default function generateAssetNode(
  core: ArbeskCore,
  storage: StorageAdapter,
  cadDeps: GenerationProvidersDeps = {},
) {
  const app = new Hono<AuthEnv>();

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
   * Dispatch on the resolved provider: mock (server samples), cad
   * (server-paid design), tripo3d (BYOK), otherwise the 501 arm.
   */
  const dispatchGeneration = async (
    c: Context,
    effectiveProvider: string,
    useMockAdapter: boolean,
    providerKey: string | undefined,
    body: TripoGenerationInput,
  ): Promise<Response> => {
    if (useMockAdapter) {
      // await (not bare return) so a throw lands in the route's try/catch below.
      return await runMockGeneration(c, body.prompt);
    }

    if (effectiveProvider === "cad") {
      return await handleCadRequest(
        c, c.get("userAddress"), body, cadDeps,
      );
    }

    if (effectiveProvider === "tripo3d") {
      // await (not bare return) so provider errors land in the try/catch.
      return await handleTripoRequest(
        c, buildTripoProvider, providerKey as string, c.get("userAddress"), body,
      );
    }

    console.log("[GEN] cloud adapter not implemented - rejecting");
    return c.json({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Cloud adapters not yet implemented",
      },
    }, 501);
  };

  /**
   * POST /api/v1/generations
   *
   * Validates the session, checks the rate limit, calls the generation adapter
   * (mock or cloud), and returns the raw asset bytes to the browser.
   * @remarks The browser uploads the asset to IPFS and writes the manifest
   *   directly — no server-side IPFS writes.
   */
  app.post(
    "/",
    authenticate,
    generationRateLimit,
    validateBody(generateAssetSchema),
    async (c) => {
      try {
        const body = c.req.valid("json");
        const { nodeId, provider, providerKey } = body;

        const { effectiveProvider, useMockAdapter } = resolveProvider(provider);

        // Do not log user-authored prompt text — it may contain PII.
        console.log(
          `[GEN] nodeId=${nodeId} provider=${effectiveProvider} mock=${useMockAdapter}`,
        );

        const missingKey = rejectMissingProviderKey(c, effectiveProvider, providerKey);
        if (missingKey) return missingKey;

        // On-chain generation verification (#48): when the client claims an
        // on-chain generation/payment transaction, verify it before spending
        // provider credits. Opt-in — mock/BYOK requests omit the txHash.
        if (body.generationTxHash) {
          const verification = await verifyOnChainGeneration({
            chainId: Number(body.chainId) || CHAIN_IDS.BASE_TESTNET,
            userAddress: c.get("userAddress"),
            nodeId,
            txHash: body.generationTxHash,
          });
          if (!verification.ok) {
            return c.json({
              error: {
                code: verification.reason || "GENERATION_NOT_VERIFIED",
                message: "On-chain generation verification failed",
              },
            }, 402);
          }
        }

        return await dispatchGeneration(
          c, effectiveProvider, useMockAdapter, providerKey, body,
        );
      } catch (error) {
        return sendGenerationError(c, error as Error);
      }
    },
  );

  /**
   * POST /api/v1/generations/balance
   *
   * Returns the Tripo3D credit balance for a user-supplied BYOK key.
   * @remarks The key is used transiently for this single upstream call (never
   *   logged or persisted). Session-gated so the route cannot be used as an
   *   anonymous key-probing oracle; no rate limit because balance checks are
   *   cheap and don't consume generation quota.
   */
  app.post(
    "/balance",
    authenticate,
    validateBody(providerBalanceSchema),
    async (c) => {
      try {
        const key = c.req.valid("json").providerKey.trim();
        const provider = buildTripoProvider(key);
        const result = await provider.getBalance();
        console.log("[GEN] balance fetched for BYOK key=***");
        return c.json(result);
      } catch (error) {
        const err = error as Error;
        console.error("[GEN] balance error:", err.message);
        return sendProviderOrServerError(c, err, "BALANCE_FAILED");
      }
    },
  );

  /**
   * DELETE /api/v1/generations/:taskId
   *
   * Stops an in-flight task: evicts the registry entry and sends a best-effort
   * cancel upstream.
   * @remarks Provider credits already consumed are not refunded — the frontend
   *   warns the user before calling this.
   */
  app.delete("/:taskId", authenticate, async (c) => {
    const taskId = c.req.param("taskId");
    const entry = getTask(taskId, c.get("userAddress"));
    if (!entry) {
      return c.json({
        error: {
          code: "GENERATION_TASK_NOT_FOUND",
          message: "Generation task not found",
        },
      }, 404);
    }
    evictTask(taskId);
    console.log(`[GEN] task cancelled taskId=${taskId} tripo=${entry.tripoTaskId}`);
    if (entry.provider === "cad") {
      const runtime = resolveCadRuntime(cadDeps);
      const upstreamCancelled = runtime.ok
        ? await createCadGenerationProvider(runtime.config.generator).cancel(entry.tripoTaskId)
        : false;
      console.log(`[GEN] cad task cancelled taskId=${taskId}`);
      return c.json({ status: "cancelled", upstreamCancelled });
    }
    const provider = buildTripoProvider(entry.providerKey);
    const upstreamCancelled = await provider.cancel(entry.tripoTaskId);
    return c.json({ status: "cancelled", upstreamCancelled });
  });

  /**
   * GET /api/v1/generations/:taskId
   *
   * Polls an in-flight Tripo3D generation task.
   * @remarks Requires a valid session and task ownership; on success the GLB
   *   is downloaded and the model bytes are returned for client-side IPFS
   *   upload.
   */
  app.get("/:taskId", authenticate, async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const entry = getTask(taskId, c.get("userAddress"));

      if (!entry) {
        console.log(`[GEN] task not found taskId=${taskId}`);
        return c.json({
          error: {
            code: "GENERATION_TASK_NOT_FOUND",
            message: "Generation task not found",
          },
        }, 404);
      }

      console.log(`[GEN] polling taskId=${taskId} tripo=${entry.tripoTaskId}`);
      if (entry.provider === "cad") {
        const runtime = resolveCadRuntime(cadDeps);
        if (!runtime.ok) {
          return c.json(
            { error: { code: runtime.code, message: runtime.message } },
            runtime.status as ContentfulStatusCode,
          );
        }
        const cadProvider = createCadGenerationProvider(runtime.config.generator);
        const cadPoll = await cadProvider.poll(entry.tripoTaskId);
        return await respondToPoll(
          c, cadProvider, entry, taskId, c.get("userAddress"), cadPoll,
        );
      }
      const provider = buildTripoProvider(entry.providerKey);
      const poll = await provider.poll(entry.tripoTaskId);

      return await respondToPoll(
        c, provider, entry, taskId, c.get("userAddress"), poll,
      );
    } catch (error) {
      return sendPollError(c, error as Error, c.req.param("taskId"));
    }
  });

  return app;
}
