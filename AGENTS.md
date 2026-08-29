# AGENTS.md — Arbesk Developer Guide

Conventions for AI agents and developers. Deep reference (load on demand): `docs/ARCHITECTURE.md` · `docs/CURRENT_STATUS.md` (definitive status — check before roadmap claims) · `docs/API_SPEC.md`. Project skills in `.agents/skills/` — read the relevant one before working in its area.

The four shared SDKs under `packages/` are treated as **black boxes** here — consume them by bare specifier, don't reimplement their internals. Each has its own guide: `packages/asset-core/AGENTS.md` · `packages/wallet/AGENTS.md` · `packages/authz/AGENTS.md` · `packages/ai-asset-gen/AGENTS.md` (asset-core's consumer API is also in `docs/ASSET_CORE_SDK.md`).

## 1. Identity & Key Constraints

**Arbesk** — cloud-native 4D fractal version-controlled 3D asset platform. TypeScript backend (`src/`, Node type-stripping — no emit step; requires Node ≥ 22.18), JS browser frontend, Solidity, Pug/SCSS. See `docs/CURRENT_STATUS.md` for the definitive status.

- **Chains**: Hardhat local + Base Sepolia. IDs, `DEPLOYMENT_BLOCKS`, `LOG_CHUNK_SIZES` in `constants/chains.js` — no magic numbers.
- **Wallets**: EOA (MetaMask/Rabby) via SIWE everywhere; CDP email-login smart accounts on **Base Sepolia only** (`smart-wallet-support.ts`).
- **IPFS**: private Docker Kubo local/E2E; Pinata testnet. Hardhat runs in Docker.
- **3D generation**: mock adapter for dev/test, samples in `mock-gltf-assets/` (prompt keyword `3mf` → 3MF sample). Tripo3D **v3** adapter (`@arbesk/ai-asset-gen`, BYOK): text-to-3D, image-to-3D (JPEG/PNG/WebP attach in the create panel — fresh model; multi-select up to 4 views → multiview-to-model, chips carry swappable Front/Left/Back/Right badges, `ui/attach-views.ts`, wire field `images[]`, manifest `reference_images`), texture-only retexture, smart retopology (`mesh/decimate` v2.0, GLB output), and rig & animate (rig endpoint model `TRIPO_3D_RIG_MODEL`, default `v2.5-20260210`; bipeds try `TRIPO_3D_RIG_BIPED_MODEL` (`v1.0-20240301`) first with automatic fallback on code 1004, and v1.0 rigs map retarget presets to `preset:biped:*`; Animate dialog has an "In place" toggle (`animate_in_place`), default on, and a categorized preset picker — Basics/Combat/Reactions/Emotes/Daily Life: the 11 generic v2.5 presets plus 16 curated `preset:biped:*` ones (biped-only presets get a clear 400 on a known generic rig)). Results land as version-card chat bubbles with a live orbitable preview (`chat-preview.ts`, max 3) and a 4-button action row (Retexture · Retopo · Auto-rig · Animate…). Follow-ups reference the bubble's GLB via `sourceAssetCid` — the backend uploads it to Tripo `POST /files` → `file_token`, so bubbles stay actionable indefinitely (no registry expiry; retarget-only still needs the original rig task internally). glTF JSON sources are composed to GLB before upload; non-glTF sources are rejected with 400 `SOURCE_ASSET_UNSUPPORTED_FORMAT` (rig-check is GLB-only upstream) and bubbles with a known non-glTF `format` get no action row (`generation-actions.ts`). Panel texture-quality selector (standard/detailed/extreme). Typed follow-up prompts retexture the active version (`#refineIndicator` chip). History entries restore versions on click; a bubble's "Show in Studio" button is the only way its model enters the Studio (the preview is orbit-only) and stays live after sending — re-clicking restores that version. Show in Studio auto-saves a draft (publish stays manual), and Tripo3D history versions get the same action row (no backendTaskId survives — animate takes the full GLB chain). Viewport file drops and Library uploads also post a version-card bubble (`ASSET_FILE_STAGED` → `presentUploadedModel`, provider `"upload"`) with the same action row — follow-ups run off the staged `sourceAssetCid`; drop bubbles disable "Show in Studio" (the model is already in the viewport). Opening a pre-existing asset posts the same bubble for its root model (`presentOpenedAssetModel`, skipped when live session bubbles exist or the tip manifest carries provenance), so old assets stay retopo-able. Provider debugging/integration reference: **tripo3d-expert** skill.
- Parametric color/scale edits are applied client-side — no cloud regeneration.
- Collections: token `tokenURI` → collection manifest mapping `assetID` → asset manifest CID.
- Editor auth: off-chain Merkle editor lists; contract stores only root + version.
- Token discovery via backend indexer (`GET /api/v1/indexer/owned|shared`) — never a browser genesis-walk.
- Browser IPFS reads: on-demand memory + IndexedDB cache — no prefetching.

