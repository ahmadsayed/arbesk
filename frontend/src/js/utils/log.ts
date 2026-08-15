/**
 * Tiny tagged logger for the browser.
 *
 * - `log(tag, ...args)` is silenced unless `localStorage.arbesk-debug === "true"`
 *   or the build sets `window.ARBESK_DEBUG = true`.
 * - `warn(tag, ...args)` and `error(tag, ...args)` always emit so operational
 *   problems remain visible.
 *
 * Keeps the `[TAG]` format required by AGENTS.md.
 */

function isDebugEnabled(): boolean {
  if (typeof window !== "undefined" && (window as any).ARBESK_DEBUG === true) return true;
  try {
    return typeof localStorage !== "undefined" &&
      localStorage.getItem("arbesk-debug") === "true";
  } catch {
    return false;
  }
}

export function log(tag: string, ...args: any[]): void {
  if (!isDebugEnabled()) return;
  console.log(`[${tag}]`, ...args);
}

export function warn(tag: string, ...args: any[]): void {
  console.warn(`[${tag}]`, ...args);
}

export function error(tag: string, ...args: any[]): void {
  console.error(`[${tag}]`, ...args);
}
