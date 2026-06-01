# Arbesk

> **4D Fractal Version-Controlled 3D Asset Platform**

Arbesk merges **SukaVerse** (decentralized spatial state tracking) and **PromptSCAD** (generative CAD inputs) into the world's first **4D Fractal Version-Controlled Scene Graph**. Users generate 3D assets via cloud AI services, store them as versioned fractal manifests on a **private IPFS node**, and navigate through time and space with a **Filecoin FEVM** pay-as-you-go model.

**Current Status**: Phases 1–4 complete. Phase 5 (Micro-Ledger & Audit Infrastructure) is the upcoming focus.

---

## What is Arbesk?

- **Cloud 3D Generation**: Integrates Tripo3D, Meshy, and Hunyuan3D APIs to turn text prompts into production-ready 3D meshes. **Mock adapters** use pre-built GLB models from SukaVerse for offline testing.
- **Parametric Versioning**: Users can edit **color** and **scale** of any node directly in the UI. Each edit appends a new version entry to the node's history — no cloud generation required.
- **Fractal Version Control**: Every asset maintains a full history array. Time-travel any node independently without affecting its parent or siblings.
- **History Timeline Scrubber**: Draggable circular-node timeline in the topbar for Google Earth-style version navigation.
- **Dollhouse Architecture**: Worlds nest recursively — a room contains a desk, a desk contains a drawer, a drawer contains a micro-city.
- **Web3 PayGo**: Per-generation micropayments on **Filecoin FEVM**. No subscriptions, no vaults, no refunds.
- **Private IPFS**: All assets stored on a **Dockerized private IPFS node** (no public DHT, no external peers) for complete data sovereignty.
- **Containerized Blockchain**: Hardhat runs in a **Docker container** alongside IPFS for reproducible local contract development.
- **OpenSCAD Hybrid**: Supports both cloud AI generation and procedural OpenSCAD code (WASM in browser) — scaffolded, deferred post-MVP.
- **Team Collaboration**: Mint worlds as NFTs, then add/remove editors via on-chain contract calls.
- **Verbose Backend Logging**: Every essential operation (IPFS add/cat, manifest save, generation, parametric edit, auth) is logged with structured tagged output.

---

## Repository Layout

```
arbesk/
├── src/                          # Express backend
│   ├── index.js                  # Server entry point
│   └── api/
│       ├── index.js              # API route registry
│       ├── generate-asset-node.js# Cloud generation / mock adapter
│       └── parametric-version.js # Color & scale edits → new history entry
├── frontend/                     # Pug + SCSS + Bootstrap + Babylon.js frontend
│   ├── src/
│   │   ├── pug/                  # Page templates
│   │   ├── scss/                 # Stylesheets
│   │   ├── js/
│   │   │   ├── engine/           # Babylon.js scene graph & time-travel
│   │   │   ├── blockchain/       # Web3.js wallet integration (FEVM)
│   │   │   ├── ipfs/             # IPFS read/write helpers (private node)
│   │   │   ├── gltf/             # glTF CID translation utilities
│   │   │   ├── services/         # API service layer, team service
│   │   │   └── ui/               # UI controllers (chat, history, save, gallery, team)
│   │   └── assets/               # Images, GLB files, fonts
│   ├── scripts/                  # Build scripts (Pug → HTML, SCSS → CSS)
│   ├── public/                   # Built static assets
│   └── package.json
├── blockchain/                   # Hardhat + Solidity (FEVM target)
│   ├── contracts/
│   │   └── ArbeskWorld.sol       # PayGo + ERC721 + editor management
│   ├── scripts/
│   │   ├── deploy.js             # Deployment script (Filecoin)
│   │   └── verify.js             # Filfox verification
│   ├── test/
│   │   └── ArbeskWorld.test.js   # Contract tests
│   ├── hardhat.config.js
│   └── package.json
├── docker/                       # Container definitions
│   ├── Dockerfile                # Private IPFS (Kubo)
│   ├── entrypoint.sh             # IPFS private config
│   └── hardhat.Dockerfile        # Hardhat dev environment
├── docker-compose.yml            # Orchestrates IPFS + Hardhat containers
├── docs/                         # Architecture, API spec, MVP plan
├── test/                         # Jest + Supertest backend tests
├── AGENTS.md                     # Developer conventions
└── README.md                     # This file
```

---

## Documentation Index

| Document | Purpose |
|----------|---------|
| [`docs/MVP_PLAN.md`](docs/MVP_PLAN.md) | Product specification, phased roadmap, AI agent instructions |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture, data flows, component breakdown |
| [`docs/API_SPEC.md`](docs/API_SPEC.md) | REST API specification for the Express backend |
| [`AGENTS.md`](AGENTS.md) | Coding conventions, build commands, environment variables |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express |
| Frontend Templates | Pug |
| Styling | SCSS + Bootstrap 5 |
| 3D Renderer | Babylon.js |
| Frontend JS | Vanilla JavaScript (ES modules) |
| Web3 | Web3.js + Web3Modal |
| Blockchain | **Filecoin FEVM** |
| Smart Contracts | Solidity 0.8.17, OpenZeppelin |
| Blockchain Dev | **Hardhat (Dockerized)** |
| 3D Generation | Tripo3D / Meshy / Hunyuan3D APIs; **Mock adapters** for dev |
| Procedural CAD | OpenSCAD WASM (browser) |
| Storage | **Private IPFS** (Dockerized Kubo node) |
| Testing | Jest + Supertest (backend), Hardhat (contracts) |
| Build | Custom Node.js scripts |
| Orchestration | Docker Compose |

---

## Quick Start

```bash
# 1. Start all infrastructure containers (IPFS + Hardhat)
docker-compose up -d

# 2. Install root + frontend dependencies
npm install
cd frontend && npm install && cd ..

# 3. Build frontend (Pug → HTML, SCSS → CSS, JS copy, assets copy)
cd frontend && npm run build && cd ..

# 4. Start backend server (port 9090)
npm start

# 5. Run backend tests
npm test

# ─── Blockchain (inside Hardhat container) ───
# Compile contracts
docker-compose run --rm hardhat npx hardhat compile

# Run contract tests
docker-compose run --rm hardhat npx hardhat test

# Deploy to local Hardhat network
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat

# Deploy to Filecoin Calibration testnet
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network filecoinCalibration
```

See [`AGENTS.md`](AGENTS.md) for full commands and environment variables.

---

## License

MIT
