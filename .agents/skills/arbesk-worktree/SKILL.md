---
name: arbesk-worktree
description: Use when the user asks to create a git worktree, run tests in a linked worktree, isolate Docker/test infrastructure from the main checkout, or verify changes from a fresh worktree. In this repo, use this instead of superpowers:using-git-worktrees.
---

# Arbesk Worktree

In this repo this replaces `superpowers:using-git-worktrees`, also when `executing-plans` or `subagent-driven-development` asks for a worktree. The generic skill skips the per-worktree Compose project, ports and `IPFS_BACKEND=kubo`.

## Create and test

```bash
bun run worktree:create -- feature-xyz   # scripts/create-worktree.sh; prints the Compose project and ports
cd .worktrees/feature-xyz
git switch -c feat/feature-xyz           # the worktree starts on a detached HEAD
bun run test:frontend && bun run test:api
COMPOSE_PROJECT_NAME=$(./scripts/start-dev.sh --print-project) bun run test:contracts
bun run test:e2e -- --project=chromium
```

- Always use the script. It copies modified and untracked files, the real root `.env` and `blockchain/.env`, symlinks `node_modules`, builds the frontend and compiles the contracts. Never hand-copy `.env.example`.
- It forces `IPFS_BACKEND=kubo`: local E2E asserts `Qm…` CIDs through `127.0.0.1:8080`.
- It does not copy `.env.pinata`. Copy it from the main checkout before `./scripts/start-dev.sh --testnet`.
- Each worktree has its own Compose project, backend port and service ports, so E2E can run while the main checkout's dev server is up.
- `test:contracts` without the `COMPOSE_PROJECT_NAME` prefix targets the main checkout's containers.

## Clean up (in this order)

```bash
cd .worktrees/feature-xyz
docker compose -p "$(./scripts/start-dev.sh --print-project)" down
# Docker leaves root-owned build output; without this, `git worktree remove` fails with permission denied
docker run --rm -v "$(pwd):/ws" alpine sh -c \
  'chown -R $(stat -c "%u:%g" /ws) /ws/blockchain/artifacts /ws/blockchain/deployments 2>/dev/null || true'
cd ../.. && git worktree remove .worktrees/feature-xyz --force && git worktree prune
```
