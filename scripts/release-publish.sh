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

git fetch --no-tags origin dev main
LOCAL_RELEASE_SHA="$(git rev-parse HEAD)"

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

RELEASE_FILE_SHA256=$("${NODE_BIN}" -e "
  const crypto = require('crypto');
  const fs = require('fs');
  process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'));
" "$RELEASE_FILE")

PUBLISH_RESULT_JSON=$("${NODE_BIN}" scripts/release-tag-publisher.mjs publish \
  --repo freed-project/freed \
  --worktree "$(pwd -P)" \
  --tag "${TAG}" \
  --channel "${CHANNEL}" \
  --commit "${LOCAL_RELEASE_SHA}" \
  --branch "${EXPECTED_BRANCH}" \
  --release-file "${RELEASE_FILE}" \
  --release-file-sha256 "${RELEASE_FILE_SHA256}")

PUBLISH_RESULT_FIELDS=$("${NODE_BIN}" -e '
  const [raw, repo, tag, commit] = process.argv.slice(1);
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    process.stderr.write("Error: release publisher returned invalid JSON.\n");
    process.exit(1);
  }
  const expectedKeys = [
    "commit",
    "purpose",
    "recovered",
    "repo",
    "schemaVersion",
    "tag",
    "tagObjectSha",
  ];
  const exactObject =
    result !== null &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    JSON.stringify(Object.keys(result).sort()) ===
      JSON.stringify(expectedKeys.sort());
  if (
    !exactObject ||
    result.schemaVersion !== 1 ||
    result.purpose !== "freed-release-tag-publish-result" ||
    result.repo !== repo ||
    result.tag !== tag ||
    result.commit !== commit ||
    typeof result.recovered !== "boolean" ||
    typeof result.tagObjectSha !== "string" ||
    !/^[0-9a-f]{40}$/.test(result.tagObjectSha)
  ) {
    process.stderr.write("Error: release publisher returned an inexact result.\n");
    process.exit(1);
  }
  process.stdout.write(
    `${result.tagObjectSha}\n${result.recovered ? "true" : "false"}\n`,
  );
' "${PUBLISH_RESULT_JSON}" freed-project/freed "${TAG}" "${LOCAL_RELEASE_SHA}")

PUBLISH_TAG_OBJECT_SHA="${PUBLISH_RESULT_FIELDS%%$'\n'*}"
PUBLISH_RECOVERED="${PUBLISH_RESULT_FIELDS#*$'\n'}"
if [[ ! "${PUBLISH_TAG_OBJECT_SHA}" =~ ^[0-9a-f]{40}$ ]] || \
  [[ "${PUBLISH_RECOVERED}" != "true" && "${PUBLISH_RECOVERED}" != "false" ]]; then
  echo "Error: release publisher result fields are malformed." >&2
  exit 1
fi

# Fetch the exact remote tag only into FETCH_HEAD. Implicit tag following must
# not trust or overwrite a local tag before the publisher result is verified.
if ! git fetch --no-tags origin "refs/tags/${TAG}"; then
  echo "Error: release publisher did not create the expected remote tag ${TAG}." >&2
  exit 1
fi

REMOTE_TAG_OBJECT_SHA="$(git rev-parse FETCH_HEAD)"
if [[ "${REMOTE_TAG_OBJECT_SHA}" != "${PUBLISH_TAG_OBJECT_SHA}" ]]; then
  echo "Error: remote tag ${TAG} does not match the publisher result object." >&2
  exit 1
fi
if [[ "$(git cat-file -t "${PUBLISH_TAG_OBJECT_SHA}")" != "tag" ]]; then
  echo "Error: release publisher created a non-annotated remote tag ${TAG}." >&2
  exit 1
fi
if [[ "$(git rev-parse "${PUBLISH_TAG_OBJECT_SHA}^{}")" != "${LOCAL_RELEASE_SHA}" ]]; then
  echo "Error: release publisher created ${TAG} at the wrong commit." >&2
  exit 1
fi

if ! git cat-file tag "${PUBLISH_TAG_OBJECT_SHA}" | "${NODE_BIN}" -e '
  const [tag, commit] = process.argv.slice(1);
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    raw += chunk;
  });
  process.stdin.on("end", () => {
    const separator = raw.indexOf("\n\n");
    if (separator < 0) process.exit(1);
    const headers = new Map();
    for (const line of raw.slice(0, separator).split("\n")) {
      const space = line.indexOf(" ");
      if (space <= 0) continue;
      const key = line.slice(0, space);
      if (["object", "type", "tag"].includes(key)) {
        if (headers.has(key)) process.exit(1);
        headers.set(key, line.slice(space + 1));
      }
    }
    const message = raw.slice(separator + 2).replace(/\n$/, "");
    if (
      headers.get("object") !== commit ||
      headers.get("type") !== "commit" ||
      headers.get("tag") !== tag ||
      message !== `Freed release ${tag}`
    ) {
      process.exit(1);
    }
  });
' "${TAG}" "${LOCAL_RELEASE_SHA}"; then
  echo "Error: remote tag ${TAG} is not the exact approved annotation." >&2
  exit 1
fi

LOCAL_TAG_REF="refs/tags/${TAG}"
if git show-ref --verify --quiet "${LOCAL_TAG_REF}"; then
  LOCAL_TAG_OBJECT_SHA="$(git rev-parse "${LOCAL_TAG_REF}")"
  if [[ "${LOCAL_TAG_OBJECT_SHA}" != "${PUBLISH_TAG_OBJECT_SHA}" ]] || \
    [[ "$(git cat-file -t "${LOCAL_TAG_REF}")" != "tag" ]] || \
    [[ "$(git rev-parse "${LOCAL_TAG_REF}^{}")" != "${LOCAL_RELEASE_SHA}" ]]; then
    echo "Error: local tag ${TAG} conflicts with the verified remote release tag." >&2
    exit 1
  fi
else
  if ! git update-ref "${LOCAL_TAG_REF}" "${PUBLISH_TAG_OBJECT_SHA}" "0000000000000000000000000000000000000000"; then
    echo "Error: local tag ${TAG} changed while the verified remote tag was being installed." >&2
    exit 1
  fi
fi

if [[ "${PUBLISH_RECOVERED}" == "true" ]]; then
  echo "==> Recovered and verified immutable tag ${TAG} through the dedicated release GitHub App."
else
  echo "==> Published and verified immutable tag ${TAG} through the dedicated release GitHub App."
fi
