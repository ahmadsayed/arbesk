# Arbesk System Architecture

> Status: Current v0.6 — Phases 1–5.2 complete (token child worlds, free-tier contract, Merkle editor proofs, collection tokens). Phase 5 micro-ledger planned.
> Scope: Full-stack architecture for private-IPFS 3D generation, fractal manifest versioning, free-tier + EVM PayGo, token child worlds, collection manifests, and studio publishing

---

## 1. Vision

Arbesk is a local-first 3D world studio built around **fractal manifests**: every world is a content-addressed JSON document whose nodes point to 3D assets, transforms, optional per-node history entries, child manifests, and optional publish thumbnails. The manifest is agnostic to the underlying asset data — it only references content-addressed sources; the asset bytes themselves (glTF/GLB) carry their own revision state.

The system currently combines:

- **Mock-backed generative 3D flow** via Express and private IPFS
- **Parametric versioning** for free color/scale changes
- **Babylon.js rendering** with GLB/GLTF loading and one-node-per-world replacement behavior
- **Free-tier on-chain generation quota** via `ArbeskAssetFree.recordGeneration()` (10/day per wallet, owner bypass)
- **EVM PayGo** generation payments and ERC721 world ownership via `ArbeskAsset` (paid tier)
- **Collection manifests** — every published token is a collection manifest that maps `assetID`s to asset manifest CIDs
- **Off-chain Merkle editor proofs** — the contract stores only a Merkle root; the full editor list lives on IPFS and is proved at call time
- **Private Dockerized Kubo/IPFS** for local content-addressed storage; Pinata-backed storage for public testnet
- **Dockerized Hardhat** for reproducible local EVM development
- **MegaETH Testnet** as the public testnet target (Hardhat local for dev)
- **Optional WebP publish thumbnails** stored as separate IPFS assets and referenced by manifest metadata
- **On-demand browser IPFS cache** using memory + IndexedDB

Phase 5 will add an append-only micro-ledger for durable auditability.

---

## 2. High-Level System Diagram

