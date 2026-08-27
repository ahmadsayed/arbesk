// Tripo3D v3 REST API (global region; China region is openapi.tripo3d.com).
// Tripo retires the v2 API on 2026-11-01 — do not revert to /v2/openapi.
export const TRIPO_API_BASE = "https://openapi.tripo3d.ai/v3";
export const TRIPO_MODEL_VERSION = process.env.TRIPO_3D_MODEL || "v3.1-20260211";
// The rig endpoint has its own model line — its default is a retired version
// (rejected with code 1004, verified 2026-08-02). Allowed: v1.0-20240301,
// v2.5-20260210.
export const TRIPO_RIG_MODEL = process.env.TRIPO_3D_RIG_MODEL || "v2.5-20260210";
// Biped (humanoid) rig line. v1.0-20240301 is the docs-recommended humanoid
// rig (90+ biped presets) but was rejected with code 1004 on 2026-08-02 —
// rigModelTask tries it first for bipeds and falls back to TRIPO_RIG_MODEL,
// so the better rig kicks in automatically when Tripo re-enables it.
export const TRIPO_RIG_BIPED_MODEL =
  process.env.TRIPO_3D_RIG_BIPED_MODEL || "v1.0-20240301";

/** Valid Tripo texture_quality levels (generation ≥ v3.0 and models/texture). */
export const TEXTURE_QUALITIES = ["standard", "detailed", "extreme"];

/**
 * Upstream timeout for calls that make Tripo ingest an uploaded model
 * server-side (file upload, texture, decimate, rig-check, rig). On a large
 * GLB (tens of MB) the task-creation response itself can exceed the default
 * 60s — observed live with a 41 MB rig-check source (2026-08-06).
 */
const TRIPO_INGEST_TIMEOUT_MS = 240_000;

/** Options shared by generation task creators. */
export interface TextureQualityOptions {
  /** One of TEXTURE_QUALITIES. */
  textureQuality?: string;
}

/** file_token per view, from uploadImage(). */
export interface MultiviewViewTokens {
  front: string;
  left?: string;
  back?: string;
  right?: string;
}

export interface DecimateOptions {
  /** Target faces (500–20,000); adaptive when omitted. */
  faceLimit?: number;
  /** Quad mesh (forces FBX output!). */
  quad?: boolean;
}

/** Explicit model override; skips auto-select + fallback when set. */
export interface RigModelOptions {
  model?: string;
}

export interface RetargetOptions {
  /** Play in place, no root displacement. */
  animateInPlace?: boolean;
  /** Rig model that produced rigTaskId; v1.0 biped rigs take
   *  `preset:biped:*` IDs, so generic presets are mapped. */
  rigModel?: string;
}

export interface TripoPollResult {
  status: string;
  progress?: number;
  glbUrl?: string;
  output?: object;
  error?: string;
}

export class TripoApiError extends Error {
  /** Tripo API error code. */
  code: number;
  /** HTTP status to return to the browser. */
  status: number;

  constructor(message: string, code: number, status = 500) {
    super(message);
    this.name = "TripoApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Low-level fetch wrapper for the Tripo v3 API.
 * @param path - path after base, e.g. "generation/text-to-model"
 * @param body - plain object (JSON) or FormData (multipart)
 * @param timeoutMs - upstream timeout; file-ingesting task-creation
 *   endpoints (rig-check, rig, decimate, texture) pass more, because Tripo
 *   ingests the uploaded model before answering
 */
async function tripoFetch(
  path: string,
  apiKey: string,
  method: "GET" | "POST" = "GET",
  body?: object | FormData,
  timeoutMs = 60_000,
): Promise<any> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // Multipart bodies must not set Content-Type — fetch adds the boundary.
      ...(isForm ? {} : { "Content-Type": "application/json" }),
    },
    // A stalled upstream connection must not hang the Express request.
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body) opts.body = isForm ? body : JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(`${TRIPO_API_BASE}/${path}`, opts);
  } catch (e) {
    const err = e as Error;
    // AbortSignal.timeout rejects with a DOMException named "TimeoutError"
    // ("The operation was aborted due to timeout") — name the endpoint and
    // budget so [GEN] logs and the UI show WHICH Tripo call stalled instead
    // of the raw abort text.
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new TripoApiError(
        `Tripo API timed out after ${Math.round(timeoutMs / 1000)}s on ${method} /${path}`,
        0,
        502,
      );
    }
    // Network-level failure (DNS, TLS, connection reset) — no HTTP status.
    throw new TripoApiError(
      `Tripo API unreachable on ${method} /${path}: ${err.message}`,
      0,
      502,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const preview = text.slice(0, 200);
    const message = preview
      ? `Tripo HTTP error: ${preview}`
      : `Tripo HTTP error: status ${res.status}`;
    // Only 401/402 have intentional client mappings; everything else is a
    // generic upstream failure (502).
    const status = res.status === 401 || res.status === 402 ? res.status : 502;
    throw new TripoApiError(message, 0, status);
  }
  const json = (await res.json().catch(() => ({}))) as {
    code?: number;
    message?: string;
    data?: any;
  };
  if (json.code !== 0) {
    const code = json.code ?? 0;
    const status = mapTripoCodeToHttp(code);
    throw new TripoApiError(json.message || "Tripo provider error", code, status);
  }
  return json.data;
}

