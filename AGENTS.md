# AGENTS.md — Arbesk Developer Guide

Conventions and practical guidance for AI agents and developers.

> Deep reference: `docs/ARCHITECTURE.md` · `docs/CURRENT_STATUS.md` (definitive status snapshot — check before roadmap claims) · `docs/API_SPEC.md` · `CLAUDE.md`
> Project skills (`.agents/skills/`): glTF pipeline, IPFS storage, worktrees, Babylon engine, CDP wallet, UI editing, HIG audit, Solidity, asset inspection — read the relevant skill before working in its area.

---

## 1. Project Identity

**Arbesk** — cloud-native 4D fractal version-controlled 3D asset platform. JavaScript (Node + browser), Solidity, Pug/SCSS. All phases 1–5.4 complete (see `docs/CURRENT_STATUS.md`).

**Key Constraints**

- **Chains**: Hardhat local dev + Base Sepolia testnet. IDs, `DEPLOYMENT_BLOCKS`, `LOG_CHUNK_SIZES` in `constants/chains.js` — no magic numbers.
- **Wallets**: EOA (MetaMask/Rabby) via SIWE on all chains; CDP email-login (OTP) smart accounts on **Base Sepolia only** (`smart-wallet-support.js`).
- **IPFS**: private Dockerized Kubo for local/E2E; Pinata for testnet. **Hardhat**: runs inside Docker.
- **3D generation**: mock adapter for dev/test, samples in `mock-gltf-assets/` (prompt keyword `3mf` → 3MF sample).
- Generation results land as chat bubbles with live orbitable 3D preview (`chat-preview.js`, max 3 live, render-on-visibility); Studio scene untouched until "Show in Studio".
- Parametric color/scale edits append history entries client-side — no cloud generation.
- Collections: every published token's `tokenURI` → collection manifest mapping `assetID` → asset manifest CID.
- Editor authorization: off-chain Merkle editor lists; contract stores only root + version.
- Token discovery via backend indexer (`GET /api/v1/indexer/owned|shared`, chunked `eth_getLogs` backfill) — never a browser genesis-walk.
- Browser IPFS reads: on-demand memory + IndexedDB cache — no prefetching unless explicitly requested.

---

## 2. Architecture Principles

### Client-Side First
**Default: logic belongs in the browser.** The Express backend is a thin gatekeeper. Add a server route only if it: validates signatures/transactions/session tokens, enforces a global rate limit or replay guard, accesses secrets the browser can't see (`.env`, compiled ABIs), or performs a cross-user/admin action. Full split: `docs/ARCHITECTURE.md §1.5`.

### Smart Contracts
`ArbeskAssetFree` (`CONTRACT_ADDRESS`, **default** — 10 gen/day/wallet) and `ArbeskAsset` (`PAID_CONTRACT_ADDRESS` — USDC PayGo) share `ArbeskAssetBase.sol` (ERC-721 + Merkle editor auth + burn). 5000 editors/token, client-enforced in `merkle-editors.js`.

Per token on-chain: `tokenURI` → collection manifest CID · `editorRoot` · `editorSetVersion`. Full editor list lives on IPFS, updated via `updateEditors(...)` with a Merkle proof.

**Rules:**
- Generation UI goes through `wallet-payments.js` → `isFreeTierContract()` — never hard-code the paid path.
- Contract `owner()` bypasses the free-tier daily quota; Merkle editor checks still apply (owner ≠ editor).
- **After any `.sol` change**: compile → deploy → sync root `.env` → `npm run test:frontend` (+ E2E). Stale ABIs cause `c.methods.X is not a function`.

---

## 3. Repository Layout (key entries)

