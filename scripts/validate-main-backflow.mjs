#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureRefExists,
  formatFileList,
  listMainBackflowDiffFiles,
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
    devRef: "origin/dev",
    mainRef: "origin/main",
    format: "text",
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
    if (arg.startsWith("--dev-ref=")) {
      options.devRef = arg.slice("--dev-ref=".length);
      continue;
    }
    if (arg.startsWith("--main-ref=")) {
      options.mainRef = arg.slice("--main-ref=".length);
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
    "Usage: node scripts/validate-main-backflow.mjs [--cwd=<path>] [--dev-ref=<ref>] [--main-ref=<ref>] [--format=text|json]",
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    process.exit(0);
  }

  ensureRefExists(options.devRef, { cwd: options.cwd });
  ensureRefExists(options.mainRef, { cwd: options.cwd });

  const diffFiles = listMainBackflowDiffFiles({
    devRef: options.devRef,
    mainRef: options.mainRef,
    cwd: options.cwd,
  });
  const payload = {
    ok: diffFiles.length === 0,
    devRef: options.devRef,
    mainRef: options.mainRef,
    diffFiles,
  };

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (payload.ok) {
    console.log(
      `Main backflow is in sync. ${options.mainRef} does not introduce product-owned changes missing from ${options.devRef}.`,
    );
  } else {
    console.error(
      `Dev refresh needed. ${options.mainRef} has product-owned content missing from ${options.devRef}:`,
    );
    console.error(formatFileList(diffFiles));
    console.error("");
    console.error("Reverse integrate main into dev before starting new product work.");
    process.exit(1);
  }

  if (!payload.ok) {
    process.exit(1);
  }
}

main();
