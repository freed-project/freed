#!/usr/bin/env node

import {
  lstatSync,
  openSync,
  closeSync,
  constants,
  fstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHORITY_WITNESS_REPAIR_ACTION,
  AutomationControlError,
  planTaskManifestAuthorityWitnessRepair,
  repairTaskManifestAuthorityWitness,
  resolveAutomationStateRoot,
} from "./lib/automation-control.mjs";

const __filename = fileURLToPath(import.meta.url);
const MAX_PLAN_BYTES = 2 * 1024 * 1024;

function usage() {
  return `Usage:
  node scripts/authority-witness-repair.mjs plan --task-id <id> [--state-root <path>]
  node scripts/authority-witness-repair.mjs repair --task-id <id> --plan-file <path> [--state-root <path>]

The plan command is read-only. Save its JSON output to a private physical file.
The repair command requires an exact live freed-owner lease for owner-governance
in FREED_AUTOMATION_LEASE_TOKEN.
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

function readPrivatePlan(filePath) {
  const resolved = path.resolve(filePath);
  let descriptor;
  try {
    const before = lstatSync(resolved, { bigint: true });
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.uid !== BigInt(process.getuid()) ||
      before.nlink !== 1n ||
      before.size <= 0n ||
      before.size > BigInt(MAX_PLAN_BYTES) ||
      ![0o600, 0o640].includes(Number(before.mode & 0o7777n)) ||
      realpathSync(resolved) !== resolved
    ) {
      throw new Error("file is not one private physical bounded generation");
    }
    descriptor = openSync(
      resolved,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const held = fstatSync(descriptor, { bigint: true });
    if (
      held.dev !== before.dev ||
      held.ino !== before.ino ||
      held.mode !== before.mode ||
      held.size !== before.size
    ) {
      throw new Error("file changed while it was admitted");
    }
    const parsed = JSON.parse(readFileSync(descriptor, "utf8"));
    const after = fstatSync(descriptor, { bigint: true });
    if (
      after.dev !== held.dev ||
      after.ino !== held.ino ||
      after.mode !== held.mode ||
      after.size !== held.size
    ) {
      throw new Error("file changed while it was read");
    }
    return parsed?.result ?? parsed;
  } catch (error) {
    throw new AutomationControlError(
      "invalid_argument",
      "Authority witness repair plan file could not be admitted safely.",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function execute(argv, env = process.env) {
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
  if (action === "plan") {
    assertExactOptions(options, ["stateRoot", "taskId"]);
    return {
      action: "authority-witness.plan",
      stateRoot,
      result: planTaskManifestAuthorityWitnessRepair({ stateRoot, taskId }),
    };
  }
  if (action === "repair") {
    assertExactOptions(options, ["planFile", "stateRoot", "taskId"]);
    const leaseToken = env.FREED_AUTOMATION_LEASE_TOKEN;
    if (typeof leaseToken !== "string" || leaseToken.length === 0) {
      throw new AutomationControlError(
        "invalid_argument",
        "FREED_AUTOMATION_LEASE_TOKEN is required.",
      );
    }
    return {
      action: AUTHORITY_WITNESS_REPAIR_ACTION,
      stateRoot,
      result: repairTaskManifestAuthorityWitness({
        stateRoot,
        taskId,
        plan: readPrivatePlan(required(options, "planFile", "--plan-file")),
        actor: "freed-owner",
        leaseName: "owner-governance",
        leaseToken,
      }),
    };
  }
  throw new AutomationControlError(
    "invalid_command",
    `Unknown authority witness repair command: ${action}`,
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
