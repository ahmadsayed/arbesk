# Remove `state/asset-state.js` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate `frontend/src/js/state/asset-state.js` by moving the shared store into the domain layer and migrating every consumer to domain getters/commands.

**Architecture:** The legacy `assetState` store is currently owned by `state/asset-state.js` and read directly by ~69 call sites across UI, engine, services, and tests. The refactor moves the store into `domain/asset-store.js` (private to the domain layer), exposes focused getters from `domain/asset.js` and `domain/collection.js`, and migrates consumers. `ASSET_STATE_CHANGED` emission is preserved so existing listeners keep working.

**Tech Stack:** ESM JS, Jest (jsdom), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-08-09-asset-domain-model-design.md`.

## Global Constraints

- Big structs + module functions; no `class`, no inheritance.
- ESM; camelCase; JSDoc on new public functions; `npm run typecheck:frontend` must pass.
- **Behavior preservation is paramount.** Unchanged: `ASSET_STATE_CHANGED` event name and payload shape, all toast copies, status/progress fractions, button states, URL updates, publish "no-changes still anchors" path, editor-list caching semantics.
- `domain/asset.js` remains the **only** writer of `activeAssetManifestCid`, `latestAssetManifestCid`, `activeAssetTokenId`, `activeAssetId`, `currentManifest`, `activeAssetName`.
- `domain/collection.js` remains the **only** writer of `activeCollectionTokenId` and `selectedCollectionId`.
- `domain/asset.js` must NOT import `services/asset-save/*` or `domain/collection.js` (cycle guard).
- Persisted manifest field names and internal event names are frozen.
- **Git commits: pre-authorized by the user for this refactor run (per-task commits, repo conventional style).**
- Run from repo root `/home/ahmedh/Projects/arbesk` (or current phase worktree).

---

### Task 1: Domain-owned store

**Files:**
- Create: `frontend/src/js/domain/asset-store.js`
- Modify: `frontend/src/js/domain/asset.js`
- Modify: `frontend/src/js/domain/collection.js`

**Interfaces:**
- `domain/asset-store.js` exports:
  - `assetStore` — the private store (`{ get, set, reset }`)
  - `_resetForTesting` — for Jest tests
  - `tagManifestCid(manifest, cid)` — moved from `state/asset-state.js`
- `domain/asset.js` consumes `assetStore` instead of `assetState` from `state/asset-state.js`.
- `domain/collection.js` consumes `assetStore` instead of `assetState` from `state/asset-state.js`.

- [ ] **Step 1: Create `frontend/src/js/domain/asset-store.js`**

```js
// @ts-nocheck
/**
 * Domain asset store — private shared state for domain/asset.js and
 * domain/collection.js. Replaces the legacy state/asset-state.js wrapper.
 */
import { createStore } from "../state/create-store.js";
import { EVENTS } from "../events/bus.js";

const { store: assetStore, _resetForTesting } = createStore(
  {
    activeAssetManifestCid: null,
    activeAssetTokenId: null,
    activeAssetName: null,
    latestAssetManifestCid: null,
    currentManifest: null,
    activeCollectionTokenId: null,
    activeAssetId: null,
    selectedCollectionId: null,
  },
  EVENTS.ASSET_STATE_CHANGED
);

export { assetStore, _resetForTesting };

/**
 * Tag an in-memory manifest with the CID it represents before storing it in
 * `currentManifest`.
 * @template T
 * @param {T} manifest
 * @param {string|null} cid
 * @returns {T & { _manifestCid: string|null }}
 */
export function tagManifestCid(manifest, cid) {
  return { ...manifest, _manifestCid: cid };
}
```

- [ ] **Step 2: Update `domain/asset.js` to use `assetStore`**

Replace:
```js
import { assetState, tagManifestCid } from "../state/asset-state.js";
```
with:
```js
import { assetStore, tagManifestCid } from "./asset-store.js";
```

Then replace every `assetState.get()` with `assetStore.get()` and every `assetState.set(...)` with `assetStore.set(...)` inside `domain/asset.js`.

- [ ] **Step 3: Update `domain/collection.js` to use `assetStore`**

Replace:
```js
import { assetState } from "../state/asset-state.js";
```
with:
```js
import { assetStore } from "./asset-store.js";
```

Then replace every `assetState.get()` with `assetStore.get()` and every `assetState.set(...)` with `assetStore.set(...)` inside `domain/collection.js`.

- [ ] **Step 4: Run focused domain tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-asset.test.js test/frontend/domain-asset-identity.test.js test/frontend/domain-asset-publish.test.js test/frontend/domain-collection.test.js
```

