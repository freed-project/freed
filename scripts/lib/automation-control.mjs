import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeSync,
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
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

import {
  AUTOMATION_KERNEL_GUARD_NAMES,
  automationKernelGuardMarkerBytes,
  inspectAutomationKernelGuardCutover,
} from "./automation-kernel-guard-contract.mjs";
import {
  OUTCOME_LEDGER_REPAIR_ACTION,
  OUTCOME_LEDGER_REPAIR_ARTIFACT_KEYS,
  OUTCOME_LEDGER_REPAIR_EVENT_TYPE,
  OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  OUTCOME_LEDGER_REPAIR_MAX_LINES,
  OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS,
  OUTCOME_LEDGER_REPAIR_PHASES,
  OUTCOME_LEDGER_REPAIR_POLICY,
  OUTCOME_LEDGER_REPAIR_RECEIPT_KEYS,
  OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
  OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS,
  outcomeLedgerRepairEventId,
  outcomeLedgerRepairOperationSeed,
} from "./outcome-ledger-repair-contract.mjs";

export const AUTOMATION_CONTROL_SCHEMA_VERSION = 1;
export const PUBLISH_SCOPE_SCHEMA_VERSION = 2;
export const PUBLISHER_CAPABILITY_SCHEMA_VERSION = 1;
export const OWNER_CAPABILITY_SCHEMA_VERSION = 1;
const OWNER_CONFIRMATION_SCHEMA_VERSION = 1;
const OUTCOME_LEDGER_SCHEMA_VERSION = 3;
export const CONTROL_EVENT_HISTORY_MAX_BYTES = 128 * 1024 * 1024;
export const CONTROL_EVENT_MAX_LINE_BYTES = 1024 * 1024;
const controlEventHistoryDecoder = new TextDecoder("utf-8", { fatal: true });
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
const OUTCOME_TASK_STATES = new Set([
  "merged",
  "installed",
  "verified_effective",
  "verified_neutral",
  "regressed",
  "inconclusive",
  "governance_blocked",
  "superseded",
  "implementation_failed",
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
const OUTCOME_RECORD_ACTION = "outcome.record";
const OUTCOME_RECORD_POLICY = "freed-outcome-record-v1";
const LEASE_TRANSACTION_SCHEMA_VERSION = 1;
const LEASE_TRANSACTION_KIND = "lease-transaction";
const LEASE_TRANSACTION_MAX_BYTES = 1024 * 1024;
const LEASE_TRANSACTION_RECEIPT_RETENTION = 8;
export const LEASE_ARCHIVE_MAX_ENTRIES = 100_000;
export const LEASE_ARCHIVE_MAX_BYTES = 4 * 1024 * 1024 * 1024;
export const LEASE_ARCHIVE_MAX_AGE_MS = 366 * 24 * 60 * 60 * 1_000;
export const LEASE_ARCHIVE_MIN_FREE_BYTES = 1024 * 1024 * 1024;
const LEASE_ARCHIVE_MOVE_PROTOCOL = "freed-lease-archive-move-v1";
const LEASE_ARCHIVE_MOVE_PYTHON = "/usr/bin/python3";
const LEASE_ARCHIVE_MOVE_HELPER = fileURLToPath(
  new URL("./lease-archive-move.py", import.meta.url),
);
export const LEASE_ARCHIVE_MOVE_HELPER_SHA256 =
  "087cea86bf231153f282ce343bc983226daf2232eaa3759b61244c8f84f30b71";
const LEASE_ARCHIVE_HELPER_MAX_BYTES = 256 * 1024;
const LEASE_ARCHIVE_LIST_MAX_ENTRY_BYTES =
  64 + 1 + 64 + Buffer.byteLength(".json");
const LEASE_ARCHIVE_LIST_MAX_BUFFER =
  LEASE_ARCHIVE_MAX_ENTRIES * (LEASE_ARCHIVE_LIST_MAX_ENTRY_BYTES + 1);
const privateAuthorityDecoder = new TextDecoder("utf-8", { fatal: true });
const OUTCOME_LEDGER_REPAIR_DIGEST_FIELDS = Object.freeze([
  "archiveDigest",
  "decisionsDigest",
  "eventHistoryDigest",
  "receiptDigest",
  "replacementDigest",
  "sourceDigest",
]);
const OUTCOME_LEDGER_REPAIR_INTEGER_FIELDS = Object.freeze([
  "eventHistorySize",
  "rejectedCount",
  "replacementSize",
  "sourceLineCount",
  "sourceSize",
  "trustedCount",
]);
const OUTCOME_RECORD_PARAMETER_KEYS = Object.freeze(
  [
    "cleanEntry",
    "ledgerPath",
    "legacyTransition",
    "legacyTransitionEventId",
    "outcomeDigest",
    "policy",
    "route",
    "schemaVersion",
    "sourceTask",
    "sourceTaskDetails",
    "sourceTaskRevision",
    "sourceTaskState",
    "stateRoot",
  ].sort(),
);
const RESERVED_CONTROL_EVENT_TYPES = new Set([
  OUTCOME_LEDGER_REPAIR_EVENT_TYPE,
  "outcome_recorded",
]);

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

const INTERNAL_GUARD_TIMEOUT_MS = 5_000;
const INTERNAL_GUARD_POLL_MS = 10;
const ORPHAN_LEASE_GRACE_MS = 5 * 60 * 1_000;
const OWNER_LEASE_MAX_LIFETIME_MS = 15 * 60 * 1_000;
const OWNER_CAPABILITY_LIFETIME_MS = 60 * 1_000;
const OWNER_CAPABILITY_CLOCK_SKEW_MS = 30 * 1_000;
const OWNER_CONFIRMATION_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const OWNER_CONFIRMATION_CLOCK_SKEW_MS = 30 * 1_000;
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

function requireExactPlainObject(value, field) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new AutomationControlError(
      "invalid_value",
      `${field} must be an exact plain JSON object.`,
      { field },
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        descriptors[key]?.enumerable !== true ||
        descriptors[key]?.get !== undefined ||
        descriptors[key]?.set !== undefined,
    )
  ) {
    throw new AutomationControlError(
      "invalid_value",
      `${field} must contain only enumerable JSON data properties.`,
      { field },
    );
  }
  return structuredClone(value);
}

function normalizeOutcomeLedgerRepairParameters(value, stateRoot, taskId) {
  const parameters = requireExactPlainObject(
    value,
    "outcome ledger repair parameters",
  );
  const actualKeys = Object.keys(parameters).sort();
  if (
    actualKeys.length !== OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS.length ||
    actualKeys.some(
      (key, index) => key !== OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS[index],
    )
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_intent_invalid",
      "Outcome ledger repair parameters must contain the exact receipt field set.",
      {
        expectedKeys: [...OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS],
        actualKeys,
      },
    );
  }

  let canonicalStateRoot;
  try {
    canonicalStateRoot = realpathSync(resolveAutomationStateRoot(stateRoot));
  } catch {
    throw new AutomationControlError(
      "outcome_ledger_repair_intent_invalid",
      "Outcome ledger repair stateRoot must resolve to the current physical automation state root.",
    );
  }
  if (
    parameters.schemaVersion !== OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION ||
    parameters.policy !== OUTCOME_LEDGER_REPAIR_POLICY ||
    typeof parameters.stateRoot !== "string" ||
    !path.isAbsolute(parameters.stateRoot) ||
    parameters.stateRoot !== canonicalStateRoot ||
    parameters.ledgerPath !== path.join(canonicalStateRoot, "outcomes.jsonl")
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_intent_invalid",
      "Outcome ledger repair parameters do not match the canonical state and policy contract.",
    );
  }
  if (
    typeof parameters.operationId !== "string" ||
    !/^[0-9a-f]{64}$/.test(parameters.operationId) ||
    OUTCOME_LEDGER_REPAIR_DIGEST_FIELDS.some(
      (field) =>
        typeof parameters[field] !== "string" ||
        !/^[0-9a-f]{64}$/.test(parameters[field]),
    )
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_intent_invalid",
      "Outcome ledger repair operation and receipt digests must be lowercase SHA-256 values.",
    );
  }
  if (
    OUTCOME_LEDGER_REPAIR_INTEGER_FIELDS.some(
      (field) =>
        !Number.isSafeInteger(parameters[field]) || parameters[field] < 0,
    ) ||
    !Number.isSafeInteger(parameters.trustedCount + parameters.rejectedCount) ||
    parameters.trustedCount + parameters.rejectedCount !==
      parameters.sourceLineCount ||
    parameters.archiveDigest !== parameters.sourceDigest
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_intent_invalid",
      "Outcome ledger repair receipt counts, sizes, or archive identity are inconsistent.",
    );
  }

  const expectedOperationId = createHash("sha256")
    .update(
      JSON.stringify(
        canonicalIntentValue(
          outcomeLedgerRepairOperationSeed(taskId, parameters),
        ),
      ),
      "utf8",
    )
    .digest("hex");
  if (parameters.operationId !== expectedOperationId) {
    throw new AutomationControlError(
      "outcome_ledger_repair_intent_invalid",
      "Outcome ledger repair operation identity does not match its canonical receipt parameters.",
    );
  }

  return Object.fromEntries(
    OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS.map((key) => [key, parameters[key]]),
  );
}

function normalizeOutcomeRecordParameters(value, stateRoot, taskId) {
  const parameters = requireExactPlainObject(
    value,
    "outcome record parameters",
  );
  const actualKeys = Object.keys(parameters).sort();
  if (
    actualKeys.length !== OUTCOME_RECORD_PARAMETER_KEYS.length ||
    actualKeys.some(
      (key, index) => key !== OUTCOME_RECORD_PARAMETER_KEYS[index],
    )
  ) {
    throw new AutomationControlError(
      "outcome_record_intent_invalid",
      "Outcome record parameters must contain the exact composite field set.",
      { expectedKeys: [...OUTCOME_RECORD_PARAMETER_KEYS], actualKeys },
    );
  }

  let canonicalStateRoot;
  try {
    canonicalStateRoot = realpathSync(resolveAutomationStateRoot(stateRoot));
  } catch {
    throw new AutomationControlError(
      "outcome_record_intent_invalid",
      "Outcome record stateRoot must resolve to the current physical automation state root.",
    );
  }
  requireIdentifier(taskId, "taskId");
  const cleanEntry = requireExactPlainObject(
    parameters.cleanEntry,
    "outcome record cleanEntry",
  );
  const sourceTaskDetails = requireExactPlainObject(
    parameters.sourceTaskDetails,
    "outcome record sourceTaskDetails",
  );
  const sourceTask = requireExactPlainObject(
    parameters.sourceTask,
    "outcome record sourceTask",
  );
  const legacyTransition =
    parameters.legacyTransition === null
      ? null
      : requireExactPlainObject(
          parameters.legacyTransition,
          "outcome record legacyTransition",
        );
  const entryKeys = Object.keys(cleanEntry);
  const allowedEntryKeys = new Set([
    "build",
    "buildIdentity",
    "effect",
    "evidence",
    "evidenceWindowEnd",
    "id",
    "kind",
    "notes",
    "outcome",
    "pr",
    "runDir",
    "schemaVersion",
    "taskId",
    "ts",
  ]);
  const entryTimestampMs = Date.parse(String(cleanEntry.ts ?? ""));
  if (
    parameters.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    parameters.policy !== OUTCOME_RECORD_POLICY ||
    parameters.stateRoot !== canonicalStateRoot ||
    parameters.ledgerPath !== path.join(canonicalStateRoot, "outcomes.jsonl") ||
    !TASK_STATES.includes(parameters.sourceTaskState) ||
    !Number.isSafeInteger(parameters.sourceTaskRevision) ||
    parameters.sourceTaskRevision < 1 ||
    !["transition", "legacy-backfill"].includes(parameters.route) ||
    typeof parameters.outcomeDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(parameters.outcomeDigest) ||
    entryKeys.some((key) => !allowedEntryKeys.has(key)) ||
    cleanEntry.schemaVersion !== OUTCOME_LEDGER_SCHEMA_VERSION ||
    cleanEntry.taskId !== taskId ||
    typeof cleanEntry.id !== "string" ||
    cleanEntry.id.length === 0 ||
    typeof cleanEntry.kind !== "string" ||
    cleanEntry.kind.length === 0 ||
    !OUTCOME_TASK_STATES.has(cleanEntry.outcome) ||
    !Number.isFinite(entryTimestampMs) ||
    new Date(entryTimestampMs).toISOString() !== cleanEntry.ts ||
    cleanEntry.authentication !== undefined ||
    typeof cleanEntry.notes !== "string" ||
    cleanEntry.evidence === null ||
    typeof cleanEntry.evidence !== "object" ||
    Array.isArray(cleanEntry.evidence)
  ) {
    throw new AutomationControlError(
      "outcome_record_intent_invalid",
      "Outcome record parameters do not match the canonical composite contract.",
    );
  }
  canonicalIntentValue(cleanEntry);
  canonicalIntentValue(sourceTaskDetails);
  canonicalIntentValue(sourceTask);
  if (legacyTransition !== null) canonicalIntentValue(legacyTransition);
  if (
    sourceTask.taskId !== taskId ||
    sourceTask.state !== parameters.sourceTaskState ||
    sourceTask.revision !== parameters.sourceTaskRevision ||
    !canonicalValuesEqual(sourceTask.details ?? {}, sourceTaskDetails)
  ) {
    throw new AutomationControlError(
      "outcome_record_intent_invalid",
      "Outcome record source task does not match its lifecycle fields.",
    );
  }
  if (
    createHash("sha256").update(JSON.stringify(cleanEntry)).digest("hex") !==
    parameters.outcomeDigest
  ) {
    throw new AutomationControlError(
      "outcome_record_intent_invalid",
      "Outcome record digest does not match the normalized ledger row.",
    );
  }
  if (
    (cleanEntry.buildIdentity === undefined) !==
      (cleanEntry.build === undefined) ||
    (cleanEntry.buildIdentity !== undefined &&
      (JSON.stringify(
        normalizeInstalledBuildIdentity(
          cleanEntry.buildIdentity,
          "outcome record buildIdentity",
        ),
      ) !== JSON.stringify(cleanEntry.buildIdentity) ||
        cleanEntry.build !== cleanEntry.buildIdentity.version)) ||
    (cleanEntry.outcome === "installed" &&
      cleanEntry.buildIdentity === undefined)
  ) {
    throw new AutomationControlError(
      "outcome_record_intent_invalid",
      "Outcome record build identity is not canonical.",
    );
  }
  if (parameters.route === "transition") {
    if (
      legacyTransition !== null ||
      parameters.legacyTransitionEventId !== null ||
      parameters.sourceTaskState === cleanEntry.outcome ||
      !TASK_TRANSITIONS[parameters.sourceTaskState].includes(cleanEntry.outcome)
    ) {
      throw new AutomationControlError(
        "outcome_record_intent_invalid",
        "Outcome transition route does not match the source lifecycle state.",
      );
    }
  } else if (
    parameters.sourceTaskState !== cleanEntry.outcome ||
    typeof parameters.legacyTransitionEventId !== "string" ||
    !IDENTIFIER_PATTERN.test(parameters.legacyTransitionEventId) ||
    legacyTransition?.eventId !== parameters.legacyTransitionEventId ||
    legacyTransition?.type !== "task_transitioned" ||
    legacyTransition?.taskId !== taskId ||
    legacyTransition?.taskRevision !== parameters.sourceTaskRevision ||
    legacyTransition?.data?.toState !== cleanEntry.outcome
  ) {
    throw new AutomationControlError(
      "outcome_record_intent_invalid",
      "Outcome backfill route requires one exact legacy lifecycle event.",
    );
  }
  return Object.fromEntries(
    OUTCOME_RECORD_PARAMETER_KEYS.map((key) => [
      key,
      [
        "cleanEntry",
        "legacyTransition",
        "sourceTask",
        "sourceTaskDetails",
      ].includes(key)
        ? structuredClone(parameters[key])
        : parameters[key],
    ]),
  );
}

export function outcomeRecordOwnerIntent({ stateRoot, taskId, parameters }) {
  const normalizedParameters = normalizeOutcomeRecordParameters(
    parameters,
    stateRoot,
    taskId,
  );
  const intent = {
    schemaVersion: OWNER_CAPABILITY_SCHEMA_VERSION,
    action: OUTCOME_RECORD_ACTION,
    taskId,
    parameters: normalizedParameters,
  };
  return {
    intent,
    intentDigest: ownerGovernanceIntentDigest(intent),
    parameters: normalizedParameters,
  };
}

function normalizeOutcomeLedgerRepairAuthorization(
  value,
  { taskId, intentDigest },
) {
  const authorization = requireExactPlainObject(
    value,
    "outcome ledger repair authorization provenance",
  );
  const commonKeys = ["credentialKind", "leaseAcquiredAt", "leaseName"];
  const capabilityKeys = [
    ...commonKeys,
    "ownerCapabilityId",
    "ownerCapabilityIntentDigest",
    "ownerCapabilityTaskId",
  ].sort();
  const confirmationKeys = [
    ...commonKeys,
    "ownerConfirmationApprovalReference",
    "ownerConfirmationApprovedAt",
    "ownerConfirmationApprovedBy",
    "ownerConfirmationDigest",
    "ownerConfirmationExpiresAt",
    "ownerConfirmationId",
    "ownerConfirmationIntentDigest",
    "ownerConfirmationReference",
    "ownerConfirmationTaskId",
  ].sort();
  const actualKeys = Object.keys(authorization).sort();
  const expectedKeys =
    authorization.credentialKind === "owner-signed-capability"
      ? capabilityKeys
      : authorization.credentialKind === "owner-confirmation"
        ? confirmationKeys
        : [];
  const acquiredAtMs = Date.parse(String(authorization.leaseAcquiredAt ?? ""));
  if (
    authorization.leaseName !== "owner-governance" ||
    expectedKeys.length === 0 ||
    JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys) ||
    !Number.isFinite(acquiredAtMs) ||
    new Date(acquiredAtMs).toISOString() !== authorization.leaseAcquiredAt
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_event_invalid",
      "Outcome ledger repair authorization provenance is invalid.",
    );
  }
  if (authorization.credentialKind === "owner-signed-capability") {
    if (
      typeof authorization.ownerCapabilityId !== "string" ||
      authorization.ownerCapabilityId.length === 0 ||
      authorization.ownerCapabilityTaskId !== taskId ||
      authorization.ownerCapabilityIntentDigest !== intentDigest
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_event_invalid",
        "Outcome ledger repair capability provenance does not match the intent.",
      );
    }
  } else {
    const timestampFields = [
      "ownerConfirmationApprovedAt",
      "ownerConfirmationExpiresAt",
    ];
    if (
      [
        "ownerConfirmationId",
        "ownerConfirmationDigest",
        "ownerConfirmationReference",
        "ownerConfirmationApprovedBy",
        "ownerConfirmationApprovalReference",
      ].some(
        (field) =>
          typeof authorization[field] !== "string" ||
          authorization[field].length === 0,
      ) ||
      authorization.ownerConfirmationTaskId !== taskId ||
      authorization.ownerConfirmationIntentDigest !== intentDigest ||
      !/^[0-9a-f]{64}$/.test(authorization.ownerConfirmationDigest) ||
      timestampFields.some((field) => {
        const value = authorization[field];
        const parsed = Date.parse(String(value ?? ""));
        return !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value;
      })
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_event_invalid",
        "Outcome ledger repair confirmation provenance does not match the intent.",
      );
    }
  }
  return Object.fromEntries(
    expectedKeys.map((key) => [key, authorization[key]]),
  );
}

export function validateOutcomeLedgerRepairEvent(
  event,
  { stateRoot, taskId, parameters, intentDigest },
) {
  const normalizedParameters = normalizeOutcomeLedgerRepairParameters(
    parameters,
    stateRoot,
    taskId,
  );
  const expectedIntentDigest = ownerOperationIntentDigest(
    "freed-owner",
    OUTCOME_LEDGER_REPAIR_ACTION,
    taskId,
    normalizedParameters,
  );
  const timestampMs = Date.parse(String(event?.ts ?? ""));
  if (
    !event ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    JSON.stringify(Object.keys(event).sort()) !==
      JSON.stringify(
        ["actor", "data", "eventId", "schemaVersion", "taskId", "ts", "type"].sort(),
      ) ||
    event.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    event.eventId !== outcomeLedgerRepairEventId(normalizedParameters.operationId) ||
    event.type !== OUTCOME_LEDGER_REPAIR_EVENT_TYPE ||
    event.actor !== "freed-owner" ||
    event.taskId !== taskId ||
    !Number.isFinite(timestampMs) ||
    new Date(timestampMs).toISOString() !== event.ts ||
    JSON.stringify(Object.keys(event.data ?? {}).sort()) !==
      JSON.stringify(["authorization", "intentDigest", "parameters"].sort()) ||
    event.data.intentDigest !== intentDigest ||
    intentDigest !== expectedIntentDigest ||
    JSON.stringify(canonicalIntentValue(event.data.parameters)) !==
      JSON.stringify(canonicalIntentValue(normalizedParameters))
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_event_invalid",
      "Outcome ledger repair event does not match its exact owner intent.",
    );
  }
  normalizeOutcomeLedgerRepairAuthorization(event.data.authorization, {
    taskId,
    intentDigest,
  });
  return structuredClone(event);
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

export function installedOutcomeIdentityMatches({
  outcome,
  build,
  buildIdentity,
  transitionEvent,
  task = undefined,
}) {
  if (outcome !== "installed") return true;
  try {
    const ledgerIdentity = normalizeInstalledBuildIdentity(
      buildIdentity,
      "outcome buildIdentity",
    );
    const transitionIdentity = normalizeInstalledBuildIdentity(
      transitionEvent?.data?.installedIdentity,
      "outcome transition installedIdentity",
    );
    const transitionInstalledAt = String(
      transitionEvent?.data?.installedAt ?? "",
    );
    if (
      !canonicalValuesEqual(ledgerIdentity, buildIdentity) ||
      !canonicalValuesEqual(
        transitionIdentity,
        transitionEvent?.data?.installedIdentity,
      ) ||
      !canonicalValuesEqual(ledgerIdentity, transitionIdentity) ||
      build !== ledgerIdentity.version ||
      transitionEvent?.data?.installedBuild !== ledgerIdentity.version ||
      !Number.isFinite(Date.parse(transitionInstalledAt))
    ) {
      return false;
    }
    if (task === undefined) return true;

    const taskIdentity = normalizeInstalledBuildIdentity(
      task.installedIdentity,
      "task installedIdentity",
    );
    const latestBuildIdentity = normalizeInstalledBuildIdentity(
      task.details?.latestOutcome?.buildIdentity,
      "task latestOutcome buildIdentity",
    );
    const latestInstalledIdentity = normalizeInstalledBuildIdentity(
      task.details?.latestOutcome?.installedIdentity,
      "task latestOutcome installedIdentity",
    );
    const detailsInstalledIdentity = normalizeInstalledBuildIdentity(
      task.details?.installedIdentity,
      "task details installedIdentity",
    );
    return (
      canonicalValuesEqual(taskIdentity, task.installedIdentity) &&
      canonicalValuesEqual(
        latestBuildIdentity,
        task.details?.latestOutcome?.buildIdentity,
      ) &&
      canonicalValuesEqual(
        latestInstalledIdentity,
        task.details?.latestOutcome?.installedIdentity,
      ) &&
      canonicalValuesEqual(
        detailsInstalledIdentity,
        task.details?.installedIdentity,
      ) &&
      canonicalValuesEqual(ledgerIdentity, taskIdentity) &&
      canonicalValuesEqual(ledgerIdentity, latestBuildIdentity) &&
      canonicalValuesEqual(ledgerIdentity, latestInstalledIdentity) &&
      canonicalValuesEqual(ledgerIdentity, detailsInstalledIdentity) &&
      task.installedBuild === ledgerIdentity.version &&
      task.installedAt === transitionInstalledAt &&
      task.details?.latestOutcome?.build === ledgerIdentity.version
    );
  } catch {
    return false;
  }
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
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) {
      throw error;
    }
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

function ensureDurablePrivateDirectoryUnder(
  privateRoot,
  directoryPath,
  checkpoint = undefined,
) {
  const root = path.resolve(privateRoot);
  const target = path.resolve(directoryPath);
  const relative = path.relative(root, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new AutomationControlError(
      "invalid_state_permissions",
      `Private directory ${target} escapes ${root}.`,
    );
  }
  requirePrivateDirectory(root, `Private directory root ${root}`);
  let parent = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const child = path.join(parent, segment);
    let created = false;
    try {
      mkdirSync(child, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    requirePrivateDirectory(child, `Private directory ${child}`);
    if (realpathSync(child) !== child) {
      throw new AutomationControlError(
        "invalid_state_permissions",
        `Private directory ${child} must remain canonical.`,
      );
    }
    if (created) {
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-credential-directory-created",
        { directoryPath: child, parentPath: parent },
      );
    }
    syncDirectory(parent);
    invokeLeaseTransactionCheckpoint(
      checkpoint,
      "lease-credential-directory-parent-synced",
      { directoryPath: child, parentPath: parent, created },
    );
    syncDirectory(child);
    parent = child;
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

function kernelLockCommand(descriptorIndex) {
  if (process.platform === "darwin") {
    return {
      command: "/usr/bin/lockf",
      args: ["-s", "-t", "0", String(descriptorIndex)],
      busyStatuses: new Set([75]),
    };
  }
  if (process.platform === "linux") {
    return {
      command: "/usr/bin/flock",
      args: ["-n", String(descriptorIndex)],
      busyStatuses: new Set([1]),
    };
  }
  throw new AutomationControlError(
    "invalid_state",
    `Kernel-backed automation guards are unavailable on ${process.platform}.`,
  );
}

function requireKernelGuardMarker(descriptor, label) {
  const kernelGuardMarkerBytes = automationKernelGuardMarkerBytes();
  const stats = fstatSync(descriptor);
  if (stats.size !== kernelGuardMarkerBytes.length) {
    throw new AutomationControlError(
      "invalid_state",
      `${label} does not contain the exact permanent kernel-lock marker.`,
    );
  }
  const bytes = Buffer.alloc(stats.size);
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
  if (offset !== stats.size) {
    throw new AutomationControlError(
      "invalid_state",
      "Legacy automation guard record changed while read.",
    );
  }
  if (
    offset !== stats.size ||
    !bytes.equals(kernelGuardMarkerBytes)
  ) {
    throw new AutomationControlError(
      "invalid_state",
      `${label} does not contain the exact permanent kernel-lock marker.`,
    );
  }
}

function tryAcquireKernelLock(descriptor) {
  const descriptorIndex = 3;
  const contract = kernelLockCommand(descriptorIndex);
  const result = spawnSync(contract.command, contract.args, {
    stdio: ["ignore", "ignore", "ignore", descriptor],
  });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (contract.busyStatuses.has(result.status)) return false;
  throw new AutomationControlError(
    "invalid_state",
    `Kernel-backed automation guard acquisition failed with status ${String(result.status)}.`,
  );
}

function openKernelGuardFile(filePath) {
  if (
    typeof constants.O_NOFOLLOW !== "number" ||
    typeof constants.O_NONBLOCK !== "number"
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Safe kernel-backed automation guards are unavailable.",
    );
  }
  const descriptor = openSync(
    filePath,
    constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = fstatSync(descriptor);
    const current = lstatSync(filePath);
    const expectedUid =
      typeof process.getuid === "function" ? process.getuid() : opened.uid;
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.uid !== expectedUid ||
      (opened.mode & 0o7777) !== 0o600 ||
      current.isSymbolicLink() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      realpathSync(filePath) !== filePath
    ) {
      throw new AutomationControlError(
        "invalid_state_permissions",
        `Automation guard must be a private canonical regular file: ${filePath}`,
      );
    }
    requireKernelGuardMarker(descriptor, "Automation guard");
    return { descriptor, stats: opened };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

export function withKernelFileGuard(
  filePath,
  operation,
  {
    label = path.basename(filePath),
    timeoutMs = INTERNAL_GUARD_TIMEOUT_MS,
    wait = waitSync,
    monotonicNow = () => performance.now(),
  } = {},
) {
  if (typeof operation !== "function") {
    throw new AutomationControlError(
      "invalid_state",
      "Kernel-backed automation guard requires an operation.",
    );
  }
  const startedAt = monotonicNow();
  let descriptor;
  while (descriptor === undefined) {
    const opened = openKernelGuardFile(filePath);
    if (tryAcquireKernelLock(opened.descriptor)) {
      descriptor = opened.descriptor;
      break;
    }
    closeSync(opened.descriptor);
    if (monotonicNow() - startedAt >= timeoutMs) {
      throw new AutomationControlError(
        "guard_timeout",
        `Timed out waiting for the ${label} control-plane guard.`,
      );
    }
    wait(INTERNAL_GUARD_POLL_MS);
  }

  try {
    requireKernelGuardMarker(descriptor, label);
    const locked = fstatSync(descriptor);
    const current = lstatSync(filePath);
    if (
      !locked.isFile() ||
      locked.nlink !== 1 ||
      (locked.mode & 0o7777) !== 0o600 ||
      current.isSymbolicLink() ||
      current.nlink !== 1 ||
      current.dev !== locked.dev ||
      current.ino !== locked.ino ||
      realpathSync(filePath) !== filePath
    ) {
      throw new AutomationControlError(
        "invalid_state",
        `Automation guard changed after acquisition: ${filePath}`,
      );
    }
    syncDirectory(path.dirname(filePath));
    const result = operation();
    if (result && typeof result.then === "function") {
      throw new AutomationControlError(
        "invalid_state",
        "Kernel-backed automation guard callbacks must be synchronous.",
      );
    }
    return result;
  } finally {
    closeSync(descriptor);
  }
}

export function withAutomationOutcomeLedgerWriterGuard(
  ledgerPath,
  operation,
  {
    stateRoot = path.dirname(path.resolve(ledgerPath)),
    timeoutMs = INTERNAL_GUARD_TIMEOUT_MS,
    wait = waitSync,
  } = {},
) {
  if (typeof operation !== "function") {
    throw new AutomationControlError(
      "invalid_argument",
      "Outcome ledger writer guard requires an operation.",
    );
  }
  const paths = automationControlPaths(stateRoot);
  const canonicalLedgerPath = path.resolve(paths.outcomes);
  if (path.resolve(ledgerPath) !== canonicalLedgerPath) {
    throw new AutomationControlError(
      "invalid_argument",
      `Outcome ledger writer guard requires ${canonicalLedgerPath}.`,
    );
  }
  const cutover = requireAutomationKernelGuardCutover(paths);
  return withKernelFileGuard(cutover.paths.writerLock, () => {
    const lockedCutover = requireAutomationKernelGuardCutover(paths);
    if (lockedCutover.paths.writerLock !== cutover.paths.writerLock) {
      throw new AutomationControlError(
        "invalid_state",
        "Outcome ledger writer guard changed during acquisition.",
      );
    }
    return operation();
  }, {
    label: "outcome ledger writer",
    timeoutMs,
    wait,
    monotonicNow: () => performance.now(),
  });
}

function requireAutomationKernelGuardCutover(paths) {
  let inspection;
  try {
    inspection = inspectAutomationKernelGuardCutover(paths.stateRoot);
  } catch (error) {
    throw new AutomationControlError(
      "invalid_state",
      "Automation kernel guard cutover inspection failed closed.",
      { cause: String(error?.message ?? error) },
    );
  }
  if (inspection?.ready !== true) {
    throw new AutomationControlError(
      "invalid_state",
      "Automation kernel guard cutover is incomplete.",
      { problems: inspection?.problems ?? [] },
    );
  }
  return inspection;
}

function withFilesystemGuard(
  paths,
  name,
  callback,
  { timeoutMs = INTERNAL_GUARD_TIMEOUT_MS } = {},
) {
  if (!AUTOMATION_KERNEL_GUARD_NAMES.includes(name)) {
    throw new AutomationControlError(
      "invalid_argument",
      `Automation guard ${name} is not part of the permanent cutover contract.`,
    );
  }
  const cutover = requireAutomationKernelGuardCutover(paths);
  const guardPath = cutover.paths.guards[name]?.inner;
  if (typeof guardPath !== "string") {
    throw new AutomationControlError(
      "invalid_state",
      `Automation guard ${name} is absent from the cutover receipt.`,
    );
  }
  return withKernelFileGuard(guardPath, () => {
    const lockedCutover = requireAutomationKernelGuardCutover(paths);
    if (lockedCutover.paths.guards[name]?.inner !== guardPath) {
      throw new AutomationControlError(
        "invalid_state",
        `Automation guard ${name} changed during acquisition.`,
      );
    }
    return callback();
  }, {
    label: name,
    timeoutMs,
    wait: waitSync,
    monotonicNow: () => performance.now(),
  });
}

const ACTIVE_LEASE_EVENTS_GUARDS = new WeakSet();

function requireActiveLeaseEventsGuard(token) {
  if (
    token === null ||
    typeof token !== "object" ||
    !ACTIVE_LEASE_EVENTS_GUARDS.has(token)
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Lease mutation requires its active events guard scope.",
    );
  }
}

function withActiveLeaseEventsGuard(paths, callback) {
  return withFilesystemGuard(paths, "events", () => {
        const token = Object.freeze({});
        ACTIVE_LEASE_EVENTS_GUARDS.add(token);
        try {
          const result = callback(token);
          if (result && typeof result.then === "function") {
            throw new AutomationControlError(
              "invalid_argument",
              "Lease mutation archive guards require synchronous work.",
            );
          }
          return result;
        } finally {
          ACTIVE_LEASE_EVENTS_GUARDS.delete(token);
        }
      });
}

function withLeaseMutationArchiveGuard(paths, name, callback, options = {}) {
  return withFilesystemGuard(
    paths,
    `lease-${name}`,
    () => withActiveLeaseEventsGuard(paths, callback),
    options,
  );
}

function emptyTaskManifest(nowMs) {
  return {
    schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
    revision: 0,
    updatedAt: nowIso(nowMs),
    tasks: [],
  };
}

export function validateTaskManifest(manifest) {
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
          !OUTCOME_TASK_STATES.has(task.pendingOutcome.outcome) ||
          task.pendingOutcome.outcome !== task.state ||
          !/^[0-9a-f]{64}$/i.test(
            String(task.pendingOutcome.outcomeDigest ?? ""),
          ) ||
          task.pendingOutcome.outcomeDigest !==
            String(task.pendingOutcome.outcomeDigest).toLowerCase() ||
          !Number.isSafeInteger(task.pendingOutcome.taskRevision) ||
          task.pendingOutcome.taskRevision !== task.revision ||
          task.details?.latestOutcome?.outcome !==
            task.pendingOutcome.outcome ||
          !/^[0-9a-f]{64}$/i.test(
            String(task.details?.latestOutcome?.outcomeDigest ?? ""),
          ) ||
          String(task.details.latestOutcome.outcomeDigest).toLowerCase() !==
            task.pendingOutcome.outcomeDigest)) ||
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

