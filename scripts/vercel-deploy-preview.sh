#!/usr/bin/env bash
set -euo pipefail

# Website work uses its own immutable Next.js staging contract on the www lane.
if [[ "${1:-}" == "website" ]]; then
  [[ $# -le 2 ]] || { echo "Usage: $0 website [vercel-token]" >&2; exit 1; }
  source "$(dirname "${BASH_SOURCE[0]}")/lib/node-tooling.sh"
  use_resolved_node_path
  export VERCEL_TOKEN="${2:-${VERCEL_TOKEN:-}}"
  exec "$(resolve_node_bin)" "$(dirname "${BASH_SOURCE[0]}")/deploy-website.mjs" preview
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/node-tooling.sh
source "${SCRIPT_DIR}/lib/node-tooling.sh"
# shellcheck source=./lib/worktree-runtime.sh
source "${SCRIPT_DIR}/lib/worktree-runtime.sh"
use_resolved_node_path
NODE_BIN="$(resolve_node_bin)"
NPM_BIN="$(resolve_npm_bin)"
NPX_BIN="$(resolve_npx_bin)"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 website|pwa|pwa-transfer-acceptance [vercel-token]" >&2
  exit 1
fi

TARGET="$1"
PWA_BUILD_SCRIPT="build"
PWA_FEATURE_PREVIEW="1"
ACCEPTANCE_SOURCE_SHA=""
if [[ "$TARGET" == "pwa-transfer-acceptance" ]]; then
  TARGET="pwa"
  PWA_BUILD_SCRIPT="build:transfer-acceptance"
  # Acceptance must reopen a joined Library, not replace local sample data.
  PWA_FEATURE_PREVIEW="0"
  ACCEPTANCE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
  if [[ -n "$(git -C "$ACCEPTANCE_ROOT" status --porcelain)" ]]; then
    echo "Transfer acceptance requires a clean committed source." >&2
    exit 1
  fi
  ACCEPTANCE_SOURCE_SHA="$(git -C "$ACCEPTANCE_ROOT" rev-parse HEAD)"
  export FREED_BUILD_KIND=preview FREED_BUILD_CHANNEL=dev
  export FREED_BUILD_COMMIT_SHA="$ACCEPTANCE_SOURCE_SHA"
  export FREED_BUILD_COMMIT_REF="$(git -C "$ACCEPTANCE_ROOT" branch --show-current)"
fi
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

if [[ -n "$ACCEPTANCE_SOURCE_SHA" ]]; then
  # Only committed source enters this artifact. Never copy ignored credentials,
  # private task notes, local Library files or a previously built dist directory.
  git -C "$ROOT_DIR" archive "$ACCEPTANCE_SOURCE_SHA" | tar -x -C "$TEMP_DIR"
else
cp "$ROOT_DIR/scripts/lib/build-metadata.mjs" "$TEMP_DIR/scripts/lib/build-metadata.mjs"
cp "$ROOT_DIR/scripts/lib/build-metadata.d.mts" "$TEMP_DIR/scripts/lib/build-metadata.d.mts"
cp "$ROOT_DIR/scripts/lib/retired-automerge-runtime.mjs" "$TEMP_DIR/scripts/lib/retired-automerge-runtime.mjs"
cp "$ROOT_DIR/scripts/lib/retired-automerge-runtime.d.mts" "$TEMP_DIR/scripts/lib/retired-automerge-runtime.d.mts"
cp "$ROOT_DIR/scripts/lib/pwa-optional-assets.mjs" "$TEMP_DIR/scripts/lib/pwa-optional-assets.mjs"
cp "$ROOT_DIR/scripts/lib/pwa-optional-assets.d.mts" "$TEMP_DIR/scripts/lib/pwa-optional-assets.d.mts"
cp "$ROOT_DIR/scripts/validate-retired-automerge-runtime.mjs" "$TEMP_DIR/scripts/validate-retired-automerge-runtime.mjs"
cp "$ROOT_DIR/scripts/validate-pwa-optional-assets.mjs" "$TEMP_DIR/scripts/validate-pwa-optional-assets.mjs"

if [[ "$STAGE_AT_ROOT" == "true" ]]; then
  cp "$ROOT_DIR/tsconfig.base.json" "$TEMP_DIR/tsconfig.base.json"
  cp -R "$ROOT_DIR/$APP_DIR"/. "$TEMP_DIR/"
else
  cp "$ROOT_DIR/package.json" "$TEMP_DIR/package.json"
  cp "$ROOT_DIR/package-lock.json" "$TEMP_DIR/package-lock.json"
  cp "$ROOT_DIR/tsconfig.base.json" "$TEMP_DIR/tsconfig.base.json"
  mkdir -p "$TEMP_DIR/$(dirname "$APP_DIR")"
  cp -R "$ROOT_DIR/$APP_DIR" "$TEMP_DIR/$APP_DIR"
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

if [[ -z "$ACCEPTANCE_SOURCE_SHA" ]]; then
for dir in "${DEPENDENCY_DIRS[@]}"; do
  mkdir -p "$TEMP_DIR/$(dirname "$dir")"
  cp -R "$ROOT_DIR/$dir" "$TEMP_DIR/$dir"
done
fi

if [[ -n "$ACCEPTANCE_SOURCE_SHA" ]]; then
  cp "$TEMP_DIR/packages/pwa/vercel.json" "$TEMP_DIR/vercel.json"
  "$NODE_BIN" --input-type=module - "$TEMP_DIR/vercel.json" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const path = process.argv[2];
const config = JSON.parse(readFileSync(path, "utf8"));
const source = process.env.FREED_BUILD_COMMIT_SHA;
if (!/^[0-9a-f]{40}$/.test(source || "")) throw new Error("Invalid acceptance source identity.");
config.buildCommand = `PATH=../../node_modules/.bin:$PATH VITE_FREED_FEATURE_PREVIEW=0 FREED_BUILD_KIND=preview FREED_BUILD_CHANNEL=dev FREED_BUILD_COMMIT_SHA=${source} FREED_BUILD_COMMIT_REF=transfer-acceptance npm run build:transfer-acceptance`;
delete config.ignoreCommand;
writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
NODE
fi

echo "Verifying preview bundle for $TARGET from $TEMP_DIR"
(
  cd "$TEMP_DIR"
  if [[ -n "$ACCEPTANCE_SOURCE_SHA" ]]; then
    "${NPM_BIN}" ci --ignore-scripts
  else
    "${NPM_BIN}" install
  fi
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
      env "${BUILD_ENV_KEY}=${PREVIEW_LABEL}" "VITE_FREED_FEATURE_PREVIEW=${PWA_FEATURE_PREVIEW}" PATH="${ROOT_BIN_DIR}:${PATH}" "$NPM_BIN" run "$PWA_BUILD_SCRIPT"
    )
  fi
)

VERCEL_FLAGS=(--scope aubreyfs-projects)
if [[ -n "$VERCEL_TOKEN" ]]; then
  VERCEL_FLAGS+=(--token "$VERCEL_TOKEN")
fi

echo "Pulling Vercel settings for $TARGET"
VERCEL_PULL_FLAGS=(--yes --environment preview --cwd "$TEMP_DIR")
if [[ "$PROJECT_LINK_STATE" == "bootstrap" ]]; then
  echo "No local Vercel link found; selecting $VERCEL_PROJECT explicitly"
  VERCEL_PULL_FLAGS+=(--project "$VERCEL_PROJECT")
fi
if ! "$NPX_BIN" vercel pull "${VERCEL_PULL_FLAGS[@]}" "${VERCEL_FLAGS[@]}"; then
  echo "Unable to access Vercel project $VERCEL_PROJECT in scope aubreyfs-projects. Verify Vercel authentication and project access." >&2
  exit 1
fi

if [[ -n "$ACCEPTANCE_SOURCE_SHA" ]]; then
  "$NODE_BIN" --input-type=module - "$TEMP_DIR/.vercel/.env.preview.local" <<'NODE'
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
const env = parseEnv(readFileSync(process.argv[2], "utf8"));
const client = env.VITE_GDRIVE_CLIENT_ID;
let additional = {};
try { additional = JSON.parse(env.GDRIVE_OAUTH_CLIENTS_JSON || "{}"); } catch {}
const secret = env.GDRIVE_CLIENT_SECRET ||
  (client === env.GDRIVE_DESKTOP_CLIENT_ID && env.GDRIVE_DESKTOP_CLIENT_SECRET) ||
  additional?.[client];
if (!client || typeof secret !== "string" || !secret) {
  throw new Error("Preview Google web client and matching server credentials are required for transfer acceptance.");
}
console.log("Preview Google configuration is present; live OAuth remains unverified.");
NODE
fi

if [[ "$TARGET" == "website" ]]; then
  echo "Building $TARGET preview with Vercel"
  env "${BUILD_ENV_KEY}=${PREVIEW_LABEL}" "$NPX_BIN" vercel build --cwd "$TEMP_DIR" "${VERCEL_FLAGS[@]}"

  echo "Deploying $TARGET preview with Vercel"
  "$NPX_BIN" vercel deploy --prebuilt --archive=tgz --cwd "$TEMP_DIR" "${VERCEL_FLAGS[@]}" -y
else
  echo "Building $TARGET preview with Vercel"
  env "${BUILD_ENV_KEY}=${PREVIEW_LABEL}" "VITE_FREED_FEATURE_PREVIEW=${PWA_FEATURE_PREVIEW}" "$NPX_BIN" vercel build --cwd "$TEMP_DIR" --local-config "$TEMP_DIR/vercel.json" "${VERCEL_FLAGS[@]}"

  echo "Deploying $TARGET preview with Vercel"
  "$NPX_BIN" vercel deploy --prebuilt --archive=tgz --cwd "$TEMP_DIR" --local-config "$TEMP_DIR/vercel.json" "${VERCEL_FLAGS[@]}" -y
fi
