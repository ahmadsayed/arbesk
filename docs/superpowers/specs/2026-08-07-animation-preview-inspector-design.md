# Animation Preview in the Inspector — Design

Date: 2026-08-07
Status: Approved (user review of decisions: preview-only, select-plays-looped with "None")

## Goal

When a selected node's model contains glTF animations, the Studio Inspector
("Properties" sidebar) lists them in a dropdown. Selecting one plays it looped
in the viewport; "None" stops playback. Purely ephemeral preview — nothing is
persisted to the manifest.

## Decisions (confirmed with user)

- **Preview-only.** No manifest/schema change, no version-chain implications.
  Persistence of a chosen clip can be a follow-up phase.
- **Controls = one dropdown.** Selecting a clip plays it looped immediately;
  the first option "None" stops playback. No play/stop buttons, no speed
  slider, no scrubbing.
- **Static viewport by default.** Babylon's glTF loader auto-starts the first
  animation on import (`animationStartMode` defaults to `FIRST`). The loader is
  configured with `GLTFLoaderAnimationStartMode.NONE` so loaded assets stay
  still until the user picks a clip.

## Current state (from codebase exploration)

- Inspector markup: `frontend/src/pug/app.pug:311-379` — sections follow
  `section.inspector-section` + `details > summary.inspector-section-title`
  (see `#scaleSection`, `app.pug:338-349`). Controller:
  `frontend/src/js/engine/parametric-preview.js` (`openInspector` at `:312`).
- `ImportMeshAsync` results' `animationGroups` are discarded in
  `frontend/src/js/engine/scene-loader.js:66-84` (`importFromBlob`). Babylon's
  glTF loader still adds them to `scene.animationGroups`, but there is no
  per-node handle. No `AnimationGroup` usage exists in app code.
- Animations survive save: the decomposer keeps `animations`/`skins` inline
  (`frontend/src/js/gltf/decomposer.js:12`).
- Selection events: `EVENTS.NODE_SELECTED` / `SELECTION_CHANGED` on the event
  bus (`frontend/src/js/events/bus.js:41-48`), emitted from
  `frontend/src/js/engine/scene-selection.js:52-77`.
- Inspector sections hide under multi-select via `showMultiSelectSummary()`
  (`parametric-preview.js:293-305`).
- Select styling: `.form-select` (`frontend/src/scss/components/_forms.scss:18-62`).
- State maps live in `frontend/src/js/engine/state.js` (`nodeMeshes`,
  `nodeAnchors` at `:20-22`).

## Design

### 1. Capture animation groups per node

- Extend `importFromBlob()` (`scene-loader.js`) to return
  `result.animationGroups` alongside `meshes`/`transformNodes`.
- Add `nodeAnimationGroups: Map<string, BABYLON.AnimationGroup[]>` to
  `frontend/src/js/engine/state.js`, next to `nodeMeshes`.
- Populate it in the `loadAsset`/`attachMetadata` path (`scene-loader.js:86-116`)
  for every loaded node.
- Clean it up wherever `nodeMeshes` entries are removed (node delete/dispose
  paths), and `dispose()` the groups on node removal so scene state stays
  clean.
- Set `animationStartMode` to `NONE` on the glTF loader plugin (via
  `BABYLON.SceneLoader.OnPluginActivatedObservable` in the engine setup), so
  nothing auto-plays. Verify the exact constant name against the pinned
  Babylon CDN version (`frontend/src/js/engine/babylon-loader.js:14-15`)
  during implementation.

### 2. Inspector UI

- New section in `app.pug`, modeled on `#scaleSection`:

  ```pug
  section#animationsSection.inspector-section(hidden)
    details(open)
      summary.inspector-section-title Animations
      .inspector-section-body
        select#animationSelect.form-select
          option(value="") None
  ```

- No SCSS changes expected — `.inspector-section` and `.form-select` cover it.

### 3. Playback controller — `frontend/src/js/engine/animation-preview.js` (new)

Small module, wired from the same place `parametric-preview.js` is wired:

- Subscribes to `NODE_SELECTED` (single select) and `SELECTION_CHANGED`
  (multi-select / deselect).
- On single selection of a node with `nodeAnimationGroups` entries:
  - show `#animationsSection`, populate `#animationSelect` with the group's
    names (fallback `Animation N` for unnamed groups), select "None";
  - stop any previously playing preview first.
- On selection change / deselect / multi-select: stop the playing group, hide
  the section, reset the select.
- On `change` of `#animationSelect`: stop the current group; if a clip is
  chosen, `group.start(true)` (looped). "None" = stop only.
- On node removal (listen to the same event the state-map cleanup uses, or
  clean up defensively on selection change): stop and reset.
- Never restarts/stops groups belonging to other nodes' previews — only one
  preview plays at a time by construction.

### 4. Out of scope

- Chat-preview bubbles (`chat-preview.js`) keep their current behavior (their
  own `makeImportFromBlob` also drops groups; unchanged).
- No persistence, no speed control, no timeline/scrubber, no per-version
  animation metadata.

## Error handling

- Model with zero animations → section stays hidden (no empty dropdown).
- Unnamed animation groups → labeled `Animation 1..N`.
- Group disposal while playing (node deleted mid-preview) → stop/reset is
  handled by the selection-change cleanup; disposal is safe on a stopped group.
- A group that fails to `start()` → catch, log a warning, reset select to
  "None".

## Testing

- **Unit (new)** `test/frontend/animation-preview.test.js` — jsdom +
  hand-mocked Babylon following `test/frontend/chat-preview.test.js`:
  - section hidden for animation-less node, shown for animated node;
  - select populated with group names + "None" first;
  - selecting a clip calls `start(true)`; switching clips stops the previous;
  - "None" stops; deselect/multi-select stops + hides;
  - `animationStartMode = NONE` applied on loader activation.
- **Unit (extend)** scene-loader coverage: `animationGroups` returned by
  `importFromBlob` land in `state.nodeAnimationGroups`; cleanup on node
  removal.
- **E2E sync** (AGENTS.md §10): add `animationsSection` / `animationSelect`
  selectors to `e2e/helpers/studio-selectors.mjs`; spec asserting the section
  appears and preview plays for an animated fixture GLB (mock Tripo
  rig/animate result or a rigged GLB from `mock-gltf-assets/`).
- **Verification**: `npm run typecheck:frontend`, `npm run lint`,
  `npm run test:frontend`; E2E chromium critical path before merge.
