#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  AutomationControlError,
  OBSERVER_AUTHORITIES,
  PROVIDER_AUTHORITIES,
  TASK_STATES,
  acquireLease,
  appendControlEvent,
  bindPublisherLeaseHead,
  createTask,
  heartbeatLease,
  inspectLease,
  ownerGovernanceIntentDigest,
  readTask,
  readTaskManifest,
  releaseLease,
  resolveAutomationStateRoot,
  transitionTask,
  updateTaskAuthorities,
} from "./lib/automation-control.mjs";

const __filename = fileURLToPath(import.meta.url);

function usage() {
  return `Usage:
  node scripts/automation-control.mjs task create [options]
  node scripts/automation-control.mjs task list [options]
  node scripts/automation-control.mjs task show [options]
  node scripts/automation-control.mjs task transition [options]
  node scripts/automation-control.mjs task authorize [options]
  node scripts/automation-control.mjs event append [options]
  node scripts/automation-control.mjs owner intent-digest --intent-json <json>
  node scripts/automation-control.mjs lease acquire [options]
  node scripts/automation-control.mjs lease show [options]
  node scripts/automation-control.mjs lease heartbeat [options]
  node scripts/automation-control.mjs lease bind-head [options]
  node scripts/automation-control.mjs lease release [options]

Global options:
  --state-root <path>               State root. Defaults to ~/.freed/automation.

Task options:
  --id <task-id>                    Stable task identifier.
  --actor <name>                    Automation or operator making the change.
  --to <state>                      Destination state for a transition.
  --observer-authority <authority>  ${OBSERVER_AUTHORITIES.join(", ")}.
  --provider-authority <authority>  ${PROVIDER_AUTHORITIES.join(", ")}.
  --expected-revision <number>      Reject a stale task mutation.
  --details-json <json>             Task details object with explicit boolean behavioral.
  --reason <text>                   Authority change reason.
  --approval-reference <text>       Required when provider authority becomes approved.
  --lease-name <name>               Canonical live lease for the actor.
  --lease-token <token>             Short-lived lease token. Defaults to FREED_AUTOMATION_LEASE_TOKEN.

Event options:
  --type <event-type>               Stable event type.
  --actor <name>                    Event producer.
  --task-id <task-id>               Optional related task.
  --data-json <json>                Event data object.

Owner options:
  --intent-json <json>              Canonical task operation to hash for broker approval.

Lease options:
  --name <lease-name>               Stable lease name.
  --owner <name>                    Lease owner.
  --ttl-seconds <number>            Positive lease duration.
  --scope-json <json>               Required target scope for pr-publisher acquisition or head binding.
  --capability-file <path>          One-use signed broker capability for pr-publisher acquisition.
  --owner-capability-file <path>    One-use signed broker capability for freed-owner acquisition.
  --owner-confirmation-file <path> Current-task owner confirmation for one exact freed-owner operation.
  --owner-task-id <task-id>         Exact task bound to the owner authorization.
  --owner-intent-digest <sha256>    Exact canonical governance intent bound to the owner authorization.
  --head-sha <sha>                  Exact commit bound once to the publisher lease.
  Lease mutations require FREED_AUTOMATION_LEASE_OPERATION_ID and read their
  token only from FREED_AUTOMATION_LEASE_TOKEN. Owner acquisition may use the
  existing protected FREED_OWNER_LEASE_TOKEN compatibility variable.
  Lease authority is derived from the checked-in actor policy. It cannot be supplied by the caller.
  General actors acquire leases only through their installed trusted launcher.
  Direct general actor acquisition is rejected.
  freed-pr-publisher requires a broker-signed one-use capability file and does
  not accept a reusable actor credential.
  freed-owner accepts either a root-pinned broker signature or an explicit
  current-task owner confirmation, both bound to one exact task and intent.
  The signed capability also requires FREED_OWNER_LEASE_TOKEN.

All successful commands print one JSON object to stdout. Errors print one JSON object to stderr.
`;
}

