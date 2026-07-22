#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  isProviderVisiblePath,
  PROVIDER_VISIBLE_EXTRA_PACKAGE_PREFIXES,
  SOCIAL_PROVIDER_DESKTOP_FILES,
  SOCIAL_PROVIDER_PACKAGE_PREFIXES,
} from "./lib/provider-visible-paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, "..");

const NODE_BIN = process.execPath;
const CARGO_BIN = process.env.CARGO || "cargo";
const RESOLVED_NPM = path.join(
  path.dirname(NODE_BIN),
  process.platform === "win32" ? "npm.cmd" : "npm",
);
const NPM_BIN = existsSync(RESOLVED_NPM)
  ? RESOLVED_NPM
  : process.platform === "win32"
    ? "npm.cmd"
    : "npm";
const VALID_MODES = new Set([
  "feature",
  "providers",
  "dev",
  "production",
  "release",
]);

const RELEASE_TOOLING_PATHS = new Set([
  ".github/workflows/ci.yml",
  ".github/workflows/main-release-validation.yml",
  ".github/workflows/release.yml",
  "scripts/generate-tauri-latest-from-release.mjs",
  "scripts/generate-tauri-latest-from-release.test.mjs",
  "scripts/prepare-release-notes.mjs",
  "scripts/release-governance.test.mjs",
  "scripts/release-publish.sh",
  "scripts/release-notes-shared.mjs",
  "scripts/release-notes-shared.test.mjs",
  "scripts/release.sh",
  "scripts/validate-release-notes.mjs",
]);

const RELEASE_PUBLISHER_TOOLING_PATHS = new Set([
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
  "scripts/release-governance.test.mjs",
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
]);

const RELEASE_PUBLISHER_TEST_FILES = [
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

export function normalizeRepoPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function unique(values) {
  return [...new Set(values)];
}

function usage() {
  return `Usage:
  node scripts/validate-worktree.mjs --mode <feature|providers|dev|production|release> [--plan-only] [--changed-files <file>...]

Modes:
  feature  Run root typecheck plus changed-surface checks derived from git diff or --changed-files.
  providers  Run focused social provider checks for extractor, auth, memory-preflight, and capture-runtime work.
  dev      Run the integration suite used for dev branch pushes and dev builds.
  production  Run the full production validation suite for public release prep.
  release  Compatibility alias for production.

Options:
  --plan-only  Print changed files and planned checks without executing them.
  --plan-labels  Print planned check labels only. Used by CI.
`;
}

export function parseArgs(argv) {
  let mode = "";
  let changedFiles = [];
  let planLabels = false;
  let planOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case "--mode":
        mode = argv[i + 1] ?? "";
        i += 1;
        break;
      case "--changed-files":
        changedFiles = argv.slice(i + 1);
        i = argv.length;
        break;
      case "--plan-labels":
        planLabels = true;
        break;
      case "--plan-only":
        planOnly = true;
        break;
      case "--help":
      case "-h":
        return {
          help: true,
          mode: "",
          changedFiles: [],
          planLabels: false,
          planOnly: false,
        };
      default:
        throw new Error(`Unexpected argument '${arg}'.\n\n${usage()}`);
    }
  }

  if (!VALID_MODES.has(mode)) {
    throw new Error(
      `Error: --mode must be one of feature, providers, dev, production, or release.\n\n${usage()}`,
    );
  }

  return {
    help: false,
    mode,
    changedFiles: changedFiles.map(normalizeRepoPath),
    planLabels,
    planOnly,
  };
}