function recoverTaskTransactionsUnlocked(
  paths,
  nowMs,
  { beforeMutation = () => {} } = {},
) {
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
      beforeMutation();
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
      beforeMutation();
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
      appendEventLine(paths, transaction.event, {
        now: () => nowMs,
        beforeAccess: beforeMutation,
      });
    }
    beforeMutation();
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

function readTaskUnderMutationAuthority({
  stateRoot,
  taskId,
  nowMs,
  authorityContext,
}) {
  requireIdentifier(taskId, "taskId");
  const paths = automationControlPaths(stateRoot);
  return withFilesystemGuard(paths, "tasks", () => {
    authorityContext.reauthorize();
    recoverTaskTransactionsUnlocked(paths, nowMs, {
      beforeMutation: () => authorityContext.reauthorize(),
    });
    authorityContext.reauthorize();
    const manifest = readTaskManifestUnchecked({
      stateRoot: paths.stateRoot,
      nowMs,
    });
    return manifest.tasks.find((task) => task.taskId === taskId) ?? null;
  });
}

function readControlEventHistorySnapshot(filePath) {
  if (
    typeof constants.O_NOFOLLOW !== "number" ||
    typeof constants.O_NONBLOCK !== "number"
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Safe nonblocking control event admission is unavailable.",
    );
  }
  let descriptor;
  try {
    descriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { bytes: Buffer.alloc(0), events: [] };
    }
    throw error;
  }
  try {
    const before = fstatSync(descriptor);
    const expectedUid =
      typeof process.getuid === "function" ? process.getuid() : before.uid;
    if (
      !before.isFile() ||
      before.uid !== expectedUid ||
      (before.mode & 0o777) !== 0o600 ||
      before.size < 0 ||
      before.size > CONTROL_EVENT_HISTORY_MAX_BYTES ||
      realpathSync(filePath) !== filePath
    ) {
      throw new AutomationControlError(
        "invalid_state",
        `Control event history is unsafe: ${filePath}`,
      );
    }
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor);
    const current = lstatSync(filePath);
    if (
      offset !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      current.isSymbolicLink() ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      realpathSync(filePath) !== filePath
    ) {
      throw new AutomationControlError(
        "invalid_state",
        `Control event history changed while read: ${filePath}`,
      );
    }
    const bytes = buffer.subarray(0, offset);
    let text;
    try {
      text = controlEventHistoryDecoder.decode(bytes);
    } catch {
      throw new AutomationControlError(
        "invalid_state",
        "Control event history is not valid UTF-8.",
      );
    }
    const events = [];
    for (const [index, raw] of text.split(/\r?\n/).entries()) {
      if (!raw.trim()) continue;
      try {
        events.push(JSON.parse(raw));
      } catch {
        throw new AutomationControlError(
          "invalid_state",
          `Control event history contains malformed JSON at line ${index + 1}.`,
        );
      }
    }
    return { bytes, events };
  } finally {
    closeSync(descriptor);
  }
}

function prepareControlEventAppend(existingBytes, event) {
  const separator =
    existingBytes.length > 0 && existingBytes[existingBytes.length - 1] !== 0x0a
      ? Buffer.from("\n", "utf8")
      : Buffer.alloc(0);
  const eventBytes = Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
  if (
    eventBytes.length > CONTROL_EVENT_MAX_LINE_BYTES ||
    existingBytes.length + separator.length + eventBytes.length >
    CONTROL_EVENT_HISTORY_MAX_BYTES
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Control event append would exceed the supported history boundary.",
    );
  }
  return { separator, eventBytes };
}

function appendEventLineUnlocked(
  paths,
  event,
  existingBytes,
  { beforeRename = () => {} } = {},
) {
  const directoryPath = path.dirname(paths.events);
  mkdirSync(directoryPath, { recursive: true });
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(paths.events)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const { separator, eventBytes } = prepareControlEventAppend(
    existingBytes,
    event,
  );
  let fileFd;
  try {
    fileFd = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(fileFd, existingBytes);
    if (separator.length > 0) writeFileSync(fileFd, separator);
    writeFileSync(fileFd, eventBytes);
    fsyncSync(fileFd);
    closeSync(fileFd);
    fileFd = undefined;
    beforeRename();
    renameSync(temporaryPath, paths.events);
    syncDirectory(directoryPath);
  } finally {
    if (fileFd !== undefined) closeSync(fileFd);
    rmSync(temporaryPath, { force: true });
  }
}

function appendEventLine(
  paths,
  event,
  { now = () => Date.now(), beforeAccess = () => {} } = {},
) {
  withFilesystemGuard(
    paths,
    "events",
    () => {
      beforeAccess();
      const snapshot = readControlEventHistorySnapshot(paths.events);
      beforeAccess();
      appendEventLineUnlocked(paths, event, snapshot.bytes, {
        beforeRename: beforeAccess,
      });
    },
    { now },
  );
  return event;
}

function appendDeterministicEventLineUnlocked(
  paths,
  eventId,
  buildEvent,
  {
    nowMs = Date.now(),
    beforeAccess = () => {},
    equivalent = (left, right) =>
      JSON.stringify(canonicalIntentValue(left)) ===
      JSON.stringify(canonicalIntentValue(right)),
  } = {},
) {
  beforeAccess();
  const snapshot = readControlEventHistorySnapshot(paths.events);
  const matches = [];
  for (const event of snapshot.events) {
    if (event?.eventId === eventId) matches.push(event);
  }
  if (matches.length > 1) {
    throw new AutomationControlError(
      "control_event_duplicate",
      `Control event history contains duplicate event ${eventId}.`,
      { eventId, count: matches.length },
    );
  }
  if (matches.length === 1) {
    const existing = matches[0];
    const existingTimestampMs = Date.parse(String(existing.ts ?? ""));
    const expected = buildEvent(existing.ts);
    let matchesExpected = false;
    try {
      matchesExpected = equivalent(existing, expected);
    } catch {
      matchesExpected = false;
    }
    if (
      !Number.isFinite(existingTimestampMs) ||
      new Date(existingTimestampMs).toISOString() !== existing.ts ||
      !matchesExpected
    ) {
      throw new AutomationControlError(
        "control_event_conflict",
        `Control event ${eventId} conflicts with this repair receipt.`,
        { eventId },
      );
    }
    return existing;
  }

  const event = buildEvent(nowIso(nowMs));
  appendEventLineUnlocked(paths, event, snapshot.bytes, {
    beforeRename: beforeAccess,
  });
  return event;
}

function appendDeterministicEventLine(
  paths,
  eventId,
  buildEvent,
  options = {},
) {
  return withFilesystemGuard(
    paths,
    "events",
    () =>
      appendDeterministicEventLineUnlocked(
        paths,
        eventId,
        buildEvent,
        options,
      ),
    { now: options.guardNow ?? (() => Date.now()) },
  );
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
  const authority = {
    stateRoot: paths.stateRoot,
    actor,
    leaseName,
    leaseToken,
    taskId,
    ownerIntentDigest: ownerOperationIntentDigest(
      actor,
      "event.append",
      taskId,
      { type, data: normalizedData },
    ),
  };
  return withMutationLeaseAuthority(authority, (authorityContext) => {
    const authorize = () => {
      const { policy } = requireMutationLease({
        ...authority,
        authorityContext,
      });
      if (!policy.canAppendEvent) {
        throw new AutomationControlError(
          "actor_not_authorized",
          `Actor ${actor} cannot append control events.`,
          { actor },
        );
      }
    };
    authorize();
    const event = {
      schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
      eventId,
      type,
      ts: nowIso(nowMs),
      actor,
      ...(taskId === undefined ? {} : { taskId }),
      data: normalizedData,
    };
    return appendEventLine(paths, event, {
      now: () => nowMs,
      beforeAccess: authorize,
    });
  });
}

export function appendOutcomeControlEvent(options) {
  const {
    stateRoot,
    actor,
    leaseName,
    leaseToken,
    data = {},
    taskId,
    nowMs = Date.now(),
    eventId,
    guardContext = null,
  } = options;
  const paths = automationControlPaths(stateRoot);
  requireIdentifier(eventId, "eventId");
  requireNonemptyString(actor, "actor");
  requireIdentifier(taskId, "taskId");
  const normalizedData = requirePlainObject(data, "event data");
  const authorizationClock = () => Date.now();
  const compositeOwnerIntentDigest = requireOwnerOutcomeEventStep({
    actor,
    taskId,
    guardContext,
    leaseName,
    eventId,
    data: normalizedData,
  });
  const authority = {
    stateRoot: paths.stateRoot,
    actor,
    leaseName,
    leaseToken,
    taskId,
    ownerIntentDigest:
      compositeOwnerIntentDigest ??
      ownerOperationIntentDigest(actor, "event.append", taskId, {
        type: "outcome_recorded",
        data: normalizedData,
      }),
  };
  const existingAuthorityContext = guardContext?.authorityContext ?? null;
  if (
    guardContext?.token === OUTCOME_RECORDING_GUARD &&
    guardContext.paths.stateRoot !== paths.stateRoot
  ) {
    throw new AutomationControlError(
      "invalid_argument",
      "Outcome recording guard belongs to a different state root.",
    );
  }
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    existingAuthorityContext,
    (authorityContext) => {
      const authorize = () => {
        const { policy } = requireMutationLease({
          ...authority,
          authorityContext,
        });
        if (!policy.canAppendEvent) {
          throw new AutomationControlError(
            "actor_not_authorized",
            `Actor ${actor} cannot append control events.`,
            { actor },
          );
        }
      };
      authorize();
      const append =
        guardContext?.token === OUTCOME_RECORDING_GUARD
          ? appendDeterministicEventLineUnlocked
          : appendDeterministicEventLine;
      return append(
        paths,
        eventId,
        (ts) => ({
          schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
          eventId,
          type: "outcome_recorded",
          ts,
          actor,
          taskId,
          data: normalizedData,
        }),
        {
          nowMs,
          guardNow: authorizationClock,
          beforeAccess: authorize,
        },
      );
    },
  );
}

function authorizeOutcomeLedgerRepairLease({
  stateRoot,
  taskId,
  actor,
  leaseName,
  leaseToken,
  parameters,
  nowMs = Date.now(),
  authorityContext = null,
}) {
  requireIdentifier(taskId, "taskId");
  if (actor !== "freed-owner" || leaseName !== "owner-governance") {
    throw new AutomationControlError(
      "actor_not_authorized",
      "Outcome ledger history repair requires freed-owner and the owner-governance lease.",
      { actor, leaseName },
    );
  }
  const normalizedParameters = normalizeOutcomeLedgerRepairParameters(
    parameters,
    stateRoot,
    taskId,
  );
  const intentDigest = ownerOperationIntentDigest(
    actor,
    OUTCOME_LEDGER_REPAIR_ACTION,
    taskId,
    normalizedParameters,
  );
  const authority = {
    stateRoot,
    actor,
    leaseName,
    leaseToken,
    taskId,
    ownerIntentDigest: intentDigest,
  };
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    authorityContext,
    (scopedAuthorityContext) => {
      const { lease } = requireMutationLease({
        ...authority,
        authorityContext: scopedAuthorityContext,
      });
      return {
        action: OUTCOME_LEDGER_REPAIR_ACTION,
        taskId,
        eventId: outcomeLedgerRepairEventId(normalizedParameters.operationId),
        intentDigest,
        parameters: normalizedParameters,
        authorizationProvenance: leaseAuthorizationProvenance(lease),
      };
    },
  );
}

export function reauthorizeOutcomeLedgerRepairLease(options) {
  return authorizeOutcomeLedgerRepairLease({
    ...options,
    nowMs: options.nowMs ?? Date.now(),
  });
}

export function preauthorizeOutcomeLedgerRepair(options) {
  const nowMs = options.nowMs ?? Date.now();
  requireIdentifier(options.taskId, "taskId");
  if (
    options.actor !== "freed-owner" ||
    options.leaseName !== "owner-governance"
  ) {
    throw new AutomationControlError(
      "actor_not_authorized",
      "Outcome ledger history repair requires freed-owner and the owner-governance lease.",
      { actor: options.actor, leaseName: options.leaseName },
    );
  }
  const normalizedParameters = normalizeOutcomeLedgerRepairParameters(
    options.parameters,
    options.stateRoot,
    options.taskId,
  );
  const authority = {
    stateRoot: options.stateRoot,
    actor: options.actor,
    leaseName: options.leaseName,
    leaseToken: options.leaseToken,
    taskId: options.taskId,
    ownerIntentDigest: ownerOperationIntentDigest(
      options.actor,
      OUTCOME_LEDGER_REPAIR_ACTION,
      options.taskId,
      normalizedParameters,
    ),
  };
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    options.authorityContext ?? null,
    (authorityContext) => {
      if (!readTaskUnderMutationAuthority({
        stateRoot: options.stateRoot,
        taskId: options.taskId,
        nowMs,
        authorityContext,
      })) {
        throw new AutomationControlError(
          "task_not_found",
          `Task ${options.taskId} does not exist.`,
          { taskId: options.taskId },
        );
      }
      return authorizeOutcomeLedgerRepairLease({
        ...options,
        parameters: normalizedParameters,
        nowMs,
        authorityContext,
      });
    },
  );
}

function buildOutcomeLedgerRepairEvent(authorization, ts) {
  return {
    schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
    eventId: authorization.eventId,
    type: OUTCOME_LEDGER_REPAIR_EVENT_TYPE,
    ts,
    actor: "freed-owner",
    taskId: authorization.taskId,
    data: {
      intentDigest: authorization.intentDigest,
      parameters: authorization.parameters,
      authorization: authorization.authorizationProvenance,
    },
  };
}

function validateEquivalentOutcomeLedgerRepairEvents(
  existing,
  expected,
  options,
  authorization,
) {
  validateOutcomeLedgerRepairEvent(existing, {
    stateRoot: options.stateRoot,
    taskId: authorization.taskId,
    parameters: authorization.parameters,
    intentDigest: authorization.intentDigest,
  });
  validateOutcomeLedgerRepairEvent(expected, {
    stateRoot: options.stateRoot,
    taskId: authorization.taskId,
    parameters: authorization.parameters,
    intentDigest: authorization.intentDigest,
  });
  return true;
}

function appendOutcomeLedgerRepairEventUnlocked(
  options,
  paths,
  { beforeAppend = () => {} } = {},
) {
  const explicitNowMs = options.nowMs;
  const nowMs = explicitNowMs ?? Date.now();
  let authorization = authorizeOutcomeLedgerRepairLease({
    ...options,
    nowMs,
  });
  return appendDeterministicEventLineUnlocked(
    paths,
    authorization.eventId,
    (ts) => buildOutcomeLedgerRepairEvent(authorization, ts),
    {
      nowMs,
      beforeAccess: () => {
        authorization = authorizeOutcomeLedgerRepairLease({
          ...options,
          nowMs: explicitNowMs ?? Date.now(),
        });
        beforeAppend();
      },
      equivalent: (existing, expected) =>
        validateEquivalentOutcomeLedgerRepairEvents(
          existing,
          expected,
          options,
          authorization,
        ),
    },
  );
}

function preflightOutcomeLedgerRepairEventUnlocked(options, paths) {
  const explicitNowMs = options.nowMs;
  const nowMs = explicitNowMs ?? Date.now();
  const authorization = authorizeOutcomeLedgerRepairLease({
    ...options,
    nowMs,
  });
  const snapshot = readControlEventHistorySnapshot(paths.events);
  const matches = snapshot.events.filter(
    (event) => event?.eventId === authorization.eventId,
  );
  if (matches.length > 1) {
    throw new AutomationControlError(
      "control_event_duplicate",
      `Control event history contains duplicate event ${authorization.eventId}.`,
    );
  }
  if (matches.length === 1) {
    const existing = matches[0];
    try {
      validateEquivalentOutcomeLedgerRepairEvents(
        existing,
        buildOutcomeLedgerRepairEvent(authorization, existing.ts),
        options,
        authorization,
      );
    } catch {
      throw new AutomationControlError(
        "control_event_conflict",
        `Control event ${authorization.eventId} conflicts with this repair receipt.`,
        { eventId: authorization.eventId },
      );
    }
    return { existing: true, event: existing };
  }
  const event = buildOutcomeLedgerRepairEvent(authorization, nowIso(nowMs));
  const eventBytes = Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
  const separatorBytes =
    snapshot.bytes.length > 0 && snapshot.bytes[snapshot.bytes.length - 1] !== 0x0a
      ? 1
      : 0;
  if (
    eventBytes.length > CONTROL_EVENT_MAX_LINE_BYTES ||
    snapshot.bytes.length + separatorBytes + eventBytes.length >
      CONTROL_EVENT_HISTORY_MAX_BYTES
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Outcome ledger repair audit event has no durable history capacity.",
    );
  }
  return { existing: false, event };
}

function exactOutcomeLedgerRepairKeys(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expectedKeys)
  );
}

function outcomeLedgerRepairTransactionIdentity(paths, taskId, parameters) {
  const artifactDirectory = path.join(
    paths.stateRoot,
    "artifacts",
    "outcome-ledger-repair",
    taskId,
    parameters.sourceDigest,
    parameters.operationId,
  );
  return {
    transactionPath: path.join(
      paths.controlRoot,
      "outcome-ledger-transactions",
      `${parameters.operationId}.json`,
    ),
    artifacts: {
      source: path.join(
        artifactDirectory,
        `source-${parameters.sourceDigest}.jsonl`,
      ),
      trusted: path.join(artifactDirectory, "trusted.jsonl"),
      rejected: path.join(artifactDirectory, "rejected.jsonl"),
      decisions: path.join(artifactDirectory, "decisions.json"),
      receipt: path.join(artifactDirectory, "receipt.json"),
    },
  };
}

function outcomeLedgerRepairReceipt(
  taskId,
  eventId,
  parameters,
  artifacts,
) {
  const core = {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
    status: "complete",
    taskId,
    operationId: parameters.operationId,
    eventId,
    stateRoot: parameters.stateRoot,
    ledgerPath: parameters.ledgerPath,
    sourceArtifact: artifacts.source,
    trustedArtifact: artifacts.trusted,
    rejectedArtifact: artifacts.rejected,
    decisionsArtifact: artifacts.decisions,
    sourceDigest: parameters.sourceDigest,
    sourceSize: parameters.sourceSize,
    sourceLineCount: parameters.sourceLineCount,
    eventHistoryDigest: parameters.eventHistoryDigest,
    eventHistorySize: parameters.eventHistorySize,
    trustedCount: parameters.trustedCount,
    rejectedCount: parameters.rejectedCount,
    replacementDigest: parameters.replacementDigest,
    replacementSize: parameters.replacementSize,
    archiveDigest: parameters.archiveDigest,
    decisionsDigest: parameters.decisionsDigest,
  };
  const receiptDigest = createHash("sha256")
    .update(JSON.stringify(canonicalIntentValue(core)), "utf8")
    .digest("hex");
  return { ...core, receiptDigest };
}

function outcomeLedgerRepairArtifactBytes(filePath, label, paths, options = {}) {
  return readPrivateBytes(filePath, label, {
    privateRoot: paths.stateRoot,
    invalidCode: "outcome_ledger_repair_transaction_invalid",
    invalidMessage: `${label} must be one exact private canonical repair artifact.`,
    missingCode: "outcome_ledger_repair_transaction_invalid",
    missingMessage: `${label} is missing from the prepared repair.`,
    ...options,
  });
}

function outcomeLedgerRepairPhysicalLines(bytes) {
  const lines = [];
  let offset = 0;
  let lineNumber = 1;
  while (offset < bytes.length) {
    const newline = bytes.indexOf(0x0a, offset);
    const end = newline === -1 ? bytes.length : newline + 1;
    const raw = bytes.subarray(offset, end);
    let contentEnd = raw.length;
    if (contentEnd > 0 && raw[contentEnd - 1] === 0x0a) contentEnd -= 1;
    if (contentEnd > 0 && raw[contentEnd - 1] === 0x0d) contentEnd -= 1;
    let text;
    try {
      text = privateAuthorityDecoder.decode(raw.subarray(0, contentEnd));
    } catch {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair source artifact is not valid UTF-8.",
      );
    }
    if (!text.trim()) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair source artifact contains a blank physical line.",
      );
    }
    try {
      JSON.parse(text);
    } catch {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair source artifact contains malformed JSON.",
      );
    }
    lines.push({
      lineNumber,
      offset,
      length: raw.length,
      rawDigest: createHash("sha256").update(raw).digest("hex"),
      raw,
    });
    if (lines.length > OUTCOME_LEDGER_REPAIR_MAX_LINES) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair source artifact contains too many physical lines.",
      );
    }
    offset = end;
    lineNumber += 1;
  }
  return lines;
}

function validateOutcomeLedgerRepairArchivedMaterial(
  paths,
  record,
  identity,
  expectedReceipt,
) {
  const parameters = record.parameters;
  const sourceBytes = outcomeLedgerRepairArtifactBytes(
    identity.artifacts.source,
    "Outcome ledger repair source artifact",
    paths,
    { allowEmpty: true, maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES },
  );
  const trustedBytes = outcomeLedgerRepairArtifactBytes(
    identity.artifacts.trusted,
    "Outcome ledger repair trusted artifact",
    paths,
    { allowEmpty: true, maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES },
  );
  const rejectedBytes = outcomeLedgerRepairArtifactBytes(
    identity.artifacts.rejected,
    "Outcome ledger repair rejected artifact",
    paths,
    { allowEmpty: true, maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES },
  );
  const decisionBytes = outcomeLedgerRepairArtifactBytes(
    identity.artifacts.decisions,
    "Outcome ledger repair decisions artifact",
    paths,
    { maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES * 8 },
  );
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  if (
    sourceBytes.length !== parameters.sourceSize ||
    digest(sourceBytes) !== parameters.sourceDigest ||
    trustedBytes.length !== parameters.replacementSize ||
    digest(trustedBytes) !== parameters.replacementDigest ||
    digest(decisionBytes) !== parameters.decisionsDigest
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair prepared artifacts do not match their signed digests.",
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(privateAuthorityDecoder.decode(decisionBytes));
  } catch {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair decisions artifact is not valid canonical JSON.",
    );
  }
  const { lines: decisions, ...actualHeader } = manifest ?? {};
  const expectedHeader = {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
    taskId: record.taskId,
    sourceDigest: parameters.sourceDigest,
    sourceSize: parameters.sourceSize,
    sourceLineCount: parameters.sourceLineCount,
    eventHistoryDigest: parameters.eventHistoryDigest,
    eventHistorySize: parameters.eventHistorySize,
    trustedCount: parameters.trustedCount,
    rejectedCount: parameters.rejectedCount,
    replacementDigest: parameters.replacementDigest,
    replacementSize: parameters.replacementSize,
  };
  if (
    !Array.isArray(decisions) ||
    JSON.stringify(canonicalIntentValue(actualHeader)) !==
      JSON.stringify(canonicalIntentValue(expectedHeader))
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair decision identity changed.",
    );
  }

  const sourceLines = outcomeLedgerRepairPhysicalLines(sourceBytes);
  if (
    sourceLines.length !== parameters.sourceLineCount ||
    decisions.length !== sourceLines.length
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair decisions lost source occurrences.",
    );
  }
  const trustedParts = [];
  const rejectedParts = [];
  let trustedCount = 0;
  let rejectedCount = 0;
  for (const [index, line] of sourceLines.entries()) {
    const decision = decisions[index];
    if (
      decision?.lineNumber !== line.lineNumber ||
      decision?.offset !== line.offset ||
      decision?.length !== line.length ||
      decision?.rawDigest !== line.rawDigest ||
      !["trusted", "rejected"].includes(decision?.disposition) ||
      typeof decision?.reason !== "string" ||
      decision.reason.length === 0
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair decision occurrence changed.",
      );
    }
    if (decision.disposition === "trusted") {
      trustedCount += 1;
      trustedParts.push(line.raw);
    } else {
      rejectedCount += 1;
      rejectedParts.push(line.raw);
    }
  }
  if (
    trustedCount !== parameters.trustedCount ||
    rejectedCount !== parameters.rejectedCount ||
    !trustedBytes.equals(Buffer.concat(trustedParts)) ||
    !rejectedBytes.equals(Buffer.concat(rejectedParts))
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair archived occurrence bytes changed.",
    );
  }

  const receiptBytes = outcomeLedgerRepairArtifactBytes(
    identity.artifacts.receipt,
    "Outcome ledger repair receipt artifact",
    paths,
    {
      allowMissing: record.phase !== "complete",
      maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
    },
  );
  if (receiptBytes !== null) {
    const expectedReceiptBytes = Buffer.from(
      `${JSON.stringify(expectedReceipt, null, 2)}\n`,
      "utf8",
    );
    if (!receiptBytes.equals(expectedReceiptBytes)) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair receipt artifact changed.",
      );
    }
  }
}

function validateOutcomeLedgerRepairTransaction(
  paths,
  {
    taskId,
    parameters,
    intentDigest,
    transactionPath,
    allowedPhases,
  },
) {
  const identity = outcomeLedgerRepairTransactionIdentity(
    paths,
    taskId,
    parameters,
  );
  if (transactionPath !== identity.transactionPath) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair transaction path is not canonical.",
    );
  }
  const record = readPrivateJsonFile(
    identity.transactionPath,
    "Outcome ledger repair transaction",
    {
      privateRoot: paths.controlRoot,
      missingCode: "outcome_ledger_repair_transaction_invalid",
      missingMessage:
        "Outcome ledger repair transaction is missing from its canonical path.",
      invalidCode: "outcome_ledger_repair_transaction_invalid",
      invalidMessage:
        "Outcome ledger repair transaction must be one private canonical JSON record.",
    },
  );
  const expectedEventId = outcomeLedgerRepairEventId(parameters.operationId);
  const expectedReceipt = outcomeLedgerRepairReceipt(
    taskId,
    expectedEventId,
    parameters,
    identity.artifacts,
  );
  if (
    !exactOutcomeLedgerRepairKeys(
      record,
      OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS,
    ) ||
    record.schemaVersion !== OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION ||
    record.policy !== OUTCOME_LEDGER_REPAIR_POLICY ||
    record.taskId !== taskId ||
    record.operationId !== parameters.operationId ||
    record.eventId !== expectedEventId ||
    record.intentDigest !== intentDigest ||
    !allowedPhases.includes(record.phase) ||
    JSON.stringify(canonicalIntentValue(record.parameters)) !==
      JSON.stringify(canonicalIntentValue(parameters)) ||
    !exactOutcomeLedgerRepairKeys(
      record.artifacts,
      OUTCOME_LEDGER_REPAIR_ARTIFACT_KEYS,
    ) ||
    JSON.stringify(canonicalIntentValue(record.artifacts)) !==
      JSON.stringify(canonicalIntentValue(identity.artifacts)) ||
    !exactOutcomeLedgerRepairKeys(
      record.receipt,
      OUTCOME_LEDGER_REPAIR_RECEIPT_KEYS,
    ) ||
    parameters.receiptDigest !== expectedReceipt.receiptDigest ||
    JSON.stringify(canonicalIntentValue(record.receipt)) !==
      JSON.stringify(canonicalIntentValue(expectedReceipt))
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair transaction does not match its canonical owner intent and receipt.",
    );
  }
  validateOutcomeLedgerRepairArchivedMaterial(
    paths,
    record,
    identity,
    expectedReceipt,
  );
  return { record, identity };
}

function requireOutcomeLedgerRepairReplacement(paths, parameters) {
  const bytes = readPrivateBytes(
    paths.outcomes,
    "Canonical outcome ledger replacement",
    {
      privateRoot: paths.stateRoot,
      allowEmpty: true,
      maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
      invalidCode: "outcome_ledger_repair_transaction_invalid",
      invalidMessage:
        "Canonical outcome ledger replacement must be one private canonical regular file.",
    },
  );
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (
    bytes.length !== parameters.replacementSize ||
    digest !== parameters.replacementDigest
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Canonical outcome ledger does not match the transaction replacement.",
    );
  }
}

function outcomeLedgerRepairAuthority(options, normalizedParameters) {
  return {
    stateRoot: options.stateRoot,
    actor: options.actor,
    leaseName: options.leaseName,
    leaseToken: options.leaseToken,
    taskId: options.taskId,
    ownerIntentDigest: ownerOperationIntentDigest(
      options.actor,
      OUTCOME_LEDGER_REPAIR_ACTION,
      options.taskId,
      normalizedParameters,
    ),
  };
}

export function preflightOutcomeLedgerRepairEvent(options) {
  const normalizedParameters = normalizeOutcomeLedgerRepairParameters(
    options.parameters,
    options.stateRoot,
    options.taskId,
  );
  const authority = outcomeLedgerRepairAuthority(
    options,
    normalizedParameters,
  );
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    options.authorityContext ?? null,
    (authorityContext) => {
      const scopedOptions = {
        ...options,
        parameters: normalizedParameters,
        authorityContext,
      };
      preauthorizeOutcomeLedgerRepair(scopedOptions);
      const paths = automationControlPaths(options.stateRoot);
      return withFilesystemGuard(paths, "events", () => {
        authorityContext.reauthorize();
        return preflightOutcomeLedgerRepairEventUnlocked(
          scopedOptions,
          paths,
        );
      });
    },
  );
}

export function withOutcomeLedgerRepairFinalizationGuard(
  options,
  callback,
) {
  if (typeof callback !== "function") {
    throw new AutomationControlError(
      "invalid_argument",
      "Outcome ledger repair finalization guard requires a callback.",
    );
  }
  const normalizedParameters = normalizeOutcomeLedgerRepairParameters(
    options.parameters,
    options.stateRoot,
    options.taskId,
  );
  const authority = outcomeLedgerRepairAuthority(
    options,
    normalizedParameters,
  );
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    options.authorityContext ?? null,
    (authorityContext) => {
      const scopedOptions = {
        ...options,
        parameters: normalizedParameters,
        authorityContext,
      };
      preauthorizeOutcomeLedgerRepair(scopedOptions);
      const paths = automationControlPaths(options.stateRoot);
      return withFilesystemGuard(paths, "events", () => {
        authorityContext.reauthorize();
        const transactionOptions = {
          taskId: options.taskId,
          parameters: normalizedParameters,
          intentDigest: authority.ownerIntentDigest,
          transactionPath: options.transactionPath,
        };
        validateOutcomeLedgerRepairTransaction(paths, {
          ...transactionOptions,
          allowedPhases: ["prepared", "replaced", "audited"],
        });
        let active = true;
        const requireActive = () => {
          if (!active) {
            throw new AutomationControlError(
              "invalid_state",
              "Outcome ledger repair finalization guard scope is no longer active.",
            );
          }
        };
        const requireReplaced = () => {
          requireActive();
          authorityContext.reauthorize();
          validateOutcomeLedgerRepairTransaction(paths, {
            ...transactionOptions,
            allowedPhases: ["replaced"],
          });
          requireOutcomeLedgerRepairReplacement(paths, normalizedParameters);
        };
        try {
          const result = callback({
            preflightRepairEvent: () => {
              requireActive();
              authorityContext.reauthorize();
              validateOutcomeLedgerRepairTransaction(paths, {
                ...transactionOptions,
                allowedPhases: ["prepared", "replaced", "audited"],
              });
              return preflightOutcomeLedgerRepairEventUnlocked(
                scopedOptions,
                paths,
              );
            },
            appendRepairEvent: () => {
              requireReplaced();
              return appendOutcomeLedgerRepairEventUnlocked(
                scopedOptions,
                paths,
                { beforeAppend: requireReplaced },
              );
            },
          });
          if (result && typeof result.then === "function") {
            throw new AutomationControlError(
              "invalid_argument",
              "Outcome ledger repair finalization guard callback must be synchronous.",
            );
          }
          validateOutcomeLedgerRepairTransaction(paths, {
            ...transactionOptions,
            allowedPhases: ["audited"],
          });
          requireOutcomeLedgerRepairReplacement(paths, normalizedParameters);
          const auditedEvent = preflightOutcomeLedgerRepairEventUnlocked(
            scopedOptions,
            paths,
          );
          if (!auditedEvent.existing) {
            throw new AutomationControlError(
              "outcome_ledger_repair_transaction_invalid",
              "Audited outcome ledger repair transaction is missing its exact control event.",
            );
          }
          return result;
        } finally {
          active = false;
        }
      });
    },
  );
}

