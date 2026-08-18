# Arbesk System Architecture

> Status: Current v0.9 — Phases 1–5.4 complete (token child assets, free-tier contract, Merkle editor proofs, collection manifests). CDP email-login smart accounts, unified Studio + Library SPA, asset-level Nostr comments, and token indexer implemented.
> Scope: Full-stack architecture for private-IPFS 3D generation, fractal manifest versioning, free-tier + EVM PayGo, token child assets, collection manifests, and studio publishing

---

## 1. Vision

Arbesk is a local-first 3D asset studio built around **fractal manifests**: every asset is a content-addressed JSON document whose nodes point to 3D assets, transforms, child manifests, and optional publish thumbnails. The manifest is agnostic to the underlying asset data — it only references content-addressed sources; the asset bytes themselves (glTF/GLB) carry their own revision state.

The system currently combines:

- **Mock-backed generative 3D flow** via Express and private IPFS
- **Parametric versioning** for free color/scale changes
- **Babylon.js rendering** with GLB/GLTF loading and one-node-per-asset replacement behavior
- **Free-tier on-chain generation quota** via `ArbeskAssetFree.recordGeneration()` (10/day per wallet; contract `owner()` bypasses quota)
- **EVM PayGo** generation payments and ERC721 asset ownership via `ArbeskAsset` (paid tier)
- **Collection manifests** — every published token is a collection manifest that maps `assetID`s to asset manifest CIDs
- **Off-chain Merkle editor proofs** — the contract stores only a Merkle root; the full editor list lives on IPFS and is proved at call time
- **Private Dockerized Kubo/IPFS** for local content-addressed storage; Pinata-backed storage for public testnet
- **Dockerized Hardhat** for reproducible local EVM development
- **Base Sepolia Testnet** as the public testnet target (Hardhat local for dev)
- **Optional WebP publish thumbnails** stored as separate IPFS assets and referenced by manifest metadata
- **On-demand browser IPFS cache** using memory + IndexedDB

---

## 2. High-Level System Diagram

