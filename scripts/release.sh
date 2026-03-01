#!/usr/bin/env bash
set -euo pipefail

# Bumps version across all desktop package files, commits, tags, and pushes.
# Usage: ./scripts/release.sh 0.2.0

VERSION="${1:?Usage: $0 <version> (e.g. 0.2.0)}"

# Strip leading 'v' if provided
VERSION="${VERSION#v}"

TAG="v${VERSION}"

DESKTOP_DIR="packages/desktop"
TAURI_CONF="${DESKTOP_DIR}/src-tauri/tauri.conf.json"
CARGO_TOML="${DESKTOP_DIR}/src-tauri/Cargo.toml"
PKG_JSON="${DESKTOP_DIR}/package.json"

echo "==> Bumping to ${VERSION} (tag: ${TAG})"

# Validate semver (loose check)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: '${VERSION}' is not a valid semver version" >&2
  exit 1
fi

# Ensure working tree is clean
if ! git diff --quiet HEAD; then
  echo "Error: working tree is dirty. Commit or stash changes first." >&2
  exit 1
fi

# Update tauri.conf.json
node -e "
  const fs = require('fs');
  const conf = JSON.parse(fs.readFileSync('${TAURI_CONF}', 'utf8'));
  conf.version = '${VERSION}';
  fs.writeFileSync('${TAURI_CONF}', JSON.stringify(conf, null, 2) + '\n');
"

# Update Cargo.toml version line
sed -i '' "s/^version = \".*\"/version = \"${VERSION}\"/" "${CARGO_TOML}"

# Update package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('${PKG_JSON}', 'utf8'));
  pkg.version = '${VERSION}';
  fs.writeFileSync('${PKG_JSON}', JSON.stringify(pkg, null, 2) + '\n');
"

echo "==> Updated:"
echo "    ${TAURI_CONF}"
echo "    ${CARGO_TOML}"
echo "    ${PKG_JSON}"

# Commit and tag
git add "${TAURI_CONF}" "${CARGO_TOML}" "${PKG_JSON}"
git commit -m "release: ${TAG}"
git tag -a "${TAG}" -m "Release ${TAG}"

echo "==> Committed and tagged ${TAG}"
echo "==> To trigger the release workflow, run:"
echo "    git push origin main --follow-tags"
