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
- Babylon.js scene graph loading for GLB/GLTF assets
- One-node-per-world replacement behavior for generation history
- Parametric color/scale versions without payment or cloud generation
- Timeline/history browser for manifest versions
- Wallet, minting, token URI update, gallery, and team editor UI
- Browser-side on-demand IPFS cache using memory + IndexedDB
- Optional WebP world thumbnails captured during publish and stored by CID in manifests

Phase 5 remains the next planned focus: structured micro-ledger and audit infrastructure.

---

## Phase Status

| Phase | Status | Notes |
|---|---:|---|
| Phase 1: Data Bridge, Mock Adapters & Private IPFS | ✅ Complete | Backend API, private IPFS, mock generation, manifest writes |
| Phase 2: Parametric Versions & Babylon Rendering | ✅ Complete | Scene graph, time travel, parametric preview/save |
| Phase 3: PayGo Smart Contract & On-Chain Integration | ✅ Complete | FEVM contract, tx validation, replay prevention, Hardhat Docker |
| Phase 4: UI Assembly & Workspace Studio | ✅ Complete | Studio shell, wallet, gallery, minting, team editor panel |
| Phase 4.1: Publishing Polish & Runtime Cache | ✅ Complete | Optional WebP thumbnails, gallery thumbnails, on-demand IPFS cache |
| Phase 5: Micro-Ledger & Audit Infrastructure | 🔄 Planned | Append-only operation ledger, query API, contract anchoring |

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

- `test/api.test.js`: 13 tests passed
- Frontend build passed
- Zed diagnostics reported no warnings/errors in touched files

---

## Known Gaps / Next Work

1. **Phase 5 ledger** — add durable operation records for generation, parametric edits, saves, publishes, mint/update URI, and team editor changes.
2. **Production adapters** — Tripo3D, Meshy, and Hunyuan3D are described by the architecture but not implemented; current generation uses the mock adapter unless cloud adapters are added.
3. **Auth/payment hardening** — further align signed wallet address, tx sender, event payload, prompt, and node ID.
4. **Frontend automated tests** — no E2E/browser automation is currently committed.
5. **OpenSCAD WASM** — schema-compatible but deferred post-MVP.
6. **Thumbnail quality controls** — currently captures a fixed `512x288` WebP snapshot at publish time; future UI could allow recapture/crop/disable controls.
