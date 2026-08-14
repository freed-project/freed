import test from "node:test";
import assert from "node:assert/strict";

import { FOCUSED_FEATURE_VALIDATION_PATHS } from "./lib/tooling-smoke-plan.mjs";
import {
  buildValidationPlan,
  collectChangedReleaseIdentityArtifacts,
  collectReleaseArtifactsToValidate,
  describePlan,
  executeReleaseIdentityValidation,
  isDesktopNativeSurface,
  isDesktopPerfSensitiveSurface,
  isLibraryCoreReleaseActivationPath,
  isPullRequestPublisherToolingPath,
  isReleasePublisherToolingPath,
  isReleaseAdmissionPath,
  isRepositoryConfigPath,
  isSocialScrapeLoopPath,
  isSocialProviderFocusedSurface,
  isStabilityStatusPath,
  isToolingSmokeRunnerPath,
  parseArgs,
  releaseArtifactExistsAtRef,
  releaseTagExists,
  releaseIdentityValidationArgsForArtifact,
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
    "shared unit tests",
    "pwa production build",
    "pwa typecheck",
    "pwa unit tests",
    "pwa performance tests",
    "desktop unit tests",
    "desktop e2e smoke",
    "desktop e2e perf",
  ]);
});

test("feature plan for sync changes runs the sync package tests", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["packages/sync/src/storage/indexeddb.ts"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "sync unit tests",
    "pwa production build",
    "pwa typecheck",
    "pwa unit tests",
    "pwa performance tests",
    "desktop unit tests",
    "desktop e2e smoke",
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
    ".github/workflows/main-release-validation.yml",
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
    "scripts/measure-tooling-smoke.mjs",
    "scripts/measure-tooling-smoke.test.mjs",
    "scripts/run-native-acceptance.mjs",
    "scripts/run-native-acceptance.test.mjs",
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
  const releaseAdmissionTests = plan.find(
    (item) => item.label === "release admission tests",
  );
  assert.ok(runnerTests);
  assert.ok(releaseAdmissionTests);
  assert.deepEqual(runnerTests.args, [
    "--test",
    "scripts/measure-tooling-smoke.test.mjs",
    "scripts/run-native-acceptance.test.mjs",
    "scripts/tooling-smoke-plan.test.mjs",
    "scripts/run-tooling-smoke-shard.test.mjs",
  ]);
});

test("deleted performance comment paths route their exact replacement contract", () => {
  for (const filePath of [
    "scripts/post-perf-comment.mjs",
    "scripts/post-perf-comment.test.mjs",
  ]) {
    const labels = describePlan(buildValidationPlan("feature", [filePath]));
    assert.ok(labels.includes("release admission tests"), filePath);
  }
});

