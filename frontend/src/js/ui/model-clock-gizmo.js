// TODO: tighten types for Babylon mesh API and strict event typing; currently too dynamic for checkJs.
// @ts-nocheck
/**
 * Model Clock Gizmo — 3D Babylon ring for scrubbing a node's version history.
 */

import * as store from "../state/version-history-store.js";
import { on, EVENTS } from "../events/bus.js";
import { state } from "../engine/state.js";

const RING_RADIUS_FACTOR = 1.15;
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
 * Ray/plane intersection. Inputs may be plain {x,y,z} objects or
 * BABYLON.Vector3 instances; the returned hit point is a plain object.
 * Returns null when the ray is parallel to the plane or the plane lies
 * behind the ray origin.
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
const ARC_NAME = "versionArc";
const HANDLE_NAME = "versionHandle";
const TICK_PREFIX = "versionTick";
const RING_TESSELLATION = 64;

// Flat, unlit gizmo palette (matches Babylon transform-gizmo styling).
const COLOR_RING = [0.65, 0.65, 0.65];
const COLOR_TICK = [0.72, 0.72, 0.76]; // lighter than the track so ticks stay legible under the opaque arc
const COLOR_ACTIVE = [0.2, 0.6, 1];
const COLOR_PUBLISHED = [0.2, 0.8, 0.2];
const COLOR_HOVER = [1, 1, 0.4];
const COLOR_KNOB_RIM = [0.78, 0.92, 1]; // bright highlight rim so the knob reads as raised, not flat

const DRAG_SMOOTHING = 0.5;
// How far outside the ring the DOM tick labels sit, as a multiple of the
// ring radius, so they don't occlude the 3D tick/handle meshes.
const LABEL_RADIUS_FACTOR = 1.12;

// The badge sits a little further out than the tick labels so it clears the
// knob and its rim.
const BADGE_RADIUS_FACTOR = 1.22;

// Translucent analog-clock styling.
const CLOCK_ALPHA = 0.5; // alpha for track/face accents
const TICK_ALPHA = 0.85; // ticks stay opaque-ish so they don't wash out under the arc/track
const FACE_ALPHA = 0.30; // slightly darker face
const HANDLE_ALPHA = 1.0; // knob stays prominent
const CLOCK_DEPTH_OFFSET_FACTOR = 0.3; // how far behind the anchor the clock sits
const FACE_RADIUS_FACTOR = 1.05; // face extends slightly past the ring
const FACE_Z_OFFSET_FACTOR = 0.02; // face sits just behind the ticks in local Z
const FACE_COLOR = [0.08, 0.08, 0.10];

// Track / knob sizing (fractions of the ring radius).
const TRACK_THICKNESS_FACTOR = 0.015;
const TICK_WIDTH_FACTOR = 0.12;
const TICK_THICKNESS_FACTOR = 0.035;
const KNOB_DIAMETER_FACTOR = 0.16;
const KNOB_HEIGHT_FACTOR = 0.03;
const RIM_THICKNESS_FACTOR = 0.022;

let isDraggingHandle = false;

