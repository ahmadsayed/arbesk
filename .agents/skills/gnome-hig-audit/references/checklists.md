# Checklists — GNOME HIG UI/UX Audit

Full 10-category audit checklists (A–J), scoring rubric, and step-by-step audit procedure.

## 2. Audit Categories & Scoring

Each category is scored 0–100. The final score is the average across all categories.

| # | Category | Weight | What it covers |
|---|----------|--------|----------------|
| A | Color & Theming | 1.0 | Contrast ratios (WCAG AA/AAA — primary standard), dark/light parity, semantic color use, `prefers-color-scheme` and `prefers-contrast` support |
| B | Typography | 0.8 | Font hierarchy, line heights, monospace usage, heading levels, readable measure lengths |
| C | Layout & Spacing | 1.0 | GNOME shell conventions, panel sizing, spacing scale, grid alignment, overflow handling |
| D | Buttons & Interactive Controls | 1.0 | Sizing (min 36×36px touch target), state coverage (hover/focus/active/disabled), icon-only patterns, primary/secondary distinction |
| E | Keyboard Navigation | 1.2 | Shortcut coverage, discoverability, form-field guard, focus order, Escape/Enter conventions |
| F | Accessibility | 1.2 | WCAG 2.1 AA/AAA compliance (primary), ARIA labels, screen reader support, focus rings, `prefers-reduced-motion`, heading hierarchy, alt text. GNOME HIG accessibility practices are secondary references.
| G | Forms & Input | 0.8 | Label association, placeholder contrast, error states, help text, color/range inputs |
| H | Dialogs & Modals | 0.8 | Focus trap, Escape dismiss, backdrop, title/body/actions pattern, animation |
| I | Responsive Design | 0.8 | Breakpoint coverage, touch targets on mobile, bottom-sheet patterns, overflow |
| J | Empty States & Feedback | 0.6 | Welcome screen, loading spinners, error placeholders, generation feedback, idle states |

### Score interpretation

| Range | Rating | Action |
|-------|--------|--------|
| 90–100 | ✅ Excellent | Minor polish only |
| 80–89 | 👍 Good | A few improvements recommended |
| 65–79 | ⚠️ Fair | Several violations need attention |
| 50–64 | 🔶 Poor | Significant HIG gaps |
| <50 | 🔴 Critical | Major rework needed |

---

## 3. How to Run the Audit

Run one category at a time. For each category, follow the checklist, record findings, and assign a score.

### Step 1: Read the source files

For each surface listed in the scope table, read the relevant SCSS and JS files. For markup, read `arabesk/frontend/src/pug/studio.pug`.

### Step 2: Open the running app

Start the app (`./scripts/start-dev.sh`) and inspect at `http://localhost:9090`. Toggle dark/light mode (browser DevTools → Rendering → `prefers-color-scheme`).

### Step 3: Run the checklist

For the category you're auditing, work through every checkbox. Mark each as **PASS ✅**, **FAIL ❌**, or **N/A ➖**.

### Step 4: Score the category

Count PASS items. Score = (PASS / (PASS + FAIL)) × 100.

### Step 5: Write findings

For each FAIL, write a 1–2 sentence recommendation referencing the specific GNOME HIG principle violated and the file(s) that need changing.

---

## 4. Category A: Color & Theming Audit Checklist

**Files**: `arabesk/frontend/src/scss/base/_tokens.scss`

### A.1 Contrast Ratios (WCAG)

- [ ] **A.1.1** Body text (`--window-fg` on `--window-bg`) achieves at least 4.5:1 (AA for normal text).  
  *Check*: Light `#2a1a0e` on `#faf6f2` = ~13:1 ✅. Dark `#f0e6d8` on `#2a1a0e` = ~11:1 ✅.

- [ ] **A.1.2** Dim text (`--dim-fg` on `--window-bg`) achieves at least 3:1 (AA for large/incidental text).  
  *Check*: Light `#8c6a4a` on `#faf6f2` ≈ 3.5:1 ✅. Dark `#a28060` on `#2a1a0e` ≈ 3.2:1 ✅.

- [ ] **A.1.3** Accent text (`--accent-fg` on `--accent-bg`) achieves at least 4.5:1.  
  *Check*: `#2a1a0e` on `#c19a6b` ≈ 5.5:1 ✅.

