# GNOME HIG Audit Report — Arbesk Studio

**Date**: 2026-06-06
**Auditor**: Kimi Code CLI (automated source audit)
**Version**: fd28a5a

---

## Overall Score: 81/100 — 👍 Good

| Category | Score | Rating |
|----------|-------|--------|
| A. Color & Theming | 91/100 | ✅ Excellent |
| B. Typography | 81/100 | 👍 Good |
| C. Layout & Spacing | 94/100 | ✅ Excellent |
| D. Buttons & Controls | 90/100 | ✅ Excellent |
| E. Keyboard Navigation | 71/100 | ⚠️ Fair |
| F. Accessibility | 56/100 | 🔶 Poor |
| G. Forms & Input | 57/100 | 🔶 Poor |
| H. Dialogs & Modals | 88/100 | 👍 Good |
| I. Responsive Design | 100/100 | ✅ Excellent |
| J. Empty States & Feedback | 79/100 | ⚠️ Fair |

---

## Critical Violations (must fix)

| # | Category | Finding | File(s) | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | F. Accessibility | Focus ring color (`--accent-bg` #c19a6b) on light surfaces fails 3:1 contrast, making keyboard focus nearly invisible in light mode. | `frontend/src/scss/base/_tokens.scss`, `frontend/src/scss/components/_buttons.scss` | Darken the focus ring color in light mode to at least #8c6a4a, or use a 2px `currentColor` outline that adapts to the surface. |
| 2 | F. Accessibility | The 3D `<canvas>` has no accessible name or description. Screen reader users cannot determine what the viewport is. | `frontend/src/pug/studio.pug` | Add `aria-label="3D viewport"` or `role="img"` with an `aria-label` to `#renderCanvas`. |
| 3 | F. Accessibility | No `aria-live` region exists for status announcements. Bottom-bar status changes ("Asset generated", "Loading…") are invisible to screen readers. | `frontend/src/pug/studio.pug` | Add a visually-hidden `<div aria-live="polite" aria-atomic="true">` in the bottom bar and update it when status changes. |
| 4 | F. Accessibility | `@keyframes spin` in `_messagebar.scss` and `_viewport.scss` is not wrapped in `prefers-reduced-motion`, violating vestibular accessibility. | `frontend/src/scss/components/_messagebar.scss`, `frontend/src/scss/components/_viewport.scss` | Wrap `@keyframes spin` and its consumers inside `@media (prefers-reduced-motion: no-preference)`. |
| 5 | G. Forms | `#promptInput` has no associated `<label>` — it relies solely on `placeholder`, which disappears once text is entered. | `frontend/src/pug/studio.pug` | Add a persistent `<label for="promptInput">` above the textarea, or at minimum an `aria-label="Asset generation prompt"`. |
| 6 | G. Forms | No error-state styles exist for form controls (red border, error icon, `.form-input.error`). | `frontend/src/scss/components/_forms.scss` | Add `.form-input.error` / `.form-input.is-invalid` styles with a red border and an accompanying `.form-error` text pattern. |
| 7 | E. Keyboard | `sidebar.js` and `nesting.js` global `keydown` handlers do not check `document.activeElement`, so typing "b" in a prompt or pressing Alt+Left in a text field will trigger UI shortcuts. | `frontend/src/js/ui/sidebar.js`, `frontend/src/js/ui/nesting.js` | Add the same `activeElement` guard used in `scene-graph.js` before processing global shortcuts. |
| 8 | E. Keyboard | Dialogs do not trap focus — `Tab` at the end of a dialog leaks focus back to the underlying page. | `frontend/src/js/ui/dialog.js` | Implement a focus trap that cycles among focusable elements inside the dialog using `Tab` / `Shift+Tab`. |

---

## Warnings (should fix)

