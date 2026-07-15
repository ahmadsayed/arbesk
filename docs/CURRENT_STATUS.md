# Arbesk — Current Implementation Status

> **Generated:** 2026-07-15
> **Source of truth:** The codebase (backend, frontend, contracts, tests, build scripts). Architecture docs and API specs are reference only.
> **Contract:** `ArbeskAssetFree` is the default/free tier; `ArbeskAsset` is the paid tier (not `ArbeskWorld` — that name only exists in older docs).
> **Frontend build:** Custom Node.js scripts (no bundler).
> **Network targets:** Hardhat local for development; Base Sepolia Testnet (chain ID 84532) for EOA wallets and CDP email-login smart accounts.

---

## 1. Phase Completion Snapshot

| Phase | Status | Evidence in Code |
|-------|--------|------------------|
| Phase 1: Data Bridge, Mock Adapters & Private IPFS | ✅ Complete | `src/api/assets/generate-node.js`, `src/api/adapters/mock-adapter.js`, `docker-compose.yml`, `src/api/storage/` |
| Phase 2: Parametric Versions & Babylon.js Rendering | ✅ Complete | `frontend/src/js/engine/parametric-preview.js`, `frontend/src/js/engine/time-travel.js` |
| Phase 3: PayGo Smart Contract & On-Chain Integration | ✅ Complete | `blockchain/contracts/ArbeskAsset.sol`, `frontend/src/js/blockchain/wallet.js` |
| Phase 4: UI Assembly & Consolidated Workspace Studio | ✅ Complete | `frontend/src/pug/app.pug` (unified Studio + Library SPA), 29 SCSS partials, sidebar/outliner/nesting |
| Phase 4.1: Publishing Polish & Runtime Cache | ✅ Complete | Thumbnail capture in `scene-graph.js`, browser-side thumbnail upload to IPFS, unpin lifecycle |
| Phase 5.1: Token ID-Based Child Worlds | ✅ Complete | `child_ref` resolution in `token-resolver.js`, depth/cycle protection in `scene-graph.js` |
| Phase 5.2: Free Tier Contract | ✅ Complete | `ArbeskAssetFree.sol` deployed as default, `ArbeskAsset.sol` kept as paid tier |
| Phase 5.3: Merkle Editor Proofs | ✅ Complete | `editorRoot`/`editorSetVersion` in `ArbeskAssetBase.sol`, `frontend/src/js/gltf/merkle-editors.js`, `frontend/src/js/services/team.js` |
| Phase 5.4: Collection Manifests | ✅ Complete | Collection merge in `services/asset-save/manifest-builder.js`, collection expansion in `asset-library.js`, collection loading in `scene-graph.js` |
| Asset-Level Nostr Comments | ✅ Complete | `state/comment-thread.js`, `ui/comments-panel.js`, `src/api/chat-proxy.js`, `src/api/comments-archive.js`, E2E specs 14 + 15 |
| Unified Studio + Library SPA | ✅ Complete | `app.pug`, `app/router.js`, `library-init.js`, `library-controller.js`, `library-grid.js`, `library-toolbar.js`, `library-context-menu.js`, `services/library-ops.js`, E2E specs 09–12 |
| CDP Email Login (OTP + ERC-4337 smart accounts) | ✅ Complete | `wallet-cdp.js`, SIWE with `eoaAddress` fallback in `siwe-verify.js`, ERC-4337 smart accounts on Base Sepolia, gas sponsored by CDP Paymaster |
| Base Sepolia Testnet Support | ✅ Complete | `constants/chains.js`, `network-config.js`, deployed `ArbeskAssetFree` on Base Sepolia |
| Token Indexer (chunked backfill) | ✅ Complete | `src/api/token-indexer.js`, `src/api/routes/indexer.js`, per-chain `LOG_CHUNK_SIZES` |
| Optimistic Collection Create UI | ✅ Complete | `ui/library-create.js`, `minting` status + spinner badge, flips to `besked` directly, auto-rollback on cancel |
| Phase 5: Micro-Ledger | ❌ Not implemented / client-side only | `ledger-panel.js` derives activity from manifest chain; `anchorManifest()` is stubbed |

---

## 2. Backend (`src/`)

### 2.1 Actual File Layout

