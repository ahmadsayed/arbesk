# AGENTS.md — Arbesk Developer Guide

This file contains conventions, key file references, and practical guidance for AI agents and developers working on the Arbesk codebase.

---

## 1. Project Identity

**Name**: Arbesk  
**Type**: Cloud-Native 4D Fractal Version-Controlled 3D Asset Platform  
**Primary Languages**: JavaScript (Node + Browser), Solidity, Pug/SCSS  
**License**: ISC

**Key Constraints:**
- **Blockchain**: Filecoin FEVM (not Base/Arbitrum)
- **IPFS**: Private Dockerized Kubo node (no public DHT, no external peers)
- **Hardhat**: Runs inside a Docker container (reproducible local EVM)
- **3D Generation**: Mock adapters for testing using SukaVerse GLB assets (`intro.glb`, `suka.glb`, `suka.gltf`)
- **Parametric Versions**: Color + scale edits in UI append new history entries without cloud generation
- **History Timeline**: Draggable circular-node scrubber in the topbar (Google Earth-style)

**Phase Status:**
| Phase | Status | Focus |
|-------|--------|-------|
| Phase 1: Data Bridge, Mock Adapters & Private IPFS | ✅ DONE | Backend API, IPFS pipeline, mock adapters |
| Phase 2: Parametric Versions & Babylon.js Rendering | ✅ DONE | Scene graph, time-travel, parametric preview |
| Phase 3: PayGo Smart Contract & On-Chain Integration | ✅ DONE | `ArbeskWorld.sol`, tx validation, replay prevention |
| Phase 4: UI Assembly & Consolidated Workspace Studio | ✅ DONE | Studio shell, wallet wiring, team panel, minting |
| **Phase 5: Micro-Ledger & Audit Infrastructure** | 🔄 **UPCOMING** | Structured operation logging, manifest audit trail, on-chain attestations |

---

## 2. Repository Layout Cheat Sheet

| What you need | Where to look |
|---------------|---------------|
| Backend server entry | `src/index.js` |
| API routes | `src/api/index.js` |
| Cloud generation route | `src/api/generate-asset-node.js` |
| Parametric version route | `src/api/parametric-version.js` |
| Auth middleware | `src/api/authentication.js` |
| Rate limiter | `src/api/rate-limiter.js` |
| ABI serving | `src/api/abi-router.js` |
| Frontend templates | `frontend/src/pug/` |
| Frontend styles | `frontend/src/scss/` |
| 3D Engine logic | `frontend/src/js/engine/` |
| Wallet/chain logic | `frontend/src/js/blockchain/` |
| IPFS read/write | `frontend/src/js/ipfs/` |
| glTF CID translation | `frontend/src/js/gltf/` |
| Chat studio UI | `frontend/src/js/ui/chat-studio.js` |
| History timeline UI | `frontend/src/js/ui/history-browser.js` |
| Save controller | `frontend/src/js/ui/save-world.js` |
| Team panel | `frontend/src/js/ui/team-panel.js` |
| Gallery | `frontend/src/js/ui/gallery.js` |
| API service layer | `frontend/src/js/services/api.js` |
| Team service | `frontend/src/js/services/team.js` |
| Smart contracts | `blockchain/contracts/` |
| Hardhat config | `blockchain/hardhat.config.js` |
| Contract tests | `blockchain/test/` |
| Backend tests | `test/` |
| Build scripts | `frontend/scripts/` |
| Private IPFS Docker | `docker-compose.yml` + `docker/Dockerfile` + `docker/entrypoint.sh` |
| Hardhat Docker | `docker/hardhat.Dockerfile` |
| Phase 1 specification (DONE) | `Phase1.md` |
| Phase 2 specification (DONE) | `Phase2.md` |
| Phase 3 specification (DONE) | `Phase3.md` |
| Phase 4 specification (DONE) | `Phase4.md` |
| Upcoming micro-ledger focus | `Phase5.md` (planned) |

---

## 3. Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express |
| Frontend Templates | Pug |
| Styling | SCSS + Bootstrap 5 |
| 3D Renderer | Babylon.js |
| Frontend JS | Vanilla JavaScript (ES modules) |
| Web3 | Web3.js + Web3Modal |
| Blockchain | **Filecoin FEVM** |
| Smart Contracts | Solidity 0.8.24, OpenZeppelin v5 |
| Blockchain Dev | **Hardhat (Dockerized)** |
| 3D Generation | Tripo3D / Meshy / Hunyuan3D APIs; **Mock adapters** for dev |
| Procedural CAD | OpenSCAD WASM (browser) — deferred post-MVP |
| Storage | **Private IPFS** (Dockerized Kubo, loopback-only) |
| Testing | Jest + Supertest (backend), Hardhat (contracts) |
| Build | Custom Node.js scripts |
| Orchestration | Docker Compose |

