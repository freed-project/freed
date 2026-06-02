import test from "node:test";
import assert from "node:assert/strict";

import {
  buildValidationPlan,
  collectReleaseArtifactsToValidate,
  describePlan,
  isDesktopPerfSensitiveSurface,
  isSocialProviderFocusedSurface,
  parseArgs,
} from "./validate-worktree.mjs";

test("parseArgs accepts mode and changed files", () => {
  const parsed = parseArgs([
    "--mode",
    "feature",
    "--changed-files",
    "website/src/app/page.tsx",
    "README.md",
  ]);

  assert.equal(parsed.mode, "feature");
  assert.deepEqual(parsed.changedFiles, [
    "website/src/app/page.tsx",
    "README.md",
  ]);
});

test("feature plan for website-only changes stays on website checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["website/src/app/roadmap/RoadmapContent.tsx"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "website production build",
    "website tests",
  ]);
});

test("feature plan for shared changes covers both desktop and pwa surfaces", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["packages/shared/src/schema.ts"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "pwa production build",
    "pwa typecheck",
    "pwa unit tests",
    "desktop unit tests",
    "desktop e2e smoke",
    "desktop e2e perf",
  ]);
});

test("feature plan for feed UI changes runs desktop perf checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["packages/ui/src/components/feed/useReadOnScrollTracker.ts"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "pwa production build",
    "pwa typecheck",
    "pwa unit tests",
    "desktop unit tests",
    "desktop e2e smoke",
    "desktop e2e perf",
  ]);
});

test("feature plan for Friends UI changes runs desktop perf checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["packages/ui/src/components/friends/FriendsView.tsx"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "pwa production build",
    "pwa typecheck",
    "pwa unit tests",
    "desktop unit tests",
    "desktop e2e smoke",
    "desktop e2e perf",
  ]);
});

test("feature plan for sidebar UI changes runs desktop perf checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["packages/ui/src/components/layout/Sidebar.tsx"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "pwa production build",
    "pwa typecheck",
    "pwa unit tests",
    "desktop unit tests",
    "desktop e2e smoke",
    "desktop e2e perf",
  ]);
});

test("feature plan for non-feed desktop changes skips desktop perf checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["packages/desktop/src/components/ProviderHealthSectionSummary.tsx"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "desktop unit tests",
    "desktop e2e smoke",
  ]);
});

test("feature plan for provider-only desktop changes uses focused provider checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", [
      "packages/desktop/src/lib/fb-capture.ts",
      "packages/desktop/src/lib/social-auth-cookie-state.ts",
      "packages/desktop/src/lib/social-capture-memory-pressure.test.ts",
    ]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "desktop social provider unit tests",
    "desktop production build",
  ]);
});

test("feature plan for provider extractor scripts uses focused provider checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["packages/desktop/src-tauri/src/fb-extract.js"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "desktop social provider unit tests",
    "desktop production build",
  ]);
});

test("providers plan runs focused social provider checks", () => {
  const labels = describePlan(buildValidationPlan("providers", []));

  assert.deepEqual(labels, [
    "desktop social provider unit tests",
  ]);
});

test("social provider focused surfaces exclude native shell changes", () => {
  assert.equal(isSocialProviderFocusedSurface("packages/desktop/src/lib/fb-capture.ts"), true);
  assert.equal(isSocialProviderFocusedSurface("packages/desktop/src-tauri/src/fb-extract.js"), true);
  assert.equal(isSocialProviderFocusedSurface("packages/capture-facebook/src/normalize.ts"), true);
  assert.equal(isSocialProviderFocusedSurface("packages/desktop/src-tauri/src/lib.rs"), false);
  assert.equal(isSocialProviderFocusedSurface("packages/desktop/src/components/ProviderHealthSectionSummary.tsx"), false);
});

test("parseArgs supports printing plan labels without executing", () => {
  const parsed = parseArgs(["--mode", "feature", "--plan-labels"]);

  assert.equal(parsed.planLabels, true);
});

test("desktop perf sensitivity is scoped to hot paths and perf harnesses", () => {
  assert.equal(isDesktopPerfSensitiveSurface("packages/desktop/src/lib/automerge.worker.ts"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/desktop/tests/e2e/perf-map.spec.ts"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/desktop/tests/e2e/perf-settings.spec.ts"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/ui/src/components/feed/FeedList.tsx"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/ui/src/components/friends/FriendGraph.tsx"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/ui/src/components/layout/Sidebar.tsx"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/ui/src/components/map/MapView.tsx"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/ui/src/components/SettingsDialog.tsx"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/ui/src/components/settings/FeedsSection.tsx"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/ui/src/lib/friends-workspace.ts"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/ui/src/hooks/useResolvedLocations.ts"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/shared/src/location.ts"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/shared/src/ranking.ts"), true);
  assert.equal(isDesktopPerfSensitiveSurface("packages/desktop/src/components/ProviderHealthSectionSummary.tsx"), false);
});

test("dev plan runs desktop smoke, regression, perf, and visual lanes", () => {
  const labels = describePlan(buildValidationPlan("dev", []));

  assert.ok(labels.includes("desktop e2e smoke"));
  assert.ok(labels.includes("desktop e2e regression"));
  assert.ok(labels.includes("desktop e2e perf"));
  assert.ok(labels.includes("desktop e2e visual"));
  assert.ok(!labels.includes("desktop e2e full"));
});

test("production plan includes dev desktop gates and production builds", () => {
  const labels = describePlan(buildValidationPlan("production", []));

  assert.ok(labels.includes("desktop e2e smoke"));
  assert.ok(labels.includes("desktop e2e regression"));
  assert.ok(labels.includes("desktop e2e perf"));
  assert.ok(labels.includes("desktop e2e visual"));
  assert.ok(!labels.includes("desktop e2e full"));
  assert.ok(labels.includes("desktop production build"));
});

test("release mode remains a compatibility alias for production", () => {
  assert.deepEqual(
    describePlan(buildValidationPlan("release", [])),
    describePlan(buildValidationPlan("production", [])),
  );
});

test("feature plan for capture-only changes runs the touched workspace check", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["packages/capture-rss/src/index.ts"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "packages/capture-rss build",
  ]);
});

test("feature plan for release tooling changes runs script tests and artifact validation", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["scripts/prepare-release-notes.mjs"]),
  );

  assert.equal(labels[0], "root typecheck");
  assert.ok(labels.includes("release notes shared tests"));
  assert.ok(labels.includes("release note artifact validation"));
});

test("collectReleaseArtifactsToValidate resolves markdown artifacts to their json pairs", () => {
  const artifacts = collectReleaseArtifactsToValidate([
    "release-notes/releases/v26.4.1602.md",
  ]);

  assert.deepEqual(artifacts, ["release-notes/releases/v26.4.1602.json"]);
});
