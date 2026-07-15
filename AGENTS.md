# AGENTS.md — Arbesk Developer Guide

Conventions, key file references, and practical guidance for AI agents and developers.

> Deep reference: `docs/ARCHITECTURE.md` · `docs/CURRENT_STATUS.md` · `docs/API_SPEC.md`
> Claude Code quick guide: `CLAUDE.md`

---

## 1. Project Identity

**Name**: Arbesk
**Type**: Cloud-Native 4D Fractal Version-Controlled 3D Asset Platform
**Primary Languages**: JavaScript (Node + Browser), Solidity, Pug/SCSS

**Key Constraints**

- **Blockchain**: EVM-compatible — Hardhat local dev (`31415822`), Base Sepolia Testnet (`84532`). Chain IDs live in `constants/chains.js`.
- **Wallets**: EOA (MetaMask/Rabby) on all chains via SIWE; email login (OTP, no social) via CDP Embedded Wallets smart accounts — **Base Sepolia only** (`smart-wallet-support.js`)
- **IPFS**: Private Dockerized Kubo node for local dev/E2E; Pinata backend for public testnet
- **Hardhat**: Runs inside a Docker container (reproducible local EVM)
- **3D Generation**: Mock adapter for dev/test (`mock-gltf-assets/intro.gltf`, `mock-gltf-assets/suka.gltf`, `mock-gltf-assets/suka.glb`, `mock-gltf-assets/howdy.glb`, `mock-gltf-assets/triangle.glb`)
- **Parametric Versions**: Color + scale edits append new history entries client-side — no cloud generation
- **Runtime Cache**: Browser IPFS reads use on-demand memory + IndexedDB — no prefetching unless explicitly requested
- **Collections**: Every published token points to a collection manifest that maps `assetID`s to asset manifest CIDs
- **Editor Authorization**: Off-chain Merkle editor lists; the contract stores only a Merkle root and version
- **Token Discovery**: The asset library loads owned tokens from `GET /api/v1/indexer/owned` and editor-shared tokens from `GET /api/v1/indexer/shared`, both backed by the backend token indexer's chunked `eth_getLogs` backfill — not a genesis-walk in the browser

**Phase Status**: All phases 1–5.4 are complete (including Merkle editor proofs and collection manifests). Asset-level Nostr comments, CDP email-login smart accounts (on Base Sepolia), and the token indexer are also implemented. See `docs/CURRENT_STATUS.md` for the definitive snapshot.

---

## 2. Architecture Principles

### Client-Side First

**Default: logic belongs in the browser.** The Express backend is a thin gatekeeper. Before adding a server route, confirm at least one of these is true:

- [ ] Validates signatures, transactions, or session tokens
- [ ] Enforces a global rate limit or replay guard
- [ ] Accesses files/secrets that cannot be exposed to the browser (`.env`, compiled ABIs)
- [ ] Performs a cross-user or administrative action (unpin, admin config)

If none apply, implement it in the browser. See `docs/ARCHITECTURE.md §1.5` for the full client/server split table.

### Smart Contract Architecture

Two production contracts share `ArbeskAssetBase.sol` (abstract ERC-721 base with Merkle editor authorization + burn):

| Contract | File | Role | Limits |
|----------|------|------|--------|
| `ArbeskAssetFree` | `blockchain/contracts/ArbeskAssetFree.sol` | **Default** — free tier | 10 gen/day/wallet, ~5000 editors/token (safety net) |
| `ArbeskAsset` | `blockchain/contracts/ArbeskAsset.sol` | Paid tier — USDC PayGo | Unlimited paid gen, ~5000 editors/token (safety net) |

The contract stores per token:
- `tokenURI` → collection manifest CID
- `editorRoot` → Merkle root of the editor set
- `editorSetVersion` → monotonic version used in Merkle leaves

The full editor list lives on IPFS and is updated through `updateEditors(...)` with a Merkle proof.

