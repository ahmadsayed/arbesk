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
  const diagonal = Math.sqrt(
    bounds.size.x * bounds.size.x +
      bounds.size.y * bounds.size.y +
      bounds.size.z * bounds.size.z
  );
  const fov = cam.fov || 0.8; // radians, default ~45°
  const radius = (diagonal * 0.6) / Math.tan(fov / 2);

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
 * (radius) than the default 50, and the grid/axes must grow so they still
 * frame the model instead of disappearing inside it.
 */
function updateCameraRangeForScene() {
  if (!state.camera || !state.scene) return;

  const allMeshes = state.scene.meshes.filter(
    (m: BABYLON.AbstractMesh) => m && !m.isDisposed() && !m.metadata?.isViewportChrome
  );
  const renderable = getRenderableMeshes(allMeshes);
  if (renderable.length === 0) return;

  const bounds = getWorldBounds(renderable);
  if (!bounds) return;

  const diagonal = Math.sqrt(
    bounds.size.x * bounds.size.x +
      bounds.size.y * bounds.size.y +
      bounds.size.z * bounds.size.z
  );

  const cam = state.camera;
  // Only raise the far limit for large models — keep the near limit small so
  // users can still zoom in close to details. The previous 5% diagonal floor
  // made big models feel "locked" because the closest allowed radius was too
  // far away.
  const minLimit = 0.1;
  const maxLimit = Math.max(500, diagonal * 5);

  cam.lowerRadiusLimit = minLimit;
  cam.upperRadiusLimit = maxLimit;

  // Largest absolute coordinate that must be visible from the origin.
  const maxAbs = Math.max(
    Math.abs(bounds.min.x),
    Math.abs(bounds.max.x),
    Math.abs(bounds.min.y),
    Math.abs(bounds.max.y),
    Math.abs(bounds.min.z),
    Math.abs(bounds.max.z)
  );

  // Ground grid is created at 40×40 world units. Scale it so it comfortably
  // covers the loaded model, but never shrink below its default size.
  const groundGrid = state.scene.getMeshByName("groundGrid");
  if (groundGrid) {
    const targetSize = Math.max(40, maxAbs * 3);
    const scale = targetSize / 40;
    groundGrid.scaling = new BABYLON.Vector3(scale, 1, scale);
  }

  // In-scene axes are created at ±20 units. Scale them to match the grid.
  const axisX = state.scene.getMeshByName("axisX");
  const axisZ = state.scene.getMeshByName("axisZ");
  if (axisX && axisZ) {
    const targetHalf = Math.max(20, maxAbs * 1.5);
    const scale = targetHalf / 20;
    axisX.scaling = new BABYLON.Vector3(scale, scale, scale);
    axisZ.scaling = new BABYLON.Vector3(scale, scale, scale);
  }

  console.log(
    `[CAMERA] adaptive range | diagonal=${diagonal.toFixed(
      2
    )} lower=${minLimit.toFixed(2)} upper=${maxLimit.toFixed(2)} gridScale=${(
      (groundGrid?.scaling.x as number) ?? 1
    ).toFixed(2)}`
  );
}

export {
  frameAll,
  frameSelected,
  snapView,
  updateCameraRangeForScene,
  VIEW_FRONT,
  VIEW_RIGHT,
  VIEW_TOP,
};