## 2. Architecture Principles

**Client-side first** — logic belongs in the browser; the Express backend is a thin gatekeeper. Add a server route only to: validate signatures/transactions/sessions, enforce global rate limits/replay guards, access browser-invisible secrets, or perform cross-user/admin actions (`docs/ARCHITECTURE.md §1.5`).

**Contracts**: `ArbeskAssetFree` (`CONTRACT_ADDRESS`, **default**, 10 gen/day/wallet) and `ArbeskAsset` (`PAID_CONTRACT_ADDRESS`, USDC PayGo) share `ArbeskAssetBase.sol` (ERC-721 + Merkle editor auth + burn). Max 5000 editors/token, client-enforced (`merkle-editors.ts`). Generation UI goes through `wallet-payments.ts` → `isFreeTierContract()` — never hard-code the paid path. Contract `owner()` bypasses the free-tier quota; Merkle editor checks still apply (owner ≠ editor). **After any `.sol` change**: compile → deploy → sync root `.env` → `npm run test:frontend` (+ E2E). Stale ABIs cause `c.methods.X is not a function`.

## 3. Repo Layout

- **Backend** `src/api/` (all `.ts`): routes `index.ts` + `routes/` · generation (`assets/generate-node.ts`, `generation-tasks.ts`) · storage `storage/` (kubo/pinata) · auth `authentication.ts`, `sessions.ts`, `identity.ts` · `token-indexer.ts` · `comments-archive.ts` · `chat-proxy.ts` (WS) · `nostr-relay.ts` · `manifest-utils.ts` · `asset-tag.ts` (canonical tag `<chainId>:<contract>:<tokenId>:<assetId>`) · `openapi.json`
- **SDK packages** `packages/*` (npm workspaces; compiled by tsc to `dist/` ESM + `.d.ts`; consumed by bare specifier) — treated as **black boxes**: import their public API, don't reach into internals. Internals + boundary rules live in each package's own guide:
  - `@arbesk/asset-core` (`packages/asset-core/`) — asset engine: manifests, glTF/3MF compose/decompose, domain state, editor lists. See `packages/asset-core/AGENTS.md` + `docs/ASSET_CORE_SDK.md`.
  - `@arbesk/wallet` (`packages/wallet/`) — wallet/identity/chain: `Signer` port, SIWE, Merkle proofs, contract writes, session store. See `packages/wallet/AGENTS.md`.
  - `@arbesk/authz` (`packages/authz/`) — asset access policy (ownership + Merkle editor proof). See `packages/authz/AGENTS.md`.
  - `@arbesk/ai-asset-gen` (`packages/ai-asset-gen/`) — 3D-model generation (mock + Tripo3D), capability-gated facade. Backend-only. See `packages/ai-asset-gen/AGENTS.md`.
- **Frontend** `frontend/src/js/`: 3D `engine/` · wallet `blockchain/` (wallet-core, wallet-cdp, smart-wallet-support, network-config, token-resolver, `asset-core-adapter.ts` browser Hash/Storage/Chain ports) · `ipfs/` · `asset-core-init.ts` (frontend composition root — `initAssetCoreBrowser()`) · `workers/` (gltf worker pool, `worker-executor.ts` browser ExecutorPort) · `ui/` (asset-library, comments/collaborators/create panels, chat-messages, wallet-modal, header-wallet-button) · `services/` (api, team, chat-preview, library-ops, asset-delete, asset-save/) · `state/` · templates `frontend/src/pug/` · styles `frontend/src/scss/`
- **Contracts** `blockchain/contracts/` · **Tests** `test/`, `blockchain/test/`, `e2e/`

