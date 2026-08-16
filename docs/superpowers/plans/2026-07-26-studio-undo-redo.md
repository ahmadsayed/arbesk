# Studio Undo/Redo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unified undo/redo to Arbesk Studio for transform edits (gizmo move/rotate/scale, single + group, inspector scale fields) and parametric color edits, behind Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y and toolbar buttons.

**Architecture:** In-memory snapshot (memento) stack (`engine/undo-stack.ts`) + an applier/dispatcher module (`engine/undo-controller.ts`). Capture sites push one entry per completed gesture; the existing color-only stack in `parametric-preview.js` is folded into the shared stack. Stacks survive Save, clear on `SCENE_CLEARED` (scene load + time-travel jumps). Spec: `docs/superpowers/specs/2026-07-26-studio-undo-redo-design.md`.

**Tech Stack:** ESM JS, Babylon.js (CDN global `BABYLON` — never import), Jest (jsdom for DOM tests), Playwright E2E. Conventions: `// @ts-nocheck` at top of engine/ui JS files (matches neighbors), camelCase functions, UPPER_SNAKE module constants, `[TAG]` log prefixes.

**Entry shape (shared contract across all tasks):**

```js
/**
 * @typedef {Object} UndoItem
 * @property {string} nodeId
 * @property {string} [meshName] - color entries only
 * @property {*} before - transform: number[16] column-major matrix; color: hex string
 * @property {*} after
 *
 * @typedef {Object} UndoEntry
 * @property {'transform'|'color'} type
 * @property {string} label - "Move" | "Rotate" | "Scale" | "Color" (tooltips/logs)
 * @property {UndoItem[]} items
 */
```

---

### Task 1: `engine/undo-stack.ts` — pure stack module

**Files:**
- Create: `frontend/src/js/engine/undo-stack.ts`
- Test: `test/frontend/undo-stack.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/frontend/undo-stack.test.js`:

```js
import { describe, test, expect, beforeEach } from "@jest/globals";
import {
  pushUndoEntry,
  popUndoEntry,
  popRedoEntry,
  canUndo,
  canRedo,
  peekUndoLabel,
  peekRedoLabel,
  clearUndoStacks,
  onUndoStackChange,
} from "../../frontend/src/js/engine/undo-stack.ts";

const entry = (label) => ({
  type: "transform",
  label,
  items: [{ nodeId: "n1", before: [0], after: [1] }],
});

beforeEach(() => clearUndoStacks());

describe("undo-stack", () => {
  test("push enables undo, not redo; labels peek correctly", () => {
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
    pushUndoEntry(entry("Move"));
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);
    expect(peekUndoLabel()).toBe("Move");
    expect(peekRedoLabel()).toBe(null);
  });

  test("popUndoEntry moves entry to redo stack; popRedoEntry moves it back", () => {
    pushUndoEntry(entry("Move"));
    const e1 = popUndoEntry();
    expect(e1.label).toBe("Move");
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);
    expect(peekRedoLabel()).toBe("Move");
    const e2 = popRedoEntry();
    expect(e2.label).toBe("Move");
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);
  });

  test("pops on empty stacks return null", () => {
    expect(popUndoEntry()).toBe(null);
    expect(popRedoEntry()).toBe(null);
  });

  test("new push clears the redo stack", () => {
    pushUndoEntry(entry("Move"));
    popUndoEntry();
    pushUndoEntry(entry("Rotate"));
    expect(canRedo()).toBe(false);
    expect(peekUndoLabel()).toBe("Rotate");
  });

  test("stack is capped at 50 entries (oldest dropped)", () => {
    for (let i = 0; i < 55; i++) pushUndoEntry(entry(`E${i}`));
    const labels = [];
    let e;
    while ((e = popUndoEntry())) labels.push(e.label);
    expect(labels.length).toBe(50);
    expect(labels.at(-1)).toBe("E5"); // oldest surviving entry
  });

  test("push ignores entries without items", () => {
    pushUndoEntry({ type: "transform", label: "X", items: [] });
    pushUndoEntry(null);
    expect(canUndo()).toBe(false);
  });

  test("clearUndoStacks empties both stacks", () => {
    pushUndoEntry(entry("Move"));
    popUndoEntry();
    pushUndoEntry(entry("Rotate"));
    clearUndoStacks();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });

  test("onUndoStackChange fires on push/pop/clear and unsubscribes", () => {
    let calls = 0;
    const off = onUndoStackChange(() => calls++);
    pushUndoEntry(entry("Move")); // 1
    popUndoEntry(); // 2
    popRedoEntry(); // 3
    clearUndoStacks(); // 4
    expect(calls).toBe(4);
    off();
    pushUndoEntry(entry("Scale"));
    expect(calls).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/frontend/undo-stack.test.js`
Expected: FAIL — module `undo-stack.js` does not exist.

- [ ] **Step 3: Implement `frontend/src/js/engine/undo-stack.ts`**

