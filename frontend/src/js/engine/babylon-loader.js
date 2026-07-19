/**
 * Lazy Babylon.js loader.
 *
 * The 3D engine only runs in the Studio view, so the Babylon CDN scripts
 * (~5 MB across core + loaders + materials) are fetched on first Studio
 * entry instead of gating every app boot — the Library view and the sign-in
 * modal no longer wait for a 3D engine they never use.
 *
 * Core must execute before the loaders/materials plugins (they extend the
 * BABYLON namespace); the two plugins then load in parallel.
 */

const BJS_CORE =
  "https://cdn.jsdelivr.net/npm/babylonjs@9.12.0/babylon.min.js";
const BJS_BASE = "https://cdn.babylonjs.com/v9.12.0/";

/** @type {Promise<void> | null} */
let _promise = null;

/**
 * @param {string} src
 * @returns {Promise<void>}
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * Load Babylon core + plugins exactly once. Safe to call repeatedly —
 * subsequent calls return the in-flight (or settled) promise.
 * @returns {Promise<void>} resolves when window.BABYLON is fully ready
 */
export function ensureBabylon() {
  if (!_promise) {
    _promise = loadScript(BJS_CORE).then(() =>
      Promise.all([
        loadScript(`${BJS_BASE}loaders/babylonjs.loaders.min.js`),
        loadScript(`${BJS_BASE}materialsLibrary/babylonjs.materials.min.js`),
      ]).then(() => undefined),
    );
  }
  return _promise;
}
