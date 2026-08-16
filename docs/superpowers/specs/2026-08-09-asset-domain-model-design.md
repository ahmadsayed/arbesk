# Asset Domain Model Refactor — Design

Date: 2026-08-09
Status: Awaiting user review

## Goal

Introduce an explicit domain layer for the UI: one noun — **Asset** — owning
its identity, state, and operations; **Collection** (the ERC-721 token) as its
unchanged on-chain container; assets referencing other assets in a **tree**.
The UI renders from domain snapshots instead of scattered modules writing to
shared DOM/state — eliminating the multi-writer bug class (see the
`SCENE_EMPTY` header clobber, fixed 2026-08-09, as the motivating incident).

## Decisions (confirmed with user)

- **The "world" concept is removed from vocabulary.** A nested thing is a
  *child asset*. Diving = opening the child asset; ascending = back to the
  parent. The data model already worked this way (a "world" was always an
  asset manifest) — this is a naming/concept unification, not a data change.
- **Assets reference other assets in a tree.** References hydrate on open;
  no live shared child instances. Cycle rejection + depth cap (already in the
  loader) are what keep references a tree, not a graph.
- **Collection (ERC-721) remains, unchanged on-chain.** tokenURI → collection
  manifest → `assets` directory. Editors/Merkle auth stay per-token.
- **No identity registry.** At most the existing fetch caches (IPFS memory +
  IndexedDB, token-resolver resolution cache). Asset instances exist only for
  assets that are open or being edited.
- **Persisted manifest field names are frozen** (`child_ref`, `scene.nodes`,
  `prev_asset_manifest_cid`, `comments_archive_cid`, …). Renaming happens in
  UI copy, code-internal names, and docs — never in the on-IPFS schema.
- **Incremental migration** (facade-first), never a big-bang rewrite.

## Target model

```
Collection                          Asset
 ├─ identity {chainId, contract,    ├─ identity {collectionRef, assetId}
 │   tokenId} (ERC-721)             ├─ name
 ├─ name                            ├─ CIDs: active / latest / published
 ├─ publishedManifestCid            ├─ currentManifest (working copy)
 ├─ assets: Map<assetId, AssetRef>  ├─ pendingEdits (post-processor,
 ├─ editors (Merkle list)           │   transforms, staged child refs)
 └─ thumbnail?                      ├─ nodes: Node[]  (the tree)
                                    │    ├─ nodeId, transformMatrix
                                    │    ├─ source? {cid,path,format}   (geometry)
                                    │    └─ ref?: AssetRef              (tree edge)
                                    └─ version chain (prev_asset_manifest_cid)

AssetRef = { collection: {chainId, contractAddress, tokenId} | "self", assetID }
           + resolve() → manifestCid → Asset (on open)
```

### Structs + module functions (no classes, no inheritance)

Each concept is a **big struct** — a plain object with a JSDoc `@typedef`,
all fields in one place. Behavior is **module functions** (struct in, struct
out), one module per concept under `frontend/src/js/domain/`. No `class`, no
`this`, no prototypes, no inheritance.

**The one discipline rule:** a struct's fields are mutated only by its own
module's functions. Not via `private` — by module boundary. Everyone else
receives frozen snapshots (`Object.freeze(...)`), so an outside write throws
in dev instead of silently forking state. Module-private fields use the
`_` prefix convention (e.g. `_listeners`).

**`AssetRef`** (`domain/asset-ref.ts`) — struct wrapping today's `child_ref`
shape `{collection, assetID}`. Functions: `assetRefKey(ref)` → canonical
`chainId:contract:tokenId:assetID`, `assetRefsEqual(a, b)`,
`resolveAssetRef(ref)` → manifest CID (delegates to
`blockchain/token-resolver.ts`).

**`Node`** (`domain/node.ts`) — pure-data struct mirroring a `scene.nodes[]`
entry: `nodeId`, `transformMatrix`, `source?`, `ref?`, `postProcessor?`.
Engine runtime objects (anchors, meshes, animation groups) are **not** here —
the engine keeps its own maps keyed by `nodeId`.

**`Asset`** (`domain/asset.ts`) — the struct:

```js
/** @typedef {Object} Asset
 * { identity: {collectionRef, assetId}, name,
 *   activeCid, latestCid, publishedCid,
 *   currentManifest, pendingEdits: {postProcessor, transforms, childRefs},
 *   nodes: Node[], _listeners: Set<fn> }
 */
```

- Read functions: `getAssetSnapshot(asset)` → frozen `{name, assetId,
  tokenId, activeCid, latestCid, publishedCid, isDraft, hasUnsavedChanges}`;
  `subscribeAsset(asset, fn)`; `getAssetNodes(asset)`;
  `getAssetVersionHistory(asset)`.
- Command functions: `openAsset(refOrCid, deps)`, `startNewAsset(name,
  collectionRef)`, `closeAsset(asset)`, `renameAsset(asset, name)`,
  `stageColor(asset, nodeId, …)`, `stageScale(asset, nodeId, …)`,
  `stageTransform(asset, nodeId, matrix)`, `stageChildDrop(asset, ref,
  choice)`, `saveDraftAsset(asset, wallet, deps)`, `publishAsset(asset,
  wallet, deps)`.
- Invariants enforced inside the module (today re-derived at call sites):
  - `saveDraftAsset()` always appends to **latest** (`prev = latestCid`),
    even while viewing history (`activeCid` ≠ `latestCid`).
  - `publishAsset()` anchors **latest** into the Collection directory.
  - Name/CIDs mutate only via these functions; `assetState.set()` for these
    fields disappears from feature modules.

