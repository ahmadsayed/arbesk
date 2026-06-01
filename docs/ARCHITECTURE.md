# Arbesk System Architecture

> Status: Current v0.4 — Phases 1–4 complete, publishing polish complete, Phase 5 planned  
> Scope: Full-stack architecture for private-IPFS 3D generation, fractal manifest versioning, FEVM PayGo, and studio publishing

---

## 1. Vision

Arbesk is a local-first 3D world studio built around **fractal manifests**: every world is a content-addressed JSON document whose nodes point to 3D assets, transforms, history entries, child manifests, and optional publish thumbnails.

The system currently combines:

- **Mock-backed generative 3D flow** via Express and private IPFS
- **Parametric versioning** for free color/scale changes
- **Babylon.js rendering** with GLB/GLTF loading and one-node-per-world replacement behavior
- **Filecoin FEVM PayGo** generation payments and ERC721 world ownership
- **Team collaboration** through token URI editor permissions
- **Private Dockerized Kubo/IPFS** for local content-addressed storage
- **Dockerized Hardhat** for reproducible local EVM development
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
│  ├─ wallet.js: Web3Modal/Web3 + ArbeskWorld calls                   │
│  ├─ remote-ipfs.js: gateway reads + memory/IndexedDB cache          │
│  └─ save-world.js: save/publish + WebP thumbnail capture            │
└───────────────────────────────┬────────────────────────────────────┘
                                │ HTTP + wallet txs
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                           Express Backend                           │
│                                                                    │
│  /api/generate-asset-node                                           │
│  ├─ Bearer txHash signature auth                                    │
│  ├─ FEVM/Hardhat receipt validation                                 │
│  ├─ AssetGenerationPaid event validation                            │
│  ├─ Mock generation adapter                                         │
│  └─ IPFS asset + manifest writes                                    │
│                                                                    │
│  /api/parametric-version                                            │
│  └─ Free color/scale history entries                                │
│                                                                    │
│  /api/save-manifest, /api/push-ipfs                                 │
│  └─ Manifest writes + optional thumbnail normalization              │
│                                                                    │
│  /api/manifest-chain, /api/manifest-by-token, /api/abi              │
└───────────────┬───────────────────────────────┬────────────────────┘
                │                               │
                ▼                               ▼
┌──────────────────────────────┐   ┌─────────────────────────────────┐
│ Private Kubo/IPFS             │   │ Filecoin FEVM / Hardhat          │
│ 127.0.0.1:5001 API            │   │ ArbeskWorld.sol                  │
│ 127.0.0.1:8080 gateway        │   │ ├─ payForGeneration              │
│ No DHT / no bootstrap peers   │   │ ├─ mintWorld / updateTokenURI    │
│ Stores assets, manifests,     │   │ └─ addEditor / removeEditor      │
│ thumbnails                    │   │ Local RPC: 127.0.0.1:8545       │
└──────────────────────────────┘   └─────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 Backend (`src/`)

| File | Responsibility |
|---|---|
| `src/index.js` | Express app, static frontend serving, request logging, body limits |
| `src/api/index.js` | Route registry, IPFS helper reads, manifest save/publish, thumbnail normalization |
| `src/api/generate-asset-node.js` | Authenticated PayGo generation route, tx/event validation, mock adapter, manifest updates |
| `src/api/parametric-version.js` | Free color/scale version route |
| `src/api/authentication.js` | Bearer signature parsing, wallet recovery, tx receipt verification |
| `src/api/rate-limiter.js` | In-memory route rate limiter |
| `src/api/abi-router.js` | Serves compiled `ArbeskWorld` artifact |
| `src/api/adapters/mock-adapter.js` | Deterministic local asset generation for development/tests |

### 3.2 Frontend (`frontend/src/js/`)

