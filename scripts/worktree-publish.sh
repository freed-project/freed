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
  FREED_AUTOMATION_LEASE_OPERATION_ID \
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
  GH_BIN="$("${NODE_BIN}" "${SCRIPT_DIR}/lib/github-tooling.mjs")"
  PYTHON_BIN="$(command -v python3 || true)"
  PUBLISH_CONTROL_STATE_ROOT="${HOME}/.freed/automation"
  PUBLISH_SCOPE_JSON=""
  PUBLISH_LEASE_TOKEN=""
fi

usage() {
  cat <<'EOF'
Usage:
  ./scripts/worktree-publish.sh --title "<conventional-commit title>" [--summary "<bullet>"]... [--test "<bullet>"]... [--base <branch>] [--body-file <path>] [--include-untracked] [--ready] [--provider-risk-review-artifact <path>] [--provider-risk-approval-file <path>]
  ./scripts/worktree-publish.sh --print-provider-subdiff

--print-provider-subdiff prints the current provider subdiff SHA and exits. Put
that value in the audit record when useful. A human Gate 1 artifact approves
the described provider behavior and provider set, not one exact diff. The
optional signed control-task route remains exact-diff bound.

Draft is the default so interim publishes never look reviewable. Pass --ready at
closeout, once validation has passed and the work is complete, to mark the PR
ready for review. Re-running without --ready after the branch changes demotes a
ready PR back to draft on purpose: the content moved since the owner saw it.

Stages local changes, commits them when needed, pushes the current branch to origin,
and opens a draft pull request.

Branches whose diff touches provider-visible paths require one validated
provider-risk-review artifact, and post one GitHub comment naming that artifact
and the provider subdiff as the audit record. That artifact is the authority:
no reaction or second approval step is needed, and such a branch may open
directly as ready. The artifact approves a described provider behavior, not one
exact diff, so a later commit does not invalidate it; every publish that touches
a provider-visible path posts its own audit comment. A behavior change beyond
what was approved requires a fresh Gate 1 artifact. A signed control-task
approval file remains available for unattended publication.
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
if isinstance(value, bool):
    print("true" if value else "false")
else:
    print(value)
PY
}

