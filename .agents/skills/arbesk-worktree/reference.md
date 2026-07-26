# Arbesk Worktree Reference

## What `scripts/create-worktree.sh <name>` does

- Creates `.worktrees/<name>` (also runnable as `npm run worktree:create -- <name>`)
- Copies modified tracked files + untracked (non-ignored) files
- Copies root `.env` and `blockchain/.env`
- Sets `IPFS_BACKEND=kubo` in the worktree `.env`
- Symlinks `node_modules`, `frontend/node_modules`, `blockchain/node_modules`
- Builds the frontend
- Compiles Solidity contracts via Docker
- Prints the worktree's `COMPOSE_PROJECT_NAME` and backend port

## File Map

| File | Role |
|------|------|
| `scripts/create-worktree.sh` | Worktree creation helper |
| `e2e/lib/infra.mjs` | Derives per-worktree Compose project + backend port |
| `e2e/global-setup.mjs` | Starts E2E infrastructure on the worktree port |
| `e2e/global-teardown.mjs` | Stops the worktree backend |
| `scripts/start-dev.sh` | Unified launcher: local (default) or testnet (`--testnet`) |
| `package.json` | `worktree:create` npm script; worktree-aware `test:contracts` |

## Full Cleanup Procedure

```bash
cd .worktrees/feature-xyz
PROJECT=$(./scripts/start-dev.sh --print-project)
docker compose -p "$PROJECT" down

# Fix Docker-created root-owned artifacts before removal
docker run --rm -v "$(pwd):/ws" alpine sh -c \
  'chown -R $(stat -c "%u:%g" /ws) /ws/blockchain/artifacts /ws/blockchain/deployments 2>/dev/null || true'

cd /path/to/main/checkout
git worktree remove .worktrees/feature-xyz --force
git worktree prune
```

Order matters: skipping the chown step leaves root-owned `blockchain/artifacts` and `blockchain/deployments` that make `git worktree remove` fail with permission denied.
