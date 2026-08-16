# Arbesk — Current Implementation Status

> **Generated:** 2026-08-03
> **Source of truth:** The codebase (backend, frontend, contracts, tests, build scripts). Architecture docs and API specs are reference only.
> **Contract:** `ArbeskAssetFree` is the default/free tier; `ArbeskAsset` is the paid tier (not `ArbeskWorld` — that name only exists in older docs).
> **Frontend build:** Custom Node.js scripts (no bundler).
> **Network targets:** Hardhat local for development; Base Sepolia Testnet (chain ID 84532) for EOA wallets and CDP email-login smart accounts.

---

## 1. Phase Completion Snapshot

| Phase | Status | Evidence in Code |
|-------|--------|------------------|
| Phase 1: Data Bridge, Mock Adapters & Private IPFS | ✅ Complete | `src/api/assets/generate-node.ts`, `src/api/adapters/mock-adapter.ts`, `docker-compose.yml`, `src/api/storage/` |
| Phase 2: Parametric Versions & Babylon.js Rendering | ✅ Complete | `frontend/src/js/engine/parametric-preview.ts`, `frontend/src/js/engine/time-travel.ts` |
| Phase 3: PayGo Smart Contract & On-Chain Integration | ✅ Complete | `blockchain/contracts/ArbeskAsset.sol`, `frontend/src/js/blockchain/wallet.ts` |
| Phase 4: UI Assembly & Consolidated Workspace Studio | ✅ Complete | `frontend/src/pug/app.pug` (unified Studio + Library SPA), 29 SCSS partials, sidebar/outliner/nesting |
| Phase 4.1: Publishing Polish & Runtime Cache | ✅ Complete | Thumbnail capture in `scene-graph.ts`, browser-side thumbnail upload to IPFS, unpin lifecycle |
| Phase 5.1: Token ID-Based Child Assets | ✅ Complete | `child_ref` resolution in `token-resolver.ts`, depth/cycle protection in `scene-graph.ts` |
| Phase 5.2: Free Tier Contract | ✅ Complete | `ArbeskAssetFree.sol` deployed as default, `ArbeskAsset.sol` kept as paid tier |
| Phase 5.3: Merkle Editor Proofs | ✅ Complete | `editorRoot`/`editorSetVersion` in `ArbeskAssetBase.sol`, `frontend/src/js/gltf/merkle-editors.ts`, `frontend/src/js/services/team.ts` |
| Phase 5.4: Collection Manifests | ✅ Complete | Collection merge in `services/asset-save/manifest-builder.ts`, collection expansion in `asset-library.ts`, collection loading in `scene-graph.ts` |
| Asset-Level Nostr Comments | ✅ Complete | `services/comment-thread.ts`, `ui/comments-panel.ts`, `src/api/chat-proxy.ts`, `src/api/comments-archive.ts`, E2E specs 14 + 15 |
| Unified Studio + Library SPA | ✅ Complete | `app.pug`, `app/router.ts`, `app-init.ts`, `library-controller.ts`, `library-grid.ts`, `library-toolbar.ts`, `library-context-menu.ts`, `services/library-ops.ts`, E2E specs 09–12 |
| CDP Email Login (OTP + ERC-4337 smart accounts) | ✅ Complete | `wallet-cdp.ts`, SIWE with `eoaAddress` fallback in `siwe-verify.ts`, ERC-4337 smart accounts on Base Sepolia, gas sponsored by CDP Paymaster |
| Base Sepolia Testnet Support | ✅ Complete | `constants/chains.js`, `network-config.ts`, deployed `ArbeskAssetFree` on Base Sepolia |
| Token Indexer (chunked backfill) | ✅ Complete | `src/api/token-indexer.ts`, `src/api/routes/indexer.ts`, per-chain `LOG_CHUNK_SIZES` |
| Optimistic Collection Create UI | ✅ Complete | `ui/library-create.ts`, `minting` status + spinner badge, flips to `besked` directly, auto-rollback on cancel |
| Chat Provenance | ✅ Complete | AI prompts recorded per manifest version in `metadata.chat` (save-anchored, version-scoped) via `services/asset-save/manifest-builder.ts`; read-only prompt history in the Create panel; dormant `node.history` spec removed |
| Tripo3D v3 Generation Integration | ✅ Complete | `src/api/adapters/tripo3d-adapter.ts` (v3 REST, BYOK), `src/api/generation-tasks.ts` (wallet-bound task registry), `src/api/assets/generate-node.ts` (sourceAssetCid follow-ups: retexture/retopo/rig/animate), `frontend/src/js/ui/create-panel.ts` (provider select, BYOK dialog, version-card action rows), E2E selectors synced |
| Phase 5: Micro-Ledger | ❌ Not implemented / client-side only | `ledger-panel.ts` derives activity from manifest chain; `anchorManifest()` is stubbed |