```
src/
├── index.js                    # Express bootstrap, CSP, request logging
├── config.js                   # Multi-network Web3 config (Hardhat local, Base Sepolia Testnet)
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
    ├── authentication.js       # Session token validation middleware (SIWE)
    ├── authorization.js        # On-chain asset access checks for chat proxy
    ├── chat-proxy.js           # WebSocket bridge: browser ↔ Nostr relay (session-gated, rate-limited)
    ├── comments-archive.js     # Asset-level Nostr comment thread → IPFS archive; returns empty archive if relay is unreachable
    ├── errors.js               # Standardized error response helper
    ├── ipfs-utils.js           # catManifest() with timeout/abort
    ├── manifest-utils.js       # getSceneNodes, bumpManifestVersion
    ├── nostr-relay.js          # Shared relay primitives (used by chat-proxy + comments-archive)
    ├── rate-limiter.js         # In-memory per-wallet rate limiter
    ├── token-indexer.js        # Chunked eth_getLogs backfill for owned + editor-shared token discovery
    ├── routes/                 # Per-domain route modules
    │   ├── comments.js         # POST /assets/snapshot-comments
    │   ├── contracts.js        # GET /contracts/:name/abi
    │   ├── indexer.js          # GET /indexer/owned + /indexer/shared — token ownership & editor-shared lookup
    │   ├── ipfs.js             # POST /ipfs/upload-url + /ipfs/unpin
    │   ├── openapi.js          # GET /openapi.json + /docs
    │   ├── paymaster.js        # POST /paymaster — CDP Paymaster JSON-RPC proxy
    │   └── test-utils.js       # Test-only reset helpers
    ├── sessions.js             # SIWE session create/delete (24h TTL)
    ├── siwe-verify.js          # EIP-4361 message verification
    └── openapi.json            # Static OpenAPI spec
```

### 2.2 Implemented Routes (`/api/v1`)

| Method | Path | Auth | What it does |
|--------|------|------|--------------|
| GET | `/config` | None | Returns contract address, network configs, IPFS backend/gateway, mock flag, cdpProjectId |
| POST | `/sessions` | None | Creates SIWE session (EIP-4361); `eoaAddress` body field enables CDP smart-account fallback |
| POST | `/paymaster` | None | CDP Paymaster JSON-RPC proxy — forwards sponsorship requests, keeps `CDP_PAYMASTER_URL` secret |
| DELETE | `/sessions` | Session | Invalidates session token |
| POST | `/generations` | Session | Validates session + rate limit, calls mock adapter, returns raw bytes |
| POST | `/assets/snapshot-comments` | Session | Snapshots asset-level Nostr comment thread to IPFS archive; requires `assetId`; returns empty archive if the relay is unreachable |
| POST | `/ipfs/upload-url` | Session | Mints a short-lived presigned upload credential (Pinata/Kubo) |
| POST | `/ipfs/unpin` | Session | Walks up to 100 manifests, collects all CIDs, unpins them |
| GET | `/contracts/:name/abi` | None | Serves compiled ABI JSON from `blockchain/artifacts/` |
| GET | `/indexer/owned` | None | Returns owned token IDs for an address+chainId via chunked eth_getLogs backfill; supports `force=true` to bypass cache |
| GET | `/indexer/shared` | None | Returns token IDs where the address is a Merkle editor but not the owner; indexer scans `EditorSetChanged` events and fetches editor lists from IPFS |
| GET | `/openapi.json` | None | Static OpenAPI spec |
| GET | `/docs` | None | Swagger UI HTML bundle |
| WS | `/v1/chat/ws` | Session (query) | WebSocket bridge to Nostr relay for live comments, rate-limited (10 msg/min) |

### 2.3 Auth Details

**Single session type — SIWE for all wallet kinds:**

- **EOA wallets** (MetaMask/Rabby/WalletConnect): standard EIP-4361, domain-bound, 5-minute message age, nonce replay protection.
- **CDP email-login smart accounts**: the embedded EOA signer signs the SIWE message; the SIWE `address` field contains the smart account address; `eoaAddress` in the POST body provides the actual signer for fallback verification in `siwe-verify.js`.

Sessions are identified by `Authorization: Session <token>` header. 24-hour TTL. `authentication.js` validates the SIWE-issued token for all request types.

### 2.4 What Works

