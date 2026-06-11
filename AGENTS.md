# AGENTS.md — Arbesk Developer Guide

This file contains conventions, key file references, and practical guidance for AI agents and developers working on the Arbesk codebase.

---

## 1. Project Identity

**Name**: Arbesk  
**Type**: Cloud-Native 4D Fractal Version-Controlled 3D Asset Platform  
**Primary Languages**: JavaScript (Node + Browser), Solidity, Pug/SCSS  
**License**: ISC

**Key Constraints:**
- **Blockchain**: EVM-compatible (Hardhat local dev, extensible to any EVM L1/L2)
- **IPFS**: Private Dockerized Kubo node (no public DHT, no external peers)
- **Hardhat**: Runs inside a Docker container (reproducible local EVM)
- **3D Generation**: Mock adapter for testing using local SukaVerse-style assets (`mock-gltf-assets/intro.gltf`, `mock-gltf-assets/suka.gltf`; external GLB assets may also be configured)
- **Parametric Versions**: Color + scale edits in UI append new history entries without cloud generation
- **History Timeline**: Draggable circular-node scrubber in the topbar (Google Earth-style)
- **Publish Thumbnails**: Publishing may attach an optional WebP snapshot stored as a separate IPFS asset and referenced by `manifest.thumbnail`
- **Runtime Cache**: Browser IPFS reads use on-demand memory + IndexedDB caching; do not add prefetching unless explicitly requested
- **Zed Agent Setup**: `.zed/tasks.json`, `.zed/settings.json`, `docs/ZED_AGENT_GUIDE.md`, and this `AGENTS.md` are the agent onboarding surface

**Phase Status:**
| Phase | Status | Focus |
|-------|--------|-------|
| Phase 1: Data Bridge, Mock Adapters & Private IPFS | ✅ DONE | Backend API, IPFS pipeline, mock adapters |
| Phase 2: Parametric Versions & Babylon.js Rendering | ✅ DONE | Scene graph, time-travel, parametric preview |
| Phase 3: PayGo Smart Contract & On-Chain Integration | ✅ DONE | `ArbeskAsset.sol`, tx validation, replay prevention |
| Phase 4: UI Assembly & Consolidated Workspace Studio | ✅ DONE | Studio shell, wallet wiring, team panel, minting |
| Phase 4.1: Publishing Polish & Runtime Cache | ✅ DONE | WebP thumbnails, gallery thumbnails, on-demand IPFS cache, one-node scene cleanup |
| **Phase 5.1: Token ID-Based Child Worlds** | ✅ **DONE** | Token ref schema, resolver, drag/drop child worlds, scene graph rendering |

---

## 1.5 Client-Side First Architecture

**Default rule: keep logic in the browser unless there is a specific, unavoidable reason to put it on the server.**

Arbesk is designed as a thick client — the browser owns as much of the pipeline as possible. The Express backend is a thin gatekeeper, not a thick orchestrator. When adding new features, always ask: *"Can this run in the browser?"* Only move it to the server if the answer is definitively no.

### What stays client-side

| Concern | Why it lives in the browser | Key files |
|---------|----------------------------|-----------|
| **3D rendering & scene graph** | Babylon.js needs the GPU canvas | `frontend/src/js/engine/` |
| **Parametric editing** | Color/scale preview must be real-time (< 16 ms); no round-trip latency | `frontend/src/js/engine/parametric-preview.js` |
| **glTF decomposition** | Breaking buffers/images into separate IPFS CIDs is a data-structure transform, not a security boundary | `frontend/src/js/gltf/decomposer.js` |
| **glTF material edits** | Baking color changes into composite JSON only mutates metadata; buffers stay put | `frontend/src/js/gltf/material-editor.js` |
| **IPFS reads** | Browser fetches directly from the Kubo gateway (`127.0.0.1:8080`) | `frontend/src/js/ipfs/remote-ipfs.js` |
| **IPFS writes (raw assets)** | Browser POSTs directly to Kubo API (`127.0.0.1:5001`) for buffers, images, and composite JSON | `frontend/src/js/ipfs/write-to-ipfs.js` |
| **Wallet interactions** | Private keys never leave MetaMask / WalletConnect | `frontend/src/js/blockchain/wallet.js` |
| **Token resolution** | `tokenURI()` calls can hit any RPC; browser already has Web3 provider | `frontend/src/js/blockchain/token-resolver.js` |
| **UI state & activity feed** | No server-side ledger; manifest is the single source of truth | `frontend/src/js/ui/ledger-panel.js` |