---

## 2. Backend (`src/`)

### 2.1 Actual File Layout

```
src/
├── index.ts                    # Express bootstrap, CSP, request logging
├── config.ts                   # Multi-network Web3 config (Hardhat local, Base Sepolia Testnet)
└── api/
    ├── index.ts                # Main router — all v1 routes
    ├── assets/
    │   └── generate-node.ts    # 3D generation entrypoint (mock + Tripo3D task-based; sourceAssetCid retexture/retopo/rig/animate follow-ups)
    ├── generation-tasks.ts     # In-memory wallet-bound generation task registry (TTL, phase tracking)
    ├── adapters/
    │   ├── mock-adapter.ts     # Reads local .gltf files
    │   └── tripo3d-adapter.ts  # Tripo3D v3 REST adapter (BYOK, async task polling)
    ├── storage/
    │   ├── index.ts            # Storage backend factory (kubo/pinata)
    │   ├── kubo-adapter.ts     # Local Kubo add/cat/pin/directory/unpin
    │   └── pinata-adapter.ts   # Pinata v3 SDK + presigned upload URLs
    ├── abi-router.ts           # Serves compiled ABI from blockchain/artifacts/
    ├── authentication.ts       # Session token validation middleware (SIWE)
    ├── authorization.ts        # On-chain asset access checks for chat proxy
    ├── chat-proxy.ts           # WebSocket bridge: browser ↔ Nostr relay (session-gated, rate-limited)
    ├── comments-archive.ts     # Asset-level Nostr comment thread → IPFS archive; returns empty archive if relay is unreachable
    ├── errors.ts               # Standardized error response helper
    ├── ipfs-utils.ts           # catManifest() with timeout/abort
    ├── manifest-utils.ts       # getSceneNodes, bumpManifestVersion
    ├── nostr-relay.ts          # Shared relay primitives (used by chat-proxy + comments-archive)
    ├── rate-limiter.ts         # In-memory per-wallet rate limiter
    ├── token-indexer.ts        # Chunked eth_getLogs backfill for owned + editor-shared token discovery
    ├── routes/                 # Per-domain route modules
    │   ├── comments.ts         # POST /assets/snapshot-comments
    │   ├── contracts.ts        # GET /contracts/:name/abi
    │   ├── indexer.ts          # GET /indexer/owned + /indexer/shared — token ownership & editor-shared lookup
    │   ├── ipfs.ts             # POST /ipfs/upload-url + /ipfs/unpin
    │   ├── openapi.ts          # GET /openapi.json + /docs
    │   ├── paymaster.ts        # POST /paymaster — CDP Paymaster JSON-RPC proxy
    │   └── test-utils.ts       # Test-only reset helpers
    ├── sessions.ts             # SIWE session create/delete (24h TTL)
    ├── siwe-verify.ts          # EIP-4361 message verification
    └── openapi.json            # Static OpenAPI spec
```

### 2.2 Implemented Routes (`/api/v1`)

