/**
 * Anchor node factory — leaf module.
 *
 * scene-loader needs anchors while loading; scene-graph needs the loader for
 * linked assets. Keeping the factory here (BABYLON global only) avoids a
 * scene-graph ↔ scene-loader import cycle.
 */

/**
 * @param {string} name
 * @param {BABYLON.Scene} scene
 * @returns {BABYLON.TransformNode | BABYLON.Mesh}
 */
export function createAnchorNode(name: string, scene: BABYLON.Scene) {
  if (
    typeof BABYLON !== "undefined" &&
    typeof BABYLON.TransformNode === "function"
  ) {
    const node = new BABYLON.TransformNode(name, scene);
    // Babylon's gizmos write rotation into rotationQuaternion when it exists,
    // but fall back to Euler `rotation` when it is null — and the transform
    // staging path reads only the quaternion, silently dropping Euler edits.
    // Seeding an identity quaternion keeps every anchor on the quaternion path.
    node.rotationQuaternion = BABYLON.Quaternion.Identity();
    return node;
  }
  console.warn(
    "[SCENE] BABYLON.TransformNode not available, using invisible Mesh fallback"
  );
  const fallback = BABYLON.MeshBuilder.CreateBox(name, { size: 0.001 }, scene);
  fallback.isVisible = false;
  fallback.isPickable = false;
  return fallback;
}