function buildTaskEvent(
  type,
  actor,
  task,
  manifestRevision,
  data,
  nowMs,
  eventId = randomUUID(),
) {
  return {
    schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
    eventId,
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

export function outcomeReservationEventId({
  taskId,
  outcome,
  outcomeDigest,
  taskRevision,
  legacyTransitionEventId,
}) {
  requireIdentifier(taskId, "taskId");
  requireEnum(outcome, [...OUTCOME_TASK_STATES], "outcome");
  const normalizedDigest = String(outcomeDigest ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedDigest)) {
    throw new AutomationControlError(
      "invalid_value",
      "outcomeDigest must be a 64 character hexadecimal digest.",
    );
  }
  requirePositiveInteger(taskRevision, "taskRevision");
  requireIdentifier(legacyTransitionEventId, "legacyTransitionEventId");
  return `task-outcome-reserved:${createHash("sha256")
    .update(
      JSON.stringify({
        taskId,
        outcome,
        outcomeDigest: normalizedDigest,
        taskRevision,
        legacyTransitionEventId,
      }),
    )
    .digest("hex")}`;
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
    ...(lease.ownerConfirmationId === undefined
      ? {}
      : {
          ownerConfirmationId: lease.ownerConfirmationId,
          ownerConfirmationTaskId: lease.ownerConfirmationTaskId,
          ownerConfirmationIntentDigest: lease.ownerConfirmationIntentDigest,
          ownerConfirmationDigest: lease.ownerConfirmationDigest,
          ownerConfirmationReference: lease.ownerConfirmationReference,
          ownerConfirmationApprovedBy: lease.ownerConfirmationApprovedBy,
          ownerConfirmationApprovalReference:
            lease.ownerConfirmationApprovalReference,
          ownerConfirmationApprovedAt: lease.ownerConfirmationApprovedAt,
          ownerConfirmationExpiresAt: lease.ownerConfirmationExpiresAt,
        }),
    ...(lease.publisherCapabilityId === undefined
      ? {}
      : { publisherCapabilityId: lease.publisherCapabilityId }),
  };
}

const OUTCOME_RECORDING_GUARD = Symbol("outcome-recording-guard");
const MUTATION_AUTHORITY_GUARD = Symbol("mutation-authority-guard");

function expectedLatestOutcomeForOwnerRecord(parameters) {
  const cleanEntry = parameters.cleanEntry;
  return {
    outcome: cleanEntry.outcome,
    evidence: structuredClone(cleanEntry.evidence),
    evidenceWindowEnd: cleanEntry.evidenceWindowEnd ?? null,
    build: cleanEntry.build ?? null,
    buildIdentity: cleanEntry.buildIdentity ?? null,
    installedIdentity:
      cleanEntry.outcome === "installed"
        ? (cleanEntry.buildIdentity ?? null)
        : null,
    outcomeDigest: parameters.outcomeDigest,
    recordedAt: cleanEntry.ts,
  };
}

function expectedTaskDetailsForOwnerRecord(parameters) {
  return {
    ...structuredClone(parameters.sourceTaskDetails),
    ...(parameters.cleanEntry.outcome === "installed"
      ? { installedIdentity: structuredClone(parameters.cleanEntry.buildIdentity) }
      : {}),
    latestOutcome: expectedLatestOutcomeForOwnerRecord(parameters),
  };
}

function canonicalValuesEqual(left, right) {
  return (
    JSON.stringify(canonicalIntentValue(left)) ===
    JSON.stringify(canonicalIntentValue(right))
  );
}

function requireOwnerOutcomeRecordGuard({
  actor,
  taskId,
  guardContext,
  validateStep,
}) {
  if (actor !== "freed-owner") return undefined;
  if (guardContext?.token !== OUTCOME_RECORDING_GUARD) {
    throw new AutomationControlError(
      "owner_intent_required",
      `Task ${taskId} outcome recording requires one exact composite owner intent.`,
      { taskId },
    );
  }
  guardContext.requireActive();
  const planned = guardContext.ownerOutcomeRecord;
  if (!planned || planned.intent.taskId !== taskId) {
    throw new AutomationControlError(
      "owner_intent_required",
      `Task ${taskId} outcome recording requires one exact composite owner intent.`,
      { taskId },
    );
  }
  validateStep(planned.parameters);
  return planned.intentDigest;
}

function requireOwnerOutcomeTransitionStep({
  actor,
  taskId,
  guardContext,
  route,
  toState,
  expectedRevision,
  details,
  legacyTransitionEventId = null,
}) {
  return requireOwnerOutcomeRecordGuard({
    actor,
    taskId,
    guardContext,
    validateStep: (parameters) => {
      if (
        parameters.route !== route ||
        parameters.cleanEntry.outcome !== toState ||
        parameters.sourceTaskRevision !== expectedRevision ||
        parameters.legacyTransitionEventId !== legacyTransitionEventId ||
        !canonicalValuesEqual(
          details,
          expectedTaskDetailsForOwnerRecord(parameters),
        )
      ) {
        throw new AutomationControlError(
          "owner_intent_mismatch",
          `Task ${taskId} outcome lifecycle step does not match its composite owner intent.`,
          { taskId, toState, route },
        );
      }
    },
  });
}

function requireOwnerOutcomeSourceTask({ actor, taskId, guardContext, task }) {
  return requireOwnerOutcomeRecordGuard({
    actor,
    taskId,
    guardContext,
    validateStep: (parameters) => {
      if (
        !canonicalValuesEqual(task, parameters.sourceTask)
      ) {
        throw new AutomationControlError(
          "owner_intent_mismatch",
          `Task ${taskId} source state does not match its composite owner intent.`,
          { taskId, state: task.state, revision: task.revision },
        );
      }
      requireOwnerLegacyTransition(guardContext.paths, parameters);
    },
  });
}

function requireOwnerLegacyTransition(paths, parameters) {
  if (parameters.route !== "legacy-backfill") return;
  const matches = readControlEventHistorySnapshot(paths.events).events.filter(
    (event) => event?.eventId === parameters.legacyTransitionEventId,
  );
  if (
    matches.length !== 1 ||
    !canonicalValuesEqual(matches[0], parameters.legacyTransition)
  ) {
    throw new AutomationControlError(
      "owner_intent_mismatch",
      `Task ${parameters.cleanEntry.taskId} legacy transition does not match its composite owner intent.`,
      { taskId: parameters.cleanEntry.taskId },
    );
  }
}

function matchingOwnerOutcomeTransition(paths, actor, parameters) {
  requireOwnerLegacyTransition(paths, parameters);
  const taskRevision = parameters.sourceTaskRevision + 1;
  const matches = readControlEventHistorySnapshot(paths.events).events.filter(
    (event) =>
      event?.actor === actor &&
      event?.taskId === parameters.cleanEntry.taskId &&
      event?.taskRevision === taskRevision &&
      event?.data?.toState === parameters.cleanEntry.outcome &&
      event?.data?.outcomeDigest === parameters.outcomeDigest &&
      event?.data?.outcomeRequired === true &&
      (parameters.route === "transition"
        ? event?.type === "task_transitioned" &&
          event?.data?.fromState === parameters.sourceTaskState
        : event?.type === "outcome_reservation_created" &&
          event?.data?.outcomeBackfill === true &&
          event?.data?.legacyTransitionEventId ===
            parameters.legacyTransitionEventId &&
          event?.eventId ===
            outcomeReservationEventId({
              taskId: parameters.cleanEntry.taskId,
              outcome: parameters.cleanEntry.outcome,
              outcomeDigest: parameters.outcomeDigest,
              taskRevision,
              legacyTransitionEventId: parameters.legacyTransitionEventId,
            })),
  );
  if (matches.length !== 1) {
    throw new AutomationControlError(
      "owner_intent_mismatch",
      `Task ${parameters.cleanEntry.taskId} requires one exact owner outcome reservation.`,
      { taskId: parameters.cleanEntry.taskId, matches: matches.length },
    );
  }
  return matches[0];
}

function requireOwnerOutcomeEventStep({
  actor,
  taskId,
  guardContext,
  leaseName,
  eventId,
  data,
}) {
  return requireOwnerOutcomeRecordGuard({
    actor,
    taskId,
    guardContext,
    validateStep: (parameters) => {
      const transition = matchingOwnerOutcomeTransition(
        guardContext.paths,
        actor,
        parameters,
      );
      const taskRevision = parameters.sourceTaskRevision + 1;
      const expectedData = {
        id: parameters.cleanEntry.id,
        taskId,
        taskRevision,
        taskState: parameters.cleanEntry.outcome,
        kind: parameters.cleanEntry.kind,
        outcome: parameters.cleanEntry.outcome,
        ledgerPath: parameters.ledgerPath,
        leaseName: "owner-governance",
        evidence: structuredClone(parameters.cleanEntry.evidence),
        outcomeDigest: parameters.outcomeDigest,
        transitionEventId: transition.eventId,
      };
      const expectedEventId = `outcome-recorded:${createHash("sha256")
        .update(
          JSON.stringify({
            taskId,
            taskRevision,
            outcomeDigest: parameters.outcomeDigest,
            transitionEventId: transition.eventId,
          }),
        )
        .digest("hex")}`;
      if (
        leaseName !== "owner-governance" ||
        eventId !== expectedEventId ||
        !canonicalValuesEqual(data, expectedData)
      ) {
        throw new AutomationControlError(
          "owner_intent_mismatch",
          `Task ${taskId} outcome event does not match its composite owner intent.`,
          { taskId, eventId },
        );
      }
    },
  });
}

function requireOwnerOutcomeFinalizeStep({
  actor,
  taskId,
  guardContext,
  outcome,
  outcomeDigest,
  taskRevision,
}) {
  return requireOwnerOutcomeRecordGuard({
    actor,
    taskId,
    guardContext,
    validateStep: (parameters) => {
      matchingOwnerOutcomeTransition(guardContext.paths, actor, parameters);
      if (
        outcome !== parameters.cleanEntry.outcome ||
        outcomeDigest !== parameters.outcomeDigest ||
        taskRevision !== parameters.sourceTaskRevision + 1
      ) {
        throw new AutomationControlError(
          "owner_intent_mismatch",
          `Task ${taskId} outcome finalization does not match its composite owner intent.`,
          { taskId, outcome, taskRevision },
        );
      }
    },
  });
}

function mutateTaskManifestUnderGuards(
  paths,
  nowMs,
  callback,
  { beforeCommit = () => {} } = {},
) {
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
    mutation.eventId,
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
  mkdirSync(paths.taskTransactions, { recursive: true, mode: 0o700 });
  const transactionPath = path.join(
    paths.taskTransactions,
    `${String(mutation.manifest.revision).padStart(12, "0")}-${transactionId}.json`,
  );
  beforeCommit();
  const eventSnapshot = readControlEventHistorySnapshot(paths.events);
  if (
    mutation.eventId !== undefined &&
    eventSnapshot.events.some(
      (candidate) => candidate?.eventId === mutation.eventId,
    )
  ) {
    throw new AutomationControlError(
      "control_event_conflict",
      `Control event ${mutation.eventId} already exists before its task mutation.`,
      { eventId: mutation.eventId },
    );
  }
  prepareControlEventAppend(eventSnapshot.bytes, event);
  beforeCommit();
  writeJsonAtomic(transactionPath, transaction);
  beforeCommit();
  writeJsonAtomic(paths.taskManifest, mutation.manifest);
  beforeCommit();
  appendEventLineUnlocked(paths, event, eventSnapshot.bytes, {
    beforeRename: beforeCommit,
  });
  beforeCommit();
  rmSync(transactionPath, { force: true });
  syncDirectory(paths.taskTransactions);
  return {
    changed: true,
    manifestRevision: mutation.manifest.revision,
    task: structuredClone(mutation.task),
    event: structuredClone(event),
  };
}

function mutateTaskManifest(
  stateRoot,
  nowMs,
  callback,
  {
    beforeAccess = null,
    beforeCommit = () => {},
    guardContext = null,
  } = {},
) {
  const paths = automationControlPaths(stateRoot);
  const authorizeBeforeAccess = beforeAccess ?? beforeCommit;
  if (guardContext?.token === OUTCOME_RECORDING_GUARD) {
    guardContext.requireActive();
    if (guardContext.paths.stateRoot !== paths.stateRoot) {
      throw new AutomationControlError(
        "invalid_argument",
        "Outcome recording guard belongs to a different state root.",
      );
    }
    return mutateTaskManifestUnderGuards(paths, nowMs, callback, {
      beforeCommit,
    });
  }
  return withFilesystemGuard(
    paths,
    "tasks",
    () => {
      authorizeBeforeAccess();
      recoverTaskTransactionsUnlocked(paths, nowMs, {
        beforeMutation: authorizeBeforeAccess,
      });
      return withFilesystemGuard(
        paths,
        "events",
        () =>
          mutateTaskManifestUnderGuards(paths, nowMs, callback, {
            beforeCommit,
          }),
        { now: () => nowMs },
      );
    },
    { now: () => nowMs },
  );
}

