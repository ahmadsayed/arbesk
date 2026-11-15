---
name: finalize-feature
description: Use when the user runs /finalize-feature or asks to finish, land, ship, merge or wrap up a feature or fix in this repo - opening its pull request, merging the PR when told to, or cleaning up the worktree and branches after the merge.
---

# Finalize Feature

Lands a finished task the way AGENTS.md §13 describes: **verify, E2E, pull request, self-review, stop.** The human merges. Nothing is pushed to `main` directly; `main` is protected.

Which part to run depends on where the task is:

| State | Do |
|---|---|
| Work committed on a task branch, no PR yet | Part 1 |
| PR open, the user says "merge it" | Part 2 |
| PR already merged | Part 3 |

Not for committing work in progress: commit first, then finalize.

## Part 1 — open the pull request

1. **Identify the task**: the argument, else the current worktree and branch. Work that sits on `main` or in the main checkout does not go further: move it to a task branch (`scripts/new-task.sh`) and ask before touching anything uncommitted there.
2. **Preflight, stop and ask on either**: uncommitted changes in the task worktree (commit only after reading the diff); a rebase onto `origin/main` that conflicts.
3. **Rebase** onto the current `origin/main` (`git fetch origin`, `git rebase origin/main`), so what you test is what the merge will produce.
4. **Verify** in the worktree: `bun run test:frontend`, `bun run test:api`, `bun run typecheck:frontend`, `bun run typecheck`, `bun run lint`, `bun run audit`. For a failure, check whether `origin/main` fails the same way before blaming the task; report pre-existing failures, don't fix them here.
5. **E2E**, when the change is on the AGENTS.md §10 list:
   ```bash
   NODE_OPTIONS='' npx playwright test --config=e2e/playwright.config.js --project=chromium --reporter=list
   ```
   Run it with `run_in_background`, no `| tail`, no `timeout` wrapper: the list reporter streams one line per test and the suite manages its own timeouts. On failure read `test-results/*/error-context.md`. A test that fails and then passes on retry is reported in the PR, not ignored. Don't open a PR on a failing suite.
6. **Push the branch and open the PR** (AGENTS.md §14): screenshots through `scripts/pr-screenshots.sh`, body from `.github/pull_request_template.md` written to a file outside the repo, `gh pr create --base main --title "…" --body-file <file>`. "How it was checked" ticks only what ran, with counts. "Not verified" lists what could not be checked here.
7. **Self-review** the PR and post the comment (format in §14). Fix what you find first.
8. **Hand over and stop**: the link, the verdict, what to look at or try.

## Part 2 — merge, only when the user says so

`gh pr merge <n> --merge`, then Part 3. Never merge on your own judgement, and never because checks are green.

## Part 3 — after the merge

From the main checkout: `scripts/end-task.sh <name>`. Then report: the merged commit, test and E2E counts, anything pre-existing that still fails, what was removed. If the script refuses, read why; do not force it.

## Common mistakes

| Mistake | Instead |
|---|---|
| Pushing to `main`, or merging locally and pushing | Open a PR; the human merges |
| Opening the PR before E2E passes | E2E on the rebased branch first |
| Piping the E2E run through `tail` or wrapping it in `timeout` | `--reporter=list` in the background |
| Running E2E in the main checkout while a dev server holds 9090/7777 | The task worktree has its own ports |
| `pkill -f "<pattern>"` in the same command line as the pattern | Kill by PID; `-f` matches its own shell |
| `git add -A` in a checkout with unrelated edits | Stage named files after reading the diff |
| Deleting a branch or worktree by hand after the merge | `scripts/end-task.sh`, which checks nothing is lost |
