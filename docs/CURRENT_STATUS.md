# Arbesk — Current Implementation Status

> **Generated:** 2026-06-21
> **Source of truth:** The codebase (backend, frontend, contracts, tests, build scripts). Architecture docs and API specs are reference only.
> **Contract:** `ArbeskAssetFree` is the default/free tier; `ArbeskAsset` is the paid tier (not `ArbeskWorld` — that name only exists in older docs).
> **Frontend build:** Custom Node.js scripts (no bundler).
> **Network targets:** Hardhat local for development; MegaETH Testnet (chain ID 6343) for public testnet.

---

## 1. Phase Completion Snapshot

| Phase | Status | Evidence in Code |
|-------|--------|------------------|
| Phase 1: Data Bridge, Mock Adapters & Private IPFS | ✅ Complete | `src/api/assets/generate-node.js`, `src/api/adapters/mock-adapter.js`, `docker-compose.yml`, `src/api/storage/` |
| Phase 2: Parametric Versions & Babylon.js Rendering | ✅ Complete | `frontend/src/js/engine/parametric-preview.js`, `frontend/src/js/engine/time-travel.js` |
| Phase 3: PayGo Smart Contract & On-Chain Integration | ✅ Complete | `blockchain/contracts/ArbeskAsset.sol`, `frontend/src/js/blockchain/wallet.js` |
| Phase 4: UI Assembly & Consolidated Workspace Studio | ✅ Complete | `frontend/src/pug/studio.pug`, 23 SCSS partials, sidebar/outliner/nesting |
| Phase 4.1: Publishing Polish & Runtime Cache | ✅ Complete | Thumbnail capture in `scene-graph.js`, thumbnail extraction in `src/api/index.js`, unpin lifecycle |
| Phase 5.1: Token ID-Based Child Worlds | ✅ Complete | `child_ref` resolution in `token-resolver.js`, depth/cycle protection in `scene-graph.js` |
| Phase 5.2: Free Tier Contract | ✅ Complete | `ArbeskAssetFree.sol` deployed as default, `ArbeskAsset.sol` kept as paid tier |
| Phase 5.3: Merkle Editor Proofs | ✅ Complete | `editorRoot`/`editorSetVersion` in `ArbeskAssetBase.sol`, `frontend/src/js/gltf/merkle-editors.js`, `frontend/src/js/services/team.js` |
| Phase 5.4: Collection Manifests | ✅ Complete | Collection merge in `asset-save.js`, collection expansion in `asset-library.js`, collection loading in `scene-graph.js` |
| Phase 5: Micro-Ledger | ❌ Not started | Only a stub comment in `ledger-panel.js` |

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
    │   ├── kubo.js             # Local Kubo add/cat/pin.rm
    │   └── pinata.js           # Pinata v3 SDK + presigned upload URLs
    ├── abi-router.js           # Serves compiled ABI from blockchain/artifacts/
    ├── authentication.js       # Session token validation middleware
    ├── comments-archive.js     # Nostr comment thread → IPFS archive
    ├── ipfs-utils.js           # catManifest() with timeout/abort
    ├── manifest-utils.js       # getSceneNodes, bumpManifestVersion
    ├── rate-limiter.js         # In-memory per-wallet rate limiter (10/hr)
    ├── sessions.js             # SIWE session create/delete (24h TTL)
    ├── siwe-verify.js          # EIP-4361 message verification
    └── openapi.json            # Static OpenAPI spec