**Rules:**
- `CONTRACT_ADDRESS` → `ArbeskAssetFree` (default); `PAID_CONTRACT_ADDRESS` → `ArbeskAsset`
- `create-panel.js` dispatches via `isFreeTierContract()` (from `frontend/src/js/blockchain/wallet-payments.js`, re-exported through `wallet.js`) — never hard-code the paid path in new generation UI code
- Use `CHAIN_IDS` from `constants/chains.js` — no magic numbers (`31415822`, `84532`). Per-chain `DEPLOYMENT_BLOCKS` and `LOG_CHUNK_SIZES` also live there for the token indexer.
- Contract `owner()` bypasses the free-tier daily generation quota in `recordGeneration()`; Merkle editor proof checks still apply (owner is not automatically an editor)
- **After any `.sol` change**: compile → deploy → sync root `.env` → `npm run test:frontend`. Stale ABIs cause `c.methods.X is not a function`.

---

## 3. Repository Layout

| What | Where |
|------|-------|
| Backend entry | `src/index.js` |
| API routes | `src/api/index.js` |
| Cloud generation route | `src/api/assets/generate-node.js` |
| Storage backends | `src/api/storage/index.js` (adapters: `kubo-adapter.js`, `pinata-adapter.js`) |
| Auth middleware | `src/api/authentication.js` |
| Session store | `src/api/sessions.js` |
| SIWE verification | `src/api/siwe-verify.js` |
| CDP Paymaster proxy | `src/api/routes/paymaster.js` |
| Token indexer | `src/api/token-indexer.js` (chunked `eth_getLogs` ownership backfill) |
| Rate limiter | `src/api/rate-limiter.js` |
| ABI serving | `src/api/abi-router.js` |
| Asset access checks | `src/api/authorization.js` |
| Comments archive | `src/api/comments-archive.js` |
| Chat proxy (WebSocket) | `src/api/chat-proxy.js` |
| Nostr relay primitives | `src/api/nostr-relay.js` |
| Route modules | `src/api/routes/` (`comments.js`, `ipfs.js`, `contracts.js`, `indexer.js`, `openapi.js`, `test-utils.js`) |
| Manifest utilities | `src/api/manifest-utils.js` |
| IPFS utilities | `src/api/ipfs-utils.js` |
| OpenAPI spec | `src/api/openapi.json` |
| 3D engine | `frontend/src/js/engine/` |
| Parametric preview | `frontend/src/js/engine/parametric-preview.js` |
| Wallet / chain | `frontend/src/js/blockchain/` |
| Wallet core (auto-restore / connect / state for CDP, EOA, and WalletConnect) | `frontend/src/js/blockchain/wallet-core.js` |
| CDP email login (OTP + smart account + EIP-1193 shim) | `frontend/src/js/blockchain/wallet-cdp.js` |
| Smart-wallet chain gating | `frontend/src/js/blockchain/smart-wallet-support.js` |
| Per-network config | `frontend/src/js/blockchain/network-config.js` |
| Token resolver | `frontend/src/js/blockchain/token-resolver.js` |
| CDP email OTP modal | `frontend/src/js/ui/wallet-modal.js` |
| Header wallet button (CDP email display; hides network selector) | `frontend/src/js/ui/header-wallet-button.js` |
| IPFS read/write | `frontend/src/js/ipfs/` |
| glTF pipeline | `frontend/src/js/gltf/` |
| Asset library (gallery) | `frontend/src/js/ui/asset-library.js` (owned + shared tokens, collection expansion, inaccessible-token cards with Burn) |
| Standalone Library page | `frontend/src/pug/library.pug` → `frontend/dist/library.html` |
| Library page bootstrap | `frontend/src/js/library-init.js` |
| Library grid / toolbar / context menu | `frontend/src/js/ui/library-grid.js`, `library-toolbar.js`, `library-context-menu.js` |
| Optimistic collection-create flow | `frontend/src/js/ui/library-create.js` (shared by EOA + CDP email login) |
| Library operations | `frontend/src/js/services/library-ops.js` (create collection, upload file) |
| Library state / item helpers | `frontend/src/js/state/library-state.js`, `frontend/src/js/utils/library-items.js` |
| Asset save/publish | `frontend/src/js/ui/asset-save.js` |
| Save/publish helpers | `frontend/src/js/services/asset-save/` (`manifest-builder.js`, `collection-publish.js`, `editor-publish.js`) |
| Comments panel | `frontend/src/js/ui/comments-panel.js` |
| Comment thread state | `frontend/src/js/state/comment-thread.js` |
| Create panel | `frontend/src/js/ui/create-panel.js` |
| Activity panel | `frontend/src/js/ui/ledger-panel.js` |
| Team / editor service | `frontend/src/js/services/team.js` |
| Asset delete service | `frontend/src/js/services/asset-delete.js` |
| API service layer | `frontend/src/js/services/api.js` |
| Merkle editor library | `frontend/src/js/gltf/merkle-editors.js` |
| Smart contracts | `blockchain/contracts/` |
| Frontend templates | `frontend/src/pug/` |
| Frontend styles | `frontend/src/scss/` |
| Build scripts | `frontend/scripts/` |

