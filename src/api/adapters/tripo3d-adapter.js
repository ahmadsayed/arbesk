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
  /** @type {{method: string, headers: Record<string, string>, body?: string}} */
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${TRIPO_API_BASE}/${path}`, opts);
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
  return data.task_id;
}

/**
 * Poll a task.
 * @param {string} taskId
 * @param {string} apiKey
 * @returns {Promise<{status: string, progress?: number, glbUrl?: string, error?: string}>}
 */
export async function pollTask(taskId, apiKey) {
  const data = await tripoFetch(`task/${taskId}`, apiKey);
  const status = data.status;
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
  const res = await fetch(glbUrl);
  if (!res.ok) {
    throw new TripoApiError(`Model download failed: HTTP ${res.status}`, 0, 502);
  }
  const ab = await res.arrayBuffer();
  if (!ab || ab.byteLength === 0) {
    throw new TripoApiError("Downloaded model is empty", 0, 502);
  }
  return Buffer.from(ab);
}