```

> **Note:** `src/api/parametric-version.js` does **not exist**. Parametric edits happen client-side; the browser sends the full manifest to `POST /api/v1/manifests`.
>
> **Free tier:** `POST /api/v1/generations` validates a transaction receipt. The UI uses `recordGeneration()` on the free tier and `payForGenerationWithUSDC()` on the paid tier; the backend accepts `AssetGenerationRecorded`, `AssetGenerationPaid`, or `AssetGenerationPaidUSDC` events.

### 2.2 Implemented Routes (`/api/v1`)

| Method | Path | Auth | What it does |
|--------|------|------|--------------|
| GET | `/config` | None | Returns contract address, network configs, IPFS backend/gateway, mock flag |
| POST | `/sessions` | None | Creates SIWE session (EIP-4361) |
| DELETE | `/sessions` | Session | Invalidates session token |
| POST | `/generations` | Session | Validates tx, mocks asset, pins to IPFS |
| POST | `/manifests` | None | Saves draft manifest (asset or collection), extracts thumbnail dataUrl → IPFS |
| POST | `/manifests/:cid/publish` | None | Same as save but returns `{ cid }` |
| GET | `/manifests/:cid/history` | None | Walks `prev_asset_manifest_cid` chain up to 50 entries |
| GET | `/tokens/:tokenId/manifest` | None | Calls `tokenURI()` on-chain → fetches manifest from IPFS |
| POST | `/ipfs/upload-url` | Session | Mints a short-lived presigned upload credential (Pinata/Kubo) |
| POST | `/ipfs/unpin` | None | Walks up to 100 manifests, collects all CIDs, unpins them |
| GET | `/contracts/:name/abi` | None | Serves compiled ABI JSON from `blockchain/artifacts/` |
| GET | `/openapi.json` | None | Static OpenAPI spec |
| GET | `/docs` | None | Swagger UI HTML bundle |

### 2.3 Auth Details

**Session auth** (`Authorization: Session <token>`):
- SIWE-based (EIP-4361). Domain-bound, 5-minute message age, nonce replay protection.
- 24-hour TTL, in-memory Map with hourly cleanup.
- Used for `POST /generations` and `POST /ipfs/upload-url` after wallet connect creates the session.

### 2.4 What Works

- ✅ Mock generation with tier validation (Basic/Standard/Premium/Pro)
- ✅ Transaction replay prevention (`usedTxHashes` Set + manifest history scan)
- ✅ Rate limiting (10/hour per wallet, 429 + `Retry-After`)
- ✅ Manifest save with thumbnail dataUrl extraction → separate IPFS asset
- ✅ Collection manifest save/validation (`type: "collection"` + `assets` object)
- ✅ Manifest chain walking (backward `prev_asset_manifest_cid`, cycle detection)
- ✅ Token resolution (`tokenURI` → IPFS manifest)
- ✅ IPFS unpin on burn (walks chain, collects CIDs, calls `pin.rm`)
- ✅ Multi-network config (Hardhat local `31415822`, MegaETH Testnet `6343`)
- ✅ Multi-storage backend (`kubo` local, `pinata` testnet)
- ✅ Presigned upload URLs for browser uploads (Pinata/Kubo)
- ✅ Nostr comments archive snapshot on republish

### 2.5 What Does NOT Work / Is Missing

- ❌ **Cloud 3D adapters** — `generate-node.js` returns `501 NOT_IMPLEMENTED` when `MOCK_3D_GENERATION` is disabled.
- ❌ No backend parametric route — handled entirely in browser.
- ❌ `GET /api/health` — planned, not implemented.
- ❌ `GET /api/manifest/:id` — planned, not implemented.
- ❌ `GET /api/resolve-token` — planned for Phase 5.1 fallback, not implemented (browser resolver is the current path).

---

## 3. Frontend (`frontend/src/`)

### 3.1 Actual File Layout

**JavaScript (46+ files)**

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
│   ├── asset-save.js           # Save Draft / Publish, collection merge, thumbnail capture
│   ├── asset-library.js        # Token gallery (owned + shared), collection expansion, thumbnails, drag
│   ├── asset-drop-zone.js      # Viewport drag/drop overlay
│   ├── asset-history.js        # Draggable horizontal timeline scrubber
│   ├── asset-editors.js        # Team panel (add/remove editors, owner badge)
│   ├── ledger-panel.js         # Activity feed derived from manifest chain
│   ├── outliner.js             # Scene hierarchy tree, select, double-click dive
│   ├── nesting.js              # Breadcrumbs, dive/ascend, depth gating
│   ├── sidebar.js              # 4-view switcher (Create/Outline/Library/Ledger)
│   ├── collaborators.js        # Burn button visibility helper
│   ├── dialog.js / toasts.js / wallet-modal.js / wallet-popover.js
│   └── ...
├── blockchain/
│   ├── wallet.js               # Web3Modal, WalletConnect, USDC PayGo, contract calls, burn, Merkle proof calls
│   ├── token-resolver.js       # Resolve child_ref tokens to manifest CIDs
│   ├── uri-utils.js            # Normalize tokenURIs to plain CIDs
│   ├── siwe.js                 # EIP-4361 message builder
│   ├── wallet-discovery.js     # EIP-6963 multi-wallet
│   ├── wallet-connect.js       # WalletConnect v2
│   ├── network-config.js       # Per-network contract/USDC/RPC addresses
│   ├── error-decoder.js        # Revert reason decoding
│   ├── explorer.js             # Block explorer links
│   └── dev-account.js          # Hardhat dev account helper
├── ipfs/
│   ├── remote-ipfs.js          # Gateway reads (cache currently disabled)
│   └── write-to-ipfs.js        # Direct Kubo/Pinata writes + pin
├── gltf/
│   ├── decomposer.js           # Break buffers/images into separate IPFS CIDs
│   ├── async-gltf.js           # Async decompose helpers
│   ├── composer.js             # Resolve ipfs:// URIs back to base64 for Babylon
│   ├── material-editor.js      # PBR material color edits, multi-primitive aware, bake to composite
│   ├── merkle-editors.js       # Merkle tree/proof library for editor authorization
│   └── uri_to_cid.js           # Legacy helpers (mostly reference now)
├── state/
│   ├── asset-state.js        # Replaces window.* asset globals
│   ├── wallet-state.js       # Replaces window.* wallet globals
│   └── ui-state.js           # Replaces window.* UI globals
└── services/
    ├── api.js                  # API client: sessions, generate, save, publish, history, unpin, upload-url
    ├── team.js                 # Merkle-based editor add/remove
    ├── asset-delete.js         # Remove an asset from a collection
    └── url-utils.js            # URL param helpers
```

