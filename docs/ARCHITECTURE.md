# Arbesk System Architecture

> Status: Current v0.9 — Phases 1–5.4 complete (token child worlds, free-tier contract, Merkle editor proofs, collection manifests). Asset-level Nostr comments and CDP email-login smart accounts implemented. Phase 5 micro-ledger planned.
> Scope: Full-stack architecture for private-IPFS 3D generation, fractal manifest versioning, free-tier + EVM PayGo, token child worlds, collection manifests, and studio publishing

---

## 1. Vision

Arbesk is a local-first 3D world studio built around **fractal manifests**: every world is a content-addressed JSON document whose nodes point to 3D assets, transforms, optional per-node history entries, child manifests, and optional publish thumbnails. The manifest is agnostic to the underlying asset data — it only references content-addressed sources; the asset bytes themselves (glTF/GLB) carry their own revision state.

The system currently combines:

- **Mock-backed generative 3D flow** via Express and private IPFS
- **Parametric versioning** for free color/scale changes
- **Babylon.js rendering** with GLB/GLTF loading and one-node-per-world replacement behavior
- **Free-tier on-chain generation quota** via `ArbeskAssetFree.recordGeneration()` (10/day per wallet; contract `owner()` bypasses quota)
- **EVM PayGo** generation payments and ERC721 world ownership via `ArbeskAsset` (paid tier)
- **Collection manifests** — every published token is a collection manifest that maps `assetID`s to asset manifest CIDs
- **Off-chain Merkle editor proofs** — the contract stores only a Merkle root; the full editor list lives on IPFS and is proved at call time
- **Private Dockerized Kubo/IPFS** for local content-addressed storage; Pinata-backed storage for public testnet
- **Dockerized Hardhat** for reproducible local EVM development
- **Base Sepolia Testnet** as the public testnet target (Hardhat local for dev)
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
│  ├─ wallet-core.js / wallet-payments.js / wallet-publishing.js:      │
│  │  Web3Modal, network switching, free/paid generation, mint/update/  │
│  │  editor/burn calls (re-exported via wallet.js barrel)             │
│  ├─ remote-ipfs.js: gateway reads + memory/IndexedDB cache           │
│  ├─ write-to-ipfs.js: direct browser→IPFS writes (Kubo/Pinata)       │
│  ├─ asset-save.js + services/asset-save/:                            │
│  │  save/publish, manifest builder, collection merge, thumbnail capture│
│  ├─ asset-library.js: token gallery with collection expansion        │
│  ├─ token-resolver.js: on-chain child_ref resolution (no server)     │
│  ├─ time-travel.js: manifest chain walking (no server)              │
│  ├─ team.js: Merkle editor list add/remove                           │
│  ├─ merkle-editors.js: computeRoot / getProof / makeLeaf             │
│  ├─ comment-thread.js: per-asset Nostr thread state                  │
│  ├─ comments-panel.js: asset comment UI                              │
│  ├─ library-init.js + library-grid.js / library-toolbar.js           │
│  │  / library-context-menu.js: standalone Library page               │
│  └─ library-ops.js: create collection, upload glTF/GLB file          │
│                                                                      │
│  IPFS writes happen directly from the browser:                       │
│  ├─ Thumbnails: captureAssetThumbnail() → writeToIPFS()              │
│  ├─ Manifests: writeJSONToIPFS() in services/api.js (generation) and │
│  │  services/asset-save/manifest-builder.js (save/publish)           │
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
│  └─ Asset-level Nostr comments archive snapshot (needs service key)  │
│                                                                      │
│  /api/v1/ipfs/upload-url                                             │
│  └─ Mints presigned upload credentials (protects Pinata JWT)         │
│                                                                      │
│  /api/v1/ipfs/unpin                                                  │
│  └─ Burn cleanup — walks chain, collects CIDs, unpins                │
│                                                                      │
│  /api/v1/paymaster (CDP Paymaster JSON-RPC proxy)                     │
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
│ Private Kubo / Pinata IPFS   │   │ EVM (Hardhat / Base Sepolia)     │
│ 127.0.0.1:5001 API           │   │ ArbeskAssetFree.sol (free tier)  │
│ 127.0.0.1:8080 gateway       │   │ ArbeskAsset.sol (paid tier)      │
│ No DHT / no bootstrap peers  │   │ ├─ recordGeneration              │
│ (local Kubo mode)            │   │ ├─ payForGenerationWithUSDC      │
│ Browser writes directly via  │   │ ├─ publishAsset                  │
│ writeToIPFS() → Kubo :5001   │   │ ├─ updateAssetURI + Merkle proof │
│ or Pinata presigned URLs     │   │ ├─ updateEditors + Merkle proof  │
│                              │   │ └─ burn + Merkle proof           │
│                              │   │ Local RPC: 127.0.0.1:8545        │
│                              │   │ Base Sepolia RPC: sepolia.base.org│
└──────────────────────────────┘   └──────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 Backend (`src/`)