---

## 4. Build & Development Commands

```bash
# ─── Infrastructure ───
./scripts/start-dev.sh                        # local IPFS + Hardhat + Nostr + backend  (UI testing)
./scripts/start-dev.sh --setup-only           # local IPFS + Hardhat + Nostr, no backend (E2E testing)
./scripts/start-dev.sh --testnet              # public testnet + Pinata + local Nostr
docker compose up -d                          # lower-level: start IPFS + Hardhat + Nostr relay
docker compose down
docker compose logs -f ipfs                   # or: hardhat, nostr

# ─── Dependencies ───
npm install && cd frontend && npm install && cd ..
# blockchain deps live inside the Hardhat container; for host-side IDE intellisense only:
cd blockchain && npm install && cd ..

# ─── Frontend ───
npm run build:frontend                        # Pug→HTML, SCSS→CSS, JS+assets copy

# ─── Backend ───
npm start                                     # port 9090
npm run nodemon                               # with auto-rebuild

# ─── Testing ───
npm test                                      # Jest unit tests (excludes Hardhat & E2E)
npm run test:all                              # full suite: lint → typecheck → frontend → api → contracts
npm run test:api                              # Jest on test/api.test.js alone
npm run test:frontend                         # Jest on test/frontend/ + deployment integrity
npm run test:contracts                        # Hardhat tests inside Docker container
npm run test:e2e -- --project=chromium        # Playwright E2E critical path
npm run test:e2e:ui -- --project=chromium     # Playwright E2E with visible browser for debugging
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js --runInBand --silent
docker compose run --rm hardhat npx hardhat test

# ─── Contract workflow (MANDATORY after any .sol change) ───
docker compose run --rm hardhat npx hardhat compile
docker compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat
grep -E "CONTRACT_ADDRESS|PAID_CONTRACT_ADDRESS|BASE_CONTRACT_ADDRESS" blockchain/.env   # copy to root .env
npm run test:frontend                         # always verify last

# ─── Deploy to testnet ───
docker compose run --rm hardhat npx hardhat run scripts/deploy.js --network baseSepolia

# ─── Hardhat shell ───
docker compose run --rm hardhat sh
```

---

## 5. Coding Conventions

### JavaScript
- **Modules**: ES modules (`import`/`export`) in root + frontend; CommonJS (`require`) in `blockchain/scripts/` only
- **Frontend globals**: `BABYLON`, `Web3`, `window.web3`, `IpfsHttpClient` are CDN-loaded — don't import them
- **Naming**: camelCase variables/functions, PascalCase classes, UPPER_SNAKE module-level constants
- **Pure JavaScript source, TypeScript-powered checking**: Source files remain `.js`. TypeScript is used only as a static type-checking layer via `allowJs`/`checkJs` (`npm run typecheck`, `npm run typecheck:frontend`). Both `tsconfig.json` and `frontend/tsconfig.json` run with `strict: true`; new code must type-check under that setting. Add JSDoc when documenting new public functions; cast catch variables to `Error` when logging `.message`; files that are too dynamic to type cleanly can use `// @ts-nocheck` with a TODO. Ambient declarations for runtime/CDN globals live in `src/types/modules.d.ts` and `frontend/src/js/types/globals.d.ts`.
- **ESLint**: The project uses ESLint with `eslint.config.js`. Run `npm run lint` to check; `npm run lint:fix` to auto-fix. The gate is part of `npm run test:all`. Avoid unused imports/variables, prefer `const`, use `===`, and keep `var` out of new code.
- **Runtime validation**: API route bodies/params and manifest shapes are validated with Zod (`src/api/schemas.js`, `src/api/validation.js`). Add schemas for new route inputs; use `validateBody`/`validateParams`/`validateQuery` middleware. Existing endpoints return `VALIDATION_ERROR` (400) with structured `details.issues` on schema failure.
- **Pre-commit hooks**: Husky runs `lint-staged` (ESLint on staged JS files) and both TypeScript typechecks before every commit. First commit after clone/install may be slower while hooks install; after that only changed files are linted.

