# Model Clock Time Mode + Gizmo-Style Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the model clock a fourth transform mode — Move (T) / Rotate (R) / Scale (S) / Time (V) — and rebuild its ring/ticks/handle in Babylon-gizmo style (utility layer, flat unlit materials, plane-projected drag, direction arrowhead).

**Architecture:** `transform-gizmo.js` gains a "time" mode that disables all three Babylon gizmos and broadcasts `EVENTS.TRANSFORM_MODE_CHANGED` on the bus. `model-clock-gizmo.js` builds its ring only in that mode, renders on `BABYLON.UtilityLayerRenderer.DefaultUtilityLayer` (same layer as the transform gizmos, always on top), syncs an unparented root to the anchor's world position/rotation each frame (fixes scaled-anchor double-scaling), and replaces `PointerDragBehavior` with manual ray-vs-ring-plane pointer handling.

**Tech Stack:** Babylon.js (global `BABYLON`), plain ES modules checked by `tsc` (`checkJs`), Jest + jsdom with a hand-rolled Babylon mock, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-07-12-model-clock-time-mode-design.md`

## Global Constraints

- Mesh names must stay `versionRing`, `versionHandle`, `versionTick-<i>`; new arrow mesh is `versionArrow`; badge DOM id stays `modelClockBadge`.
- Source files stay `.js` with `// @ts-nocheck` where already present; everything must pass `npm run typecheck` and `npm run typecheck:frontend`.
- Keyboard: `V` enters Time mode. Arrow/Home/End version stepping fires only in Time mode.
- No SRI hashes, no new dependencies, no backend changes.
- Commit after every task (pre-commit hook runs lint-staged + both typechecks).

---

### Task 1: `TRANSFORM_MODE_CHANGED` event + Time toolbar mode

**Files:**
- Modify: `frontend/src/js/events/bus.js` (EVENTS map, ~line 20)
- Modify: `frontend/src/js/ui/transform-gizmo.js`
- Test: `test/frontend/transform-gizmo.test.js`

**Interfaces:**
- Consumes: existing `setMode()` / toolbar in `transform-gizmo.js`.
- Produces: `EVENTS.TRANSFORM_MODE_CHANGED === "transform:modeChanged"`, emitted with payload `{ mode: "translate"|"rotate"|"scale"|"time" }` on every `setMode()` call; toolbar button `#transformToolbar [data-mode="time"]`; `state.transformMode` may now be `"time"`. Task 3 depends on this event and on `state.transformMode`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe` block in `test/frontend/transform-gizmo.test.js`:

```js
  test("time mode button exists, disables all gizmos, and emits mode event", async () => {
    const { on, EVENTS } = await import("../../frontend/src/js/events/bus.js");
    const modes = [];
    const off = on(EVENTS.TRANSFORM_MODE_CHANGED, (e) => modes.push(e.mode));

    const anchor = { isDisposed: () => false };
    state.nodeAnchors.set("node-1", anchor);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    expect(modes).toEqual(["translate"]);

    const timeBtn = viewport.querySelector('.transform-tool[data-mode="time"]');
    expect(timeBtn).toBeTruthy();
    timeBtn.click();

    expect(state.transformMode).toBe("time");
    expect(modes).toEqual(["translate", "time"]);
    expect(state.gizmoManager.positionGizmoEnabled).toBe(false);
    expect(state.gizmoManager.rotationGizmoEnabled).toBe(false);
    expect(state.gizmoManager.scaleGizmoEnabled).toBe(false);
    expect(timeBtn.classList.contains("active")).toBe(true);
    off();
  });

  test("V key switches to time mode", () => {
    const anchor = { isDisposed: () => false };
    state.nodeAnchors.set("node-1", anchor);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "v" }));
    expect(state.transformMode).toBe("time");
  });
```

Note: `initTransformGizmo` guards against double init via `state.gizmoManager`; the existing `beforeEach` already resets it, so each test gets a fresh toolbar. The keydown listener from previous test runs is module-level and idempotent enough for these assertions (it only calls `setMode`, and `state.gizmoManager` is fresh).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/frontend/transform-gizmo.test.js -t "time mode" --silent`
Expected: FAIL — `timeBtn` is null (no such button yet) and `TRANSFORM_MODE_CHANGED` is undefined.

