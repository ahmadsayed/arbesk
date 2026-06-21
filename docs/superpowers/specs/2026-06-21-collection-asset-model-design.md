# Collection/Asset Model Redesign

## Problem

Today, every Arbesk world is minted as its own independent ERC-721 token (one token = one manifest = one asset). Nesting (`child_ref`) lets one token reference another top-level token as a child world. This is flat and simple, but it means an asset can never live inside a larger authored grouping without becoming its own on-chain token — and editing one nested asset has no clean notion of "this belongs to the same body of work as that other asset."

This redesign introduces **Collections**: the only thing minted as an NFT. A collection contains a set of **Assets**, addressable by a local `assetID`, plus optionally nested child collections. Assets are not independently minted; they are entries inside a collection's manifest, retrievable by CID and referenceable by `assetID`.

## Goals

- A single token (collection) can hold many assets, addressed locally by `assetID`.
- Asset-to-asset references (a room referencing a chair) resolve via `collectionRef/assetID`, uniformly whether the reference is to an asset in the *same* collection or in *another* collection.
- Editing an asset that's referenced elsewhere (same collection or cross-collection, via live reference) propagates automatically on next load, because resolution always walks through the current `assets` map — no stale copies.
- Users can still opt out of that propagation by forking (copying the CID, not the reference) into their own collection.
- Zero changes to Solidity contracts. `publishAsset`, `updateAssetURI`, the Merkle-root editor system, and burn logic operate on the collection's tokenId exactly as they operate on a single-asset token today.
- No migration path for existing testnet tokens — this is a clean break while the project is still pre-mainnet.

## Non-goals