## 4. Commands

```bash
# Infrastructure
./scripts/start-dev.sh                 # IPFS + Hardhat + Nostr + backend (UI testing)
./scripts/start-dev.sh --setup-only    # infra only, no backend (E2E)
./scripts/start-dev.sh --testnet       # Base Sepolia + Pinata + local Nostr
docker compose up -d                   # IPFS + Hardhat + Nostr; logs: docker compose logs -f ipfs

# Dependencies
npm install && (cd frontend && npm install)   # + (cd blockchain && npm install) — IDE intellisense only

# Frontend / Backend
npm run build:frontend                 # Pug→HTML, SCSS→CSS, JS copy + swc TS emit (no Webpack/Vite)
npm start                              # backend :9090;  npm run nodemon = auto-rebuild

# Testing
npm test                               # Jest unit (excludes Hardhat & E2E)
npm run test:all                       # lint → typecheck → frontend → api → contracts
npm run test:api                       # test/api.test.js alone
npm run test:frontend                  # test/frontend/ + deployment integrity
npm run test:contracts                 # Hardhat tests in Docker
npm run bench:asset-core               # asset-core pipeline benchmark → test-results/asset-core-bench.json
npm run test:e2e -- --project=chromium # Playwright critical path (:ui = visible browser)

# Contract workflow — MANDATORY after any .sol change
docker compose run --rm hardhat npx hardhat compile
docker compose up -d hardhat
docker compose exec -T hardhat npx hardhat run scripts/deploy.js --network localhost
grep -E "CONTRACT_ADDRESS|PAID_CONTRACT_ADDRESS|BASE_CONTRACT_ADDRESS" blockchain/.env  # copy to root .env
npm run test:frontend                  # always verify last
# Always deploy with --network localhost against the running node —
# --network hardhat deploys to an ephemeral chain that vanishes with the container.
```

## 5. Coding Conventions

