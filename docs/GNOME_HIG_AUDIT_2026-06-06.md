# GNOME HIG Audit Report — Arbesk Studio

**Date**: 2026-06-06 (re-evaluation)
**Auditor**: Kimi Code CLI (automated source audit)
**Version**: 3eb5011

---

## Overall Score: 91/100 — ✅ Excellent

| Category | Score | Rating |
|----------|-------|--------|
| A. Color & Theming | 92/100 | ✅ Excellent |
| B. Typography | 93/100 | ✅ Excellent |
| C. Layout & Spacing | 89/100 | 👍 Good |
| D. Buttons & Controls | 100/100 | ✅ Excellent |
| E. Keyboard Navigation | 80/100 | 👍 Good |
| F. Accessibility | 94/100 | ✅ Excellent |
| G. Forms & Input | 91/100 | ✅ Excellent |
| H. Dialogs & Modals | 100/100 | ✅ Excellent |
| I. Responsive Design | 100/100 | ✅ Excellent |
| J. Empty States & Feedback | 72/100 | 👍 Good |

**Change since last audit**: +10 points (81 → 91)

---

## Critical Violations (must fix)

*None.* All previously critical violations have been resolved.

---

## Warnings (should fix)

| # | Category | Finding | File(s) | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | E. Keyboard | `Ctrl+` shortcut notation in `title` attributes does not adapt to macOS (`⌘`). | `frontend/src/pug/studio.pug` (multiple `title` attrs) | Detect platform and show `⌘` on macOS, `Ctrl` on Linux/Windows, or use generic phrasing like "Toggle sidebar (Ctrl/Cmd+B)". |
| 2 | E. Keyboard | No undo/redo shortcuts (`Ctrl+Z` / `Ctrl+Shift+Z`) for parametric color/scale edits. | `frontend/src/js/engine/parametric-preview.js` | Maintain an edit-history stack and wire `Ctrl+Z` / `Ctrl+Shift+Z` to revert/reapply changes. |
| 3 | E. Keyboard | No keyboard-shortcuts help panel or reference exists in the UI. | — | Add a "Keyboard Shortcuts" dialog reachable from the sidebar or via `Ctrl+/` (`Cmd+/`). |
| 4 | C. Layout | Sidebar and inspector edges lack a resize handle or `col-resize` cursor affordance. | `frontend/src/scss/components/_sidebar.scss`, `frontend/src/scss/components/_inspector.scss` | Add a 4px drag handle on the right edge of the sidebar and left edge of the inspector with `cursor: col-resize`. |
| 5 | J. Feedback | Long IPFS uploads and on-chain transactions show only a spinner with no progress percentage or step indicator. | `frontend/src/js/services/api.js`, `frontend/src/js/ui/asset-save.js` | If the API exposes upload progress, wire it to a determinate progress bar in the bottom bar or message bar. |
| 6 | J. Feedback | Failed generation and network errors may only appear in `console.error()` or as a brief alert — no persistent inline error state with recovery action. | `frontend/src/js/services/api.js`, `frontend/src/js/ui/asset-save.js` | Display inline error banners in the bottom bar or toast container with a "Retry" action. |
| 7 | A. Color | Dark mode surface depth hierarchy is inverted: cards (`#523a22`) are *lighter* than the window background (`#2a1a0e`), opposite of GNOME Adwaita convention. | `frontend/src/scss/base/_tokens.scss` | Consider inverting so deeper surfaces are lighter (`--card-bg-dark` > `--view-bg-dark` > `--window-bg-dark`). |
| 8 | F. Accessibility | Asset library card thumbnail `<img>` tags may lack `alt` attributes when dynamically rendered. | `frontend/src/js/ui/asset-library.js` | Ensure every dynamically created `.asset-card-thumbnail img` has a meaningful `alt` or `aria-hidden="true"` if decorative. |

---

## Suggestions (nice to have)

| # | Category | Finding | File(s) | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | E. Keyboard | The 3D viewport canvas has no `tabindex`, making it unreachable via Tab navigation for keyboard-only users who might want to focus it before using view shortcuts. | `frontend/src/pug/studio.pug` | Add `tabindex="0"` to `#renderCanvas` so it can receive focus; style `:focus-visible` with a subtle outline or glow. |
| 2 | B. Typography | `--font-size-4` is missing from the token scale, causing a gap between `--font-size-3` (1.125rem) and `--font-size-5` (1.5rem). | `frontend/src/scss/base/_tokens.scss` | Add `--font-size-4: 1.25rem` for a complete 6-step scale. |
| 3 | D. Buttons | The wallet button uses a custom `.headerbar-wallet` class rather than the standard `.btn` system, duplicating transition and focus styles. | `frontend/src/scss/components/_headerbar.scss` | Refactor `.headerbar-wallet` to extend `.btn.btn-sm` via a SCSS placeholder or mixin. |
| 4 | H. Dialogs | `showDialog` only supports text inputs; there is no confirm/cancel pattern without an input field. | `frontend/src/js/ui/dialog.js` | Add an optional `showConfirmDialog` variant that omits the input and provides OK/Cancel actions. |
| 5 | J. Feedback | Welcome overlay can only be dismissed via Escape, not by clicking the backdrop. | `frontend/src/js/engine/scene-graph.js` | Add a click handler to `#welcomeOverlay` that hides it when clicking outside the content area. |

