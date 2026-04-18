#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 website|pwa [vercel-token]" >&2
  exit 1
fi

TARGET="$1"
VERCEL_TOKEN="${2:-${VERCEL_TOKEN:-}}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/freed-vercel-production.XXXXXX")"

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

mkdir -p "$TEMP_DIR/scripts" "$TEMP_DIR/.vercel"

cp "$ROOT_DIR/scripts/patch-automerge.mjs" "$TEMP_DIR/scripts/patch-automerge.mjs"

if [[ "$STAGE_AT_ROOT" == "true" ]]; then
  cp "$ROOT_DIR/package.json" "$TEMP_DIR/package.json"
  cp "$ROOT_DIR/package-lock.json" "$TEMP_DIR/package-lock.json"
  cp "$ROOT_DIR/tsconfig.base.json" "$TEMP_DIR/tsconfig.base.json"
  cp -R "$ROOT_DIR/$APP_DIR" "$TEMP_DIR/$APP_DIR"
  cp "$ROOT_DIR/$APP_DIR/.vercel/project.json" "$TEMP_DIR/.vercel/project.json"
else
  cp "$ROOT_DIR/package.json" "$TEMP_DIR/package.json"
  cp "$ROOT_DIR/package-lock.json" "$TEMP_DIR/package-lock.json"
  cp "$ROOT_DIR/tsconfig.base.json" "$TEMP_DIR/tsconfig.base.json"
  mkdir -p "$TEMP_DIR/$(dirname "$APP_DIR")"
  cp -R "$ROOT_DIR/$APP_DIR" "$TEMP_DIR/$APP_DIR"
  cp "$ROOT_DIR/$APP_DIR/.vercel/project.json" "$TEMP_DIR/.vercel/project.json"

  if [[ "$TARGET" == "pwa" ]]; then
    mkdir -p "$TEMP_DIR/scripts"
    cp "$ROOT_DIR/scripts/patch-automerge.mjs" "$TEMP_DIR/scripts/patch-automerge.mjs"
    mkdir -p "$TEMP_DIR/packages/pwa"
    cat <<'EOF' >"$TEMP_DIR/vercel.json"
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build -w @freed/pwa",
  "outputDirectory": "packages/pwa/dist",
  "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]
}
EOF
  fi
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
  npm install
  if [[ "$TARGET" == "website" ]]; then
    npm run build --workspace=website
  else
    npm run build -w @freed/pwa
  fi
)

VERCEL_FLAGS=(--scope aubreyfs-projects)
if [[ -n "$VERCEL_TOKEN" ]]; then
  VERCEL_FLAGS+=(--token "$VERCEL_TOKEN")
fi

echo "Pulling Vercel settings for $TARGET"
npx vercel pull --yes --environment production --cwd "$TEMP_DIR" "${VERCEL_FLAGS[@]}"

if [[ "$TARGET" == "website" ]]; then
  echo "Building $TARGET production bundle with Vercel"
  "$NPX_BIN" vercel build --cwd "$TEMP_DIR" "${VERCEL_FLAGS[@]}" --prod

  echo "Deploying $TARGET production build to Vercel"
  "$NPX_BIN" vercel deploy --prebuilt --cwd "$TEMP_DIR" "${VERCEL_FLAGS[@]}" -y --prod
else
  echo "Building $TARGET production bundle with Vercel"
  npx vercel build --cwd "$TEMP_DIR" --local-config "$TEMP_DIR/vercel.json" "${VERCEL_FLAGS[@]}" --prod

  echo "Deploying $TARGET production build to Vercel"
  npx vercel deploy --prebuilt --cwd "$TEMP_DIR" --local-config "$TEMP_DIR/vercel.json" "${VERCEL_FLAGS[@]}" -y --prod
fi
