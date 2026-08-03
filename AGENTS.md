# AGENTS.md — Arbesk Developer Guide

Conventions for AI agents and developers. Deep reference (load on demand): `docs/ARCHITECTURE.md` · `docs/CURRENT_STATUS.md` (definitive status — check before roadmap claims) · `docs/API_SPEC.md`. Project skills in `.agents/skills/` — read the relevant one before working in its area.

## 1. Identity & Key Constraints

**Arbesk** — cloud-native 4D fractal version-controlled 3D asset platform. JS (Node + browser), Solidity, Pug/SCSS. Phases 1–5.4 complete (`docs/CURRENT_STATUS.md`).

- **Chains**: Hardhat local + Base Sepolia. IDs, `DEPLOYMENT_BLOCKS`, `LOG_CHUNK_SIZES` in `constants/chains.js` — no magic numbers.
- **Wallets**: EOA (MetaMask/Rabby) via SIWE everywhere; CDP email-login smart accounts on **Base Sepolia only** (`smart-wallet-support.js`).
- **IPFS**: private Docker Kubo local/E2E; Pinata testnet. Hardhat runs in Docker.
- **3D generation**: mock adapter for dev/test, samples in `mock-gltf-assets/` (prompt keyword `3mf` → 3MF sample). Tripo3D **v3** adapter (`src/api/adapters/tripo3d-adapter.js`, BYOK): text-to-3D, image-to-3D (JPEG/PNG/WebP attach in the create panel — fresh model, skips the refine chain), texture-only refine, HD texture toggle (`texture_quality: detailed` via the create-panel "High quality texture" checkbox), smart retopology (`mesh/decimate` v2.0 — clean triangulated topology + baked textures, GLB output; `quad: true` forces FBX and is not usable in-app — via the "Retopo for animation" chat chip on a completed generation; the result can itself enter the rig chain), and rig & animate (`rig-check → rig → retarget` chain off a completed generation; rig-only results keep the animate chips — animating an already-rigged task takes the retarget-only path, skipping rig-check/rig; rig endpoint needs its own model version `TRIPO_3D_RIG_MODEL`, default `v2.5-20260210`). Results land as chat bubbles with live orbitable preview (`chat-preview.js`, max 3); Studio scene untouched until "Show in Studio". Provider debugging/integration reference: **tripo3d-expert** skill.
- Parametric color/scale edits are applied client-side — no cloud regeneration.
- Collections: token `tokenURI` → collection manifest mapping `assetID` → asset manifest CID.
- Editor auth: off-chain Merkle editor lists; contract stores only root + version.
- Token discovery via backend indexer (`GET /api/v1/indexer/owned|shared`) — never a browser genesis-walk.
- Browser IPFS reads: on-demand memory + IndexedDB cache — no prefetching.

## 2. Architecture Principles

**Client-side first** — logic belongs in the browser; the Express backend is a thin gatekeeper. Add a server route only to: validate signatures/transactions/sessions, enforce global rate limits/replay guards, access browser-invisible secrets, or perform cross-user/admin actions (`docs/ARCHITECTURE.md §1.5`).

**Contracts**: `ArbeskAssetFree` (`CONTRACT_ADDRESS`, **default**, 10 gen/day/wallet) and `ArbeskAsset` (`PAID_CONTRACT_ADDRESS`, USDC PayGo) share `ArbeskAssetBase.sol` (ERC-721 + Merkle editor auth + burn). Max 5000 editors/token, client-enforced (`merkle-editors.js`). Generation UI goes through `wallet-payments.js` → `isFreeTierContract()` — never hard-code the paid path. Contract `owner()` bypasses the free-tier quota; Merkle editor checks still apply (owner ≠ editor). **After any `.sol` change**: compile → deploy → sync root `.env` → `npm run test:frontend` (+ E2E). Stale ABIs cause `c.methods.X is not a function`.

## 3. Repo Layout

- **Backend** `src/api/`: routes `index.js` + `routes/` · generation `assets/` (`generate-node.js`, `generation-tasks.js`, `adapters/`) · storage `storage/` (kubo/pinata) · auth `authentication.js`, `sessions.js`, `siwe-verify.js` · `token-indexer.js` · `comments-archive.js` · `chat-proxy.js` (WS) · `nostr-relay.js` · `manifest-utils.js` · `asset-tag.js` (canonical tag `<chainId>:<contract>:<tokenId>:<assetId>`) · `openapi.json`
- **Frontend** `frontend/src/js/`: 3D `engine/` · wallet `blockchain/` (wallet-core, wallet-cdp, smart-wallet-support, network-config, token-resolver) · `ipfs/` · `gltf/` (+ `merkle-editors.js`) · `3mf/` · `ui/` (asset-library, comments/collaborators/create panels, chat-messages, wallet-modal, header-wallet-button) · `services/` (api, team, chat-preview, library-ops, asset-delete, asset-save/) · `state/` · templates `frontend/src/pug/` · styles `frontend/src/scss/`
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
npm run build:frontend                 # Pug→HTML, SCSS→CSS, JS copy (no Webpack/Vite)
npm start                              # backend :9090;  npm run nodemon = auto-rebuild

