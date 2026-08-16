# Animation Preview in the Inspector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the selected node's model contains glTF animations, the Studio Inspector lists them in a dropdown; selecting one plays it looped in the viewport, "None" stops playback. Preview-only, nothing persisted.

**Architecture:** Babylon's glTF loader already imports animation groups but `importFromBlob` discards them. Capture them into a new `state.nodeAnimationGroups` map keyed by nodeId, stop Babylon's auto-play of the first animation (`animationStartMode = NONE`), and add a small side-effect module `animation-preview.js` that drives a new Inspector section from selection events on the existing event bus.

**Tech Stack:** Babylon.js 9.12.0 (CDN global `BABYLON`, never imported), ESM JS, Pug templates, Jest (jsdom) unit tests, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-08-07-animation-preview-inspector-design.md`

## Global Constraints

- ESM in root + frontend; CDN global `BABYLON` — never `import` it. camelCase vars/functions.
- JSDoc on new public functions; `npm run typecheck:frontend` must pass (`allowJs`/`checkJs`, strict).
- No SCSS changes expected — reuse `.inspector-section` and `.form-select`.
- Pug: no SRI hashes; the new section follows the `#scaleSection` pattern exactly.
- Backend log tags irrelevant here; frontend warnings use `console.warn("[ANIM] ...")`.
- **Git commits require explicit user confirmation before running (repo policy overrides the commit steps below — ask once before the first commit, then batch per task as approved).**
- Run from repo root `/home/ahmedh/Projects/arbesk` unless noted.

---

### Task 1: Capture animation groups per node

`ImportMeshAsync` already returns `animationGroups`; thread them through `importFromBlob` → `loadAsset` → `attachMetadata` into a new state map, and dispose them with the node/scene.

**Files:**
- Modify: `frontend/src/js/engine/state.ts:19-22`
- Modify: `frontend/src/js/engine/scene-loader.ts:66-116` (`importFromBlob`, `loadAsset`, `attachMetadata`)
- Modify: `frontend/src/js/engine/cleanup.ts:60-78` (`disposeNode`), `:124-140` (`clearScene`)
- Test: `test/frontend/scene-loader-animations.test.js` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `state.nodeAnimationGroups: Map<string, BABYLON.AnimationGroup[]>` (from `state.js`)
  - `importFromBlob(blob, extension)` returns `{ meshes, transformNodes, animationGroups }` (Task 3 relies on the map, not this signature)

- [ ] **Step 1: Write the failing test**

Create `test/frontend/scene-loader-animations.test.js`:

```js
/**
 * @jest-environment jsdom
 *
 * importFromBlob must surface the GLB's animation groups and loadAsset must
 * store them per nodeId so the inspector can offer animation previews.
 * disposeNode / clearScene must dispose the groups with the node.
 */
import { jest, expect, test, beforeAll } from "@jest/globals";

let sceneLoader, cleanup, state, registerFormatHandler;
const fakeGroups = [
  { name: "spin", stop: jest.fn(), reset: jest.fn(), isDisposed: () => false, dispose: jest.fn() },
  { name: "bob", stop: jest.fn(), reset: jest.fn(), isDisposed: () => false, dispose: jest.fn() },
];

beforeAll(async () => {
  global.URL.createObjectURL = jest.fn(() => "blob:fake");
  global.URL.revokeObjectURL = jest.fn();
  global.BABYLON = {
    SceneLoader: {
      ImportMeshAsync: jest.fn().mockResolvedValue({
        meshes: [{ name: "m1", parent: null, metadata: null }],
        transformNodes: [],
        animationGroups: fakeGroups,
      }),
    },
  };

  await jest.unstable_mockModule(
    "../../frontend/src/js/events/bus.ts",
    () => ({
      emit: jest.fn(),
      on: jest.fn(),
      EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/state/asset-state.js",
    () => ({ assetState: { get: jest.fn(() => ({})), set: jest.fn() }, tagManifestCid: jest.fn() })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/state/wallet-state.ts",
    () => ({ walletState: { get: jest.fn(() => ({})) } })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/state/ui-state.ts",
    () => ({ uiState: { set: jest.fn() } })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/transforms.ts",
    () => ({
      extractCid: (src) => (src && src.cid ? src.cid : src),
      detectAssetFormat: () => "testanim",
      getManifestNodes: (m) => m?.scene?.nodes || [],
      applyTransformMatrix: jest.fn(),
      applyDefaultMaterial: jest.fn(),
      centerImportedAsset: jest.fn(),
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/placeholders.ts",
    () => ({ createPlaceholder: jest.fn(), disposePlaceholder: jest.fn() })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/time-travel.ts",
    () => ({ applyColor: jest.fn(), applyScale: jest.fn() })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/scene-graph.ts",
    () => ({ createAnchorNode: jest.fn(() => ({ parent: null, metadata: {} })) })
  );

  ({ registerFormatHandler } = await import(
    "../../frontend/src/js/formats/index.ts"
  ));
  registerFormatHandler({
    format: "testanim",
    extensions: [".testanim"],
    sniff: () => false,
    load: async (_src, ctx) => ctx.importFromBlob(new Blob(["x"]), ".testanim"),
    decomposeForSave: async () => null,
    isStoredForm: () => true,
    isDedupSource: () => false,
  });

  sceneLoader = await import("../../frontend/src/js/engine/scene-loader.ts");
  cleanup = await import("../../frontend/src/js/engine/cleanup.ts");
  ({ state } = await import("../../frontend/src/js/engine/state.ts"));
});

const SRC = { cid: "bafyAnim", path: "model.testanim", format: "testanim" };

test("loadAsset stores animation groups per nodeId", async () => {
  const parent = { parent: null, metadata: {} };
  await sceneLoader.loadAsset(SRC, parent, "nodeAnim1");
  expect(state.nodeAnimationGroups.get("nodeAnim1")).toEqual(fakeGroups);
  expect(state.nodeMeshes.get("nodeAnim1")).toHaveLength(1);
});

test("disposeNode disposes and removes the node's animation groups", async () => {
  await sceneLoader.loadAsset(SRC, { parent: null, metadata: {} }, "nodeAnim2");
  cleanup.disposeNode("nodeAnim2");
  for (const g of fakeGroups) expect(g.dispose).toHaveBeenCalled();
  expect(state.nodeAnimationGroups.has("nodeAnim2")).toBe(false);
});

test("clearScene disposes all remaining animation groups", async () => {
  const extra = [{ name: "x", stop: jest.fn(), isDisposed: () => false, dispose: jest.fn() }];
  state.nodeAnimationGroups.set("nodeAnim3", extra);
  state.scene = { stopAllAnimations: jest.fn(), transformNodes: [], meshes: [] };
  cleanup.clearScene();
  expect(extra[0].dispose).toHaveBeenCalled();
  expect(state.nodeAnimationGroups.size).toBe(0);
  state.scene = null;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/frontend/scene-loader-animations.test.js`
Expected: FAIL — `state.nodeAnimationGroups` is `undefined` (TypeError reading `get`/`set`).

- [ ] **Step 3: Implement**

`frontend/src/js/engine/state.ts` — after the `nodeMeshes` entry (line 22), add:

```js
  /** @type {Map<string, BABYLON.AnimationGroup[]>} */
  nodeAnimationGroups: new Map(),
```

`frontend/src/js/engine/scene-loader.ts` — in `importFromBlob` (line 77-80), return the groups too:

```js
    return {
      meshes: result.meshes,
      transformNodes: result.transformNodes || [],
      animationGroups: result.animationGroups || [],
    };
```

In `loadAsset` (lines 45-50), pass them to `attachMetadata`:

```js
    attachMetadata(
      result.meshes,
      nodeId,
      parentNode,
      result.transformNodes || [],
      result.animationGroups || []
    );
```