- [ ] **Step 3: Implement**

In `frontend/src/js/events/bus.js`, add to the `EVENTS` map (alphabetical, after `THEME_CHANGED`):

```js
  TRANSFORM_MODE_CHANGED:     "transform:modeChanged",
```

In `frontend/src/js/ui/transform-gizmo.js`:

1. Change the bus import to include `emit`:

```js
import { on, emit, EVENTS } from "../events/bus.js";
```

2. Add a clock icon to `ICONS` (same 16×16 stroke style):

```js
  time:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
```

3. Add the fourth button in `createToolbar()` after the scale button:

```js
    <button class="btn btn-flat btn-sm transform-tool" data-mode="time" aria-label="Time (V)" title="Time (V)">
      ${ICONS.time}
    </button>
```

4. In `wireKeyboard()` add a case:

```js
      case "v":
        e.preventDefault();
        setMode("time");
        break;
```

5. In `setMode()`, update the JSDoc mode union to `'translate' | 'rotate' | 'scale' | 'time'`, and emit the event at the end of the function (after `updateToolbarUI()`):

```js
  emit(EVENTS.TRANSFORM_MODE_CHANGED, { mode });
```

No other change: the three `mode === "..."` enable flags are already all false for `"time"`, and `updateToolbarUI()` already highlights whichever `data-mode` matches `state.transformMode`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/frontend/transform-gizmo.test.js --silent`
Expected: PASS (all tests in file, including the pre-existing one).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/events/bus.js frontend/src/js/ui/transform-gizmo.js test/frontend/transform-gizmo.test.js
git commit -m "feat(model-clock): add Time (V) transform mode and mode-change event"
```

---

### Task 2: Pure math helpers `_rayPlaneIntersect` and `_lerpAngle`

**Files:**
- Modify: `frontend/src/js/ui/model-clock-gizmo.js` (add exports near the other `_` helpers)
- Test: `test/frontend/model-clock-gizmo.test.js` (add to the `model-clock-gizmo math` describe)

**Interfaces:**
- Produces: `_rayPlaneIntersect(origin, dir, planePoint, planeNormal) -> {x,y,z}|null` — plain-object vectors, no BABYLON dependency; returns null for parallel or behind-origin hits. `_lerpAngle(from, to, t) -> number` — radians, interpolates along the shortest arc. Task 4's drag code calls both.

- [ ] **Step 1: Write the failing tests**

Add to the `model-clock-gizmo math` describe block:

```js
  test("_rayPlaneIntersect hits the plane and rejects parallel/behind rays", async () => {
    const { _rayPlaneIntersect } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    const hit = _rayPlaneIntersect(
      { x: 1, y: 2, z: -10 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 }
    );
    expect(hit).toEqual({ x: 1, y: 2, z: 0 });

    // Parallel ray never hits.
    expect(
      _rayPlaneIntersect(
        { x: 0, y: 0, z: -10 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }
      )
    ).toBeNull();

    // Plane behind the ray origin.
    expect(
      _rayPlaneIntersect(
        { x: 0, y: 0, z: 10 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }
      )
    ).toBeNull();
  });

  test("_lerpAngle interpolates along the shortest arc across the wrap", async () => {
    const { _lerpAngle } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    expect(_lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 5);
    // From 170° to -170° the short way is +20°, not -340°.
    const from = (170 * Math.PI) / 180;
    const to = (-170 * Math.PI) / 180;
    expect(_lerpAngle(from, to, 0.5)).toBeCloseTo((180 * Math.PI) / 180, 5);
    expect(_lerpAngle(1.2, 1.2, 0.5)).toBeCloseTo(1.2, 5);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/frontend/model-clock-gizmo.test.js -t "_rayPlaneIntersect" --silent && npx jest test/frontend/model-clock-gizmo.test.js -t "_lerpAngle" --silent`
Expected: FAIL — functions are not exported.

- [ ] **Step 3: Implement**

Add to `frontend/src/js/ui/model-clock-gizmo.js` after `_indexForAngle`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/frontend/model-clock-gizmo.test.js -t "math" --silent`
Expected: PASS (5 math tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js test/frontend/model-clock-gizmo.test.js
git commit -m "feat(model-clock): ray-plane and angle-lerp helpers for gizmo drag"
```