```text
┌────────────────────────────────────────────────────────────────────┐
│                            Browser Studio                           │
│                                                                     │
│  Pug/SCSS shell                                                      │
│  ├─ Chat + asset definition panel                                    │
│  ├─ Babylon.js viewport                                              │
│  ├─ Node inspector: color + scale                                    │
│  ├─ History browser / manifest chain timeline (client-side walk)     │
│  ├─ Gallery with optional thumbnails                                 │
│  ├─ Team editor panel                                                │
│  └─ Activity ledger (client-side chain walk)                         │
│                                                                      │
│  Frontend services                                                   │
│  ├─ wallet.js: Web3Modal/Web3 + ArbeskAssetFree / ArbeskAsset calls  │
│  ├─ remote-ipfs.js: gateway reads + memory/IndexedDB cache           │
│  ├─ write-to-ipfs.js: direct browser→IPFS writes (Kubo/Pinata)       │
│  ├─ asset-save.js: save/publish, collection merge, thumbnail capture │
│  ├─ asset-library.js: token gallery with collection expansion        │
│  ├─ token-resolver.js: on-chain child_ref resolution (no server)     │
│  ├─ time-travel.js: manifest chain walking (no server)              │
│  ├─ team.js: Merkle editor list add/remove                           │
│  └─ merkle-editors.js: computeRoot / getProof / makeLeaf             │
│                                                                      │
│  IPFS writes happen directly from the browser:                       │
│  ├─ Thumbnails: captureAssetThumbnail() → writeToIPFS()              │
│  ├─ Manifests: writeJSONToIPFS() in asset-save.js                    │
│  ├─ Generation: api.js receives bytes, uploads to IPFS               │
│  └─ glTF parts: decomposer uploads buffers/textures directly         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP (auth + adapter calls only)
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                     Express Backend (thin gatekeeper)                │
│                                                                      │
│  /api/v1/generations                                                 │
│  └─ Session auth + rate limit + mock adapter → returns raw bytes     │
│     (no IPFS writes — browser uploads asset + manifest)              │
│                                                                      │
│  /api/v1/assets/snapshot-comments                                    │
│  └─ Nostr comments archive snapshot (needs service private key)      │
│                                                                      │
│  /api/v1/ipfs/upload-url                                             │
│  └─ Mints presigned upload credentials (protects Pinata JWT)         │
│                                                                      │
│  /api/v1/ipfs/unpin                                                  │
│  └─ Burn cleanup — walks chain, collects CIDs, unpins                │
│                                                                      │
│  /api/v1/config, /api/v1/contracts/:name/abi, /api/v1/openapi.json   │
│  /api/v1/sessions (SIWE), /api/v1/chat/ws (Nostr proxy)              │
│                                                                      │
│  *(parametric edits, manifest writes, thumbnail upload,              │
│   manifest-chain walks, and token resolution are all client-side)*           │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │                               │
                ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────────────┐
│ Private Kubo / Pinata IPFS   │   │ EVM (Hardhat / MegaETH Testnet)  │
│ 127.0.0.1:5001 API           │   │ ArbeskAssetFree.sol (free tier)  │
│ 127.0.0.1:8080 gateway       │   │ ArbeskAsset.sol (paid tier)      │
│ No DHT / no bootstrap peers  │   │ ├─ recordGeneration              │
│ (local Kubo mode)            │   │ ├─ payForGenerationWithUSDC      │
│ Browser writes directly via  │   │ ├─ publishAsset                  │
│ writeToIPFS() → Kubo :5001   │   │ ├─ updateAssetURI + Merkle proof │
│ or Pinata presigned URLs     │   │ ├─ updateEditors + Merkle proof  │
│                              │   │ └─ burn + Merkle proof           │
│                              │   │ Local RPC: 127.0.0.1:8545        │
│                              │   │ MegaETH RPC: carrot.megaeth.com  │
└──────────────────────────────┘   └──────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 Backend (`src/`)

| File | Responsibility |
|---|---|
| `src/index.js` | Express app, static frontend serving, request logging, body limits, CSP, Chat WebSocket |
| `src/api/index.js` | Route registry — thin gatekeeper: auth, rate limiting, adapter calls, credential minting, unpin |
| `src/api/assets/generate-node.js` | Session-auth generation route — calls mock adapter, returns raw bytes (no IPFS writes) |
| `src/api/storage/index.js` | Storage backend abstraction (`kubo` or `pinata`) |
| `src/api/storage/pinata-adapter.js` | Pinata v3 SDK uploads + presigned upload URLs |
| `src/api/storage/kubo-adapter.js` | Local Kubo `add`/`cat`/`pin.rm`/`addDirectory` |
| *(client-side only)* | Parametric editing, manifest writes, thumbnail upload, manifest-chain walks, token resolution — all browser-side |
| `src/api/authentication.js` | Session token validation, sets `res.locals.userAddress` |
| `src/api/sessions.js` | SIWE session create/delete (24h TTL) |
| `src/api/siwe-verify.js` | EIP-4361 message verification |
| `src/api/rate-limiter.js` | In-memory route rate limiter |
| `src/api/abi-router.js` | Serves compiled contract artifacts by name |
| `src/api/adapters/mock-adapter.js` | Deterministic local asset generation for development/tests |
| `src/api/comments-archive.js` | Snapshots Nostr comment threads to IPFS on republish |
| `src/api/chat-proxy.js` | WebSocket bridge: browser ↔ Nostr relay (session-gated) |
| `src/api/nostr-relay.js` | Shared relay primitives (used by chat-proxy + comments-archive) |
| `src/api/manifest-utils.js` | getSceneNodes (used by unpin route) |
| `src/api/ipfs-utils.js` | catManifest() with timeout/abort |
| `src/config.js` | Multi-network Web3 config (Hardhat local, MegaETH Testnet) |

### 3.2 Frontend (`frontend/src/js/`)

| Area | Files | Responsibility |
|---|---|---|
| Engine | `engine/scene-graph.js` | Babylon engine/scene, GLB/glTF load, selection, framing, thumbnail capture, collection load |
| Engine | `engine/time-travel.js` | Manifest chain walking (client-side), version switching, parametric application |
| Engine | `engine/parametric-preview.js` | Live color/scale inspector preview and save |
| IPFS | `ipfs/remote-ipfs.js` | Gateway reads with memory + IndexedDB cache |
| IPFS | `ipfs/write-to-ipfs.js` | Direct browser→IPFS writes (Kubo `:5001` or Pinata presigned URLs) |
| glTF | `gltf/uri_to_cid.js` | Rehydrates CID-based glTF buffer URIs for rendering |
| glTF | `gltf/decomposer.js` / `async-gltf.js` | Breaks monolithic glTF/GLB into composite IPFS CIDs, uploads parts directly |
| glTF | `gltf/composer.js` | Resolves `ipfs://` URIs back to base64 for Babylon (gateway reads) |
| glTF | `gltf/merkle-editors.js` | Merkle tree/proof library for editor authorization |
| Blockchain | `blockchain/wallet.js` | Web3Modal, wallet connection, EVM switching, PayGo, mint/update URI/editor/burn calls |
| Blockchain | `blockchain/network-config.js` | Per-network contract/USDC/RPC configuration |
| Blockchain | `blockchain/token-resolver.js` | Resolve `child_ref` tokens to manifest CIDs (client-side, no server) |
| UI | `ui/create-panel.js` | Prompt flow, asset definition controls, generation trigger |
| UI | `ui/asset-save.js` | Save/publish lifecycle, collection merge, thumbnail capture, direct IPFS writes |
| UI | `ui/asset-library.js` | Token gallery, collection expansion, thumbnail rendering |
| UI | `ui/asset-history.js` | Manifest-chain timeline browser (uses client-side walkManifestChain) |
| UI | `ui/asset-editors.js` | Editor list / add/remove UI |
| UI | `ui/ledger-panel.js` | Activity feed — walks manifest chain client-side, fetches full manifests |
| Services | `services/api.js` | API client: sessions, generation (with client-side IPFS upload), comments archive, upload credential |
| Services | `services/team.js` | Merkle-based editor add/remove |
| Services | `services/asset-delete.js` | Remove an asset from a collection (direct IPFS write) |

