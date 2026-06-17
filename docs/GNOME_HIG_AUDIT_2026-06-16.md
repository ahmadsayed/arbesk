# GNOME HIG Audit Report — Arbesk Studio

**Date**: 2026-06-16  
**Auditor**: Kimi Code CLI (automated source audit)  
**Version**: `2036538`  
**Context**: Web 3.0 dApp running in the browser; GNOME HIG used as design reference, WCAG 2.1 AA as the primary accessibility standard.

---

## Overall Score: 90/100 — ✅ Excellent

| Category | Score | Rating |
|----------|-------|--------|
| A. Color & Theming | 86/100 | ✅ Excellent |
| B. Typography | 90/100 | ✅ Excellent |
| C. Layout & Spacing | 88/100 | ✅ Excellent |
| D. Buttons & Controls | 92/100 | ✅ Excellent |
| E. Keyboard Navigation | 84/100 | 👍 Good |
| F. Accessibility | 90/100 | ✅ Excellent |
| G. Forms & Input | 90/100 | ✅ Excellent |
| H. Dialogs & Modals | 98/100 | ✅ Excellent |
| I. Responsive Design | 92/100 | ✅ Excellent |
| J. Empty States & Feedback | 78/100 | 👍 Good |

**Weighted score**: 90.2/100

---

## Critical Violations (must fix)

*None.* All previously critical violations have been resolved.

---

## Warnings (should fix)

