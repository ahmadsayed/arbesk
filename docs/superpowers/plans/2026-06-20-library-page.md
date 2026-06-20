# Library Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, Nautilus-style Library page where artists drag in glTF/GLB exports, organize them into folders, and explicitly "Besk it" (publish) selected files — all UI/UX, no backend.

**Architecture:** A new `library.pug` page shares the headerbar chrome (theme, network, wallet) with `studio.pug` via a small additive page-switcher, but does not share Pug includes (no partial system exists yet in this codebase, and introducing one is unjustified for two pages) — headerbar markup is duplicated by hand, matching existing ids so `wallet.js`/`theme.js`/`wallet-popover.js` work unchanged. All Library data (folders, files, selection, view mode, sort, search) lives in a new in-memory `libraryState` store (no persistence — matches spec's "local/staging only" scope). Four new JS modules layer cleanly: `library-items.js` (pure helpers, no DOM) → `library-grid.js` (rendering, selection, drag-drop/upload, keyboard shortcuts) → `library-toolbar.js` + `library-context-menu.js` (both depend on `library-grid.js`'s exports) → `library-init.js` (page bootstrap, wallet gate).

**Tech Stack:** Pug, SCSS, vanilla ES modules, Jest (`@jest-environment jsdom` for DOM-touching tests). Build via `npm run build:frontend`. No new dependencies.

## Global Constraints

- Format gate is a single extension check (`.gltf`, `.glb` only) — do not build a generic plugin system for formats.
- No backend/API routes, no IPFS, no contract calls. "Besk it" only flips local in-memory status from `wip` to `besked`.
- No real thumbnails — generic file icon only, but markup must reserve the thumbnail slot.
- Whole-page wallet gate: nothing in `#libraryMain` renders/functions until a wallet is connected.
- Drag-and-drop *between* folders in the grid is out of scope — moving files only happens via the context menu's "Move to folder…".
- Reuse existing primitives verbatim: `showDialog`/`showConfirmDialog` (`frontend/src/js/ui/dialog.js`), `showToast` (`frontend/src/js/ui/toasts.js`), `escapeHtml` (`frontend/src/js/utils/html.js`), the `createStore` pattern (`frontend/src/js/state/create-store.js`), and the `.empty-state` / `asset-card-badge` / `.viewport-drop-indicator` CSS patterns already in `_empty-state.scss` / `_cards.scss` / `_viewport.scss`.
- Spec: `docs/superpowers/specs/2026-06-20-library-page-design.md`. Approved mockups: `/tmp/library-mockups/library-grid.html`, `library-list.html`, `library-empty-drop.html`.
- **Grid vs. list status badge treatment is symmetric** (confirmed by user, supersedes an earlier asymmetric draft): grid view shows a small flag icon for `wip` files and a checkmark icon for `besked` files — every card gets an icon, not just `besked` ones. List view always shows text badges (`Work in Progress` / `Besked`). The status value/enum is `wip` (renamed from `saved` — "Saved" implied false permanence for a local-only draft); the UI label is "Work in Progress," chosen as artist-friendly vocabulary (used on Sketchfab/ArtStation/itch.io) over dev jargon like "Staged"/"Drafted". The "Save" action name (auto-save on drop) is unchanged — only the post-save status label/enum changed.

---

## File Map

| File | What changes |
|------|-------------|
| `frontend/src/js/events/bus.js` | Add `LIBRARY_STATE_CHANGED` event constant |
| `frontend/src/js/state/library-state.js` | New — `libraryState` store (folders, files, selection, view/sort/search) |
| `frontend/src/js/utils/library-items.js` | New — pure helpers: filtering/sorting/breadcrumb/range-selection/format |
| `frontend/src/pug/library.pug` | New — standalone page |
| `frontend/src/pug/studio.pug` | Modify — add page-switcher to headerbar (additive only) |
| `frontend/src/scss/components/_headerbar.scss` | Modify — add `.page-switcher` rules |
| `frontend/src/scss/components/_library-toolbar.scss` | New — toolbar + breadcrumb styles |
| `frontend/src/scss/components/_library-grid.scss` | New — grid/list item, status badge, statusbar styles |
| `frontend/src/scss/components/_library-context-menu.scss` | New — context menu popover styles |
| `frontend/src/scss/styles.scss` | Modify — `@use` the three new partials |
| `frontend/src/js/library-init.js` | New — page bootstrap: wallet gate, theme, wires the other modules |
| `frontend/src/js/ui/library-grid.js` | New — rendering, selection, drag-drop/upload, keyboard shortcuts |
| `frontend/src/js/ui/library-toolbar.js` | New — breadcrumb, search, sort, new folder, upload button, view toggle |
| `frontend/src/js/ui/library-context-menu.js` | New — right-click menu + actions |

**No changes needed in:** `wallet.js`, `theme.js`, `wallet-popover.js`, `dialog.js`, `toasts.js`, `asset-library.js` — all consumed as-is by id/import.

---

## Task 1: `libraryState` store + pure item helpers

**Files:**
- Modify: `frontend/src/js/events/bus.js`
- Create: `frontend/src/js/state/library-state.js`
- Test: `test/state/library-state.test.js`
- Create: `frontend/src/js/utils/library-items.js`
- Test: `test/library-items.test.js`

**Interfaces:**
- Consumes: `createStore(defaults, eventName)` from `frontend/src/js/state/create-store.js` (existing); `escapeHtml` from `frontend/src/js/utils/html.js` (existing).
- Produces: `libraryState` (`.get()`/`.set(patch)`/`.reset()`), `_resetForTesting()`; `EVENTS.LIBRARY_STATE_CHANGED`; and from `library-items.js`: `isSupportedFile(filename) -> boolean`, `getChildItems(state, folderId) -> Array<{id,type,name,status,dateModified,sizeBytes}>`, `filterItems(items, searchQuery) -> Array`, `sortItems(items, sortBy) -> Array`, `buildBreadcrumb(folders, currentFolderId) -> Array<{id,name}>`, `computeRangeSelection(items, anchorId, targetId) -> Array<id>`, `formatBytes(bytes) -> string`.

- [ ] **Step 1: Write the failing state test**

  Create `test/state/library-state.test.js`:

  ```js
  /**
   * @jest-environment jsdom
   */
  import { libraryState, _resetForTesting } from "../../frontend/src/js/state/library-state.js";
  import { on, off, EVENTS } from "../../frontend/src/js/events/bus.js";

  beforeEach(() => _resetForTesting());

  describe("libraryState.get()", () => {
    test("returns defaults", () => {
      expect(libraryState.get()).toEqual({
        folders: [],
        files: [],
        currentFolderId: null,
        selectedIds: [],
        viewMode: "grid",
        sortBy: "name",
        searchQuery: "",
      });
    });
  });

  describe("libraryState.set()", () => {
    test("merges partial update", () => {
      libraryState.set({ currentFolderId: "f1" });
      expect(libraryState.get().currentFolderId).toBe("f1");
      expect(libraryState.get().viewMode).toBe("grid");
    });

    test("emits LIBRARY_STATE_CHANGED with full state", () => {
      return new Promise((resolve) => {
        const handler = (payload) => {
          off(EVENTS.LIBRARY_STATE_CHANGED, handler);
          expect(payload.currentFolderId).toBe("f1");
          resolve();
        };
        on(EVENTS.LIBRARY_STATE_CHANGED, handler);
        libraryState.set({ currentFolderId: "f1" });
      });
    });
  });

  describe("libraryState.reset()", () => {
    test("restores defaults", () => {
      libraryState.set({ currentFolderId: "f1", viewMode: "list" });
      libraryState.reset();
      expect(libraryState.get().currentFolderId).toBeNull();
      expect(libraryState.get().viewMode).toBe("grid");
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/state/library-state.test.js --runInBand`
  Expected: FAIL — `Cannot find module '../../frontend/src/js/state/library-state.js'`

- [ ] **Step 3: Add the event constant**

  In `frontend/src/js/events/bus.js`, find:

  ```js
  export const EVENTS = {
    ASSET_ADD_LINKED_REQUESTED: "asset:addLinkedRequested",
    ASSET_BURNED:               "asset:burned",
    ASSET_CLEARED:              "asset:cleared",
    ASSET_DRAFT_SAVED:          "asset:draftSaved",
    ASSET_LINKED_DROPPED:       "asset:linkedDropped",
    ASSET_OPEN_BY_TOKEN_ID:     "asset:openByTokenId",
    ASSET_PUBLISHED:            "asset:published",
    ASSET_STATE_CHANGED:        "asset:stateChanged",
    COMMENT_THREAD_CHANGE:      "commentThread:change",
    COMMENT_THREAD_STATUS:      "commentThread:status",
    NESTING_DID_ASCEND:         "nesting:didAscend",
  ```

  Replace with (inserting `LIBRARY_STATE_CHANGED` in alphabetical order):

  ```js
  export const EVENTS = {
    ASSET_ADD_LINKED_REQUESTED: "asset:addLinkedRequested",
    ASSET_BURNED:               "asset:burned",
    ASSET_CLEARED:              "asset:cleared",
    ASSET_DRAFT_SAVED:          "asset:draftSaved",
    ASSET_LINKED_DROPPED:       "asset:linkedDropped",
    ASSET_OPEN_BY_TOKEN_ID:     "asset:openByTokenId",
    ASSET_PUBLISHED:            "asset:published",
    ASSET_STATE_CHANGED:        "asset:stateChanged",
    COMMENT_THREAD_CHANGE:      "commentThread:change",
    COMMENT_THREAD_STATUS:      "commentThread:status",
    LIBRARY_STATE_CHANGED:      "library:stateChanged",
    NESTING_DID_ASCEND:         "nesting:didAscend",
  ```

- [ ] **Step 4: Create the state module**

  Create `frontend/src/js/state/library-state.js`:

  ```js
  import { createStore } from "./create-store.js";
  import { EVENTS } from "../events/bus.js";

  const _defaults = {
    folders: [],
    files: [],
    currentFolderId: null,
    selectedIds: [],
    viewMode: "grid",
    sortBy: "name",
    searchQuery: "",
  };

  const { store: libraryState, _resetForTesting } = createStore(_defaults, EVENTS.LIBRARY_STATE_CHANGED);
  export { libraryState, _resetForTesting };
  ```

- [ ] **Step 5: Run the state test to verify it passes**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/state/library-state.test.js --runInBand`
  Expected: PASS (4 tests)

- [ ] **Step 6: Write the failing item-helpers test**

  Create `test/library-items.test.js`:

  ```js
  import {
    isSupportedFile,
    getChildItems,
    filterItems,
    sortItems,
    buildBreadcrumb,
    computeRangeSelection,
    formatBytes,
  } from "../frontend/src/js/utils/library-items.js";

  describe("isSupportedFile", () => {
    test("accepts .glb and .gltf, case-insensitively", () => {
      expect(isSupportedFile("model.glb")).toBe(true);
      expect(isSupportedFile("model.GLTF")).toBe(true);
      expect(isSupportedFile("model.blend")).toBe(false);
      expect(isSupportedFile("model.fbx")).toBe(false);
    });
  });

  describe("getChildItems", () => {
    const state = {
      folders: [
        { id: "root-folder", name: "Weapons", parentId: null },
        { id: "nested-folder", name: "Swords", parentId: "root-folder" },
      ],
      files: [
        { id: "file-1", name: "shield.glb", parentId: null, status: "wip", sizeBytes: 1024, dateModified: 100 },
        { id: "file-2", name: "sword.glb", parentId: "root-folder", status: "besked", sizeBytes: 2048, dateModified: 200 },
      ],
    };

    test("returns folders and files for the given parentId only", () => {
      const rootItems = getChildItems(state, null);
      expect(rootItems).toHaveLength(2);
      expect(rootItems.find((i) => i.id === "root-folder").type).toBe("folder");
      expect(rootItems.find((i) => i.id === "file-1").type).toBe("file");

      const nestedItems = getChildItems(state, "root-folder");
      expect(nestedItems).toHaveLength(2);
      expect(nestedItems.map((i) => i.id).sort()).toEqual(["file-2", "nested-folder"]);
    });
  });

  describe("filterItems", () => {
    const items = [{ id: "1", name: "Shield.glb" }, { id: "2", name: "Sword.gltf" }];

    test("returns all items for an empty query", () => {
      expect(filterItems(items, "")).toHaveLength(2);
    });

    test("filters case-insensitively by name substring", () => {
      expect(filterItems(items, "shi")).toEqual([items[0]]);
    });
  });

  describe("sortItems", () => {
    test("folders always sort before files regardless of sortBy", () => {
      const items = [
        { id: "f1", type: "file", name: "b.glb", status: "wip", dateModified: 1 },
        { id: "d1", type: "folder", name: "z-folder", status: null, dateModified: null },
      ];
      const sorted = sortItems(items, "name");
      expect(sorted.map((i) => i.id)).toEqual(["d1", "f1"]);
    });

    test("sortBy 'name' orders files alphabetically within the file group", () => {
      const items = [
        { id: "b", type: "file", name: "banana.glb", dateModified: 1, status: "wip" },
        { id: "a", type: "file", name: "apple.glb", dateModified: 2, status: "wip" },
      ];
      expect(sortItems(items, "name").map((i) => i.id)).toEqual(["a", "b"]);
    });

    test("sortBy 'date' orders files newest first", () => {
      const items = [
        { id: "old", type: "file", name: "old.glb", dateModified: 1, status: "wip" },
        { id: "new", type: "file", name: "new.glb", dateModified: 2, status: "wip" },
      ];
      expect(sortItems(items, "date").map((i) => i.id)).toEqual(["new", "old"]);
    });

    test("sortBy 'status' orders uploading, then wip, then besked", () => {
      const items = [
        { id: "b", type: "file", name: "b.glb", status: "besked", dateModified: 1 },
        { id: "u", type: "file", name: "u.glb", status: "uploading", dateModified: 1 },
        { id: "s", type: "file", name: "s.glb", status: "wip", dateModified: 1 },
      ];
      expect(sortItems(items, "status").map((i) => i.id)).toEqual(["u", "s", "b"]);
    });
  });

  describe("buildBreadcrumb", () => {
    const folders = [
      { id: "f1", name: "Characters", parentId: null },
      { id: "f2", name: "Heroes", parentId: "f1" },
    ];

    test("returns just Home at the root", () => {
      expect(buildBreadcrumb(folders, null)).toEqual([{ id: null, name: "Home" }]);
    });

    test("returns the full ancestor chain ending at the current folder", () => {
      expect(buildBreadcrumb(folders, "f2")).toEqual([
        { id: null, name: "Home" },
        { id: "f1", name: "Characters" },
        { id: "f2", name: "Heroes" },
      ]);
    });
  });

  describe("computeRangeSelection", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

    test("selects the inclusive range between anchor and target, regardless of direction", () => {
      expect(computeRangeSelection(items, "a", "c")).toEqual(["a", "b", "c"]);
      expect(computeRangeSelection(items, "c", "a")).toEqual(["a", "b", "c"]);
    });

    test("falls back to just the target if the anchor is not found", () => {
      expect(computeRangeSelection(items, "missing", "b")).toEqual(["b"]);
    });
  });

  describe("formatBytes", () => {
    test("formats bytes, KB, and MB", () => {
      expect(formatBytes(512)).toBe("512 B");
      expect(formatBytes(2048)).toBe("2.0 KB");
      expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    });
  });
  ```

- [ ] **Step 7: Run it to verify it fails**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-items.test.js --runInBand`
  Expected: FAIL — `Cannot find module '../frontend/src/js/utils/library-items.js'`

