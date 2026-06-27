# Collection/Asset Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-token-per-asset model with Collections (the sole mintable ERC-721 unit) containing multiple Assets addressed by a local `assetID`, resolved uniformly via `collectionRef/assetID` whether the reference is same-collection or cross-collection.

**Architecture:** A collection manifest holds a flat `assets` map (`assetID -> CID | {chainId, contractAddress, tokenId}`). Each asset is its own self-contained manifest (glTF nodes + its own `prev_asset_manifest_cid` chain) embedded by CID. `child_ref` nodes generalize to point at `{collection: "self" | {chainId, contractAddress, tokenId}, assetID}`. No Solidity changes — `publishAsset`/`updateAssetURI`/Merkle editorRoot are reused unchanged, now operating on the collection's tokenId.

**Tech Stack:** Node/Express backend (`src/api/index.js` delegates routes to `src/api/routes/`), vanilla ESM frontend (`frontend/src/js/`), Babylon.js scene graph, Jest (native ESM, `transform: {}` — no babel), Playwright E2E.

> **Implementation note:** This plan was written against an earlier routing/layout. The live code writes manifests client-side to IPFS (no `POST /api/v1/manifests`), splits scene loading into `frontend/src/js/engine/scene-loader.js` (`scene-graph.js` is a barrel), and places collection helpers in `frontend/src/js/utils/collections.js`. See per-task notes below.

## Global Constraints

- Zero Solidity/contract changes — reuse `publishAsset(uri, tokenId, editorRoot, editorListUri)` and `updateAssetURI(tokenId, newUri, proof)` exactly as they exist today.
- No migration path for existing single-asset tokens — clean break.
- Editor rights stay collection-wide (one `editorRoot`/`editorListURI` per collection tokenId) — no per-asset access control.
- No inline `history[]` array anywhere — versioning is purely `prev_asset_manifest_cid` chain walking, at both the asset level and the collection level.
- `MAX_CHILD_WORLD_DEPTH = 5` (`frontend/src/js/engine/state.js:9`) applies to both `child_ref` traversal and nested-collection traversal, reused unchanged.
- Frontend unit tests for browser-global-dependent modules (`token-resolver.js`, `scene-graph.js`, `asset-save.js`) use the established **inline-copy pattern**: copy the pure function body into the test file rather than importing the module, to avoid Jest ESM resolution issues with BABYLON/Web3 globals (see `test/token-resolver.test.js:1-9`, `test/scene-graph.test.js:1-7`). Every new pure function added to those files must get an inline-copy test using this same pattern.
- Backend tests follow `test/api.test.js` conventions: `jest.unstable_mockModule()` for IPFS/Web3, `_resetStorage()` in `beforeEach`, Supertest for HTTP assertions.

---

### Task 1: Backend — collection-type manifest persistence

**Status:** Superseded. `POST /api/v1/manifests` was removed; manifests are written client-side directly to IPFS by the browser.

**Files:**
- Modify: `src/api/index.js:174-243` (`POST /manifests` handler) — route no longer exists.
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: existing `getSceneNodes(manifest)`, `persistEmbeddedThumbnail(manifest)`, `addAndPin(payload)`, `archiveCommentsForAsset`, `getContractAddress(chainId)` — all already imported in `src/api/index.js`.
- Produces: `POST /manifests` now accepts `manifest.type === "collection"` bodies with `manifest.assets` (object) instead of forcing `manifest.scene.nodes`. Response shape unchanged: `{ cid, assetId, version }`.

> **Implemented as:** Manifest construction and IPFS writes happen in `frontend/src/js/services/asset-save/manifest-builder.js` and `frontend/src/js/ipfs/write-to-ipfs.js`. The backend `POST /api/v1/generations` endpoint returns raw asset bytes; the browser uploads the source asset and the manifest to IPFS. Collection manifests are merged client-side in `frontend/src/js/utils/collections.js::mergeAssetIntoCollection` and written via `frontend/src/js/ipfs/write-to-ipfs.js::writeJSONToIPFS`.

- [ ] **Step 1: Write the failing test**

Add to `test/api.test.js` (near the existing `/manifests` POST tests):

```javascript
it("persists a collection-type manifest without forcing scene.nodes", async () => {
  const collectionManifest = {
    type: "collection",
    asset_id: "collection_test_1",
    version: 1,
    timestamp: Date.now(),
    assets: {
      "chair-01": "bafyChairCid",
      "room-01": "bafyRoomCid",
    },
  };

  const res = await request(app)
    .post("/api/v1/manifests")
    .send(collectionManifest);

  expect(res.status).toBe(201);
  expect(res.body.cid).toBeDefined();

  const stored = await fetchManifestFromIPFS(res.body.cid);
  expect(stored.type).toBe("collection");
  expect(stored.assets).toEqual({
    "chair-01": "bafyChairCid",
    "room-01": "bafyRoomCid",
  });
  // Collection manifests must NOT get a forced scene.nodes default.
  expect(stored.scene).toBeUndefined();
});

it("rejects a collection-type manifest with a non-object assets field", async () => {
  const res = await request(app)
    .post("/api/v1/manifests")
    .send({ type: "collection", assets: "not-an-object" });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe("INVALID_COLLECTION_ASSETS");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- -t "collection-type manifest"`
Expected: FAIL — `stored.scene` is defined (forced default) and the second test gets a 201, not 400.

- [ ] **Step 3: Write minimal implementation**

Edit `src/api/index.js`, inside the `POST /manifests` handler (after the `publishContext` extraction at line 190, before the existing `asset_id`/`version` defaulting at line 192):

```javascript
      // Collection-type manifests use a flat `assets` map instead of
      // `scene.nodes` — skip the scene/nodes default and validate `assets`.
      const isCollection = manifest.type === "collection";
      if (isCollection) {
        if (
          !manifest.assets ||
          typeof manifest.assets !== "object" ||
          Array.isArray(manifest.assets)
        ) {
          console.log(`[SAVE] rejected — collection manifest requires an assets object`);
          return sendError(
            res,
            400,
            "INVALID_COLLECTION_ASSETS",
            "Collection manifest requires an `assets` object",
          );
        }
      }

      // Ensure version fields are present
      if (!manifest.asset_id) {
        manifest.asset_id = `asset_${Date.now()}`;
      }
      if (!isCollection) {
        getSceneNodes(manifest); // ensure .scene and .nodes exist (assets only)
      }
      if (typeof manifest.version !== "number") {
        manifest.version = 1;
      }
```

Then update the existing log line (originally `manifest.scene.nodes.length`) to tolerate collections — replace:

```javascript
      console.log(
        `[SAVE] asset_id=${manifest.asset_id} version=${manifest.version} nodes=${manifest.scene.nodes.length} prev=${manifest.prev_asset_manifest_cid || "null"} thumbnail=${manifest.thumbnail?.cid || "none"} comments_archive=${manifest.comments_archive_cid || "none"} → cid=${resultCid}`,
      );
```

with:

```javascript
      console.log(
        `[SAVE] asset_id=${manifest.asset_id} type=${manifest.type || "asset"} version=${manifest.version} ${isCollection ? `assets=${Object.keys(manifest.assets).length}` : `nodes=${manifest.scene.nodes.length}`} prev=${manifest.prev_asset_manifest_cid || "null"} thumbnail=${manifest.thumbnail?.cid || "none"} comments_archive=${manifest.comments_archive_cid || "none"} → cid=${resultCid}`,
      );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- -t "collection-type manifest"`
