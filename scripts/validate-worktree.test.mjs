import test from "node:test";
import assert from "node:assert/strict";

import {
  buildValidationPlan,
  collectReleaseArtifactsToValidate,
  describePlan,
  isDesktopNativeSurface,
  isDesktopPerfSensitiveSurface,
  isReleasePublisherToolingPath,
  isReleaseAdmissionPath,
  isRepositoryConfigPath,
  isSocialScrapeLoopPath,
  isSocialProviderFocusedSurface,
  isStabilityStatusPath,
  isToolingSmokeRunnerPath,
  parseArgs,
  REPO_ROOT,
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
    buildValidationPlan("feature", [
      "website/src/app/roadmap/RoadmapContent.tsx",
    ]),
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
    "desktop social provider unit tests",
    "desktop social provider e2e",
    "pwa production build",
    "pwa typecheck",
    "pwa unit tests",
    "pwa performance tests",
    "desktop unit tests",
    "desktop e2e smoke",
    "desktop e2e perf",
  ]);
});

test("feature plan for feed UI changes runs desktop perf checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", [
      "packages/ui/src/components/feed/useReadOnScrollTracker.ts",
    ]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "pwa production build",
    "pwa typecheck",
    "pwa unit tests",
    "pwa performance tests",
    "desktop unit tests",
    "desktop e2e smoke",
    "desktop e2e perf",
  ]);
});

test("feature plan for Friends UI changes runs desktop perf checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", [
      "packages/ui/src/components/friends/FriendsView.tsx",
    ]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "pwa production build",
    "pwa typecheck",
    "pwa unit tests",
    "pwa performance tests",
    "desktop unit tests",
    "desktop e2e smoke",
    "desktop e2e perf",
  ]);
});

test("feature plan for sidebar UI changes runs desktop perf checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", [
      "packages/ui/src/components/layout/Sidebar.tsx",
    ]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "pwa production build",
    "pwa typecheck",
    "pwa unit tests",
    "pwa performance tests",
    "desktop unit tests",
    "desktop e2e smoke",
    "desktop e2e perf",
  ]);
});

test("feature plan for non-feed desktop changes skips desktop perf checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", [
      "packages/desktop/src/components/ProviderHealthSectionSummary.tsx",
    ]),
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
    "desktop social provider e2e",
    "desktop production build",
  ]);
});

test("feature plan for provider extractor scripts uses focused provider checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", [
      "packages/desktop/src-tauri/src/fb-extract.js",
    ]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "desktop social provider unit tests",
    "desktop social provider e2e",
    "desktop production build",
  ]);
});

test("providers plan runs focused social provider checks", () => {
  const labels = describePlan(buildValidationPlan("providers", []));

  assert.deepEqual(labels, [
    "desktop social provider unit tests",
    "desktop social provider e2e",
  ]);
});

test("social provider focused surfaces exclude native shell changes", () => {
  assert.equal(
    isSocialProviderFocusedSurface("packages/desktop/src/lib/fb-capture.ts"),
    true,
  );
  assert.equal(
    isSocialProviderFocusedSurface(
      "packages/desktop/src-tauri/src/fb-extract.js",
    ),
    true,
  );
  assert.equal(
    isSocialProviderFocusedSurface(
      "packages/capture-facebook/src/normalize.ts",
    ),
    true,
  );
  assert.equal(
    isSocialProviderFocusedSurface("packages/capture-youtube/src/browser.ts"),
    true,
  );
  assert.equal(
    isSocialProviderFocusedSurface("packages/desktop/src-tauri/src/lib.rs"),
    false,
  );
  assert.equal(
    isSocialProviderFocusedSurface(
      "packages/desktop/src/components/ProviderHealthSectionSummary.tsx",
    ),
    false,
  );
});

test("YouTube native changes keep provider and Rust validation", () => {
  const labels = describePlan(
    buildValidationPlan("feature", [
      "packages/desktop/src-tauri/src/youtube.rs",
    ]),
  );

  assert.ok(labels.includes("desktop social provider unit tests"));
  assert.ok(labels.includes("desktop social provider e2e"));
  assert.ok(labels.includes("native rust clippy"));
  assert.ok(labels.includes("native rust tests"));
});

test("YouTube package changes run package tests and provider workflows", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["packages/capture-youtube/src/browser.ts"]),
  );

  assert.ok(labels.includes("desktop social provider unit tests"));
  assert.ok(labels.includes("desktop social provider e2e"));
  assert.ok(labels.includes("packages/capture-youtube tests"));
  assert.ok(labels.includes("packages/capture-youtube build"));
});

