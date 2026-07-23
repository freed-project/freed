#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AutomationControlError,
  resolveAutomationStateRoot,
} from "./lib/automation-control.mjs";
import {
  applyAutomationKernelGuardCutover,
  applyAutomationKernelGuardCutoverSupersede,
  planAutomationKernelGuardCutover,
  planAutomationKernelGuardCutoverSupersede,
  readAutomationKernelGuardCutoverPlan,
  readAutomationKernelGuardCutoverSupersedePlan,
  writeAutomationKernelGuardCutoverPlan,
  writeAutomationKernelGuardCutoverSupersedePlan,
} from "./lib/automation-kernel-guard-cutover.mjs";

const __filename = fileURLToPath(import.meta.url);

function usage() {
  return `Usage:
  node scripts/automation-kernel-guard-cutover.mjs plan --task-id <id> --plan-file <absolute-path> [--state-root <path>] [--codex-home <path>] [--repo-root <path>]
  node scripts/automation-kernel-guard-cutover.mjs apply --plan-file <absolute-path> --owner-confirmation-file <absolute-path>
  node scripts/automation-kernel-guard-cutover.mjs plan-supersede --plan-file <absolute-path> --supersede-plan-file <absolute-path>
  node scripts/automation-kernel-guard-cutover.mjs supersede --plan-file <absolute-path> --supersede-plan-file <absolute-path> --owner-confirmation-file <absolute-path>

Both plan commands are read-only. Apply and supersede each require their own
exact private current-task owner confirmation bound to that command's intent.
Neither mutation accepts a lease token.
`;
}

function parseOptions(argv) {
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

function requireOption(options, key, flag) {
  const value = options[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new AutomationControlError(
      "invalid_argument",
      `${flag} is required.`,
    );
  }
  return value;
}

function requireExactOptions(options, allowed) {
  const unexpected = Object.keys(options).find(
    (key) => key !== "help" && !allowed.includes(key),
  );
  if (unexpected !== undefined) {
    throw new AutomationControlError(
      "invalid_argument",
      `Unexpected option: --${unexpected.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
    );
  }
}

function execute(argv) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  if (
    options.help ||
    command === undefined ||
    command === "--help" ||
    command === "-h"
  ) {
    return { help: true };
  }

  if (command === "plan") {
    requireExactOptions(options, [
      "taskId",
      "planFile",
      "stateRoot",
      "codexHome",
      "repoRoot",
    ]);
    const planFile = path.resolve(
      requireOption(options, "planFile", "--plan-file"),
    );
    const plan = planAutomationKernelGuardCutover({
      stateRoot: resolveAutomationStateRoot(options.stateRoot),
      taskId: requireOption(options, "taskId", "--task-id"),
      codexHome: options.codexHome,
      repoRoot: options.repoRoot,
    });
    writeAutomationKernelGuardCutoverPlan(planFile, plan);
    return {
      action: "automation-guard.cutover.plan",
      planFile,
      taskId: plan.taskId,
      intent: plan.intent,
      intentDigest: plan.intentDigest,
      cutoverId: plan.parameters.cutoverId,
    };
  }

  if (command === "apply") {
    requireExactOptions(options, ["planFile", "ownerConfirmationFile"]);
    const planFile = path.resolve(
      requireOption(options, "planFile", "--plan-file"),
    );
    const ownerConfirmationFile = path.resolve(
      requireOption(
        options,
        "ownerConfirmationFile",
        "--owner-confirmation-file",
      ),
    );
    const plan = readAutomationKernelGuardCutoverPlan(planFile);
    return {
      action: "automation-guard.cutover.apply",
      planFile,
      result: applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile,
      }),
    };
  }

  if (command === "plan-supersede") {
    requireExactOptions(options, ["planFile", "supersedePlanFile"]);
    const planFile = path.resolve(
      requireOption(options, "planFile", "--plan-file"),
    );
    const supersedePlanFile = path.resolve(
      requireOption(
        options,
        "supersedePlanFile",
        "--supersede-plan-file",
      ),
    );
    const plan = readAutomationKernelGuardCutoverPlan(planFile);
    const supersedePlan = planAutomationKernelGuardCutoverSupersede({ plan });
    writeAutomationKernelGuardCutoverSupersedePlan(
      supersedePlanFile,
      supersedePlan,
      plan,
    );
    return {
      action: "automation-guard.cutover.supersede.plan",
      planFile,
      supersedePlanFile,
      taskId: supersedePlan.taskId,
      intent: supersedePlan.intent,
      intentDigest: supersedePlan.intentDigest,
      supersedeId: supersedePlan.parameters.supersedeId,
    };
  }

  if (command === "supersede") {
    requireExactOptions(options, [
      "planFile",
      "supersedePlanFile",
      "ownerConfirmationFile",
    ]);
    const planFile = path.resolve(
      requireOption(options, "planFile", "--plan-file"),
    );
    const supersedePlanFile = path.resolve(
      requireOption(
        options,
        "supersedePlanFile",
        "--supersede-plan-file",
      ),
    );
    const ownerConfirmationFile = path.resolve(
      requireOption(
        options,
        "ownerConfirmationFile",
        "--owner-confirmation-file",
      ),
    );
    const plan = readAutomationKernelGuardCutoverPlan(planFile);
    const supersedePlan = readAutomationKernelGuardCutoverSupersedePlan(
      supersedePlanFile,
      plan,
    );
    return {
      action: "automation-guard.cutover.supersede",
      planFile,
      supersedePlanFile,
      result: applyAutomationKernelGuardCutoverSupersede({
        plan,
        supersedePlan,
        ownerConfirmationFile,
      }),
    };
  }

  throw new AutomationControlError(
    "invalid_command",
    `Unknown automation kernel guard cutover command: ${command}`,
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
