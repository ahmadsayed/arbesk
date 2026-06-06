---
name: edit-ui
description: Modify or extend the Arbesk Studio frontend (Pug/SCSS/JS) following GNOME Human Interface Guidelines. Use when adding new UI components, panels, controls, keyboard shortcuts, or visual feedback to the 3D viewport — and when the change must feel consistent with the existing minimalist, keyboard-driven studio shell.
---

# Arbesk Studio UI / UX — GNOME HIG

Use this skill when working on the Arbesk Studio frontend (`frontend/src/`, `frontend/scripts/`) and the change touches user-facing UI: panels, buttons, controls, the 3D viewport, keyboard shortcuts, selection feedback, drag/drop targets, or empty states.

The goal of every change: **make the interface feel like a native GNOME application** — minimal chrome, keyboard-driven, immediately responsive, no surprises.

---

## 1. Project UI Architecture at a Glance

### Stack

| Layer | Tech | Notes |
|---|---|---|
| Markup | Pug (`frontend/src/pug/`) | One file (`studio.pug`) — there is no includes/ system |
| Styling | Component SCSS (`frontend/src/scss/components/`) | Imported via `styles.scss` with `@use` |
| Behavior | Vanilla ES modules (`frontend/src/js/`) | **No bundler** — copied as-is into `dist/` |
| 3D Engine | Babylon.js (CDN) | `BABYLON` is a global — never `import` it |
| Build | Custom Node scripts (`frontend/scripts/`) | Pug → HTML, SCSS → CSS, JS copy, assets copy |

### Directory Map

| Path | Role |
|---|---|
| `frontend/src/pug/studio.pug` | The **only** Pug file. All markup lives here |
| `frontend/src/scss/components/_viewport.scss` | 3D viewport + gizmo + drop indicator |
| `frontend/src/scss/components/_headerbar.scss` | GNOME-style header bar (top) |
| `frontend/src/scss/components/_sidebar.scss` | Left rail: library, outliner |
| `frontend/src/scss/components/_inspector.scss` | Right rail: selection inspector |
| `frontend/src/scss/components/_messagebar.scss` | Prompt input (bottom) |
| `frontend/src/scss/components/_bottombar.scss` | Status bar |
| `frontend/src/scss/styles.scss` | Imports all component files |
| `frontend/src/js/engine/scene-graph.js` | Babylon engine, scene, camera, selection, keyboard |
| `frontend/src/js/engine/state.js` | Shared mutable `state` object |
| `frontend/src/js/engine/cleanup.js` | `clearScene()` with chrome preservation |
| `frontend/src/js/engine/parametric-preview.js` | Inspector live editing (color/scale) |
| `frontend/src/js/engine/time-travel.js` | Version history / manifest chain |
| `frontend/src/js/engine/placeholders.js` | Loading/error placeholders for token children |
| `frontend/src/js/ui/viewport-gizmo.js` | 2D X/Y/Z orientation overlay (top-right) |
| `frontend/src/js/ui/asset-library.js` | Gallery of saved assets (left sidebar) |
| `frontend/src/js/ui/asset-drop-zone.js` | Drop target for dragged gallery cards |
| `frontend/src/js/ui/asset-editors.js` | Chat / studio editor surfaces |
| `frontend/src/js/ui/asset-history.js` | Timeline scrubber in header bar |
| `frontend/src/js/ui/asset-save.js` | Save Draft / Publish wiring |
| `frontend/src/js/ui/create-panel.js` | "New asset" dialog flow |
| `frontend/src/js/ui/outliner.js` | Scene graph tree in left sidebar |
| `frontend/src/js/ui/sidebar.js` | Sidebar show/hide logic |
| `frontend/src/js/ui/ledger-panel.js` | Micro-ledger audit panel (Phase 5) |
| `frontend/src/js/blockchain/wallet.js` | MetaMask / Web3Modal connection |
| `frontend/src/js/blockchain/token-resolver.js` | `child_ref` → manifest CID resolution |
| `frontend/src/js/services/api.js` | Backend API client (generation, save, publish) |
| `frontend/src/js/services/url-utils.js` | Query string helpers |
| `frontend/src/js/ipfs/remote-ipfs.js` | Browser-side IPFS reads via backend |
| `frontend/src/js/gltf/uri_to_cid.js` | GLTF buffer URI ↔ CID translation |