| File | Responsibility |
|---|---|
| `src/index.js` | Express app, static frontend serving, request logging, body limits, CSP, Chat WebSocket |
| `src/api/index.js` | Route registry — mounts all `/api/v1` routes |
| `src/api/routes/` | Per-domain route modules (`comments.js`, `ipfs.js`, `contracts.js`, `openapi.js`, `test-utils.js`) |
| `src/api/assets/generate-node.js` | Session-auth generation route — calls mock adapter, returns raw bytes (no IPFS writes) |
| `src/api/storage/index.js` | Storage backend abstraction (`kubo` or `pinata`) |
| `src/api/storage/pinata-adapter.js` | Pinata v3 SDK uploads + presigned upload URLs |
| `src/api/storage/kubo-adapter.js` | Local Kubo `add`/`cat`/`pin.rm`/`addDirectory` |
| `src/api/authorization.js` | On-chain asset access checks for chat proxy (owner or Merkle editor proof) |
| *(client-side only)* | Parametric editing, manifest writes, thumbnail upload, manifest-chain walks, token resolution — all browser-side |
| `src/api/authentication.js` | Session token validation, sets `res.locals.userAddress` |
| `src/api/sessions.js` | SIWE session create/delete (24h TTL) |
| `src/api/siwe-verify.js` | EIP-4361 message verification (supports `eoaAddress` for CDP smart accounts) |
| `src/api/routes/paymaster.js` | CDP Paymaster JSON-RPC proxy (keeps `CDP_PAYMASTER_URL` server-side) |
| `src/api/rate-limiter.js` | In-memory route rate limiter |
| `src/api/abi-router.js` | Serves compiled contract artifacts by name |
| `src/api/adapters/mock-adapter.js` | Deterministic local asset generation for development/tests |
| `src/api/comments-archive.js` | Snapshots Nostr comment threads to IPFS on republish |
| `src/api/chat-proxy.js` | WebSocket bridge: browser ↔ Nostr relay (session-gated) |
| `src/api/nostr-relay.js` | Shared relay primitives (used by chat-proxy + comments-archive) |
| `src/api/manifest-utils.js` | getSceneNodes (used by unpin route) |
| `src/api/ipfs-utils.js` | catManifest() with timeout/abort |
| `src/config.js` | Multi-network Web3 config (Hardhat local, Base Sepolia Testnet) |

### 3.2 Frontend (`frontend/src/js/`)

