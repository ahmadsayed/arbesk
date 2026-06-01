# Arbesk System Architecture

> **Status**: Draft v0.3 — Aligned with SukaVerse + PromptSCAD, FEVM, Private IPFS, Mock Adapters, Parametric Versions, Containerized Hardhat  
> **Scope**: Full-stack architecture for cloud-native 3D generation + fractal version control

---

## 1. Vision

Arbesk is the world's first **4D Fractal Version-Controlled Scene Graph**. It unifies:
- **Generative 3D modeling** via cloud AI APIs (Tripo3D, Meshy, Hunyuan3D) — with **mock adapters** for offline testing using SukaVerse GLB assets
- **Parametric versioning** — color and scale edits in the UI create new history entries without cloud generation
- **Fractal nesting** — worlds inside worlds (the "Dollhouse Architecture")
- **Web3 monetization** — pay-per-generation on **Filecoin FEVM**
- **Private IPFS** — Dockerized Kubo node with no public DHT for complete data sovereignty
- **Containerized blockchain dev** — Hardhat runs in Docker for reproducible local EVM development
- **OpenSCAD hybrid** — procedural CAD code coexists with AI-generated meshes

---

## 2. High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER LAYER                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  Prompt Editor  │  │  OpenSCAD IDE   │  │  Node Inspector             │  │
│  │  (text prompt)  │  │  (code editor)  │  │  ├── Color picker          │  │
│  └────────┬────────┘  └────────┬────────┘  │  └── Scale slider          │  │
│           │                    │            └─────────────┬───────────────┘  │
│           └────────────────────┴──────────────────────────┘                  │
│                                │                                            │
│                     ┌──────────▼──────────┐                                 │
│                     │   Web3 Wallet       │                                 │
│                     │   (MetaMask/Rabby)  │                                 │
│                     └──────────┬──────────┘                                 │
└────────────────────────────────┼─────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SMART CONTRACT LAYER                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  ArbeskWorld (Solidity, Filecoin FEVM)                                 │ │
│  │  ├── payForGeneration(bytes32 nodeId, string calldata prompt)           │ │
│  │  ├── mintWorld(string uri, uint256 tokenId)                             │ │
│  │  ├── addEditor(tokenId, editor) / removeEditor(tokenId, editor)        │ │
│  │  ├── emit AssetGenerationPaid(user, nodeId, prompt)                     │ │
│  │  └── 100% direct transfer to developerTreasuryWallet                     │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │ PaymentSettled event
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BACKEND LAYER                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  Express.js API Routes                                                  │ │
│  │  ├── POST /api/generate-asset-node    (cloud AI or mock adapter)       │ │
│  │  ├── POST /api/parametric-version     (color/scale edits)              │ │
│  │  ├── GET  /api/health                                                  │ │
│  │  └── GET  /api/manifest/:id                                            │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                │                                            │
│           ┌────────────────────┼────────────────────┐                       │
│           ▼                    ▼                    ▼                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │  Cloud/Mock     │  │  Private IPFS   │  │  Manifest Store │              │
│  │  Adapter        │  │  (Dockerized    │  │  (JSON deltas   │              │
│  │  (Tripo3D/      │  │   Kubo node,    │  │   on private    │              │
│  │   Meshy/        │  │   no public     │  │   IPFS)         │              │
│  │   Mock)         │  │   DHT)          │  │                 │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RENDERING LAYER                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  Babylon.js (WebGL) — Browser Canvas                                   │ │
│  │  ├── SceneGraph parser (recursive manifest traversal)                   │ │
│  │  ├── LazyLoader (fetch child manifests on interaction)                  │ │
│  │  ├── TimeTravel engine (swap mesh geometry per node version)            │ │
│  │  ├── Parametric Editor (apply color/scale in real-time)                 │ │
│  │  └── GLTF/GLB + OpenSCAD-WASM hybrid loader                            │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                      INFRASTRUCTURE LAYER (Docker Compose)                   │
│  ┌─────────────────────────┐  ┌─────────────────────────┐                   │
│  │  Private IPFS Node      │  │  Hardhat Dev Environment│                   │
│  │  (Kubo, loopback-only)  │  │  (Local EVM, port 8545) │                   │
│  │  Port: 127.0.0.1:5001   │  │  Port: 127.0.0.1:8545   │                   │
│  │  Port: 127.0.0.1:8080   │  │  Volume: ./blockchain   │                   │
│  └─────────────────────────┘  └─────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Breakdown

