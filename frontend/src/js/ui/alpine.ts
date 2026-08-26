/**
 * Arbesk Alpine.js loader
 *
 * Single entry point for Alpine (loaded via the importmap in app.pug in the
 * browser, from frontend/node_modules in tests). UI modules register their
 * components with registerAlpineComponent(); Alpine.start() runs once, after
 * DOMContentLoaded, so every deferred module script has registered first.
 *
 * Usage:
 *   import { registerAlpineComponent } from "./alpine.ts";
 *   registerAlpineComponent("myPanel", myPanelComponentFactory);
 */

import AlpineModule from "alpinejs";

// CJS/ESM interop: jest resolves the CommonJS build ({ default: Alpine }),
// the browser importmap serves a true ESM build with a default export.
const Alpine = (AlpineModule as any).default || AlpineModule;

let _startScheduled = false;

/**
 * Register an Alpine data component (usable as `x-data="name"`) and schedule
 * the one-time Alpine.start().
 * @param factory - returns the component's reactive data + methods. Accepts
 *   optional parameters passed from an `x-data="name(...)"` expression.
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
