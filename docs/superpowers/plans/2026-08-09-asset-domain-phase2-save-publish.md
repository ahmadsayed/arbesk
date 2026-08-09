# Asset Domain Model — Phase 2: Save/Publish Commands + CID Privatization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move save/publish into `domain/asset.js` command functions (`saveDraftAsset`, `publishAsset` with collection-publish coordination) and take the CID/tokenId/manifest fields (`activeAssetManifestCid`, `latestAssetManifestCid`, `activeAssetTokenId`, `activeAssetId`, `currentManifest`) private — every `assetState.set` touching them goes behind a named domain function. `manifest-builder.js` stays the serializer; `asset-save.js` keeps only DOM/toast/progress orchestration.

**Architecture:** Big structs + module functions (no classes). `domain/asset.js` remains a facade over `assetState`: readers keep reading `assetState.get()` directly; only *writes* of the five fields are privatized. Domain commands take injected deps (manifest builder, IPFS-adjacent services, wallet) so they unit-test with the existing jsdom harness style. No `domain/collection.js` yet — `publishAsset` calls the existing `collection-publish.js` through an injected dep (the Phase 3 seam).

**Tech Stack:** ESM JS, Jest (jsdom), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-08-09-asset-domain-model-design.md` (Phase 2)

**Scope refinements vs spec (controller-noted):**
- Spec signatures are `saveDraftAsset(asset, wallet, deps)` / `publishAsset(asset, wallet, deps)`. Phase 1 shipped a singleton facade (no `Asset` struct instance), so Phase 2 uses `saveDraftAsset(deps)` and `publishAsset(assetName, wallet, deps)` — same behavior, facade style.
- Collection-context fields (`activeCollectionTokenId`, `selectedCollectionId`) are NOT privatized in Phase 2, but several call sites write them in the same `assetState.set` as privatized fields. Splitting one set into two would double `ASSET_STATE_CHANGED` emissions; instead they ride along as explicit, named parameters of `adoptOpenedAsset` / `adoptPublishedIdentity` — a transitional seam Phase 3 moves to the Collection module.
- `blockchain/wallet-publishing.js` already exports a low-level `publishAsset` (the chain writer behind `editor-publish.js`). Same name, different module — no conflict; alias on import if ever co-imported.
- YAGNI: no `getAssetSnapshot` field additions (`isDraft`, `publishedCid`), no Collection struct, no schema changes, no terminology cleanup (Phase 4).

## Global Constraints

- Big structs + module functions; **no `class`, no inheritance**; `_`-prefix = module-private by convention.
- ESM; camelCase; JSDoc on exported functions; `npm run typecheck:frontend` must pass. `domain/asset.js` is `// @ts-check` — keep it that way (JSDoc `any` for manifest shapes).
- **Behavior preservation is paramount.** Unchanged: all toast copies/titles/types, `announceStatus` strings, `startTaskProgress`/`setTaskProgress`/`finishTaskProgress`/`failTaskProgress` fractions and messages, rate-limit (HTTP 429) handling, button `disabled`/`title`/text toggles, `isSaving`/`isPublishing` re-entry guards, `ASSET_DRAFT_SAVED` / `ASSET_PUBLISHED` emissions and payloads, URL updates (`updateUrlManifest` for non-tokenized drafts, `updateUrlAsset` on publish), `refreshTeamPanel` on new-collection publish, the keyboard shortcut, `ensureExplicitName` dialog flow. The publish "no-changes still anchors the collection" path is a feature — keep it.
- Event-ordering rule: state writes land **before** event emissions, exactly as today. `updateUrlManifest` runs before `ASSET_DRAFT_SAVED`; `updateUrlAsset` before `ASSET_PUBLISHED`.
- Domain functions never import `services/asset-save/*` (deps are injected by the caller) — this keeps `domain/` IO-free and avoids an import cycle with `manifest-builder.js`, which imports the domain for `recordSavedVersion`/`cacheCurrentManifest`.
- **`test/frontend/asset-save.test.js` must keep passing unmodified** through Tasks 4–5 — it is the behavior-preservation proof (its mocks of `manifest-builder.js` / `collection-publish.js` / `editor-publish.js` stay effective because `asset-save.js` keeps importing them and passes them as deps). If a mock needs a newly-read field (e.g. `walletState.get().chainId`), extend the mock, never the production logic.
- Persisted manifest field names are frozen. Internal event names unchanged.
- **Git commits: pre-authorized by the user for this refactor run (per-task commits, repo conventional style).**
- Run from repo root `/home/ahmedh/Projects/arbesk`. Jest needs `NODE_OPTIONS=--experimental-vm-modules npx jest <path>`.

---

### Task 1: Domain CID/identity command functions on the asset facade

**Files:**
- Modify: `frontend/src/js/domain/asset.js`
- Test: `test/frontend/domain-asset-identity.test.js` (new)

