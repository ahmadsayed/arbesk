# Studio Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Studio's Insert panel, AI Create flow and Save draft / Publish actions self-explanatory.

**Architecture:** Clarify in place. The Assets rail tab becomes Insert (one click = insert a live link, secondary actions in a ⋯ menu). Create becomes the landing tab with provider details behind an Advanced disclosure and a key dialog only on demand. A small draft-status store drives "Draft / Published" wording and the leave-page guard; button and toast copy changes to Save draft / Publish.

**Tech Stack:** TypeScript (no framework; Alpine.js for some panels), Pug, SCSS, Babylon.js (CDN global), bun:test + jsdom, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-10-15-studio-clarity-design.md`

## Global Constraints

- Follow `.agents/skills/edit-ui/SKILL.md`: theme tokens only (no hex in `components/`), sentence case, no `text-transform: uppercase`, icons from `frontend/public/icons.svg`, menus via `initMenuButton()`, rebuild with `bun run build:frontend`.
- The accent fill stays on `#publishAssetBtn` only. Generate uses the secondary style.
- Load-bearing ids stay: `#saveAssetBtn`, `#publishAssetBtn`, `#providerSelect`, `#promptInput`, `#generateBtn`, `#newAssetBtn`, `.asset-card`, `[data-view="library"]`, `[data-view="chat"]`.
- Copy is fixed by the spec; use the exact strings quoted in each task.
- Unit tests: `bun test test/frontend/<file>`. Full gate before finishing: `bun run test`, `bun run test:frontend`, then the E2E suite (Studio UI/UX and save/publish are E2E-gated per `AGENTS.md`).

## Review Focus

1. **Insert while a previous insert is still loading** (double click on a card): each click must create its own node and toast; Undo on the first toast must unlink only the first node. → Task 1 test.
2. **Card click with no asset open** (fresh Studio): nothing is emitted; the disabled card does not open the asset either. → Task 2 test.
3. **Key dialog dismissed with Escape**: no generation runs, the prompt text is kept. → Task 6 test.
4. **Publish after Save draft, then reload of the same asset**: the leave guard must be quiet after publish and after opening a different asset. → Task 7 test.
5. **E2E mock flow with Advanced closed**: `generateToChatBubble` must open Advanced before `selectOption("mock")` or Playwright times out on a hidden select. → Task 9 step.

---

### Task 1: Live-link insert without the Fork/Live dialog

**Files:**
- Modify: `frontend/src/js/engine/scene-loader.ts:605-690` (`_handleLinkedAssetDropped`)
- Modify: `packages/asset-core/src/events/bus.ts` (new event)
- Test: `test/frontend/linked-asset-self-add.test.js` (extend; reuse its mocks)

**Interfaces:**
- Consumes: existing `ASSET_LINKED_DROPPED` payload `{ token_id, assetID, chainId, contractAddress, clientX?, clientY? }`.
- Produces:
  - Payload gains optional `mode?: "live-ref" | "fork"`.
  - `EVENTS.ASSET_LINKED_INSERTED = "asset:linkedInserted"`, detail `{ nodeId: string, assetID: string, mode: "live-ref" | "fork" }`, emitted after the node has loaded.

- [ ] **Step 1: Write the failing tests** in `linked-asset-self-add.test.js`, new `describe("insert mode")`:
  - `test("mode live-ref skips the dialog and emits ASSET_LINKED_INSERTED")`: emit drop with `mode: "live-ref"`; expect `_dialogCalls.length === 0`, one `pendingChildRefs` entry, and one `ASSET_LINKED_INSERTED` with that entry's `node_id` and `mode: "live-ref"`.
  - `test("mode fork skips the dialog and inserts a copy")`: same with `mode: "fork"`; inserted event `mode: "fork"`.
  - `test("no mode still asks")`: existing behaviour, `_dialogCalls.length === 1`.
  - `test("live-ref self-add with mode is downgraded to fork, not refused")`: self-drop with `mode: "live-ref"` inserts a fork and emits `mode: "fork"`.
  - `test("two rapid inserts get distinct node ids and two events")` (Review Focus 1).
  - `test("unresolvable asset emits ASSET_LINKED_INSERT_FAILED and adds nothing")`.
- [ ] **Step 2: Run** `bun test test/frontend/linked-asset-self-add.test.js` → new tests FAIL.
- [ ] **Step 3: Implement.** Add the event constant. In `_handleLinkedAssetDropped`, `const choice = detail.mode ? (isSelfDrop ? "fork" : detail.mode) : await showForkOrLiveRefDialog(...)`. After the load awaits, `emit(EVENTS.ASSET_LINKED_INSERTED, { nodeId: nodeEntry.node_id, assetID: detail.assetID, mode: choice })` and select the node with the selection helper scene-graph already uses for outliner clicks.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `feat(studio): insert live links without the fork dialog when mode is given`

