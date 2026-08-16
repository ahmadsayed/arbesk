# Asset Domain Model — Phase 1: Facade + Single-Writer Chrome

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the `domain/` struct layer (AssetRef, Node, Asset facade) and make the header title/meta + save/publish/download buttons render from exactly one module, eliminating direct DOM writes to the chrome from feature modules.

**Architecture:** Big structs (JSDoc typedefs, plain objects) + module functions, no classes/inheritance. `domain/asset.ts` is a facade over the legacy `assetState` store (readers keep working); it is the only writer of the asset *name* and the single subscription point. New `ui/asset-chrome.ts` renders the header and buttons purely from store state — no event-ordering dependence.

**Tech Stack:** ESM JS, Jest (jsdom), Pug, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-08-09-asset-domain-model-design.md`

**Scope refinement vs spec (controller-noted):** CID/tokenId fields (`activeAssetManifestCid`, `latestAssetManifestCid`, `activeAssetTokenId`, …) stay on `assetState` in Phase 1 — privatizing them without the save/publish commands (Phase 2) would only create pass-through churn. Phase 1 privatizes the **name** and the **chrome**.

## Global Constraints

- Big structs + module functions; **no `class`, no inheritance**; `_`-prefix = module-private by convention; snapshots frozen with `Object.freeze`.
- ESM; CDN global `BABYLON` never imported; camelCase; JSDoc on exported functions; `npm run typecheck:frontend` must pass.
- Behavior preservation: no user-visible change except the removal of ordering bugs. `generatedAsset` in `asset-save.js:72` is a dead read (never set anywhere in `frontend/src`) — the new chrome drops it; document that in the commit message.
- Persisted manifest field names are frozen (`child_ref`, `scene.nodes`, …). Internal event names unchanged.
- **Git commits require explicit user confirmation before running — ask once before the first commit, then batch per task as approved.**
- Run from repo root `/home/ahmedh/Projects/arbesk`. Jest needs `NODE_OPTIONS=--experimental-vm-modules npx jest <path>`.

---

### Task 1: Domain structs — `asset-ref.js` + `node.js`

**Files:**
- Create: `frontend/src/js/domain/asset-ref.ts`
- Create: `frontend/src/js/domain/node.ts`
- Test: `test/frontend/domain-structs.test.js` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `normalizeAssetRef(childRef) → AssetRef|null` where `AssetRef = {collection: {chainId:number, contractAddress:string, tokenId:string} | "self", assetID: string|null}`
  - `assetRefKey(ref) → string` (`chainId:contract:tokenId:assetID`, contract lowercased; `self:<assetID>` for self)
  - `assetRefsEqual(a, b) → boolean`
  - `resolveAssetRef(ref, {resolve, selfAssets}) → Promise<{resolved, manifestCid?, error?}>`
  - `manifestNodeToNode(manifestNode) → Node` where `Node = {nodeId, transformMatrix, source, ref, postProcessor}`
  - `manifestNodes(manifest) → Node[]`

- [ ] **Step 1: Write the failing test**

Create `test/frontend/domain-structs.test.js`:

```js
/**
 * @jest-environment jsdom
 *
 * Domain structs: AssetRef normalization/keys/resolution and manifest→Node
 * mapping. Pure data, no engine, no network (resolver injected).
 */
import { jest, expect, test, describe } from "@jest/globals";
import {
  normalizeAssetRef,
  assetRefKey,
  assetRefsEqual,
  resolveAssetRef,
} from "../../frontend/src/js/domain/asset-ref.ts";
import {
  manifestNodeToNode,
  manifestNodes,
} from "../../frontend/src/js/domain/node.ts";

describe("normalizeAssetRef", () => {
  test("normalizes the current collection shape", () => {
    expect(
      normalizeAssetRef({
        collection: { chainId: 31337, contractAddress: "0xABC", tokenId: "7" },
        assetID: "asset_1",
      })
    ).toEqual({
      collection: { chainId: 31337, contractAddress: "0xABC", tokenId: "7" },
      assetID: "asset_1",
    });
  });

  test("normalizes the self-collection shape", () => {
    expect(normalizeAssetRef({ collection: "self", assetID: "a1" })).toEqual({
      collection: "self",
      assetID: "a1",
    });
  });

  test("normalizes the legacy flat token shape", () => {
    expect(
      normalizeAssetRef({ tokenId: "7", chainId: 31337, contractAddress: "0xABC", resolution: "latest" })
    ).toEqual({
      collection: { chainId: 31337, contractAddress: "0xABC", tokenId: "7" },
      assetID: null,
    });
  });

  test("returns null for garbage", () => {
    expect(normalizeAssetRef(null)).toBeNull();
    expect(normalizeAssetRef({})).toBeNull();
    expect(normalizeAssetRef("x")).toBeNull();
  });
});