json_array_lines() {
  local json="$1"
  shift

  "${PYTHON_BIN}" - "${json}" "$@" <<'PY'
import json
import sys

value = json.loads(sys.argv[1])
for key in sys.argv[2:]:
    if not isinstance(value, dict) or key not in value:
        raise SystemExit(1)
    value = value[key]
if not isinstance(value, list):
    raise SystemExit(1)
for item in sorted({str(item).strip() for item in value if str(item).strip()}):
    print(item)
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

provider_review_context_markdown() {
  local artifact_json="$1"

  "${PYTHON_BIN}" - "${artifact_json}" <<'PY'
import json
import sys

artifact = json.loads(sys.argv[1])
payload = artifact["payload"]

def one_line(value):
    return " ".join(str(value).split())

print(f"- Provider review task: `{one_line(artifact['taskId'])}`")
print(f"- Provider review decision: `{one_line(artifact['status'])}`")
print(f"- Provider review artifact: `{artifact['artifactDigest']}`")
print(f"- Providers: {', '.join(sorted(payload['providers']))}")
print(f"- Observable behavior: {one_line(payload['observableBehavior'])}")
print(f"- Fingerprinting risk: {one_line(payload['fingerprintingRisk'])}")
print(f"- Lowest profile alternative: {one_line(payload['lowestProfileAlternative'])}")
PY
}

provider_review_markdown() {
  local diff_sha="$1"
  local files="$2"
  local artifact_json="${3:-}"

  printf '%s\n' "## Provider Review"
  if ${READY_FOR_REVIEW}; then
    printf '%s\n' "- Status: Provider authority is validated for ready publication."
  else
    printf '%s\n' "- Status: Draft publication was requested. Provider authority is validated, but no ready transition was requested."
  fi
  if [[ "${PROVIDER_APPROVAL_SOURCE_KIND}" == "control-task" ]]; then
    printf '%s\n' "- Review action: none required. The signed control task authorizes this exact provider subdiff and provider set; the subdiff below is its audit subject."
  else
    printf '%s\n' "- Review action: none required. The provider-risk artifact records the behavior authority decision; this exact provider subdiff is the audit subject."
  fi
  printf '%s\n' "- Provider subdiff: \`${diff_sha}\`"
  printf '%s\n' "- Publication does not authorize new live provider traffic. Gate 1 behavior approval still applies when observable behavior changes."
  if [[ -n "${artifact_json}" ]]; then
    provider_review_context_markdown "${artifact_json}"
  fi
  printf '\n%s\n' "Files bound into this provider review:"
  while IFS= read -r file_path; do
    [[ -n "${file_path}" ]] || continue
    printf '%s\n' "- \`${file_path}\`"
  done <<< "${files}"
}

provider_diff_sha() {
  local base_ref="$1"
  local head_ref="$2"
  local files="$3"
  local path_args=()
  local file_path

  while IFS= read -r file_path; do
    [[ -n "${file_path}" ]] || continue
    path_args+=("${file_path}")
  done <<< "${files}"
  "${GIT_BIN}" diff --binary --no-ext-diff --no-textconv \
    "${base_ref}...${head_ref}" -- "${path_args[@]}" |
    "${GIT_BIN}" hash-object --stdin
}

provider_bound_files() {
  local base_ref="$1"
  local head_ref="$2"
  local provider_files="$3"

  "${GIT_BIN}" diff --name-status -z -M "${base_ref}...${head_ref}" |
    "${PYTHON_BIN}" -c '
import sys

provider_paths = {path for path in sys.argv[1].splitlines() if path}
tokens = sys.stdin.buffer.read().split(b"\0")
bound = set()
index = 0
while index < len(tokens) and tokens[index]:
    status = tokens[index].decode("ascii", "strict")
    index += 1
    path_count = 2 if status.startswith(("R", "C")) else 1
    paths = [tokens[index + offset].decode("utf-8", "surrogateescape") for offset in range(path_count)]
    index += path_count
    if any(path in provider_paths for path in paths):
        bound.update(paths)
for path in sorted(bound):
    print(path)
' "${provider_files}"
}

provider_review_comment_body() {
  local diff_sha="$1"
  local files="$2"
  local authority_marker
  authority_marker="$(provider_review_authority_marker)"

  printf '%s\n' '(AI Generated).'
  printf '\n%s\n' "<!-- freed-provider-review:${diff_sha} -->"
  printf '%s\n' "${authority_marker}"
  printf '\n%s\n\n' "## Provider review"
  printf '%s\n' "This review covers the provider-visible subdiff below. It does not approve unrelated files."
  if [[ "${PROVIDER_APPROVAL_SOURCE_KIND}" == "control-task" ]]; then
    printf '%s\n' "Audit record only. The signed control task authorizes this exact provider subdiff and provider set. Publication does not grant live provider traffic."
  else
    printf '%s\n' "Audit record only. The Gate 1 artifact approves the described behavior, not this exact diff, so nothing here re-checks the subdiff. Changing provider request patterns, navigation, cookies, headers, timing, extractor scripts, or provider API calls beyond the approved behavior requires a new Gate 1 approval."
  fi
  printf '\n%s\n' "Provider subdiff: \`${diff_sha}\`"
  if [[ "${PROVIDER_APPROVAL_SOURCE_KIND}" == "control-task" ]]; then
    printf '\n'
    provider_approval_markdown "${PROVIDER_RISK_APPROVAL_JSON}"
  else
    provider_review_context_markdown "${PROVIDER_RISK_REVIEW_ARTIFACT_JSON}"
  fi
  printf '\n%s\n' "Files bound into this provider review:"
  while IFS= read -r file_path; do
    [[ -n "${file_path}" ]] || continue
    printf '%s\n' "- \`${file_path}\`"
  done <<< "${files}"
}

provider_review_authority_marker() {
  if [[ "${PROVIDER_APPROVAL_SOURCE_KIND}" == "control-task" ]]; then
    local authorization_digest
    authorization_digest="$(json_nested_field "${PROVIDER_RISK_APPROVAL_JSON}" authorizationDigest)"
    printf '%s\n' "<!-- freed-provider-control-approval:${authorization_digest} -->"
    return
  fi
  printf '%s\n' "<!-- freed-provider-risk-review-artifact:${PROVIDER_REVIEW_ARTIFACT_DIGEST} -->"
}

find_provider_review_comment_metadata() {
  local pr_number="$1"
  local diff_sha="$2"
  local authority_marker="$3"
  local expected_body="$4"
  local marker="<!-- freed-provider-review:${diff_sha} -->"

  "${GH_BIN}" api "repos/${PUBLISH_REPO}/issues/${pr_number}/comments" --paginate --slurp |
    "${PYTHON_BIN}" -c '
import json
import sys
marker = sys.argv[1]
authority_marker = sys.argv[2]
expected_body = sys.argv[3]
comments = json.load(sys.stdin)
if comments and isinstance(comments[0], list):
    comments = [item for page in comments for item in page]
matches = [
    "{}\t{}".format(item.get("id"), item.get("updated_at"))
    for item in comments
    if marker in str(item.get("body", ""))
    and authority_marker in str(item.get("body", ""))
    and str(item.get("body", "")) == expected_body
    and item.get("created_at")
    and item.get("created_at") == item.get("updated_at")
]
if matches:
    print(matches[-1])
' "${marker}" "${authority_marker}" "${expected_body}"
}

ensure_provider_review_comment() {
  local pr_number="$1"
  [[ -n "${FINAL_PROVIDER_VISIBLE_FILES}" ]] || return 0

  local comment_metadata
  local comment_id
  local body
  local authority_marker
  body="$(provider_review_comment_body "${FINAL_PROVIDER_DIFF_SHA}" "${FINAL_PROVIDER_BOUND_FILES}")"
  authority_marker="$(provider_review_authority_marker)"
  comment_metadata="$(find_provider_review_comment_metadata "${pr_number}" "${FINAL_PROVIDER_DIFF_SHA}" "${authority_marker}" "${body}")"
  comment_id="${comment_metadata%%$'\t'*}"
  [[ -n "${comment_id}" ]] && return 0
  "${GH_BIN}" api "repos/${PUBLISH_REPO}/issues/${pr_number}/comments" \
    --method POST \
    --field body="${body}" \
    --jq .id >/dev/null
}

# Provider authority is the Gate 1 artifact. The owner approves a specific
# observable provider behavior and its risk before any code exists, and that
# decision is recorded as a validated provider-risk-review artifact.
#
# The previous second gate required a CODEOWNER thumbs-up reaction on the review
# comment before a ready transition. It was removed on owner instruction: on a
# single-maintainer repository the reaction was the same person re-confirming a
# decision they had already made and recorded, and it forced a
# draft-then-react-then-republish cycle for every provider-visible change.
#
# Be precise about what that leaves, because the wording is easy to get wrong in
# a way that reads as a stronger guarantee than exists. The artifact approves a
# DESCRIBED BEHAVIOR, not one exact diff. A later commit that touches a
# provider-visible file does not invalidate it and is not blocked here. Binding
# to a diff SHA was considered and rejected: it inverts Gate 1 by requiring the
# code to exist before it can be approved, which is the opposite of approving
# risk before code.
#
# So the enforcement this script still performs is CLASSIFICATION, not
# authorisation: every provider-visible path in the diff is detected, including
# files renamed out of the provider tree, and each publish posts an audit
# comment naming them. What stops an unapproved behavior change is the owner's
# standing rule plus that audit record, not a hash comparison. Anything that
# alters provider request patterns, navigation, cookies, headers, timing,
# extractor scripts, or provider API calls beyond the approved behavior returns
# to Gate 1 for a new approval.
verify_provider_ready_authority() {
  local pr_number="$1"
  [[ -n "${FINAL_PROVIDER_VISIBLE_FILES}" ]] || return 0

  local body
  local comment_metadata
  local comment_id
  local authority_marker
  body="$(provider_review_comment_body "${FINAL_PROVIDER_DIFF_SHA}" "${FINAL_PROVIDER_BOUND_FILES}")"
  authority_marker="$(provider_review_authority_marker)"
  comment_metadata="$(find_provider_review_comment_metadata "${pr_number}" "${FINAL_PROVIDER_DIFF_SHA}" "${authority_marker}" "${body}")"
  comment_id="${comment_metadata%%$'\t'*}"
  if [[ -z "${comment_id}" ]]; then
    echo "Error: an exact, unedited provider review comment is missing for the current provider subdiff and Gate 1 artifact." >&2
    exit 1
  fi
}

TITLE=""
BASE_BRANCH="dev"
PUBLISH_REPO="freed-project/freed"
BODY_FILE=""
INCLUDE_UNTRACKED=false
READY_FOR_REVIEW=false
PROVIDER_RISK_APPROVAL_FILE=""
PROVIDER_RISK_APPROVAL_JSON=""
PROVIDER_APPROVAL_SOURCE_KIND=""
PRINT_PROVIDER_SUBDIFF=false
PROVIDER_RISK_REVIEW_ARTIFACT_FILE=""
PROVIDER_RISK_REVIEW_ARTIFACT_JSON=""
PROVIDER_REVIEW_ARTIFACT_DIGEST=""
FINAL_PROVIDER_VISIBLE_FILES=""
FINAL_PROVIDER_BOUND_FILES=""
FINAL_PROVIDER_DIFF_SHA=""
FINAL_PROVIDER_IDS=""
PUBLISH_HEAD=""
BRANCH_NAME=""
SCOPE_HEAD_SHA=""
EXPECTED_BASE_SHA=""
EXPECTED_DEV_SHA=""
SUMMARY_ARGS=()
TEST_ARGS=()

new_lease_operation_id() {
  "${NODE_BIN}" -e 'process.stdout.write(require("node:crypto").randomUUID())'
}

run_publish_lease_mutation() {
  local operation_id="$1"
  shift
  for _ in 1 2; do
    if FREED_AUTOMATION_LEASE_OPERATION_ID="${operation_id}" \
      FREED_AUTOMATION_LEASE_TOKEN="${PUBLISH_LEASE_TOKEN}" \
      "${NODE_BIN}" "${SCRIPT_DIR}/automation-control.mjs" "$@"; then
      return 0
    fi
  done
  return 1
}

release_publish_lease() {
  if ${TRUSTED_PUBLISH_MODE} && [[ -n "${PUBLISH_LEASE_TOKEN}" ]]; then
    local operation_id
    operation_id="$(new_lease_operation_id)"
    run_publish_lease_mutation "${operation_id}" lease release \
      --state-root "${PUBLISH_CONTROL_STATE_ROOT}" \
      --name pr-publisher >/dev/null 2>&1 || true
    PUBLISH_LEASE_TOKEN=""
  fi
}

validate_publish_lease() {
  if ! ${TRUSTED_PUBLISH_MODE}; then
    return 0
  fi
  local heartbeat_operation_id
  heartbeat_operation_id="$(new_lease_operation_id)"
  run_publish_lease_mutation "${heartbeat_operation_id}" lease heartbeat \
    --state-root "${PUBLISH_CONTROL_STATE_ROOT}" \
    --name pr-publisher \
    --ttl-seconds 1800 >/dev/null
  if [[ -n "${PUBLISH_HEAD}" ]]; then
    local bind_operation_id
    bind_operation_id="$(new_lease_operation_id)"
    run_publish_lease_mutation "${bind_operation_id}" lease bind-head \
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
  if [[ -z "${FINAL_PROVIDER_VISIBLE_FILES}" || -z "${PROVIDER_RISK_APPROVAL_FILE}" ]]; then
    return
  fi
  local current_json
  local current_kind
  local current_digest
  local inspected_kind
  local inspected_digest
  current_json="$(
    printf '%s\n' "${FINAL_PROVIDER_VISIBLE_FILES}" |
    "${NODE_BIN}" "${SCRIPT_DIR}/lib/provider-visible-paths.mjs" \
      --stdin \
      --validate-approval "${PROVIDER_RISK_APPROVAL_FILE}" \
      --diff-sha "${FINAL_PROVIDER_DIFF_SHA}" \
      --control-state-root "${PUBLISH_CONTROL_STATE_ROOT}"
  )"
  current_kind="$(json_nested_field "${current_json}" approvalSource kind)"
  current_digest="$(json_nested_field "${current_json}" authorizationDigest)"
  inspected_kind="$(json_nested_field "${PROVIDER_RISK_APPROVAL_JSON}" approvalSource kind)"
  inspected_digest="$(json_nested_field "${PROVIDER_RISK_APPROVAL_JSON}" authorizationDigest)"
  if [[ "${current_kind}" != "${inspected_kind}" || "${current_digest}" != "${inspected_digest}" ]]; then
    echo "Error: provider approval authority changed after publish inspection." >&2
    exit 1
  fi
}

