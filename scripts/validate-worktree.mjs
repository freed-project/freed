#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, "..");

const NODE_BIN = process.execPath;
const RESOLVED_NPM = path.join(
  path.dirname(NODE_BIN),
  process.platform === "win32" ? "npm.cmd" : "npm",
);
const NPM_BIN = existsSync(RESOLVED_NPM) ? RESOLVED_NPM : process.platform === "win32" ? "npm.cmd" : "npm";
const VALID_MODES = new Set(["feature", "dev", "release"]);

const RELEASE_TOOLING_PATHS = new Set([
  ".github/workflows/release.yml",
  "scripts/prepare-release-notes.mjs",
  "scripts/release-publish.sh",
  "scripts/release-notes-shared.mjs",
  "scripts/release-notes-shared.test.mjs",
  "scripts/release.sh",
  "scripts/validate-release-notes.mjs",
]);

export function normalizeRepoPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function unique(values) {
  return [...new Set(values)];
}

function usage() {
  return `Usage:
  node scripts/validate-worktree.mjs --mode <feature|dev|release> [--changed-files <file>...]

Modes:
  feature  Run root typecheck plus changed-surface checks derived from git diff or --changed-files.
  dev      Run the full integration validation suite used for dev branch pushes.
  release  Run the dev suite, release-tooling tests, and release-build checks for release prep.
`;
}

export function parseArgs(argv) {
  let mode = "";
  let changedFiles = [];

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
      case "--help":
      case "-h":
        return { help: true, mode: "", changedFiles: [] };
      default:
        throw new Error(`Unexpected argument '${arg}'.\n\n${usage()}`);
    }
  }

  if (!VALID_MODES.has(mode)) {
    throw new Error(`Error: --mode must be one of feature, dev, or release.\n\n${usage()}`);
  }

  return { help: false, mode, changedFiles: changedFiles.map(normalizeRepoPath) };
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
    throw new Error(`Error: could not resolve ${baseRef}. Run git fetch --all --prune first.`);
  }
}

function defaultBaseRefForMode(mode) {
  return mode === "release" ? "origin/main" : "origin/dev";
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
  const stagedDiff = execGit(["diff", "--cached", "--name-only", "--diff-filter=ACDMRTUXB"]);
  const unstagedDiff = execGit(["diff", "--name-only", "--diff-filter=ACDMRTUXB"]);
  const untrackedDiff = execGit(["ls-files", "--others", "--exclude-standard"]);
  const combinedDiff = [committedDiff, stagedDiff, unstagedDiff, untrackedDiff]
    .filter(Boolean)
    .join("\n");

  if (!combinedDiff) {
    return [];
  }

  return unique(combinedDiff.split("\n").map(normalizeRepoPath).filter(Boolean)).sort();
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
  return filePath.startsWith("release-notes/") || RELEASE_TOOLING_PATHS.has(filePath);
}