- **Backend** (`src/api/`): routes `index.js` + `routes/` · generation `assets/generate-node.js`, `generation-tasks.js`, `adapters/tripo3d-adapter.js` (upstream `refine_model` is dead — code 2006) · storage `storage/` (kubo/pinata adapters) · auth `authentication.js`, `sessions.js`, `siwe-verify.js` · `token-indexer.js` · `comments-archive.js` · `chat-proxy.js` (WebSocket) · `nostr-relay.js` · `manifest-utils.js` · `asset-tag.js` (canonical tag `<chainId>:<contract>:<tokenId>:<assetId>`) · `openapi.json`
- **Frontend** (`frontend/src/js/`): 3D `engine/` · wallet `blockchain/` (`wallet-core.js`, `wallet-cdp.js`, `smart-wallet-support.js`, `network-config.js`, `token-resolver.js`) · IPFS `ipfs/` · glTF `gltf/` (+ `merkle-editors.js`) · 3MF `3mf/` · UI `ui/` (asset-library, library-grid/toolbar/context-menu/create, asset-save, comments-panel, collaborators-panel, create-panel, chat-messages, wallet-modal, header-wallet-button) · services `services/` (api, team, chat-preview, library-ops, asset-delete, asset-save/) · state `state/` (library-state, comment-thread, pending-generations) · templates `frontend/src/pug/` · styles `frontend/src/scss/` · build scripts `frontend/scripts/`
- **Contracts** `blockchain/contracts/` · **Tests** `test/`, `blockchain/test/`, `e2e/`

---

## 4. Build & Development Commands

```bash
# ─── Infrastructure ───
./scripts/start-dev.sh                        # local IPFS + Hardhat + Nostr + backend  (UI testing)
./scripts/start-dev.sh --setup-only           # local IPFS + Hardhat + Nostr, no backend (E2E testing)
./scripts/start-dev.sh --testnet              # public testnet + Pinata + local Nostr
docker compose up -d                          # lower-level: start IPFS + Hardhat + Nostr relay
docker compose logs -f ipfs                   # or: hardhat, nostr

# ─── Dependencies ───
npm install && cd frontend && npm install && cd ..
cd blockchain && npm install && cd ..         # host-side IDE intellisense only (deps live in container)

# ─── Frontend / Backend ───
npm run build:frontend                        # Pug→HTML, SCSS→CSS, JS+assets copy
npm start                                     # backend, port 9090
npm run nodemon                               # with auto-rebuild

# ─── Testing ───
npm test                                      # Jest unit tests (excludes Hardhat & E2E)
npm run test:all                              # lint → typecheck → frontend → api → contracts
npm run test:api                              # Jest on test/api.test.js alone
npm run test:frontend                         # Jest on test/frontend/ + deployment integrity
npm run test:contracts                        # Hardhat tests inside Docker container
npm run test:e2e -- --project=chromium        # Playwright E2E critical path
npm run test:e2e:ui -- --project=chromium     # visible browser for debugging

# ─── Contract workflow (MANDATORY after any .sol change) ───
docker compose run --rm hardhat npx hardhat compile
docker compose up -d hardhat               # local node must be running (in-memory chain)
docker compose exec -T hardhat npx hardhat run scripts/deploy.js --network localhost
grep -E "CONTRACT_ADDRESS|PAID_CONTRACT_ADDRESS|BASE_CONTRACT_ADDRESS" blockchain/.env   # copy to root .env
npm run test:frontend                         # always verify last
# NOTE: always deploy with `--network localhost` against the running node —
# `--network hardhat` deploys to an ephemeral in-process chain that vanishes with the container.

# ─── Testnet deploy / Hardhat shell ───
docker compose run --rm hardhat npx hardhat run scripts/deploy.js --network baseSepolia
docker compose run --rm hardhat sh
```

---

## 5. Coding Conventions

### JavaScript
- **Modules**: ESM in root + frontend; CommonJS only in `blockchain/scripts/`.
- **CDN globals**: `BABYLON`, `Web3`, `window.web3`, `IpfsHttpClient` — never import them.
- **Naming**: camelCase vars/functions, PascalCase classes, UPPER_SNAKE module constants.
- **Type-checking**: `.js` source checked via `allowJs`/`checkJs`, `strict: true` (`npm run typecheck[:frontend]`). JSDoc on new public functions; cast catch vars to `Error` before logging `.message`; `// @ts-nocheck` + TODO only when unavoidable. Ambient globals: `src/types/modules.d.ts`, `frontend/src/js/types/globals.d.ts`.
- **ESLint**: `npm run lint[:fix]`; gate is part of `test:all`. Husky pre-commit runs lint-staged + both typechecks.
- **Validation**: Zod for API inputs and manifest shapes (`src/api/schemas.js`, `validation.js`); use `validateBody`/`validateQuery` middleware; failures return 400 `VALIDATION_ERROR` with `details.issues`.

