# CLAUDE.md — Arbesk Quick Reference

Concise guide for Claude Code sessions. For the full developer guide, see `AGENTS.md`; for architecture, see `docs/ARCHITECTURE.md` and `docs/CURRENT_STATUS.md`.

---

## Project Elevator Pitch

**Arbesk** is a cloud-native 4D fractal version-controlled 3D asset platform.

- Users generate, edit, and publish 3D worlds as content-addressed IPFS manifests.
- Every published token points to a **collection manifest** that maps `assetID`s to asset manifest CIDs.
- Manifests form an immutable chain via `prev_manifest_cid`; parametric edits (color, scale) are first-class versions.
- Ownership and editor rights live on EVM contracts (`ArbeskAssetFree` / `ArbeskAsset`) with off-chain Merkle editor lists.
- Wallets: EOA via SIWE on all chains; CDP email-login smart accounts on **Base Sepolia only**.

---

## Key File Map

### Backend (`src/`)

| File | Purpose |
|------|---------|
| `src/index.js` | Express server entry |
| `src/api/index.js` | API route registration |
| `src/api/assets/generate-node.js` | Cloud generation route |
| `src/api/storage/index.js` | IPFS backend adapter switch (Kubo / Pinata) |
| `src/api/authentication.js` | `Authorization: Session <token>` validation |
| `src/api/sessions.js` | Session store (24 h TTL) |
| `src/api/siwe-verify.js` | SIWE signature verification (EOA + CDP fallback) |
| `src/api/token-indexer.js` | Chunked `eth_getLogs` ownership backfill |
| `src/api/routes/paymaster.js` | CDP Paymaster proxy |
| `src/api/schemas.js`, `src/api/validation.js` | Zod request validation |
| `src/config.js` | Backend runtime config |

### Frontend (`frontend/src/`)

| File | Purpose |
|------|---------|
| `frontend/src/js/engine/scene-graph.js` | Babylon 3D engine, viewport resize handling |
| `frontend/src/js/engine/parametric-preview.js` | Client-side parametric version edits |
| `frontend/src/js/ui/create-panel.js` | Generation UI |
| `frontend/src/js/ui/asset-save.js` | Save / publish / republish flow |
| `frontend/src/js/ui/asset-library.js` | Gallery (owned + shared tokens) |
| `frontend/src/js/ui/wallet-modal.js` | CDP email OTP UI |
| `frontend/src/js/ui/header-wallet-button.js` | CDP email display; hides network selector |
| `frontend/src/js/blockchain/wallet-core.js` | Wallet connection orchestration (CDP-only auto-restore) |
| `frontend/src/js/blockchain/wallet-cdp.js` | CDP SDK wrapper + EIP-1193 shim |
| `frontend/src/js/blockchain/smart-wallet-support.js` | Base Sepolia chain gating |
| `frontend/src/js/blockchain/network-config.js` | Per-network RPC / contract config |
| `frontend/src/js/services/api.js` | API service layer + `getOrCreateSession()` |
| `frontend/src/js/gltf/` | glTF composer / decomposer / Merkle editor helpers |
| `frontend/src/pug/` | Pug templates (no `includes/` subdir) |
| `frontend/src/scss/` | Bootstrap 5 + custom Sass overrides |

### Contracts (`blockchain/`)

| File | Purpose |
|------|---------|
| `blockchain/contracts/ArbeskAssetBase.sol` | Abstract ERC-721 base: Merkle editors + burn |
| `blockchain/contracts/ArbeskAssetFree.sol` | Free tier (10 gen/day/wallet) |
| `blockchain/contracts/ArbeskAsset.sol` | Paid USDC PayGo tier |
| `blockchain/hardhat.config.js` | Networks, compilers |

### Tests

| Type | Command | Location |
|------|---------|----------|
| Unit / API / JS integration | `npm test` | `test/`, `test/api.test.js`, `test/frontend/` |
| Frontend + deployment integrity | `npm run test:frontend` | `test/frontend/` |
| Contracts | `npm run test:contracts` | `blockchain/test/*.js` |
| E2E | `npm run test:e2e -- --project=chromium` | `e2e/specs/*.spec.js` |

**Current counts:** 1005 Jest tests / 67 suites (all passing); 17 Playwright specs / 35 E2E tests.

