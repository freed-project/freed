import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createHash,
  createPublicKey,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";

export const AUTOMATION_CONTROL_SCHEMA_VERSION = 1;
export const PUBLISH_SCOPE_SCHEMA_VERSION = 2;
export const PUBLISHER_CAPABILITY_SCHEMA_VERSION = 1;
export const OWNER_CAPABILITY_SCHEMA_VERSION = 1;
const OUTCOME_LEDGER_SCHEMA_VERSION = 3;
export const DEFAULT_AUTOMATION_STATE_ROOT = path.join(
  os.homedir(),
  ".freed",
  "automation",
);

export const TASK_STATES = Object.freeze([
  "observed",
  "triaged",
  "approved_for_pr",
  "implemented",
  "validated",
  "merged",
  "installed",
  "soaking",
  "verified_effective",
  "verified_neutral",
  "regressed",
  "inconclusive",
  "governance_blocked",
  "superseded",
  "implementation_failed",
  "closed",
]);
const VERIFICATION_TASK_STATES = new Set([
  "verified_effective",
  "verified_neutral",
  "regressed",
  "inconclusive",
]);
const COMPLETED_BEHAVIOR_TASK_STATES = new Set([
  "verified_effective",
  "verified_neutral",
  "regressed",
]);
const ACTIVE_BEHAVIOR_TASK_STATES = new Set([
  "approved_for_pr",
  "implemented",
  "validated",
  "merged",
  "installed",
  "soaking",
  "inconclusive",
  "governance_blocked",
]);
const RESERVED_CONTROL_EVENT_TYPES = new Set(["outcome_recorded"]);

export const OBSERVER_AUTHORITIES = Object.freeze([
  "observe-only",
  "plan-only",
  "pr-only",
  "merge-safe",
]);

export const PROVIDER_AUTHORITIES = Object.freeze([
  "forbidden",
  "approval-required",
  "approved",
]);

const GENERAL_ACTOR_LEASE_MAX_LIFETIME_MS = 30 * 60 * 1_000;

export const AUTOMATION_ACTOR_POLICIES = Object.freeze({
  "freed-runtime-observer": Object.freeze({
    leaseName: "runtime-observer",
    observerAuthority: "observe-only",
    providerAuthority: "forbidden",
    maxLeaseLifetimeMs: GENERAL_ACTOR_LEASE_MAX_LIFETIME_MS,
    canCreateTask: true,
    canAppendEvent: true,
    destinations: Object.freeze([]),
  }),
  "freed-stability-controller": Object.freeze({
    leaseName: "stability-controller",
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    maxLeaseLifetimeMs: GENERAL_ACTOR_LEASE_MAX_LIFETIME_MS,
    canCreateTask: true,
    canAppendEvent: true,
    destinations: Object.freeze([
      "triaged",
      "approved_for_pr",
      "governance_blocked",
      "superseded",
      "closed",
    ]),
  }),
  "freed-scaffolding-maintainer": Object.freeze({
    leaseName: "scaffolding-writer",
    observerAuthority: "pr-only",
    providerAuthority: "forbidden",
    maxLeaseLifetimeMs: GENERAL_ACTOR_LEASE_MAX_LIFETIME_MS,
    canCreateTask: true,
    canAppendEvent: true,
    destinations: Object.freeze([
      "implemented",
      "validated",
      "implementation_failed",
      "governance_blocked",
    ]),
  }),
  "freed-pr-publisher": Object.freeze({
    leaseName: "pr-publisher",
    observerAuthority: "pr-only",
    providerAuthority: "approval-required",
    canCreateTask: false,
    canAppendEvent: true,
    destinations: Object.freeze([]),
  }),
  "freed-nightly-runner": Object.freeze({
    leaseName: "nightly-writer",
    observerAuthority: "merge-safe",
    providerAuthority: "approval-required",
    maxLeaseLifetimeMs: GENERAL_ACTOR_LEASE_MAX_LIFETIME_MS,
    canCreateTask: false,
    canAppendEvent: true,
    destinations: Object.freeze([
      "triaged",
      "approved_for_pr",
      "implemented",
      "validated",
      "merged",
      "installed",
      "soaking",
      "governance_blocked",
      "superseded",
      "implementation_failed",
    ]),
  }),
  "freed-release-verifier": Object.freeze({
    leaseName: "release-verifier",
    observerAuthority: "observe-only",
    providerAuthority: "forbidden",
    maxLeaseLifetimeMs: GENERAL_ACTOR_LEASE_MAX_LIFETIME_MS,
    canCreateTask: false,
    canAppendEvent: true,
    destinations: Object.freeze([
      "verified_effective",
      "verified_neutral",
      "regressed",
      "inconclusive",
    ]),
  }),
  "freed-owner": Object.freeze({
    leaseName: "owner-governance",
    observerAuthority: "merge-safe",
    providerAuthority: "approved",
    canCreateTask: true,
    canAppendEvent: true,
    destinations: TASK_STATES,
  }),
});

const TASK_TRANSITIONS = Object.freeze({
  observed: Object.freeze(["triaged", "governance_blocked", "superseded"]),
  triaged: Object.freeze([
    "approved_for_pr",
    "governance_blocked",
    "superseded",
  ]),
  approved_for_pr: Object.freeze([
    "implemented",
    "governance_blocked",
    "superseded",
  ]),
  implemented: Object.freeze([
    "validated",
    "governance_blocked",
    "superseded",
    "implementation_failed",
  ]),
  validated: Object.freeze(["merged", "governance_blocked", "superseded"]),
  merged: Object.freeze(["installed", "governance_blocked", "superseded"]),
  installed: Object.freeze(["soaking", "governance_blocked", "superseded"]),
  soaking: Object.freeze([
    "verified_effective",
    "verified_neutral",
    "regressed",
    "inconclusive",
    "governance_blocked",
    "superseded",
  ]),
  verified_effective: Object.freeze(["closed"]),
  verified_neutral: Object.freeze(["triaged", "superseded"]),
  regressed: Object.freeze(["triaged"]),
  inconclusive: Object.freeze([
    "soaking",
    "triaged",
    "governance_blocked",
    "superseded",
  ]),
  governance_blocked: Object.freeze(["triaged", "superseded", "closed"]),
  superseded: Object.freeze(["closed"]),
  implementation_failed: Object.freeze([
    "triaged",
    "governance_blocked",
    "superseded",
  ]),
  closed: Object.freeze(["triaged"]),
});

const TASK_AUTHORITY_RANK = Object.freeze({
  "observe-only": 0,
  "plan-only": 1,
  "pr-only": 2,
  "merge-safe": 3,
});

const TRANSITION_AUTHORITY_REQUIREMENTS = Object.freeze({
  observed: "observe-only",
  triaged: "plan-only",
  approved_for_pr: "plan-only",
  implemented: "pr-only",
  validated: "pr-only",
  merged: "merge-safe",
  installed: "merge-safe",
  soaking: "merge-safe",
  verified_effective: "observe-only",
  verified_neutral: "observe-only",
  regressed: "observe-only",
  inconclusive: "observe-only",
  governance_blocked: "plan-only",
  superseded: "plan-only",
  implementation_failed: "pr-only",
  closed: "plan-only",
});

const LEGACY_OBSERVER_AUTHORITY_ALIASES = Object.freeze({
  release: "merge-safe",
});

const INTERNAL_GUARD_STALE_MS = 30_000;
const INTERNAL_GUARD_TIMEOUT_MS = 5_000;
const INTERNAL_GUARD_POLL_MS = 10;
const ORPHAN_LEASE_GRACE_MS = 5 * 60 * 1_000;
const OWNER_LEASE_MAX_LIFETIME_MS = 15 * 60 * 1_000;
const OWNER_CAPABILITY_LIFETIME_MS = 60 * 1_000;
const OWNER_CAPABILITY_CLOCK_SKEW_MS = 30 * 1_000;
const OWNER_CAPABILITY_PURPOSE = "owner-governance-capability";
const OWNER_CAPABILITY_ISSUER = "trusted-publisher-host";
const OWNER_TRUST_CONFIG_PATH =
  "/Library/Application Support/Freed/trusted-publisher-host.json";
const PUBLISHER_LEASE_MAX_LIFETIME_MS = 30 * 60 * 1_000;
const PUBLISHER_CAPABILITY_LIFETIME_MS = 60 * 1_000;
const PUBLISHER_CAPABILITY_CLOCK_SKEW_MS = 30 * 1_000;
const PUBLISHER_CAPABILITY_PURPOSE = "publisher-capability-signing";
const ACTOR_CREDENTIAL_PURPOSE = "automation-actor-lease";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class AutomationControlError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "AutomationControlError";
    this.code = code;
    this.details = details;
  }
}

function nowIso(nowMs) {
  return new Date(nowMs).toISOString();
}

function requireIdentifier(value, field) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new AutomationControlError(
      "invalid_identifier",
      `${field} must start with a letter or number and contain only letters, numbers, period, colon, underscore, or hyphen.`,
      { field },
    );
  }
  return value;
}

function requireNonemptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AutomationControlError(
      "invalid_value",
      `${field} must be a nonempty string.`,
      {
        field,
      },
    );
  }
  return value.trim();
}

function requirePlainObject(value, field) {
  if (value === undefined) {
    return {};
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AutomationControlError(
      "invalid_value",
      `${field} must be a JSON object.`,
      {
        field,
      },
    );
  }
  return structuredClone(value);
}

export function normalizeInstalledBuildIdentity(
  value,
  field = "installedIdentity",
) {
  const identity = requirePlainObject(value, field);
  const version = String(identity.version ?? "")
    .trim()
    .replace(/^v/i, "");
  const commitSha = String(identity.commitSha ?? "")
    .trim()
    .toLowerCase();
  const channel = String(identity.channel ?? "").trim();
  const artifactDigest = String(identity.artifactDigest ?? "")
    .trim()
    .toLowerCase();
  if (
    !version ||
    !/^[0-9a-f]{40}$/.test(commitSha) ||
    !["dev", "production"].includes(channel) ||
    (artifactDigest && !/^[0-9a-f]{64}$/.test(artifactDigest))
  ) {
    throw new AutomationControlError(
      "invalid_installed_identity",
      `${field} requires version, full 40 character commit SHA, dev or production channel, and an optional SHA-256 artifact digest.`,
      { field },
    );
  }
  return {
    version,
    commitSha,
    channel,
    ...(artifactDigest ? { artifactDigest } : {}),
  };
}

function taskBehavioralClassification(task) {
  if (typeof task?.behavioral === "boolean") {
    return task.behavioral;
  }
  return typeof task?.details?.behavioral === "boolean"
    ? task.details.behavioral
    : undefined;
}

function taskHoldsBehaviorSlot(task) {
  return (
    ACTIVE_BEHAVIOR_TASK_STATES.has(task?.state) ||
    task?.pendingOutcome !== undefined
  );
}

function requireIsoTimestamp(value, field) {
  const normalized = requireNonemptyString(value, field);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new AutomationControlError(
      "invalid_value",
      `${field} must be a valid timestamp.`,
      {
        field,
      },
    );
  }
  return normalized;
}

function requireEnum(value, values, field) {
  if (!values.includes(value)) {
    throw new AutomationControlError(
      "invalid_value",
      `${field} must be one of: ${values.join(", ")}.`,
      { field, value },
    );
  }
  return value;
}

function actorPolicy(actor) {
  const normalizedActor = requireNonemptyString(actor, "actor");
  const policy = AUTOMATION_ACTOR_POLICIES[normalizedActor];
  if (!policy) {
    throw new AutomationControlError(
      "actor_not_authorized",
      `Actor ${normalizedActor} has no checked-in automation policy.`,
      { actor: normalizedActor },
    );
  }
  return policy;
}

function normalizeStoredObserverAuthority(value) {
  return LEGACY_OBSERVER_AUTHORITY_ALIASES[value] ?? value;
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AutomationControlError(
      "invalid_value",
      `${field} must be a positive integer.`,
      {
        field,
        value,
      },
    );
  }
  return value;
}

function waitSync(ms) {
  const signal = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  );
  Atomics.wait(signal, 0, 0, ms);
}

function readJsonFile(filePath, { allowMissing = false } = {}) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new AutomationControlError(
        "invalid_state",
        `State file contains invalid JSON: ${filePath}`,
      );
    }
    throw error;
  }
}

function syncDirectory(directoryPath) {
  let directoryFd;
  try {
    directoryFd = openSync(directoryPath, "r");
    fsyncSync(directoryFd);
  } catch {
    // Directory fsync is not supported on every platform. The file itself is
    // still synced before rename, which preserves the atomic replacement.
  } finally {
    if (directoryFd !== undefined) {
      closeSync(directoryFd);
    }
  }
}

