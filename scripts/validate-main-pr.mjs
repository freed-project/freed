#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROMOTION_BRANCH_PATTERN,
  RELEASE_PREP_BRANCH_PATTERN,
  classifyMainPrFiles,
  ensureRefExists,
  formatFileList,
  listComparisonFiles,
  listPromotionBranchDiffFiles,
} from "./release-promotion-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const GOVERNANCE_BACKPORT_BRANCH_PATTERN =
  /^fix\/main-governance-[a-z0-9._-]+$/;
const GOVERNANCE_BACKPORT_FILES = new Set([
  ".github/CODEOWNERS",
  ".agents/skills/freed-build-feature/SKILL.md",
  ".agents/skills/freed-provider-risk-review/SKILL.md",
  "AGENTS.md",
  "docs/AUTOMATION-CONTROL-PLANE.md",
  "docs/NIGHTLY-SELF-IMPROVE.md",
  "docs/STABILITY-PROGRAM.md",
  "docs/stability-tasks/W1-06-provider-visible-single-source.md",
  "scripts/automation-control.mjs",
  "scripts/automation-control.test.mjs",
  "scripts/lib/automation-control.mjs",
  "scripts/lib/cargo-lock-release.mjs",
  "scripts/lib/node-tooling.sh",
  "scripts/lib/provider-visible-paths.mjs",
  "scripts/lib/provider-visible-paths.test.mjs",
  "scripts/release-promotion.test.mjs",
  "scripts/release-promotion-shared.mjs",
  "scripts/trusted-worktree-publish.sh",
  "scripts/validate-main-backflow.mjs",
  "scripts/validate-main-pr.mjs",
  "scripts/validate-release-promotion.mjs",
  "scripts/worktree-publish.sh",
  "scripts/worktree-publish.test.mjs",
]);

function die(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  console.error(
    "Usage: node scripts/validate-main-pr.mjs [--cwd=<path>] --base-ref=<ref> --head-ref=<ref> --head-branch=<branch>",
  );
}

function filesThatDifferFromDev(files, { cwd, headRef }) {
  return files.filter((filePath) => {
    const result = spawnSync(
      "git",
      ["diff", "--quiet", "origin/dev", headRef, "--", filePath],
      { cwd, encoding: "utf8" },
    );
    if (result.status === 0) return false;
    if (result.status === 1) return true;
    die(
      `Unable to compare ${filePath} with origin/dev: ${result.stderr || result.error?.message || "git diff failed"}`,
    );
  });
}

function requirePromotionHeadOnCurrentBase({ cwd, baseRef, headRef }) {
  const headResult = spawnSync(
    "git",
    ["rev-list", "--parents", "--max-count=1", headRef],
    { cwd, encoding: "utf8" },
  );
  if (headResult.status !== 0) {
    die(
      `Unable to inspect promotion head ${headRef}: ${headResult.stderr || headResult.error?.message || "git rev-list failed"}`,
    );
  }

  const baseResult = spawnSync(
    "git",
    ["rev-parse", "--verify", `${baseRef}^{commit}`],
    { cwd, encoding: "utf8" },
  );
  if (baseResult.status !== 0) {
    die(
      `Unable to resolve promotion base ${baseRef}: ${baseResult.stderr || baseResult.error?.message || "git rev-parse failed"}`,
    );
  }

  const headParts = headResult.stdout.trim().split(/\s+/);
  const baseSha = baseResult.stdout.trim();
  if (headParts.length !== 2 || headParts[1] !== baseSha) {
    die(
      `Promotion PR is stale. ${headRef} must be one commit whose parent is the current ${baseRef} commit ${baseSha}. Recreate the promotion from the current base.`,
    );
  }
}

function parseArgs(argv) {
  const options = {
    cwd: REPO_ROOT,
    baseRef: "",
    headRef: "HEAD",
    headBranch: "",
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--base-ref=")) {
      options.baseRef = arg.slice("--base-ref=".length);
      continue;
    }
    if (arg.startsWith("--cwd=")) {
      options.cwd = path.resolve(arg.slice("--cwd=".length));
      continue;
    }
    if (arg.startsWith("--head-ref=")) {
      options.headRef = arg.slice("--head-ref=".length);
      continue;
    }
    if (arg.startsWith("--head-branch=")) {
      options.headBranch = arg.slice("--head-branch=".length);
      continue;
    }
    die(`Unsupported argument: ${arg}`);
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    process.exit(0);
  }

  if (!options.baseRef || !options.headBranch) {
    usage();
    process.exit(1);
  }

  ensureRefExists(options.baseRef, { cwd: options.cwd });
  ensureRefExists(options.headRef, { cwd: options.cwd });
  ensureRefExists("origin/dev", { cwd: options.cwd });

  const changedFiles = listComparisonFiles({
    baseRef: options.baseRef,
    headRef: options.headRef,
    cwd: options.cwd,
  });

  if (GOVERNANCE_BACKPORT_BRANCH_PATTERN.test(options.headBranch)) {
    const unsupported = changedFiles.filter(
      (filePath) => !GOVERNANCE_BACKPORT_FILES.has(filePath),
    );
    if (unsupported.length > 0) {
      die(
        `Governance backports to main contain unsupported files:\n${formatFileList(unsupported)}`,
      );
    }
    const driftFiles = filesThatDifferFromDev(changedFiles, {
      cwd: options.cwd,
      headRef: options.headRef,
    });
    if (driftFiles.length > 0) {
      die(
        `Governance backport files must exactly match origin/dev:\n${formatFileList(driftFiles)}`,
      );
    }
    console.log("Main PR guard passed. Governance backport matches origin/dev.");
    return;
  }

  const classified = classifyMainPrFiles(changedFiles, {
    baseRef: options.baseRef,
    headRef: options.headRef,
    cwd: options.cwd,
  });

  if (classified.forbidden.length > 0) {
    die(
      `PRs to main cannot include website-owned files:\n${formatFileList(classified.forbidden)}`,
    );
  }

  if (classified.other.length > 0) {
    die(
      `PRs to main may only carry promotion-scope changes or release-only metadata:\n${formatFileList(classified.other)}`,
    );
  }

  if (classified.promotionScoped.length === 0) {
    if (classified.releaseOnly.length === 0) {
      console.log("Main PR guard passed. No promotion-scope changes detected.");
      return;
    }

    if (!RELEASE_PREP_BRANCH_PATTERN.test(options.headBranch)) {
      die(
        `Release-only changes targeting main must come from a branch named chore/release-*. Received ${options.headBranch}.`,
      );
    }

    console.log("Main PR guard passed. Release-only metadata update detected.");
    return;
  }

  if (!PROMOTION_BRANCH_PATTERN.test(options.headBranch)) {
    die(
      `Product changes targeting main must come from a promotion branch named chore/promote-dev-to-main-*. Received ${options.headBranch}.`,
    );
  }

  const driftFiles = listPromotionBranchDiffFiles({
    fromRef: "origin/dev",
    toRef: options.headRef,
    cwd: options.cwd,
  });

  if (driftFiles.length > 0) {
    die(
      `Promotion PR is stale. ${options.headRef} does not match origin/dev on product-owned paths:\n${formatFileList(driftFiles)}`,
    );
  }

  requirePromotionHeadOnCurrentBase({
    cwd: options.cwd,
    baseRef: options.baseRef,
    headRef: options.headRef,
  });

  console.log("Main PR guard passed. Promotion branch matches origin/dev.");
}

main();