| # | Category | Finding | File(s) | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | A. Color | Focus ring (`--accent-bg` #a07848 on `--view-bg` #f0e6d8) is ~2.2:1 in light mode, below the 3:1 UI-component contrast recommendation. | `frontend/src/scss/base/_tokens.scss` | Darken the accent or add a darker halo ring for light mode so focus is visible on form surfaces. |
| 2 | A. Color | Border color (`--border-color` #b89a7a on `--window-bg` #faf6f2) is ~1.8:1, making panel separators hard to perceive in light mode. | `frontend/src/scss/base/_tokens.scss` | Use `--border-hairline` only for subtle dividers; raise `--border-color` contrast to at least 3:1 against window bg. |
| 3 | C. Layout | Sidebar and inspector edges show no resize affordance (`col-resize` cursor) or drag-to-resize behavior. | `frontend/src/scss/components/_sidebar.scss`, `_inspector.scss` | Add a 4px drag handle on the sidebar right edge and inspector left edge with `cursor: col-resize`; wire mouse drag to update `--sidebar-width` / `--inspector-width`. |
| 4 | E. Keyboard | The 3D viewport canvas has no `tabindex`, so keyboard-only users cannot focus it before using view shortcuts. | `frontend/src/pug/studio.pug` | Add `tabindex="0"` to `#renderCanvas` and style `:focus-visible` with a subtle outline or glow. |
| 5 | E. Keyboard | `Ctrl+/` is the only keyboard-shortcut discovery path; first-time users may never find it. | `frontend/src/pug/studio.pug`, `frontend/src/js/ui/keyboard-help.js` | Add a visible "Keyboard Shortcuts" menu item in the wallet popover or bottom-bar overflow menu. |
| 6 | J. Feedback | Long operations (IPFS upload, on-chain transactions) show only an indeterminate spinner with no progress percentage or step label. | `frontend/src/js/services/api.js`, `frontend/src/js/ui/asset-save.js` | If the API exposes upload progress, wire a determinate progress bar or step label in the bottom bar. |

---

## Suggestions (nice to have)

| # | Category | Finding | File(s) | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | B. Typography | `--font-size-4` is missing from the token scale, leaving a gap between `--font-size-3` (1.125rem) and `--font-size-5` (1.5rem). | `frontend/src/scss/base/_tokens.scss` | Add `--font-size-4: 1.25rem` for a complete 6-step scale. |
| 2 | D. Buttons | The wallet button uses a custom `.headerbar-wallet` class rather than the standard `.btn` system, duplicating transition and focus styles. | `frontend/src/scss/components/_headerbar.scss` | Refactor `.headerbar-wallet` to extend `.btn.btn-sm` via a SCSS placeholder or mixin. |
| 3 | J. Feedback | Failed generation and network errors may only appear in `console.error()` or as a brief toast with no persistent inline recovery action. | `frontend/src/js/services/api.js`, `frontend/src/js/ui/create-panel.js` | Display inline error banners in the chat or bottom bar with a "Retry" action button. |

---

## What's Already Excellent

- **Color token architecture** follows the three-layer libadwaita model (palette → surface variants → agnostic aliases) with full dark/light mode support, `prefers-contrast` adaptation, and WCAG-compliant body text contrast ratios.
- **Dialog UX** is now fully accessible: scale + fade entrance, backdrop blur, reduced-motion respect, Escape/Enter/click-backdrop dismissal, `focus-trap@7.6.2` integration, `showDialog`/`showConfirmDialog`/`showInfoDialog` variants, and immediate focus-to-input on open.
- **Keyboard shortcut coverage** is extensive and safely guarded: view snapping (1/3/7), frame all (Home), frame selected (F), sidebar toggle (Ctrl+B), new asset (Ctrl+N), save (Ctrl+S), undo/redo color edits (Ctrl+Z / Ctrl+Shift+Z), nesting navigation (Alt+Left / Escape), view switching (Ctrl+1–5), and a platform-aware shortcuts help dialog (Ctrl+/).
- **ARIA coverage** is comprehensive: `h1.sr-only` page title, tablist roles with `aria-selected` on the sidebar switcher, canvas `aria-label="3D viewport" role="img"`, live region `#srStatus` for status announcements, `aria-expanded` on the sidebar toggle, and `aria-describedby` for the tier select.
- **Responsive design** is fully baked: sidebar overlays at medium breakpoints, inspector becomes a bottom sheet on narrow screens, touch targets never shrink below 36×36px, and headerbar text collapses gracefully.
- **Empty states** are context-aware: the Chat view shows a welcome prompt, the Gallery shows a wallet-connect CTA, and the Outliner shows "No items".

---

## GNOME HIG Principles Scoring

| Principle | Adherence | Notes |
|-----------|-----------|-------|
| Simplicity & clarity | 9/10 | Clean panel layout with visible borders; token system ensures consistency. |
| Keyboard accessibility | 8/10 | Excellent shortcut coverage and guards; canvas focusability and shortcut discoverability hold it back from a 9. |
| Consistency | 9/10 | Token system ensures color/spacing consistency; button variants are comprehensive. |
| Discoverability | 8/10 | Tooltips show shortcuts and a help dialog exists, but first-time users may miss the `?` button. |
| Direct manipulation | 9/10 | Drag/drop child worlds, clickable canvas selection, sidebar switcher, and backdrop dismissal. |
| Responsive feedback | 8/10 | Loading spinners and placeholders exist; progress bars and persistent error states would improve further. |
| Forgiving | 9/10 | Dialogs support Escape cancellation and backdrop click; undo/redo is implemented for color edits. |
| Minimal chrome | 9/10 | View Switcher pattern keeps chrome low; inspector is contextual and collapsible. |

---

## Category Details

### A. Color & Theming — 86/100

**Pass**: Body text contrast (~13:1 light, ~11:1 dark), dark/light parity, semantic colors, `prefers-contrast`, `prefers-reduced-motion`, and viewport-neutral background are all in place.

**Fail**: Focus ring and border contrast in light mode fall short of the 3:1 recommendation for UI components.

### B. Typography — 90/100

**Pass**: System font stack, harmonious scale (0–3, 5), proper line heights, and logical heading hierarchy (`h1.sr-only` → `h3` sidebar/inspector headings).

**Fail**: `--font-size-4` is missing, leaving a scale gap.

### C. Layout & Spacing — 88/100

**Pass**: GNOME-style header bar (48px), View Switcher sidebar, 4px spacing scale, independent panel scrolling, and responsive overlay behavior.

**Fail**: No resize handles or drag-to-resize on sidebar/inspector edges.

### D. Buttons & Controls — 92/100

**Pass**: Touch targets ≥36px, complete state coverage, primary/secondary/destructive/outline/flat variants, icon-only `aria-label`s, and dialog primary action placement.

**Fail / Suggestion**: Wallet button duplicates `.btn` styles; could reuse the button system.

### E. Keyboard Navigation — 84/100

**Pass**: Broad shortcut coverage, form-field guards in `scene-graph.js`, `sidebar.js`, `nesting.js`, and `keyboard-help.js`, plus platform-aware shortcut rewriting (`Ctrl` → `⌘` on macOS).

**Fail**: Viewport canvas is not focusable; shortcut discoverability relies on a small bottom-bar `?` button.

### F. Accessibility — 90/100

**Pass**: ARIA labels, tablist roles, live region, canvas accessible name, reduced-motion wrapping for animations, and asset thumbnail `alt` text.

**Fail**: Focus-ring color contrast in light mode (same as A.1.7).

### G. Forms & Input — 90/100

**Pass**: Persistent labels and `aria-label`s, `aria-describedby` for tier help, error-state classes, and properly sized color/range inputs.

**Fail**: Error classes exist but are not visibly wired in all forms.

### H. Dialogs & Modals — 98/100

**Pass**: All structural and behavioral requirements met after the `focus-trap` refactor. Backdrop click, Escape, initial focus, and reduced-motion all work.

**Fail**: None significant.

### I. Responsive Design — 92/100

**Pass**: Multiple breakpoints, overlay panels, bottom-sheet inspector, maintained touch targets, and fluid headerbar collapse.

**Fail**: None significant.

### J. Empty States & Feedback — 78/100

**Pass**: Welcome/empty states in Chat, Gallery, and Outliner; loading spinners; token-child placeholders.

**Fail**: Long operations lack determinate progress, and error states lack persistent inline recovery actions.

---

## Notes on Recently Closed Issues

- **#25 (material-editor multi-primitive)**: `findMaterialByMeshName()` now returns all primitives for a mesh, improving color-override correctness on complex glTF models.
- **#23 (focus-trap library)**: `dialog.js` uses `focus-trap@7.6.2`, resolving shadow-DOM / MetaMask focus-steal issues.
- **#22 (Notyf toasts)**: `toasts.js` is a thin Notyf wrapper with GNOME-styled glass accents and action buttons.
- **#20 (mitt event bus)**: `events/bus.js` replaces the hand-rolled `document.dispatchEvent` registry.

These changes positively impacted categories **H**, **J**, and **F** compared to the previous audit.