---

## What's Already Excellent

- **Responsive design** is fully baked: sidebar overlays at medium breakpoints, inspector becomes a bottom sheet on narrow screens, and touch targets never shrink below 36×36px.
- **Color token architecture** follows the three-layer libadwaita model (palette → surface variants → agnostic aliases) with full dark/light mode support, `prefers-contrast` adaptation, and WCAG-compliant contrast ratios.
- **Dialog UX** is now fully accessible: scale + fade entrance, backdrop blur, reduced-motion respect, Escape/Enter/click-backdrop dismissal, focus trap, and immediate focus-to-input on open.
- **Keyboard shortcut coverage** is extensive and now safely guarded: view snapping (1/3/7), frame all (Home), frame selected (F), sidebar toggle (Ctrl+B), new asset (Ctrl+N), nesting navigation (Alt+Left / Escape), and view switching (Ctrl+1–4) — all with `document.activeElement` guards.
- **ARIA coverage** is comprehensive: tablist roles with aria-selected, contenteditable textbox role, canvas img role, live region for status announcements, expanded states for collapsible panels, and describedby associations for form help text.

---

## Fixes Applied Since Last Audit (81 → 91)

| # | Issue | Fix |
|---|-------|-----|
| 1 | Focus ring color failed 3:1 contrast on light surfaces | `--gold-5` darkened to `#a07848`; `--border-light` darkened to `#b89a7a` |
| 2 | 3D canvas had no accessible name | Added `aria-label="3D viewport" role="img"` to `#renderCanvas` |
| 3 | No aria-live region for status announcements | Added `#srStatus` with `aria-live="polite" aria-atomic="true"` in bottom bar |
| 4 | `@keyframes spin` not wrapped in `prefers-reduced-motion` | Wrapped in `@media (prefers-reduced-motion: no-preference)` in `_messagebar.scss` and `_viewport.scss` |
| 5 | `#promptInput` had no label | Added `aria-label="Asset generation prompt"` |
| 6 | No error-state styles for forms | Added `.form-input.is-invalid` / `.form-select.is-invalid` and `.form-error` classes |
| 7 | `sidebar.js` and `nesting.js` lacked `activeElement` guards | Added `isEditing()` guard checking `input`, `textarea`, `select`, and `contentEditable` |
| 8 | Dialogs did not trap focus | Implemented `trapFocus()` with Tab cycling and focus-steal recovery in `dialog.js` |
| 9 | Dialog did not dismiss on backdrop click | Added `backdrop.addEventListener('click', …)` handler |
| 10 | Dialog did not move focus to first element on open | Added `requestAnimationFrame(() => input.focus())` |
| 11 | Sidebar switcher had no tab roles | Added `role="tablist"` to switcher, `role="tab"` with `aria-selected` and `tabindex` to buttons |
| 12 | `#assetStatusName` lacked ARIA for contenteditable | Added `role="textbox" aria-multiline="false" aria-label="Asset name"` |
| 13 | `#sidebarToggle` did not toggle `aria-expanded` | Added `aria-expanded="true|false"` updates in `collapseSidebar()` / `expandSidebar()` |
| 14 | Heading hierarchy skipped levels | Added `h1.sr-only` page title; inspector changed from `h5` to `h3` |
| 15 | `.form-help` not associated via `aria-describedby` | Added `aria-describedby="tierHelp"` to `#tierSelect` |

---

## GNOME HIG Principles Scoring

| Principle | Adherence | Notes |
|-----------|-----------|-------|
| Simplicity & clarity | 9/10 | Clean panel layout with visible borders; token system ensures consistency. |
| Keyboard accessibility | 8/10 | Excellent shortcut coverage and guards; missing undo/redo and help panel hold it back. |
| Consistency | 9/10 | Token system ensures color/spacing consistency; button variants are comprehensive. |
| Discoverability | 8/10 | Tooltips show shortcuts, but no central help panel and macOS users see wrong modifier. |
| Direct manipulation | 9/10 | Drag/drop child worlds, clickable canvas selection, sidebar switcher, and backdrop dismissal. |
| Responsive feedback | 8/10 | Loading spinners and placeholders exist; progress bars and persistent error states would improve further. |
| Forgiving | 8/10 | Dialogs support Escape cancellation and backdrop click; undo/redo missing for parametric edits. |
| Minimal chrome | 9/10 | View Switcher pattern keeps chrome low; inspector is contextual and collapsible. |