describe("assetRefKey / assetRefsEqual", () => {
  test("key is chainId:contract:tokenId:assetID with lowercased contract", () => {
    const ref = normalizeAssetRef({
      collection: { chainId: 31337, contractAddress: "0xABC", tokenId: "7" },
      assetID: "asset_1",
    });
    expect(assetRefKey(ref)).toBe("31337:0xabc:7:asset_1");
  });

  test("self refs key as self:<assetID>", () => {
    expect(assetRefKey({ collection: "self", assetID: "a1" })).toBe("self:a1");
  });

  test("equal ignores contract case; nulls only equal nulls", () => {
    const a = normalizeAssetRef({ collection: { chainId: 1, contractAddress: "0xABC", tokenId: "1" }, assetID: "x" });
    const b = normalizeAssetRef({ collection: { chainId: 1, contractAddress: "0xabc", tokenId: "1" }, assetID: "x" });
    expect(assetRefsEqual(a, b)).toBe(true);
    expect(assetRefsEqual(null, null)).toBe(true);
    expect(assetRefsEqual(a, null)).toBe(false);
  });
});

describe("resolveAssetRef", () => {
  test("delegates cross-collection refs with null assets map", async () => {
    const resolve = jest.fn().mockResolvedValue({ resolved: true, manifestCid: "bafyX" });
    const ref = normalizeAssetRef({ collection: { chainId: 1, contractAddress: "0xabc", tokenId: "1" }, assetID: "x" });
    const out = await resolveAssetRef(ref, { resolve });
    expect(resolve).toHaveBeenCalledWith(
      { collection: { chainId: 1, contractAddress: "0xabc", tokenId: "1" }, assetID: "x" },
      null
    );
    expect(out.manifestCid).toBe("bafyX");
  });

  test("passes the self assets map for self refs", async () => {
    const resolve = jest.fn().mockResolvedValue({ resolved: true, manifestCid: "bafyY" });
    const selfAssets = { x: "bafyY" };
    await resolveAssetRef({ collection: "self", assetID: "x" }, { resolve, selfAssets });
    expect(resolve).toHaveBeenCalledWith({ collection: "self", assetID: "x" }, selfAssets);
  });
});

