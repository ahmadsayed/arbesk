/**
 * Decides per animation frame whether a Babylon scene needs re-rendering.
 * @remarks Full frame rate while the scene is active (input, camera motion,
 *   running animations, scene graph changes, resize, or an explicit
 *   invalidate()); otherwise a low-rate safety-net refresh, so a change that
 *   raises no signal shows up within IDLE_INTERVAL_MS instead of never.
 *   Rendering an unchanged scene every frame is the dominant CPU cost under
 *   software WebGL and drains laptop batteries.
 */

/** Keep rendering at full rate this long after the last activity signal. */
export const ACTIVE_WINDOW_MS = 1000;

/** Safety-net refresh period while idle. */
export const IDLE_INTERVAL_MS = 200;

export interface RenderScheduler {
  /** Call once per frame; true when the scene should render this frame. */
  shouldRender(): boolean;
  /** Mark the scene dirty: render at full rate for ACTIVE_WINDOW_MS. */
  invalidate(): void;
  /** Detach every observer this scheduler added. */
  dispose(): void;
}

export function createRenderScheduler(
  scene: any,
  camera: any,
  { now = () => performance.now() }: { now?: () => number } = {}
): RenderScheduler {
  let lastActivity = -Infinity;
  let lastRender = -Infinity;
  const invalidate = () => {
    lastActivity = now();
  };

  const observables = [
    scene.onPointerObservable,
    scene.onKeyboardObservable,
    scene.onNewMeshAddedObservable,
    scene.onMeshRemovedObservable,
    scene.onNewMaterialAddedObservable,
    scene.onNewTransformNodeAddedObservable,
    scene.getEngine?.()?.onResizeObservable,
    camera?.onViewMatrixChangedObservable,
  ].filter(Boolean);
  const handles = observables.map((obs) => [obs, obs.add(invalidate)] as const);

  function isAnimating(): boolean {
    return (
      scene.animatables?.length > 0 ||
      (scene.animationGroups ?? []).some((g: any) => g.isPlaying)
    );
  }

  return {
    shouldRender() {
      const t = now();
      const render =
        t - lastActivity < ACTIVE_WINDOW_MS ||
        isAnimating() ||
        t - lastRender >= IDLE_INTERVAL_MS;
      if (render) lastRender = t;
      return render;
    },
    invalidate,
    dispose() {
      for (const [obs, handle] of handles) obs.remove(handle);
    },
  };
}