export function withOutcomeRecordingGuards(
  {
    stateRoot,
    nowMs = Date.now(),
    ownerIntent = null,
    authorityContext,
  },
  callback,
) {
  if (typeof callback !== "function") {
    throw new AutomationControlError(
      "invalid_argument",
      "Outcome recording guards require a callback.",
    );
  }
  const paths = automationControlPaths(stateRoot);
  if (
    authorityContext?.token !== MUTATION_AUTHORITY_GUARD ||
    authorityContext.paths.stateRoot !== paths.stateRoot
  ) {
    throw new AutomationControlError(
      "lease_authority_required",
      "Outcome recording guards require one active lease authority scope.",
    );
  }
  authorityContext.requireActive();
  const ownerOutcomeRecord =
    ownerIntent === null
      ? null
      : outcomeRecordOwnerIntent({
          stateRoot: paths.stateRoot,
          taskId: ownerIntent.taskId,
          parameters: ownerIntent.parameters,
        });
  return withFilesystemGuard(
    paths,
    "tasks",
    () => {
      authorityContext.reauthorize();
      recoverTaskTransactionsUnlocked(paths, nowMs, {
        beforeMutation: () => authorityContext.reauthorize(),
      });
      return withFilesystemGuard(
        paths,
        "events",
        () => {
          authorityContext.reauthorize();
          let active = true;
          const requireActive = () => {
            if (!active) {
              throw new AutomationControlError(
                "invalid_state",
                "Outcome recording guard scope is no longer active.",
              );
            }
          };
          const guardContext = {
            token: OUTCOME_RECORDING_GUARD,
            paths,
            requireActive,
            ownerOutcomeRecord,
            authorityContext,
          };
          try {
            const result = callback({
              readTask: (taskId) => {
                requireActive();
                requireIdentifier(taskId, "taskId");
                const manifest = readTaskManifestUnchecked({
                  stateRoot: paths.stateRoot,
                  nowMs,
                });
                return (
                  manifest.tasks.find((task) => task.taskId === taskId) ?? null
                );
              },
              transitionTask: (options) => {
                requireActive();
                return transitionTask({ ...options, guardContext });
              },
              reserveCurrentTaskOutcome: (options) => {
                requireActive();
                return reserveCurrentTaskOutcome({
                  ...options,
                  guardContext,
                });
              },
              appendOutcomeControlEvent: (options) => {
                requireActive();
                return appendOutcomeControlEvent({ ...options, guardContext });
              },
              finalizeTaskOutcome: (options) => {
                requireActive();
                return finalizeTaskOutcome({ ...options, guardContext });
              },
            });
            if (result && typeof result.then === "function") {
              throw new AutomationControlError(
                "invalid_argument",
                "Outcome recording guard callback must be synchronous.",
              );
            }
            return result;
          } finally {
            active = false;
          }
        },
        { now: () => nowMs },
      );
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
  const authority = {
    stateRoot,
    actor,
    leaseName,
    leaseToken,
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
  };
  return withMutationLeaseAuthority(authority, (authorityContext) => {
    const authorize = () => {
      const authorization = requireMutationLease({
        ...authority,
        authorityContext,
      });
      if (!authorization.policy.canCreateTask) {
        throw new AutomationControlError(
          "actor_not_authorized",
          `Actor ${actor} cannot create tasks.`,
          { actor },
        );
      }
      return authorization;
    };
    authorize();
    return mutateTaskManifest(stateRoot, nowMs, (manifest) => {
    const { lease } = authorize();
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
    }, { beforeCommit: authorize });
  });
}

export function isTaskTransitionAllowed(fromState, toState) {
  requireEnum(fromState, TASK_STATES, "fromState");
  requireEnum(toState, TASK_STATES, "toState");
  return TASK_TRANSITIONS[fromState].includes(toState);
}

function reserveCurrentTaskOutcome({
  stateRoot,
  taskId,
  actor,
  leaseName,
  leaseToken,
  outcome,
  legacyTransitionEventId,
  expectedRevision = undefined,
  details,
  nowMs = Date.now(),
  guardContext,
}) {
  requireIdentifier(taskId, "taskId");
  requireNonemptyString(actor, "actor");
  requireEnum(outcome, [...OUTCOME_TASK_STATES], "outcome");
  requireIdentifier(legacyTransitionEventId, "legacyTransitionEventId");
  if (expectedRevision !== undefined) {
    requirePositiveInteger(expectedRevision, "expectedRevision");
  }
  if (guardContext?.token !== OUTCOME_RECORDING_GUARD) {
    throw new AutomationControlError(
      "outcome_record_required",
      `Task ${taskId} outcome backfill requires the authenticated outcome writer.`,
      { taskId, outcome },
    );
  }
  const normalizedDetails = requirePlainObject(details, "details");
  const outcomeDigest = String(
    normalizedDetails?.latestOutcome?.outcomeDigest ?? "",
  ).toLowerCase();
  if (
    normalizedDetails?.latestOutcome?.outcome !== outcome ||
    !/^[0-9a-f]{64}$/.test(outcomeDigest)
  ) {
    throw new AutomationControlError(
      "outcome_record_required",
      `Task ${taskId} outcome backfill requires one exact authenticated outcome.`,
      { taskId, outcome },
    );
  }
  const compositeOwnerIntentDigest = requireOwnerOutcomeTransitionStep({
    actor,
    taskId,
    guardContext,
    route: "legacy-backfill",
    toState: outcome,
    expectedRevision,
    details: normalizedDetails,
    legacyTransitionEventId,
  });
  const authority = {
    stateRoot,
    actor,
    leaseName,
    leaseToken,
    taskId,
    ownerIntentDigest:
      compositeOwnerIntentDigest ??
      ownerOperationIntentDigest(
        actor,
        "task.reserve-current-outcome",
        taskId,
        {
          outcome,
          legacyTransitionEventId,
          expectedRevision: expectedRevision ?? null,
          details: normalizedDetails,
        },
      ),
  };
  const execute = (authorityContext) => {
    const authorize = () =>
      requireMutationLease({
        ...authority,
        authorityContext,
      });
    authorize();
    const paths = automationControlPaths(stateRoot);

    return mutateTaskManifest(stateRoot, nowMs, (manifest) => {
    const { policy, lease } = authorize();
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
    requireOwnerOutcomeSourceTask({ actor, taskId, guardContext, task });
    if (expectedRevision !== undefined && task.revision !== expectedRevision) {
      throw new AutomationControlError(
        "revision_conflict",
        `Task ${taskId} is at revision ${task.revision}, not ${expectedRevision}.`,
        { taskId, expectedRevision, actualRevision: task.revision },
      );
    }
    if (task.pendingOutcome !== undefined) {
      throw new AutomationControlError(
        "outcome_pending",
        `Task ${taskId} already has a pending outcome.`,
        { taskId, pendingOutcome: structuredClone(task.pendingOutcome) },
      );
    }
    if (task.state !== outcome) {
      throw new AutomationControlError(
        "invalid_transition",
        `Task ${taskId} is ${task.state}, not ${outcome}.`,
        { taskId, state: task.state, outcome },
      );
    }
    if (task.details?.latestOutcome !== undefined) {
      throw new AutomationControlError(
        "outcome_reservation_mismatch",
        `Task ${taskId} already records outcome details and cannot use legacy backfill.`,
        { taskId, outcome },
      );
    }
    if (outcome === "installed") {
      const suppliedInstalledIdentity =
        normalizedDetails.latestOutcome?.installedIdentity ??
        normalizedDetails.latestOutcome?.buildIdentity;
      if (suppliedInstalledIdentity === undefined) {
        throw new AutomationControlError(
          "outcome_reservation_mismatch",
          `Task ${taskId} installed outcome backfill requires its exact canonical installed identity.`,
          { taskId, outcome },
        );
      }
      const canonicalInstalledIdentity = normalizeInstalledBuildIdentity(
        task.installedIdentity,
        "task.installedIdentity",
      );
      const normalizedSuppliedIdentity = normalizeInstalledBuildIdentity(
        suppliedInstalledIdentity,
        "details.latestOutcome.installedIdentity",
      );
      if (
        JSON.stringify(normalizedSuppliedIdentity) !==
        JSON.stringify(canonicalInstalledIdentity)
      ) {
        throw new AutomationControlError(
          "outcome_reservation_mismatch",
          `Task ${taskId} installed outcome backfill does not match its canonical installed identity.`,
          {
            taskId,
            outcome,
            canonicalInstalledIdentity,
            suppliedInstalledIdentity: normalizedSuppliedIdentity,
          },
        );
      }
    }
    const legacyMatches = readControlEventHistorySnapshot(paths.events).events.filter(
      (event) => event?.eventId === legacyTransitionEventId,
    );
    if (legacyMatches.length !== 1) {
      throw new AutomationControlError(
        "outcome_reservation_mismatch",
        `Task ${taskId} requires one exact legacy lifecycle transition for outcome backfill.`,
        { taskId, outcome, legacyTransitionEventId },
      );
    }
    const [legacyTransition] = legacyMatches;
    if (
      legacyTransition.type !== "task_transitioned" ||
      legacyTransition.taskId !== taskId ||
      legacyTransition.taskRevision !== task.revision ||
      legacyTransition.data?.toState !== outcome ||
      typeof legacyTransition.data?.fromState !== "string" ||
      !TASK_STATES.includes(legacyTransition.data.fromState) ||
      !isTaskTransitionAllowed(legacyTransition.data.fromState, outcome) ||
      legacyTransition.data?.outcomeDigest !== undefined ||
      legacyTransition.data?.outcomeRequired !== undefined
    ) {
      throw new AutomationControlError(
        "outcome_reservation_mismatch",
        `Task ${taskId} legacy lifecycle transition cannot authorize outcome backfill.`,
        { taskId, outcome, legacyTransitionEventId },
      );
    }
    if (outcome === "installed") {
      let legacyInstalledIdentity;
      try {
        legacyInstalledIdentity = normalizeInstalledBuildIdentity(
          legacyTransition.data?.installedIdentity,
          "legacyTransition.data.installedIdentity",
        );
      } catch {
        throw new AutomationControlError(
          "outcome_reservation_mismatch",
          `Task ${taskId} legacy installed transition has no canonical build identity.`,
          { taskId, outcome, legacyTransitionEventId },
        );
      }
      const canonicalInstalledIdentity = normalizeInstalledBuildIdentity(
        task.installedIdentity,
        "task.installedIdentity",
      );
      if (
        !canonicalValuesEqual(
          legacyInstalledIdentity,
          canonicalInstalledIdentity,
        ) ||
        legacyTransition.data?.installedBuild !==
          canonicalInstalledIdentity.version ||
        legacyTransition.data?.installedAt !== task.installedAt
      ) {
        throw new AutomationControlError(
          "outcome_reservation_mismatch",
          `Task ${taskId} legacy installed transition does not match canonical installed state.`,
          { taskId, outcome, legacyTransitionEventId },
        );
      }
    }
    if (!policy.destinations.includes(outcome)) {
      throw new AutomationControlError(
        "actor_not_authorized",
        `Actor ${actor} cannot reserve ${outcome} outcomes.`,
        { actor, outcome },
      );
    }
    requireTaskTransitionAuthority(task, outcome);
    const timestamp = nowIso(nowMs);
    task.revision += 1;
    task.updatedAt = timestamp;
    task.details = {
      ...task.details,
      ...normalizedDetails,
      behavioral: taskBehavioralClassification(task),
    };
    task.pendingOutcome = {
      outcome,
      outcomeDigest,
      taskRevision: task.revision,
    };
    const eventId = outcomeReservationEventId({
      taskId,
      outcome,
      outcomeDigest,
      taskRevision: task.revision,
      legacyTransitionEventId,
    });
    return {
      changed: true,
      manifest,
      task,
      actor,
      eventId,
      eventType: "outcome_reservation_created",
      eventData: {
        toState: outcome,
        outcomeRequired: true,
        outcomeBackfill: true,
        outcomeDigest,
        legacyTransitionEventId,
        authorizationProvenance: leaseAuthorizationProvenance(lease),
        ...(outcome === "merged" && task.mergedAt !== undefined
          ? { mergedAt: task.mergedAt }
          : {}),
        ...(outcome === "installed"
          ? {
              installedBuild: task.installedBuild,
              installedIdentity: task.installedIdentity,
              installedAt: task.installedAt,
            }
          : {}),
      },
    };
    }, { beforeCommit: authorize, guardContext });
  };
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    guardContext.authorityContext,
    execute,
  );
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
  guardContext = null,
}) {
  requireIdentifier(taskId, "taskId");
  requireNonemptyString(actor, "actor");
  requireEnum(toState, TASK_STATES, "toState");
  if (expectedRevision !== undefined) {
    requirePositiveInteger(expectedRevision, "expectedRevision");
  }
  const normalizedDetails =
    details === undefined ? undefined : requirePlainObject(details, "details");
  const requiresCompositeOutcomeIntent =
    OUTCOME_TASK_STATES.has(toState) ||
    guardContext?.token === OUTCOME_RECORDING_GUARD;
  const compositeOwnerIntentDigest = requiresCompositeOutcomeIntent
    ? requireOwnerOutcomeTransitionStep({
        actor,
        taskId,
        guardContext,
        route: "transition",
        toState,
        expectedRevision,
        details: normalizedDetails,
      })
    : undefined;
  const authority = {
    stateRoot,
    actor,
    leaseName,
    leaseToken,
    taskId,
    ownerIntentDigest:
      compositeOwnerIntentDigest ??
      ownerOperationIntentDigest(actor, "task.transition", taskId, {
        toState,
        expectedRevision: expectedRevision ?? null,
        details: normalizedDetails ?? null,
      }),
  };
  const execute = (authorityContext) => {
    const authorize = () => {
    return requireMutationLease({
        ...authority,
        authorityContext,
    });
    };
    authorize();

    return mutateTaskManifest(stateRoot, nowMs, (manifest) => {
    const { policy, lease } = authorize();
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
    if (requiresCompositeOutcomeIntent) {
      requireOwnerOutcomeSourceTask({ actor, taskId, guardContext, task });
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
    if (task.pendingOutcome !== undefined) {
      throw new AutomationControlError(
        "outcome_pending",
        `Task ${taskId} cannot mutate ${task.state} until its pending outcome is durable.`,
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
    const guardedOutcomeWriter =
      guardContext?.token === OUTCOME_RECORDING_GUARD;
    const suppliedOutcome = normalizedDetails?.latestOutcome;
    if (
      (OUTCOME_TASK_STATES.has(toState) && !guardedOutcomeWriter) ||
      (guardedOutcomeWriter &&
        OUTCOME_TASK_STATES.has(toState) &&
        (suppliedOutcome?.outcome !== toState ||
          !/^[0-9a-f]{64}$/i.test(
            String(suppliedOutcome?.outcomeDigest ?? ""),
          )))
    ) {
      throw new AutomationControlError(
        "outcome_record_required",
        `Task ${taskId} must enter ${toState} through the authenticated outcome writer.`,
        { taskId, toState },
      );
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
    const outcomeWriterTransition =
      guardContext?.token === OUTCOME_RECORDING_GUARD &&
      OUTCOME_TASK_STATES.has(toState) &&
      normalizedDetails?.latestOutcome?.outcome === toState &&
      /^[0-9a-f]{64}$/i.test(String(outcomeDigest ?? ""));
    if (outcomeWriterTransition) {
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
        authorizationProvenance: leaseAuthorizationProvenance(lease),
        ...(outcomeWriterTransition
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
    }, { beforeCommit: authorize, guardContext });
  };
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    guardContext?.authorityContext ?? null,
    execute,
  );
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
  const reservationEvent =
    transitionEvent.type === "outcome_reservation_created" &&
    transitionEvent.data?.outcomeBackfill === true &&
    typeof transitionEvent.data?.legacyTransitionEventId === "string";
  const legacyReservationTransitions = reservationEvent
    ? events.filter(
        (event) =>
          event?.eventId === transitionEvent.data.legacyTransitionEventId,
      )
    : [];
  const legacyReservationTransition = legacyReservationTransitions[0];
  let validLegacyReservationEdge = false;
  let validReservationEventId = !reservationEvent;
  if (
    typeof legacyReservationTransition?.data?.fromState === "string" &&
    typeof legacyReservationTransition?.data?.toState === "string"
  ) {
    try {
      validLegacyReservationEdge = isTaskTransitionAllowed(
        legacyReservationTransition.data.fromState,
        legacyReservationTransition.data.toState,
      );
    } catch {
      validLegacyReservationEdge = false;
    }
  }
  if (reservationEvent) {
    try {
      validReservationEventId =
        transitionEvent.eventId ===
        outcomeReservationEventId({
          taskId: task.taskId,
          outcome,
          outcomeDigest,
          taskRevision,
          legacyTransitionEventId:
            transitionEvent.data.legacyTransitionEventId,
        });
    } catch {
      validReservationEventId = false;
    }
  }
  const validLegacyReservation =
    !reservationEvent ||
    (legacyReservationTransitions.length === 1 &&
      validReservationEventId &&
      legacyReservationTransition?.type === "task_transitioned" &&
      legacyReservationTransition.taskId === task.taskId &&
      legacyReservationTransition.taskRevision + 1 === taskRevision &&
      legacyReservationTransition.data?.toState === outcome &&
      validLegacyReservationEdge &&
      legacyReservationTransition.data?.outcomeDigest === undefined &&
      legacyReservationTransition.data?.outcomeRequired === undefined);
  const validInstalledTransitionIdentity = installedOutcomeIdentityMatches({
    outcome,
    build: entry.build,
    buildIdentity: entry.buildIdentity,
    transitionEvent,
    task,
  });
  const validLegacyInstalledIdentity =
    !reservationEvent ||
    (installedOutcomeIdentityMatches({
      outcome,
      build: entry.build,
      buildIdentity: entry.buildIdentity,
      transitionEvent: legacyReservationTransition,
      task,
    }) &&
      (outcome !== "installed" ||
        legacyReservationTransition?.data?.installedAt ===
          transitionEvent.data?.installedAt));
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
    !(transitionEvent.type === "task_transitioned" || reservationEvent) ||
    !validLegacyReservation ||
    !validInstalledTransitionIdentity ||
    !validLegacyInstalledIdentity ||
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
  guardContext = null,
}) {
  requireIdentifier(taskId, "taskId");
  requireNonemptyString(actor, "actor");
  requireEnum(outcome, [...OUTCOME_TASK_STATES], "outcome");
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
  const compositeOwnerIntentDigest = requireOwnerOutcomeFinalizeStep({
    actor,
    taskId,
    guardContext,
    outcome,
    outcomeDigest: normalizedDigest,
    taskRevision,
  });
  const authority = {
    stateRoot,
    actor,
    leaseName,
    leaseToken,
    taskId,
    ownerIntentDigest:
      compositeOwnerIntentDigest ??
      ownerOperationIntentDigest(
        actor,
        "task.finalize-outcome",
        taskId,
        { outcome, outcomeDigest: normalizedDigest, taskRevision },
      ),
  };
  const execute = (authorityContext) => {
    const authorize = () => {
    const { policy } = requireMutationLease({
        ...authority,
        authorityContext,
    });
    if (!policy.destinations.includes(outcome)) {
      throw new AutomationControlError(
        "actor_not_authorized",
        `Actor ${actor} cannot finalize ${outcome} outcomes.`,
        { actor, outcome },
      );
    }
    };
    authorize();

    const paths = automationControlPaths(stateRoot);
    return mutateTaskManifest(paths.stateRoot, nowMs, (manifest) => {
    authorize();
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
    }, { beforeCommit: authorize, guardContext });
  };
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    guardContext?.authorityContext ?? null,
    execute,
  );
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
  const authority = {
    stateRoot,
    actor,
    leaseName,
    leaseToken,
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
  };
  return withMutationLeaseAuthority(authority, (authorityContext) => {
    const authorize = () =>
      requireMutationLease({
        ...authority,
        authorityContext,
      });
    authorize();
    return mutateTaskManifest(stateRoot, nowMs, (manifest) => {
    const { lease } = authorize();
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
    }, { beforeCommit: authorize });
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

function pathEntryExists(filePath) {
  try {
    lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function readLeaseRecord(leasePath) {
  if (!pathEntryExists(leasePath)) {
    return null;
  }
  const recordPath = leaseRecordPath(leasePath);
  return readPrivateJsonFile(recordPath, "Lease record", {
    allowMissing: true,
    privateRoot: path.dirname(path.dirname(leasePath)),
    missingCode: "lease_not_found",
    missingMessage: `Lease record ${recordPath} does not exist.`,
    invalidCode: "lease_permissions_invalid",
    invalidMessage:
      "Lease records must be private regular files owned by the current user.",
  });
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
  const ownerConfirmationApprovedAtMs = Date.parse(
    String(record?.ownerConfirmationApprovedAt ?? ""),
  );
  const ownerConfirmationExpiresAtMs = Date.parse(
    String(record?.ownerConfirmationExpiresAt ?? ""),
  );
  const maxLifetimeMs = actorLeaseMaxLifetimeMs(record?.owner);
  const hasNoOwnerConfirmationFields =
    record?.ownerConfirmationId === undefined &&
    record?.ownerConfirmationTaskId === undefined &&
    record?.ownerConfirmationIntentDigest === undefined &&
    record?.ownerConfirmationDigest === undefined &&
    record?.ownerConfirmationReference === undefined &&
    record?.ownerConfirmationApprovedBy === undefined &&
    record?.ownerConfirmationApprovalReference === undefined &&
    record?.ownerConfirmationApprovedAt === undefined &&
    record?.ownerConfirmationExpiresAt === undefined;
  const validOwnerSignedCapability =
    record?.credentialKind === "owner-signed-capability" &&
    typeof record?.ownerCapabilityId === "string" &&
    IDENTIFIER_PATTERN.test(record.ownerCapabilityId) &&
    typeof record?.ownerCapabilityTaskId === "string" &&
    IDENTIFIER_PATTERN.test(record.ownerCapabilityTaskId) &&
    typeof record?.ownerCapabilityIntentDigest === "string" &&
    /^[0-9a-f]{64}$/.test(record.ownerCapabilityIntentDigest) &&
    hasNoOwnerConfirmationFields;
  const validOwnerConfirmation =
    record?.credentialKind === "owner-confirmation" &&
    record?.ownerCapabilityId === undefined &&
    record?.ownerCapabilityTaskId === undefined &&
    record?.ownerCapabilityIntentDigest === undefined &&
    typeof record?.ownerConfirmationId === "string" &&
    IDENTIFIER_PATTERN.test(record.ownerConfirmationId) &&
    typeof record?.ownerConfirmationTaskId === "string" &&
    IDENTIFIER_PATTERN.test(record.ownerConfirmationTaskId) &&
    typeof record?.ownerConfirmationIntentDigest === "string" &&
    /^[0-9a-f]{64}$/.test(record.ownerConfirmationIntentDigest) &&
    typeof record?.ownerConfirmationDigest === "string" &&
    /^[0-9a-f]{64}$/.test(record.ownerConfirmationDigest) &&
    typeof record?.ownerConfirmationReference === "string" &&
    record.ownerConfirmationReference.trim() !== "" &&
    record?.ownerConfirmationApprovedBy === "AubreyF" &&
    typeof record?.ownerConfirmationApprovalReference === "string" &&
    record.ownerConfirmationApprovalReference.trim() !== "" &&
    Number.isFinite(ownerConfirmationApprovedAtMs) &&
    Number.isFinite(ownerConfirmationExpiresAtMs) &&
    ownerConfirmationExpiresAtMs > ownerConfirmationApprovedAtMs &&
    ownerConfirmationExpiresAtMs - ownerConfirmationApprovedAtMs <=
      OWNER_CONFIRMATION_MAX_LIFETIME_MS &&
    ownerConfirmationApprovedAtMs <=
      acquiredAtMs + OWNER_CONFIRMATION_CLOCK_SKEW_MS &&
    ownerConfirmationExpiresAtMs >= expiresAtMs;
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
      "owner-confirmation",
      "owner-signed-capability",
      "signed-capability",
    ].includes(record?.credentialKind) ||
    (record?.owner === "freed-owner"
      ? (!validOwnerSignedCapability && !validOwnerConfirmation) ||
        record?.publisherCapabilityId !== undefined
      : record?.owner === "freed-pr-publisher"
        ? record.credentialKind !== "signed-capability" ||
          record?.ownerCapabilityId !== undefined ||
          record?.ownerCapabilityTaskId !== undefined ||
          record?.ownerCapabilityIntentDigest !== undefined ||
          !hasNoOwnerConfirmationFields ||
          typeof record?.publisherCapabilityId !== "string" ||
          !IDENTIFIER_PATTERN.test(record.publisherCapabilityId)
        : record.credentialKind !== "persistent-actor" ||
          record?.ownerCapabilityId !== undefined ||
          record?.ownerCapabilityTaskId !== undefined ||
          record?.ownerCapabilityIntentDigest !== undefined ||
          !hasNoOwnerConfirmationFields ||
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

function ownerConfirmationDigest(confirmation) {
  const canonical = canonicalIntentValue(
    requirePlainObject(confirmation, "owner confirmation"),
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
  const credential = readPrivateJsonFile(
    credentialPath,
    "Publisher capability public key",
    {
      privateRoot: paths.controlRoot,
      missingCode: "publisher_capability_credential_required",
      missingMessage: `No publisher capability public key exists at ${credentialPath}.`,
      invalidCode: "publisher_capability_credential_invalid",
      invalidMessage:
        "The publisher capability public key must be a private regular file owned by the current user.",
    },
  );
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
  operationId,
  tokenSha256,
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
  const envelopeSnapshot = readPrivateJsonSnapshot(
    capabilityFile,
    "Publisher capability envelope",
    {
      privateRoot: paths.controlRoot,
      missingCode: "publisher_capability_required",
      missingMessage: "The broker-issued publisher capability is unavailable.",
      invalidCode: "publisher_capability_permissions_invalid",
      invalidMessage:
        "The broker-issued publisher capability must be a private regular file owned by the current user.",
    },
  );
  const envelope = envelopeSnapshot.value;
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
    "leaseOperationId",
    "leaseTtlMs",
    "schemaVersion",
    "scope",
    "tokenSha256",
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
    payload?.leaseOperationId !== operationId ||
    payload?.tokenSha256 !== tokenSha256 ||
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
  if (pathEntryExists(consumedPath)) {
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
    credentialSnapshot: envelopeSnapshot,
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
  const credentialSnapshot = readPrivateJsonSnapshot(
    credentialPath,
    `Actor credential for ${actor}`,
    {
      privateRoot: paths.controlRoot,
      missingCode: "actor_credential_required",
      missingMessage: `No persistent actor credential exists at ${credentialPath}.`,
      invalidCode: "actor_credential_invalid",
      invalidMessage:
        "Automation credentials must be private regular files with no group or world permissions.",
    },
  );
  const credential = credentialSnapshot.value;
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
  return { credentialPath, credentialSnapshot };
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
  const envelopeSnapshot = readPrivateJsonSnapshot(
    capabilityFile,
    "Owner capability envelope",
    {
      privateRoot: paths.controlRoot,
      missingCode: "owner_capability_required",
      missingMessage: "The broker-issued owner capability is unavailable.",
      invalidCode: "owner_capability_permissions_invalid",
      invalidMessage:
        "The broker-issued owner capability must be a private regular file owned by the current user.",
    },
  );
  const envelope = envelopeSnapshot.value;
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
  if (pathEntryExists(consumedPath)) {
    throw new AutomationControlError(
      "owner_capability_replayed",
      "The owner capability was already consumed.",
    );
  }
  return {
    capabilityFile: expectedPath,
    consumedPath,
    credentialSnapshot: envelopeSnapshot,
    payload,
  };
}

function readAndValidateOwnerConfirmation({
  confirmationFile,
  taskId,
  intentDigest,
  ttlMs,
  nowMs,
}) {
  if (
    typeof confirmationFile !== "string" ||
    !path.isAbsolute(confirmationFile)
  ) {
    throw new AutomationControlError(
      "owner_confirmation_required",
      "freed-owner requires an absolute current-task owner confirmation file when no signed capability is supplied.",
    );
  }
  const confirmationSnapshot = readPrivateJsonSnapshot(
    confirmationFile,
    "Current-task owner confirmation",
    {
      privateRoot: path.dirname(confirmationFile),
      missingCode: "owner_confirmation_required",
      missingMessage: "The current-task owner confirmation file is unavailable.",
      invalidCode: "owner_confirmation_permissions_invalid",
      invalidMessage:
        "The current-task owner confirmation must be a private regular file owned by the current user.",
    },
  );
  const confirmation = confirmationSnapshot.value;
  const requiredKeys = [
    "approvalSource",
    "approvedAt",
    "approvedBy",
    "confirmationId",
    "expiresAt",
    "intent",
    "intentDigest",
    "kind",
    "ownerApprovalReference",
    "schemaVersion",
    "taskId",
  ].sort();
  const sourceKeys = ["kind", "reference"];
  const approvedAtMs = Date.parse(String(confirmation?.approvedAt ?? ""));
  const expiresAtMs = Date.parse(String(confirmation?.expiresAt ?? ""));
  const normalizedIntentDigest = String(intentDigest ?? "")
    .trim()
    .toLowerCase();
  const confirmationIntentDigest = String(confirmation?.intentDigest ?? "")
    .trim()
    .toLowerCase();
  let embeddedIntentDigest = "";
  try {
    embeddedIntentDigest = ownerGovernanceIntentDigest(confirmation?.intent);
  } catch {
    // The aggregate validation error below keeps approval failures uniform.
  }
  const source = confirmation?.approvalSource;
  if (
    confirmation?.schemaVersion !== OWNER_CONFIRMATION_SCHEMA_VERSION ||
    Object.keys(confirmation ?? {})
      .sort()
      .join("\n") !== requiredKeys.join("\n") ||
    confirmation?.kind !== "owner-confirmation" ||
    typeof confirmation?.confirmationId !== "string" ||
    !IDENTIFIER_PATTERN.test(confirmation.confirmationId) ||
    confirmation?.approvedBy !== "AubreyF" ||
    typeof confirmation?.ownerApprovalReference !== "string" ||
    confirmation.ownerApprovalReference.trim() === "" ||
    !source ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    Object.keys(source).sort().join("\n") !== sourceKeys.join("\n") ||
    source.kind !== "current-task" ||
    typeof source.reference !== "string" ||
    source.reference.trim() === "" ||
    confirmation?.taskId !== taskId ||
    !IDENTIFIER_PATTERN.test(String(confirmation?.taskId ?? "")) ||
    confirmation?.intent?.schemaVersion !== OWNER_CAPABILITY_SCHEMA_VERSION ||
    confirmation?.intent?.taskId !== taskId ||
    typeof confirmation?.intent?.action !== "string" ||
    confirmation.intent.action.trim() === "" ||
    !/^[0-9a-f]{64}$/.test(normalizedIntentDigest) ||
    confirmationIntentDigest !== normalizedIntentDigest ||
    embeddedIntentDigest !== confirmationIntentDigest ||
    !Number.isFinite(approvedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    approvedAtMs > nowMs + OWNER_CONFIRMATION_CLOCK_SKEW_MS ||
    expiresAtMs <= nowMs ||
    expiresAtMs <= approvedAtMs ||
    expiresAtMs - approvedAtMs > OWNER_CONFIRMATION_MAX_LIFETIME_MS ||
    nowMs + ttlMs > expiresAtMs
  ) {
    throw new AutomationControlError(
      "owner_confirmation_invalid",
      "The current-task owner confirmation does not match this exact governance lease request or is outside its validity window.",
    );
  }
  return {
    confirmationFile,
    credentialSnapshot: confirmationSnapshot,
    confirmation: {
      ...confirmation,
      ownerApprovalReference: confirmation.ownerApprovalReference.trim(),
      approvalSource: {
        kind: source.kind,
        reference: source.reference.trim(),
      },
      intentDigest: confirmationIntentDigest,
      approvedAt: new Date(approvedAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    },
    digest: ownerConfirmationDigest(confirmation),
  };
}

export function validateCurrentTaskOwnerConfirmation({
  confirmationFile,
  taskId,
  intentDigest,
  nowMs = Date.now(),
}) {
  return readAndValidateOwnerConfirmation({
    confirmationFile,
    taskId,
    intentDigest,
    ttlMs: 0,
    nowMs,
  });
}

function consumeOwnerCapability(capability) {
  ensurePrivateDirectory(path.dirname(capability.consumedPath));
  renameSync(capability.capabilityFile, capability.consumedPath);
  syncDirectory(path.dirname(capability.capabilityFile));
  syncDirectory(path.dirname(capability.consumedPath));
  return capability.consumedPath;
}

function requireMutationLeaseUnlocked({
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
  requireNoPendingLeaseTransaction(paths, leaseName);
  const record = readLeaseRecord(leasePath);
  requireNoPendingLeaseTransaction(paths, leaseName);
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
      (record.ownerCapabilityTaskId ?? record.ownerConfirmationTaskId) !==
        taskId ||
      typeof ownerIntentDigest !== "string" ||
      (record.ownerCapabilityIntentDigest ??
        record.ownerConfirmationIntentDigest) !== ownerIntentDigest)
  ) {
    throw new AutomationControlError(
      "owner_capability_intent_mismatch",
      "The owner governance lease is not authorized for this exact task and intent digest.",
      {
        taskId,
        authorizedTaskId:
          record.ownerCapabilityTaskId ?? record.ownerConfirmationTaskId,
        ownerIntentDigest,
        authorizedIntentDigest:
          record.ownerCapabilityIntentDigest ??
          record.ownerConfirmationIntentDigest,
      },
    );
  }
  return { lease: record, policy };
}

function requireMutationAuthorityContext(authorityContext, expected) {
  if (authorityContext?.token !== MUTATION_AUTHORITY_GUARD) {
    throw new AutomationControlError(
      "lease_authority_required",
      "Control-plane mutation requires one active lease authority scope.",
    );
  }
  authorityContext.requireActive();
  if (
    authorityContext.paths.stateRoot !==
      automationControlPaths(expected.stateRoot).stateRoot ||
    authorityContext.actor !== expected.actor ||
    authorityContext.leaseName !== expected.leaseName ||
    authorityContext.leaseToken !== expected.leaseToken ||
    authorityContext.taskId !== (expected.taskId ?? null) ||
    authorityContext.ownerIntentDigest !==
      (expected.ownerIntentDigest ?? null)
  ) {
    throw new AutomationControlError(
      "lease_authority_mismatch",
      "The active lease authority scope does not match this mutation.",
    );
  }
  return authorityContext;
}

export function withMutationLeaseAuthority(
  {
    stateRoot,
    actor,
    leaseName,
    leaseToken,
    taskId = undefined,
    ownerIntentDigest = undefined,
  },
  callback,
) {
  if (typeof callback !== "function") {
    throw new AutomationControlError(
      "invalid_argument",
      "Lease mutation authority requires a callback.",
    );
  }
  const paths = automationControlPaths(stateRoot);
  const normalizedTaskId = taskId ?? null;
  const normalizedOwnerIntentDigest = ownerIntentDigest ?? null;
  const expected = {
    stateRoot: paths.stateRoot,
    actor,
    leaseName,
    leaseToken,
    taskId: normalizedTaskId,
    ownerIntentDigest: normalizedOwnerIntentDigest,
  };
  actorPolicy(actor);
  requireIdentifier(leaseName, "leaseName");
  requireNonemptyString(leaseToken, "leaseToken");
  if (normalizedTaskId !== null) requireIdentifier(normalizedTaskId, "taskId");

  return withFilesystemGuard(paths, `lease-${leaseName}`, () => {
    recoverLeaseTransactionUnlocked(paths, leaseName, Date.now());
    requireNoPendingLeaseTransaction(paths, leaseName);
    let active = true;
    const requireActive = () => {
      if (!active) {
        throw new AutomationControlError(
          "lease_authority_inactive",
          "Lease mutation authority scope is no longer active.",
        );
      }
    };
    const authorityContext = {
      token: MUTATION_AUTHORITY_GUARD,
      paths,
      actor,
      leaseName,
      leaseToken,
      taskId: normalizedTaskId,
      ownerIntentDigest: normalizedOwnerIntentDigest,
      requireActive,
      reauthorize: () => {
        requireActive();
        requireNoPendingLeaseTransaction(paths, leaseName);
        return requireMutationLeaseUnlocked({
          ...expected,
          stateRoot: paths.stateRoot,
          nowMs: Date.now(),
        });
      },
      authorize: (authorization) => {
        requireActive();
        requireMutationAuthorityContext(authorityContext, authorization);
        return authorityContext.reauthorize();
      },
    };
    try {
      authorityContext.authorize(expected);
      const result = callback(authorityContext);
      if (result && typeof result.then === "function") {
        throw new AutomationControlError(
          "invalid_argument",
          "Lease mutation authority callback must be synchronous.",
        );
      }
      return result;
    } finally {
      active = false;
    }
  });
}

function requireMutationLease(options) {
  if (options.authorityContext?.token === MUTATION_AUTHORITY_GUARD) {
    return requireMutationAuthorityContext(
      options.authorityContext,
      options,
    ).authorize(options);
  }
  return withMutationLeaseAuthority(options, (authorityContext) =>
    authorityContext.authorize(options),
  );
}

function withMutationLeaseAuthorityIfNeeded(
  options,
  authorityContext,
  callback,
) {
  if (authorityContext?.token === MUTATION_AUTHORITY_GUARD) {
    requireMutationAuthorityContext(authorityContext, options);
    const result = callback(authorityContext);
    if (result && typeof result.then === "function") {
      throw new AutomationControlError(
        "invalid_argument",
        "Lease mutation authority callback must be synchronous.",
      );
    }
    return result;
  }
  return withMutationLeaseAuthority(options, callback);
}

function isLeaseExpired(record, nowMs) {
  const expiresAtMs = Date.parse(record.expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs;
}

const LEASE_TRANSACTION_PHASES = new Set([
  "prepared",
  "state-committed",
  "event-appended",
  "complete",
]);
const LEASE_TRANSACTION_OPERATIONS = new Set([
  "acquire",
  "heartbeat",
  "bind-head",
  "release",
]);

function requireLeaseOperationId(operationId) {
  const normalized = String(operationId ?? "").trim().toLowerCase();
  if (
    !/^[0-9a-f]{64}$/.test(normalized) &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalized,
    )
  ) {
    throw new AutomationControlError(
      "lease_operation_id_required",
      "Lease mutations require a caller-owned high-entropy operation ID.",
    );
  }
  return normalized;
}

function requireCallerLeaseToken(token) {
  if (
    typeof token !== "string" ||
    token.trim() !== token ||
    Buffer.byteLength(token, "utf8") < 32 ||
    Buffer.byteLength(token, "utf8") > 4_096 ||
    token.includes("\0")
  ) {
    throw new AutomationControlError(
      "lease_token_required",
      "Lease acquisition requires a caller-retained high-entropy token between 32 and 4,096 bytes.",
    );
  }
  return token;
}

function leaseTransactionDirectories(paths) {
  return {
    transactions: path.join(paths.leases, ".transactions"),
    receipts: path.join(paths.leases, ".transaction-receipts"),
  };
}

function leaseTransactionFiles(paths, name, operationId, operation) {
  const directories = leaseTransactionDirectories(paths);
  return {
    ...directories,
    transaction: path.join(directories.transactions, `${name}.json`),
    before: path.join(
      directories.transactions,
      `${name}.${operationId}.before.json`,
    ),
    after: path.join(
      directories.transactions,
      `${name}.${operationId}.after.json`,
    ),
    receipt: path.join(
      directories.receipts,
      `${name}.${operation}.${operationId}.json`,
    ),
  };
}

function leaseAtomicTemporaryPath(filePath, operationId) {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${operationId}.tmp`,
  );
}

function leaseStateRemovalPath(paths, transaction) {
  return path.join(
    paths.leases,
    `.${transaction.name}.lease.${transaction.operationId}.removed`,
  );
}

function validateLeaseAtomicTemporaryFile(filePath) {
  let descriptor;
  try {
    const before = lstatSync(filePath, { bigint: true });
    descriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const held = fstatSync(descriptor, { bigint: true });
    const after = lstatSync(filePath, { bigint: true });
    const expectedUid = BigInt(
      typeof process.getuid === "function" ? process.getuid() : Number(held.uid),
    );
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !held.isFile() ||
      held.isSymbolicLink() ||
      !after.isFile() ||
      after.isSymbolicLink() ||
      before.dev !== held.dev ||
      before.ino !== held.ino ||
      held.dev !== after.dev ||
      held.ino !== after.ino ||
      held.uid !== expectedUid ||
      (held.mode & 0o7777n) !== 0o600n ||
      held.nlink !== 1n ||
      held.size > BigInt(LEASE_TRANSACTION_MAX_BYTES) ||
      realpathSync(filePath) !== filePath
    ) {
      throw new Error("temporary file is outside its private operation boundary");
    }
  } catch (error) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease transaction temporary file ${filePath} is unsafe.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function removeLeaseAtomicTemporaryFile(filePath) {
  if (!pathEntryExists(filePath)) return false;
  validateLeaseAtomicTemporaryFile(filePath);
  rmSync(filePath);
  syncDirectory(path.dirname(filePath));
  return true;
}

function requireNoPendingLeaseTransaction(paths, name) {
  const activePath = path.join(
    leaseTransactionDirectories(paths).transactions,
    `${name}.json`,
  );
  if (pathEntryExists(activePath)) {
    throw new AutomationControlError(
      "lease_transaction_pending",
      `Lease ${name} has a pending recoverable transaction.`,
    );
  }
}

function reconcilePreWalLeaseTransactionArtifacts(
  paths,
  files,
  transaction,
  beforeBytes,
  afterBytes,
) {
  const { transactions } = leaseTransactionDirectories(paths);
  requireExactPrivateArchiveDirectory(
    transactions,
    "Lease transaction directory",
  );
  const quarantineEntry = LEASE_CLEANUP_QUARANTINE_DIRECTORY;
  const expectedFinals = new Map();
  if (beforeBytes !== null) expectedFinals.set(files.before, beforeBytes);
  if (afterBytes !== null) expectedFinals.set(files.after, afterBytes);
  const expectedTemps = new Set(
    [files.before, files.after, files.transaction]
      .filter((filePath) => filePath !== null)
      .map((filePath) =>
        leaseAtomicTemporaryPath(filePath, transaction.operationId),
      ),
  );
  const entries = readdirSync(transactions).sort();
  for (const entry of entries) {
    if (entry === quarantineEntry) {
      requireExactPrivateArchiveDirectory(
        path.join(transactions, entry),
        "Lease transaction cleanup archive directory",
      );
      continue;
    }
    const filePath = path.join(transactions, entry);
    if (expectedTemps.has(filePath)) {
      removeLeaseAtomicTemporaryFile(filePath);
      continue;
    }
    const expectedBytes = expectedFinals.get(filePath);
    if (expectedBytes !== undefined) {
      const current = readPrivateBytes(
        filePath,
        "Lease pre-WAL staging",
        { privateRoot: paths.controlRoot },
      );
      if (!current.equals(expectedBytes)) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease transaction staging ${entry} changed before WAL publication.`,
        );
      }
      continue;
    }
    throw new AutomationControlError(
      "lease_transaction_pending",
      `Lease transaction entry ${entry} must recover or be reconciled before ${transaction.name} can mutate.`,
      { name: transaction.name, pendingEntry: entry },
    );
  }
}

function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalLeaseRequestDigest(value) {
  return digestBytes(
    Buffer.from(JSON.stringify(canonicalIntentValue(value)), "utf8"),
  );
}

function writePrivateBytesAtomic(
  filePath,
  bytes,
  {
    operationId,
    checkpoint = undefined,
    kind = "private-file",
  },
) {
  const directoryPath = path.dirname(filePath);
  ensurePrivateDirectory(directoryPath);
  const temporaryPath = leaseAtomicTemporaryPath(filePath, operationId);
  let descriptor;
  try {
    removeLeaseAtomicTemporaryFile(temporaryPath);
    if (pathEntryExists(filePath)) {
      const current = readPrivateBytes(filePath, `Lease ${kind}`, {
        privateRoot: path.dirname(directoryPath),
      });
      if (current.equals(bytes)) {
        syncDirectory(directoryPath);
        return;
      }
    }
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    invokeLeaseTransactionCheckpoint(
      checkpoint,
      "lease-atomic-temporary-synced",
      { filePath, temporaryPath, kind },
    );
    const admitted = readPrivateBytes(
      temporaryPath,
      `Lease ${kind} temporary file`,
      { privateRoot: path.dirname(directoryPath) },
    );
    if (!admitted.equals(bytes)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${kind} temporary bytes changed before publication.`,
      );
    }
    renameSync(temporaryPath, filePath);
    invokeLeaseTransactionCheckpoint(
      checkpoint,
      "lease-atomic-renamed",
      { filePath, temporaryPath, kind },
    );
    syncDirectory(directoryPath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

function privateFileIdentity(stats) {
  return {
    dev: BigInt(stats.dev).toString(),
    ino: BigInt(stats.ino).toString(),
    mode: Number(stats.mode),
    nlink: Number(stats.nlink),
    uid: Number(stats.uid),
    gid: Number(stats.gid),
    size: Number(stats.size),
    mtimeMs: Number(stats.mtimeMs),
    ctimeMs: Number(stats.ctimeMs),
    mtimeNs:
      stats.mtimeNs === undefined
        ? BigInt(Math.trunc(Number(stats.mtimeMs) * 1_000_000)).toString()
        : BigInt(stats.mtimeNs).toString(),
    ctimeNs:
      stats.ctimeNs === undefined
        ? BigInt(Math.trunc(Number(stats.ctimeMs) * 1_000_000)).toString()
        : BigInt(stats.ctimeNs).toString(),
  };
}

function privateFileIdentityMatches(left, right) {
  const normalizedLeft = privateFileIdentity(left);
  const normalizedRight = privateFileIdentity(right);
  return (
    normalizedLeft.dev === normalizedRight.dev &&
    normalizedLeft.ino === normalizedRight.ino &&
    normalizedLeft.mode === normalizedRight.mode &&
    normalizedLeft.nlink === normalizedRight.nlink &&
    normalizedLeft.uid === normalizedRight.uid &&
    normalizedLeft.gid === normalizedRight.gid &&
    normalizedLeft.size === normalizedRight.size &&
    normalizedLeft.mtimeNs === normalizedRight.mtimeNs &&
    normalizedLeft.ctimeNs === normalizedRight.ctimeNs
  );
}

function readPrivateBytes(
  filePath,
  label,
  {
    allowMissing = false,
    allowEmpty = false,
    privateRoot = path.dirname(filePath),
    missingCode = "lease_transaction_missing",
    missingMessage = `${label} is unavailable.`,
    invalidCode = "lease_transaction_invalid",
    invalidMessage = `${label} must be a private regular file owned by the current user.`,
    includeMetadata = false,
    maxBytes = LEASE_TRANSACTION_MAX_BYTES,
  } = {},
) {
  const normalizedFilePath = path.resolve(filePath);
  const normalizedRoot = path.resolve(privateRoot);
  const fileDirectory = path.dirname(normalizedFilePath);
  const relativeDirectory = path.relative(normalizedRoot, fileDirectory);
  const directoryEscapesRoot =
    relativeDirectory === ".." ||
    relativeDirectory.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeDirectory);
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : null;

  const failInvalid = (cause = undefined) => {
    throw new AutomationControlError(invalidCode, invalidMessage, {
      ...(cause === undefined ? {} : { cause: String(cause) }),
      filePath: normalizedFilePath,
    });
  };
  const validateDirectoryChain = () => {
    if (
      filePath !== normalizedFilePath ||
      privateRoot !== normalizedRoot ||
      directoryEscapesRoot
    ) {
      failInvalid("path escapes private root");
    }
    let directoryPath = fileDirectory;
    while (true) {
      let stats;
      try {
        stats = lstatSync(directoryPath);
        if (realpathSync(directoryPath) !== directoryPath) {
          failInvalid("directory path is not canonical");
        }
      } catch (error) {
        failInvalid(error);
      }
      const expectedUid = currentUid ?? stats.uid;
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        stats.uid !== expectedUid ||
        (stats.mode & 0o777) !== 0o700
      ) {
        failInvalid("directory ancestry is not private");
      }
      if (directoryPath === normalizedRoot) break;
      const parentPath = path.dirname(directoryPath);
      if (parentPath === directoryPath) {
        failInvalid("private root is unreachable");
      }
      directoryPath = parentPath;
    }
  };
  validateDirectoryChain();
  let beforePathStats;
  try {
    beforePathStats = lstatSync(normalizedFilePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (allowMissing) return null;
      throw new AutomationControlError(missingCode, missingMessage);
    }
    failInvalid(error);
  }
  const expectedUid = BigInt(currentUid ?? Number(beforePathStats.uid));
  if (
    !beforePathStats.isFile() ||
    beforePathStats.isSymbolicLink() ||
    beforePathStats.uid !== expectedUid ||
    (beforePathStats.mode & 0o7777n) !== 0o600n ||
    beforePathStats.nlink !== 1n ||
    beforePathStats.size < 0n ||
    (!allowEmpty && beforePathStats.size === 0n) ||
    beforePathStats.size > BigInt(maxBytes)
  ) {
    failInvalid("file metadata is outside the private boundary");
  }
  try {
    if (realpathSync(normalizedFilePath) !== normalizedFilePath) {
      failInvalid("file path is not canonical");
    }
  } catch (error) {
    failInvalid(error);
  }

  let descriptor;
  try {
    descriptor = openSync(
      normalizedFilePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const beforeDescriptorStats = fstatSync(descriptor, { bigint: true });
    if (!privateFileIdentityMatches(beforePathStats, beforeDescriptorStats)) {
      failInvalid("file identity changed before read");
    }
    const expectedSize = Number(beforeDescriptorStats.size);
    const bytes = Buffer.alloc(expectedSize + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        null,
      );
      if (count === 0) break;
      offset += count;
    }
    if (offset !== expectedSize) {
      failInvalid("file size changed during read");
    }
    const afterDescriptorStats = fstatSync(descriptor, { bigint: true });
    const afterPathStats = lstatSync(normalizedFilePath, { bigint: true });
    if (
      !privateFileIdentityMatches(beforeDescriptorStats, afterDescriptorStats) ||
      !privateFileIdentityMatches(beforeDescriptorStats, afterPathStats)
    ) {
      failInvalid("file identity changed during read");
    }
    if (realpathSync(normalizedFilePath) !== normalizedFilePath) {
      failInvalid("file parent changed during read");
    }
    validateDirectoryChain();
    const admitted = bytes.subarray(0, offset);
    privateAuthorityDecoder.decode(admitted);
    return includeMetadata
      ? {
          bytes: admitted,
          identity: privateFileIdentity(afterDescriptorStats),
        }
      : admitted;
  } catch (error) {
    if (error instanceof AutomationControlError) throw error;
    failInvalid(error);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readPrivateJsonFile(filePath, label, options = {}) {
  const bytes = readPrivateBytes(filePath, label, options);
  if (bytes === null) return null;
  try {
    return JSON.parse(privateAuthorityDecoder.decode(bytes));
  } catch {
    throw new AutomationControlError(
      options.invalidCode ?? "lease_transaction_invalid",
      options.invalidMessage ?? `${label} contains invalid JSON.`,
    );
  }
}

function readPrivateJsonSnapshot(filePath, label, options = {}) {
  const snapshot = readPrivateBytes(filePath, label, {
    ...options,
    includeMetadata: true,
  });
  if (snapshot === null) return null;
  try {
    return Object.freeze({
      value: JSON.parse(privateAuthorityDecoder.decode(snapshot.bytes)),
      bytes: snapshot.bytes,
      identity: snapshot.identity,
    });
  } catch {
    throw new AutomationControlError(
      options.invalidCode ?? "lease_transaction_invalid",
      options.invalidMessage ?? `${label} contains invalid JSON.`,
    );
  }
}

function privateJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseLeaseRecordBytes(bytes, name) {
  let record;
  try {
    record = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease ${name} staging contains invalid JSON.`,
    );
  }
  if (!isLegacyUncredentialedLeaseRecord(record) || record.owner === "freed-owner") {
    validateLeaseRecord(record, name);
  }
  return record;
}

function leaseStateDescriptor(directoryExists, recordBytes) {
  return {
    directoryExists,
    recordDigest: recordBytes === null ? null : digestBytes(recordBytes),
    recordSize: recordBytes === null ? 0 : recordBytes.length,
  };
}

function readLeaseDirectorySnapshot(paths, name, leasePath) {
  if (!pathEntryExists(leasePath)) {
    return {
      descriptor: leaseStateDescriptor(false, null),
      record: null,
      bytes: null,
    };
  }
  requirePrivateDirectory(leasePath, `Lease directory ${leasePath}`);
  const entries = readdirSync(leasePath).sort();
  if (
    entries.length > 1 ||
    (entries.length === 1 && entries[0] !== "lease.json")
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease directory ${leasePath} contains unsupported entries.`,
    );
  }
  if (entries.length === 0) {
    return {
      descriptor: leaseStateDescriptor(true, null),
      record: null,
      bytes: null,
    };
  }
  const bytes = readPrivateBytes(leaseRecordPath(leasePath), "Lease record", {
    privateRoot: paths.controlRoot,
    missingCode: "lease_not_found",
    missingMessage: `Lease record ${leaseRecordPath(leasePath)} does not exist.`,
    invalidCode: "lease_permissions_invalid",
    invalidMessage:
      "Lease records must be private regular files owned by the current user.",
  });
  const record = parseLeaseRecordBytes(bytes, name);
  return {
    descriptor: leaseStateDescriptor(true, bytes),
    record,
    bytes,
  };
}

function readLeaseStateSnapshot(paths, name) {
  return readLeaseDirectorySnapshot(paths, name, leasePathFor(paths, name));
}

function validateLeaseStateDescriptor(value) {
  const keys = Object.keys(value ?? {}).sort();
  if (
    keys.join("\n") !==
      ["directoryExists", "recordDigest", "recordSize"].sort().join("\n") ||
    typeof value.directoryExists !== "boolean" ||
    !Number.isSafeInteger(value.recordSize) ||
    value.recordSize < 0 ||
    (value.recordDigest === null
      ? value.recordSize !== 0
      : !/^[0-9a-f]{64}$/.test(String(value.recordDigest))) ||
    (!value.directoryExists && value.recordDigest !== null)
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      "Lease transaction contains an invalid redacted state descriptor.",
    );
  }
  return structuredClone(value);
}

function leaseStateMatches(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function leaseTransactionContainsSecretField(value) {
  if (Array.isArray(value)) {
    return value.some((item) => leaseTransactionContainsSecretField(item));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, item]) =>
        ["token", "leaseToken"].includes(key) ||
        leaseTransactionContainsSecretField(item),
    );
  }
  return false;
}

function validateLeaseCredentialDescriptor(value, paths) {
  if (value === null) return null;
  const keys = Object.keys(value ?? {}).sort();
  const expectedKeys = [
    "consumedPath",
    "digest",
    "kind",
    "size",
    "sourceDevice",
    "sourceInode",
    "sourcePath",
  ].sort();
  if (
    keys.join("\n") !== expectedKeys.join("\n") ||
    ![
      "actor-credential",
      "owner-capability",
      "owner-confirmation",
      "publisher-capability",
    ].includes(value.kind) ||
    typeof value.sourcePath !== "string" ||
    !path.isAbsolute(value.sourcePath) ||
    path.resolve(value.sourcePath) !== value.sourcePath ||
    (value.consumedPath !== null &&
      (typeof value.consumedPath !== "string" ||
        !path.isAbsolute(value.consumedPath) ||
        path.resolve(value.consumedPath) !== value.consumedPath)) ||
    !/^[0-9a-f]{64}$/.test(String(value.digest ?? "")) ||
    !/^\d+$/.test(String(value.sourceDevice ?? "")) ||
    !/^\d+$/.test(String(value.sourceInode ?? "")) ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      "Lease transaction contains an invalid credential descriptor.",
    );
  }
  for (const filePath of [value.sourcePath, value.consumedPath]) {
    if (filePath === null || !pathEntryExists(filePath)) continue;
    let physicalPath = "";
    try {
      physicalPath = realpathSync(filePath);
    } catch {
      physicalPath = "";
    }
    if (physicalPath !== filePath) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        "Lease transaction credential paths must remain canonical physical files.",
      );
    }
  }
  const expectedSourceRoot =
    value.kind === "actor-credential"
      ? paths.actorCredentials
      : value.kind === "owner-capability"
        ? paths.ownerCapabilitiesPending
        : value.kind === "publisher-capability"
          ? paths.publisherCapabilitiesPending
          : null;
  if (
    expectedSourceRoot !== null &&
    path.dirname(value.sourcePath) !== expectedSourceRoot
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      "Lease transaction credential source is outside automation state.",
    );
  }
  if (
    ["actor-credential", "owner-confirmation"].includes(value.kind) &&
    value.consumedPath !== null
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      "Lease transaction credential consumption does not match its credential kind.",
    );
  }
  if (value.consumedPath !== null) {
    const expectedConsumedRoot =
      value.kind === "owner-capability"
        ? paths.ownerCapabilitiesConsumed
        : paths.publisherCapabilitiesConsumed;
    if (
      path.dirname(value.consumedPath) !== expectedConsumedRoot ||
      path.basename(value.consumedPath) !== path.basename(value.sourcePath)
    ) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        "Lease transaction credential destination is not canonical.",
      );
    }
  }
  return structuredClone(value);
}

function exactObjectKeys(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\n") === expectedKeys.sort().join("\n")
  );
}

function validateRedactedLeaseRecord(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease transaction for ${name} contains an invalid redacted lease receipt.`,
    );
  }
  if (Object.hasOwn(value, "token")) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease transaction for ${name} exposes a lease token.`,
    );
  }
  const expectedKeys = [
    "acquiredAt",
    "credentialKind",
    "expiresAt",
    "heartbeatAt",
    "name",
    "observerAuthority",
    "owner",
    "providerAuthority",
    "schemaVersion",
    "ttlMs",
  ];
  if (value.credentialKind === "owner-signed-capability") {
    expectedKeys.push(
      "ownerCapabilityId",
      "ownerCapabilityIntentDigest",
      "ownerCapabilityTaskId",
    );
  } else if (value.credentialKind === "owner-confirmation") {
    expectedKeys.push(
      "ownerConfirmationApprovalReference",
      "ownerConfirmationApprovedAt",
      "ownerConfirmationApprovedBy",
      "ownerConfirmationDigest",
      "ownerConfirmationExpiresAt",
      "ownerConfirmationId",
      "ownerConfirmationIntentDigest",
      "ownerConfirmationReference",
      "ownerConfirmationTaskId",
    );
  } else if (value.credentialKind === "signed-capability") {
    expectedKeys.push("publisherCapabilityId", "scope");
  }
  if (!exactObjectKeys(value, expectedKeys)) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease transaction for ${name} contains an inexact redacted lease receipt.`,
    );
  }
  const record = { ...structuredClone(value), token: "redacted-lease-token" };
  validateLeaseRecord(record, name);
  return publicLease(record);
}

function validateLeaseTakeoverSummary(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      "Lease transaction takeover history is invalid.",
    );
  }
  const unreadable = value.unreadable === true;
  const legacy = value.legacyUncredentialed === true;
  const expectedKeys = unreadable
    ? ["expiredAt", "owner", "unreadable"]
    : legacy
      ? ["expiredAt", "heartbeatAt", "legacyUncredentialed", "owner"]
      : ["expiredAt", "heartbeatAt", "owner"];
  if (
    !exactObjectKeys(value, expectedKeys) ||
    typeof value.owner !== "string" ||
    value.owner.trim() === "" ||
    (unreadable
      ? value.owner !== "unknown" || value.expiredAt !== null
      : typeof value.expiredAt !== "string" ||
        typeof value.heartbeatAt !== "string" ||
        !Number.isFinite(Date.parse(value.expiredAt)) ||
        !Number.isFinite(Date.parse(value.heartbeatAt)))
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      "Lease transaction takeover history is invalid.",
    );
  }
  return structuredClone(value);
}

function expectedAcquireEventData(lease, capability, takeover, resultReceipt) {
  return {
    expiresAt: lease.expiresAt,
    observerAuthority: lease.observerAuthority,
    providerAuthority: lease.providerAuthority,
    credentialKind: lease.credentialKind,
    ...(lease.publisherCapabilityId === undefined
      ? {}
      : { publisherCapabilityId: lease.publisherCapabilityId }),
    ...(lease.scope === undefined ? {} : { scope: lease.scope }),
    ...(capability.kind === "actor-credential"
      ? { actorCredentialPath: capability.sourcePath }
      : {}),
    ...(lease.ownerCapabilityId === undefined
      ? {}
      : {
          ownerCapabilityId: lease.ownerCapabilityId,
          ownerCapabilityTaskId: lease.ownerCapabilityTaskId,
          ownerCapabilityIntentDigest: lease.ownerCapabilityIntentDigest,
        }),
    ...(lease.ownerConfirmationId === undefined
      ? {}
      : {
          ownerConfirmationId: lease.ownerConfirmationId,
          ownerConfirmationTaskId: lease.ownerConfirmationTaskId,
          ownerConfirmationIntentDigest: lease.ownerConfirmationIntentDigest,
          ownerConfirmationDigest: lease.ownerConfirmationDigest,
          ownerConfirmationReference: lease.ownerConfirmationReference,
          ownerConfirmationApprovedBy: lease.ownerConfirmationApprovedBy,
          ownerConfirmationApprovalReference:
            lease.ownerConfirmationApprovalReference,
          ownerConfirmationApprovedAt: lease.ownerConfirmationApprovedAt,
          ownerConfirmationExpiresAt: lease.ownerConfirmationExpiresAt,
        }),
    ...(resultReceipt.credentialUpgrade ? { credentialUpgrade: true } : {}),
    ...(takeover === null ? {} : { previous: takeover }),
  };
}

function validateLeaseOperationPayload(value, paths) {
  const event = value.event;
  if (
    !exactObjectKeys(event, [
      "actor",
      "data",
      "eventId",
      "leaseName",
      "schemaVersion",
      "ts",
      "type",
    ]) ||
    event.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    event.eventId !== `lease:${value.operationId}` ||
    event.leaseName !== value.name ||
    event.ts !== value.preparedAt
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      "Lease transaction audit event is invalid.",
    );
  }
  const takeover = validateLeaseTakeoverSummary(value.takeover);
  const capability = validateLeaseCredentialDescriptor(value.capability, paths);
  let lease;
  let expectedEventType;
  let expectedEventData;
  if (value.operation === "acquire") {
    if (
      !exactObjectKeys(
        value.resultReceipt,
        value.takeover === null
          ? ["acquired", "credentialUpgrade", "lease", "takeover"]
          : [
              "acquired",
              "credentialUpgrade",
              "lease",
              "previous",
              "takeover",
            ],
      ) ||
      value.resultReceipt.acquired !== true ||
      typeof value.resultReceipt.takeover !== "boolean" ||
      typeof value.resultReceipt.credentialUpgrade !== "boolean" ||
      value.resultReceipt.takeover !== (takeover !== null) ||
      (takeover === null
        ? Object.hasOwn(value.resultReceipt, "previous")
        : !canonicalValuesEqual(value.resultReceipt.previous, takeover)) ||
      capability === null
    ) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        `Lease transaction for ${value.name} has an invalid acquire receipt.`,
      );
    }
    lease = validateRedactedLeaseRecord(value.resultReceipt.lease, value.name);
    const expectedCapabilityKind =
      lease.credentialKind === "persistent-actor"
        ? "actor-credential"
        : lease.credentialKind === "owner-signed-capability"
          ? "owner-capability"
          : lease.credentialKind === "owner-confirmation"
            ? "owner-confirmation"
            : "publisher-capability";
    const expectedSourceName =
      expectedCapabilityKind === "actor-credential"
        ? `${lease.owner}.json`
        : expectedCapabilityKind === "owner-capability"
          ? `${lease.ownerCapabilityId}.json`
          : expectedCapabilityKind === "publisher-capability"
            ? `${lease.publisherCapabilityId}.json`
            : null;
    if (
      capability.kind !== expectedCapabilityKind ||
      (expectedSourceName !== null &&
        path.basename(capability.sourcePath) !== expectedSourceName)
    ) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        `Lease transaction for ${value.name} has an invalid credential identity.`,
      );
    }
    expectedEventType = value.resultReceipt.credentialUpgrade
      ? "lease_credential_upgraded"
      : value.resultReceipt.takeover
        ? "lease_taken_over"
        : "lease_acquired";
    expectedEventData = expectedAcquireEventData(
      lease,
      capability,
      takeover,
      value.resultReceipt,
    );
  } else if (value.operation === "heartbeat") {
    if (
      !exactObjectKeys(value.resultReceipt, ["heartbeated", "lease"]) ||
      value.resultReceipt.heartbeated !== true ||
      capability !== null ||
      takeover !== null
    ) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        `Lease transaction for ${value.name} has an invalid heartbeat receipt.`,
      );
    }
    lease = validateRedactedLeaseRecord(value.resultReceipt.lease, value.name);
    expectedEventType = "lease_heartbeat";
    expectedEventData = { expiresAt: lease.expiresAt };
  } else if (value.operation === "bind-head") {
    if (
      !exactObjectKeys(value.resultReceipt, ["bound", "lease"]) ||
      value.resultReceipt.bound !== true ||
      capability !== null ||
      takeover !== null
    ) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        `Lease transaction for ${value.name} has an invalid head-binding receipt.`,
      );
    }
    lease = validateRedactedLeaseRecord(value.resultReceipt.lease, value.name);
    expectedEventType = "lease_scope_bound";
    expectedEventData = { scope: lease.scope };
  } else {
    if (
      !exactObjectKeys(value.resultReceipt, ["lease", "released"]) ||
      value.resultReceipt.released !== true ||
      capability !== null ||
      takeover !== null
    ) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        `Lease transaction for ${value.name} has an invalid release receipt.`,
      );
    }
    lease = validateRedactedLeaseRecord(value.resultReceipt.lease, value.name);
    expectedEventType = "lease_released";
    expectedEventData = {
      expired: Date.parse(lease.expiresAt) <= Date.parse(value.preparedAt),
    };
  }
  if (
    event.actor !== lease.owner ||
    event.type !== expectedEventType ||
    !canonicalValuesEqual(event.data, expectedEventData)
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease transaction for ${value.name} has an inexact audit contract.`,
    );
  }
  return { capability, lease, takeover };
}

function credentialDescriptor({
  kind,
  sourcePath,
  consumedPath = null,
  snapshot,
}) {
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    !Buffer.isBuffer(snapshot.bytes) ||
    typeof snapshot.identity?.dev !== "string" ||
    typeof snapshot.identity?.ino !== "string"
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease credential admission did not retain its exact source generation.",
    );
  }
  return {
    kind,
    sourcePath,
    consumedPath,
    digest: digestBytes(snapshot.bytes),
    size: snapshot.bytes.length,
    sourceDevice: snapshot.identity.dev,
    sourceInode: snapshot.identity.ino,
  };
}

function credentialBytesMatch(filePath, descriptor) {
  if (!pathEntryExists(filePath)) return false;
  const snapshot = readPrivateBytes(filePath, "Lease credential envelope", {
    includeMetadata: true,
  });
  return (
    snapshot.bytes.length === descriptor.size &&
    digestBytes(snapshot.bytes) === descriptor.digest &&
    snapshot.identity.dev === descriptor.sourceDevice &&
    snapshot.identity.ino === descriptor.sourceInode
  );
}

function validateLeaseTransaction(value, paths, expectedName) {
  const keys = Object.keys(value ?? {}).sort();
  const expectedKeys = [
    "after",
    "before",
    "capability",
    "completedAt",
    "event",
    "kind",
    "name",
    "operation",
    "operationId",
    "phase",
    "preparedAt",
    "requestDigest",
    "resultReceipt",
    "schemaVersion",
    "staging",
    "takeover",
    "tokenDigest",
  ].sort();
  const preparedAtMs = Date.parse(String(value?.preparedAt ?? ""));
  const completedAtMs = Date.parse(String(value?.completedAt ?? ""));
  if (
    value?.schemaVersion !== LEASE_TRANSACTION_SCHEMA_VERSION ||
    value?.kind !== LEASE_TRANSACTION_KIND ||
    keys.join("\n") !== expectedKeys.join("\n") ||
    value?.name !== expectedName ||
    requireLeaseOperationId(value?.operationId) !== value.operationId ||
    !LEASE_TRANSACTION_OPERATIONS.has(value?.operation) ||
    !LEASE_TRANSACTION_PHASES.has(value?.phase) ||
    !/^[0-9a-f]{64}$/.test(String(value?.requestDigest ?? "")) ||
    !/^[0-9a-f]{64}$/.test(String(value?.tokenDigest ?? "")) ||
    !Number.isFinite(preparedAtMs) ||
    new Date(preparedAtMs).toISOString() !== value.preparedAt ||
    (value.phase === "complete"
      ? value.completedAt === null ||
        !Number.isFinite(completedAtMs) ||
        new Date(completedAtMs).toISOString() !== value.completedAt
      : value.completedAt !== null) ||
    leaseTransactionContainsSecretField(value)
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease transaction for ${expectedName} has an unsupported shape.`,
    );
  }
  const stagingKeys = Object.keys(value.staging ?? {}).sort();
  if (
    stagingKeys.join("\n") !== ["afterPath", "beforePath"].sort().join("\n") ||
    ![value.staging.beforePath, value.staging.afterPath].every(
      (filePath) => filePath === null || path.isAbsolute(filePath),
    )
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      "Lease transaction staging paths are invalid.",
    );
  }
  const expectedFiles = leaseTransactionFiles(
    paths,
    expectedName,
    value.operationId,
    value.operation,
  );
  if (
    value.staging.beforePath !==
      (value.before.recordDigest === null ? null : expectedFiles.before) ||
    value.staging.afterPath !==
      (value.after.recordDigest === null ? null : expectedFiles.after)
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      "Lease transaction staging paths do not match its operation identity.",
    );
  }
  const before = validateLeaseStateDescriptor(value.before);
  const after = validateLeaseStateDescriptor(value.after);
  const payload = validateLeaseOperationPayload(value, paths);
  const operationValid =
    value.operation === "acquire"
      ? after.directoryExists &&
        after.recordDigest !== null &&
        payload.capability !== null
      : value.operation === "heartbeat" || value.operation === "bind-head"
        ? before.recordDigest !== null && after.recordDigest !== null
        : before.recordDigest !== null &&
          !after.directoryExists &&
          after.recordDigest === null;
  if (
    !operationValid
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease transaction for ${expectedName} does not match its operation contract.`,
    );
  }
  return {
    ...structuredClone(value),
    before,
    after,
    capability: payload.capability,
  };
}

function readLeaseTransactionFile(filePath, paths, name) {
  if (!pathEntryExists(filePath)) return null;
  const bytes = readPrivateBytes(filePath, "Lease transaction", {
    privateRoot: paths.controlRoot,
  });
  return parseLeaseTransactionBytes(bytes, paths, name);
}

function parseLeaseTransactionBytes(bytes, paths, name) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease transaction for ${name} contains invalid JSON.`,
    );
  }
  return validateLeaseTransaction(value, paths, name);
}