| Method | Path | Auth | What it does |
|--------|------|------|--------------|
| GET | `/config` | None | Returns contract address, network configs, IPFS backend/gateway, mock flag, cdpProjectId |
| POST | `/sessions` | None | Creates SIWE session (EIP-4361); `eoaAddress` body field enables CDP smart-account fallback |
| POST | `/paymaster` | None | CDP Paymaster JSON-RPC proxy — forwards sponsorship requests, keeps `CDP_PAYMASTER_URL` secret |
| POST | `/users/resolve-email` | Session | Resolves an exact full email to the CDP end user's smart account address (minimal `{exists, address?}` response, no listing/autocomplete); used by the Collaborators panel's Add-by-email flow |
| DELETE | `/sessions` | Session | Invalidates session token |
| POST | `/generations` | Session | Validates session + rate limit; mock returns raw bytes, `tripo3d` starts an async task |
| GET | `/generations/:taskId` | Session | Polls an async generation task (running / success / failed) |
| POST | `/generations/balance` | Session | Returns the Tripo3D credit balance for a BYOK key (transient use, no rate limit) |
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
- **CDP email-login smart accounts**: the embedded EOA signer signs the SIWE message; the SIWE `address` field contains the smart account address; `eoaAddress` in the POST body provides the actual signer for fallback verification in `siwe-verify.ts`.

Sessions are identified by `Authorization: Session <token>` header. 24-hour TTL. `authentication.ts` validates the SIWE-issued token for all request types.

### 2.4 What Works

