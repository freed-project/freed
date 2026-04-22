#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureRefExists,
  formatFileList,
  listPromotionDiffFiles,
} from "./release-promotion-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function die(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    cwd: REPO_ROOT,
    fromRef: "origin/dev",
    toRef: "origin/main",
    format: "text",
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--from-ref=")) {
      options.fromRef = arg.slice("--from-ref=".length);
      continue;
    }
    if (arg.startsWith("--cwd=")) {
      options.cwd = path.resolve(arg.slice("--cwd=".length));
      continue;
    }
    if (arg.startsWith("--to-ref=")) {
      options.toRef = arg.slice("--to-ref=".length);
      continue;
    }
    if (arg.startsWith("--format=")) {
      options.format = arg.slice("--format=".length);
      continue;
    }
    die(`Unsupported argument: ${arg}`);
  }

  if (!["text", "json"].includes(options.format)) {
    die(`Unsupported format: ${options.format}`);
  }

  return options;
}

function usage() {
  console.error(
    "Usage: node scripts/validate-release-promotion.mjs [--cwd=<path>] [--from-ref=<ref>] [--to-ref=<ref>] [--format=text|json]",
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    process.exit(0);
  }

  ensureRefExists(options.fromRef, { cwd: options.cwd });
  ensureRefExists(options.toRef, { cwd: options.cwd });

  const diffFiles = listPromotionDiffFiles({
    fromRef: options.fromRef,
    toRef: options.toRef,
    cwd: options.cwd,
  });
  const payload = {
    ok: diffFiles.length === 0,
    fromRef: options.fromRef,
    toRef: options.toRef,
    diffFiles,
  };

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (payload.ok) {
    console.log(
      `Release promotion is in sync. ${options.toRef} matches ${options.fromRef} on product-owned paths.`,
    );
  } else {
    console.error(
      `Production release blocked. ${options.toRef} does not match ${options.fromRef} on product-owned paths:`,
    );
    console.error(formatFileList(diffFiles));
    console.error("");
    console.error("Promote dev into main before preparing or publishing a production release.");
    process.exit(1);
  }

  if (!payload.ok) {
    process.exit(1);
  }
}

main();