Change `attachMetadata`'s signature and store the groups (lines 86 and 113-115):

```js
function attachMetadata(meshes, nodeId, parentNode, transformNodes = [], animationGroups = []) {
```

```js
  centerImportedAsset(meshArray, importedNodes, parentNode, nodeId);
  state.nodeMeshes.set(nodeId, meshArray);
  if (animationGroups.length > 0) {
    state.nodeAnimationGroups.set(nodeId, animationGroups);
  }
  state._nonChromeMeshCache = null;
```

`frontend/src/js/engine/cleanup.ts` — in `disposeNode`, after the `nodeMeshes` block (line 70), add:

```js
  const animationGroups = state.nodeAnimationGroups.get(nodeId);
  if (animationGroups) {
    for (const group of animationGroups) {
      try {
        group.stop();
        if (!group.isDisposed()) group.dispose();
      } catch {
        // ignore — group may already be torn down
      }
    }
    state.nodeAnimationGroups.delete(nodeId);
  }
```

In `clearScene`, after `state.nodeAnchors.clear();` (line 140), add:

```js
  state.nodeAnimationGroups.forEach((groups) => {
    groups.forEach((group) => {
      try {
        if (!group.isDisposed()) group.dispose();
      } catch {
        // ignore
      }
    });
  });
  state.nodeAnimationGroups.clear();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/frontend/scene-loader-animations.test.js`
Expected: PASS (3 tests). Also run `npx jest test/frontend/linked-asset-self-add.test.js` — still PASS (scene-loader consumers unaffected).

- [ ] **Step 5: Commit** (after user confirmation)

```bash
git add frontend/src/js/engine/state.ts frontend/src/js/engine/scene-loader.ts frontend/src/js/engine/cleanup.ts test/frontend/scene-loader-animations.test.js
git commit -m "feat(studio): capture glTF animation groups per scene node"
```

---

### Task 2: Stop Babylon's glTF auto-play on import

Babylon's glTF loader defaults to `animationStartMode = FIRST`, auto-playing the first clip on load. The Studio viewport must stay static until the user picks a clip.

**Files:**
- Modify: `frontend/src/js/engine/babylon-loader.ts:40-50` (`ensureBabylon`)
- Test: `test/frontend/babylon-loader.test.js` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `registerGltfLoaderDefaults()` (exported from `babylon-loader.js`); registers an `OnPluginActivatedObservable` callback that sets `animationStartMode = NONE` on the `gltf` loader plugin.

- [ ] **Step 1: Write the failing test**

Create `test/frontend/babylon-loader.test.js`:

```js
/**
 * @jest-environment jsdom
 *
 * The glTF loader plugin must be configured with animationStartMode = NONE so
 * imported animated assets stay static until the user previews a clip.
 */
import { expect, test, beforeAll } from "@jest/globals";

let registerGltfLoaderDefaults;

beforeAll(async () => {
  ({ registerGltfLoaderDefaults } = await import(
    "../../frontend/src/js/engine/babylon-loader.ts"
  ));
});

test("registers a plugin callback that sets animationStartMode NONE on gltf", () => {
  const callbacks = [];
  global.BABYLON = {
    SceneLoader: {
      OnPluginActivatedObservable: { add: (cb) => callbacks.push(cb) },
    },
    GLTF2: { GLTFLoaderAnimationStartMode: { NONE: 0, FIRST: 1, ALL: 2 } },
  };

  registerGltfLoaderDefaults();
  expect(callbacks).toHaveLength(1);

  const gltfPlugin = { name: "gltf", animationStartMode: 1 };
  callbacks[0](gltfPlugin);
  expect(gltfPlugin.animationStartMode).toBe(0);

  const otherPlugin = { name: "obj", animationStartMode: 1 };
  callbacks[0](otherPlugin);
  expect(otherPlugin.animationStartMode).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/frontend/babylon-loader.test.js`
