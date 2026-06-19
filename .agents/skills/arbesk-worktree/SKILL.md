---
name: arbesk-worktree
description: Arbesk git worktree isolation and full-stack testing workflow. Use whenever the user asks to create a worktree, run tests in a linked worktree, isolate Docker/test infrastructure from the main checkout, or verify changes from a fresh worktree. Covers creating the worktree, copying environment files, building the frontend, compiling contracts, running unit/API/contract/E2E tests, and cleanup.
---

# Arbesk Worktree Testing

Use this skill when you need to create a git worktree for Arbesk or run the full test stack from a worktree without colliding with the main checkout's Docker containers or backend port.

## Quick Decision

| Question | Action |
|----------|--------|
| Need a clean environment to test current changes? | Run `scripts/create-worktree.sh <name>` |
| Tests failing because ports/containers clash with main checkout? | Use a worktree — it gets its own Compose project and backend port |
| Need to run E2E but main `.env` uses Pinata? | The script forces `IPFS_BACKEND=kubo` in the worktree `.env` |
| Done with a worktree? | `docker compose -p <project> down` then `git worktree remove .worktrees/<name>` |

## Key Rules

1. **Always use the helper script** — `scripts/create-worktree.sh <name>` seeds the worktree with current changes, env files, and node_modules symlinks.
2. **Never manually copy `.env.example` for testing** — the script copies the real root `.env` and `blockchain/.env`.
3. **E2E requires Kubo** — the script sets `IPFS_BACKEND=kubo` because local E2E asserts `Qm...` CIDs via `127.0.0.1:8080`.
4. **Use the worktree's `COMPOSE_PROJECT_NAME` for contract tests** — otherwise `test:contracts` targets the wrong containers.
5. **Clean up in order** — stop the worktree's Docker project, fix root-owned artifacts, then remove the git worktree.
6. **Do not commit worktree-specific files** — `.worktrees/` is gitignored; changes made inside a worktree should be applied to the main checkout.

## Workflow

### 1. Create the worktree

```bash
./scripts/create-worktree.sh feature-xyz
```

or via npm:

```bash
npm run worktree:create -- feature-xyz
```

The script:
- creates `.worktrees/feature-xyz`
- copies modified tracked files and untracked (non-ignored) files
- copies `.env` and `blockchain/.env`
- sets `IPFS_BACKEND=kubo`
- symlinks `node_modules`, `frontend/node_modules`, `blockchain/node_modules`
- builds the frontend
- compiles Solidity contracts via Docker

### 2. Run tests

```bash
cd .worktrees/feature-xyz

npm run test:frontend
npm run test:api
COMPOSE_PROJECT_NAME=$(./scripts/start-dev.sh --print-project) npm run test:contracts
npm run test:e2e -- --project=chromium
```

The script output prints the exact `COMPOSE_PROJECT_NAME` and backend port.

### 3. Clean up

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

## File Map

| File | Role |
|------|------|
| `scripts/create-worktree.sh` | Worktree creation helper |
| `e2e/lib/infra.mjs` | Derives per-worktree Compose project and backend port |
| `e2e/global-setup.mjs` | Starts E2E infrastructure on the worktree port |
| `e2e/global-teardown.mjs` | Stops the worktree backend |
| `scripts/start-dev.sh` | Starts dev stack using worktree-scoped Compose project |
| `package.json` | `worktree:create` npm script and worktree-aware `test:contracts` |

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| `test:frontend` fails on `frontend/dist/js` | Frontend not built; the script builds it automatically |
| `deployment-integrity` cannot find ABI artifacts | Contracts not compiled; the script compiles them automatically |
| `test:contracts` cannot find containers | Forgot `COMPOSE_PROJECT_NAME=<worktree-project>` prefix |
| E2E spec 03 fails with `fetch failed` | `e2e/specs/03-save-and-publish.spec.js` used a hardcoded port — already fixed to use `fetchTokenManifest()` |
| E2E spec 06 times out on save | Upload-credential rate limit exceeded — already fixed by raising `UPLOAD_URL_RATE_LIMIT_MAX` in E2E global setup |
| `git worktree remove` fails with permission denied | Run the `chown` cleanup step for `blockchain/artifacts` and `blockchain/deployments` |