### CDN Script Tags — No SRI Hashes
Pug templates must **not** include `integrity="sha384-…"` attributes. CDNs silently rebuild assets, breaking SRI and blocking scripts entirely (symptom: `BABYLON.Engine is not a constructor`). Pin exact versions in the URL, omit `integrity`, keep `crossorigin="anonymous"`.

Current pinned versions live in `frontend/src/pug/studio.pug` — update intentionally, never silently.

### Solidity
- Version `^0.8.20`, OpenZeppelin v5 base; compiled with Solidity `0.8.24` (Cancun EVM)
- `require()` for validation, emit events for state changes, NatSpec (`@dev`, `@param`, `@return`)
- Optimize for storage reads over writes

### Pug / SCSS
- Build via custom Node.js scripts in `frontend/scripts/` (not Webpack/Vite)
- Pug templates in `frontend/src/pug/` (no `includes/` subdirectory)
- Bootstrap 5 with custom Sass overrides

### Backend Logging
All logs use `[TAG]` prefixes. Log start + outcome of every async operation; include CID / txHash / nodeId.

| Tag | Meaning |
|-----|---------|
| `[BOOT]` | Server startup |
| `[OK]` / `[ERR]` | Request success / failure |
| `[IPFS]` | IPFS add/cat |
| `[SAVE]` | Manifest save |
| `[CHAIN]` | Manifest chain walk |
| `[GEN]` | Asset generation |
| `[PARAM]` | Parametric version |
| `[AUTH]` | Authentication |
| `[ABI]` | ABI serving |
| `[TOKEN]` | Token child ref resolution |
| `[SESSION]` | Session auth |
| `[INDEXER]` / `[INDEXER-API]` | Token indexer backfill / `/indexer/owned` and `/indexer/shared` routes |
| `[UNPIN]` | IPFS unpin |
| `[BURN]` | Token burn |

Use `console.error()` for exceptions only; `console.log()` for operational flow.

### Viewport Resize Handling

The 3D viewport must never stretch during window resize or sidebar collapse/expand. The only reliable pattern is to resize the Babylon engine **inside `runRenderLoop`, immediately before `scene.render()`** — never throttle the render loop or resize synchronously inside the resize event handler. See `frontend/src/js/engine/scene-graph.js` for the current implementation, and the `babylon-3d-engine` skill's [Scene Lifecycle reference](.agents/skills/babylon-3d-engine/references/scene-lifecycle.md) for the full pattern and pitfalls.

---

## 6. Agent Decision-Making

When a task has **multiple valid implementation options**, follow this protocol:

1. **Enumerate all viable options** — list each with concise trade-offs (complexity, performance, maintenance, compatibility)
2. **Mark one (Recommended)** — based on existing conventions, simplicity, and long-term maintainability
3. **Wait for explicit user choice** — do not write code, modify files, or execute commands until the user has chosen

Applies to: architectural changes, library choices, UI patterns, refactoring strategies, deployment targets, algorithm/data-structure selections.

**Exceptions:** trivial naming/formatting, user-specified approach, single-viable-option emergencies.

---

## 7. Key Data Concepts

### Fractal Manifest
Every world is a content-addressed JSON manifest stored on IPFS. Each manifest links backward to the previous version via `prev_manifest_cid`, forming an immutable **manifest chain**. See `docs/ARCHITECTURE.md §4` for the full schema and chain mechanics.

**Golden Rules:**
1. The World is the Asset — no structural difference between object, scene, or universe
2. Fractal Nesting — assets recursively reference child manifests ("Dollhouse Architecture")
3. Temporal Isolation — time-travel any node without re-rendering neighbors
4. Parametric Coexistence — color/scale edits are first-class versions alongside AI-generated meshes

**Token Child Nodes (`child_ref`):**
- Each child world is referenced by `{ type, chainId, contractAddress, tokenId, standard, resolution }` — never a static manifest CID
- Every token child node **must** have a `transform_matrix` (identity matrix as default)
- Token child nodes have **no** local `history` array — history lives in the referenced token's manifest
- `MAX_CHILD_WORLD_DEPTH = 5`; cycle protection enforced in `scene-graph.js`