```js
// @ts-nocheck
/**
 * Arbesk Undo Stack
 *
 * Headless, scene-agnostic undo/redo stacks shared by every Studio edit type
 * (transforms, parametric colors). Capture sites push one snapshot entry per
 * completed gesture; engine/undo-controller.ts pops entries and applies them.
 * In-memory only — survives Save Draft/Publish, cleared on scene reload.
 */

/**
 * @typedef {Object} UndoItem
 * @property {string} nodeId
 * @property {string} [meshName] - color entries only
 * @property {*} before - transform: number[16] column-major matrix; color: hex string
 * @property {*} after
 *
 * @typedef {Object} UndoEntry
 * @property {'transform'|'color'} type
 * @property {string} label - human label for tooltips/logs ("Move", "Rotate", "Scale", "Color")
 * @property {UndoItem[]} items
 */

const MAX_UNDO = 50;

/** @type {UndoEntry[]} */
const undoStack = [];
/** @type {UndoEntry[]} */
const redoStack = [];
/** @type {Set<() => void>} */
const listeners = new Set();

function _notify() {
  for (const cb of listeners) cb();
}

/**
 * Push a completed edit. Clears the redo stack (standard invalidation).
 * @param {UndoEntry} entry
 */
export function pushUndoEntry(entry) {
  if (!entry || !Array.isArray(entry.items) || entry.items.length === 0) return;
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  _notify();
}

/** @returns {UndoEntry|null} entry to apply with direction "before" */
export function popUndoEntry() {
  const entry = undoStack.pop();
  if (!entry) return null;
  redoStack.push(entry);
  _notify();
  return entry;
}

/** @returns {UndoEntry|null} entry to apply with direction "after" */
export function popRedoEntry() {
  const entry = redoStack.pop();
  if (!entry) return null;
  undoStack.push(entry);
  _notify();
  return entry;
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

/** @returns {string|null} */
export function peekUndoLabel() {
  return undoStack.at(-1)?.label ?? null;
}

/** @returns {string|null} */
export function peekRedoLabel() {
  return redoStack.at(-1)?.label ?? null;
}

export function clearUndoStacks() {
  if (undoStack.length === 0 && redoStack.length === 0) return;
  undoStack.length = 0;
  redoStack.length = 0;
  _notify();
}

/**
 * @param {() => void} cb called after every stack mutation
 * @returns {() => void} unsubscribe
 */
export function onUndoStackChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/frontend/undo-stack.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/engine/undo-stack.ts test/frontend/undo-stack.test.js
git commit -m "feat(studio): add shared undo/redo stack module"
```

---

### Task 2: `readNodeTransformMatrix()` in `engine/transforms.ts`

**Files:**
- Modify: `frontend/src/js/engine/transforms.ts:58-71` (`stageNodeTransform`)
- Test: `test/frontend/transforms.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/frontend/transforms.test.js`:

```js
/**
 * @jest-environment jsdom
 */
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { state } from "../../frontend/src/js/engine/state.ts";
import {
  readNodeTransformMatrix,
  stageNodeTransform,
} from "../../frontend/src/js/engine/transforms.ts";

const FAKE_MATRIX = { m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1] };

beforeEach(() => {
  global.BABYLON = {
    Quaternion: class {
      static Identity() {
        return new global.BABYLON.Quaternion();
      }
    },
    Matrix: { Compose: () => FAKE_MATRIX },
  };
  state.nodeAnchors = new Map();
  state.pendingTransformEdits = new Map();
});

afterEach(() => {
  delete global.BABYLON;
});

describe("readNodeTransformMatrix", () => {
  test("returns the 16-element column-major matrix for a live anchor", () => {
    state.nodeAnchors.set("n1", {
      scaling: {},
      rotationQuaternion: null,
      position: {},
      isDisposed: () => false,
    });
    expect(readNodeTransformMatrix("n1")).toEqual(FAKE_MATRIX.m);
  });

  test("returns null for missing or disposed anchors", () => {
    expect(readNodeTransformMatrix("nope")).toBe(null);
    state.nodeAnchors.set("n2", { isDisposed: () => true });
    expect(readNodeTransformMatrix("n2")).toBe(null);
  });
});

describe("stageNodeTransform", () => {
  test("stages the read matrix into pendingTransformEdits", () => {
    state.nodeAnchors.set("n1", {
      scaling: {},
      rotationQuaternion: null,
      position: {},
      isDisposed: () => false,
    });
    expect(stageNodeTransform("n1")).toBe(true);
    expect(state.pendingTransformEdits.get("n1")).toEqual(FAKE_MATRIX.m);
  });

  test("returns false for a missing anchor", () => {
    expect(stageNodeTransform("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/frontend/transforms.test.js`
Expected: FAIL — `readNodeTransformMatrix` is not exported.

- [ ] **Step 3: Refactor `stageNodeTransform` in `frontend/src/js/engine/transforms.ts`**

Replace the existing `stageNodeTransform` (lines 48–71) with:

```js
/**
 * Read the current local transform of one node anchor as a 16-element
 * column-major matrix — the same shape as the manifest `transform_matrix`
 * consumed by `applyTransformMatrix()`. Used by `stageNodeTransform()` and by
 * undo capture sites that snapshot a node's TRS before/after a gesture.
 *
 * Returns null when the anchor is missing or disposed.
 */
export function readNodeTransformMatrix(nodeId) {
  const anchor = state.nodeAnchors.get(nodeId);
  if (!anchor || anchor.isDisposed()) return null;

  const rotation =
    anchor.rotationQuaternion || BABYLON.Quaternion.Identity();
  const matrix = BABYLON.Matrix.Compose(
    anchor.scaling,
    rotation,
    anchor.position
  );
  return Array.from(matrix.m);
}

/**
 * Read the current local transform of one node anchor and stage it for
 * persistence in the manifest (`transform_matrix`). Shared by the viewport
 * gizmo (drag end) and the inspector scale fields.
 *
 * Returns true when a transform was staged.
 */
export function stageNodeTransform(nodeId) {
  const matrix = readNodeTransformMatrix(nodeId);
  if (!matrix) return false;
  state.pendingTransformEdits.set(nodeId, matrix);
  return true;
}
```