function mapTripoCodeToHttp(code: number): number {
  // 1002 = auth failed, 2010 = insufficient credits
  if (code === 1002) return 401;
  if (code === 2010) return 402;
  return 502;
}

/**
 * Map the textureQuality option to Tripo's texture_quality field.
 * "standard" is Tripo's default — omitting the field keeps payloads minimal.
 */
function textureQualityField(options: TextureQualityOptions): { texture_quality?: string } {
  const q = options.textureQuality;
  return q && q !== "standard" && TEXTURE_QUALITIES.includes(q)
    ? { texture_quality: q }
    : {};
}

/**
 * Create a text-to-3D task.
 * @returns task_id
 */
export async function createTask(
  prompt: string,
  apiKey: string,
  options: TextureQualityOptions = {},
): Promise<string> {
  if (!prompt || typeof prompt !== "string") {
    throw new TripoApiError("prompt is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(
    `[GEN] Tripo createTask prompt_len=${prompt.length} tq=${options.textureQuality || "standard"}`,
  );
  const data = await tripoFetch("generation/text-to-model", apiKey, "POST", {
    prompt,
    model: TRIPO_MODEL_VERSION,
    texture: true,
    pbr: true,
    // Scale to estimated real-world meters — without this Tripo models often
    // arrive tiny and the Studio camera has to hunt for them.
    auto_size: true,
    ...textureQualityField(options),
  });
  if (typeof data.task_id !== "string") {
    throw new TripoApiError("Tripo did not return a task ID", 0, 502);
  }
  console.log(`[GEN] Tripo task created task_id=${data.task_id}`);
  return data.task_id;
}

/**
 * Fetch the credit balance for a BYOK key (GET /account/balance).
 */
export async function getBalance(
  apiKey: string,
): Promise<{ balance: number; frozen: number }> {
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  const data = await tripoFetch("account/balance", apiKey);
  if (typeof data?.balance !== "number") {
    throw new TripoApiError("Tripo did not return a balance", 0, 502);
  }
  console.log(`[GEN] Tripo balance=${data.balance} frozen=${data.frozen ?? 0}`);
  return { balance: data.balance, frozen: data.frozen ?? 0 };
}

/**
 * Upload a source image to Tripo (POST /files) and return its file_token.
 * @param imageBuffer - raw image bytes (jpeg/png/webp)
 * @param mime - image MIME type, e.g. "image/png"
 * @returns file_token
 */
export async function uploadImage(
  imageBuffer: Buffer,
  mime: string,
  apiKey: string,
): Promise<string> {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new TripoApiError("imageBuffer is required", 0, 400);
  }
  if (!mime || typeof mime !== "string") {
    throw new TripoApiError("mime is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  const ext = mime.split("/")[1] || "png";
  console.log(`[GEN] Tripo uploadImage size=${imageBuffer.length} mime=${mime}`);
  const form = new FormData();
  // Copy into a plain ArrayBuffer-backed view — Buffer's ArrayBufferLike
  // (possibly shared) backing store is not a valid BlobPart.
  const bytes = new Uint8Array(imageBuffer);
  form.append("file", new Blob([bytes], { type: mime }), `upload.${ext}`);
  const data = await tripoFetch("files", apiKey, "POST", form, TRIPO_INGEST_TIMEOUT_MS);
  if (typeof data?.file_token !== "string") {
    throw new TripoApiError("Tripo did not return a file token", 0, 502);
  }
  console.log(`[GEN] Tripo image uploaded file_token=${data.file_token}`);
  return data.file_token;
}

/**
 * Upload a source 3D model (GLB) to Tripo (POST /files) and return its
 * file_token. Follow-up endpoints (models/texture, mesh/decimate,
 * animations/rig-check, animations/rig) accept the token as `input`.
 * @param glbBuffer - raw GLB bytes
 * @returns file_token
 */
export async function uploadModel(glbBuffer: Buffer, apiKey: string): Promise<string> {
  if (!Buffer.isBuffer(glbBuffer) || glbBuffer.length === 0) {
    throw new TripoApiError("glbBuffer is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(`[GEN] Tripo uploadModel size=${glbBuffer.length}`);
  // Log the first 4 bytes to confirm GLB magic.
  if (glbBuffer.length >= 4) {
    const magic = glbBuffer.readUInt32LE(0);
    const isGlb = magic === 0x46546C67;
    console.log(`[GEN] Tripo uploadModel magic=0x${magic.toString(16)} glb=${isGlb} head=${glbBuffer.toString("utf-8", 0, Math.min(glbBuffer.length, 8)).replace(/[^\x20-\x7E]/g, ".")}`);
  }
  const form = new FormData();
  // Use Buffer.from to get a fresh, exact-size ArrayBuffer then wrap in Blob.
  // Node.js Buffer's underlying ArrayBuffer may be a slice of a larger pool
  // buffer, which confuses some Blob / FormData implementations.
  const copy = Buffer.from(glbBuffer);
  form.append("file", new Blob([copy], { type: "model/gltf-binary" }), "model.glb");
  const data = await tripoFetch("files", apiKey, "POST", form, TRIPO_INGEST_TIMEOUT_MS);
  if (typeof data?.file_token !== "string") {
    throw new TripoApiError("Tripo did not return a file token", 0, 502);
  }
  console.log(`[GEN] Tripo model uploaded file_token=${data.file_token}`);
  return data.file_token;
}

/**
 * Create an image-to-3D task from a previously uploaded image.
 * @param fileToken - file_token from uploadImage()
 * @returns task_id
 */
export async function createImageTask(
  fileToken: string,
  apiKey: string,
  options: TextureQualityOptions = {},
): Promise<string> {
  if (!fileToken || typeof fileToken !== "string") {
    throw new TripoApiError("fileToken is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(
    `[GEN] Tripo createImageTask file_token=${fileToken} tq=${options.textureQuality || "standard"}`,
  );
  const data = await tripoFetch("generation/image-to-model", apiKey, "POST", {
    file: { file_token: fileToken },
    model: TRIPO_MODEL_VERSION,
    texture: true,
    pbr: true,
    auto_size: true,
    ...textureQualityField(options),
  });
  if (typeof data.task_id !== "string") {
    throw new TripoApiError("Tripo did not return a task ID", 0, 502);
  }
  console.log(`[GEN] Tripo image task created task_id=${data.task_id}`);
  return data.task_id;
}

/** Multiview views in the canonical order Tripo's inputs array follows. */
const MULTIVIEW_VIEWS = ["front", "left", "back", "right"] as const;

type MultiviewView = (typeof MULTIVIEW_VIEWS)[number];

/**
 * Create a multiview image-to-3D task (POST /generation/multiview-to-model)
 * from previously uploaded view images. 2–4 views of the same subject; the
 * front view is mandatory.
 * @param viewTokens - file_token per view, from uploadImage()
 * @returns task_id
 */
export async function createMultiviewTask(
  viewTokens: MultiviewViewTokens,
  apiKey: string,
  options: TextureQualityOptions = {},
): Promise<string> {
  if (!viewTokens || typeof viewTokens !== "object") {
    throw new TripoApiError("viewTokens is required", 0, 400);
  }
  const unknown = Object.keys(viewTokens).filter(
    (k) => !MULTIVIEW_VIEWS.includes(k as MultiviewView),
  );
  if (unknown.length > 0) {
    throw new TripoApiError(
      `Unknown multiview view(s): ${unknown.join(", ")}`,
      0,
      400,
    );
  }
  if (!viewTokens.front || typeof viewTokens.front !== "string") {
    throw new TripoApiError("multiview requires a front view", 0, 400);
  }
  const present = MULTIVIEW_VIEWS.filter((v) => viewTokens[v]);
  if (present.length < 2) {
    throw new TripoApiError("multiview requires at least 2 views", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(
    `[GEN] Tripo createMultiviewTask views=${present.join(",")} tq=${options.textureQuality || "standard"}`,
  );
  const data = await tripoFetch("generation/multiview-to-model", apiKey, "POST", {
    // View-key array in canonical order: [{front: t}, {left: t}, ...].
    inputs: present.map((v) => ({ [v]: viewTokens[v] })),
    model: TRIPO_MODEL_VERSION,
    texture: true,
    pbr: true,
    auto_size: true,
    ...textureQualityField(options),
  });
  if (typeof data.task_id !== "string") {
    throw new TripoApiError("Tripo did not return a task ID", 0, 502);
  }
  console.log(`[GEN] Tripo multiview task created task_id=${data.task_id}`);
  return data.task_id;
}

/**
 * Refine an existing model's texture/material via a text prompt.
 * Uses the v3 re-texture endpoint (POST /models/texture) — geometry is
 * unchanged. (Tripo's refine_model endpoint is dead upstream, code 2006,
 * verified 2026-07-22.)
 * @param fileToken - file_token from uploadModel()
 * @returns task_id
 */
export async function createRefineTask(
  prompt: string,
  fileToken: string,
  apiKey: string,
  options: TextureQualityOptions = {},
): Promise<string> {
  if (!prompt || typeof prompt !== "string") {
    throw new TripoApiError("prompt is required", 0, 400);
  }
  if (!fileToken || typeof fileToken !== "string") {
    throw new TripoApiError("fileToken is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(`[GEN] Tripo refine prompt_len=${prompt.length}`);
  const data = await tripoFetch("models/texture", apiKey, "POST", {
    input: fileToken,
    text_prompt: prompt,
    texture: true,
    pbr: true,
    ...textureQualityField(options),
  }, TRIPO_INGEST_TIMEOUT_MS);
  if (typeof data.task_id !== "string") {
    throw new TripoApiError("Tripo did not return a task ID", 0, 502);
  }
  console.log(`[GEN] Tripo refine task created task_id=${data.task_id}`);
  return data.task_id;
}

/**
 * Create a smart-retopology task (POST /mesh/decimate, model v2.0): rebuilds
 * the model with clean topology and textures baked onto the low-poly.
 * Intended as the "animation-ready" step between generation and the rig
 * chain. Costs 30 credits per call.
 *
 * NOTE: quad defaults to false on purpose — glTF only stores triangles, so
 * Tripo forces FBX output when quad=true, and the frontend cannot load FBX.
 * The triangulated smart-retopo mesh is what the glTF pipeline needs.
 * @param fileToken - file_token from uploadModel()
 * @returns task_id
 */
export async function decimateTask(
  fileToken: string,
  apiKey: string,
  options: DecimateOptions = {},
): Promise<string> {
  if (!fileToken || typeof fileToken !== "string") {
    throw new TripoApiError("fileToken is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  const { faceLimit, quad = false } = options;
  console.log(
    `[GEN] Tripo decimateTask input=${fileToken} quad=${quad} face_limit=${faceLimit ?? "adaptive"}`,
  );
  const data = await tripoFetch("mesh/decimate", apiKey, "POST", {
    input: fileToken,
    model: "v2.0",
    quad,
    bake: true,
    ...(faceLimit && { face_limit: faceLimit }),
  }, TRIPO_INGEST_TIMEOUT_MS);
  if (typeof data.task_id !== "string") {
    throw new TripoApiError("Tripo did not return a task ID", 0, 502);
  }
  console.log(`[GEN] Tripo decimate task created task_id=${data.task_id}`);
  return data.task_id;
}

/**
 * Create a rig-check task: is the model riggable, and which skeleton type?
 * @param fileToken - file_token from uploadModel()
 * @returns task_id
 */
export async function rigCheckTask(fileToken: string, apiKey: string): Promise<string> {
  if (!fileToken || typeof fileToken !== "string") {
    throw new TripoApiError("fileToken is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(`[GEN] Tripo rigCheckTask input=${fileToken}`);
  const data = await tripoFetch("animations/rig-check", apiKey, "POST", {
    input: fileToken,
  }, TRIPO_INGEST_TIMEOUT_MS);
  if (typeof data.task_id !== "string") {
    throw new TripoApiError("Tripo did not return a task ID", 0, 502);
  }
  return data.task_id;
}

/**
 * Create a rig task: attach a skeleton to a model.
 * Bipeds try the humanoid rig line (TRIPO_RIG_BIPED_MODEL) first and fall
 * back to the generic line (TRIPO_RIG_MODEL) when Tripo rejects it (code
 * 1004 — the biped line was retired once before). Creatures always use the
 * generic line. The returned model tells the retarget step which preset
 * namespace the rig accepts (v1.0 biped rigs need `preset:biped:*`).
 *
 * `spec` stays "tripo" (Tripo-native bone naming): retarget rejects rigs
 * built with `spec: "mixamo"` — code 1004, "不支持mixamo骨骼的retarget"
 * (mixamo-skeleton retarget not supported), observed live 2026-08-06.
 * @param fileToken - file_token from uploadModel()
 * @param rigType - from rig-check output, e.g. "biped"
 * @returns task_id + rig model used
 */
export async function rigModelTask(
  fileToken: string,
  rigType: string,
  apiKey: string,
  options: RigModelOptions = {},
): Promise<{ taskId: string; model: string }> {
  if (!fileToken || typeof fileToken !== "string") {
    throw new TripoApiError("fileToken is required", 0, 400);
  }
  if (!rigType || typeof rigType !== "string") {
    throw new TripoApiError("rigType is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  // Explicit model override — skip auto-select and fallback entirely.
  if (options.model) {
    console.log(
      `[GEN] Tripo rigModelTask input=${fileToken} rig_type=${rigType} model=${options.model} (explicit)`,
    );
    const data = await tripoFetch("animations/rig", apiKey, "POST", {
      input: fileToken,
      rig_type: rigType,
      spec: "tripo",
      model: options.model,
    }, TRIPO_INGEST_TIMEOUT_MS);
    if (typeof data.task_id !== "string") {
      throw new TripoApiError("Tripo did not return a task ID", 0, 502);
    }
    return { taskId: data.task_id, model: options.model };
  }
  const preferred = rigType === "biped" ? TRIPO_RIG_BIPED_MODEL : TRIPO_RIG_MODEL;
  const candidates =
    preferred === TRIPO_RIG_MODEL ? [preferred] : [preferred, TRIPO_RIG_MODEL];
  let lastError: TripoApiError | null = null;
  for (const model of candidates) {
    try {
      console.log(
        `[GEN] Tripo rigModelTask input=${fileToken} rig_type=${rigType} model=${model}`,
      );
      const data = await tripoFetch("animations/rig", apiKey, "POST", {
        input: fileToken,
        rig_type: rigType,
        spec: "tripo",
        model,
      }, TRIPO_INGEST_TIMEOUT_MS);
      if (typeof data.task_id !== "string") {
        throw new TripoApiError("Tripo did not return a task ID", 0, 502);
      }
      return { taskId: data.task_id, model };
    } catch (e) {
      const err = e as TripoApiError;
      // 1004 = model version rejected/retired — try the next candidate.
      if (err.code !== 1004 || model === candidates[candidates.length - 1]) {
        throw err;
      }
      console.log(
        `[GEN] Tripo rig model ${model} rejected (1004) - falling back to ${TRIPO_RIG_MODEL}`,
      );
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Create a retarget task: bake preset animations into an animated GLB.
 * @param rigTaskId - completed rig task ID
 * @param animations - preset IDs, e.g. ["preset:idle"], max 5
 * @returns task_id
 */
export async function retargetTask(
  rigTaskId: string,
  animations: string[],
  apiKey: string,
  options: RetargetOptions = {},
): Promise<string> {
  if (!rigTaskId || typeof rigTaskId !== "string") {
    throw new TripoApiError("rigTaskId is required", 0, 400);
  }
  if (!Array.isArray(animations) || animations.length === 0) {
    throw new TripoApiError("animations is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  // v1.0 biped rigs use the preset:biped:* namespace; generic (v2.5) rigs
  // take the short form. Map only the short form, never double-prefix.
  const isBipedV1 = options.rigModel === TRIPO_RIG_BIPED_MODEL;
  // A KNOWN generic (v2.5) rig can't take biped-library presets — fail with
  // a clear message instead of Tripo's opaque validation error.
  if (!isBipedV1 && options.rigModel === TRIPO_RIG_MODEL) {
    const bipedOnly = animations.find((a) => a.startsWith("preset:biped:"));
    if (bipedOnly) {
      throw new TripoApiError(
        `Animation "${bipedOnly}" requires the v1.0 biped rig — the generic rig supports only idle/walk/run/dive/climb/jump/slash/shoot/hurt/fall/turn.`,
        0,
        400,
      );
    }
  }
  const presets = isBipedV1
    ? animations.map((a) =>
        a.startsWith("preset:biped:") ? a : a.replace(/^preset:/, "preset:biped:"),
      )
    : animations;
  console.log(
    `[GEN] Tripo retargetTask input=${rigTaskId} animations=${presets.join(",")} inPlace=${Boolean(options.animateInPlace)}`,
  );
  const data = await tripoFetch("animations/retarget", apiKey, "POST", {
    input: rigTaskId,
    animations: presets,
    out_format: "glb",
    ...(options.animateInPlace && { animate_in_place: true }),
  });
  if (typeof data.task_id !== "string") {
    throw new TripoApiError("Tripo did not return a task ID", 0, 502);
  }
  return data.task_id;
}

/**
 * Best-effort cancel of a running Tripo task. Tripo documents the
 * `cancelled` task status but (as of 2026-08) no public cancel endpoint —
 * the POST is tolerated to fail; callers must treat cancellation as
 * local-only (stop polling, discard the result).
 * @returns true when Tripo accepted the cancel
 */
export async function cancelTask(taskId: string, apiKey: string): Promise<boolean> {
  if (!taskId || typeof taskId !== "string") {
    throw new TripoApiError("taskId is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(`[GEN] Tripo cancel task_id=${taskId}`);
  try {
    await tripoFetch(`tasks/${taskId}/cancel`, apiKey, "POST");
    console.log(`[GEN] Tripo cancel accepted task_id=${taskId}`);
    return true;
  } catch (e) {
    const err = e as Error;
    console.log(
      `[GEN] Tripo cancel unsupported/failed task_id=${taskId}: ${err.message}`,
    );
    return false;
  }
}

/**
 * Poll a task.
 */
export async function pollTask(taskId: string, apiKey: string): Promise<TripoPollResult> {
  if (!taskId || typeof taskId !== "string") {
    throw new TripoApiError("taskId is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(`[GEN] Tripo poll task_id=${taskId}`);
  const data = await tripoFetch(`tasks/${taskId}`, apiKey);
  const status = data.status;
  if (status === "queued" || status === "running") {
    console.log(`[GEN] Tripo poll status=${status} progress=${data.progress ?? 0}`);
    return { status, progress: data.progress ?? 0 };
  }
  console.log(`[GEN] Tripo poll status=${status}`);
  if (status === "success") {
    const glbUrl =
      data.output?.model_url ||
      data.output?.pbr_model ||
      data.output?.model ||
      data.output?.base_model;
    // Rig-check tasks carry flags instead of a model — output is returned
    // either way so chain callers can inspect it.
    return { status, glbUrl: glbUrl || undefined, output: data.output };
  }
  // v3 terminal failures: failed, cancelled, banned, expired. Tripo reports
  // error_code + error_message on these — surface both; falling back to the
  // bare status loses the entire diagnosis.
  if (
    status === "failed" ||
    status === "cancelled" ||
    status === "banned" ||
    status === "expired"
  ) {
    const errorCode =
      typeof data.error_code === "number" ? data.error_code : null;
    const errorMessage =
      data.error_message || data.error_msg || data.message || null;
    console.log(
      `[GEN] Tripo poll status=${status} error_code=${errorCode ?? "-"} message=${errorMessage ?? "-"}`,
    );
    const detail = errorMessage || `Task ${status}`;
    return {
      status: "failed",
      error: errorCode !== null ? `${detail} (Tripo error ${errorCode})` : detail,
    };
  }
  throw new TripoApiError(`Unknown Tripo status: ${status}`, 0, 502);
}

/**
 * Download the generated GLB.
 */
export async function downloadModel(glbUrl: string): Promise<Buffer> {
  if (!glbUrl || typeof glbUrl !== "string") {
    throw new TripoApiError("glbUrl is required", 0, 400);
  }
  console.log(`[GEN] Tripo download url_len=${glbUrl.length}`);
  // NOTE: never put glbUrl in an error message — it is a signed URL whose
  // query string carries the access credentials.
  let res: Response;
  try {
    res = await fetch(glbUrl, { signal: AbortSignal.timeout(240_000) });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new TripoApiError("Tripo model download timed out after 240s", 0, 502);
    }
    throw new TripoApiError(`Tripo model download failed: ${err.message}`, 0, 502);
  }
  if (!res.ok) {
    throw new TripoApiError(`Model download failed: HTTP ${res.status}`, 0, 502);
  }
  const ab = await res.arrayBuffer();
  if (!ab || ab.byteLength === 0) {
    throw new TripoApiError("Downloaded model is empty", 0, 502);
  }
  console.log(`[GEN] Tripo download size=${ab.byteLength}`);
  return Buffer.from(ab);
}
