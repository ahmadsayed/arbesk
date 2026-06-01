# Arbesk — Product Specification & Architecture Plan (MVP v0.3)

**Author**: Ahmad Sayed Hassan  
**Project**: Arbesk  
**Base Systems**: 
- **SukaVerse Core (`suka-forever`)**: `/home/ahmedh/projects/arbesk/suka-forever`
- **PromptSCAD IDE (`openscad-webui`)**: `/home/ahmedh/projects/openscad-webui`

**Monetization Engine**: Pure Web3 Pay-As-You-Go (PayGo) — Direct Per-Click Revenue Model  
**Blockchain**: Filecoin FEVM (not Base/Arbitrum)  
**3D Generation Engine**: Cloud-native AI SaaS (Tripo3D / Meshy / Hunyuan3D) + **Mock Adapters** for dev  
**IPFS Storage**: Private Dockerized Kubo node (no public DHT)  
**Blockchain Dev**: Hardhat inside Docker container  
**Frontend Stack**: Pug + SCSS + Bootstrap 5 + Babylon.js (aligned with SukaVerse)  
**Backend Stack**: Node.js + Express (aligned with SukaVerse + PromptSCAD)  
**Procedural CAD**: OpenSCAD WASM in browser (from PromptSCAD)

---

## 1. Vision & Core Paradigm

This project merges **SukaVerse** (decentralized spatial state tracking) and **PromptSCAD** (generative CAD inputs) into the world's first **4D Fractal Version-Controlled Scene Graph** — branded as **Arbesk**.

### Three Golden Rules for the Codebase
1. **The World is the Asset**: There is no structural difference between an object, a scene, or a universe. A world is simply an asset whose manifest references other assets, their physical location variables, and their history arrays.
2. **Fractal Nesting ("Dollhouse Architecture")**: Assets can recursively reference child manifests. A root scene node contains a room, which contains a desk, which contains a drawer, which contains a micro-city block.
3. **Temporal Isolation (Time-Travel Engineering)**: Users can scrub a local timeline to revert a specific child node to a historical generative state (Version 1.0 vs Version 1.1) without re-rendering or breaking the parent state tree around it.

### What Changed from v0.2
- **Blockchain**: Moved from Base/Arbitrum to **Filecoin FEVM** for native storage alignment.
- **IPFS**: Replaced public IPFS gateways with a **Dockerized private Kubo node** (no DHT, no peers, loopback-only).
- **Hardhat**: Runs inside a **Docker container** for reproducible local EVM development.
- **Mock Generation**: Added **mock adapters** for offline development using SukaVerse GLB assets (`intro.glb`, `suka.glb`, `suka.gltf`).
- **Parametric Versions**: UI-driven **color and scale edits** now create their own history entries without requiring cloud generation or payment.

---

## 2. System Architecture & Data Flow

```
[ FRONTEND STUDIO: Pug + Bootstrap + Babylon.js Canvas ]
│
├──► 1. Captures text prompt from editor panel
├──► 2. Captures asset definition (name, provider, position, rotation, scale)
├──► 3. User edits color/scale in Node Inspector
├──► 4. Triggers Web3.js contract call → MetaMask/Wallet (for generation only)
│
▼
[ ON-CHAIN CHECKOUT: ArbeskWorld Smart Contract (Filecoin FEVM / Hardhat Local) ]
│
├──► 5. Verifies 0.01 FIL payment (generation only)
├──► 6. Emits AssetGenerationPaid event on-chain
│
▼
[ BACKEND SERVICE: Node.js + Express ]
│
├──► 7. POST /api/generate-asset-node
│   ├── Authenticates via signed txHash (Bearer token)
│   ├── Validates tx receipt on-chain + contract address + event log
│   ├── Rate limits per wallet (10/hr)
│   ├── Selects adapter (MockAdapter if MOCK_3D_GENERATION=true)
│   ├── Copies GLB from suka-forever OR calls SaaS API
│   ├── Uploads to private IPFS (Dockerized Kubo node)
│   ├── Reads/updates manifest with optional transform_matrix
│   └── Appends type="generation" history entry
│
├──► 8. POST /api/parametric-version (no payment, no auth)
│   ├── Reads current manifest from private IPFS
│   ├── Validates color (hex) and scale (positive numbers)
│   └── Appends type="parametric" history entry (color + scale)
│
▼
[ VIEWPORT: Babylon.js Canvas + SceneGraph Engine ]
│
└──► 9. Recursively parses manifest, lazy-loads children
└──► 10. Timeline scrubber maps history array → mesh swap
└──► 11. Parametric versions apply color/scale from entry.params
└──► 12. Mint as NFT → ArbeskWorld.mintWorld() → team editor panel
```