- ✅ Mock generation with session auth + rate limiting (returns raw bytes, browser handles IPFS)
- ✅ Tripo3D BYOK generation (task-based, v3 API, default model `v3.1-20260211`) with `POST /generations` + `GET /generations/:taskId` polling; `auto_size` is passed so models arrive at estimated real-world meter scale; panel-level "Texture quality" selector (Tripo3D only, persisted in localStorage) sends `texture_quality: detailed`
- ✅ Version-card action row: every Tripo3D generation bubble carries a compact action row — `Retexture` (texture-prompt dialog) · `Retopo` (polygon-budget dialog) · `Auto-rig` (no dialog) · `Animate…` (preset dialog) — via `domain/generation-actions.ts`; actions run against the bubble's own GLB, so they never expire. Animated results are terminal (no actions); rig-only results keep only `Animate…`; mock provider gets none
- ✅ Tripo3D `sourceAssetCid` GLB follow-ups: the backend fetches the bubble's GLB from IPFS and uploads it to Tripo (`POST /files` → `file_token`) as the source for retexture (`models/texture`, flat `text_prompt`), retopo (`mesh/decimate`), and rig/animate. glTF JSON sources (composite `ipfs://` refs or embedded data URIs — gzipped storage is decompressed first, components honor `_arbesk.compressed`) are composed to GLB before upload via the shared gltf-core pipeline (`composeGltfJson` + `serializeGLB`); other formats (3MF, …) or glTF with unresolvable external refs → 400 `SOURCE_ASSET_UNSUPPORTED_FORMAT` (rig-check accepts GLB only — upstream code 1004). Unreadable or empty GLB → 400 `SOURCE_ASSET_UNAVAILABLE`; GLB over Tripo's 150 MB file limit → 400 `SOURCE_ASSET_TOO_LARGE`
- ✅ Typed-prompt retexture targets the "active version": a visible `Refining: <name> ×` indicator above the input, set on generation result, Show in Studio, and bubble/history restore; cleared by detach, Clear Chat, asset switch, or restoring a chat-less (e.g. parametric-edit) version
- ✅ Show in Studio auto-saves a draft (existing asset-save flow) and annotates the bubble "Saved" — publish stays a separate manual action. The button is the only way a bubble's model enters the Studio (the preview is orbit-only) and stays live after sending — re-clicking it restores that version; the manifest-chain tip is preserved across the restore so the auto-save chains linearly onto the prior tip (no fork)
- ✅ Tripo3D image-to-3D: attach a JPEG/PNG/WebP in the create panel (image attach button, Tripo3D provider only) → backend uploads via `POST /files` → image-to-model task; same polling flow, starts a fresh model. The reference image shows as an image bubble in chat and is pinned to IPFS with its CID recorded in the manifest node (`reference_image`)
- ✅ Tripo3D multiview-to-3D: attach up to 4 views of the same object (the attach input is multi-select; each chip gets a swappable Front/Left/Back/Right badge, auto-assigned in attach order with swap-on-conflict and front promotion on remove — pure logic in `ui/attach-views.ts`) → request field `images: [{imageData, imageMime, view}]` (2–4, unique views, exactly one front, mutually exclusive with `imageData`) → backend uploads each view → `generation/multiview-to-model` (`createMultiviewTask` in the adapter, view-key `inputs` in canonical front/left/back/right order). Chat shows a 2-column thumbnail grid bubble (`addImageMessage` `options.images`); the manifest node records `reference_images: [{cid, mime, name, view}]` plus `reference_image` = the front view for back-compat. One attached image keeps the single-image path byte-for-byte
- ✅ Tripo3D credit balance display: `POST /generations/balance` (BYOK key, session-gated) powers the "Tripo 3D credits" caption under the provider select + in the BYOK key dialog; refreshes on key change, wallet connect, and after each generation
- ✅ Model download: header download button in Studio (active asset) + per-card Download action in the Library; GLB downloads raw from IPFS, composite glTF is inlined (data URIs) first so the file is self-contained — no wallet/session needed (read-only)
- ✅ Tripo3D rig & animate: `Auto-rig` action chains rig-check → rig and stops (rigged GLB, Tripo-native skeleton — retarget rejects `spec: "mixamo"` rigs with code 1004, no baked animation); `Animate…` opens the preset dialog (max 5) then chains rig-check → rig → retarget (`animate` + `animations`/`rigOnly` on `POST /generations`). The picker is a curated, categorized set — Basics/Combat/Reactions/Emotes/Daily Life: the 11 generic v2.5 presets (short form) plus 16 from the v1.0 biped library (`preset:biped:*`, pass-through in the adapter; a known generic-rig task rejects them with a clear 400). Animating an already-rigged bubble takes the retarget-only path, skipping rig-check/rig, driven by the backend registry task id (`sourceTaskId`). Poll responses carry a `stage` label; `MODEL_NOT_RIGGABLE` when Tripo rejects the mesh. Rig endpoint uses its own model version (`TRIPO_3D_RIG_MODEL`, default `v2.5-20260210`). Tripo rig/retarget re-normalize model size (~×0.5 per stage), so follow-up manifests bake a compensating uniform `post_processor.scale` from source/result mesh bounds (`gltf/bounds.ts` + `followupScaleCompensation` in `services/api.ts`) — versions keep visual size through the chain
- ✅ Tripo3D smart retopology: `Retopo` action with polygon-budget dialog (500–20,000 triangles, default 20,000, blank = adaptive) → `POST /mesh/decimate` (model v2.0, clean triangulated topology + baked textures, GLB output, optional `faceLimit`); `quad` stays `false` on purpose — quad output forces FBX, which the frontend cannot load. The retopo result can itself enter the rig chain
- ✅ Generation task progress: GNOME infobar-style banner on the viewport top (`ui/task-progress.ts`) for Save/Besk and generation tasks, with stage hints, success fade, and error state
- ✅ Generation results land as chat bubbles with a live 3D preview; the Studio scene loads only on explicit "Show in Studio" (`chat-preview.ts`, `pending-generations.ts`); chat session resets on asset switch (keyed on manifest `asset_id`) while history bubbles still render per asset
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

- ❌ No backend parametric, manifest, thumbnail, history, or token routes — all handled client-side.
- ❌ `GET /api/health` — planned, not implemented.

---

## 3. Frontend (`frontend/src/`)

### 3.1 Actual File Layout

**TypeScript (frontend `frontend/src/js/` + backend `src/`); plain JS only in `frontend/src/js/vendor/` and build scripts**

