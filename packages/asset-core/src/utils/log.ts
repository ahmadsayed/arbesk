/**
 * Tiny tagged logger for asset-core.
 * @remarks Environment-agnostic: reached only through `globalThis`. Logging is
 *   silenced unless `globalThis.ARBESK_DEBUG === true` or
 *   `localStorage.arbesk-debug === "true"`.
 */

function isDebugEnabled(): boolean {
  const g = globalThis as any;
  if (g.ARBESK_DEBUG === true) return true;
  try {
    return g.localStorage?.getItem("arbesk-debug") === "true";
  } catch {
    return false;
  }
}

export function log(tag: string, ...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  console.log(`[${tag}]`, ...args);
}
