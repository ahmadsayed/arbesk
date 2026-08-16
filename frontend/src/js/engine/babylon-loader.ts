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

let _promise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
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
 * Register glTF loader defaults. Babylon's glTF plugin auto-plays the first
 * animation on import; the Studio keeps the viewport static until the user
 * picks a clip in the inspector (see engine/animation-preview.js).
 */
export function registerGltfLoaderDefaults() {
  const startModes = BABYLON.GLTF2?.GLTFLoaderAnimationStartMode;
  if (!startModes) return;
  BABYLON.SceneLoader.OnPluginActivatedObservable.add(
    (plugin: { name: string; animationStartMode?: number }) => {
      if (plugin.name === "gltf") {
        plugin.animationStartMode = startModes.NONE;
      }
    },
  );
}

/**
 * Load Babylon core + plugins exactly once. Safe to call repeatedly —
 * subsequent calls return the in-flight (or settled) promise.
 * Resolves when window.BABYLON is fully ready.
 */
export function ensureBabylon(): Promise<void> {
  if (!_promise) {
    _promise = loadScript(BJS_CORE).then(() =>
      Promise.all([
        loadScript(`${BJS_BASE}loaders/babylonjs.loaders.min.js`),
        loadScript(`${BJS_BASE}materialsLibrary/babylonjs.materials.min.js`),
      ]).then(() => {
        registerGltfLoaderDefaults();
      }),
    );
  }
  return _promise;
}