- [ ] **A.1.4** Destructive text (`--destructive-fg` on `--destructive-bg`) achieves at least 4.5:1.  
  *Check*: White on `#e01b24` ≈ 5:1 ✅. White on `#c01c28` ≈ 5.5:1 ✅.

- [ ] **A.1.5** Card text (`--card-fg` on `--card-bg`) achieves at least 4.5:1.  
  *Check*: Light `#3d2a18` on `#faf6f2` ≈ ~13:1 ✅. Dark `#e0d0bc` on `#523a22` ≈ ~5:1 ✅.

- [ ] **A.1.6** Input text (`--view-fg` on `--view-bg`) achieves at least 4.5:1.  
  *Check*: Light `#2a1a0e` on `#f0e6d8` ≈ ~11:1 ✅. Dark `#f0e6d8` on `#3d2a18` ≈ ~8:1 ✅.

- [ ] **A.1.7** Focus ring color differs from the background by at least 3:1.  
  *Check*: `--accent-bg` (`#c19a6b`) on `--view-bg` (`#f0e6d8`) ≈ 2.2:1 — **FAIL** for light mode.

- [ ] **A.1.8** Border color (`--border-color`) has sufficient contrast to distinguish surfaces.  
  *Check*: Light `#cdb89a` on `#faf6f2` ≈ 1.5:1 — **FAIL** (borders are barely visible).

### A.2 Dark/Light Mode Parity

- [ ] **A.2.1** Both `:root` (light) and `@media (prefers-color-scheme: dark)` blocks exist. ✅
- [ ] **A.2.2** Every surface variant (`window`, `view`, `headerbar`, `sidebar`, `card`, `popover`) has both light and dark values. ✅
- [ ] **A.2.3** Theme-agnostic aliases are the only variables used in component SCSS (never `-light`/`-dark` suffixes in component files). ✅
- [ ] **A.2.4** Dark mode background surfaces form a logical depth hierarchy (deeper = lighter, not darker). ⚠️ Check: `--window-bg-dark` `#2a1a0e` → `--view-bg-dark` `#3d2a18` → `--card-bg-dark` `#523a22` — this is inverted (cards get *darker*). **FAIL**: GNOME dark adwaita goes deeper = lighter.

- [ ] **A.2.5** `prefers-contrast: more` media query removes shadows and uses `currentColor` for borders. ✅
- [ ] **A.2.6** No hardcoded hex values in component SCSS (all colors come from tokens). ✅

### A.3 Semantic Color

- [ ] **A.3.1** Destructive actions use `--destructive-bg` / `--destructive-fg`. ✅
- [ ] **A.3.2** Success states have a dedicated color token. ✅ (`--green-4`)
- [ ] **A.3.3** Warning states have a dedicated color token. ✅ (`--yellow-4`)
- [ ] **A.3.4** Accent does not conflict semantically (e.g., accent should not also mean "success"). ✅

### A.4 3D Viewport Colors

- [ ] **A.4.1** `--viewport-bg` is a neutral dark gray (`#1e1e1e`) independent of the light/dark theme — Matches Babylon.js canvas background convention. ✅
- [ ] **A.4.2** Axis colors follow Blender convention (X=red, Y=green, Z=blue). ✅
- [ ] **A.4.3** Selection highlight (`--highlight-amber`) is distinct from the accent color. ✅

---

## 5. Category B: Typography Audit Checklist

**Files**: `arabesk/frontend/src/scss/base/_tokens.scss`, `arabesk/frontend/src/pug/studio.pug`

### B.1 Font Stack

- [ ] **B.1.1** `--font-family` starts with `system-ui` (GNOME native look). ✅
- [ ] **B.1.2** Monospace font stack includes `ui-monospace` before specific fonts. ✅
- [ ] **B.1.3** No web font downloads (performance). ✅

### B.2 Type Scale

- [ ] **B.2.1** At least 5 distinct sizes in a harmonious scale. ✅ (5 sizes: `--font-size-0` through `--font-size-5`)
- [ ] **B.2.2** Body text is 14px–16px (`--font-size-1` = 0.875rem ≈ 14px). ✅ (GNOME default is 14px for body)
- [ ] **B.2.3** Labels/captions are 12px (`--font-size-0` = 0.75rem). ✅
- [ ] **B.2.4** Page title is 24px (`--font-size-5` = 1.5rem). ✅