---

### Task 2: Insert panel cards, ⋯ menu and sections

**Files:**
- Modify: `frontend/src/js/ui/asset-library.ts` (`createSection`, `createAssetCard`, `buildCardFooter`, `wireCardActivation`, `buildLinkedAssetPayload`, `renderAssetLibrary`; delete `buildAddToSceneButton`, `buildDownloadButton`, `buildDeleteButton`, `onDeleteAsset`, `resolveDeleteVisibility`, `buildCardBadge`, `createInaccessibleCard`)
- Modify: `frontend/src/scss/components/` asset-card partial (⋯ button, disabled state)
- Test: `test/frontend/asset-library.test.js`

**Interfaces:**
- Consumes: Task 1 `mode` payload field; `openAssetEntry(entry)` (existing); `initMenuButton()` from `ui/menu-button.ts`; `hasOpenAsset()` from `state/edit-mode.ts`.
- Produces: `buildLinkedAssetPayload(entry, mode: "live-ref" | "fork")`; card DOM: `.asset-card` containing `button.asset-card-main` (accessible name `Insert <name>`) and `button.asset-card-more` (`More actions for <name>`) with a `.menu-popover` of items `[data-action="insert-copy"]` "Insert a copy", `[data-action="open"]` "Open <name>", `[data-action="library"]` "Show in Library"; `.asset-library-failed` footer.

- [ ] **Step 1: Write the failing tests** (new `describe("Insert panel cards")`, document fragment gains a stub event bus spy):
  - `test("card click emits ASSET_ADD_LINKED_REQUESTED with mode live-ref")`.
  - `test("Insert a copy emits mode fork")`.
  - `test("Open item opens the asset")`: `openAssetEntry` path runs (assert `updateUrlAsset`/store change as existing open tests do).
  - `test("cards have no Download, Delete, Burn or role badge")`: `querySelector` for `.asset-card-actions`, `.asset-card-badge`, `.asset-card--inaccessible` all null.
  - `test("sections are 'Your assets' and 'Shared with you'")`.
  - `test("failed tokens render one summary line linking to /library")`: token 3 broken → `.asset-library-failed` text `1 asset can't be loaded. Manage in Library`, link `href="/library"`; plural `2 assets can't be loaded.`.
  - `test("the open asset's own card is hidden")`: `assetStore.set({ activeAssetId: "asset-b", activeCollectionTokenId: null })` → no card named "Asset B".
  - `test("with no asset open cards are disabled and emit nothing")` (Review Focus 2): `.asset-card-main` `disabled`, click emits nothing and does not open.
  - Update the existing "inaccessible card" test to the summary-line expectation.
- [ ] **Step 2: Run** `bun test test/frontend/asset-library.test.js` → FAIL.
- [ ] **Step 3: Implement.** Card = wrapper `div.asset-card` (draggable, drag payload `mode: "live-ref"`) holding the main `<button>` (thumbnail + name) and the ⋯ `<button>`; wire the menu with `initMenuButton({ align: "end" })`. "Show in Library" navigates to `/library` with the entry's collection selected (reuse the `data-nav` router call the page switcher uses). ⋯ → Open runs the discard confirm used by New ▾ (`confirmDiscardOpenAsset`, move it from `ui/new-menu.ts` to `ui/confirm-discard.ts` and export it) before `openAssetEntry`. Sections: "Your assets" / "Shared with you"; empty states keep their copy. Re-render on `ASSET_STATE_CHANGED` and `PENDING_EDITS_CHANGED` only to flip the disabled state (no refetch).
- [ ] **Step 4: Run** → PASS. Also `bun test test/frontend/new-menu.test.js` (moved helper) → PASS.
- [ ] **Step 5: Commit** `feat(studio): Insert panel cards insert on click, secondary actions in a menu`

---

### Task 3: Insert panel chrome, visitor mode, search, toast + Undo

**Files:**
- Modify: `frontend/src/pug/includes/studio-sidebar.pug` (library view header, hint, search input, no-asset block; rail button label/title/icon)
- Modify: `frontend/public/icons.svg` (add `square-plus` symbol)
- Modify: `frontend/src/js/ui/asset-library.ts` (`updateGalleryVisitorChrome`, search filter, inserted toast)
- Modify: `frontend/src/js/ui/keyboard-help.ts:31`
- Test: `test/frontend/asset-library.test.js`

