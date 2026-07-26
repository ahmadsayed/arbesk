---
name: arbesk-worktree
description: Use when the user asks to create a git worktree, run tests in a linked worktree, isolate Docker/test infrastructure from the main checkout, or verify changes from a fresh worktree.
---

# Arbesk Worktree Testing

Create a git worktree and run the full test stack without colliding with the main checkout's Docker containers or ports.

## Quick Decision

| Question | Action |
|----------|--------|
| Clean env to test current changes? | `scripts/create-worktree.sh <name>` |
| Port/container clashes with main checkout? | Worktree gets its own Compose project + backend port |
| E2E but main `.env` uses Pinata? | Script forces `IPFS_BACKEND=kubo` in worktree `.env` |
| Done with worktree? | `docker compose -p <project> down` → `git worktree remove .worktrees/<name>` |

## Key Rules

1. **Always use the helper script** — seeds worktree with current changes, real env files, node_modules symlinks.
2. **Never hand-copy `.env.example`** — script copies the real root `.env` + `blockchain/.env`.
3. **E2E requires Kubo** — local E2E asserts `Qm...` CIDs via `127.0.0.1:8080`.
4. **Prefix `COMPOSE_PROJECT_NAME` for contract tests** — else `test:contracts` targets the wrong containers.
5. **Clean up in order** — stop Docker project → chown root-owned artifacts → remove worktree.
6. **Don't commit worktree files** — `.worktrees/` is gitignored; apply changes to the main checkout.

## Workflow

```bash
npm run worktree:create -- feature-xyz   # prints COMPOSE_PROJECT_NAME + backend port
cd .worktrees/feature-xyz
npm run test:frontend && npm run test:api
COMPOSE_PROJECT_NAME=$(./scripts/start-dev.sh --print-project) npm run test:contracts
npm run test:e2e -- --project=chromium
```

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| `test:frontend` fails on `frontend/dist/js` | Frontend not built — script builds it automatically |
| `deployment-integrity` can't find ABI artifacts | Contracts not compiled — script compiles them |
| `test:contracts` can't find containers | Missing `COMPOSE_PROJECT_NAME=<worktree-project>` prefix |
| E2E 03 `fetch failed` | Was a hardcoded port — fixed via `fetchTokenManifest()`; never re-hardcode |
| E2E 06 save timeout | Upload-credential rate limit — fixed by raising `UPLOAD_URL_RATE_LIMIT_MAX` in E2E global setup |
| `git worktree remove` permission denied | Run chown cleanup on `blockchain/artifacts` + `blockchain/deployments` (see `reference.md`) |

## Reference

Read `reference.md` when you need the full `create-worktree.sh` behavior list, the infra file map, or the complete cleanup/chown commands.