Expected: PASS (tests may need `assetState` → `assetStore` import updates; do them in this step).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/domain/asset-store.js frontend/src/js/domain/asset.js frontend/src/js/domain/collection.js test/frontend/domain-asset*.test.js test/frontend/domain-collection.test.js
git commit -m "refactor(domain): move shared asset store into domain/asset-store.js"
```

---

### Task 2: Domain getters

**Files:**
- Modify: `frontend/src/js/domain/asset.js`

**Interfaces:**
- `domain/asset.js` additionally exports:
  - `getActiveAssetManifestCid() → string|null`
  - `getLatestAssetManifestCid() → string|null`
  - `getActiveAssetTokenId() → string|null`
  - `getActiveAssetId() → string|null`
  - `getActiveAssetName() → string|null`
  - `getCurrentManifest() → object|null`
  - `getAssetState() → Readonly<AssetState>` (full snapshot for consumers that need multiple fields)

- [ ] **Step 1: Add getters to `domain/asset.js`**

Append after `subscribeAsset`:

```js
/** @returns {string|null} */
export function getActiveAssetManifestCid() {
  return assetStore.get().activeAssetManifestCid;
}

/** @returns {string|null} */
export function getLatestAssetManifestCid() {
  return assetStore.get().latestAssetManifestCid;
}

/** @returns {string|null} */
export function getActiveAssetTokenId() {
  return assetStore.get().activeAssetTokenId;
}

/** @returns {string|null} */
export function getActiveAssetId() {
  return assetStore.get().activeAssetId;
}

/** @returns {string|null} */
export function getActiveAssetName() {
  return assetStore.get().activeAssetName;
}

/** @returns {object|null} */
export function getCurrentManifest() {
  return assetStore.get().currentManifest;
}

/**
 * Full read-only snapshot of the asset domain state. For consumers that need
 * several fields at once; prefer individual getters when possible.
 * @returns {Readonly<{
 *   activeAssetManifestCid: string|null,
 *   activeAssetTokenId: string|null,
 *   activeAssetName: string|null,
 *   latestAssetManifestCid: string|null,
 *   currentManifest: object|null,
 *   activeAssetId: string|null
 * }>}
 */
export function getAssetState() {
  const s = assetStore.get();
  return Object.freeze({
    activeAssetManifestCid: s.activeAssetManifestCid,
    activeAssetTokenId: s.activeAssetTokenId,
    activeAssetName: s.activeAssetName,
    latestAssetManifestCid: s.latestAssetManifestCid,
    currentManifest: s.currentManifest,
    activeAssetId: s.activeAssetId,
  });
}
```

- [ ] **Step 2: Update tests to import from domain/asset.js where appropriate**

Replace `import { assetState, _resetForTesting } from "../state/asset-state.js"` in domain tests with `import { assetStore, _resetForTesting } from "../domain/asset-store.js"` where tests directly assert on the store, or with domain getters where they assert behavior.

- [ ] **Step 3: Run focused tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-asset.test.js test/frontend/domain-asset-identity.test.js test/frontend/domain-asset-publish.test.js test/frontend/domain-collection.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/domain/asset.js test/frontend/domain-asset*.test.js test/frontend/domain-collection.test.js
git commit -m "feat(domain): expose asset-state getters from domain/asset.js"
```

---

### Task 3: Migrate UI consumers

**Files:**
- Modify: `frontend/src/js/ui/outliner.js`
- Modify: `frontend/src/js/ui/nesting.js`
- Modify: `frontend/src/js/ui/asset-save.js`
- Modify: `frontend/src/js/ui/comments-panel.js`
- Modify: `frontend/src/js/ui/create-panel.js`
- Modify: `frontend/src/js/ui/collaborators.js`
- Modify: `frontend/src/js/ui/asset-library.js`
- Modify: `frontend/src/js/ui/asset-chrome.js`
- Modify: `frontend/src/js/ui/ledger-panel.js`

