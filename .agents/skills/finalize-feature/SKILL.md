---
name: finalize-feature
description: Use when the user runs /finalize-feature or asks to finish, land, ship or wrap up a feature in this repo - merging a feature branch or worktree into main, pushing main to GitHub, running the E2E suite before it lands, or deleting the feature branch and its worktree afterwards.
---

# Finalize Feature

## Overview

Lands a finished feature on `main` in a fixed order: **verify, merge locally, E2E the merge result, push, clean up.** Nothing reaches `origin/main` until the merged commit has passed the unit checks and the full E2E suite. Invoking this skill authorizes the merge, the push to `main` and the cleanup it describes — but only for the feature's own commits.

## When to Use

- `/finalize-feature [branch-or-worktree]`, "ship this", "merge it into main", "land the feature and clean up"
- Not for committing work in progress — commit first, then finalize.

## Steps

**1. Identify the feature.** Use the argument, else the current branch / worktree (`git worktree list`, `git branch --show-current`). Already on `main` with commits ahead of `origin/main`? The feature is those commits; skip the merge and branch cleanup.

**2. Preflight — stop and ask on any of these:**
- Uncommitted changes in the feature worktree (`git status --short`). Commit only after reading the diff, with a message that describes it.
- Uncommitted changes in the **main checkout**: never fold them into the merge. `create-worktree.sh` copies modified files into the E2E worktree, so they would also pollute the E2E run.
- The feature branch isn't based on current `origin/main` and the rebase/merge conflicts.

**3. Verify the feature** (in its worktree): `bun run test:frontend`, `bun run test:api`, `bun run typecheck:frontend`, `bun run typecheck`, `bun run lint`, `bun run audit`. For any failure, check whether it also fails on `origin/main` (separate worktree at that commit) before blaming the feature — report pre-existing failures, don't fix them in this flow.

**4. Merge locally** (main checkout): `git fetch origin && git checkout main && git merge --ff-only origin/main && git merge --no-ff <branch>`. Don't push yet.

**5. E2E the merge result** in a fresh worktree — REQUIRED SUB-SKILL: `arbesk-worktree`:
```bash
bun run worktree:create -- finalize-e2e
cd .worktrees/finalize-e2e
NODE_OPTIONS='' npx playwright test --config=e2e/playwright.config.js --project=chromium --reporter=list
```
- Run it with `run_in_background`, **no `| tail`, no `timeout` wrapper** — the list reporter streams one line per test so progress is visible in `/tasks`, and the suite manages its own timeouts.
- A worktree has its own backend and service ports, so the user's dev server can stay up.
- On failure read `test-results/*/error-context.md`. A "flaky" test (fails, then passes on retry) is reported, not ignored. Don't push a failing suite.

**6. Push**: `git push origin main`. Confirm `git status -sb` shows `main...origin/main` with nothing ahead.

**7. Clean up** — only after the push succeeded:
- Each worktree you're removing (the E2E one and the feature's): run `docker compose -p "$P$s" down` for `s` in `""`, `-w1`, `-w2`, `-w3`, with `P=$(./scripts/start-dev.sh --print-project)` read inside that worktree. Then run the chown step from `arbesk-worktree`'s reference, then `git worktree remove <path> --force && git worktree prune`.
- Branch: `git branch -d <branch>` (lowercase `-d` refuses unmerged work — never `-D` here), then `git push origin --delete <branch>` if it exists on the remote.
- Check: `git worktree list`, `git branch -a`, `docker ps`.

**8. Report**: merged commit SHA, test and E2E counts (including flaky ones), anything pre-existing that still fails, and what was removed.

## Common Mistakes

| Mistake | Instead |
|---|---|
| Pushing before E2E passes | Merge locally, E2E, then push |
| Piping the E2E run through `tail` or wrapping it in `timeout` | `--reporter=list` in the background |
| Running E2E in the main checkout while a dev server holds 9090/7777 | Fresh worktree (own ports) |
| `pkill -f "<pattern>"` in the same command line as the pattern | Kill by PID — `-f` matches its own shell and kills it |
| `git add -A` / `git add -u` in a checkout with the user's unrelated edits | Stage named files after reading the diff |
| Deleting a branch with `-D` | `-d`; an unmerged branch means stop and ask |