### Build & Verify Workflow

```bash
# After any frontend change:
cd frontend && npm run build

# Or from root:
npm run build:frontend

# Output: frontend/dist/
# Backend serves frontend/dist/ at http://localhost:9090
```

Always rebuild before testing in the browser. The backend does **not** serve `src/` — only `dist/`.

---

## 2. The Studio Shell (top to bottom)

```
┌────────────────────────────────────────────────────────────┐
│ headerbar  [back] [New] [title] [history] [Save] [Pub] [💳]│  ← GNOME-style
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

- `.viewport` → `flex: 1`, `background-color: var(--choco-12)`, dark to match 3D canvas
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

## 3. GNOME HIG Principles Applied

### 3.1 Minimal Chrome (no visual clutter)

The 3D viewport shows: a 40×40 wireframe ground grid (α 0.3), a 2D X/Y/Z orientation gizmo in the top-right corner, and a dashed drop indicator on drag. **No in-scene axis cylinders, no view cube, no toolbar overlay.** All viewport chrome carries `metadata.isViewportChrome = true` so `clearScene()` preserves it.

### 3.2 Keyboard-Driven (every action has a key)

Implemented shortcuts in `scene-graph.js` (single `keydown` listener on `document`):

| Key | Action | Why |
|---|---|---|
| `Esc` | Deselect current node | Mirrors GNOME modal dismissal |
| `Home` | Frame all (zoom to fit scene) | Recovery from lost perspective |
| `F` | Frame selected node | Recovery from lost perspective |
| `1` | Front orthographic view (Blender) | Standard view snap |
| `3` | Right orthographic view | Standard view snap |
| `7` | Top orthographic view | Standard view snap |
| `Ctrl+B` | Toggle left sidebar (sidebar.js) | GNOME panel toggle convention |
| `Ctrl+N` | New asset (headerbar button) | GNOME app convention |
| `Alt+Left` | Back to parent world (headerbar) | GNOME navigation convention |

The handler **must** skip when the user is typing in any `<input>`, `<textarea>`, `<select>`, or `contentEditable` element — see the `editable` guard pattern in `scene-graph.js`.

### 3.3 Responsive Feedback (no silent state changes)

Selection feedback is the **HighlightLayer** (amber `#D4A017` outer glow):

- `state.highlightLayer` is created once during `initEngine()`
- `selectNode(nodeId, mesh)` clears the previous highlight and adds the new node's meshes
- `deselectAll()` clears the highlight, resets `state.highlightedNodeId`, dispatches `node:deselected`
- `closeInspector()` (in `parametric-preview.js`) calls `deselectAll()` so re-clicking the same mesh re-opens the inspector

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

All shared mutable state lives in `frontend/src/js/engine/state.js` as fields on a single `state` object (ESM imports are read-only, so we wrap in an object). Always add new fields here, never as module-level `let` variables.

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

Functions that need state import it: `import { state } from "./state.js";`

---

## 5. Event Flow (document.dispatchEvent)

Arbesk uses custom DOM events on `document` for cross-module communication (no event bus, no framework):

| Event | Dispatched by | Listened by | Purpose |
|---|---|---|---|
| `node:selected` | `selectNode()` in scene-graph | `parametric-preview.js` | Open inspector |
| `node:deselected` | `deselectAll()` | (none yet — extend as needed) | Notify of deselection |
| `outliner:nodeSelected` | outliner.js | `parametric-preview.js` | Outliner → inspector sync |
| `scene:cleared` | `clearScene()` | Various | Reset UI on scene reset |
| `scene:tokenChildAdded` | `loadTokenChildNode` | `parametric-preview.js` | Update token CID display |
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

### Ortho mode gotcha (critical)

**Do not rely on Babylon's `radius`-derived ortho frustum.** Set all four corners explicitly:

```js
cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
cam.orthoLeft   = -halfW;
cam.orthoRight  = +halfW;
cam.orthoBottom = -halfH;
cam.orthoTop    = +halfH;
cam.radius      = someValue; // used for direction calc, not visible area
```

**Wheel zoom in ortho mode** must be handled with a custom listener — Babylon's default scales `radius`, which doesn't affect the frustum when corners are explicit:

```js
canvas.addEventListener("wheel", (e) => {
  if (state.camera?.mode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA) {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0015);
    cam.orthoLeft   *= factor;
    cam.orthoRight  *= factor;
    cam.orthoTop    *= factor;
    cam.orthoBottom *= factor;
  }
}, { passive: false });
```

### View preset coordinates (Blender convention)

| View | alpha | beta | What you see |
|---|---|---|---|
| Front (1) | 0 | π/2 | Camera on +Z, looking at -Z face |
| Right (3) | π/2 | π/2 | Camera on +X, looking at -X face |
| Top (7) | 0 | 0.01 | Camera above (+Y), looking down — beta=0.01 avoids gimbal lock |

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
| `--choco-12` | Viewport dark background (#1e1e1e) |
| `--choco-2` / `--choco-4` | Body text primary / secondary |
| `--gold-5` | Accent gold (welcome icon, highlights) |
| `--accent-bg` | Primary accent (buttons, drop border) |
| `--border-color` | Default borders |
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
  background-color: var(--choco-12);
  border: var(--border-size-1) solid var(--border-color);
  border-radius: var(--radius-3);
  overflow: hidden;

  canvas { width: 100%; height: 100%; display: block; outline: none; }
}
```

**Important:** The `#viewportGizmo` overlay canvas has `pointer-events: none` so it never intercepts scene interactions.

---

## 8. Keyboard Shortcut Checklist (when adding a new one)

1. **Pick the right key** — Blender uses `1/3/7` for views, `F` for frame, `5` for perspective toggle. GNOME uses `Ctrl+B` (sidebar), `Ctrl+N` (new), `Esc` (cancel).