load_provider_review_artifact() {
  "${NODE_BIN}" "${SCRIPT_DIR}/stability-artifact.mjs" validate \
    --input "${PROVIDER_RISK_REVIEW_ARTIFACT_FILE}" \
    --kind provider-risk-review >/dev/null

  PROVIDER_RISK_REVIEW_ARTIFACT_JSON="$(<"${PROVIDER_RISK_REVIEW_ARTIFACT_FILE}")"
  local artifact_status
  local source_status
  local artifact_providers
  artifact_status="$(json_nested_field "${PROVIDER_RISK_REVIEW_ARTIFACT_JSON}" status)"
  source_status="$(json_nested_field "${PROVIDER_RISK_REVIEW_ARTIFACT_JSON}" source status)"
  PROVIDER_REVIEW_ARTIFACT_DIGEST="$(json_nested_field "${PROVIDER_RISK_REVIEW_ARTIFACT_JSON}" artifactDigest)"
  artifact_providers="$(json_array_lines "${PROVIDER_RISK_REVIEW_ARTIFACT_JSON}" payload providers)"

  if [[ "${source_status}" != "healthy" ]]; then
    echo "Error: provider-risk-review artifact source must be healthy." >&2
    exit 1
  fi
  case "${artifact_status}" in
    behavior_approved|diff_authorized)
      ;;
    *)
      echo "Error: provider-risk-review artifact must record behavior_approved or diff_authorized." >&2
      exit 1
      ;;
  esac
  if [[ ! "${PROVIDER_REVIEW_ARTIFACT_DIGEST}" =~ ^[0-9a-f]{64}$ ]]; then
    echo "Error: provider-risk-review artifact must include its immutable artifactDigest." >&2
    exit 1
  fi
  if [[ "${artifact_providers}" != "${FINAL_PROVIDER_IDS}" ]]; then
    echo "Error: provider-risk-review artifact providers do not match the current provider-visible diff." >&2
    printf 'Expected providers:\n%s\n' "${FINAL_PROVIDER_IDS}" >&2
    printf 'Artifact providers:\n%s\n' "${artifact_providers}" >&2
    exit 1
  fi

  # Deliberately NOT bound to the exact provider subdiff.
  #
  # Gate 1 approves the described provider behavior, before code, per AGENTS.md.
  # Binding the artifact to a diff SHA would invert that: the diff has to exist
  # before the artifact can be written, and every later commit would demand a
  # re-approval step. The owner chose behavior approval on 2026-07-24 and
  # accepted that the remaining control is reviewer judgment, not a mechanism.
  #
  # What that means in practice: the approved artifact describes an observable
  # behavior. Changing provider request patterns, navigation, cookies, headers,
  # timing, extractor scripts, or provider API calls beyond what it describes
  # requires a new Gate 1 approval even though nothing here will stop you.
  # The review comment below records what shipped so it stays auditable.
}

