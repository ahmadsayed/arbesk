# View / Edit Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Arbesk Studio view-only by default, with an explicit Edit toggle that exposes floor-locked, snapped Move/Rotate placement, Drop to floor (G), Reset transform (Shift+R), no scale gizmo, and a visible "Unsaved changes" state.

**Architecture:** A tiny `state/edit-mode.ts` store owns `isEditing`/`canEdit`; `ui/transform-gizmo.ts` attaches the Babylon gizmo only while editing. Placement math is pure (`engine/placement.ts`), the Babylon adapter is `engine/placement-actions.ts`, and undo/staging for every transform change goes through one helper (`engine/transform-commit.ts`). Unsaved state is one query (`state/unsaved-changes.ts`) plus one bus event, rendered by `ui/asset-chrome.ts`.

**Tech Stack:** TypeScript (frontend, no bundler types for Babylon — `BABYLON` is a global `any`), Babylon.js 9.12 (CDN), Pug + SCSS, bun test (`// @test-env dom` = happy-dom), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-10-04-view-edit-mode-design.md` (decisions §3 are locked — do not reopen).

## Global Constraints

- Design authority: WCAG 2.2 AA → WAI-ARIA APG → Arbesk design language (GNOME HIG non-binding).
- Copy is sentence case. Header meta format: `v<N> · Draft|Published · Unsaved changes` (third segment only when dirty).
- Colours only via tokens (`var(--accent-bg)`, `var(--hairline)`, …) — `test/frontend/style-guards.test.js` and the theme leak guard enforce this.
- Keys: **E** toggle Edit · in Edit **T** Move, **R** Rotate, **G** Drop to floor, **Shift+R** Reset · **V** Time in both modes · **S** removed · grid has **no key**.
- Snap: move = `2 × groundGrid.scaling.x`; rotate = 15° (`Math.PI / 12`); **Alt** held = snapping off.
- Reset never changes scale. No scale gizmo anywhere.
- Unit tests: `bun scripts/run-tests.mjs <path>` (NOT bare `bun test` — the runner isolates mocks per file). Test files import `.ts` sources with a `.js` extension (e.g. `../../frontend/src/js/engine/state.js`).
- The fallow pre-commit gate blocks functions/files over CRAP/cyclomatic thresholds — prefer lookup tables and small helpers over branch chains.
- Unit baseline: the 17 pre-existing failing frontend files on `origin/main` (+ `test/library-grid.test.js`, `test/library-toolbar.test.js`). Regenerate with `bun run test:frontend 2>&1 | grep -E "^FAIL" | cut -d' ' -f2 | sort` on `origin/main` if unsure. No growth allowed.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work in `/home/ahmedh/Projects/arbesk/.worktrees/ui-theme-p1-1` on branch `feat/view-edit-mode`. Never checkout/pull in the main checkout. After E2E runs: `git checkout -- blockchain/deployments`.

## Deviations from the spec (decided while planning)

1. **Unsaved query lives in `state/unsaved-changes.ts`, not `engine/cleanup.ts`** — cleanup.ts pulls in the asset domain; a leaf module keeps the query testable and lets `parametric-preview.ts` (source-colour edits) and `annotations.ts` (metadata edits) register their own pending stores without import cycles. Those two stores ARE included in "unsaved" (the spec's "any pending edit").
2. **`beforeunload` prompts whenever dirty, including during an in-flight save** — pending collections are cleared only after a successful save, so closing mid-save would lose the edit. (Spec §7 said "no save in flight"; this is strictly safer and drops an `isSaving` dependency.)
3. **Drag end stages only nodes that actually moved** — today it stages every selected node, so a click without a drag would light the "Unsaved changes" marker.
4. **Edit/Done button has no `aria-pressed`;** its accessible name switches "Edit placement (E)" ↔ "Done editing (E)" so the visible label is always contained in the name (WCAG 2.5.3) and APG's "don't change the label of a toggle button" rule isn't violated.

## File map

| File | Status | Responsibility |
|------|--------|----------------|
| `frontend/src/js/engine/placement.ts` | create | Pure bounds/ground/reset/snap math |
| `frontend/src/js/state/unsaved-changes.ts` | create | `hasUnsavedChanges`, `registerPendingSource`, `notifyPendingEditsChanged`, `onBeforeUnload` |
| `frontend/src/js/state/edit-mode.ts` | create | `isEditing`, `setEditing`, `toggleEditing`, `canEdit`, `hasOpenAsset`, `subscribeEditMode` |
| `frontend/src/js/engine/group-pivot.ts` | create (extracted) | Multi-selection pivot (moved verbatim from transform-gizmo) |
| `frontend/src/js/engine/transform-commit.ts` | create | `selectedIds`, `snapshotMatrices`, `commitTransformChange` |
| `frontend/src/js/engine/placement-actions.ts` | create | Babylon adapter: `anchorsBounds`, `translateWorld`, `groundAnchors`, `resetAnchor` |
| `frontend/src/js/ui/transform-gizmo.ts` | modify | Modes, toolbar, keyboard, floor lock, snapping, G / Shift+R |
| `packages/asset-core/src/events/bus.ts` | modify | `PENDING_EDITS_CHANGED` |
| `frontend/src/js/engine/cleanup.ts`, `transforms.ts`, `child-remove.ts`, `scene-loader.ts`, `parametric-preview.ts`, `services/asset-save/annotations.ts` | modify | Call `notifyPendingEditsChanged()` at every pending write |
| `frontend/src/js/ui/asset-chrome.ts` | modify | Unsaved marker, `beforeunload`, uses `hasOpenAsset` |
| `frontend/src/js/engine/scene-graph.ts` | modify | Remove `G` → grid |
| `frontend/src/js/engine/state.ts` | modify | `TransformMode` drops `"scale"` |
| `frontend/src/pug/includes/studio-main.pug` | modify | `#scaleHint` id |
| `frontend/src/scss/components/_viewport.scss`, `_headerbar.scss` | modify | Toolbar separators/edit toggle; unsaved dot |
| `frontend/src/js/ui/keyboard-help.ts` | modify | New key rows |
| `e2e/helpers/studio-selectors.mjs`, `e2e/helpers/flows.mjs`, `e2e/specs/17-undo-redo.spec.js`, `e2e/specs/27-edit-mode.spec.js` | modify/create | E2E |
| `test/frontend/helpers/edit-mode.js` | create | `enterEditForTest()` for gizmo tests |

---

### Task 0: Base + spec corrections

**Files:**
- Modify: `docs/superpowers/specs/2026-10-04-view-edit-mode-design.md`

- [ ] **Step 1: Check the base**

```bash
cd /home/ahmedh/Projects/arbesk/.worktrees/ui-theme-p1-1
git fetch -q origin
gh pr view 109 --json state -q .state
```

If `MERGED`: `git rebase origin/main` (only the spec + plan commits are on this branch; resolve nothing else). If still `OPEN`: continue on the current base and rebase before the PR in Task 11. #109 touches `e2e/helpers/flows.mjs` / `studio-selectors.mjs` (scene-clock → timeline) — expect small conflicts there at rebase; keep both sides.

- [ ] **Step 2: Record the four planning deviations in the spec**

Append to the end of the spec:

```markdown
## 14. Amendments (from planning)

1. The unsaved query lives in `state/unsaved-changes.ts` (not `engine/cleanup.ts`); source-colour edits (`parametric-preview.ts`) and metadata annotations register as pending sources and count as unsaved.
2. `beforeunload` prompts whenever `hasUnsavedChanges()` is true, including during an in-flight save (pending state clears only after a successful save).
3. Gizmo drag end stages only nodes whose matrix changed, so a click without a drag never marks the asset dirty.
4. The Edit/Done button has no `aria-pressed`; its accessible name is "Edit placement (E)" / "Done editing (E)" (WCAG 2.5.3 label-in-name).
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-04-view-edit-mode-design.md
git commit -m "docs(spec): planning amendments for view / edit mode (#86)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Pure placement math

**Files:**
- Create: `frontend/src/js/engine/placement.ts`
- Test: `test/frontend/placement.test.js`

**Interfaces:**
- Produces:
  - `interface Vec3 { x: number; y: number; z: number }`
  - `interface Bounds { min: Vec3; max: Vec3 }`
  - `isValidBounds(b: Bounds | null | undefined): b is Bounds`
  - `boundsUnion(list: Array<Bounds | null>): Bounds | null`
  - `groundDelta(b: Bounds | null): number` — Y offset that puts min.y on 0; `0` for null/invalid or already within `GROUND_EPS`
  - `resetOffset(b: Bounds | null): Vec3` — world offset putting the bounds centre at X/Z 0 and min.y at 0; zero vector for null
  - `moveSnapStep(gridScale: number): number` — `2 * gridScale`, falling back to `2` for non-finite/≤0
  - `ROTATE_SNAP = Math.PI / 12`, `GROUND_EPS = 1e-6`

- [ ] **Step 1: Write the failing test**

`test/frontend/placement.test.js`:

```js
import { describe, expect, test } from "bun:test";
import {
  isValidBounds,
  boundsUnion,
  groundDelta,
  resetOffset,
  moveSnapStep,
  ROTATE_SNAP,
} from "../../frontend/src/js/engine/placement.js";

const box = (minX, minY, minZ, maxX, maxY, maxZ) => ({
  min: { x: minX, y: minY, z: minZ },
  max: { x: maxX, y: maxY, z: maxZ },
});
// What Babylon's getHierarchyBoundingVectors returns for a node with no meshes.
const EMPTY = box(
  Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE,
  -Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE
);

