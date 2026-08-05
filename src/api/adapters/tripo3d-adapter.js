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
 * 30s — observed live with a 41 MB rig-check source (2026-08-06).
 */
const TRIPO_INGEST_TIMEOUT_MS = 120_000;

export class TripoApiError extends Error {
  /**
   * @param {string} message
   * @param {number} code - Tripo API error code
   * @param {number} [status=500] - HTTP status to return to the browser
   */
  constructor(message, code, status = 500) {
    super(message);
    this.name = "TripoApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Low-level fetch wrapper for the Tripo v3 API.
 * @param {string} path - path after base, e.g. "generation/text-to-model"
 * @param {string} apiKey
 * @param {"GET"|"POST"} method
 * @param {object|FormData} [body] - plain object (JSON) or FormData (multipart)
 * @param {number} [timeoutMs=30_000] - upstream timeout; file-ingesting
 *   task-creation endpoints (rig-check, rig, decimate, texture) pass more,
 *   because Tripo ingests the uploaded model before answering
 */
async function tripoFetch(path, apiKey, method = "GET", body, timeoutMs = 30_000) {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  /** @type {{method: string, headers: Record<string, string>, body?: string|FormData, signal: AbortSignal}} */
  const opts = {
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

  const res = await fetch(`${TRIPO_API_BASE}/${path}`, opts);
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
  const json = /** @type {{code?: number, message?: string, data?: any}} */ (
    await res.json().catch(() => ({}))
  );
  if (json.code !== 0) {
    const code = json.code ?? 0;
    const status = mapTripoCodeToHttp(code);
    throw new TripoApiError(json.message || "Tripo provider error", code, status);
  }
  return json.data;
}

/**
 * @param {number} code
 * @returns {number}
 */
function mapTripoCodeToHttp(code) {
  // 1002 = auth failed, 2010 = insufficient credits
  if (code === 1002) return 401;
  if (code === 2010) return 402;
  return 502;
}

/**
 * Map the textureQuality option to Tripo's texture_quality field.
 * "standard" is Tripo's default — omitting the field keeps payloads minimal.
 * @param {{textureQuality?: string}} options
 * @returns {object}
 */
function textureQualityField(options) {
  const q = options.textureQuality;
  return q && q !== "standard" && TEXTURE_QUALITIES.includes(q)
    ? { texture_quality: q }
    : {};
}

/**
 * Create a text-to-3D task.
 * @param {string} prompt
 * @param {string} apiKey
 * @param {object} [options]
 * @param {string} [options.textureQuality="standard"] - one of TEXTURE_QUALITIES
 * @returns {Promise<string>} task_id
 */
export async function createTask(prompt, apiKey, options = {}) {
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
 * @param {string} apiKey
 * @returns {Promise<{balance: number, frozen: number}>}
 */
export async function getBalance(apiKey) {
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
 * @param {Buffer} imageBuffer - raw image bytes (jpeg/png/webp)
 * @param {string} mime - image MIME type, e.g. "image/png"
 * @param {string} apiKey
 * @returns {Promise<string>} file_token
 */
export async function uploadImage(imageBuffer, mime, apiKey) {
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
 * @param {Buffer} glbBuffer - raw GLB bytes
 * @param {string} apiKey
 * @returns {Promise<string>} file_token
 */
export async function uploadModel(glbBuffer, apiKey) {
  if (!Buffer.isBuffer(glbBuffer) || glbBuffer.length === 0) {
    throw new TripoApiError("glbBuffer is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(`[GEN] Tripo uploadModel size=${glbBuffer.length}`);
  const form = new FormData();
  // Copy into a plain ArrayBuffer-backed view — Buffer's ArrayBufferLike
  // (possibly shared) backing store is not a valid BlobPart.
  const bytes = new Uint8Array(glbBuffer);
  form.append("file", new Blob([bytes], { type: "model/gltf-binary" }), "model.glb");
  const data = await tripoFetch("files", apiKey, "POST", form, TRIPO_INGEST_TIMEOUT_MS);
  if (typeof data?.file_token !== "string") {
    throw new TripoApiError("Tripo did not return a file token", 0, 502);
  }
  console.log(`[GEN] Tripo model uploaded file_token=${data.file_token}`);
  return data.file_token;
}

/**
 * Create an image-to-3D task from a previously uploaded image.
 * @param {string} fileToken - file_token from uploadImage()
 * @param {string} apiKey
 * @param {object} [options]
 * @param {string} [options.textureQuality="standard"] - one of TEXTURE_QUALITIES
 * @returns {Promise<string>} task_id
 */
export async function createImageTask(fileToken, apiKey, options = {}) {
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

/**
 * Refine an existing model's texture/material via a text prompt.
 * Uses the v3 re-texture endpoint (POST /models/texture) — geometry is
 * unchanged. (Tripo's refine_model endpoint is dead upstream, code 2006,
 * verified 2026-07-22.)
 * @param {string} prompt
 * @param {string} fileToken - file_token from uploadModel()
 * @param {string} apiKey
 * @param {object} [options]
 * @param {string} [options.textureQuality="standard"] - one of TEXTURE_QUALITIES
 * @returns {Promise<string>} task_id
 */
export async function createRefineTask(prompt, fileToken, apiKey, options = {}) {
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
 * @param {string} fileToken - file_token from uploadModel()
 * @param {string} apiKey
 * @param {object} [options]
 * @param {number} [options.faceLimit] - target faces (500–20,000); adaptive when omitted
 * @param {boolean} [options.quad=false] - quad mesh (forces FBX output!)
 * @returns {Promise<string>} task_id
 */
export async function decimateTask(fileToken, apiKey, options = {}) {
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
 * @param {string} fileToken - file_token from uploadModel()
 * @param {string} apiKey
 * @returns {Promise<string>} task_id
 */
export async function rigCheckTask(fileToken, apiKey) {
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
 * Create a rig task: attach a Mixamo-compatible skeleton to a model.
 * Bipeds try the humanoid rig line (TRIPO_RIG_BIPED_MODEL) first and fall
 * back to the generic line (TRIPO_RIG_MODEL) when Tripo rejects it (code
 * 1004 — the biped line was retired once before). Creatures always use the
 * generic line. The returned model tells the retarget step which preset
 * namespace the rig accepts (v1.0 biped rigs need `preset:biped:*`).
 * @param {string} fileToken - file_token from uploadModel()
 * @param {string} rigType - from rig-check output, e.g. "biped"
 * @param {string} apiKey
 * @returns {Promise<{taskId: string, model: string}>} task_id + rig model used
 */
export async function rigModelTask(fileToken, rigType, apiKey) {
  if (!fileToken || typeof fileToken !== "string") {
    throw new TripoApiError("fileToken is required", 0, 400);
  }
  if (!rigType || typeof rigType !== "string") {
    throw new TripoApiError("rigType is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  const preferred = rigType === "biped" ? TRIPO_RIG_BIPED_MODEL : TRIPO_RIG_MODEL;
  const candidates =
    preferred === TRIPO_RIG_MODEL ? [preferred] : [preferred, TRIPO_RIG_MODEL];
  let lastError = null;
  for (const model of candidates) {
    try {
      console.log(
        `[GEN] Tripo rigModelTask input=${fileToken} rig_type=${rigType} model=${model}`,
      );
      const data = await tripoFetch("animations/rig", apiKey, "POST", {
        input: fileToken,
        rig_type: rigType,
        spec: "mixamo",
        model,
      }, TRIPO_INGEST_TIMEOUT_MS);
      if (typeof data.task_id !== "string") {
        throw new TripoApiError("Tripo did not return a task ID", 0, 502);
      }
      return { taskId: data.task_id, model };
    } catch (e) {
      const err = /** @type {TripoApiError} */ (e);
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
 * @param {string} rigTaskId - completed rig task ID
 * @param {string[]} animations - preset IDs, e.g. ["preset:idle"], max 5
 * @param {string} apiKey
 * @param {object} [options]
 * @param {boolean} [options.animateInPlace=false] - play in place, no root displacement
 * @param {string} [options.rigModel] - rig model that produced rigTaskId;
 *   v1.0 biped rigs take `preset:biped:*` IDs, so generic presets are mapped
 * @returns {Promise<string>} task_id
 */
export async function retargetTask(rigTaskId, animations, apiKey, options = {}) {
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
 * @param {string} taskId
 * @param {string} apiKey
 * @returns {Promise<boolean>} true when Tripo accepted the cancel
 */
export async function cancelTask(taskId, apiKey) {
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
    const err = /** @type {Error} */ (e);
    console.log(
      `[GEN] Tripo cancel unsupported/failed task_id=${taskId}: ${err.message}`,
    );
    return false;
  }
}

/**
 * Poll a task.
 * @param {string} taskId
 * @param {string} apiKey
 * @returns {Promise<{status: string, progress?: number, glbUrl?: string, output?: object, error?: string}>}
 */
export async function pollTask(taskId, apiKey) {
  if (!taskId || typeof taskId !== "string") {
    throw new TripoApiError("taskId is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(`[GEN] Tripo poll task_id=${taskId}`);
  const data = await tripoFetch(`tasks/${taskId}`, apiKey);
  const status = data.status;
  console.log(`[GEN] Tripo poll status=${status}`);
  if (status === "queued" || status === "running") {
    return { status, progress: data.progress ?? 0 };
  }
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
  // v3 terminal failures: failed, cancelled, banned, expired
  if (
    status === "failed" ||
    status === "cancelled" ||
    status === "banned" ||
    status === "expired"
  ) {
    return {
      status: "failed",
      error: data.error_msg || data.message || `Task ${status}`,
    };
  }
  throw new TripoApiError(`Unknown Tripo status: ${status}`, 0, 502);
}

/**
 * Download the generated GLB.
 * @param {string} glbUrl
 * @returns {Promise<Buffer>}
 */
export async function downloadModel(glbUrl) {
  if (!glbUrl || typeof glbUrl !== "string") {
    throw new TripoApiError("glbUrl is required", 0, 400);
  }
  console.log(`[GEN] Tripo download url_len=${glbUrl.length}`);
  const res = await fetch(glbUrl, { signal: AbortSignal.timeout(120_000) });
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
