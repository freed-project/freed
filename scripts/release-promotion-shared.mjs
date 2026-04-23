import { execFileSync } from "node:child_process";

export const PROMOTION_SCOPE_PATHS = [
  ".agents",
  ".github",
  "docs",
  "packages",
  "scripts",
  "AGENTS.md",
  "package.json",
  "package-lock.json",
  "bunfig.toml",
  "tsconfig.json",
  "tsconfig.base.json",
];

export const RELEASE_ONLY_FILES = [
  "packages/desktop/package.json",
  "packages/desktop/src-tauri/Cargo.toml",
  "packages/desktop/src-tauri/tauri.conf.json",
  "packages/pwa/package.json",
];

export const RELEASE_ONLY_PREFIXES = [
  "release-notes/",
];

export const FORBIDDEN_MAIN_PR_PREFIXES = [
  "website/",
];

export const PROMOTION_BRANCH_PATTERN = /^chore\/promote-dev-to-main(?:-[a-z0-9._-]+)?$/;

function runGit(args, { cwd } = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}

export function splitLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function isReleaseOnlyFile(filePath) {
  return RELEASE_ONLY_FILES.includes(filePath)
    || RELEASE_ONLY_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

export function isPromotionScopeFile(filePath) {
  return PROMOTION_SCOPE_PATHS.some((scopePath) => (
    filePath === scopePath || filePath.startsWith(`${scopePath}/`)
  ));
}

export function listChangedFiles({ fromRef, toRef, cwd, pathspec = [] }) {
  const args = ["diff", "--name-only", toRef, fromRef];
  if (pathspec.length > 0) {
    args.push("--", ...pathspec);
  }
  return uniqueSorted(splitLines(runGit(args, { cwd })));
}

export function listPromotionDiffFiles({ fromRef, toRef, cwd }) {
  return listChangedFiles({
    fromRef,
    toRef,
    cwd,
    pathspec: PROMOTION_SCOPE_PATHS,
  }).filter((filePath) => !isReleaseOnlyFile(filePath));
}

export function listComparisonFiles({ baseRef, headRef, cwd }) {
  return uniqueSorted(splitLines(runGit([
    "diff",
    "--name-only",
    `${baseRef}...${headRef}`,
  ], { cwd })));
}

export function listForbiddenMainPrFiles(files) {
  return files.filter((filePath) => (
    FORBIDDEN_MAIN_PR_PREFIXES.some((prefix) => filePath.startsWith(prefix))
  ));
}

export function formatFileList(files) {
  return files.map((filePath) => `- ${filePath}`).join("\n");
}

export function ensureRefExists(ref, { cwd } = {}) {
  runGit(["rev-parse", "--verify", ref], { cwd });
}

export function classifyMainPrFiles(files) {
  const forbidden = [];
  const promotionScoped = [];
  const releaseOnly = [];
  const other = [];

  for (const filePath of files) {
    if (listForbiddenMainPrFiles([filePath]).length > 0) {
      forbidden.push(filePath);
      continue;
    }

    if (isReleaseOnlyFile(filePath)) {
      releaseOnly.push(filePath);
      continue;
    }

    if (isPromotionScopeFile(filePath)) {
      promotionScoped.push(filePath);
      continue;
    }

    other.push(filePath);
  }

  return {
    forbidden: uniqueSorted(forbidden),
    promotionScoped: uniqueSorted(promotionScoped),
    releaseOnly: uniqueSorted(releaseOnly),
    other: uniqueSorted(other),
  };
}