```
frontend/src/js/
├── engine/
│   ├── scene-graph.ts          # Babylon engine, GLB/glTF load, selection, framing, thumbnails, collection load
│   ├── camera-persistence.ts   # Per-asset camera pose save/restore (localStorage)
│   ├── time-travel.ts          # Manifest chain walk, apply version
│   ├── parametric-preview.ts   # Inspector color/scale, live preview, timeline binding
│   ├── state.ts                # Shared mutable state
│   ├── transforms.ts           # CID extraction, format detection, bounds, centering
│   ├── cleanup.ts              # Node/scene disposal
│   ├── placeholders.ts         # Loading/error meshes
│   ├── app-init.ts             # Studio + Library bootstrap (replaces studio-init.js/library-init.js)
│   ├── theme.ts / theme-init.ts# CSS → Babylon color mapping
│   └── viewport-gizmo.ts       # Corner orientation gizmo
├── app/
│   └── router.ts               # Unified SPA view router: Studio ⇄ Library
├── ui/
│   ├── create-panel.ts         # Chat-style prompt flow, PayGo, tier/provider dropdowns
│   ├── asset-save.ts           # Save Draft / Publish UI; delegates building to services/asset-save/
│   ├── asset-library.ts        # Token gallery (owned + shared), collection expansion, thumbnails, drag; inaccessible token cards with Burn action
│   ├── asset-drop-zone.ts      # Viewport drag/drop overlay
│   ├── scene-clock.ts / model-clock-gizmo.ts / version-clock.ts  # Viewport version clock gizmos (scene + selected-node 3D ring)
│   ├── collaborators-panel.ts  # Team panel (add/remove editors, owner badge)
│   ├── comments-panel.ts       # Asset-level comment thread UI
│   ├── ledger-panel.ts         # Activity feed derived from manifest chain
│   ├── outliner.ts             # Scene hierarchy tree, select, double-click dive
│   ├── nesting.ts              # Breadcrumbs, dive/ascend, depth gating
│   ├── sidebar.ts              # 5-view switcher (AI Generation/Settings/Outline/Gallery/Activity)
│   ├── library-controller.ts   # Library view orchestration, data loading, and Studio handoff
│   ├── library-grid.ts         # Library grid/list rendering, selection, keyboard, rubber-band; minting/besked/wip status badges
│   ├── library-toolbar.ts      # Breadcrumb, search, sort, view toggle, New Collection, Upload
│   ├── library-context-menu.ts # Library right-click actions (Open, Rename, Burn, Delete, Send to Collection…)
│   ├── library-create.ts       # Shared optimistic collection-create flow (both EOA + social)
│   ├── collaborators.ts        # Burn button visibility helper
│   ├── dialog.ts / toasts.ts / wallet-modal.ts / wallet-popover.ts
│   └── ...
├── blockchain/
│   ├── wallet.ts               # Backward-compat barrel; re-exports the split wallet modules
│   ├── wallet-core.ts          # Web3 init, connect/disconnect, full auto-restore (CDP/EOA/WalletConnect), account state; 250ms polling
│   ├── wallet-network.ts       # Network switching
│   ├── wallet-payments.ts      # recordGeneration(), payForGenerationWithUSDC(), isFreeTierContract()
│   ├── wallet-publishing.ts    # publishAsset(), updateAssetURI(), updateEditors(), burn(); smart-account gas optimisation
│   ├── wallet-guard.ts         # Guards / helpers for publishing auth
│   ├── wallet-cdp.ts           # CDP email OTP → embedded EOA → ERC-4337 smart account; EIP-1193 shim
│   ├── smart-wallet-support.ts # SMART_WALLET_SUPPORTED_CHAIN_IDS (Base Sepolia only)
│   ├── token-resolver.ts       # Resolve child_ref tokens to manifest CIDs
│   ├── uri-utils.ts            # Normalize tokenURIs to plain CIDs
│   ├── siwe.ts                 # EIP-4361 message builder
│   ├── wallet-discovery.ts     # EIP-6963 multi-wallet
│   ├── wallet-connect.ts       # WalletConnect v2
│   ├── network-config.ts       # Per-network contract/USDC/RPC addresses (Hardhat/Base Sepolia)
│   ├── error-decoder.ts        # Revert reason decoding
│   └── explorer.ts             # Block explorer links
├── ipfs/
│   ├── remote-ipfs.ts          # Gateway reads (cache currently disabled)
│   └── write-to-ipfs.ts        # Direct Kubo/Pinata writes + pin
├── gltf/
│   ├── decomposer.ts           # Break buffers/images into separate IPFS CIDs (web-worker backed)
│   ├── async-gltf.ts           # Async decompose helpers
│   ├── composer.ts             # Resolve ipfs:// URIs back to base64 for Babylon
│   ├── material-editor.ts      # PBR material color edits, multi-primitive aware, bake to composite
│   ├── merkle-editors.ts       # Merkle tree/proof library for editor authorization
│   ├── source-color-editor.ts  # Per-mesh color editor integration
│   └── glb-parser.ts           # Binary glTF container parsing
├── domain/
│   ├── asset-store.ts          # Shared asset store (domain-only import); emits ASSET_STATE_CHANGED with full-state payload
│   ├── asset.ts                # Asset facade — single writer of asset identity/name/CID fields; getters + save/publish commands
│   ├── collection.ts           # Collection state commands (single writer of active/selected collection) + publishCollection seam
│   ├── editors.ts              # Merkle editor helpers, editor-list cache, proof commands
│   ├── version-history-store.ts # Headless manifest-chain store (entries, active/published CIDs) feeding the scene/model clocks
│   └── generation-actions.ts   # Pure follow-up-action policy for generation bubbles (retexture/retopo/auto-rig/animate)
├── state/
│   ├── wallet-state.ts / ui-state.ts / library-state.ts
│   └── create-store.ts         # Generic createStore factory
└── services/
    ├── api.ts                  # API client: sessions (SIWE), generate, comments archive, unpin, upload-url, paymaster
    ├── asset-save/             # manifest-builder.ts, collection-publish.ts, editor-publish.ts
    ├── library-ops.ts          # Create named collection (with onPending hook), upload glTF/GLB/3MF (decomposed at upload)
    ├── comment-thread.ts       # Per-asset Nostr WebSocket + archive comment thread
    ├── team.ts / asset-delete.ts / url-utils.ts
    └── ...
```

