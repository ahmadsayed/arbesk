# Library Page — UI/UX Design

**Status:** Approved (UI/UX only — backend/persistence intentionally out of scope)
**Date:** 2026-06-20

## Purpose

A standalone page for artists who create 3D assets in external tools (today: anything that
exports glTF/GLB) and want to drag those exports in, organize them, and decide which ones to
publish on-chain. It is a GNOME Files (Nautilus) style file manager, themed with Arbesk's
existing libadwaita-derived design tokens — not a browser of already-minted NFTs (that's the
existing Studio sidebar Gallery, which is unaffected by this work).

Two distinct artist actions per file:
- **Save** — happens automatically when a file is dropped in. Local/staging persistence only.
- **Besk it** — an explicit, separate action (right-click) that publishes/mints the file as an
  on-chain asset. Never implicit, never bundled with Save.

Later, the artist picks a file from this page and opens it in Studio to continue editing.

## Scope

This spec covers **UI/UX only**: page structure, components, interaction model, visual styling,
accessibility. No API routes, storage backend, IPFS wiring, or contract calls are designed here —
those are a follow-up spec once this UI is validated. Where the UI implies a future backend hook
(e.g. "Besk it" minting, thumbnail rendering), the design leaves an explicit extension point but
does not implement it.

## Format support

glTF and GLB only, matching the existing pipeline (`frontend/src/js/gltf/`). The upload/drop
validation is a single MIME/extension check (`.gltf`, `.glb`) — deliberately a single, easily
extended gate, since Blender-format support (and other external tools) is a known future
direction but explicitly not part of this work.

## 1. Page & Navigation

- New standalone page: `frontend/src/pug/library.pug`, built via the existing
  `frontend/scripts/render-pug.js` pipeline (any `.pug` under `src/pug/` becomes its own route —
  no router changes needed).
- Shares the existing `headerbar` component (logo, theme toggle, network select, wallet
  connect/disconnect) so Library and Studio feel like one app.
- Headerbar gains a lightweight page switcher (two tabs/buttons: "Library" / "Studio") so the
  artist can move between the file manager and the 3D editor.
- **Whole-page wallet gate**: if no wallet is connected, the content area renders a single
  centered empty-state ("Connect Wallet" call-to-action), reusing the `.empty-state` /
  `#galleryConnectBtn` pattern already in `asset-library.js`. Nothing else (toolbar, grid,
  drop zone) renders until a wallet is connected.

## 2. Layout

```
┌─ headerbar (shared) ──────────────────────────────────────┐
│  logo   [Library | Studio]         theme  network  wallet │
├─ library-toolbar ───────────────────────────────────────────┤
│ ⟨ Home ▸ Characters ▸ Props ⟩   [search…] [Sort ▾] [New Folder] [Upload] │
├─ library-content (drop target, fills remaining height) ───┤
│                                                             │
│   [📁 Folder]  [📁 Folder]  [🗎 file.glb]  [🗎 file.gltf]   │
│   ... grid or list, per view-mode toggle ...               │
│                                                             │
├─ library-statusbar ─────────────────────────────────────────┤
│  12 items · 3 folders          Grid ⊞ / List ☰             │
└─────────────────────────────────────────────────────────────┘
```

- **Breadcrumb**: `⟨ Home ▸ Characters ▸ Props ⟩`, visually derived from the existing `pathbar`
  component (`_pathbar.scss`), repurposed for folder nesting instead of world (child-asset)
  nesting. Clicking a segment navigates to that folder level.
- **Toolbar row**: search input (filters current folder by name), sort dropdown
  (Name / Date / Status), "New Folder" button, "Upload" button (native file picker,
  `accept=".glb,.gltf"` — the click-driven complement to drag-drop).