### CDN Script Tags — No SRI Hashes
Pug templates must **not** include `integrity="sha384-…"` — CDNs silently rebuild assets, breaking SRI (symptom: `BABYLON.Engine is not a constructor`). Pin exact versions in the URL, omit `integrity`, keep `crossorigin="anonymous"`. Pins live in `frontend/src/pug/app.pug` and `frontend/src/js/engine/babylon-loader.js` (Babylon lazy-loads on first Studio entry).

### Solidity / Pug / SCSS
- Solidity `^0.8.20`, OpenZeppelin v5, compiled 0.8.24 (Cancun); `require()` validation, events for state changes, NatSpec; optimize storage reads over writes.
- Pug/SCSS built by custom Node scripts in `frontend/scripts/` — no Webpack/Vite. Custom SCSS design system (`scss/styles.scss` entry); no Bootstrap.

### Backend Logging
`[TAG]` prefixes: `[BOOT] [OK] [ERR] [IPFS] [SAVE] [CHAIN] [GEN] [PARAM] [AUTH] [ABI] [TOKEN] [SESSION] [INDEXER] [INDEXER-API] [UNPIN] [BURN] [USERS]`. Log start + outcome of every async op with CID/txHash/nodeId; `console.error` for exceptions only.

### Viewport Resize Handling
The 3D viewport must never stretch on resize/sidebar toggle. Resize the Babylon engine **inside `runRenderLoop`, immediately before `scene.render()`** — never in the resize event handler. Implementation: `engine/scene-graph.js`; pitfalls: babylon-3d-engine skill's Scene Lifecycle reference.

---

## 6. Agent Decision-Making

When a task has **multiple valid implementation options**:
1. **Enumerate all viable options** with concise trade-offs.
2. **Mark one (Recommended)** based on existing conventions and maintainability.
3. **Wait for explicit user choice** before writing code or running commands.

Applies to: architecture, library choices, UI patterns, refactoring strategies, deployment targets, algorithm/data-structure selection. Exceptions: trivial naming/formatting, user-specified approach, single-viable-option emergencies.

---

## 7. Key Data Concepts

### Fractal Manifest
Every world is a content-addressed JSON manifest on IPFS, chained backward via `prev_manifest_cid` (immutable manifest chain). Golden rules: the world is the asset · fractal nesting ("dollhouse") · temporal isolation · parametric edits are first-class versions. Full schema: `docs/ARCHITECTURE.md §4`.

