# Arbesk Current Status

> Last updated: 2026-06-01  
> Repository: <https://github.com/ahmadsayed/arbesk>  
> Default branch: `main`

---

## Executive Summary

Arbesk is now a working local-first MVP for a Filecoin FEVM-backed, private-IPFS, versioned 3D world platform.

Completed capabilities include:

- Private Dockerized Kubo/IPFS infrastructure
- Dockerized Hardhat local EVM
- `ArbeskWorld.sol` PayGo + ERC721 world ownership + team editor contract
- Mock 3D generation pipeline backed by local SukaVerse-style GLTF assets
- Fractal manifest storage on private IPFS
- Babylon.js scene graph loading for GLB/GLTF assets with automatic model centering
- One-node-per-world replacement behavior for generation history
- Parametric color/scale versions without payment or cloud generation
- Timeline/history browser for manifest versions
- Wallet, minting, token URI update, gallery, and team editor UI
- Browser-side on-demand IPFS cache using memory + IndexedDB
- Optional WebP world thumbnails captured during publish and stored by CID in manifests

**Current active phase**: Phase 5.1 — Token ID-Based Child Worlds (11 issues, MVP spans #1–#6). Phase 5 micro-ledger remains the next planned focus after 5.1 completes.

---

## Phase Status

| Phase | Status | Notes |
|---|---:|---|
| Phase 1: Data Bridge, Mock Adapters & Private IPFS | ✅ Complete | Backend API, private IPFS, mock generation, manifest writes |
| Phase 2: Parametric Versions & Babylon Rendering | ✅ Complete | Scene graph, time travel, parametric preview/save, model centering |
| Phase 3: PayGo Smart Contract & On-Chain Integration | ✅ Complete | FEVM contract, tx validation, replay prevention, Hardhat Docker |
| Phase 4: UI Assembly & Workspace Studio | ✅ Complete | Studio shell, wallet, gallery, minting, team editor panel |
| Phase 4.1: Publishing Polish & Runtime Cache | ✅ Complete | Optional WebP thumbnails, gallery thumbnails, on-demand IPFS cache |
| **Phase 5.1: Token ID-Based Child Worlds** | **✅ Complete** | `child_ref` schema, token resolver, drag/drop, scene graph rendering, persistence, inspector, external chain support, tests |
| **Phase 5: Micro-Ledger & Audit Infrastructure** | **🔄 In Progress** | Schema & JSONL store done, API mounted, operations hooked, `anchorManifest()` in contract, frontend ledger panel built |

---

## Token ID-Based Child Worlds (Phase 5.1)

11 open GitHub issues — **all MVP (#1-#6) and polish (#7-#10) completed**:

- **#1** ✅ Schema: Clean `child_ref` manifest schema with `transform_matrix` per node
- **#2** ✅ Resolver: `tokenURI(tokenId)` → manifest CID normalization with 30s cache
- **#3** ✅ Rendering: Scene graph loads token children recursively with cycle/depth protection (MAX_CHILD_WORLD_DEPTH=5)
- **#4** ✅ Drag/drop: Gallery cards as drag sources; scene canvas as drop target with "Add to Scene" button
- **#5** ✅ Persist: Save `child_ref` nodes to IPFS manifest; merge with existing nodes on save
- **#6** ✅ Safety: Pulsing loading placeholders, error placeholders, duplicate rejection, self-reference detection
- **#7** ✅ Inspector: Read-only token child info panel showing token ID, contract, chain, CID
- **#8** ✅ External: Known RPC endpoints for cross-chain resolution (local Hardhat, Filecoin Calibration, Ethereum, Sepolia)
- **#9** ✅ Tests: 11 unit tests (normalizeTokenURI + schema validation), 3 integration tests (child ref save, mixed manifests, publish with thumbnail)
- **#10** ✅ Docs: AGENTS.md, CURRENT_STATUS.md updated

MVP cutoff was #1–#6. Full epic (#1–#10) completed.

---

## Current Data Model Additions

Published manifests may now include an optional `thumbnail` object:

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

During publish, the browser captures a WebP snapshot from the Babylon canvas. The backend uploads the image bytes separately to private IPFS and strips the embedded `dataUrl` from the stored manifest.

---

## Validation Snapshot

Most recent validation performed after thumbnail/publishing updates:

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js --runInBand --silent
npm run build:frontend
```

Result:

- `test/api.test.js`: 16 tests passed (3 new child_ref integration tests)
- `test/token-resolver.test.js`: 15 tests passed (11 normalizeTokenURI + 4 schema validation)
- Frontend build passed
- Zed diagnostics: no errors or warnings

---

## Known Gaps / Next Work

### Completed (Phase 5.1)

All 10 issues completed:
1. ✅ `child_ref` schema with `transform_matrix` per node
2. ✅ Token resolver with 30s in-memory cache and URI normalization
3. ✅ Scene graph renders token children recursively with cycle/depth protection
4. ✅ Drag/drop from gallery + "Add to Scene" button
5. ✅ Save/publish merges pending child refs into manifests
6. ✅ Loading placeholders (pulsing), error placeholders, duplicate/cycle rejection
7. ✅ Inspector shows read-only token child info (token ID, contract, chain, CID)
8. ✅ External chain RPC support (Hardhat, Filecoin Calibration, Ethereum, Sepolia)
9. ✅ 15 unit + 3 integration tests
10. ✅ Documentation updated

### Upcoming (Phase 5)

5. **Micro-ledger** — ✅ Phase 5a (MVP) in progress:
   - ✅ `src/ledger/schema.js` — LedgerEntry types and validation
   - ✅ `src/ledger/store.js` — JSONL append-only store with query support
   - ✅ `src/api/ledger.js` — Query API (`GET /api/ledger`, `GET /api/ledger/stats`)
   - ✅ Routes mounted and operations hooked (GENERATION, PARAMETRIC, SAVE, PUBLISH)
   - ✅ `ArbeskAsset.sol` — `anchorManifest()` function + `ManifestAnchored` event
   - ✅ Contract tests (5 tests for anchoring)
   - ✅ `frontend/src/js/ui/ledger-panel.js` — Collapsible audit trail panel with filter + anchor
   - 🔲 Ledger panel not yet wired to show per-asset filtering via `manifestId` (uses global view)
   - 🔲 Snapshots and digital signatures deferred to Phase 5b

### Deferred

6. **Production adapters** — Tripo3D, Meshy, and Hunyuan3D are described by the architecture but not implemented; current generation uses the mock adapter unless cloud adapters are added.
7. **Auth/payment hardening** — further align signed wallet address, tx sender, event payload, prompt, and node ID.
8. **Frontend automated tests** — no E2E/browser automation is currently committed.
9. **OpenSCAD WASM** — schema-compatible but deferred post-MVP.
10. **Thumbnail quality controls** — currently captures a fixed `512x288` WebP snapshot at publish time; future UI could allow recapture/crop/disable controls.