**Interfaces:**
- Consumers replace `assetState.get()` with the getters added in Task 2.
- `ASSET_STATE_CHANGED` listeners stay unchanged (event still emitted by `assetStore`).

- [ ] **Step 1: Update `ui/outliner.js`**

Replace:
```js
import { assetState } from "../state/asset-state.js";
```
with:
```js
import { getActiveAssetManifestCid, getCurrentManifest } from "../domain/asset.js";
```

Replace call sites:
- `assetState.get().activeAssetManifestCid` → `getActiveAssetManifestCid()`
- `assetState.get().currentManifest` → `getCurrentManifest()`

- [ ] **Step 2: Update `ui/nesting.js`**

Replace:
```js
import { assetState } from "../state/asset-state.js";
```
with:
```js
import {
  getActiveAssetManifestCid,
  getActiveAssetName,
  getActiveAssetTokenId,
  getAssetState,
} from "../domain/asset.js";
```

Replace call sites accordingly. The destructured read `const { activeAssetManifestCid, activeAssetName, activeAssetTokenId } = assetState.get();` can use `getAssetState()` or three getters.

- [ ] **Step 3: Update `ui/asset-save.js`**

Replace `assetState.get()` with `getActiveAssetName()`, `getActiveAssetTokenId()`, etc.

- [ ] **Step 4: Update `ui/comments-panel.js`**

Replace `assetState.get().activeAssetTokenId` → `getActiveAssetTokenId()` and `assetState.get().activeAssetId` → `getActiveAssetId()`.

- [ ] **Step 5: Update `ui/create-panel.js`**

Replace all `assetState.get()` reads with the appropriate getters. This file has many call sites; use `getAssetState()` where multiple fields are read together.

- [ ] **Step 6: Update `ui/collaborators.js`**

Replace `assetState.get().activeAssetTokenId` → `getActiveAssetTokenId()`.

- [ ] **Step 7: Update `ui/asset-library.js`**

Replace reads with getters. The `ASSET_STATE_CHANGED` listener stays.

- [ ] **Step 8: Update `ui/asset-chrome.js`**

Replace `assetState.get()` with `getAssetState()` or individual getters.

- [ ] **Step 9: Update `ui/ledger-panel.js`**

Replace `assetState.get().activeAssetManifestCid` → `getActiveAssetManifestCid()`.

- [ ] **Step 10: Run focused UI tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/nesting.test.js test/outliner.test.js test/frontend/asset-save.test.js test/frontend/asset-chrome.test.js test/frontend/asset-library.test.js test/frontend/comments-panel.test.js 2>/dev/null || true
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/js/ui/
git commit -m "refactor(ui): replace assetState reads with domain getters"
```

---

### Task 4: Migrate engine + services consumers

**Files:**
- Modify: `frontend/src/js/engine/scene-loader.js`
- Modify: `frontend/src/js/engine/scene-graph.js`
- Modify: `frontend/src/js/state/comment-thread.js`
- Modify: `frontend/src/js/state/version-history-store.js`
- Modify: `frontend/src/js/services/asset-download.js`
- Modify: `frontend/src/js/services/asset-delete.js`
- Modify: `frontend/src/js/services/asset-save/manifest-builder.js`

**Interfaces:**
- Same as Task 3: replace `assetState.get()` with domain getters.

- [ ] **Step 1: Update `engine/scene-loader.js`**

Replace `assetState.get().currentManifest` → `getCurrentManifest()`.

- [ ] **Step 2: Update `engine/scene-graph.js`**

Replace `assetState.get().activeAssetManifestCid` → `getActiveAssetManifestCid()`.

- [ ] **Step 3: Update `state/comment-thread.js`**

Replace reads with getters. Note: `comment-thread.js` is in `state/` but is a consumer; keep it in `state/` for now.

- [ ] **Step 4: Update `state/version-history-store.js`**

Replace reads with getters.

- [ ] **Step 5: Update `services/asset-download.js`**

Replace reads with getters.

- [ ] **Step 6: Update `services/asset-delete.js`**

Replace reads with getters.

- [ ] **Step 7: Update `services/asset-save/manifest-builder.js`**

Replace reads with getters.

- [ ] **Step 8: Run focused tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/comment-thread.test.js test/frontend/version-history-store.test.js test/frontend/asset-delete.test.js test/frontend/asset-download.test.js test/frontend/manifest-builder.test.js test/frontend/scene-loader-animations.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/js/engine/ frontend/src/js/state/comment-thread.js frontend/src/js/state/version-history-store.js frontend/src/js/services/
git commit -m "refactor(engine/services): replace assetState reads with domain getters"
```

