#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/node-tooling.sh
source "${SCRIPT_DIR}/lib/node-tooling.sh"
use_resolved_node_path

# Bumps version across PWA + Desktop package files on a release-prep branch,
# then prepares draft release-note artifacts for review before any tag exists.
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
#   ./scripts/release.sh                            # auto-compute a production release
#   ./scripts/release.sh --channel=production       # explicit production release
#   ./scripts/release.sh --channel=dev              # auto-compute a dev release
#   ./scripts/release.sh 26.3.105                   # manual production override
#   ./scripts/release.sh 26.3.105-dev --channel=dev # manual dev override

DESKTOP_DIR="packages/desktop"
TAURI_CONF="${DESKTOP_DIR}/src-tauri/tauri.conf.json"
CARGO_TOML="${DESKTOP_DIR}/src-tauri/Cargo.toml"
DESKTOP_PKG="${DESKTOP_DIR}/package.json"
PWA_PKG="packages/pwa/package.json"
CHANNEL="production"
VERSION_INPUT=""

# Ensure tracked and untracked worktree state is clean.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is dirty. Commit or stash changes first." >&2
  exit 1
fi

for arg in "$@"; do
  case "$arg" in
    --channel=production|--channel=dev)
      CHANNEL="${arg#*=}"
      ;;
    -h|--help)
      echo "Usage: ./scripts/release.sh [<version>] [--channel=production|dev]" >&2
      exit 0
      ;;
    *)
      if [[ -n "$VERSION_INPUT" ]]; then
        echo "Error: too many positional arguments." >&2
        echo "Usage: ./scripts/release.sh [<version>] [--channel=production|dev]" >&2
        exit 1
      fi
      VERSION_INPUT="${arg#v}"
      ;;
  esac
done

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [[ "$CURRENT_BRANCH" == "dev" || "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "www" || "$CURRENT_BRANCH" == "HEAD" ]]; then
  echo "Error: release prep must run on a chore/release-* worktree branch, never directly on ${CURRENT_BRANCH}." >&2
  exit 1
fi

if [[ "$CURRENT_BRANCH" != chore/release-* ]]; then
  echo "Error: release prep branches must be named chore/release-*. Received ${CURRENT_BRANCH}." >&2
  exit 1
fi

EXPECTED_BRANCH="main"
if [[ "$CHANNEL" == "dev" ]]; then
  EXPECTED_BRANCH="dev"
fi
EXPECTED_BASE_REF="origin/${EXPECTED_BRANCH}"

git fetch origin dev main --tags
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "${EXPECTED_BASE_REF}")" ]]; then
  echo "Error: ${CHANNEL} release prep must start at the exact current ${EXPECTED_BASE_REF} commit." >&2
  echo "Create a fresh chore/release-<version> worktree from ${EXPECTED_BASE_REF} and retry." >&2
  exit 1
fi

PROMOTED_DEV_COMMIT_SHA=""
if [[ "$CHANNEL" == "production" ]]; then
  "${NODE_BIN}" scripts/validate-release-promotion.mjs --from-ref=origin/dev --to-ref=HEAD
  PROMOTED_DEV_COMMIT_SHA="$(git rev-parse origin/dev)"
fi

if [[ -n "$VERSION_INPUT" ]]; then
  VERSION="${VERSION_INPUT}"
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
    TAG_VERSION="${tag#v}"
    BASE_VERSION="${TAG_VERSION%-dev}"
    TAG_YY="${BASE_VERSION%%.*}"
    REMAINDER="${BASE_VERSION#*.}"
    TAG_MONTH="${REMAINDER%%.*}"
    if [[ "$TAG_YY" != "$YY" || "$TAG_MONTH" != "$M" ]]; then
      continue
    fi
    PATCH="${BASE_VERSION##*.}"
    if [[ "$PATCH" -ge "$PATCH_BASE" && "$PATCH" -lt "$PATCH_CEIL" ]] 2>/dev/null; then
      BUILD_NUM=$(( PATCH - PATCH_BASE ))
      if [[ "$BUILD_NUM" -gt "$MAX_BUILD" ]]; then
        MAX_BUILD="$BUILD_NUM"
      fi
    fi
  done

  NEXT_BUILD=$(( MAX_BUILD + 1 ))
  VERSION="$(
    "${NODE_BIN}" scripts/release-version.mjs \
      --channel="${CHANNEL}" \
      --major="${YY}" \
      --month="${M}" \
      --day="${D}" \
      --build="${NEXT_BUILD}"
  )"
  echo "==> Auto-computed ${CHANNEL} version: ${VERSION} (${YY}.${M}.${D} build ${NEXT_BUILD})"