**Interfaces:**
- Consumes: existing facade (`assetState`, `tagManifestCid` from `state/asset-state.js`).
- Produces (Tasks 2–5 rely on these exact names):
  - `adoptOpenedAsset(cid, identity = {})` — sets `activeAssetManifestCid` + `latestAssetManifestCid` to `cid`; writes `tokenId`/`assetId`/`collectionTokenId` **only when the key is present** in `identity` (`"tokenId" in identity` semantics, so explicit `null` is written); `clearSelectedCollection: true` writes `selectedCollectionId: null`. One `assetState.set`.
  - `activateAssetManifest(cid, manifest)` — `{activeAssetManifestCid: cid, currentManifest: tagManifestCid(manifest, cid)}` (scene-loader root-load tail; does NOT touch `latest` — version-history-store's SCENE_READY listener owns that).
  - `setActiveManifestCid(cid)` — active only.
  - `setLatestManifestCid(cid)` — latest only.
  - `clearAssetManifestCids()` — active + latest = null.
  - `cacheCurrentManifest(manifest, cid)` — `currentManifest` only.
  - `recordSavedVersion(cid, manifest)` — `{latest, active, currentManifest: tagged}` (the manifest-builder:742 write).
  - `adoptPublishedIdentity(tokenId, assetId)` — `{activeCollectionTokenId: String(tokenId), activeAssetTokenId: String(tokenId), activeAssetId: assetId}`.

- [ ] **Step 1: Write the failing test**

Create `test/frontend/domain-asset-identity.test.js`:

```js
/**
 * @jest-environment jsdom
 *
 * Domain asset identity/CID commands: the only writers of
 * activeAssetManifestCid / latestAssetManifestCid / activeAssetTokenId /
 * activeAssetId / currentManifest.
 */
import { expect, test, beforeEach } from "@jest/globals";
import {
  adoptOpenedAsset,
  activateAssetManifest,
  setActiveManifestCid,
  setLatestManifestCid,
  clearAssetManifestCids,
  cacheCurrentManifest,
  recordSavedVersion,
  adoptPublishedIdentity,
} from "../../frontend/src/js/domain/asset.js";
import { assetState, _resetForTesting } from "../../frontend/src/js/state/asset-state.js";

beforeEach(() => _resetForTesting());

test("adoptOpenedAsset sets active+latest and only the identity keys present", () => {
  assetState.set({ activeAssetTokenId: "9", selectedCollectionId: "3" });
  adoptOpenedAsset("bafyCid");
  let s = assetState.get();
  expect(s.activeAssetManifestCid).toBe("bafyCid");
  expect(s.latestAssetManifestCid).toBe("bafyCid");
  expect(s.activeAssetTokenId).toBe("9"); // untouched
  expect(s.selectedCollectionId).toBe("3"); // untouched

  adoptOpenedAsset("bafyOther", {
    tokenId: "7",
    assetId: "asset_1",
    collectionTokenId: "7",
    clearSelectedCollection: true,
  });
  s = assetState.get();
  expect(s.activeAssetManifestCid).toBe("bafyOther");
  expect(s.latestAssetManifestCid).toBe("bafyOther");
  expect(s.activeAssetTokenId).toBe("7");
  expect(s.activeAssetId).toBe("asset_1");
  expect(s.activeCollectionTokenId).toBe("7");
  expect(s.selectedCollectionId).toBeNull();
});

test("adoptOpenedAsset writes an explicit null tokenId (key present)", () => {
  assetState.set({ activeAssetTokenId: "9" });
  adoptOpenedAsset("bafyX", { tokenId: null });
  expect(assetState.get().activeAssetTokenId).toBeNull();
});

test("activateAssetManifest sets active + tagged currentManifest, not latest", () => {
  assetState.set({ latestAssetManifestCid: "bafyTip" });
  activateAssetManifest("bafyV2", { asset_id: "a1", version: 2 });
  const s = assetState.get();
  expect(s.activeAssetManifestCid).toBe("bafyV2");
  expect(s.latestAssetManifestCid).toBe("bafyTip"); // chain tip survives
  expect(s.currentManifest._manifestCid).toBe("bafyV2");
  expect(s.currentManifest.version).toBe(2);
});

test("setActiveManifestCid / setLatestManifestCid are single-field", () => {
  assetState.set({ activeAssetManifestCid: "a", latestAssetManifestCid: "l" });
  setActiveManifestCid("a2");
  expect(assetState.get().activeAssetManifestCid).toBe("a2");
  expect(assetState.get().latestAssetManifestCid).toBe("l");
  setLatestManifestCid(null);
  expect(assetState.get().latestAssetManifestCid).toBeNull();
  expect(assetState.get().activeAssetManifestCid).toBe("a2");
});

test("clearAssetManifestCids nulls active + latest only", () => {
  assetState.set({
    activeAssetManifestCid: "a",
    latestAssetManifestCid: "l",
    activeAssetTokenId: "7",
  });
  clearAssetManifestCids();
  const s = assetState.get();
  expect(s.activeAssetManifestCid).toBeNull();
  expect(s.latestAssetManifestCid).toBeNull();
  expect(s.activeAssetTokenId).toBe("7");
});

test("cacheCurrentManifest tags and stores only currentManifest", () => {
  assetState.set({ activeAssetManifestCid: "bafyA" });
  cacheCurrentManifest({ asset_id: "a1" }, "bafyA");
  const s = assetState.get();
  expect(s.currentManifest._manifestCid).toBe("bafyA");
  expect(s.activeAssetManifestCid).toBe("bafyA");
});

test("recordSavedVersion points active+latest at the new CID with tagged manifest", () => {
  recordSavedVersion("bafyNew", { asset_id: "a1", version: 3 });
  const s = assetState.get();
  expect(s.latestAssetManifestCid).toBe("bafyNew");
  expect(s.activeAssetManifestCid).toBe("bafyNew");
  expect(s.currentManifest._manifestCid).toBe("bafyNew");
});

test("adoptPublishedIdentity stringifies tokenId and keeps assetId verbatim", () => {
  adoptPublishedIdentity(42, "asset_9");
  const s = assetState.get();
  expect(s.activeAssetTokenId).toBe("42");
  expect(s.activeCollectionTokenId).toBe("42");
  expect(s.activeAssetId).toBe("asset_9");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-asset-identity.test.js`
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement**

In `frontend/src/js/domain/asset.js`: add `tagManifestCid` to the asset-state import, then append (also update the module docstring: "ONLY writer of the asset name" → "ONLY writer of the asset name and the CID/tokenId/currentManifest identity fields"):

```js
// ─── Identity / CID commands (Phase 2) ─────────────────────────────
// The ONLY writers of activeAssetManifestCid, latestAssetManifestCid,
// activeAssetTokenId, activeAssetId, currentManifest. Collection-context
// fields (activeCollectionTokenId, selectedCollectionId) ride along here
// as a transitional seam — Phase 3 moves them to the Collection module.

/**
 * Adopt a freshly opened/loaded asset: active + latest CIDs point at `cid`.
 * Identity keys are written only when present (`in` semantics), so callers
 * reproduce their exact legacy patches — pass `tokenId: null` explicitly to
 * clear. `clearSelectedCollection: true` writes `selectedCollectionId: null`.
 * @param {string} cid
 * @param {{tokenId?: string|null, assetId?: string|null, collectionTokenId?: string|null, clearSelectedCollection?: boolean}} [identity]
 */
export function adoptOpenedAsset(cid, identity = {}) {
  /** @type {Record<string, any>} */
  const patch = {
    activeAssetManifestCid: cid,
    latestAssetManifestCid: cid,
  };
  if ("tokenId" in identity) patch.activeAssetTokenId = identity.tokenId;
  if ("assetId" in identity) patch.activeAssetId = identity.assetId;
  if ("collectionTokenId" in identity)
    patch.activeCollectionTokenId = identity.collectionTokenId;
  if (identity.clearSelectedCollection) patch.selectedCollectionId = null;
  assetState.set(patch);
}

/**
 * Root-load tail (scene-loader): the loaded manifest becomes active and is
 * cached as currentManifest. Does NOT touch latestAssetManifestCid — the
 * version-history store's SCENE_READY listener owns the chain tip.
 * @param {string} cid
 * @param {any} manifest
 */
export function activateAssetManifest(cid, manifest) {
  assetState.set({
    activeAssetManifestCid: cid,
    currentManifest: tagManifestCid(manifest, cid),
  });
}

/** @param {string|null} cid */
export function setActiveManifestCid(cid) {
  assetState.set({ activeAssetManifestCid: cid });
}

/** @param {string|null} cid */
export function setLatestManifestCid(cid) {
  assetState.set({ latestAssetManifestCid: cid });
}

/**
 * Scene cleared: both CIDs go. Token identity and currentManifest survive
 * (clearScene semantics — preserved verbatim from engine/cleanup.js).
 */
export function clearAssetManifestCids() {
  assetState.set({
    activeAssetManifestCid: null,
    latestAssetManifestCid: null,
  });
}

/**
 * Cache a fetched manifest against its CID without changing active/latest
 * (outliner cache fill, no-changes save path).
 * @param {any} manifest
 * @param {string|null} cid
 */
export function cacheCurrentManifest(manifest, cid) {
  assetState.set({ currentManifest: tagManifestCid(manifest, cid) });
}

/**
 * A new version was written to IPFS: it becomes the active + latest tip and
 * the cached current manifest.
 * @param {string} cid
 * @param {any} manifest
 */
export function recordSavedVersion(cid, manifest) {
  assetState.set({
    latestAssetManifestCid: cid,
    activeAssetManifestCid: cid,
    currentManifest: tagManifestCid(manifest, cid),
  });
}

/**
 * Publish succeeded: the collection token is now the asset's on-chain
 * identity.
 * @param {string|number} tokenId
 * @param {string} assetId
 */
export function adoptPublishedIdentity(tokenId, assetId) {
  assetState.set({
    activeCollectionTokenId: String(tokenId),
    activeAssetTokenId: String(tokenId),
    activeAssetId: assetId,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-asset-identity.test.js test/frontend/domain-asset.test.js`
Expected: PASS (8 + 6 tests). Also `npm run typecheck:frontend` — clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/domain/asset.js test/frontend/domain-asset-identity.test.js
git commit -m "feat(domain): CID/identity command functions on the asset facade"
```

---

### Task 2: Rewire engine/state writers + manifest-builder

**Files:**
- Modify: `frontend/src/js/engine/scene-loader.js:~389-395`
- Modify: `frontend/src/js/engine/cleanup.js:~98, ~199-202`
- Modify: `frontend/src/js/engine/scene-graph.js:~803-809, ~818-821`
- Modify: `frontend/src/js/state/version-history-store.js:~89, ~159`
- Modify: `frontend/src/js/services/asset-save/manifest-builder.js:~705-710, ~742-746`
- Test: existing suites (no new tests — rewires only)

**Interfaces:**
- Consumes: Task 1 commands.
- Produces: no `assetState.set` touching the five privatized fields remains in these files.

**Exact rewires (one-for-one; imports from `../domain/asset.js` / `../../domain/asset.js` as path dictates):**
- `scene-loader.js:390-393` → `activateAssetManifest(manifestCid, manifest);` (keep the `emit(EVENTS.SCENE_READY, …)` line after it).
- `cleanup.js:98` → `setActiveManifestCid(null);`
- `cleanup.js:199-202` → `clearAssetManifestCids();`
- `scene-graph.js:803-809` (loadFromParams token path) → `adoptOpenedAsset(cid, { tokenId: String(assetTokenId), collectionTokenId: String(assetTokenId), clearSelectedCollection: true });`
- `scene-graph.js:818-821` (manifest path) → `adoptOpenedAsset(manifestCid);`
- `version-history-store.js:89` → `setLatestManifestCid(preservedLatest);`
- `version-history-store.js:159` → `setLatestManifestCid(manifestCid);`
- `manifest-builder.js:705-710` (no-changes path) → `cacheCurrentManifest(prepared.manifest, assetState.get().activeAssetManifestCid);`
- `manifest-builder.js:742-746` → `recordSavedVersion(cid, prepared.manifest);`
  - Add `import { cacheCurrentManifest, recordSavedVersion } from "../../domain/asset.js";` and drop `tagManifestCid` from the asset-state import if unused after (keep `assetState` — the reads stay).
  - No import cycle: `domain/asset.js` never imports `services/asset-save/*` (Global Constraints).

- [ ] **Step 1: Apply the rewires above.**
- [ ] **Step 2: Verify no stragglers**

Run: `grep -n "assetState.set(" frontend/src/js/engine frontend/src/js/state frontend/src/js/services`
Expected: no match touches the five privatized fields (collection-only sets like `selectedCollectionId` are fine).

- [ ] **Step 3: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/manifest-builder.test.js test/frontend/domain-asset-identity.test.js` then `npm test`
Expected: all green. Then `npm run lint && npm run typecheck:frontend`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/engine/scene-loader.js frontend/src/js/engine/cleanup.js frontend/src/js/engine/scene-graph.js frontend/src/js/state/version-history-store.js frontend/src/js/services/asset-save/manifest-builder.js
git commit -m "refactor(domain): route engine/state CID writes through asset commands"
```

---

### Task 3: Rewire UI writers

**Files:**
- Modify: `frontend/src/js/ui/nesting.js:~104-108, ~137-141`
- Modify: `frontend/src/js/ui/create-panel.js:~533-536, ~558, ~1778, ~1780`
- Modify: `frontend/src/js/ui/asset-library.js:~319-326, ~328-333, ~414-421, ~442-448`
- Modify: `frontend/src/js/ui/outliner.js:~131`
- Test: existing suites (no new tests — rewires only)

**Exact rewires:**
- `nesting.js` dive → `adoptOpenedAsset(manifest.cid, { tokenId: refTokenId });` (keep the `renameAsset(...)` line).
- `nesting.js` ascend → `adoptOpenedAsset(prev.cid, { tokenId: prev.tokenId });` (keep `renameAsset(prev.assetName)`).
- `create-panel.js:533-536` → `adoptOpenedAsset(record.assetManifestCid);`
- `create-panel.js:558` → `setLatestManifestCid(previousLatestCid);`
- `create-panel.js:1778` → `setActiveManifestCid(cid);`
- `create-panel.js:1780` → `setLatestManifestCid(previousLatestCid);`
- `asset-library.js:319-326` → `adoptOpenedAsset(entry.manifestCid, { tokenId: String(entry.tokenId), collectionTokenId: String(entry.tokenId), clearSelectedCollection: true, assetId: entry.assetId });`
- `asset-library.js:328-333` → `adoptOpenedAsset(entry.manifestCid, { tokenId: String(entry.tokenId), clearSelectedCollection: true });`
- `asset-library.js:414-421` → `adoptOpenedAsset(targetAssetCid, { tokenId: String(tokenId), collectionTokenId: String(tokenId), clearSelectedCollection: true, assetId: hasExplicitAssetId ? assetId : null });`
- `asset-library.js:442-448` → `adoptOpenedAsset(cid, { tokenId: String(tokenId), clearSelectedCollection: true, assetId });`
- `outliner.js:131` → `cacheCurrentManifest(manifest, cid);`
- NOT touched: `asset-library.js:381-384, 465-468` and `create-panel.js:424-430` (collection-context only — Phase 3).

- [ ] **Step 1: Apply the rewires above.**
- [ ] **Step 2: Verify no stragglers**

Run: `grep -n "assetState.set(" frontend/src/js/ui frontend/src/js/services`
Expected: only `domain/asset.js` writes the five privatized fields repo-wide; remaining UI sets touch collection-context fields only.

- [ ] **Step 3: Run tests**

Run: `npm test && npm run lint && npm run typecheck:frontend`
Expected: all green (watch `asset-library` / `create-panel` / `outliner` suites).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/ui/nesting.js frontend/src/js/ui/create-panel.js frontend/src/js/ui/asset-library.js frontend/src/js/ui/outliner.js
git commit -m "refactor(domain): route UI CID writes through asset commands"
```

---

### Task 4: `saveDraftAsset` domain command — save path leaves `asset-save.js`

**Files:**
- Modify: `frontend/src/js/domain/asset.js`
- Modify: `frontend/src/js/ui/asset-save.js` (save path slims to chrome orchestration)
- Test: `test/frontend/domain-asset-save.test.js` (new); `test/frontend/asset-save.test.js` must pass **unmodified**

**Interfaces:**
- Consumes: Task 1 commands; existing `asset-save.test.js` mock surface.
- Produces:
  - `saveDraftAsset(deps) → Promise<SaveResult>` where `deps = { saveDraft(assetName), fetchTokenName(tokenId), updateUrlManifest(cid) }` and `SaveResult` is the verbatim `saveAssetDraftCore` result. Name-resolution rule (verbatim from `asset-save.js:95-106`): in-session `activeAssetName` wins; else if tokenized, `fetchTokenName(tokenId) || "My Asset"`; else `"My Asset"`. On `ok`: non-tokenized drafts call `updateUrlManifest(cid)`, then emit `ASSET_DRAFT_SAVED {cid}` — in that order. On `!ok`: return the result untouched (no URL write, no event). Errors propagate (the UI owns toasts).

- [ ] **Step 1: Write the failing test**

Create `test/frontend/domain-asset-save.test.js`:

```js
/**
 * @jest-environment jsdom
 *
 * saveDraftAsset: name resolution, URL update ordering, ASSET_DRAFT_SAVED
 * emission. IO deps injected; real assetState + real event bus.
 */
import { jest, expect, test, beforeEach } from "@jest/globals";
import { saveDraftAsset } from "../../frontend/src/js/domain/asset.js";
import { assetState, _resetForTesting } from "../../frontend/src/js/state/asset-state.js";
import { on, EVENTS } from "../../frontend/src/js/events/bus.js";

function makeDeps(over = {}) {
  return {
    saveDraft: jest.fn().mockResolvedValue({ ok: true, cid: "bafyNew", manifest: { asset_id: "a1" } }),
    fetchTokenName: jest.fn().mockResolvedValue("On-Chain Name"),
    updateUrlManifest: jest.fn(),
    ...over,
  };
}

beforeEach(() => _resetForTesting());

test("in-session name wins; save runs; URL updated and event emitted for drafts", async () => {
  assetState.set({ activeAssetName: "Session Name" });
  const deps = makeDeps();
  const seen = [];
  const unsub = on(EVENTS.ASSET_DRAFT_SAVED, (e) => seen.push(e.cid));

  const result = await saveDraftAsset(deps);

  expect(deps.saveDraft).toHaveBeenCalledWith("Session Name");
  expect(deps.fetchTokenName).not.toHaveBeenCalled();
  expect(deps.updateUrlManifest).toHaveBeenCalledWith("bafyNew");
  expect(seen).toEqual(["bafyNew"]);
  expect(result.ok).toBe(true);
  unsub();
});

test("tokenized asset: name from chain, no URL manifest update", async () => {
  assetState.set({ activeAssetTokenId: "7" });
  const deps = makeDeps();
  await saveDraftAsset(deps);
  expect(deps.fetchTokenName).toHaveBeenCalledWith("7");
  expect(deps.saveDraft).toHaveBeenCalledWith("On-Chain Name");
  expect(deps.updateUrlManifest).not.toHaveBeenCalled();
});

test("falls back to My Asset when no name anywhere", async () => {
  const deps = makeDeps({ fetchTokenName: jest.fn().mockResolvedValue(null) });
  assetState.set({ activeAssetTokenId: "7" });
  await saveDraftAsset(deps);
  expect(deps.saveDraft).toHaveBeenCalledWith("My Asset");

  _resetForTesting();
  await saveDraftAsset(deps);
  expect(deps.saveDraft).toHaveBeenLastCalledWith("My Asset");
});

test("not-ok results pass through with no URL write and no event", async () => {
  const deps = makeDeps({
    saveDraft: jest.fn().mockResolvedValue({ ok: false, reason: "no-changes", cid: "bafyOld" }),
  });
  const seen = [];
  const unsub = on(EVENTS.ASSET_DRAFT_SAVED, (e) => seen.push(e));
  const result = await saveDraftAsset(deps);
  expect(result).toEqual({ ok: false, reason: "no-changes", cid: "bafyOld" });
  expect(deps.updateUrlManifest).not.toHaveBeenCalled();
  expect(seen).toEqual([]);
  unsub();
});

test("save failures propagate (the UI owns the toast)", async () => {
  const deps = makeDeps({ saveDraft: jest.fn().mockRejectedValue(new Error("HTTP 429")) });
  await expect(saveDraftAsset(deps)).rejects.toThrow("HTTP 429");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-asset-save.test.js`
Expected: FAIL — `saveDraftAsset` not exported.

- [ ] **Step 3: Implement the domain command**

Append to `frontend/src/js/domain/asset.js` (add `emit` to the bus import):

```js
// ─── Save/publish commands (Phase 2) ───────────────────────────────
// IO stays in injected deps so the domain module never imports
// services/asset-save/* (which imports this module for the state commands).

/**
 * Name resolution for saves (verbatim from ui/asset-save.js): the in-session
 * rename wins; a tokenized asset falls back to its on-chain name; drafts fall
 * back to "My Asset".
 * @param {(tokenId: string) => Promise<string|null>} fetchTokenName
 * @returns {Promise<string>}
 */
async function _resolveAssetName(fetchTokenName) {
  const current = assetState.get().activeAssetName;
  if (current) return current;
  const tokenId = assetState.get().activeAssetTokenId;
  if (tokenId) return (await fetchTokenName(tokenId)) || "My Asset";
  return "My Asset";
}

/**
 * Save the current draft. Builds and uploads the manifest via the injected
 * serializer, updates the URL for non-tokenized drafts, and emits
 * ASSET_DRAFT_SAVED. Returns the serializer's result verbatim; failures
 * propagate to the caller (the UI owns toasts/progress).
 * @param {{saveDraft: (assetName: string, options?: any) => Promise<any>,
 *          fetchTokenName: (tokenId: string) => Promise<string|null>,
 *          updateUrlManifest: (cid: string) => void}} deps
 * @returns {Promise<any>}
 */
export async function saveDraftAsset(deps) {
  const assetName = await _resolveAssetName(deps.fetchTokenName);
  const result = await deps.saveDraft(assetName);
  if (!result.ok) return result;

  // Only rewrite the URL for non-tokenized drafts. For tokenized assets, the
  // ?asset=<tokenId> URL already anchors to the blockchain; avoid stashing a
  // draft manifest in query params.
  if (!assetState.get().activeAssetTokenId) {
    deps.updateUrlManifest(result.cid);
  }
  emit(EVENTS.ASSET_DRAFT_SAVED, { cid: result.cid });
  return result;
}
```

- [ ] **Step 4: Slim `asset-save.js`**

Surgical move — behavior verbatim:
- Delete `fetchAssetName` (`:91-93`) and `resolveAssetName` (`:95-106`).
- In `onSaveAssetDraft`, replace `const assetName = await resolveAssetName(); const result = await saveAssetDraftCore(assetName);` with:

```js
const result = await saveDraftAsset({
  saveDraft: saveAssetDraftCore,
  fetchTokenName: getAssetName,
  updateUrlManifest,
});
```

- Delete the now-inlined block after the `!result.ok` branch: the `const { cid } = result;`, the `if (!assetState.get().activeAssetTokenId) { updateUrlManifest(cid); }`, and `emit(EVENTS.ASSET_DRAFT_SAVED, { cid });` lines. Keep `announceStatus("Draft saved."); finishTaskProgress("Draft saved."); return result;` (they ran after the emit before; they still do).
- Add `saveDraftAsset` to the domain import; drop the `updateUrlManifest` import only if unused (it IS still used — passed as a dep). Everything else in `onSaveAssetDraft` (guards, buttons, progress, empty/no-changes toasts, catch/finally) stays byte-identical.

- [ ] **Step 5: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-asset-save.test.js test/frontend/asset-save.test.js`
Expected: PASS — `asset-save.test.js` unmodified. Then `npm test`, `npm run lint`, `npm run typecheck:frontend`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/domain/asset.js frontend/src/js/ui/asset-save.js test/frontend/domain-asset-save.test.js
git commit -m "feat(domain): saveDraftAsset command — save path leaves asset-save.js"
```

---

### Task 5: `publishAsset` domain command + collection coordination

**Files:**
- Modify: `frontend/src/js/domain/asset.js`
- Modify: `frontend/src/js/ui/asset-save.js` (publish path slims)
- Test: `test/frontend/domain-asset-publish.test.js` (new); `test/frontend/asset-save.test.js` must pass **unmodified**

**Interfaces:**
- Consumes: Tasks 1 + 4 (`adoptPublishedIdentity`; `_resolveAssetName` not reused — publish takes its name from `ensureExplicitName` in the UI).
- Produces:
  - `publishAsset(assetName, wallet, deps) → Promise<PublishOutcome>`
    - `wallet = { address, chainId, contractAddress }` (caller identity, passed in per spec boundary rule).
    - `deps = { verifyCanEdit(tokenId, address), saveDraft(assetName, options), publishCollection(assetCid, assetID, address), updateUrlAsset(tokenId), onNewCollection?(), onStatus(message), onProgress(fraction, message) }`.
    - `PublishOutcome = { outcome: "empty" } | { outcome: "aborted", reason } | { outcome: "published", tokenId: string, cid, isNew }`.
    - Absorbs, verbatim and in this order: `verifyCanEdit` fail-fast on republish → `publishContext` build → progress 0.3 → save with `{captureThumbnail: true, publishContext}` → empty/no-changes outcome mapping (no-changes still anchors) → `assetID` derivation + `[PUBLISH]` log → status "Confirm transaction in MetaMask…" + progress 0.6 → `publishCollection` (the `collection-publish.js` orchestration, injected) → progress 0.9 → `adoptPublishedIdentity` → `updateUrlAsset` → `onNewCollection` when `isNew` → `ASSET_PUBLISHED {tokenId: String(tokenId), cid}` → return.
  - Note the one deliberate intermediate-state change: today `activeAssetId` is set **before** `publishCollectionForAsset` (`asset-save.js:308`); the command sets it after, inside `adoptPublishedIdentity`. Verified unobservable — nothing reads `activeAssetId` between those points (the publish dep takes `assetID` as an argument; chrome doesn't render it).

- [ ] **Step 1: Write the failing test**

Create `test/frontend/domain-asset-publish.test.js`:

```js
/**
 * @jest-environment jsdom
 *
 * publishAsset: republish auth fail-fast, publishContext, no-changes still
 * anchors, assetID derivation, identity adoption, ASSET_PUBLISHED emission,
 * progress/status hook sequencing. IO deps injected; real assetState + bus.
 */
import { jest, expect, test, beforeEach } from "@jest/globals";
import { publishAsset } from "../../frontend/src/js/domain/asset.js";
import { assetState, _resetForTesting } from "../../frontend/src/js/state/asset-state.js";
import { on, EVENTS } from "../../frontend/src/js/events/bus.js";

const WALLET = { address: "0xOwner", chainId: 31337, contractAddress: "0xC" };

function makeDeps(over = {}) {
  return {
    verifyCanEdit: jest.fn().mockResolvedValue(undefined),
    saveDraft: jest.fn().mockResolvedValue({
      ok: true,
      cid: "bafyAsset",
      manifest: { asset_id: "asset_1" },
    }),
    publishCollection: jest.fn().mockResolvedValue({ tokenId: "123", isNew: false }),
    updateUrlAsset: jest.fn(),
    onNewCollection: jest.fn(),
    onStatus: jest.fn(),
    onProgress: jest.fn(),
    ...over,
  };
}

beforeEach(() => _resetForTesting());

test("first publish: no verifyCanEdit, identity adopted, event emitted", async () => {
  const deps = makeDeps({ publishCollection: jest.fn().mockResolvedValue({ tokenId: "123", isNew: true }) });
  const seen = [];
  const unsub = on(EVENTS.ASSET_PUBLISHED, (e) => seen.push(e));

  const out = await publishAsset("My Hat", WALLET, deps);

  expect(deps.verifyCanEdit).not.toHaveBeenCalled();
  expect(deps.saveDraft).toHaveBeenCalledWith("My Hat", {
    captureThumbnail: true,
    publishContext: null,
  });
  expect(deps.publishCollection).toHaveBeenCalledWith("bafyAsset", "asset_1", "0xOwner");
  expect(deps.updateUrlAsset).toHaveBeenCalledWith("123");
  expect(deps.onNewCollection).toHaveBeenCalled();
  expect(seen).toEqual([{ tokenId: "123", cid: "bafyAsset" }]);
  expect(out).toEqual({ outcome: "published", tokenId: "123", cid: "bafyAsset", isNew: true });
  const s = assetState.get();
  expect(s.activeAssetTokenId).toBe("123");
  expect(s.activeCollectionTokenId).toBe("123");
  expect(s.activeAssetId).toBe("asset_1");
  unsub();
});

test("republish: verifyCanEdit fail-fast with publishContext", async () => {
  assetState.set({ activeAssetTokenId: "55", activeAssetId: "asset_9" });
  const deps = makeDeps();
  const out = await publishAsset("Hat", WALLET, deps);
  expect(deps.verifyCanEdit).toHaveBeenCalledWith("55", "0xOwner");
  expect(deps.saveDraft).toHaveBeenCalledWith("Hat", {
    captureThumbnail: true,
    publishContext: { tokenId: "55", chainId: 31337, contractAddress: "0xC" },
  });
  // Existing assetId reused, not re-derived from the manifest.
  expect(deps.publishCollection).toHaveBeenCalledWith("bafyAsset", "asset_9", "0xOwner");
  expect(deps.onNewCollection).not.toHaveBeenCalled(); // isNew: false
  expect(out.outcome).toBe("published");
});

test("no-changes save still anchors the collection", async () => {
  const deps = makeDeps({
    saveDraft: jest.fn().mockResolvedValue({
      ok: false, reason: "no-changes", cid: "bafyExisting", manifest: { asset_id: "asset_1" },
    }),
  });
  const out = await publishAsset("Hat", WALLET, deps);
  expect(deps.publishCollection).toHaveBeenCalledWith("bafyExisting", "asset_1", "0xOwner");
  expect(out.outcome).toBe("published");
});

test("empty save aborts before any chain work", async () => {
  const deps = makeDeps({
    saveDraft: jest.fn().mockResolvedValue({ ok: false, reason: "empty" }),
  });
  const out = await publishAsset("Hat", WALLET, deps);
  expect(out).toEqual({ outcome: "empty" });
  expect(deps.publishCollection).not.toHaveBeenCalled();
  expect(deps.updateUrlAsset).not.toHaveBeenCalled();
});

test("progress/status hooks fire in the legacy order", async () => {
  const calls = [];
  const deps = makeDeps({
    onStatus: jest.fn((m) => calls.push(["status", m])),
    onProgress: jest.fn((f, m) => calls.push(["progress", f])),
  });
  await publishAsset("Hat", WALLET, deps);
  expect(calls).toEqual([
    ["progress", 0.3],
    ["status", "Confirm transaction in MetaMask…"],
    ["progress", 0.6],
    ["progress", 0.9],
  ]);
});

test("failures propagate (rate-limit handling stays in the UI)", async () => {
  const deps = makeDeps({
    publishCollection: jest.fn().mockRejectedValue(new Error("HTTP 429")),
  });
  await expect(publishAsset("Hat", WALLET, deps)).rejects.toThrow("HTTP 429");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-asset-publish.test.js`
Expected: FAIL — `publishAsset` not exported.

- [ ] **Step 3: Implement the domain command**

Append to `frontend/src/js/domain/asset.js` (new imports: `deriveDefaultAssetId` from `../utils/collections.js`, `log` from `../utils/log.js` — verify the exact module paths/exports of these two in the existing `asset-save.js` imports first and use those):

```js
/**
 * Publish the active asset: save a new version, then anchor it in the
 * collection directory on-chain. All IO is injected; the UI owns dialogs,
 * toasts, and button state. Progress/status hooks fire at the exact legacy
 * points. Collection coordination goes through the injected
 * `publishCollection` dep (services/asset-save/collection-publish.js today;
 * the Collection module in Phase 3).
 * @param {string} assetName - already explicit (UI ran ensureExplicitName)
 * @param {{address: string, chainId: number, contractAddress: string}} wallet
 * @param {{verifyCanEdit: Function, saveDraft: Function,
 *          publishCollection: Function, updateUrlAsset: Function,
 *          onNewCollection?: Function, onStatus: Function,
 *          onProgress: Function}} deps
 * @returns {Promise<{outcome: string, tokenId?: string, cid?: string,
 *          isNew?: boolean, reason?: string}>}
 */
export async function publishAsset(assetName, wallet, deps) {
  // Republishes (existing tokenId) snapshot the live comment thread into the
  // manifest via publishContext. First-time publishes have no prior comments.
  const existingTokenId = assetState.get().activeAssetTokenId;

  // Fail fast on unauthorized republish attempts so the user gets immediate
  // feedback instead of paying for gas on a transaction that will revert.
  if (existingTokenId) {
    await deps.verifyCanEdit(existingTokenId, wallet.address);
  }

  const publishContext = existingTokenId
    ? {
        tokenId: existingTokenId,
        chainId: wallet.chainId,
        contractAddress: wallet.contractAddress,
      }
    : null;

  // Save first: every Besk creates a new draft version, then publishes it.
  deps.onProgress(0.3, "Besking — saving new version to IPFS…");
  const result = await deps.saveDraft(assetName, {
    captureThumbnail: true,
    publishContext,
  });

  if (!result.ok) {
    if (result.reason === "empty") return { outcome: "empty" };
    // A publish request should always anchor the current asset to the
    // collection, even when the asset manifest itself has not changed
    // semantically (e.g. the user already saved the color edit as a draft).
    // The collection manifest still gets a version bump + new prev link.
    if (result.reason !== "no-changes")
      return { outcome: "aborted", reason: result.reason };
  }

  const { cid: assetCid, manifest: publishedManifest } = result;

  // Use the manifest's own asset_id as the collection key for new assets;
  // it is generated from Date.now() at creation time and is unique per draft.
  // For updates to an existing asset, activeAssetId is already set and reused.
  const assetID = deriveDefaultAssetId(
    assetState.get().activeAssetId,
    publishedManifest?.asset_id || `asset_${Date.now()}`
  );
  log(
    `[PUBLISH] assetID derived | activeAssetId=${
      assetState.get().activeAssetId
    } manifestAssetId=${publishedManifest?.asset_id} chosen=${assetID}`
  );

  deps.onStatus("Confirm transaction in MetaMask…");
  deps.onProgress(0.6, "Besking — confirm the transaction in your wallet…");

  const { tokenId, isNew } = await deps.publishCollection(
    assetCid,
    assetID,
    wallet.address
  );

  deps.onProgress(0.9, "Besking — finalizing…");
  adoptPublishedIdentity(tokenId, assetID);
  deps.updateUrlAsset(tokenId);

  if (isNew) {
    await deps.onNewCollection?.();
  }

  emit(EVENTS.ASSET_PUBLISHED, {
    tokenId: assetState.get().activeAssetTokenId,
    cid: assetCid,
  });
  return { outcome: "published", tokenId: String(tokenId), cid: assetCid, isNew };
}
```

- [ ] **Step 4: Slim `asset-save.js`**

Surgical move — behavior verbatim. In `onPublishAsset`, keep unchanged: the `isPublishing`/`requireWallet` guards, button disable/title/text, the initial `announceStatus` (republish vs publish), `startTaskProgress(..., 0.1)`, `ensureExplicitName` + its cancel path, the catch (rate-limit toasts), and the finally. Replace the body between the cancel path and the catch with:

```js
const chainId = walletState.get().chainId;
const outcome = await publishAsset(
  assetName,
  {
    address: walletState.get().walletAddress,
    chainId,
    contractAddress: getContractAddress(chainId),
  },
  {
    verifyCanEdit,
    saveDraft: saveAssetDraftCore,
    publishCollection: publishCollectionForAsset,
    updateUrlAsset,
    onNewCollection: async () => {
      const { refreshTeamPanel } = await import("./collaborators.js");
      refreshTeamPanel();
    },
    onStatus: announceStatus,
    onProgress: setTaskProgress,
  }
);

if (outcome.outcome === "empty") {
  announceStatus("No asset data to publish.");
  finishTaskProgress("Nothing to publish.");
  showToast({
    type: "warning",
    title: "Nothing to Publish",
    message: "Generate an asset or add linked worlds first.",
  });
  return;
}
if (outcome.outcome === "aborted") return;

announceStatus(
  outcome.isNew
    ? "Default collection published and minted."
    : "Collection republished successfully."
);
finishTaskProgress(
  outcome.isNew ? "Published — collection minted on-chain." : "Republished."
);
```

- Add `publishAsset` to the domain import. Keep the `publishCollectionForAsset`, `verifyCanEdit`, `getContractAddress` imports (now passed as deps). Delete the moved `deriveDefaultAssetId` import if unused. Keep `export { onSaveAssetDraft, onPublishAsset }` — `create-panel.js:580` calls `onSaveAssetDraft`.
- Reviewed ordering nuance (document in commit message): `announceStatus`/`finishTaskProgress` for the success path now run after `refreshTeamPanel`/`ASSET_PUBLISHED` instead of before. Safe: state is written before the emit (all `ASSET_PUBLISHED` listeners re-read state or refresh idempotently — `version-history-store._refresh`, `comments-panel`, `ledger-panel`, `asset-library.handlePublishUpdate`; `collaborators.js` refreshes the team panel on the event anyway).

- [ ] **Step 5: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-asset-publish.test.js test/frontend/asset-save.test.js`
Expected: PASS — `asset-save.test.js` unmodified (extend its mocks only if a newly-read field like `chainId` breaks an assertion; never change production logic to fit the mock). Then `npm test && npm run lint && npm run typecheck:frontend`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/domain/asset.js frontend/src/js/ui/asset-save.js test/frontend/domain-asset-publish.test.js
git commit -m "feat(domain): publishAsset command with collection coordination

Publish orchestration (verifyCanEdit, versioned save, assetID derivation,
collection anchor, identity adoption, ASSET_PUBLISHED) moves into
domain/asset.js behind injected deps. asset-save.js keeps dialog/toast/
progress/button orchestration only."
```

---

### Task 6: Verification

**Files:** none (verification only).

- [ ] **Step 1: Unit + static**

Run: `npm test && npm run lint && npm run typecheck:frontend && npm run build:frontend`
Expected: all green.

- [ ] **Step 2: Final privatization audit**

Run: `grep -rn "assetState.set(" frontend/src | grep -E "activeAssetManifestCid|latestAssetManifestCid|activeAssetTokenId|activeAssetId|currentManifest"`
Expected: only `frontend/src/js/domain/asset.js` matches.

- [ ] **Step 3: E2E regression set**

`./scripts/start-dev.sh --setup-only` if the stack is down, then:

Run: `npm run test:e2e -- --project=chromium e2e/specs/03-save-and-publish.spec.js e2e/specs/04-parametric-version.spec.js e2e/specs/05-republish.spec.js e2e/specs/06-nesting.spec.js e2e/specs/11-library-studio-roundtrip.spec.js e2e/specs/20-new-asset-name.spec.js`
Expected: all pass. 03/05 cover save/publish/republish incl. `ensureExplicitName`; 04 covers the append-to-latest invariant; 06 covers the nesting rewires; 11 covers library open/close identity rewires; 20 guards the name facade.

- [ ] **Step 4: Manual smoke (optional)**

`./scripts/start-dev.sh`: generate → Save draft (URL gets `?manifest=`) → publish (URL switches to `?asset=`) → republish after a color edit (no-changes anchor path) → dive/ascend a child asset → history scrub → restore a chat version.

---

## Self-Review Notes

- Spec coverage: Phase 2 items all mapped — CID privatization (Tasks 1–3), `saveDraftAsset` (Task 4), `publishAsset` + collection coordination via the existing `collection-publish.js` seam (Task 5), `manifest-builder.js` untouched as serializer except its two state writes now routed through domain commands (Task 2). Verification Task 6 runs exactly the specs the controller listed.
- Type consistency: command names/signatures identical between Task 1's Interfaces/test/implementation and the Task 2–3 rewire tables; `saveDraftAsset`/`publishAsset` identical between Tasks 4–5 Interfaces, tests, and implementations.
- Behavior-parity traps handled explicitly: `"tokenId" in identity` presence semantics in `adoptOpenedAsset` (explicit nulls written, absent keys untouched — reproduces each legacy patch exactly); `String(tokenId)` coercions preserved; `activateAssetManifest` deliberately does NOT touch `latest` (version-history store owns the tip on SCENE_READY); the no-changes-still-anchors publish path preserved including the dead-but-kept `reason !== "no-changes"` abort branch; progress fractions/messages and hook order pinned by a test; state-before-emit ordering preserved everywhere.
- Known deviations (documented, reviewed safe): the mid-flow `activeAssetId` write moves post-publish inside `adoptPublishedIdentity` (no reader between the old and new points); publish success-path `announceStatus`/`finishTaskProgress` move after `refreshTeamPanel` + `ASSET_PUBLISHED` (all listeners idempotent; state already written).
- Cycle safety: `manifest-builder.js` → `domain/asset.js` import is acyclic because the domain never imports `services/asset-save/*` (deps injected); pinned as a Global Constraint.
- `test/frontend/asset-save.test.js` unmodified is the regression proof for Tasks 4–5; E2E specs 03/04/05/06/11/20 are the integration proof.
