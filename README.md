# Arbesk

> **Cloud-native 4D fractal version-controlled 3D asset platform**

Arbesk combines a Babylon.js world studio, private IPFS storage, EVM PayGo payments, and fractal JSON manifests into a local-first workflow for generating, versioning, publishing, and collaborating on 3D worlds.

- Repository: <https://github.com/ahmadsayed/arbesk>
- License: ISC
- Current status: token child worlds, the free-tier contract, Merkle editor proofs, and collection manifests are all implemented. CDP email-login smart accounts, standalone library page, asset-level Nostr comments, token indexer, and the Tripo3D v3 generation integration (text-to-3D, image-to-3D, HD texture, smart retopology, rig & animate — BYOK) are also implemented.

---

## Current Capabilities

- **Private IPFS storage** — Dockerized Kubo node bound to loopback with no public DHT or bootstrap peers; Pinata backend for public testnet.
- **Dockerized Hardhat** — reproducible local EVM at `127.0.0.1:8545`.
- **EVM PayGo contracts** — `ArbeskAssetFree.sol` (free tier) and `ArbeskAsset.sol` (paid tier) support generation payments/quotas, ERC721 collection minting, token URI updates, and Merkle-proof editor authorization.
- **Collection manifests** — every published token is a collection manifest that maps `assetID`s to asset manifest CIDs; galleries expand collections into per-asset cards.
- **Merkle editor proofs** — editor sets are stored on IPFS; the contract stores only a Merkle root and version. URI updates, editor set changes, and burns require a valid Merkle proof.
- **Real 3D generation (Tripo3D v3, BYOK)** — text-to-3D and image-to-3D (JPEG/PNG/WebP attach) as async tasks with live polling; HD texture toggle; texture-only refine; smart retopology (`mesh/decimate` v2.0) for animation-ready topology; rig & animate chain (`rig-check → rig → retarget`, plus retarget-only re-animation of rigged models); credit balance display. Results land as chat bubbles with live orbitable previews and load into Studio on demand.
- **Mock 3D generation** — backend mock adapter returns local GLTF/GLB-style assets for deterministic development.
- **Fractal manifests** — worlds are JSON manifests on IPFS with nodes, sources, transforms, history entries, token-based `child_ref` links, and optional thumbnails.
- **Parametric versions** — color and scale edits append history entries without payment or SaaS generation.
- **Babylon.js scene graph** — loads GLB/GLTF assets from IPFS, supports one-node-per-world replacement behavior, selection, lazy child anchors, and history scrubbing.
- **On-demand browser IPFS cache** — memory + IndexedDB cache for IPFS JSON/blob payloads, populated only when content is opened (currently disabled).
- **Publish thumbnails** — publishing captures an optional `512x288` WebP snapshot, stores it on IPFS, and adds a lightweight `manifest.thumbnail` CID reference.
- **Token ID-based child worlds** — drag/drop worlds from the gallery into other worlds; child refs resolve dynamically via `tokenURI()` with cycle/depth protection and external chain support.
- **Gallery + team UI** — wallet-connected gallery renders asset names/thumbnails, expands collections, and loads worlds by token ID; team panel manages editors via Merkle updates.
- **Session auth** — 24-hour reusable session tokens eliminate the per-generation wallet signature pop-up after the first use.
- **CDP email-login smart accounts** — OTP email login creates an ERC-4337 smart account on Base Sepolia, gas-sponsored by CDP Paymaster.
- **Unified Studio + Library SPA** — `/studio` and `/library` are views of one SPA (`app.html`) with a Nautilus-style collection/asset browser, optimistic create, upload (GLB/glTF/3MF, decomposed at upload), burn, and Studio round-trip.
- **3MF pipeline** — prompt keyword `3mf` returns a 3MF sample; 3MF packages are parsed, decomposed to composite form on save/upload, and converted to glTF for rendering.
- **Asset-level Nostr comments** — per-asset comment threads scoped by `<chainId>:<contractAddress>:<tokenId>:<assetId>`, archived to IPFS on republish.
- **Token indexer** — chunked `eth_getLogs` backfill discovers owned and shared collection tokens for the gallery and library.

See [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md) for the latest implementation snapshot and known gaps.

---

## Studio vs `besk` CLI

Arbesk ships two clients on top of the same backend and SDKs:

- **Studio** — the full web SPA (`/studio` + `/library`): Babylon.js viewport, AI generation chat, collaboration, publishing.
- **`besk` CLI** (`./besk`, source in `packages/besk/`) — a terminal client for collection/asset management. It logs in with CDP email OTP, composes `@arbesk/asset-core` with Node adapters, and routes all on-chain writes through the backend wallet relay. Commands: `login`, `whoami`, `logout`, `collections`, `create`, `use`, `list`, `info`, `history`, `download`, `upload`, `delete`, `rename`, `send`, plus AI generation: `generate` (text/image/multiview-to-3D), `retexture`, `retopo`, `rig`, `animate`, `balance`, `cancel`.

