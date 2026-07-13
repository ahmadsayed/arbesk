# Model Clock Visual Dominance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the Time-mode model clock to be "restrained but unmistakable": a thicker track, an accent-blue progress arc replacing the confusing arrow, a round knob handle carrying the version badge, and dimmed tick labels.

**Architecture:** All changes are contained in `frontend/src/js/ui/model-clock-gizmo.js` (Babylon meshes + DOM labels), its Jest suite, and `_version-clock.scss`. The progress arc is a full torus clipped per-fragment by a tiny `BABYLON.ShaderMaterial` (uniforms `startAngle`/`sweep`) so drags update one float per frame with no mesh rebuilds.

**Tech Stack:** Babylon.js (utility layer, ShaderMaterial + Effect.ShadersStore), Jest + jsdom with a hand-rolled BABYLON mock, SCSS.

**Spec:** `docs/superpowers/specs/2026-07-14-model-clock-visual-dominance-design.md`

## Global Constraints

- Mesh names `versionRing`, `versionTick-<i>`, `versionHandle` MUST be preserved (tests + spec). New mesh names: `versionArc`, `versionHandleRim`, transform node `versionBadgeHost`.
- The `#modelClockBadge` DOM id/text contract MUST be preserved: visible with text `vN` while Time mode is active, gone when the gizmo is destroyed (E2E `04-parametric-version.spec.js` depends on it).
- No glow, bloom, or entry animations (explicitly out of scope).
- `frontend/src/js/ui/model-clock-gizmo.js` keeps its `// @ts-nocheck` header; everything must still pass `npm run typecheck` and `npm run typecheck:frontend` (both run in the pre-commit hook).
- Drag mechanics, keyboard stepping, billboarding, radius scaling, and lifecycle wiring are UNCHANGED.
- Run all Jest commands from the repo root: `/home/ahmedh/Projects/arbesk`.

---

### Task 1: Geometry restyle — delete arrow, thicken track, enlarge ticks, knob + rim handle, remove debug logs

**Files:**
- Modify: `frontend/src/js/ui/model-clock-gizmo.js`
- Test: `test/frontend/model-clock-gizmo.test.js`

**Interfaces:**
- Consumes: existing `buildGizmoForNode`, `placeHandle`, `createGizmoMaterial`.
- Produces: knob handle = `CreateCylinder` mesh named `versionHandle` with `rotation.x = Math.PI / 2`, child torus `versionHandleRim`; no `versionArrow` mesh; `placeHandle(g, angleRad)` no longer sets `handle.rotation.z`. Constants `CLOCK_ALPHA = 0.5`, `KNOB_DIAMETER_FACTOR`, `KNOB_HEIGHT_FACTOR`, `RIM_THICKNESS_FACTOR`, `TRACK_THICKNESS_FACTOR` exist for later tasks.

- [ ] **Step 1: Update the creation test to expect the new geometry (failing test)**

In `test/frontend/model-clock-gizmo.test.js`, replace the test `"selecting a node creates face, ring, ticks, and handle"` (lines 358–383) with:

```js
  test("selecting a node creates face, ring, ticks, knob handle with rim — and no arrow", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const face = babylon.createdMeshes.find((m) => m.name === "modelClockFace");
    const torus = babylon.createdMeshes.find((m) => m.name === "versionRing");
    const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
    const rim = babylon.createdMeshes.find((m) => m.name === "versionHandleRim");
    const arrow = babylon.createdMeshes.find((m) => m.name === "versionArrow");
    expect(face).toBeDefined();
    expect(torus).toBeDefined();
    expect(handle).toBeDefined();
    expect(rim).toBeDefined();
    // The arrow is gone — direction is communicated by the progress arc.
    expect(arrow).toBeUndefined();
    expect(babylon.createdMeshes.filter((m) => m.name.startsWith("versionTick")).length).toBe(3);
    expect(torus.material.disableLighting).toBe(true);
    expect(handle.material.disableLighting).toBe(true);
    // Knob is a flat disc facing the viewer, seated on the ring plane.
    expect(handle.rotation.x).toBeCloseTo(Math.PI / 2, 5);
    // Rim rides the knob so it follows every drag for free.
    expect(rim.parent).toBe(handle);
    // Translucent clock parts use alpha blending; knob and rim stay opaque.
    expect(face.material.alpha).toBeLessThan(1);
    expect(torus.material.alpha).toBeLessThan(1);
    expect(handle.material.alpha).toBe(1);
    expect(rim.material.alpha).toBe(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest test/frontend/model-clock-gizmo.test.js -t "knob handle with rim" 2>&1 | tail -20`
