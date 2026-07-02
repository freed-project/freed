#!/usr/bin/env node

// Post-merge outcome recorder for the automation loops.
//
// The nightly self-improve planner learns from the outcome ledger. Recording
// used to depend on someone remembering to run a long --record-outcome
// invocation, so the ledger stayed empty. This helper is the short path:
// loops (and worktree-cleanup.sh) call it right after a PR merges.
//
// Usage:
//   node scripts/record-outcome.mjs --id <target-or-task-id> [--kind <kind>] \
//     [--status shipped|validated|blocked|failed] [--pr <number-or-url>] \
//     [--build <version>] [--notes <text>] [--ledger <path>]
//
// The ledger defaults to ~/.freed-automation/outcomes.jsonl (see W1-01 in
// docs/STABILITY-PROGRAM.md); it is created on demand.

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendOutcomeLedger,
  AUTOMATION_STATE_DIR,
} from "./nightly-self-improve.mjs";

const __filename = fileURLToPath(import.meta.url);

function usage() {
  return `Usage:
  node scripts/record-outcome.mjs --id <target-or-task-id> [options]

Options:
  --id <id>          Target id, stability task id (e.g. W1-01), or branch name. Required.
  --kind <kind>      Target kind for the ledger. Defaults to "task".
  --status <status>  shipped, validated, blocked, or failed. Defaults to "shipped".
  --pr <number>      Pull request number or URL.
  --build <version>  Build version the outcome shipped in.
  --notes <text>     Free-form notes.
  --ledger <path>    Ledger file. Defaults to ${path.join(AUTOMATION_STATE_DIR, "outcomes.jsonl")}.
  --help             Show this help.
`;
}

export function parseArgs(argv) {
  const args = {
    id: "",
    kind: "task",
    status: "shipped",
    pr: "",
    build: "",
    notes: "",
    ledger: path.join(AUTOMATION_STATE_DIR, "outcomes.jsonl"),
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--id":
        args.id = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--kind":
        args.kind = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--status":
        args.status = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--pr":
        args.pr = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--build":
        args.build = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--notes":
        args.notes = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--ledger":
        args.ledger = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.help) {
    return args;
  }
  if (!args.id) {
    throw new Error("--id is required.");
  }
  if (!args.ledger) {
    throw new Error("--ledger requires a path.");
  }
  args.ledger = path.resolve(args.ledger);

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const entry = appendOutcomeLedger(args.ledger, {
    id: args.id,
    kind: args.kind,
    outcome: args.status,
    notes: args.notes,
    pr: args.pr,
    build: args.build,
  });
  process.stdout.write(`Recorded ${entry.outcome} outcome for ${entry.id} in ${args.ledger}.\n`);
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(usage());
    process.exitCode = 1;
  }
}