### 3.3 Smart Contracts (`blockchain/contracts/`)

There are two concrete contracts sharing `ArbeskAssetBase.sol`:

**`ArbeskAssetFree.sol` (free tier, default)**
- `recordGeneration(bytes32 nodeId, string prompt)` — 10/day quota per wallet, owner bypass
- All shared minting, URI, editor, and burn functions
- No payment, no treasury, no USDC

**`ArbeskAsset.sol` (paid tier)**
- `payForGenerationWithUSDC(bytes32 nodeId, string prompt, Tier tier)`
- emits `AssetGenerationPaidUSDC`
- transfers USDC payment directly to treasury
- `publishAsset(string uri, uint256 tokenId, bytes32 editorRoot, string editorListUri)`
- `updateAssetURI(uint256 tokenId, string newURI, bytes32[] proof)`
- `updateEditors(uint256 tokenId, bytes32 newRoot, string newListUri, uint8 callerRole, bytes32[] callerProof)`
- `burn(uint256 tokenId, bytes32[] proof)`
- admin controls: cost, treasury, pause/unpause

Shared responsibilities (in `ArbeskAssetBase.sol`):
- ERC-721 enumerable minting and URI storage
- Merkle-root-based editor authorization (`editorRoot[tokenId]`, `editorSetVersion[tokenId]`)
- burn with Merkle proof
- pause/unpause and ownership

**Editor authorization**

The contract never stores per-address roles. Instead:

- `editorRoot[tokenId]` is a `bytes32` Merkle root of the current editor set.
- `editorSetVersion[tokenId]` increments on every editor set change.
- The full editor list (address + role) is stored on IPFS; `publishAsset` and `updateEditors` record the list CID as `editorListUri`.
- To call `updateAssetURI`, `updateEditors`, or `burn`, the caller submits a Merkle proof showing their address + role is in the tree for the current version.
- The token owner always bypasses the proof check.

### 3.4 Infrastructure

| Service | Purpose | Host Binding |
|---|---|---|
| `ipfs` | Private Kubo node (local dev / E2E) | `127.0.0.1:5001`, `127.0.0.1:8080` |
| `hardhat` | Local EVM and contract tooling | `127.0.0.1:8545` |
| `nostr` | Local Nostr relay (dev only) | `127.0.0.1:7777` |
| `megaethTestnet` | Public testnet target | RPC `https://carrot.megaeth.com/rpc` |