```text
┌────────────────────────────────────────────────────────────────────┐
│                            Browser Studio                           │
│                                                                     │
│  Pug/SCSS shell                                                      │
│  ├─ AI Generation + asset definition panel                           │
│  ├─ Babylon.js viewport                                              │
│  ├─ Node inspector: color + scale                                    │
│  ├─ History browser / manifest chain timeline (client-side walk)     │
│  ├─ Gallery with optional thumbnails                                 │
│  ├─ Team editor panel                                                │
│  └─ Activity ledger (client-side chain walk)                         │
│                                                                      │
│  Frontend services                                                   │
│  ├─ wallet-core.ts / wallet-connect.ts / wallet-discovery.ts /       │
│  │  wallet-payments.ts / wallet-publishing.ts:                        │
│  │  custom wallet picker (EIP-6963 + WalletConnect v2), network       │
│  │  switching, free/paid generation, mint/update/                     │
│  │  editor/burn calls (re-exported via wallet.ts barrel);             │
│  │  auto-restore on reload for CDP, EOA, and WalletConnect via silent  │
│  │  eth_accounts / session checks — no popup is shown                  │
│  ├─ remote-ipfs.ts: gateway reads + memory/IndexedDB cache           │
│  ├─ write-to-ipfs.ts: direct browser→IPFS writes (Kubo/Pinata)       │
│  ├─ asset-save.ts + services/asset-save/:                            │
│  │  save/publish, manifest builder, collection merge, thumbnail capture│
│  ├─ asset-library.ts: token gallery with collection expansion        │
│  ├─ token-resolver.ts: on-chain child_ref resolution (no server)     │
│  ├─ time-travel.ts: manifest chain walking (no server)              │
│  ├─ team.ts: Merkle editor list add/remove                           │
│  ├─ merkle-editors.ts: computeRoot / getProof / makeLeaf             │
│  ├─ comment-thread.ts: per-asset Nostr thread state                  │
│  ├─ comments-panel.ts: asset comment UI                              │
│  ├─ library-controller.ts + library-grid.ts / library-toolbar.ts     │
│  │  / library-context-menu.ts: Library view inside unified SPA       │
│  └─ library-ops.ts: create collection, upload glTF/GLB file          │
│                                                                      │
│  IPFS writes happen directly from the browser:                       │
│  ├─ Thumbnails: captureAssetThumbnail() → writeToIPFS()              │
│  ├─ Manifests: writeJSONToIPFS() in services/api.ts (generation) and │
│  │  services/asset-save/manifest-builder.ts (save/publish)           │
│  ├─ Generation: api.ts receives bytes, uploads to IPFS               │
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
│                              │   │ Base Sepolia: sepolia.base.org   │
│                              │   │ CDP passthrough: publicnode.com  │
│                              │   │ (browser RPC)                    │
└──────────────────────────────┘   └──────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 Backend (`src/`)

| File | Responsibility |
|---|---|
| `src/index.ts` | Express app, static frontend serving, request logging, body limits, CSP, Chat WebSocket |
| `src/api/index.ts` | Route registry — mounts all `/api/v1` routes |
| `src/api/routes/` | Per-domain route modules (`comments.ts`, `ipfs.ts`, `contracts.ts`, `indexer.ts`, `paymaster.ts`, `openapi.ts`, `test-utils.ts`) |
| `src/api/assets/generate-node.ts` | Session-auth generation route — calls mock adapter, returns raw bytes (no IPFS writes) |
| `src/api/storage/index.ts` | Storage backend abstraction (`kubo` or `pinata`) |
| `src/api/storage/pinata-adapter.ts` | Pinata v3 SDK uploads + presigned upload URLs |
| `src/api/storage/kubo-adapter.ts` | Local Kubo `add`/`cat`/`pin.rm`/`addDirectory` |
| `src/api/authorization.ts` | On-chain asset access checks for chat proxy (owner or Merkle editor proof) |
| *(client-side only)* | Parametric editing, manifest writes, thumbnail upload, manifest-chain walks, token resolution — all browser-side |
| `src/api/authentication.ts` | Session token validation, sets `res.locals.userAddress` |
| `src/api/sessions.ts` | SIWE session create/delete (24h TTL) |
| `src/api/siwe-verify.ts` | EIP-4361 message verification (supports `eoaAddress` for CDP smart accounts) |
| `src/api/routes/paymaster.ts` | CDP Paymaster JSON-RPC proxy (keeps `CDP_PAYMASTER_URL` server-side) |
| `src/api/rate-limiter.ts` | In-memory route rate limiter |
| `src/api/abi-router.ts` | Serves compiled contract artifacts by name |
| `src/api/adapters/mock-adapter.ts` | Deterministic local asset generation for development/tests |
| `src/api/comments-archive.ts` | Snapshots Nostr comment threads to IPFS on republish |
| `src/api/chat-proxy.ts` | WebSocket bridge: browser ↔ Nostr relay (session-gated) |
| `src/api/nostr-relay.ts` | Shared relay primitives (used by chat-proxy + comments-archive) |
| `src/api/manifest-utils.ts` | getSceneNodes (used by the manifest chain walker) |
| `src/api/ipfs-utils.ts` | catManifest() with timeout/abort |
| `src/config.ts` | Multi-network Web3 config (Hardhat local, Base Sepolia Testnet) |

### 3.2 Frontend (`frontend/src/js/`)

| Area | Files | Responsibility |
|---|---|---|
| Engine | `engine/scene-graph.ts` | Babylon engine/scene, GLB/glTF load, selection, framing, thumbnail capture, collection load |
| Engine | `engine/camera-persistence.ts` | Per-asset camera pose save/restore in localStorage; restore on `SCENE_READY` with post-restore settle |
| Engine | `engine/time-travel.ts` | Manifest chain walking (client-side), version switching, parametric application |
| Engine | `engine/parametric-preview.ts` | Live color/scale inspector preview and save |
| IPFS | `ipfs/remote-ipfs.ts` | Gateway reads with memory + IndexedDB cache |
| IPFS | `ipfs/write-to-ipfs.ts` | Direct browser→IPFS writes (Kubo `:5001` or Pinata presigned URLs) |
| glTF | `gltf/decomposer.ts` / `async-gltf.ts` | Breaks monolithic glTF/GLB into composite IPFS CIDs, uploads parts directly |
| glTF | `gltf/material-editor.ts` | Edits PBR material properties on composite glTFs and commits new CIDs |
| glTF | `gltf/composer.ts` | Resolves `ipfs://` URIs back to base64 for Babylon (gateway reads) |
| glTF | `gltf/merkle-editors.ts` | Merkle tree/proof library for editor authorization |
| Blockchain | `blockchain/wallet.ts` | Backward-compat barrel re-exporting `wallet-core.ts`, `wallet-connect.ts`, `wallet-network.ts`, `wallet-payments.ts`, `wallet-publishing.ts`, `wallet-guard.ts` |
| Blockchain | `blockchain/wallet-core.ts` | Web3 init, connect/disconnect, account state; full auto-restore on reload (CDP/EOA/WalletConnect) |
| Blockchain | `blockchain/wallet-connect.ts` | WalletConnect v2 integration |
| Blockchain | `blockchain/wallet-discovery.ts` | EIP-6963 injected wallets + WalletConnect v2 discovery |
| Blockchain | `blockchain/wallet-network.ts` | Network switching |
| Blockchain | `blockchain/wallet-payments.ts` | Free-tier `recordGeneration()`, USDC PayGo `payForGenerationWithUSDC()` |
| Blockchain | `blockchain/wallet-publishing.ts` | Mint, `updateAssetURI()`, `updateEditors()`, `burn()` |
| Blockchain | `blockchain/wallet-cdp.ts` | CDP email-OTP login, ERC-4337 smart account, EIP-1193 shim for Web3.js |
| Blockchain | `blockchain/network-config.ts` | Per-network contract/USDC/RPC configuration |
| Blockchain | `blockchain/token-resolver.ts` | Resolve `child_ref` tokens to manifest CIDs (client-side, no server) |
| UI | `ui/wallet-modal.ts` | Custom email/Web3 wallet picker modal (not Web3Modal) |
| UI | `ui/header-wallet-button.ts` | Header wallet button; shows email for CDP users, hides network selector |
| UI | `ui/create-panel.ts` | Prompt flow, asset definition controls, generation trigger |
| UI | `ui/asset-save.ts` | Save/publish lifecycle UI; delegates manifest building to `services/asset-save/` |
| UI | `ui/asset-library.ts` | Token gallery, collection expansion, thumbnail rendering |
| Domain / UI | `domain/version-history-store.ts`, `ui/version-clock.ts`, `ui/scene-clock.ts`, `ui/model-clock-gizmo.ts` | Version history store + scene/model clock UIs |
| UI | `ui/collaborators-panel.ts` | Editor list / add/remove UI |
| UI | `ui/comments-panel.ts` | Asset-level comment thread UI |
| UI | `ui/ledger-panel.ts` | Activity feed — walks manifest chain client-side, fetches full manifests |
| Services | `services/api.ts` | API client: sessions, generation, comments archive snapshot, upload credential, unpin |
| Services | `services/asset-save/manifest-builder.ts` | Manifest assembly, version bumping, comment archive embedding |
| Services | `services/asset-save/collection-publish.ts` | New collection mint / existing collection URI update |
| Services | `services/asset-save/editor-publish.ts` | Republish authorization for editors (Merkle proof) |
| Services | `services/team.ts` | Merkle-based editor add/remove |
| Services | `services/asset-delete.ts` | Remove an asset from a collection (direct IPFS write) |
| Services | `services/comment-thread.ts` | Per-asset Nostr WebSocket + archive state |
| UI | `pug/includes/*.pug` (shell: `pug/app.pug`) | Unified Studio + Library SPA shell (built to `dist/app.html`) |
| UI | `ui/library-grid.ts` | Library grid/list rendering, selection, keyboard shortcuts, rubber-band select |
| UI | `ui/library-toolbar.ts` | Breadcrumb, search, sort, view mode, New Collection, Upload |
| UI | `ui/library-context-menu.ts` | Right-click actions: Open, Open in Studio, Rename, Manage Collaborators, Burn, Delete, Send to Collection |
| Services | `services/library-ops.ts` | `createNamedCollection()`, `uploadFileToCollection()` |
| Services | `utils/library-items.ts` | Filter, sort, range selection, bytes formatter |

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
| `baseSepolia` | Public testnet target | Backend RPC `https://sepolia.base.org`; CDP smart-wallet browser passthrough `https://base-sepolia-rpc.publicnode.com` |

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
  "name": "My Asset",
  "version": 4,
  "timestamp": 1780000000,
  "prev_asset_manifest_cid": "bafyPreviousManifest...",
  "comments_archive_cid": "bafyCommentsArchiveCid...",
  "metadata": {
    "chat": [
      {
        "prompt": "A wooden house",
        "provider": "mock",
        "task": "model",
        "taskId": "tripo-task-abc123",
        "timestamp": 1780000000
      }
    ]
  },
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
        "child_ref": {
          "collection": {
            "chainId": 31415822,
            "contractAddress": "0x1234567890abcdef1234567890abcdef12345678",
            "tokenId": "42"
          },
          "assetID": "asset-123"
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

**`comments_archive_cid`.** Holds the CID of a JSON archive of Nostr comments for this specific asset. Comments are scoped per asset using the tag `<chainId>:<contractAddress>:<tokenId>:<assetId>`; switching assets inside the same collection shows a different thread. The archive is created on republish by `POST /api/v1/assets/snapshot-comments` and loaded by `services/comment-thread.ts` before live relay events are merged. If the relay is unreachable during republish, the endpoint returns an empty archive (`eventCount: 0`) instead of failing, so republish stays resilient.

**Manifest–asset boundary.** The asset manifest references content-addressed sources and is format-agnostic to the underlying 3D data. Each saved or published version is a complete snapshot, and the manifest chain (`prev_asset_manifest_cid`) provides asset-level history.

**Chat provenance (`metadata.chat`).** Each manifest version produced by AI chat activity carries a top-level `metadata.chat` array holding the prompts consumed since the previous version: `{prompt, provider, task, taskId?, timestamp}`. Entries are version-scoped — the full conversation is reconstructed by walking `prev_asset_manifest_cid` and concatenating each version's array, oldest to newest. Records are written at save/publish time only (save-anchored); unaccepted generations stay ephemeral. `taskId` holds the provider-side task ID (e.g. Tripo) for future cross-session enhance flows. Versions with no AI activity omit the field.

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
- **Temporal isolation**: Loading a specific manifest CID renders the exact asset state at that version. The chain enables time-travel without re-rendering unrelated nodes.

**How the chain is used:**

| Consumer | Description |
|---|---|
| Version clock UI | Frontend (`time-travel.ts` / `domain/version-history-store.ts` / `ui/scene-clock.ts` / `ui/model-clock-gizmo.ts`) walks `prev_asset_manifest_cid` client-side and renders scene/model version clocks |
| Activity ledger | Frontend (`ledger-panel.ts`) walks the chain to render the activity feed |
| Burn cleanup | Backend (`POST /api/v1/ipfs/unpin`) walks the chain and collects source CIDs from `node.source` |
| Replay prevention | In-memory `usedTxHashes` set plus chain walk to detect duplicate on-chain generation transactions |

### Design Advantage: Provenance Lives in the Asset, Not the Contract

The system deliberately splits state by durability requirement:

| Layer | Contents | Property |
|---|---|---|
| **IPFS manifest chain** (the provenance chain) | Full version history, parametric edit history, chat provenance (`metadata.chat` per version), thumbnails | Immutable, content-addressed, survives any contract migration |
| **On-chain (contract)** | Three pointers per token: owner, tip CID (`tokenURI`), editor root + version | Mutable, minimal, replaceable |

The contract is a **pointer registry, not a database**. Everything that makes an asset's history valuable is already committed to IPFS at save time — the chain only records *who* owns the tip and *which* CID is current.

Consequences worth calling out (good demo/presentation talking points):

- **Contracts become replaceable infrastructure.** Migrating to a new contract version moves only three small values per token; the entire provenance chain comes along for free because the new contract points at the same tip CID. (This is the basis of the v2 migration plan in issue #50.)
- **History can never be lost to on-chain failure or upgrade.** Worst case during a migration is a *stale pointer*, never lost history — and a stale pointer is repaired by re-reading the old contract.
- **Verification is trustless and client-side.** Anyone can walk `prev_asset_manifest_cid` from the tip and re-hash every step; no server or contract vouches for the chain — the CIDs are the proof.
- **Cheap writes.** Provenance doesn't pay gas: every save/draft/version is an IPFS write; only publish touches the chain.

### Version Snapshot Types

Every entry in the manifest chain is a complete snapshot. The difference between snapshot types is in how the node content changes:

| Type | Trigger | Payment | Asset CID changes? | Notes |
|---|---:|---:|---:|---|
| `generation` | Prompt generation | Yes | Yes | Uses PayGo tx validation and mock/cloud adapter; new asset bytes are uploaded to IPFS |
| `parametric` | Color/scale edit | No | Sometimes | Decomposed/color edits are baked into a new composite glTF CID; monolithic/scale edits are stored as `node.post_processor` runtime overlays without changing `source.cid` |

### Thumbnail Handling

During publish:

1. `scene-graph.ts` captures the Babylon canvas into a WebP blob.
2. `captureAssetThumbnail()` uploads the blob directly to IPFS via `writeToIPFS()` and returns CID metadata (no `dataUrl` — the browser writes to IPFS directly, same as glTF buffer uploads).
3. `services/asset-save/manifest-builder.ts` places the CID metadata into `manifest.thumbnail`.
4. The stored manifest contains only thumbnail metadata + CID.
5. `asset-library.ts` reads `manifest.thumbnail.cid` and renders it through the IPFS gateway.

---

## 5. Data Flows

### 5.1 Generation Flow

```text
User prompt
  → services/api.ts#getOrCreateSession() → POST /api/v1/sessions → Session token
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

### 5.4 Library View (inside the unified SPA)

The Library is no longer a separate page — it lives in the same document as Studio (`frontend/dist/app.html`). `frontend/src/js/app/router.ts` swaps visibility between `#studioView` and `#libraryView`; the Babylon engine pauses while Library is active and resumes on return. This keeps wallet state, theme, session, and the event bus alive across Studio ⇄ Library navigation. The Library view is bootstrapped by `app-init.ts` and rendered by `library-controller.ts`, `library-grid.ts`, `library-toolbar.ts`, and `library-context-menu.ts`.

---

#### 5.4.1 Page structure (what the browser renders)

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADERBAR                                                      │
│  [Logo]  [Library ●] [Studio]      [☀/☾] [Network ▾] [Login]  │
│                                                                 │
│  *CDP email-login users: network selector is hidden; header      │
│   shows the authenticated email address instead of a wallet.     │
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

The gate is toggled by `applyWalletGate()` in `library-controller.ts` in response to `WALLET_STATE_CHANGED` events.

---

#### 5.4.3 Two-level navigation (Collections → Assets)

The Library operates as a two-level browser. State is held in `library-state.ts` (`currentCollectionTokenId`).

**Level 1 — Collections list** (`currentCollectionTokenId === null`):

- Loaded at wallet connect via the token indexer:
  - `GET /api/v1/indexer/owned` returns owned tokens via chunked `eth_getLogs` backfill of ERC-721 `Transfer` events.
  - `GET /api/v1/indexer/shared` returns tokens where the wallet is a Merkle editor but not the owner. The indexer scans `EditorSetChanged` events, reads the on-chain `editorListURI`, fetches the editor list from IPFS, and builds a reverse index of editor address → token IDs.
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

Toggled by the ⊞/☰ buttons in the status bar. Persisted in `library-state.ts`.

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
3. As soon as the user confirms, `createCollectionFlow()` (`ui/library-create.ts`) fires:
   - The collection manifest is written to IPFS (`writeJSONToIPFS`).
   - `onPending` is called immediately — a folder card with the `minting` spinner appears at the top of the list. The user can see the card in under a second.
   - The mint transaction is sent in the background (`publishAsset`).
4. On success: the spinner badge flips to the green ✓ (`besked`) directly in the existing card; no full page refresh occurs. A success toast appears.
5. On failure (network error, wallet rejection): the optimistic card disappears. An error toast appears.

Burning a collection from the context menu likewise removes the card locally without a full refresh.

For EOA wallets (MetaMask/Rabby), the spinner card appears just before the wallet approval popup. Rejecting the popup removes the card. For CDP email-login smart accounts, the card appears before the sponsored UserOperation is submitted.

---

#### 5.4.10 Upload flow

1. User opens a collection (Level 2), then clicks **↑ Upload** (or right-click → Upload File…).
2. The OS file picker filters to `.glb` / `.gltf` / `.3mf`, max 100 MB.
3. The file bytes are written to IPFS (`writeToIPFS`), creating a `sourceCid`.
4. An asset manifest JSON is written to IPFS, creating an `assetManifestCid`.
5. The collection manifest is updated via `updateCollectionManifest`: `assets[assetId] = assetManifestCid`.
6. A new collection manifest CID is written; `updateAssetURI` publishes it on-chain.
7. `refreshLibraryData` is called; the new asset card appears.

Dropping a `.glb` / `.gltf` / `.3mf` file onto the Studio viewport reuses the same stage/decompose helper (`stageUploadSource` in `services/library-ops.ts`) at drop time, then routes through `services/asset-file-drop.ts`: with an asset open it replaces the root model node's source in place (staged as a `pendingSourceOverrides` entry — linked children, transforms, and history survive); with no asset open it creates a new unsaved draft named after the file. The normal Save Draft / Publish pipeline bakes the override into the next manifest version. Both paths then emit `ASSET_FILE_STAGED`, and the create panel presents the staged model as a version-card chat bubble with the standard follow-up action row (Retopo/Retexture/Auto-rig/Animate run off the staged `sourceAssetCid`; known non-glTF formats get no row).

---

#### 5.4.11 Opening an asset in Studio

Double-clicking an asset card (or "Open in Studio" from the context menu) navigates to:

```
/studio?asset=<collectionTokenId>&assetId=<assetId>
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
| `frontend/src/pug/app.pug` | Slim SPA shell that includes `frontend/src/pug/includes/*.pug` partials → compiled to `frontend/dist/app.html` |
| `frontend/src/js/app/router.ts` | Client-side view router: toggles `#studioView` / `#libraryView`, drives engine pause/resume |
| `frontend/src/js/ui/header-wallet-button.ts` | Shared header wallet button; shows email for CDP users and hides the network selector |
| `frontend/src/js/app-init.ts` | SPA bootstrap incl. Library view wiring: wallet gate, data loading, event wiring |
| `frontend/src/js/ui/library-controller.ts` | Library view orchestration and Studio handoff |
| `frontend/src/js/ui/library-grid.ts` | Grid/list rendering, selection, keyboard handling, rubber-band |
| `frontend/src/js/ui/library-toolbar.ts` | Toolbar rendering and event handlers |
| `frontend/src/js/ui/library-context-menu.ts` | Right-click menu construction and actions |
| `frontend/src/js/ui/library-create.ts` | Optimistic collection-create flow (shared by toolbar + context menu) |
| `frontend/src/js/services/library-ops.ts` | `createNamedCollection(name, { onPending })`, `uploadFileToCollection` |
| `frontend/src/js/state/library-state.ts` | Reactive store: collections, assets, currentCollectionTokenId, selection, view, sort, search |
| `frontend/src/js/utils/library-items.ts` | Filter, sort, range selection, bytes formatter |

### 5.5 Gallery Flow

```text
Wallet connected
  → GET /api/v1/indexer/owned (chunked eth_getLogs backfill for owned tokens)
  → GET /api/v1/indexer/shared (editor-shared tokens from EditorSetChanged events + IPFS editor lists)
  → tokenURI(tokenId)
  → if tokenURI points to a collection manifest, expand each assets[assetID] entry
  → get asset manifests from IPFS gateway/cache
  → display asset name and optional thumbnail
```

### 5.6 Studio URL Loading Flow

The Studio supports deep-linking tokens and individual assets via query params:

```text
/studio?asset=<tokenId>
/studio?asset=<tokenId>&assetId=<assetID>
```

| URL | Behavior |
|---|---|
| `?asset=<tokenId>` (standalone asset token) | Loads the asset manifest into the viewport. |
| `?asset=<tokenId>` (collection token) | Loads the collection manifest into the **Gallery sidebar** but leaves the **viewport empty**. No asset is auto-opened. The URL is not rewritten with an `assetId`. |
| `?asset=<tokenId>&assetId=<assetID>` (collection token) | Loads the collection manifest into the Gallery and opens the specified asset in the viewport. |

This means a bare collection URL is a "collection overview" state: the user sees all assets in the Gallery and can choose which one to load. Gallery card clicks and "Open in Studio" context-menu items still navigate with an explicit `assetId` when a specific asset is intended.

### 5.7 Studio Viewport Camera Persistence

The Studio remembers the last camera pose for each asset independently, so reopening an asset lands on the exact view the user left it in. Persistence is implemented in `frontend/src/js/engine/camera-persistence.ts` and integrated into `engine/scene-graph.ts`.

**Storage key**

- Saved assets: `<chainId>:<contractAddress>:<tokenId>:<assetId>` (canonical asset identity, lower-cased contract address). The pose follows the asset across publishes and version-history restores, not any single manifest version.
- Unsaved drafts (no on-chain identity): `cid:<manifestCid>`, keyed to the current draft manifest CID.
- Prefix: `arbesk:cameraPose:` in `localStorage`.

**Saved pose**

`alpha`, `beta`, `radius`, `target`, `mode`, and (when in orthographic mode) `orthoLeft/Right/Bottom/Top`. Writes are debounced to one per second and flushed on `beforeunload` / `visibilitychange` so the last movement before closing the tab is not lost.

**Restore timing**

`restoreCameraPose()` is called on the `SCENE_READY` event, which fires after the active asset's manifest and model have loaded. If no pose is stored, the camera is reset to the default starting view (`alpha = -π/2`, `beta = π/3`, `radius = 15`, target at origin) so a scene never inherits the previous scene's camera.

**Drift-proofing**

Babylon v9 applies smooth transitions and residual inertia after a restore, which can drag the camera away from the stored pose long enough that the drifted pose gets saved over the good one. The implementation counters this by:

1. Zeroing all `inertial*` offsets and stopping camera animations before applying the pose.
2. Re-applying the restored pose every frame for 90 frames (~1.5 s) in an `onAfterRenderObservable` callback.
3. Cancelling the settle enforcement immediately on any pointer down or wheel input so the user is never fought.

Storage failures (private mode, quota) are silently ignored; persistence is best-effort.

---

## 6. Storage and Caching Strategy

### IPFS Objects

| Content | Stored as | Referenced by |
|---|---|---|
| GLB/GLTF asset | raw bytes or JSON | `node.source.cid` |
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

`frontend/src/js/ipfs/remote-ipfs.ts` caches on demand only:

- memory map for fast repeat reads in a session
- IndexedDB object store for persistence
- separate cache keys by gateway URL, CID, and payload kind (`json`, `text`, `blob`)

No background prefetching or cache warming is performed. (Note: the cache is currently disabled by default in code.)

---

## 7. Security Model

| Risk | Current Mitigation | Planned Improvement |
|---|---|---|
| Unpaid generation | Backend validates session auth + rate limit; on-chain payment/quota is enforced by the contract (`recordGeneration` / `payForGenerationWithUSDC`) | Verify signer/tx sender/event payload alignment |
| Replay generation | In-memory `usedTxHashes` plus manifest-chain walk | Durable replay index |
| Private keys/API keys | `.env` files ignored by Git | Secret scanning / deployment secret management |
| IPFS public exposure | Docker ports bound to loopback, no DHT/bootstrap | Deployment hardening checklist |
| Mock assets in prod | `MOCK_3D_GENERATION` env flag | Explicit production adapter config validation |
| Embedded thumbnail bloat | Backend strips `dataUrl` and stores CID only | Optional thumbnail size/crop UI |
| Unauthorized URI update/burn | Merkle proof required | Multi-sig owner for high-value collections |
| Editor list tampering | On-chain Merkle root verifies IPFS list integrity | Periodic root consistency checks |

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

## 9. Phase 5.1: Token ID-Based Child Assets (Complete)

Child assets are referenced by on-chain token IDs. The parent manifest stores a `child_ref` with `{ collection: { chainId, contractAddress, tokenId }, assetID }`; at load time the browser resolves the referenced collection manifest CID via `tokenURI()`, then loads the relevant `assetID` from the collection's `assets` map.

Key constraints still in force:
- Every token child node must have a `transform_matrix`; no local `history` array
- Token child nodes do not contain a local `source`; their state is resolved from the referenced token's manifest chain
- `MAX_CHILD_ASSET_DEPTH = 5`; cycle detection enforced in `scene-graph.ts`
- Resolver: `frontend/src/js/blockchain/token-resolver.ts`

---

## 10. Known Gaps

- Production cloud 3D adapters are not implemented (mock-only, returns 501 when disabled).
- OpenSCAD WASM integration is schema-compatible but deferred.
- `GET /api/health` is a planned route, not a current backend route.
- IPFS browser reads rely on the browser HTTP cache (immutable CID responses) + request coalescing; the glTF pipeline adds memory + IndexedDB caching (`utils/content-cache.ts`). There is no app-level gateway read cache.
- CSP is in report-only mode; should be promoted to enforcing after monitoring.
- Contract addresses are hardcoded in 3 places (`src/config.ts`, `frontend/src/js/blockchain/network-config.ts`, `blockchain/.env`). Chain IDs are consolidated in `constants/chains.js`.
- Frontend build uses custom Node.js scripts (no bundler — no tree-shaking, HMR, or code splitting).
