#!/bin/bash

set -euo pipefail
set +x
umask 077

PUBLISHER_CAPABILITY_FILE="${FREED_PUBLISHER_CAPABILITY_FILE:-}"
EXPECTED_CONTROL_SHA="${FREED_TRUSTED_CONTROL_SHA:-}"
PUBLISH_CONTROL_STATE_ROOT="${FREED_TRUSTED_STATE_ROOT:-}"
TRUSTED_GH_BIN="${FREED_TRUSTED_GH_BIN:-}"
TRUSTED_GH_SHA256="${FREED_TRUSTED_GH_SHA256:-}"
TRUSTED_NODE_BIN="${FREED_TRUSTED_NODE_BIN:-}"
TRUSTED_NODE_SHA256="${FREED_TRUSTED_NODE_SHA256:-}"
TRUSTED_DEVELOPER_DIR="${DEVELOPER_DIR:-}"
builtin unset \
  FREED_PUBLISHER_CAPABILITY_FILE \
  FREED_PR_PUBLISHER_ACTOR_TOKEN \
  FREED_PR_PUBLISHER_LEASE_TOKEN \
  FREED_AUTOMATION_ACTOR_TOKEN \
  FREED_AUTOMATION_LEASE_TOKEN \
  FREED_OWNER_BOOTSTRAP_TOKEN \
  FREED_TRUSTED_CONTROL_SHA \
  FREED_TRUSTED_STATE_ROOT \
  FREED_TRUSTED_GH_BIN \
  FREED_TRUSTED_GH_SHA256 \
  FREED_TRUSTED_NODE_BIN \
  FREED_TRUSTED_NODE_SHA256 \
  DEVELOPER_DIR \
  PUBLISH_LEASE_JSON \
  PUBLISH_LEASE_TOKEN
builtin declare +x PUBLISHER_CAPABILITY_FILE
builtin unset BASH_ENV ENV NODE_BIN NODE_OPTIONS NODE_PATH CDPATH GH_REPO

while builtin read -r _ _ function_name; do
  builtin unset -f "${function_name}"
done < <(builtin declare -F)

while IFS= builtin read -r environment_line; do
  environment_name="${environment_line%%=*}"
  case "${environment_name}" in
    GIT_*|GH_*|BASH_FUNC_*|SSH_ASKPASS|SUDO_ASKPASS)
      builtin unset "${environment_name}" 2>/dev/null || true
      ;;
  esac
done < <(/usr/bin/env)