The local Kubo container is configured private-first: no public DHT, no bootstrap peers, no public swarm exposure, no relay client, and loopback-only swarm. The Nostr relay is likewise local-only: bound to loopback, SQLite-backed, with no federation or public peering.

Public network strategy: **Hardhat local for development, MegaETH Testnet for testnet**. Optimism Sepolia / Mainnet are no longer current targets.

---

## 4. Manifest Data Model

A manifest is a complete snapshot stored on IPFS. The system uses two manifest types.

### 4.1 Asset Manifest

```json
{
  "type": "asset",
  "manifest_id": "manifest_001",
  "asset_id": "asset_1700000000000",
  "name": "My World",
  "version": 4,
  "timestamp": 1780000000,
  "prev_asset_manifest_cid": "QmPreviousManifest...",
  "thumbnail": {
    "type": "snapshot",
    "cid": "QmThumbnailCid...",
    "path": "thumbnail.webp",
    "format": "webp",
    "mime": "image/webp",
    "width": 512,
    "height": 288,
    "bytes": 12345,
    "timestamp": 1780000000
  },
  "comments_archive_cid": "QmCommentsArchiveCid...",
  "scene": {
    "nodes": [
      {
        "node_id": "node_world_root",
        "source": {
          "cid": "QmAssetCid...",
          "path": "asset.glb",
          "format": "glb",
          "bundleCid": "QmBundleRoot..."
        },
        "transform_matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        "history": [
          {
            "v": 1,
            "timestamp": 1780000000,
            "type": "generation",
            "provider": "mock",
            "prompt": "A wooden house",
            "txHash": "0x...",
            "src": {
              "cid": "QmAssetCid...",
              "path": "asset.glb",
              "format": "glb"
            }
          },
          {
            "v": 2,
            "timestamp": 1780000100,
            "type": "parametric",
            "provider": "parametric",
            "prompt": "Scale 1.5x,1.5x,1.5x, Color #FF5733",
            "src": {
              "cid": "QmAssetCid...",
              "path": "asset.glb",
              "format": "glb"
            },
            "params": {
              "scale": { "x": 1.5, "y": 1.5, "z": 1.5 },
              "color": "#FF5733"
            }
          }
        ],
        "child_ref": {
          "type": "token",
          "chainId": 31415822,
          "contractAddress": "0x1234567890abcdef1234567890abcdef12345678",
          "tokenId": "42",
          "standard": "ERC721",
          "resolution": "latest"
        }
      }
    ]
  }
}
```

**Source fields:**
- `cid` — the authoritative root CID used to load the asset (a composite glTF JSON whose `buffers[].uri` / `images[].uri` reference their parts by bare `ipfs://<cid>` URIs). The loader and composer resolve these bare CIDs directly; they never read `path` or `bundleCid`.
- `path` — the source file name (`asset.glb` or `composite.gltf`); metadata only.
- `format` — `"glb"` or `"gltf"`.
- `bundleCid` *(optional)* — an IPFS UnixFS directory root CID grouping the composite glTF + its `.bin` buffers + textures under their friendly names (`composite.gltf`, `buffer_0.bin`, `texture_0.png`). **Organizational only** — exists so Pinata/Kubo show a browsable folder for the asset. Loading ignores it. Dropped on color-bake edits (JSON-only changes), since re-bundling isn't worth the upload. Burn unpins it alongside `cid`.

**Manifest–asset boundary.** The asset manifest references content-addressed sources and is format-agnostic to the underlying 3D data. Each saved or published version is a complete snapshot, and the manifest chain (`prev_asset_manifest_cid`) provides world-level history. The optional `scene.nodes[].history` array can carry a per-node provenance log (generation events, parametric edits); it is consumed by the activity ledger and burn cleanup, but current generation and save paths do not populate it.

### 4.2 Collection Manifest

Every published token points to a collection manifest. The collection manifest maps asset IDs to the latest asset manifest CID.

