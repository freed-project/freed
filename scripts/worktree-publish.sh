#!/usr/bin/env bash
# Publish a committed website task using the normal GitHub/Vercel Git path.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/node-tooling.sh"
NODE_BIN="$(resolve_node_bin)"
TITLE="" BODY="" READY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) TITLE="${2:?--title requires a value}"; shift 2 ;;
    --body-file) BODY="${2:?--body-file requires a path}"; shift 2 ;;
    --ready) READY=true; shift ;;
    *) echo "Use --title <title> --body-file <path> [--ready]." >&2; exit 1 ;;
  esac
done
[[ "$TITLE" =~ ^(feat|fix|chore|docs|refactor|perf|style)(\([^\)]+\))?:\ .+ ]] || { echo "A Conventional Commit title is required." >&2; exit 1; }
[[ -f "$BODY" && "$(head -n 1 "$BODY")" == '(AI Generated).' ]] || { echo "PR body must begin with the external-post marker." >&2; exit 1; }
ROOT="$(git rev-parse --show-toplevel)"
BRANCH="$(git branch --show-current)"
[[ "$BRANCH" =~ ^(feat|fix|chore|docs|refactor|perf|style)/.+ ]] || { echo "Use a task branch." >&2; exit 1; }
DECISION_ARGS=(check --worktree "$ROOT" --base origin/www)
$READY && DECISION_ARGS+=(--required)
"$NODE_BIN" "$SCRIPT_DIR/task-decisions.mjs" "${DECISION_ARGS[@]}"
[[ -z "$(git status --porcelain)" ]] || { echo "Commit only the intended changes before publication." >&2; exit 1; }
[[ "$(gh repo view --json nameWithOwner --jq .nameWithOwner)" == 'freed-project/freed' ]] || { echo "Expected the Freed repository." >&2; exit 1; }
git fetch origin www
[[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/www)" ]] || { echo "No task commits to publish." >&2; exit 1; }
git merge-base --is-ancestor origin/www HEAD || { echo "Refresh this task branch from origin/www and validate affected changes." >&2; exit 1; }
"$NODE_BIN" "$SCRIPT_DIR/task-decisions.mjs" "${DECISION_ARGS[@]}"
HEAD_SHA="$(git rev-parse HEAD)"
git push -u origin "$HEAD_SHA:refs/heads/$BRANCH"
[[ "$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)" == "$HEAD_SHA" ]] || { echo "Remote head changed during publication." >&2; exit 1; }
PR="$(gh pr list --head "$BRANCH" --base www --state open --json number --jq '.[0].number // empty')"
if [[ -n "$PR" ]]; then
  gh pr edit "$PR" --title "$TITLE" --body-file "$BODY"
  DRAFT="$(gh pr view "$PR" --json isDraft --jq .isDraft)"
  if $READY && [[ "$DRAFT" == true ]]; then gh pr ready "$PR"; fi
  if ! $READY && [[ "$DRAFT" == false ]]; then gh pr ready "$PR" --undo; fi
else
  PR_ARGS=(--base www --head "$BRANCH" --title "$TITLE" --body-file "$BODY")
  $READY || PR_ARGS+=(--draft)
  gh pr create "${PR_ARGS[@]}"
fi