Expected: FAIL — `registerGltfLoaderDefaults is not a function`.

- [ ] **Step 3: Implement**

In `frontend/src/js/engine/babylon-loader.ts`, add after the `loadScript` function:

```js
/**
 * Register glTF loader defaults. Babylon's glTF plugin auto-plays the first
 * animation on import; the Studio keeps the viewport static until the user
 * picks a clip in the inspector (see engine/animation-preview.ts).
 */
export function registerGltfLoaderDefaults() {
  const startModes = BABYLON.GLTF2?.GLTFLoaderAnimationStartMode;
  if (!startModes) return;
  BABYLON.SceneLoader.OnPluginActivatedObservable.add((plugin) => {
    if (plugin.name === "gltf") {
      plugin.animationStartMode = startModes.NONE;
    }
  });
}
```

And call it once the plugins are loaded — change the end of `ensureBabylon` (lines 42-47):

```js
    _promise = loadScript(BJS_CORE).then(() =>
      Promise.all([
        loadScript(`${BJS_BASE}loaders/babylonjs.loaders.min.js`),
        loadScript(`${BJS_BASE}materialsLibrary/babylonjs.materials.min.js`),
      ]).then(() => {
        registerGltfLoaderDefaults();
      }),
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/frontend/babylon-loader.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** (after user confirmation)

```bash
git add frontend/src/js/engine/babylon-loader.ts test/frontend/babylon-loader.test.js
git commit -m "feat(studio): disable glTF animation auto-play on import"
```

---

### Task 3: Inspector "Animations" section + playback controller

**Files:**
- Modify: `frontend/src/pug/app.pug:349` (insert section after `#scaleSection`), `:472` (script tag)
- Create: `frontend/src/js/engine/animation-preview.ts`
- Test: `test/frontend/animation-preview.test.js` (new)

**Interfaces:**
- Consumes: `state.nodeAnimationGroups` (Task 1); `EVENTS.NODE_SELECTED` / `SELECTION_CHANGED` / `SCENE_CLEARED` from `frontend/src/js/events/bus.ts`; `state.selectedNodeIds` from `state.js`.
- Produces: DOM contract `#animationsSection` (section, `hidden` toggled) and `#animationSelect` (select; `value=""` = None, otherwise the group index as string). E2E (Task 4) drives these.

- [ ] **Step 1: Write the failing test**

Create `test/frontend/animation-preview.test.js`:

```js
/**
 * @jest-environment jsdom
 *
 * Inspector animation preview: the Animations section appears only for a
 * single selected node that has animation groups; choosing a clip plays it
 * looped, "None" / deselect / multi-select stop playback.
 */
import { jest, expect, test, beforeAll, beforeEach } from "@jest/globals";

let emit, EVENTS, state;

function makeGroup(name) {
  return { name, start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
}

function section() {
  return document.getElementById("animationsSection");
}
function select() {
  return /** @type {HTMLSelectElement} */ (document.getElementById("animationSelect"));
}

beforeAll(async () => {
  document.body.innerHTML = `
    <section id="animationsSection" class="inspector-section" hidden>
      <details><summary class="inspector-section-title">Animations</summary></details>
      <select id="animationSelect" class="form-select" aria-label="Animation clip">
        <option value="">None</option>
      </select>
    </section>`;
  ({ emit, EVENTS } = await import("../../frontend/src/js/events/bus.ts"));
  ({ state } = await import("../../frontend/src/js/engine/state.ts"));
  await import("../../frontend/src/js/engine/animation-preview.ts");
});

beforeEach(() => {
  state.nodeAnimationGroups.clear();
  state.selectedNodeIds = new Set();
  section().hidden = true;
  select().innerHTML = '<option value="">None</option>';
});

test("stays hidden for a node without animations", () => {
  state.selectedNodeIds = new Set(["n1"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n1" });
  expect(section().hidden).toBe(true);
});

test("lists animation names for an animated node, None first", () => {
  state.nodeAnimationGroups.set("n2", [makeGroup("run"), makeGroup("")]);
  state.selectedNodeIds = new Set(["n2"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n2" });
  expect(section().hidden).toBe(false);
  const labels = [...select().options].map((o) => o.textContent);
  expect(labels).toEqual(["None", "run", "Animation 2"]);
});

test("selecting a clip plays it looped; switching stops the previous", () => {
  const groups = [makeGroup("run"), makeGroup("idle")];
  state.nodeAnimationGroups.set("n3", groups);
  state.selectedNodeIds = new Set(["n3"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n3" });

  select().value = "0";
  select().dispatchEvent(new Event("change"));
  expect(groups[0].start).toHaveBeenCalledWith(true);

  select().value = "1";
  select().dispatchEvent(new Event("change"));
  expect(groups[0].stop).toHaveBeenCalled();
  expect(groups[1].start).toHaveBeenCalledWith(true);
});

test("None stops playback", () => {
  const groups = [makeGroup("run")];
  state.nodeAnimationGroups.set("n4", groups);
  state.selectedNodeIds = new Set(["n4"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n4" });
  select().value = "0";
  select().dispatchEvent(new Event("change"));

  select().value = "";
  select().dispatchEvent(new Event("change"));
  expect(groups[0].stop).toHaveBeenCalled();
});

test("deselect stops playback and hides the section", () => {
  const groups = [makeGroup("run")];
  state.nodeAnimationGroups.set("n5", groups);
  state.selectedNodeIds = new Set(["n5"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n5" });
  select().value = "0";
  select().dispatchEvent(new Event("change"));

  state.selectedNodeIds = new Set();
  emit(EVENTS.SELECTION_CHANGED, { nodeIds: [] });
  expect(groups[0].stop).toHaveBeenCalled();
  expect(section().hidden).toBe(true);
});

test("multi-select hides the section and stops playback", () => {
  const groups = [makeGroup("run")];
  state.nodeAnimationGroups.set("n6", groups);
  state.selectedNodeIds = new Set(["n6"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n6" });
  select().value = "0";
  select().dispatchEvent(new Event("change"));

  state.selectedNodeIds = new Set(["n6", "n7"]);
  emit(EVENTS.SELECTION_CHANGED, { nodeIds: ["n6", "n7"] });
  expect(groups[0].stop).toHaveBeenCalled();
  expect(section().hidden).toBe(true);
});

test("SCENE_CLEARED stops playback and hides the section", () => {
  const groups = [makeGroup("run")];
  state.nodeAnimationGroups.set("n8", groups);
  state.selectedNodeIds = new Set(["n8"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n8" });
  select().value = "0";
  select().dispatchEvent(new Event("change"));

  emit(EVENTS.SCENE_CLEARED, {});
  expect(groups[0].stop).toHaveBeenCalled();
  expect(section().hidden).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/frontend/animation-preview.test.js`
Expected: FAIL — module `animation-preview.js` not found.

- [ ] **Step 3: Implement**

Create `frontend/src/js/engine/animation-preview.ts`:

```js
/**
 * Arbesk Animation Preview
 *
 * Inspector "Animations" section: when the single selected node's model
 * contains glTF animation groups (captured per nodeId in
 * state.nodeAnimationGroups by scene-loader), the user can pick a clip to
 * preview it looped in the viewport. Purely ephemeral — nothing is staged
 * or persisted. Babylon's glTF loader is configured with
 * animationStartMode NONE (babylon-loader.js) so nothing auto-plays.
 */

import { on, EVENTS } from "../events/bus.js";
import { state } from "./state.js";

const animationsSection = document.getElementById("animationsSection");
const animationsSectionDetails = animationsSection?.querySelector("details");
/** @type {HTMLSelectElement|null} */
const animationSelect = /** @type {HTMLSelectElement|null} */ (
  document.getElementById("animationSelect")
);

/** @type {BABYLON.AnimationGroup|null} */
let playingGroup = null;
/** @type {string|null} */
let activeNodeId = null;

/**
 * Stop the currently previewing group (if any) and return it to frame 0.
 */
function stopPlayingGroup() {
  if (!playingGroup) return;
  try {
    playingGroup.stop();
    playingGroup.reset();
  } catch {
    // group already disposed with its node — nothing to stop
  }
  playingGroup = null;
}

/**
 * Stop playback, hide the section, reset the dropdown.
 */
function hideAnimationsSection() {
  stopPlayingGroup();
  activeNodeId = null;
  if (animationsSection) animationsSection.hidden = true;
  if (animationSelect) animationSelect.value = "";
}

/**
 * Populate the dropdown from the node's animation groups and show the
 * section. Groups without a name get a positional label.
 *
 * @param {string} nodeId
 */
function showAnimationsForNode(nodeId) {
  if (!animationsSection || !animationSelect) return;
  stopPlayingGroup();
  activeNodeId = nodeId;

  const groups = state.nodeAnimationGroups.get(nodeId) || [];
  if (groups.length === 0) {
    animationsSection.hidden = true;
    return;
  }

  animationSelect.innerHTML = "";
  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "None";
  animationSelect.appendChild(noneOption);
  groups.forEach((group, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = group.name || `Animation ${i + 1}`;
    animationSelect.appendChild(option);
  });
  animationSelect.value = "";
  animationsSection.hidden = false;
  if (animationsSectionDetails) animationsSectionDetails.open = true;
}

on(EVENTS.NODE_SELECTED, (/** @type {{nodeId?: string}} */ e) => {
  if (state.selectedNodeIds.size > 1 || !e?.nodeId) {
    hideAnimationsSection();
    return;
  }
  showAnimationsForNode(e.nodeId);
});

// Multi-select or full deselect: single-node preview no longer applies.
on(EVENTS.SELECTION_CHANGED, (/** @type {{nodeIds?: string[]}} */ e) => {
  const count = Array.isArray(e?.nodeIds) ? e.nodeIds.length : 0;
  if (count !== 1) hideAnimationsSection();
});

on(EVENTS.SCENE_CLEARED, hideAnimationsSection);

if (animationSelect) {
  animationSelect.addEventListener("change", () => {
    stopPlayingGroup();
    if (!activeNodeId || animationSelect.value === "") return;
    const groups = state.nodeAnimationGroups.get(activeNodeId) || [];
    const group = groups[Number(animationSelect.value)];
    if (!group) return;
    try {
      group.start(true); // loop the preview
      playingGroup = group;
    } catch (error) {
      const err = /** @type {Error} */ (error);
      console.warn(`[ANIM] preview start failed: ${err.message}`);
      animationSelect.value = "";
    }
  });
}
```

Note: importing `state` from `./state.js` directly (not `./scene-graph.js`) — `state.js` has zero imports, which keeps the module cheap and unit-testable.

- [ ] **Step 4: Add the Pug section + script tag, rebuild**

In `frontend/src/pug/app.pug`, insert between the `#scaleSection` block (ends line 349) and `#parametricEditor` (line 350):

```pug
              section#animationsSection.inspector-section.inspector-animations(hidden)
                details
                  summary.inspector-section-title Animations
                  div
                    select#animationSelect.form-select(aria-label="Animation clip")
                      option(value="") None
```

After the `parametric-preview.js` script tag (line 472), add:

```pug
    script(type="module", src="/js/engine/animation-preview.js")
```

Run: `npm run build:frontend`
Expected: builds clean; `frontend/dist/index.html` contains `id="animationsSection"` and `animation-preview.js` (verify with `grep -c animationsSection frontend/dist/index.html` → 1).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest test/frontend/animation-preview.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit** (after user confirmation)