(Behavior is identical to the old implementation — this only extracts the reader.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/frontend/transforms.test.js test/frontend/transform-gizmo.test.js test/frontend/transform-gizmo-group.test.js`
Expected: PASS — new tests pass, existing gizmo suites unaffected.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/engine/transforms.ts test/frontend/transforms.test.js
git commit -m "refactor(studio): extract readNodeTransformMatrix from stageNodeTransform"
```

---

### Task 3: `engine/undo-controller.ts` — applier + keyboard dispatcher

**Files:**
- Create: `frontend/src/js/engine/undo-controller.ts`
- Test: `test/frontend/undo-controller.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/frontend/undo-controller.test.js`:

```js
/**
 * @jest-environment jsdom
 */
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { state } from "../../frontend/src/js/engine/state.ts";
import { emit, on, EVENTS } from "../../frontend/src/js/events/bus.ts";
import {
  pushUndoEntry,
  clearUndoStacks,
  canUndo,
  canRedo,
} from "../../frontend/src/js/engine/undo-stack.ts";
import {
  undo,
  redo,
  registerUndoApplier,
} from "../../frontend/src/js/engine/undo-controller.ts";

// 16-element matrices; translation lives at indices 12-14 (column-major).
const BEFORE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1];
const AFTER = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 9, 0, 0, 1];

function makeAnchor() {
  return {
    scaling: {},
    rotationQuaternion: null,
    position: {},
    isDisposed: () => false,
  };
}

const transformEntry = (nodeId = "n1") => ({
  type: "transform",
  label: "Move",
  items: [{ nodeId, before: BEFORE, after: AFTER }],
});

beforeEach(() => {
  global.BABYLON = {
    Vector3: class {},
    Quaternion: class {
      static Identity() {
        return new global.BABYLON.Quaternion();
      }
    },
    Matrix: {
      Compose: () => ({ m: [...AFTER] }),
      FromValues: (...v) => ({
        decompose: (s, r, t) => {
          t.x = v[12];
          t.y = v[13];
          t.z = v[14];
          return true;
        },
      }),
    },
  };
  state.nodeAnchors = new Map();
  state.pendingTransformEdits = new Map();
  state.isGizmoDragging = false;
  clearUndoStacks();
});

afterEach(() => {
  delete global.BABYLON;
});

describe("undo-controller transform apply", () => {
  test("undo restores the before matrix and stages it for Save", () => {
    const anchor = makeAnchor();
    state.nodeAnchors.set("n1", anchor);
    pushUndoEntry(transformEntry());

    undo();
    expect(anchor.position.x).toBe(1); // BEFORE translation
    expect(state.pendingTransformEdits.get("n1")).toEqual([...AFTER]); // Compose mock
    expect(canRedo()).toBe(true);
  });

  test("redo re-applies the after matrix", () => {
    const anchor = makeAnchor();
    state.nodeAnchors.set("n1", anchor);
    pushUndoEntry(transformEntry());
    undo();
    redo();
    expect(anchor.position.x).toBe(9); // AFTER translation
    expect(canUndo()).toBe(true);
  });

  test("undo emits TRANSFORM_STAGED with the entry node ids", () => {
    state.nodeAnchors.set("n1", makeAnchor());
    pushUndoEntry(transformEntry());
    let staged = null;
    const off = on(EVENTS.TRANSFORM_STAGED, (e) => (staged = e));
    undo();
    off();
    expect(staged).toEqual({ nodeIds: ["n1"] });
  });

  test("undo/redo are no-ops on empty stacks", () => {
    expect(() => {
      undo();
      redo();
    }).not.toThrow();
  });

  test("undo/redo are ignored while a gizmo drag is active", () => {
    const anchor = makeAnchor();
    state.nodeAnchors.set("n1", anchor);
    pushUndoEntry(transformEntry());
    state.isGizmoDragging = true;
    undo();
    expect(canUndo()).toBe(true); // entry not consumed
    expect(anchor.position.x).toBeUndefined();
  });

  test("missing anchors are skipped without throwing", () => {
    pushUndoEntry({
      type: "transform",
      label: "Move",
      items: [
        { nodeId: "gone", before: BEFORE, after: AFTER },
        { nodeId: "n1", before: BEFORE, after: AFTER },
      ],
    });
    const anchor = makeAnchor();
    state.nodeAnchors.set("n1", anchor);
    expect(() => undo()).not.toThrow();
    expect(anchor.position.x).toBe(1);
  });
});

describe("undo-controller registered appliers", () => {
  test("custom type applier receives each item with direction", () => {
    const calls = [];
    registerUndoApplier("color", (item, direction) =>
      calls.push([item.nodeId, direction])
    );
    pushUndoEntry({
      type: "color",
      label: "Color",
      items: [{ nodeId: "n1", meshName: "m", before: "#000000", after: "#ffffff" }],
    });
    undo();
    expect(calls).toEqual([["n1", "before"]]);
    redo();
    expect(calls).toEqual([
      ["n1", "before"],
      ["n1", "after"],
    ]);
  });
});

describe("undo-controller keyboard + lifecycle", () => {
  const press = (key, opts = {}) =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key, cancelable: true, ...opts })
    );

  test("Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo", () => {
    state.nodeAnchors.set("n1", makeAnchor());
    pushUndoEntry(transformEntry());
    press("z", { ctrlKey: true });
    expect(canRedo()).toBe(true);
    press("z", { ctrlKey: true, shiftKey: true });
    expect(canUndo()).toBe(true);
    press("z", { ctrlKey: true });
    press("y", { ctrlKey: true });
    expect(canRedo()).toBe(false);
  });

  test("shortcut is ignored when a text input is focused", () => {
    pushUndoEntry(transformEntry());
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    input.focus();
    press("z", { ctrlKey: true });
    expect(canUndo()).toBe(true); // not consumed
    input.remove();
  });

  test("shortcut works when a color input is focused", () => {
    pushUndoEntry(transformEntry());
    const input = document.createElement("input");
    input.type = "color";
    document.body.appendChild(input);
    input.focus();
    press("z", { ctrlKey: true });
    expect(canUndo()).toBe(false); // consumed
    clearUndoStacks();
    input.remove();
  });

  test("SCENE_CLEARED clears both stacks", () => {
    pushUndoEntry(transformEntry());
    popToRedo();
    pushUndoEntry(transformEntry());
    emit(EVENTS.SCENE_CLEARED, {});
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });
});

function popToRedo() {
  undo();
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/frontend/undo-controller.test.js`
Expected: FAIL — module `undo-controller.js` does not exist.

- [ ] **Step 3: Implement `frontend/src/js/engine/undo-controller.ts`**

```js
// @ts-nocheck
/**
 * Arbesk Undo Controller
 *
 * Applies undo/redo entries from undo-stack.js to the live scene and owns the
 * single Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y keyboard dispatcher. Transform entries
 * are applied natively; other entry types (color) register an applier via
 * registerUndoApplier(). Stacks survive Save Draft/Publish and are cleared on
 * SCENE_CLEARED (scene load and time-travel jumps), which rebuilds the scene
 * from a manifest and invalidates every in-memory snapshot.
 */

import { on, emit, EVENTS } from "../events/bus.js";
import { state } from "./state.js";
import { applyTransformMatrix, stageNodeTransform } from "./transforms.js";
import {
  popUndoEntry,
  popRedoEntry,
  canUndo,
  canRedo,
  peekUndoLabel,
  peekRedoLabel,
  clearUndoStacks,
  onUndoStackChange,
} from "./undo-stack.js";

/** @type {Map<string, (item: object, direction: 'before'|'after') => void>} */
const _appliers = new Map();

/**
 * Register the applier for one entry type. Called per item with the direction
 * being applied ("before" for undo, "after" for redo).
 *
 * @param {string} type - e.g. "transform", "color"
 * @param {(item: object, direction: 'before'|'after') => void} applier
 */
export function registerUndoApplier(type, applier) {
  _appliers.set(type, applier);
}

// Transform entries: restore the matrix on the live anchor and re-stage it so
// Save writes the undone/redone state. Missing/disposed anchors are skipped.
registerUndoApplier("transform", (item, direction) => {
  const anchor = state.nodeAnchors.get(item.nodeId);
  if (!anchor || anchor.isDisposed()) return;
  applyTransformMatrix(anchor, direction === "before" ? item.before : item.after);
  stageNodeTransform(item.nodeId);
});

function _applyEntry(entry, direction) {
  const applier = _appliers.get(entry.type);
  if (!applier) return;
  for (const item of entry.items) applier(item, direction);
  if (entry.type === "transform") {
    // Refresh listeners (inspector scale fields) from the restored anchors.
    emit(EVENTS.TRANSFORM_STAGED, {
      nodeIds: entry.items.map((i) => i.nodeId),
    });
  }
}

export function undo() {
  if (state.isGizmoDragging) return;
  const entry = popUndoEntry();
  if (!entry) return;
  _applyEntry(entry, "before");
  console.log(`[UNDO] ${entry.label}`);
}

export function redo() {
  if (state.isGizmoDragging) return;
  const entry = popRedoEntry();
  if (!entry) return;
  _applyEntry(entry, "after");
  console.log(`[REDO] ${entry.label}`);
}

// ── Toolbar button state (buttons live in ui/transform-gizmo.ts) ──
function _syncToolbarButtons() {
  const undoBtn = document.getElementById("undoBtn");
  if (undoBtn) {
    undoBtn.disabled = !canUndo();
    const label = peekUndoLabel();
    undoBtn.title = label ? `Undo ${label} (Ctrl+Z)` : "Nothing to undo";
  }
  const redoBtn = document.getElementById("redoBtn");
  if (redoBtn) {
    redoBtn.disabled = !canRedo();
    const label = peekRedoLabel();
    redoBtn.title = label ? `Redo ${label} (Ctrl+Shift+Z)` : "Nothing to redo";
  }
}
onUndoStackChange(_syncToolbarButtons);

// Scene reloads (open asset, time-travel via loadVersion -> clearScene)
// invalidate every snapshot.
on(EVENTS.SCENE_CLEARED, () => clearUndoStacks());

// Single Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y dispatcher.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key !== "z" && key !== "y") return;
  const el = /** @type {HTMLElement|null} */ (document.activeElement);
  const tag = el?.tagName?.toLowerCase();
  // Allow undo when a color input is focused; block for text fields.
  const isColorInput =
    tag === "input" && /** @type {HTMLInputElement} */ (el).type === "color";
  if (!isColorInput) {
    const editing =
      el?.isContentEditable ||
      tag === "textarea" ||
      tag === "select" ||
      tag === "input";
    if (editing) return;
  }
  e.preventDefault();
  if ((key === "z" && e.shiftKey) || key === "y") redo();
  else undo();
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/frontend/undo-controller.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/engine/undo-controller.ts test/frontend/undo-controller.test.js
git commit -m "feat(studio): add undo controller with keyboard dispatcher"
```

---

### Task 4: Gizmo capture + toolbar buttons in `ui/transform-gizmo.ts`

**Files:**
- Modify: `frontend/src/js/ui/transform-gizmo.ts` (imports :11-13, ICONS :17-26, `createToolbar` :239-274, `captureSelectedTransform` :89-98, `ensureDragEndSubscription` :380-399)
- Test: `test/frontend/undo-gizmo-capture.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/frontend/undo-gizmo-capture.test.js`:

```js
/**
 * @jest-environment jsdom
 */
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { state } from "../../frontend/src/js/engine/state.ts";
import { emit, EVENTS } from "../../frontend/src/js/events/bus.ts";
import {
  clearUndoStacks,
  canUndo,
  canRedo,
  peekUndoLabel,
  popUndoEntry,
} from "../../frontend/src/js/engine/undo-stack.ts";
import { initTransformGizmo } from "../../frontend/src/js/ui/transform-gizmo.ts";

// Observable stub that stores callbacks so tests can fire them.
const observable = () => {
  const cbs = [];
  return { add: (cb) => cbs.push(cb), fire: () => cbs.forEach((cb) => cb()) };
};

let positionGizmo;
let dragMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

beforeEach(() => {
  positionGizmo = {
    onDragStartObservable: observable(),
    onDragEndObservable: observable(),
  };
  global.BABYLON = {
    GizmoManager: class {
      constructor() {
        this.positionGizmoEnabled = false;
        this.rotationGizmoEnabled = false;
        this.scaleGizmoEnabled = false;
        this.usePointerToAttachGizmos = false;
        this.clearGizmoOnEmptyPointerEvent = false;
        this.gizmos = {
          positionGizmo,
          rotationGizmo: null,
          scaleGizmo: null,
        };
      }
      attachToNode() {}
    },
    TransformNode: class {
      constructor() {
        this.position = { copyFrom: () => {} };
        this.rotationQuaternion = { copyFrom: () => {} };
        this.scaling = { copyFromFloats: () => {} };
      }
      isDisposed() {
        return false;
      }
      computeWorldMatrix() {}
      dispose() {}
    },
    Vector3: class {
      static Zero() {
        const chain = { addInPlace: () => chain, scaleInPlace: () => chain };
        return chain;
      }
    },
    Quaternion: class {
      static Identity() {
        return {};
      }
    },
    Matrix: {
      Compose: () => ({ m: [...dragMatrix] }),
      FromValues: () => ({ decompose: () => true }),
    },
  };

  const viewport = document.createElement("div");
  viewport.id = "viewport";
  document.body.appendChild(viewport);

  state.gizmoManager = null;
  state.transformMode = null;
  state.highlightedNodeId = null;
  state.selectedNodeIds = new Set();
  state.nodeAnchors = new Map();
  state.pendingTransformEdits = new Map();
  state.isGizmoDragging = false;
  clearUndoStacks();

  initTransformGizmo({}, null);
  state.nodeAnchors.set("n1", {
    scaling: {},
    rotationQuaternion: null,
    position: {},
    isDisposed: () => false,
  });
  state.highlightedNodeId = "n1";
  emit(EVENTS.NODE_SELECTED, { nodeId: "n1", mesh: null });
});

afterEach(() => {
  document.getElementById("viewport")?.remove();
  delete global.BABYLON;
  clearUndoStacks();
});

describe("gizmo drag undo capture", () => {
  test("a drag that moves the node pushes one Move entry", () => {
    positionGizmo.onDragStartObservable.fire();
    dragMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, 0, 1]; // moved
    positionGizmo.onDragEndObservable.fire();

    expect(canUndo()).toBe(true);
    expect(peekUndoLabel()).toBe("Move");
    const entry = popUndoEntry();
    expect(entry.type).toBe("transform");
    expect(entry.items).toHaveLength(1);
    expect(entry.items[0].nodeId).toBe("n1");
    expect(entry.items[0].before[12]).toBe(0);
    expect(entry.items[0].after[12]).toBe(4);
    clearUndoStacks();
  });

  test("a click without movement pushes nothing", () => {
    positionGizmo.onDragStartObservable.fire();
    positionGizmo.onDragEndObservable.fire(); // same matrix
    expect(canUndo()).toBe(false);
  });

  test("toolbar has disabled undo/redo buttons that enable after a drag", () => {
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    positionGizmo.onDragStartObservable.fire();
    dragMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, 0, 1];
    positionGizmo.onDragEndObservable.fire();

    expect(undoBtn.disabled).toBe(false);
    expect(undoBtn.title).toContain("Move");
    expect(redoBtn.disabled).toBe(true);
  });

  test("toolbar undo button click consumes the entry", () => {
    positionGizmo.onDragStartObservable.fire();
    dragMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, 0, 1];
    positionGizmo.onDragEndObservable.fire();

    document.getElementById("undoBtn").click();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/frontend/undo-gizmo-capture.test.js`
Expected: FAIL — no `undoBtn` in toolbar, no entries pushed.

- [ ] **Step 3: Implement the changes in `frontend/src/js/ui/transform-gizmo.ts`**

**3a. Imports** — replace lines 11–13 with:

```js
import { on, emit, EVENTS } from "../events/bus.js";
import { state } from "../engine/state.js";
import {
  stageNodeTransform,
  readNodeTransformMatrix,
} from "../engine/transforms.js";
import { undo, redo } from "../engine/undo-controller.js";
import { pushUndoEntry } from "../engine/undo-stack.js";
```

**3b. ICONS** — add two entries to the `ICONS` object (after `time`):

```js
  undo:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>',
  redo:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>',
```

**3c. `createToolbar()`** — prepend undo/redo buttons to `toolbar.innerHTML` and handle their clicks:

```js
  toolbar.innerHTML = `
    <button id="undoBtn" class="btn btn-flat btn-sm" data-action="undo" aria-label="Undo" title="Nothing to undo" disabled>
      ${ICONS.undo}
    </button>
    <button id="redoBtn" class="btn btn-flat btn-sm" data-action="redo" aria-label="Redo" title="Nothing to redo" disabled>
      ${ICONS.redo}
    </button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="translate" aria-label="Move (T)" title="Move (T)">
      ${ICONS.translate}
    </button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="rotate" aria-label="Rotate (R)" title="Rotate (R)">
      ${ICONS.rotate}
    </button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="scale" aria-label="Scale (S)" title="Scale (S)">
      ${ICONS.scale}
    </button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="time" aria-label="Time (V)" title="Time (V)">
      ${ICONS.time}
    </button>
  `;

  viewport.appendChild(toolbar);

  toolbar.addEventListener("click", (e) => {
    const actionBtn = e.target.closest("[data-action]");
    if (actionBtn) {
      if (actionBtn.dataset.action === "undo") undo();
      else redo();
      return;
    }
    const btn = e.target.closest(".transform-tool");
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (!mode) return;
    setMode(mode);
  });
```

**3d. Selection helper + capture** — replace `captureSelectedTransform` (:89-98) with:

```js
/**
 * Node ids the gizmo acts on: the multi-selection when present, otherwise the
 * single highlighted node.
 */
function _selectedIds() {
  return state.selectedNodeIds.size > 0
    ? [...state.selectedNodeIds]
    : state.highlightedNodeId
      ? [state.highlightedNodeId]
      : [];
}

/**
 * Stage the transforms of every selected node (single or multi-selection)
 * and notify listeners (e.g. the inspector scale fields) so they can
 * refresh from the anchors.
 */
function captureSelectedTransform() {
  const ids = _selectedIds();
  for (const nodeId of ids) captureNodeTransform(nodeId);
  if (ids.length > 0) emit(EVENTS.TRANSFORM_STAGED, { nodeIds: ids });
}

// ── Undo capture ──
// Snapshot the selected anchors' matrices at drag start; at drag end push one
// undo entry per drag gesture covering every node that actually moved.

const _MODE_LABELS = { translate: "Move", rotate: "Rotate", scale: "Scale" };

/** @type {Array<{nodeId: string, matrix: number[]}>|null} */
let _dragBefore = null;

function _snapshotSelectedMatrices() {
  const out = [];
  for (const nodeId of _selectedIds()) {
    const matrix = readNodeTransformMatrix(nodeId);
    if (matrix) out.push({ nodeId, matrix });
  }
  return out;
}

function _matricesEqual(a, b, eps = 1e-6) {
  for (let i = 0; i < 16; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return false;
  }
  return true;
}

function _pushDragUndoEntry() {
  const before = _dragBefore;
  _dragBefore = null;
  if (!before || before.length === 0) return;
  const items = [];
  for (const { nodeId, matrix } of before) {
    const after = readNodeTransformMatrix(nodeId);
    if (after && !_matricesEqual(matrix, after)) {
      items.push({ nodeId, before: matrix, after });
    }
  }
  if (items.length === 0) return; // click without drag
  pushUndoEntry({
    type: "transform",
    label: _MODE_LABELS[state.transformMode] || "Transform",
    items,
  });
}
```

**3e. `ensureDragEndSubscription()`** — hook the snapshots into the existing observables:

```js
  if (gizmo.onDragStartObservable) {
    gizmo.onDragStartObservable.add(() => {
      state.isGizmoDragging = true;
      _dragBefore = _snapshotSelectedMatrices();
      if (state.selectedNodeIds.size > 1) _startGroupDrag();
    });
    subscribed = true;
  }
  if (gizmo.onDragEndObservable) {
    gizmo.onDragEndObservable.add(() => {
      state.isGizmoDragging = false;
      _endGroupDrag();
      captureSelectedTransform();
      _pushDragUndoEntry();
    });
    subscribed = true;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/frontend/undo-gizmo-capture.test.js test/frontend/transform-gizmo.test.js test/frontend/transform-gizmo-group.test.js test/frontend/multi-select.test.js`
Expected: PASS — new tests pass and existing gizmo/selection suites are unaffected.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/transform-gizmo.ts test/frontend/undo-gizmo-capture.test.js
git commit -m "feat(studio): capture gizmo drags into undo stack + toolbar buttons"
```

---

### Task 5: Migrate `engine/parametric-preview.ts` to the shared stack

**Files:**
- Modify: `frontend/src/js/engine/parametric-preview.ts` (imports :13-24, UndoEntry typedef :58-60, undo/redo section :73-135, `_applyUniformScale` :199-208, `_clearUndoRedo()` call sites :319/:340/:393, picker change listener :587-601, keydown handler :604-623)

No new test file — the moved logic is covered by E2E (Task 7) and the existing inspector suites must keep passing.

- [ ] **Step 1: Update imports (lines 13–24)**

```js
import { emit, on, EVENTS } from "../events/bus.js";
import { applyColor } from "./time-travel.js";
import { stageNodeTransform, readNodeTransformMatrix } from "./transforms.js";
import { pushUndoEntry } from "./undo-stack.js";
import { registerUndoApplier } from "./undo-controller.js";
import {
  getNodeMeshes,
  getNodeSubMeshes,
  getNodeChildRef,
  deselectAll,
  selectNodeById,
  selectSubMesh,
  state,
} from "./scene-graph.js";
```

- [ ] **Step 2: Replace the private undo/redo section (lines 58–135)**

Delete the `UndoEntry` typedef (:58-60) and the entire `// ── Undo / Redo ──` block (:73-135: `undoStack`, `redoStack`, `MAX_UNDO`, `_pushUndo`, `_clearUndoRedo`, `_applyUndoEntry`, `undoColorEdit`, `redoColorEdit`). Replace with:

```js
// ── Undo / Redo ──────────────────────────────────────────────────────────────
// Color and inspector-scale edits push snapshot entries into the shared scene
// undo stack (engine/undo-stack.ts); engine/undo-controller.ts applies them
// through the applier registered below and owns the Ctrl+Z dispatcher.

/** @type {string|null} */
let _colorBeforeEdit = null;

// Applies one color entry item from the shared undo stack: restores the mesh
// color, syncs the inspector UI when it shows this node/mesh, and keeps
// pendingSourceColorEdits aligned so Save writes the undone/redone color.
registerUndoApplier("color", (item, direction) => {
  const color = direction === "before" ? item.before : item.after;
  const meshes = getNodeMeshes(item.nodeId);
  if (meshes) applyColor(meshes, null, { [item.meshName]: { color } });

  if (activeNodeId === item.nodeId && activeMeshName === item.meshName) {
    if (selectedComponentColor) selectedComponentColor.value = color;
    if (selectedComponentSwatch)
      selectedComponentSwatch.style.backgroundColor = color;
  }

  let nodeEdits = pendingSourceColorEdits.get(item.nodeId);
  if (!nodeEdits) {
    nodeEdits = new Map();
    pendingSourceColorEdits.set(item.nodeId, nodeEdits);
  }
  nodeEdits.set(item.meshName, color);
});
```

- [ ] **Step 3: Remove the three `_clearUndoRedo()` call sites**

Delete the `_clearUndoRedo();` lines in `showMultiSelectSummary` (:319), `openInspector` (:340), and `closeInspector` (:393). Selection changes must NOT wipe the shared undo history — entries apply to scene nodes regardless of what the inspector shows.

- [ ] **Step 4: Push inspector scale edits into the stack**

Replace `_applyUniformScale` (:199-208) with:

```js
function _applyUniformScale(factor) {
  const anchor = _getLiveAnchor(activeNodeId);
  if (!anchor || !Number.isFinite(factor) || factor < MIN_SCALE) {
    _refreshScaleFields();
    return;
  }
  const before = activeNodeId ? readNodeTransformMatrix(activeNodeId) : null;
  anchor.scaling.setAll(factor);
  if (activeNodeId) {
    stageNodeTransform(activeNodeId);
    const after = readNodeTransformMatrix(activeNodeId);
    if (before && after) {
      pushUndoEntry({
        type: "transform",
        label: "Scale",
        items: [{ nodeId: activeNodeId, before, after }],
      });
    }
  }
  _refreshScaleFields();
}
```

- [ ] **Step 5: Migrate the color-picker push (lines 587–601)**

Replace the `_pushUndo({...})` call inside the `change` listener with:

```js
    if (_colorBeforeEdit && _colorBeforeEdit !== newColor) {
      pushUndoEntry({
        type: "color",
        label: "Color",
        items: [
          {
            nodeId: activeNodeId,
            meshName: activeMeshName,
            before: _colorBeforeEdit,
            after: newColor,
          },
        ],
      });
    }
```

- [ ] **Step 6: Delete the color-only keydown handler (lines 604–623)**

Remove the entire `// Ctrl+Z / Ctrl+Shift+Z — undo/redo color edits` block. The dispatcher in `undo-controller.js` is now the single handler (loaded app-wide in Task 6).

- [ ] **Step 7: Run the inspector-related suites**

Run: `npx jest test/frontend/source-color-editor.test.js test/frontend/material-editor.test.js test/frontend/asset-save-core.test.js test/frontend/manifest-builder.test.js`
Expected: PASS. (No suite references the removed `undoColorEdit`/`redoColorEdit` exports — verified during planning.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/js/engine/parametric-preview.ts
git commit -m "refactor(studio): fold color/inspector-scale edits into shared undo stack"
```

---

### Task 6: Load the controller app-wide + keyboard help

**Files:**
- Modify: `frontend/src/js/app-init.ts:42`
- Modify: `frontend/src/js/ui/keyboard-help.ts:26-30`

- [ ] **Step 1: Import the controller in `app-init.ts`**

Add after line 42 (`import "./ui/keyboard-help.ts";`):

```js
import "./engine/undo-controller.ts";
```

(Side-effect import: registers the keydown dispatcher, the SCENE_CLEARED clear, and the toolbar sync.)

- [ ] **Step 2: Update `keyboard-help.js` Asset section**

Replace:

```js
      [`${MOD}+Z`, "Undo color edit"],
      [`${MOD}+Shift+Z`, "Redo color edit"],
```

with:

```js
      [`${MOD}+Z`, "Undo edit"],
      [`${MOD}+Shift+Z / ${MOD}+Y`, "Redo edit"],
```

- [ ] **Step 3: Rebuild the frontend and run integrity checks**

Run: `npm run build:frontend && npx jest test/frontend/deployment-integrity.test.js test/frontend/build.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/app-init.ts frontend/src/js/ui/keyboard-help.ts frontend/dist
git commit -m "feat(studio): load undo controller app-wide, update keyboard help"
```

(If `frontend/dist` is gitignored, stage only the two source files.)

---

### Task 7: E2E — selectors + spec

**Files:**
- Modify: `e2e/helpers/studio-selectors.mjs` (add 3 selectors near line 50)
- Create: `e2e/specs/17-undo-redo.spec.js`

- [ ] **Step 1: Add selectors to `e2e/helpers/studio-selectors.mjs`**

Add next to the existing `timeModeButton` entry:

```js
  undoButton: "#undoBtn",
  redoButton: "#redoBtn",
  scaleFactorInput: "#nodeScaleFactor",
```

- [ ] **Step 2: Write the spec `e2e/specs/17-undo-redo.spec.js`**

```js
import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { connectStudio, generate } from "../helpers/flows.mjs";

test.describe("undo/redo", () => {
  test("inspector scale edit undoes via Ctrl+Z and redoes via toolbar", async ({
    page,
  }) => {
    await connectStudio(page);
    await generate(page, "cowboy");

    // Select the first node in the Outliner → inspector opens with scale fields.
    await page.click(SELECTORS.outlinerSwitcherBtn);
    await page.locator(SELECTORS.outlinerNode).first().click();
    const scaleInput = page.locator(SELECTORS.scaleFactorInput);
    await expect(scaleInput).toBeVisible();
    const original = await scaleInput.inputValue();

    // Undo/redo start disabled.
    await expect(page.locator(SELECTORS.undoButton)).toBeDisabled();
    await expect(page.locator(SELECTORS.redoButton)).toBeDisabled();

    // Commit a scale edit through the inspector field (change event).
    await scaleInput.evaluate((el) => {
      el.value = "2";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(scaleInput).toHaveValue("2");
    await expect(page.locator(SELECTORS.undoButton)).toBeEnabled();

    // Ctrl+Z restores the original scale. Blur first: the shortcut is
    // intentionally blocked while a text input is focused.
    await scaleInput.evaluate((el) => el.blur());
    await page.keyboard.press("Control+z");
    await expect(scaleInput).toHaveValue(original);
    await expect(page.locator(SELECTORS.redoButton)).toBeEnabled();

    // Toolbar redo re-applies the edit.
    await page.locator(SELECTORS.redoButton).click();
    await expect(scaleInput).toHaveValue("2");
  });
});
```

- [ ] **Step 3: Run the E2E spec**

Requires the dev infra (per AGENTS.md: `./scripts/start-dev.sh --setup-only` first if not running). Then:

Run: `npm run test:e2e -- --project=chromium e2e/specs/17-undo-redo.spec.js`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/studio-selectors.mjs e2e/specs/17-undo-redo.spec.js
git commit -m "test(e2e): undo/redo spec + toolbar selectors"
```

---

### Task 8: Full verification

- [ ] **Step 1: Full Jest suite + lint + typecheck**

Run: `npm test && npm run lint && npm run typecheck && npm run typecheck:frontend`
Expected: all green (~1264 tests / 98 suites + new ones).

- [ ] **Step 2: E2E critical path**

Per AGENTS.md §10, UI changes require E2E before merge. Run:

Run: `npm run test:e2e -- --project=chromium`
Expected: PASS (all specs, including the new 17-undo-redo).

- [ ] **Step 3: Commit any stragglers**

```bash
git status  # should be clean; commit anything missed
```
