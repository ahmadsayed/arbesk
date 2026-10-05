# Deep Dive — Arbesk Studio UI / UX

Full UI architecture: stack, directory map, studio shell, interaction principles, state management, event flow, Babylon.js integration, and SCSS conventions.

## 1. Project UI Architecture at a Glance

### Stack

| Layer | Tech | Notes |
|---|---|---|
| Markup | Pug (`frontend/src/pug/`) | `app.pug` slim shell that `include`s `frontend/src/pug/includes/*.pug` partials; `index.pug` for landing |
| Styling | Component SCSS (`frontend/src/scss/components/`) | Imported via `styles.scss` with `@use` |
| Behavior | Vanilla ES modules (`frontend/src/js/`) | **No bundler** — copied as-is into `dist/` |
| 3D Engine | Babylon.js (CDN) | `BABYLON` is a global — never `import` it |
| Build | Custom Node scripts (`frontend/scripts/`) | Pug → HTML, SCSS → CSS, JS copy, assets copy |

### Directory Map

| Path | Role |
|---|---|
| `frontend/src/pug/app.pug` | SPA shell — includes partials from `frontend/src/pug/includes/*.pug`; real markup lives in the partials |
| `frontend/src/pug/index.pug` | Landing/marketing page |
| `frontend/src/scss/components/_viewport.scss` | 3D viewport + gizmo + drop indicator |
| `frontend/src/scss/components/_headerbar.scss` | Header bar (top) |
| `frontend/src/scss/components/_sidebar.scss` | Left rail: library, outliner |
| `frontend/src/scss/components/_inspector.scss` | Right rail: selection inspector |
| `frontend/src/scss/components/_chat.scss` | Chat panel + prompt input (bottom) |
| `frontend/src/scss/components/_bottombar.scss` | Status bar |
| `frontend/src/scss/styles.scss` | Imports all component files |
| `frontend/src/js/engine/scene-graph.ts` | Babylon engine, scene, camera, selection, keyboard |
| `frontend/src/js/engine/state.ts` | Shared mutable `state` object |
| `frontend/src/js/engine/cleanup.ts` | `clearScene()` with chrome preservation |
| `frontend/src/js/engine/parametric-preview.ts` | Inspector live editing (color/scale) |
| `frontend/src/js/engine/time-travel.ts` | Version history / manifest chain |
| `frontend/src/js/engine/placeholders.ts` | Loading/error placeholders for token children |
| `frontend/src/js/ui/viewport-gizmo.ts` | 2D X/Y/Z orientation overlay (top-right) |
| `frontend/src/js/ui/asset-library.ts` | Gallery of saved assets (left sidebar) |
| `frontend/src/js/ui/asset-drop-zone.ts` | Drop target for dragged gallery cards |
| `frontend/src/js/ui/chat-messages.ts` | Chat / studio editor surfaces |
| `frontend/src/js/ui/chat-history.ts` | Chat provenance / history rendering |
| `packages/asset-core/src/domain/version-history-store.ts` | Version history state store (feeds scene/model clocks) |
| `frontend/src/js/ui/version-clock.ts` | Shared SVG clock face component |
| `frontend/src/js/ui/scene-clock.ts` | Scene-level version clock |
| `frontend/src/js/ui/model-clock-gizmo.ts` | Per-model version clock gizmo |
| `frontend/src/js/ui/asset-save.ts` | Save Draft / Publish wiring |
| `frontend/src/js/ui/create-panel.ts` | "New asset" dialog flow |
| `frontend/src/js/ui/outliner.ts` | Scene graph tree in left sidebar |
| `frontend/src/js/ui/sidebar.ts` | Sidebar show/hide logic |
| `frontend/src/js/ui/ledger-panel.ts` | Activity feed panel (client-side manifest chain walk) |
| `frontend/src/js/blockchain/wallet-core.ts` | MetaMask / WalletConnect / CDP wallet connection logic |
| `frontend/src/js/blockchain/wallet.ts` | Wallet barrel re-export |
| `frontend/src/js/blockchain/token-resolver.ts` | `child_ref` → manifest CID resolution |
| `frontend/src/js/services/api.ts` | Backend API client (generation, save, publish) |
| `frontend/src/js/services/url-utils.ts` | Query string helpers |
| `frontend/src/js/ipfs/remote-ipfs.ts` | Browser-side IPFS reads via backend |
| `packages/asset-core/src/formats/gltf/gltf-core.ts` | GLTF buffer URI ↔ CID translation and manifest compose helpers |