### What must be server-side (and why)

| Concern | Why it needs the server | Key files |
|---------|------------------------|-----------|
| **Auth & signature verification** | Browser cannot cryptographically verify its own signatures; server holds the canonical Web3 instance to recover addresses and validate tx receipts | `src/api/authentication.js`, `src/api/siwe-verify.js` |
| **Transaction replay prevention** | `usedTxHashes` Set must be global across all clients | `src/api/assets/generate-node.js` |
| **Rate limiting** | Per-wallet counters cannot be enforced client-side | `src/api/rate-limiter.js` |
| **Manifest persistence** | The server is the final authority that pins the manifest JSON and extracts embedded thumbnails to IPFS | `src/api/index.js` |
| **Manifest chain walking** | The history endpoint is a convenience, but the canonical chain lives on IPFS; server just follows CIDs | `src/api/index.js` |
| **ABI & config serving** | Compiled artifacts and env vars live on the host filesystem | `src/api/abi-router.js` |
| **Unpin lifecycle** | Post-burn garbage collection must walk the full chain and call `ipfs.pin.rm` with cleanup logic | `src/api/index.js` |

### The hybrid save flow (a concrete example)

When a user clicks **Save Draft**, the pipeline is deliberately split:

1. **Browser** decomposes monolithic glTFs → writes buffers/images/composite JSON **directly** to Kubo (`:5001`).
2. **Browser** sends the manifest JSON (now referencing those CIDs) to `POST /api/v1/manifests`.
3. **Server** extracts any embedded thumbnail base64 → uploads it to IPFS.
4. **Server** uploads the manifest JSON to IPFS and pins it.
5. **Server** returns the new manifest CID.

The server never sees the raw buffer bytes. It only handles the manifest envelope and thumbnail metadata.

### Decision checklist for new features

Before adding a server route or backend handler, confirm at least one of the following is true:

- [ ] It validates signatures, transactions, or session tokens.
- [ ] It enforces a global rate limit or replay guard.
- [ ] It accesses files or secrets that cannot be exposed to the browser (`.env`, compiled ABIs).
- [ ] It performs a cross-user or administrative action (unpin, admin config).

If none apply, **implement it in the browser**.

---

## 2. Repository Layout Cheat Sheet

| What you need | Where to look |
|---------------|---------------|
| Backend server entry | `src/index.js` |
| API routes | `src/api/index.js` |
| Cloud generation route | `src/api/assets/generate-node.js` |
| Parametric version route | *(client-side only; no backend route)* |
| Auth middleware | `src/api/authentication.js` |
| Session store | `src/api/sessions.js` |
| Rate limiter | `src/api/rate-limiter.js` |
| ABI serving | `src/api/abi-router.js` |
| Frontend templates | `frontend/src/pug/` |
| Frontend styles | `frontend/src/scss/` |
| 3D Engine logic | `frontend/src/js/engine/` |
| Wallet/chain logic | `frontend/src/js/blockchain/` |
| IPFS read/write | `frontend/src/js/ipfs/` |
| glTF CID translation | `frontend/src/js/gltf/` |
| Asset library (gallery) | `frontend/src/js/ui/asset-library.js` |
| Asset drop zone | `frontend/src/js/ui/asset-drop-zone.js` |
| Asset editors (chat/studio) | `frontend/src/js/ui/asset-editors.js` |
| Asset history (timeline) | `frontend/src/js/ui/asset-history.js` |
| Asset save/publish | `frontend/src/js/ui/asset-save.js` |
| Create panel | `frontend/src/js/ui/create-panel.js` |
| API service layer | `frontend/src/js/services/api.js` |
| Token resolver | `frontend/src/js/blockchain/token-resolver.js` |
| URI utilities | `frontend/src/js/blockchain/uri-utils.js` |
| **Activity panel** | `frontend/src/js/ui/ledger-panel.js` |
| Smart contracts | `blockchain/contracts/` |
| Hardhat config | `blockchain/hardhat.config.js` |
| Contract tests | `blockchain/test/` |
| Backend tests | `test/` |
| Build scripts | `frontend/scripts/` |
| Private IPFS Docker | `docker-compose.yml` + `docker/Dockerfile` + `docker/entrypoint.sh` |
| Hardhat Docker | `docker/hardhat.Dockerfile` |
| Current implementation snapshot | `docs/CURRENT_STATUS.md` |
| System architecture | `docs/ARCHITECTURE.md` |
| API specification | `docs/API_SPEC.md` |
| Zed agent onboarding | `docs/ZED_AGENT_GUIDE.md` + `.zed/tasks.json` |

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
| Blockchain | **EVM-compatible** |
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