### 3.2 Core Systems — Verified in Code

**CDP Email Login (Account Abstraction)**
- Email OTP → CDP Embedded Wallet (`@coinbase/cdp-core`) → ERC-4337 smart account on Base Sepolia.
- Provider exposed as an EIP-1193 shim (`wallet-cdp.ts`) so all existing Web3.js code is unchanged.
- Gas is sponsored by the CDP Paymaster (`useCdpPaymaster: true`); low-balance toast is suppressed for smart accounts.
- Auth: embedded EOA signs the SIWE message; `eoaAddress` in the POST body enables fallback verification in `siwe-verify.ts`. Same SIWE session token format as EOA wallets.
- **Chain constraint:** Smart wallets only work on Base Sepolia (`SMART_WALLET_SUPPORTED_CHAIN_IDS`). EOA wallets (MetaMask/Rabby) work on all supported chains.
- **Verified end-to-end 2026-07-01:** OTP sign-in → SIWE session → collection mint via sponsored UserOperation on Base Sepolia.
- **Implementation notes / gotchas fixed:**
  - `signEvmMessage` expects the EOA **address string**, not the account object.
  - `eth_sendTransaction` returns a UserOperation hash; the provider polls `getUserOperation()` until the on-chain `transactionHash` is available, then returns the real EVM txHash to Web3.js.
  - `sepolia.base.org` blocks browser-origin RPC requests; use `https://base-sepolia-rpc.publicnode.com` for RPC passthrough.
  - CDP rejects relative `paymasterUrl`; local dev uses `useCdpPaymaster: true`. The backend proxy at `/api/v1/paymaster` is reserved for production deployments with a public HTTPS custom paymaster; it is session-gated, wallet-keyed rate limited (`PAYMASTER_RATE_LIMIT_MAX`, default 30/min), and forwards only `pm_*` methods.

**Token Indexer (`src/api/token-indexer.ts`)**
- Chunked `eth_getLogs` backfill scans for `Transfer` events (ownership) and `EditorSetChanged` events (editor-shared tokens) per chain.
- Editor list CIDs are read from chain (`editorListURI`) and resolved from IPFS to build a reverse index of editor address → token IDs.
- Per-chain chunk sizes in `constants/chains.js`: Hardhat=10000, Base Sepolia=2000.
- `force=true` query param bypasses cache for on-demand refresh.
- Base Sepolia deployment block pinned in `constants/chains.js` to avoid scanning from genesis.
- Exposes `GET /api/v1/indexer/owned` and `GET /api/v1/indexer/shared`.