**Templates & Styles**
- `frontend/src/pug/studio.pug` — Single consolidated studio page
- `frontend/src/scss/` — 23 partials including layout, viewport, inspector, timeline, ledger, wallet modals

> **Naming drift from older docs:** `chat-studio.js` → `create-panel.js`, `save-world.js` → `asset-save.js`, `gallery.js` → `asset-library.js`, `history-browser.js` → `asset-history.js`, `team-panel.js` → `asset-editors.js`.

### 3.2 Core Systems — Verified in Code

**3D Engine (`scene-graph.js`)**
- Babylon.js init with `ArcRotateCamera`, hemispheric + directional lights, ground grid
- Orthographic presets (1=Front, 3=Right, 7=Top) with custom wheel zoom scaling
- Click-to-select with amber highlight layer; sub-mesh toggle on re-click
- GLB loading via blob + `URL.createObjectURL`
- glTF loading via JSON → `composeGlTF` resolves `ipfs://` CIDs → `ImportMeshAsync`
- Asset centering (bounding box → shift root nodes)
- Thumbnail capture: offscreen canvas crop → WebP blob → dataUrl
- Keyboard: Escape (deselect), Home (frame all), F (frame selected), 1/3/7 (views), Ctrl+N (new), Ctrl+B (sidebar), Ctrl+1-4 (switch views)

**Collection Manifests (Phase 5.4)**
- `asset-save.js` merges each published asset CID into a collection manifest's `assets` map.
- Default collection token ID derived deterministically from wallet address via `soliditySha3(address)`.
- Named collections derive token ID from `soliditySha3(address, name)`.
- `asset-library.js` expands collection tokens into one card per asset.
- `scene-graph.js` can load a collection manifest without immediately opening an asset.

**Token Child Worlds (Phase 5.1)**
- `loadTokenChildNode()` fully implemented with placeholder → async resolution
- `MAX_CHILD_WORLD_DEPTH = 5`, circular reference detection via `Set`
- Transform matrix applied to anchor before child loading
- Duplicate drop prevention via `refKey`

**Parametric Editing (`parametric-preview.js`, `time-travel.js`)**
- Live color/scale preview applies immediately to Babylon meshes
- `state.pendingPostProcessorEdits` tracks uncommitted changes
- Inspector close reverts to last committed state
- Component colors: per-sub-mesh overrides stored in `meshOverrides`
- Timeline slider binds to manifest chain; scrubs are view-only

**glTF Pipeline**
- `decomposer.js` / `async-gltf.js`: base64 buffers/images → `writeToIPFS` → `ipfs://<CID>` URIs
- `composer.js`: fetches `ipfs://` binaries from gateway → base64 data URIs
- `material-editor.js`: `fetchComposite` → edit PBR factors → `commitCompositeChanges`; `findMaterialByMeshName()` returns all materials for meshes with multiple primitives
- Round-trip tested: decompose → compose yields identical bytes

**Events Layer**
- `frontend/src/js/events/bus.js` exports a singleton `mitt()` instance plus `EVENTS` constants
- Handlers receive the payload directly (not wrapped in `CustomEvent`)
- Replaces the previous `events/registry.js` implementation (removed)

**State Layer**
- `frontend/src/js/state/{asset-state,wallet-state,ui-state}.js` replace the ~12 mutable `window.*` app-state globals
- Each store exposes `get() / set() / reset()` and emits `ASSET_STATE_CHANGED` / `WALLET_STATE_CHANGED` / `UI_STATE_CHANGED` via the mitt bus

**IPFS Layer**
- Reads: `http://127.0.0.1:8080/ipfs/<cid>` with `cache: "no-store"`
- Writes: Browser uses presigned upload URLs from `POST /api/v1/ipfs/upload-url`, then pins via backend
- **Browser caching is hardcoded disabled** (`IPFS_CACHE_ENABLED = false`); no IndexedDB/memory cache active

