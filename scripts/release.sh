#!/usr/bin/env bash
set -euo pipefail

# Bumps version across PWA + Desktop package files, then prepares draft
# release-note artifacts for human review before any tag is created.
#
# CalVer format: YY.M.DDBUILD
#   patch = (day_of_month * 100) + build_number
#   e.g. March 1 build 0  → 26.3.100
#        March 1 build 5  → 26.3.105
#        March 15 build 0 → 26.3.1500
#
# Note: major version (YY) must be ≤255 for Windows MSI compatibility.
#
# Usage:
#   ./scripts/release.sh          # auto-compute from today's date
#   ./scripts/release.sh 26.3.105 # manual override

DESKTOP_DIR="packages/desktop"
TAURI_CONF="${DESKTOP_DIR}/src-tauri/tauri.conf.json"
CARGO_TOML="${DESKTOP_DIR}/src-tauri/Cargo.toml"
DESKTOP_PKG="${DESKTOP_DIR}/package.json"
PWA_PKG="packages/pwa/package.json"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

if [[ -z "${NODE_BIN}" && -x "${HOME}/.nvm/versions/node/v22.12.0/bin/node" ]]; then
  NODE_BIN="${HOME}/.nvm/versions/node/v22.12.0/bin/node"
fi

if [[ -z "${NODE_BIN}" ]]; then
  echo "Error: could not find node. Set NODE_BIN or add node to PATH." >&2
  exit 1
fi

# Ensure working tree is clean
if ! git diff --quiet HEAD; then
  echo "Error: working tree is dirty. Commit or stash changes first." >&2
  exit 1
fi

if [[ -n "${1:-}" ]]; then
  # Manual override
  VERSION="${1#v}"
else
  # Auto-compute from today's date + existing tags
  YY=$(date +%y)    # e.g. 26
  M=$(date +%-m)    # e.g. 3 (no leading zero)
  D=$(date +%-d)    # e.g. 1 (no leading zero)
  PATCH_BASE=$(( D * 100 ))
  PATCH_CEIL=$(( (D + 1) * 100 ))

  # Find highest existing build number for today
  MAX_BUILD=-1
  for tag in $(git tag -l "v${YY}.${M}.*"); do
    PATCH="${tag##*.}"
    if [[ "$PATCH" -ge "$PATCH_BASE" && "$PATCH" -lt "$PATCH_CEIL" ]] 2>/dev/null; then
      BUILD_NUM=$(( PATCH - PATCH_BASE ))
      if [[ "$BUILD_NUM" -gt "$MAX_BUILD" ]]; then
        MAX_BUILD="$BUILD_NUM"
      fi
    fi
  done

  NEXT_BUILD=$(( MAX_BUILD + 1 ))
  VERSION="${YY}.${M}.$(( PATCH_BASE + NEXT_BUILD ))"
  echo "==> Auto-computed version: ${VERSION} (${YY}.${M}.${D} build ${NEXT_BUILD})"
fi

# Validate format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: '${VERSION}' is not a valid version" >&2
  exit 1
fi

TAG="v${VERSION}"
DAY_KEY=$("${NODE_BIN}" -e "const v='${VERSION}'.split('.'); console.log(v.length===3 ? [v[0], v[1], String(Math.floor(Number(v[2]) / 100))].join('.') : '${VERSION}')")
echo "==> Preparing ${VERSION} (tag: ${TAG})"

# Update tauri.conf.json
"${NODE_BIN}" -e "
  const fs = require('fs');
  const conf = JSON.parse(fs.readFileSync('${TAURI_CONF}', 'utf8'));
  conf.version = '${VERSION}';
  fs.writeFileSync('${TAURI_CONF}', JSON.stringify(conf, null, 2) + '\n');
"

# Update Cargo.toml - replace only the version in [package] section.
# sed's ^version = "..." matches ALL top-level version keys (including
# [dependencies.tracing] etc), so we use awk to scope the replacement to
# the [package] block only.
awk -v ver="${VERSION}" '
  /^\[package\]/ { in_pkg=1 }
  /^\[/ && !/^\[package\]/ { in_pkg=0 }
  in_pkg && /^version = / { $0 = "version = \"" ver "\"" }
  { print }
' "${CARGO_TOML}" > "${CARGO_TOML}.tmp" && mv "${CARGO_TOML}.tmp" "${CARGO_TOML}"

# Update desktop package.json
"${NODE_BIN}" -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('${DESKTOP_PKG}', 'utf8'));
  pkg.version = '${VERSION}';
  fs.writeFileSync('${DESKTOP_PKG}', JSON.stringify(pkg, null, 2) + '\n');
"

# Update PWA package.json (PWA and Desktop stay in lockstep)
"${NODE_BIN}" -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('${PWA_PKG}', 'utf8'));
  pkg.version = '${VERSION}';
  fs.writeFileSync('${PWA_PKG}', JSON.stringify(pkg, null, 2) + '\n');
"

echo "==> Updated version files:"
echo "    ${TAURI_CONF}"
echo "    ${CARGO_TOML}"
echo "    ${DESKTOP_PKG}"
echo "    ${PWA_PKG}"

# Generate draft release-note artifacts
"${NODE_BIN}" scripts/prepare-release-notes.mjs "${VERSION}"

# Commit draft release prep, but do not tag yet.
git add "${TAURI_CONF}" "${CARGO_TOML}" "${DESKTOP_PKG}" "${PWA_PKG}" \
  "release-notes/releases/${TAG}.json" \
  "release-notes/releases/${TAG}.md" \
  "release-notes/daily/${DAY_KEY}.json"
git commit -m "release: ${TAG}"

echo "==> Committed draft release prep for ${TAG}"
echo "==> Review and edit:"
echo "    release-notes/releases/${TAG}.json"
echo "    release-notes/releases/${TAG}.md"
echo "    release-notes/daily/${DAY_KEY}.json"
echo "==> After review, set \"approved\": true in the release file, commit the edits, then run:"
echo "    ./scripts/release-publish.sh ${VERSION}"
