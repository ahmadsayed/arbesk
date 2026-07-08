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

let isDraggingHandle = false;

function createMaterial(scene, name, color) {
  const mat = new BABYLON.StandardMaterial(name, scene);
  mat.diffuseColor = color;
  return mat;
}

function buildGizmoForNode(scene, nodeId, hidden = false) {
  const anchor = state.nodeAnchors.get(nodeId);
  const meshes = state.nodeMeshes.get(nodeId) || [];
  const filtered = store.versionsForNode(nodeId);
  if (!anchor || filtered.length < 2) return null;

  /** @type {any} */
  const gizmo = { nodeId };

  const root = new BABYLON.TransformNode("modelClockRoot", scene);
  root.setParent(anchor);
  gizmo.root = root;

  // Compute radius from bounding box.
  let min = null;
  let max = null;
  for (const mesh of meshes) {
    if (!mesh || mesh.isDisposed()) continue;
    const bi = mesh.getBoundingInfo();
    if (!bi || !bi.boundingBox) continue;
    const bb = bi.boundingBox;
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
  gizmo.ring = ring;

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
  gizmo.ticks = ticks;

  // Handle.
  const handle = BABYLON.MeshBuilder.CreateSphere(
    HANDLE_NAME,
    { diameter: radius * 0.12 },
    scene
  );
  handle.setParent(root);
  handle.material = createMaterial(scene, "handleMat", new BABYLON.Color3(0.2, 0.6, 1));
  handle.renderingGroupId = 1;
  gizmo.handle = handle;
  gizmo.radius = radius;
  gizmo.filtered = filtered;

  const dragBehavior = new BABYLON.PointerDragBehavior({
    dragPlaneNormal: new BABYLON.Vector3(0, 1, 0),
  });
  dragBehavior.onDragStartObservable.add(() => {
    isDraggingHandle = true;
  });
  dragBehavior.onDragObservable.add(() => {
    // Project handle position onto ring circle in local XZ plane.
    const localX = handle.position.x;
    const localZ = handle.position.z;
    const angle = Math.atan2(localZ, localX);
    const idx = _indexForAngle((angle * 180) / Math.PI, filtered.length);
    const snapAngle = (_angleForIndex(idx, filtered.length) * Math.PI) / 180;
    handle.position = new BABYLON.Vector3(
      Math.cos(snapAngle) * radius,
      0,
      Math.sin(snapAngle) * radius
    );
    updateTickColors(gizmo, idx);
  });
  dragBehavior.onDragEndObservable.add(() => {
    isDraggingHandle = false;
    const localX = handle.position.x;
    const localZ = handle.position.z;
    const angle = Math.atan2(localZ, localX);
    const idx = _indexForAngle((angle * 180) / Math.PI, filtered.length);
    const entry = filtered[idx];
    if (entry && entry.cid !== store.getState().activeCid) {
      store.loadVersion(entry.cid);
    }
  });
  handle.addBehavior(dragBehavior);

  ring.isVisible = !hidden;
  for (const t of ticks) t.isVisible = !hidden;
  handle.isVisible = !hidden;

  return gizmo;
}

function syncHandlePosition(g, activeIdx) {
  const safeIdx = activeIdx >= 0 ? activeIdx : g.filtered.length - 1;
  const angle = (_angleForIndex(safeIdx, g.filtered.length) * Math.PI) / 180;
  g.handle.position = new BABYLON.Vector3(
    Math.cos(angle) * g.radius,
    0,
    Math.sin(angle) * g.radius
  );
}

function updateTickColors(g, activeIdx) {
  const s = store.getState();
  const safeIdx = activeIdx >= 0 ? activeIdx : g.filtered.length - 1;
  const publishedIdx = g.filtered.findIndex((e) => e.cid === s.publishedCid);

  for (let i = 0; i < g.ticks.length; i++) {
    const color =
      i === publishedIdx
        ? new BABYLON.Color3(0.2, 0.8, 0.2)
        : i === safeIdx
        ? new BABYLON.Color3(0.2, 0.6, 1)
        : new BABYLON.Color3(0.5, 0.5, 0.5);
    g.ticks[i].material.diffuseColor = color;
  }
}

function syncVisuals(g) {
  const s = store.getState();
  const activeIdx = g.filtered.findIndex((e) => e.cid === s.activeCid);
  const safeIdx = activeIdx >= 0 ? activeIdx : g.filtered.length - 1;
  updateTickColors(g, safeIdx);
  if (!isDraggingHandle) {
    syncHandlePosition(g, safeIdx);
  }
}

export function initModelClockGizmo(scene, camera) {
  // camera is reserved for badge projection in Task 7.
  void camera;
  let current = null;
  let currentNodeId = null;

  function render() {
    if (!current) return;
    const hidden = state.isGizmoDragging;
    current.ring.isVisible = !hidden;
    for (const t of current.ticks) t.isVisible = !hidden;
    current.handle.isVisible = !hidden;
    syncVisuals(current);
  }

  function onSelect(e) {
    destroyCurrent();
    const nodeId = e?.nodeId || state.highlightedNodeId;
    if (!nodeId) return;
    currentNodeId = nodeId;
    current = buildGizmoForNode(scene, nodeId, state.isGizmoDragging);
    if (current) {
      syncVisuals(current);
    }
  }

  function destroyCurrent() {
    if (current) {
      current.root.dispose(false, true);
      current = null;
    }
    currentNodeId = null;
    isDraggingHandle = false;
  }

  function onStoreChange() {
    if (current && currentNodeId) {
      const latest = store.versionsForNode(currentNodeId);
      if (latest.length !== current.filtered.length) {
        destroyCurrent();
        current = buildGizmoForNode(scene, currentNodeId, state.isGizmoDragging);
        if (current) {
          syncVisuals(current);
        }
        return;
      }
    }
    render();
  }

  const unsubscribeSelected = on(EVENTS.NODE_SELECTED, onSelect);
  const unsubscribeDeselected = on(EVENTS.NODE_DESELECTED, destroyCurrent);
  const unsubscribeEmpty = on(EVENTS.SCENE_EMPTY, destroyCurrent);
  const renderHandle = scene.onBeforeRenderObservable.add(render);
  const unsubscribeStore = store.subscribe(onStoreChange);

  return function destroy() {
    destroyCurrent();
    unsubscribeSelected();
    unsubscribeDeselected();
    unsubscribeEmpty();
    unsubscribeStore();
    scene.onBeforeRenderObservable.remove(renderHandle);
  };
}
