# Asset Domain Model — Phase 3: Collection State + Editor Domain Core

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `domain/collection.js` module that owns collection-context state writes and the canonical collection-publish seam, and introduce a `domain/editors.js` module that owns Merkle editor-list operations (cache, proof building, localStorage key). Replace duplication of editor/Merkle logic across services.

**Architecture:** Big structs + module functions (no classes, no inheritance). `domain/asset.js` stays a facade over `assetState` and must NOT import `services/asset-save/*` or `domain/collection.js`. Collection adoption now lives in `domain/collection.js`; the asset facade no longer writes `activeCollectionTokenId` or `selectedCollectionId`. The canonical `publishCollection` command lives in `domain/collection.js`; the existing `services/asset-save/collection-publish.js` becomes a thin orchestrator that injects chain/IPFS/editor deps and uses an `onAdoptIdentity` callback to tell the asset domain to adopt the published identity without a cycle.

**Tech Stack:** ESM JS, Jest (jsdom), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-08-09-asset-domain-model-design.md` (Phase 3) and `docs/superpowers/plans/2026-08-09-asset-domain-phase2-save-publish.md` (style / global constraints).

**Scope refinements vs spec (controller-noted):**
- `domain/collection.js` is the collection-state + publish seam, not a full Collection struct/directory-map rewrite. `listCollectionAssets()` and a first-class Collection struct are deferred.
- `adoptOpenedAsset` loses its collection-context parameters. Combined asset+collection open paths now emit two `ASSET_STATE_CHANGED` events (asset identity, then collection context) because the two domains are separate; no listener depends on the intermediate partial state.
- `gltf/merkle-editors.js` is kept as a backwards-compatible re-export wrapper so existing unit-test mocks that intercept the wrapper continue to work for consumers that still import merkle functions through it.
- YAGNI: no schema changes, no terminology cleanup (Phase 4), no library-state rewrite.

## Global Constraints

- Big structs + module functions; **no `class`, no inheritance**; `_`-prefix = module-private by convention.
- ESM; camelCase; JSDoc on exported functions; `npm run typecheck:frontend` must pass.
- **Behavior preservation is paramount.** Unchanged: all toast copies, status/progress fractions, button states, `ASSET_DRAFT_SAVED` / `ASSET_PUBLISHED` emissions and payloads, URL updates, publish "no-changes still anchors" path, editor-list caching semantics, Merkle root/proof behavior, 5000-editor cap.
- `domain/asset.js` must remain the **only** writer of `activeAssetManifestCid`, `latestAssetManifestCid`, `activeAssetTokenId`, `activeAssetId`, `currentManifest`, and the **only** writer of `activeAssetName`.
- `domain/collection.js` is the **only** writer of `activeCollectionTokenId` and `selectedCollectionId`.
- `domain/asset.js` must NOT import `services/asset-save/*` or `domain/collection.js` (cycle guard).
- Event-ordering rule: state writes land **before** event emissions.
- Persisted manifest field names and internal event names are frozen.
- **Git commits: pre-authorized by the user for this refactor run (per-task commits, repo conventional style).**
- Run from repo root `/home/ahmedh/Projects/arbesk/.worktrees/refactor-asset-domain-phase3`. Jest single-file runs use `NODE_OPTIONS=--experimental-vm-modules npx jest <path>`.

---

### Task 1: Collection state commands

**Files:**
- Create: `frontend/src/js/domain/collection.js`
- Modify: `frontend/src/js/domain/asset.js`
- Modify: `frontend/src/js/ui/asset-library.js`
- Modify: `frontend/src/js/ui/create-panel.js`
- Modify: `frontend/src/js/engine/scene-graph.js`
- Modify: `test/frontend/domain-asset-identity.test.js`
- Create: `test/frontend/domain-collection.test.js`

**Interfaces:**
- Consumes: `assetState` from `state/asset-state.js`.
- Produces:
  - `getActiveCollectionTokenId() → string|null`
  - `getSelectedCollectionId() → string|null`
  - `adoptOpenedCollection(tokenId, { clearSelectedCollection? })`
  - `selectCollection(tokenId)`
  - `clearSelectedCollection()`
  - `clearActiveCollection()`
  - `adoptPublishedCollection(tokenId)`
- `domain/asset.js`:
  - `adoptOpenedAsset(cid, identity)` no longer accepts `collectionTokenId` or `clearSelectedCollection`; it writes only asset identity fields.
  - `adoptPublishedIdentity(tokenId, assetId)` no longer writes `activeCollectionTokenId`.

- [ ] **Step 1: Create `frontend/src/js/domain/collection.js`**

```js
// @ts-check
/**
 * Domain: Collection — collection-context state and publish seam.
 *
 * Owns reads/writes of activeCollectionTokenId and selectedCollectionId.
 * Publishes assets into a collection via the canonical publishCollection
 * command; all chain/IPFS/editor deps are injected by the caller.
 */
import { assetState } from "../state/asset-state.js";
import {
  deriveDefaultCollectionId,
  mergeAssetIntoCollection,
} from "../utils/collections.js";

/** @returns {string|null} */
export function getActiveCollectionTokenId() {
  return assetState.get().activeCollectionTokenId || null;
}

/** @returns {string|null} */
export function getSelectedCollectionId() {
  return assetState.get().selectedCollectionId || null;
}