test("feature plan runs native clippy and tests for native shell changes", () => {
  const plan = buildValidationPlan("feature", [
    "packages/desktop/src-tauri/src/lib.rs",
  ]);
  const labels = describePlan(plan);

  assert.ok(labels.includes("desktop production build"));
  assert.ok(labels.includes("desktop social provider unit tests"));
  assert.ok(labels.includes("desktop social provider e2e"));
  assert.ok(labels.includes("native rust clippy"));
  assert.ok(labels.includes("native rust tests"));
  assert.equal(
    isDesktopNativeSurface("packages/desktop/src-tauri/src/lib.rs"),
    true,
  );
  assert.equal(
    isDesktopNativeSurface("packages/desktop/src/lib/capture.ts"),
    false,
  );
});

test("workspace checks run inside each workspace without root dispatch flags", () => {
  const plan = buildValidationPlan("dev", []);
  const workspaceCommands = plan.filter(
    (item) => item.kind === "command" && item.cwd !== REPO_ROOT,
  );

  assert.ok(workspaceCommands.length > 0);
  for (const item of workspaceCommands) {
    assert.equal(
      item.args.some(
        (arg) => arg === "--workspace" || arg.startsWith("--workspace="),
      ),
      false,
    );
  }

  const websiteTests = plan.find((item) => item.label === "website tests");
  const desktopTests = plan.find((item) => item.label === "desktop unit tests");
  assert.match(websiteTests.cwd, /\/website$/);
  assert.match(desktopTests.cwd, /\/packages\/desktop$/);
});

test("parseArgs supports printing plan labels without executing", () => {
  const parsed = parseArgs(["--mode", "feature", "--plan-labels"]);

  assert.equal(parsed.planLabels, true);
});

test("parseArgs supports printing the full plan without executing", () => {
  const parsed = parseArgs(["--mode", "feature", "--plan-only"]);

  assert.equal(parsed.planOnly, true);
});

test("feature plan for validation runner changes runs only runner tests", () => {
  const labels = describePlan(
    buildValidationPlan("feature", [
      "scripts/validate-worktree.mjs",
      "scripts/validate-worktree.test.mjs",
    ]),
  );

  assert.deepEqual(labels, ["validation runner tests"]);
});

test("feature plan for release admission changes runs only its contract tests", () => {
  const paths = [
    ".github/workflows/release.yml",
    "scripts/validate-dev-integration-receipt.mjs",
    "scripts/validate-dev-integration-receipt.test.mjs",
  ];
  for (const filePath of paths) {
    assert.equal(isReleaseAdmissionPath(filePath), true, filePath);
  }

  const plan = buildValidationPlan("feature", paths);
  assert.deepEqual(describePlan(plan), ["release admission tests"]);
  assert.deepEqual(plan[0].args, [
    "--test",
    "scripts/validate-dev-integration-receipt.test.mjs",
    "scripts/release-governance.test.mjs",
    "scripts/release-workflow-matrix.test.mjs",
  ]);
});

test("feature plan for repository configuration runs only its parser contract", () => {
  const paths = [
    ".github/dependabot.yml",
    "packages/pwa/vercel.json",
    "scripts/repository-config.test.mjs",
  ];
  for (const filePath of paths) {
    assert.equal(isRepositoryConfigPath(filePath), true, filePath);
  }

  assert.deepEqual(describePlan(buildValidationPlan("feature", paths)), [
    "repository configuration tests",
  ]);
});

test("PWA-only provider-visible changes stay in the PWA validation lane", () => {
  const labels = describePlan(
    buildValidationPlan("feature", [
      "packages/pwa/src/App.tsx",
      "packages/pwa/src/components/SyncConnectDialog.tsx",
    ]),
  );

  assert.ok(labels.includes("pwa production build"));
  assert.ok(labels.includes("pwa unit tests"));
  assert.ok(!labels.includes("desktop social provider unit tests"));
  assert.ok(!labels.includes("desktop social provider e2e"));
});

test("mixed feature plans retain repository configuration coverage", () => {
  assert.ok(
    describePlan(
      buildValidationPlan("feature", [
        ".github/dependabot.yml",
        "packages/shared/src/schema.ts",
      ]),
    ).includes("repository configuration tests"),
  );
});