---

## 3. MASTER MVP DATA SCHEMA (THE FRACTAL MANIFEST)

To keep performance lightning fast, the system never clones entire world files. It appends micro-deltas into a structured JSON manifest tree.

AI Agents must use this exact layout structure when writing the data storage scripts:

```json
{
  "manifest_id": "root_universe_world_001",
  "version": 4,
  "timestamp": 1780000000,
  "prev_manifest_cid": "QmPreviousManifestHash...",
  "nodes": [
    {
      "node_id": "node_table_xyz_01",
      "source": {
        "cid": "QmParentTableFinalMeshHash...",
        "path": "asset.glb",
        "format": "glb"
      },
      "transform_matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 5, -2, 1],
      "history": [
        {
          "v": 1,
          "timestamp": 1779900000,
          "src": {
            "cid": "QmTableRoughDraftMeshHash...",
            "path": "asset.gltf",
            "format": "gltf"
          },
          "prompt": "A modern minimalist workbench with steel legs, raw wood top",
          "provider": "meshy",
          "txHash": "0xabc...",
          "type": "generation"
        },
        {
          "v": 2,
          "timestamp": 1779950000,
          "src": {
            "cid": "QmTableRoughDraftMeshHash...",
            "path": "asset.gltf",
            "format": "gltf"
          },
          "prompt": "Scale 1.5x, Color #FF5733",
          "provider": "parametric",
          "type": "parametric",
          "params": {
            "scale": { "x": 1.5, "y": 1.5, "z": 1.5 },
            "color": "#FF5733"
          }
        }
      ],
      "child_manifest_id": "nested_dollhouse_universe_02",
      "metadata": {
        "tags": ["furniture", "workbench"],
        "author": "0xUserAddress...",
        "license": "CC-BY-4.0"
      }
    }
  ]
}
```

**History Entry Types:**

| Type | Trigger | Payment | SaaS Call | Fields |
|------|---------|---------|-----------|--------|
| `generation` | User submits prompt | Yes | Yes | `prompt`, `provider`, `txHash`, `src` |
| `parametric` | User edits color/scale | No | No | `params.scale`, `params.color`, `src` |

---

## 4. PHASED ENGINE DEVELOPMENT ROADMAP

### PHASE 1: Data Bridge, Mock Adapters & Private IPFS ✅ DONE
*   **Status**: Complete — see `Phase1.md` for full retrospective.
*   **Target**: `src/api/generate-asset-node.js`, `docker-compose.yml`, `docker/`
*   **Objective**: Set up private IPFS infrastructure, build mock adapters, and wire cloud generation to manifest history.
*   **Delivered**: All backend routes, mock adapter, Docker Compose services (IPFS + Hardhat), Jest API tests, and fractal manifest storage pipeline.

#### AI Agent Instruction Payload:
```text
Create docker-compose.yml and docker/ (Dockerfile + entrypoint.sh) for a private IPFS node.
Reference /home/ahmedh/projects/layer-ledger/docker-compose.yml and its docker/ folder.
Requirements:
- Kubo (ipfs/kubo:latest) base image
- No public DHT: Routing.Type = none
- No bootstrap peers: ipfs bootstrap rm --all
- No NAT traversal, no relays
- API on 127.0.0.1:5001, Gateway on 127.0.0.1:8080
- Swarm bound to container loopback only
- 100GB storage cap
- CORS headers for local development

Create src/api/adapters/ with:
1. mock-adapter.js — reads from /home/ahmedh/projects/arbesk/suka-forever/frontend/src/assets/glb/
   - intro.glb → generic prompts
   - suka.glb → character/figure prompts
   - suka.gltf → fallback format
   Returns buffer + format="glb"

2. tripo3d.js — production adapter (placeholder for future)
3. meshy.js — production adapter (placeholder for future)
4. hunyuan3d.js — production adapter (placeholder for future)

Create src/api/generate-asset-node.js:
1. Accept prompt, nodeId, txHash, optional provider
2. Validate txHash on Filecoin FEVM via Glif RPC
3. If MOCK_3D_GENERATION=true, use MockAdapter
4. Upload resulting GLB to private IPFS (127.0.0.1:5001)
5. Read current manifest, append type="generation" history entry
6. Write updated manifest to private IPFS
7. Return { newManifestCid, historyEntry }
```

