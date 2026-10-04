# Phase 2 — Library-First Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Arbesk read as an asset repository with a viewer:
- app entry links land in the Library;
- the header belongs to the open asset;
- creation is behind a **New ▾** menu;
- the account is an avatar menu and the network a labelled status dot;
- the Studio rail becomes **Outline · Assets · Create · Activity**;
- Settings moves into the Properties panel.

**Architecture:** Mostly markup and wiring changes on top of existing modules. The New ▾ menu and theme menu share `ui/menu-button.ts` (Phase 1). **Existing element ids are kept wherever possible** (`#newAssetBtn` becomes the "Empty asset" menu item; `#disconnectWalletBtn` becomes the avatar; `#headerbarNetworkSelect` moves into the wallet popover; `data-view="library"` stays as the Assets tab), so `asset-chrome.ts`, `scene-graph.ts`, `wallet-popover.ts`, `outliner.ts` and most E2E selectors keep working.

**Tech Stack:** Pug, SCSS, TypeScript, Alpine.js (`x-data` components and stores), Bun test with the jsdom preload, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-10-04-ui-library-first-design.md` (including the §7.1 amendment: Gallery kept as "Assets")
**Roadmap:** `docs/superpowers/specs/2026-10-04-ui-refresh-roadmap.md`

## Global Constraints

- **Prerequisites:** Phase 1 (`2026-10-04-ui-theme-graphite-paper.md`) **and** the CAD frontend plan (`2026-10-04-cad-frontend-integration.md`) are merged to `main`. Line numbers below are from `main` @ `7d3b2fb`; **re-locate every anchor with `grep -n` before editing**, because the CAD plan edits `create-panel.ts` and `studio-sidebar.pug`.
- Design authority: WCAG 2.2 AA → web conventions (WAI-ARIA APG) → Arbesk design language. GNOME HIG is non-binding.
- Status never relies on colour alone (WCAG 1.4.1): the network dot always has a text label.
- Desktop/laptop only.
- Only theme tokens in SCSS. The Phase 1 leak guard (`theme-contrast.test.js`) and style guards must stay green.
- Unit tests: `bun scripts/run-tests.mjs <file>`. Full suite: `bun run test:frontend`. E2E: `bun run test:e2e` against a **freshly restarted** dev stack (it reuses any backend on :9090).

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/js/app/route-parse.ts`, `app/router.ts`, `app/initial-view.ts` | In-app fallback view → library |
| `frontend/src/pug/index.pug` | Marketing page entry links → `/library` |
| `frontend/src/js/ui/sidebar.ts`, `pug/includes/studio-sidebar.pug` | Rail order, labels, shortcuts, stored-view migration, Settings view removal |
| `frontend/src/pug/includes/studio-main.pug`, `js/ui/asset-chrome.ts` | Properties → Asset section, its visibility, header meta `v<N> · <status>` |
| `frontend/src/js/ui/new-menu.ts` (new), `pug/includes/header.pug` | New ▾ menu |
| `frontend/src/js/utils/identicon.ts` (new) | Deterministic SVG identicon from an address |
| `frontend/src/js/ui/header-wallet-button.ts`, `pug/includes/wallet-popover.pug` | Avatar button, Sign in button, network select inside the popover |
| `frontend/src/js/ui/testnet-banner.ts` | Network status dot |
| `frontend/src/scss/components/_headerbar.scss`, `_wallet-popover.scss`, `_inspector.scss`, `_sidebar.scss` | Styling |
| `e2e/helpers/studio-selectors.mjs`, `e2e/helpers/flows.mjs`, affected specs | E2E updates |

---

### Task 1: Entry links land in the Library

**Files:**
- Modify: `frontend/src/js/app/route-parse.ts:24-29`
- Modify: `frontend/src/js/app/router.ts` (doc comment at ~36-39; the `setView` guard at ~160)
- Modify: `frontend/src/js/app/initial-view.ts:12-16`
- Modify: `frontend/src/pug/index.pug:61,62,74-75,188,196`
- Modify: `frontend/src/pug/includes/library-view.pug` (`#libraryGate` actions)
- Test: `test/frontend/library-build.test.js`
- Test: `test/frontend/route-parse.test.js:9-17`, `test/frontend/router.test.js:49-55`

**Interfaces:**
- Produces: `parseAppPath(p).view === "library"` for any path not starting with `/studio` or `/library`.

- [ ] **Step 1: Update the tests to the new default (they will fail)**

`test/frontend/route-parse.test.js`: rename the first test to `"root and unknown paths resolve to library with no subject"` and change `view: "studio",` inside it to `view: "library",`.

`test/frontend/router.test.js` (`pathToView` test): rename it to `"maps paths to views, defaulting unknown/root to library"` and change

```js
    expect(pathToView("/")).toBe("studio");
    expect(pathToView("/anything-else")).toBe("studio");
```

to

```js
    expect(pathToView("/")).toBe("library");
    expect(pathToView("/anything-else")).toBe("library");
```

Add, in the same file, a test for the `?login=1` deep link. It reads `location.search` only, so it works on any view; this test pins that:

```js
test("app-init opens sign-in for ?login=1 regardless of view path", () => {
  const src = require("fs").readFileSync(
    require("path").resolve(__dirname, "../../frontend/src/js/app-init.ts"), "utf-8");
  expect(src).toMatch(/new URLSearchParams\(location\.search\)\.has\("login"\)/);
  expect(src).not.toMatch(/pathname[^\n]*login/);
});
```

(If `require`/`__dirname` aren't available in this ESM file, use the `fs`/`path`/`url` import pattern from `test/frontend/library-init.test.js`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `bun scripts/run-tests.mjs test/frontend/route-parse.test.js test/frontend/router.test.js`
Expected: FAIL on the `/` and `/anything-else` assertions.

- [ ] **Step 3: Change the defaults**

`frontend/src/js/app/route-parse.ts`, inside `parseAppPath`:

```ts
  if (root !== "studio" && root !== "library") {
    return { view: "library", subjectAddress: null, invalidSubject: false };
  }
```

`frontend/src/js/app/router.ts`: update the `pathToView` doc comment to "Library is the default, so any unknown in-app path resolves to the asset browser." In `setView`, change the guard to `if (view !== "studio" && view !== "library") view = "library";`.

`frontend/src/js/app/initial-view.ts` (update the comment too):

```ts
document.documentElement.dataset.initialView = location.pathname.startsWith(
  "/studio",
)
  ? "studio"
  : "library";
```

- [ ] **Step 4: Point the marketing entry links at the Library**

In `frontend/src/pug/index.pug`:
- line 61: `a.btn.btn-flat(href="/studio?login=1") Log in` → `a.btn.btn-flat(href="/library?login=1") Log in`
- line 62: `a.btn.btn-primary(href="/studio") Open Studio` → `a.btn.btn-primary(href="/library") Open app`
- line 74–75: `a.cta(href="/studio")` / `| Open Studio` → `a.cta(href="/library")` / `| Open Library`
- line 188: `a.cta(href="/studio") Open Studio` → `a.cta(href="/library") Open Library`
- line 196 (footer nav `Studio` link) stays as is.

Leave `a.cta.cta-secondary(href="/library") Upload a model` unchanged.

**Signed-out Library gate** (`frontend/src/pug/includes/library-view.pug`, `#libraryGate`): change the button text `Login / Signup` to `Sign in`, and add a secondary link right after it:

```pug
      a.empty-state-action.btn.btn-secondary.btn-sm(href="/studio" data-nav) Open Studio
```

(`data-nav` makes the router handle it client-side.) If `.empty-state` lays actions out vertically and two actions look cramped, wrap both in `.empty-state-actions` with `display:flex; gap:var(--size-2); justify-content:center;` in `_empty-state.scss`.

Add to `test/frontend/library-build.test.js`, in the first test: `expect(html).toMatch(/id="libraryGate"[\s\S]*href="\/studio"[^>]*data-nav/);`

- [ ] **Step 5: Run tests and build**

Run: `cd frontend && bun run build && cd .. && bun scripts/run-tests.mjs test/frontend/route-parse.test.js test/frontend/router.test.js test/frontend/build.test.js`
Expected: PASS. If `build.test.js` asserts on landing CTA hrefs, update those expectations to `/library`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/app frontend/src/pug/index.pug test/frontend/route-parse.test.js test/frontend/router.test.js
git commit -m "feat(nav): app entry lands in the Library; unknown in-app paths fall back to library"
```

---

### Task 2: Studio rail — Outline · Assets · Create · Activity

**Files:**
- Modify: `frontend/src/js/ui/sidebar.ts:1-4,7,38-50,101-108`
- Modify: `frontend/src/pug/includes/studio-sidebar.pug:1-16` (switcher) and the Gallery view header (~193-198)
- Modify: `frontend/src/js/ui/keyboard-help.ts` (sidebar rows)
- Modify: `frontend/src/js/engine/scene-graph.ts` (`startNewAsset`: `m.switchView("chat")` stays, so a new empty asset still opens Create; no change, just confirm)
- Test: `test/frontend/sidebar-views.test.js` (new)

**Interfaces:**
- Produces: `VIEWS = ["outline", "library", "chat", "ledger"]`; `switchView(name)` (unchanged export); stored key `arbesk-sidebar-view` values ∈ VIEWS.
- Note: the **Settings view still exists after this task**; Task 3 removes it. Until then it's reachable only programmatically, not from the rail.

- [ ] **Step 1: Write the failing test**

Create `test/frontend/sidebar-views.test.js`:

```js
// @test-env dom
import { beforeEach, describe, expect, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const VIEWS = ["outline", "library", "chat", "ledger"];

function fragment() {
  const btns = VIEWS.map(
    (v) => `<button class="sidebar-switcher-btn" data-view="${v}" role="tab"></button>`,
  ).join("");
  const panes = VIEWS.map((v) => `<div class="sidebar-view" data-view="${v}" hidden></div>`).join("");
  return `<aside class="sidebar"><div class="sidebar-switcher">${btns}</div>${panes}</aside>`;
}

async function load() {
  resetModules();
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.matchMedia = window.matchMedia;
  document.body.innerHTML = fragment();
  const mod = await import("../../frontend/src/js/ui/sidebar.js");
  mod.initSidebar();
  return mod;
}

const visible = () =>
  [...document.querySelectorAll(".sidebar-view")].filter((p) => !p.hidden).map((p) => p.dataset.view);

const ctrl = (key) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true }));