test("feature plan routes tooling smoke workflow and helper changes through focused tests", () => {
  const paths = [
    ".github/workflows/ci.yml",
    "scripts/run-tooling-smoke-shard.mjs",
    "scripts/run-tooling-smoke-shard.test.mjs",
  ];
  for (const filePath of paths) {
    assert.equal(isToolingSmokeRunnerPath(filePath), true, filePath);
  }
  assert.equal(
    isToolingSmokeRunnerPath("scripts/automation-control.test.mjs"),
    false,
  );
  const plan = buildValidationPlan("feature", paths);
  const runnerTests = plan.find(
    (item) => item.label === "tooling smoke runner tests",
  );
  assert.ok(runnerTests);
  assert.deepEqual(runnerTests.args, [
    "--test",
    "scripts/tooling-smoke-plan.test.mjs",
    "scripts/run-tooling-smoke-shard.test.mjs",
  ]);
});

test("feature plan for social scrape loop changes runs only loop tests", () => {
  const labels = describePlan(
    buildValidationPlan("feature", [
      "scripts/social-scrape-loop.mjs",
      "scripts/social-scrape-loop.test.mjs",
    ]),
  );

  assert.deepEqual(labels, ["social scrape loop tests"]);
});

test("social scrape loop path detection is scoped to loop files", () => {
  assert.equal(isSocialScrapeLoopPath("scripts/social-scrape-loop.mjs"), true);
  assert.equal(
    isSocialScrapeLoopPath("scripts/social-scrape-loop.test.mjs"),
    true,
  );
  assert.equal(
    isSocialScrapeLoopPath("scripts/nightly-self-improve.mjs"),
    false,
  );
});

test("stability status paths route focused tests in feature and dev plans", () => {
  const paths = [
    "scripts/stability-status.mjs",
    "scripts/lib/stability-status.mjs",
    "scripts/lib/stability-artifacts.mjs",
    "scripts/stability-status.test.mjs",
    "scripts/stability-artifact.test.mjs",
  ];
  for (const filePath of paths) {
    assert.equal(isStabilityStatusPath(filePath), true, filePath);
    for (const mode of ["feature", "dev"]) {
      const item = buildValidationPlan(mode, [filePath]).find(
        (candidate) => candidate.label === "stability status tests",
      );
      assert.ok(item, `${mode}: ${filePath}`);
      assert.deepEqual(item.args, [
        "--test",
        "scripts/stability-status.test.mjs",
        "scripts/stability-artifact.test.mjs",
      ]);
    }
  }
  assert.equal(
    isStabilityStatusPath("scripts/nightly-self-improve.mjs"),
    false,
  );
});

test("desktop perf sensitivity is scoped to hot paths and perf harnesses", () => {
  assert.equal(
    isDesktopPerfSensitiveSurface(
      "packages/desktop/src/lib/automerge.worker.ts",
    ),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface(
      "packages/desktop/tests/e2e/perf-map.spec.ts",
    ),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface(
      "packages/desktop/tests/e2e/perf-settings.spec.ts",
    ),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface(
      "packages/ui/src/components/feed/FeedList.tsx",
    ),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface(
      "packages/ui/src/components/friends/FriendGraph.tsx",
    ),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface(
      "packages/ui/src/components/layout/Sidebar.tsx",
    ),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface("packages/ui/src/components/map/MapView.tsx"),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface(
      "packages/ui/src/components/SettingsDialog.tsx",
    ),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface(
      "packages/ui/src/components/settings/FeedsSection.tsx",
    ),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface("packages/ui/src/lib/friends-workspace.ts"),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface(
      "packages/ui/src/hooks/useResolvedLocations.ts",
    ),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface("packages/shared/src/location.ts"),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface("packages/shared/src/ranking.ts"),
    true,
  );
  assert.equal(
    isDesktopPerfSensitiveSurface(
      "packages/desktop/src/components/ProviderHealthSectionSummary.tsx",
    ),
    false,
  );
});

test("dev plan runs desktop smoke, regression, perf, and visual lanes", () => {
  const labels = describePlan(buildValidationPlan("dev", []));

  assert.ok(labels.includes("desktop e2e smoke"));
  assert.ok(labels.includes("desktop e2e regression"));
  assert.ok(labels.includes("desktop e2e perf"));
  assert.ok(labels.includes("desktop e2e visual"));
  assert.ok(labels.includes("pwa performance tests"));
  assert.ok(labels.includes("native rust clippy"));
  assert.ok(labels.includes("native rust tests"));
  assert.ok(!labels.includes("desktop e2e full"));
});