### B.3 Line Heights

- [ ] **B.3.1** Body line height is at least 1.375 (`--font-lineheight-2`). ✅
- [ ] **B.3.2** Heading line heights are tighter than body (1.25 or less). ✅ (headerbar title uses 1.25)
- [ ] **B.3.3** No line height below 1.2 (legibility floor). ✅

### B.4 Heading Hierarchy

- [ ] **B.4.1** Heading elements (`h1`–`h6`) follow a logical nesting order in the Pug template.  
  *Check*: `studio.pug` has `h2` (Welcome), `h2` (sidebar views), `h5` (Inspector) — skipping `h1`. **FAIL**: GNOME HIG requires `h1` as the page/modal title, descending without gaps.

- [ ] **B.4.2** Welcome overlay uses `h2` with no preceding `h1`. **FAIL**: Should start with `h1`.

- [ ] **B.4.3** Inspector uses `h5` which jumps from `h2` — skips `h3` and `h4`. **FAIL**: Use `h3` for inspector (descends from sidebar `h2`).

### B.5 Readable Measure

- [ ] **B.5.1** Sidebar view body text does not exceed ~75 characters per line. ✅ (sidebar is 280px, with padding ≈ 230px content width, ~50 chars at 0.875rem)
- [ ] **B.5.2** Dialog body text does not exceed ~75 characters per line. ✅ (dialog max 400px, ~65 chars)

---

## 6. Category C: Layout & Spacing Audit Checklist

**Files**: `arabesk/frontend/src/scss/components/_layout.scss`, `arabesk/frontend/src/scss/base/_tokens.scss`

### C.1 GNOME Shell Conventions

- [ ] **C.1.1** Header bar spans full width at top, contains back/title/actions. ✅
- [ ] **C.1.2** Header bar height is exactly 48px. ✅
- [ ] **C.1.3** Left sidebar uses View Switcher pattern (icon strip + content pane). ✅
- [ ] **C.1.4** View Switcher icons are 18×18px in 36×36px hit areas. ✅
- [ ] **C.1.5** Bottom bar is 32px (status bar convention). ✅

### C.2 Spacing Scale

- [ ] **C.2.1** Spacing uses a 4px base grid (all `--size-*` tokens are multiples of 0.25rem). ✅
- [ ] **C.2.2** Component files never use raw `px` values for padding/gap/margin — always reference `--size-*` tokens.  
  *Check*: `_headerbar.scss` uses `var(--size-2)`, `var(--size-3)`. ✅. `_buttons.scss` uses `var(--size-2) var(--size-4)`. ✅.

- [ ] **C.2.3** Panel padding is at least 16px (`--size-3`). ✅ (sidebar, inspector, headerbar all use `--size-3`)

### C.3 Overflow & Clipping

- [ ] **C.3.1** `.studio-layout` has `overflow: hidden` and `min-height: 0` to prevent flex blowout. ✅
- [ ] **C.3.2** Sidebar and inspector scroll independently (`overflow-y: auto`). ✅
- [ ] **C.3.3** Header bar title uses `text-overflow: ellipsis` with `white-space: nowrap`. ✅

### C.4 Panel Sizing

- [ ] **C.4.1** Sidebar width (280px) is reasonable — GNOME sidebars are typically 240–320px. ✅
- [ ] **C.4.2** Inspector width (260px) is reasonable. ✅
- [ ] **C.4.3** Sidebar and inspector widths are defined via CSS custom properties (not hardcoded). ✅
- [ ] **C.4.4** Resizer affordances exist to suggest panels are resizable. **FAIL**: No drag-to-resize handle on sidebar or inspector edges. GNOME HIG panels should at minimum show a `col-resize` cursor on the edge, ideally support drag resize.

### C.5 Grid / Ground Plane

- [ ] **C.5.1** Viewport grid is subtle (α 0.3) and doesn't visually overpower the 3D content. ✅
- [ ] **C.5.2** Grid uses `isViewportChrome: true` metadata so `clearScene()` preserves it. ✅

---

## 7. Category D: Buttons & Interactive Controls Audit Checklist

**Files**: `arabesk/frontend/src/scss/components/_buttons.scss`, `arabesk/frontend/src/pug/studio.pug`

### D.1 Touch Targets

