# Arbesk Current Status

> Last updated: 2026-06-06  
> Repository: <https://github.com/ahmadsayed/arbesk>  
> Default branch: `main`

---

## Executive Summary

Arbesk is now a working local-first MVP for a EVM-backed, private-IPFS, versioned 3D world platform.

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

**Current active phase**: Phase 5.1 — Token ID-Based Child Worlds (all 10 issues complete). Server-side micro-ledger removed; activity tracking is now client-side only.

---

## Phase Status

| Phase | Status | Notes |
|---|---:|---|
| Phase 1: Data Bridge, Mock Adapters & Private IPFS | ✅ Complete | Backend API, private IPFS, mock generation, manifest writes |
| Phase 2: Parametric Versions & Babylon Rendering | ✅ Complete | Scene graph, time travel, parametric preview/save, model centering |
| Phase 3: PayGo Smart Contract & On-Chain Integration | ✅ Complete | EVM contract, tx validation, replay prevention, Hardhat Docker |
| Phase 4: UI Assembly & Workspace Studio | ✅ Complete | Studio shell, wallet, gallery, minting, team editor panel |
| Phase 4.1: Publishing Polish & Runtime Cache | ✅ Complete | Optional WebP thumbnails, gallery thumbnails, on-demand IPFS cache |
| **Phase 5.1: Token ID-Based Child Worlds** | **✅ Complete** | `child_ref` schema, token resolver, drag/drop, scene graph rendering, persistence, inspector, external chain support, tests |

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
- **#8** ✅ External: Known RPC endpoints for cross-chain resolution (local Hardhat, Calibration testnet, Ethereum, Sepolia)
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
8. ✅ External chain RPC support (Hardhat, Calibration testnet, Ethereum, Sepolia)
9. ✅ 15 unit + 3 integration tests
10. ✅ Documentation updated

### Upcoming

5. **Manifest-driven activity panel** — The ledger panel derives its feed entirely from the asset manifest chain (`prev_manifest_cid` + `nodes[].history[]`). No localStorage, no server-side ledger, no event accumulation.

### Recent Changes

11. **Documentation cleanup (2026-06-06)** — All Filecoin-specific references removed from project documentation (AGENTS.md, README.md, ARCHITECTURE.md, CURRENT_STATUS.md, ZED_AGENT_GUIDE.md, SECURITY.md, skill files). Project now describes a generic EVM-compatible target. Hardhat network names and RPC configs in code remain intact.

### Deferred

12. **Production adapters** — Tripo3D, Meshy, and Hunyuan3D are described by the architecture but not implemented; current generation uses the mock adapter unless cloud adapters are added.
13. **Auth/payment hardening** — further align signed wallet address, tx sender, event payload, prompt, and node ID.
14. **Frontend automated tests** — no E2E/browser automation is currently committed.
15. **OpenSCAD WASM** — schema-compatible but deferred post-MVP.
16. **Thumbnail quality controls** — currently captures a fixed `512x288` WebP snapshot at publish time; future UI could allow recapture/crop/disable controls.
