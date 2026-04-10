#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 website|pwa" >&2
  exit 1
fi

TARGET="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/freed-vercel-preview.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

case "$TARGET" in
  website)
    APP_DIR="website"
    STAGE_AT_ROOT="true"
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
  cp "$ROOT_DIR/tsconfig.base.json" "$TEMP_DIR/tsconfig.base.json"
  cp -R "$ROOT_DIR/$APP_DIR"/. "$TEMP_DIR/"

  node - "$ROOT_DIR/$APP_DIR/package.json" "$TEMP_DIR/package.json" <<'NODE'
const fs = require("fs");

const [, , sourcePath, targetPath] = process.argv;
const pkg = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

pkg.private = true;
pkg.workspaces = [".", "packages/*"];
pkg.scripts = {
  ...pkg.scripts,
  postinstall: "node scripts/patch-automerge.mjs",
};

fs.writeFileSync(targetPath, `${JSON.stringify(pkg, null, 2)}\n`);
NODE
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
  "buildCommand": "npm run build -w @freed/pwa",
  "outputDirectory": "packages/pwa/dist",
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
  npm install
  if [[ "$STAGE_AT_ROOT" == "true" ]]; then
    npm run build
  else
    npm run build -w @freed/pwa
  fi
)

echo "Pulling Vercel settings for $TARGET"
npx vercel pull --yes --environment preview --cwd "$TEMP_DIR" --scope aubreyfs-projects

echo "Building $TARGET preview with Vercel"
npx vercel build --cwd "$TEMP_DIR" --local-config "$TEMP_DIR/vercel.json" --scope aubreyfs-projects

echo "Deploying $TARGET preview with Vercel"
npx vercel deploy --prebuilt --cwd "$TEMP_DIR" --local-config "$TEMP_DIR/vercel.json" --scope aubreyfs-projects -y
