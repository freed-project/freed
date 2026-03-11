#!/usr/bin/env bash
# worktree-add.sh
#
# Wrapper around `git worktree add` that immediately runs `npm ci` so the
# new worktree has its own isolated node_modules and is ready to use.
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

if [[ $# -eq 0 ]]; then
  echo "Usage: ./scripts/worktree-add.sh <path> [-b <branch>] [<commit-ish>]"
  exit 1
fi

git worktree add "$@"

# The new worktree is always the last entry in the list.
NEW_WT=$(git worktree list --porcelain | awk '/^worktree/ {path=$2} END {print path}')

echo ""
echo "Installing node_modules in $NEW_WT (~74s with warm cache) ..."
npm ci --prefer-offline --prefix "$NEW_WT"
echo ""
echo "Done. Worktree is ready."
