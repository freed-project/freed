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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/node-tooling.sh
source "${SCRIPT_DIR}/lib/node-tooling.sh"

if [[ $# -eq 0 ]]; then
  echo "Usage: ./scripts/worktree-add.sh <path> [-b <branch>] [<commit-ish>]"
  exit 1
fi

EXISTING_WORKTREES=()
while IFS= read -r line; do
  EXISTING_WORKTREES+=("$line")
done < <(git worktree list --porcelain | awk '/^worktree / { print $2 }')

git worktree add "$@"

CURRENT_WORKTREES=()
while IFS= read -r line; do
  CURRENT_WORKTREES+=("$line")
done < <(git worktree list --porcelain | awk '/^worktree / { print $2 }')

NEW_WT=""
for candidate in "${CURRENT_WORKTREES[@]}"; do
  if ! printf '%s\n' "${EXISTING_WORKTREES[@]}" | grep -Fxq "${candidate}"; then
    NEW_WT="${candidate}"
    break
  fi
done

if [[ -z "${NEW_WT}" ]]; then
  echo "Error: failed to detect the newly created worktree path." >&2
  exit 1
fi

NPM_BIN="$(resolve_npm_bin)"

echo ""
echo "Installing node_modules in $NEW_WT with $("${NPM_BIN}" -v) ..."
"${NPM_BIN}" ci --prefer-offline --prefix "$NEW_WT"
echo ""
echo "Done. Worktree is ready."
