#!/usr/bin/env bash

set -euo pipefail

resolve_node_bin() {
  if [[ -n "${NODE_BIN:-}" && -x "${NODE_BIN}" ]]; then
    printf '%s\n' "${NODE_BIN}"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local candidate
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

  if command -v npm >/dev/null 2>&1; then
    command -v npm
    return 0
  fi

  echo "Error: could not find npm next to ${node_bin} or on PATH." >&2
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

  if command -v npx >/dev/null 2>&1; then
    command -v npx
    return 0
  fi

  echo "Error: could not find npx next to ${node_bin} or on PATH." >&2
  return 1
}

use_resolved_node_path() {
  local node_bin node_dir
  node_bin="$(resolve_node_bin)"
  node_dir="$(cd "$(dirname "${node_bin}")" && pwd)"
  export PATH="${node_dir}:${PATH}"
}
