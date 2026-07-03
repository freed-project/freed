#!/usr/bin/env node

// Canonical classification of provider-visible paths (stability task W1-06).
//
// "Provider-visible" means a change here can alter what X, Facebook, Instagram,
// LinkedIn, or another third-party provider can observe: WebView loads,
// navigation, request frequency, timing, cookies, headers, user agent, or
// extractor scripts. Per AGENTS.md and docs/STABILITY-PROGRAM.md, such changes
// require explicit owner approval before they ship.
//
// Consumers:
// - scripts/validate-worktree.mjs (focused provider test selection)
// - scripts/nightly-self-improve.mjs (peer-worktree risk classification)
// - scripts/worktree-publish.sh (publish-time enforcement via the CLI below)
//
// Do not fork this list. Add new provider surfaces here so every consumer
// agrees on what needs the provider-visible approval lane.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Desktop files that drive provider WebViews: capture orchestration, auth,
// session/cookie state, and the injected extractor scripts.
export const SOCIAL_PROVIDER_DESKTOP_FILES = new Set([
  "packages/desktop/src/lib/capture.ts",
  "packages/desktop/src/lib/fb-auth.ts",
  "packages/desktop/src/lib/fb-capture.ts",
  "packages/desktop/src/lib/instagram-auth.ts",
  "packages/desktop/src/lib/instagram-capture.ts",
  "packages/desktop/src/lib/li-auth.ts",
  "packages/desktop/src/lib/li-capture.ts",
  "packages/desktop/src/lib/provider-auth-errors.ts",
  "packages/desktop/src/lib/provider-health.ts",
  "packages/desktop/src/lib/scraper-media-diag.ts",
  "packages/desktop/src/lib/scraper-prefs.ts",
  "packages/desktop/src/lib/social-auth-cookie-state.ts",
  "packages/desktop/src/lib/social-capture-runtime.ts",
  "packages/desktop/src/lib/social-comment-hydration.ts",
  "packages/desktop/src/lib/social-provider-copy.ts",
  "packages/desktop/src/lib/x-auth.ts",
  "packages/desktop/src/lib/x-capture.ts",
  "packages/desktop/src-tauri/src/fb-comments-extract.js",
  "packages/desktop/src-tauri/src/fb-extract.js",
  "packages/desktop/src-tauri/src/fb-groups-extract.js",
  "packages/desktop/src-tauri/src/fb-stories-extract.js",
  "packages/desktop/src-tauri/src/ig-comments-extract.js",
  "packages/desktop/src-tauri/src/ig-extract.js",
  "packages/desktop/src-tauri/src/ig-stories-extract.js",
  "packages/desktop/src-tauri/src/li-extract.js",
]);

// Social capture packages whose focused provider tests validate-worktree runs.
export const SOCIAL_PROVIDER_PACKAGE_PREFIXES = [
  "packages/capture-facebook/",
  "packages/capture-instagram/",
  "packages/capture-x/",
];

// Risk-only additions beyond the focused-test surface above. These change what
// providers can observe but have no dedicated focused provider test lane, so
// validate-worktree intentionally does not narrow validation for them.
export const PROVIDER_VISIBLE_EXTRA_FILES = new Set([
  "packages/desktop/src/lib/user-agent.ts",
  "packages/desktop/src-tauri/src/webkit-mask.js",
]);

export const PROVIDER_VISIBLE_EXTRA_PACKAGE_PREFIXES = [
  "packages/capture-linkedin/",
];

// In any capture package (including non-social ones like capture-save), these
// files own navigation, DOM selection, contact frequency, or endpoint choice.
export const CAPTURE_PROVIDER_CONTACT_FILE_PATTERN =
  /^packages\/capture-[^/]+\/src\/(browser|selectors|rate-limit|endpoints)\.[cm]?ts$/;

export function isProviderVisiblePath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return false;
  }

  if (SOCIAL_PROVIDER_DESKTOP_FILES.has(filePath) || PROVIDER_VISIBLE_EXTRA_FILES.has(filePath)) {
    return true;
  }

  if (
    SOCIAL_PROVIDER_PACKAGE_PREFIXES.some((prefix) => filePath.startsWith(prefix)) ||
    PROVIDER_VISIBLE_EXTRA_PACKAGE_PREFIXES.some((prefix) => filePath.startsWith(prefix))
  ) {
    return true;
  }

  return CAPTURE_PROVIDER_CONTACT_FILE_PATTERN.test(filePath);
}

// CLI: print the provider-visible subset of the given paths, one per line.
//   node scripts/lib/provider-visible-paths.mjs <path>...
//   git diff --name-only ... | node scripts/lib/provider-visible-paths.mjs --stdin
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  const candidates = args.includes("--stdin")
    ? readFileSync(0, "utf8").split(/\r?\n/)
    : args;

  const matches = candidates
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isProviderVisiblePath);

  if (matches.length > 0) {
    process.stdout.write(`${matches.join("\n")}\n`);
  }
}