# Testing
npm test                               # Jest unit (excludes Hardhat & E2E)
npm run test:all                       # lint → typecheck → frontend → api → contracts
npm run test:api                       # test/api.test.js alone
npm run test:frontend                  # test/frontend/ + deployment integrity
npm run test:contracts                 # Hardhat tests in Docker
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

- **JS**: ESM in root + frontend; CJS only in `blockchain/scripts/`. CDN globals `BABYLON`, `Web3`, `window.web3`, `IpfsHttpClient` — never import. camelCase vars/functions, PascalCase classes, UPPER_SNAKE module constants.
- **Type-checking**: `allowJs`/`checkJs`, `strict: true` (`npm run typecheck[:frontend]`). JSDoc on new public functions; cast catch vars to `Error` before logging; `// @ts-nocheck` + TODO only when unavoidable. Ambient globals: `src/types/modules.d.ts`, `frontend/src/js/types/globals.d.ts`.
- **Lint**: `npm run lint[:fix]`; part of `test:all`; husky pre-commit runs lint-staged + both typechecks.
- **Validation**: Zod (`src/api/schemas.js`, `validation.js`) via `validateBody`/`validateQuery`; failures → 400 `VALIDATION_ERROR` with `details.issues`.
- **Pug CDN tags — NO SRI hashes**: pin exact versions in the URL, omit `integrity`, keep `crossorigin="anonymous"` (CDNs silently rebuild assets → `BABYLON.Engine is not a constructor`). Pins: `frontend/src/pug/app.pug`, `frontend/src/js/engine/babylon-loader.js` (Babylon lazy-loads on first Studio entry).
- **Solidity**: `^0.8.20`, OpenZeppelin v5, compiled 0.8.24 (Cancun); `require()` validation, events for state changes, NatSpec; optimize storage reads over writes.
- **Pug/SCSS**: built by custom scripts in `frontend/scripts/`; custom SCSS design system (`scss/styles.scss` entry); no Bootstrap.
- **Backend logs**: `[TAG]` prefixes (`[BOOT] [OK] [ERR] [IPFS] [SAVE] [CHAIN] [GEN] [PARAM] [AUTH] [ABI] [TOKEN] [SESSION] [INDEXER] [INDEXER-API] [UNPIN] [BURN] [USERS]`); log start + outcome of async ops with CID/txHash/nodeId; `console.error` for exceptions only.
- **Viewport resize**: resize the Babylon engine inside `runRenderLoop`, immediately before `scene.render()` — never in the resize handler (`engine/scene-graph.js`).

## 6. Agent Decision-Making

Multiple valid implementation options? **Enumerate with trade-offs, mark one (Recommended), wait for explicit user choice** before writing code. Applies to architecture, library choices, UI patterns, refactoring strategies, deployment targets, algorithm/data-structure selection. Exceptions: trivial naming/formatting, user-specified approach, single-viable-option emergencies.

### Long Tasks: Plan, Split, Sequence

When a task is too large for one context, delegate to subagents — but plan before dispatching:

1. **Plan first** — write the decomposition as a todo list before launching anything. Each item must be independently executable: its own files/scope, no shared mutable state, no need for another item's output.
2. **Dependency plan** — map what depends on what. Independent items → dispatch in parallel (one agent per domain, via `Agent`/`AgentSwarm`). Dependent items → run sequentially in dependency order. Never parallelize agents that edit the same files or share state — in this repo that includes the Docker stack, `.env` files, contract addresses, and the running backend (compile → deploy → sync `.env` → test is always sequential).
3. **Self-contained prompts** — subagents start with zero context. Give each: exact scope, concrete file paths, constraints ("do NOT touch X"), and the expected return format (findings, files changed, verification run).
4. **Integrate** — when agents return: review each summary, check for conflicting edits, run the full relevant test suite, and only then report completion.

## 7. Key Data Concepts

Full schema: `docs/ARCHITECTURE.md §4`. Golden rules: the world is the asset · fractal nesting ("dollhouse") · temporal isolation · parametric edits are first-class versions.

