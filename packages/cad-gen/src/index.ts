/**
 * @arbesk/cad-gen — environment-agnostic core.
 * @remarks This entry point MUST stay free of Node and browser globals: the
 *   browser bundles it. Backend-only modules live under ./backend/index.js and
 *   are never reachable from here.
 */
export { CONTRACT_VERSION, PRELUDE_VERSION } from "./core/contract.ts";
export { CadError, CadDesignError, CadGuardError, CadKernelError } from "./errors.ts";