**Interfaces:**
- Consumes: `EVENTS.ASSET_LINKED_INSERTED` (Task 1); `removeChildAssetNodes(nodeIds)` from `engine/child-remove.ts`; `showToast({ title, actions })`.
- Produces: elements `#insertSearchInput`, `#insertNoAsset` (with `#insertNewAssetBtn`), `#insertPanelTitle`, `#insertPanelHint`.

- [ ] **Step 1: Write the failing tests:**
  - `test("visitor mode: title Browse, hint read-only, click opens, menu has only Show in Library")`.
  - `test("search filters cards by name, case-insensitive")`: type "asset b" → one card.
  - `test("no asset open shows the notice; New empty asset clicks #newAssetBtn")`.
  - `test("insert failure shows an error toast with the reason and no Undo")`.
  - `test("insert toast names asset and target, Undo unlinks that node")`: emit `ASSET_LINKED_INSERTED { nodeId: "n1", assetID: "asset-a" }` with `activeAssetName "Chair"` → toast title `Asset A inserted into Chair`; invoking its Undo action calls `removeChildAssetNodes(["n1"])`.
- [ ] **Step 2: Run** `bun test test/frontend/asset-library.test.js` → FAIL.
- [ ] **Step 3: Implement.** Pug: title `Insert`, hint `Insert a live link to another asset. Changes to the original show up here.`, search placeholder `Search assets…` (`aria-label="Search assets"`), no-asset block text `Open or create an asset to insert into it.` + button `New empty asset`. Rail button `aria-label="Insert"`, `title="Insert (Ctrl+2)"`, icon `#square-plus`. Visitor: title `Browse`, hint `Read-only public profile. Open an asset to view it.`. Keyboard help row: `Insert (link another asset)`. Untitled target falls back to `Untitled Asset`.
- [ ] **Step 4: Run** → PASS; `bun test test/frontend/build.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(studio): Insert panel title, search, visitor Browse mode and undoable insert toast`

---

### Task 4: Create is the landing tab; New ▾ order; empty-viewport card

**Files:**
- Modify: `frontend/src/js/ui/sidebar.ts:38-41`
- Modify: `frontend/src/pug/includes/header.pug` (New ▾ item order)
- Modify: `frontend/src/pug/includes/studio-main.pug` (empty card inside `#viewport`)
- Create: `frontend/src/js/ui/empty-viewport.ts`
- Modify: `frontend/src/scss/components/` viewport partial + `styles.scss` `@use` if a new partial
- Test: `test/frontend/sidebar-views.test.js`, `test/frontend/new-menu.test.js`, new `test/frontend/empty-viewport.test.js`

**Interfaces:**
- Consumes: `hasOpenAsset()`; `EVENTS.ASSET_STATE_CHANGED`, `EVENTS.PENDING_EDITS_CHANGED`, `EVENTS.SCENE_EMPTY`.
- Produces: `initEmptyViewport(): void` (called from the Studio init next to `initSidebar`); `#emptyViewport` with buttons `#emptyViewportUpload` (clicks `#newMenuUpload`) and `#emptyViewportEmpty` (clicks `#newAssetBtn`).

- [ ] **Step 1: Write the failing tests:**
  - sidebar: replace `"defaults to Outline"` with `test("no asset in the URL opens Create")` and add `test("an asset in the URL restores the stored view, else Outline")` (set `history.replaceState` to `?asset=1`).
  - new-menu: `test("Generate with AI is the first item")`.
  - empty-viewport: `test("shown with no open asset, hidden once one opens")`, `test("buttons forward to Upload and Empty asset")`.
- [ ] **Step 2: Run** the three files → FAIL.
- [ ] **Step 3: Implement.** Sidebar: `const params = new URLSearchParams(location.search); const hasAsset = params.has("asset") || params.has("manifest");` → `switchView(hasAsset ? (valid stored ?? "outline") : "chat")`. Empty card copy: heading `Start a new asset`, body `Describe it in the Create panel, or bring in a model you already have.`, buttons `Upload model` / `Empty asset`, footnote `or drop a .glb, .gltf or .3mf file here`. It is DOM over the canvas (`pointer-events` only on the card so drops still reach the viewport).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(studio): land on Create with no asset, Generate first in New, empty-viewport card`

---

### Task 5: Create panel without jargon

**Files:**
- Modify: `frontend/src/pug/includes/studio-sidebar.pug` (chat view: subtitle, composer, `<details id="composerAdvanced">`)
- Modify: `frontend/src/js/ui/create-panel.ts` (`syncProviderUI`, provider hydration ~388-430, option gating)
- Test: new `test/frontend/create-panel-advanced.test.js` (copy the module-loading setup from `create-panel-cad.test.js`)

**Interfaces:**
- Produces: `#composerAdvanced` (closed by default; open state in `localStorage["arbesk-create-advanced"]`), `#providerKeyStatus` with `#providerKeyLink`; `#providerSelect` options `auto` "Choose for me", `tripo3d` "AI model (Tripo 3D)", `cad` "Parametric CAD", `mock` "Mock (local)" only when `location.hostname` is `localhost` or `127.0.0.1`. Removes `#providerKeyBtn` and `#providerKeyHint`.