revalidate_provider_review_artifact() {
  if [[ -z "${PROVIDER_RISK_REVIEW_ARTIFACT_FILE}" ]]; then
    return
  fi
  "${NODE_BIN}" "${SCRIPT_DIR}/stability-artifact.mjs" validate \
    --input "${PROVIDER_RISK_REVIEW_ARTIFACT_FILE}" \
    --kind provider-risk-review >/dev/null
  local current_json
  local current_digest
  current_json="$(<"${PROVIDER_RISK_REVIEW_ARTIFACT_FILE}")"
  current_digest="$(json_nested_field "${current_json}" artifactDigest)"
  if [[ "${current_digest}" != "${PROVIDER_REVIEW_ARTIFACT_DIGEST}" ]]; then
    echo "Error: provider-risk-review artifact changed after publish inspection." >&2
    exit 1
  fi
}

assert_publish_write_ready() {
  validate_publish_lease
  verify_canonical_base
  verify_remote_head
  revalidate_provider_approval
  revalidate_provider_review_artifact
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

verify_pr_draft_state() {
  local pr_reference="$1"
  local expected_is_draft="$2"
  local pr_json
  local is_draft
  if ! pr_json="$(
    "${GH_BIN}" pr view "${pr_reference}" \
      --repo "${PUBLISH_REPO}" \
      --json isDraft
  )"; then
    return 1
  fi
  is_draft="$(json_nested_field "${pr_json}" isDraft)"
  [[ "${is_draft}" == "${expected_is_draft}" ]]
}

