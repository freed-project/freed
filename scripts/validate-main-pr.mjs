#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROMOTION_BRANCH_PATTERN,
  classifyMainPrFiles,
  ensureRefExists,
  formatFileList,
  listComparisonFiles,
  listPromotionDiffFiles,
} from "./release-promotion-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function die(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  console.error(
    "Usage: node scripts/validate-main-pr.mjs [--cwd=<path>] --base-ref=<ref> --head-ref=<ref> --head-branch=<branch>",
  );
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
  const classified = classifyMainPrFiles(changedFiles);

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

    console.log("Main PR guard passed. Release-only metadata update detected.");
    return;
  }

  if (!PROMOTION_BRANCH_PATTERN.test(options.headBranch)) {
    die(
      `Product changes targeting main must come from a promotion branch named chore/promote-dev-to-main-*. Received ${options.headBranch}.`,
    );
  }

  const driftFiles = listPromotionDiffFiles({
    fromRef: "origin/dev",
    toRef: options.headRef,
    cwd: options.cwd,
  });

  if (driftFiles.length > 0) {
    die(
      `Promotion PR is stale. ${options.headRef} does not match origin/dev on product-owned paths:\n${formatFileList(driftFiles)}`,
    );
  }

  console.log("Main PR guard passed. Promotion branch matches origin/dev.");
}

main();
