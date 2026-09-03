/**
 * Lazily loads Babylon.js.
 * @remarks The engine only runs in the Studio view, so the ~5 MB of CDN
 *   scripts load on first Studio entry instead of gating every app boot.
 *   Core must run before the loaders/materials plugins (they extend the
 *   BABYLON namespace).
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
 * @remarks Babylon's glTF plugin auto-plays the first animation on import;
 *   the Studio keeps the viewport static until a clip is picked in the
 *   inspector.
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
 * Loads Babylon core and plugins exactly once.
 * @remarks Safe to call repeatedly: later calls return the in-flight (or
 *   settled) promise. Resolves when window.BABYLON is ready.
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