verify_pr_is_draft() {
  verify_pr_draft_state "$1" "true"
}

verify_pr_is_ready() {
  verify_pr_draft_state "$1" "false"
}

restore_pr_draft_after_failed_ready() {
  local pr_reference="$1"
  "${GH_BIN}" pr ready "${pr_reference}" \
    --repo "${PUBLISH_REPO}" \
    --undo >/dev/null 2>&1 || true
  verify_pr_is_draft "${pr_reference}"
}

promote_pr_ready_with_rollback() {
  local pr_reference="$1"
  local failure_reason=""

  if ! "${GH_BIN}" pr ready "${pr_reference}" \
    --repo "${PUBLISH_REPO}" >/dev/null; then
    failure_reason="the ready transition returned an error or lost its response"
  elif ! verify_pr_is_ready "${pr_reference}"; then
    failure_reason="the pull request could not be verified ready after the ready transition"
  elif ! (verify_pr_target "${pr_reference}"); then
    failure_reason="the pull request target or canonical base changed during the ready transition"
  else
    return 0
  fi

  if ! restore_pr_draft_after_failed_ready "${pr_reference}"; then
    echo "Error: ${failure_reason}, and the pull request could not be verified back in draft state." >&2
    return 1
  fi
  echo "Error: ${failure_reason}; the pull request was returned to draft." >&2
  return 1
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
  if [[ -z "${existing_number}" ]]; then
    return
  fi
  verify_pr_target_head "${existing_number}" "${existing_head}"
  if [[ "${existing_is_draft}" == "true" ]]; then
    if ! verify_pr_is_draft "${existing_number}"; then
      echo "Error: provider-visible pull request draft state changed before publication." >&2
      exit 1
    fi
    return
  fi
  validate_publish_lease
  if ! "${GH_BIN}" pr ready "${existing_number}" \
    --repo "${PUBLISH_REPO}" \
    --undo >/dev/null 2>&1; then
    if verify_pr_is_draft "${existing_number}"; then
      return
    fi
    echo "Error: provider-visible pull request could not be returned to draft before publication." >&2
    exit 1
  fi
  if ! verify_pr_is_draft "${existing_number}"; then
    echo "Error: provider-visible pull request could not be verified in draft state before publication." >&2
    exit 1
  fi
}