---

### PHASE 2: Parametric Versions & Babylon.js Rendering ✅ DONE
*   **Status**: Complete — see `Phase2.md` for full retrospective.
*   **Target**: `src/api/parametric-version.js`, `frontend/src/js/engine/`, `frontend/src/js/blockchain/wallet.js`
*   **Objective**: Enable color/scale edits in the UI to create parametric history entries. Build Babylon.js scene graph parser and time-travel engine.
*   **Delivered**:
    *   `frontend/src/js/engine/scene-graph.js` — recursive manifest → Babylon.js parser with GLB/glTF loading, lazy child loading, click selection
    *   `frontend/src/js/engine/time-travel.js` — per-node version swapping (geometry swap for generation, overlay for parametric) without re-rendering neighbors
    *   `frontend/src/js/engine/parametric-preview.js` — live color/scale preview + POST to `/api/parametric-version`
    *   `frontend/src/js/blockchain/wallet.js` — Web3Modal + direct MetaMask fallback, network switching, balance checks
    *   `frontend/src/pug/studio.pug` + `frontend/src/scss/studio.scss` — responsive studio shell with chat sidebar, 3D viewport, inspector panel

#### AI Agent Instruction Payload:
```text
Create src/api/parametric-version.js:
1. Accept nodeId, manifestId, color (hex), scale {x,y,z}
2. Validate inputs (hex regex, positive scale numbers)
3. Read current manifest from private IPFS
4. Append type="parametric" history entry with params object
5. Write updated manifest to private IPFS
6. Return { newManifestCid, historyEntry }
No txHash validation. No SaaS call. No payment required.

Open frontend/src/js/engine/ and implement:

scene-graph.js:
- Recursively parse Manifest JSON from private IPFS gateway
- For each node, load gltf_source into Babylon.js Mesh via SceneLoader
- Apply transform_matrix (4x4 column-major) to mesh
- If child_manifest_id exists, create nested coordinate frame at parent origin
- Lazy load: do NOT fetch child manifests until click or zoom threshold

time-travel.js:
function updateNodeToVersion(nodeId, targetVersionIndex)
- Look up node's history array
- If entry.type === "generation": fetch GLB from IPFS, swap mesh geometry
- If entry.type === "parametric": apply entry.params.color to material.diffuseColor
                              apply entry.params.scale to mesh.scaling
- Ensure parent and sibling nodes are completely unaffected
- Dispatch custom event 'node:versionChanged'

parametric-preview.js:
- Live preview color changes via HTML5 color input → material.diffuseColor
- Live preview scale changes via range sliders → mesh.scaling
- On "Save", POST to /api/parametric-version
```

---

### PHASE 3: PayGo Smart Contract (Filecoin FEVM) — Containerized Hardhat ✅ DONE
*   **Status**: Complete — see `Phase3.md` for full retrospective.
*   **Target**: `blockchain/contracts/ArbeskWorld.sol`, `docker/hardhat.Dockerfile`, `docker-compose.yml`, `blockchain/scripts/deploy.js`
*   **Objective**: Author and deploy a lean PayGo contract on Filecoin FEVM using a Dockerized Hardhat environment.
*   **Delivered**:
    *   `ArbeskWorld.sol` — OpenZeppelin v5 ERC721Enumerable with `payForGeneration()`, `mintWorld()`, editor management, pause/unpause
    *   `docker/hardhat.Dockerfile` — node:20-slim with Hardhat toolchain
    *   `blockchain/scripts/deploy.js` — auto-deploys to hardhat/localhost, saves deployment record, updates `.env`
    *   `blockchain/scripts/verify.js` — Filfox verification helper
    *   `blockchain/test/ArbeskWorld.test.js` — 25+ test cases covering PayGo, minting, editor access, admin functions
    *   `scripts/start-dev.sh` — one-command launcher: Docker → deps → deploy → build → start backend

