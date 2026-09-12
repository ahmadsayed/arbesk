/** @arbesk/cad-gen backend — Node-only. Never imported by the browser. */
// EVALUATION HARNESS - not in the request path. These spawn a child process and
// load manifold.wasm, which is the most expensive step in the pipeline. They
// exist so a design can be built, measured and rendered offline; the runtime
// server uses validateStatic and never touches the kernel.
export { runValidation } from "./validate-runner.ts";
export type { RunnerOptions, RunnerResult } from "./validate-runner.ts";
export { validateDesign } from "./validate.ts";
export type { ValidateOptions, ValidationOutcome } from "./validate.ts";
export { validateStatic } from "./validate.ts";
export { createDeepSeekClient, ProviderError } from "./deepseek.ts";
export type {
  DeepSeekClient, DeepSeekConfig, LlmContentBlock, LlmMessage,
} from "./deepseek.ts";
export {
  SYSTEM_PROMPT, buildTurnMessages, buildRepairMessages, PROMPT_HELPER_NAMES,
} from "./prompt.ts";
export type { TurnInput } from "./prompt.ts";
export { generateWithRepair } from "./repair.ts";
export type { AttemptRecord, RepairDeps, RepairOutcome } from "./repair.ts";
export { createCadGenerator } from "./facade.ts";
export type {
  CadDiagnostics, CadFailure, CadGenerateInput, CadGenerateResult, CadGenConfig,
  CadGenerator, CadLimits,
} from "./facade.ts";