function execGit(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

function ensureBaseRefExists(baseRef) {
  try {
    execGit(["rev-parse", "--verify", baseRef]);
  } catch {
    throw new Error(
      `Error: could not resolve ${baseRef}. Run git fetch --all --prune first.`,
    );
  }
}

function defaultBaseRefForMode(mode) {
  return mode === "production" || mode === "release"
    ? "origin/main"
    : "origin/dev";
}

export function collectChangedFiles({ mode, changedFiles }) {
  if (changedFiles.length > 0) {
    return unique(changedFiles.map(normalizeRepoPath).filter(Boolean)).sort();
  }

  const baseRef = defaultBaseRefForMode(mode);
  ensureBaseRefExists(baseRef);

  const committedDiff = execGit([
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    `${baseRef}...HEAD`,
  ]);
  const stagedDiff = execGit([
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
  ]);
  const unstagedDiff = execGit([
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
  ]);
  const untrackedDiff = execGit(["ls-files", "--others", "--exclude-standard"]);
  const combinedDiff = [committedDiff, stagedDiff, unstagedDiff, untrackedDiff]
    .filter(Boolean)
    .join("\n");

  if (!combinedDiff) {
    return [];
  }

  return unique(
    combinedDiff.split("\n").map(normalizeRepoPath).filter(Boolean),
  ).sort();
}

export function isWebsiteSurface(filePath) {
  return filePath.startsWith("website/");
}

export function isSharedSurface(filePath) {
  return (
    filePath.startsWith("packages/shared/") ||
    filePath.startsWith("packages/sync/") ||
    filePath.startsWith("packages/ui/")
  );
}

export function isDesktopSurface(filePath) {
  return filePath.startsWith("packages/desktop/");
}

export function isPwaSurface(filePath) {
  return filePath.startsWith("packages/pwa/");
}

export function isDesktopNativeSurface(filePath) {
  return filePath.startsWith("packages/desktop/src-tauri/");
}

// The provider path classification is single-sourced (stability task W1-06).
// Add new provider surfaces in scripts/lib/provider-visible-paths.mjs, not here.

const SOCIAL_PROVIDER_FOCUSED_TEST_FILES = [
  "facebook-extract-script.test.ts",
  "fb-extract-dom.test.ts",
  "facebook-normalize.test.ts",
  "fb-stories-extract.test.ts",
  "fb-groups-extract.test.ts",
  "facebook-groups.test.ts",
  "instagram-normalize.test.ts",
  "ig-stories-extract.test.ts",
  "instagram-dedup.test.ts",
  "memory-monitor-social-preflight.test.ts",
  "provider-health.test.ts",
  "provider-status-transient.test.ts",
  "social-provider-copy.test.ts",
  "social-auth-cookie-state.test.ts",
  "social-capture-memory-pressure.test.ts",
  "social-extract-performance.test.ts",
  "social-scraper-session-order.test.ts",
  "x-capture.test.ts",
  "x-normalize.test.ts",
  "youtube-capture-schema.test.ts",
  "youtube-native-bridge.test.ts",
];

const SOCIAL_PROVIDER_FOCUSED_E2E_FILES = [
  "facebook-capture.spec.ts",
  "instagram-capture.spec.ts",
  "legal-gate.spec.ts",
  "linkedin-capture.spec.ts",
  "social-memory-preflight.spec.ts",
  "x-capture.spec.ts",
  "youtube-capture.spec.ts",
];

const PROVIDER_FOCUSED_PACKAGE_PREFIXES = [
  ...SOCIAL_PROVIDER_PACKAGE_PREFIXES,
  ...PROVIDER_VISIBLE_EXTRA_PACKAGE_PREFIXES.filter((prefix) =>
    prefix.startsWith("packages/capture-"),
  ),
];

const SOCIAL_PROVIDER_FOCUSED_TEST_FILE_SET = new Set(
  SOCIAL_PROVIDER_FOCUSED_TEST_FILES,
);

export function isSocialProviderFocusedSurface(filePath) {
  if (SOCIAL_PROVIDER_DESKTOP_FILES.has(filePath)) {
    return true;
  }

  if (
    filePath.startsWith("packages/desktop/src/lib/") &&
    /\.test\.[cm]?tsx?$/.test(filePath)
  ) {
    return SOCIAL_PROVIDER_FOCUSED_TEST_FILE_SET.has(path.basename(filePath));
  }

  return PROVIDER_FOCUSED_PACKAGE_PREFIXES.some((prefix) =>
    filePath.startsWith(prefix),
  );
}

export function isDesktopPerfSensitiveSurface(filePath) {
  return (
    filePath === ".github/workflows/ci.yml" ||
    filePath === "scripts/perf-compare.ts" ||
    filePath === "packages/desktop/tests/e2e/perf-feed.spec.ts" ||
    filePath === "packages/desktop/tests/e2e/perf-friends.spec.ts" ||
    filePath === "packages/desktop/tests/e2e/perf-map.spec.ts" ||
    filePath === "packages/desktop/tests/e2e/perf-sidebar.spec.ts" ||
    filePath === "packages/desktop/tests/e2e/perf-settings.spec.ts" ||
    filePath === "packages/desktop/tests/e2e/perf-budgets.json" ||
    filePath === "packages/desktop/tests/e2e/perf-baselines.json" ||
    filePath === "packages/desktop/tests/e2e/reporters/perf-reporter.ts" ||
    filePath === "packages/desktop/src/lib/store.ts" ||
    filePath === "packages/desktop/src/lib/automerge.ts" ||
    filePath === "packages/desktop/src/lib/automerge-types.ts" ||
    filePath === "packages/desktop/src/lib/automerge.worker.ts" ||
    filePath === "packages/desktop/src/lib/automerge-persistence.ts" ||
    filePath === "packages/desktop/src/lib/background-runtime-coordinator.ts" ||
    filePath === "packages/desktop/src/lib/memory-monitor.ts" ||
    filePath === "packages/desktop/src/lib/content-fetcher.ts" ||
    filePath === "packages/desktop/src/lib/rss-poller.ts" ||
    filePath.startsWith("packages/desktop/src-tauri/src/") ||
    filePath.startsWith("packages/ui/src/components/feed/") ||
    filePath.startsWith("packages/ui/src/components/friends/") ||
    filePath.startsWith("packages/ui/src/components/layout/") ||
    filePath.startsWith("packages/ui/src/components/map/") ||
    filePath.startsWith("packages/ui/src/components/settings/") ||
    filePath === "packages/ui/src/components/SettingsDialog.tsx" ||
    filePath === "packages/ui/src/lib/friends-workspace.ts" ||
    filePath === "packages/ui/src/lib/account-link-suggestions.ts" ||
    filePath === "packages/ui/src/lib/identity-graph-render.ts" ||
    filePath === "packages/ui/src/lib/identity-graph-layout.ts" ||
    filePath === "packages/ui/src/lib/identity-graph-model.ts" ||
    filePath === "packages/ui/src/hooks/useResolvedLocations.ts" ||
    filePath === "packages/ui/src/hooks/useSearchResults.ts" ||
    filePath === "packages/shared/src/location.ts" ||
    filePath === "packages/shared/src/ranking.ts" ||
    filePath === "packages/shared/src/schema.ts"
  );
}

export function captureWorkspaceForFile(filePath) {
  const match = filePath.match(/^(packages\/capture-[^/]+)/);
  return match ? match[1] : null;
}

export function isPreparedReleaseArtifactPath(filePath) {
  return (
    /^release-notes\/releases\/.+\.(json|md)$/.test(filePath) ||
    /^release-notes\/daily\/.+\.json$/.test(filePath)
  );
}

export function isReleaseToolingPath(filePath) {
  return (
    filePath.startsWith("release-notes/") ||
    RELEASE_TOOLING_PATHS.has(filePath) ||
    RELEASE_PUBLISHER_TOOLING_PATHS.has(filePath)
  );
}

export function isReleasePublisherToolingPath(filePath) {
  return RELEASE_PUBLISHER_TOOLING_PATHS.has(filePath);
}

export function isValidateRunnerPath(filePath) {
  return (
    filePath === "scripts/validate-worktree.mjs" ||
    filePath === "scripts/validate-worktree.test.mjs"
  );
}

export function isSocialScrapeLoopPath(filePath) {
  return (
    filePath === "scripts/social-scrape-loop.mjs" ||
    filePath === "scripts/social-scrape-loop.test.mjs"
  );
}

function workspacePackageJson(workspacePath) {
  return path.join(REPO_ROOT, workspacePath, "package.json");
}

function workspaceHasScript(workspacePath, scriptName) {
  const packagePath = workspacePackageJson(workspacePath);
  if (!existsSync(packagePath)) {
    return false;
  }

  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  return Boolean(pkg.scripts?.[scriptName]);
}

function addCommand(plan, item) {
  if (!plan.some((existing) => existing.label === item.label)) {
    plan.push(item);
  }
}

function commandItem(label, command, args, workspacePath = ".") {
  return {
    kind: "command",
    label,
    command,
    args,
    cwd: path.resolve(REPO_ROOT, workspacePath),
  };
}

function npmCommand(label, args, workspacePath = ".") {
  return commandItem(label, NPM_BIN, args, workspacePath);
}

function nodeCommand(label, args, workspacePath = ".") {
  return commandItem(label, NODE_BIN, args, workspacePath);
}

function cargoCommand(label, args) {
  return commandItem(label, CARGO_BIN, args, "packages/desktop/src-tauri");
}

function desktopUnitFilesCommand(label, files) {
  return npmCommand(
    label,
    ["run", "test:unit", "--", ...files],
    "packages/desktop",
  );
}

function socialProviderFocusedTestsCommand() {
  return desktopUnitFilesCommand(
    "desktop social provider unit tests",
    SOCIAL_PROVIDER_FOCUSED_TEST_FILES,
  );
}

function socialProviderFocusedE2eCommand() {
  return npmCommand(
    "desktop social provider e2e",
    ["run", "test:e2e", "--", ...SOCIAL_PROVIDER_FOCUSED_E2E_FILES],
    "packages/desktop",
  );
}

function pwaTestCommands() {
  return [
    npmCommand("pwa unit tests", ["run", "test:unit"], "packages/pwa"),
    npmCommand(
      "pwa performance tests",
      ["run", "test:perf"],
      "packages/pwa",
    ),
  ];
}

function addCaptureWorkspaceChecks(plan, workspacePath) {
  if (workspaceHasScript(workspacePath, "test")) {
    addCommand(
      plan,
      npmCommand(`${workspacePath} tests`, ["run", "test"], workspacePath),
    );
  }
  const scriptName = workspaceHasScript(workspacePath, "build")
    ? "build"
    : "typecheck";
  addCommand(
    plan,
    npmCommand(
      `${workspacePath} ${scriptName}`,
      ["run", scriptName],
      workspacePath,
    ),
  );
}

function nativeRustChecks() {
  return [
    // Clippy is required now, but existing warnings are not denied until the
    // native monolith gets a dedicated cleanup. A permanent red gate would be
    // theater, not governance.
    cargoCommand("native rust clippy", [
      "clippy",
      "--all-targets",
      "--all-features",
    ]),
    cargoCommand("native rust tests", ["test", "--all-features"]),
  ];
}

function listAllReleaseArtifacts() {
  const releasesDir = path.join(REPO_ROOT, "release-notes", "releases");
  if (!existsSync(releasesDir)) {
    return [];
  }

  return readdirSync(releasesDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) =>
      normalizeRepoPath(path.join("release-notes", "releases", fileName)),
    )
    .sort();
}