Expected: PASS (both tests)

- [ ] **Step 5: Run full backend suite to check for regressions**

Run: `npm run test:api`
Expected: PASS — no existing test sends `manifest.type === "collection"`, so the `isCollection` branch is inert for all current asset-manifest tests.

- [ ] **Step 6: Commit**

```bash
git add src/api/index.js test/api.test.js
git commit -m "feat(api): support collection-type manifests in POST /manifests"
```

---

### Task 2: token-resolver.js — collection asset resolution

**Files:**
- Modify: `frontend/src/js/blockchain/token-resolver.js` (add new exports after `resolveChildRef`, before `clearResolutionCache` at line 294)
- Test: `test/token-resolver.test.js`

**Interfaces:**
- Consumes: existing `resolveChildRef(childRef, options)` (line 155) for the cross-collection case.
- Produces:
  - `resolveAssetIdFromCollection(assetsMap, assetID)` → `{ kind: "cid" | "collection" | "missing", value: string | {chainId, contractAddress, tokenId} | null }`
  - `resolveCollectionChildRef(childRef, activeCollectionAssets)` → `Promise<ResolutionResult>` (same shape as `resolveChildRef`'s return), where `childRef` is `{ collection: "self" | {chainId, contractAddress, tokenId}, assetID }`.

- [ ] **Step 1: Write the failing test**

Add to `test/token-resolver.test.js` (after the existing `describe("Token Resolver — child_ref validation", ...)` block):

```javascript
describe("Token Resolver — resolveAssetIdFromCollection", () => {
  /**
   * Inline copy of resolveAssetIdFromCollection from
   * frontend/src/js/blockchain/token-resolver.js
   */
  function resolveAssetIdFromCollection(assetsMap, assetID) {
    if (!assetsMap || typeof assetsMap !== "object") {
      return { kind: "missing", value: null };
    }
    const entry = assetsMap[assetID];
    if (entry === undefined || entry === null) {
      return { kind: "missing", value: null };
    }
    if (typeof entry === "string") {
      return { kind: "cid", value: entry };
    }
    if (
      typeof entry === "object" &&
      entry.tokenId !== undefined &&
      entry.contractAddress
    ) {
      return { kind: "collection", value: entry };
    }
    return { kind: "missing", value: null };
  }

  it("resolves a string entry as a direct CID", () => {
    const result = resolveAssetIdFromCollection(
      { "chair-01": "bafyChairCid" },
      "chair-01"
    );
    expect(result).toEqual({ kind: "cid", value: "bafyChairCid" });
  });

  it("resolves an object entry as a nested collection reference", () => {
    const tokenRef = { chainId: 6343, contractAddress: "0xabc", tokenId: "42" };
    const result = resolveAssetIdFromCollection(
      { "garden-01": tokenRef },
      "garden-01"
    );
    expect(result).toEqual({ kind: "collection", value: tokenRef });
  });

  it("returns missing for an unknown assetID", () => {
    const result = resolveAssetIdFromCollection(
      { "chair-01": "bafyChairCid" },
      "table-99"
    );
    expect(result).toEqual({ kind: "missing", value: null });
  });

  it("returns missing when assetsMap is null", () => {
    expect(resolveAssetIdFromCollection(null, "chair-01")).toEqual({
      kind: "missing",
      value: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- token-resolver.test.js -t "resolveAssetIdFromCollection"`
Expected: PASS already — this is a self-contained inline copy, so it passes immediately against the inline copy. This step instead verifies the test is well-formed: confirm all 4 assertions run (check test output shows 4 passing specs under the new `describe` block) before moving on, since there's no implementation to fail against yet.

- [ ] **Step 3: Write the real implementation**

Edit `frontend/src/js/blockchain/token-resolver.js`, add after `resolveChildRef` (after line 280, before the `fetchManifestSafe` helper at line 285):

```javascript
/**
 * Look up an assetID inside a collection's `assets` map.
 *
 * @param {Object|null} assetsMap - The collection manifest's `assets` field
 * @param {string} assetID
 * @returns {{kind: "cid"|"collection"|"missing", value: string|Object|null}}
 */
export function resolveAssetIdFromCollection(assetsMap, assetID) {
  if (!assetsMap || typeof assetsMap !== "object") {
    return { kind: "missing", value: null };
  }
  const entry = assetsMap[assetID];
  if (entry === undefined || entry === null) {
    return { kind: "missing", value: null };
  }
  if (typeof entry === "string") {
    return { kind: "cid", value: entry };
  }
  if (
    typeof entry === "object" &&
    entry.tokenId !== undefined &&
    entry.contractAddress
  ) {
    return { kind: "collection", value: entry };
  }
  return { kind: "missing", value: null };
}

/**
 * Resolve a generalized collection child reference: `{ collection, assetID }`.
 * `collection` is either `"self"` (resolve against the currently-loaded
 * collection's assets map) or `{chainId, contractAddress, tokenId}`
 * (resolve that token's collection manifest first, then look up assetID
 * inside it).
 *
 * @param {{collection: "self"|Object, assetID: string}} childRef
 * @param {Object|null} activeCollectionAssets - assets map of the collection
 *   currently being loaded; required when childRef.collection === "self"
 * @returns {Promise<ResolutionResult>}
 */
export async function resolveCollectionChildRef(childRef, activeCollectionAssets) {
  if (!childRef || !childRef.assetID) {
    return {
      manifestCid: null,
      manifest: null,
      resolved: false,
      error: "Invalid collection child_ref: missing assetID",
      fromCache: false,
    };
  }

  let assetsMap = activeCollectionAssets;

  if (childRef.collection && childRef.collection !== "self") {
    const collectionResolution = await resolveChildRef(
      {
        type: "token",
        chainId: childRef.collection.chainId,
        contractAddress: childRef.collection.contractAddress,
        tokenId: childRef.collection.tokenId,
        standard: "ERC721",
        resolution: "latest",
      },
      { validate: true }
    );
    if (!collectionResolution.resolved || !collectionResolution.manifest) {
      return {
        manifestCid: null,
        manifest: null,
        resolved: false,
        error: `Could not resolve cross-collection reference: ${collectionResolution.error}`,
        fromCache: false,
      };
    }
    assetsMap = collectionResolution.manifest.assets;
  }

  const lookup = resolveAssetIdFromCollection(assetsMap, childRef.assetID);
  if (lookup.kind === "missing") {
    return {
      manifestCid: null,
      manifest: null,
      resolved: false,
      error: `assetID "${childRef.assetID}" not found in collection`,
      fromCache: false,
    };
  }
  if (lookup.kind === "collection") {
    // Nested collection: caller is responsible for recursing — surface the
    // token ref so scene-loader.js can treat it as a nested collection load.
    return {
      manifestCid: null,
      manifest: null,
      resolved: true,
      nestedCollectionRef: lookup.value,
      error: null,
      fromCache: false,
    };
  }

  const manifest = await fetchManifestSafe(lookup.value);
  return {
    manifestCid: lookup.value,
    manifest,
    resolved: true,
    error: null,
    fromCache: false,
  };
}
```

- [ ] **Step 4: Run the inline-copy test again to confirm parity**

Run: `npm run test -- token-resolver.test.js`
Expected: PASS — all existing + new tests pass (the inline copy and the real implementation are intentionally identical logic; this step is a manual diff check, not an automated one — read both side by side and confirm no drift before moving on).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/blockchain/token-resolver.js test/token-resolver.test.js
git commit -m "feat(token-resolver): add collection-aware asset reference resolution"
```

---

### Task 3: state.js + scene-loader.js — collection-aware scene loading

**Files:**
- Modify: `frontend/src/js/engine/state.js` (add 2 fields)
- Modify: `frontend/src/js/engine/scene-loader.js` (`loadTokenChildNode`), add new `loadCollectionManifest` export
- Test: `test/scene-graph.test.js`

**Interfaces:**
- Consumes: `resolveCollectionChildRef`, `resolveAssetIdFromCollection` from Task 2 (`frontend/src/js/blockchain/token-resolver.js`).
- Produces:
  - `state.activeCollectionAssets` (`Object|null`) and `state.activeCollectionRef` (`{chainId, contractAddress, tokenId}|null`) on the shared `state` object.
  - `loadCollectionManifest(collectionCid)` → `Promise<{manifest, assetEntries: Array<{assetID, kind, value}>}>` — loads a collection manifest, populates `state.activeCollectionAssets`/`activeCollectionRef`, returns a flat list of its entries for gallery UI to render (does not render any 3D content itself).
  - `node.child_ref.collection` is now read by `loadTokenChildNode` in `frontend/src/js/engine/scene-loader.js`: `"self"` resolves against `state.activeCollectionAssets`; an object resolves cross-collection exactly as before.

- [ ] **Step 1: Write the failing test**

Add to `test/scene-graph.test.js` (after the existing pure-function inline copies near the top, following the file's established pattern):

```javascript
describe("Scene Graph — buildChildRefResolutionPlan", () => {
  /**
   * Inline copy of buildChildRefResolutionPlan from
   * frontend/src/js/engine/scene-loader.js. Given a node's child_ref and the
   * currently-active collection's assets map, decides whether resolution
   * should go through the same-collection lookup or the cross-collection
   * tokenURI path. Pure decision logic only — no I/O.
   */
  function buildChildRefResolutionPlan(childRef, activeCollectionAssets) {
    if (!childRef) return { kind: "invalid" };

    // Legacy top-level child_ref shape (type: "token", tokenId at top level)
    // still resolves as a direct cross-collection token reference.
    if (childRef.type === "token" && childRef.tokenId) {
      return { kind: "cross-collection-token", ref: childRef };
    }

    // New generalized shape: { collection, assetID }
    if (childRef.assetID) {
      if (childRef.collection === "self") {
        return {
          kind: "same-collection",
          assetID: childRef.assetID,
          assetsMap: activeCollectionAssets,
        };
      }
      if (childRef.collection && childRef.collection.tokenId) {
        return {
          kind: "cross-collection-asset",
          collectionRef: childRef.collection,
          assetID: childRef.assetID,
        };
      }
    }

    return { kind: "invalid" };
  }

  it("plans a same-collection lookup for collection: 'self'", () => {
    const assetsMap = { "chair-01": "bafyChair" };
    const plan = buildChildRefResolutionPlan(
      { collection: "self", assetID: "chair-01" },
      assetsMap
    );
    expect(plan).toEqual({
      kind: "same-collection",
      assetID: "chair-01",
      assetsMap,
    });
  });

  it("plans a cross-collection-asset lookup when collection is a token ref", () => {
    const collectionRef = { chainId: 6343, contractAddress: "0xabc", tokenId: "42" };
    const plan = buildChildRefResolutionPlan(
      { collection: collectionRef, assetID: "chair-01" },
      null
    );
    expect(plan).toEqual({
      kind: "cross-collection-asset",
      collectionRef,
      assetID: "chair-01",
    });
  });

  it("plans a legacy cross-collection-token lookup for today's top-level child_ref shape", () => {
    const legacyRef = {
      type: "token",
      chainId: 314159,
      contractAddress: "0xabc",
      tokenId: "42",
      standard: "ERC721",
      resolution: "latest",
    };
    const plan = buildChildRefResolutionPlan(legacyRef, null);
    expect(plan).toEqual({ kind: "cross-collection-token", ref: legacyRef });
  });

  it("returns invalid for a malformed child_ref", () => {
    expect(buildChildRefResolutionPlan({}, null)).toEqual({ kind: "invalid" });
    expect(buildChildRefResolutionPlan(null, null)).toEqual({ kind: "invalid" });
  });
});
```

- [ ] **Step 2: Run test to verify it's well-formed**

Run: `npm run test -- scene-graph.test.js -t "buildChildRefResolutionPlan"`
Expected: PASS (4/4) — inline copy, same note as Task 2 Step 2.

- [ ] **Step 3: Implement the state fields**

Edit `frontend/src/js/engine/state.js`, add to the `state` object (after `pendingTransformEdits` at line 62):

```javascript
  /**
   * The `assets` map of the collection currently open in the Studio.
   * Populated by loadCollectionManifest(); used to resolve `child_ref`
   * nodes whose `collection` field is `"self"`.
   * @type {Object|null}
   */
  activeCollectionAssets: null,
  /**
   * Identity of the collection currently open in the Studio.
   * @type {{chainId: number, contractAddress: string, tokenId: string}|null}
   */
  activeCollectionRef: null,
```

- [ ] **Step 4: Implement buildChildRefResolutionPlan and wire it into loadTokenChildNode**

Edit `frontend/src/js/engine/scene-loader.js`. Add the import (alongside the existing token-resolver imports):

```javascript
import {
  resolveChildRef,
  resolveCollectionChildRef,
  clearResolutionCache,
} from "../blockchain/token-resolver.js";
```

Add `buildChildRefResolutionPlan` as a standalone function (place it directly above `loadTokenChildNode`):

```javascript
/**
 * Decide how a node's child_ref should be resolved: same-collection lookup,
 * cross-collection asset lookup, or the legacy top-level token reference.
 * Pure decision logic — no I/O.
 */
function buildChildRefResolutionPlan(childRef, activeCollectionAssets) {
  if (!childRef) return { kind: "invalid" };

  if (childRef.type === "token" && childRef.tokenId) {
    return { kind: "cross-collection-token", ref: childRef };
  }

  if (childRef.assetID) {
    if (childRef.collection === "self") {
      return {
        kind: "same-collection",
        assetID: childRef.assetID,
        assetsMap: activeCollectionAssets,
      };
    }
    if (childRef.collection && childRef.collection.tokenId) {
      return {
        kind: "cross-collection-asset",
        collectionRef: childRef.collection,
        assetID: childRef.assetID,
      };
    }
  }

  return { kind: "invalid" };
}
```

Now generalize `loadTokenChildNode` (replace the body from `const childRef = node.child_ref;` at line 770 through the `resolveChildRef(childRef)` call at line 798, keeping everything else — depth/cycle guard, placeholder creation, `childAnchor` setup — unchanged):

```javascript
async function loadTokenChildNode(node, anchor, depth, resolvingCids) {
  const childRef = node.child_ref;
  if (!childRef) return [];

  if (depth >= MAX_CHILD_WORLD_DEPTH) {
    console.warn(
      `[SCENE] max child world depth (${MAX_CHILD_WORLD_DEPTH}) reached at node ${node.node_id}`
    );
    const placeholder = createPlaceholder(node.node_id, anchor, "error");
    return [placeholder];
  }

  const plan = buildChildRefResolutionPlan(childRef, state.activeCollectionAssets);

  // Same-collection self-reference cycle: a node referencing its own
  // assetID via collection:"self" is always a cycle, independent of depth.
  if (
    plan.kind === "same-collection" &&
    plan.assetID === state.activeCollectionCurrentAssetID
  ) {
    console.warn(
      `[SCENE] self-referencing same-collection child_ref rejected at node ${node.node_id}`
    );
    const placeholder = createPlaceholder(node.node_id, anchor, "error");
    return [placeholder];
  }

  const refKey =
    plan.kind === "cross-collection-token"
      ? `${childRef.chainId}:${childRef.contractAddress}:${childRef.tokenId}`
      : plan.kind === "cross-collection-asset"
      ? `${plan.collectionRef.chainId}:${plan.collectionRef.contractAddress}:${plan.collectionRef.tokenId}:${plan.assetID}`
      : `self:${plan.assetID}`;

  if (resolvingCids.has(refKey)) {
    console.warn(
      `[SCENE] circular child_ref detected at node ${node.node_id}, ref=${refKey}`
    );
    const placeholder = createPlaceholder(node.node_id, anchor, "error");
    return [placeholder];
  }

  const loadingPlaceholder = createPlaceholder(node.node_id, anchor, "loading");

  resolvingCids.add(refKey);
  try {
    console.log(
      `[SCENE] resolving child node ${node.node_id} depth=${depth} kind=${plan.kind}`
    );

    let resolution;
    if (plan.kind === "cross-collection-token") {
      resolution = await resolveChildRef(childRef);
    } else if (plan.kind === "invalid") {
      resolution = { resolved: false, error: "Invalid child_ref shape" };
    } else {
      resolution = await resolveCollectionChildRef(
        plan.kind === "same-collection"
          ? { collection: "self", assetID: plan.assetID }
          : { collection: plan.collectionRef, assetID: plan.assetID },
        plan.kind === "same-collection" ? plan.assetsMap : null
      );
    }

    if (resolution.nestedCollectionRef) {
      // assetID resolved to a nested collection, not a direct asset CID:
      // recurse via the cross-collection token path.
      resolution = await resolveChildRef({
        type: "token",
        chainId: resolution.nestedCollectionRef.chainId,
        contractAddress: resolution.nestedCollectionRef.contractAddress,
        tokenId: resolution.nestedCollectionRef.tokenId,
        standard: "ERC721",
        resolution: "latest",
      });
    }

    if (!resolution.resolved || !resolution.manifestCid) {
      console.warn(
        `[SCENE] child resolution failed for node ${node.node_id}: ${resolution.error}`
      );
      disposePlaceholder(loadingPlaceholder);
      const errorPlaceholder = createPlaceholder(node.node_id, anchor, "error");
      return [errorPlaceholder];
    }

    console.log(
      `[SCENE] child node ${node.node_id} resolved → ${resolution.manifestCid}`
    );

    const childAnchor = createAnchorNode(
      `child_anchor_${node.node_id}`,
      state.scene
    );
    childAnchor.parent = anchor;
    childAnchor.metadata = {
      childRef,
      resolvedCid: resolution.manifestCid,
      loaded: true,
      nodeId: node.node_id,
    };

    if (!state.nodeAnchors.has(node.node_id)) {
      state.nodeAnchors.set(node.node_id, childAnchor);
    }

    disposePlaceholder(loadingPlaceholder);

    await loadAssetManifest(
      resolution.manifestCid,
      childAnchor,
      depth + 1,
      resolvingCids
    );

    return [];
  } catch (err) {
    console.error(`[SCENE] failed to load child node ${node.node_id}:`, err);
    disposePlaceholder(loadingPlaceholder);
    const errorPlaceholder = createPlaceholder(node.node_id, anchor, "error");
    return [errorPlaceholder];
  } finally {
    resolvingCids.delete(refKey);
  }
}
```

Add `state.activeCollectionCurrentAssetID` to `state.js` alongside the two fields from Step 3 (tracks which assetID's manifest is currently being loaded, set by `loadCollectionManifest`/asset-open flow — used only for the self-reference cycle check above):

```javascript
  /**
   * The assetID of the asset manifest currently being loaded/rendered
   * within the active collection. Used to reject direct self-references
   * (collection:"self" pointing at the same assetID being resolved).
   * @type {string|null}
   */
  activeCollectionCurrentAssetID: null,
```

Add the new `loadCollectionManifest` export (place after `loadAssetManifest`, i.e. after line 951):

```javascript
/**
 * Load a collection manifest and populate the active-collection state.
 * Does NOT render any 3D content — returns the manifest plus a flat list
 * of its entries so gallery UI can let the user pick which asset to open.
 *
 * @param {string} collectionCid
 * @param {{chainId: number, contractAddress: string, tokenId: string}} collectionRef
 * @returns {Promise<{manifest: Object, assetEntries: Array<{assetID: string, kind: string, value: any}>}>}
 */
async function loadCollectionManifest(collectionCid, collectionRef) {
  const manifest = await getFromRemoteIPFS(collectionCid);
  if (!manifest || manifest.type !== "collection") {
    throw new Error(`CID ${collectionCid} is not a collection manifest`);
  }

  state.activeCollectionAssets = manifest.assets || {};
  state.activeCollectionRef = collectionRef || null;

  const assetEntries = Object.entries(manifest.assets || {}).map(
    ([assetID, value]) => ({
      assetID,
      kind: typeof value === "string" ? "asset" : "collection",
      value,
    })
  );

  return { manifest, assetEntries };
}
```

Export it alongside the existing exports (add to the `export { ... }` block at line 1242):

```javascript
export {
  loadAssetManifest,
  loadCollectionManifest,
  loadNode,
  loadAsset,
  getNodeAnchor,
  getNodeMeshes,
  getNodeSubMeshes,
  getNodeChildRef,
  registerMockNode,
  captureAssetThumbnail,
  dismissCreatePulse,
  deselectAll,
  selectNodeById,
  selectSubMesh,
};
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- scene-graph.test.js`
Expected: PASS — new `buildChildRefResolutionPlan` tests pass; existing scene-graph tests unaffected (no existing test exercises `loadTokenChildNode` directly — it's covered at the E2E layer per `e2e/specs/06`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/engine/state.js frontend/src/js/engine/scene-loader.js test/scene-graph.test.js
git commit -m "feat(scene-loader): generalize child_ref resolution for same-collection and cross-collection assets"
```

---

### Task 4: asset-save.js + collections.js — collection-aware besk

**Files:**
- Modify: `frontend/src/js/ui/asset-save.js` (orchestrates save/publish)
- Modify: `frontend/src/js/utils/collections.js` (pure helpers: `mergeAssetIntoCollection`, `deriveDefaultAssetId`, `deriveDefaultCollectionId`)
- Modify: `frontend/src/js/services/asset-save/collection-publish.js` (collection manifest resolution and on-chain anchoring)
- Modify: `frontend/src/js/state/asset-state.js` (add 2 fields)
- Test: `test/asset-save-collection.test.js` (new file, inline-copy pattern)

**Interfaces:**
- Consumes: `assetState` fields from this task; no other task's exports.
- Produces:
  - `assetState` gains `activeCollectionTokenId` (`string|null`) and `activeAssetId` (`string|null`, the current asset's slot within the active collection).
  - `mergeAssetIntoCollection(collectionManifest, assetID, assetCid)` → new/updated collection manifest object (pure function, lives in `frontend/src/js/utils/collections.js`, exported for testing and reused by publish flow).
  - `deriveDefaultAssetId(existingAssetId, assetManifestSeed)` → `string` (generates a stable per-asset slug the first time an asset is saved into a collection; lives in `frontend/src/js/utils/collections.js`).

> **Implemented as:** The live code split save/publish into `frontend/src/js/services/asset-save/manifest-builder.js` (manifest construction), `frontend/src/js/services/asset-save/collection-publish.js` (collection merge + on-chain anchor), and `frontend/src/js/services/asset-save/editor-publish.js` (Merkle editor proofs). The default collection token ID is derived from the wallet address via `deriveDefaultCollectionId`, not from the manifest CID.

- [ ] **Step 1: Write the failing test**

Create `test/asset-save-collection.test.js`:

```javascript
/**
 * asset-save.js collection-merge logic — Unit Tests
 *
 * Inline copies of pure functions from frontend/src/js/ui/asset-save.js,
 * matching the established pattern in test/token-resolver.test.js and
 * test/scene-graph.test.js (avoids Jest ESM issues with browser globals).
 */

/** Inline copy of mergeAssetIntoCollection from frontend/src/js/utils/collections.js */
function mergeAssetIntoCollection(collectionManifest, assetID, assetCid) {
  const base = collectionManifest
    ? { ...collectionManifest }
    : {
        type: "collection",
        asset_id: `collection_${Date.now()}`,
        version: 0,
        assets: {},
      };
  const assets = { ...(base.assets || {}) };
  assets[assetID] = assetCid;
  return {
    ...base,
    type: "collection",
    assets,
  };
}

/** Inline copy of deriveDefaultAssetId from frontend/src/js/utils/collections.js */
function deriveDefaultAssetId(existingAssetId, fallbackSeed) {
  if (existingAssetId) return existingAssetId;
  return `asset_${fallbackSeed}`;
}

describe("asset-save — mergeAssetIntoCollection", () => {
  it("creates a fresh collection manifest when none exists yet (default collection lazy-mint)", () => {
    const result = mergeAssetIntoCollection(null, "asset_1", "bafyAssetCid");
    expect(result.type).toBe("collection");
    expect(result.assets).toEqual({ asset_1: "bafyAssetCid" });
  });

  it("adds a new assetID entry without disturbing existing entries", () => {
    const existing = {
      type: "collection",
      version: 2,
      assets: { "chair-01": "bafyChairCid" },
    };
    const result = mergeAssetIntoCollection(existing, "room-01", "bafyRoomCid");
    expect(result.assets).toEqual({
      "chair-01": "bafyChairCid",
      "room-01": "bafyRoomCid",
    });
    expect(result.version).toBe(2); // version bump happens elsewhere, not in merge
  });

  it("overwrites an existing assetID's CID on re-besk", () => {
    const existing = {
      type: "collection",
      assets: { "chair-01": "bafyChairCidV1" },
    };
    const result = mergeAssetIntoCollection(existing, "chair-01", "bafyChairCidV2");
    expect(result.assets["chair-01"]).toBe("bafyChairCidV2");
  });
});

describe("asset-save — deriveDefaultAssetId", () => {
  it("reuses an existing assetID when present", () => {
    expect(deriveDefaultAssetId("chair-01", 123)).toBe("chair-01");
  });

  it("derives a fresh assetID from the seed when none exists", () => {
    expect(deriveDefaultAssetId(null, 123)).toBe("asset_123");
  });
});
```

- [ ] **Step 2: Run test to verify it's well-formed**

Run: `npm run test -- asset-save-collection.test.js`
Expected: PASS (5/5) — inline copy.

- [ ] **Step 3: Implement the state fields**

Edit `frontend/src/js/state/asset-state.js`:

```javascript
const _defaults = {
  activeAssetManifestCid: null,
  activeAssetTokenId: null,
  activeAssetName: null,
  latestAssetManifestCid: null,
  currentManifest: null,
  activeCollectionTokenId: null,
  activeAssetId: null,
};
```

- [ ] **Step 4: Implement the real functions and wire them into the besk flow**

Edit `frontend/src/js/ui/asset-save.js`. Add the two new functions near `advanceManifestVersion` (after line 186):

```javascript
/**
 * Merge an asset's CID into a collection manifest's `assets` map.
 * Pure function — does not touch IPFS or chain state.
 */
function mergeAssetIntoCollection(collectionManifest, assetID, assetCid) {
  const base = collectionManifest
    ? { ...collectionManifest }
    : {
        type: "collection",
        asset_id: `collection_${Date.now()}`,
        version: 0,
        assets: {},
      };
  const assets = { ...(base.assets || {}) };
  assets[assetID] = assetCid;
  return {
    ...base,
    type: "collection",
    assets,
  };
}

/**
 * Derive the assetID an asset occupies within its collection. Reuses the
 * existing assetID if the asset has one; otherwise derives a fresh one from
 * the given seed (e.g. Date.now()) the first time the asset is besked.
 */
function deriveDefaultAssetId(existingAssetId, fallbackSeed) {
  if (existingAssetId) return existingAssetId;
  return `asset_${fallbackSeed}`;
}
```

In `prepareManifestForWrite`, the inner asset manifest gains `type: "asset"` — edit the fresh-manifest branch (lines 331-337):

```javascript
    manifest = {
      type: "asset",
      name: assetName,
      asset_id: `asset_${Date.now()}`,
      version: 1,
      timestamp: Date.now(),
      scene: { nodes: [] },
    };
```

And the loaded-from-CID branch (line 324) — immediately after `manifest = await getFromRemoteIPFS(...)`, ensure the type tag exists for manifests saved before this change is irrelevant (no migration per Global Constraints), but newly-created ones must carry it:

```javascript
  if (assetState.get().activeAssetManifestCid) {
    manifest = await getFromRemoteIPFS(assetState.get().activeAssetManifestCid);
    manifest.type = "asset";
```

Now edit `onPublishAsset` (lines 648-784). Replace the entire tokenId/publish branch (lines 708-748, from `const { cid } = result;` through the `else { ... }` block) with:

> **Implemented as:** The live publish branch is much shorter; it calls `publishCollectionForAsset(assetCid, assetID, walletAddr)` in `frontend/src/js/services/asset-save/collection-publish.js`, which resolves the existing/default collection token ID from the wallet address, merges the asset, writes the collection manifest, and anchors it on-chain.

```javascript
    const { cid: assetCid } = result;

    const assetID = deriveDefaultAssetId(
      assetState.get().activeAssetId,
      Date.now()
    );
    assetState.set({ activeAssetId: assetID });

    announceStatus("Confirm transaction in MetaMask…");
    const walletAddr = walletState.get().walletAddress;

    // Fetch the current collection manifest (if one exists yet) and merge
    // this asset's new CID into its assets map. If no collection token
    // exists yet, this besk lazily mints the default collection.
    const existingCollectionTokenId = assetState.get().activeCollectionTokenId;
    let collectionManifest = null;
    if (existingCollectionTokenId) {
      const c = walletContract || walletState.get().contract;
      const collectionCid = await c.methods
        .tokenURI(String(existingCollectionTokenId))
        .call();
      collectionManifest = await getFromRemoteIPFS(collectionCid);
    }
    const mergedCollection = mergeAssetIntoCollection(
      collectionManifest,
      assetID,
      assetCid
    );
    mergedCollection.version = (mergedCollection.version || 0) + 1;
    mergedCollection.prev_asset_manifest_cid = existingCollectionTokenId
      ? await (walletContract || walletState.get().contract).methods
          .tokenURI(String(existingCollectionTokenId))
          .call()
      : null;

    const { cid: collectionCid } = await saveManifest(mergedCollection, {
      publishContext: null,
    });

    if (existingCollectionTokenId) {
      const tokenId = existingCollectionTokenId;
      const editorList = await _loadEditorList(tokenId);
      if (!editorList) throw new Error("Cannot find editor list");
      const currentVersion = await _getEditorSetVersion(tokenId);
      const proofResult = getProof(
        editorList,
        walletAddr,
        tokenId,
        currentVersion
      );
      if (!proofResult) throw new Error("Not an authorized editor");
      const txHash = await updateAssetURI(tokenId, collectionCid, proofResult.proof);
      if (!txHash) throw new Error("Republish transaction failed");
      updateUrlAsset(tokenId);
      announceStatus("Collection republished successfully.");
    } else {
      const tokenId =
        "0x" +
        Array.from(collectionCid)
          .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
          .toString(16)
          .replace(/^-/, "");
      const editorList = [
        { address: walletAddr, role: CollaboratorRole.Editor },
      ];
      const editorRoot = computeRoot(editorList, tokenId, 1);
      const editorListUri = _saveEditorListLocally(tokenId, editorList, null);
      const txHash = await publishAsset(
        collectionCid,
        tokenId,
        editorRoot,
        editorListUri || ""
      );
      if (!txHash) throw new Error("Publish transaction failed");
      assetState.set({ activeCollectionTokenId: tokenId, activeAssetTokenId: tokenId });
      updateUrlAsset(tokenId);

      const { showAssetEditors } = await import("./asset-editors.js");
      showAssetEditors(tokenId);
      announceStatus("Default collection published and minted.");
    }
```

This keeps the rest of `onPublishAsset` (the surrounding `try`/`catch`/`finally`, status announcements, `EVENTS.ASSET_PUBLISHED` emit at the end) unchanged — only the body between `result.ok` check and the trailing `emit(...)` call is replaced.

- [ ] **Step 5: Run tests**

Run: `npm run test -- asset-save-collection.test.js`
Expected: PASS — unaffected by the wiring change (inline copies remain in sync; re-read both side by side to confirm no drift, same as Task 2 Step 4).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/ui/asset-save.js frontend/src/js/state/asset-state.js test/asset-save-collection.test.js
git commit -m "feat(asset-save): besk now publishes the collection manifest, lazily minting a default collection on first besk"
```

---

### Task 5: asset-library.js — gallery expands collections into per-asset cards

**Files:**
- Modify: `frontend/src/js/ui/asset-library.js` (card rendering, `expandTokenToAssets`)
- Test: `test/library-collection-cards.test.js` (new file, inline-copy pattern)

**Interfaces:**
- Consumes: collection manifest shape from Task 1 (`{type: "collection", assets: {...}}`).
- Produces: `expandTokenToAssets(tokenId)` → `Array<{tokenId, assetId, manifestCid, collectionCid, name, thumbnail, isCollection}>`; the Studio sidebar Gallery and the standalone Library page render one card per asset inside a collection, falling back to one card for legacy single-asset tokens.

> **Implemented as:** The live `asset-library.js` does not render a single "collection card." Instead, `expandTokenToAssets` fetches the collection manifest and returns one entry per `assets` entry, resolving each asset's name/thumbnail. The standalone Library page (`frontend/src/js/library-init.js` + `library-grid.js`) uses these entries to browse collections and assets. The `buildCollectionCardSummary` helper described below was not retained in the live UI.

- [ ] **Step 1: Write the failing test**

Create `test/library-collection-cards.test.js`:

```javascript
/** Inline copy of buildCollectionCardSummary from frontend/src/js/ui/asset-library.js */
function buildCollectionCardSummary(manifest, tokenId) {
  const assetCount = manifest?.assets
    ? Object.keys(manifest.assets).length
    : 0;
  return {
    tokenId: String(tokenId),
    name: manifest?.name || `Collection #${tokenId}`,
    assetCount,
    thumbnailCid: manifest?.thumbnail?.cid || null,
  };
}

describe("asset-library — buildCollectionCardSummary", () => {
  it("counts assets in the collection's assets map", () => {
    const manifest = {
      type: "collection",
      assets: { "chair-01": "bafy1", "room-01": "bafy2" },
    };
    expect(buildCollectionCardSummary(manifest, "42")).toEqual({
      tokenId: "42",
      name: "Collection #42",
      assetCount: 2,
      thumbnailCid: null,
    });
  });

  it("uses the manifest name and thumbnail when present", () => {
    const manifest = {
      type: "collection",
      name: "My Garden",
      assets: { "tree-01": "bafy1" },
      thumbnail: { cid: "bafyThumb" },
    };
    expect(buildCollectionCardSummary(manifest, "7")).toEqual({
      tokenId: "7",
      name: "My Garden",
      assetCount: 1,
      thumbnailCid: "bafyThumb",
    });
  });

  it("handles a missing assets map as zero assets", () => {
    expect(buildCollectionCardSummary({}, "1").assetCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it's well-formed**

Run: `npm run test -- library-collection-cards.test.js`
Expected: PASS (3/3) — inline copy.

- [ ] **Step 3: Implement and wire into the gallery**

Edit `frontend/src/js/ui/asset-library.js`. Add `buildCollectionCardSummary` near the top-level helper functions (alongside `createAssetCard`, before its definition):

```javascript
/**
 * Summarize a collection manifest for gallery card rendering.
 * Pure function — no I/O.
 */
function buildCollectionCardSummary(manifest, tokenId) {
  const assetCount = manifest?.assets
    ? Object.keys(manifest.assets).length
    : 0;
  return {
    tokenId: String(tokenId),
    name: manifest?.name || `Collection #${tokenId}`,
    assetCount,
    thumbnailCid: manifest?.thumbnail?.cid || null,
  };
}
```

In `loadAssetMetadata()` (around line 391, where the card name is currently set to `${manifest.name || "Unnamed Asset"} #${tokenId}`), replace that line with:

```javascript
    const summary = buildCollectionCardSummary(manifest, tokenId);
    nameEl.textContent = `${summary.name} (${summary.assetCount} asset${
      summary.assetCount === 1 ? "" : "s"
    })`;
```

Add a click-through affordance: when a card is opened (existing click handler — locate the handler that currently calls `openAssetByTokenId(tokenId)`), after resolving the manifest, branch:

```javascript
  const manifest = await getFromRemoteIPFS(cid);
  if (manifest?.type === "collection") {
    const { loadCollectionManifest } = await import("../engine/scene-graph.js");
    const { assetEntries } = await loadCollectionManifest(cid, {
      chainId: walletState.get().chainId,
      contractAddress: walletState.get().contractAddress,
      tokenId,
    });
    emit(EVENTS.COLLECTION_OPENED, { tokenId, assetEntries });
    return;
  }
```

(Place this branch immediately after the existing `tokenURI(tokenId)` → manifest fetch in `openAssetByTokenId`, before whatever code today assumes the manifest is a single asset and loads it directly into the scene.)

- [ ] **Step 4: Run tests**

Run: `npm run test -- library-collection-cards.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/asset-library.js test/library-collection-cards.test.js
git commit -m "feat(gallery): render collection cards with asset counts, open collections via loadCollectionManifest"
```

---

### Task 6: scene-loader.js drop handler — fork vs. live reference

**Files:**
- Modify: `frontend/src/js/engine/scene-loader.js` (`handleLinkedAssetDropped`)
- Test: `test/scene-graph.test.js`

**Interfaces:**
- Consumes: `mergeAssetIntoCollection` is NOT reused here (that's a collection-publish concern at besk time) — this task only decides what *node* gets added to the in-progress scene (`state.pendingChildRefs`).
- Produces: `buildForkOrLiveRefNode(choice, ref, assetID, resolvedManifest)` → a node entry (either a plain `source`-bearing node for `"fork"`, or a `child_ref`-bearing node for `"live-ref"`), pushed onto `state.pendingChildRefs` exactly like today's single-path behavior.

- [ ] **Step 1: Write the failing test**

Add to `test/scene-graph.test.js`:

```javascript
describe("Scene Graph — buildForkOrLiveRefNode", () => {
  /** Inline copy of buildForkOrLiveRefNode from frontend/src/js/engine/scene-loader.js */
  function buildForkOrLiveRefNode(choice, ref, assetID, resolvedAssetCid) {
    const nodeId = `linked_${ref.collectionRef.tokenId}_${assetID}`;
    const baseNode = {
      node_id: nodeId,
      transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };
    if (choice === "fork") {
      return {
        ...baseNode,
        source: { cid: resolvedAssetCid },
      };
    }
    if (choice === "live-ref") {
      return {
        ...baseNode,
        child_ref: { collection: ref.collectionRef, assetID },
      };
    }
    throw new Error(`Unknown fork/live-ref choice: ${choice}`);
  }

  const ref = {
    collectionRef: { chainId: 6343, contractAddress: "0xabc", tokenId: "42" },
  };

  it("fork builds a plain source node with the resolved CID, frozen", () => {
    const node = buildForkOrLiveRefNode("fork", ref, "chair-01", "bafyChairCid");
    expect(node.source).toEqual({ cid: "bafyChairCid" });
    expect(node.child_ref).toBeUndefined();
  });

  it("live-ref builds a child_ref node pointing at the original collection", () => {
    const node = buildForkOrLiveRefNode("live-ref", ref, "chair-01", "bafyChairCid");
    expect(node.child_ref).toEqual({
      collection: ref.collectionRef,
      assetID: "chair-01",
    });
    expect(node.source).toBeUndefined();
  });

  it("throws on an unknown choice", () => {
    expect(() => buildForkOrLiveRefNode("bogus", ref, "chair-01", "cid")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it's well-formed**

Run: `npm run test -- scene-graph.test.js -t "buildForkOrLiveRefNode"`
Expected: PASS (3/3) — inline copy.

- [ ] **Step 3: Implement and wire into the drop handler**

Edit `frontend/src/js/engine/scene-loader.js`. Add `buildForkOrLiveRefNode` above `handleLinkedAssetDropped`:

```javascript
/**
 * Build the scene node to add when a user pulls in another collection's
 * asset. "fork" freezes the asset's current CID into a plain source node;
 * "live-ref" embeds a child_ref pointing back at the original collection,
 * so future edits there propagate automatically.
 */
function buildForkOrLiveRefNode(choice, ref, assetID, resolvedAssetCid) {
  const nodeId = `linked_${ref.collectionRef.tokenId}_${assetID}`;
  const baseNode = {
    node_id: nodeId,
    transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
  if (choice === "fork") {
    return {
      ...baseNode,
      source: { cid: resolvedAssetCid },
    };
  }
  if (choice === "live-ref") {
    return {
      ...baseNode,
      child_ref: { collection: ref.collectionRef, assetID },
    };
  }
  throw new Error(`Unknown fork/live-ref choice: ${choice}`);
}
```

In `handleLinkedAssetDropped`, this task only applies when the drop event carries an `assetID` (i.e. dropping a specific asset *from inside* a collection, not the whole-collection drop already handled by the existing `child_ref.type === "token"` path). Add a new branch at the top of the function (right after the `if (!tokenId) return;` guard at line 968):

```javascript
  if (detail.assetID) {
    const { showForkOrLiveRefDialog } = await import("../ui/dialog.js");
    const choice = await showForkOrLiveRefDialog(detail.assetID);
    if (!choice) return; // user cancelled

    const { resolveCollectionChildRef } = await import(
      "../blockchain/token-resolver.js"
    );
    const collectionRef = {
      chainId: Number(eventChainId || walletState.get().chainId),
      contractAddress: eventContractAddress || walletState.get().contractAddress,
      tokenId,
    };
    const resolution = await resolveCollectionChildRef(
      { collection: collectionRef, assetID: detail.assetID },
      null
    );
    if (!resolution.resolved || !resolution.manifestCid) {
      console.warn(
        `[SCENE] could not resolve dropped asset ${detail.assetID}: ${resolution.error}`
      );
      return;
    }

    const nodeEntry = buildForkOrLiveRefNode(
      choice,
      { collectionRef },
      detail.assetID,
      resolution.manifestCid
    );
    state.pendingChildRefs.push(nodeEntry);
    disposeNode(nodeEntry.node_id);

    const parentNode = state.rootSceneAnchor || state.scene;
    if (choice === "live-ref") {
      await loadTokenChildNode(nodeEntry, parentNode, 1, new Set());
    } else {
      await loadAsset(nodeEntry.source, parentNode, nodeEntry.node_id);
    }
    return;
  }
```

`showForkOrLiveRefDialog` is a small new UI helper — out of scope for this task's test coverage (it's a thin DOM dialog), but must exist for this branch to run. Add it to `frontend/src/js/ui/dialog.js` as a thin wrapper around the existing `showDialog`-style confirm pattern already used elsewhere in that file (e.g. mirroring `showDialog`'s two-button confirm variant); wire its two buttons to resolve `"fork"` / `"live-ref"` respectively, and resolve `null` on cancel.

- [ ] **Step 4: Run tests**

Run: `npm run test -- scene-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/engine/scene-loader.js frontend/src/js/ui/dialog.js test/scene-graph.test.js
git commit -m "feat(scene-loader): support fork vs live-reference when adding another collection's asset to a scene"
```

---

### Task 7: e2e/helpers/manifest.mjs — collection-shaped fixtures and assertions

**Files:**
- Modify: `e2e/helpers/manifest.mjs`

**Interfaces:**
- Produces: `assertCollectionManifest(manifest, { expectedAssetIds })` — new assertion helper, alongside the existing `assertGenerationManifest`/`assertSavedManifest`/`assertPublishedManifest`/`assertCommentsArchive`.

- [ ] **Step 1: Add the new assertion helper**

Edit `e2e/helpers/manifest.mjs`, add after the existing `assertCommentsArchive` (lines 74-79):

```javascript
/**
 * Validate a collection manifest's shape: type, assets map, version chain.
 * Does not assert on individual asset manifest contents — use
 * assertGenerationManifest/assertSavedManifest on the resolved asset CID
 * for that.
 */
export function assertCollectionManifest(manifest, { expectedAssetIds } = {}) {
  if (manifest.type !== "collection") {
    throw new Error(`Expected type "collection", got "${manifest.type}"`);
  }
  if (!manifest.assets || typeof manifest.assets !== "object") {
    throw new Error("Collection manifest missing assets object");
  }
  if (typeof manifest.version !== "number" || manifest.version < 1) {
    throw new Error(`Expected version >= 1, got ${manifest.version}`);
  }
  if (expectedAssetIds) {
    const actualIds = Object.keys(manifest.assets).sort();
    const expected = [...expectedAssetIds].sort();
    if (JSON.stringify(actualIds) !== JSON.stringify(expected)) {
      throw new Error(
        `Expected assetIds ${JSON.stringify(expected)}, got ${JSON.stringify(actualIds)}`
      );
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/helpers/manifest.mjs
git commit -m "test(e2e): add assertCollectionManifest helper for collection-shaped manifest fixtures"
```

---

### Task 8: E2E specs — same-collection sibling references, fork vs. live-ref, default collection lazy-mint

**Files:**
- Create: `e2e/specs/07-collection-assets.spec.js` (split into `07a` and `07b` in the live suite; `08-fork-live-ref.spec.js` covers fork vs. live-ref)

**Interfaces:**
- Consumes: `assertCollectionManifest` from Task 7, existing `studio-selectors.mjs` helpers, existing free-tier generation flow from spec `02`.

- [ ] **Step 1: Write the spec**

Create `e2e/specs/07-collection-assets.spec.js`:

```javascript
import { test, expect } from "@playwright/test";
import { connectWallet } from "../helpers/wallet.mjs";
import { generateAsset } from "../helpers/generation.mjs";
import { fetchManifest, fetchTokenManifest, assertCollectionManifest } from "../helpers/manifest.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

test.describe("Collection/asset model", () => {
  test("first besk lazily mints a default collection containing one asset", async ({ page }) => {
    await page.goto("/");
    await connectWallet(page);
    await generateAsset(page, { prompt: "a wooden chair" });

    await page.click(SELECTORS.publishButton);
    await page.waitForSelector(SELECTORS.assetTokenIdLabel);

    const tokenIdText = await page.textContent(SELECTORS.assetTokenIdLabel);
    const tokenId = tokenIdText.match(/#(\w+)/)[1];

    const collectionManifest = await fetchTokenManifest(tokenId);
    assertCollectionManifest(collectionManifest, { expectedAssetIds: undefined });
    expect(Object.keys(collectionManifest.assets)).toHaveLength(1);

    const [assetCid] = Object.values(collectionManifest.assets);
    const assetManifest = await fetchManifest(assetCid);
    expect(assetManifest.type).toBe("asset");
    expect(assetManifest.scene.nodes).toHaveLength(1);
  });

  test("a second besk in the same collection adds a sibling assetID without disturbing the first", async ({ page }) => {
    await page.goto("/");
    await connectWallet(page);
    await generateAsset(page, { prompt: "a wooden chair" });
    await page.click(SELECTORS.publishButton);
    await page.waitForSelector(SELECTORS.assetTokenIdLabel);
    const firstTokenId = (await page.textContent(SELECTORS.assetTokenIdLabel)).match(/#(\w+)/)[1];
    const firstCollection = await fetchTokenManifest(firstTokenId);
    const firstAssetIds = Object.keys(firstCollection.assets);

    await page.click(SELECTORS.newAssetButton);
    await generateAsset(page, { prompt: "a small round table" });
    await page.click(SELECTORS.publishButton);
    await page.waitForSelector(SELECTORS.assetTokenIdLabel);
    const secondTokenId = (await page.textContent(SELECTORS.assetTokenIdLabel)).match(/#(\w+)/)[1];

    // Same default collection — same tokenId — now has two assetIDs.
    expect(secondTokenId).toBe(firstTokenId);
    const updatedCollection = await fetchTokenManifest(secondTokenId);
    expect(Object.keys(updatedCollection.assets)).toHaveLength(firstAssetIds.length + 1);
    for (const id of firstAssetIds) {
      expect(updatedCollection.assets[id]).toBe(firstCollection.assets[id]);
    }
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test --config=e2e/playwright.config.js --project=chromium e2e/specs/07-collection-assets.spec.js`
Expected: PASS, once Tasks 1-6 are merged. If `SELECTORS.assetTokenIdLabel` / `SELECTORS.newAssetButton` don't exist yet in `e2e/helpers/studio-selectors.mjs`, add them pointing at the existing `#assetStatusMeta`/`#newAssetBtn` elements (per `AGENTS.md §10`'s "update studio-selectors.mjs when any referenced id changes" rule) before running.

> **Implemented as:** Collection-asset coverage is spread across `e2e/specs/03-save-and-publish.spec.js`, `05-republish.spec.js`, `06-nesting.spec.js`, `07a-library-asset-cards.spec.js`, `07b-material-editor-multi-primitive.spec.js`, `08-fork-live-ref.spec.js`, and `11-library-studio-roundtrip.spec.js`.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/07-collection-assets.spec.js e2e/helpers/studio-selectors.mjs
git commit -m "test(e2e): cover default collection lazy-mint and same-collection sibling assetID besks"
```

---

## Self-Review Notes

- **Spec coverage:** Terminology (Task 4 type tags), manifest schema (Tasks 1, 3), resolution algorithm (Tasks 2, 3), fork/live-ref UX (Task 6), editor scope (no contract change — Task 4 reuses existing `editorRoot`/`updateAssetURI` unchanged), default collection (Task 4's lazy-mint branch), error handling/cycle protection (Task 3's self-reference + depth guards), testing impact (Tasks 7-8). Nested-collection traversal (`resolution.nestedCollectionRef` in Task 2/3) covers point 5's "collection within collection" case structurally, though a dedicated E2E test for *that* specific nesting depth was not added in Task 8 — flagged as a follow-up if nested collections become a near-term priority.
- **Type consistency:** `resolveCollectionChildRef`'s return shape (`manifestCid`, `manifest`, `resolved`, `error`, `fromCache`, plus optional `nestedCollectionRef`) matches what Task 3's `loadTokenChildNode` destructures. `mergeAssetIntoCollection`'s output (`{type: "collection", assets: {...}, version, ...}`) matches what Task 1's backend validates (`manifest.assets` must be a plain object) and what Task 5's `buildCollectionCardSummary` reads (`manifest.assets`, `manifest.name`, `manifest.thumbnail.cid`).
- **No placeholders:** All steps contain complete code; the one explicitly deferred detail (`showForkOrLiveRefDialog`'s DOM implementation in Task 6 Step 3) is scoped as "mirror the existing `showDialog` two-button pattern already in `dialog.js`" rather than a bare TODO, since `dialog.js`'s exact current button-variant API wasn't read in this research pass — flag this file for a quick read at execution time before implementing that one helper.
