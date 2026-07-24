#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildStabilityStatus,
  formatStabilityStatus,
} from "./lib/stability-status.mjs";

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const DEFAULT_STATE_ROOT = path.join(os.homedir(), ".freed", "automation");

function usage() {
  return `Usage:
  node scripts/stability-status.mjs [options]

Options:
  --json                Print only the versioned JSON model.
  --repo-root <path>    Repository root. Defaults to the current checkout.
  --state-root <path>   Automation state root. Defaults to ~/.freed/automation.
  --now <iso>           Fixed observation time for deterministic diagnostics.
  --help                Show this help.
`;
}

export function parseArgs(argv) {
  const args = {
    json: false,
    repoRoot: DEFAULT_REPO_ROOT,
    stateRoot: DEFAULT_STATE_ROOT,
    nowMs: Date.now(),
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") args.json = true;
    else if (arg === "--repo-root") args.repoRoot = argv[++index] ?? "";
    else if (arg === "--state-root") args.stateRoot = argv[++index] ?? "";
    else if (arg === "--now") {
      const value = argv[++index] ?? "";
      args.nowMs = Date.parse(value);
      if (!Number.isFinite(args.nowMs)) {
        throw new Error("--now must be an ISO-8601 timestamp.");
      }
    } else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.repoRoot || !args.stateRoot) {
    throw new Error("--repo-root and --state-root must be nonempty.");
  }
  return args;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const model = buildStabilityStatus({
    repoRoot: path.resolve(args.repoRoot),
    stateRoot: path.resolve(args.stateRoot),
    nowMs: args.nowMs,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(model, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `${formatStabilityStatus(model)}\n\nJSON model\n${JSON.stringify(model, null, 2)}\n`,
  );
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