export function isValidateRunnerPath(filePath) {
  return (
    filePath === "scripts/validate-worktree.mjs" ||
    filePath === "scripts/validate-worktree.test.mjs"
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

function npmCommand(label, args) {
  return {
    kind: "command",
    label,
    command: NPM_BIN,
    args,
  };
}

function nodeCommand(label, args) {
  return {
    kind: "command",
    label,
    command: NODE_BIN,
    args,
  };
}

function listAllReleaseArtifacts() {
  const releasesDir = path.join(REPO_ROOT, "release-notes", "releases");
  if (!existsSync(releasesDir)) {
    return [];
  }

  return readdirSync(releasesDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => normalizeRepoPath(path.join("release-notes", "releases", fileName)))
    .sort();
}

export function collectReleaseArtifactsToValidate(changedFiles, validateAll = false) {
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
    .map((tag) => normalizeRepoPath(path.join("release-notes", "releases", `${tag}.json`)))
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
  if (mode === "dev") {
    return [
      npmCommand("root build", ["run", "build"]),
      npmCommand("root typecheck", ["run", "typecheck"]),
      npmCommand("root lint", ["run", "lint"]),
      npmCommand("website tests", ["run", "test", "--workspace=website"]),
      npmCommand("pwa unit tests", ["run", "test:unit", "--workspace=packages/pwa"]),
      npmCommand("desktop unit tests", ["run", "test:unit", "--workspace=packages/desktop"]),
      npmCommand("desktop e2e", ["run", "test:e2e", "--workspace=packages/desktop"]),
    ];
  }

  if (mode === "release") {
    const plan = [
      ...buildValidationPlan("dev", changedFiles),
      nodeCommand("release notes shared tests", [
        "--test",
        path.join("scripts", "release-notes-shared.test.mjs"),
      ]),
      npmCommand("website production build", ["run", "build", "--workspace=website"]),
      npmCommand("pwa production build", ["run", "build", "--workspace=packages/pwa"]),
      npmCommand("desktop production build", ["run", "build", "--workspace=packages/desktop"]),
    ];

    const releaseArtifacts = collectReleaseArtifactsToValidate(
      changedFiles,
      changedFiles.length === 0 || changedFiles.some(isPreparedReleaseArtifactPath),
    );

    if (releaseArtifacts.length > 0) {
      plan.push(releaseValidationItem("release note artifact validation", releaseArtifacts));
    }

    return plan;
  }

  const plan = [npmCommand("root typecheck", ["run", "typecheck"])];
  const sharedSurfaceChanged = changedFiles.some(isSharedSurface);
  const desktopSurfaceChanged = sharedSurfaceChanged || changedFiles.some(isDesktopSurface);
  const pwaSurfaceChanged = sharedSurfaceChanged || changedFiles.some(isPwaSurface);
  const websiteSurfaceChanged = changedFiles.some(isWebsiteSurface);
  const releaseToolingChanged = changedFiles.some(isReleaseToolingPath);
  const validateRunnerChanged = changedFiles.some(isValidateRunnerPath);
  const captureWorkspaces = unique(
    changedFiles.map(captureWorkspaceForFile).filter(Boolean),
  ).sort();

  if (websiteSurfaceChanged) {
    addCommand(plan, npmCommand("website production build", ["run", "build", "--workspace=website"]));
    addCommand(plan, npmCommand("website tests", ["run", "test", "--workspace=website"]));
  }

  if (pwaSurfaceChanged) {
    addCommand(plan, npmCommand("pwa production build", ["run", "build", "--workspace=packages/pwa"]));
    addCommand(plan, npmCommand("pwa typecheck", ["run", "typecheck", "--workspace=packages/pwa"]));
    addCommand(plan, npmCommand("pwa unit tests", ["run", "test:unit", "--workspace=packages/pwa"]));
  }

  if (desktopSurfaceChanged) {
    addCommand(plan, npmCommand("desktop unit tests", ["run", "test:unit", "--workspace=packages/desktop"]));
    addCommand(plan, npmCommand("desktop e2e", ["run", "test:e2e", "--workspace=packages/desktop"]));
  }

  if (!sharedSurfaceChanged) {
    for (const workspacePath of captureWorkspaces) {
      const scriptName = workspaceHasScript(workspacePath, "build") ? "build" : "typecheck";
      addCommand(
        plan,
        npmCommand(`${workspacePath} ${scriptName}`, [
          "run",
          scriptName,
          "--workspace",
          workspacePath,
        ]),
      );
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

  if (validateRunnerChanged) {
    addCommand(
      plan,
      nodeCommand("validation runner tests", [
        "--test",
        path.join("scripts", "validate-worktree.test.mjs"),
      ]),
    );
  }

  if (releaseToolingChanged) {
    const releaseArtifacts = collectReleaseArtifactsToValidate(
      changedFiles,
      !changedFiles.some(isPreparedReleaseArtifactPath),
    );
    if (releaseArtifacts.length > 0) {
      plan.push(releaseValidationItem("release note artifact validation", releaseArtifacts));
    }
  }

  return plan;
}

function runProcess(label, command, args) {
  console.log(`\n==> ${label}`);
  console.log(`${command} ${args.join(" ")}`);

  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function runReleaseValidations(files) {
  for (const filePath of files) {
    runProcess(`validate ${filePath}`, NODE_BIN, [
      path.join("scripts", "validate-release-notes.mjs"),
      filePath,
      ...priorReleaseArtifactsFor(filePath),
    ]);
  }
}

export function describePlan(plan) {
  return plan.map((item) => item.label);
}

export function runValidationPlan(plan) {
  for (const item of plan) {
    if (item.kind === "command") {
      runProcess(item.label, item.command, item.args);
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
  const { help, mode, changedFiles: explicitChangedFiles } = parseArgs(argv);
  if (help) {
    console.log(usage());
    return;
  }

  const changedFiles = collectChangedFiles({ mode, changedFiles: explicitChangedFiles });
  console.log(`Mode: ${mode}`);
  if (changedFiles.length > 0) {
    console.log("Changed files:");
    for (const filePath of changedFiles) {
      console.log(`- ${filePath}`);
    }
  } else {
    console.log("Changed files: none detected");
  }

  const plan = buildValidationPlan(mode, changedFiles);
  console.log("\nValidation plan:");
  for (const label of describePlan(plan)) {
    console.log(`- ${label}`);
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