- ✅ Mock generation with session auth + rate limiting (returns raw bytes, browser handles IPFS)
- ✅ Rate limiting (10/hour per wallet, 429 + `Retry-After`; 1000/hr in mock mode)
- ✅ Thumbnail capture + direct IPFS upload from browser
- ✅ Manifest save/publish entirely client-side
- ✅ Collection manifest merge + direct IPFS upload from browser
- ✅ IPFS unpin on burn
- ✅ Multi-network config (Hardhat `31415822`, Base Sepolia `84532`)
- ✅ Multi-storage backend (`kubo` local, `pinata` testnet)
- ✅ Presigned upload URLs for browser uploads
- ✅ Nostr comments archive snapshot on republish (resilient: empty archive returned if relay is unreachable)
- ✅ Unified Studio + Library SPA (collections, uploads, grid/list, search/sort, context actions)
- ✅ CDP email-login (OTP → embedded EOA → ERC-4337 smart account on Base Sepolia)
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
├── app/
│   └── router.js               # Unified SPA view router: Studio ⇄ Library
├── ui/
│   ├── create-panel.js         # Chat-style prompt flow, PayGo, tier/provider dropdowns
│   ├── asset-save.js           # Save Draft / Publish UI; delegates building to services/asset-save/
│   ├── asset-library.js        # Token gallery (owned + shared), collection expansion, thumbnails, drag; inaccessible token cards with Burn action
│   ├── asset-drop-zone.js      # Viewport drag/drop overlay
│   ├── scene-clock.js / model-clock-gizmo.js / version-clock.js  # Viewport version clock gizmos (scene + selected-node 3D ring)
│   ├── collaborators-panel.js  # Team panel (add/remove editors, owner badge)
│   ├── comments-panel.js       # Asset-level comment thread UI
│   ├── ledger-panel.js         # Activity feed derived from manifest chain
│   ├── outliner.js             # Scene hierarchy tree, select, double-click dive
│   ├── nesting.js              # Breadcrumbs, dive/ascend, depth gating
│   ├── sidebar.js              # 5-view switcher (Settings/Chat/Outline/Gallery/Activity)
│   ├── library-controller.js   # Library view orchestration, data loading, and Studio handoff
│   ├── library-grid.js         # Library grid/list rendering, selection, keyboard, rubber-band; minting/besked/wip status badges
│   ├── library-toolbar.js      # Breadcrumb, search, sort, view toggle, New Collection, Upload
│   ├── library-context-menu.js # Library right-click actions (Open, Rename, Burn, Delete, Send to Collection…)
│   ├── library-create.js       # Shared optimistic collection-create flow (both EOA + social)
│   ├── collaborators.js        # Burn button visibility helper
│   ├── dialog.js / toasts.js / wallet-modal.js / wallet-popover.js
│   └── ...
├── blockchain/
│   ├── wallet.js               # Backward-compat barrel; re-exports the split wallet modules
│   ├── wallet-core.js          # Web3 init, connect/disconnect, full auto-restore (CDP/EOA/WalletConnect), account state; 250ms polling
│   ├── wallet-network.js       # Network switching
│   ├── wallet-payments.js      # recordGeneration(), payForGenerationWithUSDC(), isFreeTierContract()
│   ├── wallet-publishing.js    # publishAsset(), updateAssetURI(), updateEditors(), burn(); smart-account gas optimisation
│   ├── wallet-guard.js         # Guards / helpers for publishing auth
│   ├── wallet-cdp.js           # CDP email OTP → embedded EOA → ERC-4337 smart account; EIP-1193 shim
│   ├── smart-wallet-support.js # SMART_WALLET_SUPPORTED_CHAIN_IDS (Base Sepolia only)
│   ├── token-resolver.js       # Resolve child_ref tokens to manifest CIDs
│   ├── uri-utils.js            # Normalize tokenURIs to plain CIDs
│   ├── siwe.js                 # EIP-4361 message builder
│   ├── wallet-discovery.js     # EIP-6963 multi-wallet
│   ├── wallet-connect.js       # WalletConnect v2
│   ├── network-config.js       # Per-network contract/USDC/RPC addresses (Hardhat/Base Sepolia)
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
    ├── api.js                  # API client: sessions (SIWE), generate, comments archive, unpin, upload-url, paymaster
    ├── asset-save/             # manifest-builder.js, collection-publish.js, editor-publish.js
    ├── library-ops.js          # Create named collection (with onPending hook), upload glTF/GLB
    ├── team.js / asset-delete.js / url-utils.js
    └── ...
