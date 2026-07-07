# Version Clock Gizmo — Design

**Date:** 2026-07-07
**Status:** Approved design, pending implementation plan

## Summary

Replace the headerbar version scrubber (`#assetHistory` linear slider) with two
clock-style gizmos rendered as DOM/SVG overlays in the Studio viewport:

1. **Scene clock** — fixed bottom-right, scrubs the whole asset's manifest chain.
2. **Model clock** — floats above the currently selected node, scrubs the *same*
   chain filtered to versions where that node changed.

Both use a clock-hand face: one tick per version around the dial, newest at
12 o'clock running clockwise into the past, a draggable hand, and a green
marker on the on-chain (published) version.

## Decisions made during brainstorm

| Question | Decision |
|----------|----------|
| Face style | Clock hand with per-version ticks (over arc-slider and orbit-dots) |
| Anchoring | Model clock: projected 3D position, constant screen size. Scene clock: fixed viewport overlay |
| Data model | One chain (the asset manifest chain). Model clock is a filtered lens; committing any version reloads the whole scene |
| Visibility | Model clock only while a node is selected; scene clock whenever the chain is non-empty |
| Scene clock placement | Bottom-right, collapsed "watch face" (~32 px) that expands to a scrubbable dial (~96 px) on hover/focus/click |
| Rendering approach | DOM/SVG overlays in `#viewport` (over canvas drawing or Babylon GUI) — SCSS-token theming, native pointer events, accessibility via `role="slider"` |
| Headerbar scrubber | Removed entirely (`#assetHistory` markup, SCSS, and `asset-history.js` as a UI file) |

## Architecture

### Removed

- `#assetHistory` block in `frontend/src/pug/app.pug` (slider, badge, popover)
  and its headerbar SCSS.
- `frontend/src/js/ui/asset-history.js` — logic moves to the store (below);
  the file is deleted.

### New modules

#### 1. `frontend/src/js/state/version-history-store.js` (headless store)

The logic half of today's `asset-history.js`, moved with behavior preserved:

- State: `chainCache`, `chainRootCid`, `activeCid`, `publishedCid`,
  `isLoading`, `isHistoryNavigation`.
- `loadVersion(cid)` — including the `preservedLatest` dance around
  `clearScene()` and the `isHistoryNavigation` guard semantics (flag stays true
  until `loadAssetManifest()` resolves; no fixed timeouts).
- `_refresh()` — parallel fetch of chain (`walkManifestChain`) and published
  CID (`contract.methods.tokenURI`).
- All five bus subscriptions: `SCENE_READY`, `WALLET_CONNECTED`,
  `ASSET_PUBLISHED`, `ASSET_DRAFT_SAVED`, `SCENE_EMPTY`.
- New: `subscribe(fn)` so views re-render on any state change, and
  `versionsForNode(nodeId)` returning the filtered entry list.

**Chain entry extension.** `walkManifestChain` (in
`frontend/src/js/engine/time-travel.js`) already fetches every manifest in the
chain. Each chain entry gains a `nodes` map:

```js
nodes: { [node_id]: { sourceCid, postProcessor } } // postProcessor: stable snapshot (JSON) of the node's post_processor
```

`versionsForNode(nodeId)` = versions where the node's snapshot differs from the
previous version's snapshot, plus the version where the node first appears.
A node unchanged since v1 yields exactly one entry (its introduction).

#### 2. `frontend/src/js/ui/version-clock.js` (reusable face component)

Pure view. Given `{ entries, activeIndex, publishedIndex, loading }`, renders
the SVG dial and emits callbacks:

- `onScrub(index)` — live preview while dragging (no load).
- `onCommit(index)` — user landed on a version.

Rendering rules:

- N entries divide 360° evenly; newest at 12 o'clock, clockwise into the past.
  Hand at 12 always means "on the latest version".
- Past ~24 versions, tick marks thin visually (every k-th full-size, others as
  dots); the snap grid stays per-version. Chain walk caps at 50 (existing
  `maxDepth`).
- Center: version badge (`v6`) + detail line (`name · nodes · date`) —
  replaces today's popover.