- [ ] **Step 8: Implement the pure helpers**

  Create `frontend/src/js/utils/library-items.js`:

  ```js
  const SUPPORTED_EXTENSIONS = [".glb", ".gltf"];

  export function isSupportedFile(filename) {
    const lower = String(filename).toLowerCase();
    return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  export function getChildItems(state, folderId) {
    const folders = state.folders
      .filter((f) => f.parentId === folderId)
      .map((f) => ({ id: f.id, type: "folder", name: f.name, status: null, dateModified: null, sizeBytes: null }));
    const files = state.files
      .filter((f) => f.parentId === folderId)
      .map((f) => ({ id: f.id, type: "file", name: f.name, status: f.status, dateModified: f.dateModified, sizeBytes: f.sizeBytes }));
    return [...folders, ...files];
  }

  export function filterItems(items, searchQuery) {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }

  export function sortItems(items, sortBy) {
    const sorted = [...items];
    if (sortBy === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "date") {
      sorted.sort((a, b) => (b.dateModified || 0) - (a.dateModified || 0));
    } else if (sortBy === "status") {
      const rank = { uploading: 0, wip: 1, besked: 2 };
      sorted.sort((a, b) => (rank[a.status] ?? -1) - (rank[b.status] ?? -1));
    }
    const folders = sorted.filter((i) => i.type === "folder");
    const files = sorted.filter((i) => i.type === "file");
    return [...folders, ...files];
  }

  export function buildBreadcrumb(folders, currentFolderId) {
    const path = [];
    let id = currentFolderId;
    while (id !== null) {
      const folder = folders.find((f) => f.id === id);
      if (!folder) break;
      path.unshift({ id: folder.id, name: folder.name });
      id = folder.parentId;
    }
    return [{ id: null, name: "Home" }, ...path];
  }

  export function computeRangeSelection(items, anchorId, targetId) {
    const ids = items.map((i) => i.id);
    const anchorIndex = ids.indexOf(anchorId);
    const targetIndex = ids.indexOf(targetId);
    if (anchorIndex === -1 || targetIndex === -1) return [targetId];
    const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
    return ids.slice(start, end + 1);
  }

  export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  ```

