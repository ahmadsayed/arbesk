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

- **Blockchain**: EVM-compatible — Hardhat local dev, Optimism Sepolia testnet, Optimism mainnet production
- **IPFS**: Private Dockerized Kubo node — no public DHT, no external peers, loopback-only
- **Hardhat**: Runs inside a Docker container (reproducible local EVM)
- **3D Generation**: Mock adapter for dev/test (`mock-gltf-assets/intro.gltf`, `mock-gltf-assets/suka.gltf`)
- **Parametric Versions**: Color + scale edits append new history entries client-side — no cloud generation
- **Runtime Cache**: Browser IPFS reads use on-demand memory + IndexedDB — no prefetching unless explicitly requested

**Phase Status**: All phases 1–5.2 are complete. See `docs/CURRENT_STATUS.md` for the definitive snapshot.

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

Two production contracts share `ArbeskAssetBase.sol` (abstract ERC-721 base with collaboration + burn):

| Contract | File | Role | Limits |
|----------|------|------|--------|
| `ArbeskAssetFree` | `blockchain/contracts/ArbeskAssetFree.sol` | **Default** — free tier | 10 gen/day/wallet, 5 editors/token |
| `ArbeskAsset` | `blockchain/contracts/ArbeskAsset.sol` | Paid tier — USDC PayGo | Unlimited paid gen, 50 editors/token |

**Rules:**
- `CONTRACT_ADDRESS` → `ArbeskAssetFree` (default); `PAID_CONTRACT_ADDRESS` → `ArbeskAsset`
- `create-panel.js` dispatches via `wallet.isFreeTierContract()` — never hard-code the paid path in new generation UI code
- Use `CHAIN_IDS` from `src/constants/chains.js` / `frontend/src/js/constants/chains.js` — no magic numbers (`31415822`, `11155420`, `10`)
- Contract `owner()` bypasses all quotas (useful for admin/test wallets)
- **After any `.sol` change**: compile → deploy → sync root `.env` → `npm run test:frontend`. Stale ABIs cause `c.methods.X is not a function`.

---

## 3. Repository Layout

| What | Where |
|------|-------|
| Backend entry | `src/index.js` |
| API routes | `src/api/index.js` |
| Cloud generation route | `src/api/assets/generate-node.js` |
| Auth middleware | `src/api/authentication.js` |
| Session store | `src/api/sessions.js` |
| Rate limiter | `src/api/rate-limiter.js` |
| ABI serving | `src/api/abi-router.js` |
| 3D engine | `frontend/src/js/engine/` |
| Parametric preview | `frontend/src/js/engine/parametric-preview.js` |
| Wallet / chain | `frontend/src/js/blockchain/` |
| Token resolver | `frontend/src/js/blockchain/token-resolver.js` |
| IPFS read/write | `frontend/src/js/ipfs/` |
| glTF pipeline | `frontend/src/js/gltf/` |
| Asset library (gallery) | `frontend/src/js/ui/asset-library.js` |
| Asset save/publish | `frontend/src/js/ui/asset-save.js` |
| Create panel | `frontend/src/js/ui/create-panel.js` |
| Activity panel | `frontend/src/js/ui/ledger-panel.js` |
| API service layer | `frontend/src/js/services/api.js` |
| Smart contracts | `blockchain/contracts/` |
| Frontend templates | `frontend/src/pug/` |
| Frontend styles | `frontend/src/scss/` |
| Build scripts | `frontend/scripts/` |

---

## 4. Build & Development Commands

```bash
# ─── Infrastructure ───
docker-compose up -d                          # start IPFS + Hardhat + Nostr relay
docker-compose down
docker-compose logs -f ipfs                   # or: hardhat, nostr

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
npm test                                      # all (Jest + Hardhat)
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js --runInBand --silent
docker-compose run --rm hardhat npx hardhat test
npx playwright test --config=e2e/playwright.config.js --project=chromium   # E2E critical path
npx playwright test --config=e2e/playwright.config.js --project=chromium --ui # E2E debug UI

# ─── Contract workflow (MANDATORY after any .sol change) ───
docker-compose run --rm hardhat npx hardhat compile
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat
grep -E "CONTRACT_ADDRESS|PAID_CONTRACT_ADDRESS" blockchain/.env   # copy to root .env
npm run test:frontend                         # always verify last

# ─── Deploy to testnet / mainnet ───
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network optimismSepolia
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network optimismMainnet
docker-compose run --rm hardhat npx hardhat run scripts/verify.js --network <network>

# ─── Hardhat shell ───
docker-compose run --rm hardhat sh
```

