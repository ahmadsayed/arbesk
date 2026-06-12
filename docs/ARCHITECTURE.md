# Arbesk System Architecture

> Status: Current v0.4 — Phases 1–4 complete, publishing polish complete, Phase 5.2 free tier complete, Phase 5 planned  
> Scope: Full-stack architecture for private-IPFS 3D generation, fractal manifest versioning, free-tier + EVM PayGo, and studio publishing

---

## 1. Vision

Arbesk is a local-first 3D world studio built around **fractal manifests**: every world is a content-addressed JSON document whose nodes point to 3D assets, transforms, history entries, child manifests, and optional publish thumbnails.

The system currently combines:

- **Mock-backed generative 3D flow** via Express and private IPFS
- **Parametric versioning** for free color/scale changes
- **Babylon.js rendering** with GLB/GLTF loading and one-node-per-world replacement behavior
- **Free-tier on-chain generation quota** via `ArbeskAssetFree.recordGeneration()` (10/day per wallet, owner bypass)
- **EVM PayGo** generation payments and ERC721 world ownership via `ArbeskAsset` (paid tier)
- **Team collaboration** through token URI editor permissions
- **Private Dockerized Kubo/IPFS** for local content-addressed storage
- **Dockerized Hardhat** for reproducible local EVM development
- **Optimism Sepolia / Optimism mainnet** as the public network targets (Hardhat local for dev)
- **Optional WebP publish thumbnails** stored as separate IPFS assets and referenced by manifest metadata
- **On-demand browser IPFS cache** using memory + IndexedDB

Phase 5 will add an append-only micro-ledger for durable auditability.

---

## 2. High-Level System Diagram