export function collectReleaseArtifactsToValidate(
  changedFiles,
  validateAll = false,
) {
  const artifacts = new Set();
  let shouldValidateAll = validateAll;

  for (const filePath of changedFiles) {
    if (/^release-notes\/releases\/.+\.json$/.test(filePath)) {
      artifacts.add(filePath);
      continue;
    }

    if (/^release-notes\/releases\/.+\.md$/.test(filePath)) {
      const jsonPath = filePath.replace(/\.md$/, ".json");
      if (existsSync(path.join(REPO_ROOT, jsonPath))) {
        artifacts.add(jsonPath);
      }
      continue;
    }

    if (/^release-notes\/daily\/.+\.json$/.test(filePath)) {
      shouldValidateAll = true;
    }
  }

  if (shouldValidateAll) {
    for (const artifactPath of listAllReleaseArtifacts()) {
      artifacts.add(artifactPath);
    }
  }

  return [...artifacts].sort();
}

function priorReleaseArtifactsFor(filePath) {
  const absolutePath = path.join(REPO_ROOT, filePath);
  const artifact = JSON.parse(readFileSync(absolutePath, "utf8"));
  const currentTag = artifact.tag;
  const priorTags = artifact.source?.sameDayTagsIncluded ?? [];

  return priorTags
    .filter((tag) => tag && tag !== currentTag)
    .map((tag) =>
      normalizeRepoPath(path.join("release-notes", "releases", `${tag}.json`)),
    )
    .filter((priorPath) => existsSync(path.join(REPO_ROOT, priorPath)));
}