```bash
git add frontend/src/pug/app.pug frontend/src/js/engine/animation-preview.ts test/frontend/animation-preview.test.js frontend/dist/
git commit -m "feat(studio): animation clip preview dropdown in inspector"
```

---

### Task 4: E2E sync — selectors, animated fixture, spec

No existing GLB fixture contains animations (`howdy.glb`, `suka.glb`, `triangle.glb` all checked — none). Generate a minimal animated GLB fixture, register selectors, add a spec.

**Files:**
- Create: `e2e/fixtures/make-animated-glb.mjs`
- Create: `e2e/fixtures/animated-triangle.glb` (generated output — commit it)
- Modify: `e2e/helpers/studio-selectors.mjs:74-75`
- Create: `e2e/specs/19-animation-preview.spec.js`

**Interfaces:**
- Consumes: DOM contract from Task 3 (`#animationsSection`, `#animationSelect`); helpers `connectLibrary`, `uploadLibraryFile`, `openLibraryAssetInStudio` from `e2e/helpers/flows.mjs`; selectors `outlinerSwitcherBtn`, `outlinerNode`.
- Produces: selectors `animationsSection`, `animationSelect`; fixture `e2e/fixtures/animated-triangle.glb` (uploaded asset name = `animated-triangle`).

- [ ] **Step 1: Write the fixture generator and generate the GLB**

Create `e2e/fixtures/make-animated-glb.mjs`:

```js
/**
 * Generates animated-triangle.glb — a minimal valid glTF 2.0 binary with one
 * triangle mesh and a 1s looping "spin" rotation animation on its node.
 * Run: node e2e/fixtures/make-animated-glb.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// BIN chunk: 3×VEC3 positions | 2×SCALAR times | 2×VEC4 quaternions
const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
const times = new Float32Array([0, 1]);
const rotations = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0]); // identity, 180° about Z
const bin = Buffer.concat([
  Buffer.from(positions.buffer),
  Buffer.from(times.buffer),
  Buffer.from(rotations.buffer),
]);
const binPad = (4 - (bin.length % 4)) % 4;
const binPadded = Buffer.concat([bin, Buffer.alloc(binPad)]);

const gltf = {
  asset: { version: "2.0", generator: "arbesk-e2e" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: "spin-tri" }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  animations: [
    {
      name: "spin",
      channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }],
      samplers: [{ input: 1, interpolation: "LINEAR", output: 2 }],
    },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
    { bufferView: 1, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
    { bufferView: 2, componentType: 5126, count: 2, type: "VEC4" },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 36 },
    { buffer: 0, byteOffset: 36, byteLength: 8 },
    { buffer: 0, byteOffset: 44, byteLength: 32 },
  ],
  buffers: [{ byteLength: bin.length }],
};

let json = Buffer.from(JSON.stringify(gltf), "utf8");
const jsonPad = (4 - (json.length % 4)) % 4;
if (jsonPad) json = Buffer.concat([json, Buffer.from(" ".repeat(jsonPad))]);

const chunkHeader = (len, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(len, 0);
  h.writeUInt32LE(type, 4);
  return h;
};
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);

const body = Buffer.concat([
  chunkHeader(json.length, 0x4e4f534a), // JSON
  json,
  chunkHeader(binPadded.length, 0x004e4942), // BIN
  binPadded,
]);
header.writeUInt32LE(12 + body.length, 8);

const out = path.join(__dirname, "animated-triangle.glb");
writeFileSync(out, Buffer.concat([header, body]));
console.log(`wrote ${out}`);
```

Run: `node e2e/fixtures/make-animated-glb.mjs`
Verify the GLB parses and has the animation:

```bash
node -e '
const fs=require("fs");
const b=fs.readFileSync("e2e/fixtures/animated-triangle.glb");
const json=JSON.parse(b.slice(20,20+b.readUInt32LE(12)).toString());
console.log(json.animations.map(a=>a.name));'
```
Expected: `[ 'spin' ]`

