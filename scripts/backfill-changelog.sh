#!/usr/bin/env bash
set -euo pipefail

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

if [[ -z "${NODE_BIN}" && -x "${HOME}/.nvm/versions/node/v22.12.0/bin/node" ]]; then
  NODE_BIN="${HOME}/.nvm/versions/node/v22.12.0/bin/node"
fi

if [[ -z "${NODE_BIN}" ]]; then
  echo "Error: could not find node. Set NODE_BIN or add node to PATH." >&2
  exit 1
fi

echo "scripts/backfill-changelog.sh is deprecated. Using scripts/backfill-release-notes.mjs instead."
exec "${NODE_BIN}" scripts/backfill-release-notes.mjs --rewrite-github "$@"
