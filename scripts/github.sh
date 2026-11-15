# GitHub queries for the task scripts, through the REST API (`gh api`), which
# fills in {owner} and {repo} from the git remote. Source this file; each
# function prints its result and fails when the request fails.

# owner/name of the repository.
gh_repo() { gh api 'repos/{owner}/{repo}' --jq .full_name; }

# The number of the PR merged into main from branch $1 whose last commit was
# $2 (a squash merge leaves the branch's own commits off main). Empty when none.
gh_merged_pr() {
  gh api "repos/{owner}/{repo}/pulls?state=closed&head={owner}:$1&per_page=100" \
    --jq ".[] | select(.merged_at != null and .base.ref == \"main\" and .head.sha == \"$2\") | .number" | head -1
}

# Open PRs, one per line: number, draft mark, title, link.
gh_open_prs() {
  gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' \
    --jq '.[] | "#\(.number)\(if .draft then " (draft)" else "" end) \(.title)  \(.html_url)"'
}

# Open issues (pull requests left out): number, title, labels.
gh_open_issues() {
  gh api 'repos/{owner}/{repo}/issues?state=open&per_page=50' \
    --jq '.[] | select(.pull_request == null) | "#\(.number) \(.title)\(if (.labels | length) > 0 then "  [\([.labels[].name] | join(", "))]" else "" end)"'
}
