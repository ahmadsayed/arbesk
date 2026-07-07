// TODO: tighten types for Babylon mesh API and strict event typing; currently too dynamic for checkJs.
// @ts-nocheck
/**
 * Model Clock Gizmo — 3D Babylon ring for scrubbing a node's version history.
 */

import * as store from "../state/version-history-store.js";
import { on, EVENTS } from "../events/bus.js";
import { state } from "../engine/state.js";

const RING_RADIUS_FACTOR = 1.4;
const MIN_RING_RADIUS = 0.5;
const MAX_RING_RADIUS = 8.0;

/**
 * Compute world-space ring radius from a node bounding box so the ring
 * always encircles the model without dominating the view.
 *
 * The ring lies in the XZ plane, so the radius is driven by the larger of
 * the X and Z extents (Y is ignored).
 *
 * @param {BABYLON.Vector3} min
 * @param {BABYLON.Vector3} max
 */
export function _ringRadiusFromBounds(min, max) {
  const dx = max.x - min.x;
  const dz = max.z - min.z;
  return Math.min(
    MAX_RING_RADIUS,
    Math.max(MIN_RING_RADIUS, (Math.max(dx, dz) / 2) * RING_RADIUS_FACTOR)
  );
}

/** Angle in degrees for entry index i of n. Newest runs clockwise into past.
 * @param {number} i
 * @param {number} n
 * @returns {number}
 */
export function _angleForIndex(i, n) {
  if (n === 0) return -90;
  return -90 + ((n - 1 - i) * 360) / n;
}

/** Snap a signed angle in degrees to the nearest version index.
 * @param {number} angleDeg
 * @param {number} n
 * @returns {number}
 */
export function _indexForAngle(angleDeg, n) {
  if (n === 0) return -1;
  // Normalize so 0° = 12 o'clock (-90° in standard math coords).
  const a = (((angleDeg + 90) % 360) + 360) % 360;
  const steps = Math.round((a * n) / 360);
  return (n - 1 - steps + n) % n;
}

const RING_NAME = "versionRing";
const HANDLE_NAME = "versionHandle";
const TICK_PREFIX = "versionTick";
const RING_TESSELLATION = 64;
const TICK_RADIUS = 0.04;

function createMaterial(scene, name, color) {
  const mat = new BABYLON.StandardMaterial(name, scene);
  mat.diffuseColor = color;
  return mat;
}

function buildGizmoForNode(scene, camera, nodeId) {
  const anchor = state.nodeAnchors.get(nodeId);
  const meshes = state.nodeMeshes.get(nodeId) || [];
  const filtered = store.versionsForNode(nodeId);
  if (!anchor || filtered.length < 2) return null;

  const root = new BABYLON.TransformNode("modelClockRoot", scene);
  root.setParent(anchor);

  // Compute radius from bounding box.
  let min = null;
  let max = null;
  for (const mesh of meshes) {
    if (!mesh || mesh.isDisposed()) continue;
    const bb = mesh.getBoundingInfo().boundingBox;
    min = min ? BABYLON.Vector3.Minimize(min, bb.minimumWorld) : bb.minimumWorld.clone();
    max = max ? BABYLON.Vector3.Maximize(max, bb.maximumWorld) : bb.maximumWorld.clone();
  }
  const radius = min && max ? _ringRadiusFromBounds(min, max) : MIN_RING_RADIUS;

  // Ring.
  const ring = BABYLON.MeshBuilder.CreateTorus(
    RING_NAME,
    { diameter: radius * 2, thickness: radius * 0.03, tessellation: RING_TESSELLATION },
    scene
  );
  ring.setParent(root);
  ring.material = createMaterial(scene, "ringMat", new BABYLON.Color3(0.65, 0.65, 0.65));
  ring.renderingGroupId = 1;

  // Ticks.
  const ticks = [];
  for (let i = 0; i < filtered.length; i++) {
    const angle = (_angleForIndex(i, filtered.length) * Math.PI) / 180;
    const tick = BABYLON.MeshBuilder.CreateSphere(
      `${TICK_PREFIX}-${i}`,
      { diameter: radius * TICK_RADIUS * 2 },
      scene
    );
    tick.setParent(root);
    tick.position = new BABYLON.Vector3(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius
    );
    tick.material = createMaterial(scene, `tickMat-${i}`, new BABYLON.Color3(0.5, 0.5, 0.5));
    tick.renderingGroupId = 1;
    ticks.push(tick);
  }

  // Handle.
  const handle = BABYLON.MeshBuilder.CreateSphere(
    HANDLE_NAME,
    { diameter: radius * 0.12 },
    scene
  );
  handle.setParent(root);
  handle.material = createMaterial(scene, "handleMat", new BABYLON.Color3(0.2, 0.6, 1));
  handle.renderingGroupId = 1;

  return { root, ring, ticks, handle, radius, filtered };
}

export function initModelClockGizmo(scene, camera) {
  let current = null;

  function onSelect() {
    destroyCurrent();
    const nodeId = state.highlightedNodeId;
    if (!nodeId) return;
    current = buildGizmoForNode(scene, camera, nodeId);
    if (current) {
      placeHandle(current);
    }
  }

  function destroyCurrent() {
    if (current) {
      current.root.dispose();
      current = null;
    }
  }

  function placeHandle(g) {
    const s = store.getState();
    const idx = g.filtered.findIndex((e) => e.cid === s.activeCid);
    const safeIdx = idx >= 0 ? idx : g.filtered.length - 1;
    const angle = (_angleForIndex(safeIdx, g.filtered.length) * Math.PI) / 180;
    g.handle.position = new BABYLON.Vector3(
      Math.cos(angle) * g.radius,
      0,
      Math.sin(angle) * g.radius
    );
  }

  on(EVENTS.NODE_SELECTED, onSelect);
  on(EVENTS.NODE_DESELECTED, destroyCurrent);
  on(EVENTS.SCENE_EMPTY, destroyCurrent);
}
