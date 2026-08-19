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

import { resolveFormatHandler } from "../formats/index.ts";

/** Maximum simultaneously live previews; the oldest is auto-collapsed beyond this. */
const MAX_LIVE_PREVIEWS = 3;
/** Pan speed relative to exact cursor tracking; 0.2 = gentle drag. */
const PREVIEW_PAN_SPEED = 0.2;

export interface PreviewHandle {
  id: string;
  dispose: (opts?: { captureSnapshot?: boolean }) => Promise<Blob | null>;
}

const livePreviews = new Map<string, PreviewHandle & { _engine: any; _scene: any }>();

/**
 * Build a scene-local importFromBlob for the format handlers.
 */
function makeImportFromBlob(scene: any): (blob: Blob, extension: string) => Promise<{ meshes: any[]; transformNodes: any[]; animationGroups: any[] }> {
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
      // The global loader default is animationStartMode NONE (the Studio
      // inspector owns playback), but chat bubbles have no inspector — keep
      // them lively by auto-playing the first clip looped. Best-effort:
      // static models have no animation groups.
      try {
        result.animationGroups?.[0]?.start(true);
      } catch (animErr) {
        console.warn("[PREVIEW] animation autoplay failed:", animErr);
      }
      return {
        meshes: result.meshes,
        transformNodes: result.transformNodes || [],
        animationGroups: result.animationGroups || [],
      };
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  };
}

/**
 * Point the camera at the imported meshes, framing their world bounds.
 * @param camera - ArcRotateCamera
 */
function frameCameraOnMeshes(camera: any, meshes: any[]): void {
  let min: any = null;
  let max: any = null;
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
  // Scale the clipping planes to the model: a fixed near/far clips huge
  // models (default maxZ 1000) and wrecks depth precision on tiny ones.
  camera.minZ = Math.max(size / 1000, 0.001);
  camera.maxZ = size * 100;
  // Zoom limits relative to the framed size, not absolute world units.
  camera.lowerRadiusLimit = size * 0.05;
  camera.upperRadiusLimit = size * 10;
}

/**
 * Capture the current canvas contents as a WebP blob. Requires the engine to
 * have been created with preserveDrawingBuffer.
 */
function captureCanvas(canvas: HTMLCanvasElement): Promise<Blob | null> {
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
 * @param id - pending-generation id
 * @param src - manifest source ref
 * @returns null when the preview could not be created
 */
export async function createChatPreview(
  id: string,
  canvas: HTMLCanvasElement,
  src: { cid: string; path?: string; format?: string },
  callbacks: { onAutoCollapse?: (id: string, snapshot: Blob | null) => void } = {}
): Promise<PreviewHandle | null> {
  if (!canvas || typeof BABYLON === "undefined" || !src?.cid) return null;

  while (livePreviews.size >= MAX_LIVE_PREVIEWS) {
    const oldest = livePreviews.entries().next().value;
    if (!oldest) break;
    const [oldestId, oldestHandle] = oldest;
    livePreviews.delete(oldestId);
    const snapshot = await oldestHandle.dispose({ captureSnapshot: true });
    callbacks.onAutoCollapse?.(oldestId, snapshot);
  }

  let engine: any = null;
  let scene: any = null;
  let observer: IntersectionObserver | null = null;

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
    // Proportional zoom, same as the Studio viewport (scene-graph.ts):
    // the step is a percentage of the current radius, so it scales with
    // model size. wheelPrecision (an absolute world-unit step) feels dead
    // on large models — see ad7bdaf.
    camera.wheelDeltaPercentage = 0.01;
    camera.pinchDeltaPercentage = 0.01;
    // Tame the post-release glide — with viewport-scaled pan steps the
    // default 0.9 inertia overshoots noticeably in a small preview pane.
    camera.panningInertia = 0.5;
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
      // Viewport-relative panning. Babylon's pan step is a CONSTANT world
      // distance per pixel (pixels / panningSensibility — no radius factor
      // anywhere in the input→movement→camera chain, verified against
      // 9.12.0 sources), which is imperceptible on large models. Scale the
      // step to the visible extent instead; PAN_VIEWPORT_FRACTION tunes the
      // feel: 1 = the world point under the cursor tracks it exactly.
      const visibleWidth = 2 * camera.radius * Math.tan(camera.fov / 2);
      const cssWidth = canvas.clientWidth || 1;
      camera.panningSensibility =
        cssWidth / (Math.max(visibleWidth, 0.001) * PREVIEW_PAN_SPEED);
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
      async dispose({ captureSnapshot = false }: { captureSnapshot?: boolean } = {}): Promise<Blob | null> {
        if (disposed) return null;
        disposed = true;
        livePreviews.delete(id);
        let snapshot: Blob | null = null;
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
 */
export function getChatPreview(id: string): PreviewHandle | null {
  return livePreviews.get(id) || null;
}

/**
 * Dispose a live preview by id.
 */
export async function disposeChatPreview(id: string, opts: { captureSnapshot?: boolean } = {}): Promise<Blob | null> {
  const handle = livePreviews.get(id);
  if (!handle) return null;
  return handle.dispose(opts);
}

/** Dispose every live preview (page unload / view teardown). */
export function disposeAllChatPreviews(): void {
  for (const handle of [...livePreviews.values()]) {
    void handle.dispose();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", disposeAllChatPreviews);
}
