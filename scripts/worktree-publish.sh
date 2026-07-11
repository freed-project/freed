#!/bin/bash

set -euo pipefail
set +x
umask 077

PUBLISH_LEASE_PRESENT="${FREED_PR_PUBLISHER_LEASE_TOKEN+x}"
PUBLISH_STATE_ROOT_PRESENT="${FREED_PUBLISH_CONTROL_STATE_ROOT+x}"
PUBLISH_SCOPE_PRESENT="${FREED_PUBLISH_SCOPE_JSON+x}"
PUBLISH_GIT_PRESENT="${FREED_PUBLISH_GIT_BIN+x}"
PUBLISH_GH_PRESENT="${FREED_PUBLISH_GH_BIN+x}"
PUBLISH_PYTHON_PRESENT="${FREED_PUBLISH_PYTHON_BIN+x}"
PUBLISH_LEASE_TOKEN="${FREED_PR_PUBLISHER_LEASE_TOKEN:-}"
PUBLISH_CONTROL_STATE_ROOT="${FREED_PUBLISH_CONTROL_STATE_ROOT:-}"
PUBLISH_SCOPE_JSON="${FREED_PUBLISH_SCOPE_JSON:-}"
GIT_BIN="${FREED_PUBLISH_GIT_BIN:-}"
GH_BIN="${FREED_PUBLISH_GH_BIN:-}"
PYTHON_BIN="${FREED_PUBLISH_PYTHON_BIN:-}"
PUBLISH_NODE_BIN="${NODE_BIN:-}"
TRUSTED_PUBLISH_MODE=false
if [[ -n "${PUBLISH_LEASE_PRESENT}" || -n "${PUBLISH_STATE_ROOT_PRESENT}" || -n "${PUBLISH_SCOPE_PRESENT}" || -n "${PUBLISH_GIT_PRESENT}" || -n "${PUBLISH_GH_PRESENT}" || -n "${PUBLISH_PYTHON_PRESENT}" ]]; then
  TRUSTED_PUBLISH_MODE=true
fi
builtin unset \
  FREED_PR_PUBLISHER_ACTOR_TOKEN \
  FREED_PR_PUBLISHER_LEASE_TOKEN \
  FREED_AUTOMATION_ACTOR_TOKEN \
  FREED_AUTOMATION_LEASE_TOKEN \
  FREED_OWNER_BOOTSTRAP_TOKEN \
  FREED_PUBLISH_CONTROL_STATE_ROOT \
  FREED_PUBLISH_SCOPE_JSON \
  FREED_PUBLISH_GIT_BIN \
  FREED_PUBLISH_GH_BIN \
  FREED_PUBLISH_PYTHON_BIN \
  GH_HOST \
  GH_REPO
builtin declare +x PUBLISH_LEASE_TOKEN