describe("placement math", () => {
  test("isValidBounds rejects null, empty and non-finite bounds", () => {
    expect(isValidBounds(null)).toBe(false);
    expect(isValidBounds(EMPTY)).toBe(false);
    expect(isValidBounds(box(0, NaN, 0, 1, 1, 1))).toBe(false);
    expect(isValidBounds(box(0, 0, 0, 1, 1, 1))).toBe(true);
  });

  test("boundsUnion merges valid boxes and skips invalid ones", () => {
    const u = boundsUnion([box(0, 2, 0, 1, 3, 1), null, EMPTY, box(-1, 5, 2, 0, 6, 4)]);
    expect(u).toEqual(box(-1, 2, 0, 1, 6, 4));
    expect(boundsUnion([null, EMPTY])).toBeNull();
  });

  test("groundDelta lifts or lowers min.y onto the floor", () => {
    expect(groundDelta(box(0, 5, 0, 1, 6, 1))).toBe(-5);
    expect(groundDelta(box(0, -2, 0, 1, 1, 1))).toBe(2);
    expect(groundDelta(box(0, 1e-9, 0, 1, 1, 1))).toBe(0);
    expect(groundDelta(null)).toBe(0);
    expect(groundDelta(EMPTY)).toBe(0);
  });

  test("a multi-selection grounds as one rigid group (stacking kept)", () => {
    // base on the floor at y 1..2, part stacked on it at y 2..3
    const group = boundsUnion([box(0, 1, 0, 1, 2, 1), box(0, 2, 0, 1, 3, 1)]);
    expect(groundDelta(group)).toBe(-1); // both move by the SAME delta
  });

  test("resetOffset centres X/Z on the origin and grounds", () => {
    expect(resetOffset(box(2, 3, -4, 4, 5, -2))).toEqual({ x: -3, y: -3, z: 3 });
    expect(resetOffset(null)).toEqual({ x: 0, y: 0, z: 0 });
  });

  test("move snap tracks the visible grid cell; rotate snap is 15°", () => {
    expect(moveSnapStep(1)).toBe(2);
    expect(moveSnapStep(2.5)).toBe(5);
    expect(moveSnapStep(0)).toBe(2);
    expect(moveSnapStep(NaN)).toBe(2);
    expect(ROTATE_SNAP).toBeCloseTo(Math.PI / 12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/placement.test.js`
Expected: FAIL — cannot resolve `placement.js`.

- [ ] **Step 3: Write the implementation**

`frontend/src/js/engine/placement.ts`:

```ts
/**
 * Pure placement math for View/Edit mode: selection bounds, floor grounding,
 * reset targets, and snap steps.
 * @remarks No Babylon or DOM access — engine/placement-actions.ts adapts live
 *   anchors to these plain shapes.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** Below this, a selection counts as already on the floor. */
export const GROUND_EPS = 1e-6;

/** Rotation gizmo snap: 15°. */
export const ROTATE_SNAP = Math.PI / 12;

/** World size of one ground-grid cell at grid scale 1 (40 units / 20 cells). */
const GRID_CELL = 2;

function _finite(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/**
 * True for a finite, non-inverted box.
 * @remarks Babylon reports a mesh-less hierarchy as min = +MAX, max = −MAX.
 */
export function isValidBounds(b: Bounds | null | undefined): b is Bounds {
  if (!b || !_finite(b.min) || !_finite(b.max)) return false;
  return b.min.x <= b.max.x && b.min.y <= b.max.y && b.min.z <= b.max.z;
}

/** Axis-aligned union of the valid boxes; null when none are valid. */
export function boundsUnion(list: Array<Bounds | null>): Bounds | null {
  const valid = list.filter(isValidBounds);
  if (valid.length === 0) return null;
  const min = { ...valid[0].min };
  const max = { ...valid[0].max };
  for (const b of valid.slice(1)) {
    min.x = Math.min(min.x, b.min.x);
    min.y = Math.min(min.y, b.min.y);
    min.z = Math.min(min.z, b.min.z);
    max.x = Math.max(max.x, b.max.x);
    max.y = Math.max(max.y, b.max.y);
    max.z = Math.max(max.z, b.max.z);
  }
  return { min, max };
}

/** World Y offset that rests the box's lowest point on Y = 0. */
export function groundDelta(b: Bounds | null): number {
  if (!isValidBounds(b)) return 0;
  return Math.abs(b.min.y) < GROUND_EPS ? 0 : -b.min.y;
}

/** World offset that centres the box on X/Z = 0 and grounds it. */
export function resetOffset(b: Bounds | null): Vec3 {
  if (!isValidBounds(b)) return { x: 0, y: 0, z: 0 };
  return {
    x: -(b.min.x + b.max.x) / 2,
    y: groundDelta(b),
    z: -(b.min.z + b.max.z) / 2,
  };
}

/** Move snap distance: one visible grid cell. */
export function moveSnapStep(gridScale: number): number {
  return Number.isFinite(gridScale) && gridScale > 0 ? GRID_CELL * gridScale : GRID_CELL;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun scripts/run-tests.mjs test/frontend/placement.test.js`
Expected: `Tests: 6 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/engine/placement.ts test/frontend/placement.test.js
git commit -m "feat(placement): pure grounding, reset and snap math (#86)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Unsaved-changes query + change signal

**Files:**
- Create: `frontend/src/js/state/unsaved-changes.ts`
- Modify: `packages/asset-core/src/events/bus.ts` (EVENTS map, alphabetical, after `OUTLINER_REMOVE_REQUESTED`)
- Modify: `frontend/src/js/engine/cleanup.ts:11-72` and `:260-264`
- Modify: `frontend/src/js/engine/transforms.ts:87-92`
- Modify: `frontend/src/js/engine/child-remove.ts` (`unlinkChildAssetNode`, `reinsertChildAssetNode`)
- Modify: `frontend/src/js/engine/scene-loader.ts:671`
- Modify: `frontend/src/js/engine/parametric-preview.ts:56-85`, `:425-447`
- Modify: `frontend/src/js/services/asset-save/annotations.ts`
- Test: `test/frontend/unsaved-changes.test.js`

**Interfaces:**
- Produces:
  - `EVENTS.PENDING_EDITS_CHANGED = "pending:editsChanged"`
  - `registerPendingSource(fn: () => boolean): () => void`
  - `hasUnsavedChanges(): boolean`
  - `notifyPendingEditsChanged(): void` — emits `EVENTS.PENDING_EDITS_CHANGED`
  - `onBeforeUnload(e: { preventDefault(): void; returnValue?: unknown }): void`

- [ ] **Step 1: Write the failing test**

`test/frontend/unsaved-changes.test.js`:

```js
import { beforeEach, describe, expect, jest, test } from "bun:test";
import { state } from "../../frontend/src/js/engine/state.js";
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import {
  hasUnsavedChanges,
  registerPendingSource,
  notifyPendingEditsChanged,
  onBeforeUnload,
} from "../../frontend/src/js/state/unsaved-changes.js";

beforeEach(() => {
  state.pendingTransformEdits = new Map();
  state.pendingChildRefs = [];
  state.pendingChildRefRemovals = new Set();
  state.pendingPostProcessorEdits = new Map();
  state.pendingSourceOverrides = new Map();
});

describe("hasUnsavedChanges", () => {
  test("false when every pending collection is empty", () => {
    expect(hasUnsavedChanges()).toBe(false);
  });

  test.each([
    ["transform", () => state.pendingTransformEdits.set("n", [1])],
    ["child ref", () => state.pendingChildRefs.push({ node_id: "c" })],
    ["child removal", () => state.pendingChildRefRemovals.add("c")],
    ["post-processor", () => state.pendingPostProcessorEdits.set("n", {})],
    ["source override", () => state.pendingSourceOverrides.set("n", {})],
  ])("true with a pending %s", (_label, stage) => {
    stage();
    expect(hasUnsavedChanges()).toBe(true);
  });

  test("registered sources count, and unregister removes them", () => {
    let dirty = true;
    const off = registerPendingSource(() => dirty);
    expect(hasUnsavedChanges()).toBe(true);
    dirty = false;
    expect(hasUnsavedChanges()).toBe(false);
    dirty = true;
    off();
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe("signals", () => {
  test("notifyPendingEditsChanged emits PENDING_EDITS_CHANGED", () => {
    expect(EVENTS.PENDING_EDITS_CHANGED).toBe("pending:editsChanged");
    const seen = jest.fn();
    const off = on(EVENTS.PENDING_EDITS_CHANGED, seen);
    notifyPendingEditsChanged();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  test("onBeforeUnload prompts only when dirty", () => {
    const clean = { preventDefault: jest.fn() };
    onBeforeUnload(clean);
    expect(clean.preventDefault).not.toHaveBeenCalled();

    state.pendingTransformEdits.set("n", [1]);
    const dirty = { preventDefault: jest.fn(), returnValue: undefined };
    onBeforeUnload(dirty);
    expect(dirty.preventDefault).toHaveBeenCalledTimes(1);
    expect(dirty.returnValue).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/unsaved-changes.test.js`
Expected: FAIL — cannot resolve `unsaved-changes.js`.

- [ ] **Step 3: Add the bus event**

In `packages/asset-core/src/events/bus.ts`, inside the `EVENTS` object right after `OUTLINER_REMOVE_REQUESTED`:

```ts
  PENDING_EDITS_CHANGED:      "pending:editsChanged",
```

- [ ] **Step 4: Create the module**

`frontend/src/js/state/unsaved-changes.ts`:

```ts
/**
 * Single answer to "does the open asset have edits that Save would write?".
 * @remarks Pessimistic by design: undo re-stages rather than unstages, so
 *   the answer only returns to false after Save draft / Publish or a scene
 *   reload. Modules that keep their own pending store (source colours,
 *   metadata annotations) register it with registerPendingSource.
 */
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { state } from "../engine/state.ts";

const _sources = new Set<() => boolean>();

/**
 * Adds a pending-edit store to the unsaved check.
 * @returns an unregister function.
 */
export function registerPendingSource(fn: () => boolean): () => void {
  _sources.add(fn);
  return () => {
    _sources.delete(fn);
  };
}

function _stateHasPending(): boolean {
  return (
    state.pendingTransformEdits.size > 0 ||
    state.pendingChildRefs.length > 0 ||
    state.pendingChildRefRemovals.size > 0 ||
    state.pendingPostProcessorEdits.size > 0 ||
    state.pendingSourceOverrides.size > 0
  );
}

export function hasUnsavedChanges(): boolean {
  if (_stateHasPending()) return true;
  for (const fn of _sources) if (fn()) return true;
  return false;
}

/** Call after any write to a pending-edit collection. */
export function notifyPendingEditsChanged(): void {
  emit(EVENTS.PENDING_EDITS_CHANGED);
}

/**
 * `beforeunload` handler: asks the browser to confirm leaving while edits
 * are unsaved (including mid-save — pending state clears only on success).
 */
export function onBeforeUnload(e: {
  preventDefault(): void;
  returnValue?: unknown;
}): void {
  if (!hasUnsavedChanges()) return;
  e.preventDefault();
  // Legacy browsers only show the prompt when returnValue is set.
  e.returnValue = "";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun scripts/run-tests.mjs test/frontend/unsaved-changes.test.js`
Expected: `Tests: 9 passed, 0 failed` (5 `test.each` cases + 4).

- [ ] **Step 6: Notify at every pending write**

Add `import { notifyPendingEditsChanged } from "../state/unsaved-changes.ts";` (adjust the relative path per file) and call it **after** the mutation in each of these:

`frontend/src/js/engine/cleanup.ts` — every one of these exported functions gets `notifyPendingEditsChanged();` as its last line: `clearPendingChildRefs`, `clearPendingChildRefRemovals`, `clearPendingPostProcessorEdits`, `clearPendingPostProcessorEdit`, `clearPendingTransformEdits`, `clearPendingTransformEdit`, `clearPendingSourceOverrides`, `stagePendingSourceOverride`, `clearPendingSourceOverride`. In `clearScene` (the block at `:260-264`), add it right after `state.pendingSourceOverrides.clear();`:

```ts
  state.pendingChildRefs.length = 0;
  state.pendingChildRefRemovals.clear();
  state.pendingPostProcessorEdits.clear();
  state.pendingTransformEdits.clear();
  state.pendingSourceOverrides.clear();
  notifyPendingEditsChanged();
```

`frontend/src/js/engine/transforms.ts` (`import ... from "../state/unsaved-changes.ts"`):

```ts
export function stageNodeTransform(nodeId: string): boolean {
  const matrix = readNodeTransformMatrix(nodeId);
  if (!matrix) return false;
  state.pendingTransformEdits.set(nodeId, matrix);
  notifyPendingEditsChanged();
  return true;
}
```

`frontend/src/js/engine/child-remove.ts` — in `unlinkChildAssetNode`, after `state.pendingChildRefs.splice(pIdx, 1);` and after `state.pendingChildRefRemovals.add(nodeId);` (one call each, before `disposeNodeSubtree`); in `reinsertChildAssetNode`, one call after the `if (fromPending) {…} else {…}` block (before `reloadChildAssetNode(node);`).

`frontend/src/js/engine/scene-loader.ts:671` — after `state.pendingChildRefs.push(nodeEntry);`.

`frontend/src/js/engine/parametric-preview.ts` (`import { notifyPendingEditsChanged, registerPendingSource } from "../state/unsaved-changes.ts";`):
- right after `const pendingSourceColorEdits = new Map();` add
  ```ts
  registerPendingSource(() => pendingSourceColorEdits.size > 0);
  ```
- in the colour undo applier (around `:81-84`) after the `nodeEdits.set(...)` that follows `pendingSourceColorEdits.set(item.nodeId, nodeEdits)`, add `notifyPendingEditsChanged();`
- in the live colour edit (around `:428-432`) after its `nodeEdits.set(...)`, add `notifyPendingEditsChanged();`
- `clearPendingSourceColorEdits` and `clearPendingSourceColorEdit`: add `notifyPendingEditsChanged();` as the last line.

`frontend/src/js/services/asset-save/annotations.ts`:

```ts
import {
  notifyPendingEditsChanged,
  registerPendingSource,
} from "../../state/unsaved-changes.ts";

let pending: Record<string, unknown> | null = null;
registerPendingSource(() => pending !== null);

export function getPendingAnnotations(): Record<string, unknown> | null {
  return pending;
}

export function setPendingAnnotations(a: Record<string, unknown> | null): void {
  pending = a;
  notifyPendingEditsChanged();
}

export function clearPendingAnnotations(): void {
  pending = null;
  notifyPendingEditsChanged();
}
```

Verify nothing was missed:

```bash
grep -rn "pendingTransformEdits\.\(set\|delete\|clear\)\|pendingChildRefs\.\(push\|splice\|length = 0\)\|pendingChildRefRemovals\.\(add\|delete\|clear\)\|pendingPostProcessorEdits\.\(set\|delete\|clear\)\|pendingSourceOverrides\.\(set\|delete\|clear\)\|pendingSourceColorEdits\.\(set\|delete\|clear\)" frontend/src/js --include=*.ts
```

Every hit must have a `notifyPendingEditsChanged()` within the same function after it.

- [ ] **Step 7: Run the touched suites**

Run: `bun scripts/run-tests.mjs test/frontend/unsaved-changes.test.js test/frontend/transforms.test.js test/frontend/child-remove.test.js test/frontend/parametric-preview.test.js test/frontend/metadata-editor.test.js test/frontend/undo-controller.test.js`
Expected: all pass (or same failures as the baseline for any file already in it).

- [ ] **Step 8: Commit**

```bash
git add packages/asset-core/src/events/bus.ts frontend/src/js/state/unsaved-changes.ts frontend/src/js/engine/cleanup.ts frontend/src/js/engine/transforms.ts frontend/src/js/engine/child-remove.ts frontend/src/js/engine/scene-loader.ts frontend/src/js/engine/parametric-preview.ts frontend/src/js/services/asset-save/annotations.ts test/frontend/unsaved-changes.test.js
git commit -m "feat(state): unsaved-changes query and PENDING_EDITS_CHANGED signal (#86)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Edit-mode store

**Files:**
- Create: `frontend/src/js/state/edit-mode.ts`
- Create: `test/frontend/helpers/edit-mode.js`
- Test: `test/frontend/edit-mode.test.js`

**Interfaces:**
- Consumes: `getAssetState`, `subscribeAsset` (`@arbesk/asset-core/domain/asset.js`); `walletState` (`state/wallet-state.ts`); `isLibraryVisitor` (`state/library-state.ts`); `getPendingChildRefs`, `getPendingSourceOverrides` (`engine/cleanup.ts`).
- Produces:
  - `hasOpenAsset(): boolean` — same rule asset-chrome uses today
  - `canEdit(): boolean` — `hasOpenAsset() && walletAddress && !isLibraryVisitor()`
  - `isEditing(): boolean`
  - `setEditing(next: boolean): boolean` — returns the resulting state; `true` is refused when `!canEdit()`
  - `toggleEditing(): boolean`
  - `subscribeEditMode(fn: () => void): () => void` — fired whenever editing OR can-edit may have changed
  - `_resetEditModeForTesting(): void`
  - test helper `enterEditForTest(): void` (synchronous; throws if can-edit is false)

- [ ] **Step 1: Write the failing test**

`test/frontend/edit-mode.test.js`:

```js
// @test-env dom
import { beforeEach, describe, expect, jest, test } from "bun:test";
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { setActiveManifestCid } from "@arbesk/asset-core/domain/asset.js";
import { _resetForTesting as resetAssets } from "@arbesk/asset-core/domain/asset-store.js";
import { walletState } from "../../frontend/src/js/state/wallet-state.js";
import { libraryState } from "../../frontend/src/js/state/library-state.js";
import {
  canEdit,
  hasOpenAsset,
  isEditing,
  setEditing,
  toggleEditing,
  subscribeEditMode,
  _resetEditModeForTesting,
} from "../../frontend/src/js/state/edit-mode.js";

const WALLET = "0x00000000000000000000000000000000000000a1";

function editable() {
  walletState.set({ walletAddress: WALLET });
  setActiveManifestCid("bafyAsset");
}

beforeEach(() => {
  resetAssets();
  walletState.set({ walletAddress: null });
  libraryState.set({ subjectAddress: null, subjectChainId: null });
  _resetEditModeForTesting();
});

describe("edit-mode store", () => {
  test("starts in View mode", () => {
    expect(isEditing()).toBe(false);
  });

  test("canEdit needs an open asset, a wallet, and owner (not visitor) view", () => {
    expect(canEdit()).toBe(false);
    setActiveManifestCid("bafyAsset");
    expect(hasOpenAsset()).toBe(true);
    expect(canEdit()).toBe(false); // no wallet
    walletState.set({ walletAddress: WALLET });
    expect(canEdit()).toBe(true);
    libraryState.set({ subjectAddress: "0x00000000000000000000000000000000000000b2" });
    expect(canEdit()).toBe(false); // visiting someone else's profile
  });

  test("setEditing(true) is refused when the user cannot save", () => {
    expect(setEditing(true)).toBe(false);
    expect(isEditing()).toBe(false);
    editable();
    expect(setEditing(true)).toBe(true);
    expect(toggleEditing()).toBe(false);
  });

  test("subscribers hear mode changes", () => {
    editable();
    const fn = jest.fn();
    const off = subscribeEditMode(fn);
    setEditing(true);
    expect(fn).toHaveBeenCalled();
    off();
  });

  test("losing the wallet exits Edit", () => {
    editable();
    setEditing(true);
    walletState.set({ walletAddress: null });
    emit(EVENTS.WALLET_STATE_CHANGED, walletState.get());
    expect(isEditing()).toBe(false);
  });

  test("a scene reload (asset or version change) resets to View", () => {
    editable();
    setEditing(true);
    emit(EVENTS.SCENE_CLEARED);
    expect(isEditing()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/edit-mode.test.js`
Expected: FAIL — cannot resolve `edit-mode.js`.

- [ ] **Step 3: Write the implementation**

`frontend/src/js/state/edit-mode.ts`:

```ts
/**
 * View/Edit mode store.
 * @remarks The Studio is view-only by default; placement tools appear only in
 *   Edit mode, which is offered only when the open asset can be saved (asset
 *   open, wallet connected, not visiting someone else's library). Leaving Edit
 *   keeps staged edits — the unsaved marker (ui/asset-chrome.ts) tracks them.
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getAssetState, subscribeAsset } from "@arbesk/asset-core/domain/asset.js";
import { walletState } from "./wallet-state.ts";
import { isLibraryVisitor } from "./library-state.ts";
import { getPendingChildRefs, getPendingSourceOverrides } from "../engine/cleanup.ts";

let _editing = false;
const _listeners = new Set<() => void>();

/** True when there is something open to view, save, or place. */
export function hasOpenAsset(): boolean {
  return !!(
    getAssetState().activeAssetManifestCid ||
    getPendingChildRefs().length > 0 ||
    getPendingSourceOverrides().size > 0
  );
}

export function canEdit(): boolean {
  return hasOpenAsset() && !!walletState.get().walletAddress && !isLibraryVisitor();
}

export function isEditing(): boolean {
  return _editing;
}

function _notify(): void {
  for (const fn of _listeners) fn();
}

/**
 * Enters or leaves Edit mode.
 * @returns the resulting mode (entering is refused when !canEdit()).
 */
export function setEditing(next: boolean): boolean {
  const value = next && canEdit();
  if (value !== _editing) {
    _editing = value;
    _notify();
  }
  return _editing;
}

export function toggleEditing(): boolean {
  return setEditing(!_editing);
}

/**
 * Subscribes to mode and can-edit changes.
 * @returns an unsubscribe function.
 */
export function subscribeEditMode(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

export function _resetEditModeForTesting(): void {
  _editing = false;
}

// Can-edit may have flipped: exit Edit if it is gone, and let subscribers
// re-render the Edit button's visibility either way.
function _recheck(): void {
  if (_editing && !canEdit()) _editing = false;
  _notify();
}

subscribeAsset(_recheck);
on(EVENTS.WALLET_STATE_CHANGED, _recheck);
on(EVENTS.WALLET_CONNECTED, _recheck);
on(EVENTS.WALLET_DISCONNECTED, _recheck);
on(EVENTS.LIBRARY_STATE_CHANGED, _recheck);
on(EVENTS.PENDING_EDITS_CHANGED, _recheck);
// Every asset open / version navigation / New goes through clearScene.
on(EVENTS.SCENE_CLEARED, () => setEditing(false));
```

`test/frontend/helpers/edit-mode.js` (the runner skips `helpers/`):

```js
/**
 * Puts the edit-mode store into Edit for gizmo unit tests by making the
 * real can-edit rule true (wallet + open asset).
 */
import { setActiveManifestCid } from "@arbesk/asset-core/domain/asset.js";
import { walletState } from "../../../frontend/src/js/state/wallet-state.js";
import { setEditing } from "../../../frontend/src/js/state/edit-mode.js";

export function enterEditForTest() {
  walletState.set({ walletAddress: "0x00000000000000000000000000000000000000a1" });
  setActiveManifestCid("bafyTestAsset");
  if (!setEditing(true)) throw new Error("enterEditForTest: canEdit() is false");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun scripts/run-tests.mjs test/frontend/edit-mode.test.js`
Expected: `Tests: 6 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/state/edit-mode.ts test/frontend/edit-mode.test.js test/frontend/helpers/edit-mode.js
git commit -m "feat(state): view/edit mode store with can-edit rule (#86)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Unsaved marker in the header chrome

**Files:**
- Modify: `frontend/src/js/ui/asset-chrome.ts`
- Modify: `frontend/src/scss/components/_headerbar.scss` (after `.headerbar-doc-actions`, ~line 300)
- Test: `test/frontend/asset-chrome.test.js`

**Interfaces:**
- Consumes: `hasUnsavedChanges`, `onBeforeUnload` (Task 2); `hasOpenAsset` (Task 3); `EVENTS.PENDING_EDITS_CHANGED`.
- Produces: header meta third segment `· Unsaved changes`; `#saveAssetBtn.has-unsaved` + `aria-label="Save Draft (unsaved changes)"`; `beforeunload` listener.

- [ ] **Step 1: Write the failing tests**

Append to `test/frontend/asset-chrome.test.js` (it already sets up the DOM, the stores, and imports `asset-chrome`). Add an import of engine state inside `beforeAll` (after the other imports): `({ state } = await import("../../frontend/src/js/engine/state.js"));` with `let state;` declared at the top next to the other `let`s. In `beforeEach`, add `state.pendingTransformEdits = new Map();`. Then:

```js
test("meta gains 'Unsaved changes' and Save gets the dot while edits are pending", () => {
  walletState.set({ walletAddress: "0x00000000000000000000000000000000000000a1" });
  assetStore.set({ activeAssetManifestCid: "bafyA", activeAssetName: "Stand" });
  versionStore.entries = [{ cid: "bafyA" }];
  versionStore.active = 0;
  notifyVersionSubs();
  expect(meta()).toBe("v1 · Draft");

  state.pendingTransformEdits.set("n1", [1]);
  emit(EVENTS.PENDING_EDITS_CHANGED);
  expect(meta()).toBe("v1 · Draft · Unsaved changes");
  const save = document.getElementById("saveAssetBtn");
  expect(save.classList.contains("has-unsaved")).toBe(true);
  expect(save.getAttribute("aria-label")).toBe("Save Draft (unsaved changes)");

  state.pendingTransformEdits.clear();
  emit(EVENTS.PENDING_EDITS_CHANGED);
  expect(meta()).toBe("v1 · Draft");
  expect(save.classList.contains("has-unsaved")).toBe(false);
  expect(save.getAttribute("aria-label")).toBe("Save Draft");
});

test("with no versions yet the marker reads 'Draft · Unsaved changes'", () => {
  assetStore.set({ activeAssetManifestCid: "bafyA", activeAssetName: "Stand" });
  state.pendingTransformEdits.set("n1", [1]);
  emit(EVENTS.PENDING_EDITS_CHANGED);
  expect(meta()).toBe("Draft · Unsaved changes");
});

test("beforeunload is prevented only while dirty", () => {
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);

  state.pendingTransformEdits.set("n1", [1]);
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
});
```

Use the real setter the file already uses for asset state: if the existing tests set state through `assetStore.set(...)`, use that (as above); if they go through `renameAsset`/`setActiveManifestCid`, mirror them instead — check the existing tests at the top of the file first.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/asset-chrome.test.js`
Expected: the 3 new tests FAIL (meta lacks the segment; no listener).

- [ ] **Step 3: Implement**

In `frontend/src/js/ui/asset-chrome.ts`:

Replace the cleanup import with:

```ts
import { hasOpenAsset } from "../state/edit-mode.ts";
import { hasUnsavedChanges, onBeforeUnload } from "../state/unsaved-changes.ts";
```

Replace `renderChrome` with:

```ts
const SAVE_LABEL = "Save Draft";

/** Header meta: `v<N> · Draft|Published`, plus `· Unsaved changes` when dirty. */
function _metaText(tokenId: string | null, dirty: boolean): string {
  const status = tokenId ? "Published" : "Draft";
  const { entries } = getVersionState();
  const base = entries.length ? `v${activeIndex() + 1} · ${status}` : status;
  return dirty ? `${base} · Unsaved changes` : base;
}

function _renderSaveButton(visible: boolean, dirty: boolean): void {
  if (!saveBtn) return;
  saveBtn.hidden = !visible;
  saveBtn.classList.toggle("has-unsaved", dirty);
  saveBtn.setAttribute("aria-label", dirty ? `${SAVE_LABEL} (unsaved changes)` : SAVE_LABEL);
}

/**
 * Renders the chrome from current state.
 * @remarks Idempotent.
 */
function renderChrome(): void {
  const s = getAssetState();
  const hasAsset = hasOpenAsset();
  const hasWallet = !!walletState.get().walletAddress;
  const dirty = hasAsset && hasUnsavedChanges();

  if (titleEl) {
    if (s.activeAssetName) titleEl.textContent = s.activeAssetName;
    else if (hasAsset) titleEl.textContent = "Untitled Asset";
    else titleEl.textContent = "No asset open";
  }
  if (metaEl) {
    metaEl.textContent =
      !s.activeAssetName && !hasAsset
        ? "Create or open an asset"
        : _metaText(s.activeAssetTokenId, dirty);
  }

  // New starts an editable draft — meaningless for anonymous/visitor views.
  if (newBtn) newBtn.hidden = !hasWallet || isLibraryVisitor();
  _renderSaveButton(hasAsset && hasWallet, dirty);
  if (publishBtn) publishBtn.hidden = !(hasAsset && hasWallet);
  // Downloads are read-only — no wallet/session required.
  if (downloadBtn) downloadBtn.hidden = !hasAsset;
  // Properties → Asset (name, collection, tier, team): only meaningful once
  // there is something to name/save.
  if (assetSection) assetSection.hidden = !hasAsset;
}
```

Append to the subscription block at the bottom:

```ts
on(EVENTS.PENDING_EDITS_CHANGED, renderChrome);
// Native "Leave site?" prompt while edits are unsaved.
window.addEventListener("beforeunload", onBeforeUnload);
```

Also update the module doc comment's first line to: `Sole writer of the header title/meta (incl. the unsaved marker), the save/publish/download buttons' visibility, and the Properties → Asset section's visibility.`

In `_headerbar.scss`, after the `.headerbar-doc-actions { … }` block:

```scss
// Unsaved-changes dot on Save draft. The header meta's "Unsaved changes"
// text is the primary cue (WCAG 1.4.1); the dot only echoes it.
#saveAssetBtn.has-unsaved {
  position: relative;

  &::after {
    content: "";
    position: absolute;
    top: var(--size-1);
    right: var(--size-1);
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--accent-bg);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun scripts/run-tests.mjs test/frontend/asset-chrome.test.js test/frontend/style-guards.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/asset-chrome.ts frontend/src/scss/components/_headerbar.scss test/frontend/asset-chrome.test.js
git commit -m "feat(ui): unsaved-changes marker and leave-site guard (#86)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Extract group pivot + transform commit helpers

Pure refactor, behaviour-preserving except the deliberate "stage only moved nodes" change (Deviation 3). Existing gizmo tests must stay green.

**Files:**
- Create: `frontend/src/js/engine/group-pivot.ts`
- Create: `frontend/src/js/engine/transform-commit.ts`
- Modify: `frontend/src/js/ui/transform-gizmo.ts`
- Test: `test/frontend/transform-commit.test.js`; existing `transform-gizmo.test.js`, `transform-gizmo-group.test.js`, `undo-gizmo-capture.test.js` unchanged and green

**Interfaces:**
- Produces (`engine/group-pivot.ts`):
  - `topLevelAnchorsFor(ids: Iterable<string>): BABYLON.TransformNode[]`
  - `attachToGroupPivot(gizmoManager: BABYLON.GizmoManager): void`
  - `startGroupDrag(): void`, `applyGroupDrag(): void`, `endGroupDrag(): void`
  - `disposeGroupPivot(): void`
  - `isGroupDragActive(): boolean`
- Produces (`engine/transform-commit.ts`):
  - `type MatrixSnapshot = Array<{ nodeId: string; matrix: number[] }>`
  - `selectedIds(): string[]` — multi-selection, else the highlighted node, else `[]`
  - `snapshotMatrices(ids: string[]): MatrixSnapshot`
  - `commitTransformChange(label: string, before: MatrixSnapshot | null): string[]` — stages + emits `TRANSFORM_STAGED` + pushes ONE `{type:"transform"}` undo entry for nodes whose matrix changed; returns their ids

- [ ] **Step 1: Write the failing test for transform-commit**

`test/frontend/transform-commit.test.js`:

```js
import { beforeEach, describe, expect, jest, test } from "bun:test";
import { state } from "../../frontend/src/js/engine/state.js";
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { clearUndoStacks, popUndoEntry, canUndo } from "../../frontend/src/js/engine/undo-stack.js";
import {
  selectedIds,
  snapshotMatrices,
  commitTransformChange,
} from "../../frontend/src/js/engine/transform-commit.js";

// readNodeTransformMatrix returns Array.from(BABYLON.Matrix.Compose(scaling,
// rotationQuaternion, position).m); matricesEqual compares 16 entries.
const M = (tx) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, 0, 0, 1];
let matrices;
beforeEach(() => {
  matrices = { a: M(0), b: M(0) };
  global.BABYLON = {
    Matrix: { Compose: (_s, _r, p) => ({ m: [...matrices[p.id]] }) },
    Quaternion: { Identity: () => ({}) },
  };
  state.nodeAnchors = new Map(
    ["a", "b"].map((id) => [
      id,
      { isDisposed: () => false, scaling: {}, rotationQuaternion: {}, position: { id } },
    ])
  );
  state.selectedNodeIds = new Set();
  state.highlightedNodeId = null;
  state.pendingTransformEdits = new Map();
  clearUndoStacks();
});

describe("transform-commit", () => {
  test("selectedIds prefers the multi-selection, then the highlight", () => {
    expect(selectedIds()).toEqual([]);
    state.highlightedNodeId = "a";
    expect(selectedIds()).toEqual(["a"]);
    state.selectedNodeIds = new Set(["a", "b"]);
    expect(selectedIds()).toEqual(["a", "b"]);
  });

  test("only moved nodes are staged, and one undo entry is pushed", () => {
    const before = snapshotMatrices(["a", "b"]);
    matrices.a = M(7);
    const staged = jest.fn();
    const off = on(EVENTS.TRANSFORM_STAGED, staged);

    expect(commitTransformChange("Drop to floor", before)).toEqual(["a"]);
    expect([...state.pendingTransformEdits.keys()]).toEqual(["a"]);
    expect(staged).toHaveBeenCalledWith({ nodeIds: ["a"] });
    const entry = popUndoEntry();
    expect(entry.label).toBe("Drop to floor");
    expect(entry.items).toEqual([{ nodeId: "a", before: M(0), after: M(7) }]);
    off();
  });

  test("no movement stages nothing and pushes nothing", () => {
    const before = snapshotMatrices(["a"]);
    expect(commitTransformChange("Move", before)).toEqual([]);
    expect(state.pendingTransformEdits.size).toBe(0);
    expect(canUndo()).toBe(false);
    expect(commitTransformChange("Move", null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/transform-commit.test.js`
Expected: FAIL — cannot resolve `transform-commit.js`.

- [ ] **Step 3: Create `engine/transform-commit.ts`**

```ts
/**
 * One path for every transform change the user makes in the viewport
 * (gizmo drags, Drop to floor, Reset transform): stage the moved nodes for
 * Save and record a single undo entry.
 */
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { state } from "./state.ts";
import { stageNodeTransform, readNodeTransformMatrix, matricesEqual } from "./transforms.ts";
import { pushUndoEntry } from "./undo-stack.ts";

export type MatrixSnapshot = Array<{ nodeId: string; matrix: number[] }>;

/**
 * Node ids the viewport tools act on: the multi-selection when present,
 * otherwise the single highlighted node.
 */
export function selectedIds(): string[] {
  if (state.selectedNodeIds.size > 0) return [...state.selectedNodeIds];
  return state.highlightedNodeId ? [state.highlightedNodeId] : [];
}

export function snapshotMatrices(ids: string[]): MatrixSnapshot {
  const out: MatrixSnapshot = [];
  for (const nodeId of ids) {
    const matrix = readNodeTransformMatrix(nodeId);
    if (matrix) out.push({ nodeId, matrix });
  }
  return out;
}

/**
 * Stages and records every node whose matrix changed since `before`.
 * @remarks Unmoved nodes are not staged, so a click without a drag never
 *   marks the asset as having unsaved changes.
 * @returns the ids that moved.
 */
export function commitTransformChange(
  label: string,
  before: MatrixSnapshot | null
): string[] {
  const items = [];
  for (const { nodeId, matrix } of before || []) {
    const after = readNodeTransformMatrix(nodeId);
    if (after && !matricesEqual(matrix, after)) items.push({ nodeId, before: matrix, after });
  }
  if (items.length === 0) return [];
  const ids = items.map((i) => i.nodeId);
  for (const id of ids) stageNodeTransform(id);
  emit(EVENTS.TRANSFORM_STAGED, { nodeIds: ids });
  pushUndoEntry({ type: "transform", label, items });
  return ids;
}
```

- [ ] **Step 4: Create `engine/group-pivot.ts`**

Move — verbatim, keeping all comments — the "Group pivot — multi-selection transforms" banner and everything under it in `ui/transform-gizmo.ts` (`_groupPivot`, `_groupSnapshot`, `_disposeGroupPivot`, `_ensureGroupPivot`, `_topLevelSelectedAnchors`, `_attachToGroupPivot`, `_startGroupDrag`, `_applyGroupDrag`, `_endGroupDrag`). Then rename/export:

```ts
/**
 * Group pivot for multi-selection transforms.
 * @remarks (keep the original banner text here verbatim)
 */
import { state } from "./state.ts";

let _groupPivot: BABYLON.TransformNode | null = null;
let _groupSnapshot: Array<{
  anchor: BABYLON.TransformNode;
  rel: BABYLON.Matrix;
  parentInv: BABYLON.Matrix;
}> | null = null;

export function isGroupDragActive(): boolean {
  return _groupSnapshot !== null;
}

export function disposeGroupPivot(): void { /* body of _disposeGroupPivot */ }

function _ensureGroupPivot(): BABYLON.TransformNode { /* unchanged */ }

/**
 * Returns the anchors for `ids` with no other listed anchor in their parent
 * chain.
 * @remarks (original _topLevelSelectedAnchors remarks)
 */
export function topLevelAnchorsFor(ids: Iterable<string>): BABYLON.TransformNode[] {
  const anchors = [...ids]
    .map((id) => state.nodeAnchors.get(id))
    .filter((a) => a && !a.isDisposed());
  const set = new Set(anchors);
  return anchors.filter((a) => {
    for (let p = a.parent; p; p = p.parent) {
      if (set.has(p)) return false;
    }
    return true;
  });
}

export function attachToGroupPivot(gizmoManager: BABYLON.GizmoManager): void {
  const anchors = topLevelAnchorsFor(state.selectedNodeIds);
  /* rest of _attachToGroupPivot unchanged */
}

export function startGroupDrag(): void {
  if (!_groupPivot || state.selectedNodeIds.size < 2) return;
  const topAnchors = topLevelAnchorsFor(state.selectedNodeIds);
  /* rest of _startGroupDrag unchanged */
}

export function applyGroupDrag(): void { /* body of _applyGroupDrag */ }

export function endGroupDrag(): void {
  _groupSnapshot = null;
}
```

- [ ] **Step 5: Rewire `ui/transform-gizmo.ts`**

- Delete the moved block and the now-unused local `_selectedIds`, `_snapshotSelectedMatrices`, `_pushDragUndoEntry`, `captureNodeTransform`, `captureSelectedTransform`.
- Imports become:

```ts
import { on, emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { state } from "../engine/state.ts";
import type { TransformMode } from "../engine/state.ts";
import { undo, redo } from "../engine/undo-controller.ts";
import {
  attachToGroupPivot,
  startGroupDrag,
  applyGroupDrag,
  endGroupDrag,
  disposeGroupPivot,
  isGroupDragActive,
} from "../engine/group-pivot.ts";
import {
  selectedIds,
  snapshotMatrices,
  commitTransformChange,
} from "../engine/transform-commit.ts";
import type { MatrixSnapshot } from "../engine/transform-commit.ts";
```

- Per-frame fan-out: `if (state.isGizmoDragging && isGroupDragActive()) applyGroupDrag();`
- Undo capture state becomes `let _dragBefore: MatrixSnapshot | null = null;` (keep `_dragMode`, `_MODE_LABELS`).
- `ensureDragEndSubscription` handlers:

```ts
    gizmo.onDragStartObservable.add(() => {
      state.isGizmoDragging = true;
      _dragBefore = snapshotMatrices(selectedIds());
      _dragMode = state.transformMode;
      if (state.selectedNodeIds.size > 1) startGroupDrag();
    });
```

```ts
    gizmo.onDragEndObservable.add(() => {
      state.isGizmoDragging = false;
      endGroupDrag();
      commitTransformChange(_MODE_LABELS[_dragMode || ""] || "Transform", _dragBefore);
      _dragBefore = null;
      _dragMode = null;
    });
```

- Replace remaining `_attachToGroupPivot(` → `attachToGroupPivot(` and `_disposeGroupPivot()` → `disposeGroupPivot()`.

- [ ] **Step 6: Run the gizmo suites**

Run: `bun scripts/run-tests.mjs test/frontend/transform-commit.test.js test/frontend/transform-gizmo.test.js test/frontend/transform-gizmo-group.test.js test/frontend/undo-gizmo-capture.test.js`
Expected: all pass. If `undo-gizmo-capture`'s "a drag that moves the node" fails because its anchor mock lacks fields `readNodeTransformMatrix` now needs, nothing changed there — the same reader was used before; re-check you call `snapshotMatrices(selectedIds())` (not an empty list).

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit -p frontend/tsconfig.json` — expected: no errors.

```bash
git add frontend/src/js/engine/group-pivot.ts frontend/src/js/engine/transform-commit.ts frontend/src/js/ui/transform-gizmo.ts test/frontend/transform-commit.test.js
git commit -m "refactor(gizmo): extract group pivot and transform commit helpers (#86)

Drag end now stages only nodes that actually moved.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: View/Edit modes in the transform toolbar

**Files:**
- Modify: `frontend/src/js/ui/transform-gizmo.ts`
- Modify: `frontend/src/js/engine/state.ts:31` (`TransformMode`)
- Modify: `frontend/src/js/engine/scene-graph.ts:490-494` (remove `case "g"`)
- Modify: `frontend/src/scss/components/_viewport.scss` (after `.transform-toolbar-side`, ~line 200)
- Test: `test/frontend/transform-gizmo.test.js`, `transform-gizmo-group.test.js`, `undo-gizmo-capture.test.js` (migrate), new tests in `transform-gizmo.test.js`

**Interfaces:**
- Consumes: `canEdit`, `isEditing`, `setEditing`, `toggleEditing`, `subscribeEditMode` (Task 3); `enterEditForTest` (Task 3 helper).
- Produces:
  - `TransformMode = "translate" | "rotate" | "time" | null`
  - DOM: `#editModeBtn` (text "Edit"/"Done", `aria-label` "Edit placement (E)"/"Done editing (E)", `hidden` when `!canEdit()`); elements with `data-edit-only` (hidden in View) and `data-view-only` (hidden in Edit); `.transform-toolbar-sep` separators
  - Internal (used by Task 7): `KEYS_EDIT: Record<string, () => void>`, `ACTIONS: Record<string, () => void>`, `_keyAction(e: KeyboardEvent)`, `updateToolbarUI()`, `setMode(mode)`

- [ ] **Step 1: Migrate the existing gizmo tests to Edit mode**

In each of `test/frontend/transform-gizmo.test.js`, `transform-gizmo-group.test.js`, `undo-gizmo-capture.test.js`:

```js
import { enterEditForTest } from "./helpers/edit-mode.js";
import { _resetEditModeForTesting } from "../../frontend/src/js/state/edit-mode.js";
```

Call `_resetEditModeForTesting();` at the top of `beforeEach`, and `enterEditForTest();` right after `initTransformGizmo({}, null);` — **except** in `transform-gizmo.test.js`, where only the tests that expect a placement mode (`"toolbar buttons are re-enabled after deselect then reselect"`, `"time mode is disabled for multi-selections"`) call `enterEditForTest()` at their start. For `transform-gizmo.test.js`, update:

- `"time mode button exists…"`: the first selection now happens in View mode, so `modes` stays `[]` after `NODE_SELECTED`; replace `expect(modes).toEqual(["translate"])` with `expect(modes).toEqual([])` and the later expectation with `expect(modes).toEqual(["time"])`.
- `"time mode is disabled for multi-selections"`: after the refused `v`, expect `state.transformMode` to be `"translate"` (unchanged — it is in Edit mode because of `enterEditForTest()`, and V exits Edit only when time mode is allowed). Since V now calls `setEditing(false)` before `setMode("time")`, guard order matters: implement `_enterTime` (Step 3) so it returns early **before** leaving Edit when time is not allowed.
- `"growing the selection past one node leaves time mode"`: expect `state.transformMode` to be `null` (View mode has no placement fallback).

- [ ] **Step 2: Write the new failing tests**

Append to `test/frontend/transform-gizmo.test.js` inside the `describe`:

```js
  test("View mode: selecting attaches no gizmo and shows only Edit + Time", () => {
    const attach = jest.spyOn(state.gizmoManager, "attachToNode");
    state.nodeAnchors.set("node-1", { isDisposed: () => false });
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });

    expect(state.transformMode).toBe(null);
    expect(attach).not.toHaveBeenCalledWith(state.nodeAnchors.get("node-1"));
    const visible = (sel) => !viewport.querySelector(sel).hidden;
    expect(visible('[data-mode="translate"]')).toBe(false);
    expect(visible('[data-mode="time"]')).toBe(true);
    expect(viewport.querySelector('[data-mode="scale"]')).toBeNull();
  });

  test("Edit button is hidden when the user cannot save", () => {
    expect(document.getElementById("editModeBtn").hidden).toBe(true);
    enterEditForTest();
    const btn = document.getElementById("editModeBtn");
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe("Done");
    expect(btn.getAttribute("aria-label")).toBe("Done editing (E)");
  });

  test("entering Edit selects Move and attaches to the selection", () => {
    const anchor = { isDisposed: () => false };
    state.nodeAnchors.set("node-1", anchor);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    const attach = jest.spyOn(state.gizmoManager, "attachToNode");

    enterEditForTest();
    expect(state.transformMode).toBe("translate");
    expect(attach).toHaveBeenLastCalledWith(anchor);
    expect(viewport.querySelector('[data-mode="translate"]').hidden).toBe(false);
    expect(viewport.querySelector('[data-mode="time"]').hidden).toBe(true);
  });

  test("keys: T/R do nothing in View; E toggles; S is gone; V works in both", () => {
    state.nodeAnchors.set("node-1", { isDisposed: () => false });
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    const press = (key, opts = {}) =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key, ...opts }));

    press("t");
    press("r");
    press("s");
    expect(state.transformMode).toBe(null);

    // make canEdit() true, then use the real key
    enterEditForTest();
    press("e"); // E toggles back out
    expect(isEditing()).toBe(false);
    press("e");
    expect(isEditing()).toBe(true);
    press("r");
    expect(state.transformMode).toBe("rotate");
    press("s");
    expect(state.transformMode).toBe("rotate"); // no scale tool

    press("v"); // leaves Edit, enters Time
    expect(isEditing()).toBe(false);
    expect(state.transformMode).toBe("time");
  });

  test("leaving Edit clears the placement mode and detaches", () => {
    state.nodeAnchors.set("node-1", { isDisposed: () => false });
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    const attach = jest.spyOn(state.gizmoManager, "attachToNode");
    setEditing(false);
    expect(state.transformMode).toBe(null);
    expect(attach).toHaveBeenLastCalledWith(null);
  });

  test("leaving Edit mid-drag detaches only after the drag ends", () => {
    state.nodeAnchors.set("node-1", { isDisposed: () => false });
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    state.isGizmoDragging = true;
    setEditing(false);
    expect(state.transformMode).toBe("translate"); // still mid-drag
    state.isGizmoDragging = false;
    dragEnd(); // fires the position gizmo's onDragEndObservable
    expect(state.transformMode).toBe(null);
  });
```

Test plumbing changes in this file:
- import `jest` from `bun:test`; import `{ isEditing, setEditing, _resetEditModeForTesting }` from `../../frontend/src/js/state/edit-mode.js` and `{ enterEditForTest }` from `./helpers/edit-mode.js`; call `_resetEditModeForTesting()` at the start of `beforeEach`, and reset `walletState.set({ walletAddress: null })` (import `walletState` from `../../frontend/src/js/state/wallet-state.js`) plus `_resetForTesting` from `@arbesk/asset-core/domain/asset-store.js` so the Edit button starts hidden.
- Make the mock gizmos' observables real enough to fire: replace the `GizmoManager` mock's `gizmos` with

```js
          const obs = () => {
            const fns = [];
            return { add: (f) => fns.push(f), fire: () => fns.forEach((f) => f()) };
          };
          this.gizmos = {
            positionGizmo: { onDragStartObservable: obs(), onDragEndObservable: obs() },
            rotationGizmo: { onDragStartObservable: obs(), onDragEndObservable: obs() },
          };
```

  and add a helper at file scope: `const dragEnd = () => state.gizmoManager.gizmos.positionGizmo.onDragEndObservable.fire();`

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `bun scripts/run-tests.mjs test/frontend/transform-gizmo.test.js`
Expected: the 6 new tests FAIL (no `#editModeBtn`, select still attaches, S still switches).

- [ ] **Step 4: Implement the modes**

`frontend/src/js/engine/state.ts:31`:

```ts
export type TransformMode = "translate" | "rotate" | "time" | null;
```

`frontend/src/js/engine/scene-graph.ts`: delete the whole `case "g": … break;` block (the dynamic `import("../ui/transform-gizmo.ts")` with it).

`frontend/src/js/ui/transform-gizmo.ts`:

1. Doc comment at the top becomes:

```ts
/**
 * Viewport placement controls: the View/Edit toggle, the Move/Rotate gizmo,
 * and the side Undo/Redo/Grid strip.
 * @remarks View-only by default — the gizmo attaches only in Edit mode
 *   (state/edit-mode.ts). Transform edits are staged and persisted on the
 *   next Save Draft / Publish. There is deliberately no scale gizmo: scale is
 *   a numeric Inspector edit, protecting print dimensions.
 */
```

2. Add the import: `import { canEdit, isEditing, setEditing, toggleEditing, subscribeEditMode } from "../state/edit-mode.ts";`

3. Delete `ICONS.scale`, `_MODE_LABELS.scale`, and every `scaleGizmoEnabled` / `gizmos.scaleGizmo` reference.

4. `createToolbar()` — the top toolbar markup becomes:

```ts
  toolbar.innerHTML = `
    <button class="btn btn-flat btn-sm transform-tool" data-mode="translate" data-edit-only aria-label="Move (T)" title="Move (T)">
      ${ICONS.translate}
    </button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="rotate" data-edit-only aria-label="Rotate (R)" title="Rotate (R)">
      ${ICONS.rotate}
    </button>
    <span class="transform-toolbar-sep" data-edit-only aria-hidden="true"></span>
    <button id="editModeBtn" class="btn btn-flat btn-sm edit-mode-toggle" data-action="toggleEdit" aria-label="Edit placement (E)" title="Edit placement (E)" hidden>Edit</button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="time" data-view-only aria-label="Time (V)" title="Time (V)">
      ${ICONS.time}
    </button>
  `;
```

   The side strip's grid button loses its key hint: `aria-label="Toggle grid and axes" title="Toggle grid and axes"`.

   The click handler dispatches through a table:

```ts
const ACTIONS: Record<string, () => void> = {
  undo,
  redo,
  toggleGrid: () => {
    toggleGrid();
  },
  toggleEdit: () => {
    toggleEditing();
  },
};
```

```ts
  const onToolbarClick = (e: MouseEvent) => {
    const actionBtn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    const action = actionBtn ? ACTIONS[actionBtn.dataset.action || ""] : undefined;
    if (action) {
      action();
      return;
    }
    const btn = (e.target as HTMLElement).closest(".transform-tool") as HTMLElement | null;
    if (btn?.dataset.mode) setMode(btn.dataset.mode as TransformMode);
  };
```

5. Mode helpers (new, near `setMode`):

```ts
function _isPlacementMode(mode: TransformMode): boolean {
  return mode === "translate" || mode === "rotate";
}

/** Gizmo off, nothing attached, no mode — the View-mode resting state. */
function _clearMode(): void {
  const gm = state.gizmoManager;
  if (!gm) return;
  state.transformMode = null;
  gm.positionGizmoEnabled = false;
  gm.rotationGizmoEnabled = false;
  gm.attachToNode(null);
  disposeGroupPivot();
  updateToolbarUI();
  emit(EVENTS.TRANSFORM_MODE_CHANGED, { mode: null });
}

/** Set while Edit was left mid-drag; the drag-end handler finishes the exit. */
let _detachAfterDrag = false;

function _onEditModeChanged(): void {
  if (isEditing()) {
    if (_isPlacementMode(state.transformMode)) updateToolbarUI();
    else setMode("translate");
    return;
  }
  if (!_isPlacementMode(state.transformMode)) {
    updateToolbarUI();
    return;
  }
  if (state.isGizmoDragging) {
    _detachAfterDrag = true;
    updateToolbarUI();
    return;
  }
  _clearMode();
}

/** Re-attach after a selection change — only placement and time modes attach. */
function _refreshAttachment(gm: BABYLON.GizmoManager): void {
  if (isEditing() || state.transformMode === "time") attachToSelected(gm);
  else gm.attachToNode(null);
  updateToolbarUI();
}
```

6. `setMode` — add the guard and drop scale:

```ts
function setMode(mode: TransformMode): void {
  if (!state.gizmoManager) return;
  // Placement tools exist only in Edit mode.
  if (_isPlacementMode(mode) && !isEditing()) return;
  // Per-node time-travel is a single-selection feature.
  if (mode === "time" && state.selectedNodeIds.size > 1) {
    console.log("[GIZMO] time mode ignored: multi-selection active");
    return;
  }

  state.transformMode = mode;
  state.gizmoManager.positionGizmoEnabled = mode === "translate";
  state.gizmoManager.rotationGizmoEnabled = mode === "rotate";

  // Gizmos are created lazily; subscribe to drag-end on whichever exists.
  const gizmos = state.gizmoManager.gizmos || {};
  ensureDragEndSubscription(gizmos.positionGizmo);
  ensureDragEndSubscription(gizmos.rotationGizmo);

  attachToSelected(state.gizmoManager);
  updateToolbarUI();
  emit(EVENTS.TRANSFORM_MODE_CHANGED, { mode });
}
```

7. Drag end gains the deferred exit (append inside the `onDragEndObservable` handler, after `_dragMode = null;`):

```ts
      if (_detachAfterDrag) {
        _detachAfterDrag = false;
        _clearMode();
      }
```

8. `wireEvents`:

```ts
function wireEvents(gizmoManager: BABYLON.GizmoManager): void {
  on(EVENTS.NODE_SELECTED, () => {
    if (isEditing() && !_isPlacementMode(state.transformMode)) setMode("translate");
    else _refreshAttachment(gizmoManager);
  });

  on(EVENTS.SELECTION_CHANGED, () => {
    // Time mode is single-selection only.
    if (state.transformMode === "time" && state.selectedNodeIds.size > 1) _clearMode();
    else _refreshAttachment(gizmoManager);
  });

  on(EVENTS.NODE_DESELECTED, () => {
    gizmoManager.attachToNode(null);
    disposeGroupPivot();
    updateToolbarUI();
  });

  on(EVENTS.SCENE_CLEARED, () => {
    gizmoManager.attachToNode(null);
    disposeGroupPivot();
    // Do not reset transformMode here: clearing the scene is part of version
    // navigation (loadVersion -> clearScene -> loadAssetManifest), and the user
    // should remain in Time mode so the model clock can rebuild on SCENE_READY.
    // (edit-mode.ts drops Edit on SCENE_CLEARED; _onEditModeChanged clears a
    // placement mode.)
    updateToolbarUI();
  });

  subscribeEditMode(_onEditModeChanged);
}
```

9. Keyboard — replace `wireKeyboard` with a table-driven handler (call `wireKeyboard()` with no args from `initTransformGizmo`):

```ts
function _isEditableFocus(): boolean {
  const el = document.activeElement as HTMLElement | null;
  const tag = el?.tagName?.toLowerCase();
  return (
    !!el?.isContentEditable ||
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    tag === "button"
  );
}

/** V: time travel works in View and Edit; from Edit it leaves Edit first. */
function _enterTime(): void {
  if (state.selectedNodeIds.size > 1) return; // refused before leaving Edit
  if (isEditing()) setEditing(false);
  setMode("time");
}

const KEYS_ANY: Record<string, () => void> = {
  e: () => {
    toggleEditing();
  },
  v: _enterTime,
};

const KEYS_EDIT: Record<string, () => void> = {
  t: () => setMode("translate"),
  r: () => setMode("rotate"),
};

function _keyAction(e: KeyboardEvent): (() => void) | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return undefined;
  const key = e.key.toLowerCase();
  return KEYS_ANY[key] ?? (isEditing() ? KEYS_EDIT[key] : undefined);
}

function wireKeyboard(): void {
  document.addEventListener("keydown", (e) => {
    if (_isEditableFocus()) return;
    const action = _keyAction(e);
    if (!action) return;
    e.preventDefault();
    action();
  });
}
```

10. `updateToolbarUI` — split into helpers:

```ts
function _renderEditButton(editing: boolean): void {
  const btn = document.getElementById("editModeBtn");
  if (!btn) return;
  btn.hidden = !canEdit();
  btn.textContent = editing ? "Done" : "Edit";
  const label = editing ? "Done editing (E)" : "Edit placement (E)";
  btn.setAttribute("aria-label", label);
  btn.title = label;
}

function _renderToolButton(
  btn: HTMLButtonElement,
  activeMode: TransformMode,
  hasSelection: boolean,
  isMulti: boolean
): void {
  const isActive = btn.dataset.mode === activeMode;
  btn.classList.toggle("active", isActive);
  btn.setAttribute("aria-pressed", String(isActive));
  const isTime = btn.dataset.mode === "time";
  btn.disabled = !hasSelection || (isTime && isMulti);
  if (isTime) {
    btn.title = isMulti ? "Time travel is available for a single selected node" : "Time (V)";
  }
}

function updateToolbarUI(): void {
  const toolbar = document.getElementById(TOOLBAR_ID);
  if (!toolbar) return;
  const editing = isEditing();
  const hasSelection = state.selectedNodeIds.size > 0 || !!state.highlightedNodeId;
  const isMulti = state.selectedNodeIds.size > 1;
  const activeMode = hasSelection ? state.transformMode : null;

  for (const el of toolbar.querySelectorAll<HTMLElement>("[data-edit-only]")) el.hidden = !editing;
  for (const el of toolbar.querySelectorAll<HTMLElement>("[data-view-only]")) el.hidden = editing;
  _renderEditButton(editing);
  for (const btn of toolbar.querySelectorAll<HTMLButtonElement>(".transform-tool")) {
    _renderToolButton(btn, activeMode, hasSelection, isMulti);
  }
}
```

    Note `initTransformGizmo` must NOT set any initial mode; it already sets `state.transformMode = null`. Remove the `scaleGizmoEnabled = false` line there.

`_viewport.scss`, after `.transform-toolbar-side { … }`:

```scss
.transform-toolbar-sep {
  width: var(--border-size-1);
  align-self: stretch;
  margin-inline: var(--size-1);
  background-color: var(--hairline);
}

// Text button (Edit / Done) among icon buttons.
.edit-mode-toggle {
  padding-inline: var(--size-2);
  font-weight: 500;
}

.transform-toolbar [hidden] {
  display: none;
}
```

- [ ] **Step 5: Run the gizmo suites**

Run: `bun scripts/run-tests.mjs test/frontend/transform-gizmo.test.js test/frontend/transform-gizmo-group.test.js test/frontend/undo-gizmo-capture.test.js test/frontend/model-clock-gizmo.test.js test/frontend/scene-graph-new-asset.test.js test/frontend/multi-select.test.js`
Expected: all pass. `undo-gizmo-capture`'s `"label uses the mode captured at drag start"` sets `state.transformMode = "rotate"` directly — still valid.

- [ ] **Step 6: Typecheck + lint + commit**

Run: `npx tsc --noEmit -p frontend/tsconfig.json && npx eslint frontend/src/js/ui/transform-gizmo.ts frontend/src/js/engine/scene-graph.ts frontend/src/js/engine/state.ts`
Expected: clean.

```bash
git add frontend/src/js/ui/transform-gizmo.ts frontend/src/js/engine/state.ts frontend/src/js/engine/scene-graph.ts frontend/src/scss/components/_viewport.scss test/frontend/transform-gizmo.test.js test/frontend/transform-gizmo-group.test.js test/frontend/undo-gizmo-capture.test.js
git commit -m "feat(ui): view by default, explicit Edit toggle, no scale gizmo (#86)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Floor lock, snapping, Drop to floor, Reset transform

**Files:**
- Create: `frontend/src/js/engine/placement-actions.ts`
- Modify: `frontend/src/js/engine/group-pivot.ts` (add `shiftGroupPivotY`)
- Modify: `frontend/src/js/ui/transform-gizmo.ts`
- Test: `test/frontend/placement-actions.test.js`, additions to `test/frontend/transform-gizmo.test.js`

**Interfaces:**
- Consumes: `boundsUnion`, `groundDelta`, `resetOffset`, `moveSnapStep`, `ROTATE_SNAP`, `Bounds`, `Vec3` (Task 1); `selectedIds`, `snapshotMatrices`, `commitTransformChange` (Task 5); `topLevelAnchorsFor`, `attachToGroupPivot` (Task 5).
- Produces:
  - `anchorsBounds(anchors: any[]): Bounds | null` — anchors without `getHierarchyBoundingVectors` are skipped
  - `translateWorld(anchor: any, d: Vec3): void` — world-space offset converted into the parent's space
  - `groundAnchors(anchors: any[]): number` — rigid-group grounding; returns the applied world dy (0 = nothing moved)
  - `resetAnchor(anchor: any): void` — rotation identity, centre X/Z 0, grounded; scale untouched
  - `shiftGroupPivotY(dy: number): void`
  - DOM: `#lockFloorBtn` (`aria-pressed`, default `"true"`), `#dropToFloorBtn`, `#resetTransformBtn`
  - exported for tests: `dropSelectionToFloor(): void`, `resetSelectionTransform(): void`

- [ ] **Step 1: Write the failing adapter test**

`test/frontend/placement-actions.test.js`:

```js
import { beforeEach, describe, expect, test } from "bun:test";
import {
  anchorsBounds,
  translateWorld,
  groundAnchors,
  resetAnchor,
} from "../../frontend/src/js/engine/placement-actions.js";

// A parentless anchor whose world bounds are its local box offset by position.
function mkAnchor(box, pos = { x: 0, y: 0, z: 0 }) {
  const a = {
    parent: null,
    position: {
      ...pos,
      addInPlace(v) {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        return this;
      },
    },
    rotationQuaternion: { w: 0.7 },
    scaling: { x: 2, y: 2, z: 2 },
    computeWorldMatrix() {},
    getHierarchyBoundingVectors() {
      const p = a.position;
      return {
        min: { x: box[0] + p.x, y: box[1] + p.y, z: box[2] + p.z },
        max: { x: box[3] + p.x, y: box[4] + p.y, z: box[5] + p.z },
      };
    },
  };
  return a;
}

beforeEach(() => {
  global.BABYLON = {
    Vector3: class {
      constructor(x, y, z) {
        Object.assign(this, { x, y, z });
      }
      static TransformNormal(v) {
        return v;
      }
    },
    Matrix: { Invert: (m) => m },
    Quaternion: { Identity: () => ({ w: 1 }) },
  };
});

describe("placement-actions", () => {
  test("anchorsBounds unions anchors and skips ones without bounds", () => {
    const b = anchorsBounds([mkAnchor([0, 1, 0, 1, 2, 1]), {}, mkAnchor([2, 3, 2, 3, 4, 3])]);
    expect(b).toEqual({ min: { x: 0, y: 1, z: 0 }, max: { x: 3, y: 4, z: 3 } });
    expect(anchorsBounds([{}])).toBeNull();
  });

  test("groundAnchors moves a stacked group by one shared delta", () => {
    const base = mkAnchor([0, 0, 0, 1, 1, 1], { x: 0, y: 3, z: 0 });
    const top = mkAnchor([0, 0, 0, 1, 1, 1], { x: 0, y: 4, z: 0 });
    expect(groundAnchors([base, top])).toBe(-3);
    expect(base.position.y).toBe(0);
    expect(top.position.y).toBe(1); // still stacked on the base
    expect(groundAnchors([base, top])).toBe(0); // already grounded
  });

  test("resetAnchor: identity rotation, centred on X/Z, grounded, scale kept", () => {
    const a = mkAnchor([0, 0, 0, 2, 1, 2], { x: 5, y: 7, z: -3 });
    resetAnchor(a);
    expect(a.rotationQuaternion.w).toBe(1);
    expect(a.position).toMatchObject({ x: -1, y: 0, z: -1 }); // box centre at 0,0
    expect(a.scaling).toEqual({ x: 2, y: 2, z: 2 });
  });

  test("translateWorld converts through the parent's inverse world matrix", () => {
    let inverted = null;
    BABYLON.Matrix.Invert = (m) => {
      inverted = m;
      return m;
    };
    const a = mkAnchor([0, 0, 0, 1, 1, 1]);
    a.parent = { getWorldMatrix: () => "PARENT_WORLD" };
    translateWorld(a, { x: 0, y: 2, z: 0 });
    expect(inverted).toBe("PARENT_WORLD");
    expect(a.position.y).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/placement-actions.test.js`
Expected: FAIL — cannot resolve `placement-actions.js`.

- [ ] **Step 3: Implement the adapter**

`frontend/src/js/engine/placement-actions.ts`:

```ts
/**
 * Placement on live anchors: bounds, world-space translation, floor
 * grounding and transform reset.
 * @remarks The math is in placement.ts; callers own undo and staging
 *   (engine/transform-commit.ts). Anchors without hierarchy bounds (test
 *   doubles, the invisible-mesh fallback before load) are skipped.
 */
import { boundsUnion, groundDelta, resetOffset } from "./placement.ts";
import type { Bounds, Vec3 } from "./placement.ts";

function _anchorBounds(anchor: any): Bounds | null {
  if (typeof anchor?.getHierarchyBoundingVectors !== "function") return null;
  anchor.computeWorldMatrix?.(true);
  const { min, max } = anchor.getHierarchyBoundingVectors(true);
  return {
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: max.x, y: max.y, z: max.z },
  };
}

/** World AABB over the anchors' whole hierarchies (child assets included). */
export function anchorsBounds(anchors: any[]): Bounds | null {
  return boundsUnion(anchors.map(_anchorBounds));
}

/** Moves an anchor by a world-space offset, expressed in its parent's space. */
export function translateWorld(anchor: any, d: Vec3): void {
  let local = new BABYLON.Vector3(d.x, d.y, d.z);
  if (anchor.parent) {
    const inv = BABYLON.Matrix.Invert(anchor.parent.getWorldMatrix());
    local = BABYLON.Vector3.TransformNormal(local, inv);
  }
  anchor.position.addInPlace(local);
  anchor.computeWorldMatrix?.(true);
}

/**
 * Rests the anchors on Y = 0 as one rigid group (stacking preserved).
 * @returns the world dy applied; 0 when nothing moved.
 */
export function groundAnchors(anchors: any[]): number {
  const dy = groundDelta(anchorsBounds(anchors));
  if (dy === 0) return 0;
  for (const a of anchors) translateWorld(a, { x: 0, y: dy, z: 0 });
  return dy;
}

/** Rotation → identity, then centre on X/Z = 0 and ground. Scale untouched. */
export function resetAnchor(anchor: any): void {
  anchor.rotationQuaternion = BABYLON.Quaternion.Identity();
  anchor.computeWorldMatrix?.(true);
  translateWorld(anchor, resetOffset(_anchorBounds(anchor)));
}
```

Run: `bun scripts/run-tests.mjs test/frontend/placement-actions.test.js` — expected: `Tests: 4 passed`.

- [ ] **Step 4: Write the failing gizmo tests**

Append to `test/frontend/transform-gizmo.test.js` (reuse the file's `BABYLON` mock; turn `Vector3` into a class that keeps the existing `static Zero()` (same chainable object as now) and adds `static TransformNormal(v) { return v; }`; add `Matrix.Invert: (m) => m`, and `Quaternion.Identity: () => ({ w: 1, copyFrom() {} })`; also add to the mock position gizmo `snapDistance: 0, yGizmo: {isEnabled: true}, xPlaneGizmo: {isEnabled: true}, zPlaneGizmo: {isEnabled: true}`, and to the rotation gizmo `snapDistance: 0`). Import `{ dropSelectionToFloor, resetSelectionTransform }` from the gizmo module and `{ popUndoEntry, clearUndoStacks }` from `../../frontend/src/js/engine/undo-stack.js`:

```js
  // An anchor the real readNodeTransformMatrix + placement adapter can drive.
  function liveAnchor(y) {
    const a = {
      parent: null,
      isDisposed: () => false,
      scaling: { x: 1, y: 1, z: 1 },
      rotationQuaternion: { w: 1 },
      position: {
        x: 0, y, z: 0,
        addInPlace(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; },
      },
      computeWorldMatrix() {},
      getHierarchyBoundingVectors: () => ({
        min: { x: 0, y: a.position.y, z: 0 },
        max: { x: 1, y: a.position.y + 1, z: 1 },
      }),
    };
    return a;
  }

  test("Edit applies floor lock and snapping to the position gizmo", () => {
    state.nodeAnchors.set("node-1", liveAnchor(0));
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    const pg = state.gizmoManager.gizmos.positionGizmo;
    expect(pg.yGizmo.isEnabled).toBe(false);
    expect(pg.xPlaneGizmo.isEnabled).toBe(false);
    expect(pg.zPlaneGizmo.isEnabled).toBe(false);
    expect(pg.snapDistance).toBe(2); // grid scale 1 (no groundGrid in the mock scene)

    document.getElementById("lockFloorBtn").click();
    expect(document.getElementById("lockFloorBtn").getAttribute("aria-pressed")).toBe("false");
    expect(pg.yGizmo.isEnabled).toBe(true);
  });

  test("Alt disables snapping until released", () => {
    state.nodeAnchors.set("node-1", liveAnchor(0));
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    const pg = state.gizmoManager.gizmos.positionGizmo;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true }));
    expect(pg.snapDistance).toBe(0);
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    expect(pg.snapDistance).toBe(2);
  });

  test("G drops the selection to the floor as one undo step", () => {
    clearUndoStacks();
    const a = liveAnchor(4);
    state.nodeAnchors.set("node-1", a);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
    expect(a.position.y).toBe(4); // View mode: G does nothing
    enterEditForTest();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
    expect(a.position.y).toBe(0);
    expect(popUndoEntry().label).toBe("Drop to floor");
  });

  test("Shift+R resets rotation/position but not scale", () => {
    clearUndoStacks();
    const a = liveAnchor(3);
    a.position.x = 5;
    a.rotationQuaternion = { w: 0.5 };
    a.scaling = { x: 2, y: 2, z: 2 };
    state.nodeAnchors.set("node-1", a);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "R", shiftKey: true }));
    expect(a.rotationQuaternion.w).toBe(1);
    expect(a.position.y).toBe(0);
    expect(a.scaling).toEqual({ x: 2, y: 2, z: 2 });
    expect(popUndoEntry().label).toBe("Reset transform");
  });

  test("placement buttons are disabled with no selection", () => {
    enterEditForTest();
    expect(document.getElementById("dropToFloorBtn").disabled).toBe(true);
    expect(document.getElementById("resetTransformBtn").disabled).toBe(true);
  });
```

`readNodeTransformMatrix` (`engine/transforms.ts:53`) returns `Array.from(BABYLON.Matrix.Compose(anchor.scaling, anchor.rotationQuaternion, anchor.position).m)` and `matricesEqual` compares 16 entries, so extend the mock with `Matrix.Compose: (s, r, p) => ({ m: [s.x, r.w, p.x, p.y, p.z, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] })` — any move or rotation then changes the snapshot.

Run: `bun scripts/run-tests.mjs test/frontend/transform-gizmo.test.js` — expected: the 5 new tests FAIL.

- [ ] **Step 5: Implement in the gizmo**

`engine/group-pivot.ts` — add:

```ts
/** Keeps the pivot glued to its group after the group was grounded. */
export function shiftGroupPivotY(dy: number): void {
  if (_groupPivot && !_groupPivot.isDisposed()) {
    _groupPivot.position.y += dy;
    _groupPivot.computeWorldMatrix(true);
  }
}
```

`ui/transform-gizmo.ts`:

1. Imports:

```ts
import { groundAnchors, resetAnchor } from "../engine/placement-actions.ts";
import { moveSnapStep, ROTATE_SNAP } from "../engine/placement.ts";
import { topLevelAnchorsFor, shiftGroupPivotY } from "../engine/group-pivot.ts"; // merge into the existing group-pivot import
```

2. Icons (add to `ICONS`):

```ts
  floorLock:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><rect x="7" y="9" width="10" height="8"/><path d="M12 3v3"/></svg>',
  dropToFloor:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/></svg>',
  resetTransform:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
```

3. Markup — insert right after the first `<span class="transform-toolbar-sep" …>`:

```html
    <button id="lockFloorBtn" class="btn btn-flat btn-sm active" data-action="toggleFloorLock" data-edit-only aria-pressed="true" aria-label="Lock to floor" title="Lock to floor">
      ${ICONS.floorLock}
    </button>
    <button id="dropToFloorBtn" class="btn btn-flat btn-sm placement-action" data-action="dropToFloor" data-edit-only aria-label="Drop to floor (G)" title="Drop to floor (G)">
      ${ICONS.dropToFloor}
    </button>
    <button id="resetTransformBtn" class="btn btn-flat btn-sm placement-action" data-action="resetTransform" data-edit-only aria-label="Reset transform (Shift+R)" title="Reset transform (Shift+R)">
      ${ICONS.resetTransform}
    </button>
    <span class="transform-toolbar-sep" data-edit-only aria-hidden="true"></span>
```

4. Placement state + constraints (new section after the undo-capture section):

```ts
// ── Placement constraints (Edit mode) ──
// Floor lock: Move drags on the XZ plane only; Rotate re-grounds on release.
// Snapping: one grid cell / 15°, suspended while Alt is held.

let _floorLocked = true;
let _altHeld = false;

function _gridScale(): number {
  return state.scene?.getMeshByName?.("groundGrid")?.scaling?.x ?? 1;
}

/** Re-applied after setMode because Babylon creates sub-gizmos lazily. */
function _applyGizmoConstraints(): void {
  const g = state.gizmoManager?.gizmos || {};
  const pg = g.positionGizmo;
  if (pg) {
    const free = !_floorLocked;
    if (pg.yGizmo) pg.yGizmo.isEnabled = free;
    if (pg.xPlaneGizmo) pg.xPlaneGizmo.isEnabled = free;
    if (pg.zPlaneGizmo) pg.zPlaneGizmo.isEnabled = free;
    pg.snapDistance = _altHeld ? 0 : moveSnapStep(_gridScale());
  }
  if (g.rotationGizmo) g.rotationGizmo.snapDistance = _altHeld ? 0 : ROTATE_SNAP;
}

function _setAltHeld(held: boolean): void {
  if (_altHeld === held) return;
  _altHeld = held;
  _applyGizmoConstraints();
}

function _toggleFloorLock(): void {
  _floorLocked = !_floorLocked;
  _applyGizmoConstraints();
  updateToolbarUI();
}

function _selectionAnchors(): any[] {
  return topLevelAnchorsFor(selectedIds());
}

/** Runs one placement action on the selection as a single undo step. */
function _runPlacementAction(label: string, act: (anchors: any[]) => void): void {
  if (!isEditing()) return;
  const anchors = _selectionAnchors();
  if (anchors.length === 0) return;
  const before = snapshotMatrices(selectedIds());
  act(anchors);
  commitTransformChange(label, before);
  // Re-centre the multi-selection pivot on the moved group.
  if (state.selectedNodeIds.size > 1 && state.gizmoManager) attachToGroupPivot(state.gizmoManager);
}

export function dropSelectionToFloor(): void {
  _runPlacementAction("Drop to floor", (anchors) => {
    groundAnchors(anchors);
  });
}

export function resetSelectionTransform(): void {
  _runPlacementAction("Reset transform", (anchors) => {
    for (const a of anchors) resetAnchor(a);
  });
}
```

5. Wire into the drag lifecycle (`ensureDragEndSubscription`):

```ts
    gizmo.onDragStartObservable.add(() => {
      state.isGizmoDragging = true;
      _dragBefore = snapshotMatrices(selectedIds());
      _dragMode = state.transformMode;
      _applyGizmoConstraints(); // grid may have rescaled since the last drag
      // Floor-locked Move starts grounded (fixes floating legacy assets);
      // the correction rides in this drag's undo entry.
      if (_floorLocked && _dragMode === "translate") {
        shiftGroupPivotY(groundAnchors(_selectionAnchors()));
      }
      if (state.selectedNodeIds.size > 1) startGroupDrag();
    });
```

```ts
    gizmo.onDragEndObservable.add(() => {
      state.isGizmoDragging = false;
      endGroupDrag();
      // Rotating a long part tips it through the floor — re-ground it.
      if (_floorLocked && _dragMode === "rotate") groundAnchors(_selectionAnchors());
      _setAltHeld(false);
      commitTransformChange(_MODE_LABELS[_dragMode || ""] || "Transform", _dragBefore);
      _dragBefore = null;
      _dragMode = null;
      if (_detachAfterDrag) {
        _detachAfterDrag = false;
        _clearMode();
      }
    });
```

6. In `setMode`, call `_applyGizmoConstraints();` right after the two `ensureDragEndSubscription(...)` lines.

7. `ACTIONS` gains:

```ts
  toggleFloorLock: _toggleFloorLock,
  dropToFloor: dropSelectionToFloor,
  resetTransform: resetSelectionTransform,
```

8. Keyboard: `KEYS_EDIT` gains `g: dropSelectionToFloor`; add a Shift table and use it in `_keyAction`:

```ts
const KEYS_EDIT_SHIFT: Record<string, () => void> = {
  r: resetSelectionTransform,
};

function _keyAction(e: KeyboardEvent): (() => void) | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined;
  const key = e.key.toLowerCase();
  if (e.shiftKey) return isEditing() ? KEYS_EDIT_SHIFT[key] : undefined;
  return KEYS_ANY[key] ?? (isEditing() ? KEYS_EDIT[key] : undefined);
}
```

   In `wireKeyboard`, before the editable-focus check, track Alt and add the blur reset:

```ts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Alt") _setAltHeld(true);
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "Alt") _setAltHeld(false);
  });
  // A modifier released outside the window must not leave snapping off.
  window.addEventListener("blur", () => _setAltHeld(false));
```

9. `updateToolbarUI` additions (append at the end):

```ts
  for (const btn of toolbar.querySelectorAll<HTMLButtonElement>(".placement-action")) {
    btn.disabled = !hasSelection;
  }
  const lock = document.getElementById("lockFloorBtn");
  if (lock) {
    lock.classList.toggle("active", _floorLocked);
    lock.setAttribute("aria-pressed", String(_floorLocked));
  }
```

   If this pushes `updateToolbarUI` over the fallow threshold, move the block into `_renderPlacementButtons(toolbar, hasSelection)`.

- [ ] **Step 6: Run the suites**

Run: `bun scripts/run-tests.mjs test/frontend/placement-actions.test.js test/frontend/transform-gizmo.test.js test/frontend/transform-gizmo-group.test.js test/frontend/undo-gizmo-capture.test.js`
Expected: all pass. If `transform-gizmo-group`'s translate-drag test now sees an extra Y shift: its mock anchors have no `getHierarchyBoundingVectors`, so `groundAnchors` returns 0 — if it still shifts, check `_anchorBounds` guards on the function type.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npx tsc --noEmit -p frontend/tsconfig.json && npx eslint frontend/src/js/ui/transform-gizmo.ts frontend/src/js/engine/placement-actions.ts frontend/src/js/engine/group-pivot.ts`

```bash
git add frontend/src/js/engine/placement-actions.ts frontend/src/js/engine/group-pivot.ts frontend/src/js/ui/transform-gizmo.ts test/frontend/placement-actions.test.js test/frontend/transform-gizmo.test.js
git commit -m "feat(ui): floor-locked snapped placement, drop to floor, reset (#86)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Inspector scale is Edit-only

**Files:**
- Modify: `frontend/src/pug/includes/studio-main.pug:82` (give the hint an id)
- Modify: `frontend/src/js/engine/parametric-preview.ts`
- Test: `test/frontend/parametric-preview.test.js`

**Interfaces:**
- Consumes: `isEditing`, `subscribeEditMode` (Task 3).
- Produces: `#nodeScaleFactor` / `#nodeScalePercent` `disabled` outside Edit; `#scaleHint` text `"Switch to Edit to change scale."` outside Edit.

- [ ] **Step 1: Write the failing test**

In `test/frontend/parametric-preview.test.js`:
- add `'<p id="scaleHint">Applies the same scale on all axes.</p>',` to `setupDom()`;
- in `load(...)`, add a controllable edit-mode mock **before** the final import:

```js
  await mock.module("../../frontend/src/js/state/edit-mode.js", () => ({
    isEditing: () => editMode.editing,
    subscribeEditMode: (fn) => {
      editMode.subs.add(fn);
      return () => editMode.subs.delete(fn);
    },
  }));
```

  with `const editMode = { editing: false, subs: new Set() };` at file scope (reset `editMode.editing = false; editMode.subs.clear();` at the top of `load`).

Append:

```js
describe("scale fields follow Edit mode", () => {
  test("disabled with a hint in View mode, enabled in Edit", async () => {
    await load(jest.fn());
    const factor = document.getElementById("nodeScaleFactor");
    const percent = document.getElementById("nodeScalePercent");
    const hint = document.getElementById("scaleHint");
    expect(factor.disabled).toBe(true);
    expect(percent.disabled).toBe(true);
    expect(hint.textContent).toBe("Switch to Edit to change scale.");

    editMode.editing = true;
    editMode.subs.forEach((fn) => fn());
    expect(factor.disabled).toBe(false);
    expect(hint.textContent).toBe("Applies the same scale on all axes.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/parametric-preview.test.js`
Expected: the new test FAILS (`disabled` false).

- [ ] **Step 3: Implement**

`studio-main.pug:82` — `p.inspector-hint` → `p#scaleHint.inspector-hint` (keep the text).

`parametric-preview.ts` — import `{ isEditing, subscribeEditMode } from "../state/edit-mode.ts";`, then after the `nodeScalePercent` constant:

```ts
const scaleHint = document.getElementById("scaleHint");
const SCALE_HINT_EDIT = scaleHint?.textContent ?? "";
const SCALE_HINT_VIEW = "Switch to Edit to change scale.";

/** Scale is a placement edit: editable in Edit mode only. */
function _syncScaleEditable(): void {
  const editable = isEditing();
  if (nodeScaleFactor) nodeScaleFactor.disabled = !editable;
  if (nodeScalePercent) nodeScalePercent.disabled = !editable;
  if (scaleHint) scaleHint.textContent = editable ? SCALE_HINT_EDIT : SCALE_HINT_VIEW;
}
```

At module bottom (before `export { openInspector };`):

```ts
subscribeEditMode(_syncScaleEditable);
_syncScaleEditable();
```

And first line of `_applyUniformScale`'s body: `if (!isEditing()) return;`

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun scripts/run-tests.mjs test/frontend/parametric-preview.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pug/includes/studio-main.pug frontend/src/js/engine/parametric-preview.ts test/frontend/parametric-preview.test.js
git commit -m "feat(ui): inspector scale is editable in Edit mode only (#86)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Keyboard help + docs

**Files:**
- Modify: `frontend/src/js/ui/keyboard-help.ts`
- Modify: `.agents/skills/edit-ui/SKILL.md:46`, `.agents/skills/edit-ui/references/deep-dive.md:130-145`
- Modify: `docs/superpowers/specs/2026-10-04-ui-refresh-roadmap.md:39`
- Modify: `docs/CURRENT_STATUS.md` (viewport/gizmo feature bullet)

- [ ] **Step 1: keyboard-help.ts**

Replace the Viewport section rows and add an "Edit placement" section right after it:

```ts
  {
    heading: "Viewport",
    rows: [
      ["F", "Frame selected"],
      ["Home", "Frame all"],
      ["0", "Reset view (forget saved camera position)"],
      ["V", "Time travel for the selected node"],
      ["Esc", "Deselect"],
    ],
  },
  {
    heading: "Edit placement",
    rows: [
      ["E", "Enter / leave Edit mode"],
      ["T", "Move (on the floor plane)"],
      ["R", "Rotate (15° steps)"],
      ["G", "Drop to floor"],
      ["Shift+R", "Reset transform (keeps scale)"],
      ["Alt (hold while dragging)", "Turn snapping off"],
    ],
  },
```

- [ ] **Step 2: edit-ui skill**

In `.agents/skills/edit-ui/SKILL.md:46`, replace ``Viewport keys: `F` frame selected, `Home` frame all, `0` reset view, `G` toggle grid, `Esc` deselect; gizmo `T`/`R`/`S`.`` with ``Viewport keys: `F` frame selected, `Home` frame all, `0` reset view, `V` time, `Esc` deselect. The Studio is **view by default**: `E` enters Edit, then `T` move / `R` rotate / `G` drop to floor / `Shift+R` reset. There is no scale gizmo (scale is the Inspector's numeric field, Edit-only) and the grid toggle has no key.``

In `references/deep-dive.md`, replace the `G` and `T / R / S` rows with:

```markdown
| `E` | Enter / leave Edit mode | `ui/transform-gizmo.ts` + `state/edit-mode.ts` |
| `T` / `R` | Move / rotate (Edit only) | `ui/transform-gizmo.ts` |
| `G` | Drop to floor (Edit only) | `ui/transform-gizmo.ts` |
| `Shift+R` | Reset transform, keeps scale (Edit only) | `ui/transform-gizmo.ts` |
| `V` | Time travel (both modes) | `ui/transform-gizmo.ts` |
```

- [ ] **Step 3: Roadmap + status**

Roadmap row 5: replace `| to write |` with `` | `2026-10-04-view-edit-mode-design.md` — **done** | ``.

`docs/CURRENT_STATUS.md`: find the viewport/transform bullet (`grep -n -i "gizmo\|transform" docs/CURRENT_STATUS.md`) and replace its description with: "View by default; explicit Edit mode (E) with floor-locked, grid/15°-snapped Move/Rotate, Drop to floor (G), Reset transform (Shift+R); no scale gizmo (Inspector scale, Edit-only); header shows `· Unsaved changes` and the browser confirms leaving while edits are unsaved." If no such bullet exists, add it under the Studio/viewport feature list.

- [ ] **Step 4: Verify + commit**

Run: `bun scripts/run-tests.mjs test/frontend/keyboard-help` (if a test exists; otherwise skip) and `npx eslint frontend/src/js/ui/keyboard-help.ts`.

```bash
git add frontend/src/js/ui/keyboard-help.ts .agents/skills/edit-ui docs/superpowers/specs/2026-10-04-ui-refresh-roadmap.md docs/CURRENT_STATUS.md
git commit -m "docs: view/edit mode keys and status (#86)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: E2E

**Files:**
- Modify: `e2e/helpers/studio-selectors.mjs` (Undo/redo block, ~line 84)
- Modify: `e2e/helpers/flows.mjs` (new helpers after `saveDraft`, ~line 279)
- Modify: `e2e/specs/17-undo-redo.spec.js`
- Create: `e2e/specs/27-edit-mode.spec.js`

**Interfaces:**
- Produces: selectors `editModeButton`, `dropToFloorButton`, `resetTransformButton`, `lockFloorToggle`, `unsavedMarker`, `assetMeta`; flows `enterEditMode(page)`, `firstAnchorState(page)`, `perturbFirstAnchor(page, { dx?, dy?, rotateZ? })`.

- [ ] **Step 1: Selectors**

Add to `SELECTORS` next to `undoButton`:

```js
  // View / Edit mode (viewport toolbar) + unsaved marker (header)
  editModeButton: "#editModeBtn",
  dropToFloorButton: "#dropToFloorBtn",
  resetTransformButton: "#resetTransformBtn",
  lockFloorToggle: "#lockFloorBtn",
  unsavedMarker: "#saveAssetBtn.has-unsaved",
  assetMeta: "#assetStatusMeta",
```

- [ ] **Step 2: Flow helpers**

In `e2e/helpers/flows.mjs` after `saveDraft`:

```js
/**
 * Enter Edit mode via the viewport toolbar button.
 * @param {Page} page
 */
export async function enterEditMode(page) {
  await page.click(SELECTORS.editModeButton);
  await expect(page.locator(SELECTORS.editModeButton)).toHaveText("Done");
}

/**
 * World-space facts about the first model anchor (`anchor_<node_id>`) in the
 * main Babylon scene: lowest point, bounds centre, rotation w, scale.
 * @param {Page} page
 */
export async function firstAnchorState(page) {
  return page.evaluate(() => {
    const scenes = BABYLON.EngineStore.Instances[0].scenes;
    const scene = scenes.find((s) => s.transformNodes.some((n) => n.name.startsWith("anchor_")));
    const a = scene.transformNodes.find((n) => n.name.startsWith("anchor_"));
    a.computeWorldMatrix(true);
    const { min, max } = a.getHierarchyBoundingVectors(true);
    return {
      minY: min.y,
      cx: (min.x + max.x) / 2,
      cz: (min.z + max.z) / 2,
      qw: a.rotationQuaternion ? Math.abs(a.rotationQuaternion.w) : 1,
      sx: a.scaling.x,
    };
  });
}

/**
 * Directly perturb the first model anchor (test setup only — simulates a
 * floating/rotated legacy placement without a pointer drag).
 * @param {Page} page
 * @param {{ dx?: number, dy?: number, rotateZ?: number }} change
 */
export async function perturbFirstAnchor(page, change) {
  await page.evaluate(({ dx = 0, dy = 0, rotateZ = 0 }) => {
    const scenes = BABYLON.EngineStore.Instances[0].scenes;
    const scene = scenes.find((s) => s.transformNodes.some((n) => n.name.startsWith("anchor_")));
    const a = scene.transformNodes.find((n) => n.name.startsWith("anchor_"));
    a.position.x += dx;
    a.position.y += dy;
    if (rotateZ) {
      a.rotationQuaternion = BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(0, 0, 1), rotateZ);
    }
    a.computeWorldMatrix(true);
  }, change);
}
```

- [ ] **Step 3: Migrate spec 17**

In `e2e/specs/17-undo-redo.spec.js`, import `enterEditMode` alongside `connectStudio, generate`, and add `await enterEditMode(page);` right after the outliner node click (before `scaleSectionSummary`). Rename nothing else.

Find any other spec that relied on old behaviour:

```bash
grep -rln "transform-tool\|data-mode=\"translate\"\|data-mode=\"rotate\"\|data-mode=\"scale\"\|press(\"g\")\|press('g')\|scaleFactorInput" e2e/specs
```

Every hit other than spec 17 and `timeModeButton` users (time stays in View) gets `enterEditMode(page)` before its placement interaction.

- [ ] **Step 4: New spec 27**

`e2e/specs/27-edit-mode.spec.js`:

```js
import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  connectStudio,
  generate,
  saveDraft,
  enterEditMode,
  firstAnchorState,
  perturbFirstAnchor,
} from "../helpers/flows.mjs";

test.describe("view / edit mode", () => {
  test("view by default; edit grounds, resets, and marks unsaved until saved", async ({ page }) => {
    await connectStudio(page);
    // No asset open → nothing to edit.
    await expect(page.locator(SELECTORS.editModeButton)).toBeHidden();

    const cid = await generate(page, "cowboy");
    await page.click(SELECTORS.outlinerSwitcherBtn);
    await page.locator(SELECTORS.outlinerNode).first().click();

    // View mode: selection shows no placement tools.
    await expect(page.locator(SELECTORS.editModeButton)).toBeVisible();
    await expect(page.locator(SELECTORS.dropToFloorButton)).toBeHidden();
    await expect(page.locator(SELECTORS.timeModeButton)).toBeVisible();

    await enterEditMode(page);
    await expect(page.locator(SELECTORS.lockFloorToggle)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(SELECTORS.timeModeButton)).toBeHidden();

    // Drop to floor: a floating model lands on Y = 0 and the asset is dirty.
    await perturbFirstAnchor(page, { dy: 5 });
    await page.click(SELECTORS.dropToFloorButton);
    expect((await firstAnchorState(page)).minY).toBeCloseTo(0, 3);
    await expect(page.locator(SELECTORS.assetMeta)).toContainText("Unsaved changes");
    await expect(page.locator(SELECTORS.unsavedMarker)).toBeVisible();

    // Reset: rotation identity, centred on X/Z, grounded, scale kept.
    const before = await firstAnchorState(page);
    await perturbFirstAnchor(page, { dx: 3, rotateZ: 0.6 });
    await page.click(SELECTORS.resetTransformButton);
    const reset = await firstAnchorState(page);
    expect(reset.qw).toBeCloseTo(1, 4);
    expect(reset.cx).toBeCloseTo(0, 3);
    expect(reset.cz).toBeCloseTo(0, 3);
    expect(reset.minY).toBeCloseTo(0, 3);
    expect(reset.sx).toBeCloseTo(before.sx, 6);

    // Leaving Edit keeps the staged edits; Save draft clears the marker.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("e");
    await expect(page.locator(SELECTORS.editModeButton)).toHaveText("Edit");
    await expect(page.locator(SELECTORS.assetMeta)).toContainText("Unsaved changes");

    await saveDraft(page, cid);
    await expect(page.locator(SELECTORS.assetMeta)).not.toContainText("Unsaved changes");
    await expect(page.locator(SELECTORS.unsavedMarker)).toHaveCount(0);
  });
});
```

- [ ] **Step 5: Run the affected specs**

The E2E harness reuses any backend on :9090 — make sure no stale dev backend is running (memory: stale backend → generate fails with upload-url HTTP 500).

Run: `bun run test:e2e -- --project=chromium e2e/specs/27-edit-mode.spec.js e2e/specs/17-undo-redo.spec.js e2e/specs/04-parametric-version.spec.js`
Expected: all pass. Then `git checkout -- blockchain/deployments`.

If `firstAnchorState` picks a utility-layer scene or the wrong anchor (multi-node mock models), narrow it: pick the anchor whose `getChildMeshes().length > 0`.

- [ ] **Step 6: Commit**

```bash
git add e2e/helpers/studio-selectors.mjs e2e/helpers/flows.mjs e2e/specs/17-undo-redo.spec.js e2e/specs/27-edit-mode.spec.js
git commit -m "test(e2e): view/edit mode, drop to floor, reset, unsaved marker (#86)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Full verification + PR

- [ ] **Step 1: Lint + typecheck + build**

```bash
npx tsc --noEmit -p frontend/tsconfig.json
bun run typecheck
bun run lint
(cd frontend && bun run build)
```

Expected: all clean.

- [ ] **Step 2: Unit suites**

Run: `bun run test 2>&1 | grep -E "^FAIL" | cut -d' ' -f2 | sort`
Expected: exactly the baseline set (Global Constraints). Any new file in the list is a regression from this branch — fix before continuing.

- [ ] **Step 3: Full E2E**

Run: `bun run test:e2e -- --project=chromium`
Known order-dependent flakes: `18-chat-provenance`, `25-public-profile` — rerun solo if only those fail. Then `git checkout -- blockchain/deployments`.

- [ ] **Step 4: Browser check (1440×900)**

`./scripts/start-dev.sh`, Playwright MCP with the Hardhat provider init script (`e2e/fixtures/hardhat-provider.mjs` via `page.addInitScript`). Generate an asset, select it, and confirm: no gizmo in View; Edit shows Move with only the floor-plane handle + X/Z arrows (no Y arrow); a Move drag snaps by grid cells; Alt-drag is smooth; Rotate snaps in 15° steps and the model re-grounds on release; Lock to floor off restores the Y arrow; header shows `· Unsaved changes`; the Save dot is visible in both Graphite and Paper themes. Screenshots go to the worktree `.playwright-mcp/` (they land in the main checkout cwd — move them).

If Babylon 9.12's sub-gizmo `isEnabled` or `snapDistance` setters behave differently than assumed (e.g. the Y arrow still shows), fix `_applyGizmoConstraints` against the live API and add a note to "As built".

- [ ] **Step 5: Rebase, push, PR**

```bash
git fetch -q origin
git rebase origin/main   # picks up #109 if merged since Task 0
git push -u origin feat/view-edit-mode
gh pr create --base main --title "feat(ui): view / edit mode with snap-to-ground placement (#86)" --body "<summary + test plan; closes #86; ends with the Claude Code attribution line>"
```

Merging is the user's call — do not run `gh pr merge`.

- [ ] **Step 6: As built + handover**

Append an "As built" section to this plan (deviations, verification numbers). Update `.worktrees/HANDOVER-ui-refresh-phase2.md`: #86 PR number, epic status (all 20 sub-issues implemented once #109 and this PR merge).
