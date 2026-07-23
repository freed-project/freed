#!/usr/bin/env node

// Canonical outcome recorder for the automation control plane.
//
// Non-owner actors may record directly with their canonical actor lease. The
// owner path is deliberately two-stage. First, plan the exact composite
// operation without mutating state. Then acquire one owner-governance lease
// bound to that plan and apply the plan from a private canonical file.

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendOutcomeLedger,
  AUTOMATION_STATE_DIR,
  OUTCOME_STATUSES,
  planOutcomeRecord,
} from "./nightly-self-improve.mjs";
import { automationControlPaths } from "./lib/automation-control.mjs";

const __filename = fileURLToPath(import.meta.url);
const OUTCOME_PLAN_MAX_BYTES = 8 * 1024 * 1024;
const outcomePlanDecoder = new TextDecoder("utf-8", { fatal: true });

function usage() {
  return `Usage:
  node scripts/record-outcome.mjs plan --id <target-or-task-id> [options]
  FREED_AUTOMATION_LEASE_TOKEN=<token> node scripts/record-outcome.mjs apply --plan <private-plan.json>
  FREED_AUTOMATION_LEASE_TOKEN=<token> node scripts/record-outcome.mjs --id <target-or-task-id> [options]

The plan command is read-only. The apply command derives every outcome field
from the exact private plan and always uses freed-owner with owner-governance.
Direct mode is available only to non-owner automation actors.

Options for plan and direct mode:
  --id <id>          Target id, stability task id, or branch name. Required.
  --task-id <id>     Canonical control-plane task. Defaults to --id for kind task.
  --kind <kind>      Target kind for the ledger. Defaults to task.
  --status <status>  ${OUTCOME_STATUSES.join(", ")}. Defaults to merged.
  --pr <number>      Pull request number or URL.
  --build <version>  Installed build version. Valid only for installed outcomes.
  --build-commit-sha <sha>  Installed build's full 40 character commit SHA.
  --build-channel <channel> Installed build channel, dev or production.
  --artifact-digest <sha256> Optional installed artifact SHA-256 digest.
  --evidence-window-end <iso> End of the evidence window behind this outcome.
  --evidence-digest <digest> Git or SHA-256 digest for the evidence.
  --verdict-reference <path> Versioned JSON verdict for a verification outcome.
  --state-root <path> Control root. Defaults to ${AUTOMATION_STATE_DIR}.
  --notes <text>     Free-form notes.
  --ledger <path>    Canonical ledger. Must equal <state-root>/outcomes.jsonl.

Direct mode only:
  --actor <actor>       Authenticated non-owner automation actor.
  --lease-name <name>   Canonical live lease for that actor.

Apply mode only:
  --plan <path>      Absolute private canonical plan file with mode 0600.

  --help             Show this help.
`;
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseApplyArgs(argv) {
  const args = { command: "apply", plan: "", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--lease-token") {
      throw new Error(
        "--lease-token is forbidden. Use FREED_AUTOMATION_LEASE_TOKEN.",
      );
    }
    if (arg !== "--plan") {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (args.plan) {
      throw new Error("--plan may only be provided once.");
    }
    args.plan = takeValue(argv, index, arg);
    index += 1;
  }
  if (!args.help && !args.plan) {
    throw new Error("--plan is required.");
  }
  return args;
}

export function parseArgs(argv, env = process.env) {
  let command = "record";
  let rest = argv;
  if (["plan", "apply", "record"].includes(argv[0])) {
    command = argv[0];
    rest = argv.slice(1);
  }
  if (command === "apply") {
    return parseApplyArgs(rest);
  }

  let ledgerProvided = false;
  let actorProvided = false;
  let leaseNameProvided = false;
  const args = {
    command,
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
    actor: command === "record" ? (env.FREED_AUTOMATION_ACTOR ?? "") : "",
    leaseName:
      command === "record" ? (env.FREED_AUTOMATION_LEASE_NAME ?? "") : "",
    leaseToken:
      command === "record" ? (env.FREED_AUTOMATION_LEASE_TOKEN ?? "") : "",
    stateRoot: env.FREED_AUTOMATION_STATE_ROOT ?? AUTOMATION_STATE_DIR,
    ledger: "",
    help: false,
  };
  const valueFlags = new Set([
    "--actor",
    "--artifact-digest",
    "--build",
    "--build-channel",
    "--build-commit-sha",
    "--evidence-digest",
    "--evidence-window-end",
    "--id",
    "--kind",
    "--lease-name",
    "--ledger",
    "--notes",
    "--pr",
    "--state-root",
    "--status",
    "--task-id",
    "--verdict-reference",
  ]);

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--lease-token") {
      throw new Error(
        "--lease-token is forbidden. Use FREED_AUTOMATION_LEASE_TOKEN.",
      );
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (!valueFlags.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = takeValue(rest, index, arg);
    switch (arg) {
      case "--id":
        args.id = value;
        break;
      case "--kind":
        args.kind = value;
        break;
      case "--task-id":
        args.taskId = value;
        break;
      case "--status":
        args.status = value;
        break;
      case "--pr":
        args.pr = value;
        break;
      case "--build":
        args.build = value;
        break;
      case "--build-commit-sha":
        args.buildCommitSha = value;
        break;
      case "--build-channel":
        args.buildChannel = value;
        break;
      case "--artifact-digest":
        args.artifactDigest = value;
        break;
      case "--notes":
        args.notes = value;
        break;
      case "--evidence-window-end":
        args.evidenceWindowEnd = value;
        break;
      case "--evidence-digest":
        args.evidenceDigest = value;
        break;
      case "--verdict-reference":
        args.verdictReference = value;
        break;
      case "--actor":
        args.actor = value;
        actorProvided = true;
        break;
      case "--lease-name":
        args.leaseName = value;
        leaseNameProvided = true;
        break;
      case "--state-root":
        args.stateRoot = value;
        break;
      case "--ledger":
        args.ledger = value;
        ledgerProvided = true;
        break;
    }
    index += 1;
  }

  if (args.help) {
    return args;
  }
  if (command === "plan" && (actorProvided || leaseNameProvided)) {
    throw new Error("Owner planning does not accept actor or lease options.");
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
  if (command === "record") {
    if (args.actor === "freed-owner") {
      throw new Error(
        "freed-owner outcome recording requires the plan and apply commands.",
      );
    }
    if (!args.actor || !args.leaseName || !args.leaseToken) {
      throw new Error(
        "Direct outcome recording requires --actor, --lease-name, and FREED_AUTOMATION_LEASE_TOKEN.",
      );
    }
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

function outcomeEntryFromArgs(args) {
  return {
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
  };
}

function privatePlanFile(planPath) {
  if (!path.isAbsolute(planPath) || path.resolve(planPath) !== planPath) {
    throw new Error("--plan must be an absolute canonical path.");
  }
  let canonicalPath;
  try {
    canonicalPath = realpathSync(planPath);
  } catch {
    throw new Error("Outcome plan file does not resolve.");
  }
  if (canonicalPath !== planPath) {
    throw new Error(
      "Outcome plan file must be canonical and must not be a symlink.",
    );
  }
  const expectedUid =
    typeof process.getuid === "function" ? process.getuid() : null;
  let descriptor;
  try {
    const before = lstatSync(planPath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      (expectedUid !== null && before.uid !== expectedUid) ||
      (before.mode & 0o7777) !== 0o600 ||
      before.size > OUTCOME_PLAN_MAX_BYTES
    ) {
      throw new Error("Outcome plan file must be a private 0600 regular file.");
    }
    if (
      typeof constants.O_NOFOLLOW !== "number" ||
      typeof constants.O_NONBLOCK !== "number"
    ) {
      throw new Error("Safe outcome plan file admission is unavailable.");
    }
    descriptor = openSync(
      planPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      (expectedUid !== null && opened.uid !== expectedUid) ||
      (opened.mode & 0o7777) !== 0o600 ||
      opened.size !== before.size ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size > OUTCOME_PLAN_MAX_BYTES
    ) {
      throw new Error("Outcome plan file changed during safe admission.");
    }
    const bytes = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count === 0) break;
      offset += count;
    }
    const afterOpen = fstatSync(descriptor);
    const afterPath = lstatSync(planPath);
    if (
      offset !== opened.size ||
      afterOpen.size !== opened.size ||
      afterOpen.dev !== opened.dev ||
      afterOpen.ino !== opened.ino ||
      afterPath.size !== opened.size ||
      afterPath.dev !== opened.dev ||
      afterPath.ino !== opened.ino ||
      realpathSync(planPath) !== planPath
    ) {
      throw new Error("Outcome plan file changed while it was read.");
    }
    const text = outcomePlanDecoder.decode(bytes.subarray(0, offset));
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Outcome plan file must contain one valid JSON value.");
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function outcomeEntryFromPlan(plan) {
  const cleanEntry = plan?.cleanEntry;
  if (
    !cleanEntry ||
    typeof cleanEntry !== "object" ||
    Array.isArray(cleanEntry)
  ) {
    throw new Error("Outcome plan is missing its canonical ledger row.");
  }
  return {
    id: cleanEntry.id,
    taskId: cleanEntry.taskId,
    kind: cleanEntry.kind,
    outcome: cleanEntry.outcome,
    notes: cleanEntry.notes,
    pr: cleanEntry.pr,
    runDir: cleanEntry.runDir,
    installedIdentity:
      cleanEntry.outcome === "installed" ? cleanEntry.buildIdentity : undefined,
    evidenceWindowEnd: cleanEntry.evidenceWindowEnd,
    evidenceDigest: cleanEntry.evidence?.digest,
    verdictReference: cleanEntry.evidence?.verdictReference,
    verdictFingerprint: cleanEntry.evidence?.verdictFingerprint,
  };
}

function execute(argv, env = process.env) {
  const args = parseArgs(argv, env);
  if (args.help) return { action: "help" };
  if (args.command === "plan") {
    return {
      action: "plan",
      result: planOutcomeRecord(args.ledger, outcomeEntryFromArgs(args), {
        stateRoot: args.stateRoot,
      }),
    };
  }
  if (args.command === "apply") {
    const leaseToken = env.FREED_AUTOMATION_LEASE_TOKEN;
    if (typeof leaseToken !== "string" || leaseToken.length === 0) {
      throw new Error("FREED_AUTOMATION_LEASE_TOKEN is required.");
    }
    const plan = privatePlanFile(args.plan);
    const stateRoot = plan?.intent?.parameters?.stateRoot;
    const ledgerPath = plan?.intent?.parameters?.ledgerPath;
    return {
      action: "apply",
      ledger: ledgerPath,
      result: appendOutcomeLedger(ledgerPath, outcomeEntryFromPlan(plan), {
        stateRoot,
        now: new Date(),
        ownerPlan: plan,
        authentication: {
          actor: "freed-owner",
          leaseName: "owner-governance",
          leaseToken,
        },
      }),
    };
  }
  return {
    action: "record",
    ledger: args.ledger,
    result: appendOutcomeLedger(args.ledger, outcomeEntryFromArgs(args), {
      stateRoot: args.stateRoot,
      authentication: {
        actor: args.actor,
        leaseName: args.leaseName,
        leaseToken: args.leaseToken,
      },
    }),
  };
}

function main() {
  const execution = execute(process.argv.slice(2));
  if (execution.action === "help") {
    process.stdout.write(usage());
    return;
  }
  if (execution.action === "plan") {
    process.stdout.write(`${JSON.stringify(execution.result)}\n`);
    return;
  }
  process.stdout.write(
    `Recorded ${execution.result.outcome} outcome for ${execution.result.id} in ${execution.ledger}.\n`,
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
