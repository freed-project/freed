#!/usr/bin/env bash

set -euo pipefail

git_common_dir() {
  git rev-parse --git-common-dir
}

runtime_root() {
  printf '%s\n' "$(git_common_dir)/freed-runtime"
}

worktree_state_dir() {
  printf '%s\n' "$(runtime_root)/worktrees"
}

process_state_dir() {
  printf '%s\n' "$(runtime_root)/processes"
}

lock_state_dir() {
  printf '%s\n' "$(runtime_root)/locks"
}

log_state_dir() {
  printf '%s\n' "$(runtime_root)/logs"
}

ensure_runtime_dirs() {
  mkdir -p \
    "$(worktree_state_dir)" \
    "$(process_state_dir)" \
    "$(lock_state_dir)" \
    "$(log_state_dir)"
}

resolve_worktree_path() {
  local path="$1"

  (
    cd "${path}"
    pwd
  )
}

hash_string() {
  printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
}

worktree_id_for_path() {
  local path="$1"
  local abs_path

  abs_path="$(resolve_worktree_path "${path}")"
  hash_string "${abs_path}"
}

worktree_manifest_path() {
  local path="$1"

  printf '%s/%s.env\n' "$(worktree_state_dir)" "$(worktree_id_for_path "${path}")"
}

process_manifest_path() {
  local pid="$1"

  printf '%s/%s.env\n' "$(process_state_dir)" "${pid}"
}

lock_manifest_path() {
  local kind="$1"

  printf '%s/%s.env\n' "$(lock_state_dir)" "${kind}"
}

current_timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

basename_without_freed_prefix() {
  local path="$1"
  local base_name

  base_name="$(basename "${path}")"
  printf '%s\n' "${base_name#freed-}"
}

preview_thread_label() {
  local thread_id="${CODEX_THREAD_ID:-}"

  if [[ -z "${thread_id}" ]]; then
    return 0
  fi

  printf 'thread ...%s\n' "${thread_id: -8}"
}

preview_label_for_worktree() {
  local path="$1"
  local abs_path base_name thread_label

  abs_path="$(resolve_worktree_path "${path}")"
  base_name="$(basename_without_freed_prefix "${abs_path}")"
  thread_label="$(preview_thread_label)"

  if [[ -n "${thread_label}" ]]; then
    printf '%s | %s\n' "${base_name}" "${thread_label}"
    return 0
  fi

  printf '%s\n' "${base_name}"
}

workspace_path_for_target() {
  local root_path="$1"
  local target="$2"
  local abs_root

  abs_root="$(resolve_worktree_path "${root_path}")"

  case "${target}" in
    desktop)
      printf '%s/packages/desktop\n' "${abs_root}"
      ;;
    pwa)
      printf '%s/packages/pwa\n' "${abs_root}"
      ;;
    website)
      printf '%s/website\n' "${abs_root}"
      ;;
    shared)
      printf '%s\n' "${abs_root}"
      ;;
    *)
      echo "Error: unsupported target '${target}'." >&2
      return 1
      ;;
  esac
}

worktree_root_bin_dir() {
  local root_path="$1"
  local abs_root

  abs_root="$(resolve_worktree_path "${root_path}")"
  printf '%s/node_modules/.bin\n' "${abs_root}"
}