export function writeJsonAtomic(filePath, value) {
  const directoryPath = path.dirname(filePath);
  mkdirSync(directoryPath, { recursive: true });
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const data = `${JSON.stringify(value, null, 2)}\n`;
  let fileFd;

  try {
    fileFd = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(fileFd, data, "utf8");
    fsyncSync(fileFd);
    closeSync(fileFd);
    fileFd = undefined;
    renameSync(temporaryPath, filePath);
    syncDirectory(directoryPath);
  } catch (error) {
    if (fileFd !== undefined) {
      closeSync(fileFd);
    }
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function resolveAutomationStateRoot(stateRoot = undefined) {
  const configured =
    stateRoot ??
    process.env.FREED_AUTOMATION_STATE_ROOT ??
    DEFAULT_AUTOMATION_STATE_ROOT;
  return path.resolve(configured.replace(/^~(?=$|\/)/, os.homedir()));
}

export function automationControlPaths(stateRoot = undefined) {
  const root = resolveAutomationStateRoot(stateRoot);
  const controlRoot = path.join(root, "control");
  return {
    stateRoot: root,
    outcomes: path.join(root, "outcomes.jsonl"),
    controlRoot,
    taskManifest: path.join(controlRoot, "current-tasks.json"),
    taskTransactions: path.join(controlRoot, "task-transactions"),
    events: path.join(controlRoot, "events.jsonl"),
    leases: path.join(controlRoot, "leases"),
    guards: path.join(controlRoot, ".guards"),
    actorCredentials: path.join(controlRoot, "actor-credentials"),
    ownerCapabilities: path.join(controlRoot, "owner-capabilities"),
    ownerCapabilitiesPending: path.join(
      controlRoot,
      "owner-capabilities",
      "pending",
    ),
    ownerCapabilitiesConsumed: path.join(
      controlRoot,
      "owner-capabilities",
      "consumed",
    ),
    publisherCapabilities: path.join(controlRoot, "publisher-capabilities"),
    publisherCapabilitiesPending: path.join(
      controlRoot,
      "publisher-capabilities",
      "pending",
    ),
    publisherCapabilitiesConsumed: path.join(
      controlRoot,
      "publisher-capabilities",
      "consumed",
    ),
  };
}

function ensurePrivateDirectory(directoryPath) {
  mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  const stats = lstatSync(directoryPath);
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : stats.uid;
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid
  ) {
    throw new AutomationControlError(
      "invalid_state_permissions",
      `Automation state directory ${directoryPath} must be a real directory owned by the current user.`,
    );
  }
  if ((stats.mode & 0o777) !== 0o700) {
    chmodSync(directoryPath, 0o700);
  }
}

function requirePrivateDirectory(directoryPath, label) {
  let stats;
  try {
    stats = lstatSync(directoryPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new AutomationControlError(
        "invalid_state_permissions",
        `${label} does not exist.`,
      );
    }
    throw error;
  }
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : stats.uid;
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid ||
    (stats.mode & 0o777) !== 0o700
  ) {
    throw new AutomationControlError(
      "invalid_state_permissions",
      `${label} must be a private physical directory owned by the current user.`,
    );
  }
}

function guardPathFor(paths, name) {
  return path.join(
    paths.guards,
    `${requireIdentifier(name, "guard name")}.lock`,
  );
}

function guardAgeMs(guardPath, nowMs) {
  try {
    return Math.max(0, nowMs - statSync(guardPath).mtimeMs);
  } catch {
    return 0;
  }
}

export function processStartIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const closeParen = stat.lastIndexOf(")");
      if (closeParen < 0) return null;
      const fields = stat
        .slice(closeParen + 2)
        .trim()
        .split(/\s+/);
      const startTicks = fields[19];
      return /^[0-9]+$/.test(startTicks ?? "") ? `linux:${startTicks}` : null;
    }
    if (process.platform === "darwin") {
      const value = execFileSync(
        "/bin/ps",
        ["-p", String(pid), "-o", "lstart="],
        {
          encoding: "utf8",
          env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
      return value === "" ? null : `darwin:${value}`;
    }
  } catch {
    return null;
  }
  return null;
}

function processIsLive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function guardOwnerIsLive(ownerRecord) {
  if (
    ownerRecord?.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    !Number.isSafeInteger(ownerRecord?.pid) ||
    ownerRecord.pid <= 0 ||
    !Object.hasOwn(ownerRecord, "processStartIdentity") ||
    !(
      ownerRecord.processStartIdentity === null ||
      typeof ownerRecord.processStartIdentity === "string"
    )
  ) {
    return false;
  }
  const currentIdentity = processStartIdentity(ownerRecord.pid);
  if (
    typeof ownerRecord.processStartIdentity === "string" &&
    currentIdentity !== null
  ) {
    return currentIdentity === ownerRecord.processStartIdentity;
  }
  return processIsLive(ownerRecord.pid);
}

function withFilesystemGuard(
  paths,
  name,
  callback,
  {
    now = () => Date.now(),
    timeoutMs = INTERNAL_GUARD_TIMEOUT_MS,
    staleMs = INTERNAL_GUARD_STALE_MS,
  } = {},
) {
  ensurePrivateDirectory(paths.guards);
  const guardPath = guardPathFor(paths, name);
  const startedAt = Date.now();
  const owner = `${process.pid}:${randomUUID()}`;
  const startIdentity = processStartIdentity(process.pid);

  while (true) {
    try {
      mkdirSync(guardPath);
      try {
        writeJsonAtomic(path.join(guardPath, "owner.json"), {
          schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
          owner,
          pid: process.pid,
          processStartIdentity: startIdentity,
          acquiredAt: nowIso(now()),
        });
      } catch (error) {
        rmSync(guardPath, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      const nowMs = now();
      if (guardAgeMs(guardPath, nowMs) >= staleMs) {
        let currentOwner = null;
        try {
          currentOwner = readJsonFile(path.join(guardPath, "owner.json"), {
            allowMissing: true,
          });
        } catch {
          currentOwner = null;
        }
        if (guardOwnerIsLive(currentOwner)) {
          if (Date.now() - startedAt >= timeoutMs) {
            throw new AutomationControlError(
              "guard_timeout",
              `Timed out waiting for the live ${name} control-plane guard owner.`,
            );
          }
          waitSync(INTERNAL_GUARD_POLL_MS);
          continue;
        }
        const abandonedPath = `${guardPath}.abandoned.${randomUUID()}`;
        try {
          renameSync(guardPath, abandonedPath);
          rmSync(abandonedPath, { recursive: true, force: true });
          continue;
        } catch (takeoverError) {
          if (
            !["ENOENT", "EEXIST", "ENOTEMPTY"].includes(takeoverError?.code)
          ) {
            throw takeoverError;
          }
        }
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new AutomationControlError(
          "guard_timeout",
          `Timed out waiting for the ${name} control-plane guard.`,
        );
      }
      waitSync(INTERNAL_GUARD_POLL_MS);
    }
  }

  try {
    return callback();
  } finally {
    let ownerRecord = null;
    try {
      ownerRecord = readJsonFile(path.join(guardPath, "owner.json"), {
        allowMissing: true,
      });
    } catch {
      // A corrupt guard must not hide the operation's result. Its short stale
      // timeout will make it recoverable by the next caller.
    }
    if (ownerRecord?.owner === owner) {
      rmSync(guardPath, { recursive: true, force: true });
    }
  }
}

function emptyTaskManifest(nowMs) {
  return {
    schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
    revision: 0,
    updatedAt: nowIso(nowMs),
    tasks: [],
  };
}

function validateTaskManifest(manifest) {
  if (
    manifest?.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    !Number.isSafeInteger(manifest?.revision) ||
    manifest.revision < 0 ||
    !Array.isArray(manifest?.tasks)
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "The current task manifest has an unsupported shape.",
    );
  }

  const taskIds = new Set();
  for (const task of manifest.tasks) {
    let behavioralConflict = false;
    let installedIdentityValid = true;
    if (task && typeof task === "object") {
      task.observerAuthority = normalizeStoredObserverAuthority(
        task.observerAuthority,
      );
      behavioralConflict =
        typeof task.behavioral === "boolean" &&
        typeof task.details?.behavioral === "boolean" &&
        task.behavioral !== task.details.behavioral;
      const behavioral = taskBehavioralClassification(task);
      if (typeof behavioral === "boolean") {
        task.behavioral = behavioral;
        if (
          task.details !== null &&
          typeof task.details === "object" &&
          !Array.isArray(task.details)
        ) {
          task.details.behavioral = behavioral;
        }
      }
      if (task.installedIdentity !== undefined) {
        try {
          const normalizedIdentity = normalizeInstalledBuildIdentity(
            task.installedIdentity,
          );
          installedIdentityValid =
            JSON.stringify(normalizedIdentity) ===
              JSON.stringify(task.installedIdentity) &&
            (task.installedBuild === undefined ||
              task.installedBuild === normalizedIdentity.version);
        } catch {
          installedIdentityValid = false;
        }
      }
    }
    if (
      task?.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
      typeof task?.taskId !== "string" ||
      !IDENTIFIER_PATTERN.test(task.taskId) ||
      !TASK_STATES.includes(task?.state) ||
      !Number.isSafeInteger(task?.revision) ||
      task.revision <= 0 ||
      !OBSERVER_AUTHORITIES.includes(task?.observerAuthority) ||
      !PROVIDER_AUTHORITIES.includes(task?.providerAuthority) ||
      (task?.providerAuthority === "approved"
        ? typeof task?.providerApprovalReference !== "string" ||
          task.providerApprovalReference.trim() === ""
        : task?.providerApprovalReference !== undefined) ||
      task?.details === null ||
      typeof task?.details !== "object" ||
      Array.isArray(task?.details) ||
      behavioralConflict ||
      (task?.behavioral !== undefined &&
        typeof task.behavioral !== "boolean") ||
      (task?.details?.behavioral !== undefined &&
        task.details.behavioral !== task.behavioral) ||
      (task?.installedBuild !== undefined &&
        (typeof task.installedBuild !== "string" ||
          task.installedBuild.trim() === "")) ||
      !installedIdentityValid ||
      (task?.pendingOutcome !== undefined &&
        (task.pendingOutcome === null ||
          typeof task.pendingOutcome !== "object" ||
          Array.isArray(task.pendingOutcome) ||
          !VERIFICATION_TASK_STATES.has(task.pendingOutcome.outcome) ||
          task.pendingOutcome.outcome !== task.state ||
          !/^[0-9a-f]{64}$/i.test(
            String(task.pendingOutcome.outcomeDigest ?? ""),
          ) ||
          !Number.isSafeInteger(task.pendingOutcome.taskRevision) ||
          task.pendingOutcome.taskRevision !== task.revision)) ||
      (task?.mergedAt !== undefined &&
        !Number.isFinite(Date.parse(String(task.mergedAt)))) ||
      (task?.installedAt !== undefined &&
        !Number.isFinite(Date.parse(String(task.installedAt)))) ||
      (task?.soakStartedAt !== undefined &&
        !Number.isFinite(Date.parse(String(task.soakStartedAt))))
    ) {
      throw new AutomationControlError(
        "invalid_state",
        "The current task manifest contains an unsupported task record.",
      );
    }
    if (taskIds.has(task.taskId)) {
      throw new AutomationControlError(
        "invalid_state",
        `The current task manifest contains duplicate task ${task.taskId}.`,
      );
    }
    taskIds.add(task.taskId);
  }
  return manifest;
}

function readTaskManifestUnchecked({ stateRoot, nowMs = Date.now() } = {}) {
  const paths = automationControlPaths(stateRoot);
  const manifest = readJsonFile(paths.taskManifest, { allowMissing: true });
  return manifest ? validateTaskManifest(manifest) : emptyTaskManifest(nowMs);
}

function taskEventExists(eventsPath, eventId) {
  if (!existsSync(eventsPath)) {
    return false;
  }
  for (const raw of readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      if (JSON.parse(raw).eventId === eventId) {
        return true;
      }
    } catch {
      // A malformed historical line remains visible to higher-level source
      // health checks. It must not prevent recovery of a known transaction.
    }
  }
  return false;
}

function validateTaskTransaction(transaction, filePath) {
  const previousManifestRevision = Number(
    transaction?.previousManifestRevision,
  );
  const targetManifest = validateTaskManifest(transaction?.targetManifest);
  const event = transaction?.event;
  if (
    transaction?.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    typeof transaction?.transactionId !== "string" ||
    !IDENTIFIER_PATTERN.test(transaction.transactionId) ||
    !Number.isSafeInteger(previousManifestRevision) ||
    previousManifestRevision < 0 ||
    targetManifest.revision !== previousManifestRevision + 1 ||
    event?.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    typeof event?.eventId !== "string" ||
    event.manifestRevision !== targetManifest.revision ||
    typeof event?.taskId !== "string" ||
    !targetManifest.tasks.some(
      (task) =>
        task.taskId === event.taskId && task.revision === event.taskRevision,
    )
  ) {
    throw new AutomationControlError(
      "invalid_state",
      `Task transaction has an unsupported shape: ${filePath}`,
    );
  }
  return transaction;
}

function recoverTaskTransactionsUnlocked(paths, nowMs) {
  if (!existsSync(paths.taskTransactions)) {
    return { recovered: 0 };
  }
  const transactions = readdirSync(paths.taskTransactions)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const filePath = path.join(paths.taskTransactions, name);
      return {
        filePath,
        transaction: validateTaskTransaction(readJsonFile(filePath), filePath),
      };
    })
    .sort(
      (left, right) =>
        left.transaction.targetManifest.revision -
        right.transaction.targetManifest.revision,
    );

  let recovered = 0;
  for (const { filePath, transaction } of transactions) {
    const current = readTaskManifestUnchecked({
      stateRoot: paths.stateRoot,
      nowMs,
    });
    const target = transaction.targetManifest;
    if (current.revision === transaction.previousManifestRevision) {
      writeJsonAtomic(paths.taskManifest, target);
    } else if (current.revision === target.revision) {
      if (JSON.stringify(current) !== JSON.stringify(target)) {
        throw new AutomationControlError(
          "transaction_conflict",
          `Task transaction ${transaction.transactionId} conflicts with manifest revision ${current.revision}.`,
        );
      }
    } else if (
      current.revision > target.revision &&
      taskEventExists(paths.events, transaction.event.eventId)
    ) {
      rmSync(filePath, { force: true });
      recovered += 1;
      continue;
    } else {
      throw new AutomationControlError(
        "transaction_conflict",
        `Task transaction ${transaction.transactionId} expected manifest revision ${transaction.previousManifestRevision}, found ${current.revision}.`,
      );
    }

    if (!taskEventExists(paths.events, transaction.event.eventId)) {
      appendEventLine(paths, transaction.event, { now: () => nowMs });
    }
    rmSync(filePath, { force: true });
    recovered += 1;
  }
  syncDirectory(paths.taskTransactions);
  return { recovered };
}

export function recoverTaskTransactions({
  stateRoot,
  nowMs = Date.now(),
} = {}) {
  const paths = automationControlPaths(stateRoot);
  return withFilesystemGuard(
    paths,
    "tasks",
    () => recoverTaskTransactionsUnlocked(paths, nowMs),
    { now: () => nowMs },
  );
}