---

## 4. Build & Development Commands

All commands run from the **project root** unless otherwise noted.

```bash
# ─── Infrastructure (Docker Compose) ───
# Start all containers (IPFS + Hardhat local node)
docker-compose up -d

# Stop all containers
docker-compose down

# View IPFS logs
docker-compose logs -f ipfs

# View Hardhat logs
docker-compose logs -f hardhat

# ─── Dependencies ───
# Install root + frontend dependencies
npm install
cd frontend && npm install && cd ..

# Note: blockchain deps are installed inside the Hardhat container image.
# If you need host-side blockchain deps for IDE intellisense:
cd blockchain && npm install && cd ..

# ─── Frontend ───
# Build frontend assets (Pug → HTML, SCSS → CSS, JS copy, assets copy)
cd frontend && npm run build

# ─── Backend ───
# Start backend server (port 9090)
npm start

# Start with auto-rebuild (nodemon)
npm run nodemon

# ─── Testing ───
# Run all tests (Jest API tests + Hardhat contract tests)
npm test

# Run only backend tests
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest

# Run only contract tests (inside Hardhat container)
docker-compose run --rm hardhat npx hardhat test

# ─── Blockchain (inside Hardhat container) ───
# Compile contracts
docker-compose run --rm hardhat npx hardhat compile

# Deploy contracts to local Hardhat network
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat

# Deploy to Filecoin Calibration testnet
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network filecoinCalibration

# Deploy to Filecoin Mainnet
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network filecoin

# Verify contract on Filfox
docker-compose run --rm hardhat npx hardhat run scripts/verify.js --network filecoinCalibration

# Start an interactive shell inside the Hardhat container
docker-compose run --rm hardhat sh
```

---

## 5. Environment Variables

Three `.env` files are used. All are in `.gitignore` and must never be committed.

### `blockchain/.env` (Required for blockchain scripts — create from example)

Copy the example file and fill in your keys:
```bash
cp blockchain/.env.example blockchain/.env
```

```ini
# Filecoin RPC endpoints
API_URL=https://api.calibration.node.glif.io/rpc/v1
# For mainnet: https://api.node.glif.io/rpc/v1

PRIVATE_KEY=<0x...>
PUBLIC_KEY=<0x...>
CONTRACT_ADDRESS=<0x...>
TREASURY_ADDRESS=<0x...>
ETHERSCAN_API_KEY=<optional>
ASSETS_IPFS=<CID>
```

**Note**: `blockchain/.env` is loaded manually by Hardhat scripts. The Docker Compose file does **not** reference it directly, so `docker compose up` works even before the file is created.

### Root `.env` (Backend + cloud adapters)

```ini
# 3D Generation Cloud APIs (production)
TRIPO3D_API_KEY=
MESHY_API_KEY=
HUNYUAN3D_API_KEY=

# Mock mode: set to "true" to use local GLB files instead of cloud APIs
MOCK_3D_GENERATION=true
MOCK_ASSETS_DIR=../suka-forever/frontend/src/assets/glb

# Private IPFS (Dockerized node)
IPFS_API_URL=http://127.0.0.1:5001
IPFS_GATEWAY_URL=http://127.0.0.1:8080/ipfs/

# Hardhat local network (Docker container)
HARDHAT_RPC_URL=http://127.0.0.1:8545

# Optional: Pinata for public gateway fallback
PINATA_API_KEY=
PINATA_SECRET_KEY=
```

### `frontend/.env` (Build-time, optional)

```ini
# Public vars injected into frontend
IPFS_GATEWAY_URL=http://127.0.0.1:8080/ipfs/
HARDHAT_RPC_URL=http://127.0.0.1:8545
```

---

## 6. Coding Conventions

### JavaScript (Browser + Node)

- **Modules**: ES modules (`import`/`export`) in root and frontend. CommonJS (`require`) only in `blockchain/scripts/`.
- **Frontend globals**: The builder page loads scripts in a specific order; `BABYLON`, `Web3`, `window.web3`, `IpfsHttpClient` are expected to exist globally.
- **Naming**: camelCase for variables/functions, PascalCase for classes/constructors, UPPER_SNAKE for module-level constants.
- **No TypeScript**: The project is pure JavaScript. Add JSDoc comments when documenting new functions.

### Solidity

- **Version**: `^0.8.0`
- **Style**: OpenZeppelin-based. Use `require()` for validation, emit events for state changes.
- **Comments**: NatSpec (`@dev`, `@param`, `@return`) is preferred.
- **Target**: Filecoin FEVM — EVM-compatible but gas economics differ from Ethereum L1. Optimize for storage reads over writes.

### Pug / SCSS

