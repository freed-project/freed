#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <promoted-dev-sha>" >&2
  exit 1
fi

SNAPSHOT_SHA_INPUT="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./lib/node-tooling.sh
source "${SCRIPT_DIR}/lib/node-tooling.sh"
use_resolved_node_path
NODE_BIN="$(resolve_node_bin)"

cd "${REPO_ROOT}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: production snapshot deployment requires a clean worktree." >&2
  exit 1
fi

if [[ ! "${SNAPSHOT_SHA_INPUT}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Error: promoted dev snapshot must be one full 40-character commit SHA." >&2
  exit 1
fi

git fetch origin main
SNAPSHOT_SHA="$(git rev-parse "${SNAPSHOT_SHA_INPUT}^{commit}")"
MAIN_SHA="$(git rev-parse origin/main)"
HEAD_SHA="$(git rev-parse HEAD)"

if [[ "${SNAPSHOT_SHA}" != "${SNAPSHOT_SHA_INPUT}" ]]; then
  echo "Error: promoted dev snapshot must name one exact commit without abbreviation." >&2
  exit 1
fi
if [[ "${HEAD_SHA}" != "${MAIN_SHA}" ]]; then
  echo "Error: production snapshot deployment must run from exact origin/main ${MAIN_SHA}; HEAD is ${HEAD_SHA}." >&2
  exit 1
fi

"${NODE_BIN}" scripts/validate-release-promotion.mjs \
  --from-ref="${SNAPSHOT_SHA}" \
  --to-ref="${MAIN_SHA}"

echo "Deploying production PWA snapshot from main ${MAIN_SHA}, selected from dev ${SNAPSHOT_SHA}."
FREED_BUILD_KIND=snapshot \
FREED_BUILD_CHANNEL=production \
FREED_BUILD_COMMIT_SHA="${MAIN_SHA}" \
FREED_BUILD_COMMIT_REF=main \
  "${SCRIPT_DIR}/vercel-deploy-production.sh" pwa

echo "Production PWA snapshot deployed."
echo "Main SHA: ${MAIN_SHA}"
echo "Promoted dev SHA: ${SNAPSHOT_SHA}"
