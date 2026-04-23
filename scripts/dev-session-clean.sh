#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/dev-session-clean.sh [--dry-run] [--worktree <path>]

Stops tracked local previews and kills stale browser automation helpers that are
safe to identify by command line, including chrome-devtools-mcp, playwright-mcp,
SkyComputerUseClient mcp, and Chrome processes running with automation profiles.
EOF
}

DRY_RUN=false
FILTER_WORKTREE=""
CURRENT_UID="$(id -u)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --worktree)
      [[ $# -ge 2 ]] || { echo "Error: --worktree requires a value." >&2; exit 1; }
      FILTER_WORKTREE="$2"
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

resolve_filter_args() {
  if [[ -n "${FILTER_WORKTREE}" ]]; then
    printf -- '--worktree\0%s\0' "${FILTER_WORKTREE}"
  fi
}

stop_tracked_previews() {
  local args=("${SCRIPT_DIR}/worktree-processes.sh" "stop")
  if [[ -n "${FILTER_WORKTREE}" ]]; then
    args+=("--worktree" "${FILTER_WORKTREE}")
  fi

  if ${DRY_RUN}; then
    printf 'Would run:'
    printf ' %q' "${args[@]}"
    printf '\n'
    return 0
  fi

  "${args[@]}"
}

matching_pids() {
  local pattern="$1"

  ps axww -o pid=,uid=,command= | awk -v uid="${CURRENT_UID}" -v pattern="${pattern}" '
    $2 == uid && $0 ~ pattern { print $1 }
  '
}

terminate_pid() {
  local pid="$1"

  if ${DRY_RUN}; then
    echo "Would terminate pid ${pid}"
    return 0
  fi

  kill "${pid}" 2>/dev/null || true
}

force_kill_pid() {
  local pid="$1"

  if ${DRY_RUN}; then
    echo "Would force-kill pid ${pid}"
    return 0
  fi

  kill -9 "${pid}" 2>/dev/null || true
}

stop_matching_group() {
  local label="$1"
  local pattern="$2"
  local pid
  local -a pids=()

  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    pids+=("${pid}")
  done < <(matching_pids "${pattern}" | sort -u)

  if [[ ${#pids[@]} -eq 0 ]]; then
    echo "${label}: none found"
    return 0
  fi

  echo "${label}: ${#pids[@]} process(es)"

  for pid in "${pids[@]}"; do
    terminate_pid "${pid}"
  done

  if ${DRY_RUN}; then
    return 0
  fi

  sleep 1

  for pid in "${pids[@]}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      force_kill_pid "${pid}"
    fi
  done
}

echo "Stopping tracked previews..."
stop_tracked_previews

echo ""
echo "Cleaning stale browser automation helpers..."
stop_matching_group "chrome-devtools-mcp sidecars" 'npm exec chrome-devtools-mcp@latest|chrome-devtools-mcp[[:space:]]*$|chrome-devtools-mcp/build/src/telemetry/watchdog/main.js'
stop_matching_group "playwright-mcp sidecars" 'playwright-mcp'
stop_matching_group "computer-use sidecars" 'SkyComputerUseClient\.app/Contents/.*/SkyComputerUseClient mcp'
stop_matching_group "automation Chrome roots" '/Applications/Google Chrome\.app/Contents/MacOS/Google Chrome .*(--remote-debugging-pipe|chrome-devtools-mcp/chrome-profile|playwright_chromiumdev_profile)'
stop_matching_group "automation Chrome helpers" 'Google Chrome Helper.*(chrome-devtools-mcp/chrome-profile|playwright_chromiumdev_profile)'

echo ""
if ${DRY_RUN}; then
  echo "Dry run complete."
else
  "${SCRIPT_DIR}/worktree-processes.sh" prune >/dev/null 2>&1 || true
  echo "Cleanup complete."
fi