/**
 * Adopt a collection as the active collection context.
 * @param {string|number} tokenId
 * @param {{clearSelectedCollection?: boolean}} [options]
 */
export function adoptOpenedCollection(
  tokenId,
  { clearSelectedCollection = false } = {}
) {
  /** @type {Record<string, any>} */
  const patch = { activeCollectionTokenId: String(tokenId) };
  if (clearSelectedCollection) patch.selectedCollectionId = null;
  assetState.set(patch);
}

/**
 * Select a target collection for the next publish (collection dropdown).
 * @param {string|number|null} tokenId
 */
export function selectCollection(tokenId) {
  assetState.set({
    selectedCollectionId: tokenId ? String(tokenId) : null,
  });
}

/** Clear the selected-collection hint. */
export function clearSelectedCollection() {
  assetState.set({ selectedCollectionId: null });
}

/** Clear the active collection context entirely (library close-out / error). */
export function clearActiveCollection() {
  assetState.set({
    activeCollectionTokenId: null,
    selectedCollectionId: null,
  });
}

/**
 * Publish succeeded: the token is now the active collection.
 * @param {string|number} tokenId
 */
export function adoptPublishedCollection(tokenId) {
  assetState.set({ activeCollectionTokenId: String(tokenId) });
}
```

- [ ] **Step 2: Strip collection fields from `domain/asset.js`**

Replace `adoptOpenedAsset` with:

```js
/**
 * Adopt a freshly opened/loaded asset: active + latest CIDs point at `cid`.
 * Identity keys are written only when present (`in` semantics).
 * @param {string} cid
 * @param {{tokenId?: string|null, assetId?: string|null}} [identity]
 */
export function adoptOpenedAsset(cid, identity = {}) {
  /** @type {Record<string, any>} */
  const patch = {
    activeAssetManifestCid: cid,
    latestAssetManifestCid: cid,
  };
  if ("tokenId" in identity) patch.activeAssetTokenId = identity.tokenId;
  if ("assetId" in identity) patch.activeAssetId = identity.assetId;
  assetState.set(patch);
}
```

Replace `adoptPublishedIdentity` with:

```js
/**
 * Publish succeeded: the token is now the asset's on-chain identity.
 * @param {string|number} tokenId
 * @param {string} assetId
 */
export function adoptPublishedIdentity(tokenId, assetId) {
  assetState.set({
    activeAssetTokenId: String(tokenId),
    activeAssetId: assetId,
  });
}
```

Remove the Phase-2 transitional comment about collection-context fields.

- [ ] **Step 3: Rewire callers**

`frontend/src/js/engine/scene-graph.js`:
- Add `import { adoptOpenedCollection } from "../domain/collection.js";`
- In `loadFromParams` token path:
  ```js
  adoptOpenedAsset(cid, { tokenId: String(assetTokenId) });
  adoptOpenedCollection(String(assetTokenId), { clearSelectedCollection: true });
  ```

`frontend/src/js/ui/create-panel.js`:
- Add `import { selectCollection } from "../domain/collection.js";`
- In `syncCollectionSelect`, replace `assetState.set({ selectedCollectionId: defaultId });` with `selectCollection(defaultId);`
- In the `change` listener, replace `assetState.set({ selectedCollectionId: collectionSelect.value || defaultId });` with `selectCollection(collectionSelect.value || defaultId);`

`frontend/src/js/ui/asset-library.js`:
- Add `import { adoptOpenedCollection, clearSelectedCollection, clearActiveCollection, getActiveCollectionTokenId } from "../domain/collection.js";`
- Remove the local `getActiveCollectionTokenId()` helper.
- `openAssetEntry` collection branch:
  ```js
  adoptOpenedAsset(entry.manifestCid, {
    tokenId: String(entry.tokenId),
    assetId: entry.assetId,
  });
  adoptOpenedCollection(String(entry.tokenId), { clearSelectedCollection: true });
  ```
- `openAssetEntry` non-collection branch:
  ```js
  adoptOpenedAsset(entry.manifestCid, { tokenId: String(entry.tokenId) });
  clearSelectedCollection();
  ```
- `openAssetByTokenId` no-cid path: `clearActiveCollection();`
- `openAssetByTokenId` collection branch:
  ```js
  adoptOpenedAsset(targetAssetCid, {
    tokenId: String(tokenId),
    assetId: hasExplicitAssetId ? assetId : null,
  });
  adoptOpenedCollection(String(tokenId), { clearSelectedCollection: true });
  ```
- `openAssetByTokenId` standalone branch:
  ```js
  adoptOpenedAsset(cid, { tokenId: String(tokenId), assetId });
  clearSelectedCollection();
  ```
- Error catch: `clearActiveCollection();`

- [ ] **Step 4: Update `test/frontend/domain-asset-identity.test.js`**

Remove the collection-context assertions from the `adoptOpenedAsset` test and add a test proving collection fields are untouched:

```js
test("adoptOpenedAsset only writes asset identity fields, not collection context", () => {
  assetState.set({ activeCollectionTokenId: "9", selectedCollectionId: "3" });
  adoptOpenedAsset("bafyOther", {
    tokenId: "7",
    assetId: "asset_1",
  });
  const s = assetState.get();
  expect(s.activeAssetManifestCid).toBe("bafyOther");
  expect(s.latestAssetManifestCid).toBe("bafyOther");
  expect(s.activeAssetTokenId).toBe("7");
  expect(s.activeAssetId).toBe("asset_1");
  expect(s.activeCollectionTokenId).toBe("9"); // untouched
  expect(s.selectedCollectionId).toBe("3"); // untouched
});
```

Update the `adoptPublishedIdentity` test so it expects `activeCollectionTokenId` to remain `null`:

```js
test("adoptPublishedIdentity stringifies tokenId and keeps assetId verbatim", () => {
  adoptPublishedIdentity(42, "asset_9");
  const s = assetState.get();
  expect(s.activeAssetTokenId).toBe("42");
  expect(s.activeCollectionTokenId).toBeNull();
  expect(s.activeAssetId).toBe("asset_9");
});
```

- [ ] **Step 5: Create `test/frontend/domain-collection.test.js`**

```js
/**
 * @jest-environment jsdom
 */