**Blockchain / Wallet (`wallet.js`)**
- Multi-wallet: EIP-6963 discovery + WalletConnect v2 + legacy injected
- Auto-connect from `localStorage` via silent `eth_accounts`
- Networks: Hardhat local (`31415822`), MegaETH Testnet (`6343`)
- Contract init with bytecode verification at address
- USDC PayGo: approval → allowance reset → verification (5 retries) → `payForGenerationWithUSDC` with gas defaults
- Publishing: `publishAsset(tokenURI, tokenId, editorRoot, editorListUri)` (mint), `updateAssetURI(tokenId, newTokenURI, proof)` (republish)
- Collaboration: `updateEditors(tokenId, newRoot, newListUri, callerRole, callerProof)` — full editor list stored on IPFS
- Burn: resolves manifest CID before burn, calls `burn(tokenId, proof)`, `unpinAssetCids` non-blocking after on-chain success

**API Service (`services/api.js`)**
- Session auth with auto-retry on `INVALID_SESSION`
- Generation requires a valid session; no fallback auth scheme
- Endpoints: `POST /generations`, `POST /manifests`, `POST /manifests/:cid/publish`, `GET /manifests/:cid/history`, `GET /tokens/:tokenId/manifest`, `POST /ipfs/unpin`, `POST /ipfs/upload-url`, `GET /config`, `GET /contracts/:name/abi`

**UI Systems**
- Sidebar: 4 views persisted to `localStorage`, collapsible, responsive auto-collapse
- Create panel: chat bubbles, prompt input, provider/tier dropdowns, generation flow
- Asset library: owned (`balanceOf`/`tokenOfOwnerByIndex`) + shared (Merkle editor list), collection expansion, lazy thumbnails, drag with `application/x-arbesk-linked-asset`
- Outliner: tree with 📦/🧩 icons, click select, double-click dive, library drag
- Nesting: breadcrumb path bar, Alt+Left ascend, depth status in bottom bar
- History: draggable horizontal track, active vs published states
- Ledger: derives activity from manifest chain via `/api/v1/manifests/:cid/history` — **no localStorage ledger**
- Dialogs: GNOME HIG-styled modals using `focus-trap@7.6.2` (CDN) for robust Tab cycling and MetaMask overlay coexistence
- Toasts: Notyf@3.10.0 (CDN) wrapper preserving `showToast` / `showTxToast` / `showErrorToast` call sites with GNOME-styled glass accents

### 3.3 What Does NOT Work / Is Missing

- ❌ **IPFS browser cache disabled** — every read hits the gateway directly.
- ❌ `anchorManifest()` stubbed in `ledger-panel.js` — "not available in current contract".
- ❌ `uri_to_cid.js` still has Phase 1/2 comments referencing inactive code paths.
- ✅ Low-balance toast in `_checkBalance()` is now dismissed when the wallet account changes or disconnects (fixed stale warning + undefined `devAddress`).
- ❌ No OpenSCAD WASM integration (explicitly deferred post-MVP).
- ❌ No automated E2E tests.

---

## 4. Smart Contracts (`blockchain/`)

### 4.1 Contracts

**Not `ArbeskWorld.sol`** — older docs reference that name.

There are now **two** contracts:

| Contract | Purpose | Symbol | Default? |
|----------|---------|--------|----------|
| `ArbeskAssetFree.sol` | Free tier — NFT + Merkle editor auth + free `recordGeneration()` with 10/day quota | `ARBF` | ✅ Yes (local testing + frontend default) |
| `ArbeskAsset.sol` | Paid tier — adds USDC PayGo generation payments | `ARBA` | Optional paid tier |

Both inherit shared NFT/collaboration/burn logic from `ArbeskAssetBase.sol`.

#### `ArbeskAsset.sol` (Paid Tier)

- **Standard:** ERC-721 with Enumerable extension (`ERC721Enumerable`)
- **Symbol:** `ARBA`
- **Inheritance:** `ArbeskAssetBase`, `ReentrancyGuard`

**Key Functions**