```json
{
  "type": "collection",
  "asset_id": "collection_1700000000000",
  "name": "My Collection",
  "version": 3,
  "timestamp": 1780000000,
  "prev_asset_manifest_cid": "QmPrevCollection...",
  "thumbnail": {
    "type": "snapshot",
    "cid": "QmThumbnailCid...",
    "format": "webp"
  },
  "assets": {
    "asset_1700000000000": "QmAssetManifestA...",
    "asset_1700000001234": "QmAssetManifestB..."
  }
}
```

Key points:

- A token's `tokenURI()` returns the **collection manifest CID**, not an asset manifest CID.
- The default collection token ID for a wallet is deterministically derived from the wallet address.
- Named collections derive their token ID from `keccak256(address, name)`.
- Gallery cards represent individual assets; collection tokens are expanded into one card per `assets` entry.

### 4.3 Manifest Chain (IPFS Content-Addressed Version Chain)

Every manifest stored on IPFS is content-addressed — its IPFS CID is a cryptographic hash of its contents. When a new version is saved, the updated manifest includes a `prev_asset_manifest_cid` pointer to the previous version, forming a **manifest chain** (also referred to as the **IPFS version chain** or **manifest history chain**).

```text
Manifest v1 (CID: QmA...)  ←──  Manifest v2 (CID: QmB...)  ←──  Manifest v3 (CID: QmC...)
     prev_asset_manifest_cid: null          prev_asset_manifest_cid: QmA...        prev_asset_manifest_cid: QmB...
```

**Key properties:**

- **Content-addressed immutability**: Each manifest CID is a verifiable fingerprint. The chain cannot be altered without changing every subsequent CID.
- **Backward-only traversal**: The chain walks from newest to oldest via `prev_asset_manifest_cid`. There is no forward pointer — IPFS CIDs of future versions cannot be known in advance.
- **IPFS as the chain substrate**: Unlike a traditional blockchain, the "chain" here lives on IPFS. The CIDs themselves form the links; no separate ledger or contract maintains the ordering.
- **Temporal isolation**: Loading a specific manifest CID renders the exact world state at that version. The chain enables time-travel without re-rendering unrelated nodes.

**How the chain is used:**

| Consumer | Description |
|---|---|
| History timeline UI | Frontend (`time-travel.js` / `asset-history.js`) walks `prev_asset_manifest_cid` client-side and renders a version scrubber |
| Activity ledger | Frontend (`ledger-panel.js`) walks the chain and also reads `node.history` entries when present |
| Burn cleanup | Backend (`POST /api/v1/ipfs/unpin`) walks the chain and collects source CIDs from `node.source` and `node.history` |
| Replay prevention | In-memory `usedTxHashes` set plus chain walk to detect duplicate on-chain generation transactions |
| Micro-ledger (Phase 5) | The ledger records each manifest CID as an append-only log entry, with optional on-chain anchoring via `anchorManifest()` |

### Version Snapshot Types

Every entry in the manifest chain is a complete snapshot. The difference between snapshot types is in how the node content changes:

| Type | Trigger | Payment | Asset CID changes? | Notes |
|---|---:|---:|---:|---|
| `generation` | Prompt generation | Yes | Yes | Uses PayGo tx validation and mock/cloud adapter; new asset bytes are uploaded to IPFS |
| `parametric` | Color/scale edit | No | Sometimes | Decomposed/color edits are baked into a new composite glTF CID; monolithic/scale edits are stored as `node.post_processor` runtime overlays without changing `source.cid` |

### Thumbnail Handling

During publish:

1. `scene-graph.js` captures the Babylon canvas into a WebP blob.
2. `captureAssetThumbnail()` uploads the blob directly to IPFS via `writeToIPFS()` and returns CID metadata (no `dataUrl` — the browser writes to IPFS directly, same as glTF buffer uploads).
3. `asset-save.js` places the CID metadata into `manifest.thumbnail`.
4. The stored manifest contains only thumbnail metadata + CID.
5. `asset-library.js` reads `manifest.thumbnail.cid` and renders it through the IPFS gateway.

---

## 5. Data Flows

### 5.1 Generation Flow

