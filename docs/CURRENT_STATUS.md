# Arbesk — Current Implementation Status

> **Generated:** 2026-06-30
> **Source of truth:** The codebase (backend, frontend, contracts, tests, build scripts). Architecture docs and API specs are reference only.
> **Contract:** `ArbeskAssetFree` is the default/free tier; `ArbeskAsset` is the paid tier (not `ArbeskWorld` — that name only exists in older docs).
> **Frontend build:** Custom Node.js scripts (no bundler).
> **Network targets:** Hardhat local for development; MegaETH Testnet (chain ID 6343) for EOA wallets; Monad Testnet (chain ID 10143) for social-login smart accounts.

---

## 1. Phase Completion Snapshot

| Phase | Status | Evidence in Code |
|-------|--------|------------------|
| Phase 1: Data Bridge, Mock Adapters & Private IPFS | ✅ Complete | `src/api/assets/generate-node.js`, `src/api/adapters/mock-adapter.js`, `docker-compose.yml`, `src/api/storage/` |
| Phase 2: Parametric Versions & Babylon.js Rendering | ✅ Complete | `frontend/src/js/engine/parametric-preview.js`, `frontend/src/js/engine/time-travel.js` |
| Phase 3: PayGo Smart Contract & On-Chain Integration | ✅ Complete | `blockchain/contracts/ArbeskAsset.sol`, `frontend/src/js/blockchain/wallet.js` |
| Phase 4: UI Assembly & Consolidated Workspace Studio | ✅ Complete | `frontend/src/pug/studio.pug`, 29 SCSS partials, sidebar/outliner/nesting |
| Phase 4.1: Publishing Polish & Runtime Cache | ✅ Complete | Thumbnail capture in `scene-graph.js`, browser-side thumbnail upload to IPFS, unpin lifecycle |
| Phase 5.1: Token ID-Based Child Worlds | ✅ Complete | `child_ref` resolution in `token-resolver.js`, depth/cycle protection in `scene-graph.js` |
| Phase 5.2: Free Tier Contract | ✅ Complete | `ArbeskAssetFree.sol` deployed as default, `ArbeskAsset.sol` kept as paid tier |
| Phase 5.3: Merkle Editor Proofs | ✅ Complete | `editorRoot`/`editorSetVersion` in `ArbeskAssetBase.sol`, `frontend/src/js/gltf/merkle-editors.js`, `frontend/src/js/services/team.js` |
| Phase 5.4: Collection Manifests | ✅ Complete | Collection merge in `services/asset-save/manifest-builder.js`, collection expansion in `asset-library.js`, collection loading in `scene-graph.js` |
| Asset-Level Nostr Comments | ✅ Complete | `state/comment-thread.js`, `ui/comments-panel.js`, `src/api/chat-proxy.js`, `src/api/comments-archive.js`, E2E specs 14 + 15 |
| Standalone Library Page | ✅ Complete | `library.pug`, `library-init.js`, `library-grid.js`, `library-toolbar.js`, `library-context-menu.js`, `services/library-ops.js`, E2E specs 09–12 |
| Social Login (Google / Thirdweb AA) | ✅ Complete | `wallet-thirdweb.js`, `thirdweb-auth.js`, ERC-4337 smart accounts on Monad Testnet |
| Monad Testnet Support | ✅ Complete | `constants/chains.js`, `network-config.js`, deployed `ArbeskAssetFree` at block 41167307 |
| Token Indexer (chunked backfill) | ✅ Complete | `src/api/token-indexer.js`, `src/api/routes/indexer.js`, per-chain `LOG_CHUNK_SIZES` |
| Optimistic Collection Create UI | ✅ Complete | `ui/library-create.js`, `minting` status + spinner badge, auto-rollback on cancel |
| Phase 5: Micro-Ledger | ❌ Not started | `ledger-panel.js` derives activity from manifest chain; `anchorManifest()` is stubbed |

---

## 2. Backend (`src/`)

### 2.1 Actual File Layout