| Category | Functions |
|----------|-----------|
| Payment (USDC) | `payForGenerationWithUSDC(bytes32 nodeId, string prompt, Tier tier)` — tiered pricing, `safeTransferFrom` |
| Minting | `publishAsset(string uri, uint256 tokenId, bytes32 editorRoot, string editorListUri)` |
| Queries | `tokenURI()`, `totalSupply()`, `getAssetManifest()`, `getTierCost()`, `editorRoot(tokenId)`, `editorSetVersion(tokenId)` |
| Collaboration | `updateEditors(uint256 tokenId, bytes32 newRoot, string newListUri, uint8 callerRole, bytes32[] callerProof)` |
| URI update | `updateAssetURI(uint256 tokenId, string newURI, bytes32[] proof)` |
| Burn | `burn(uint256 tokenId, bytes32[] proof)` — owner or Editor with Merkle proof |
| Admin | `setCost()`, `setTreasury()`, `setTierCost()`, `setUsdcToken()`, `pause()`, `unpause()`, `withdraw()`, `withdrawUSDC()` |

**State / Limits (paid tier)**
- `costPerGeneration` = `0.01 ether` (native, currently unused)
- Tier costs: Basic=$0.75, Standard=$1.25, Premium=$1.75, Pro=$2.50 (6-decimal USDC)
- `maxEditorsPerToken()` = 5000

**Events**
`AssetGenerationPaid`, `AssetGenerationPaidUSDC`, `AssetPublished`, `EditorSetChanged`, `AssetBurned`, `AssetURIUpdated`, `TreasuryUpdated`, `CostUpdated`, `TierCostUpdated`, `UsdcTokenUpdated`

**Custom Errors (paid tier adds)** `IncorrectPaymentAmount`, `InvalidPromptLength`, `PaymentAlreadyUsed`, `TreasuryTransferFailed`, `UsdcPaymentsDisabled`, `TierCostNotSet`, `InvalidCost`, `NoBalanceToWithdraw`, `WithdrawFailed`, `UsdcTokenNotSet`, `DirectTransferNotAllowed`.

#### `ArbeskAssetFree.sol` (Free Tier)

- **Symbol:** `ARBF`
- **Inheritance:** `ArbeskAssetBase`
- **Functions:** `recordGeneration(bytes32 nodeId, string prompt)` (10/day per wallet), plus all shared NFT/collaboration functions
- **No payment functions, no treasury, no USDC, no ReentrancyGuard, no withdraw**
- **Events:** `AssetGenerationRecorded(address indexed userWallet, bytes32 indexed nodeId, string prompt, uint256 timestamp, uint256 countToday)`

**State / Limits (free tier)**
- `DAILY_GENERATION_LIMIT` = 10 per wallet
- `maxEditorsPerToken()` = 5000
- Quota state (`lastGenerationDay` + `generationCountToday`) is packed into a single 256-bit storage slot to minimize gas

**Gas profile (local Hardhat)**
- `recordGeneration()` first call per day: ~50,650 gas
- `recordGeneration()` warm call same day: ~33,430 gas
- Packing the quota slot saves ~22,000 gas on the first call compared to two separate storage slots

### 4.2 `ArbeskAssetBase.sol` (Abstract Base)

- **Inheritance:** `ERC721Enumerable`, `Ownable`, `Pausable`
- **Shared logic:** minting, URI storage, Merkle-root editor authorization, burn, pause/unpause
- **Key state:**
  - `mapping(uint256 => bytes32) public editorRoot`
  - `mapping(uint256 => uint256) public editorSetVersion`
- **Leaf format:** `keccak256(abi.encodePacked(address, role, tokenId, editorSetVersion[tokenId]))`
- **Role enum:** `None = 0`, `Viewer = 1`, `Editor = 2`
- Owner bypasses all Merkle proof checks.

### 4.3 MockUSDC

- `blockchain/contracts/mock/MockUSDC.sol` — OpenZeppelin ERC20, 6 decimals, unrestricted `mint()`
- Auto-deployed by `deploy.js` for local networks when no USDC address is configured

### 4.4 Deployment Artifacts

| Network | Contract | Address | Notes |
|---------|----------|---------|-------|
| `hardhat` (chain 31415822) | ArbeskAssetFree | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Local container, MockUSDC |
| `hardhat` (chain 31415822) | ArbeskAsset (paid) | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | Local container, MockUSDC |
| `localhost` | ArbeskAssetFree | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Local container, MockUSDC |
| `localhost` | ArbeskAsset (paid) | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | Local container, MockUSDC |
| `megaethTestnet` (chain 6343) | ArbeskAssetFree | `0xFdf0DC8c7Fd363de8522cDE9628688A87F2Fd73B` | **Current testnet target** |
| `megaethTestnet` (chain 6343) | ArbeskAsset (paid) | — | **Not deployed on testnet** |

> `CONTRACT_ADDRESS` in `.env` now points to the **free** contract. The paid contract is stored in `PAID_CONTRACT_ADDRESS`.
> Contract addresses are also hardcoded in `src/config.js` and `frontend/src/js/blockchain/network-config.js`.