```text
User prompt
  → wallet.signInWithEthereum() → POST /api/v1/sessions → Session token
  → (free tier) wallet.recordGeneration(nodeId, prompt)  (on-chain)
  → (paid tier)  wallet.payForGenerationWithUSDC(nodeId, prompt, tier)  (on-chain)
  → POST /api/v1/generations (Authorization: Session <token>)
  → backend verifies session token + rate limit
  → mock adapter returns asset bytes (base64)
  → browser uploads asset bytes to IPFS via writeToIPFS()
  → browser constructs manifest, uploads to IPFS via writeJSONToIPFS()
  → frontend loads new manifest in Babylon.js
```

> The backend only validates auth + rate limit and returns raw bytes. All IPFS
> writes (asset + manifest) happen in the browser. The free tier uses on-chain
> quota enforcement (`recordGeneration` reverts after 10 calls/day per wallet).

### 5.2 Parametric Edit Flow

```text
User selects node
  → inspector live-previews color/scale in Babylon.js
  → browser applies color/scale to meshes
  → for decomposed/color edits: browser bakes change into new composite glTF CID → updates `node.source.cid`
  → for monolithic/scale edits: browser stores change in `node.post_processor` overlay
  → browser writes updated manifest directly to IPFS via `writeJSONToIPFS()`
  → frontend updates active/latest manifest CID
```

### 5.3 Save / Publish Flow

```text
Save
  → fetch active asset manifest from IPFS gateway/cache
  → set name/version/prev link as needed
  → writeJSONToIPFS(manifest) — direct browser→IPFS, no server round-trip
  → update active/latest manifest CID

Publish
  → fetch active asset manifest
  → capture WebP thumbnail → writeToIPFS(blob) — direct browser→IPFS
  → snapshot comments archive (POST /api/v1/assets/snapshot-comments)
  → writeJSONToIPFS(asset manifest) — direct browser→IPFS
  → merge asset CID into collection manifest's `assets` map
  → writeJSONToIPFS(collection manifest) — direct browser→IPFS
  → publishAsset(new collection token) or updateAssetURI(existing token)
  → refresh gallery/history
```

The collection token's `tokenURI` always points to the latest collection manifest CID. Updating an existing asset republishes the collection, not a new token. All manifest and thumbnail writes are direct browser→IPFS; only the comments archive snapshot touches the server (needs Nostr private key).

### 5.4 Gallery Flow

```text
Wallet connected
  → contract.getPastEvents('Transfer', { filter: { to: owner } })
  → tokenURI(tokenId)
  → if tokenURI points to a collection manifest, expand each assets[assetID] entry
  → get asset manifests from IPFS gateway/cache
  → display asset name and optional thumbnail
```

---

## 6. Storage and Caching Strategy

### IPFS Objects

| Content | Stored as | Referenced by |
|---|---|---|
| GLB/GLTF asset | raw bytes or JSON | `node.source.cid`, `history[].src.cid` |
| Asset manifest | JSON | collection manifest `assets` map |
| Collection manifest | JSON | token URI |
| Publish thumbnail | WebP bytes | `manifest.thumbnail.cid` |
| Editor list | JSON array | `editorListUri` + localStorage cache |
| glTF buffers | CID/base64 converted content | glTF `buffers[].uri` transformation |

### Storage Backends

The backend selects the storage implementation via `IPFS_BACKEND`:

| Backend | Use case | Upload model |
|---|---|---|
| `kubo` | Local dev / E2E | Direct Kubo `add` |
| `pinata` | Public testnet / production | Pinata v3 SDK; browser uses presigned URLs via `POST /api/v1/ipfs/upload-url` |

### Browser Cache

`frontend/src/js/ipfs/remote-ipfs.js` caches on demand only:

- memory map for fast repeat reads in a session
- IndexedDB object store for persistence
- separate cache keys by gateway URL, CID, and payload kind (`json`, `text`, `blob`)

No background prefetching or cache warming is performed. (Note: the cache is currently disabled by default in code.)

---

## 7. Security Model

