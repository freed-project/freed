#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/worktree-publish.sh --title "<conventional-commit title>" [--summary "<bullet>"]... [--test "<bullet>"]... [--base <dev|www>] [--body-file <path>]

Stages local changes, commits them when needed, pushes the current branch to origin,
and opens a draft pull request.
EOF
}

require_command() {
  local command_name="$1"

  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Error: required command '${command_name}' is not available." >&2
    exit 1
  fi
}

ensure_supported_base_branch() {
  local base_branch="$1"

  case "${base_branch}" in
    dev|www) ;;
    *)
      echo "Error: --base must be either 'dev' or 'www'." >&2
      exit 1
      ;;
  esac
}

ensure_conventional_title() {
  local title="$1"

  if [[ ! "${title}" =~ ^(feat|fix|chore|docs|refactor|perf|style):\ .+ ]]; then
    echo "Error: title must use a Conventional Commit prefix such as 'feat:' or 'fix:'." >&2
    exit 1
  fi
}

current_branch() {
  git branch --show-current
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

has_worktree_changes() {
  [[ -n "$(git status --short)" ]]
}

branch_has_unique_commits() {
  local base_branch="$1"

  [[ "$(git rev-list --count "origin/${base_branch}..HEAD")" -gt 0 ]]
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

TITLE=""
BASE_BRANCH="dev"
BODY_FILE=""
SUMMARY_ARGS=()
TEST_ARGS=()

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

require_command git
require_command gh

ensure_conventional_title "${TITLE}"
ensure_supported_base_branch "${BASE_BRANCH}"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: current directory is not inside a git repository." >&2
  exit 1
fi

git fetch origin "${BASE_BRANCH}" >/dev/null 2>&1

BRANCH_NAME="$(current_branch)"
ensure_publishable_branch "${BRANCH_NAME}"

if has_worktree_changes; then
  git add -A
  if git diff --cached --quiet; then
    echo "Error: no staged changes found after git add -A." >&2
    exit 1
  fi
  git commit -m "${TITLE}"
elif ! branch_has_unique_commits "${BASE_BRANCH}"; then
  echo "Error: no local changes and no commits ahead of origin/${BASE_BRANCH}." >&2
  exit 1
fi

git push -u origin HEAD

BODY_CONTENT=""
if [[ -n "${BODY_FILE}" ]]; then
  BODY_CONTENT="$(cat "${BODY_FILE}")"
  if [[ "${BODY_CONTENT}" != "(AI Generated)."* ]]; then
    BODY_CONTENT="$(printf '%s\n\n%s' '(AI Generated).' "${BODY_CONTENT}")"
  fi
else
  BODY_ARGS=()
  for item in "${SUMMARY_ARGS[@]}"; do
    BODY_ARGS+=(--summary "${item}")
  done
  for item in "${TEST_ARGS[@]}"; do
    BODY_ARGS+=(--test "${item}")
  done
  BODY_CONTENT="$(build_body "${TITLE}" "${BODY_ARGS[@]}")"
fi

EXISTING_PR_NUMBER="$(
  gh pr list \
    --head "${BRANCH_NAME}" \
    --base "${BASE_BRANCH}" \
    --state open \
    --json number \
    --jq '.[0].number // empty' \
    --limit 1
)"
EXISTING_PR_URL="$(
  gh pr list \
    --head "${BRANCH_NAME}" \
    --base "${BASE_BRANCH}" \
    --state open \
    --json url \
    --jq '.[0].url // empty' \
    --limit 1
)"
EXISTING_PR_IS_DRAFT="$(
  gh pr list \
    --head "${BRANCH_NAME}" \
    --base "${BASE_BRANCH}" \
    --state open \
    --json isDraft \
    --jq '.[0].isDraft // empty' \
    --limit 1
)"

if [[ -n "${EXISTING_PR_NUMBER}" ]]; then
  if [[ "${EXISTING_PR_IS_DRAFT}" != "true" ]]; then
    gh pr ready "${EXISTING_PR_NUMBER}" --undo >/dev/null
  fi
  printf 'Draft PR already exists: %s\n' "${EXISTING_PR_URL}"
  exit 0
fi

gh pr create \
  --draft \
  --base "${BASE_BRANCH}" \
  --head "${BRANCH_NAME}" \
  --title "${TITLE}" \
  --body "${BODY_CONTENT}"