function readValidatedLeaseTransactionReceipts(paths, name, operation) {
  const { receipts } = leaseTransactionDirectories(paths);
  if (!pathEntryExists(receipts)) return [];
  requirePrivateDirectory(receipts, "Lease transaction receipt directory");
  const prefix = `${name}.${operation}.`;
  return readdirSync(receipts)
    .filter(
      (entry) => entry.startsWith(prefix) && entry.endsWith(".json"),
    )
    .map((entry) => {
      const filePath = path.join(receipts, entry);
      const snapshot = readPrivateBytes(filePath, "Lease transaction receipt", {
        privateRoot: paths.controlRoot,
        includeMetadata: true,
      });
      const transaction = parseLeaseTransactionBytes(
        snapshot.bytes,
        paths,
        name,
      );
      const expectedReceiptPath = leaseTransactionFiles(
        paths,
        name,
        transaction.operationId,
        transaction.operation,
      ).receipt;
      if (
        transaction.phase !== "complete" ||
        transaction.operation !== operation ||
        expectedReceiptPath !== filePath
      ) {
        throw new AutomationControlError(
          "lease_transaction_invalid",
          `Lease transaction receipt ${entry} does not match its canonical operation identity.`,
        );
      }
      return {
        entry,
        filePath,
        bytes: snapshot.bytes,
        identity: snapshot.identity,
        mtimeMs: snapshot.identity.mtimeMs,
      };
    });
}

function planLeaseReceiptPruning(receipts, currentReceiptEntry) {
  return receipts
    .filter(({ entry }) => entry !== currentReceiptEntry)
    .sort(
      (left, right) =>
        right.mtimeMs - left.mtimeMs ||
        (right.entry < left.entry ? -1 : right.entry > left.entry ? 1 : 0),
    )
    .slice(LEASE_TRANSACTION_RECEIPT_RETENTION - 1);
}

export function conservativeLeaseCleanupArchiveReservation(
  stateRoot = undefined,
  { nowMs = Date.now() } = {},
) {
  if (!Number.isFinite(nowMs)) {
    throw new AutomationControlError(
      "lease_archive_capacity_invalid",
      "Lease archive reservation requires a finite clock.",
    );
  }
  const paths = automationControlPaths(stateRoot);
  const { receipts } = leaseTransactionDirectories(paths);
  const baseEntries = 3;
  const baseBytes = 3 * LEASE_TRANSACTION_MAX_BYTES;
  if (!pathEntryExists(receipts)) {
    return Object.freeze({
      entries: baseEntries,
      bytes: baseBytes,
      oldestMtimeMs: nowMs,
    });
  }
  requireExactPrivateArchiveDirectory(
    receipts,
    "Lease transaction receipt directory",
  );
  const operationIdPattern =
    "(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";
  const receiptPattern = new RegExp(
    `^(.+)\\.(acquire|heartbeat|bind-head|release)\\.(${operationIdPattern})\\.json$`,
  );
  const groups = new Map();
  for (const entry of readdirSync(receipts)) {
    if (entry === LEASE_CLEANUP_QUARANTINE_DIRECTORY) {
      requireExactPrivateArchiveDirectory(
        path.join(receipts, entry),
        "Lease receipt cleanup archive directory",
      );
      continue;
    }
    const match = receiptPattern.exec(entry);
    if (match === null) {
      throw new AutomationControlError(
        "lease_archive_capacity_invalid",
        `Lease transaction receipt ${entry} has an invalid name.`,
      );
    }
    const name = requireIdentifier(match[1], "lease name");
    const operation = match[2];
    requireLeaseOperationId(match[3]);
    const filePath = path.join(receipts, entry);
    const snapshot = readPrivateBytes(filePath, "Lease transaction receipt", {
      privateRoot: paths.controlRoot,
      includeMetadata: true,
    });
    const transaction = parseLeaseTransactionBytes(
      snapshot.bytes,
      paths,
      name,
    );
    if (
      transaction.phase !== "complete" ||
      transaction.operation !== operation ||
      transaction.operationId !== match[3] ||
      leaseTransactionFiles(
        paths,
        name,
        transaction.operationId,
        transaction.operation,
      ).receipt !== filePath
    ) {
      throw new AutomationControlError(
        "lease_archive_capacity_invalid",
        `Lease transaction receipt ${entry} does not match its canonical operation identity.`,
      );
    }
    const key = `${name}\0${operation}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      entry,
      filePath,
      bytes: snapshot.bytes,
      identity: snapshot.identity,
      mtimeMs: snapshot.identity.mtimeMs,
    });
  }
  let maximumStaleEntries = 0;
  let maximumStaleBytes = 0;
  let oldestMtimeMs = nowMs;
  for (const receiptsForOperation of groups.values()) {
    const stale = planLeaseReceiptPruning(receiptsForOperation, null);
    maximumStaleEntries = Math.max(maximumStaleEntries, stale.length);
    maximumStaleBytes = Math.max(
      maximumStaleBytes,
      stale.reduce((sum, receipt) => sum + receipt.bytes.length, 0),
    );
    for (const receipt of stale) {
      oldestMtimeMs = Math.min(oldestMtimeMs, receipt.mtimeMs);
    }
  }
  return Object.freeze({
    entries: baseEntries + maximumStaleEntries,
    bytes: baseBytes + maximumStaleBytes,
    oldestMtimeMs,
  });
}

function writeLeaseTransactionFile(
  filePath,
  transaction,
  checkpoint = undefined,
  kind = "WAL",
) {
  writePrivateBytesAtomic(filePath, privateJsonBytes(transaction), {
    operationId: transaction.operationId,
    checkpoint,
    kind,
  });
}

function reconcileActiveLeaseTransactionArtifacts(
  paths,
  files,
  transaction,
) {
  const canonicalPaths = new Set(
    [files.transaction, transaction.staging.beforePath, transaction.staging.afterPath]
      .filter((filePath) => filePath !== null),
  );
  const temporaryPaths = new Set(
    [
      files.transaction,
      files.receipt,
      transaction.staging.beforePath,
      transaction.staging.afterPath,
      leaseRecordPath(leasePathFor(paths, transaction.name)),
    ]
      .filter((filePath) => filePath !== null)
      .map((filePath) =>
        leaseAtomicTemporaryPath(filePath, transaction.operationId),
      ),
  );
  for (const filePath of temporaryPaths) {
    removeLeaseAtomicTemporaryFile(filePath);
  }
  const { transactions } = leaseTransactionDirectories(paths);
  requireExactPrivateArchiveDirectory(
    transactions,
    "Lease transaction directory",
  );
  for (const entry of readdirSync(transactions).sort()) {
    if (entry === LEASE_CLEANUP_QUARANTINE_DIRECTORY) {
      requireExactPrivateArchiveDirectory(
        path.join(transactions, entry),
        "Lease transaction cleanup archive directory",
      );
      continue;
    }
    const filePath = path.join(transactions, entry);
    if (canonicalPaths.has(filePath)) continue;
    throw new AutomationControlError(
      "lease_transaction_pending",
      `Lease transaction entry ${entry} conflicts with active operation ${transaction.operationId}.`,
      { name: transaction.name, pendingEntry: entry },
    );
  }
}

function matchingLeaseEventUnlocked(paths, transaction) {
  const snapshot = readControlEventHistorySnapshot(paths.events);
  const matches = snapshot.events.filter(
    (event) => event?.eventId === transaction.event.eventId,
  );
  if (matches.length > 1) {
    throw new AutomationControlError(
      "control_event_duplicate",
      `Control event history contains duplicate event ${transaction.event.eventId}.`,
    );
  }
  if (
    matches.length === 1 &&
    JSON.stringify(canonicalIntentValue(matches[0])) !==
      JSON.stringify(canonicalIntentValue(transaction.event))
  ) {
    throw new AutomationControlError(
      "control_event_conflict",
      `Control event ${transaction.event.eventId} conflicts with its lease transaction.`,
    );
  }
  return { event: matches[0] ?? null, snapshot };
}

function requireLeaseOperationEventAvailable(
  paths,
  event,
  eventsGuard = undefined,
) {
  const requireAvailable = () => {
    const snapshot = readControlEventHistorySnapshot(paths.events);
    const matches = snapshot.events.filter(
      (candidate) => candidate?.eventId === event.eventId,
    );
    if (matches.length === 0) return;
    if (matches.length > 1) {
      throw new AutomationControlError(
        "control_event_duplicate",
        `Control event history contains duplicate event ${event.eventId}.`,
      );
    }
    if (
      JSON.stringify(canonicalIntentValue(matches[0])) !==
      JSON.stringify(canonicalIntentValue(event))
    ) {
      throw new AutomationControlError(
        "control_event_conflict",
        `Control event ${event.eventId} conflicts with its lease operation.`,
      );
    }
    throw new AutomationControlError(
      "lease_receipt_unavailable",
      `Lease operation ${event.eventId} was already audited, but its replay receipt is no longer retained.`,
      { eventId: event.eventId },
    );
  };
  if (eventsGuard !== undefined) {
    requireActiveLeaseEventsGuard(eventsGuard);
    return requireAvailable();
  }
  return withFilesystemGuard(paths, "events", requireAvailable);
}

function requireNoPrunedLeaseOperationEvent(
  paths,
  operationId,
  eventsGuard,
) {
  requireActiveLeaseEventsGuard(eventsGuard);
  const eventId = `lease:${operationId}`;
  const matches = readControlEventHistorySnapshot(paths.events).events.filter(
    (event) => event?.eventId === eventId,
  );
  if (matches.length > 1) {
    throw new AutomationControlError(
      "control_event_duplicate",
      `Control event history contains duplicate event ${eventId}.`,
    );
  }
  if (matches.length === 1) {
    throw new AutomationControlError(
      "lease_receipt_unavailable",
      `Lease operation ${eventId} was already audited, but its replay receipt is no longer retained.`,
      { eventId },
    );
  }
}

function validateLeaseStaging(paths, transaction) {
  const records = { before: null, after: null };
  for (const [side, descriptor] of [
    ["before", transaction.before],
    ["after", transaction.after],
  ]) {
    const stagingPath = transaction.staging[`${side}Path`];
    if (descriptor.recordDigest === null) continue;
    const bytes = readPrivateBytes(stagingPath, `Lease ${side} staging`);
    if (
      bytes.length !== descriptor.recordSize ||
      digestBytes(bytes) !== descriptor.recordDigest
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${side} staging does not match its redacted digest.`,
      );
    }
    records[side] = parseLeaseRecordBytes(bytes, transaction.name);
  }
  validateLeaseTransactionStagedSemantics(transaction, records);
  return records;
}

function leaseRecordWithoutFields(record, fields) {
  const clone = structuredClone(record);
  for (const field of fields) delete clone[field];
  return clone;
}

function validateLeaseTransactionStagedSemantics(transaction, records) {
  const { before: beforeRecord, after: afterRecord } = records;
  const tokenRecords =
    transaction.operation === "acquire"
      ? [afterRecord]
      : transaction.operation === "release"
        ? [beforeRecord]
        : [beforeRecord, afterRecord];
  if (
    tokenRecords.some(
      (record) =>
        record === null || secretDigest(record.token) !== transaction.tokenDigest,
    )
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease transaction for ${transaction.name} does not match its token digest.`,
    );
  }
  const receiptLease = transaction.resultReceipt.lease;
  if (transaction.operation === "acquire") {
    if (
      afterRecord === null ||
      !canonicalValuesEqual(publicLease(afterRecord), receiptLease) ||
      afterRecord.acquiredAt !== transaction.preparedAt ||
      afterRecord.heartbeatAt !== transaction.preparedAt
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease acquisition transaction for ${transaction.name} has inconsistent staged state.`,
      );
    }
  } else if (transaction.operation === "heartbeat") {
    if (
      !canonicalValuesEqual(publicLease(afterRecord), receiptLease) ||
      afterRecord.heartbeatAt !== transaction.preparedAt ||
      !canonicalValuesEqual(
        leaseRecordWithoutFields(beforeRecord, [
          "expiresAt",
          "heartbeatAt",
          "ttlMs",
        ]),
        leaseRecordWithoutFields(afterRecord, [
          "expiresAt",
          "heartbeatAt",
          "ttlMs",
        ]),
      )
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease heartbeat transaction for ${transaction.name} has inconsistent staged state.`,
      );
    }
  } else if (transaction.operation === "bind-head") {
    if (
      !canonicalValuesEqual(publicLease(afterRecord), receiptLease) ||
      !canonicalValuesEqual(
        leaseRecordWithoutFields(beforeRecord, ["scope"]),
        leaseRecordWithoutFields(afterRecord, ["scope"]),
      ) ||
      beforeRecord.scope?.headSha !== null ||
      !/^[0-9a-f]{40}$/.test(String(afterRecord.scope?.headSha ?? ""))
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Publisher head transaction for ${transaction.name} has inconsistent staged state.`,
      );
    }
  } else if (
    beforeRecord === null ||
    !canonicalValuesEqual(publicLease(beforeRecord), receiptLease)
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease release transaction for ${transaction.name} has inconsistent staged state.`,
    );
  }
}

function reconcileLeaseStateIntermediate(paths, transaction) {
  const leasePath = leasePathFor(paths, transaction.name);
  const recordPath = leaseRecordPath(leasePath);
  removeLeaseAtomicTemporaryFile(
    leaseAtomicTemporaryPath(recordPath, transaction.operationId),
  );
  const removedPath = leaseStateRemovalPath(paths, transaction);
  if (pathEntryExists(removedPath)) {
    if (
      transaction.operation !== "release" ||
      pathEntryExists(leasePath)
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${transaction.name} has an unexpected removal intermediate.`,
      );
    }
    const removed = readLeaseDirectorySnapshot(
      paths,
      transaction.name,
      removedPath,
    );
    const exactBefore = leaseStateMatches(removed.descriptor, transaction.before);
    const exactEmptyIntermediate =
      removed.descriptor.directoryExists === true &&
      removed.descriptor.recordDigest === null;
    if (!exactBefore && !exactEmptyIntermediate) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${transaction.name} removal intermediate changed generation.`,
      );
    }
    syncDirectory(removedPath);
    syncDirectory(paths.leases);
    if (exactBefore) {
      rmSync(leaseRecordPath(removedPath));
      syncDirectory(removedPath);
    }
    rmdirSync(removedPath);
    syncDirectory(paths.leases);
  }
  if (
    transaction.operation === "acquire" &&
    transaction.before.directoryExists === false &&
    transaction.after.recordDigest !== null &&
    pathEntryExists(leasePath)
  ) {
    const partial = readLeaseStateSnapshot(paths, transaction.name);
    if (
      partial.descriptor.directoryExists &&
      partial.descriptor.recordDigest === null
    ) {
      if (!leaseCredentialIsCommitted(transaction.capability, true)) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease ${transaction.name} directory exists before its credential committed.`,
        );
      }
      syncDirectory(paths.leases);
      syncDirectory(leasePath);
      const bytes = readPrivateBytes(
        transaction.staging.afterPath,
        "Lease after staging",
      );
      writePrivateBytesAtomic(recordPath, bytes, {
        operationId: transaction.operationId,
        kind: "canonical lease record",
      });
    }
  }
  if (transaction.operation === "release" && !pathEntryExists(leasePath)) {
    syncDirectory(paths.leases);
  }
}

function repairLeaseStateAdmissionDurability(paths, name, snapshot) {
  if (snapshot.descriptor.directoryExists) {
    syncDirectory(leasePathFor(paths, name));
  }
  syncDirectory(paths.leases);
}