Status legend: **✅** supported in the CLI today · **TODO** — feasible in a headless CLI, not yet implemented · **Not doable** — inherently requires the Studio GUI / 3D viewer.

| Area | Feature | Studio | `besk` CLI | CLI status / notes |
|---|---|---|---|---|
| **Auth & wallets** | CDP email login (OTP → smart account) | ✅ | ✅ | `login <email>` (browser-assisted) |
| | EOA wallets (MetaMask/Rabby) via SIWE | ✅ | TODO | No EOA/key-file auth path |
| | WalletConnect v2 | ✅ | TODO | |
| | Network selection (Hardhat local / Base Sepolia) | ✅ | ✅ | CLI: `ARBESK_CHAIN_ID` env var (no interactive switcher) |
| | Session persistence | ✅ | ✅ | Studio: in-memory + auto-restore; CLI: plaintext JSON file (OS keychain is TODO) |
| **Collections** | List collections | ✅ | ✅ | `collections` |
| | Create named collection | ✅ | ✅ | `create <name>` (idempotent — returns existing if already minted) |
| | Select active collection | ✅ | ✅ | `use <name>` (Studio: per-asset settings picker) |
| | Shared (editor) collections discovery | ✅ | TODO | CLI reads indexer `owned` scope only |
| | Burn collection + IPFS unpin | ✅ | TODO | Relay supports `burn`; CLI never calls it |
| | Rename collection | ✅ | TODO | CLI `rename` covers assets only |
| **Assets** | List assets in a collection | ✅ | ✅ | `list` |
| | Asset details (ID, version, CID, nodes) | ✅ | ✅ | `info` (Studio details pane also has a live 3D preview — Not doable) |
| | Upload glTF/GLB/3MF | ✅ | ✅ | `upload <file>` |
| | Download / export (GLB, glTF, 3MF) | ✅ | ✅ | `download <name>` |
| | Download a specific historical version | ✅ | ✅ | `download <name> <version>` (Studio restores via clocks/chat instead) |
| | Rename asset | ✅ | ✅ | `rename <old> <new>` |
| | Delete asset from collection (unpublish) | ✅ | ✅ | `delete` (always prompts; no `--yes` flag — TODO) |
| | Send asset to another collection | ✅ | ✅ | `send <asset> <collection> [fork\|live-ref]` (default fork; live-ref writes a child_ref wrapper) |
| | New empty asset | ✅ | TODO | |
| | Burn unreachable/inaccessible tokens | ✅ | TODO | |
| **Publishing** | Save draft (manifest build + IPFS upload) | ✅ | TODO | CLI writes are always relayed immediately |
| | Publish / republish (`tokenURI` update) | ✅ | ✅ | Via `create`/`upload`/`delete`/`rename` collection writes |
| | Free-tier quota / USDC PayGo payment flow | ✅ | TODO | No `wallet-payments` equivalent |
| | Publish thumbnail capture | ✅ | TODO | Captured by the browser on save/publish |
| | Comments archive snapshot on republish | ✅ | TODO | |
| | Editor (non-owner) writes via Merkle proof | ✅ | TODO | CLI hardcodes `proof: []` — owner-only writes |
| **AI generation** | Text-to-3D (Tripo3D v3 / mock) | ✅ | ✅ | `generate "<prompt>"` (mock default; `--provider tripo3d` + key) |
| | Image-to-3D (JPEG/PNG/WebP attach) | ✅ | ✅ | `generate --image <file>` |
| | Multiview-to-3D (up to 4 oriented views) | ✅ | ✅ | `generate --view front f.png --view left f.png …` |
| | Retexture (texture-only refine) | ✅ | ✅ | `retexture <asset> "<prompt>"` |
| | Smart retopology (polygon budget) | ✅ | ✅ | `retopo <asset> [faceLimit]` |
| | Auto-rig (biped-first with fallback) | ✅ | ✅ | `rig <asset>` (fallback is server-side) |
| | Animate (preset picker, in-place toggle) | ✅ | ✅ | `animate <asset> <preset>…` (positional presets, `--no-in-place`; no categorized picker) |
| | Provider selection, BYOK key, credit balance | ✅ | ✅ | `--provider`/`--key` (env: `ARBESK_PROVIDER`, `ARBESK_PROVIDER_KEY`), `balance` |
| | Texture-quality tiers (standard/detailed/extreme) | ✅ | ✅ | `--quality` (env: `ARBESK_TEXTURE_QUALITY`) |
| | Generation progress + cancel | ✅ | ✅ | Progress lines while polling; `cancel <taskId>` |
| | Result bubbles with live orbitable preview | ✅ | Not doable | Requires 3D viewer |
| | "Show in Studio" + auto-save draft | ✅ | Not doable | Requires 3D viewer |
| | Chat provenance (`metadata.chat`) restore | ✅ | TODO | CLI has no chat; version restore is the missing part |
| **Viewport & 3D editing** | Babylon viewport, selection, frame/reset camera | ✅ | Not doable | Requires 3D viewer |
| | Transform gizmos (translate/rotate/scale) | ✅ | Not doable | Requires 3D viewer |
| | Undo / redo | ✅ | Not doable | Interactive session state |
| | Grid/axes toggle, orientation view-cube | ✅ | Not doable | Requires 3D viewer |
| | Camera pose persistence per asset | ✅ | Not doable | Requires 3D viewer |
| | Parametric color editing (live preview) | ✅ | Not doable | Needs visual feedback |
| | Uniform scale editing | ✅ | Not doable | Needs visual feedback |
| | Animation clip preview | ✅ | Not doable | Requires 3D viewer |
| **Nesting (fractal children)** | Link child assets (drag from gallery, outliner) | ✅ | Not doable | Requires 3D viewer |
| | Fork vs live-reference on link | ✅ | Not doable | Requires 3D viewer |
| | Dive/ascend navigation + breadcrumbs | ✅ | Not doable | Requires 3D viewer |
| | Unlink child asset | ✅ | TODO | Manifest edit; selection UX is the open question |
| | Linked-token inspector | ✅ | Not doable | Requires 3D viewer |
| **Version history (4D)** | List version chain | ✅ | ✅ | `history` |
| | Scene clock (whole-asset scrubbing) | ✅ | Not doable | Requires 3D viewer |
| | Model clock (per-node scrubbing) | ✅ | Not doable | Requires 3D viewer |
| | Restore a historical version as current | ✅ | TODO | CLI can download any version but never repoints the tip |
| **Library UX** | Grid/list toggle, search, sort, multi-select | ✅ | Not doable | GUI browser paradigm |
| | Live 3D preview in details pane | ✅ | Not doable | Requires 3D viewer |
| | Deep links (`?asset=`, `?manifest=`) | ✅ | Not doable | Web-only concept |
| **Collaboration** | Manage collaborators (Merkle editor lists) | ✅ | TODO | Relay supports `updateEditors`; no CLI command |
| | Viewer/Editor roles, email → wallet resolution | ✅ | TODO | |
| | Asset comments (Nostr threads, @mentions) | ✅ | TODO | |
| **Activity** | Activity ledger (Generation/Save/Publish/… feed) | ✅ | TODO | Derivable from the manifest chain |