verify_provider_pr_draft_after_push() {
  if [[ -z "${FINAL_PROVIDER_VISIBLE_FILES}" ]]; then
    return
  fi
  local existing_json
  local existing_number
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
  if [[ -z "${existing_number}" ]]; then
    return
  fi
  verify_pr_target "${existing_number}"
  if verify_pr_is_draft "${existing_number}"; then
    return
  fi
  if ! restore_pr_draft_after_failed_ready "${existing_number}"; then
    echo "Error: provider-visible pull request became ready during publication and could not be returned to draft." >&2
    exit 1
  fi
  echo "Error: provider-visible pull request became ready during publication and was returned to draft." >&2
  exit 1
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
    --provider-risk-review-artifact)
      [[ $# -ge 2 && -n "$2" ]] || { echo "Error: --provider-risk-review-artifact requires a JSON file path." >&2; exit 1; }
      PROVIDER_RISK_REVIEW_ARTIFACT_FILE="$2"
      shift 2
      ;;
    --print-provider-subdiff)
      PRINT_PROVIDER_SUBDIFF=true
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

# --print-provider-subdiff is a read-only query, so it needs no PR title.
if [[ -z "${TITLE}" ]] && ! ${PRINT_PROVIDER_SUBDIFF}; then
  usage
  exit 1
fi
if [[ -n "${PROVIDER_RISK_REVIEW_ARTIFACT_FILE}" && -n "${PROVIDER_RISK_APPROVAL_FILE}" ]]; then
  echo "Error: --provider-risk-review-artifact and --provider-risk-approval-file are mutually exclusive." >&2
  exit 1
fi

require_executable "${GIT_BIN}" git
require_executable "${GH_BIN}" gh
require_executable "${PYTHON_BIN}" python3
require_executable "${NODE_BIN:-}" node
# Machine preflight, warn-only: surface broken gh/credential helpers with
# remediation before the publish flow trips over them.
"${NODE_BIN}" "${SCRIPT_DIR}/doctor.mjs" || true

${PRINT_PROVIDER_SUBDIFF} || ensure_conventional_title "${TITLE}"
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

# Provider-visible gate (stability task W1-06): ready and merge require either a
# validated behavior-scoped Gate 1 provider-risk-review artifact with the exact
# provider set, or a signed exact-diff control-task approval. Canonical list + predicate:
# scripts/lib/provider-visible-paths.mjs.
COMMITTED_PROVIDER_VISIBLE_FILES="$(
  "${GIT_BIN}" diff --no-renames --no-ext-diff --name-only "origin/${BASE_BRANCH}...HEAD" |
    sort -u |
    "${NODE_BIN}" "${SCRIPT_DIR}/lib/provider-visible-paths.mjs" --stdin
)"
PROVIDER_VISIBLE_FILES="${COMMITTED_PROVIDER_VISIBLE_FILES}"

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