---

### Task 3: Gizmo rebuild — Time-mode gating, utility layer, tick marks, lozenge handle, arrow

This task rewrites the build/lifecycle half of `model-clock-gizmo.js`. Drag stays temporarily unwired (removed with the old `PointerDragBehavior`); Task 4 adds the new drag. The Jest Babylon mock gains the pieces the new code needs.

**Files:**
- Modify: `frontend/src/js/ui/model-clock-gizmo.js`
- Test: `test/frontend/model-clock-gizmo.test.js`

**Interfaces:**
- Consumes: `EVENTS.TRANSFORM_MODE_CHANGED` + `state.transformMode` from Task 1.
- Produces: gizmo object `{ nodeId, root, ring, ticks, handle, arrow, badgeHost, radius, filtered, dragHoverIdx }`; module-level `buildGizmoForNode(scene, nodeId)`; `placeHandle(g, angleRad)`; `utilityScene(mainScene)`; `createGizmoMaterial(uScene, name, rgb)`. Task 4 wires drag onto `gizmo.handle` and stores `gizmo.pointerObserver`, `gizmo.dragTargetAngle`, `gizmo.dragAngle`.

- [ ] **Step 1: Update the Babylon mock and lifecycle tests (failing first)**

In `test/frontend/model-clock-gizmo.test.js`:

1. In `createBabylonMock()`:
   - Add to `MockVector3`: 
     ```js
     copyFrom(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
     subtract(v) { return new MockVector3(this.x - v.x, this.y - v.y, this.z - v.z); }
     applyRotationQuaternion(_q) { return this; }
     ```
   - Add to `MockTransformNode`: `this.rotationQuaternion = null;` in the constructor and `isDisposed() { return this._disposed; }`.
   - In the returned object: replace the `PointerDragBehavior` entry with these additions:
     ```js
     Quaternion: class MockQuaternion {
       static Identity() { return new MockQuaternion(); }
       static Inverse(q) { return q; }
       clone() { return this; }
       copyFrom() { return this; }
     },
     PointerEventTypes: { POINTERDOWN: 1, POINTERUP: 2, POINTERMOVE: 4 },
     UtilityLayerRenderer: null, // set below, needs the scene from the test
     ```
   - Add `CreateBox: (name, opts, scene) => new MockMesh(name, scene),` to `MeshBuilder`.
   - Extend the `StandardMaterial` mock with `this.specularColor = null; this.disableLighting = false;`.

2. In `beforeEach` of the lifecycle describe, after `scene` is created, add pointer plumbing and the utility layer (the utility scene reuses the main mock scene so `createdMeshes` keeps seeing everything):

```js
    scene.onPointerObservable = { add: jest.fn(() => ({})), remove: jest.fn() };
    scene.pointerX = 0;
    scene.pointerY = 0;
    scene.createPickingRay = jest.fn(() => ({
      origin: new babylon.Vector3(0, 0, -10),
      direction: new babylon.Vector3(0, 0, 1),
    }));
    babylon.UtilityLayerRenderer = { DefaultUtilityLayer: { utilityLayerScene: scene } };
    camera = {
      viewport: { toGlobal: () => ({ width: 800, height: 600 }) },
      detachControl: jest.fn(),
      attachControl: jest.fn(),
    };
    state.transformMode = "time";
```

(Remove the old plain `camera = { viewport: ... }` line; keep everything else.)