export function readTaskManifest({ stateRoot, nowMs = Date.now() } = {}) {
  recoverTaskTransactions({ stateRoot, nowMs });
  return readTaskManifestUnchecked({ stateRoot, nowMs });
}

export function readTask({ stateRoot, taskId, nowMs = Date.now() }) {
  requireIdentifier(taskId, "taskId");
  const manifest = readTaskManifest({ stateRoot, nowMs });
  return manifest.tasks.find((task) => task.taskId === taskId) ?? null;
}

function appendEventLine(paths, event, { now = () => Date.now() } = {}) {
  withFilesystemGuard(
    paths,
    "events",
    () => {
      mkdirSync(path.dirname(paths.events), { recursive: true });
      const fileFd = openSync(paths.events, "a", 0o600);
      try {
        appendFileSync(fileFd, `${JSON.stringify(event)}\n`, "utf8");
        fsyncSync(fileFd);
      } finally {
        closeSync(fileFd);
      }
    },
    { now },
  );
  return event;
}

export function appendControlEvent({
  stateRoot,
  type,
  actor,
  leaseName,
  leaseToken,
  data = {},
  taskId = undefined,
  nowMs = Date.now(),
  eventId = randomUUID(),
}) {
  if (RESERVED_CONTROL_EVENT_TYPES.has(type)) {
    throw new AutomationControlError(
      "reserved_event_type",
      `Event type ${type} is reserved for the authenticated outcome writer.`,
      { type },
    );
  }
  return appendControlEventInternal({
    stateRoot,
    type,
    actor,
    leaseName,
    leaseToken,
    data,
    taskId,
    nowMs,
    eventId,
  });
}

function appendControlEventInternal({
  stateRoot,
  type,
  actor,
  leaseName,
  leaseToken,
  data = {},
  taskId = undefined,
  nowMs = Date.now(),
  eventId = randomUUID(),
}) {
  const paths = automationControlPaths(stateRoot);
  requireIdentifier(type, "event type");
  requireNonemptyString(actor, "actor");
  if (taskId !== undefined) {
    requireIdentifier(taskId, "taskId");
  }
  const normalizedData = requirePlainObject(data, "event data");
  const { policy } = requireMutationLease({
    stateRoot: paths.stateRoot,
    actor,
    leaseName,
    leaseToken,
    nowMs,
    taskId,
    ownerIntentDigest: ownerOperationIntentDigest(
      actor,
      "event.append",
      taskId,
      { type, data: normalizedData },
    ),
  });
  if (!policy.canAppendEvent) {
    throw new AutomationControlError(
      "actor_not_authorized",
      `Actor ${actor} cannot append control events.`,
      { actor },
    );
  }
  const event = {
    schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
    eventId,
    type,
    ts: nowIso(nowMs),
    actor,
    ...(taskId === undefined ? {} : { taskId }),
    data: normalizedData,
  };
  return appendEventLine(paths, event, { now: () => nowMs });
}

export function appendOutcomeControlEvent(options) {
  return appendControlEventInternal({
    ...options,
    type: "outcome_recorded",
  });
}

function buildTaskEvent(type, actor, task, manifestRevision, data, nowMs) {
  return {
    schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
    eventId: randomUUID(),
    type,
    ts: nowIso(nowMs),
    actor,
    taskId: task.taskId,
    taskRevision: task.revision,
    manifestRevision,
    observerAuthority: task.observerAuthority,
    providerAuthority: task.providerAuthority,
    ...(task.providerApprovalReference === undefined
      ? {}
      : { providerApprovalReference: task.providerApprovalReference }),
    data,
  };
}

function leaseAuthorizationProvenance(lease) {
  return {
    leaseName: lease.name,
    leaseAcquiredAt: lease.acquiredAt,
    credentialKind: lease.credentialKind,
    ...(lease.ownerCapabilityId === undefined
      ? {}
      : {
          ownerCapabilityId: lease.ownerCapabilityId,
          ownerCapabilityTaskId: lease.ownerCapabilityTaskId,
          ownerCapabilityIntentDigest: lease.ownerCapabilityIntentDigest,
        }),
    ...(lease.publisherCapabilityId === undefined
      ? {}
      : { publisherCapabilityId: lease.publisherCapabilityId }),
  };
}

function mutateTaskManifest(stateRoot, nowMs, callback) {
  const paths = automationControlPaths(stateRoot);
  return withFilesystemGuard(
    paths,
    "tasks",
    () => {
      recoverTaskTransactionsUnlocked(paths, nowMs);
      const manifest = readTaskManifestUnchecked({
        stateRoot: paths.stateRoot,
        nowMs,
      });
      const mutation = callback(structuredClone(manifest));
      if (!mutation.changed) {
        return mutation.result;
      }
      mutation.manifest.tasks.sort((left, right) =>
        left.taskId.localeCompare(right.taskId),
      );
      mutation.manifest.revision = manifest.revision + 1;
      mutation.manifest.updatedAt = nowIso(nowMs);
      const event = buildTaskEvent(
        mutation.eventType,
        mutation.actor,
        mutation.task,
        mutation.manifest.revision,
        mutation.eventData,
        nowMs,
      );
      const transactionId = randomUUID();
      const transaction = {
        schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
        transactionId,
        preparedAt: nowIso(nowMs),
        previousManifestRevision: manifest.revision,
        targetManifest: mutation.manifest,
        event,
      };
      mkdirSync(paths.taskTransactions, { recursive: true });
      const transactionPath = path.join(
        paths.taskTransactions,
        `${String(mutation.manifest.revision).padStart(12, "0")}-${transactionId}.json`,
      );
      writeJsonAtomic(transactionPath, transaction);
      writeJsonAtomic(paths.taskManifest, mutation.manifest);
      appendEventLine(paths, event, { now: () => nowMs });
      rmSync(transactionPath, { force: true });
      syncDirectory(paths.taskTransactions);
      return {
        changed: true,
        manifestRevision: mutation.manifest.revision,
        task: structuredClone(mutation.task),
        event: structuredClone(event),
      };
    },
    { now: () => nowMs },
  );
}

export function createTask({
  stateRoot,
  taskId,
  actor,
  leaseName,
  leaseToken,
  observerAuthority,
  providerAuthority,
  approvalReference = undefined,
  state = "observed",
  details = {},
  nowMs = Date.now(),
}) {
  requireIdentifier(taskId, "taskId");
  requireNonemptyString(actor, "actor");
  requireEnum(state, TASK_STATES, "state");
  if (state !== "observed") {
    throw new AutomationControlError(
      "invalid_initial_state",
      "New tasks must begin in observed.",
      { state },
    );
  }
  requireEnum(observerAuthority, OBSERVER_AUTHORITIES, "observerAuthority");
  requireEnum(providerAuthority, PROVIDER_AUTHORITIES, "providerAuthority");
  let normalizedApprovalReference;
  if (providerAuthority === "approved") {
    if (actor !== "freed-owner") {
      throw new AutomationControlError(
        "actor_not_authorized",
        "Only freed-owner may create a task with approved provider authority.",
      );
    }
    normalizedApprovalReference = requireNonemptyString(
      approvalReference,
      "approvalReference",
    );
  } else if (approvalReference !== undefined) {
    throw new AutomationControlError(
      "invalid_value",
      "approvalReference is valid only for approved provider authority.",
    );
  }
  if (
    actor === "freed-runtime-observer" &&
    (observerAuthority !== "observe-only" || providerAuthority !== "forbidden")
  ) {
    throw new AutomationControlError(
      "actor_not_authorized",
      "The runtime observer may only create observe-only, provider-forbidden tasks.",
    );
  }
  if (
    actor === "freed-scaffolding-maintainer" &&
    (observerAuthority !== "pr-only" || providerAuthority !== "forbidden")
  ) {
    throw new AutomationControlError(
      "actor_not_authorized",
      "The scaffolding maintainer may only create pr-only, provider-forbidden tasks.",
    );
  }
  const normalizedDetails = requirePlainObject(details, "details");
  if (typeof normalizedDetails.behavioral !== "boolean") {
    throw new AutomationControlError(
      "behavioral_classification_required",
      `Task ${taskId} requires an explicit boolean behavioral classification.`,
      { taskId },
    );
  }
  const behavioral = normalizedDetails.behavioral;
  const { policy, lease } = requireMutationLease({
    stateRoot,
    actor,
    leaseName,
    leaseToken,
    nowMs,
    taskId,
    ownerIntentDigest: ownerOperationIntentDigest(
      actor,
      "task.create",
      taskId,
      {
        state,
        observerAuthority,
        providerAuthority,
        approvalReference: normalizedApprovalReference ?? null,
        details: normalizedDetails,
      },
    ),
  });
  if (!policy.canCreateTask) {
    throw new AutomationControlError(
      "actor_not_authorized",
      `Actor ${actor} cannot create tasks.`,
      { actor },
    );
  }

  return mutateTaskManifest(stateRoot, nowMs, (manifest) => {
    const existing = manifest.tasks.find((task) => task.taskId === taskId);
    if (existing) {
      const idempotent =
        existing.state === state &&
        existing.observerAuthority === observerAuthority &&
        existing.providerAuthority === providerAuthority &&
        existing.providerApprovalReference === normalizedApprovalReference &&
        taskBehavioralClassification(existing) === behavioral &&
        JSON.stringify(existing.details) === JSON.stringify(normalizedDetails);
      if (idempotent) {
        return {
          changed: false,
          result: {
            changed: false,
            manifestRevision: manifest.revision,
            task: structuredClone(existing),
          },
        };
      }
      throw new AutomationControlError(
        "task_exists",
        `Task ${taskId} already exists.`,
        {
          taskId,
          revision: existing.revision,
        },
      );
    }

    const timestamp = nowIso(nowMs);
    const task = {
      schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
      taskId,
      state,
      revision: 1,
      behavioral,
      observerAuthority,
      providerAuthority,
      ...(normalizedApprovalReference === undefined
        ? {}
        : { providerApprovalReference: normalizedApprovalReference }),
      createdAt: timestamp,
      updatedAt: timestamp,
      details: normalizedDetails,
    };
    manifest.tasks.push(task);
    return {
      changed: true,
      manifest,
      task,
      actor,
      eventType: "task_created",
      eventData: {
        state,
        authorizationProvenance: leaseAuthorizationProvenance(lease),
        ...(normalizedApprovalReference === undefined
          ? {}
          : { approvalReference: normalizedApprovalReference }),
      },
    };
  });
}

export function isTaskTransitionAllowed(fromState, toState) {
  requireEnum(fromState, TASK_STATES, "fromState");
  requireEnum(toState, TASK_STATES, "toState");
  return TASK_TRANSITIONS[fromState].includes(toState);
}

function requireTaskTransitionAuthority(task, toState) {
  const requiredAuthority = TRANSITION_AUTHORITY_REQUIREMENTS[toState];
  const actualRank = TASK_AUTHORITY_RANK[task.observerAuthority];
  const requiredRank = TASK_AUTHORITY_RANK[requiredAuthority];
  if (actualRank < requiredRank) {
    throw new AutomationControlError(
      "task_authority_insufficient",
      `Task ${task.taskId} has ${task.observerAuthority} authority, but ${toState} requires ${requiredAuthority}.`,
      {
        taskId: task.taskId,
        taskAuthority: task.observerAuthority,
        requiredAuthority,
        toState,
      },
    );
  }
}