test("every tooling-smoke focused exemption has a feature validation route", () => {
  for (const filePath of FOCUSED_FEATURE_VALIDATION_PATHS) {
    const labels = describePlan(buildValidationPlan("feature", [filePath]));
    assert.ok(
      labels.some((label) => label !== "root typecheck"),
      `${filePath}: ${labels.join(", ")}`,
    );
  }
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
    isDesktopPerfSensitiveSurface(".github/workflows/ci.yml"),
    false,
  );
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
  assert.ok(labels.includes("shared unit tests"));
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

  assert.ok(
    !labels.includes("root build"),
    "the production promotion must not build the separate website lane",
  );
  assert.ok(
    !labels.includes("root typecheck"),
    "the production promotion must not typecheck the separate website lane",
  );
  assert.ok(
    !labels.includes("root lint"),
    "the production promotion must not lint the separate website lane",
  );
  assert.ok(
    !labels.includes("website tests"),
    "the production promotion must not test the separate website lane",
  );

  // The release matrix still owns the real signed Desktop build. Native clippy
  // needs only the frontend context because generate_context! validates the
  // configured dist path at compile time.
  assert.ok(
    !labels.includes("desktop production build"),
    "the desktop build must not be duplicated ahead of the release matrix",
  );
  const frontendContextIndex = labels.indexOf(
    "desktop frontend context build",
  );
  const nativeClippyIndex = labels.indexOf("native rust clippy");
  assert.ok(frontendContextIndex >= 0);
  assert.ok(nativeClippyIndex > frontendContextIndex);

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

test("feature plan for updater manifest changes runs its complete-platform contract", () => {
  const plan = buildValidationPlan("feature", [
    "scripts/generate-tauri-latest-from-release.mjs",
    "scripts/generate-tauri-latest-from-release.test.mjs",
  ]);

  const updaterTests = plan.find(
    (item) => item.label === "updater manifest tests",
  );
  assert.ok(updaterTests);
  assert.deepEqual(updaterTests.args, [
    "--test",
    "scripts/generate-tauri-latest-from-release.test.mjs",
  ]);
});

test("feature plan routes Library Core release activation changes through the focused contract suite", () => {
  const plan = buildValidationPlan("feature", [
    "scripts/lib/library-core-release-activation.mjs",
  ]);
  const command = plan.find(
    (item) => item.label === "Library Core release activation tests",
  );
  const manifestCommand = plan.find(
    (item) => item.label === "Library Core activation manifest validation",
  );

  assert.equal(
    isLibraryCoreReleaseActivationPath(
      "scripts/lib/library-core-release-activation.mjs",
    ),
    true,
  );
  assert.equal(
    isLibraryCoreReleaseActivationPath(
      "docs/library-core-activation-manifest.json",
    ),
    true,
  );
  assert.deepEqual(manifestCommand?.args, [
    "scripts/validate-library-core-activation-manifest.mjs",
  ]);
  assert.deepEqual(command?.args, [
    "--test",
    "scripts/release-receipt.test.mjs",
    "scripts/library-core-release-activation.test.mjs",
    "scripts/lib/git-path-at-ref.test.mjs",
    "scripts/lib/github-release-publications.test.mjs",
    "scripts/lib/library-core-release-activation.test.mjs",
    "scripts/validate-release-identity.test.mjs",
  ]);
});

test("normative Library Core docs and skills route contract and skill validation", () => {
  for (const filePath of [
    ".agents/skills/freed-library-core/SKILL.md",
    "docs/LIBRARY-CORE-CONTRACT.md",
    "docs/STORAGE-ARCHITECTURE-ROADMAP.md",
  ]) {
    assert.equal(isLibraryCoreReleaseActivationPath(filePath), true, filePath);
    const labels = describePlan(buildValidationPlan("feature", [filePath]));
    assert.ok(
      labels.includes("Library Core release activation tests"),
      filePath,
    );
    assert.ok(
      labels.includes("Library Core activation manifest validation"),
      filePath,
    );
    assert.equal(
      labels.includes("skill validation"),
      filePath.startsWith(".agents/skills/"),
      filePath,
    );
  }
});

test("every Freed skill and its validator route focused skill checks", () => {
  for (const filePath of [
    ".agents/skills/freed-provider-risk-review/SKILL.md",
    ".agents/skills/freed-memory-profile/SKILL.md",
    "scripts/validate-skills.mjs",
    "scripts/validate-skills.test.mjs",
  ]) {
    const plan = buildValidationPlan("feature", [filePath]);
    const labels = describePlan(plan);
    assert.ok(labels.includes("skill validation tests"), filePath);
    assert.ok(labels.includes("skill validation"), filePath);
  }
});

test("feature plan routes every Release Publisher surface through its full suite", () => {
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
    "scripts/release-publish.sh",
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
  const publisherTests = [
    "scripts/automation-control-docs.test.mjs",
    "scripts/create-release-github-app.test.mjs",
    "scripts/doctor.test.mjs",
    "scripts/lib/release-tag-publisher.test.mjs",
    "scripts/release-governance.test.mjs",
    "scripts/release-tag-publisher-install.test.mjs",
    "scripts/release-tag-publisher-native.test.mjs",
    "scripts/sync-github-rulesets.test.mjs",
    "scripts/validate-release-tag-authority.test.mjs",
  ];

  for (const filePath of publisherPaths) {
    assert.equal(isReleasePublisherToolingPath(filePath), true, filePath);
    const publisherSuite = buildValidationPlan("feature", [filePath]).find(
      (item) => item.label === "release publisher tests",
    );
    assert.ok(publisherSuite, filePath);
    assert.deepEqual(publisherSuite.args, ["--test", ...publisherTests]);
  }
});

test("feature plan isolates pull request publication from tag publisher host suites", () => {
  for (const filePath of [
    "scripts/worktree-publish.sh",
    "scripts/worktree-publish.test.mjs",
  ]) {
    assert.equal(isPullRequestPublisherToolingPath(filePath), true, filePath);
    assert.equal(isReleasePublisherToolingPath(filePath), false, filePath);
    const plan = buildValidationPlan("feature", [filePath]);
    const pullRequestSuite = plan.find(
      (item) => item.label === "pull request publisher tests",
    );
    assert.deepEqual(pullRequestSuite?.args, [
      "--test",
      "scripts/worktree-publish.test.mjs",
    ]);
    assert.equal(
      plan.some((item) => item.label === "release publisher tests"),
      false,
    );
    assert.equal(
      plan.some((item) => item.label === "release notes shared tests"),
      false,
    );
  }
});

test("collectReleaseArtifactsToValidate resolves markdown artifacts to their json pairs", () => {
  const artifacts = collectReleaseArtifactsToValidate([
    "release-notes/releases/v26.4.1602.md",
  ]);

  assert.deepEqual(artifacts, ["release-notes/releases/v26.4.1602.json"]);
});

test("daily release metadata does not replay the historical release archive", () => {
  const dailyArtifact = ["release-notes", "daily", "dev", "26.7.27.json"].join(
    "/",
  );
  const releaseArtifact = ["release-notes", "releases", "v26.7.2701-dev"].join(
    "/",
  );

  assert.deepEqual(collectReleaseArtifactsToValidate([dailyArtifact]), []);

  assert.deepEqual(
    collectReleaseArtifactsToValidate([
      dailyArtifact,
      `${releaseArtifact}.json`,
      `${releaseArtifact}.md`,
    ]),
    [`${releaseArtifact}.json`],
  );
});

test("feature release prep validates only the changed release artifact", () => {
  const dailyArtifact = ["release-notes", "daily", "dev", "26.7.27.json"].join(
    "/",
  );
  const releaseArtifact = ["release-notes", "releases", "v26.7.2701-dev"].join(
    "/",
  );
  const releaseValidation = buildValidationPlan("feature", [
    dailyArtifact,
    `${releaseArtifact}.json`,
    `${releaseArtifact}.md`,
  ]).find((item) => item.label === "release note artifact validation");

  assert.ok(releaseValidation);
  assert.deepEqual(releaseValidation.files, [`${releaseArtifact}.json`]);
});

test("release identity validation maps changed release JSON and Markdown to one artifact", () => {
  assert.deepEqual(
    collectChangedReleaseIdentityArtifacts([
      "release-notes/releases/v26.7.2800-dev.json",
      "release-notes/releases/v26.7.2800-dev.md",
      "release-notes/daily/26.7.28-dev.json",
      "release-notes/releases/v26.7.2800-dev.json",
    ]),
    ["release-notes/releases/v26.7.2800-dev.json"],
  );
  assert.deepEqual(
    collectChangedReleaseIdentityArtifacts([
      "release-notes/releases/v26.7.2800-dev.md",
    ]),
    ["release-notes/releases/v26.7.2800-dev.json"],
  );
  assert.throws(
    () =>
      releaseIdentityValidationArgsForArtifact(
        "release-notes/releases/not-a-release.json",
        {},
      ),
    /requires a canonical release JSON path/,
  );
});

test("release artifact base inspection distinguishes absence from Git failure", () => {
  assert.equal(
    releaseArtifactExistsAtRef(
      "release-notes/releases/v26.7.2600-dev.json",
      "origin/dev",
      () => ({
        status: 0,
        stdout: "release-notes/releases/v26.7.2600-dev.json\0",
        stderr: "",
      }),
    ),
    true,
  );
  assert.equal(
    releaseArtifactExistsAtRef(
      "release-notes/releases/v26.7.2900-dev.json",
      "origin/dev",
      () => ({
        status: 0,
        stdout: "",
        stderr: "",
      }),
    ),
    false,
  );
  assert.throws(
    () =>
      releaseArtifactExistsAtRef(
        "release-notes/releases/v26.7.2600-dev.json",
        "origin/dev",
        () => ({
          status: 128,
          stdout: "",
          stderr: "repository unavailable",
        }),
      ),
    /repository unavailable/,
  );
});

test("release tag inspection distinguishes unpublished releases from Git failure", () => {
  assert.equal(
    releaseTagExists("v26.8.1003-dev", () => ({
      status: 0,
      stdout: "a\n",
      stderr: "",
    })),
    true,
  );
  assert.equal(
    releaseTagExists("v26.8.1003-dev", () => ({
      status: 1,
      stdout: "",
      stderr: "",
    })),
    false,
  );
  assert.throws(
    () =>
      releaseTagExists("v26.8.1003-dev", () => ({
        status: 128,
        stdout: "",
        stderr: "repository unavailable",
      })),
    /repository unavailable/,
  );
});

test("feature and production plans validate changed release identity directly", () => {
  for (const [mode, artifactPath, dailyPath] of [
    [
      "feature",
      "release-notes/releases/v26.7.2800-dev.json",
      "release-notes/daily/26.7.28-dev.json",
    ],
    [
      "production",
      "release-notes/releases/v26.7.2800.json",
      "release-notes/daily/26.7.28.json",
    ],
  ]) {
    const identityItem = buildValidationPlan(mode, [
      artifactPath,
      dailyPath,
    ]).find((item) => item.label === "release identity validation");
    assert.deepEqual(
      identityItem,
      {
        kind: "release-identity-validation",
        label: "release identity validation",
        files: [artifactPath],
      },
      mode,
    );
  }
});

test("production validation ignores dev release identities copied during promotion", () => {
  const identityItem = buildValidationPlan("production", [
    "release-notes/releases/v26.8.1303-dev.json",
    "release-notes/releases/v26.8.1303-dev.md",
    "release-notes/releases/v26.8.1400.json",
    "release-notes/releases/v26.8.1400.md",
  ]).find((item) => item.label === "release identity validation");

  assert.deepEqual(identityItem, {
    kind: "release-identity-validation",
    label: "release identity validation",
    files: ["release-notes/releases/v26.8.1400.json"],
  });
});

test("release identity execution separates modern releases, historical corrections, and backfills", () => {
  const filePath = "release-notes/releases/v26.7.2800-dev.json";
  const artifact = {
    tag: "v26.7.2800-dev",
    source: { productCommitSha: "a".repeat(40) },
  };
  assert.deepEqual(
    releaseIdentityValidationArgsForArtifact(filePath, artifact),
    [
      "scripts/validate-release-identity.mjs",
      "--tag=v26.7.2800-dev",
      "--head-ref=HEAD",
    ],
  );
  assert.deepEqual(
    releaseIdentityValidationArgsForArtifact(
      "release-notes/releases/v26.7.2800.json",
      {
        tag: "v26.7.2800",
        source: { productCommitSha: "b".repeat(40) },
      },
    ),
    [
      "scripts/validate-release-identity.mjs",
      "--tag=v26.7.2800",
      "--head-ref=HEAD",
    ],
  );

  let execution = null;
  assert.equal(
    executeReleaseIdentityValidation(
      filePath,
      artifact,
      (label, command, args, cwd) => {
        execution = { label, command, args, cwd };
      },
      () => false,
      () => false,
    ),
    true,
  );
  assert.deepEqual(execution, {
    label: `validate identity ${filePath}`,
    command: process.execPath,
    args: [
      "scripts/validate-release-identity.mjs",
      "--tag=v26.7.2800-dev",
      "--head-ref=HEAD",
    ],
    cwd: REPO_ROOT,
  });

  let historicalExecution = null;
  assert.equal(
    executeReleaseIdentityValidation(
      filePath,
      {
        ...artifact,
        source: { receiptMode: "historical-published-tag" },
      },
      (label, command, args, cwd) => {
        historicalExecution = { label, command, args, cwd };
      },
      () => false,
      () => false,
    ),
    true,
  );
  assert.deepEqual(historicalExecution, {
    label: `validate identity ${filePath}`,
    command: process.execPath,
    args: [
      "scripts/validate-release-identity.mjs",
      "--tag=v26.7.2800-dev",
      "--historical-published-tag",
      "--branch-ref=origin/dev",
    ],
    cwd: REPO_ROOT,
  });

  let historicalCorrectionExecution = null;
  assert.equal(
    executeReleaseIdentityValidation(
      filePath,
      artifact,
      (label, command, args, cwd) => {
        historicalCorrectionExecution = { label, command, args, cwd };
      },
      () => true,
      () => true,
    ),
    true,
  );
  assert.deepEqual(historicalCorrectionExecution, {
    label: `validate identity ${filePath}`,
    command: process.execPath,
    args: [
      "scripts/validate-release-identity.mjs",
      "--tag=v26.7.2800-dev",
      "--historical-release-note-correction",
      "--branch-ref=origin/dev",
    ],
    cwd: REPO_ROOT,
  });
});
