# View / Edit Mode — Design (UI refresh Phase 5, issue #86)

**Date:** 2026-10-04 · **Status:** approved in brainstorm · **Issue:** #86 · **Epic:** #87

## 1. Why

Arbesk is an asset repository with a viewer, not a modeller. Today, selecting
any node attaches the Move gizmo straight away, so a casual click-drag while
inspecting an asset changes its placement. Visitors and signed-out users can
drag models they can never save, and a stray press on the scale handles
silently changes a print-ready part's dimensions in mm.

This phase makes the Studio **view by default**. An explicit Edit toggle shows
placement tools built around how printable objects are actually placed:
locked to the floor, snapped to the grid, rotated in 15° steps. A visible
"Unsaved changes" marker tells the user when staged edits exist.

## 2. What exists

- `ui/transform-gizmo.ts` (563 lines) — Babylon `GizmoManager`, top toolbar
  (Move T / Rotate R / Scale S / Time V), side strip (Undo / Redo / Grid),
  keyboard T/R/S/V, group-pivot multi-selection transforms, drag-start/end
  undo capture. `NODE_SELECTED` → `setMode("translate")` attaches the gizmo
  on every selection.
- `engine/scene-graph.ts` keydown — Esc, Home, 0, F, and **G → `toggleGrid()`**.
- `engine/transforms.ts` — `stageNodeTransform`, `readNodeTransformMatrix`,
  `applyTransformMatrix`, `matricesEqual`.
- `engine/undo-stack.ts` / `undo-controller.ts` — `pushUndoEntry({type:"transform"})`;
  undo re-stages but never unstages.
- Pending (unsaved) state lives in `state.pendingTransformEdits`,
  `pendingChildRefs`, `pendingChildRefRemovals`, `pendingPostProcessorEdits`,
  `pendingSourceOverrides`; cleared in `engine/cleanup.ts`. There is no
  single "dirty" query or event.
- `ui/asset-chrome.ts` — sole writer of the header title/meta
  (`v<N> · Draft|Published`) and Save/Publish visibility (`hasAsset && hasWallet`).
- Inspector `#scaleSection` — numeric uniform scale (`#nodeScaleFactor`,
  `#nodeScalePercent`), wired in `engine/parametric-preview.ts`; E2E spec 17
  drives it.
- Ground grid: 40 units, 20 subdivisions (2-unit cells), auto-scaled to the
  model by `scene-camera.ts` (`groundGrid.scaling.x`).
- `ui/keyboard-help.ts` lists `G — Toggle grid & axes`.

## 3. Decisions (locked in brainstorm)

1. **Gate scope:** Edit gates **placement only** (transform gizmo, placement
   actions, Inspector scale fields). Chat/AI edits, file drops, child removal
   work in either mode as today. **The Edit toggle is unavailable when the
   user cannot save** (no asset, no wallet, or library visitor).
2. **Keyboard:** **E** toggles Edit. In Edit: **T** Move, **R** Rotate,
   **G** Drop to floor, **Shift+R** Reset transform. Grid becomes
   **button-only** (no key). **S** and the scale tool are removed. **V**
   (time) works in both modes. T/R/G/Shift+R are no-ops in View mode — they
   never auto-enter Edit.
3. **Scale:** no scale gizmo at all. Scaling only via the Inspector numeric
   field, editable in Edit mode only.
4. **Snap-to-ground:** grounded by default — Move drags on the floor plane
   only with the selection's lowest point at Y = 0; grid-cell move snap; 15°
   rotate snap; **Alt** held disables snapping; a **Lock to floor** toggle
   (default on) unlocks free Y movement.
5. **Leaving Edit with unsaved changes:** keep them staged, no dialog; the
   "Unsaved changes" marker stays and Save works from View mode.
6. **Reset transform:** placement only — rotation identity, bounds centred at
   X/Z = 0, grounded; **scale untouched**.

## 4. Architecture

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `state/edit-mode.ts` (new) | `isEditing()`, `setEditing(bool)`, `toggleEditing()`, `canEdit()`, `subscribe(fn)`. Owns the can-edit rule and auto-exit. | asset store, wallet state, library state, event bus |
| `engine/placement.ts` (new) | Pure math: selection world bounds, ground delta, reset target, snap steps. No DOM. | Babylon types only |
| `engine/group-pivot.ts` (new, extracted) | The existing group-pivot code moved out of `transform-gizmo.ts` unchanged (`_ensureGroupPivot`, `_attachToGroupPivot`, `_startGroupDrag`, `_applyGroupDrag`, `_endGroupDrag`, `_disposeGroupPivot`, `_topLevelSelectedAnchors`). | `state.ts` |
| `ui/transform-gizmo.ts` (modified) | Toolbar rendering per mode, gizmo attach only while editing, floor lock, snapping, Alt override, G / Shift+R actions, keyboard. | edit-mode, placement, group-pivot, transforms, undo-stack |
| `engine/cleanup.ts` (modified) | `hasUnsavedChanges()`, `notifyPendingEditsChanged()`. | state, event bus |
| `ui/asset-chrome.ts` (modified) | Renders the unsaved marker; re-renders on `PENDING_EDITS_CHANGED`. | cleanup |
| `engine/parametric-preview.ts` (modified) | Disables the Inspector scale inputs outside Edit. | edit-mode |
| `@arbesk/asset-core` bus (modified) | New `EVENTS.PENDING_EDITS_CHANGED: "pending:editsChanged"`. | — |