beforeEach(() => localStorage.clear());

describe("sidebar views", () => {
  test("defaults to Outline", async () => {
    await load();
    expect(visible()).toEqual(["outline"]);
  });

  test("migrates a stored 'settings' view to Outline", async () => {
    localStorage.setItem("arbesk-sidebar-view", "settings");
    await load();
    expect(visible()).toEqual(["outline"]);
  });

  test("restores a valid stored view", async () => {
    localStorage.setItem("arbesk-sidebar-view", "ledger");
    await load();
    expect(visible()).toEqual(["ledger"]);
  });

  test("Ctrl+1..4 map to Outline, Assets, Create, Activity", async () => {
    await load();
    ctrl("2");
    expect(visible()).toEqual(["library"]);
    ctrl("3");
    expect(visible()).toEqual(["chat"]);
    ctrl("4");
    expect(visible()).toEqual(["ledger"]);
    ctrl("1");
    expect(visible()).toEqual(["outline"]);
  });

  test("Ctrl+5 is not intercepted", async () => {
    await load();
    const ev = new KeyboardEvent("keydown", { key: "5", ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  test("Create does not pulse on load (not AI-first)", async () => {
    await load();
    expect(document.querySelector('[data-view="chat"]').classList.contains("pulse")).toBe(false);
  });
});
```

Check `initSidebar` is exported (`grep -n "^export\|initSidebar" frontend/src/js/ui/sidebar.ts`). `app-init.ts` imports it, so it is.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/sidebar-views.test.js`
Expected: FAIL. The default is "chat", Ctrl+2 hits "settings", and chat pulses.

- [ ] **Step 3: Implement in `sidebar.ts`**

Header comment (lines 1–4):

```ts
/**
 * Sidebar with a 4-view switcher (outline, library = "Assets", chat = "Create", ledger = "Activity").
 * @remarks Width is user-resizable and persisted, but only on wide layouts.
 */
```

Line 7: `const VIEWS = ["outline", "library", "chat", "ledger"];`

Lines 38–50 (restore and pulse) become:

```ts
  // Restore last view or default to Outline. Retired views ("settings",
  // pre-Phase-2) and unknown values fall back to Outline.
  const stored = localStorage.getItem(STORAGE_KEY);
  switchView(stored && VIEWS.includes(stored) ? stored : "outline");

  // On narrow screens the sidebar overlays the viewport, so it must start
  // closed or it hides the canvas on first visit.
  if (window.matchMedia("(max-width: 900px)").matches) {
    collapseSidebar();
  }
```

That deletes the `chatBtn` pulse block. `scene-graph.ts`'s `dismissCreatePulse` keeps working as a no-op when no pulse class is present.

Lines 101–108:

```ts
  // Keyboard: Ctrl+1-4 to switch views
  document.addEventListener("keydown", (e) => {
    if (isEditing()) return;
    if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "4") {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (VIEWS[idx]) switchView(VIEWS[idx]);
    }
  });
```

- [ ] **Step 4: Update the rail markup**

Replace the switcher buttons in `frontend/src/pug/includes/studio-sidebar.pug` (lines 2–16, keep `.sidebar-switcher-bottom` as is) with:

```pug
  button.sidebar-switcher-btn.active(data-view="outline" role="tab" aria-selected="true" tabindex="0" aria-label="Outline" title="Outline (Ctrl+1)")
    svg(width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
      use(href="/icons.svg#crosshair")
  button.sidebar-switcher-btn(data-view="library" role="tab" aria-selected="false" tabindex="-1" aria-label="Assets" title="Assets (Ctrl+2)")
    svg(width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
      use(href="/icons.svg#book")
  button.sidebar-switcher-btn(data-view="chat" role="tab" aria-selected="false" tabindex="-1" aria-label="Create" title="Create (Ctrl+3)")
    svg(width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
      use(href="/icons.svg#sparkle")
  button.sidebar-switcher-btn(data-view="ledger" role="tab" aria-selected="false" tabindex="-1" aria-label="Activity" title="Activity (Ctrl+4)")
    svg(width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
      use(href="/icons.svg#file-text")
```

The Settings switcher button is gone; its view is removed in Task 3.

In the AI Generation view header (`h3 AI Generation`), change the text to `h3 Create`.

In the Gallery view (`.sidebar-view(data-view="library" hidden)`), change `h3 Gallery` to `h3 Assets`, and add directly after `.sidebar-view-header` (as a sibling, before `.sidebar-view-body`):

```pug
    p.sidebar-view-hint Add to Scene or drag into the viewport to place an asset.
```

Add to `frontend/src/scss/components/_sidebar.scss`:

```scss
.sidebar-view-hint {
  margin: 0;
  padding: 0 var(--size-3) var(--size-2);
  font-size: var(--font-size-0);
  color: var(--dim-fg);
}
```

The `title` attributes get platform-rewritten (Ctrl → ⌘) by `rewriteShortcutTitles()`, so no extra work is needed.

- [ ] **Step 5: Update keyboard help**

In `frontend/src/js/ui/keyboard-help.ts`, find the rows for the sidebar view shortcuts (`grep -n "1\|Gallery\|AI Generation\|Settings" frontend/src/js/ui/keyboard-help.ts`) and replace them with:

```ts
      [`${MOD}+1`, "Outline"],
      [`${MOD}+2`, "Assets (place in scene)"],
      [`${MOD}+3`, "Create"],
      [`${MOD}+4`, "Activity"],
```

If the file uses a single range row (e.g. `${MOD}+1…5`), replace it with these four rows.

- [ ] **Step 6: Run tests**

Run: `bun scripts/run-tests.mjs test/frontend/sidebar-views.test.js && bun run test:frontend`
Expected: PASS. If `create-panel-*.test.js` asserts the default sidebar view is "chat", update that expectation to "outline". The Create panel itself is unchanged.

- [ ] **Step 7: Commit**

```bash
git add frontend/src test/frontend/sidebar-views.test.js
git commit -m "feat(studio): rail is Outline · Assets · Create · Activity; Outline is the default"
```

---

### Task 3: Settings → Properties "Asset" section

**Files:**
- Modify: `frontend/src/pug/includes/studio-sidebar.pug` (delete the `.sidebar-view(data-view="settings" hidden)` block, ~lines 20–42)
- Modify: `frontend/src/pug/includes/studio-main.pug` (insert as the first child of `.inspector-body`, ~line 26)
- Modify: `frontend/src/js/ui/asset-chrome.ts` (toggle `#assetSection`)
- Modify: `frontend/src/scss/components/_settings.scss` (keep form/team styles; they apply inside the inspector now)
- Test: `test/frontend/asset-chrome.test.js`

**Interfaces:**
- Consumes: `renderChrome()` `hasAsset` logic (existing).
- Produces: `section#assetSection.inspector-section` containing, unchanged, `#assetNameDisplay`, `#collectionSelect`, `#tierSelect`, `#tierHelp`, `#teamPanel` and its children.

- [ ] **Step 1: Write the failing test**

Read `test/frontend/asset-chrome.test.js` to learn its fixture (it mirrors header markup and drives `renderChrome` via store/bus). Add `<section id="assetSection" hidden></section>` to its fixture HTML and add:

```js
test("Asset section is hidden with no asset and shown once a draft exists", async () => {
  // Use the file's existing helpers to (1) load with no asset, then
  // (2) set an active manifest CID the same way its other tests do.
  const section = () => document.getElementById("assetSection");
  expect(section().hidden).toBe(true);
  // …existing helper that sets activeAssetManifestCid (e.g. setActiveManifestCid("bafy…"))…
  expect(section().hidden).toBe(false);
});
```

Fill the two helper calls with whatever the file already uses for "no asset" and "has asset" (`grep -n "activeAssetManifestCid\|setActiveManifestCid\|renameAsset" test/frontend/asset-chrome.test.js`).

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/asset-chrome.test.js`
Expected: FAIL (`#assetSection` stays as initialised).

- [ ] **Step 3: Implement the visibility in `asset-chrome.ts`**

Add next to the other element lookups:

```ts
const assetSection = document.getElementById("assetSection");
```

and at the end of `renderChrome()`:

```ts
  // Properties → Asset (name, collection, tier, team): only meaningful once
  // there is something to name/save.
  if (assetSection) assetSection.hidden = !hasAsset;
```

Update the module doc comment's first line to: "Sole writer of the header title/meta, the save/publish/download buttons' visibility, and the Properties → Asset section's visibility."

- [ ] **Step 4: Move the markup**

Cut the contents of `#assetSettings` (the three `.form-group`s and `#teamPanel`) from the Settings view in `studio-sidebar.pug`, then delete the whole Settings `.sidebar-view` block including its comment line.

In `studio-main.pug`, insert as the **first** child of `.inspector-body`:

```pug
    section#assetSection.inspector-section(hidden)
      details(open)
        summary.inspector-section-title Asset
        #assetSettings.inspector-section-body
          .form-group
            label.form-label Asset Name
            #assetNameDisplay.form-input Untitled Asset
          .form-group
            label.form-label(for="collectionSelect") Collection
            select#collectionSelect.form-select
              option(value="") Default
          .form-group
            label.form-label(for="tierSelect") Quality Tier
            select#tierSelect.form-select(aria-describedby="tierHelp")
              option(value="0" selected) Free — ~$0.0001 gas
            .form-help#tierHelp Higher tiers produce better quality meshes.
          #teamPanel.team-section(hidden)
            .team-header
              h5 Collection Collaborators
              span.owner-badge Owner
            .team-list
            p.team-help Open this collection in the Library to add or remove collaborators.
```

Copy the markup **from the live file** rather than from this plan if it has drifted (for example if the CAD plan added fields). The ids must stay identical.

Use `grep -rn "data-view=\"settings\"\|\"settings\"" frontend/src/js` to find any JS that calls `switchView("settings")` and change it to `switchView("outline")` plus `document.getElementById("assetSection")?.querySelector("details")?.setAttribute("open", "")`.

- [ ] **Step 5: Run tests and build**

Run: `cd frontend && bun run build && cd .. && bun scripts/run-tests.mjs test/frontend/asset-chrome.test.js test/frontend/team.test.js test/frontend/collaborators-panel.test.js test/frontend/library-build.test.js && bun run test:frontend`
Expected: PASS. Any test fixture that builds a Settings view to find `#collectionSelect` or `#teamPanel` still works, since the ids are unchanged.

- [ ] **Step 6: Commit**

```bash
git add frontend/src test/frontend/asset-chrome.test.js
git commit -m "feat(studio): Settings moves into Properties → Asset; Settings tab removed"
```

---

### Task 4: New ▾ menu

**Files:**
- Create: `frontend/src/js/ui/new-menu.ts`
- Modify: `frontend/src/pug/includes/header.pug` (replace `button#newAssetBtn…`)
- Modify: `frontend/src/js/ui/asset-chrome.ts` (hide `#newMenuBtn` where it hid `#newAssetBtn`)
- Modify: `frontend/src/js/app-init.ts` (call `initNewMenu()`)
- Modify: `frontend/src/js/ui/keyboard-help.ts` (add `${MOD}+O`)
- Test: `test/frontend/new-menu.test.js` (new)

**Interfaces:**
- Consumes: `initMenuButton(button, menu, { onSelect, onOpen, align })` (Phase 1); `navigate(path)` from `app/router.ts`; `switchView` from `ui/sidebar.ts`; `clearScene` from `engine/cleanup.ts`; `closeAsset`, `getActiveAssetManifestCid` from `@arbesk/asset-core/domain/asset.js`; `emit`, `EVENTS` (`ASSET_FILE_DROPPED`, `SCENE_EMPTY`); `state.scene` from `engine/state.ts`.
- Produces: `initNewMenu(): void`; ids `#newMenuBtn`, `#newMenu`, `#newMenuUpload`, `#newMenuAi`, `#newMenuCad`, `#newAssetBtn` (the "Empty asset" item, keeping the id so the existing `scene-graph.ts` click listener and Ctrl+N keep working), `#newMenuUploadInput`.

- [ ] **Step 1: Write the failing test**

Create `test/frontend/new-menu.test.js`:

```js
// @test-env dom
import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const FRAGMENT = `
  <div class="menu-anchor">
    <button id="newMenuBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="newMenu">New</button>
    <ul id="newMenu" role="menu" hidden>
      <li id="newMenuUpload" role="menuitem" tabindex="-1">Upload model…</li>
      <li id="newMenuAi" role="menuitem" tabindex="-1">Generate with AI</li>
      <li id="newMenuCad" role="menuitem" tabindex="-1">Parametric CAD</li>
      <li class="menu-separator" role="separator"></li>
      <li id="newAssetBtn" role="menuitem" tabindex="-1">Empty asset</li>
    </ul>
    <input id="newMenuUploadInput" type="file" hidden>
  </div>
  <select id="providerSelect"><option value="mock">Mock</option><option value="cad">Parametric CAD</option></select>
  <textarea id="promptInput"></textarea>`;

let navigate, switchView, clearScene, closeAsset, bus, dropped;

async function load({ path = "/studio", activeCid = null } = {}) {
  resetModules();
  window.history.replaceState({}, "", path);
  document.body.innerHTML = FRAGMENT;
  navigate = jest.fn();
  switchView = jest.fn();
  clearScene = jest.fn();
  closeAsset = jest.fn();
  await mock.module("../../frontend/src/js/app/router.js", () => ({ navigate }));
  await mock.module("../../frontend/src/js/ui/sidebar.js", () => ({ switchView }));
  await mock.module("../../frontend/src/js/engine/cleanup.js", () => ({ clearScene }));
  await mock.module("../../frontend/src/js/engine/state.js", () => ({ state: { scene: {} } }));
  await mock.module("@arbesk/asset-core/domain/asset.js", () => ({
    closeAsset,
    getActiveAssetManifestCid: () => activeCid,
  }));
  bus = await import("@arbesk/asset-core/events/bus.js");
  dropped = jest.fn();
  bus.on(bus.EVENTS.ASSET_FILE_DROPPED, dropped);
  const mod = await import("../../frontend/src/js/ui/new-menu.js");
  mod.initNewMenu();
  return mod;
}

const open = () => document.getElementById("newMenuBtn").click();
const item = (id) => document.getElementById(id);

describe("New ▾ menu", () => {
  test("hides the CAD item when the create panel has no cad provider", async () => {
    await load();
    document.querySelector('#providerSelect option[value="cad"]').remove();
    open();
    expect(item("newMenuCad").hidden).toBe(true);
  });

  test("shows the CAD item when the cad provider exists", async () => {
    await load();
    open();
    expect(item("newMenuCad").hidden).toBe(false);
  });

  test("Generate with AI opens Create with a non-CAD provider and focuses the prompt", async () => {
    await load();
    document.getElementById("providerSelect").value = "cad";
    open();
    item("newMenuAi").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(switchView).toHaveBeenCalledWith("chat");
    expect(document.getElementById("providerSelect").value).toBe("mock");
    expect(document.activeElement?.id).toBe("promptInput");
  });

  test("Parametric CAD opens Create with cad selected", async () => {
    await load();
    open();
    item("newMenuCad").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(switchView).toHaveBeenCalledWith("chat");
    expect(document.getElementById("providerSelect").value).toBe("cad");
  });

  test("from the Library, items navigate to /studio first", async () => {
    await load({ path: "/library" });
    open();
    item("newMenuAi").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(navigate).toHaveBeenCalledWith("/studio");
  });

  test("Upload opens the file picker; a chosen file starts a fresh draft", async () => {
    await load({ activeCid: null });
    const input = item("newMenuUploadInput");
    const clickSpy = jest.spyOn(input, "click").mockImplementation(() => {});
    open();
    item("newMenuUpload").click();
    expect(clickSpy).toHaveBeenCalled();

    const file = new File(["x"], "part.glb");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));
    expect(clearScene).toHaveBeenCalled();
    expect(closeAsset).toHaveBeenCalled();
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(dropped.mock.calls[0][0]).toEqual({ file });
  });

  test("Upload over an open asset asks before discarding it", async () => {
    await load({ activeCid: "bafyOpen" });
    window.confirm = jest.fn(() => false);
    globalThis.confirm = window.confirm;
    const input = item("newMenuUploadInput");
    Object.defineProperty(input, "files", { value: [new File(["x"], "a.glb")] });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));
    expect(window.confirm).toHaveBeenCalled();
    expect(clearScene).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/new-menu.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ui/new-menu.ts`**

```ts
/**
 * Header "New ▾" menu: Upload model / Generate with AI / Parametric CAD /
 * Empty asset.
 * @remarks "Empty asset" keeps the legacy #newAssetBtn id, so scene-graph's
 *   existing click listener (and Ctrl+N) remain the single new-asset path.
 *   Upload reuses the viewport file-drop pipeline (ASSET_FILE_DROPPED) after
 *   clearing the scene, so it always creates a new draft rather than
 *   replacing the open asset's model.
 */
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import {
  closeAsset,
  getActiveAssetManifestCid,
} from "@arbesk/asset-core/domain/asset.js";
import { navigate } from "../app/router.ts";
import { clearScene } from "../engine/cleanup.ts";
import { state } from "../engine/state.ts";
import { initMenuButton } from "./menu-button.ts";
import { switchView } from "./sidebar.ts";

const SCENE_WAIT_MS = 15000;

function onStudio(): boolean {
  return location.pathname.startsWith("/studio");
}

/** Navigate to Studio if needed and resolve once the Babylon scene exists. */
async function ensureStudioScene(): Promise<boolean> {
  if (!onStudio()) navigate("/studio");
  const start = Date.now();
  while (!state.scene) {
    if (Date.now() - start > SCENE_WAIT_MS) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

function cadAvailable(): boolean {
  return !!document.querySelector('#providerSelect option[value="cad"]');
}

async function openCreate(provider: "cad" | "default"): Promise<void> {
  if (!onStudio()) navigate("/studio");
  switchView("chat");
  const select = document.getElementById("providerSelect") as HTMLSelectElement | null;
  if (select) {
    if (provider === "cad") {
      select.value = "cad";
    } else if (select.value === "cad") {
      const firstNonCad = Array.from(select.options).find((o) => o.value !== "cad");
      if (firstNonCad) select.value = firstNonCad.value;
    }
    select.dispatchEvent(new Event("change"));
  }
  await Promise.resolve();
  (document.getElementById("promptInput") as HTMLElement | null)?.focus();
}

async function startUpload(file: File): Promise<void> {
  if (
    getActiveAssetManifestCid() &&
    !confirm("Start a new asset from this file? Unsaved changes to the open asset will be lost.")
  ) {
    return;
  }
  if (!(await ensureStudioScene())) return;
  clearScene();
  closeAsset();
  emit(EVENTS.SCENE_EMPTY);
  emit(EVENTS.ASSET_FILE_DROPPED, { file });
}

export function initNewMenu(): void {
  const button = document.getElementById("newMenuBtn");
  const menu = document.getElementById("newMenu");
  const input = document.getElementById("newMenuUploadInput") as HTMLInputElement | null;
  if (!button || !menu) return;

  initMenuButton(button, menu, {
    align: "start",
    onOpen() {
      const cad = document.getElementById("newMenuCad");
      if (cad) cad.hidden = !cadAvailable();
    },
    onSelect(item) {
      switch (item.id) {
        case "newMenuUpload":
          input?.click();
          break;
        case "newMenuAi":
          void openCreate("default");
          break;
        case "newMenuCad":
          void openCreate("cad");
          break;
        case "newAssetBtn":
          // scene-graph.ts owns this id's click listener (startNewAsset).
          if (!onStudio()) navigate("/studio");
          break;
      }
    },
  });

  input?.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void startUpload(file);
    input.value = "";
  });

  // Ctrl/Cmd+O — Upload model…, unless typing in a field.
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "o") return;
    const t = document.activeElement as HTMLElement | null;
    const tag = t?.tagName?.toLowerCase();
    if (t?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select") return;
    if (button.hidden) return;
    e.preventDefault();
    input?.click();
  });
}
```

Note on "Empty asset": a mouse click on `#newAssetBtn` reaches both `scene-graph.ts`'s own listener on the element (`startNewAsset`) and `menu-button.ts`'s menu click handler (close + `onSelect`), so it works as is. Keyboard Enter/Space only reaches `menu-button.ts`'s keydown handler, which calls `onSelect` and not the element's click listeners. To keep one code path, intercept the key in the capture phase, turn it into a real click, and stop the menu-button handler from also selecting. In `initNewMenu`, after `initMenuButton(...)`, add:

```ts
  // Keyboard activation of "Empty asset": convert to a real click so
  // scene-graph's #newAssetBtn listener runs (the click then reaches the
  // menu's click handler → close + onSelect exactly once).
  menu.addEventListener(
    "keydown",
    (e) => {
      const el = document.activeElement as HTMLElement | null;
      if ((e.key === "Enter" || e.key === " ") && el?.id === "newAssetBtn") {
        e.preventDefault();
        e.stopImmediatePropagation();
        el.click();
      }
    },
    true,
  );
```

Add a test for it:

```js
  test("Enter on Empty asset fires the item's click (scene-graph listener)", async () => {
    await load();
    const clicked = jest.fn();
    item("newAssetBtn").addEventListener("click", clicked);
    open();
    item("newAssetBtn").focus();
    item("newAssetBtn").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun scripts/run-tests.mjs test/frontend/new-menu.test.js`
Expected: PASS.

- [ ] **Step 5: Markup, chrome and wiring**

In `frontend/src/pug/includes/header.pug`, replace the `button#newAssetBtn…` block (button, svg and span) with:

```pug
  .menu-anchor
    button#newMenuBtn.btn.btn-secondary(type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="newMenu" title="New")
      svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
        use(href="/icons.svg#plus")
      span New
      svg(width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
        use(href="/icons.svg#chevron-down")
    ul#newMenu.menu-popover(role="menu" aria-label="New" hidden)
      li#newMenuUpload.menu-item(role="menuitem" tabindex="-1")
        span Upload model…
        kbd Ctrl+O
      li#newMenuAi.menu-item(role="menuitem" tabindex="-1")
        span Generate with AI
      li#newMenuCad.menu-item(role="menuitem" tabindex="-1")
        span Parametric CAD
      li.menu-separator(role="separator")
      li#newAssetBtn.menu-item(role="menuitem" tabindex="-1" title="New asset (Ctrl+N)")
        span Empty asset
        kbd Ctrl+N
    input#newMenuUploadInput(type="file" accept=".glb,.gltf,.3mf" hidden)
```

Move this `.menu-anchor` so it sits **directly after `nav.page-switcher`** and before `#backBtn` (spec §4 order: logo · switcher · New ▾ · title …). Remove the now-empty `.headerbar-doc-actions` wrapper only if `New` was its sole remaining child; Save, Besk it and Download stay in it.

The menu opens left-aligned with its button: pass `align: "start"` to `initMenuButton` (Phase 1's helper fixed-positions the menu in JS, because the headerbar is `overflow: hidden`, so a CSS `left`/`right` modifier has no effect).

In `frontend/src/js/ui/asset-chrome.ts`:
- `const newBtn = document.getElementById("newAssetBtn");` → `const newBtn = document.getElementById("newMenuBtn");`
- The existing line `if (newBtn) newBtn.hidden = !hasWallet || isLibraryVisitor();` now hides the whole menu button for anonymous users and visitors, which is the same rule as before.

In `frontend/src/js/app-init.ts`, import `initNewMenu` from `./ui/new-menu.ts` and call `initNewMenu();` right after `initThemeMenu();`.

`kbd` labels are not platform-rewritten. In `new-menu.ts` `initNewMenu`, after the lookups, add:

```ts
  if (/Mac|iPhone|iPad/.test(navigator.platform)) {
    menu.querySelectorAll("kbd").forEach((k) => {
      k.textContent = (k.textContent || "").replace("Ctrl+", "⌘");
    });
  }
```

In `keyboard-help.ts`, in the "Asset" section, add `[`${MOD}+O`, "Upload model…"],` after the `New asset` row.

- [ ] **Step 6: Run tests and build**

Run: `cd frontend && bun run build && cd .. && bun run typecheck:frontend && bun scripts/run-tests.mjs test/frontend/new-menu.test.js test/frontend/asset-chrome.test.js test/frontend/scene-graph-new-asset.test.js && bun run test:frontend`
Expected: PASS. If `asset-chrome.test.js` fixtures reference `#newAssetBtn` for visibility, switch them to `#newMenuBtn`.

- [ ] **Step 7: Manual check in the browser**

On the dev stack, signed in:
- **New ▾ → Upload model…** with a `.glb` creates a new draft named after the file. With an asset open, you get a confirm prompt first.
- **Generate with AI** opens the Create tab with the prompt focused.
- **Parametric CAD** preselects CAD.
- **Empty asset** shows the naming dialog.
- From `/library`, each item first switches to Studio.
- Keyboard: Tab to New, ArrowDown, Enter on each item.

- [ ] **Step 8: Commit**

```bash
git add frontend/src test/frontend/new-menu.test.js test/frontend/asset-chrome.test.js
git commit -m "feat(header): New ▾ menu (Upload / AI / CAD / Empty asset) with Ctrl+O"
```

---

### Task 5: Header meta `v<N> · <status>`

**Files:**
- Modify: `frontend/src/js/ui/asset-chrome.ts` (meta text; subscribe to the version-history store)
- Modify: `frontend/src/pug/includes/header.pug` (`span#assetStatusMeta` gets class `.tabular` from Phase 1)
- Modify: `frontend/src/scss/components/_headerbar.scss` (title truncation)
- Test: `test/frontend/asset-chrome.test.js`

**Interfaces:**
- Consumes: `getState()`, `activeIndex()` and `subscribe()` from `@arbesk/asset-core/domain/version-history-store.js` (`entries` is oldest → newest).
- Produces: meta text `v{activeIndex()+1} · Published|Draft` when `entries.length > 0`; otherwise `Published|Draft`; `Create or open an asset` with no asset.

- [ ] **Step 1: Write the failing test**

In `test/frontend/asset-chrome.test.js`, mock the version store before importing `asset-chrome`:

```js
const versionStore = {
  entries: [],
  active: -1,
  subs: new Set(),
};
await mock.module("@arbesk/asset-core/domain/version-history-store.js", () => ({
  getState: () => ({ entries: versionStore.entries, activeCid: null, publishedCid: null, isLoading: false }),
  activeIndex: () => versionStore.active,
  subscribe: (fn) => { versionStore.subs.add(fn); return () => versionStore.subs.delete(fn); },
}));
```

(Place it inside the file's existing setup helper, before the dynamic import of `asset-chrome.js`, following the file's `mock.module` style.)

Then add:

```js
test("meta shows the 1-based active version and status", async () => {
  // …existing helper to make a draft asset active (unpublished)…
  versionStore.entries = [{ cid: "a" }, { cid: "b" }, { cid: "c" }];
  versionStore.active = 1;
  versionStore.subs.forEach((fn) => fn({}));
  expect(document.getElementById("assetStatusMeta").textContent).toBe("v2 · Draft");
});

test("meta omits the version when there is no history yet", async () => {
  // …existing helper to make a draft asset active…
  versionStore.entries = [];
  versionStore.subs.forEach((fn) => fn({}));
  expect(document.getElementById("assetStatusMeta").textContent).toBe("Draft");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/asset-chrome.test.js`
Expected: FAIL (`"Draft Scene"` ≠ `"Draft"`).

- [ ] **Step 3: Implement**

In `asset-chrome.ts`, add the import:

```ts
import {
  activeIndex,
  getState as getVersionState,
  subscribe as subscribeVersions,
} from "@arbesk/asset-core/domain/version-history-store.js";
```

Replace the `metaEl` block in `renderChrome()` with:

```ts
  if (metaEl) {
    if (!s.activeAssetName && !hasAsset) {
      metaEl.textContent = "Create or open an asset";
    } else {
      const status = s.activeAssetTokenId ? "Published" : "Draft";
      const { entries } = getVersionState();
      metaEl.textContent = entries.length
        ? `v${activeIndex() + 1} · ${status}`
        : status;
    }
  }
```

At the bottom, next to the other subscriptions: `subscribeVersions(renderChrome);`

In `header.pug`: `span#assetStatusMeta.headerbar-title-meta` → `span#assetStatusMeta.headerbar-title-meta.tabular`.

Below 1280px the meta must truncate before any button shrinks (spec §4). In `_headerbar.scss`:

```scss
.headerbar-title {
  min-width: 0;
  flex: 1 1 auto;
}

.headerbar-title-text,
.headerbar-title-meta {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.headerbar-doc-actions,
.headerbar-actions {
  flex-shrink: 0;
}
```

(Merge into the existing rules for these selectors rather than duplicating them. Check them with `grep -n "headerbar-title\|headerbar-doc-actions\|headerbar-actions" frontend/src/scss/components/_headerbar.scss`.)

Run `grep -rn "Draft Scene" e2e test frontend/src` and update any assertions or strings to the new values. E2E `assetTokenIdLabel` points at `#assetStatusMeta`, so check those specs' expectations too.

- [ ] **Step 4: Run tests**

Run: `bun scripts/run-tests.mjs test/frontend/asset-chrome.test.js && bun run test:frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src test/frontend/asset-chrome.test.js
git commit -m "feat(header): asset meta shows v<N> · Draft|Published in tabular mono"
```

**As built (#79, PR pending):** no SCSS change was needed — Phase 1 already gave
`.headerbar-title` `min-width: 0` with ellipsis truncation on
`.headerbar-title-text`/`.headerbar-title-meta`, and `flex-shrink: 0` on
`.headerbar-actions`/`.headerbar-doc-actions`, so the meta already truncates
before any button shrinks. The existing `"Draft Scene"` expectations in
`test/frontend/asset-chrome.test.js` became `"Draft"`; no E2E spec asserted the
old text, so no spec changes.

---

### Task 6: Avatar account button and Sign in button

**Files:**
- Create: `frontend/src/js/utils/identicon.ts`
- Modify: `frontend/src/js/ui/header-wallet-button.ts` (add `identicon` getter)
- Modify: `frontend/src/pug/includes/header.pug` (the `#connectWalletBtn` / `#disconnectWalletBtn` buttons)
- Modify: `frontend/src/scss/components/_headerbar.scss` (`.headerbar-wallet` → `.headerbar-signin` and `.headerbar-avatar`)
- Modify: `frontend/src/js/ui/wallet-popover.ts` (`positionPopover` anchor; unchanged id, so just verify)
- Test: `test/frontend/identicon.test.js` (new), `test/frontend/header-wallet-button.test.js`

**Interfaces:**
- Produces: `identiconSvg(address: string, size?: number): string`. It returns an `<svg …>` string, or `""` for a non-`0x`+40-hex input. The output is deterministic and horizontally mirrored on a 5×5 grid.
- Produces: the `headerWallet` component getter `identicon: string`.
- Keeps: `#connectWalletBtn` (Sign in), `#disconnectWalletBtn` (avatar; still the popover toggle), and `#disconnectWalletBtnText` (now `.sr-only`, still carries `label`, so E2E `toContainText(TRUNCATED_ADDRESS)` keeps passing because Playwright matches `textContent`).

- [ ] **Step 1: Write the failing identicon test**

Create `test/frontend/identicon.test.js`:

```js
import { describe, expect, test } from "bun:test";
import { identiconSvg } from "../../frontend/src/js/utils/identicon.js";

const A = "0x1234567890abcdef1234567890abcdef12345678";
const B = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

function cells(svg) {
  return [...svg.matchAll(/<rect x="(\d)" y="(\d)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe("identiconSvg", () => {
  test("is deterministic and case-insensitive", () => {
    expect(identiconSvg(A)).toBe(identiconSvg(A.toUpperCase().replace("0X", "0x")));
  });

  test("differs between addresses", () => {
    expect(identiconSvg(A)).not.toBe(identiconSvg(B));
  });

  test("is mirrored left-right on a 5x5 grid", () => {
    const set = new Set(cells(identiconSvg(A)).map(([x, y]) => `${x},${y}`));
    for (const key of set) {
      const [x, y] = key.split(",").map(Number);
      expect(set.has(`${4 - x},${y}`)).toBe(true);
    }
  });

  test("rejects non-addresses", () => {
    expect(identiconSvg("")).toBe("");
    expect(identiconSvg("hello")).toBe("");
    expect(identiconSvg("0x123")).toBe("");
  });

  test("is decorative (aria-hidden) and sized", () => {
    const svg = identiconSvg(A, 28);
    expect(svg).toMatch(/aria-hidden="true"/);
    expect(svg).toMatch(/width="28" height="28"/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/identicon.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `utils/identicon.ts`**

```ts
/**
 * Deterministic 5×5 mirrored identicon for a wallet address.
 * @remarks No external service; output is static SVG markup safe for
 *   x-html because the only inputs are validated hex digits.
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function identiconSvg(address: string, size = 28): string {
  if (!ADDRESS.test(address)) return "";
  const hex = address.slice(2).toLowerCase();
  const hue = parseInt(hex.slice(0, 3), 16) % 360;
  const fill = `hsl(${hue} 55% 55%)`;

  const rects: string[] = [];
  // 3 source columns × 5 rows; column 0/1 mirror to 4/3, column 2 is the axis.
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const nibble = parseInt(hex[3 + y * 3 + x], 16);
      if (nibble % 2 !== 0) continue;
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
      if (x < 2) rects.push(`<rect x="${4 - x}" y="${y}" width="1" height="1"/>`);
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" width="${size}" height="${size}" ` +
    `fill="${fill}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">` +
    rects.join("") +
    `</svg>`
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun scripts/run-tests.mjs test/frontend/identicon.test.js`
Expected: PASS.

- [ ] **Step 5: Add the `identicon` getter**

In `frontend/src/js/ui/header-wallet-button.ts`:
- import: `import { identiconSvg } from "../utils/identicon.ts";`
- interface `HeaderWalletComponent`: add `readonly identicon: string;`
- in `headerWallet()`'s returned object, after `get isCdp()`:

```ts
    get identicon() {
      return identiconSvg(hwState().address);
    },
```

- [ ] **Step 6: Update the header-wallet test fixture and add an assertion**

In `test/frontend/header-wallet-button.test.js`, replace the two wallet buttons in `FRAGMENT` with the new markup from Step 7, without the select, which moves in Task 7. Keep the `<select id="headerbarNetworkSelect">` in the fixture for now inside the same `x-data` root, since Task 7 relocates it. Then add:

```js
test("connected state renders an identicon in the avatar", async () => {
  await setup({ walletAddress: ADDRESS, walletSource: "injected" });
  const img = document.querySelector("#disconnectWalletBtn .headerbar-avatar-img");
  expect(img?.innerHTML).toMatch(/^<svg/);
});
```

(Use the file's existing `setup(preState)` signature; check the walletState field names used elsewhere in the file and match them.)

- [ ] **Step 7: Markup and styles**

In `frontend/src/pug/includes/header.pug`, replace the `button#connectWalletBtn…` and `button#disconnectWalletBtn…` blocks with:

```pug
  button#connectWalletBtn.btn.btn-secondary.headerbar-signin.disconnected(:class="{ hidden: connected, disconnected: !connected }" type="button" aria-label="Sign in")
    span Sign in
  button#disconnectWalletBtn.headerbar-avatar.hidden(:class="{ hidden: !connected, 'auth-required': showAuthRequired }" type="button" aria-label="Account menu" :title="label")
    span.headerbar-avatar-img(x-html="identicon" aria-hidden="true")
    span#disconnectWalletBtnText.sr-only(x-text="label") Disconnect
```

In `frontend/src/scss/components/_headerbar.scss`, replace the `.headerbar-wallet` rule set (and its state modifiers) with:

```scss
.headerbar-signin {
  height: 32px;
}

.headerbar-avatar {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: var(--border-size-1) solid var(--hairline);
  border-radius: var(--radius-round);
  background: var(--raised-bg);
  cursor: pointer;

  &:hover {
    background: var(--surface-overlay-hover);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .headerbar-avatar-img {
    display: grid;
    width: 20px;
    height: 20px;
    overflow: hidden;
    border-radius: var(--radius-1);

    svg {
      width: 100%;
      height: 100%;
    }
  }

  // Injected wallet connected but SIWE not done: a badge, plus the label
  // (sr-only + title) carries "• Sign In" for non-visual users.
  &.auth-required::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--warning);
    border: 2px solid var(--headerbar-bg);
  }
}
```

Run `grep -rn "headerbar-wallet" frontend/src` and update any remaining references (JS class checks, `_wallet-popover.scss`) to `.headerbar-avatar` or `.headerbar-signin` as appropriate.

- [ ] **Step 8: Run tests, build, and check E2E expectations**

Run: `cd frontend && bun run build && cd .. && bun scripts/run-tests.mjs test/frontend/identicon.test.js test/frontend/header-wallet-button.test.js test/frontend/wallet-popover.test.js test/frontend/library-build.test.js && bun run test:frontend`
Expected: PASS.

`e2e/specs/01-connect-wallet.spec.js:16-17` (`not.toContainText("Sign In")` / `toContainText(TRUNCATED_ADDRESS)`) still holds via the sr-only label. No change is needed.

- [ ] **Step 9: Commit**

```bash
git add frontend/src test/frontend/identicon.test.js test/frontend/header-wallet-button.test.js
git commit -m "feat(header): account as identicon avatar; quiet Sign in button"
```

**As built (#80, PR pending):**
- `.headerbar-signin` also needs `min-height: 32px` — `.btn` sets
  `min-height: 36px`, which beats `height` alone.
- `_responsive.scss` lost its `.headerbar-wallet` collapse rules (dead
  selectors): the avatar is already 32px and the "Sign in" label is short.
- Avatar button is 32px (with a 20px glyph), not the spec's 28px — it matches
  the sign-in button's height.
- Updating the `header-wallet-button.test.js` fixture to the new markup also
  fixed that file's 2 pre-existing baseline failures (store/event sync tests).
- Added one extra test beyond the plan: disconnected state renders no
  identicon.

---

### Task 7: Network select into the account menu; labelled network status dot

**Files:**
- Modify: `frontend/src/pug/includes/header.pug` (remove `select#headerbarNetworkSelect`; add `button#networkStatus`)
- Modify: `frontend/src/pug/includes/wallet-popover.pug` (add the Network section)
- Modify: `frontend/src/js/ui/testnet-banner.ts` (add `initNetworkStatus`)
- Modify: `frontend/src/scss/components/_headerbar.scss`, `_wallet-popover.scss`
- Test: `test/frontend/testnet-banner.test.js`, `test/frontend/header-wallet-button.test.js`, `test/frontend/library-build.test.js`

**Interfaces:**
- Consumes: `getConfig()` (as `testnet-banner.ts` already does); `CHAIN_IDS.BASE_TESTNET` (84532) and `CHAIN_IDS.HARDHAT_LOCAL` (31415822) from `constants/chains.js`.
- Produces: `initNetworkStatus(): Promise<void>`; element `#networkStatus` with child `.network-status-label`.
- Keeps: `#headerbarNetworkSelect` id and its `change` listener in `app-init.ts` (unchanged code; the element just moves).

- [ ] **Step 1: Write the failing tests**

Append to `test/frontend/testnet-banner.test.js`:

```js
describe("initNetworkStatus", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="networkStatus" class="network-status" hidden><span class="network-status-dot"></span><span class="network-status-label"></span></button>
      <button id="disconnectWalletBtn" class="hidden"></button>
      <button id="connectWalletBtn"></button>`;
  });

  test("Base Sepolia shows a visible 'Testnet' label with the full name as title", async () => {
    const mod = await loadModule({ defaultChainId: 84532 });
    await mod.initNetworkStatus();
    const el = document.getElementById("networkStatus");
    expect(el.hidden).toBe(false);
    expect(el.querySelector(".network-status-label").textContent).toBe("Testnet");
    expect(el.title).toBe("Base Sepolia Testnet");
    expect(el.getAttribute("aria-label")).toBe("Network: Base Sepolia Testnet");
  });

  test("Hardhat local shows 'Local'", async () => {
    const mod = await loadModule({ defaultChainId: 31415822 });
    await mod.initNetworkStatus();
    expect(document.querySelector(".network-status-label").textContent).toBe("Local");
  });

  test("unknown or missing chain stays hidden", async () => {
    const mod = await loadModule(null);
    await mod.initNetworkStatus();
    expect(document.getElementById("networkStatus").hidden).toBe(true);
  });

  test("click opens the account menu when signed in, else sign-in", async () => {
    const mod = await loadModule({ defaultChainId: 84532 });
    await mod.initNetworkStatus();
    const avatar = document.getElementById("disconnectWalletBtn");
    const signin = document.getElementById("connectWalletBtn");
    const a = jest.fn(); const s = jest.fn();
    avatar.addEventListener("click", a);
    signin.addEventListener("click", s);
    document.getElementById("networkStatus").click();
    expect(s).toHaveBeenCalledTimes(1);
    avatar.classList.remove("hidden");
    document.getElementById("networkStatus").click();
    expect(a).toHaveBeenCalledTimes(1);
  });
});
```

The existing `stays hidden on Hardhat local` banner test uses chain id 31337, which is not `HARDHAT_LOCAL`. Leave it alone; it's about the banner.

In `test/frontend/library-build.test.js` ("shared headerbar wallet ids"), add `expect(html).toMatch(/id="networkStatus"/);`. The `headerbarNetworkSelect` assertion stays, since the id still exists in the popover.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun scripts/run-tests.mjs test/frontend/testnet-banner.test.js`
Expected: FAIL (`initNetworkStatus is not a function`).

- [ ] **Step 3: Implement `initNetworkStatus`**

In `frontend/src/js/ui/testnet-banner.ts`, update the module doc comment to cover both, then add after `initTestnetBanner`:

```ts
const NETWORK_STATUS: Record<number, { label: string; title: string }> = {
  [CHAIN_IDS.BASE_TESTNET]: { label: "Testnet", title: "Base Sepolia Testnet" },
  [CHAIN_IDS.HARDHAT_LOCAL]: { label: "Local", title: "Hardhat Local" },
};

/**
 * Header network status: a dot plus a visible text label (never colour
 * alone — WCAG 1.4.1), shown only for non-mainnet deployments.
 * @remarks Clicking opens the account menu (where the network select lives)
 *   when signed in, otherwise starts sign-in.
 */
export async function initNetworkStatus(): Promise<void> {
  const el = document.getElementById("networkStatus");
  if (!el) return;
  const config = await getConfig();
  const info = NETWORK_STATUS[Number(config?.defaultChainId)];
  if (!info) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.title = info.title;
  el.setAttribute("aria-label", `Network: ${info.title}`);
  const label = el.querySelector(".network-status-label");
  if (label) label.textContent = info.label;

  el.addEventListener("click", () => {
    const avatar = document.getElementById("disconnectWalletBtn");
    if (avatar && !avatar.classList.contains("hidden")) avatar.click();
    else document.getElementById("connectWalletBtn")?.click();
  });
}
```

Where the module self-initialises at the bottom (`if (document.readyState === "loading") …`), call `initNetworkStatus()` alongside `initTestnetBanner()` in both branches.

- [ ] **Step 4: Move the select; add the dot**

In `header.pug`, delete the `select#headerbarNetworkSelect…` element and its two `option`s, and insert **before** the theme `.menu-anchor`:

```pug
  button#networkStatus.network-status(type="button" hidden)
    span.network-status-dot(aria-hidden="true")
    span.network-status-label
```

In `wallet-popover.pug`, insert between `.wallet-popover-header` and `a#walletPopoverExplorer`:

```pug
  .wallet-popover-section(x-data="headerWallet")
    label.wallet-popover-label(for="headerbarNetworkSelect") Network
    select#headerbarNetworkSelect.form-select.wallet-popover-network(:class="{ hidden: isCdp }" aria-label="Select network")
      option(value="baseSepolia" selected) Base Sepolia Testnet
      option(value="hardhat") Hardhat Local
    p.wallet-popover-note(x-show="isCdp") Email accounts use Base Sepolia.
```

Copy the `option` list **from the removed header markup** if it differs from the above.

In `wallet-popover.ts` `onDocumentClick`, check that a click on the `<select>` inside the popover doesn't close it. It's inside `popover`, so `popover.contains(target)` already covers it. Verify manually in Step 7.

Styles: in `_headerbar.scss`, delete `.headerbar-network-select` rules and add:

```scss
.network-status {
  display: inline-flex;
  align-items: center;
  gap: var(--size-1);
  height: 28px;
  padding: 0 var(--size-2);
  border: 0;
  border-radius: var(--radius-round);
  background: transparent;
  color: var(--dim-fg);
  font-size: var(--font-size-0);
  cursor: pointer;

  &:hover {
    background: var(--surface-overlay-hover);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  &[hidden] {
    display: none;
  }
}

.network-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--warning);
}
```

In `_wallet-popover.scss`, add:

```scss
.wallet-popover-section {
  display: grid;
  gap: var(--size-1);
  padding: var(--size-2) 0;
  border-top: var(--border-size-1) solid var(--hairline);
}

.wallet-popover-label {
  font-size: var(--font-size-1);
  font-weight: var(--font-weight-6);
  color: var(--dim-fg);
}

.wallet-popover-note {
  margin: 0;
  font-size: var(--font-size-0);
  color: var(--dim-fg);
}
```

- [ ] **Step 5: Update the header-wallet unit test**

In `test/frontend/header-wallet-button.test.js`, the `netSel()` tests assert `hidden` for CDP accounts. Move `<select id="headerbarNetworkSelect">` in `FRAGMENT` into a nested `<div x-data="headerWallet">` that mirrors the popover section, change its `:class` to `{ hidden: isCdp }`, and drop any assertion about the removed `connected` class on the select.

- [ ] **Step 6: Run tests and build**

Run: `cd frontend && bun run build && cd .. && bun scripts/run-tests.mjs test/frontend/testnet-banner.test.js test/frontend/header-wallet-button.test.js test/frontend/wallet-popover.test.js test/frontend/library-build.test.js && bun run test:frontend`
Expected: PASS.

- [ ] **Step 7: Manual check**

On the dev stack:
- **Signed out:** the header shows `• Local` (or `• Testnet`) and Sign in; clicking the dot opens sign-in.
- **Signed in with an injected wallet:** clicking the avatar shows the popover with the Network select. Changing it works as before (same `app-init.ts` handler), and the popover stays open while the select is used.
- **CDP email account:** the select is hidden and the note is shown.
- Esc closes the popover and returns focus to the avatar. If focus doesn't return, add `document.getElementById("disconnectWalletBtn")?.focus()` to `closeState()`'s Escape path in `wallet-popover.ts` `onDocumentKey`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src test/frontend
git commit -m "feat(header): network select moves into the account menu; labelled status dot"
```

**As built (#81, PR pending):**
- `initNetworkStatus` guards double-init with a synchronous
  `dataset.networkStatusInit` claim and attaches the click listener *before*
  the first `await` — the plan's code appended the listener after
  `await getConfig()`, so the module self-init plus an explicit call
  double-registered it (caught by the click test: two listener firings).
- Esc in the wallet popover now always returns focus to the avatar
  (spec §6.1); the plan had this as a conditional follow-up.
- `wallet-popover.test.js`'s 3 pre-existing baseline failures are fixed by
  this task's changes — the file is fully green.
- `_responsive.scss` also drops the now-dead `.headerbar-network-select`
  <480px rule.
- The popover Network section's border uses `--border-hairline` (the file's
  convention), not `--hairline`.

---

### Task 8: E2E updates

**Files:**
- Modify: `e2e/helpers/studio-selectors.mjs`
- Modify: `e2e/helpers/flows.mjs` (add `newEmptyAsset`)
- Modify: `e2e/specs/06-nesting.spec.js:45,150`, `07-collection-assets.spec.js:92,211,309`, `08-fork-live-ref.spec.js:39,99`, `20-new-asset-name.spec.js:14`, `22-live-scene-update.spec.js:28`, `23-cross-window-live-update.spec.js:78`, `24-nested-live-update.spec.js:89,110`, `25-public-profile.spec.js:169,177`
- Modify: any spec asserting `"Draft Scene"` (from the Task 5 grep)

**Interfaces:**
- Produces: `newEmptyAsset(page)` in `flows.mjs`; selectors `newMenuBtn: "#newMenuBtn"`, `newMenu: "#newMenu"`, `networkStatus: "#networkStatus"`; `newAssetBtn` stays `"#newAssetBtn"` (now a menu item); `settingsSwitcherBtn` is **removed**.

- [ ] **Step 1: Selectors**

In `e2e/helpers/studio-selectors.mjs`:
- under `// New asset + nesting`, add `newMenuBtn: "#newMenuBtn",` and `newMenu: "#newMenu",`, and change the comment to `// New ▾ menu ("Empty asset" keeps #newAssetBtn) + nesting`;
- delete `settingsSwitcherBtn: '[data-view="settings"]',`;
- add `networkStatus: "#networkStatus",` next to `testnetBanner`;
- change the comment above `gallerySwitcherBtn` (or add one) to `// Studio "Assets" tab (formerly Gallery): placement picker`.

- [ ] **Step 2: Flow helper**

Append to `e2e/helpers/flows.mjs`:

```js
/**
 * New ▾ → Empty asset (the item keeps the legacy #newAssetBtn id).
 * @param {import("@playwright/test").Page} page
 */
export async function newEmptyAsset(page) {
  await page.click(SELECTORS.newMenuBtn);
  await page.click(SELECTORS.newAssetBtn);
}
```

(`SELECTORS` is already imported in `flows.mjs`. Check the import name at the top of the file.)

- [ ] **Step 3: Replace direct clicks**

In every spec listed under **Files**, replace `await page.click(SELECTORS.newAssetBtn);` (or `pageA.click(...)`) with `await newEmptyAsset(page);` (or `newEmptyAsset(pageA)`), and add `newEmptyAsset` to that spec's `import { … } from "../helpers/flows.mjs"`.

Then check that none remain: `grep -rn "click(SELECTORS.newAssetBtn)" e2e/specs` should print nothing.

- [ ] **Step 4: Settings tab is gone**

`07-collection-assets.spec.js:309`: delete `await page.click(SELECTORS.settingsSwitcherBtn);`. The next lines locate `#collectionSelect`, which is now in Properties → Asset and visible once an asset exists. If the inspector is collapsed at that point, call the existing `openInspector(page)` helper from `flows.mjs` before the locator.

- [ ] **Step 5: Public profile (anonymous visitor)**

`25-public-profile.spec.js:169` (`#galleryConnectBtn` count 0) stays valid; the id is unchanged.

`25-public-profile.spec.js:177`: `await expect(anon.locator(SELECTORS.newAssetBtn)).toBeHidden();` → `await expect(anon.locator(SELECTORS.newMenuBtn)).toBeHidden();`

- [ ] **Step 6: Meta text**

Update any `"Draft Scene"` expectations found in Task 5 to `"Draft"` or to a regex such as `/^(v\d+ · )?Draft$/`.

- [ ] **Step 7: Run E2E**

Restart the dev stack first (project memory: a stale backend on :9090 makes every spec fail at generate; and the Hardhat chain is wiped on container restart, so run `start-dev.sh --setup-only`).

Run: `bun run test:e2e`
Expected: PASS. If a spec fails because a hidden element was clicked, it's almost always a missed `newAssetBtn` site. Use `grep -rn "newAssetBtn" e2e`.

- [ ] **Step 8: Commit**

```bash
git add e2e
git commit -m "test(e2e): New ▾ menu helper; Settings tab removed; Assets tab label"
```

---

### Task 9: Docs and visual verification

**Files:**
- Modify: `docs/CURRENT_STATUS.md`
- Modify: `.agents/skills/edit-ui/SKILL.md` (layout section)
- Modify: `docs/superpowers/specs/2026-10-04-ui-refresh-roadmap.md` (mark Phase 2 done)

- [ ] **Step 1: CURRENT_STATUS**

In the frontend section of `docs/CURRENT_STATUS.md`, describe the new layout:

```markdown
- Layout (library-first): app entry links land in the Library. Studio header: New ▾ (Upload Ctrl+O / Generate with AI / Parametric CAD / Empty asset Ctrl+N), asset name + `v<N> · Draft|Published`, Save, Besk it, network status (labelled), theme menu, account avatar (network select inside). Studio rail: Outline (Ctrl+1) · Assets — placement picker (Ctrl+2) · Create (Ctrl+3) · Activity (Ctrl+4). Asset name/collection/tier/team live in Properties → Asset.
```

Replace any older text describing the AI-first rail or the header wallet pill.

- [ ] **Step 2: edit-ui skill**

In `.agents/skills/edit-ui/SKILL.md`, update any description of the header and rail to match the bullet above, and add:

```markdown
- Menus use `ui/menu-button.ts` (WAI-ARIA APG menu button) — never hand-roll popup keyboard handling.
- Header element ids are load-bearing for E2E: `#newAssetBtn` is the New ▾ "Empty asset" item, `#disconnectWalletBtn` is the avatar, `#headerbarNetworkSelect` lives in the wallet popover.
```

- [ ] **Step 3: Visual pass**

At 1440×900, in both themes, capture: the header signed out, the header signed in on Testnet, the New ▾ menu open, the avatar popover open, and the Studio rail with the Assets tab showing its hint. Save the screenshots to `.playwright-mcp/phase2-*.png` (gitignored) and attach them to the PR.

Check:
- the only filled accent in the header is **Besk it**;
- the testnet dot has its text label;
- tabbing order is New ▾ → Save → Besk it → network → theme → avatar.

- [ ] **Step 4: Full verification**

Run: `bun run lint && bun run typecheck && bun run typecheck:frontend && bun run test:frontend`
Expected: PASS. E2E already ran in Task 8.

- [ ] **Step 5: Mark the roadmap and commit**

Append ` — **done**` to Phase 2's Spec cell in the roadmap table.

```bash
git add docs .agents/skills/edit-ui
git commit -m "docs: library-first layout; Phase 2 done"
```