#### Delivered Spec (Retrospective):
```text
ArbeskWorld.sol — deployed and tested.

Variables:
- uint256 public costPerGeneration = 0.01 ether (10000000000000000 wei)
- address public developerTreasuryWallet;
- address public owner;

Core Logic:
function payForGeneration(bytes32 nodeId, string calldata promptText) external payable
- Requires exact 0.01 ether payment
- Forwards 100% to developerTreasuryWallet
- Replay protection via keccak256(nodeId + msg.sender + block.number)
- Emit AssetGenerationPaid(address indexed userWallet, bytes32 indexed nodeId, string prompt, uint256 amount, uint256 timestamp)

NFT & Collaboration:
- mintWorld(string uri, uint256 tokenId) — mints ERC721 with manifest URI
- updateTokenURI(tokenId, newURI) — owner or editor
- addEditor(tokenId, editor) / removeEditor(tokenId, editor) — owner only
- listEditors(tokenId) / listTokens(editor) — view functions

Admin Logic:
- setCost(uint256 newCost) — owner only
- setTreasury(address newWallet) — owner only
- pause() / unpause() — owner only
- withdraw() — owner only

Security:
- ReentrancyGuard, Pausable, Ownable (OpenZeppelin v5)
- Fallback/receive reverts with "Use payForGeneration()"

Hardhat config:
- Networks: hardhat (chainId 31415822), localhost, filecoinCalibration, filecoin
- Solidity: 0.8.24 with cancun EVM, optimizer 1000 runs
- Filfox etherscan verification configured

Deployment:
- scripts/deploy.js — auto-updates blockchain/.env CONTRACT_ADDRESS
- scripts/verify.js — Filfox verification helper
- scripts/start-dev.sh — one-command full stack launcher
```

---

### PHASE 4: UI Assembly & Consolidated Workspace Studio ✅ DONE
*   **Status**: Complete — frontend/backend integration fully wired and tested end-to-end.
*   **Target**: `frontend/src/pug/`, `frontend/src/js/`, `src/api/`
*   **Objective**: Combine interfaces into a polished user dashboard with parametric editing, asset definition, team collaboration, and minting.
*   **Delivered**:
    *   **Real Generation Flow** — `chat-studio.js` replaced mock demo with full PayGo pipeline: `payForGeneration()` → sign txHash → `POST /api/generate-asset-node` → `loadManifest()` → scene graph registration
    *   **Auth Service** — `frontend/src/js/services/api.js` — `signTxHash()` builds `Bearer <msg>.<sig>` for backend auth middleware; `generateAsset()` and `saveParametricVersion()` wrappers with `ApiError`
    *   **Asset Definition Panel** — collapsible UI for asset name, provider selection (mock/meshy/tripo3d/hunyuan3d), position, rotation, scale; feeds `transform_matrix` to backend
    *   **Welcome Overlay** — empty-state entry point with "Create New World" and "Load from CID"
    *   **Mint Button** — inspector action calling `mintWorld()` with auto-suggested tokenId; reveals team panel on success
    *   **Team Editor Panel** — `frontend/src/js/services/team.js` + `frontend/src/js/ui/team-panel.js` — list/add/remove editors via contract calls; owner-only controls
    *   **Backend fixes** — `generate-asset-node.js` accepts `transform_matrix`; `authentication.js` fixed txHash extraction bug; all 12 Jest tests passing

#### Execution Tasks (Completed):
1.  **Layout System:** `frontend/src/pug/studio.pug` with responsive layout.
    - Left: Collapsible chat sidebar with conversation history, asset definition panel, team editor panel, timeline
    - Center: Babylon.js viewport canvas with welcome overlay
    - Right: Floating Node Inspector panel (color, scale, mint button)
