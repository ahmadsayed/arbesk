/**
 * AI generation for the CLI: every op (text/image/multiview-to-3D, retexture,
 * retopo, rig, animate) goes through the single backend route
 * POST /api/v1/generations with the op selected by body fields; async Tripo3D
 * tasks are polled via GET /api/v1/generations/:taskId. The generation
 * intelligence lives server-side — this module is only the HTTP + poll glue.
 */
import { resolveCompositeSourceCid } from "@arbesk/asset-core/catalog/index.js";
import { BACKEND_URL } from "./config.ts";
import { getManifest } from "./catalog.ts";
import { debug, trace } from "./debug.ts";
import type { Session } from "./session.ts";

export interface GeneratedModel {
  bytes: Uint8Array;
  format: string;
  path?: string;
}

export interface GenerationBody {
  nodeId: string;
  prompt?: string;
  provider?: string;
  providerKey?: string;
  textureQuality?: string;
  imageData?: string;
  imageMime?: string;
  images?: { imageData: string; imageMime: string; view: string }[];
  sourceAssetCid?: string;
  retexture?: boolean;
  retopo?: boolean;
  faceLimit?: number;
  animate?: boolean;
  rigOnly?: boolean;
  animations?: string[];
  animateInPlace?: boolean;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onProgress?: (p: { status: string; progress?: number; stage?: string; taskId?: string }) => void;
}

const DEFAULT_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as Record<string, any>;
    return body?.error?.message ?? "HTTP " + res.status;
  } catch {
    return "HTTP " + res.status;
  }
}

function decodeResult(body: Record<string, any>): GeneratedModel {
  return {
    bytes: new Uint8Array(Buffer.from(String(body.assetData), "base64")),
    format: String(body.format ?? "glb"),
    path: body.path as string | undefined,
  };
}

/**
 * POST a generation request. Sync providers (mock) return the result payload
 * directly; async providers return 202 { taskId } and the task is polled until
 * success/failure. Terminal failures arrive as HTTP 200 with status "failed" —
 * the body is authoritative, not the status code.
 */
export async function runGeneration(
  session: Session,
  body: GenerationBody,
  poll: PollOptions = {},
): Promise<GeneratedModel> {
  const op =
    body.retexture ? "retexture" :
    body.retopo ? "retopo" :
    body.animate ? (body.rigOnly ? "rig" : "animate") :
    "generate";
  return trace("generation " + op + " node=" + body.nodeId, async () => {
    const res = await fetch(BACKEND_URL + "/api/v1/generations", {
      method: "POST",
      headers: {
        Authorization: "Session " + session.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 202) throw new Error(await errorMessage(res));
    const payload = (await res.json()) as Record<string, any>;
    if (!payload.taskId) {
      debug("generation completed synchronously");
      return decodeResult(payload);
    }

    const taskId = String(payload.taskId);
    debug("generation task:", taskId);
    poll.onProgress?.({ status: "running", taskId });
    const intervalMs = poll.intervalMs ?? DEFAULT_INTERVAL_MS;
    const deadline = Date.now() + (poll.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    for (;;) {
      if (Date.now() > deadline) {
        throw new Error("Generation timed out (task " + taskId + ")");
      }
      await sleep(intervalMs);
      const statusRes = await fetch(BACKEND_URL + "/api/v1/generations/" + taskId, {
        headers: { Authorization: "Session " + session.token },
      });
      if (!statusRes.ok) throw new Error(await errorMessage(statusRes));
      const status = (await statusRes.json()) as Record<string, any>;
      debug("poll", taskId + ":", status.status, status.progress ?? "", status.stage ?? "");
      if (status.status === "success") return decodeResult(status);
      if (status.status === "failed") {
        throw new Error((status as any).error?.message ?? "Generation failed");
      }
      poll.onProgress?.({
        status: String(status.status),
        progress: status.progress as number | undefined,
        stage: status.stage as string | undefined,
      });
    }
  });
}

/** Best-effort cancel of an in-flight task (credits already consumed are lost). */
export async function cancelGeneration(
  session: Session,
  taskId: string,
): Promise<{ status: string; upstreamCancelled?: boolean }> {
  debug("cancel generation task:", taskId);
  const res = await fetch(BACKEND_URL + "/api/v1/generations/" + taskId, {
    method: "DELETE",
    headers: { Authorization: "Session " + session.token },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as { status: string; upstreamCancelled?: boolean };
}

/** Tripo3D credit balance for a BYOK key. */
export async function getProviderBalance(
  session: Session,
  providerKey: string,
): Promise<{ balance: number; frozen: number }> {
  const res = await fetch(BACKEND_URL + "/api/v1/generations/balance", {
    method: "POST",
    headers: {
      Authorization: "Session " + session.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ providerKey }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as { balance: number; frozen: number };
}

/**
 * Resolve a collection entry CID to the composite source CID the backend's
 * sourceAssetCid expects: Studio assets wrap the composite glTF in an asset
 * manifest; CLI uploads store the composite directly.
 */
export async function resolveSourceCid(cid: string): Promise<string> {
  const m = (await getManifest(cid)) as Record<string, any>;
  return resolveCompositeSourceCid(m) ?? cid;
}
