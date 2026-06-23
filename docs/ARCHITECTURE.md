# Arbesk System Architecture

> Status: Current v0.6 — Phases 1–5.2 complete (token child worlds, free-tier contract, Merkle editor proofs, collection tokens). Phase 5 micro-ledger planned.
> Scope: Full-stack architecture for private-IPFS 3D generation, fractal manifest versioning, free-tier + EVM PayGo, token child worlds, collection manifests, and studio publishing

---

## 1. Vision

Arbesk is a local-first 3D world studio built around **fractal manifests**: every world is a content-addressed JSON document whose nodes point to 3D assets, transforms, history entries, child manifests, and optional publish thumbnails.

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
│  ├─ History browser / manifest chain timeline                        │
│  ├─ Gallery with optional thumbnails                                 │
│  └─ Team editor panel                                                │
│                                                                      │
│  Frontend services                                                   │
│  ├─ wallet.js: Web3Modal/Web3 + ArbeskAssetFree / ArbeskAsset calls  │
│  ├─ remote-ipfs.js: gateway reads + memory/IndexedDB cache           │
│  ├─ asset-save.js: save/publish, collection merge, thumbnail capture │
│  ├─ asset-library.js: token gallery with collection expansion        │
│  ├─ team.js: Merkle editor list add/remove                           │
│  └─ merkle-editors.js: computeRoot / getProof / makeLeaf             │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP + wallet txs
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                           Express Backend                            │
│                                                                      │
│  /api/v1/generations                                                 │
│  ├─ Session (SIWE) auth                                              │
│  ├─ EVM/Hardhat receipt validation                                  │
│  ├─ AssetGenerationPaid / AssetGenerationRecorded event validation   │
│  ├─ Mock generation adapter                                          │
│  └─ IPFS asset + manifest writes                                     │
│                                                                      │
│  *(parametric edits are client-side)*                                │
│  └─ Free color/scale history entries applied in browser              │
│                                                                      │
│  /api/v1/manifests, /api/v1/manifests/:cid/publish                   │
│  └─ Manifest writes (asset + collection manifests) + thumbnail       │
│      normalization and optional Nostr comments archive               │
│                                                                      │
│  /api/v1/manifests/:cid/history, /api/v1/tokens/:tokenId/manifest,   │
│  /api/v1/ipfs/upload-url, /api/v1/ipfs/unpin,                        │
│  /api/v1/contracts/:name/abi, /api/v1/config                         │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │                               │
                ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────────────┐
│ Private Kubo / Pinata IPFS   │   │ EVM (Hardhat / MegaETH Testnet)  │
│ 127.0.0.1:5001 API           │   │ ArbeskAssetFree.sol (free tier)  │
│ 127.0.0.1:8080 gateway       │   │ ArbeskAsset.sol (paid tier)      │
│ No DHT / no bootstrap peers  │   │ ├─ recordGeneration              │
│ (local Kubo mode)            │   │ ├─ payForGenerationWithUSDC      │
│ Stores assets, manifests,    │   │ ├─ publishAsset(uri,tokenId,     │
│ thumbnails, editor lists     │   │ │                editorRoot,uri)   │
│                              │   │ ├─ updateAssetURI + Merkle proof │
│                              │   │ ├─ updateEditors + Merkle proof  │
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
| `src/index.js` | Express app, static frontend serving, request logging, body limits, Chat WebSocket |
| `src/api/index.js` | Route registry, IPFS storage abstraction, manifest save/publish, thumbnail normalization, comments archive, bundle upload |
| `src/api/assets/generate-node.js` | Session-auth generation route, mock adapter, manifest updates (no on-chain tx validation) |
| `src/api/storage/index.js` | Storage backend abstraction (`kubo` or `pinata`) |
| `src/api/storage/pinata-adapter.js` | Pinata v3 SDK uploads + presigned upload URLs |
| `src/api/storage/kubo-adapter.js` | Local Kubo `add`/`cat`/`pin.rm`/`addDirectory` |
| *(client-side only)* | Parametric editing happens in browser; no dedicated backend route |
| `src/api/authentication.js` | Session token validation, sets `res.locals.userAddress` |
| `src/api/sessions.js` | SIWE session create/delete (24h TTL) |
| `src/api/siwe-verify.js` | EIP-4361 message verification |
| `src/api/rate-limiter.js` | In-memory route rate limiter |
| `src/api/abi-router.js` | Serves compiled contract artifacts by name |
| `src/api/adapters/mock-adapter.js` | Deterministic local asset generation for development/tests |
| `src/api/comments-archive.js` | Snapshots Nostr comment threads to IPFS on republish |
| `src/api/chat-proxy.js` | WebSocket bridge: browser ↔ Nostr relay (session-gated) |
| `src/api/nostr-relay.js` | Shared relay primitives (used by chat-proxy + comments-archive) |
| `src/api/manifest-utils.js` | getSceneNodes, bumpManifestVersion |
| `src/api/ipfs-utils.js` | catManifest() with timeout/abort |
| `src/config.js` | Multi-network Web3 config (Hardhat local, MegaETH Testnet) |