- **Build**: Custom Node.js scripts in `frontend/scripts/` (not Webpack/Vite).
- **Partials**: Reusable includes live in `frontend/src/pug/includes/`.
- **CSS Framework**: Bootstrap 5 with custom Sass overrides.

### Backend Logging (Verbose by Design)

The backend uses structured console logging with tagged prefixes. **All essential operations are logged.**

| Tag | Meaning | Example |
|-----|---------|---------|
| `[BOOT]` | Server startup / config | `[BOOT] Server started at http://localhost:9090` |
| `[OK]` | Successful request | `[OK] GET /api/manifest-chain?cid=... → 200 (14ms)` |
| `[ERR]` | Failed request (4xx/5xx) | `[ERR] POST /api/save-manifest → 400 (2ms)` |
| `[IPFS]` | IPFS add/cat operations | `[IPFS] cat Qm... → 1240 chars` |
| `[SAVE]` | Manifest save | `[SAVE] manifest_id=... version=5 → cid=Qm...` |
| `[CHAIN]` | Manifest chain walk | `[CHAIN] walking from Qm...` |
| `[GEN]` | Asset generation pipeline | `[GEN] prompt="..." nodeId=... tx=0x...` |
| `[PARAM]` | Parametric version | `[PARAM] nodeId=... color=#FF5733` |
| `[AUTH]` | Authentication | `[AUTH] recovered address=0x... tx=0x...` |
| `[ABI]` | ABI serving | `[ABI] serving /path/to/ArbeskWorld.json` |

**Rules for adding new logs:**
1. Always prefix with `[TAG]` in UPPERCASE.
2. Log at the **start** of async operations (IPFS, blockchain, external APIs).
3. Log the **outcome** on completion (success CID, error message).
4. Include relevant identifiers (CID, txHash, nodeId, version) for traceability.
5. Use `console.error()` only for actual exceptions; use `console.log()` for operational flow.

---

## 7. The Fractal Manifest

Arbesk stores worlds as **fractal manifests** — JSON documents where every asset is a node that can contain:
- A `source` object with `{ cid, path, format }` (e.g. GLB, GLTF, OBJ, FBX) OR `scad_source` (OpenSCAD code string)
- A `transform_matrix` (4x4 column-major)
- A `history` array of version deltas
- A `child_manifest_id` for recursive nesting

**Two Types of History Entries:**

1. **Generation Version** — created by cloud AI or mock adapter:
```json
{
  "v": 1,
  "timestamp": 1779900000,
  "src": {
    "cid": "QmTableRoughDraftMeshHash...",
    "path": "asset.gltf",
    "format": "gltf"
  },
  "prompt": "A modern minimalist workbench",
  "provider": "meshy",
  "txHash": "0xabc...",
  "type": "generation"
}
```

2. **Parametric Version** — created by user editing color/scale in UI:
```json
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
```

**Golden Rules:**
1. **The World is the Asset** — no structural difference between object, scene, or universe.
2. **Fractal Nesting** — assets recursively reference child manifests ("Dollhouse Architecture").
3. **Temporal Isolation** — time-travel any node without re-rendering neighbors.
4. **Parametric Coexistence** — color/scale edits are first-class versions alongside AI-generated meshes.

---

## 8. Cloud 3D Generation Pipeline

### Production Mode
```
User Prompt → PayGo Contract → Express API Route → Cloud Adapter → SaaS API
                                                    ↓
User ← IPFS CID ← Upload Service ← Generated GLTF/GLB
       ↓
Manifest History Array ← Append Generation Version
```

### Mock/Dev Mode
```
User Prompt → PayGo Contract → Express API Route → Mock Adapter
                                                    ↓
User ← IPFS CID ← Upload Service ← Copied from ../suka-forever/frontend/src/assets/glb/
       ↓
Manifest History Array ← Append Generation Version
```

**Mock Assets (from SukaVerse):**
- `intro.glb` — Default mock asset for generic prompts
- `suka.glb` — Default mock asset for character/figure prompts
- `suka.gltf` — Alternative format mock

---

## 9. Private IPFS + Hardhat Infrastructure

### IPFS Container (`ipfs` service)
- **Image**: `ipfs/kubo:latest` via `docker/Dockerfile`
- **No public DHT**: `Routing.Type = none`
- **No bootstrap peers**: `ipfs bootstrap rm --all`
- **No NAT traversal**: `Swarm.DisableNatPortMap = true`
- **No relay client**: `Swarm.RelayClient.Enabled = false`
- **Loopback-only swarm**: `Addresses.Swarm = ["/ip4/127.0.0.1/tcp/4001"]`
- **API**: `127.0.0.1:5001`
- **Gateway**: `127.0.0.1:8080`
- **Storage cap**: 100 GB