describe("manifestNodeToNode / manifestNodes", () => {
  test("maps a geometry node", () => {
    const node = manifestNodeToNode({
      node_id: "n1",
      transform_matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 5,6,7,1],
      source: { cid: "bafyS", path: "composite.gltf", format: "gltf" },
      post_processor: { scale: { x: 2, y: 2, z: 2 } },
    });
    expect(node.nodeId).toBe("n1");
    expect(node.transformMatrix).toHaveLength(16);
    expect(node.transformMatrix[12]).toBe(5);
    expect(node.source.cid).toBe("bafyS");
    expect(node.ref).toBeNull();
    expect(node.postProcessor.scale.x).toBe(2);
  });

  test("maps a child_ref node to a ref", () => {
    const node = manifestNodeToNode({
      node_id: "n2",
      transform_matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
      child_ref: { collection: "self", assetID: "a1" },
    });
    expect(node.source).toBeNull();
    expect(node.ref).toEqual({ collection: "self", assetID: "a1" });
  });

  test("defaults a missing transform_matrix to identity", () => {
    const node = manifestNodeToNode({ node_id: "n3" });
    expect(node.transformMatrix).toEqual([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  });

  test("manifestNodes returns [] for empty/garbage manifests", () => {
    expect(manifestNodes(null)).toEqual([]);
    expect(manifestNodes({ scene: { nodes: [] } })).toEqual([]);
    expect(manifestNodes({ scene: { nodes: [{ node_id: "a" }, { node_id: "b" }] } }).map((n) => n.nodeId)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-structs.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/js/domain/asset-ref.ts`:

```js
// @ts-check
/**
 * Domain: AssetRef — one asset referencing another (the tree edge).
 * Wraps the persisted `child_ref` manifest shape. IO-free: resolution goes
 * through an injected resolver.
 */

/**
 * @typedef {Object} AssetRefCollection
 * @property {number} chainId
 * @property {string} contractAddress
 * @property {string} tokenId
 */

/**
 * @typedef {Object} AssetRef
 * @property {AssetRefCollection|"self"} collection
 * @property {string|null} assetID
 */

/**
 * Normalize the persisted child_ref shapes (current collection form and the
 * legacy flat token form) into a canonical AssetRef.
 * @param {any} childRef
 * @returns {AssetRef|null}
 */
export function normalizeAssetRef(childRef) {
  if (!childRef || typeof childRef !== "object") return null;
  if (childRef.collection === "self") {
    return { collection: "self", assetID: childRef.assetID ?? null };
  }
  const c =
    childRef.collection && typeof childRef.collection === "object"
      ? childRef.collection
      : childRef.tokenId != null && childRef.chainId != null && childRef.contractAddress
        ? childRef // legacy flat shape: {tokenId, chainId, contractAddress, resolution}
        : null;
  if (!c) return null;
  return {
    collection: {
      chainId: Number(c.chainId),
      contractAddress: String(c.contractAddress || ""),
      tokenId: String(c.tokenId),
    },
    assetID: childRef.assetID ?? null,
  };
}

/**
 * Canonical identity key: chainId:contract:tokenId:assetID (contract
 * lowercased). Self refs key as self:<assetID> — meaningful only within the
 * currently open collection.
 * @param {AssetRef} ref
 * @returns {string}
 */
export function assetRefKey(ref) {
  if (ref.collection === "self") return `self:${ref.assetID ?? ""}`;
  const c = ref.collection;
  return `${c.chainId}:${c.contractAddress.toLowerCase()}:${c.tokenId}:${ref.assetID ?? ""}`;
}

/**
 * @param {AssetRef|null} a
 * @param {AssetRef|null} b
 * @returns {boolean}
 */
export function assetRefsEqual(a, b) {
  if (!a || !b) return a === b;
  return assetRefKey(a) === assetRefKey(b);
}

/**
 * Resolve a ref to the manifest CID it currently points at. The resolver is
 * injected (`resolveCollectionChildRef` from blockchain/token-resolver.ts in
 * the app, a fake in tests).
 * @param {AssetRef} ref
 * @param {{resolve: (childRef: any, selfAssets: any) => Promise<any>, selfAssets?: any}} deps
 * @returns {Promise<any>} the resolver's {resolved, manifestCid?, error?} result
 */
export function resolveAssetRef(ref, deps) {
  const childRef =
    ref.collection === "self"
      ? { collection: "self", assetID: ref.assetID }
      : { collection: ref.collection, assetID: ref.assetID };
  return deps.resolve(
    childRef,
    ref.collection === "self" ? deps.selfAssets ?? null : null
  );
}
```

Create `frontend/src/js/domain/node.ts`:

```js
// @ts-check
/**
 * Domain: Node — one placement inside an asset's tree. Pure data mirroring a
 * manifest `scene.nodes[]` entry. Engine runtime objects (anchors, meshes,
 * animation groups) never live here; the engine keys its maps by nodeId.
 */
import { normalizeAssetRef } from "./asset-ref.js";

/**
 * @typedef {Object} Node
 * @property {string} nodeId
 * @property {number[]} transformMatrix - 16-element column-major matrix
 * @property {{cid: string, path?: string, format?: string}|null} source
 * @property {import("./asset-ref.js").AssetRef|null} ref
 * @property {object|null} postProcessor
 */

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Map one persisted manifest node to a domain Node.
 * @param {any} manifestNode
 * @returns {Node}
 */
export function manifestNodeToNode(manifestNode) {
  return {
    nodeId: String(manifestNode?.node_id ?? ""),
    transformMatrix: Array.isArray(manifestNode?.transform_matrix)
      ? [...manifestNode.transform_matrix]
      : [...IDENTITY_MATRIX],
    source: manifestNode?.source ?? null,
    ref: normalizeAssetRef(manifestNode?.child_ref),
    postProcessor: manifestNode?.post_processor ?? null,
  };
}

/**
 * @param {any} manifest
 * @returns {Node[]}
 */
export function manifestNodes(manifest) {
  const nodes = manifest?.scene?.nodes;
  return Array.isArray(nodes) ? nodes.map(manifestNodeToNode) : [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-structs.test.js`
Expected: PASS (11 tests). Also `npm run typecheck:frontend` — clean.

- [ ] **Step 5: Commit** (after user confirmation)

```bash
git add frontend/src/js/domain/asset-ref.ts frontend/src/js/domain/node.ts test/frontend/domain-structs.test.js
git commit -m "feat(domain): AssetRef + Node structs for the asset tree"
```

---

### Task 2: `domain/asset.ts` facade — single writer for the asset name

**Files:**
- Create: `frontend/src/js/domain/asset.ts`
- Test: `test/frontend/domain-asset.test.js` (new)

**Interfaces:**
- Consumes: `assetState` (`state/asset-state.js`), `getStateForNewAsset` (`utils/new-asset.ts`), real event bus (mitt — no mocks needed).
- Produces (Task 3 relies on these exact names):
  - `getAssetSnapshot() → Readonly<{name, assetId, tokenId, activeCid, latestCid}>`
  - `subscribeAsset(fn) → unsubscribe` (fn called immediately with current snapshot, then on every `ASSET_STATE_CHANGED`)
  - `renameAsset(name)` — the ONLY writer of `activeAssetName`
  - `adoptLoadedManifestName(manifest)` — the SCENE_READY naming rule
  - `adoptManifestName(manifest)` — the non-clobbering rule (moved from `asset-save.js:137`; keep `isDefaultAssetName` exported)
  - `resetForNewAsset()` — clears name + CIDs, preserves collection ids
  - `closeAsset()` — clears name, tokenId, assetId, CIDs, currentManifest

- [ ] **Step 1: Write the failing test**

Create `test/frontend/domain-asset.test.js`:

```js
/**
 * @jest-environment jsdom
 *
 * Domain asset facade: snapshot immutability, subscribe/notify, and the
 * naming rules (rename, loaded-manifest adoption, new-asset reset, close).
 */
import { expect, test, beforeEach } from "@jest/globals";
import {
  getAssetSnapshot,
  subscribeAsset,
  renameAsset,
  adoptLoadedManifestName,
  adoptManifestName,
  isDefaultAssetName,
  resetForNewAsset,
  closeAsset,
} from "../../frontend/src/js/domain/asset.ts";
import { assetState, _resetForTesting } from "../../frontend/src/js/state/asset-state.js";

beforeEach(() => _resetForTesting());

test("snapshot is frozen and reflects the store", () => {
  assetState.set({ activeAssetName: "Chair", activeAssetTokenId: "7" });
  const snap = getAssetSnapshot();
  expect(snap.name).toBe("Chair");
  expect(snap.tokenId).toBe("7");
  expect(Object.isFrozen(snap)).toBe(true);
  expect(() => { snap.name = "x"; }).toThrow();
});

test("subscribeAsset fires immediately and on every store change", () => {
  const seen = [];
  const unsub = subscribeAsset((s) => seen.push(s.name));
  expect(seen).toEqual([null]);
  renameAsset("Table");
  expect(seen).toEqual([null, "Table"]);
  unsub();
  renameAsset("Lamp");
  expect(seen).toEqual([null, "Table"]);
});

test("adoptLoadedManifestName: manifest name wins, else keep, else Untitled", () => {
  assetState.set({ activeAssetName: "Session Name" });
  adoptLoadedManifestName({ name: "Manifest Name" });
  expect(assetState.get().activeAssetName).toBe("Manifest Name");

  _resetForTesting();
  adoptLoadedManifestName({ name: "Manifest Name" });
  expect(assetState.get().activeAssetName).toBe("Manifest Name");

  _resetForTesting();
  assetState.set({ activeAssetName: "Session Name" });
  adoptLoadedManifestName({}); // no manifest name → keep session name
  expect(assetState.get().activeAssetName).toBe("Session Name");

  _resetForTesting();
  adoptLoadedManifestName({}); // nothing anywhere → Untitled Asset
  expect(assetState.get().activeAssetName).toBe("Untitled Asset");
});

test("adoptManifestName never clobbers a good name with a default", () => {
  assetState.set({ activeAssetName: "My Chair" });
  adoptManifestName({ name: "Untitled Asset" });
  expect(assetState.get().activeAssetName).toBe("My Chair");
  adoptManifestName({ name: "Real Name" });
  expect(assetState.get().activeAssetName).toBe("Real Name");
  expect(isDefaultAssetName("  untitled asset ")).toBe(true);
  expect(isDefaultAssetName("My Chair")).toBe(false);
});

test("resetForNewAsset clears name and CIDs but preserves the collection", () => {
  assetState.set({
    activeAssetName: "Old",
    activeAssetManifestCid: "bafyOld",
    latestAssetManifestCid: "bafyOld",
    activeAssetTokenId: "42",
    activeAssetId: "a1",
    activeCollectionTokenId: "7",
  });
  resetForNewAsset();
  const s = assetState.get();
  expect(s.activeAssetName).toBeNull();
  expect(s.activeAssetManifestCid).toBeNull();
  expect(s.activeAssetTokenId).toBeNull();
  expect(s.activeCollectionTokenId).toBe("7");
});

test("closeAsset clears all active-asset identity fields", () => {
  assetState.set({
    activeAssetName: "Old",
    activeAssetManifestCid: "bafyOld",
    latestAssetManifestCid: "bafyOld",
    activeAssetTokenId: "42",
    activeAssetId: "a1",
    currentManifest: { type: "asset" },
  });
  closeAsset();
  const s = assetState.get();
  expect(s.activeAssetName).toBeNull();
  expect(s.activeAssetManifestCid).toBeNull();
  expect(s.latestAssetManifestCid).toBeNull();
  expect(s.activeAssetTokenId).toBeNull();
  expect(s.activeAssetId).toBeNull();
  expect(s.currentManifest).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-asset.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/js/domain/asset.ts`:

```js
// @ts-check
/**
 * Domain: Asset — the one open asset. Facade over the legacy assetState
 * store: this module is the ONLY writer of the asset name and the single
 * subscription point for chrome rendering. CID/tokenId fields still flow
 * through assetState directly (privatized in Phase 2 with the save/publish
 * commands).
 */
import { on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { getStateForNewAsset } from "../utils/new-asset.js";

/** @type {Set<(snapshot: Readonly<AssetSnapshot>) => void>} */
const _listeners = new Set();

/**
 * @typedef {Object} AssetSnapshot
 * @property {string|null} name
 * @property {string|null} assetId
 * @property {string|null} tokenId
 * @property {string|null} activeCid
 * @property {string|null} latestCid
 */

/**
 * Frozen point-in-time view of the active asset for renderers.
 * @returns {Readonly<AssetSnapshot>}
 */
export function getAssetSnapshot() {
  const s = assetState.get();
  return Object.freeze({
    name: s.activeAssetName,
    assetId: s.activeAssetId,
    tokenId: s.activeAssetTokenId,
    activeCid: s.activeAssetManifestCid,
    latestCid: s.latestAssetManifestCid,
  });
}

/**
 * Subscribe to asset changes. Fires immediately with the current snapshot,
 * then on every ASSET_STATE_CHANGED.
 * @param {(snapshot: Readonly<AssetSnapshot>) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribeAsset(fn) {
  _listeners.add(fn);
  fn(getAssetSnapshot());
  return () => _listeners.delete(fn);
}

on(EVENTS.ASSET_STATE_CHANGED, () => {
  const snapshot = getAssetSnapshot();
  for (const fn of _listeners) fn(snapshot);
});

const DEFAULT_NAMES = new Set([
  "untitled asset",
  "my asset",
  "no asset open",
  "",
]);

/**
 * @param {string|null|undefined} name
 * @returns {boolean}
 */
export function isDefaultAssetName(name) {
  return DEFAULT_NAMES.has((name || "").toLowerCase().trim());
}

/**
 * Rename the active asset. The only writer of activeAssetName.
 * @param {string} name
 */
export function renameAsset(name) {
  assetState.set({ activeAssetName: name });
}

/**
 * Naming rule for a freshly loaded manifest (SCENE_READY): the manifest's
 * name wins; with no manifest name keep the session name; with neither,
 * fall back to "Untitled Asset".
 * @param {any} manifest
 */
export function adoptLoadedManifestName(manifest) {
  const current = assetState.get().activeAssetName;
  const name = manifest?.name || current || "Untitled Asset";
  if (manifest?.name || !current) {
    assetState.set({ activeAssetName: name });
  }
}

/**
 * Naming rule for chat-driven auto-saves: adopt the manifest's name only
 * when it is a real name — a default/absent name must not clobber a good
 * session name. (Moved verbatim from ui/asset-save.ts.)
 * @param {any} manifest
 */
export function adoptManifestName(manifest) {
  const name = manifest?.name?.trim();
  if (name && !isDefaultAssetName(name)) {
    assetState.set({ activeAssetName: name });
  }
}

/**
 * Clear the active asset for a fresh draft: name, CIDs, token identity go;
 * the open collection context survives (getStateForNewAsset semantics).
 */
export function resetForNewAsset() {
  assetState.set({
    ...getStateForNewAsset(assetState.get()),
    activeAssetName: null,
  });
}

/**
 * Close the active asset entirely (library close-out).
 */
export function closeAsset() {
  assetState.set({
    activeAssetManifestCid: null,
    latestAssetManifestCid: null,
    activeAssetTokenId: null,
    activeAssetId: null,
    activeAssetName: null,
    currentManifest: null,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/domain-asset.test.js`
Expected: PASS (6 tests). Also `npm run typecheck:frontend` — clean.

- [ ] **Step 5: Commit** (after user confirmation)

```bash
git add frontend/src/js/domain/asset.ts test/frontend/domain-asset.test.js
git commit -m "feat(domain): asset facade — single writer for the asset name"
```

---

### Task 3: `ui/asset-chrome.ts` — the single chrome renderer + rewiring

**Files:**
- Create: `frontend/src/js/ui/asset-chrome.ts`
- Modify: `frontend/src/pug/app.pug:478` (script tag after `asset-save.js`)
- Modify: `frontend/src/js/ui/asset-save.ts` (delete chrome code; use domain functions)
- Modify: `frontend/src/js/engine/scene-graph.ts:839-880` (`startNewAsset` uses domain, no DOM writes)
- Modify: `frontend/src/js/ui/asset-library.ts:1022-1027` (close-out uses `closeAsset()`)
- Test: `test/frontend/asset-chrome.test.js` (new)

**Interfaces:**
- Consumes: Task 2's `subscribeAsset`, `renameAsset`, `adoptLoadedManifestName`, `adoptManifestName`, `isDefaultAssetName`, `resetForNewAsset`, `closeAsset`.
- Produces: chrome ownership contract — only `asset-chrome.js` writes `#assetStatusName`, `#assetStatusMeta`, and the `hidden` property of `#saveAssetBtn`/`#publishAssetBtn`/`#downloadAssetBtn`.

**Current behavior to preserve exactly:**
- Header: no name + no asset → `No asset open` / `Create or open an asset`; name set → name / (`Published` if `activeAssetTokenId` else `Draft Scene`).
- Buttons: `save`/`publish` visible ⇔ `hasAsset && hasWallet`; `download` visible ⇔ `hasAsset`. `hasAsset = activeAssetManifestCid || pendingChildRefs.length > 0` (the `generatedAsset` read at `asset-save.js:72` is dead — never set in `frontend/src` — drop it).

- [ ] **Step 1: Write the failing test**

Create `test/frontend/asset-chrome.test.js`:

```js
/**
 * @jest-environment jsdom
 *
 * Asset chrome: the single renderer for header title/meta and button
 * visibility. State-driven — no event-ordering assumptions.
 */
import { jest, expect, test, beforeAll, beforeEach } from "@jest/globals";

let assetState, _resetAssets, walletState, emit, EVENTS;
let renameAsset, resetForNewAsset, closeAsset;

function title() {
  return document.getElementById("assetStatusName").textContent;
}
function meta() {
  return document.getElementById("assetStatusMeta").textContent;
}
function hidden(id) {
  return document.getElementById(id).hidden;
}

beforeAll(async () => {
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/cleanup.ts",
    () => ({ getPendingChildRefs: () => [] })
  );
  document.body.innerHTML = `
    <span id="assetStatusName">No asset open</span>
    <span id="assetStatusMeta">Create or open an asset</span>
    <button id="saveAssetBtn" hidden></button>
    <button id="saveAssetBtnText"></button>
    <button id="publishAssetBtn" hidden></button>
    <button id="publishAssetBtnText"></button>
    <button id="downloadAssetBtn" hidden></button>`;
  ({ assetState, _resetForTesting: _resetAssets } = await import(
    "../../frontend/src/js/state/asset-state.js"
  ));
  ({ walletState } = await import(
    "../../frontend/src/js/state/wallet-state.ts"
  ));
  ({ emit, EVENTS } = await import("../../frontend/src/js/events/bus.ts"));
  ({ renameAsset, resetForNewAsset, closeAsset } = await import(
    "../../frontend/src/js/domain/asset.ts"
  ));
  await import("../../frontend/src/js/ui/asset-chrome.ts");
});

beforeEach(() => {
  _resetAssets();
  walletState.set({ walletAddress: null });
  emit(EVENTS.WALLET_STATE_CHANGED, walletState.get());
});

test("initial state: No asset open, all buttons hidden", () => {
  expect(title()).toBe("No asset open");
  expect(meta()).toBe("Create or open an asset");
  expect(hidden("saveAssetBtn")).toBe(true);
  expect(hidden("publishAssetBtn")).toBe(true);
  expect(hidden("downloadAssetBtn")).toBe(true);
});

test("named draft without wallet: name shown, buttons still hidden", () => {
  resetForNewAsset();
  renameAsset("My Test Asset");
  expect(title()).toBe("My Test Asset");
  expect(meta()).toBe("Draft Scene");
  expect(hidden("saveAssetBtn")).toBe(true);
});

test("loaded asset with wallet: buttons appear", () => {
  walletState.set({ walletAddress: "0xabc" });
  emit(EVENTS.WALLET_STATE_CHANGED, walletState.get());
  assetState.set({ activeAssetManifestCid: "bafyX", activeAssetName: "Chair" });
  expect(title()).toBe("Chair");
  expect(meta()).toBe("Draft Scene");
  expect(hidden("saveAssetBtn")).toBe(false);
  expect(hidden("publishAssetBtn")).toBe(false);
  expect(hidden("downloadAssetBtn")).toBe(false);
});

test("tokenized asset shows Published", () => {
  assetState.set({
    activeAssetManifestCid: "bafyX",
    activeAssetName: "Chair",
    activeAssetTokenId: "7",
  });
  expect(meta()).toBe("Published");
});

test("closeAsset returns chrome to the empty state", () => {
  assetState.set({ activeAssetManifestCid: "bafyX", activeAssetName: "Chair" });
  closeAsset();
  expect(title()).toBe("No asset open");
  expect(meta()).toBe("Create or open an asset");
  expect(hidden("downloadAssetBtn")).toBe(true);
});

test("wallet disconnect hides save/publish but keeps download", () => {
  walletState.set({ walletAddress: "0xabc" });
  assetState.set({ activeAssetManifestCid: "bafyX", activeAssetName: "Chair" });
  walletState.set({ walletAddress: null });
  emit(EVENTS.WALLET_DISCONNECTED, {});
  expect(hidden("saveAssetBtn")).toBe(true);
  expect(hidden("publishAssetBtn")).toBe(true);
  expect(hidden("downloadAssetBtn")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/asset-chrome.test.js`
Expected: FAIL — `asset-chrome.js` not found.

- [ ] **Step 3: Implement the chrome module**

Create `frontend/src/js/ui/asset-chrome.ts`:

```js
// @ts-check
/**
 * Asset chrome — the ONLY writer of the header title/meta and the
 * save/publish/download buttons' visibility. Renders purely from store
 * state (domain snapshot + wallet); feature modules never touch these
 * elements, so render order can never clobber a name (the SCENE_EMPTY
 * header bug).
 */
import { on, EVENTS } from "../events/bus.js";
import { subscribeAsset } from "../domain/asset.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import { getPendingChildRefs } from "../engine/cleanup.js";

const titleEl = document.getElementById("assetStatusName");
const metaEl = document.getElementById("assetStatusMeta");
const saveBtn = document.getElementById("saveAssetBtn");
const publishBtn = document.getElementById("publishAssetBtn");
const downloadBtn = document.getElementById("downloadAssetBtn");

/**
 * Render the chrome from current state. Idempotent.
 */
function renderChrome() {
  const s = assetState.get();
  const hasAsset = !!(
    s.activeAssetManifestCid || getPendingChildRefs().length > 0
  );
  const hasWallet = !!walletState.get().walletAddress;

  if (titleEl) {
    if (s.activeAssetName) titleEl.textContent = s.activeAssetName;
    else if (hasAsset) titleEl.textContent = "Untitled Asset";
    else titleEl.textContent = "No asset open";
  }
  if (metaEl) {
    if (!s.activeAssetName && !hasAsset)
      metaEl.textContent = "Create or open an asset";
    else metaEl.textContent = s.activeAssetTokenId ? "Published" : "Draft Scene";
  }

  if (saveBtn) saveBtn.hidden = !(hasAsset && hasWallet);
  if (publishBtn) publishBtn.hidden = !(hasAsset && hasWallet);
  // Downloads are read-only — no wallet/session required.
  if (downloadBtn) downloadBtn.hidden = !hasAsset;
}

subscribeAsset(renderChrome);
on(EVENTS.WALLET_CONNECTED, renderChrome);
on(EVENTS.WALLET_DISCONNECTED, renderChrome);
on(EVENTS.WALLET_STATE_CHANGED, renderChrome);
on(EVENTS.SCENE_EMPTY, renderChrome);
```

- [ ] **Step 4: Rewire `asset-save.js`**

Delete from `frontend/src/js/ui/asset-save.ts`:
- The `assetStatusName` / `assetStatusMeta` DOM refs (lines 40-41).
- `updateAssetStatus` (64-67) and `updateButtonState` (69-90) — both functions and **all call sites** (`:242-245`, `:274`, `:300`, `:398`, `:424`, `:460-464` portions, `:471`, plus listener registrations `:473-478` — see below).
- The `SCENE_EMPTY` listener (467-472) — chrome handles it.
- The `WALLET_CONNECTED` / `WALLET_DISCONNECTED` / `ASSET_STATE_CHANGED` button listeners (473-478) — chrome handles them.
- The dead `DEFAULT_NAMES`/`isDefaultName` (118-127) and `adoptManifestName` (129-142) — now in `domain/asset.ts`.

Rewire the survivors:
- In `ensureExplicitName` (`:161-181`): replace `assetState.set({ activeAssetName: name })` + the `assetStatusName` DOM write with `renameAsset(name)` (import from `../domain/asset.js`).
- The `SCENE_READY` listener (`:452-465`) becomes:

```js
on(EVENTS.SCENE_READY, (e) => {
  adoptLoadedManifestName(e?.manifest);
});
```

- Keep `adoptManifestName` re-exported for existing importers: add near the imports:
  `export { adoptManifestName } from "../domain/asset.js";`
  (Implementer: first `grep -rn "adoptManifestName" frontend/src test` and point every importer at `domain/asset.ts` directly instead of re-exporting, if there are any.)
- Save/publish flow internals (`isSaving`/`isPublishing`, disabled toggles, `saveBtnText`/`publishBtnText` "Besking…", toasts, task progress) stay untouched. Delete only the `updateButtonState()` calls in the finally/cancel paths (`:274`, `:300`, `:424`) — visibility is state-derived now.

- [ ] **Step 5: Rewire `startNewAsset` in `scene-graph.js`**

In `frontend/src/js/engine/scene-graph.ts` `startNewAsset` (currently ~839-884):
- Replace `assetState.set(getStateForNewAsset(assetState.get()))` with `resetForNewAsset()` (import from `../domain/asset.js`; drop the `getStateForNewAsset` import if unused after).
- After the dialog resolves: replace `assetState.set({ activeAssetName })` with `renameAsset(activeAssetName)`.
- Delete the header DOM writes (`assetStatusName` / `assetStatusMeta` gets — keep the `assetNameDisplay` write at ~:869-870; that element is the create-panel name field, not the header chrome).
- Keep `emit(EVENTS.SCENE_EMPTY)` where it is (after `resetForNewAsset`, before the dialog) and keep the sidebar switch + prompt focus.

- [ ] **Step 6: Rewire library close-out in `asset-library.js`**

In the `ASSET_CLEARED` handler (`:1022-1027`), call `closeAsset()` (import from `../domain/asset.js`) after `clearScene()` and before `emit(EVENTS.SCENE_EMPTY)`:

```js
on(EVENTS.ASSET_CLEARED, async () => {
  clearScene();
  closeAsset();
  emit(EVENTS.SCENE_EMPTY);
  clearUrlAssetParams();
  await refreshAssetLibrary();
});
```

- [ ] **Step 7: Script tag + build**

In `frontend/src/pug/app.pug`, after the `asset-save.js` script tag (line 478), add:

```pug
    script(type="module", src="/js/ui/asset-chrome.js")
```

Run: `npm run build:frontend` — then `grep -c asset-chrome frontend/dist/app.html` → 1.

- [ ] **Step 8: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/asset-chrome.test.js test/frontend/domain-asset.test.js`
Expected: PASS. Then `npm test` (full suite — watch for suites that imported the deleted `asset-save.js` internals; fix imports to `domain/asset.ts`), `npm run lint`, `npm run typecheck:frontend`.
Expected: all green.

- [ ] **Step 9: Commit** (after user confirmation)

```bash
git add frontend/src/js/ui/asset-chrome.ts frontend/src/js/ui/asset-save.ts frontend/src/js/engine/scene-graph.ts frontend/src/js/ui/asset-library.ts frontend/src/pug/app.pug test/frontend/asset-chrome.test.js
git commit -m "refactor(ui): single-writer asset chrome via domain facade

Header title/meta and save/publish/download button visibility now render
from the domain asset snapshot in ui/asset-chrome.ts — the only writer.
Direct chrome DOM writes removed from asset-save.js and scene-graph.js.
Drops the dead generatedAsset read (never set anywhere)."
```

---

### Task 4: Verification

**Files:** none (verification only).

- [ ] **Step 1: Unit + static**

Run: `npm test && npm run lint && npm run typecheck:frontend && npm run build:frontend`
Expected: all green (1576+ tests plus the ~20 new ones).

- [ ] **Step 2: E2E regression set**

`./scripts/start-dev.sh --setup-only` if the stack is down, then:

Run: `npm run test:e2e -- --project=chromium e2e/specs/20-new-asset-name.spec.js e2e/specs/03-save-and-publish.spec.js e2e/specs/04-parametric-version.spec.js e2e/specs/05-republish.spec.js e2e/specs/11-library-studio-roundtrip.spec.js`
Expected: all pass. Spec 20 guards the original bug; 03/05 cover publish-name flows (ensureExplicitName rewire); 11 covers library open/close chrome.

- [ ] **Step 3: Manual smoke (optional)**

`./scripts/start-dev.sh`: New asset → name shows immediately; generate → buttons appear; save draft → "Draft Scene"; publish → "Published"; library close-out → "No asset open".

---

## Self-Review Notes

- Spec coverage: Phase 1 items all mapped (facade Task 2, chrome Task 3, structs Task 1, verification Task 4). Scope refinement (CIDs stay on assetState) recorded in the header.
- Type consistency: `getAssetSnapshot`/`subscribeAsset`/`renameAsset`/`adoptLoadedManifestName`/`adoptManifestName`/`isDefaultAssetName`/`resetForNewAsset`/`closeAsset` identical in Tasks 2 and 3. `normalizeAssetRef`/`assetRefKey`/`assetRefsEqual`/`resolveAssetRef`/`manifestNodeToNode`/`manifestNodes` identical between Task 1's test and implementation.
- Behavior parity traps handled explicitly: name persists through `getStateForNewAsset` (so `resetForNewAsset` nulls it); `clearScene` does NOT clear name/tokenId (so close-out calls `closeAsset()`); buttons during save/publish use local `disabled`, not chrome `hidden`.