SCRIPT_DIR="$(builtin cd -P -- "${BASH_SOURCE[0]%/*}" && builtin pwd)"

if ${TRUSTED_PUBLISH_MODE}; then
  if [[ "${PUBLISH_CONTROL_STATE_ROOT}" != /* ]]; then
    echo "Error: trusted publishing requires an absolute FREED_PUBLISH_CONTROL_STATE_ROOT." >&2
    exit 1
  fi
  NODE_BIN="${PUBLISH_NODE_BIN}"
else
  # Normal feature and release work uses the repository-pinned toolchain and
  # the caller's existing GitHub authentication. The optional trusted broker
  # supplies all six private handoff values together; any partial handoff above
  # enters trusted mode and fails closed instead of silently downgrading.
  # shellcheck source=./lib/node-tooling.sh
  source "${SCRIPT_DIR}/lib/node-tooling.sh"
  NODE_BIN="$(resolve_node_bin)"
  GIT_BIN="$(command -v git || true)"
  GH_BIN="$(command -v gh || true)"
  PYTHON_BIN="$(command -v python3 || true)"
  PUBLISH_CONTROL_STATE_ROOT="${HOME}/.freed/automation"
  PUBLISH_SCOPE_JSON=""
  PUBLISH_LEASE_TOKEN=""
fi

usage() {
  cat <<'EOF'
Usage:
  ./scripts/worktree-publish.sh --title "<conventional-commit title>" [--summary "<bullet>"]... [--test "<bullet>"]... [--base <branch>] [--body-file <path>] [--include-untracked] [--ready] [--provider-risk-approval-file <path>]

Draft is the default so interim publishes never look reviewable. Pass --ready at
closeout, once validation has passed and the work is complete, to mark the PR
ready for review. Re-running without --ready after the branch changes demotes a
ready PR back to draft on purpose: the content moved since the owner saw it.

Stages local changes, commits them when needed, pushes the current branch to origin,
and opens a draft pull request.

Branches whose diff touches provider-visible paths (canonical list:
scripts/lib/provider-visible-paths.mjs) must be committed before publish and
are refused unless --provider-risk-approval-file supplies a valid approval for
the exact providers, behavior, path set, diff hash, owner reference, and expiry.
EOF
}

require_executable() {
  local command_path="$1"
  local command_name="$2"

  if [[ "${command_path}" != /* || ! -f "${command_path}" || ! -x "${command_path}" ]]; then
    echo "Error: required ${command_name} executable '${command_path}' is invalid." >&2
    exit 1
  fi
}

ensure_conventional_title() {
  local title="$1"

  if [[ ! "${title}" =~ ^(feat|fix|chore|docs|refactor|perf|style):\ .+ ]]; then
    echo "Error: title must use a Conventional Commit prefix such as 'feat:' or 'fix:'." >&2
    exit 1
  fi
}

current_branch() {
  "${GIT_BIN}" branch --show-current
}

ensure_publishable_branch() {
  local branch_name="$1"

  if [[ -z "${branch_name}" ]]; then
    echo "Error: cannot publish from a detached HEAD." >&2
    exit 1
  fi

  case "${branch_name}" in
    main|dev|www)
      echo "Error: refusing to publish directly from protected branch '${branch_name}'." >&2
      exit 1
      ;;
  esac
}

ensure_publishable_base() {
  case "$1" in
    dev|main|www)
      ;;
    *)
      echo "Error: publish base must be dev, main, or www." >&2
      exit 1
      ;;
  esac
}

has_worktree_changes() {
  [[ -n "$("${GIT_BIN}" status --short)" ]]
}

branch_has_unique_commits() {
  local base_branch="$1"

  [[ "$("${GIT_BIN}" rev-list --count "origin/${base_branch}..HEAD")" -gt 0 ]]
}

list_untracked_files() {
  "${GIT_BIN}" ls-files --others --exclude-standard
}

build_body() {
  local title="$1"
  shift

  local summaries=()
  local tests=()
  local mode="summary"
  local item

  for item in "$@"; do
    case "${item}" in
      --summary)
        mode="summary"
        ;;
      --test)
        mode="test"
        ;;
      *)
        if [[ "${mode}" == "summary" ]]; then
          summaries+=("${item}")
        else
          tests+=("${item}")
        fi
        ;;
    esac
  done

  if [[ ${#summaries[@]} -eq 0 ]]; then
    summaries+=("${title#*: }")
  fi

  if [[ ${#tests[@]} -eq 0 ]]; then
    tests+=("Not run, no focused validation was recorded.")
  fi

  printf '%s\n\n' '(AI Generated).'
  printf '## Summary\n'
  for item in "${summaries[@]}"; do
    printf -- '- %s\n' "${item}"
  done
  printf '\n## Testing\n'
  for item in "${tests[@]}"; do
    printf -- '- %s\n' "${item}"
  done
}

pr_field() {
  local json="$1"
  local field="$2"

  "${PYTHON_BIN}" - "${json}" "${field}" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
field = sys.argv[2]

if not payload:
    raise SystemExit(0)

value = payload[0].get(field, "")
if isinstance(value, bool):
    print("true" if value else "false")
else:
    print(value)
PY
}

json_nested_field() {
  local json="$1"
  shift

  "${PYTHON_BIN}" - "${json}" "$@" <<'PY'
import json
import sys

value = json.loads(sys.argv[1])
for key in sys.argv[2:]:
    if not isinstance(value, dict) or key not in value:
        value = None
        break
    value = value[key]
if value is None:
    raise SystemExit(0)
print(value)
PY
}

provider_approval_markdown() {
  local json="$1"

  "${PYTHON_BIN}" - "${json}" <<'PY'
import json
import sys

approval = json.loads(sys.argv[1])
print("## Provider Visible Approval")
print(f"- Approval ID: `{approval['approvalId']}`")
print(f"- Approved by: {approval['approvedBy']}")
print(f"- Owner reference: {approval['ownerApprovalReference']}")
print(f"- Approval source: {approval['approvalSource']['kind']} `{approval['approvalSource']['reference']}`")
print(f"- Owner authorization digest: `{approval['authorizationDigest']}`")
print(f"- Providers: {', '.join(approval['providers'])}")
print(f"- Observable behavior: {approval['observableBehavior']}")
print(f"- Fingerprinting risk: {approval['fingerprintingRisk']}")
print(f"- Lowest profile alternative: {approval['lowestProfileAlternative']}")
print(f"- Approved diff: `{approval['diffSha']}`")
print(f"- Approved at: {approval['approvedAt']}")
print(f"- Expires at: {approval['expiresAt']}")
print("")
print("Provider visible paths in this diff:")
for file_path in approval["paths"]:
    print(f"- `{file_path}`")
PY
}

TITLE=""
BASE_BRANCH="dev"
PUBLISH_REPO="freed-project/freed"
BODY_FILE=""
INCLUDE_UNTRACKED=false
READY_FOR_REVIEW=false
PROVIDER_RISK_APPROVAL_FILE=""
PROVIDER_RISK_APPROVAL_JSON=""
FINAL_PROVIDER_VISIBLE_FILES=""
FINAL_PROVIDER_DIFF_SHA=""
PUBLISH_HEAD=""
BRANCH_NAME=""
SCOPE_HEAD_SHA=""
EXPECTED_BASE_SHA=""
EXPECTED_DEV_SHA=""
SUMMARY_ARGS=()
TEST_ARGS=()

release_publish_lease() {
  if ${TRUSTED_PUBLISH_MODE} && [[ -n "${PUBLISH_LEASE_TOKEN}" ]]; then
    FREED_AUTOMATION_LEASE_TOKEN="${PUBLISH_LEASE_TOKEN}" \
      "${NODE_BIN}" "${SCRIPT_DIR}/automation-control.mjs" lease release \
      --state-root "${PUBLISH_CONTROL_STATE_ROOT}" \
      --name pr-publisher >/dev/null 2>&1 || true
    PUBLISH_LEASE_TOKEN=""
  fi
}

validate_publish_lease() {
  if ! ${TRUSTED_PUBLISH_MODE}; then
    return 0
  fi
  FREED_AUTOMATION_LEASE_TOKEN="${PUBLISH_LEASE_TOKEN}" \
    "${NODE_BIN}" "${SCRIPT_DIR}/automation-control.mjs" lease heartbeat \
    --state-root "${PUBLISH_CONTROL_STATE_ROOT}" \
    --name pr-publisher \
    --ttl-seconds 1800 >/dev/null
  if [[ -n "${PUBLISH_HEAD}" ]]; then
    FREED_AUTOMATION_LEASE_TOKEN="${PUBLISH_LEASE_TOKEN}" \
      "${NODE_BIN}" "${SCRIPT_DIR}/automation-control.mjs" lease bind-head \
      --state-root "${PUBLISH_CONTROL_STATE_ROOT}" \
      --name pr-publisher \
      --scope-json "${PUBLISH_SCOPE_JSON}" \
      --head-sha "${PUBLISH_HEAD}" >/dev/null
  fi
}

ensure_repo_identity() {
  local origin_url
  origin_url="$("${GIT_BIN}" config --get remote.origin.url)"
  case "${origin_url}" in
    "https://github.com/${PUBLISH_REPO}"|"https://github.com/${PUBLISH_REPO}.git"|"git@github.com:${PUBLISH_REPO}"|"git@github.com:${PUBLISH_REPO}.git"|"ssh://git@github.com/${PUBLISH_REPO}"|"ssh://git@github.com/${PUBLISH_REPO}.git")
      ;;
    *)
      echo "Error: origin must be the canonical ${PUBLISH_REPO} repository, found '${origin_url}'." >&2
      exit 1
      ;;
  esac
}

validate_publish_scope_target() {
  if ! ${TRUSTED_PUBLISH_MODE}; then
    EXPECTED_BASE_SHA="$("${GIT_BIN}" rev-parse "origin/${BASE_BRANCH}")"
    SCOPE_HEAD_SHA=""
    return 0
  fi
  if [[ -z "${PUBLISH_SCOPE_JSON}" ]]; then
    echo "Error: publishing requires a target-scoped publisher lease." >&2
    exit 1
  fi
  local scope_repo
  local scope_worktree
  local scope_branch
  local scope_base
  local scope_base_sha
  local scope_head_sha
  local physical_worktree
  scope_repo="$(json_nested_field "${PUBLISH_SCOPE_JSON}" repo)"
  scope_worktree="$(json_nested_field "${PUBLISH_SCOPE_JSON}" worktree)"
  scope_branch="$(json_nested_field "${PUBLISH_SCOPE_JSON}" branch)"
  scope_base="$(json_nested_field "${PUBLISH_SCOPE_JSON}" base)"
  scope_base_sha="$(json_nested_field "${PUBLISH_SCOPE_JSON}" baseSha)"
  scope_head_sha="$(json_nested_field "${PUBLISH_SCOPE_JSON}" headSha)"
  physical_worktree="$(builtin cd -P -- "$("${GIT_BIN}" rev-parse --show-toplevel)" && builtin pwd)"
  if [[
    "${scope_repo}" != "${PUBLISH_REPO}" ||
    "${scope_worktree}" != "${physical_worktree}" ||
    "${scope_branch}" != "${BRANCH_NAME}" ||
    "${scope_base}" != "${BASE_BRANCH}" ||
    "${scope_base_sha}" != "$("${GIT_BIN}" rev-parse "origin/${BASE_BRANCH}")"
  ]]; then
    echo "Error: publisher lease target does not match this repo, worktree, branch, base, and base commit." >&2
    exit 1
  fi
  SCOPE_HEAD_SHA="${scope_head_sha}"
  EXPECTED_BASE_SHA="${scope_base_sha}"
}

verify_canonical_ref() {
  local branch_name="$1"
  local expected_sha="$2"
  local canonical_base_sha
  canonical_base_sha="$(
    "${GH_BIN}" api \
      "repos/${PUBLISH_REPO}/git/ref/heads/${branch_name}" \
      --jq .object.sha
  )"
  if [[ "${canonical_base_sha}" != "${expected_sha}" ]]; then
    if ${TRUSTED_PUBLISH_MODE}; then
      echo "Error: canonical ${branch_name} moved after the publisher capability was issued or validated." >&2
    else
      echo "Error: canonical ${branch_name} moved after the local ref was fetched. Re-run publish." >&2
    fi
    exit 1
  fi
}

verify_canonical_base() {
  verify_canonical_ref "${BASE_BRANCH}" "${EXPECTED_BASE_SHA}"
  if [[ "${BASE_BRANCH}" == "main" ]]; then
    verify_canonical_ref dev "${EXPECTED_DEV_SHA}"
  fi
}

verify_remote_head() {
  local remote_line
  local remote_head
  remote_line="$("${GIT_BIN}" ls-remote --exit-code origin "refs/heads/${BRANCH_NAME}")"
  remote_head="${remote_line%%$'\t'*}"
  if [[ "${remote_head}" != "${PUBLISH_HEAD}" ]]; then
    echo "Error: remote branch ${BRANCH_NAME} does not match the inspected publish head." >&2
    exit 1
  fi
}

revalidate_provider_approval() {
  if [[ -z "${FINAL_PROVIDER_VISIBLE_FILES}" ]]; then
    return
  fi
  printf '%s\n' "${FINAL_PROVIDER_VISIBLE_FILES}" |
    "${NODE_BIN}" "${SCRIPT_DIR}/lib/provider-visible-paths.mjs" \
      --stdin \
      --validate-approval "${PROVIDER_RISK_APPROVAL_FILE}" \
      --diff-sha "${FINAL_PROVIDER_DIFF_SHA}" \
      --control-state-root "${PUBLISH_CONTROL_STATE_ROOT}" >/dev/null
}

assert_publish_write_ready() {
  validate_publish_lease
  verify_canonical_base
  verify_remote_head
  revalidate_provider_approval
}

verify_pr_target_head() {
  local pr_reference="$1"
  local expected_head="$2"
  local pr_json
  local pr_head
  local pr_base
  verify_canonical_base
  pr_json="$("${GH_BIN}" pr view "${pr_reference}" --repo "${PUBLISH_REPO}" --json headRefOid,baseRefName)"
  pr_head="$(json_nested_field "${pr_json}" headRefOid)"
  pr_base="$(json_nested_field "${pr_json}" baseRefName)"
  if [[ "${pr_head}" != "${expected_head}" || "${pr_base}" != "${BASE_BRANCH}" ]]; then
    echo "Error: pull request target does not match the inspected publish head and base." >&2
    exit 1
  fi
}

verify_pr_target() {
  verify_pr_target_head "$1" "${PUBLISH_HEAD}"
}

ensure_provider_pr_draft_before_push() {
  if [[ -z "${FINAL_PROVIDER_VISIBLE_FILES}" ]]; then
    return
  fi
  local existing_json
  local existing_number
  local existing_is_draft
  local existing_head
  existing_json="$(
    "${GH_BIN}" pr list \
      --repo "${PUBLISH_REPO}" \
      --head "${BRANCH_NAME}" \
      --base "${BASE_BRANCH}" \
      --state open \
      --json number,isDraft,headRefOid,baseRefName \
      --limit 1
  )"
  existing_number="$(pr_field "${existing_json}" number)"
  existing_is_draft="$(pr_field "${existing_json}" isDraft)"
  existing_head="$(pr_field "${existing_json}" headRefOid)"
  if [[ -z "${existing_number}" || "${existing_is_draft}" == "true" ]]; then
    return
  fi
  validate_publish_lease
  verify_canonical_base
  revalidate_provider_approval
  verify_pr_target_head "${existing_number}" "${existing_head}"
  "${GH_BIN}" pr ready "${existing_number}" --repo "${PUBLISH_REPO}" --undo >/dev/null
}

trap release_publish_lease EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)
      [[ $# -ge 2 ]] || { echo "Error: --title requires a value." >&2; exit 1; }
      TITLE="$2"
      shift 2
      ;;
    --base)
      [[ $# -ge 2 ]] || { echo "Error: --base requires a value." >&2; exit 1; }
      BASE_BRANCH="$2"
      shift 2
      ;;
    --summary)
      [[ $# -ge 2 ]] || { echo "Error: --summary requires a value." >&2; exit 1; }
      SUMMARY_ARGS+=("$2")
      shift 2
      ;;
    --test)
      [[ $# -ge 2 ]] || { echo "Error: --test requires a value." >&2; exit 1; }
      TEST_ARGS+=("$2")
      shift 2
      ;;
    --body-file)
      [[ $# -ge 2 ]] || { echo "Error: --body-file requires a value." >&2; exit 1; }
      BODY_FILE="$2"
      shift 2
      ;;
    --include-untracked)
      INCLUDE_UNTRACKED=true
      shift
      ;;
    --ready)
      READY_FOR_REVIEW=true
      shift
      ;;
    --provider-risk-approval-file)
      [[ $# -ge 2 && -n "$2" ]] || { echo "Error: --provider-risk-approval-file requires a JSON file path." >&2; exit 1; }
      PROVIDER_RISK_APPROVAL_FILE="$2"
      shift 2
      ;;
    --approved-provider-risk)
      echo "Error: --approved-provider-risk was replaced by --provider-risk-approval-file." >&2
      exit 1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Error: unexpected argument '$1'." >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${TITLE}" ]]; then
  usage
  exit 1
fi

require_executable "${GIT_BIN}" git
require_executable "${GH_BIN}" gh
require_executable "${PYTHON_BIN}" python3
require_executable "${NODE_BIN:-}" node
# Machine preflight, warn-only: surface broken gh/credential helpers with
# remediation before the publish flow trips over them.
"${NODE_BIN}" "${SCRIPT_DIR}/doctor.mjs" || true

ensure_conventional_title "${TITLE}"
ensure_publishable_base "${BASE_BRANCH}"

if ! "${GIT_BIN}" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: current directory is not inside a git repository." >&2
  exit 1
fi
ensure_repo_identity

if [[ "${BASE_BRANCH}" == "main" ]]; then
  # Main validation compares promotion branches with origin/dev. Refresh both
  # long-lived refs so a stale local dev ref cannot bless an old promotion.
  "${GIT_BIN}" fetch origin main dev >/dev/null 2>&1
  EXPECTED_DEV_SHA="$("${GIT_BIN}" rev-parse origin/dev)"
else
  "${GIT_BIN}" fetch origin "${BASE_BRANCH}" >/dev/null 2>&1
fi

BRANCH_NAME="$(current_branch)"
ensure_publishable_branch "${BRANCH_NAME}"
validate_publish_scope_target

if ${TRUSTED_PUBLISH_MODE}; then
  if [[ -z "${PUBLISH_LEASE_TOKEN}" ]]; then
    echo "Error: publishing requires FREED_PR_PUBLISHER_LEASE_TOKEN from the trusted host launcher." >&2
    exit 1
  fi
  if ! validate_publish_lease; then
    echo "Error: FREED_PR_PUBLISHER_LEASE_TOKEN is not a live publisher lease." >&2
    exit 1
  fi
fi

# Provider-visible gate (stability task W1-06): refuse to publish a branch
# whose committed diff touches provider-visible paths unless a scoped approval
# record matches the exact diff. Canonical list + predicate:
# scripts/lib/provider-visible-paths.mjs
COMMITTED_PROVIDER_VISIBLE_FILES="$(
  "${GIT_BIN}" diff --no-renames --no-ext-diff --name-only "origin/${BASE_BRANCH}...HEAD" |
    sort -u |
    "${NODE_BIN}" "${SCRIPT_DIR}/lib/provider-visible-paths.mjs" --stdin
)"
WORKING_PROVIDER_VISIBLE_FILES="$(
  {
    "${GIT_BIN}" diff --no-renames --no-ext-diff --name-only HEAD
    if ${INCLUDE_UNTRACKED}; then
      list_untracked_files
    fi
  } | sort -u | "${NODE_BIN}" "${SCRIPT_DIR}/lib/provider-visible-paths.mjs" --stdin
)"
PROVIDER_VISIBLE_FILES="${COMMITTED_PROVIDER_VISIBLE_FILES}"

if [[ -n "${WORKING_PROVIDER_VISIBLE_FILES}" ]]; then
  echo "Error: provider-visible changes must be committed before approval and publish:" >&2
  echo "" >&2
  printf '%s\n' "${WORKING_PROVIDER_VISIBLE_FILES}" >&2
  echo "" >&2
  echo "Commit the reviewed provider change, calculate its diff hash, then create a scoped approval JSON file." >&2
  exit 1
fi

if [[ -n "${PROVIDER_VISIBLE_FILES}" && -z "${PROVIDER_RISK_APPROVAL_FILE}" ]]; then
  echo "Error: this branch touches provider-visible paths:" >&2
  echo "" >&2
  printf '%s\n' "${PROVIDER_VISIBLE_FILES}" >&2
  echo "" >&2
  echo "Changes to provider-visible surfaces (WebView loads, provider navigation," >&2
  echo "request frequency, cookies, headers, extractor scripts) require explicit" >&2
  echo "owner approval before publish. See AGENTS.md and docs/STABILITY-PROGRAM.md." >&2
  echo "" >&2
  echo "After obtaining scoped approval for the committed diff, re-run with:" >&2
  echo "  --provider-risk-approval-file <approval.json>" >&2
  exit 1
fi

if [[ -n "${PROVIDER_VISIBLE_FILES}" ]]; then
  if has_worktree_changes; then
    echo "Error: a provider-approved branch must be clean so its diff hash cannot change during publish." >&2
    exit 1
  fi
  PROVIDER_DIFF_SHA="$("${GIT_BIN}" diff --binary --no-ext-diff --no-textconv "origin/${BASE_BRANCH}...HEAD" | "${GIT_BIN}" hash-object --stdin)"
  PROVIDER_RISK_APPROVAL_JSON="$(
    printf '%s\n' "${PROVIDER_VISIBLE_FILES}" |
      "${NODE_BIN}" "${SCRIPT_DIR}/lib/provider-visible-paths.mjs" \
        --stdin \
        --validate-approval "${PROVIDER_RISK_APPROVAL_FILE}" \
        --diff-sha "${PROVIDER_DIFF_SHA}" \
        --control-state-root "${PUBLISH_CONTROL_STATE_ROOT}"
  )"
  if ${READY_FOR_REVIEW}; then
    echo "Error: provider-visible pull requests must remain draft until the CODEOWNER reviews the exact diff." >&2
    exit 1
  fi
elif [[ -n "${PROVIDER_RISK_APPROVAL_FILE}" ]]; then
  echo "Error: --provider-risk-approval-file was provided, but this branch has no provider-visible committed diff." >&2
  exit 1
fi

if [[ "${BASE_BRANCH}" == "main" ]] && has_worktree_changes; then
  echo "Error: main publishing requires a committed, clean branch." >&2
  exit 1
fi

if has_worktree_changes; then
  UNTRACKED_FILES="$(list_untracked_files)"
  if [[ -n "${UNTRACKED_FILES}" ]] && ! ${INCLUDE_UNTRACKED}; then
    echo "Error: untracked files are present." >&2
    echo "Stage intentional new files explicitly, ignore local junk, or re-run with --include-untracked." >&2
    echo "" >&2
    printf '%s\n' "${UNTRACKED_FILES}" >&2
    exit 1
  fi

  if ${INCLUDE_UNTRACKED}; then
    "${GIT_BIN}" add -A
  else
    "${GIT_BIN}" add -u
  fi

  if "${GIT_BIN}" diff --cached --quiet; then
    echo "Error: no staged changes found after staging tracked files." >&2
    exit 1
  fi
  "${GIT_BIN}" commit -m "${TITLE}"
elif ! branch_has_unique_commits "${BASE_BRANCH}"; then
  echo "Error: no local changes and no commits ahead of origin/${BASE_BRANCH}." >&2
  exit 1
fi

validate_publish_lease

PUBLISH_HEAD="$("${GIT_BIN}" rev-parse HEAD)"
if [[ "${BASE_BRANCH}" == "main" ]]; then
  if ${TRUSTED_PUBLISH_MODE} && [[ ! "${SCOPE_HEAD_SHA}" =~ ^[0-9a-f]{40}$ || "${PUBLISH_HEAD}" != "${SCOPE_HEAD_SHA}" ]]; then
    echo "Error: governed main head changed after broker validation." >&2
    exit 1
  fi
  "${NODE_BIN}" "${SCRIPT_DIR}/validate-main-pr.mjs" \
    --cwd="$("${GIT_BIN}" rev-parse --show-toplevel)" \
    --base-ref=origin/main \
    --head-ref="${PUBLISH_HEAD}" \
    --head-branch="${BRANCH_NAME}"
elif ${TRUSTED_PUBLISH_MODE} && [[ -n "${SCOPE_HEAD_SHA}" ]]; then
  echo "Error: only governed main capabilities may pre-bind a publish head." >&2
  exit 1
fi
FINAL_PROVIDER_VISIBLE_FILES="$(
  "${GIT_BIN}" diff --no-renames --no-ext-diff --name-only "origin/${BASE_BRANCH}...${PUBLISH_HEAD}" |
    sort -u |
    "${NODE_BIN}" "${SCRIPT_DIR}/lib/provider-visible-paths.mjs" --stdin
)"
if [[ "${FINAL_PROVIDER_VISIBLE_FILES}" != "${PROVIDER_VISIBLE_FILES}" ]]; then
  echo "Error: provider-visible paths changed after the publish gate inspected the branch." >&2
  exit 1
fi
if [[ -n "${FINAL_PROVIDER_VISIBLE_FILES}" ]]; then
  FINAL_PROVIDER_DIFF_SHA="$("${GIT_BIN}" diff --binary --no-ext-diff --no-textconv "origin/${BASE_BRANCH}...${PUBLISH_HEAD}" | "${GIT_BIN}" hash-object --stdin)"
  if [[ "${FINAL_PROVIDER_DIFF_SHA}" != "${PROVIDER_DIFF_SHA}" ]]; then
    echo "Error: the committed provider diff changed after owner approval validation." >&2
    exit 1
  fi
  PROVIDER_RISK_APPROVAL_JSON="$(
    printf '%s\n' "${FINAL_PROVIDER_VISIBLE_FILES}" |
      "${NODE_BIN}" "${SCRIPT_DIR}/lib/provider-visible-paths.mjs" \
        --stdin \
        --validate-approval "${PROVIDER_RISK_APPROVAL_FILE}" \
        --diff-sha "${FINAL_PROVIDER_DIFF_SHA}" \
        --control-state-root "${PUBLISH_CONTROL_STATE_ROOT}"
  )"
fi

validate_publish_lease
ensure_provider_pr_draft_before_push
verify_canonical_base
"${GIT_BIN}" push -u origin "${PUBLISH_HEAD}:refs/heads/${BRANCH_NAME}"
verify_remote_head

BODY_CONTENT=""
if [[ -n "${BODY_FILE}" ]]; then
  BODY_CONTENT="$(cat "${BODY_FILE}")"
  if [[ "${BODY_CONTENT}" != "(AI Generated)."* ]]; then
    BODY_CONTENT="$(printf '%s\n\n%s' '(AI Generated).' "${BODY_CONTENT}")"
  fi
else
  BODY_ARGS=()
  for item in "${SUMMARY_ARGS[@]-}"; do
    [[ -n "${item}" ]] || continue
    BODY_ARGS+=(--summary "${item}")
  done
  for item in "${TEST_ARGS[@]-}"; do
    [[ -n "${item}" ]] || continue
    BODY_ARGS+=(--test "${item}")
  done
  BODY_CONTENT="$(build_body "${TITLE}" "${BODY_ARGS[@]-}")"
fi

if [[ -n "${PROVIDER_RISK_APPROVAL_JSON}" ]]; then
  APPROVAL_SECTION="$(provider_approval_markdown "${PROVIDER_RISK_APPROVAL_JSON}")"
  BODY_CONTENT="$(printf '%s\n\n%s' "${BODY_CONTENT}" "${APPROVAL_SECTION}")"
fi

EXISTING_PR_JSON="$(
  "${GH_BIN}" pr list \
    --repo "${PUBLISH_REPO}" \
    --head "${BRANCH_NAME}" \
    --base "${BASE_BRANCH}" \
    --state open \
    --json number,url,isDraft,headRefOid,baseRefName \
    --limit 1
)"
EXISTING_PR_NUMBER="$(pr_field "${EXISTING_PR_JSON}" "number")"
EXISTING_PR_URL="$(pr_field "${EXISTING_PR_JSON}" "url")"
EXISTING_PR_IS_DRAFT="$(pr_field "${EXISTING_PR_JSON}" "isDraft")"
EXISTING_PR_HEAD="$(pr_field "${EXISTING_PR_JSON}" "headRefOid")"
EXISTING_PR_BASE="$(pr_field "${EXISTING_PR_JSON}" "baseRefName")"

if [[ -n "${EXISTING_PR_NUMBER}" ]]; then
  if [[ "${EXISTING_PR_HEAD}" != "${PUBLISH_HEAD}" || "${EXISTING_PR_BASE}" != "${BASE_BRANCH}" ]]; then
    echo "Error: existing pull request target does not match the inspected publish head and base." >&2
    exit 1
  fi
  if ${READY_FOR_REVIEW}; then
    assert_publish_write_ready
    verify_pr_target "${EXISTING_PR_NUMBER}"
    "${GH_BIN}" pr edit "${EXISTING_PR_NUMBER}" --repo "${PUBLISH_REPO}" --title "${TITLE}" --body "${BODY_CONTENT}" >/dev/null
    if [[ "${EXISTING_PR_IS_DRAFT}" == "true" ]]; then
      assert_publish_write_ready
      verify_pr_target "${EXISTING_PR_NUMBER}"
      "${GH_BIN}" pr ready "${EXISTING_PR_NUMBER}" --repo "${PUBLISH_REPO}" >/dev/null
    fi
    verify_pr_target "${EXISTING_PR_NUMBER}"
    printf 'Updated PR (ready for review): %s\n' "${EXISTING_PR_URL}"
    exit 0
  fi
  # Without --ready, a changed branch demotes a ready PR back to draft so the
  # owner knows the content moved since they last looked.
  if [[ "${EXISTING_PR_IS_DRAFT}" != "true" ]]; then
    assert_publish_write_ready
    verify_pr_target "${EXISTING_PR_NUMBER}"
    "${GH_BIN}" pr ready "${EXISTING_PR_NUMBER}" --repo "${PUBLISH_REPO}" --undo >/dev/null
  fi
  assert_publish_write_ready
  verify_pr_target "${EXISTING_PR_NUMBER}"
  "${GH_BIN}" pr edit "${EXISTING_PR_NUMBER}" --repo "${PUBLISH_REPO}" --title "${TITLE}" --body "${BODY_CONTENT}" >/dev/null
  verify_pr_target "${EXISTING_PR_NUMBER}"
  printf 'Updated draft PR: %s\n' "${EXISTING_PR_URL}"
  exit 0
fi

CREATE_ARGS=(
  --base "${BASE_BRANCH}"
  --head "${BRANCH_NAME}"
  --title "${TITLE}"
  --body "${BODY_CONTENT}"
)
if ! ${READY_FOR_REVIEW}; then
  CREATE_ARGS=(--draft "${CREATE_ARGS[@]}")
fi
assert_publish_write_ready
CREATED_PR_URL="$("${GH_BIN}" pr create --repo "${PUBLISH_REPO}" "${CREATE_ARGS[@]}")"
verify_pr_target "${BRANCH_NAME}"
printf '%s\n' "${CREATED_PR_URL}"