- [ ] **D.1.1** Default button `min-height` is at least 36px. ✅
- [ ] **D.1.2** Small buttons (`btn-sm`) `min-height` is at least 28px. ✅ (acceptable for icon-only or dense toolbars)
- [ ] **D.1.3** Icon-only buttons have equal `min-width` and `min-height`. ✅ (`btn-icon` 36×36, `btn-icon.btn-sm` 28×28)
- [ ] **D.1.4** Sidebar switcher buttons have 36×36px hit area. ✅

### D.2 Button States

- [ ] **D.2.1** Every button variant has `:hover`, `:active`, `:focus-visible`, and `:disabled` states.  
  *Check*: `btn-primary` has hover/active but **no `:focus-visible` on the variant itself** — only on the base `.btn`. ✅ (base handles it). `:disabled` is on `.btn`. ✅.

- [ ] **D.2.2** Disabled buttons show `cursor: not-allowed`. ✅
- [ ] **D.2.3** Active state is visually distinct from hover (pressed look). ✅ (`brightness(0.95)` on primary, darker bg on secondary)

### D.3 Variant Coverage

- [ ] **D.3.1** Primary (filled accent). ✅
- [ ] **D.3.2** Secondary / default (card-bg with border). ✅
- [ ] **D.3.3** Outline (transparent with accent border). ✅
- [ ] **D.3.4** Destructive (red). ✅
- [ ] **D.3.5** Flat / text-only (no background, no border). ✅
- [ ] **D.3.6** Suggested action pattern exists (default button in dialogs). **FAIL**: Dialog actions use `btn` classes but there's no mechanism to mark one as the "suggested" (default) action. In GNOME HIG, the primary/suggested button in a dialog should be rightmost and have `btn-primary`, while the cancel is `btn-secondary`.

### D.4 Icon-Only Buttons

- [ ] **D.4.1** All icon-only buttons have `aria-label` attributes. ✅ (verified in studio.pug)
- [ ] **D.4.2** Icon SVGs have `aria-hidden="true"`. ✅
- [ ] **D.4.3** Icon size is 16–20px for toolbar, consistent within each context. ✅

### D.5 Wallet Button

- [ ] **D.5.1** Connected state uses accent fill. ✅
- [ ] **D.5.2** Disconnected state uses outline (transparent with accent border). ✅
- [ ] **D.5.3** Address truncation uses monospace font. ✅

---

## 8. Category E: Keyboard Navigation Audit Checklist

**Files**: `arabesk/frontend/src/js/engine/scene-graph.js`, `arabesk/frontend/src/js/ui/sidebar.js`, `arabesk/frontend/src/js/ui/nesting.js`, `arabesk/frontend/src/js/ui/dialog.js`

### E.1 Shortcut Coverage

> **Note**: Keyboard shortcuts follow **web application conventions** first, GNOME HIG second. Standard web shortcuts (e.g., `Ctrl+Z` for undo, `Tab`/`Shift+Tab` for focus navigation) must work as expected. GNOME-specific shortcuts (e.g., `Alt+Left` for back, `Home` for reset view) are used where they enhance the studio IDE-like experience and do not conflict with browser defaults.

- [ ] **E.1.1** `Escape` deselects node (modal dismissal pattern). ✅
- [ ] **E.1.2** `Escape` closes dialogs. ✅ (dialog.js global key handler)
- [ ] **E.1.3** `Escape` at child root ascends to parent. ✅ (nesting.js)
- [ ] **E.1.4** `Home` frames all (GNOME "reset view" convention). ✅
- [ ] **E.1.5** `F` frames selected (GNOME "focus/find" convention). ✅
- [ ] **E.1.6** `Ctrl+B` toggles left sidebar. ✅
- [ ] **E.1.7** `Ctrl+N` creates new asset. ✅
- [ ] **E.1.8** `Alt+Left` ascends (GNOME back navigation). ✅
- [ ] **E.1.9** `Ctrl+1` through `Ctrl+4` switch sidebar views. ✅
- [ ] **E.1.10** `Enter` submits forms (prompt input, dialog inputs). ✅
- [ ] **E.1.11** `Tab` and `Shift+Tab` cycle focus in a logical order. **FAIL**: No explicit focus management or `tabindex` ordering. Focus order depends entirely on DOM order — may skip the 3D viewport canvas entirely.