- [ ] **Step 2: Add selectors**

In `e2e/helpers/studio-selectors.mjs`, next to `scaleSectionSummary` (line 75), add:

```js
  animationsSection: "#animationsSection",
  animationSelect: "#animationSelect",
```

- [ ] **Step 3: Write the spec**

Create `e2e/specs/19-animation-preview.spec.js`:

```js
/**
 * Animation preview: an uploaded GLB containing a glTF animation shows the
 * inspector "Animations" section; picking the clip selects it in the
 * dropdown, "None" resets. (Playback wiring is unit-tested in
 * test/frontend/animation-preview.test.js.)
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  connectLibrary,
  uploadLibraryFile,
  openLibraryAssetInStudio,
} from "../helpers/flows.mjs";

const GLB_FIXTURE = path.resolve("e2e/fixtures/animated-triangle.glb");
const ASSET_NAME = "animated-triangle";

test("inspector lists model animations and previews the selected clip", async ({
  page,
}) => {
  await connectLibrary(page);
  await uploadLibraryFile(page, GLB_FIXTURE, ASSET_NAME);
  await openLibraryAssetInStudio(page, ASSET_NAME);

  await page.click(SELECTORS.outlinerSwitcherBtn);
  await page.locator(SELECTORS.outlinerNode).first().click();

  const section = page.locator(SELECTORS.animationsSection);
  await expect(section).toBeVisible();

  const select = page.locator(SELECTORS.animationSelect);
  await expect(select.locator("option")).toHaveText(["None", "spin"]);

  await select.selectOption("0");
  await expect(select).toHaveValue("0");

  await select.selectOption("");
  await expect(select).toHaveValue("");
});
```

- [ ] **Step 4: Run the spec**

Bring infra up first if not running: `./scripts/start-dev.sh --setup-only`

Run: `npm run test:e2e -- --project=chromium e2e/specs/19-animation-preview.spec.js`
Expected: PASS. If the outliner node click doesn't open the inspector section, check whether the spec needs `openInspector(page)` from `flows.mjs` (used by comments specs) and adjust.

- [ ] **Step 5: Commit** (after user confirmation)

```bash
git add e2e/fixtures/make-animated-glb.mjs e2e/fixtures/animated-triangle.glb e2e/helpers/studio-selectors.mjs e2e/specs/19-animation-preview.spec.js
git commit -m "test(e2e): animation preview spec + animated GLB fixture"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + lint + unit**

Run: `npm run typecheck:frontend && npm run lint && npm run test:frontend`
Expected: all green. Note `npm run test:frontend` includes the deployment-integrity suite — it validates the built frontend, so `npm run build:frontend` (Task 3 Step 4) must have run first.

- [ ] **Step 2: E2E critical path**

Run: `npm run test:e2e -- --project=chromium`
Expected: 19 specs pass (AGENTS.md §10 requires E2E for Studio UI changes). If the full run is too slow, at minimum: `19-animation-preview`, `04-parametric-version` (inspector regressions), `17-undo-redo` (outliner selection path).

- [ ] **Step 3: Manual smoke (optional but recommended)**

`./scripts/start-dev.sh`, open Studio, generate or upload the animated fixture, select the node, pick "spin" in Properties → Animations, confirm the model rotates and "None" stops it.

---

## Self-Review Notes

- Spec coverage: capture (Task 1), no-autoplay (Task 2), inspector UI + controller (Task 3), E2E sync (Task 4), verification (Task 5). Chat-preview bubbles intentionally untouched (spec: out of scope).
- Type consistency: `nodeAnimationGroups` name used identically in state, loader, cleanup, controller, and tests. Select values are group **indices as strings** everywhere (`"0"`, not names) — the E2E spec and unit tests match the controller.
- `attachMetadata`'s new 5th parameter defaults to `[]`, so its other callers (none outside `loadAsset`) are unaffected.
