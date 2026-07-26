# Studio Undo/Redo — Design

Date: 2026-07-26
Status: Approved (brainstorm complete)

## Goal

Add undo/redo to the Arbesk Studio 3D editor for **transform edits (move/scale/rotate via gizmo, single + group selection) and parametric color edits**, unified into a single chronological stack behind Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y plus toolbar buttons.

Explicitly **not** backed by time travel / version history: that machinery is per-saved-manifest (IPFS fetch + full `clearScene()`/`loadAssetManifest()` reload per step) and only exists after Save. Undo must cover unsaved, in-session edits with instant in-place restore.

## Decisions locked during brainstorm

1. **Scope**: transforms + color edits, one unified stack. The existing color-only stack in `parametric-preview.js` is folded in. Add/delete node, nesting changes — out of scope.
2. **Lifetime**: stack survives Save Draft/Publish; cleared on scene load and time-travel jumps (`loadVersion()` rebuilds the scene from a manifest, making old entries meaningless). Undoing past a save point is fine — the next Save serializes current scene state as a new manifest, which is already how Save works.
3. **UI**: keyboard shortcuts + undo/redo buttons in the existing viewport toolbar (`createToolbar()` in `transform-gizmo.js`), disabled when the respective stack is empty. `keyboard-help.js` updated.
4. **Architecture**: snapshot (memento) stack, not a command pattern — for TRS/colors the inverse of "set state X" is "restore previous state X", so commands collapse into snapshots with extra ceremony.

## Existing primitives reused

- `stageNodeTransform(nodeId)` / `applyTransformMatrix(anchor, matrix)` (`frontend/src/js/engine/transforms.js`) — serialize/restore local TRS as a 16-element column-major matrix, and sync `state.pendingTransformEdits`.
- `ensureDragEndSubscription()` (`frontend/src/js/ui/transform-gizmo.js:380`) — `onDragStartObservable`/`onDragEndObservable` give clean gesture boundaries, including group drags via `_startGroupDrag()`/`_endGroupDrag()`.
- Color undo internals in `frontend/src/js/engine/parametric-preview.js` (`_applyUndoEntry`, push-on-picker-close behavior) — kept, but its private `undoStack`/`redoStack` and its Ctrl+Z keydown handler (:604) are removed in favor of the shared stack/dispatcher.
- `state.isGizmoDragging` guard, `state.nodeAnchors`, `state.pendingTransformEdits`, `state.pendingPostProcessorEdits` (`frontend/src/js/engine/state.js`).
- Store/event pattern in `frontend/src/js/state/create-store.js` for change notification.

## Components

### 1. `frontend/src/js/engine/undo-stack.js` (new)

Headless, scene-agnostic stack — single source of truth:

```js
pushEntry({ type, label, nodeIds, before, after })  // clears redo stack
undo()  // pops entry (moves to redo stack), returns it; null if empty
redo()  // pops redo entry (moves back), returns it; null if empty
canUndo() / canRedo()
clear()
onChange(cb)  // notifies toolbar button state
```

- Entry: `{ type: 'transform' | 'color', label, nodeIds: [...], before: [...], after: [...] }`; `before`/`after` hold one item per node (16-float matrix, or RGBA color object for color entries).
- `MAX_UNDO = 50` (module constant, UPPER_SNAKE per conventions; matrices are 16 floats so memory is negligible).

### 2. `frontend/src/js/engine/undo-controller.js` (new)

Glue that applies entries to the live scene:

- **Transform**: for each `nodeId` → `state.nodeAnchors.get(nodeId)` → `applyTransformMatrix(anchor, matrix)` → `stageNodeTransform(nodeId)` so `pendingTransformEdits` reflects the undone/redone state (Save then writes it).
- **Color**: apply via the logic currently in `parametric-preview.js` `_applyUndoEntry` (exported or moved), and sync `pendingPostProcessorEdits`.
- Owns the **single** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y keydown handler with the standard editable-focus guard (same pattern as existing handlers). Removes the color-only handler in `parametric-preview.js`.
- Ignores undo/redo while `state.isGizmoDragging` is true.
- Missing nodeId (node no longer in scene): skip that node, apply the rest, never throw.
- New push clears the redo stack (standard invalidation).

### 3. Capture points

- **Gizmo**: in `ensureDragEndSubscription()` — at drag start, snapshot each selected anchor's matrix (group drag: every anchor in the group); at drag end, snapshot `after` and push one entry. Skip push if matrices are unchanged (click without drag).
- **Inspector scale fields** (already call `stageNodeTransform`): push on field commit.
- **Color picker**: `parametric-preview.js` pushes color entries into the shared stack, keeping push-on-picker-close semantics (not per input event).

### 4. Toolbar + keyboard help

- Undo/redo icon buttons in the viewport toolbar next to T/R/S/V, enabled/disabled via `canUndo()`/`canRedo()` change notifications; `title` tooltips use the entry label ("Undo move").
- `keyboard-help.js`: generalize the undo description from color-only to scene edits; add Ctrl+Y.

### 5. Lifecycle

- `clear()` on scene load/`clearScene()` (via the `SCENE_READY` bus event the version store already uses) and explicitly from `version-history-store.js` `loadVersion()`.
- Survives Save Draft/Publish.

## Error handling

- Missing anchors on apply → skip node, continue, no throw.
- Undo/redo during active drag → ignored.
- Stacks are in-memory only; nothing persisted to IPFS.

## Testing

- **Jest** (`test/frontend/`, matching existing patterns): push/undo/redo/cap/clear; unchanged-drag no-op; group multi-node entry restores all anchors; interleaved color+transform chronological order; keydown dispatcher focus guard and drag guard; `pendingTransformEdits` sync after undo; redo invalidation on new push; missing-node skip.
- **E2E sync** (per edit-ui skill): add toolbar buttons to `e2e/helpers/studio-selectors.mjs`; spec: gizmo-move → Ctrl+Z → position restored; button disabled states.

## Out of scope

- Undo for add/delete node, nesting/hierarchy changes.
- Persisting the undo stack (IPFS, IndexedDB).
- Any change to time travel / version clocks themselves.
