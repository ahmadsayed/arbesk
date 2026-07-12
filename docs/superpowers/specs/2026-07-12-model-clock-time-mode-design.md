# Model Clock: Time Mode + Gizmo-Style Polish — Design

**Date:** 2026-07-12
**Status:** Approved
**Supersedes:** parts of `2026-07-07-model-clock-gizmo-redesign-design.md` (the always-on ring becomes a toolbar mode)

## Problem

The current model clock ring (`frontend/src/js/ui/model-clock-gizmo.js`) feels unpolished:

- Ring, ticks, and handle are lit `StandardMaterial` spheres rendered in the main
  scene — they look like shaded blobs, unlike the flat, unlit, always-on-top
  Babylon transform gizmos, and can z-fight with or hide behind the model.
- Nothing communicates how many versions exist or which direction along the
  ring is newer vs. older.
- Dragging the handle uses `PointerDragBehavior` with a **world-Z** drag plane;
  when the node's anchor is rotated or scaled the plane no longer matches the
  ring, so the handle fights the cursor. A scaled anchor also double-scales the
  ring (radius is computed from world bounds, then parented under the scaled
  anchor).
- The always-visible ring competes for space with the move/rotate/scale gizmos.

## Decision

Make the model clock a **fourth transform mode** — Move (T) / Rotate (R) /
Scale (S) / **Time (V)** — and rebuild its visuals and drag behavior in the
style of Babylon's built-in gizmos.

## Design

### 1. Toolbar and mode wiring (`transform-gizmo.js`)

- Add a fourth button to `#transformToolbar` with a clock icon in the existing
  16×16 stroke-SVG style: `data-mode="time"`, label/title "Time (V)".
- Keyboard shortcut `V` (T/R/S are taken).
- `setMode("time")` disables all three Babylon gizmos
  (`positionGizmoEnabled = rotationGizmoEnabled = scaleGizmoEnabled = false`),
  sets `state.transformMode = "time"`, and emits a new bus event
  `EVENTS.TRANSFORM_MODE_CHANGED: "transform:modeChanged"` with
  `{ mode }`. All `setMode()` calls emit the event so the clock can react to
  every mode change, not just entry into Time mode.
- Toolbar active-state logic treats "time" like any other mode.

### 2. Clock lifecycle (`model-clock-gizmo.js`)

- The ring is built only when `state.transformMode === "time"` **and** a node
  is selected (and the version chain has ≥ 2 entries, as today).
- Subscribes to `TRANSFORM_MODE_CHANGED` in addition to the existing
  `NODE_SELECTED` / `NODE_DESELECTED` / `SCENE_CLEARED` / `SCENE_EMPTY` and the
  version-history store.
- Switching to Move/Rotate/Scale disposes the ring and hides the badge.
- The old "hide while the transform gizmo is dragging" plumbing
  (`state.isGizmoDragging` checks in `render()`) is removed — modes are
  mutually exclusive, so the clock and transform gizmos never coexist.

### 3. Rendering: utility layer + flat gizmo materials

- All clock meshes move to
  `BABYLON.UtilityLayerRenderer.DefaultUtilityLayer.utilityLayerScene` — the
  same layer the transform gizmos render on — so the ring always draws on top
  of the model. `renderingGroupId` hacks are dropped.
- The clock root is **not parented to the anchor**. Each frame (utility-scene
  `onBeforeRenderObservable`) it copies the anchor's world position and
  rotation only. The radius stays computed from world-space bounds. This fixes
  the double-scaling bug for scaled anchors.
- Materials are flat and unlit: `emissiveColor` set, `disableLighting = true`,
  `diffuseColor`/`specularColor` black — matching Babylon gizmo materials.

### 4. Geometry restyle

- **Ring:** thin torus (as today), unlit gray.
- **Ticks:** the spheres become **radial tick marks** — thin flat boxes
  oriented along the ring's radius, like clock minute marks. Colors: gray =
  other versions, accent blue = active, green = published. Mesh names keep the
  `versionTick-<i>` prefix.
- **Handle:** the sphere becomes a small flat **lozenge** seated on the ring,
  oriented tangent to the circle. Unlit accent blue; on pointer-over it
  switches to Babylon's gizmo hover yellow and the canvas cursor becomes
  `grab` (`grabbing` while dragging). Mesh name stays `versionHandle`.
- **Arrowhead:** a small flat chevron/cone on the ring just past the newest
  tick, pointing along the "toward newer" tangent direction. Same gray as the
  ring. New mesh name `versionArrow`.
- Mesh names `versionRing`, `versionHandle`, `versionTick-*` are unchanged so
  existing tests keep working.

### 5. Drag rework (PlaneRotationGizmo-style)

Replace `PointerDragBehavior` with manual pointer handling on the utility
layer scene:

- Pointer-down on the handle: detach camera controls, set `grabbing` cursor.
- Pointer-move: intersect the pick ray with the **ring's world plane**
  (derived from the clock root's world matrix), convert the hit point to ring
  local space, `atan2` → angle, and place the handle on the circle. A small
  lerp on the angle smooths the motion. The nearest tick is live-highlighted
  (existing `dragHoverIdx` behavior).
- Pointer-up: snap to the nearest tick; if it differs from the active version,
  call `store.loadVersion(entry.cid)`. Reattach camera controls, restore
  cursor.

Angle/index math (`_angleForIndex`, `_indexForAngle`, `_ringRadiusFromBounds`)
is unchanged.

### 6. Keyboard stepping scoped to Time mode

ArrowLeft/Right/Up/Down/Home/End version stepping fires only while
`state.transformMode === "time"` (today it fires whenever a node is selected).

### 7. Badge

The DOM badge (`#modelClockBadge`, `vN` text, follows the handle via
projection) is unchanged in behavior but only exists/shows in Time mode.

## Testing

- **Jest** (`test/frontend/model-clock-gizmo.test.js`): fixtures enter Time
  mode (set `state.transformMode` / emit `TRANSFORM_MODE_CHANGED`); assertions
  updated for tick boxes instead of spheres, the new `versionArrow` mesh, and
  pointer-observable drag instead of `PointerDragBehavior`. Angle-helper unit
  tests unchanged.
- **Jest** (`test/frontend/transform-gizmo` coverage): fourth toolbar button,
  `V` shortcut, event emission.
- **E2E** (`e2e/specs/04-parametric-version.spec.js`): clicks the Time toolbar
  button before asserting the badge; new selector in
  `e2e/helpers/studio-selectors.mjs` (`timeModeButton:
  '#transformToolbar [data-mode="time"]'`).
- Gate: `npm run typecheck:frontend`, `npm run test:frontend`, then
  `npm run test:e2e -- --project=chromium` (Studio UI change → E2E required
  per CLAUDE.md).

## Out of scope

- Version labels on ticks, hover tooltips, and a "v3 / 7" counter badge
  (declined during design).
- Any change to the version-history store or manifest chain semantics.