### 3.1 Studio Frontend (`frontend/`)

A Pug + SCSS + Bootstrap + Babylon.js application with four primary UI regions:

| Region | Purpose | Tech |
|--------|---------|------|
| **Viewport** | WebGL 3D canvas displaying the fractal scene graph | Babylon.js |
| **Editor Panel** | Prompt input + OpenSCAD code editor | Monaco Editor (CDN) + custom prompt UI |
| **Node Inspector** | Color picker + scale sliders for selected node | HTML5 color input + Bootstrap range sliders |
| **Timeline Footer** | Version history scrubber for selected node | Bootstrap range input + custom timeline |

**Key State (global window object / custom event bus):**
- `activeManifestId`: Currently loaded root manifest
- `selectedNodeId`: Node clicked in viewport
- `selectedVersion`: Historical version index for selected node
- `walletAddress`: Connected FEVM address
- `parametricDraft`: Uncommitted color/scale changes for live preview

### 3.2 Cloud / Mock Generation Service (Express API)

Abstracts multiple 3D generation providers behind Express routes. Supports both **production** (real SaaS APIs) and **development** (mock adapters using local GLB files).

**Backend Adapters** (`src/api/adapters/`):
- **Tripo3DAdapter** — High-quality mesh generation, task-based async API
- **MeshyAdapter** — Fast generation with texture support
- **Hunyuan3DAdapter** — Tencent's open-weights model via API
- **MockAdapter** — Returns pre-existing GLB files from SukaVerse for testing

**Mock Assets (from `/home/ahmedh/projects/arbesk/suka-forever/frontend/src/assets/glb/`):**
- `intro.glb` — Default mock asset for generic prompts
- `suka.glb` — Default mock asset for character/figure prompts
- `suka.gltf` — Alternative format mock

**Selection Logic:**
- If `MOCK_3D_GENERATION=true`, always use MockAdapter
- If `provider` specified in request, use that adapter
- Otherwise, round-robin across available cloud adapters

### 3.3 Parametric Version Service (`POST /api/parametric-version`)

A dedicated endpoint for UI-driven edits that do **not** require cloud generation.

**Creates a "parametric version" history entry containing:**
- `type: "parametric"`
- `params.scale` — `{ x, y, z }` multipliers
- `params.color` — hex color string (e.g., `"#FF5733"`)

**Why separate from generation?**
- No SaaS API call = no cost = no PayGo payment required
- Instant feedback (< 100ms)
- Encourages iterative experimentation

### 3.4 Fractal Engine (`frontend/src/js/engine/`)

The heart of Arbesk — parses manifest trees and renders them in 3D via Babylon.js.

**SceneGraph:**
- Recursively walks manifest `nodes` array
- For each node: loads geometry → applies `transform_matrix` → renders
- If `child_manifest_id` exists: creates a child coordinate frame anchored at parent's origin
- History swapping: `updateNodeToVersion(nodeId, versionIndex)` fetches historical IPFS hash and swaps mesh

**Parametric Preview:**
- Color edits: apply `material.diffuseColor` in real-time before commit
- Scale edits: apply `mesh.scaling` in real-time before commit
- On "Save Parametric Version": append to history, write manifest to IPFS

**Lazy Loading Rule:**
Child manifests are **never** fetched until:
- User clicks the parent node's bounding box, OR
- Camera zooms within a threshold distance of the parent node

### 3.5 Private IPFS Infrastructure (`docker/`)