```
src/
├── index.js                    # Express bootstrap, CSP, request logging
├── config.js                   # Multi-network Web3 config (Hardhat local, MegaETH Testnet)
└── api/
    ├── index.js                # Main router — all v1 routes
    ├── assets/
    │   └── generate-node.js    # 3D generation (mock-only)
    ├── adapters/
    │   └── mock-adapter.js     # Reads local .gltf files
    ├── storage/
    │   ├── index.js            # Storage backend factory (kubo/pinata)
    │   ├── kubo-adapter.js     # Local Kubo add/cat/pin/directory/unpin
    │   └── pinata-adapter.js   # Pinata v3 SDK + presigned upload URLs
    ├── abi-router.js           # Serves compiled ABI from blockchain/artifacts/
    ├── authentication.js       # Session token validation middleware (SIWE + Thirdweb JWT)
    ├── authorization.js        # On-chain asset access checks for chat proxy
    ├── chat-proxy.js           # WebSocket bridge: browser ↔ Nostr relay (session-gated, rate-limited)
    ├── comments-archive.js     # Asset-level Nostr comment thread → IPFS archive
    ├── errors.js               # Standardized error response helper
    ├── ipfs-utils.js           # catManifest() with timeout/abort
    ├── manifest-utils.js       # getSceneNodes, bumpManifestVersion
    ├── nostr-relay.js          # Shared relay primitives (used by chat-proxy + comments-archive)
    ├── rate-limiter.js         # In-memory per-wallet rate limiter
    ├── thirdweb-auth.js        # Thirdweb JWT verification (JWKS from login.thirdweb.com)
    ├── token-indexer.js        # Chunked eth_getLogs backfill for owned/shared token discovery
    ├── routes/                 # Per-domain route modules
    │   ├── comments.js         # POST /assets/snapshot-comments
    │   ├── contracts.js        # GET /contracts/:name/abi
    │   ├── indexer.js          # GET /indexer/owned — token ownership lookup
    │   ├── ipfs.js             # POST /ipfs/upload-url + /ipfs/unpin
    │   ├── openapi.js          # GET /openapi.json + /docs
    │   └── test-utils.js       # Test-only reset helpers
    ├── sessions.js             # SIWE session create/delete (24h TTL)
    ├── siwe-verify.js          # EIP-4361 message verification
    └── openapi.json            # Static OpenAPI spec
```

### 2.2 Implemented Routes (`/api/v1`)

| Method | Path | Auth | What it does |
|--------|------|------|--------------|
| GET | `/config` | None | Returns contract address, network configs, IPFS backend/gateway, mock flag, thirdwebClientId |
| POST | `/sessions` | None | Creates SIWE session (EIP-4361) or Thirdweb JWT session |
| DELETE | `/sessions` | Session | Invalidates session token |
| POST | `/generations` | Session | Validates session + rate limit, calls mock adapter, returns raw bytes |
| POST | `/assets/snapshot-comments` | Session | Snapshots asset-level Nostr comment thread to IPFS archive; requires `assetId` |
| POST | `/ipfs/upload-url` | Session | Mints a short-lived presigned upload credential (Pinata/Kubo) |
| POST | `/ipfs/unpin` | Session | Walks up to 100 manifests, collects all CIDs, unpins them |
| GET | `/contracts/:name/abi` | None | Serves compiled ABI JSON from `blockchain/artifacts/` |
| GET | `/indexer/owned` | None | Returns owned token IDs for an address+chainId via chunked eth_getLogs backfill; supports `force=true` to bypass cache |
| GET | `/openapi.json` | None | Static OpenAPI spec |
| GET | `/docs` | None | Swagger UI HTML bundle |
| WS | `/v1/chat/ws` | Session (query) | WebSocket bridge to Nostr relay for live comments, rate-limited (10 msg/min) |

### 2.3 Auth Details

**Two session types now exist:**

1. **SIWE-based** (`Authorization: Session <token>`) — for EOA wallets (MetaMask/Rabby/WalletConnect). EIP-4361, domain-bound, 5-minute message age, nonce replay protection.
2. **Thirdweb JWT** (`Authorization: Session <thirdwebJwt>`) — for social-login smart accounts. JWT verified against Thirdweb's JWKS endpoint (`login.thirdweb.com/api/jwks`); wallet address extracted from the `sub` claim. Dev bypass via `THIRDWEB_AUTH_DEV_MODE=true`.

