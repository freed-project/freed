import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  CAPTURE_PROVIDER_CONTACT_FILE_PATTERN,
  isProviderVisiblePath,
  PROVIDER_VISIBLE_EXTRA_FILES,
  PROVIDER_VISIBLE_EXTRA_PACKAGE_PREFIXES,
  SOCIAL_PROVIDER_DESKTOP_FILES,
  SOCIAL_PROVIDER_PACKAGE_PREFIXES,
} from "./provider-visible-paths.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(moduleDir, "provider-visible-paths.mjs");

test("desktop capture, auth, and extractor files are provider-visible", () => {
  assert.equal(isProviderVisiblePath("packages/desktop/src/lib/fb-capture.ts"), true);
  assert.equal(isProviderVisiblePath("packages/desktop/src/lib/li-auth.ts"), true);
  assert.equal(isProviderVisiblePath("packages/desktop/src/lib/social-auth-cookie-state.ts"), true);
  assert.equal(isProviderVisiblePath("packages/desktop/src-tauri/src/fb-extract.js"), true);
  assert.equal(isProviderVisiblePath("packages/desktop/src-tauri/src/ig-stories-extract.js"), true);
});

test("risk-only provider surfaces are provider-visible even without a focused test lane", () => {
  assert.equal(isProviderVisiblePath("packages/desktop/src-tauri/src/webkit-mask.js"), true);
  assert.equal(isProviderVisiblePath("packages/desktop/src/lib/user-agent.ts"), true);
  assert.equal(isProviderVisiblePath("packages/desktop/src/lib/rss-refresh-plan.ts"), true);
  assert.equal(isProviderVisiblePath("packages/pwa/src/lib/youtube-integration.ts"), true);
  assert.equal(isProviderVisiblePath("packages/pwa/src/lib/reader-cache.ts"), true);
  assert.equal(isProviderVisiblePath("packages/shared/src/schema.ts"), true);
  assert.equal(isProviderVisiblePath("packages/shared/src/youtube.ts"), true);
  assert.equal(isProviderVisiblePath("packages/ui/src/components/feed/YouTubeFocusPlayer.tsx"), true);
});

test("provider capture packages are provider-visible, including linkedin and youtube", () => {
  assert.equal(isProviderVisiblePath("packages/capture-facebook/src/selectors.ts"), true);
  assert.equal(isProviderVisiblePath("packages/capture-instagram/src/rate-limit.ts"), true);
  assert.equal(isProviderVisiblePath("packages/capture-x/src/endpoints.ts"), true);
  assert.equal(isProviderVisiblePath("packages/capture-linkedin/src/browser.ts"), true);
  assert.equal(isProviderVisiblePath("packages/capture-linkedin/src/normalize.ts"), true);
  assert.equal(isProviderVisiblePath("packages/capture-youtube/src/client.ts"), true);
});

test("provider-contact files in non-social capture packages are provider-visible", () => {
  assert.equal(isProviderVisiblePath("packages/capture-save/src/browser.ts"), true);
  assert.equal(CAPTURE_PROVIDER_CONTACT_FILE_PATTERN.test("packages/capture-save/src/browser.ts"), true);
});

test("non-provider paths are not provider-visible", () => {
  assert.equal(isProviderVisiblePath("packages/desktop/src-tauri/src/lib.rs"), false);
  assert.equal(isProviderVisiblePath("packages/capture-save/src/normalize.ts"), false);
  assert.equal(isProviderVisiblePath("packages/capture-rss/src/index.ts"), false);
  assert.equal(isProviderVisiblePath("packages/desktop/src/components/ProviderHealthSectionSummary.tsx"), false);
  assert.equal(isProviderVisiblePath("scripts/worktree-publish.sh"), false);
  assert.equal(isProviderVisiblePath("docs/STABILITY-PROGRAM.md"), false);
  assert.equal(isProviderVisiblePath(""), false);
  assert.equal(isProviderVisiblePath(undefined), false);
});

test("focused-surface exports stay aligned with the risk predicate", () => {
  for (const filePath of SOCIAL_PROVIDER_DESKTOP_FILES) {
    assert.equal(isProviderVisiblePath(filePath), true, filePath);
  }
  for (const filePath of PROVIDER_VISIBLE_EXTRA_FILES) {
    assert.equal(isProviderVisiblePath(filePath), true, filePath);
  }
  for (const prefix of SOCIAL_PROVIDER_PACKAGE_PREFIXES) {
    assert.equal(isProviderVisiblePath(`${prefix}src/anything.ts`), true, prefix);
  }
  for (const prefix of PROVIDER_VISIBLE_EXTRA_PACKAGE_PREFIXES) {
    assert.equal(isProviderVisiblePath(`${prefix}src/anything.ts`), true, prefix);
  }
});

test("CLI filters stdin to provider-visible paths only", () => {
  const input = [
    "packages/desktop/src-tauri/src/fb-extract.js",
    "docs/STABILITY-PROGRAM.md",
    "packages/capture-linkedin/src/browser.ts",
    "scripts/release.sh",
    "",
  ].join("\n");

  const result = spawnSync(process.execPath, [cliPath, "--stdin"], {
    input,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.split("\n").filter(Boolean), [
    "packages/desktop/src-tauri/src/fb-extract.js",
    "packages/capture-linkedin/src/browser.ts",
  ]);
});

test("CLI prints nothing when no path is provider-visible", () => {
  const result = spawnSync(process.execPath, [cliPath, "--stdin"], {
    input: "docs/README.md\nscripts/release.sh\n",
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("CLI accepts paths as arguments", () => {
  const result = spawnSync(
    process.execPath,
    [cliPath, "packages/desktop/src/lib/user-agent.ts", "docs/README.md"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.split("\n").filter(Boolean), [
    "packages/desktop/src/lib/user-agent.ts",
  ]);
});