A Dockerized Kubo node configured for **complete isolation** from the public IPFS network.

| Setting | Value | Purpose |
|---------|-------|---------|
| `Routing.Type` | `none` | Disable DHT |
| `Bootstrap` | `rm --all` | No bootstrap peers |
| `Swarm.DisableNatPortMap` | `true` | No NAT traversal |
| `Swarm.RelayClient.Enabled` | `false` | No relay dialing |
| `Provide.Enabled` | `false` | No reprovider scheduler |
| `Discovery.MDNS.Enabled` | `false` | No LAN peer discovery |
| `Addresses.Swarm` | `127.0.0.1:4001` | Loopback-only |
| `Addresses.API` | `0.0.0.0:5001` | API (mapped to host loopback) |
| `Addresses.Gateway` | `0.0.0.0:8080` | Gateway (mapped to host loopback) |
| `Datastore.StorageMax` | `100GB` | Storage ceiling |

**Ports exposed to host (loopback only):**
- `127.0.0.1:5001` — IPFS API (add, cat, pin)
- `127.0.0.1:8080` — IPFS Gateway (read-only content serving)

### 3.6 Containerized Hardhat (`docker/hardhat.Dockerfile`)

Hardhat runs inside a Docker container for **reproducible local EVM development**.

| Attribute | Value |
|-----------|-------|
| Base Image | `node:20-slim` |
| Working Dir | `/app` |
| Volume Mount | `./blockchain:/app` (live contract editing) |
| Exposed Port | `8545` (Hardhat Network) |
| Default CMD | `npx hardhat node --hostname 0.0.0.0` |
| Override | `docker-compose run --rm hardhat <command>` |

**Why containerize?**
- Reproducible Solidity compiler versions across dev machines
- Isolated Node.js version (20-slim) independent from host
- Local EVM network always available at `127.0.0.1:8545`
- No need to install Hardhat globally or manage Python/g++ build deps on host

### 3.7 Smart Contracts (`blockchain/`)

**ArbeskWorld.sol:**
- `costPerGeneration = 0.01 ether` (configurable by owner)
- `payForGeneration(nodeId, prompt)` — validates amount, transfers to treasury
- `mintWorld(uri, tokenId)` — mints ERC721 with manifest URI
- `addEditor(tokenId, editor)` / `removeEditor(tokenId, editor)` — owner-only editor management
- Emits `AssetGenerationPaid` for backend indexing
- No escrow, no refunds, no vault logic
- **Note**: Parametric versions (color/scale) do **not** trigger contract calls

**Deployment Target:**
- Local Hardhat Network (inside Docker container)
- Filecoin Calibration (development)
- Filecoin Mainnet (production)

**FEVM Considerations:**
- Block time: ~30 seconds (tipsets)
- Gas token: FIL
- RPC: Glif (`api.calibration.node.glif.io` / `api.node.glif.io`)
- Local dev RPC: `http://127.0.0.1:8545` (Hardhat container)
- EVM-compatible: standard Solidity, no language changes needed

---

## 4. Data Flow: Full Generation Lifecycle

```
1. User types prompt in Studio Editor Panel
   └── clicks "Generate"

2. Studio triggers Web3 contract call:
   └── ArbeskWorld.payForGeneration(nodeId, prompt)
   └── MetaMask popup → user signs

3. Transaction mined on Filecoin FEVM (~30s per tipset)
   └── Contract emits AssetGenerationPaid(user, nodeId, prompt)

4. Studio POSTs to /api/generate-asset-node with:
   └── { prompt, nodeId, txHash, provider? }

5. Express API route:
   a. Verifies txHash on-chain (Glif RPC or local Hardhat container)
   b. Selects adapter (MockAdapter if MOCK_3D_GENERATION=true)
   c. If mock: copies GLB from suka-forever assets to buffer
      If cloud: POST to SaaS API → poll until completion
   d. Uploads buffer to private IPFS → receives CID
   e. Reads current manifest from private IPFS
   f. Appends new HistoryEntry with type="generation"
   g. Writes updated manifest to private IPFS
   h. Returns { newManifestCid, historyEntry }

6. Studio receives response:
   └── Updates global state with new manifest CID
   └── Viewport fetches new geometry via Babylon.js
   └── Timeline slider updates max bound

7. User edits color/scale in Node Inspector:
   └── Live preview via Babylon.js material.scaling
   └── Clicks "Save Parametric Version"
   └── POSTs to /api/parametric-version with { nodeId, color, scale }
   └── Backend appends HistoryEntry with type="parametric"
   └── Returns updated manifest

8. User scrubs timeline:
   └── updateNodeToVersion(nodeId, v) swaps mesh in-place
   └── If parametric version: applies color/scale from entry.params
   └── No re-render of parent or siblings
```

