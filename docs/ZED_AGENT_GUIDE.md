# Zed AI Agent Guide

This project is initialized for Zed's coding agent workflow.

## Agent Entry Points

- Primary instructions: [`../AGENTS.md`](../AGENTS.md)
- Current status (source of truth): [`CURRENT_STATUS.md`](CURRENT_STATUS.md)
- Architecture reference: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- API reference: [`API_SPEC.md`](API_SPEC.md)

**When working in Zed, the agent should first read `AGENTS.md`, then `docs/CURRENT_STATUS.md` for the latest implementation snapshot.** `CURRENT_STATUS.md` is generated from the actual codebase and takes precedence over older architecture docs when there is conflict.

---

## Active Phase Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 5.1: Token ID-Based Child Worlds | ✅ Complete | `child_ref` resolution, drag/drop, depth/cycle protection |
| Phase 5.2: Free Tier Contract | ✅ Complete | `ArbeskAssetFree.sol` default, `ArbeskAsset.sol` paid tier, owner quota bypass |
| Phase 5: Micro-Ledger | ❌ Not started | `ledger-panel.js` derives activity from manifest chain; only `anchorManifest()` is stubbed |

**Do not claim the micro-ledger is implemented.** The following files do **not** exist:
- `src/ledger/schema.js`
- `src/ledger/store.js`
- `src/api/ledger.js`
- `anchorManifest()` in the contract

---

## Contract Edit Workflow (MANDATORY)

After **any** change to `blockchain/contracts/*.sol`, the deployment pipeline must be validated:

```bash
# 1. Recompile — writes fresh ABI to blockchain/artifacts/ on host
docker-compose run --rm hardhat npx hardhat compile

# 2. Redeploy — updates blockchain/.env + deployment artifact
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat

# 3. Sync CONTRACT_ADDRESS (free tier) and PAID_CONTRACT_ADDRESS (paid tier) from blockchain/.env to root .env
#    The deploy script updates blockchain/.env but NOT root .env.
grep -E "CONTRACT_ADDRESS|PAID_CONTRACT_ADDRESS" blockchain/.env
#    Manually update root .env to match the new addresses.

# 4. Verify the pipeline is intact
npm run test:frontend
```

The `test/frontend/deployment-integrity.test.js` suite validates:
- Compiled ABI contains every required function signature for both `ArbeskAsset` and `ArbeskAssetFree`
- Root .env and blockchain/.env agree on `CONTRACT_ADDRESS` and `PAID_CONTRACT_ADDRESS`
- `USDC_TOKEN` is present in blockchain/.env and does not collide with either contract address
- Deployment artifacts match the configured addresses
- Docker volume mounts for artifacts, deployments, and .env are present

**Skipping any step causes `c.methods.X is not a function` or `Transaction reverted` errors.**

---

## File Map

| Purpose | File |
|---------|------|
| Scene graph + asset loading | `frontend/src/js/engine/scene-graph.js` |
| Time travel / history | `frontend/src/js/engine/time-travel.js` |
| Parametric preview | `frontend/src/js/engine/parametric-preview.js` |
| Wallet + blockchain | `frontend/src/js/blockchain/wallet.js` |
| Token resolver | `frontend/src/js/blockchain/token-resolver.js` |
| URI utilities | `frontend/src/js/blockchain/uri-utils.js` |
| Asset drop zone | `frontend/src/js/ui/asset-drop-zone.js` |
| Asset library (gallery) | `frontend/src/js/ui/asset-library.js` |
| Asset editors (team) | `frontend/src/js/ui/asset-editors.js` |
| Asset history / timeline | `frontend/src/js/ui/asset-history.js` |
| Asset save / publish | `frontend/src/js/ui/asset-save.js` |
| Create panel | `frontend/src/js/ui/create-panel.js` |
| API service | `frontend/src/js/services/api.js` |
| Team service | `frontend/src/js/services/team.js` |
| IPFS read/write | `frontend/src/js/ipfs/` |
| glTF CID translation | `frontend/src/js/gltf/` |
| Ledger panel (manifest-derived) | `frontend/src/js/ui/ledger-panel.js` |

---

## Zed Tasks

Project tasks are defined in `.zed/tasks.json` and can be run from Zed's task palette.

Recommended task order for normal development:

1. `Install root dependencies`
2. `Install frontend dependencies`
3. `Start Docker infrastructure`
4. `Build frontend`
5. `Run backend tests`
6. `Start backend`

---

## Safety Rules for Agents

- Do not commit `.env`, `node_modules`, generated frontend `dist`, or Hardhat `artifacts/cache` output.
- Prefer targeted validation:
  - Backend route edits: `Run backend tests`
  - Frontend JS/SCSS/Pug edits: `Build frontend`
  - **Contract edits: follow the MANDATORY workflow above**
- Do not start long-running servers unless explicitly needed; use Zed tasks or bounded terminal runs.
- Preserve the private-IPFS + EVM assumptions. Do not swap to public IPFS or a different EVM chain without explicit instruction.

---

## Important Runtime Notes

- The backend serves `frontend/dist`, so frontend changes require `Build frontend` before `Start backend` for browser verification.
- The private IPFS gateway is expected at `http://127.0.0.1:8080/ipfs/`.
- The local Hardhat RPC is expected at `http://127.0.0.1:8545`.
- Current generation is mock-backed unless production cloud adapters are implemented and enabled.
- **Contract name is `ArbeskAsset`, not `ArbeskWorld`.**
- **Backend routes are under `/api/v1/`, not `/api/`.**
- **Parametric editing is client-side only; there is no `POST /api/parametric-version` backend route.**