function parseJsonObject(raw, flag) {
  if (raw === undefined) {
    return undefined;
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AutomationControlError(
      "invalid_json",
      `${flag} must contain valid JSON.`,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AutomationControlError(
      "invalid_json",
      `${flag} must contain a JSON object.`,
    );
  }
  return value;
}

function parsePositiveInteger(raw, flag) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AutomationControlError(
      "invalid_value",
      `${flag} must be a positive integer.`,
    );
  }
  return value;
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
  if (typeof value !== "string" || value === "") {
    throw new AutomationControlError(
      "invalid_argument",
      `${flag} is required.`,
    );
  }
  return value;
}

function requiredOptionOrEnv(options, key, flag, env, envKey) {
  const value = options[key] ?? env[envKey];
  if (typeof value !== "string" || value === "") {
    throw new AutomationControlError(
      "invalid_argument",
      `${flag} or ${envKey} is required.`,
    );
  }
  return value;
}

function requiredLeaseOperationId(env) {
  const value = env.FREED_AUTOMATION_LEASE_OPERATION_ID;
  if (typeof value !== "string" || value === "") {
    throw new AutomationControlError(
      "invalid_argument",
      "FREED_AUTOMATION_LEASE_OPERATION_ID is required.",
    );
  }
  return value;
}

function requiredLeaseToken(env, { owner = undefined } = {}) {
  const value =
    env.FREED_AUTOMATION_LEASE_TOKEN ??
    (owner === "freed-owner" ? env.FREED_OWNER_LEASE_TOKEN : undefined);
  if (typeof value !== "string" || value === "") {
    throw new AutomationControlError(
      "invalid_argument",
      "FREED_AUTOMATION_LEASE_TOKEN is required.",
    );
  }
  return value;
}