**`Collection`** (`domain/collection.ts`) — struct `{identity {chainId,
contractAddress, tokenId}, name, publishedManifestCid, assets:
Map<assetId, AssetRef>, editors: EditorList, thumbnail?}`.

- Read functions: `getCollectionSnapshot()`, `listCollectionAssets(coll,
  {sortBy, searchQuery})` → derived array view for the gallery (computed,
  never stored); `canEdit(coll, address)`; `proofFor(coll, address)`.
- Command functions: `openCollection(tokenId)`, `createCollectionAsset(coll,
  name)` → `Asset`, `removeCollectionAsset(coll, assetId)`,
  `renameCollection(coll, name)`, `publishCollection(coll)` (new collection
  manifest + `updateAssetURI()` — no remint), `addEditor(coll, address,
  role)`, `removeEditor(coll, address)`.
- Coordination rule: `publishAsset()` never touches the chain directly; it
  asks the Collection module to point `assets[assetId]` at the asset's new
  tip.

**`Editor` / `EditorList`** (`domain/editor-list.js`) — `Editor` struct
`{address, role}` (role: 0 None / 1 Viewer / 2 Editor); `EditorList` struct
`{entries: Map<address, Editor>, setVersion}` owned by Collection (Merkle
root is per token = per collection). Functions: `addEditor`, `removeEditor`,
`canEdit`, `proofFor` (wraps `gltf/merkle-editors.ts`). Rules: an editor is a
granted capability, not a wallet; owner ≠ editor (`canEdit` must not
special-case ownership).

### Manifest mapping (load / save)

Load: `Asset.open(cid)` fetches + validates (Zod) the manifest, hydrates
identity/name/`currentManifest`, hands `scene.nodes` to the engine to render,
passes `comments_archive_cid` to the comment thread, `metadata.chat` to chat
history. `publishedCid` comes from the collection directory / tokenURI, not
from inside the manifest.

Save: the Asset's working copy + pending edits go through the existing
`asset-save/manifest-builder.js` (the domain module delegates; no JSON is
hand-written in the struct layer). New CID → `latestCid`. Publish → Collection directory update +
on-chain anchor. Unchanged: decomposed-vs-monolithic bake rules,
`post_processor` overlay, chat-provenance capture.

### Boundaries (what Asset does NOT own)

- **3D scene** — engine renders from `scene.nodes`; keeps anchors/meshes/
  animationGroups keyed by `nodeId`.
- **Wallet/Session** — caller identity, passed into commands.
- **Generations/chat** — produce versions; `PendingGeneration` stays separate
  and hands results to `Asset`.
- **Comments** — separate thread entity, scoped by the asset tag.

## Terminology cleanup ("world" → "asset")

User-facing copy and code-internal vocabulary only:

- UI copy: `Open This World →` → `Open Asset →` (`app.pug` dive button);
  dive/ascend wording → open child / back to parent (`ui/nesting.ts` toasts,
  labels).
- Constants/logs/comments: `MAX_CHILD_WORLD_DEPTH` → `MAX_CHILD_ASSET_DEPTH`
  (`engine/state.ts` + usages); "child world" log lines in
  `engine/scene-loader.ts`; docs wording in `ARCHITECTURE.md` § golden rules
  and `AGENTS.md`.
- NOT renamed: manifest schema fields (`child_ref` etc.), the `NESTING_*`
  event names (internal bus contract — churn without user benefit), storage
  keys.

## Migration phases (each independently testable, suite stays green)

1. **Facade + single-writer chrome.** `asset-ref.js`, `node.js`, `asset.js`
   structs + functions wrapping existing stores; name/CID fields become
   module-private; header
   title, meta line, and save/publish/download button visibility render from
   `Asset.subscribe()` in exactly one module. Direct DOM writes to the header
   from `scene-graph.js` / `asset-save.js` are removed. E2E spec 20
   (new-asset name) is the regression guard.
2. **Save/publish commands.** `saveDraft`/`publish` move into `Asset` +
   `Collection.publish` coordination (absorbing `collection-publish.js`
   orchestration). `manifest-builder.js` stays the serializer.
3. **Collection module.** Directory map + `listCollectionAssets()` views; library state
   (`library-state.js`) renders from it; editor management moves in.
4. **Terminology cleanup.** Copy/constants/docs per the list above; stale
   `child_ref` shape in `ARCHITECTURE.md` corrected at the same time.

Engine boundary note: engine runtime maps (`nodeAnchors`, `nodeMeshes`,
`nodeAnimationGroups`, selection sets) stay in `engine/state.ts` — they are
render state, not domain state.

## Out of scope

Contract changes (none), manifest schema changes (none), collection on-chain
semantics (unchanged), chat-preview behavior, multi-open assets (struct shape
permits it; not built).

## Error handling

- `AssetRef.resolve()` failure → same behavior as today (error placeholder in
  the tree, warning log); the ref stays in the manifest untouched.
- Save/publish failures keep current toast + status semantics; the domain module
  surfaces them as rejected promises with the same error shapes.
- Cycle/depth rejections on child references stay where they are (loader),
  with log wording updated in phase 4.

## Testing

- Unit: new suites for `Asset` (invariants: append-to-latest, publish-anchor,
  rename/snapshot immutability), `Collection` (directory ops, list views),
  `AssetRef` (key/equality/resolve mapping) — jsdom + existing mock patterns.
- Regression: full Jest suite green each phase; E2E chromium suite per phase
  (specs 02/03/04/06/08/11/20 cover the touched flows: generate, save/publish,
  parametric versions, nesting, fork/live-ref, library roundtrip, new-asset
  name). AGENTS.md §10 E2E-sync rules apply to any copy/selector changes in
  phase 4.
