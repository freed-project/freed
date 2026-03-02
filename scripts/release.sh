#!/usr/bin/env bash
set -euo pipefail

# Bumps version across PWA + Desktop package files, commits, tags, and pushes.
# Uses CalVer: YYYY.M.D (e.g. 2026.3.1)
# Usage: ./scripts/release.sh 2026.3.1

VERSION="${1:?Usage: $0 <version> (e.g. 2026.3.1)}"

# Strip leading 'v' if provided
VERSION="${VERSION#v}"

TAG="v${VERSION}"

DESKTOP_DIR="packages/desktop"
TAURI_CONF="${DESKTOP_DIR}/src-tauri/tauri.conf.json"
CARGO_TOML="${DESKTOP_DIR}/src-tauri/Cargo.toml"
DESKTOP_PKG="${DESKTOP_DIR}/package.json"
PWA_PKG="packages/pwa/package.json"
MODAL_TSX="website/src/components/NewsletterModal.tsx"

echo "==> Bumping to ${VERSION} (tag: ${TAG})"

# Validate version format (CalVer YYYY.M.D is valid as digits.digits.digits)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: '${VERSION}' is not a valid version (expected YYYY.M.D)" >&2
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

# Update desktop package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('${DESKTOP_PKG}', 'utf8'));
  pkg.version = '${VERSION}';
  fs.writeFileSync('${DESKTOP_PKG}', JSON.stringify(pkg, null, 2) + '\n');
"

# Update PWA package.json (PWA and Desktop stay in lockstep)
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('${PWA_PKG}', 'utf8'));
  pkg.version = '${VERSION}';
  fs.writeFileSync('${PWA_PKG}', JSON.stringify(pkg, null, 2) + '\n');
"

# Update download VERSION in the marketing site modal
sed -i '' "s/^const VERSION = \".*\"/const VERSION = \"${VERSION}\"/" "${MODAL_TSX}"

echo "==> Updated:"
echo "    ${TAURI_CONF}"
echo "    ${CARGO_TOML}"
echo "    ${DESKTOP_PKG}"
echo "    ${PWA_PKG}"
echo "    ${MODAL_TSX}"

# Commit and tag
git add "${TAURI_CONF}" "${CARGO_TOML}" "${DESKTOP_PKG}" "${PWA_PKG}" "${MODAL_TSX}"
git commit -m "release: ${TAG}"
git tag -a "${TAG}" -m "Release ${TAG}"

echo "==> Committed and tagged ${TAG}"
echo "==> To trigger the release workflow, run:"
echo "    git push origin main --follow-tags"
