#!/usr/bin/env bash
# Start a task in a worktree of its own, from an up-to-date origin/main:
# .worktrees/<name> on branch <kind>/<name>. The main checkout, and any
# uncommitted work in it, is left alone. See "Life of a task" in AGENTS.md.
#
#   scripts/new-task.sh fix gc-skip-downloads
#   scripts/new-task.sh docs readme --light    # no frontend build, no contract compile
#
# The worktree gets the real .env files (IPFS_BACKEND forced to kubo: local
# E2E asserts Qm... CIDs through the Kubo gateway), links to the main
# checkout's node_modules, a built frontend and compiled contracts, and its
# own Compose project and ports (e2e/lib/infra.mjs).
set -euo pipefail

kinds="feat fix perf refactor docs test chore"
light=0
args=()
for arg in "$@"; do
  if [[ $arg == --light ]]; then light=1; else args+=("$arg"); fi
done
if [[ ${#args[@]} -ne 2 || " $kinds " != *" ${args[0]} "* || ! ${args[1]} =~ ^[a-z0-9][a-z0-9.-]*$ ]]; then
  echo "usage: $0 <$(tr ' ' '|' <<<"$kinds")> <name: lowercase letters, digits, dots and dashes> [--light]" >&2
  exit 2
fi
kind=${args[0]}
name=${args[1]}
branch="$kind/$name"

root=$(git rev-parse --path-format=absolute --git-common-dir)
root=$(dirname "$root")
dir="$root/.worktrees/$name"

if [[ -e $dir ]]; then
  echo "already exists: $dir" >&2
  exit 1
fi
if git -C "$root" show-ref --verify --quiet "refs/heads/$branch"; then
  echo "branch $branch already exists; finish or remove it first (scripts/end-task.sh $name)" >&2
  exit 1
fi

git -C "$root" fetch --quiet origin
git -C "$root" worktree add --quiet -b "$branch" "$dir" origin/main

# The real env files; .env.pinata is only read by `start-dev.sh --testnet`.
for file in .env blockchain/.env .env.pinata; do
  if [[ -f $root/$file ]]; then cp "$root/$file" "$dir/$file"; fi
done
if [[ -f $dir/.env ]]; then
  sed -i 's/^IPFS_BACKEND=.*/IPFS_BACKEND=kubo/' "$dir/.env"
else
  echo "note: no .env in $root; tests that need keys will fail" >&2
fi

# Share the main checkout's packages instead of installing them again.
# Workspace packages keep their own node_modules, which their builds need.
# The glob is expanded in the main checkout, wherever this script is run from.
while read -r modules; do
  if [[ -d $root/$modules && ! -e $dir/$modules && -d $(dirname "$dir/$modules") ]]; then
    ln -s "$root/$modules" "$dir/$modules"
  fi
done < <(cd "$root" && printf '%s\n' node_modules frontend/node_modules blockchain/node_modules packages/*/node_modules)

project=""
if [[ -x $dir/scripts/start-dev.sh ]]; then
  project=$(cd "$dir" && ./scripts/start-dev.sh --print-project)
fi
if [[ $light -eq 0 ]]; then
  # test:frontend needs both: the built frontend and the compiled ABIs.
  # Both run inside the worktree: Compose mounts ./blockchain of the directory
  # it is run from, so anywhere else the ABIs land in another checkout.
  (cd "$dir" && bun run build:frontend)
  (cd "$dir" && docker compose -p "$project" run --rm hardhat npx hardhat compile)
fi

echo "Task worktree: $dir"
echo "Branch:        $branch (from origin/main at $(git -C "$dir" rev-parse --short HEAD))"
if [[ -n $project ]]; then echo "Compose:       $project"; fi
if [[ -f $dir/e2e/lib/infra.mjs ]]; then
  (cd "$dir" && bun -e "import('./e2e/lib/infra.mjs').then(m => { const p = m.portsForWorker(0); console.log('Backend:       http://127.0.0.1:' + p.backendPort + '\nE2E stack:     hardhat ' + p.hardhatPort + ', ipfs ' + p.ipfsApiPort + '/' + p.ipfsGatewayPort + ', nostr ' + p.nostrPort + ' (worker 0; +1 per worker)'); })")
fi
if [[ $light -eq 1 ]]; then
  echo "Light: frontend not built, contracts not compiled (test:frontend and E2E need both)."
fi
