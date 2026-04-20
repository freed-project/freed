#!/usr/bin/env bash
# worktree-add.sh
#
# Wrapper around `git worktree add` that can bootstrap dependencies now or
# later, while recording worktree intent for other local helpers.
#
# Usage:
#   ./scripts/worktree-add.sh ../freed-<slug> -b feat/my-feature origin/dev
#   ./scripts/worktree-add.sh ../freed-<slug> -b feat/my-feature origin/dev --install full --target desktop
#
# Why not symlink node_modules from the primary worktree?
#   npm writes *through* symlinks. Running `npm install foo` in a symlinked
#   worktree physically modifies the primary worktree's node_modules and
#   silently corrupts every other worktree sharing that link. Isolated
#   installs are the only safe option.
#
# Why keep deferred installs around?
#   Some speculative or low-touch worktrees do not need a full dependency tree
#   yet. `--install auto` and `--install none` still exist for those cases, but
#   the default is now "ready to run" so active feature work does not trip over
#   missing dependencies on the next command.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/node-tooling.sh
source "${SCRIPT_DIR}/lib/node-tooling.sh"
# shellcheck source=./lib/worktree-runtime.sh
source "${SCRIPT_DIR}/lib/worktree-runtime.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/worktree-add.sh <path> [-b <branch>] [<commit-ish>] [--install none|auto|full] [--target desktop|pwa|website|shared]

Options:
  --install  Dependency bootstrap mode. Default: full
  --target   Hint for later bootstrap or preview commands
EOF
}

validate_install_mode() {
  case "$1" in
    none|auto|full) ;;
    *)
      echo "Error: unsupported install mode '$1'. Use none, auto, or full." >&2
      exit 1
      ;;
  esac
}

validate_target_hint() {
  if [[ -z "$1" ]]; then
    return 0
  fi

  case "$1" in
    desktop|pwa|website|shared) ;;
    *)
      echo "Error: unsupported target '$1'. Use desktop, pwa, website, or shared." >&2
      exit 1
      ;;
  esac
}

INSTALL_MODE="full"
TARGET_HINT=""
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      [[ $# -ge 2 ]] || { echo "Error: --install requires a value." >&2; exit 1; }
      INSTALL_MODE="$2"
      shift 2
      ;;
    --install=*)
      INSTALL_MODE="${1#*=}"
      shift
      ;;
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
      PASSTHROUGH_ARGS+=("$1")
      shift
      ;;
  esac
done

validate_install_mode "${INSTALL_MODE}"
validate_target_hint "${TARGET_HINT}"

if [[ ${#PASSTHROUGH_ARGS[@]} -eq 0 ]]; then
  usage
  exit 1
fi

print_node_tooling_preflight

EXISTING_WORKTREES=()
while IFS= read -r line; do
  EXISTING_WORKTREES+=("$line")
done < <(git worktree list --porcelain | awk '/^worktree / { print $2 }')

git worktree add "${PASSTHROUGH_ARGS[@]}"

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

record_worktree_metadata "${NEW_WT}" "${INSTALL_MODE}" "${TARGET_HINT}"

echo ""
case "${INSTALL_MODE}" in
  none)
    echo "Created ${NEW_WT} with dependency bootstrap disabled."
    ;;
  auto)
    echo "Created ${NEW_WT} with deferred bootstrap."
    if [[ -n "${TARGET_HINT}" ]]; then
      echo "When this worktree needs dependencies, run:"
      echo "  ./scripts/worktree-bootstrap.sh \"${NEW_WT}\" --target ${TARGET_HINT}"
    else
      echo "When this worktree needs dependencies, run:"
      echo "  ./scripts/worktree-bootstrap.sh \"${NEW_WT}\""
    fi
    ;;
  full)
    if [[ -n "${TARGET_HINT}" ]]; then
      "${SCRIPT_DIR}/worktree-bootstrap.sh" "${NEW_WT}" --target "${TARGET_HINT}"
    else
      "${SCRIPT_DIR}/worktree-bootstrap.sh" "${NEW_WT}"
    fi
    ;;
esac

echo ""
echo "Done. Worktree is ready."