### Build & Verify Workflow

```bash
# After any frontend change:
cd frontend && bun run build

# Or from root:
bun run build:frontend

# Output: frontend/dist/
# Backend serves frontend/dist/ at http://localhost:9090
```

Always rebuild before testing in the browser. The backend does **not** serve `src/` — only `dist/`.

---

## 2. The Studio Shell (top to bottom)

```
┌────────────────────────────────────────────────────────────┐
│ headerbar  [back] [New] [title] [history] [Save] [Pub] [💳]│  ← header bar
├──────┬─────────────────────────────────────────────┬───────┤
│      │                                             │       │
│ left │              3D viewport                    │ right │
│ side │            (Babylon canvas)                 │ insp- │
│ bar  │   • gizmo top-right                         │ ector │
│ lib/ │   • grid (40×40 wireframe, α 0.3)          │ panel │
│ out- │   • drop indicator on drag                 │       │
│ liner│                                             │       │
│      │                                             │       │
├──────┴─────────────────────────────────────────────┴───────┤
│ messagebar [prompt input........................] [send] │
├────────────────────────────────────────────────────────────┤
│ bottombar  [status] [provider]               [history]    │
└────────────────────────────────────────────────────────────┘
```

### Layout CSS

- `.viewport` → `flex: 1`; the canvas clear colour comes from `--viewport-bg` (a neutral stage, a step apart from the panels in both themes)
- Sidebars are collapsible; `Ctrl+B` toggles left sidebar
- Inspector starts `.collapsed` and is shown when a node is selected

### Header Bar Conventions

Every action button in the header has:
- `aria-label` for screen readers
- `title` with keyboard shortcut hint (e.g., `title="New asset (Ctrl+N)"`)
- Inline SVG icons, no icon font
- `btn-secondary` for nav, `btn-primary` for the primary action (Publish)

```pug
button#newAssetTopBtn.btn.btn-secondary.btn-sm.headerbar-new(
  aria-label="New asset",
  title="New asset (Ctrl+N)")
  svg(width="16" height="16" ...)
  span New
```

---

## 3. Interaction Principles

> Design authority is WCAG 2.2 AA → web conventions (WAI-ARIA APG) → the Arbesk design language; see SKILL.md. GNOME HIG layout ideas below are non-binding heuristics.

### 3.1 Minimal Chrome (no visual clutter)

The 3D viewport shows: a 40×40 wireframe ground grid (opaque, `--viewport-grid`), a 2D X/Y/Z orientation gizmo in the top-right corner, and a dashed drop indicator on drag. **No in-scene axis cylinders, no view cube, no toolbar overlay.** All viewport chrome carries `metadata.isViewportChrome = true` so `clearScene()` preserves it.

### 3.2 Keyboard — pragmatic, not exhaustive

**Not "every action has a key."** A shortcut earns its place only if it's frequent, not browser-owned, and documented in `ui/keyboard-help.ts` (`Ctrl+/`). Current bindings:

| Key | Action | Module |
|---|---|---|
| `F` | Frame selected | `engine/scene-graph.ts` |
| `Home` | Frame all | `engine/scene-graph.ts` |
| `0` | Reset view (forget saved camera pose) | `engine/scene-graph.ts` |
| `E` | Enter / leave Edit mode | `ui/transform-gizmo.ts` + `state/edit-mode.ts` |
| `T` / `R` | Move / rotate (Edit only) | `ui/transform-gizmo.ts` |
| `G` | Drop to floor (Edit only) | `ui/transform-gizmo.ts` |
| `Shift+R` | Reset transform, keeps scale (Edit only) | `ui/transform-gizmo.ts` |
| `V` | Time travel (both modes) | `ui/transform-gizmo.ts` |
| `Esc` | Deselect | `engine/scene-graph.ts` |
| `Ctrl+B` | Toggle sidebar | `ui/sidebar.ts` |
| `Ctrl+1–5` | Switch sidebar panel | `ui/sidebar.ts` |
| `Alt+←` | Ascend to parent asset | `ui/nesting.ts` |
| `Ctrl+N` / `Ctrl+S` | New asset / Save draft | `engine/scene-graph.ts` / `ui/asset-save.ts` |
| `Delete` / `Backspace` | Unlink selected child | `engine/child-remove.ts` |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo | `engine/undo-controller.ts` |
| `Ctrl+A` | Select all scene nodes | `engine/scene-graph.ts` |
| `Ctrl+/` | Keyboard help | `ui/keyboard-help.ts` |