test("production plan includes dev desktop gates without duplicating shipped builds", () => {
  const labels = describePlan(buildValidationPlan("production", []));

  assert.ok(labels.includes("desktop e2e smoke"));
  assert.ok(labels.includes("desktop e2e regression"));
  assert.ok(labels.includes("desktop e2e perf"));
  assert.ok(labels.includes("desktop e2e visual"));
  assert.ok(!labels.includes("desktop e2e full"));

  // The PWA is not otherwise built by the release workflow, so it stays.
  assert.ok(labels.includes("pwa production build"));

  // The release matrix runs the real signed desktop build on all four
  // platforms. Building the frontend once more here made it five builds to
  // gate four artifacts, and a frontend break still fails the build that ships.
  assert.ok(
    !labels.includes("desktop production build"),
    "the desktop build must not be duplicated ahead of the release matrix",
  );

  // The website ships from `www` through publish-website against the reviewed
  // marketing branch. Building it in the Desktop release lane couples two
  // branch lanes that AGENTS.md keeps apart.
  assert.ok(
    !labels.includes("website production build"),
    "the Desktop release lane must not build the website",
  );
});

test("release mode remains a compatibility alias for production", () => {
  assert.deepEqual(
    describePlan(buildValidationPlan("release", [])),
    describePlan(buildValidationPlan("production", [])),
  );
});

test("feature plan for capture-only changes runs the touched workspace checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["packages/capture-rss/src/index.ts"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "packages/capture-rss tests",
    "packages/capture-rss build",
  ]);
});

test("feature plan for release tooling changes runs code contract tests without replaying historical artifacts", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["scripts/prepare-release-notes.mjs"]),
  );

  assert.equal(labels[0], "root typecheck");
  assert.ok(labels.includes("release notes shared tests"));
  assert.ok(!labels.includes("release note artifact validation"));
});

test("feature plan routes every Release Publisher surface through its focused suite", () => {
  const publisherPaths = [
    ".github/rulesets/release-tag-lockdown.json",
    ".github/rulesets/release-tag-immutability.json",
    ".github/rulesets/release-tags.json",
    "docs/AUTOMATION-CONTROL-PLANE.md",
    "docs/RELEASE-SECRETS.md",
    "scripts/automation-control-docs.test.mjs",
    "scripts/create-release-github-app.mjs",
    "scripts/create-release-github-app.test.mjs",
    "scripts/doctor.mjs",
    "scripts/doctor.test.mjs",
    "scripts/lib/release-tag-publisher.mjs",
    "scripts/lib/release-tag-publisher.test.mjs",
    "scripts/release-tag-publisher-build.sh",
    "scripts/release-tag-publisher-host.swift",
    "scripts/release-tag-publisher-install.mjs",
    "scripts/release-tag-publisher-install.test.mjs",
    "scripts/release-tag-publisher-native.test.mjs",
    "scripts/release-tag-publisher.mjs",
    "scripts/sync-github-rulesets.mjs",
    "scripts/sync-github-rulesets.test.mjs",
    "scripts/validate-release-tag-authority.mjs",
    "scripts/validate-release-tag-authority.test.mjs",
  ];

  for (const filePath of publisherPaths) {
    assert.equal(isReleasePublisherToolingPath(filePath), true, filePath);
    const publisherSuite = buildValidationPlan("feature", [filePath]).find(
      (item) => item.label === "release publisher tests",
    );
    assert.ok(publisherSuite, filePath);
    assert.ok(
      publisherSuite.args.includes(
        "scripts/release-tag-publisher-native.test.mjs",
      ),
      filePath,
    );
    assert.ok(
      publisherSuite.args.includes("scripts/automation-control-docs.test.mjs"),
      filePath,
    );
  }

  assert.equal(isReleasePublisherToolingPath("scripts/release-publish.sh"), true);
  assert.deepEqual(
    describePlan(
      buildValidationPlan("feature", ["scripts/release-publish.sh"]),
    ),
    ["release admission tests"],
  );
});

test("collectReleaseArtifactsToValidate resolves markdown artifacts to their json pairs", () => {
  const artifacts = collectReleaseArtifactsToValidate([
    "release-notes/releases/v26.4.1602.md",
  ]);

  assert.deepEqual(artifacts, ["release-notes/releases/v26.4.1602.json"]);
});