- **`child_ref` token children**: `{ type, chainId, contractAddress, tokenId, standard, resolution }` — never a static CID. Always include `transform_matrix` (identity default); no local `history` (lives in the referenced token's manifest); `MAX_CHILD_WORLD_DEPTH = 5`, cycle protection in `scene-graph.js`.
- **Collections**: `tokenURI()` → `type: "collection"` manifest with `assets: { assetID: cid }`. Default token ID derived from wallet address; named collections from `keccak256(address, name)`. Gallery expands one card per `assets` entry. Updates write a new collection manifest + `updateAssetURI()` — no remint.
- **Thumbnails**: best-effort — all code must tolerate missing thumbnails.
- **Comments archive** (`comments_archive_cid`): comments are asset-scoped (Nostr tag `<chainId>:<contract>:<tokenId>:<assetId>`). Republish snapshots the asset's thread via `POST /api/v1/assets/snapshot-comments`; frontend loads the archive before live relay events and dedups by `event.id`; archive unpinned on burn.
- **glTF buffer URIs**: `ipfs://bafy...` in storage ↔ base64 data URI at render. Only the `frontend/src/js/gltf/` composer/decomposer performs this transform — don't bypass it.

---

## 8. Session Authentication

- Header: `Authorization: Session <token>` (not Bearer). Opaque token, 24 h TTL, wallet-bound; auto-cleared on disconnect; entry point `getOrCreateSession()` in `services/api.js`.
- **Single creation path** — SIWE via `POST /api/v1/sessions`: EOA sends `{ message, signature }`; CDP email login adds `eoaAddress` (embedded EOA signs; `message.address` is the smart account; `eoaAddress` triggers fallback verification in `siwe-verify.js`).
- Session required: `POST /generations`, `/ipfs/upload-url`, `/ipfs/unpin`, `/assets/snapshot-comments`, `/paymaster`, `/users/resolve-email`; WS chat proxy takes the token in the query string.
- `/ipfs/unpin` also verifies on-chain ownership (or editor Merkle proof) and that the CID belongs to that token's collection — frontend unpins **before** burning.
- Auto-restore on page load for CDP, EOA, and WalletConnect when the underlying session/provider survives.
- Full flow: `docs/API_SPEC.md § Authentication`.

---

## 9. Security Notes

Never commit `.env` files · validate all route bodies/params · `ReentrancyGuard` on any value transfer · IPFS node loopback-only · Hardhat 8545 is dev-only · mock adapters gated strictly on `MOCK_3D_GENERATION`, never in production.

---

## 10. Testing

| Type | Framework | Key files |
|------|-----------|-----------|
| Backend API | Jest + Supertest | `test/api.test.js` |
| Deployment integrity | Jest | `test/frontend/deployment-integrity.test.js` |
| Smart contracts | Hardhat | `blockchain/test/*.js` |
| E2E | Playwright | `e2e/specs/*.spec.js` |

~1264 Jest tests across 98 suites. E2E: 17 specs / 37 tests (`01` wallet/SIWE → `16` 3MF generation → publish, `99` viewport resize regression), 1 worker by default, `E2E_WORKERS=N` for parallel isolated stacks. Per-spec contract: `e2e/README.md`. Coverage: `npm run test:e2e:coverage`, `npm run test:coverage:all`. `jest.config.js` excludes `/e2e/`.

**Run E2E before merging changes to**: Studio UI/UX · wallet/session auth · generation flow · save/publish · parametric editing/version history · nesting/child worlds · contracts/ABI/deploy · manifest schema · IPFS format/CIDs · asset comments. `npm test` is **not enough** for these — E2E is the only coverage of the full browser → wallet → backend → blockchain → IPFS chain.

**UI changes must sync E2E**: update `e2e/helpers/studio-selectors.mjs` (selectors/labels), spec assertions (chat/status text, dialog titles, flow order), `e2e/helpers/manifest.mjs` (schema/version semantics), and add/remove steps as the save/publish flow changes. See `e2e/README.md` and the edit-ui skill's E2E Sync guide.

---

## 11. Infrastructure & Environment

| Service | API | Gateway / RPC |
|---------|-----|---------------|
| Private IPFS (Kubo) | `127.0.0.1:5001` | `127.0.0.1:8080` (loopback, no DHT) |
| Hardhat local EVM (Docker) | — | `127.0.0.1:8545` |
| Local Nostr relay | — | `ws://127.0.0.1:7777` |
| Base Sepolia | — | `https://sepolia.base.org` (backend); `https://base-sepolia-rpc.publicnode.com` (CDP browser passthrough) |

Backend on port 9090. Hardhat network names: `hardhat` (local), `baseSepolia` (testnet; ETH gas, CDP smart accounts sponsored via Paymaster proxy `src/api/routes/paymaster.js`).

Env files (gitignored, never commit): `blockchain/.env` (deploy keys/addresses — bootstrap from `.env.example`), root `.env` (backend; `CONTRACT_ADDRESS`/`PAID_CONTRACT_ADDRESS` must match `blockchain/.env` post-deploy; CDP keys: `CDP_PROJECT_ID`, `CDP_PAYMASTER_URL`, `CDP_API_KEY_ID`/`SECRET`; `INDEXER_DISABLE_TESTNET` kill-switch). Full reference: `docs/CURRENT_STATUS.md §8`. Ops: `scripts/run-ipfs-gc.mjs` (IPFS GC), `scripts/sync-deployed-addresses.mjs`.

---

## 12. Worktrees, CDP Wallet, Misc

- **Worktree isolation**: `npm run worktree:create -- feature-xyz` seeds `.worktrees/feature-xyz` with env files, built frontend, compiled contracts, own Docker stack + deterministic port (main checkout keeps 9090). Full workflow: arbesk-worktree skill, `e2e/README.md § Git worktrees`.
- **CDP email wallet**: `@coinbase/cdp-core` SDK in `wallet-cdp.js`, Base Sepolia only; full architecture/config/troubleshooting in the cdp-base-wallet skill.
- **Zed**: `.zed/tasks.json` (tasks), `.zed/settings.json` (scan excludes), `docs/ZED_AGENT_GUIDE.md`.
- **Repository**: https://github.com/ahmadsayed/arbesk (private — always use the `gh` CLI; public fetches 404).