**Collection Manifests:**
- Every published token's `tokenURI()` resolves to a collection manifest (`type: "collection"`)
- The collection manifest contains an `assets` map: `{ assetID: assetManifestCid }`
- Default collection token ID is deterministically derived from the wallet address; named collections derive from `keccak256(address, name)`
- Gallery expands collection tokens into one card per `assets` entry
- Publishing an asset update writes a new collection manifest and calls `updateAssetURI()`; no remint occurs

**Thumbnail:** best-effort publish metadata — all code must tolerate missing thumbnails.

**Comments Archive (`comments_archive_cid`):**
- Comments are scoped to an **asset**, not the whole collection. The canonical Nostr tag is `<chainId>:<contractAddress>:<tokenId>:<assetId>`.
- Republishing an existing asset snapshots that asset's Nostr thread to a JSON archive on IPFS and stores the archive CID in the asset manifest.
- The archive is created by `src/api/comments-archive.js` via `POST /api/v1/assets/snapshot-comments` (requires `assetId` in the request body).
- First-time publishes have no prior comments and therefore no archive CID.
- On token burn, the archive CID is unpinned alongside the manifest chain.
- The frontend loads the archive before subscribing to live relay events and deduplicates by `event.id`.

### glTF Buffer URI Format
```
IPFS storage:  "uri": "ipfs://bafy..."
Render time:   "uri": "data:application/octet-stream;base64,Z2xC..."
```
The `frontend/src/js/gltf/` composer/decomposer handles this transform — don't bypass it.

---

## 8. Session Authentication

- Header: `Authorization: Session <token>` (not Bearer)
- `POST /api/v1/generations`, `POST /api/v1/ipfs/upload-url`, `POST /api/v1/ipfs/unpin`, and `POST /api/v1/assets/snapshot-comments` all require a valid session
- The WebSocket chat proxy (`/api/v1/chat/ws`) receives the session token in the query string
- **Single session creation path** — SIWE for all users — issuing an opaque token (24 h TTL, bound to wallet address):
  - **EOA (MetaMask/Rabby):** `POST /api/v1/sessions { message, signature }` — standard SIWE flow (`siwe-verify.js`)
  - **CDP email login:** `POST /api/v1/sessions { message, signature, eoaAddress }` — the embedded EOA signs the SIWE message; `message.address` is the smart account address; `eoaAddress` triggers fallback verification in `siwe-verify.js`
- `authentication.js` validates the issued token regardless of wallet type
- Auto-cleared on wallet disconnect; entry point: `getOrCreateSession()` in `frontend/src/js/services/api.js`
- **Auto-restore on page load applies to CDP, EOA, and WalletConnect wallets** when their underlying session/provider is still available. If no prior session is found, the user must explicitly click Login/Signup.

Full auth flow: `docs/API_SPEC.md § Authentication`.

---

## 9. Security Notes

- **Never commit `.env` files** — they contain private keys and API keys
- **API routes**: always validate `req.body` and `req.params`
- **Smart contracts**: use `ReentrancyGuard` for any function that transfers value
- **IPFS**: private node is loopback-only — do not expose ports beyond `127.0.0.1`
- **Hardhat**: local network at `8545` is for development only
- **Mock mode**: never deploy mock adapters to production — gate strictly on `MOCK_3D_GENERATION`

---

## 10. Testing

| Type | Framework | Key files |
|------|-----------|-----------|
| Backend API | Jest + Supertest | `test/api.test.js` |
| Deployment integrity | Jest | `test/frontend/deployment-integrity.test.js` |
| Smart contracts | Hardhat | `blockchain/test/*.js` |
| E2E (Studio critical path) | Playwright | `e2e/specs/*.spec.js` |

**Unit / integration coverage: 1162 Jest tests across 88 suites (all passing).**