| Risk | Current Mitigation | Planned Improvement |
|---|---|---|
| Unpaid generation | Backend validates tx receipt and event before generation | Verify signer/tx sender/event payload alignment |
| Replay generation | In-memory `usedTxHashes` plus manifest-chain walk | Phase 5 durable ledger-backed replay index |
| Private keys/API keys | `.env` files ignored by Git | Secret scanning / deployment secret management |
| IPFS public exposure | Docker ports bound to loopback, no DHT/bootstrap | Deployment hardening checklist |
| Mock assets in prod | `MOCK_3D_GENERATION` env flag | Explicit production adapter config validation |
| Embedded thumbnail bloat | Backend strips `dataUrl` and stores CID only | Optional thumbnail size/crop UI |
| Unauthorized URI update/burn | Merkle proof required; owner bypass | Multi-sig owner for high-value collections |
| Editor list tampering | On-chain Merkle root verifies IPFS list integrity | Periodic root consistency checks |
| Ledger tampering | Not implemented yet | Append-only JSONL/SQLite + IPFS snapshots + contract anchors |

---

## 8. Current Performance Characteristics

| Operation | Current Strategy |
|---|---|
| Mock generation | local file read + IPFS add |
| Root manifest load | gateway read + browser cache |
| GLB load | blob gateway read + browser cache + Babylon import |
| GLTF load | JSON gateway read + CID buffer rehydration + Babylon import |
| History chain UI | client-side walk of `prev_asset_manifest_cid` up to 50 entries |
| Publish thumbnail | one synchronous canvas capture during publish only |
| Collection publish | one asset manifest write + one collection manifest write + one on-chain URI update |

---

## 9. Phase 5.1: Token ID-Based Child Worlds (Complete)

Child worlds are referenced by on-chain token IDs. The parent manifest stores a `child_ref` with `chainId`, `contractAddress`, and `tokenId`; at load time the browser calls `tokenURI()` to resolve the latest collection manifest CID and then loads the relevant asset from the collection's `assets` map.

Key constraints still in force:
- Every token child node must have a `transform_matrix`; no local `history` array
- Token child nodes do not contain a local `source`; their state is resolved from the referenced token's manifest chain
- `MAX_CHILD_WORLD_DEPTH = 5`; cycle detection enforced in `scene-graph.js`
- Resolver: `frontend/src/js/blockchain/token-resolver.js`

---

## 10. Planned: Phase 5 Micro-Ledger

Phase 5 (not yet implemented) introduces a display-agnostic micro-ledger:

```text
Generate / Parametric / Save / Publish / Mint / Team edit
  → Ledger entry schema validation
  → Append-only JSONL store
  → Query API: GET /api/ledger
  → Optional stats/export
  → Optional IPFS snapshots
  → Optional on-chain manifest anchoring (not yet implemented)
  → Frontend ledger panel
```

The ledger must remain independent from Babylon.js and DOM state so future XR clients can consume the same audit trail.

---

## 11. Zed Agent Integration

- `AGENTS.md` is the primary instruction file for Zed AI agents.
- `.zed/tasks.json` defines repeatable project tasks.
- `.zed/settings.json` excludes generated/heavy folders from Zed project scanning.
- `docs/ZED_AGENT_GUIDE.md` summarizes agent entry points and safe workflows.

---

## 12. Known Gaps

- Production cloud 3D adapters are not implemented (mock-only, returns 501 when disabled).
- OpenSCAD WASM integration is schema-compatible but deferred.
- Phase 5 micro-ledger is planned but not implemented (`anchorManifest()` stubbed; ledger panel derives activities from manifest chain).
- `GET /api/health` is a planned route, not a current backend route.
- IPFS browser cache is disabled by default (`IPFS_CACHE_ENABLED = false` in `remote-ipfs.js`).
- CSP is in report-only mode; should be promoted to enforcing after monitoring.
- Contract addresses are hardcoded in 3 places (`src/config.js`, `frontend/src/js/blockchain/network-config.js`, `blockchain/.env`).
- Chain ID constants are duplicated (`src/constants/chains.js` and `frontend/src/js/constants/chains.js`).
- Frontend build uses custom Node.js scripts (no bundler — no tree-shaking, HMR, or code splitting).
- `scene.nodes[].history` is defined in the manifest schema and is read by the ledger panel and burn cleanup, but current generation/save paths do not populate it; the manifest chain is the effective source of version history.