| Area | Files | Responsibility |
|---|---|---|
| Engine | `engine/scene-graph.js` | Babylon engine/scene, GLB/GLTF loading, node metadata, scene clearing, thumbnail capture |
| Engine | `engine/time-travel.js` | History version switching and parametric application |
| Engine | `engine/parametric-preview.js` | Live color/scale inspector preview and save |
| IPFS | `ipfs/remote-ipfs.js` | Private gateway reads with memory + IndexedDB cache |
| glTF | `gltf/uri_to_cid.js` | Rehydrates CID-based glTF buffer URIs for rendering |
| Blockchain | `blockchain/wallet.js` | Web3Modal, wallet connection, FEVM switching, PayGo, mint/update URI, editor calls |
| UI | `ui/chat-studio.js` | Prompt flow and asset definition controls |
| UI | `ui/save-world.js` | Save/publish lifecycle, WebP thumbnail capture, token mint/update calls |
| UI | `ui/gallery.js` | Token gallery, manifest metadata reads, thumbnail rendering |
| UI | `ui/history-browser.js` | Manifest-chain timeline browser |
| UI | `ui/team-panel.js` | Editor list/add/remove UI |

### 3.3 Smart Contract (`blockchain/contracts/ArbeskWorld.sol`)

Current contract responsibilities:

- `payForGeneration(bytes32 nodeId, string promptText)`
- emits `AssetGenerationPaid`
- transfers generation payment directly to treasury
- `mintWorld(string uri, uint256 tokenId)`
- `updateTokenURI(tokenId, newURI)` for owner/editor
- editor management: `addEditor`, `removeEditor`, `listEditors`, `listTokens`
- admin controls: cost, treasury, pause/unpause

### 3.4 Infrastructure

| Service | Purpose | Host Binding |
|---|---|---|
| `ipfs` | Private Kubo node | `127.0.0.1:5001`, `127.0.0.1:8080` |
| `hardhat` | Local EVM and contract tooling | `127.0.0.1:8545` |

The IPFS container is configured private-first: no public DHT, no bootstrap peers, no public swarm exposure, no relay client, and loopback-only swarm.

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

### History Entry Types

| Type | Trigger | Payment | Asset CID changes? | Notes |
|---|---|---:|---:|---|
| `generation` | Prompt generation | Yes | Usually yes | Uses PayGo tx validation and mock/cloud adapter |
| `parametric` | Color/scale edit | No | No | Reuses node source CID, appends params |

### Thumbnail Handling

During publish:

1. `scene-graph.js` captures the Babylon canvas into a WebP `dataUrl`.
2. `save-world.js` attaches it to `manifest.thumbnail`.
3. `src/api/index.js` uploads the image bytes to IPFS.
4. The stored manifest receives only thumbnail metadata + CID.
5. `gallery.js` reads `manifest.thumbnail.cid` and renders it through `getBlobFromRemoteIPFS()`.

---

## 5. Data Flows

### 5.1 Generation Flow

```text
User prompt
  → wallet.payForGeneration(nodeId, prompt)
  → signed txHash Bearer token
  → POST /api/generate-asset-node
  → backend verifies tx receipt + AssetGenerationPaid event
  → mock adapter returns asset bytes
  → asset bytes added to private IPFS
  → manifest read/update/write on private IPFS
  → frontend loads new manifest in Babylon.js
```

### 5.2 Parametric Edit Flow

```text
User selects node
  → inspector live-previews color/scale in Babylon.js
  → POST /api/parametric-version
  → backend validates color/scale
  → backend appends parametric history entry
  → updated manifest added to IPFS
  → frontend updates active/latest manifest CID
```

### 5.3 Save / Publish Flow

```text
Save
  → fetch active manifest from IPFS gateway/cache
  → set name/version/prev link as needed
  → POST /api/save-manifest
  → update active/latest manifest CID

Publish
  → fetch active manifest
  → capture optional WebP thumbnail
  → POST /api/push-ipfs
  → mintWorld(new token) or updateTokenURI(existing token)
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
  → Optional ArbeskWorld manifest anchoring
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