---

### Task 5: Migrate test mocks and assertions

**Files:**
- Modify: all tests importing `state/asset-state.js` (see grep list below)

**Interfaces:**
- Tests that imported `assetState` for assertions now import domain getters or `assetStore`.
- Tests that mocked `state/asset-state.js` now mock `domain/asset-store.js` or the domain getters.

**Test files to update:**
- `test/state/asset-state.test.js` — likely delete or repurpose
- `test/frontend/nesting.test.js`
- `test/frontend/domain-collection.test.js`
- `test/frontend/domain-asset-publish.test.js`
- `test/frontend/domain-asset-identity.test.js`
- `test/frontend/comment-thread.test.js`
- `test/frontend/asset-delete.test.js`
- `test/frontend/domain-asset-save.test.js`
- `test/frontend/version-history-store.test.js`
- `test/frontend/asset-library.test.js`
- `test/outliner.test.js`
- `test/frontend/domain-asset.test.js`
- `test/frontend/linked-asset-self-add.test.js`
- `test/frontend/asset-save.test.js`
- `test/frontend/asset-chrome.test.js`
- `test/frontend/asset-download.test.js`
- `test/frontend/asset-save-core.test.js`
- `test/frontend/scene-loader-animations.test.js`
- `test/frontend/manifest-builder.test.js`

- [ ] **Step 1: Update domain tests**

Replace `import { assetState, _resetForTesting } from "../state/asset-state.js"` with `import { assetStore, _resetForTesting } from "../domain/asset-store.js"` and update `assetState` → `assetStore` references.

- [ ] **Step 2: Update UI/engine/service tests**

For tests that mock `state/asset-state.js`, change the mock path to `domain/asset-store.js` and export the same shape (`assetStore`, `_resetForTesting`, `tagManifestCid` if needed). For tests that only read state, switch to domain getters.

- [ ] **Step 3: Decide fate of `test/state/asset-state.test.js`**

If it only tests the store wrapper, delete it (the store is now internal). If it tests `tagManifestCid`, move that test to a domain test.

- [ ] **Step 4: Run full Jest suite**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='/blockchain/' --testPathIgnorePatterns='/.claude/' --testPathIgnorePatterns='/e2e/'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/
git commit -m "test: migrate asset-state consumers to domain getters and asset-store mocks"
```

---

### Task 6: Delete legacy store and final verification

**Files:**
- Delete: `frontend/src/js/state/asset-state.js`

**Interfaces:**
- No remaining imports of `state/asset-state.js`.

- [ ] **Step 1: Verify no remaining imports**

```bash
grep -R "state/asset-state" frontend/src/js/ test/ || true
```

Expected: no matches.

- [ ] **Step 2: Delete `frontend/src/js/state/asset-state.js`**

```bash
git rm frontend/src/js/state/asset-state.js
```

- [ ] **Step 3: Run full verification**

```bash
npm run lint
npm run typecheck:frontend
npm run build:frontend
NODE_OPTIONS=--experimental-vm-modules npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='/blockchain/' --testPathIgnorePatterns='/.claude/' --testPathIgnorePatterns='/e2e/'
```

Expected: all green.

- [ ] **Step 4: Run E2E regression**

```bash
npm run test:e2e -- --project=chromium e2e/specs/02-generate-asset.spec.js e2e/specs/03-save-and-publish.spec.js e2e/specs/04-parametric-version.spec.js e2e/specs/06-nesting.spec.js e2e/specs/11-library-studio-roundtrip.spec.js e2e/specs/20-new-asset-name.spec.js
```

Expected: PASS.

- [ ] **Step 5: Final review + merge**

Generate review package from `main` to `HEAD`, dispatch code reviewer, address findings, then merge with `--no-ff` and push.

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(state): remove legacy asset-state.js; domain layer owns asset store"
```