Both session types share the same `Authorization: Session <token>` header format. `authentication.js` tries SIWE first, then Thirdweb JWT. 24-hour TTL.

### 2.4 What Works

- ✅ Mock generation with session auth + rate limiting (returns raw bytes, browser handles IPFS)
- ✅ Rate limiting (10/hour per wallet, 429 + `Retry-After`; 1000/hr in mock mode)
- ✅ Thumbnail capture + direct IPFS upload from browser
- ✅ Manifest save/publish entirely client-side
- ✅ Collection manifest merge + direct IPFS upload from browser
- ✅ IPFS unpin on burn
- ✅ Multi-network config (Hardhat `31415822`, MegaETH `6343`, Monad `10143`)
- ✅ Multi-storage backend (`kubo` local, `pinata` testnet)
- ✅ Presigned upload URLs for browser uploads
- ✅ Nostr comments archive snapshot on republish
- ✅ Standalone Library page (collections, uploads, grid/list, search/sort, context actions)
- ✅ Thirdweb JWT authentication (Google social login)
- ✅ Chunked token indexer with per-chain `LOG_CHUNK_SIZES` and force-refresh

### 2.5 What Does NOT Work / Is Missing

- ❌ **Cloud 3D adapters** — `generate-node.js` returns `501 NOT_IMPLEMENTED` when `MOCK_3D_GENERATION` is disabled.
- ❌ No backend parametric, manifest, thumbnail, history, or token routes — all handled client-side.
- ❌ `GET /api/health` — planned, not implemented.

---

## 3. Frontend (`frontend/src/`)

### 3.1 Actual File Layout

**JavaScript (48+ files)**

