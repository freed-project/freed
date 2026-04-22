#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: ./scripts/promote-dev-to-main.sh <worktree-path> [<branch-name>]" >&2
  exit 1
fi

WORKTREE_PATH="$1"
BRANCH_NAME="${2:-chore/promote-dev-to-main-$(date +%Y%m%d-%H%M%S)}"
TITLE="chore: promote dev into main for production release"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! git diff --quiet HEAD; then
  echo "Error: working tree is dirty. Commit or stash changes first." >&2
  exit 1
fi

git fetch origin dev main

if node "${SCRIPT_DIR}/validate-release-promotion.mjs" --from-ref=origin/dev --to-ref=origin/main >/dev/null 2>&1; then
  echo "origin/main already matches origin/dev on product-owned paths."
  exit 0
fi

"${SCRIPT_DIR}/worktree-add.sh" "${WORKTREE_PATH}" -b "${BRANCH_NAME}" origin/main --install auto --target shared

(
  cd "${WORKTREE_PATH}"
  git fetch origin dev main
  git merge --squash --no-commit origin/dev

  if git diff --cached --quiet; then
    echo "Error: no staged changes were produced while promoting origin/dev into main." >&2
    exit 1
  fi

  git commit -m "${TITLE}"

  BODY_FILE="$(mktemp)"
  trap 'rm -f "${BODY_FILE}"' EXIT
  DEV_SHA="$(git rev-parse origin/dev)"
  MAIN_SHA="$(git rev-parse origin/main)"

  cat > "${BODY_FILE}" <<EOF
## Summary
- Promote the current \`origin/dev\` product snapshot into \`main\` before a production release.
- Base main SHA: \`${MAIN_SHA}\`
- Source dev SHA: \`${DEV_SHA}\`

## Testing
- \`node scripts/validate-main-pr.mjs --base-ref=origin/main --head-ref=HEAD --head-branch=${BRANCH_NAME}\`
- CI
EOF

  "${SCRIPT_DIR}/worktree-publish.sh" \
    --base main \
    --title "${TITLE}" \
    --body-file "${BODY_FILE}"
)

echo "Promotion PR created from ${BRANCH_NAME}."
echo "After it merges, refresh main and run ./scripts/release.sh --channel=production"
