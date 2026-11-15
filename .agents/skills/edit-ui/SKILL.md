---
name: edit-ui
description: Use when making any user-facing change to the Arbesk Studio frontend (Pug/SCSS/JS) — "add a panel/button/dialog", "add a keyboard shortcut", "update the layout", "style a component", "rebuild the frontend", or any change to app.pug, SCSS, or JS UI modules. Also use when the UI "feels wrong" or must stay consistent with the Arbesk design language (Graphite/Paper themes, WCAG 2.2 AA).
---

# Arbesk Studio UI

Source in `frontend/src/` (`pug/includes/`, `scss/components/`, `js/ui/`, `js/engine/`). The backend serves `frontend/dist/`, so run `bun run build:frontend` after every change.

## Design authority, in order

1. **WCAG 2.2 AA**, enforced by `test/frontend/theme-contrast.test.js`.
2. **Web platform conventions**: WAI-ARIA APG patterns, browser keyboard defaults, `prefers-*` and `forced-colors`.
3. **Arbesk design language** (`docs/superpowers/specs/2026-10-04-ui-refresh-roadmap.md`): flat surfaces, `--hairline` structure, one accent used only for the primary action, sentence case, Inter for UI text, JetBrains Mono (`.tabular`) only for data such as sizes, CIDs, versions and addresses.

## Colour and type

- Only theme tokens from `scss/themes/_graphite.scss` and `_paper.scss`. No hex in `components/`. Spacing, radii and durations also come from tokens, not raw px.
- A new colour role goes into both theme files and into `CONTRACT` in `theme-contrast.test.js`.
- Text on a `color-mix()` tint you build goes into `DERIVED_TEXT_PAIRS` in the same test.
- Light/dark selectors use `[data-scheme="dark|light"]`, never theme names.
- `test/frontend/style-guards.test.js` fails on `--gradient-*`, `text-transform: uppercase` and hand-written mono stacks in `components/`.
- Never signal state by colour alone (WCAG 1.4.1): add a shape, icon or text.

## Rules

1. **Minimal chrome.** The viewport shows the grid, the gizmo and the drop indicator. No in-scene axes, view cube or toolbar overlay. Chrome meshes carry `metadata.isViewportChrome = true`.
2. **The Studio is view-first and perspective-only.** `E` enters Edit mode; there is no scale gizmo and no ortho view. Do not re-add `1/3/7` views.
3. **A shortcut must earn its place.** Add one only if it is used several times a minute, the browser or OS does not own it, a visible button would not be better, and you add it to `ui/keyboard-help.ts` plus a `title` tooltip (label with `MOD` from `utils/platform.ts`).
4. **No new `keydown` listener per module.** Add the key to an existing dispatcher, skip it when `isTypingInField()` (`utils/typing-guard.ts`) is true, and do not add an Escape handler that fires in parallel with the open dialog, popover or menu.
5. **Menus use `initMenuButton()`** (`ui/menu-button.ts`) with a `.menu-popover` list. Never hand-roll a dropdown.
6. **Stateful panels use Alpine.js.** Read `references/alpine.md` before writing or converting one.
7. **Pug**: markup lives in `src/pug/includes/`, written at column 0; `app.pug` only includes. `#appDialogHost` stays a body-level sibling of `#app`. A new SCSS file needs `@use` in `styles.scss`.
8. **Icons** come from the sprite `frontend/public/icons.svg` via `use(href="/icons.svg#id")`. No inline paths, no `<img>`.
9. **Selection** is the HighlightLayer in `--selection`; viewport colours come from `readViewportTheme()` and follow `THEME_CHANGED`. Camera moves animate (about 300 ms).
10. **Panels do not call each other.** They `emit()` and `on()` events from `@arbesk/asset-core/events/bus.js`.

## E2E sync

Ids, classes, labels and status texts are a contract with `e2e/`. When one changes: update `e2e/helpers/studio-selectors.mjs`, then the spec assertions, then `e2e/helpers/manifest.mjs` if the manifest shape changed, then run `bun run test:e2e -- --project=chromium`. `e2e/README.md` lists what each spec covers.

Things that bite when writing specs:

- Wait on durable state (`page.waitForURL`), not on `#srStatus`, which is overwritten between steps.
- A token id is hex in the URL (`?asset=0x…`) and decimal on gallery cards (`data-token-id`). Compare as `BigInt`.
- Studio opens on the Create tab when the URL has no `asset`/`assetId`/`manifest`; switch to Outline explicitly.
- `#emptyViewport` covers the viewport centre when no asset is open and can swallow canvas clicks.
- The open asset's own card is hidden in the Assets panel, and cards are disabled until an asset is open.
- The outliner labels a child node `Token #<id>` and shows a newly linked child only after a save.
- The provider select sits inside the closed `#composerAdvanced` details: open it first (`selectProvider()` in `flows.mjs`).
- The rate-limit reset call must send `Content-Type: application/json`, or it fails with 415 and limits pile up across runs.
