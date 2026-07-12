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
 * The ring lies in the XY plane, so the radius is driven by the larger of
 * the X and Y extents (Z is ignored).
 *
 * @param {BABYLON.Vector3} min
 * @param {BABYLON.Vector3} max
 */
export function _ringRadiusFromBounds(min, max) {
  const dx = max.x - min.x;
  const dy = max.y - min.y;
  return Math.min(
    MAX_RING_RADIUS,
    Math.max(MIN_RING_RADIUS, (Math.max(dx, dy) / 2) * RING_RADIUS_FACTOR)
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

/**
 * Ray/plane intersection on plain {x,y,z} vectors.
 * Returns the hit point, or null when the ray is parallel to the plane or
 * the plane lies behind the ray origin.
 *
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} dir
 * @param {{x:number,y:number,z:number}} planePoint
 * @param {{x:number,y:number,z:number}} planeNormal
 * @returns {{x:number,y:number,z:number}|null}
 */
export function _rayPlaneIntersect(origin, dir, planePoint, planeNormal) {
  const denom =
    dir.x * planeNormal.x + dir.y * planeNormal.y + dir.z * planeNormal.z;
  if (Math.abs(denom) < 1e-9) return null;
  const t =
    ((planePoint.x - origin.x) * planeNormal.x +
      (planePoint.y - origin.y) * planeNormal.y +
      (planePoint.z - origin.z) * planeNormal.z) /
    denom;
  if (t < 0) return null;
  return {
    x: origin.x + dir.x * t,
    y: origin.y + dir.y * t,
    z: origin.z + dir.z * t,
  };
}

/**
 * Interpolate between two angles (radians) along the shortest arc.
 *
 * @param {number} from
 * @param {number} to
 * @param {number} t
 * @returns {number}
 */
export function _lerpAngle(from, to, t) {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return from + d * t;
}

const RING_NAME = "versionRing";
const HANDLE_NAME = "versionHandle";
const TICK_PREFIX = "versionTick";
const ARROW_NAME = "versionArrow";
const RING_TESSELLATION = 64;

// Flat, unlit gizmo palette (matches Babylon transform-gizmo styling).
const COLOR_RING = [0.65, 0.65, 0.65];
const COLOR_TICK = [0.5, 0.5, 0.5];
const COLOR_ACTIVE = [0.2, 0.6, 1];
const COLOR_PUBLISHED = [0.2, 0.8, 0.2];
const COLOR_HOVER = [1, 1, 0.4];

const DRAG_SMOOTHING = 0.5;

let isDraggingHandle = false;

function createGizmoMaterial(scene, name, [r, g, b]) {
  const mat = new BABYLON.StandardMaterial(name, scene);
  mat.emissiveColor = new BABYLON.Color3(r, g, b);
  mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  mat.disableLighting = true;
  return mat;
}

/** The shared gizmo utility layer scene; falls back to the main scene when
 * the utility layer is unavailable (older Babylon builds).
 * @param {BABYLON.Scene} mainScene
 */
function utilityScene(mainScene) {
  return (
    BABYLON.UtilityLayerRenderer?.DefaultUtilityLayer?.utilityLayerScene ||
    mainScene
  );
}

/** Position + orient the handle (and badge host) at an angle on the ring.
 * @param {any} g
 * @param {number} angleRad
 */
function placeHandle(g, angleRad) {
  g.handle.position = new BABYLON.Vector3(
    Math.cos(angleRad) * g.radius,
    Math.sin(angleRad) * g.radius,
    0
  );
  g.handle.rotation.z = angleRad;
  if (g.badgeHost) {
    // Sit the badge just outside the ring, radially past the handle, so the
    // DOM label doesn't fully occlude the handle mesh underneath it.
    const badgeRadius = g.radius + g.radius * 0.22;
    g.badgeHost.position = new BABYLON.Vector3(
      Math.cos(angleRad) * badgeRadius,
      Math.sin(angleRad) * badgeRadius,
      0
    );
  }
}

/** Copy the anchor's world position/rotation to the unparented gizmo root.
 * Scale is intentionally NOT copied: the radius is already computed from
 * world-space bounds, so inheriting anchor scale would double-scale the ring.
 * @param {any} root
 * @param {any} anchor
 */
function syncRootToAnchor(root, anchor) {
  if (!anchor || anchor.isDisposed?.()) return;
  root.position.copyFrom(anchor.getAbsolutePosition());
  const rot = anchor.absoluteRotationQuaternion;
  if (rot) {
    if (root.rotationQuaternion) root.rotationQuaternion.copyFrom(rot);
    else root.rotationQuaternion = rot.clone();
  }
}

function buildGizmoForNode(scene, nodeId) {
  const anchor = state.nodeAnchors.get(nodeId);
  const meshes = state.nodeMeshes.get(nodeId) || [];
  // Show the full asset version chain on the model clock so the active
  // version always has a tick and the scene/model clocks stay in sync.
  const filtered = store.getState().entries;
  if (!anchor || filtered.length < 2) return null;

  const uScene = utilityScene(scene);

  /** @type {any} */
  const gizmo = { nodeId, anchor, dragHoverIdx: -1 };

  const root = new BABYLON.TransformNode("modelClockRoot", uScene);
  gizmo.root = root;

  // Compute radius from the node's world bounding box.
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
  gizmo.radius = radius;
  gizmo.filtered = filtered;

  syncRootToAnchor(root, anchor);

  // Ring: thin flat torus in the XY plane.
  const ring = BABYLON.MeshBuilder.CreateTorus(
    RING_NAME,
    { diameter: radius * 2, thickness: radius * 0.005, tessellation: RING_TESSELLATION },
    uScene
  );
  ring.setParent(root);
  ring.material = createGizmoMaterial(uScene, "ringMat", COLOR_RING);
  // CreateTorus defaults to the XZ plane in this Babylon build; rotate to XY.
  ring.rotation.x = Math.PI / 2;
  ring.isPickable = false;
  gizmo.ring = ring;

  // Ticks: radial marks like clock minute marks (local X = radial).
  const ticks = [];
  for (let i = 0; i < filtered.length; i++) {
    const angle = (_angleForIndex(i, filtered.length) * Math.PI) / 180;
    const tick = BABYLON.MeshBuilder.CreateBox(
      `${TICK_PREFIX}-${i}`,
      { width: radius * 0.1, height: radius * 0.02, depth: radius * 0.02 },
      uScene
    );
    tick.setParent(root);
    tick.position = new BABYLON.Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0
    );
    tick.rotation.z = angle;
    tick.material = createGizmoMaterial(uScene, `tickMat-${i}`, COLOR_TICK);
    tick.isPickable = false;
    ticks.push(tick);
  }
  gizmo.ticks = ticks;

  // Arrowhead: cone just past the newest tick, pointing "toward newer"
  // (decreasing angle / clockwise, matching _angleForIndex ordering).
  const n = filtered.length;
  const newestAngle = (_angleForIndex(n - 1, n) * Math.PI) / 180;
  const arrowAngle = newestAngle - Math.min(0.35, Math.PI / n);
  const arrow = BABYLON.MeshBuilder.CreateCylinder(
    ARROW_NAME,
    { height: radius * 0.08, diameterTop: 0, diameterBottom: radius * 0.05, tessellation: 12 },
    uScene
  );
  arrow.setParent(root);
  arrow.position = new BABYLON.Vector3(
    Math.cos(arrowAngle) * radius,
    Math.sin(arrowAngle) * radius,
    0
  );
  // Cone axis is +Y; rotating by (angle + PI) aligns it with the clockwise
  // tangent (sin a, -cos a, 0).
  arrow.rotation.z = arrowAngle + Math.PI;
  arrow.material = createGizmoMaterial(uScene, "arrowMat", COLOR_RING);
  arrow.isPickable = false;
  gizmo.arrow = arrow;

  // Handle: tangent lozenge seated on the ring (local Y = tangent).
  const handle = BABYLON.MeshBuilder.CreateBox(
    HANDLE_NAME,
    { width: radius * 0.05, height: radius * 0.16, depth: radius * 0.05 },
    uScene
  );
  handle.setParent(root);
  gizmo.handleMat = createGizmoMaterial(uScene, "handleMat", COLOR_ACTIVE);
  gizmo.handleHoverMat = createGizmoMaterial(uScene, "handleHoverMat", COLOR_HOVER);
  handle.material = gizmo.handleMat;
  gizmo.handle = handle;

  const badgeHost = new BABYLON.TransformNode("modelClockBadgeHost", uScene);
  badgeHost.setParent(root);
  gizmo.badgeHost = badgeHost;

  return gizmo;
}

function syncHandlePosition(g, activeIdx, badge) {
  const safeIdx = activeIdx >= 0 ? activeIdx : g.filtered.length - 1;
  const angle = (_angleForIndex(safeIdx, g.filtered.length) * Math.PI) / 180;
  placeHandle(g, angle);
  if (badge) {
    badge.textContent = `v${g.filtered[safeIdx].version}`;
  }
}

function updateTickColors(g, activeIdx) {
  const s = store.getState();
  const safeIdx = activeIdx >= 0 ? activeIdx : g.filtered.length - 1;
  const publishedIdx = g.filtered.findIndex((e) => e.cid === s.publishedCid);

  for (let i = 0; i < g.ticks.length; i++) {
    const rgb =
      i === publishedIdx ? COLOR_PUBLISHED : i === safeIdx ? COLOR_ACTIVE : COLOR_TICK;
    g.ticks[i].material.emissiveColor = new BABYLON.Color3(rgb[0], rgb[1], rgb[2]);
  }
}

function syncVisuals(g, badge) {
  const s = store.getState();
  const activeIdx = g.filtered.findIndex((e) => e.cid === s.activeCid);
  const safeIdx = activeIdx >= 0 ? activeIdx : g.filtered.length - 1;
  const colorIdx = isDraggingHandle && g.dragHoverIdx >= 0 ? g.dragHoverIdx : safeIdx;
  updateTickColors(g, colorIdx);
  if (!isDraggingHandle) {
    syncHandlePosition(g, safeIdx, badge);
  }
}

/** Wire rotation-gizmo-style drag + hover on the handle.
 * @param {any} gizmo
 * @param {BABYLON.Scene} mainScene
 * @param {BABYLON.ArcRotateCamera} camera
 */
function wireDrag(gizmo, mainScene, camera) {
  const uScene = utilityScene(mainScene);
  const canvas = mainScene.getEngine().getRenderingCanvas();

  function ringAngleFromPointer() {
    const ray = mainScene.createPickingRay(
      mainScene.pointerX,
      mainScene.pointerY,
      null,
      camera
    );
    const rootPos = gizmo.root.getAbsolutePosition();
    const rot = gizmo.root.rotationQuaternion;
    const normal = rot
      ? new BABYLON.Vector3(0, 0, 1).applyRotationQuaternion(rot)
      : new BABYLON.Vector3(0, 0, 1);
    const hit = _rayPlaneIntersect(ray.origin, ray.direction, rootPos, normal);
    if (!hit) return null;
    const world = new BABYLON.Vector3(hit.x, hit.y, hit.z);
    const local = rot
      ? world.subtract(rootPos).applyRotationQuaternion(BABYLON.Quaternion.Inverse(rot))
      : world.subtract(rootPos);
    return Math.atan2(local.y, local.x);
  }

  gizmo.pointerObserver = uScene.onPointerObservable.add((pi) => {
    const picked = pi.pickInfo?.pickedMesh;
    switch (pi.type) {
      case BABYLON.PointerEventTypes.POINTERDOWN: {
        if (picked !== gizmo.handle) return;
        isDraggingHandle = true;
        gizmo.dragAngle = Math.atan2(gizmo.handle.position.y, gizmo.handle.position.x);
        gizmo.dragTargetAngle = gizmo.dragAngle;
        gizmo.dragHoverIdx = -1;
        camera.detachControl();
        if (canvas) canvas.style.cursor = "grabbing";
        break;
      }
      case BABYLON.PointerEventTypes.POINTERMOVE: {
        if (!isDraggingHandle) {
          const hovered = picked === gizmo.handle;
          gizmo.handle.material = hovered ? gizmo.handleHoverMat : gizmo.handleMat;
          if (canvas) canvas.style.cursor = hovered ? "grab" : "";
          return;
        }
        const target = ringAngleFromPointer();
        if (target === null) return;
        gizmo.dragTargetAngle = target;
        gizmo.dragAngle = _lerpAngle(gizmo.dragAngle, target, DRAG_SMOOTHING);
        placeHandle(gizmo, gizmo.dragAngle);
        gizmo.dragHoverIdx = _indexForAngle(
          (gizmo.dragTargetAngle * 180) / Math.PI,
          gizmo.filtered.length
        );
        updateTickColors(gizmo, gizmo.dragHoverIdx);
        break;
      }
      case BABYLON.PointerEventTypes.POINTERUP: {
        if (!isDraggingHandle) return;
        isDraggingHandle = false;
        camera.attachControl(canvas, true);
        if (canvas) canvas.style.cursor = "";
        // Commit where the cursor actually is, not the smoothed position.
        const idx = _indexForAngle(
          (gizmo.dragTargetAngle * 180) / Math.PI,
          gizmo.filtered.length
        );
        gizmo.dragHoverIdx = -1;
        placeHandle(gizmo, (_angleForIndex(idx, gizmo.filtered.length) * Math.PI) / 180);
        const entry = gizmo.filtered[idx];
        if (entry && entry.cid !== store.getState().activeCid) {
          store.loadVersion(entry.cid);
        }
        break;
      }
    }
  });
}

export function initModelClockGizmo(scene, camera) {
  const viewport = document.getElementById("viewport");
  let badge = document.getElementById("modelClockBadge");
  if (!badge && viewport) {
    badge = document.createElement("div");
    badge.id = "modelClockBadge";
    badge.className = "model-clock-badge";
    viewport.appendChild(badge);
  }

  let current = null;
  let currentNodeId = null;

  function render() {
    if (!current) return;
    syncRootToAnchor(current.root, current.anchor);
    syncVisuals(current, badge);

    if (badge && current.badgeHost) {
      const world = current.badgeHost.getAbsolutePosition
        ? current.badgeHost.getAbsolutePosition()
        : new BABYLON.Vector3(0, 0, 0);
      const engine = scene.getEngine();
      const projected = BABYLON.Vector3.Project(
        world,
        BABYLON.Matrix.Identity(),
        scene.getTransformMatrix(),
        camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
      );
      const canvas = engine.getRenderingCanvas();
      const sx = canvas.clientWidth / engine.getRenderWidth();
      const sy = canvas.clientHeight / engine.getRenderHeight();
      badge.style.transform = `translate(${projected.x * sx}px, ${projected.y * sy}px) translate(-50%, -50%)`;
      badge.hidden = projected.z < 0 || projected.z > 1;
    }
  }

  function onSelect(e) {
    destroyCurrent();
    if (state.transformMode !== "time") return;
    const nodeId = e?.nodeId || state.highlightedNodeId;
    if (!nodeId) return;
    currentNodeId = nodeId;
    current = buildGizmoForNode(scene, nodeId);
    if (current) {
      wireDrag(current, scene, camera);
      syncVisuals(current, badge);
    }
  }

  function destroyCurrent() {
    if (current) {
      if (current.pointerObserver) {
        utilityScene(scene).onPointerObservable.remove(current.pointerObserver);
      }
      current.handleHoverMat?.dispose();
      current.root.dispose(false, true);
      current = null;
    }
    currentNodeId = null;
    isDraggingHandle = false;
    if (badge) badge.hidden = true;
  }

  function onModeChanged(e) {
    if (e?.mode === "time") {
      if (state.highlightedNodeId) onSelect({ nodeId: state.highlightedNodeId });
    } else {
      destroyCurrent();
    }
  }

  function onStoreChange() {
    if (current && currentNodeId) {
      const latest = store.getState().entries;
      if (latest.length !== current.filtered.length) {
        destroyCurrent();
        current = buildGizmoForNode(scene, currentNodeId);
        if (current) {
          wireDrag(current, scene, camera);
          syncVisuals(current, badge);
        }
        return;
      }
    }
    render();
  }

  function onKeyDown(e) {
    if (!current) return;
    if (state.transformMode !== "time") return;
    const tag = document.activeElement?.tagName?.toLowerCase();
    const editable =
      document.activeElement?.isContentEditable ||
      tag === "input" ||
      tag === "textarea" ||
      tag === "select";
    if (editable) return;

    const n = current.filtered.length;
    let idx = null;
    const activeIdx = current.filtered.findIndex(
      (entry) => entry.cid === store.getState().activeCid
    );
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        idx = Math.max(0, activeIdx - 1);
        break;
      case "ArrowRight":
      case "ArrowUp":
        idx = Math.min(n - 1, activeIdx + 1);
        break;
      case "Home":
        idx = 0;
        break;
      case "End":
        idx = n - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const entry = current.filtered[idx];
    if (entry && entry.cid !== store.getState().activeCid) {
      store.loadVersion(entry.cid);
    }
  }

  const unsubscribeSelected = on(EVENTS.NODE_SELECTED, onSelect);
  const unsubscribeDeselected = on(EVENTS.NODE_DESELECTED, destroyCurrent);
  const unsubscribeCleared = on(EVENTS.SCENE_CLEARED, destroyCurrent);
  const unsubscribeEmpty = on(EVENTS.SCENE_EMPTY, destroyCurrent);
  const unsubscribeMode = on(EVENTS.TRANSFORM_MODE_CHANGED, onModeChanged);
  const renderHandle = scene.onBeforeRenderObservable.add(render);
  const unsubscribeStore = store.subscribe(onStoreChange);

  document.addEventListener("keydown", onKeyDown);

  return function destroy() {
    destroyCurrent();
    unsubscribeSelected();
    unsubscribeDeselected();
    unsubscribeCleared();
    unsubscribeEmpty();
    unsubscribeMode();
    unsubscribeStore();
    scene.onBeforeRenderObservable.remove(renderHandle);
    document.removeEventListener("keydown", onKeyDown);
    badge?.remove();
  };
}