The extraction of group-pivot is required, not cosmetic: the fallow
pre-commit gate blocks changes that push `transform-gizmo.ts` over the
CRAP/cyclomatic threshold.

## 5. Modes & toolbar

**View mode** — the default, and the state after every asset or version load.
Selecting highlights the node and fills the Inspector; **no gizmo attaches**.

```
top:   [Edit (E)] [Time (V)]
side:  [Undo] [Redo] [Grid]
```

**Edit mode** — Move is the active tool on entry.

```
top:   [Move T] [Rotate R] │ [Lock to floor ✓] [Drop to floor G] [Reset ⇧R] │ [Done (E)]
side:  [Undo] [Redo] [Grid]
```

- The Edit/Done control is one `button` with `aria-pressed`; its visible
  label switches "Edit" ↔ "Done", accessible name "Edit placement (E)".
- Lock to floor is an `aria-pressed` toggle button.
- Drop to floor and Reset are disabled (`disabled` attribute) with no
  selection; Move/Rotate are disabled with no selection (as today).
- Both toolbars keep `role="toolbar"`; Undo/Redo/Grid are always visible
  (undo also covers non-placement edits).
- Inspector `#nodeScaleFactor` / `#nodeScalePercent` are `disabled` in View
  mode, with the hint text "Switch to Edit to change scale." shown in place
  of the existing hint.

**Can-edit rule:** `canEdit() = hasAsset && hasWallet && !isLibraryVisitor()`
(same `hasAsset` definition as `asset-chrome.ts`). The Edit button is
`hidden` when false. When `canEdit()` turns false while editing, Edit exits;
staged changes are kept (decision 5).

**Reset to View:** `SCENE_CLEARED` (asset open, version navigation, New)
sets `isEditing = false`.

**Time mode interplay:** V works in both modes. Entering Edit leaves Time
mode (detaches the model-clock ring). Pressing V while editing exits Edit and
enters Time. The two never share the gizmo.

**Mid-drag exit:** if Edit exits while `state.isGizmoDragging`, the drag-end
staging and undo push run first, then the gizmo detaches.

## 6. Placement mechanics

**Selection bounds** (`placement.ts`): world-space AABB over the meshes of
the **top-level** selected anchors (anchors with no selected ancestor — the
rule group-pivot already uses). Grid chrome (`groundGrid`, `axisX`, `axisZ`)
is never part of a node's meshes. Empty bounds (no meshes) → grounding is a
no-op.

**Lock to floor (default on; per session, not persisted):**

- *Move:* only the XZ plane handle (`positionGizmo.yPlaneGizmo`) and the
  X/Z arrows are enabled; the Y arrow and the XY/YZ plane handles are
  disabled. At drag start, if the selection's min Y ≠ 0 (legacy or floating
  asset), it is grounded first; that correction is part of the same undo
  entry. Y cannot change during the drag, so it stays grounded.
- *Rotate:* free rotation on all rings. On drag end the selection is
  re-grounded (min Y → 0) inside the same undo entry as the rotation.
- *Lock off:* all position handles enabled, no automatic grounding on move
  or rotate. G still works.

**Snapping:**

- Move snap distance = `2 × groundGrid.scaling.x` (the visible cell).
- Rotate snap = 15° (`Math.PI / 12`).
- While **Alt** is held during a drag, snap distances are 0; restored on Alt
  keyup, drag end, or window `blur` (so a stuck modifier can't leave snapping
  off).

**Drop to floor (G):** translate the selection by `(0, −minY, 0)`.
Multi-selection moves as one rigid group by the group's min Y (stacking
preserved). Undo label "Drop to floor".

**Reset transform (Shift+R):** for each top-level selected anchor
independently: rotation → identity, then translate so its bounds centre is at
X/Z = 0, then ground. Scale untouched. Multiple selected nodes overlap at the
origin — the honest result; one Ctrl+Z restores. Undo label "Reset transform".

**Persistence & undo:** every placement change goes through
`stageNodeTransform` + one `pushUndoEntry({type:"transform", label, items})`
per user action (Move, Rotate, Drop to floor, Reset transform). No new
manifest fields.

## 7. Unsaved state

**Query:** `hasUnsavedChanges()` in `engine/cleanup.ts` — true when any of
`pendingTransformEdits`, `pendingChildRefs`, `pendingChildRefRemovals`,
`pendingPostProcessorEdits`, `pendingSourceOverrides` is non-empty.

**Signal:** `notifyPendingEditsChanged()` emits
`EVENTS.PENDING_EDITS_CHANGED`. It is called at every site that writes to or
clears those collections (the plan enumerates them by grep), including the
clears in `cleanup.ts` and the post-save clear.