CLI-only capabilities (not in Studio): shell scriptability/pipelining, idempotent collection create, and direct version-positional download. Known CLI gaps beyond the table: no machine-readable (JSON) output mode and no global flags.

---

## Repository Layout

```text
arbesk/
├── src/                          # Express backend (TypeScript, Node type-stripping)
│   ├── index.ts                  # Server entry point
│   ├── config.ts                 # Multi-network Web3 config
│   └── api/
│       ├── index.ts              # Main router — all v1 routes
│       ├── assets/generate-node.ts  # PayGo-validated generation route (mock + Tripo3D task chains)
│       ├── storage/              # kubo/pinata storage backends
│       ├── authentication.ts     # Session token auth
│       ├── sessions.ts           # 24h session store (SIWE)
│       ├── siwe-verify.ts        # EIP-4361 verification (incl. CDP smart-account fallback)
│       ├── chat-proxy.ts         # WebSocket bridge: browser ↔ Nostr relay
│       ├── comments-archive.ts   # Nostr comment thread → IPFS archive
│       ├── token-indexer.ts      # Chunked eth_getLogs ownership/editor backfill
│       ├── routes/               # Per-domain route modules (ipfs, contracts, indexer, paymaster, …)
│       ├── rate-limiter.ts       # In-memory rate limits
│       └── adapters/             # Mock/cloud generation adapters
├── packages/asset-core/          # @arbesk/asset-core npm workspace (env-agnostic asset engine)
│   └── src/
│       ├── formats/              # gltf/, 3mf/, example/ — compose/decompose + pure parsers
│       ├── storage/              # memory, in-memory IPFS, IPFS upload-with-credential
│       ├── domain/  events/  executor/  kernels/  manifest/  state/  utils/
│       ├── runtime.ts  types.ts  facade.ts  index.ts
│       └── bench/
├── frontend/                     # Pug + custom SCSS design system + Babylon.js frontend
│   ├── src/pug/                  # Unified SPA templates (app.pug → Studio + Library)
│   ├── src/scss/                 # Custom SCSS design system (29 partials, no Bootstrap)
│   ├── src/js/engine/            # Scene graph, time travel, parametric preview
│   ├── src/js/blockchain/        # Web3.js wallet (EOA + CDP smart accounts), token resolver, SIWE
│   ├── src/js/ipfs/              # Remote IPFS reader + browser cache + writes (frontend adapters)
│   ├── src/js/formats/           # Format-handler registry (gltf/glb/3mf → asset-core engines)
│   ├── src/js/workers/           # glTF worker pool + worker executor
│   ├── src/js/services/          # API/team/asset-save/library/asset-delete services
│   └── src/js/ui/                # Chat, gallery, library grid, comments, collaborators,
│                                 # history clocks, save/publish, outliner, ledger panel
├── blockchain/                   # Hardhat + Solidity EVM target
│   ├── contracts/ArbeskAssetFree.sol
│   ├── contracts/ArbeskAsset.sol
│   ├── contracts/ArbeskAssetBase.sol
│   ├── scripts/deploy.js
│   ├── scripts/verify.js
│   └── test/ArbeskAsset.test.js
├── docker/                       # Private IPFS + Hardhat Dockerfiles
├── docs/                         # Architecture, API, current status
├── test/                         # Jest + Supertest backend tests
└── AGENTS.md                     # AI agent coding guide
```

