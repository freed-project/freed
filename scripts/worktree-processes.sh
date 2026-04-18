#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/worktree-runtime.sh
source "${SCRIPT_DIR}/lib/worktree-runtime.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/worktree-processes.sh list [--worktree <path>] [--kind desktop|web] [--target <name>]
  ./scripts/worktree-processes.sh stop [--worktree <path>] [--kind desktop|web] [--target <name>]
  ./scripts/worktree-processes.sh prune

Internal:
  ./scripts/worktree-processes.sh claim --kind <desktop|web> --worktree <path> --pid <pid>
  ./scripts/worktree-processes.sh track --pid <pid> --kind <desktop|web> --target <name> --worktree <path> [--port <port>] [--log <path>] --command <command>
  ./scripts/worktree-processes.sh release --kind <desktop|web> [--pid <pid>]
EOF
}

validate_kind() {
  case "$1" in
    desktop|web) ;;
    *)
      echo "Error: unsupported process kind '$1'. Use desktop or web." >&2
      exit 1
      ;;
  esac
}

matches_filters() {
  local expected_path="$1"
  local expected_kind="$2"
  local expected_target="$3"

  if [[ -n "${expected_path}" && "${WORKTREE_PATH:-}" != "${expected_path}" ]]; then
    return 1
  fi

  if [[ -n "${expected_kind}" && "${PROCESS_KIND:-}" != "${expected_kind}" ]]; then
    return 1
  fi

  if [[ -n "${expected_target}" && "${TARGET:-}" != "${expected_target}" ]]; then
    return 1
  fi

  return 0
}

stop_pid() {
  local pid="$1"
  local attempts=0

  if ! is_pid_running "${pid}"; then
    return 0
  fi

  kill "${pid}" 2>/dev/null || true
  while is_pid_running "${pid}" && [[ ${attempts} -lt 10 ]]; do
    sleep 0.2
    attempts=$((attempts + 1))
  done

  if is_pid_running "${pid}"; then
    kill -9 "${pid}" 2>/dev/null || true
  fi
}