**Clearing:** the marker clears on Save draft, Publish, or asset/version
reload. Undoing back to the original does **not** clear it (undo re-stages;
save-point tracking is out of scope). Pessimistic, never falsely clean.

**Display** (`asset-chrome.ts` remains the sole writer):

- Header meta gains a third segment: `v3 · Draft · Unsaved changes`; with no
  versions yet, `Draft · Unsaved changes`.
- Save draft gets a small accent dot (`.has-unsaved` class) and accessible
  name "Save draft (unsaved changes)". The text segment is the primary cue,
  so colour is never the only one (WCAG 1.4.1).
- No live-region announcement per edit; the existing "Draft saved."
  announcement covers the clear.

**Tab close / reload:** a `beforeunload` listener calls
`e.preventDefault()` only when `hasUnsavedChanges()` is true and no save is
in flight. The existing in-app confirms (New / open another asset) are
unchanged.

## 8. Keyboard map

| Key | View | Edit |
|-----|------|------|
| E | Enter Edit (if `canEdit()`) | Exit Edit |
| T | — | Move tool |
| R | — | Rotate tool |
| G | — | Drop to floor |
| Shift+R | — | Reset transform |
| V | Time mode | Exit Edit → Time mode |
| Alt (held, during drag) | — | Disable snapping |
| S | — (removed) | — (removed) |

Unchanged: Esc, Home, 0, F, Ctrl/Cmd+Z / Shift+Z. The existing editable-focus
guard (inputs, textareas, selects, buttons, contenteditable) applies to all
keys. The G case is removed from `scene-graph.ts`; the Shift+R handler sits
in the same listener as the other transform keys.

## 9. Removals & migrations

- Scale tool button, `S` key, and `gizmoManager.scaleGizmoEnabled` usage
  removed; `TransformMode` drops `"scale"`. `_MODE_LABELS.scale` goes.
- `scene-graph.ts` `case "g"` removed; grid button `aria-label`/`title`
  become "Toggle grid and axes" (no key hint).
- `NODE_SELECTED` no longer calls `setMode("translate")` outside Edit.
- `keyboard-help.ts`: drop the G grid row; add E, T, R, G (Drop to floor),
  Shift+R, Alt-to-disable-snap.

## 10. E2E

- New spec `e2e/specs/<next>-edit-mode.spec.js`:
  - after load, selecting a node attaches no gizmo
    (`state.gizmoManager.attachedNode === null` via `page.evaluate`);
  - Edit button hidden when signed out;
  - signed in: E → Edit; G grounds the selection (anchor world min Y ≈ 0);
    header meta contains "Unsaved changes"; Save draft clears it;
  - Shift+R → rotation identity, bounds centre X/Z ≈ 0, scale unchanged.
- Helpers/selectors: `enterEditMode(page)` in `e2e/helpers/flows.mjs`;
  selectors `editModeButton`, `dropToFloorButton`, `resetTransformButton`,
  `lockFloorToggle`, `unsavedMarker` in `studio-selectors.mjs`.
- Migrations: spec 17 (Inspector scale) enters Edit first; any spec relying
  on select-attaches-gizmo, the scale tool, or the G grid key is migrated —
  the plan finds them by grep.

## 11. Testing (unit, `test/frontend/`)

- `placement.test.js` — ground delta (single, multi rigid group), reset
  target (centre X/Z 0, grounded, scale preserved), snap step = 2 × grid
  scale, nested-anchor exclusion, empty bounds no-op.
- `edit-mode.test.js` — toggle + notify; `canEdit()` false for no wallet /
  visitor / no asset; losing can-edit exits; `SCENE_CLEARED` resets to View.
- `unsaved-changes.test.js` — `hasUnsavedChanges()` per collection; notify
  emits the event; `beforeunload` prevents only when dirty and not saving.
- Transform keyboard — View: T/R/G/Shift+R no-ops; E toggles; S does
  nothing; V works in both modes; G never toggles the grid.

## 12. Out of scope

- Scale gizmo (any form).
- Numeric position/rotation fields.
- Persisting Lock to floor across sessions.
- Save-point dirty tracking (marker clearing on undo-to-saved).
- Gating chat/AI edits, file drops, child removal, or nesting behind Edit.

## 13. Risks

- **Babylon sub-gizmo toggles** (`xGizmo`/`yGizmo`/`zGizmo`, plane gizmos)
  are created lazily — lock state must be re-applied after `setMode` creates
  them, same pattern as `ensureDragEndSubscription`.
- **Group drags + floor lock:** grounding must shift the pivot's group as a
  whole, not each anchor, or stacked parts separate.
- **E2E blast radius:** many specs select nodes; any that assumed a gizmo
  appears on selection will fail until migrated. Run the full suite, not
  only the new spec.
- **Branch base:** this branch starts from `origin/main` before PR #109
  (version timeline) merged; rebase onto `main` once it lands — the V-key /
  model-clock path is untouched by #109, so no conflicts are expected in
  `transform-gizmo.ts`.
