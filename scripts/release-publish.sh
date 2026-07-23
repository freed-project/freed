#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/node-tooling.sh
source "${SCRIPT_DIR}/lib/node-tooling.sh"
use_resolved_node_path

if [[ $# -lt 1 ]]; then
  echo "Usage: ./scripts/release-publish.sh <version>" >&2
  exit 1
fi

VERSION="${1#v}"
TAG="v${VERSION}"
RELEASE_FILE="release-notes/releases/${TAG}.json"
CHANNEL="production"

if [[ "$VERSION" == *-dev ]]; then
  CHANNEL="dev"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is dirty. Commit the reviewed release notes first." >&2
  exit 1
fi

if [[ ! -f "$RELEASE_FILE" ]]; then
  echo "Error: ${RELEASE_FILE} does not exist." >&2
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
EXPECTED_BRANCH="main"
if [[ "$CHANNEL" == "dev" ]]; then
  EXPECTED_BRANCH="dev"
fi

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "Error: ${CHANNEL} releases must be published from the ${EXPECTED_BRANCH} branch." >&2
  exit 1
fi

git fetch origin dev main --tags
REMOTE_RELEASE_SHA="$(git rev-parse "origin/${EXPECTED_BRANCH}")"
LOCAL_RELEASE_SHA="$(git rev-parse HEAD)"
if [[ "$LOCAL_RELEASE_SHA" != "$REMOTE_RELEASE_SHA" ]]; then
  echo "Error: HEAD must equal origin/${EXPECTED_BRANCH} before tagging." >&2
  echo "The release tag must identify the exact commit merged through branch protection." >&2
  exit 1
fi

"${NODE_BIN}" scripts/validate-release-identity.mjs --tag="${TAG}" --head-ref=HEAD
"${NODE_BIN}" scripts/validate-release-tag-authority.mjs --repo=freed-project/freed

APPROVED=$("${NODE_BIN}" -e "
  const fs = require('fs');
  const file = process.argv[1];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  process.stdout.write(data.approved ? 'true' : 'false');
" "$RELEASE_FILE")

if [[ "$APPROVED" != "true" ]]; then
  echo "Error: ${RELEASE_FILE} is not approved yet." >&2
  echo "Set \"approved\": true after review, commit the edit, then rerun this script." >&2
  exit 1
fi

PRIOR_RELEASE_FILES=()
while IFS= read -r filePath; do
  [[ -n "$filePath" ]] || continue
  PRIOR_RELEASE_FILES+=("$filePath")
done < <("${NODE_BIN}" -e "
  const fs = require('fs');
  const file = process.argv[1];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const currentTag = data.tag;
  const files = (data.source?.sameDayTagsIncluded ?? [])
    .filter((tag) => tag && tag !== currentTag)
    .map((tag) => 'release-notes/releases/' + tag + '.json')
    .filter((filePath) => fs.existsSync(filePath));
  for (const filePath of files) {
    process.stdout.write(filePath + '\n');
  }
" "$RELEASE_FILE")

VALIDATE_ARGS=("$RELEASE_FILE")
if [[ ${#PRIOR_RELEASE_FILES[@]} -gt 0 ]]; then
  VALIDATE_ARGS+=("${PRIOR_RELEASE_FILES[@]}")
fi

"${NODE_BIN}" scripts/validate-release-notes.mjs "${VALIDATE_ARGS[@]}"

if git rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null; then
  echo "Error: tag ${TAG} already exists. Release tags are immutable." >&2
  exit 1
fi

if [[ -n "$(git ls-remote --tags origin "refs/tags/${TAG}")" ]]; then
  echo "Error: remote tag ${TAG} already exists. Release tags are immutable." >&2
  exit 1
fi

RELEASE_FILE_SHA256=$("${NODE_BIN}" -e "
  const crypto = require('crypto');
  const fs = require('fs');
  process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'));
" "$RELEASE_FILE")

"${NODE_BIN}" scripts/release-tag-publisher.mjs publish \
  --repo freed-project/freed \
  --worktree "$(pwd -P)" \
  --tag "${TAG}" \
  --channel "${CHANNEL}" \
  --commit "${LOCAL_RELEASE_SHA}" \
  --branch "${EXPECTED_BRANCH}" \
  --release-file "${RELEASE_FILE}" \
  --release-file-sha256 "${RELEASE_FILE_SHA256}"

git fetch origin "refs/tags/${TAG}:refs/tags/${TAG}"
if [[ "$(git cat-file -t "refs/tags/${TAG}")" != "tag" ]]; then
  echo "Error: release publisher created a non-annotated tag ${TAG}." >&2
  exit 1
fi
if [[ "$(git rev-list -n 1 "refs/tags/${TAG}")" != "${LOCAL_RELEASE_SHA}" ]]; then
  echo "Error: release publisher created ${TAG} at the wrong commit." >&2
  exit 1
fi

echo "==> Published immutable tag ${TAG} through the dedicated release GitHub App."