```

### 3.2 Core Systems — Verified in Code

**CDP Email Login (Account Abstraction)**
- Email OTP → CDP Embedded Wallet (`@coinbase/cdp-core`) → ERC-4337 smart account on Base Sepolia.
- Provider exposed as an EIP-1193 shim (`wallet-cdp.js`) so all existing Web3.js code is unchanged.
- Gas is sponsored by the CDP Paymaster (`useCdpPaymaster: true`); low-balance toast is suppressed for smart accounts.
- Auth: embedded EOA signs the SIWE message; `eoaAddress` in the POST body enables fallback verification in `siwe-verify.js`. Same SIWE session token format as EOA wallets.
- **Chain constraint:** Smart wallets only work on Base Sepolia (`SMART_WALLET_SUPPORTED_CHAIN_IDS`). EOA wallets (MetaMask/Rabby) work on all supported chains.
- **Verified end-to-end 2026-07-01:** OTP sign-in → SIWE session → collection mint via sponsored UserOperation on Base Sepolia.
- **Implementation notes / gotchas fixed:**
  - `signEvmMessage` expects the EOA **address string**, not the account object.
  - `eth_sendTransaction` returns a UserOperation hash; the provider polls `getUserOperation()` until the on-chain `transactionHash` is available, then returns the real EVM txHash to Web3.js.
  - `sepolia.base.org` blocks browser-origin RPC requests; use `https://base-sepolia-rpc.publicnode.com` for RPC passthrough.
  - CDP rejects relative `paymasterUrl`; local dev uses `useCdpPaymaster: true`. The backend proxy at `/api/v1/paymaster` is reserved for production deployments with a public HTTPS custom paymaster.

**Token Indexer (`src/api/token-indexer.js`)**
- Chunked `eth_getLogs` backfill scans for `Transfer` events (ownership) and `EditorSetChanged` events (editor-shared tokens) per chain.
- Editor list CIDs are read from chain (`editorListURI`) and resolved from IPFS to build a reverse index of editor address → token IDs.
- Per-chain chunk sizes in `constants/chains.js`: Hardhat=10000, Base Sepolia=2000.
- `force=true` query param bypasses cache for on-demand refresh.
- Base Sepolia deployment block pinned in `constants/chains.js` to avoid scanning from genesis.
- Exposes `GET /api/v1/indexer/owned` and `GET /api/v1/indexer/shared`.

**Optimistic Collection Create UI (`ui/library-create.js`)**
- Shared `createCollectionFlow()` used by both toolbar button and right-click context menu.
- Card appears with a spinner badge immediately after the manifest write (before the mint tx); `onPending` hook in `createNamedCollection` fires the callback at that moment.
- On success: card flips to checkmark (`besked`) instantly and stays in place. `library-init.js` no longer subscribes to `ASSET_PUBLISHED`, so there is no full background refresh.
- On failure/wallet-reject: optimistic card is removed automatically (toast). Works identically for EOA (card shows just before the wallet popup; rejecting removes it) and CDP email login.

**Library Burn Action (`ui/library-context-menu.js`)**
- `requestBurnCollection()` removes the collection from local state directly after a successful on-chain burn; no full page refresh is triggered.

**Performance (smart-account publish path)**
- `_resolveGas()` in `wallet-publishing.js` skips `eth_estimateGas` entirely for CDP smart accounts (bundler re-estimates, paymaster sponsors) — saves one RPC round trip on every publish/updateURI/updateEditors/burn.
- `ownerOf` + `tokenURI` pre-mint existence check now runs via `Promise.all` (parallel).
- `newWeb3()` sets `transactionPollingInterval = 250ms` (down from 1000ms default) across all 7 Web3 instance sites.
- Background smart-account pre-warm via no-op sponsored UserOperation at connect time.

**Inaccessible Token Cards**
- Studio gallery (`asset-library.js`) and library page now show tokens the user owns on-chain but can't read (e.g. wrong network, IPFS unavailable) as card skeletons with a **Burn** action, rather than silently dropping them.

**3D Engine, Parametric, glTF Pipeline, Comments, Library** — unchanged from previous status; all fully implemented. See sections 3.2/3.3 of the 2026-06-28 snapshot for detail.

### 3.3 What Does NOT Work / Is Missing

- ❌ **IPFS browser cache hardcoded disabled** — every read hits the gateway directly.
- ❌ `anchorManifest()` stubbed in `ledger-panel.js` — "not available in current contract".
- ❌ CDP email login (smart accounts) only supported on Base Sepolia — not on Hardhat local.
- ❌ No OpenSCAD WASM integration (explicitly deferred post-MVP).

---

## 4. Smart Contracts (`blockchain/`)

### 4.1 Deployment Artifacts