2.  **Node Inspector:** Collapsible panel appears when a 3D node is clicked.
    - Color Picker: HTML5 `<input type="color">`
    - Scale Sliders: Three range inputs (X, Y, Z)
    - "Save Parametric Version" button → POSTs to /api/parametric-version
    - "Mint as NFT" button → calls `mintWorld()` with auto-suggested tokenId
    - Live preview before save
3.  **Wallet Linkage:** Web3.js + Web3Modal fully wired to generation.
    - Clicking "Generate" validates wallet connection → chain ID check → network switch prompt
    - Calls `payForGeneration()` → MetaMask confirms 0.01 FIL payment
    - Signs txHash → POSTs to /api/generate-asset-node with Bearer auth
    - Parametric edits do **not** trigger wallet flows
    - Balance check alerts user if account is unfunded (with dev key prompt)
4.  **Timeline Slider Integration:** Timeline in chat sidebar bound to node history.
    - When a node is selected, slider maps min/max to `history.length`
    - Dragging calls `updateNodeToVersion(nodeId, index)` in real-time
5.  **Asset Definition Panel:** Collapsible panel above prompt editor.
    - Asset name, provider dropdown (mock/meshy/tripo3d/hunyuan3d)
    - Position (X,Y,Z), Rotation (deg), Scale (X,Y,Z)
    - Builds 4×4 column-major `transform_matrix` sent to backend
6.  **Team Editor Panel:** Appears after minting.
    - Lists current editors with truncated addresses
    - Owner-only add/remove controls
    - Fetches data on-chain via `listEditors()` / `addEditor()` / `removeEditor()`
7.  **OpenSCAD WASM Integration:** ⏳ Deferred to post-MVP — scaffolded in manifest schema but not wired in UI.

---

### PHASE 5: Micro-Ledger & Audit Infrastructure 🔄 UPCOMING
*   **Status**: Planned — specification complete in `Phase5.md`. Implementation scheduled as next focus.
*   **Target**: `src/ledger/`, `src/api/ledger.js`, `frontend/src/js/ui/ledger-panel.js`, contract extensions
*   **Objective**: Build a structured, queryable, append-only audit trail for every manifest mutation. Decouple operational logging from the Babylon.js display layer for future XR/immersive ports.
*   **Planned Deliverables**:
    *   **Typed Ledger Schema** — `LedgerEntry` interface with `opType`, `manifestId`, `cid`, `actorAddress`, `payload`
    *   **Append-Only Store** — JSONL file (`logs/ledger.jsonl`) for MVP; SQLite upgrade path for post-MVP
    *   **Query API** — `GET /api/ledger?manifestId=&opType=&since=&limit=` with pagination
    *   **Analytics API** — `GET /api/ledger/stats` for operation counts, daily aggregates, unique actors
    *   **On-Chain Anchoring** — `anchorManifest(manifestId, cid)` in `ArbeskWorld.sol` emits `ManifestAnchored` event
    *   **Ledger Panel** — Collapsible studio panel showing operation history, filters, CSV/JSON export
    *   **Event Hooks** — Ledger auto-records on `manifest:saved`, `wallet:generationPaid`, parametric saves, and team edits

**Design Principles:**
1. **Append-only**: Never mutate or delete log entries.
2. **Content-addressed**: Entries reference manifests by CID, not mutable IDs.
3. **Offline-replayable**: A log file + IPFS CIDs = full scene reconstruction without the backend.
4. **Display-agnostic**: No dependency on Babylon.js or the DOM.

---

## 5. INFRASTRUCTURE SPECIFICATION

### 5.1 Private IPFS Docker Setup

**Files:**
- `docker-compose.yml` — orchestrates the Kubo container
- `docker/Dockerfile` — based on `ipfs/kubo:latest`
- `docker/entrypoint.sh` — initializes repo and applies private config

**Configuration:**
```
Routing.Type: none
Bootstrap: [] (empty)
Swarm.DisableNatPortMap: true
Swarm.EnableHolePunching: false
Swarm.RelayClient.Enabled: false
Provide.Enabled: false
Discovery.MDNS.Enabled: false
Addresses.API: /ip4/0.0.0.0/tcp/5001
Addresses.Gateway: /ip4/0.0.0.0/tcp/8080
Addresses.Swarm: ["/ip4/127.0.0.1/tcp/4001"]
Datastore.StorageMax: 100GB
```