export function transitionTask({
  stateRoot,
  taskId,
  actor,
  leaseName,
  leaseToken,
  toState,
  expectedRevision = undefined,
  details = undefined,
  nowMs = Date.now(),
}) {
  requireIdentifier(taskId, "taskId");
  requireNonemptyString(actor, "actor");
  requireEnum(toState, TASK_STATES, "toState");
  if (expectedRevision !== undefined) {
    requirePositiveInteger(expectedRevision, "expectedRevision");
  }
  const normalizedDetails =
    details === undefined ? undefined : requirePlainObject(details, "details");
  const { policy } = requireMutationLease({
    stateRoot,
    actor,
    leaseName,
    leaseToken,
    nowMs,
    taskId,
    ownerIntentDigest: ownerOperationIntentDigest(
      actor,
      "task.transition",
      taskId,
      {
        toState,
        expectedRevision: expectedRevision ?? null,
        details: normalizedDetails ?? null,
      },
    ),
  });

  return mutateTaskManifest(stateRoot, nowMs, (manifest) => {
    const task = manifest.tasks.find(
      (candidate) => candidate.taskId === taskId,
    );
    if (!task) {
      throw new AutomationControlError(
        "task_not_found",
        `Task ${taskId} does not exist.`,
        { taskId },
      );
    }
    if (expectedRevision !== undefined && task.revision !== expectedRevision) {
      throw new AutomationControlError(
        "revision_conflict",
        `Task ${taskId} is at revision ${task.revision}, not ${expectedRevision}.`,
        { taskId, expectedRevision, actualRevision: task.revision },
      );
    }
    if (task.state === toState && normalizedDetails === undefined) {
      return {
        changed: false,
        result: {
          changed: false,
          manifestRevision: manifest.revision,
          task: structuredClone(task),
        },
      };
    }
    if (task.pendingOutcome !== undefined && task.state !== toState) {
      throw new AutomationControlError(
        "outcome_pending",
        `Task ${taskId} cannot leave ${task.state} until its pending outcome is durable.`,
        {
          taskId,
          state: task.state,
          pendingOutcome: structuredClone(task.pendingOutcome),
        },
      );
    }
    if (!policy.destinations.includes(toState)) {
      throw new AutomationControlError(
        "actor_not_authorized",
        `Actor ${actor} cannot transition tasks to ${toState}.`,
        { actor, toState },
      );
    }
    const currentBehavioral = taskBehavioralClassification(task);
    const requestedBehavioral = normalizedDetails?.behavioral;
    if (
      typeof currentBehavioral === "boolean" &&
      requestedBehavioral !== undefined &&
      requestedBehavioral !== currentBehavioral
    ) {
      throw new AutomationControlError(
        "behavioral_classification_immutable",
        `Task ${taskId} cannot change its behavioral classification.`,
        { taskId, behavioral: currentBehavioral, requestedBehavioral },
      );
    }
    if (
      currentBehavioral === undefined &&
      !["observed", "triaged"].includes(task.state)
    ) {
      throw new AutomationControlError(
        "behavioral_classification_required",
        `Task ${taskId} must be classified before it enters the executable lifecycle.`,
        { taskId, state: task.state },
      );
    }
    const nextBehavioral = currentBehavioral ?? requestedBehavioral;
    if (
      ACTIVE_BEHAVIOR_TASK_STATES.has(toState) &&
      typeof nextBehavioral !== "boolean"
    ) {
      throw new AutomationControlError(
        "behavioral_classification_required",
        `Task ${taskId} requires an explicit behavioral classification before ${toState}.`,
        { taskId, toState },
      );
    }
    if (nextBehavioral === true && ACTIVE_BEHAVIOR_TASK_STATES.has(toState)) {
      const conflictingTask = manifest.tasks.find(
        (candidate) =>
          candidate.taskId !== taskId &&
          taskBehavioralClassification(candidate) === true &&
          taskHoldsBehaviorSlot(candidate),
      );
      if (conflictingTask) {
        throw new AutomationControlError(
          "behavior_slot_conflict",
          `Task ${taskId} cannot enter ${toState} while behavioral task ${conflictingTask.taskId} is ${conflictingTask.state}.`,
          {
            taskId,
            toState,
            conflictingTaskId: conflictingTask.taskId,
            conflictingTaskState: conflictingTask.state,
          },
        );
      }
    }
    if (
      VERIFICATION_TASK_STATES.has(toState) &&
      (normalizedDetails?.latestOutcome?.outcome !== toState ||
        !/^[0-9a-f]{64}$/i.test(
          String(normalizedDetails?.latestOutcome?.outcomeDigest ?? ""),
        ))
    ) {
      throw new AutomationControlError(
        "outcome_record_required",
        `Task ${taskId} must enter ${toState} through the authenticated outcome writer.`,
        { taskId, toState },
      );
    }
    requireTaskTransitionAuthority(task, toState);
    if (!isTaskTransitionAllowed(task.state, toState)) {
      throw new AutomationControlError(
        "invalid_transition",
        `Task ${taskId} cannot transition from ${task.state} to ${toState}.`,
        { taskId, fromState: task.state, toState },
      );
    }
    if (
      task.providerAuthority === "approval-required" &&
      ["implemented", "validated", "merged", "installed", "soaking"].includes(
        toState,
      )
    ) {
      throw new AutomationControlError(
        "provider_approval_required",
        `Task ${taskId} requires owner provider approval before ${toState}.`,
        { taskId, toState },
      );
    }
    if (
      nextBehavioral === true &&
      ["superseded", "closed", "triaged"].includes(toState) &&
      !COMPLETED_BEHAVIOR_TASK_STATES.has(task.state) &&
      (task.mergedAt !== undefined ||
        task.installedAt !== undefined ||
        ["merged", "installed", "soaking", "inconclusive"].includes(task.state))
    ) {
      throw new AutomationControlError(
        "behavior_outcome_required",
        `Merged behavioral task ${taskId} cannot leave the behavior slot before a conclusive verifier outcome.`,
        { taskId, state: task.state },
      );
    }
    if (task.state === "closed" && toState === "triaged") {
      const evidenceWindowEnd = normalizedDetails?.evidenceWindowEnd;
      const evidenceWindowEndMs = Date.parse(String(evidenceWindowEnd ?? ""));
      const closedAtMs = Date.parse(task.updatedAt);
      if (
        !Number.isFinite(evidenceWindowEndMs) ||
        evidenceWindowEndMs <= closedAtMs
      ) {
        throw new AutomationControlError(
          "stale_reopen_evidence",
          `Task ${taskId} can reopen only from evidence newer than ${task.updatedAt}.`,
          { taskId, taskUpdatedAt: task.updatedAt, evidenceWindowEnd },
        );
      }
    }

    const fromState = task.state;
    const previousUpdatedAt = task.updatedAt;
    const timestamp = nowIso(nowMs);
    let installedIdentity;
    if (toState === "installed") {
      installedIdentity = normalizeInstalledBuildIdentity(
        normalizedDetails?.installedIdentity ??
          normalizedDetails?.latestOutcome?.installedIdentity ??
          normalizedDetails?.latestOutcome?.buildIdentity,
      );
    }
    if (toState === "soaking") {
      installedIdentity = task.installedIdentity;
      if (installedIdentity === undefined) {
        throw new AutomationControlError(
          "installed_identity_required",
          `Task ${taskId} requires canonical installed version, commit, and channel identity before soaking.`,
          { taskId },
        );
      }
      installedIdentity = normalizeInstalledBuildIdentity(installedIdentity);
    }
    task.state = toState;
    task.revision += 1;
    task.updatedAt = timestamp;
    if (typeof nextBehavioral === "boolean") {
      task.behavioral = nextBehavioral;
    }
    if (normalizedDetails !== undefined) {
      task.details = {
        ...normalizedDetails,
        ...(typeof nextBehavioral === "boolean"
          ? { behavioral: nextBehavioral }
          : {}),
      };
    } else if (typeof nextBehavioral === "boolean") {
      task.details.behavioral = nextBehavioral;
    }
    if (toState === "merged") {
      task.mergedAt = timestamp;
    } else if (toState === "installed") {
      task.installedIdentity = installedIdentity;
      task.installedBuild = installedIdentity.version;
      task.installedAt = timestamp;
      delete task.soakStartedAt;
    } else if (toState === "soaking") {
      task.installedIdentity = installedIdentity;
      task.installedBuild = installedIdentity.version;
      task.installedAt =
        task.installedAt ??
        requireIsoTimestamp(previousUpdatedAt, "installedAt");
      task.soakStartedAt = timestamp;
    }
    const outcomeDigest = normalizedDetails?.latestOutcome?.outcomeDigest;
    if (VERIFICATION_TASK_STATES.has(toState)) {
      task.pendingOutcome = {
        outcome: toState,
        outcomeDigest: outcomeDigest.toLowerCase(),
        taskRevision: task.revision,
      };
    }
    return {
      changed: true,
      manifest,
      task,
      actor,
      eventType: "task_transitioned",
      eventData: {
        fromState,
        toState,
        ...(VERIFICATION_TASK_STATES.has(toState)
          ? { outcomeRequired: true }
          : {}),
        ...(typeof outcomeDigest === "string" &&
        /^[0-9a-f]{64}$/i.test(outcomeDigest)
          ? { outcomeDigest: outcomeDigest.toLowerCase() }
          : {}),
        ...(toState === "installed"
          ? {
              installedBuild: task.installedBuild,
              installedIdentity: task.installedIdentity,
              installedAt: task.installedAt,
            }
          : {}),
        ...(toState === "merged" ? { mergedAt: task.mergedAt } : {}),
        ...(toState === "soaking"
          ? {
              installedBuild: task.installedBuild,
              installedIdentity: task.installedIdentity,
              installedAt: task.installedAt,
              soakStartedAt: task.soakStartedAt,
            }
          : {}),
      },
    };
  });
}

function readStrictJsonLines(filePath, label) {
  if (!existsSync(filePath)) {
    throw new AutomationControlError(
      "outcome_not_durable",
      `${label} does not exist: ${filePath}`,
      { filePath },
    );
  }
  const entries = [];
  for (const [index, raw] of readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .entries()) {
    if (!raw.trim()) continue;
    try {
      entries.push(JSON.parse(raw));
    } catch {
      throw new AutomationControlError(
        "outcome_not_durable",
        `${label} contains malformed JSON on line ${(index + 1).toLocaleString()}.`,
        { filePath, line: index + 1 },
      );
    }
  }
  return entries;
}

function outcomeLedgerEntryDigest(entry) {
  const { authentication: _authentication, ...digestible } = entry;
  return createHash("sha256").update(JSON.stringify(digestible)).digest("hex");
}

function requireDurableOutcomeReservation({
  paths,
  task,
  actor,
  leaseName,
  outcome,
  outcomeDigest,
  taskRevision,
}) {
  const ledgerEntries = readStrictJsonLines(
    paths.outcomes,
    "Canonical outcome ledger",
  );
  const matchingEntries = ledgerEntries.filter(
    (entry) =>
      entry?.taskId === task.taskId &&
      entry?.outcome === outcome &&
      entry?.authentication?.outcomeDigest === outcomeDigest &&
      entry?.authentication?.taskRevision === taskRevision,
  );
  if (matchingEntries.length !== 1) {
    throw new AutomationControlError(
      "outcome_not_durable",
      `Task ${task.taskId} requires exactly one matching canonical outcome entry before finalization.`,
      {
        taskId: task.taskId,
        outcome,
        taskRevision,
        matches: matchingEntries.length,
      },
    );
  }
  const [entry] = matchingEntries;
  const authentication = entry.authentication;
  const computedDigest = outcomeLedgerEntryDigest(entry);
  if (
    entry.schemaVersion !== OUTCOME_LEDGER_SCHEMA_VERSION ||
    computedDigest !== outcomeDigest ||
    authentication.actor !== actor ||
    authentication.leaseName !== leaseName ||
    typeof authentication.controlEventId !== "string" ||
    typeof authentication.transitionEventId !== "string"
  ) {
    throw new AutomationControlError(
      "outcome_not_durable",
      `Task ${task.taskId} has a canonical outcome entry with invalid authentication.`,
      { taskId: task.taskId, outcome, taskRevision },
    );
  }

  const events = readStrictJsonLines(
    paths.events,
    "Automation control event history",
  );
  const controlEvents = events.filter(
    (event) => event?.eventId === authentication.controlEventId,
  );
  const transitionEvents = events.filter(
    (event) => event?.eventId === authentication.transitionEventId,
  );
  if (controlEvents.length !== 1 || transitionEvents.length !== 1) {
    throw new AutomationControlError(
      "outcome_not_durable",
      `Task ${task.taskId} requires one matching outcome event and lifecycle transition.`,
      {
        taskId: task.taskId,
        controlEventMatches: controlEvents.length,
        transitionEventMatches: transitionEvents.length,
      },
    );
  }
  const [controlEvent] = controlEvents;
  const [transitionEvent] = transitionEvents;
  const evidence = entry.evidence ?? {};
  if (
    controlEvent.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    controlEvent.type !== "outcome_recorded" ||
    controlEvent.actor !== actor ||
    controlEvent.taskId !== task.taskId ||
    controlEvent.data?.ledgerPath !== paths.outcomes ||
    controlEvent.data?.leaseName !== leaseName ||
    controlEvent.data?.id !== entry.id ||
    controlEvent.data?.taskId !== task.taskId ||
    controlEvent.data?.taskRevision !== taskRevision ||
    controlEvent.data?.taskState !== outcome ||
    controlEvent.data?.kind !== entry.kind ||
    controlEvent.data?.outcome !== outcome ||
    controlEvent.data?.outcomeDigest !== outcomeDigest ||
    controlEvent.data?.transitionEventId !== authentication.transitionEventId ||
    JSON.stringify(controlEvent.data?.evidence ?? {}) !==
      JSON.stringify(evidence) ||
    transitionEvent.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    transitionEvent.type !== "task_transitioned" ||
    transitionEvent.actor !== actor ||
    transitionEvent.taskId !== task.taskId ||
    transitionEvent.taskRevision !== taskRevision ||
    transitionEvent.data?.toState !== outcome ||
    transitionEvent.data?.outcomeDigest !== outcomeDigest ||
    transitionEvent.data?.outcomeRequired !== true
  ) {
    throw new AutomationControlError(
      "outcome_not_durable",
      `Task ${task.taskId} outcome does not match its durable control events.`,
      { taskId: task.taskId, outcome, taskRevision },
    );
  }
}

export function finalizeTaskOutcome({
  stateRoot,
  taskId,
  actor,
  leaseName,
  leaseToken,
  outcome,
  outcomeDigest,
  taskRevision,
  nowMs = Date.now(),
}) {
  requireIdentifier(taskId, "taskId");
  requireNonemptyString(actor, "actor");
  requireEnum(outcome, [...VERIFICATION_TASK_STATES], "outcome");
  const normalizedDigest = requireNonemptyString(
    outcomeDigest,
    "outcomeDigest",
  ).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedDigest)) {
    throw new AutomationControlError(
      "invalid_value",
      "outcomeDigest must be a 64 character hexadecimal digest.",
    );
  }
  requirePositiveInteger(taskRevision, "taskRevision");
  const { policy } = requireMutationLease({
    stateRoot,
    actor,
    leaseName,
    leaseToken,
    nowMs,
    taskId,
    ownerIntentDigest: ownerOperationIntentDigest(
      actor,
      "task.finalize-outcome",
      taskId,
      { outcome, outcomeDigest: normalizedDigest, taskRevision },
    ),
  });
  if (!policy.destinations.includes(outcome)) {
    throw new AutomationControlError(
      "actor_not_authorized",
      `Actor ${actor} cannot finalize ${outcome} outcomes.`,
      { actor, outcome },
    );
  }

  const paths = automationControlPaths(stateRoot);
  return mutateTaskManifest(paths.stateRoot, nowMs, (manifest) => {
    const task = manifest.tasks.find(
      (candidate) => candidate.taskId === taskId,
    );
    if (!task) {
      throw new AutomationControlError(
        "task_not_found",
        `Task ${taskId} does not exist.`,
        { taskId },
      );
    }
    const matchesDurableOutcome =
      task.state === outcome &&
      task.revision === taskRevision &&
      task.details?.latestOutcome?.outcome === outcome &&
      String(task.details?.latestOutcome?.outcomeDigest ?? "").toLowerCase() ===
        normalizedDigest;
    if (!matchesDurableOutcome) {
      throw new AutomationControlError(
        "outcome_reservation_mismatch",
        `Task ${taskId} does not match the outcome reservation being finalized.`,
        { taskId, outcome, taskRevision },
      );
    }
    if (task.pendingOutcome === undefined) {
      requireDurableOutcomeReservation({
        paths,
        task,
        actor,
        leaseName,
        outcome,
        outcomeDigest: normalizedDigest,
        taskRevision,
      });
      return {
        changed: false,
        result: {
          changed: false,
          manifestRevision: manifest.revision,
          task: structuredClone(task),
        },
      };
    }
    if (
      task.pendingOutcome.outcome !== outcome ||
      task.pendingOutcome.taskRevision !== taskRevision ||
      task.pendingOutcome.outcomeDigest !== normalizedDigest
    ) {
      throw new AutomationControlError(
        "outcome_reservation_mismatch",
        `Task ${taskId} has a different pending outcome reservation.`,
        { taskId, pendingOutcome: structuredClone(task.pendingOutcome) },
      );
    }
    requireDurableOutcomeReservation({
      paths,
      task,
      actor,
      leaseName,
      outcome,
      outcomeDigest: normalizedDigest,
      taskRevision,
    });
    delete task.pendingOutcome;
    return {
      changed: true,
      manifest,
      task,
      actor,
      eventType: "outcome_reservation_finalized",
      eventData: { outcome, outcomeDigest: normalizedDigest, taskRevision },
    };
  });
}