**Optimistic Collection Create UI (`ui/library-create.ts`)**
- Shared `createCollectionFlow()` used by both toolbar button and right-click context menu.
- Card appears with a spinner badge immediately after the manifest write (before the mint tx); `onPending` hook in `createNamedCollection` fires the callback at that moment.
- On success: card flips to checkmark (`besked`) instantly and stays in place. `app-init.ts` no longer subscribes to `ASSET_PUBLISHED`, so there is no full background refresh.
- On failure/wallet-reject: optimistic card is removed automatically (toast). Works identically for EOA (card shows just before the wallet popup; rejecting removes it) and CDP email login.

**Library Burn Action (`ui/library-context-menu.ts`)**
- `requestBurnCollection()` removes the collection from local state directly after a successful on-chain burn; no full page refresh is triggered.

**Performance (smart-account publish path)**
- `_resolveGas()` in `wallet-publishing.ts` skips `eth_estimateGas` entirely for CDP smart accounts (bundler re-estimates, paymaster sponsors) — saves one RPC round trip on every publish/updateURI/updateEditors/burn.
- `ownerOf` + `tokenURI` pre-mint existence check now runs via `Promise.all` (parallel).
- `newWeb3()` sets `transactionPollingInterval = 250ms` (down from 1000ms default) across all 7 Web3 instance sites.
- Background smart-account pre-warm via no-op sponsored UserOperation at connect time.

**Inaccessible Token Cards**
- Studio gallery (`asset-library.ts`) and library page now show tokens the user owns on-chain but can't read (e.g. wrong network, IPFS unavailable) as card skeletons with a **Burn** action, rather than silently dropping them.

**Studio Undo/Redo (`engine/undo-stack.ts`, `engine/undo-controller.ts`)**
- Single chronological in-memory snapshot stack (cap 50) shared by all scene edits: gizmo move/rotate/scale (single + group), inspector scale fields, and parametric color edits (the old color-only private stack was folded in).
- Capture per completed gesture: gizmo drag start/end matrix snapshots (unchanged drags and no-op inspector commits filtered via `matricesEqual`); color pushes on picker close.
- `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` dispatcher + `#undoBtn`/`#redoBtn` in the viewport toolbar (disabled-state + label tooltips synced from the stack); shortcut is a silent no-op when stacks are empty and stays out of text fields.
- Stacks survive Save Draft/Publish (undo past a save point is fine — the next Save serializes the restored state via re-staged `pendingTransformEdits`/`pendingSourceColorEdits`); cleared on `SCENE_CLEARED` (asset open, generate, nesting dive, time-travel `loadVersion()`).
- Entry contract: `{ type: 'transform'|'color', label, items: [{ nodeId, meshName?, before, after }] }`; other edit types can hook in via `registerUndoApplier(type, fn)`.

**Studio Camera Pose Persistence (`engine/camera-persistence.ts`)**
- Camera pose (orbit angles, radius, target, ortho frustum) is saved to `localStorage`, keyed by canonical asset identity (`chainId:contractAddress:tokenId:assetId`).
- Unsaved drafts fall back to a `cid:<manifestCid>` key.
- Restore happens on `SCENE_READY`; assets with no stored pose reset to the default starting view so they never inherit the previous scene's camera.
- A 90-frame post-restore "settle" re-enforces the pose to defeat Babylon v9 smooth-transition drift; cancelled immediately on pointer/wheel input.

**3D Engine, Parametric, glTF Pipeline, Comments, Library** — unchanged from previous status; all fully implemented. See sections 3.2/3.3 of the 2026-06-28 snapshot for detail.

### 3.3 What Does NOT Work / Is Missing

- ❌ **IPFS browser cache hardcoded disabled** — every read hits the gateway directly.
- ❌ `anchorManifest()` stubbed in `ledger-panel.ts` — "not available in current contract".
- ❌ CDP email login (smart accounts) only supported on Base Sepolia — not on Hardhat local.
- ❌ No OpenSCAD WASM integration (explicitly deferred post-MVP).