### 4.4 Hardhat Config

- Solidity `0.8.24`, EVM `cancun`, optimizer `runs: 1000`
- Networks: `hardhat` (31415822), `localhost` (8545), `megaethTestnet` (6343)
- Etherscan verification configured for MegaETH explorer

### 4.5 Estimated On-Chain Costs on MegaETH Testnet

MegaETH uses a bucket-multiplier gas model; costs scale as a contract's storage bucket fills. See `docs/MEGAETH_ANALYSIS.md` for the full model. Approximate costs at 0.01 gwei:

| Operation | Gas | Cost @ ETH $1,727 | Notes |
|---|---:|---:|---|
| `recordGeneration()` first call/day | ~50,650 | ~$0.0009 | Quota day rollover writes one packed slot |
| `recordGeneration()` warm call | ~33,430 | ~$0.0006 | Same-day generation |
| `publishAsset()` mint (m=1) | ~150,000 | ~$0.003 | Varies by URI length |
| `updateAssetURI()` | ~35,000 | ~$0.0006 | Republish existing token |
| `updateEditors()` | ~35,000 | ~$0.0006 | Replace editor Merkle root |

> MegaETH Testnet uses ETH for gas. Testnet ETH has no dollar value.

### 4.6 Known Contract Issues

- 🐛 **`scripts/verify.js` bug**: Passes `[treasury]` as sole constructor arg, but constructor is `constructor(address _treasury, address _usdcToken)`. Etherscan verification will fail on live networks.

---

## 5. Tests

### 5.1 Backend / Unit Tests (`test/`)

| File | Lines | Coverage |
|------|-------|----------|
| `test/api.test.js` | ~1,048 | All v1 routes: generation, save, publish, history chain, token resolution, auth, rate limit, thumbnails, child_ref manifests, collection manifests |
| `test/decomposer-composer.test.js` | ~1,167 | glTF pure logic: composite detection, base64 round-trip, decompose, compose, URI resolution |
| `test/scene-graph.test.js` | ~924 | Scene graph helpers: CID extraction, format detection, bounds, transform matrices, disposal, child_ref anchor walking |
| `test/token-resolver.test.js` | ~150 | `normalizeTokenURI`, child_ref validation, `MAX_CHILD_WORLD_DEPTH` |

### 5.2 Frontend Regression Tests (`test/frontend/`)

| File | Lines | Coverage |
|------|-------|----------|
| `test/frontend/build.test.js` | ~286 | Syntax-checks built JS, verifies `window.*` exports, CDN version pinning (web3@1.10.0), wallet lifecycle |
| `test/frontend/deployment-integrity.test.js` | ~486 | ABI exists, required function signatures, `.env` address sync, Docker volume mounts, on-chain bytecode verification |
| `test/frontend/wallet-exports.test.js` | ~152 | Static parse of `wallet.js` export block, consumer import contracts |
| `test/frontend/bus.test.js` | ~120 | mitt singleton contract: direct payloads, on/off, no cross-fire |
| `test/frontend/dialog.test.js` | ~191 | `showDialog` / `showConfirmDialog` / `showInfoDialog` behaviour, focus-trap API contract |
| `test/frontend/toasts.test.js` | ~209 | Notyf wrapper: types, durations, actions, eviction, dismiss |
| `test/state/asset-state.test.js` | ~80 | Store get/set/reset + `ASSET_STATE_CHANGED` emissions |
| `test/state/wallet-state.test.js` | ~60 | Store get/set/reset + `WALLET_STATE_CHANGED` emissions |
| `test/state/ui-state.test.js` | ~50 | Store get/set/reset + `UI_STATE_CHANGED` emissions |

### 5.3 Contract Tests (`blockchain/test/`)

| File | Lines | Coverage |
|------|-------|----------|
| `blockchain/test/ArbeskAsset.test.js` | ~1,291 | Payment (USDC tiered), replay prevention, minting, Merkle editor authorization, burn |
| `blockchain/test/ArbeskAssetFree.test.js` | ~250 | Deployment, `recordGeneration` quota (10/day), minting, Merkle editor auth, burn, pause |

### 5.4 Test Gaps

- ❌ No automated E2E tests.
- ❌ No reentrancy attack tests (though `nonReentrant` is present).
- ❌ No fuzzing / property-based tests.

---

## 6. Build System & Infrastructure

### 6.1 Build Pipeline

**Frontend dependencies**
- Runtime: `bootstrap@5.1.3`, `mitt@^3.0.1`
- CDN-loaded: `babylon.js`, `web3@1.10.0`, `web3modal@1.9.12`, `notyf@3.10.0`, `focus-trap@7.6.2`