| # | Category | Finding | File(s) | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | A. Color | Border color (`--border-color` #cdb89a on #faf6f2) has only ~1.5:1 contrast, making borders nearly invisible in light mode. | `frontend/src/scss/base/_tokens.scss` | Darken `--border-light` to at least #b89a7a for visible surface separation. |
| 2 | B. Typography | Heading hierarchy skips levels: no `h1` exists, and the inspector jumps from `h2` to `h5`. | `frontend/src/pug/studio.pug` | Use `h1` for the page title, `h2` for sidebar views, and `h3` for the inspector panel. |
| 3 | D. Buttons | `btn-outline`, `btn-danger`, and `btn-flat` lack `:active` pressed states. | `frontend/src/scss/components/_buttons.scss` | Add `:active:not(:disabled)` rules to each variant (e.g., `filter: brightness(0.9)` or a darker background). |
| 4 | D. Buttons | Most `<svg>` icons inside buttons do not have `aria-hidden="true"`, risking redundant screen-reader announcements in some browsers. | `frontend/src/pug/studio.pug` | Add `aria-hidden="true"` to every decorative SVG icon. |
| 5 | E. Keyboard | No undo/redo shortcuts (`Ctrl+Z` / `Ctrl+Shift+Z`) are implemented for parametric edits. | `frontend/src/js/engine/parametric-preview.js` | Maintain an edit-history stack and wire `Ctrl+Z` / `Ctrl+Shift+Z` to revert/reapply color and scale changes. |
| 6 | E. Keyboard | `title` attributes always show `Ctrl+` with no macOS `⌘` fallback. | `frontend/src/pug/studio.pug` | Detect the platform and display `Ctrl` on Linux/Windows, `⌘` on macOS. |
| 7 | E. Keyboard | No keyboard-shortcuts help panel or reference exists in the UI. | — | Add a "Keyboard Shortcuts" dialog reachable from the sidebar or via `Ctrl+/` (`Cmd+/`). |
| 8 | F. Accessibility | The sidebar switcher is not marked as `role="tablist"` / `role="tab"`; screen readers do not know it is a tabstrip. | `frontend/src/pug/studio.pug`, `frontend/src/js/ui/sidebar.js` | Add `role="tablist"` to `.sidebar-switcher`, `role="tab"` and `aria-selected` to each `.sidebar-switcher-btn`. |
| 9 | F. Accessibility | `#assetStatusName` is `contenteditable="true"` but lacks `role="textbox"` and `aria-multiline="false"`. | `frontend/src/pug/studio.pug` | Add `role="textbox" aria-multiline="false" aria-label="Asset name"`. |
| 10 | F. Accessibility | `#sidebarToggle` does not toggle `aria-expanded` on the sidebar element. | `frontend/src/js/ui/sidebar.js` | Set `aria-expanded="true|false"` on `.sidebar` and reference it via `aria-controls`. |
| 11 | G. Forms | `.form-help` text is not associated with its input via `aria-describedby`. | `frontend/src/pug/studio.pug` | Add `aria-describedby` to the tier select pointing to the help text element. |
| 12 | C. Layout | Sidebar and inspector edges have no resize handle or `col-resize` cursor affordance. | `frontend/src/scss/components/_sidebar.scss`, `frontend/src/scss/components/_inspector.scss` | Add a 4px drag handle on the right edge of the sidebar and left edge of the inspector with `cursor: col-resize`. |
| 13 | J. Feedback | Generation and on-chain transaction errors appear only in `console.error()` or brief `alert()` — no persistent inline error state. | `frontend/src/js/services/api.js`, `frontend/src/js/ui/asset-save.js` | Display inline error banners in the bottom bar or message bar with a "Retry" action. |

---

## Suggestions (nice to have)

| # | Category | Finding | File(s) | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | A. Color | The light-mode focus ring could use an offset + double-ring pattern for even stronger visibility. | `frontend/src/scss/components/_buttons.scss` | Consider `outline: 2px solid var(--accent-bg); outline-offset: 2px;` consistently across all interactive elements. |
| 2 | B. Typography | `--font-size-4` is missing from the token scale, causing a gap between `--font-size-3` (1.125rem) and `--font-size-5` (1.5rem). | `frontend/src/scss/base/_tokens.scss` | Add `--font-size-4: 1.25rem` for a complete 6-step scale. |
| 3 | D. Buttons | The wallet button uses a custom class rather than the standard `.btn` system, duplicating transition and focus styles. | `frontend/src/scss/components/_headerbar.scss` | Refactor `.headerbar-wallet` to extend `.btn.btn-sm` via a SCSS placeholder or mixin. |
| 4 | J. Feedback | Long IPFS uploads and blockchain transactions show only a spinner with no progress percentage. | `frontend/src/js/ui/asset-save.js` | If the API exposes upload progress, wire it to a determinate progress bar in the bottom bar. |
| 5 | H. Dialogs | `showDialog` only supports text inputs; there is no confirm/cancel pattern without an input field. | `frontend/src/js/ui/dialog.js` | Add an optional `showConfirmDialog` variant that omits the input and provides OK/Cancel actions. |

---

## What's Already Excellent

- **Responsive design** is fully baked: the sidebar overlays at medium breakpoints, the inspector becomes a bottom sheet on narrow screens, and touch targets never shrink below 36×36px.
- **Color token architecture** follows the three-layer libadwaita model (palette → surface variants → agnostic aliases) with full dark/light mode support and `prefers-contrast` adaptation.
- **Dialog UX** is polished: scale + fade entrance, backdrop blur, reduced-motion respect, Escape/Enter/click-backdrop dismissal, and immediate focus-to-input on open.
- **Keyboard shortcut coverage** is extensive: view snapping (1/3/7), frame all (Home), frame selected (F), sidebar toggle (Ctrl+B), new asset (Ctrl+N), and nesting navigation (Alt+Left / Escape).
- **Form controls** have consistent focus rings, proper range-slider styling, and color inputs sized to touch-target minimums.

---

## GNOME HIG Principles Scoring

| Principle | Adherence | Notes |
|-----------|-----------|-------|
| Simplicity & clarity | 8/10 | Clean panel layout, but invisible borders in light mode slightly reduce clarity. |
| Keyboard accessibility | 6/10 | Good shortcut coverage, but missing focus trap, undo/redo, and active-element guards lower the score. |
| Consistency | 9/10 | Token system ensures color/spacing consistency across all panels and states. |
| Discoverability | 7/10 | Tooltips show shortcuts, but no central help panel and some buttons lack titles. |
| Direct manipulation | 8/10 | Drag/drop child worlds, clickable canvas selection, and sidebar switcher all feel direct. |
| Responsive feedback | 7/10 | Loading spinners exist, but no progress bars or persistent error banners for long operations. |
| Forgiving | 7/10 | Dialogs support Escape cancellation, but undo/redo is missing for parametric edits. |
| Minimal chrome | 9/10 | View Switcher pattern keeps chrome low; inspector is contextual and collapsible. |
