#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/node-tooling.sh
source "${SCRIPT_DIR}/lib/node-tooling.sh"
# shellcheck source=./lib/worktree-runtime.sh
source "${SCRIPT_DIR}/lib/worktree-runtime.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/worktree-bootstrap.sh <worktree> [--target desktop|pwa|website|shared]

Installs dependencies on demand for a specific worktree.
EOF
}

validate_target_hint() {
  case "$1" in
    desktop|pwa|website|shared) ;;
    *)
      echo "Error: unsupported target '$1'. Use desktop, pwa, website, or shared." >&2
      exit 1
      ;;
  esac
}

WORKTREE_PATH=""
TARGET_HINT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || { echo "Error: --target requires a value." >&2; exit 1; }
      TARGET_HINT="$2"
      shift 2
      ;;
    --target=*)
      TARGET_HINT="${1#*=}"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      if [[ -n "${WORKTREE_PATH}" ]]; then
        echo "Error: unexpected argument '$1'." >&2
        usage
        exit 1
      fi
      WORKTREE_PATH="$1"
      shift
      ;;
  esac
done

if [[ -z "${WORKTREE_PATH}" ]]; then
  usage
  exit 1
fi

WORKTREE_PATH="$(resolve_worktree_path "${WORKTREE_PATH}")"

if [[ -z "${TARGET_HINT}" ]]; then
  load_worktree_metadata "${WORKTREE_PATH}" 2>/dev/null || true
fi

if [[ -z "${TARGET_HINT}" ]]; then
  TARGET_HINT="shared"
fi

validate_target_hint "${TARGET_HINT}"

if [[ -d "${WORKTREE_PATH}/node_modules" ]]; then
  print_node_tooling_preflight
  echo "Dependencies already present in ${WORKTREE_PATH}."
  exit 0
fi

NPM_BIN="$(resolve_npm_bin)"
NPM_VERSION="$("${NPM_BIN}" -v)"

print_node_tooling_preflight
echo "Bootstrapping ${WORKTREE_PATH}"
echo "Target: ${TARGET_HINT}"

if [[ "${TARGET_HINT}" == "shared" ]]; then
  echo "Shared-only bootstrap still uses the root workspace install with the current npm lockfile layout."
fi

"${NPM_BIN}" ci --prefer-offline --prefix "${WORKTREE_PATH}"
record_worktree_metadata "${WORKTREE_PATH}" "full" "${TARGET_HINT}"

echo "Bootstrap complete."