export function updateTaskAuthorities({
  stateRoot,
  taskId,
  actor,
  leaseName,
  leaseToken,
  observerAuthority = undefined,
  providerAuthority = undefined,
  reason,
  approvalReference = undefined,
  expectedRevision = undefined,
  nowMs = Date.now(),
}) {
  requireIdentifier(taskId, "taskId");
  requireNonemptyString(actor, "actor");
  const normalizedReason = requireNonemptyString(reason, "reason");
  if (actor !== "freed-owner") {
    throw new AutomationControlError(
      "actor_not_authorized",
      "Only freed-owner may update task authorities.",
      { actor },
    );
  }
  if (observerAuthority === undefined && providerAuthority === undefined) {
    throw new AutomationControlError(
      "invalid_value",
      "At least one authority field must be provided.",
    );
  }
  if (observerAuthority !== undefined) {
    requireEnum(observerAuthority, OBSERVER_AUTHORITIES, "observerAuthority");
  }
  if (providerAuthority !== undefined) {
    requireEnum(providerAuthority, PROVIDER_AUTHORITIES, "providerAuthority");
  }
  if (approvalReference !== undefined && providerAuthority !== "approved") {
    throw new AutomationControlError(
      "invalid_value",
      "approvalReference is valid only when providerAuthority becomes approved.",
    );
  }
  const normalizedApprovalReference =
    providerAuthority === "approved"
      ? requireNonemptyString(approvalReference, "approvalReference")
      : undefined;
  if (expectedRevision !== undefined) {
    requirePositiveInteger(expectedRevision, "expectedRevision");
  }
  const { lease } = requireMutationLease({
    stateRoot,
    actor,
    leaseName,
    leaseToken,
    nowMs,
    taskId,
    ownerIntentDigest: ownerOperationIntentDigest(
      actor,
      "task.authorize",
      taskId,
      {
        observerAuthority: observerAuthority ?? null,
        providerAuthority: providerAuthority ?? null,
        reason: normalizedReason,
        approvalReference: normalizedApprovalReference ?? null,
        expectedRevision: expectedRevision ?? null,
      },
    ),
  });

  return mutateTaskManifest(stateRoot, nowMs, (manifest) => {
    const task = manifest.tasks.find(
      (candidate) => candidate.taskId === taskId,
    );
    if (!task) {
      throw new AutomationControlError(
        "task_not_found",
        `Task ${taskId} does not exist.`,
        { taskId },
      );
    }
    if (expectedRevision !== undefined && task.revision !== expectedRevision) {
      throw new AutomationControlError(
        "revision_conflict",
        `Task ${taskId} is at revision ${task.revision}, not ${expectedRevision}.`,
        { taskId, expectedRevision, actualRevision: task.revision },
      );
    }

    const before = {
      observerAuthority: task.observerAuthority,
      providerAuthority: task.providerAuthority,
      ...(task.providerApprovalReference === undefined
        ? {}
        : { providerApprovalReference: task.providerApprovalReference }),
    };
    const nextObserverAuthority = observerAuthority ?? task.observerAuthority;
    const nextProviderAuthority = providerAuthority ?? task.providerAuthority;
    const nextProviderApprovalReference =
      nextProviderAuthority === "approved"
        ? (normalizedApprovalReference ?? task.providerApprovalReference)
        : undefined;
    if (
      nextProviderAuthority === "approved" &&
      (typeof nextProviderApprovalReference !== "string" ||
        nextProviderApprovalReference.trim() === "")
    ) {
      throw new AutomationControlError(
        "invalid_state",
        `Task ${taskId} has approved provider authority without an approval reference.`,
      );
    }
    if (
      nextObserverAuthority === task.observerAuthority &&
      nextProviderAuthority === task.providerAuthority &&
      nextProviderApprovalReference === task.providerApprovalReference
    ) {
      return {
        changed: false,
        result: {
          changed: false,
          manifestRevision: manifest.revision,
          task: structuredClone(task),
        },
      };
    }

    task.observerAuthority = nextObserverAuthority;
    task.providerAuthority = nextProviderAuthority;
    if (nextProviderApprovalReference === undefined) {
      delete task.providerApprovalReference;
    } else {
      task.providerApprovalReference = nextProviderApprovalReference;
    }
    task.revision += 1;
    task.updatedAt = nowIso(nowMs);
    return {
      changed: true,
      manifest,
      task,
      actor,
      eventType: "task_authority_updated",
      eventData: {
        before,
        after: {
          observerAuthority: task.observerAuthority,
          providerAuthority: task.providerAuthority,
          ...(task.providerApprovalReference === undefined
            ? {}
            : { providerApprovalReference: task.providerApprovalReference }),
        },
        reason: normalizedReason,
        authorizationProvenance: leaseAuthorizationProvenance(lease),
        ...(normalizedApprovalReference === undefined
          ? {}
          : { approvalReference: normalizedApprovalReference }),
      },
    };
  });
}

function leasePathFor(paths, name) {
  return path.join(
    paths.leases,
    `${requireIdentifier(name, "lease name")}.lease`,
  );
}

function leaseRecordPath(leasePath) {
  return path.join(leasePath, "lease.json");
}

function readLeaseRecord(leasePath) {
  if (!existsSync(leasePath)) {
    return null;
  }
  requirePrivateDirectory(leasePath, `Lease directory ${leasePath}`);
  const recordPath = leaseRecordPath(leasePath);
  if (!existsSync(recordPath)) {
    return null;
  }
  requirePrivateRegularFile(recordPath, {
    missingCode: "lease_not_found",
    missingMessage: `Lease record ${recordPath} does not exist.`,
    invalidCode: "lease_permissions_invalid",
    invalidMessage:
      "Lease records must be private regular files owned by the current user.",
  });
  return readJsonFile(recordPath);
}

function normalizePublisherScope(scope, { requireHead = false } = {}) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new AutomationControlError(
      "publisher_scope_required",
      "The publisher lease requires a target scope.",
    );
  }
  const scopeKeys = Object.keys(scope).sort();
  const requiredScopeKeys = [
    "base",
    "baseSha",
    "branch",
    "publishMode",
    "repo",
    "schemaVersion",
    "worktree",
  ];
  const supportedScopeKeys =
    scope.headSha === undefined
      ? requiredScopeKeys
      : [...requiredScopeKeys, "headSha"].sort();
  if (scopeKeys.join("\n") !== supportedScopeKeys.join("\n")) {
    throw new AutomationControlError(
      "publisher_scope_invalid",
      "The publisher lease target scope has unsupported or missing fields.",
    );
  }
  const normalized = {
    schemaVersion: scope.schemaVersion,
    repo: String(scope.repo ?? "").trim(),
    worktree: String(scope.worktree ?? "").trim(),
    branch: String(scope.branch ?? "").trim(),
    base: String(scope.base ?? "").trim(),
    baseSha: String(scope.baseSha ?? "")
      .trim()
      .toLowerCase(),
    publishMode: String(scope.publishMode ?? "").trim(),
    headSha:
      scope.headSha === null || scope.headSha === undefined
        ? null
        : String(scope.headSha).trim().toLowerCase(),
  };
  let physicalWorktree = "";
  try {
    physicalWorktree = realpathSync(normalized.worktree);
  } catch {
    physicalWorktree = "";
  }
  const expectedPublishMode =
    normalized.base === "main"
      ? /^chore\/promote-dev-to-main-[a-z0-9][a-z0-9._-]*$/.test(
          normalized.branch,
        )
        ? "production-promotion"
        : /^chore\/release-[a-z0-9][a-z0-9._-]*$/.test(normalized.branch)
          ? "production-release-prep"
          : null
      : "feature-pr";
  if (
    normalized.schemaVersion !== PUBLISH_SCOPE_SCHEMA_VERSION ||
    normalized.repo !== "freed-project/freed" ||
    !path.isAbsolute(normalized.worktree) ||
    physicalWorktree !== normalized.worktree ||
    !IDENTIFIER_PATTERN.test(normalized.branch.replaceAll("/", "-")) ||
    !["dev", "main", "www"].includes(normalized.base) ||
    expectedPublishMode === null ||
    normalized.publishMode !== expectedPublishMode ||
    !/^[0-9a-f]{40}$/.test(normalized.baseSha) ||
    (normalized.headSha !== null &&
      !/^[0-9a-f]{40}$/.test(normalized.headSha)) ||
    (requireHead && normalized.headSha === null)
  ) {
    throw new AutomationControlError(
      "publisher_scope_invalid",
      "The publisher lease target scope is invalid or incomplete.",
    );
  }
  return normalized;
}

function validateLeaseRecord(record, name) {
  if (record && typeof record === "object") {
    record.observerAuthority = normalizeStoredObserverAuthority(
      record.observerAuthority,
    );
  }
  const policy = AUTOMATION_ACTOR_POLICIES[record?.owner];
  const acquiredAtMs = Date.parse(String(record?.acquiredAt ?? ""));
  const heartbeatAtMs = Date.parse(String(record?.heartbeatAt ?? ""));
  const expiresAtMs = Date.parse(String(record?.expiresAt ?? ""));
  const maxLifetimeMs = actorLeaseMaxLifetimeMs(record?.owner);
  if (
    record?.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    record?.name !== name ||
    typeof record?.token !== "string" ||
    typeof record?.owner !== "string" ||
    typeof record?.expiresAt !== "string" ||
    !Number.isSafeInteger(record?.ttlMs) ||
    record.ttlMs <= 0 ||
    !Number.isFinite(acquiredAtMs) ||
    !Number.isFinite(heartbeatAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    heartbeatAtMs < acquiredAtMs ||
    expiresAtMs <= heartbeatAtMs ||
    expiresAtMs - heartbeatAtMs > record.ttlMs ||
    (maxLifetimeMs !== null && expiresAtMs > acquiredAtMs + maxLifetimeMs) ||
    !OBSERVER_AUTHORITIES.includes(record?.observerAuthority) ||
    !PROVIDER_AUTHORITIES.includes(record?.providerAuthority) ||
    !policy ||
    policy.leaseName !== name ||
    policy.observerAuthority !== record?.observerAuthority ||
    policy.providerAuthority !== record?.providerAuthority ||
    ![
      "persistent-actor",
      "owner-signed-capability",
      "signed-capability",
    ].includes(record?.credentialKind) ||
    (record?.owner === "freed-owner"
      ? record.credentialKind !== "owner-signed-capability" ||
        typeof record?.ownerCapabilityId !== "string" ||
        !IDENTIFIER_PATTERN.test(record.ownerCapabilityId) ||
        typeof record?.ownerCapabilityTaskId !== "string" ||
        !IDENTIFIER_PATTERN.test(record.ownerCapabilityTaskId) ||
        typeof record?.ownerCapabilityIntentDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(record.ownerCapabilityIntentDigest) ||
        record?.publisherCapabilityId !== undefined
      : record?.owner === "freed-pr-publisher"
        ? record.credentialKind !== "signed-capability" ||
          record?.ownerCapabilityId !== undefined ||
          record?.ownerCapabilityTaskId !== undefined ||
          record?.ownerCapabilityIntentDigest !== undefined ||
          typeof record?.publisherCapabilityId !== "string" ||
          !IDENTIFIER_PATTERN.test(record.publisherCapabilityId)
        : record.credentialKind !== "persistent-actor" ||
          record?.ownerCapabilityId !== undefined ||
          record?.ownerCapabilityTaskId !== undefined ||
          record?.ownerCapabilityIntentDigest !== undefined ||
          record?.publisherCapabilityId !== undefined)
  ) {
    throw new AutomationControlError(
      "invalid_state",
      `Lease ${name} has an unsupported record.`,
    );
  }
  if (record.owner === "freed-pr-publisher") {
    record.scope = normalizePublisherScope(record.scope);
  } else if (record.scope !== undefined) {
    throw new AutomationControlError(
      "invalid_state",
      `Lease ${name} has an unsupported target scope.`,
    );
  }
  return record;
}

function actorLeaseMaxLifetimeMs(owner) {
  if (owner === "freed-owner") {
    return OWNER_LEASE_MAX_LIFETIME_MS;
  }
  if (owner === "freed-pr-publisher") {
    return PUBLISHER_LEASE_MAX_LIFETIME_MS;
  }
  return AUTOMATION_ACTOR_POLICIES[owner]?.maxLeaseLifetimeMs ?? null;
}

function validateLegacyUncredentialedLeaseRecord(record, name, policy) {
  if (record && typeof record === "object") {
    record.observerAuthority = normalizeStoredObserverAuthority(
      record.observerAuthority,
    );
  }
  if (
    record?.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    record?.name !== name ||
    typeof record?.token !== "string" ||
    typeof record?.owner !== "string" ||
    typeof record?.expiresAt !== "string" ||
    record?.observerAuthority !== policy.observerAuthority ||
    record?.providerAuthority !== policy.providerAuthority ||
    record?.credentialKind !== undefined ||
    record?.ownerBootstrapGrantId !== undefined
  ) {
    throw new AutomationControlError(
      "invalid_state",
      `Legacy lease ${name} cannot be upgraded because its identity or authority is invalid.`,
    );
  }
  return record;
}

function isLegacyUncredentialedLeaseRecord(record) {
  return Boolean(
    record &&
    record.credentialKind === undefined &&
    record.ownerBootstrapGrantId === undefined,
  );
}

function secretDigest(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function canonicalIntentValue(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalIntentValue(item));
  }
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalIntentValue(value[key])]),
    );
  }
  throw new AutomationControlError(
    "owner_intent_invalid",
    "Owner governance intent must contain only canonical JSON values.",
  );
}

