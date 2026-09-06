/**
 * Absolute path to the repository/deployment root for runtime file reads
 * (.env, frontend/dist, blockchain/artifacts, .data, HTML assets).
 * @remarks Defaults to the process working directory — every launcher
 *   (start-dev.sh, start-prod.sh, bun/npm scripts, jest) runs from the
 *   project root; ARBESK_ROOT overrides it. Never resolve runtime reads from
 *   import.meta.url: a compiled single-file binary (`bun build --compile`)
 *   has a virtual module URL, so only cwd/env-based resolution works there.
 */
export const PROJECT_ROOT = process.env.ARBESK_ROOT || process.cwd();