import { expect, test, beforeEach } from "@jest/globals";
import {
  adoptOpenedCollection,
  selectCollection,
  clearSelectedCollection,
  clearActiveCollection,
  adoptPublishedCollection,
  getActiveCollectionTokenId,
  getSelectedCollectionId,
} from "../../frontend/src/js/domain/collection.js";
import { assetState, _resetForTesting } from "../../frontend/src/js/state/asset-state.js";

beforeEach(() => _resetForTesting());

test("adoptOpenedCollection sets active token and optionally clears selection", () => {
  adoptOpenedCollection("7", { clearSelectedCollection: true });
  expect(getActiveCollectionTokenId()).toBe("7");
  expect(getSelectedCollectionId()).toBeNull();
});

test("selectCollection / clearSelectedCollection", () => {
  selectCollection("9");
  expect(getSelectedCollectionId()).toBe("9");
  clearSelectedCollection();
  expect(getSelectedCollectionId()).toBeNull();
});

test("clearActiveCollection clears both fields", () => {
  adoptOpenedCollection("7", { clearSelectedCollection: true });
  selectCollection("9");
  clearActiveCollection();
  expect(getActiveCollectionTokenId()).toBeNull();
  expect(getSelectedCollectionId()).toBeNull();
});

test("adoptPublishedCollection stringifies tokenId", () => {
  adoptPublishedCollection(42);
  expect(getActiveCollectionTokenId()).toBe("42");
});
```

- [ ] **Step 6: Run the focused tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-asset-identity.test.js test/frontend/domain-collection.test.js test/frontend/domain-asset.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/js/domain/collection.js frontend/src/js/domain/asset.js frontend/src/js/ui/asset-library.js frontend/src/js/ui/create-panel.js frontend/src/js/engine/scene-graph.js test/frontend/domain-asset-identity.test.js test/frontend/domain-collection.test.js
git commit -m "feat(domain): collection state commands own active/selected collection fields"
```

---

### Task 2: Collection publish seam

**Files:**
- Modify: `frontend/src/js/domain/collection.js`
- Modify: `frontend/src/js/services/asset-save/collection-publish.js`
- Modify: `frontend/src/js/domain/asset.js`
- Modify: `test/frontend/domain-asset-publish.test.js`
- Extend: `test/frontend/domain-collection.test.js`

**Interfaces:**
- `domain/collection.js`:
  - `publishCollection(assetCid, assetID, walletAddr, deps) → { tokenId, collectionCid, isNew }`
  - `deps = { getOwnerOf, getTokenURI, getCollectionManifest, writeJSONToIPFS, republishCollection, publishNewToken, onAdoptIdentity? }`
  - `onAdoptIdentity({ tokenId, assetId, isNew })` is called after the on-chain anchor so the caller can adopt the asset identity without `domain/collection.js` importing `domain/asset.js`.
- `services/asset-save/collection-publish.js`:
  - `publishCollectionForAsset(assetCid, assetID, walletAddr)` remains the 3-arg orchestrator used by `ui/asset-save.js`. It injects real chain/IPFS/editor deps and an `onAdoptIdentity` callback that calls `domain/asset.js`'s `adoptPublishedIdentity`.
- `domain/asset.js`:
  - `publishAsset` no longer calls `adoptPublishedIdentity` directly; it relies on the injected `publishCollection` dep to adopt identity via `onAdoptIdentity`. It emits `ASSET_PUBLISHED` using the returned `tokenId`.

- [ ] **Step 1: Add `publishCollection` and `adoptPublishedCollection` to `domain/collection.js`**

Append to `frontend/src/js/domain/collection.js`:

```js
/**
 * Build the next collection manifest for the asset, write it to IPFS, and
 * anchor it on-chain. Canonical implementation; the thin service wrapper
 * injects chain/IPFS/editor helpers.
 *
 * @param {string} assetCid
 * @param {string} assetID
 * @param {string} walletAddr
 * @param {{
 *   getOwnerOf: Function,
 *   getTokenURI: Function,
 *   getCollectionManifest: Function,
 *   writeJSONToIPFS: Function,
 *   republishCollection: Function,
 *   publishNewToken: Function,
 *   onAdoptIdentity?: (ctx: {tokenId: string, assetId: string, isNew: boolean}) => void|Promise<void>
 * }} deps
 * @returns {Promise<{tokenId: string, collectionCid: string, isNew: boolean}>}
 */
export async function publishCollection(assetCid, assetID, walletAddr, deps) {
  const preferredCollectionId =
    getSelectedCollectionId() || getActiveCollectionTokenId();

  let existingCollectionTokenId = null;
  let collectionManifest = null;

  if (preferredCollectionId) {
    try {
      collectionManifest = await deps.getCollectionManifest(preferredCollectionId);
      if (collectionManifest) existingCollectionTokenId = preferredCollectionId;
    } catch {
      // tokenURI reverted or IPFS fetch failed; treat as new collection
    }
  }

  if (!existingCollectionTokenId) {
    const defaultTokenId = deriveDefaultCollectionId(walletAddr);
    const [ownerResult, manifestResult] = await Promise.allSettled([
      deps.getOwnerOf(defaultTokenId),
      deps.getCollectionManifest(defaultTokenId),
    ]);
    if (ownerResult.status === "fulfilled" && ownerResult.value) {
      existingCollectionTokenId = defaultTokenId;
      collectionManifest =
        manifestResult.status === "fulfilled" ? manifestResult.value : null;
    }
  }

  const mergedCollection = mergeAssetIntoCollection(
    collectionManifest,
    assetID,
    assetCid
  );
  mergedCollection.version = (mergedCollection.version || 0) + 1;
  mergedCollection.prev_asset_manifest_cid = existingCollectionTokenId
    ? await deps.getTokenURI(existingCollectionTokenId)
    : null;
  mergedCollection.timestamp = Date.now();

  const collectionCid = await deps.writeJSONToIPFS(mergedCollection, null, {
    type: "collection",
    assetId: mergedCollection.asset_id,
  });

  let tokenId;
  let isNew;

  if (existingCollectionTokenId) {
    await deps.republishCollection(
      existingCollectionTokenId,
      collectionCid,
      walletAddr
    );
    tokenId = String(existingCollectionTokenId);
    isNew = false;
  } else {
    const newTokenId = deriveDefaultCollectionId(walletAddr);
    if (!newTokenId) throw new Error("Cannot derive default collection id");
    tokenId = newTokenId;
    await deps.publishNewToken(collectionCid, tokenId, walletAddr);
    isNew = true;
  }

  adoptPublishedCollection(tokenId);

  if (typeof deps.onAdoptIdentity === "function") {
    await deps.onAdoptIdentity({ tokenId, assetId: assetID, isNew });
  }

  return { tokenId, collectionCid, isNew };
}
```

- [ ] **Step 2: Replace `services/asset-save/collection-publish.js` with a thin wrapper**

```js
// @ts-nocheck
/**
 * Thin orchestrator around domain/collection.js publishCollection.
 */
import { publishCollection } from "../../domain/collection.js";
import { adoptPublishedIdentity } from "../../domain/asset.js";
import { getOwnerOf, getTokenURI, getCollectionManifest } from "../token.js";
import { writeJSONToIPFS } from "../../ipfs/write-to-ipfs.js";
import {
  republishCollection,
  publishNewToken,
} from "./editor-publish.js";

export async function publishCollectionForAsset(assetCid, assetID, walletAddr) {
  return publishCollection(assetCid, assetID, walletAddr, {
    getOwnerOf,
    getTokenURI,
    getCollectionManifest,
    writeJSONToIPFS,
    republishCollection,
    publishNewToken,
    onAdoptIdentity: ({ tokenId, assetId }) =>
      adoptPublishedIdentity(tokenId, assetId),
  });
}
```

- [ ] **Step 3: Update `domain/asset.js` `publishAsset`**

Remove the `adoptPublishedIdentity(tokenId, assetID);` line and change the `emit` to use the returned `tokenId` directly:

```js
  const { tokenId, isNew } = await deps.publishCollection(
    assetCid,
    assetID,
    wallet.address
  );

  deps.onProgress(0.9, "Besking — finalizing…");
  deps.updateUrlAsset(tokenId);

  if (isNew) {
    const maybePromise = deps.onNewCollection?.();
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {});
    }
  }

  emit(EVENTS.ASSET_PUBLISHED, {
    tokenId: String(tokenId),
    cid: assetCid,
  });
  return { outcome: "published", tokenId: String(tokenId), cid: assetCid, isNew };
```

- [ ] **Step 4: Update `test/frontend/domain-asset-publish.test.js`**

`makeDeps` now includes an unused `onAdoptIdentity` hook so the shape matches the new dep contract:

```js
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
    onAdoptIdentity: jest.fn(),
    ...over,
  };
}
```

Remove the `assetState` identity assertions from the first test (the wrapper now adopts identity). The `ASSET_PUBLISHED` event assertion stays because `publishAsset` now emits using the returned `tokenId`.

- [ ] **Step 5: Extend `test/frontend/domain-collection.test.js`**

Add a test for new-collection publish and one for republish:

```js
test("publishCollection mints a new default collection and adopts identity", async () => {
  const onAdoptIdentity = jest.fn();
  const deps = {
    getOwnerOf: jest.fn().mockResolvedValue(null),
    getTokenURI: jest.fn().mockResolvedValue(null),
    getCollectionManifest: jest.fn().mockResolvedValue(null),
    writeJSONToIPFS: jest.fn().mockResolvedValue("bafyNewCollection"),
    republishCollection: jest.fn().mockResolvedValue(undefined),
    publishNewToken: jest.fn().mockResolvedValue(undefined),
    onAdoptIdentity,
  };

  const out = await publishCollection(
    "bafyAsset",
    "asset_1",
    "0xOwner",
    deps
  );

  expect(deps.writeJSONToIPFS).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "collection",
      assets: { asset_1: "bafyAsset" },
      version: 1,
    }),
    null,
    expect.objectContaining({ type: "collection" })
  );
  expect(deps.publishNewToken).toHaveBeenCalledWith(
    "bafyNewCollection",
    out.tokenId,
    "0xOwner"
  );
  expect(getActiveCollectionTokenId()).toBe(out.tokenId);
  expect(onAdoptIdentity).toHaveBeenCalledWith({
    tokenId: out.tokenId,
    assetId: "asset_1",
    isNew: true,
  });
});

test("publishCollection republishes an existing collection", async () => {
  assetState.set({ activeCollectionTokenId: "7" });
  const deps = {
    getOwnerOf: jest.fn().mockResolvedValue("0xOwner"),
    getTokenURI: jest.fn().mockResolvedValue("bafyPrev"),
    getCollectionManifest: jest.fn().mockResolvedValue({
      type: "collection",
      asset_id: "col_1",
      version: 1,
      assets: {},
    }),
    writeJSONToIPFS: jest.fn().mockResolvedValue("bafyNewCollection"),
    republishCollection: jest.fn().mockResolvedValue(undefined),
    publishNewToken: jest.fn().mockResolvedValue(undefined),
    onAdoptIdentity: jest.fn(),
  };

  const out = await publishCollection(
    "bafyAsset",
    "asset_1",
    "0xOwner",
    deps
  );

  expect(out.tokenId).toBe("7");
  expect(out.isNew).toBe(false);
  expect(deps.republishCollection).toHaveBeenCalledWith(
    "7",
    "bafyNewCollection",
    "0xOwner"
  );
  expect(deps.publishNewToken).not.toHaveBeenCalled();
  expect(getActiveCollectionTokenId()).toBe("7");
});
```

- [ ] **Step 6: Run the focused tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-asset-publish.test.js test/frontend/domain-collection.test.js test/frontend/asset-save.test.js
```

Expected: PASS — `asset-save.test.js` must remain unmodified and green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/js/domain/collection.js frontend/src/js/services/asset-save/collection-publish.js frontend/src/js/domain/asset.js test/frontend/domain-asset-publish.test.js test/frontend/domain-collection.test.js
git commit -m "feat(domain): canonical publishCollection seam with onAdoptIdentity callback"
```

---

### Task 3: Editor domain core

**Files:**
- Create: `frontend/src/js/domain/editors.js`
- Modify: `frontend/src/js/gltf/merkle-editors.js`
- Test: `test/frontend/merkle-editors.test.js` (should pass unmodified)

**Interfaces:**
- `domain/editors.js` exports:
  - `MAX_EDITORS_PER_TOKEN = 5000`
  - `makeLeaf(address, role, tokenId, setVersion)`
  - `computeRoot(editorList, tokenId, setVersion)`
  - `getProof(editorList, targetAddress, tokenId, setVersion)`
  - `verifyProof(root, leaf, proof)`
- `gltf/merkle-editors.js` becomes a thin re-export wrapper.

- [ ] **Step 1: Create `frontend/src/js/domain/editors.js`**

```js
// @ts-nocheck
/**
 * Domain: Editors — Merkle editor-list operations and local cache.
 *
 * Centralizes the editor list localStorage cache, Merkle root computation,
 * proof generation, and on-chain version lookup used by publish, team,
 * delete, library, and comment flows.
 */
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { CollaboratorRole } from "../blockchain/wallet.js";
import { getActiveContract } from "../blockchain/wallet.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";

const EDITOR_LIST_PREFIX = "arbesk_editor_list_";

export const MAX_EDITORS_PER_TOKEN = 5000;

function _soliditySha3(...args) {
  const W3 = window.Web3;
  if (!W3 || !W3.utils || !W3.utils.soliditySha3) {
    throw new Error("Web3.js not loaded from CDN");
  }
  return W3.utils.soliditySha3(...args);
}

export function makeLeaf(address, role, tokenId, setVersion) {
  return _soliditySha3(
    { type: "address", value: address },
    { type: "uint8", value: role },
    { type: "uint256", value: tokenId },
    { type: "uint256", value: setVersion }
  );
}

function _buildTree(leaves) {
  if (!leaves || leaves.length === 0) return null;
  return SimpleMerkleTree.of(leaves);
}

export function computeRoot(editorList, tokenId, setVersion) {
  if (!editorList || editorList.length === 0) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  if (editorList.length > MAX_EDITORS_PER_TOKEN) {
    throw new Error(
      `Editor list has ${editorList.length} members; the maximum is ${MAX_EDITORS_PER_TOKEN}`
    );
  }
  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion)
  );
  const tree = _buildTree(leaves);
  return tree.root;
}

export function getProof(editorList, targetAddress, tokenId, setVersion) {
  if (!editorList || editorList.length === 0) return null;
  const entry = editorList.find(
    (e) => e.address.toLowerCase() === targetAddress.toLowerCase()
  );
  if (!entry) return null;

  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion)
  );
  const tree = _buildTree(leaves);
  const leaf = makeLeaf(targetAddress, entry.role, tokenId, setVersion);
  const proof = tree.getProof(leaf);
  return { proof, role: entry.role };
}

export function verifyProof(root, leaf, proof) {
  if (
    !root ||
    root === "0x0000000000000000000000000000000000000000000000000000000000000000"
  ) {
    return false;
  }
  return SimpleMerkleTree.verify(root, leaf, proof);
}
```

