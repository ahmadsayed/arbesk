# HUMANS.md — your side of the workflow

Agents (Claude Code and others) follow [AGENTS.md](AGENTS.md), §13 "Life of a
Task". This page is the other half: what you do, and what you can expect from
them.

## Who does what

| The agent | You |
|---|---|
| Works in its own worktree, `.worktrees/<task>`, never in your checkout | Keep your own work in the main checkout; agents don't touch it |
| Tests, runs E2E when the change needs it, takes screenshots, opens a PR from the template | Choose tasks |
| Reviews its own PR and posts a verdict: ✅ ⚠️ ❌ | **Review and merge** the PR, or ask for changes |
| Asks you to try what it can't (a real wallet, a real provider, the live site) | Try it and say what happened |
| Finalizes after your merge: worktree and branches deleted, your `main` updated | Say "finalize" if a session ended before it did |
| Deploys to k3s when you ask | Ask for a deploy |

**Nothing reaches `main` unless you merged it.** Agents push only their task
branches, and merge only when you tell them to ("merge it"). GitHub enforces
the first part: `main` is protected, so a direct push is refused for everyone,
you included, as are force pushes and deleting `main`. A PR needs no approval
(GitHub won't let you approve your own). Agents act through your `gh`
account, so GitHub can't stop one from merging a PR: that part stays a rule
in AGENTS.md. To change the protection: Settings › Branches on GitHub.

## Life of a task

1. You ask for something ("fix the GC skipping 3MF parts").
2. The agent creates `.worktrees/<name>` on branch `<kind>/<name>`, from the
   latest `main`.
3. It writes a test, makes the change, runs the checks, and runs the E2E suite
   when the change touches the Studio, wallets, save/publish, contracts or
   storage.
4. It opens a PR: what it's for, what changes, before/after screenshots, how
   it was checked, and what isn't verified.
5. It posts a review comment with a verdict:
   - ✅ ready to merge;
   - ⚠️ something for you to decide, with options;
   - ❌ blocked, and why.
6. **You merge** (any merge button works: merge, squash or rebase), or
   comment with what to change; the agent pushes fixes to the same PR.
7. The agent finalizes: `scripts/end-task.sh <name>` stops the task's Docker
   stacks, deletes the worktree and the branch (local and on GitHub), and
   fast-forwards your `main` if it has no uncommitted changes.

## Useful commands

```sh
scripts/session-start.sh        # where things stand: main vs GitHub, worktrees, containers, open PRs, issues
scripts/end-task.sh <name>      # finalize a merged task yourself
gh pr list                      # PRs waiting for you
gh pr checkout <n>              # try a PR's branch locally
```

## Things only you can check

Each PR's "Not verified" section lists what the agent could not check, one
line per point. Typical ones:

- **Real providers.** Tests use the mock generator, a local chain and a local
  IPFS node. Tripo3D, Pinata, Base Sepolia and CDP email login behave
  differently in ways only a real run shows.
- **The live site.** A deploy can succeed while Cloudflare still serves the
  previous build. The deploy script checks this and says so in its last
  lines.
- **A real wallet.** MetaMask or Rabby prompts can't be clicked by an agent.

## Deploys

Ask: "deploy it to k3s". The agent runs `bun run deploy:k3s` from the main
checkout once it matches `origin/main`. A deploy changes no tracked file: the
image tag is stamped into the copies of the manifests sent to the cluster, so
there is nothing to commit afterwards. Runbook: `deploy/k8s/README.md`.

## Where things are

- `.worktrees/` holds the agents' task folders (ignored by git).
- The `captures` branch holds PR screenshots; it never merges into `main`.
- `.github/pull_request_template.md` is the shape of every PR.