export function ownerGovernanceIntentDigest(intent) {
  const canonical = canonicalIntentValue(
    requirePlainObject(intent, "owner governance intent"),
  );
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

function ownerOperationIntentDigest(actor, action, taskId, parameters) {
  return actor === "freed-owner"
    ? ownerGovernanceIntentDigest({
        schemaVersion: OWNER_CAPABILITY_SCHEMA_VERSION,
        action,
        taskId,
        parameters,
      })
    : undefined;
}

function actorCredentialPath(paths, actor) {
  return path.join(
    paths.actorCredentials,
    `${requireIdentifier(actor, "actor credential identity")}.json`,
  );
}

function decodeCanonicalBase64(
  value,
  label,
  expectedBytes = undefined,
  errorCode = "publisher_capability_invalid",
) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new AutomationControlError(
      errorCode,
      `${label} must be canonical base64.`,
    );
  }
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.toString("base64") !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    throw new AutomationControlError(
      errorCode,
      `${label} has an invalid encoded length.`,
    );
  }
  return decoded;
}

function publisherCapabilityCredential(paths) {
  const credentialPath = actorCredentialPath(paths, "freed-pr-publisher");
  requirePrivateRegularFile(credentialPath, {
    missingCode: "publisher_capability_credential_required",
    missingMessage: `No publisher capability public key exists at ${credentialPath}.`,
    invalidCode: "publisher_capability_credential_invalid",
    invalidMessage:
      "The publisher capability public key must be a private regular file owned by the current user.",
  });
  const credential = readJsonFile(credentialPath);
  if (
    credential?.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    credential?.actor !== "freed-pr-publisher" ||
    credential?.purpose !== PUBLISHER_CAPABILITY_PURPOSE ||
    Object.keys(credential).sort().join("\n") !==
      ["actor", "publicKeyBase64", "purpose", "schemaVersion"].sort().join("\n")
  ) {
    throw new AutomationControlError(
      "publisher_capability_credential_invalid",
      "The publisher capability public key record has an unsupported shape.",
    );
  }
  const rawPublicKey = decodeCanonicalBase64(
    credential.publicKeyBase64,
    "publisher public key",
    32,
  );
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  return {
    credentialPath,
    publicKeyBase64: credential.publicKeyBase64,
    publicKey: createPublicKey({
      key: Buffer.concat([spkiPrefix, rawPublicKey]),
      format: "der",
      type: "spki",
    }),
  };
}

function capabilityFilePath(paths, capabilityId, state) {
  const directory =
    state === "pending"
      ? paths.publisherCapabilitiesPending
      : paths.publisherCapabilitiesConsumed;
  return path.join(
    directory,
    `${requireIdentifier(capabilityId, "publisher capability id")}.json`,
  );
}

function readAndValidatePublisherCapability({
  paths,
  capabilityFile,
  owner,
  name,
  ttlMs,
  scope,
  nowMs,
}) {
  if (typeof capabilityFile !== "string" || !path.isAbsolute(capabilityFile)) {
    throw new AutomationControlError(
      "publisher_capability_required",
      "Publisher acquisition requires an absolute broker-issued capability file.",
    );
  }
  requirePrivateRegularFile(capabilityFile, {
    missingCode: "publisher_capability_required",
    missingMessage: "The broker-issued publisher capability is unavailable.",
    invalidCode: "publisher_capability_permissions_invalid",
    invalidMessage:
      "The broker-issued publisher capability must be a private regular file owned by the current user.",
  });
  const envelope = readJsonFile(capabilityFile);
  if (
    envelope?.schemaVersion !== PUBLISHER_CAPABILITY_SCHEMA_VERSION ||
    Object.keys(envelope).sort().join("\n") !==
      ["payloadBase64", "schemaVersion", "signatureBase64"].sort().join("\n")
  ) {
    throw new AutomationControlError(
      "publisher_capability_invalid",
      "The publisher capability envelope has an unsupported shape.",
    );
  }
  const payloadBytes = decodeCanonicalBase64(
    envelope.payloadBase64,
    "publisher capability payload",
  );
  const signature = decodeCanonicalBase64(
    envelope.signatureBase64,
    "publisher capability signature",
    64,
  );
  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new AutomationControlError(
      "publisher_capability_invalid",
      "The publisher capability payload is not valid JSON.",
    );
  }
  const expectedPayloadKeys = [
    "capabilityId",
    "expiresAt",
    "issuedAt",
    "issuer",
    "leaseName",
    "leaseTtlMs",
    "schemaVersion",
    "scope",
  ];
  const issuedAtMs = Date.parse(String(payload?.issuedAt ?? ""));
  const expiresAtMs = Date.parse(String(payload?.expiresAt ?? ""));
  const normalizedScope = normalizePublisherScope(payload?.scope);
  if (
    payload?.schemaVersion !== PUBLISHER_CAPABILITY_SCHEMA_VERSION ||
    Object.keys(payload ?? {})
      .sort()
      .join("\n") !== expectedPayloadKeys.sort().join("\n") ||
    typeof payload?.capabilityId !== "string" ||
    !IDENTIFIER_PATTERN.test(payload.capabilityId) ||
    payload?.issuer !== owner ||
    payload?.leaseName !== name ||
    payload?.leaseTtlMs !== ttlMs ||
    !Number.isFinite(issuedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    issuedAtMs > nowMs + PUBLISHER_CAPABILITY_CLOCK_SKEW_MS ||
    expiresAtMs <= nowMs ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs !== PUBLISHER_CAPABILITY_LIFETIME_MS ||
    JSON.stringify(normalizedScope) !==
      JSON.stringify(normalizePublisherScope(scope))
  ) {
    throw new AutomationControlError(
      "publisher_capability_invalid",
      "The publisher capability does not match this lease request or is outside its validity window.",
    );
  }
  const expectedPath = capabilityFilePath(
    paths,
    payload.capabilityId,
    "pending",
  );
  let physicalCapabilityFile;
  let physicalExpectedPath;
  try {
    physicalCapabilityFile = realpathSync(capabilityFile);
    physicalExpectedPath = realpathSync(expectedPath);
  } catch {
    throw new AutomationControlError(
      "publisher_capability_invalid",
      "The publisher capability is not in the canonical pending directory.",
    );
  }
  if (
    physicalCapabilityFile !== physicalExpectedPath ||
    capabilityFile !== expectedPath
  ) {
    throw new AutomationControlError(
      "publisher_capability_invalid",
      "The publisher capability is not in the canonical pending directory.",
    );
  }
  const credential = publisherCapabilityCredential(paths);
  if (!verifySignature(null, payloadBytes, credential.publicKey, signature)) {
    throw new AutomationControlError(
      "publisher_capability_signature_invalid",
      "The publisher capability signature does not match the provisioned broker key.",
    );
  }
  const consumedPath = capabilityFilePath(
    paths,
    payload.capabilityId,
    "consumed",
  );
  if (existsSync(consumedPath)) {
    throw new AutomationControlError(
      "publisher_capability_replayed",
      "The publisher capability was already consumed.",
    );
  }
  return {
    capabilityFile: expectedPath,
    capabilityId: payload.capabilityId,
    consumedPath,
    credential,
    payload,
  };
}

function consumePublisherCapability(capability) {
  ensurePrivateDirectory(path.dirname(capability.consumedPath));
  renameSync(capability.capabilityFile, capability.consumedPath);
  syncDirectory(path.dirname(capability.capabilityFile));
  syncDirectory(path.dirname(capability.consumedPath));
  return capability.consumedPath;
}

function requirePrivateRegularFile(
  filePath,
  { missingCode, missingMessage, invalidCode, invalidMessage },
) {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new AutomationControlError(missingCode, missingMessage);
    }
    throw error;
  }
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : stats.uid;
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid ||
    (stats.mode & 0o777) !== 0o600
  ) {
    throw new AutomationControlError(invalidCode, invalidMessage);
  }
}

function validateActorCredential(paths, actor, token) {
  if (actor === "freed-pr-publisher") {
    throw new AutomationControlError(
      "publisher_capability_required",
      "The publisher cannot acquire a lease with a reusable actor credential.",
    );
  }
  if (typeof token !== "string" || token.length < 32) {
    throw new AutomationControlError(
      "actor_credential_required",
      `Actor ${actor} requires its pre-provisioned persistent credential secret.`,
    );
  }
  const credentialPath = actorCredentialPath(paths, actor);
  requirePrivateRegularFile(credentialPath, {
    missingCode: "actor_credential_required",
    missingMessage: `No persistent actor credential exists at ${credentialPath}.`,
    invalidCode: "actor_credential_invalid",
    invalidMessage:
      "Automation credentials must be private regular files with no group or world permissions.",
  });
  const credential = readJsonFile(credentialPath);
  const tokenSha256 = String(credential?.tokenSha256 ?? "").toLowerCase();
  if (
    credential?.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    credential?.actor !== actor ||
    credential?.purpose !== ACTOR_CREDENTIAL_PURPOSE ||
    !/^[0-9a-f]{64}$/.test(tokenSha256)
  ) {
    throw new AutomationControlError(
      "actor_credential_invalid",
      `The persistent credential for ${actor} has an unsupported identity or digest.`,
    );
  }
  const actualDigest = Buffer.from(secretDigest(token), "hex");
  const expectedDigest = Buffer.from(tokenSha256, "hex");
  if (!timingSafeEqual(actualDigest, expectedDigest)) {
    throw new AutomationControlError(
      "actor_credential_mismatch",
      `The persistent credential secret does not match actor ${actor}.`,
    );
  }
  return { credentialPath };
}

function ownerCapabilityFilePath(paths, capabilityId, state) {
  const directory =
    state === "pending"
      ? paths.ownerCapabilitiesPending
      : paths.ownerCapabilitiesConsumed;
  return path.join(
    directory,
    `${requireIdentifier(capabilityId, "owner capability id")}.json`,
  );
}

