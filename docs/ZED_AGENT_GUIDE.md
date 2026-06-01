# Zed AI Agent Guide

This project is initialized for Zed's coding agent workflow.

## Agent Entry Points

- Primary instructions: [`../AGENTS.md`](../AGENTS.md)
- Current status: [`CURRENT_STATUS.md`](CURRENT_STATUS.md)
- Roadmap: [`../docs/MVP_PLAN.md`](MVP_PLAN.md) and [`../Phase5.md`](../Phase5.md)
- API truth source: [`API_SPEC.md`](API_SPEC.md)

When working in Zed, the agent should first read `AGENTS.md` and then use `docs/CURRENT_STATUS.md` for the latest implementation snapshot.

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
