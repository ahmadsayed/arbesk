/**
 * Tiny tagged logger for asset-core. Dependency-free and environment-agnostic:
 * no browser-global references — everything is reached through `globalThis`
 * with a safe fallback so the same module runs in Node, tests, and the browser.
 *
 * - `log(tag, ...args)` is silenced unless `globalThis.ARBESK_DEBUG === true`
 *   or `localStorage.arbesk-debug === "true"` (browser debug toggle).
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