is_pid_running() {
  local pid="$1"

  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

write_shell_var() {
  local name="$1"
  local value="$2"

  printf '%s=%q\n' "${name}" "${value}"
}

record_worktree_metadata() {
  local path="$1"
  local install_mode="$2"
  local target_hint="$3"
  local abs_path worktree_id manifest

  ensure_runtime_dirs

  abs_path="$(resolve_worktree_path "${path}")"
  worktree_id="$(worktree_id_for_path "${abs_path}")"
  manifest="$(worktree_manifest_path "${abs_path}")"

  {
    write_shell_var "WORKTREE_ID" "${worktree_id}"
    write_shell_var "WORKTREE_PATH" "${abs_path}"
    write_shell_var "INSTALL_MODE" "${install_mode}"
    write_shell_var "TARGET_HINT" "${target_hint}"
    write_shell_var "CREATED_AT" "$(current_timestamp)"
  } > "${manifest}"
}

load_worktree_metadata() {
  local path="$1"
  local manifest

  manifest="$(worktree_manifest_path "${path}")"
  [[ -f "${manifest}" ]] || return 1
  # shellcheck disable=SC1090
  source "${manifest}"
}

write_process_metadata() {
  local pid="$1"
  local kind="$2"
  local target="$3"
  local path="$4"
  local port="$5"
  local command="$6"
  local log_path="$7"
  local preview_label="$8"
  local abs_path worktree_id manifest

  ensure_runtime_dirs

  abs_path="$(resolve_worktree_path "${path}")"
  worktree_id="$(worktree_id_for_path "${abs_path}")"
  manifest="$(process_manifest_path "${pid}")"

  {
    write_shell_var "PID" "${pid}"
    write_shell_var "PROCESS_KIND" "${kind}"
    write_shell_var "TARGET" "${target}"
    write_shell_var "WORKTREE_ID" "${worktree_id}"
    write_shell_var "WORKTREE_PATH" "${abs_path}"
    write_shell_var "PORT" "${port}"
    write_shell_var "COMMAND" "${command}"
    write_shell_var "LOG_PATH" "${log_path}"
    write_shell_var "PREVIEW_LABEL" "${preview_label}"
    write_shell_var "STARTED_AT" "$(current_timestamp)"
  } > "${manifest}"
}

write_lock_metadata() {
  local kind="$1"
  local pid="$2"
  local path="$3"
  local target="$4"
  local port="$5"
  local abs_path worktree_id manifest

  ensure_runtime_dirs

  abs_path="$(resolve_worktree_path "${path}")"
  worktree_id="$(worktree_id_for_path "${abs_path}")"
  manifest="$(lock_manifest_path "${kind}")"

  {
    write_shell_var "LOCK_KIND" "${kind}"
    write_shell_var "LOCK_PID" "${pid}"
    write_shell_var "LOCK_WORKTREE_ID" "${worktree_id}"
    write_shell_var "LOCK_WORKTREE_PATH" "${abs_path}"
    write_shell_var "LOCK_TARGET" "${target}"
    write_shell_var "LOCK_PORT" "${port}"
    write_shell_var "LOCK_CREATED_AT" "$(current_timestamp)"
  } > "${manifest}"
}

release_lock() {
  local kind="$1"
  local expected_pid="${2:-}"
  local manifest

  manifest="$(lock_manifest_path "${kind}")"
  [[ -f "${manifest}" ]] || return 0

  unset LOCK_PID
  # shellcheck disable=SC1090
  source "${manifest}"

  if [[ -n "${expected_pid}" && "${LOCK_PID:-}" != "${expected_pid}" ]]; then
    return 0
  fi

  rm -f "${manifest}"
}

prune_runtime_state() {
  local manifest

  ensure_runtime_dirs

  shopt -s nullglob
  for manifest in "$(worktree_state_dir)"/*.env; do
    unset WORKTREE_PATH
    # shellcheck disable=SC1090
    source "${manifest}"
    if [[ ! -d "${WORKTREE_PATH:-}" ]]; then
      rm -f "${manifest}"
    fi
  done

  for manifest in "$(process_state_dir)"/*.env; do
    unset PID
    # shellcheck disable=SC1090
    source "${manifest}"
    if ! is_pid_running "${PID:-}"; then
      rm -f "${manifest}"
    fi
  done

  for manifest in "$(lock_state_dir)"/*.env; do
    unset LOCK_PID
    # shellcheck disable=SC1090
    source "${manifest}"
    if ! is_pid_running "${LOCK_PID:-}"; then
      rm -f "${manifest}"
    fi
  done
  shopt -u nullglob
}
