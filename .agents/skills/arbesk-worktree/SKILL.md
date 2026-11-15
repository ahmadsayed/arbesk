---
name: arbesk-worktree
description: Use when the user asks to create a git worktree, run tests in a linked worktree, isolate Docker/test infrastructure from the main checkout, or verify changes from a fresh worktree. In this repo, use this instead of superpowers:using-git-worktrees.
---

# Arbesk Worktree

In this repo this replaces `superpowers:using-git-worktrees`, also when `executing-plans` or `subagent-driven-development` asks for a worktree. The generic skill skips the per-worktree Compose project, ports and `IPFS_BACKEND=kubo`. Where the worktree sits in the whole task: AGENTS.md §13.

## Create and test

```bash
scripts/new-task.sh feat feature-xyz     # .worktrees/feature-xyz on branch feat/feature-xyz, from origin/main
cd .worktrees/feature-xyz
bun run test:frontend && bun run test:api
COMPOSE_PROJECT_NAME=$(./scripts/start-dev.sh --print-project) bun run test:contracts
bun run test:e2e -- --project=chromium
```

- Kinds: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `chore`. `--light` skips the frontend build and the contract compile, for tasks that need neither (docs, scripts); `test:frontend` and E2E need both.
- The worktree starts from `origin/main`, not from the main checkout: uncommitted work there is not copied and not touched.
- The script copies the real `.env`, `blockchain/.env` and `.env.pinata`, and links `node_modules`. Never hand-copy `.env.example`.
- It forces `IPFS_BACKEND=kubo`: local E2E asserts `Qm…` CIDs through `127.0.0.1:8080`.
- Each worktree has its own Compose project, backend port and service ports, so E2E can run while the main checkout's dev server is up.
- `test:contracts` without the `COMPOSE_PROJECT_NAME` prefix targets the main checkout's containers.

## Clean up

After the PR is merged, from the main checkout: `scripts/end-task.sh feature-xyz`. It refuses while the worktree has uncommitted files or unmerged commits, then stops the worktree's Docker stacks, fixes root-owned build output, and deletes the worktree and its branch locally and on GitHub.

To drop a worktree whose work you do not want, say so to the user first; `end-task.sh` will not do it.
