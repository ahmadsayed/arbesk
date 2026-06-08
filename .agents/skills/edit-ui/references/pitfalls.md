# Pitfalls — Arbesk Studio UI / UX

Common mistakes and anti-patterns to avoid.

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