2. **Add to the existing `keydown` switch** in `scene-graph.js` (don't create a new listener — they conflict).

3. **Guard against form field focus**:

```js
const tag = document.activeElement?.tagName?.toLowerCase();
const editable = document.activeElement?.isContentEditable
  || tag === "input" || tag === "textarea" || tag === "select";
if (editable) return;
```

4. **`e.preventDefault()` for keys that would otherwise scroll/navigate the browser** (e.g., `Home`, arrow keys).

5. **Add `title` tooltip on the corresponding button** showing the shortcut.

6. **Export any new function from scene-graph.js** so it can be tested or called from elsewhere.

---

## 9. Common UI Patterns to Reuse

### Empty state

```pug
#welcomeOverlay.viewport-empty
  .viewport-empty-content
    .viewport-empty-icon ✦
    h2 Welcome to Arbesk
    p Create, compose, and publish tokenized 3D assets.
    .viewport-empty-actions
      button.btn.btn-primary Start New Asset
      p(style="font-size:var(--font-size-0);color:var(--choco-4);margin-top:var(--size-2)")
        | Generate an asset, open one from your library, or drag an asset into the scene.
```

### Drop zone overlay

```pug
#assetDropOverlay.viewport-drop-indicator
  div(style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--accent-bg);font-weight:600")
    .asset-drop-icon ⊕
    p Drop to add linked asset to scene
```

```scss
.viewport-drop-indicator {
  position: absolute;
  inset: var(--size-2);
  border: 2px dashed var(--accent-bg);
  border-radius: var(--radius-3);
  pointer-events: none;
  z-index: 25;
  opacity: 0;
  transition: opacity var(--duration-quick) var(--ease-out-3);
  &.active { opacity: 1; }
}
```

### Spinner

```scss
.viewport-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent-bg);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

---

## 10. Pitfalls to Avoid

1. **Don't rely on Babylon's ortho frustum from `radius`** — set `orthoLeft/Right/Top/Bottom` explicitly. The default derivation is non-obvious and produces a view ~100× too large.

2. **HighlightLayer requires `stencil: true`** on the engine. If you re-create the engine, don't drop this option.

3. **The `onBeforeRenderObservable` listener leaks** if not removed. Store the observer reference and clean it up in `clearScene()`.

4. **`mesh.dispose(false, true)`** disposes materials (safe for unique import materials). **Never** call it on `state.defaultWoodMaterial` (it's shared). See the `babylon-memory-leaks` skill.

5. **Dynamic import of `viewport-gizmo.js`** happens in `initEngine()`:
   ```js
   import("../ui/viewport-gizmo.js")
     .then(({ initViewportGizmo }) => initViewportGizmo(state.scene, camera))
   ```
   Don't move this to a static import — the gizmo needs `document` to be ready (the canvas element must exist).

6. **Form fields steal keystrokes.** Always check `document.activeElement` before handling shortcut keys.

7. **Pug files have no includes system.** Everything is in `studio.pug`. Don't try to add partials.

8. **SCSS components need `@use` in `styles.scss`.** A new file won't be built unless imported.

9. **The backend serves `frontend/dist/`, not `frontend/src/`.** Always run `npm run build:frontend` before testing in the browser.

10. **Babylon.js is a CDN global.** Never `import * as BABYLON from "@babylonjs/core"`. The studio HTML loads `https://cdn.babylonjs.com/babylon.js` as a `<script>` tag.

11. **The `attachMetadata` walk** is what makes meshes pickable by nodeId. If you add new mesh creation code, call it after import or manually set `mesh.metadata = { nodeId, ... }`.

12. **`gizmoCanvas.width` and `gizmoCanvas.height` are set in JS** via `resize()` after the canvas mounts. The CSS controls display size, JS controls backing store (DPR-aware).

---

## 11. Adding a New Panel or Component — Checklist

1. **Markup** — Add to `frontend/src/pug/studio.pug`. Use existing classes (`.inspector`, `.sidebar`, etc.) or extend them.
2. **Styles** — Add to the relevant `frontend/src/scss/components/_*.scss`. If a new file, add `@use` to `styles.scss`.
3. **Behavior** — Add to a new file in `frontend/src/js/ui/` (panel-style) or `frontend/src/js/engine/` (engine-level). Use ES modules, import from `state.js` for shared state.
4. **Events** — If your panel emits selection/state changes, dispatch a custom event on `document`. Don't couple panels directly.
5. **Keyboard** — If your panel has shortcuts, add them to the existing `keydown` switch in `scene-graph.js` with the form-field guard.
6. **Build** — Run `npm run build:frontend`. Check `frontend/dist/studio.html` for the markup and `frontend/dist/css/styles.css` for the styles.
7. **Test** — Open `http://localhost:9090` in the browser. Test with and without a loaded asset. Test the keyboard shortcuts work and don't fire in form fields.

---

## 12. Key Files Quick Reference

| Want to... | Look at |
|---|---|
| Add a button to the header | `frontend/src/pug/studio.pug` (search for `headerbar`) |
| Change the accent color | `frontend/src/scss/_variables.scss` (if exists) or root SCSS |
| Add a keyboard shortcut | `frontend/src/js/engine/scene-graph.js` (the `keydown` switch) |
| Make a new panel collapsible | Follow `.sidebar` / `.inspector` pattern in `_sidebar.scss` |
| Add selection feedback (visual) | Use `state.highlightLayer.addMesh(mesh, color)` |
| Dispatch a UI event | `document.dispatchEvent(new CustomEvent("name", { detail: {...} }))` |
| Listen to a UI event | `document.addEventListener("name", handler)` |
| Add a new 3D scene primitive | Tag with `metadata.isViewportChrome` if it shouldn't be cleared |
| Style the viewport chrome | `frontend/src/scss/components/_viewport.scss` |
| Add a drop target | Use the `.viewport-drop-indicator` pattern |
| Add a loading spinner | Use the `.viewport-spinner` pattern |
| Frame the camera | `frameCameraToBounds(bounds)` helper in `scene-graph.js` |
| Snap to a view | `snapView({ name, alpha, beta })` helper |

---

## 13. GNOME HIG Reference (the principles behind the patterns)

- **Simplicity & clarity** — One primary action per view, no decoration that doesn't aid understanding.
- **Keyboard accessibility** — Every action has a shortcut. Form fields always exempt.
- **Consistency** — Same button styles, same spacing scale, same animations across the app.
- **Discoverability** — Title tooltips show shortcuts. Visual affordances show what can be clicked.
- **Direct manipulation** — Click meshes to select, drag to add children, scroll to zoom.
- **Responsive feedback** — Highlight on select, animation on frame, dashed border on drop.
- **Forgiving** — Esc to cancel, Home to recover, F to re-zoom.
- **Minimal chrome** — Gizmo in corner, grid on ground, no in-scene axes.

When in doubt, ask: "What would GNOME Builder / GNOME Photos / Nautilus do?"