---

## 5. Coding Conventions

### JavaScript
- **Modules**: ES modules (`import`/`export`) in root + frontend; CommonJS (`require`) in `blockchain/scripts/` only
- **Frontend globals**: `BABYLON`, `Web3`, `window.web3`, `IpfsHttpClient` are CDN-loaded — don't import them
- **Naming**: camelCase variables/functions, PascalCase classes, UPPER_SNAKE module-level constants
- **No TypeScript**: Pure JavaScript; add JSDoc when documenting new public functions

### CDN Script Tags — No SRI Hashes
Pug templates must **not** include `integrity="sha384-…"` attributes. CDNs silently rebuild assets, breaking SRI and blocking scripts entirely (symptom: `BABYLON.Engine is not a constructor`). Pin exact versions in the URL, omit `integrity`, keep `crossorigin="anonymous"`.

Current pinned versions live in `frontend/src/pug/studio.pug` — update intentionally, never silently.

### Solidity
- Version `^0.8.0`, OpenZeppelin v5 base
- `require()` for validation, emit events for state changes, NatSpec (`@dev`, `@param`, `@return`)
- Optimize for storage reads over writes

### Pug / SCSS
- Build via custom Node.js scripts in `frontend/scripts/` (not Webpack/Vite)
- Reusable Pug partials in `frontend/src/pug/includes/`
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
| `[UNPIN]` | IPFS unpin |
| `[BURN]` | Token burn |

Use `console.error()` for exceptions only; `console.log()` for operational flow.

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

**Thumbnail:** best-effort publish metadata — all code must tolerate missing thumbnails.

**Comments Archive (`comments_archive_cid`):**
- Republishing an existing token snapshots the asset's Nostr comment thread to a JSON archive on IPFS and stores the archive CID in the manifest.
- The archive is created by `src/api/comments-archive.js` via the `publishContext` control field on `POST /api/v1/manifests`.
- First-time publishes have no prior comments and therefore no archive CID.
- On token burn, the archive CID is unpinned alongside the manifest chain.
- The frontend loads the archive before subscribing to live relay events and deduplicates by `event.id`.

### glTF Buffer URI Format
```
IPFS storage:  "uri": "ipfs://Qm..."
Render time:   "uri": "data:application/octet-stream;base64,Z2xC..."
```
The `frontend/src/js/gltf/` composer/decomposer handles this transform — don't bypass it.

---

## 8. Session Authentication

- Header: `Authorization: Session <token>` (not Bearer)
- `POST /api/v1/generations` requires a valid session; no session = generation blocked
- Wallet connect triggers one SIWE signature → session token (24 h TTL, bound to wallet address)
- Auto-cleared on wallet disconnect; entry point: `getOrCreateSession()` in `frontend/src/js/services/api.js`

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

**E2E coverage (6 specs):** `01` wallet connect/SIWE · `02` free-tier generation + manifest · `03` save → publish → gallery → burn · `04` parametric color version + time-travel slider · `05` republish existing token (`updateAssetURI`, no remint) · `06` nesting — link a token as a `child_ref` child world, then dive/ascend. Per-spec contract: `e2e/README.md`.

### Running tests

```bash
# Unit / API / contract tests
npm test

# E2E critical path (wallet → generate → save → publish)
npx playwright test --config=e2e/playwright.config.js --project=chromium

# E2E with visible browser for debugging
npx playwright test --config=e2e/playwright.config.js --project=chromium --ui
```

`jest.config.js` excludes `/e2e/` so Playwright specs are not picked up by `npm test`.

### When to run E2E tests

**Run the E2E suite before merging any change that touches:**

- Studio UI/UX (headerbar, chat, prompt input, dialogs, wallet controls, settings)
- Wallet integration (`wallet.js`, `wallet-connect.js`, `wallet-discovery.js`, `siwe.js`, session auth)
- Generation flow (`create-panel.js`, generation API, transaction validation, mock adapter, provider/tier selection)
- Save/publish/republish logic (`asset-save.js`, `dialog.js`, manifest versioning, thumbnail capture, `updateAssetURI`)
- Parametric editing + version history (`parametric-preview.js`, `asset-history.js`, the outliner selection path, the version slider)
- Nesting / linked child worlds (`nesting.js`, `scene-graph.js` linked-asset handling, token resolver, `child_ref` / `transform_matrix`)
- Smart contracts, ABI, or deployment scripts
- Manifest schema (`scene.nodes`, `source_asset`, `child_ref`, `transform_matrix`, `prev_asset_manifest_cid`, `thumbnail`, `comments_archive_cid`)
- IPFS storage format or CID handling