- Published tick ringed green; when active == published, badge tints green
  (today's `.published`).
- Loading: hand pulses + spinning ring on the dial rim (today's `.loading`).
- Accessibility: `role="slider"`, `aria-valuetext` = `Version N`, focusable,
  arrow keys step (commit immediately, matching the old range input),
  Home/End jump to oldest/newest.

#### 3. `frontend/src/js/ui/scene-clock.js` (fixed watch face)

- Bottom-right of `#viewport` (bottom-left = transform toolbar, top-right =
  orientation gizmo).
- Collapsed: ~32 px face, hand + version badge only.
- Expands to ~96 px scrubbable dial on hover/focus/click; collapses on
  mouse-leave, Escape, or blur.
- Hidden when the chain is empty (same rule as today's scrubber).
- Feeds the full chain to a `version-clock` instance; commit →
  `store.loadVersion()`.

#### 4. `frontend/src/js/ui/model-clock.js` (selection-following)

- Shows on `NODE_SELECTED`, hides on `NODE_DESELECTED` / `SCENE_EMPTY`.
- Same collapsed→expand pattern as the scene clock.
- Entries: `store.versionsForNode(nodeId)`. Center badge shows the *global*
  version number (ticks are a subset of the same chain).
- Position: each frame in `scene.onBeforeRenderObservable`, project the
  top-center of the node's bounding box (union of `getNodeMeshes(nodeId)`
  bounds) with `BABYLON.Vector3.Project`, set a CSS `transform` on the
  overlay element. Constant screen size (no perspective scaling).
- Hidden while a transform-gizmo drag is in progress (subscribe to the gizmo
  drag observables already used in `transform-gizmo.js`), and when the
  projected point is off-screen/behind the camera.
- Commit reloads the whole scene at that version (single-chain model).

#### 5. `frontend/src/scss/components/_version-clock.scss`

Tokens from the existing system (`--surface-overlay`, accent/success colors,
`--size-*` spacing). Light/dark themes come free. Respect reduced-motion for
the pulse/spin animations.

### Wiring

`frontend/src/js/app-init.js` — replace the `asset-history.js` import with
the store + `scene-clock.js` + `model-clock.js`. (Module side-effect-init
pattern matches the current codebase.)

## Interaction summary

| Input | Behavior |
|-------|----------|
| Drag hand / press dial rim | Pointer angle → nearest tick; badge + detail update live; commit on release if version changed |
| Scroll wheel over clock | Step ±1; commit after ~400 ms debounce |
| Arrow keys (focused) | Step ±1, commit immediately |
| Home / End | Oldest / newest, commit |
| Hover/focus/click collapsed face | Expand |
| Mouse-leave / Escape / blur | Collapse |

The drag-preview vs release-commit split preserves today's `input` vs `change`
semantics: no version load fires mid-drag.

## Error handling

- **Chain fetch fails** (`walkManifestChain` throws): store keeps an empty
  chain, both clocks hidden, error logged — same as today.
- **`loadVersion` fails**: alert with the error (today's behavior), hand snaps
  back to `activeCid`'s tick, `.loading` cleared in `finally`.
- **Published CID unavailable** (no wallet/token): no green marker — clocks
  still function.
- **Node meshes missing** (disposed mid-frame, load race): model clock hides
  for that frame instead of throwing.
- **Projection behind camera / off-viewport**: model clock hidden until the
  point is visible again.

## Testing

Per CLAUDE.md this touches Studio UI + parametric editing, so E2E is required
before merge.

- **Unit (Jest, `test/frontend/`):**
  - `version-history-store.test.js` — chain state transitions,
    `isHistoryNavigation` guard, `versionsForNode` filtering (changed /
    unchanged / first-appearance / single-version cases), subscriber
    notifications.
  - `version-clock.test.js` — tick geometry (angle per index), snap-to-tick
    from pointer angle, published/loading classes, ARIA attributes, keyboard
    stepping, commit-on-release vs live-scrub callbacks.
  - `time-travel` test update — chain entries now carry the `nodes` map.
  - Update `test/frontend/wallet-exports.test.js` (references
    `asset-history`/`historySlider`) and build tests asserting `app.pug`
    structure — `#assetHistory` is gone, clock roots exist.
- **E2E (`e2e/specs/04-parametric-version.spec.js`):** rewrite the scrubber
  interactions to drive the scene clock (expand → keyboard-step → assert scene
  reload), and add a model-clock case: select a node, verify the filtered tick
  count, scrub to a version, assert whole-scene reload.
- **Gate:** `npm run test:all` + `npm run test:e2e -- --project=chromium`.

## Out of scope (YAGNI)

- Per-child-asset version chains (per-node time travel with independent
  chains) — explicitly deferred; the model clock is a filtered lens only.
- Branching history visualization (the chain is linear).
- Touch-specific gestures beyond what pointer events give us.
- Reusing the clock on the Library page.