The viewport is **perspective-only** — there are no `1/3/7` ortho view shortcuts (see "Ortho mode" below).

**Consolidation debt**: shortcuts are ~20 separate `document` listeners across ~17 modules, each re-implementing the `editable` guard. New chords route through the shared dispatcher (see `references/checklists.md` §8); do not add another listener. Every handler **must** skip when focus is in an `<input>`, `<textarea>`, `<select>`, or `contentEditable`.

### 3.3 Responsive Feedback (no silent state changes)

Selection feedback is the **HighlightLayer** outer glow in the theme's `--selection` colour (`readViewportTheme()`; ≥ 3:1 on `--viewport-bg`, re-coloured live on `THEME_CHANGED`):

- `state.highlightLayer` is created once during `initEngine()`
- `selectNode(nodeId, mesh)` clears the previous highlight and adds the new node's meshes
- `deselectAll()` clears the highlight, resets `state.highlightedNodeId`, dispatches `node:deselected`
- `closeInspector()` (in `parametric-preview.ts`) calls `deselectAll()` so re-clicking the same mesh re-opens the inspector

Camera framing uses `BABYLON.Animation.CreateAndStartAnimation` for smooth 300ms transitions — never snap instantly.

### 3.4 Direct Manipulation (Blender-style interaction)

- Click mesh in viewport OR click row in outliner → both highlight + select
- `attachMetadata` walks up the parent chain to find the root with `metadata.nodeId`
- Outliner's `selectNode(nodeId)` dispatches `outliner:nodeSelected` → scene-graph's `selectNodeById` highlights

### 3.5 Forgiving (forgive mistakes)

- Closing the inspector deselects the node (so the next click re-opens it)
- `Home` key re-frames everything
- F-key re-frames the current selection

### 3.6 Discoverability

- Every action button has a `title` tooltip showing the shortcut
- gizmo in top-right has `aria-label="Viewport orientation gizmo"`
- Drop zone shows a centered label "Drop to add linked asset to scene" on drag

---

## 4. State Management Pattern

All shared mutable state lives in `frontend/src/js/engine/state.ts` as fields on a single `state` object (ESM imports are read-only, so we wrap in an object). Always add new fields here, never as module-level `let` variables.

```js
export const state = {
  engine: null,
  scene: null,
  camera: null,                    // ArcRotateCamera reference
  nodeAnchors: new Map(),          // nodeId → TransformNode
  nodeMeshes: new Map(),           // nodeId → AbstractMesh[]
  rootSceneAnchor: null,
  pendingChildRefs: [],
  defaultWoodMaterial: null,
  highlightLayer: null,            // Babylon HighlightLayer
  highlightedNodeId: null,         // Currently selected node
  resizeEngineHandler: null,
  resizeObserverInstance: null,
  pointerObservableCallback: null,
};
```

Functions that need state import it: `import { state } from "./state.ts";`

---

## 5. Event Flow (document.dispatchEvent)

Arbesk uses custom DOM events on `document` for cross-module communication (no event bus, no framework):

| Event | Dispatched by | Listened by | Purpose |
|---|---|---|---|
| `node:selected` | `selectNode()` in scene-graph | `parametric-preview.ts` | Open inspector |
| `node:deselected` | `deselectAll()` | (none yet — extend as needed) | Notify of deselection |
| `outliner:nodeSelected` | outliner.ts | `parametric-preview.ts` | Outliner → inspector sync |
| `scene:cleared` | `clearScene()` | Various | Reset UI on scene reset |
| `scene:tokenChildAdded` | `loadTokenChildNode` | `parametric-preview.ts` | Update token CID display |
| `parametric:save` | save handler | Various | Parametric version saved |
| `asset:draftSaved` | save handler | headerbar | Refresh save button state |
| `asset:linkedDropped` | drop zone | scene-graph | Add token child to scene |
| `nesting:diveRequested` | inspector / outliner | scene-graph | Dive into child world |

**Pattern:** Always include a `detail` object with the relevant IDs/handles. Always `e.stopPropagation()` if a nested handler shouldn't bubble further.