function requireRootOwnedTrustFile(filePath) {
  try {
    if (realpathSync(filePath) !== filePath) {
      throw new Error("path is not canonical");
    }
    const stats = lstatSync(filePath);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.uid !== 0 ||
      (stats.mode & 0o022) !== 0
    ) {
      throw new Error("file is not root-owned and immutable");
    }
    let current = path.dirname(filePath);
    while (current !== path.dirname(current)) {
      const parent = lstatSync(current);
      if (
        !parent.isDirectory() ||
        parent.isSymbolicLink() ||
        parent.uid !== 0 ||
        (parent.mode & 0o022) !== 0
      ) {
        throw new Error("directory hierarchy is not root-owned and immutable");
      }
      current = path.dirname(current);
    }
  } catch (error) {
    throw new AutomationControlError(
      "owner_capability_trust_invalid",
      `Owner capability trust config is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function ownerCapabilityPublicKey(paths) {
  requireRootOwnedTrustFile(OWNER_TRUST_CONFIG_PATH);
  const configuration = readJsonFile(OWNER_TRUST_CONFIG_PATH);
  const expectedKeys = [
    "automationControlLibrarySha256",
    "automationControlSha256",
    "brokerPath",
    "brokerSha256",
    "brokerSigningIdentifier",
    "brokerTeamIdentifier",
    "controlCommit",
    "controlRoot",
    "githubCLIPath",
    "githubCLISha256",
    "launcherSha256",
    "nodePath",
    "nodeSha256",
    "publisherHelperSha256",
    "publisherPublicKeyBase64",
    "schemaVersion",
    "stateRoot",
  ];
  let physicalStateRoot = "";
  try {
    physicalStateRoot = realpathSync(paths.stateRoot);
  } catch {
    throw new AutomationControlError(
      "owner_capability_trust_invalid",
      "Owner capability state root is unavailable.",
    );
  }
  if (
    configuration?.schemaVersion !== 2 ||
    Object.keys(configuration ?? {})
      .sort()
      .join("\n") !== expectedKeys.sort().join("\n") ||
    configuration.stateRoot !== physicalStateRoot
  ) {
    throw new AutomationControlError(
      "owner_capability_trust_invalid",
      "Owner capability trust config does not match the canonical automation state root.",
    );
  }
  const rawPublicKey = decodeCanonicalBase64(
    configuration.publisherPublicKeyBase64,
    "owner capability public key",
    32,
    "owner_capability_trust_invalid",
  );
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  return createPublicKey({
    key: Buffer.concat([spkiPrefix, rawPublicKey]),
    format: "der",
    type: "spki",
  });
}

export function verifyOwnerCapabilityEnvelope({
  envelope,
  publicKeyBase64,
  stateRoot,
  taskId,
  intentDigest,
  leaseToken,
  ttlMs,
  nowMs = Date.now(),
}) {
  if (
    envelope?.schemaVersion !== OWNER_CAPABILITY_SCHEMA_VERSION ||
    Object.keys(envelope ?? {})
      .sort()
      .join("\n") !==
      ["payloadBase64", "schemaVersion", "signatureBase64"].sort().join("\n")
  ) {
    throw new AutomationControlError(
      "owner_capability_invalid",
      "The owner capability envelope has an unsupported shape.",
    );
  }
  const payloadBytes = decodeCanonicalBase64(
    envelope.payloadBase64,
    "owner capability payload",
    undefined,
    "owner_capability_invalid",
  );
  const signature = decodeCanonicalBase64(
    envelope.signatureBase64,
    "owner capability signature",
    64,
    "owner_capability_invalid",
  );
  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new AutomationControlError(
      "owner_capability_invalid",
      "The owner capability payload is not valid JSON.",
    );
  }
  const expectedPayloadKeys = [
    "actor",
    "capabilityId",
    "expiresAt",
    "intentDigest",
    "issuedAt",
    "issuer",
    "leaseName",
    "leaseTtlMs",
    "purpose",
    "schemaVersion",
    "stateRoot",
    "taskId",
    "tokenSha256",
  ];
  const issuedAtMs = Date.parse(String(payload?.issuedAt ?? ""));
  const expiresAtMs = Date.parse(String(payload?.expiresAt ?? ""));
  const normalizedIntentDigest = String(intentDigest ?? "").toLowerCase();
  const leaseTokenSha256 =
    typeof leaseToken === "string" ? secretDigest(leaseToken) : "";
  let physicalStateRoot = "";
  try {
    physicalStateRoot = realpathSync(stateRoot);
  } catch {
    physicalStateRoot = "";
  }
  if (
    payload?.schemaVersion !== OWNER_CAPABILITY_SCHEMA_VERSION ||
    Object.keys(payload ?? {})
      .sort()
      .join("\n") !== expectedPayloadKeys.sort().join("\n") ||
    typeof payload?.capabilityId !== "string" ||
    !IDENTIFIER_PATTERN.test(payload.capabilityId) ||
    payload?.issuer !== OWNER_CAPABILITY_ISSUER ||
    payload?.purpose !== OWNER_CAPABILITY_PURPOSE ||
    payload?.actor !== "freed-owner" ||
    payload?.leaseName !== "owner-governance" ||
    payload?.stateRoot !== physicalStateRoot ||
    payload?.taskId !== taskId ||
    !IDENTIFIER_PATTERN.test(String(payload?.taskId ?? "")) ||
    payload?.intentDigest !== normalizedIntentDigest ||
    !/^[0-9a-f]{64}$/.test(normalizedIntentDigest) ||
    payload?.tokenSha256 !== leaseTokenSha256 ||
    payload?.leaseTtlMs !== ttlMs ||
    ttlMs > OWNER_LEASE_MAX_LIFETIME_MS ||
    !Number.isFinite(issuedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    issuedAtMs > nowMs + OWNER_CAPABILITY_CLOCK_SKEW_MS ||
    expiresAtMs <= nowMs ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs !== OWNER_CAPABILITY_LIFETIME_MS
  ) {
    throw new AutomationControlError(
      "owner_capability_invalid",
      "The owner capability does not match this governance lease request or is outside its validity window.",
    );
  }
  const rawPublicKey = decodeCanonicalBase64(
    publicKeyBase64,
    "owner capability public key",
    32,
    "owner_capability_trust_invalid",
  );
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const publicKey = createPublicKey({
    key: Buffer.concat([spkiPrefix, rawPublicKey]),
    format: "der",
    type: "spki",
  });
  if (!verifySignature(null, payloadBytes, publicKey, signature)) {
    throw new AutomationControlError(
      "owner_capability_signature_invalid",
      "The owner capability signature does not match the root-pinned broker key.",
    );
  }
  return payload;
}

function readAndValidateOwnerCapability({
  paths,
  capabilityFile,
  taskId,
  intentDigest,
  leaseToken,
  ttlMs,
  nowMs,
}) {
  if (typeof capabilityFile !== "string" || !path.isAbsolute(capabilityFile)) {
    throw new AutomationControlError(
      "owner_capability_required",
      "freed-owner requires an absolute broker-issued owner capability file.",
    );
  }
  requirePrivateRegularFile(capabilityFile, {
    missingCode: "owner_capability_required",
    missingMessage: "The broker-issued owner capability is unavailable.",
    invalidCode: "owner_capability_permissions_invalid",
    invalidMessage:
      "The broker-issued owner capability must be a private regular file owned by the current user.",
  });
  const envelope = readJsonFile(capabilityFile);
  const publicKey = ownerCapabilityPublicKey(paths);
  const rawPublicKey = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  const payload = verifyOwnerCapabilityEnvelope({
    envelope,
    publicKeyBase64: rawPublicKey.toString("base64"),
    stateRoot: paths.stateRoot,
    taskId,
    intentDigest,
    leaseToken,
    ttlMs,
    nowMs,
  });
  const expectedPath = ownerCapabilityFilePath(
    paths,
    payload.capabilityId,
    "pending",
  );
  let physicalCapabilityFile = "";
  let physicalExpectedPath = "";
  try {
    physicalCapabilityFile = realpathSync(capabilityFile);
    physicalExpectedPath = realpathSync(expectedPath);
  } catch {
    throw new AutomationControlError(
      "owner_capability_invalid",
      "The owner capability is not in the canonical pending directory.",
    );
  }
  if (
    capabilityFile !== expectedPath ||
    physicalCapabilityFile !== physicalExpectedPath
  ) {
    throw new AutomationControlError(
      "owner_capability_invalid",
      "The owner capability is not in the canonical pending directory.",
    );
  }
  const consumedPath = ownerCapabilityFilePath(
    paths,
    payload.capabilityId,
    "consumed",
  );
  if (existsSync(consumedPath)) {
    throw new AutomationControlError(
      "owner_capability_replayed",
      "The owner capability was already consumed.",
    );
  }
  return { capabilityFile: expectedPath, consumedPath, payload };
}

function consumeOwnerCapability(capability) {
  ensurePrivateDirectory(path.dirname(capability.consumedPath));
  renameSync(capability.capabilityFile, capability.consumedPath);
  syncDirectory(path.dirname(capability.capabilityFile));
  syncDirectory(path.dirname(capability.consumedPath));
  return capability.consumedPath;
}

function requireMutationLease({
  stateRoot,
  actor,
  leaseName,
  leaseToken,
  nowMs,
  taskId = undefined,
  ownerIntentDigest = undefined,
}) {
  const policy = actorPolicy(actor);
  requireIdentifier(leaseName, "leaseName");
  requireNonemptyString(leaseToken, "leaseToken");
  if (leaseName !== policy.leaseName) {
    throw new AutomationControlError(
      "lease_policy_mismatch",
      `Actor ${actor} must use lease ${policy.leaseName}.`,
      { actor, expectedLeaseName: policy.leaseName, leaseName },
    );
  }
  const paths = automationControlPaths(stateRoot);
  const leasePath = leasePathFor(paths, leaseName);
  const record = readLeaseRecord(leasePath);
  if (!record) {
    throw new AutomationControlError(
      "lease_not_found",
      `Lease ${leaseName} does not exist.`,
      { leaseName },
    );
  }
  validateLeaseRecord(record, leaseName);
  if (isLeaseExpired(record, nowMs)) {
    throw new AutomationControlError(
      "lease_expired",
      `Lease ${leaseName} has expired.`,
      { leaseName, expiresAt: record.expiresAt },
    );
  }
  if (record.token !== leaseToken) {
    throw new AutomationControlError(
      "lease_token_mismatch",
      `Lease ${leaseName} token does not match.`,
      { leaseName },
    );
  }
  if (record.owner !== actor) {
    throw new AutomationControlError(
      "lease_owner_mismatch",
      `Lease ${leaseName} belongs to ${record.owner}, not ${actor}.`,
      { leaseName, owner: record.owner, actor },
    );
  }
  if (
    record.observerAuthority !== policy.observerAuthority ||
    record.providerAuthority !== policy.providerAuthority
  ) {
    throw new AutomationControlError(
      "lease_policy_mismatch",
      `Lease ${leaseName} does not match the checked-in actor policy.`,
      { leaseName, actor },
    );
  }
  if (
    actor === "freed-owner" &&
    (typeof taskId !== "string" ||
      record.ownerCapabilityTaskId !== taskId ||
      typeof ownerIntentDigest !== "string" ||
      record.ownerCapabilityIntentDigest !== ownerIntentDigest)
  ) {
    throw new AutomationControlError(
      "owner_capability_intent_mismatch",
      "The owner governance lease is not authorized for this exact task and intent digest.",
      {
        taskId,
        authorizedTaskId: record.ownerCapabilityTaskId,
        ownerIntentDigest,
        authorizedIntentDigest: record.ownerCapabilityIntentDigest,
      },
    );
  }
  return { lease: record, policy };
}

function isLeaseExpired(record, nowMs) {
  const expiresAtMs = Date.parse(record.expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs;
}

function publicLease(record, { includeToken = false } = {}) {
  if (!record) {
    return null;
  }
  if (includeToken) {
    return structuredClone(record);
  }
  const { token: _token, ...rest } = record;
  return structuredClone(rest);
}

export function inspectLease({
  stateRoot,
  name,
  nowMs = Date.now(),
  includeToken = false,
}) {
  const paths = automationControlPaths(stateRoot);
  const leasePath = leasePathFor(paths, name);
  if (!existsSync(leasePath)) {
    return null;
  }
  const record = readLeaseRecord(leasePath);
  if (!record) {
    return {
      schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
      name,
      status: "initializing",
      expired: false,
    };
  }
  const legacyUncredentialed = isLegacyUncredentialedLeaseRecord(record);
  if (legacyUncredentialed && record.owner !== "freed-owner") {
    validateLegacyUncredentialedLeaseRecord(
      record,
      name,
      actorPolicy(record.owner),
    );
  } else {
    validateLeaseRecord(record, name);
  }
  return {
    ...publicLease(record, { includeToken }),
    status: isLeaseExpired(record, nowMs) ? "expired" : "active",
    expired: isLeaseExpired(record, nowMs),
    ...(legacyUncredentialed ? { legacyUncredentialed: true } : {}),
  };
}

function leaseEvent(paths, type, actor, name, data, nowMs) {
  return appendEventLine(
    paths,
    {
      schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
      eventId: randomUUID(),
      type,
      ts: nowIso(nowMs),
      actor,
      leaseName: name,
      data,
    },
    { now: () => nowMs },
  );
}

export function acquireLease({
  stateRoot,
  name,
  owner,
  ttlMs,
  observerAuthority = undefined,
  providerAuthority = undefined,
  nowMs = Date.now(),
  token = randomUUID(),
  orphanGraceMs = ORPHAN_LEASE_GRACE_MS,
  ownerCapabilityFile = undefined,
  ownerCapabilityTaskId = undefined,
  ownerCapabilityIntentDigest = undefined,
  actorCredentialToken = undefined,
  publisherCapabilityFile = undefined,
  scope = undefined,
}) {
  const paths = automationControlPaths(stateRoot);
  requireIdentifier(name, "lease name");
  requireNonemptyString(owner, "owner");
  requirePositiveInteger(ttlMs, "ttlMs");
  const policy = actorPolicy(owner);
  if (name !== policy.leaseName) {
    throw new AutomationControlError(
      "lease_policy_mismatch",
      `Actor ${owner} must acquire canonical lease ${policy.leaseName}.`,
      { owner, expectedLeaseName: policy.leaseName, name },
    );
  }
  if (
    (observerAuthority !== undefined &&
      observerAuthority !== policy.observerAuthority) ||
    (providerAuthority !== undefined &&
      providerAuthority !== policy.providerAuthority)
  ) {
    throw new AutomationControlError(
      "lease_policy_mismatch",
      `Lease authority for ${owner} is fixed by the checked-in actor policy.`,
      { owner },
    );
  }
  const resolvedObserverAuthority = policy.observerAuthority;
  const resolvedProviderAuthority = policy.providerAuthority;
  requireNonemptyString(token, "token");
  requirePositiveInteger(orphanGraceMs, "orphanGraceMs");
  if (
    owner === "freed-pr-publisher" &&
    (actorCredentialToken !== undefined || ownerCapabilityFile !== undefined)
  ) {
    throw new AutomationControlError(
      "publisher_reusable_credential_forbidden",
      "The publisher rejects reusable actor and owner credentials.",
    );
  }
  if (owner === "freed-owner" && actorCredentialToken !== undefined) {
    throw new AutomationControlError(
      "owner_reusable_credential_forbidden",
      "freed-owner does not accept a reusable actor credential.",
    );
  }
  if (
    owner !== "freed-owner" &&
    (ownerCapabilityFile !== undefined ||
      ownerCapabilityTaskId !== undefined ||
      ownerCapabilityIntentDigest !== undefined)
  ) {
    throw new AutomationControlError(
      "owner_capability_invalid",
      `Actor ${owner} cannot use an owner governance capability.`,
    );
  }
  const maxLeaseLifetimeMs = actorLeaseMaxLifetimeMs(owner);
  if (
    owner === "freed-pr-publisher" &&
    ttlMs !== PUBLISHER_LEASE_MAX_LIFETIME_MS
  ) {
    throw new AutomationControlError(
      "lease_ttl_invalid",
      `freed-pr-publisher leases must be exactly ${PUBLISHER_LEASE_MAX_LIFETIME_MS.toLocaleString()} ms.`,
    );
  }
  if (maxLeaseLifetimeMs !== null && ttlMs > maxLeaseLifetimeMs) {
    throw new AutomationControlError(
      owner === "freed-owner"
        ? "owner_lease_ttl_exceeded"
        : "lease_ttl_exceeded",
      `${owner} leases cannot exceed ${maxLeaseLifetimeMs.toLocaleString()} ms.`,
    );
  }
  const publisherScope =
    owner === "freed-pr-publisher" ? normalizePublisherScope(scope) : undefined;
  if (owner !== "freed-pr-publisher" && scope !== undefined) {
    throw new AutomationControlError(
      "publisher_scope_invalid",
      `Actor ${owner} cannot acquire a target-scoped lease.`,
    );
  }

  return withFilesystemGuard(
    paths,
    `lease-${name}`,
    () => {
      ensurePrivateDirectory(paths.leases);
      const leasePath = leasePathFor(paths, name);
      const ownerCapability =
        owner === "freed-owner"
          ? readAndValidateOwnerCapability({
              paths,
              capabilityFile: ownerCapabilityFile,
              taskId: ownerCapabilityTaskId,
              intentDigest: ownerCapabilityIntentDigest,
              leaseToken: token,
              ttlMs,
              nowMs,
            })
          : null;
      const publisherCapability =
        owner === "freed-pr-publisher"
          ? readAndValidatePublisherCapability({
              paths,
              capabilityFile: publisherCapabilityFile,
              owner,
              name,
              ttlMs,
              scope: publisherScope,
              nowMs,
            })
          : null;
      const actorCredential =
        owner === "freed-owner" || owner === "freed-pr-publisher"
          ? null
          : validateActorCredential(paths, owner, actorCredentialToken);
      if (
        owner !== "freed-pr-publisher" &&
        publisherCapabilityFile !== undefined
      ) {
        throw new AutomationControlError(
          "publisher_capability_invalid",
          `Actor ${owner} cannot use a publisher capability.`,
        );
      }
      let previous = null;
      let takeover = false;
      let credentialUpgrade = false;

      if (existsSync(leasePath)) {
        const existing = readLeaseRecord(leasePath);
        if (!existing) {
          const ageMs = Math.max(0, nowMs - statSync(leasePath).mtimeMs);
          if (ageMs < orphanGraceMs) {
            throw new AutomationControlError(
              "lease_busy",
              `Lease ${name} is being initialized by another owner.`,
              { name },
            );
          }
          previous = { owner: "unknown", expiredAt: null, unreadable: true };
        } else {
          const isLegacyUncredentialed =
            isLegacyUncredentialedLeaseRecord(existing);
          if (isLegacyUncredentialed && owner !== "freed-owner") {
            validateLegacyUncredentialedLeaseRecord(existing, name, policy);
            if (existing.owner !== owner) {
              throw new AutomationControlError(
                "legacy_lease_owner_mismatch",
                `Legacy lease ${name} belongs to ${existing.owner}, not ${owner}.`,
                { name, owner: existing.owner, actor: owner },
              );
            }
            if (existing.token === token) {
              throw new AutomationControlError(
                "lease_token_reuse",
                `Credential upgrade for ${name} requires a new lease token.`,
                { name },
              );
            }
            credentialUpgrade = true;
            previous = {
              owner: existing.owner,
              expiredAt: existing.expiresAt,
              heartbeatAt: existing.heartbeatAt,
              legacyUncredentialed: true,
            };
          } else {
            validateLeaseRecord(existing, name);
            if (!isLeaseExpired(existing, nowMs)) {
              throw new AutomationControlError(
                "lease_busy",
                `Lease ${name} is held by ${existing.owner}.`,
                {
                  name,
                  owner: existing.owner,
                  expiresAt: existing.expiresAt,
                },
              );
            }
            previous = {
              owner: existing.owner,
              expiredAt: existing.expiresAt,
              heartbeatAt: existing.heartbeatAt,
            };
          }
        }

        const abandonedPath = `${leasePath}.abandoned.${randomUUID()}`;
        renameSync(leasePath, abandonedPath);
        takeover = true;
        rmSync(abandonedPath, { recursive: true, force: true });
      }

      const consumedOwnerCapabilityPath = ownerCapability
        ? consumeOwnerCapability(ownerCapability)
        : null;
      const consumedPublisherCapabilityPath = publisherCapability
        ? consumePublisherCapability(publisherCapability)
        : null;
      const timestamp = nowIso(nowMs);
      const record = {
        schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
        name,
        owner,
        token,
        observerAuthority: resolvedObserverAuthority,
        providerAuthority: resolvedProviderAuthority,
        credentialKind:
          ownerCapability !== null
            ? "owner-signed-capability"
            : publisherCapability !== null
              ? "signed-capability"
              : "persistent-actor",
        ...(ownerCapability === null
          ? {}
          : {
              ownerCapabilityId: ownerCapability.payload.capabilityId,
              ownerCapabilityTaskId: ownerCapability.payload.taskId,
              ownerCapabilityIntentDigest: ownerCapability.payload.intentDigest,
            }),
        ...(publisherCapability === null
          ? {}
          : { publisherCapabilityId: publisherCapability.capabilityId }),
        acquiredAt: timestamp,
        heartbeatAt: timestamp,
        expiresAt: nowIso(nowMs + ttlMs),
        ttlMs,
        ...(publisherScope === undefined ? {} : { scope: publisherScope }),
      };
      try {
        mkdirSync(leasePath, { mode: 0o700 });
        writeJsonAtomic(leaseRecordPath(leasePath), record);
      } catch (error) {
        rmSync(leasePath, { recursive: true, force: true });
        if (
          consumedOwnerCapabilityPath &&
          !existsSync(ownerCapability.capabilityFile) &&
          existsSync(consumedOwnerCapabilityPath)
        ) {
          renameSync(
            consumedOwnerCapabilityPath,
            ownerCapability.capabilityFile,
          );
        }
        if (
          consumedPublisherCapabilityPath &&
          !existsSync(publisherCapability.capabilityFile) &&
          existsSync(consumedPublisherCapabilityPath)
        ) {
          renameSync(
            consumedPublisherCapabilityPath,
            publisherCapability.capabilityFile,
          );
        }
        throw error;
      }

      const leaseEventType = credentialUpgrade
        ? "lease_credential_upgraded"
        : takeover
          ? "lease_taken_over"
          : "lease_acquired";
      leaseEvent(
        paths,
        leaseEventType,
        owner,
        name,
        {
          expiresAt: record.expiresAt,
          observerAuthority: resolvedObserverAuthority,
          providerAuthority: resolvedProviderAuthority,
          credentialKind: record.credentialKind,
          ...(publisherCapability === null
            ? {}
            : { publisherCapabilityId: publisherCapability.capabilityId }),
          ...(publisherScope === undefined ? {} : { scope: publisherScope }),
          ...(actorCredential === null
            ? {}
            : { actorCredentialPath: actorCredential.credentialPath }),
          ...(ownerCapability === null
            ? {}
            : {
                ownerCapabilityId: ownerCapability.payload.capabilityId,
                ownerCapabilityTaskId: ownerCapability.payload.taskId,
                ownerCapabilityIntentDigest:
                  ownerCapability.payload.intentDigest,
              }),
          ...(credentialUpgrade ? { credentialUpgrade: true } : {}),
          ...(previous === null ? {} : { previous }),
        },
        nowMs,
      );
      return {
        acquired: true,
        takeover,
        credentialUpgrade,
        lease: publicLease(record, { includeToken: true }),
        ...(previous === null ? {} : { previous }),
      };
    },
    { now: () => nowMs },
  );
}

export function heartbeatLease({
  stateRoot,
  name,
  token,
  ttlMs = undefined,
  nowMs = Date.now(),
}) {
  const paths = automationControlPaths(stateRoot);
  requireIdentifier(name, "lease name");
  requireNonemptyString(token, "token");
  if (ttlMs !== undefined) {
    requirePositiveInteger(ttlMs, "ttlMs");
  }

  return withFilesystemGuard(
    paths,
    `lease-${name}`,
    () => {
      const leasePath = leasePathFor(paths, name);
      const record = readLeaseRecord(leasePath);
      if (!record) {
        throw new AutomationControlError(
          "lease_not_found",
          `Lease ${name} does not exist.`,
          { name },
        );
      }
      validateLeaseRecord(record, name);
      if (record.token !== token) {
        throw new AutomationControlError(
          "lease_token_mismatch",
          `Lease ${name} token does not match.`,
          {
            name,
          },
        );
      }
      if (isLeaseExpired(record, nowMs)) {
        throw new AutomationControlError(
          "lease_expired",
          `Lease ${name} has expired.`,
          {
            name,
            expiresAt: record.expiresAt,
          },
        );
      }

      const nextTtlMs = ttlMs ?? record.ttlMs;
      requirePositiveInteger(nextTtlMs, "ttlMs");
      let nextExpiresAtMs = nowMs + nextTtlMs;
      const maxLeaseLifetimeMs = actorLeaseMaxLifetimeMs(record.owner);
      if (maxLeaseLifetimeMs !== null) {
        if (nextTtlMs > maxLeaseLifetimeMs) {
          throw new AutomationControlError(
            record.owner === "freed-owner"
              ? "owner_lease_ttl_exceeded"
              : "lease_ttl_exceeded",
            `${record.owner} leases cannot exceed ${maxLeaseLifetimeMs.toLocaleString()} ms.`,
          );
        }
        const acquiredAtMs = Date.parse(record.acquiredAt);
        const absoluteExpiryMs = acquiredAtMs + maxLeaseLifetimeMs;
        if (!Number.isFinite(acquiredAtMs) || absoluteExpiryMs <= nowMs) {
          throw new AutomationControlError(
            record.owner === "freed-owner"
              ? "owner_lease_lifetime_exhausted"
              : "lease_lifetime_exhausted",
            `The ${record.owner} lease exhausted its absolute lifetime.`,
          );
        }
        nextExpiresAtMs = Math.min(nextExpiresAtMs, absoluteExpiryMs);
      }
      record.heartbeatAt = nowIso(nowMs);
      record.expiresAt = nowIso(nextExpiresAtMs);
      record.ttlMs = nextTtlMs;
      writeJsonAtomic(leaseRecordPath(leasePath), record);
      leaseEvent(
        paths,
        "lease_heartbeat",
        record.owner,
        name,
        { expiresAt: record.expiresAt },
        nowMs,
      );
      return {
        heartbeated: true,
        lease: publicLease(record, { includeToken: true }),
      };
    },
    { now: () => nowMs },
  );
}

export function bindPublisherLeaseHead({
  stateRoot,
  name = "pr-publisher",
  token,
  scope,
  headSha,
  nowMs = Date.now(),
}) {
  const paths = automationControlPaths(stateRoot);
  requireIdentifier(name, "lease name");
  requireNonemptyString(token, "token");
  const expectedScope = normalizePublisherScope({ ...scope, headSha: null });
  const normalizedHeadSha = String(headSha ?? "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalizedHeadSha)) {
    throw new AutomationControlError(
      "publisher_scope_invalid",
      "The publisher head must be one full commit SHA.",
    );
  }

  return withFilesystemGuard(
    paths,
    `lease-${name}`,
    () => {
      const leasePath = leasePathFor(paths, name);
      const record = readLeaseRecord(leasePath);
      if (!record) {
        throw new AutomationControlError(
          "lease_not_found",
          `Lease ${name} does not exist.`,
        );
      }
      validateLeaseRecord(record, name);
      if (record.owner !== "freed-pr-publisher" || name !== "pr-publisher") {
        throw new AutomationControlError(
          "publisher_scope_invalid",
          "Only the canonical publisher lease can bind a publish head.",
        );
      }
      if (record.token !== token) {
        throw new AutomationControlError(
          "lease_token_mismatch",
          `Lease ${name} token does not match.`,
        );
      }
      if (isLeaseExpired(record, nowMs)) {
        throw new AutomationControlError(
          "lease_expired",
          `Lease ${name} has expired.`,
        );
      }
      for (const field of [
        "schemaVersion",
        "repo",
        "worktree",
        "branch",
        "base",
        "baseSha",
        "publishMode",
      ]) {
        if (record.scope[field] !== expectedScope[field]) {
          throw new AutomationControlError(
            "publisher_scope_mismatch",
            `Publisher lease scope does not match ${field}.`,
            { field },
          );
        }
      }
      if (
        record.scope.headSha !== null &&
        record.scope.headSha !== normalizedHeadSha
      ) {
        throw new AutomationControlError(
          "publisher_head_mismatch",
          "Publisher lease is already bound to a different commit.",
        );
      }
      if (record.scope.headSha === normalizedHeadSha) {
        return { bound: false, lease: publicLease(record) };
      }
      record.scope.headSha = normalizedHeadSha;
      writeJsonAtomic(leaseRecordPath(leasePath), record);
      leaseEvent(
        paths,
        "lease_scope_bound",
        record.owner,
        name,
        { scope: record.scope },
        nowMs,
      );
      return { bound: true, lease: publicLease(record) };
    },
    { now: () => nowMs },
  );
}

export function releaseLease({ stateRoot, name, token, nowMs = Date.now() }) {
  const paths = automationControlPaths(stateRoot);
  requireIdentifier(name, "lease name");
  requireNonemptyString(token, "token");

  return withFilesystemGuard(
    paths,
    `lease-${name}`,
    () => {
      const leasePath = leasePathFor(paths, name);
      const record = readLeaseRecord(leasePath);
      if (!record) {
        throw new AutomationControlError(
          "lease_not_found",
          `Lease ${name} does not exist.`,
          { name },
        );
      }
      validateLeaseRecord(record, name);
      if (record.token !== token) {
        throw new AutomationControlError(
          "lease_token_mismatch",
          `Lease ${name} token does not match.`,
          {
            name,
          },
        );
      }

      const releasedPath = `${leasePath}.released.${randomUUID()}`;
      renameSync(leasePath, releasedPath);
      rmSync(releasedPath, { recursive: true, force: true });
      leaseEvent(
        paths,
        "lease_released",
        record.owner,
        name,
        { expired: isLeaseExpired(record, nowMs) },
        nowMs,
      );
      return {
        released: true,
        lease: publicLease(record),
      };
    },
    { now: () => nowMs },
  );
}