function releaseValidationItem(label, files) {
  return {
    kind: "release-validation",
    label,
    files,
  };
}

export function buildValidationPlan(mode, changedFiles) {
  const normalizedMode = mode === "release" ? "production" : mode;

  if (normalizedMode === "providers") {
    return [
      socialProviderFocusedTestsCommand(),
      socialProviderFocusedE2eCommand(),
    ];
  }

  if (normalizedMode === "dev") {
    return [
      npmCommand("root build", ["run", "build"]),
      npmCommand("root typecheck", ["run", "typecheck"]),
      npmCommand("root lint", ["run", "lint"]),
      npmCommand("website tests", ["run", "test"], "website"),
      ...pwaTestCommands(),
      npmCommand(
        "desktop unit tests",
        ["run", "test:unit"],
        "packages/desktop",
      ),
      npmCommand(
        "desktop e2e smoke",
        ["run", "test:e2e:smoke"],
        "packages/desktop",
      ),
      npmCommand(
        "desktop e2e regression",
        ["run", "test:e2e:regression"],
        "packages/desktop",
      ),
      npmCommand(
        "desktop e2e perf",
        ["run", "test:e2e:perf"],
        "packages/desktop",
      ),
      npmCommand(
        "desktop e2e visual",
        ["run", "test:e2e:visual"],
        "packages/desktop",
      ),
      ...nativeRustChecks(),
    ];
  }

  if (normalizedMode === "production") {
    const plan = [
      ...buildValidationPlan("dev", changedFiles),
      nodeCommand("release notes shared tests", [
        "--test",
        path.join("scripts", "release-notes-shared.test.mjs"),
      ]),
      npmCommand("website production build", ["run", "build"], "website"),
      npmCommand("pwa production build", ["run", "build"], "packages/pwa"),
      npmCommand(
        "desktop production build",
        ["run", "build"],
        "packages/desktop",
      ),
    ];

    const releaseArtifacts = collectReleaseArtifactsToValidate(
      changedFiles,
      changedFiles.length === 0 ||
        changedFiles.some(isPreparedReleaseArtifactPath),
    );

    if (releaseArtifacts.length > 0) {
      plan.push(
        releaseValidationItem(
          "release note artifact validation",
          releaseArtifacts,
        ),
      );
    }

    return plan;
  }

  const plan = [npmCommand("root typecheck", ["run", "typecheck"])];
  const sharedSurfaceChanged = changedFiles.some(isSharedSurface);
  const desktopSurfaceChanged =
    sharedSurfaceChanged || changedFiles.some(isDesktopSurface);
  const desktopNativeSurfaceChanged = changedFiles.some(isDesktopNativeSurface);
  const desktopPerfSensitiveChanged = changedFiles.some(
    isDesktopPerfSensitiveSurface,
  );
  const pwaSurfaceChanged =
    sharedSurfaceChanged || changedFiles.some(isPwaSurface);
  const websiteSurfaceChanged = changedFiles.some(isWebsiteSurface);
  const releaseToolingChanged = changedFiles.some(isReleaseToolingPath);
  const releasePublisherToolingChanged = changedFiles.some(
    isReleasePublisherToolingPath,
  );
  const validateRunnerChanged = changedFiles.some(isValidateRunnerPath);
  const socialScrapeLoopChanged = changedFiles.some(isSocialScrapeLoopPath);
  const captureWorkspaces = unique(
    changedFiles.map(captureWorkspaceForFile).filter(Boolean),
  ).sort();
  const socialProviderOnlyChanged =
    changedFiles.length > 0 &&
    changedFiles.every(isSocialProviderFocusedSurface);
  const providerVisibleChanged = changedFiles.some(isProviderVisiblePath);
  const desktopRustSurfaceChanged = changedFiles.some(
    (filePath) =>
      filePath.startsWith("packages/desktop/src-tauri/") &&
      filePath.endsWith(".rs"),
  );
  const validateRunnerOnlyChanged =
    changedFiles.length > 0 && changedFiles.every(isValidateRunnerPath);
  const socialScrapeLoopOnlyChanged =
    changedFiles.length > 0 && changedFiles.every(isSocialScrapeLoopPath);

  if (validateRunnerOnlyChanged) {
    return [
      nodeCommand("validation runner tests", [
        "--test",
        path.join("scripts", "validate-worktree.test.mjs"),
      ]),
    ];
  }

  if (socialScrapeLoopOnlyChanged) {
    return [
      nodeCommand("social scrape loop tests", [
        "--test",
        path.join("scripts", "social-scrape-loop.test.mjs"),
      ]),
    ];
  }

  if (socialProviderOnlyChanged && !desktopRustSurfaceChanged) {
    addCommand(plan, socialProviderFocusedTestsCommand());
    addCommand(plan, socialProviderFocusedE2eCommand());
    for (const workspacePath of captureWorkspaces) {
      addCaptureWorkspaceChecks(plan, workspacePath);
    }
    addCommand(
      plan,
      npmCommand(
        "desktop production build",
        ["run", "build"],
        "packages/desktop",
      ),
    );
    return plan;
  }

  if (providerVisibleChanged) {
    addCommand(plan, socialProviderFocusedTestsCommand());
    addCommand(plan, socialProviderFocusedE2eCommand());
  }

  if (websiteSurfaceChanged) {
    addCommand(
      plan,
      npmCommand("website production build", ["run", "build"], "website"),
    );
    addCommand(plan, npmCommand("website tests", ["run", "test"], "website"));
  }

  if (pwaSurfaceChanged) {
    addCommand(
      plan,
      npmCommand("pwa production build", ["run", "build"], "packages/pwa"),
    );
    addCommand(
      plan,
      npmCommand("pwa typecheck", ["run", "typecheck"], "packages/pwa"),
    );
    for (const check of pwaTestCommands()) {
      addCommand(plan, check);
    }
  }

  if (desktopSurfaceChanged) {
    addCommand(
      plan,
      npmCommand(
        "desktop unit tests",
        ["run", "test:unit"],
        "packages/desktop",
      ),
    );
    addCommand(
      plan,
      npmCommand(
        "desktop e2e smoke",
        ["run", "test:e2e:smoke"],
        "packages/desktop",
      ),
    );
  }

  if (desktopPerfSensitiveChanged) {
    addCommand(
      plan,
      npmCommand(
        "desktop e2e perf",
        ["run", "test:e2e:perf"],
        "packages/desktop",
      ),
    );
  }

  if (desktopNativeSurfaceChanged) {
    // generate_context! validates the built frontend path at compile time.
    addCommand(
      plan,
      npmCommand(
        "desktop production build",
        ["run", "build"],
        "packages/desktop",
      ),
    );
    for (const check of nativeRustChecks()) {
      addCommand(plan, check);
    }
  }

  if (!sharedSurfaceChanged) {
    for (const workspacePath of captureWorkspaces) {
      addCaptureWorkspaceChecks(plan, workspacePath);
    }
  }

  if (releaseToolingChanged) {
    addCommand(
      plan,
      nodeCommand("release notes shared tests", [
        "--test",
        path.join("scripts", "release-notes-shared.test.mjs"),
      ]),
    );
  }

  if (releasePublisherToolingChanged) {
    addCommand(
      plan,
      nodeCommand("release publisher tests", [
        "--test",
        ...RELEASE_PUBLISHER_TEST_FILES,
      ]),
    );
  }

  if (validateRunnerChanged) {
    addCommand(
      plan,
      nodeCommand("validation runner tests", [
        "--test",
        path.join("scripts", "validate-worktree.test.mjs"),
      ]),
    );
  }

  if (socialScrapeLoopChanged) {
    addCommand(
      plan,
      nodeCommand("social scrape loop tests", [
        "--test",
        path.join("scripts", "social-scrape-loop.test.mjs"),
      ]),
    );
  }

  if (releaseToolingChanged) {
    const releaseArtifacts = collectReleaseArtifactsToValidate(
      changedFiles,
      !changedFiles.some(isPreparedReleaseArtifactPath),
    );
    if (releaseArtifacts.length > 0) {
      plan.push(
        releaseValidationItem(
          "release note artifact validation",
          releaseArtifacts,
        ),
      );
    }
  }

  return plan;
}

