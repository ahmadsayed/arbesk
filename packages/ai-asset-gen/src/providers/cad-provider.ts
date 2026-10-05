/**
 * CAD provider — design-on-the-wire.
 * @remarks textToModel returns a cad-<uuid> taskId immediately and runs the
 *   injected CadGenerator in-process; poll reports running → success with
 *   the CadGenerateResult in `output` (format "cad-design"), or failed.
 *   The task store is module-level, not per instance: the generations route
 *   rebuilds the provider per request from env (CAD has no BYOK key to
 *   reconstruct with), so the store must outlive any provider instance —
 *   the same process-lifetime guarantee as the route's task registry.
 *   Quota is deliberately NOT handled here: the route owns metering through
 *   the onSettle callback (release the slot; refund CAD_REQUEST_UNSUITABLE).
 */
import type { CadGenerator, CadGenerateResult } from "@arbesk/cad-gen/backend/index.js";
import { CadRequestUnsuitable } from "@arbesk/cad-gen";
import type { CadDesign } from "@arbesk/cad-gen";
import type { GenerationConfig, GenerationProvider } from "../facade.ts";
import type { GenerationCapability } from "../types.ts";
import { requireCapability } from "../errors.ts";

export interface CadSettleError {
  message: string;
  code?: string;
  suitability?: number;
  alternative?: unknown;
}

export type CadSettleOutcome =
  | { ok: true; result: CadGenerateResult }
  | { ok: false; error: CadSettleError };

export interface CadProviderOptions {
  /** Facade config: id ("cad") + the declared capability set (text-to-3d). */
  config: GenerationConfig;
  /** Injected CAD generator, built from env at the composition root. */
  generator: CadGenerator;
  /** Invoked exactly once per task when the generate call settles. */
  onSettle?: (taskId: string, outcome: CadSettleOutcome) => void;
}

/** The wire shape of a succeeded CAD task (also what download() returns). */
export function cadWireResult(result: CadGenerateResult) {
  return {
    design: result.design,
    runtime: result.runtime,
    provider: result.provider,
    attribution: result.attribution,
    diagnostics: result.diagnostics,
  };
}

interface CadTaskState {
  createdAt: number;
  prompt: string;
  priorDesign?: CadDesign;
  controller: AbortController;
  result?: CadGenerateResult;
  error?: CadSettleError;
}

/** Same TTL as src/api/generation-tasks.ts; swept lazily on access. */
const TASK_TTL_MS = 60 * 60 * 1000;
const tasks = new Map<string, CadTaskState>();

function liveTask(taskId: string): CadTaskState | undefined {
  const state = tasks.get(taskId);
  if (!state) return undefined;
  if (Date.now() - state.createdAt > TASK_TTL_MS) {
    tasks.delete(taskId);
    return undefined;
  }
  return state;
}

export function createCadProvider({
  config,
  generator,
  onSettle,
}: CadProviderOptions): GenerationProvider {
  const capabilities = new Set(config.capabilities);
  const id = config.id;

  function unsupported(cap: GenerationCapability): never {
    requireCapability(id, capabilities, cap);
    throw new Error("unreachable");
  }

  /** The settle callback must never alter task state or fire twice. */
  function safeSettle(taskId: string, outcome: CadSettleOutcome): void {
    try {
      onSettle?.(taskId, outcome);
    } catch (err) {
      console.error("cad provider onSettle callback threw:", (err as Error).message);
    }
  }

  /** Captures every rejection into task state — nothing escapes unhandled. */
  async function run(taskId: string, state: CadTaskState): Promise<void> {
    try {
      const result = await generator.generate({
        prompt: state.prompt,
        ...(state.priorDesign && { priorDesign: state.priorDesign }),
        signal: state.controller.signal,
      });
      state.result = result;
      safeSettle(taskId, { ok: true, result });
    } catch (err) {
      const e = err as Error & { suitability?: number; alternative?: unknown };
      state.error = e instanceof CadRequestUnsuitable
        ? {
            message: e.message,
            code: "CAD_REQUEST_UNSUITABLE",
            suitability: e.suitability,
            alternative: e.alternative,
          }
        : { message: e.message };
      safeSettle(taskId, { ok: false, error: state.error });
    }
  }

  return {
    id,
    capabilities,
    can: (cap) => capabilities.has(cap),

    textToModel: async ({ prompt, priorDesign }) => {
      requireCapability(id, capabilities, "text-to-3d");
      const taskId = `cad-${crypto.randomUUID()}`;
      const state: CadTaskState = {
        createdAt: Date.now(),
        prompt,
        ...(priorDesign && { priorDesign }),
        controller: new AbortController(),
      };
      tasks.set(taskId, state);
      // Detached by design: the route answers 202 and the client polls.
      void run(taskId, state);
      return taskId;
    },
    imageToModel: () => unsupported("image-to-3d"),
    multiviewToModel: () => unsupported("multiview-to-3d"),
    uploadSource: () => {
      throw new Error("cad provider has no source upload");
    },
    retexture: () => unsupported("retexture"),
    retopo: () => unsupported("retopo"),
    rigCheck: () => unsupported("rig-check"),
    rig: () => unsupported("rig"),
    animate: () => unsupported("animate"),

    poll: async (taskId) => {
      const state = liveTask(taskId);
      if (!state) return { status: "failed", error: "unknown task" };
      if (state.error) return { status: "failed", error: state.error.message, output: state.error };
      if (state.result) {
        return { status: "success", format: "cad-design", output: state.result };
      }
      return { status: "running", progress: 0 };
    },
    download: async (taskIdOrUrl) => {
      if (/^https?:\/\//i.test(taskIdOrUrl)) {
        throw new Error("cad provider has no URLs - pass the taskId");
      }
      const state = liveTask(taskIdOrUrl);
      if (!state?.result) throw new Error("unknown task or task not complete");
      return new TextEncoder().encode(JSON.stringify(cadWireResult(state.result)));
    },
    cancel: async (taskId) => {
      const state = tasks.get(taskId);
      if (!state) return false;
      state.controller.abort();
      tasks.delete(taskId);
      return true;
    },

    getBalance: () => unsupported("balance"),
  };
}