- [ ] **Step 9: Run it to verify it passes**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-items.test.js --runInBand`
  Expected: PASS (12 tests)

- [ ] **Step 10: Commit**

  ```bash
  git add frontend/src/js/events/bus.js frontend/src/js/state/library-state.js frontend/src/js/utils/library-items.js test/state/library-state.test.js test/library-items.test.js
  git commit -m "feat(library): add libraryState store and pure item helpers"
  ```

---

## Task 2: `library.pug` page + headerbar page-switcher + SCSS scaffolding

**Files:**
- Create: `frontend/src/pug/library.pug`
- Modify: `frontend/src/pug/studio.pug`
- Modify: `frontend/src/scss/components/_headerbar.scss`
- Create: `frontend/src/scss/components/_library-toolbar.scss`
- Create: `frontend/src/scss/components/_library-grid.scss`
- Create: `frontend/src/scss/components/_library-context-menu.scss`
- Modify: `frontend/src/scss/styles.scss`
- Test: `test/frontend/library-build.test.js`

**Interfaces:**
- Consumes: nothing yet (markup only — JS modules wired in later tasks).
- Produces: built `frontend/dist/library.html` with ids `libraryGate`, `libraryConnectBtn`, `libraryMain`, `libraryBreadcrumb`, `librarySearchInput`, `librarySortSelect`, `libraryNewFolderBtn`, `libraryUploadBtn`, `libraryFileInput`, `libraryContent`, `libraryDropOverlay`, `libraryItems`, `libraryItemCount`, `libraryGridViewBtn`, `libraryListViewBtn`, `libraryLiveRegion`, plus the standard headerbar ids (`themeToggle`, `headerbarNetworkSelect`, `connectWalletBtn`, `disconnectWalletBtn`, `walletPopover` and its children). Built `frontend/dist/studio.html` gains a `.page-switcher` with the same two links.

- [ ] **Step 1: Write the failing build test**

  Create `test/frontend/library-build.test.js`:

  ```js
  import fs from "fs";
  import path from "path";
  import url from "url";

  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const DIST = path.resolve(__dirname, "../../frontend/dist");

  function readDist(name) {
    return fs.readFileSync(path.join(DIST, name), "utf-8");
  }

  describe("Library page build", () => {
    test("library.html exists and has the wallet gate + main containers", () => {
      const html = readDist("library.html");
      expect(html).toMatch(/id="libraryGate"/);
      expect(html).toMatch(/id="libraryConnectBtn"/);
      expect(html).toMatch(/id="libraryMain"/);
      expect(html).toMatch(/class="[^"]*hidden[^"]*"\s+id="libraryMain"|id="libraryMain"\s+class="[^"]*hidden/);
    });

    test("library.html has the toolbar, content, and statusbar regions", () => {
      const html = readDist("library.html");
      expect(html).toMatch(/id="libraryBreadcrumb"/);
      expect(html).toMatch(/id="librarySearchInput"/);
      expect(html).toMatch(/id="librarySortSelect"/);
      expect(html).toMatch(/id="libraryNewFolderBtn"/);
      expect(html).toMatch(/id="libraryUploadBtn"/);
      expect(html).toMatch(/id="libraryFileInput"[^>]*accept="\.glb,\.gltf"/);
      expect(html).toMatch(/id="libraryContent"/);
      expect(html).toMatch(/id="libraryDropOverlay"/);
      expect(html).toMatch(/id="libraryItems"/);
      expect(html).toMatch(/id="libraryItemCount"/);
      expect(html).toMatch(/id="libraryGridViewBtn"/);
      expect(html).toMatch(/id="libraryListViewBtn"/);
      expect(html).toMatch(/id="libraryLiveRegion"/);
    });

    test("library.html shares the headerbar wallet ids with studio.html", () => {
      const html = readDist("library.html");
      expect(html).toMatch(/id="themeToggle"/);
      expect(html).toMatch(/id="headerbarNetworkSelect"/);
      expect(html).toMatch(/id="connectWalletBtn"/);
      expect(html).toMatch(/id="disconnectWalletBtn"/);
      expect(html).toMatch(/id="walletPopover"/);
    });

    test("library.html loads library-init.js as a module script", () => {
      const html = readDist("library.html");
      expect(html).toMatch(/<script[^>]+type="module"[^>]+src="\/js\/library-init\.js"/);
    });

    test("studio.html gains a page-switcher with Library and Studio links", () => {
      const html = readDist("studio.html");
      expect(html).toMatch(/class="page-switcher"/);
      expect(html).toMatch(/href="\/library\.html"/);
      expect(html).toMatch(/href="\/studio\.html"/);
    });

    test("library.html has its own page-switcher with Library active", () => {
      const html = readDist("library.html");
      expect(html).toMatch(/class="page-switcher"/);
      expect(html).toMatch(/href="\/library\.html"/);
      expect(html).toMatch(/href="\/studio\.html"/);
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/library-build.test.js --runInBand`
  Expected: FAIL — `frontend/dist/library.html` does not exist (ENOENT)

- [ ] **Step 3: Add the page-switcher to studio.pug**

  In `frontend/src/pug/studio.pug`, find:

  ```pug
        .headerbar-brand
          img.logo-light(src="/logo.webp", alt="Arbesk")
          img.logo-dark(src="/logo-dark.webp", alt="Arbesk")

        button#backBtn.headerbar-back.hidden(aria-label="Go back to parent world", title="Go back (Alt+Left)")
  ```

  Replace with:

  ```pug
        .headerbar-brand
          img.logo-light(src="/logo.webp", alt="Arbesk")
          img.logo-dark(src="/logo-dark.webp", alt="Arbesk")

        nav.page-switcher(aria-label="Page")
          a.page-switcher-tab(href="/library.html") Library
          a.page-switcher-tab.active(href="/studio.html") Studio

        button#backBtn.headerbar-back.hidden(aria-label="Go back to parent world", title="Go back (Alt+Left)")
  ```

- [ ] **Step 4: Add `.page-switcher` styles**

  In `frontend/src/scss/components/_headerbar.scss`, find:

  ```scss
  // Back button (nested only)
  .headerbar-back {
  ```

  Replace with:

  ```scss
  // Page switcher (Library / Studio)
  .page-switcher {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: var(--size-3);
    padding: 2px;
    border-radius: var(--radius-round);
    background-color: var(--surface-overlay-hover);
    flex-shrink: 0;
  }

  .page-switcher-tab {
    padding: 4px var(--size-3);
    border-radius: var(--radius-round);
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-6);
    color: var(--dim-fg);
    text-decoration: none;
    white-space: nowrap;

    &:hover {
      color: var(--headerbar-fg);
    }

    &:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
    }

    &.active {
      background-color: var(--accent-bg);
      color: var(--accent-fg);
    }
  }

  // Back button (nested only)
  .headerbar-back {
  ```

- [ ] **Step 5: Create `library.pug`**

  Create `frontend/src/pug/library.pug`:

  ```pug
  doctype html
  html(lang="en")
    head
      title Arbesk Library
      meta(charset="utf-8")
      meta(name="viewport", content="width=device-width, initial-scale=1")
      link(rel="icon", type="image/webp", href="/logo.webp")
      link(rel="apple-touch-icon", href="/apple-touch-icon.webp")
      link(rel="stylesheet", href="/css/styles.css")
      script(src="/js/engine/theme-init.js")
      script(src="https://cdn.jsdelivr.net/npm/notyf@3.10.0/notyf.min.js" crossorigin="anonymous")
      script(src="https://cdn.jsdelivr.net/npm/tabbable@6.2.0/dist/index.umd.min.js" crossorigin="anonymous")
      script(src="https://cdn.jsdelivr.net/npm/focus-trap@7.6.2/dist/focus-trap.umd.min.js" crossorigin="anonymous")
      script(src="https://cdn.jsdelivr.net/npm/web3@1.10.0/dist/web3.min.js" crossorigin="anonymous")
    body
      #app
        header.headerbar
          h1.sr-only Arbesk Library
          .headerbar-brand
            img.logo-light(src="/logo.webp", alt="Arbesk")
            img.logo-dark(src="/logo-dark.webp", alt="Arbesk")

          nav.page-switcher(aria-label="Page")
            a.page-switcher-tab.active(href="/library.html") Library
            a.page-switcher-tab(href="/studio.html") Studio

          .headerbar-actions
            button#themeToggle.btn.btn-icon.btn-flat(aria-label="Toggle theme" title="Toggle theme")
              svg.theme-icon-light(width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                circle(cx="12" cy="12" r="5")
                line(x1="12" y1="1" x2="12" y2="3")
                line(x1="12" y1="21" x2="12" y2="23")
                line(x1="4.22" y1="4.22" x2="5.64" y2="5.64")
                line(x1="18.36" y1="18.36" x2="19.78" y2="19.78")
                line(x1="1" y1="12" x2="3" y2="12")
                line(x1="21" y1="12" x2="23" y2="12")
                line(x1="4.22" y1="19.78" x2="5.64" y2="18.36")
                line(x1="18.36" y1="5.64" x2="19.78" y2="4.22")
              svg.theme-icon-dark(width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                path(d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z")
            select#headerbarNetworkSelect.headerbar-network-select(aria-label="Select network" title="Select network")
              option(value="hardhat" selected) Hardhat Local
              option(value="seiTestnet") SEI Testnet
            button#connectWalletBtn.headerbar-wallet.disconnected(aria-label="Connect wallet")
              svg(width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                path(d="M21 12V7H5a2 2 0 0 1 0-4h14v4")
                path(d="M3 5v14a2 2 0 0 0 2 2h16v-5")
                path(d="M18 12a2 2 0 0 0 0 4h4v-4Z")
              span Connect Wallet
            button#disconnectWalletBtn.headerbar-wallet.hidden(aria-label="Wallet menu")
              svg(width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                path(d="M21 12V7H5a2 2 0 0 1 0-4h14v4")
                path(d="M3 5v14a2 2 0 0 0 2 2h16v-5")
                path(d="M18 12a2 2 0 0 0 0 4h4v-4Z")
              span#disconnectWalletBtnText Disconnect

        .library-layout
          #libraryGate
            .empty-state
              .empty-state-icon
                svg(width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                  path(d="M21 12V7H5a2 2 0 0 1 0-4h14v4")
                  path(d="M3 5v14a2 2 0 0 0 2 2h16v-5")
                  path(d="M18 12a2 2 0 0 0 0 4h4v-4Z")
              p.empty-state-title No wallet connected
              p.empty-state-sub Connect your wallet to organize and publish your 3D assets.
              button#libraryConnectBtn.empty-state-action.btn.btn-primary.btn-sm(type="button") Connect Wallet

          #libraryMain.hidden
            .library-toolbar
              nav#libraryBreadcrumb.pathbar(aria-label="Folder path")
              input#librarySearchInput.form-input.library-search(type="search" placeholder="Search this folder…" aria-label="Search files")
              select#librarySortSelect.form-input.library-sort(aria-label="Sort by")
                option(value="name") Name
                option(value="date") Date
                option(value="status") Status
              button#libraryNewFolderBtn.btn.btn-secondary.btn-sm(type="button")
                svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                  line(x1="12" y1="5" x2="12" y2="19")
                  line(x1="5" y1="12" x2="19" y2="12")
                span New Folder
              button#libraryUploadBtn.btn.btn-primary.btn-sm(type="button")
                svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                  path(d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4")
                  polyline(points="17 8 12 3 7 8")
                  line(x1="12" y1="3" x2="12" y2="15")
                span Upload
              input#libraryFileInput(type="file" multiple accept=".glb,.gltf" hidden)

            #libraryContent.library-content
              #libraryDropOverlay.viewport-drop-indicator
              #libraryItems.library-grid(role="grid" aria-multiselectable="true")

            .library-statusbar
              span#libraryItemCount.library-statusbar-count 0 items
              .library-view-toggle(role="group" aria-label="View mode")
                button#libraryGridViewBtn.active(type="button" data-view="grid" aria-label="Grid view" title="Grid view")
                  svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                    rect(x="3" y="3" width="7" height="7")
                    rect(x="14" y="3" width="7" height="7")
                    rect(x="3" y="14" width="7" height="7")
                    rect(x="14" y="14" width="7" height="7")
                button#libraryListViewBtn(type="button" data-view="list" aria-label="List view" title="List view")
                  svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                    line(x1="8" y1="6" x2="21" y2="6")
                    line(x1="8" y1="12" x2="21" y2="12")
                    line(x1="8" y1="18" x2="21" y2="18")
                    line(x1="3" y1="6" x2="3.01" y2="6")
                    line(x1="3" y1="12" x2="3.01" y2="12")
                    line(x1="3" y1="18" x2="3.01" y2="18")

            #libraryLiveRegion.sr-only(aria-live="polite" aria-atomic="true")

        #walletPopover.wallet-popover.hidden(aria-label="Wallet menu")
          .wallet-popover-header
            span#walletPopoverAddress.wallet-popover-address —
            button#walletPopoverCopy.wallet-popover-copy(type="button") Copy
          a#walletPopoverExplorer.wallet-popover-explorer.hidden(href="#" target="_blank" rel="noopener noreferrer")
            | View on Explorer
            svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
              path(d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6")
              polyline(points="15 3 21 3 21 9")
              line(x1="10" y1="14" x2="21" y2="3")
          .wallet-popover-actions
            button#walletPopoverSignIn.wallet-popover-signin.btn.btn-primary.btn-sm.hidden(type="button") Sign In
            button#walletPopoverDisconnect.wallet-popover-disconnect.btn.btn-danger.btn-sm(type="button") Disconnect Wallet

      script(type="module", src="/js/library-init.js")
  ```

- [ ] **Step 6: Create the SCSS partials**

  Create `frontend/src/scss/components/_library-toolbar.scss`:

  ```scss
  // ═══════════════════════════════════════════════════════════════════
  // Library Toolbar — breadcrumb, search, sort, new folder, upload
  // ═══════════════════════════════════════════════════════════════════

  .library-layout {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  .library-toolbar {
    display: flex;
    align-items: center;
    gap: var(--size-2);
    padding: var(--size-2) var(--size-3);
    border-bottom: var(--border-size-1) solid var(--border-hairline);
    flex-shrink: 0;
  }

  .library-search {
    flex: 0 1 240px;
  }

  .library-sort {
    flex: 0 0 auto;
  }
  ```

  Create `frontend/src/scss/components/_library-grid.scss`:

  ```scss
  // ═══════════════════════════════════════════════════════════════════
  // Library Grid/List — items, status badges, statusbar
  // ═══════════════════════════════════════════════════════════════════

  .library-content {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: var(--size-3);
  }

  .library-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--size-3);
  }

  .library-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--size-2);
    padding: var(--size-3);
    border-radius: var(--radius-2);
    cursor: pointer;

    &:hover {
      background-color: var(--surface-overlay-hover);
    }

    &.selected {
      background-color: var(--surface-overlay-active);
      box-shadow: var(--focus-ring);
    }
  }

  .library-item-thumbnail {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-5);
    border-radius: var(--radius-2);
    background-color: rgb(0 0 0 / 15%);
  }

  .library-item-name {
    max-width: 100%;
    font-size: var(--font-size-0);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .library-list-table {
    width: 100%;
    border-collapse: collapse;

    th {
      text-align: left;
      font-size: var(--font-size-0);
      color: var(--dim-fg);
      padding: var(--size-2);
      border-bottom: var(--border-size-1) solid var(--border-hairline);
    }
  }

  .library-row {
    cursor: pointer;

    &:hover {
      background-color: var(--surface-overlay-hover);
    }

    &.selected {
      background-color: var(--surface-overlay-active);
    }

    td {
      padding: var(--size-2);
      font-size: var(--font-size-1);
    }
  }

  .library-row-name {
    display: flex;
    align-items: center;
    gap: var(--size-2);
  }

  .status-badge {
    font-size: 9px;
    font-weight: var(--font-weight-6);
    padding: 2px 8px;
    border-radius: var(--radius-round);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .status-uploading {
    background-color: var(--yellow-4);
    color: #2a1a0e;
  }

  .status-wip {
    background-color: color-mix(in srgb, var(--dim-fg) 25%, var(--card-bg));
    color: var(--window-fg);
  }

  .status-besked {
    background-color: var(--accent-bg);
    color: var(--accent-fg);
  }

  .status-check,
  .status-flag {
    position: absolute;
    bottom: -3px;
    right: -3px;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-round);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-1);

    svg {
      width: 11px;
      height: 11px;
    }
  }

  .status-check {
    background-color: var(--accent-bg);
    color: var(--accent-fg);
  }

  .status-flag {
    background-color: color-mix(in srgb, var(--dim-fg) 35%, var(--card-bg));
    color: var(--window-fg);
  }

  .library-statusbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--size-2) var(--size-3);
    border-top: var(--border-size-1) solid var(--border-hairline);
    color: var(--dim-fg);
    font-size: var(--font-size-0);
    flex-shrink: 0;
  }

  .library-view-toggle {
    display: flex;
    gap: 2px;

    button {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-2);
      color: var(--dim-fg);

      &.active {
        background-color: var(--surface-overlay-active);
        color: var(--headerbar-fg);
      }
    }
  }
  ```

  Create `frontend/src/scss/components/_library-context-menu.scss`:

  ```scss
  // ═══════════════════════════════════════════════════════════════════
  // Library Context Menu — libadwaita-style popover
  // ═══════════════════════════════════════════════════════════════════

  .context-menu {
    position: fixed;
    z-index: 80;
    min-width: 200px;
    padding: var(--size-1);
    border-radius: var(--radius-3);
    background-color: var(--popover-bg);
    backdrop-filter: blur(12px);
    box-shadow: var(--shadow-3);
    border: var(--border-size-1) solid var(--border-color);
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: var(--size-2);
    width: 100%;
    padding: var(--size-2) var(--size-3);
    border-radius: var(--radius-2);
    font-size: var(--font-size-1);
    color: var(--headerbar-fg);
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background-color: var(--surface-overlay-hover);
      outline: none;
    }

    &.context-menu-item-primary {
      color: var(--accent-bg);
    }

    &.context-menu-item-danger {
      color: var(--error-bg, #c01c28);
    }
  }

  .context-menu-separator {
    height: var(--border-size-1);
    margin: var(--size-1) 0;
    background-color: var(--border-hairline);
  }
  ```

- [ ] **Step 7: Wire the new partials into `styles.scss`**

  In `frontend/src/scss/styles.scss`, find:

  ```scss
  @use 'components/wallet-popover';
  @use 'components/wallet-modal';
  @use 'components/toasts';
  ```

  Replace with:

  ```scss
  @use 'components/wallet-popover';
  @use 'components/wallet-modal';
  @use 'components/toasts';
  @use 'components/library-toolbar';
  @use 'components/library-grid';
  @use 'components/library-context-menu';
  ```

- [ ] **Step 8: Build the frontend**

  Run: `npm run build:frontend`
  Expected: exits 0, writes `frontend/dist/library.html` and rewrites `frontend/dist/studio.html`

- [ ] **Step 9: Run the build test to verify it passes**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/library-build.test.js --runInBand`
  Expected: PASS (6 tests)

- [ ] **Step 10: Run the existing frontend build suite to check for regressions**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/build.test.js --runInBand`
  Expected: PASS — confirms the studio.pug page-switcher addition didn't break any existing studio.html content checks

- [ ] **Step 11: Commit**

  ```bash
  git add frontend/src/pug/library.pug frontend/src/pug/studio.pug \
          frontend/src/scss/components/_headerbar.scss \
          frontend/src/scss/components/_library-toolbar.scss \
          frontend/src/scss/components/_library-grid.scss \
          frontend/src/scss/components/_library-context-menu.scss \
          frontend/src/scss/styles.scss \
          frontend/dist test/frontend/library-build.test.js
  git commit -m "feat(library): add library.pug page and headerbar page-switcher"
  ```

---

## Task 3: `library-init.js` — wallet gate + theme/wallet wiring

This file follows the same convention as `frontend/src/js/engine/studio-init.js`: top-level
side-effecting script, not an ES module that gets `import`ed and executed under jsdom (doing so
would also execute `initWallet()`/`autoConnectWallet()` against a real `wallet.js`, which no
existing test does — see `test/frontend/build.test.js`'s text-matching approach on the built
file instead of importing it). The plan follows that same text-matching convention here.

**Files:**
- Create: `frontend/src/js/library-init.js`
- Test: `test/frontend/library-init.test.js`

**Interfaces:**
- Consumes: `on`, `EVENTS` from `frontend/src/js/events/bus.js`; `initWallet`, `autoConnectWallet`, `connectWallet` from `frontend/src/js/blockchain/wallet.js`; `initWalletPopover` from `frontend/src/js/ui/wallet-popover.js`; `initTheme`, `toggleTheme` from `frontend/src/js/engine/theme.js`; `walletState` from `frontend/src/js/state/wallet-state.js`; `truncateAddress` from `frontend/src/js/utils/format.js`; `getCachedSession` from `frontend/src/js/services/api.js`.
- Produces: a local (non-exported) `applyWalletGate(connected)` function that toggles `#libraryGate`/`#libraryMain`'s `hidden` class; the page's `#connectWalletBtn`/`#libraryConnectBtn`/`#disconnectWalletBtn` click and `EVENTS.WALLET_CONNECTED`/`WALLET_DISCONNECTED` wiring. Later tasks (4, 6, 7) each add one more import + init call to this same file.

- [ ] **Step 1: Write the failing test**

  Create `test/frontend/library-init.test.js`:

  ```js
  import fs from "fs";
  import path from "path";
  import url from "url";

  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const DIST_JS = path.resolve(__dirname, "../../frontend/dist/js");

  function readBuilt(name) {
    return fs.readFileSync(path.join(DIST_JS, name), "utf-8");
  }

  describe("library-init.js", () => {
    const src = () => readBuilt("library-init.js");

    test("gates #libraryMain behind #libraryGate by toggling the hidden class", () => {
      expect(src()).toMatch(/gate\.classList\.toggle\(\s*["']hidden["']\s*,\s*connected\s*\)/);
      expect(src()).toMatch(/main\.classList\.toggle\(\s*["']hidden["']\s*,\s*!connected\s*\)/);
    });

    test("wires the wallet lifecycle", () => {
      expect(src()).toMatch(/initWallet\(\)/);
      expect(src()).toMatch(/autoConnectWallet\(\)/);
      expect(src()).toMatch(/EVENTS\.WALLET_CONNECTED/);
      expect(src()).toMatch(/EVENTS\.WALLET_DISCONNECTED/);
    });

    test("wires both the headerbar and gate Connect Wallet buttons", () => {
      expect(src()).toMatch(/getElementById\(\s*["']connectWalletBtn["']\s*\)/);
      expect(src()).toMatch(/getElementById\(\s*["']libraryConnectBtn["']\s*\)/);
    });

    test("initializes theme and the wallet popover", () => {
      expect(src()).toMatch(/initTheme\(\)/);
      expect(src()).toMatch(/initWalletPopover\(\)/);
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/library-init.test.js --runInBand`
  Expected: FAIL — `frontend/dist/js/library-init.js` does not exist (ENOENT)

- [ ] **Step 3: Implement `library-init.js`**

  Create `frontend/src/js/library-init.js`:

  ```js
  /**
   * Library Page Initializer
   *
   * Mirrors engine/studio-init.js: top-level script, no CSP unsafe-inline needed.
   */

  import { on, EVENTS } from "./events/bus.js";
  import { initWallet, autoConnectWallet, connectWallet } from "./blockchain/wallet.js";
  import { initWalletPopover } from "./ui/wallet-popover.js";
  import { initTheme, toggleTheme } from "./engine/theme.js";
  import { walletState } from "./state/wallet-state.js";
  import { truncateAddress } from "./utils/format.js";
  import { getCachedSession } from "./services/api.js";

  function applyWalletGate(connected) {
    const gate = document.getElementById("libraryGate");
    const main = document.getElementById("libraryMain");
    if (!gate || !main) return;
    gate.classList.toggle("hidden", connected);
    main.classList.toggle("hidden", !connected);
  }

  function updateWalletButtonState(address, isAuthenticated) {
    const d = document.getElementById("disconnectWalletBtn");
    if (!d) return;
    const text = d.querySelector("span") || d;
    if (!address) {
      if (text) text.textContent = "Disconnect";
      return;
    }
    const truncated = truncateAddress(address);
    if (text) {
      text.textContent = isAuthenticated ? truncated : `${truncated} • Sign In`;
    }
    d.classList.toggle("auth-required", !isAuthenticated);
  }

  initTheme();
  document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);

  initWallet();
  autoConnectWallet();
  document.getElementById("connectWalletBtn")?.addEventListener("click", connectWallet);
  document.getElementById("libraryConnectBtn")?.addEventListener("click", connectWallet);
  initWalletPopover();

  applyWalletGate(Boolean(walletState.get().walletAddress));

  on(EVENTS.WALLET_CONNECTED, (e) => {
    const c = document.getElementById("connectWalletBtn");
    const d = document.getElementById("disconnectWalletBtn");
    if (c) {
      c.classList.add("hidden");
      c.classList.remove("disconnected");
    }
    if (d) d.classList.remove("hidden");

    const address = e?.address || "";
    const cached = getCachedSession();
    const isAuth = cached && cached.address === address.toLowerCase();
    updateWalletButtonState(address, isAuth);
    applyWalletGate(true);
  });

  on(EVENTS.WALLET_DISCONNECTED, () => {
    const c = document.getElementById("connectWalletBtn");
    const d = document.getElementById("disconnectWalletBtn");
    if (c) {
      c.classList.remove("hidden");
      c.classList.add("disconnected");
    }
    if (d) {
      d.classList.add("hidden");
      d.classList.remove("auth-required");
    }
    updateWalletButtonState(null, false);
    applyWalletGate(false);
  });

  on(EVENTS.USER_AUTHENTICATED, (e) => updateWalletButtonState(e?.address, true));
  on(EVENTS.USER_AUTH_REQUIRED, (e) => updateWalletButtonState(e?.address, false));
  ```

- [ ] **Step 4: Build and run the test to verify it passes**

  Run: `npm run build:frontend && NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/library-init.test.js --runInBand`
  Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/js/library-init.js frontend/dist test/frontend/library-init.test.js
  git commit -m "feat(library): add library-init.js wallet gate and headerbar wiring"
  ```

---

## Task 4: `library-grid.js` — rendering + drag-drop/click upload

**Files:**
- Create: `frontend/src/js/ui/library-grid.js`
- Test: `test/library-grid.test.js`
- Modify: `frontend/src/js/library-init.js`

**Interfaces:**
- Consumes: `libraryState` from `frontend/src/js/state/library-state.js`; `on`, `EVENTS` from `frontend/src/js/events/bus.js`; `getChildItems`, `filterItems`, `sortItems`, `isSupportedFile`, `formatBytes` from `frontend/src/js/utils/library-items.js`; `escapeHtml` from `frontend/src/js/utils/html.js`; `showToast` from `frontend/src/js/ui/toasts.js`.
- Produces: `createItemElement(item, viewMode) -> HTMLElement`, `renderItems(container, items, viewMode) -> void`, `announce(text) -> void`, `addFiles(fileList) -> void`, `initLibraryGrid() -> void`.

- [ ] **Step 1: Write the failing rendering test**

  Create `test/library-grid.test.js`:

  ```js
  /**
   * @jest-environment jsdom
   */
  import {
    createItemElement,
    renderItems,
    announce,
    addFiles,
    initLibraryGrid,
  } from "../frontend/src/js/ui/library-grid.js";
  import { libraryState, _resetForTesting } from "../frontend/src/js/state/library-state.js";

  beforeEach(() => {
    _resetForTesting();
    document.body.innerHTML = `
      <div id="libraryContent">
        <div id="libraryDropOverlay"></div>
        <div id="libraryItems"></div>
      </div>
      <span id="libraryItemCount"></span>
      <div id="libraryLiveRegion"></div>
    `;
  });

  describe("createItemElement", () => {
    test("renders a folder with no status badge or icon", () => {
      const el = createItemElement({ id: "f1", type: "folder", name: "Weapons" }, "grid");
      expect(el.dataset.id).toBe("f1");
      expect(el.dataset.type).toBe("folder");
      expect(el.querySelector(".library-item-name").textContent).toBe("Weapons");
      expect(el.querySelector(".status-badge")).toBeNull();
      expect(el.querySelector(".status-check")).toBeNull();
      expect(el.querySelector(".status-flag")).toBeNull();
    });

    test("grid view: a wip file shows the flag icon, not the checkmark", () => {
      const el = createItemElement({ id: "a", type: "file", name: "shield.glb", status: "wip" }, "grid");
      expect(el.querySelector(".status-flag")).not.toBeNull();
      expect(el.querySelector(".status-check")).toBeNull();
      expect(el.querySelector(".status-badge")).toBeNull();
    });

    test("grid view: a besked file shows the checkmark icon, not the flag", () => {
      const el = createItemElement({ id: "a", type: "file", name: "shield.glb", status: "besked" }, "grid");
      expect(el.querySelector(".status-check")).not.toBeNull();
      expect(el.querySelector(".status-flag")).toBeNull();
      expect(el.querySelector(".status-badge")).toBeNull();
    });

    test("grid view: an uploading file shows the Uploading… text badge", () => {
      const el = createItemElement({ id: "a", type: "file", name: "shield.glb", status: "uploading" }, "grid");
      expect(el.querySelector(".status-uploading").textContent).toBe("Uploading…");
    });

    test("list view: a wip file shows the Work in Progress text badge", () => {
      const el = createItemElement({ id: "a", type: "file", name: "shield.glb", status: "wip" }, "list");
      expect(el.querySelector(".status-wip").textContent).toBe("Work in Progress");
    });

    test("list view: a besked file shows the Besked text badge", () => {
      const el = createItemElement({ id: "a", type: "file", name: "shield.glb", status: "besked" }, "list");
      expect(el.querySelector(".status-besked").textContent).toBe("Besked");
    });
  });

  describe("renderItems", () => {
    test("renders an empty-state when there are no items", () => {
      const container = document.getElementById("libraryItems");
      renderItems(container, [], "grid");
      expect(container.querySelector(".empty-state")).not.toBeNull();
    });

    test("renders one element per item in grid mode", () => {
      const container = document.getElementById("libraryItems");
      renderItems(container, [
        { id: "1", type: "folder", name: "A" },
        { id: "2", type: "file", name: "b.glb", status: "wip" },
      ], "grid");
      expect(container.querySelectorAll("[data-id]")).toHaveLength(2);
    });

    test("renders a table in list mode", () => {
      const container = document.getElementById("libraryItems");
      renderItems(container, [{ id: "2", type: "file", name: "b.glb", status: "wip" }], "list");
      expect(container.querySelector("table.library-list-table")).not.toBeNull();
    });
  });

  describe("announce", () => {
    test("writes the message into the live region", () => {
      announce("3 items selected");
      expect(document.getElementById("libraryLiveRegion").textContent).toBe("3 items selected");
    });
  });

  describe("addFiles", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test("adds supported files in 'uploading' status, then flips to 'wip'", () => {
      addFiles([{ name: "model.glb", size: 1024 }]);
      expect(libraryState.get().files).toHaveLength(1);
      expect(libraryState.get().files[0].status).toBe("uploading");

      jest.runAllTimers();
      expect(libraryState.get().files[0].status).toBe("wip");
    });

    test("rejects unsupported files and does not add them", () => {
      addFiles([{ name: "model.fbx", size: 1024 }]);
      expect(libraryState.get().files).toHaveLength(0);
    });

    test("adds the supported subset when given a mix", () => {
      addFiles([{ name: "model.glb", size: 1024 }, { name: "model.fbx", size: 1024 }]);
      expect(libraryState.get().files).toHaveLength(1);
      expect(libraryState.get().files[0].name).toBe("model.glb");
    });
  });

  describe("initLibraryGrid", () => {
    test("renders the current (empty) folder immediately", () => {
      initLibraryGrid();
      expect(document.getElementById("libraryItems").querySelector(".empty-state")).not.toBeNull();
      expect(document.getElementById("libraryItemCount").textContent).toBe("0 items");
    });

    test("dropping files on #libraryContent calls addFiles and clears the drop overlay", () => {
      initLibraryGrid();
      const content = document.getElementById("libraryContent");
      const overlay = document.getElementById("libraryDropOverlay");

      content.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
      expect(overlay.classList.contains("active")).toBe(true);

      const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
      dropEvent.dataTransfer = { files: [{ name: "model.glb", size: 10 }] };
      content.dispatchEvent(dropEvent);

      expect(overlay.classList.contains("active")).toBe(false);
      expect(libraryState.get().files).toHaveLength(1);
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-grid.test.js --runInBand`
  Expected: FAIL — `Cannot find module '../frontend/src/js/ui/library-grid.js'`

- [ ] **Step 3: Implement `library-grid.js`**

  Create `frontend/src/js/ui/library-grid.js`:

  ```js
  import { libraryState } from "../state/library-state.js";
  import { on, EVENTS } from "../events/bus.js";
  import { getChildItems, filterItems, sortItems, isSupportedFile, formatBytes } from "../utils/library-items.js";
  import { escapeHtml } from "../utils/html.js";
  import { showToast } from "./toasts.js";

  export function announce(text) {
    const region = document.getElementById("libraryLiveRegion");
    if (region) region.textContent = text;
  }

  function renderGridStatus(item) {
    if (item.type !== "file") return "";
    if (item.status === "uploading") {
      return `<span class="status-badge status-uploading">Uploading…</span>`;
    }
    if (item.status === "besked") {
      return `<span class="status-check" title="Besked"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`;
    }
    return `<span class="status-flag" title="Work in Progress"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4M4 4h14l-2.5 4L18 12H4"/></svg></span>`;
  }

  function renderListStatus(item) {
    if (item.type !== "file") return "—";
    if (item.status === "uploading") return `<span class="status-badge status-uploading">Uploading…</span>`;
    if (item.status === "besked") return `<span class="status-badge status-besked">Besked</span>`;
    return `<span class="status-badge status-wip">Work in Progress</span>`;
  }

  export function createItemElement(item, viewMode) {
    const icon = item.type === "folder" ? "📁" : "🗎";

    if (viewMode === "list") {
      const el = document.createElement("tr");
      el.className = "library-row";
      el.dataset.id = item.id;
      el.dataset.type = item.type;
      el.tabIndex = 0;
      el.setAttribute("role", "row");
      el.setAttribute("aria-selected", "false");
      el.innerHTML = `
        <td class="library-row-name"><span>${icon}</span><span class="library-item-name">${escapeHtml(item.name)}</span></td>
        <td>${renderListStatus(item)}</td>
        <td>${item.dateModified ? new Date(item.dateModified).toLocaleDateString() : "—"}</td>
        <td>${item.sizeBytes ? formatBytes(item.sizeBytes) : "—"}</td>
      `;
      return el;
    }

    const el = document.createElement("div");
    el.className = "library-item";
    el.dataset.id = item.id;
    el.dataset.type = item.type;
    el.tabIndex = 0;
    el.setAttribute("role", "gridcell");
    el.setAttribute("aria-selected", "false");
    el.innerHTML = `
      <div class="library-item-thumbnail">${icon}${renderGridStatus(item)}</div>
      <span class="library-item-name">${escapeHtml(item.name)}</span>
    `;
    return el;
  }

  function buildEmptyState(searchQuery) {
    const el = document.createElement("div");
    el.className = "empty-state";
    if (searchQuery) {
      el.innerHTML = `
        <p class="empty-state-title">No files match your search</p>
        <p class="empty-state-sub">Try a different name.</p>
      `;
    } else {
      el.innerHTML = `
        <p class="empty-state-title">Drag files here to get started</p>
        <p class="empty-state-sub">.glb and .gltf files are supported.</p>
      `;
    }
    return el;
  }

  export function renderItems(container, items, viewMode) {
    container.innerHTML = "";

    if (items.length === 0) {
      container.appendChild(buildEmptyState(libraryState.get().searchQuery));
      return;
    }

    if (viewMode === "list") {
      const table = document.createElement("table");
      table.className = "library-list-table";
      table.innerHTML = `<thead><tr><th>Name</th><th>Status</th><th>Date modified</th><th>Size</th></tr></thead>`;
      const tbody = document.createElement("tbody");
      items.forEach((item) => tbody.appendChild(createItemElement(item, viewMode)));
      table.appendChild(tbody);
      container.appendChild(table);
    } else {
      items.forEach((item) => container.appendChild(createItemElement(item, viewMode)));
    }
  }

  function currentItems() {
    const state = libraryState.get();
    const items = getChildItems(state, state.currentFolderId);
    return sortItems(filterItems(items, state.searchQuery), state.sortBy);
  }

  function render() {
    const container = document.getElementById("libraryItems");
    if (!container) return;
    const state = libraryState.get();
    const items = currentItems();
    renderItems(container, items, state.viewMode);

    const countEl = document.getElementById("libraryItemCount");
    if (countEl) countEl.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
  }

  export function addFiles(fileList) {
    const files = Array.from(fileList);
    const supported = files.filter((f) => isSupportedFile(f.name));
    const rejected = files.length - supported.length;

    if (rejected > 0) {
      showToast({
        type: "warning",
        title: "Unsupported file type",
        message: "Only .glb and .gltf files are supported.",
      });
    }
    if (supported.length === 0) return;

    const currentFolderId = libraryState.get().currentFolderId;
    const newFiles = supported.map((f) => ({
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: f.name,
      parentId: currentFolderId,
      status: "uploading",
      sizeBytes: f.size,
      dateModified: Date.now(),
    }));

    libraryState.set({ files: [...libraryState.get().files, ...newFiles] });
    announce(`${newFiles.length} file${newFiles.length === 1 ? "" : "s"} uploading`);

    newFiles.forEach((nf) => {
      setTimeout(() => {
        const files = libraryState.get().files.map((f) => (f.id === nf.id ? { ...f, status: "wip" } : f));
        libraryState.set({ files });
        announce(`${nf.name} added`);
      }, 600);
    });
  }

  function initDropzone() {
    const content = document.getElementById("libraryContent");
    const overlay = document.getElementById("libraryDropOverlay");
    if (!content) return;

    content.addEventListener("dragover", (e) => {
      e.preventDefault();
      overlay?.classList.add("active");
    });
    content.addEventListener("dragleave", () => overlay?.classList.remove("active"));
    content.addEventListener("drop", (e) => {
      e.preventDefault();
      overlay?.classList.remove("active");
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    });
  }

  export function initLibraryGrid() {
    initDropzone();
    on(EVENTS.LIBRARY_STATE_CHANGED, render);
    render();
  }
  ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-grid.test.js --runInBand`
  Expected: PASS (14 tests)

- [ ] **Step 5: Wire `initLibraryGrid()` into `library-init.js`**

  In `frontend/src/js/library-init.js`, find:

  ```js
  import { getCachedSession } from "./services/api.js";
  ```

  Replace with:

  ```js
  import { getCachedSession } from "./services/api.js";
  import { initLibraryGrid } from "./ui/library-grid.js";
  ```

  Then find:

  ```js
  applyWalletGate(Boolean(walletState.get().walletAddress));
  ```

  Replace with:

  ```js
  initLibraryGrid();
  applyWalletGate(Boolean(walletState.get().walletAddress));
  ```

- [ ] **Step 6: Update the library-init build test for the new import**

  In `test/frontend/library-init.test.js`, add one more assertion inside the existing `"wires the wallet lifecycle"` test body (after the last `expect` line):

  ```js
      expect(src()).toMatch(/initLibraryGrid\(\)/);
  ```

- [ ] **Step 7: Rebuild and run both test files to verify no regressions**

  Run: `npm run build:frontend && NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-grid.test.js test/frontend/library-init.test.js --runInBand`
  Expected: PASS (all tests, including the new `initLibraryGrid()` assertion)

- [ ] **Step 8: Commit**

  ```bash
  git add frontend/src/js/ui/library-grid.js frontend/src/js/library-init.js frontend/dist \
          test/library-grid.test.js test/frontend/library-init.test.js
  git commit -m "feat(library): render grid/list items and wire drag-drop/click upload"
  ```

---

## Task 5: `library-grid.js` — selection model + keyboard shortcuts

**Files:**
- Modify: `frontend/src/js/ui/library-grid.js`
- Modify: `test/library-grid.test.js`

**Interfaces:**
- Consumes (new, on top of Task 4): `computeRangeSelection` from `frontend/src/js/utils/library-items.js`; `showConfirmDialog` from `frontend/src/js/ui/dialog.js`.
- Produces (new exports added to `library-grid.js`): `openInStudio(fileId) -> void`, `requestDelete(ids: string[]) -> Promise<void>`. Selection is applied as `.selected` + `aria-selected` on rendered items, driven by `libraryState.selectedIds`. These two functions and the `libraryState.selectedIds`/`currentFolderId` contract are consumed unchanged by Task 6 (toolbar) and Task 7 (context menu).

- [ ] **Step 1: Write the failing tests**

  Append to `test/library-grid.test.js` (add this `import` to the top, alongside the existing ones):

  ```js
  import { openInStudio, requestDelete } from "../frontend/src/js/ui/library-grid.js";
  ```

  Then add these new `describe` blocks at the end of the file:

  ```js
  describe("selection: click", () => {
    function seedTwoFiles() {
      libraryState.set({
        files: [
          { id: "a", name: "a.glb", parentId: null, status: "wip", sizeBytes: 1, dateModified: 1 },
          { id: "b", name: "b.glb", parentId: null, status: "wip", sizeBytes: 1, dateModified: 2 },
          { id: "c", name: "c.glb", parentId: null, status: "wip", sizeBytes: 1, dateModified: 3 },
        ],
      });
    }

    test("plain click selects exactly one item and applies aria-selected", () => {
      seedTwoFiles();
      initLibraryGrid();
      const container = document.getElementById("libraryItems");
      const itemB = container.querySelector('[data-id="b"]');

      itemB.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(libraryState.get().selectedIds).toEqual(["b"]);
      expect(itemB.getAttribute("aria-selected")).toBe("true");
      expect(container.querySelector('[data-id="a"]').getAttribute("aria-selected")).toBe("false");
    });

    test("ctrl-click toggles membership without clearing the rest", () => {
      seedTwoFiles();
      initLibraryGrid();
      const container = document.getElementById("libraryItems");

      container.querySelector('[data-id="a"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container.querySelector('[data-id="b"]').dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));

      expect(libraryState.get().selectedIds.sort()).toEqual(["a", "b"]);
    });

    test("shift-click range-selects from the last clicked item", () => {
      seedTwoFiles();
      initLibraryGrid();
      const container = document.getElementById("libraryItems");

      container.querySelector('[data-id="a"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container.querySelector('[data-id="c"]').dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));

      expect(libraryState.get().selectedIds.sort()).toEqual(["a", "b", "c"]);
    });

    test("clicking empty space clears the selection", () => {
      seedTwoFiles();
      initLibraryGrid();
      const container = document.getElementById("libraryItems");
      container.querySelector('[data-id="a"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));

      container.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(libraryState.get().selectedIds).toEqual([]);
    });

    test("double-clicking a folder navigates into it", () => {
      libraryState.set({ folders: [{ id: "f1", name: "Weapons", parentId: null }] });
      initLibraryGrid();
      const container = document.getElementById("libraryItems");
      container.querySelector('[data-id="f1"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      expect(libraryState.get().currentFolderId).toBe("f1");
    });
  });

  describe("keyboard shortcuts", () => {
    function seedTwoFiles() {
      libraryState.set({
        files: [
          { id: "a", name: "a.glb", parentId: null, status: "wip", sizeBytes: 1, dateModified: 1 },
          { id: "b", name: "b.glb", parentId: null, status: "wip", sizeBytes: 1, dateModified: 2 },
        ],
      });
    }

    test("Ctrl+A selects every item in the current folder", () => {
      seedTwoFiles();
      initLibraryGrid();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
      expect(libraryState.get().selectedIds.sort()).toEqual(["a", "b"]);
    });

    test("Escape clears the selection", () => {
      seedTwoFiles();
      initLibraryGrid();
      libraryState.set({ selectedIds: ["a"] });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(libraryState.get().selectedIds).toEqual([]);
    });

    test("Backspace navigates up one folder level", () => {
      libraryState.set({
        folders: [{ id: "f1", name: "Weapons", parentId: null }],
        currentFolderId: "f1",
      });
      initLibraryGrid();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
      expect(libraryState.get().currentFolderId).toBeNull();
    });

    test("keyboard shortcuts are ignored while typing in an input", () => {
      seedTwoFiles();
      initLibraryGrid();
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
      expect(libraryState.get().selectedIds).toEqual([]);
    });
  });

  describe("openInStudio", () => {
    test("navigates to studio.html with the file id as a query param", () => {
      delete window.location;
      window.location = { href: "" };
      openInStudio("file-1");
      expect(window.location.href).toBe("/studio.html?libraryFile=file-1");
    });
  });

  describe("requestDelete", () => {
    test("removes the given ids from files and folders, and clears selection", async () => {
      window.focusTrap = { createFocusTrap: () => ({ activate() { return this; }, deactivate() { return this; } }) };
      libraryState.set({
        files: [{ id: "a", name: "a.glb", parentId: null, status: "wip" }],
        selectedIds: ["a"],
      });

      const promise = requestDelete(["a"]);
      document.querySelector(".dialog-action-btn[data-value='confirm']")?.click();
      await promise;

      expect(libraryState.get().files).toHaveLength(0);
      expect(libraryState.get().selectedIds).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-grid.test.js --runInBand`
  Expected: FAIL — `openInStudio`/`requestDelete` are not exported yet; selection/keyboard tests fail because no click/keydown handlers exist

- [ ] **Step 3: Add selection rendering, click handling, and keyboard shortcuts**

  In `frontend/src/js/ui/library-grid.js`, find:

  ```js
  import { showToast } from "./toasts.js";
  ```

  Replace with:

  ```js
  import { showToast } from "./toasts.js";
  import { computeRangeSelection } from "../utils/library-items.js";
  import { showConfirmDialog } from "./dialog.js";
  ```

  Find:

  ```js
  function render() {
    const container = document.getElementById("libraryItems");
    if (!container) return;
    const state = libraryState.get();
    const items = currentItems();
    renderItems(container, items, state.viewMode);

    const countEl = document.getElementById("libraryItemCount");
    if (countEl) countEl.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
  }
  ```

  Replace with:

  ```js
  function applySelection(container, selectedIds) {
    container.querySelectorAll("[data-id]").forEach((el) => {
      const selected = selectedIds.includes(el.dataset.id);
      el.classList.toggle("selected", selected);
      el.setAttribute("aria-selected", String(selected));
    });
  }

  function render() {
    const container = document.getElementById("libraryItems");
    if (!container) return;
    const state = libraryState.get();
    const items = currentItems();
    renderItems(container, items, state.viewMode);
    applySelection(container, state.selectedIds);

    const countEl = document.getElementById("libraryItemCount");
    if (countEl) countEl.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
  }

  let lastClickedId = null;

  export function openInStudio(fileId) {
    window.location.href = `/studio.html?libraryFile=${fileId}`;
  }

  export function requestDelete(ids) {
    return showConfirmDialog(
      ids.length === 1 ? "Delete item?" : `Delete ${ids.length} items?`,
      "This cannot be undone.",
      [
        { text: "Cancel", value: "cancel", className: "btn btn-secondary" },
        { text: "Delete", value: "confirm", className: "btn btn-danger" },
      ]
    ).then((value) => {
      if (value !== "confirm") return;
      const state = libraryState.get();
      libraryState.set({
        folders: state.folders.filter((f) => !ids.includes(f.id)),
        files: state.files.filter((f) => !ids.includes(f.id)),
        selectedIds: [],
      });
      announce(`${ids.length} item${ids.length === 1 ? "" : "s"} deleted`);
    });
  }

  function handleItemClick(e) {
    const container = document.getElementById("libraryItems");
    const el = e.target.closest("[data-id]");

    if (!el) {
      if (e.target === container) libraryState.set({ selectedIds: [] });
      return;
    }

    const id = el.dataset.id;
    const state = libraryState.get();
    let selectedIds;

    if (e.shiftKey && lastClickedId) {
      selectedIds = computeRangeSelection(currentItems(), lastClickedId, id);
    } else if (e.ctrlKey || e.metaKey) {
      selectedIds = state.selectedIds.includes(id)
        ? state.selectedIds.filter((sid) => sid !== id)
        : [...state.selectedIds, id];
    } else {
      selectedIds = [id];
    }

    lastClickedId = id;
    libraryState.set({ selectedIds });
    announce(`${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"} selected`);
  }

  function handleItemDblClick(e) {
    const el = e.target.closest("[data-id]");
    if (!el) return;
    if (el.dataset.type === "folder") {
      libraryState.set({ currentFolderId: el.dataset.id, selectedIds: [] });
    } else {
      openInStudio(el.dataset.id);
    }
  }

  function isEditingText() {
    const el = document.activeElement;
    if (!el) return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
  }

  function handleKeydown(e) {
    if (isEditingText()) return;
    const state = libraryState.get();

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      const selectedIds = currentItems().map((i) => i.id);
      libraryState.set({ selectedIds });
      announce(`${selectedIds.length} items selected`);
      return;
    }

    if (e.key === "Escape") {
      libraryState.set({ selectedIds: [] });
      return;
    }

    if ((e.key === "Backspace" || (e.altKey && e.key === "ArrowLeft")) && state.currentFolderId !== null) {
      e.preventDefault();
      const parent = state.folders.find((f) => f.id === state.currentFolderId);
      libraryState.set({ currentFolderId: parent ? parent.parentId : null, selectedIds: [] });
      return;
    }

    if (e.key === "Enter" && state.selectedIds.length === 1) {
      const id = state.selectedIds[0];
      const isFolder = state.folders.some((f) => f.id === id);
      if (isFolder) {
        libraryState.set({ currentFolderId: id, selectedIds: [] });
      } else {
        openInStudio(id);
      }
      return;
    }

    if (e.key === "Delete" && state.selectedIds.length > 0) {
      requestDelete(state.selectedIds);
    }
  }
  ```

  Then find:

  ```js
  export function initLibraryGrid() {
    initDropzone();
    on(EVENTS.LIBRARY_STATE_CHANGED, render);
    render();
  }
  ```

  Replace with:

  ```js
  export function initLibraryGrid() {
    initDropzone();

    const container = document.getElementById("libraryItems");
    container?.addEventListener("click", handleItemClick);
    container?.addEventListener("dblclick", handleItemDblClick);
    document.addEventListener("keydown", handleKeydown);

    on(EVENTS.LIBRARY_STATE_CHANGED, render);
    render();
  }
  ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-grid.test.js --runInBand`
  Expected: PASS (all tests from Task 4 + Task 5)

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/js/ui/library-grid.js test/library-grid.test.js
  git commit -m "feat(library): add Nautilus-style selection model and keyboard shortcuts"
  ```

---

## Task 6: `library-toolbar.js` — breadcrumb, search, sort, new folder, upload, view toggle

**Files:**
- Create: `frontend/src/js/ui/library-toolbar.js`
- Test: `test/library-toolbar.test.js`
- Modify: `frontend/src/js/library-init.js`

**Interfaces:**
- Consumes: `libraryState` from `frontend/src/js/state/library-state.js`; `on`, `EVENTS` from `frontend/src/js/events/bus.js`; `buildBreadcrumb` from `frontend/src/js/utils/library-items.js`; `escapeHtml` from `frontend/src/js/utils/html.js`; `showDialog` from `frontend/src/js/ui/dialog.js`; `addFiles` from `frontend/src/js/ui/library-grid.js`.
- Produces: `renderBreadcrumb(container, folders, currentFolderId) -> void`, `requestNewFolder() -> Promise<void>`, `initLibraryToolbar() -> void`.

- [ ] **Step 1: Write the failing tests**

  Create `test/library-toolbar.test.js`:

  ```js
  /**
   * @jest-environment jsdom
   */
  import { renderBreadcrumb, requestNewFolder, initLibraryToolbar } from "../frontend/src/js/ui/library-toolbar.js";
  import { libraryState, _resetForTesting } from "../frontend/src/js/state/library-state.js";

  beforeEach(() => {
    _resetForTesting();
    window.focusTrap = {
      createFocusTrap: () => ({
        activate() { return this; },
        deactivate() { return this; },
      }),
    };
    document.body.innerHTML = `
      <nav id="libraryBreadcrumb"></nav>
      <input id="librarySearchInput" />
      <select id="librarySortSelect"><option value="name">Name</option><option value="date">Date</option></select>
      <button id="libraryNewFolderBtn"></button>
      <button id="libraryUploadBtn"></button>
      <input id="libraryFileInput" type="file" />
      <button id="libraryGridViewBtn" class="active" data-view="grid"></button>
      <button id="libraryListViewBtn" data-view="list"></button>
      <div id="libraryItems"></div>
    `;
  });

  describe("renderBreadcrumb", () => {
    test("renders Home only at the root", () => {
      const container = document.getElementById("libraryBreadcrumb");
      renderBreadcrumb(container, [], null);
      expect(container.querySelectorAll(".pathbar-segment, .pathbar-current")).toHaveLength(1);
      expect(container.textContent).toContain("Home");
    });

    test("renders the full ancestor chain with the last segment marked current", () => {
      const folders = [{ id: "f1", name: "Characters", parentId: null }];
      const container = document.getElementById("libraryBreadcrumb");
      renderBreadcrumb(container, folders, "f1");
      expect(container.textContent).toContain("Home");
      expect(container.textContent).toContain("Characters");
      expect(container.querySelector(".pathbar-current").textContent).toBe("Characters");
    });
  });

  describe("breadcrumb click navigation", () => {
    test("clicking a non-current segment navigates to that folder", () => {
      libraryState.set({
        folders: [
          { id: "f1", name: "Characters", parentId: null },
          { id: "f2", name: "Heroes", parentId: "f1" },
        ],
        currentFolderId: "f2",
      });
      initLibraryToolbar();
      document.querySelector('[data-folder-id="f1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(libraryState.get().currentFolderId).toBe("f1");
    });
  });

  describe("search input", () => {
    test("typing updates libraryState.searchQuery", () => {
      initLibraryToolbar();
      const input = document.getElementById("librarySearchInput");
      input.value = "shield";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(libraryState.get().searchQuery).toBe("shield");
    });
  });

  describe("sort select", () => {
    test("changing it updates libraryState.sortBy", () => {
      initLibraryToolbar();
      const select = document.getElementById("librarySortSelect");
      select.value = "date";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      expect(libraryState.get().sortBy).toBe("date");
    });
  });

  describe("view toggle", () => {
    test("clicking the list view button switches viewMode and toggles active classes", () => {
      initLibraryToolbar();
      document.getElementById("libraryListViewBtn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(libraryState.get().viewMode).toBe("list");
      expect(document.getElementById("libraryListViewBtn").classList.contains("active")).toBe(true);
      expect(document.getElementById("libraryGridViewBtn").classList.contains("active")).toBe(false);
    });
  });

  describe("upload button", () => {
    test("clicking it triggers the hidden file input", () => {
      initLibraryToolbar();
      const fileInput = document.getElementById("libraryFileInput");
      const clickSpy = jest.spyOn(fileInput, "click");
      document.getElementById("libraryUploadBtn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe("requestNewFolder", () => {
    test("creates a folder named via the dialog in the current folder", async () => {
      libraryState.set({ currentFolderId: "f1", folders: [{ id: "f1", name: "Characters", parentId: null }] });
      const promise = requestNewFolder();
      const dialogInput = document.querySelector(".dialog-input");
      dialogInput.value = "New Folder";
      document.querySelector(".dialog-action-btn[data-value='confirm']")?.click();
      await promise;

      const created = libraryState.get().folders.find((f) => f.name === "New Folder");
      expect(created).toBeDefined();
      expect(created.parentId).toBe("f1");
    });

    test("does nothing if the dialog is cancelled", async () => {
      const promise = requestNewFolder();
      document.querySelector(".dialog-action-btn[data-value='cancel']")?.click();
      await promise;
      expect(libraryState.get().folders).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-toolbar.test.js --runInBand`
  Expected: FAIL — `Cannot find module '../frontend/src/js/ui/library-toolbar.js'`

- [ ] **Step 3: Implement `library-toolbar.js`**

  Create `frontend/src/js/ui/library-toolbar.js`:

  ```js
  import { libraryState } from "../state/library-state.js";
  import { on, EVENTS } from "../events/bus.js";
  import { buildBreadcrumb } from "../utils/library-items.js";
  import { escapeHtml } from "../utils/html.js";
  import { showDialog } from "./dialog.js";
  import { addFiles } from "./library-grid.js";

  export function renderBreadcrumb(container, folders, currentFolderId) {
    const path = buildBreadcrumb(folders, currentFolderId);
    container.innerHTML = path
      .map((segment, i) => {
        const isLast = i === path.length - 1;
        const label = escapeHtml(segment.name);
        if (isLast) {
          return `<span class="pathbar-current">${label}</span>`;
        }
        return `<button type="button" class="pathbar-segment" data-folder-id="${segment.id ?? ""}">${label}</button><span class="pathbar-separator">›</span>`;
      })
      .join("");
  }

  export function requestNewFolder() {
    return showDialog("New Folder", "Folder name", "New Folder").then((name) => {
      if (!name) return;
      const folder = {
        id: `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        parentId: libraryState.get().currentFolderId,
      };
      libraryState.set({ folders: [...libraryState.get().folders, folder] });
    });
  }

  function renderToolbar() {
    const state = libraryState.get();
    const breadcrumb = document.getElementById("libraryBreadcrumb");
    if (breadcrumb) renderBreadcrumb(breadcrumb, state.folders, state.currentFolderId);

    const gridBtn = document.getElementById("libraryGridViewBtn");
    const listBtn = document.getElementById("libraryListViewBtn");
    gridBtn?.classList.toggle("active", state.viewMode === "grid");
    listBtn?.classList.toggle("active", state.viewMode === "list");
  }

  export function initLibraryToolbar() {
    document.getElementById("libraryBreadcrumb")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-folder-id]");
      if (!btn) return;
      const id = btn.dataset.folderId || null;
      libraryState.set({ currentFolderId: id, selectedIds: [] });
    });

    document.getElementById("librarySearchInput")?.addEventListener("input", (e) => {
      libraryState.set({ searchQuery: e.target.value });
    });

    document.getElementById("librarySortSelect")?.addEventListener("change", (e) => {
      libraryState.set({ sortBy: e.target.value });
    });

    document.getElementById("libraryNewFolderBtn")?.addEventListener("click", requestNewFolder);

    const fileInput = document.getElementById("libraryFileInput");
    document.getElementById("libraryUploadBtn")?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", (e) => {
      if (e.target.files?.length) addFiles(e.target.files);
      e.target.value = "";
    });

    document.getElementById("libraryGridViewBtn")?.addEventListener("click", () => libraryState.set({ viewMode: "grid" }));
    document.getElementById("libraryListViewBtn")?.addEventListener("click", () => libraryState.set({ viewMode: "list" }));

    on(EVENTS.LIBRARY_STATE_CHANGED, renderToolbar);
    renderToolbar();
  }
  ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-toolbar.test.js --runInBand`
  Expected: PASS (9 tests)

- [ ] **Step 5: Wire `initLibraryToolbar()` into `library-init.js`**

  In `frontend/src/js/library-init.js`, find:

  ```js
  import { initLibraryGrid } from "./ui/library-grid.js";
  ```

  Replace with:

  ```js
  import { initLibraryGrid } from "./ui/library-grid.js";
  import { initLibraryToolbar } from "./ui/library-toolbar.js";
  ```

  Then find:

  ```js
  initLibraryGrid();
  applyWalletGate(Boolean(walletState.get().walletAddress));
  ```

  Replace with:

  ```js
  initLibraryGrid();
  initLibraryToolbar();
  applyWalletGate(Boolean(walletState.get().walletAddress));
  ```

- [ ] **Step 6: Update the library-init build test for the new import**

  In `test/frontend/library-init.test.js`, add a new test inside the `describe("library-init.js", ...)` block:

  ```js
    test("wires the toolbar module", () => {
      expect(src()).toMatch(/initLibraryToolbar\(\)/);
    });
  ```

- [ ] **Step 7: Rebuild and run both test files**

  Run: `npm run build:frontend && NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-toolbar.test.js test/frontend/library-init.test.js --runInBand`
  Expected: PASS (all tests)

- [ ] **Step 8: Commit**

  ```bash
  git add frontend/src/js/ui/library-toolbar.js frontend/src/js/library-init.js frontend/dist \
          test/library-toolbar.test.js test/frontend/library-init.test.js
  git commit -m "feat(library): add toolbar — breadcrumb, search, sort, new folder, upload, view toggle"
  ```

---

## Task 7: `library-context-menu.js` — right-click menu (Besk it / Open in Studio / Rename / Move / Delete)

**Files:**
- Create: `frontend/src/js/ui/library-context-menu.js`
- Test: `test/library-context-menu.test.js`
- Modify: `frontend/src/js/library-init.js`

**Interfaces:**
- Consumes: `libraryState` from `frontend/src/js/state/library-state.js`; `openInStudio`, `requestDelete`, `announce` from `frontend/src/js/ui/library-grid.js`; `requestNewFolder` from `frontend/src/js/ui/library-toolbar.js`; `showDialog`, `showConfirmDialog` from `frontend/src/js/ui/dialog.js`; `escapeHtml` from `frontend/src/js/utils/html.js`.
- Produces: `openContextMenu(x, y, targetIds) -> void`, `closeContextMenu() -> void`, `requestRename(id) -> Promise<void>`, `requestMoveToFolder(ids) -> Promise<void>`, `requestBeskIt(ids) -> Promise<void>`, `initLibraryContextMenu() -> void`. After this task, `library-init.js` has every page-level module wired (Task 8 only adds final accessibility polish and a manual smoke test, no new modules).

- [ ] **Step 1: Write the failing tests**

  Create `test/library-context-menu.test.js`:

  ```js
  /**
   * @jest-environment jsdom
   */
  import {
    openContextMenu,
    closeContextMenu,
    requestRename,
    requestMoveToFolder,
    requestBeskIt,
    initLibraryContextMenu,
  } from "../frontend/src/js/ui/library-context-menu.js";
  import { libraryState, _resetForTesting } from "../frontend/src/js/state/library-state.js";

  beforeEach(() => {
    _resetForTesting();
    window.focusTrap = {
      createFocusTrap: () => ({
        activate() { return this; },
        deactivate() { return this; },
      }),
    };
    document.body.innerHTML = `
      <div id="libraryItems">
        <div class="library-item" data-id="a" data-type="file"></div>
        <div class="library-item" data-id="f1" data-type="folder"></div>
      </div>
    `;
    libraryState.set({
      folders: [{ id: "f1", name: "Weapons", parentId: null }],
      files: [{ id: "a", name: "a.glb", parentId: null, status: "wip" }],
    });
  });

  afterEach(() => closeContextMenu());

  function menuEl() {
    return document.querySelector(".context-menu");
  }

  describe("openContextMenu / closeContextMenu", () => {
    test("renders a menu positioned at the given coordinates", () => {
      openContextMenu(120, 80, ["a"]);
      const menu = document.querySelector(".context-menu");
      expect(menu).not.toBeNull();
      expect(menu.style.left).toBe("120px");
      expect(menu.style.top).toBe("80px");
    });

    test("a single selected file shows Besk it, Open in Studio, Rename, Move, Delete", () => {
      openContextMenu(0, 0, ["a"]);
      const labels = [...document.querySelectorAll(".context-menu-item")].map((el) => el.textContent.trim());
      expect(labels).toEqual(["Besk it", "Open in Studio", "Rename", "Move to folder…", "Delete"]);
    });

    test("a single selected folder shows Open, Rename, Move, Delete — no Besk it", () => {
      openContextMenu(0, 0, ["f1"]);
      const labels = [...document.querySelectorAll(".context-menu-item")].map((el) => el.textContent.trim());
      expect(labels).toEqual(["Open", "Rename", "Move to folder…", "Delete"]);
    });

    test("a multi-selection omits Rename", () => {
      openContextMenu(0, 0, ["a", "f1"]);
      const labels = [...document.querySelectorAll(".context-menu-item")].map((el) => el.textContent.trim());
      expect(labels).not.toContain("Rename");
      expect(labels).toContain("Besk it");
      expect(labels).toContain("Delete");
    });

    test("empty selection (right-click on empty space) shows New Folder, Upload, and a disabled Paste", () => {
      openContextMenu(0, 0, []);
      const labels = [...document.querySelectorAll(".context-menu-item")].map((el) => el.textContent.trim());
      expect(labels).toEqual(["New Folder", "Upload", "Paste"]);
      expect(document.querySelector('.context-menu-item[data-action="paste"]').disabled).toBe(true);
    });

    test("closeContextMenu removes the menu from the DOM", () => {
      openContextMenu(0, 0, ["a"]);
      closeContextMenu();
      expect(document.querySelector(".context-menu")).toBeNull();
    });

    test("ArrowDown/ArrowUp move focus between menu items, wrapping at the ends", () => {
      openContextMenu(0, 0, ["a"]);
      const items = [...document.querySelectorAll(".context-menu-item")];
      expect(document.activeElement).toBe(items[0]);

      menuEl().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(document.activeElement).toBe(items[1]);

      menuEl().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      menuEl().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      expect(document.activeElement).toBe(items[items.length - 1]);
    });
  });

  describe("requestRename", () => {
    test("renames the file using the typed value", async () => {
      const promise = requestRename("a");
      document.querySelector(".dialog-input").value = "renamed.glb";
      document.querySelector(".dialog-action-btn[data-value='confirm']")?.click();
      await promise;
      expect(libraryState.get().files.find((f) => f.id === "a").name).toBe("renamed.glb");
    });
  });

  describe("requestMoveToFolder", () => {
    test("moves the file into the chosen folder", async () => {
      const promise = requestMoveToFolder(["a"]);
      document.querySelector('[data-move-target="f1"]')?.click();
      await promise;
      expect(libraryState.get().files.find((f) => f.id === "a").parentId).toBe("f1");
    });
  });

  describe("requestBeskIt", () => {
    test("flips status from wip to besked on confirm", async () => {
      const promise = requestBeskIt(["a"]);
      document.querySelector(".dialog-action-btn[data-value='confirm']")?.click();
      await promise;
      expect(libraryState.get().files.find((f) => f.id === "a").status).toBe("besked");
    });

    test("leaves status unchanged if cancelled", async () => {
      const promise = requestBeskIt(["a"]);
      document.querySelector(".dialog-action-btn[data-value='cancel']")?.click();
      await promise;
      expect(libraryState.get().files.find((f) => f.id === "a").status).toBe("wip");
    });
  });

  describe("initLibraryContextMenu", () => {
    test("right-clicking an unselected item selects it and opens the menu for it", () => {
      initLibraryContextMenu();
      const el = document.querySelector('[data-id="a"]');
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
      expect(libraryState.get().selectedIds).toEqual(["a"]);
      expect(document.querySelector(".context-menu")).not.toBeNull();
    });

    test("right-clicking empty space opens the empty-selection menu", () => {
      initLibraryContextMenu();
      const container = document.getElementById("libraryItems");
      container.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
      const labels = [...document.querySelectorAll(".context-menu-item")].map((el) => el.textContent.trim());
      expect(labels).toEqual(["New Folder", "Upload"]);
    });

    test("Escape closes an open menu", () => {
      initLibraryContextMenu();
      openContextMenu(0, 0, ["a"]);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(document.querySelector(".context-menu")).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-context-menu.test.js --runInBand`
  Expected: FAIL — `Cannot find module '../frontend/src/js/ui/library-context-menu.js'`

- [ ] **Step 3: Implement `library-context-menu.js`**

  Create `frontend/src/js/ui/library-context-menu.js`:

  ```js
  import { libraryState } from "../state/library-state.js";
  import { openInStudio, requestDelete, announce } from "./library-grid.js";
  import { requestNewFolder } from "./library-toolbar.js";
  import { showDialog, showConfirmDialog } from "./dialog.js";
  import { escapeHtml } from "../utils/html.js";

  let menuEl = null;

  export function closeContextMenu() {
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
  }

  function isFolder(id) {
    return libraryState.get().folders.some((f) => f.id === id);
  }

  function singleItemMenuItems(ids) {
    const id = ids[0];
    if (isFolder(id)) {
      return [
        { label: "Open", action: () => libraryState.set({ currentFolderId: id, selectedIds: [] }) },
        { label: "Rename", action: () => requestRename(id) },
        { label: "Move to folder…", action: () => requestMoveToFolder(ids) },
        { label: "Delete", action: () => requestDelete(ids), danger: true },
      ];
    }
    return [
      { label: "Besk it", action: () => requestBeskIt(ids) },
      { label: "Open in Studio", action: () => openInStudio(id) },
      { label: "Rename", action: () => requestRename(id) },
      { label: "Move to folder…", action: () => requestMoveToFolder(ids) },
      { label: "Delete", action: () => requestDelete(ids), danger: true },
    ];
  }

  function multiSelectionMenuItems(ids) {
    return [
      { label: "Besk it", action: () => requestBeskIt(ids) },
      { label: "Open in Studio", action: () => ids.forEach((id) => openInStudio(id)) },
      { label: "Move to folder…", action: () => requestMoveToFolder(ids) },
      { label: "Delete", action: () => requestDelete(ids), danger: true },
    ];
  }

  function emptySpaceMenuItems() {
    return [
      { label: "New Folder", action: () => requestNewFolder() },
      { label: "Upload", action: () => document.getElementById("libraryFileInput")?.click() },
      { label: "Paste", action: () => {}, disabled: true, dataAction: "paste" },
    ];
  }

  function focusMenuItem(items, index) {
    const wrapped = (index + items.length) % items.length;
    items[wrapped].focus();
  }

  export function openContextMenu(x, y, targetIds) {
    closeContextMenu();

    const items =
      targetIds.length === 0
        ? emptySpaceMenuItems()
        : targetIds.length === 1
        ? singleItemMenuItems(targetIds)
        : multiSelectionMenuItems(targetIds);

    menuEl = document.createElement("div");
    menuEl.className = "context-menu";
    menuEl.style.left = `${x}px`;
    menuEl.style.top = `${y}px`;
    menuEl.setAttribute("role", "menu");

    items.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "context-menu-item" + (item.danger ? " context-menu-item-danger" : "");
      btn.setAttribute("role", "menuitem");
      btn.textContent = item.label;
      if (item.dataAction) btn.dataset.action = item.dataAction;
      if (item.disabled) btn.disabled = true;
      btn.addEventListener("click", () => {
        if (item.disabled) return;
        closeContextMenu();
        item.action();
      });
      menuEl.appendChild(btn);
    });

    menuEl.addEventListener("keydown", (e) => {
      const buttons = [...menuEl.querySelectorAll(".context-menu-item")];
      const currentIndex = buttons.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusMenuItem(buttons, currentIndex + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusMenuItem(buttons, currentIndex - 1);
      }
    });

    document.body.appendChild(menuEl);
    menuEl.querySelector(".context-menu-item")?.focus();
  }

  export function requestRename(id) {
    const state = libraryState.get();
    const file = state.files.find((f) => f.id === id);
    const folder = state.folders.find((f) => f.id === id);
    const current = file ? file.name : folder.name;

    return showDialog("Rename", "New name", current).then((name) => {
      if (!name) return;
      if (file) {
        libraryState.set({ files: state.files.map((f) => (f.id === id ? { ...f, name } : f)) });
      } else {
        libraryState.set({ folders: state.folders.map((f) => (f.id === id ? { ...f, name } : f)) });
      }
      announce(`Renamed to ${name}`);
    });
  }

  export function requestMoveToFolder(ids) {
    return new Promise((resolve) => {
      const state = libraryState.get();
      const dialog = document.createElement("div");
      dialog.className = "dialog-overlay";
      dialog.innerHTML = `
        <div class="dialog">
          <h2 class="dialog-title">Move to folder…</h2>
          <div class="dialog-body">
            <button type="button" class="context-menu-item" data-move-target="">Home</button>
            ${state.folders
              .filter((f) => !ids.includes(f.id))
              .map((f) => `<button type="button" class="context-menu-item" data-move-target="${f.id}">${escapeHtml(f.name)}</button>`)
              .join("")}
          </div>
        </div>
      `;
      document.body.appendChild(dialog);

      dialog.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-move-target]");
        if (!btn) return;
        const targetId = btn.dataset.moveTarget || null;
        const next = libraryState.get();
        libraryState.set({
          files: next.files.map((f) => (ids.includes(f.id) ? { ...f, parentId: targetId } : f)),
          folders: next.folders.map((f) => (ids.includes(f.id) ? { ...f, parentId: targetId } : f)),
          selectedIds: [],
        });
        dialog.remove();
        announce(`Moved ${ids.length} item${ids.length === 1 ? "" : "s"}`);
        resolve();
      });
    });
  }

  export function requestBeskIt(ids) {
    return showConfirmDialog(
      ids.length === 1 ? "Besk it?" : `Besk ${ids.length} items?`,
      "This publishes the selected asset(s) on-chain.",
      [
        { text: "Cancel", value: "cancel", className: "btn btn-secondary" },
        { text: "Besk it", value: "confirm", className: "btn btn-primary" },
      ]
    ).then((value) => {
      if (value !== "confirm") return;
      const state = libraryState.get();
      libraryState.set({
        files: state.files.map((f) => (ids.includes(f.id) ? { ...f, status: "besked" } : f)),
      });
      announce(`${ids.length} item${ids.length === 1 ? "" : "s"} besked`);
    });
  }

  export function initLibraryContextMenu() {
    const container = document.getElementById("libraryItems");

    container?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const el = e.target.closest("[data-id]");

      if (!el) {
        openContextMenu(e.clientX, e.clientY, []);
        return;
      }

      const id = el.dataset.id;
      const state = libraryState.get();
      const ids = state.selectedIds.includes(id) ? state.selectedIds : [id];
      if (!state.selectedIds.includes(id)) libraryState.set({ selectedIds: ids });
      openContextMenu(e.clientX, e.clientY, ids);
    });

    document.addEventListener("click", (e) => {
      if (menuEl && !menuEl.contains(e.target)) closeContextMenu();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menuEl) closeContextMenu();
    });
  }
  ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-context-menu.test.js --runInBand`
  Expected: PASS (14 tests)

- [ ] **Step 5: Wire `initLibraryContextMenu()` into `library-init.js`**

  In `frontend/src/js/library-init.js`, find:

  ```js
  import { initLibraryToolbar } from "./ui/library-toolbar.js";
  ```

  Replace with:

  ```js
  import { initLibraryToolbar } from "./ui/library-toolbar.js";
  import { initLibraryContextMenu } from "./ui/library-context-menu.js";
  ```

  Then find:

  ```js
  initLibraryGrid();
  initLibraryToolbar();
  applyWalletGate(Boolean(walletState.get().walletAddress));
  ```

  Replace with:

  ```js
  initLibraryGrid();
  initLibraryToolbar();
  initLibraryContextMenu();
  applyWalletGate(Boolean(walletState.get().walletAddress));
  ```

- [ ] **Step 6: Update the library-init build test for the new import**

  In `test/frontend/library-init.test.js`, add a new test inside the `describe("library-init.js", ...)` block:

  ```js
    test("wires the context menu module", () => {
      expect(src()).toMatch(/initLibraryContextMenu\(\)/);
    });
  ```

- [ ] **Step 7: Add the F2 rename and context-menu-open shortcuts to `library-grid.js`'s keydown handler**

  In `frontend/src/js/ui/library-grid.js`, find:

  ```js
    if (e.key === "Delete" && state.selectedIds.length > 0) {
      requestDelete(state.selectedIds);
    }
  }
  ```

  Replace with:

  ```js
    if (e.key === "Delete" && state.selectedIds.length > 0) {
      requestDelete(state.selectedIds);
      return;
    }

    if (e.key === "F2" && state.selectedIds.length === 1) {
      import("./library-context-menu.js").then(({ requestRename }) => requestRename(state.selectedIds[0]));
    }
  }
  ```

  This is a dynamic import specifically to avoid a circular static import (`library-context-menu.js` already imports `openInStudio`/`requestDelete` from `library-grid.js`); F2 is the only place `library-grid.js` needs something from `library-context-menu.js`.

- [ ] **Step 8: Add an F2 test to `test/library-grid.test.js`**

  Add this test inside the existing `describe("keyboard shortcuts", ...)` block:

  ```js
    test("F2 opens the rename dialog for the single selected item", async () => {
      window.focusTrap = {
        createFocusTrap: () => ({ activate() { return this; }, deactivate() { return this; } }),
      };
      seedTwoFiles();
      initLibraryGrid();
      libraryState.set({ selectedIds: ["a"] });

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.querySelector(".dialog-title").textContent).toBe("Rename");
    });
  ```

- [ ] **Step 9: Rebuild and run all four library test files to verify no regressions**

  Run: `npm run build:frontend && NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-grid.test.js test/library-toolbar.test.js test/library-context-menu.test.js test/frontend/library-init.test.js --runInBand`
  Expected: PASS (all tests)

- [ ] **Step 10: Commit**

  ```bash
  git add frontend/src/js/ui/library-context-menu.js frontend/src/js/ui/library-grid.js frontend/src/js/library-init.js frontend/dist \
          test/library-context-menu.test.js test/library-grid.test.js test/frontend/library-init.test.js
  git commit -m "feat(library): add right-click context menu — Besk it, rename, move, delete"
  ```

---

## Task 8: Rubber-band drag selection + final accessibility pass + manual smoke test

Spec §5 requires "drag a rubber-band box over empty space to multi-select by region," which no
prior task implements. This task adds it to `library-grid.js`, then does a final accessibility
pass and a manual browser smoke test across both empty states and the full interaction set.

**Files:**
- Modify: `frontend/src/js/ui/library-grid.js`
- Modify: `frontend/src/scss/components/_library-grid.scss`
- Modify: `test/library-grid.test.js`

**Interfaces:**
- Consumes: nothing new — uses `libraryState`, `currentItems()` already defined in `library-grid.js`.
- Produces: no new exports; `initLibraryGrid()` gains rubber-band mousedown/mousemove/mouseup handling on `#libraryContent`.

