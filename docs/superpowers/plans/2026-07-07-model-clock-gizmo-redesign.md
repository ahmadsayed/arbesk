# Model Clock Gizmo Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DOM/SVG model clock with a 3D Babylon mesh ring gizmo that orbits the selected node and scrubs its filtered version history.

**Architecture:** A new `frontend/src/js/ui/model-clock-gizmo.js` module creates/destroys a torus ring, tick markers, and a draggable handle sphere around the selected node anchor. Pure helper functions (`_ringRadiusFromBounds`, `_angleForIndex`, `_indexForAngle`) keep the math unit-testable. A thin DOM badge follows the handle for version text. `scene-graph.js` swaps the old `model-clock.js` init call for the new module, and `_version-clock.scss` drops the obsolete `.model-clock` host rules.

**Tech Stack:** JavaScript (ES modules), Babylon.js mesh API (`MeshBuilder`, `TransformNode`, `PointerDragBehavior`, `StandardMaterial`), Jest + jsdom, Playwright E2E.

---

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/js/ui/model-clock-gizmo.js` | Create | Babylon ring gizmo: mesh creation, positioning, drag interaction, store integration, disposal |
| `frontend/src/js/ui/model-clock.js` | Delete | Old DOM projection-based model clock |
| `frontend/src/scss/components/_version-clock.scss` | Modify | Remove `.model-clock` host rules; keep `.scene-clock` and `.version-clock` face rules |
| `frontend/src/js/engine/scene-graph.js` | Modify | Replace dynamic `import("../ui/model-clock.js")` with `import("../ui/model-clock-gizmo.js")` |
| `test/frontend/model-clock-gizmo.test.js` | Create | Unit tests for ring creation, radius math, angle/index mapping, drag commit, hide/dispose |
| `test/frontend/model-clock.test.js` | Delete | Obsolete DOM model-clock tests |
| `e2e/helpers/studio-selectors.mjs` | Modify | Add/update model-clock gizmo selectors/helpers |
| `e2e/specs/04-parametric-version.spec.js` | Modify | Rewrite model-clock interactions for the canvas gizmo |

---

## Shared test fixtures

Several tasks reuse the same Babylon mock and store mock. Define them once in `test/frontend/model-clock-gizmo.test.js` before the first task; subsequent tasks append tests and implementation to the same files.

**Store mock (top of test file):**

```js
const ENTRIES = [
  { cid: "c1", version: 1, name: "T", nodeCount: 1, timestamp: null },
  { cid: "c2", version: 2, name: "T", nodeCount: 1, timestamp: null },
  { cid: "c3", version: 3, name: "T", nodeCount: 1, timestamp: null },
];

let _subscriber = null;
const storeMock = {
  getState: jest.fn(() => ({
    entries: ENTRIES,
    activeCid: "c3",
    publishedCid: null,
    isLoading: false,
  })),
  subscribe: jest.fn((fn) => {
    _subscriber = fn;
    return () => {};
  }),
  loadVersion: jest.fn(async () => {}),
  versionsForNode: jest.fn(() => ENTRIES),
  _deps: {},
};

