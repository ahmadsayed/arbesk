#!/usr/bin/env bash
# Finalize a task started with scripts/new-task.sh, once its PR is merged:
# stop its Docker stacks, delete its worktree (build output included), its
# local branch and its branch on GitHub, then fast-forward the main checkout
# if it is clean. Refuses while anything would be lost: uncommitted files, or
# commits that are on neither origin/main (directly, rebased or cherry-picked)
# nor a merged PR (a squash merge).
#
#   scripts/end-task.sh gc-skip-downloads
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <name>" >&2
  exit 2
fi
name=$1
root=$(git rev-parse --path-format=absolute --git-common-dir)
root=$(dirname "$root")
dir="$root/.worktrees/$name"

if [[ ! -d $dir ]]; then
  echo "no task worktree: $dir" >&2
  exit 1
fi
case "$PWD/" in
  "$dir"/*)
    echo "run this from outside the worktree (e.g. cd $root)" >&2
    exit 1
    ;;
esac

branch=$(git -C "$dir" branch --show-current)
if [[ -z $branch ]]; then
  echo "$dir is on a detached HEAD; put its work on a branch first" >&2
  exit 1
fi
changes=$(git -C "$dir" status --porcelain)
if [[ -n $changes ]]; then
  echo "uncommitted changes in $dir; commit or discard them first:" >&2
  echo "$changes" >&2
  exit 1
fi

git -C "$root" fetch --quiet origin
# "+" lines are commits with no identical change on origin/main. A squash
# merge leaves them all "+", so a PR merged on GitHub from exactly this
# branch's last commit counts as merged too.
unmerged=$(git -C "$root" cherry -v origin/main "$branch" | grep '^+' || true)
if [[ -n $unmerged ]]; then
  head=$(git -C "$root" rev-parse "$branch")
  source "$(dirname "${BASH_SOURCE[0]}")/github.sh"
  merged_pr=$(gh_merged_pr "$branch" "$head" 2>/dev/null || true)
  if [[ -z $merged_pr ]]; then
    echo "$branch has commits that are not on origin/main, and no merged PR of its last commit:" >&2
    echo "$unmerged" >&2
    exit 1
  fi
  echo "PR #$merged_pr merged $branch"
fi

# The worktree's own Docker stacks: worker 0 and the extra E2E workers.
if [[ -x $dir/scripts/start-dev.sh ]] && command -v docker >/dev/null; then
  project=$(cd "$dir" && ./scripts/start-dev.sh --print-project 2>/dev/null) || project=""
  if [[ -n $project ]]; then
    for suffix in "" -w1 -w2 -w3 -w4 -w5 -w6 -w7; do
      docker compose -p "$project$suffix" down >/dev/null 2>&1 || true
    done
  fi
  # Docker leaves root-owned build output, which `git worktree remove` cannot delete.
  if [[ -d $dir/blockchain/artifacts || -d $dir/blockchain/deployments ]]; then
    docker run --rm -v "$dir:/ws" alpine sh -c \
      'chown -R $(stat -c "%u:%g" /ws) /ws/blockchain/artifacts /ws/blockchain/deployments 2>/dev/null || true' \
      >/dev/null 2>&1 || true
  fi
fi

find "$dir" -maxdepth 3 -name node_modules -type l -delete
# Only ignored files are left (build output, copied .env files), so --force loses nothing.
git -C "$root" worktree remove --force "$dir"
git -C "$root" worktree prune
git -C "$root" branch -D "$branch" >/dev/null
if git -C "$root" ls-remote --exit-code --heads origin "$branch" >/dev/null; then
  if git -C "$root" push --quiet origin --delete "$branch"; then
    echo "Deleted $branch on GitHub"
  else
    echo "!! Could not delete $branch on GitHub; delete it there (the PR page has a button)"
  fi
fi
echo "Removed $dir and branch $branch"

# Bring the main checkout up to date, only when that can't disturb anything:
# it may hold the human's own uncommitted work.
if [[ $(git -C "$root" branch --show-current) == main && -z $(git -C "$root" status --porcelain) ]]; then
  git -C "$root" merge --quiet --ff-only origin/main &&
    echo "main is now at $(git -C "$root" log -1 --format='%h %s')"
else
  echo "Left the main checkout alone (not on main, or it has changes); update it with: git pull --ff-only"
fi
