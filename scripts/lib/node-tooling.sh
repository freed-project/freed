#!/usr/bin/env bash

set -euo pipefail

node_tooling_source_path() {
  if [[ -n "${ZSH_VERSION:-}" ]]; then
    printf '%s\n' "${(%):-%x}"
    return 0
  fi

  printf '%s\n' "${BASH_SOURCE[0]}"
}

node_tooling_repo_root() {
  local source_path

  source_path="$(node_tooling_source_path)"
  cd "$(dirname "${source_path}")/../.." && pwd
}

node_tooling_nvm_version() {
  local repo_root
  local nvmrc_path

  repo_root="$(node_tooling_repo_root)"
  nvmrc_path="${repo_root}/.nvmrc"

  if [[ ! -f "${nvmrc_path}" ]]; then
    return 0
  fi

  tr -d '[:space:]' <"${nvmrc_path}"
}

resolve_node_bin() {
  local requested_version
  local version_without_prefix
  local candidate

  if [[ -n "${NODE_BIN:-}" ]]; then
    if [[ ! -x "${NODE_BIN}" ]]; then
      echo "Error: NODE_BIN points to a non-executable path: ${NODE_BIN}" >&2
      return 1
    fi

    printf '%s\n' "${NODE_BIN}"
    return 0
  fi

  requested_version="$(node_tooling_nvm_version)"
  if [[ -n "${requested_version}" ]]; then
    version_without_prefix="${requested_version#v}"
    candidate="${HOME}/.nvm/versions/node/v${version_without_prefix}/bin/node"
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  for candidate in \
    "${HOME}/.nvm/versions/node/v24.14.1/bin/node" \
    "${HOME}/.nvm/versions/node/v22.12.0/bin/node"
  do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  echo "Error: could not find node. Set NODE_BIN or add node to PATH." >&2
  return 1
}

resolve_npm_bin() {
  local node_bin node_dir npm_bin
  node_bin="$(resolve_node_bin)"
  node_dir="$(cd "$(dirname "${node_bin}")" && pwd)"
  npm_bin="${node_dir}/npm"

  if [[ -x "${npm_bin}" ]]; then
    printf '%s\n' "${npm_bin}"
    return 0
  fi

  echo "Error: could not find npm next to ${node_bin}." >&2
  return 1
}

resolve_npx_bin() {
  local node_bin node_dir npx_bin
  node_bin="$(resolve_node_bin)"
  node_dir="$(cd "$(dirname "${node_bin}")" && pwd)"
  npx_bin="${node_dir}/npx"

  if [[ -x "${npx_bin}" ]]; then
    printf '%s\n' "${npx_bin}"
    return 0
  fi

  echo "Error: could not find npx next to ${node_bin}." >&2
  return 1
}

use_resolved_node_path() {
  local node_bin node_dir
  node_bin="$(resolve_node_bin)"
  node_dir="$(cd "$(dirname "${node_bin}")" && pwd)"
  export NODE_BIN="${node_bin}"
  export PATH="${node_dir}:${PATH}"
}

print_node_tooling_preflight() {
  local node_bin npm_bin node_version npm_version

  node_bin="$(resolve_node_bin)"
  npm_bin="$(resolve_npm_bin)"
  node_version="$("${node_bin}" -v)"
  npm_version="$("${npm_bin}" -v)"

  printf 'node: %s (%s)\n' "${node_version}" "${node_bin}"
  printf 'npm: %s (%s)\n' "${npm_version}" "${npm_bin}"
}