function replaceLeaseStateFromTransaction(
  paths,
  transaction,
  side,
  checkpoint = undefined,
) {
  const descriptor = transaction[side];
  const leasePath = leasePathFor(paths, transaction.name);
  if (!descriptor.directoryExists) {
    const removedPath = leaseStateRemovalPath(paths, transaction);
    if (pathEntryExists(removedPath)) {
      reconcileLeaseStateIntermediate(paths, transaction);
      return;
    }
    if (pathEntryExists(leasePath)) {
      renameSync(leasePath, removedPath);
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-state-removal-renamed",
        { leasePath, removedPath },
      );
      syncDirectory(paths.leases);
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-state-removal-parent-synced",
        { leasePath, removedPath },
      );
      const removed = readLeaseDirectorySnapshot(
        paths,
        transaction.name,
        removedPath,
      );
      if (!leaseStateMatches(removed.descriptor, transaction.before)) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease ${transaction.name} removal intermediate changed generation.`,
        );
      }
      rmSync(leaseRecordPath(removedPath));
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-state-removal-record-deleted",
        { leasePath, removedPath },
      );
      syncDirectory(removedPath);
      rmdirSync(removedPath);
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-state-removal-deleted",
        { leasePath, removedPath },
      );
      syncDirectory(paths.leases);
    }
    return;
  }
  if (!pathEntryExists(leasePath)) {
    mkdirSync(leasePath, { mode: 0o700 });
    invokeLeaseTransactionCheckpoint(
      checkpoint,
      "lease-state-directory-created",
      { leasePath },
    );
    syncDirectory(paths.leases);
  } else {
    requirePrivateDirectory(leasePath, `Lease directory ${leasePath}`);
  }
  const recordPath = leaseRecordPath(leasePath);
  if (descriptor.recordDigest === null) {
    rmSync(recordPath, { force: true });
    syncDirectory(leasePath);
    return;
  }
  const bytes = readPrivateBytes(
    transaction.staging[`${side}Path`],
    `Lease ${side} staging`,
  );
  writePrivateBytesAtomic(recordPath, bytes, {
    operationId: transaction.operationId,
    checkpoint,
    kind: "canonical lease record",
  });
}

function syncLeaseCredentialDirectories(descriptor, committed) {
  if (descriptor === null || descriptor.consumedPath === null) return;
  const destinationDirectory = path.dirname(
    committed ? descriptor.consumedPath : descriptor.sourcePath,
  );
  const sourceDirectory = path.dirname(
    committed ? descriptor.sourcePath : descriptor.consumedPath,
  );
  syncDirectory(destinationDirectory);
  if (sourceDirectory !== destinationDirectory) syncDirectory(sourceDirectory);
}

function consumeLeaseCredential(descriptor, checkpoint = undefined) {
  if (descriptor === null) return;
  if (descriptor.consumedPath === null) {
    if (!credentialBytesMatch(descriptor.sourcePath, descriptor)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        "Lease credential changed after transaction preparation.",
      );
    }
    return;
  }
  const sourceExists = pathEntryExists(descriptor.sourcePath);
  const consumedExists = pathEntryExists(descriptor.consumedPath);
  if (sourceExists && consumedExists) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease capability exists at both source and consumed paths.",
    );
  }
  if (!sourceExists && consumedExists) {
    if (!credentialBytesMatch(descriptor.consumedPath, descriptor)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        "Lease capability destination changed after consumption.",
      );
    }
    syncLeaseCredentialDirectories(descriptor, true);
    return;
  }
  if (!sourceExists || !credentialBytesMatch(descriptor.sourcePath, descriptor)) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease capability changed before consumption.",
    );
  }
  ensureDurablePrivateDirectoryUnder(
    path.dirname(path.dirname(descriptor.consumedPath)),
    path.dirname(descriptor.consumedPath),
    checkpoint,
  );
  renameSync(descriptor.sourcePath, descriptor.consumedPath);
  invokeLeaseTransactionCheckpoint(
    checkpoint,
    "lease-credential-renamed",
    {
      sourcePath: descriptor.sourcePath,
      consumedPath: descriptor.consumedPath,
    },
  );
  syncDirectory(path.dirname(descriptor.consumedPath));
  invokeLeaseTransactionCheckpoint(
    checkpoint,
    "lease-credential-destination-synced",
    {
      sourcePath: descriptor.sourcePath,
      consumedPath: descriptor.consumedPath,
    },
  );
  if (
    path.dirname(descriptor.sourcePath) !==
    path.dirname(descriptor.consumedPath)
  ) {
    syncDirectory(path.dirname(descriptor.sourcePath));
  }
}

function leaseCredentialIsCommitted(descriptor, repairDurability = false) {
  if (descriptor === null) return true;
  if (descriptor.consumedPath === null) {
    return credentialBytesMatch(descriptor.sourcePath, descriptor);
  }
  const committed = (
    !pathEntryExists(descriptor.sourcePath) &&
    credentialBytesMatch(descriptor.consumedPath, descriptor)
  );
  if (committed && repairDurability) {
    syncLeaseCredentialDirectories(descriptor, true);
  }
  return committed;
}

function restoreLeaseCredential(descriptor) {
  if (descriptor === null || descriptor.consumedPath === null) return;
  const sourceExists = pathEntryExists(descriptor.sourcePath);
  const consumedExists = pathEntryExists(descriptor.consumedPath);
  if (sourceExists === consumedExists) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease capability rollback requires exactly one matching occurrence.",
    );
  }
  if (sourceExists) {
    if (!credentialBytesMatch(descriptor.sourcePath, descriptor)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        "Lease capability source changed during rollback.",
      );
    }
    syncLeaseCredentialDirectories(descriptor, false);
    return;
  }
  if (credentialBytesMatch(descriptor.consumedPath, descriptor)) {
    renameSync(descriptor.consumedPath, descriptor.sourcePath);
    syncLeaseCredentialDirectories(descriptor, false);
    return;
  }
  throw new AutomationControlError(
    "lease_transaction_conflict",
    "Lease capability cannot be restored exactly.",
  );
}

const LEASE_CLEANUP_QUARANTINE_DIRECTORY = ".lease-cleanup-quarantine";

function leaseArchiveHelperError(message, result = undefined) {
  const stderr = String(result?.stderr ?? "").trim();
  return new AutomationControlError(
    "lease_transaction_conflict",
    message,
    stderr === "" ? undefined : { cause: stderr.slice(0, 1_024) },
  );
}

export function resolveLeaseArchivePythonRuntime(
  entryPath = LEASE_ARCHIVE_MOVE_PYTHON,
  {
    requiredUid = 0,
    trustedRoot = "/usr",
    lstat = lstatSync,
    readlink = readlinkSync,
    realpath = realpathSync,
  } = {},
) {
  const root = path.resolve(trustedRoot);
  const entry = path.resolve(entryPath);
  const isInsideRoot = (candidate) => {
    const relative = path.relative(root, candidate);
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  };
  const validateDirectoryChain = (filePath) => {
    let current = path.dirname(filePath);
    while (true) {
      const stats = lstat(current);
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        stats.uid !== requiredUid ||
        (stats.mode & 0o7000) !== 0 ||
        ![0o555, 0o700, 0o755].includes(stats.mode & 0o777)
      ) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease archive Python runtime has an untrusted directory: ${current}.`,
        );
      }
      if (current === root) break;
      const parent = path.dirname(current);
      if (parent === current || !isInsideRoot(parent)) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          "Lease archive Python runtime escapes its trusted root.",
        );
      }
      current = parent;
    }
  };
  if (
    !path.isAbsolute(entryPath) ||
    !path.isAbsolute(trustedRoot) ||
    !isInsideRoot(entry)
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease archive Python runtime must be one absolute path under its trusted root.",
    );
  }
  const visited = new Set();
  let current = entry;
  for (let hop = 0; hop < 8; hop += 1) {
    if (!isInsideRoot(current) || visited.has(current)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        "Lease archive Python runtime symlink chain is cyclic or escaped.",
      );
    }
    visited.add(current);
    validateDirectoryChain(current);
    const stats = lstat(current);
    if (stats.uid !== requiredUid) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        "Lease archive Python runtime chain is not root-owned.",
      );
    }
    if (stats.isSymbolicLink()) {
      const target = readlink(current);
      current = path.resolve(path.dirname(current), target);
      continue;
    }
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      (stats.mode & 0o7000) !== 0 ||
      ![0o555, 0o755].includes(stats.mode & 0o777) ||
      realpath(entry) !== current
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        "Lease archive Python runtime target is not one immutable executable regular file.",
      );
    }
    return current;
  }
  throw new AutomationControlError(
    "lease_transaction_conflict",
    "Lease archive Python runtime symlink chain exceeds its hop limit.",
  );
}

function leaseArchiveHelperMetadataMatches(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function readLeaseArchiveHelperDescriptor(descriptor, size) {
  if (size <= 0 || size > LEASE_ARCHIVE_HELPER_MAX_BYTES) {
    throw new Error("helper source is outside its size boundary");
  }
  const bytes = Buffer.alloc(size + 1);
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
  if (offset !== size) {
    throw new Error("helper source changed size while held");
  }
  return bytes.subarray(0, offset);
}

function admitPinnedLeaseArchiveHelperSource(
  helperPath,
  expectedDigest,
  checkpoint,
) {
  let descriptor;
  try {
    const pathBefore = lstatSync(helperPath, { bigint: true });
    if (
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      realpathSync(helperPath) !== helperPath ||
      (pathBefore.mode & 0o7000n) !== 0n ||
      (pathBefore.mode & 0o022n) !== 0n
    ) {
      throw new Error("helper source path is not pinned");
    }
    descriptor = openSync(
      helperPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const descriptorBefore = fstatSync(descriptor, { bigint: true });
    if (
      !descriptorBefore.isFile() ||
      descriptorBefore.isSymbolicLink() ||
      !leaseArchiveHelperMetadataMatches(pathBefore, descriptorBefore)
    ) {
      throw new Error("helper source changed while it was opened");
    }
    if (checkpoint !== undefined) checkpoint();
    const bytes = readLeaseArchiveHelperDescriptor(
      descriptor,
      Number(descriptorBefore.size),
    );
    const descriptorAfter = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(helperPath, { bigint: true });
    if (
      !leaseArchiveHelperMetadataMatches(descriptorBefore, descriptorAfter) ||
      !leaseArchiveHelperMetadataMatches(descriptorAfter, pathAfter) ||
      createHash("sha256").update(bytes).digest("hex") !== expectedDigest
    ) {
      throw new Error("helper source changed during descriptor admission");
    }
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { descriptor, source };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

export function readPinnedLeaseArchiveHelperSource(
  helperPath = LEASE_ARCHIVE_MOVE_HELPER,
  {
    expectedDigest = LEASE_ARCHIVE_MOVE_HELPER_SHA256,
    checkpoint = undefined,
  } = {},
) {
  let admitted;
  try {
    admitted = admitPinnedLeaseArchiveHelperSource(
      path.resolve(helperPath),
      expectedDigest,
      checkpoint,
    );
    return admitted.source;
  } catch (error) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease archive helper source is unavailable or changed during admission.",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    if (admitted !== undefined) closeSync(admitted.descriptor);
  }
}

function openPinnedLeaseArchiveHelper() {
  try {
    const pythonRuntime = resolveLeaseArchivePythonRuntime();
    const source = readPinnedLeaseArchiveHelperSource();
    return Object.freeze({ source, pythonRuntime });
  } catch (error) {
    if (error instanceof AutomationControlError) throw error;
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease archive helper or its absolute Python runtime is unavailable.",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function runLeaseArchiveHelper(
  helper,
  operation,
  args,
  inheritedDescriptors = [],
) {
  const result = spawnSync(
    helper.pythonRuntime,
    [
      "-E",
      "-I",
      "-S",
      "-c",
      helper.source,
      operation,
      ...args.map(String),
    ],
    {
      env: { HOME: os.homedir(), LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      maxBuffer:
        operation === "list"
          ? LEASE_ARCHIVE_LIST_MAX_BUFFER
          : 2 * LEASE_TRANSACTION_MAX_BYTES,
      stdio: [
        "ignore",
        "pipe",
        "pipe",
        ...inheritedDescriptors,
      ],
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw leaseArchiveHelperError(
      `Lease archive helper ${operation} failed.`,
      result,
    );
  }
  return Buffer.from(result.stdout ?? Buffer.alloc(0));
}

function bigIntDirectoryIdentity(stats) {
  return Object.freeze({
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    uid: stats.uid,
  });
}

function bigIntIdentityMatches(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid
  );
}

function openPinnedLeaseArchiveDirectory(directoryPath, label) {
  requirePrivateDirectory(directoryPath, label);
  const before = lstatSync(directoryPath, { bigint: true });
  let descriptor;
  try {
    descriptor = openSync(
      directoryPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const held = fstatSync(descriptor, { bigint: true });
    if (
      !held.isDirectory() ||
      held.isSymbolicLink() ||
      realpathSync(directoryPath) !== directoryPath ||
      held.uid !== BigInt(process.getuid()) ||
      (held.mode & 0o7777n) !== 0o700n ||
      !bigIntIdentityMatches(
        bigIntDirectoryIdentity(before),
        bigIntDirectoryIdentity(held),
      )
    ) {
      throw new Error("directory generation changed while it was opened");
    }
    return Object.freeze({
      path: directoryPath,
      label,
      descriptor,
      identity: bigIntDirectoryIdentity(held),
    });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${label} could not be pinned to one directory generation.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function assertPinnedLeaseArchiveDirectory(binding) {
  let current;
  try {
    current = lstatSync(binding.path, { bigint: true });
    if (
      realpathSync(binding.path) !== binding.path ||
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      !bigIntIdentityMatches(
        binding.identity,
        bigIntDirectoryIdentity(current),
      )
    ) {
      throw new Error("directory path changed generation");
    }
    const held = fstatSync(binding.descriptor, { bigint: true });
    if (
      !bigIntIdentityMatches(
        binding.identity,
        bigIntDirectoryIdentity(held),
      )
    ) {
      throw new Error("held directory changed generation");
    }
  } catch (error) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${binding.label} changed after descriptor admission.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function readHeldPrivateFile(descriptor, size) {
  const bytes = Buffer.alloc(size + 1);
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
  if (offset !== size) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "A held lease archive inode changed size during admission.",
    );
  }
  return bytes.subarray(0, offset);
}

function openPinnedLeaseArchiveFile(filePath, snapshot, label) {
  let descriptor;
  try {
    descriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const held = fstatSync(descriptor, { bigint: true });
    if (
      !held.isFile() ||
      held.isSymbolicLink() ||
      held.uid !== BigInt(process.getuid()) ||
      (held.mode & 0o7777n) !== 0o600n ||
      held.nlink !== 1n ||
      held.size <= 0n ||
      held.size > BigInt(LEASE_TRANSACTION_MAX_BYTES) ||
      !privateFileIdentityMatches(snapshot.identity, held) ||
      !snapshot.bytes.equals(
        readHeldPrivateFile(descriptor, Number(held.size)),
      )
    ) {
      throw new Error("file inode does not match its admitted snapshot");
    }
    return Object.freeze({
      filePath,
      label,
      descriptor,
      identity: Object.freeze({
        dev: held.dev,
        ino: held.ino,
        mode: held.mode,
        nlink: held.nlink,
        uid: held.uid,
        gid: held.gid,
        size: held.size,
      }),
      snapshot,
    });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error instanceof AutomationControlError) throw error;
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${label} could not be pinned to one file inode.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function assertPinnedLeaseArchiveFile(binding) {
  const held = fstatSync(binding.descriptor, { bigint: true });
  if (
    held.dev !== binding.identity.dev ||
    held.ino !== binding.identity.ino ||
    held.mode !== binding.identity.mode ||
    held.nlink !== binding.identity.nlink ||
    held.uid !== binding.identity.uid ||
    held.gid !== binding.identity.gid ||
    held.size !== binding.identity.size
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${binding.label} held inode changed metadata after descriptor admission.`,
    );
  }
}

function assertPinnedLeaseArchiveFileContent(binding) {
  assertPinnedLeaseArchiveFile(binding);
  const bytes = readHeldPrivateFile(
    binding.descriptor,
    Number(binding.identity.size),
  );
  assertPinnedLeaseArchiveFile(binding);
  if (!binding.snapshot.bytes.equals(bytes)) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${binding.label} held inode changed content after descriptor admission.`,
    );
  }
}

function pinnedDirectoryArguments(binding) {
  return [binding.identity.dev.toString(), binding.identity.ino.toString()];
}

function readPinnedLeaseArchivePath(context, directory, fileBinding, name) {
  assertPinnedLeaseArchiveDirectory(directory);
  assertPinnedLeaseArchiveFile(fileBinding);
  const bytes = runLeaseArchiveHelper(
    context.helperDescriptor,
    "read",
    [
      name,
      ...pinnedDirectoryArguments(directory),
      fileBinding.identity.dev.toString(),
      fileBinding.identity.ino.toString(),
    ],
    [directory.descriptor],
  );
  assertPinnedLeaseArchiveFile(fileBinding);
  return bytes;
}

export function leaseCleanupGenerationDigest(filePath, snapshot) {
  return canonicalLeaseRequestDigest({
    filePath,
    device: BigInt(snapshot.identity.dev).toString(),
    inode: BigInt(snapshot.identity.ino).toString(),
    mode: snapshot.identity.mode,
    links: snapshot.identity.nlink,
    uid: snapshot.identity.uid,
    gid: snapshot.identity.gid,
    size: snapshot.identity.size,
    contentDigest: digestBytes(snapshot.bytes),
  });
}

function legacyLeaseCleanupGenerationDigest(filePath, snapshot) {
  const device = Number(BigInt(snapshot.identity.dev));
  const inode = Number(BigInt(snapshot.identity.ino));
  if (!Number.isSafeInteger(device) || !Number.isSafeInteger(inode)) {
    return null;
  }
  return canonicalLeaseRequestDigest({
    filePath,
    device,
    inode,
    mode: snapshot.identity.mode,
    links: snapshot.identity.nlink,
    uid: snapshot.identity.uid,
    gid: snapshot.identity.gid,
    size: snapshot.identity.size,
    contentDigest: digestBytes(snapshot.bytes),
  });
}

function leaseCleanupGenerationMatches(left, right) {
  return (
    left.identity.dev === right.identity.dev &&
    left.identity.ino === right.identity.ino &&
    left.identity.mode === right.identity.mode &&
    left.identity.nlink === right.identity.nlink &&
    left.identity.uid === right.identity.uid &&
    left.identity.gid === right.identity.gid &&
    left.identity.size === right.identity.size &&
    left.bytes.equals(right.bytes)
  );
}

function leaseCleanupQuarantineDirectory(filePath) {
  return path.join(path.dirname(filePath), LEASE_CLEANUP_QUARANTINE_DIRECTORY);
}

function leaseCleanupArchiveDirectories(paths) {
  const { transactions, receipts } = leaseTransactionDirectories(paths);
  return Object.freeze([
    leaseCleanupQuarantineDirectory(path.join(transactions, "archive.json")),
    leaseCleanupQuarantineDirectory(path.join(receipts, "archive.json")),
  ]);
}

function requireExactPrivateArchiveDirectory(directoryPath, label) {
  const binding = openPinnedLeaseArchiveDirectory(directoryPath, label);
  closeSync(binding.descriptor);
}

function ensureDurablePrivateArchiveDirectory(
  directoryPath,
  {
    privateRoot,
    context,
    label = "Lease archive storage directory",
    checkpoint = undefined,
  },
) {
  const root = path.resolve(privateRoot);
  const target = path.resolve(directoryPath);
  const relative = path.relative(root, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new AutomationControlError(
      "invalid_state_permissions",
      `${label} must remain under its trusted control root.`,
    );
  }
  let parent = context.directoryByPath.get(root);
  if (parent === undefined) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease archive storage did not pin its canonical control root.",
    );
  }
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const parentPath = parent.path;
    const nextPath = path.join(parentPath, segment);
    const cached = context.directoryByPath.get(nextPath);
    if (cached !== undefined) {
      parent = cached;
      continue;
    }
    assertPinnedLeaseArchiveDirectory(parent);
    const result = runLeaseArchiveHelper(
      context.helper,
      "mkdir",
      [segment, ...pinnedDirectoryArguments(parent)],
      [parent.descriptor],
    );
    let created;
    let expectedDevice;
    let expectedInode;
    try {
      const value = JSON.parse(result.toString("utf8"));
      if (
        Object.keys(value ?? {}).sort().join("\n") !==
          ["created", "device", "inode", "protocol"].sort().join("\n") ||
        value.protocol !== LEASE_ARCHIVE_MOVE_PROTOCOL ||
        typeof value.created !== "boolean" ||
        !/^\d+$/.test(String(value.device)) ||
        !/^\d+$/.test(String(value.inode))
      ) {
        throw new Error("unsupported directory admission response");
      }
      created = value.created;
      expectedDevice = BigInt(value.device);
      expectedInode = BigInt(value.inode);
    } catch (error) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `${label} returned invalid descriptor-relative directory admission.`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    if (created) {
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-directory-created",
        { directoryPath: nextPath, parentPath },
      );
    }
    fsyncSync(parent.descriptor);
    invokeLeaseTransactionCheckpoint(
      checkpoint,
      "lease-directory-parent-synced",
      { directoryPath: nextPath, parentPath, created },
    );
    assertPinnedLeaseArchiveDirectory(parent);
    const child = openPinnedLeaseArchiveDirectory(nextPath, label);
    if (
      child.identity.dev !== expectedDevice ||
      child.identity.ino !== expectedInode ||
      child.identity.dev !== parent.identity.dev
    ) {
      closeSync(child.descriptor);
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `${label} changed generation after descriptor-relative admission.`,
      );
    }
    fsyncSync(child.descriptor);
    context.directoryByPath.set(nextPath, child);
    parent = child;
  }
  assertPinnedLeaseArchiveDirectory(parent);
  if (parent.path !== target) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${label} did not resolve to its exact requested path.`,
    );
  }
}

function ensureLeaseArchiveStorageDirectories(paths, checkpoint = undefined) {
  const helper = openPinnedLeaseArchiveHelper();
  const root = openPinnedLeaseArchiveDirectory(
    paths.controlRoot,
    "Automation control root",
  );
  const context = {
    helper,
    directoryByPath: new Map([[paths.controlRoot, root]]),
  };
  const { transactions, receipts } = leaseTransactionDirectories(paths);
  try {
    for (const directoryPath of [
      paths.leases,
      transactions,
      receipts,
      ...leaseCleanupArchiveDirectories(paths),
    ]) {
      ensureDurablePrivateArchiveDirectory(directoryPath, {
        privateRoot: paths.controlRoot,
        context,
        label: `Lease archive storage directory ${directoryPath}`,
        checkpoint,
      });
    }
    for (const binding of context.directoryByPath.values()) {
      assertPinnedLeaseArchiveDirectory(binding);
    }
  } finally {
    for (const binding of [...context.directoryByPath.values()].reverse()) {
      closeSync(binding.descriptor);
    }
  }
}

function parseLeaseArchiveFilesystemResult(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new AutomationControlError(
      "lease_archive_capacity_invalid",
      `${label} filesystem admission returned invalid JSON.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  if (
    Object.keys(value ?? {}).sort().join("\n") !==
      [
        "availableBytes",
        "device",
        "filesystemType",
        "local",
        "platform",
        "protocol",
        "totalBytes",
      ]
        .sort()
        .join("\n") ||
    value.protocol !== LEASE_ARCHIVE_MOVE_PROTOCOL ||
    !["darwin", "linux"].includes(value.platform) ||
    typeof value.filesystemType !== "string" ||
    value.filesystemType.length === 0 ||
    typeof value.local !== "boolean" ||
    !/^\d+$/.test(String(value.device)) ||
    !/^\d+$/.test(String(value.availableBytes)) ||
    !/^\d+$/.test(String(value.totalBytes))
  ) {
    throw new AutomationControlError(
      "lease_archive_capacity_invalid",
      `${label} filesystem admission has an unsupported shape.`,
    );
  }
  return Object.freeze({
    ...value,
    device: BigInt(value.device),
    availableBytes: BigInt(value.availableBytes),
    totalBytes: BigInt(value.totalBytes),
  });
}

function listPinnedLeaseArchiveDirectory(context, binding) {
  assertPinnedLeaseArchiveDirectory(binding);
  const bytes = runLeaseArchiveHelper(
    context.helperDescriptor,
    "list",
    pinnedDirectoryArguments(binding),
    [binding.descriptor],
  );
  if (bytes.length === 0) return [];
  const entries = bytes.toString("utf8").split("\0");
  if (
    entries.some(
      (entry) =>
        entry.length === 0 ||
        entry === "." ||
        entry === ".." ||
        entry.includes("/") ||
        entry.includes("\0"),
    )
  ) {
    throw new AutomationControlError(
      "lease_archive_capacity_invalid",
      `${binding.label} contains an invalid entry name.`,
    );
  }
  return entries;
}

function inspectLeaseArchiveEntry(binding, entry, expectedDevice) {
  const entryPath = path.join(binding.path, entry);
  let descriptor;
  try {
    const before = lstatSync(entryPath, { bigint: true });
    descriptor = openSync(
      entryPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const held = fstatSync(descriptor, { bigint: true });
    const after = lstatSync(entryPath, { bigint: true });
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !held.isFile() ||
      held.isSymbolicLink() ||
      !after.isFile() ||
      after.isSymbolicLink() ||
      before.dev !== held.dev ||
      before.ino !== held.ino ||
      held.dev !== after.dev ||
      held.ino !== after.ino ||
      held.dev !== expectedDevice ||
      held.uid !== BigInt(process.getuid()) ||
      (held.mode & 0o7777n) !== 0o600n ||
      held.nlink !== 1n ||
      held.size <= 0n ||
      held.size > BigInt(LEASE_TRANSACTION_MAX_BYTES)
    ) {
      throw new Error("entry metadata is outside the archive boundary");
    }
    return Object.freeze({
      size: Number(held.size),
      mtimeMs: Number(held.mtimeMs),
    });
  } catch (error) {
    throw new AutomationControlError(
      "lease_archive_capacity_invalid",
      `Lease cleanup archive entry ${entryPath} is not one private physical regular file.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function inspectLeaseCleanupArchiveCapacity(
  stateRoot = undefined,
  {
    nowMs = Date.now(),
    reservation = undefined,
    limits = undefined,
  } = {},
) {
  if (!Number.isFinite(nowMs)) {
    throw new AutomationControlError(
      "lease_archive_capacity_invalid",
      "Lease archive capacity inspection requires a finite clock.",
    );
  }
  const paths = automationControlPaths(stateRoot);
  const appliedLimits = Object.freeze({
    maxEntries: limits?.maxEntries ?? LEASE_ARCHIVE_MAX_ENTRIES,
    maxBytes: limits?.maxBytes ?? LEASE_ARCHIVE_MAX_BYTES,
    maxAgeMs: limits?.maxAgeMs ?? LEASE_ARCHIVE_MAX_AGE_MS,
    minFreeBytes: limits?.minFreeBytes ?? LEASE_ARCHIVE_MIN_FREE_BYTES,
  });
  const appliedReservation = Object.freeze({
    entries: reservation?.entries ?? 0,
    bytes: reservation?.bytes ?? 0,
    oldestMtimeMs: reservation?.oldestMtimeMs ?? null,
  });
  if (
    !Number.isSafeInteger(appliedLimits.maxEntries) ||
    appliedLimits.maxEntries < 0 ||
    !Number.isSafeInteger(appliedLimits.maxBytes) ||
    appliedLimits.maxBytes < 0 ||
    !Number.isSafeInteger(appliedLimits.maxAgeMs) ||
    appliedLimits.maxAgeMs < 0 ||
    !Number.isSafeInteger(appliedLimits.minFreeBytes) ||
    appliedLimits.minFreeBytes < 0 ||
    !Number.isSafeInteger(appliedReservation.entries) ||
    appliedReservation.entries < 0 ||
    !Number.isSafeInteger(appliedReservation.bytes) ||
    appliedReservation.bytes < 0 ||
    (appliedReservation.oldestMtimeMs !== null &&
      !Number.isFinite(appliedReservation.oldestMtimeMs)) ||
    (appliedReservation.entries === 0 &&
      appliedReservation.oldestMtimeMs !== null)
  ) {
    throw new AutomationControlError(
      "lease_archive_capacity_invalid",
      "Lease archive limits and reservations must be finite nonnegative values.",
    );
  }
  const { transactions, receipts } = leaseTransactionDirectories(paths);
  const helperDescriptor = openPinnedLeaseArchiveHelper();
  const directoryBindings = [];
  try {
    const requiredDirectories = [
      paths.stateRoot,
      paths.controlRoot,
      paths.leases,
      transactions,
      receipts,
      ...leaseCleanupArchiveDirectories(paths),
    ];
    const missingDirectories = requiredDirectories.filter(
      (directoryPath) => !pathEntryExists(directoryPath),
    );
    if (missingDirectories.length > 0) {
      throw new AutomationControlError(
        "lease_archive_capacity_invalid",
        `Lease archive storage is incomplete: ${missingDirectories.join(", ")}.`,
      );
    }
    const context = { helperDescriptor };
    for (const directoryPath of requiredDirectories) {
      const binding = openPinnedLeaseArchiveDirectory(
        directoryPath,
        `Lease archive storage directory ${directoryPath}`,
      );
      directoryBindings.push(binding);
    }
    const stateBinding = directoryBindings.find(
      (binding) => binding.path === paths.stateRoot,
    );
    const stateDevice = stateBinding.identity.dev;
    const stateFilesystem = parseLeaseArchiveFilesystemResult(
      runLeaseArchiveHelper(
        helperDescriptor,
        "filesystem",
        pinnedDirectoryArguments(stateBinding),
        [stateBinding.descriptor],
      ),
      stateBinding.label,
    );
    const problems = [];
    for (const binding of directoryBindings) {
      if (
        binding.identity.dev !== stateDevice ||
        stateFilesystem.device !== stateDevice
      ) {
        problems.push(`${binding.path} is not on the automation state device`);
      }
      if (!stateFilesystem.local) {
        problems.push(
          `${binding.path} uses nonlocal filesystem ${stateFilesystem.filesystemType}`,
        );
      }
    }
    let count = 0;
    let bytes = 0;
    let oldestMtimeMs = null;
    const archiveNamePattern =
      /^(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[0-9a-f]{64}\.json$/;
    for (const archiveDirectory of leaseCleanupArchiveDirectories(paths)) {
      const binding = directoryBindings.find(
        (candidate) => candidate.path === archiveDirectory,
      );
      if (binding === undefined) continue;
      const beforeEntries = listPinnedLeaseArchiveDirectory(context, binding);
      for (const entry of beforeEntries) {
        if (!archiveNamePattern.test(entry)) {
          throw new AutomationControlError(
            "lease_archive_capacity_invalid",
            `Lease cleanup archive ${path.join(binding.path, entry)} has an invalid name.`,
          );
        }
        const inspected = inspectLeaseArchiveEntry(
          binding,
          entry,
          stateDevice,
        );
        count += 1;
        bytes += inspected.size;
        oldestMtimeMs =
          oldestMtimeMs === null
            ? inspected.mtimeMs
            : Math.min(oldestMtimeMs, inspected.mtimeMs);
      }
      const afterEntries = listPinnedLeaseArchiveDirectory(context, binding);
      if (beforeEntries.join("\0") !== afterEntries.join("\0")) {
        throw new AutomationControlError(
          "lease_archive_capacity_invalid",
          `${binding.label} changed during capacity accounting.`,
        );
      }
    }
    const oldestAgeMs =
      oldestMtimeMs === null ? 0 : Math.max(0, nowMs - oldestMtimeMs);
    const projectedOldestMtimeMs =
      appliedReservation.oldestMtimeMs === null
        ? oldestMtimeMs
        : oldestMtimeMs === null
          ? appliedReservation.oldestMtimeMs
          : Math.min(oldestMtimeMs, appliedReservation.oldestMtimeMs);
    const projectedOldestAgeMs =
      projectedOldestMtimeMs === null
        ? 0
        : Math.max(0, nowMs - projectedOldestMtimeMs);
    const projectedCount = count + appliedReservation.entries;
    const projectedBytes = bytes + appliedReservation.bytes;
    const availableBytes = stateFilesystem.availableBytes;
    if (projectedCount > appliedLimits.maxEntries) {
      problems.push("lease cleanup archive entry limit is exhausted");
    }
    if (projectedBytes > appliedLimits.maxBytes) {
      problems.push("lease cleanup archive byte limit is exhausted");
    }
    if (projectedOldestAgeMs > appliedLimits.maxAgeMs) {
      problems.push("lease cleanup archive oldest-age limit is exhausted");
    }
    if (
      availableBytes === null ||
      availableBytes <
        BigInt(appliedLimits.minFreeBytes) + BigInt(appliedReservation.bytes)
    ) {
      problems.push("lease cleanup archive free-space headroom is exhausted");
    }
    for (const binding of directoryBindings) {
      assertPinnedLeaseArchiveDirectory(binding);
    }
    return Object.freeze({
      ready: problems.length === 0,
      problems: Object.freeze(problems),
      count,
      bytes,
      oldestAgeMs,
      oldestMtimeMs,
      projectedCount,
      projectedBytes,
      projectedOldestAgeMs,
      projectedOldestMtimeMs,
      device: stateDevice.toString(),
      filesystemType: stateFilesystem.filesystemType,
      availableBytes: Number(availableBytes),
      reservation: appliedReservation,
      limits: appliedLimits,
    });
  } finally {
    for (const binding of directoryBindings.reverse()) {
      closeSync(binding.descriptor);
    }
  }
}

function requireLeaseCleanupArchiveCapacity(paths, reservation) {
  const inspection = inspectLeaseCleanupArchiveCapacity(paths.stateRoot, {
    reservation,
  });
  if (!inspection.ready) {
    throw new AutomationControlError(
      "lease_archive_capacity_exceeded",
      `Lease cleanup archive cannot admit another transaction: ${inspection.problems.join("; ")}.`,
      inspection,
    );
  }
  return inspection;
}

function leaseCleanupQuarantinePath(filePath, cleanupOperationId, snapshot) {
  return path.join(
    leaseCleanupQuarantineDirectory(filePath),
    `${cleanupOperationId}.${leaseCleanupGenerationDigest(filePath, snapshot)}.json`,
  );
}

function leaseCleanupQuarantinePathMatches(
  archivePath,
  filePath,
  cleanupOperationId,
  snapshot,
) {
  if (
    leaseCleanupQuarantinePath(filePath, cleanupOperationId, snapshot) ===
    archivePath
  ) {
    return true;
  }
  const legacyDigest = legacyLeaseCleanupGenerationDigest(filePath, snapshot);
  return (
    legacyDigest !== null &&
    path.join(
      leaseCleanupQuarantineDirectory(filePath),
      `${cleanupOperationId}.${legacyDigest}.json`,
    ) === archivePath
  );
}

function readLeaseCleanupArchiveEntries(
  paths,
  directoryPath,
  cleanupOperationId,
) {
  if (!pathEntryExists(directoryPath)) return [];
  requirePrivateDirectory(directoryPath, "Lease cleanup quarantine directory");
  const prefix = `${cleanupOperationId}.`;
  return readdirSync(directoryPath)
    .filter((entry) => entry.startsWith(prefix))
    .sort()
    .map((entry) => {
      if (
        !new RegExp(`^${cleanupOperationId}\\.[0-9a-f]{64}\\.json$`).test(
          entry,
        )
      ) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease cleanup archive ${entry} has an invalid generation name.`,
        );
      }
      const quarantinePath = path.join(directoryPath, entry);
      const snapshot = readPrivateBytes(
        quarantinePath,
        "Lease cleanup quarantine",
        { privateRoot: paths.controlRoot, includeMetadata: true },
      );
      return { entry, quarantinePath, snapshot };
    });
}

