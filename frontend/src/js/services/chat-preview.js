/**
 * Chat bubble 3D previews.
 *
 * Each pending generation gets a small live, orbitable preview rendered into a
 * canvas inside its chat bubble. Babylon ties one engine to one canvas, so
 * each live preview owns its own engine + scene; the count is hard-capped
 * (MAX_LIVE_PREVIEWS) and previews are disposed as soon as the user sends the
 * model to the Studio, so the page's WebGL context count stays bounded.
 *
 * Rendering is visibility-gated: a preview only runs its render loop while
 * visible in the chat scrollport (IntersectionObserver). Per the project
 * resize rule, engine.resize() runs inside the loop before scene.render().
 *
 * Previews reuse the standard format-handler pipeline (glTF/GLB/3MF) with a
 * scene-local importFromBlob, so a preview loads exactly what the Studio
 * would load — without ever touching the main engine state.
 */

import { resolveFormatHandler } from "../formats/index.js";

/** Maximum simultaneously live previews; the oldest is auto-collapsed beyond this. */
const MAX_LIVE_PREVIEWS = 3;

/**
 * @typedef {Object} PreviewHandle
 * @property {string} id
 * @property {(opts?: {captureSnapshot?: boolean}) => Promise<Blob|null>} dispose
 */

/** @type {Map<string, PreviewHandle & {_engine: any, _scene: any}>} */
const livePreviews = new Map();

/**
 * Build a scene-local importFromBlob for the format handlers.
 * @param {any} scene
 * @returns {(blob: Blob, extension: string) => Promise<{meshes: any[], transformNodes: any[]}>}
 */
function makeImportFromBlob(scene) {
  return async (blob, extension) => {
    const blobUrl = URL.createObjectURL(blob);
    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync(
        "",
        blobUrl,
        "",
        scene,
        null,
        extension
      );
      return {
        meshes: result.meshes,
        transformNodes: result.transformNodes || [],
      };
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  };
}

/**
 * Point the camera at the imported meshes, framing their world bounds.
 * @param {any} camera - ArcRotateCamera
 * @param {any[]} meshes
 */
function frameCameraOnMeshes(camera, meshes) {
  /** @type {any} */ let min = null;
  /** @type {any} */ let max = null;
  for (const mesh of meshes) {
    if (!mesh || typeof mesh.getHierarchyBoundingVectors !== "function") {
      continue;
    }
    const bounds = mesh.getHierarchyBoundingVectors(true);
    min = min ? BABYLON.Vector3.Minimize(min, bounds.min) : bounds.min.clone();
    max = max ? BABYLON.Vector3.Maximize(max, bounds.max) : bounds.max.clone();
  }
  if (!min || !max) return;
  const center = min.add(max).scale(0.5);
  const size = max.subtract(min).length();
  if (!Number.isFinite(size) || size === 0) return;
  camera.setTarget(center);
  camera.radius = size * 1.5;
}

/**
 * Capture the current canvas contents as a WebP blob. Requires the engine to
 * have been created with preserveDrawingBuffer.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob|null>}
 */
function captureCanvas(canvas) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob || null), "image/webp", 0.85);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Create a live 3D preview for a generation result on the given canvas.
 * Enforces the live-preview cap: when full, the oldest preview is disposed
 * (capturing a snapshot) and reported via onAutoCollapse so its bubble can
 * collapse to the static image.
 *
 * @param {string} id - pending-generation id
 * @param {HTMLCanvasElement} canvas
 * @param {{cid: string, path?: string, format?: string}} src - manifest source ref
 * @param {{onAutoCollapse?: (id: string, snapshot: Blob|null) => void}} [callbacks]
 * @returns {Promise<PreviewHandle|null>} null when the preview could not be created
 */
export async function createChatPreview(id, canvas, src, callbacks = {}) {
  if (!canvas || typeof BABYLON === "undefined" || !src?.cid) return null;

  while (livePreviews.size >= MAX_LIVE_PREVIEWS) {
    const oldest = livePreviews.entries().next().value;
    if (!oldest) break;
    const [oldestId, oldestHandle] = oldest;
    livePreviews.delete(oldestId);
    const snapshot = await oldestHandle.dispose({ captureSnapshot: true });
    callbacks.onAutoCollapse?.(oldestId, snapshot);
  }

  /** @type {any} */
  let engine = null;
  /** @type {any} */
  let scene = null;
  /** @type {IntersectionObserver | null} */
  let observer = null;

  try {
    engine = new BABYLON.Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });
    scene = new BABYLON.Scene(engine);

    const camera = new BABYLON.ArcRotateCamera(
      `chatPreviewCam_${id}`,
      -Math.PI / 2,
      Math.PI / 2.5,
      10,
      BABYLON.Vector3.Zero(),
      scene
    );
    camera.attachControl(canvas, true);
    camera.wheelPrecision = 50;
    camera.minZ = 0.01;

    new BABYLON.HemisphericLight(
      `chatPreviewLight_${id}`,
      new BABYLON.Vector3(0.3, 1, 0.2),
      scene
    );

    const handler = resolveFormatHandler(src);
    const result = await handler.load(src, {
      scene,
      cid: src.cid,
      importFromBlob: makeImportFromBlob(scene),
    });
    frameCameraOnMeshes(camera, result.meshes || []);

    const renderLoop = () => {
      engine.resize();
      scene.render();
    };
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible) {
          engine.runRenderLoop(renderLoop);
        } else {
          engine.stopRenderLoop(renderLoop);
        }
      });
      observer.observe(canvas);
    } else {
      engine.runRenderLoop(renderLoop);
    }

    let disposed = false;
    const handle = {
      id,
      _engine: engine,
      _scene: scene,
      async dispose({ captureSnapshot = false } = {}) {
        if (disposed) return null;
        disposed = true;
        livePreviews.delete(id);
        let snapshot = null;
        if (captureSnapshot) {
          scene.render();
          snapshot = await captureCanvas(canvas);
        }
        engine.stopRenderLoop(renderLoop);
        observer?.disconnect();
        scene.dispose();
        engine.dispose();
        return snapshot;
      },
    };
    livePreviews.set(id, handle);
    console.log(`[PREVIEW] live preview created id=${id} cid=${src.cid}`);
    return handle;
  } catch (err) {
    console.error(`[PREVIEW] failed to create preview id=${id}:`, err);
    observer?.disconnect();
    if (scene && !scene.isDisposed()) scene.dispose();
    if (engine && !engine.isDisposed()) engine.dispose();
    return null;
  }
}

/**
 * Fetch a live preview handle by id.
 * @param {string} id
 * @returns {PreviewHandle | null}
 */
export function getChatPreview(id) {
  return livePreviews.get(id) || null;
}

/**
 * Dispose a live preview by id.
 * @param {string} id
 * @param {{captureSnapshot?: boolean}} [opts]
 * @returns {Promise<Blob|null>}
 */
export async function disposeChatPreview(id, opts = {}) {
  const handle = livePreviews.get(id);
  if (!handle) return null;
  return handle.dispose(opts);
}

/** Dispose every live preview (page unload / view teardown). */
export function disposeAllChatPreviews() {
  for (const handle of [...livePreviews.values()]) {
    void handle.dispose();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", disposeAllChatPreviews);
}