- [ ] **Step 1: Write the failing tests:** `test("Advanced is closed by default and remembers being opened")`, `test("mock option exists only on localhost")` (two hostnames), `test("key status reads 'not added · Add key' then 'added · Change'")`, `test("Add key opens the key dialog")`, `test("a stored 'mock' provider off localhost falls back to auto")`.
- [ ] **Step 2: Run** `bun test test/frontend/create-panel-advanced.test.js` → FAIL.
- [ ] **Step 3: Implement.** Subtitle `Describe a model, or attach up to four photos of it.`; prompt placeholder `A mid-century oak chair with tapered legs`; attach button `aria-label="Attach photos"`, title `Attach up to four photos (front, left, back, right)`; Advanced summary `Advanced`, select label `Generator`; key line `Tripo 3D API key: not added · Add key` / `added · Change`; balance stays `#providerBalance`. Generate button keeps its id, gains visible text `Generate` and the secondary style. Remove the mock `<option>` from Pug and insert it from TS when on localhost. Update existing create-panel tests that referenced `#providerKeyBtn`.
- [ ] **Step 4: Run** the new file plus `bun test test/frontend/create-panel-generate.test.js test/frontend/create-panel-cad.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(create): hide generator details behind Advanced, plain provider names`

---

### Task 6: Key on demand dialog

**Files:**
- Modify: `frontend/src/js/ui/create-panel.ts:2347-2366` (`requestProviderKey`), `buildProviderKeyBody`
- Test: `test/frontend/create-panel-generate.test.js` (tests at :415 and :898)

**Interfaces:**
- Consumes: `showCustomDialog(title, bodyEl)`; `onGenerate({ resubmit: true })`; `pendingAdvisorDispatch`.
- Produces: `requestProviderKey(dispatch)` opens a dialog titled `This model needs an AI generator` instead of posting a chat chip.

- [ ] **Step 1: Rewrite the two tests** (:415, :898) and add:
  - `test("missing key opens the dialog; Save key and generate retries the same dispatch")`.
  - `test("Use Parametric CAD re-runs the prompt with cad")`.
  - `test("with photos attached the CAD button is absent")`.
  - `test("Escape closes the dialog, nothing generates, prompt kept")` (Review Focus 3).
