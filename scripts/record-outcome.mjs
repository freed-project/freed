#!/usr/bin/env node

// Post-merge outcome recorder for the automation loops.
//
// The nightly self-improve planner learns from the outcome ledger. Recording
// used to depend on someone remembering to run a long --record-outcome
// invocation, so the ledger stayed empty. This helper is the short path:
// governed loops call it after each canonical task milestone.
//
// Usage:
//   node scripts/record-outcome.mjs --id <target-id> --task-id <task-id> [--kind <kind>] \
//     [--status <state>] [--pr <number-or-url>] \
//     [--build <version> --build-commit-sha <sha> --build-channel <channel>] \
//     [--evidence-window-end <iso>] [--evidence-digest <digest>] \
//     [--verdict-reference <verdict-json-path>] --actor <actor> \
//     --lease-name <name> [--lease-token <token>] [--notes <text>] [--ledger <path>]
//
// The ledger defaults to ~/.freed/automation/outcomes.jsonl (see W1-01 in
// docs/STABILITY-PROGRAM.md); it is created on demand.

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendOutcomeLedger,
  AUTOMATION_STATE_DIR,
  OUTCOME_STATUSES,
} from "./nightly-self-improve.mjs";
import { automationControlPaths } from "./lib/automation-control.mjs";

const __filename = fileURLToPath(import.meta.url);

function usage() {
  return `Usage:
  node scripts/record-outcome.mjs --id <target-or-task-id> [options]

Options:
  --id <id>          Target id, stability task id (e.g. W1-01), or branch name. Required.
  --task-id <id>     Canonical control-plane task. Defaults to --id when kind is "task".
  --kind <kind>      Target kind for the ledger. Defaults to "task".
  --status <status>  ${OUTCOME_STATUSES.join(", ")}. Defaults to "merged".
  --pr <number>      Pull request number or URL.
  --build <version>  Installed build version. Valid only for installed outcomes.
  --build-commit-sha <sha>  Installed build's full 40 character commit SHA.
  --build-channel <channel> Installed build channel, dev or production.
  --artifact-digest <sha256> Optional installed artifact SHA-256 digest.
  --evidence-window-end <iso>  End of the evidence window behind this outcome.
  --evidence-digest <digest>   Git or SHA-256 digest for the evidence.
  --verdict-reference <path>   Versioned JSON verdict with exact task, outcome, status, and effect.
  --actor <actor>              Authenticated automation actor.
  --lease-name <name>          Canonical live lease for the actor.
  --lease-token <token>        Token for the canonical live lease. Defaults to FREED_AUTOMATION_LEASE_TOKEN.
  --state-root <path>          Control root. Defaults to ${AUTOMATION_STATE_DIR}.
  --notes <text>     Free-form notes.
  --ledger <path>    Canonical ledger. Must equal <state-root>/outcomes.jsonl.
  --help             Show this help.
`;
}

export function parseArgs(argv) {
  let ledgerProvided = false;
  const args = {
    id: "",
    taskId: "",
    kind: "task",
    status: "merged",
    pr: "",
    build: "",
    buildCommitSha: "",
    buildChannel: "",
    artifactDigest: "",
    notes: "",
    evidenceWindowEnd: "",
    evidenceDigest: "",
    verdictReference: "",
    actor: process.env.FREED_AUTOMATION_ACTOR ?? "",
    leaseName: process.env.FREED_AUTOMATION_LEASE_NAME ?? "",
    leaseToken: process.env.FREED_AUTOMATION_LEASE_TOKEN ?? "",
    stateRoot: process.env.FREED_AUTOMATION_STATE_ROOT ?? AUTOMATION_STATE_DIR,
    ledger: "",
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
      case "--task-id":
        args.taskId = argv[index + 1] ?? "";
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
      case "--build-commit-sha":
        args.buildCommitSha = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--build-channel":
        args.buildChannel = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--artifact-digest":
        args.artifactDigest = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--notes":
        args.notes = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--evidence-window-end":
        args.evidenceWindowEnd = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--evidence-digest":
        args.evidenceDigest = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--verdict-reference":
        args.verdictReference = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--actor":
        args.actor = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--lease-name":
        args.leaseName = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--lease-token":
        args.leaseToken = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--state-root":
        args.stateRoot = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--ledger":
        args.ledger = argv[index + 1] ?? "";
        ledgerProvided = true;
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
  if (!args.taskId && args.kind === "task") {
    args.taskId = args.id;
  }
  if (!args.taskId) {
    throw new Error("--task-id is required for non-task outcome ids.");
  }
  if (!args.stateRoot) {
    throw new Error("--state-root requires a path.");
  }
  if (!OUTCOME_STATUSES.includes(args.status)) {
    throw new Error(`--status must be one of: ${OUTCOME_STATUSES.join(", ")}.`);
  }
  const buildIdentityProvided =
    args.build ||
    args.buildCommitSha ||
    args.buildChannel ||
    args.artifactDigest;
  if (args.status === "installed") {
    if (!args.build || !args.buildCommitSha || !args.buildChannel) {
      throw new Error(
        "Installed outcomes require --build, --build-commit-sha, and --build-channel.",
      );
    }
  } else if (buildIdentityProvided) {
    throw new Error(
      "Build identity flags are valid only for installed outcomes.",
    );
  }
  if (!args.actor || !args.leaseName || !args.leaseToken) {
    throw new Error(
      "Outcome recording requires --actor, --lease-name, and a token from FREED_AUTOMATION_LEASE_TOKEN or --lease-token.",
    );
  }
  if (!args.evidenceDigest && !args.verdictReference) {
    throw new Error(
      "Outcome recording requires --evidence-digest or --verdict-reference.",
    );
  }
  args.stateRoot = path.resolve(args.stateRoot);
  const canonicalLedger = automationControlPaths(args.stateRoot).outcomes;
  if (ledgerProvided && !args.ledger) {
    throw new Error("--ledger requires a path.");
  }
  args.ledger = ledgerProvided ? path.resolve(args.ledger) : canonicalLedger;
  if (args.ledger !== canonicalLedger) {
    throw new Error(
      `--ledger must equal the canonical state-root ledger at ${canonicalLedger}.`,
    );
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const entry = appendOutcomeLedger(
    args.ledger,
    {
      id: args.id,
      taskId: args.taskId,
      kind: args.kind,
      outcome: args.status,
      notes: args.notes,
      pr: args.pr,
      installedIdentity:
        args.status === "installed"
          ? {
              version: args.build,
              commitSha: args.buildCommitSha,
              channel: args.buildChannel,
              ...(args.artifactDigest
                ? { artifactDigest: args.artifactDigest }
                : {}),
            }
          : undefined,
      evidenceWindowEnd: args.evidenceWindowEnd,
      evidenceDigest: args.evidenceDigest,
      verdictReference: args.verdictReference,
    },
    {
      stateRoot: args.stateRoot,
      authentication: {
        actor: args.actor,
        leaseName: args.leaseName,
        leaseToken: args.leaseToken,
      },
    },
  );
  process.stdout.write(
    `Recorded ${entry.outcome} outcome for ${entry.id} in ${args.ledger}.\n`,
  );
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.stderr.write(usage());
    process.exitCode = 1;
  }
}
