---
name: edit-ui
description: Modify or extend the Arbesk Studio frontend (Pug/SCSS/JS) following GNOME Human Interface Guidelines. Covers adding UI components, panels, buttons, controls, keyboard shortcuts, SCSS tokens, Pug templates, and viewport interactions. Use when making any user-facing change to the Arbesk Studio — "add a panel", "create a new button", "add a keyboard shortcut", "update the UI layout", "style a new component", "add a dialog", "rebuild the frontend", or any change to studio.pug, SCSS files, or JS UI modules. Also use when something in the UI "feels wrong" or doesn't match the GNOME HIG design language — and when the change must feel consistent with the existing minimalist, keyboard-driven studio shell.
---

# Arbesk Studio UI / UX — GNOME HIG

Use this skill when working on the Arbesk Studio frontend (`frontend/src/`, `frontend/scripts/`) and the change touches user-facing UI: panels, buttons, controls, the 3D viewport, keyboard shortcuts, selection feedback, drag/drop targets, or empty states.

The goal of every change: **make the interface feel like a native GNOME application** — minimal chrome, keyboard-driven, immediately responsive, no surprises.

## Quick Decision

| Question | Action |
|----------|--------|
| Adding a new panel? | Follow the 7-step checklist. See [→ Checklists](./references/checklists.md) |
| Adding a keyboard shortcut? | Add to `scene-graph.js` keydown switch with form-field guard. See [→ Checklists](./references/checklists.md) |
| Need a reusable pattern? | Empty state, drop zone, or spinner. See [→ Patterns](./references/patterns.md) |
| Something feels off? | Check ortho frustum, HighlightLayer stencil, mesh disposal, form guards. See [→ Pitfalls](./references/pitfalls.md) |
| Changed a button/id/label/flow/status text? | Update the E2E selectors + specs and run the suite. See [→ E2E Sync](./references/e2e-sync.md) |

## Key Rules

1. **Minimal chrome** — no in-scene axes, no view cube, no toolbar overlay. Only grid, gizmo, drop indicator.
2. **Every action has a key** — Blender conventions (`1/3/7` for views, `F` for frame, `Esc` to deselect).
3. **Form fields steal keystrokes** — always guard `document.activeElement` in global `keydown` handlers.
4. **Selection feedback is HighlightLayer** (amber `#D4A017`). Camera framing uses 300ms animation.
5. **All viewport chrome has `metadata.isViewportChrome = true`** so `clearScene()` preserves it.
6. **Rebuild after every change** — `npm run build:frontend`. Backend serves `dist/`, not `src/`.
7. **Babylon.js is a CDN global** — never `import` it. The studio HTML loads it via `<script>`.
8. **Pug has no includes** — the unified SPA shell is in `app.pug` (Studio + Library views).
9. **SCSS components need `@use` in `styles.scss`** — a new file won't be built unless imported.
10. **Use CSS variables, not raw px** — spacing, colors, radii, durations all from tokens.
11. **UI changes must keep E2E in sync** — `e2e/helpers/studio-selectors.mjs` is a public contract. Renaming an `id`/class/label, changing a status message, or reordering a flow breaks the specs. Update selectors + specs and run the suite. See [→ E2E Sync](./references/e2e-sync.md).

## File Map

| File | Role | Details |
|------|------|---------|
| `frontend/src/pug/studio.pug` | The **only** Pug file | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/scss/styles.scss` | Imports all component files | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/engine/scene-graph.js` | Babylon engine, camera, selection, keyboard | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/engine/state.js` | Shared mutable `state` object | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/engine/parametric-preview.js` | Inspector live editing | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/ui/asset-library.js` | Gallery of saved assets | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/ui/asset-drop-zone.js` | Drop target for dragged cards | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/ui/asset-save.js` | Save Draft / Publish wiring | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/ui/outliner.js` | Scene graph tree | [→ Deep Dive](./references/deep-dive.md) |

## Deep Reference

| Topic | File |
|-------|------|
| Architecture, Shell, HIG Principles, State, Events, Babylon, SCSS | [→ Deep Dive](./references/deep-dive.md) |
| Keyboard Shortcuts, New Panel Checklist | [→ Checklists](./references/checklists.md) |
| Empty State, Drop Zone, Spinner Patterns | [→ Patterns](./references/patterns.md) |
| Common Mistakes & Anti-Patterns | [→ Pitfalls](./references/pitfalls.md) |
| When/how to update E2E tests after UI changes | [→ E2E Sync](./references/e2e-sync.md) |