**E2E coverage (16 specs, 33 tests):** `01` wallet connect/SIWE · `02` free-tier generation + manifest · `03` save → publish → gallery · `04` parametric color version + time-travel slider · `05` republish existing token (`updateAssetURI`, no remint) · `06` nesting — link a token as a `child_ref` child world, then dive/ascend · `07` collection asset cards and material editor multi-primitive · `08` fork vs live reference · `09` library basics · `10` library asset actions · `11` library ↔ Studio round-trip · `12` library create collection + upload · `13` editor collaboration (Merkle proofs) · `14` collaborative comments across owner/editor · `15` asset-level comment isolation · `99` viewport resize regression. The suite runs with **4 parallel workers by default** (each worker gets an isolated stack); override with `E2E_WORKERS=N`. Per-spec contract: `e2e/README.md`.

Opt-in E2E coverage is collected via Chromium V8 and merged with Jest coverage:
- `npm run test:e2e:coverage` — run E2E with coverage
- `npm run test:coverage:all` — merged Jest + E2E report

### Running tests

```bash
# Unit / API / contract tests
npm test

# E2E critical path (wallet → generate → save → publish)
npx playwright test --config=e2e/playwright.config.js --project=chromium

# E2E with visible browser for debugging
npx playwright test --config=e2e/playwright.config.js --project=chromium --ui

# Create an isolated worktree pre-seeded for the full test stack
npm run worktree:create -- feature-xyz
```

`jest.config.js` excludes `/e2e/` so Playwright specs are not picked up by `npm test`.

E2E is isolated per git worktree: each checkout gets its own Docker Compose project, backend port, and state file. The main checkout continues to use `127.0.0.1:9090`; linked worktrees use a deterministic port in the `30000–40000` range. Use `scripts/create-worktree.sh` (or `npm run worktree:create`) to create a ready-to-test worktree; see the `arbesk-worktree` skill and `e2e/README.md § Git worktrees` for the full workflow and port-conflict resolution.

### When to run E2E tests

**Run the E2E suite before merging any change that touches:**

- Studio UI/UX (headerbar, chat, prompt input, dialogs, wallet controls, settings)
- Wallet integration (`wallet.js`, `wallet-core.js`, `wallet-connect.js`, `wallet-discovery.js`, `wallet-cdp.js`, `smart-wallet-support.js`, `network-config.js`, `siwe.js`, session auth)
- Generation flow (`create-panel.js`, generation API, transaction validation, mock adapter, provider/tier selection)
- Save/publish/republish logic (`asset-save.js`, `dialog.js`, manifest versioning, thumbnail capture, `updateAssetURI`)
- Parametric editing + version history (`parametric-preview.js`, `version-history-store.js`, `version-clock.js`, `scene-clock.js`, `model-clock.js`)
- Nesting / linked child worlds (`nesting.js`, `scene-graph.js` linked-asset handling, token resolver, `child_ref` / `transform_matrix`)
- Smart contracts, ABI, or deployment scripts
- Manifest schema (`scene.nodes`, `source_asset`, `child_ref`, `transform_matrix`, `prev_asset_manifest_cid`, `thumbnail`, `comments_archive_cid`)
- IPFS storage format or CID handling
- Asset-level comments (`comments-panel.js`, `comment-thread.js`, chat proxy, comments archive)

`npm test` is **not enough** for these areas. The E2E specs are the only automated coverage that validates the full browser → wallet → backend → blockchain → IPFS chain.

### Keeping E2E tests in sync with UI changes

The E2E specs depend on a stable selector map and a known user flow. See `e2e/README.md` for the full contract, and the `edit-ui` skill's [E2E Sync guide](.agents/skills/edit-ui/references/e2e-sync.md) for the UI-area → spec → selector map.

**If you change the UI, you must:**

1. Update `e2e/helpers/studio-selectors.mjs` when any referenced `id`, class, or button label changes.
2. Update the spec assertions when chat/status text, dialog titles, or flow order changes.
3. Update `e2e/helpers/manifest.mjs` when the manifest schema or version semantics change.
4. Add or remove test steps when the save/publish flow gains or loses dialogs/confirmations.

**After any `.sol` change:** run the contract workflow from §4, then also run the E2E suite (`npx playwright test --config=e2e/playwright.config.js --project=chromium`) — stale ABIs cause `c.methods.X is not a function`; stale contract addresses cause free-tier generation to fail with "Payment validation failed".

---

## 11. Infrastructure (Ports Reference)

