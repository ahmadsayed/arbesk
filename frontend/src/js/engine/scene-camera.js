// @ts-nocheck
/**
 * Arbesk Scene Camera
 *
 * Camera framing, view snapping, and orthographic preset utilities.
 * Extracted from scene-graph.js.
 */

import { state } from "./state.js";
import { getRenderableMeshes, getWorldBounds } from "./transforms.js";

// ═══════════════════════════════════════════════════════════════════════════
// View presets - Blender-style 1/3/7 orthographic view snapping
// ═══════════════════════════════════════════════════════════════════════════

const VIEW_FRONT = { name: "Front", alpha: 0, beta: Math.PI / 2 };
const VIEW_RIGHT = { name: "Right", alpha: Math.PI / 2, beta: Math.PI / 2 };
const VIEW_TOP = { name: "Top", alpha: 0, beta: 0.01 };

function frameCameraToBounds(bounds) {
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

function _getNonChromeMeshes() {
  if (!state._nonChromeMeshCache) {
    state._nonChromeMeshCache = state.scene.meshes.filter(
      (m) => m && !m.isDisposed() && !m.metadata?.isViewportChrome
    );
  }
  return state._nonChromeMeshCache;
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
function snapView(preset) {
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
      let spanW, spanH;
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
      let halfW, halfH;
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

export { frameAll, frameSelected, snapView, VIEW_FRONT, VIEW_RIGHT, VIEW_TOP };
