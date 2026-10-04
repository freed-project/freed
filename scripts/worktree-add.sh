#!/usr/bin/env bash
# worktree-add.sh
#
# Wrapper around `git worktree add` that can bootstrap dependencies now or
# later, while recording worktree intent for other local helpers.
#
# Usage:
#   ./scripts/worktree-add.sh ../freed-<slug> -b feat/my-feature origin/dev
#   ./scripts/worktree-add.sh ../freed-<slug> -b feat/my-feature origin/dev --install full --target desktop
#   ./scripts/worktree-add.sh ../freed-<slug> -b feat/my-feature origin/dev --swarm --target shared
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

# Directory resolution must not depend on caller shell navigation settings.
unset CDPATH

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/node-tooling.sh
source "${SCRIPT_DIR}/lib/node-tooling.sh"
# shellcheck source=./lib/worktree-runtime.sh
source "${SCRIPT_DIR}/lib/worktree-runtime.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/worktree-add.sh <path> [-b <branch>] [<commit-ish>] [--install none|auto|full] [--target desktop|pwa|website|shared] [--swarm]

Options:
  --install  Dependency bootstrap mode. Default: full
  --target   Hint for later bootstrap or preview commands
  --swarm    Alias for --install auto, tuned for speculative multi-thread worktrees
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
SWARM_MODE=false
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --swarm)
      SWARM_MODE=true
      INSTALL_MODE="auto"
      shift
      ;;
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
    --)
      PASSTHROUGH_ARGS+=("$@")
      break
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
# Machine preflight, warn-only: report broken tooling before worktree work.
"$(resolve_node_bin)" "${SCRIPT_DIR}/doctor.mjs" || true

# Resolve the path supplied to this invocation, never a difference between
# global worktree lists: another caller can create a worktree concurrently.
REQUESTED_PATH=""
EXPECT_VALUE=false
OPTIONS_ENDED=false
for arg in "${PASSTHROUGH_ARGS[@]}"; do
  if ${EXPECT_VALUE}; then
    EXPECT_VALUE=false
    continue
  fi
  if ! ${OPTIONS_ENDED}; then
    case "${arg}" in
      --) OPTIONS_ENDED=true; continue ;;
      --*)
        # Git accepts unambiguous long-option abbreviations. Resolve them
        # against the worktree-add options before deciding whether to skip a value.
        option="${arg%%=*}"
        matches=()
        for known in force detach checkout lock quiet track guess-remote reason no-force no-detach no-checkout no-lock no-quiet no-track no-guess-remote no-reason; do
          if [[ "--${known}" == "${option}" ]]; then
            matches=("${known}")
            break
          fi
          if [[ "--${known}" == "${option}"* ]]; then
            matches+=("${known}")
          fi
        done
        if [[ ${#matches[@]} -ne 1 ]]; then
          echo "Error: ambiguous or unsupported worktree option '${arg}'." >&2
          exit 1
        fi
        if [[ "${matches[0]}" == reason && "${arg}" != *=* ]]; then
          EXPECT_VALUE=true
        fi
        continue
        ;;
      -?*)
        # Short flags may be clustered; -b/-B consume the remaining suffix
        # as their branch name, or the next argument when that suffix is empty.
        short_options="${arg#-}"
        while [[ -n "${short_options}" ]]; do
          flag="${short_options:0:1}"
          short_options="${short_options:1}"
          case "${flag}" in
            f|d|q) ;;
            b|B)
              [[ -n "${short_options}" ]] || EXPECT_VALUE=true
              break
              ;;
            *)
              echo "Error: unsupported worktree option '${arg}'." >&2
              exit 1
              ;;
          esac
        done
        continue
        ;;
    esac
  fi
  REQUESTED_PATH="${arg}"
  break
done
if [[ -z "${REQUESTED_PATH}" ]]; then
  echo "Error: a worktree destination is required." >&2
  exit 1
fi

# Pin repository identity before Git creates the worktree. Verify the requested
# directory is its own worktree root in this repository before initialization.
if [[ "${REQUESTED_PATH}" != /* ]]; then
  REQUESTED_PATH="$(pwd -P)/${REQUESTED_PATH}"
fi
COMMON_DIR="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
git worktree add "${PASSTHROUGH_ARGS[@]}"
NEW_WT="$(cd "${REQUESTED_PATH}" && pwd -P)"
CREATED_ROOT="$(git -C "${NEW_WT}" rev-parse --show-toplevel)"
CREATED_ROOT="$(cd "${CREATED_ROOT}" && pwd -P)"
CREATED_COMMON="$(git -C "${NEW_WT}" rev-parse --git-common-dir)"
CREATED_COMMON="$(cd "${NEW_WT}" && cd "${CREATED_COMMON}" && pwd -P)"
if [[ "${CREATED_ROOT}" != "${NEW_WT}" || "${CREATED_COMMON}" != "${COMMON_DIR}" ]]; then
  echo "Error: requested destination is not the created worktree in this repository." >&2
  exit 1
fi

record_worktree_metadata "${NEW_WT}" "${INSTALL_MODE}" "${TARGET_HINT}"
"$(resolve_node_bin)" "${SCRIPT_DIR}/task-decisions.mjs" init --worktree "${NEW_WT}"

echo ""
case "${INSTALL_MODE}" in
  none)
    echo "Created ${NEW_WT} with dependency bootstrap disabled."
    ;;
  auto)
    echo "Created ${NEW_WT} with deferred bootstrap."
    if ${SWARM_MODE}; then
      echo "Swarm mode is on, so bootstrap is deferred until this thread actually needs it."
    fi
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