function validateLeaseStagingSnapshot(transaction, side, snapshot) {
  const descriptor = transaction[side];
  if (
    snapshot.bytes.length !== descriptor.recordSize ||
    digestBytes(snapshot.bytes) !== descriptor.recordDigest
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease ${side} staging does not match its transaction.`,
    );
  }
  parseLeaseRecordBytes(snapshot.bytes, transaction.name);
}

function validateActiveLeaseTransactionSnapshot(
  paths,
  transaction,
  snapshot,
) {
  const parsed = parseLeaseTransactionBytes(
    snapshot.bytes,
    paths,
    transaction.name,
  );
  if (
    !canonicalValuesEqual(parsed, transaction) ||
    !snapshot.bytes.equals(privateJsonBytes(transaction))
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease transaction for ${transaction.name} changed before archival.`,
    );
  }
}

function parseRetiredLeaseTransactionSnapshot(paths, transaction, snapshot) {
  const retired = parseLeaseTransactionBytes(
    snapshot.bytes,
    paths,
    transaction.name,
  );
  if (
    retired.name !== transaction.name ||
    retired.operation !== transaction.operation ||
    retired.operationId !== transaction.operationId ||
    !snapshot.bytes.equals(privateJsonBytes(retired))
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Retired lease transaction for ${transaction.name} does not match its operation identity.`,
    );
  }
  return retired;
}

function retiredPreparedLeaseTransactionMaterial(paths, proposed) {
  const archiveDirectory = leaseCleanupQuarantineDirectory(
    leaseTransactionFiles(
      paths,
      proposed.name,
      proposed.operationId,
      proposed.operation,
    ).transaction,
  );
  const entries = readLeaseCleanupArchiveEntries(
    paths,
    archiveDirectory,
    proposed.operationId,
  );
  const retiredTransactions = [];
  for (const entry of entries) {
    let value;
    try {
      value = JSON.parse(privateAuthorityDecoder.decode(entry.snapshot.bytes));
    } catch {
      continue;
    }
    if (value?.kind !== LEASE_TRANSACTION_KIND) continue;
    retiredTransactions.push(
      parseRetiredLeaseTransactionSnapshot(paths, proposed, entry.snapshot),
    );
  }
  if (retiredTransactions.length === 0) return null;
  if (retiredTransactions.length !== 1) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease operation ${proposed.operationId} has multiple retired WAL identities.`,
    );
  }
  const [retired] = retiredTransactions;
  if (
    retired.phase !== "prepared" ||
    retired.completedAt !== null ||
    retired.requestDigest !== proposed.requestDigest ||
    retired.tokenDigest !== proposed.tokenDigest ||
    !canonicalValuesEqual(retired.before, proposed.before) ||
    !canonicalValuesEqual(retired.capability, proposed.capability) ||
    !canonicalValuesEqual(retired.takeover, proposed.takeover)
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease operation ${proposed.operationId} is permanently bound to a different retired request.`,
    );
  }
  const material = { beforeBytes: null, afterBytes: null };
  for (const side of ["before", "after"]) {
    const descriptor = retired[side];
    if (descriptor.recordDigest === null) continue;
    const matches = entries.filter(
      ({ snapshot }) =>
        snapshot.bytes.length === descriptor.recordSize &&
        digestBytes(snapshot.bytes) === descriptor.recordDigest,
    );
    if (matches.length !== 1) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Retired lease operation ${proposed.operationId} has ambiguous ${side} staging.`,
      );
    }
    validateLeaseStagingSnapshot(retired, side, matches[0].snapshot);
    material[`${side}Bytes`] = matches[0].snapshot.bytes;
  }
  return Object.freeze({
    transaction: retired,
    beforeBytes: material.beforeBytes,
    afterBytes: material.afterBytes,
  });
}

function leaseCleanupStagingDescriptorKey(descriptor) {
  return `${descriptor.recordSize}:${descriptor.recordDigest}`;
}

function validateArchivedReceiptSnapshot(
  paths,
  transaction,
  originalPath,
  snapshot,
) {
  const receipt = parseLeaseTransactionBytes(
    snapshot.bytes,
    paths,
    transaction.name,
  );
  const receiptPath = leaseTransactionFiles(
    paths,
    transaction.name,
    receipt.operationId,
    receipt.operation,
  ).receipt;
  const currentReceiptPath = leaseTransactionFiles(
    paths,
    transaction.name,
    transaction.operationId,
    transaction.operation,
  ).receipt;
  if (
    receipt.phase !== "complete" ||
    receipt.name !== transaction.name ||
    receipt.operation !== transaction.operation ||
    receiptPath !== originalPath ||
    receiptPath === currentReceiptPath
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease receipt cleanup archive does not match its original operation path.",
    );
  }
  return receipt;
}

function createLeaseCleanupTarget({
  kind,
  filePath,
  order,
  label,
  validateSnapshot,
  canonicalSnapshot = null,
  requirePresence = false,
}) {
  return {
    kind,
    filePath,
    order,
    label,
    validateSnapshot,
    canonicalSnapshot,
    archivePath: null,
    archiveSnapshot: null,
    requirePresence,
  };
}

function assignLeaseCleanupArchive(target, entry) {
  if (target.archiveSnapshot !== null) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${target.label} has duplicate archive generations.`,
    );
  }
  target.archivePath = entry.quarantinePath;
  target.archiveSnapshot = entry.snapshot;
}

function readCanonicalLeaseCleanupSnapshot(paths, target) {
  if (!pathEntryExists(target.filePath)) return null;
  const snapshot = readPrivateBytes(target.filePath, target.label, {
    privateRoot: paths.controlRoot,
    includeMetadata: true,
  });
  target.validateSnapshot(snapshot);
  return snapshot;
}

function buildLeaseCleanupPlan({
  paths,
  transaction,
  includeActive,
  requireActive,
  pruneReceipts,
}) {
  const files = leaseTransactionFiles(
    paths,
    transaction.name,
    transaction.operationId,
    transaction.operation,
  );
  const targets = [];
  const targetsByPath = new Map();
  const addTarget = (target) => {
    if (targetsByPath.has(target.filePath)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease cleanup has duplicate target ${target.filePath}.`,
      );
    }
    targets.push(target);
    targetsByPath.set(target.filePath, target);
    return target;
  };

  for (const [index, side] of ["before", "after"].entries()) {
    const filePath = transaction.staging[`${side}Path`];
    if (filePath === null) continue;
    addTarget(
      createLeaseCleanupTarget({
        kind: `staging-${side}`,
        filePath,
        order: 10 + index,
        label: `Lease ${side} staging`,
        validateSnapshot: (snapshot) =>
          validateLeaseStagingSnapshot(transaction, side, snapshot),
        requirePresence: true,
      }),
    );
  }

  if (includeActive) {
    addTarget(
      createLeaseCleanupTarget({
        kind: "active-wal",
        filePath: files.transaction,
        order: 1_000_000,
        label: `Active lease transaction for ${transaction.name}`,
        validateSnapshot: (snapshot) =>
          validateActiveLeaseTransactionSnapshot(paths, transaction, snapshot),
        requirePresence: requireActive,
      }),
    );
  }

  if (pruneReceipts) {
    const currentReceipt = path.basename(files.receipt);
    const staleReceipts = planLeaseReceiptPruning(
      readValidatedLeaseTransactionReceipts(
        paths,
        transaction.name,
        transaction.operation,
      ),
      currentReceipt,
    );
    for (const stale of staleReceipts) {
      addTarget(
        createLeaseCleanupTarget({
          kind: "stale-receipt",
          filePath: stale.filePath,
          order: 100_000,
          label: `Lease transaction receipt ${stale.entry}`,
          validateSnapshot: (snapshot) =>
            validateArchivedReceiptSnapshot(
              paths,
              transaction,
              stale.filePath,
              snapshot,
            ),
          canonicalSnapshot: {
            bytes: stale.bytes,
            identity: stale.identity,
          },
          requirePresence: true,
        }),
      );
    }
  }

  for (const target of targets) {
    if (target.canonicalSnapshot === null) {
      target.canonicalSnapshot = readCanonicalLeaseCleanupSnapshot(
        paths,
        target,
      );
    }
  }

  const transactionArchiveDirectory = leaseCleanupQuarantineDirectory(
    files.transaction,
  );
  const receiptArchiveDirectory = leaseCleanupQuarantineDirectory(files.receipt);
  const currentOperationArchives = [
    ...readLeaseCleanupArchiveEntries(
      paths,
      transactionArchiveDirectory,
      transaction.operationId,
    ).map((entry) =>
      Object.freeze({ ...entry, archiveScope: "transaction" }),
    ),
    ...readLeaseCleanupArchiveEntries(
      paths,
      receiptArchiveDirectory,
      transaction.operationId,
    ).map((entry) => Object.freeze({ ...entry, archiveScope: "receipt" })),
  ].sort((left, right) =>
    left.quarantinePath.localeCompare(right.quarantinePath),
  );
  const retiredArchives = [];
  const transactionArchiveSpecs = [
    {
      kind: "staging-before",
      side: "before",
      filePath: files.before,
    },
    {
      kind: "staging-after",
      side: "after",
      filePath: files.after,
    },
    {
      kind: "active-wal",
      side: null,
      filePath: files.transaction,
    },
  ];
  const mappedTransactionArchives = currentOperationArchives
    .filter((entry) => entry.archiveScope === "transaction")
    .map((entry) => {
      const matches = transactionArchiveSpecs.filter(
        (spec) =>
          leaseCleanupQuarantinePathMatches(
            entry.quarantinePath,
            spec.filePath,
            transaction.operationId,
            entry.snapshot,
          ),
      );
      if (matches.length !== 1) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease cleanup archive ${entry.entry} does not map to one exact transaction target.`,
        );
      }
      return Object.freeze({ ...entry, ...matches[0] });
    });

  const activeTarget = targetsByPath.get(files.transaction);
  let currentActiveArchive = null;
  const retiredTransactions = [];
  for (const entry of mappedTransactionArchives.filter(
    ({ kind }) => kind === "active-wal",
  )) {
    const archivedTransaction = parseRetiredLeaseTransactionSnapshot(
      paths,
      transaction,
      entry.snapshot,
    );
    const matchesCurrent =
      canonicalValuesEqual(archivedTransaction, transaction) &&
      entry.snapshot.bytes.equals(privateJsonBytes(transaction));
    if (
      activeTarget !== undefined &&
      activeTarget.canonicalSnapshot === null &&
      currentActiveArchive === null &&
      matchesCurrent
    ) {
      activeTarget.validateSnapshot(entry.snapshot);
      assignLeaseCleanupArchive(activeTarget, entry);
      currentActiveArchive = entry;
      continue;
    }
    retiredTransactions.push(archivedTransaction);
    retiredArchives.push({
      filePath: files.transaction,
      archivePath: entry.quarantinePath,
      snapshot: entry.snapshot,
      label: `Retired lease transaction for ${transaction.name}`,
      validateSnapshot: (snapshot) => {
        const parsed = parseRetiredLeaseTransactionSnapshot(
          paths,
          transaction,
          snapshot,
        );
        if (!canonicalValuesEqual(parsed, archivedTransaction)) {
          throw new AutomationControlError(
            "lease_transaction_conflict",
            `Retired lease transaction for ${transaction.name} changed generation.`,
          );
        }
      },
    });
  }

  for (const side of ["before", "after"]) {
    const target = targetsByPath.get(files[side]);
    const currentRequired =
      target !== undefined && target.canonicalSnapshot === null;
    const requirements = [
      ...(currentRequired
        ? [
            {
              kind: "current",
              transaction,
              descriptor: transaction[side],
            },
          ]
        : []),
      ...retiredTransactions
        .filter((retired) => retired.staging[`${side}Path`] !== null)
        .map((retired) => ({
          kind: "retired",
          transaction: retired,
          descriptor: retired[side],
        })),
    ];
    const entries = mappedTransactionArchives.filter(
      ({ kind }) => kind === `staging-${side}`,
    );
    for (const entry of entries) {
      parseLeaseRecordBytes(entry.snapshot.bytes, transaction.name);
      const entryKey = `${entry.snapshot.bytes.length}:${digestBytes(
        entry.snapshot.bytes,
      )}`;
      const requirementIndex = requirements.findIndex(
        ({ descriptor }) =>
          leaseCleanupStagingDescriptorKey(descriptor) === entryKey,
      );
      if (requirementIndex === -1) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease ${side} cleanup archive ${entry.entry} has no exact current or retired generation.`,
        );
      }
      const [requirement] = requirements.splice(requirementIndex, 1);
      validateLeaseStagingSnapshot(
        requirement.transaction,
        side,
        entry.snapshot,
      );
      if (requirement.kind === "current") {
        assignLeaseCleanupArchive(target, entry);
        continue;
      }
      retiredArchives.push({
        filePath: files[side],
        archivePath: entry.quarantinePath,
        snapshot: entry.snapshot,
        label: `Retired lease ${side} staging`,
        validateSnapshot: (snapshot) =>
          validateLeaseStagingSnapshot(
            requirement.transaction,
            side,
            snapshot,
          ),
      });
    }
    if (requirements.length !== 0) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${side} cleanup archives do not cover every exact current and retired generation.`,
      );
    }
  }

  for (const entry of currentOperationArchives.filter(
    ({ archiveScope }) => archiveScope === "receipt",
  )) {
    const receipt = parseLeaseTransactionBytes(
      entry.snapshot.bytes,
      paths,
      transaction.name,
    );
    const originalPath = leaseTransactionFiles(
      paths,
      transaction.name,
      receipt.operationId,
      receipt.operation,
    ).receipt;
    validateArchivedReceiptSnapshot(
      paths,
      transaction,
      originalPath,
      entry.snapshot,
    );
    if (
      !leaseCleanupQuarantinePathMatches(
        entry.quarantinePath,
        originalPath,
        transaction.operationId,
        entry.snapshot,
      )
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease receipt archive ${entry.entry} has the wrong operation-bound generation digest.`,
      );
    }
    let target = targetsByPath.get(originalPath);
    if (target === undefined) {
      target = addTarget(
        createLeaseCleanupTarget({
          kind: "stale-receipt",
          filePath: originalPath,
          order: 100_000,
          label: `Archived lease transaction receipt ${path.basename(originalPath)}`,
          validateSnapshot: (snapshot) =>
            validateArchivedReceiptSnapshot(
              paths,
              transaction,
              originalPath,
              snapshot,
            ),
        }),
      );
    }
    assignLeaseCleanupArchive(target, entry);
  }

  for (const target of targets) {
    if (target.canonicalSnapshot !== null && target.archiveSnapshot !== null) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `${target.label} exists at both its canonical and archive paths.`,
      );
    }
    if (
      target.requirePresence &&
      target.canonicalSnapshot === null &&
      target.archiveSnapshot === null
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `${target.label} disappeared before cleanup admission.`,
      );
    }
    if (target.canonicalSnapshot !== null) {
      target.archivePath = leaseCleanupQuarantinePath(
        target.filePath,
        transaction.operationId,
        target.canonicalSnapshot,
      );
    }
  }

  const immutableTargets = targets
    .sort(
      (left, right) =>
        left.order - right.order || left.filePath.localeCompare(right.filePath),
    )
    .map((target) => Object.freeze({ ...target }));
  const immutableRetiredArchives = retiredArchives.map((archive) =>
    Object.freeze({ ...archive }),
  );
  return Object.freeze({
    operationId: transaction.operationId,
    archiveDirectories: Object.freeze(
      leaseCleanupArchiveDirectories(paths),
    ),
    targets: Object.freeze(immutableTargets),
    retiredArchives: Object.freeze(immutableRetiredArchives),
  });
}

function closeLeaseCleanupDescriptorContext(context) {
  for (const binding of [...context.fileBindings].reverse()) {
    closeSync(binding.descriptor);
  }
  for (const binding of [...context.directoryByPath.values()].reverse()) {
    closeSync(binding.descriptor);
  }
}

function createLeaseCleanupDescriptorContext(paths, plan, checkpoint) {
  const helperDescriptor = openPinnedLeaseArchiveHelper();
  const context = {
    helperDescriptor,
    directoryByPath: new Map(),
    fileBindings: new Set(),
    sourceByTarget: new Map(),
    archiveByPath: new Map(),
  };
  try {
    ensureLeaseArchiveStorageDirectories(paths, checkpoint);
    const directoryPaths = new Set([paths.stateRoot, ...plan.archiveDirectories]);
    for (const target of plan.targets) {
      directoryPaths.add(path.dirname(target.filePath));
      if (target.archivePath !== null) {
        directoryPaths.add(path.dirname(target.archivePath));
      }
    }
    for (const archive of plan.retiredArchives) {
      directoryPaths.add(path.dirname(archive.filePath));
      directoryPaths.add(path.dirname(archive.archivePath));
    }
    for (const directoryPath of [...directoryPaths].sort()) {
      const binding = openPinnedLeaseArchiveDirectory(
        directoryPath,
        `Lease cleanup directory ${directoryPath}`,
      );
      context.directoryByPath.set(directoryPath, binding);
    }
    const stateBinding = context.directoryByPath.get(paths.stateRoot);
    const stateFilesystem = parseLeaseArchiveFilesystemResult(
      runLeaseArchiveHelper(
        helperDescriptor,
        "filesystem",
        pinnedDirectoryArguments(stateBinding),
        [stateBinding.descriptor],
      ),
      stateBinding.label,
    );
    const stateDevice = stateBinding.identity.dev;
    for (const binding of context.directoryByPath.values()) {
      if (
        binding.identity.dev !== stateDevice ||
        stateFilesystem.device !== stateDevice ||
        !stateFilesystem.local
      ) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `${binding.label} is not on the same local filesystem as automation state.`,
        );
      }
    }
    for (const target of plan.targets) {
      if (target.canonicalSnapshot !== null) {
        const binding = openPinnedLeaseArchiveFile(
          target.filePath,
          target.canonicalSnapshot,
          target.label,
        );
        context.fileBindings.add(binding);
        context.sourceByTarget.set(target, binding);
      }
      if (target.archiveSnapshot !== null) {
        const binding = openPinnedLeaseArchiveFile(
          target.archivePath,
          target.archiveSnapshot,
          target.label,
        );
        context.fileBindings.add(binding);
        context.archiveByPath.set(target.archivePath, binding);
      }
    }
    for (const archive of plan.retiredArchives) {
      const binding = openPinnedLeaseArchiveFile(
        archive.archivePath,
        archive.snapshot,
        archive.label,
      );
      context.fileBindings.add(binding);
      context.archiveByPath.set(archive.archivePath, binding);
    }
    return context;
  } catch (error) {
    closeLeaseCleanupDescriptorContext(context);
    throw error;
  }
}

function directoryBindingForPath(context, filePath) {
  const directoryPath = path.dirname(filePath);
  const binding = context.directoryByPath.get(directoryPath);
  if (binding === undefined) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease cleanup did not pin directory ${directoryPath}.`,
    );
  }
  return binding;
}

function validatePinnedTerminalLeaseCleanupTarget(
  context,
  operationId,
  target,
) {
  if (target.archiveSnapshot === null) {
    if (target.canonicalSnapshot === null) return;
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${target.label} has no terminal archive snapshot.`,
    );
  }
  const sourceDirectory = directoryBindingForPath(context, target.filePath);
  const archiveDirectory = directoryBindingForPath(context, target.archivePath);
  runLeaseArchiveHelper(
    context.helperDescriptor,
    "missing",
    [path.basename(target.filePath), ...pinnedDirectoryArguments(sourceDirectory)],
    [sourceDirectory.descriptor],
  );
  const archiveBinding = context.archiveByPath.get(target.archivePath);
  if (archiveBinding === undefined) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${target.label} terminal archive inode is not held.`,
    );
  }
  const bytes = readPinnedLeaseArchivePath(
    context,
    archiveDirectory,
    archiveBinding,
    path.basename(target.archivePath),
  );
  const archiveSnapshot = {
    bytes,
    identity: target.archiveSnapshot.identity,
  };
  if (
    !target.archiveSnapshot.bytes.equals(bytes) ||
    !leaseCleanupQuarantinePathMatches(
      target.archivePath,
      target.filePath,
      operationId,
      archiveSnapshot,
    )
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${target.label} terminal archive changed generation.`,
    );
  }
  target.validateSnapshot(archiveSnapshot);
  assertPinnedLeaseArchiveDirectory(sourceDirectory);
  assertPinnedLeaseArchiveDirectory(archiveDirectory);
}

function validatePinnedRetiredLeaseCleanupArchive(
  context,
  operationId,
  archive,
) {
  const directory = directoryBindingForPath(context, archive.archivePath);
  const fileBinding = context.archiveByPath.get(archive.archivePath);
  if (fileBinding === undefined) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${archive.label} retired archive inode is not held.`,
    );
  }
  const bytes = readPinnedLeaseArchivePath(
    context,
    directory,
    fileBinding,
    path.basename(archive.archivePath),
  );
  const snapshot = { bytes, identity: archive.snapshot.identity };
  if (
    !archive.snapshot.bytes.equals(bytes) ||
    !leaseCleanupQuarantinePathMatches(
      archive.archivePath,
      archive.filePath,
      operationId,
      snapshot,
    )
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${archive.label} retired generation changed after descriptor admission.`,
    );
  }
  archive.validateSnapshot(snapshot);
}

function syncPinnedLeaseArchiveDirectory(context, binding) {
  assertPinnedLeaseArchiveDirectory(binding);
  runLeaseArchiveHelper(
    context.helperDescriptor,
    "sync",
    pinnedDirectoryArguments(binding),
    [binding.descriptor],
  );
  assertPinnedLeaseArchiveDirectory(binding);
}

function validateExactLeaseCleanupArchiveSet(
  context,
  plan,
  terminalTargets,
) {
  const expectedByDirectory = new Map(
    plan.archiveDirectories.map((directoryPath) => [directoryPath, new Map()]),
  );
  for (const target of terminalTargets) {
    expectedByDirectory
      .get(path.dirname(target.archivePath))
      .set(path.basename(target.archivePath), {
        kind: "target",
        value: target,
      });
  }
  for (const archive of plan.retiredArchives) {
    expectedByDirectory
      .get(path.dirname(archive.archivePath))
      .set(path.basename(archive.archivePath), {
        kind: "retired",
        value: archive,
      });
  }
  const prefix = `${plan.operationId}.`;
  for (const [directoryPath, expected] of expectedByDirectory) {
    const directory = context.directoryByPath.get(directoryPath);
    const actualEntries = listPinnedLeaseArchiveDirectory(context, directory)
      .filter((entry) => entry.startsWith(prefix))
      .sort();
    const expectedEntries = [...expected.keys()].sort();
    if (actualEntries.join("\0") !== expectedEntries.join("\0")) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease cleanup archive set changed after immutable planning in ${directoryPath}.`,
      );
    }
    for (const entry of expectedEntries) {
      const item = expected.get(entry);
      if (item.kind === "target") {
        validatePinnedTerminalLeaseCleanupTarget(
          context,
          plan.operationId,
          item.value,
        );
      } else {
        validatePinnedRetiredLeaseCleanupArchive(
          context,
          plan.operationId,
          item.value,
        );
      }
    }
  }
  for (const binding of context.directoryByPath.values()) {
    assertPinnedLeaseArchiveDirectory(binding);
  }
}

function remainingLeaseCleanupArchiveReservation(targets) {
  const remaining = targets.filter(
    (target) =>
      target.canonicalSnapshot !== null && target.archiveSnapshot === null,
  );
  return Object.freeze({
    entries: remaining.length,
    bytes: remaining.reduce(
      (sum, target) => sum + target.canonicalSnapshot.bytes.length,
      0,
    ),
    oldestMtimeMs:
      remaining.length === 0
        ? null
        : remaining.reduce(
            (oldest, target) =>
              Math.min(oldest, target.canonicalSnapshot.identity.mtimeMs),
            Number.POSITIVE_INFINITY,
          ),
  });
}

function executeLeaseCleanupPlan(
  paths,
  plan,
  checkpoint = undefined,
  eventsGuard,
) {
  requireActiveLeaseEventsGuard(eventsGuard);
  const context = createLeaseCleanupDescriptorContext(paths, plan, checkpoint);
  const terminalTargets = [];
  try {
    for (const retiredArchive of plan.retiredArchives) {
      validatePinnedRetiredLeaseCleanupArchive(
        context,
        plan.operationId,
        retiredArchive,
      );
      syncPinnedLeaseArchiveDirectory(
        context,
        directoryBindingForPath(context, retiredArchive.archivePath),
      );
      syncPinnedLeaseArchiveDirectory(
        context,
        directoryBindingForPath(context, retiredArchive.filePath),
      );
    }
    invokeLeaseTransactionCheckpoint(
      checkpoint,
      "lease-cleanup-before-capacity-recheck",
      remainingLeaseCleanupArchiveReservation(plan.targets),
    );
    requireLeaseCleanupArchiveCapacity(
      paths,
      remainingLeaseCleanupArchiveReservation(plan.targets),
    );
    for (
      let targetIndex = 0;
      targetIndex < plan.targets.length;
      targetIndex += 1
    ) {
      const plannedTarget = plan.targets[targetIndex];
      if (plannedTarget.archiveSnapshot !== null) {
        validatePinnedTerminalLeaseCleanupTarget(
          context,
          plan.operationId,
          plannedTarget,
        );
        syncPinnedLeaseArchiveDirectory(
          context,
          directoryBindingForPath(context, plannedTarget.archivePath),
        );
        syncPinnedLeaseArchiveDirectory(
          context,
          directoryBindingForPath(context, plannedTarget.filePath),
        );
        terminalTargets.push(plannedTarget);
        continue;
      }
      if (plannedTarget.canonicalSnapshot === null) continue;
      const sourceBinding = context.sourceByTarget.get(plannedTarget);
      if (sourceBinding === undefined) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `${plannedTarget.label} source inode is not held.`,
        );
      }
      plannedTarget.validateSnapshot(plannedTarget.canonicalSnapshot);
      const sourceDirectory = directoryBindingForPath(
        context,
        plannedTarget.filePath,
      );
      const archiveDirectory = directoryBindingForPath(
        context,
        plannedTarget.archivePath,
      );
      const details = {
        kind: plannedTarget.kind,
        filePath: plannedTarget.filePath,
        quarantinePath: plannedTarget.archivePath,
        archivePath: plannedTarget.archivePath,
      };
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-cleanup-admitted",
        details,
      );
      assertPinnedLeaseArchiveFileContent(sourceBinding);
      assertPinnedLeaseArchiveDirectory(sourceDirectory);
      assertPinnedLeaseArchiveDirectory(archiveDirectory);
      requireLeaseCleanupArchiveCapacity(
        paths,
        remainingLeaseCleanupArchiveReservation(
          plan.targets.slice(targetIndex),
        ),
      );
      runLeaseArchiveHelper(
        context.helperDescriptor,
        "rename",
        [
          path.basename(plannedTarget.filePath),
          path.basename(plannedTarget.archivePath),
          sourceBinding.identity.dev.toString(),
          sourceBinding.identity.ino.toString(),
          sourceBinding.identity.size.toString(),
          digestBytes(plannedTarget.canonicalSnapshot.bytes),
          ...pinnedDirectoryArguments(sourceDirectory),
          ...pinnedDirectoryArguments(archiveDirectory),
        ],
        [
          sourceDirectory.descriptor,
          archiveDirectory.descriptor,
          sourceBinding.descriptor,
        ],
      );
      context.archiveByPath.set(plannedTarget.archivePath, sourceBinding);
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-cleanup-renamed",
        details,
      );
      syncPinnedLeaseArchiveDirectory(context, archiveDirectory);
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-cleanup-archive-synced",
        details,
      );
      syncPinnedLeaseArchiveDirectory(context, sourceDirectory);
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-cleanup-source-synced",
        details,
      );
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-cleanup-quarantined",
        details,
      );
      const terminalTarget = Object.freeze({
        ...plannedTarget,
        archiveSnapshot: plannedTarget.canonicalSnapshot,
      });
      validatePinnedTerminalLeaseCleanupTarget(
        context,
        plan.operationId,
        terminalTarget,
      );
      terminalTargets.push(terminalTarget);
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-cleanup-validated",
        details,
      );
    }
    validateExactLeaseCleanupArchiveSet(context, plan, terminalTargets);
    requireLeaseCleanupArchiveCapacity(paths, {
      entries: 0,
      bytes: 0,
      oldestMtimeMs: null,
    });
  } finally {
    closeLeaseCleanupDescriptorContext(context);
  }
}

function abortPreparedLeaseTransaction(
  paths,
  files,
  transaction,
  checkpoint = undefined,
  eventsGuard,
) {
  const cleanupPlan = buildLeaseCleanupPlan({
    paths,
    transaction,
    includeActive: true,
    requireActive: true,
    pruneReceipts: false,
  });
  restoreLeaseCredential(transaction.capability);
  executeLeaseCleanupPlan(paths, cleanupPlan, checkpoint, eventsGuard);
}

function completeLeaseTransaction(
  paths,
  files,
  transaction,
  completedAtMs,
  checkpoint = undefined,
  eventsGuard,
) {
  transaction.phase = "complete";
  transaction.completedAt = nowIso(completedAtMs);
  writeLeaseTransactionFile(files.transaction, transaction, checkpoint);
  writeLeaseTransactionFile(
    files.receipt,
    transaction,
    checkpoint,
    "receipt",
  );
  invokeLeaseTransactionCheckpoint(checkpoint, "lease-receipt-written");
  const cleanupPlan = buildLeaseCleanupPlan({
    paths,
    transaction,
    includeActive: true,
    requireActive: true,
    pruneReceipts: true,
  });
  executeLeaseCleanupPlan(paths, cleanupPlan, checkpoint, eventsGuard);
  return transaction;
}

function recoverLeaseTransactionUnlocked(
  paths,
  name,
  nowMs = Date.now(),
  eventsGuard = undefined,
) {
  const directories = leaseTransactionDirectories(paths);
  const activePath = path.join(directories.transactions, `${name}.json`);
  const transaction = readLeaseTransactionFile(activePath, paths, name);
  if (transaction === null) return null;
  const files = leaseTransactionFiles(
    paths,
    name,
    transaction.operationId,
    transaction.operation,
  );
  reconcileActiveLeaseTransactionArtifacts(paths, files, transaction);
  if (transaction.phase !== "complete") {
    validateLeaseStaging(paths, transaction);
  }
  const recover = (activeEventsGuard) => {
    requireActiveLeaseEventsGuard(activeEventsGuard);
    reconcileLeaseStateIntermediate(paths, transaction);
    const current = readLeaseStateSnapshot(paths, name);
    const matchesBefore = leaseStateMatches(
      current.descriptor,
      transaction.before,
    );
    const matchesAfter = leaseStateMatches(
      current.descriptor,
      transaction.after,
    );
    if (matchesBefore || matchesAfter) {
      repairLeaseStateAdmissionDurability(paths, name, current);
    }
    const matchedEvent = matchingLeaseEventUnlocked(paths, transaction);

    if (transaction.phase === "complete") {
      if (!matchesAfter || matchedEvent.event === null) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Completed lease transaction for ${name} does not match state and audit history.`,
        );
      }
      const receipt = readLeaseTransactionFile(
        files.receipt,
        paths,
        transaction.name,
      );
      if (receipt === null) {
        writeLeaseTransactionFile(
          files.receipt,
          transaction,
          undefined,
          "receipt",
        );
      } else if (!canonicalValuesEqual(receipt, transaction)) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Completed lease transaction receipt for ${name} changed before recovery.`,
        );
      }
      const cleanupPlan = buildLeaseCleanupPlan({
        paths,
        transaction,
        includeActive: true,
        requireActive: true,
        pruneReceipts: true,
      });
      executeLeaseCleanupPlan(
        paths,
        cleanupPlan,
        undefined,
        activeEventsGuard,
      );
      return transaction;
    }

    if (transaction.phase === "prepared") {
      if (matchedEvent.event !== null) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease transaction for ${name} has an audit event without committed state.`,
        );
      }
      if (matchesBefore) {
        const cleanupPlan = buildLeaseCleanupPlan({
          paths,
          transaction,
          includeActive: true,
          requireActive: true,
          pruneReceipts: false,
        });
        restoreLeaseCredential(transaction.capability);
        executeLeaseCleanupPlan(
          paths,
          cleanupPlan,
          undefined,
          activeEventsGuard,
        );
        return null;
      }
    }

    if (
      !matchesAfter ||
      !leaseCredentialIsCommitted(transaction.capability, true)
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease transaction for ${name} conflicts with canonical state.`,
      );
    }
    if (
      transaction.phase === "event-appended" &&
      matchedEvent.event === null
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease transaction for ${name} lost its recorded audit event.`,
      );
    }
    if (matchedEvent.event === null) {
      prepareControlEventAppend(matchedEvent.snapshot.bytes, transaction.event);
      appendEventLineUnlocked(
        paths,
        transaction.event,
        matchedEvent.snapshot.bytes,
      );
    }
    return completeLeaseTransaction(
      paths,
      files,
      transaction,
      nowMs,
      undefined,
      activeEventsGuard,
    );
  };
  if (eventsGuard !== undefined) {
    requireActiveLeaseEventsGuard(eventsGuard);
    return recover(eventsGuard);
  }
  return withActiveLeaseEventsGuard(paths, recover);
}

