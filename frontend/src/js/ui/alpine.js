/**
 * Arbesk Alpine.js loader
 *
 * Single entry point for Alpine (loaded via the importmap in app.pug in the
 * browser, from frontend/node_modules in tests). UI modules register their
 * components with registerAlpineComponent(); Alpine.start() runs once, after
 * DOMContentLoaded, so every deferred module script has registered first.
 *
 * Usage:
 *   import { registerAlpineComponent } from "./alpine.js";
 *   registerAlpineComponent("myPanel", myPanelComponentFactory);
 */

import AlpineModule from "alpinejs";

// CJS/ESM interop: jest resolves the CommonJS build ({ default: Alpine }),
// the browser importmap serves a true ESM build with a default export.
const Alpine = /** @type {any} */ (AlpineModule).default || AlpineModule;

let _startScheduled = false;

/**
 * Register an Alpine data component (usable as `x-data="name"`) and schedule
 * the one-time Alpine.start().
 * @param {string} name
 * @param {() => object} factory - returns the component's reactive data + methods
 */
export function registerAlpineComponent(name, factory) {
  Alpine.data(name, factory);
  if (_startScheduled) return;
  _startScheduled = true;
  if (document.readyState === "loading") {
    // Deferred module scripts evaluate before DOMContentLoaded, so every
    // registerAlpineComponent() call lands before start() walks the DOM.
    document.addEventListener("DOMContentLoaded", () => Alpine.start(), { once: true });
  } else {
    Alpine.start();
  }
}

export { Alpine };
