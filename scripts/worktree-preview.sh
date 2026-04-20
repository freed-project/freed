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
  ./scripts/worktree-preview.sh <desktop|pwa|website> [--worktree <path>] [--port <port>] [--native] [--label <text>]

Desktop defaults to the mocked browser preview. Use --native only when Tauri
behavior itself is the thing being tested.
EOF
}

existing_process_for_target() {
  local worktree_path="$1"
  local preview_target="$2"
  local manifest

  prune_runtime_state

  shopt -s nullglob
  for manifest in "$(process_state_dir)"/*.env; do
    unset PID PROCESS_KIND TARGET WORKTREE_PATH PORT COMMAND LOG_PATH PREVIEW_LABEL STARTED_AT
    # shellcheck disable=SC1090
    source "${manifest}"
    if [[ "${WORKTREE_PATH:-}" == "${worktree_path}" && "${TARGET:-}" == "${preview_target}" ]]; then
      printf '%s\n' "${manifest}"
      shopt -u nullglob
      return 0
    fi
  done
  shopt -u nullglob
  return 1
}

TARGET=""
WORKTREE_PATH=""
PORT=""
USE_NATIVE=false
PREVIEW_LABEL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    desktop|pwa|website)
      if [[ -n "${TARGET}" ]]; then
        echo "Error: preview target already set to '${TARGET}'." >&2
        exit 1
      fi
      TARGET="$1"
      shift
      ;;
    --worktree)
      [[ $# -ge 2 ]] || { echo "Error: --worktree requires a value." >&2; exit 1; }
      WORKTREE_PATH="$2"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || { echo "Error: --port requires a value." >&2; exit 1; }
      PORT="$2"
      shift 2
      ;;
    --native)
      USE_NATIVE=true
      shift
      ;;
    --label)
      [[ $# -ge 2 ]] || { echo "Error: --label requires a value." >&2; exit 1; }
      PREVIEW_LABEL="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Error: unexpected argument '$1'." >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${TARGET}" ]]; then
  usage
  exit 1
fi

if [[ -z "${WORKTREE_PATH}" ]]; then
  WORKTREE_PATH="$(git rev-parse --show-toplevel)"
fi

WORKTREE_PATH="$(resolve_worktree_path "${WORKTREE_PATH}")"
PROCESS_SCRIPT="${SCRIPT_DIR}/worktree-processes.sh"
PREVIEW_LABEL="${PREVIEW_LABEL:-$(preview_label_for_worktree "${WORKTREE_PATH}")}"
print_node_tooling_preflight

if existing_manifest="$(existing_process_for_target "${WORKTREE_PATH}" "${TARGET}")"; then
  unset PID PROCESS_KIND TARGET WORKTREE_PATH PORT COMMAND LOG_PATH PREVIEW_LABEL STARTED_AT
  # shellcheck disable=SC1090
  source "${existing_manifest}"
  echo "Preview already running for ${TARGET} in ${WORKTREE_PATH}: pid ${PID}, port ${PORT:-"-"}"
  if [[ -n "${PREVIEW_LABEL:-}" ]]; then
    echo "Label: ${PREVIEW_LABEL}"
  fi
  if [[ -n "${LOG_PATH:-}" ]]; then
    echo "Log: ${LOG_PATH}"
  fi
  exit 0
fi

"${SCRIPT_DIR}/worktree-bootstrap.sh" "${WORKTREE_PATH}" --target "${TARGET}"

NPM_BIN="$(resolve_npm_bin)"
use_resolved_node_path

SLOT_KIND="web"
DEFAULT_PORT=""
COMMAND_DISPLAY=""
LOG_PATH=""
URL=""
ENV_VARS=()
RUN_ARGS=()
RUN_CWD=""
ROOT_BIN_DIR="$(worktree_root_bin_dir "${WORKTREE_PATH}")"

case "${TARGET}" in
  desktop)
    SLOT_KIND="desktop"
    RUN_CWD="$(workspace_path_for_target "${WORKTREE_PATH}" "desktop")"
    if ${USE_NATIVE}; then
      DEFAULT_PORT="1420"
      PORT="${PORT:-${DEFAULT_PORT}}"
      if [[ "${PORT}" != "1420" ]]; then
        echo "Error: native desktop preview is fixed to port 1420 by tauri.conf.json." >&2
        exit 1
      fi
      ENV_VARS=(
        "PATH=${ROOT_BIN_DIR}:${PATH}"
        "VITE_FREED_PREVIEW_LABEL=${PREVIEW_LABEL}"
        "FREED_TAURI_WINDOW_TITLE=Freed Preview | ${PREVIEW_LABEL}"
      )
      RUN_ARGS=("${NPM_BIN}" "run" "tauri:dev")
      COMMAND_DISPLAY="cd packages/desktop && PATH=${ROOT_BIN_DIR}:\$PATH VITE_FREED_PREVIEW_LABEL=${PREVIEW_LABEL} FREED_TAURI_WINDOW_TITLE=Freed Preview | ${PREVIEW_LABEL} npm run tauri:dev"
      URL="http://localhost:1420"
    else
      DEFAULT_PORT="1422"
      PORT="${PORT:-$("$(resolve_node_bin)" "${SCRIPT_DIR}/lib/find-free-port.mjs" "${DEFAULT_PORT}")}"
      ENV_VARS=(
        "PATH=${ROOT_BIN_DIR}:${PATH}"
        "VITE_TEST_TAURI=1"
        "VITE_FREED_PREVIEW_LABEL=${PREVIEW_LABEL}"
      )
      RUN_ARGS=("${NPM_BIN}" "run" "dev" "--" "--port" "${PORT}")
      COMMAND_DISPLAY="cd packages/desktop && PATH=${ROOT_BIN_DIR}:\$PATH VITE_TEST_TAURI=1 VITE_FREED_PREVIEW_LABEL=${PREVIEW_LABEL} npm run dev -- --port ${PORT}"
      URL="http://localhost:${PORT}"
    fi
    ;;
  pwa)
    SLOT_KIND="web"
    DEFAULT_PORT="1421"
    PORT="${PORT:-$("$(resolve_node_bin)" "${SCRIPT_DIR}/lib/find-free-port.mjs" "${DEFAULT_PORT}")}"
    RUN_CWD="$(workspace_path_for_target "${WORKTREE_PATH}" "pwa")"
    ENV_VARS=(
      "PATH=${ROOT_BIN_DIR}:${PATH}"
      "VITE_FREED_PREVIEW_LABEL=${PREVIEW_LABEL}"
    )
    RUN_ARGS=("${NPM_BIN}" "run" "dev" "--" "--port" "${PORT}")
    COMMAND_DISPLAY="cd packages/pwa && PATH=${ROOT_BIN_DIR}:\$PATH VITE_FREED_PREVIEW_LABEL=${PREVIEW_LABEL} npm run dev -- --port ${PORT}"
    URL="http://localhost:${PORT}"
    ;;
  website)
    SLOT_KIND="web"
    DEFAULT_PORT="3000"
    PORT="${PORT:-$("$(resolve_node_bin)" "${SCRIPT_DIR}/lib/find-free-port.mjs" "${DEFAULT_PORT}")}"
    RUN_CWD="$(workspace_path_for_target "${WORKTREE_PATH}" "website")"
    ENV_VARS=(
      "PATH=${ROOT_BIN_DIR}:${PATH}"
      "NEXT_PUBLIC_FREED_PREVIEW_LABEL=${PREVIEW_LABEL}"
    )
    RUN_ARGS=("${NPM_BIN}" "run" "dev" "--" "--port" "${PORT}")
    COMMAND_DISPLAY="cd website && PATH=${ROOT_BIN_DIR}:\$PATH NEXT_PUBLIC_FREED_PREVIEW_LABEL=${PREVIEW_LABEL} npm run dev -- --port ${PORT}"
    URL="http://localhost:${PORT}"
    ;;
esac

"${PROCESS_SCRIPT}" claim --kind "${SLOT_KIND}" --worktree "${WORKTREE_PATH}" --pid "$$"
trap '"${PROCESS_SCRIPT}" release --kind "${SLOT_KIND}" --pid "$$" >/dev/null 2>&1 || true' EXIT

ensure_runtime_dirs
LOG_PATH="$(log_state_dir)/${TARGET}-$(date -u +%Y%m%dT%H%M%SZ)-$(worktree_id_for_path "${WORKTREE_PATH}").log"

spawn_preview() {
  local env_blob=""
  local entry

  if [[ ${#ENV_VARS[@]} -gt 0 ]]; then
    for entry in "${ENV_VARS[@]}"; do
      env_blob+="${entry}"$'\n'
    done
  fi

  FREED_PREVIEW_ENV="${env_blob}" python3 - "${RUN_CWD}" "${LOG_PATH}" "${RUN_ARGS[@]}" <<'PY'
import os
import subprocess
import sys

cwd = sys.argv[1]
log_path = sys.argv[2]
args = sys.argv[3:]

env = os.environ.copy()
for item in os.environ.get("FREED_PREVIEW_ENV", "").splitlines():
    if not item:
        continue
    key, value = item.split("=", 1)
    env[key] = value

with open(log_path, "ab", buffering=0) as log_file:
    process = subprocess.Popen(
        args,
        cwd=cwd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )

print(process.pid)
PY
}

PID_VALUE="$(spawn_preview)"

"${PROCESS_SCRIPT}" track \
  --pid "${PID_VALUE}" \
  --kind "${SLOT_KIND}" \
  --target "${TARGET}" \
  --worktree "${WORKTREE_PATH}" \
  --port "${PORT}" \
  --log "${LOG_PATH}" \
  --label "${PREVIEW_LABEL}" \
  --command "${COMMAND_DISPLAY}"

sleep 2
if ! is_pid_running "${PID_VALUE}"; then
  "${PROCESS_SCRIPT}" stop --worktree "${WORKTREE_PATH}" --target "${TARGET}" >/dev/null 2>&1 || true
  echo "Error: preview exited immediately. Check ${LOG_PATH}." >&2
  exit 1
fi

trap - EXIT

echo "Started ${TARGET} preview."
echo "Worktree: ${WORKTREE_PATH}"
echo "Label: ${PREVIEW_LABEL}"
echo "PID: ${PID_VALUE}"
echo "Log: ${LOG_PATH}"
if [[ -n "${URL}" ]]; then
  echo "URL: ${URL}"
fi