- [ ] **Step 2: Replace `frontend/src/js/gltf/merkle-editors.js` with a re-export wrapper**

```js
// @ts-nocheck
/**
 * Merkle Editor Tree — backwards-compatible re-export of domain/editors.js.
 */
export {
  MAX_EDITORS_PER_TOKEN,
  makeLeaf,
  computeRoot,
  getProof,
  verifyProof,
} from "../domain/editors.js";
```

- [ ] **Step 3: Run the existing merkle test**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/merkle-editors.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/domain/editors.js frontend/src/js/gltf/merkle-editors.js
git commit -m "feat(domain): move Merkle editor helpers to domain/editors.js"
```

---

### Task 4: Editor list cache + proof commands

**Files:**
- Modify: `frontend/src/js/domain/editors.js`
- Modify: `frontend/src/js/services/team.js`
- Modify: `frontend/src/js/services/asset-save/editor-publish.js`
- Modify: `frontend/src/js/services/asset-delete.js`
- Modify: `frontend/src/js/services/library-ops.js`
- Modify: `frontend/src/js/state/comment-thread.js`
- Create: `test/frontend/domain-editors.test.js`

**Interfaces:**
- `domain/editors.js` additionally exports:
  - `editorListKey(tag) → string`
  - `saveEditorList(tag, list, cid?)`
  - `loadEditorList(tag) → Promise<editor[]>`
  - `clearEditorCache(tag)`
  - `getEditorSetVersion(tag) → Promise<number>`
  - `getCachedEditorRoot(tag) → string|null`
  - `buildEditorProof(tag, editorAddress, { isOwner?, ownerRoot? }) → {proof, role}|null`
- Consumers replace duplicated localStorage cache, version lookup, and proof building with calls into `domain/editors.js`.

- [ ] **Step 1: Extend `frontend/src/js/domain/editors.js` with cache/version/proof commands**

Append to `frontend/src/js/domain/editors.js`:

```js
// ─── Cache ─────────────────────────────────────────────────────────────────

export function editorListKey(tag) {
  return EDITOR_LIST_PREFIX + tag;
}

export function saveEditorList(tag, list, cid = null) {
  try {
    localStorage.setItem(
      editorListKey(tag),
      JSON.stringify({ list, cid, saved: Date.now() })
    );
  } catch (e) {
    console.warn("[EDITORS] failed to cache editor list:", e.message);
  }
}

function _loadCachedEditorList(tag) {
  try {
    const raw = localStorage.getItem(editorListKey(tag));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.list)) return parsed.list;
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

export function clearEditorCache(tag) {
  try {
    localStorage.removeItem(editorListKey(tag));
  } catch {
    /* ignore */
  }
}

// ─── List / version resolution ─────────────────────────────────────────────

export async function loadEditorList(tag) {
  if (!tag) return [];
  try {
    const c = getActiveContract();
    if (c) {
      const cid = await c.methods.editorListURI(tag).call();
      if (cid) {
        const fresh = await getFromRemoteIPFS(cid);
        if (Array.isArray(fresh)) {
          saveEditorList(tag, fresh, cid);
          return fresh;
        }
      }
    }
  } catch (err) {
    console.warn(`[EDITORS] failed to load editor list for ${tag}:`, err.message);
  }
  const cached = _loadCachedEditorList(tag);
  return cached || [];
}

export async function getEditorSetVersion(tag) {
  const c = getActiveContract();
  if (!c) return 1;
  try {
    const version = await c.methods.editorSetVersion(tag).call();
    return Number(version);
  } catch {
    return 1;
  }
}

export function getCachedEditorRoot(tag) {
  const cached = _loadCachedEditorList(tag);
  if (!cached) return null;
  return computeRoot(cached, tag, 1);
}

// ─── Proof command ─────────────────────────────────────────────────────────

