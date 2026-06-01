# Zed AI Agent Guide

This project is initialized for Zed's coding agent workflow.

## Agent Entry Points

- Primary instructions: [`../AGENTS.md`](../AGENTS.md)
- Current status: [`CURRENT_STATUS.md`](CURRENT_STATUS.md)
- Roadmap: [`../docs/MVP_PLAN.md`](MVP_PLAN.md) and [`../Phase5.md`](../Phase5.md)
- API truth source: [`API_SPEC.md`](API_SPEC.md)

When working in Zed, the agent should first read `AGENTS.md` and then use `docs/CURRENT_STATUS.md` for the latest implementation snapshot.

## Active Phase: Token ID-Based Child Worlds (5.1)

The current focus is implementing token-based child world references. Key context:

- **Schema**: `child_ref` objects with `{type: "token", chainId, contractAddress, tokenId}` replace legacy `child_manifest_id`.
- **New files**: `token-resolver.js` (blockchain or services) and `asset-drop-zone.js` (UI).
- **Core files affected**: `scene-graph.js` (rendering), `asset-library.js` (drag source), `asset-save.js` (persist).
- **Design**: Clean slate — no backward-compat with legacy child manifests.
- **Testing**: `test/api.test.js` for backend; manual QA checklist for drag/drop flow.

## File Map (Updated for Phase 5.1)

| Purpose | File |
|---------|------|
| Scene graph + asset loading | `frontend/src/js/engine/scene-graph.js` |
| Time travel / history | `frontend/src/js/engine/time-travel.js` |
| Parametric preview | `frontend/src/js/engine/parametric-preview.js` |
| Wallet + blockchain | `frontend/src/js/blockchain/wallet.js` |
| **Token resolver (NEW)** | `frontend/src/js/services/token-resolver.js` or `blockchain/token-resolver.js` |
| **Asset drop zone (NEW)** | `frontend/src/js/ui/asset-drop-zone.js` |
| Gallery / asset library | `frontend/src/js/ui/asset-library.js` |
| Asset editors | `frontend/src/js/ui/asset-editors.js` |
| Asset history / timeline | `frontend/src/js/ui/asset-history.js` |
| Asset save / publish | `frontend/src/js/ui/asset-save.js` |
| Create panel | `frontend/src/js/ui/create-panel.js` |
| API service | `frontend/src/js/services/api.js` |
| Team service | `frontend/src/js/services/team.js` |
| IPFS read/write | `frontend/src/js/ipfs/` |
| glTF CID translation | `frontend/src/js/gltf/` |

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
  - Contract edits: `Run contract tests in Docker`
- Do not start long-running servers unless explicitly needed; use Zed tasks or bounded terminal runs.
- Preserve the private-IPFS + Filecoin FEVM assumptions. Do not swap to public IPFS or a different EVM chain without explicit instruction.

## Important Runtime Notes

- The backend serves `frontend/dist`, so frontend changes require `Build frontend` before `Start backend` for browser verification.
- The private IPFS gateway is expected at `http://127.0.0.1:8080/ipfs/`.
- The local Hardhat RPC is expected at `http://127.0.0.1:8545`.
- Current generation is mock-backed unless production cloud adapters are implemented and enabled.
