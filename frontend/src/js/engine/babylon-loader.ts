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
// meshopt decoder for EXT_meshopt_compression GLBs (Tripo compress:"geometry").
const BJS_MESHOPT = `${BJS_BASE}meshopt_decoder.js`;

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
 *   inspector. Also pins the meshopt decoder to the versioned CDN path and
 *   warms MeshoptCompression.Default so EXT_meshopt_compression GLBs (Tripo
 *   compress:"geometry") decode without a first-load stall.
 */
export function registerGltfLoaderDefaults() {
  const startModes = BABYLON.GLTF2?.GLTFLoaderAnimationStartMode;
  if (startModes) {
    BABYLON.SceneLoader.OnPluginActivatedObservable.add(
      (plugin: { name: string; animationStartMode?: number }) => {
        if (plugin.name === "gltf") {
          plugin.animationStartMode = startModes.NONE;
        }
      },
    );
  }
  const meshopt = BABYLON.MeshoptCompression;
  if (meshopt) {
    // The loaders bundle self-registers EXT_meshopt_compression and decodes
    // via MeshoptCompression.Default, which lazily loads Configuration's
    // decoder URL — pin it to our versioned CDN base.
    meshopt.Configuration = { decoder: { url: BJS_MESHOPT } };
    // Accessing Default constructs the instance and starts the decoder
    // download/wasm compile now instead of on the first compressed model.
    void meshopt.Default;
  }
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