**Host mappings (loopback only):**
- `127.0.0.1:5001` → container:5001 (API)
- `127.0.0.1:8080` → container:8080 (Gateway)

**Volume:**
- `ipfs-data` (Docker volume) persists `/data/ipfs` across restarts

### 5.2 Hardhat Docker Setup

**Files:**
- `docker-compose.yml` — orchestrates the Hardhat container
- `docker/hardhat.Dockerfile` — based on `node:20-slim`

**Configuration:**
- Local EVM network exposed at `127.0.0.1:8545`
- Volume mount `./blockchain:/app` for live contract editing
- Volume `hardhat-node-modules` for persistent dependencies
- Volume `hardhat-cache` for incremental compilation
- Loads `blockchain/.env` for RPC endpoints and private keys

**Host mapping:**
- `127.0.0.1:8545` → container:8545 (Hardhat Network)

**Why containerize?**
- Reproducible Solidity compiler versions across dev machines
- Isolated Node.js version (20-slim)
- No host-side build tools (Python, g++) required
- Consistent Hardhat version locked in container image

### 5.3 Docker Compose Services Overview

| Service | Image | Host Ports | Volumes | Purpose |
|---------|-------|------------|---------|---------|
| `ipfs` | `ipfs/kubo:latest` | `127.0.0.1:5001`, `127.0.0.1:8080` | `ipfs-data` | Private IPFS node |
| `hardhat` | `node:20-slim` (custom) | `127.0.0.1:8545` | `./blockchain`, `hardhat-node-modules`, `hardhat-cache` | Local EVM + contract dev |

### 5.4 Mock Adapter Asset Mapping

| Prompt Keyword | Mock Asset | Source Path |
|----------------|------------|-------------|
| (default / any) | `intro.glb` | `../suka-forever/frontend/src/assets/glb/intro.glb` |
| character, figure, person, avatar | `suka.glb` | `../suka-forever/frontend/src/assets/glb/suka.glb` |
| (fallback) | `suka.gltf` | `../suka-forever/frontend/src/assets/glb/suka.gltf` |

**Mock mode activation:**
- Environment variable `MOCK_3D_GENERATION=true`
- Bypasses all SaaS API keys
- Returns buffer within < 2s

---

## 6. LONG-TERM SCALABILITY AND MAINTENANCE PRINCIPLES

To prevent technical debt during future scaling, ensure the AI Agent strictly adheres to these software rules:

*   **Enforce Lazy Loading:** The viewport compiler must never parse, open, or pre-load nested assets inside a child manifest until a user manually interacts with, clicks, or zooms into the parent boundary node container.
*   **Complete Model Separation:** Keep the state engine database entirely decoupled from the Babylon.js canvas display layer. If the frontend is ever ported from a web browser window to an immersive XR headset environment, the underlying microledger logging infrastructure should require zero code refactoring.
*   **Parametric Asset Coexistence:** Design the manifest data nodes to accept both binary file storage pointers (`.gltf`/`.obj` links on IPFS) and clean procedural code arrays (`.scad` instruction strings) interchangeably within the same entity context block.
*   **Cloud Provider Abstraction:** Never hard-code a single 3D generation provider. The adapter pattern must remain provider-agnostic so Tripo3D, Meshy, Hunyuan3D, or future providers can be swapped with zero changes to the API route or frontend.
*   **Private-First Storage:** Default to the private IPFS node for all reads and writes. Public gateways (Pinata) may be used only as optional read-only fallbacks for external sharing.
*   **FEVM-First Design:** Optimize smart contracts for Filecoin's gas economics. Test thoroughly on Calibration testnet before mainnet deployment.
*   **Free Parametric Edits:** Color and scale edits must never require on-chain payment. They are first-class versions but remain free to encourage iterative experimentation.
*   **Containerized Dev Tools:** All blockchain development (Hardhat compile, test, deploy) runs inside Docker containers. Host environment should only need Docker and Node.js for the backend/frontend.

---

*End of Arbesk Specification Document.*
