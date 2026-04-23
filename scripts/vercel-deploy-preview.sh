#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/node-tooling.sh
source "${SCRIPT_DIR}/lib/node-tooling.sh"
# shellcheck source=./lib/worktree-runtime.sh
source "${SCRIPT_DIR}/lib/worktree-runtime.sh"
use_resolved_node_path
NPM_BIN="$(resolve_npm_bin)"
NPX_BIN="$(resolve_npx_bin)"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 website|pwa [vercel-token]" >&2
  exit 1
fi

TARGET="$1"
VERCEL_TOKEN="${2:-${VERCEL_TOKEN:-}}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/freed-vercel-preview.XXXXXX")"
PREVIEW_LABEL="$(preview_label_for_worktree "${ROOT_DIR}")"
BUILD_ENV_KEY=""
ROOT_BIN_DIR="${TEMP_DIR}/node_modules/.bin"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

case "$TARGET" in
  website)
    APP_DIR="website"
    STAGE_AT_ROOT="false"
    BUILD_ENV_KEY="NEXT_PUBLIC_FREED_PREVIEW_LABEL"
    DEPENDENCY_DIRS=(
      "packages/shared"
      "packages/ui"
    )
    ;;
  pwa)
    APP_DIR="packages/pwa"
    STAGE_AT_ROOT="false"
    BUILD_ENV_KEY="VITE_FREED_PREVIEW_LABEL"
    DEPENDENCY_DIRS=(
      "packages/capture-save"
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

cp "$ROOT_DIR/scripts/patch-automerge.mjs" "$TEMP_DIR/scripts/patch-automerge.mjs"
cp "$ROOT_DIR/scripts/lib/build-metadata.mjs" "$TEMP_DIR/scripts/lib/build-metadata.mjs"
cp "$ROOT_DIR/scripts/lib/build-metadata.d.mts" "$TEMP_DIR/scripts/lib/build-metadata.d.mts"

if [[ "$STAGE_AT_ROOT" == "true" ]]; then
  cp "$ROOT_DIR/tsconfig.base.json" "$TEMP_DIR/tsconfig.base.json"
  cp -R "$ROOT_DIR/$APP_DIR"/. "$TEMP_DIR/"
  cp "$ROOT_DIR/$APP_DIR/.vercel/project.json" "$TEMP_DIR/.vercel/project.json"
else
  cp "$ROOT_DIR/package.json" "$TEMP_DIR/package.json"
  cp "$ROOT_DIR/package-lock.json" "$TEMP_DIR/package-lock.json"
  cp "$ROOT_DIR/tsconfig.base.json" "$TEMP_DIR/tsconfig.base.json"
  mkdir -p "$TEMP_DIR/$(dirname "$APP_DIR")"
  cp -R "$ROOT_DIR/$APP_DIR" "$TEMP_DIR/$APP_DIR"
  cp "$ROOT_DIR/$APP_DIR/.vercel/project.json" "$TEMP_DIR/.vercel/project.json"

  cat >"$TEMP_DIR/vercel.json" <<'EOF'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "PATH=../../node_modules/.bin:$PATH npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]
}
EOF
fi

for dir in "${DEPENDENCY_DIRS[@]}"; do
  mkdir -p "$TEMP_DIR/$(dirname "$dir")"
  cp -R "$ROOT_DIR/$dir" "$TEMP_DIR/$dir"
done

echo "Verifying preview bundle for $TARGET from $TEMP_DIR"
(
  cd "$TEMP_DIR"
  "$NPM_BIN" ci
  if [[ "$TARGET" == "website" ]]; then
    (
      cd website
      env "${BUILD_ENV_KEY}=${PREVIEW_LABEL}" PATH="${ROOT_BIN_DIR}:${PATH}" "$NPM_BIN" run build
    )
  elif [[ "$STAGE_AT_ROOT" == "true" ]]; then
    env "${BUILD_ENV_KEY}=${PREVIEW_LABEL}" "$NPM_BIN" run build
  else
    (
      cd packages/pwa
      env "${BUILD_ENV_KEY}=${PREVIEW_LABEL}" PATH="${ROOT_BIN_DIR}:${PATH}" "$NPM_BIN" run build
    )
  fi
)

VERCEL_FLAGS=(--scope aubreyfs-projects)
if [[ -n "$VERCEL_TOKEN" ]]; then
  VERCEL_FLAGS+=(--token "$VERCEL_TOKEN")
fi

echo "Pulling Vercel settings for $TARGET"
"$NPX_BIN" vercel pull --yes --environment preview --cwd "$TEMP_DIR" "${VERCEL_FLAGS[@]}"

if [[ "$TARGET" == "website" ]]; then
  echo "Building $TARGET preview with Vercel"
  env "${BUILD_ENV_KEY}=${PREVIEW_LABEL}" "$NPX_BIN" vercel build --cwd "$TEMP_DIR" "${VERCEL_FLAGS[@]}"

  echo "Deploying $TARGET preview with Vercel"
  "$NPX_BIN" vercel deploy --prebuilt --cwd "$TEMP_DIR" "${VERCEL_FLAGS[@]}" -y
else
  echo "Building $TARGET preview with Vercel"
  env "${BUILD_ENV_KEY}=${PREVIEW_LABEL}" "$NPX_BIN" vercel build --cwd "$TEMP_DIR" --local-config "$TEMP_DIR/vercel.json" "${VERCEL_FLAGS[@]}"

  echo "Deploying $TARGET preview with Vercel"
  "$NPX_BIN" vercel deploy --prebuilt --cwd "$TEMP_DIR" --local-config "$TEMP_DIR/vercel.json" "${VERCEL_FLAGS[@]}" -y
fi
