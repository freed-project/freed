import { execFileSync } from "node:child_process";

import {
  CARGO_LOCK_PATH,
  inspectCargoLockReleaseChange,
} from "./lib/cargo-lock-release.mjs";

export const PROMOTION_SCOPE_PATHS = [
  ".agents",
  ".github",
  "docs",
  "packages",
  "scripts",
  ".nvmrc",
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

export const RELEASE_ONLY_PREFIXES = ["release-notes/"];

export const FORBIDDEN_MAIN_PR_PREFIXES = ["website/"];

export const PROMOTION_WEBSITE_CONFIG_FILES = ["website/next.config.ts"];

export const PROMOTION_BRANCH_PATTERN =
  /^chore\/promote-dev-to-main(?:-[a-z0-9._-]+)?$/;
export const RELEASE_PREP_BRANCH_PATTERN = /^chore\/release-[a-z0-9._-]+$/;
export const PROMOTION_COMMIT_SUBJECT_PATTERN =
  /^chore: promote dev (?:into|to) main(?: for production release)?(?: \(#\d+\))?$/;
const HISTORICAL_MAIN_BACKPORT_SUBJECTS = new Set([
  "fix: backport simplified provider approval (#980)",
]);
const HISTORICAL_MAIN_PROMOTION_SUBJECTS = new Set([
  "chore: promote dev into main for cloud conflict recovery (#784)",
  "chore: promote dev into main for PWA sync recovery (#798)",
]);
export const REVERSE_INTEGRATION_COMMIT_SUBJECT_PATTERN =
  /^(?:chore|fix): (?:merge main (?:back )?into dev(?: .*)?|reverse integrate (?:main|v\d+\.\d+\.\d+)(?: into dev| after v\d+\.\d+\.\d+| production release)?|backflow v\d+\.\d+\.\d+ main into dev|sync main(?: release artifacts)?(?: back)? into dev(?: .*)?)(?: \(#\d+\))?$/;

function runGit(args, { cwd } = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}

function tryRunGit(args, { cwd } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function isCargoLockReleaseOnlyChange({ fromRef, toRef, cwd }) {
  return inspectCargoLockReleaseChange({ fromRef, toRef, cwd }).ok;
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
  return (
    RELEASE_ONLY_FILES.includes(filePath) ||
    RELEASE_ONLY_PREFIXES.some((prefix) => filePath.startsWith(prefix))
  );
}

export function isPromotionScopeFile(filePath) {
  if (PROMOTION_WEBSITE_CONFIG_FILES.includes(filePath)) {
    return true;
  }

  return PROMOTION_SCOPE_PATHS.some(
    (scopePath) =>
      filePath === scopePath || filePath.startsWith(`${scopePath}/`),
  );
}

export function listChangedFiles({
  fromRef,
  toRef,
  cwd,
  pathspec = [],
  detectRenames = true,
}) {
  const args = ["diff", "--name-only", toRef, fromRef];
  if (!detectRenames) {
    args.push("--no-renames");
  }
  if (pathspec.length > 0) {
    args.push("--", ...pathspec);
  }
  return uniqueSorted(splitLines(runGit(args, { cwd })));
}

export function listPromotionDiffFiles({ fromRef, toRef, cwd }) {
  const promotionScopeFiles = listChangedFiles({
    fromRef,
    toRef,
    cwd,
    pathspec: PROMOTION_SCOPE_PATHS,
  });
  const websiteConfigFiles = listChangedFiles({
    fromRef,
    toRef,
    cwd,
    pathspec: PROMOTION_WEBSITE_CONFIG_FILES,
  });

  return uniqueSorted([...promotionScopeFiles, ...websiteConfigFiles]).filter(
    (filePath) => {
      if (isReleaseOnlyFile(filePath)) return false;
      if (filePath !== CARGO_LOCK_PATH) return true;
      return !isCargoLockReleaseOnlyChange({ fromRef, toRef, cwd });
    },
  );
}

export function listPromotionBranchDiffFiles({ fromRef, toRef, cwd }) {
  const promotionScopeFiles = listChangedFiles({
    fromRef,
    toRef,
    cwd,
    pathspec: PROMOTION_SCOPE_PATHS,
  });
  const websiteConfigFiles = listChangedFiles({
    fromRef,
    toRef,
    cwd,
    pathspec: PROMOTION_WEBSITE_CONFIG_FILES,
  });
  const releaseNoteFiles = listChangedFiles({
    fromRef,
    toRef,
    cwd,
    pathspec: RELEASE_ONLY_PREFIXES,
  });

  return uniqueSorted([
    ...promotionScopeFiles,
    ...websiteConfigFiles,
    ...releaseNoteFiles,
  ]);
}

export function listPromotionBranchPatchFiles({ fromRef, toRef, cwd }) {
  const promotionScopeFiles = listChangedFiles({
    fromRef,
    toRef,
    cwd,
    pathspec: PROMOTION_SCOPE_PATHS,
    detectRenames: false,
  });
  const websiteConfigFiles = listChangedFiles({
    fromRef,
    toRef,
    cwd,
    pathspec: PROMOTION_WEBSITE_CONFIG_FILES,
    detectRenames: false,
  });
  const releaseNoteFiles = listChangedFiles({
    fromRef,
    toRef,
    cwd,
    pathspec: RELEASE_ONLY_PREFIXES,
    detectRenames: false,
  });

  return uniqueSorted([
    ...promotionScopeFiles,
    ...websiteConfigFiles,
    ...releaseNoteFiles,
  ]);
}

export function listComparisonFiles({ baseRef, headRef, cwd }) {
  return uniqueSorted(
    splitLines(
      runGit(["diff", "--name-only", `${baseRef}...${headRef}`], { cwd }),
    ),
  );
}

function readBlobId(ref, filePath, { cwd } = {}) {
  return tryRunGit(["rev-parse", "--verify", `${ref}:${filePath}`], { cwd });
}

function blobExistsInHistory(ref, filePath, blobId, { cwd } = {}) {
  if (!blobId) return false;

  const commits = splitLines(
    tryRunGit(["log", "--format=%H", ref, "--", filePath], { cwd }) ?? "",
  );
  return commits.some(
    (commit) => readBlobId(commit, filePath, { cwd }) === blobId,
  );
}

function commitIsAncestor(ancestorRef, descendantRef, { cwd } = {}) {
  if (!ancestorRef) return false;
  return (
    tryRunGit(
      ["merge-base", "--is-ancestor", ancestorRef, descendantRef],
      { cwd },
    ) !== null
  );
}

function latestFileCommit(ref, filePath, { cwd } = {}) {
  const value = tryRunGit(
    ["log", "-1", "--format=%H%x00%s", ref, "--", filePath],
    { cwd },
  );
  if (!value) return null;
  const [commit, subject = ""] = value.split("\0");
  return commit ? { commit, subject } : null;
}

function fileStateWasReverseIntegrated(
  ref,
  filePath,
  blobId,
  { cwd } = {},
) {
  const commits = splitLines(
    tryRunGit(["log", "--format=%H%x00%s", ref, "--", filePath], {
      cwd,
    }) ?? "",
  );
  return commits.some((entry) => {
    const [commit, subject = ""] = entry.split("\0");
    return (
      REVERSE_INTEGRATION_COMMIT_SUBJECT_PATTERN.test(subject) &&
      readBlobId(commit, filePath, { cwd }) === blobId
    );
  });
}

export function listMainBackflowDiffFiles({ devRef, mainRef, cwd }) {
  const mainChangedFiles = uniqueSorted(
    splitLines(
      runGit(
        [
          "diff",
          "--name-only",
          devRef,
          mainRef,
          "--",
          ...PROMOTION_SCOPE_PATHS,
        ],
        { cwd },
      ),
    ),
  );

  return mainChangedFiles
    .filter((filePath) => !isReleaseOnlyFile(filePath))
    .filter(
      (filePath) =>
        filePath !== CARGO_LOCK_PATH ||
        !isCargoLockReleaseOnlyChange({
          fromRef: devRef,
          toRef: mainRef,
          cwd,
        }),
    )
    .filter((filePath) => {
      const mainBlobId = readBlobId(mainRef, filePath, { cwd });
      const devBlobId = readBlobId(devRef, filePath, { cwd });
      const mainChange = latestFileCommit(mainRef, filePath, { cwd });

      if (!mainBlobId) {
        if (!mainChange) {
          return false;
        }

        if (commitIsAncestor(mainChange.commit, devRef, { cwd })) {
          return false;
        }

        if (
          fileStateWasReverseIntegrated(devRef, filePath, null, { cwd })
        ) {
          return false;
        }

        return !PROMOTION_COMMIT_SUBJECT_PATTERN.test(mainChange.subject);
      }

      if (mainBlobId === devBlobId) {
        return false;
      }

      if (
        mainChange &&
        commitIsAncestor(mainChange.commit, devRef, { cwd })
      ) {
        return false;
      }

      if (
        mainBlobId &&
        mainChange &&
        (PROMOTION_COMMIT_SUBJECT_PATTERN.test(mainChange.subject) ||
          HISTORICAL_MAIN_PROMOTION_SUBJECTS.has(mainChange.subject) ||
          HISTORICAL_MAIN_BACKPORT_SUBJECTS.has(mainChange.subject)) &&
        blobExistsInHistory(devRef, filePath, mainBlobId, { cwd })
      ) {
        return false;
      }

      if (
        fileStateWasReverseIntegrated(devRef, filePath, mainBlobId, { cwd })
      ) {
        return false;
      }

      return true;
    });
}

export function listForbiddenMainPrFiles(files) {
  return files.filter(
    (filePath) =>
      !PROMOTION_WEBSITE_CONFIG_FILES.includes(filePath) &&
      FORBIDDEN_MAIN_PR_PREFIXES.some((prefix) => filePath.startsWith(prefix)),
  );
}

export function formatFileList(files) {
  return files.map((filePath) => `- ${filePath}`).join("\n");
}

export function ensureRefExists(ref, { cwd } = {}) {
  runGit(["rev-parse", "--verify", ref], { cwd });
}

export function classifyMainPrFiles(
  files,
  { baseRef = null, headRef = null, cwd } = {},
) {
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

    if (
      filePath === CARGO_LOCK_PATH &&
      baseRef &&
      headRef &&
      isCargoLockReleaseOnlyChange({
        fromRef: runGit(["merge-base", baseRef, headRef], { cwd }),
        toRef: headRef,
        cwd,
      })
    ) {
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