---

## 5. Storage Strategy

### 5.1 Private IPFS Content Addressing

All assets are stored on the **private Dockerized IPFS node** with CIDs referenced in manifests.

| Content Type | IPFS Format | Example CID |
|--------------|-------------|-------------|
| GLB mesh | Raw binary | `QmTableV2FinalMesh...` |
| GLTF + bins | CAR/archive | `QmSceneWithBuffers...` |
| OpenSCAD code | UTF-8 text | `QmDeskParametric...` |
| Manifest JSON | UTF-8 text | `QmRootUniverse001...` |
| Screenshot | PNG/JPEG | `QmPreviewThumbnail...` |

### 5.2 Manifest Delta Strategy

- Each manifest is a **complete snapshot** (not a diff)
- Manifests are small JSON (~KBs)
- Large binary assets (GLB) are referenced by CID, never inlined
- Old manifests are retained for full history traversal
- A `prev_manifest_cid` field optionally links to the previous snapshot

### 5.3 Gateway Access

```
Development:
  IPFS API:    http://127.0.0.1:5001
  IPFS Gateway: http://127.0.0.1:8080/ipfs/<CID>
  Hardhat RPC:  http://127.0.0.1:8545

Production (optional public fallback):
  IPFS Gateway: https://gateway.pinata.cloud/ipfs/<CID>
```

---

## 6. Security Model

| Threat | Mitigation |
|--------|------------|
| Unpaid generation | API route validates txHash on-chain before calling SaaS |
| Replay attacks | txHash must be unique per request (checked against manifest store) |
| Prompt injection | Input validation + max length + sanitization |
| IPFS pin spam | Rate limiting per wallet address |
| Contract drain | Fixed price, no user-controlled value transfer paths |
| Private IPFS exposure | Ports bound to `127.0.0.1` only; no swarm exposure |
| Hardhat local network leak | Port `8545` bound to `127.0.0.1`; never expose to public |
| Mock adapter leak | `MOCK_3D_GENERATION` flag gated by env var, never default in prod |

---

## 7. Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Payment confirmation | < 60s | Filecoin tipset time |
| 3D generation (Meshy) | < 30s | Fast mode |
| 3D generation (Tripo3D) | < 60s | High quality mode |
| Mock generation | < 2s | Local file copy |
| Parametric version save | < 100ms | No SaaS call |
| Viewport load (root manifest) | < 500ms | Cached + lazy child loading |
| Node version swap | < 200ms | Private IPFS cache hit |
| Concurrent generations | 100 req/min | Per API instance |

---

## 8. Future Extensibility

| Feature | Approach |
|---------|----------|
| Multiplayer editing | CRDT-based manifest merging (Yjs or Automerge) |
| XR/VR viewport | Port Babylon.js engine to WebXR |
| Custom model training | Integrate LoRA fine-tuning APIs |
| On-chain manifest anchoring | Store manifest CIDs in a Filecoin FEVM registry contract |
| Decentralized compute | Replace cloud APIs with Akash/GPU networks |
| Public gateway bridge | Optional Pinata pinning for selective public sharing |

---

*End of Architecture Document.*