- **Manifests**: content-addressed JSON on IPFS, chained backward via `prev_manifest_cid` (immutable chain).
- **`child_ref` token children**: `{ type, chainId, contractAddress, tokenId, standard, resolution }` — never a static CID; always include `transform_matrix` (identity default); no local `history`; `MAX_CHILD_WORLD_DEPTH = 5`, cycle protection in `scene-graph.js`.
- **Collections**: `tokenURI()` → `type: "collection"` manifest with `assets: { assetID: cid }`. Default token ID from wallet address; named collections from `keccak256(address, name)`. Updates write a new collection manifest + `updateAssetURI()` — no remint.
- **Thumbnails**: best-effort — all code must tolerate missing thumbnails.
- **Comments archive** (`comments_archive_cid`): asset-scoped (Nostr tag = asset tag). Republish snapshots via `POST /api/v1/assets/snapshot-comments`; frontend loads archive before live relay events, dedups by `event.id`; archive unpinned on burn.
- **Chat provenance** (`metadata.chat`): each manifest version records the AI prompts that produced it — `{prompt, provider, task, taskId?, timestamp}`, version-scoped (not cumulative); the chain walk reconstructs the full conversation. Unsaved chat is ephemeral (Nostr-based preservation is a future phase).
- **glTF buffer URIs**: `ipfs://bafy...` in storage ↔ base64 data URI at render. Only the `frontend/src/js/gltf/` composer/decomposer performs this transform — don't bypass it.

## 8. Session Auth

- Header `Authorization: Session <token>` (not Bearer); opaque, 24h TTL, wallet-bound, auto-cleared on disconnect; entry point `getOrCreateSession()` in `services/api.js`.
- **Single creation path** — SIWE via `POST /api/v1/sessions`: EOA sends `{ message, signature }`; CDP adds `eoaAddress` (embedded EOA signs; `message.address` is the smart account; fallback verification in `siwe-verify.js`).
- Required for: `POST /generations`, `/ipfs/upload-url`, `/ipfs/unpin`, `/assets/snapshot-comments`, `/paymaster`, `/users/resolve-email`; WS chat proxy takes the token in the query string.
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

~1468 Jest tests / 110 suites; E2E 19 specs / 39 tests, 1 worker default (`E2E_WORKERS=N` for parallel isolated stacks); `jest.config.js` excludes `/e2e/`. Coverage: `npm run test:e2e:coverage`, `npm run test:coverage:all`.

**Run E2E before merging changes to**: Studio UI/UX · wallet/session auth · generation flow · save/publish · parametric editing/version history · nesting/child worlds · contracts/ABI/deploy · manifest schema · IPFS format/CIDs · asset comments. `npm test` is **not enough** for these.

**UI changes must sync E2E**: update `e2e/helpers/studio-selectors.mjs`, spec assertions, and `e2e/helpers/manifest.mjs` as the flow changes (`e2e/README.md`, edit-ui skill's E2E Sync guide).

## 11. Infrastructure

| Service | API | Gateway / RPC |
|---------|-----|---------------|
| Private IPFS (Kubo) | `127.0.0.1:5001` | `127.0.0.1:8080` (loopback, no DHT) |
| Hardhat local EVM (Docker) | — | `127.0.0.1:8545` |
| Local Nostr relay | — | `ws://127.0.0.1:7777` |
| Base Sepolia | — | `https://sepolia.base.org` (backend); `https://base-sepolia-rpc.publicnode.com` (CDP browser passthrough) |

Backend on :9090. Hardhat networks: `hardhat` (local), `baseSepolia` (testnet; ETH gas, CDP smart accounts sponsored via paymaster proxy `src/api/routes/paymaster.js`).

Env files (gitignored, never commit): `blockchain/.env` (deploy keys/addresses — bootstrap from `.env.example`), root `.env` (backend; `CONTRACT_ADDRESS`/`PAID_CONTRACT_ADDRESS` must match `blockchain/.env` post-deploy; CDP keys: `CDP_PROJECT_ID`, `CDP_PAYMASTER_URL`, `CDP_API_KEY_ID`/`SECRET`; `INDEXER_DISABLE_TESTNET` kill-switch). Full reference: `docs/CURRENT_STATUS.md §8`. Ops: `scripts/run-ipfs-gc.mjs` (IPFS GC), `scripts/sync-deployed-addresses.mjs`.

## 12. Misc

- **Worktrees**: `npm run worktree:create -- feature-xyz` seeds `.worktrees/feature-xyz` with env files, built frontend, compiled contracts, own Docker stack + deterministic port (arbesk-worktree skill, `e2e/README.md § Git worktrees`).
- **CDP email wallet**: `@coinbase/cdp-core` SDK in `wallet-cdp.js`, Base Sepolia only (cdp-base-wallet skill).
- **Repository**: https://github.com/ahmadsayed/arbesk (private — always use the `gh` CLI; public fetches 404).