jest.unstable_mockModule(
  "../../frontend/src/js/state/version-history-store.js",
  () => storeMock
);
```

**Babylon mock factory (top of test file):**

```js
function createBabylonMock() {
  const disposed = [];
  const createdMeshes = [];

  class MockVector3 {
    constructor(x, y, z) {
      this.x = x ?? 0;
      this.y = y ?? 0;
      this.z = z ?? 0;
    }
    static Minimize(a, b) {
      return new MockVector3(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.min(a.z, b.z)
      );
    }
    static Maximize(a, b) {
      return new MockVector3(
        Math.max(a.x, b.x),
        Math.max(a.y, b.y),
        Math.max(a.z, b.z)
      );
    }
    static Project(world, _worldMatrix, _transformMatrix, viewport) {
      return new MockVector3(viewport.width / 2, viewport.height / 2, 0.5);
    }
    clone() {
      return new MockVector3(this.x, this.y, this.z);
    }
  }

  class MockTransformNode {
    constructor(name, scene) {
      this.name = name;
      this.scene = scene;
      this.position = new MockVector3();
      this.rotation = new MockVector3();
      this.scaling = new MockVector3(1, 1, 1);
      this.parent = null;
      this._disposed = false;
    }
    dispose() {
      this._disposed = true;
      disposed.push(this);
    }
    setParent(p) {
      this.parent = p;
    }
    getAbsolutePosition() {
      return this.position.clone();
    }
  }

  class MockMesh extends MockTransformNode {
    constructor(name, scene) {
      super(name, scene);
      this.material = null;
      this.renderingGroupId = 0;
      this.isVisible = true;
      this.behaviors = [];
      createdMeshes.push(this);
    }
    addBehavior(b) {
      this.behaviors.push(b);
    }
    dispose() {
      super.dispose();
    }
  }

  class MockObservable {
    constructor() {
      this._callbacks = [];
    }
    add(fn) {
      this._callbacks.push(fn);
    }
  }

  class MockPointerDragBehavior {
    constructor(_options) {
      this.onDragStartObservable = new MockObservable();
      this.onDragObservable = new MockObservable();
      this.onDragEndObservable = new MockObservable();
      this.detach = jest.fn();
    }
  }

  return {
    Vector3: MockVector3,
    Matrix: { Identity: () => ({}) },
    TransformNode: MockTransformNode,
    MeshBuilder: {
      CreateTorus: (name, opts, scene) => new MockMesh(name, scene),
      CreateSphere: (name, opts, scene) => new MockMesh(name, scene),
      CreateCylinder: (name, opts, scene) => new MockMesh(name, scene),
    },
    PointerDragBehavior: MockPointerDragBehavior,
    StandardMaterial: class {
      constructor(name, scene) {
        this.name = name;
        this.diffuseColor = null;
        this.emissiveColor = null;
        this.alpha = 1;
      }
    },
    Color3: class {
      constructor(r, g, b) {
        this.r = r;
        this.g = g;
        this.b = b;
      }
    },
    Color4: class {
      constructor(r, g, b, a) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
      }
    },
    createdMeshes,
    disposed,
  };
}
```

---

## Task 1: Pure math helpers — ring radius

**Files:**
- Create: `frontend/src/js/ui/model-clock-gizmo.js`
- Test: `test/frontend/model-clock-gizmo.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/frontend/model-clock-gizmo.test.js`:

```js
describe("model-clock-gizmo math", () => {
  test("_ringRadiusFromBounds clamps and scales", async () => {
    const { _ringRadiusFromBounds } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    expect(_ringRadiusFromBounds({ x: -1, y: 0, z: -1 }, { x: 1, y: 2, z: 1 })).toBeCloseTo(1.4, 5);
    expect(_ringRadiusFromBounds({ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0.1, z: 0.1 })).toBe(0.5);
    expect(_ringRadiusFromBounds({ x: -10, y: 0, z: -10 }, { x: 10, y: 20, z: 10 })).toBe(8.0);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "_ringRadiusFromBounds clamps and scales" --runInBand
```

Expected: FAIL — `_ringRadiusFromBounds is not exported`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/js/ui/model-clock-gizmo.js`:

```js
// @ts-nocheck
/**
 * Model Clock Gizmo — 3D Babylon ring for scrubbing a node's version history.
 */

const RING_RADIUS_FACTOR = 1.4;
const MIN_RING_RADIUS = 0.5;
const MAX_RING_RADIUS = 8.0;

/**
 * Compute world-space ring radius from a node bounding box so the ring
 * always encircles the model without dominating the view.
 * @param {BABYLON.Vector3} min
 * @param {BABYLON.Vector3} max
 */
export function _ringRadiusFromBounds(min, max) {
  const dx = max.x - min.x;
  const dz = max.z - min.z;
  // Radius is based on the half-extent so the ring encircles the bounding box.
  return Math.min(
    MAX_RING_RADIUS,
    Math.max(MIN_RING_RADIUS, (Math.max(dx, dz) / 2) * RING_RADIUS_FACTOR)
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "_ringRadiusFromBounds clamps and scales" --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js test/frontend/model-clock-gizmo.test.js
git commit -m "feat(model-clock): ring radius math with TDD"
```

---

## Task 2: Pure math helpers — angle ↔ index

**Files:**
- Modify: `frontend/src/js/ui/model-clock-gizmo.js`
- Test: `test/frontend/model-clock-gizmo.test.js`

- [ ] **Step 1: Write the failing tests**

Append to the `describe("model-clock-gizmo math")` block:

```js
test("_angleForIndex places versions clockwise from newest to oldest", async () => {
  const { _angleForIndex } = await import(
    "../../frontend/src/js/ui/model-clock-gizmo.js"
  );
  // 4 entries: newest at 180°, then 90°, 0°, oldest at -90° (12 o'clock)
  expect(_angleForIndex(0, 4)).toBe(180);
  expect(_angleForIndex(1, 4)).toBe(90);
  expect(_angleForIndex(3, 4)).toBe(-90);
});

test("_indexForAngle snaps to nearest version", async () => {
  const { _indexForAngle } = await import(
    "../../frontend/src/js/ui/model-clock-gizmo.js"
  );
  // Matches _angleForIndex: newest at 180° (n=4), oldest at -90° (12 o'clock).
  expect(_indexForAngle(180, 4)).toBe(0); // newest
  expect(_indexForAngle(170, 4)).toBe(0); // closer to newest
  expect(_indexForAngle(80, 4)).toBe(1); // closer to index 1
  expect(_indexForAngle(-90, 4)).toBe(3); // oldest
});
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "_angleForIndex|_indexForAngle" --runInBand
```

Expected: FAIL — functions not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/src/js/ui/model-clock-gizmo.js`:

```js
/** Angle in degrees for entry index i of n. Newest runs clockwise into past. */
export function _angleForIndex(i, n) {
  if (n === 0) return -90;
  return -90 + ((n - 1 - i) * 360) / n;
}

/** Snap a signed angle in degrees to the nearest version index. */
export function _indexForAngle(angleDeg, n) {
  if (n === 0) return -1;
  // Normalize so 0° = 12 o'clock (-90° in standard math coords).
  const a = (((angleDeg + 90) % 360) + 360) % 360;
  const steps = Math.round((a * n) / 360);
  return (n - 1 - steps + n) % n;
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "_angleForIndex|_indexForAngle" --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js test/frontend/model-clock-gizmo.test.js
git commit -m "feat(model-clock): angle/index mapping helpers"
```

---

## Task 3: Ring mesh creation on node selection

**Files:**
- Modify: `frontend/src/js/ui/model-clock-gizmo.js`
- Modify: `test/frontend/model-clock-gizmo.test.js`
- Modify: `frontend/src/js/engine/scene-graph.js`

- [ ] **Step 1: Write the failing test**

Append to `test/frontend/model-clock-gizmo.test.js`:

```js
describe("model-clock-gizmo lifecycle", () => {
  let viewport, scene, camera, babylon;

  beforeEach(() => {
    document.getElementById("viewport")?.remove();
    document.getElementById("modelClockBadge")?.remove();
    viewport = document.createElement("div");
    viewport.id = "viewport";
    document.body.appendChild(viewport);

    babylon = createBabylonMock();
    global.BABYLON = babylon;

    state.highlightedNodeId = null;
    state.isGizmoDragging = false;
    state.nodeMeshes = new Map();
    state.nodeAnchors = new Map();

    storeMock.versionsForNode.mockReturnValue(ENTRIES);
    storeMock.loadVersion.mockClear();

    scene = {
      onBeforeRenderObservable: { add: jest.fn(), remove: jest.fn() },
      getTransformMatrix: () => ({}),
      getEngine: () => ({
        getRenderWidth: () => 800,
        getRenderHeight: () => 600,
        getRenderingCanvas: () => ({ clientWidth: 800, clientHeight: 600 }),
      }),
    };
    camera = { viewport: { toGlobal: () => ({ width: 800, height: 600 }) } };
  });

  afterEach(() => {
    delete global.BABYLON;
  });

  test("selecting a node creates ring, ticks, and handle", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const torus = babylon.createdMeshes.find((m) => m.name === "versionRing");
    const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
    expect(torus).toBeDefined();
    expect(handle).toBeDefined();
    expect(babylon.createdMeshes.filter((m) => m.name.startsWith("versionTick")).length).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "selecting a node creates ring, ticks, and handle" --runInBand
```

Expected: FAIL — `initModelClockGizmo` not exported or ring not created.

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/src/js/ui/model-clock-gizmo.js`:

```js
import * as store from "../state/version-history-store.js";
import { on, EVENTS } from "../events/bus.js";
import { state } from "../engine/state.js";

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
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "selecting a node creates ring, ticks, and handle" --runInBand
```

Expected: PASS.

- [ ] **Step 5: Wire into scene-graph**

Edit `frontend/src/js/engine/scene-graph.js` around lines 327–329:

```js
import("../ui/model-clock-gizmo.js")
  .then(({ initModelClockGizmo }) => {
    initModelClockGizmo(state.scene, camera);
  })
  .catch((err) => console.error("[SCENE] model clock gizmo failed", err));
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js test/frontend/model-clock-gizmo.test.js frontend/src/js/engine/scene-graph.js
git commit -m "feat(model-clock): create ring/ticks/handle on node selection"
```

---

## Task 4: Draggable handle commits version

**Files:**
- Modify: `frontend/src/js/ui/model-clock-gizmo.js`
- Test: `test/frontend/model-clock-gizmo.test.js`

- [ ] **Step 1: Write the failing test**

Append a test inside `describe("model-clock-gizmo lifecycle")`:

```js
test("dragging handle commits the landed version", async () => {
  const { initModelClockGizmo } = await import(
    "../../frontend/src/js/ui/model-clock-gizmo.js"
  );
  initModelClockGizmo(scene, camera);

  state.highlightedNodeId = "node-a";
  state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
  emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

  const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
  const dragEnd = handle.behaviors?.find((b) => b.onDragEndObservable)?.onDragEndObservable;
  expect(dragEnd).toBeDefined();

  // Simulate drag that snaps to the oldest version.
  handle.position = new babylon.Vector3(-1, 0, 0); // 180° side
  dragEnd._callbacks?.[0]?.();

  expect(storeMock.loadVersion).toHaveBeenCalledWith("c1");
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "dragging handle commits the landed version" --runInBand
```

Expected: FAIL — no drag behavior wired or commit not called.

- [ ] **Step 3: Write minimal implementation**

Refactor `buildGizmoForNode` to attach `PointerDragBehavior` and wire drag events. Replace the handle creation block in `buildGizmoForNode` with:

```js
  // Handle.
  const handle = BABYLON.MeshBuilder.CreateSphere(
    HANDLE_NAME,
    { diameter: radius * 0.12 },
    scene
  );
  handle.setParent(root);
  handle.material = createMaterial(scene, "handleMat", new BABYLON.Color3(0.2, 0.6, 1));
  handle.renderingGroupId = 1;

  const dragBehavior = new BABYLON.PointerDragBehavior({
    dragPlaneNormal: new BABYLON.Vector3(0, 1, 0),
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
  });
  dragBehavior.onDragEndObservable.add(() => {
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
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "dragging handle commits the landed version" --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js test/frontend/model-clock-gizmo.test.js
git commit -m "feat(model-clock): draggable handle snaps and commits version"
```

---

## Task 5: Hide during transform gizmo drag and deselect disposal

**Files:**
- Modify: `frontend/src/js/ui/model-clock-gizmo.js`
- Test: `test/frontend/model-clock-gizmo.test.js`

- [ ] **Step 1: Write the failing tests**

Append tests inside `describe("model-clock-gizmo lifecycle")`:

```js
test("ring is hidden while transform gizmo is dragging", async () => {
  const { initModelClockGizmo } = await import(
    "../../frontend/src/js/ui/model-clock-gizmo.js"
  );
  initModelClockGizmo(scene, camera);

  state.highlightedNodeId = "node-a";
  state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
  emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

  const ring = babylon.createdMeshes.find((m) => m.name === "versionRing");
  expect(ring.isVisible).toBe(true);

  state.isGizmoDragging = true;
  const render = scene.onBeforeRenderObservable.add.mock.calls[0][0];
  render();
  expect(ring.isVisible).toBe(false);
});

test("deselecting disposes the gizmo", async () => {
  const { initModelClockGizmo } = await import(
    "../../frontend/src/js/ui/model-clock-gizmo.js"
  );
  initModelClockGizmo(scene, camera);

  state.highlightedNodeId = "node-a";
  state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
  emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
  expect(babylon.createdMeshes.length).toBeGreaterThan(0);

  state.highlightedNodeId = null;
  emit(EVENTS.NODE_DESELECTED);
  expect(babylon.disposed.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "ring is hidden while transform gizmo is dragging|deselecting disposes the gizmo" --runInBand
```

Expected: FAIL — visibility not toggled, disposal not wired.

- [ ] **Step 3: Write minimal implementation**

Update `buildGizmoForNode` to accept visibility state and update `initModelClockGizmo`:

```js
function buildGizmoForNode(scene, camera, nodeId, hidden) {
  // ... existing creation code ...
  ring.isVisible = !hidden;
  for (const t of ticks) t.isVisible = !hidden;
  handle.isVisible = !hidden;
  // ...
}
```

Add a helper that syncs handle position and tick colors from store state:

```js
function syncVisuals(g) {
  const s = store.getState();
  const activeIdx = g.filtered.findIndex((e) => e.cid === s.activeCid);
  const safeIdx = activeIdx >= 0 ? activeIdx : g.filtered.length - 1;
  const publishedIdx = g.filtered.findIndex((e) => e.cid === s.publishedCid);

  const angle = (_angleForIndex(safeIdx, g.filtered.length) * Math.PI) / 180;
  g.handle.position = new BABYLON.Vector3(
    Math.cos(angle) * g.radius,
    0,
    Math.sin(angle) * g.radius
  );

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
```

Update `initModelClockGizmo`:

```js
export function initModelClockGizmo(scene, camera) {
  let current = null;

  function render() {
    if (!current) return;
    const hidden = state.isGizmoDragging;
    current.ring.isVisible = !hidden;
    for (const t of current.ticks) t.isVisible = !hidden;
    current.handle.isVisible = !hidden;
    syncVisuals(current);
  }

  function onSelect() {
    destroyCurrent();
    const nodeId = state.highlightedNodeId;
    if (!nodeId) return;
    current = buildGizmoForNode(scene, camera, nodeId, state.isGizmoDragging);
    if (current) {
      syncVisuals(current);
    }
  }

  function destroyCurrent() {
    if (current) {
      current.root.dispose();
      current = null;
    }
  }

  on(EVENTS.NODE_SELECTED, onSelect);
  on(EVENTS.NODE_DESELECTED, destroyCurrent);
  on(EVENTS.SCENE_EMPTY, destroyCurrent);
  scene.onBeforeRenderObservable.add(render);
  store.subscribe(render);
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "ring is hidden while transform gizmo is dragging|deselecting disposes the gizmo" --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js test/frontend/model-clock-gizmo.test.js
git commit -m "feat(model-clock): hide during transform drag and dispose on deselect"
```

---

## Task 6: Keyboard stepping

**Files:**
- Modify: `frontend/src/js/ui/model-clock-gizmo.js`
- Test: `test/frontend/model-clock-gizmo.test.js`

- [ ] **Step 1: Write the failing test**

Append a test inside `describe("model-clock-gizmo lifecycle")`:

```js
test("arrow keys step version when a node is selected", async () => {
  const { initModelClockGizmo } = await import(
    "../../frontend/src/js/ui/model-clock-gizmo.js"
  );
  initModelClockGizmo(scene, camera);

  state.highlightedNodeId = "node-a";
  state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
  emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
  expect(storeMock.loadVersion).toHaveBeenCalledWith("c2");

  storeMock.loadVersion.mockClear();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
  expect(storeMock.loadVersion).toHaveBeenCalledWith("c1");
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "arrow keys step version when a node is selected" --runInBand
```

Expected: FAIL — keyboard listener not wired.

- [ ] **Step 3: Write minimal implementation**

Append inside `initModelClockGizmo`:

```js
  document.addEventListener("keydown", (e) => {
    if (!current) return;
    const tag = document.activeElement?.tagName?.toLowerCase();
    const editable =
      document.activeElement?.isContentEditable ||
      tag === "input" ||
      tag === "textarea" ||
      tag === "select";
    if (editable) return;

    const n = current.filtered.length;
    let idx = null;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        idx = Math.max(0, current.filtered.findIndex((e) => e.cid === store.getState().activeCid) - 1);
        break;
      case "ArrowRight":
      case "ArrowUp":
        idx = Math.min(n - 1, current.filtered.findIndex((e) => e.cid === store.getState().activeCid) + 1);
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
  });
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "arrow keys step version when a node is selected" --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js test/frontend/model-clock-gizmo.test.js
git commit -m "feat(model-clock): keyboard stepping for version ring"
```

---

## Task 7: DOM badge following the handle

**Files:**
- Modify: `frontend/src/js/ui/model-clock-gizmo.js`
- Modify: `frontend/src/scss/components/_version-clock.scss`
- Test: `test/frontend/model-clock-gizmo.test.js`

- [ ] **Step 1: Write the failing test**

Append a test inside `describe("model-clock-gizmo lifecycle")`:

```js
test("badge element is created and positioned", async () => {
  const { initModelClockGizmo } = await import(
    "../../frontend/src/js/ui/model-clock-gizmo.js"
  );
  initModelClockGizmo(scene, camera);

  state.highlightedNodeId = "node-a";
  state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
  emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

  const badge = document.getElementById("modelClockBadge");
  expect(badge).toBeTruthy();
  expect(badge.textContent).toContain("v3");
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "badge element is created and positioned" --runInBand
```

Expected: FAIL — badge not created.

- [ ] **Step 3: Write minimal implementation**

Create badge host in `initModelClockGizmo`:

```js
  const viewport = document.getElementById("viewport");
  let badge = document.getElementById("modelClockBadge");
  if (!badge && viewport) {
    badge = document.createElement("div");
    badge.id = "modelClockBadge";
    badge.className = "model-clock-badge";
    viewport.appendChild(badge);
  }
```

Update `syncVisuals` to also position the `badgeHost` transform node and update badge text:

```js
  function syncVisuals(g) {
    const s = store.getState();
    const activeIdx = g.filtered.findIndex((e) => e.cid === s.activeCid);
    const safeIdx = activeIdx >= 0 ? activeIdx : g.filtered.length - 1;
    const publishedIdx = g.filtered.findIndex((e) => e.cid === s.publishedCid);

    const angle = (_angleForIndex(safeIdx, g.filtered.length) * Math.PI) / 180;
    g.handle.position = new BABYLON.Vector3(
      Math.cos(angle) * g.radius,
      0,
      Math.sin(angle) * g.radius
    );
    if (g.badgeHost) {
      g.badgeHost.position = g.handle.position.clone();
    }
    if (badge) {
      badge.textContent = `v${g.filtered[safeIdx].version}`;
    }

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
```

Add `badgeHost` creation in `buildGizmoForNode`:

```js
  const badgeHost = new BABYLON.TransformNode("modelClockBadgeHost", scene);
  badgeHost.setParent(root);
```

Return it in the object.

Project badge to screen space each frame in `render()`:

```js
  function render() {
    if (!current) return;
    const hidden = state.isGizmoDragging;
    current.ring.isVisible = !hidden;
    for (const t of current.ticks) t.isVisible = !hidden;
    current.handle.isVisible = !hidden;

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
      badge.hidden = hidden || projected.z < 0 || projected.z > 1;
    }
  }
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js -t "badge element is created and positioned" --runInBand
```

Expected: PASS.

- [ ] **Step 5: Add badge SCSS**

Append to `frontend/src/scss/components/_version-clock.scss`:

```scss
.model-clock-badge {
  position: absolute;
  left: 0;
  top: 0;
  padding: 2px 6px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--popover-fg);
  background: var(--popover-bg);
  border: var(--border-size-1) solid var(--border-color);
  border-radius: var(--size-1);
  pointer-events: none;
  z-index: 20;
  white-space: nowrap;
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js frontend/src/scss/components/_version-clock.scss test/frontend/model-clock-gizmo.test.js
git commit -m "feat(model-clock): DOM badge follows the gizmo handle"
```

---

## Task 8: Remove old DOM model clock

**Files:**
- Delete: `frontend/src/js/ui/model-clock.js`
- Delete: `test/frontend/model-clock.test.js`
- Modify: `frontend/src/scss/components/_version-clock.scss`

- [ ] **Step 1: Delete files**

```bash
rm frontend/src/js/ui/model-clock.js test/frontend/model-clock.test.js
```

- [ ] **Step 2: Remove .model-clock SCSS host rules**

Delete lines 124–157 (`.model-clock { ... }` block) from `frontend/src/scss/components/_version-clock.scss`. Keep `.scene-clock` and `@keyframes` / reduced-motion sections.

- [ ] **Step 3: Run unit tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/model-clock-gizmo.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(model-clock): remove old DOM model clock"
```

---

## Task 9: E2E selector and spec updates

**Files:**
- Modify: `e2e/helpers/studio-selectors.mjs`
- Modify: `e2e/specs/04-parametric-version.spec.js`

- [ ] **Step 1: Add canvas-based model-clock helpers**

In `e2e/helpers/studio-selectors.mjs`, add:

```js
export const modelClock = {
  // The gizmo is drawn on the Babylon canvas; tests use canvas pixels or
  // rely on the DOM badge as the readable anchor.
  badge: "#modelClockBadge",
};
```

- [ ] **Step 2: Update spec 04**

Rewrite the model-clock portion of `e2e/specs/04-parametric-version.spec.js` to:

1. Select a node.
2. Wait for `#modelClockBadge` to be visible and assert `v<N>` text.
3. Trigger a version step via keyboard (ArrowLeft) and assert scene reload.
4. Start a transform-gizmo drag and assert the badge disappears.

Example snippet to insert:

```js
// Model clock appears around the selected node.
await page.locator(selectors.outliner.nodeByName("Cube")).click();
await expect(page.locator(selectors.modelClock.badge)).toBeVisible();
await expect(page.locator(selectors.modelClock.badge)).toContainText("v3");

// Step back one version with the keyboard.
await page.keyboard.press("ArrowLeft");
await expect(page.locator(selectors.sceneClock.badge)).toContainText("v2");

// Hide during transform drag.
await page.keyboard.press("t");
await page.mouse.move(400, 300);
await page.mouse.down();
await expect(page.locator(selectors.modelClock.badge)).toBeHidden();
await page.mouse.up();
await expect(page.locator(selectors.modelClock.badge)).toBeVisible();
```

- [ ] **Step 3: Run E2E spec 04**

```bash
npx playwright test --config=e2e/playwright.config.js --project=chromium e2e/specs/04-parametric-version.spec.js
```

Expected: PASS (may need iteration if selectors/canvas timing differ).

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/studio-selectors.mjs e2e/specs/04-parametric-version.spec.js
git commit -m "test(e2e): update model-clock selectors and spec 04"
```

---

## Task 10: Full gate

**Files:**
- All of the above

- [ ] **Step 1: Run lint and typecheck**

```bash
npm run lint
npm run typecheck
npm run typecheck:frontend
```

Expected: No errors.

- [ ] **Step 2: Run full Jest suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Run E2E suite**

```bash
npm run test:e2e -- --project=chromium
```

Expected: 33/33 or better.

- [ ] **Step 4: Update docs**

If `CLAUDE.md` or `docs/CURRENT_STATUS.md` mentions the model clock implementation, update the description to reflect the 3D ring gizmo. Do not change test counts unless they actually changed.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(model-clock): 3D Babylon ring gizmo redesign complete"
```

---

## Self-review

**Spec coverage:**
- [x] 3D ring gizmo around selected node — Tasks 3, 4, 5, 7.
- [x] Ring radius from bounding box — Task 1.
- [x] Ticks + draggable handle — Tasks 3, 4.
- [x] Drag commits version — Task 4.
- [x] Hide during transform drag — Task 5.
- [x] Keyboard stepping — Task 6.
- [x] DOM badge — Task 7.
- [x] Remove old DOM model clock — Task 8.
- [x] Wire into scene-graph — Task 3.
- [x] E2E updates — Task 9.
- [x] Full gate — Task 10.

**Placeholder scan:** All steps include concrete file paths, code blocks, and exact commands. No TBD/TODO/fill-in-later language.

**Type consistency:**
- `_ringRadiusFromBounds(min, max)` uses `.x/.z` consistently.
- `_angleForIndex` / `_indexForAngle` use the same clockwise convention as `version-clock.js`.
- `store.getState().activeCid` is used consistently for active version lookup.

**Known simplifications documented:**
- Badge uses DOM projection rather than Babylon GUI (matches spec “Out of scope”).
- Optional `V` hotkey toggle from the spec is deferred; the ring is always visible when a node with history is selected.
- Keyboard focus proxy for screen readers is deferred to a follow-up if needed; current keyboard support routes through viewport keydown events.

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-07-model-clock-gizmo-redesign.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Defaulting to **Subagent-Driven** based on earlier preference. Reply `inline` if you want me to run it in this session instead.