- Per-asset editor permissions within a collection (editor rights stay collection-wide, identical to today's per-token Merkle editor list).
- Any on-chain representation of an individual asset (no asset-level tokenId, ever).
- Preserving compatibility with existing minted single-asset tokens.

## Terminology

| Term | Meaning |
|---|---|
| **Collection** | The only mintable unit. An ERC-721 token whose `tokenURI` points to a collection manifest. |
| **Asset** | A self-contained manifest (glTF source + its own version chain) embedded in a collection, addressed by a local `assetID`. Never independently minted. |
| **assetID** | A string identifier, unique only within the collection that defines it (e.g. `"chair-01"`). Not a blockchain identifier. |
| **Besk** | The on-chain anchor action — calls `publishAsset` (first time) or `updateAssetURI` (subsequent) for a collection's tokenId. Distinct from a plain IPFS draft save, which never touches the chain. |
| **Fork** | Copying another collection's asset CID into your own collection as a new `assetID` entry. Frozen at copy time — the original author's later edits never propagate to you. |
| **Live reference** | Embedding a `child_ref` that points at `{collection: <self \| {chainId, contractAddress, tokenId}>, assetID}`. Resolved fresh on every load — if the referenced asset's CID changes, you see the update. |
| **Default collection** | The collection an asset lands in if the user hasn't created/selected one. Lazily minted on first besk. |

## Manifest schema

### Collection manifest (what a `tokenURI` resolves to)

```json
{
  "type": "collection",
  "version": 3,
  "prev_asset_manifest_cid": "bafy...prev",
  "assets": {
    "chair-01": "bafy...chairCidV2",
    "room-01": "bafy...roomCidV1",
    "garden-01": { "chainId": 6343, "contractAddress": "0x...", "tokenId": "42" }
  },
  "thumbnail": { "...": "..." },
  "comments_archive_cid": "..."
}
```

- `assets` is a flat map: `assetID -> CID | {chainId, contractAddress, tokenId}`. A string value is a direct asset (resolve via IPFS). An object value is a nested child collection (resolve via `tokenURI` on that contract/tokenId, recursively).
- This map is the single source of truth for "what does `assetID` resolve to right now," for both direct retrieval and any `child_ref` that targets this `assetID` (same-collection or cross-collection).
- Versioning is purely CID-chain based: besking recomputes the `assets` map (e.g. chair's CID changed after an edit), republishes the collection manifest, and the new CID is what `updateAssetURI` anchors on-chain. No inline `history[]` array at the collection level — exactly like today's existing chain mechanism, just applied at the collection.

### Asset manifest (what an `assets` map entry's CID points to)

```json
{
  "type": "asset",
  "version": 2,
  "prev_asset_manifest_cid": "bafy...prevRoomCid",
  "scene": {
    "nodes": [
      { "node_id": "n1", "source": { "cid": "bafy...gltf" }, "transform_matrix": [/* 16 */] },
      { "node_id": "n2", "child_ref": { "collection": "self", "assetID": "chair-01" }, "transform_matrix": [/* 16 */] }
    ]
  },
  "thumbnail": { "...": "..." }
}
```

- Same per-asset versioning approach as the collection: `prev_asset_manifest_cid` chain, no inline history array. (This replaces today's per-node `history[]` array used for generation/parametric metadata — that information is now recovered by walking the CID chain and reading each version's snapshot, exactly the same mechanism already used at the manifest-chain level today.)
- `child_ref.collection` is either:
  - `"self"` — resolve `assetID` against the **collection currently being loaded** (i.e. the collection whose `assets` map led us to this asset in the first place).
  - `{chainId, contractAddress, tokenId}` — resolve that token's `tokenURI` to get a *different* collection manifest, then look up `assetID` in *that* manifest's `assets` map.
- This generalizes today's `child_ref` (which only pointed at a top-level tokenId) to also support same-collection sibling references.

## Resolution algorithm

To resolve `collectionRef/assetID`:

1. If `collectionRef` is `"self"`, use the `assets` map already loaded for the current collection. Otherwise, call `tokenURI(tokenId)` on `contractAddress` at `chainId`, fetch that collection manifest, and use *its* `assets` map.
2. Look up `assetID` in that map.
   - String value → fetch that CID, parse as an asset manifest.
   - Object value (`{chainId, contractAddress, tokenId}`) → recurse: resolve that token's collection manifest, treat the whole thing as a nested collection (not an asset) — load each of its assets relative to *that* collection.
3. Apply `transform_matrix` from the referencing node.
4. Cycle/depth protection: reuse the existing `MAX_CHILD_WORLD_DEPTH = 5` counter, incremented on every `child_ref` traversal (whether same-collection or cross-collection) and every nested-collection traversal.

This is a direct generalization of today's `scene-graph.js` child_ref resolution (`token-resolver.js` already caches `tokenURI` lookups by `chainId:contractAddress:tokenId` — that cache is reused unchanged).

## Fork vs. live reference — user-facing flow

When a user drags another author's asset into their scene, Studio offers two choices:

- **Fork**: copy the asset's current CID into the user's own collection under a new local `assetID`. Stored as a plain `source.cid` node — no `child_ref`. The original author's later edits never affect this user.
- **Live reference**: add a `child_ref: { collection: {chainId, contractAddress, tokenId}, assetID }` node pointing at the *original* collection. Every future load resolves against that collection's *current* `assets` map — if the original author updates that asset, this user's scene reflects it automatically.

## Editor / collaboration scope

Editor rights stay exactly as they are today, just scoped to the whole collection instead of a single asset: one `editorRoot` / `editorListURI` per collection tokenId. Anyone with Editor role in that collection's Merkle tree can besk any change to any asset inside it (since besking always means "republish the collection's manifest"). No per-asset access control — enforcing that off-chain would have no real security guarantee anyway, since the contract only gates at the tokenId level.

## Default collection

Studio shows a virtual "default collection" placeholder before the user has minted anything. No on-chain transaction happens until the user's first besk — at that point, `publishAsset` mints the default collection's tokenId, and it becomes the destination for any subsequent asset the user creates unless they explicitly create/select a different collection.

## Studio UX implications (high-level — detailed in implementation plan)

- Gallery now lists **collections** (tokenId-level), not individual assets. The token ID always means "collection."
- Selecting a collection in the gallery shows its `assets` map as a browsable list; selecting an asset within shows that asset's scene.
- "Besk" is the explicit publish/republish action — anchors the *current* collection's manifest on-chain. A plain save (no besk) only writes IPFS drafts and never touches the chain.
- Adding an asset to a scene always happens within "the same collection" by default (point 6) — fork/live-reference choice (above) only applies when pulling in an asset that originates in *another* collection.

## Error handling & edge cases

- **Missing assetID in map**: treat like today's "child reference unresolvable" case — render a placeholder/error node, don't fail the whole scene load.
- **Cycle / depth exceeded**: reuse existing `MAX_CHILD_WORLD_DEPTH` rejection in `scene-graph.js`, now triggered by both `child_ref` traversal and nested-collection traversal.
- **Same-collection self-reference cycle** (e.g. `room-01` referencing itself via `"self"/room-01`): explicitly reject at resolution time — a direct self-reference where `collection: "self"` and `assetID` equals the asset currently being resolved is always a cycle, independent of depth counter.
- **Live reference to a burned/removed collection token**: resolution fails gracefully (same pattern as today's "tokenURI revert" handling in `token-resolver.js`) — render as a broken/missing reference, not a crash.
- **Race on besk**: two assets in the same collection edited concurrently and besked separately — last `updateAssetURI` wins, exactly like today's single-asset republish race. No new conflict-resolution mechanism introduced.

## Testing impact

- E2E spec `06` (nesting) needs to cover same-collection sibling `child_ref` (the room/chair case) in addition to cross-collection live references.
- New E2E coverage needed: fork vs. live-reference UX, default collection lazy-mint on first besk, gallery showing collections instead of flat assets.
- `e2e/helpers/manifest.mjs` needs updating to generate collection-shaped manifests (`assets` map) instead of the current single `source_asset` shape.
- `frontend/src/js/blockchain/token-resolver.js` and `frontend/src/js/engine/scene-graph.js` get unit/integration coverage for the new two-tier resolution (collection → assets map → asset manifest → nested child_ref/nested-collection).
- No contract test changes needed (no Solidity changes).