# --print-provider-subdiff writes nothing, so it must not consume the one-use
# publish lease. Doing so would burn the caller's publish authority just to
# answer a question.
${PRINT_PROVIDER_SUBDIFF} || validate_publish_lease

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
PROVIDER_VISIBLE_FILES="${FINAL_PROVIDER_VISIBLE_FILES}"
if [[ -n "${FINAL_PROVIDER_VISIBLE_FILES}" ]]; then
  FINAL_PROVIDER_BOUND_FILES="$(provider_bound_files "origin/${BASE_BRANCH}" "${PUBLISH_HEAD}" "${FINAL_PROVIDER_VISIBLE_FILES}")"
  FINAL_PROVIDER_DIFF_SHA="$(provider_diff_sha "origin/${BASE_BRANCH}" "${PUBLISH_HEAD}" "${FINAL_PROVIDER_BOUND_FILES}")"
  # This value identifies the provider-only bytes in the audit comment and in
  # the optional exact-diff control-task route.
  if ${PRINT_PROVIDER_SUBDIFF}; then
    # Disarm the EXIT trap: this query never took the publish lease, so it must
    # not release the caller's.
    trap - EXIT
    printf '%s\n' "${FINAL_PROVIDER_DIFF_SHA}"
    exit 0
  fi
  FINAL_PROVIDER_IDS="$(
    printf '%s\n' "${FINAL_PROVIDER_VISIBLE_FILES}" |
      "${NODE_BIN}" "${SCRIPT_DIR}/lib/provider-visible-paths.mjs" \
        --stdin \
        --provider-ids
  )"
  if [[ -n "${PROVIDER_RISK_APPROVAL_FILE}" ]]; then
    PROVIDER_RISK_APPROVAL_JSON="$(
      printf '%s\n' "${FINAL_PROVIDER_VISIBLE_FILES}" |
        "${NODE_BIN}" "${SCRIPT_DIR}/lib/provider-visible-paths.mjs" \
          --stdin \
          --validate-approval "${PROVIDER_RISK_APPROVAL_FILE}" \
          --diff-sha "${FINAL_PROVIDER_DIFF_SHA}" \
          --control-state-root "${PUBLISH_CONTROL_STATE_ROOT}"
    )"
    PROVIDER_APPROVAL_SOURCE_KIND="$(json_nested_field "${PROVIDER_RISK_APPROVAL_JSON}" approvalSource kind)"
    if [[ "${PROVIDER_APPROVAL_SOURCE_KIND}" != "control-task" ]]; then
      echo "Error: owner-confirmation approval packets are retired. Pass a validated Gate 1 artifact with --provider-risk-review-artifact." >&2
      exit 1
    fi
  else
    if [[ -z "${PROVIDER_RISK_REVIEW_ARTIFACT_FILE}" ]]; then
      echo "Error: provider-visible draft publication requires --provider-risk-review-artifact." >&2
      exit 1
    fi
    load_provider_review_artifact
  fi
else
  if ${PRINT_PROVIDER_SUBDIFF}; then
    trap - EXIT
    echo "This branch has no provider-visible committed diff." >&2
    exit 0
  fi
  if [[ -n "${PROVIDER_RISK_APPROVAL_FILE}" ]]; then
    echo "Error: --provider-risk-approval-file was provided, but this branch has no provider-visible committed diff." >&2
    exit 1
  fi
  if [[ -n "${PROVIDER_RISK_REVIEW_ARTIFACT_FILE}" ]]; then
    echo "Error: --provider-risk-review-artifact was provided, but this branch has no provider-visible committed diff." >&2
    exit 1
  fi
fi

