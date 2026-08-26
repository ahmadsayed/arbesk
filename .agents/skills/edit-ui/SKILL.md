---
name: edit-ui
description: Use when making any user-facing change to the Arbesk Studio frontend (Pug/SCSS/JS) — "add a panel/button/dialog", "add a keyboard shortcut", "update the layout", "style a component", "rebuild the frontend", or any change to app.pug, SCSS, or JS UI modules. Also use when the UI "feels wrong" or must stay consistent with the GNOME HIG design language.
---

# Arbesk Studio UI / UX — GNOME HIG

Scope: user-facing UI in `frontend/src/` + `frontend/scripts/` — panels, buttons, controls, viewport, keyboard shortcuts, selection feedback, drag/drop, empty states. Goal: feel like a native GNOME app — minimal chrome, keyboard-driven, immediately responsive.

## Hard Rules

1. **Minimal chrome** — no in-scene axes, view cube, toolbar overlay. Only grid, gizmo, drop indicator.
2. **Every action has a key** — Blender conventions (`1/3/7` views, `F` frame, `Esc` deselect).
3. **Form fields steal keystrokes** — guard `document.activeElement` in global `keydown` handlers.
4. **Selection feedback = HighlightLayer** (amber `#D4A017`); camera framing = 300ms animation.
5. **All viewport chrome gets `metadata.isViewportChrome = true`** so `clearScene()` preserves it.
6. **Rebuild after every change** — `npm run build:frontend`; backend serves `dist/`, not `src/`.
7. **Babylon.js is a CDN global** — never `import` it; loaded via `<script>`.
8. **Pug partials live in `src/pug/includes/`** — `app.pug` is a slim shell that `include`s them (head / header / studio-sidebar / studio-main / bottombar / library-view / wallet-popover / dialog-host); `build-pug.js` skips files with `include`/`mixin`/`layouts` in the path so partials never render standalone. Partials are written at column 0 (Pug re-indents at the include site); `#appDialogHost` must stay a body-level sibling of `#app`. Entry pages remain `app.pug` (unified SPA shell: Studio + Library views) and `index.pug` (landing page).
9. **New SCSS file needs `@use` in `styles.scss`** or it won't be built.
10. **Icons come from the sprite** — never inline SVG paths in Pug. Add a `<symbol>` to `frontend/public/icons.svg` and reference `use(href="/icons.svg#id")`; keep symbol children bare so host `stroke="currentColor"` inherits (no `<img>` — kills theming).
11. **CSS variables, not raw px** — spacing, colors, radii, durations from tokens.
12. **E2E is a public contract** — renaming an id/class/label, changing status text, or reordering a flow breaks specs. Update `e2e/helpers/studio-selectors.mjs` + specs and run the suite.
13. **Stateful panels use Alpine.js** — register via `registerAlpineComponent()` in `ui/alpine.ts`; shared reactive state lives in `Alpine.store(...)` (component factories return getters over the store, `init()` seeds before subscribing). Alpine renders asynchronously — `await Alpine.nextTick()` before imperative post-render DOM work (Babylon canvas mounts), and `Alpine.initTree()`/`Alpine.destroyTree()` for dynamically-injected subtrees. Keep engine DOM (canvases, focus traps) imperative. See `references/alpine.md`.

## File Map

| File | Role |
|------|------|
| `frontend/src/pug/app.pug` | unified SPA shell — includes only; real markup in `src/pug/includes/` |
| `frontend/src/pug/index.pug` | landing/marketing page |
| `frontend/src/scss/styles.scss` | imports all component files |
| `frontend/src/js/engine/scene-graph.ts` | Babylon engine, camera, selection, keyboard |
| `frontend/src/js/engine/state.ts` | shared mutable `state` object |
| `frontend/src/js/engine/parametric-preview.ts` | inspector live editing |
| `frontend/src/js/ui/asset-library.ts` | gallery of saved assets |
| `frontend/src/js/ui/asset-drop-zone.ts` | drop target for dragged cards |
| `frontend/src/js/ui/asset-save.ts` | Save Draft / Publish wiring |
| `frontend/src/js/ui/outliner.ts` | scene graph tree |

## Supporting Files (read on demand)

- Read `references/checklists.md` when adding a panel or keyboard shortcut (7-step checklist, keydown guard).
- Read `references/patterns.md` when you need an empty state, drop zone, or spinner.
- Read `references/pitfalls.md` when something feels off (ortho frustum, HighlightLayer stencil, mesh disposal, form guards).
- Read `references/alpine.md` when converting an imperative panel to Alpine.js (store/getter/template pattern, dynamic components, async render timing, jest testing).
- Read `references/e2e-sync.md` when changing any button/id/label/flow/status text.
- Read `references/deep-dive.md` for architecture, shell, HIG principles, state, events, Babylon, and SCSS internals.