---

## Essential Commands

```bash
# ─── One-time setup ───
npm install && cd frontend && npm install && cd ..

# ─── Local full stack (IPFS + Hardhat + Nostr + backend on :9090) ───
./scripts/start-dev.sh

# ─── Local stack without backend (useful for E2E) ───
./scripts/start-dev.sh --setup-only

# ─── Testnet stack (Pinata + Base Sepolia + Nostr) ───
./scripts/start-dev.sh --testnet

# ─── Build frontend assets ───
npm run build:frontend

# ─── Run unit / API tests ───
npm test

# ─── Run full gate (lint + typecheck + frontend + api + contracts) ───
npm run test:all

# ─── Run E2E critical path ───
npm run test:e2e -- --project=chromium

# ─── Lint / typecheck ───
npm run lint
npm run typecheck
npm run typecheck:frontend

# ─── Contract workflow (MANDATORY after any .sol change) ───
docker compose run --rm hardhat npx hardhat compile
docker compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat
# Copy CONTRACT_ADDRESS / PAID_CONTRACT_ADDRESS / BASE_CONTRACT_ADDRESS from blockchain/.env to root .env
npm run test:frontend
npx playwright test --config=e2e/playwright.config.js --project=chromium
```

---

## Critical Conventions

### Client-Side First

Default to implementing logic in the browser. Add a backend route only if it:
- Validates signatures, transactions, or sessions
- Enforces a global rate limit or replay guard
- Accesses secrets (`.env`, compiled ABIs)
- Performs cross-user or admin actions

### No SRI Hashes on CDN Scripts

Pug templates must **not** include `integrity="sha384-…"`. CDNs rebuild assets silently, which breaks SRI and causes `BABYLON.Engine is not a constructor`. Pin exact versions, omit `integrity`, keep `crossorigin="anonymous"`.

### TypeScript Checks Plain `.js`

Source files stay `.js`. TypeScript is a static check layer (`allowJs`/`checkJs`, `strict: true`). New code must pass `npm run typecheck` and `npm run typecheck:frontend`. Use JSDoc for public functions; cast catch variables to `Error` before logging `.message`.

### Env Files Are Secret

Three `.env` files exist and are gitignored — **never commit them**:
- `blockchain/.env` — Hardhat keys, contract addresses
- `.env` (root) — backend + cloud adapters
- `frontend/.env` — build-time public vars (currently unused)

### Wallet Auto-Restore Is CDP-Only

`wallet-core.js` `initWallet()` calls `autoConnectCdpOnly()`. EOA/WalletConnect auto-connect is disabled; those users must click Login / Signup explicitly. The verified CDP email is stored in `localStorage` key `arbesk-cdp-email` and shown in `header-wallet-button.js`.

### Base Sepolia RPC Split

- Backend direct reads: `https://sepolia.base.org`
- CDP smart-wallet browser passthrough: `https://base-sepolia-rpc.publicnode.com`

### Contract Addresses Must Stay in Sync

After any `.sol` change or deployment, copy fresh addresses from `blockchain/.env` to root `.env`. Stale ABIs cause `c.methods.X is not a function`; stale addresses cause "Payment validation failed".

### Viewport Resize

Resize the Babylon engine **inside `runRenderLoop`**, immediately before `scene.render()`. Do not throttle the loop to 60 FPS or render synchronously inside resize handlers. See `frontend/src/js/engine/scene-graph.js`.

### glTF Buffer URIs

Storage format: `"uri": "ipfs://bafy..."`  
Render format: `"uri": "data:application/octet-stream;base64,Z2xC..."`  
Use `frontend/src/js/gltf/` — don't bypass the composer/decomposer.

---

## When to Run E2E

`npm test` is not enough when touching:

- Studio UI/UX, wallet integration, generation flow
- Save/publish/republish, parametric editing, nesting/child worlds
- Smart contracts, ABI, manifest schema, IPFS storage, comments

Run `npm run test:e2e -- --project=chromium` before merging these.

---

## Full Docs

- `AGENTS.md` — complete developer guide
- `docs/ARCHITECTURE.md` — system architecture
- `docs/CURRENT_STATUS.md` — implementation snapshot
- `docs/API_SPEC.md` — API contracts
- `e2e/README.md` — E2E contract and worktree workflow
