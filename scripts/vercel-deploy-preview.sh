#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "website" || $# -gt 2 ]]; then
  echo "Usage: $0 website [vercel-token]. PWA deployment belongs on the product lane." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/node-tooling.sh"
use_resolved_node_path
export VERCEL_TOKEN="${2:-${VERCEL_TOKEN:-}}"
exec "$(resolve_node_bin)" "${SCRIPT_DIR}/deploy-website.mjs" preview
