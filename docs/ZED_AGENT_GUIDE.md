# Zed AI Agent Guide

This project is initialized for Zed's coding agent workflow.

## Agent Entry Points

- Primary instructions: [`../AGENTS.md`](../AGENTS.md)
- Current status: [`CURRENT_STATUS.md`](CURRENT_STATUS.md)
- Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- API truth source: [`API_SPEC.md`](API_SPEC.md)

When working in Zed, the agent should first read `AGENTS.md` and then use `docs/CURRENT_STATUS.md` for the latest implementation snapshot.

## Active Phase: Micro-Ledger & Audit Infrastructure (Phase 5)

The current focus is the append-only micro-ledger for structured audit logging. Key context:

- **Schema**: Typed `LedgerEntry` records in `src/ledger/schema.js`.
- **Store**: JSONL append-only store in `src/ledger/store.js`.
- **API**: Query and stats endpoints in `src/api/ledger.js`.
- **Contract**: `anchorManifest()` in `ArbeskAsset.sol` for on-chain proof of manifest CIDs.
- **Frontend**: `frontend/src/js/ui/ledger-panel.js` — collapsible audit trail panel.
- **Status**: MVP implemented (schema, store, API, hooks, contract anchor, panel). Per-asset filtering and digital signatures deferred to Phase 5b.

## Contract Edit Workflow (MANDATORY)

After **any** change to `blockchain/contracts/*.sol`, the deployment pipeline must be validated:

```bash
# 1. Recompile — writes fresh ABI to blockchain/artifacts/ on host
docker-compose run --rm hardhat npx hardhat compile

# 2. Redeploy — updates blockchain/.env + deployment artifact
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat

# 3. Sync CONTRACT_ADDRESS from blockchain/.env to root .env
#    The deploy script updates blockchain/.env but NOT root .env.
grep CONTRACT_ADDRESS blockchain/.env
#    Manually update root .env to match the new address.

# 4. Verify the pipeline is intact
npm run test:frontend
```

The `test/frontend/deployment-integrity.test.js` suite validates:
- Compiled ABI contains every required function signature
- Root .env and blockchain/.env agree on CONTRACT_ADDRESS
- USDC_TOKEN is present in blockchain/.env
- Deployment artifact matches the configured address
- Docker volume mounts for artifacts, deployments, and .env are present

**Skipping any step causes `c.methods.X is not a function` or `Transaction reverted` errors.**

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
| Gallery / asset library | `frontend/src/js/ui/asset-library.js` |
| Asset editors | `frontend/src/js/ui/asset-editors.js` |
| Asset history / timeline | `frontend/src/js/ui/asset-history.js` |
| Asset save / publish | `frontend/src/js/ui/asset-save.js` |
| Create panel | `frontend/src/js/ui/create-panel.js` |
| API service | `frontend/src/js/services/api.js` |
| Team service | `frontend/src/js/services/team.js` |
| IPFS read/write | `frontend/src/js/ipfs/` |
| glTF CID translation | `frontend/src/js/gltf/` |
| Micro-ledger schema | `src/ledger/schema.js` |
| Micro-ledger store | `src/ledger/store.js` |
| Ledger API | `src/api/ledger.js` |
| Ledger panel | `frontend/src/js/ui/ledger-panel.js` |

## Zed Tasks

Project tasks are defined in `.zed/tasks.json` and can be run from Zed's task palette.

Recommended task order for normal development:

1. `Install root dependencies`
2. `Install frontend dependencies`
3. `Start Docker infrastructure`
4. `Build frontend`
5. `Run backend tests`
6. `Start backend`

## Safety Rules for Agents

- Do not commit `.env`, `node_modules`, generated frontend `dist`, or Hardhat `artifacts/cache` output.
- Prefer targeted validation:
  - Backend route edits: `Run backend tests`
  - Frontend JS/SCSS/Pug edits: `Build frontend`
  - **Contract edits: follow the MANDATORY workflow above**
- Do not start long-running servers unless explicitly needed; use Zed tasks or bounded terminal runs.
- Preserve the private-IPFS + EVM assumptions. Do not swap to public IPFS or a different EVM chain without explicit instruction.

## Important Runtime Notes

- The backend serves `frontend/dist`, so frontend changes require `Build frontend` before `Start backend` for browser verification.
- The private IPFS gateway is expected at `http://127.0.0.1:8080/ipfs/`.
- The local Hardhat RPC is expected at `http://127.0.0.1:8545`.
- Current generation is mock-backed unless production cloud adapters are implemented and enabled.
