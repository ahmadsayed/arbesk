/**
 * Mock provider — wraps mockGenerate behind the async GenerationProvider
 * facade. Fresh text-to-3D results are held in an in-memory task store, so the
 * uniform start -> poll -> download lifecycle collapses to "immediately
 * success". All non-text capabilities throw UnsupportedCapabilityError.
 */
import type { GenerationConfig, GenerationProvider } from "../facade.ts";
import type { GenerationCapability } from "../types.ts";
import { requireCapability } from "../errors.ts";
import { mockGenerate } from "./mock.ts";

interface MockTask {
  payload: Buffer | string;
  format: string;
  provider: string;
}

export function createMockProvider(config: GenerationConfig): GenerationProvider {
  const tasks = new Map<string, MockTask>();
  const capabilities = new Set(config.capabilities);
  const id = config.id;
  let seq = 0;

  function unsupported(cap: GenerationCapability): never {
    requireCapability(id, capabilities, cap);
    throw new Error("unreachable");
  }

  return {
    id,
    capabilities,
    can: (cap) => capabilities.has(cap),

    textToModel: async ({ prompt }) => {
      requireCapability(id, capabilities, "text-to-3d");
      const result = await mockGenerate(prompt, { provider: id });
      const taskId = "mock-" + (++seq) + "-" + crypto.randomUUID();
      tasks.set(taskId, {
        payload: (result.data ?? result.buffer) as Buffer | string,
        format: result.format || "gltf",
        provider: result.provider || id,
      });
      return Promise.resolve(taskId);
    },
    uploadSource: () => {
      throw new Error("mock provider has no upload");
    },
    imageToModel: () => unsupported("image-to-3d"),
    multiviewToModel: () => unsupported("multiview-to-3d"),
    retexture: () => unsupported("retexture"),
    retopo: () => unsupported("retopo"),
    rigCheck: () => unsupported("rig-check"),
    rig: () => unsupported("rig"),
    animate: () => unsupported("animate"),

    poll: (taskId) => {
      const t = tasks.get(taskId);
      return Promise.resolve(
        t
          ? { status: "success" as const, format: t.format, output: { provider: t.provider } }
          : { status: "failed" as const, error: "unknown task" },
      );
    },
    download: (taskIdOrUrl) => {
      if (/^https?:\/\//i.test(taskIdOrUrl)) {
        throw new Error("mock provider has no URLs - pass the taskId");
      }
      const t = tasks.get(taskIdOrUrl);
      if (!t) throw new Error("unknown task");
      const bytes =
        typeof t.payload === "string"
          ? new TextEncoder().encode(t.payload)
          : new Uint8Array(t.payload);
      return Promise.resolve(bytes);
    },
    cancel: (taskId) => Promise.resolve(tasks.delete(taskId)),

    getBalance: () => unsupported("balance"),
  };
}