### Hardhat Container (`hardhat` service)
- **Image**: `node:20-slim` via `docker/hardhat.Dockerfile`
- **Local EVM**: `127.0.0.1:8545` (Hardhat Network)
- **Volume mount**: `./blockchain:/app` (live contract editing)
- **Env**: Loads `blockchain/.env`
- **Default CMD**: `npx hardhat node --hostname 0.0.0.0`
- **Override CMD**: Use `docker-compose run --rm hardhat <command>` for compile/test/deploy

### Why containerize Hardhat?
- Reproducible Solidity compiler versions across dev machines
- Isolated Node.js version (20-slim) independent from host
- Local EVM network always available at `127.0.0.1:8545`
- No need to install Hardhat globally or manage Python/g++ build deps on host

---

## 10. Testing Strategy

| Test Type | Framework | Files |
|-----------|-----------|-------|
| Backend API | Jest + Supertest | `test/api.test.js` |
| Smart Contracts | Hardhat | `blockchain/test/*.js` |
| Frontend | Manual / browser-based | No automated E2E tests currently |
| Mock Adapters | Jest | `test/mock-adapters.test.js` |

---

## 11. Security Notes

- **`.env` files contain private keys and API keys**. Never commit them.
- **API Routes**: Always validate `req.body` and `req.params`.
- **Smart Contracts**: Use `ReentrancyGuard` for any function that transfers value.
- **IPFS**: Private node is isolated from public network. Do not expose ports beyond `127.0.0.1`.
- **Hardhat**: Local network at `8545` is for development only. Never expose to public internet.
- **Mock Mode**: Never deploy mock adapters to production. Use `MOCK_3D_GENERATION` env flag strictly.

---

## 12. Data Formats

### Fractal Manifest Entry (stored on private IPFS)

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
          "prompt": "A modern minimalist workbench",
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
      "child_manifest_id": "nested_dollhouse_universe_02"
    }
  ]
}
```

### glTF Buffer URI Format

```javascript
// In storage (IPFS): base64 replaced with CID
"uri": "data:application/cid;base64,Qm..."

// At render time: resolved back to base64
"uri": "data:application/octet-stream;base64,Z2lCZg=="
```

---

## 13. Filecoin FEVM Notes

- **RPC Endpoints**:
  - Calibration: `https://api.calibration.node.glif.io/rpc/v1`
  - Mainnet: `https://api.node.glif.io/rpc/v1`
- **Local Dev (Hardhat container)**: `http://127.0.0.1:8545`
- **Native Token**: FIL (used for gas)
- **EVM Compatibility**: Standard Solidity contracts work unmodified
- **Gas Economics**: Different from Ethereum — test thoroughly on Calibration before mainnet
- **Block Time**: ~30 seconds (Filecoin tipsets)
- **Wallet Support**: MetaMask, Rabby (add Filecoin network manually)

---

## 14. Phase 5: Micro-Ledger & Audit Infrastructure (Upcoming)

> **Status**: Planned — not yet implemented.  
> **Goal**: Build a structured, queryable audit trail for every manifest mutation, generation, and parametric edit. The micro-ledger decouples operational logging from the Babylon.js display layer so the system can be ported to XR/immersive environments with zero refactoring.

### 14.1 Why a Micro-Ledger?

Current state: The backend logs operations to `console.log()` with tagged prefixes. This is sufficient for development but not for:
- **Forensic audit** — "Who changed what, when?"
- **Cross-session replay** — Server restart clears `usedTxHashes` and in-memory state
- **Analytics** — "Which prompts produce the most parametric edits?"
- **Immersive ports** — XR headsets need the same audit trail without browser console access

### 14.2 Proposed Scope

| Component | Location | Purpose |
|-----------|----------|---------|
| Structured log schema | `src/ledger/` | Typed operation records (save, generate, parametric, mint) |
| Log persistence | Append-only JSONL or SQLite | Queryable audit trail per manifest / per user |
| Log API | `GET /api/ledger?manifestId=` | Fetch operation history for a manifest |
| On-chain attestation | `ArbeskWorld.sol` extension | Anchor manifest root CIDs to the contract for immutability proof |
| Frontend ledger panel | `frontend/src/js/ui/ledger-panel.js` | Visual audit trail in the studio |

### 14.3 Design Principles

1. **Append-only**: Never mutate or delete log entries. Invalidations are new entries.
2. **Content-addressed**: Log entries reference manifests by CID, not mutable IDs.
3. **Offline-replayable**: A log file + IPFS CIDs = full scene reconstruction without the backend.
4. **Display-agnostic**: The ledger has no dependency on Babylon.js or the DOM.

---

## 15. Contact & Links

- **Repository**: https://github.com/ahmadsayed/arbesk
- **Docs**: `docs/` directory in this repo
