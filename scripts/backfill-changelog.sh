#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/node-tooling.sh
source "${SCRIPT_DIR}/lib/node-tooling.sh"
use_resolved_node_path

echo "scripts/backfill-changelog.sh is deprecated. Using scripts/backfill-release-notes.mjs instead."
exec "${NODE_BIN}" scripts/backfill-release-notes.mjs --rewrite-github "$@"