| Area | Files | Responsibility |
|---|---|---|
| Engine | `engine/scene-graph.js` | Babylon engine/scene, GLB/glTF load, selection, framing, thumbnail capture, collection load |
| Engine | `engine/time-travel.js` | Manifest chain walking (client-side), version switching, parametric application |
| Engine | `engine/parametric-preview.js` | Live color/scale inspector preview and save |
| IPFS | `ipfs/remote-ipfs.js` | Gateway reads with memory + IndexedDB cache |
| IPFS | `ipfs/write-to-ipfs.js` | Direct browser→IPFS writes (Kubo `:5001` or Pinata presigned URLs) |
| glTF | `gltf/decomposer.js` / `async-gltf.js` | Breaks monolithic glTF/GLB into composite IPFS CIDs, uploads parts directly |
| glTF | `gltf/material-editor.js` | Edits PBR material properties on composite glTFs and commits new CIDs |
| glTF | `gltf/composer.js` | Resolves `ipfs://` URIs back to base64 for Babylon (gateway reads) |
| glTF | `gltf/merkle-editors.js` | Merkle tree/proof library for editor authorization |
| Blockchain | `blockchain/wallet.js` | Backward-compat barrel re-exporting `wallet-core.js`, `wallet-network.js`, `wallet-payments.js`, `wallet-publishing.js`, `wallet-guard.js` |
| Blockchain | `blockchain/wallet-core.js` | Web3 init, connect/disconnect, auto-connect, account state |
| Blockchain | `blockchain/wallet-network.js` | Network switching |
| Blockchain | `blockchain/wallet-payments.js` | Free-tier `recordGeneration()`, USDC PayGo `payForGenerationWithUSDC()` |
| Blockchain | `blockchain/wallet-publishing.js` | Mint, `updateAssetURI()`, `updateEditors()`, `burn()` |
| Blockchain | `blockchain/wallet-cdp.js` | CDP email-OTP login, ERC-4337 smart account, EIP-1193 shim for Web3.js |
| Blockchain | `blockchain/network-config.js` | Per-network contract/USDC/RPC configuration |
| Blockchain | `blockchain/token-resolver.js` | Resolve `child_ref` tokens to manifest CIDs (client-side, no server) |
| UI | `ui/create-panel.js` | Prompt flow, asset definition controls, generation trigger |
| UI | `ui/asset-save.js` | Save/publish lifecycle UI; delegates manifest building to `services/asset-save/` |
| UI | `ui/asset-library.js` | Token gallery, collection expansion, thumbnail rendering |
| UI | `ui/asset-history.js` | Manifest-chain timeline browser (uses client-side walkManifestChain) |
| UI | `ui/collaborators-panel.js` | Editor list / add/remove UI |
| UI | `ui/comments-panel.js` | Asset-level comment thread UI |
| UI | `ui/ledger-panel.js` | Activity feed — walks manifest chain client-side, fetches full manifests |
| Services | `services/api.js` | API client: sessions, generation, comments archive snapshot, upload credential, unpin |
| Services | `services/asset-save/manifest-builder.js` | Manifest assembly, version bumping, comment archive embedding |
| Services | `services/asset-save/collection-publish.js` | New collection mint / existing collection URI update |
| Services | `services/asset-save/editor-publish.js` | Republish authorization for editors (Merkle proof) |
| Services | `services/team.js` | Merkle-based editor add/remove |
| Services | `services/asset-delete.js` | Remove an asset from a collection (direct IPFS write) |
| State | `state/comment-thread.js` | Per-asset Nostr WebSocket + archive state |
| UI | `pug/library.pug` | Standalone Library page (built to `dist/library.html`) |
| UI | `ui/library-grid.js` | Library grid/list rendering, selection, keyboard shortcuts, rubber-band select |
| UI | `ui/library-toolbar.js` | Breadcrumb, search, sort, view mode, New Collection, Upload |
| UI | `ui/library-context-menu.js` | Right-click actions: Open, Open in Studio, Rename, Manage Collaborators, Burn, Delete, Send to Collection |
| Services | `services/library-ops.js` | `createNamedCollection()`, `uploadFileToCollection()` |
| Services | `utils/library-items.js` | Filter, sort, range selection, bytes formatter |

### 3.3 Smart Contracts (`blockchain/contracts/`)

There are two concrete contracts sharing `ArbeskAssetBase.sol`:

**`ArbeskAssetFree.sol` (free tier, default)**
- `recordGeneration(bytes32 nodeId, string prompt)` — 10/day quota per wallet (contract `owner()` bypasses quota)
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
- ERC-721 minting and URI storage (non-enumerable)
- Merkle-root-based editor authorization (`editorRoot[tokenId]`, `editorSetVersion[tokenId]`)
- burn with Merkle proof
- pause/unpause and ownership

**Editor authorization**

The contract never stores per-address roles. Instead:

- `editorRoot[tokenId]` is a `bytes32` Merkle root of the current editor set.
- `editorSetVersion[tokenId]` increments on every editor set change.
- The full editor list (address + role) is stored on IPFS; `publishAsset` and `updateEditors` record the list CID as `editorListUri`.
- To call `updateAssetURI`, `updateEditors`, or `burn`, the caller submits a Merkle proof showing their address + role is in the tree for the current version.
- The token owner has no special bypass; callers must prove Editor membership (the contract `owner()` bypasses only the free-tier daily generation quota).

### 3.4 Infrastructure

| Service | Purpose | Host Binding |
|---|---|---|
| `ipfs` | Private Kubo node (local dev / E2E) | `127.0.0.1:5001`, `127.0.0.1:8080` |
| `hardhat` | Local EVM and contract tooling | `127.0.0.1:8545` |
| `nostr` | Local Nostr relay (dev only) | `127.0.0.1:7777` |
| `baseSepolia` | Public testnet target | RPC `https://sepolia.base.org` |

The local Kubo container is configured private-first: no public DHT, no bootstrap peers, no public swarm exposure, no relay client, and loopback-only swarm. The Nostr relay is likewise local-only: bound to loopback, SQLite-backed, with no federation or public peering.

Public network strategy: **Hardhat local for development, Base Sepolia Testnet for testnet**. Base Sepolia supports both EOA wallets (MetaMask/Rabby) and CDP email-login smart accounts (ERC-4337, gas sponsored by CDP Paymaster).

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
  "prev_asset_manifest_cid": "bafyPreviousManifest...",
  "comments_archive_cid": "bafyCommentsArchiveCid...",
  "thumbnail": {
    "type": "snapshot",
    "cid": "bafyThumbnailCid...",
    "path": "thumbnail.webp",
    "format": "webp",
    "mime": "image/webp",
    "width": 512,
    "height": 288,
    "bytes": 12345,
    "timestamp": 1780000000
  },
  "comments_archive_cid": "bafyCommentsArchiveCid...",
  "scene": {
    "nodes": [
      {
        "node_id": "node_world_root",
        "source": {
          "cid": "bafyAssetCid...",
          "path": "asset.glb",
          "format": "glb",
          "bundleCid": "bafyBundleRoot..."
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
              "cid": "bafyAssetCid...",
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
              "cid": "bafyAssetCid...",
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

**`comments_archive_cid`.** Holds the CID of a JSON archive of Nostr comments for this specific asset. Comments are scoped per asset using the tag `<chainId>:<contractAddress>:<tokenId>:<assetId>`; switching assets inside the same collection shows a different thread. The archive is created on republish by `POST /api/v1/assets/snapshot-comments` and loaded by `state/comment-thread.js` before live relay events are merged.

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
  "prev_asset_manifest_cid": "bafyPrevCollection...",
  "thumbnail": {
    "type": "snapshot",
    "cid": "bafyThumbnailCid...",
    "format": "webp"
  },
  "assets": {
    "asset_1700000000000": "bafyAssetManifestA...",
    "asset_1700000001234": "bafyAssetManifestB..."
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
Manifest v1 (CID: bafyA...)  ←──  Manifest v2 (CID: bafyB...)  ←──  Manifest v3 (CID: bafyC...)
     prev_asset_manifest_cid: null          prev_asset_manifest_cid: bafyA...        prev_asset_manifest_cid: bafyB...
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
3. `services/asset-save/manifest-builder.js` places the CID metadata into `manifest.thumbnail`.
4. The stored manifest contains only thumbnail metadata + CID.
5. `asset-library.js` reads `manifest.thumbnail.cid` and renders it through the IPFS gateway.

---

## 5. Data Flows

### 5.1 Generation Flow

```text
User prompt
  → services/api.js#getOrCreateSession() → POST /api/v1/sessions → Session token
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
  → snapshot asset-level comments archive
     (POST /api/v1/assets/snapshot-comments with `assetId`)
  → writeJSONToIPFS(asset manifest) — direct browser→IPFS
  → merge asset CID into collection manifest's `assets` map
  → writeJSONToIPFS(collection manifest) — direct browser→IPFS
  → publishAsset(new collection token) or updateAssetURI(existing token)
  → refresh gallery/history
```

The collection token's `tokenURI` always points to the latest collection manifest CID. Updating an existing asset republishes the collection, not a new token. All manifest and thumbnail writes are direct browser→IPFS; only the comments archive snapshot touches the server (needs Nostr private key).

### 5.4 Library Page (`/library.html`)

`frontend/dist/library.html` is a standalone single-page application linked from the headerbar "Library" tab. It shares the wallet/theme chrome with Studio but has its own state, layout, and JS entry point (`library-init.js`).

---

#### 5.4.1 Page structure (what the browser renders)

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADERBAR                                                      │
│  [Logo]  [Library ●] [Studio]      [☀/☾] [Network ▾] [Login]  │
├─────────────────────────────────────────────────────────────────┤
│  TOOLBAR                                                        │
│  [↑ Up]  Home › Collection Name    [Search…] [Sort ▾]          │
│                             [+ New Collection]  [↑ Upload]      │
├─────────────────────────────────────────────────────────────────┤
│  CONTENT AREA  (scrollable)                                     │
│                                                                 │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐                       │
│  │  📁  │  │  📁  │  │  📁  │  │  📁⏳│   ← minting…         │
│  │  ✓   │  │  ✓   │  │  ✓   │  │  ◌   │                       │
│  └──────┘  └──────┘  └──────┘  └──────┘                       │
│  Characters  Weapons    Props    New Coll.                      │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  STATUS BAR                          [⊞ Grid]  [☰ List]        │
│  4 items                                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

#### 5.4.2 Authentication gate

The page has two mutually exclusive sections:

- **`#libraryGate`** — shown when no wallet is connected. Displays a wallet icon, "Sign in to continue", and a "Login / Signup" button that opens the wallet modal.
- **`#libraryMain`** — shown after wallet connect. Contains the toolbar, content area, and status bar.

The gate is toggled by `applyWalletGate()` in `library-init.js` in response to `WALLET_STATE_CHANGED` events.

---

#### 5.4.3 Two-level navigation (Collections → Assets)

The Library operates as a two-level browser. State is held in `library-state.js` (`currentCollectionTokenId`).

**Level 1 — Collections list** (`currentCollectionTokenId === null`):

- Loaded at wallet connect via the token indexer (`GET /api/v1/indexer/owned`) — chunked `eth_getLogs` backfill discovers all `Transfer` events to the wallet.
- Shared collections (where the wallet is a Merkle editor) are discovered alongside owned ones.
- Each collection is shown as a folder card with a thumbnail (if available), name, and a role badge (owner/editor).
- Inaccessible tokens (owned on-chain but manifest unresolvable) appear as greyed-out skeleton cards with a Burn action.

**Level 2 — Assets inside a collection** (`currentCollectionTokenId !== null`):

- Entered by double-clicking / pressing Enter on a collection card.
- The collection manifest (`tokenURI → IPFS`) is read and expanded: each entry in `manifest.assets` becomes one asset card.
- Assets show their thumbnail (lazy-loaded from IPFS), name, and status badge.
- The ↑ Up button and breadcrumb "Home" segment navigate back to the collections list.

---

#### 5.4.4 Collection cards — status badges

Each collection card shows a small badge in the bottom-right corner of the thumbnail:

| Badge | Meaning | Visual |
|-------|---------|--------|
| `besked` | Confirmed on-chain | Green circle with ✓ (`accent-bg`) |
| `minting` | Optimistic — mint tx in flight | Animated spinner ring (`accent-bg`) |
| `wip` | Work-in-progress (not yet published) | Dim flag icon |

The `minting` badge appears immediately when the user creates a new collection, before the blockchain transaction confirms. When the mint settles, the card flips to `besked` in place. If the transaction fails or the user rejects the wallet popup, the card is removed automatically.

---

#### 5.4.5 Toolbar controls

| Control | Behaviour |
|---------|-----------|
| **↑ Up** | Navigates back to the collections list. Hidden at Level 1. |
| **Breadcrumb** | Shows `Home › <Collection Name>`. Clicking `Home` returns to Level 1. |
| **Search** | Live-filters the current level by name (case-insensitive substring). |
| **Sort** | Name (A–Z), Date (newest first), Status (minting → wip → confirmed). |
| **+ New Collection** | Disabled while inside a collection. Opens a dialog for a name, inserts an optimistic card, and kicks off the mint in the background. Enabled only at Level 1. |
| **↑ Upload** | Opens a `.glb`/`.gltf` file picker. Writes the file to IPFS, creates an asset manifest, and updates the collection manifest. Available only when a collection is open (Level 2). |

---

#### 5.4.6 Grid vs List view

Toggled by the ⊞/☰ buttons in the status bar. Persisted in `library-state.js`.

- **Grid** — thumbnail cards (`library-item` divs) with the folder/file icon, name, and corner status badge.
- **List** — `<table>` with columns: Name, Status (text badge), Date modified, Size.

Rubber-band selection works in grid view (drag to box-select multiple cards).

---

#### 5.4.7 Selection and keyboard shortcuts

| Key | Action |
|-----|--------|
| Click | Select single item |
| Shift+Click | Extend selection to range |
| Ctrl/Cmd+Click | Toggle individual item in selection |
| Ctrl/Cmd+A | Select all visible items |
| Enter | Open selected item (navigate into collection, or open asset in Studio) |
| Backspace / Alt+← | Go up to collections list (when inside a collection) |
| Delete | Delete selected assets (with confirmation) |
| F2 | Rename selected item |
| Escape | Clear selection |
| Double-click | Open item |

An `aria-live` region (`#libraryLiveRegion`) announces selection changes and navigation events for screen readers.

---

#### 5.4.8 Right-click context menu

Context menu opens on right-click. Content varies by target:

**Empty space (no item selected):**
- New Collection
- Upload File…
- Refresh

**Single collection selected:**
- Open
- Open in Studio
- Rename
- Manage Collaborators
- Burn Collection _(destructive)_

**Single asset selected:**
- Open in Studio
- Send to Collection… _(move or live-reference copy)_
- Rename
- Delete _(destructive)_

**Multiple assets selected:**
- Open first in Studio
- Delete _(destructive)_

---

#### 5.4.9 New Collection — optimistic flow

1. User clicks **+ New Collection** or "New Collection" from the context menu.
2. A dialog prompts for a name.
3. As soon as the user confirms, `createCollectionFlow()` (`ui/library-create.js`) fires:
   - The collection manifest is written to IPFS (`writeJSONToIPFS`).
   - `onPending` is called immediately — a folder card with the `minting` spinner appears at the top of the list. The user can see the card in under a second.
   - The mint transaction is sent in the background (`publishAsset`).
4. On success: the spinner badge flips to the green ✓ (`besked`). A success toast appears.
5. On failure (network error, wallet rejection): the optimistic card disappears. An error toast appears.

For EOA wallets (MetaMask/Rabby), the spinner card appears just before the wallet approval popup. Rejecting the popup removes the card. For CDP email-login smart accounts, the card appears before the sponsored UserOperation is submitted.

---

#### 5.4.10 Upload flow

1. User opens a collection (Level 2), then clicks **↑ Upload** (or right-click → Upload File…).
2. The OS file picker filters to `.glb` / `.gltf`, max 50 MB.
3. The file bytes are written to IPFS (`writeToIPFS`), creating a `sourceCid`.
4. An asset manifest JSON is written to IPFS, creating an `assetManifestCid`.
5. The collection manifest is updated via `updateCollectionManifest`: `assets[assetId] = assetManifestCid`.
6. A new collection manifest CID is written; `updateAssetURI` publishes it on-chain.
7. `refreshLibraryData` is called; the new asset card appears.

---

#### 5.4.11 Opening an asset in Studio

Double-clicking an asset card (or "Open in Studio" from the context menu) navigates to:

```
/studio.html?asset=<collectionTokenId>&assetId=<assetId>
```

Studio loads the collection into the Gallery sidebar and opens the specific asset in the 3D viewport.

---

#### 5.4.12 Wallet popover

Clicking the wallet address button in the headerbar opens a floating popover:

- Truncated address
- Copy to clipboard
- "View on Explorer" link (when on a chain with a known block explorer)
- "Sign In" button (if wallet is connected but a SIWE session has not been established)
- "Log Out" button

---

#### 5.4.13 Source files

| File | Role |
|------|------|
| `frontend/src/pug/library.pug` | HTML template → compiled to `frontend/dist/library.html` |
| `frontend/src/js/library-init.js` | Page bootstrap: wallet gate, data loading, event wiring |
| `frontend/src/js/ui/library-grid.js` | Grid/list rendering, selection, keyboard handling, rubber-band |
| `frontend/src/js/ui/library-toolbar.js` | Toolbar rendering and event handlers |
| `frontend/src/js/ui/library-context-menu.js` | Right-click menu construction and actions |
| `frontend/src/js/ui/library-create.js` | Optimistic collection-create flow (shared by toolbar + context menu) |
| `frontend/src/js/services/library-ops.js` | `createNamedCollection(name, { onPending })`, `uploadFileToCollection` |
| `frontend/src/js/state/library-state.js` | Reactive store: collections, assets, currentCollectionTokenId, selection, view, sort, search |
| `frontend/src/js/utils/library-items.js` | Filter, sort, range selection, bytes formatter |

### 5.5 Gallery Flow

```text
Wallet connected
  → contract.getPastEvents('Transfer', { filter: { to: owner } })
  → tokenURI(tokenId)
  → if tokenURI points to a collection manifest, expand each assets[assetID] entry
  → get asset manifests from IPFS gateway/cache
  → display asset name and optional thumbnail
```

### 5.6 Studio URL Loading Flow

The Studio supports deep-linking tokens and individual assets via query params:

```text
/studio.html?asset=<tokenId>
/studio.html?asset=<tokenId>&assetId=<assetID>
```

| URL | Behavior |
|---|---|
| `?asset=<tokenId>` (standalone asset token) | Loads the asset manifest into the viewport. |
| `?asset=<tokenId>` (collection token) | Loads the collection manifest into the **Gallery sidebar** but leaves the **viewport empty**. No asset is auto-opened. The URL is not rewritten with an `assetId`. |
| `?asset=<tokenId>&assetId=<assetID>` (collection token) | Loads the collection manifest into the Gallery and opens the specified asset in the viewport. |

This means a bare collection URL is a "collection overview" state: the user sees all assets in the Gallery and can choose which one to load. Gallery card clicks and "Open in Studio" context-menu items still navigate with an explicit `assetId` when a specific asset is intended.

---

## 6. Storage and Caching Strategy

### IPFS Objects

| Content | Stored as | Referenced by |
|---|---|---|
| GLB/GLTF asset | raw bytes or JSON | `node.source.cid`, `history[].src.cid` |
| Asset manifest | JSON | collection manifest `assets` map |
| Collection manifest | JSON | token URI |
| Publish thumbnail | WebP bytes | `manifest.thumbnail.cid` |
| Comments archive | JSON array of Nostr events | `manifest.comments_archive_cid` |
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
| Unpaid generation | Backend validates session auth + rate limit; on-chain payment/quota is enforced by the contract (`recordGeneration` / `payForGenerationWithUSDC`) | Verify signer/tx sender/event payload alignment |
| Replay generation | In-memory `usedTxHashes` plus manifest-chain walk | Phase 5 durable ledger-backed replay index |
| Private keys/API keys | `.env` files ignored by Git | Secret scanning / deployment secret management |
| IPFS public exposure | Docker ports bound to loopback, no DHT/bootstrap | Deployment hardening checklist |
| Mock assets in prod | `MOCK_3D_GENERATION` env flag | Explicit production adapter config validation |
| Embedded thumbnail bloat | Backend strips `dataUrl` and stores CID only | Optional thumbnail size/crop UI |
| Unauthorized URI update/burn | Merkle proof required | Multi-sig owner for high-value collections |
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
- Contract addresses are hardcoded in 3 places (`src/config.js`, `frontend/src/js/blockchain/network-config.js`, `blockchain/.env`). Chain IDs are consolidated in `constants/chains.js`.
- Frontend build uses custom Node.js scripts (no bundler — no tree-shaking, HMR, or code splitting).
- `scene.nodes[].history` is defined in the manifest schema and is read by the ledger panel and burn cleanup, but current generation/save paths do not populate it; the manifest chain is the effective source of version history.
