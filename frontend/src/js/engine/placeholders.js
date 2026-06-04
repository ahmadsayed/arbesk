/**
 * Arbesk Scene Graph — Placeholders
 *
 * Box placeholder creation and disposal for token child nodes
 * in loading or error states.
 */

import { state, PLACEHOLDER_COLOR, ERROR_PLACEHOLDER_COLOR } from "./state.js";

/**
 * Create a placeholder mesh for token child nodes.
 * @param {string} nodeId
 * @param {BABYLON.TransformNode} parentNode
 * @param {"loading"|"error"} state
 */
export function createPlaceholder(nodeId, parentNode, placeholderState) {
  const color =
    placeholderState === "error" ? ERROR_PLACEHOLDER_COLOR : PLACEHOLDER_COLOR;
  const box = BABYLON.MeshBuilder.CreateBox(
    `placeholder_${nodeId}`,
    { size: 0.5 },
    state.scene
  );
  box.parent = parentNode;
  box.metadata = {
    nodeId,
    isPlaceholder: true,
    placeholderState,
  };

  const mat = new BABYLON.StandardMaterial(
    `placeholderMat_${nodeId}`,
    state.scene
  );
  mat.diffuseColor = BABYLON.Color3.FromHexString(color);
  mat.alpha = placeholderState === "loading" ? 0.6 : 0.8;
  box.material = mat;

  if (placeholderState === "loading") {
    const pulseAnim = new BABYLON.Animation(
      `pulse_${nodeId}`,
      "scaling",
      30,
      BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
      BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
    );
    pulseAnim.setKeys([
      { frame: 0, value: new BABYLON.Vector3(1, 1, 1) },
      { frame: 15, value: new BABYLON.Vector3(1.2, 1.2, 1.2) },
      { frame: 30, value: new BABYLON.Vector3(1, 1, 1) },
    ]);
    box.animations = [pulseAnim];
    state.scene.beginAnimation(box, 0, 30, true);
  }

  box.metadata = {
    ...box.metadata,
    _placeholderAnim: placeholderState === "loading",
  };

  return box;
}

/**
 * Dispose a placeholder mesh, stopping any running animation first.
 * Also releases the placeholder's material to prevent GPU memory leaks.
 */
export function disposePlaceholder(placeholder) {
  if (!placeholder || placeholder.isDisposed()) return;
  if (placeholder.metadata?._placeholderAnim) {
    state.scene.stopAnimation(placeholder);
  }
  // Dispose the mesh first, then the material (separately to avoid
  // shared-material cascade issues with mesh.dispose(false, true)).
  const mat = placeholder.material;
  placeholder.dispose();
  if (mat) {
    try {
      mat.dispose();
    } catch (_) {
      // ignore
    }
  }
}