---

## Documentation Index

| Document | Purpose |
|---|---|
| [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md) | Implementation status, validation snapshot, known gaps |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture and data flows |
| [`docs/API_SPEC.md`](docs/API_SPEC.md) | Implemented Express API routes and response shapes |
| [`docs/MEGAETH_ANALYSIS.md`](docs/MEGAETH_ANALYSIS.md) | MegaETH gas model and cost projections |
| [`docs/MERKLE_IMPLEMENTATION.md`](docs/MERKLE_IMPLEMENTATION.md) | Merkle editor architecture |
| [`AGENTS.md`](AGENTS.md) | AI agent conventions, commands, file map, safety rules |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express ES modules |
| Frontend templates | Pug |
| Styling | Custom SCSS design system (no Bootstrap) |
| 3D renderer | Babylon.js |
| Frontend JS | Vanilla JavaScript ES modules |
| Web3 | Web3.js + custom wallet picker (EIP-6963 + WalletConnect v2) + CDP embedded wallets |
| Blockchain | EVM-compatible / local Hardhat / Base Sepolia Testnet |
| Smart contracts | Solidity 0.8.24 + OpenZeppelin v5 |
| Blockchain dev | Dockerized Hardhat |
| 3D generation | Tripo3D v3 API (BYOK: text/image-to-3D, retopology, rig & animate) + mock adapter |
| Storage | Private Dockerized Kubo/IPFS (local); Pinata (testnet) |
| Comments | Local Nostr relay (dev) via WebSocket chat proxy |
| Runtime cache | Browser memory cache + IndexedDB |
| Testing | Jest + Supertest, Hardhat contract tests, Playwright E2E |
| Build | Custom Node.js frontend scripts |
| Agent setup | `AGENTS.md` |

---

## Quick Start

All commands run from the project root.

```bash
# 1. Install dependencies
npm install
cd frontend && npm install && cd ..

# Optional host-side blockchain deps for editor intellisense
cd blockchain && npm install && cd ..

# 2. Start local infrastructure: private IPFS + Hardhat node + Nostr relay
docker compose up -d

# 3. Build frontend assets into frontend/dist
npm run build:frontend

# 4. Start backend on port 9090
npm start
```

Or use the one-command dev stack (IPFS + Hardhat + Nostr + backend):

```bash
./scripts/start-dev.sh            # add --testnet for Base Sepolia + Pinata
```

Open the app at:

```text
http://localhost:9090/studio      # 3D Studio
http://localhost:9090/library     # Collection/asset browser
```

### Tests

```bash
# All Jest unit tests
npm test

# Current focused API regression suite
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js --runInBand --silent

# Frontend build validation
npm run build:frontend

# Contract tests inside Dockerized Hardhat
docker compose run --rm hardhat npx hardhat test

# Playwright E2E critical path (wallet → generate → save → publish → library)
npm run test:e2e -- --project=chromium
```

See `e2e/README.md` for the full E2E contract (22 specs, worktree isolation, selector map).

---

## Environment Files

Environment files are intentionally ignored by Git.

- Root `.env` — backend/cloud adapter/private IPFS settings
- `blockchain/.env` — RPC endpoints, deployment keys, contract addresses
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
    "cid": "bafyThumbnailCid...",
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

The frontend captures this snapshot during publish. The backend uploads the image separately to IPFS and stores only the CID metadata in the manifest.

---

## Collection Manifest Format

Every published token points to a collection manifest:

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

The gallery expands collection tokens into one card per `assets` entry.

