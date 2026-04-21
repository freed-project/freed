#!/usr/bin/env bash
# worktree-add.sh
#
# Wrapper around `git worktree add` that immediately runs a compatible `npm ci`
# so the new worktree has its own isolated node_modules and is ready to use.
#
# Usage (identical args to git worktree add):
#   ./scripts/worktree-add.sh ../freed-<slug> -b feat/my-feature
#
# Why not symlink node_modules from the primary worktree?
#   npm writes *through* symlinks. Running `npm install foo` in a symlinked
#   worktree physically modifies the primary worktree's node_modules and
#   silently corrupts every other worktree sharing that link. Isolated
#   installs are the only safe option.
#
# Why is this fast?
#   `npm ci --prefer-offline` skips dependency resolution (reads the lockfile
#   directly) and pulls all packages from the local npm cache (~/.npm).
#   With a warm cache this takes ~74s vs ~170s for a cold `npm install`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ $# -eq 0 ]]; then
  echo "Usage: ./scripts/worktree-add.sh <path> [-b <branch>] [<commit-ish>]"
  exit 1
fi

BEFORE_WORKTREES=()
while IFS= read -r worktree_path; do
  BEFORE_WORKTREES+=("$worktree_path")
done < <(git worktree list --porcelain | awk '/^worktree / { print $2 }')
git worktree add "$@"

AFTER_WORKTREES=()
while IFS= read -r worktree_path; do
  AFTER_WORKTREES+=("$worktree_path")
done < <(git worktree list --porcelain | awk '/^worktree / { print $2 }')
NEW_WT=""

for candidate in "${AFTER_WORKTREES[@]}"; do
  found="false"
  for existing in "${BEFORE_WORKTREES[@]}"; do
    if [[ "$candidate" == "$existing" ]]; then
      found="true"
      break
    fi
  done

  if [[ "$found" == "false" ]]; then
    NEW_WT="$candidate"
    break
  fi
done

if [[ -z "$NEW_WT" ]]; then
  echo "Failed to resolve the new worktree path after git worktree add." >&2
  exit 1
fi

echo ""
echo "Installing node_modules in $NEW_WT (~74s with warm cache) ..."
node "${ROOT_DIR}/scripts/npmw.mjs" ci --prefer-offline --prefix "$NEW_WT"
echo ""
echo "Done. Worktree is ready."
