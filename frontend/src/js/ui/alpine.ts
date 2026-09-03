/**
 * Single entry point for Alpine.js.
 * @remarks Alpine.start() runs once, after DOMContentLoaded, so every
 *   deferred module has registered its components first.
 */

import AlpineModule from "alpinejs";

// CJS/ESM interop: jest resolves the CommonJS build ({ default: Alpine }),
// the browser importmap serves a true ESM build with a default export.
const Alpine = (AlpineModule as any).default || AlpineModule;

let _startScheduled = false;

/**
 * Registers an Alpine data component and schedules the one-time Alpine.start().
 * @remarks The factory returns the component's reactive data and methods, and
 *   may accept parameters passed from an `x-data="name(...)"` expression.
 */
export function registerAlpineComponent(
  name: string,
  factory: (...args: any[]) => object
): void {
  Alpine.data(name, factory);
  if (_startScheduled) return;
  _startScheduled = true;
  // NOTE: document.readyState is already "interactive" while deferred module
  // scripts are still evaluating — "loading" ends when the parser finishes,
  // NOT when module evaluation finishes. Only DOMContentLoaded is guaranteed
  // to fire after every deferred module has run, so wait for it unless the
  // document is fully complete (tests, late dynamic imports).
  if (document.readyState === "complete") {
    queueMicrotask(() => Alpine.start());
  } else {
    document.addEventListener("DOMContentLoaded", () => Alpine.start(), { once: true });
  }
}

export { Alpine };