**Frontend build** (`frontend/scripts/` — custom Node.js, no Webpack/Vite):
1. `clean` — `rm -rf frontend/dist`
2. `build:pug` — Prettier-formatted `.pug` → `dist/*.html`
3. `build:scss` — Sass + PostCSS/Autoprefixer → `dist/css/styles.css`
4. `build:scripts` — `cp -R src/js dist/js` (verbatim copy, no transpilation)
5. `build:assets` — `cp -R public/* dist/`
6. `start` — Full build + BrowserSync + chokidar watcher (`sb-watch.js`)

> Browser globals (`BABYLON`, `Web3`, `IpfsHttpClient`, `Notyf`, `focusTrap`) come from CDN `<script>` tags in `studio.pug`.

### 6.2 Docker Services (`docker-compose.yml`)

| Service | Image | Ports | Config |
|---------|-------|-------|--------|
| `ipfs` | `ipfs/kubo:latest` | `127.0.0.1:5001`, `127.0.0.1:8080` | No DHT, no bootstrap, no NAT/relay, loopback-only swarm, 100GB cap, CORS enabled |
| `hardhat` | `node:20-slim` | `127.0.0.1:8545` | Live-mounted `blockchain/` volume, default `npx hardhat node --hostname 0.0.0.0` |
| `nostr` | `scsibug/nostr-rs-relay:latest` | `127.0.0.1:7777` | Local-only WebSocket relay, SQLite storage, open auth for dev |

### 6.3 Dev Orchestration

| Script | Stack | Behavior |
|--------|-------|----------|
| `scripts/start-dev.sh` (default) | Local IPFS + Hardhat + Nostr | Always starts clean, deploys fresh `ArbeskAsset` + `MockUSDC`, syncs addresses to `.env` and JS network configs, builds frontend, starts backend. Used by E2E with `--setup-only`. |
| `scripts/start-dev.sh --testnet` | MegaETH Testnet + Pinata + local Nostr | Starts only the local Nostr relay, validates testnet/Pinata env vars, builds frontend, starts backend with `IPFS_BACKEND=pinata`. |

`start-dev.sh` (local mode) flow:
1. Ensures `blockchain/.env` exists
2. Stops/removes any existing worktree containers for a clean start
3. Resets the Hardhat chain and starts Docker Compose (IPFS + Hardhat + Nostr)
4. Installs `node_modules` if missing
5. **Auto-deploys** `ArbeskAsset` + `MockUSDC`
6. Syncs `CONTRACT_ADDRESS` / `PAID_CONTRACT_ADDRESS` / `USDC_TOKEN` to root `.env`, `src/config.js`, and `frontend/src/js/blockchain/network-config.js`
7. Builds frontend
8. Starts backend server
9. Prints URLs + MetaMask setup info

### 6.4 npm Scripts

| Script | What it runs |
|--------|--------------|
| `npm start` | `node src/index.js` |
| `npm run dev` | `./scripts/start-dev.sh` (local stack, E2E-ready) |
| `npm run dev:testnet` | `./scripts/start-dev.sh --testnet` (testnet + Pinata) |
| `npm run nodemon` | Build frontend + nodemon backend |
| `npm run build:frontend` | Delegates to `frontend/package.json` build |
| `npm test` | Jest on `test/` (excludes `blockchain/`) |
| `npm run test:api` | Jest on `test/api.test.js` |
| `npm run test:frontend` | Jest on `test/frontend/` |
| `npm run test:contracts` | Hardhat tests inside Docker container |
| `npm run test:all` | Sequential: frontend → api → contracts |

### 6.5 Environment Files

| File | Status |
|------|--------|
| Root `.env` | ✅ Exists |
| `blockchain/.env` | ✅ Exists |
| `frontend/.env` | ❌ Missing (AGENTS.md mentions it, but it does not exist) |

#### Storage backend variables

IPFS storage is selected by `IPFS_BACKEND` and implemented through the `src/api/storage/` abstraction.

| Variable | Scope | Meaning |
|----------|-------|---------|
| `IPFS_BACKEND` | backend | `pinata` (dev/prod) or `kubo` (E2E). Default `kubo`. |
| `PINATA_JWT` | backend secret | Master JWT for the Pinata v3 SDK — server-only, never sent to the browser. |
| `PINATA_GATEWAY` | backend | Dedicated gateway host, e.g. `your-gw.mypinata.cloud`. |
| `PINATA_UPLOAD_TTL` | backend | Presigned upload URL lifetime in seconds (default 60). |