Expected: FAIL — `versionHandleRim` is undefined and `versionArrow` is defined.

- [ ] **Step 3: Implement the geometry restyle**

In `frontend/src/js/ui/model-clock-gizmo.js`:

3a. Replace the constants block (lines 101–126) — `ARROW_NAME` is deleted, alpha raised, sizing factors added:

```js
const RING_NAME = "versionRing";
const HANDLE_NAME = "versionHandle";
const TICK_PREFIX = "versionTick";
const RING_TESSELLATION = 64;

// Flat, unlit gizmo palette (matches Babylon transform-gizmo styling).
const COLOR_RING = [0.65, 0.65, 0.65];
const COLOR_TICK = [0.5, 0.5, 0.5];
const COLOR_ACTIVE = [0.2, 0.6, 1];
const COLOR_PUBLISHED = [0.2, 0.8, 0.2];
const COLOR_HOVER = [1, 1, 0.4];
const COLOR_KNOB_RIM = [0.55, 0.8, 1];

const DRAG_SMOOTHING = 0.5;
// How far outside the ring the DOM tick labels sit, as a multiple of the
// ring radius, so they don't occlude the 3D tick/handle meshes.
const LABEL_RADIUS_FACTOR = 1.12;

// Translucent analog-clock styling.
const CLOCK_ALPHA = 0.5; // alpha for track/ticks/face accents
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
const RIM_THICKNESS_FACTOR = 0.012;
```

3b. In `placeHandle` (lines 158–165), delete the line `g.handle.rotation.z = angleRad;` — the knob is a round disc whose orientation is fixed at build time.

3c. In `buildGizmoForNode`, change the ring creation (line 298) to use the thicker track:

```js
    { diameter: radius * 2, thickness: radius * TRACK_THICKNESS_FACTOR, tessellation: RING_TESSELLATION },
```

3d. Change the tick creation (line 317) to the larger marks:

```js
      {
        width: radius * TICK_WIDTH_FACTOR,
        height: radius * TICK_THICKNESS_FACTOR,
        depth: radius * TICK_THICKNESS_FACTOR,
      },
```

3e. Delete the entire arrowhead block (lines 344–365, from `// Arrowhead: cone just past the newest tick` through `gizmo.arrow = arrow;`).

3f. Replace the handle block (lines 367–377) with the knob + rim:

```js
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
```

3g. Delete every `console.log("[MODEL-CLOCK-DEBUG] ...")` statement in the file (there are 7: in `buildGizmoForNode`, the POINTERUP case, `onSelect` ×3, `destroyCurrent`, `onDeselect`, `onSceneReady`).

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `npx jest test/frontend/model-clock-gizmo.test.js 2>&1 | tail -15`
Expected: PASS, all tests (the old arrow assertion is gone; drag/dispose/badge tests are agnostic to handle shape).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js test/frontend/model-clock-gizmo.test.js
git commit -m "feat(model-clock): thicker track, larger ticks, knob+rim handle; drop arrow"
```

---

### Task 2: Progress arc — shader-clipped accent torus

**Files:**
- Modify: `frontend/src/js/ui/model-clock-gizmo.js`
- Test: `test/frontend/model-clock-gizmo.test.js`

**Interfaces:**
- Consumes: `placeHandle(g, angleRad)` (Task 1 version), `_angleForIndex`, constants from Task 1.
- Produces: mesh `versionArc` with a `BABYLON.ShaderMaterial` (shader name `modelClockArc`, uniforms `startAngle` + `sweep` in radians); `gizmo.arcMat` and `gizmo.arcStartAngle`; `placeHandle` updates the `sweep` uniform every time the knob moves. The arc fills clockwise from v1's tick to the knob.

- [ ] **Step 1: Extend the Babylon mock**

In `test/frontend/model-clock-gizmo.test.js`:

1a. Inside `MockMesh` (after the `addBehavior` method, line 148–150), add:

```js
    bakeCurrentTransformIntoVertices() {
      // Vertex data isn't modeled in the mock; transform baking is a no-op.
    }
```

1b. In the object returned by `createBabylonMock()` (after `Material: { MATERIAL_ALPHABLEND: 2 },`, line 191), add:

```js
    Effect: { ShadersStore: {} },
    ShaderMaterial: class {
      constructor(name, scene, shaderPath, options) {
        this.name = name;
        this.scene = scene;
        this.shaderPath = shaderPath;
        this.options = options;
        this.backFaceCulling = true;
        this.floats = {};
        this._disposed = false;
      }
      setFloat(key, value) {
        this.floats[key] = value;
        return this;
      }
      dispose() {
        this._disposed = true;
      }
    },