---

## 4. Smart Contracts (`blockchain/`)

### 4.1 Deployment Artifacts

| Network | Contract | Address | Notes |
|---------|----------|---------|-------|
| `hardhat` / `localhost` (chain 31415822) | ArbeskAssetFree | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Local container, MockUSDC |
| `hardhat` / `localhost` (chain 31415822) | ArbeskAsset (paid) | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | Local container, MockUSDC |
| `baseSepolia` (chain 84532) | ArbeskAssetFree | `0xa39eFfc859b326CCCeB177CfBbef00C1876e18d8` (block 44309130, verified on Basescan) | **Current testnet target (EOA + CDP email login)** — fresh breaking deployment 2026-07-18, no token migration from the previous contract |
| `baseSepolia` (chain 84532) | ArbeskAsset (paid) | — | Not deployed on testnet |

### 4.2 Known Contract Issues

| Issue | Severity |
|-------|----------|
| ~~`verify.js` constructor args~~ Fixed — `verify.js` passes `[treasury, usdcAddress]` and defaults to `ArbeskAssetFree` (prefers `BASE_CONTRACT_ADDRESS` on baseSepolia) | — |
| No reentrancy attack tests | Low |

---

## 5. Tests

| Suite | Count | Status |
|-------|-------|--------|
| Jest unit (all) | 1468 across 110 suites | ✅ All passing (verified 2026-08-03) |
| E2E Playwright specs | 22 specs / 68 tests | ✅ Chromium (manual run against local stack) |
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
- `test/api/tripo3d-adapter.test.js` — v3 endpoints, refine/decimate/rig/retarget task creation, error mapping
- `test/frontend/asset-download.test.js` — GLB raw download + composite glTF inlining
- `test/frontend/task-progress.test.js` — viewport infobar banner states (stage hints, success fade, error)

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
| Nested child asset composition | ✅ | ✅ |
| Collection create (optimistic) | ✅ instant card, auto-rollback | ✅ instant card, sponsored |
| Upload GLB/glTF/3MF to collection (decomposed at upload) | ✅ | ✅ |
| Viewport file drop (override open asset's model / create draft) + actionable chat bubble (Retopo/Retexture/Auto-rig/Animate on uploads and opened pre-existing assets) | ✅ staged as unsaved draft | ✅ |
| Library page (grid/list/search) | ✅ | ✅ |
| Asset-level Nostr comments | ✅ | ✅ |
| Merkle editor collaboration | ✅ | ✅ |
| Token burn | ✅ | ✅ |
| Real 3D generation (Tripo3D BYOK) | ✅ text + image-to-3D, HD texture, retopo, rig & animate | ✅ |

### Beta blockers

| Blocker | Impact | Notes |
|---------|--------|-------|
| **CDP email login limited to Base Sepolia** | Medium — limits non-EOA users | CDP smart-wallet support is intentionally Base Sepolia only in this branch. |
| **ArbeskAsset (paid tier) not deployed on any testnet** | Low for beta | Free tier is fully deployed on both testnets. |

### Verdict

**Ready for closed beta on the collaboration and publishing workflow.** The full round-trip (connect → generate mock → parametric edit → publish NFT → collaborate → comment → library management) works on both EOA and CDP email-login wallets, with gas sponsorship for CDP smart-account users. 1468 unit tests green, 19 E2E specs cover the critical path.

**Ready for open beta** for the collaboration, publishing, and Tripo3D BYOK generation workflows (text-to-3D, image-to-3D, HD texture, smart retopology, rig & animate — all live-verified against the v3 API). Everything else is beta-quality.

---

## 7. Known Gaps & TODOs

| Gap | Where | Priority |
|-----|-------|----------|
| CDP email login on Hardhat | `smart-wallet-support.ts` | 🟡 Smart wallets only supported on Base Sepolia |
| Micro-ledger (`anchorManifest`) | `ledger-panel.ts` | 🟡 Post-beta |
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

Optional root `.env` kill-switch: `INDEXER_DISABLE_TESTNET=1` skips starting the Base Sepolia token indexer (see `.env.example`).