Browser uploads use short-lived presigned URLs minted by `POST /api/v1/ipfs/upload-url` (session-gated, rate-limited per wallet); the master JWT stays server-side. The automated E2E suite runs against Kubo via `IPFS_BACKEND=kubo`.

---

## 7. Known Gaps & TODOs

### 7.1 Unimplemented Features

| Gap | Where it's felt | Notes |
|-----|-----------------|-------|
| Cloud 3D generation | `src/api/assets/generate-node.js` | Returns `501`. Only mock adapter works. |
| Micro-ledger | `frontend/src/js/ui/ledger-panel.js` | Stubbed `anchorManifest()`. No append-only store. |
| OpenSCAD WASM | Not present | Explicitly deferred post-MVP. |
| Health check endpoint | Not present | `GET /api/health` planned, not implemented. |
| Direct manifest fetch by ID | Not present | `GET /api/manifest/:id` planned, not implemented. |
| Backend token resolver fallback | Not present | `GET /api/resolve-token` planned for Phase 5.1, not implemented (browser resolver is the current path). |

### 7.2 Bugs / Issues

| Issue | Location | Severity |
|-------|----------|----------|
| `verify.js` passes wrong constructor args | `blockchain/scripts/verify.js` | High — Etherscan verification will fail |
| ~`devAddress` undefined in `_checkBalance()`~ | `frontend/src/js/blockchain/wallet.js` | Fixed — stale low-balance toast is now cleared on account/network change |
| IPFS browser cache hardcoded disabled | `frontend/src/js/ipfs/remote-ipfs.js` | Low — intentional but no toggle UI |

### 7.3 Documentation Drift

| Drift | Reality |
|-------|---------|
| Contract name `ArbeskWorld` | Actual contract is `ArbeskAsset` |
| File `src/api/generate-asset-node.js` | Actual path is `src/api/assets/generate-node.js` |
| File `src/api/parametric-version.js` | Does not exist — parametric is client-side |
| File `frontend/src/js/ui/chat-studio.js` | Actual file is `create-panel.js` |
| File `frontend/src/js/ui/save-world.js` | Actual file is `asset-save.js` |
| File `frontend/src/js/ui/gallery.js` | Actual file is `asset-library.js` |
| File `frontend/src/js/ui/history-browser.js` | Actual file is `asset-history.js` |
| File `frontend/src/js/ui/team-panel.js` | Actual file is `asset-editors.js` |
| File `frontend/src/js/events/registry.js` | Replaced by `frontend/src/js/events/bus.js` (mitt singleton) |
| Network target Optimism Sepolia/Mainnet | Replaced by MegaETH Testnet |
| On-chain editor roles (`addEditor`/`removeEditor`) | Replaced by off-chain Merkle editor list + `updateEditors` |

---

## 8. How to Verify Current State

```bash
# Start infrastructure
docker compose up -d

# Full dev stack (deploys contracts if needed, builds frontend, starts backend)
npm run dev

# Run all verification tests
npm run test:all

# Or individually:
npm run test:frontend   # Requires built dist/ + .env files
npm run test:api        # Requires backend mocks only
npm run test:contracts  # Requires running Hardhat container
```

After any `.sol` change:
```bash
docker-compose run --rm hardhat npx hardhat compile
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat
# Sync CONTRACT_ADDRESS (free) and PAID_CONTRACT_ADDRESS from blockchain/.env → root .env
npm run test:frontend
```

---

## 9. Summary

Arbesk is a **functionally complete thick-client 3D world studio** through Phase 5.4. The browser owns rendering, parametric editing, glTF decomposition, IPFS reads/writes, wallet interactions, token resolution, collection management, and Merkle editor proof generation. The Express backend is a thin gatekeeper handling auth, generation validation, manifest persistence, storage abstraction, and IPFS unpin lifecycle.

**What is production-ready:**
- Mock-backed generative pipeline with tx validation and replay guards
- Full parametric editing with live Babylon.js preview
- Token-based child world composition with depth/cycle protection
- Free-tier `recordGeneration()` with packed daily quota and owner bypass
- USDC PayGo with tiered pricing (paid tier)
- SIWE session auth reducing per-generation pop-ups
- ERC-721 minting, URI updates, Merkle-proof editor authorization, burn
- Collection manifests — every token is a collection of asset CIDs
- glTF decompose/composer/material-edit pipeline
- Private Dockerized IPFS + Hardhat local dev stack
- MegaETH Testnet target with per-chain network configs

**What is explicitly not implemented:**
- Production cloud 3D adapters (returns 501)
- Micro-ledger / append-only audit trail
- OpenSCAD WASM
- E2E tests