- [ ] **Step 1: Write the failing rubber-band test**

  Add this `describe` block to the end of `test/library-grid.test.js`:

  ```js
  describe("rubber-band selection", () => {
    function rect(el, box) {
      el.getBoundingClientRect = () => ({ ...box, width: box.right - box.left, height: box.bottom - box.top });
    }

    test("dragging a box over empty space selects every item it intersects", () => {
      libraryState.set({
        files: [
          { id: "a", name: "a.glb", parentId: null, status: "wip" },
          { id: "b", name: "b.glb", parentId: null, status: "wip" },
        ],
      });
      initLibraryGrid();

      const content = document.getElementById("libraryContent");
      rect(content, { left: 0, top: 0, right: 1000, bottom: 1000 });
      const container = document.getElementById("libraryItems");
      const itemA = container.querySelector('[data-id="a"]');
      const itemB = container.querySelector('[data-id="b"]');
      rect(itemA, { left: 10, top: 10, right: 50, bottom: 50 });
      rect(itemB, { left: 200, top: 200, right: 240, bottom: 240 });

      content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 0, clientY: 0 }));
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 250, clientY: 250 }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

      expect(libraryState.get().selectedIds.sort()).toEqual(["a", "b"]);
    });

    test("a rubber-band drag that starts on an item does not start a selection box", () => {
      libraryState.set({ files: [{ id: "a", name: "a.glb", parentId: null, status: "wip" }] });
      initLibraryGrid();
      const container = document.getElementById("libraryItems");
      const itemA = container.querySelector('[data-id="a"]');

      itemA.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 0, clientY: 0 }));
      expect(document.querySelector(".library-rubber-band")).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-grid.test.js --runInBand`
  Expected: FAIL — `selectedIds` stays `[]` for the first test (no rubber-band handling exists yet)

