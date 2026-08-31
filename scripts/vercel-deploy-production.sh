#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/node-tooling.sh
source "${SCRIPT_DIR}/lib/node-tooling.sh"
use_resolved_node_path
NODE_BIN="$(resolve_node_bin)"
NPM_BIN="$(resolve_npm_bin)"
NPX_BIN="$(resolve_npx_bin)"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 website|pwa [vercel-token]" >&2
  exit 1
fi

TARGET="$1"
VERCEL_TOKEN="${2:-${VERCEL_TOKEN:-}}"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/freed-vercel-production.XXXXXX")"
ROOT_BIN_DIR="${TEMP_DIR}/node_modules/.bin"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

case "$TARGET" in
  website)
    APP_DIR="website"
    STAGE_AT_ROOT="false"
    DEPENDENCY_DIRS=(
      "packages/shared"
      "packages/ui"
    )
    ;;
  pwa)
    APP_DIR="packages/pwa"
    STAGE_AT_ROOT="false"
    DEPENDENCY_DIRS=(
      "packages/capture-save"
      "packages/library-core-native"
      "packages/shared"
      "packages/sync"
      "packages/ui"
    )
    ;;
  *)
    echo "Unknown target: $TARGET" >&2
    exit 1
    ;;
esac

mkdir -p "$TEMP_DIR/scripts/lib" "$TEMP_DIR/.vercel"

cp "$ROOT_DIR/scripts/lib/build-metadata.mjs" "$TEMP_DIR/scripts/lib/build-metadata.mjs"
cp "$ROOT_DIR/scripts/lib/build-metadata.d.mts" "$TEMP_DIR/scripts/lib/build-metadata.d.mts"
cp "$ROOT_DIR/scripts/lib/retired-automerge-runtime.mjs" "$TEMP_DIR/scripts/lib/retired-automerge-runtime.mjs"
cp "$ROOT_DIR/scripts/lib/retired-automerge-runtime.d.mts" "$TEMP_DIR/scripts/lib/retired-automerge-runtime.d.mts"
cp "$ROOT_DIR/scripts/lib/pwa-optional-assets.mjs" "$TEMP_DIR/scripts/lib/pwa-optional-assets.mjs"
cp "$ROOT_DIR/scripts/lib/pwa-optional-assets.d.mts" "$TEMP_DIR/scripts/lib/pwa-optional-assets.d.mts"
cp "$ROOT_DIR/scripts/validate-retired-automerge-runtime.mjs" "$TEMP_DIR/scripts/validate-retired-automerge-runtime.mjs"
cp "$ROOT_DIR/scripts/validate-pwa-optional-assets.mjs" "$TEMP_DIR/scripts/validate-pwa-optional-assets.mjs"

if [[ "$STAGE_AT_ROOT" == "true" ]]; then
  cp "$ROOT_DIR/package.json" "$TEMP_DIR/package.json"
  cp "$ROOT_DIR/package-lock.json" "$TEMP_DIR/package-lock.json"
  cp "$ROOT_DIR/tsconfig.base.json" "$TEMP_DIR/tsconfig.base.json"
  cp -R "$ROOT_DIR/$APP_DIR" "$TEMP_DIR/$APP_DIR"
else
  cp "$ROOT_DIR/package.json" "$TEMP_DIR/package.json"
  cp "$ROOT_DIR/package-lock.json" "$TEMP_DIR/package-lock.json"
  cp "$ROOT_DIR/tsconfig.base.json" "$TEMP_DIR/tsconfig.base.json"
  mkdir -p "$TEMP_DIR/$(dirname "$APP_DIR")"
  cp -R "$ROOT_DIR/$APP_DIR" "$TEMP_DIR/$APP_DIR"
  if [[ "$TARGET" == "pwa" ]]; then
    mkdir -p "$TEMP_DIR/packages/pwa"
    cat <<'EOF' >"$TEMP_DIR/vercel.json"
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "PATH=../../node_modules/.bin:$PATH npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]
}
EOF
  fi
fi

VERCEL_PROJECT="$(
  "$NODE_BIN" "$ROOT_DIR/scripts/lib/vercel-project-link.mjs" project "$TARGET"
)"
PROJECT_LINK_STATE="bootstrap"
if "$NODE_BIN" "$ROOT_DIR/scripts/lib/vercel-project-link.mjs" stage \
  "$ROOT_DIR/$APP_DIR/.vercel/project.json" \
  "$TEMP_DIR/.vercel/project.json"
then
  PROJECT_LINK_STATE="linked"
fi

for dir in "${DEPENDENCY_DIRS[@]}"; do
  mkdir -p "$TEMP_DIR/$(dirname "$dir")"
  cp -R "$ROOT_DIR/$dir" "$TEMP_DIR/$dir"
done

if [[ "$STAGE_AT_ROOT" == "false" ]]; then
  cp "$ROOT_DIR/scripts/vercel-deploy-preview.sh" "$TEMP_DIR/scripts/vercel-deploy-preview.sh"
  cp "$ROOT_DIR/scripts/vercel-deploy-production.sh" "$TEMP_DIR/scripts/vercel-deploy-production.sh"
fi

echo "Verifying production bundle for $TARGET from $TEMP_DIR"
(
  cd "$TEMP_DIR"
  "${NPM_BIN}" install
  if [[ "$TARGET" == "website" ]]; then
    (
      cd website
      PATH="${ROOT_BIN_DIR}:${PATH}" "$NPM_BIN" run build
    )
  else
    (
      cd packages/pwa
      PATH="${ROOT_BIN_DIR}:${PATH}" "$NPM_BIN" run build
    )
  fi
)

VERCEL_FLAGS=(--scope aubreyfs-projects)
if [[ -n "$VERCEL_TOKEN" ]]; then
  VERCEL_FLAGS+=(--token "$VERCEL_TOKEN")
fi

echo "Pulling Vercel settings for $TARGET"
VERCEL_PULL_FLAGS=(--yes --environment production --cwd "$TEMP_DIR")
if [[ "$PROJECT_LINK_STATE" == "bootstrap" ]]; then
  echo "No local Vercel link found; selecting $VERCEL_PROJECT explicitly"
  VERCEL_PULL_FLAGS+=(--project "$VERCEL_PROJECT")
fi
if ! "${NPX_BIN}" vercel pull "${VERCEL_PULL_FLAGS[@]}" "${VERCEL_FLAGS[@]}"; then
  echo "Unable to access Vercel project $VERCEL_PROJECT in scope aubreyfs-projects. Verify Vercel authentication and project access." >&2
  exit 1
fi

if [[ "$TARGET" == "website" ]]; then
  echo "Building $TARGET production bundle with Vercel"
  "$NPX_BIN" vercel build --cwd "$TEMP_DIR" "${VERCEL_FLAGS[@]}" --prod

  echo "Deploying $TARGET production build to Vercel"
  "$NPX_BIN" vercel deploy --prebuilt --cwd "$TEMP_DIR" "${VERCEL_FLAGS[@]}" -y --prod
else
  echo "Building $TARGET production bundle with Vercel"
  "${NPX_BIN}" vercel build --cwd "$TEMP_DIR" --local-config "$TEMP_DIR/vercel.json" "${VERCEL_FLAGS[@]}" --prod

  echo "Deploying $TARGET production build to Vercel"
  "${NPX_BIN}" vercel deploy --prebuilt --cwd "$TEMP_DIR" --local-config "$TEMP_DIR/vercel.json" "${VERCEL_FLAGS[@]}" -y --prod
fi