`npm test` is **not enough** for these areas. The E2E specs are the only automated coverage that validates the full browser → wallet → backend → blockchain → IPFS chain.

### Keeping E2E tests in sync with UI changes

The E2E specs depend on a stable selector map and a known user flow. See `e2e/README.md` for the full contract, and the `edit-ui` skill's [E2E Sync guide](.agents/skills/edit-ui/references/e2e-sync.md) for the UI-area → spec → selector map.

**If you change the UI, you must:**

1. Update `e2e/helpers/studio-selectors.mjs` when any referenced `id`, class, or button label changes.
2. Update the spec assertions when chat/status text, dialog titles, or flow order changes.
3. Update `e2e/helpers/manifest.mjs` when the manifest schema or version semantics change.
4. Add or remove test steps when the save/publish flow gains or loses dialogs/confirmations.

**Contract workflow (MANDATORY after any `.sol` change):**

```bash
docker-compose run --rm hardhat npx hardhat compile
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat
grep -E "CONTRACT_ADDRESS|PAID_CONTRACT_ADDRESS" blockchain/.env   # copy to root .env
npm run test:frontend
npx playwright test --config=e2e/playwright.config.js --project=chromium
```

Stale ABIs cause `c.methods.X is not a function`; stale contract addresses cause free-tier generation to fail with "Payment validation failed".

---

## 11. Infrastructure (Ports Reference)

| Service | API | Gateway / RPC | Notes |
|---------|-----|---------------|-------|
| Private IPFS (Kubo) | `127.0.0.1:5001` | `127.0.0.1:8080` | No DHT, no bootstrap, loopback swarm |
| Hardhat local EVM | — | `127.0.0.1:8545` | Docker container, `./blockchain` volume-mounted |
| Local Nostr relay | — | `ws://127.0.0.1:7777` | `scsibug/nostr-rs-relay`, SQLite-backed, dev-only |
| Optimism Sepolia | — | `https://sepolia.optimism.io` | Testnet |
| Optimism mainnet | — | `https://mainnet.optimism.io` | Production |

Full container config: `docker-compose.yml`, `docker/Dockerfile`, `docker/hardhat.Dockerfile`, `docker/nostr-relay.toml`.

---

## 12. Environment Files

Three `.env` files — all gitignored, **never commit**:

| File | Purpose | Bootstrap |
|------|---------|-----------|
| `blockchain/.env` | Hardhat scripts (keys, contract addresses, RPC) | `cp blockchain/.env.example blockchain/.env` |
| `.env` (root) | Backend + cloud adapters. `CONTRACT_ADDRESS` + `PAID_CONTRACT_ADDRESS` must match `blockchain/.env` post-deploy | Copy from example + set values |
| `frontend/.env` | Build-time public vars (optional) | — |

Full variable reference: `docs/CURRENT_STATUS.md §6.5`.

---

## 13. EVM Deployment Targets

| Environment | Network | RPC |
|-------------|---------|-----|
| Local dev | Hardhat (Docker) | `http://127.0.0.1:8545` |
| Testnet | Optimism Sepolia | `https://sepolia.optimism.io` |
| Production | Optimism mainnet | `https://mainnet.optimism.io` |

Optimism uses ETH for gas; block time ~2 s; L2 execution fee + L1 data fee (fraction of L1 cost).

---

## 14. Zed AI Agent Setup

| File | Purpose |
|------|---------|
| `.zed/tasks.json` | Repeatable Zed tasks for install/build/test/Docker/backend |
| `.zed/settings.json` | Excludes heavy/generated folders from Zed project scanning |
| `docs/ZED_AGENT_GUIDE.md` | Zed-specific onboarding |
| `docs/CURRENT_STATUS.md` | Definitive implementation snapshot — check before making roadmap claims |

---

## 15. Contact & Links

- **Repository**: https://github.com/ahmadsayed/arbesk
- **Docs**: `docs/` directory in this repo