- [ ] **Step 3: Implement rubber-band selection**

  In `frontend/src/js/ui/library-grid.js`, find:

  ```js
  function initDropzone() {
  ```

  Replace with:

  ```js
  function rectsIntersect(a, b) {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }

  function initRubberBand() {
    const content = document.getElementById("libraryContent");
    if (!content) return;

    let band = null;
    let startX = 0;
    let startY = 0;

    content.addEventListener("mousedown", (e) => {
      if (e.target.closest("[data-id]")) return;
      if (e.button !== 0) return;

      startX = e.clientX;
      startY = e.clientY;
      band = document.createElement("div");
      band.className = "library-rubber-band";
      document.body.appendChild(band);
      positionBand(band, startX, startY, startX, startY);
    });

    document.addEventListener("mousemove", (e) => {
      if (!band) return;
      positionBand(band, startX, startY, e.clientX, e.clientY);
    });

    document.addEventListener("mouseup", () => {
      if (!band) return;
      const boxRect = band.getBoundingClientRect();
      band.remove();
      band = null;

      const container = document.getElementById("libraryItems");
      const selectedIds = [];
      container?.querySelectorAll("[data-id]").forEach((el) => {
        if (rectsIntersect(boxRect, el.getBoundingClientRect())) selectedIds.push(el.dataset.id);
      });
      if (selectedIds.length > 0) {
        libraryState.set({ selectedIds });
        announce(`${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"} selected`);
      }
    });
  }

  function positionBand(band, x1, y1, x2, y2) {
    band.style.left = `${Math.min(x1, x2)}px`;
    band.style.top = `${Math.min(y1, y2)}px`;
    band.style.width = `${Math.abs(x2 - x1)}px`;
    band.style.height = `${Math.abs(y2 - y1)}px`;
  }

  function initDropzone() {
  ```

  Then find:

  ```js
  export function initLibraryGrid() {
    initDropzone();
  ```

  Replace with:

  ```js
  export function initLibraryGrid() {
    initDropzone();
    initRubberBand();
  ```

- [ ] **Step 4: Add the rubber-band CSS**

  In `frontend/src/scss/components/_library-grid.scss`, find:

  ```scss
  .library-view-toggle {
  ```

  Replace with:

  ```scss
  .library-rubber-band {
    position: fixed;
    z-index: 30;
    border: 1px solid var(--accent-bg);
    background-color: color-mix(in srgb, var(--accent-bg) 15%, transparent);
    pointer-events: none;
  }

  .library-view-toggle {
  ```

- [ ] **Step 5: Run it to verify it passes**

  Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/library-grid.test.js --runInBand`
  Expected: PASS (all tests, including both new rubber-band tests)

- [ ] **Step 6: Rebuild frontend and run the complete test suite for regressions**

  Run: `npm run build:frontend && npm test`
  Expected: PASS — every existing suite (`test/api.test.js`, `test/outliner.test.js`, `test/state/*.test.js`, `test/frontend/*.test.js`, `test/library-*.test.js`, etc.) passes; no regressions from the studio.pug page-switcher addition or the new SCSS partials.

- [ ] **Step 7: Manual browser smoke test**

  Start the backend (`npm start`) and open `http://localhost:9090/library.html`. Walk through:
  1. With no wallet connected: confirm only the "Connect Wallet" empty-state renders — no toolbar, no grid, no statusbar visible.
  2. Connect a wallet (Hardhat local + MetaMask, or whatever the dev setup uses): confirm the gate disappears and the toolbar/content/statusbar appear.
  3. Drag a `.glb` file from the OS file manager onto the content area: confirm the drop-indicator overlay appears on dragover, and the file appears immediately in "Uploading…" then "Work in Progress" status.
  4. Click "Upload," pick a `.glb` via the native file picker: confirm the same Save flow.
  5. Drag a `.txt` file onto the content area: confirm a toast appears ("Unsupported file type…") and no card is added.
  6. Click "New Folder," type a name, confirm: folder appears; double-click it, confirm breadcrumb updates and `Backspace` returns to Home.
  7. Click a file, `Ctrl`-click a second, `Shift`-click a third: confirm multi-selection. Click empty space: confirm selection clears. Drag a rubber-band box over two files: confirm both get selected.
  8. Right-click a single "Work in Progress" file: confirm "Besk it / Open in Studio / Rename / Move to folder… / Delete" all appear; click "Besk it," confirm, confirm the grid badge changes from a flag icon to a checkmark and the list badge becomes "Besked."
  9. Right-click empty space: confirm only "New Folder / Upload" appear.
  10. Press `F2` on a selected file: confirm the rename dialog opens; press `Delete` on a selection: confirm the delete confirmation dialog opens.
  11. Toggle Grid/List view in the statusbar: confirm the symmetric badge treatment — grid view shows a flag icon for "Work in Progress" files and a checkmark icon for "Besked" files; list view shows the literal "Work in Progress"/"Besked" text badges in both states.
  12. Click the "Studio" tab in the headerbar page-switcher: confirm it navigates to `/studio.html` and the same theme/network/wallet state is reflected there; click back to "Library."

  Record the outcome of each step in the PR description or task tracker; do not mark this task complete until all 12 pass.

- [ ] **Step 8: Commit**

  ```bash
  git add frontend/src/js/ui/library-grid.js frontend/src/scss/components/_library-grid.scss frontend/dist test/library-grid.test.js
  git commit -m "feat(library): add rubber-band multi-select drag over empty space"
  ```
