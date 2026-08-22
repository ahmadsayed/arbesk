/**
 * Arbesk Scene Camera
 *
 * Camera framing, view snapping, and orthographic preset utilities.
 * Extracted from scene-graph.js.
 */

import { state } from "./state.ts";
import { getRenderableMeshes, getWorldBounds } from "./transforms.ts";
import type { WorldBounds } from "./transforms.ts";

// ═══════════════════════════════════════════════════════════════════════════
// View presets - Blender-style 1/3/7 orthographic view snapping
// ═══════════════════════════════════════════════════════════════════════════

const VIEW_FRONT = { name: "Front", alpha: 0, beta: Math.PI / 2 };
const VIEW_RIGHT = { name: "Right", alpha: Math.PI / 2, beta: Math.PI / 2 };
const VIEW_TOP = { name: "Top", alpha: 0, beta: 0.01 };

export interface ViewPreset {
  name: string;
  alpha: number;
  beta: number;
}

function frameCameraToBounds(bounds: WorldBounds | null) {
  if (!state.camera || !bounds) return;

  const cam = state.camera;
  // Fit the largest dimension, not the 3D diagonal — the diagonal inflates
  // the radius by up to √3 and leaves the model small in the viewport.
  const maxDim = Math.max(bounds.size.x, bounds.size.y, bounds.size.z);
  const fov = cam.fov || 0.8; // radians, default ~45°
  const radius = (maxDim * 1.2) / (2 * Math.tan(fov / 2));

  // Animate to the new target + radius over 300ms
  BABYLON.Animation.CreateAndStartAnimation(
    "frameAnim",
    cam,
    "target",
    60,
    20,
    cam.target,
    bounds.center,
    BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  BABYLON.Animation.CreateAndStartAnimation(
    "frameRadiusAnim",
    cam,
    "radius",
    60,
    20,
    cam.radius,
    Math.max(radius, cam.lowerRadiusLimit),
    BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
}

function _getNonChromeMeshes(): BABYLON.AbstractMesh[] {
  if (!state._nonChromeMeshCache) {
    state._nonChromeMeshCache = state.scene.meshes.filter(
      (m: BABYLON.AbstractMesh) => m && !m.isDisposed() && !m.metadata?.isViewportChrome
    );
  }
  return state._nonChromeMeshCache!;
}

/**
 * Frame all non-chrome meshes in the scene (Home key).
 */
function frameAll() {
  if (!state.scene) return;

  const allMeshes = _getNonChromeMeshes();
  const renderable = getRenderableMeshes(allMeshes);
  if (renderable.length === 0) return;

  const bounds = getWorldBounds(renderable);
  if (!bounds) return;

  frameCameraToBounds(bounds);
}

/**
 * Frame the current selection (F key). With a multi-selection, frames the
 * combined bounds of every selected node.
 */
function frameSelected() {
  const ids =
    state.selectedNodeIds.size > 0
      ? [...state.selectedNodeIds]
      : state.highlightedNodeId
        ? [state.highlightedNodeId]
        : [];
  if (ids.length === 0) return;

  const meshes = ids.flatMap((id) => state.nodeMeshes.get(id) || []);
  if (meshes.length === 0) return;

  const renderable = getRenderableMeshes(meshes);
  if (renderable.length === 0) return;

  const bounds = getWorldBounds(renderable);
  if (!bounds) return;

  frameCameraToBounds(bounds);
}

/**
 * Snap the camera to an orthographic view preset (1=Front, 3=Right, 7=Top).
 * Frames the scene first to compute good camera parameters, converts the
 * perspective radius to ortho radius, then animates alpha + beta + radius.
 */
function snapView(preset: ViewPreset) {
  if (!state.camera || !state.scene) return;

  const cam = state.camera;
  const canvas = state.engine.getRenderingCanvas();

  const allMeshes = _getNonChromeMeshes();
  const renderable = getRenderableMeshes(allMeshes);

  let target = cam.target.clone();

  if (renderable.length > 0) {
    const bounds = getWorldBounds(renderable);
    if (bounds) {
      target = bounds.center.clone();

      // Projected bounds on the ortho view plane per view direction.
      // Front (1) = look -Z → visible X×Y
      // Right (3) = look +X → visible Z×Y
      // Top   (7) = look -Y → visible X×Z
      let spanW: number, spanH: number;
      if (preset.name === "Right") {
        spanW = bounds.size.z;
        spanH = bounds.size.y;
      } else if (preset.name === "Top") {
        spanW = bounds.size.x;
        spanH = bounds.size.z;
      } else {
        spanW = bounds.size.x;
        spanH = bounds.size.y;
      }

      // Set the ortho frustum EXPLICITLY, matched to the canvas aspect ratio.
      const canvasAspect = canvas.width / canvas.height;
      const sceneAspect = spanW / spanH;
      const padding = 1.1;
      let halfW: number, halfH: number;
      if (sceneAspect > canvasAspect) {
        halfW = (spanW * padding) / 2;
        halfH = halfW / canvasAspect;
      } else {
        halfH = (spanH * padding) / 2;
        halfW = halfH * canvasAspect;
      }

      cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
      cam.orthoLeft = -halfW;
      cam.orthoRight = halfW;
      cam.orthoBottom = -halfH;
      cam.orthoTop = halfH;
      // Radius is irrelevant for ortho rendering but ArcRotateCamera uses
      // it for direction calc - keep a safe distance.
      cam.radius = (spanW + spanH) / 2 + 2;

      console.log(
        `[VIEW] ${preset.name} | span=${spanW.toFixed(1)}×${spanH.toFixed(
          1
        )} halfW=${halfW.toFixed(1)} halfH=${halfH.toFixed(1)} canvas=${
          canvas.width
        }×${canvas.height}`
      );
    }
  }

  // Animate target + alpha + beta. Ortho frustum is already set.
  BABYLON.Animation.CreateAndStartAnimation(
    "snapTarget",
    cam,
    "target",
    60,
    18,
    cam.target.clone(),
    target,
    BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  BABYLON.Animation.CreateAndStartAnimation(
    "snapAlpha",
    cam,
    "alpha",
    60,
    18,
    cam.alpha,
    preset.alpha,
    BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  BABYLON.Animation.CreateAndStartAnimation(
    "snapBeta",
    cam,
    "beta",
    60,
    18,
    cam.beta,
    preset.beta,
    BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
}

/**
 * Resize the camera zoom range and viewport chrome (ground grid / axes) to
 * match the currently-loaded scene. Large models need a much larger max zoom
 * (radius) than the default 500, and the grid/axes must grow so they still
 * frame the model instead of disappearing inside it.
 */
function updateCameraRangeForScene() {
  if (!state.camera || !state.scene) return;

  const allMeshes = state.scene.meshes.filter(
    (m: BABYLON.AbstractMesh) =>
      m && !m.isDisposed() && !m.metadata?.isViewportChrome
  );
  const renderable = getRenderableMeshes(allMeshes);
  if (renderable.length === 0) return;

  const bounds = getWorldBounds(renderable);
  if (!bounds) return;

  // Largest single dimension — better basis for camera/chrome scale than the
  // 3D diagonal, which can be √3 larger and makes the model look far away.
  const maxDim = Math.max(bounds.size.x, bounds.size.y, bounds.size.z);

  const cam = state.camera;
  // Cached for clampOrthoCameraDistance(), which needs the content extent
  // along the view axis every frame while in ortho mode.
  state._sceneContentBounds = bounds;
  // Only raise the far limit for large models — keep the near limit small so
  // users can still zoom in close to details. The zoom-OUT floor is 50 (the
  // pre-adaptive fixed cap): a 500 floor lets a ~1-unit model (Tripo output)
  // shrink to a couple of pixels at max zoom-out — indistinguishable from
  // being clipped.
  const minLimit = 0.1;
  const maxLimit = Math.max(50, maxDim * 10);

  cam.lowerRadiusLimit = minLimit;
  cam.upperRadiusLimit = maxLimit;
  // The far plane must outrun the furthest visible geometry (camera at
  // maxLimit, plus the model's depth behind the target, plus the grown grid)
  // while staying as TIGHT as the model allows, and the near plane is pinned
  // to it at a fixed 1:1e5 ratio (comfortable for 24-bit depth). Fixed plane
  // values cannot serve every model: a small fixed minZ against a huge
  // model's maxZ collapses depth precision until surfaces z-fight and slice
  // through each other (the cave), while a large fixed minZ slices small
  // models on close zoom (the original goat bug). The chat previews scale
  // both planes to content for the same reason.
  cam.maxZ = Math.max(maxDim * 100, maxLimit * 4);
  cam.minZ = cam.maxZ / 1e5;

  // Ground grid is created at 40×40 world units. Scale it so it comfortably
  // covers the loaded model, but never shrink below its default size.
  // updateGridCoverage() grows it further (power-of-two steps) when the
  // camera zooms far enough out to see past the plane's edge.
  const groundGrid = state.scene.getMeshByName("groundGrid");
  if (groundGrid) {
    const targetSize = Math.max(40, maxDim * 3);
    const scale = targetSize / 40;
    _gridBaseScale = scale;
    _gridAppliedScale = scale;
    groundGrid.scaling = new BABYLON.Vector3(scale, 1, scale);
  }

  // In-scene axes are created at ±20 units. Scale them to match the grid.
  const axisX = state.scene.getMeshByName("axisX");
  const axisZ = state.scene.getMeshByName("axisZ");
  if (axisX && axisZ) {
    const targetHalf = Math.max(20, maxDim * 1.5);
    const scale = targetHalf / 20;
    axisX.scaling = new BABYLON.Vector3(scale, scale, scale);
    axisZ.scaling = new BABYLON.Vector3(scale, scale, scale);
  }

  console.log(
    `[CAMERA] adaptive range | maxDim=${maxDim.toFixed(2)} ` +
      `bounds=[${bounds.min.x.toFixed(0)},${bounds.min.y.toFixed(0)},${bounds.min.z.toFixed(0)}]→` +
      `[${bounds.max.x.toFixed(0)},${bounds.max.y.toFixed(0)},${bounds.max.z.toFixed(0)}] ` +
      `meshes=${renderable.length} lower=${minLimit} upper=${maxLimit.toFixed(0)} ` +
      `minZ=${cam.minZ} maxZ=${cam.maxZ} gridScale=${(
        (groundGrid?.scaling.x as number) ?? 1
      ).toFixed(2)}`
  );
}

// Grid coverage state: _gridBaseScale is the model-driven scale set by
// updateCameraRangeForScene; _gridAppliedScale tracks the last written scale
// so updateGridCoverage only touches the mesh on power-of-two crossings.
let _gridBaseScale = 1;
let _gridAppliedScale = 1;

/**
 * Keep the ground grid covering the visible area as the camera zooms out.
 * The grid is a finite 40×40 plane — far enough out, its edge becomes
 * visible. Grow it in power-of-two steps (never below the model-driven base
 * scale) so cells step coarser at thresholds instead of continuously
 * resizing. Cheap enough to call every frame; writes only on a step change.
 */
function updateGridCoverage() {
  if (!state.camera || !state.scene) return;
  const groundGrid = state.scene.getMeshByName("groundGrid");
  if (!groundGrid) return;
  // The plane's half-size is 20*scale. Visible ground extent depends on the
  // view ANGLE as well as distance: at shallow (grazing) angles the ground
  // recedes far beyond the camera distance, so coverage scales with
  // 1/sin(beta) — clamped at ~17° to keep the plane finite near-horizontal.
  const cam = state.camera;
  const extent = cam.radius / Math.max(Math.sin(cam.beta ?? Math.PI / 2), 0.3);
  const needed = extent / 20;
  const scale = Math.max(
    _gridBaseScale,
    Math.pow(2, Math.ceil(Math.log2(Math.max(needed, 1))))
  );
  if (scale !== _gridAppliedScale) {
    _gridAppliedScale = scale;
    groundGrid.scaling.set(scale, 1, scale);
  }
}

/**
 * Ortho-mode guard: pin the camera radius to the visible zoom. In ortho mode
 * the zoom is driven by scaling the frustum bounds (see the custom wheel
 * handler in scene-graph.ts), while Babylon's own wheel input keeps changing
 * camera.radius invisibly — with no visual effect of its own, yet it moves
 * the near/far planes along the view ray, so a decayed radius stranded the
 * camera inside the model and sliced it with no change in the view (the
 * "dissolving goat"). Radius is visually irrelevant in ortho, so it is
 * DERIVED from the frustum every frame — hidden radius state can no longer
 * exist:
 *
 * - Model fits the frustum (zoomed out / fit views): the camera is held
 *   OUTSIDE the content — radius covers the furthest bounds corner along the
 *   view ray, so a deep model (cave from the side, tower from the top) is
 *   never sliced by its own snap view.
 * - Zoomed into a sub-window (frustum tighter than the model): radius follows
 *   the PERSPECTIVE-EQUIVALENT distance of the current zoom (see
 *   _orthoRadius), so the near plane starts slicing at exactly the visual
 *   moment the library preview's perspective camera would touch the surface,
 *   and deepens continuously as you zoom — the "reach the wall, zoom more,
 *   break through" feel, driven by the visible zoom instead of hidden state.
 *
 * The far plane is then grown to cover the geometry behind the target from
 * wherever the camera landed.
 */
function clampOrthoCameraDistance() {
  const cam = state.camera;
  if (!cam || cam.mode !== BABYLON.Camera.ORTHOGRAPHIC_CAMERA) return;
  if (cam.orthoTop == null || cam.orthoBottom == null) return;
  const span = cam.orthoTop - cam.orthoBottom;
  if (!(span > 0)) return;
  const margin = Math.max(cam.minZ * 10, 0.1);

  let fwd = 0; // furthest geometry in front of the target, along the view ray
  let back = span / 2; // behind the target (fallback: the span itself)
  let upExtent = 0; // model extent along the camera's vertical axis
  let fits = false; // whole model within the frustum vertically?
  const bounds = state._sceneContentBounds;
  if (bounds && cam.position && cam.target) {
    let vx = cam.target.x - cam.position.x;
    let vy = cam.target.y - cam.position.y;
    let vz = cam.target.z - cam.position.z;
    const len = Math.hypot(vx, vy, vz);
    if (len > 0) {
      vx /= len;
      vy /= len;
      vz /= len;
      // Camera up vector: world Y made perpendicular to the view direction
      // (near-horizontal views fall back to Z, then X, for top-down views).
      let up: [number, number, number] | null = null;
      for (const a of [
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 0],
      ] as const) {
        const d = a[0] * vx + a[1] * vy + a[2] * vz;
        const ux = a[0] - d * vx;
        const uy = a[1] - d * vy;
        const uz = a[2] - d * vz;
        const ul = Math.hypot(ux, uy, uz);
        if (ul > 1e-3) {
          up = [ux / ul, uy / ul, uz / ul];
          break;
        }
      }
      back = 0;
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            const dx = x - cam.target.x;
            const dy = y - cam.target.y;
            const dz = z - cam.target.z;
            const d = dx * vx + dy * vy + dz * vz;
            if (d > fwd) fwd = d;
            if (-d > back) back = -d;
            if (up) {
              const u = Math.abs(dx * up[0] + dy * up[1] + dz * up[2]);
              if (u > upExtent) upExtent = u;
            }
          }
        }
      }
      fits = span / 2 >= upExtent;
    }
  }

  cam.radius = _orthoRadius(span, fits, fwd, upExtent, cam.fov || 0.8) + margin;
  // The far plane must still cover the model behind the target.
  const needed = cam.radius + back + margin;
  if (cam.maxZ < needed) cam.maxZ = needed;
}

/**
 * Radius for a given ortho span: the PERSPECTIVE-EQUIVALENT distance — the
 * distance at which a perspective camera with this fov would show exactly the
 * same visible height (`span = 2·r·tan(fov/2)`). Slicing then starts at the
 * same visual zoom as the preview's perspective camera, and deepens at the
 * same rate. When the model is deeper than its perspective-equivalent
 * distance (tall tower from the top), the radius ramps down from the surface
 * distance proportionally instead, so the transition stays continuous.
 */
function _orthoRadius(
  span: number,
  fits: boolean,
  fwd: number,
  upExtent: number,
  fov: number
): number {
  const perspEquiv = span / (2 * Math.tan(fov / 2));
  if (fits) return Math.max(perspEquiv, fwd);
  if (upExtent > 0) return Math.max(perspEquiv, (fwd * (span / 2)) / upExtent);
  return perspEquiv;
}

export {
  frameAll,
  frameSelected,
  snapView,
  updateCameraRangeForScene,
  updateGridCoverage,
  clampOrthoCameraDistance,
  VIEW_FRONT,
  VIEW_RIGHT,
  VIEW_TOP,
};