if [[ "${BASH_SOURCE[0]}" != /* ]]; then
  echo "Error: invoke the trusted publisher by its absolute approved path." >&2
  exit 1
fi
if [[ "${TRUSTED_DEVELOPER_DIR}" != "/Library/Developer/CommandLineTools" ]]; then
  echo "Error: the trusted publisher requires the root-owned Command Line Tools runtime." >&2
  exit 1
fi
DEVELOPER_MODE="$(/usr/bin/stat -f '%Lp' "${TRUSTED_DEVELOPER_DIR}" 2>/dev/null || true)"
if [[
  ! -d "${TRUSTED_DEVELOPER_DIR}" ||
  -L "${TRUSTED_DEVELOPER_DIR}" ||
  "$(/usr/bin/stat -f '%u' "${TRUSTED_DEVELOPER_DIR}" 2>/dev/null || true)" != 0 ||
  -z "${DEVELOPER_MODE}" ||
  $(( (8#${DEVELOPER_MODE}) & 8#022 )) -ne 0
]]; then
  echo "Error: the trusted Command Line Tools runtime is not root-owned and immutable." >&2
  exit 1
fi
export DEVELOPER_DIR="${TRUSTED_DEVELOPER_DIR}"
SCRIPT_DIR="$(builtin cd -P -- "${BASH_SOURCE[0]%/*}" && builtin pwd)"
CONTROL_ROOT="$(builtin cd -P -- "${SCRIPT_DIR}/.." && builtin pwd)"

if [[ ! "${EXPECTED_CONTROL_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Error: FREED_TRUSTED_CONTROL_SHA must pin the approved launcher commit." >&2
  exit 1
fi
if [[ "${PUBLISH_CONTROL_STATE_ROOT}" != /* ]]; then
  echo "Error: FREED_TRUSTED_STATE_ROOT must be an absolute host-managed path." >&2
  exit 1
fi
if [[ "${PUBLISHER_CAPABILITY_FILE}" != /* || ! -f "${PUBLISHER_CAPABILITY_FILE}" || -L "${PUBLISHER_CAPABILITY_FILE}" ]]; then
  echo "Error: FREED_PUBLISHER_CAPABILITY_FILE must name the private broker-issued capability." >&2
  exit 1
fi
CAPABILITY_MODE="$(/usr/bin/stat -f '%Lp' "${PUBLISHER_CAPABILITY_FILE}")"
CAPABILITY_OWNER="$(/usr/bin/stat -f '%u' "${PUBLISHER_CAPABILITY_FILE}")"
if [[ "${CAPABILITY_MODE}" != 600 || "${CAPABILITY_OWNER}" != "$(/usr/bin/id -u)" ]]; then
  echo "Error: the broker-issued capability must be mode 0600 and owned by the current user." >&2
  exit 1
fi

CONTROL_HEAD="$(
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null \
      -C "${CONTROL_ROOT}" rev-parse HEAD
)"
if [[ "${CONTROL_HEAD}" != "${EXPECTED_CONTROL_SHA}" ]]; then
  echo "Error: trusted publisher checkout does not match FREED_TRUSTED_CONTROL_SHA." >&2
  exit 1
fi
if [[ -n "$(
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null \
      -C "${CONTROL_ROOT}" status --porcelain --untracked-files=all
)" ]]; then
  echo "Error: trusted publisher checkout must be clean." >&2
  exit 1
fi
CANDIDATE_ROOT="$(
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null \
      rev-parse --show-toplevel
)"
CANDIDATE_ROOT="$(builtin cd -P -- "${CANDIDATE_ROOT}" && builtin pwd)"
if [[ "${CANDIDATE_ROOT}" == "${CONTROL_ROOT}" ]]; then
  echo "Error: trusted publisher checkout must be outside the candidate worktree." >&2
  exit 1
fi

BASE_BRANCH="dev"
BASE_SEEN=false
PUBLISH_ARGUMENTS=("$@")
for ((argument_index = 0; argument_index < ${#PUBLISH_ARGUMENTS[@]}; argument_index += 1)); do
  if [[ "${PUBLISH_ARGUMENTS[argument_index]}" == "--base" ]]; then
    if ${BASE_SEEN} || ((argument_index + 1 >= ${#PUBLISH_ARGUMENTS[@]})); then
      echo "Error: trusted publisher received an invalid --base argument." >&2
      exit 1
    fi
    BASE_BRANCH="${PUBLISH_ARGUMENTS[argument_index + 1]}"
    BASE_SEEN=true
    argument_index=$((argument_index + 1))
  fi
done
if [[ ! "${BASE_BRANCH}" =~ ^(dev|main|www)$ ]]; then
  echo "Error: trusted publisher base must be dev, main, or www." >&2
  exit 1
fi

if [[ "${TRUSTED_NODE_BIN}" != /* || ! -f "${TRUSTED_NODE_BIN}" || ! -x "${TRUSTED_NODE_BIN}" ]]; then
  echo "Error: FREED_TRUSTED_NODE_BIN must be an immutable absolute executable." >&2
  exit 1
fi
if [[ ! "${TRUSTED_NODE_SHA256}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Error: FREED_TRUSTED_NODE_SHA256 must pin the approved Node binary." >&2
  exit 1
fi
ACTUAL_NODE_SHA256="$(/usr/bin/shasum -a 256 "${TRUSTED_NODE_BIN}" | /usr/bin/awk '{print $1}')"
if [[ "${ACTUAL_NODE_SHA256}" != "${TRUSTED_NODE_SHA256}" ]]; then
  echo "Error: trusted Node does not match FREED_TRUSTED_NODE_SHA256." >&2
  exit 1
fi
NODE_BIN="${TRUSTED_NODE_BIN}"
PINNED_NODE_DIR="${NODE_BIN%/node}"

if [[ "${TRUSTED_GH_BIN}" != /* || ! -f "${TRUSTED_GH_BIN}" || ! -x "${TRUSTED_GH_BIN}" ]]; then
  echo "Error: FREED_TRUSTED_GH_BIN must be an absolute executable regular file." >&2
  exit 1
fi
if [[ ! "${TRUSTED_GH_SHA256}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Error: FREED_TRUSTED_GH_SHA256 must pin the approved GitHub CLI binary." >&2
  exit 1
fi
ACTUAL_GH_SHA256="$(/usr/bin/shasum -a 256 "${TRUSTED_GH_BIN}" | /usr/bin/awk '{print $1}')"
if [[ "${ACTUAL_GH_SHA256}" != "${TRUSTED_GH_SHA256}" ]]; then
  echo "Error: trusted GitHub CLI does not match FREED_TRUSTED_GH_SHA256." >&2
  exit 1
fi

PUBLISH_SCOPE_JSON="$("${NODE_BIN}" -e '
  const fs = require("node:fs");
  const envelope = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const payload = JSON.parse(Buffer.from(envelope.payloadBase64, "base64").toString("utf8"));
  process.stdout.write(JSON.stringify(payload.scope));
' "${PUBLISHER_CAPABILITY_FILE}")"
scope_field() {
  "${NODE_BIN}" -e '
    const value = JSON.parse(process.argv[1]);
    const field = value[process.argv[2]];
    if (field === null || field === undefined) process.exit(0);
    process.stdout.write(String(field));
  ' "${PUBLISH_SCOPE_JSON}" "$1"
}
SCOPE_REPO="$(scope_field repo)"
SCOPE_WORKTREE="$(scope_field worktree)"
SCOPE_BRANCH="$(scope_field branch)"
SCOPE_BASE="$(scope_field base)"
SCOPE_BASE_SHA="$(scope_field baseSha)"
SCOPE_HEAD_SHA="$(scope_field headSha)"
SCOPE_PUBLISH_MODE="$(scope_field publishMode)"

CANDIDATE_ORIGIN="$(
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    /usr/bin/git -C "${CANDIDATE_ROOT}" config --local --get remote.origin.url
)"
if [[ "${CANDIDATE_ORIGIN}" != "https://github.com/freed-project/freed.git" ]]; then
  echo "Error: candidate origin is not the canonical Freed repository." >&2
  exit 1
fi
CANDIDATE_BRANCH="$(
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    /usr/bin/git -C "${CANDIDATE_ROOT}" branch --show-current
)"
if [[ -z "${CANDIDATE_BRANCH}" || "${CANDIDATE_BRANCH}" =~ ^(main|dev|www)$ ]]; then
  echo "Error: trusted publisher requires an unprotected candidate branch." >&2
  exit 1
fi
EXPECTED_PUBLISH_MODE="feature-pr"
if [[ "${BASE_BRANCH}" == "main" ]]; then
  if [[ "${CANDIDATE_BRANCH}" =~ ^chore/promote-dev-to-main-[a-z0-9][a-z0-9._-]*$ ]]; then
    EXPECTED_PUBLISH_MODE="production-promotion"
  elif [[ "${CANDIDATE_BRANCH}" =~ ^chore/release-[a-z0-9][a-z0-9._-]*$ ]]; then
    EXPECTED_PUBLISH_MODE="production-release-prep"
  else
    echo "Error: main publishing is restricted to a production promotion or release-prep branch." >&2
    exit 1
  fi
fi
CANONICAL_BASE_SHA="$(
  "${TRUSTED_GH_BIN}" api \
    "repos/freed-project/freed/git/ref/heads/${BASE_BRANCH}" \
    --jq .object.sha
)"
if [[ ! "${CANONICAL_BASE_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Error: trusted publisher could not resolve the canonical base commit." >&2
  exit 1
fi
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  /usr/bin/git -C "${CANDIDATE_ROOT}" fetch \
    https://github.com/freed-project/freed.git \
    "refs/heads/${BASE_BRANCH}:refs/remotes/origin/${BASE_BRANCH}" >/dev/null
if [[ "$(/usr/bin/git -C "${CANDIDATE_ROOT}" rev-parse "origin/${BASE_BRANCH}")" != "${CANONICAL_BASE_SHA}" ]]; then
  echo "Error: candidate base does not match the canonical GitHub base commit." >&2
  exit 1
fi
if [[ "${BASE_BRANCH}" == "main" ]]; then
  if [[ ! "${SCOPE_HEAD_SHA}" =~ ^[0-9a-f]{40}$ || "$(/usr/bin/git -C "${CANDIDATE_ROOT}" rev-parse HEAD)" != "${SCOPE_HEAD_SHA}" ]]; then
    echo "Error: main publishing requires the exact broker-validated head." >&2
    exit 1
  fi
  if [[ -n "$(/usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "${CANDIDATE_ROOT}" status --porcelain --untracked-files=all)" ]]; then
    echo "Error: a governed main branch must be committed and clean before publishing." >&2
    exit 1
  fi
  (
    builtin cd "${CANDIDATE_ROOT}"
    "${NODE_BIN}" scripts/validate-main-pr.mjs \
      --base-ref=origin/main \
      --head-ref="${SCOPE_HEAD_SHA}" \
      --head-branch="${CANDIDATE_BRANCH}"
  )
elif [[ -n "${SCOPE_HEAD_SHA}" ]]; then
  echo "Error: only a governed main publish may receive a pre-bound head." >&2
  exit 1
fi
if [[
  "${SCOPE_REPO}" != "freed-project/freed" ||
  "${SCOPE_WORKTREE}" != "${CANDIDATE_ROOT}" ||
  "${SCOPE_BRANCH}" != "${CANDIDATE_BRANCH}" ||
  "${SCOPE_BASE}" != "${BASE_BRANCH}" ||
  "${SCOPE_BASE_SHA}" != "${CANONICAL_BASE_SHA}" ||
  "${SCOPE_PUBLISH_MODE}" != "${EXPECTED_PUBLISH_MODE}"
]]; then
  echo "Error: broker-issued capability does not match the validated publish target." >&2
  exit 1
fi

PUBLISH_LEASE_TOKEN=""
builtin declare +x PUBLISH_LEASE_TOKEN

release_publish_lease() {
  if [[ -n "${PUBLISH_LEASE_TOKEN}" ]]; then
    /usr/bin/env -i \
      HOME="${HOME}" \
      PATH=/usr/bin:/bin \
      FREED_AUTOMATION_LEASE_TOKEN="${PUBLISH_LEASE_TOKEN}" \
      "${NODE_BIN}" "${SCRIPT_DIR}/automation-control.mjs" lease release \
        --state-root "${PUBLISH_CONTROL_STATE_ROOT}" \
        --name pr-publisher >/dev/null 2>&1 || true
    PUBLISH_LEASE_TOKEN=""
  fi
}

trap release_publish_lease EXIT

if ! PUBLISH_LEASE_JSON="$(
  /usr/bin/env -i \
    HOME="${HOME}" \
    PATH=/usr/bin:/bin \
    "${NODE_BIN}" "${SCRIPT_DIR}/automation-control.mjs" lease acquire \
      --state-root "${PUBLISH_CONTROL_STATE_ROOT}" \
      --name pr-publisher \
      --owner freed-pr-publisher \
      --ttl-seconds 1800 \
      --capability-file "${PUBLISHER_CAPABILITY_FILE}" \
      --scope-json "${PUBLISH_SCOPE_JSON}"
)"; then
  PUBLISHER_CAPABILITY_FILE=""
  exit 1
fi
PUBLISHER_CAPABILITY_FILE=""
PUBLISH_LEASE_TOKEN="$(
  "${NODE_BIN}" -e '
    const input = require("node:fs").readFileSync(0, "utf8");
    const value = JSON.parse(input)?.result?.lease?.token;
    if (typeof value !== "string" || value.length === 0) process.exit(1);
    process.stdout.write(value);
  ' <<<"${PUBLISH_LEASE_JSON}"
)"
PUBLISH_LEASE_JSON=""

/usr/bin/env -i \
  HOME="${HOME}" \
  DEVELOPER_DIR="${TRUSTED_DEVELOPER_DIR}" \
  PATH="${PINNED_NODE_DIR}:/usr/bin:/bin" \
  FREED_PR_PUBLISHER_LEASE_TOKEN="${PUBLISH_LEASE_TOKEN}" \
  FREED_PUBLISH_CONTROL_STATE_ROOT="${PUBLISH_CONTROL_STATE_ROOT}" \
  FREED_PUBLISH_SCOPE_JSON="${PUBLISH_SCOPE_JSON}" \
  FREED_PUBLISH_GIT_BIN=/usr/bin/git \
  FREED_PUBLISH_GH_BIN="${TRUSTED_GH_BIN}" \
  FREED_PUBLISH_PYTHON_BIN=/usr/bin/python3 \
  FREED_PUBLISH_EXPECTED_REPO=freed-project/freed \
  NODE_BIN="${NODE_BIN}" \
  /bin/bash "${SCRIPT_DIR}/worktree-publish.sh" "$@"
