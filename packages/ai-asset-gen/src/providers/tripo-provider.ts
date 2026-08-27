/**
 * Tripo3D provider — wraps the raw adapter (./tripo.ts) behind the
 * capability-gated GenerationProvider facade. The BYOK key is captured at
 * composition, so the raw functions' apiKey argument is supplied here.
 */
import type { GenerationConfig, GenerationProvider } from "../facade.ts";
import type { SourceRef, TaskStatus } from "../types.ts";
import { requireCapability } from "../errors.ts";
import {
  createTask,
  createImageTask,
  createMultiviewTask,
  createRefineTask,
  uploadImage,
  uploadModel,
  getBalance,
  decimateTask,
  rigCheckTask,
  rigModelTask,
  retargetTask,
  pollTask,
  downloadModel,
  cancelTask,
  TripoApiError,
} from "./tripo.ts";
import type { MultiviewViewTokens } from "./tripo.ts";

export function createTripoProvider(config: GenerationConfig): GenerationProvider {
  const providedKey = config.apiKey;
  if (!providedKey) throw new Error("tripo3d provider requires an apiKey");
  const apiKey: string = providedKey;
  const sourceResolver = config.sourceResolver;
  const capabilities = new Set(config.capabilities);
  const id = config.id;

  /** Resolve a model SourceRef to a Tripo file_token. */
  async function sourceToken(source: SourceRef): Promise<string> {
    if (source.kind === "fileToken") return source.fileToken;
    if (source.kind === "buffer") return uploadModel(Buffer.from(source.buffer), apiKey);
    if (source.kind === "cid") {
      if (!sourceResolver) throw new Error("cid source requires a sourceResolver");
      return uploadModel(Buffer.from(await sourceResolver(source.cid)), apiKey);
    }
    throw new Error("invalid source ref");
  }

  return {
    id,
    capabilities,
    can: (cap) => capabilities.has(cap),

    textToModel: ({ prompt, textureQuality }) => {
      requireCapability(id, capabilities, "text-to-3d");
      return createTask(prompt, apiKey, { textureQuality });
    },
    imageToModel: async ({ image, mime, textureQuality }) => {
      requireCapability(id, capabilities, "image-to-3d");
      const token = await uploadImage(Buffer.from(image), mime, apiKey);
      return createImageTask(token, apiKey, { textureQuality });
    },
    multiviewToModel: async ({ views, textureQuality }) => {
      requireCapability(id, capabilities, "multiview-to-3d");
      const pairs = await Promise.all(
        views.map(async (v) => ({
          view: v.view,
          token: await uploadImage(Buffer.from(v.image), v.mime, apiKey),
        })),
      );
      const tokens: Record<string, string> = {};
      for (const pair of pairs) tokens[pair.view] = pair.token;
      return createMultiviewTask(tokens as unknown as MultiviewViewTokens, apiKey, {
        textureQuality,
      });
    },
    uploadSource: (source) => sourceToken(source),
    retexture: async ({ prompt, source, textureQuality }) => {
      requireCapability(id, capabilities, "retexture");
      return createRefineTask(prompt, await sourceToken(source), apiKey, { textureQuality });
    },
    retopo: async ({ source, faceLimit, quad }) => {
      requireCapability(id, capabilities, "retopo");
      return decimateTask(await sourceToken(source), apiKey, { faceLimit, quad });
    },
    rigCheck: async ({ source }) => {
      requireCapability(id, capabilities, "rig-check");
      return rigCheckTask(await sourceToken(source), apiKey);
    },
    rig: async ({ source, rigType, model }) => {
      requireCapability(id, capabilities, "rig");
      return rigModelTask(await sourceToken(source), rigType || "biped", apiKey, { model });
    },
    animate: ({ rigTaskId, animations, animateInPlace, rigModel }) => {
      requireCapability(id, capabilities, "animate");
      return retargetTask(rigTaskId, animations, apiKey, { animateInPlace, rigModel });
    },

    poll: async (taskId) => {
      const r = await pollTask(taskId, apiKey);
      return {
        status: r.status as TaskStatus,
        progress: r.progress,
        glbUrl: r.glbUrl,
        output: r.output,
        error: r.error,
      };
    },
    download: async (taskIdOrUrl) => {
      if (/^https?:\/\//i.test(taskIdOrUrl)) return downloadModel(taskIdOrUrl);
      const status = await pollTask(taskIdOrUrl, apiKey);
      if (!status.glbUrl) throw new TripoApiError("task has no model URL", 0, 502);
      return downloadModel(status.glbUrl);
    },
    cancel: (taskId) => cancelTask(taskId, apiKey),

    getBalance: () => {
      requireCapability(id, capabilities, "balance");
      return getBalance(apiKey);
    },
  };
}