---

## 6. Babylon.js Integration Patterns

### Engine options (stencil: true required for HighlightLayer)

```js
state.engine = new BABYLON.Engine(canvas, true, {
  preserveDrawingBuffer: true,    // required for captureAssetThumbnail
  stencil: true,                   // required for HighlightLayer
});
```

### Mesh hierarchy pattern

After `ImportMeshAsync`, call `attachMetadata(meshes, importedNodes, parent, nodeId)` which walks the imported node tree and tags every mesh with `metadata.nodeId` so the pointer-observable can identify what was picked.

### Viewport chrome (grid, gizmo canvas)

Tag any mesh that should survive `clearScene()`:

```js
grid.metadata = { isViewportChrome: true };
```

`clearScene()` checks `metadata.isViewportChrome` before disposing meshes and transform nodes.

### Selection detection

```js
state.scene.onPointerObservable.add((pointerInfo) => {
  const pickResult = pointerInfo.pickInfo;
  if (pickResult.hit && pickResult.pickedMesh) {
    // Walk parent chain to find nodeId
    let target = pickResult.pickedMesh;
    while (target) {
      if (target.metadata?.nodeId) {
        selectNode(target.metadata.nodeId, target);
        return;
      }
      target = target.parent;
    }
  }
  // Clicked empty space → deselect
  if (state.highlightedNodeId) deselectAll();
}, BABYLON.PointerEventTypes.POINTERPICK);
```

### Ortho mode — REMOVED, do not re-add

The Studio once had `1`/`3`/`7` orthographic view shortcuts backed by custom ortho-frustum code (explicit `orthoLeft/Right/Top/Bottom` corners + a custom wheel-zoom listener). It forced hand-rolled projection logic that hid state Babylon couldn't see, and it **broke and became unstable** — so it was removed and the viewport reverted to Babylon's **default perspective viewer** (`engine/scene-camera.ts`: "perspective-only").

**Lesson (out-of-the-box first — see AGENTS.md):** a shortcut is not free when it drags custom engine code with it. Do **not** re-implement orthographic view snapping or custom projection; if ortho views ever return, it must be via Babylon's built-in camera modes only.

---

## 7. SCSS Conventions

### Component files use `@use` not `@import`

```scss
// styles.scss
@use "components/viewport";
@use "components/headerbar";
@use "components/sidebar";
@use "components/inspector";
@use "components/messagebar";
@use "components/bottombar";
```

**If you add a new component file, you must add a `@use` line here, or the CSS won't be built.**

### CSS variables to know

| Variable | Role |
|---|---|
Colour tokens are the theme contract in `themes/_graphite.scss` / `themes/_paper.scss` — never hex or raw palette in components.

| `--window-bg` / `--window-fg`, `--sidebar-*`, `--view-*`, `--card-*`, `--popover-*` | Surfaces and their text |
| `--raised-bg` | Selected/toggled controls, chips, subtle fills |
| `--dim-fg` | Secondary text, section titles |
| `--accent-bg` / `--accent-fg` | Primary action only (`.btn-primary`, Generate) |
| `--accent-text` | Accent as text/icon/focus ring (≥ 4.5:1 on surfaces) |
| `--hairline` | Structural dividers (panels, rows, cards) |
| `--border-color` | Control borders (inputs, buttons) — ≥ 3:1 |
| `--danger-text`, `--destructive-bg`, `--success`, `--warning`, `--info` | Status |
| `--viewport-bg`, `--viewport-grid`, `--selection` | 3D stage (read by `readViewportTheme()`) |
| `--size-1` through `--size-8` | Spacing scale (use these, not px) |
| `--font-size-0` through `--font-size-5` | Type scale |
| `--radius-3` | Default border radius |
| `--duration-quick`, `--ease-out-3` | Animation timing |

### The viewport canvas

```scss
.viewport {
  flex: 1;
  position: relative;
  min-height: 0;
  // canvas clear colour = --viewport-bg (set from JS); the frame is a hairline
  border: var(--border-size-1) solid var(--hairline);
  border-radius: var(--radius-3);
  overflow: hidden;

  canvas { width: 100%; height: 100%; display: block; outline: none; }
}
```

**Important:** The `#viewportGizmo` overlay canvas has `pointer-events: none` so it never intercepts scene interactions.