- [ ] **E.1.12** `Ctrl+Z` / `Ctrl+Shift+Z` for undo/redo of parametric edits. **FAIL**: No undo/redo implementation for color/scale changes.

### E.2 Form-Field Guard

- [ ] **E.2.1** Global `keydown` handler checks `document.activeElement` before processing shortcuts. ✅ (scene-graph.js)
- [ ] **E.2.2** The guard checks for `input`, `textarea`, `select`, and `contentEditable`. ✅
- [ ] **E.2.3** All global keyboard listeners use this guard (not just scene-graph's).  
  *Check*: `sidebar.js` Ctrl+B handler **does not** check active element — typing "b" in a prompt could toggle the sidebar. **FAIL**. `nesting.js` Alt+Left handler also lacks the guard.

### E.3 Discoverability

- [ ] **E.3.1** Every action button has a `title` attribute showing its keyboard shortcut. ✅
- [ ] **E.3.2** Shortcut notation uses platform convention (Ctrl on Linux/Windows, Cmd on Mac). **FAIL**: All `title` attributes show `Ctrl+` — macOS users see `Ctrl` but expect `⌘`. Use `Ctrl`/`Cmd` or `CtrlOrCmd`.

- [ ] **E.3.3** There is a keyboard shortcuts reference accessible somewhere in the UI. **FAIL**: No "Keyboard Shortcuts" help panel, dialog, or tooltip.

### E.4 Focus Order

- [ ] **E.4.1** Header bar buttons are focusable in logical order (back → new → title → actions → wallet). ✅ (DOM order)
- [ ] **E.4.2** Sidebar content receives focus after the switcher icons. ✅ (DOM order)
- [ ] **E.4.3** Focus is trapped inside open dialogs. **FAIL**: `dialog.js` adds a global Escape listener but does not trap focus (Tab at the end of a dialog leaks focus to the background).

---

## 9. Category F: Accessibility Audit Checklist

**Files**: `arabesk/frontend/src/pug/studio.pug`, `arabesk/frontend/src/scss/base/_tokens.scss`, `arabesk/frontend/src/scss/components/_buttons.scss`, `arabesk/frontend/src/scss/components/_forms.scss`

### F.1 ARIA Labels (WCAG 2.1 AA — Required)

> **Note**: Because Arbesk Studio is a web application, ARIA and semantic HTML are the primary accessibility mechanisms. GTK accessibility patterns (e.g., ATK roles) do not apply here.

- [ ] **F.1.1** All buttons have either visible text or `aria-label`. ✅ (verified on all headerbar, sidebar, inspector buttons)
- [ ] **F.1.2** Navigation landmarks are marked (`<nav>`, `role="navigation"`). ✅ (path bar uses `<nav>`)
- [ ] **F.1.3** The sidebar view switcher is marked as a tab list with `role="tablist"` and `role="tab"` on buttons. **FAIL**: Switcher buttons use plain `<button>` with `data-view` attributes — no `role="tab"`, `aria-selected`, or `role="tablist"` on the container.
- [ ] **F.1.4** The header bar title announces its editability (`contenteditable="true"` needs `role="textbox"` and `aria-multiline="false"`). **FAIL**: `#assetStatusName` has `contenteditable="true"` but no ARIA role.
- [ ] **F.1.5** Collapsible panels use `aria-expanded`. **FAIL**: `#sidebarToggle` does not toggle `aria-expanded` on the sidebar element.

### F.2 Focus Rings

- [ ] **F.2.1** All interactive elements have a visible `:focus-visible` outline. ✅ (buttons, form inputs, switcher buttons)
- [ ] **F.2.2** Focus ring is at least 2px wide. ✅
- [ ] **F.2.3** Focus ring color contrasts with the background. ⚠️ Same issue as A.1.7 — gold on light background may not be visible enough.
- [ ] **F.2.4** Custom focus styles do not remove `:focus-visible` in favor of `:focus`. ✅ (uses `:focus-visible` everywhere)

### F.3 Reduced Motion

- [ ] **F.3.1** Transitions are set to `0ms` when `prefers-reduced-motion: reduce`. ✅ (`_tokens.scss` line 215–220)
- [ ] **F.3.2** Animations (dialog backdrop-in, dialog-in, spin) are disabled under `prefers-reduced-motion`. ✅ (dialog has explicit rule), ⚠️ `@keyframes spin` in `_messagebar.scss` is NOT wrapped in a motion query — **FAIL**.

### F.4 Screen Reader Support

- [ ] **F.4.1** SVG icons have `aria-hidden="true"`. ✅
- [ ] **F.4.2** Live regions announce state changes (e.g., "Asset generated", "Node selected"). **FAIL**: No `aria-live` regions for status updates. The bottom bar status text does not announce changes.
- [ ] **F.4.3** The 3D canvas has a text alternative for screen readers. **FAIL**: Canvas has no `aria-label` or accessible description.

### F.5 Alt Text

- [ ] **F.5.1** Brand logo in header has `alt` text. ✅ (`alt="Arbesk"`)
- [ ] **F.5.2** Asset card thumbnails have `alt` text. **FAIL**: Need to check if library card thumbnail `<img>` tags have `alt` attributes.

---

## 10. Category G: Forms & Input Audit Checklist

**Files**: `arabesk/frontend/src/scss/components/_forms.scss`, `arabesk/frontend/src/scss/components/_messagebar.scss`, `arabesk/frontend/src/pug/studio.pug`

### G.1 Labels

- [ ] **G.1.1** Every form input has an associated `<label>` element or `aria-label`.  
  *Check*: `#promptInput` has no visible label — uses `placeholder`. **FAIL**: GNOME HIG requires a persistent label or `aria-label`. A placeholder is not a label.
- [ ] **G.1.2** Labels use `.form-label` styling (dim, small, bold). ✅ (for inspector form groups)
- [ ] **G.1.3** Labels are positioned above their inputs. ✅

### G.2 Placeholders

- [ ] **G.2.1** Placeholder text is not used as the sole label. See G.1.1.
- [ ] **G.2.2** Placeholder color contrasts sufficiently (at least 4.5:1 is ideal, WCAG allows lower for placeholders but GNOME recommends readable).  
  *Check*: Placeholder uses `--dim-fg` which is ~3–3.5:1. Acceptable for placeholders per WCAG, but GNOME recommends closer to 4.5:1.

### G.3 Error States

- [ ] **G.3.1** Form inputs show a visual error indicator (red border or icon). **FAIL**: No error state styles defined — `_forms.scss` has no `.form-input.error` or similar.
- [ ] **G.3.2** Error messages are associated with their inputs (`aria-describedby`). **FAIL**: No error message pattern exists.

### G.4 Help Text

- [ ] **G.4.1** Help text uses `--dim-fg` and `--font-size-0`. ✅ (`.form-help` class)
- [ ] **G.4.2** Help text is associated via `aria-describedby`. **FAIL**: No usage found.

### G.5 Color Input

- [ ] **G.5.1** Color inputs are at least 40px tall (match the touch target minimum). ✅
- [ ] **G.5.2** Color inputs have a border and visible focus ring. ✅

### G.6 Range Slider

- [ ] **G.6.1** Range thumb is at least 16×16px. ✅
- [ ] **G.6.2** Range track is at least 4px tall. ✅
- [ ] **G.6.3** Range has a visible focus ring. ✅

---

## 11. Category H: Dialogs & Modals Audit Checklist

**Files**: `arabesk/frontend/src/scss/components/_dialog.scss`, `arabesk/frontend/src/js/ui/dialog.js`

### H.1 Structure

- [ ] **H.1.1** Dialog has a title area (`.dialog-title`). ✅
- [ ] **H.1.2** Dialog has a body area (`.dialog-body`). ✅
- [ ] **H.1.3** Dialog has an actions area (`.dialog-actions`). ✅
- [ ] **H.1.4** Actions are right-aligned with primary/suggested action rightmost. ✅ (`.dialog-actions` uses `justify-content: flex-end`)

### H.2 Behavior

- [ ] **H.2.1** Escape dismisses the dialog. ✅
- [ ] **H.2.2** Clicking the backdrop dismisses the dialog. **FAIL**: `dialog.js` creates the backdrop but does not add a click handler to dismiss.
- [ ] **H.2.3** Focus is trapped inside the dialog. **FAIL**: No focus trap (prevents Tab from leaving the dialog).
- [ ] **H.2.4** Opening a dialog moves focus to the first focusable element inside. **FAIL**: Focus stays wherever it was before `showDialog()`.

### H.3 Animation

- [ ] **H.3.1** Dialog enters with a scale + fade animation. ✅
- [ ] **H.3.2** Backdrop enters with a fade animation. ✅
- [ ] **H.3.3** Animations are disabled under `prefers-reduced-motion`. ✅

### H.4 Visual

- [ ] **H.4.1** Backdrop is semi-transparent with blur. ✅ (`rgb(0 0 0 / 35%)` + `backdrop-filter: blur(4px)`)
- [ ] **H.4.2** Dialog has rounded corners (`.radius-3` = 12px). ✅
- [ ] **H.4.3** Dialog has a shadow (`.shadow-5`). ✅
- [ ] **H.4.4** Dialog has a border to distinguish it from the backdrop. ✅

---

## 12. Category I: Responsive Design Audit Checklist

**Files**: `arabesk/frontend/src/scss/utilities/_responsive.scss`

### I.1 Breakpoints

> **Note**: As a web application, Arbesk Studio must be usable across a range of viewport sizes and input methods (mouse, keyboard, touch). Responsive design follows **web best practices**; GNOME HIG desktop assumptions (fixed window sizes, pointer-only input) do not fully apply.

- [ ] **I.1.1** At least 2 breakpoints exist (medium and narrow). ✅ (900px and 480px)
- [ ] **I.1.2** Sidebar overlays at medium breakpoint instead of pushing content. ✅
- [ ] **I.1.3** Inspector becomes bottom sheet at narrow breakpoint. ✅
- [ ] **I.1.4** Header bar actions reduce gap at narrow screens. ✅ (`gap: var(--size-1)` at 480px)

### I.2 Touch Targets on Mobile

- [ ] **I.2.1** All buttons remain at least 36×36px at narrow breakpoints. ⚠️ Check: bottom bar font drops to 11px but no button resizing.
- [ ] **I.2.2** Dialog uses `min(400px, calc(100vw - var(--size-7) * 2))` so it doesn't overflow on small screens. ✅
- [ ] **I.2.3** Sidebar reveal button is large enough for touch (32×72px). ✅

### I.3 Overflow

- [ ] **I.3.1** All scrollable panels have `overflow-y: auto`. ✅
- [ ] **I.3.2** No horizontal scroll at any breakpoint. ⚠️ Verify in browser.

---

## 13. Category J: Empty States & Feedback Audit Checklist

**Files**: `arabesk/frontend/src/pug/studio.pug`, `arabesk/frontend/src/js/engine/placeholders.js`

### J.1 Welcome Screen

- [ ] **J.1.1** Welcome overlay is shown when no asset is loaded. ✅
- [ ] **J.1.2** Welcome overlay has a title, description, and primary action. ✅
- [ ] **J.1.3** Welcome overlay can be dismissed (Escape or clicking backdrop). ⚠️ Escape dismisses (in scene-graph), but clicking the overlay itself does nothing.
- [ ] **J.1.4** Welcome overlay uses the accent color for its icon/graphic. ✅ (`.viewport-empty-icon` likely uses gold)

### J.2 Loading States

- [ ] **J.2.1** A spinner indicates 3D generation in progress. ✅ (`.messagebar-spinner`)
- [ ] **J.2.2** The spinner is visible but not distracting (small, at the action point). ✅
- [ ] **J.2.3** Token child resolution shows a loading placeholder. ✅ (`placeholders.js`)
- [ ] **J.2.4** Long operations show progress feedback beyond the spinner. **FAIL**: No progress indicator for IPFS uploads or on-chain transactions — only a spinner.

### J.3 Error States

- [ ] **J.3.1** Failed token child resolution shows an error placeholder. ✅ (`placeholders.js`)
- [ ] **J.3.2** Failed generation shows an error message in the UI (not just console). **FAIL**: Errors may only appear in console or as a brief overlay.
- [ ] **J.3.3** Network errors show actionable recovery steps. **FAIL**: No "Retry" pattern for failed operations.

### J.4 Idle States

- [ ] **J.4.1** The viewport shows the grid and gizmo when no scene is active (not a blank canvas). ✅
- [ ] **J.4.2** Bottom bar shows useful status text ("Ready" or "No asset loaded"). ⚠️ Verify.