function createGizmoMaterial(scene, name, [r, g, b], alpha = 1.0) {
  const mat = new BABYLON.StandardMaterial(name, scene);
  mat.emissiveColor = new BABYLON.Color3(r, g, b);
  mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  mat.disableLighting = true;
  if (alpha < 1.0) {
    mat.alpha = alpha;
    mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  }
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

const ARC_SHADER_NAME = "modelClockArc";
const ARC_THICKNESS_FACTOR = 0.021; // slightly fatter than the track so it fully covers it
const ARC_Z_OFFSET_FACTOR = 0.01; // nudged toward the viewer to avoid z-fighting the track

/** Register the arc-clipping shader sources once per page. The fragment
 * shader discards everything outside the clockwise sweep from startAngle,
 * so drags only ever update one float uniform — no mesh rebuilds. */
function ensureArcShader() {
  if (BABYLON.Effect.ShadersStore[`${ARC_SHADER_NAME}VertexShader`]) return;
  BABYLON.Effect.ShadersStore[`${ARC_SHADER_NAME}VertexShader`] = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    varying vec2 vLocalXY;
    void main() {
      vLocalXY = position.xy;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }`;
  BABYLON.Effect.ShadersStore[`${ARC_SHADER_NAME}FragmentShader`] = `
    precision highp float;
    varying vec2 vLocalXY;
    uniform float startAngle;
    uniform float sweep;
    void main() {
      float TWO_PI = 6.28318530718;
      float ang = atan(vLocalXY.y, vLocalXY.x);
      float off = mod(startAngle - ang, TWO_PI);
      if (off > sweep) discard;
      gl_FragColor = vec4(0.2, 0.6, 1.0, 1.0);
    }`;
}

/** Position + orient the handle at an angle on the ring.
 * @param {any} g
 * @param {number} angleRad
 */
function placeHandle(g, angleRad) {
  g.handle.position = new BABYLON.Vector3(
    Math.cos(angleRad) * g.radius,
    Math.sin(angleRad) * g.radius,
    0
  );
  const badgeR = g.radius * BADGE_RADIUS_FACTOR;
  g.badgeHost.position = new BABYLON.Vector3(
    Math.cos(angleRad) * badgeR,
    Math.sin(angleRad) * badgeR,
    0
  );
  if (g.arcMat) {
    const TWO_PI = Math.PI * 2;
    const sweep = (((g.arcStartAngle - angleRad) % TWO_PI) + TWO_PI) % TWO_PI;
    g.arcMat.setFloat("sweep", sweep);
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

/** Position the clock root behind the anchor along the camera view ray and
 * billboard it so the clock face points at the viewer.
 * @param {any} root
 * @param {any} anchor
 * @param {BABYLON.ArcRotateCamera} camera
 * @param {number} offset
 */
function syncRootToCamera(root, anchor, camera, offset) {
  if (!anchor || anchor.isDisposed?.()) return;
  const anchorPos = anchor.getAbsolutePosition();
  const cameraPos = camera.position;
  const dir = anchorPos.subtract(cameraPos);
  const dist = dir.length();
  if (dist < 0.001) return; // camera coincident with anchor; keep previous pose
  const forward = dir.scale(1 / dist);
  root.position.copyFrom(anchorPos.subtract(forward.scale(offset)));
  root.lookAt(cameraPos);
  // lookAt sets Euler rotation; keep rotationQuaternion in sync so the drag
  // plane math can transform world hit points back into root-local space.
  root.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(
    root.rotation.x,
    root.rotation.y,
    root.rotation.z
  );
}

/** Compute the radius of the model's silhouette on the billboarded ring plane.
 * This measures how far the bounding box extends from the anchor center when
 * projected onto the plane perpendicular to the camera, so the ring can keep a
 * consistent padding around the visible model regardless of viewport aspect.
 * @param {any} gizmo
 * @returns {number}
 */
function silhouetteRadiusOnClockPlane(gizmo) {
  const min = gizmo.boundsMin;
  const max = gizmo.boundsMax;
  if (!min || !max) return gizmo.radius;

  const rootPos = gizmo.root.getAbsolutePosition();
  const rot = gizmo.root.rotationQuaternion;
  const invRot = rot ? BABYLON.Quaternion.Inverse(rot) : null;

  let maxDistSq = 0;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        const corner = new BABYLON.Vector3(x, y, z);
        const local = corner.subtract(rootPos);
        if (invRot) local.applyRotationQuaternion(invRot);
        const distSq = local.x * local.x + local.y * local.y;
        if (distSq > maxDistSq) maxDistSq = distSq;
      }
    }
  }
  return Math.sqrt(maxDistSq);
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

  // Compute radius from the node's world bounding box. Force world-matrix
  // updates first: after a version load the scene has not rendered yet, so
  // boundingBox.{minimum,maximum}World may still reflect pre-centering local
  // bounds and produce an oversized ring.
  let min = null;
  let max = null;
  for (const mesh of meshes) {
    if (!mesh || mesh.isDisposed()) continue;
    mesh.computeWorldMatrix(true);
    if (typeof mesh.refreshBoundingInfo === "function") {
      mesh.refreshBoundingInfo();
    }
    const bi = mesh.getBoundingInfo();
    if (!bi || !bi.boundingBox) continue;
    const bb = bi.boundingBox;
    min = min ? BABYLON.Vector3.Minimize(min, bb.minimumWorld) : bb.minimumWorld.clone();
    max = max ? BABYLON.Vector3.Maximize(max, bb.maximumWorld) : bb.maximumWorld.clone();
  }
  const radius = min && max ? _ringRadiusFromBounds(min, max) : MIN_RING_RADIUS;
  gizmo.radius = radius;
  gizmo.boundsMin = min;
  gizmo.boundsMax = max;
  gizmo.filtered = filtered;

  syncRootToAnchor(root, anchor);

  // Clock face: translucent dark disc that sits just behind the ticks.
  const face = BABYLON.MeshBuilder.CreateDisc(
    "modelClockFace",
    { radius: radius * FACE_RADIUS_FACTOR, tessellation: RING_TESSELLATION },
    uScene
  );
  face.setParent(root);
  face.position = new BABYLON.Vector3(0, 0, -radius * FACE_Z_OFFSET_FACTOR);
  face.material = createGizmoMaterial(uScene, "faceMat", FACE_COLOR, FACE_ALPHA);
  face.isPickable = false;
  gizmo.face = face;

  // Ring: flat torus track in the XY plane.
  const ring = BABYLON.MeshBuilder.CreateTorus(
    RING_NAME,
    { diameter: radius * 2, thickness: radius * TRACK_THICKNESS_FACTOR, tessellation: RING_TESSELLATION },
    uScene
  );
  ring.setParent(root);
  ring.material = createGizmoMaterial(uScene, "ringMat", COLOR_RING, CLOCK_ALPHA);
  // CreateTorus defaults to the XZ plane in this Babylon build; rotate to XY.
  ring.rotation.x = Math.PI / 2;
  ring.isPickable = false;
  gizmo.ring = ring;

  // Progress arc: accent torus overlaying the track, clipped by the shader
  // to the clockwise sweep from v1's tick to the knob. The filled/unfilled
  // boundary IS the current position, which also communicates direction.
  const arc = BABYLON.MeshBuilder.CreateTorus(
    ARC_NAME,
    { diameter: radius * 2, thickness: radius * ARC_THICKNESS_FACTOR, tessellation: RING_TESSELLATION },
    uScene
  );
  arc.setParent(root);
  arc.rotation.x = Math.PI / 2;
  // Bake the XZ→XY rotation into the vertices so the shader's mesh-local
  // position.xy is the ring plane and atan2(y, x) is the ring angle.
  arc.bakeCurrentTransformIntoVertices();
  arc.position = new BABYLON.Vector3(0, 0, radius * ARC_Z_OFFSET_FACTOR);
  ensureArcShader();
  const arcMat = new BABYLON.ShaderMaterial("arcMat", uScene, ARC_SHADER_NAME, {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "startAngle", "sweep"],
  });
  arcMat.backFaceCulling = false;
  gizmo.arcStartAngle = (_angleForIndex(0, filtered.length) * Math.PI) / 180;
  arcMat.setFloat("startAngle", gizmo.arcStartAngle);
  arcMat.setFloat("sweep", 0);
  arc.material = arcMat;
  arc.isPickable = false;
  gizmo.arc = arc;
  gizmo.arcMat = arcMat;

  // Ticks: radial marks like clock minute marks (local X = radial). Each
  // tick also gets a label host, further out, so a DOM label can show that
  // tick's own version number without touching the mesh underneath it.
  const ticks = [];
  const tickLabelHosts = [];
  for (let i = 0; i < filtered.length; i++) {
    const angle = (_angleForIndex(i, filtered.length) * Math.PI) / 180;
    const tick = BABYLON.MeshBuilder.CreateBox(
      `${TICK_PREFIX}-${i}`,
      {
        width: radius * TICK_WIDTH_FACTOR,
        height: radius * TICK_THICKNESS_FACTOR,
        depth: radius * TICK_THICKNESS_FACTOR,
      },
      uScene
    );
    tick.setParent(root);
    tick.position = new BABYLON.Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0
    );
    tick.rotation.z = angle;
    tick.material = createGizmoMaterial(uScene, `tickMat-${i}`, COLOR_TICK, TICK_ALPHA);
    tick.isPickable = false;
    ticks.push(tick);

    const labelHost = new BABYLON.TransformNode(`versionTickLabelHost-${i}`, uScene);
    labelHost.setParent(root);
    const labelRadius = radius * LABEL_RADIUS_FACTOR;
    labelHost.position = new BABYLON.Vector3(
      Math.cos(angle) * labelRadius,
      Math.sin(angle) * labelRadius,
      0
    );
    tickLabelHosts.push(labelHost);
  }
  gizmo.ticks = ticks;
  gizmo.tickLabelHosts = tickLabelHosts;

  // Anchor for the DOM version badge; placeHandle keeps it just outside the
  // knob so the badge travels with the thing you drag.
  const badgeHost = new BABYLON.TransformNode("versionBadgeHost", uScene);
  badgeHost.setParent(root);
  gizmo.badgeHost = badgeHost;

  // Knob: flat accent disc seated on the ring, facing the viewer, with a
  // lighter rim so it reads as the grabbable playhead. Mesh name is kept as
  // versionHandle so picking and tests are unchanged.
  const handle = BABYLON.MeshBuilder.CreateCylinder(
    HANDLE_NAME,
    {
      diameter: radius * KNOB_DIAMETER_FACTOR,
      height: radius * KNOB_HEIGHT_FACTOR,
      tessellation: 24,
    },
    uScene
  );
  handle.setParent(root);
  handle.rotation.x = Math.PI / 2; // cylinder axis (local Y) → ring-plane normal
  gizmo.handleMat = createGizmoMaterial(uScene, "handleMat", COLOR_ACTIVE, HANDLE_ALPHA);
  gizmo.handleHoverMat = createGizmoMaterial(uScene, "handleHoverMat", COLOR_HOVER, HANDLE_ALPHA);
  handle.material = gizmo.handleMat;
  gizmo.handle = handle;

  // Rim: thin torus around the knob edge; coaxial with the cylinder, so as a
  // child it needs no extra rotation and follows every drag for free.
  const rim = BABYLON.MeshBuilder.CreateTorus(
    "versionHandleRim",
    {
      diameter: radius * KNOB_DIAMETER_FACTOR,
      thickness: radius * RIM_THICKNESS_FACTOR,
      tessellation: 24,
    },
    uScene
  );
  rim.setParent(handle);
  rim.position = new BABYLON.Vector3(0, 0, 0);
  rim.material = createGizmoMaterial(uScene, "handleRimMat", COLOR_KNOB_RIM, HANDLE_ALPHA);
  rim.isPickable = false;

  return gizmo;
}

function syncHandlePosition(g, activeIdx) {
  const safeIdx = activeIdx >= 0 ? activeIdx : g.filtered.length - 1;
  const angle = (_angleForIndex(safeIdx, g.filtered.length) * Math.PI) / 180;
  placeHandle(g, angle);
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

function syncVisuals(g) {
  const s = store.getState();
  const activeIdx = g.filtered.findIndex((e) => e.cid === s.activeCid);
  const safeIdx = activeIdx >= 0 ? activeIdx : g.filtered.length - 1;
  const colorIdx = isDraggingHandle && g.dragHoverIdx >= 0 ? g.dragHoverIdx : safeIdx;
  updateTickColors(g, colorIdx);
  if (!isDraggingHandle) {
    syncHandlePosition(g, safeIdx);
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
        if (canvas) {
          canvas.style.cursor = "grabbing";
          if (pi.event?.pointerId !== undefined) {
            canvas.setPointerCapture(pi.event.pointerId);
          }
        }
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
        if (canvas) {
          canvas.style.cursor = "";
          if (pi.event?.pointerId !== undefined) {
            try {
              canvas.releasePointerCapture(pi.event.pointerId);
            } catch {
              // Capture may already been released if the pointer left
              // the canvas; releasing the camera is what matters here.
            }
          }
        }
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
  let tickLabelsContainer = document.getElementById("modelClockTickLabels");
  if (!tickLabelsContainer && viewport) {
    tickLabelsContainer = document.createElement("div");
    tickLabelsContainer.id = "modelClockTickLabels";
    tickLabelsContainer.className = "model-clock-tick-labels";
    viewport.appendChild(tickLabelsContainer);
  }

  let current = null;
  let currentNodeId = null;
  let clockTargetNodeId = null;

  /** Project a world position to a viewport-relative CSS transform and
   * apply it to a floating label element, hiding it if behind the camera.
   * @param {HTMLElement} el
   * @param {BABYLON.Vector3} world
   */
  function positionLabelEl(el, world) {
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
    el.style.transform = `translate(${projected.x * sx}px, ${projected.y * sy}px) translate(-50%, -50%)`;
    el.hidden = projected.z < 0 || projected.z > 1;
  }

  function createTickLabels(gizmo) {
    if (!tickLabelsContainer) return;
    gizmo.tickLabelEls = gizmo.filtered.map((entry) => {
      const el = document.createElement("div");
      el.className = "model-clock-tick-label";
      el.textContent = `v${entry.version}`;
      tickLabelsContainer.appendChild(el);
      return el;
    });
    const badge = document.createElement("div");
    badge.id = "modelClockBadge";
    badge.className = "model-clock-badge";
    tickLabelsContainer.appendChild(badge);
    gizmo.badgeEl = badge;
  }

  function render() {
    if (!current) return;
    syncRootToCamera(
      current.root,
      current.anchor,
      camera,
      current.radius * CLOCK_DEPTH_OFFSET_FACTOR
    );
    // Scale the ring so it always keeps the same padding around the model's
    // projected silhouette, even when the side panel changes the viewport/camera
    // framing.
    const silhouetteR = silhouetteRadiusOnClockPlane(current);
    const targetR = silhouetteR * RING_RADIUS_FACTOR;
    const scale = targetR / current.radius;
    if (Number.isFinite(scale) && scale > 0) {
      current.root.scaling = new BABYLON.Vector3(scale, scale, scale);
    }
    syncVisuals(current);
    if (!current.tickLabelEls) return;

    const s = store.getState();
    const activeIdx = current.filtered.findIndex((e) => e.cid === s.activeCid);
    const safeActiveIdx = activeIdx >= 0 ? activeIdx : current.filtered.length - 1;
    const hoverIdx = isDraggingHandle && current.dragHoverIdx >= 0 ? current.dragHoverIdx : -1;
    const badgeIdx = hoverIdx >= 0 ? hoverIdx : safeActiveIdx;
    const publishedIdx = current.filtered.findIndex((e) => e.cid === s.publishedCid);

    const badgeEntry = current.filtered[badgeIdx];
    if (current.badgeEl && badgeEntry) {
      current.badgeEl.textContent = `v${badgeEntry.version}`;
      positionLabelEl(current.badgeEl, current.badgeHost.getAbsolutePosition());
    }

    for (let i = 0; i < current.tickLabelEls.length; i++) {
      const el = current.tickLabelEls[i];
      positionLabelEl(el, current.tickLabelHosts[i].getAbsolutePosition());
      el.classList.toggle("active", i === safeActiveIdx);
      el.classList.toggle("hover", i === hoverIdx);
      el.classList.toggle("published", i === publishedIdx);
      // The knob + badge occupy this tick; hide its label to avoid doubling.
      el.hidden = i === badgeIdx;
    }
  }

  function onSelect(e) {
    destroyCurrent();
    if (state.transformMode !== "time") return;
    // Per-node time-travel is single-selection only.
    if (state.selectedNodeIds.size > 1) return;
    const nodeId = e?.nodeId || state.highlightedNodeId;
    if (!nodeId) return;
    clockTargetNodeId = nodeId;
    currentNodeId = nodeId;
    current = buildGizmoForNode(scene, nodeId);
    if (current) {
      wireDrag(current, scene, camera);
      createTickLabels(current);
      render();
    }
  }

  function destroyCurrent() {
    if (current) {
      if (current.pointerObserver) {
        utilityScene(scene).onPointerObservable.remove(current.pointerObserver);
      }
      current.handleHoverMat?.dispose();
      for (const el of current.tickLabelEls || []) el.remove();
      current.badgeEl?.remove();
      current.root.dispose(false, true);
      current = null;
    }
    currentNodeId = null;
    isDraggingHandle = false;
  }

  function onModeChanged(e) {
    if (e?.mode === "time") {
      const target = clockTargetNodeId || state.highlightedNodeId;
      if (target) onSelect({ nodeId: target });
    } else {
      clockTargetNodeId = null;
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
          createTickLabels(current);
          render();
        }
        return;
      }
    }
    render();
  }

  function onDeselect() {
    // Do not clear clockTargetNodeId here. A node:deselected can fire from the
    // follow-up POINTERPICK after releasing the clock handle, and we need the
    // target to survive so the clock can rebuild on SCENE_READY after
    // loadVersion clears and reloads the scene.
    destroyCurrent();
  }

  function onSceneReady() {
    if (state.transformMode !== "time") return;
    if (!clockTargetNodeId) return;
    if (!state.nodeAnchors.has(clockTargetNodeId)) return;
    onSelect({ nodeId: clockTargetNodeId });
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
  const unsubscribeDeselected = on(EVENTS.NODE_DESELECTED, onDeselect);
  const unsubscribeCleared = on(EVENTS.SCENE_CLEARED, destroyCurrent);
  const unsubscribeEmpty = on(EVENTS.SCENE_EMPTY, destroyCurrent);
  const unsubscribeMode = on(EVENTS.TRANSFORM_MODE_CHANGED, onModeChanged);
  const unsubscribeReady = on(EVENTS.SCENE_READY, onSceneReady);
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
    unsubscribeReady();
    unsubscribeStore();
    scene.onBeforeRenderObservable.remove(renderHandle);
    document.removeEventListener("keydown", onKeyDown);
    tickLabelsContainer?.remove();
  };
}