validate_publish_lease
revalidate_provider_approval
revalidate_provider_review_artifact
ensure_provider_pr_draft_before_push
verify_canonical_base
"${GIT_BIN}" push -u origin "${PUBLISH_HEAD}:refs/heads/${BRANCH_NAME}"
verify_remote_head
verify_provider_pr_draft_after_push
"${GIT_BIN}" branch \
  --set-upstream-to="origin/${BRANCH_NAME}" \
  "${BRANCH_NAME}" >/dev/null

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
if [[ -n "${FINAL_PROVIDER_VISIBLE_FILES}" ]]; then
  REVIEW_SECTION="$(provider_review_markdown "${FINAL_PROVIDER_DIFF_SHA}" "${FINAL_PROVIDER_BOUND_FILES}" "${PROVIDER_RISK_REVIEW_ARTIFACT_JSON}")"
  BODY_CONTENT="$(printf '%s\n\n%s' "${BODY_CONTENT}" "${REVIEW_SECTION}")"
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
  if [[ -n "${FINAL_PROVIDER_VISIBLE_FILES}" && "${EXISTING_PR_IS_DRAFT}" != "true" ]]; then
    if ! restore_pr_draft_after_failed_ready "${EXISTING_PR_NUMBER}"; then
      echo "Error: provider-visible pull request was ready before its audit record and could not be returned to draft." >&2
      exit 1
    fi
    echo "Error: provider-visible pull request was ready before its audit record and was returned to draft." >&2
    exit 1
  fi
  if [[ "${EXISTING_PR_HEAD}" != "${PUBLISH_HEAD}" || "${EXISTING_PR_BASE}" != "${BASE_BRANCH}" ]]; then
    echo "Error: existing pull request target does not match the inspected publish head and base." >&2
    exit 1
  fi
  if ${READY_FOR_REVIEW}; then
    assert_publish_write_ready
    verify_pr_target "${EXISTING_PR_NUMBER}"
    "${GH_BIN}" pr edit "${EXISTING_PR_NUMBER}" --repo "${PUBLISH_REPO}" --title "${TITLE}" --body "${BODY_CONTENT}" >/dev/null
    ensure_provider_review_comment "${EXISTING_PR_NUMBER}"
    verify_provider_ready_authority "${EXISTING_PR_NUMBER}"
    if [[ "${EXISTING_PR_IS_DRAFT}" == "true" ]]; then
      assert_publish_write_ready
      verify_pr_target "${EXISTING_PR_NUMBER}"
      promote_pr_ready_with_rollback "${EXISTING_PR_NUMBER}"
    else
      verify_pr_target "${EXISTING_PR_NUMBER}"
    fi
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
  ensure_provider_review_comment "${EXISTING_PR_NUMBER}"
  verify_pr_target "${EXISTING_PR_NUMBER}"
  if [[ -n "${FINAL_PROVIDER_VISIBLE_FILES}" ]] && ! verify_pr_is_draft "${EXISTING_PR_NUMBER}"; then
    if ! restore_pr_draft_after_failed_ready "${EXISTING_PR_NUMBER}"; then
      echo "Error: provider-visible pull request left draft state during audit and could not be returned to draft." >&2
      exit 1
    fi
    echo "Error: provider-visible pull request left draft state during audit and was returned to draft." >&2
    exit 1
  fi
  printf 'Updated draft PR: %s\n' "${EXISTING_PR_URL}"
  exit 0
fi

CREATE_ARGS=(
  --base "${BASE_BRANCH}"
  --head "${BRANCH_NAME}"
  --title "${TITLE}"
  --body "${BODY_CONTENT}"
)
# A new provider-visible PR always starts as a draft. The audit comment must be
# created and read back before a requested ready transition, so a GitHub comment
# failure cannot leave the PR ready without its audit record.
if ! ${READY_FOR_REVIEW} || [[ -n "${FINAL_PROVIDER_VISIBLE_FILES}" ]]; then
  CREATE_ARGS=(--draft "${CREATE_ARGS[@]}")
fi
assert_publish_write_ready
CREATED_PR_URL="$("${GH_BIN}" pr create --repo "${PUBLISH_REPO}" "${CREATE_ARGS[@]}")"
verify_pr_target "${BRANCH_NAME}"
if [[ -n "${FINAL_PROVIDER_VISIBLE_FILES}" ]]; then
  CREATED_PR_NUMBER="${CREATED_PR_URL##*/}"
  if ! verify_pr_is_draft "${CREATED_PR_NUMBER}"; then
    if ! restore_pr_draft_after_failed_ready "${CREATED_PR_NUMBER}"; then
      echo "Error: new provider-visible pull request was not draft and could not be returned to draft." >&2
      exit 1
    fi
    echo "Error: new provider-visible pull request was unexpectedly ready and was returned to draft." >&2
    exit 1
  fi
  ensure_provider_review_comment "${CREATED_PR_NUMBER}"
  verify_provider_ready_authority "${CREATED_PR_NUMBER}"
  if ${READY_FOR_REVIEW}; then
    assert_publish_write_ready
    verify_pr_target "${CREATED_PR_NUMBER}"
    promote_pr_ready_with_rollback "${CREATED_PR_NUMBER}"
  elif ! verify_pr_is_draft "${CREATED_PR_NUMBER}"; then
    if ! restore_pr_draft_after_failed_ready "${CREATED_PR_NUMBER}"; then
      echo "Error: new provider-visible pull request left draft state during audit and could not be returned to draft." >&2
      exit 1
    fi
    echo "Error: new provider-visible pull request left draft state during audit and was returned to draft." >&2
    exit 1
  fi
fi
printf '%s\n' "${CREATED_PR_URL}"