- **Content area** is the full-height drop target for the current folder. Dragging files over it
  shows a drop-indicator overlay (same visual treatment as Studio's `#assetDropOverlay`), and
  dropping auto-saves the files into the currently open folder.
- **View toggle** (grid/list) sits in a bottom status bar alongside an item count, mirroring
  GNOME Files' bottom-bar placement.

## 3. Folders

- Folders are a flat hierarchy of named containers (no special metadata beyond name + children).
- Created via toolbar "New Folder" or right-click on empty space → "New Folder" — inline rename
  immediately after creation, matching Nautilus.
- Double-click (or Enter while selected) navigates into a folder and updates the breadcrumb.
- `Backspace` / `Alt+Left` navigates up one level, mirroring Studio's existing world
  back-navigation (`#backBtn`, Alt+Left).

## 4. File Items

Each file (grid card or list row) shows:
- **Thumbnail slot**: in v1, a generic glTF/GLB file icon (no rendered preview). The markup
  reserves this slot so a real rendered thumbnail can be substituted later (e.g. once wired to
  the Studio engine) without restructuring the card.
- **Filename** — inline-renameable (F2 or context menu "Rename").
- **Status badge** — one of:
  - `Uploading…` — transient, shown immediately after drop, before auto-save completes
  - `Saved` — default state once auto-save completes (local/staging draft)
  - `Besked` — set after the artist explicitly publishes via "Besk it"
  - Badge reuses the visual pattern of `asset-card-badge` (Owner/Editor) from
    `asset-library.js`.
- List view adds columns: Date modified, Size, Status.

## 5. Selection

Full Nautilus-style selection model:
- Click selects exactly one item, replacing any prior selection.
- `Ctrl`/`Cmd`-click toggles an item in/out of the current selection.
- `Shift`-click range-selects from the last-clicked item.
- Click on empty space clears the selection.
- Drag a rubber-band box over empty space to multi-select by region.
- `Ctrl+A` selects all items in the current folder.

## 6. Drag-and-Drop & Auto-Save

- Dropping `.glb`/`.gltf` files from the desktop anywhere on the content area saves them into the
  *currently open folder*.
- Each dropped file gets its own card immediately, in `Uploading…` state, transitioning to
  `Saved` on completion — no confirmation dialog, no separate "Save" click.
- Files of an unsupported type dropped onto the page are rejected with a toast
  (reusing `toasts.js`) explaining only `.glb`/`.gltf` are supported.

## 7. Context Menus

**Single file selected:**
- **Besk it** — opens a confirm/publish dialog (reusing the `showConfirmDialog` modal pattern).
  On confirm, the file's badge flips from `Saved` to `Besked`.
- **Open in Studio** — navigates to the Studio page with this file loaded. Available regardless
  of `Saved`/`Besked` status.
- **Rename**
- **Move to folder…** — opens a folder-picker dialog listing existing folders.
- **Delete** — destructive, confirm dialog required.

**Single folder selected:**
- Open, Rename, Move to folder…, Delete.

**Multi-selection:**
- Same actions as single-file, applied as a batch (Besk it / Move / Delete act on every selected
  item; Rename is excluded from multi-selection since it requires a unique name per item).

**Empty space (no selection):**
- New Folder, Upload, Paste (enabled only when a cut/copy is pending).

## 8. Visual Treatment

- No new design tokens — reuses `frontend/src/scss/base/_tokens.scss` as-is.
- New component partials: `_library-toolbar.scss`, `_library-grid.scss`, `_context-menu.scss`,
  and an extension to `_pathbar.scss` (or a new `_breadcrumb.scss`) for folder breadcrumbs.
- Cards reuse `--radius-2`, `--shadow-1`/`--shadow-2` hover elevation, and
  `--surface-overlay-hover`/`--surface-overlay-active` for hover/press states, consistent with
  the existing `asset-card` styling in `_cards.scss`.
- The context menu is a libadwaita-style popover: `--popover-bg`, `--popover-glass-bg`,
  `--shadow-3`, dismissed on outside-click or `Escape`, fully keyboard-navigable (arrow keys to
  move, `Enter` to activate, `Escape` to close) per GNOME HIG menu conventions.

## 9. Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl+A` | Select all in current folder |
| `Delete` | Delete selection (confirm dialog) |
| `F2` | Rename selected item |
| `Enter` | Open selected item (file → Studio, folder → navigate in) |
| `Backspace` / `Alt+Left` | Navigate up one folder level |
| `Escape` | Clear selection / close open menu |

## 10. Empty States

Reusing the `.empty-state` pattern already used throughout the app:
- **No wallet connected** (page-level gate): "Connect Wallet" prompt, blocks all other content.
- **Empty folder**: "Drag files here to get started," with a dashed-border drop-zone treatment.
- **No search results**: "No files match your search."

## 11. Accessibility

- Grid/list container: `role="grid"`/`listbox` semantics with `aria-multiselectable="true"`,
  items carry `aria-selected`.
- All interactive controls (toolbar buttons, context menu items, badges-as-buttons) get
  appropriate `aria-label`/`title`, matching existing studio.pug conventions.
- An `sr-only` live region (mirroring `#commentsLiveRegion`'s pattern) announces selection count
  changes and status transitions (e.g. "3 items selected," "model.glb saved," "model.glb
  besked").
- Context menu is fully keyboard-operable (no mouse-only paths).

## Out of Scope (explicitly deferred)

- Backend/API routes for upload, save, folder persistence, or Besk it/minting.
- Real rendered thumbnails (slot reserved in markup only).
- Non-glTF/GLB format support (e.g. Blender-native formats).
- Drag-drop *between* folders within the grid (move via context menu only, in v1).
- Sharing/collaboration on Library files (collaboration only exists today at the on-chain asset
  level, via Studio's Settings panel).