# Equivalent root script
npm run build:frontend

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

# Run current focused API regression suite
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js --runInBand --silent

# ─── Blockchain (inside Hardhat container) ───
# Compile contracts
docker-compose run --rm hardhat npx hardhat compile

# Deploy contracts to local Hardhat network
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat

# Deploy to testnet (configure network in hardhat.config.js)
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network <your_testnet>

# Deploy to mainnet (configure network in hardhat.config.js)
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network <your_mainnet>

# Verify contract (configure verifier in hardhat.config.js)
docker-compose run --rm hardhat npx hardhat run scripts/verify.js --network <your_network>

# Recompile and redeploy after contract changes (captures ABI + address)
docker-compose run --rm hardhat npx hardhat compile
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat
# Then sync CONTRACT_ADDRESS from blockchain/.env to root .env

# Run deployment integrity tests to verify the pipeline is intact
npm run test:frontend

# Start an interactive shell inside the Hardhat container
docker-compose run --rm hardhat sh
```

### Contract Update Workflow (MANDATORY after any .sol change)

Every contract source change creates a **deployment pipeline** that must stay intact:

```text
.sol change  ->  compile  ->  artifacts on host  ->  backend serves ABI
            ->  deploy   ->  .env files update   ->  frontend gets address
```

**If any link breaks, the frontend gets stale ABIs or wrong addresses, causing `c.methods.X is not a function` or `Transaction reverted` errors.**

**Required steps after any `blockchain/contracts/*.sol` change:**

```bash
# 1. Recompile (writes fresh ABI to blockchain/artifacts/ on host)
docker-compose run --rm hardhat npx hardhat compile

# 2. Redeploy to local Hardhat (updates blockchain/.env + deployment artifact)
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat

# 3. Sync CONTRACT_ADDRESS from blockchain/.env to root .env (backend reads root .env)
#    The deploy script updates blockchain/.env but NOT root .env.
#    Manually copy the new CONTRACT_ADDRESS value, or run:
grep CONTRACT_ADDRESS blockchain/.env
#    Then update root .env to match.

# 4. Verify the pipeline is intact
npm run test:frontend
```

**The `test/frontend/deployment-integrity.test.js` test suite catches:**
- Missing/stale compiled ABI on host
- Missing ABI function entries (runs `test.each` over every required function)
- Conflicting CONTRACT_ADDRESS between root .env and blockchain/.env
- Missing USDC_TOKEN in blockchain/.env
- Deployment artifact not matching configured address
- Missing Docker volume mounts in docker-compose.yml

**ALWAYS run `npm run test:frontend` after contract changes before starting the backend.**

---

## 5. Environment Variables

Three `.env` files are used. All are in `.gitignore` and must never be committed.

### `blockchain/.env` (Required for blockchain scripts — create from example)

Copy the example file and fill in your keys:
```bash
cp blockchain/.env.example blockchain/.env
```

```ini
# RPC endpoints (configure for your target network)
API_URL=<your_rpc_endpoint>

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

# Mock mode: set to "true" to use local GLTF/GLB files instead of cloud APIs
MOCK_3D_GENERATION=true
MOCK_ASSETS_DIR=./mock-gltf-assets

# Private IPFS (Dockerized node)
IPFS_API_URL=http://127.0.0.1:5001
IPFS_GATEWAY_URL=http://127.0.0.1:8080/ipfs/

# Hardhat local network (Docker container)
HARDHAT_RPC_URL=http://127.0.0.1:8545

# ArbeskAsset contract address (deploy via Hardhat first)
CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3

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
- **Target**: EVM-compatible chains. Optimize for storage reads over writes.

### Pug / SCSS

- **Build**: Custom Node.js scripts in `frontend/scripts/` (not Webpack/Vite).
- **Partials**: Reusable includes live in `frontend/src/pug/includes/`.
- **CSS Framework**: Bootstrap 5 with custom Sass overrides.

### Backend Logging (Verbose by Design)

The backend uses structured console logging with tagged prefixes. **All essential operations are logged.**

| Tag | Meaning | Example |
|-----|---------|---------|
| `[BOOT]` | Server startup / config | `[BOOT] Server started at http://localhost:9090` |
| `[OK]` | Successful request | `[OK] GET /api/v1/manifests/:cid/history → 200 (14ms)` |
| `[ERR]` | Failed request (4xx/5xx) | `[ERR] POST /api/v1/manifests → 400 (2ms)` |
| `[IPFS]` | IPFS add/cat operations | `[IPFS] cat Qm... → 1240 chars` |
| `[SAVE]` | Manifest save | `[SAVE] manifest_id=... version=5 → cid=Qm...` |
| `[CHAIN]` | Manifest chain walk | `[CHAIN] walking from Qm...` |
| `[GEN]` | Asset generation pipeline | `[GEN] prompt="..." nodeId=... tx=0x...` |
| `[PARAM]` | Parametric version | `[PARAM] nodeId=... color=#FF5733` |
| `[AUTH]` | Authentication | `[AUTH] recovered address=0x... tx=0x...` |
| `[ABI]` | ABI serving | `[ABI] serving /path/to/ArbeskAsset.json` |
| `[TOKEN]` | Token child ref resolution | `[TOKEN] resolving child token #42 at 0x...` → `[TOKEN] resolved → Qm...` |
| `[SESSION]` | Session auth operations | `[SESSION] created — token=abc123... address=0x...` |
| `[UNPIN]` | IPFS unpin operations | `[UNPIN] collected 42 CIDs across 5 manifest(s)` |
| `[BURN]` | Token burn operations | `[BURN] token 42 manifest CID → Qm...` |

**Rules for adding new logs:**
1. Always prefix with `[TAG]` in UPPERCASE.
2. Log at the **start** of async operations (IPFS, blockchain, external APIs).
3. Log the **outcome** on completion (success CID, error message).
4. Include relevant identifiers (CID, txHash, nodeId, version) for traceability.
5. Use `console.error()` only for actual exceptions; use `console.log()` for operational flow.

---

## 6.5 Agent Decision-Making and User Choice

When a task, feature, or fix presents **multiple valid implementation options**, the agent **must not** proceed unilaterally with a single choice. Follow this protocol:

1. **Enumerate all viable options** — List every reasonable approach with a concise description and its trade-offs (e.g., complexity, performance, maintenance cost, compatibility).
2. **Highlight the recommendation** — Clearly mark one option as **(Recommended)** based on the project's existing conventions, simplicity, and long-term maintainability.
3. **Wait for explicit user choice** — Do not write code, modify files, or execute commands that implement any option until the user has explicitly selected one.

**This rule applies to (but is not limited to):**
- Architectural or structural changes
- Library or dependency choices
- UI layout or interaction patterns
- Refactoring strategies
- Deployment or configuration targets
- Algorithm or data-structure selections

**Exceptions:**
- Trivial decisions (e.g., local variable naming, minor formatting adjustments)
- Situations where the user has already explicitly specified an approach in their request
- Emergency fixes where only one option is technically viable (still briefly explain why)

---

## 7. The Fractal Manifest

Arbesk stores worlds as **fractal manifests** — JSON documents where every asset is a node that can contain:
- A manifest-level `thumbnail` object with optional WebP snapshot CID metadata
- A `source` object with `{ cid, path, format }` (e.g. GLB, GLTF, OBJ, FBX) OR `scad_source` (OpenSCAD code string)
- A `transform_matrix` (4x4 column-major)
- A `history` array of version deltas
- A `child_ref` object for token-based dynamic child world references (replaces legacy `child_manifest_id`)

**IPFS Content-Addressed Version Chain:**

Every manifest includes a `prev_manifest_cid` that points to the previous version's IPFS CID. This forms a backward-linked **manifest chain** (also called the **IPFS version chain**) walking from newest → oldest. Because each CID is a cryptographic hash of the manifest content, the chain is tamper-evident: altering any version invalidates all subsequent CIDs. The chain is consumed by:
- `GET /api/v1/manifests/:cid/history` — the backend walks `prev_manifest_cid` links up to 50 entries deep.
- **History timeline UI** — a draggable circular-node scrubber in the topbar for version switching.
- **Replay prevention** — the backend scans manifest history for duplicate `txHash` values.
- **Client-side activity log** — browser events are recorded in localStorage for the current session.

**Optional Manifest Thumbnail:**
```json
{
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
  }
}
```

The thumbnail is best-effort publish metadata. All code must tolerate missing thumbnails and failed thumbnail reads.

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

**Token-Based Child World References (Phase 5.1):**

As of Phase 5.1, child worlds are referenced by on-chain token IDs rather than static manifest CIDs. Each token child node stores a `child_ref` with `chainId`, `contractAddress`, and `tokenId`, resolving to the latest manifest CID via the token's `tokenURI` at load time:

```json
{
  "node_id": "child_token_314159_0xabc_42",
  "transform_matrix": [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    10, 0, -5, 1
  ],
  "child_ref": {
    "type": "token",
    "chainId": 314159,
    "contractAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "tokenId": "42",
    "standard": "ERC721",
    "resolution": "latest"
  }
}
```

Key rules for token child nodes:
- Every token child node **must** have a `transform_matrix` (identity matrix is the default for first drag/drop).
- Token child nodes do **not** include local `history` arrays — the referenced token's own manifest owns the history.
- Legacy `child_manifest_id` is replaced by `child_ref`; no backward-compat conditionals for this phase.
- Parent-local child events (added, moved, removed) are tracked client-side in the activity panel.
- Cycle/depth protection prevents self-references and caps child depth at `MAX_CHILD_WORLD_DEPTH = 5`.

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
User ← IPFS CID ← Upload Service ← Read from ./mock-gltf-assets/
       ↓
Manifest History Array ← Append Generation Version
```

**Mock Assets (current repo default):**
- `mock-gltf-assets/intro.gltf` — Default mock asset for generic prompts
- `mock-gltf-assets/suka.gltf` — Character/figure/person/avatar prompts

`MOCK_ASSETS_DIR` may point to an external SukaVerse GLB/GLTF asset directory, but the committed default adapter reads the local `.gltf` files above and returns `format: "gltf"`.

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
| Frontend | Build validation / manual browser testing | No automated E2E tests currently |
| Mock Adapters | Covered through API tests | `test/api.test.js` |

---

## 11. Session-Based Authentication

Each 3D generation involves two on-chain transactions (USDC approval + PayGo payment), which trigger two MetaMask pop-ups. Before session auth, the backend API call required a third signature (`personal.sign`) to prove wallet ownership — bringing the total to **3 pop-ups per generation**.

**Session auth reduces this to 2 pop-ups after the first generation** by having the user sign a session-creation message once, then reusing an opaque token for 24 hours.

### How it works

| Step | Pop-ups | What happens |
|------|:---:|---|
| First generation | 3 | USDC approval + PayGo payment + session creation signature |
| Subsequent generations | 2 | USDC approval + PayGo payment (session token reused) |

### Implementation

| File | Purpose |
|------|---------|
| `src/api/sessions.js` | Session store (in-memory Map, 24h TTL), create/validate/invalidate, `POST/DELETE /api/v1/sessions` routes |
| `src/api/authentication.js` | Accepts `Authorization: Session <token>` alongside existing `Bearer` scheme |
| `src/api/index.js` | Mounts session routes at `/api/v1/sessions` |
| `frontend/src/js/services/api.js` | `createSession()`, `getOrCreateSession()`, `clearSession()` — localStorage-backed with auto-clear on wallet disconnect |

### Security trade-off

The session token lives in `localStorage`. The only risk is physical access to the browser — accepted as a reasonable trade-off for eliminating the per-generation pop-up. Session tokens:
- Are opaque random UUIDs (not guessable)
- Expire after 24 hours
- Are bound to a specific wallet address (checked on every request)
- Are auto-cleared when the wallet disconnects

### Fallback behavior

If session creation fails (e.g., user denies the session signature), `generateAsset()` falls back to the per-request `Bearer` txHash signature — so generation still works, just with 3 pop-ups instead of 2.

---

## 12. Security Notes

- **`.env` files contain private keys and API keys**. Never commit them.
- **API Routes**: Always validate `req.body` and `req.params`.
- **Smart Contracts**: Use `ReentrancyGuard` for any function that transfers value.
- **IPFS**: Private node is isolated from public network. Do not expose ports beyond `127.0.0.1`.
- **Hardhat**: Local network at `8545` is for development only. Never expose to public internet.
- **Mock Mode**: Never deploy mock adapters to production. Use `MOCK_3D_GENERATION` env flag strictly.

---

## 13. Data Formats

### Fractal Manifest Entry (stored on private IPFS)

```json
{
  "manifest_id": "root_universe_world_001",
  "version": 4,
  "timestamp": 1780000000,
  "prev_manifest_cid": "QmPreviousManifestHash...",
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
      "child_ref": {
        "type": "token",
        "chainId": 314159,
        "contractAddress": "0x1234567890abcdef1234567890abcdef12345678",
        "tokenId": "7",
        "standard": "ERC721",
        "resolution": "latest"
      }
    },
    {
      "node_id": "child_token_314159_0xabc_42",
      "transform_matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, -5, 1],
      "child_ref": {
        "type": "token",
        "chainId": 314159,
        "contractAddress": "0x1234567890abcdef1234567890abcdef12345678",
        "tokenId": "42",
        "standard": "ERC721",
        "resolution": "latest"
      }
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

## 14. EVM Deployment Notes

- **Local Dev (Hardhat container)**: `http://127.0.0.1:8545`
- **Native Token**: Chain-native token (e.g. ETH, FIL, etc.) — used for gas
- **EVM Compatibility**: Standard Solidity contracts work unmodified
- **Gas Economics**: Varies by chain — test thoroughly on target testnet before mainnet
- **Block Time**: Varies by network (~12s for Ethereum L1, ~2s for L2s, slower on some L1s)
- **Wallet Support**: MetaMask, Rabby, or any EVM-compatible wallet (add target network manually)

---

## 15. Zed AI Agent Setup

This repository is initialized for Zed agent workflows.

| File | Purpose |
|------|---------|
| `.zed/tasks.json` | Repeatable Zed tasks for install/build/test/Docker/backend |
| `.zed/settings.json` | Excludes heavy/generated folders from project scanning |
| `docs/ZED_AGENT_GUIDE.md` | Short Zed-specific onboarding |
| `docs/CURRENT_STATUS.md` | Current implementation and validation snapshot |

**Recommended agent startup flow:**
1. Read this `AGENTS.md`.
2. Check `docs/CURRENT_STATUS.md` before making roadmap or architecture claims.
3. Use `.zed/tasks.json` task names when suggesting repeatable Zed workflows.
4. Keep this file and `.zed/tasks.json` synchronized when commands change.

---

## 16. Phase 5.1: Token ID-Based Child Worlds (DONE)

> **Status**: ✅ Complete — implemented, tested, and in production use.  
> **Source of truth:** `docs/CURRENT_STATUS.md` §3.2 and §4.2.

Child worlds are now referenced by on-chain token IDs rather than static manifest CIDs. The parent stores `chainId + contractAddress + tokenId` in a `child_ref` object; at load time the browser resolves the token's `tokenURI()` to the latest manifest CID.

### What was delivered

| # | Deliverable | File |
|---|-------------|------|
| Schema | `child_ref` manifest schema | `docs/CURRENT_STATUS.md` §7 |
| Resolver | Token → manifest CID | `frontend/src/js/blockchain/token-resolver.js` |
| Rendering | Scene graph `loadTokenChildNode()` with cycle/depth protection | `frontend/src/js/engine/scene-graph.js` |
| Drag/drop | Gallery cards → viewport drop | `frontend/src/js/ui/asset-library.js` + `asset-drop-zone.js` |
| Persist | Save `child_ref` nodes to IPFS manifest | `frontend/src/js/ui/asset-save.js` |
| States | Loading placeholders, error handling | `frontend/src/js/engine/placeholders.js` |
| Inspector | Token child info panel | `frontend/src/js/engine/parametric-preview.js` |
| Tests | Resolver, persistence, scene loading | `test/scene-graph.test.js`, `test/token-resolver.test.js`, `test/api.test.js` |

### Design principles (still in force)

1. **Clean slate**: Legacy `child_manifest_id` is replaced. No backward-compat conditionals.
2. **Token as dynamic pointer**: Resolves to latest CID on every load.
3. **Parent owns placement**: `transform_matrix` on each child node.
4. **No local history**: Token child nodes have no `history`; history lives in the referenced token's manifest.
5. **Isolation**: Failed resolution shows a placeholder; parent scene continues.
6. **Depth cap**: `MAX_CHILD_WORLD_DEPTH = 5`.

---

## 17. Manifest-Driven Activity Panel

> **Status**: Implemented — server-side micro-ledger removed.  
> **Goal**: Provide an accurate activity feed derived solely from the asset manifest file.

### Why Manifest-Only?

The manifest is the single source of truth. Every generation, parametric edit, save, and publish is already recorded inside it:
- **Per-node `history[]`** — Each node stores its generation and parametric versions with timestamps, prompts, and transaction hashes.
- **Manifest chain** — `prev_manifest_cid` links every version backward in time.
- **No shadow log** — No localStorage, no server JSONL, no duplicate state. The panel simply reads what the manifest already says.

### How It Works

1. When an asset loads (`scene:ready`), the panel fetches the manifest chain via `GET /api/v1/manifests/:cid/history`.
2. The backend walks `prev_manifest_cid` links (up to 50 deep) and returns every version.
3. The panel extracts two kinds of entries:
   - **Manifest-level** — Each version in the chain becomes a `SAVE` (first version) or `LOAD` (subsequent versions).
   - **Node-level** — Each entry in `nodes[].history[]` becomes a `GENERATION` or `PARAMETRIC` activity.
4. Entries are sorted by timestamp (newest first) and rendered.

### Design Principles

1. **Single source of truth**: The manifest owns the history; the panel only displays it.
2. **Thin server**: The history endpoint merely follows IPFS CID links. No separate ledger store.
3. **Cross-session accurate**: Because data comes from IPFS (via the manifest chain), the activity feed is identical on every browser, every session.
4. **Tamper-evident**: Altering any manifest version breaks its CID, invalidating the chain.

---

## 18. Contact & Links

- **Repository**: https://github.com/ahmadsayed/arbesk
- **Docs**: `docs/` directory in this repo