### 3.2 Frontend (`frontend/src/js/`)

| Area | Files | Responsibility |
|---|---|---|
| Engine | `engine/scene-graph.js` | Babylon engine/scene, GLB/GLTF loading, node metadata, scene clearing, thumbnail capture, collection loading |
| Engine | `engine/time-travel.js` | History version switching and parametric application |
| Engine | `engine/parametric-preview.js` | Live color/scale inspector preview and save |
| IPFS | `ipfs/remote-ipfs.js` | Gateway reads with memory + IndexedDB cache |
| IPFS | `ipfs/write-to-ipfs.js` | Direct Kubo/Pinata writes + pin |
| glTF | `gltf/uri_to_cid.js` | Rehydrates CID-based glTF buffer URIs for rendering |
| glTF | `gltf/decomposer.js` / `async-gltf.js` | Breaks monolithic glTF/GLB into composite IPFS CIDs |
| glTF | `gltf/composer.js` | Resolves `ipfs://` URIs back to base64 for Babylon |
| glTF | `gltf/merkle-editors.js` | Merkle tree/proof library for editor authorization |
| Blockchain | `blockchain/wallet.js` | Web3Modal, wallet connection, EVM switching, PayGo, mint/update URI/editor/burn calls |
| Blockchain | `blockchain/network-config.js` | Per-network contract/USDC/RPC configuration |
| Blockchain | `blockchain/token-resolver.js` | Resolve `child_ref` tokens to manifest CIDs |
| UI | `ui/create-panel.js` | Prompt flow and asset definition controls |
| UI | `ui/asset-save.js` | Save/publish lifecycle, collection merge, WebP thumbnail capture |
| UI | `ui/asset-library.js` | Token gallery, collection expansion, thumbnail rendering |
| UI | `ui/asset-history.js` | Manifest-chain timeline browser |
| UI | `ui/asset-editors.js` | Editor list / add/remove UI |
| UI | `ui/collaborators.js` | Burn button visibility helper |
| Services | `services/team.js` | Merkle-based editor add/remove |
| Services | `services/asset-delete.js` | Remove an asset from a collection manifest |

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
| `GET /api/v1/manifests/:cid/history` | Backend walks up to 50 entries and returns lightweight summaries (CID, version, name, node count, timestamp) |
| History timeline UI | Frontend fetches the chain and renders a draggable circular-node scrubber for version switching |
| Replay prevention | Backend scans manifest history entries for duplicate `txHash` values to prevent generation replay |
| Micro-ledger (Phase 5) | The ledger records each manifest CID as an append-only log entry, with optional on-chain anchoring via `anchorManifest()` |

### History Entry Types

| Type | Trigger | Payment | Asset CID changes? | Notes |
|---|---:|---:|---:|---|
| `generation` | Prompt generation | Yes | Usually yes | Uses PayGo tx validation and mock/cloud adapter |
| `parametric` | Color/scale edit | No | No | Reuses node source CID, appends params |

