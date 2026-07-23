# Multi-Select with Group Transforms — Design

Date: 2026-07-23
Status: Approved-by-default (auto permission mode; key decisions flagged inline)

## Goal

Let the user select multiple scene nodes in the Studio and move, rotate, and
scale them together as a group. Per-node time-travel (the "Time" mode / model
clock gizmo) is **not** available for multi-selections.

## Decisions (defaults chosen; each is reversible)

1. **Selection UX — both viewport and outliner.** Ctrl/Cmd+click toggles a
   node in/out of the selection, in the 3D viewport (picked mesh → `nodeId`)
   and in the outliner rows. Plain click = single select (current behavior).
   Empty-space click and Escape clear the selection.
2. **Group pivot — centroid.** The gizmo sits at the centroid (mean of the
   selected anchors' world positions). Rotate/scale happen around that shared
   pivot, Blender "median point" style — not around each node's own origin.
3. **Scope — manifest scene nodes only.** Multi-select works on nodes that
   have a `node_id` in the current asset's `scene.nodes` (including linked
   `child_ref` instances). Sub-mesh selection and diving into child worlds are
   unchanged and remain single-selection concepts.
4. **Time mode gating.** The Time toolbar button is disabled when the
   selection size ≠ 1, and the model clock gizmo only builds for a single
   selected node. The scene-wide clock (bottom-right dial) is unaffected — it
   is asset-scoped, not selection-scoped.
5. **Inspector.** The parametric inspector opens only for single selections.
   For multi-selections it shows a compact "N nodes selected" hint instead of
   per-node material controls.

## Architecture

The persistence layer already supports this: `state.pendingTransformEdits` is
a `Map<nodeId, number[16]>` and `prepareManifestForWrite()` applies every
entry to the node's `transform_matrix`. All work is in selection state, the
gizmo layer, and the outliner.

### Selection state

- `state.selectedNodeIds: Set<string>` (new, `engine/state.js`) — the full
  selection. `state.highlightedNodeId` stays as the **primary** (last-added)
  node so existing single-node consumers (sub-mesh toggle, inspector,
  comments, model clock) keep working untouched when size === 1.
- `engine/scene-selection.js` gains `toggleNodeSelection(nodeId, mesh)`;
  `selectNode` resets the set to `{nodeId}`; `deselectAll` clears it.
  Highlight fan-out: every selected node's meshes go into the existing
  `HighlightLayer` (amber). Primary node keeps the current glow; no new
  visual language.
- New event `SELECTION_CHANGED { nodeIds: string[] }` in `events/bus.js`.
  `NODE_SELECTED` / `NODE_DESELECTED` keep firing (primary node) so current
  listeners don't need to change.

### Pointer & outliner

- `engine/scene-graph.js` POINTERPICK handler: if `ctrlKey || metaKey`, call
  `toggleNodeSelection` instead of `selectNode`; modifier + click on an
  already-selected node removes it. The child-world boundary rules (pick
  walks up to the owning `child_ref` anchor) apply unchanged.
- `ui/outliner.js`: rows track a `Set`; Ctrl/Cmd+click toggles, plain click
  single-selects; all selected rows get `.selected`.

### Group gizmo

- `ui/transform-gizmo.js`: when `selectedNodeIds.size > 1` and mode is
  translate/rotate/scale, the `GizmoManager` attaches to a synthetic pivot
  `BABYLON.TransformNode` (not parented to any anchor) placed at the
  selection centroid.
- On drag start: snapshot `pivotWorldInv` and, per selected anchor,
  `rel_i = pivotWorldInv × anchorWorld_i`.
- During drag (each frame while `isGizmoDragging`):
  `anchorWorld_i' = pivotWorld' × rel_i`, converted back into the anchor's
  parent space and decomposed into position/rotationQuaternion/scaling.
- On drag end: every selected anchor is captured into
  `pendingTransformEdits` (same `matrixToManifestArray` path as today), so
  Save/Publish persists all of them with no manifest-builder changes.
- The pivot node is disposed on deselect/scene clear.

### Time-mode gating

- `transform-gizmo.js` `setMode()`/`updateToolbarUI()`: Time button disabled
  with a tooltip when selection size > 1; switching into a multi-selection
  while in Time mode falls back to translate.
- `ui/model-clock-gizmo.js`: build only when `selectedNodeIds.size === 1`
  (existing `transformMode === "time"` gate extended).

### Frame-selected & Select-All

- `f` / `frameSelected`: with a multi-selection, frame the combined bounding
  box of all selected nodes' meshes.
- `Ctrl+A` (when the Studio viewport has focus and no text input is active):
  selects all nodes in the current asset's `scene.nodes`.

## Files touched

| File | Change |
|------|--------|
| `frontend/src/js/engine/state.js` | `selectedNodeIds` Set |
| `frontend/src/js/events/bus.js` | `SELECTION_CHANGED` event |
| `frontend/src/js/engine/scene-selection.js` | toggle/multi-aware select, highlight fan-out |
| `frontend/src/js/engine/scene-graph.js` | modifier-click picking, `f` framing |
| `frontend/src/js/ui/transform-gizmo.js` | pivot node, drag fan-out, per-node capture, Time gating |
| `frontend/src/js/ui/outliner.js` | multi-select rows |
| `frontend/src/js/ui/model-clock-gizmo.js` | single-selection gate |
| `frontend/src/js/engine/parametric-preview.js` | multi-select summary state |
| `frontend/src/js/engine/scene-camera.js` | frame combined bounds |

## Testing

- Jest: selection-set unit tests (toggle semantics, primary tracking,
  deselect), pivot relative-matrix math (pure function, mocked BABYLON
  Matrix), Time-mode gating, per-node `pendingTransformEdits` capture.
  Existing suites must pass unchanged (`npm test`).
- E2E (follow-up): ctrl+click two nodes, group-move, save draft, assert both
  `transform_matrix` entries updated in the manifest.

## Out of scope (YAGNI)

- Box/rubber-band selection (conflicts with camera-orbit drag; needs gesture
  disambiguation + screen-space bounds testing), group delete, multi-node
  parametric edits, scaling around individual origins as a mode toggle.