- [ ] **Step 2: Run** `bun test test/frontend/create-panel-generate.test.js` → FAIL.
- [ ] **Step 3: Implement.** Body copy: `Organic shapes like this are made with Tripo 3D, which uses your own API key. You can also try Parametric CAD, which is free but best for geometric parts.`; field label `Tripo 3D API key`; link `Get a key from Tripo 3D` → `https://platform.tripo3d.ai`; buttons `Use Parametric CAD` (sets `#providerSelect` to `cad`, resubmits) and `Save key and generate` (stores key, resubmits with the pending dispatch). The Advanced "Add key"/"Change" link reuses the same body without the CAD button and with title `Tripo 3D API key`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(create): ask for the Tripo key in a dialog only when a generation needs it`

---

### Task 7: Draft status and the leave guard

**Files:**
- Create: `frontend/src/js/state/draft-status.ts`
- Modify: `frontend/src/js/ui/asset-save.ts` (call markers), `frontend/src/js/ui/asset-chrome.ts:30-36` (`_metaText`), asset open/close paths in `ui/asset-library.ts` (`openAssetEntry`) and `ui/new-menu.ts` (new draft)
- Test: new `test/frontend/draft-status.test.js`, `test/frontend/asset-chrome.test.js`

**Interfaces:**
- Produces: `markDraftSaved(): void`, `markPublished(): void`, `resetDraftStatus(): void`, `hasUnpublishedDraft(): boolean`. Registers itself with `registerPendingSource(hasUnpublishedDraft)` and calls `notifyPendingEditsChanged()` on change.

- [ ] **Step 1: Write the failing tests:**
  - draft-status: `test("saved draft is unpublished until published")`, `test("reset clears it")`, `test("hasUnsavedChanges is true after markDraftSaved")`.
  - asset-chrome: `test("tokenized asset with an unpublished draft shows Draft")` → meta `v3 · Draft`; `test("after publish meta shows Published")` → `v4 · Published`; `test("beforeunload prompts for a saved but unpublished draft")`; `test("opening another asset clears the prompt")` (Review Focus 4).
- [ ] **Step 2: Run** `bun test test/frontend/draft-status.test.js test/frontend/asset-chrome.test.js` → FAIL.
- [ ] **Step 3: Implement.** `_metaText`: status is `Published` only when `tokenId && !hasUnpublishedDraft()`. `markDraftSaved` after a successful `saveDraftAsset` (not on `no-changes`), `markPublished` after a publish outcome other than `empty`/`aborted`, `resetDraftStatus` when an asset opens, closes, or a new draft starts.
- [ ] **Step 4: Run** → PASS; `bun test test/frontend/unsaved-changes.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(studio): track unpublished drafts for status text and the leave prompt`

---

### Task 8: Save draft / Publish copy

**Files:**
- Modify: `frontend/src/pug/includes/header.pug:41-52`
- Modify: `frontend/src/js/ui/asset-save.ts` (labels, titles, progress text, toasts), `frontend/src/js/ui/asset-chrome.ts:26` (`SAVE_LABEL`)
- Modify: `frontend/src/scss/components/_headerbar.scss:286` (comment)
- Test: `test/frontend/asset-save.test.js`, `test/frontend/asset-chrome.test.js`

**Interfaces:** none new.

- [ ] **Step 1: Update/add tests:** label restore tests now expect `Save draft` and `Publish`; `test("draft toast says kept in this tab only")`; `test("publish toast names the new version")` (first publish adds `Asset created on-chain`).
- [ ] **Step 2: Run** `bun test test/frontend/asset-save.test.js test/frontend/asset-chrome.test.js` → FAIL.
- [ ] **Step 3: Implement** with these exact strings:
  - Save button text `Save draft`; title `Kept in this tab only. Publish to share with your team and keep it. (Ctrl+S)`; busy text `Saving…`.
  - Publish button text `Publish` (remove the `besk-star` svg); `aria-label="Publish"`; title `Share this version with your team (creates v<N+1>)`, computed from version history in `asset-chrome.ts`; busy text `Publishing…`; progress `Publishing — preparing asset…`, cancel `Publishing cancelled.`.
  - Success toasts: `Draft saved — kept in this tab only`; `Published v<N> — your team can see it now`, message `Asset created on-chain` on first publish.
  - `SAVE_LABEL = "Save draft"`.
- [ ] **Step 4: Run** → PASS; `bun run build:frontend` succeeds.
- [ ] **Step 5: Commit** `feat(studio): rename Save to Save draft and Besk it to Publish`

---

### Task 9: E2E, skill docs, full gate

**Files:**
- Modify: `e2e/helpers/flows.mjs:229-233` (open `#composerAdvanced` before `selectOption("mock")`), `e2e/helpers/studio-selectors.mjs` (add `assetCardMain`, `assetCardMore`, `assetCardMenuItem`)
- Modify: `e2e/specs/06-nesting.spec.js`, `08-fork-live-ref.spec.js`, `22-live-scene-update.spec.js`, `23-cross-window-live-update.spec.js`, `24-nested-live-update.spec.js` ("Add to Scene" + dialog → card click for live; ⋯ → Insert a copy for fork), `05-republish.spec.js` (comment/text)
- Modify: any spec asserting "Besk it", "Save Draft", old toasts, or Outline as the landing tab
- Modify: `.agents/skills/edit-ui/SKILL.md` (Layout paragraph: Save draft / Publish, rail `Insert`, Create landing tab), `.agents/skills/edit-ui/references/e2e-sync.md` if it lists these labels

- [ ] **Step 1: Update helpers and specs** as listed (Review Focus 5).
- [ ] **Step 2: Run** `bun run test` and `bun run test:frontend` → all PASS.
- [ ] **Step 3: Run** the E2E suite per `e2e/README.md` → all PASS. Record any failure with its output; do not mark done until green.
- [ ] **Step 4: Commit** `test(e2e): follow Insert, Create and Publish UI changes` and `docs(skills): edit-ui reflects Insert, Create landing and Save draft / Publish`
