/** @arbesk/cad-gen backend — Node-only. Never imported by the browser. */
export { runValidation } from "./validate-runner.ts";
export type { RunnerOptions, RunnerResult } from "./validate-runner.ts";
export { validateDesign } from "./validate.ts";
export type { ValidateOptions, ValidationOutcome } from "./validate.ts";
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
  CadDiagnostics, CadGenerateInput, CadGenerateResult, CadGenConfig,
  CadGenerator, CadLimits,
} from "./facade.ts";