export async function buildEditorProof(tag, editorAddress, options = {}) {
  const { isOwner = false, ownerRoot = null } = options;
  const [versionResult, listResult] = await Promise.allSettled([
    getEditorSetVersion(tag),
    loadEditorList(tag),
  ]);

  const version = versionResult.status === "fulfilled" ? versionResult.value : 1;
  const list = listResult.status === "fulfilled" ? listResult.value : [];

  const proofFromList = getProof(list, editorAddress, tag, version);
  if (proofFromList) return proofFromList;

  if (isOwner && ownerRoot) {
    const ownerLeaf = makeLeaf(
      editorAddress,
      CollaboratorRole.Editor,
      tag,
      version
    );
    if (ownerRoot.toLowerCase() === ownerLeaf.toLowerCase()) {
      return { proof: [], role: CollaboratorRole.Editor };
    }
  }

  return null;
}
```

- [ ] **Step 2: Refactor `frontend/src/js/services/team.js`**

Replace the merkle/cache/version imports and helpers:

```js
import { computeRoot, getProof, MAX_EDITORS_PER_TOKEN } from "../gltf/merkle-editors.js";
import {
  loadEditorList,
  saveEditorList,
  getEditorSetVersion,
} from "../domain/editors.js";
```

Remove:
- `EDITOR_LIST_PREFIX` constant
- `_editorListKey`
- `_saveEditorListLocally`
- `_getEditorSetVersion`
- the body of `fetchEditors`

Replace `fetchEditors` with:

```js
export async function fetchEditors(tokenId) {
  return loadEditorList(tokenId);
}
```

In `_updateEditorRoot`, replace `_getEditorSetVersion(tokenId)` with `getEditorSetVersion(tokenId)` and `_saveEditorListLocally(tokenId, newEditors, listCid)` with `saveEditorList(tokenId, newEditors, listCid)`.

Replace the re-export block at the bottom with:

```js
export { getEditorSetVersion, saveEditorList as saveEditorListLocally };
```

- [ ] **Step 3: Refactor `frontend/src/js/services/asset-save/editor-publish.js`**

Replace the team imports with domain imports:

```js
import {
  loadEditorList,
  saveEditorList,
  getEditorSetVersion,
} from "../../domain/editors.js";
```

Remove `fetchEditorsFromTeam`, `getEditorSetVersion`, `saveEditorListLocally` from the `../team.js` import (keep `isOwner`).

In `buildWalletProof`, replace `fetchEditorsFromTeam(tokenId)` with `loadEditorList(tokenId)`.

In `prepareInitialEditors`, replace `saveEditorListLocally(tokenId, editorList, editorListUri || null)` with `saveEditorList(tokenId, editorList, editorListUri || null)`.

- [ ] **Step 4: Refactor `frontend/src/js/services/asset-delete.js`**

Replace the merkle import with domain imports:

```js
import { loadEditorList, getEditorSetVersion } from "../domain/editors.js";
import { getProof } from "../gltf/merkle-editors.js";
```

Remove the duplicated local helpers (`EDITOR_LIST_PREFIX`, `editorListKey`, `loadEditorList`, `getEditorSetVersion`).

Replace each occurrence of the load/version/proof block in `deleteAssetFromCollection`, `burnCollection`, and `updateCollectionManifest` with:

```js
let editorList = await loadEditorList(tokenId);
if (!editorList || editorList.length === 0) {
  editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
}
const currentVersion = await getEditorSetVersion(tokenId);
const proofResult = getProof(editorList, walletAddr, tokenId, currentVersion);
if (!proofResult) throw new Error("Not an authorized editor");
```

- [ ] **Step 5: Refactor `frontend/src/js/services/library-ops.js`**

Replace the merkle import:

```js
import { computeRoot, saveEditorList } from "../domain/editors.js";
```

Remove local `EDITOR_LIST_PREFIX`, `editorListKey`, and `saveEditorListLocally`. Replace the call in `createNamedCollection` with:

```js
saveEditorList(tokenId, editorList, editorListUri);
```

- [ ] **Step 6: Refactor `frontend/src/js/state/comment-thread.js`**

Replace the team/merkle imports:

```js
import { buildEditorProof } from "../domain/editors.js";
```

Replace `_loadEditorProof` with:

```js
async _loadEditorProof(tokenId, _chainId, address) {
  try {
    const result = await buildEditorProof(tokenId, address);
    if (!result) return null;
    return { proof: result.proof, role: result.role };
  } catch (err) {
    console.warn("[COMMENT_THREAD] could not build editor proof:", err.message);
    return null;
  }
}
```

- [ ] **Step 7: Create `test/frontend/domain-editors.test.js`**

```js
/**
 * @jest-environment jsdom
 */
import { jest, expect, test, beforeEach, describe } from "@jest/globals";

const soliditySha3 = jest.fn((...args) => {
  const payload = args.map((a) => JSON.stringify(a)).join("");
  const hex = Array.from(payload)
    .reduce((acc, c, i) => acc + ((c.charCodeAt(0) + i) % 16).toString(16), "")
    .slice(0, 64)
    .padStart(64, "0");
  return "0x" + hex;
});

class FakeSimpleMerkleTree {
  constructor(leaves) {
    this._leaves = leaves;
    this.root =
      leaves.length > 0
        ? "0x1111111111111111111111111111111111111111111111111111111111111111"
        : "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  getProof() {
    return ["0x2222222222222222222222222222222222222222222222222222222222222222"];
  }
  static of(leaves) {
    return new FakeSimpleMerkleTree(leaves);
  }
  static verify(root, _leaf, proof) {
    if (!root || root === "0x".padEnd(66, "0")) return false;
    return Array.isArray(proof) && proof.length > 0 && proof[0].startsWith("0x");
  }
}

jest.unstable_mockModule("@openzeppelin/merkle-tree", () => ({
  SimpleMerkleTree: FakeSimpleMerkleTree,
}));

jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet.js", () => ({
  getActiveContract: jest.fn(),
  CollaboratorRole: { None: 0, Viewer: 1, Editor: 2 },
}));

jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
  getFromRemoteIPFS: jest.fn(),
}));

let editors;

beforeAll(async () => {
  global.window.Web3 = { utils: { soliditySha3 } };
  editors = await import("../../frontend/src/js/domain/editors.js");
});

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

