#!/usr/bin/env bash
# worktree-cleanup.sh
#
# Removes worktrees and local branches for PRs that have already been merged
# on GitHub. Run this from the primary worktree (the repo root).
#
# Usage:
#   ./scripts/worktree-cleanup.sh          # interactive: confirms each removal
#   ./scripts/worktree-cleanup.sh --yes    # non-interactive: removes everything
#
# How it works:
#   1. Lists every git worktree except the primary one.
#   2. For each worktree's branch, checks whether a PR with that head branch
#      has been merged on GitHub (via `gh pr list --state merged`).
#   3. If merged, removes the worktree directory and force-deletes the local
#      branch.
#
# Why -D (force) instead of -d for branch deletion:
#   Squash merges create a new commit hash on the target branch. The original
#   branch commits are never reachable from the target branch history, so
#   git -d always rejects them even though the content is already shipped.
#   -D is correct here.

set -euo pipefail

YES=false
if [[ "${1:-}" == "--yes" ]]; then
  YES=true
fi

confirm() {
  local msg="$1"
  if $YES; then
    echo "  [auto] $msg"
    return 0
  fi
  read -r -p "  $msg [y/N] " reply
  [[ "${reply,,}" == "y" ]]
}

PRIMARY=$(git worktree list --porcelain | awk 'NR==1 && /^worktree/ {print $2}')
echo "Primary worktree: $PRIMARY"
echo ""

# Collect worktree paths and their branches, skipping the primary.
declare -a PATHS BRANCHES

while IFS= read -r line; do
  if [[ "$line" =~ ^worktree\ (.+)$ ]]; then
    wt_path="${BASH_REMATCH[1]}"
  elif [[ "$line" =~ ^branch\ refs/heads/(.+)$ ]]; then
    wt_branch="${BASH_REMATCH[1]}"
  elif [[ -z "$line" ]]; then
    # End of a stanza.
    if [[ "${wt_path:-}" != "$PRIMARY" && -n "${wt_branch:-}" ]]; then
      PATHS+=("$wt_path")
      BRANCHES+=("$wt_branch")
    fi
    unset wt_path wt_branch
  fi
done < <(git worktree list --porcelain; echo "")

if [[ ${#PATHS[@]} -eq 0 ]]; then
  echo "No non-primary worktrees found. Nothing to do."
  exit 0
fi

removed=0
skipped=0

for i in "${!PATHS[@]}"; do
  path="${PATHS[$i]}"
  branch="${BRANCHES[$i]}"

  echo "Checking $branch ($path) ..."

  # Ask GitHub if a PR for this branch has been merged.
  pr_info=$(gh pr list --state merged --head "$branch" --json number,mergedAt --limit 1 2>/dev/null || true)
  pr_number=$(echo "$pr_info" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['number'] if d else '')" 2>/dev/null || true)

  if [[ -z "$pr_number" ]]; then
    echo "  -> No merged PR found. Skipping (branch may still be in flight)."
    skipped=$((skipped + 1))
    continue
  fi

  echo "  -> Merged via PR #$pr_number"

  if confirm "Remove worktree '$path' and delete branch '$branch'?"; then
    git worktree remove --force "$path"
    # -D because squash merges leave branch commits unreachable from the
    # target branch.
    git branch -D "$branch" 2>/dev/null || true
    echo "  Removed."
    removed=$((removed + 1))
  else
    echo "  Skipped."
    skipped=$((skipped + 1))
  fi
  echo ""
done

# Also clean up local branches with [gone] tracking refs that have no worktree.
echo "Checking for stale local branches (no worktree, remote gone) ..."
while IFS= read -r line; do
  branch=$(echo "$line" | awk '{print $1}')
  [[ -z "$branch" || "$branch" == "main" || "$branch" == "dev" ]] && continue

  pr_info=$(gh pr list --state merged --head "$branch" --json number --limit 1 2>/dev/null || true)
  pr_number=$(echo "$pr_info" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['number'] if d else '')" 2>/dev/null || true)
  if [[ -n "$pr_number" ]]; then
    echo "  $branch -> PR #$pr_number merged"
    if confirm "Delete local branch '$branch'?"; then
      git branch -D "$branch"
      echo "  Deleted."
      removed=$((removed + 1))
    else
      skipped=$((skipped + 1))
    fi
  fi
done < <(git branch -vv | grep '\[.*: gone\]' | awk '{print $1}')

echo ""
echo "Done. Removed: $removed  Skipped: $skipped"