function runProcess(label, command, args, cwd = REPO_ROOT) {
  console.log(`\n==> ${label}`);
  console.log(
    `${command} ${args.join(" ")} (cwd: ${path.relative(REPO_ROOT, cwd) || "."})`,
  );

  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.status ?? "unknown"}.`,
    );
  }
}

function runReleaseValidations(files) {
  for (const filePath of files) {
    runProcess(
      `validate ${filePath}`,
      NODE_BIN,
      [
        path.join("scripts", "validate-release-notes.mjs"),
        filePath,
        ...priorReleaseArtifactsFor(filePath),
      ],
      REPO_ROOT,
    );
  }
}

export function describePlan(plan) {
  return plan.map((item) => item.label);
}

export function printValidationPlan({ mode, changedFiles, plan }) {
  console.log(`Mode: ${mode}`);
  if (changedFiles.length > 0) {
    console.log("Changed files:");
    for (const filePath of changedFiles) {
      console.log(`- ${filePath}`);
    }
  } else {
    console.log("Changed files: none detected");
  }

  console.log("\nValidation plan:");
  for (const label of describePlan(plan)) {
    console.log(`- ${label}`);
  }
}

export function runValidationPlan(plan) {
  for (const item of plan) {
    if (item.kind === "command") {
      runProcess(item.label, item.command, item.args, item.cwd);
      continue;
    }

    if (item.kind === "release-validation") {
      console.log(`\n==> ${item.label}`);
      runReleaseValidations(item.files);
      continue;
    }

    throw new Error(`Unsupported plan item kind '${item.kind}'.`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const {
    help,
    mode,
    changedFiles: explicitChangedFiles,
    planLabels,
    planOnly,
  } = parseArgs(argv);
  if (help) {
    console.log(usage());
    return;
  }

  const changedFiles = collectChangedFiles({
    mode,
    changedFiles: explicitChangedFiles,
  });
  const plan = buildValidationPlan(mode, changedFiles);
  if (planLabels) {
    console.log(describePlan(plan).join("\n"));
    return;
  }

  printValidationPlan({ mode, changedFiles, plan });
  if (planOnly) {
    return;
  }

  runValidationPlan(plan);
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedAsScript) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