describe("cache", () => {
  test("saveEditorList / loadEditorList round-trip via localStorage", async () => {
    const list = [{ address: "0xA", role: 2 }];
    editors.saveEditorList("42", list, "bafyCid");
    const loaded = await editors.loadEditorList("42");
    expect(loaded).toEqual(list);
  });

  test("clearEditorCache removes the stored list", async () => {
    editors.saveEditorList("42", [{ address: "0xA", role: 2 }], "bafyCid");
    editors.clearEditorCache("42");
    const loaded = await editors.loadEditorList("42");
    expect(loaded).toEqual([]);
  });
});

describe("buildEditorProof", () => {
  test("returns proof for a listed editor", async () => {
    const { getActiveContract, getFromRemoteIPFS } = await import(
      "../../frontend/src/js/blockchain/wallet.js"
    );
    getActiveContract.mockReturnValue({
      methods: {
        editorListURI: () => ({ call: () => Promise.resolve("bafyEditors") }),
        editorSetVersion: () => ({ call: () => Promise.resolve("3") }),
      },
    });
    getFromRemoteIPFS.mockResolvedValue([
      { address: "0xA", role: 2 },
      { address: "0xB", role: 2 },
    ]);

    const result = await editors.buildEditorProof("42", "0xA");
    expect(result).toEqual({
      proof: [
        "0x2222222222222222222222222222222222222222222222222222222222222222",
      ],
      role: 2,
    });
  });
});
```

- [ ] **Step 8: Run the focused editor/unit tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/merkle-editors.test.js test/frontend/editor-publish.test.js test/frontend/team.test.js test/frontend/asset-delete.test.js test/frontend/domain-editors.test.js
```

Expected: PASS. `team.test.js` and `editor-publish.test.js` should pass with no changes. `asset-delete.test.js` may emit a harmless `[EDITORS] failed to load editor list` warning because the contract mock lacks `editorListURI`; optionally add `editorListURI: () => ({ call: jest.fn().mockResolvedValue(null) })` to `_mockContract` to silence it.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/js/domain/editors.js frontend/src/js/services/team.js frontend/src/js/services/asset-save/editor-publish.js frontend/src/js/services/asset-delete.js frontend/src/js/services/library-ops.js frontend/src/js/state/comment-thread.js test/frontend/domain-editors.test.js
git commit -m "refactor(domain): centralize editor list cache + proof commands in domain/editors.js"
```

---

### Task 5: Verification

**Files:** none (verification only).

- [ ] **Step 1: Unit + static checks**

```bash
npm test
npm run lint
npm run typecheck:frontend
npm run build:frontend
```

Expected: all green.

- [ ] **Step 2: Final privatization audit**

```bash
grep -rn "assetState\.set(" frontend/src/js | grep -E "activeAssetManifestCid|latestAssetManifestCid|activeAssetTokenId|activeAssetId|currentManifest"
```

Expected: only `frontend/src/js/domain/asset.js` matches.

```bash
grep -rn "assetState\.set(" frontend/src/js | grep -E "activeCollectionTokenId|selectedCollectionId"
```

Expected: only `frontend/src/js/domain/collection.js` matches (plus the patch object in `utils/new-asset.js`, which is a returned patch, not a direct set).

- [ ] **Step 3: E2E regression set**

Start the local stack if needed:

```bash
./scripts/start-dev.sh --setup-only
```

Run the regression specs:

```bash
npm run test:e2e -- --project=chromium e2e/specs/03-save-and-publish.spec.js e2e/specs/04-parametric-version.spec.js e2e/specs/05-republish.spec.js e2e/specs/06-nesting.spec.js e2e/specs/11-library-studio-roundtrip.spec.js e2e/specs/20-new-asset-name.spec.js
```

Expected: all pass.

- [ ] **Step 4: Optional manual smoke**

```bash
./scripts/start-dev.sh
```

Generate → Save draft → Publish → Republish after a color edit → Dive/ascend a child asset → Library roundtrip.

---

## Self-Review Notes

- **Cycle safety:** `domain/asset.js` never imports `domain/collection.js` or `services/asset-save/*`. `services/asset-save/collection-publish.js` imports both `domain/asset.js` and `domain/collection.js` and bridges them via the `onAdoptIdentity` callback, so no import cycle exists.
- **Behavior parity:** `adoptOpenedAsset` and `adoptPublishedIdentity` no longer touch collection fields; all former callers route collection-context writes through `domain/collection.js`. `publishCollection` reproduces the existing resolve/merge/write/republish-or-mint flow verbatim. `ui/asset-save.js` and `test/frontend/asset-save.test.js` remain unchanged because the wrapper absorbs the new callback.
- **Event semantics:** Combined asset+collection open paths emit two `ASSET_STATE_CHANGED` events. No listener reads the partial intermediate state; the header snapshot reads only asset identity fields, and the library listener re-renders idempotently on the second event.
- **Editor centralization:** All editor-list localStorage keys, cache writes, chain version lookups, and Merkle proof generation now live in `domain/editors.js`. `gltf/merkle-editors.js` remains a backwards-compatible wrapper so existing tests that mock the wrapper continue to intercept merkle functions for consumers that import through it.
- **Test preservation:** `merkle-editors.test.js`, `editor-publish.test.js`, `team.test.js`, and `asset-save.test.js` are intentionally kept green with no logic changes (only an optional `editorListURI` stub in `asset-delete.test.js` to silence a warning). `asset-delete.test.js` receives its proof through the same mocked `getProof`, backed by the real domain `loadEditorList`/`getEditorSetVersion` running against the existing wallet/remote-ipfs mocks.