fi

# Validate and normalize the release identity before mutating any version file.
# Bundle versions stay numeric, while the exact -dev suffix lives on dev tags
# and release metadata.
VERSION="$("${NODE_BIN}" scripts/release-version.mjs --channel="${CHANNEL}" "${VERSION}")"

BASE_VERSION="${VERSION%-dev}"
APP_VERSION="${VERSION}"
if [[ "$CHANNEL" == "dev" ]]; then
  # Windows MSI rejects non-numeric prerelease identifiers in the app bundle
  # version. Keep the dev channel on the tag and release metadata instead.
  APP_VERSION="${BASE_VERSION}"
fi

TAG="v${VERSION}"
DAY_KEY=$("${NODE_BIN}" -e "const v='${BASE_VERSION}'.split('.'); console.log(v.length===3 ? [v[0], v[1], String(Math.floor(Number(v[2]) / 100))].join('.') : '${BASE_VERSION}')")
echo "==> Preparing ${CHANNEL} release ${VERSION} (tag: ${TAG})"
if [[ "${APP_VERSION}" != "${VERSION}" ]]; then
  echo "==> App bundle version: ${APP_VERSION}"
fi

# Update tauri.conf.json
"${NODE_BIN}" -e "
  const fs = require('fs');
  const conf = JSON.parse(fs.readFileSync('${TAURI_CONF}', 'utf8'));
  conf.version = '${APP_VERSION}';
  fs.writeFileSync('${TAURI_CONF}', JSON.stringify(conf, null, 2) + '\n');
"

# Update Cargo.toml - replace only the version in [package] section.
# sed's ^version = "..." matches ALL top-level version keys (including
# [dependencies.tracing] etc), so we use awk to scope the replacement to
# the [package] block only.
awk -v ver="${APP_VERSION}" '
  /^\[package\]/ { in_pkg=1 }
  /^\[/ && !/^\[package\]/ { in_pkg=0 }
  in_pkg && /^version = / { $0 = "version = \"" ver "\"" }
  { print }
' "${CARGO_TOML}" > "${CARGO_TOML}.tmp" && mv "${CARGO_TOML}.tmp" "${CARGO_TOML}"

# Update desktop package.json
"${NODE_BIN}" -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('${DESKTOP_PKG}', 'utf8'));
  pkg.version = '${APP_VERSION}';
  fs.writeFileSync('${DESKTOP_PKG}', JSON.stringify(pkg, null, 2) + '\n');
"

# Update PWA package.json (PWA and Desktop stay in lockstep)
"${NODE_BIN}" -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('${PWA_PKG}', 'utf8'));
  pkg.version = '${APP_VERSION}';
  fs.writeFileSync('${PWA_PKG}', JSON.stringify(pkg, null, 2) + '\n');
"

echo "==> Updated version files:"
echo "    ${TAURI_CONF}"
echo "    ${CARGO_TOML}"
echo "    ${DESKTOP_PKG}"
echo "    ${PWA_PKG}"

# Generate draft release-note artifacts
FREED_PROMOTED_DEV_COMMIT_SHA="${PROMOTED_DEV_COMMIT_SHA}" \
  "${NODE_BIN}" scripts/prepare-release-notes.mjs "${VERSION}"

# Commit draft release prep, but do not tag yet.
git add "${TAURI_CONF}" "${CARGO_TOML}" "${DESKTOP_PKG}" "${PWA_PKG}" \
  "release-notes/releases/${TAG}.json" \
  "release-notes/releases/${TAG}.md" \
  "release-notes/daily/${CHANNEL}/${DAY_KEY}.json"
git commit -m "release: ${TAG}"

echo "==> Committed draft release prep for ${TAG}"
echo "==> Review and edit:"
echo "    release-notes/releases/${TAG}.json"
echo "    release-notes/releases/${TAG}.md"
echo "    release-notes/daily/${CHANNEL}/${DAY_KEY}.json"
echo "==> After review, set \"approved\": true in the release file, commit the edits, then run:"
if [[ "$CHANNEL" == "production" ]]; then
  echo "    npm run validate:release"
else
  echo "    npm run validate:feature"
fi
echo "    ./scripts/worktree-publish.sh --base ${EXPECTED_BRANCH} --ready --title \"chore: prepare ${TAG}\""
if [[ "$CHANNEL" == "production" ]]; then
  echo "==> After that PR merges, update local main and run:"
  echo "    ./scripts/release-publish.sh ${VERSION}"
else
  echo "==> After that PR merges, update local dev and run:"
  echo "    ./scripts/release-publish.sh ${VERSION}"
fi