```
frontend/src/js/
├── engine/
│   ├── scene-graph.js          # Babylon engine, GLB/glTF load, selection, framing, thumbnails, collection load
│   ├── time-travel.js          # Manifest chain walk, apply version
│   ├── parametric-preview.js   # Inspector color/scale, live preview, timeline binding
│   ├── state.js                # Shared mutable state
│   ├── transforms.js           # CID extraction, format detection, bounds, centering
│   ├── cleanup.js              # Node/scene disposal
│   ├── placeholders.js         # Loading/error meshes
│   ├── studio-init.js          # Studio bootstrap
│   ├── theme.js / theme-init.js# CSS → Babylon color mapping
│   └── viewport-gizmo.js       # Corner orientation gizmo
├── ui/
│   ├── create-panel.js         # Chat-style prompt flow, PayGo, tier/provider dropdowns
│   ├── asset-save.js           # Save Draft / Publish UI; delegates building to services/asset-save/
│   ├── asset-library.js        # Token gallery (owned + shared), collection expansion, thumbnails, drag; inaccessible token cards with Burn action
│   ├── asset-drop-zone.js      # Viewport drag/drop overlay
│   ├── asset-history.js        # Draggable horizontal timeline scrubber
│   ├── collaborators-panel.js  # Team panel (add/remove editors, owner badge)
│   ├── comments-panel.js       # Asset-level comment thread UI
│   ├── ledger-panel.js         # Activity feed derived from manifest chain
│   ├── outliner.js             # Scene hierarchy tree, select, double-click dive
│   ├── nesting.js              # Breadcrumbs, dive/ascend, depth gating
│   ├── sidebar.js              # 5-view switcher (Settings/Chat/Outline/Gallery/Activity)
│   ├── library-grid.js         # Library grid/list rendering, selection, keyboard, rubber-band; minting/besked/wip status badges
│   ├── library-toolbar.js      # Breadcrumb, search, sort, view toggle, New Collection, Upload
│   ├── library-context-menu.js # Library right-click actions (Open, Rename, Burn, Delete, Send to Collection…)
│   ├── library-create.js       # Shared optimistic collection-create flow (both EOA + social)
│   ├── collaborators.js        # Burn button visibility helper
│   ├── dialog.js / toasts.js / wallet-modal.js / wallet-popover.js
│   └── ...
├── blockchain/
│   ├── wallet.js               # Backward-compat barrel; re-exports the split wallet modules
│   ├── wallet-core.js          # Web3 init, connect/disconnect, auto-connect, account state; 250ms polling
│   ├── wallet-network.js       # Network switching
│   ├── wallet-payments.js      # recordGeneration(), payForGenerationWithUSDC(), isFreeTierContract()
│   ├── wallet-publishing.js    # publishAsset(), updateAssetURI(), updateEditors(), burn(); smart-account gas optimisation
│   ├── wallet-guard.js         # Guards / helpers for publishing auth
│   ├── wallet-thirdweb.js      # Google OAuth → embedded EOA → ERC-4337 smart account; background pre-warm
│   ├── smart-wallet-support.js # SMART_WALLET_SUPPORTED_CHAIN_IDS (Monad Testnet only)
│   ├── token-resolver.js       # Resolve child_ref tokens to manifest CIDs
│   ├── uri-utils.js            # Normalize tokenURIs to plain CIDs
│   ├── siwe.js                 # EIP-4361 message builder
│   ├── wallet-discovery.js     # EIP-6963 multi-wallet
│   ├── wallet-connect.js       # WalletConnect v2
│   ├── network-config.js       # Per-network contract/USDC/RPC addresses (Hardhat/MegaETH/Monad)
│   ├── error-decoder.js        # Revert reason decoding
│   └── explorer.js             # Block explorer links
├── ipfs/
│   ├── remote-ipfs.js          # Gateway reads (cache currently disabled)
│   └── write-to-ipfs.js        # Direct Kubo/Pinata writes + pin
├── gltf/
│   ├── decomposer.js           # Break buffers/images into separate IPFS CIDs (web-worker backed)
│   ├── async-gltf.js           # Async decompose helpers
│   ├── composer.js             # Resolve ipfs:// URIs back to base64 for Babylon
│   ├── material-editor.js      # PBR material color edits, multi-primitive aware, bake to composite
│   ├── merkle-editors.js       # Merkle tree/proof library for editor authorization
│   ├── source-color-editor.js  # Per-mesh color editor integration
│   └── glb-parser.js           # Binary glTF container parsing
├── state/
│   ├── asset-state.js / wallet-state.js / ui-state.js / library-state.js
│   ├── comment-thread.js       # Nostr WebSocket + archive comment thread
│   └── create-store.js         # Generic createStore factory
└── services/
    ├── api.js                  # API client: sessions (SIWE + Thirdweb), generate, comments archive, unpin, upload-url
    ├── asset-save/             # manifest-builder.js, collection-publish.js, editor-publish.js
    ├── library-ops.js          # Create named collection (with onPending hook), upload glTF/GLB
    ├── team.js / asset-delete.js / url-utils.js
    └── ...
```

### 3.2 Core Systems — Verified in Code

