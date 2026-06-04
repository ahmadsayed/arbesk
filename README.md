# Arbesk

> **Cloud-native 4D fractal version-controlled 3D asset platform**

Arbesk combines a Babylon.js world studio, private IPFS storage, Filecoin FEVM PayGo payments, and fractal JSON manifests into a local-first workflow for generating, versioning, publishing, and collaborating on 3D worlds.

- Repository: <https://github.com/ahmadsayed/arbesk>
- License: ISC
- Current status: Phases 1–4 + publishing polish + token child worlds are complete; Phase 5 micro-ledger/audit infrastructure is in progress.

---

## Current Capabilities

- **Private IPFS storage** — Dockerized Kubo node bound to loopback with no public DHT or bootstrap peers.
- **Dockerized Hardhat** — reproducible local EVM at `127.0.0.1:8545`.
- **Filecoin FEVM PayGo contract** — `ArbeskWorld.sol` supports generation payments, ERC721 world minting, token URI updates, and team editor management.
- **Mock 3D generation** — backend mock adapter returns local GLTF/GLB-style SukaVerse assets for deterministic development.
- **Fractal manifests** — worlds are JSON manifests on IPFS with nodes, sources, transforms, history entries, child manifest references, and optional thumbnails.
- **Parametric versions** — color and scale edits append history entries without payment or SaaS generation.
- **Babylon.js scene graph** — loads GLB/GLTF assets from private IPFS, supports one-node-per-world replacement behavior, selection, lazy child anchors, and history scrubbing.
- **On-demand browser IPFS cache** — memory + IndexedDB cache for IPFS JSON/blob payloads, populated only when content is opened.
- **Publish thumbnails** — publishing captures an optional `512x288` WebP snapshot, stores it on IPFS, and adds a lightweight `manifest.thumbnail` CID reference.
- **Gallery + team UI** — wallet-connected gallery renders world names/thumbnails and loads worlds by token ID; team panel manages editors on-chain.

See [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md) for the latest implementation snapshot and known gaps.

---

## Repository Layout

```text
arbesk/
├── src/                          # Express backend
│   ├── index.js                  # Server entry point
│   └── api/
│       ├── index.js              # API route registry + IPFS manifest helpers
│       ├── generate-asset-node.js# PayGo-validated mock generation route
│       ├── parametric-version.js # Color/scale edit route
│       ├── authentication.js     # Bearer txHash signature auth
│       ├── rate-limiter.js       # In-memory rate limits
│       └── adapters/             # Mock/cloud generation adapters
├── frontend/                     # Pug + SCSS + Bootstrap + Babylon.js frontend
│   ├── src/pug/                  # Studio template
│   ├── src/scss/                 # Studio styles
│   ├── src/js/engine/            # Scene graph, time travel, parametric preview
│   ├── src/js/blockchain/        # Web3.js wallet/contract integration
│   ├── src/js/ipfs/              # Remote IPFS reader + browser cache
│   ├── src/js/gltf/              # glTF CID URI conversion
│   ├── src/js/services/          # API/team services
│   └── src/js/ui/                # Chat, gallery, history, save/publish, team UI
├── blockchain/                   # Hardhat + Solidity FEVM target
│   ├── contracts/ArbeskWorld.sol
│   ├── scripts/deploy.js
│   ├── scripts/verify.js
│   └── test/ArbeskWorld.test.js
├── docker/                       # Private IPFS + Hardhat Dockerfiles
├── docs/                         # Architecture, API, current status, Zed guide
├── .zed/                         # Zed project tasks/settings
├── test/                         # Jest + Supertest backend tests
└── AGENTS.md                     # Zed/AI agent coding guide
```

---

## Documentation Index

| Document | Purpose |
|---|---|
| [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md) | Phase status, validation snapshot, known gaps |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture and data flows |
| [`docs/API_SPEC.md`](docs/API_SPEC.md) | Implemented Express API routes and response shapes |
| [`docs/ZED_AGENT_GUIDE.md`](docs/ZED_AGENT_GUIDE.md) | Zed task/agent onboarding |
| [`AGENTS.md`](AGENTS.md) | AI agent conventions, commands, file map, safety rules |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express ES modules |
| Frontend templates | Pug |
| Styling | SCSS + Bootstrap 5 |
| 3D renderer | Babylon.js |
| Frontend JS | Vanilla JavaScript ES modules |
| Web3 | Web3.js + Web3Modal |
| Blockchain | Filecoin FEVM / local Hardhat |
| Smart contracts | Solidity 0.8.24 + OpenZeppelin v5 |
| Blockchain dev | Dockerized Hardhat |
| Storage | Private Dockerized Kubo/IPFS |
| Runtime cache | Browser memory cache + IndexedDB |
| Testing | Jest + Supertest, Hardhat contract tests |
| Build | Custom Node.js frontend scripts |
| Editor/agent setup | Zed `.zed/tasks.json` + `AGENTS.md` |

---

## Quick Start

All commands run from the project root.

```bash
# 1. Install dependencies
npm install
cd frontend && npm install && cd ..

# Optional host-side blockchain deps for editor intellisense
cd blockchain && npm install && cd ..

# 2. Start local infrastructure: private IPFS + Hardhat node
docker-compose up -d

# 3. Build frontend assets into frontend/dist
npm run build:frontend

# 4. Start backend on port 9090
npm start
```

Open the app at:

```text
http://localhost:9090/studio.html
```

### Tests

```bash
# Backend API tests
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest

# Current focused API regression suite
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js --runInBand --silent

# Frontend build validation
npm run build:frontend

# Contract tests inside Dockerized Hardhat
docker-compose run --rm hardhat npx hardhat test
```

### Zed Tasks

This repo includes `.zed/tasks.json`. In Zed, use the task palette for:

- `Start Docker infrastructure`
- `Build frontend`
- `Run backend tests`
- `Run API tests only`
- `Run contract tests in Docker`
- `Start backend`
- `Start full dev stack`

---

## Environment Files

Environment files are intentionally ignored by Git.

- Root `.env` — backend/cloud adapter/private IPFS settings
- `blockchain/.env` — Filecoin RPC, deployment keys, contract addresses
- `frontend/.env` — optional build-time public frontend settings

Start blockchain configuration from:

```bash
cp blockchain/.env.example blockchain/.env
```

Never commit private keys, API keys, or wallet secrets.

---

## Manifest Thumbnail Format

Published worlds may include an optional thumbnail reference:

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

The frontend captures this snapshot during publish. The backend uploads the image separately to private IPFS and stores only the CID metadata in the manifest.

---

## Next Planned Phase

Phase 5 micro-ledger is in progress:

- ✅ Schema and JSONL append-only store
- ✅ Query API (`GET /api/ledger`, `GET /api/ledger/stats`)
- ✅ Operations hooked (GENERATION, PARAMETRIC, SAVE, PUBLISH)
- ✅ `anchorManifest()` in `ArbeskWorld.sol` + contract tests
- ✅ Frontend ledger panel
- 🔲 Per-asset filtering via `manifestId`
- 🔲 Snapshots and digital signatures (Phase 5b)

See [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md) for the full status.