3. Update lifecycle tests:
   - In "selecting a node creates ring, ticks, and handle", also assert the arrow and the tick shape and unlit materials:
     ```js
     const arrow = babylon.createdMeshes.find((m) => m.name === "versionArrow");
     expect(arrow).toBeDefined();
     expect(torus.material.disableLighting).toBe(true);
     expect(handle.material.disableLighting).toBe(true);
     ```
   - Replace the "ring is hidden while transform gizmo is dragging" test entirely with:
     ```js
     test("switching away from time mode disposes the ring", async () => {
       const { initModelClockGizmo } = await import(
         "../../frontend/src/js/ui/model-clock-gizmo.js"
       );
       destroyGizmo = initModelClockGizmo(scene, camera);

       state.highlightedNodeId = "node-a";
       state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
       emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
       expect(babylon.createdMeshes.find((m) => m.name === "versionRing")).toBeDefined();

       state.transformMode = "translate";
       emit(EVENTS.TRANSFORM_MODE_CHANGED, { mode: "translate" });
       expect(babylon.disposed.length).toBeGreaterThan(0);
       expect(document.getElementById("modelClockBadge").hidden).toBe(true);
     });

     test("no ring is built outside time mode; entering time mode builds it", async () => {
       const { initModelClockGizmo } = await import(
         "../../frontend/src/js/ui/model-clock-gizmo.js"
       );
       destroyGizmo = initModelClockGizmo(scene, camera);

       state.transformMode = "translate";
       state.highlightedNodeId = "node-a";
       state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
       emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
       expect(babylon.createdMeshes.find((m) => m.name === "versionRing")).toBeUndefined();

       state.transformMode = "time";
       emit(EVENTS.TRANSFORM_MODE_CHANGED, { mode: "time" });
       expect(babylon.createdMeshes.find((m) => m.name === "versionRing")).toBeDefined();
     });
     ```
   - The EVENTS import at the top of the file already exists; `TRANSFORM_MODE_CHANGED` comes from Task 1.
   - The "dragging handle commits the landed version" test will fail after this task (drag is rewired in Task 4). Replace it as part of Task 4 Step 1; for THIS task, delete its body and mark it `test.todo("dragging handle commits the landed version")` so the suite is green at the task boundary.
   - "arrow keys step version when a node is selected": rename to `"arrow keys step version only in time mode"` and append at the end:
     ```js
     storeMock.loadVersion.mockClear();
     state.transformMode = "translate";
     emit(EVENTS.TRANSFORM_MODE_CHANGED, { mode: "translate" });
     document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
     expect(storeMock.loadVersion).not.toHaveBeenCalled();
     ```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/frontend/model-clock-gizmo.test.js --silent`
Expected: FAIL — no `versionArrow` mesh, `disableLighting` false, mode gating not implemented.

- [ ] **Step 3: Rewrite the build/lifecycle half of `model-clock-gizmo.js`**

Replace everything from `const RING_NAME` down through `buildGizmoForNode`, `syncHandlePosition`, and the mode-unaware parts of `initModelClockGizmo` with the following (keep the exported math helpers, imports, and radius constants at the top of the file; `updateTickColors` and `syncVisuals` change as shown):

```js
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
  if (g.badgeHost) g.badgeHost.position = g.handle.position.clone();
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
```

`syncVisuals` is unchanged except it no longer needs a `hidden` concept.

In `initModelClockGizmo(scene, camera)`:

1. `render()` loses the `state.isGizmoDragging` visibility block; instead it starts with:

```js
  function render() {
    if (!current) return;
    syncRootToAnchor(current.root, current.anchor);
    syncVisuals(current, badge);
    // ... existing badge projection code unchanged, but `hidden` is gone:
    //   badge.hidden = projected.z < 0 || projected.z > 1;
  }
```

2. `onSelect` gates on mode:

```js
  function onSelect(e) {
    destroyCurrent();
    if (state.transformMode !== "time") return;
    const nodeId = e?.nodeId || state.highlightedNodeId;
    if (!nodeId) return;
    currentNodeId = nodeId;
    current = buildGizmoForNode(scene, nodeId);
    if (current) {
      syncVisuals(current, badge);
    }
  }
```

3. Add a mode-change handler and subscription (next to the other `on(...)` calls):

```js
  function onModeChanged(e) {
    if (e?.mode === "time") {
      if (state.highlightedNodeId) onSelect({ nodeId: state.highlightedNodeId });
    } else {
      destroyCurrent();
    }
  }
  const unsubscribeMode = on(EVENTS.TRANSFORM_MODE_CHANGED, onModeChanged);
```

Call `unsubscribeMode()` inside the returned `destroy()`.

4. `onStoreChange`'s rebuild branch drops the third argument: `current = buildGizmoForNode(scene, currentNodeId);`.

5. `onKeyDown` adds mode gating right after the `if (!current) return;` line:

```js
    if (state.transformMode !== "time") return;