```text
┌────────────────────────────────────────────────────────────────────┐
│                            Browser Studio                           │
│                                                                    │
│  Pug/SCSS shell                                                     │
│  ├─ Chat + asset definition panel                                   │
│  ├─ Babylon.js viewport                                             │
│  ├─ Node inspector: color + scale                                   │
│  ├─ History browser / manifest chain timeline                       │
│  ├─ Gallery with optional thumbnails                                │
│  └─ Team editor panel                                               │
│                                                                    │
│  Frontend services                                                  │
│  ├─ wallet.js: Web3Modal/Web3 + ArbeskAssetFree / ArbeskAsset calls │
│  ├─ remote-ipfs.js: gateway reads + memory/IndexedDB cache          │
│  └─ asset-save.js: save/publish + WebP thumbnail capture            │
└───────────────────────────────┬────────────────────────────────────┘
                                │ HTTP + wallet txs
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                           Express Backend                           │
│                                                                    │
│  /api/v1/generations                                           │
│  ├─ Bearer txHash signature auth                                    │
│  ├─ EVM/Hardhat receipt validation                                 │
│  ├─ AssetGenerationPaid event validation                            │
│  ├─ Mock generation adapter                                         │
│  └─ IPFS asset + manifest writes                                    │
│                                                                    │
│  *(parametric edits are client-side)*                               │
│  └─ Free color/scale history entries applied in browser             │
│                                                                    │
│  /api/v1/manifests, /api/v1/manifests/:cid/publish                                 │
│  └─ Manifest writes + optional thumbnail normalization              │
│                                                                    │
│  /api/v1/manifests/:cid/history, /api/v1/tokens/:tokenId/manifest, /api/v1/contracts/:name/abi              │
└───────────────┬───────────────────────────────┬────────────────────┘
                │                               │
                ▼                               ▼
┌──────────────────────────────┐   ┌─────────────────────────────────┐
│ Private Kubo/IPFS             │   │ EVM (Hardhat/Optimism)           │
│ 127.0.0.1:5001 API            │   │ ArbeskAssetFree.sol (free tier)   │
│ 127.0.0.1:8080 gateway        │   │ ArbeskAsset.sol (paid tier)      │
│ No DHT / no bootstrap peers   │   │ ├─ recordGeneration              │
│ Stores assets, manifests,     │   │ ├─ payForGeneration              │
│ thumbnails                    │   │ ├─ publishAsset / updateAssetURI │
└──────────────────────────────┘   │ └─ addEditor / removeEditor      │
                                   │ Local RPC: 127.0.0.1:8545       │
                                   └─────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 Backend (`src/`)

| File | Responsibility |
|---|---|
| `src/index.js` | Express app, static frontend serving, request logging, body limits |
| `src/api/index.js` | Route registry, IPFS helper reads, manifest save/publish, thumbnail normalization |
| `src/api/assets/generate-node.js` | Authenticated PayGo generation route, tx/event validation, mock adapter, manifest updates |
| *(client-side only)* | Parametric editing happens in browser; no dedicated backend route |
| `src/api/authentication.js` | Bearer signature parsing, wallet recovery, tx receipt verification |
| `src/api/rate-limiter.js` | In-memory route rate limiter |
| `src/api/abi-router.js` | Serves compiled `ArbeskAsset` artifact |
| `src/api/adapters/mock-adapter.js` | Deterministic local asset generation for development/tests |

### 3.2 Frontend (`frontend/src/js/`)

| Area | Files | Responsibility |
|---|---|---|
| Engine | `engine/scene-graph.js` | Babylon engine/scene, GLB/GLTF loading, node metadata, scene clearing, thumbnail capture |
| Engine | `engine/time-travel.js` | History version switching and parametric application |
| Engine | `engine/parametric-preview.js` | Live color/scale inspector preview and save |
| IPFS | `ipfs/remote-ipfs.js` | Private gateway reads with memory + IndexedDB cache |
| glTF | `gltf/uri_to_cid.js` | Rehydrates CID-based glTF buffer URIs for rendering |
| Blockchain | `blockchain/wallet.js` | Web3Modal, wallet connection, EVM switching, PayGo, mint/update URI, editor calls |
| UI | `ui/create-panel.js` | Prompt flow and asset definition controls |
| UI | `ui/asset-save.js` | Save/publish lifecycle, WebP thumbnail capture, token mint/update calls |
| UI | `ui/asset-library.js` | Token gallery, manifest metadata reads, thumbnail rendering |
| UI | `ui/asset-history.js` | Manifest-chain timeline browser |
| UI | `ui/asset-editors.js` | Editor list/add/remove UI |

### 3.3 Smart Contracts (`blockchain/contracts/`)

There are two concrete contracts sharing `ArbeskAssetBase.sol`:

**`ArbeskAssetFree.sol` (free tier, default)**
- `recordGeneration(bytes32 nodeId, string prompt)` — 10/day quota per wallet, owner bypass
- All shared minting, URI, editor, and burn functions
- No payment, no treasury, no USDC

**`ArbeskAsset.sol` (paid tier)**
- `payForGeneration(bytes32 nodeId, string promptText)`
- emits `AssetGenerationPaid`
- transfers generation payment directly to treasury
- `publishAsset(string uri, uint256 tokenId)`
- `updateAssetURI(tokenId, newURI)` for owner/editor
- editor management: `addEditor`, `removeEditor`, `listEditors`, `listTokens`
- admin controls: cost, treasury, pause/unpause

Shared responsibilities (in `ArbeskAssetBase.sol`):
- ERC-721 enumerable minting and URI storage
- role-based collaboration (Viewer / Editor)
- burn with collaborator cleanup
- pause/unpause and ownership

### 3.4 Infrastructure

| Service | Purpose | Host Binding |
|---|---|---|
| `ipfs` | Private Kubo node | `127.0.0.1:5001`, `127.0.0.1:8080` |
| `hardhat` | Local EVM and contract tooling | `127.0.0.1:8545` |
| `optimismSepolia` | Public testnet target | RPC via configured provider |
| `optimismMainnet` | Public production (softnet) target | RPC via configured provider |

The IPFS container is configured private-first: no public DHT, no bootstrap peers, no public swarm exposure, no relay client, and loopback-only swarm.

Public network strategy: **Hardhat local for development, Optimism Sepolia for testnet, Optimism mainnet for production**. Base and Polygon configurations are not current targets.

---

## 4. Manifest Data Model

A manifest is a complete snapshot stored on private IPFS.

```json
{
  "manifest_id": "manifest_001",
  "name": "My World",
  "version": 4,
  "timestamp": 1780000000,
  "prev_manifest_cid": "QmPreviousManifest...",
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
  "nodes": [
    {
      "node_id": "node_world_root",
      "source": {
        "cid": "QmAssetCid...",
        "path": "asset.glb",
        "format": "glb"
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
      "child_manifest_id": "QmNestedManifest..."
    }
  ]
}
```

### 4.1 Manifest Chain (IPFS Content-Addressed Version Chain)

Every manifest stored on private IPFS is content-addressed — its IPFS CID is a cryptographic hash of its contents. When a new version is saved, the updated manifest includes a `prev_manifest_cid` pointer to the previous version, forming a **manifest chain** (also referred to as the **IPFS version chain** or **manifest history chain**).

```text
Manifest v1 (CID: QmA...)  ←──  Manifest v2 (CID: QmB...)  ←──  Manifest v3 (CID: QmC...)
     prev_manifest_cid: null          prev_manifest_cid: QmA...        prev_manifest_cid: QmB...
```

**Key properties:**

- **Content-addressed immutability**: Each manifest CID is a verifiable fingerprint. The chain cannot be altered without changing every subsequent CID.
- **Backward-only traversal**: The chain walks from newest to oldest via `prev_manifest_cid`. There is no forward pointer — IPFS CIDs of future versions cannot be known in advance.
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
  → wallet.payForGeneration(nodeId, prompt)
  → signed txHash Bearer token
  → POST /api/v1/generations
  → backend verifies tx receipt + AssetGenerationPaid event
  → mock adapter returns asset bytes
  → asset bytes added to private IPFS
  → manifest read/update/write on private IPFS
  → frontend loads new manifest in Babylon.js
```

**Free tier (`ArbeskAssetFree`) — implemented UI path**

```text
User prompt
  → wallet.recordGeneration(nodeId, prompt)
  → POST /api/v1/generations
  → backend verifies tx receipt + AssetGenerationRecorded event
  → mock adapter returns asset bytes
  → asset bytes added to private IPFS
  → manifest read/update/write on private IPFS
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
  → fetch active manifest from IPFS gateway/cache
  → set name/version/prev link as needed
  → POST /api/v1/manifests
  → update active/latest manifest CID

Publish
  → fetch active manifest
  → capture optional WebP thumbnail
  → POST /api/v1/manifests/:cid/publish
  → publishAsset(new token) or updateAssetURI(existing token)
  → refresh gallery/history
```

### 5.4 Gallery Flow

```text
Wallet connected
  → contract.balanceOf + tokenOfOwnerByIndex
  → contract.listTokens for team worlds
  → tokenURI(tokenId)
  → get manifest from private IPFS gateway/cache
  → display manifest.name and optional thumbnail
```

---

## 6. Storage and Caching Strategy

### Private IPFS Objects

| Content | Stored as | Referenced by |
|---|---|---|
| GLB/GLTF asset | raw bytes or JSON | `node.source.cid`, `history[].src.cid` |
| Manifest | JSON | token URI or URL `?manifest=` |
| Publish thumbnail | WebP bytes | `manifest.thumbnail.cid` |
| glTF buffers | CID/base64 converted content | glTF `buffers[].uri` transformation |

### Browser Cache

`frontend/src/js/ipfs/remote-ipfs.js` caches on demand only:

- memory map for fast repeat reads in a session
- IndexedDB object store for persistence
- separate cache keys by gateway URL, CID, and payload kind (`json`, `text`, `blob`)

No background prefetching or cache warming is performed.

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
| Ledger tampering | Not implemented yet | Append-only JSONL/SQLite + IPFS snapshots + contract anchors |

---

## 8. Current Performance Characteristics

| Operation | Current Strategy |
|---|---|
| Mock generation | local file read + IPFS add |
| Root manifest load | gateway read + browser cache |
| GLB load | blob gateway read + browser cache + Babylon import |
| GLTF load | JSON gateway read + CID buffer rehydration + Babylon import |
| History chain UI | backend walks `prev_manifest_cid` up to 50 entries |
| Publish thumbnail | one synchronous canvas capture during publish only |

---

## 9. Planned Phase 5 Architecture

Phase 5 introduces a display-agnostic micro-ledger:

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

## 10. Zed Agent Integration

- `AGENTS.md` is the primary instruction file for Zed AI agents.
- `.zed/tasks.json` defines repeatable project tasks.
- `.zed/settings.json` excludes generated/heavy folders from Zed project scanning.
- `docs/ZED_AGENT_GUIDE.md` summarizes agent entry points and safe workflows.

---

## 11. Known Gaps

- Production cloud adapters are not implemented.
- OpenSCAD WASM integration is schema-compatible but deferred.
- Frontend E2E tests are not committed.
- Phase 5 ledger is planned but not implemented.
- `GET /api/health` and direct `GET /api/manifest/:cid` are planned routes, not current backend routes.
- Public Optimism Sepolia/mainnet contract deployments are documented as targets but not yet deployed.
