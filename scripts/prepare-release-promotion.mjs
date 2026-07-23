#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureRefExists,
  formatFileList,
  listPromotionBranchDiffFiles,
  listPromotionBranchPatchFiles,
} from "./release-promotion-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const MAX_PATCH_BYTES = 512 * 1024 * 1024;

function die(message) {
  console.error(message);
  process.exit(1);
}

function runGit(args, { cwd, encoding = "utf8", env = process.env } = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding,
    env,
    maxBuffer: MAX_PATCH_BYTES,
  });
}

function parseArgs(argv) {
  const options = {
    cwd: REPO_ROOT,
    fromRef: "origin/dev",
    baseRef: "origin/main",
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--cwd=")) {
      options.cwd = path.resolve(arg.slice("--cwd=".length));
      continue;
    }
    if (arg.startsWith("--from-ref=")) {
      options.fromRef = arg.slice("--from-ref=".length);
      continue;
    }
    if (arg.startsWith("--base-ref=")) {
      options.baseRef = arg.slice("--base-ref=".length);
      continue;
    }
    die(`Unsupported argument: ${arg}`);
  }

  return options;
}

function usage() {
  console.error(
    "Usage: node scripts/prepare-release-promotion.mjs [--cwd=<path>] [--from-ref=<ref>] [--base-ref=<ref>]",
  );
}

function ensureCleanBase({ cwd, baseRef }) {
  const status = runGit(["status", "--porcelain=v1", "--untracked-files=normal"], {
    cwd,
  }).trim();
  if (status) {
    die("Promotion preparation requires a clean worktree and index.");
  }

  const headSha = runGit(["rev-parse", "HEAD"], { cwd }).trim();
  const baseSha = runGit(["rev-parse", baseRef], { cwd }).trim();
  if (headSha !== baseSha) {
    die(
      `Promotion preparation requires HEAD ${headSha} to equal ${baseRef} ${baseSha}.`,
    );
  }
}

function promotionPatch({ cwd, fromRef, baseRef, files }) {
  return runGit(
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      baseRef,
      fromRef,
      "--",
      ...files,
    ],
    { cwd, encoding: null },
  );
}

function applyPromotionPatch({ cwd, patch, indexFile = null }) {
  const temporaryIndex = indexFile !== null;
  const env = temporaryIndex
    ? { ...process.env, GIT_INDEX_FILE: indexFile }
    : process.env;

  if (patch.length === 0) {
    die("Promotion preparation found changed paths but produced no patch.");
  }

  const applied = spawnSync(
    "git",
    [
      "apply",
      temporaryIndex ? "--cached" : "--index",
      "--binary",
      "--whitespace=nowarn",
    ],
    {
      cwd,
      env,
      input: patch,
      encoding: "utf8",
      maxBuffer: MAX_PATCH_BYTES,
    },
  );
  if (applied.status !== 0) {
    const detail = (applied.stderr || applied.stdout || "unknown error").trim();
    die(`Promotion snapshot could not be applied: ${detail}`);
  }
}

function verifyPreparedSnapshot({ cwd, fromRef, expectedFiles, indexFile }) {
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  const stagedFiles = runGit(["diff", "--cached", "--name-only", "--no-renames"], {
    cwd,
    env,
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) {
    die(
      `Promotion preparation staged an unexpected path set:\n${formatFileList(stagedFiles)}`,
    );
  }

  const preparedTree = runGit(["write-tree"], { cwd, env }).trim();
  const remaining = listPromotionBranchDiffFiles({
    fromRef,
    toRef: preparedTree,
    cwd,
  });
  if (remaining.length > 0) {
    die(
      `Promotion preparation did not reproduce the source product snapshot:\n${formatFileList(remaining)}`,
    );
  }

  return preparedTree;
}

function prepareInTemporaryIndex({ cwd, fromRef, baseRef, files, patch }) {
  const directory = mkdtempSync(path.join(tmpdir(), "freed-promotion-index-"));
  const indexFile = path.join(directory, "index");
  try {
    const env = { ...process.env, GIT_INDEX_FILE: indexFile };
    runGit(["read-tree", baseRef], { cwd, env });
    applyPromotionPatch({ cwd, patch, indexFile });
    return verifyPreparedSnapshot({
      cwd,
      fromRef,
      expectedFiles: files,
      indexFile,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    process.exit(0);
  }

  ensureRefExists(options.fromRef, { cwd: options.cwd });
  ensureRefExists(options.baseRef, { cwd: options.cwd });
  ensureCleanBase(options);

  const files = listPromotionBranchPatchFiles({
    fromRef: options.fromRef,
    toRef: options.baseRef,
    cwd: options.cwd,
  });
  if (files.length === 0) {
    console.log("The production product snapshot already matches the development source.");
    return;
  }

  const patch = promotionPatch({ ...options, files });
  prepareInTemporaryIndex({ ...options, files, patch });
  ensureCleanBase(options);
  applyPromotionPatch({ cwd: options.cwd, patch });
  console.log(`Prepared ${files.length.toLocaleString()} product paths for promotion.`);
}

main();