function readCompletedLeaseReceipt(paths, name, operation, operationId) {
  const files = leaseTransactionFiles(
    paths,
    name,
    operationId,
    operation,
  );
  const transaction = readLeaseTransactionFile(files.receipt, paths, name);
  if (
    transaction === null ||
    transaction.phase !== "complete" ||
    transaction.operation !== operation ||
    transaction.operationId !== operationId
  ) {
    return null;
  }
  return transaction;
}

function requireCurrentLeaseOperationRecoveryMatch(
  paths,
  name,
  operation,
  operationId,
  requestDigest,
  tokenDigest,
) {
  const activePath = path.join(
    leaseTransactionDirectories(paths).transactions,
    `${name}.json`,
  );
  const activeTemporaryPath = leaseAtomicTemporaryPath(
    activePath,
    operationId,
  );
  if (pathEntryExists(activeTemporaryPath)) {
    if (pathEntryExists(activePath)) {
      removeLeaseAtomicTemporaryFile(activeTemporaryPath);
    } else {
      let temporaryTransaction = null;
      try {
        const temporaryBytes = readPrivateBytes(
          activeTemporaryPath,
          "Lease active WAL temporary file",
          { privateRoot: paths.controlRoot },
        );
        temporaryTransaction = parseLeaseTransactionBytes(
          temporaryBytes,
          paths,
          name,
        );
      } catch (error) {
        if (
          error instanceof AutomationControlError &&
          ["lease_transaction_invalid", "lease_transaction_missing"].includes(
            error.code,
          )
        ) {
          removeLeaseAtomicTemporaryFile(activeTemporaryPath);
        } else {
          throw error;
        }
      }
      if (temporaryTransaction !== null) {
        if (
          temporaryTransaction.operation !== operation ||
          temporaryTransaction.operationId !== operationId
        ) {
          throw new AutomationControlError(
            "lease_transaction_conflict",
            `Lease operation ${operationId} has a conflicting recoverable WAL temporary file.`,
          );
        }
        renameSync(activeTemporaryPath, activePath);
        syncDirectory(path.dirname(activePath));
      }
    }
  }
  const transaction = readLeaseTransactionFile(activePath, paths, name);
  if (
    transaction === null ||
    transaction.operation !== operation ||
    transaction.operationId !== operationId
  ) {
    return;
  }
  if (
    transaction.requestDigest !== requestDigest ||
    transaction.tokenDigest !== tokenDigest
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease operation ${operationId} was already used with a different ${operation} request.`,
    );
  }
}

function cleanupCompletedLeaseReceipt(
  paths,
  transaction,
  checkpoint = undefined,
  eventsGuard,
) {
  const cleanupPlan = buildLeaseCleanupPlan({
    paths,
    transaction,
    includeActive: true,
    requireActive: false,
    pruneReceipts: false,
  });
  executeLeaseCleanupPlan(paths, cleanupPlan, checkpoint, eventsGuard);
}

function verifyCompletedLeaseReceipt(
  paths,
  transaction,
  eventsGuard = undefined,
) {
  const verifyReceipt = (activeEventsGuard) => {
    requireActiveLeaseEventsGuard(activeEventsGuard);
    const matched = matchingLeaseEventUnlocked(paths, transaction);
    if (matched.event === null) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Completed lease receipt for ${transaction.name} does not match canonical state and audit history.`,
      );
    }
    return transaction;
  };
  if (eventsGuard !== undefined) {
    requireActiveLeaseEventsGuard(eventsGuard);
    return verifyReceipt(eventsGuard);
  }
  return withActiveLeaseEventsGuard(paths, verifyReceipt);
}

function prepareLeaseTransaction({
  paths,
  name,
  operation,
  operationId,
  requestDigest,
  tokenDigest,
  beforeState,
  afterRecord,
  afterDirectoryExists,
  event,
  capability,
  takeover,
  resultReceipt,
  nowMs,
  checkpoint = undefined,
  eventsGuard,
}) {
  requireActiveLeaseEventsGuard(eventsGuard);
  const files = leaseTransactionFiles(
    paths,
    name,
    operationId,
    operation,
  );
  ensureLeaseArchiveStorageDirectories(paths, checkpoint);
  const receipts = readValidatedLeaseTransactionReceipts(
    paths,
    name,
    operation,
  );
  let beforeBytes = beforeState.bytes;
  let afterBytes = afterRecord === null ? null : privateJsonBytes(afterRecord);
  let transaction = {
    schemaVersion: LEASE_TRANSACTION_SCHEMA_VERSION,
    kind: LEASE_TRANSACTION_KIND,
    operationId,
    operation,
    name,
    requestDigest,
    tokenDigest,
    preparedAt: nowIso(nowMs),
    completedAt: null,
    phase: "prepared",
    before: beforeState.descriptor,
    after: leaseStateDescriptor(afterDirectoryExists, afterBytes),
    staging: {
      beforePath: beforeState.bytes === null ? null : files.before,
      afterPath: afterBytes === null ? null : files.after,
    },
    capability,
    takeover,
    event,
    resultReceipt,
  };
  validateLeaseTransaction(transaction, paths, name);
  const retired = retiredPreparedLeaseTransactionMaterial(paths, transaction);
  if (retired !== null) {
    if (
      (beforeBytes === null) !== (retired.beforeBytes === null) ||
      (beforeBytes !== null && !beforeBytes.equals(retired.beforeBytes))
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease operation ${operationId} no longer matches its retired source state.`,
      );
    }
    transaction = retired.transaction;
    beforeBytes = retired.beforeBytes;
    afterBytes = retired.afterBytes;
  }
  reconcilePreWalLeaseTransactionArtifacts(
    paths,
    files,
    transaction,
    beforeBytes,
    afterBytes,
  );
  const transactionVariantBytes = [
    transaction,
    { ...transaction, phase: "state-committed" },
    { ...transaction, phase: "event-appended" },
    {
      ...transaction,
      phase: "complete",
      completedAt: nowIso(nowMs),
    },
  ].map((variant) => privateJsonBytes(variant).length);
  const staleReceipts = planLeaseReceiptPruning(
    receipts,
    path.basename(files.receipt),
  );
  const reservation = Object.freeze({
    entries:
      1 +
      Number(beforeBytes !== null) +
      Number(afterBytes !== null) +
      staleReceipts.length,
    bytes:
      (beforeBytes?.length ?? 0) +
      (afterBytes?.length ?? 0) +
      Math.max(...transactionVariantBytes) +
      staleReceipts.reduce((sum, receipt) => sum + receipt.bytes.length, 0),
    oldestMtimeMs: staleReceipts.reduce(
      (oldest, receipt) => Math.min(oldest, receipt.mtimeMs),
      nowMs,
    ),
  });
  requireLeaseCleanupArchiveCapacity(paths, reservation);
  if (beforeBytes !== null) {
    writePrivateBytesAtomic(files.before, beforeBytes, {
      operationId,
      checkpoint,
      kind: "before staging",
    });
  }
  if (afterBytes !== null) {
    writePrivateBytesAtomic(files.after, afterBytes, {
      operationId,
      checkpoint,
      kind: "after staging",
    });
  }
  writeLeaseTransactionFile(files.transaction, transaction, checkpoint);
  return { files, transaction, reservation };
}

function invokeLeaseTransactionCheckpoint(checkpoint, phase, details = undefined) {
  if (checkpoint === undefined) return;
  if (typeof checkpoint !== "function") {
    throw new AutomationControlError(
      "invalid_argument",
      "Lease transaction checkpoint must be a function.",
    );
  }
  const result = checkpoint(phase, details);
  if (result && typeof result.then === "function") {
    throw new AutomationControlError(
      "invalid_argument",
      "Lease transaction checkpoints must be synchronous.",
    );
  }
}

function executePreparedLeaseTransaction(
  paths,
  files,
  transaction,
  checkpoint,
  nowMs,
  {
    beforeCredentialCommit = () => {},
    beforeStateCommit = () => {},
    eventsGuard = undefined,
  } = {},
) {
  invokeLeaseTransactionCheckpoint(checkpoint, "lease-prepared");
  const execute = (activeEventsGuard) => {
    requireActiveLeaseEventsGuard(activeEventsGuard);
    validateLeaseStaging(paths, transaction);
    const current = readLeaseStateSnapshot(paths, transaction.name);
    if (!leaseStateMatches(current.descriptor, transaction.before)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${transaction.name} changed after transaction preparation.`,
      );
    }
    const matched = matchingLeaseEventUnlocked(paths, transaction);
    if (matched.event !== null) {
      throw new AutomationControlError(
        "control_event_conflict",
        `Lease transaction event ${transaction.event.eventId} already exists before state commit.`,
      );
    }
    prepareControlEventAppend(matched.snapshot.bytes, transaction.event);
    try {
      beforeCredentialCommit();
    } catch (error) {
      abortPreparedLeaseTransaction(
        paths,
        files,
        transaction,
        checkpoint,
        activeEventsGuard,
      );
      throw error;
    }
    consumeLeaseCredential(transaction.capability, checkpoint);
    invokeLeaseTransactionCheckpoint(checkpoint, "lease-credential-committed");
    try {
      beforeStateCommit();
    } catch (error) {
      abortPreparedLeaseTransaction(
        paths,
        files,
        transaction,
        checkpoint,
        activeEventsGuard,
      );
      throw error;
    }
    replaceLeaseStateFromTransaction(
      paths,
      transaction,
      "after",
      checkpoint,
    );
    transaction.phase = "state-committed";
    writeLeaseTransactionFile(files.transaction, transaction, checkpoint);
    invokeLeaseTransactionCheckpoint(checkpoint, "lease-state-committed");
    appendEventLineUnlocked(paths, transaction.event, matched.snapshot.bytes);
    transaction.phase = "event-appended";
    writeLeaseTransactionFile(files.transaction, transaction, checkpoint);
    invokeLeaseTransactionCheckpoint(checkpoint, "lease-event-appended");
    const completed = completeLeaseTransaction(
      paths,
      files,
      transaction,
      nowMs,
      checkpoint,
      activeEventsGuard,
    );
    invokeLeaseTransactionCheckpoint(checkpoint, "lease-complete");
    return completed;
  };
  if (eventsGuard !== undefined) {
    requireActiveLeaseEventsGuard(eventsGuard);
    return execute(eventsGuard);
  }
  return withActiveLeaseEventsGuard(paths, execute);
}

function leaseResultFromReceipt(transaction, token, recovered = false) {
  const result = structuredClone(transaction.resultReceipt);
  if (["acquire", "heartbeat"].includes(transaction.operation)) {
    result.lease = { ...result.lease, token };
  }
  if (recovered) result.recovered = true;
  return result;
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
  requireIdentifier(name, "lease name");
  return withFilesystemGuard(paths, `lease-${name}`, () => {
    recoverLeaseTransactionUnlocked(paths, name);
    const leasePath = leasePathFor(paths, name);
    if (!pathEntryExists(leasePath)) {
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
  });
}

function buildLeaseEvent(type, actor, name, data, nowMs, transactionId) {
  return {
    schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
    eventId: `lease:${transactionId}`,
    type,
    ts: nowIso(nowMs),
    actor,
    leaseName: name,
    data,
  };
}

export function acquireLease({
  stateRoot,
  name,
  owner,
  operationId,
  ttlMs,
  observerAuthority = undefined,
  providerAuthority = undefined,
  token,
  orphanGraceMs = ORPHAN_LEASE_GRACE_MS,
  ownerCapabilityFile = undefined,
  ownerConfirmationFile = undefined,
  ownerCapabilityTaskId = undefined,
  ownerCapabilityIntentDigest = undefined,
  actorCredentialToken = undefined,
  publisherCapabilityFile = undefined,
  scope = undefined,
  checkpoint = undefined,
}) {
  const paths = automationControlPaths(stateRoot);
  const normalizedOperationId = requireLeaseOperationId(operationId);
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
  requireCallerLeaseToken(token);
  requirePositiveInteger(orphanGraceMs, "orphanGraceMs");
  if (
    owner === "freed-pr-publisher" &&
    (actorCredentialToken !== undefined ||
      ownerCapabilityFile !== undefined ||
      ownerConfirmationFile !== undefined)
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
      ownerConfirmationFile !== undefined ||
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
  if (owner === "freed-owner") {
    const authorizationCount =
      Number(ownerCapabilityFile !== undefined) +
      Number(ownerConfirmationFile !== undefined);
    if (authorizationCount === 0) {
      throw new AutomationControlError(
        "owner_capability_required",
        "freed-owner requires a signed owner capability or current-task owner confirmation.",
      );
    }
    if (authorizationCount > 1) {
      throw new AutomationControlError(
        "owner_authorization_conflict",
        "freed-owner accepts only one signed capability or current-task confirmation per lease.",
      );
    }
  }
  const publisherScope =
    owner === "freed-pr-publisher" ? normalizePublisherScope(scope) : undefined;
  if (owner !== "freed-pr-publisher" && scope !== undefined) {
    throw new AutomationControlError(
      "publisher_scope_invalid",
      `Actor ${owner} cannot acquire a target-scoped lease.`,
    );
  }

  const requestDigest = canonicalLeaseRequestDigest({
    operation: "acquire",
    operationId: normalizedOperationId,
    name,
    owner,
    ttlMs,
    tokenDigest: secretDigest(token),
    observerAuthority: resolvedObserverAuthority,
    providerAuthority: resolvedProviderAuthority,
    ownerCapabilityFile: ownerCapabilityFile ?? null,
    ownerConfirmationFile: ownerConfirmationFile ?? null,
    ownerCapabilityTaskId: ownerCapabilityTaskId ?? null,
    ownerCapabilityIntentDigest: ownerCapabilityIntentDigest ?? null,
    publisherCapabilityFile: publisherCapabilityFile ?? null,
    scope: publisherScope ?? null,
  });

  return withLeaseMutationArchiveGuard(
    paths,
    name,
    (eventsGuard) => {
      requireCurrentLeaseOperationRecoveryMatch(
        paths,
        name,
        "acquire",
        normalizedOperationId,
        requestDigest,
        secretDigest(token),
      );
      ensurePrivateDirectory(paths.leases);
      recoverLeaseTransactionUnlocked(paths, name, Date.now(), eventsGuard);
      const completed = readCompletedLeaseReceipt(
        paths,
        name,
        "acquire",
        normalizedOperationId,
      );
      if (completed !== null) {
        if (
          completed.requestDigest !== requestDigest ||
          completed.tokenDigest !== secretDigest(token)
        ) {
          throw new AutomationControlError(
            "lease_transaction_conflict",
            `Lease operation ${normalizedOperationId} was already used with a different acquire request.`,
          );
        }
        verifyCompletedLeaseReceipt(paths, completed, eventsGuard);
        cleanupCompletedLeaseReceipt(
          paths,
          completed,
          checkpoint,
          eventsGuard,
        );
        return leaseResultFromReceipt(completed, token, true);
      }
      requireNoPrunedLeaseOperationEvent(
        paths,
        normalizedOperationId,
        eventsGuard,
      );
      const operationNowMs = Date.now();
      const leasePath = leasePathFor(paths, name);
      const ownerCapability =
        owner === "freed-owner" && ownerCapabilityFile !== undefined
          ? readAndValidateOwnerCapability({
              paths,
              capabilityFile: ownerCapabilityFile,
              taskId: ownerCapabilityTaskId,
              intentDigest: ownerCapabilityIntentDigest,
              leaseToken: token,
              ttlMs,
              nowMs: operationNowMs,
            })
          : null;
      const ownerConfirmation =
        owner === "freed-owner" && ownerConfirmationFile !== undefined
          ? readAndValidateOwnerConfirmation({
              confirmationFile: ownerConfirmationFile,
              taskId: ownerCapabilityTaskId,
              intentDigest: ownerCapabilityIntentDigest,
              ttlMs,
              nowMs: operationNowMs,
            })
          : null;
      const publisherCapability =
        owner === "freed-pr-publisher"
          ? readAndValidatePublisherCapability({
              paths,
              capabilityFile: publisherCapabilityFile,
              owner,
              name,
              operationId: normalizedOperationId,
              tokenSha256: secretDigest(token),
              ttlMs,
              scope: publisherScope,
              nowMs: operationNowMs,
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
      const beforeState = readLeaseStateSnapshot(paths, name);
      let previous = null;
      let takeover = false;
      let credentialUpgrade = false;

      if (beforeState.descriptor.directoryExists) {
        const existing = beforeState.record;
        if (!existing) {
          const ageMs = Math.max(
            0,
            operationNowMs - statSync(leasePath).mtimeMs,
          );
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
            if (existing.owner !== owner) {
              throw new AutomationControlError(
                "legacy_lease_owner_mismatch",
                `Legacy lease ${name} belongs to ${existing.owner}, not ${owner}.`,
                { name, owner: existing.owner, actor: owner },
              );
            }
            validateLegacyUncredentialedLeaseRecord(existing, name, policy);
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
            if (!isLeaseExpired(existing, operationNowMs)) {
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

        takeover = true;
      }
      const timestamp = nowIso(operationNowMs);
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
            : ownerConfirmation !== null
              ? "owner-confirmation"
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
        ...(ownerConfirmation === null
          ? {}
          : {
              ownerConfirmationId:
                ownerConfirmation.confirmation.confirmationId,
              ownerConfirmationTaskId: ownerConfirmation.confirmation.taskId,
              ownerConfirmationIntentDigest:
                ownerConfirmation.confirmation.intentDigest,
              ownerConfirmationDigest: ownerConfirmation.digest,
              ownerConfirmationReference:
                ownerConfirmation.confirmation.approvalSource.reference,
              ownerConfirmationApprovedBy:
                ownerConfirmation.confirmation.approvedBy,
              ownerConfirmationApprovalReference:
                ownerConfirmation.confirmation.ownerApprovalReference,
              ownerConfirmationApprovedAt:
                ownerConfirmation.confirmation.approvedAt,
              ownerConfirmationExpiresAt:
                ownerConfirmation.confirmation.expiresAt,
            }),
        ...(publisherCapability === null
          ? {}
          : { publisherCapabilityId: publisherCapability.capabilityId }),
        acquiredAt: timestamp,
        heartbeatAt: timestamp,
        expiresAt: nowIso(operationNowMs + ttlMs),
        ttlMs,
        ...(publisherScope === undefined ? {} : { scope: publisherScope }),
      };
      const leaseEventType = credentialUpgrade
        ? "lease_credential_upgraded"
        : takeover
          ? "lease_taken_over"
          : "lease_acquired";
      const eventData = {
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
        ...(ownerConfirmation === null
          ? {}
          : {
              ownerConfirmationId:
                ownerConfirmation.confirmation.confirmationId,
              ownerConfirmationTaskId: ownerConfirmation.confirmation.taskId,
              ownerConfirmationIntentDigest:
                ownerConfirmation.confirmation.intentDigest,
              ownerConfirmationDigest: ownerConfirmation.digest,
              ownerConfirmationReference:
                ownerConfirmation.confirmation.approvalSource.reference,
              ownerConfirmationApprovedBy:
                ownerConfirmation.confirmation.approvedBy,
              ownerConfirmationApprovalReference:
                ownerConfirmation.confirmation.ownerApprovalReference,
              ownerConfirmationApprovedAt:
                ownerConfirmation.confirmation.approvedAt,
              ownerConfirmationExpiresAt:
                ownerConfirmation.confirmation.expiresAt,
            }),
        ...(credentialUpgrade ? { credentialUpgrade: true } : {}),
        ...(previous === null ? {} : { previous }),
      };
      const event = buildLeaseEvent(
        leaseEventType,
        owner,
        name,
        eventData,
        operationNowMs,
        normalizedOperationId,
      );
      const admittedCredential =
        ownerCapability?.credentialSnapshot ??
        ownerConfirmation?.credentialSnapshot ??
        publisherCapability?.credentialSnapshot ??
        actorCredential?.credentialSnapshot;
      const admittedCredentialPath =
        ownerCapability?.capabilityFile ??
        ownerConfirmation?.confirmationFile ??
        publisherCapability?.capabilityFile ??
        actorCredential?.credentialPath;
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-credential-authorized",
        { sourcePath: admittedCredentialPath },
      );
      const capability =
        ownerCapability !== null
          ? credentialDescriptor({
              kind: "owner-capability",
              sourcePath: ownerCapability.capabilityFile,
              consumedPath: ownerCapability.consumedPath,
              snapshot: admittedCredential,
            })
          : ownerConfirmation !== null
            ? credentialDescriptor({
                kind: "owner-confirmation",
                sourcePath: ownerConfirmation.confirmationFile,
                snapshot: admittedCredential,
              })
            : publisherCapability !== null
              ? credentialDescriptor({
                  kind: "publisher-capability",
                  sourcePath: publisherCapability.capabilityFile,
                  consumedPath: publisherCapability.consumedPath,
                  snapshot: admittedCredential,
                })
              : credentialDescriptor({
                  kind: "actor-credential",
                  sourcePath: actorCredential.credentialPath,
                  snapshot: admittedCredential,
                });
      if (!credentialBytesMatch(capability.sourcePath, capability)) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          "Lease credential changed after authorization admission.",
        );
      }
      const resultReceipt = {
        acquired: true,
        takeover,
        credentialUpgrade,
        lease: publicLease(record),
        ...(previous === null ? {} : { previous }),
      };
      const credentialExpiresAtMs =
        ownerCapability !== null
          ? Date.parse(ownerCapability.payload.expiresAt)
          : ownerConfirmation !== null
            ? Date.parse(ownerConfirmation.confirmation.expiresAt)
            : publisherCapability !== null
              ? Date.parse(publisherCapability.payload.expiresAt)
              : null;
      const requireCommitAuthority = () => {
        const liveNowMs = Date.now();
        if (isLeaseExpired(record, liveNowMs)) {
          throw new AutomationControlError(
            "lease_expired",
            `Lease ${name} expired before acquisition committed.`,
            { name, expiresAt: record.expiresAt },
          );
        }
        if (
          credentialExpiresAtMs !== null &&
          credentialExpiresAtMs <= liveNowMs
        ) {
          throw new AutomationControlError(
            ownerCapability !== null
              ? "owner_capability_invalid"
              : ownerConfirmation !== null
                ? "owner_confirmation_invalid"
                : "publisher_capability_invalid",
            `Lease ${name} authorization expired before acquisition committed.`,
            { name },
          );
        }
      };
      requireLeaseOperationEventAvailable(paths, event, eventsGuard);
      const prepared = prepareLeaseTransaction({
        paths,
        name,
        operation: "acquire",
        operationId: normalizedOperationId,
        requestDigest,
        tokenDigest: secretDigest(token),
        beforeState,
        afterRecord: record,
        afterDirectoryExists: true,
        event,
        capability,
        takeover: previous,
        resultReceipt,
        nowMs: operationNowMs,
        checkpoint,
        eventsGuard,
      });
      const transaction = executePreparedLeaseTransaction(
        paths,
        prepared.files,
        prepared.transaction,
        checkpoint,
        operationNowMs,
        {
          beforeCredentialCommit: requireCommitAuthority,
          beforeStateCommit: requireCommitAuthority,
          eventsGuard,
        },
      );
      return leaseResultFromReceipt(transaction, token);
    },
  );
}

export function heartbeatLease({
  stateRoot,
  name,
  operationId,
  token,
  ttlMs = undefined,
  checkpoint = undefined,
}) {
  const paths = automationControlPaths(stateRoot);
  const normalizedOperationId = requireLeaseOperationId(operationId);
  requireIdentifier(name, "lease name");
  requireNonemptyString(token, "token");
  if (ttlMs !== undefined) {
    requirePositiveInteger(ttlMs, "ttlMs");
  }
  const requestDigest = canonicalLeaseRequestDigest({
    operation: "heartbeat",
    operationId: normalizedOperationId,
    name,
    tokenDigest: secretDigest(token),
    ttlMs: ttlMs ?? null,
  });

  return withLeaseMutationArchiveGuard(
    paths,
    name,
    (eventsGuard) => {
      requireCurrentLeaseOperationRecoveryMatch(
        paths,
        name,
        "heartbeat",
        normalizedOperationId,
        requestDigest,
        secretDigest(token),
      );
      recoverLeaseTransactionUnlocked(paths, name, Date.now(), eventsGuard);
      const completed = readCompletedLeaseReceipt(
        paths,
        name,
        "heartbeat",
        normalizedOperationId,
      );
      if (completed !== null) {
        if (
          completed.requestDigest !== requestDigest ||
          completed.tokenDigest !== secretDigest(token)
        ) {
          throw new AutomationControlError(
            "lease_transaction_conflict",
            `Lease operation ${normalizedOperationId} was already used with a different heartbeat request.`,
          );
        }
        verifyCompletedLeaseReceipt(paths, completed, eventsGuard);
        cleanupCompletedLeaseReceipt(
          paths,
          completed,
          checkpoint,
          eventsGuard,
        );
        return leaseResultFromReceipt(completed, token, true);
      }
      requireNoPrunedLeaseOperationEvent(
        paths,
        normalizedOperationId,
        eventsGuard,
      );
      const operationNowMs = Date.now();
      const beforeState = readLeaseStateSnapshot(paths, name);
      const record = beforeState.record;
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
      if (isLeaseExpired(record, operationNowMs)) {
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
      let nextExpiresAtMs = operationNowMs + nextTtlMs;
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
        if (
          !Number.isFinite(acquiredAtMs) ||
          absoluteExpiryMs <= operationNowMs
        ) {
          throw new AutomationControlError(
            record.owner === "freed-owner"
              ? "owner_lease_lifetime_exhausted"
              : "lease_lifetime_exhausted",
            `The ${record.owner} lease exhausted its absolute lifetime.`,
          );
        }
        nextExpiresAtMs = Math.min(nextExpiresAtMs, absoluteExpiryMs);
      }
      const nextRecord = structuredClone(record);
      nextRecord.heartbeatAt = nowIso(operationNowMs);
      nextRecord.expiresAt = nowIso(nextExpiresAtMs);
      nextRecord.ttlMs = nextTtlMs;
      const event = buildLeaseEvent(
        "lease_heartbeat",
        record.owner,
        name,
        { expiresAt: nextRecord.expiresAt },
        operationNowMs,
        normalizedOperationId,
      );
      const requireHeartbeatCommitAuthority = () => {
        const liveNowMs = Date.now();
        if (
          isLeaseExpired(record, liveNowMs) ||
          isLeaseExpired(nextRecord, liveNowMs)
        ) {
          throw new AutomationControlError(
            "lease_expired",
            `Lease ${name} expired before its heartbeat committed.`,
            { name, expiresAt: record.expiresAt },
          );
        }
      };
      requireLeaseOperationEventAvailable(paths, event, eventsGuard);
      const prepared = prepareLeaseTransaction({
        paths,
        name,
        operation: "heartbeat",
        operationId: normalizedOperationId,
        requestDigest,
        tokenDigest: secretDigest(token),
        beforeState,
        afterRecord: nextRecord,
        afterDirectoryExists: true,
        event,
        capability: null,
        takeover: null,
        resultReceipt: {
          heartbeated: true,
          lease: publicLease(nextRecord),
        },
        nowMs: operationNowMs,
        checkpoint,
        eventsGuard,
      });
      const transaction = executePreparedLeaseTransaction(
        paths,
        prepared.files,
        prepared.transaction,
        checkpoint,
        operationNowMs,
        {
          beforeStateCommit: requireHeartbeatCommitAuthority,
          eventsGuard,
        },
      );
      return leaseResultFromReceipt(transaction, token);
    },
  );
}

export function bindPublisherLeaseHead({
  stateRoot,
  name = "pr-publisher",
  operationId,
  token,
  scope,
  headSha,
  checkpoint = undefined,
}) {
  const paths = automationControlPaths(stateRoot);
  const normalizedOperationId = requireLeaseOperationId(operationId);
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
  const requestDigest = canonicalLeaseRequestDigest({
    operation: "bind-head",
    operationId: normalizedOperationId,
    name,
    tokenDigest: secretDigest(token),
    scope: expectedScope,
    headSha: normalizedHeadSha,
  });

  return withLeaseMutationArchiveGuard(
    paths,
    name,
    (eventsGuard) => {
      requireCurrentLeaseOperationRecoveryMatch(
        paths,
        name,
        "bind-head",
        normalizedOperationId,
        requestDigest,
        secretDigest(token),
      );
      recoverLeaseTransactionUnlocked(paths, name, Date.now(), eventsGuard);
      const completed = readCompletedLeaseReceipt(
        paths,
        name,
        "bind-head",
        normalizedOperationId,
      );
      if (completed !== null) {
        if (
          completed.requestDigest !== requestDigest ||
          completed.tokenDigest !== secretDigest(token)
        ) {
          throw new AutomationControlError(
            "lease_transaction_conflict",
            `Lease operation ${normalizedOperationId} was already used with a different head binding request.`,
          );
        }
        verifyCompletedLeaseReceipt(paths, completed, eventsGuard);
        cleanupCompletedLeaseReceipt(
          paths,
          completed,
          checkpoint,
          eventsGuard,
        );
        return leaseResultFromReceipt(completed, token, true);
      }
      requireNoPrunedLeaseOperationEvent(
        paths,
        normalizedOperationId,
        eventsGuard,
      );
      const operationNowMs = Date.now();
      const beforeState = readLeaseStateSnapshot(paths, name);
      const record = beforeState.record;
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
      if (isLeaseExpired(record, operationNowMs)) {
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
      const nextRecord = structuredClone(record);
      nextRecord.scope.headSha = normalizedHeadSha;
      const event = buildLeaseEvent(
        "lease_scope_bound",
        record.owner,
        name,
        { scope: nextRecord.scope },
        operationNowMs,
        normalizedOperationId,
      );
      const requireBindCommitAuthority = () => {
        if (isLeaseExpired(record, Date.now())) {
          throw new AutomationControlError(
            "lease_expired",
            `Lease ${name} expired before its head binding committed.`,
            { name, expiresAt: record.expiresAt },
          );
        }
      };
      requireLeaseOperationEventAvailable(paths, event, eventsGuard);
      const prepared = prepareLeaseTransaction({
        paths,
        name,
        operation: "bind-head",
        operationId: normalizedOperationId,
        requestDigest,
        tokenDigest: secretDigest(token),
        beforeState,
        afterRecord: nextRecord,
        afterDirectoryExists: true,
        event,
        capability: null,
        takeover: null,
        resultReceipt: { bound: true, lease: publicLease(nextRecord) },
        nowMs: operationNowMs,
        checkpoint,
        eventsGuard,
      });
      const transaction = executePreparedLeaseTransaction(
        paths,
        prepared.files,
        prepared.transaction,
        checkpoint,
        operationNowMs,
        {
          beforeStateCommit: requireBindCommitAuthority,
          eventsGuard,
        },
      );
      return leaseResultFromReceipt(transaction, token);
    },
  );
}

export function releaseLease({
  stateRoot,
  name,
  operationId,
  token,
  checkpoint = undefined,
}) {
  const paths = automationControlPaths(stateRoot);
  const normalizedOperationId = requireLeaseOperationId(operationId);
  requireIdentifier(name, "lease name");
  requireNonemptyString(token, "token");
  const requestDigest = canonicalLeaseRequestDigest({
    operation: "release",
    operationId: normalizedOperationId,
    name,
    tokenDigest: secretDigest(token),
  });

  return withLeaseMutationArchiveGuard(
    paths,
    name,
    (eventsGuard) => {
      requireCurrentLeaseOperationRecoveryMatch(
        paths,
        name,
        "release",
        normalizedOperationId,
        requestDigest,
        secretDigest(token),
      );
      recoverLeaseTransactionUnlocked(paths, name, Date.now(), eventsGuard);
      const completed = readCompletedLeaseReceipt(
        paths,
        name,
        "release",
        normalizedOperationId,
      );
      if (completed !== null) {
        if (
          completed.requestDigest !== requestDigest ||
          completed.tokenDigest !== secretDigest(token)
        ) {
          throw new AutomationControlError(
            "lease_transaction_conflict",
            `Lease operation ${normalizedOperationId} was already used with a different release request.`,
          );
        }
        verifyCompletedLeaseReceipt(paths, completed, eventsGuard);
        cleanupCompletedLeaseReceipt(
          paths,
          completed,
          checkpoint,
          eventsGuard,
        );
        return leaseResultFromReceipt(completed, token, true);
      }
      requireNoPrunedLeaseOperationEvent(
        paths,
        normalizedOperationId,
        eventsGuard,
      );
      const beforeState = readLeaseStateSnapshot(paths, name);
      const record = beforeState.record;
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

      const operationNowMs = Date.now();

      const event = buildLeaseEvent(
        "lease_released",
        record.owner,
        name,
        { expired: isLeaseExpired(record, operationNowMs) },
        operationNowMs,
        normalizedOperationId,
      );
      requireLeaseOperationEventAvailable(paths, event, eventsGuard);
      const prepared = prepareLeaseTransaction({
        paths,
        name,
        operation: "release",
        operationId: normalizedOperationId,
        requestDigest,
        tokenDigest: secretDigest(token),
        beforeState,
        afterRecord: null,
        afterDirectoryExists: false,
        event,
        capability: null,
        takeover: null,
        resultReceipt: {
          released: true,
          lease: publicLease(record),
        },
        nowMs: operationNowMs,
        checkpoint,
        eventsGuard,
      });
      const transaction = executePreparedLeaseTransaction(
        paths,
        prepared.files,
        prepared.transaction,
        checkpoint,
        operationNowMs,
        { eventsGuard },
      );
      return leaseResultFromReceipt(transaction, token);
    },
  );
}
