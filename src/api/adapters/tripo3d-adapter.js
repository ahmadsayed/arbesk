export const TRIPO_API_BASE = "https://api.tripo3d.ai/v2/openapi";
export const TRIPO_MODEL_VERSION = process.env.TRIPO_3D_MODEL || "v2.5-20250123";

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
 * Low-level fetch wrapper for Tripo v2.
 * @param {string} path - path after base, e.g. "task"
 * @param {string} apiKey
 * @param {"GET"|"POST"} method
 * @param {object} [body]
 */
async function tripoFetch(path, apiKey, method = "GET", body) {
  /** @type {{method: string, headers: Record<string, string>, body?: string, signal: AbortSignal}} */
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    // A stalled upstream connection must not hang the Express request.
    signal: AbortSignal.timeout(30_000),
  };
  if (body) opts.body = JSON.stringify(body);

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
 * Create a text-to-3D task.
 * @param {string} prompt
 * @param {string} apiKey
 * @returns {Promise<string>} task_id
 */
export async function createTask(prompt, apiKey) {
  if (!prompt || typeof prompt !== "string") {
    throw new TripoApiError("prompt is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(`[GEN] Tripo createTask prompt_len=${prompt.length}`);
  const data = await tripoFetch("task", apiKey, "POST", {
    type: "text_to_model",
    prompt,
    model_version: TRIPO_MODEL_VERSION,
    texture: true,
    pbr: true,
  });
  if (typeof data.task_id !== "string") {
    throw new TripoApiError("Tripo did not return a task ID", 0, 502);
  }
  console.log(`[GEN] Tripo task created task_id=${data.task_id}`);
  return data.task_id;
}

/**
 * Refine an existing model's texture/material via a text prompt.
 * NOTE: Tripo's refine_model endpoint is dead upstream (code 2006, verified
 * 2026-07-22); this uses texture_model — geometry is unchanged.
 * @param {string} prompt
 * @param {string} originalTripoTaskId - Tripo task ID of the completed source generation
 * @param {string} apiKey
 * @returns {Promise<string>} task_id
 */
export async function createRefineTask(prompt, originalTripoTaskId, apiKey) {
  if (!prompt || typeof prompt !== "string") {
    throw new TripoApiError("prompt is required", 0, 400);
  }
  if (!originalTripoTaskId || typeof originalTripoTaskId !== "string") {
    throw new TripoApiError("originalTripoTaskId is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(`[GEN] Tripo refine prompt_len=${prompt.length}`);
  const data = await tripoFetch("task", apiKey, "POST", {
    type: "texture_model",
    original_model_task_id: originalTripoTaskId,
    text_prompt: prompt,
    texture: true,
    pbr: true,
  });
  if (typeof data.task_id !== "string") {
    throw new TripoApiError("Tripo did not return a task ID", 0, 502);
  }
  console.log(`[GEN] Tripo refine task created task_id=${data.task_id}`);
  return data.task_id;
}

/**
 * Poll a task.
 * @param {string} taskId
 * @param {string} apiKey
 * @returns {Promise<{status: string, progress?: number, glbUrl?: string, error?: string}>}
 */
export async function pollTask(taskId, apiKey) {
  if (!taskId || typeof taskId !== "string") {
    throw new TripoApiError("taskId is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(`[GEN] Tripo poll task_id=${taskId}`);
  const data = await tripoFetch(`task/${taskId}`, apiKey);
  const status = data.status;
  console.log(`[GEN] Tripo poll status=${status}`);
  if (status === "queued" || status === "running") {
    return { status, progress: data.progress ?? 0 };
  }
  if (status === "success") {
    const glbUrl = data.output?.pbr_model || data.output?.model;
    if (!glbUrl) {
      throw new TripoApiError("Tripo success response missing model URL", 0, 502);
    }
    return { status, glbUrl };
  }
  if (status === "failed" || status === "cancelled") {
    return { status: "failed", error: data.message || `Task ${status}` };
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
