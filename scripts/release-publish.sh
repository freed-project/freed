#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: ./scripts/release-publish.sh <version>" >&2
  exit 1
fi

VERSION="${1#v}"
TAG="v${VERSION}"
RELEASE_FILE="release-notes/releases/${TAG}.json"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
CHANNEL="production"

if [[ "$VERSION" == *-dev ]]; then
  CHANNEL="dev"
fi

if [[ -z "${NODE_BIN}" && -x "${HOME}/.nvm/versions/node/v22.12.0/bin/node" ]]; then
  NODE_BIN="${HOME}/.nvm/versions/node/v22.12.0/bin/node"
fi

if [[ -z "${NODE_BIN}" ]]; then
  echo "Error: could not find node. Set NODE_BIN or add node to PATH." >&2
  exit 1
fi

if ! git diff --quiet HEAD; then
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

git tag -a "${TAG}" -m "Release ${TAG}"

echo "==> Created tag ${TAG}"
echo "==> To trigger the release workflow, run:"
echo "    git push origin ${EXPECTED_BRANCH} --follow-tags"
