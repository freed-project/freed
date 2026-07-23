#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  AutomationControlError,
  resolveAutomationStateRoot,
} from "./lib/automation-control.mjs";
import {
  planOutcomeLedgerRepair,
  repairOutcomeLedger,
} from "./lib/outcome-ledger-repair.mjs";
import { OUTCOME_LEDGER_REPAIR_ACTION } from "./lib/outcome-ledger-repair-contract.mjs";

const __filename = fileURLToPath(import.meta.url);

function usage() {
  return `Usage:
  node scripts/outcome-ledger-repair.mjs plan --task-id <id> --source-digest <sha256> [--state-root <path>]
  node scripts/outcome-ledger-repair.mjs repair --task-id <id> --source-digest <sha256> [--state-root <path>]

The plan command is read-only. The repair command requires an exact live
freed-owner lease for owner-governance in FREED_AUTOMATION_LEASE_TOKEN.
`;
}

function takeOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    if (!flag.startsWith("--")) {
      throw new AutomationControlError(
        "invalid_argument",
        `Unexpected argument: ${flag}`,
      );
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new AutomationControlError(
        "invalid_argument",
        `${flag} requires a value.`,
      );
    }
    const key = flag
      .slice(2)
      .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (Object.hasOwn(options, key)) {
      throw new AutomationControlError(
        "invalid_argument",
        `${flag} may only be provided once.`,
      );
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function required(options, key, flag) {
  const value = options[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new AutomationControlError(
      "invalid_argument",
      `${flag} is required.`,
    );
  }
  return value;
}

function assertExactOptions(options, expected) {
  const unexpected = Object.keys(options).filter(
    (key) => key !== "help" && !expected.includes(key),
  );
  if (unexpected.length > 0) {
    throw new AutomationControlError(
      "invalid_argument",
      `Unexpected option: ${unexpected[0]}`,
    );
  }
}

function execute(argv, env = process.env) {
  const [action, ...rest] = argv;
  const options = takeOptions(rest);
  if (
    options.help ||
    action === undefined ||
    action === "--help" ||
    action === "-h"
  ) {
    return { help: true };
  }
  const stateRoot = resolveAutomationStateRoot(options.stateRoot);
  const taskId = required(options, "taskId", "--task-id");
  const expectedSourceDigest = required(
    options,
    "sourceDigest",
    "--source-digest",
  );
  if (action === "plan") {
    assertExactOptions(options, ["stateRoot", "taskId", "sourceDigest"]);
    return {
      action: "outcome-ledger.plan",
      stateRoot,
      result: planOutcomeLedgerRepair({
        stateRoot,
        taskId,
        expectedSourceDigest,
      }),
    };
  }
  if (action === "repair") {
    assertExactOptions(options, ["stateRoot", "taskId", "sourceDigest"]);
    const leaseToken = env.FREED_AUTOMATION_LEASE_TOKEN;
    if (typeof leaseToken !== "string" || leaseToken.length === 0) {
      throw new AutomationControlError(
        "invalid_argument",
        "FREED_AUTOMATION_LEASE_TOKEN is required.",
      );
    }
    return {
      action: OUTCOME_LEDGER_REPAIR_ACTION,
      stateRoot,
      result: repairOutcomeLedger({
        stateRoot,
        taskId,
        expectedSourceDigest,
        actor: "freed-owner",
        leaseName: "owner-governance",
        leaseToken,
      }),
    };
  }
  throw new AutomationControlError(
    "invalid_command",
    `Unknown outcome ledger repair command: ${action}`,
  );
}

function main() {
  const execution = execute(process.argv.slice(2));
  if (execution.help) {
    process.stdout.write(usage());
    return;
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, schemaVersion: 1, ...execution })}\n`,
  );
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        schemaVersion: 1,
        error: {
          code:
            error instanceof AutomationControlError
              ? error.code
              : "internal_error",
          message: error instanceof Error ? error.message : String(error),
        },
      })}\n`,
    );
    process.exitCode = 1;
  }
}