list_processes() {
  local filter_path="$1"
  local filter_kind="$2"
  local filter_target="$3"
  local manifest found=0

  prune_runtime_state

  printf '%-8s %-10s %-7s %-6s %s\n' "kind" "target" "pid" "port" "worktree"

  shopt -s nullglob
  for manifest in "$(process_state_dir)"/*.env; do
    unset PID PROCESS_KIND TARGET WORKTREE_PATH PORT COMMAND LOG_PATH STARTED_AT
    # shellcheck disable=SC1090
    source "${manifest}"

    if ! matches_filters "${filter_path}" "${filter_kind}" "${filter_target}"; then
      continue
    fi

    printf '%-8s %-10s %-7s %-6s %s\n' \
      "${PROCESS_KIND:-}" \
      "${TARGET:-}" \
      "${PID:-}" \
      "${PORT:-"-"}" \
      "${WORKTREE_PATH:-}"
    found=1
  done
  shopt -u nullglob

  if [[ ${found} -eq 0 ]]; then
    echo "No tracked preview processes."
  fi
}

stop_processes() {
  local filter_path="$1"
  local filter_kind="$2"
  local filter_target="$3"
  local manifest count=0

  prune_runtime_state

  shopt -s nullglob
  for manifest in "$(process_state_dir)"/*.env; do
    unset PID PROCESS_KIND TARGET WORKTREE_PATH PORT COMMAND LOG_PATH STARTED_AT
    # shellcheck disable=SC1090
    source "${manifest}"

    if ! matches_filters "${filter_path}" "${filter_kind}" "${filter_target}"; then
      continue
    fi

    stop_pid "${PID}"
    rm -f "${manifest}"
    release_lock "${PROCESS_KIND}" "${PID}"
    count=$((count + 1))
  done
  shopt -u nullglob

  echo "Stopped ${count} tracked process(es)."
}

claim_slot() {
  local kind="$1"
  local worktree_path="$2"
  local claim_pid="$3"
  local manifest
  local mutex_dir
  local waited=0

  validate_kind "${kind}"
  prune_runtime_state
  manifest="$(lock_manifest_path "${kind}")"
  mutex_dir="${manifest}.mutex"

  while ! mkdir "${mutex_dir}" 2>/dev/null; do
    sleep 0.1
    waited=$((waited + 1))
    if [[ ${waited} -ge 100 ]]; then
      echo "Error: timed out waiting for the ${kind} preview lock." >&2
      exit 1
    fi
  done
  trap 'rmdir "'"${mutex_dir}"'" >/dev/null 2>&1 || true' RETURN

  if [[ -f "${manifest}" ]]; then
    unset LOCK_PID LOCK_WORKTREE_PATH LOCK_TARGET LOCK_PORT
    # shellcheck disable=SC1090
    source "${manifest}"
    if is_pid_running "${LOCK_PID:-}"; then
      echo "Error: ${kind} preview slot is already in use by ${LOCK_WORKTREE_PATH:-unknown} (pid ${LOCK_PID:-unknown}, target ${LOCK_TARGET:-unknown}, port ${LOCK_PORT:-unknown})." >&2
      exit 1
    fi
    rm -f "${manifest}"
  fi

  write_lock_metadata "${kind}" "${claim_pid}" "${worktree_path}" "starting" ""
  trap - RETURN
  rmdir "${mutex_dir}" >/dev/null 2>&1 || true
}

track_process() {
  local pid="$1"
  local kind="$2"
  local target="$3"
  local worktree_path="$4"
  local port="$5"
  local log_path="$6"
  local command="$7"

  validate_kind "${kind}"
  write_process_metadata "${pid}" "${kind}" "${target}" "${worktree_path}" "${port}" "${command}" "${log_path}"
  write_lock_metadata "${kind}" "${pid}" "${worktree_path}" "${target}" "${port}"
}

SUBCOMMAND="${1:-}"
if [[ -z "${SUBCOMMAND}" ]]; then
  usage
  exit 1
fi
shift || true

case "${SUBCOMMAND}" in
  list|stop)
    FILTER_WORKTREE=""
    FILTER_KIND=""
    FILTER_TARGET=""

    while [[ $# -gt 0 ]]; do
      case "$1" in
        --worktree)
          [[ $# -ge 2 ]] || { echo "Error: --worktree requires a value." >&2; exit 1; }
          FILTER_WORKTREE="$(resolve_worktree_path "$2")"
          shift 2
          ;;
        --kind)
          [[ $# -ge 2 ]] || { echo "Error: --kind requires a value." >&2; exit 1; }
          FILTER_KIND="$2"
          validate_kind "${FILTER_KIND}"
          shift 2
          ;;
        --target)
          [[ $# -ge 2 ]] || { echo "Error: --target requires a value." >&2; exit 1; }
          FILTER_TARGET="$2"
          shift 2
          ;;
        *)
          echo "Error: unexpected argument '$1'." >&2
          usage
          exit 1
          ;;
      esac
    done

    if [[ "${SUBCOMMAND}" == "list" ]]; then
      list_processes "${FILTER_WORKTREE}" "${FILTER_KIND}" "${FILTER_TARGET}"
    else
      stop_processes "${FILTER_WORKTREE}" "${FILTER_KIND}" "${FILTER_TARGET}"
    fi
    ;;
  prune)
    prune_runtime_state
    echo "Pruned stale process state."
    ;;
  claim)
    KIND=""
    WORKTREE_PATH=""
    CLAIM_PID=""

    while [[ $# -gt 0 ]]; do
      case "$1" in
        --kind)
          KIND="$2"
          shift 2
          ;;
        --worktree)
          WORKTREE_PATH="$2"
          shift 2
          ;;
        --pid)
          CLAIM_PID="$2"
          shift 2
          ;;
        *)
          echo "Error: unexpected argument '$1'." >&2
          exit 1
          ;;
      esac
    done

    [[ -n "${KIND}" && -n "${WORKTREE_PATH}" && -n "${CLAIM_PID}" ]] || {
      echo "Error: claim requires --kind, --worktree, and --pid." >&2
      exit 1
    }

    claim_slot "${KIND}" "${WORKTREE_PATH}" "${CLAIM_PID}"
    ;;
  track)
    PID_VALUE=""
    KIND=""
    TARGET_VALUE=""
    WORKTREE_PATH=""
    PORT_VALUE=""
    LOG_PATH_VALUE=""
    COMMAND_VALUE=""

    while [[ $# -gt 0 ]]; do
      case "$1" in
        --pid)
          PID_VALUE="$2"
          shift 2
          ;;
        --kind)
          KIND="$2"
          shift 2
          ;;
        --target)
          TARGET_VALUE="$2"
          shift 2
          ;;
        --worktree)
          WORKTREE_PATH="$2"
          shift 2
          ;;
        --port)
          PORT_VALUE="$2"
          shift 2
          ;;
        --log)
          LOG_PATH_VALUE="$2"
          shift 2
          ;;
        --command)
          COMMAND_VALUE="$2"
          shift 2
          ;;
        *)
          echo "Error: unexpected argument '$1'." >&2
          exit 1
          ;;
      esac
    done

    [[ -n "${PID_VALUE}" && -n "${KIND}" && -n "${TARGET_VALUE}" && -n "${WORKTREE_PATH}" && -n "${COMMAND_VALUE}" ]] || {
      echo "Error: track requires --pid, --kind, --target, --worktree, and --command." >&2
      exit 1
    }

    track_process "${PID_VALUE}" "${KIND}" "${TARGET_VALUE}" "${WORKTREE_PATH}" "${PORT_VALUE}" "${LOG_PATH_VALUE}" "${COMMAND_VALUE}"
    ;;
  release)
    KIND=""
    EXPECTED_PID=""

    while [[ $# -gt 0 ]]; do
      case "$1" in
        --kind)
          KIND="$2"
          shift 2
          ;;
        --pid)
          EXPECTED_PID="$2"
          shift 2
          ;;
        *)
          echo "Error: unexpected argument '$1'." >&2
          exit 1
          ;;
      esac
    done

    [[ -n "${KIND}" ]] || {
      echo "Error: release requires --kind." >&2
      exit 1
    }

    release_lock "${KIND}" "${EXPECTED_PID}"
    ;;
  *)
    usage
    exit 1
    ;;
esac
