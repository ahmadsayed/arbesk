/**
 * Camera framing, content-adaptive zoom range/clip planes, and viewport
 * chrome (grid/axes) scaling.
 * @remarks The Studio viewport is perspective-only (one code path shared with
 *   the library and chat preview cameras).
 */

import { state } from "./state.ts";
import { getRenderableMeshes, getWorldBounds } from "./transforms.ts";
import type { WorldBounds } from "./transforms.ts";

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
 * Frames all non-chrome meshes in the scene.
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
 * Frames the current selection.
 * @remarks A multi-selection frames the combined bounds of every selected
 *   node.
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
 * Resizes the camera zoom range and viewport chrome (grid/axes) to match the
 * loaded scene.
 * @remarks Large models need a much larger max zoom than the default 500, and
 *   the grid/axes must grow so they still frame the model.
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
 * Keeps the ground grid covering the visible area as the camera zooms out.
 * @remarks The grid is a finite 40×40 plane whose edge becomes visible when
 *   zoomed far enough out.
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

export {
  frameAll,
  frameSelected,
  updateCameraRangeForScene,
  updateGridCoverage,
};
