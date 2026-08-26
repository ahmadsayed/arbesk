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

7. **Pug uses include partials.** The SPA shell is `app.pug` (plus `index.pug` for the landing page); real markup fragments live in `frontend/src/pug/includes/*.pug`. Add new fragments there and include them from `app.pug` — don't drop large chunks of markup directly into the shell.

8. **SCSS components need `@use` in `styles.scss`.** A new file won't be built unless imported.

9. **The backend serves `frontend/dist/`, not `frontend/src/`.** Always run `npm run build:frontend` before testing in the browser.

10. **Babylon.js is a CDN global.** Never `import * as BABYLON from "@babylonjs/core"`. The studio HTML loads `https://cdn.babylonjs.com/babylon.js` as a `<script>` tag.

11. **The `attachMetadata` walk** is what makes meshes pickable by nodeId. If you add new mesh creation code, call it after import or manually set `mesh.metadata = { nodeId, ... }`.

12. **`gizmoCanvas.width` and `gizmoCanvas.height` are set in JS** via `resize()` after the canvas mounts. The CSS controls display size, JS controls backing store (DPR-aware).

## Alpine.js migration pitfalls

See the full playbook in `references/alpine.md`. The sharp edges:

- **Alpine renders on the next microtask.** A synchronous `querySelector` right after a store write returns nothing — `await Alpine.nextTick()` before imperative DOM work (Babylon canvas mount, focus, measuring).
- **`x-for` needs a single root element** per iteration. When items must be direct flex children (CSS `gap`/`align-self`), make the root the item and compute `:class`; nest `<template x-if>` for per-kind content.
- **`:class` string replaces, object toggles.** `:class="'a b'"` wipes the static class; `:class="{ active: cond }"` preserves it.
- **`Alpine.initTree()` only works after `Alpine.start()`.** In jest, `readyState === "complete"` schedules start on a microtask — `await` a flush after importing before calling `initTree`.
- **`Alpine.store(name, value)` is a setter** (returns undefined) — read the store back with `Alpine.store(name)`.
- **Don't put DOM nodes in the reactive store** — they get proxied and fail DOM brand checks (`appendChild`). Keep canvases, focus traps, and promise queues module-level.
