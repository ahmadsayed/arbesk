# Model Clock Gizmo Redesign — Design

**Date:** 2026-07-07  
**Status:** Design spec awaiting approval  

## Summary

The current model clock (`frontend/src/js/ui/model-clock.js`) is a small DOM/SVG dial that floats above the selected node’s bounding box. It works, but users report it feels detached from the model — more like a floating label than a manipulation gizmo.

This redesign replaces the DOM model clock with a **true 3D Babylon mesh gizmo** — a version ring that orbits the selected node at its pivot, scales with the model’s bounds, and invites direct spatial interaction. The scene clock (bottom-right DOM/SVG watch face) is **unchanged** because it is a global, asset-level control that does not need to feel attached to a single model.

## Goals

1. Make the per-node version control as immediately readable as the translate/rotate/scale gizmo.
2. Anchor the control *on* the model, not above it.
3. Provide a clear grab affordance (a draggable handle on a ring).
4. Preserve all existing behavior: filtered per-node versions, commit reloads the whole scene, hides during transform drags, keyboard accessible.
5. Keep the scene clock intact and keep E2E coverage at 33/33 or better.

## Non-goals

- Redesign the scene clock.
- Add per-node independent chains; the model clock remains a filtered lens over the single asset chain.
- Add branching history visualization.

## Decisions made during brainstorm

| Question | Decision |
|----------|----------|
| Visual metaphor | 3D ring gizmo with draggable handle (spatial/arc), replacing the floating clock dial |
| Anchoring | Centered at the selected node’s pivot/origin, ring plane horizontal (world Y-up) |
| Ring size | Radius = `(max(bbox.x, bbox.z) / 2) * RING_RADIUS_FACTOR` (half-extent) with min/max clamps so it always encircles the model without dominating the view |
| Rendering | Babylon mesh gizmo (`MeshBuilder.CreateTorus`, tick meshes, draggable handle sphere), `renderingGroupId = 1` so it draws on top |
| Coexistence with T/R/S | Auto-appears when a node is selected and has >1 filtered versions; hidden while transform gizmo is being dragged; transform gizmo remains the primary spatial tool |
| Activation | No toolbar button or mode switch by default; ring is contextual like the transform gizmo. Optional `V` hotkey toggles focus/visibility when a node is selected |
| Drag interaction | Drag handle along the ring; angle maps to version index (newest at 0°, clockwise into the past). Live preview badge follows cursor; commit on release if version changed |
| Wheel/keyboard | Wheel over the ring steps ±1; arrow keys step when the gizmo or viewport has focus; Home/End jump to oldest/newest |
| Accessibility | `role="slider"`, `aria-valuenow`, `aria-valuetext` on a focusable invisible proxy or on the handle mesh via a companion DOM element |

## Architecture

### Removed / replaced

- `frontend/src/js/ui/model-clock.js` — DOM projection logic removed. The module is rewritten as the Babylon gizmo controller.
- `frontend/src/scss/components/_version-clock.scss` — `.model-clock` host rules removed; `.scene-clock` rules preserved.
- `frontend/src/js/engine/scene-graph.js` — replace the dynamic `import("../ui/model-clock.js")` call with `import("../ui/model-clock-gizmo.js")` and call `initModelClockGizmo(scene, camera)` alongside `initTransformGizmo(scene, camera)`.

### New / changed modules

#### 1. `frontend/src/js/ui/model-clock-gizmo.js` (new)

Babylon-based version ring gizmo controller.

Responsibilities:

- Create/destroy the ring mesh group per selection change.
- Position/scale the ring at the selected node’s anchor each frame.
- Render ticks and a draggable handle.
- Map handle angle to version index and commit via `version-history-store.loadVersion()`.
- Hide while `state.isGizmoDragging` is true and while no node is selected.
- Expose `initModelClockGizmo(scene, camera)` (called once from `scene-graph.js`).

Mesh structure (per selected node):

```
modelClockRoot (TransformNode, parented to selected node anchor)
├── ringMesh          (Torus, horizontal, radius from bounds)
├── tickMeshes[]      (Small spheres or short cylinders at tick angles)
├── publishedMarker   (Highlighted tick mesh or green torus segment)
├── handleMesh        (Sphere with PointerDragBehavior)
└── badgeHost         (Invisible TransformNode; its screen position drives a DOM badge)
```

Ring geometry:

- Plane: world XZ (horizontal). This keeps the ring readable from typical orbit-camera angles and avoids fighting with the vertical T/R/S gizmo handles. It will appear edge-on from a top-down camera; that is acceptable because the primary Studio camera is orbit-style at an oblique angle.
- Radius: `clamp(max(bbox.x, bbox.z) * 1.4, 0.5, 8.0)` in world units. Use the node’s bounding box computed from `state.nodeMeshes`.
- Tube thickness: ~2–4% of radius.
- Visual differentiation from the rotation gizmo: neutral chrome ring (not RGB axes), discrete tick dots instead of continuous colored bands, and a single draggable knob rather than three axis rings.

Ticks:

- One marker per filtered version.
- Evenly distributed clockwise, newest at 0° (world +X, i.e. 3 o’clock) or 12 o’clock. Use the same convention as `version-clock.js` if possible: newest at 12 o’clock running clockwise into the past. For a horizontal ring, 12 o’clock = world -Z.
- Active tick: handle sits on it. Published tick: green tint/ring.

Handle interaction:

- `PointerDragBehavior` on `handleMesh`.
- On drag, project pointer onto the ring plane, compute signed angle from ring center, snap to nearest tick angle, move handle to that tick, and live-update a floating badge/label.
- On drag end, commit if the snapped version differs from the active version.
- Hide the ring while dragging the transform gizmo; conversely, disable pointer events on the version ring while transform gizmo is active? No — they coexist, but the version ring hides during transform drags to avoid visual clutter.

State integration:

```js
import * as store from "../state/version-history-store.js";

const filtered = store.versionsForNode(selectedNodeId);
const activeIdx = filtered.findIndex(e => e.cid === store.getState().activeCid);
const publishedIdx = filtered.findIndex(e => e.cid === store.getState().publishedCid);
```

Disposal:

- `scene.onBeforeRenderObservable` callback removed on deselect.
- All created meshes and materials disposed via `dispose()`.

#### 2. `frontend/src/js/ui/version-clock.js` (minor change)

Keep the reusable SVG face for the **scene clock**. The model clock no longer uses it. No breaking changes.

#### 3. `frontend/src/scss/components/_version-clock.scss` (minor change)

Remove `.model-clock` host rules. The scene clock styling remains.

#### 4. `frontend/src/js/engine/scene-graph.js` (wiring change)

Import and call `initModelClockGizmo(scene, camera)` alongside `initTransformGizmo(scene, camera)`. The order should be transform gizmo first, then version ring, so event wiring is predictable.

#### 5. `frontend/src/js/app-init.js`

No change; model-clock initialization is already driven from `scene-graph.js`.

## Interaction summary

| Input | Behavior |
|-------|----------|
| Select node with history | Ring fades in around the node pivot |
| Drag handle on ring | Live preview badge, handle snaps to ticks, commit on release if changed |
| Scroll wheel over ring | Step ±1 version, commit after short debounce |
| Arrow keys (viewport focused, node selected) | Step ±1 version, commit immediately |
| Home / End | Oldest / newest version, commit immediately |
| Transform gizmo drag starts | Version ring hidden; reappears when drag ends |
| Deselect / empty scene | Ring disposed/hidden |
| `V` key | Toggle version ring visibility for the selected node (fallback if users want it off) |

## Visual design

- Ring color: `--dim-fg` or a neutral chrome color so it does not compete with the colored T/R/S axes.
- Active tick/handle: `--accent-bg`.
- Published tick: `--green-4` (same as the current published ring).
- Badge: small label floating near the handle showing `vN` and the version name.
- Opacity: ~0.85 when idle, ~1.0 on hover/drag.
- Thickness and tick size scale slightly with ring radius so the gizmo remains readable for tiny and huge models.

## Error handling

- **Node has no filtered versions:** no ring shown (same as current `hidden` behavior).
- **Selected node disposed mid-frame:** hide ring, do not throw.
- **`loadVersion` fails:** snap handle back to active version’s tick, clear loading state.
- **Camera behind ring plane:** ring is 3D, so it naturally occludes/occludes-by-model; `renderingGroupId = 1` keeps it visible on top of the selected mesh but it can still be hidden by other UI decisions if needed.

## Accessibility

Because Babylon mesh objects are not focusable DOM elements, keyboard control is wired to the viewport when a node is selected:

- Arrow keys, Home, and End always route to the selected node’s version ring if it is visible.
- A small hidden DOM focus proxy (`<div id="modelClockFocusProxy" role="slider" tabindex="0">`) is updated with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-valuetext` each time the handle moves. Screen-reader users hear version changes even though the handle is a mesh.
- Focus can be moved to the proxy with the `V` hotkey.

## Badge / feedback

- A DOM badge (reusing the existing model-clock badge styling but simplified) floats at the screen-space position of the handle.
- Badge text: `vN` + optional short name.
- The badge is updated each frame by projecting the `badgeHost` transform node to screen space, similar to the current model-clock projection loop.
- The badge hides during transform-gizmo drags along with the ring.

## Testing

Per CLAUDE.md this touches Studio UI + parametric editing, so E2E is required before merge.

### Unit (Jest, `test/frontend/`)

- Delete or rewrite `test/frontend/model-clock.test.js` to test the new Babylon gizmo:
  - Ring created/destroyed on select/deselect.
  - Ring radius derived from mocked bounding box.
  - Handle angle maps to correct version index.
  - Drag end calls `store.loadVersion()` with correct CID.
  - Ring hidden while `state.isGizmoDragging` is true.
  - Disposal removes all meshes.
- Keep `test/frontend/scene-clock.test.js` unchanged.
- Keep `test/frontend/version-clock.test.js` unchanged (scene clock still uses it).

### E2E (`e2e/specs/04-parametric-version.spec.js`)

- Update model-clock selector(s) to target the Babylon canvas-based gizmo (may require pixel/canvas assertions or a test-only data attribute exposed on the handle mesh).
- Preserve the existing flow: select node → verify filtered version count → scrub to older version → assert scene reload.
- Add a case verifying the ring hides during a transform-gizmo drag.
- Update `e2e/helpers/studio-selectors.mjs` if needed.

### Gate

- `npm run test:all`
- `npm run test:e2e -- --project=chromium` must pass at 33/33 or better.

## Out of scope

- Rewriting the scene clock.
- Babylon GUI `AdvancedDynamicTexture` (keep mesh-based for simplicity unless badge legibility requires GUI).
- Touch-specific gestures beyond pointer events.
- Multi-select version rings.

## Migration notes

The existing `model-clock.js` implementation is short (164 lines) and self-contained. The new module replaces it entirely but consumes the same store API (`store.versionsForNode`, `store.getState().activeCid`, `store.getState().publishedCid`, `store.loadVersion`) and emits the same user-level behavior, so the rest of the app should not need changes beyond wiring.
