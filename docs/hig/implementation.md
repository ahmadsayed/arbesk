# Implementation Plan, Migration & Tracking

> Part of [GNOME HIG Unification Plan](README.md)

---

## Implementation Phases

### Phase A: CSS Foundation — 2 days (no dependencies)

Drop Bootstrap. Build token system + 16 component SCSS files.

**Files created:**
```
frontend/src/scss/
├── base/_tokens.scss        ← full token system (see tokens.md)
├── base/_reset.scss
├── components/
│   ├── _headerbar.scss
│   ├── _sidebar.scss
│   ├── _viewport.scss
│   ├── _inspector.scss
│   ├── _messagebar.scss
│   ├── _bottombar.scss
│   ├── _buttons.scss
│   ├── _forms.scss
│   ├── _cards.scss
│   ├── _history.scss
│   ├── _outliner.scss
│   ├── _pathbar.scss
│   └── _ledger.scss
└── utilities/_responsive.scss
```

**Files changed:**
- `styles.scss` — replace Bootstrap import with `@use` lines
- `studio.scss` — **delete** (superseded)

**Rules enforced:**
- No `!important`
- Colors only through semantic tokens
- System font stack
- No custom scrollbar hiding
- `background-image` pattern on `#app::before` removed

---

### Phase B: Header Bar + Bottom Bar — 1 day (depends on A)

**Template (`studio.pug`):**
- Replace `.arabesque-topbar` with `<header class="headerbar">`
- Brand icon only (no text)
- Document title with `contenteditable`
- History timeline pill
- Save + Publish as header buttons
- New footer: `<footer class="bottombar">` with status + wallet button

**Removed from template:**
- `.arabesque-lattice-border`
- `.asset-status` block
- `#mobileMenuBtn`
- `#newAssetTopBtn`
- `#connectWalletBtn` / `#disconnectWalletBtn`

---

### Phase C: Unified Sidebar + 4-View Switcher + Outliner — 2.5 days (depends on A, B)

**Template:**
- Merge `#chatSidebar`, `#assetLibraryPanel`, `#ledgerPanel` into one `<aside class="sidebar">`
- Add View Switcher: 4 icon buttons (Create, Outline, Library, Ledger)
- Content sections: `[data-view="create"]`, `[data-view="outline"]`, `[data-view="library"]`, `[data-view="ledger"]`

**Removed:**
- `#showSidebarBtn`, `#showAssetLibraryBtn`, `#ledgerPanelToggle`
- All 3 separate collapse/expand code paths

**New modules:**
- `ui/sidebar.js` — unified controller
- `ui/outliner.js` — scene hierarchy tree

**Refactored:**
- `create-panel.js` → `[data-view="create"]`
- `asset-library.js` → `[data-view="library"]`
- `ledger-panel.js` → `[data-view="ledger"]`

---

### Phase D: Inspector + Outliner Integration — 1.5 days (depends on A, C)

- Move inspector from floating `position: absolute` to right sidebar column
- Two modes: mesh editor / child world info
- Selection sync: Outliner ↔ viewport ↔ inspector
- Width: 260px

---

### Phase E: Content Area + Nesting Navigation — 2 days (depends on B, D)

- Move prompt input to bottom `.message-bar`
- Add path bar to header for nesting breadcrumbs
- Add back button (nested only)
- Welcome overlay → inline empty state
- Generation overlay → inline spinner + status text
- Drop overlay → viewport border + Outliner row highlight
- Dive/ascend navigation (see [nesting.md](nesting.md))

---

### Phase F: Responsive Behavior — 1.5 days (depends on C, D)

Three breakpoints:
| Breakpoint | Layout |
|---|---|
| < 480px | Sidebar hidden, viewport full-width, inspector bottom sheet |
| 480–900px | Sidebar overlays, inspector overlays |
| 900px+ | Full three-column |

---

### Phase G: Polish & Accessibility — 1.5 days (depends on F)

- Keyboard navigation (tab order)
- Visible focus rings
- `aria-label` on all icon-only buttons
- `role` attributes on landmark regions
- `prefers-reduced-motion` respect
- `prefers-contrast` support
- 44×44px minimum touch targets

---

### Phase H: Testing & Validation — 1.5 days (depends on G)

- Visual regression: all views, inspector open/closed, all breakpoints
- Keyboard navigation audit
- Screen reader pass
- Cross-browser: Firefox, Chrome, Safari
- Existing API tests must still pass

---

## Effort Summary

| Phase | Days | Depends on |
|---|---|---|
| A: CSS Foundation | 2 | — |
| B: Header Bar + Bottom Bar | 1 | A |
| C: Unified Sidebar + Outliner | 2.5 | A, B |
| D: Inspector + Outliner Integration | 1.5 | A, C |
| E: Content Area + Nesting Nav | 2 | B, D |
| F: Responsive Behavior | 1.5 | C, D |
| G: Polish & Accessibility | 1.5 | F |
| H: Testing & Validation | 1.5 | G |
| **Total** | **~13.5** | |

---

## File Map: What Changes

| File | Fate |
|---|---|
| `studio.pug` | Rewritten (headerbar, pathbar, sidebar, outliner, bottombar) |
| `studio.scss` | **Deleted** |
| `styles.scss` | Simplified to `@use` imports |
| `ui/create-panel.js` | Refactored to `[data-view="create"]` |
| `ui/sidebar.js` | **New** — 4-view controller |
| `ui/outliner.js` | **New** — scene hierarchy tree |
| `ui/nesting.js` | **New** — dive/ascend, breadcrumbs |
| `ui/asset-library.js` | Refactored to `[data-view="library"]` |
| `ui/ledger-panel.js` | Refactored to `[data-view="ledger"]` |
| `ui/asset-editors.js` | Updated DOM refs |
| `ui/asset-history.js` | History pill in headerbar, scoped to current level |
| `ui/asset-save.js` | Buttons in headerbar, Publish hidden when nested |
| `ui/asset-drop-zone.js` | Drop overlay → viewport border + Outliner highlight |
| `engine/scene-graph.js` | Minor: expose dive/ascend hooks |
| `services/*.js` | **No changes** |
| `blockchain/*.js` | **No changes** |
| `scripts/build-scss.js` | Updated SCSS paths |

---

## Before / After

| Aspect | Current | Proposed |
|---|---|---|
| Panels | 4 (left, right, floating inspector, floating ledger) | 2 (left sidebar + optional right inspector) |
| Toggle buttons | 3 in different corners | 1 in sidebar header |
| Navigation | None (hunt for panels) | View Switcher + Path Bar |
| Scene hierarchy | Invisible | Outline view + breadcrumb path |
| Nesting UX | Double-click dive, no orientation | Dive + back + breadcrumbs + depth indicator |
| Topbar elements | 7 | 4 at root; adds back + path bar when nested |
| CSS files | 1 (2136 lines) | 16 (~200 lines each) |
| Framework | Bootstrap 5 | None (tokens only) |
| Custom properties | 10 | ~50 semantic tokens |
| Color scheme | Dark-only | `prefers-color-scheme` |
| `!important` | Sprinkled throughout | Zero |

---

## Open Questions

1. **Outline scope**: Only current level, or full nested tree?
2. **Dive transition**: Crossfade (200ms) or spatial zoom-in?
3. **Child world permissions**: Read-only when nested in someone else's world?
4. **Settings visibility**: Always-visible or simple/advanced toggle?
5. **New Asset**: `Ctrl+N` with inline form instead of `prompt()` dialog?
6. **Ledger anchor**: In ledger view, or in Save/Publish flow?
7. **Narrow screens**: Sidebar overlay or bottom sheet?
