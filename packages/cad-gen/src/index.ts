/**
 * @arbesk/cad-gen — environment-agnostic core.
 * @remarks This entry point MUST stay free of Node and browser globals: the
 *   browser bundles it. Backend-only modules live under ./backend/index.js and
 *   are never reachable from here.
 */
export { CONTRACT_VERSION, PRELUDE_VERSION } from "./core/contract.ts";
export {
  CadError, CadDesignError, CadGenerationFailed, CadGuardError, CadKernelError,
} from "./errors.ts";
export type {
  CadDesign, CadMesh, CadParameter, CadParameterMap,
  CadStats, ManifoldModule, TokenUsage,
} from "./types.ts";
export {
  parseDesign, validateParameterOverrides, referencedIdentifiers,
} from "./core/document.ts";
export { ATTRIBUTED_HELPERS, attributionsFor } from "./core/attribution.ts";
export type { Attribution } from "./core/attribution.ts";
export { guardScript } from "./core/guard.ts";
export type { GuardResult } from "./core/guard.ts";
export { evaluateStaticGates, evaluateKernelGates } from "./core/gates.ts";
export type { GateResult, KernelLimits } from "./core/gates.ts";