function assertOnlyOptions(options, allowed) {
  const unexpected = Object.keys(options).filter(
    (key) => !allowed.includes(key),
  );
  if (unexpected.length > 0) {
    throw new AutomationControlError(
      "invalid_argument",
      `Unexpected option: --${unexpected[0].replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
    );
  }
}

export function parseCommand(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const [resource, action, ...rest] = argv;
  if (!resource || !action) {
    throw new AutomationControlError(
      "invalid_argument",
      "A resource and action are required.",
    );
  }
  const options = takeOptions(rest);
  return { resource, action, options };
}

export function executeCommand(command, { env = process.env } = {}) {
  if (command.help) {
    return { help: true };
  }
  const { resource, action, options } = command;
  const stateRoot = resolveAutomationStateRoot(options.stateRoot);

  if (resource === "owner" && action === "intent-digest") {
    assertOnlyOptions(options, ["intentJson"]);
    return {
      action: "owner.intent-digest",
      result: {
        intentDigest: ownerGovernanceIntentDigest(
          parseJsonObject(
            required(options, "intentJson", "--intent-json"),
            "--intent-json",
          ),
        ),
      },
    };
  }

  if (resource === "task" && action === "create") {
    assertOnlyOptions(options, [
      "stateRoot",
      "id",
      "actor",
      "observerAuthority",
      "providerAuthority",
      "approvalReference",
      "detailsJson",
      "leaseName",
      "leaseToken",
    ]);
    return {
      action: "task.create",
      stateRoot,
      result: createTask({
        stateRoot,
        taskId: required(options, "id", "--id"),
        actor: required(options, "actor", "--actor"),
        leaseName: required(options, "leaseName", "--lease-name"),
        leaseToken: requiredOptionOrEnv(
          options,
          "leaseToken",
          "--lease-token",
          env,
          "FREED_AUTOMATION_LEASE_TOKEN",
        ),
        observerAuthority: required(
          options,
          "observerAuthority",
          "--observer-authority",
        ),
        providerAuthority: required(
          options,
          "providerAuthority",
          "--provider-authority",
        ),
        approvalReference: options.approvalReference,
        details: parseJsonObject(options.detailsJson, "--details-json") ?? {},
      }),
    };
  }

  if (resource === "task" && action === "list") {
    assertOnlyOptions(options, ["stateRoot", "state"]);
    if (options.state !== undefined && !TASK_STATES.includes(options.state)) {
      throw new AutomationControlError(
        "invalid_value",
        `Unknown task state: ${options.state}`,
      );
    }
    const manifest = readTaskManifest({ stateRoot });
    return {
      action: "task.list",
      stateRoot,
      result: {
        ...manifest,
        tasks:
          options.state === undefined
            ? manifest.tasks
            : manifest.tasks.filter((task) => task.state === options.state),
      },
    };
  }

  if (resource === "task" && action === "show") {
    assertOnlyOptions(options, ["stateRoot", "id"]);
    const taskId = required(options, "id", "--id");
    const task = readTask({ stateRoot, taskId });
    if (!task) {
      throw new AutomationControlError(
        "task_not_found",
        `Task ${taskId} does not exist.`,
      );
    }
    return { action: "task.show", stateRoot, result: task };
  }

  if (resource === "task" && action === "transition") {
    assertOnlyOptions(options, [
      "stateRoot",
      "id",
      "actor",
      "to",
      "expectedRevision",
      "detailsJson",
      "leaseName",
      "leaseToken",
    ]);
    return {
      action: "task.transition",
      stateRoot,
      result: transitionTask({
        stateRoot,
        taskId: required(options, "id", "--id"),
        actor: required(options, "actor", "--actor"),
        leaseName: required(options, "leaseName", "--lease-name"),
        leaseToken: requiredOptionOrEnv(
          options,
          "leaseToken",
          "--lease-token",
          env,
          "FREED_AUTOMATION_LEASE_TOKEN",
        ),
        toState: required(options, "to", "--to"),
        expectedRevision:
          options.expectedRevision === undefined
            ? undefined
            : parsePositiveInteger(
                options.expectedRevision,
                "--expected-revision",
              ),
        details: parseJsonObject(options.detailsJson, "--details-json"),
      }),
    };
  }

  if (resource === "task" && action === "authorize") {
    assertOnlyOptions(options, [
      "stateRoot",
      "id",
      "actor",
      "observerAuthority",
      "providerAuthority",
      "reason",
      "approvalReference",
      "expectedRevision",
      "leaseName",
      "leaseToken",
    ]);
    return {
      action: "task.authorize",
      stateRoot,
      result: updateTaskAuthorities({
        stateRoot,
        taskId: required(options, "id", "--id"),
        actor: required(options, "actor", "--actor"),
        leaseName: required(options, "leaseName", "--lease-name"),
        leaseToken: requiredOptionOrEnv(
          options,
          "leaseToken",
          "--lease-token",
          env,
          "FREED_AUTOMATION_LEASE_TOKEN",
        ),
        observerAuthority: options.observerAuthority,
        providerAuthority: options.providerAuthority,
        reason: required(options, "reason", "--reason"),
        approvalReference: options.approvalReference,
        expectedRevision:
          options.expectedRevision === undefined
            ? undefined
            : parsePositiveInteger(
                options.expectedRevision,
                "--expected-revision",
              ),
      }),
    };
  }

  if (resource === "event" && action === "append") {
    assertOnlyOptions(options, [
      "stateRoot",
      "type",
      "actor",
      "taskId",
      "dataJson",
      "leaseName",
      "leaseToken",
    ]);
    return {
      action: "event.append",
      stateRoot,
      result: appendControlEvent({
        stateRoot,
        type: required(options, "type", "--type"),
        actor: required(options, "actor", "--actor"),
        leaseName: required(options, "leaseName", "--lease-name"),
        leaseToken: requiredOptionOrEnv(
          options,
          "leaseToken",
          "--lease-token",
          env,
          "FREED_AUTOMATION_LEASE_TOKEN",
        ),
        taskId: options.taskId,
        data: parseJsonObject(options.dataJson, "--data-json") ?? {},
      }),
    };
  }

  if (resource === "lease" && action === "acquire") {
    assertOnlyOptions(options, [
      "stateRoot",
      "name",
      "owner",
      "ttlSeconds",
      "scopeJson",
      "capabilityFile",
      "ownerCapabilityFile",
      "ownerConfirmationFile",
      "ownerTaskId",
      "ownerIntentDigest",
    ]);
    const owner = required(options, "owner", "--owner");
    return {
      action: "lease.acquire",
      stateRoot,
      result: acquireLease({
        stateRoot,
        name: required(options, "name", "--name"),
        owner,
        operationId: requiredLeaseOperationId(env),
        ttlMs:
          parsePositiveInteger(
            required(options, "ttlSeconds", "--ttl-seconds"),
            "--ttl-seconds",
          ) * 1_000,
        token: requiredLeaseToken(env, { owner }),
        ownerCapabilityFile: options.ownerCapabilityFile,
        ownerConfirmationFile: options.ownerConfirmationFile,
        ownerCapabilityTaskId: options.ownerTaskId,
        ownerCapabilityIntentDigest: options.ownerIntentDigest,
        publisherCapabilityFile: options.capabilityFile,
        scope: parseJsonObject(options.scopeJson, "--scope-json"),
      }),
    };
  }

  if (resource === "lease" && action === "show") {
    assertOnlyOptions(options, ["stateRoot", "name"]);
    return {
      action: "lease.show",
      stateRoot,
      result: inspectLease({
        stateRoot,
        name: required(options, "name", "--name"),
      }),
    };
  }

  if (resource === "lease" && action === "heartbeat") {
    assertOnlyOptions(options, ["stateRoot", "name", "ttlSeconds"]);
    return {
      action: "lease.heartbeat",
      stateRoot,
      result: heartbeatLease({
        stateRoot,
        name: required(options, "name", "--name"),
        operationId: requiredLeaseOperationId(env),
        token: requiredLeaseToken(env),
        ttlMs:
          options.ttlSeconds === undefined
            ? undefined
            : parsePositiveInteger(options.ttlSeconds, "--ttl-seconds") * 1_000,
      }),
    };
  }

  if (resource === "lease" && action === "bind-head") {
    assertOnlyOptions(options, [
      "stateRoot",
      "name",
      "scopeJson",
      "headSha",
    ]);
    return {
      action: "lease.bind-head",
      stateRoot,
      result: bindPublisherLeaseHead({
        stateRoot,
        name: required(options, "name", "--name"),
        operationId: requiredLeaseOperationId(env),
        token: requiredLeaseToken(env),
        scope: parseJsonObject(
          required(options, "scopeJson", "--scope-json"),
          "--scope-json",
        ),
        headSha: required(options, "headSha", "--head-sha"),
      }),
    };
  }

  if (resource === "lease" && action === "release") {
    assertOnlyOptions(options, ["stateRoot", "name"]);
    return {
      action: "lease.release",
      stateRoot,
      result: releaseLease({
        stateRoot,
        name: required(options, "name", "--name"),
        operationId: requiredLeaseOperationId(env),
        token: requiredLeaseToken(env),
      }),
    };
  }

  throw new AutomationControlError(
    "invalid_command",
    `Unknown command: ${resource} ${action}`,
  );
}

function successPayload(execution) {
  return {
    ok: true,
    schemaVersion: 1,
    ...execution,
  };
}

function errorPayload(error) {
  return {
    ok: false,
    schemaVersion: 1,
    error: {
      code:
        error instanceof AutomationControlError ? error.code : "internal_error",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof AutomationControlError && error.details !== undefined
        ? { details: error.details }
        : {}),
    },
  };
}

function main() {
  const command = parseCommand(process.argv.slice(2));
  const execution = executeCommand(command);
  if (execution.help) {
    process.stdout.write(usage());
    return;
  }
  process.stdout.write(`${JSON.stringify(successPayload(execution))}\n`);
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify(errorPayload(error))}\n`);
    process.exitCode = 1;
  }
}