### Thumbnail Handling

During publish:

1. `scene-graph.js` captures the Babylon canvas into a WebP `dataUrl`.
2. `asset-save.js` attaches it to `manifest.thumbnail`.
3. `src/api/index.js` uploads the image bytes to IPFS.
4. The stored manifest receives only thumbnail metadata + CID.
5. `asset-library.js` reads `manifest.thumbnail.cid` and renders it through the IPFS gateway.

---

## 5. Data Flows

### 5.1 Generation Flow

**Paid tier (`ArbeskAsset`)**

```text
User prompt
  → wallet.signInWithEthereum() → POST /api/v1/sessions → Session token
  → wallet.payForGenerationWithUSDC(nodeId, prompt, tier)  (on-chain, independent of backend)
  → POST /api/v1/generations (Authorization: Session <token>)
  → backend verifies session token + rate limit only
  → mock adapter returns asset bytes
  → asset bytes added to IPFS
  → manifest read/update/write on IPFS
  → frontend loads new manifest in Babylon.js
```

**Free tier (`ArbeskAssetFree`) — implemented UI path**

```text
User prompt
  → wallet.recordGeneration(nodeId, prompt)  (on-chain, independent of backend)
  → POST /api/v1/generations
  → backend verifies session token + rate limit only
  → mock adapter returns asset bytes
  → asset bytes added to IPFS
  → manifest read/update/write on IPFS
  → frontend loads new manifest in Babylon.js
```

> The free tier uses on-chain quota enforcement (`recordGeneration` reverts after 10 calls/day per wallet). The contract owner bypasses the quota. `create-panel.js` auto-detects the free tier via `isFreeTierContract()` and dispatches to the correct contract method.

### 5.2 Parametric Edit Flow

```text
User selects node
  → inspector live-previews color/scale in Babylon.js
  → browser applies color/scale to meshes
  → browser appends parametric history entry to manifest
  → POST /api/v1/manifests (save draft) or publish flow
  → updated manifest added to IPFS
  → frontend updates active/latest manifest CID
```

### 5.3 Save / Publish Flow

```text
Save
  → fetch active asset manifest from IPFS gateway/cache
  → set name/version/prev link as needed
  → POST /api/v1/manifests
  → update active/latest manifest CID

Publish
  → fetch active asset manifest
  → capture optional WebP thumbnail
  → POST /api/v1/manifests (asset manifest) with publishContext on republish
  → merge asset CID into collection manifest's `assets` map
  → POST /api/v1/manifests (collection manifest)
  → publishAsset(new collection token) or updateAssetURI(existing collection token)
  → refresh gallery/history
```

The collection token's `tokenURI` always points to the latest collection manifest CID. Updating an existing asset republishes the collection, not a new token.

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
| Replay generation | In-memory `usedTxHashes` plus manifest history scan | Phase 5 durable ledger-backed replay index |
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
| History chain UI | backend walks `prev_asset_manifest_cid` up to 50 entries |
| Publish thumbnail | one synchronous canvas capture during publish only |
| Collection publish | one asset manifest write + one collection manifest write + one on-chain URI update |

---

## 9. Phase 5.1: Token ID-Based Child Worlds (Complete)

Child worlds are referenced by on-chain token IDs. The parent manifest stores a `child_ref` with `chainId`, `contractAddress`, and `tokenId`; at load time the browser calls `tokenURI()` to resolve the latest collection manifest CID and then loads the relevant asset from the collection's `assets` map.

Key constraints still in force:
- Every token child node must have a `transform_matrix`; no local `history` array
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

- Production cloud 3D adapters are not implemented.
- OpenSCAD WASM integration is schema-compatible but deferred.
- Phase 5 micro-ledger is planned but not implemented (only `anchorManifest()` stubbed).
- `GET /api/health` and direct `GET /api/manifest/:cid` are planned routes, not current backend routes.
- `GET /api/resolve-token` backend fallback for token child resolution is planned but not implemented.