**Social Login (Thirdweb Account Abstraction)**
- Google OAuth → Thirdweb embedded EOA → ERC-4337 smart account on Monad Testnet.
- Provider exposed as an EIP-1193 shim so all existing Web3.js code is unchanged.
- BigInt → hex normalisation layer handles Thirdweb's internal RPC responses.
- Gas is sponsored by the Thirdweb paymaster (`sponsorGas: true`); low-balance toast is suppressed for smart accounts.
- Smart account pre-warms in the background at login (deploys ERC-4337 account during idle time so the user's first tx skips account-creation overhead).
- Auth: Thirdweb JWT verified server-side against JWKS; same session token format as SIWE.
- **Chain constraint:** Smart wallets only work on Monad Testnet. EOA wallets (MetaMask/Rabby) work on all three chains.

**Token Indexer (`src/api/token-indexer.js`)**
- Chunked `eth_getLogs` backfill scans for `Transfer` and editor-change events per chain.
- Per-chain chunk sizes in `constants/chains.js`: Hardhat=10000, MegaETH=5000, Monad=100 (Monad testnet rejects wide ranges with 413).
- `force=true` query param bypasses cache for on-demand refresh.
- MegaETH deployment block pinned at `22359678` to avoid scanning from genesis.

**Optimistic Collection Create UI (`ui/library-create.js`)**
- Shared `createCollectionFlow()` used by both toolbar button and right-click context menu.
- Card appears with a spinner badge immediately after the manifest write (before the mint tx); `onPending` hook in `createNamedCollection` fires the callback at that moment.
- On success: card flips to checkmark (`besked`) instantly; `ASSET_PUBLISHED` also triggers a background refresh that promotes it.
- On failure/wallet-reject: optimistic card is removed automatically (toast). Works identically for EOA (card shows just before the wallet popup; rejecting removes it) and social login.

**Performance (smart-account publish path)**
- `_resolveGas()` in `wallet-publishing.js` skips `eth_estimateGas` entirely for thirdweb accounts (bundler re-estimates, paymaster sponsors) — saves one RPC round trip on every publish/updateURI/updateEditors/burn.
- `ownerOf` + `tokenURI` pre-mint existence check now runs via `Promise.all` (parallel).
- `newWeb3()` sets `transactionPollingInterval = 250ms` (down from 1000ms default) across all 7 Web3 instance sites.
- Background smart-account pre-warm via no-op sponsored UserOperation at connect time.

**Inaccessible Token Cards**
- Studio gallery (`asset-library.js`) and library page now show tokens the user owns on-chain but can't read (e.g. wrong network, IPFS unavailable) as card skeletons with a **Burn** action, rather than silently dropping them.

**3D Engine, Parametric, glTF Pipeline, Comments, Library** — unchanged from previous status; all fully implemented. See sections 3.2/3.3 of the 2026-06-28 snapshot for detail.

### 3.3 What Does NOT Work / Is Missing

- ❌ **IPFS browser cache hardcoded disabled** — every read hits the gateway directly.
- ❌ `anchorManifest()` stubbed in `ledger-panel.js` — "not available in current contract".
- ❌ Social login (smart accounts) only supported on Monad Testnet — not on MegaETH Testnet.
- ❌ No OpenSCAD WASM integration (explicitly deferred post-MVP).

---

## 4. Smart Contracts (`blockchain/`)

### 4.1 Deployment Artifacts

| Network | Contract | Address | Notes |
|---------|----------|---------|-------|
| `hardhat` / `localhost` (chain 31415822) | ArbeskAssetFree | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Local container, MockUSDC |
| `hardhat` / `localhost` (chain 31415822) | ArbeskAsset (paid) | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | Local container, MockUSDC |
| `megaethTestnet` (chain 6343) | ArbeskAssetFree | `0x3Fc0f8CBe88D8aB0918EAe5457dd6E5dD9A23673` | **Current testnet target (EOA)** |
| `megaethTestnet` (chain 6343) | ArbeskAsset (paid) | — | **Not deployed on testnet** |
| `monadTestnet` (chain 10143) | ArbeskAssetFree | `0xFdf0DC8c7Fd363de8522cDE9628688A87F2Fd73B` | **Social-login (smart account) target**, block 41167307 |
| `monadTestnet` (chain 10143) | ArbeskAsset (paid) | — | Not deployed |

### 4.2 Known Contract Issues

| Issue | Severity |
|-------|----------|
| `verify.js` passes `[treasury]` as sole constructor arg but constructor is `(address _treasury, address _usdcToken)` — Etherscan verification will fail | High |
| No reentrancy attack tests | Low |

---

## 5. Tests

| Suite | Count | Status |
|-------|-------|--------|
| Jest unit (all) | 1011 | ✅ All passing |
| E2E Playwright specs | 17 specs / 35 tests | ✅ Chromium (manual run against local stack) |
| Merged coverage (Jest + E2E) | 122 files | 74.23% statements, 74.06% branches, 69.38% functions |

**New test files since 2026-06-28:**
- `test/api/sessions.test.js` — both SIWE and Thirdweb JWT session creation
- `test/api/thirdweb-auth.test.js` — JWT verification, JWKS mock, dev-mode bypass
- `test/api/siwe-verify.test.js` — EIP-4361 validation edge cases
- `test/api/validation.test.js` — Zod schema coverage for new routes
- `test/frontend/api.test.js` — frontend API service (session auth with Thirdweb)
- `test/frontend/asset-library.test.js` — inaccessible token card rendering
- `test/frontend/library-init.test.js` — token indexer integration, optimistic grace window
- `test/frontend/library-ops.test.js` — `onPending` hook, `createNamedCollection` options

### Test Gaps

- ❌ No reentrancy attack tests.
- ❌ No fuzzing / property-based tests.
- ❌ E2E does not cover the social-login Google OAuth path (can't automate OAuth popups).

---

## 6. Beta Readiness Assessment

### What is working end-to-end right now

| Capability | EOA (MetaMask/Rabby) | Social (Google) |
|------------|---------------------|-----------------|
| Wallet connect | ✅ MegaETH + Monad + Hardhat | ✅ Monad Testnet only |
| Auto-reconnect on page load | ✅ | ✅ |
| Session auth (no per-tx popups) | ✅ SIWE | ✅ Thirdweb JWT |
| Mock asset generation | ✅ | ✅ |
| Save draft + publish (mint NFT) | ✅ | ✅ (gas sponsored) |
| Republish / update URI | ✅ | ✅ |
| Parametric color/scale edit | ✅ | ✅ |
| Time-travel version slider | ✅ | ✅ |
| Nested child world composition | ✅ | ✅ |
| Collection create (optimistic) | ✅ instant card, auto-rollback | ✅ instant card, sponsored |
| Upload GLB/glTF to collection | ✅ | ✅ |
| Library page (grid/list/search) | ✅ | ✅ |
| Asset-level Nostr comments | ✅ | ✅ |
| Merkle editor collaboration | ✅ | ✅ |
| Token burn | ✅ | ✅ |
| Real 3D generation | ❌ 501 | ❌ 501 |

### Beta blockers

| Blocker | Impact | Notes |
|---------|--------|-------|
| **No real 3D generation** | Critical for core feature | Mock adapter works; cloud adapter returns 501. MVP feature gap. |
| **Social login locked to Monad Testnet** | Medium — limits social users | Thirdweb bundler support is chain-specific; MegaETH not yet supported by the ERC-4337 bundler. |
| **ArbeskAsset (paid tier) not deployed on any testnet** | Low for beta | Free tier is fully deployed on both testnets. |
| **`verify.js` bug** | Low for beta | Affects Etherscan verification only, not runtime. |
| **IPFS cache disabled** | Low — UX degradation | Every read hits the gateway; slow on IPFS cold reads but not a blocker. |

### Verdict

**Ready for closed beta on the collaboration and publishing workflow.** The full round-trip (connect → generate mock → parametric edit → publish NFT → collaborate → comment → library management) works on both EOA and social-login wallets, with gas sponsorship for social users. 1011 unit tests green, 17 E2E specs cover the critical path.

**Not ready for open beta** until real 3D generation is wired (501 is the first thing a new user hits). Everything else is beta-quality.

---

## 7. Known Gaps & TODOs

| Gap | Where | Priority |
|-----|-------|----------|
| Cloud 3D generation adapter | `src/api/assets/generate-node.js` | 🔴 Critical for MVP |
| Social login on MegaETH | `smart-wallet-support.js` | 🟡 Waiting on Thirdweb bundler support |
| Micro-ledger (`anchorManifest`) | `ledger-panel.js` | 🟡 Post-beta |
| `verify.js` constructor args fix | `blockchain/scripts/verify.js` | 🟡 Before mainnet |
| IPFS browser cache re-enable | `remote-ipfs.js` | 🟢 Performance improvement |
| Health check endpoint | — | 🟢 Ops convenience |
| OpenSCAD WASM | — | ⚪ Explicitly deferred |

---

## 8. Infrastructure & Environment

### Ports

| Service | API | Gateway / RPC | Notes |
|---------|-----|---------------|-------|
| Private IPFS (Kubo) | `127.0.0.1:5001` | `127.0.0.1:8080` | No DHT, loopback-only |
| Hardhat local EVM | — | `127.0.0.1:8545` | Docker container |
| Local Nostr relay | — | `ws://127.0.0.1:7777` | Dev-only |
| MegaETH Testnet | — | `https://carrot.megaeth.com/rpc` | EOA wallets |
| Monad Testnet | — | `https://testnet-rpc.monad.xyz/` | Social-login smart accounts |

### Environment Files

| File | Status |
|------|--------|
| Root `.env` | ✅ Exists |
| `blockchain/.env` | ✅ Exists |
| `frontend/.env` | ❌ Not present (optional, not currently used) |