- **Out-of-the-box first**: always prefer the library/framework's built-in feature (Babylon, Zod, Alpine, Express…) over hand-rolled code. Hand-roll only when the built-in genuinely cannot do the job — verify that against the library's source/docs first, and leave a comment recording why the custom path is necessary. (Lesson from the ortho-camera saga: custom input/projection code doubles the test surface and hides state the framework can't see.)
- **JS/TS**: backend `src/` is TypeScript run via Node type-stripping (`node src/index.ts`, no build step) — erasable syntax only (`erasableSyntaxOnly`: no enums/namespaces/parameter properties), type-only imports MUST use `import type` (eslint-enforced; Node does not elide imports), and relative imports inside `src/` carry explicit `.ts` extensions. The **entire frontend `frontend/src/js/` is TypeScript** (only `vendor/` stays plain JS), transpiled per-file by swc into `dist/js` (`frontend/scripts/render-ts.js`, no type-aware emit) — **import specifiers always match the on-disk file** (`.ts` for frontend/backend modules, `.js` only for plain-JS files like `constants/chains.js` and `vendor/`; the emit step rewrites relative `.ts` specifiers to `.js` for the browser, and jest maps `.js`→source via `moduleNameMapper`). SDK packages are consumed by bare specifier as workspace packages (`@arbesk/asset-core`, `@arbesk/wallet`, `@arbesk/authz`; subpaths end in `.js`, e.g. `@arbesk/asset-core/formats/gltf/gltf-core.js`) — treat them as black boxes, see `packages/*/AGENTS.md`. CJS only in `blockchain/scripts/` + `frontend/scripts/` + `e2e/`. CDN globals `BABYLON`, `IpfsHttpClient` — never import. camelCase vars/functions, PascalCase classes, UPPER_SNAKE module constants.
- **Type-checking**: `allowJs`/`checkJs`, `strict: true` (`npm run typecheck[:frontend]`). JSDoc on new public functions; cast catch vars to `Error` before logging; `// @ts-nocheck` + TODO only when unavoidable. Ambient globals: `src/types/modules.d.ts`, `frontend/src/js/types/globals.d.ts`.
- **LSP tools (cclsp MCP)**: if `mcp__cclsp__*` tools are available (user-level `~/.kimi-code/mcp.json`, TypeScript via `typescript-language-server`), prefer `find_definition`/`find_references` over Grep for symbol navigation and cross-file renames — results are exact, not text matches. The **first LSP call in a session is slow** (tsserver loads the whole project, 1-3 min cold); subsequent calls are fast. Keep using Grep for strings/comments/CSS selectors — LSP only sees code symbols. `rename_symbol` edits files and leaves `.bak` backups — always call with `dry_run: true` first, and prefer plain `Edit` for single-file renames; delete `.bak` files after applying. Verify type-level results with `npm run typecheck`. Note: the global `cclsp` install carries local patches (init-timeout + references retry fix) — reinstalling/upgrading it overwrites them.
- **Lint**: `npm run lint[:fix]`; part of `test:all`.
- **Validation**: Zod (`src/api/schemas.ts`, `validation.ts`) via `validateBody`/`validateQuery`; failures → 400 `VALIDATION_ERROR` with `details.issues`.
- **Pug CDN tags — NO SRI hashes**: pin exact versions in the URL, omit `integrity`, keep `crossorigin="anonymous"` (CDNs silently rebuild assets → `BABYLON.Engine is not a constructor`). Pins: `frontend/src/pug/app.pug`, `frontend/src/js/engine/babylon-loader.ts` (Babylon lazy-loads on first Studio entry).
- **Solidity**: `^0.8.20`, OpenZeppelin v5, compiled 0.8.24 (Cancun); `require()` validation, events for state changes, NatSpec; optimize storage reads over writes.
- **Pug/SCSS**: built by custom scripts in `frontend/scripts/`; custom SCSS design system (`scss/styles.scss` entry); no Bootstrap. **Icons**: never inline SVG paths in Pug — add a `<symbol>` to the sprite `frontend/public/icons.svg` (served at `/icons.svg`) and reference it: `svg(...attrs): use(href="/icons.svg#id")`. Symbol children stay bare (no presentation attrs) so host-svg `fill`/`stroke="currentColor"` inherits through `<use>`; do NOT use `<img>` for icons (kills currentColor theming/hover).
- **Alpine.js** (importmap, esm.sh pin): progressive-enhancement framework for stateful panels — no bundler. Register components via `registerAlpineComponent()` in `frontend/src/js/ui/alpine.ts` (starts Alpine once on DOMContentLoaded); shared reactive state goes in `Alpine.store(...)` (mutating a component's captured `this` from outside Alpine expressions does NOT trigger reactivity); **component `init()` must SEED from source stores before subscribing** — page-load flows (wallet auto-connect) can emit before `Alpine.start()`, and subscription-only init misses them; Pug fragments keep every id/class byte-identical (E2E contract); first consumer: `ui/wallet-popover.ts`.
- **Backend logs**: `[TAG]` prefixes (`[BOOT] [OK] [ERR] [IPFS] [SAVE] [CHAIN] [GEN] [PARAM] [AUTH] [ABI] [TOKEN] [SESSION] [INDEXER] [INDEXER-API] [UNPIN] [BURN] [USERS]`); log start + outcome of async ops with CID/txHash/nodeId; `console.error` for exceptions only.
- **Viewport resize**: resize the Babylon engine inside `runRenderLoop`, immediately before `scene.render()` — never in the resize handler (`engine/scene-graph.ts`).

## 6. Agent Decision-Making

Multiple valid implementation options? **Enumerate with trade-offs, mark one (Recommended), wait for explicit user choice** before writing code. Applies to architecture, library choices, UI patterns, refactoring strategies, deployment targets, algorithm/data-structure selection. Exceptions: trivial naming/formatting, user-specified approach, single-viable-option emergencies.

### Long Tasks: Plan, Split, Sequence

When a task is too large for one context, delegate to subagents — but plan before dispatching:

1. **Plan first** — write the decomposition as a todo list before launching anything. Each item must be independently executable: its own files/scope, no shared mutable state, no need for another item's output.
2. **Dependency plan** — map what depends on what. Independent items → dispatch in parallel (one agent per domain, via `Agent`/`AgentSwarm`). Dependent items → run sequentially in dependency order. Never parallelize agents that edit the same files or share state — in this repo that includes the Docker stack, `.env` files, contract addresses, and the running backend (compile → deploy → sync `.env` → test is always sequential).
3. **Self-contained prompts** — subagents start with zero context. Give each: exact scope, concrete file paths, constraints ("do NOT touch X"), and the expected return format (findings, files changed, verification run).
4. **Integrate** — when agents return: review each summary, check for conflicting edits, run the full relevant test suite, and only then report completion.

### Subagent model pool (Kimi Code ≥ 0.36.0)

`~/.kimi-code/config.toml` carries a `[secondary_model]` pool; `Agent`/`AgentSwarm` spawns accept a `model` pick from it. Main model is `kimi-code/k3`; pool default is also `kimi-code/k3`. Pick per task:

- `kimi-code/k3` — hard problems: deep debugging, multi-file architecture, contract/IPFS security work.
- `kimi-code/kimi-for-coding` — routine feature development.
- `kimi-code/kimi-for-coding-highspeed` — cheap bulk work: small edits, summaries, explanations.

Experimental and inert until enabled with `KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL=1` (or the master `KIMI_CODE_EXPERIMENTAL_FLAG=1`) at launch, or toggled in `/experiments`. Adjust the pool with `/secondary-model` or by editing `config.toml` — see the Kimi Code config docs (`[secondary_model]`).

## 7. Key Data Concepts

Full schema: `docs/ARCHITECTURE.md §4`. Golden rules: the asset · fractal nesting ("dollhouse") · temporal isolation · parametric edits are first-class versions.

- **Manifests**: content-addressed JSON on IPFS, chained backward via `prev_manifest_cid` (immutable chain).
- **`child_ref` token children**: `{ collection: { chainId, contractAddress, tokenId }, assetID }` — never a static CID; always include `transform_matrix` (identity default); no local `history`; `MAX_CHILD_ASSET_DEPTH = 5`, cycle protection in `scene-graph.ts`.
- **Collections**: `tokenURI()` → `type: "collection"` manifest with `assets: { assetID: cid }`. Default token ID from wallet address; named collections from `keccak256(address, name)`. Updates write a new collection manifest + `updateAssetURI()` — no remint.
- **Thumbnails**: best-effort — all code must tolerate missing thumbnails.
- **Comments archive** (`comments_archive_cid`): asset-scoped (Nostr tag = asset tag). Republish snapshots via `POST /api/v1/assets/snapshot-comments`; frontend loads archive before live relay events, dedups by `event.id`; archive unpinned on burn.
- **Chat provenance** (`metadata.chat`): each manifest version records the AI prompts that produced it — `{prompt, provider, task, taskId?, timestamp}`, version-scoped (not cumulative); the chain walk reconstructs the full conversation. Unsaved chat is ephemeral (Nostr-based preservation is future work).
- **glTF buffer URIs**: `ipfs://bafy...` in storage ↔ base64 data URI at render. Only the `@arbesk/asset-core` glTF composer/decomposer performs this transform (`packages/asset-core/AGENTS.md`) — don't bypass it.

## 8. Session Auth

- Header `Authorization: Session <token>` (not Bearer); opaque, 24h TTL, wallet-bound, auto-cleared on disconnect; entry point `getOrCreateSession()` in `services/api.ts`.
- **Single creation path** — SIWE via `POST /api/v1/sessions`: EOA sends `{ message, signature }`; CDP adds `eoaAddress` (embedded EOA signs; `message.address` is the smart account; fallback verification in the `@arbesk/wallet` SIWE verifier — `packages/wallet/AGENTS.md`).
- Required for: `POST /generations`, `DELETE /generations/:taskId` (stop an in-flight task — credits lost), `/ipfs/upload-url`, `/ipfs/unpin`, `/assets/snapshot-comments`, `/paymaster`, `/users/resolve-email`; WS chat proxy takes the token in the query string.
- `/ipfs/unpin` also verifies on-chain ownership (or editor Merkle proof) and CID membership in the token's collection — frontend unpins **before** burning.
- Auto-restore on page load for CDP, EOA, WalletConnect. Full flow: `docs/API_SPEC.md § Authentication`.

## 9. Security

Never commit `.env` · validate all route bodies/params · `ReentrancyGuard` on any value transfer · IPFS node loopback-only · Hardhat 8545 dev-only · mock adapters gated strictly on `MOCK_3D_GENERATION`, never in production.

## 10. Testing

| Type | Framework | Key files |
|------|-----------|-----------|
| Backend API | Jest + Supertest | `test/api.test.js` |
| Deployment integrity | Jest | `test/frontend/deployment-integrity.test.js` |
| Smart contracts | Hardhat | `blockchain/test/*.js` |
| E2E | Playwright | `e2e/specs/*.spec.js` |

~1468 Jest tests / 110 suites; E2E 22 specs / 68 tests, 1 worker default (`E2E_WORKERS=N` for parallel isolated stacks); `jest.config.js` excludes `/e2e/`. Coverage: `npm run test:e2e:coverage`, `npm run test:coverage:all`.

**Run E2E before merging changes to**: Studio UI/UX · wallet/session auth · generation flow · save/publish · parametric editing/version history · nesting/child assets · contracts/ABI/deploy · manifest schema · IPFS format/CIDs · asset comments. `npm test` is **not enough** for these.

**UI changes must sync E2E**: update `e2e/helpers/studio-selectors.mjs`, spec assertions, and `e2e/helpers/manifest.mjs` as the flow changes (`e2e/README.md`, edit-ui skill's E2E Sync guide).

## 11. Infrastructure

| Service | API | Gateway / RPC |
|---------|-----|---------------|
| Private IPFS (Kubo) | `127.0.0.1:5001` | `127.0.0.1:8080` (loopback, no DHT) |
| Hardhat local EVM (Docker) | — | `127.0.0.1:8545` |
| Local Nostr relay | — | `ws://127.0.0.1:7777` |
| Base Sepolia | — | `https://sepolia.base.org` (backend); `https://base-sepolia-rpc.publicnode.com` (CDP browser passthrough) |

Backend on :9090. Hardhat networks: `hardhat` (local), `baseSepolia` (testnet; ETH gas, CDP smart accounts sponsored via paymaster proxy `src/api/routes/paymaster.ts`).

Env files (gitignored, never commit): `blockchain/.env` (deploy keys/addresses — bootstrap from `.env.example`), root `.env` (backend; `CONTRACT_ADDRESS`/`PAID_CONTRACT_ADDRESS` must match `blockchain/.env` post-deploy; CDP keys: `CDP_PROJECT_ID`, `CDP_PAYMASTER_URL`, `CDP_API_KEY_ID`/`SECRET`; `INDEXER_DISABLE_TESTNET` kill-switch). Full reference: `docs/CURRENT_STATUS.md §8`. Ops: `scripts/run-ipfs-gc.mjs` (IPFS GC), `scripts/sync-deployed-addresses.mjs`.

## 12. Misc

- **Worktrees**: `npm run worktree:create -- feature-xyz` seeds `.worktrees/feature-xyz` with env files, built frontend, compiled contracts, own Docker stack + deterministic port (arbesk-worktree skill, `e2e/README.md § Git worktrees`).
- **CDP email wallet**: `@coinbase/cdp-core` SDK in `wallet-cdp.ts`, Base Sepolia only (cdp-base-wallet skill).
- **Repository**: https://github.com/ahmadsayed/arbesk (private — always use the `gh` CLI; public fetches 404).
