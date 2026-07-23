#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: ./scripts/promote-dev-to-main.sh <worktree-path> [<branch-name>] [--provider-risk-review-artifact <path> | --provider-risk-approval-file <path>]" >&2
  exit 1
fi

ORIGINAL_CWD="$(pwd -P)"
WORKTREE_PATH="$1"
shift
BRANCH_NAME=""
PROVIDER_RISK_APPROVAL_FILE=""
PROVIDER_RISK_REVIEW_ARTIFACT=""
if [[ $# -gt 0 && "$1" != --* ]]; then
  BRANCH_NAME="$1"
  shift
fi
BRANCH_NAME="${BRANCH_NAME:-chore/promote-dev-to-main-$(date +%Y%m%d-%H%M%S)}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider-risk-review-artifact)
      [[ $# -ge 2 && -n "$2" ]] || { echo "Error: --provider-risk-review-artifact requires a path." >&2; exit 1; }
      PROVIDER_RISK_REVIEW_ARTIFACT="$2"
      shift 2
      ;;
    --provider-risk-approval-file)
      [[ $# -ge 2 && -n "$2" ]] || { echo "Error: --provider-risk-approval-file requires a path." >&2; exit 1; }
      PROVIDER_RISK_APPROVAL_FILE="$2"
      shift 2
      ;;
    *)
      echo "Error: unexpected argument '$1'." >&2
      exit 1
      ;;
  esac
done
if [[ -n "${PROVIDER_RISK_REVIEW_ARTIFACT}" && -n "${PROVIDER_RISK_APPROVAL_FILE}" ]]; then
  echo "Error: --provider-risk-review-artifact and --provider-risk-approval-file are mutually exclusive." >&2
  exit 1
fi
TITLE="chore: promote dev into main for production release"
SCRIPT_DIR="$(cd -P -- "${BASH_SOURCE[0]%/*}" && pwd)"
REPO_ROOT="$(cd -P -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./lib/node-tooling.sh
source "${SCRIPT_DIR}/lib/node-tooling.sh"
NODE_BIN="$(resolve_node_bin)"
export DEVELOPER_DIR=/Library/Developer/CommandLineTools

if [[ "${WORKTREE_PATH}" != /* ]]; then
  WORKTREE_PATH="${ORIGINAL_CWD}/${WORKTREE_PATH}"
fi
if [[ -n "${PROVIDER_RISK_APPROVAL_FILE}" && "${PROVIDER_RISK_APPROVAL_FILE}" != /* ]]; then
  PROVIDER_RISK_APPROVAL_FILE="${ORIGINAL_CWD}/${PROVIDER_RISK_APPROVAL_FILE}"
fi
if [[ -n "${PROVIDER_RISK_REVIEW_ARTIFACT}" && "${PROVIDER_RISK_REVIEW_ARTIFACT}" != /* ]]; then
  PROVIDER_RISK_REVIEW_ARTIFACT="${ORIGINAL_CWD}/${PROVIDER_RISK_REVIEW_ARTIFACT}"
fi

cd "${REPO_ROOT}"

if ! /usr/bin/git diff --quiet HEAD; then
  echo "Error: working tree is dirty. Commit or stash changes first." >&2
  exit 1
fi

/usr/bin/git fetch origin dev main

if "${NODE_BIN}" "${SCRIPT_DIR}/validate-release-promotion.mjs" --from-ref=origin/dev --to-ref=origin/main >/dev/null 2>&1; then
  echo "origin/main already matches origin/dev on product-owned paths."
  exit 0
fi

PUBLISH_COMMAND=("${SCRIPT_DIR}/worktree-publish.sh")
if [[ -n "${FREED_TRUSTED_PUBLISHER:-}" ]]; then
  if [[ "${FREED_TRUSTED_PUBLISHER}" != /* || ! -x "${FREED_TRUSTED_PUBLISHER}" ]]; then
    echo "Error: FREED_TRUSTED_PUBLISHER must be an absolute executable owner host broker." >&2
    exit 1
  fi
  if ! "${NODE_BIN}" "${SCRIPT_DIR}/doctor.mjs" --require-publisher >/dev/null; then
    echo "Error: the configured trusted publisher host is not fully provisioned. Run scripts/doctor.mjs for exact remediation." >&2
    exit 1
  fi
  PUBLISH_COMMAND=("${FREED_TRUSTED_PUBLISHER}")
fi

if [[ -d "${WORKTREE_PATH}" ]]; then
  EXISTING_BRANCH="$(/usr/bin/git -C "${WORKTREE_PATH}" branch --show-current 2>/dev/null || true)"
  if [[ "${EXISTING_BRANCH}" != "${BRANCH_NAME}" ]]; then
    echo "Error: existing promotion worktree is on '${EXISTING_BRANCH}', expected '${BRANCH_NAME}'." >&2
    exit 1
  fi
else
  "${SCRIPT_DIR}/worktree-add.sh" "${WORKTREE_PATH}" -b "${BRANCH_NAME}" origin/main --install auto --target shared

  (
    cd "${WORKTREE_PATH}"
    /usr/bin/git fetch origin dev main
    "${NODE_BIN}" "${SCRIPT_DIR}/prepare-release-promotion.mjs" \
      --cwd="${WORKTREE_PATH}" \
      --from-ref=origin/dev \
      --base-ref=origin/main

    if /usr/bin/git diff --cached --quiet; then
      echo "Error: no staged changes were produced while promoting origin/dev into main." >&2
      exit 1
    fi

    /usr/bin/git commit -m "${TITLE}"
  )
fi

(
  cd "${WORKTREE_PATH}"
  /usr/bin/git fetch origin dev main
  MAIN_SHA="$(/usr/bin/git rev-parse origin/main)"
  HEAD_PARENT="$(/usr/bin/git rev-parse HEAD^)"
  if [[ "${HEAD_PARENT}" != "${MAIN_SHA}" ]]; then
    echo "Error: promotion commit parent ${HEAD_PARENT} does not equal current origin/main ${MAIN_SHA}. Recreate the promotion from the current base." >&2
    exit 1
  fi
  if [[ "$(/usr/bin/git rev-list --count origin/main..HEAD)" != "1" ]]; then
    echo "Error: promotion branch must contain exactly one commit above current origin/main." >&2
    exit 1
  fi
  "${NODE_BIN}" scripts/validate-main-pr.mjs \
    --base-ref=origin/main \
    --head-ref=HEAD \
    --head-branch="${BRANCH_NAME}"

  BODY_FILE="$(mktemp)"
  trap 'rm -f "${BODY_FILE}"' EXIT
  DEV_SHA="$(/usr/bin/git rev-parse origin/dev)"

  cat > "${BODY_FILE}" <<EOF
(AI Generated).

## Summary
- Promote the current \`origin/dev\` product snapshot into \`main\` before a production release.
- Base main SHA: \`${MAIN_SHA}\`
- Source dev SHA: \`${DEV_SHA}\`

## Testing
- \`node scripts/validate-main-pr.mjs --base-ref=origin/main --head-ref=HEAD --head-branch=${BRANCH_NAME}\`
- CI
EOF

  PUBLISH_ARGS=(
    --base main
    --title "${TITLE}"
    --body-file "${BODY_FILE}"
  )
  if [[ -n "${PROVIDER_RISK_APPROVAL_FILE}" ]]; then
    PUBLISH_ARGS+=(--provider-risk-approval-file "${PROVIDER_RISK_APPROVAL_FILE}")
  fi
  if [[ -n "${PROVIDER_RISK_REVIEW_ARTIFACT}" ]]; then
    PUBLISH_ARGS+=(--provider-risk-review-artifact "${PROVIDER_RISK_REVIEW_ARTIFACT}")
  fi
  "${PUBLISH_COMMAND[@]}" "${PUBLISH_ARGS[@]}"
)

echo "Promotion PR created from ${BRANCH_NAME}."
echo "After it merges, refresh origin/main. Create the production release-prep branch from that exact commit."