| Service | API | Gateway / RPC | Notes |
|---------|-----|---------------|-------|
| Private IPFS (Kubo) | `127.0.0.1:5001` | `127.0.0.1:8080` | No DHT, no bootstrap, loopback swarm |
| Hardhat local EVM | — | `127.0.0.1:8545` | Docker container, `./blockchain` volume-mounted |
| Local Nostr relay | — | `ws://127.0.0.1:7777` | `scsibug/nostr-rs-relay`, SQLite-backed, dev-only |
| Base Sepolia Testnet | — | `https://sepolia.base.org` (backend direct); `https://base-sepolia-rpc.publicnode.com` (CDP smart-wallet browser passthrough) | Testnet (EOA + CDP email login smart accounts) |

Full container config: `docker-compose.yml`, `docker/Dockerfile`, `docker/hardhat.Dockerfile`, `docker/nostr-relay.toml`.

---

## 12. Environment Files

Three `.env` files — all gitignored, **never commit**:

| File | Purpose | Bootstrap |
|------|---------|-----------|
| `blockchain/.env` | Hardhat scripts (keys, contract addresses, RPC) | `cp blockchain/.env.example blockchain/.env` |
| `.env` (root) | Backend + cloud adapters. `CONTRACT_ADDRESS` + `PAID_CONTRACT_ADDRESS` must match `blockchain/.env` post-deploy | Copy from `.env.example` + set values |
| `frontend/.env` | Build-time public vars (optional, not currently used) | — |

Key backend variables (root `.env`): `CDP_PROJECT_ID` (served to frontend via `/api/v1/config` as `cdpProjectId`), `CDP_PAYMASTER_URL` (secret — used only by `src/api/routes/paymaster.js`), `CDP_EMAIL_DEV_MODE` (placeholder for future E2E mock bypass). Removed: `THIRDWEB_CLIENT_ID`, `THIRDWEB_SECRET_KEY`, `THIRDWB_AUTH_DEV_MODE`.

Full variable reference: `docs/CURRENT_STATUS.md §8`.

---

## 13. EVM Deployment Targets

| Environment | Network | RPC | Hardhat network name |
|-------------|---------|-----|----------------------|
| Local dev | Hardhat (Docker) | `http://127.0.0.1:8545` | `hardhat` |
| Testnet (EOA + CDP email login) | Base Sepolia Testnet | `https://sepolia.base.org` | `baseSepolia` |

Base Sepolia uses ETH for gas. CDP email-login smart accounts are supported on Base Sepolia only; gas is sponsored by the CDP Paymaster (`CDP_PAYMASTER_URL`, proxied by `src/api/routes/paymaster.js`).

---

## 14. Zed AI Agent Setup

| File | Purpose |
|------|---------|
| `.zed/tasks.json` | Repeatable Zed tasks for install/build/test/Docker/backend |
| `.zed/settings.json` | Excludes heavy/generated folders from Zed project scanning |
| `docs/ZED_AGENT_GUIDE.md` | Zed-specific onboarding |
| `docs/CURRENT_STATUS.md` | Definitive implementation snapshot — check before making roadmap claims |

---

## 15. Worktree Testing & Isolation

For tasks that require a clean, isolated test environment — or when the main checkout's Docker containers/ports are already in use — use a git worktree:

```bash
npm run worktree:create -- feature-xyz
```

This seeds `.worktrees/feature-xyz` with current changes, env files, a built frontend, and compiled contracts, and forces `IPFS_BACKEND=kubo` for local E2E.

See the `arbesk-worktree` skill for the full workflow (running tests inside the worktree, cleanup steps, troubleshooting) and file map.

---

## 16. CDP Email Wallet (Base Sepolia)

Email-login smart accounts are implemented via the `@coinbase/cdp-core` SDK (`frontend/src/js/blockchain/wallet-cdp.js`). They are intentionally supported on **Base Sepolia only**; EOA wallets (MetaMask/Rabby) handle all other chains. Required env: `CDP_PROJECT_ID` and `CDP_PAYMASTER_URL` (root `.env`).

See the `cdp-base-wallet` skill for the full architecture diagram, required CDP Portal configuration, implementation rules, troubleshooting table, and key file map.

---

## 17. Contact & Links

- **Repository**: https://github.com/ahmadsayed/arbesk (private — always use the `gh` CLI for issue/PR access; public `https://` fetches return 404)
- **Docs**: `docs/` directory in this repo