```

- [ ] **Step 2: Write the failing arc tests**

Add to the `"model-clock-gizmo lifecycle"` describe block:

```js
  test("progress arc uses the clipping shader and sweeps from v1 to the active version", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const arc = babylon.createdMeshes.find((m) => m.name === "versionArc");
    expect(arc).toBeDefined();
    expect(arc.material.shaderPath).toBe("modelClockArc");
    // n=3: v1 sits at 150°, active v3 at -90° → clockwise sweep of 240°.
    expect(arc.material.floats.startAngle).toBeCloseTo((150 * Math.PI) / 180, 5);
    expect(arc.material.floats.sweep).toBeCloseTo((240 * Math.PI) / 180, 5);
    // Both shader sources were registered.
    expect(babylon.Effect.ShadersStore.modelClockArcVertexShader).toContain("worldViewProjection");
    expect(babylon.Effect.ShadersStore.modelClockArcFragmentShader).toContain("discard");
  });

  test("dragging the knob updates the arc sweep uniform live", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const arc = babylon.createdMeshes.find((m) => m.name === "versionArc");
    const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
    const pointerCb = scene.onPointerObservable.add.mock.calls[0][0];
    const PET = babylon.PointerEventTypes;
    const sweepBefore = arc.material.floats.sweep;

    pointerCb({ type: PET.POINTERDOWN, pickInfo: { pickedMesh: handle } });
    scene.createPickingRay.mockReturnValue({
      origin: new babylon.Vector3(-0.5, 0, -10),
      direction: new babylon.Vector3(0, 0, 1),
    });
    pointerCb({ type: PET.POINTERMOVE });

    expect(arc.material.floats.sweep).not.toBeCloseTo(sweepBefore, 5);
    pointerCb({ type: PET.POINTERUP });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest test/frontend/model-clock-gizmo.test.js -t "arc" 2>&1 | tail -15`
Expected: FAIL — no mesh named `versionArc` is created.

- [ ] **Step 4: Implement the arc**

In `frontend/src/js/ui/model-clock-gizmo.js`:

4a. Add below the `utilityScene` function:

```js
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
```

4b. In `buildGizmoForNode`, directly after the ring block (`gizmo.ring = ring;`), add:

```js
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
```

4c. Add the mesh-name constant next to `RING_NAME` (constants block):

```js
const ARC_NAME = "versionArc";
```

4d. In `placeHandle`, after positioning the handle, update the sweep so the arc always ends at the knob:

```js
  if (g.arcMat) {
    const TWO_PI = Math.PI * 2;
    const sweep = (((g.arcStartAngle - angleRad) % TWO_PI) + TWO_PI) % TWO_PI;
    g.arcMat.setFloat("sweep", sweep);
  }
```

- [ ] **Step 5: Run the full suite to verify it passes**

Run: `npx jest test/frontend/model-clock-gizmo.test.js 2>&1 | tail -15`
Expected: PASS. (The material-disposal test also covers the ShaderMaterial: `root.dispose(false, true)` disposes it via the mesh.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js test/frontend/model-clock-gizmo.test.js
git commit -m "feat(model-clock): shader-clipped progress arc from v1 to the knob"
```

---

### Task 3: Badge travels with the knob; tick label states

**Files:**
- Modify: `frontend/src/js/ui/model-clock-gizmo.js`
- Test: `test/frontend/model-clock-gizmo.test.js`

**Interfaces:**
- Consumes: `placeHandle` (Tasks 1–2), `positionLabelEl`, `createTickLabels`, `render`, `destroyCurrent`.
- Produces: standalone badge element `<div id="modelClockBadge" class="model-clock-badge">` inside `#modelClockTickLabels`, anchored to transform node `versionBadgeHost` (`gizmo.badgeHost`, placed at `BADGE_RADIUS_FACTOR × radius` along the knob angle by `placeHandle`); tick labels get `.published` class and the badge-coincident label is `hidden`.

- [ ] **Step 1: Harden the store mock for per-test overrides**

In the `beforeEach` of the lifecycle describe block (after `storeMock.loadVersion.mockClear();`), add — this makes `publishedCid` overridable per test without leaking into others:

```js
    storeMock.getState.mockImplementation(() => ({
      entries: ENTRIES,
      activeCid: "c3",
      publishedCid: null,
      isLoading: false,
    }));
```

- [ ] **Step 2: Write the failing badge/label tests**

Add to the lifecycle describe block:

```js
  test("badge is a standalone element following the knob; the coincident tick label hides", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const badge = document.getElementById("modelClockBadge");
    expect(badge).toBeTruthy();
    expect(badge.classList.contains("model-clock-badge")).toBe(true);
    expect(badge.classList.contains("model-clock-tick-label")).toBe(false);
    expect(badge.textContent).toBe("v3");

    const labels = Array.from(document.querySelectorAll(".model-clock-tick-label"));
    // v3's own label hides — the knob + badge sit on that tick.
    expect(labels[2].hidden).toBe(true);
    expect(labels[0].hidden).toBe(false);
    expect(labels[1].hidden).toBe(false);
  });

  test("published version's tick label carries the published class", async () => {
    storeMock.getState.mockImplementation(() => ({
      entries: ENTRIES,
      activeCid: "c3",
      publishedCid: "c2",
      isLoading: false,
    }));
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const labels = Array.from(document.querySelectorAll(".model-clock-tick-label"));
    expect(labels[1].classList.contains("published")).toBe(true);
    expect(labels[0].classList.contains("published")).toBe(false);
    expect(labels[2].classList.contains("published")).toBe(false);
  });
```

(The badge-follows-knob positioning behavior is already covered by the existing live-drag test, which re-queries `#modelClockBadge` text during a drag.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest test/frontend/model-clock-gizmo.test.js -t "standalone element" 2>&1 | tail -15`
Expected: FAIL — badge has class `model-clock-tick-label`, not `model-clock-badge`, and `labels[2].hidden` is false.

Run: `npx jest test/frontend/model-clock-gizmo.test.js -t "published class" 2>&1 | tail -15`
Expected: FAIL — no `published` class is applied.

- [ ] **Step 4: Implement badge host + element and label states**

In `frontend/src/js/ui/model-clock-gizmo.js`:

4a. Add to the constants block:

```js
// The badge sits a little further out than the tick labels so it clears the
// knob and its rim.
const BADGE_RADIUS_FACTOR = 1.22;
```

4b. In `buildGizmoForNode`, before the knob block, create the badge host:

```js
  // Anchor for the DOM version badge; placeHandle keeps it just outside the
  // knob so the badge travels with the thing you drag.
  const badgeHost = new BABYLON.TransformNode("versionBadgeHost", uScene);
  badgeHost.setParent(root);
  gizmo.badgeHost = badgeHost;
```

4c. In `placeHandle`, after positioning the handle (before the arc-sweep block), position the badge host:

```js
  const badgeR = g.radius * BADGE_RADIUS_FACTOR;
  g.badgeHost.position = new BABYLON.Vector3(
    Math.cos(angleRad) * badgeR,
    Math.sin(angleRad) * badgeR,
    0
  );
```

4d. In `initModelClockGizmo`, delete the `let lastBadgeIdx = -1;` declaration and the `lastBadgeIdx = -1;` reset inside `createTickLabels`. Extend `createTickLabels` to build the badge:

```js
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
```

4e. In `render()`, replace everything from `const badgeIdx = hoverIdx >= 0 ? hoverIdx : safeActiveIdx;` to the end of the label loop with:

```js
    const badgeIdx = hoverIdx >= 0 ? hoverIdx : safeActiveIdx;
    const publishedIdx = current.filtered.findIndex((e) => e.cid === s.publishedCid);

    if (current.badgeEl) {
      current.badgeEl.textContent = `v${current.filtered[badgeIdx].version}`;
      positionLabelEl(current.badgeEl, current.badgeHost.getAbsolutePosition());
    }

    for (let i = 0; i < current.tickLabelEls.length; i++) {
      const el = current.tickLabelEls[i];
      positionLabelEl(el, current.tickLabelHosts[i].getAbsolutePosition());
      el.classList.toggle("active", i === safeActiveIdx);
      el.classList.toggle("hover", i === hoverIdx);
      el.classList.toggle("published", i === publishedIdx);
      // The knob + badge occupy this tick; hide its label to avoid doubling.
      if (i === badgeIdx) el.hidden = true;
    }
```

4f. In `destroyCurrent()`, after the tick-label removal loop, add:

```js
      current.badgeEl?.remove();
```

- [ ] **Step 5: Run the full suite to verify it passes**

Run: `npx jest test/frontend/model-clock-gizmo.test.js 2>&1 | tail -15`
Expected: PASS — including the pre-existing tests `"badge and tick label reflect the hovered version live during drag"` (badge re-queried by id; text comes from `render()`), `"scene cleared disposes the gizmo and removes the badge"`, and `"badge element is created and positioned"`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/ui/model-clock-gizmo.js test/frontend/model-clock-gizmo.test.js
git commit -m "feat(model-clock): version badge travels with the knob; published label state"
```

---

### Task 4: SCSS — badge chip, dimmed labels, published tint

**Files:**
- Modify: `frontend/src/scss/components/_version-clock.scss:149-197`

**Interfaces:**
- Consumes: DOM classes from Task 3 (`.model-clock-badge`, `.model-clock-tick-label.published`); existing tokens `--accent-bg`, `--accent-fg`, `--green-4`, `--yellow-4`, `--font-mono`, `--popover-bg`, `--border-color`.
- Produces: visual styling only; no JS contract changes.

- [ ] **Step 1: Update the styles**

Replace the block from the comment at line 149 through the end of `.model-clock-tick-label` (line 197) with:

```scss
// One label per tick, dimmed until relevant, showing that tick's own version
// number. The published version's label stays bright with a green tint. The
// active (or drag-hovered) tick's label is hidden entirely — the knob sits on
// that tick and the standalone badge (#modelClockBadge, .model-clock-badge)
// travels with it showing the version.
.model-clock-tick-labels {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 19;
}

.model-clock-tick-label {
  position: absolute;
  left: 0;
  top: 0;
  padding: 1px 5px;
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--dim-fg);
  background: var(--popover-bg);
  border: var(--border-size-1) solid var(--border-color);
  border-radius: var(--size-1);
  opacity: 0.35;
  white-space: nowrap;
  transition: opacity var(--duration-quick) ease;

  &.active {
    padding: 2px 6px;
    font-size: 11px;
    color: var(--accent-fg);
    background: var(--accent-bg);
    border-color: var(--accent-bg);
    opacity: 1;
    z-index: 1;
  }

  &.hover {
    padding: 2px 6px;
    font-size: 11px;
    color: var(--window-fg);
    background: var(--yellow-4);
    border-color: var(--yellow-4);
    opacity: 1;
    z-index: 2;
  }

  &.published {
    color: var(--green-4);
    border-color: var(--green-4);
    opacity: 1;
  }
}

// Standalone version badge riding just outside the knob.
.model-clock-badge {
  position: absolute;
  left: 0;
  top: 0;
  padding: 2px 7px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--accent-fg);
  background: var(--accent-bg);
  border-radius: var(--size-1);
  white-space: nowrap;
  z-index: 3;
}
```

- [ ] **Step 2: Build the frontend to verify the SCSS compiles**

Run: `npm run build:frontend 2>&1 | tail -5`
Expected: build completes with no Sass errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/scss/components/_version-clock.scss
git commit -m "style(model-clock): badge chip, dimmed tick labels, published tint"
```

---

### Task 5: Full verification gate

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything above.
- Produces: green gate; evidence for completion claims.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck && npm run typecheck:frontend`
Expected: both exit 0.

- [ ] **Step 2: Frontend Jest suite**

Run: `npm run test:frontend 2>&1 | tail -10`
Expected: all suites pass. (`test/api.test.js` failures without the live dev stack are environmental, not regressions — but `test:frontend` shouldn't touch it.)

- [ ] **Step 3: Rebuild frontend and run E2E (Studio UI change → E2E required)**

```bash
npm run build:frontend
npm run test:e2e -- --project=chromium
```

Expected: all Playwright specs pass, in particular `04-parametric-version.spec.js` (badge visible with `v2`, hidden after leaving Time mode). Known pitfall: E2E reuses any backend already on :9090 — if every spec fails at generation with an upload-url HTTP 500, restart the dev stack (`./scripts/start-dev.sh --setup-only`) and re-run.

- [ ] **Step 4: Visual spot check (manual/Playwright MCP)**

Load the Studio, generate or open an asset with ≥2 versions, press `V`, select the node, and screenshot: thick gray track, blue arc from v1 to the knob, no arrow cone, round knob with rim, badge chip beside the knob, dim labels, published label green (if a published version exists). Compare against the "dull" screenshot that motivated this work.

- [ ] **Step 5: Final commit (if any fixups) and report**

Report results with the actual command output — no success claims without evidence (superpowers:verification-before-completion).