```

6. `destroyCurrent()` additionally disposes the hover material (it is not attached to a mesh while unhovered, so `root.dispose(false, true)` misses it):

```js
  function destroyCurrent() {
    if (current) {
      current.handleHoverMat?.dispose();
      current.root.dispose(false, true);
      current = null;
    }
    currentNodeId = null;
    isDraggingHandle = false;
    if (badge) badge.hidden = true;
  }
```

7. Delete the entire `PointerDragBehavior` block and the `hidden` parameter/visibility toggles from `buildGizmoForNode` (already reflected in the code above — the old `ring.isVisible = !hidden` lines are gone).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx jest test/frontend/model-clock-gizmo.test.js --silent && npm run typecheck:frontend`
Expected: PASS (with 1 todo), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js test/frontend/model-clock-gizmo.test.js
git commit -m "feat(model-clock): time-mode gating, utility layer, gizmo-style ring/ticks/arrow"
```

---

### Task 4: Drag + hover interaction (rotation-gizmo style)

**Files:**
- Modify: `frontend/src/js/ui/model-clock-gizmo.js`
- Test: `test/frontend/model-clock-gizmo.test.js`

**Interfaces:**
- Consumes: `_rayPlaneIntersect`, `_lerpAngle` (Task 2); `buildGizmoForNode`, `placeHandle`, `utilityScene`, gizmo fields (Task 3).
- Produces: pointer-driven drag on `gizmo.handle`; `gizmo.pointerObserver` removed on dispose; camera controls detached during drag; commit via `store.loadVersion(cid)` using the **un-smoothed** `dragTargetAngle`.

- [ ] **Step 1: Write the failing tests**

Replace the `test.todo("dragging handle commits the landed version")` with:

```js
  test("dragging handle commits the landed version and manages camera", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
    const pointerCb = scene.onPointerObservable.add.mock.calls[0][0];
    const PET = babylon.PointerEventTypes;

    pointerCb({ type: PET.POINTERDOWN, pickInfo: { pickedMesh: handle } });
    expect(camera.detachControl).toHaveBeenCalled();

    // Ray hits the ring plane at the oldest version's position (180° for n=3
    // → world (-radius, 0, 0); root sits at the origin in this test).
    const radius = 0.5; // MIN_RING_RADIUS: no meshes registered → fallback
    scene.createPickingRay.mockReturnValue({
      origin: new babylon.Vector3(-radius, 0, -10),
      direction: new babylon.Vector3(0, 0, 1),
    });
    pointerCb({ type: PET.POINTERMOVE });

    pointerCb({ type: PET.POINTERUP });
    expect(camera.attachControl).toHaveBeenCalled();
    expect(storeMock.loadVersion).toHaveBeenCalledWith("c1");
  });

  test("hovering the handle swaps to the hover material", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
    const baseMat = handle.material;
    const pointerCb = scene.onPointerObservable.add.mock.calls[0][0];
    const PET = babylon.PointerEventTypes;

    pointerCb({ type: PET.POINTERMOVE, pickInfo: { pickedMesh: handle } });
    expect(handle.material).not.toBe(baseMat);

    pointerCb({ type: PET.POINTERMOVE, pickInfo: { pickedMesh: null } });
    expect(handle.material).toBe(baseMat);
  });

  test("disposing the gizmo removes the pointer observer", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    emit(EVENTS.NODE_DESELECTED);
    expect(scene.onPointerObservable.remove).toHaveBeenCalled();
  });
```

Mock prerequisite: extend the engine mock in `beforeEach` so the canvas has a style (cursor writes):

```js
      getRenderingCanvas: () => ({ clientWidth: 800, clientHeight: 600, style: {} }),
```

(One shared object is fine; hoist it to a `const canvasMock` in `beforeEach` and return it from `getRenderingCanvas`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/frontend/model-clock-gizmo.test.js --silent`
Expected: FAIL — `scene.onPointerObservable.add` never called (no drag wiring yet).

- [ ] **Step 3: Implement drag + hover in `model-clock-gizmo.js`**

Add a `DRAG_SMOOTHING = 0.5` const near the palette. Add this function and call it from `onSelect` after a successful build — `wireDrag(current, scene, camera)`:

```js
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
```

In `destroyCurrent()`, remove the observer before disposing:

```js
    if (current) {
      if (current.pointerObserver) {
        utilityScene(scene).onPointerObservable.remove(current.pointerObserver);
      }
      current.handleHoverMat?.dispose();
      current.root.dispose(false, true);
      current = null;
    }
```

(`destroyCurrent` is declared inside `initModelClockGizmo`, so `scene` is in scope.)

Also call `wireDrag` in `onStoreChange`'s rebuild branch after `buildGizmoForNode` succeeds, matching `onSelect`.

Note the handle must be pickable while ring/ticks/arrow are `isPickable = false` (set in Task 3), so `pickInfo.pickedMesh` resolves to the handle cleanly.

- [ ] **Step 4: Run the full frontend suite + typecheck**

Run: `npx jest test/frontend/model-clock-gizmo.test.js test/frontend/transform-gizmo.test.js --silent && npm run typecheck:frontend && npm run typecheck`
Expected: PASS, both typechecks clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js test/frontend/model-clock-gizmo.test.js
git commit -m "feat(model-clock): plane-projected drag with hover highlight and camera detach"
```

---

### Task 5: E2E update + full verification gate

**Files:**
- Modify: `e2e/helpers/studio-selectors.mjs` (~line 44)
- Modify: `e2e/specs/04-parametric-version.spec.js` (~lines 89–96)
- Verify: full gates + manual viewport check

**Interfaces:**
- Consumes: toolbar button `#transformToolbar [data-mode="time"]` (Task 1); badge behavior (unchanged).

- [ ] **Step 1: Add the selector**

In `e2e/helpers/studio-selectors.mjs` next to `modelClockBadge`:

```js
  timeModeButton: '#transformToolbar [data-mode="time"]',
```

- [ ] **Step 2: Update spec 04**

In `e2e/specs/04-parametric-version.spec.js`, step 7b — the model clock now requires Time mode after selecting the node:

```js
    // 7b. Model clock: selecting the node + entering Time mode (V) surfaces
    // the 3D ring gizmo badge.
    await page.click(SELECTORS.outlinerSwitcherBtn);
    await page.locator(SELECTORS.outlinerNode).first().click();
    await page.click(SELECTORS.timeModeButton);
    await expect(page.locator(SELECTORS.modelClockBadge)).toBeVisible();
    await expect(page.locator(SELECTORS.modelClockBadge)).toHaveText("v2");
```

The subsequent `Home` keypress and hidden-badge assertions are unchanged (keyboard stepping works in Time mode; reload clears selection which hides the badge).

- [ ] **Step 3: Build frontend + run unit gates**

Run: `npm run build:frontend && npm run typecheck && npm run typecheck:frontend && npm run test:frontend`
Expected: build succeeds; all suites pass.

- [ ] **Step 4: Run E2E**

Precondition: no stale backend on :9090 (E2E reuses any listener there — kill any old `./scripts/start-dev.sh` backend first, per project memory).

Run: `npm run test:e2e -- --project=chromium`
Expected: all specs pass, including 04.

If spec 04 fails at the badge step, debug with `npx playwright test e2e/specs/04-parametric-version.spec.js --config=e2e/playwright.config.js --project=chromium --headed` and check that the Time button is enabled after node selection.

- [ ] **Step 5: Manual polish check (visual tuning)**

Start the stack (`./scripts/start-dev.sh`), open `/studio`, generate or open an asset with ≥2 versions, select the node, press `V`:

- Ring/ticks/handle draw on top of the model, flat-colored like the move gizmo.
- Arrowhead sits just clockwise of the newest tick and points clockwise ("toward newer"). If the cone points the wrong way, flip `arrow.rotation.z = arrowAngle + Math.PI` to `arrowAngle` (sign depends on Babylon's cone orientation vs. the mock).
- Handle drag follows the cursor around the ring with slight smoothing, ticks highlight as you pass them, release snaps and loads the version, camera does not orbit during the drag.
- Hover shows the yellow highlight and `grab` cursor.

Fix any visual-only issues (sizes/offsets are the tunable constants in `buildGizmoForNode`) and re-run `npm run test:frontend`.

- [ ] **Step 6: Commit**

```bash
git add e2e/helpers/studio-selectors.mjs e2e/specs/04-parametric-version.spec.js
git commit -m "test(e2e): enter Time mode before asserting model clock badge"
```