| Network | Contract | Address | Notes |
|---------|----------|---------|-------|
| `hardhat` / `localhost` (chain 31415822) | ArbeskAssetFree | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Local container, MockUSDC |
| `hardhat` / `localhost` (chain 31415822) | ArbeskAsset (paid) | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | Local container, MockUSDC |
| `baseSepolia` (chain 84532) | ArbeskAssetFree | *(deploy address in `blockchain/.env`)* | **Current testnet target (EOA + CDP email login)** |
| `baseSepolia` (chain 84532) | ArbeskAsset (paid) | — | Not deployed on testnet |

### 4.2 Known Contract Issues

| Issue | Severity |
|-------|----------|
| `verify.js` passes `[treasury]` as sole constructor arg but constructor is `(address _treasury, address _usdcToken)` — Etherscan verification will fail | High |
| No reentrancy attack tests | Low |

---

## 5. Tests

| Suite | Count | Status |
|-------|-------|--------|
| Jest unit (all) | 1162 | ✅ All passing |
| E2E Playwright specs | 16 specs / 33 tests | ✅ Chromium (manual run against local stack) |
| Merged coverage (Jest + E2E) | 122 files | 74.23% statements, 74.06% branches, 69.38% functions |

**New test files since 2026-06-28:**
- `test/api/sessions.test.js` — SIWE session creation, including `eoaAddress` fallback for CDP smart accounts
- `test/api/siwe-verify.test.js` — EIP-4361 validation edge cases and `eoaAddress` fallback
- `test/api/validation.test.js` — Zod schema coverage for new routes
- `test/frontend/api.test.js` — frontend API service (session auth and CDP config)
- `test/frontend/asset-library.test.js` — inaccessible token card rendering
- `test/frontend/library-init.test.js` — token indexer integration, optimistic grace window
- `test/frontend/library-ops.test.js` — `onPending` hook, `createNamedCollection` options
- `test/token-indexer-shared.test.js` — editor-shared token indexing from `EditorSetChanged` events
- `test/api/indexer-shared.test.js` — `GET /indexer/shared` route validation and response shape

### Test Gaps

- ❌ No reentrancy attack tests.
- ❌ No fuzzing / property-based tests.
- ❌ E2E does not cover the CDP email-login path (requires real email / OTP; mock bypass not implemented).

---

## 6. Beta Readiness Assessment

### What is working end-to-end right now

| Capability | EOA (MetaMask/Rabby) | CDP Email Login |
|------------|---------------------|-----------------|
| Wallet connect | ✅ Base Sepolia + Hardhat | ✅ Base Sepolia only |
| Auto-reconnect on page load | ✅ | ✅ |
| Session auth (no per-tx popups) | ✅ SIWE | ✅ SIWE (embedded EOA signs for smart account) |
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
| **CDP email login limited to Base Sepolia** | Medium — limits non-EOA users | CDP smart-wallet support is intentionally Base Sepolia only in this branch. |
| **ArbeskAsset (paid tier) not deployed on any testnet** | Low for beta | Free tier is fully deployed on both testnets. |
| **`verify.js` bug** | Low for beta | Affects Etherscan verification only, not runtime. |
| **IPFS cache disabled** | Low — UX degradation | Every read hits the gateway; slow on IPFS cold reads but not a blocker. |

### Verdict

**Ready for closed beta on the collaboration and publishing workflow.** The full round-trip (connect → generate mock → parametric edit → publish NFT → collaborate → comment → library management) works on both EOA and CDP email-login wallets, with gas sponsorship for CDP smart-account users. 1162 unit tests green, 16 E2E specs cover the critical path.

**Not ready for open beta** until real 3D generation is wired (501 is the first thing a new user hits). Everything else is beta-quality.

---

## 7. Known Gaps & TODOs

| Gap | Where | Priority |
|-----|-------|----------|
| Cloud 3D generation adapter | `src/api/assets/generate-node.js` | 🔴 Critical for MVP |
| CDP email login on Hardhat | `smart-wallet-support.js` | 🟡 Smart wallets only supported on Base Sepolia |
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
| Base Sepolia Testnet | — | `https://sepolia.base.org` (backend direct); `https://base-sepolia-rpc.publicnode.com` (CDP smart-wallet browser passthrough) | EOA + CDP email-login smart accounts |

### Environment Files

| File | Status |
|------|--------|
| Root `.env` | ✅ Exists |
| `blockchain/.env` | ✅ Exists |
| `frontend/.env` | ❌ Not present (optional, not currently used) |
