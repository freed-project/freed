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
  writeSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

import {
  AUTOMATION_KERNEL_GUARD_NAMES,
  automationKernelGuardCutoverPaths,
  automationKernelGuardMarkerBytes,
  inspectAutomationKernelGuardCutover,
} from "./automation-kernel-guard-contract.mjs";
import {
  OUTCOME_LEDGER_REPAIR_ACTION,
  OUTCOME_LEDGER_REPAIR_ARTIFACT_KEYS,
  OUTCOME_LEDGER_REPAIR_DECISION_FORMAT,
  OUTCOME_LEDGER_REPAIR_DECISION_REASON_DESCRIPTIONS,
  OUTCOME_LEDGER_REPAIR_EVENT_PLAN_KEYS,
  OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_GENERATION_KEYS,
  OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_PARENT_KEYS,
  OUTCOME_LEDGER_REPAIR_EVENT_TYPE,
  OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  OUTCOME_LEDGER_REPAIR_MAX_LINES,
  OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS,
  OUTCOME_LEDGER_REPAIR_PHASES,
  OUTCOME_LEDGER_REPAIR_POLICY,
  OUTCOME_LEDGER_REPAIR_RECEIPT_KEYS,
  OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
  OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS,
  orderedOutcomeLedgerRepairEventPlan,
  orderedOutcomeLedgerRepairParameters,
  outcomeLedgerRepairEventId,
  outcomeLedgerRepairOperationSeed,
} from "./outcome-ledger-repair-contract.mjs";
import {
  ACTOR_LAUNCHER_ATTESTATION_PROTOCOL,
  ACTOR_LAUNCHER_CHANNEL_PROTOCOL,
  ACTOR_LAUNCHER_HANDOFF,
  readInstalledActorBinding,
} from "./automation-actor-readiness.mjs";

export const AUTOMATION_CONTROL_SCHEMA_VERSION = 1;
export const PUBLISH_SCOPE_SCHEMA_VERSION = 2;
export const PUBLISHER_CAPABILITY_SCHEMA_VERSION = 1;
export const OWNER_CAPABILITY_SCHEMA_VERSION = 1;
const OWNER_CONFIRMATION_SCHEMA_VERSION = 1;
const OUTCOME_LEDGER_SCHEMA_VERSION = 3;
export const CONTROL_EVENT_HISTORY_MAX_BYTES = 128 * 1024 * 1024;
export const CONTROL_EVENT_MAX_LINE_BYTES = 1024 * 1024;
export const CONTROL_EVENT_HISTORY_MAX_RECORDS = 100_000;
const TASK_CONTROL_FILE_MAX_BYTES = 16 * 1024 * 1024;
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
export const AUTOMATION_OUTCOME_STATES = Object.freeze([
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
const OUTCOME_TASK_STATES = new Set(AUTOMATION_OUTCOME_STATES);
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
const LEASE_TRANSACTION_SCHEMA_VERSION = 2;
const LEASE_TRANSACTION_KIND = "lease-transaction";
const LEASE_TRANSACTION_MAX_BYTES = 1024 * 1024;
const LEASE_TRANSACTION_RECEIPT_RETENTION = 8;
const LEASE_TRANSACTION_DIRECTORY_MAX_ENTRIES = 64;
const LEASE_TRANSACTION_RECEIPT_DIRECTORY_MAX_ENTRIES = 256;
const LEASE_DIRECTORY_ENTRY_MAX_BYTES = 1_024;
const LEASE_BOUNDED_DIRECTORY_MAX_BYTES = 16 * 1_024 * 1_024;
const LEASE_ARCHIVE_MAX_ENTRIES = 100_000;
const LEASE_ARCHIVE_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const LEASE_ARCHIVE_MAX_AGE_MS = 366 * 24 * 60 * 60 * 1_000;
const LEASE_ARCHIVE_MIN_FREE_BYTES = 1024 * 1024 * 1024;
const LEASE_ARCHIVE_MOVE_PROTOCOL = "freed-lease-archive-move-v1";
const AUTHORITY_FILE_OPERATION_PROTOCOL = "freed-authority-file-operation-v1";
const AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES = 100_000;
const AUTHORITY_RETIREMENT_DIRECTORY = ".authority-retirements";
const AUTHORITY_RETIREMENT_MAX_ENTRIES = 100_000;
const AUTHORITY_RETIREMENT_INVENTORY_MAX_RECEIPT_BYTES = 128 * 1024 * 1024;
const LEASE_ARCHIVE_MOVE_PYTHON = "/usr/bin/python3";
const LEASE_ARCHIVE_MOVE_HELPER = fileURLToPath(
  new URL("./lease-archive-move.py", import.meta.url),
);
const LEASE_ARCHIVE_MOVE_HELPER_SHA256 =
  "d23a65379acad43c7fb601d65fc150c29f1d214796121362f2a44c7e6c305a3e";
const LEASE_ARCHIVE_HELPER_MAX_BYTES = 256 * 1024;
const LEASE_ARCHIVE_MOVE_PYTHON_BOOTSTRAP = [
  "import hashlib,sys",
  "_source_size=int(sys.argv.pop(1))",
  "_source_digest=sys.argv.pop(1)",
  "_source=sys.stdin.buffer.read(_source_size)",
  "if len(_source)!=_source_size or hashlib.sha256(_source).hexdigest()!=_source_digest: raise SystemExit('lease archive helper source frame is invalid')",
  "exec(compile(_source,'<freed-lease-archive-move>','exec'),{'__name__':'__main__'})",
].join("\n");
const LEASE_ARCHIVE_LIST_MAX_ENTRY_BYTES =
  64 + 1 + 64 + Buffer.byteLength(".json");
const LEASE_ARCHIVE_LIST_MAX_BUFFER =
  LEASE_ARCHIVE_MAX_ENTRIES * (LEASE_ARCHIVE_LIST_MAX_ENTRY_BYTES + 1);
const LEASE_PRIVATE_BATCH_MAX_BUFFER = 128 * 1024 * 1024;
const LEASE_PRIVATE_BATCH_MAX_REQUEST_BYTES = 1024 * 1024;
const LEASE_PRIVATE_BATCH_MAX_SELECTED_ENTRIES = 4_096;
const LEASE_PRIVATE_BATCH_MAX_SELECTED_BYTES = 32 * 1024 * 1024;
const LEASE_PRIVATE_BATCH_DEFAULT_LIMITS = Object.freeze({
  maxEntries: LEASE_ARCHIVE_MAX_ENTRIES,
  maxSelectedEntries: LEASE_PRIVATE_BATCH_MAX_SELECTED_ENTRIES,
  maxEncodedNameBytes: 32 * 1024 * 1024,
  maxRequestBytes: LEASE_PRIVATE_BATCH_MAX_REQUEST_BYTES,
  maxBufferBytes: LEASE_PRIVATE_BATCH_MAX_BUFFER,
  maxFileBytes: LEASE_TRANSACTION_MAX_BYTES,
  maxTotalBytes: LEASE_ARCHIVE_MAX_BYTES,
  maxSelectedBytes: LEASE_PRIVATE_BATCH_MAX_SELECTED_BYTES,
});
const OUTCOME_REPAIR_TRANSACTION_BATCH_LIMITS = Object.freeze({
  maxEntries: 4_096,
  maxSelectedEntries: 4_096,
  maxEncodedNameBytes: 16 * 1024 * 1024,
  maxRequestBytes: LEASE_PRIVATE_BATCH_MAX_REQUEST_BYTES,
  maxBufferBytes: LEASE_PRIVATE_BATCH_MAX_BUFFER,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: LEASE_ARCHIVE_MAX_BYTES,
  maxSelectedBytes: LEASE_PRIVATE_BATCH_MAX_SELECTED_BYTES,
  maxChunkSelectedBytes: LEASE_PRIVATE_BATCH_MAX_SELECTED_BYTES,
});
const OUTCOME_REPAIR_TREE_BATCH_LIMITS = Object.freeze({
  maxEntries: 4_096,
  maxSelectedEntries: 4_096,
  maxEncodedNameBytes: 16 * 1024 * 1024,
  maxRequestBytes: LEASE_PRIVATE_BATCH_MAX_REQUEST_BYTES,
  maxBufferBytes: LEASE_PRIVATE_BATCH_MAX_BUFFER,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxSelectedBytes: LEASE_PRIVATE_BATCH_MAX_SELECTED_BYTES,
  maxChunkSelectedBytes: LEASE_PRIVATE_BATCH_MAX_SELECTED_BYTES,
});
const OUTCOME_REPAIR_TRANSACTION_MAX_SELECTED_BYTES = 128 * 1024 * 1024;
const AUTOMATION_PLANNING_READ_BUNDLES = new WeakSet();
const ACTIVE_AUTOMATION_PLANNING_READ_BUNDLES = new WeakSet();
const AUTOMATION_PLANNING_READ_ADMISSION_OWNERS = new WeakMap();
const AUTOMATION_PLANNING_READ_ADMISSION_STATES = new WeakMap();
const AUTOMATION_PLANNING_READ_BUNDLE_STATES = new WeakMap();
const ACTIVE_AUTOMATION_PLANNING_READ_ROOTS = new Set();
const ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS = new WeakSet();
const ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS_BY_ROOT = new Map();
const OUTCOME_WRITER_AUTHORITY_SNAPSHOT_CACHES = new WeakMap();
const OUTCOME_WRITER_LEASE_HISTORY_CACHES = new WeakMap();
const OUTCOME_WRITER_DIRECTORY_CHILD_PROOF_CACHES = new WeakMap();
const OUTCOME_WRITER_DIRECTORY_NAME_CACHES = new WeakMap();
const AUTOMATION_PLANNING_READ_INTERNAL = Symbol(
  "automation-planning-read-internal",
);
const OUTCOME_REPAIR_TRANSACTION_NAME_PATTERN = /^[0-9a-f]{64}\.json$/;
const OUTCOME_REPAIR_ACTIVE_TRANSACTION_NAME = "pending.json";
const OUTCOME_REPAIR_TRANSACTION_TEMP_NAME_PATTERN =
  /^\.(?:[0-9a-f]{64}|pending)\.json\.(?:\d+|[0-9a-f]{64})\.tmp(?:\.quarantine\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*$/;
const privateAuthorityDecoder = new TextDecoder("utf-8", { fatal: true });
let leaseArchiveHelperInvocationCountForTest = 0;
let pendingLeaseTransactionInspectionCountForTest = 0;
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
  "lease_acquired",
  "lease_credential_upgraded",
  "lease_heartbeat",
  "lease_released",
  "lease_scope_binding_confirmed",
  "lease_scope_bound",
  "lease_taken_over",
  "outcome_recorded",
  "outcome_reservation_created",
  "outcome_reservation_finalized",
  "task_authority_updated",
  "task_created",
  "task_transitioned",
]);
const RESERVED_CONTROL_EVENT_ID_PREFIXES = Object.freeze([
  "lease:",
  "outcome-history-repaired:",
  "outcome-recorded:",
  "task-outcome-reserved:",
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
const LEGACY_GENERAL_ACTOR_LEASE_MAX_TTL_MS = 60 * 60 * 1_000;

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

export function automationActorCanRecordOutcome(actor, outcome) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  return (
    OUTCOME_TASK_STATES.has(outcome) &&
    policy?.canAppendEvent === true &&
    policy.destinations.includes(outcome)
  );
}

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

const PROVIDER_APPROVAL_GATED_TASK_STATES = new Set([
  "implemented",
  "validated",
  "merged",
  "installed",
  "soaking",
]);

function taskObserverAuthorityAllowsTransition(observerAuthority, toState) {
  const requiredAuthority = TRANSITION_AUTHORITY_REQUIREMENTS[toState];
  const actualRank = TASK_AUTHORITY_RANK[observerAuthority];
  const requiredRank = TASK_AUTHORITY_RANK[requiredAuthority];
  return (
    Number.isInteger(actualRank) &&
    Number.isInteger(requiredRank) &&
    actualRank >= requiredRank
  );
}

function taskProviderAuthorityAllowsTransition(providerAuthority, toState) {
  return !(
    providerAuthority === "approval-required" &&
    PROVIDER_APPROVAL_GATED_TASK_STATES.has(toState)
  );
}

const LEGACY_OBSERVER_AUTHORITY_ALIASES = Object.freeze({
  release: "merge-safe",
});

const INTERNAL_GUARD_TIMEOUT_MS = 5_000;
const INTERNAL_GUARD_POLL_MS = 10;
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
const TRUSTED_LAUNCHER_CHANNEL_TIMEOUT_MS = 15_000;
const MAX_TRUSTED_LAUNCHER_ATTESTATION_BYTES = 16 * 1_024;
const TRUSTED_LAUNCHER_AUTHORIZATION = Symbol("trusted-launcher-authorization");
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

  return orderedOutcomeLedgerRepairParameters(parameters);
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
  { taskId, intentDigest, eventTimestamp },
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
  const eventTimestampMs = Date.parse(String(eventTimestamp ?? ""));
  if (
    authorization.leaseName !== "owner-governance" ||
    expectedKeys.length === 0 ||
    JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys) ||
    !Number.isFinite(acquiredAtMs) ||
    !Number.isFinite(eventTimestampMs) ||
    acquiredAtMs > eventTimestampMs ||
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
      !IDENTIFIER_PATTERN.test(authorization.ownerCapabilityId) ||
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
    const approvedAtMs = Date.parse(
      String(authorization.ownerConfirmationApprovedAt ?? ""),
    );
    const expiresAtMs = Date.parse(
      String(authorization.ownerConfirmationExpiresAt ?? ""),
    );
    if (
      ["ownerConfirmationId", "ownerConfirmationDigest"].some(
        (field) =>
          typeof authorization[field] !== "string" ||
          authorization[field].length === 0,
      ) ||
      !IDENTIFIER_PATTERN.test(authorization.ownerConfirmationId) ||
      typeof authorization.ownerConfirmationReference !== "string" ||
      authorization.ownerConfirmationReference.trim() === "" ||
      authorization.ownerConfirmationReference !==
        authorization.ownerConfirmationReference.trim() ||
      typeof authorization.ownerConfirmationApprovalReference !== "string" ||
      authorization.ownerConfirmationApprovalReference.trim() === "" ||
      authorization.ownerConfirmationApprovalReference !==
        authorization.ownerConfirmationApprovalReference.trim() ||
      authorization.ownerConfirmationTaskId !== taskId ||
      authorization.ownerConfirmationIntentDigest !== intentDigest ||
      authorization.ownerConfirmationApprovedBy !== "AubreyF" ||
      !/^[0-9a-f]{64}$/.test(authorization.ownerConfirmationDigest) ||
      !Number.isFinite(approvedAtMs) ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= approvedAtMs ||
      expiresAtMs <= acquiredAtMs ||
      expiresAtMs - approvedAtMs > OWNER_CONFIRMATION_MAX_LIFETIME_MS ||
      approvedAtMs > acquiredAtMs + OWNER_CONFIRMATION_CLOCK_SKEW_MS ||
      expiresAtMs <= eventTimestampMs ||
      timestampFields.some((field) => {
        const value = authorization[field];
        const parsed = Date.parse(String(value ?? ""));
        return (
          !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value
        );
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

function validateOutcomeLedgerRepairLeaseHistoryIndexed(
  event,
  authorization,
  {
    records,
    recordsByEventId,
    acquisitionRecordsByKey,
    leaseTimelinesByAcquisitionIndex,
  },
  recordIndex = undefined,
) {
  const historicalMatches =
    typeof event?.eventId === "string"
      ? (recordsByEventId.get(event.eventId) ?? [])
      : [];
  const exactHistoricalMatches = historicalMatches.filter((record) =>
    canonicalValuesEqual(record.entry, event),
  );
  const auditPosition =
    recordIndex ??
    (historicalMatches.length === 0
      ? records.length
      : exactHistoricalMatches.length === 1
        ? exactHistoricalMatches[0].index
        : -1);
  if (
    auditPosition < 0 ||
    !canonicalLeaseAuthorityAtEvent(authorization, {
      actor: "freed-owner",
      eventTimestamp: event.ts,
      recordIndex: auditPosition,
      records,
      recordsByEventId,
      acquisitionRecordsByKey,
      leaseTimelinesByAcquisitionIndex,
    })
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_event_invalid",
      "Outcome ledger repair authorization does not match one exact active owner lease timeline.",
    );
  }
}

function validateOutcomeLedgerRepairEventWithHistoryIndex(
  event,
  {
    stateRoot,
    taskId,
    parameters,
    intentDigest,
    historyIndex,
    recordIndex = undefined,
  },
) {
  if (
    !historyIndex ||
    !Array.isArray(historyIndex.records) ||
    !(historyIndex.recordsByEventId instanceof Map) ||
    !(historyIndex.acquisitionRecordsByKey instanceof Map) ||
    !(historyIndex.leaseTimelinesByAcquisitionIndex instanceof Map)
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_event_invalid",
      "Outcome ledger repair validation requires the complete physical event history.",
    );
  }
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
        [
          "actor",
          "data",
          "eventId",
          "schemaVersion",
          "taskId",
          "ts",
          "type",
        ].sort(),
      ) ||
    event.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    event.eventId !==
      outcomeLedgerRepairEventId(normalizedParameters.operationId) ||
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
  const authorization = normalizeOutcomeLedgerRepairAuthorization(
    event.data.authorization,
    {
      taskId,
      intentDigest,
      eventTimestamp: event.ts,
    },
  );
  validateOutcomeLedgerRepairLeaseHistoryIndexed(
    event,
    authorization,
    historyIndex,
    recordIndex,
  );
  return structuredClone(event);
}

export function validateOutcomeLedgerRepairEvent(
  event,
  { stateRoot, taskId, parameters, intentDigest, eventHistory },
) {
  if (!Array.isArray(eventHistory)) {
    throw new AutomationControlError(
      "outcome_ledger_repair_event_invalid",
      "Outcome ledger repair validation requires the complete physical event history.",
    );
  }
  return validateOutcomeLedgerRepairEventWithHistoryIndex(event, {
    stateRoot,
    taskId,
    parameters,
    intentDigest,
    historyIndex: indexControlEventHistory(eventHistory),
  });
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

function isGeneralAutomationActor(actor) {
  return actor !== "freed-owner" && actor !== "freed-pr-publisher";
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

export function writeJsonAtomic(
  filePath,
  value,
  {
    expectedSnapshot = undefined,
    operationId = undefined,
    privateRoot = path.dirname(filePath),
    label = "Private JSON authority file",
    validateStageSuccessor = null,
    buildStagePendingPlans = () => [],
  } = {},
) {
  requireOutsideAutomationPlanningReadCallback("Atomic JSON publication");
  const directoryPath = path.dirname(filePath);
  if (expectedSnapshot === undefined) {
    ensurePrivateDirectory(directoryPath);
  }
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const bytes = Buffer.from(data, "utf8");
  const admitted =
    expectedSnapshot ??
    readAutomationAuthorityFileSnapshot(path.resolve(filePath), {
      allowMissing: true,
      allowEmpty: true,
      privateRoot: path.resolve(privateRoot),
      maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
      allowedModes: [0o600],
      label,
    });
  return writeAutomationAuthorityFile({
    filePath: path.resolve(filePath),
    bytes,
    previousSnapshot: admitted,
    operationId: operationId ?? `json:${digestBytes(bytes)}`,
    privateRoot: path.resolve(privateRoot),
    maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
    allowedModes: [0o600],
    label,
    validateStageSuccessor,
    buildStagePendingPlans,
  });
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
  if (offset !== stats.size || !bytes.equals(kernelGuardMarkerBytes)) {
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
  requireOutsideAutomationPlanningReadCallback(
    "Kernel-backed automation guard acquisition",
  );
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
    requireKernelGuardMarker(descriptor, label);
    const terminalLocked = fstatSync(descriptor);
    const terminalCurrent = lstatSync(filePath);
    if (
      !terminalLocked.isFile() ||
      terminalLocked.nlink !== 1 ||
      (terminalLocked.mode & 0o7777) !== 0o600 ||
      terminalCurrent.isSymbolicLink() ||
      terminalCurrent.nlink !== 1 ||
      terminalCurrent.dev !== terminalLocked.dev ||
      terminalCurrent.ino !== terminalLocked.ino ||
      realpathSync(filePath) !== filePath
    ) {
      throw new AutomationControlError(
        "invalid_state",
        `Automation guard changed before release: ${filePath}`,
      );
    }
    return result;
  } finally {
    closeSync(descriptor);
  }
}

function requireOutsideAutomationPlanningReadCallback(operation) {
  if (ACTIVE_AUTOMATION_PLANNING_READ_ROOTS.size > 0) {
    throw new AutomationControlError(
      "invalid_state",
      `${operation} cannot run while an automation planning read callback is active.`,
    );
  }
}

function requireOutsideAutomationPlanningReadScope(stateRoot, operation) {
  const normalizedStateRoot = path.resolve(stateRoot);
  requireOutsideAutomationPlanningReadCallback(
    `${operation} for ${normalizedStateRoot}`,
  );
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
  requireOutsideAutomationPlanningReadScope(
    paths.stateRoot,
    "Outcome ledger writer guard",
  );
  const canonicalLedgerPath = path.resolve(paths.outcomes);
  if (path.resolve(ledgerPath) !== canonicalLedgerPath) {
    throw new AutomationControlError(
      "invalid_argument",
      `Outcome ledger writer guard requires ${canonicalLedgerPath}.`,
    );
  }
  const cutover = requireAutomationKernelGuardCutover(paths);
  return withKernelFileGuard(
    cutover.paths.writerLock,
    () => {
      const lockedCutover = requireAutomationKernelGuardCutover(paths);
      if (lockedCutover.paths.writerLock !== cutover.paths.writerLock) {
        throw new AutomationControlError(
          "invalid_state",
          "Outcome ledger writer guard changed during acquisition.",
        );
      }
      let active = true;
      const context = Object.freeze({
        stateRoot: paths.stateRoot,
        ledgerPath: canonicalLedgerPath,
        requireActive: () => {
          if (!active || !ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS.has(context)) {
            throw new AutomationControlError(
              "invalid_state",
              "Outcome ledger writer context is no longer active.",
            );
          }
        },
      });
      if (ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS_BY_ROOT.has(paths.stateRoot)) {
        throw new AutomationControlError(
          "invalid_state",
          "Outcome ledger writer context is already active for this state root.",
        );
      }
      ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS.add(context);
      ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS_BY_ROOT.set(
        paths.stateRoot,
        context,
      );
      OUTCOME_WRITER_AUTHORITY_SNAPSHOT_CACHES.set(context, new Map());
      OUTCOME_WRITER_LEASE_HISTORY_CACHES.set(context, null);
      OUTCOME_WRITER_DIRECTORY_CHILD_PROOF_CACHES.set(context, new Set());
      OUTCOME_WRITER_DIRECTORY_NAME_CACHES.set(context, new Map());
      try {
        return operation(context);
      } finally {
        active = false;
        OUTCOME_WRITER_AUTHORITY_SNAPSHOT_CACHES.delete(context);
        OUTCOME_WRITER_LEASE_HISTORY_CACHES.delete(context);
        OUTCOME_WRITER_DIRECTORY_CHILD_PROOF_CACHES.delete(context);
        OUTCOME_WRITER_DIRECTORY_NAME_CACHES.delete(context);
        ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS_BY_ROOT.delete(paths.stateRoot);
        ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS.delete(context);
      }
    },
    {
      label: "outcome ledger writer",
      timeoutMs,
      wait,
      monotonicNow: () => performance.now(),
    },
  );
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
  requireOutsideAutomationPlanningReadScope(
    paths.stateRoot,
    `Automation ${name} guard`,
  );
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
  return withKernelFileGuard(
    guardPath,
    () => {
      const lockedCutover = requireAutomationKernelGuardCutover(paths);
      if (lockedCutover.paths.guards[name]?.inner !== guardPath) {
        throw new AutomationControlError(
          "invalid_state",
          `Automation guard ${name} changed during acquisition.`,
        );
      }
      return callback();
    },
    {
      label: name,
      timeoutMs,
      wait: waitSync,
      monotonicNow: () => performance.now(),
    },
  );
}

const ACTIVE_AUTOMATION_EVENTS_GUARDS = new WeakSet();
const ACTIVE_AUTOMATION_EVENTS_GUARDS_BY_ROOT = new Map();
const AUTOMATION_EVENTS_GUARD_STAGE_ADMISSIONS = new WeakMap();
const OUTCOME_REPAIR_OWNER_LEASE_BYPASSES = new WeakMap();

function requireActiveAutomationEventsGuard(token) {
  if (
    token === null ||
    typeof token !== "object" ||
    !ACTIVE_AUTOMATION_EVENTS_GUARDS.has(token)
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Automation mutation requires its active events guard scope.",
    );
  }
  return token;
}

function requireActiveLeaseEventsGuard(token) {
  return requireActiveAutomationEventsGuard(token);
}

function withActiveAutomationEventsGuard(
  paths,
  callback,
  {
    outcomeRepairBypass = null,
    authorizeOutcomeRepairBypass = null,
    enforceOutcomeRepairFence = false,
    now = undefined,
  } = {},
) {
  return withFilesystemGuard(
    paths,
    "events",
    () => {
      const token = Object.freeze({
        stateRoot: paths.stateRoot,
        outcomeRepairBypass,
      });
      if (ACTIVE_AUTOMATION_EVENTS_GUARDS_BY_ROOT.has(paths.stateRoot)) {
        throw new AutomationControlError(
          "invalid_state",
          "Automation events guard scope is already active for this state root.",
        );
      }
      ACTIVE_AUTOMATION_EVENTS_GUARDS.add(token);
      ACTIVE_AUTOMATION_EVENTS_GUARDS_BY_ROOT.set(paths.stateRoot, token);
      try {
        if (authorizeOutcomeRepairBypass !== null) {
          if (typeof authorizeOutcomeRepairBypass !== "function") {
            throw new AutomationControlError(
              "invalid_argument",
              "Automation events bypass authorization must be synchronous.",
            );
          }
          let ownerLeaseBypass = authorizeOutcomeRepairBypass(token);
          if (ownerLeaseBypass !== null) {
            ownerLeaseBypass =
              commitUncommittedPreparedToReplacedTransitionUnderFence(
                paths,
                ownerLeaseBypass,
              );
            OUTCOME_REPAIR_OWNER_LEASE_BYPASSES.set(
              token,
              Object.freeze(ownerLeaseBypass),
            );
            completeOutcomeLedgerRepairEventBeforeOwnerLeaseLifecycle(
              paths,
              token,
              ownerLeaseBypass,
            );
          }
        }
        if (enforceOutcomeRepairFence) {
          requireOutcomeLedgerRepairFenceAllowsMutation(paths, token);
        }
        const result = callback(token);
        if (result && typeof result.then === "function") {
          throw new AutomationControlError(
            "invalid_argument",
            "Lease mutation archive guards require synchronous work.",
          );
        }
        return result;
      } finally {
        AUTOMATION_EVENTS_GUARD_STAGE_ADMISSIONS.delete(token);
        ACTIVE_AUTOMATION_EVENTS_GUARDS_BY_ROOT.delete(paths.stateRoot);
        OUTCOME_REPAIR_OWNER_LEASE_BYPASSES.delete(token);
        ACTIVE_AUTOMATION_EVENTS_GUARDS.delete(token);
      }
    },
    now === undefined ? {} : { now },
  );
}

function withActiveLeaseEventsGuard(paths, callback, options = {}) {
  return withActiveAutomationEventsGuard(paths, callback, options);
}

function withLeaseMutationArchiveGuard(
  paths,
  name,
  operation,
  callback,
  options = {},
) {
  return withFilesystemGuard(
    paths,
    `lease-${name}`,
    () =>
      withActiveLeaseEventsGuard(
        paths,
        (eventsGuard) => {
          const expectedPendingEvents =
            readExpectedLeaseStageEventsForOperation(
              paths,
              name,
              operation,
              eventsGuard,
            );
          admitControlEventAuthorityStage(paths, {
            expectedPendingEvents,
          });
          requireCurrentLeaseOperationRecoveryMatch(
            paths,
            name,
            operation.leaseOperation,
            operation.operationId,
            operation.request,
            operation.requestDigest,
            operation.tokenDigest,
            eventsGuard,
          );
          return callback(eventsGuard);
        },
        {
          enforceOutcomeRepairFence: true,
          authorizeOutcomeRepairBypass: (eventsGuard) =>
            authorizeOwnerLeaseLifecycleOutcomeRepairBypass(
              paths,
              eventsGuard,
              operation,
            ),
        },
      ),
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

function readTaskControlJsonFile(
  paths,
  filePath,
  label,
  { allowMissing = false } = {},
) {
  const value = readTaskControlJsonSnapshot(paths, filePath, label, {
    allowMissing,
  });
  return value === null ? null : value.value;
}

function readTaskControlJsonSnapshot(
  paths,
  filePath,
  label,
  { allowMissing = false } = {},
) {
  const snapshot = readAutomationAuthorityFileSnapshot(filePath, {
    allowMissing,
    allowEmpty: false,
    privateRoot: paths.controlRoot,
    maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
    allowedModes: [0o600],
    label,
    missingCode: "invalid_state",
    invalidCode: "invalid_state",
  });
  if (snapshot.missing) return null;
  try {
    return Object.freeze({
      value: JSON.parse(privateAuthorityDecoder.decode(snapshot.bytes)),
      snapshot,
    });
  } catch {
    throw new AutomationControlError(
      "invalid_state",
      `${label} is unsafe or contains invalid JSON.`,
    );
  }
}

function readTaskManifestSnapshotUnchecked({
  stateRoot,
  nowMs = Date.now(),
  internalCapability = undefined,
} = {}) {
  const paths = automationControlPaths(stateRoot);
  const readSnapshot =
    internalCapability === AUTOMATION_PLANNING_READ_INTERNAL
      ? readAutomationAuthorityFileSnapshotInternal
      : readAutomationAuthorityFileSnapshot;
  const snapshot = readSnapshot(paths.taskManifest, {
    allowMissing: true,
    allowEmpty: false,
    privateRoot: paths.controlRoot,
    maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
    allowedModes: [0o600],
    label: "Current task manifest",
    missingCode: "invalid_state",
    invalidCode: "invalid_state",
  });
  if (snapshot.missing) {
    return Object.freeze({
      manifest: emptyTaskManifest(nowMs),
      snapshot,
    });
  }
  let manifest;
  try {
    manifest = JSON.parse(privateAuthorityDecoder.decode(snapshot.bytes));
  } catch {
    throw new AutomationControlError(
      "invalid_state",
      "Current task manifest is unsafe or contains invalid JSON.",
    );
  }
  return Object.freeze({
    manifest: validateTaskManifest(manifest),
    snapshot,
  });
}

function readTaskManifestUnchecked(options = {}) {
  return readTaskManifestSnapshotUnchecked(options).manifest;
}

function matchingTaskTransactionEvent(paths, expectedEvent) {
  const snapshot = readControlEventHistorySnapshot(paths.events);
  const matches = snapshot.events.filter(
    (event) => event?.eventId === expectedEvent.eventId,
  );
  if (matches.length > 1) {
    throw new AutomationControlError(
      "control_event_duplicate",
      `Control event history contains duplicate event ${expectedEvent.eventId}.`,
      { eventId: expectedEvent.eventId, count: matches.length },
    );
  }
  if (
    matches.length === 1 &&
    !canonicalValuesEqual(matches[0], expectedEvent)
  ) {
    throw new AutomationControlError(
      "control_event_conflict",
      `Control event ${expectedEvent.eventId} conflicts with its task transaction.`,
      { eventId: expectedEvent.eventId },
    );
  }
  return { event: matches[0] ?? null, snapshot };
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

function parseTaskTransactionAuthorityStageEntry(entry) {
  if (!entry.startsWith(".")) return null;
  const marker = ".authority.";
  const markerIndex = entry.indexOf(marker, 1);
  if (markerIndex < 0) return null;
  const canonicalName = entry.slice(1, markerIndex);
  const suffix = entry.slice(markerIndex + marker.length);
  const provisional = /^([0-9a-f]{64})\.staging$/.exec(suffix);
  const ready = /^([0-9a-f]{64})\.([0-9a-f]{64})\.tmp$/.exec(suffix);
  const canonical = /^(\d{12})-(.+)\.json$/.exec(canonicalName);
  if (
    (provisional === null && ready === null) ||
    canonical === null ||
    !IDENTIFIER_PATTERN.test(canonical[2])
  ) {
    throw new AutomationControlError(
      "transaction_conflict",
      `Task transaction staging entry ${entry} has an invalid bounded identity.`,
    );
  }
  return Object.freeze({
    entry,
    canonicalName,
    revision: Number(canonical[1]),
    transactionId: canonical[2],
    kind: provisional === null ? "ready" : "provisional",
    namespaceDigest: (provisional ?? ready)[1],
    successorStableDigest: ready?.[2] ?? null,
  });
}

function reconcileTaskTransactionAuthorityStages(
  paths,
  { beforeMutation = () => {} } = {},
) {
  const helper = openPinnedLeaseArchiveHelper();
  const directory = openPinnedLeaseArchiveDirectory(
    paths.taskTransactions,
    "Task transaction directory",
  );
  try {
    const entries = listPinnedAutomationAuthorityDirectory(helper, directory, {
      maxEntries: AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES,
      label: "Task transaction directory",
      errorCode: "transaction_conflict",
    }).sort();
    const stages = [];
    const stagedCanonicalNames = new Set();
    for (const entry of entries) {
      if (entry === AUTHORITY_RETIREMENT_DIRECTORY) {
        requirePrivateDirectory(
          path.join(paths.taskTransactions, entry),
          "Task transaction authority retirement directory",
        );
        continue;
      }
      if (entry.endsWith(".json")) continue;
      const stage = parseTaskTransactionAuthorityStageEntry(entry);
      if (stage === null) {
        throw new AutomationControlError(
          "transaction_conflict",
          `Task transaction directory contains unsupported entry ${entry}.`,
        );
      }
      if (stagedCanonicalNames.has(stage.canonicalName)) {
        throw new AutomationControlError(
          "transaction_conflict",
          `Task transaction ${stage.canonicalName} has more than one pre-WAL staging generation.`,
        );
      }
      stagedCanonicalNames.add(stage.canonicalName);
      stages.push(stage);
    }
    for (const stage of stages) {
      const transactionPath = path.join(
        paths.taskTransactions,
        stage.canonicalName,
      );
      const missing = readAutomationAuthorityFileSnapshot(transactionPath, {
        allowMissing: true,
        allowEmpty: true,
        privateRoot: paths.controlRoot,
        maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
        allowedModes: [0o600],
        label: `Task transaction ${stage.transactionId}`,
        invalidCode: "transaction_conflict",
      });
      requireAutomationAuthoritySnapshotDirectory(
        missing,
        directory,
        `Task transaction ${stage.transactionId}`,
      );
      if (!missing.missing) {
        throw new AutomationControlError(
          "transaction_conflict",
          `Task transaction ${stage.transactionId} exists beside pre-WAL staging.`,
        );
      }
      const stagePath = path.join(paths.taskTransactions, stage.entry);
      const staged = readAutomationAuthorityStage(stagePath, {
        privateRoot: paths.controlRoot,
        maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
        allowedModes: [0o600],
        label: `Task transaction ${stage.transactionId} pre-WAL staging`,
      });
      requireAutomationAuthoritySnapshotDirectory(
        staged,
        directory,
        `Task transaction ${stage.transactionId} pre-WAL staging`,
      );
      if (staged.missing) {
        throw new AutomationControlError(
          "transaction_conflict",
          `Task transaction ${stage.transactionId} staging disappeared during recovery.`,
        );
      }
      const proposedDigest = digestBytes(staged.bytes);
      const expectedNamespace = automationAuthorityNamespace({
        filePath: transactionPath,
        operationId: `task-transaction:${stage.transactionId}`,
        proposedDigest,
        previousSnapshot: missing,
      });
      let transaction = null;
      try {
        transaction = validateTaskTransaction(
          JSON.parse(privateAuthorityDecoder.decode(staged.bytes)),
          transactionPath,
        );
      } catch {
        transaction = null;
      }
      if (
        expectedNamespace === stage.namespaceDigest &&
        (stage.kind !== "ready" ||
          automationAuthorityStableGenerationDigest(staged) ===
            stage.successorStableDigest) &&
        transaction !== null &&
        transaction.transactionId === stage.transactionId &&
        transaction.targetManifest.revision === stage.revision
      ) {
        beforeMutation();
        writeAutomationAuthorityFile({
          filePath: transactionPath,
          bytes: staged.bytes,
          previousSnapshot: missing,
          operationId: `task-transaction:${stage.transactionId}`,
          privateRoot: paths.controlRoot,
          maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
          allowedModes: [0o600],
          label: `Task transaction ${stage.transactionId}`,
        });
        continue;
      }
      beforeMutation();
      removeAutomationAuthorityFile({
        filePath: stagePath,
        snapshot: staged,
        operationId: `task-pre-wal-retire:${stage.transactionId}:${stage.namespaceDigest}`,
        privateRoot: paths.controlRoot,
        maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
        allowedModes: [0o600],
        label: `Task transaction ${stage.transactionId} partial pre-WAL staging`,
        retirementBasename: stage.canonicalName,
        rawSource: true,
      });
    }
    assertPinnedLeaseArchiveDirectory(directory);
  } finally {
    closeSync(directory.descriptor);
  }
}

function recoverTaskTransactionsUnlocked(
  paths,
  nowMs,
  { beforeMutation = () => {} } = {},
) {
  if (!existsSync(paths.taskTransactions)) {
    return { recovered: 0 };
  }
  withActiveAutomationEventsGuard(paths, (eventsGuard) => {
    const activeTransactions = readTaskManifestLineageTransactions(
      paths,
      null,
      { includeRetired: false },
    ).map((candidate) => candidate.transaction);
    admitControlEventAuthorityStage(paths, {
      expectedPendingEvents: activeTransactions.map(
        (transaction) => transaction.event,
      ),
    });
    admitTaskManifestAuthorityStage(paths, {
      expectedPendingTransactions: activeTransactions,
    });
    reconcileTaskTransactionAuthorityStages(paths, {
      beforeMutation: () => {
        requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
        beforeMutation();
      },
    });
  });
  const taskDirectory = openPinnedLeaseArchiveDirectory(
    paths.taskTransactions,
    "Task transaction directory",
  );
  let taskTransactionEntries;
  try {
    taskTransactionEntries = listPinnedAutomationAuthorityDirectory(
      openPinnedLeaseArchiveHelper(),
      taskDirectory,
      {
        maxEntries: AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES,
        label: "Task transaction directory",
        errorCode: "transaction_conflict",
      },
    );
  } finally {
    closeSync(taskDirectory.descriptor);
  }
  const unexpectedTaskTransactionEntry = taskTransactionEntries.find(
    (name) =>
      name !== AUTHORITY_RETIREMENT_DIRECTORY && !name.endsWith(".json"),
  );
  if (unexpectedTaskTransactionEntry !== undefined) {
    throw new AutomationControlError(
      "transaction_conflict",
      `Task transaction directory contains unsupported entry ${unexpectedTaskTransactionEntry}.`,
    );
  }
  const transactions = taskTransactionEntries
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const filePath = path.join(paths.taskTransactions, name);
      const admitted = readTaskControlJsonSnapshot(
        paths,
        filePath,
        "Task transaction",
      );
      return {
        filePath,
        transaction: validateTaskTransaction(admitted.value, filePath),
        snapshot: admitted.snapshot,
      };
    })
    .sort(
      (left, right) =>
        left.transaction.targetManifest.revision -
        right.transaction.targetManifest.revision,
    );

  return withActiveAutomationEventsGuard(
    paths,
    (eventsGuard) => {
      const guardMutation = () => {
        requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
        beforeMutation();
      };
      let recovered = 0;
      for (const { filePath, transaction, snapshot } of transactions) {
        const readmitAuthorityStages = () => {
          admitControlEventAuthorityStage(paths, {
            expectedPendingEvents: [transaction.event],
          });
          admitTaskManifestAuthorityStage(paths, {
            expectedPendingTransactions: [transaction],
          });
        };
        const currentAdmission = readTaskManifestSnapshotUnchecked({
          stateRoot: paths.stateRoot,
          nowMs,
        });
        const current = currentAdmission.manifest;
        const target = transaction.targetManifest;
        let matchedEvent = matchingTaskTransactionEvent(
          paths,
          transaction.event,
        );
        const requireExactEvent = () => {
          if (matchedEvent.event === null) {
            guardMutation();
            appendEventLineUnlocked(
              paths,
              transaction.event,
              matchedEvent.snapshot,
              { beforeRename: guardMutation, eventsGuard },
            );
            matchedEvent = matchingTaskTransactionEvent(
              paths,
              transaction.event,
            );
          }
          if (matchedEvent.event === null) {
            throw new AutomationControlError(
              "transaction_conflict",
              `Task transaction ${transaction.transactionId} has no durable audit event.`,
            );
          }
        };

        if (current.revision === transaction.previousManifestRevision) {
          requireExactEvent();
          guardMutation();
          readmitAuthorityStages();
          writeJsonAtomic(paths.taskManifest, target, {
            expectedSnapshot: currentAdmission.snapshot,
            operationId: `task-manifest:${transaction.transactionId}`,
            privateRoot: paths.controlRoot,
            label: "Current task manifest",
            validateStageSuccessor: (before, after) =>
              requireTaskManifestSemanticSuccessor(paths, before, after),
            buildStagePendingPlans: () => [
              Object.freeze({
                operationId: `task-manifest:${transaction.transactionId}`,
                proposedBytes: privateJsonBytes(transaction.targetManifest),
              }),
            ],
          });
        } else if (current.revision === target.revision) {
          if (JSON.stringify(current) !== JSON.stringify(target)) {
            throw new AutomationControlError(
              "transaction_conflict",
              `Task transaction ${transaction.transactionId} conflicts with manifest revision ${current.revision}.`,
            );
          }
          requireExactEvent();
        } else if (current.revision > target.revision) {
          if (matchedEvent.event === null) {
            throw new AutomationControlError(
              "transaction_conflict",
              `Task transaction ${transaction.transactionId} has no exact audit event at manifest revision ${current.revision}.`,
            );
          }
        } else {
          throw new AutomationControlError(
            "transaction_conflict",
            `Task transaction ${transaction.transactionId} expected manifest revision ${transaction.previousManifestRevision}, found ${current.revision}.`,
          );
        }

        readmitAuthorityStages();
        removeAutomationAuthorityFile({
          filePath,
          snapshot,
          operationId: `task-transaction-retire:${transaction.transactionId}`,
          privateRoot: paths.controlRoot,
          maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
          allowedModes: [0o600],
          label: `Task transaction ${transaction.transactionId}`,
          beforeRemove: guardMutation,
        });
        recovered += 1;
      }
      syncDirectory(paths.taskTransactions);
      return { recovered };
    },
    { now: () => nowMs },
  );
}

export function recoverTaskTransactions({
  stateRoot,
  nowMs = Date.now(),
} = {}) {
  const paths = automationControlPaths(stateRoot);
  requireOutsideAutomationPlanningReadScope(
    paths.stateRoot,
    "Task transaction recovery",
  );
  return withFilesystemGuard(
    paths,
    "tasks",
    () => recoverTaskTransactionsUnlocked(paths, nowMs),
    { now: () => nowMs },
  );
}

export function readTaskManifest({ stateRoot, nowMs = Date.now() } = {}) {
  requireOutsideAutomationPlanningReadScope(
    automationControlPaths(stateRoot).stateRoot,
    "Task manifest read",
  );
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

function requireControlEventPhysicalHistory(bytes) {
  let offset = 0;
  let recordCount = 0;
  while (offset < bytes.length) {
    const newline = bytes.indexOf(0x0a, offset);
    const end = newline === -1 ? bytes.length : newline + 1;
    const physicalLength = end - offset;
    if (physicalLength > CONTROL_EVENT_MAX_LINE_BYTES) {
      throw new AutomationControlError(
        "invalid_state",
        `Control event history line ${(recordCount + 1).toLocaleString()} exceeds the supported physical byte boundary.`,
      );
    }
    let contentEnd = end;
    if (contentEnd > offset && bytes[contentEnd - 1] === 0x0a) contentEnd -= 1;
    if (contentEnd > offset && bytes[contentEnd - 1] === 0x0d) contentEnd -= 1;
    let hasNonWhitespace = false;
    for (let index = offset; index < contentEnd; index += 1) {
      if (![0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20].includes(bytes[index])) {
        hasNonWhitespace = true;
        break;
      }
    }
    if (!hasNonWhitespace) {
      throw new AutomationControlError(
        "invalid_state",
        `Control event history contains a blank physical line at ${(recordCount + 1).toLocaleString()}.`,
      );
    }
    recordCount += 1;
    if (recordCount > CONTROL_EVENT_HISTORY_MAX_RECORDS) {
      throw new AutomationControlError(
        "invalid_state",
        "Control event history exceeds its physical record boundary.",
      );
    }
    offset = end;
  }
  return recordCount;
}

function parseControlEventHistorySnapshot(snapshot) {
  if (snapshot.missing) {
    return Object.freeze({
      ...snapshot,
      events: Object.freeze([]),
      recordCount: 0,
    });
  }
  const recordCount = requireControlEventPhysicalHistory(snapshot.bytes);
  let text;
  try {
    text = controlEventHistoryDecoder.decode(snapshot.bytes);
  } catch {
    throw new AutomationControlError(
      "invalid_state",
      "Control event history is not valid UTF-8.",
    );
  }
  const events = [];
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    if (!raw.trim()) {
      const allowedEmptyFile = text.length === 0 && index === 0;
      const allowedFinalNewline =
        raw === "" && index === lines.length - 1 && /\r?\n$/.test(text);
      if (allowedEmptyFile || allowedFinalNewline) continue;
      throw new AutomationControlError(
        "invalid_state",
        `Control event history contains a blank physical line at ${(index + 1).toLocaleString()}.`,
      );
    }
    try {
      events.push(JSON.parse(raw));
    } catch {
      throw new AutomationControlError(
        "invalid_state",
        `Control event history contains malformed JSON at line ${(index + 1).toLocaleString()}.`,
      );
    }
  }
  if (events.length !== recordCount) {
    throw new AutomationControlError(
      "invalid_state",
      "Control event history physical and parsed record counts differ.",
    );
  }
  return Object.freeze({
    ...snapshot,
    events: Object.freeze(events),
    recordCount,
  });
}

function readControlEventHistorySnapshot(
  filePath,
  internalCapability = undefined,
) {
  const readSnapshot =
    internalCapability === AUTOMATION_PLANNING_READ_INTERNAL
      ? readAutomationAuthorityFileSnapshotInternal
      : readAutomationAuthorityFileSnapshot;
  return parseControlEventHistorySnapshot(
    readSnapshot(filePath, {
      allowMissing: true,
      allowEmpty: true,
      privateRoot: path.dirname(filePath),
      maxBytes: CONTROL_EVENT_HISTORY_MAX_BYTES,
      allowedModes: [0o600],
      label: "Control event history",
    }),
  );
}

function prepareControlEventAppend(existingBytes, existingRecordCount, event) {
  if (
    !Number.isSafeInteger(existingRecordCount) ||
    existingRecordCount < 0 ||
    existingRecordCount > CONTROL_EVENT_HISTORY_MAX_RECORDS
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Control event append requires its admitted physical record count.",
    );
  }
  const separator =
    existingBytes.length > 0 && existingBytes[existingBytes.length - 1] !== 0x0a
      ? Buffer.from("\n", "utf8")
      : Buffer.alloc(0);
  const eventBytes = Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
  if (
    eventBytes.length > CONTROL_EVENT_MAX_LINE_BYTES ||
    existingRecordCount + 1 > CONTROL_EVENT_HISTORY_MAX_RECORDS ||
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
  existingSnapshot,
  { beforeRename = () => {}, eventsGuard = undefined } = {},
) {
  requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
  admitControlEventAuthorityStage(paths, {
    expectedPendingEvents: [event],
  });
  const { separator, eventBytes } = prepareControlEventAppend(
    existingSnapshot.bytes,
    existingSnapshot.recordCount,
    event,
  );
  writeAutomationAuthorityFile({
    filePath: paths.events,
    bytes: Buffer.concat([existingSnapshot.bytes, separator, eventBytes]),
    previousSnapshot: existingSnapshot,
    operationId:
      typeof event?.eventId === "string"
        ? `control-event:${event.eventId}`
        : `control-event:${digestBytes(eventBytes)}`,
    privateRoot: paths.controlRoot,
    maxBytes: CONTROL_EVENT_HISTORY_MAX_BYTES,
    allowedModes: [0o600],
    label: "Control event history",
    beforePublish: beforeRename,
    validateStageSuccessor: (before, after) =>
      requireControlEventSemanticSuccessor(paths, before, after),
    buildStagePendingPlans: (current) => {
      const admitted = parseControlEventHistorySnapshot(current);
      const append = prepareControlEventAppend(
        admitted.bytes,
        admitted.recordCount,
        event,
      );
      return [
        Object.freeze({
          operationId: `control-event:${event.eventId}`,
          proposedBytes: Buffer.concat([
            admitted.bytes,
            append.separator,
            append.eventBytes,
          ]),
        }),
      ];
    },
  });
}

function appendEventLine(
  paths,
  event,
  { now = () => Date.now(), beforeAccess = () => {} } = {},
) {
  withActiveAutomationEventsGuard(
    paths,
    (eventsGuard) => {
      requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
      beforeAccess();
      const snapshot = readControlEventHistorySnapshot(paths.events);
      beforeAccess();
      appendEventLineUnlocked(paths, event, snapshot, {
        beforeRename: beforeAccess,
        eventsGuard,
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
    eventsGuard = undefined,
  } = {},
) {
  requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
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
    admitControlEventAuthorityStage(paths);
    return existing;
  }

  const event = buildEvent(nowIso(nowMs));
  appendEventLineUnlocked(paths, event, snapshot, {
    beforeRename: beforeAccess,
    eventsGuard,
  });
  return event;
}

function appendDeterministicEventLine(
  paths,
  eventId,
  buildEvent,
  options = {},
) {
  return withActiveAutomationEventsGuard(
    paths,
    (eventsGuard) =>
      appendDeterministicEventLineUnlocked(paths, eventId, buildEvent, {
        ...options,
        eventsGuard,
      }),
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
      `Event type ${type} is reserved for its canonical control-plane writer.`,
      { type },
    );
  }
  if (
    typeof eventId === "string" &&
    RESERVED_CONTROL_EVENT_ID_PREFIXES.some((prefix) =>
      eventId.startsWith(prefix),
    )
  ) {
    throw new AutomationControlError(
      "reserved_event_id",
      `Event ID ${eventId} is reserved for its canonical control-plane writer.`,
      { eventId },
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
      const { lease, policy } = requireMutationLease({
        ...authority,
        authorityContext,
      });
      requireLeaseAuthorizedEventTime(lease, nowMs);
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
        const { lease, policy } = requireMutationLease({
          ...authority,
          authorityContext,
        });
        requireLeaseAuthorizedEventTime(lease, nowMs);
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
          eventsGuard: guardContext?.eventsGuard,
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
        authorizationProvenance: leaseAuthorizationProvenance(lease, nowMs),
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
      if (
        !readTaskUnderMutationAuthority({
          stateRoot: options.stateRoot,
          taskId: options.taskId,
          nowMs,
          authorityContext,
        })
      ) {
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

function preauthorizeOutcomeLedgerRepairFromHeldTaskSnapshot(
  options,
  paths,
  authorityContext,
) {
  authorityContext.reauthorize();
  const manifest = readTaskManifestSnapshotUnchecked({
    stateRoot: paths.stateRoot,
    nowMs: options.nowMs ?? Date.now(),
  }).manifest;
  const matchingTasks = manifest.tasks.filter(
    (task) => task?.taskId === options.taskId,
  );
  if (matchingTasks.length !== 1) {
    throw new AutomationControlError(
      matchingTasks.length === 0 ? "task_not_found" : "invalid_state",
      matchingTasks.length === 0
        ? `Task ${options.taskId} does not exist.`
        : `Task ${options.taskId} is duplicated in the current manifest.`,
      { taskId: options.taskId },
    );
  }
  return authorizeOutcomeLedgerRepairLease({
    ...options,
    nowMs: options.nowMs ?? Date.now(),
    authorityContext,
  });
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
  const eventHistory = readControlEventHistorySnapshot(
    automationControlPaths(options.stateRoot).events,
  ).events;
  validateOutcomeLedgerRepairEvent(existing, {
    stateRoot: options.stateRoot,
    taskId: authorization.taskId,
    parameters: authorization.parameters,
    intentDigest: authorization.intentDigest,
    eventHistory,
  });
  const existingCore = structuredClone(existing);
  const expectedCore = structuredClone(expected);
  delete existingCore.data.authorization;
  delete expectedCore.data.authorization;
  return canonicalValuesEqual(existingCore, expectedCore);
}

function appendOutcomeLedgerRepairEventUnlocked(
  options,
  paths,
  { beforeAppend = () => {}, eventsGuard = undefined } = {},
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
      eventsGuard,
    },
  );
}

function outcomeLedgerRepairAuthorizationFromOwnerAcquisition(event) {
  const common = {
    leaseName: event.leaseName,
    leaseAcquiredAt: event.ts,
    credentialKind: event.data?.credentialKind,
  };
  if (event.data?.credentialKind === "owner-signed-capability") {
    return {
      ...common,
      ownerCapabilityId: event.data.ownerCapabilityId,
      ownerCapabilityTaskId: event.data.ownerCapabilityTaskId,
      ownerCapabilityIntentDigest: event.data.ownerCapabilityIntentDigest,
    };
  }
  if (event.data?.credentialKind === "owner-confirmation") {
    return {
      ...common,
      ownerConfirmationId: event.data.ownerConfirmationId,
      ownerConfirmationTaskId: event.data.ownerConfirmationTaskId,
      ownerConfirmationIntentDigest: event.data.ownerConfirmationIntentDigest,
      ownerConfirmationDigest: event.data.ownerConfirmationDigest,
      ownerConfirmationReference: event.data.ownerConfirmationReference,
      ownerConfirmationApprovedBy: event.data.ownerConfirmationApprovedBy,
      ownerConfirmationApprovalReference:
        event.data.ownerConfirmationApprovalReference,
      ownerConfirmationApprovedAt: event.data.ownerConfirmationApprovedAt,
      ownerConfirmationExpiresAt: event.data.ownerConfirmationExpiresAt,
    };
  }
  return null;
}

function ownerAcquisitionMatchesOutcomeLedgerRepair(event, authorization) {
  const credentialKind = event.data?.credentialKind;
  const taskId =
    credentialKind === "owner-signed-capability"
      ? event.data?.ownerCapabilityTaskId
      : credentialKind === "owner-confirmation"
        ? event.data?.ownerConfirmationTaskId
        : null;
  const intentDigest =
    credentialKind === "owner-signed-capability"
      ? event.data?.ownerCapabilityIntentDigest
      : credentialKind === "owner-confirmation"
        ? event.data?.ownerConfirmationIntentDigest
        : null;
  return (
    [
      "lease_acquired",
      "lease_credential_upgraded",
      "lease_taken_over",
    ].includes(event.type) &&
    event.actor === "freed-owner" &&
    event.leaseName === "owner-governance" &&
    taskId === authorization.taskId &&
    intentDigest === authorization.intentDigest
  );
}

function exactLeaseControlEventBytes(event) {
  return Buffer.from(
    `${JSON.stringify({
      schemaVersion: event.schemaVersion,
      eventId: event.eventId,
      type: event.type,
      ts: event.ts,
      actor: event.actor,
      leaseName: event.leaseName,
      data: event.data,
    })}\n`,
    "utf8",
  );
}

function requireOutcomeLedgerRepairEventHistoryBoundary(
  snapshot,
  authorization,
  outcomeHistory,
) {
  const { parameters, eventId } = authorization;
  const prefixSize = parameters.eventHistorySize;
  if (
    prefixSize > snapshot.bytes.length ||
    digestBytes(snapshot.bytes.subarray(0, prefixSize)) !==
      parameters.eventHistoryDigest
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_event_invalid",
      "Outcome ledger repair event history prefix changed before finalization.",
    );
  }
  const records = [];
  const recordsByStart = new Map();
  let offset = 0;
  while (offset < snapshot.bytes.length) {
    const newline = snapshot.bytes.indexOf(0x0a, offset);
    const end = newline === -1 ? snapshot.bytes.length : newline + 1;
    const record = Object.freeze({
      index: records.length,
      start: offset,
      end,
      raw: snapshot.bytes.subarray(offset, end),
      event: snapshot.events[records.length],
    });
    records.push(record);
    recordsByStart.set(offset, record);
    offset = end;
  }
  const matchingRecords = records.filter(
    (record) => record.event?.eventId === eventId,
  );
  if (matchingRecords.length > 1) {
    throw new AutomationControlError(
      "control_event_duplicate",
      `Control event history contains duplicate event ${eventId}.`,
    );
  }
  const separatorSize =
    prefixSize > 0 && snapshot.bytes[prefixSize - 1] !== 0x0a ? 1 : 0;
  if (separatorSize === 1 && snapshot.bytes[prefixSize] !== 0x0a) {
    throw new AutomationControlError(
      "outcome_ledger_repair_event_invalid",
      "Outcome ledger repair event history suffix separator changed.",
    );
  }
  const suffixStart = prefixSize + separatorSize;
  const firstRecord = recordsByStart.get(suffixStart);
  const repairIndex = matchingRecords[0]?.index ?? records.length;
  let activeAcquisition = null;
  let lastLifecycle = null;
  let maximumLifecycleTimestampMs = Number.NEGATIVE_INFINITY;
  let valid =
    outcomeHistory.ownerLeaseLineageHealthy === true &&
    firstRecord !== undefined &&
    firstRecord.index < repairIndex;
  for (
    let index = firstRecord?.index ?? repairIndex;
    valid && index < repairIndex;
    index += 1
  ) {
    const record = records[index];
    const descriptor = outcomeHistory.ownerLeaseLineageByRecordIndex.get(index);
    const acquisitionDescriptor =
      descriptor === undefined
        ? undefined
        : outcomeHistory.ownerLeaseLineageByRecordIndex.get(
            descriptor.acquisitionIndex,
          );
    if (
      descriptor === undefined ||
      !canonicalValuesEqual(descriptor.event, record.event) ||
      !record.raw.equals(exactLeaseControlEventBytes(descriptor.event)) ||
      acquisitionDescriptor?.kind !== "acquisition" ||
      !ownerAcquisitionMatchesOutcomeLedgerRepair(
        acquisitionDescriptor.event,
        authorization,
      )
    ) {
      valid = false;
      break;
    }
    if (descriptor.kind === "acquisition") {
      activeAcquisition = descriptor;
      lastLifecycle = descriptor;
      maximumLifecycleTimestampMs = Date.parse(descriptor.event.ts);
    } else if (
      descriptor.kind === "heartbeat" &&
      activeAcquisition?.acquisitionIndex === descriptor.acquisitionIndex
    ) {
      lastLifecycle = descriptor;
      maximumLifecycleTimestampMs = Math.max(
        maximumLifecycleTimestampMs,
        Date.parse(descriptor.event.ts),
      );
      continue;
    } else if (
      descriptor.kind === "release" &&
      activeAcquisition?.acquisitionIndex === descriptor.acquisitionIndex
    ) {
      activeAcquisition = null;
      lastLifecycle = descriptor;
    } else {
      valid = false;
    }
  }
  if (
    !valid ||
    activeAcquisition === null ||
    !canonicalValuesEqual(
      outcomeLedgerRepairAuthorizationFromOwnerAcquisition(
        activeAcquisition.event,
      ),
      matchingRecords.length === 1
        ? matchingRecords[0].event?.data?.authorization
        : (authorization.authorizationProvenance ??
            outcomeLedgerRepairAuthorizationFromOwnerAcquisition(
              activeAcquisition.event,
            )),
    ) ||
    (matchingRecords.length === 0 &&
      snapshot.bytes.length !== records.at(-1)?.end) ||
    (matchingRecords.length === 1 && matchingRecords[0].index !== repairIndex)
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_event_invalid",
      "Outcome ledger repair audit event does not follow one exact plan-bound owner lease lifecycle.",
    );
  }
  return Object.freeze({
    activeAcquisition,
    lastLifecycle,
    maximumLifecycleTimestampMs,
  });
}

function planOutcomeLedgerRepairEventFromHistory(
  options,
  paths,
  authorization,
  { requireCurrentProvenance = false } = {},
) {
  const snapshot = readControlEventHistorySnapshot(paths.events);
  const outcomeHistory = inspectExactOutcomeControlHistory(snapshot.events, {
    ledgerPath: paths.outcomes,
    stateRoot: paths.stateRoot,
  });
  if (!outcomeHistory.ownerLeaseLineageHealthy) {
    throw new AutomationControlError(
      "outcome_ledger_repair_event_invalid",
      `Outcome ledger repair owner lease history is invalid: ${outcomeHistory.leaseHistoryIssues.join("; ")}`,
    );
  }
  const matches = snapshot.events.filter(
    (event) => event?.eventId === authorization.eventId,
  );
  const boundary = requireOutcomeLedgerRepairEventHistoryBoundary(
    snapshot,
    authorization,
    outcomeHistory,
  );
  const historyAuthorization =
    outcomeLedgerRepairAuthorizationFromOwnerAcquisition(
      boundary.activeAcquisition.event,
    );
  if (
    boundary.lastLifecycle === null ||
    (requireCurrentProvenance &&
      !canonicalValuesEqual(
        historyAuthorization,
        authorization.authorizationProvenance,
      ))
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_event_invalid",
      "Outcome ledger repair current lease differs from its canonical history timeline.",
    );
  }
  const deterministicAuthorization = {
    ...authorization,
    authorizationProvenance: historyAuthorization,
  };
  if (!Number.isFinite(boundary.maximumLifecycleTimestampMs)) {
    throw new AutomationControlError(
      "outcome_ledger_repair_event_invalid",
      "Outcome ledger repair active owner timeline has no canonical timestamp.",
    );
  }
  const deterministicTimestamp = new Date(
    boundary.maximumLifecycleTimestampMs,
  ).toISOString();
  const eventPlanBoundary = Object.freeze({
    historyDigest: digestBytes(snapshot.bytes),
    historyGeneration: automationAuthoritySnapshotDescriptor(snapshot),
    historyParent: structuredClone(snapshot.directoryIdentity),
    historyRecordCount: snapshot.recordCount,
    historySize: snapshot.bytes.length,
  });
  if (matches.length > 1) {
    throw new AutomationControlError(
      "control_event_duplicate",
      `Control event history contains duplicate event ${authorization.eventId}.`,
    );
  }
  if (matches.length === 1) {
    const existing = matches[0];
    try {
      if (
        !validateEquivalentOutcomeLedgerRepairEvents(
          existing,
          buildOutcomeLedgerRepairEvent(
            deterministicAuthorization,
            deterministicTimestamp,
          ),
          options,
          deterministicAuthorization,
        )
      ) {
        throw new AutomationControlError(
          "control_event_conflict",
          `Control event ${authorization.eventId} conflicts with this repair receipt.`,
        );
      }
    } catch {
      throw new AutomationControlError(
        "control_event_conflict",
        `Control event ${authorization.eventId} conflicts with this repair receipt.`,
        { eventId: authorization.eventId },
      );
    }
    return { existing: true, event: existing, ...eventPlanBoundary };
  }
  const event = buildOutcomeLedgerRepairEvent(
    deterministicAuthorization,
    deterministicTimestamp,
  );
  validateOutcomeLedgerRepairEvent(event, {
    stateRoot: options.stateRoot,
    taskId: deterministicAuthorization.taskId,
    parameters: deterministicAuthorization.parameters,
    intentDigest: deterministicAuthorization.intentDigest,
    eventHistory: snapshot.events,
  });
  const eventBytes = Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
  const separator =
    snapshot.bytes.length > 0 &&
    snapshot.bytes[snapshot.bytes.length - 1] !== 0x0a
      ? Buffer.from("\n", "utf8")
      : Buffer.alloc(0);
  if (
    eventBytes.length > CONTROL_EVENT_MAX_LINE_BYTES ||
    snapshot.recordCount + 1 > CONTROL_EVENT_HISTORY_MAX_RECORDS ||
    snapshot.bytes.length + separator.length + eventBytes.length >
      CONTROL_EVENT_HISTORY_MAX_BYTES
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Outcome ledger repair audit event has no durable history capacity.",
    );
  }
  const proposedBytes = Buffer.concat([snapshot.bytes, separator, eventBytes]);
  return {
    existing: false,
    event,
    ...eventPlanBoundary,
    stageNamespace: automationAuthorityNamespace({
      filePath: paths.events,
      operationId: `control-event:${event.eventId}`,
      proposedDigest: digestBytes(proposedBytes),
      previousSnapshot: snapshot,
    }),
  };
}

function preflightOutcomeLedgerRepairEventUnlocked(options, paths) {
  const nowMs = options.nowMs ?? Date.now();
  const authorization = authorizeOutcomeLedgerRepairLease({
    ...options,
    nowMs,
  });
  return planOutcomeLedgerRepairEventFromHistory(
    options,
    paths,
    authorization,
    { requireCurrentProvenance: true },
  );
}

function reconstructOutcomeLedgerRepairEventPlan(paths, pending) {
  requireOutcomeLedgerRepairReplacement(paths, pending.parameters);
  const authorization = {
    action: OUTCOME_LEDGER_REPAIR_ACTION,
    taskId: pending.taskId,
    eventId: outcomeLedgerRepairEventId(pending.operationId),
    intentDigest: pending.intentDigest,
    parameters: pending.parameters,
    authorizationProvenance: null,
  };
  const planned = planOutcomeLedgerRepairEventFromHistory(
    {
      stateRoot: paths.stateRoot,
      taskId: pending.taskId,
      parameters: pending.parameters,
      intentDigest: pending.intentDigest,
    },
    paths,
    authorization,
  );
  if (planned.existing) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Prepared outcome ledger repair already has a canonical audit event.",
    );
  }
  const replacement = requireOutcomeLedgerRepairReplacement(
    paths,
    pending.parameters,
  );
  return orderedOutcomeLedgerRepairEventPlan({
    event: planned.event,
    historyDigest: planned.historyDigest,
    historyGeneration: planned.historyGeneration,
    historyParent: planned.historyParent,
    historyRecordCount: planned.historyRecordCount,
    historySize: planned.historySize,
    replacementGeneration: automationAuthoritySnapshotDescriptor(replacement),
    replacementParent: structuredClone(replacement.directoryIdentity),
    stageNamespace: planned.stageNamespace,
  });
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
      "pending.json",
    ),
    completedTransactionPath: path.join(
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

function outcomeLedgerRepairReceipt(taskId, eventId, parameters, artifacts) {
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

function outcomeLedgerRepairArtifactBytes(
  filePath,
  label,
  paths,
  options = {},
) {
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
    { maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES },
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
    format: OUTCOME_LEDGER_REPAIR_DECISION_FORMAT,
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
      !Array.isArray(decision) ||
      decision.length !== 6 ||
      decision[0] !== line.lineNumber ||
      decision[1] !== line.offset ||
      decision[2] !== line.length ||
      decision[3] !== line.rawDigest ||
      ![0, 1].includes(decision[4]) ||
      !Number.isSafeInteger(decision[5]) ||
      decision[5] < 0 ||
      decision[5] >=
        OUTCOME_LEDGER_REPAIR_DECISION_REASON_DESCRIPTIONS.length ||
      (decision[4] === 0 && decision[5] !== 0) ||
      (decision[4] === 1 && decision[5] === 0)
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair decision occurrence changed.",
      );
    }
    if (decision[4] === 0) {
      trustedCount += 1;
      trustedParts.push(line.raw);
    } else {
      rejectedCount += 1;
      rejectedParts.push(line.raw);
    }
  }
  const canonicalDecisionBytes = Buffer.from(
    `${JSON.stringify({
      ...expectedHeader,
      lines: decisions.map((decision) => [...decision]),
    })}\n`,
    "utf8",
  );
  if (!decisionBytes.equals(canonicalDecisionBytes)) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair decisions artifact is not canonical compact JSON.",
    );
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
    requirePreparedMaterial = true,
    admittedSnapshot = null,
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
  const admitted =
    admittedSnapshot ??
    readPrivateJsonSnapshot(
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
  const record = admitted.value;
  const expectedEventId = outcomeLedgerRepairEventId(parameters.operationId);
  const expectedReceipt = outcomeLedgerRepairReceipt(
    taskId,
    expectedEventId,
    parameters,
    identity.artifacts,
  );
  const earlyPhase = ["fenced", "prepared"].includes(record?.phase);
  let eventPlan = null;
  if (earlyPhase) {
    if (record?.eventPlan !== null) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair binds its control event only in replaced phase.",
      );
    }
  } else {
    const candidate = record?.eventPlan;
    if (
      !exactOutcomeLedgerRepairKeys(
        candidate,
        OUTCOME_LEDGER_REPAIR_EVENT_PLAN_KEYS,
      ) ||
      !SHA256_PATTERN.test(String(candidate?.historyDigest ?? "")) ||
      !Number.isSafeInteger(candidate?.historyRecordCount) ||
      candidate.historyRecordCount < 0 ||
      !Number.isSafeInteger(candidate?.historySize) ||
      candidate.historySize < parameters.eventHistorySize ||
      !exactOutcomeLedgerRepairKeys(
        candidate?.historyGeneration,
        OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_GENERATION_KEYS,
      ) ||
      !exactOutcomeLedgerRepairKeys(
        candidate?.historyParent,
        OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_PARENT_KEYS,
      ) ||
      !exactOutcomeLedgerRepairKeys(
        candidate?.replacementGeneration,
        OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_GENERATION_KEYS,
      ) ||
      !exactOutcomeLedgerRepairKeys(
        candidate?.replacementParent,
        OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_PARENT_KEYS,
      ) ||
      !SHA256_PATTERN.test(String(candidate?.stageNamespace ?? ""))
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair transaction has an invalid bound event plan.",
      );
    }
    const history = readControlEventHistorySnapshot(paths.events);
    if (candidate.historySize > history.bytes.length) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair event plan exceeds canonical control history.",
      );
    }
    const prefixBytes = history.bytes.subarray(0, candidate.historySize);
    if (digestBytes(prefixBytes) !== candidate.historyDigest) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair event plan history boundary changed.",
      );
    }
    const prefix = parseControlEventHistorySnapshot({
      ...history,
      missing: false,
      bytes: prefixBytes,
    });
    if (prefix.recordCount !== candidate.historyRecordCount) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair event plan record boundary changed.",
      );
    }
    const expectedGeneration = {
      missing: false,
      dev: String(candidate.historyGeneration.dev),
      ino: String(candidate.historyGeneration.ino),
      mode: Number(candidate.historyGeneration.mode),
      nlink: Number(candidate.historyGeneration.nlink),
      uid: Number(candidate.historyGeneration.uid),
      gid: Number(candidate.historyGeneration.gid),
      size: Number(candidate.historyGeneration.size),
      mtimeNs: String(candidate.historyGeneration.mtimeNs),
      ctimeNs: String(candidate.historyGeneration.ctimeNs),
      digest: candidate.historyDigest,
    };
    const expectedParent = {
      dev: String(candidate.historyParent.dev),
      ino: String(candidate.historyParent.ino),
      mode: Number(candidate.historyParent.mode),
      uid: Number(candidate.historyParent.uid),
    };
    const replacement = requireOutcomeLedgerRepairReplacement(
      paths,
      parameters,
    );
    if (
      candidate.historyGeneration.missing !== false ||
      candidate.historyGeneration.digest !== candidate.historyDigest ||
      candidate.historyGeneration.size !== candidate.historySize ||
      !Number.isSafeInteger(candidate.historyGeneration.mode) ||
      !Number.isSafeInteger(candidate.historyGeneration.nlink) ||
      candidate.historyGeneration.nlink !== 1 ||
      !Number.isSafeInteger(candidate.historyGeneration.uid) ||
      !Number.isSafeInteger(candidate.historyGeneration.gid) ||
      !Number.isSafeInteger(candidate.historyGeneration.size) ||
      !/^\d+$/.test(String(candidate.historyGeneration.dev)) ||
      !/^\d+$/.test(String(candidate.historyGeneration.ino)) ||
      !/^\d+$/.test(String(candidate.historyGeneration.mtimeNs)) ||
      !/^\d+$/.test(String(candidate.historyGeneration.ctimeNs)) ||
      !/^\d+$/.test(String(candidate.historyParent.dev)) ||
      !/^\d+$/.test(String(candidate.historyParent.ino)) ||
      !Number.isSafeInteger(candidate.historyParent.mode) ||
      !Number.isSafeInteger(candidate.historyParent.uid)
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair event plan history generation is invalid.",
      );
    }
    if (
      !canonicalValuesEqual(
        automationAuthoritySnapshotDescriptor(replacement),
        candidate.replacementGeneration,
      ) ||
      !canonicalValuesEqual(
        replacement.directoryIdentity,
        candidate.replacementParent,
      )
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair canonical replacement generation changed.",
      );
    }
    try {
      validateOutcomeLedgerRepairEvent(candidate.event, {
        stateRoot: paths.stateRoot,
        taskId,
        parameters,
        intentDigest,
        eventHistory: prefix.events,
      });
      const deterministicBoundary =
        requireOutcomeLedgerRepairEventHistoryBoundary(
          {
            ...history,
            bytes: prefix.bytes,
            events: prefix.events,
            recordCount: prefix.recordCount,
          },
          {
            taskId,
            eventId: expectedEventId,
            intentDigest,
            parameters,
            authorizationProvenance: candidate.event.data.authorization,
          },
          inspectExactOutcomeControlHistory(prefix.events, {
            ledgerPath: paths.outcomes,
            stateRoot: paths.stateRoot,
          }),
        );
      const deterministicTimestamp = new Date(
        deterministicBoundary.maximumLifecycleTimestampMs,
      ).toISOString();
      if (candidate.event.ts !== deterministicTimestamp) {
        throw new AutomationControlError(
          "outcome_ledger_repair_event_invalid",
          "Outcome ledger repair event timestamp is not its canonical owner lifecycle boundary.",
        );
      }
    } catch (error) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair event plan is not authorized by its exact bound history.",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    const { separator, eventBytes } = prepareControlEventAppend(
      prefix.bytes,
      prefix.recordCount,
      candidate.event,
    );
    const plannedSuccessor = Buffer.concat([
      prefix.bytes,
      separator,
      eventBytes,
    ]);
    const eventIsCanonical =
      history.bytes.length >= plannedSuccessor.length &&
      history.bytes
        .subarray(0, plannedSuccessor.length)
        .equals(plannedSuccessor);
    if (history.bytes.length !== prefix.bytes.length && !eventIsCanonical) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair event is not the immediate exact successor to its bound history.",
      );
    }
    if (eventIsCanonical) {
      const inspection = inspectExactOutcomeControlHistory(history.events, {
        ledgerPath: paths.outcomes,
        stateRoot: paths.stateRoot,
      });
      if (
        !inspection.healthy ||
        !inspection.canonicalOutcomeLedgerRepairEventIndexes.has(
          candidate.historyRecordCount,
        ) ||
        history.events.filter(
          (event) => event?.eventId === candidate.event.eventId,
        ).length !== 1
      ) {
        throw new AutomationControlError(
          "outcome_ledger_repair_transaction_invalid",
          "Outcome ledger repair event plan does not identify one exact canonical event.",
        );
      }
    } else if (
      !canonicalValuesEqual(
        automationAuthoritySnapshotDescriptor(history),
        candidate.historyGeneration,
      ) ||
      !canonicalValuesEqual(history.directoryIdentity, candidate.historyParent)
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair event plan predecessor generation changed.",
      );
    }
    const boundSnapshot = {
      filePath: paths.events,
      privateRoot: paths.controlRoot,
      missing: false,
      bytes: prefix.bytes,
      identity: expectedGeneration,
      directoryIdentity: expectedParent,
    };
    const expectedNamespace = automationAuthorityNamespace({
      filePath: paths.events,
      operationId: `control-event:${candidate.event.eventId}`,
      proposedDigest: digestBytes(plannedSuccessor),
      previousSnapshot: boundSnapshot,
    });
    if (expectedNamespace !== candidate.stageNamespace) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair event plan staging namespace changed.",
      );
    }
    eventPlan = orderedOutcomeLedgerRepairEventPlan(candidate);
  }
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
  const expectedRecord = {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
    taskId,
    operationId: parameters.operationId,
    phase: record.phase,
    intentDigest,
    eventId: expectedEventId,
    eventPlan,
    parameters: orderedOutcomeLedgerRepairParameters(parameters),
    receipt: expectedReceipt,
    artifacts: identity.artifacts,
  };
  if (!admitted.bytes.equals(privateJsonBytes(expectedRecord))) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair transaction is not exact canonical raw JSON.",
    );
  }
  if (requirePreparedMaterial) {
    validateOutcomeLedgerRepairArchivedMaterial(
      paths,
      record,
      identity,
      expectedReceipt,
    );
  }
  return { record, identity, snapshot: admitted };
}

function inspectOutcomeLedgerRepairPendingFence(paths) {
  const transactionPath = path.join(
    paths.controlRoot,
    "outcome-ledger-transactions",
    "pending.json",
  );
  if (!pathEntryExists(transactionPath)) return null;
  const initialSnapshot = readAutomationAuthorityFileSnapshot(transactionPath, {
    privateRoot: paths.controlRoot,
    maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
    allowedModes: [0o600],
    label: "Pending outcome ledger repair transaction",
    invalidCode: "outcome_ledger_repair_transaction_invalid",
  });
  let initialValue;
  try {
    initialValue = JSON.parse(
      privateAuthorityDecoder.decode(initialSnapshot.bytes),
    );
  } catch {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Pending outcome ledger repair transaction must be one exact private canonical record.",
    );
  }
  const initial = Object.freeze({
    ...initialSnapshot,
    value: initialValue,
  });
  const taskId = requireIdentifier(initial.value?.taskId, "taskId");
  const parameters = normalizeOutcomeLedgerRepairParameters(
    initial.value?.parameters,
    paths.stateRoot,
    taskId,
  );
  const intentDigest = ownerOperationIntentDigest(
    "freed-owner",
    OUTCOME_LEDGER_REPAIR_ACTION,
    taskId,
    parameters,
  );
  const validated = validateOutcomeLedgerRepairTransaction(paths, {
    taskId,
    parameters,
    intentDigest,
    transactionPath,
    allowedPhases: [...OUTCOME_LEDGER_REPAIR_PHASES],
    requirePreparedMaterial: initial.value?.phase !== "fenced",
    admittedSnapshot: initial,
  });
  if (!automationAuthoritySnapshotMatches(initial, validated.snapshot)) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Pending outcome ledger repair transaction changed during admission.",
    );
  }
  return Object.freeze({
    taskId,
    operationId: parameters.operationId,
    intentDigest,
    phase: validated.record.phase,
    parameters,
    transactionPath,
    record: validated.record,
    snapshot: validated.snapshot,
    identity: validated.identity,
  });
}

function outcomeLedgerRepairPreparedToReplacedPaths(pending) {
  const artifactDirectory = path.dirname(pending.identity.artifacts.source);
  const transitionName = "transaction-prepared-to-replaced";
  return Object.freeze({
    artifactDirectory,
    stagingPath: path.join(
      artifactDirectory,
      "transaction-staging",
      `${transitionName}.json`,
    ),
    intentPath: path.join(
      artifactDirectory,
      "publication-intents",
      `${transitionName}.json`,
    ),
    retirementDirectory: path.join(artifactDirectory, "retired"),
  });
}

function outcomeLedgerRepairPublicationIdentity(filePath, snapshot) {
  return {
    path: filePath,
    device: String(snapshot.identity.dev),
    inode: String(snapshot.identity.ino),
    uid: Number(snapshot.identity.uid),
    mode: Number(snapshot.identity.mode) & 0o7777,
    linkCount: Number(snapshot.identity.nlink),
    size: snapshot.bytes.length,
    digest: digestBytes(snapshot.bytes),
  };
}

function outcomeLedgerRepairPreparedToReplacedPublication(
  paths,
  pending,
  staged,
) {
  const transition = outcomeLedgerRepairPreparedToReplacedPaths(pending);
  const validated = validateOutcomeLedgerRepairTransaction(paths, {
    taskId: pending.taskId,
    parameters: pending.parameters,
    intentDigest: pending.intentDigest,
    transactionPath: pending.transactionPath,
    allowedPhases: ["replaced"],
    admittedSnapshot: staged,
  });
  const predecessor = outcomeLedgerRepairPublicationIdentity(
    pending.transactionPath,
    pending.snapshot,
  );
  const successor = outcomeLedgerRepairPublicationIdentity(
    transition.stagingPath,
    staged,
  );
  const archiveId = canonicalLeaseRequestDigest({
    operationId: pending.operationId,
    fromPhase: "prepared",
    toPhase: "replaced",
    predecessor,
    successor,
  });
  const archivePath = path.join(
    transition.retirementDirectory,
    `transaction-prepared-predecessor-${archiveId}.archive`,
  );
  const intent = {
    schemaVersion: 1,
    kind: "outcome-ledger-transaction-publication",
    operationId: pending.operationId,
    fromPhase: "prepared",
    toPhase: "replaced",
    targetPath: pending.transactionPath,
    predecessor,
    successor,
    archivePath,
  };
  return Object.freeze({
    transition,
    eventPlan: validated.record.eventPlan,
    predecessor,
    successor,
    archivePath,
    intent,
    intentBytes: privateJsonBytes(intent),
  });
}

function readCommittedOutcomeLedgerRepairEventPlan(paths, pending) {
  if (["replaced", "audited", "complete"].includes(pending.phase)) {
    return pending.record.eventPlan;
  }
  if (pending.phase !== "prepared") return null;
  const transition = outcomeLedgerRepairPreparedToReplacedPaths(pending);
  if (!pathEntryExists(transition.intentPath)) return null;
  requireOutcomeLedgerRepairPriorPublicationLineage(paths, pending);
  const helper = openPinnedLeaseArchiveHelper();
  const stagingDirectory = openPinnedLeaseArchiveDirectory(
    path.dirname(transition.stagingPath),
    "Outcome ledger repair committed staging directory",
  );
  let intentDirectory;
  let retirementDirectory;
  try {
    const stagingName = path.basename(transition.stagingPath);
    const stagingEntries = listPinnedAutomationAuthorityDirectory(
      helper,
      stagingDirectory,
      {
        maxEntries: 4,
        label: "Outcome ledger repair committed staging directory",
        errorCode: "outcome_ledger_repair_transaction_invalid",
      },
    );
    if (stagingEntries.length !== 1 || stagingEntries[0] !== stagingName) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Committed outcome ledger repair requires one exact successor staging generation.",
      );
    }
    const stagedSnapshot = outcomeLedgerRepairBridgeFileSnapshot(
      transition.stagingPath,
      stagingDirectory,
      {
        privateRoot: paths.stateRoot,
        maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
        label: "Outcome ledger repair replaced successor",
      },
    );
    const staged = Object.freeze({
      ...stagedSnapshot,
      value: parseOutcomeLedgerRepairPublication(
        stagedSnapshot,
        "Outcome ledger repair replaced successor",
      ),
    });
    const publication = outcomeLedgerRepairPreparedToReplacedPublication(
      paths,
      pending,
      staged,
    );

    intentDirectory = openPinnedLeaseArchiveDirectory(
      path.dirname(transition.intentPath),
      "Outcome ledger repair committed intent directory",
    );
    const intentName = path.basename(transition.intentPath);
    const intentEntries = listPinnedAutomationAuthorityDirectory(
      helper,
      intentDirectory,
      {
        maxEntries: 8,
        label: "Outcome ledger repair committed intent directory",
        errorCode: "outcome_ledger_repair_transaction_invalid",
      },
    );
    const expectedIntentEntries = [
      "ledger-replacement.json",
      "transaction-fenced-to-prepared.json",
      intentName,
    ].sort();
    if (
      JSON.stringify([...intentEntries].sort()) !==
      JSON.stringify(expectedIntentEntries)
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Committed outcome ledger repair intent family is not exact.",
      );
    }
    const intent = outcomeLedgerRepairBridgeFileSnapshot(
      transition.intentPath,
      intentDirectory,
      {
        privateRoot: paths.stateRoot,
        maxBytes: 64 * 1024,
        label: "Outcome ledger repair prepared-to-replaced publication intent",
      },
    );
    if (!intent.bytes.equals(publication.intentBytes)) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair prepared-to-replaced publication intent is not exact.",
      );
    }

    retirementDirectory = openPinnedLeaseArchiveDirectory(
      transition.retirementDirectory,
      "Outcome ledger repair committed retirement directory",
    );
    const retirementEntries = listPinnedAutomationAuthorityDirectory(
      helper,
      retirementDirectory,
      {
        maxEntries: AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES,
        label: "Outcome ledger repair committed retirement directory",
        errorCode: "outcome_ledger_repair_transaction_invalid",
      },
    );
    if (retirementEntries.includes(path.basename(publication.archivePath))) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Committed outcome ledger repair has a premature prepared predecessor archive.",
      );
    }
    return publication.eventPlan;
  } finally {
    if (retirementDirectory !== undefined) {
      closeSync(retirementDirectory.descriptor);
    }
    if (intentDirectory !== undefined) closeSync(intentDirectory.descriptor);
    closeSync(stagingDirectory.descriptor);
  }
}

const OUTCOME_LEDGER_REPAIR_PUBLICATION_IDENTITY_KEYS = Object.freeze(
  [
    "device",
    "digest",
    "inode",
    "linkCount",
    "mode",
    "path",
    "size",
    "uid",
  ].sort(),
);

function requireOutcomeLedgerRepairPublicationIdentity(value, label) {
  if (
    !exactOutcomeLedgerRepairKeys(
      value,
      OUTCOME_LEDGER_REPAIR_PUBLICATION_IDENTITY_KEYS,
    ) ||
    typeof value.path !== "string" ||
    !path.isAbsolute(value.path) ||
    realpathSync(path.dirname(value.path)) !== path.dirname(value.path) ||
    !/^\d+$/.test(String(value.device)) ||
    !/^\d+$/.test(String(value.inode)) ||
    !Number.isSafeInteger(value.uid) ||
    !Number.isSafeInteger(value.mode) ||
    !Number.isSafeInteger(value.linkCount) ||
    value.linkCount !== 1 ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    !SHA256_PATTERN.test(String(value.digest ?? ""))
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      `${label} has an invalid publication identity.`,
    );
  }
  return value;
}

function outcomeLedgerRepairPublicationGenerationMatches(
  identity,
  snapshot,
  expectedBytes,
) {
  return (
    snapshot?.missing === false &&
    snapshot.bytes.equals(expectedBytes) &&
    String(snapshot.identity.dev) === String(identity.device) &&
    String(snapshot.identity.ino) === String(identity.inode) &&
    Number(snapshot.identity.uid) === Number(identity.uid) &&
    (Number(snapshot.identity.mode) & 0o7777) === Number(identity.mode) &&
    Number(snapshot.identity.nlink) === Number(identity.linkCount) &&
    snapshot.bytes.length === identity.size &&
    digestBytes(snapshot.bytes) === identity.digest
  );
}

function readOutcomeLedgerRepairPublicationFile(
  filePath,
  paths,
  label,
  { maxBytes = OUTCOME_LEDGER_REPAIR_MAX_BYTES, allowedModes = [0o600] } = {},
) {
  return readAutomationAuthorityFileSnapshot(filePath, {
    privateRoot: paths.stateRoot,
    maxBytes,
    allowedModes,
    label,
    invalidCode: "outcome_ledger_repair_transaction_invalid",
  });
}

function parseOutcomeLedgerRepairPublication(snapshot, label) {
  let value;
  try {
    value = JSON.parse(privateAuthorityDecoder.decode(snapshot.bytes));
  } catch {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      `${label} is not canonical UTF-8 JSON.`,
    );
  }
  if (!snapshot.bytes.equals(privateJsonBytes(value))) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      `${label} is not exact canonical JSON.`,
    );
  }
  return value;
}

function requireOutcomeLedgerRepairPriorPublicationLineage(paths, pending) {
  const transition = outcomeLedgerRepairPreparedToReplacedPaths(pending);
  const artifactDirectory = transition.artifactDirectory;
  const intentDirectory = path.join(artifactDirectory, "publication-intents");
  const retiredDirectory = path.join(artifactDirectory, "retired");

  const sourceBytes = outcomeLedgerRepairArtifactBytes(
    pending.identity.artifacts.source,
    "Outcome ledger repair source artifact",
    paths,
    { allowEmpty: true, maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES },
  );
  const replacement = requireOutcomeLedgerRepairReplacement(
    paths,
    pending.parameters,
  );
  const ledgerIntentPath = path.join(
    intentDirectory,
    "ledger-replacement.json",
  );
  const ledgerIntentSnapshot = readOutcomeLedgerRepairPublicationFile(
    ledgerIntentPath,
    paths,
    "Outcome ledger repair ledger publication intent",
    { maxBytes: 64 * 1024 },
  );
  const ledgerIntent = parseOutcomeLedgerRepairPublication(
    ledgerIntentSnapshot,
    "Outcome ledger repair ledger publication intent",
  );
  const ledgerPredecessorInput = ledgerIntent?.predecessor;
  const ledgerPredecessor = requireOutcomeLedgerRepairPublicationIdentity(
    ledgerPredecessorInput === null ||
      typeof ledgerPredecessorInput !== "object" ||
      Array.isArray(ledgerPredecessorInput)
      ? null
      : Object.fromEntries(
          Object.entries(ledgerPredecessorInput).filter(
            ([key]) => key !== "archivePath",
          ),
        ),
    "Outcome ledger repair ledger predecessor",
  );
  const ledgerReplacement = requireOutcomeLedgerRepairPublicationIdentity(
    ledgerIntent?.replacement,
    "Outcome ledger repair ledger replacement",
  );
  const ledgerArchiveId = canonicalLeaseRequestDigest({
    operationId: pending.operationId,
    target: paths.outcomes,
    predecessor: ledgerPredecessor,
  });
  const ledgerArchivePath = path.join(
    retiredDirectory,
    `ledger-predecessor-${ledgerArchiveId}.archive`,
  );
  const ledgerTemporaryPath = `${paths.outcomes}.${pending.operationId}.${pending.parameters.replacementDigest}.repair.tmp`;
  const expectedLedgerIntent = {
    schemaVersion: 1,
    kind: "outcome-ledger-replacement-publication",
    operationId: pending.operationId,
    targetPath: paths.outcomes,
    predecessor: {
      ...ledgerPredecessor,
      archivePath: ledgerArchivePath,
    },
    replacement: ledgerReplacement,
  };
  if (
    !exactOutcomeLedgerRepairKeys(
      ledgerIntent,
      [
        "kind",
        "operationId",
        "predecessor",
        "replacement",
        "schemaVersion",
        "targetPath",
      ].sort(),
    ) ||
    !exactOutcomeLedgerRepairKeys(
      ledgerPredecessorInput,
      [
        ...OUTCOME_LEDGER_REPAIR_PUBLICATION_IDENTITY_KEYS,
        "archivePath",
      ].sort(),
    ) ||
    !ledgerIntentSnapshot.bytes.equals(
      privateJsonBytes(expectedLedgerIntent),
    ) ||
    ledgerPredecessorInput.archivePath !== ledgerArchivePath ||
    ledgerIntent.schemaVersion !== 1 ||
    ledgerIntent.kind !== "outcome-ledger-replacement-publication" ||
    ledgerIntent.operationId !== pending.operationId ||
    ledgerIntent.targetPath !== paths.outcomes ||
    ledgerPredecessor.path !== paths.outcomes ||
    ledgerPredecessor.size !== pending.parameters.sourceSize ||
    ledgerPredecessor.digest !== pending.parameters.sourceDigest ||
    ledgerReplacement.path !== ledgerTemporaryPath ||
    ledgerReplacement.size !== pending.parameters.replacementSize ||
    ledgerReplacement.digest !== pending.parameters.replacementDigest ||
    pathEntryExists(ledgerTemporaryPath) ||
    !outcomeLedgerRepairPublicationGenerationMatches(
      ledgerReplacement,
      replacement,
      replacement.bytes,
    )
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair ledger publication lineage changed.",
    );
  }
  const ledgerArchive = readOutcomeLedgerRepairPublicationFile(
    ledgerArchivePath,
    paths,
    "Outcome ledger repair ledger predecessor archive",
    { allowedModes: [0o600, 0o640, 0o644] },
  );
  if (
    !outcomeLedgerRepairPublicationGenerationMatches(
      ledgerPredecessor,
      ledgerArchive,
      sourceBytes,
    )
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair ledger predecessor archive changed.",
    );
  }

  const priorName = "transaction-fenced-to-prepared";
  const priorIntentPath = path.join(intentDirectory, `${priorName}.json`);
  const priorStagingPath = path.join(
    artifactDirectory,
    "transaction-staging",
    `${priorName}.json`,
  );
  const priorIntentSnapshot = readOutcomeLedgerRepairPublicationFile(
    priorIntentPath,
    paths,
    "Outcome ledger repair fenced-to-prepared publication intent",
    { maxBytes: 64 * 1024 },
  );
  const priorIntent = parseOutcomeLedgerRepairPublication(
    priorIntentSnapshot,
    "Outcome ledger repair fenced-to-prepared publication intent",
  );
  const priorPredecessor = requireOutcomeLedgerRepairPublicationIdentity(
    priorIntent?.predecessor,
    "Outcome ledger repair fenced predecessor",
  );
  const priorSuccessor = requireOutcomeLedgerRepairPublicationIdentity(
    priorIntent?.successor,
    "Outcome ledger repair prepared successor",
  );
  const fencedBytes = privateJsonBytes({
    ...pending.record,
    phase: "fenced",
    eventPlan: null,
  });
  const priorArchiveId = canonicalLeaseRequestDigest({
    operationId: pending.operationId,
    fromPhase: "fenced",
    toPhase: "prepared",
    predecessor: priorPredecessor,
    successor: priorSuccessor,
  });
  const priorArchivePath = path.join(
    retiredDirectory,
    `transaction-fenced-predecessor-${priorArchiveId}.archive`,
  );
  const expectedPriorIntent = {
    schemaVersion: 1,
    kind: "outcome-ledger-transaction-publication",
    operationId: pending.operationId,
    fromPhase: "fenced",
    toPhase: "prepared",
    targetPath: pending.transactionPath,
    predecessor: priorPredecessor,
    successor: priorSuccessor,
    archivePath: priorArchivePath,
  };
  if (
    !exactOutcomeLedgerRepairKeys(
      priorIntent,
      [
        "archivePath",
        "fromPhase",
        "kind",
        "operationId",
        "predecessor",
        "schemaVersion",
        "successor",
        "targetPath",
        "toPhase",
      ].sort(),
    ) ||
    !priorIntentSnapshot.bytes.equals(privateJsonBytes(expectedPriorIntent)) ||
    priorIntent.schemaVersion !== 1 ||
    priorIntent.kind !== "outcome-ledger-transaction-publication" ||
    priorIntent.operationId !== pending.operationId ||
    priorIntent.fromPhase !== "fenced" ||
    priorIntent.toPhase !== "prepared" ||
    priorIntent.targetPath !== pending.transactionPath ||
    priorPredecessor.path !== pending.transactionPath ||
    priorPredecessor.size !== fencedBytes.length ||
    priorPredecessor.digest !== digestBytes(fencedBytes) ||
    priorSuccessor.path !== priorStagingPath ||
    priorSuccessor.size !== pending.snapshot.bytes.length ||
    priorSuccessor.digest !== digestBytes(pending.snapshot.bytes) ||
    priorIntent.archivePath !== priorArchivePath ||
    pathEntryExists(priorStagingPath) ||
    !outcomeLedgerRepairPublicationGenerationMatches(
      priorSuccessor,
      pending.snapshot,
      pending.snapshot.bytes,
    )
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair fenced-to-prepared lineage changed.",
    );
  }
  const priorArchive = readOutcomeLedgerRepairPublicationFile(
    priorArchivePath,
    paths,
    "Outcome ledger repair fenced predecessor archive",
  );
  if (
    !outcomeLedgerRepairPublicationGenerationMatches(
      priorPredecessor,
      priorArchive,
      fencedBytes,
    )
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair fenced predecessor archive changed.",
    );
  }
}

function inspectOutcomeLedgerRepairPreparedIntentFamily(
  paths,
  pending,
  publication,
) {
  const transition = outcomeLedgerRepairPreparedToReplacedPaths(pending);
  const directoryPath = path.dirname(transition.intentPath);
  if (!pathEntryExists(directoryPath)) {
    if (publication === null) return null;
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair successor staging precedes its intent directory.",
    );
  }
  const directory = openPinnedLeaseArchiveDirectory(
    directoryPath,
    "Outcome ledger repair publication intent directory",
  );
  try {
    const canonicalName = path.basename(transition.intentPath);
    const temporaryName =
      publication === null
        ? null
        : `.${canonicalName}.${digestBytes(publication.intentBytes)}.tmp`;
    const allowed = new Set([
      "ledger-replacement.json",
      "transaction-fenced-to-prepared.json",
      ...(temporaryName === null ? [] : [temporaryName]),
    ]);
    const entries = listPinnedAutomationAuthorityDirectory(
      openPinnedLeaseArchiveHelper(),
      directory,
      {
        maxEntries: 8,
        label: "Outcome ledger repair publication intent directory",
        errorCode: "outcome_ledger_repair_transaction_invalid",
      },
    );
    if (entries.some((entry) => !allowed.has(entry))) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        publication === null
          ? "Outcome ledger repair intent residue has no exact staged successor."
          : "Outcome ledger repair intent directory contains a foreign entry.",
      );
    }
    if (temporaryName === null || !entries.includes(temporaryName)) {
      return null;
    }
    const temporary = outcomeLedgerRepairBridgeFileSnapshot(
      path.join(directoryPath, temporaryName),
      directory,
      {
        privateRoot: paths.stateRoot,
        maxBytes: 64 * 1024,
        label: "Outcome ledger repair prepared-to-replaced intent temporary",
      },
    );
    if (
      temporary.missing ||
      temporary.bytes.length > publication.intentBytes.length ||
      !publication.intentBytes
        .subarray(0, temporary.bytes.length)
        .equals(temporary.bytes)
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair intent temporary is not an exact publication prefix.",
      );
    }
    return temporary;
  } finally {
    closeSync(directory.descriptor);
  }
}

function inspectUncommittedPreparedToReplacedResidue(paths, pending) {
  if (pending.phase !== "prepared") return null;
  const transition = outcomeLedgerRepairPreparedToReplacedPaths(pending);
  if (pathEntryExists(transition.intentPath)) return null;
  if (!pathEntryExists(path.dirname(transition.stagingPath))) {
    inspectOutcomeLedgerRepairPreparedIntentFamily(paths, pending, null);
    return null;
  }
  const directoryPath = path.dirname(transition.stagingPath);
  const directory = openPinnedLeaseArchiveDirectory(
    directoryPath,
    "Outcome ledger repair prepared-to-replaced staging directory",
  );
  try {
    const canonicalName = path.basename(transition.stagingPath);
    const temporaryPattern = new RegExp(
      `^\\.${canonicalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.([0-9a-f]{64})\\.tmp$`,
    );
    const entries = listPinnedAutomationAuthorityDirectory(
      openPinnedLeaseArchiveHelper(),
      directory,
      {
        maxEntries: 4,
        label: "Outcome ledger repair prepared-to-replaced staging directory",
      },
    );
    if (entries.includes(AUTHORITY_RETIREMENT_DIRECTORY)) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair staging contains an unrecognized retirement directory.",
      );
    }
    if (entries.length === 0) {
      inspectOutcomeLedgerRepairPreparedIntentFamily(paths, pending, null);
      return null;
    }
    if (
      entries.length !== 1 ||
      (entries[0] !== canonicalName &&
        temporaryPattern.exec(entries[0]) === null)
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair prepared-to-replaced staging has foreign entries.",
      );
    }
    const eventPlan = reconstructOutcomeLedgerRepairEventPlan(paths, pending);
    const successorBytes = privateJsonBytes({
      ...pending.record,
      phase: "replaced",
      eventPlan,
    });
    const entry = entries[0];
    const snapshot = readAutomationAuthorityStageSnapshot(
      path.join(directoryPath, entry),
      {
        allowEmpty: true,
        privateRoot: paths.stateRoot,
        maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
        allowedModes: [0o600],
        label: "Outcome ledger repair prepared-to-replaced residue",
        invalidCode: "outcome_ledger_repair_transaction_invalid",
      },
    );
    const temporary = temporaryPattern.exec(entry);
    if (
      (entry === canonicalName && !snapshot.bytes.equals(successorBytes)) ||
      (temporary !== null &&
        (temporary[1] !== digestBytes(successorBytes) ||
          snapshot.bytes.length > successorBytes.length ||
          !successorBytes
            .subarray(0, snapshot.bytes.length)
            .equals(snapshot.bytes)))
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair prepared-to-replaced residue is not an exact reconstructed generation.",
      );
    }
    const stagedRecord = {
      ...pending.record,
      phase: "replaced",
      eventPlan,
    };
    const projectedStaged = {
      value: stagedRecord,
      bytes: successorBytes,
      identity: snapshot.identity,
    };
    const publication = outcomeLedgerRepairPreparedToReplacedPublication(
      paths,
      pending,
      projectedStaged,
    );
    requireOutcomeLedgerRepairPriorPublicationLineage(paths, pending);
    const intentTemporary = inspectOutcomeLedgerRepairPreparedIntentFamily(
      paths,
      pending,
      publication,
    );
    return Object.freeze({
      entry,
      filePath: path.join(directoryPath, entry),
      snapshot,
      eventPlan,
      archivePath: publication.archivePath,
      intentTemporary,
      successorBytes,
      successorDigest: digestBytes(successorBytes),
      successorSize: successorBytes.length,
    });
  } finally {
    closeSync(directory.descriptor);
  }
}

function requireOutcomeLedgerRepairPreparedBridgeState(paths, bypass) {
  bypass.reauthorize();
  const pending = inspectOutcomeLedgerRepairPendingFence(paths);
  if (
    pending === null ||
    pending.taskId !== bypass.taskId ||
    pending.operationId !== bypass.repairOperationId ||
    pending.intentDigest !== bypass.intentDigest ||
    pending.phase !== "prepared" ||
    !automationAuthoritySnapshotMatches(
      pending.snapshot,
      bypass.pendingSnapshot,
    ) ||
    !canonicalValuesEqual(
      outcomeLedgerRepairPublicationIdentity(
        pending.transactionPath,
        pending.snapshot,
      ),
      bypass.pendingPublicationIdentity,
    )
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair changed during prepared transition recovery.",
    );
  }
  return Object.freeze({
    pending,
    residue: inspectUncommittedPreparedToReplacedResidue(paths, pending),
  });
}

function outcomeLedgerRepairBridgeFileSnapshot(
  filePath,
  directory,
  { privateRoot, maxBytes, label },
) {
  const snapshot = readAutomationAuthorityStage(filePath, {
    privateRoot,
    maxBytes,
    allowedModes: [0o600],
    label,
  });
  requireAutomationAuthoritySnapshotDirectory(snapshot, directory, label);
  return snapshot;
}

function requireOutcomeLedgerRepairBridgeInventory(
  helper,
  directory,
  { canonicalName, temporaryName, allowedEntries, label },
) {
  const entries = listPinnedAutomationAuthorityDirectory(helper, directory, {
    maxEntries: Math.max(8, allowedEntries.length + 2),
    label: `${label} directory`,
    errorCode: "outcome_ledger_repair_transaction_invalid",
  });
  const allowed = new Set([...allowedEntries, canonicalName, temporaryName]);
  if (entries.some((entry) => !allowed.has(entry))) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      `${label} directory contains a foreign entry.`,
    );
  }
  if (entries.includes(canonicalName) && entries.includes(temporaryName)) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      `${label} has both canonical and temporary generations.`,
    );
  }
  return entries;
}

function completeOutcomeLedgerRepairBridgePublication({
  filePath,
  bytes,
  privateRoot,
  maxBytes,
  allowCreate,
  allowedEntries = [],
  beforeMutation,
  label,
}) {
  const directoryPath = path.dirname(filePath);
  const canonicalName = path.basename(filePath);
  const digest = digestBytes(bytes);
  const temporaryName = `.${canonicalName}.${digest}.tmp`;
  const temporaryPath = path.join(directoryPath, temporaryName);
  const helper = openPinnedLeaseArchiveHelper();
  const directory = openPinnedLeaseArchiveDirectory(
    directoryPath,
    `${label} directory`,
  );
  try {
    requireOutcomeLedgerRepairBridgeInventory(helper, directory, {
      canonicalName,
      temporaryName,
      allowedEntries,
      label,
    });
    let canonical = outcomeLedgerRepairBridgeFileSnapshot(filePath, directory, {
      privateRoot,
      maxBytes,
      label,
    });
    let temporary = outcomeLedgerRepairBridgeFileSnapshot(
      temporaryPath,
      directory,
      { privateRoot, maxBytes, label: `${label} temporary` },
    );
    if (!canonical.missing) {
      if (!temporary.missing || !canonical.bytes.equals(bytes)) {
        throw new AutomationControlError(
          "outcome_ledger_repair_transaction_invalid",
          `${label} canonical generation is not exact.`,
        );
      }
      fsyncSync(directory.descriptor);
      assertPinnedLeaseArchiveDirectory(directory);
      return canonical;
    }
    if (!temporary.missing) {
      if (
        temporary.bytes.length > bytes.length ||
        !bytes.subarray(0, temporary.bytes.length).equals(temporary.bytes)
      ) {
        throw new AutomationControlError(
          "outcome_ledger_repair_transaction_invalid",
          `${label} temporary is not an exact successor prefix.`,
        );
      }
    } else if (!allowCreate) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        `${label} has no admitted recoverable generation.`,
      );
    }

    if (temporary.missing) {
      beforeMutation();
      let receipt = null;
      let helperError = null;
      try {
        receipt = parseAutomationAuthorityReceipt(
          runLeaseArchiveHelper(
            helper,
            "authority-stage-create",
            [
              temporaryName,
              "384",
              bytes.length.toString(),
              digest,
              ...automationAuthorityParentIdentityArguments(directory),
            ],
            [directory.descriptor],
            bytes,
          ),
          {
            operation: "authority-stage-create",
            names: { name: temporaryName },
            identityPrefixes: ["result"],
            parentPrefixes: ["parent"],
            requested: {
              requestedMode: "384",
              requestedSize: bytes.length.toString(),
              requestedDigest: digest,
            },
          },
          label,
        );
        requireAutomationAuthorityReceiptParent(
          receipt,
          "parent",
          directory,
          label,
        );
      } catch (error) {
        helperError = error;
      }
      temporary = outcomeLedgerRepairBridgeFileSnapshot(
        temporaryPath,
        directory,
        { privateRoot, maxBytes, label: `${label} temporary` },
      );
      if (temporary.missing || !temporary.bytes.equals(bytes)) {
        if (helperError !== null) throw helperError;
        throw new AutomationControlError(
          "outcome_ledger_repair_transaction_invalid",
          `${label} temporary creation did not reach exact bytes.`,
        );
      }
      if (receipt !== null) {
        requireAutomationAuthorityReceiptIdentity(
          receipt,
          "result",
          temporary,
          label,
        );
      }
    }

    let lineage = temporary;
    if (!temporary.bytes.equals(bytes)) {
      let binding;
      let receipt = null;
      let helperError = null;
      try {
        binding = openPinnedAutomationAuthorityFile(
          temporaryPath,
          temporary,
          `${label} temporary`,
          { maxBytes, allowedModes: [0o600], writable: true },
        );
        beforeMutation();
        try {
          receipt = parseAutomationAuthorityReceipt(
            runLeaseArchiveHelper(
              helper,
              "authority-stage-rewrite",
              [
                temporaryName,
                temporaryName,
                ...automationAuthorityFileIdentityArguments(binding),
                "384",
                bytes.length.toString(),
                digest,
                ...automationAuthorityParentIdentityArguments(directory),
              ],
              [directory.descriptor, binding.descriptor],
              bytes,
            ),
            {
              operation: "authority-stage-rewrite",
              names: {
                oldName: temporaryName,
                newName: temporaryName,
              },
              identityPrefixes: ["old", "result"],
              parentPrefixes: ["parent"],
              requested: {
                requestedMode: "384",
                requestedSize: bytes.length.toString(),
                requestedDigest: digest,
              },
            },
            label,
          );
          requireAutomationAuthorityReceiptIdentity(
            receipt,
            "old",
            temporary,
            label,
          );
          requireAutomationAuthorityReceiptParent(
            receipt,
            "parent",
            directory,
            label,
          );
        } catch (error) {
          helperError = error;
        }
      } finally {
        if (binding !== undefined) closeSync(binding.descriptor);
      }
      const completed = outcomeLedgerRepairBridgeFileSnapshot(
        temporaryPath,
        directory,
        { privateRoot, maxBytes, label: `${label} temporary` },
      );
      if (
        completed.missing ||
        !completed.bytes.equals(bytes) ||
        !automationAuthoritySameInode(completed, lineage)
      ) {
        if (helperError !== null) throw helperError;
        throw new AutomationControlError(
          "outcome_ledger_repair_transaction_invalid",
          `${label} temporary rewrite did not preserve its exact lineage.`,
        );
      }
      if (receipt !== null) {
        requireAutomationAuthorityReceiptIdentity(
          receipt,
          "result",
          completed,
          label,
        );
      }
      temporary = completed;
    }

    fsyncSync(directory.descriptor);
    assertPinnedLeaseArchiveDirectory(directory);
    lineage = temporary;
    let binding;
    let receipt = null;
    let helperError = null;
    try {
      binding = openPinnedAutomationAuthorityFile(
        temporaryPath,
        temporary,
        `${label} temporary`,
        { maxBytes, allowedModes: [0o600] },
      );
      beforeMutation();
      try {
        receipt = parseAutomationAuthorityReceipt(
          runLeaseArchiveHelper(
            helper,
            "authority-retire",
            [
              temporaryName,
              canonicalName,
              ...automationAuthorityFileIdentityArguments(binding),
              ...automationAuthorityParentIdentityArguments(directory),
              ...automationAuthorityParentIdentityArguments(directory),
            ],
            [directory.descriptor, directory.descriptor, binding.descriptor],
          ),
          {
            operation: "authority-retire",
            names: {
              sourceName: temporaryName,
              quarantineName: canonicalName,
            },
            identityPrefixes: ["source", "sourceAfter"],
            parentPrefixes: ["sourceParent", "quarantineParent"],
          },
          label,
        );
        requireAutomationAuthorityReceiptIdentity(
          receipt,
          "source",
          temporary,
          label,
        );
        requireAutomationAuthorityReceiptParent(
          receipt,
          "sourceParent",
          directory,
          label,
        );
        requireAutomationAuthorityReceiptParent(
          receipt,
          "quarantineParent",
          directory,
          label,
        );
      } catch (error) {
        helperError = error;
      }
    } finally {
      if (binding !== undefined) closeSync(binding.descriptor);
    }
    temporary = outcomeLedgerRepairBridgeFileSnapshot(
      temporaryPath,
      directory,
      { privateRoot, maxBytes, label: `${label} temporary` },
    );
    canonical = outcomeLedgerRepairBridgeFileSnapshot(filePath, directory, {
      privateRoot,
      maxBytes,
      label,
    });
    if (
      !temporary.missing ||
      canonical.missing ||
      !canonical.bytes.equals(bytes) ||
      !automationAuthorityStableGenerationMatches(canonical, lineage)
    ) {
      if (helperError !== null) throw helperError;
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        `${label} durable publication did not preserve its exact lineage.`,
      );
    }
    if (receipt !== null) {
      requireAutomationAuthorityReceiptIdentity(
        receipt,
        "sourceAfter",
        canonical,
        label,
      );
    }
    fsyncSync(directory.descriptor);
    assertPinnedLeaseArchiveDirectory(directory);
    return canonical;
  } finally {
    closeSync(directory.descriptor);
  }
}

function commitUncommittedPreparedToReplacedTransitionUnderFence(
  paths,
  bypass,
) {
  if (bypass.preparedResidue === null) return bypass;
  let state = requireOutcomeLedgerRepairPreparedBridgeState(paths, bypass);
  if (
    state.residue === null ||
    state.residue.filePath !== bypass.preparedResidue.filePath ||
    state.residue.archivePath !== bypass.preparedResidue.archivePath ||
    state.residue.successorDigest !== bypass.preparedResidue.successorDigest ||
    !automationAuthoritySnapshotMatches(
      state.residue.snapshot,
      bypass.preparedResidue.snapshot,
    ) ||
    (state.residue.intentTemporary === null) !==
      (bypass.preparedResidue.intentTemporary === null) ||
    (state.residue.intentTemporary !== null &&
      !automationAuthoritySnapshotMatches(
        state.residue.intentTemporary,
        bypass.preparedResidue.intentTemporary,
      ))
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair uncommitted staging changed before recovery.",
    );
  }
  const transition = outcomeLedgerRepairPreparedToReplacedPaths(state.pending);
  const retirementDirectory = openPinnedLeaseArchiveDirectory(
    transition.retirementDirectory,
    "Outcome ledger repair transaction retirement directory",
  );
  const requireRepairEventStageAdmission = () => {
    bypass.reauthorize();
    admitControlEventAuthorityStage(paths, {
      expectedPendingEvents: [bypass.preparedResidue.eventPlan.event],
    });
  };
  const requireArchiveTargetAbsent = () => {
    assertPinnedLeaseArchiveDirectory(retirementDirectory);
    const entries = listPinnedAutomationAuthorityDirectory(
      openPinnedLeaseArchiveHelper(),
      retirementDirectory,
      {
        maxEntries: AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES,
        label: "Outcome ledger repair transaction retirement directory",
        errorCode: "outcome_ledger_repair_transaction_invalid",
      },
    );
    if (entries.includes(path.basename(bypass.preparedResidue.archivePath))) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair prepared predecessor archive target is already occupied.",
      );
    }
  };
  try {
    const requireUncommittedPlan = () => {
      requireRepairEventStageAdmission();
      requireArchiveTargetAbsent();
      state = requireOutcomeLedgerRepairPreparedBridgeState(paths, bypass);
      if (
        state.residue === null ||
        state.residue.archivePath !== bypass.preparedResidue.archivePath ||
        state.residue.successorDigest !==
          bypass.preparedResidue.successorDigest ||
        !canonicalValuesEqual(
          state.residue.eventPlan,
          bypass.preparedResidue.eventPlan,
        )
      ) {
        throw new AutomationControlError(
          "outcome_ledger_repair_transaction_invalid",
          "Outcome ledger repair reconstruction inputs changed during transition recovery.",
        );
      }
    };
    requireUncommittedPlan();
    const staged = completeOutcomeLedgerRepairBridgePublication({
      filePath: transition.stagingPath,
      bytes: bypass.preparedResidue.successorBytes,
      privateRoot: paths.stateRoot,
      maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
      allowCreate: false,
      beforeMutation: requireUncommittedPlan,
      label: "Outcome ledger repair prepared-to-replaced successor",
    });
    state = requireOutcomeLedgerRepairPreparedBridgeState(paths, bypass);
    if (
      state.residue === null ||
      state.residue.filePath !== transition.stagingPath ||
      !automationAuthoritySnapshotMatches(state.residue.snapshot, staged)
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair successor changed after durable staging recovery.",
      );
    }
    const stagedAdmission = Object.freeze({
      ...staged,
      value: parseOutcomeLedgerRepairPublication(
        staged,
        "Outcome ledger repair prepared-to-replaced successor",
      ),
    });
    const publication = outcomeLedgerRepairPreparedToReplacedPublication(
      paths,
      state.pending,
      stagedAdmission,
    );
    if (
      !canonicalValuesEqual(
        publication.eventPlan,
        bypass.preparedResidue.eventPlan,
      )
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair event plan changed before intent publication.",
      );
    }
    const requireStagedPlan = () => {
      requireRepairEventStageAdmission();
      requireArchiveTargetAbsent();
      const current = requireOutcomeLedgerRepairPreparedBridgeState(
        paths,
        bypass,
      );
      if (
        current.residue === null ||
        current.residue.filePath !== transition.stagingPath ||
        !automationAuthoritySnapshotMatches(current.residue.snapshot, staged) ||
        !canonicalValuesEqual(current.residue.eventPlan, publication.eventPlan)
      ) {
        throw new AutomationControlError(
          "outcome_ledger_repair_transaction_invalid",
          "Outcome ledger repair staged successor changed before intent commit.",
        );
      }
    };
    completeOutcomeLedgerRepairBridgePublication({
      filePath: transition.intentPath,
      bytes: publication.intentBytes,
      privateRoot: paths.stateRoot,
      maxBytes: 64 * 1024,
      allowCreate: true,
      allowedEntries: [
        "ledger-replacement.json",
        "transaction-fenced-to-prepared.json",
      ],
      beforeMutation: requireStagedPlan,
      label: "Outcome ledger repair prepared-to-replaced publication intent",
    });
    const committedPending = inspectOutcomeLedgerRepairPendingFence(paths);
    if (
      committedPending === null ||
      !automationAuthoritySnapshotMatches(
        committedPending.snapshot,
        bypass.pendingSnapshot,
      ) ||
      !canonicalValuesEqual(
        outcomeLedgerRepairPublicationIdentity(
          committedPending.transactionPath,
          committedPending.snapshot,
        ),
        bypass.pendingPublicationIdentity,
      )
    ) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair predecessor changed after intent commit.",
      );
    }
    const committedPlan = readCommittedOutcomeLedgerRepairEventPlan(
      paths,
      committedPending,
    );
    if (!canonicalValuesEqual(committedPlan, publication.eventPlan)) {
      throw new AutomationControlError(
        "outcome_ledger_repair_transaction_invalid",
        "Outcome ledger repair committed a different prepared transition plan.",
      );
    }
    return {
      ...bypass,
      eventPlan: committedPlan,
      preparedResidue: null,
    };
  } finally {
    closeSync(retirementDirectory.descriptor);
  }
}

function requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard) {
  const active = requireActiveAutomationEventsGuard(eventsGuard);
  if (active.stateRoot !== paths.stateRoot) {
    throw new AutomationControlError(
      "invalid_state",
      "Automation events guard belongs to a different state root.",
    );
  }
  const pending = inspectOutcomeLedgerRepairPendingFence(paths);
  if (pending === null) return null;
  const bypass = active.outcomeRepairBypass;
  if (
    bypass?.kind === "outcome-ledger-repair" &&
    bypass.taskId === pending.taskId &&
    bypass.operationId === pending.operationId &&
    bypass.intentDigest === pending.intentDigest
  ) {
    return pending;
  }
  const ownerLeaseBypass = OUTCOME_REPAIR_OWNER_LEASE_BYPASSES.get(active);
  if (
    ownerLeaseBypass?.kind === "owner-governance-lease-lifecycle" &&
    ownerLeaseBypass.taskId === pending.taskId &&
    ownerLeaseBypass.repairOperationId === pending.operationId &&
    ownerLeaseBypass.intentDigest === pending.intentDigest &&
    ownerLeaseBypass.leaseName === "owner-governance" &&
    ["acquire", "heartbeat", "release"].includes(
      ownerLeaseBypass.leaseOperation,
    )
  ) {
    return pending;
  }
  throw new AutomationControlError(
    "outcome_ledger_repair_pending",
    `Outcome ledger repair ${pending.operationId} fences control-plane mutation until exact recovery completes.`,
    {
      operationId: pending.operationId,
      taskId: pending.taskId,
      phase: pending.phase,
    },
  );
}

function requireExactOwnerLeaseTransactionRequest(transaction, operation) {
  if (
    transaction.name !== operation.name ||
    transaction.operation !== operation.leaseOperation ||
    transaction.operationId !== operation.operationId ||
    !canonicalValuesEqual(transaction.request, operation.request) ||
    transaction.requestDigest !== operation.requestDigest ||
    transaction.tokenDigest !== secretDigest(operation.token)
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease operation ${operation.operationId} does not match its exact recoverable request.`,
    );
  }
  const lease = transaction.resultReceipt?.lease;
  const ownerTaskId =
    lease?.ownerCapabilityTaskId ?? lease?.ownerConfirmationTaskId;
  const ownerIntentDigest =
    lease?.ownerCapabilityIntentDigest ?? lease?.ownerConfirmationIntentDigest;
  if (
    lease?.owner !== "freed-owner" ||
    lease?.name !== "owner-governance" ||
    ownerTaskId !== operation.pending.taskId ||
    ownerIntentDigest !== operation.pending.intentDigest
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_pending",
      "Only the exact owner-governance lease for the pending repair may recover while the repair fence is active.",
      {
        operationId: operation.pending.operationId,
        taskId: operation.pending.taskId,
      },
    );
  }
  return transaction;
}

function requireReadOnlyLeaseRecoveryState(paths, transaction, eventsGuard) {
  const records =
    transaction.phase === "complete"
      ? (validateCompletedLeaseReceiptStaging(paths, transaction), null)
      : validateLeaseStaging(paths, transaction);
  const current = readLeaseStateSnapshot(paths, transaction.name);
  const matchesBefore = leaseStateMatches(
    current.descriptor,
    transaction.before,
  );
  const matchesAfter = leaseStateMatches(current.descriptor, transaction.after);
  const matchedEvent = matchingLeaseEventUnlocked(paths, transaction);
  const exactEmptyAcquireIntermediate =
    transaction.phase === "prepared" &&
    transaction.operation === "acquire" &&
    transaction.before.directoryExists === false &&
    current.descriptor.directoryExists === true &&
    current.descriptor.recordDigest === null;
  if (
    (transaction.phase === "prepared" &&
      !matchesBefore &&
      !matchesAfter &&
      !exactEmptyAcquireIntermediate) ||
    (["state-committed", "event-appended", "complete"].includes(
      transaction.phase,
    ) &&
      !matchesAfter) ||
    (transaction.phase === "prepared" && matchedEvent.event !== null) ||
    (["event-appended", "complete"].includes(transaction.phase) &&
      matchedEvent.event === null)
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease operation ${transaction.operationId} does not retain exact state and audit recovery lineage.`,
    );
  }
  requireActiveLeaseEventsGuard(eventsGuard);
  return records;
}

function readExactOwnerLeaseRecoveryEvidence(paths, eventsGuard, operation) {
  const directories = leaseTransactionDirectories(paths);
  const activePath = path.join(
    directories.transactions,
    `${operation.name}.json`,
  );
  const active = readLeaseTransactionFile(activePath, paths, operation.name);
  if (active !== null) {
    requireExactOwnerLeaseTransactionRequest(active, operation);
    requireReadOnlyLeaseRecoveryState(paths, active, eventsGuard);
    return active;
  }

  const predecessor = readLeaseStateSnapshot(paths, operation.name).descriptor;
  const temporaryPath = leaseAtomicTemporaryPath(activePath, {
    ...operation,
    predecessor,
  });
  if (pathEntryExists(temporaryPath)) {
    const temporaryBytes = readPrivateBytes(
      temporaryPath,
      "Lease active WAL temporary file",
      {
        allowEmpty: true,
        privateRoot: paths.controlRoot,
        requireUtf8: false,
      },
    );
    let temporary;
    try {
      temporary = parseLeaseTransactionBytes(
        temporaryBytes,
        paths,
        operation.name,
      );
    } catch {
      return null;
    }
    if (!temporaryBytes.equals(privateJsonBytes(temporary))) return null;
    requireExactOwnerLeaseTransactionRequest(temporary, operation);
    if (temporary.phase !== "prepared") {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease operation ${operation.operationId} has a non-prepared WAL temporary.`,
      );
    }
    validateLeaseStaging(paths, temporary);
    const current = readLeaseStateSnapshot(paths, operation.name);
    const matchedEvent = matchingLeaseEventUnlocked(paths, temporary);
    if (
      !leaseStateMatches(current.descriptor, temporary.before) ||
      matchedEvent.event !== null
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease operation ${operation.operationId} WAL temporary lost its exact before-state lineage.`,
      );
    }
    return temporary;
  }

  const completed = readCompletedLeaseReceipt(
    paths,
    operation.name,
    operation.leaseOperation,
    operation.operationId,
  );
  if (completed === null) return null;
  try {
    requireExactOwnerLeaseTransactionRequest(completed.transaction, operation);
    verifyCompletedLeaseReceipt(
      paths,
      completed.transaction,
      eventsGuard,
      completed.binding,
    );
    return completed.transaction;
  } finally {
    closeSync(completed.binding.descriptor);
  }
}

function requireCurrentOwnerLeaseForPendingRepair(paths, operation) {
  const current = readLeaseStateSnapshot(paths, operation.name);
  const record = current.record;
  if (record === null) {
    throw new AutomationControlError(
      "outcome_ledger_repair_pending",
      "Pending repair lease recovery requires its exact owner-governance lease or recoverable transaction.",
      { operationId: operation.pending.operationId },
    );
  }
  validateLeaseRecord(record, operation.name);
  const ownerTaskId =
    record.ownerCapabilityTaskId ?? record.ownerConfirmationTaskId;
  const ownerIntentDigest =
    record.ownerCapabilityIntentDigest ?? record.ownerConfirmationIntentDigest;
  if (
    record.name !== "owner-governance" ||
    record.owner !== "freed-owner" ||
    record.token !== operation.token ||
    ownerTaskId !== operation.pending.taskId ||
    ownerIntentDigest !== operation.pending.intentDigest ||
    Date.parse(record.expiresAt) <= Date.now()
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_pending",
      "Pending repair lease recovery does not match its owner, token, task, and intent.",
      {
        operationId: operation.pending.operationId,
        taskId: operation.pending.taskId,
      },
    );
  }
  return record;
}

function completeOutcomeLedgerRepairEventBeforeOwnerLeaseLifecycle(
  paths,
  eventsGuard,
  bypass,
) {
  if (bypass.eventPlan === null) return;
  bypass.reauthorize();
  const pending = inspectOutcomeLedgerRepairPendingFence(paths);
  if (
    pending === null ||
    pending.taskId !== bypass.taskId ||
    pending.operationId !== bypass.repairOperationId ||
    pending.intentDigest !== bypass.intentDigest
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair changed before owner lifecycle recovery.",
    );
  }
  const committedPlan = readCommittedOutcomeLedgerRepairEventPlan(
    paths,
    pending,
  );
  if (!canonicalValuesEqual(committedPlan, bypass.eventPlan)) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Outcome ledger repair event plan changed before owner lifecycle recovery.",
    );
  }
  requireOutcomeLedgerRepairReplacement(paths, pending.parameters);
  const event = committedPlan.event;
  const snapshot = readControlEventHistorySnapshot(paths.events);
  const matches = snapshot.events.filter(
    (candidate) => candidate?.eventId === event.eventId,
  );
  if (matches.length === 1) {
    if (!canonicalValuesEqual(matches[0], event)) {
      throw new AutomationControlError(
        "control_event_conflict",
        `Control event ${event.eventId} conflicts with the committed repair plan.`,
      );
    }
    return;
  }
  if (matches.length !== 0) {
    throw new AutomationControlError(
      "control_event_duplicate",
      `Control event history contains duplicate event ${event.eventId}.`,
    );
  }
  appendEventLineUnlocked(paths, event, snapshot, {
    eventsGuard,
    beforeRename: () => {
      bypass.reauthorize();
      const current = inspectOutcomeLedgerRepairPendingFence(paths);
      const currentPlan =
        current === null
          ? null
          : readCommittedOutcomeLedgerRepairEventPlan(paths, current);
      if (
        current === null ||
        current.operationId !== bypass.repairOperationId ||
        !canonicalValuesEqual(currentPlan, bypass.eventPlan)
      ) {
        throw new AutomationControlError(
          "outcome_ledger_repair_transaction_invalid",
          "Outcome ledger repair changed during owner lifecycle recovery.",
        );
      }
      requireOutcomeLedgerRepairReplacement(paths, current.parameters);
    },
  });
}

function requireFreshOwnerAcquireForPendingRepair(paths, operation) {
  if (
    operation.owner !== "freed-owner" ||
    operation.name !== "owner-governance" ||
    operation.ownerCapabilityTaskId !== operation.pending.taskId ||
    operation.ownerCapabilityIntentDigest !== operation.pending.intentDigest
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_pending",
      "A fresh lease during repair must carry exact same-task owner authority for the pending intent.",
      {
        operationId: operation.pending.operationId,
        taskId: operation.pending.taskId,
      },
    );
  }
  const nowMs = Date.now();
  if (operation.ownerCapabilityFile !== undefined) {
    readAndValidateOwnerCapability({
      paths,
      capabilityFile: operation.ownerCapabilityFile,
      taskId: operation.pending.taskId,
      intentDigest: operation.pending.intentDigest,
      leaseToken: operation.token,
      ttlMs: operation.ttlMs,
      nowMs,
    });
    return;
  }
  if (operation.ownerConfirmationFile !== undefined) {
    readAndValidateOwnerConfirmation({
      confirmationFile: operation.ownerConfirmationFile,
      taskId: operation.pending.taskId,
      intentDigest: operation.pending.intentDigest,
      ttlMs: operation.ttlMs,
      nowMs,
    });
    return;
  }
  throw new AutomationControlError(
    "outcome_ledger_repair_pending",
    "A fresh owner lease during repair requires exact owner authority for the pending task and intent.",
    { operationId: operation.pending.operationId },
  );
}

function authorizeOwnerLeaseLifecycleOutcomeRepairBypass(
  paths,
  eventsGuard,
  operation,
) {
  const pending = inspectOutcomeLedgerRepairPendingFence(paths);
  if (pending === null) return null;
  if (
    operation?.name !== "owner-governance" ||
    !["acquire", "heartbeat", "release"].includes(operation?.leaseOperation)
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_pending",
      `Outcome ledger repair ${pending.operationId} fences unrelated lease mutation.`,
      {
        operationId: pending.operationId,
        taskId: pending.taskId,
        leaseName: operation?.name ?? null,
      },
    );
  }
  const scopedOperation = Object.freeze({ ...operation, pending });
  const recovered = readExactOwnerLeaseRecoveryEvidence(
    paths,
    eventsGuard,
    scopedOperation,
  );
  let reauthorize;
  if (recovered === null) {
    if (operation.leaseOperation === "acquire") {
      requireFreshOwnerAcquireForPendingRepair(paths, scopedOperation);
      reauthorize = () =>
        requireFreshOwnerAcquireForPendingRepair(paths, scopedOperation);
    } else {
      requireCurrentOwnerLeaseForPendingRepair(paths, scopedOperation);
      reauthorize = () =>
        requireCurrentOwnerLeaseForPendingRepair(paths, scopedOperation);
    }
  } else {
    reauthorize = () => {
      if (
        readExactOwnerLeaseRecoveryEvidence(
          paths,
          eventsGuard,
          scopedOperation,
        ) === null
      ) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          "Recoverable owner lease operation changed during repair event completion.",
        );
      }
    };
  }
  const eventPlan = readCommittedOutcomeLedgerRepairEventPlan(paths, pending);
  const preparedResidue =
    eventPlan === null
      ? inspectUncommittedPreparedToReplacedResidue(paths, pending)
      : null;
  return {
    kind: "owner-governance-lease-lifecycle",
    taskId: pending.taskId,
    repairOperationId: pending.operationId,
    intentDigest: pending.intentDigest,
    leaseName: operation.name,
    leaseOperation: operation.leaseOperation,
    leaseOperationId: operation.operationId,
    requestDigest: operation.requestDigest,
    tokenDigest: secretDigest(operation.token),
    eventPlan,
    preparedResidue,
    pendingPublicationIdentity: outcomeLedgerRepairPublicationIdentity(
      pending.transactionPath,
      pending.snapshot,
    ),
    pendingSnapshot: pending.snapshot,
    reauthorize,
  };
}

function requireOutcomeLedgerRepairReplacement(paths, parameters) {
  const snapshot = readAutomationAuthorityFileSnapshot(paths.outcomes, {
    privateRoot: paths.stateRoot,
    allowEmpty: true,
    maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
    allowedModes: [0o600],
    label: "Canonical outcome ledger replacement",
    invalidCode: "outcome_ledger_repair_transaction_invalid",
  });
  const digest = digestBytes(snapshot.bytes);
  if (
    snapshot.bytes.length !== parameters.replacementSize ||
    digest !== parameters.replacementDigest
  ) {
    throw new AutomationControlError(
      "outcome_ledger_repair_transaction_invalid",
      "Canonical outcome ledger does not match the transaction replacement.",
    );
  }
  return snapshot;
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
  const authority = outcomeLedgerRepairAuthority(options, normalizedParameters);
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    options.authorityContext ?? null,
    (authorityContext) => {
      const scopedOptions = {
        ...options,
        parameters: normalizedParameters,
        authorityContext,
      };
      const paths = automationControlPaths(options.stateRoot);
      const outcomeRepairBypass = Object.freeze({
        kind: "outcome-ledger-repair",
        taskId: options.taskId,
        operationId: normalizedParameters.operationId,
        intentDigest: authority.ownerIntentDigest,
      });
      return withFilesystemGuard(paths, "tasks", () =>
        withActiveAutomationEventsGuard(
          paths,
          (eventsGuard) => {
            authorityContext.reauthorize();
            requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
            preauthorizeOutcomeLedgerRepairFromHeldTaskSnapshot(
              scopedOptions,
              paths,
              authorityContext,
            );
            return preflightOutcomeLedgerRepairEventUnlocked(
              scopedOptions,
              paths,
            );
          },
          { outcomeRepairBypass },
        ),
      );
    },
  );
}

function requireNoPendingTransactionFamily(paths) {
  const inspectDirectory = (directoryPath, allowedDirectoryNames, label) => {
    if (!pathEntryExists(directoryPath)) return;
    const directory = openPinnedLeaseArchiveDirectory(directoryPath, label);
    try {
      const names = listPinnedAutomationAuthorityDirectory(
        openPinnedLeaseArchiveHelper(),
        directory,
        {
          maxEntries: AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES,
          label,
          errorCode: "transaction_conflict",
        },
      );
      const pending = names.filter(
        (name) => !allowedDirectoryNames.includes(name),
      );
      if (pending.length > 0) {
        throw new AutomationControlError(
          "transaction_conflict",
          `${label} must be settled before outcome ledger repair fencing.`,
          { pending },
        );
      }
    } finally {
      closeSync(directory.descriptor);
    }
  };
  inspectDirectory(
    paths.taskTransactions,
    [AUTHORITY_RETIREMENT_DIRECTORY],
    "Task transaction directory",
  );
  inspectDirectory(
    leaseTransactionDirectories(paths).transactions,
    [LEASE_CLEANUP_QUARANTINE_DIRECTORY],
    "Lease transaction directory",
  );
}

function retireUncommittedOutcomeRepairFenceStaging(
  paths,
  beforeMutation = () => {},
) {
  const directoryPath = path.join(
    paths.controlRoot,
    "outcome-ledger-transactions",
  );
  if (!pathEntryExists(directoryPath)) return;
  const directory = openPinnedLeaseArchiveDirectory(
    directoryPath,
    "Outcome ledger repair transaction directory",
  );
  try {
    const names = listPinnedAutomationAuthorityDirectory(
      openPinnedLeaseArchiveHelper(),
      directory,
      {
        maxEntries: AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES,
        label: "Outcome ledger repair transaction directory",
        errorCode: "outcome_ledger_repair_transaction_invalid",
      },
    );
    for (const name of names) {
      if (!OUTCOME_REPAIR_TRANSACTION_TEMP_NAME_PATTERN.test(name)) continue;
      if (!name.startsWith(".pending.json.")) continue;
      const filePath = path.join(directoryPath, name);
      const snapshot = readAutomationAuthorityFileSnapshotInternal(filePath, {
        allowEmpty: true,
        privateRoot: paths.controlRoot,
        maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
        allowedModes: [0o600],
        label: "Uncommitted outcome ledger repair fence staging",
      });
      beforeMutation();
      removeAutomationAuthorityFile({
        filePath,
        snapshot,
        operationId: `outcome-ledger-repair-pre-fence-retire:${snapshot.digest}`,
        privateRoot: paths.controlRoot,
        maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
        allowedModes: [0o600],
        label: "Uncommitted outcome ledger repair fence staging",
        retirementBasename: name,
        rawSource: true,
        beforeRemove: beforeMutation,
      });
    }
  } finally {
    closeSync(directory.descriptor);
  }
}

export function withOutcomeLedgerRepairFenceCreationGuard(options, callback) {
  if (typeof callback !== "function") {
    throw new AutomationControlError(
      "invalid_argument",
      "Outcome ledger repair fence creation requires a callback.",
    );
  }
  const paths = automationControlPaths(options.stateRoot);
  const writerGuardContext = options.writerGuardContext;
  if (
    !ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS.has(writerGuardContext) ||
    writerGuardContext.stateRoot !== paths.stateRoot ||
    writerGuardContext.ledgerPath !== paths.outcomes
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Outcome ledger repair fencing requires its active same-root writer guard.",
    );
  }
  writerGuardContext.requireActive();
  const normalizedParameters = normalizeOutcomeLedgerRepairParameters(
    options.parameters,
    paths.stateRoot,
    options.taskId,
  );
  const authority = outcomeLedgerRepairAuthority(options, normalizedParameters);
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    options.authorityContext ?? null,
    (authorityContext) => {
      const scopedOptions = {
        ...options,
        parameters: normalizedParameters,
        authorityContext,
      };
      const outcomeRepairBypass = Object.freeze({
        kind: "outcome-ledger-repair",
        taskId: options.taskId,
        operationId: normalizedParameters.operationId,
        intentDigest: authority.ownerIntentDigest,
      });
      return withFilesystemGuard(paths, "tasks", () =>
        withActiveAutomationEventsGuard(
          paths,
          (eventsGuard) => {
            const admitFenceMutation = () => {
              writerGuardContext.requireActive();
              authorityContext.reauthorize();
              admitControlEventAuthorityStage(paths);
            };
            writerGuardContext.requireActive();
            authorityContext.reauthorize();
            preauthorizeOutcomeLedgerRepairFromHeldTaskSnapshot(
              scopedOptions,
              paths,
              authorityContext,
            );
            requireNoPendingTransactionFamily(paths);
            const currentTask = readTaskManifestSnapshotUnchecked({
              stateRoot: paths.stateRoot,
              nowMs: Date.now(),
            }).manifest.tasks.filter((task) => task?.taskId === options.taskId);
            if (
              currentTask.length !== 1 ||
              currentTask[0].revision !== options.taskRevision ||
              currentTask[0].state !== options.taskState
            ) {
              throw new AutomationControlError(
                "outcome_ledger_repair_transaction_invalid",
                "Outcome ledger repair task generation changed before fencing.",
              );
            }
            const eventPreflight = preflightOutcomeLedgerRepairEventUnlocked(
              scopedOptions,
              paths,
            );
            if (eventPreflight.existing) {
              throw new AutomationControlError(
                "outcome_ledger_repair_transaction_invalid",
                "Outcome ledger repair audit event exists before its mutation fence.",
              );
            }
            const pendingBefore = inspectOutcomeLedgerRepairPendingFence(paths);
            if (pendingBefore !== null) {
              throw new AutomationControlError(
                "outcome_ledger_repair_pending",
                "Outcome ledger repair fence already exists.",
                { operationId: pendingBefore.operationId },
              );
            }
            admitFenceMutation();
            retireUncommittedOutcomeRepairFenceStaging(
              paths,
              admitFenceMutation,
            );
            const completedPath = outcomeLedgerRepairTransactionIdentity(
              paths,
              options.taskId,
              normalizedParameters,
            ).completedTransactionPath;
            if (pathEntryExists(completedPath)) {
              throw new AutomationControlError(
                "outcome_ledger_repair_transaction_invalid",
                "Completed outcome ledger repair identity already exists before fencing.",
              );
            }
            const finalEventPreflight =
              preflightOutcomeLedgerRepairEventUnlocked(scopedOptions, paths);
            if (finalEventPreflight.existing) {
              throw new AutomationControlError(
                "outcome_ledger_repair_transaction_invalid",
                "Outcome ledger repair audit event exists immediately before fencing.",
              );
            }
            admitFenceMutation();
            const result = callback({
              beforeFenceMutation: admitFenceMutation,
            });
            if (result && typeof result.then === "function") {
              throw new AutomationControlError(
                "invalid_argument",
                "Outcome ledger repair fence creation callback must be synchronous.",
              );
            }
            const pendingAfter = requireOutcomeLedgerRepairFenceAllowsMutation(
              paths,
              eventsGuard,
            );
            if (
              pendingAfter === null ||
              pendingAfter.phase !== "fenced" ||
              pendingAfter.operationId !== normalizedParameters.operationId ||
              pendingAfter.taskId !== options.taskId ||
              pendingAfter.intentDigest !== authority.ownerIntentDigest
            ) {
              throw new AutomationControlError(
                "outcome_ledger_repair_transaction_invalid",
                "Outcome ledger repair fence publication did not produce its exact canonical transaction.",
              );
            }
            return result;
          },
          { outcomeRepairBypass },
        ),
      );
    },
  );
}

export function withOutcomeLedgerRepairRetirementGuard(options, callback) {
  if (typeof callback !== "function") {
    throw new AutomationControlError(
      "invalid_argument",
      "Outcome ledger repair retirement requires a callback.",
    );
  }
  const paths = automationControlPaths(options.stateRoot);
  const writerGuardContext = options.writerGuardContext;
  if (
    !ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS.has(writerGuardContext) ||
    writerGuardContext.stateRoot !== paths.stateRoot ||
    writerGuardContext.ledgerPath !== paths.outcomes
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Outcome ledger repair retirement requires its active same-root writer guard.",
    );
  }
  writerGuardContext.requireActive();
  const normalizedParameters = normalizeOutcomeLedgerRepairParameters(
    options.parameters,
    paths.stateRoot,
    options.taskId,
  );
  const authority = outcomeLedgerRepairAuthority(options, normalizedParameters);
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    options.authorityContext ?? null,
    (authorityContext) => {
      const scopedOptions = {
        ...options,
        parameters: normalizedParameters,
        authorityContext,
      };
      const outcomeRepairBypass = Object.freeze({
        kind: "outcome-ledger-repair",
        taskId: options.taskId,
        operationId: normalizedParameters.operationId,
        intentDigest: authority.ownerIntentDigest,
      });
      return withFilesystemGuard(paths, "tasks", () =>
        withActiveAutomationEventsGuard(
          paths,
          (eventsGuard) => {
            const admitRetirementMutation = () => {
              writerGuardContext.requireActive();
              authorityContext.reauthorize();
              admitControlEventAuthorityStage(paths);
            };
            writerGuardContext.requireActive();
            authorityContext.reauthorize();
            const pending = requireOutcomeLedgerRepairFenceAllowsMutation(
              paths,
              eventsGuard,
            );
            preauthorizeOutcomeLedgerRepairFromHeldTaskSnapshot(
              scopedOptions,
              paths,
              authorityContext,
            );
            if (pending?.phase !== "complete") {
              throw new AutomationControlError(
                "outcome_ledger_repair_transaction_invalid",
                "Outcome ledger repair retirement requires its complete pending transaction.",
              );
            }
            const identity = outcomeLedgerRepairTransactionIdentity(
              paths,
              options.taskId,
              normalizedParameters,
            );
            const admittedBefore = validateOutcomeLedgerRepairTransaction(
              paths,
              {
                taskId: options.taskId,
                parameters: normalizedParameters,
                intentDigest: authority.ownerIntentDigest,
                transactionPath: identity.transactionPath,
                allowedPhases: ["complete"],
              },
            ).snapshot;
            admitRetirementMutation();
            const result = callback({
              beforeRetirementMutation: admitRetirementMutation,
            });
            if (result && typeof result.then === "function") {
              throw new AutomationControlError(
                "invalid_argument",
                "Outcome ledger repair retirement callback must be synchronous.",
              );
            }
            if (pathEntryExists(identity.transactionPath)) {
              throw new AutomationControlError(
                "outcome_ledger_repair_transaction_invalid",
                "Complete outcome ledger repair remains pending after retirement.",
              );
            }
            const completed = readPrivateJsonSnapshot(
              identity.completedTransactionPath,
              "Completed outcome ledger repair transaction",
              {
                privateRoot: paths.controlRoot,
                maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
                invalidCode: "outcome_ledger_repair_transaction_invalid",
              },
            );
            if (
              !completed.bytes.equals(admittedBefore.bytes) ||
              completed.identity.dev !== admittedBefore.identity.dev ||
              completed.identity.ino !== admittedBefore.identity.ino
            ) {
              throw new AutomationControlError(
                "outcome_ledger_repair_transaction_invalid",
                "Completed outcome ledger repair retirement changed generation.",
              );
            }
            return result;
          },
          { outcomeRepairBypass },
        ),
      );
    },
  );
}

export function withOutcomeLedgerRepairFinalizationGuard(options, callback) {
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
  const authority = outcomeLedgerRepairAuthority(options, normalizedParameters);
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    options.authorityContext ?? null,
    (authorityContext) => {
      const scopedOptions = {
        ...options,
        parameters: normalizedParameters,
        authorityContext,
      };
      const paths = automationControlPaths(options.stateRoot);
      const outcomeRepairBypass = Object.freeze({
        kind: "outcome-ledger-repair",
        taskId: options.taskId,
        operationId: normalizedParameters.operationId,
        intentDigest: authority.ownerIntentDigest,
      });
      return withFilesystemGuard(paths, "tasks", () =>
        withActiveAutomationEventsGuard(
          paths,
          (eventsGuard) => {
            authorityContext.reauthorize();
            requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
            preauthorizeOutcomeLedgerRepairFromHeldTaskSnapshot(
              scopedOptions,
              paths,
              authorityContext,
            );
            const transactionOptions = {
              taskId: options.taskId,
              parameters: normalizedParameters,
              intentDigest: authority.ownerIntentDigest,
              transactionPath: options.transactionPath,
            };
            let active = true;
            let provisionalEventPlan = null;
            const requireActive = () => {
              if (!active) {
                throw new AutomationControlError(
                  "invalid_state",
                  "Outcome ledger repair finalization guard scope is no longer active.",
                );
              }
            };
            const admitFinalizationMutation = () => {
              requireActive();
              authorityContext.reauthorize();
              const validated = validateOutcomeLedgerRepairTransaction(paths, {
                ...transactionOptions,
                allowedPhases: ["prepared", "replaced", "audited", "complete"],
              });
              if (
                validated.record.phase === "prepared" &&
                provisionalEventPlan !== null
              ) {
                const provisionalRecord = {
                  ...validated.record,
                  phase: "replaced",
                  eventPlan: provisionalEventPlan,
                };
                validateOutcomeLedgerRepairTransaction(paths, {
                  ...transactionOptions,
                  allowedPhases: ["replaced"],
                  admittedSnapshot: {
                    value: provisionalRecord,
                    bytes: privateJsonBytes(provisionalRecord),
                    identity: validated.snapshot.identity,
                  },
                });
              }
              const expectedPendingEvents = [];
              const committedPreparedPlan =
                validated.record.phase === "prepared"
                  ? readCommittedOutcomeLedgerRepairEventPlan(
                      paths,
                      inspectOutcomeLedgerRepairPendingFence(paths),
                    )
                  : null;
              if (
                validated.record.phase === "replaced" ||
                committedPreparedPlan !== null
              ) {
                requireOutcomeLedgerRepairReplacement(
                  paths,
                  normalizedParameters,
                );
                const plannedEvent =
                  committedPreparedPlan?.event ??
                  validated.record.eventPlan.event;
                const matches = readControlEventHistorySnapshot(
                  paths.events,
                ).events.filter(
                  (event) => event?.eventId === plannedEvent.eventId,
                );
                if (matches.length === 0) {
                  expectedPendingEvents.push(plannedEvent);
                }
              }
              if (["audited", "complete"].includes(validated.record.phase)) {
                requireOutcomeLedgerRepairReplacement(
                  paths,
                  normalizedParameters,
                );
                const matches = readControlEventHistorySnapshot(
                  paths.events,
                ).events.filter(
                  (event) =>
                    event?.eventId === validated.record.eventPlan.event.eventId,
                );
                if (matches.length !== 1) {
                  throw new AutomationControlError(
                    "outcome_ledger_repair_transaction_invalid",
                    "Audited outcome ledger repair transaction is missing its exact control event.",
                  );
                }
              }
              admitControlEventAuthorityStage(paths, {
                expectedPendingEvents,
              });
              return validated.record;
            };
            const requireReplaced = () => {
              const record = admitFinalizationMutation();
              if (record.phase !== "replaced") {
                throw new AutomationControlError(
                  "outcome_ledger_repair_transaction_invalid",
                  "Outcome ledger repair event publication requires its replaced transaction phase.",
                );
              }
              requireOutcomeLedgerRepairReplacement(
                paths,
                normalizedParameters,
              );
              return record;
            };
            const bindRepairEventPlan = () => {
              const record = admitFinalizationMutation();
              if (record.phase !== "prepared" || record.eventPlan !== null) {
                throw new AutomationControlError(
                  "outcome_ledger_repair_transaction_invalid",
                  "Outcome ledger repair event planning requires its exact prepared transaction.",
                );
              }
              const replacement = requireOutcomeLedgerRepairReplacement(
                paths,
                normalizedParameters,
              );
              const preflight = preflightOutcomeLedgerRepairEventUnlocked(
                scopedOptions,
                paths,
              );
              if (preflight.existing) {
                throw new AutomationControlError(
                  "outcome_ledger_repair_transaction_invalid",
                  "Outcome ledger repair event exists before its replaced transaction binds the event plan.",
                );
              }
              provisionalEventPlan = orderedOutcomeLedgerRepairEventPlan({
                event: preflight.event,
                historyDigest: preflight.historyDigest,
                historyGeneration: preflight.historyGeneration,
                historyParent: preflight.historyParent,
                historyRecordCount: preflight.historyRecordCount,
                historySize: preflight.historySize,
                replacementGeneration:
                  automationAuthoritySnapshotDescriptor(replacement),
                replacementParent: structuredClone(
                  replacement.directoryIdentity,
                ),
                stageNamespace: preflight.stageNamespace,
              });
              return structuredClone(provisionalEventPlan);
            };
            try {
              admitFinalizationMutation();
              const result = callback({
                beforeFinalizationMutation: admitFinalizationMutation,
                committedRepairEventPlan: () => {
                  requireActive();
                  authorityContext.reauthorize();
                  const pending = inspectOutcomeLedgerRepairPendingFence(paths);
                  if (
                    pending === null ||
                    pending.taskId !== options.taskId ||
                    pending.operationId !== normalizedParameters.operationId ||
                    pending.intentDigest !== authority.ownerIntentDigest
                  ) {
                    throw new AutomationControlError(
                      "outcome_ledger_repair_transaction_invalid",
                      "Outcome ledger repair changed while resolving its committed event plan.",
                    );
                  }
                  const eventPlan = readCommittedOutcomeLedgerRepairEventPlan(
                    paths,
                    pending,
                  );
                  return eventPlan === null ? null : structuredClone(eventPlan);
                },
                reconstructPreparedRepairEventPlan: () => {
                  requireActive();
                  authorityContext.reauthorize();
                  const pending = inspectOutcomeLedgerRepairPendingFence(paths);
                  if (
                    pending === null ||
                    pending.phase !== "prepared" ||
                    pending.taskId !== options.taskId ||
                    pending.operationId !== normalizedParameters.operationId ||
                    pending.intentDigest !== authority.ownerIntentDigest
                  ) {
                    throw new AutomationControlError(
                      "outcome_ledger_repair_transaction_invalid",
                      "Outcome ledger repair cannot reconstruct a different prepared transaction.",
                    );
                  }
                  return structuredClone(
                    reconstructOutcomeLedgerRepairEventPlan(paths, pending),
                  );
                },
                bindRepairEventPlan,
                preflightRepairEvent: () => {
                  requireActive();
                  authorityContext.reauthorize();
                  const validated = validateOutcomeLedgerRepairTransaction(
                    paths,
                    {
                      ...transactionOptions,
                      allowedPhases: ["prepared", "replaced", "audited"],
                    },
                  );
                  if (validated.record.phase !== "prepared") {
                    const matches = readControlEventHistorySnapshot(
                      paths.events,
                    ).events.filter(
                      (event) =>
                        event?.eventId ===
                        validated.record.eventPlan.event.eventId,
                    );
                    return {
                      existing: matches.length === 1,
                      event: structuredClone(validated.record.eventPlan.event),
                      historyDigest: validated.record.eventPlan.historyDigest,
                      historyGeneration:
                        validated.record.eventPlan.historyGeneration,
                      historyParent: validated.record.eventPlan.historyParent,
                      historyRecordCount:
                        validated.record.eventPlan.historyRecordCount,
                      historySize: validated.record.eventPlan.historySize,
                      replacementGeneration:
                        validated.record.eventPlan.replacementGeneration,
                      replacementParent:
                        validated.record.eventPlan.replacementParent,
                      stageNamespace: validated.record.eventPlan.stageNamespace,
                    };
                  }
                  return preflightOutcomeLedgerRepairEventUnlocked(
                    scopedOptions,
                    paths,
                  );
                },
                appendRepairEvent: () => {
                  const record = requireReplaced();
                  const event = record.eventPlan.event;
                  const snapshot = readControlEventHistorySnapshot(
                    paths.events,
                  );
                  const matches = snapshot.events.filter(
                    (candidate) => candidate?.eventId === event.eventId,
                  );
                  if (matches.length === 1) {
                    if (!canonicalValuesEqual(matches[0], event)) {
                      throw new AutomationControlError(
                        "control_event_conflict",
                        `Control event ${event.eventId} conflicts with the bound repair plan.`,
                        { eventId: event.eventId },
                      );
                    }
                    admitControlEventAuthorityStage(paths);
                    return structuredClone(matches[0]);
                  }
                  if (matches.length !== 0) {
                    throw new AutomationControlError(
                      "control_event_duplicate",
                      `Control event history contains duplicate event ${event.eventId}.`,
                    );
                  }
                  appendEventLineUnlocked(paths, event, snapshot, {
                    beforeRename: requireReplaced,
                    eventsGuard,
                  });
                  return structuredClone(event);
                },
              });
              if (result && typeof result.then === "function") {
                throw new AutomationControlError(
                  "invalid_argument",
                  "Outcome ledger repair finalization guard callback must be synchronous.",
                );
              }
              admitFinalizationMutation();
              return result;
            } finally {
              active = false;
            }
          },
          { outcomeRepairBypass },
        ),
      );
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

const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OUTCOME_EVIDENCE_DIGEST_PATTERN = /^[0-9a-f]{40,64}$/;
const PINNED_LEGACY_TASK_CREATED_BEHAVIORAL_BY_DIGEST = new Map([
  ["41caf3a9648db31cf9bd46e13c9eba69c29f15a8f23217935840e77f93356def", false],
  ["724013d0294e8f0d86986d0c2112c5c2c215b5b90a31eda3a1db09834f021710", true],
]);
const PINNED_ORPHAN_TASK_BEHAVIORAL_BY_DIGEST = new Map([
  ["70938b73b66517e2afca88951e4aadcf574d23e8046747ac96899d275ed667e4", true],
]);
const PINNED_LEGACY_ACTOR_OUTCOME_TRANSITION_DIGESTS = new Set([
  "e45e99465a1bf906ef8d21a540c724155609d22445be95eab21702970a092cca",
]);
const PINNED_LEGACY_ACTOR_OUTCOME_EVENT_ID =
  "outcome-recorded:16759d03db51dced7164ef0aaf9a9f53677010363b996a8cefb7ae54a2c5d9ea";
const PINNED_LEGACY_LEASE_EVENT_DIGESTS = new Set([
  "22e1ef7e106bb242f7829ace4aecd772696877ab736e5c1bd75737105e9aae90",
  "e879ed4128c7f45f66e3bddfa6d7cce64957b41106768f1d3ccfc5f0fcbd0607",
  "03fc39aadd7eda8c10651c86c4e15c9690541fc8d1ee01db9c2dcedcdf0e77d4",
  "5b7df471844304c395364b556f6b0b37d8ee54c11919c484f6d1734ad8d8aecb",
  "69235b4eff6f3f0535d5ff7cc48766956008704eb47709366efdc03250f4b0c0",
  "fc55b31debc63427a428f059985c6d298d3ee0deefdd2fab83d6a23dbe227b78",
  "aff8321492a725c446bd799309a3779ca7dcfe7c7039d691b2817a11ae0177c6",
  "4e437d0b167021e2b01d020bdf8174cfb06d6af2e9804fe2d6c707ea36c625be",
  "4d95299e398301d6e5369879018f70932564cf9367d771084cb66b82baa0242e",
  "939dc974c91fcc1c961520b29ee2959ebdd1e785fee92abc1faa661ac6401ea9",
  "dfbee8266ad4b4ffdba426636d2750986ba0c3b207482e644faa44610999ea28",
  "213b6b4baca9e93c914e0cf5164e086123a8b79d0763474ebb6e132dc9721616",
  "46d942fe63e6e8fd19b34a260e5aa7036b0c0715d2dea1aa0bfa1078bbef613e",
  "6767aa61b422ff42663d119fb00de154c765d41cb83ee5172c59ace7eae69ce4",
  "4a7faf446eb3c15f2d354f56ae0fb45798847f4af493d635d2cd7995d203599d",
  "ebcae43da8c310930eafedc331342203468c6c1bd33b08b2c6005d8fb09cf62f",
  "20a813d081f12828bae2a732ca3b570f5b8c3a77b4677212b918dfcc54fa31e6",
  "270c9874feaa60149bb8a6dd9484f89044e641d865ab0f6b96394423ffd51680",
  "923f6dbb9a7a8e4d78663e5278f9390061bc3e7f24fb1e4458b90d0de62ac025",
  "fb110936e1ee51c202e5982110a852d57e9d5a75c4656d4602aea10ce7862af2",
  "f648bb3c2d352f3679a4a96d72aa3ab490f3d4c6bf409401226e642eb078badf",
]);
const TASK_MANIFEST_EVENT_TYPES = new Set([
  "outcome_reservation_created",
  "outcome_reservation_finalized",
  "task_authority_updated",
  "task_created",
  "task_transitioned",
]);
const LEASE_CONTROL_EVENT_TYPES = new Set([
  "lease_acquired",
  "lease_credential_upgraded",
  "lease_heartbeat",
  "lease_released",
  "lease_scope_binding_confirmed",
  "lease_scope_bound",
  "lease_taken_over",
]);

function isCanonicalIsoTimestamp(value) {
  const timestampMs = Date.parse(String(value ?? ""));
  return (
    Number.isFinite(timestampMs) &&
    new Date(timestampMs).toISOString() === value
  );
}

function isCanonicalUuidV4(value) {
  return typeof value === "string" && CANONICAL_UUID_V4_PATTERN.test(value);
}

function isCanonicalLeaseEventId(value) {
  return (
    typeof value === "string" &&
    (SHA256_PATTERN.test(value.slice("lease:".length)) ||
      CANONICAL_UUID_V4_PATTERN.test(value.slice("lease:".length))) &&
    value.startsWith("lease:")
  );
}

function pinnedLegacyLeaseControlEvent(event) {
  return (
    isCanonicalUuidV4(event?.eventId) &&
    LEASE_CONTROL_EVENT_TYPES.has(event?.type) &&
    pinnedControlEventDigest(event, PINNED_LEGACY_LEASE_EVENT_DIGESTS)
  );
}

function taskEventAuthoritySnapshot(value) {
  return {
    observerAuthority: value?.observerAuthority,
    providerAuthority: value?.providerAuthority,
    ...(value?.providerApprovalReference === undefined
      ? {}
      : { providerApprovalReference: value.providerApprovalReference }),
  };
}

function canonicalTaskAuthoritySnapshot(value) {
  const approved = value?.providerAuthority === "approved";
  return (
    exactObjectKeys(value, [
      "observerAuthority",
      "providerAuthority",
      ...(approved ? ["providerApprovalReference"] : []),
    ]) &&
    OBSERVER_AUTHORITIES.includes(value.observerAuthority) &&
    PROVIDER_AUTHORITIES.includes(value.providerAuthority) &&
    (approved
      ? typeof value.providerApprovalReference === "string" &&
        value.providerApprovalReference.trim() !== "" &&
        value.providerApprovalReference ===
          value.providerApprovalReference.trim()
      : value.providerApprovalReference === undefined)
  );
}

function taskAuthoritySnapshotsEqual(left, right) {
  return canonicalValuesEqual(
    taskEventAuthoritySnapshot(left),
    taskEventAuthoritySnapshot(right),
  );
}

function canonicalTaskEventEnvelope(event, type) {
  const approved = event?.providerAuthority === "approved";
  return (
    exactObjectKeys(event, [
      "actor",
      "data",
      "eventId",
      "manifestRevision",
      "observerAuthority",
      ...(approved ? ["providerApprovalReference"] : []),
      "providerAuthority",
      "schemaVersion",
      "taskId",
      "taskRevision",
      "ts",
      "type",
    ]) &&
    event.schemaVersion === AUTOMATION_CONTROL_SCHEMA_VERSION &&
    event.type === type &&
    isCanonicalIsoTimestamp(event.ts) &&
    typeof event.taskId === "string" &&
    IDENTIFIER_PATTERN.test(event.taskId) &&
    Number.isInteger(event.taskRevision) &&
    event.taskRevision > 0 &&
    Number.isInteger(event.manifestRevision) &&
    event.manifestRevision >= event.taskRevision &&
    canonicalTaskAuthoritySnapshot(taskEventAuthoritySnapshot(event))
  );
}

function canonicalLeaseTakeoverSummary(value) {
  if (value === null || value === undefined) return false;
  try {
    validateLeaseTakeoverSummary(value);
    const expiredAtMs = Date.parse(value.expiredAt);
    const heartbeatAtMs = Date.parse(value.heartbeatAt);
    if (
      !isCanonicalIsoTimestamp(value.expiredAt) ||
      !isCanonicalIsoTimestamp(value.heartbeatAt) ||
      heartbeatAtMs >= expiredAtMs
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function canonicalLeaseAcquisitionEvent(candidate, provenance, actor) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  if (pinnedLegacyLeaseControlEvent(candidate)) {
    const provenanceFields = Object.fromEntries(
      Object.entries(provenance ?? {}).filter(
        ([key]) => !["leaseName", "leaseAcquiredAt"].includes(key),
      ),
    );
    return (
      policy !== undefined &&
      candidate.actor === actor &&
      candidate.leaseName === policy.leaseName &&
      candidate.ts === provenance?.leaseAcquiredAt &&
      Object.entries(provenanceFields).every(([key, value]) =>
        canonicalValuesEqual(candidate.data?.[key], value),
      )
    );
  }
  const credentialKind = provenance?.credentialKind;
  const credentialFields =
    credentialKind === "owner-signed-capability"
      ? [
          "ownerCapabilityId",
          "ownerCapabilityIntentDigest",
          "ownerCapabilityTaskId",
        ]
      : credentialKind === "owner-confirmation"
        ? [
            "ownerConfirmationApprovalReference",
            "ownerConfirmationApprovedAt",
            "ownerConfirmationApprovedBy",
            "ownerConfirmationDigest",
            "ownerConfirmationExpiresAt",
            "ownerConfirmationId",
            "ownerConfirmationIntentDigest",
            "ownerConfirmationReference",
            "ownerConfirmationTaskId",
          ]
        : credentialKind === "signed-capability"
          ? ["publisherCapabilityId", "scope"]
          : credentialKind === "trusted-launcher-channel"
            ? [
                "actorRuntimeDigest",
                "launcherAttestationSha256",
                "launcherChannelProtocol",
                "launcherSessionId",
                "launcherSha256",
              ]
            : credentialKind === "persistent-actor"
              ? ["actorCredentialPath"]
              : null;
  const optionalMutationFields = [
    ...(candidate?.type === "lease_credential_upgraded"
      ? ["credentialUpgrade", "previous"]
      : []),
    ...(candidate?.type === "lease_taken_over" ? ["previous"] : []),
  ];
  if (
    !policy ||
    credentialFields === null ||
    (["owner-signed-capability", "owner-confirmation"].includes(
      credentialKind,
    ) &&
      actor !== "freed-owner") ||
    (credentialKind === "signed-capability" &&
      actor !== "freed-pr-publisher") ||
    (credentialKind === "persistent-actor" &&
      ["freed-owner", "freed-pr-publisher"].includes(actor)) ||
    (credentialKind === "trusted-launcher-channel" &&
      ["freed-owner", "freed-pr-publisher"].includes(actor)) ||
    !exactObjectKeys(candidate, [
      "actor",
      "data",
      "eventId",
      "leaseName",
      "schemaVersion",
      "ts",
      "type",
    ]) ||
    candidate.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    ![
      "lease_acquired",
      "lease_credential_upgraded",
      "lease_taken_over",
    ].includes(candidate.type) ||
    !(
      isCanonicalLeaseEventId(candidate.eventId) ||
      (isCanonicalUuidV4(candidate.eventId) &&
        pinnedLegacyLeaseControlEvent(candidate))
    ) ||
    !isCanonicalIsoTimestamp(candidate.ts) ||
    candidate.actor !== actor ||
    candidate.leaseName !== policy.leaseName ||
    candidate.ts !== provenance.leaseAcquiredAt ||
    !exactObjectKeys(candidate.data, [
      "credentialKind",
      "expiresAt",
      "observerAuthority",
      "providerAuthority",
      "requestDigest",
      ...credentialFields,
      ...optionalMutationFields,
    ]) ||
    candidate.data.credentialKind !== credentialKind ||
    candidate.data.observerAuthority !== policy.observerAuthority ||
    candidate.data.providerAuthority !== policy.providerAuthority ||
    !SHA256_PATTERN.test(candidate.data.requestDigest) ||
    !isCanonicalIsoTimestamp(candidate.data.expiresAt) ||
    (actor === "freed-pr-publisher" &&
      Date.parse(candidate.data.expiresAt) !==
        Date.parse(candidate.ts) + PUBLISHER_LEASE_MAX_LIFETIME_MS) ||
    (candidate.type === "lease_credential_upgraded" &&
      (!["persistent-actor", "trusted-launcher-channel"].includes(
        credentialKind,
      ) ||
        candidate.data.credentialUpgrade !== true ||
        !canonicalLeaseTakeoverSummary(candidate.data.previous) ||
        candidate.data.previous.legacyUncredentialed !== true ||
        candidate.data.previous.owner !== actor ||
        Date.parse(candidate.data.previous.expiredAt) >
          Date.parse(candidate.ts))) ||
    (candidate.type === "lease_taken_over" &&
      (!canonicalLeaseTakeoverSummary(candidate.data.previous) ||
        candidate.data.previous.owner !== actor ||
        Date.parse(candidate.data.previous.expiredAt) >
          Date.parse(candidate.ts)))
  ) {
    return false;
  }
  if (credentialKind === "persistent-actor") {
    const credentialPath = candidate.data.actorCredentialPath;
    return (
      typeof credentialPath === "string" &&
      credentialPath.trim() === credentialPath &&
      !credentialPath.includes("\0") &&
      path.isAbsolute(credentialPath) &&
      path.normalize(credentialPath) === credentialPath &&
      path.basename(credentialPath) === `${actor}.json` &&
      path.basename(path.dirname(credentialPath)) === "actor-credentials" &&
      path.basename(path.dirname(path.dirname(credentialPath))) === "control"
    );
  }
  if (credentialKind === "trusted-launcher-channel") {
    return (
      SHA256_PATTERN.test(String(candidate.data.launcherSha256 ?? "")) &&
      SHA256_PATTERN.test(String(candidate.data.actorRuntimeDigest ?? "")) &&
      candidate.data.launcherChannelProtocol ===
        ACTOR_LAUNCHER_CHANNEL_PROTOCOL &&
      SHA256_PATTERN.test(
        String(candidate.data.launcherAttestationSha256 ?? ""),
      ) &&
      SHA256_PATTERN.test(String(candidate.data.launcherSessionId ?? "")) &&
      credentialFields.every(
        (field) => candidate.data[field] === provenance[field],
      )
    );
  }
  if (credentialKind === "signed-capability") {
    let normalizedScope;
    try {
      normalizedScope = normalizePublisherScope(candidate.data.scope, {
        requireLiveWorktree: false,
      });
    } catch {
      return false;
    }
    const permitsPreboundMainHead =
      normalizedScope.base === "main" &&
      ["production-release-prep", "production-promotion"].includes(
        normalizedScope.publishMode,
      );
    return (
      typeof candidate.data.publisherCapabilityId === "string" &&
      IDENTIFIER_PATTERN.test(candidate.data.publisherCapabilityId) &&
      candidate.data.publisherCapabilityId ===
        provenance.publisherCapabilityId &&
      (normalizedScope.headSha === null || permitsPreboundMainHead) &&
      canonicalValuesEqual(candidate.data.scope, normalizedScope)
    );
  }
  if (credentialKind === "owner-signed-capability") {
    if (
      !(
        typeof candidate.data.ownerCapabilityId === "string" &&
        IDENTIFIER_PATTERN.test(candidate.data.ownerCapabilityId)
      ) ||
      !(
        typeof candidate.data.ownerCapabilityTaskId === "string" &&
        IDENTIFIER_PATTERN.test(candidate.data.ownerCapabilityTaskId)
      ) ||
      !SHA256_PATTERN.test(candidate.data.ownerCapabilityIntentDigest)
    ) {
      return false;
    }
  }
  if (credentialKind === "owner-confirmation") {
    const approvedAtMs = Date.parse(
      String(candidate.data.ownerConfirmationApprovedAt ?? ""),
    );
    const confirmationExpiresAtMs = Date.parse(
      String(candidate.data.ownerConfirmationExpiresAt ?? ""),
    );
    const acquiredAtMs = Date.parse(candidate.ts);
    const leaseExpiresAtMs = Date.parse(candidate.data.expiresAt);
    if (
      !(
        typeof candidate.data.ownerConfirmationId === "string" &&
        IDENTIFIER_PATTERN.test(candidate.data.ownerConfirmationId)
      ) ||
      !(
        typeof candidate.data.ownerConfirmationTaskId === "string" &&
        IDENTIFIER_PATTERN.test(candidate.data.ownerConfirmationTaskId)
      ) ||
      !SHA256_PATTERN.test(candidate.data.ownerConfirmationIntentDigest) ||
      !SHA256_PATTERN.test(candidate.data.ownerConfirmationDigest) ||
      typeof candidate.data.ownerConfirmationReference !== "string" ||
      candidate.data.ownerConfirmationReference.trim() === "" ||
      candidate.data.ownerConfirmationReference !==
        candidate.data.ownerConfirmationReference.trim() ||
      candidate.data.ownerConfirmationApprovedBy !== "AubreyF" ||
      typeof candidate.data.ownerConfirmationApprovalReference !== "string" ||
      candidate.data.ownerConfirmationApprovalReference.trim() === "" ||
      candidate.data.ownerConfirmationApprovalReference !==
        candidate.data.ownerConfirmationApprovalReference.trim() ||
      !isCanonicalIsoTimestamp(candidate.data.ownerConfirmationApprovedAt) ||
      !isCanonicalIsoTimestamp(candidate.data.ownerConfirmationExpiresAt) ||
      confirmationExpiresAtMs <= approvedAtMs ||
      confirmationExpiresAtMs - approvedAtMs >
        OWNER_CONFIRMATION_MAX_LIFETIME_MS ||
      approvedAtMs > acquiredAtMs + OWNER_CONFIRMATION_CLOCK_SKEW_MS ||
      confirmationExpiresAtMs < leaseExpiresAtMs
    ) {
      return false;
    }
  }
  return credentialFields.every(
    (field) => candidate.data[field] === provenance[field],
  );
}

function indexControlEventHistory(events) {
  const records = Array.from(events, (entry, index) => ({
    entry,
    index,
    lineNumber: index + 1,
  }));
  const recordsByEventId = new Map();
  const acquisitionRecordsByKey = new Map();
  for (const record of records) {
    const event = record.entry;
    if (typeof event?.eventId === "string") {
      const matches = recordsByEventId.get(event.eventId) ?? [];
      matches.push(record);
      recordsByEventId.set(event.eventId, matches);
    }
    if (
      [
        "lease_acquired",
        "lease_credential_upgraded",
        "lease_taken_over",
      ].includes(event?.type) &&
      typeof event?.actor === "string" &&
      typeof event?.leaseName === "string" &&
      typeof event?.ts === "string"
    ) {
      const key = JSON.stringify([event.actor, event.leaseName, event.ts]);
      const matches = acquisitionRecordsByKey.get(key) ?? [];
      matches.push(record);
      acquisitionRecordsByKey.set(key, matches);
    }
  }
  const leaseTimelinesByAcquisitionIndex = new Map();
  const activeTimelineByLeaseName = new Map();
  for (const record of records) {
    const event = record.entry;
    if (
      [
        "lease_acquired",
        "lease_credential_upgraded",
        "lease_taken_over",
      ].includes(event?.type) &&
      typeof event?.leaseName === "string"
    ) {
      const previous = activeTimelineByLeaseName.get(event.leaseName);
      if (previous !== undefined) previous.closedAtIndex = record.index;
      const acquiredAtMs = Date.parse(String(event.ts ?? ""));
      const maxLifetimeMs = actorLeaseMaxLifetimeMs(event.actor);
      const pinnedLegacy = pinnedLegacyLeaseControlEvent(event);
      const credentialExpiresAtMs =
        event.data?.credentialKind === "owner-confirmation"
          ? Date.parse(String(event.data.ownerConfirmationExpiresAt ?? ""))
          : Number.POSITIVE_INFINITY;
      const timeline = {
        actor: event.actor,
        leaseName: event.leaseName,
        acquiredAtMs,
        initialExpiryMs: Date.parse(String(event.data?.expiresAt ?? "")),
        absoluteExpiryMs:
          pinnedLegacy || maxLifetimeMs === null
            ? Number.POSITIVE_INFINITY
            : acquiredAtMs + maxLifetimeMs,
        credentialExpiresAtMs,
        closedAtIndex: null,
        invalidAtIndex: null,
        heartbeatCheckpoints: [],
      };
      leaseTimelinesByAcquisitionIndex.set(record.index, timeline);
      activeTimelineByLeaseName.set(event.leaseName, timeline);
      continue;
    }
    if (
      event?.type === "lease_released" &&
      typeof event.leaseName === "string"
    ) {
      const timeline = activeTimelineByLeaseName.get(event.leaseName);
      if (timeline !== undefined) timeline.closedAtIndex = record.index;
      activeTimelineByLeaseName.delete(event.leaseName);
      continue;
    }
    if (
      event?.type !== "lease_heartbeat" ||
      typeof event.leaseName !== "string"
    ) {
      continue;
    }
    const timeline = activeTimelineByLeaseName.get(event.leaseName);
    if (timeline === undefined || timeline.invalidAtIndex !== null) continue;
    const previous = timeline.heartbeatCheckpoints.at(-1);
    const effectiveExpiryMs =
      previous?.effectiveExpiryMs ?? timeline.initialExpiryMs;
    const heartbeatAtMs = Date.parse(String(event.ts ?? ""));
    const heartbeatExpiryMs = Date.parse(String(event.data?.expiresAt ?? ""));
    if (
      !(
        canonicalLeaseHeartbeatEvent(
          event,
          timeline.actor,
          timeline.leaseName,
        ) || pinnedLegacyLeaseControlEvent(event)
      ) ||
      recordsByEventId.get(event.eventId)?.length !== 1 ||
      heartbeatAtMs < timeline.acquiredAtMs ||
      heartbeatAtMs >= effectiveExpiryMs ||
      heartbeatExpiryMs <= heartbeatAtMs ||
      heartbeatExpiryMs > timeline.absoluteExpiryMs ||
      heartbeatExpiryMs > timeline.credentialExpiresAtMs
    ) {
      timeline.invalidAtIndex = record.index;
      continue;
    }
    timeline.heartbeatCheckpoints.push({
      recordIndex: record.index,
      effectiveExpiryMs: heartbeatExpiryMs,
      maximumHeartbeatAtMs: Math.max(
        previous?.maximumHeartbeatAtMs ?? Number.NEGATIVE_INFINITY,
        heartbeatAtMs,
      ),
    });
  }
  return {
    records,
    recordsByEventId,
    acquisitionRecordsByKey,
    leaseTimelinesByAcquisitionIndex,
  };
}

function canonicalLeaseHeartbeatEvent(event, actor, leaseName) {
  if (pinnedLegacyLeaseControlEvent(event)) return true;
  return (
    exactObjectKeys(event, [
      "actor",
      "data",
      "eventId",
      "leaseName",
      "schemaVersion",
      "ts",
      "type",
    ]) &&
    event.schemaVersion === AUTOMATION_CONTROL_SCHEMA_VERSION &&
    event.type === "lease_heartbeat" &&
    event.actor === actor &&
    event.leaseName === leaseName &&
    isCanonicalLeaseEventId(event.eventId) &&
    isCanonicalIsoTimestamp(event.ts) &&
    exactObjectKeys(event.data, ["expiresAt", "requestDigest"]) &&
    isCanonicalIsoTimestamp(event.data.expiresAt) &&
    SHA256_PATTERN.test(event.data.requestDigest)
  );
}

function canonicalLeaseScopeEvent(event) {
  if (pinnedLegacyLeaseControlEvent(event)) return true;
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
    !["lease_scope_binding_confirmed", "lease_scope_bound"].includes(
      event.type,
    ) ||
    event.actor !== "freed-pr-publisher" ||
    event.leaseName !== AUTOMATION_ACTOR_POLICIES[event.actor].leaseName ||
    !isCanonicalLeaseEventId(event.eventId) ||
    !isCanonicalIsoTimestamp(event.ts) ||
    !exactObjectKeys(event.data, ["requestDigest", "scope"]) ||
    !SHA256_PATTERN.test(event.data.requestDigest)
  ) {
    return false;
  }
  try {
    return canonicalValuesEqual(
      event.data.scope,
      normalizePublisherScope(event.data.scope, { requireLiveWorktree: false }),
    );
  } catch {
    return false;
  }
}

function canonicalLeaseReleaseEvent(event) {
  if (pinnedLegacyLeaseControlEvent(event)) return true;
  const policy = AUTOMATION_ACTOR_POLICIES[event?.actor];
  return (
    policy !== undefined &&
    exactObjectKeys(event, [
      "actor",
      "data",
      "eventId",
      "leaseName",
      "schemaVersion",
      "ts",
      "type",
    ]) &&
    event.schemaVersion === AUTOMATION_CONTROL_SCHEMA_VERSION &&
    event.type === "lease_released" &&
    event.leaseName === policy.leaseName &&
    isCanonicalLeaseEventId(event.eventId) &&
    isCanonicalIsoTimestamp(event.ts) &&
    exactObjectKeys(event.data, ["expired", "requestDigest"]) &&
    typeof event.data.expired === "boolean" &&
    SHA256_PATTERN.test(event.data.requestDigest)
  );
}

function inspectExactLeaseEventHistory(records, eventIdCounts) {
  const issues = [];
  const activeByLeaseName = new Map();
  const observedLeaseNames = new Set();
  const canonicalEventsByIndex = new Map();
  const fail = (record, message) => {
    issues.push(`line ${record.lineNumber.toLocaleString()} ${message}`);
  };
  for (const record of records) {
    const event = record.entry;
    const eventId = typeof event?.eventId === "string" ? event.eventId : "";
    const reserved =
      LEASE_CONTROL_EVENT_TYPES.has(event?.type) ||
      eventId.startsWith("lease:");
    if (!reserved) continue;
    const policy = AUTOMATION_ACTOR_POLICIES[event?.actor];
    const uniqueEventId = eventId !== "" && eventIdCounts.get(eventId) === 1;
    const acquisition = [
      "lease_acquired",
      "lease_credential_upgraded",
      "lease_taken_over",
    ].includes(event?.type);
    const provenance = acquisition
      ? {
          leaseName: event.leaseName,
          leaseAcquiredAt: event.ts,
          ...event.data,
        }
      : null;
    const canonical =
      pinnedLegacyLeaseControlEvent(event) ||
      (acquisition
        ? canonicalLeaseAcquisitionEvent(event, provenance, event.actor)
        : event?.type === "lease_heartbeat"
          ? policy !== undefined &&
            event.leaseName === policy.leaseName &&
            canonicalLeaseHeartbeatEvent(event, event.actor, event.leaseName)
          : ["lease_scope_binding_confirmed", "lease_scope_bound"].includes(
                event?.type,
              )
            ? canonicalLeaseScopeEvent(event)
            : canonicalLeaseReleaseEvent(event));
    if (!uniqueEventId || !canonical) {
      fail(record, "is not one exact canonical lease control event");
      continue;
    }

    const eventAtMs = Date.parse(event.ts);
    if (acquisition) {
      const expiresAtMs = Date.parse(event.data.expiresAt);
      const maxLifetimeMs = actorLeaseMaxLifetimeMs(event.actor);
      const pinnedLegacy = pinnedLegacyLeaseControlEvent(event);
      const active = activeByLeaseName.get(event.leaseName);
      const previous = event.data.previous;
      const beginsAfterExplicitAbsence =
        active === undefined && observedLeaseNames.has(event.leaseName);
      const auditedPredecessorMatches =
        active === undefined ||
        ((event.type === "lease_credential_upgraded") ===
          active.legacyUncredentialed &&
          ["lease_credential_upgraded", "lease_taken_over"].includes(
            event.type,
          ) &&
          (previous?.legacyUncredentialed === true) ===
            active.legacyUncredentialed &&
          previous?.owner === active.actor &&
          previous?.expiredAt === active.expiresAt &&
          previous?.heartbeatAt === active.heartbeatAt);
      if (
        !Number.isFinite(eventAtMs) ||
        !Number.isFinite(expiresAtMs) ||
        expiresAtMs <= eventAtMs ||
        (maxLifetimeMs !== null && expiresAtMs > eventAtMs + maxLifetimeMs) ||
        (beginsAfterExplicitAbsence && event.type !== "lease_acquired") ||
        !auditedPredecessorMatches ||
        (active !== undefined && active.expiresAtMs > eventAtMs)
      ) {
        fail(record, "does not begin one bounded canonical lease lifetime");
        continue;
      }
      activeByLeaseName.set(event.leaseName, {
        acquisitionEvent: structuredClone(event),
        acquisitionIndex: record.index,
        actor: event.actor,
        acquiredAtMs: eventAtMs,
        absoluteExpiryMs:
          pinnedLegacy || maxLifetimeMs === null
            ? Number.POSITIVE_INFINITY
            : eventAtMs + maxLifetimeMs,
        credentialExpiresAtMs:
          event.data.credentialKind === "owner-confirmation"
            ? Date.parse(event.data.ownerConfirmationExpiresAt)
            : Number.POSITIVE_INFINITY,
        expiresAtMs,
        expiresAt: event.data.expiresAt,
        heartbeatAtMs: eventAtMs,
        heartbeatAt: event.ts,
        lastEventAtMs: eventAtMs,
        legacyUncredentialed: event.data.credentialKind === undefined,
        scope:
          event.actor === "freed-pr-publisher"
            ? structuredClone(event.data.scope)
            : null,
      });
      canonicalEventsByIndex.set(
        record.index,
        Object.freeze({
          kind: "acquisition",
          acquisitionIndex: record.index,
          event: Object.freeze(structuredClone(event)),
        }),
      );
      observedLeaseNames.add(event.leaseName);
      continue;
    }

    const active = activeByLeaseName.get(event.leaseName);
    if (
      active === undefined ||
      active.actor !== event.actor ||
      !Number.isFinite(eventAtMs)
    ) {
      fail(record, "does not follow one active canonical lease lifetime");
      continue;
    }
    if (event.type === "lease_heartbeat") {
      const expiresAtMs = Date.parse(event.data.expiresAt);
      if (
        eventAtMs < active.acquiredAtMs ||
        eventAtMs < active.lastEventAtMs ||
        eventAtMs >= active.expiresAtMs ||
        expiresAtMs <= eventAtMs ||
        expiresAtMs > active.absoluteExpiryMs ||
        expiresAtMs > active.credentialExpiresAtMs
      ) {
        fail(record, "does not extend one active canonical lease lifetime");
        continue;
      }
      active.expiresAtMs = expiresAtMs;
      active.expiresAt = event.data.expiresAt;
      active.heartbeatAtMs = eventAtMs;
      active.heartbeatAt = event.ts;
      active.lastEventAtMs = eventAtMs;
      canonicalEventsByIndex.set(
        record.index,
        Object.freeze({
          kind: "heartbeat",
          acquisitionIndex: active.acquisitionIndex,
          event: Object.freeze(structuredClone(event)),
        }),
      );
      continue;
    }
    if (
      ["lease_scope_binding_confirmed", "lease_scope_bound"].includes(
        event.type,
      )
    ) {
      const nextScope = event.data.scope;
      const scopePrefixMatches =
        active.scope !== null &&
        [
          "schemaVersion",
          "repo",
          "worktree",
          "branch",
          "base",
          "baseSha",
          "publishMode",
        ].every((field) => active.scope[field] === nextScope[field]);
      const sequencingMatches =
        event.type === "lease_scope_bound"
          ? active.scope?.headSha === null &&
            typeof nextScope.headSha === "string" &&
            /^[0-9a-f]{40}$/.test(nextScope.headSha)
          : active.scope?.headSha !== null &&
            canonicalValuesEqual(active.scope, nextScope);
      if (
        eventAtMs < active.acquiredAtMs ||
        eventAtMs < active.lastEventAtMs ||
        eventAtMs >= active.expiresAtMs ||
        !scopePrefixMatches ||
        !sequencingMatches
      ) {
        fail(record, "does not bind one active canonical publisher lease");
        continue;
      }
      active.scope = structuredClone(nextScope);
      active.lastEventAtMs = eventAtMs;
      canonicalEventsByIndex.set(
        record.index,
        Object.freeze({
          kind: "scope",
          acquisitionIndex: active.acquisitionIndex,
          event: Object.freeze(structuredClone(event)),
        }),
      );
      continue;
    }
    if (
      eventAtMs < active.lastEventAtMs ||
      event.data.expired !== eventAtMs >= active.expiresAtMs
    ) {
      fail(record, "does not close one exact canonical lease lifetime");
      continue;
    }
    canonicalEventsByIndex.set(
      record.index,
      Object.freeze({
        kind: "release",
        acquisitionIndex: active.acquisitionIndex,
        event: Object.freeze(structuredClone(event)),
      }),
    );
    activeByLeaseName.delete(event.leaseName);
    observedLeaseNames.add(event.leaseName);
  }
  return {
    issues,
    healthy: issues.length === 0,
    activeByLeaseName,
    canonicalEventsByIndex,
  };
}

function requireExactLeaseEventHistory(events) {
  const indexed = indexControlEventHistory(events);
  const eventIdCounts = new Map(
    [...indexed.recordsByEventId].map(([eventId, matches]) => [
      eventId,
      matches.length,
    ]),
  );
  const inspection = inspectExactLeaseEventHistory(
    indexed.records,
    eventIdCounts,
  );
  if (!inspection.healthy) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `Control event history has invalid lease events: ${inspection.issues.join("; ")}`,
    );
  }
  return inspection;
}

function canonicalLeaseAuthorityAtEvent(
  provenance,
  {
    actor,
    eventTimestamp,
    recordIndex,
    records,
    recordsByEventId,
    acquisitionRecordsByKey,
    leaseTimelinesByAcquisitionIndex,
    leaseAcquisitionMode = "any",
  },
) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const acquiredAtMs = Date.parse(String(provenance?.leaseAcquiredAt ?? ""));
  const eventTimestampMs = Date.parse(String(eventTimestamp ?? ""));
  if (
    !["any", "current", "pinned-legacy"].includes(leaseAcquisitionMode) ||
    !policy ||
    provenance?.leaseName !== policy.leaseName ||
    !isCanonicalIsoTimestamp(provenance.leaseAcquiredAt) ||
    !Number.isFinite(eventTimestampMs) ||
    acquiredAtMs > eventTimestampMs
  ) {
    return false;
  }
  const acquisitionKey = JSON.stringify([
    actor,
    policy.leaseName,
    provenance.leaseAcquiredAt,
  ]);
  const acquisitionCandidates =
    acquisitionRecordsByKey.get(acquisitionKey) ?? [];
  if (acquisitionCandidates.length !== 1) return false;
  const acquisition = acquisitionCandidates[0];
  const pinnedLegacyAcquisition = pinnedLegacyLeaseControlEvent(
    acquisition.entry,
  );
  if (
    acquisition.index >= recordIndex ||
    recordsByEventId.get(acquisition.entry.eventId)?.length !== 1 ||
    (leaseAcquisitionMode === "current" && pinnedLegacyAcquisition) ||
    (leaseAcquisitionMode === "pinned-legacy" && !pinnedLegacyAcquisition) ||
    !canonicalLeaseAcquisitionEvent(acquisition.entry, provenance, actor)
  ) {
    return false;
  }

  const timeline = leaseTimelinesByAcquisitionIndex.get(acquisition.index);
  if (
    timeline === undefined ||
    timeline.actor !== actor ||
    timeline.leaseName !== policy.leaseName ||
    (timeline.closedAtIndex !== null && timeline.closedAtIndex < recordIndex) ||
    (timeline.invalidAtIndex !== null && timeline.invalidAtIndex < recordIndex)
  ) {
    return false;
  }
  let low = 0;
  let high = timeline.heartbeatCheckpoints.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timeline.heartbeatCheckpoints[middle].recordIndex < recordIndex) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const heartbeat = low === 0 ? null : timeline.heartbeatCheckpoints[low - 1];
  const effectiveExpiryMs =
    heartbeat?.effectiveExpiryMs ?? timeline.initialExpiryMs;
  const confirmationExpiryMs =
    provenance.credentialKind === "owner-confirmation"
      ? Date.parse(String(provenance.ownerConfirmationExpiresAt ?? ""))
      : Number.POSITIVE_INFINITY;
  if (
    !Number.isFinite(effectiveExpiryMs) ||
    effectiveExpiryMs <= acquiredAtMs ||
    effectiveExpiryMs > timeline.absoluteExpiryMs ||
    effectiveExpiryMs > confirmationExpiryMs ||
    (heartbeat !== null && heartbeat.maximumHeartbeatAtMs > eventTimestampMs)
  ) {
    return false;
  }
  return (
    eventTimestampMs < effectiveExpiryMs &&
    eventTimestampMs < timeline.absoluteExpiryMs
  );
}

function canonicalTaskAuthorizationProvenance(
  value,
  {
    actor,
    taskId,
    eventTimestamp,
    recordIndex,
    records,
    recordsByEventId,
    acquisitionRecordsByKey,
    leaseTimelinesByAcquisitionIndex,
    leaseAcquisitionMode = "any",
  },
) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const commonKeys = ["credentialKind", "leaseAcquiredAt", "leaseName"];
  const credentialKeys =
    value?.credentialKind === "owner-signed-capability"
      ? [
          "ownerCapabilityId",
          "ownerCapabilityIntentDigest",
          "ownerCapabilityTaskId",
        ]
      : value?.credentialKind === "owner-confirmation"
        ? [
            "ownerConfirmationApprovalReference",
            "ownerConfirmationApprovedAt",
            "ownerConfirmationApprovedBy",
            "ownerConfirmationDigest",
            "ownerConfirmationExpiresAt",
            "ownerConfirmationId",
            "ownerConfirmationIntentDigest",
            "ownerConfirmationReference",
            "ownerConfirmationTaskId",
          ]
        : value?.credentialKind === "signed-capability"
          ? ["publisherCapabilityId"]
          : value?.credentialKind === "trusted-launcher-channel"
            ? [
                "actorRuntimeDigest",
                "launcherAttestationSha256",
                "launcherChannelProtocol",
                "launcherSessionId",
                "launcherSha256",
              ]
            : value?.credentialKind === "persistent-actor"
              ? []
              : null;
  const acquiredAtMs = Date.parse(String(value?.leaseAcquiredAt ?? ""));
  const eventTimestampMs = Date.parse(String(eventTimestamp ?? ""));
  if (
    !policy ||
    credentialKeys === null ||
    !exactObjectKeys(value, [...commonKeys, ...credentialKeys]) ||
    value.leaseName !== policy.leaseName ||
    !isCanonicalIsoTimestamp(value.leaseAcquiredAt) ||
    !Number.isFinite(acquiredAtMs) ||
    !Number.isFinite(eventTimestampMs) ||
    acquiredAtMs > eventTimestampMs ||
    (["owner-signed-capability", "owner-confirmation"].includes(
      value.credentialKind,
    ) &&
      actor !== "freed-owner") ||
    (value.credentialKind === "signed-capability" &&
      actor !== "freed-pr-publisher") ||
    (value.credentialKind === "persistent-actor" &&
      ["freed-owner", "freed-pr-publisher"].includes(actor)) ||
    (value.credentialKind === "trusted-launcher-channel" &&
      (["freed-owner", "freed-pr-publisher"].includes(actor) ||
        !SHA256_PATTERN.test(String(value.launcherSha256 ?? "")) ||
        !SHA256_PATTERN.test(String(value.actorRuntimeDigest ?? "")) ||
        value.launcherChannelProtocol !== ACTOR_LAUNCHER_CHANNEL_PROTOCOL ||
        !SHA256_PATTERN.test(String(value.launcherAttestationSha256 ?? "")) ||
        !SHA256_PATTERN.test(String(value.launcherSessionId ?? ""))))
  ) {
    return false;
  }
  if (
    value.credentialKind === "owner-signed-capability" &&
    (!(
      typeof value.ownerCapabilityId === "string" &&
      IDENTIFIER_PATTERN.test(value.ownerCapabilityId)
    ) ||
      value.ownerCapabilityTaskId !== taskId ||
      !SHA256_PATTERN.test(value.ownerCapabilityIntentDigest))
  ) {
    return false;
  }
  if (value.credentialKind === "owner-confirmation") {
    const approvedAtMs = Date.parse(
      String(value.ownerConfirmationApprovedAt ?? ""),
    );
    const expiresAtMs = Date.parse(
      String(value.ownerConfirmationExpiresAt ?? ""),
    );
    if (
      !(
        typeof value.ownerConfirmationId === "string" &&
        IDENTIFIER_PATTERN.test(value.ownerConfirmationId)
      ) ||
      value.ownerConfirmationTaskId !== taskId ||
      !SHA256_PATTERN.test(value.ownerConfirmationIntentDigest) ||
      !SHA256_PATTERN.test(value.ownerConfirmationDigest) ||
      typeof value.ownerConfirmationReference !== "string" ||
      value.ownerConfirmationReference.trim() === "" ||
      value.ownerConfirmationReference !==
        value.ownerConfirmationReference.trim() ||
      value.ownerConfirmationApprovedBy !== "AubreyF" ||
      typeof value.ownerConfirmationApprovalReference !== "string" ||
      value.ownerConfirmationApprovalReference.trim() === "" ||
      value.ownerConfirmationApprovalReference !==
        value.ownerConfirmationApprovalReference.trim() ||
      !isCanonicalIsoTimestamp(value.ownerConfirmationApprovedAt) ||
      !isCanonicalIsoTimestamp(value.ownerConfirmationExpiresAt) ||
      expiresAtMs <= approvedAtMs ||
      expiresAtMs <= acquiredAtMs ||
      expiresAtMs - approvedAtMs > OWNER_CONFIRMATION_MAX_LIFETIME_MS ||
      approvedAtMs > acquiredAtMs + OWNER_CONFIRMATION_CLOCK_SKEW_MS ||
      expiresAtMs <= eventTimestampMs
    ) {
      return false;
    }
  }
  if (
    value.credentialKind === "signed-capability" &&
    !(
      typeof value.publisherCapabilityId === "string" &&
      IDENTIFIER_PATTERN.test(value.publisherCapabilityId)
    )
  ) {
    return false;
  }
  return canonicalLeaseAuthorityAtEvent(value, {
    actor,
    eventTimestamp,
    recordIndex,
    records,
    recordsByEventId,
    acquisitionRecordsByKey,
    leaseTimelinesByAcquisitionIndex,
    leaseAcquisitionMode,
  });
}

function canonicalTaskEventPolicyAuthority(event, toState) {
  const policy = AUTOMATION_ACTOR_POLICIES[event?.actor];
  return (
    policy?.destinations.includes(toState) === true &&
    taskObserverAuthorityAllowsTransition(event.observerAuthority, toState) &&
    taskProviderAuthorityAllowsTransition(event.providerAuthority, toState)
  );
}

function taskTransitionDestinationKeys(toState) {
  return toState === "installed"
    ? ["installedAt", "installedBuild", "installedIdentity"]
    : toState === "merged"
      ? ["mergedAt"]
      : toState === "soaking"
        ? [
            "installedAt",
            "installedBuild",
            "installedIdentity",
            "soakStartedAt",
          ]
        : [];
}

function canonicalTaskTransitionDestination(event) {
  const data = event?.data;
  if (!canonicalTaskEventPolicyAuthority(event, data?.toState)) return false;
  try {
    if (!isTaskTransitionAllowed(data.fromState, data.toState)) return false;
  } catch {
    return false;
  }
  if (data.toState === "merged") return data.mergedAt === event.ts;
  if (["installed", "soaking"].includes(data.toState)) {
    try {
      const identity = normalizeInstalledBuildIdentity(
        data.installedIdentity,
        "transition.installedIdentity",
      );
      return (
        canonicalValuesEqual(identity, data.installedIdentity) &&
        data.installedBuild === identity.version &&
        isCanonicalIsoTimestamp(data.installedAt) &&
        (data.toState === "installed"
          ? data.installedAt === event.ts
          : data.soakStartedAt === event.ts &&
            Date.parse(data.installedAt) <= Date.parse(data.soakStartedAt))
      );
    } catch {
      return false;
    }
  }
  return true;
}

function canonicalTaskTransitionEvent(
  event,
  record,
  records,
  recordsByEventId,
  acquisitionRecordsByKey,
  leaseTimelinesByAcquisitionIndex,
) {
  if (
    !canonicalTaskEventEnvelope(event, "task_transitioned") ||
    !isCanonicalUuidV4(event.eventId)
  ) {
    return false;
  }
  const data = event.data;
  const optionalOutcomeKeys = [
    ...(data?.outcomeRequired === undefined ? [] : ["outcomeRequired"]),
    ...(data?.outcomeDigest === undefined ? [] : ["outcomeDigest"]),
  ];
  const exactCurrentShape = exactObjectKeys(data, [
    "authorizationProvenance",
    "fromState",
    ...optionalOutcomeKeys,
    ...taskTransitionDestinationKeys(data?.toState),
    "toState",
  ]);
  if (!exactCurrentShape) return false;
  const pinnedLegacyActorOutcome = pinnedLegacyActorOutcomeTransition(event);
  if (
    !pinnedLegacyActorOutcome &&
    !canonicalTaskAuthorizationProvenance(data.authorizationProvenance, {
      actor: event.actor,
      taskId: event.taskId,
      eventTimestamp: event.ts,
      recordIndex: record.index,
      records,
      recordsByEventId,
      acquisitionRecordsByKey,
      leaseTimelinesByAcquisitionIndex,
    })
  ) {
    return false;
  }
  if (
    (data.outcomeRequired !== undefined && data.outcomeRequired !== true) ||
    (data.outcomeRequired === true && !OUTCOME_TASK_STATES.has(data.toState)) ||
    (data.outcomeRequired === true &&
      !SHA256_PATTERN.test(data.outcomeDigest)) ||
    (data.outcomeDigest !== undefined &&
      !SHA256_PATTERN.test(data.outcomeDigest))
  ) {
    return false;
  }
  return canonicalTaskTransitionDestination(event);
}

function canonicalTaskCreatedEvent(
  event,
  record,
  records,
  recordsByEventId,
  acquisitionRecordsByKey,
  leaseTimelinesByAcquisitionIndex,
) {
  const policy = AUTOMATION_ACTOR_POLICIES[event?.actor];
  const legacyBehavioral = pinnedLegacyTaskCreatedBehavioral(event);
  const pinnedLegacyCreation = typeof legacyBehavioral === "boolean";
  if (
    !canonicalTaskEventEnvelope(event, "task_created") ||
    !isCanonicalUuidV4(event.eventId) ||
    event.taskRevision !== 1 ||
    !exactObjectKeys(event.data, [
      "authorizationProvenance",
      ...(event.data?.approvalReference === undefined
        ? []
        : ["approvalReference"]),
      ...(pinnedLegacyCreation ? [] : ["behavioral"]),
      "state",
    ]) ||
    event.data.state !== "observed" ||
    (!pinnedLegacyCreation && typeof event.data.behavioral !== "boolean") ||
    policy?.canCreateTask !== true ||
    !canonicalTaskAuthorizationProvenance(event.data.authorizationProvenance, {
      actor: event.actor,
      taskId: event.taskId,
      eventTimestamp: event.ts,
      recordIndex: record.index,
      records,
      recordsByEventId,
      acquisitionRecordsByKey,
      leaseTimelinesByAcquisitionIndex,
      leaseAcquisitionMode: pinnedLegacyCreation ? "pinned-legacy" : "current",
    }) ||
    (event.actor === "freed-runtime-observer" &&
      (event.observerAuthority !== "observe-only" ||
        event.providerAuthority !== "forbidden")) ||
    (event.actor === "freed-scaffolding-maintainer" &&
      (event.observerAuthority !== "pr-only" ||
        event.providerAuthority !== "forbidden")) ||
    (event.providerAuthority === "approved" && event.actor !== "freed-owner")
  ) {
    return false;
  }
  return event.providerAuthority === "approved"
    ? event.data.approvalReference === event.providerApprovalReference
    : event.data.approvalReference === undefined;
}

function canonicalTaskAuthorityUpdatedEvent(
  event,
  record,
  records,
  recordsByEventId,
  acquisitionRecordsByKey,
  leaseTimelinesByAcquisitionIndex,
) {
  if (
    !canonicalTaskEventEnvelope(event, "task_authority_updated") ||
    !isCanonicalUuidV4(event.eventId) ||
    event.actor !== "freed-owner" ||
    event.taskRevision < 2 ||
    !exactObjectKeys(event.data, [
      "after",
      "authorizationProvenance",
      "before",
      ...(event.data?.approvalReference === undefined
        ? []
        : ["approvalReference"]),
      "reason",
    ]) ||
    !canonicalTaskAuthoritySnapshot(event.data.before) ||
    !canonicalTaskAuthoritySnapshot(event.data.after) ||
    !taskAuthoritySnapshotsEqual(event, event.data.after) ||
    taskAuthoritySnapshotsEqual(event.data.before, event.data.after) ||
    typeof event.data.reason !== "string" ||
    event.data.reason.trim() === "" ||
    event.data.reason !== event.data.reason.trim() ||
    !canonicalTaskAuthorizationProvenance(event.data.authorizationProvenance, {
      actor: event.actor,
      taskId: event.taskId,
      eventTimestamp: event.ts,
      recordIndex: record.index,
      records,
      recordsByEventId,
      acquisitionRecordsByKey,
      leaseTimelinesByAcquisitionIndex,
    })
  ) {
    return false;
  }
  const providerChanged =
    event.data.before.providerAuthority !==
      event.data.after.providerAuthority ||
    event.data.before.providerApprovalReference !==
      event.data.after.providerApprovalReference;
  if (
    event.data.after.providerAuthority === "approved"
      ? (providerChanged &&
          event.data.approvalReference !==
            event.data.after.providerApprovalReference) ||
        (!providerChanged &&
          event.data.approvalReference !== undefined &&
          event.data.approvalReference !==
            event.data.after.providerApprovalReference)
      : event.data.approvalReference !== undefined
  ) {
    return false;
  }
  const provenance = event.data.authorizationProvenance;
  const intentDigest =
    provenance.credentialKind === "owner-signed-capability"
      ? provenance.ownerCapabilityIntentDigest
      : provenance.credentialKind === "owner-confirmation"
        ? provenance.ownerConfirmationIntentDigest
        : null;
  if (intentDigest === null) return false;
  try {
    return taskAuthorityUpdateIntentDigestCandidates({
      taskId: event.taskId,
      taskRevision: event.taskRevision,
      before: event.data.before,
      after: event.data.after,
      reason: event.data.reason,
    }).includes(intentDigest);
  } catch {
    return false;
  }
}

function canonicalOutcomeReservationEvent(
  event,
  record,
  records,
  recordsByEventId,
  acquisitionRecordsByKey,
  leaseTimelinesByAcquisitionIndex,
) {
  const data = event?.data;
  const outcomeKeys =
    data?.toState === "installed"
      ? ["installedAt", "installedBuild", "installedIdentity"]
      : data?.toState === "merged" && data?.mergedAt !== undefined
        ? ["mergedAt"]
        : [];
  if (
    !canonicalTaskEventEnvelope(event, "outcome_reservation_created") ||
    !exactObjectKeys(data, [
      "authorizationProvenance",
      "legacyTransitionEventId",
      "outcomeBackfill",
      "outcomeDigest",
      "outcomeRequired",
      "toState",
      ...outcomeKeys,
    ]) ||
    data.outcomeRequired !== true ||
    data.outcomeBackfill !== true ||
    !OUTCOME_TASK_STATES.has(data.toState) ||
    !canonicalTaskEventPolicyAuthority(event, data.toState) ||
    !SHA256_PATTERN.test(data.outcomeDigest) ||
    !(
      typeof data.legacyTransitionEventId === "string" &&
      IDENTIFIER_PATTERN.test(data.legacyTransitionEventId)
    ) ||
    !canonicalTaskAuthorizationProvenance(data.authorizationProvenance, {
      actor: event.actor,
      taskId: event.taskId,
      eventTimestamp: event.ts,
      recordIndex: record.index,
      records,
      recordsByEventId,
      acquisitionRecordsByKey,
      leaseTimelinesByAcquisitionIndex,
    })
  ) {
    return false;
  }
  if (data.toState === "merged" && data.mergedAt !== undefined) {
    if (!isCanonicalIsoTimestamp(data.mergedAt)) return false;
  }
  if (data.toState === "installed") {
    try {
      const identity = normalizeInstalledBuildIdentity(
        data.installedIdentity,
        "reservation.installedIdentity",
      );
      if (
        !canonicalValuesEqual(identity, data.installedIdentity) ||
        data.installedBuild !== identity.version ||
        !isCanonicalIsoTimestamp(data.installedAt)
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }
  try {
    return (
      event.eventId ===
      outcomeReservationEventId({
        taskId: event.taskId,
        outcome: data.toState,
        outcomeDigest: data.outcomeDigest,
        taskRevision: event.taskRevision,
        legacyTransitionEventId: data.legacyTransitionEventId,
      })
    );
  } catch {
    return false;
  }
}

function canonicalOutcomeFinalizedEvent(
  event,
  record,
  records,
  recordsByEventId,
  acquisitionRecordsByKey,
  leaseTimelinesByAcquisitionIndex,
  authorizationProvenance,
) {
  return (
    canonicalTaskEventEnvelope(event, "outcome_reservation_finalized") &&
    isCanonicalUuidV4(event.eventId) &&
    exactObjectKeys(event.data, ["outcome", "outcomeDigest", "taskRevision"]) &&
    OUTCOME_TASK_STATES.has(event.data.outcome) &&
    automationActorCanRecordOutcome(event.actor, event.data.outcome) &&
    SHA256_PATTERN.test(event.data.outcomeDigest) &&
    event.data.taskRevision === event.taskRevision &&
    canonicalTaskAuthorizationProvenance(authorizationProvenance, {
      actor: event.actor,
      taskId: event.taskId,
      eventTimestamp: event.ts,
      recordIndex: record.index,
      records,
      recordsByEventId,
      acquisitionRecordsByKey,
      leaseTimelinesByAcquisitionIndex,
    })
  );
}

function cloneLifecycleCursor(cursor) {
  return cursor === undefined ? null : structuredClone(cursor);
}

function canonicalControlEventDigest(event) {
  try {
    return createHash("sha256")
      .update(JSON.stringify(canonicalIntentValue(event)))
      .digest("hex");
  } catch {
    return null;
  }
}

function pinnedControlEventDigest(event, acceptedDigests) {
  const digest = canonicalControlEventDigest(event);
  return digest !== null && acceptedDigests.has(digest);
}

function pinnedLegacyTaskCreatedBehavioral(event) {
  const digest = canonicalControlEventDigest(event);
  return digest === null
    ? undefined
    : PINNED_LEGACY_TASK_CREATED_BEHAVIORAL_BY_DIGEST.get(digest);
}

function pinnedOrphanTaskBehavioral(event) {
  const digest = canonicalControlEventDigest(event);
  return digest === null
    ? undefined
    : PINNED_ORPHAN_TASK_BEHAVIORAL_BY_DIGEST.get(digest);
}

function pinnedOrphanTaskEvent(event) {
  return typeof pinnedOrphanTaskBehavioral(event) === "boolean";
}

function pinnedLegacyActorOutcomeTransition(event) {
  return pinnedControlEventDigest(
    event,
    PINNED_LEGACY_ACTOR_OUTCOME_TRANSITION_DIGESTS,
  );
}

export function inspectExactTaskLifecycleHistory(events) {
  if (!Array.isArray(events)) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      "Task lifecycle inspection requires an event array.",
    );
  }
  const {
    records,
    recordsByEventId,
    acquisitionRecordsByKey,
    leaseTimelinesByAcquisitionIndex,
  } = indexControlEventHistory(events);
  const issues = records.flatMap((record) =>
    record.entry === null ||
    typeof record.entry !== "object" ||
    Array.isArray(record.entry)
      ? [
          `line ${record.lineNumber.toLocaleString()} is not one control event object`,
        ]
      : [],
  );
  const eventIdCounts = new Map(
    [...recordsByEventId].map(([eventId, matches]) => [
      eventId,
      matches.length,
    ]),
  );
  const leaseHistory = inspectExactLeaseEventHistory(records, eventIdCounts);
  issues.push(...leaseHistory.issues);
  const lifecycleByRecordIndex = new Map();
  const canonicalTaskEventIndexes = new Set();
  const currentByTask = new Map();
  const invalidTasks = new Set();
  let lastManifestRevision = null;

  for (const record of records) {
    const event = record.entry;
    if (!TASK_MANIFEST_EVENT_TYPES.has(event?.type)) continue;
    const taskId = event?.taskId;
    const canonicalTaskId =
      typeof taskId === "string" && IDENTIFIER_PATTERN.test(taskId);
    const pinnedHistoricalCheckpoint =
      lastManifestRevision === null &&
      event?.type === "task_transitioned" &&
      pinnedOrphanTaskEvent(event);
    const nextManifestRevision =
      Number.isInteger(event?.manifestRevision) &&
      event.manifestRevision > 0 &&
      (lastManifestRevision === null
        ? event.manifestRevision === 1 || pinnedHistoricalCheckpoint
        : event.manifestRevision === lastManifestRevision + 1);
    if (!nextManifestRevision) {
      issues.push(
        `line ${record.lineNumber.toLocaleString()} does not advance the physical task manifest revision exactly once`,
      );
    }
    if (
      Number.isInteger(event?.manifestRevision) &&
      event.manifestRevision > 0
    ) {
      lastManifestRevision =
        lastManifestRevision === null
          ? event.manifestRevision
          : Math.max(lastManifestRevision, event.manifestRevision);
    }
    const uniqueEventId =
      typeof event?.eventId === "string" &&
      eventIdCounts.get(event.eventId) === 1;
    if (!uniqueEventId) {
      issues.push(
        `line ${record.lineNumber.toLocaleString()} duplicates a task lifecycle event identity`,
      );
    }
    if (!canonicalTaskId) {
      issues.push(
        `line ${record.lineNumber.toLocaleString()} has no canonical task lifecycle identity`,
      );
      continue;
    }

    const before = currentByTask.get(taskId);
    const fail = (message) => {
      invalidTasks.add(taskId);
      issues.push(`line ${record.lineNumber.toLocaleString()} ${message}`);
      lifecycleByRecordIndex.set(record.index, {
        before: cloneLifecycleCursor(before),
        after: null,
        valid: false,
      });
    };
    const commonValid =
      nextManifestRevision && uniqueEventId && !invalidTasks.has(taskId);

    if (event.type === "task_created") {
      if (
        !commonValid ||
        before !== undefined ||
        !canonicalTaskCreatedEvent(
          event,
          record,
          records,
          recordsByEventId,
          acquisitionRecordsByKey,
          leaseTimelinesByAcquisitionIndex,
        )
      ) {
        fail("is not one exact task lifecycle creation");
        continue;
      }
      const after = {
        taskId,
        state: "observed",
        behavioral:
          pinnedLegacyTaskCreatedBehavioral(event) ?? event.data.behavioral,
        ...taskEventAuthoritySnapshot(event),
        taskRevision: event.taskRevision,
        manifestRevision: event.manifestRevision,
        pendingOutcome: null,
        lastTransitionEventId: null,
        lastRecordIndex: record.index,
      };
      currentByTask.set(taskId, after);
      canonicalTaskEventIndexes.add(record.index);
      lifecycleByRecordIndex.set(record.index, {
        before: null,
        after: cloneLifecycleCursor(after),
        valid: true,
      });
      continue;
    }

    const pinnedOrphan =
      before === undefined &&
      commonValid &&
      event.type === "task_transitioned" &&
      pinnedOrphanTaskEvent(event);
    if (pinnedOrphan) {
      const after = {
        taskId,
        state: event.data.toState,
        behavioral: pinnedOrphanTaskBehavioral(event),
        ...taskEventAuthoritySnapshot(event),
        taskRevision: event.taskRevision,
        manifestRevision: event.manifestRevision,
        pendingOutcome: null,
        lastTransitionEventId: event.eventId,
        lastRecordIndex: record.index,
      };
      currentByTask.set(taskId, after);
      canonicalTaskEventIndexes.add(record.index);
      lifecycleByRecordIndex.set(record.index, {
        before: null,
        after: cloneLifecycleCursor(after),
        valid: true,
      });
      continue;
    }

    if (
      !commonValid ||
      before === undefined ||
      before.lastRecordIndex >= record.index ||
      before.manifestRevision >= event.manifestRevision ||
      (event.type !== "task_authority_updated" &&
        !taskAuthoritySnapshotsEqual(before, event))
    ) {
      fail("does not follow one current canonical task lifecycle");
      continue;
    }

    let after;
    if (event.type === "task_authority_updated") {
      if (
        !canonicalTaskAuthorityUpdatedEvent(
          event,
          record,
          records,
          recordsByEventId,
          acquisitionRecordsByKey,
          leaseTimelinesByAcquisitionIndex,
        ) ||
        !taskAuthoritySnapshotsEqual(before, event.data.before) ||
        event.taskRevision !== before.taskRevision + 1
      ) {
        fail("is not the exact next task authority update");
        continue;
      }
      after = {
        ...before,
        ...taskEventAuthoritySnapshot(event.data.after),
        taskRevision: event.taskRevision,
        manifestRevision: event.manifestRevision,
        lastRecordIndex: record.index,
      };
    } else if (event.type === "task_transitioned") {
      if (
        !canonicalTaskTransitionEvent(
          event,
          record,
          records,
          recordsByEventId,
          acquisitionRecordsByKey,
          leaseTimelinesByAcquisitionIndex,
        ) ||
        before.pendingOutcome !== null ||
        event.taskRevision !== before.taskRevision + 1 ||
        event.data.fromState !== before.state
      ) {
        fail("is not the exact next task state transition");
        continue;
      }
      after = {
        ...before,
        state: event.data.toState,
        pendingOutcome:
          event.data.outcomeRequired === true
            ? {
                actor: event.actor,
                outcome: event.data.toState,
                outcomeDigest: event.data.outcomeDigest,
                taskRevision: event.taskRevision,
                transitionEventId: event.eventId,
                authorizationProvenance: structuredClone(
                  event.data.authorizationProvenance,
                ),
              }
            : null,
        lastTransitionEventId: event.eventId,
        taskRevision: event.taskRevision,
        manifestRevision: event.manifestRevision,
        lastRecordIndex: record.index,
      };
    } else if (event.type === "outcome_reservation_created") {
      const legacyRecords =
        recordsByEventId.get(event.data?.legacyTransitionEventId) ?? [];
      const legacyRecord = legacyRecords[0];
      const legacyEvent = legacyRecord?.entry;
      if (
        !canonicalOutcomeReservationEvent(
          event,
          record,
          records,
          recordsByEventId,
          acquisitionRecordsByKey,
          leaseTimelinesByAcquisitionIndex,
        ) ||
        before.pendingOutcome !== null ||
        event.taskRevision !== before.taskRevision + 1 ||
        event.data.toState !== before.state ||
        event.data.legacyTransitionEventId !== before.lastTransitionEventId ||
        legacyRecords.length !== 1 ||
        legacyRecord.index >= record.index ||
        !canonicalTaskEventIndexes.has(legacyRecord.index) ||
        legacyEvent.taskId !== taskId ||
        legacyEvent.taskRevision + 1 !== event.taskRevision ||
        legacyEvent.manifestRevision >= event.manifestRevision ||
        !taskAuthoritySnapshotsEqual(legacyEvent, event) ||
        legacyEvent.data?.toState !== event.data.toState ||
        legacyEvent.data?.outcomeDigest !== undefined ||
        legacyEvent.data?.outcomeRequired !== undefined ||
        (event.data.toState === "merged" &&
          event.data.mergedAt !== legacyEvent.data?.mergedAt) ||
        (event.data.toState === "installed" &&
          (!canonicalValuesEqual(
            event.data.installedIdentity,
            legacyEvent.data?.installedIdentity,
          ) ||
            event.data.installedBuild !== legacyEvent.data?.installedBuild ||
            event.data.installedAt !== legacyEvent.data?.installedAt))
      ) {
        fail("is not the exact next task outcome reservation");
        continue;
      }
      after = {
        ...before,
        pendingOutcome: {
          actor: event.actor,
          outcome: event.data.toState,
          outcomeDigest: event.data.outcomeDigest,
          taskRevision: event.taskRevision,
          transitionEventId: event.eventId,
          authorizationProvenance: structuredClone(
            event.data.authorizationProvenance,
          ),
        },
        taskRevision: event.taskRevision,
        manifestRevision: event.manifestRevision,
        lastRecordIndex: record.index,
      };
    } else {
      const pending = before.pendingOutcome;
      if (
        !canonicalOutcomeFinalizedEvent(
          event,
          record,
          records,
          recordsByEventId,
          acquisitionRecordsByKey,
          leaseTimelinesByAcquisitionIndex,
          pending?.authorizationProvenance,
        ) ||
        event.taskRevision !== before.taskRevision ||
        pending === null ||
        pending.actor !== event.actor ||
        pending.outcome !== event.data.outcome ||
        pending.outcomeDigest !== event.data.outcomeDigest ||
        pending.taskRevision !== event.data.taskRevision ||
        before.state !== event.data.outcome
      ) {
        fail("is not the exact completion of its task outcome reservation");
        continue;
      }
      after = {
        ...before,
        pendingOutcome: null,
        manifestRevision: event.manifestRevision,
        lastRecordIndex: record.index,
      };
    }
    currentByTask.set(taskId, after);
    canonicalTaskEventIndexes.add(record.index);
    lifecycleByRecordIndex.set(record.index, {
      before: cloneLifecycleCursor(before),
      after: cloneLifecycleCursor(after),
      valid: true,
    });
  }

  return {
    records,
    recordsByEventId,
    acquisitionRecordsByKey,
    leaseTimelinesByAcquisitionIndex,
    canonicalLeaseEventsByIndex: leaseHistory.canonicalEventsByIndex,
    leaseHistoryIssues: leaseHistory.issues,
    leaseHistoryHealthy: leaseHistory.healthy,
    eventIdCounts,
    lifecycleByRecordIndex,
    canonicalTaskEventIndexes,
    currentByTask,
    lastManifestRevision,
    issues,
    healthy: issues.length === 0,
  };
}

export function outcomeRecordedEventId({
  taskId,
  taskRevision,
  outcomeDigest,
  transitionEventId,
}) {
  requireIdentifier(taskId, "taskId");
  requirePositiveInteger(taskRevision, "taskRevision");
  const normalizedDigest = String(outcomeDigest ?? "");
  if (!SHA256_PATTERN.test(normalizedDigest)) {
    throw new AutomationControlError(
      "invalid_value",
      "outcomeDigest must be a 64 character hexadecimal digest.",
    );
  }
  requireIdentifier(transitionEventId, "transitionEventId");
  return `outcome-recorded:${createHash("sha256")
    .update(
      JSON.stringify({
        taskId,
        taskRevision,
        outcomeDigest: normalizedDigest,
        transitionEventId,
      }),
    )
    .digest("hex")}`;
}

function canonicalOutcomeEvidence(value) {
  const digest = value?.digest;
  const verdictReference = value?.verdictReference;
  const verdictFingerprint = value?.verdictFingerprint;
  const expectedKeys = [
    ...(digest === undefined ? [] : ["digest"]),
    ...(verdictReference === undefined ? [] : ["verdictReference"]),
    ...(verdictFingerprint === undefined ? [] : ["verdictFingerprint"]),
  ];
  return (
    exactObjectKeys(value, expectedKeys) &&
    (digest !== undefined || verdictReference !== undefined) &&
    (digest === undefined || OUTCOME_EVIDENCE_DIGEST_PATTERN.test(digest)) &&
    (verdictReference === undefined ||
      (typeof verdictReference === "string" &&
        verdictReference.trim() !== "" &&
        verdictReference === verdictReference.trim())) &&
    (verdictFingerprint === undefined ||
      SHA256_PATTERN.test(verdictFingerprint))
  );
}

function canonicalOutcomeRecordedEvent(event, ledgerPath = undefined) {
  const data = event?.data;
  const policy = AUTOMATION_ACTOR_POLICIES[event?.actor];
  if (
    !exactObjectKeys(event, [
      "actor",
      "data",
      "eventId",
      "schemaVersion",
      "taskId",
      "ts",
      "type",
    ]) ||
    !exactObjectKeys(data, [
      "evidence",
      "id",
      "kind",
      "leaseName",
      "ledgerPath",
      "outcome",
      "outcomeDigest",
      "taskId",
      "taskRevision",
      "taskState",
      "transitionEventId",
    ]) ||
    event.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    event.type !== "outcome_recorded" ||
    !isCanonicalIsoTimestamp(event.ts) ||
    !(
      typeof event.taskId === "string" && IDENTIFIER_PATTERN.test(event.taskId)
    ) ||
    data.taskId !== event.taskId ||
    !Number.isInteger(data.taskRevision) ||
    data.taskRevision < 1 ||
    data.taskState !== data.outcome ||
    !OUTCOME_TASK_STATES.has(data.outcome) ||
    typeof data.id !== "string" ||
    data.id.trim() === "" ||
    data.id !== data.id.trim() ||
    typeof data.kind !== "string" ||
    data.kind.trim() === "" ||
    data.kind !== data.kind.trim() ||
    typeof data.ledgerPath !== "string" ||
    !path.isAbsolute(data.ledgerPath) ||
    path.resolve(data.ledgerPath) !== data.ledgerPath ||
    (ledgerPath !== undefined && data.ledgerPath !== ledgerPath) ||
    !SHA256_PATTERN.test(data.outcomeDigest) ||
    !(
      typeof data.transitionEventId === "string" &&
      IDENTIFIER_PATTERN.test(data.transitionEventId)
    ) ||
    !canonicalOutcomeEvidence(data.evidence) ||
    !automationActorCanRecordOutcome(event.actor, data.outcome) ||
    data.leaseName !== policy.leaseName
  ) {
    return false;
  }
  try {
    const deterministicId = outcomeRecordedEventId({
      taskId: event.taskId,
      taskRevision: data.taskRevision,
      outcomeDigest: data.outcomeDigest,
      transitionEventId: data.transitionEventId,
    });
    return (
      event.eventId === deterministicId || isCanonicalUuidV4(event.eventId)
    );
  } catch {
    return false;
  }
}

function canonicalPinnedLegacyActorOutcomeEvent(event, transition) {
  return (
    event.eventId === PINNED_LEGACY_ACTOR_OUTCOME_EVENT_ID &&
    event.ts === transition.ts &&
    event.actor === "freed-nightly-runner" &&
    event.taskId === "authenticated-essay-capture-pr-642" &&
    canonicalValuesEqual(event.data, {
      id: "legacy-authenticated-ordinary-outcome",
      taskId: "authenticated-essay-capture-pr-642",
      taskRevision: 6,
      taskState: "merged",
      kind: "stability",
      outcome: "merged",
      ledgerPath: event.data.ledgerPath,
      leaseName: "nightly-writer",
      evidence: { digest: "a".repeat(64) },
      outcomeDigest:
        "07183438d93892d47c2e8c99cd32490d50389fe448208ff7b5450b3930cfb60f",
      transitionEventId: "11111111-2222-4333-8444-555555555555",
    })
  );
}

export function inspectExactOutcomeControlHistory(
  events,
  { ledgerPath = undefined, stateRoot = undefined } = {},
) {
  const lifecycle = inspectExactTaskLifecycleHistory(events);
  const issues = [...lifecycle.issues];
  const canonicalOutcomeEventIndexes = new Set();
  const outcomes = new Map();
  const transitions = new Map();
  const canonicalOutcomeLedgerRepairEventIndexes = new Set();
  const outcomeLedgerRepairEventsById = new Map();
  const ownerLeaseLineageByRecordIndex = new Map(
    [...lifecycle.canonicalLeaseEventsByIndex].filter(([, descriptor]) => {
      const event = descriptor.event;
      return (
        event.actor === "freed-owner" &&
        event.leaseName === "owner-governance" &&
        descriptor.kind !== "scope"
      );
    }),
  );
  const requiredPinnedLegacyOutcomeEventIds = new Set();

  for (const record of lifecycle.records) {
    const event = record.entry;
    const eventId = typeof event?.eventId === "string" ? event.eventId : "";
    const reservedOutcomeIdentity =
      event?.type === "outcome_recorded" ||
      eventId.startsWith("outcome-recorded:");
    const reservedTransitionIdentity =
      event?.type === "outcome_reservation_created" ||
      eventId.startsWith("task-outcome-reserved:");
    if (reservedTransitionIdentity) {
      if (!lifecycle.canonicalTaskEventIndexes.has(record.index)) {
        issues.push(
          `line ${record.lineNumber.toLocaleString()} is not one exact canonical outcome reservation`,
        );
      } else {
        transitions.set(eventId, event);
      }
      continue;
    }
    if (!reservedOutcomeIdentity) {
      if (
        event?.type === "task_transitioned" &&
        lifecycle.canonicalTaskEventIndexes.has(record.index) &&
        OUTCOME_TASK_STATES.has(event.data?.toState)
      ) {
        transitions.set(eventId, event);
        if (pinnedLegacyActorOutcomeTransition(event)) {
          try {
            requiredPinnedLegacyOutcomeEventIds.add(
              outcomeRecordedEventId({
                taskId: event.taskId,
                taskRevision: event.taskRevision,
                outcomeDigest: event.data.outcomeDigest,
                transitionEventId: event.eventId,
              }),
            );
          } catch {
            issues.push(
              `line ${record.lineNumber.toLocaleString()} has no deterministic pinned legacy outcome identity`,
            );
          }
        }
      }
      continue;
    }
    if (
      lifecycle.eventIdCounts.get(eventId) !== 1 ||
      !canonicalOutcomeRecordedEvent(event, ledgerPath)
    ) {
      issues.push(
        `line ${record.lineNumber.toLocaleString()} is not one exact canonical outcome control event`,
      );
      continue;
    }
    const transitionRecords =
      lifecycle.recordsByEventId.get(event.data.transitionEventId) ?? [];
    const transitionRecord = transitionRecords[0];
    const transition = transitionRecord?.entry;
    const pinnedLegacyTransition =
      transition !== undefined &&
      pinnedLegacyActorOutcomeTransition(transition);
    const deterministicRequired =
      transition?.type === "outcome_reservation_created" ||
      transition?.data?.outcomeRequired === true ||
      pinnedLegacyTransition;
    let deterministicId;
    try {
      deterministicId = outcomeRecordedEventId({
        taskId: event.taskId,
        taskRevision: event.data.taskRevision,
        outcomeDigest: event.data.outcomeDigest,
        transitionEventId: event.data.transitionEventId,
      });
    } catch {
      deterministicId = null;
    }
    if (
      transitionRecords.length !== 1 ||
      transitionRecord.index >= record.index ||
      !lifecycle.canonicalTaskEventIndexes.has(transitionRecord.index) ||
      !["task_transitioned", "outcome_reservation_created"].includes(
        transition.type,
      ) ||
      transition.actor !== event.actor ||
      transition.taskId !== event.taskId ||
      transition.taskRevision !== event.data.taskRevision ||
      transition.data?.toState !== event.data.outcome ||
      transition.data?.outcomeDigest !== event.data.outcomeDigest ||
      (pinnedLegacyTransition
        ? !canonicalPinnedLegacyActorOutcomeEvent(event, transition)
        : !canonicalTaskAuthorizationProvenance(
            transition.data?.authorizationProvenance,
            {
              actor: event.actor,
              taskId: event.taskId,
              eventTimestamp: event.ts,
              recordIndex: record.index,
              records: lifecycle.records,
              recordsByEventId: lifecycle.recordsByEventId,
              acquisitionRecordsByKey: lifecycle.acquisitionRecordsByKey,
              leaseTimelinesByAcquisitionIndex:
                lifecycle.leaseTimelinesByAcquisitionIndex,
            },
          )) ||
      (deterministicRequired && event.eventId !== deterministicId)
    ) {
      issues.push(
        `line ${record.lineNumber.toLocaleString()} has no exact preceding canonical outcome transition`,
      );
      continue;
    }
    canonicalOutcomeEventIndexes.add(record.index);
    outcomes.set(eventId, event);
  }
  for (const eventId of requiredPinnedLegacyOutcomeEventIds) {
    if (!outcomes.has(eventId)) {
      const transition = [...transitions.values()].find(
        (candidate) =>
          pinnedLegacyActorOutcomeTransition(candidate) &&
          outcomeRecordedEventId({
            taskId: candidate.taskId,
            taskRevision: candidate.taskRevision,
            outcomeDigest: candidate.data.outcomeDigest,
            transitionEventId: candidate.eventId,
          }) === eventId,
      );
      const record = lifecycle.records.find(
        (candidate) => candidate.entry === transition,
      );
      issues.push(
        `line ${(record?.lineNumber ?? 0).toLocaleString()} pinned legacy outcome transition has no one exact linked outcome control event`,
      );
    }
  }
  for (const record of lifecycle.records) {
    const event = record.entry;
    const eventId = typeof event?.eventId === "string" ? event.eventId : "";
    const reservedRepairIdentity =
      event?.type === OUTCOME_LEDGER_REPAIR_EVENT_TYPE ||
      eventId.startsWith("outcome-history-repaired:");
    if (!reservedRepairIdentity) continue;
    const matches = lifecycle.recordsByEventId.get(eventId) ?? [];
    if (
      matches.length !== 1 ||
      event?.type !== OUTCOME_LEDGER_REPAIR_EVENT_TYPE
    ) {
      issues.push(
        `line ${record.lineNumber.toLocaleString()} is not one exact canonical outcome ledger repair event`,
      );
      continue;
    }
    try {
      const repairStateRoot = stateRoot ?? event.data?.parameters?.stateRoot;
      const canonical = validateOutcomeLedgerRepairEventWithHistoryIndex(
        event,
        {
          stateRoot: repairStateRoot,
          taskId: event.taskId,
          parameters: event.data?.parameters,
          intentDigest: event.data?.intentDigest,
          historyIndex: lifecycle,
          recordIndex: record.index,
        },
      );
      canonicalOutcomeLedgerRepairEventIndexes.add(record.index);
      outcomeLedgerRepairEventsById.set(
        eventId,
        Object.freeze({
          event: Object.freeze(canonical),
          recordIndex: record.index,
          lineNumber: record.lineNumber,
        }),
      );
    } catch (error) {
      issues.push(
        `line ${record.lineNumber.toLocaleString()} has invalid outcome ledger repair authority: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return {
    ...lifecycle,
    issues,
    healthy: issues.length === 0,
    canonicalOutcomeEventIndexes,
    requiredPinnedLegacyOutcomeEventIds,
    outcomes,
    transitions,
    canonicalOutcomeLedgerRepairEventIndexes,
    outcomeLedgerRepairEventsById,
    ownerLeaseLineageByRecordIndex,
    ownerLeaseLineageHealthy: lifecycle.leaseHistoryHealthy,
  };
}

function taskLifecycleCursorMatchesManifest(cursor, task) {
  if (
    cursor === undefined ||
    cursor.taskId !== task.taskId ||
    cursor.state !== task.state ||
    cursor.taskRevision !== task.revision ||
    cursor.behavioral !== taskBehavioralClassification(task) ||
    !taskAuthoritySnapshotsEqual(cursor, task)
  ) {
    return false;
  }
  const expectedPending = task.pendingOutcome ?? null;
  if (expectedPending === null) return cursor.pendingOutcome === null;
  return (
    cursor.pendingOutcome !== null &&
    cursor.pendingOutcome.outcome === expectedPending.outcome &&
    cursor.pendingOutcome.outcomeDigest === expectedPending.outcomeDigest &&
    cursor.pendingOutcome.taskRevision === expectedPending.taskRevision
  );
}

function inspectTaskManifestHistoryParity(lifecycle, manifest) {
  const issues = [...lifecycle.issues];
  const manifestByTask = new Map();
  let validatedManifest = null;
  try {
    validatedManifest = validateTaskManifest(structuredClone(manifest));
    for (const task of validatedManifest.tasks) {
      manifestByTask.set(task.taskId, task);
    }
  } catch (error) {
    issues.push(
      `task manifest is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const historyTaskIds = new Set(lifecycle.currentByTask.keys());
  const manifestTaskIds = new Set(manifestByTask.keys());
  if (validatedManifest !== null) {
    const historyRevision = lifecycle.lastManifestRevision ?? 0;
    if (historyRevision !== validatedManifest.revision) {
      issues.push(
        `task manifest revision ${validatedManifest.revision.toLocaleString()} does not match exact history revision ${historyRevision.toLocaleString()}`,
      );
    }
    for (const taskId of historyTaskIds) {
      if (!manifestTaskIds.has(taskId)) {
        issues.push(
          `exact task history contains ${taskId}, which is absent from the manifest`,
        );
      }
    }
    for (const [taskId, task] of manifestByTask) {
      const cursor = lifecycle.currentByTask.get(taskId);
      if (cursor === undefined) {
        issues.push(
          `task manifest contains ${taskId}, which is absent from exact history`,
        );
      } else if (!taskLifecycleCursorMatchesManifest(cursor, task)) {
        issues.push(
          `task manifest record ${taskId} does not match its exact history cursor`,
        );
      }
    }
  }

  return {
    ...lifecycle,
    issues,
    healthy: issues.length === 0,
    validatedManifest,
    manifestByTask,
    manifestTaskIds,
    historyTaskIds,
  };
}

export function inspectExactTaskManifestHistoryParity(events, manifest) {
  return inspectTaskManifestHistoryParity(
    inspectExactTaskLifecycleHistory(events),
    manifest,
  );
}

function requireExactOutcomeHistoryForTask({
  events,
  ledgerPath,
  manifest,
  task,
  errorCode,
  message,
}) {
  const inspection = inspectTaskManifestHistoryParity(
    inspectExactOutcomeControlHistory(events, { ledgerPath }),
    manifest,
  );
  const cursor = inspection.currentByTask.get(task.taskId);
  if (
    !inspection.healthy ||
    !taskLifecycleCursorMatchesManifest(cursor, task)
  ) {
    throw new AutomationControlError(errorCode, message, {
      taskId: task.taskId,
      historyIssues: inspection.issues,
    });
  }
  return inspection;
}

function requireLeaseAuthorizedEventTime(lease, eventNowMs) {
  const acquiredAtMs = Date.parse(lease.acquiredAt);
  const expiresAtMs = Date.parse(lease.expiresAt);
  if (
    !Number.isFinite(eventNowMs) ||
    !Number.isFinite(acquiredAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    eventNowMs < acquiredAtMs ||
    eventNowMs >= expiresAtMs
  ) {
    throw new AutomationControlError(
      "lease_event_time_invalid",
      `Control event timestamp must be within lease ${lease.name}'s authority window.`,
      {
        leaseName: lease.name,
        eventTimestamp:
          Number.isFinite(eventNowMs) &&
          !Number.isNaN(new Date(eventNowMs).getTime())
            ? new Date(eventNowMs).toISOString()
            : null,
        acquiredAt: lease.acquiredAt,
        expiresAt: lease.expiresAt,
      },
    );
  }
}

function leaseAuthorizationProvenance(lease, eventNowMs) {
  requireLeaseAuthorizedEventTime(lease, eventNowMs);
  return {
    leaseName: lease.name,
    leaseAcquiredAt: lease.acquiredAt,
    credentialKind: lease.credentialKind,
    ...(lease.launcherSha256 === undefined
      ? {}
      : {
          launcherSha256: lease.launcherSha256,
          actorRuntimeDigest: lease.actorRuntimeDigest,
          launcherChannelProtocol: lease.launcherChannelProtocol,
          launcherAttestationSha256: lease.launcherAttestationSha256,
          launcherSessionId: lease.launcherSessionId,
        }),
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
      ? {
          installedIdentity: structuredClone(
            parameters.cleanEntry.buildIdentity,
          ),
        }
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
      if (!canonicalValuesEqual(task, parameters.sourceTask)) {
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
      const expectedEventId = outcomeRecordedEventId({
        taskId,
        taskRevision,
        outcomeDigest: parameters.outcomeDigest,
        transitionEventId: transition.eventId,
      });
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
  { beforeCommit = () => {}, eventsGuard = undefined } = {},
) {
  const admitNoPendingAuthorityStages = () => {
    admitControlEventAuthorityStage(paths);
    admitTaskManifestAuthorityStage(paths);
  };
  admitNoPendingAuthorityStages();
  const manifestAdmission = readTaskManifestSnapshotUnchecked({
    stateRoot: paths.stateRoot,
    nowMs,
  });
  const manifest = manifestAdmission.manifest;
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
  const readmitAuthorityStages = () => {
    admitControlEventAuthorityStage(paths, {
      expectedPendingEvents: [transaction.event],
    });
    admitTaskManifestAuthorityStage(paths, {
      expectedPendingTransactions: [transaction],
    });
  };
  requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
  admitNoPendingAuthorityStages();
  mkdirSync(paths.taskTransactions, { recursive: true, mode: 0o700 });
  const transactionPath = path.join(
    paths.taskTransactions,
    `${String(mutation.manifest.revision).padStart(12, "0")}-${transactionId}.json`,
  );
  const missingTransaction = readAutomationAuthorityFileSnapshot(
    transactionPath,
    {
      allowMissing: true,
      allowEmpty: true,
      privateRoot: paths.controlRoot,
      maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
      allowedModes: [0o600],
      label: `Task transaction ${transactionId}`,
    },
  );
  if (!missingTransaction.missing) {
    throw new AutomationControlError(
      "transaction_conflict",
      `Task transaction ${transactionId} already exists.`,
    );
  }
  requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
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
  prepareControlEventAppend(
    eventSnapshot.bytes,
    eventSnapshot.recordCount,
    event,
  );
  beforeCommit();
  admitNoPendingAuthorityStages();
  const transactionSnapshot = writeJsonAtomic(transactionPath, transaction, {
    expectedSnapshot: missingTransaction,
    operationId: `task-transaction:${transactionId}`,
    privateRoot: paths.controlRoot,
    label: `Task transaction ${transactionId}`,
  });
  beforeCommit();
  readmitAuthorityStages();
  writeJsonAtomic(paths.taskManifest, mutation.manifest, {
    expectedSnapshot: manifestAdmission.snapshot,
    operationId: `task-manifest:${transactionId}`,
    privateRoot: paths.controlRoot,
    label: "Current task manifest",
    validateStageSuccessor: (before, after) =>
      requireTaskManifestSemanticSuccessor(paths, before, after),
    buildStagePendingPlans: () => [
      Object.freeze({
        operationId: `task-manifest:${transactionId}`,
        proposedBytes: privateJsonBytes(transaction.targetManifest),
      }),
    ],
  });
  beforeCommit();
  readmitAuthorityStages();
  appendEventLineUnlocked(paths, event, eventSnapshot, {
    beforeRename: beforeCommit,
    eventsGuard,
  });
  readmitAuthorityStages();
  removeAutomationAuthorityFile({
    filePath: transactionPath,
    snapshot: transactionSnapshot,
    operationId: `task-transaction-retire:${transactionId}`,
    privateRoot: paths.controlRoot,
    maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
    allowedModes: [0o600],
    label: `Task transaction ${transactionId}`,
    beforeRemove: beforeCommit,
  });
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
  { beforeAccess = null, beforeCommit = () => {}, guardContext = null } = {},
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
      eventsGuard: guardContext.eventsGuard,
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
      return withActiveAutomationEventsGuard(
        paths,
        (eventsGuard) =>
          mutateTaskManifestUnderGuards(paths, nowMs, callback, {
            beforeCommit,
            eventsGuard,
          }),
        { now: () => nowMs },
      );
    },
    { now: () => nowMs },
  );
}

export function withOutcomeRecordingGuards(
  { stateRoot, nowMs = Date.now(), ownerIntent = null, authorityContext },
  callback,
) {
  if (typeof callback !== "function") {
    throw new AutomationControlError(
      "invalid_argument",
      "Outcome recording guards require a callback.",
    );
  }
  const paths = automationControlPaths(stateRoot);
  requireOutsideAutomationPlanningReadScope(
    paths.stateRoot,
    "Outcome recording guards",
  );
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
      return withActiveAutomationEventsGuard(
        paths,
        (eventsGuard) => {
          authorityContext.reauthorize();
          requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
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
            eventsGuard,
          };
          try {
            const result = callback({
              reauthorize: () => {
                requireActive();
                return authorityContext.reauthorize();
              },
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
    return mutateTaskManifest(
      stateRoot,
      nowMs,
      (manifest) => {
        const { lease } = authorize();
        const existing = manifest.tasks.find((task) => task.taskId === taskId);
        if (existing) {
          const idempotent =
            existing.state === state &&
            existing.observerAuthority === observerAuthority &&
            existing.providerAuthority === providerAuthority &&
            existing.providerApprovalReference ===
              normalizedApprovalReference &&
            taskBehavioralClassification(existing) === behavioral &&
            JSON.stringify(existing.details) ===
              JSON.stringify(normalizedDetails);
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
            behavioral,
            state,
            authorizationProvenance: leaseAuthorizationProvenance(lease, nowMs),
            ...(normalizedApprovalReference === undefined
              ? {}
              : { approvalReference: normalizedApprovalReference }),
          },
        };
      },
      { beforeCommit: authorize },
    );
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

    return mutateTaskManifest(
      stateRoot,
      nowMs,
      (manifest) => {
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
        if (
          expectedRevision !== undefined &&
          task.revision !== expectedRevision
        ) {
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
        const historySnapshot = readControlEventHistorySnapshot(paths.events);
        const historyInspection = requireExactOutcomeHistoryForTask({
          events: historySnapshot.events,
          ledgerPath: paths.outcomes,
          manifest,
          task,
          errorCode: "outcome_reservation_mismatch",
          message: `Task ${taskId} outcome backfill requires one exact healthy lifecycle history.`,
        });
        const legacyMatches =
          historyInspection.recordsByEventId.get(legacyTransitionEventId) ?? [];
        if (legacyMatches.length !== 1) {
          throw new AutomationControlError(
            "outcome_reservation_mismatch",
            `Task ${taskId} requires one exact legacy lifecycle transition for outcome backfill.`,
            { taskId, outcome, legacyTransitionEventId },
          );
        }
        const [legacyRecord] = legacyMatches;
        const legacyTransition = legacyRecord.entry;
        const lifecycle = historyInspection.lifecycleByRecordIndex.get(
          legacyRecord.index,
        );
        if (
          lifecycle?.valid !== true ||
          !historyInspection.canonicalTaskEventIndexes.has(
            legacyRecord.index,
          ) ||
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
        const existingOutcomeLinks = [
          ...historyInspection.outcomes.values(),
        ].filter(
          (event) => event.data?.transitionEventId === legacyTransitionEventId,
        );
        if (existingOutcomeLinks.length !== 0) {
          throw new AutomationControlError(
            "outcome_reservation_mismatch",
            `Task ${taskId} legacy lifecycle transition already has an authenticated outcome.`,
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
            authorizationProvenance: leaseAuthorizationProvenance(lease, nowMs),
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
      },
      { beforeCommit: authorize, guardContext },
    );
  };
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    guardContext.authorityContext,
    execute,
  );
}

function requireTaskTransitionAuthority(task, toState) {
  const requiredAuthority = TRANSITION_AUTHORITY_REQUIREMENTS[toState];
  if (!taskObserverAuthorityAllowsTransition(task.observerAuthority, toState)) {
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

    return mutateTaskManifest(
      stateRoot,
      nowMs,
      (manifest) => {
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
        if (
          expectedRevision !== undefined &&
          task.revision !== expectedRevision
        ) {
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
        if (
          nextBehavioral === true &&
          ACTIVE_BEHAVIOR_TASK_STATES.has(toState)
        ) {
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
          !taskProviderAuthorityAllowsTransition(
            task.providerAuthority,
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
            ["merged", "installed", "soaking", "inconclusive"].includes(
              task.state,
            ))
        ) {
          throw new AutomationControlError(
            "behavior_outcome_required",
            `Merged behavioral task ${taskId} cannot leave the behavior slot before a conclusive verifier outcome.`,
            { taskId, state: task.state },
          );
        }
        if (task.state === "closed" && toState === "triaged") {
          const evidenceWindowEnd = normalizedDetails?.evidenceWindowEnd;
          const evidenceWindowEndMs = Date.parse(
            String(evidenceWindowEnd ?? ""),
          );
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
          installedIdentity =
            normalizeInstalledBuildIdentity(installedIdentity);
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
            authorizationProvenance: leaseAuthorizationProvenance(lease, nowMs),
            ...(outcomeWriterTransition ? { outcomeRequired: true } : {}),
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
      },
      { beforeCommit: authorize, guardContext },
    );
  };
  return withMutationLeaseAuthorityIfNeeded(
    authority,
    guardContext?.authorityContext ?? null,
    execute,
  );
}

function readCanonicalOutcomeLedgerSnapshot(filePath) {
  if (
    typeof constants.O_NOFOLLOW !== "number" ||
    typeof constants.O_NONBLOCK !== "number"
  ) {
    throw new AutomationControlError(
      "outcome_not_durable",
      "Safe nonblocking canonical outcome ledger admission is unavailable.",
      { filePath },
    );
  }
  let descriptor;
  try {
    descriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    throw new AutomationControlError(
      "outcome_not_durable",
      `Canonical outcome ledger is unavailable or unsafe: ${filePath}`,
      {
        filePath,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  try {
    const before = fstatSync(descriptor);
    const expectedUid =
      typeof process.getuid === "function" ? process.getuid() : before.uid;
    if (
      !before.isFile() ||
      before.uid !== expectedUid ||
      before.nlink !== 1 ||
      ![0o600, 0o640, 0o644].includes(before.mode & 0o7777) ||
      before.size < 0 ||
      before.size > OUTCOME_LEDGER_REPAIR_MAX_BYTES ||
      realpathSync(filePath) !== filePath
    ) {
      throw new AutomationControlError(
        "outcome_not_durable",
        `Canonical outcome ledger is unsafe: ${filePath}`,
        { filePath },
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
      after.nlink !== 1 ||
      current.isSymbolicLink() ||
      current.nlink !== 1 ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      realpathSync(filePath) !== filePath
    ) {
      throw new AutomationControlError(
        "outcome_not_durable",
        `Canonical outcome ledger changed while read: ${filePath}`,
        { filePath },
      );
    }
    let text;
    try {
      text = controlEventHistoryDecoder.decode(buffer.subarray(0, offset));
    } catch {
      throw new AutomationControlError(
        "outcome_not_durable",
        "Canonical outcome ledger is not valid UTF-8.",
        { filePath },
      );
    }
    const entries = [];
    const lines = text.split(/\r?\n/);
    const physicalLineCount =
      text.length === 0
        ? 0
        : lines.length - (lines[lines.length - 1] === "" ? 1 : 0);
    if (physicalLineCount > OUTCOME_LEDGER_REPAIR_MAX_LINES) {
      throw new AutomationControlError(
        "outcome_not_durable",
        "Canonical outcome ledger exceeds the supported physical line boundary.",
        { filePath },
      );
    }
    for (const [index, raw] of lines.entries()) {
      const isTrailingTerminator =
        index === lines.length - 1 && raw.length === 0;
      if (isTrailingTerminator) continue;
      if (!raw.trim()) {
        throw new AutomationControlError(
          "outcome_not_durable",
          `Canonical outcome ledger contains a blank physical line at ${(index + 1).toLocaleString()}.`,
          { filePath, line: index + 1 },
        );
      }
      try {
        entries.push(JSON.parse(raw));
      } catch {
        throw new AutomationControlError(
          "outcome_not_durable",
          `Canonical outcome ledger contains malformed JSON on line ${(index + 1).toLocaleString()}.`,
          { filePath, line: index + 1 },
        );
      }
    }
    return { bytes: buffer.subarray(0, offset), entries };
  } catch (error) {
    if (error instanceof AutomationControlError) throw error;
    throw new AutomationControlError(
      "outcome_not_durable",
      `Canonical outcome ledger admission failed: ${filePath}`,
      {
        filePath,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  } finally {
    closeSync(descriptor);
  }
}

function outcomeLedgerEntryDigest(entry) {
  const { authentication: _authentication, ...digestible } = entry;
  return createHash("sha256").update(JSON.stringify(digestible)).digest("hex");
}

function canonicalOutcomeLedgerEntry(entry) {
  const requiredKeys = [
    "authentication",
    "evidence",
    "id",
    "kind",
    "notes",
    "outcome",
    "schemaVersion",
    "taskId",
    "ts",
  ];
  const optionalKeys = [
    "build",
    "buildIdentity",
    "effect",
    "evidenceWindowEnd",
    "pr",
    "runDir",
  ];
  const keys = Object.keys(entry ?? {});
  if (
    requiredKeys.some((key) => !keys.includes(key)) ||
    keys.some(
      (key) => !requiredKeys.includes(key) && !optionalKeys.includes(key),
    ) ||
    entry.schemaVersion !== OUTCOME_LEDGER_SCHEMA_VERSION ||
    !isCanonicalIsoTimestamp(entry.ts) ||
    !(
      typeof entry.taskId === "string" && IDENTIFIER_PATTERN.test(entry.taskId)
    ) ||
    typeof entry.id !== "string" ||
    entry.id.trim() === "" ||
    entry.id !== entry.id.trim() ||
    typeof entry.kind !== "string" ||
    entry.kind.trim() === "" ||
    entry.kind !== entry.kind.trim() ||
    !OUTCOME_TASK_STATES.has(entry.outcome) ||
    typeof entry.notes !== "string" ||
    !canonicalOutcomeEvidence(entry.evidence) ||
    !exactObjectKeys(entry.authentication, [
      "actor",
      "controlEventId",
      "leaseName",
      "outcomeDigest",
      "taskRevision",
      "transitionEventId",
    ]) ||
    !SHA256_PATTERN.test(entry.authentication.outcomeDigest) ||
    !Number.isInteger(entry.authentication.taskRevision) ||
    entry.authentication.taskRevision < 1 ||
    !(
      typeof entry.authentication.controlEventId === "string" &&
      IDENTIFIER_PATTERN.test(entry.authentication.controlEventId)
    ) ||
    !(
      typeof entry.authentication.transitionEventId === "string" &&
      IDENTIFIER_PATTERN.test(entry.authentication.transitionEventId)
    ) ||
    (entry.build === undefined) !== (entry.buildIdentity === undefined)
  ) {
    return false;
  }
  if (
    entry.evidenceWindowEnd !== undefined &&
    entry.evidenceWindowEnd !== null
  ) {
    if (!isCanonicalIsoTimestamp(entry.evidenceWindowEnd)) return false;
  }
  if (entry.buildIdentity !== undefined) {
    try {
      const identity = normalizeInstalledBuildIdentity(
        entry.buildIdentity,
        "outcome buildIdentity",
      );
      if (
        !canonicalValuesEqual(identity, entry.buildIdentity) ||
        entry.build !== identity.version
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }
  try {
    canonicalIntentValue(entry);
    return true;
  } catch {
    return false;
  }
}

function requireDurableOutcomeReservation({
  paths,
  manifest,
  task,
  actor,
  leaseName,
  outcome,
  outcomeDigest,
  taskRevision,
}) {
  const ledgerEntries = readCanonicalOutcomeLedgerSnapshot(
    paths.outcomes,
  ).entries;
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
    !canonicalOutcomeLedgerEntry(entry) ||
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

  let events;
  try {
    events = readControlEventHistorySnapshot(paths.events).events;
  } catch (error) {
    throw new AutomationControlError(
      "outcome_not_durable",
      "Automation control event history is unavailable or unsafe.",
      {
        filePath: paths.events,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  const historyInspection = requireExactOutcomeHistoryForTask({
    events,
    ledgerPath: paths.outcomes,
    manifest,
    task,
    errorCode: "outcome_not_durable",
    message: `Task ${task.taskId} outcome requires one exact healthy lifecycle history.`,
  });
  const controlEvents =
    historyInspection.recordsByEventId.get(authentication.controlEventId) ?? [];
  const transitionEvents =
    historyInspection.recordsByEventId.get(authentication.transitionEventId) ??
    [];
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
  const [controlRecord] = controlEvents;
  const [transitionRecord] = transitionEvents;
  const controlEvent = controlRecord.entry;
  const transitionEvent = transitionRecord.entry;
  if (
    !historyInspection.canonicalOutcomeEventIndexes.has(controlRecord.index) ||
    !historyInspection.canonicalTaskEventIndexes.has(transitionRecord.index) ||
    transitionRecord.index >= controlRecord.index
  ) {
    throw new AutomationControlError(
      "outcome_not_durable",
      `Task ${task.taskId} outcome does not follow one exact physical event order.`,
      { taskId: task.taskId, outcome, taskRevision },
    );
  }
  const reservationEvent =
    transitionEvent.type === "outcome_reservation_created" &&
    transitionEvent.data?.outcomeBackfill === true &&
    typeof transitionEvent.data?.legacyTransitionEventId === "string";
  const legacyReservationTransitions = reservationEvent
    ? (historyInspection.recordsByEventId.get(
        transitionEvent.data.legacyTransitionEventId,
      ) ?? [])
    : [];
  const legacyReservationRecord = legacyReservationTransitions[0];
  const legacyReservationTransition = legacyReservationRecord?.entry;
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
          legacyTransitionEventId: transitionEvent.data.legacyTransitionEventId,
        });
    } catch {
      validReservationEventId = false;
    }
  }
  const validLegacyReservation =
    !reservationEvent ||
    (legacyReservationTransitions.length === 1 &&
      legacyReservationRecord.index < transitionRecord.index &&
      historyInspection.canonicalTaskEventIndexes.has(
        legacyReservationRecord.index,
      ) &&
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
      ownerOperationIntentDigest(actor, "task.finalize-outcome", taskId, {
        outcome,
        outcomeDigest: normalizedDigest,
        taskRevision,
      }),
  };
  const execute = (authorityContext) => {
    const authorize = () => {
      const { lease, policy } = requireMutationLease({
        ...authority,
        authorityContext,
      });
      requireLeaseAuthorizedEventTime(lease, nowMs);
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
    return mutateTaskManifest(
      paths.stateRoot,
      nowMs,
      (manifest) => {
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
          String(
            task.details?.latestOutcome?.outcomeDigest ?? "",
          ).toLowerCase() === normalizedDigest;
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
            manifest,
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
          manifest,
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
      },
      { beforeCommit: authorize, guardContext },
    );
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
    return mutateTaskManifest(
      stateRoot,
      nowMs,
      (manifest) => {
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
        if (
          expectedRevision !== undefined &&
          task.revision !== expectedRevision
        ) {
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
        const nextObserverAuthority =
          observerAuthority ?? task.observerAuthority;
        const nextProviderAuthority =
          providerAuthority ?? task.providerAuthority;
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
                : {
                    providerApprovalReference: task.providerApprovalReference,
                  }),
            },
            reason: normalizedReason,
            authorizationProvenance: leaseAuthorizationProvenance(lease, nowMs),
            ...(normalizedApprovalReference === undefined
              ? {}
              : { approvalReference: normalizedApprovalReference }),
          },
        };
      },
      { beforeCommit: authorize },
    );
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

function normalizePublisherScope(
  scope,
  { requireHead = false, requireLiveWorktree = true } = {},
) {
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
  let physicalWorktree = normalized.worktree;
  if (requireLiveWorktree) {
    try {
      physicalWorktree = realpathSync(normalized.worktree);
    } catch {
      physicalWorktree = "";
    }
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
    path.normalize(normalized.worktree) !== normalized.worktree ||
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
  const hasNoTrustedLauncherFields =
    record?.launcherSha256 === undefined &&
    record?.actorRuntimeDigest === undefined &&
    record?.launcherChannelProtocol === undefined &&
    record?.launcherAttestationSha256 === undefined &&
    record?.launcherSessionId === undefined;
  const validTrustedLauncherChannel =
    record?.credentialKind === "trusted-launcher-channel" &&
    SHA256_PATTERN.test(String(record?.launcherSha256 ?? "")) &&
    SHA256_PATTERN.test(String(record?.actorRuntimeDigest ?? "")) &&
    record?.launcherChannelProtocol === ACTOR_LAUNCHER_CHANNEL_PROTOCOL &&
    SHA256_PATTERN.test(String(record?.launcherAttestationSha256 ?? "")) &&
    SHA256_PATTERN.test(String(record?.launcherSessionId ?? ""));
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
    new Date(acquiredAtMs).toISOString() !== record?.acquiredAt ||
    new Date(heartbeatAtMs).toISOString() !== record?.heartbeatAt ||
    new Date(expiresAtMs).toISOString() !== record?.expiresAt ||
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
      "trusted-launcher-channel",
      "owner-confirmation",
      "owner-signed-capability",
      "signed-capability",
    ].includes(record?.credentialKind) ||
    (record?.owner === "freed-owner"
      ? (!validOwnerSignedCapability && !validOwnerConfirmation) ||
        record?.publisherCapabilityId !== undefined ||
        !hasNoTrustedLauncherFields
      : record?.owner === "freed-pr-publisher"
        ? record.credentialKind !== "signed-capability" ||
          record?.ownerCapabilityId !== undefined ||
          record?.ownerCapabilityTaskId !== undefined ||
          record?.ownerCapabilityIntentDigest !== undefined ||
          !hasNoOwnerConfirmationFields ||
          typeof record?.publisherCapabilityId !== "string" ||
          !IDENTIFIER_PATTERN.test(record.publisherCapabilityId) ||
          !hasNoTrustedLauncherFields
        : !(
            record.credentialKind === "persistent-actor" ||
            validTrustedLauncherChannel
          ) ||
          record?.ownerCapabilityId !== undefined ||
          record?.ownerCapabilityTaskId !== undefined ||
          record?.ownerCapabilityIntentDigest !== undefined ||
          !hasNoOwnerConfirmationFields ||
          record?.publisherCapabilityId !== undefined ||
          (record.credentialKind === "persistent-actor" &&
            !hasNoTrustedLauncherFields))
  ) {
    throw new AutomationControlError(
      "invalid_state",
      `Lease ${name} has an unsupported record.`,
    );
  }
  if (record.owner === "freed-pr-publisher") {
    record.scope = normalizePublisherScope(record.scope, {
      requireLiveWorktree: false,
    });
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
  const acquiredAtMs = Date.parse(String(record?.acquiredAt ?? ""));
  const heartbeatAtMs = Date.parse(String(record?.heartbeatAt ?? ""));
  const expiresAtMs = Date.parse(String(record?.expiresAt ?? ""));
  if (
    !exactObjectKeys(record, [
      "acquiredAt",
      "expiresAt",
      "heartbeatAt",
      "name",
      "observerAuthority",
      "owner",
      "providerAuthority",
      "schemaVersion",
      "token",
      "ttlMs",
    ]) ||
    record?.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    record?.name !== name ||
    typeof record.token !== "string" ||
    record.token.trim() !== record.token ||
    record.token.length === 0 ||
    Buffer.byteLength(record.token, "utf8") > 4_096 ||
    record.token.includes("\0") ||
    typeof record.owner !== "string" ||
    AUTOMATION_ACTOR_POLICIES[record.owner] !== policy ||
    record?.observerAuthority !== policy.observerAuthority ||
    record?.providerAuthority !== policy.providerAuthority ||
    !Number.isSafeInteger(record.ttlMs) ||
    record.ttlMs <= 0 ||
    record.ttlMs > LEGACY_GENERAL_ACTOR_LEASE_MAX_TTL_MS ||
    !isCanonicalIsoTimestamp(record.acquiredAt) ||
    !isCanonicalIsoTimestamp(record.heartbeatAt) ||
    !isCanonicalIsoTimestamp(record.expiresAt) ||
    heartbeatAtMs < acquiredAtMs ||
    expiresAtMs <= heartbeatAtMs ||
    expiresAtMs - heartbeatAtMs > record.ttlMs
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
    exactObjectKeys(record, [
      "acquiredAt",
      "expiresAt",
      "heartbeatAt",
      "name",
      "observerAuthority",
      "owner",
      "providerAuthority",
      "schemaVersion",
      "token",
      "ttlMs",
    ]),
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

export function taskAuthorityUpdateIntentDigestCandidates({
  taskId,
  taskRevision,
  before,
  after,
  reason,
}) {
  requireIdentifier(taskId, "taskId");
  requirePositiveInteger(taskRevision, "taskRevision");
  if (taskRevision < 2) {
    throw new AutomationControlError(
      "owner_intent_invalid",
      "Task authority updates require a revision after task creation.",
    );
  }
  const normalizedBefore = requirePlainObject(before, "before authority");
  const normalizedAfter = requirePlainObject(after, "after authority");
  const normalizedReason = requireNonemptyString(reason, "reason");
  for (const authority of [normalizedBefore, normalizedAfter]) {
    requireEnum(
      authority.observerAuthority,
      OBSERVER_AUTHORITIES,
      "observerAuthority",
    );
    requireEnum(
      authority.providerAuthority,
      PROVIDER_AUTHORITIES,
      "providerAuthority",
    );
  }
  const observerChanged =
    normalizedBefore.observerAuthority !== normalizedAfter.observerAuthority;
  const providerChanged =
    normalizedBefore.providerAuthority !== normalizedAfter.providerAuthority ||
    normalizedBefore.providerApprovalReference !==
      normalizedAfter.providerApprovalReference;
  const observerOptions = observerChanged
    ? [normalizedAfter.observerAuthority]
    : [null, normalizedAfter.observerAuthority];
  const providerOptions = providerChanged
    ? [normalizedAfter.providerAuthority]
    : [null, normalizedAfter.providerAuthority];
  const expectedRevisionOptions = [null, taskRevision - 1];
  const digests = new Set();
  for (const observerAuthority of observerOptions) {
    for (const providerAuthority of providerOptions) {
      const approvalReference =
        providerAuthority === "approved"
          ? normalizedAfter.providerApprovalReference
          : null;
      if (
        providerAuthority === "approved" &&
        (typeof approvalReference !== "string" ||
          approvalReference.trim() === "")
      ) {
        continue;
      }
      for (const expectedRevision of expectedRevisionOptions) {
        digests.add(
          ownerOperationIntentDigest("freed-owner", "task.authorize", taskId, {
            observerAuthority,
            providerAuthority,
            reason: normalizedReason,
            approvalReference,
            expectedRevision,
          }),
        );
      }
    }
  }
  return Object.freeze([...digests].sort());
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
      missingMessage:
        "The current-task owner confirmation file is unavailable.",
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

function requireMutationLeaseRecord({
  record,
  actor,
  leaseName,
  leaseToken,
  nowMs,
  taskId = undefined,
  ownerIntentDigest = undefined,
}) {
  if (!record) {
    throw new AutomationControlError(
      "lease_not_found",
      `Lease ${leaseName} does not exist.`,
      { leaseName },
    );
  }
  const policy = actorPolicy(actor);
  validateLeaseRecord(record, leaseName);
  if (record.owner === "freed-pr-publisher") {
    normalizePublisherScope(record.scope);
  }
  if (Date.parse(record.acquiredAt) > nowMs) {
    throw new AutomationControlError(
      "lease_not_active",
      `Lease ${leaseName} is not active yet.`,
      { leaseName, acquiredAt: record.acquiredAt },
    );
  }
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
  return requireMutationLeaseRecord({
    record,
    actor,
    leaseName,
    leaseToken,
    nowMs,
    taskId,
    ownerIntentDigest,
  });
}

function optionalMutationLeasePathFingerprint(filePath, expectedKind) {
  try {
    const stats = lstatSync(filePath, { bigint: true });
    if (
      stats.isSymbolicLink() ||
      (expectedKind === "directory" && !stats.isDirectory()) ||
      (expectedKind === "file" && !stats.isFile()) ||
      realpathSync(filePath) !== filePath
    ) {
      return null;
    }
    return filesystemGenerationFingerprint(stats);
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    return null;
  }
}

function mutationLeaseAuthorityGenerationFingerprint(paths, leaseName) {
  const transactions = leaseTransactionDirectories(paths).transactions;
  const leaseDirectory = leasePathFor(paths, leaseName);
  const recordPath = leaseRecordPath(leaseDirectory);
  const relatedPrefix = Buffer.from(`${leaseName}.`, "utf8");
  const relatedHiddenPrefix = Buffer.from(`.${leaseName}.`, "utf8");
  const snapshot = () => {
    const leases = optionalMutationLeasePathFingerprint(
      paths.leases,
      "directory",
    );
    const transactionDirectory = optionalMutationLeasePathFingerprint(
      transactions,
      "directory",
    );
    let relatedEntries = "";
    if (transactionDirectory !== "missing" && transactionDirectory !== null) {
      try {
        relatedEntries = readdirSync(transactions, { encoding: "buffer" })
          .filter(
            (entry) =>
              entry.subarray(0, relatedPrefix.length).equals(relatedPrefix) ||
              entry
                .subarray(0, relatedHiddenPrefix.length)
                .equals(relatedHiddenPrefix),
          )
          .sort(Buffer.compare)
          .map((entry) => entry.toString("hex"))
          .join("\0");
      } catch {
        return null;
      }
    }
    const lease = optionalMutationLeasePathFingerprint(
      leaseDirectory,
      "directory",
    );
    const record = optionalMutationLeasePathFingerprint(recordPath, "file");
    if ([leases, transactionDirectory, lease, record].includes(null)) {
      return null;
    }
    return digestBytes(
      Buffer.from(
        [leases, transactionDirectory, relatedEntries, lease, record].join(
          "\n",
        ),
        "utf8",
      ),
    );
  };
  const before = snapshot();
  if (before === null) return null;
  const after = snapshot();
  return before === after ? after : null;
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
    authorityContext.ownerIntentDigest !== (expected.ownerIntentDigest ?? null)
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
    let active = true;
    let cachedAuthorization = null;
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
        const nowMs = Date.now();
        if (cachedAuthorization !== null) {
          const before = mutationLeaseAuthorityGenerationFingerprint(
            paths,
            leaseName,
          );
          if (
            before !== null &&
            before === cachedAuthorization.generationFingerprint
          ) {
            requireMutationLeaseRecord({
              record: structuredClone(cachedAuthorization.lease),
              ...expected,
              nowMs,
            });
            const after = mutationLeaseAuthorityGenerationFingerprint(
              paths,
              leaseName,
            );
            if (before === after) {
              return requireMutationLeaseRecord({
                record: structuredClone(cachedAuthorization.lease),
                ...expected,
                nowMs: Date.now(),
              });
            }
          }
        }
        const before = mutationLeaseAuthorityGenerationFingerprint(
          paths,
          leaseName,
        );
        const authorization = requireMutationLeaseUnlocked({
          ...expected,
          stateRoot: paths.stateRoot,
          nowMs,
        });
        const after = mutationLeaseAuthorityGenerationFingerprint(
          paths,
          leaseName,
        );
        const finalAuthorization = requireMutationLeaseRecord({
          record: structuredClone(authorization.lease),
          ...expected,
          nowMs: Date.now(),
        });
        cachedAuthorization =
          before !== null && before === after
            ? Object.freeze({
                lease: structuredClone(finalAuthorization.lease),
                generationFingerprint: after,
              })
            : null;
        return finalAuthorization;
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
  const normalized = String(operationId ?? "");
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

function leaseAtomicTemporaryNamespace(filePath, operation) {
  const leaseOperation = operation?.operation ?? operation?.leaseOperation;
  const predecessor = operation?.before ?? operation?.predecessor;
  if (
    typeof operation?.operationId !== "string" ||
    !LEASE_TRANSACTION_OPERATIONS.has(leaseOperation) ||
    typeof operation?.name !== "string" ||
    !SHA256_PATTERN.test(String(operation?.requestDigest ?? "")) ||
    !SHA256_PATTERN.test(String(operation?.tokenDigest ?? "")) ||
    predecessor === null ||
    typeof predecessor !== "object" ||
    Array.isArray(predecessor)
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease atomic publication requires its exact request and token identity.",
    );
  }
  return canonicalLeaseRequestDigest({
    purpose: "lease-atomic-publication-v2",
    filePath: path.resolve(filePath),
    name: operation.name,
    operation: leaseOperation,
    operationId: operation.operationId,
    requestDigest: operation.requestDigest,
    tokenDigest: operation.tokenDigest,
    predecessor,
  });
}

function leaseAtomicTemporaryPath(filePath, operation) {
  const namespace = leaseAtomicTemporaryNamespace(filePath, operation);
  const targetDigest = digestBytes(
    Buffer.from(path.basename(filePath), "utf8"),
  );
  return path.join(
    path.dirname(filePath),
    `.lease-atomic.${targetDigest}.${operation.operationId}.${namespace}.tmp`,
  );
}

function leaseAtomicTemporaryEntryOperationId(entry) {
  const parts = entry.split(".");
  if (
    parts.length !== 6 ||
    parts[0] !== "" ||
    parts[1] !== "lease-atomic" ||
    !SHA256_PATTERN.test(parts[2]) ||
    !SHA256_PATTERN.test(parts[4]) ||
    parts[5] !== "tmp"
  ) {
    return null;
  }
  try {
    return requireLeaseOperationId(parts[3]);
  } catch {
    return null;
  }
}

const LEASE_STATE_QUARANTINE_DIRECTORY = ".lease-state-quarantine";

function leaseStateQuarantineDirectory(paths) {
  return path.join(paths.leases, LEASE_STATE_QUARANTINE_DIRECTORY);
}

function leaseStateRetirementNamespace(transaction, purpose) {
  return canonicalLeaseRequestDigest({
    purpose: "lease-state-directory-retirement",
    retirementPurpose: purpose,
    name: transaction.name,
    operation: transaction.operation,
    operationId: transaction.operationId,
  });
}

function leaseStateDirectoryGenerationDigest(
  paths,
  transaction,
  purpose,
  directoryIdentity,
  descriptor,
) {
  return canonicalLeaseRequestDigest({
    purpose: "lease-state-directory-generation",
    retirementPurpose: purpose,
    canonicalPath: leasePathFor(paths, transaction.name),
    name: transaction.name,
    operationId: transaction.operationId,
    device: directoryIdentity.dev.toString(),
    inode: directoryIdentity.ino.toString(),
    mode: Number(directoryIdentity.mode & 0o7777n),
    uid: directoryIdentity.uid.toString(),
    descriptor,
  });
}

function readBoundedLeaseDirectoryEntries(
  directoryPath,
  {
    maxEntries,
    maxEncodedBytes = Math.min(
      LEASE_BOUNDED_DIRECTORY_MAX_BYTES,
      maxEntries * LEASE_DIRECTORY_ENTRY_MAX_BYTES,
    ),
    label,
    errorCode = "lease_transaction_conflict",
    helperTestPause = undefined,
  },
) {
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 0 ||
    !Number.isSafeInteger(maxEncodedBytes) ||
    maxEncodedBytes < 0 ||
    typeof label !== "string" ||
    label.length === 0
  ) {
    throw new AutomationControlError(
      "invalid_argument",
      "A bounded lease directory scan requires exact nonnegative limits.",
    );
  }
  let directory;
  try {
    directory = openPinnedLeaseArchiveDirectory(directoryPath, label);
    const helper = openPinnedLeaseArchiveHelper();
    const bytes = runLeaseArchiveHelper(
      helper,
      "list-bounded",
      [
        maxEntries.toString(),
        maxEncodedBytes.toString(),
        ...pinnedDirectoryArguments(directory),
      ],
      [directory.descriptor],
      undefined,
      helperTestPause,
    );
    assertPinnedLeaseArchiveDirectory(directory);
    if (bytes.length === 0) return [];
    const entries = privateAuthorityDecoder.decode(bytes).split("\0");
    const encodedBytes = entries.reduce(
      (total, entry, index) =>
        total + Buffer.byteLength(entry, "utf8") + (index === 0 ? 0 : 1),
      0,
    );
    if (
      entries.length > maxEntries ||
      encodedBytes > maxEncodedBytes ||
      entries.some(
        (entry) =>
          entry.length === 0 ||
          entry === "." ||
          entry === ".." ||
          entry.includes(path.sep) ||
          entry.includes("\0") ||
          Buffer.byteLength(entry, "utf8") > LEASE_DIRECTORY_ENTRY_MAX_BYTES,
      )
    ) {
      throw new Error("bounded helper receipt exceeded its requested contract");
    }
    return entries;
  } catch (error) {
    if (error instanceof AutomationControlError && error.code === errorCode) {
      throw error;
    }
    throw new AutomationControlError(
      errorCode,
      `${label} could not be admitted through one bounded directory generation.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    if (directory !== undefined) closeSync(directory.descriptor);
  }
}

export function readBoundedLeaseDirectoryEntriesForTest(
  directoryPath,
  options,
) {
  requireOutsideAutomationPlanningReadCallback(
    "Test-only bounded lease directory inspection",
  );
  return readBoundedLeaseDirectoryEntries(directoryPath, options);
}

function openPinnedLeaseAtomicFile(filePath, expectedBytes, label) {
  const snapshot = readPrivateBytes(filePath, label, {
    privateRoot: path.dirname(path.dirname(filePath)),
    includeMetadata: true,
  });
  if (!snapshot.bytes.equals(expectedBytes)) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${label} does not contain the exact recoverable bytes.`,
    );
  }
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
      held.size !== BigInt(expectedBytes.length) ||
      !privateFileIdentityMatches(snapshot.identity, held) ||
      !readHeldPrivateFile(descriptor, expectedBytes.length).equals(
        expectedBytes,
      )
    ) {
      throw new Error("file generation changed during descriptor admission");
    }
    return Object.freeze({
      filePath,
      label,
      descriptor,
      bytes: Buffer.from(expectedBytes),
      identity: Object.freeze({
        dev: held.dev,
        ino: held.ino,
        mode: held.mode,
        uid: held.uid,
        gid: held.gid,
        size: held.size,
      }),
    });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error instanceof AutomationControlError) throw error;
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${label} could not be pinned to one private file generation.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function assertPinnedLeaseAtomicFile(
  binding,
  { filePath = binding.filePath, expectedLinks = 1 } = {},
) {
  try {
    const held = fstatSync(binding.descriptor, { bigint: true });
    const current = lstatSync(filePath, { bigint: true });
    if (
      !held.isFile() ||
      held.isSymbolicLink() ||
      held.dev !== binding.identity.dev ||
      held.ino !== binding.identity.ino ||
      held.mode !== binding.identity.mode ||
      held.uid !== binding.identity.uid ||
      held.gid !== binding.identity.gid ||
      held.size !== binding.identity.size ||
      held.nlink !== BigInt(expectedLinks) ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.dev !== binding.identity.dev ||
      current.ino !== binding.identity.ino ||
      current.mode !== binding.identity.mode ||
      current.uid !== binding.identity.uid ||
      current.gid !== binding.identity.gid ||
      current.size !== binding.identity.size ||
      current.nlink !== BigInt(expectedLinks) ||
      realpathSync(filePath) !== filePath ||
      !readHeldPrivateFile(
        binding.descriptor,
        Number(binding.identity.size),
      ).equals(binding.bytes)
    ) {
      throw new Error("file path no longer names the admitted generation");
    }
  } catch (error) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${binding.label} changed after descriptor admission.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function removeLeaseAtomicTemporaryFile(
  paths,
  filePath,
  expectedBytes = undefined,
  {
    operationId,
    kind = "atomic temporary",
    retirementDirectory = leaseCleanupQuarantineDirectory(filePath),
    checkpoint = undefined,
    allowPartial = false,
  },
) {
  if (!pathEntryExists(filePath)) return false;
  if (expectedBytes === undefined) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease transaction temporary file ${filePath} cannot be removed without exact expected bytes.`,
    );
  }
  const snapshot = allowPartial
    ? readPrivateBytes(
        filePath,
        `Lease transaction temporary file ${filePath}`,
        {
          allowEmpty: true,
          privateRoot: paths.controlRoot,
          includeMetadata: true,
          requireUtf8: false,
        },
      )
    : readLeaseAtomicSnapshot(
        paths,
        filePath,
        `Lease transaction temporary file ${filePath}`,
      );
  if (!snapshot.bytes.equals(expectedBytes)) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease transaction temporary file ${filePath} changed before retirement.`,
    );
  }
  retireLeaseAtomicGeneration(paths, filePath, snapshot, {
    operationId,
    kind,
    retirementDirectory,
    checkpoint,
    allowEmpty: allowPartial && snapshot.bytes.length === 0,
  });
  syncDirectory(path.dirname(filePath));
  return true;
}

function requireNoPendingLeaseTransaction(paths, name) {
  pendingLeaseTransactionInspectionCountForTest += 1;
  const { transactions } = leaseTransactionDirectories(paths);
  if (!pathEntryExists(transactions)) return;
  requireExactPrivateArchiveDirectory(
    transactions,
    "Lease transaction directory",
  );
  const activePath = path.join(transactions, `${name}.json`);
  if (pathEntryExists(activePath)) {
    readLeaseTransactionFile(activePath, paths, name);
    throw new AutomationControlError(
      "lease_transaction_pending",
      `Lease ${name} has a pending recoverable transaction.`,
    );
  }
  const relatedEntries = readBoundedLeaseDirectoryEntries(transactions, {
    maxEntries: LEASE_TRANSACTION_DIRECTORY_MAX_ENTRIES,
    label: "Lease transaction directory",
    errorCode: "lease_transaction_pending",
  }).filter(
    (entry) => entry.startsWith(`${name}.`) || entry.startsWith(`.${name}.`),
  );
  if (relatedEntries.length !== 0) {
    throw new AutomationControlError(
      "lease_transaction_pending",
      `Lease ${name} has pending recoverable transaction staging.`,
      { pendingEntry: relatedEntries.sort()[0] },
    );
  }
}

function recoverablePreWalAfterStagingBytes(current, proposed, transaction) {
  if (
    !["acquire", "heartbeat"].includes(transaction.operation) ||
    current.equals(proposed)
  ) {
    return false;
  }
  const currentRecord = parseLeaseRecordBytes(current, transaction.name);
  const proposedRecord = parseLeaseRecordBytes(proposed, transaction.name);
  const volatileFields =
    transaction.operation === "acquire"
      ? ["acquiredAt", "expiresAt", "heartbeatAt"]
      : ["expiresAt", "heartbeatAt"];
  return canonicalValuesEqual(
    leaseRecordWithoutFields(currentRecord, volatileFields),
    leaseRecordWithoutFields(proposedRecord, volatileFields),
  );
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
  const targets = [
    ...(beforeBytes === null
      ? []
      : [{ filePath: files.before, bytes: beforeBytes, side: "before" }]),
    ...(afterBytes === null
      ? []
      : [{ filePath: files.after, bytes: afterBytes, side: "after" }]),
    {
      filePath: files.transaction,
      bytes: privateJsonBytes(transaction),
      side: "transaction",
    },
  ].map((target) => ({
    ...target,
    temporaryPath: leaseAtomicTemporaryPath(target.filePath, transaction),
  }));
  const expectedPaths = new Set(
    targets.flatMap((target) => [target.filePath, target.temporaryPath]),
  );
  const transactionEntryLimit = expectedPaths.size + 1;
  const entries = readBoundedLeaseDirectoryEntries(transactions, {
    maxEntries: transactionEntryLimit,
    label: "Lease transaction directory",
    errorCode: "lease_transaction_pending",
  }).sort();
  for (const entry of entries) {
    if (entry === quarantineEntry) {
      requireExactPrivateArchiveDirectory(
        path.join(transactions, entry),
        "Lease transaction cleanup archive directory",
      );
      continue;
    }
    const filePath = path.join(transactions, entry);
    if (!expectedPaths.has(filePath)) {
      const sameOperationAtomicTemporary =
        leaseAtomicTemporaryEntryOperationId(entry) === transaction.operationId;
      throw new AutomationControlError(
        sameOperationAtomicTemporary
          ? "lease_transaction_conflict"
          : "lease_transaction_pending",
        `Lease transaction entry ${entry} must recover or be reconciled before ${transaction.name} can mutate.`,
        { name: transaction.name, pendingEntry: entry },
      );
    }
  }
  let incomplete = false;
  const obsoleteStaging = [];
  for (const target of targets) {
    const finalExists = pathEntryExists(target.filePath);
    const temporaryExists = pathEntryExists(target.temporaryPath);
    if (finalExists && temporaryExists) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease pre-WAL target ${path.basename(target.filePath)} exists as both final and temporary material.`,
      );
    }
    if (finalExists) {
      const current = readPrivateBytes(
        target.filePath,
        "Lease pre-WAL staging",
        { privateRoot: paths.controlRoot },
      );
      const recoverableFinal =
        target.side === "after" &&
        recoverablePreWalAfterStagingBytes(current, target.bytes, transaction);
      if (incomplete || (!current.equals(target.bytes) && !recoverableFinal)) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease pre-WAL target ${path.basename(target.filePath)} is out of order or changed bytes.`,
        );
      }
      if (recoverableFinal) {
        obsoleteStaging.push({ filePath: target.filePath, bytes: current });
      }
      continue;
    }
    if (temporaryExists) {
      const current = readPrivateBytes(
        target.temporaryPath,
        "Lease pre-WAL temporary staging",
        {
          allowEmpty: true,
          privateRoot: paths.controlRoot,
          requireUtf8: false,
        },
      );
      let recoverableBytes = current.equals(target.bytes);
      if (!recoverableBytes && target.side === "after") {
        recoverableBytes = recoverablePreWalAfterStagingBytes(
          current,
          target.bytes,
          transaction,
        );
        if (recoverableBytes) {
          obsoleteStaging.push({
            filePath: target.temporaryPath,
            bytes: current,
          });
        }
      }
      if (incomplete) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease pre-WAL temporary ${path.basename(target.temporaryPath)} is out of order or changed bytes.`,
        );
      }
      // The cryptographic temporary namespace binds this exact request,
      // token, lease operation, predecessor, and target. A process may die
      // during any physical write, so the exact caller plan may safely replace
      // these non-authoritative bytes before publication.
      incomplete = true;
      continue;
    }
    incomplete = true;
  }
  if (
    readBoundedLeaseDirectoryEntries(transactions, {
      maxEntries: transactionEntryLimit,
      label: "Lease transaction directory",
      errorCode: "lease_transaction_conflict",
    })
      .sort()
      .join("\0") !== entries.join("\0")
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease pre-WAL transaction set changed while ${transaction.name} was admitted.`,
    );
  }
  for (const staging of obsoleteStaging) {
    removeLeaseAtomicTemporaryFile(paths, staging.filePath, staging.bytes, {
      operationId: transaction.operationId,
      kind: "obsolete pre-WAL staging",
      retirementDirectory: leaseCleanupQuarantineDirectory(files.transaction),
    });
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

function leaseAtomicRetirementNamespace(operationId, filePath, kind) {
  return canonicalLeaseRequestDigest({
    purpose: "lease-atomic-generation-retirement",
    operationId,
    filePath,
    kind,
  });
}

function leaseAtomicRetirementPath(
  operationId,
  filePath,
  kind,
  snapshot,
  retirementDirectory,
) {
  return path.join(
    retirementDirectory,
    `${operationId}.${leaseAtomicRetirementNamespace(operationId, filePath, kind)}.${leaseCleanupGenerationDigest(filePath, snapshot)}.json`,
  );
}

function leaseFileSnapshotMatchesGeneration(left, right) {
  return (
    left.bytes.equals(right.bytes) &&
    BigInt(left.identity.dev) === BigInt(right.identity.dev) &&
    BigInt(left.identity.ino) === BigInt(right.identity.ino) &&
    Number(left.identity.mode) === Number(right.identity.mode) &&
    Number(left.identity.nlink) === Number(right.identity.nlink) &&
    Number(left.identity.uid) === Number(right.identity.uid) &&
    Number(left.identity.gid) === Number(right.identity.gid) &&
    Number(left.identity.size) === Number(right.identity.size)
  );
}

function leaseBytesAreCanonicalPrefix(candidate, expected) {
  return (
    candidate.length <= expected.length &&
    candidate.equals(expected.subarray(0, candidate.length))
  );
}

function leaseAtomicSuccessorKind(kind) {
  return `${kind} successor`;
}

function leaseAtomicPreWalCleanupKind(kind) {
  return `pre-WAL ${kind} cleanup`;
}

function leaseAtomicCompletionResidueKind(kind) {
  return `${kind} completion residue`;
}

function readLeaseAtomicSnapshot(
  paths,
  filePath,
  label,
  { allowEmpty = false } = {},
) {
  return readPrivateBytes(filePath, label, {
    allowEmpty,
    privateRoot: paths.controlRoot,
    includeMetadata: true,
    requireUtf8: !allowEmpty,
  });
}

function validateLeaseAtomicDestinationGeneration(
  paths,
  filePath,
  expectedSnapshot,
  label,
  { allowEmpty = false } = {},
) {
  const current = readLeaseAtomicSnapshot(paths, filePath, label, {
    allowEmpty,
  });
  if (!leaseFileSnapshotMatchesGeneration(current, expectedSnapshot)) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${label} did not retain its exact admitted generation.`,
    );
  }
  return current;
}

function parseLeaseDurableMoveReceipt(result, source, expectedDigest, label) {
  let receipt;
  try {
    receipt = JSON.parse(result.toString("utf8"));
  } catch {
    receipt = null;
  }
  if (
    Object.keys(receipt ?? {})
      .sort()
      .join("\n") !==
      ["device", "digest", "inode", "protocol", "size"].join("\n") ||
    receipt.protocol !== LEASE_ARCHIVE_MOVE_PROTOCOL ||
    receipt.device !== source.identity.dev.toString() ||
    receipt.inode !== source.identity.ino.toString() ||
    receipt.size !== source.identity.size.toString() ||
    receipt.digest !== expectedDigest
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${label} returned an inexact generation receipt.`,
    );
  }
}

function moveLeaseFileGenerationDurable(
  paths,
  sourcePath,
  destinationPath,
  snapshot,
  label,
  { allowEmpty = false } = {},
) {
  const helper = openPinnedLeaseArchiveHelper();
  const sourceDirectory = openPinnedLeaseArchiveDirectory(
    path.dirname(sourcePath),
    `${label} source directory`,
  );
  const destinationDirectory = openPinnedLeaseArchiveDirectory(
    path.dirname(destinationPath),
    `${label} destination directory`,
  );
  const source = openPinnedLeaseArchiveFile(sourcePath, snapshot, label, {
    allowEmpty,
  });
  const expectedDigest = digestBytes(snapshot.bytes);
  try {
    let result;
    try {
      result = runLeaseArchiveHelper(
        helper,
        "rename-durable",
        [
          path.basename(sourcePath),
          path.basename(destinationPath),
          source.identity.dev.toString(),
          source.identity.ino.toString(),
          Number(source.identity.mode & 0o7777n).toString(),
          source.identity.nlink.toString(),
          source.identity.size.toString(),
          expectedDigest,
          ...pinnedDirectoryArguments(sourceDirectory),
          ...pinnedDirectoryArguments(destinationDirectory),
        ],
        [
          sourceDirectory.descriptor,
          destinationDirectory.descriptor,
          source.descriptor,
        ],
      );
      parseLeaseDurableMoveReceipt(result, source, expectedDigest, label);
    } catch (error) {
      if (pathEntryExists(sourcePath) || !pathEntryExists(destinationPath)) {
        throw error;
      }
    }
    if (pathEntryExists(sourcePath)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `${label} source remained after exclusive retirement.`,
      );
    }
    validateLeaseAtomicDestinationGeneration(
      paths,
      destinationPath,
      snapshot,
      `${label} destination`,
      { allowEmpty },
    );
    assertPinnedLeaseArchiveDirectory(sourceDirectory);
    assertPinnedLeaseArchiveDirectory(destinationDirectory);
  } finally {
    closeSync(source.descriptor);
    closeSync(destinationDirectory.descriptor);
    closeSync(sourceDirectory.descriptor);
  }
}

function parseLeaseDurableExchangeReceipt(
  result,
  source,
  destination,
  sourceDigest,
  destinationDigest,
  label,
) {
  let receipt;
  try {
    receipt = JSON.parse(result.toString("utf8"));
  } catch {
    receipt = null;
  }
  if (
    Object.keys(receipt ?? {})
      .sort()
      .join("\n") !==
      [
        "destinationDevice",
        "destinationDigest",
        "destinationInode",
        "protocol",
        "sourceDevice",
        "sourceDigest",
        "sourceInode",
      ].join("\n") ||
    receipt.protocol !== LEASE_ARCHIVE_MOVE_PROTOCOL ||
    receipt.sourceDevice !== source.identity.dev.toString() ||
    receipt.sourceInode !== source.identity.ino.toString() ||
    receipt.sourceDigest !== sourceDigest ||
    receipt.destinationDevice !== destination.identity.dev.toString() ||
    receipt.destinationInode !== destination.identity.ino.toString() ||
    receipt.destinationDigest !== destinationDigest
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `${label} returned an inexact exchange receipt.`,
    );
  }
}

function exchangeLeaseFileGenerationsDurable(
  paths,
  sourcePath,
  destinationPath,
  sourceSnapshot,
  destinationSnapshot,
  label,
) {
  const helper = openPinnedLeaseArchiveHelper();
  const sourceDirectory = openPinnedLeaseArchiveDirectory(
    path.dirname(sourcePath),
    `${label} source directory`,
  );
  const destinationDirectory = openPinnedLeaseArchiveDirectory(
    path.dirname(destinationPath),
    `${label} destination directory`,
  );
  const source = openPinnedLeaseArchiveFile(
    sourcePath,
    sourceSnapshot,
    `${label} source`,
  );
  const destination = openPinnedLeaseArchiveFile(
    destinationPath,
    destinationSnapshot,
    `${label} destination`,
  );
  const sourceDigest = digestBytes(sourceSnapshot.bytes);
  const destinationDigest = digestBytes(destinationSnapshot.bytes);
  try {
    let result;
    try {
      result = runLeaseArchiveHelper(
        helper,
        "exchange-durable",
        [
          path.basename(sourcePath),
          path.basename(destinationPath),
          source.identity.dev.toString(),
          source.identity.ino.toString(),
          Number(source.identity.mode & 0o7777n).toString(),
          source.identity.nlink.toString(),
          source.identity.size.toString(),
          sourceDigest,
          destination.identity.dev.toString(),
          destination.identity.ino.toString(),
          Number(destination.identity.mode & 0o7777n).toString(),
          destination.identity.nlink.toString(),
          destination.identity.size.toString(),
          destinationDigest,
          ...pinnedDirectoryArguments(sourceDirectory),
          ...pinnedDirectoryArguments(destinationDirectory),
        ],
        [
          sourceDirectory.descriptor,
          destinationDirectory.descriptor,
          source.descriptor,
        ],
      );
      parseLeaseDurableExchangeReceipt(
        result,
        source,
        destination,
        sourceDigest,
        destinationDigest,
        label,
      );
    } catch (error) {
      const sourceStillOriginal =
        pathEntryExists(sourcePath) &&
        leaseFileSnapshotMatchesGeneration(
          readLeaseAtomicSnapshot(paths, sourcePath, `${label} source`),
          sourceSnapshot,
        );
      const destinationStillOriginal =
        pathEntryExists(destinationPath) &&
        leaseFileSnapshotMatchesGeneration(
          readLeaseAtomicSnapshot(
            paths,
            destinationPath,
            `${label} destination`,
          ),
          destinationSnapshot,
        );
      if (sourceStillOriginal && destinationStillOriginal) throw error;
    }
    validateLeaseAtomicDestinationGeneration(
      paths,
      destinationPath,
      sourceSnapshot,
      `${label} published generation`,
    );
    validateLeaseAtomicDestinationGeneration(
      paths,
      sourcePath,
      destinationSnapshot,
      `${label} predecessor generation`,
    );
    assertPinnedLeaseArchiveDirectory(sourceDirectory);
    assertPinnedLeaseArchiveDirectory(destinationDirectory);
  } finally {
    closeSync(destination.descriptor);
    closeSync(source.descriptor);
    closeSync(destinationDirectory.descriptor);
    closeSync(sourceDirectory.descriptor);
  }
}

function retireLeaseAtomicGeneration(
  paths,
  filePath,
  snapshot,
  {
    operationId,
    transaction,
    kind,
    retirementDirectory,
    checkpoint = undefined,
    capacityReserved = false,
    allowEmpty = false,
  },
) {
  const archivePath = leaseAtomicRetirementPath(
    operationId,
    filePath,
    kind,
    snapshot,
    retirementDirectory,
  );
  if (pathEntryExists(archivePath)) {
    if (pathEntryExists(filePath)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${kind} generation exists at both its active and retirement paths.`,
      );
    }
    validateLeaseAtomicDestinationGeneration(
      paths,
      archivePath,
      snapshot,
      `Lease ${kind} retired generation`,
      { allowEmpty },
    );
    return archivePath;
  }
  if (!capacityReserved) {
    requireLeaseCleanupArchiveCapacity(paths, {
      entries: 1,
      bytes: snapshot.bytes.length,
      oldestMtimeMs: snapshot.identity.mtimeMs,
    });
  }
  invokeLeaseTransactionCheckpoint(
    checkpoint,
    "lease-atomic-before-generation-retirement",
    { filePath, archivePath, kind },
  );
  moveLeaseFileGenerationDurable(
    paths,
    filePath,
    archivePath,
    snapshot,
    `Lease ${kind} generation retirement`,
    { allowEmpty },
  );
  invokeLeaseTransactionCheckpoint(
    checkpoint,
    "lease-atomic-generation-retired",
    { filePath, archivePath, kind },
  );
  return archivePath;
}

function writePrivateBytesAtomic(
  paths,
  filePath,
  bytes,
  {
    operationId,
    transaction,
    checkpoint = undefined,
    kind = "private-file",
    beforePublish = () => {},
    predecessorBytes = null,
    retirementDirectory = leaseCleanupQuarantineDirectory(filePath),
  },
) {
  const directoryPath = path.dirname(filePath);
  ensurePrivateDirectory(directoryPath);
  requireExactPrivateArchiveDirectory(
    retirementDirectory,
    `Lease ${kind} generation retirement directory`,
  );
  if (
    transaction?.operationId !== operationId ||
    transaction?.name === undefined
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease ${kind} publication requires its exact transaction plan.`,
    );
  }
  const temporaryPath = leaseAtomicTemporaryPath(filePath, transaction);
  const expectedPredecessorBytes =
    predecessorBytes === null
      ? []
      : (Array.isArray(predecessorBytes)
          ? predecessorBytes
          : [predecessorBytes]
        ).map((candidate) => Buffer.from(candidate));
  const snapshot = (candidatePath, label) =>
    readLeaseAtomicSnapshot(paths, candidatePath, label);
  const temporarySnapshot = (candidatePath, label) =>
    readPrivateBytes(candidatePath, label, {
      allowEmpty: true,
      privateRoot: paths.controlRoot,
      includeMetadata: true,
      requireUtf8: false,
    });
  const isDesired = (candidate) => candidate.bytes.equals(bytes);
  const isPredecessor = (candidate) =>
    expectedPredecessorBytes.some((expected) =>
      candidate.bytes.equals(expected),
    );
  let completed = false;
  let predecessorRetirementCapacityReserved = false;
  let current = null;
  try {
    current = pathEntryExists(filePath)
      ? snapshot(filePath, `Lease ${kind}`)
      : null;
    const isPreWalPlanBoundTemporary =
      ["before staging", "after staging"].includes(kind) ||
      (kind === "WAL" && current === null && transaction.phase === "prepared");
    let temporary = pathEntryExists(temporaryPath)
      ? temporarySnapshot(temporaryPath, `Lease ${kind} temporary file`)
      : null;
    if (current !== null && isDesired(current)) {
      if (temporary !== null) {
        const temporaryIsPredecessor = isPredecessor(temporary);
        const temporaryIsPrefix = leaseBytesAreCanonicalPrefix(
          temporary.bytes,
          bytes,
        );
        if (!temporaryIsPredecessor && !temporaryIsPrefix) {
          throw new AutomationControlError(
            "lease_transaction_conflict",
            `Lease ${kind} temporary file conflicts with its published generation.`,
          );
        }
        retireLeaseAtomicGeneration(paths, temporaryPath, temporary, {
          operationId,
          kind: temporaryIsPredecessor
            ? kind
            : isPreWalPlanBoundTemporary
              ? leaseAtomicPreWalCleanupKind(kind)
              : temporaryIsPrefix
                ? leaseAtomicSuccessorKind(kind)
                : leaseAtomicSuccessorKind(kind),
          retirementDirectory,
          checkpoint,
          allowEmpty: temporary.bytes.length === 0,
        });
      }
      syncDirectory(directoryPath);
      completed = true;
      return;
    }
    if (current !== null && !isPredecessor(current)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${kind} destination is not its exact admitted predecessor.`,
      );
    }
    if (temporary !== null && !isDesired(temporary)) {
      if (
        !isPreWalPlanBoundTemporary &&
        !leaseBytesAreCanonicalPrefix(temporary.bytes, bytes)
      ) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease ${kind} temporary file is not a canonical publication prefix.`,
        );
      }
      retireLeaseAtomicGeneration(paths, temporaryPath, temporary, {
        operationId,
        kind: isPreWalPlanBoundTemporary
          ? leaseAtomicPreWalCleanupKind(kind)
          : leaseBytesAreCanonicalPrefix(temporary.bytes, bytes)
            ? leaseAtomicSuccessorKind(kind)
            : leaseAtomicPreWalCleanupKind(kind),
        retirementDirectory,
        checkpoint,
        allowEmpty: temporary.bytes.length === 0,
      });
      syncDirectory(directoryPath);
      temporary = null;
    }
    if (temporary === null) {
      const descriptor = openSync(temporaryPath, "wx", 0o600);
      try {
        fsyncSync(descriptor);
        syncDirectory(directoryPath);
        invokeLeaseTransactionCheckpoint(
          checkpoint,
          "lease-atomic-temporary-created",
          { filePath, temporaryPath, kind },
        );
        const partialLength =
          bytes.length === 0 ? 0 : Math.max(1, Math.floor(bytes.length / 2));
        let offset = 0;
        while (offset < partialLength) {
          offset += writeSync(
            descriptor,
            bytes,
            offset,
            partialLength - offset,
            offset,
          );
        }
        fsyncSync(descriptor);
        invokeLeaseTransactionCheckpoint(
          checkpoint,
          "lease-atomic-temporary-partial",
          { filePath, temporaryPath, kind },
        );
        while (offset < bytes.length) {
          offset += writeSync(
            descriptor,
            bytes,
            offset,
            bytes.length - offset,
            offset,
          );
        }
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      temporary = snapshot(temporaryPath, `Lease ${kind} temporary file`);
    }
    invokeLeaseTransactionCheckpoint(
      checkpoint,
      "lease-atomic-temporary-synced",
      { filePath, temporaryPath, kind },
    );
    validateLeaseAtomicDestinationGeneration(
      paths,
      temporaryPath,
      temporary,
      `Lease ${kind} temporary file`,
    );
    beforePublish();
    if (current === null) {
      if (pathEntryExists(filePath)) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease ${kind} destination appeared before create-only publication.`,
        );
      }
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-atomic-before-create-rename",
        { filePath, temporaryPath, kind },
      );
      moveLeaseFileGenerationDurable(
        paths,
        temporaryPath,
        filePath,
        temporary,
        `Lease ${kind} create-only publication`,
      );
    } else {
      requireLeaseCleanupArchiveCapacity(paths, {
        entries: 1,
        bytes: current.bytes.length,
        oldestMtimeMs: current.identity.mtimeMs,
      });
      predecessorRetirementCapacityReserved = true;
      invokeLeaseTransactionCheckpoint(
        checkpoint,
        "lease-atomic-before-exchange",
        { filePath, temporaryPath, kind },
      );
      exchangeLeaseFileGenerationsDurable(
        paths,
        temporaryPath,
        filePath,
        temporary,
        current,
        `Lease ${kind} publication`,
      );
      invokeLeaseTransactionCheckpoint(checkpoint, "lease-atomic-exchanged", {
        filePath,
        temporaryPath,
        kind,
      });
      const exchangedPredecessor = snapshot(
        temporaryPath,
        `Lease ${kind} exchanged predecessor`,
      );
      if (!isPredecessor(exchangedPredecessor)) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease ${kind} exchange did not preserve its exact predecessor.`,
        );
      }
      retireLeaseAtomicGeneration(paths, temporaryPath, exchangedPredecessor, {
        operationId,
        kind,
        retirementDirectory,
        checkpoint,
        capacityReserved: true,
      });
    }
    invokeLeaseTransactionCheckpoint(checkpoint, "lease-atomic-renamed", {
      filePath,
      temporaryPath,
      kind,
    });
    validateLeaseAtomicDestinationGeneration(
      paths,
      filePath,
      temporary,
      `Lease ${kind} published generation`,
    );
    syncDirectory(directoryPath);
    validateLeaseAtomicDestinationGeneration(
      paths,
      filePath,
      temporary,
      `Lease ${kind} durable generation`,
    );
    completed = true;
  } finally {
    if (!completed && pathEntryExists(temporaryPath)) {
      const stranded = temporarySnapshot(
        temporaryPath,
        `Lease ${kind} stranded temporary file`,
      );
      const strandedIsPredecessor = isPredecessor(stranded);
      const strandedIsPrefix = leaseBytesAreCanonicalPrefix(
        stranded.bytes,
        bytes,
      );
      const isPreWalPlanBoundTemporary =
        ["before staging", "after staging"].includes(kind) ||
        (kind === "WAL" &&
          current === null &&
          transaction.phase === "prepared");
      retireLeaseAtomicGeneration(paths, temporaryPath, stranded, {
        operationId,
        kind: strandedIsPredecessor
          ? kind
          : kind === "WAL" && transaction.phase === "complete"
            ? leaseAtomicCompletionResidueKind(kind)
            : isPreWalPlanBoundTemporary
              ? leaseAtomicPreWalCleanupKind(kind)
              : strandedIsPrefix
                ? leaseAtomicSuccessorKind(kind)
                : leaseAtomicPreWalCleanupKind(kind),
        retirementDirectory,
        checkpoint,
        capacityReserved:
          predecessorRetirementCapacityReserved && strandedIsPredecessor,
        allowEmpty: stranded.bytes.length === 0,
      });
      syncDirectory(directoryPath);
    }
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
    allowedModes = [0o600],
    requireUtf8 = true,
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
  const normalizedAllowedModes = new Set(
    allowedModes.map((mode) => Number(mode)),
  );
  if (
    normalizedAllowedModes.size === 0 ||
    [...normalizedAllowedModes].some(
      (mode) => !Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777,
    )
  ) {
    throw new AutomationControlError(
      "invalid_argument",
      `${label} has an invalid file mode allowlist.`,
    );
  }

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
    !normalizedAllowedModes.has(Number(beforePathStats.mode & 0o7777n)) ||
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
      !privateFileIdentityMatches(
        beforeDescriptorStats,
        afterDescriptorStats,
      ) ||
      !privateFileIdentityMatches(beforeDescriptorStats, afterPathStats)
    ) {
      failInvalid("file identity changed during read");
    }
    if (realpathSync(normalizedFilePath) !== normalizedFilePath) {
      failInvalid("file parent changed during read");
    }
    validateDirectoryChain();
    const admitted = bytes.subarray(0, offset);
    if (requireUtf8) {
      privateAuthorityDecoder.decode(admitted);
    }
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

function automationAuthorityDirectoryIdentity(stats) {
  return Object.freeze({
    dev: BigInt(stats.dev).toString(),
    ino: BigInt(stats.ino).toString(),
    mode: Number(stats.mode),
    uid: Number(stats.uid),
  });
}

function automationAuthorityDirectoryIdentityMatches(left, right) {
  return (
    BigInt(left.dev) === BigInt(right.dev) &&
    BigInt(left.ino) === BigInt(right.ino) &&
    Number(left.mode) === Number(right.mode) &&
    Number(left.uid) === Number(right.uid)
  );
}

function automationAuthoritySnapshotMatches(left, right) {
  if (
    left?.filePath !== right?.filePath ||
    left?.privateRoot !== right?.privateRoot ||
    left?.missing !== right?.missing ||
    !automationAuthorityDirectoryIdentityMatches(
      left?.directoryIdentity,
      right?.directoryIdentity,
    )
  ) {
    return false;
  }
  if (left.missing) return true;
  return (
    left.bytes.equals(right.bytes) &&
    privateFileIdentityMatches(left.identity, right.identity)
  );
}

function requireAutomationAuthorityPrivatePath(
  filePath,
  privateRoot,
  label,
  invalidCode,
) {
  const normalizedFilePath = path.resolve(filePath);
  const normalizedPrivateRoot = path.resolve(privateRoot);
  const directoryPath = path.dirname(normalizedFilePath);
  const relativeDirectory = path.relative(normalizedPrivateRoot, directoryPath);
  if (
    filePath !== normalizedFilePath ||
    privateRoot !== normalizedPrivateRoot ||
    relativeDirectory === ".." ||
    relativeDirectory.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeDirectory)
  ) {
    throw new AutomationControlError(
      invalidCode,
      `${label} path escapes its private root.`,
    );
  }
  const expectedUid =
    typeof process.getuid === "function" ? BigInt(process.getuid()) : null;
  let current = directoryPath;
  while (true) {
    let stats;
    try {
      stats = lstatSync(current, { bigint: true });
      if (
        realpathSync(current) !== current ||
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        (expectedUid !== null && stats.uid !== expectedUid) ||
        (stats.mode & 0o7777n) !== 0o700n
      ) {
        throw new Error("directory ancestry is outside the private boundary");
      }
    } catch (error) {
      throw new AutomationControlError(
        invalidCode,
        `${label} parent ancestry is unsafe.`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    if (current === normalizedPrivateRoot) break;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new AutomationControlError(
        invalidCode,
        `${label} private root is unreachable.`,
      );
    }
    current = parent;
  }
  return Object.freeze({
    normalizedFilePath,
    normalizedPrivateRoot,
    directoryPath,
  });
}

function automationAuthoritySnapshotGenerationFingerprint(filePath) {
  const directoryPath = path.dirname(filePath);
  const snapshot = () => {
    try {
      const directory = lstatSync(directoryPath, { bigint: true });
      if (
        !directory.isDirectory() ||
        directory.isSymbolicLink() ||
        realpathSync(directoryPath) !== directoryPath
      ) {
        return null;
      }
      try {
        const file = lstatSync(filePath, { bigint: true });
        if (
          !file.isFile() ||
          file.isSymbolicLink() ||
          realpathSync(filePath) !== filePath
        ) {
          return null;
        }
        return [
          filesystemGenerationFingerprint(directory, {
            stableIdentityOnly: true,
          }),
          filesystemGenerationFingerprint(file),
        ].join("\n");
      } catch (error) {
        if (error?.code !== "ENOENT") return null;
        return [filesystemGenerationFingerprint(directory), "missing"].join(
          "\n",
        );
      }
    } catch {
      return null;
    }
  };
  const before = snapshot();
  if (before === null) return null;
  const after = snapshot();
  return before === after ? digestBytes(Buffer.from(after, "utf8")) : null;
}

function activeOutcomeWriterContextForPath(filePath) {
  let matchingContext = null;
  let matchingRootLength = -1;
  for (const [
    stateRoot,
    context,
  ] of ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS_BY_ROOT) {
    const relative = path.relative(stateRoot, filePath);
    if (
      relative !== "" &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative) &&
      stateRoot.length > matchingRootLength
    ) {
      matchingContext = context;
      matchingRootLength = stateRoot.length;
    }
  }
  return matchingContext;
}

function cloneAutomationAuthoritySnapshot(snapshot) {
  return Object.freeze({
    ...snapshot,
    bytes: Buffer.from(snapshot.bytes),
  });
}

function readAutomationAuthorityFileSnapshotWithPolicy(
  filePath,
  options = {},
  policy,
) {
  const label = options?.label ?? "Automation authority file";
  const invalidCode = options?.invalidCode ?? "invalid_state";
  const privateRoot = options?.privateRoot ?? path.dirname(filePath);
  const { normalizedFilePath, normalizedPrivateRoot } =
    requireAutomationAuthorityPrivatePath(
      filePath,
      privateRoot,
      label,
      invalidCode,
    );
  const context = activeOutcomeWriterContextForPath(normalizedFilePath);
  const helperTestPause = options?.helperTestPause;
  if (context === null || helperTestPause !== undefined) {
    return readAutomationAuthorityFileSnapshotWithPolicyUncached(
      filePath,
      options,
      policy,
    );
  }
  const cache = OUTCOME_WRITER_AUTHORITY_SNAPSHOT_CACHES.get(context);
  const cacheKey = [
    normalizedPrivateRoot,
    normalizedFilePath,
    policy.requireUtf8 ? "utf8" : "raw",
  ].join("\0");
  const before =
    automationAuthoritySnapshotGenerationFingerprint(normalizedFilePath);
  const cached = cache?.get(cacheKey);
  const requestedAllowedModes = options?.allowedModes ?? [0o600];
  const requestedMaxBytes = options?.maxBytes ?? LEASE_TRANSACTION_MAX_BYTES;
  const cachedSnapshotAllowed =
    cached !== undefined &&
    (cached.snapshot.missing
      ? options?.allowMissing === true
      : cached.snapshot.bytes.length <= requestedMaxBytes &&
        ((options?.allowEmpty ?? true) || cached.snapshot.bytes.length > 0) &&
        requestedAllowedModes.includes(
          Number(cached.snapshot.identity.mode) & 0o7777,
        ));
  if (
    before !== null &&
    cached !== undefined &&
    cachedSnapshotAllowed &&
    cached.generationFingerprint === before
  ) {
    return cloneAutomationAuthoritySnapshot(cached.snapshot);
  }
  const snapshot = readAutomationAuthorityFileSnapshotWithPolicyUncached(
    filePath,
    options,
    policy,
  );
  const after =
    automationAuthoritySnapshotGenerationFingerprint(normalizedFilePath);
  if (cache !== undefined && before !== null && before === after) {
    cache.set(
      cacheKey,
      Object.freeze({
        generationFingerprint: after,
        snapshot: cloneAutomationAuthoritySnapshot(snapshot),
      }),
    );
  } else {
    cache?.delete(cacheKey);
  }
  return snapshot;
}

function readAutomationAuthorityFileSnapshotWithPolicyUncached(
  filePath,
  {
    allowMissing = false,
    allowEmpty = true,
    privateRoot = path.dirname(filePath),
    maxBytes = LEASE_TRANSACTION_MAX_BYTES,
    allowedModes = [0o600],
    label = "Automation authority file",
    missingCode = "invalid_state",
    invalidCode = "invalid_state",
    helperTestPause = undefined,
  } = {},
  { requireUtf8 },
) {
  const { normalizedFilePath, normalizedPrivateRoot, directoryPath } =
    requireAutomationAuthorityPrivatePath(
      filePath,
      privateRoot,
      label,
      invalidCode,
    );
  let directory;
  let descriptor;
  try {
    directory = openPinnedLeaseArchiveDirectory(
      directoryPath,
      `${label} parent directory`,
    );
    const helper = openPinnedLeaseArchiveHelper();
    const inventoryOptions = {
      allowMissing: true,
      allowEmpty,
      maxBytes,
      allowedModes,
      label,
      invalidCode,
    };
    const before = readAutomationAuthorityEntryInventory(
      helper,
      directory,
      path.basename(normalizedFilePath),
      inventoryOptions,
      helperTestPause,
    );
    const directoryIdentity = automationAuthorityDirectoryIdentity(
      directory.identity,
    );
    if (before.missing) {
      if (!allowMissing) {
        throw new AutomationControlError(
          missingCode,
          `${label} is unavailable.`,
        );
      }
      const after = readAutomationAuthorityEntryInventory(
        helper,
        directory,
        path.basename(normalizedFilePath),
        inventoryOptions,
      );
      requireAutomationAuthorityEntryInventoryMatch(before, after, label);
      assertPinnedLeaseArchiveDirectory(directory);
      return Object.freeze({
        filePath: normalizedFilePath,
        privateRoot: normalizedPrivateRoot,
        missing: true,
        bytes: Buffer.alloc(0),
        identity: null,
        directoryIdentity,
      });
    }
    descriptor = openSync(
      normalizedFilePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const heldBefore = fstatSync(descriptor, { bigint: true });
    if (!automationAuthorityInventoryMatchesStats(before, heldBefore)) {
      throw new Error("path-opened generation differs from held-parent proof");
    }
    const bytes = readHeldPrivateFile(descriptor, Number(heldBefore.size));
    const heldAfter = fstatSync(descriptor, { bigint: true });
    const namedAfter = lstatSync(normalizedFilePath, { bigint: true });
    if (
      !automationAuthorityInventoryMatchesStats(before, heldAfter) ||
      !automationAuthorityInventoryMatchesStats(before, namedAfter) ||
      realpathSync(normalizedFilePath) !== normalizedFilePath ||
      digestBytes(bytes) !== before.digest
    ) {
      throw new Error("path-opened generation changed during exact read");
    }
    if (requireUtf8) privateAuthorityDecoder.decode(bytes);
    const after = readAutomationAuthorityEntryInventory(
      helper,
      directory,
      path.basename(normalizedFilePath),
      inventoryOptions,
    );
    requireAutomationAuthorityEntryInventoryMatch(before, after, label);
    assertPinnedLeaseArchiveDirectory(directory);
    return Object.freeze({
      filePath: normalizedFilePath,
      privateRoot: normalizedPrivateRoot,
      missing: false,
      bytes,
      identity: Object.freeze(privateFileIdentity(heldAfter)),
      directoryIdentity,
    });
  } catch (error) {
    if (error instanceof AutomationControlError) throw error;
    throw new AutomationControlError(
      invalidCode,
      `${label} could not be admitted safely.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (directory !== undefined) closeSync(directory.descriptor);
  }
}

export function readAutomationAuthorityFileSnapshot(filePath, options = {}) {
  requireOutsideAutomationPlanningReadCallback(
    "Automation authority file snapshot read",
  );
  return readAutomationAuthorityFileSnapshotInternal(filePath, options);
}

function readAutomationAuthorityFileSnapshotInternal(filePath, options = {}) {
  return readAutomationAuthorityFileSnapshotWithPolicy(filePath, options, {
    requireUtf8: true,
  });
}

function readAutomationAuthorityStageSnapshot(filePath, options = {}) {
  return readAutomationAuthorityFileSnapshotWithPolicy(filePath, options, {
    requireUtf8: false,
  });
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
  if (
    isLegacyUncredentialedLeaseRecord(record) &&
    record.owner !== "freed-owner"
  ) {
    validateLegacyUncredentialedLeaseRecord(
      record,
      name,
      actorPolicy(record.owner),
    );
  } else {
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

function readLeaseDirectorySnapshot(
  paths,
  name,
  leasePath,
  { allowedAdditionalEntries = [] } = {},
) {
  if (!pathEntryExists(leasePath)) {
    return {
      descriptor: leaseStateDescriptor(false, null),
      record: null,
      bytes: null,
    };
  }
  requirePrivateDirectory(leasePath, `Lease directory ${leasePath}`);
  const allowed = new Set(["lease.json", ...allowedAdditionalEntries]);
  const entries = readBoundedLeaseDirectoryEntries(leasePath, {
    maxEntries: allowed.size,
    label: `Lease directory ${leasePath}`,
    errorCode: "lease_transaction_invalid",
  }).sort();
  if (
    entries.some((entry) => !allowed.has(entry)) ||
    entries.filter((entry) => entry === "lease.json").length > 1
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease directory ${leasePath} contains unsupported entries.`,
    );
  }
  if (!entries.includes("lease.json")) {
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
    ...(value?.kind === "actor-credential" ? ["tokenSha256"] : []),
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
    value.size <= 0 ||
    (value.kind === "actor-credential" &&
      !SHA256_PATTERN.test(String(value.tokenSha256 ?? "")))
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      "Lease transaction contains an invalid credential descriptor.",
    );
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
  } else if (value.credentialKind === "trusted-launcher-channel") {
    expectedKeys.push(
      "actorRuntimeDigest",
      "launcherAttestationSha256",
      "launcherChannelProtocol",
      "launcherSessionId",
      "launcherSha256",
    );
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
  const legacy = value.legacyUncredentialed === true;
  const expectedKeys = legacy
    ? ["expiredAt", "heartbeatAt", "legacyUncredentialed", "owner"]
    : ["expiredAt", "heartbeatAt", "owner"];
  if (
    !exactObjectKeys(value, expectedKeys) ||
    typeof value.owner !== "string" ||
    value.owner.trim() === "" ||
    typeof value.expiredAt !== "string" ||
    typeof value.heartbeatAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiredAt)) ||
    !Number.isFinite(Date.parse(value.heartbeatAt))
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      "Lease transaction takeover history is invalid.",
    );
  }
  return structuredClone(value);
}

function expectedAcquireEventData(
  lease,
  capability,
  takeover,
  resultReceipt,
  requestDigest,
) {
  return {
    expiresAt: lease.expiresAt,
    observerAuthority: lease.observerAuthority,
    providerAuthority: lease.providerAuthority,
    requestDigest,
    credentialKind: lease.credentialKind,
    ...(lease.publisherCapabilityId === undefined
      ? {}
      : { publisherCapabilityId: lease.publisherCapabilityId }),
    ...(lease.scope === undefined ? {} : { scope: lease.scope }),
    ...(capability?.kind === "actor-credential"
      ? { actorCredentialPath: capability.sourcePath }
      : {}),
    ...(lease.launcherSha256 === undefined
      ? {}
      : {
          launcherSha256: lease.launcherSha256,
          actorRuntimeDigest: lease.actorRuntimeDigest,
          launcherChannelProtocol: lease.launcherChannelProtocol,
          launcherAttestationSha256: lease.launcherAttestationSha256,
          launcherSessionId: lease.launcherSessionId,
        }),
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
          : ["acquired", "credentialUpgrade", "lease", "previous", "takeover"],
      ) ||
      value.resultReceipt.acquired !== true ||
      typeof value.resultReceipt.takeover !== "boolean" ||
      typeof value.resultReceipt.credentialUpgrade !== "boolean" ||
      value.resultReceipt.takeover !== (takeover !== null) ||
      (takeover === null
        ? Object.hasOwn(value.resultReceipt, "previous")
        : !canonicalValuesEqual(value.resultReceipt.previous, takeover))
    ) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        `Lease transaction for ${value.name} has an invalid acquire receipt.`,
      );
    }
    lease = validateRedactedLeaseRecord(value.resultReceipt.lease, value.name);
    const expectedCapabilityKind =
      lease.credentialKind === "trusted-launcher-channel"
        ? null
        : lease.credentialKind === "persistent-actor"
          ? "actor-credential"
          : lease.credentialKind === "owner-signed-capability"
            ? "owner-capability"
            : lease.credentialKind === "owner-confirmation"
              ? "owner-confirmation"
              : "publisher-capability";
    const expectedSourceName =
      expectedCapabilityKind === null
        ? null
        : expectedCapabilityKind === "actor-credential"
          ? `${lease.owner}.json`
          : expectedCapabilityKind === "owner-capability"
            ? `${lease.ownerCapabilityId}.json`
            : expectedCapabilityKind === "publisher-capability"
              ? `${lease.publisherCapabilityId}.json`
              : null;
    if (
      (expectedCapabilityKind === null
        ? capability !== null
        : capability?.kind !== expectedCapabilityKind) ||
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
      value.requestDigest,
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
    expectedEventData = {
      expiresAt: lease.expiresAt,
      requestDigest: value.requestDigest,
    };
  } else if (value.operation === "bind-head") {
    if (
      !exactObjectKeys(value.resultReceipt, ["bound", "lease"]) ||
      typeof value.resultReceipt.bound !== "boolean" ||
      capability !== null ||
      takeover !== null
    ) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        `Lease transaction for ${value.name} has an invalid head-binding receipt.`,
      );
    }
    lease = validateRedactedLeaseRecord(value.resultReceipt.lease, value.name);
    expectedEventType = value.resultReceipt.bound
      ? "lease_scope_bound"
      : "lease_scope_binding_confirmed";
    expectedEventData = {
      scope: lease.scope,
      requestDigest: value.requestDigest,
    };
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
      requestDigest: value.requestDigest,
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
  tokenSha256 = undefined,
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
  let admittedTokenSha256;
  if (kind === "actor-credential") {
    let credential;
    try {
      credential = JSON.parse(privateAuthorityDecoder.decode(snapshot.bytes));
    } catch {
      credential = null;
    }
    admittedTokenSha256 = String(tokenSha256 ?? "").toLowerCase();
    if (
      !SHA256_PATTERN.test(admittedTokenSha256) ||
      credential?.tokenSha256 !== admittedTokenSha256
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        "Lease actor credential descriptor does not match its admitted token digest.",
      );
    }
  }
  return {
    kind,
    sourcePath,
    consumedPath,
    digest: digestBytes(snapshot.bytes),
    size: snapshot.bytes.length,
    sourceDevice: snapshot.identity.dev,
    sourceInode: snapshot.identity.ino,
    ...(kind === "actor-credential"
      ? { tokenSha256: admittedTokenSha256 }
      : {}),
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

function canonicalNullableLeaseRequestPath(value) {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length > 0 &&
      !value.includes("\0") &&
      path.isAbsolute(value) &&
      path.normalize(value) === value)
  );
}

function validateLeaseTransactionRequest(value, transaction) {
  const commonKeys = ["name", "operation", "operationId", "tokenDigest"];
  const trustedLauncherRequest =
    transaction.operation === "acquire" &&
    Object.hasOwn(value ?? {}, "launcherSha256");
  const trustedLauncherRequestKeys = trustedLauncherRequest
    ? ["actorRuntimeDigest", "launcherChannelProtocol", "launcherSha256"]
    : [];
  const expectedKeys =
    transaction.operation === "acquire"
      ? [
          ...commonKeys,
          "actorCredentialFile",
          "actorCredentialTokenDigest",
          "observerAuthority",
          "owner",
          "ownerCapabilityFile",
          "ownerCapabilityIntentDigest",
          "ownerCapabilityTaskId",
          "ownerConfirmationFile",
          "providerAuthority",
          "publisherCapabilityFile",
          "scope",
          "ttlMs",
          ...trustedLauncherRequestKeys,
        ]
      : transaction.operation === "heartbeat"
        ? [...commonKeys, "ttlMs"]
        : transaction.operation === "bind-head"
          ? [...commonKeys, "headSha", "scope"]
          : commonKeys;
  if (
    !exactObjectKeys(value, expectedKeys) ||
    value.operation !== transaction.operation ||
    value.operationId !== transaction.operationId ||
    value.name !== transaction.name ||
    value.tokenDigest !== transaction.tokenDigest ||
    canonicalLeaseRequestDigest(value) !== transaction.requestDigest
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease transaction for ${transaction.name} has an inexact canonical request.`,
    );
  }

  if (transaction.operation === "acquire") {
    const policy = AUTOMATION_ACTOR_POLICIES[value.owner];
    let normalizedScope = null;
    if (value.scope !== null) {
      try {
        normalizedScope = normalizePublisherScope(value.scope, {
          requireLiveWorktree: false,
        });
      } catch {
        normalizedScope = null;
      }
    }
    const ownerCapabilitySelected = value.ownerCapabilityFile !== null;
    const ownerConfirmationSelected = value.ownerConfirmationFile !== null;
    const ownerAuthorizationSelected =
      Number(ownerCapabilitySelected) + Number(ownerConfirmationSelected);
    const canonicalOwnerGovernance =
      value.owner === "freed-owner"
        ? ownerAuthorizationSelected === 1 &&
          typeof value.ownerCapabilityTaskId === "string" &&
          IDENTIFIER_PATTERN.test(value.ownerCapabilityTaskId) &&
          SHA256_PATTERN.test(String(value.ownerCapabilityIntentDigest ?? ""))
        : ownerAuthorizationSelected === 0 &&
          value.ownerCapabilityTaskId === null &&
          value.ownerCapabilityIntentDigest === null;
    const canonicalPublisher =
      value.owner === "freed-pr-publisher"
        ? value.publisherCapabilityFile !== null &&
          value.scope !== null &&
          normalizedScope !== null &&
          canonicalValuesEqual(value.scope, normalizedScope)
        : value.publisherCapabilityFile === null && value.scope === null;
    const generalActor = !["freed-owner", "freed-pr-publisher"].includes(
      value.owner,
    );
    const canonicalTrustedLauncher =
      trustedLauncherRequest &&
      generalActor &&
      value.actorCredentialFile === null &&
      value.actorCredentialTokenDigest === null &&
      SHA256_PATTERN.test(String(value.launcherSha256 ?? "")) &&
      SHA256_PATTERN.test(String(value.actorRuntimeDigest ?? "")) &&
      value.launcherChannelProtocol === ACTOR_LAUNCHER_CHANNEL_PROTOCOL;
    const canonicalActorCredential = generalActor
      ? canonicalTrustedLauncher ||
        (!trustedLauncherRequest &&
          canonicalNullableLeaseRequestPath(value.actorCredentialFile) &&
          value.actorCredentialFile !== null &&
          path.basename(value.actorCredentialFile) === `${value.owner}.json` &&
          SHA256_PATTERN.test(String(value.actorCredentialTokenDigest ?? "")))
      : value.actorCredentialFile === null &&
        value.actorCredentialTokenDigest === null &&
        !trustedLauncherRequest;
    if (
      policy === undefined ||
      policy.leaseName !== value.name ||
      !Number.isSafeInteger(value.ttlMs) ||
      value.ttlMs <= 0 ||
      value.observerAuthority !== policy.observerAuthority ||
      value.providerAuthority !== policy.providerAuthority ||
      !canonicalNullableLeaseRequestPath(value.ownerCapabilityFile) ||
      !canonicalNullableLeaseRequestPath(value.ownerConfirmationFile) ||
      !canonicalNullableLeaseRequestPath(value.publisherCapabilityFile) ||
      !canonicalActorCredential ||
      !canonicalOwnerGovernance ||
      !canonicalPublisher
    ) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        `Lease acquisition transaction for ${transaction.name} has an invalid canonical request.`,
      );
    }
  } else if (
    transaction.operation === "heartbeat" &&
    value.ttlMs !== null &&
    (!Number.isSafeInteger(value.ttlMs) || value.ttlMs <= 0)
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease heartbeat transaction for ${transaction.name} has an invalid canonical request.`,
    );
  } else if (transaction.operation === "bind-head") {
    let normalizedScope = null;
    try {
      normalizedScope = normalizePublisherScope(value.scope, {
        requireLiveWorktree: false,
      });
    } catch {
      normalizedScope = null;
    }
    if (
      normalizedScope === null ||
      normalizedScope.headSha !== null ||
      !canonicalValuesEqual(value.scope, normalizedScope) ||
      !SHA256_PATTERN.test(value.tokenDigest) ||
      !/^[0-9a-f]{40}$/.test(String(value.headSha ?? ""))
    ) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        `Publisher head transaction for ${transaction.name} has an invalid canonical request.`,
      );
    }
  }
  return structuredClone(value);
}

function validateLeaseTransactionRequestPayload(transaction, request, payload) {
  if (transaction.operation === "heartbeat") {
    if (request.ttlMs !== null && payload.lease.ttlMs !== request.ttlMs) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        `Lease heartbeat transaction for ${transaction.name} does not bind its requested TTL.`,
      );
    }
    return;
  }
  if (transaction.operation === "bind-head") {
    if (
      !canonicalValuesEqual(payload.lease.scope, {
        ...request.scope,
        headSha: request.headSha,
      })
    ) {
      throw new AutomationControlError(
        "lease_transaction_invalid",
        `Publisher head transaction for ${transaction.name} does not bind its requested scope.`,
      );
    }
    return;
  }
  if (transaction.operation !== "acquire") return;
  const lease = payload.lease;
  const capability = payload.capability;
  const expectedSourcePath =
    capability === null
      ? null
      : capability.kind === "owner-capability"
        ? request.ownerCapabilityFile
        : capability.kind === "owner-confirmation"
          ? request.ownerConfirmationFile
          : capability.kind === "publisher-capability"
            ? request.publisherCapabilityFile
            : request.actorCredentialFile;
  const expectedScope = lease.scope ?? null;
  const expectedOwnerTaskId =
    capability?.kind === "owner-capability"
      ? lease.ownerCapabilityTaskId
      : capability?.kind === "owner-confirmation"
        ? lease.ownerConfirmationTaskId
        : null;
  const expectedOwnerIntentDigest =
    capability?.kind === "owner-capability"
      ? lease.ownerCapabilityIntentDigest
      : capability?.kind === "owner-confirmation"
        ? lease.ownerConfirmationIntentDigest
        : null;
  if (
    request.owner !== lease.owner ||
    request.ttlMs !== lease.ttlMs ||
    request.observerAuthority !== lease.observerAuthority ||
    request.providerAuthority !== lease.providerAuthority ||
    expectedSourcePath !== (capability?.sourcePath ?? null) ||
    !canonicalValuesEqual(request.scope, expectedScope) ||
    request.ownerCapabilityTaskId !== expectedOwnerTaskId ||
    request.ownerCapabilityIntentDigest !== expectedOwnerIntentDigest ||
    (capability?.kind === "actor-credential" &&
      request.actorCredentialTokenDigest !== capability.tokenSha256) ||
    (lease.credentialKind === "trusted-launcher-channel" &&
      (capability !== null ||
        request.actorCredentialFile !== null ||
        request.actorCredentialTokenDigest !== null ||
        request.launcherSha256 !== lease.launcherSha256 ||
        request.actorRuntimeDigest !== lease.actorRuntimeDigest ||
        request.launcherChannelProtocol !== lease.launcherChannelProtocol))
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `Lease acquisition transaction for ${transaction.name} does not bind its canonical request to authority.`,
    );
  }
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
    "request",
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
        new Date(completedAtMs).toISOString() !== value.completedAt ||
        completedAtMs < preparedAtMs
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
  const request = validateLeaseTransactionRequest(value.request, value);
  const payload = validateLeaseOperationPayload(value, paths);
  validateLeaseTransactionRequestPayload(value, request, payload);
  const operationValid =
    value.operation === "acquire"
      ? after.directoryExists &&
        after.recordDigest !== null &&
        (payload.lease.credentialKind === "trusted-launcher-channel"
          ? payload.capability === null
          : payload.capability !== null)
      : value.operation === "heartbeat" || value.operation === "bind-head"
        ? before.recordDigest !== null && after.recordDigest !== null
        : before.recordDigest !== null &&
          !after.directoryExists &&
          after.recordDigest === null;
  if (!operationValid) {
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
    request,
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

function requireCanonicalCompletedLeaseReceiptBytes(bytes, transaction, label) {
  if (
    transaction.phase !== "complete" ||
    !bytes.equals(privateJsonBytes(transaction))
  ) {
    throw new AutomationControlError(
      "lease_transaction_invalid",
      `${label} is not the exact canonical completed transaction encoding.`,
    );
  }
}

function readValidatedLeaseTransactionReceipts(paths, name, operation) {
  const { receipts } = leaseTransactionDirectories(paths);
  if (!pathEntryExists(receipts)) return [];
  const eventSnapshot = readControlEventHistorySnapshot(paths.events);
  requireExactLeaseEventHistory(eventSnapshot.events);
  const eventOrderById = new Map(
    eventSnapshot.events.map((event, index) => [event?.eventId, index]),
  );
  requirePrivateDirectory(receipts, "Lease transaction receipt directory");
  const prefix = `${name}.${operation}.`;
  return readBoundedLeaseDirectoryEntries(receipts, {
    maxEntries: LEASE_TRANSACTION_RECEIPT_DIRECTORY_MAX_ENTRIES,
    label: "Lease transaction receipt directory",
    errorCode: "lease_archive_capacity_invalid",
  })
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".json"))
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
      requireCanonicalCompletedLeaseReceiptBytes(
        snapshot.bytes,
        transaction,
        `Lease transaction receipt ${entry}`,
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
      const eventIndex = eventOrderById.get(transaction.event.eventId);
      if (!Number.isSafeInteger(eventIndex)) {
        throw new AutomationControlError(
          "lease_transaction_invalid",
          `Lease transaction receipt ${entry} has no exact physical event order.`,
        );
      }
      return {
        entry,
        filePath,
        bytes: snapshot.bytes,
        identity: snapshot.identity,
        mtimeMs: snapshot.identity.mtimeMs,
        eventIndex,
      };
    });
}

function privateBatchFileSnapshot(entry) {
  const mtimeNs = BigInt(entry.mtimeNs);
  const ctimeNs = BigInt(entry.ctimeNs);
  return Object.freeze({
    bytes: entry.bytes,
    identity: Object.freeze({
      dev: entry.device,
      ino: entry.inode,
      mode: 0o100000 | Number(entry.mode),
      nlink: Number(entry.linkCount),
      uid: Number(entry.uid),
      gid: Number(entry.gid),
      size: Number(entry.size),
      mtimeMs: Number(mtimeNs / 1_000_000n),
      ctimeMs: Number(ctimeNs / 1_000_000n),
      mtimeNs: entry.mtimeNs,
      ctimeNs: entry.ctimeNs,
    }),
  });
}

function privateBatchDirectoryIdentity(entry) {
  return Object.freeze({
    dev: BigInt(entry.device),
    ino: BigInt(entry.inode),
    mode: BigInt(entry.mode),
    uid: BigInt(entry.uid),
  });
}

function leaseTransactionOperationForEventType(eventType) {
  if (
    [
      "lease_acquired",
      "lease_credential_upgraded",
      "lease_taken_over",
    ].includes(eventType)
  ) {
    return "acquire";
  }
  if (eventType === "lease_heartbeat") return "heartbeat";
  if (
    ["lease_scope_binding_confirmed", "lease_scope_bound"].includes(eventType)
  ) {
    return "bind-head";
  }
  if (eventType === "lease_released") return "release";
  return null;
}

function requirePrivateBatchChildDirectory(
  parentInventory,
  parent,
  childName,
  childPath,
  label,
) {
  const admitted = parentInventory.entryByName.get(childName);
  if (admitted?.kind !== "directory") {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${label} is missing from its admitted parent inventory.`,
    );
  }
  const child = openPinnedLeaseArchiveDirectory(childPath, label);
  try {
    const held = privateBatchParentReceipt(child);
    if (
      admitted.device !== held.parentDevice ||
      admitted.inode !== held.parentInode ||
      admitted.mode !== held.parentMode ||
      admitted.linkCount !== held.parentLinkCount ||
      admitted.uid !== held.parentUid ||
      admitted.gid !== held.parentGid ||
      admitted.size !== held.parentSize ||
      admitted.mtimeNs !== held.parentMtimeNs ||
      admitted.ctimeNs !== held.parentCtimeNs ||
      child.identity.dev !== parent.identity.dev
    ) {
      throw new AutomationControlError(
        "control_event_history_invalid",
        `${label} changed after parent inventory admission.`,
      );
    }
    return child;
  } catch (error) {
    closeSync(child.descriptor);
    throw error;
  }
}

function requirePrivateBatchExistingChildDirectory(
  parentInventory,
  parent,
  childName,
  child,
  label,
) {
  const admitted = parentInventory.entryByName.get(childName);
  const held = privateBatchParentReceipt(child);
  if (
    admitted?.kind !== "directory" ||
    admitted.device !== held.parentDevice ||
    admitted.inode !== held.parentInode ||
    admitted.mode !== held.parentMode ||
    admitted.linkCount !== held.parentLinkCount ||
    admitted.uid !== held.parentUid ||
    admitted.gid !== held.parentGid ||
    admitted.size !== held.parentSize ||
    admitted.mtimeNs !== held.parentMtimeNs ||
    admitted.ctimeNs !== held.parentCtimeNs ||
    child.identity.dev !== parent.identity.dev
  ) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${label} does not match its exact leases parent inventory generation.`,
    );
  }
  assertPinnedLeaseArchiveDirectory(child);
}

function admitCanonicalTransactionalLeaseState(
  paths,
  helper,
  leasesDirectory,
  leasesInventory,
  name,
) {
  const leasePath = leasePathFor(paths, name);
  const leaseEntry = path.basename(leasePath);
  if (leasesInventory.entryByName.get(leaseEntry)?.kind !== "directory") {
    return null;
  }
  const directory = requirePrivateBatchChildDirectory(
    leasesInventory,
    leasesDirectory,
    leaseEntry,
    leasePath,
    `Canonical lease directory ${name}`,
  );
  try {
    const inventory = admitPrivateBatchInventory(
      helper,
      directory,
      "private-file-batch-read",
    );
    const recordIdentity = inventory.entryByName.get("lease.json");
    if (inventory.entryCount !== 1 || recordIdentity?.kind !== "file") {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${name} canonical authority is not one exact private record generation.`,
      );
    }
    let snapshot = null;
    readPrivateBatchSelection(
      helper,
      directory,
      "private-file-batch-read",
      inventory,
      ["lease.json"],
      {
        onEntry(entry) {
          const record = parseLeaseRecordBytes(entry.bytes, name);
          snapshot = Object.freeze({
            descriptor: leaseStateDescriptor(true, entry.bytes),
            record,
          });
        },
      },
    );
    if (snapshot === null) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${name} canonical authority could not be admitted.`,
      );
    }
    return Object.freeze({ directory, inventory, snapshot });
  } catch (error) {
    closeSync(directory.descriptor);
    throw error;
  }
}

function admitParsedLeaseCleanupEvidence(
  paths,
  transaction,
  archiveScope,
  directory,
  selected,
) {
  const snapshot = privateBatchFileSnapshot(selected);
  const quarantinePath = path.join(directory.path, selected.name);
  if (Number(selected.mode) !== 0o600) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease cleanup archive ${selected.name} is not mode 0600.`,
    );
  }
  const atomicMatches = leaseAtomicArchiveSpecifications(
    paths,
    transaction,
    archiveScope,
  ).filter((specification) =>
    leaseAtomicArchiveSpecificationMatches(
      quarantinePath,
      specification,
      snapshot,
    ),
  );
  if (atomicMatches.length > 1) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease cleanup archive ${selected.name} has an ambiguous atomic namespace.`,
    );
  }
  if (atomicMatches.length === 1) {
    const [specification] = atomicMatches;
    if (
      archiveScope === "transaction" &&
      specification.target === "wal" &&
      specification.kind === "WAL"
    ) {
      let retired = null;
      try {
        retired = parseRetiredLeaseTransactionSnapshot(
          paths,
          transaction,
          snapshot,
        );
      } catch {
        retired = null;
      }
      if (retired !== null) {
        return Object.freeze({
          archiveScope,
          entry: selected.name,
          quarantinePath,
          kind: "active-wal",
          side: null,
          filePath: leaseTransactionFiles(
            paths,
            transaction.name,
            transaction.operationId,
            transaction.operation,
          ).transaction,
          identity: snapshot.identity,
          contentDigest: selected.digest,
          transaction: retired,
          canonicalBytes: selected.bytes.equals(privateJsonBytes(retired)),
        });
      }
    }
    return Object.freeze({
      archiveScope,
      entry: selected.name,
      quarantinePath,
      kind: "atomic-evidence",
      atomicTarget: specification.target,
      atomicKind: specification.kind,
      evidenceClass: specification.evidenceClass,
      originalPath: specification.temporaryPath,
      identity: snapshot.identity,
      contentDigest: selected.digest,
      bytes: selected.bytes,
    });
  }
  if (archiveScope === "receipt") {
    const receipt = parseLeaseTransactionBytes(
      selected.bytes,
      paths,
      transaction.name,
    );
    const originalPath = leaseTransactionFiles(
      paths,
      transaction.name,
      receipt.operationId,
      receipt.operation,
    ).receipt;
    validateArchivedReceiptSnapshot(paths, transaction, originalPath, snapshot);
    if (
      !leaseCleanupQuarantinePathMatchesTransaction(
        paths,
        transaction,
        "receipt",
        quarantinePath,
        originalPath,
        snapshot,
      )
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease receipt archive ${selected.name} has the wrong operation-bound generation digest.`,
      );
    }
    return Object.freeze({
      archiveScope,
      entry: selected.name,
      quarantinePath,
      originalPath,
      identity: snapshot.identity,
      contentDigest: selected.digest,
      receipt,
    });
  }

  const files = leaseTransactionFiles(
    paths,
    transaction.name,
    transaction.operationId,
    transaction.operation,
  );
  const specs = [
    { kind: "staging-before", side: "before", filePath: files.before },
    { kind: "staging-after", side: "after", filePath: files.after },
    { kind: "active-wal", side: null, filePath: files.transaction },
  ];
  const matches = specs.filter((spec) =>
    leaseCleanupQuarantinePathMatchesTransaction(
      paths,
      transaction,
      "transaction",
      quarantinePath,
      spec.filePath,
      snapshot,
    ),
  );
  if (matches.length !== 1) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease cleanup archive ${selected.name} does not map to one exact transaction target.`,
    );
  }
  const [spec] = matches;
  if (spec.kind === "active-wal") {
    const retired = parseRetiredLeaseTransactionSnapshot(
      paths,
      transaction,
      snapshot,
    );
    return Object.freeze({
      archiveScope,
      entry: selected.name,
      quarantinePath,
      ...spec,
      identity: snapshot.identity,
      contentDigest: selected.digest,
      transaction: retired,
      canonicalBytes: selected.bytes.equals(privateJsonBytes(retired)),
    });
  }
  const record = parseLeaseRecordBytes(selected.bytes, transaction.name);
  return Object.freeze({
    archiveScope,
    entry: selected.name,
    quarantinePath,
    ...spec,
    identity: snapshot.identity,
    contentDigest: selected.digest,
    bytes: selected.bytes,
    descriptorKey: `${selected.bytes.length}:${selected.digest}`,
    record,
  });
}

function validateLeaseAtomicEvidenceSet(
  transaction,
  evidence,
  stagingBytesBySide,
) {
  const walCandidates = [
    "prepared",
    "state-committed",
    "event-appended",
    "complete",
  ].map((phase) =>
    privateJsonBytes(
      phase === "complete"
        ? transaction
        : { ...transaction, phase, completedAt: null },
    ),
  );
  for (const entry of evidence) {
    if (
      ["pre-wal-cleanup", "non-authoritative-residue"].includes(
        entry.evidenceClass,
      )
    ) {
      if (
        entry.evidenceClass === "pre-wal-cleanup" &&
        !["staging-before", "staging-after", "wal"].includes(entry.atomicTarget)
      ) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease atomic cleanup ${entry.entry} has an invalid pre-WAL target.`,
        );
      }
      if (
        entry.evidenceClass === "non-authoritative-residue" &&
        entry.atomicTarget !== "wal"
      ) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease atomic residue ${entry.entry} has an invalid target.`,
        );
      }
      continue;
    }
    let candidates;
    if (entry.atomicTarget === "wal") {
      candidates = walCandidates;
    } else if (entry.atomicTarget === "receipt") {
      candidates = [privateJsonBytes(transaction)];
    } else if (entry.atomicTarget === "record") {
      candidates = [
        stagingBytesBySide.get("before"),
        stagingBytesBySide.get("after"),
      ].filter(Buffer.isBuffer);
    } else if (entry.atomicTarget === "staging-before") {
      candidates = [stagingBytesBySide.get("before")].filter(Buffer.isBuffer);
    } else if (entry.atomicTarget === "staging-after") {
      candidates = [stagingBytesBySide.get("after")].filter(Buffer.isBuffer);
    } else {
      candidates = [];
    }
    const exactRequired = entry.evidenceClass === "canonical-or-successor";
    const matches = candidates.filter((candidate) =>
      exactRequired
        ? entry.bytes.equals(candidate)
        : leaseBytesAreCanonicalPrefix(entry.bytes, candidate),
    );
    if (matches.length === 0) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease atomic evidence ${entry.entry} is not an allowed ${entry.atomicTarget} generation.`,
      );
    }
  }
}

export function inspectLeaseTransactionEventHistory(options) {
  requireOutsideAutomationPlanningReadCallback(
    "Lease transaction event history inspection",
  );
  return inspectLeaseTransactionEventHistoryInternal(options);
}

function leaseAuthorityTreeGenerationFingerprint(paths) {
  const root = paths.leases;
  const scan = () => {
    const generations = [];
    let entryCount = 0;
    let encodedNameBytes = 0;
    const visit = (directoryPath, depth) => {
      if (depth > 32) throw new Error("lease authority tree is too deep");
      const directory = lstatSync(directoryPath, { bigint: true });
      if (
        !directory.isDirectory() ||
        directory.isSymbolicLink() ||
        realpathSync(directoryPath) !== directoryPath
      ) {
        throw new Error("lease authority tree has an unsafe directory");
      }
      const relativeDirectory = path.relative(root, directoryPath);
      generations.push(
        `d:${Buffer.from(relativeDirectory, "utf8").toString("hex")}:${filesystemGenerationFingerprint(directory)}`,
      );
      const names = readdirSync(directoryPath, { encoding: "buffer" }).sort(
        Buffer.compare,
      );
      for (const encodedName of names) {
        entryCount += 1;
        encodedNameBytes += encodedName.length;
        if (entryCount > 4_096 || encodedNameBytes > 4 * 1024 * 1024) {
          throw new Error("lease authority tree exceeds its cache boundary");
        }
        const name = privateAuthorityDecoder.decode(encodedName);
        if (
          name.length === 0 ||
          name === "." ||
          name === ".." ||
          name.includes(path.sep) ||
          name.includes("\0")
        ) {
          throw new Error("lease authority tree has an invalid entry name");
        }
        const childPath = path.join(directoryPath, name);
        const child = lstatSync(childPath, { bigint: true });
        if (child.isSymbolicLink() || realpathSync(childPath) !== childPath) {
          throw new Error("lease authority tree has an unsafe entry");
        }
        const relative = path.relative(root, childPath);
        if (child.isDirectory()) {
          visit(childPath, depth + 1);
        } else if (child.isFile()) {
          generations.push(
            `f:${Buffer.from(relative, "utf8").toString("hex")}:${filesystemGenerationFingerprint(child)}`,
          );
        } else {
          throw new Error("lease authority tree has an unsupported entry");
        }
      }
    };
    try {
      visit(root, 0);
      return digestBytes(Buffer.from(generations.join("\n"), "utf8"));
    } catch {
      return null;
    }
  };
  const before = scan();
  if (before === null) return null;
  const after = scan();
  return before === after ? after : null;
}

function inspectLeaseTransactionEventHistoryForPlanning(paths, events) {
  const context = ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS_BY_ROOT.get(
    paths.stateRoot,
  );
  if (context === undefined) {
    return inspectLeaseTransactionEventHistoryInternal({
      stateRoot: paths.stateRoot,
      events,
    });
  }
  const leaseEventDigest = digestBytes(
    Buffer.from(
      JSON.stringify(
        events.filter(
          (event) =>
            typeof event?.eventId === "string" &&
            (event.eventId.startsWith("lease:") ||
              LEASE_CONTROL_EVENT_TYPES.has(event.type)),
        ),
      ),
      "utf8",
    ),
  );
  const before = leaseAuthorityTreeGenerationFingerprint(paths);
  const cached = OUTCOME_WRITER_LEASE_HISTORY_CACHES.get(context);
  if (
    before !== null &&
    cached !== null &&
    cached !== undefined &&
    cached.leaseEventDigest === leaseEventDigest &&
    cached.generationFingerprint === before
  ) {
    return cached.inspection;
  }
  const inspection = inspectLeaseTransactionEventHistoryInternal({
    stateRoot: paths.stateRoot,
    events,
  });
  const after = leaseAuthorityTreeGenerationFingerprint(paths);
  OUTCOME_WRITER_LEASE_HISTORY_CACHES.set(
    context,
    before !== null && before === after
      ? Object.freeze({
          generationFingerprint: after,
          inspection,
          leaseEventDigest,
        })
      : null,
  );
  return inspection;
}

function inspectLeaseTransactionEventHistoryInternal({
  stateRoot = undefined,
  events,
  checkpoint = undefined,
}) {
  if (!Array.isArray(events)) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      "Retained lease receipt inspection requires an event array.",
    );
  }
  if (checkpoint !== undefined && typeof checkpoint !== "function") {
    throw new AutomationControlError(
      "invalid_argument",
      "Lease transaction history checkpoint must be a function.",
    );
  }
  const paths = automationControlPaths(stateRoot);
  const invokeCheckpoint = (phase, details = undefined) => {
    if (checkpoint === undefined) return;
    const result = checkpoint(phase, details);
    if (result && typeof result.then === "function") {
      throw new AutomationControlError(
        "invalid_argument",
        "Lease transaction history checkpoints must be synchronous.",
      );
    }
  };
  const { transactions, receipts } = leaseTransactionDirectories(paths);
  const issues = [];
  const validatedTransactions = [];
  const quarantineBindings = new Map();
  const batchAdmissions = [];
  const canonicalLeaseAdmissions = new Map();
  let transactionDirectory;
  let receiptDirectory;
  let stateArchiveDirectory;
  let leasesDirectory;
  let transactionsExist = false;
  let receiptsExist = false;
  let retainedReceiptCount = 0;
  let pendingTransactionArtifactCount = 0;
  const eventsById = new Map();
  for (const event of events) {
    if (typeof event?.eventId !== "string") continue;
    const matches = eventsById.get(event.eventId) ?? [];
    matches.push(event);
    eventsById.set(event.eventId, matches);
  }
  const operationIdPattern =
    "(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";
  const receiptPattern = new RegExp(
    `^(.+)\\.(acquire|heartbeat|bind-head|release)\\.(${operationIdPattern})\\.json$`,
  );
  const archivePattern = new RegExp(
    `^(${operationIdPattern})(?:\\.([0-9a-f]{64}))?\\.([0-9a-f]{64})\\.json$`,
  );
  const transactionalReceiptGroups = new Map();
  let transactionalLeaseEventCount = 0;
  for (const event of events) {
    if (
      typeof event?.eventId !== "string" ||
      !event.eventId.startsWith("lease:")
    ) {
      continue;
    }
    transactionalLeaseEventCount += 1;
    const operation = leaseTransactionOperationForEventType(event.type);
    const operationId = event.eventId.slice("lease:".length);
    let name;
    try {
      name = requireIdentifier(event.leaseName, "lease name");
      requireLeaseOperationId(operationId);
    } catch {
      name = null;
    }
    if (operation === null || name === null) {
      issues.push(
        `transactional lease event ${event.eventId} cannot map to one retained receipt group`,
      );
      continue;
    }
    const groupKey = `${name}\0${operation}`;
    const group = transactionalReceiptGroups.get(groupKey) ?? [];
    group.push(
      path.basename(
        leaseTransactionFiles(paths, name, operationId, operation).receipt,
      ),
    );
    transactionalReceiptGroups.set(groupKey, group);
  }
  const requiredReceiptEntries = new Set(
    [...transactionalReceiptGroups.values()].flatMap((group) =>
      group.slice(-LEASE_TRANSACTION_RECEIPT_RETENTION),
    ),
  );
  const validatedReceiptEntries = new Set();
  const transactionByEventId = new Map();
  const validatedTransactionEventIds = new Set();
  let helper;
  const admitInventory = (
    directory,
    operation,
    expectedDirectoryNames = [],
  ) => {
    let inventory;
    try {
      inventory = admitPrivateBatchInventory(
        helper,
        directory,
        operation,
        expectedDirectoryNames,
      );
    } catch (error) {
      throw new AutomationControlError(
        "control_event_history_invalid",
        `${directory.label} batch admission failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    batchAdmissions.push(
      Object.freeze({
        directory,
        operation,
        expectedDirectoryNames: Object.freeze([...expectedDirectoryNames]),
        inventory,
      }),
    );
    return inventory;
  };

  try {
    transactionsExist = pathEntryExists(transactions);
    receiptsExist = pathEntryExists(receipts);
    if (!transactionsExist && !receiptsExist) {
      let cutoverInspection;
      try {
        cutoverInspection = inspectAutomationKernelGuardCutover(
          paths.stateRoot,
        );
      } catch (error) {
        issues.push(
          `automation kernel guard cutover readiness is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      const cutoverPaths = automationKernelGuardCutoverPaths(paths.stateRoot);
      const cutoverEvidencePresent = [
        cutoverPaths.globalReceipt,
        cutoverPaths.transaction,
        cutoverPaths.writeAhead,
        cutoverPaths.bootstrapLock,
        cutoverPaths.artifactRoot,
      ].some((filePath) => pathEntryExists(filePath));
      if (cutoverInspection?.ready === true) {
        issues.push(
          "lease transaction and receipt directories are missing after kernel guard cutover",
        );
      } else if (cutoverEvidencePresent) {
        issues.push(
          `lease transaction and receipt directories are missing beside invalid kernel guard cutover evidence: ${(
            cutoverInspection?.problems ?? []
          ).join("; ")}`,
        );
      }
      if (transactionalLeaseEventCount > 0) {
        issues.push(
          "lease transaction and receipt directories are missing despite retained transactional lease events",
        );
      }
      return Object.freeze({
        healthy: issues.length === 0,
        issues: Object.freeze(issues),
        retainedReceiptCount: 0,
        pendingTransactionArtifactCount: 0,
      });
    }
    if (transactionsExist !== receiptsExist) {
      issues.push(
        "lease transaction and receipt directories must initialize together",
      );
    }
    helper = openPinnedLeaseArchiveHelper();
    leasesDirectory = openPinnedLeaseArchiveDirectory(
      paths.leases,
      "Lease authority directory",
    );
    if (transactionsExist) {
      transactionDirectory = openPinnedLeaseArchiveDirectory(
        transactions,
        "Lease transaction directory",
      );
      if (
        !pathEntryExists(
          path.join(transactions, LEASE_CLEANUP_QUARANTINE_DIRECTORY),
        )
      ) {
        throw new AutomationControlError(
          "control_event_history_invalid",
          "lease transaction cleanup archive directory is missing",
        );
      }
      const transactionInventory = admitInventory(
        transactionDirectory,
        "private-file-batch-read",
        [LEASE_CLEANUP_QUARANTINE_DIRECTORY],
      );
      if (
        transactionInventory.entryCount >
        LEASE_TRANSACTION_DIRECTORY_MAX_ENTRIES
      ) {
        throw new AutomationControlError(
          "control_event_history_invalid",
          "Lease transaction directory exceeds its exact entry boundary.",
        );
      }
      quarantineBindings.set(
        "transaction",
        requirePrivateBatchChildDirectory(
          transactionInventory,
          transactionDirectory,
          LEASE_CLEANUP_QUARANTINE_DIRECTORY,
          path.join(transactions, LEASE_CLEANUP_QUARANTINE_DIRECTORY),
          "Lease transaction cleanup archive directory",
        ),
      );
      for (const entry of transactionInventory.entries) {
        if (entry.kind === "directory") continue;
        pendingTransactionArtifactCount += 1;
        issues.push(
          `pending lease transaction artifact ${entry.name} requires exact recovery`,
        );
      }
    }

    if (receiptsExist) {
      receiptDirectory = openPinnedLeaseArchiveDirectory(
        receipts,
        "Lease transaction receipt directory",
      );
      if (
        !pathEntryExists(
          path.join(receipts, LEASE_CLEANUP_QUARANTINE_DIRECTORY),
        )
      ) {
        throw new AutomationControlError(
          "control_event_history_invalid",
          "lease receipt cleanup archive directory is missing",
        );
      }
      const receiptInventory = admitInventory(
        receiptDirectory,
        "private-file-batch-read",
        [LEASE_CLEANUP_QUARANTINE_DIRECTORY],
      );
      if (
        receiptInventory.entryCount >
        LEASE_TRANSACTION_RECEIPT_DIRECTORY_MAX_ENTRIES
      ) {
        throw new AutomationControlError(
          "control_event_history_invalid",
          "Lease transaction receipt directory exceeds its exact entry boundary.",
        );
      }
      quarantineBindings.set(
        "receipt",
        requirePrivateBatchChildDirectory(
          receiptInventory,
          receiptDirectory,
          LEASE_CLEANUP_QUARANTINE_DIRECTORY,
          path.join(receipts, LEASE_CLEANUP_QUARANTINE_DIRECTORY),
          "Lease receipt cleanup archive directory",
        ),
      );
      const selectedReceiptNames = [];
      const receiptIdentityByName = new Map();
      for (const identity of receiptInventory.entries) {
        if (identity.kind === "directory") continue;
        const entry = identity.name;
        const match = receiptPattern.exec(entry);
        if (match === null) {
          issues.push(`lease transaction receipt ${entry} has an invalid name`);
          continue;
        }
        let name;
        let operationId;
        try {
          name = requireIdentifier(match[1], "lease name");
          operationId = requireLeaseOperationId(match[3]);
        } catch {
          issues.push(
            `lease transaction receipt ${entry} has an invalid identity`,
          );
          continue;
        }
        selectedReceiptNames.push(entry);
        receiptIdentityByName.set(entry, {
          name,
          operation: match[2],
          operationId,
        });
      }
      readPrivateBatchSelection(
        helper,
        receiptDirectory,
        "private-file-batch-read",
        receiptInventory,
        selectedReceiptNames,
        {
          expectedDirectoryNames: [LEASE_CLEANUP_QUARANTINE_DIRECTORY],
          onEntry(selected) {
            const entry = selected.name;
            const identity = receiptIdentityByName.get(entry);
            const filePath = path.join(receipts, entry);
            try {
              const transaction = parseLeaseTransactionBytes(
                selected.bytes,
                paths,
                identity.name,
              );
              requireCanonicalCompletedLeaseReceiptBytes(
                selected.bytes,
                transaction,
                `Lease transaction receipt ${entry}`,
              );
              if (
                transaction.phase !== "complete" ||
                transaction.operation !== identity.operation ||
                transaction.operationId !== identity.operationId ||
                leaseTransactionFiles(
                  paths,
                  identity.name,
                  transaction.operationId,
                  transaction.operation,
                ).receipt !== filePath
              ) {
                throw new AutomationControlError(
                  "lease_transaction_invalid",
                  `Lease transaction receipt ${entry} does not match its canonical operation identity.`,
                );
              }
              if (transactionByEventId.has(transaction.event.eventId)) {
                throw new AutomationControlError(
                  "lease_transaction_invalid",
                  `Lease transaction receipt ${entry} duplicates one retained event transaction.`,
                );
              }
              const admitted = Object.freeze({
                entry,
                transaction,
                identity: privateBatchFileSnapshot(selected).identity,
                contentDigest: selected.digest,
              });
              validatedTransactions.push(admitted);
              transactionByEventId.set(transaction.event.eventId, transaction);
              validatedReceiptEntries.add(entry);
              retainedReceiptCount += 1;
              const eventMatches =
                eventsById.get(transaction.event.eventId) ?? [];
              if (
                eventMatches.length !== 1 ||
                !canonicalValuesEqual(eventMatches[0], transaction.event)
              ) {
                issues.push(
                  `retained lease transaction receipt ${entry} does not match one exact control event`,
                );
              }
            } catch (error) {
              issues.push(
                `lease transaction receipt ${entry} is invalid: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          },
        },
      );
    }

    for (const entry of requiredReceiptEntries) {
      if (!validatedReceiptEntries.has(entry)) {
        issues.push(
          `required retained lease transaction receipt ${entry} is missing`,
        );
      }
    }
    for (const entry of validatedReceiptEntries) {
      if (!requiredReceiptEntries.has(entry)) {
        issues.push(
          `lease transaction receipt ${entry} is outside its retained event suffix`,
        );
      }
    }

    const topologyReady =
      transactionsExist &&
      receiptsExist &&
      quarantineBindings.has("transaction") &&
      quarantineBindings.has("receipt");
    const cleanupInventoryByScope = new Map();
    const cleanupNamesByOperation = new Map();
    const cleanupOperationIdByEntry = new Map();
    if (topologyReady) {
      const retainedOperationIdByPrefix = new Map();
      for (const { transaction } of validatedTransactions) {
        for (const archiveScope of ["transaction", "receipt"]) {
          for (const prefix of leaseCleanupArchivePrefixes(
            paths,
            transaction,
            archiveScope,
          )) {
            const key = `${archiveScope}\0${prefix}`;
            const existing = retainedOperationIdByPrefix.get(key);
            if (
              existing !== undefined &&
              existing !== transaction.operationId
            ) {
              issues.push(
                `lease cleanup prefix ${prefix} is shared by retained operations`,
              );
            }
            retainedOperationIdByPrefix.set(key, transaction.operationId);
          }
        }
      }
      for (const archiveScope of ["transaction", "receipt"]) {
        const directory = quarantineBindings.get(archiveScope);
        const inventory = admitInventory(
          directory,
          "private-file-batch-read-allow-empty",
        );
        cleanupInventoryByScope.set(archiveScope, inventory);
        for (const identity of inventory.entries) {
          const entry = identity.name;
          const match = archivePattern.exec(entry);
          if (match === null) {
            issues.push(`lease cleanup archive ${entry} has an invalid name`);
            continue;
          }
          const selectionPrefix =
            match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`;
          const operationId = retainedOperationIdByPrefix.get(
            `${archiveScope}\0${selectionPrefix}`,
          );
          if (operationId === undefined) {
            if (
              match[2] !== undefined &&
              validatedTransactions.some(
                ({ transaction }) => transaction.operationId === match[1],
              )
            ) {
              issues.push(
                `lease cleanup archive ${entry} has an unknown namespace for retained operation ${match[1]}`,
              );
            }
            continue;
          }
          const key = `${archiveScope}\0${operationId}`;
          const names = cleanupNamesByOperation.get(key) ?? [];
          names.push(entry);
          cleanupNamesByOperation.set(key, names);
          cleanupOperationIdByEntry.set(
            `${archiveScope}\0${entry}`,
            operationId,
          );
        }
      }
    }

    const transactionByOperationId = new Map(
      validatedTransactions.map(({ transaction }) => [
        transaction.operationId,
        transaction,
      ]),
    );
    const admittedParsedCleanupEvidence = new Map();
    if (topologyReady && pendingTransactionArtifactCount === 0) {
      for (const archiveScope of ["transaction", "receipt"]) {
        const directory = quarantineBindings.get(archiveScope);
        const inventory = cleanupInventoryByScope.get(archiveScope);
        const selectedNames = [...cleanupNamesByOperation.entries()]
          .filter(([key]) => key.startsWith(`${archiveScope}\0`))
          .flatMap(([, names]) => names);
        invokeCheckpoint("lease-history-cleanup-batch-selection", {
          archiveScope,
          selectedEntryCount: selectedNames.length,
        });
        readPrivateBatchSelection(
          helper,
          directory,
          "private-file-batch-read-allow-empty",
          inventory,
          selectedNames,
          {
            onEntry(selected) {
              const operationId = cleanupOperationIdByEntry.get(
                `${archiveScope}\0${selected.name}`,
              );
              const transaction = transactionByOperationId.get(operationId);
              try {
                if (transaction === undefined) {
                  throw new AutomationControlError(
                    "lease_transaction_conflict",
                    `Lease cleanup archive ${selected.name} lost its retained transaction identity.`,
                  );
                }
                const evidence = admitParsedLeaseCleanupEvidence(
                  paths,
                  transaction,
                  archiveScope,
                  directory,
                  selected,
                );
                const operationEvidence =
                  admittedParsedCleanupEvidence.get(operationId) ?? [];
                operationEvidence.push(evidence);
                admittedParsedCleanupEvidence.set(
                  operationId,
                  operationEvidence,
                );
              } catch (error) {
                issues.push(
                  `lease cleanup archive ${selected.name} is invalid: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                );
              }
            },
          },
        );
      }
      for (const {
        entry,
        transaction,
        contentDigest,
      } of validatedTransactions) {
        try {
          validateCompletedLeaseReceiptHealthEvidence(paths, transaction, {
            admittedParsedCleanupEvidence,
            receiptContentDigest: contentDigest,
          });
          validatedTransactionEventIds.add(transaction.event.eventId);
        } catch (error) {
          issues.push(
            `lease transaction receipt ${entry} retained evidence is invalid: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    const releaseTransactions = validatedTransactions.filter(
      ({ transaction }) => transaction.operation === "release",
    );
    const admittedStateArchives = new Map();
    if (topologyReady) {
      stateArchiveDirectory = openPinnedLeaseArchiveDirectory(
        leaseStateQuarantineDirectory(paths),
        "Lease state quarantine directory",
      );
      const stateInventory = admitInventory(
        stateArchiveDirectory,
        "private-lease-state-batch-read",
      );
      const selectedStateNames = [];
      const stateTransactionByName = new Map();
      for (const { transaction } of releaseTransactions) {
        const namespace = leaseStateRetirementNamespace(transaction, "release");
        const matches = stateInventory.entries.filter((candidate) =>
          candidate.name.startsWith(`${namespace}.`),
        );
        if (matches.length !== 1) {
          issues.push(
            `lease transaction receipt ${transaction.operationId} release evidence has an inexact retired authority directory set`,
          );
          continue;
        }
        const [candidate] = matches;
        const descriptor = Object.freeze({
          directoryExists: true,
          recordDigest: candidate.record?.digest ?? null,
          recordSize: Number(candidate.record?.size ?? 0),
        });
        const expectedDigest = leaseStateDirectoryGenerationDigest(
          paths,
          transaction,
          "release",
          privateBatchDirectoryIdentity(candidate),
          descriptor,
        );
        if (candidate.name !== `${namespace}.${expectedDigest}.lease`) {
          issues.push(
            `lease transaction receipt ${transaction.operationId} retired authority directory changed generation`,
          );
          continue;
        }
        selectedStateNames.push(candidate.name);
        stateTransactionByName.set(candidate.name, transaction);
      }
      readPrivateBatchSelection(
        helper,
        stateArchiveDirectory,
        "private-lease-state-batch-read",
        stateInventory,
        selectedStateNames,
        {
          onEntry(selected) {
            const transaction = stateTransactionByName.get(selected.name);
            try {
              const bytes = selected.record?.bytes ?? null;
              const snapshot = Object.freeze({
                descriptor: leaseStateDescriptor(true, bytes),
                record:
                  bytes === null
                    ? null
                    : parseLeaseRecordBytes(bytes, transaction.name),
              });
              admittedStateArchives.set(
                transaction.operationId,
                Object.freeze({
                  archivePath: path.join(
                    stateArchiveDirectory.path,
                    selected.name,
                  ),
                  snapshot,
                  directoryIdentity: privateBatchDirectoryIdentity(selected),
                }),
              );
            } catch (error) {
              issues.push(
                `lease transaction receipt ${transaction.operationId} retired authority is invalid: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          },
        },
      );
      for (const { entry, transaction } of releaseTransactions) {
        try {
          requireReleaseLeaseStateRetirement(paths, transaction, {
            admittedStateArchives,
            retiredEvidenceOnly: true,
          });
        } catch (error) {
          issues.push(
            `lease transaction receipt ${entry} retained release evidence is invalid: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    let exactLeaseHistory = null;
    try {
      exactLeaseHistory = requireExactLeaseEventHistory(events);
    } catch (error) {
      issues.push(
        `retained lease transaction history is not exact: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const latestTransactionalStateEventByLeaseName = new Map();
    for (const [index, event] of events.entries()) {
      if (
        typeof event?.eventId !== "string" ||
        !event.eventId.startsWith("lease:")
      ) {
        continue;
      }
      const operation = leaseTransactionOperationForEventType(event.type);
      if (operation === null || typeof event.leaseName !== "string") continue;
      if (operation === "release") {
        latestTransactionalStateEventByLeaseName.delete(event.leaseName);
      } else {
        latestTransactionalStateEventByLeaseName.set(event.leaseName, {
          event,
          index,
          operation,
        });
      }
    }
    if (exactLeaseHistory !== null && topologyReady) {
      const activeTransactionalLeaseNames = new Set(
        [...exactLeaseHistory.activeByLeaseName.entries()]
          .filter(([name, active]) => {
            const latest = latestTransactionalStateEventByLeaseName.get(name);
            return (
              latest !== undefined && latest.index >= active.acquisitionIndex
            );
          })
          .map(([name]) => name),
      );
      const expectedLeaseDirectories = [
        ".transactions",
        ".transaction-receipts",
        LEASE_STATE_QUARANTINE_DIRECTORY,
        ...[...activeTransactionalLeaseNames].map((name) => `${name}.lease`),
      ];
      const leasesInventory = admitInventory(
        leasesDirectory,
        "private-file-batch-read",
        expectedLeaseDirectories,
      );
      if (leasesInventory.entries.some((entry) => entry.kind !== "directory")) {
        throw new AutomationControlError(
          "control_event_history_invalid",
          "Lease authority directory contains an unexpected non-directory sibling.",
        );
      }
      requirePrivateBatchExistingChildDirectory(
        leasesInventory,
        leasesDirectory,
        ".transactions",
        transactionDirectory,
        "Lease transaction directory",
      );
      requirePrivateBatchExistingChildDirectory(
        leasesInventory,
        leasesDirectory,
        ".transaction-receipts",
        receiptDirectory,
        "Lease transaction receipt directory",
      );
      requirePrivateBatchExistingChildDirectory(
        leasesInventory,
        leasesDirectory,
        LEASE_STATE_QUARANTINE_DIRECTORY,
        stateArchiveDirectory,
        "Lease state quarantine directory",
      );
      for (const name of activeTransactionalLeaseNames) {
        const active = exactLeaseHistory.activeByLeaseName.get(name);
        const latest = latestTransactionalStateEventByLeaseName.get(name);
        const transaction = transactionByEventId.get(latest?.event.eventId);
        if (
          latest === undefined ||
          latest.index < active.acquisitionIndex ||
          transaction === undefined ||
          transaction.operation !== latest.operation ||
          transaction.phase !== "complete" ||
          !canonicalValuesEqual(transaction.event, latest.event) ||
          !validatedTransactionEventIds.has(latest.event.eventId)
        ) {
          issues.push(
            `Lease ${name} latest active state event is outside its exact retained validated receipt suffix.`,
          );
          continue;
        }
        try {
          const admission = admitCanonicalTransactionalLeaseState(
            paths,
            helper,
            leasesDirectory,
            leasesInventory,
            name,
          );
          if (
            admission === null ||
            !leaseStateMatches(admission.snapshot.descriptor, transaction.after)
          ) {
            if (admission !== null) closeSync(admission.directory.descriptor);
            throw new AutomationControlError(
              "lease_transaction_conflict",
              `Lease ${name} canonical authority does not match its latest active transaction after descriptor.`,
            );
          }
          canonicalLeaseAdmissions.set(name, admission);
        } catch (error) {
          issues.push(
            `Lease ${name} final transactional authority is invalid: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
    invokeCheckpoint("lease-history-before-final-revalidation", {
      retainedReceiptCount,
      pendingTransactionArtifactCount,
    });
    for (const admission of batchAdmissions) {
      try {
        requirePrivateBatchInventoryUnchanged(
          helper,
          admission.directory,
          admission.operation,
          admission.inventory,
          admission.expectedDirectoryNames,
        );
      } catch (error) {
        issues.push(
          `${admission.directory.label} changed after inspection: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    for (const [name, admission] of canonicalLeaseAdmissions) {
      try {
        requirePrivateBatchInventoryUnchanged(
          helper,
          admission.directory,
          "private-file-batch-read",
          admission.inventory,
        );
      } catch (error) {
        issues.push(
          `Lease ${name} canonical authority changed after inspection: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    for (const quarantine of quarantineBindings.values()) {
      assertPinnedLeaseArchiveDirectory(quarantine);
    }
  } catch (error) {
    issues.push(
      `lease transaction history is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    for (const admission of [...canonicalLeaseAdmissions.values()].reverse()) {
      closeSync(admission.directory.descriptor);
    }
    if (stateArchiveDirectory !== undefined) {
      closeSync(stateArchiveDirectory.descriptor);
    }
    for (const quarantine of [...quarantineBindings.values()].reverse()) {
      closeSync(quarantine.descriptor);
    }
    if (receiptDirectory !== undefined) closeSync(receiptDirectory.descriptor);
    if (transactionDirectory !== undefined) {
      closeSync(transactionDirectory.descriptor);
    }
    if (leasesDirectory !== undefined) closeSync(leasesDirectory.descriptor);
  }
  return Object.freeze({
    healthy: issues.length === 0,
    issues: Object.freeze(issues),
    retainedReceiptCount,
    pendingTransactionArtifactCount,
  });
}

function planLeaseReceiptPruning(receipts, currentReceiptEntry) {
  const eventIndices = receipts.map(({ eventIndex }) => eventIndex);
  if (
    eventIndices.some((eventIndex) => !Number.isSafeInteger(eventIndex)) ||
    new Set(eventIndices).size !== eventIndices.length
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease receipt pruning requires one unique physical event order per receipt.",
    );
  }
  return receipts
    .filter(({ entry }) => entry !== currentReceiptEntry)
    .sort(
      (left, right) =>
        right.eventIndex - left.eventIndex ||
        (right.entry < left.entry ? -1 : right.entry > left.entry ? 1 : 0),
    )
    .slice(LEASE_TRANSACTION_RECEIPT_RETENTION - 1);
}

export function conservativeLeaseCleanupArchiveReservation(
  stateRoot = undefined,
  { nowMs = Date.now() } = {},
) {
  requireOutsideAutomationPlanningReadCallback(
    "Lease cleanup archive reservation inspection",
  );
  if (!Number.isFinite(nowMs)) {
    throw new AutomationControlError(
      "lease_archive_capacity_invalid",
      "Lease archive reservation requires a finite clock.",
    );
  }
  const paths = automationControlPaths(stateRoot);
  const { receipts } = leaseTransactionDirectories(paths);
  const baseEntries = 8;
  const baseBytes = 8 * LEASE_TRANSACTION_MAX_BYTES;
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
  const eventSnapshot = readControlEventHistorySnapshot(paths.events);
  requireExactLeaseEventHistory(eventSnapshot.events);
  const eventOrderById = new Map(
    eventSnapshot.events.map((event, index) => [event?.eventId, index]),
  );
  const operationIdPattern =
    "(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";
  const receiptPattern = new RegExp(
    `^(.+)\\.(acquire|heartbeat|bind-head|release)\\.(${operationIdPattern})\\.json$`,
  );
  const groups = new Map();
  for (const entry of readBoundedLeaseDirectoryEntries(receipts, {
    maxEntries: LEASE_TRANSACTION_RECEIPT_DIRECTORY_MAX_ENTRIES,
    label: "Lease transaction receipt directory",
    errorCode: "lease_archive_capacity_invalid",
  })) {
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
    const transaction = parseLeaseTransactionBytes(snapshot.bytes, paths, name);
    requireCanonicalCompletedLeaseReceiptBytes(
      snapshot.bytes,
      transaction,
      `Lease transaction receipt ${entry}`,
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
    const eventIndex = eventOrderById.get(transaction.event.eventId);
    if (!Number.isSafeInteger(eventIndex)) {
      throw new AutomationControlError(
        "lease_archive_capacity_invalid",
        `Lease transaction receipt ${entry} has no exact physical event order.`,
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
      eventIndex,
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
  paths,
  filePath,
  transaction,
  checkpoint = undefined,
  kind = "WAL",
) {
  const predecessorPhases = {
    prepared: [],
    "state-committed": ["prepared"],
    "event-appended": ["state-committed"],
    complete: ["prepared", "state-committed", "event-appended"],
  }[transaction.phase];
  const predecessorBytes =
    kind === "receipt" || predecessorPhases === undefined
      ? null
      : predecessorPhases.map((phase) =>
          privateJsonBytes({
            ...transaction,
            phase,
            completedAt: null,
          }),
        );
  writePrivateBytesAtomic(paths, filePath, privateJsonBytes(transaction), {
    operationId: transaction.operationId,
    transaction,
    checkpoint,
    kind,
    predecessorBytes,
    retirementDirectory: leaseCleanupQuarantineDirectory(filePath),
  });
}

function reconcileActiveLeaseTransactionArtifacts(paths, files, transaction) {
  const canonicalPaths = new Set(
    [
      files.transaction,
      transaction.staging.beforePath,
      transaction.staging.afterPath,
    ].filter((filePath) => filePath !== null),
  );
  const { transactions } = leaseTransactionDirectories(paths);
  requireExactPrivateArchiveDirectory(
    transactions,
    "Lease transaction directory",
  );
  const transactionEntries = readBoundedLeaseDirectoryEntries(transactions, {
    maxEntries: LEASE_TRANSACTION_DIRECTORY_MAX_ENTRIES,
    label: "Lease transaction directory",
    errorCode: "lease_transaction_pending",
  }).sort();
  const walTemporaryPath = leaseAtomicTemporaryPath(
    files.transaction,
    transaction,
  );
  const allowedTransactionPaths = new Set(canonicalPaths);
  if (pathEntryExists(walTemporaryPath)) {
    allowedTransactionPaths.add(walTemporaryPath);
  }
  for (const entry of transactionEntries) {
    if (entry === LEASE_CLEANUP_QUARANTINE_DIRECTORY) {
      requireExactPrivateArchiveDirectory(
        path.join(transactions, entry),
        "Lease transaction cleanup archive directory",
      );
      continue;
    }
    const filePath = path.join(transactions, entry);
    if (allowedTransactionPaths.has(filePath)) continue;
    throw new AutomationControlError(
      "lease_transaction_pending",
      `Lease transaction entry ${entry} conflicts with active operation ${transaction.operationId}.`,
      { name: transaction.name, pendingEntry: entry },
    );
  }
  if (transaction.phase !== "complete") {
    validateLeaseStaging(paths, transaction);
  }
  const recordTemporaryPath = leaseAtomicTemporaryPath(
    leaseRecordPath(leasePathFor(paths, transaction.name)),
    transaction,
  );
  let recordTemporaryBytes = null;
  let recordAfterBytes = null;
  let recordBeforeBytes = null;
  if (pathEntryExists(recordTemporaryPath)) {
    if (
      transaction.phase !== "prepared" ||
      transaction.staging.afterPath === null
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease transaction for ${transaction.name} has an invalid canonical record temporary.`,
      );
    }
    recordAfterBytes = readPrivateBytes(
      transaction.staging.afterPath,
      "Lease after staging",
      { privateRoot: paths.controlRoot },
    );
    recordBeforeBytes =
      transaction.staging.beforePath === null
        ? null
        : readPrivateBytes(
            transaction.staging.beforePath,
            "Lease before staging",
            { privateRoot: paths.controlRoot },
          );
    recordTemporaryBytes = readPrivateBytes(
      recordTemporaryPath,
      "Lease canonical record temporary",
      {
        allowEmpty: true,
        privateRoot: paths.controlRoot,
        requireUtf8: false,
      },
    );
  }
  const leasePath = leasePathFor(paths, transaction.name);
  const current = readLeaseDirectorySnapshot(
    paths,
    transaction.name,
    leasePath,
    {
      allowedAdditionalEntries:
        recordTemporaryBytes === null
          ? []
          : [path.basename(recordTemporaryPath)],
    },
  );
  const matchesBefore = leaseStateMatches(
    current.descriptor,
    transaction.before,
  );
  const matchesAfter = leaseStateMatches(current.descriptor, transaction.after);
  const matchesAcquireDirectoryIntermediate =
    transaction.operation === "acquire" &&
    transaction.before.directoryExists === false &&
    current.descriptor.directoryExists === true &&
    current.descriptor.recordDigest === null;
  const matchedEvent = matchingLeaseEventUnlocked(paths, transaction).event;
  const removals = [];
  if (pathEntryExists(walTemporaryPath)) {
    const successorBytes = readPrivateBytes(
      walTemporaryPath,
      "Lease active WAL successor temporary",
      {
        allowEmpty: true,
        privateRoot: paths.controlRoot,
        requireUtf8: false,
      },
    );
    let successor = null;
    try {
      successor = parseLeaseTransactionBytes(
        successorBytes,
        paths,
        transaction.name,
      );
    } catch {
      successor = null;
    }
    const phaseSuccessor = {
      prepared: "state-committed",
      "state-committed": "event-appended",
      "event-appended": "complete",
    }[transaction.phase];
    const expectedSuccessor = structuredClone(transaction);
    expectedSuccessor.phase = phaseSuccessor;
    if (phaseSuccessor === "complete" && successor !== null) {
      expectedSuccessor.completedAt = successor.completedAt;
    }
    const physicalStateMatches =
      (transaction.phase === "prepared" &&
        matchesAfter &&
        matchedEvent === null) ||
      (transaction.phase === "state-committed" &&
        matchesAfter &&
        matchedEvent !== null) ||
      (transaction.phase === "event-appended" &&
        matchesAfter &&
        matchedEvent !== null);
    const exactSuccessor =
      phaseSuccessor !== undefined &&
      successor !== null &&
      physicalStateMatches &&
      canonicalValuesEqual(successor, expectedSuccessor) &&
      successorBytes.equals(privateJsonBytes(successor));
    const expectedSuccessorBytes =
      phaseSuccessor === undefined ||
      (phaseSuccessor === "complete" && successor === null)
        ? null
        : privateJsonBytes(expectedSuccessor);
    const predecessorPhases = {
      prepared: [],
      "state-committed": ["prepared"],
      "event-appended": ["state-committed"],
      complete: ["prepared", "state-committed", "event-appended"],
    }[transaction.phase];
    const exactExchangedPredecessor = predecessorPhases.some((phase) =>
      successorBytes.equals(
        privateJsonBytes({
          ...transaction,
          phase,
          completedAt: null,
        }),
      ),
    );
    const samePlanPartial =
      !exactSuccessor &&
      !exactExchangedPredecessor &&
      physicalStateMatches &&
      (expectedSuccessorBytes === null ||
        leaseBytesAreCanonicalPrefix(successorBytes, expectedSuccessorBytes));
    if (!exactSuccessor && !exactExchangedPredecessor && !samePlanPartial) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease transaction for ${transaction.name} has an invalid WAL exchange temporary.`,
      );
    }
    removals.push({
      filePath: walTemporaryPath,
      bytes: successorBytes,
      allowPartial: samePlanPartial,
      kind: exactExchangedPredecessor
        ? "WAL"
        : transaction.phase === "event-appended"
          ? leaseAtomicCompletionResidueKind("WAL")
          : leaseAtomicSuccessorKind("WAL"),
      retirementDirectory: leaseCleanupQuarantineDirectory(files.transaction),
    });
  }
  for (const stagingPath of [
    transaction.staging.beforePath,
    transaction.staging.afterPath,
  ]) {
    if (
      stagingPath !== null &&
      pathEntryExists(leaseAtomicTemporaryPath(stagingPath, transaction))
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease transaction for ${transaction.name} retained staging temporary material after WAL publication.`,
      );
    }
  }
  if (recordTemporaryBytes !== null) {
    const exactPreExchange =
      recordTemporaryBytes.equals(recordAfterBytes) &&
      (matchesBefore || matchesAcquireDirectoryIntermediate) &&
      matchedEvent === null;
    const exactPostExchange =
      recordBeforeBytes !== null &&
      recordTemporaryBytes.equals(recordBeforeBytes) &&
      matchesAfter;
    const samePlanPartial =
      !exactPreExchange &&
      !exactPostExchange &&
      (matchesBefore || matchesAcquireDirectoryIntermediate) &&
      matchedEvent === null &&
      leaseBytesAreCanonicalPrefix(recordTemporaryBytes, recordAfterBytes);
    if (!exactPreExchange && !exactPostExchange && !samePlanPartial) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease transaction for ${transaction.name} has an invalid canonical record exchange temporary.`,
      );
    }
    removals.push({
      filePath: recordTemporaryPath,
      bytes: recordTemporaryBytes,
      allowPartial: samePlanPartial,
      kind: exactPostExchange
        ? "canonical lease record"
        : leaseAtomicSuccessorKind("canonical lease record"),
      retirementDirectory: leaseCleanupQuarantineDirectory(
        transaction.staging.afterPath ?? transaction.staging.beforePath,
      ),
    });
  }
  const receiptTemporaryPath = leaseAtomicTemporaryPath(
    files.receipt,
    transaction,
  );
  if (pathEntryExists(receiptTemporaryPath)) {
    const expectedBytes = privateJsonBytes(transaction);
    const currentBytes = readPrivateBytes(
      receiptTemporaryPath,
      "Lease receipt temporary",
      {
        allowEmpty: true,
        privateRoot: paths.controlRoot,
        requireUtf8: false,
      },
    );
    const exactReceipt = currentBytes.equals(expectedBytes);
    const canonicalReceiptPrefix = leaseBytesAreCanonicalPrefix(
      currentBytes,
      expectedBytes,
    );
    if (
      transaction.phase !== "complete" ||
      pathEntryExists(files.receipt) ||
      (!exactReceipt && !canonicalReceiptPrefix)
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease transaction for ${transaction.name} has an invalid receipt temporary.`,
      );
    }
    removals.push({
      filePath: receiptTemporaryPath,
      bytes: currentBytes,
      allowPartial: !exactReceipt,
      kind: leaseAtomicSuccessorKind("receipt"),
      retirementDirectory: leaseCleanupQuarantineDirectory(files.receipt),
    });
  }
  if (
    readBoundedLeaseDirectoryEntries(transactions, {
      maxEntries: LEASE_TRANSACTION_DIRECTORY_MAX_ENTRIES,
      label: "Lease transaction directory",
      errorCode: "lease_transaction_conflict",
    })
      .sort()
      .join("\0") !== transactionEntries.join("\0")
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease transaction directory changed during recovery planning for ${transaction.name}.`,
    );
  }
  for (const removal of removals) {
    removeLeaseAtomicTemporaryFile(paths, removal.filePath, removal.bytes, {
      operationId: transaction.operationId,
      kind: removal.kind,
      retirementDirectory: removal.retirementDirectory,
      allowPartial: removal.allowPartial === true,
    });
  }
  if (transaction.phase === "complete") {
    validateCompletedLeaseReceiptStaging(paths, transaction);
  }
}

function matchingLeaseEventUnlocked(paths, transaction) {
  const snapshot = readControlEventHistorySnapshot(paths.events);
  requireExactLeaseEventHistory(snapshot.events);
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
    requireExactLeaseEventHistory(snapshot.events);
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

function requireNoPrunedLeaseOperationEvent(paths, operationId, eventsGuard) {
  requireActiveLeaseEventsGuard(eventsGuard);
  const eventId = `lease:${operationId}`;
  const snapshot = readControlEventHistorySnapshot(paths.events);
  requireExactLeaseEventHistory(snapshot.events);
  const matches = snapshot.events.filter((event) => event?.eventId === eventId);
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
  const request = transaction.request;
  const tokenRecords =
    transaction.operation === "acquire"
      ? [afterRecord]
      : transaction.operation === "release"
        ? [beforeRecord]
        : [beforeRecord, afterRecord];
  if (
    tokenRecords.some(
      (record) =>
        record === null ||
        secretDigest(record.token) !== transaction.tokenDigest,
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
      transaction.before.directoryExists &&
      transaction.before.recordDigest === null
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease acquisition transaction for ${transaction.name} staged a recordless predecessor.`,
      );
    }
    let expectedTakeover = null;
    let expectedCredentialUpgrade = false;
    if (transaction.before.directoryExists) {
      if (
        isLegacyUncredentialedLeaseRecord(beforeRecord) &&
        beforeRecord.owner !== "freed-owner"
      ) {
        expectedTakeover = {
          owner: beforeRecord.owner,
          expiredAt: beforeRecord.expiresAt,
          heartbeatAt: beforeRecord.heartbeatAt,
          legacyUncredentialed: true,
        };
        expectedCredentialUpgrade = true;
        if (
          !isLeaseExpired(beforeRecord, Date.parse(transaction.preparedAt)) ||
          beforeRecord.token === afterRecord?.token
        ) {
          throw new AutomationControlError(
            "lease_transaction_conflict",
            `Lease acquisition transaction for ${transaction.name} staged an invalid legacy credential upgrade.`,
          );
        }
      } else {
        expectedTakeover = {
          owner: beforeRecord.owner,
          expiredAt: beforeRecord.expiresAt,
          heartbeatAt: beforeRecord.heartbeatAt,
        };
        if (!isLeaseExpired(beforeRecord, Date.parse(transaction.preparedAt))) {
          throw new AutomationControlError(
            "lease_transaction_conflict",
            `Lease acquisition transaction for ${transaction.name} staged a takeover of live authority.`,
          );
        }
      }
    }
    if (
      afterRecord === null ||
      !canonicalValuesEqual(publicLease(afterRecord), receiptLease) ||
      afterRecord.acquiredAt !== transaction.preparedAt ||
      afterRecord.heartbeatAt !== transaction.preparedAt ||
      Date.parse(afterRecord.expiresAt) !==
        Date.parse(transaction.preparedAt) + request.ttlMs ||
      !canonicalValuesEqual(transaction.takeover, expectedTakeover) ||
      transaction.resultReceipt.takeover !== (expectedTakeover !== null) ||
      transaction.resultReceipt.credentialUpgrade !==
        expectedCredentialUpgrade ||
      (expectedTakeover === null
        ? Object.hasOwn(transaction.resultReceipt, "previous")
        : !canonicalValuesEqual(
            transaction.resultReceipt.previous,
            expectedTakeover,
          )) ||
      (expectedCredentialUpgrade && beforeRecord.owner !== afterRecord.owner)
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease acquisition transaction for ${transaction.name} has inconsistent staged state.`,
      );
    }
  } else if (transaction.operation === "heartbeat") {
    const effectiveTtlMs = request.ttlMs ?? beforeRecord.ttlMs;
    const maxLeaseLifetimeMs = actorLeaseMaxLifetimeMs(beforeRecord.owner);
    const requestedExpiryMs =
      Date.parse(transaction.preparedAt) + effectiveTtlMs;
    const absoluteExpiryMs =
      maxLeaseLifetimeMs === null
        ? Number.POSITIVE_INFINITY
        : Date.parse(beforeRecord.acquiredAt) + maxLeaseLifetimeMs;
    const expectedExpiryMs = Math.min(requestedExpiryMs, absoluteExpiryMs);
    const confirmationExpiryMs =
      beforeRecord.credentialKind === "owner-confirmation"
        ? Date.parse(beforeRecord.ownerConfirmationExpiresAt)
        : Number.POSITIVE_INFINITY;
    if (
      !canonicalValuesEqual(publicLease(afterRecord), receiptLease) ||
      afterRecord.heartbeatAt !== transaction.preparedAt ||
      (request.ttlMs === null
        ? afterRecord.ttlMs !== beforeRecord.ttlMs
        : afterRecord.ttlMs !== request.ttlMs) ||
      Date.parse(afterRecord.expiresAt) !== expectedExpiryMs ||
      expectedExpiryMs > confirmationExpiryMs ||
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
    const bound = transaction.resultReceipt.bound;
    const expectedScope = { ...request.scope, headSha: request.headSha };
    const commonStateInvalid =
      !canonicalValuesEqual(publicLease(afterRecord), receiptLease) ||
      !/^[0-9a-f]{40}$/.test(String(afterRecord.scope?.headSha ?? "")) ||
      !canonicalValuesEqual(afterRecord.scope, expectedScope) ||
      !canonicalValuesEqual(
        { ...beforeRecord.scope, headSha: null },
        request.scope,
      );
    const transitionValid = bound
      ? canonicalValuesEqual(
          leaseRecordWithoutFields(beforeRecord, ["scope"]),
          leaseRecordWithoutFields(afterRecord, ["scope"]),
        ) && beforeRecord.scope?.headSha === null
      : canonicalValuesEqual(beforeRecord, afterRecord);
    if (commonStateInvalid || !transitionValid) {
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
  const recordTemporaryPath = leaseAtomicTemporaryPath(recordPath, transaction);
  if (pathEntryExists(recordTemporaryPath)) {
    if (transaction.staging.afterPath === null) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${transaction.name} has a canonical record temporary without after state.`,
      );
    }
    const proposedBytes = readPrivateBytes(
      transaction.staging.afterPath,
      "Lease after staging",
      { privateRoot: paths.controlRoot },
    );
    const temporary = readLeaseAtomicSnapshot(
      paths,
      recordTemporaryPath,
      "Lease canonical record temporary",
    );
    const canonicalBytes = pathEntryExists(recordPath)
      ? readPrivateBytes(recordPath, "Lease canonical record", {
          privateRoot: paths.controlRoot,
        })
      : null;
    const beforeBytes =
      transaction.staging.beforePath === null
        ? null
        : readPrivateBytes(
            transaction.staging.beforePath,
            "Lease before staging",
            { privateRoot: paths.controlRoot },
          );
    const preExchange =
      temporary.bytes.equals(proposedBytes) &&
      ((canonicalBytes === null && beforeBytes === null) ||
        (canonicalBytes !== null &&
          beforeBytes !== null &&
          canonicalBytes.equals(beforeBytes)));
    const postExchange =
      canonicalBytes !== null &&
      canonicalBytes.equals(proposedBytes) &&
      beforeBytes !== null &&
      temporary.bytes.equals(beforeBytes);
    if (!preExchange && !postExchange) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${transaction.name} has an inexact canonical record exchange intermediate.`,
      );
    }
    retireLeaseAtomicGeneration(paths, recordTemporaryPath, temporary, {
      operationId: transaction.operationId,
      kind: "canonical lease record",
      retirementDirectory: leaseCleanupQuarantineDirectory(
        transaction.staging.afterPath,
      ),
    });
  }
  if (transaction.operation === "release") {
    const retired = readRetiredLeaseStateDirectory(
      paths,
      transaction,
      "release",
    );
    if (retired !== null) {
      if (
        pathEntryExists(leasePath) ||
        !leaseStateMatches(retired.snapshot.descriptor, transaction.before)
      ) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease ${transaction.name} release retirement changed generation.`,
        );
      }
      syncDirectory(leaseStateQuarantineDirectory(paths));
      syncDirectory(paths.leases);
    } else if (!pathEntryExists(leasePath)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${transaction.name} disappeared without its release retirement archive.`,
      );
    }
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
      writePrivateBytesAtomic(paths, recordPath, bytes, {
        operationId: transaction.operationId,
        transaction,
        kind: "canonical lease record",
        predecessorBytes: null,
        retirementDirectory: leaseCleanupQuarantineDirectory(
          transaction.staging.afterPath,
        ),
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

function readRetiredLeaseStateDirectory(paths, transaction, purpose) {
  const archiveDirectory = leaseStateQuarantineDirectory(paths);
  requireExactPrivateArchiveDirectory(
    archiveDirectory,
    "Lease state quarantine directory",
  );
  const namespace = leaseStateRetirementNamespace(transaction, purpose);
  const entries = readBoundedLeaseDirectoryEntries(archiveDirectory, {
    maxEntries: LEASE_ARCHIVE_MAX_ENTRIES,
    maxEncodedBytes: LEASE_BOUNDED_DIRECTORY_MAX_BYTES,
    label: "Lease state quarantine directory",
    errorCode: "lease_archive_capacity_invalid",
  }).filter((entry) => entry.startsWith(`${namespace}.`));
  if (entries.length === 0) return null;
  if (
    entries.length !== 1 ||
    !new RegExp(`^${namespace}\\.[0-9a-f]{64}\\.lease$`).test(entries[0])
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease ${transaction.name} has an inexact retired state directory set.`,
    );
  }
  const archivePath = path.join(archiveDirectory, entries[0]);
  const binding = openPinnedLeaseArchiveDirectory(
    archivePath,
    `Retired lease state directory ${transaction.name}`,
  );
  try {
    const snapshot = readLeaseDirectorySnapshot(
      paths,
      transaction.name,
      archivePath,
    );
    assertPinnedLeaseArchiveDirectory(binding);
    const expectedDigest = leaseStateDirectoryGenerationDigest(
      paths,
      transaction,
      purpose,
      binding.identity,
      snapshot.descriptor,
    );
    if (entries[0] !== `${namespace}.${expectedDigest}.lease`) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${transaction.name} retired state directory changed generation.`,
      );
    }
    return Object.freeze({ archivePath, snapshot });
  } finally {
    closeSync(binding.descriptor);
  }
}

function requireReleaseLeaseStateRetirement(
  paths,
  transaction,
  {
    admittedStateArchives = undefined,
    eventHistory = undefined,
    transactionByEventId = undefined,
    validatedTransactionEventIds = undefined,
    retiredEvidenceOnly = false,
  } = {},
) {
  if (transaction.operation !== "release") return null;
  const retired =
    admittedStateArchives === undefined
      ? readRetiredLeaseStateDirectory(paths, transaction, "release")
      : (admittedStateArchives.get(transaction.operationId) ?? null);
  if (
    retired === null ||
    !leaseStateMatches(retired.snapshot.descriptor, transaction.before)
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease ${transaction.name} release is missing its exact retired authority directory.`,
    );
  }
  if (retiredEvidenceOnly) return retired;

  const snapshot =
    eventHistory === undefined
      ? readControlEventHistorySnapshot(paths.events)
      : { events: eventHistory };
  const inspection = requireExactLeaseEventHistory(snapshot.events);
  const releaseMatches = snapshot.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event?.eventId === transaction.event.eventId);
  const active = inspection.activeByLeaseName.get(transaction.name);
  const canonicalExists = pathEntryExists(
    leasePathFor(paths, transaction.name),
  );
  if (releaseMatches.length !== 1) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease ${transaction.name} release does not have one exact event-history position.`,
    );
  }
  if (active === undefined) {
    if (canonicalExists) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${transaction.name} canonical authority survived its final retained release.`,
      );
    }
    return retired;
  }
  if (active.acquisitionIndex <= releaseMatches[0].index || !canonicalExists) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease ${transaction.name} canonical authority is not one exact generation acquired after its retained release.`,
    );
  }

  let latest = null;
  for (const [index, event] of snapshot.events.entries()) {
    if (
      index < active.acquisitionIndex ||
      event?.leaseName !== transaction.name
    ) {
      continue;
    }
    const operation = leaseTransactionOperationForEventType(event.type);
    if (operation === null || operation === "release") continue;
    if (
      typeof event.eventId === "string" &&
      event.eventId.startsWith("lease:")
    ) {
      latest = { event, operation };
    }
  }
  const current = readLeaseStateSnapshot(paths, transaction.name);
  if (current.record === null || current.descriptor.directoryExists !== true) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease ${transaction.name} canonical authority has no exact live record.`,
    );
  }
  validateLeaseRecord(current.record, transaction.name);
  if (
    latest === null &&
    pinnedLegacyLeaseControlEvent(active.acquisitionEvent)
  ) {
    return retired;
  }
  let laterTransaction = transactionByEventId?.get(latest?.event.eventId);
  let laterReceiptBinding;
  if (laterTransaction === undefined && transactionByEventId === undefined) {
    const operationId = requireLeaseOperationId(
      latest.event.eventId.slice("lease:".length),
    );
    const completed = readCompletedLeaseReceipt(
      paths,
      transaction.name,
      latest.operation,
      operationId,
    );
    if (completed !== null) {
      laterTransaction = completed.transaction;
      laterReceiptBinding = completed.binding;
    }
  }
  try {
    if (
      laterTransaction === undefined ||
      laterTransaction.operation !== latest?.operation ||
      laterTransaction.phase !== "complete" ||
      !canonicalValuesEqual(laterTransaction.event, latest?.event) ||
      !leaseStateMatches(current.descriptor, laterTransaction.after)
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${transaction.name} current authority is not bound to its exact latest active transaction receipt.`,
      );
    }
    if (
      validatedTransactionEventIds === undefined ||
      !validatedTransactionEventIds.has(laterTransaction.event.eventId)
    ) {
      validateCompletedLeaseReceiptStaging(paths, laterTransaction);
    }
  } finally {
    if (laterReceiptBinding !== undefined) {
      closeSync(laterReceiptBinding.descriptor);
    }
  }
  return retired;
}

function snapshotLeaseDirectoryTree(helper, parent, source, sourceSnapshot) {
  const maxEntries = 4;
  const maxDepth = 1;
  const maxAggregateBytes = LEASE_TRANSACTION_MAX_BYTES;
  assertPinnedLeaseArchiveDirectory(parent);
  assertPinnedLeaseArchiveDirectory(source);
  const result = runLeaseArchiveHelper(
    helper,
    "snapshot-tree",
    [
      path.basename(source.path),
      "0",
      LEASE_TRANSACTION_MAX_BYTES.toString(),
      maxEntries.toString(),
      maxDepth.toString(),
      maxAggregateBytes.toString(),
      (2 * LEASE_TRANSACTION_MAX_BYTES).toString(),
      parent.identity.dev.toString(),
      parent.identity.ino.toString(),
      Number(parent.identity.mode & 0o7777n).toString(),
    ],
    [parent.descriptor],
  );
  assertPinnedLeaseArchiveDirectory(parent);
  assertPinnedLeaseArchiveDirectory(source);
  let receipt;
  try {
    receipt = JSON.parse(result.toString("utf8"));
  } catch {
    receipt = null;
  }
  const expectedKeys = [
    "aggregateBytes",
    "entry",
    "entryCount",
    "operation",
    "parentDevice",
    "parentInode",
    "parentMode",
    "protocol",
    "treeDigest",
  ].sort();
  const entry = receipt?.entry;
  const children = entry?.entries;
  const expectedChildCount =
    sourceSnapshot.descriptor.recordDigest === null ? 0 : 1;
  const child = expectedChildCount === 1 ? children?.[0] : null;
  const rootShape =
    Object.keys(entry ?? {})
      .sort()
      .join("\n") === ["entries", "kind", "mode", "name"].sort().join("\n") &&
    entry.name === path.basename(source.path) &&
    entry.kind === "directory" &&
    entry.mode === 0o700 &&
    Array.isArray(children) &&
    children.length === expectedChildCount;
  const childShape =
    expectedChildCount === 0 ||
    (Object.keys(child ?? {})
      .sort()
      .join("\n") ===
      ["digest", "kind", "mode", "name", "size"].sort().join("\n") &&
      child.name === "lease.json" &&
      child.kind === "file" &&
      child.mode === 0o600 &&
      child.size === sourceSnapshot.descriptor.recordSize &&
      child.digest === sourceSnapshot.descriptor.recordDigest);
  const digestValue =
    rootShape && childShape
      ? {
          kind: "directory",
          mode: entry.mode,
          entries:
            expectedChildCount === 0
              ? []
              : [
                  {
                    kind: "file",
                    mode: child.mode,
                    name: child.name,
                    size: child.size,
                    digest: child.digest,
                  },
                ],
        }
      : null;
  const expectedTreeDigest =
    digestValue === null
      ? null
      : digestBytes(
          Buffer.from(
            `${JSON.stringify(canonicalIntentValue(digestValue))}\n`,
            "utf8",
          ),
        );
  if (
    Object.keys(receipt ?? {})
      .sort()
      .join("\n") !== expectedKeys.join("\n") ||
    receipt.protocol !== LEASE_ARCHIVE_MOVE_PROTOCOL ||
    receipt.operation !== "snapshot-tree" ||
    receipt.parentDevice !== parent.identity.dev.toString() ||
    receipt.parentInode !== parent.identity.ino.toString() ||
    receipt.parentMode !== Number(parent.identity.mode & 0o7777n).toString() ||
    receipt.entryCount !== String(1 + expectedChildCount) ||
    receipt.aggregateBytes !== String(sourceSnapshot.descriptor.recordSize) ||
    expectedTreeDigest === null ||
    receipt.treeDigest !== expectedTreeDigest
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease directory snapshot returned an inexact descriptor-bound tree receipt.",
    );
  }
  return receipt.treeDigest;
}

function retireLeaseDirectoryDurable(
  paths,
  transaction,
  purpose,
  expectedDescriptor,
  checkpoint = undefined,
) {
  const leasePath = leasePathFor(paths, transaction.name);
  const existing = readRetiredLeaseStateDirectory(paths, transaction, purpose);
  if (existing !== null) {
    if (pathEntryExists(leasePath)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${transaction.name} exists at both canonical and retired state paths.`,
      );
    }
    if (!leaseStateMatches(existing.snapshot.descriptor, expectedDescriptor)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${transaction.name} retired state does not match its transaction.`,
      );
    }
    return existing.archivePath;
  }
  if (!pathEntryExists(leasePath)) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease ${transaction.name} disappeared without an exact retired state directory.`,
    );
  }
  const sourceSnapshot = readLeaseDirectorySnapshot(
    paths,
    transaction.name,
    leasePath,
  );
  if (!leaseStateMatches(sourceSnapshot.descriptor, expectedDescriptor)) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease ${transaction.name} changed before state retirement.`,
    );
  }
  const helper = openPinnedLeaseArchiveHelper();
  const sourceParent = openPinnedLeaseArchiveDirectory(
    paths.leases,
    "Lease state parent directory",
  );
  const destinationParent = openPinnedLeaseArchiveDirectory(
    leaseStateQuarantineDirectory(paths),
    "Lease state quarantine directory",
  );
  const source = openPinnedLeaseArchiveDirectory(
    leasePath,
    "Canonical lease directory",
  );
  const generationDigest = leaseStateDirectoryGenerationDigest(
    paths,
    transaction,
    purpose,
    source.identity,
    sourceSnapshot.descriptor,
  );
  const archivePath = path.join(
    destinationParent.path,
    `${leaseStateRetirementNamespace(transaction, purpose)}.${generationDigest}.lease`,
  );
  requireLeaseCleanupArchiveCapacity(paths, {
    entries: 1,
    bytes: sourceSnapshot.bytes?.length ?? 0,
    oldestMtimeMs: Number(lstatSync(leasePath, { bigint: true }).mtimeMs),
  });
  try {
    const treeDigest = snapshotLeaseDirectoryTree(
      helper,
      sourceParent,
      source,
      sourceSnapshot,
    );
    invokeLeaseTransactionCheckpoint(
      checkpoint,
      "lease-state-before-directory-retirement",
      { leasePath, archivePath, purpose },
    );
    let result;
    try {
      result = runLeaseArchiveHelper(
        helper,
        "retire-directory-durable",
        [
          path.basename(leasePath),
          path.basename(archivePath),
          source.identity.dev.toString(),
          source.identity.ino.toString(),
          Number(source.identity.mode & 0o7777n).toString(),
          source.identity.uid.toString(),
          ...pinnedDirectoryArguments(sourceParent),
          ...pinnedDirectoryArguments(destinationParent),
          treeDigest,
          LEASE_TRANSACTION_MAX_BYTES.toString(),
          "4",
          "1",
          LEASE_TRANSACTION_MAX_BYTES.toString(),
        ],
        [
          sourceParent.descriptor,
          destinationParent.descriptor,
          source.descriptor,
        ],
      );
    } catch (error) {
      if (pathEntryExists(leasePath) || !pathEntryExists(archivePath)) {
        throw error;
      }
      result = null;
    }
    let receipt;
    if (result !== null) {
      try {
        receipt = JSON.parse(result.toString("utf8"));
      } catch {
        receipt = null;
      }
    }
    if (
      result !== null &&
      (Object.keys(receipt ?? {})
        .sort()
        .join("\n") !==
        ["device", "inode", "mode", "protocol", "treeDigest", "uid"].join(
          "\n",
        ) ||
        receipt.protocol !== LEASE_ARCHIVE_MOVE_PROTOCOL ||
        receipt.device !== source.identity.dev.toString() ||
        receipt.inode !== source.identity.ino.toString() ||
        receipt.mode !== Number(source.identity.mode & 0o7777n).toString() ||
        receipt.uid !== source.identity.uid.toString() ||
        receipt.treeDigest !== treeDigest)
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        "Lease directory retirement returned an inexact generation receipt.",
      );
    }
    invokeLeaseTransactionCheckpoint(
      checkpoint,
      "lease-state-directory-retired",
      { leasePath, archivePath, purpose },
    );
    const retired = readRetiredLeaseStateDirectory(paths, transaction, purpose);
    if (
      retired === null ||
      retired.archivePath !== archivePath ||
      !leaseStateMatches(retired.snapshot.descriptor, expectedDescriptor)
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${transaction.name} state retirement did not preserve its exact generation.`,
      );
    }
    return archivePath;
  } finally {
    closeSync(source.descriptor);
    closeSync(destinationParent.descriptor);
    closeSync(sourceParent.descriptor);
  }
}

function replaceLeaseStateFromTransaction(
  paths,
  transaction,
  side,
  checkpoint = undefined,
  beforeRecordPublish = () => {},
) {
  const descriptor = transaction[side];
  const leasePath = leasePathFor(paths, transaction.name);
  if (!descriptor.directoryExists) {
    const archivePath = retireLeaseDirectoryDurable(
      paths,
      transaction,
      "release",
      transaction.before,
      checkpoint,
    );
    invokeLeaseTransactionCheckpoint(
      checkpoint,
      "lease-state-removal-renamed",
      { leasePath, archivePath },
    );
    syncDirectory(leaseStateQuarantineDirectory(paths));
    syncDirectory(paths.leases);
    invokeLeaseTransactionCheckpoint(
      checkpoint,
      "lease-state-removal-parent-synced",
      { leasePath, archivePath },
    );
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
    if (pathEntryExists(recordPath)) {
      const current = readLeaseAtomicSnapshot(
        paths,
        recordPath,
        "Lease canonical record rollback predecessor",
      );
      retireLeaseAtomicGeneration(paths, recordPath, current, {
        operationId: transaction.operationId,
        kind: "canonical lease record rollback",
        retirementDirectory: leaseCleanupQuarantineDirectory(
          transaction.staging.afterPath ?? transaction.staging.beforePath,
        ),
        checkpoint,
      });
    }
    syncDirectory(leasePath);
    return;
  }
  const bytes = readPrivateBytes(
    transaction.staging[`${side}Path`],
    `Lease ${side} staging`,
  );
  const predecessorPath =
    side === "after"
      ? transaction.staging.beforePath
      : transaction.staging.afterPath;
  const predecessorBytes =
    predecessorPath === null
      ? null
      : readPrivateBytes(
          predecessorPath,
          "Lease canonical predecessor staging",
          {
            privateRoot: paths.controlRoot,
          },
        );
  writePrivateBytesAtomic(paths, recordPath, bytes, {
    operationId: transaction.operationId,
    transaction,
    checkpoint,
    kind: "canonical lease record",
    beforePublish: beforeRecordPublish,
    predecessorBytes,
    retirementDirectory: leaseCleanupQuarantineDirectory(
      transaction.staging.afterPath ?? transaction.staging.beforePath,
    ),
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

function moveLeaseCredentialDurable(descriptor, sourcePath, destinationPath) {
  const helper = openPinnedLeaseArchiveHelper();
  const sourceDirectory = openPinnedLeaseArchiveDirectory(
    path.dirname(sourcePath),
    "Lease credential source directory",
  );
  const destinationDirectory = openPinnedLeaseArchiveDirectory(
    path.dirname(destinationPath),
    "Lease credential destination directory",
  );
  const sourceSnapshot = readPrivateBytes(
    sourcePath,
    "Lease credential move source",
    { includeMetadata: true },
  );
  if (
    sourceSnapshot.bytes.length !== descriptor.size ||
    digestBytes(sourceSnapshot.bytes) !== descriptor.digest ||
    sourceSnapshot.identity.dev !== descriptor.sourceDevice ||
    sourceSnapshot.identity.ino !== descriptor.sourceInode
  ) {
    closeSync(destinationDirectory.descriptor);
    closeSync(sourceDirectory.descriptor);
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease credential move source changed after admission.",
    );
  }
  const source = openPinnedLeaseArchiveFile(
    sourcePath,
    sourceSnapshot,
    "Lease credential move source",
  );
  try {
    const result = runLeaseArchiveHelper(
      helper,
      "rename-durable",
      [
        path.basename(sourcePath),
        path.basename(destinationPath),
        source.identity.dev.toString(),
        source.identity.ino.toString(),
        Number(source.identity.mode & 0o7777n).toString(),
        source.identity.nlink.toString(),
        source.identity.size.toString(),
        digestBytes(sourceSnapshot.bytes),
        ...pinnedDirectoryArguments(sourceDirectory),
        ...pinnedDirectoryArguments(destinationDirectory),
      ],
      [
        sourceDirectory.descriptor,
        destinationDirectory.descriptor,
        source.descriptor,
      ],
    );
    let receipt;
    try {
      receipt = JSON.parse(result.toString("utf8"));
    } catch {
      receipt = null;
    }
    if (
      Object.keys(receipt ?? {})
        .sort()
        .join("\n") !==
        ["device", "digest", "inode", "protocol", "size"].join("\n") ||
      receipt.protocol !== LEASE_ARCHIVE_MOVE_PROTOCOL ||
      receipt.device !== source.identity.dev.toString() ||
      receipt.inode !== source.identity.ino.toString() ||
      receipt.size !== source.identity.size.toString() ||
      receipt.digest !== digestBytes(sourceSnapshot.bytes)
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        "Lease credential retirement returned an inexact generation receipt.",
      );
    }
  } finally {
    closeSync(source.descriptor);
    closeSync(destinationDirectory.descriptor);
    closeSync(sourceDirectory.descriptor);
  }
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
  if (
    !sourceExists ||
    !credentialBytesMatch(descriptor.sourcePath, descriptor)
  ) {
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
  moveLeaseCredentialDurable(
    descriptor,
    descriptor.sourcePath,
    descriptor.consumedPath,
  );
  invokeLeaseTransactionCheckpoint(checkpoint, "lease-credential-renamed", {
    sourcePath: descriptor.sourcePath,
    consumedPath: descriptor.consumedPath,
  });
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
  const committed =
    !pathEntryExists(descriptor.sourcePath) &&
    credentialBytesMatch(descriptor.consumedPath, descriptor);
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
    moveLeaseCredentialDurable(
      descriptor,
      descriptor.consumedPath,
      descriptor.sourcePath,
    );
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
  const causes = [];
  const stderr = String(result?.stderr ?? "").trim();
  if (stderr !== "") causes.push(stderr);
  if (result?.error !== undefined) {
    const errorCode = String(result.error.code ?? "").trim();
    const errorMessage = String(result.error.message ?? result.error).trim();
    causes.push(
      [errorCode, errorMessage].filter((value) => value !== "").join(": "),
    );
  }
  const signal = String(result?.signal ?? "").trim();
  if (signal !== "") causes.push(`signal ${signal}`);
  const cause = causes.filter((value) => value !== "").join("; ");
  return new AutomationControlError(
    "lease_transaction_conflict",
    message,
    cause === "" ? undefined : { cause: cause.slice(0, 1_024) },
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

export function framePinnedLeaseArchiveHelperInvocation(
  source,
  operation,
  args = [],
  { expectedDigest = LEASE_ARCHIVE_MOVE_HELPER_SHA256, input = undefined } = {},
) {
  const sourceBytes = Buffer.from(source, "utf8");
  const sourceDigest = createHash("sha256").update(sourceBytes).digest("hex");
  if (
    sourceBytes.length <= 0 ||
    sourceBytes.length > LEASE_ARCHIVE_HELPER_MAX_BYTES ||
    sourceDigest !== expectedDigest
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      "Lease archive helper source frame does not match its pinned digest.",
    );
  }
  const operationInput =
    input === undefined ? Buffer.alloc(0) : Buffer.from(input);
  return Object.freeze({
    argv: Object.freeze([
      "-E",
      "-I",
      "-S",
      "-c",
      LEASE_ARCHIVE_MOVE_PYTHON_BOOTSTRAP,
      String(sourceBytes.length),
      sourceDigest,
      String(operation),
      ...args.map(String),
    ]),
    input: Buffer.concat([sourceBytes, operationInput]),
  });
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
  input = undefined,
  testPause = undefined,
) {
  const pauseDescriptors =
    testPause === undefined
      ? []
      : [testPause.releaseDescriptor, testPause.signalDescriptor];
  if (
    testPause !== undefined &&
    (typeof testPause.checkpoint !== "string" ||
      testPause.checkpoint.length === 0 ||
      typeof testPause.operation !== "string" ||
      testPause.operation.length === 0 ||
      !pauseDescriptors.every(
        (descriptor) => Number.isSafeInteger(descriptor) && descriptor >= 0,
      ))
  ) {
    throw new AutomationControlError(
      "invalid_argument",
      "Authority helper test pause is invalid.",
    );
  }
  const pauseReleaseChildDescriptor = 3 + inheritedDescriptors.length;
  const pauseSignalChildDescriptor = pauseReleaseChildDescriptor + 1;
  const framed = framePinnedLeaseArchiveHelperInvocation(
    helper.source,
    operation,
    args,
    { input },
  );
  leaseArchiveHelperInvocationCountForTest += 1;
  const result = spawnSync(helper.pythonRuntime, framed.argv, {
    env: {
      HOME: os.homedir(),
      LANG: "C",
      LC_ALL: "C",
      PATH: "/usr/bin:/bin",
      ...(testPause === undefined
        ? {}
        : {
            FREED_REPAIR_MOVE_TEST_PAUSE: testPause.checkpoint,
            FREED_REPAIR_MOVE_TEST_OPERATION: testPause.operation,
            ...(testPause.source
              ? { FREED_REPAIR_MOVE_TEST_SOURCE: testPause.source }
              : {}),
            ...(testPause.destination
              ? {
                  FREED_REPAIR_MOVE_TEST_DESTINATION: testPause.destination,
                }
              : {}),
            FREED_REPAIR_MOVE_TEST_CONTROL_FDS: `${pauseReleaseChildDescriptor},${pauseSignalChildDescriptor}`,
          }),
    },
    maxBuffer:
      operation === "authority-retirement-inventory"
        ? AUTHORITY_RETIREMENT_INVENTORY_MAX_RECEIPT_BYTES
        : [
              "private-file-batch-read",
              "private-file-batch-read-allow-empty",
              "private-lease-state-batch-read",
            ].includes(operation)
          ? LEASE_PRIVATE_BATCH_MAX_BUFFER
          : operation === "list" || operation === "list-bounded"
            ? LEASE_ARCHIVE_LIST_MAX_BUFFER
            : 2 * LEASE_TRANSACTION_MAX_BYTES,
    stdio: [
      "pipe",
      "pipe",
      "pipe",
      ...inheritedDescriptors,
      ...pauseDescriptors,
    ],
    input: framed.input,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw leaseArchiveHelperError(
      `Lease archive helper ${operation} failed.`,
      result,
    );
  }
  return Buffer.from(result.stdout ?? Buffer.alloc(0));
}

export function consumeLeaseArchiveHelperInvocationCountForTest() {
  const count = leaseArchiveHelperInvocationCountForTest;
  leaseArchiveHelperInvocationCountForTest = 0;
  return count;
}

export function consumePendingLeaseTransactionInspectionCountForTest() {
  const count = pendingLeaseTransactionInspectionCountForTest;
  pendingLeaseTransactionInspectionCountForTest = 0;
  return count;
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
      !bigIntIdentityMatches(binding.identity, bigIntDirectoryIdentity(current))
    ) {
      throw new Error("directory path changed generation");
    }
    const held = fstatSync(binding.descriptor, { bigint: true });
    if (
      !bigIntIdentityMatches(binding.identity, bigIntDirectoryIdentity(held))
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

function requirePinnedLeaseArchiveDirectoryChild(helper, parent, child, label) {
  if (
    path.dirname(child.path) !== parent.path ||
    path.basename(child.path).length === 0
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} is not one direct canonical directory child.`,
    );
  }
  assertPinnedLeaseArchiveDirectory(parent);
  assertPinnedLeaseArchiveDirectory(child);
  const writerContext = activeOutcomeWriterContextForPath(parent.path);
  const proofCache =
    writerContext === null
      ? undefined
      : OUTCOME_WRITER_DIRECTORY_CHILD_PROOF_CACHES.get(writerContext);
  const proofKey = [
    parent.path,
    parent.identity.dev,
    parent.identity.ino,
    parent.identity.mode,
    parent.identity.uid,
    child.path,
    child.identity.dev,
    child.identity.ino,
    child.identity.mode,
    child.identity.uid,
  ]
    .map(String)
    .join("\0");
  if (proofCache?.has(proofKey)) return;
  const result = runLeaseArchiveHelper(
    helper,
    "directory-child-proof",
    [
      path.basename(child.path),
      ...pinnedDirectoryArguments(parent),
      ...pinnedDirectoryArguments(child),
    ],
    [parent.descriptor, child.descriptor],
  );
  let receipt;
  try {
    receipt = JSON.parse(result.toString("utf8"));
  } catch {
    receipt = null;
  }
  const expected = {
    childDevice: child.identity.dev.toString(),
    childInode: child.identity.ino.toString(),
    childMode: (0o700).toString(),
    name: path.basename(child.path),
    operation: "directory-child-proof",
    parentDevice: parent.identity.dev.toString(),
    parentInode: parent.identity.ino.toString(),
    parentMode: (0o700).toString(),
    protocol: LEASE_ARCHIVE_MOVE_PROTOCOL,
    uid: process.getuid().toString(),
  };
  if (
    Object.keys(receipt ?? {})
      .sort()
      .join("\n") !== Object.keys(expected).sort().join("\n") ||
    Object.entries(expected).some(([key, value]) => receipt[key] !== value)
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} returned an inexact held parent-child proof.`,
    );
  }
  assertPinnedLeaseArchiveDirectory(parent);
  assertPinnedLeaseArchiveDirectory(child);
  proofCache?.add(proofKey);
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

function openPinnedLeaseArchiveFile(
  filePath,
  snapshot,
  label,
  { allowEmpty = false } = {},
) {
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
      (!allowEmpty && held.size <= 0n) ||
      held.size > BigInt(LEASE_TRANSACTION_MAX_BYTES) ||
      !privateFileIdentityMatches(snapshot.identity, held) ||
      !snapshot.bytes.equals(readHeldPrivateFile(descriptor, Number(held.size)))
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

const LEASE_PRIVATE_BATCH_IDENTITY_KEYS = Object.freeze([
  "ctimeNs",
  "device",
  "gid",
  "inode",
  "kind",
  "linkCount",
  "mode",
  "mtimeNs",
  "name",
  "size",
  "uid",
]);
const LEASE_PRIVATE_BATCH_PARENT_KEYS = Object.freeze([
  "parentCtimeNs",
  "parentDevice",
  "parentGid",
  "parentInode",
  "parentLinkCount",
  "parentMode",
  "parentMtimeNs",
  "parentSize",
  "parentUid",
]);

function canonicalPrivateBatchRequest(value) {
  return Buffer.from(
    `${JSON.stringify(canonicalIntentValue(value))}\n`,
    "utf8",
  );
}

function isPrivateFileBatchOperation(operation) {
  return [
    "private-file-batch-read",
    "private-file-batch-read-allow-empty",
  ].includes(operation);
}

function privateBatchArguments(
  directory,
  limits = LEASE_PRIVATE_BATCH_DEFAULT_LIMITS,
) {
  return [
    limits.maxEntries.toString(),
    limits.maxSelectedEntries.toString(),
    limits.maxEncodedNameBytes.toString(),
    limits.maxRequestBytes.toString(),
    limits.maxBufferBytes.toString(),
    limits.maxFileBytes.toString(),
    limits.maxTotalBytes.toString(),
    limits.maxSelectedBytes.toString(),
    ...pinnedDirectoryArguments(directory),
  ];
}

function requireCanonicalPrivateBatchDecimal(value, label, maximum = null) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${label} is not one canonical nonnegative decimal string.`,
    );
  }
  const parsed = BigInt(value);
  if (maximum !== null && parsed > BigInt(maximum)) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${label} exceeds its supported boundary.`,
    );
  }
  return parsed;
}

function requireCanonicalPrivateBatchName(name, label) {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes(path.sep) ||
    name.includes("\0")
  ) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${label} is not one canonical physical child name.`,
    );
  }
  return name;
}

function privateBatchParentReceipt(directory) {
  const stats = fstatSync(directory.descriptor, { bigint: true });
  return Object.freeze({
    parentDevice: stats.dev.toString(),
    parentInode: stats.ino.toString(),
    parentMode: Number(stats.mode & 0o7777n).toString(),
    parentUid: stats.uid.toString(),
    parentGid: stats.gid.toString(),
    parentLinkCount: stats.nlink.toString(),
    parentSize: stats.size.toString(),
    parentMtimeNs: stats.mtimeNs.toString(),
    parentCtimeNs: stats.ctimeNs.toString(),
  });
}

function parsePrivateBatchIdentity(
  value,
  {
    directory,
    label,
    expectedKind,
    extraKeys = [],
    maxFileBytes = LEASE_TRANSACTION_MAX_BYTES,
    allowedFileLinkCounts = [1],
    allowedFileModes = [0o600],
    allowEmptyFiles = false,
  },
) {
  const expectedKeys = [...LEASE_PRIVATE_BATCH_IDENTITY_KEYS, ...extraKeys]
    .sort()
    .join("\n");
  if (
    Object.keys(value ?? {})
      .sort()
      .join("\n") !== expectedKeys ||
    value.kind !== expectedKind
  ) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${label} has an inexact descriptor identity shape.`,
    );
  }
  const name = requireCanonicalPrivateBatchName(value.name, `${label} name`);
  for (const field of [
    "device",
    "inode",
    "mode",
    "linkCount",
    "uid",
    "gid",
    "size",
    "mtimeNs",
    "ctimeNs",
  ]) {
    requireCanonicalPrivateBatchDecimal(value[field], `${label} ${field}`);
  }
  const file = expectedKind === "file";
  if (
    value.device !== directory.identity.dev.toString() ||
    value.uid !== BigInt(process.getuid()).toString() ||
    (file
      ? !allowedFileModes.includes(Number(value.mode)) ||
        !allowedFileLinkCounts.includes(Number(value.linkCount)) ||
        BigInt(value.size) < (allowEmptyFiles ? 0n : 1n) ||
        BigInt(value.size) > BigInt(maxFileBytes)
      : value.mode !== (0o700).toString() || BigInt(value.linkCount) < 1n)
  ) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${label} is outside the private physical generation boundary.`,
    );
  }
  return Object.freeze({
    name,
    kind: expectedKind,
    device: value.device,
    inode: value.inode,
    mode: value.mode,
    linkCount: value.linkCount,
    uid: value.uid,
    gid: value.gid,
    size: value.size,
    mtimeNs: value.mtimeNs,
    ctimeNs: value.ctimeNs,
  });
}

function privateBatchIdentityEqual(left, right) {
  return LEASE_PRIVATE_BATCH_IDENTITY_KEYS.every(
    (key) => left[key] === right[key],
  );
}

function decodeCanonicalPrivateBatchBytes(value, identity, digest, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${label} bytes are not canonical Base64.`,
    );
  }
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.toString("base64") !== value ||
    bytes.length.toString() !== identity.size ||
    !/^[0-9a-f]{64}$/.test(String(digest)) ||
    digestBytes(bytes) !== digest
  ) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${label} bytes do not match their descriptor identity.`,
    );
  }
  return bytes;
}

function privateBatchInventoryDigest(parent, entries) {
  const digest = createHash("sha256");
  digest.update(`${JSON.stringify(canonicalIntentValue(parent))}\n`, "utf8");
  for (const entry of entries) {
    digest.update(`${JSON.stringify(canonicalIntentValue(entry))}\n`, "utf8");
  }
  return digest.digest("hex");
}

function parsePrivateBatchReceipt(
  result,
  {
    directory,
    operation,
    requestBytes,
    expectedDirectoryNames = [],
    expectedInventory = null,
    selectedNames = [],
    limits = LEASE_PRIVATE_BATCH_DEFAULT_LIMITS,
  },
) {
  let receipt;
  try {
    receipt = JSON.parse(result.toString("utf8"));
  } catch {
    receipt = null;
  }
  const totalField = isPrivateFileBatchOperation(operation)
    ? "inventoryTotalFileBytes"
    : "inventoryTotalRecordBytes";
  const expectedKeys = [
    "encodedOutputBytes",
    "includeBytes",
    "inventoryDigest",
    "inventoryEncodedNameBytes",
    "inventoryEntries",
    "inventoryEntryCount",
    "inventoryNamesDigest",
    totalField,
    "operation",
    ...LEASE_PRIVATE_BATCH_PARENT_KEYS,
    "protocol",
    "requestDigest",
    "returnInventory",
    "selectedEntries",
    "selectedEntryCount",
    "selectedTotalBytes",
  ]
    .sort()
    .join("\n");
  const request = JSON.parse(requestBytes.toString("utf8"));
  if (
    Object.keys(receipt ?? {})
      .sort()
      .join("\n") !== expectedKeys ||
    receipt.protocol !== LEASE_ARCHIVE_MOVE_PROTOCOL ||
    receipt.operation !== operation ||
    receipt.requestDigest !== digestBytes(requestBytes) ||
    receipt.includeBytes !== request.includeBytes ||
    receipt.returnInventory !== request.returnInventory ||
    receipt.encodedOutputBytes !== result.length.toString() ||
    !/^[0-9a-f]{64}$/.test(String(receipt.inventoryDigest)) ||
    !/^[0-9a-f]{64}$/.test(String(receipt.inventoryNamesDigest)) ||
    !Array.isArray(receipt.inventoryEntries) ||
    !Array.isArray(receipt.selectedEntries)
  ) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${operation} returned an inexact descriptor batch receipt.`,
    );
  }
  const parent = privateBatchParentReceipt(directory);
  if (Object.entries(parent).some(([key, value]) => receipt[key] !== value)) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${operation} returned a different held parent generation.`,
    );
  }
  const entryCount = Number(
    requireCanonicalPrivateBatchDecimal(
      receipt.inventoryEntryCount,
      `${operation} inventory entry count`,
      limits.maxEntries,
    ),
  );
  const encodedNameBytes = Number(
    requireCanonicalPrivateBatchDecimal(
      receipt.inventoryEncodedNameBytes,
      `${operation} encoded name bytes`,
      limits.maxEncodedNameBytes,
    ),
  );
  const inventoryTotalBytes = requireCanonicalPrivateBatchDecimal(
    receipt[totalField],
    `${operation} inventory total bytes`,
    limits.maxTotalBytes,
  );
  const selectedEntryCount = Number(
    requireCanonicalPrivateBatchDecimal(
      receipt.selectedEntryCount,
      `${operation} selected entry count`,
      limits.maxSelectedEntries,
    ),
  );
  const selectedTotalBytes = requireCanonicalPrivateBatchDecimal(
    receipt.selectedTotalBytes,
    `${operation} selected total bytes`,
    limits.maxSelectedBytes,
  );
  if (
    selectedEntryCount !== selectedNames.length ||
    selectedEntryCount !== receipt.selectedEntries.length ||
    (request.returnInventory
      ? receipt.inventoryEntries.length !== entryCount
      : receipt.inventoryEntries.length !== 0)
  ) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${operation} returned inconsistent batch counts.`,
    );
  }

  let previousNameBytes = null;
  let calculatedEncodedNameBytes = 0;
  let calculatedInventoryBytes = 0n;
  const inventoryEntries = receipt.inventoryEntries.map((entry) => {
    const nameBytes = Buffer.from(String(entry?.name ?? ""), "utf8");
    if (
      previousNameBytes !== null &&
      Buffer.compare(previousNameBytes, nameBytes) >= 0
    ) {
      throw new AutomationControlError(
        "control_event_history_invalid",
        `${operation} inventory names are not in canonical byte order.`,
      );
    }
    previousNameBytes = nameBytes;
    calculatedEncodedNameBytes += nameBytes.length;
    if (isPrivateFileBatchOperation(operation)) {
      const kind = entry?.kind;
      if (!["file", "directory"].includes(kind)) {
        throw new AutomationControlError(
          "control_event_history_invalid",
          `${operation} inventory contains an unsupported entry kind.`,
        );
      }
      const parsed = parsePrivateBatchIdentity(entry, {
        directory,
        label: `${operation} inventory entry`,
        expectedKind: kind,
        maxFileBytes: limits.maxFileBytes,
        allowedFileModes:
          operation === "private-file-batch-read-allow-empty"
            ? [0o600, 0o640, 0o644]
            : [0o600],
        allowEmptyFiles: operation === "private-file-batch-read-allow-empty",
      });
      if (kind === "file") calculatedInventoryBytes += BigInt(parsed.size);
      return parsed;
    }
    const parsedDirectory = parsePrivateBatchIdentity(entry, {
      directory,
      label: `${operation} inventory entry`,
      expectedKind: "lease-state-directory",
      extraKeys: ["record"],
    });
    if (!/^[0-9a-f]{64}\.[0-9a-f]{64}\.lease$/.test(parsedDirectory.name)) {
      throw new AutomationControlError(
        "control_event_history_invalid",
        `${operation} inventory contains a noncanonical retired lease name.`,
      );
    }
    let record = null;
    if (entry.record !== null) {
      const parsedRecord = parsePrivateBatchIdentity(entry.record, {
        directory,
        label: `${operation} inventory record`,
        expectedKind: "file",
        maxFileBytes: limits.maxFileBytes,
        allowEmptyFiles: operation === "private-file-batch-read-allow-empty",
        extraKeys: ["digest"],
      });
      if (
        parsedRecord.name !== "lease.json" ||
        !/^[0-9a-f]{64}$/.test(String(entry.record.digest))
      ) {
        throw new AutomationControlError(
          "control_event_history_invalid",
          `${operation} inventory record identity is invalid.`,
        );
      }
      record = Object.freeze({
        ...parsedRecord,
        digest: entry.record.digest,
      });
      calculatedInventoryBytes += BigInt(parsedRecord.size);
    }
    return Object.freeze({ ...parsedDirectory, record });
  });
  if (request.returnInventory) {
    const names = inventoryEntries.map((entry) => entry.name);
    const expectedDirectories = [...expectedDirectoryNames].sort(
      (left, right) =>
        Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
    );
    const actualDirectories = inventoryEntries
      .filter((entry) => entry.kind === "directory")
      .map((entry) => entry.name);
    if (
      calculatedEncodedNameBytes !== encodedNameBytes ||
      calculatedInventoryBytes !== inventoryTotalBytes ||
      digestBytes(Buffer.from(`${JSON.stringify(names)}\n`, "utf8")) !==
        receipt.inventoryNamesDigest ||
      privateBatchInventoryDigest(parent, receipt.inventoryEntries) !==
        receipt.inventoryDigest ||
      actualDirectories.join("\0") !== expectedDirectories.join("\0")
    ) {
      throw new AutomationControlError(
        "control_event_history_invalid",
        `${operation} returned an inconsistent full inventory.`,
      );
    }
  } else if (
    expectedInventory === null ||
    receipt.inventoryEntryCount !== expectedInventory.entryCount.toString() ||
    receipt.inventoryEncodedNameBytes !==
      expectedInventory.encodedNameBytes.toString() ||
    receipt.inventoryNamesDigest !== expectedInventory.namesDigest ||
    receipt.inventoryDigest !== expectedInventory.digest ||
    receipt[totalField] !== expectedInventory.totalBytes.toString()
  ) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${operation} changed its admitted full inventory.`,
    );
  }

  let calculatedSelectedBytes = 0n;
  const selectedEntries = receipt.selectedEntries.map((entry, index) => {
    if (entry?.name !== selectedNames[index]) {
      throw new AutomationControlError(
        "control_event_history_invalid",
        `${operation} selected entries changed canonical order.`,
      );
    }
    const admitted = expectedInventory?.entryByName.get(entry.name);
    if (isPrivateFileBatchOperation(operation)) {
      const parsed = parsePrivateBatchIdentity(entry, {
        directory,
        label: `${operation} selected entry`,
        expectedKind: "file",
        maxFileBytes: limits.maxFileBytes,
        allowedFileModes:
          operation === "private-file-batch-read-allow-empty"
            ? [0o600, 0o640, 0o644]
            : [0o600],
        allowEmptyFiles: operation === "private-file-batch-read-allow-empty",
        extraKeys: request.includeBytes
          ? ["bytesBase64", "digest"]
          : ["digest"],
      });
      if (
        admitted === undefined ||
        admitted.kind !== "file" ||
        !privateBatchIdentityEqual(parsed, admitted)
      ) {
        throw new AutomationControlError(
          "control_event_history_invalid",
          `${operation} selected a different admitted file generation.`,
        );
      }
      const bytes = request.includeBytes
        ? decodeCanonicalPrivateBatchBytes(
            entry.bytesBase64,
            parsed,
            entry.digest,
            `${operation} selected entry`,
          )
        : null;
      calculatedSelectedBytes += BigInt(parsed.size);
      return Object.freeze({ ...parsed, digest: entry.digest, bytes });
    }
    const parsedDirectory = parsePrivateBatchIdentity(entry, {
      directory,
      label: `${operation} selected entry`,
      expectedKind: "lease-state-directory",
      extraKeys: ["record"],
    });
    if (
      admitted === undefined ||
      admitted.kind !== "lease-state-directory" ||
      !privateBatchIdentityEqual(parsedDirectory, admitted)
    ) {
      throw new AutomationControlError(
        "control_event_history_invalid",
        `${operation} selected a different retired lease directory.`,
      );
    }
    let record = null;
    if (entry.record !== null) {
      const parsedRecord = parsePrivateBatchIdentity(entry.record, {
        directory,
        label: `${operation} selected lease record`,
        expectedKind: "file",
        maxFileBytes: limits.maxFileBytes,
        extraKeys: request.includeBytes
          ? ["bytesBase64", "digest"]
          : ["digest"],
      });
      if (
        admitted.record === null ||
        !privateBatchIdentityEqual(parsedRecord, admitted.record) ||
        entry.record.digest !== admitted.record.digest
      ) {
        throw new AutomationControlError(
          "control_event_history_invalid",
          `${operation} selected a different retired lease record.`,
        );
      }
      const bytes = request.includeBytes
        ? decodeCanonicalPrivateBatchBytes(
            entry.record.bytesBase64,
            parsedRecord,
            entry.record.digest,
            `${operation} selected lease record`,
          )
        : null;
      calculatedSelectedBytes += BigInt(parsedRecord.size);
      record = Object.freeze({
        ...parsedRecord,
        digest: entry.record.digest,
        bytes,
      });
    } else if (admitted.record !== null) {
      throw new AutomationControlError(
        "control_event_history_invalid",
        `${operation} omitted one admitted retired lease record.`,
      );
    }
    return Object.freeze({ ...parsedDirectory, record });
  });
  if (calculatedSelectedBytes !== selectedTotalBytes) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `${operation} returned inconsistent selected bytes.`,
    );
  }
  const entryByName = new Map(
    inventoryEntries.map((entry) => [entry.name, entry]),
  );
  return Object.freeze({
    entryCount,
    encodedNameBytes,
    namesDigest: receipt.inventoryNamesDigest,
    digest: receipt.inventoryDigest,
    totalBytes: inventoryTotalBytes,
    parent,
    entries: Object.freeze(inventoryEntries),
    entryByName,
    selectedEntries: Object.freeze(selectedEntries),
  });
}

function privateBatchRequestFor(
  operation,
  {
    expectedDirectoryNames = [],
    inventory = null,
    includeBytes = false,
    returnInventory = true,
    selectedNames = [],
  } = {},
) {
  const orderedDirectoryNames = [...expectedDirectoryNames].sort(
    (left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  const common = {
    expectedInventoryDigest: inventory?.digest ?? null,
    expectedNameCount: inventory?.entryCount ?? null,
    expectedNamesDigest: inventory?.namesDigest ?? null,
    includeBytes,
    returnInventory,
    schemaVersion: 1,
  };
  return canonicalPrivateBatchRequest(
    isPrivateFileBatchOperation(operation)
      ? {
          ...common,
          expectedDirectoryNames: orderedDirectoryNames,
          selectedFileNames: selectedNames,
        }
      : { ...common, selectedDirectoryNames: selectedNames },
  );
}

function admitPrivateBatchInventory(
  helper,
  directory,
  operation,
  expectedDirectoryNames = [],
  limits = LEASE_PRIVATE_BATCH_DEFAULT_LIMITS,
) {
  const requestBytes = privateBatchRequestFor(operation, {
    expectedDirectoryNames,
  });
  assertPinnedLeaseArchiveDirectory(directory);
  const result = runLeaseArchiveHelper(
    helper,
    operation,
    privateBatchArguments(directory, limits),
    [directory.descriptor],
    requestBytes,
  );
  assertPinnedLeaseArchiveDirectory(directory);
  return parsePrivateBatchReceipt(result, {
    directory,
    operation,
    requestBytes,
    expectedDirectoryNames,
    limits,
  });
}

function partitionPrivateBatchSelection(
  operation,
  inventory,
  expectedDirectoryNames,
  selectedNames,
  instrumentation = undefined,
  limits = LEASE_PRIVATE_BATCH_DEFAULT_LIMITS,
) {
  const maxChunkSelectedBytes =
    limits.maxChunkSelectedBytes ?? limits.maxSelectedBytes;
  const chunks = [];
  let current = [];
  let currentBytes = 0;
  const emptyRequest = privateBatchRequestFor(operation, {
    expectedDirectoryNames,
    inventory,
    includeBytes: true,
    returnInventory: false,
    selectedNames: [],
  });
  instrumentation?.requestBuilt?.();
  let currentRequestBytes = emptyRequest.length;
  const finishChunk = () => {
    if (current.length === 0) return;
    const request = privateBatchRequestFor(operation, {
      expectedDirectoryNames,
      inventory,
      includeBytes: true,
      returnInventory: false,
      selectedNames: current,
    });
    instrumentation?.requestBuilt?.();
    if (
      request.length !== currentRequestBytes ||
      request.length > limits.maxRequestBytes
    ) {
      throw new AutomationControlError(
        "control_event_history_invalid",
        `${operation} request accounting does not match canonical serialization.`,
      );
    }
    chunks.push(current);
  };
  for (const name of selectedNames) {
    const entry = inventory.entryByName.get(name);
    const size = isPrivateFileBatchOperation(operation)
      ? Number(entry?.size ?? -1)
      : Number(entry?.record?.size ?? 0);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new AutomationControlError(
        "control_event_history_invalid",
        `${operation} selection is absent from the admitted inventory.`,
      );
    }
    const encodedNameBytes = Buffer.byteLength(JSON.stringify(name), "utf8");
    const separatorBytes = current.length === 0 ? 0 : 1;
    if (
      current.length > 0 &&
      (current.length + 1 > limits.maxSelectedEntries ||
        currentBytes + size > maxChunkSelectedBytes ||
        currentRequestBytes + separatorBytes + encodedNameBytes >
          limits.maxRequestBytes)
    ) {
      finishChunk();
      current = [];
      currentBytes = 0;
      currentRequestBytes = emptyRequest.length;
    }
    current.push(name);
    currentBytes += size;
    currentRequestBytes += (current.length === 1 ? 0 : 1) + encodedNameBytes;
    if (
      current.length > limits.maxSelectedEntries ||
      currentBytes > maxChunkSelectedBytes ||
      currentRequestBytes > limits.maxRequestBytes
    ) {
      throw new AutomationControlError(
        "control_event_history_invalid",
        `${operation} cannot represent one selected generation inside the chunk boundary.`,
      );
    }
  }
  finishChunk();
  return chunks;
}

export function partitionPrivateBatchSelectionForTest(names) {
  if (
    !Array.isArray(names) ||
    names.some((name) => typeof name !== "string" || name.length === 0)
  ) {
    throw new AutomationControlError(
      "invalid_argument",
      "Private batch partition test names must be nonempty strings.",
    );
  }
  const entryByName = new Map(
    names.map((name) => [name, Object.freeze({ name, size: "1" })]),
  );
  let requestBuildCount = 0;
  const chunks = partitionPrivateBatchSelection(
    "private-file-batch-read",
    { entryByName },
    [],
    names,
    { requestBuilt: () => (requestBuildCount += 1) },
  );
  return Object.freeze({
    chunkCount: chunks.length,
    selectedNameCount: chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    maximumChunkSize: Math.max(0, ...chunks.map((chunk) => chunk.length)),
    requestBuildCount,
  });
}

function readPrivateBatchSelection(
  helper,
  directory,
  operation,
  inventory,
  selectedNames,
  {
    expectedDirectoryNames = [],
    onEntry = () => {},
    limits = LEASE_PRIVATE_BATCH_DEFAULT_LIMITS,
  } = {},
) {
  const orderedNames = [...selectedNames].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  for (const chunk of partitionPrivateBatchSelection(
    operation,
    inventory,
    expectedDirectoryNames,
    orderedNames,
    undefined,
    limits,
  )) {
    const requestBytes = privateBatchRequestFor(operation, {
      expectedDirectoryNames,
      inventory,
      includeBytes: true,
      returnInventory: false,
      selectedNames: chunk,
    });
    assertPinnedLeaseArchiveDirectory(directory);
    const result = runLeaseArchiveHelper(
      helper,
      operation,
      privateBatchArguments(directory, limits),
      [directory.descriptor],
      requestBytes,
    );
    assertPinnedLeaseArchiveDirectory(directory);
    const parsed = parsePrivateBatchReceipt(result, {
      directory,
      operation,
      requestBytes,
      expectedDirectoryNames,
      expectedInventory: inventory,
      selectedNames: chunk,
      limits,
    });
    for (const entry of parsed.selectedEntries) onEntry(entry);
  }
}

function requirePrivateBatchInventoryUnchanged(
  helper,
  directory,
  operation,
  inventory,
  expectedDirectoryNames = [],
  limits = LEASE_PRIVATE_BATCH_DEFAULT_LIMITS,
) {
  const identityMatchesStats = (identity, stats, expectedKind) =>
    !stats.isSymbolicLink() &&
    stats.dev.toString() === identity.device &&
    stats.ino.toString() === identity.inode &&
    Number(stats.mode & 0o7777n).toString() === identity.mode &&
    stats.nlink.toString() === identity.linkCount &&
    stats.uid.toString() === identity.uid &&
    stats.gid.toString() === identity.gid &&
    stats.size.toString() === identity.size &&
    stats.mtimeNs.toString() === identity.mtimeNs &&
    stats.ctimeNs.toString() === identity.ctimeNs &&
    (expectedKind === "file" ? stats.isFile() : stats.isDirectory());
  const parentMatchesInventory = () => {
    const parent = privateBatchParentReceipt(directory);
    return !Object.entries(inventory.parent).some(
      ([key, value]) => parent[key] !== value,
    );
  };
  const recordGenerationMatches = (recordPath, expected) => {
    let descriptor;
    try {
      const namedBefore = lstatSync(recordPath, { bigint: true });
      if (
        !identityMatchesStats(expected, namedBefore, "file") ||
        realpathSync(recordPath) !== recordPath
      ) {
        return false;
      }
      descriptor = openSync(
        recordPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const heldBefore = fstatSync(descriptor, { bigint: true });
      if (!identityMatchesStats(expected, heldBefore, "file")) return false;
      const bytes = readHeldPrivateFile(descriptor, Number(heldBefore.size));
      const heldAfter = fstatSync(descriptor, { bigint: true });
      const namedAfter = lstatSync(recordPath, { bigint: true });
      return (
        identityMatchesStats(expected, heldAfter, "file") &&
        identityMatchesStats(expected, namedAfter, "file") &&
        realpathSync(recordPath) === recordPath &&
        digestBytes(bytes) === expected.digest
      );
    } catch {
      return false;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  };
  const currentGenerationMatches = () => {
    try {
      assertPinnedLeaseArchiveDirectory(directory);
      if (!parentMatchesInventory()) return false;
      const names = readdirSync(directory.path, { encoding: "buffer" })
        .sort(Buffer.compare)
        .map((entry) => privateAuthorityDecoder.decode(entry));
      if (
        names.join("\0") !==
        inventory.entries.map((entry) => entry.name).join("\0")
      ) {
        return false;
      }
      for (const entry of inventory.entries) {
        const entryPath = path.join(directory.path, entry.name);
        const stats = lstatSync(entryPath, { bigint: true });
        if (
          realpathSync(entryPath) !== entryPath ||
          !identityMatchesStats(
            entry,
            stats,
            entry.kind === "file" ? "file" : "directory",
          )
        ) {
          return false;
        }
        if (entry.kind !== "lease-state-directory") continue;
        const expectedRecordNames = entry.record === null ? [] : ["lease.json"];
        const recordNames = readdirSync(entryPath, { encoding: "buffer" })
          .sort(Buffer.compare)
          .map((name) => privateAuthorityDecoder.decode(name));
        if (recordNames.join("\0") !== expectedRecordNames.join("\0")) {
          return false;
        }
        if (entry.record === null) continue;
        const recordPath = path.join(entryPath, "lease.json");
        if (
          !recordGenerationMatches(recordPath, entry.record) ||
          !identityMatchesStats(
            entry,
            lstatSync(entryPath, { bigint: true }),
            "directory",
          )
        ) {
          return false;
        }
      }
      assertPinnedLeaseArchiveDirectory(directory);
      return parentMatchesInventory();
    } catch {
      return false;
    }
  };
  if (
    activeOutcomeWriterContextForPath(directory.path) !== null &&
    currentGenerationMatches() &&
    currentGenerationMatches()
  ) {
    return;
  }
  const requestBytes = privateBatchRequestFor(operation, {
    expectedDirectoryNames,
    inventory,
    includeBytes: false,
    returnInventory: false,
  });
  assertPinnedLeaseArchiveDirectory(directory);
  const result = runLeaseArchiveHelper(
    helper,
    operation,
    privateBatchArguments(directory, limits),
    [directory.descriptor],
    requestBytes,
  );
  assertPinnedLeaseArchiveDirectory(directory);
  parsePrivateBatchReceipt(result, {
    directory,
    operation,
    requestBytes,
    expectedDirectoryNames,
    expectedInventory: inventory,
    limits,
  });
}

function automationPlanningReadNames(
  helper,
  directory,
  label,
  maxEntries = AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES,
) {
  const generationFingerprint = () => {
    try {
      assertPinnedLeaseArchiveDirectory(directory);
      const held = fstatSync(directory.descriptor, { bigint: true });
      const named = lstatSync(directory.path, { bigint: true });
      if (
        filesystemGenerationFingerprint(held) !==
          filesystemGenerationFingerprint(named) ||
        realpathSync(directory.path) !== directory.path
      ) {
        return null;
      }
      return filesystemGenerationFingerprint(held);
    } catch {
      return null;
    }
  };
  const context = activeOutcomeWriterContextForPath(directory.path);
  const cache =
    context === null
      ? undefined
      : OUTCOME_WRITER_DIRECTORY_NAME_CACHES.get(context);
  const cacheKey = [
    directory.path,
    directory.identity.dev,
    directory.identity.ino,
    maxEntries,
  ]
    .map(String)
    .join("\0");
  const before = generationFingerprint();
  const cached = cache?.get(cacheKey);
  if (
    before !== null &&
    cached !== undefined &&
    cached.generationFingerprint === before
  ) {
    return cached.names;
  }
  const names = Object.freeze(
    listPinnedAutomationAuthorityDirectory(helper, directory, {
      maxEntries,
      label,
      errorCode: "control_event_history_invalid",
    }),
  );
  const after = generationFingerprint();
  if (cache !== undefined && before !== null && before === after) {
    cache.set(cacheKey, Object.freeze({ generationFingerprint: after, names }));
  } else {
    cache?.delete(cacheKey);
  }
  return names;
}

function cloneAutomationPlanningPlainValue(value) {
  if (["function", "symbol"].includes(typeof value)) {
    throw new AutomationControlError(
      "invalid_state",
      "Automation planning public values cannot contain executable values.",
    );
  }
  if (value === null || typeof value !== "object") return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    throw new AutomationControlError(
      "invalid_state",
      "Automation planning public values cannot expose mutable byte arrays.",
    );
  }
  if (value instanceof Map) {
    return Object.freeze(
      [...value.entries()].map(([key, entry]) =>
        Object.freeze([
          cloneAutomationPlanningPlainValue(key),
          cloneAutomationPlanningPlainValue(entry),
        ]),
      ),
    );
  }
  if (value instanceof Set) {
    return Object.freeze(
      [...value].map((entry) => cloneAutomationPlanningPlainValue(entry)),
    );
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneAutomationPlanningPlainValue));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AutomationControlError(
      "invalid_state",
      "Automation planning public values must be plain data.",
    );
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        cloneAutomationPlanningPlainValue(entry),
      ]),
    ),
  );
}

function automationPlanningSnapshotIdentity(snapshot) {
  if (snapshot.missing) return null;
  return Object.freeze({
    dev: String(snapshot.identity.dev),
    ino: String(snapshot.identity.ino),
    mode: Number(snapshot.identity.mode) & 0o7777,
    nlink: Number(snapshot.identity.nlink),
    uid: Number(snapshot.identity.uid),
    gid: Number(snapshot.identity.gid),
    size: Number(snapshot.identity.size),
    mtimeNs: String(snapshot.identity.mtimeNs),
    ctimeNs: String(snapshot.identity.ctimeNs),
  });
}

function automationPlanningDirectoryIdentity(snapshot) {
  const identity = snapshot.directoryIdentity;
  return Object.freeze({
    dev: String(identity.dev),
    ino: String(identity.ino),
    mode: Number(identity.mode) & 0o7777,
    uid: Number(identity.uid),
  });
}

function automationPlanningSelectionIdentity(snapshot) {
  const dev = snapshot.dev ?? snapshot.device;
  const ino = snapshot.ino ?? snapshot.inode;
  const nlink = snapshot.nlink ?? snapshot.linkCount;
  if (
    !/^\d+$/.test(String(dev ?? "")) ||
    !/^\d+$/.test(String(ino ?? "")) ||
    !Number.isSafeInteger(Number(nlink))
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Automation planning selection has no exact admitted identity.",
    );
  }
  return Object.freeze({
    dev: String(dev),
    ino: String(ino),
    mode: Number(snapshot.mode) & 0o7777,
    nlink: Number(nlink),
    uid: Number(snapshot.uid),
    gid: Number(snapshot.gid),
    size: Number(snapshot.size),
    mtimeNs: String(snapshot.mtimeNs),
    ctimeNs: String(snapshot.ctimeNs),
  });
}

function createAutomationPlanningAdmissionToken({
  kind,
  name,
  filePath,
  missing,
  digest,
  size,
}) {
  return Object.freeze({
    kind,
    name,
    filePath,
    missing,
    digest,
    size,
  });
}

function requireAutomationPlanningReadNamesUnchanged(
  helper,
  directory,
  expectedNames,
  label,
) {
  const current = automationPlanningReadNames(helper, directory, label);
  if (current.join("\0") !== expectedNames.join("\0")) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} changed during the coherent planning read.`,
    );
  }
  assertPinnedLeaseArchiveDirectory(directory);
}

function admitSettledTaskTransactionInventory(paths, helper, controlNames) {
  if (!controlNames.includes(path.basename(paths.taskTransactions))) {
    return {
      public: Object.freeze({ missing: true, entryCount: 0 }),
      internal: null,
    };
  }
  const directory = openPinnedLeaseArchiveDirectory(
    paths.taskTransactions,
    "Settled task transaction directory",
  );
  try {
    const retirementExists = pathEntryExists(
      path.join(paths.taskTransactions, AUTHORITY_RETIREMENT_DIRECTORY),
    );
    const expectedDirectories = retirementExists
      ? [AUTHORITY_RETIREMENT_DIRECTORY]
      : [];
    const inventory = admitPrivateBatchInventory(
      helper,
      directory,
      "private-file-batch-read",
      expectedDirectories,
    );
    if (inventory.entries.some((entry) => entry.kind === "file")) {
      throw new AutomationControlError(
        "transaction_conflict",
        "Outcome planning requires settled task transactions.",
      );
    }
    return {
      public: Object.freeze({
        missing: false,
        entryCount: inventory.entryCount,
        encodedNameBytes: inventory.encodedNameBytes,
        namesDigest: inventory.namesDigest,
        inventoryDigest: inventory.digest,
      }),
      internal: { directory, inventory, expectedDirectories },
    };
  } catch (error) {
    closeSync(directory.descriptor);
    throw error;
  }
}

function admitOutcomeRepairTransactionInventory(paths, helper, controlNames) {
  const transactionDirectory = path.join(
    paths.controlRoot,
    "outcome-ledger-transactions",
  );
  if (!controlNames.includes(path.basename(transactionDirectory))) {
    return {
      public: Object.freeze({
        missing: true,
        directoryPath: transactionDirectory,
        entryCount: 0,
        encodedNameBytes: 0,
        aggregateSelectedBytes: 0,
        selectionCount: 0,
        issues: Object.freeze([]),
      }),
      internal: null,
    };
  }
  const directory = openPinnedLeaseArchiveDirectory(
    transactionDirectory,
    "Outcome ledger repair transaction directory",
  );
  try {
    const expectedDirectories = pathEntryExists(
      path.join(transactionDirectory, AUTHORITY_RETIREMENT_DIRECTORY),
    )
      ? [AUTHORITY_RETIREMENT_DIRECTORY]
      : [];
    const inventory = admitPrivateBatchInventory(
      helper,
      directory,
      "private-file-batch-read",
      expectedDirectories,
      OUTCOME_REPAIR_TRANSACTION_BATCH_LIMITS,
    );
    const issues = [];
    const selectedNames = [];
    let aggregateSelectedBytes = 0;
    for (const entry of inventory.entries) {
      if (
        entry.kind === "directory" &&
        expectedDirectories.includes(entry.name)
      ) {
        continue;
      }
      const canonical =
        OUTCOME_REPAIR_TRANSACTION_NAME_PATTERN.test(entry.name) ||
        entry.name === OUTCOME_REPAIR_ACTIVE_TRANSACTION_NAME;
      const ownedTemporary = OUTCOME_REPAIR_TRANSACTION_TEMP_NAME_PATTERN.test(
        entry.name,
      );
      if (entry.kind !== "file" || (!canonical && !ownedTemporary)) {
        issues.push(`unexpected transaction entry ${entry.name}`);
        continue;
      }
      aggregateSelectedBytes += Number(entry.size);
      if (
        !Number.isSafeInteger(aggregateSelectedBytes) ||
        aggregateSelectedBytes > OUTCOME_REPAIR_TRANSACTION_MAX_SELECTED_BYTES
      ) {
        throw new AutomationControlError(
          "control_event_history_invalid",
          "Outcome ledger repair transaction selections exceed their aggregate byte boundary.",
        );
      }
      selectedNames.push(entry.name);
    }
    const selections = [];
    readPrivateBatchSelection(
      helper,
      directory,
      "private-file-batch-read",
      inventory,
      selectedNames,
      {
        expectedDirectoryNames: expectedDirectories,
        limits: OUTCOME_REPAIR_TRANSACTION_BATCH_LIMITS,
        onEntry: (entry) => selections.push(entry),
      },
    );
    const frozenSelections = Object.freeze(selections);
    return {
      public: Object.freeze({
        missing: false,
        directoryPath: transactionDirectory,
        entryCount: inventory.entryCount,
        encodedNameBytes: inventory.encodedNameBytes,
        aggregateSelectedBytes,
        selectionCount: frozenSelections.length,
        issues: Object.freeze(issues),
      }),
      internal: {
        directory,
        inventory,
        expectedDirectories,
        selectedNames: Object.freeze([...selectedNames]),
        selections: frozenSelections,
      },
    };
  } catch (error) {
    closeSync(directory.descriptor);
    if (!(error instanceof AutomationControlError)) throw error;
    const cause =
      typeof error.details?.cause === "string"
        ? `: ${error.details.cause}`
        : "";
    return {
      public: Object.freeze({
        missing: false,
        directoryPath: transactionDirectory,
        entryCount: 0,
        encodedNameBytes: 0,
        aggregateSelectedBytes: 0,
        selectionCount: 0,
        issues: Object.freeze([
          `transaction inventory admission failed: ${error.message}${cause}`,
        ]),
      }),
      internal: null,
    };
  }
}

function planningReadPathInsideStateRoot(stateRoot, filePath) {
  const normalized = path.resolve(String(filePath ?? ""));
  const relative = path.relative(stateRoot, normalized);
  if (
    normalized !== filePath ||
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new AutomationControlError(
      "invalid_argument",
      "Automation planning file admission must remain inside its state root.",
    );
  }
  return { normalized, relative };
}

function admitAutomationPlanningRepairAncestor(state, directoryPath, label) {
  const cached = state.repairTreeAncestorBindings.get(directoryPath);
  if (cached !== undefined) {
    assertPinnedLeaseArchiveDirectory(cached.directory);
    return cached;
  }
  const parentPath = path.dirname(directoryPath);
  const parent = state.repairTreeAncestorBindings.get(parentPath);
  if (parent === undefined) {
    throw new AutomationControlError(
      "invalid_state",
      `${label} has no retained canonical parent generation.`,
    );
  }
  const directory = openPinnedLeaseArchiveDirectory(directoryPath, label);
  try {
    requirePinnedLeaseArchiveDirectoryChild(
      state.helper,
      parent.directory,
      directory,
      label,
    );
    const binding = Object.freeze({
      directory,
      owned: true,
      parentPath,
    });
    state.repairTreeAncestorBindings.set(directoryPath, binding);
    return binding;
  } catch (error) {
    closeSync(directory.descriptor);
    throw error;
  }
}

function admitAutomationPlanningRepairAncestorChain(
  state,
  directoryPath,
  label,
) {
  const relative = path.relative(state.paths.stateRoot, directoryPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AutomationControlError(
      "invalid_state",
      `${label} ancestry escaped its state root.`,
    );
  }
  const bindings = [];
  let current = state.paths.stateRoot;
  const root = state.repairTreeAncestorBindings.get(current);
  if (root === undefined) {
    throw new AutomationControlError(
      "invalid_state",
      `${label} lost its held state root.`,
    );
  }
  assertPinnedLeaseArchiveDirectory(root.directory);
  bindings.push(root);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!pathEntryExists(current)) {
      throw new AutomationControlError(
        "invalid_state",
        `${label} ancestor is unavailable.`,
      );
    }
    const binding = admitAutomationPlanningRepairAncestor(
      state,
      current,
      label,
    );
    bindings.push(binding);
  }
  for (let index = 1; index < bindings.length; index += 1) {
    requirePinnedLeaseArchiveDirectoryChild(
      state.helper,
      bindings[index - 1].directory,
      bindings[index].directory,
      label,
    );
  }
  return Object.freeze(bindings);
}

function requireAutomationPlanningRepairAncestorsUnchanged(state) {
  for (const [directoryPath, binding] of state.repairTreeAncestorBindings) {
    assertPinnedLeaseArchiveDirectory(binding.directory);
    if (directoryPath === state.paths.stateRoot) continue;
    const parent = state.repairTreeAncestorBindings.get(binding.parentPath);
    if (parent === undefined) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        "Outcome ledger repair tree ancestor lost its held parent generation.",
      );
    }
    requirePinnedLeaseArchiveDirectoryChild(
      state.helper,
      parent.directory,
      binding.directory,
      "Outcome ledger repair tree ancestor",
    );
  }
}

function nearestExistingPlanningReadParent(state, filePath) {
  const stateRoot = state.paths.stateRoot;
  let current = path.dirname(filePath);
  const missingSegments = [path.basename(filePath)];
  while (!pathEntryExists(current)) {
    if (current === stateRoot) break;
    const parent = path.dirname(current);
    if (parent === current || !current.startsWith(`${stateRoot}${path.sep}`)) {
      throw new AutomationControlError(
        "invalid_state",
        "Automation planning missing-path proof escaped its state root.",
      );
    }
    missingSegments.unshift(path.basename(current));
    current = parent;
  }
  if (!pathEntryExists(current)) {
    throw new AutomationControlError(
      "invalid_state",
      "Automation planning state root disappeared during admission.",
    );
  }
  let proof = state.missingParentInventories.get(current);
  if (proof === undefined) {
    const ancestry = admitAutomationPlanningRepairAncestorChain(
      state,
      current,
      "Automation planning nearest existing parent",
    );
    const directory = ancestry.at(-1).directory;
    const { expectedDirectories } = automationPlanningTreeDirectoryNames(
      state.helper,
      directory,
      "Automation planning nearest existing parent",
    );
    const inventory = admitPrivateBatchInventory(
      state.helper,
      directory,
      "private-file-batch-read-allow-empty",
      expectedDirectories,
      OUTCOME_REPAIR_TREE_BATCH_LIMITS,
    );
    proof = {
      directory,
      inventory,
      expectedDirectories,
      names: Object.freeze(inventory.entries.map((entry) => entry.name)),
      missingFirstSegments: new Set(),
    };
    state.missingParentInventories.set(current, proof);
  }
  if (proof.names.includes(missingSegments[0])) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      "Automation planning missing-path proof found the purportedly missing child.",
    );
  }
  proof.missingFirstSegments.add(missingSegments[0]);
  return {
    proof,
    missingSegments: Object.freeze(missingSegments),
  };
}

function admitAutomationPlanningReadFile(bundle, options) {
  requireAutomationPlanningReadBundle(bundle);
  const state = AUTOMATION_PLANNING_READ_BUNDLE_STATES.get(bundle);
  const failBudget = (message) => {
    state.repairAdmissionExhausted = true;
    throw new AutomationControlError("control_event_history_invalid", message);
  };
  if (state.repairAdmissionExhausted) {
    failBudget(
      "Outcome ledger repair admissions exhausted their aggregate boundary.",
    );
  }
  const { normalized: filePath, relative } = planningReadPathInsideStateRoot(
    state.paths.stateRoot,
    options?.filePath,
  );
  const encodedNameBytes = Buffer.byteLength(relative, "utf8");
  if (
    state.repairAdmissionCount >= 4_096 ||
    state.repairEncodedNameBytes + encodedNameBytes > 16 * 1024 * 1024
  ) {
    failBudget(
      "Outcome ledger repair admissions exceed their aggregate name boundary.",
    );
  }
  const requestedMaxBytes = Number(options?.maxBytes ?? 16 * 1024 * 1024);
  if (
    !Number.isSafeInteger(requestedMaxBytes) ||
    requestedMaxBytes < 0 ||
    requestedMaxBytes > 16 * 1024 * 1024
  ) {
    throw new AutomationControlError(
      "invalid_argument",
      "Outcome ledger repair file admission exceeds its per-file byte boundary.",
    );
  }
  const remainingBytes =
    OUTCOME_REPAIR_TRANSACTION_MAX_SELECTED_BYTES - state.repairAggregateBytes;
  if (remainingBytes <= 0) {
    failBudget(
      "Outcome ledger repair admissions exhausted their aggregate byte boundary.",
    );
  }
  const maxBytes = Math.min(requestedMaxBytes, remainingBytes);
  const allowedModes = [...(options?.allowedModes ?? [0o600])];
  if (
    allowedModes.length === 0 ||
    allowedModes.some((mode) => ![0o600, 0o640, 0o644].includes(mode))
  ) {
    throw new AutomationControlError(
      "invalid_argument",
      "Outcome ledger repair file admission has unsupported modes.",
    );
  }
  const allowMissing = options?.allowMissing === true;
  const allowEmpty = options?.allowEmpty === true;
  let snapshot;
  let terminal;
  try {
    if (!pathEntryExists(path.dirname(filePath))) {
      if (!allowMissing) {
        throw new AutomationControlError(
          "invalid_state",
          `${String(options?.label ?? "Outcome ledger repair file")} is unavailable.`,
        );
      }
      const { proof, missingSegments } = nearestExistingPlanningReadParent(
        state,
        filePath,
      );
      snapshot = Object.freeze({
        filePath,
        privateRoot: state.paths.stateRoot,
        missing: true,
        bytes: Buffer.alloc(0),
        identity: null,
        directoryIdentity: automationAuthorityDirectoryIdentity(
          proof.directory.identity,
        ),
        missingSuffix: missingSegments,
      });
      terminal = { kind: "missing-descendant", proof, missingSegments };
    } else {
      snapshot = readAutomationAuthorityFileSnapshotInternal(filePath, {
        allowMissing,
        allowEmpty,
        privateRoot: state.paths.stateRoot,
        maxBytes,
        allowedModes,
        label: String(options?.label ?? "Outcome ledger repair file"),
      });
      if (snapshot.missing) {
        const { proof, missingSegments } = nearestExistingPlanningReadParent(
          state,
          filePath,
        );
        terminal = { kind: "missing-descendant", proof, missingSegments };
      } else {
        terminal = {
          kind: "snapshot",
          options: Object.freeze({
            allowMissing,
            allowEmpty,
            privateRoot: state.paths.stateRoot,
            maxBytes,
            allowedModes: Object.freeze(allowedModes),
            label: String(options?.label ?? "Outcome ledger repair file"),
          }),
        };
      }
    }
    const admittedBytes = snapshot.bytes.length;
    if (
      state.repairAggregateBytes + admittedBytes >
      OUTCOME_REPAIR_TRANSACTION_MAX_SELECTED_BYTES
    ) {
      failBudget(
        "Outcome ledger repair admissions exceed their aggregate byte boundary.",
      );
    }
    state.repairAdmissionCount += 1;
    state.repairEncodedNameBytes += encodedNameBytes;
    state.repairAggregateBytes += admittedBytes;
    const token = createAutomationPlanningAdmissionToken({
      kind: "outcome-repair-file",
      name: relative,
      filePath,
      missing: snapshot.missing,
      digest: digestBytes(snapshot.bytes),
      size: admittedBytes,
    });
    AUTOMATION_PLANNING_READ_ADMISSION_OWNERS.set(token, bundle);
    AUTOMATION_PLANNING_READ_ADMISSION_STATES.set(token, {
      kind: "snapshot",
      snapshot,
    });
    state.fileAdmissions.push({ snapshot, terminal, token });
    return token;
  } catch (error) {
    state.repairAdmissionExhausted = true;
    throw error;
  }
}

function automationPlanningTreeDirectoryNames(
  helper,
  directory,
  label,
  maxEntries = AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES,
) {
  const names = automationPlanningReadNames(
    helper,
    directory,
    label,
    maxEntries,
  );
  assertPinnedLeaseArchiveDirectory(directory);
  const expectedDirectories = [];
  for (const name of names) {
    const childPath = path.join(directory.path, name);
    const stats = lstatSync(childPath, { bigint: true });
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      expectedDirectories.push(name);
    }
  }
  assertPinnedLeaseArchiveDirectory(directory);
  return { names, expectedDirectories: Object.freeze(expectedDirectories) };
}

function automationPlanningTreeDirectoryIdentity(directory, entry, label) {
  const stats = fstatSync(directory.descriptor, { bigint: true });
  if (
    stats.dev.toString() !== entry.device ||
    stats.ino.toString() !== entry.inode ||
    Number(stats.mode & 0o7777n).toString() !== entry.mode ||
    stats.nlink.toString() !== entry.linkCount ||
    stats.uid.toString() !== entry.uid ||
    stats.gid.toString() !== entry.gid ||
    stats.size.toString() !== entry.size ||
    stats.mtimeNs.toString() !== entry.mtimeNs ||
    stats.ctimeNs.toString() !== entry.ctimeNs
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} opened a different admitted directory generation.`,
    );
  }
}

function planningTreePublicIdentity(entry) {
  return Object.freeze({
    dev: entry.device,
    ino: entry.inode,
    mode: Number(entry.mode),
    nlink: Number(entry.linkCount),
    uid: Number(entry.uid),
    gid: Number(entry.gid),
    size: Number(entry.size),
    mtimeNs: entry.mtimeNs,
    ctimeNs: entry.ctimeNs,
  });
}

function requireAutomationPlanningRepairTreeFileMode(relativePath, entry) {
  const mode = Number(entry.mode);
  const legacyLedgerPredecessor =
    /^retired\/ledger-predecessor-[0-9a-f]{64}\.archive$/.test(relativePath);
  if (
    mode !== 0o600 &&
    !(legacyLedgerPredecessor && [0o640, 0o644].includes(mode))
  ) {
    throw new AutomationControlError(
      "control_event_history_invalid",
      `Outcome ledger repair tree file ${relativePath} has an unsupported mode.`,
    );
  }
}

function admitAutomationPlanningRepairTree(bundle, options) {
  requireAutomationPlanningReadBundle(bundle);
  const state = AUTOMATION_PLANNING_READ_BUNDLE_STATES.get(bundle);
  const { normalized: directoryPath, relative } =
    planningReadPathInsideStateRoot(
      state.paths.stateRoot,
      options?.directoryPath,
    );
  const label = String(options?.label ?? "Outcome ledger repair artifact tree");
  const allowMissing = options?.allowMissing === true;
  const maximumEntries = 4_096 - state.repairAdmissionCount;
  const maximumEncodedNameBytes =
    16 * 1024 * 1024 - state.repairEncodedNameBytes;
  const maximumAggregateBytes =
    OUTCOME_REPAIR_TRANSACTION_MAX_SELECTED_BYTES - state.repairAggregateBytes;
  const failBudget = (message) => {
    state.repairAdmissionExhausted = true;
    throw new AutomationControlError("control_event_history_invalid", message);
  };
  if (
    state.repairAdmissionExhausted ||
    maximumEntries < 1 ||
    maximumEncodedNameBytes <= 0 ||
    maximumAggregateBytes <= 0
  ) {
    failBudget(
      "Outcome ledger repair admissions exhausted their aggregate boundary.",
    );
  }
  const heldDirectories = [];
  const entries = [];
  let entryCount = 0;
  let encodedNameBytes = 0;
  let aggregateBytes = 0;
  try {
    if (allowMissing && !pathEntryExists(directoryPath)) {
      const { proof, missingSegments } = nearestExistingPlanningReadParent(
        state,
        directoryPath,
      );
      if (missingSegments.length > 0) {
        const snapshot = Object.freeze({
          filePath: directoryPath,
          privateRoot: state.paths.stateRoot,
          missing: true,
          bytes: Buffer.alloc(0),
          identity: null,
          directoryIdentity: automationAuthorityDirectoryIdentity(
            proof.directory.identity,
          ),
          missingSuffix: missingSegments,
        });
        state.repairAdmissionCount += 1;
        state.repairEncodedNameBytes += Buffer.byteLength(relative, "utf8");
        const token = createAutomationPlanningAdmissionToken({
          kind: "outcome-repair-tree",
          name: relative,
          filePath: directoryPath,
          missing: true,
          digest: digestBytes(snapshot.bytes),
          size: 0,
        });
        AUTOMATION_PLANNING_READ_ADMISSION_OWNERS.set(token, bundle);
        AUTOMATION_PLANNING_READ_ADMISSION_STATES.set(token, {
          kind: "snapshot",
          snapshot,
        });
        state.fileAdmissions.push({
          snapshot,
          terminal: {
            kind: "missing-descendant",
            proof,
            missingSegments,
          },
          token,
        });
        return token;
      }
    }
    const ancestorChain = admitAutomationPlanningRepairAncestorChain(
      state,
      path.dirname(directoryPath),
      `${label} ancestor`,
    );
    const rootParent = ancestorChain.at(-1);
    const rootDirectory = openPinnedLeaseArchiveDirectory(directoryPath, label);
    try {
      requirePinnedLeaseArchiveDirectoryChild(
        state.helper,
        rootParent.directory,
        rootDirectory,
        label,
      );
    } catch (error) {
      closeSync(rootDirectory.descriptor);
      throw error;
    }
    heldDirectories.push({
      directory: rootDirectory,
      relativePath: "",
      inventory: null,
      expectedDirectories: Object.freeze([]),
      selectedNames: Object.freeze([]),
      selections: Object.freeze([]),
    });
    const rootStats = fstatSync(rootDirectory.descriptor, { bigint: true });
    entries.push(
      Object.freeze({
        relativePath: "",
        kind: "directory",
        identity: Object.freeze({
          dev: rootStats.dev.toString(),
          ino: rootStats.ino.toString(),
          mode: Number(rootStats.mode & 0o7777n),
          nlink: Number(rootStats.nlink),
          uid: Number(rootStats.uid),
          gid: Number(rootStats.gid),
          size: Number(rootStats.size),
          mtimeNs: rootStats.mtimeNs.toString(),
          ctimeNs: rootStats.ctimeNs.toString(),
        }),
      }),
    );
    entryCount = 1;
    for (let index = 0; index < heldDirectories.length; index += 1) {
      const held = heldDirectories[index];
      const remainingEntries = Math.max(1, maximumEntries - entryCount);
      const remainingNameBytes = Math.max(
        1,
        maximumEncodedNameBytes - encodedNameBytes,
      );
      const remainingBytes = Math.max(
        1,
        maximumAggregateBytes - aggregateBytes,
      );
      const batchLimits = Object.freeze({
        ...OUTCOME_REPAIR_TREE_BATCH_LIMITS,
        maxEntries: Math.min(
          OUTCOME_REPAIR_TREE_BATCH_LIMITS.maxEntries,
          remainingEntries,
        ),
        maxSelectedEntries: Math.min(
          OUTCOME_REPAIR_TREE_BATCH_LIMITS.maxSelectedEntries,
          remainingEntries,
        ),
        maxEncodedNameBytes: Math.min(
          OUTCOME_REPAIR_TREE_BATCH_LIMITS.maxEncodedNameBytes,
          remainingNameBytes,
        ),
        maxFileBytes: Math.min(
          OUTCOME_REPAIR_TREE_BATCH_LIMITS.maxFileBytes,
          remainingBytes,
        ),
        maxTotalBytes: Math.min(
          OUTCOME_REPAIR_TREE_BATCH_LIMITS.maxTotalBytes,
          remainingBytes,
        ),
        maxSelectedBytes: Math.min(
          OUTCOME_REPAIR_TREE_BATCH_LIMITS.maxSelectedBytes,
          remainingBytes,
        ),
        maxChunkSelectedBytes: Math.min(
          OUTCOME_REPAIR_TREE_BATCH_LIMITS.maxChunkSelectedBytes,
          remainingBytes,
        ),
      });
      const { names, expectedDirectories } =
        automationPlanningTreeDirectoryNames(
          state.helper,
          held.directory,
          label,
          remainingEntries,
        );
      const inventory = admitPrivateBatchInventory(
        state.helper,
        held.directory,
        "private-file-batch-read-allow-empty",
        expectedDirectories,
        batchLimits,
      );
      for (const entry of inventory.entries) {
        if (entry.kind !== "file") continue;
        const relativePath = held.relativePath
          ? path.join(held.relativePath, entry.name)
          : entry.name;
        requireAutomationPlanningRepairTreeFileMode(relativePath, entry);
      }
      const projectedEntryCount = entryCount + inventory.entries.length;
      const projectedEncodedNameBytes =
        encodedNameBytes +
        inventory.entries.reduce((total, entry) => {
          const relativePath = held.relativePath
            ? path.join(held.relativePath, entry.name)
            : entry.name;
          return total + Buffer.byteLength(relativePath, "utf8");
        }, 0);
      const projectedAggregateBytes =
        aggregateBytes +
        inventory.entries.reduce(
          (total, entry) =>
            total + (entry.kind === "file" ? Number(entry.size) : 0),
          0,
        );
      if (
        projectedEntryCount > maximumEntries ||
        projectedEncodedNameBytes > maximumEncodedNameBytes ||
        projectedAggregateBytes > maximumAggregateBytes
      ) {
        failBudget(
          "Outcome ledger repair tree exceeds its remaining aggregate boundary.",
        );
      }
      const selectedNames = inventory.entries
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.name);
      const selections = [];
      readPrivateBatchSelection(
        state.helper,
        held.directory,
        "private-file-batch-read-allow-empty",
        inventory,
        selectedNames,
        {
          expectedDirectoryNames: expectedDirectories,
          limits: batchLimits,
          onEntry: (entry) => selections.push(entry),
        },
      );
      const selectionByName = new Map(
        selections.map((selection) => [selection.name, selection]),
      );
      held.inventory = inventory;
      held.expectedDirectories = expectedDirectories;
      held.selectedNames = Object.freeze([...selectedNames]);
      held.selections = Object.freeze(selections);
      for (const entry of inventory.entries) {
        const relativePath = held.relativePath
          ? path.join(held.relativePath, entry.name)
          : entry.name;
        entryCount += 1;
        encodedNameBytes += Buffer.byteLength(relativePath, "utf8");
        if (
          entryCount > maximumEntries ||
          encodedNameBytes > maximumEncodedNameBytes
        ) {
          failBudget(
            "Outcome ledger repair tree exceeds its aggregate entry or name boundary.",
          );
        }
        if (entry.kind === "directory") {
          assertPinnedLeaseArchiveDirectory(held.directory);
          const child = openPinnedLeaseArchiveDirectory(
            path.join(held.directory.path, entry.name),
            label,
          );
          try {
            automationPlanningTreeDirectoryIdentity(child, entry, label);
            assertPinnedLeaseArchiveDirectory(held.directory);
          } catch (error) {
            closeSync(child.descriptor);
            throw error;
          }
          heldDirectories.push({
            directory: child,
            relativePath,
            inventory: null,
            expectedDirectories: Object.freeze([]),
            selectedNames: Object.freeze([]),
            selections: Object.freeze([]),
          });
          entries.push(
            Object.freeze({
              relativePath,
              kind: "directory",
              identity: planningTreePublicIdentity(entry),
            }),
          );
          continue;
        }
        const selection = selectionByName.get(entry.name);
        if (selection === undefined || selection.bytes === null) {
          throw new AutomationControlError(
            "control_event_history_invalid",
            "Outcome ledger repair tree omitted one admitted file generation.",
          );
        }
        aggregateBytes += selection.bytes.length;
        if (aggregateBytes > maximumAggregateBytes) {
          failBudget(
            "Outcome ledger repair tree exceeds its aggregate byte boundary.",
          );
        }
        entries.push(
          Object.freeze({
            relativePath,
            kind: "file",
            identity: planningTreePublicIdentity(entry),
            digest: selection.digest,
            bytes: selection.bytes,
          }),
        );
      }
      if (
        names.join("\0") !==
        inventory.entries.map((entry) => entry.name).join("\0")
      ) {
        throw new AutomationControlError(
          "authority_generation_conflict",
          "Outcome ledger repair tree names changed during admission.",
        );
      }
    }
    if (
      state.repairAdmissionCount + entryCount > 4_096 ||
      state.repairEncodedNameBytes + encodedNameBytes > 16 * 1024 * 1024 ||
      state.repairAggregateBytes + aggregateBytes > 128 * 1024 * 1024
    ) {
      failBudget(
        "Outcome ledger repair admissions exceed their aggregate boundary.",
      );
    }
    const digestMaterial = entries.map((entry) => ({
      relativePath: entry.relativePath,
      kind: entry.kind,
      identity: entry.identity,
      ...(entry.kind === "file"
        ? { digest: entry.digest, size: entry.bytes.length }
        : {}),
    }));
    const treeDigest = digestBytes(
      Buffer.from(`${JSON.stringify(digestMaterial)}\n`, "utf8"),
    );
    const token = createAutomationPlanningAdmissionToken({
      kind: "outcome-repair-tree",
      name: relative,
      filePath: directoryPath,
      missing: false,
      digest: treeDigest,
      size: aggregateBytes,
    });
    const admission = {
      token,
      directoryPath,
      rootParent,
      entryCount,
      encodedNameBytes,
      aggregateBytes,
      entries: Object.freeze(entries),
      heldDirectories: Object.freeze(heldDirectories),
    };
    state.repairAdmissionCount += entryCount;
    state.repairEncodedNameBytes += encodedNameBytes;
    state.repairAggregateBytes += aggregateBytes;
    state.treeAdmissions.push(admission);
    AUTOMATION_PLANNING_READ_ADMISSION_OWNERS.set(token, bundle);
    AUTOMATION_PLANNING_READ_ADMISSION_STATES.set(token, {
      kind: "tree",
      admission,
    });
    return token;
  } catch (error) {
    state.repairAdmissionExhausted = true;
    for (const held of heldDirectories.reverse()) {
      for (const selection of held.selections) selection.bytes?.fill(0);
      closeSync(held.directory.descriptor);
    }
    throw error;
  }
}

function requireAutomationPlanningRepairTreeAdmissionsUnchanged(state) {
  for (const admission of state.treeAdmissions) {
    requirePinnedLeaseArchiveDirectoryChild(
      state.helper,
      admission.rootParent.directory,
      admission.heldDirectories[0].directory,
      "Outcome ledger repair artifact tree",
    );
    for (const held of admission.heldDirectories) {
      assertPinnedLeaseArchiveDirectory(held.directory);
      const selectedAgain = [];
      readPrivateBatchSelection(
        state.helper,
        held.directory,
        "private-file-batch-read-allow-empty",
        held.inventory,
        held.selectedNames,
        {
          expectedDirectoryNames: held.expectedDirectories,
          limits: OUTCOME_REPAIR_TREE_BATCH_LIMITS,
          onEntry: (entry) => selectedAgain.push(entry),
        },
      );
      if (
        selectedAgain.length !== held.selections.length ||
        selectedAgain.some(
          (entry, index) =>
            entry.name !== held.selections[index].name ||
            entry.digest !== held.selections[index].digest ||
            !entry.bytes.equals(held.selections[index].bytes),
        )
      ) {
        throw new AutomationControlError(
          "authority_generation_conflict",
          "Outcome ledger repair tree selections changed during planning.",
        );
      }
      for (const entry of selectedAgain) entry.bytes.fill(0);
      requirePrivateBatchInventoryUnchanged(
        state.helper,
        held.directory,
        "private-file-batch-read-allow-empty",
        held.inventory,
        held.expectedDirectories,
        OUTCOME_REPAIR_TREE_BATCH_LIMITS,
      );
      assertPinnedLeaseArchiveDirectory(held.directory);
    }
  }
}

function requireExactAutomationPlanningSnapshot(filePath, snapshot, options) {
  const current = readAutomationAuthorityFileSnapshotInternal(
    filePath,
    options,
  );
  if (!automationAuthoritySnapshotMatches(current, snapshot)) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${options.label} changed during the coherent planning read.`,
    );
  }
}

function requireAutomationPlanningReadFileAdmissionsUnchanged(state) {
  for (const admission of state.fileAdmissions) {
    if (admission.terminal.kind === "snapshot") {
      requireExactAutomationPlanningSnapshot(
        admission.snapshot.filePath,
        admission.snapshot,
        admission.terminal.options,
      );
      continue;
    }
  }
  for (const proof of state.missingParentInventories.values()) {
    requirePrivateBatchInventoryUnchanged(
      state.helper,
      proof.directory,
      "private-file-batch-read-allow-empty",
      proof.inventory,
      proof.expectedDirectories,
      OUTCOME_REPAIR_TREE_BATCH_LIMITS,
    );
    if (
      [...proof.missingFirstSegments].some((segment) =>
        proof.names.includes(segment),
      )
    ) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        "Automation planning missing descendant appeared during validation.",
      );
    }
  }
}

export function requireAutomationPlanningReadBundle(
  bundle,
  { admission = undefined } = {},
) {
  if (
    !bundle ||
    typeof bundle !== "object" ||
    !AUTOMATION_PLANNING_READ_BUNDLES.has(bundle) ||
    !ACTIVE_AUTOMATION_PLANNING_READ_BUNDLES.has(bundle)
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Automation planning validation requires its active coherent read bundle.",
    );
  }
  if (
    admission !== undefined &&
    AUTOMATION_PLANNING_READ_ADMISSION_OWNERS.get(admission) !== bundle
  ) {
    throw new AutomationControlError(
      "invalid_state",
      "Automation planning validation requires an admission from the same coherent read bundle.",
    );
  }
  return bundle;
}

export function readAutomationPlanningAdmission(bundle, admission) {
  requireAutomationPlanningReadBundle(bundle, { admission });
  const state = AUTOMATION_PLANNING_READ_ADMISSION_STATES.get(admission);
  if (state === undefined) {
    throw new AutomationControlError(
      "invalid_state",
      "Automation planning admission is unavailable outside its active bundle.",
    );
  }
  if (state.kind === "tree") {
    return Object.freeze({
      kind: admission.kind,
      name: admission.name,
      filePath: admission.filePath,
      missing: false,
      digest: admission.digest,
      size: admission.size,
      entryCount: state.admission.entryCount,
      encodedNameBytes: state.admission.encodedNameBytes,
      entries: Object.freeze(
        state.admission.entries.map((entry) =>
          Object.freeze({
            relativePath: entry.relativePath,
            kind: entry.kind,
            identity: entry.identity,
            ...(entry.kind === "file"
              ? {
                  digest: entry.digest,
                  bytesBase64: entry.bytes.toString("base64"),
                }
              : {}),
          }),
        ),
      ),
    });
  }
  const snapshot = state.snapshot;
  const bytes = snapshot.bytes;
  let text;
  try {
    text = privateAuthorityDecoder.decode(bytes);
  } catch {
    throw new AutomationControlError(
      "invalid_state",
      "Automation planning admission is not valid UTF-8.",
    );
  }
  const identity =
    state.kind === "snapshot"
      ? automationPlanningSnapshotIdentity(snapshot)
      : automationPlanningSelectionIdentity(snapshot);
  return Object.freeze({
    kind: admission.kind,
    name: admission.name,
    filePath: admission.filePath,
    missing: admission.missing,
    digest: admission.digest,
    size: admission.size,
    text,
    bytesBase64: bytes.toString("base64"),
    identity,
  });
}

export function withAutomationPlanningReadBundle(
  {
    stateRoot,
    ledgerPath = automationControlPaths(stateRoot).outcomes,
    nowMs = Date.now(),
    writerGuardContext = null,
  },
  callback,
) {
  if (typeof callback !== "function") {
    throw new AutomationControlError(
      "invalid_argument",
      "Automation planning read requires a synchronous callback.",
    );
  }
  const paths = automationControlPaths(stateRoot);
  if (path.resolve(ledgerPath) !== paths.outcomes) {
    throw new AutomationControlError(
      "invalid_argument",
      `Automation planning read requires ${paths.outcomes}.`,
    );
  }
  requireOutsideAutomationPlanningReadScope(
    paths.stateRoot,
    "Automation planning read",
  );
  const readUnderWriterGuard = () =>
    withFilesystemGuard(
      paths,
      "tasks",
      () => {
        if (writerGuardContext === null) {
          recoverTaskTransactionsUnlocked(paths, nowMs);
        }
        return withFilesystemGuard(
          paths,
          "events",
          () => {
            const helper = openPinnedLeaseArchiveHelper();
            const stateDirectory = openPinnedLeaseArchiveDirectory(
              paths.stateRoot,
              "Automation planning state root",
            );
            let controlDirectory;
            let stateNames;
            let controlNames;
            let taskTransactions;
            let taskManifestAdmission;
            let eventHistorySnapshot;
            let ledgerSnapshot;
            let outcomeControlHistory;
            let taskManifestHistory;
            let leaseTransactionHistory;
            try {
              controlDirectory = openPinnedLeaseArchiveDirectory(
                paths.controlRoot,
                "Automation planning control root",
              );
              stateNames = automationPlanningReadNames(
                helper,
                stateDirectory,
                "Automation planning state root",
              );
              controlNames = automationPlanningReadNames(
                helper,
                controlDirectory,
                "Automation planning control root",
              );
              taskTransactions = admitSettledTaskTransactionInventory(
                paths,
                helper,
                controlNames,
              );
              taskManifestAdmission = readTaskManifestSnapshotUnchecked({
                stateRoot: paths.stateRoot,
                nowMs,
                internalCapability: AUTOMATION_PLANNING_READ_INTERNAL,
              });
              eventHistorySnapshot = readControlEventHistorySnapshot(
                paths.events,
                AUTOMATION_PLANNING_READ_INTERNAL,
              );
              ledgerSnapshot = readAutomationAuthorityFileSnapshotInternal(
                paths.outcomes,
                {
                  allowMissing: true,
                  allowEmpty: true,
                  privateRoot: paths.stateRoot,
                  maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
                  allowedModes: [0o600, 0o640, 0o644],
                  label: "Outcome ledger",
                },
              );
              outcomeControlHistory = inspectExactOutcomeControlHistory(
                eventHistorySnapshot.events,
                { ledgerPath: paths.outcomes, stateRoot: paths.stateRoot },
              );
              taskManifestHistory = inspectExactTaskManifestHistoryParity(
                eventHistorySnapshot.events,
                taskManifestAdmission.manifest,
              );
              try {
                leaseTransactionHistory =
                  inspectLeaseTransactionEventHistoryForPlanning(
                    paths,
                    eventHistorySnapshot.events,
                  );
              } catch (error) {
                leaseTransactionHistory = Object.freeze({
                  healthy: false,
                  issues: Object.freeze([
                    error instanceof Error ? error.message : String(error),
                  ]),
                  retainedReceiptCount: 0,
                  pendingTransactionArtifactCount: 0,
                });
              }
            } catch (error) {
              if (taskTransactions?.internal != null) {
                closeSync(taskTransactions.internal.directory.descriptor);
              }
              if (controlDirectory !== undefined) {
                closeSync(controlDirectory.descriptor);
              }
              closeSync(stateDirectory.descriptor);
              throw error;
            }
            let repairTransactions;
            try {
              repairTransactions = admitOutcomeRepairTransactionInventory(
                paths,
                helper,
                controlNames,
              );
            } catch (error) {
              if (taskTransactions.internal !== null) {
                closeSync(taskTransactions.internal.directory.descriptor);
              }
              closeSync(controlDirectory.descriptor);
              closeSync(stateDirectory.descriptor);
              throw error;
            }
            const state = {
              paths,
              helper,
              stateDirectory,
              controlDirectory,
              stateNames,
              controlNames,
              taskTransactions: taskTransactions.internal,
              repairTransactions: repairTransactions.internal,
              fileAdmissions: [],
              treeAdmissions: [],
              repairTreeAncestorBindings: new Map([
                [
                  paths.stateRoot,
                  Object.freeze({
                    directory: stateDirectory,
                    owned: false,
                    parentPath: null,
                  }),
                ],
                [
                  paths.controlRoot,
                  Object.freeze({
                    directory: controlDirectory,
                    owned: false,
                    parentPath: paths.stateRoot,
                  }),
                ],
              ]),
              missingParentInventories: new Map(),
              repairAdmissionExhausted: false,
              repairAdmissionCount: repairTransactions.public.selectionCount,
              repairEncodedNameBytes:
                repairTransactions.public.encodedNameBytes,
              repairAggregateBytes:
                repairTransactions.public.aggregateSelectedBytes,
            };
            const repairTransactionAdmissionTokens = Object.freeze(
              (repairTransactions.internal?.selections ?? []).map((selection) =>
                createAutomationPlanningAdmissionToken({
                  kind: "outcome-repair-transaction",
                  name: selection.name,
                  filePath: path.join(
                    repairTransactions.public.directoryPath,
                    selection.name,
                  ),
                  missing: false,
                  digest: selection.digest,
                  size: Number(selection.size),
                }),
              ),
            );
            let bundle;
            const admitFile = (options) =>
              admitAutomationPlanningReadFile(bundle, options);
            const admitTree = (options) =>
              admitAutomationPlanningRepairTree(bundle, options);
            bundle = Object.freeze({
              schemaVersion: 1,
              stateRoot: paths.stateRoot,
              stateRootNames: Object.freeze([...stateNames]),
              ledgerPath: paths.outcomes,
              taskManifest: cloneAutomationPlanningPlainValue(
                taskManifestAdmission.manifest,
              ),
              taskManifestSnapshot: Object.freeze({
                missing: taskManifestAdmission.snapshot.missing,
                text: privateAuthorityDecoder.decode(
                  taskManifestAdmission.snapshot.bytes,
                ),
                digest: digestBytes(taskManifestAdmission.snapshot.bytes),
                size: taskManifestAdmission.snapshot.bytes.length,
                identity: automationPlanningSnapshotIdentity(
                  taskManifestAdmission.snapshot,
                ),
                directoryIdentity: automationPlanningDirectoryIdentity(
                  taskManifestAdmission.snapshot,
                ),
              }),
              controlEvents: cloneAutomationPlanningPlainValue(
                eventHistorySnapshot.events,
              ),
              controlEventHistory: Object.freeze({
                missing: eventHistorySnapshot.missing,
                text: privateAuthorityDecoder.decode(
                  eventHistorySnapshot.bytes,
                ),
                digest: digestBytes(eventHistorySnapshot.bytes),
                size: eventHistorySnapshot.bytes.length,
                identity:
                  automationPlanningSnapshotIdentity(eventHistorySnapshot),
                directoryIdentity:
                  automationPlanningDirectoryIdentity(eventHistorySnapshot),
              }),
              controlEventRecordCount: eventHistorySnapshot.recordCount,
              outcomeLedger: Object.freeze({
                missing: ledgerSnapshot.missing,
                text: privateAuthorityDecoder.decode(ledgerSnapshot.bytes),
                digest: digestBytes(ledgerSnapshot.bytes),
                size: ledgerSnapshot.bytes.length,
                identity: automationPlanningSnapshotIdentity(ledgerSnapshot),
                directoryIdentity:
                  automationPlanningDirectoryIdentity(ledgerSnapshot),
              }),
              outcomeControlHistory: cloneAutomationPlanningPlainValue({
                healthy: outcomeControlHistory.healthy,
                issues: outcomeControlHistory.issues,
                ownerLeaseLineageHealthy:
                  outcomeControlHistory.ownerLeaseLineageHealthy,
                ownerLeaseLineageByRecordIndex: Object.fromEntries(
                  outcomeControlHistory.ownerLeaseLineageByRecordIndex,
                ),
              }),
              outcomeRepairEventsById: cloneAutomationPlanningPlainValue(
                Object.fromEntries(
                  outcomeControlHistory.outcomeLedgerRepairEventsById,
                ),
              ),
              taskManifestHistory: cloneAutomationPlanningPlainValue({
                healthy: taskManifestHistory.healthy,
                issues: taskManifestHistory.issues,
              }),
              leaseTransactionHistory: cloneAutomationPlanningPlainValue(
                leaseTransactionHistory,
              ),
              taskTransactions: taskTransactions.public,
              outcomeRepairTransactions: Object.freeze({
                ...repairTransactions.public,
                admissions: repairTransactionAdmissionTokens,
              }),
              admitFile,
              admitTree,
            });
            AUTOMATION_PLANNING_READ_BUNDLES.add(bundle);
            AUTOMATION_PLANNING_READ_BUNDLE_STATES.set(bundle, state);
            for (const [
              index,
              admission,
            ] of repairTransactionAdmissionTokens.entries()) {
              AUTOMATION_PLANNING_READ_ADMISSION_OWNERS.set(admission, bundle);
              AUTOMATION_PLANNING_READ_ADMISSION_STATES.set(admission, {
                kind: "selection",
                snapshot: repairTransactions.internal.selections[index],
              });
            }
            ACTIVE_AUTOMATION_PLANNING_READ_BUNDLES.add(bundle);
            ACTIVE_AUTOMATION_PLANNING_READ_ROOTS.add(paths.stateRoot);
            let result;
            try {
              result = callback(bundle);
              if (result && typeof result.then === "function") {
                throw new AutomationControlError(
                  "invalid_argument",
                  "Automation planning read callbacks must be synchronous.",
                );
              }
              const clonedResult = cloneAutomationPlanningPlainValue(result);
              requireAutomationPlanningReadFileAdmissionsUnchanged(state);
              requireAutomationPlanningRepairAncestorsUnchanged(state);
              requireAutomationPlanningRepairTreeAdmissionsUnchanged(state);
              requireExactAutomationPlanningSnapshot(
                paths.outcomes,
                ledgerSnapshot,
                {
                  allowMissing: true,
                  allowEmpty: true,
                  privateRoot: paths.stateRoot,
                  maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
                  allowedModes: [0o600, 0o640, 0o644],
                  label: "Outcome ledger",
                },
              );
              requireExactAutomationPlanningSnapshot(
                paths.events,
                eventHistorySnapshot,
                {
                  allowMissing: true,
                  allowEmpty: true,
                  privateRoot: paths.controlRoot,
                  maxBytes: CONTROL_EVENT_HISTORY_MAX_BYTES,
                  allowedModes: [0o600],
                  label: "Control event history",
                },
              );
              requireExactAutomationPlanningSnapshot(
                paths.taskManifest,
                taskManifestAdmission.snapshot,
                {
                  allowMissing: true,
                  allowEmpty: true,
                  privateRoot: paths.controlRoot,
                  maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
                  allowedModes: [0o600],
                  label: "Current task manifest",
                },
              );
              if (state.repairTransactions !== null) {
                const selectedAgain = [];
                readPrivateBatchSelection(
                  helper,
                  state.repairTransactions.directory,
                  "private-file-batch-read",
                  state.repairTransactions.inventory,
                  state.repairTransactions.selectedNames,
                  {
                    expectedDirectoryNames:
                      state.repairTransactions.expectedDirectories,
                    limits: OUTCOME_REPAIR_TRANSACTION_BATCH_LIMITS,
                    onEntry: (entry) => selectedAgain.push(entry),
                  },
                );
                if (
                  selectedAgain.length !==
                    state.repairTransactions.selections.length ||
                  selectedAgain.some(
                    (entry, index) =>
                      entry.name !==
                        state.repairTransactions.selections[index].name ||
                      entry.digest !==
                        state.repairTransactions.selections[index].digest ||
                      !entry.bytes.equals(
                        state.repairTransactions.selections[index].bytes,
                      ),
                  )
                ) {
                  throw new AutomationControlError(
                    "authority_generation_conflict",
                    "Outcome ledger repair transaction selections changed during planning.",
                  );
                }
                requirePrivateBatchInventoryUnchanged(
                  helper,
                  state.repairTransactions.directory,
                  "private-file-batch-read",
                  state.repairTransactions.inventory,
                  state.repairTransactions.expectedDirectories,
                  OUTCOME_REPAIR_TRANSACTION_BATCH_LIMITS,
                );
              }
              if (state.taskTransactions !== null) {
                requirePrivateBatchInventoryUnchanged(
                  helper,
                  state.taskTransactions.directory,
                  "private-file-batch-read",
                  state.taskTransactions.inventory,
                  state.taskTransactions.expectedDirectories,
                );
              }
              requireAutomationPlanningReadNamesUnchanged(
                helper,
                controlDirectory,
                controlNames,
                "Automation planning control root",
              );
              requireAutomationPlanningReadNamesUnchanged(
                helper,
                stateDirectory,
                stateNames,
                "Automation planning state root",
              );
              return clonedResult;
            } finally {
              ACTIVE_AUTOMATION_PLANNING_READ_BUNDLES.delete(bundle);
              ACTIVE_AUTOMATION_PLANNING_READ_ROOTS.delete(paths.stateRoot);
              AUTOMATION_PLANNING_READ_BUNDLE_STATES.delete(bundle);
              for (const admission of repairTransactionAdmissionTokens) {
                AUTOMATION_PLANNING_READ_ADMISSION_STATES.delete(admission);
                AUTOMATION_PLANNING_READ_ADMISSION_OWNERS.delete(admission);
              }
              for (const admission of state.fileAdmissions) {
                AUTOMATION_PLANNING_READ_ADMISSION_STATES.delete(
                  admission.token,
                );
                AUTOMATION_PLANNING_READ_ADMISSION_OWNERS.delete(
                  admission.token,
                );
                admission.snapshot.bytes.fill(0);
              }
              for (const admission of state.treeAdmissions) {
                AUTOMATION_PLANNING_READ_ADMISSION_STATES.delete(
                  admission.token,
                );
                AUTOMATION_PLANNING_READ_ADMISSION_OWNERS.delete(
                  admission.token,
                );
                for (const held of [...admission.heldDirectories].reverse()) {
                  for (const selection of held.selections) {
                    selection.bytes?.fill(0);
                  }
                  closeSync(held.directory.descriptor);
                }
              }
              for (const binding of [
                ...state.repairTreeAncestorBindings.values(),
              ].reverse()) {
                if (binding.owned) {
                  closeSync(binding.directory.descriptor);
                }
              }
              if (state.repairTransactions !== null) {
                for (const selection of state.repairTransactions.selections) {
                  selection.bytes.fill(0);
                }
                closeSync(state.repairTransactions.directory.descriptor);
              }
              if (state.taskTransactions !== null) {
                closeSync(state.taskTransactions.directory.descriptor);
              }
              closeSync(controlDirectory.descriptor);
              closeSync(stateDirectory.descriptor);
            }
          },
          { now: () => nowMs },
        );
      },
      { now: () => nowMs },
    );
  if (writerGuardContext !== null) {
    if (
      !ACTIVE_OUTCOME_LEDGER_WRITER_CONTEXTS.has(writerGuardContext) ||
      writerGuardContext.stateRoot !== paths.stateRoot ||
      writerGuardContext.ledgerPath !== paths.outcomes
    ) {
      throw new AutomationControlError(
        "invalid_state",
        "Automation planning read requires its active same-root outcome writer context.",
      );
    }
    writerGuardContext.requireActive();
    return readUnderWriterGuard();
  }
  return withAutomationOutcomeLedgerWriterGuard(
    paths.outcomes,
    readUnderWriterGuard,
    { stateRoot: paths.stateRoot },
  );
}

const AUTHORITY_FILE_IDENTITY_RECEIPT_FIELDS = Object.freeze([
  "Device",
  "Inode",
  "Mode",
  "LinkCount",
  "Uid",
  "Gid",
  "Size",
  "MtimeNs",
  "CtimeNs",
  "Digest",
]);
const AUTHORITY_PARENT_IDENTITY_RECEIPT_FIELDS = Object.freeze([
  "Device",
  "Inode",
  "Mode",
  "Uid",
]);
const AUTHORITY_INVENTORY_PARENT_RECEIPT_FIELDS = Object.freeze([
  ...AUTHORITY_PARENT_IDENTITY_RECEIPT_FIELDS,
  "Gid",
  "LinkCount",
  "Size",
  "MtimeNs",
  "CtimeNs",
]);

function automationAuthorityAllowedModesArgument(allowedModes, label) {
  const supported = [0o600, 0o640, 0o644];
  const requested = new Set(allowedModes.map((mode) => Number(mode)));
  if (
    requested.size === 0 ||
    [...requested].some((mode) => !supported.includes(mode))
  ) {
    throw new AutomationControlError(
      "invalid_argument",
      `${label} has an unsupported file mode allowlist.`,
    );
  }
  return supported
    .filter((mode) => requested.has(mode))
    .map(String)
    .join(",");
}

function automationAuthorityInventoryParentReceipt(directory) {
  const stats = fstatSync(directory.descriptor, { bigint: true });
  return Object.freeze({
    parentDevice: stats.dev.toString(),
    parentInode: stats.ino.toString(),
    parentMode: Number(stats.mode & 0o7777n).toString(),
    parentUid: stats.uid.toString(),
    parentGid: stats.gid.toString(),
    parentLinkCount: stats.nlink.toString(),
    parentSize: stats.size.toString(),
    parentMtimeNs: stats.mtimeNs.toString(),
    parentCtimeNs: stats.ctimeNs.toString(),
  });
}

function parseAutomationAuthorityEntryInventory(
  result,
  { name, allowedModesArgument, allowMissing, allowEmpty, maxBytes, directory },
  label,
) {
  let receipt;
  try {
    receipt = JSON.parse(result.toString("utf8"));
  } catch {
    receipt = null;
  }
  const missing = receipt?.missing;
  const expectedKeys = [
    "protocol",
    "operation",
    "name",
    "missing",
    "requestedAllowedModes",
    "requestedAllowMissing",
    "requestedAllowEmpty",
    "requestedMaxFileBytes",
    ...AUTHORITY_INVENTORY_PARENT_RECEIPT_FIELDS.map(
      (field) => `parent${field}`,
    ),
    ...(missing === false
      ? AUTHORITY_FILE_IDENTITY_RECEIPT_FIELDS.map((field) => `entry${field}`)
      : []),
  ].sort();
  if (
    Object.keys(receipt ?? {})
      .sort()
      .join("\n") !== expectedKeys.join("\n") ||
    receipt.protocol !== AUTHORITY_FILE_OPERATION_PROTOCOL ||
    receipt.operation !== "authority-entry-inventory" ||
    receipt.name !== name ||
    (missing !== true && missing !== false) ||
    receipt.requestedAllowedModes !== allowedModesArgument ||
    receipt.requestedAllowMissing !== allowMissing ||
    receipt.requestedAllowEmpty !== allowEmpty ||
    receipt.requestedMaxFileBytes !== String(maxBytes)
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} returned an inexact descriptor inventory receipt.`,
    );
  }
  const expectedParent = automationAuthorityInventoryParentReceipt(directory);
  if (
    Object.entries(expectedParent).some(
      ([key, value]) => receipt[key] !== value,
    )
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} returned an inexact descriptor inventory parent.`,
    );
  }
  let entry = null;
  if (!missing) {
    entry = Object.freeze({
      dev: receipt.entryDevice,
      ino: receipt.entryInode,
      mode: receipt.entryMode,
      nlink: receipt.entryLinkCount,
      uid: receipt.entryUid,
      gid: receipt.entryGid,
      size: receipt.entrySize,
      mtimeNs: receipt.entryMtimeNs,
      ctimeNs: receipt.entryCtimeNs,
      digest: receipt.entryDigest,
    });
    if (
      !/^[0-9a-f]{64}$/.test(entry.digest) ||
      [
        entry.dev,
        entry.ino,
        entry.mode,
        entry.nlink,
        entry.uid,
        entry.gid,
        entry.size,
        entry.mtimeNs,
        entry.ctimeNs,
      ].some((value) => !/^\d+$/.test(String(value))) ||
      !allowedModesArgument.split(",").includes(entry.mode) ||
      entry.nlink !== "1" ||
      BigInt(entry.size) > BigInt(maxBytes) ||
      (!allowEmpty && entry.size === "0")
    ) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} returned an unsafe descriptor inventory generation.`,
      );
    }
  }
  return Object.freeze({
    name,
    missing,
    parent: expectedParent,
    entry,
    digest: entry?.digest ?? null,
  });
}

function readAutomationAuthorityEntryInventory(
  helper,
  directory,
  name,
  {
    allowMissing,
    allowEmpty,
    maxBytes,
    allowedModes,
    label,
    invalidCode = "authority_generation_conflict",
  },
  helperTestPause = undefined,
) {
  const allowedModesArgument = automationAuthorityAllowedModesArgument(
    allowedModes,
    label,
  );
  assertPinnedLeaseArchiveDirectory(directory);
  let result;
  try {
    result = runLeaseArchiveHelper(
      helper,
      "authority-entry-inventory",
      [
        name,
        allowedModesArgument,
        allowMissing ? "1" : "0",
        allowEmpty ? "1" : "0",
        String(maxBytes),
        ...automationAuthorityParentIdentityArguments(directory),
      ],
      [directory.descriptor],
      undefined,
      helperTestPause,
    );
  } catch (error) {
    if (error instanceof AutomationControlError) {
      throw new AutomationControlError(
        invalidCode,
        `${label} could not be admitted safely.`,
        {
          cause: String(error.details?.cause ?? error.message).slice(0, 1_024),
        },
      );
    }
    throw error;
  }
  assertPinnedLeaseArchiveDirectory(directory);
  return parseAutomationAuthorityEntryInventory(
    result,
    {
      name,
      allowedModesArgument,
      allowMissing,
      allowEmpty,
      maxBytes,
      directory,
    },
    label,
  );
}

function requireAutomationAuthorityEntryInventoryMatch(left, right, label) {
  if (
    left.name !== right.name ||
    left.missing !== right.missing ||
    JSON.stringify(left.parent) !== JSON.stringify(right.parent) ||
    JSON.stringify(left.entry) !== JSON.stringify(right.entry)
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} changed across its descriptor-bound read.`,
    );
  }
}

function automationAuthorityInventoryMatchesStats(inventory, stats) {
  const entry = inventory?.entry;
  return (
    entry !== null &&
    stats.isFile() &&
    !stats.isSymbolicLink() &&
    stats.dev.toString() === entry.dev &&
    stats.ino.toString() === entry.ino &&
    Number(stats.mode & 0o7777n).toString() === entry.mode &&
    stats.nlink.toString() === entry.nlink &&
    stats.uid.toString() === entry.uid &&
    stats.gid.toString() === entry.gid &&
    stats.size.toString() === entry.size &&
    stats.mtimeNs.toString() === entry.mtimeNs &&
    stats.ctimeNs.toString() === entry.ctimeNs
  );
}

function automationAuthorityStableGenerationMatches(left, right) {
  return (
    left !== null &&
    right !== null &&
    !left.missing &&
    !right.missing &&
    left.bytes.equals(right.bytes) &&
    String(left.identity.dev) === String(right.identity.dev) &&
    String(left.identity.ino) === String(right.identity.ino) &&
    Number(left.identity.mode) === Number(right.identity.mode) &&
    Number(left.identity.nlink) === Number(right.identity.nlink) &&
    Number(left.identity.uid) === Number(right.identity.uid) &&
    Number(left.identity.gid) === Number(right.identity.gid) &&
    Number(left.identity.size) === Number(right.identity.size) &&
    String(left.identity.mtimeNs) === String(right.identity.mtimeNs) &&
    BigInt(left.identity.ctimeNs) >= BigInt(right.identity.ctimeNs)
  );
}

function automationAuthoritySameInode(left, right) {
  return (
    left !== null &&
    right !== null &&
    !left.missing &&
    !right.missing &&
    String(left.identity.dev) === String(right.identity.dev) &&
    String(left.identity.ino) === String(right.identity.ino) &&
    Number(left.identity.nlink) === 1 &&
    Number(right.identity.nlink) === 1 &&
    Number(left.identity.uid) === Number(right.identity.uid) &&
    Number(left.identity.gid) === Number(right.identity.gid)
  );
}

function automationAuthoritySnapshotDescriptor(snapshot) {
  if (snapshot.missing) return Object.freeze({ missing: true });
  return Object.freeze({
    missing: false,
    dev: String(snapshot.identity.dev),
    ino: String(snapshot.identity.ino),
    mode: Number(snapshot.identity.mode),
    nlink: Number(snapshot.identity.nlink),
    uid: Number(snapshot.identity.uid),
    gid: Number(snapshot.identity.gid),
    size: Number(snapshot.identity.size),
    mtimeNs: String(snapshot.identity.mtimeNs),
    ctimeNs: String(snapshot.identity.ctimeNs),
    digest: digestBytes(snapshot.bytes),
  });
}

function automationAuthorityStableGenerationDescriptor(snapshot) {
  if (snapshot?.missing !== false) return null;
  return Object.freeze({
    dev: String(snapshot.identity.dev),
    ino: String(snapshot.identity.ino),
    mode: Number(snapshot.identity.mode) & 0o7777,
    nlink: Number(snapshot.identity.nlink),
    uid: Number(snapshot.identity.uid),
    gid: Number(snapshot.identity.gid),
    size: Number(snapshot.identity.size),
    mtimeNs: String(snapshot.identity.mtimeNs),
    digest: digestBytes(snapshot.bytes),
  });
}

function automationAuthorityStableGenerationDigest(snapshot) {
  const descriptor = automationAuthorityStableGenerationDescriptor(snapshot);
  if (descriptor === null) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      "A missing authority generation has no stable identity digest.",
    );
  }
  return canonicalLeaseRequestDigest(descriptor);
}

function automationAuthorityNamespace({
  filePath,
  operationId,
  proposedDigest,
  previousSnapshot,
}) {
  return canonicalLeaseRequestDigest({
    purpose: "automation-authority-file-publication-v3",
    filePath,
    operationId,
    proposedDigest,
    previous: automationAuthoritySnapshotDescriptor(previousSnapshot),
    parent: previousSnapshot.directoryIdentity,
  });
}

function automationAuthorityProvisionalStageName(filePath, namespaceDigest) {
  return `.${path.basename(filePath)}.authority.${namespaceDigest}.staging`;
}

function automationAuthorityReadyStageName(
  filePath,
  namespaceDigest,
  successorStableDigest,
) {
  return `.${path.basename(filePath)}.authority.${namespaceDigest}.${successorStableDigest}.tmp`;
}

function parseAutomationAuthorityStageName(filePath, entry) {
  const prefix = `.${path.basename(filePath)}.authority.`;
  if (!entry.startsWith(prefix)) return null;
  const suffix = entry.slice(prefix.length);
  const provisional = /^([0-9a-f]{64})\.staging$/.exec(suffix);
  if (provisional !== null) {
    return Object.freeze({
      entry,
      kind: "provisional",
      namespaceDigest: provisional[1],
      successorStableDigest: null,
    });
  }
  const ready = /^([0-9a-f]{64})\.([0-9a-f]{64})\.tmp$/.exec(suffix);
  if (ready === null) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `Automation authority staging entry ${entry} has an invalid operation name.`,
    );
  }
  return Object.freeze({
    entry,
    kind: "ready",
    namespaceDigest: ready[1],
    successorStableDigest: ready[2],
  });
}

function automationAuthorityFileIdentityArguments(binding) {
  const { identity } = binding;
  return [
    String(identity.dev),
    String(identity.ino),
    String(Number(identity.mode) & 0o7777),
    String(identity.nlink),
    String(identity.uid),
    String(identity.gid),
    String(identity.size),
    String(identity.mtimeNs),
    String(identity.ctimeNs),
    digestBytes(binding.snapshot.bytes),
  ];
}

function automationAuthorityParentIdentityArguments(binding) {
  return [
    binding.identity.dev.toString(),
    binding.identity.ino.toString(),
    Number(binding.identity.mode & 0o7777n).toString(),
    binding.identity.uid.toString(),
  ];
}

function openPinnedAutomationAuthorityFile(
  filePath,
  snapshot,
  label,
  { maxBytes, allowedModes, writable = false },
) {
  const normalizedModes = new Set(allowedModes.map((mode) => Number(mode)));
  let descriptor;
  try {
    descriptor = openSync(
      filePath,
      (writable ? constants.O_RDWR : constants.O_RDONLY) |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
    );
    const held = fstatSync(descriptor, { bigint: true });
    const current = lstatSync(filePath, { bigint: true });
    if (
      snapshot?.missing !== false ||
      snapshot.filePath !== path.resolve(filePath) ||
      !held.isFile() ||
      held.isSymbolicLink() ||
      held.uid !== BigInt(process.getuid()) ||
      held.nlink !== 1n ||
      held.size < 0n ||
      held.size > BigInt(maxBytes) ||
      !normalizedModes.has(Number(held.mode & 0o7777n)) ||
      !privateFileIdentityMatches(snapshot.identity, held) ||
      !privateFileIdentityMatches(held, current) ||
      realpathSync(filePath) !== path.resolve(filePath)
    ) {
      throw new Error("file generation changed during descriptor admission");
    }
    const bytes = readHeldPrivateFile(descriptor, Number(held.size));
    if (!snapshot.bytes.equals(bytes)) {
      throw new Error("file bytes changed during descriptor admission");
    }
    return Object.freeze({
      filePath: path.resolve(filePath),
      label,
      descriptor,
      identity: Object.freeze(privateFileIdentity(held)),
      snapshot,
    });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error instanceof AutomationControlError) throw error;
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} could not be pinned to one exact file generation.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function requireAutomationAuthorityDirectoryGeneration(
  directory,
  expectedIdentity,
  label,
) {
  assertPinnedLeaseArchiveDirectory(directory);
  if (
    !automationAuthorityDirectoryIdentityMatches(
      automationAuthorityDirectoryIdentity(directory.identity),
      expectedIdentity,
    )
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} changed from its admitted parent generation.`,
    );
  }
}

function requireAutomationAuthoritySnapshotDirectory(
  snapshot,
  directory,
  label,
) {
  assertPinnedLeaseArchiveDirectory(directory);
  if (
    !automationAuthorityDirectoryIdentityMatches(
      snapshot.directoryIdentity,
      automationAuthorityDirectoryIdentity(directory.identity),
    )
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} was not read through the held parent generation.`,
    );
  }
}

function parseAutomationAuthorityReceipt(
  result,
  { operation, names, identityPrefixes, parentPrefixes, requested = {} },
  label,
) {
  let receipt;
  try {
    receipt = JSON.parse(result.toString("utf8"));
  } catch {
    receipt = null;
  }
  const expectedKeys = [
    "protocol",
    "operation",
    ...Object.keys(names),
    ...Object.keys(requested),
    ...identityPrefixes.flatMap((prefix) =>
      AUTHORITY_FILE_IDENTITY_RECEIPT_FIELDS.map(
        (field) => `${prefix}${field}`,
      ),
    ),
    ...parentPrefixes.flatMap((prefix) =>
      AUTHORITY_PARENT_IDENTITY_RECEIPT_FIELDS.map(
        (field) => `${prefix}${field}`,
      ),
    ),
  ].sort();
  if (
    Object.keys(receipt ?? {})
      .sort()
      .join("\n") !== expectedKeys.join("\n") ||
    receipt.protocol !== AUTHORITY_FILE_OPERATION_PROTOCOL ||
    receipt.operation !== operation ||
    Object.entries({ ...names, ...requested }).some(
      ([key, value]) => receipt?.[key] !== String(value),
    )
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} returned an inexact ${operation} receipt.`,
    );
  }
  return receipt;
}

function requireAutomationAuthorityReceiptIdentity(
  receipt,
  prefix,
  snapshot,
  label,
) {
  const expected = {
    [`${prefix}Device`]: String(snapshot.identity.dev),
    [`${prefix}Inode`]: String(snapshot.identity.ino),
    [`${prefix}Mode`]: String(Number(snapshot.identity.mode) & 0o7777),
    [`${prefix}LinkCount`]: String(snapshot.identity.nlink),
    [`${prefix}Uid`]: String(snapshot.identity.uid),
    [`${prefix}Gid`]: String(snapshot.identity.gid),
    [`${prefix}Size`]: String(snapshot.identity.size),
    [`${prefix}MtimeNs`]: String(snapshot.identity.mtimeNs),
    [`${prefix}CtimeNs`]: String(snapshot.identity.ctimeNs),
    [`${prefix}Digest`]: digestBytes(snapshot.bytes),
  };
  if (Object.entries(expected).some(([key, value]) => receipt[key] !== value)) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} returned an inexact ${prefix} generation.`,
    );
  }
}

function requireAutomationAuthorityReceiptParent(
  receipt,
  prefix,
  binding,
  label,
) {
  const expected = {
    [`${prefix}Device`]: binding.identity.dev.toString(),
    [`${prefix}Inode`]: binding.identity.ino.toString(),
    [`${prefix}Mode`]: Number(binding.identity.mode & 0o7777n).toString(),
    [`${prefix}Uid`]: binding.identity.uid.toString(),
  };
  if (Object.entries(expected).some(([key, value]) => receipt[key] !== value)) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} returned an inexact ${prefix} parent generation.`,
    );
  }
}

function authorityRetirementGenerationDigest(filePath, snapshot) {
  return canonicalLeaseRequestDigest({
    purpose: "automation-authority-generation-retirement-v1",
    filePath,
    generation: automationAuthoritySnapshotDescriptor(snapshot),
  });
}

function removeAutomationAuthorityFile({
  filePath,
  snapshot,
  operationId,
  privateRoot = snapshot?.privateRoot,
  maxBytes = LEASE_TRANSACTION_MAX_BYTES,
  allowedModes = [0o600],
  label = "Automation authority file",
  beforeRemove = () => {},
  retirementBasename = path.basename(filePath),
  retirementDirectory: retirementDirectoryPathOverride = null,
  rawSource = false,
}) {
  const normalizedFilePath = path.resolve(filePath);
  const normalizedPrivateRoot = path.resolve(privateRoot);
  if (
    snapshot?.missing !== false ||
    snapshot.filePath !== normalizedFilePath ||
    snapshot.privateRoot !== normalizedPrivateRoot ||
    typeof operationId !== "string" ||
    operationId.length === 0 ||
    operationId.length > 512 ||
    operationId.includes("\0") ||
    path.basename(retirementBasename) !== retirementBasename
  ) {
    throw new AutomationControlError(
      "invalid_argument",
      `${label} removal requires its exact admitted snapshot.`,
    );
  }
  const directoryPath = path.dirname(normalizedFilePath);
  const retirementDirectoryPath =
    retirementDirectoryPathOverride === null
      ? path.join(directoryPath, AUTHORITY_RETIREMENT_DIRECTORY)
      : path.resolve(retirementDirectoryPathOverride);
  const retirementRelative = path.relative(
    normalizedPrivateRoot,
    retirementDirectoryPath,
  );
  if (
    retirementRelative === ".." ||
    retirementRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(retirementRelative)
  ) {
    throw new AutomationControlError(
      "invalid_argument",
      `${label} retirement directory escapes its private root.`,
    );
  }
  const operationNamespace = canonicalLeaseRequestDigest({
    purpose: "automation-authority-file-retirement-v1",
    filePath: normalizedFilePath,
    operationId,
    generation: automationAuthoritySnapshotDescriptor(snapshot),
    parent: snapshot.directoryIdentity,
  });
  const generationDigest = authorityRetirementGenerationDigest(
    normalizedFilePath,
    snapshot,
  );
  const retirementName = `${retirementBasename}.${operationNamespace}.${generationDigest}.retired`;
  if (Buffer.byteLength(retirementName, "utf8") > 255) {
    throw new AutomationControlError(
      "invalid_argument",
      `${label} retirement name exceeds its bounded filesystem contract.`,
    );
  }
  const retirementPath = path.join(retirementDirectoryPath, retirementName);
  const readGeneration = (targetPath, { allowMissing = false, readLabel }) =>
    (rawSource
      ? readAutomationAuthorityStageSnapshot
      : readAutomationAuthorityFileSnapshot)(targetPath, {
      allowMissing,
      allowEmpty: true,
      privateRoot: normalizedPrivateRoot,
      maxBytes,
      allowedModes,
      label: readLabel,
      invalidCode: "authority_generation_conflict",
    });
  let directory;
  try {
    directory = openPinnedLeaseArchiveDirectory(
      directoryPath,
      `${label} parent directory`,
    );
  } catch (error) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} changed from its admitted parent generation.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  let retirementDirectory;
  let binding;
  try {
    requireAutomationAuthorityDirectoryGeneration(
      directory,
      snapshot.directoryIdentity,
      `${label} parent directory`,
    );
    const helper = openPinnedLeaseArchiveHelper();
    const current = readGeneration(normalizedFilePath, {
      allowMissing: true,
      readLabel: label,
    });
    requireAutomationAuthoritySnapshotDirectory(current, directory, label);
    if (
      !current.missing &&
      !automationAuthoritySnapshotMatches(current, snapshot)
    ) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} changed before exact-generation removal.`,
      );
    }
    const sourceEntries = listPinnedAutomationAuthorityDirectory(
      helper,
      directory,
      {
        maxEntries: AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES,
        label: `${label} parent directory`,
        errorCode: "authority_generation_conflict",
      },
    );
    const retirementDirectoryExists =
      retirementDirectoryPathOverride === null
        ? sourceEntries.includes(AUTHORITY_RETIREMENT_DIRECTORY)
        : pathEntryExists(retirementDirectoryPath);
    if (current.missing && !retirementDirectoryExists) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} disappeared without an existing retirement directory.`,
      );
    }
    let admittedRetirementDirectory = null;
    if (
      !retirementDirectoryExists &&
      retirementDirectoryPathOverride !== null
    ) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} operation retirement directory is unavailable.`,
      );
    }
    if (!retirementDirectoryExists) {
      const directoryResult = runLeaseArchiveHelper(
        helper,
        "mkdir",
        [
          AUTHORITY_RETIREMENT_DIRECTORY,
          ...pinnedDirectoryArguments(directory),
        ],
        [directory.descriptor],
      );
      try {
        admittedRetirementDirectory = JSON.parse(
          directoryResult.toString("utf8"),
        );
      } catch {
        admittedRetirementDirectory = null;
      }
      if (
        Object.keys(admittedRetirementDirectory ?? {})
          .sort()
          .join("\n") !==
          ["created", "device", "inode", "protocol"].join("\n") ||
        admittedRetirementDirectory.protocol !== LEASE_ARCHIVE_MOVE_PROTOCOL ||
        typeof admittedRetirementDirectory.created !== "boolean" ||
        !/^\d+$/.test(String(admittedRetirementDirectory.device)) ||
        !/^\d+$/.test(String(admittedRetirementDirectory.inode))
      ) {
        throw new AutomationControlError(
          "authority_generation_conflict",
          `${label} retirement directory returned an invalid admission receipt.`,
        );
      }
      fsyncSync(directory.descriptor);
      requireAutomationAuthorityDirectoryGeneration(
        directory,
        snapshot.directoryIdentity,
        `${label} parent directory`,
      );
    }
    retirementDirectory = openPinnedLeaseArchiveDirectory(
      retirementDirectoryPath,
      `${label} retirement directory`,
    );
    if (
      admittedRetirementDirectory !== null &&
      (retirementDirectory.identity.dev.toString() !==
        admittedRetirementDirectory.device ||
        retirementDirectory.identity.ino.toString() !==
          admittedRetirementDirectory.inode)
    ) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} retirement directory changed after admission.`,
      );
    }
    const retiredBefore = readGeneration(retirementPath, {
      allowMissing: true,
      readLabel: `${label} retired generation`,
    });
    requireAutomationAuthoritySnapshotDirectory(
      retiredBefore,
      retirementDirectory,
      `${label} retired generation`,
    );
    if (current.missing) {
      if (retiredBefore.missing) {
        throw new AutomationControlError(
          "authority_generation_conflict",
          `${label} disappeared without its exact retirement generation.`,
        );
      }
      if (
        !automationAuthorityStableGenerationMatches(retiredBefore, snapshot)
      ) {
        throw new AutomationControlError(
          "authority_generation_conflict",
          `${label} retirement generation does not match its admitted source.`,
        );
      }
      fsyncSync(retirementDirectory.descriptor);
      fsyncSync(directory.descriptor);
      assertPinnedLeaseArchiveDirectory(retirementDirectory);
      requireAutomationAuthorityDirectoryGeneration(
        directory,
        snapshot.directoryIdentity,
        `${label} parent directory`,
      );
      return Object.freeze({ removed: true, recovered: true });
    }
    if (!retiredBefore.missing) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} exists beside an already used retirement identity.`,
      );
    }
    if (!automationAuthoritySnapshotMatches(current, snapshot)) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} changed before exact-generation removal.`,
      );
    }
    requireAutomationAuthorityRetirementCapacity(
      helper,
      retirementDirectory,
      snapshot.bytes.length,
      `${label} retirement directory`,
    );
    binding = openPinnedAutomationAuthorityFile(
      normalizedFilePath,
      snapshot,
      label,
      { maxBytes, allowedModes },
    );
    beforeRemove();
    let helperError = null;
    let receipt = null;
    try {
      const result = runLeaseArchiveHelper(
        helper,
        "authority-retire",
        [
          path.basename(normalizedFilePath),
          retirementName,
          ...automationAuthorityFileIdentityArguments(binding),
          ...automationAuthorityParentIdentityArguments(directory),
          ...automationAuthorityParentIdentityArguments(retirementDirectory),
        ],
        [
          directory.descriptor,
          retirementDirectory.descriptor,
          binding.descriptor,
        ],
      );
      receipt = parseAutomationAuthorityReceipt(
        result,
        {
          operation: "authority-retire",
          names: {
            sourceName: path.basename(normalizedFilePath),
            quarantineName: retirementName,
          },
          identityPrefixes: ["source", "sourceAfter"],
          parentPrefixes: ["sourceParent", "quarantineParent"],
        },
        label,
      );
      requireAutomationAuthorityReceiptIdentity(
        receipt,
        "source",
        snapshot,
        label,
      );
      requireAutomationAuthorityReceiptParent(
        receipt,
        "sourceParent",
        directory,
        label,
      );
      requireAutomationAuthorityReceiptParent(
        receipt,
        "quarantineParent",
        retirementDirectory,
        label,
      );
    } catch (error) {
      helperError = error;
    }
    const removed = readGeneration(normalizedFilePath, {
      allowMissing: true,
      readLabel: label,
    });
    requireAutomationAuthoritySnapshotDirectory(removed, directory, label);
    if (!removed.missing) {
      if (helperError !== null) throw helperError;
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} survived exact-generation removal.`,
      );
    }
    const retired = readGeneration(retirementPath, {
      readLabel: `${label} retired generation`,
    });
    requireAutomationAuthoritySnapshotDirectory(
      retired,
      retirementDirectory,
      `${label} retired generation`,
    );
    if (!automationAuthorityStableGenerationMatches(retired, snapshot)) {
      if (helperError !== null) throw helperError;
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} did not preserve its exact retired generation.`,
      );
    }
    if (receipt !== null) {
      requireAutomationAuthorityReceiptIdentity(
        receipt,
        "sourceAfter",
        retired,
        label,
      );
    }
    fsyncSync(retirementDirectory.descriptor);
    fsyncSync(directory.descriptor);
    requireAutomationAuthorityDirectoryGeneration(
      directory,
      snapshot.directoryIdentity,
      `${label} parent directory`,
    );
    assertPinnedLeaseArchiveDirectory(retirementDirectory);
    return Object.freeze({ removed: true, recovered: helperError !== null });
  } finally {
    if (binding !== undefined) closeSync(binding.descriptor);
    if (retirementDirectory !== undefined) {
      closeSync(retirementDirectory.descriptor);
    }
    closeSync(directory.descriptor);
  }
}

function readAutomationAuthorityStage(
  stagePath,
  { privateRoot, maxBytes, allowedModes = [0o600], label },
) {
  return readAutomationAuthorityStageSnapshot(stagePath, {
    allowMissing: true,
    allowEmpty: true,
    privateRoot,
    maxBytes,
    allowedModes,
    label,
    invalidCode: "authority_generation_conflict",
  });
}

function listPinnedAutomationAuthorityDirectory(
  helper,
  binding,
  {
    maxEntries = AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES,
    label = binding.label,
    errorCode = "authority_generation_conflict",
  } = {},
) {
  assertPinnedLeaseArchiveDirectory(binding);
  let bytes;
  try {
    bytes = runLeaseArchiveHelper(
      helper,
      "list-bounded",
      [
        maxEntries.toString(),
        LEASE_BOUNDED_DIRECTORY_MAX_BYTES.toString(),
        ...pinnedDirectoryArguments(binding),
      ],
      [binding.descriptor],
    );
  } catch (error) {
    throw new AutomationControlError(
      errorCode,
      `${label} could not be listed.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  assertPinnedLeaseArchiveDirectory(binding);
  if (bytes.length === 0) return [];
  let entries;
  try {
    entries = privateAuthorityDecoder.decode(bytes).split("\0");
  } catch {
    throw new AutomationControlError(
      errorCode,
      `${label} returned invalid UTF-8 entry names.`,
    );
  }
  if (
    entries.length > maxEntries ||
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
      errorCode,
      `${label} returned entries outside its bounded contract.`,
    );
  }
  return entries;
}

function listAutomationAuthorityStages(filePath, helper, directory) {
  return listPinnedAutomationAuthorityDirectory(helper, directory)
    .map((entry) => parseAutomationAuthorityStageName(filePath, entry))
    .filter((entry) => entry !== null);
}

function requireSemanticAutomationAuthorityStage({
  filePath,
  current,
  stageEntry,
  pendingPlans = [],
  validateSuccessor,
  label,
}) {
  if (stageEntry === null) {
    return Object.freeze({ kind: "none", operationId: null });
  }
  if (typeof validateSuccessor !== "function") {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} staging requires a semantic successor validator.`,
    );
  }
  const stage = stageEntry.snapshot;
  const currentStableDigest = current.missing
    ? null
    : automationAuthorityStableGenerationDigest(current);
  const stageStableDigest = automationAuthorityStableGenerationDigest(stage);
  const settled =
    stageEntry.kind === "ready" &&
    currentStableDigest !== null &&
    stageEntry.successorStableDigest === currentStableDigest;
  const pendingReady =
    stageEntry.kind === "ready" &&
    stageEntry.successorStableDigest === stageStableDigest;
  if (settled && pendingReady) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} staging does not identify exactly one pending or settled authority generation.`,
    );
  }

  if (settled) {
    let semantic;
    try {
      semantic = validateSuccessor(stage, current);
    } catch (error) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} staging is not an exact semantic successor.`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    const operationId = semantic?.operationId;
    if (
      typeof operationId !== "string" ||
      operationId.length === 0 ||
      operationId.length > 512 ||
      operationId.includes("\0")
    ) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} staging has no exact semantic operation identity.`,
      );
    }
    return Object.freeze({ kind: "settled", operationId, semantic });
  }

  const matchingPlans = pendingPlans.filter((plan) => {
    const proposedBytes = Buffer.from(plan?.proposedBytes ?? []);
    return (
      typeof plan?.operationId === "string" &&
      plan.operationId.length > 0 &&
      plan.operationId.length <= 512 &&
      !plan.operationId.includes("\0") &&
      automationAuthorityNamespace({
        filePath,
        operationId: plan.operationId,
        proposedDigest: digestBytes(proposedBytes),
        previousSnapshot: current,
      }) === stageEntry.namespaceDigest
    );
  });
  if (matchingPlans.length !== 1) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} pending staging does not match one exact owning operation namespace.`,
    );
  }
  const plan = matchingPlans[0];
  const proposedBytes = Buffer.from(plan.proposedBytes);
  const stagedBytesValid =
    stageEntry.kind === "provisional"
      ? stage.bytes.length <= proposedBytes.length &&
        proposedBytes.subarray(0, stage.bytes.length).equals(stage.bytes)
      : pendingReady && stage.bytes.equals(proposedBytes);
  if (!stagedBytesValid) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} pending staging is not an exact complete or partial generation of its owning operation.`,
    );
  }
  const proposedSnapshot = Object.freeze({
    ...stage,
    missing: false,
    bytes: proposedBytes,
  });
  let semantic;
  try {
    semantic = validateSuccessor(current, proposedSnapshot);
  } catch (error) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} pending staging is not an exact semantic successor.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  if (semantic?.operationId !== plan.operationId) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} pending staging has inexact owning operation semantics.`,
    );
  }
  return Object.freeze({
    kind: "pending",
    operationId: plan.operationId,
    semantic,
  });
}

function admitSemanticAutomationAuthorityStage({
  filePath,
  privateRoot,
  maxBytes,
  allowedModes = [0o600],
  buildPendingPlans = () => [],
  validateSuccessor,
  label,
}) {
  const directoryPath = path.dirname(filePath);
  if (!pathEntryExists(directoryPath)) {
    return Object.freeze({ kind: "none", operationId: null });
  }
  const directory = openPinnedLeaseArchiveDirectory(
    directoryPath,
    `${label} parent directory`,
  );
  try {
    const current = readAutomationAuthorityFileSnapshot(filePath, {
      allowMissing: true,
      allowEmpty: true,
      privateRoot,
      maxBytes,
      allowedModes,
      label,
      invalidCode: "authority_generation_conflict",
    });
    requireAutomationAuthoritySnapshotDirectory(current, directory, label);
    const stages = listAutomationAuthorityStages(
      filePath,
      openPinnedLeaseArchiveHelper(),
      directory,
    );
    if (stages.length > 1) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} has more than one authority staging generation.`,
      );
    }
    let stageEntry = stages[0] ?? null;
    if (stageEntry !== null) {
      const snapshot = readAutomationAuthorityStage(
        path.join(directoryPath, stageEntry.entry),
        {
          privateRoot,
          maxBytes,
          allowedModes: [...new Set([0o600, ...allowedModes])],
          label: `${label} staging generation`,
        },
      );
      if (snapshot.missing) {
        throw new AutomationControlError(
          "authority_generation_conflict",
          `${label} staging generation disappeared during admission.`,
        );
      }
      requireAutomationAuthoritySnapshotDirectory(
        snapshot,
        directory,
        `${label} staging generation`,
      );
      stageEntry = Object.freeze({ ...stageEntry, snapshot });
    }
    const admission = requireSemanticAutomationAuthorityStage({
      filePath,
      current,
      stageEntry,
      pendingPlans: buildPendingPlans(current),
      validateSuccessor,
      label,
    });
    requireAutomationAuthorityDirectoryGeneration(
      directory,
      current.directoryIdentity,
      `${label} parent directory`,
    );
    return admission;
  } finally {
    closeSync(directory.descriptor);
  }
}

function requireCanonicalStagedControlEvent(event) {
  const timestampMs = Date.parse(String(event?.ts ?? ""));
  if (
    event === null ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    event.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    typeof event.eventId !== "string" ||
    !IDENTIFIER_PATTERN.test(event.eventId) ||
    typeof event.type !== "string" ||
    !IDENTIFIER_PATTERN.test(event.type) ||
    typeof event.actor !== "string" ||
    event.actor.length === 0 ||
    event.actor.trim() !== event.actor ||
    (event.taskId !== undefined &&
      (typeof event.taskId !== "string" ||
        !IDENTIFIER_PATTERN.test(event.taskId))) ||
    event.data === null ||
    typeof event.data !== "object" ||
    Array.isArray(event.data) ||
    !Number.isFinite(timestampMs) ||
    new Date(timestampMs).toISOString() !== event.ts
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      "Control event staging has an invalid final event.",
    );
  }
  return event;
}

function requireControlEventSemanticSuccessor(paths, before, after) {
  const admittedBefore = parseControlEventHistorySnapshot(before);
  const admittedAfter = parseControlEventHistorySnapshot(after);
  if (
    admittedAfter.recordCount !== admittedBefore.recordCount + 1 ||
    admittedAfter.events.length !== admittedBefore.events.length + 1
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      "Control event staging must add exactly one physical event.",
    );
  }
  const event = requireCanonicalStagedControlEvent(
    admittedAfter.events[admittedAfter.events.length - 1],
  );
  if (
    admittedBefore.events.some(
      (candidate) => candidate?.eventId === event.eventId,
    )
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `Control event staging duplicates event ${event.eventId}.`,
    );
  }
  const { separator, eventBytes } = prepareControlEventAppend(
    admittedBefore.bytes,
    admittedBefore.recordCount,
    event,
  );
  const exactSuccessor = Buffer.concat([
    admittedBefore.bytes,
    separator,
    eventBytes,
  ]);
  if (!after.bytes.equals(exactSuccessor)) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      "Control event staging is not the exact one-event byte successor.",
    );
  }
  const finalIndex = admittedAfter.events.length - 1;
  const leaseReserved =
    LEASE_CONTROL_EVENT_TYPES.has(event.type) ||
    event.eventId.startsWith("lease:");
  const taskReserved =
    TASK_MANIFEST_EVENT_TYPES.has(event.type) ||
    event.eventId.startsWith("task-outcome-reserved:");
  const outcomeReserved =
    event.type === "outcome_recorded" ||
    event.eventId.startsWith("outcome-recorded:");
  const repairReserved =
    event.type === OUTCOME_LEDGER_REPAIR_EVENT_TYPE ||
    event.eventId.startsWith("outcome-history-repaired:");
  if (
    !leaseReserved &&
    !taskReserved &&
    !outcomeReserved &&
    !repairReserved &&
    (AUTOMATION_ACTOR_POLICIES[event.actor]?.canAppendEvent !== true ||
      !exactObjectKeys(event, [
        "actor",
        "data",
        "eventId",
        "schemaVersion",
        "ts",
        "type",
        ...(event.taskId === undefined ? [] : ["taskId"]),
      ]))
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      "Control event staging has an inexact generic event shape.",
    );
  }
  if (leaseReserved) {
    const leaseHistory = requireExactLeaseEventHistory(admittedAfter.events);
    if (!leaseHistory.canonicalEventsByIndex.has(finalIndex)) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        "Control event staging does not end in one exact lease event.",
      );
    }
  }
  if (taskReserved) {
    const taskHistory = inspectExactTaskLifecycleHistory(admittedAfter.events);
    if (
      !taskHistory.healthy ||
      !taskHistory.canonicalTaskEventIndexes.has(finalIndex)
    ) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `Control event staging does not end in one exact task event: ${taskHistory.issues.join("; ")}`,
      );
    }
  }
  if (outcomeReserved || repairReserved) {
    const outcomeHistory = inspectExactOutcomeControlHistory(
      admittedAfter.events,
      { ledgerPath: paths.outcomes, stateRoot: paths.stateRoot },
    );
    const canonical = outcomeReserved
      ? outcomeHistory.canonicalOutcomeEventIndexes.has(finalIndex)
      : outcomeHistory.canonicalOutcomeLedgerRepairEventIndexes.has(finalIndex);
    if (!outcomeHistory.healthy || !canonical) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        "Control event staging does not end in one exact outcome event.",
      );
    }
  }
  return Object.freeze({
    operationId: `control-event:${event.eventId}`,
    event,
  });
}

function filesystemGenerationFingerprint(
  stats,
  { stableIdentityOnly = false } = {},
) {
  return [
    stats.dev,
    stats.ino,
    stats.mode,
    stats.nlink,
    stats.uid,
    stats.gid,
    ...(stableIdentityOnly ? [] : [stats.size, stats.mtimeNs, stats.ctimeNs]),
  ]
    .map(String)
    .join(":");
}

function optionalFilesystemEntryGenerationFingerprint(filePath) {
  try {
    return filesystemGenerationFingerprint(
      lstatSync(filePath, { bigint: true }),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    return null;
  }
}

function controlEventAuthorityGenerationFingerprint(paths) {
  const directoryPath = path.dirname(paths.events);
  const canonicalName = path.basename(paths.events);
  const authorityPrefix = `.${canonicalName}.authority.`;
  const canonicalNameBytes = Buffer.from(canonicalName, "utf8");
  const authorityPrefixBytes = Buffer.from(authorityPrefix, "utf8");
  const relevantNames = () => {
    const entries = readdirSync(directoryPath, { encoding: "buffer" }).map(
      (entry) => {
        privateAuthorityDecoder.decode(entry);
        return entry;
      },
    );
    return entries
      .filter(
        (entry) =>
          entry.equals(canonicalNameBytes) ||
          entry
            .subarray(0, authorityPrefixBytes.length)
            .equals(authorityPrefixBytes),
      )
      .sort(Buffer.compare)
      .map((entry) => {
        const name = privateAuthorityDecoder.decode(entry);
        const generation = optionalFilesystemEntryGenerationFingerprint(
          path.join(directoryPath, name),
        );
        if (generation === null) {
          throw new Error("control event authority entry changed during scan");
        }
        return `${entry.toString("hex")}:${generation}`;
      })
      .join("\0");
  };
  try {
    const directoryBefore = filesystemGenerationFingerprint(
      lstatSync(directoryPath, { bigint: true }),
      { stableIdentityOnly: true },
    );
    const entriesBefore = relevantNames();
    const eventBefore = optionalFilesystemEntryGenerationFingerprint(
      paths.events,
    );
    const eventAfter = optionalFilesystemEntryGenerationFingerprint(
      paths.events,
    );
    const entriesAfter = relevantNames();
    const directoryAfter = filesystemGenerationFingerprint(
      lstatSync(directoryPath, { bigint: true }),
      { stableIdentityOnly: true },
    );
    if (
      eventBefore === null ||
      eventAfter === null ||
      directoryBefore !== directoryAfter ||
      entriesBefore !== entriesAfter ||
      eventBefore !== eventAfter
    ) {
      return null;
    }
    return digestBytes(
      Buffer.from(
        [directoryAfter, entriesAfter, eventAfter].join("\n"),
        "utf8",
      ),
    );
  } catch {
    return null;
  }
}

function admitControlEventAuthorityStage(
  paths,
  { expectedPendingEvents = [] } = {},
) {
  const activeGuard = ACTIVE_AUTOMATION_EVENTS_GUARDS_BY_ROOT.get(
    paths.stateRoot,
  );
  const expectedPlanDigest = digestBytes(
    Buffer.from(JSON.stringify(expectedPendingEvents), "utf8"),
  );
  const currentFingerprint =
    activeGuard === undefined
      ? null
      : controlEventAuthorityGenerationFingerprint(paths);
  const cached =
    activeGuard === undefined
      ? undefined
      : AUTOMATION_EVENTS_GUARD_STAGE_ADMISSIONS.get(activeGuard);
  if (
    cached !== undefined &&
    currentFingerprint !== null &&
    cached.fingerprint === currentFingerprint &&
    (cached.admission.kind !== "pending" ||
      cached.expectedPlanDigest === expectedPlanDigest)
  ) {
    return cached.admission;
  }

  const admission = admitSemanticAutomationAuthorityStage({
    filePath: paths.events,
    privateRoot: paths.controlRoot,
    maxBytes: CONTROL_EVENT_HISTORY_MAX_BYTES,
    allowedModes: [0o600],
    buildPendingPlans: (current) =>
      expectedPendingEvents.map((event) => {
        const admitted = parseControlEventHistorySnapshot(current);
        const append = prepareControlEventAppend(
          admitted.bytes,
          admitted.recordCount,
          event,
        );
        return Object.freeze({
          operationId: `control-event:${String(event?.eventId ?? "")}`,
          proposedBytes: Buffer.concat([
            admitted.bytes,
            append.separator,
            append.eventBytes,
          ]),
        });
      }),
    validateSuccessor: (before, after) =>
      requireControlEventSemanticSuccessor(paths, before, after),
    label: "Control event history",
  });
  if (activeGuard !== undefined) {
    const admittedFingerprint =
      controlEventAuthorityGenerationFingerprint(paths);
    if (admittedFingerprint === null) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        "Control event authority generation changed while its guard admission was cached.",
      );
    }
    AUTOMATION_EVENTS_GUARD_STAGE_ADMISSIONS.set(
      activeGuard,
      Object.freeze({
        fingerprint: admittedFingerprint,
        expectedPlanDigest,
        admission,
      }),
    );
  }
  return admission;
}

function parseTaskManifestAuthoritySnapshot(snapshot, label) {
  if (snapshot.missing) return null;
  let value;
  try {
    value = JSON.parse(privateAuthorityDecoder.decode(snapshot.bytes));
  } catch {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} staging contains invalid JSON.`,
    );
  }
  try {
    return validateTaskManifest(value);
  } catch (error) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} staging contains an invalid task manifest.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function parseTaskTransactionAuthorityName(name, retired) {
  const match = retired
    ? /^(\d{12})-(.+)\.json\.([0-9a-f]{64})\.([0-9a-f]{64})\.retired$/.exec(
        name,
      )
    : /^(\d{12})-(.+)\.json$/.exec(name);
  if (
    match === null ||
    !IDENTIFIER_PATTERN.test(match[2]) ||
    !Number.isSafeInteger(Number(match[1]))
  ) {
    return null;
  }
  return Object.freeze({
    revision: Number(match[1]),
    transactionId: match[2],
  });
}

function requireCanonicalTaskTransactionLineage(transaction, filePath) {
  if (
    !exactObjectKeys(transaction, [
      "event",
      "preparedAt",
      "previousManifestRevision",
      "schemaVersion",
      "targetManifest",
      "transactionId",
    ]) ||
    !isCanonicalIsoTimestamp(transaction.preparedAt)
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `Task transaction lineage ${filePath} has an inexact canonical envelope.`,
    );
  }
  return transaction;
}

function taskTransactionSnapshotMatchesInventory(snapshot, entry) {
  return (
    String(snapshot.identity.dev) === entry.device &&
    String(snapshot.identity.ino) === entry.inode &&
    String(Number(snapshot.identity.mode) & 0o7777) === entry.mode &&
    String(snapshot.identity.nlink) === entry.linkCount &&
    String(snapshot.identity.uid) === entry.uid &&
    String(snapshot.identity.gid) === entry.gid &&
    String(snapshot.identity.size) === entry.size &&
    String(snapshot.identity.mtimeNs) === entry.mtimeNs &&
    String(snapshot.identity.ctimeNs) === entry.ctimeNs
  );
}

function readTaskManifestLineageTransactions(
  paths,
  targetRevision = null,
  { includeRetired = true } = {},
) {
  if (!pathEntryExists(paths.taskTransactions)) return [];
  const helper = openPinnedLeaseArchiveHelper();
  const candidates = [];
  const directory = openPinnedLeaseArchiveDirectory(
    paths.taskTransactions,
    "Task transaction lineage directory",
  );
  try {
    const names = listPinnedAutomationAuthorityDirectory(helper, directory, {
      maxEntries: AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES,
      label: "Task transaction lineage directory",
      errorCode: "authority_generation_conflict",
    });
    for (const name of names) {
      const parsed = parseTaskTransactionAuthorityName(name, false);
      if (
        parsed === null ||
        (targetRevision !== null && parsed.revision !== targetRevision)
      ) {
        continue;
      }
      const filePath = path.join(paths.taskTransactions, name);
      const admitted = readTaskControlJsonSnapshot(
        paths,
        filePath,
        `Task transaction lineage ${parsed.transactionId}`,
      );
      requireAutomationAuthoritySnapshotDirectory(
        admitted.snapshot,
        directory,
        `Task transaction lineage ${parsed.transactionId}`,
      );
      const transaction = requireCanonicalTaskTransactionLineage(
        validateTaskTransaction(admitted.value, filePath),
        filePath,
      );
      if (
        transaction.transactionId !== parsed.transactionId ||
        !admitted.snapshot.bytes.equals(privateJsonBytes(transaction))
      ) {
        throw new AutomationControlError(
          "authority_generation_conflict",
          `Task transaction lineage ${name} has an inexact canonical transaction identity.`,
        );
      }
      candidates.push(Object.freeze({ transaction, retired: false }));
    }
    assertPinnedLeaseArchiveDirectory(directory);
  } finally {
    closeSync(directory.descriptor);
  }

  if (!includeRetired) return candidates;
  const retirementPath = path.join(
    paths.taskTransactions,
    AUTHORITY_RETIREMENT_DIRECTORY,
  );
  if (!pathEntryExists(retirementPath)) return candidates;
  const retirementDirectory = openPinnedLeaseArchiveDirectory(
    retirementPath,
    "Retained task transaction lineage directory",
  );
  try {
    const inventory = readAutomationAuthorityRetirementInventory(
      helper,
      retirementDirectory,
      "Retained task transaction lineage directory",
    );
    for (const entry of inventory.entries) {
      const parsed = parseTaskTransactionAuthorityName(entry.name, true);
      if (
        parsed === null ||
        (targetRevision !== null && parsed.revision !== targetRevision)
      ) {
        continue;
      }
      const filePath = path.join(retirementPath, entry.name);
      const snapshot = readAutomationAuthorityStageSnapshot(filePath, {
        allowEmpty: false,
        privateRoot: paths.controlRoot,
        maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
        allowedModes: [0o600],
        label: `Retained task transaction lineage ${parsed.transactionId}`,
        invalidCode: "authority_generation_conflict",
      });
      requireAutomationAuthoritySnapshotDirectory(
        snapshot,
        retirementDirectory,
        `Retained task transaction lineage ${parsed.transactionId}`,
      );
      if (!taskTransactionSnapshotMatchesInventory(snapshot, entry)) {
        throw new AutomationControlError(
          "authority_generation_conflict",
          `Retained task transaction lineage ${entry.name} changed after bounded inventory.`,
        );
      }
      let value;
      try {
        value = JSON.parse(privateAuthorityDecoder.decode(snapshot.bytes));
      } catch {
        throw new AutomationControlError(
          "authority_generation_conflict",
          `Retained task transaction lineage ${entry.name} contains invalid JSON.`,
        );
      }
      const transaction = requireCanonicalTaskTransactionLineage(
        validateTaskTransaction(value, filePath),
        filePath,
      );
      if (
        transaction.transactionId !== parsed.transactionId ||
        !snapshot.bytes.equals(privateJsonBytes(transaction))
      ) {
        throw new AutomationControlError(
          "authority_generation_conflict",
          `Retained task transaction lineage ${entry.name} has an inexact canonical transaction identity.`,
        );
      }
      candidates.push(Object.freeze({ transaction, retired: true }));
    }
    assertPinnedLeaseArchiveDirectory(retirementDirectory);
  } finally {
    closeSync(retirementDirectory.descriptor);
  }
  return candidates;
}

function requireTaskManifestSemanticSuccessor(paths, before, after) {
  const beforeManifest = parseTaskManifestAuthoritySnapshot(
    before,
    "Current task manifest predecessor",
  );
  const afterManifest = parseTaskManifestAuthoritySnapshot(
    after,
    "Current task manifest successor",
  );
  const previousRevision = beforeManifest?.revision ?? 0;
  if (
    afterManifest === null ||
    afterManifest.revision !== previousRevision + 1
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      "Current task manifest staging must advance exactly one revision.",
    );
  }
  const events = readControlEventHistorySnapshot(paths.events).events;
  const lineage = readTaskManifestLineageTransactions(
    paths,
    afterManifest.revision,
  ).filter(({ transaction, retired }) => {
    if (
      transaction.previousManifestRevision !== previousRevision ||
      !canonicalValuesEqual(transaction.targetManifest, afterManifest)
    ) {
      return false;
    }
    const eventIndexes = [];
    for (const [index, event] of events.entries()) {
      if (event?.eventId === transaction.event.eventId) {
        if (!canonicalValuesEqual(event, transaction.event)) return false;
        eventIndexes.push(index);
      }
    }
    if (eventIndexes.length > 1 || (retired && eventIndexes.length !== 1)) {
      return false;
    }
    const priorManifest =
      beforeManifest ??
      Object.freeze({
        schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
        revision: 0,
        updatedAt: transaction.preparedAt,
        tasks: [],
      });
    const beforeEvents =
      eventIndexes.length === 1 ? events.slice(0, eventIndexes[0]) : events;
    if (
      !inspectExactTaskManifestHistoryParity(beforeEvents, priorManifest)
        .healthy
    ) {
      return false;
    }
    if (
      eventIndexes.length === 1 &&
      !inspectExactTaskManifestHistoryParity(events, afterManifest).healthy
    ) {
      return false;
    }
    if (
      eventIndexes.length === 0 &&
      !inspectExactTaskManifestHistoryParity(
        [...events, transaction.event],
        afterManifest,
      ).healthy
    ) {
      return false;
    }
    return true;
  });
  if (lineage.length !== 1) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      "Current task manifest staging has no unique exact task transaction lineage.",
      { matches: lineage.length },
    );
  }
  const transaction = lineage[0].transaction;
  return Object.freeze({
    operationId: `task-manifest:${transaction.transactionId}`,
    transaction,
  });
}

function admitTaskManifestAuthorityStage(
  paths,
  { expectedPendingTransactions = [] } = {},
) {
  return admitSemanticAutomationAuthorityStage({
    filePath: paths.taskManifest,
    privateRoot: paths.controlRoot,
    maxBytes: TASK_CONTROL_FILE_MAX_BYTES,
    allowedModes: [0o600],
    buildPendingPlans: () =>
      expectedPendingTransactions.map((transaction) =>
        Object.freeze({
          operationId: `task-manifest:${transaction.transactionId}`,
          proposedBytes: privateJsonBytes(transaction.targetManifest),
        }),
      ),
    validateSuccessor: (before, after) =>
      requireTaskManifestSemanticSuccessor(paths, before, after),
    label: "Current task manifest",
  });
}

function readAutomationAuthorityRetirementInventory(helper, directory, label) {
  assertPinnedLeaseArchiveDirectory(directory);
  const result = runLeaseArchiveHelper(
    helper,
    "authority-retirement-inventory",
    [
      AUTHORITY_RETIREMENT_MAX_ENTRIES.toString(),
      AUTHORITY_RETIREMENT_INVENTORY_MAX_RECEIPT_BYTES.toString(),
      CONTROL_EVENT_HISTORY_MAX_BYTES.toString(),
      LEASE_ARCHIVE_MAX_BYTES.toString(),
      ...automationAuthorityParentIdentityArguments(directory),
    ],
    [directory.descriptor],
  );
  assertPinnedLeaseArchiveDirectory(directory);
  let receipt;
  try {
    receipt = JSON.parse(result.toString("utf8"));
  } catch {
    receipt = null;
  }
  const expectedKeys = [
    "protocol",
    "operation",
    "requestedMaxEntries",
    "requestedMaxEncodedOutputBytes",
    "requestedMaxFileBytes",
    "requestedMaxTotalBytes",
    ...AUTHORITY_INVENTORY_PARENT_RECEIPT_FIELDS.map(
      (field) => `parent${field}`,
    ),
    "entryCount",
    "totalBytes",
    "encodedOutputBytes",
    "entries",
  ].sort();
  const expectedParent = automationAuthorityInventoryParentReceipt(directory);
  if (
    Object.keys(receipt ?? {})
      .sort()
      .join("\n") !== expectedKeys.join("\n") ||
    receipt.protocol !== AUTHORITY_FILE_OPERATION_PROTOCOL ||
    receipt.operation !== "authority-retirement-inventory" ||
    receipt.requestedMaxEntries !==
      AUTHORITY_RETIREMENT_MAX_ENTRIES.toString() ||
    receipt.requestedMaxEncodedOutputBytes !==
      AUTHORITY_RETIREMENT_INVENTORY_MAX_RECEIPT_BYTES.toString() ||
    receipt.requestedMaxFileBytes !==
      CONTROL_EVENT_HISTORY_MAX_BYTES.toString() ||
    receipt.requestedMaxTotalBytes !== LEASE_ARCHIVE_MAX_BYTES.toString() ||
    receipt.encodedOutputBytes !== result.length.toString() ||
    !/^\d+$/.test(String(receipt.entryCount)) ||
    !/^\d+$/.test(String(receipt.totalBytes)) ||
    !Array.isArray(receipt.entries) ||
    Object.entries(expectedParent).some(
      ([key, value]) => receipt[key] !== value,
    )
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} returned an inexact bounded inventory receipt.`,
    );
  }
  const entryCount = Number(receipt.entryCount);
  const totalBytes = BigInt(receipt.totalBytes);
  if (
    !Number.isSafeInteger(entryCount) ||
    entryCount !== receipt.entries.length ||
    entryCount > AUTHORITY_RETIREMENT_MAX_ENTRIES ||
    totalBytes > BigInt(LEASE_ARCHIVE_MAX_BYTES)
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} returned inventory totals outside their bounds.`,
    );
  }
  let summedBytes = 0n;
  let previousNameBytes = null;
  const entries = receipt.entries.map((entry) => {
    const keys = [
      "name",
      "device",
      "inode",
      "mode",
      "linkCount",
      "uid",
      "gid",
      "size",
      "mtimeNs",
      "ctimeNs",
    ].sort();
    const nameBytes = Buffer.from(String(entry?.name ?? ""), "utf8");
    if (
      Object.keys(entry ?? {})
        .sort()
        .join("\n") !== keys.join("\n") ||
      typeof entry.name !== "string" ||
      entry.name.length === 0 ||
      entry.name === "." ||
      entry.name === ".." ||
      entry.name.includes("/") ||
      entry.name.includes("\0") ||
      !/^.+\.[0-9a-f]{64}\.[0-9a-f]{64}\.retired$/.test(entry.name) ||
      [
        entry.device,
        entry.inode,
        entry.mode,
        entry.linkCount,
        entry.uid,
        entry.gid,
        entry.size,
        entry.mtimeNs,
        entry.ctimeNs,
      ].some((value) => !/^\d+$/.test(String(value))) ||
      entry.device !== directory.identity.dev.toString() ||
      entry.uid !== BigInt(process.getuid()).toString() ||
      !["384", "416", "420"].includes(entry.mode) ||
      entry.linkCount !== "1" ||
      BigInt(entry.size) > BigInt(CONTROL_EVENT_HISTORY_MAX_BYTES) ||
      (previousNameBytes !== null &&
        Buffer.compare(previousNameBytes, nameBytes) >= 0)
    ) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} returned an unsafe retirement inventory entry.`,
      );
    }
    previousNameBytes = nameBytes;
    summedBytes += BigInt(entry.size);
    return Object.freeze({ ...entry });
  });
  if (summedBytes !== totalBytes) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} returned inconsistent retirement byte totals.`,
    );
  }
  return Object.freeze({
    entryCount,
    totalBytes,
    entries: Object.freeze(entries),
  });
}

function requireAutomationAuthorityRetirementCapacity(
  helper,
  directory,
  reservationBytes,
  label,
) {
  const inventory = readAutomationAuthorityRetirementInventory(
    helper,
    directory,
    label,
  );
  if (
    inventory.entryCount >= AUTHORITY_RETIREMENT_MAX_ENTRIES ||
    inventory.totalBytes + BigInt(reservationBytes) >
      BigInt(LEASE_ARCHIVE_MAX_BYTES)
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} exceeds its bounded retirement capacity.`,
    );
  }
  const filesystem = parseLeaseArchiveFilesystemResult(
    runLeaseArchiveHelper(
      helper,
      "filesystem",
      pinnedDirectoryArguments(directory),
      [directory.descriptor],
    ),
    label,
  );
  if (
    !filesystem.local ||
    filesystem.device !== directory.identity.dev ||
    filesystem.availableBytes <
      BigInt(LEASE_ARCHIVE_MIN_FREE_BYTES) + BigInt(reservationBytes)
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} lacks local filesystem headroom for exact retirement.`,
    );
  }
  assertPinnedLeaseArchiveDirectory(directory);
}

function stageAutomationAuthorityBytes({
  helper,
  directory,
  directoryPath,
  existingStage,
  reusableCompletedReadyStage,
  provisionalStageName,
  namespaceDigest,
  proposedBytes,
  proposedDigest,
  operationId,
  canonicalBasename,
  privateRoot,
  maxBytes,
  reusableStageModes,
  helperTestPause,
  label,
}) {
  if (
    existingStage?.kind === "ready" &&
    existingStage.namespaceDigest === namespaceDigest
  ) {
    if (
      !existingStage.snapshot.bytes.equals(proposedBytes) ||
      automationAuthorityStableGenerationDigest(existingStage.snapshot) !==
        existingStage.successorStableDigest
    ) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} ready staging generation is not its exact proposed successor.`,
      );
    }
    return Object.freeze({
      entry: existingStage.entry,
      kind: "ready",
      namespaceDigest,
      successorStableDigest: existingStage.successorStableDigest,
      snapshot: existingStage.snapshot,
    });
  }
  if (
    existingStage !== null &&
    !(
      (existingStage.kind === "provisional" &&
        existingStage.namespaceDigest === namespaceDigest &&
        existingStage.entry === provisionalStageName) ||
      (existingStage.kind === "ready" && reusableCompletedReadyStage)
    )
  ) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} has a provisional generation for a different operation.`,
    );
  }
  let sourceStage = existingStage;
  let lastError = null;
  let staged = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const provisionalStagePath = path.join(directoryPath, provisionalStageName);
    if (
      sourceStage !== null &&
      sourceStage.entry === provisionalStageName &&
      sourceStage.snapshot.bytes.equals(proposedBytes)
    ) {
      staged = sourceStage.snapshot;
      break;
    }
    let binding;
    const sourceSnapshot = sourceStage?.snapshot ?? null;
    let receipt = null;
    try {
      if (sourceStage === null) {
        const result = runLeaseArchiveHelper(
          helper,
          "authority-stage-create",
          [
            provisionalStageName,
            "384",
            proposedBytes.length.toString(),
            proposedDigest,
            ...automationAuthorityParentIdentityArguments(directory),
          ],
          [directory.descriptor],
          proposedBytes,
          attempt === 0 ? helperTestPause : undefined,
        );
        receipt = parseAutomationAuthorityReceipt(
          result,
          {
            operation: "authority-stage-create",
            names: { name: provisionalStageName },
            identityPrefixes: ["result"],
            parentPrefixes: ["parent"],
            requested: {
              requestedMode: "384",
              requestedSize: proposedBytes.length.toString(),
              requestedDigest: proposedDigest,
            },
          },
          label,
        );
      } else {
        binding = openPinnedAutomationAuthorityFile(
          path.join(directoryPath, sourceStage.entry),
          sourceStage.snapshot,
          `${label} staging generation`,
          { maxBytes, allowedModes: reusableStageModes, writable: true },
        );
        const result = runLeaseArchiveHelper(
          helper,
          "authority-stage-rewrite",
          [
            sourceStage.entry,
            provisionalStageName,
            ...automationAuthorityFileIdentityArguments(binding),
            "384",
            proposedBytes.length.toString(),
            proposedDigest,
            ...automationAuthorityParentIdentityArguments(directory),
          ],
          [directory.descriptor, binding.descriptor],
          proposedBytes,
          attempt === 0 ? helperTestPause : undefined,
        );
        receipt = parseAutomationAuthorityReceipt(
          result,
          {
            operation: "authority-stage-rewrite",
            names: {
              oldName: sourceStage.entry,
              newName: provisionalStageName,
            },
            identityPrefixes: ["old", "result"],
            parentPrefixes: ["parent"],
            requested: {
              requestedMode: "384",
              requestedSize: proposedBytes.length.toString(),
              requestedDigest: proposedDigest,
            },
          },
          label,
        );
        requireAutomationAuthorityReceiptIdentity(
          receipt,
          "old",
          sourceStage.snapshot,
          label,
        );
      }
      requireAutomationAuthorityReceiptParent(
        receipt,
        "parent",
        directory,
        label,
      );
      lastError = null;
    } catch (error) {
      lastError = error;
    } finally {
      if (binding !== undefined) closeSync(binding.descriptor);
    }
    const expected = readAutomationAuthorityStage(provisionalStagePath, {
      privateRoot,
      maxBytes,
      allowedModes: [0o600],
      label: `${label} staging generation`,
    });
    requireAutomationAuthoritySnapshotDirectory(
      expected,
      directory,
      `${label} staging generation`,
    );
    if (!expected.missing && expected.bytes.equals(proposedBytes)) {
      if (receipt !== null) {
        requireAutomationAuthorityReceiptIdentity(
          receipt,
          "result",
          expected,
          label,
        );
      } else if (
        sourceSnapshot === null ||
        !automationAuthoritySameInode(expected, sourceSnapshot)
      ) {
        removeAutomationAuthorityFile({
          filePath: provisionalStagePath,
          snapshot: expected,
          operationId: `authority-stage-error-retire:${operationId}:${attempt}`,
          privateRoot,
          maxBytes,
          allowedModes: reusableStageModes,
          label: `${label} unproven staging generation`,
          retirementBasename: canonicalBasename,
          rawSource: true,
        });
        sourceStage = null;
        continue;
      }
      fsyncSync(directory.descriptor);
      staged = expected;
      break;
    }
    if (!expected.missing) {
      if (
        sourceSnapshot !== null &&
        automationAuthoritySameInode(expected, sourceSnapshot)
      ) {
        sourceStage = Object.freeze({
          entry: provisionalStageName,
          kind: "provisional",
          namespaceDigest,
          successorStableDigest: null,
          snapshot: expected,
        });
      } else {
        removeAutomationAuthorityFile({
          filePath: provisionalStagePath,
          snapshot: expected,
          operationId: `authority-stage-error-retire:${operationId}:${attempt}`,
          privateRoot,
          maxBytes,
          allowedModes: reusableStageModes,
          label: `${label} unproven staging generation`,
          retirementBasename: canonicalBasename,
          rawSource: true,
        });
        sourceStage = null;
      }
      continue;
    }
    if (sourceStage !== null) {
      const oldPath = path.join(directoryPath, sourceStage.entry);
      const old = readAutomationAuthorityStage(oldPath, {
        privateRoot,
        maxBytes,
        allowedModes: reusableStageModes,
        label: `${label} staging generation`,
      });
      requireAutomationAuthoritySnapshotDirectory(
        old,
        directory,
        `${label} staging generation`,
      );
      if (!old.missing) {
        if (
          sourceSnapshot !== null &&
          automationAuthoritySameInode(old, sourceSnapshot)
        ) {
          sourceStage = Object.freeze({ ...sourceStage, snapshot: old });
        } else {
          removeAutomationAuthorityFile({
            filePath: oldPath,
            snapshot: old,
            operationId: `authority-stage-error-retire:${operationId}:${attempt}:source`,
            privateRoot,
            maxBytes,
            allowedModes: reusableStageModes,
            label: `${label} unproven staging source`,
            retirementBasename: canonicalBasename,
            rawSource: true,
          });
          sourceStage = null;
        }
        continue;
      }
    }
    if (lastError !== null) throw lastError;
  }
  if (staged === null) {
    if (lastError !== null) throw lastError;
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} staging did not converge to its exact proposed bytes.`,
    );
  }

  const successorStableDigest =
    automationAuthorityStableGenerationDigest(staged);
  const readyStageName = automationAuthorityReadyStageName(
    path.join(directoryPath, canonicalBasename),
    namespaceDigest,
    successorStableDigest,
  );
  if (Buffer.byteLength(readyStageName, "utf8") > 255) {
    throw new AutomationControlError(
      "invalid_argument",
      `${label} ready staging name exceeds its bounded filesystem contract.`,
    );
  }
  const readyStagePath = path.join(directoryPath, readyStageName);
  const readyRenameTestPause =
    helperTestPause?.operation === "authority-retire" &&
    (helperTestPause.source === provisionalStageName ||
      helperTestPause.destination === readyStageName)
      ? helperTestPause
      : undefined;
  let binding;
  let receipt = null;
  let helperError = null;
  try {
    binding = openPinnedAutomationAuthorityFile(
      path.join(directoryPath, provisionalStageName),
      staged,
      `${label} provisional staging generation`,
      { maxBytes, allowedModes: [0o600] },
    );
    try {
      const result = runLeaseArchiveHelper(
        helper,
        "authority-retire",
        [
          provisionalStageName,
          readyStageName,
          ...automationAuthorityFileIdentityArguments(binding),
          ...automationAuthorityParentIdentityArguments(directory),
          ...automationAuthorityParentIdentityArguments(directory),
        ],
        [directory.descriptor, directory.descriptor, binding.descriptor],
        undefined,
        readyRenameTestPause,
      );
      receipt = parseAutomationAuthorityReceipt(
        result,
        {
          operation: "authority-retire",
          names: {
            sourceName: provisionalStageName,
            quarantineName: readyStageName,
          },
          identityPrefixes: ["source", "sourceAfter"],
          parentPrefixes: ["sourceParent", "quarantineParent"],
        },
        label,
      );
      requireAutomationAuthorityReceiptIdentity(
        receipt,
        "source",
        staged,
        label,
      );
      requireAutomationAuthorityReceiptParent(
        receipt,
        "sourceParent",
        directory,
        label,
      );
      requireAutomationAuthorityReceiptParent(
        receipt,
        "quarantineParent",
        directory,
        label,
      );
    } catch (error) {
      helperError = error;
    }
  } finally {
    if (binding !== undefined) closeSync(binding.descriptor);
  }
  const provisionalAfter = readAutomationAuthorityStage(
    path.join(directoryPath, provisionalStageName),
    {
      privateRoot,
      maxBytes,
      allowedModes: reusableStageModes,
      label: `${label} provisional staging generation`,
    },
  );
  requireAutomationAuthoritySnapshotDirectory(
    provisionalAfter,
    directory,
    `${label} provisional staging generation`,
  );
  const ready = readAutomationAuthorityStage(readyStagePath, {
    privateRoot,
    maxBytes,
    allowedModes: [0o600],
    label: `${label} ready staging generation`,
  });
  requireAutomationAuthoritySnapshotDirectory(
    ready,
    directory,
    `${label} ready staging generation`,
  );
  if (
    !provisionalAfter.missing ||
    ready.missing ||
    !automationAuthorityStableGenerationMatches(ready, staged) ||
    automationAuthorityStableGenerationDigest(ready) !== successorStableDigest
  ) {
    if (helperError !== null) throw helperError;
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} did not durably bind its ready successor generation.`,
    );
  }
  if (receipt !== null) {
    requireAutomationAuthorityReceiptIdentity(
      receipt,
      "sourceAfter",
      ready,
      label,
    );
  }
  fsyncSync(directory.descriptor);
  return Object.freeze({
    entry: readyStageName,
    kind: "ready",
    namespaceDigest,
    successorStableDigest,
    snapshot: ready,
  });
}

export function writeAutomationAuthorityFile({
  filePath,
  bytes,
  previousSnapshot,
  operationId,
  privateRoot = previousSnapshot?.privateRoot,
  maxBytes = LEASE_TRANSACTION_MAX_BYTES,
  allowedModes = [0o600],
  label = "Automation authority file",
  beforePublish = () => {},
  helperTestPause = undefined,
  validateStageSuccessor = null,
  buildStagePendingPlans = () => [],
}) {
  requireOutsideAutomationPlanningReadCallback(
    "Automation authority file publication",
  );
  const normalizedFilePath = path.resolve(filePath);
  const normalizedPrivateRoot = path.resolve(privateRoot);
  const proposedBytes = Buffer.from(bytes);
  if (
    previousSnapshot?.filePath !== normalizedFilePath ||
    previousSnapshot?.privateRoot !== normalizedPrivateRoot ||
    typeof operationId !== "string" ||
    operationId.length === 0 ||
    operationId.length > 512 ||
    operationId.includes("\0") ||
    proposedBytes.length > maxBytes
  ) {
    throw new AutomationControlError(
      "invalid_argument",
      `${label} publication arguments are invalid.`,
    );
  }
  const directoryPath = path.dirname(normalizedFilePath);
  const proposedDigest = digestBytes(proposedBytes);
  const namespaceDigest = automationAuthorityNamespace({
    filePath: normalizedFilePath,
    operationId,
    proposedDigest,
    previousSnapshot,
  });
  const provisionalStageName = automationAuthorityProvisionalStageName(
    normalizedFilePath,
    namespaceDigest,
  );
  if (Buffer.byteLength(provisionalStageName, "utf8") > 255) {
    throw new AutomationControlError(
      "invalid_argument",
      `${label} provisional staging name exceeds its bounded filesystem contract.`,
    );
  }
  const maximumReadyStageName = automationAuthorityReadyStageName(
    normalizedFilePath,
    namespaceDigest,
    "0".repeat(64),
  );
  if (Buffer.byteLength(maximumReadyStageName, "utf8") > 255) {
    throw new AutomationControlError(
      "invalid_argument",
      `${label} ready staging name exceeds its bounded filesystem contract.`,
    );
  }
  const reusableStageModes = [...new Set([0o600, ...allowedModes])];
  const snapshotOptions = {
    allowMissing: true,
    allowEmpty: true,
    privateRoot: normalizedPrivateRoot,
    maxBytes,
    allowedModes,
    invalidCode: "authority_generation_conflict",
  };
  let current;
  let directory;
  try {
    directory = openPinnedLeaseArchiveDirectory(
      directoryPath,
      `${label} parent directory`,
    );
  } catch (error) {
    throw new AutomationControlError(
      "authority_generation_conflict",
      `${label} changed from its admitted parent generation.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  let source;
  let destination;
  let helperError = null;
  let receipt = null;
  try {
    requireAutomationAuthorityDirectoryGeneration(
      directory,
      previousSnapshot.directoryIdentity,
      `${label} parent directory`,
    );
    current = readAutomationAuthorityFileSnapshot(normalizedFilePath, {
      ...snapshotOptions,
      label,
    });
    requireAutomationAuthoritySnapshotDirectory(current, directory, label);
    const helper = openPinnedLeaseArchiveHelper();
    const stageEntries = listAutomationAuthorityStages(
      normalizedFilePath,
      helper,
      directory,
    );
    if (stageEntries.length > 1) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} has more than one authority staging generation.`,
      );
    }
    let stageEntry = stageEntries[0] ?? null;
    if (stageEntry !== null) {
      const snapshot = readAutomationAuthorityStage(
        path.join(directoryPath, stageEntry.entry),
        {
          privateRoot: normalizedPrivateRoot,
          maxBytes,
          allowedModes: reusableStageModes,
          label: `${label} staging generation`,
        },
      );
      if (snapshot.missing) {
        throw new AutomationControlError(
          "authority_generation_conflict",
          `${label} staging generation disappeared during admission.`,
        );
      }
      requireAutomationAuthoritySnapshotDirectory(
        snapshot,
        directory,
        `${label} staging generation`,
      );
      stageEntry = Object.freeze({ ...stageEntry, snapshot });
    }
    const currentMatchesPrevious = automationAuthoritySnapshotMatches(
      current,
      previousSnapshot,
    );
    const currentStableDigest = current.missing
      ? null
      : automationAuthorityStableGenerationDigest(current);
    const semanticStageAdmission =
      validateStageSuccessor === null
        ? null
        : requireSemanticAutomationAuthorityStage({
            filePath: normalizedFilePath,
            current,
            stageEntry,
            pendingPlans: buildStagePendingPlans(current),
            validateSuccessor: validateStageSuccessor,
            label,
          });
    const stageWitnessesCurrent =
      stageEntry?.kind === "ready" &&
      stageEntry.successorStableDigest === currentStableDigest &&
      (semanticStageAdmission === null ||
        semanticStageAdmission.kind === "settled");
    if (!currentMatchesPrevious) {
      if (
        !previousSnapshot.missing &&
        stageEntry?.kind === "ready" &&
        stageEntry.namespaceDigest === namespaceDigest &&
        !current.missing &&
        current.bytes.equals(proposedBytes) &&
        stageEntry.successorStableDigest === currentStableDigest &&
        automationAuthorityStableGenerationMatches(
          stageEntry.snapshot,
          previousSnapshot,
        )
      ) {
        fsyncSync(directory.descriptor);
        requireAutomationAuthorityDirectoryGeneration(
          directory,
          previousSnapshot.directoryIdentity,
          `${label} parent directory`,
        );
        return current;
      }
      // A create-only rename consumes its ready name. After a whole-process
      // crash there is no durable predecessor witness for the canonical inode.
      // Higher-level WAL or deterministic event recovery must reconcile it.
      // This generic primitive refuses to infer success from matching bytes.
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} changed immediately before publication.`,
      );
    }
    if (
      currentMatchesPrevious &&
      !current.missing &&
      current.bytes.equals(proposedBytes)
    ) {
      if (stageEntry === null || stageWitnessesCurrent) {
        fsyncSync(directory.descriptor);
        return current;
      }
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} has a pending same-operation staging generation.`,
      );
    }
    const reusableCompletedReadyStage =
      stageEntry?.kind === "ready" &&
      stageEntry.namespaceDigest !== namespaceDigest &&
      stageWitnessesCurrent;
    if (
      stageEntry !== null &&
      !(
        (stageEntry.kind === "provisional" &&
          stageEntry.namespaceDigest === namespaceDigest) ||
        (stageEntry.kind === "ready" &&
          (stageEntry.namespaceDigest === namespaceDigest ||
            reusableCompletedReadyStage))
      )
    ) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} has a pending staging generation for a different operation.`,
      );
    }
    const staged = stageAutomationAuthorityBytes({
      helper,
      directory,
      directoryPath,
      existingStage: stageEntry,
      reusableCompletedReadyStage,
      provisionalStageName,
      namespaceDigest,
      proposedBytes,
      proposedDigest,
      operationId,
      canonicalBasename: path.basename(normalizedFilePath),
      privateRoot: normalizedPrivateRoot,
      maxBytes,
      reusableStageModes,
      helperTestPause,
      label,
    });
    current = readAutomationAuthorityFileSnapshot(normalizedFilePath, {
      ...snapshotOptions,
      label,
    });
    requireAutomationAuthoritySnapshotDirectory(current, directory, label);
    if (!automationAuthoritySnapshotMatches(current, previousSnapshot)) {
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} changed after staging and before publication.`,
      );
    }
    source = openPinnedAutomationAuthorityFile(
      path.join(directoryPath, staged.entry),
      staged.snapshot,
      `${label} staging generation`,
      { maxBytes, allowedModes: [0o600] },
    );
    if (!current.missing) {
      destination = openPinnedAutomationAuthorityFile(
        normalizedFilePath,
        current,
        label,
        { maxBytes, allowedModes },
      );
    }
    beforePublish();
    try {
      if (destination === undefined) {
        const result = runLeaseArchiveHelper(
          helper,
          "authority-retire",
          [
            staged.entry,
            path.basename(normalizedFilePath),
            ...automationAuthorityFileIdentityArguments(source),
            ...automationAuthorityParentIdentityArguments(directory),
            ...automationAuthorityParentIdentityArguments(directory),
          ],
          [directory.descriptor, directory.descriptor, source.descriptor],
          undefined,
          helperTestPause,
        );
        receipt = parseAutomationAuthorityReceipt(
          result,
          {
            operation: "authority-retire",
            names: {
              sourceName: staged.entry,
              quarantineName: path.basename(normalizedFilePath),
            },
            identityPrefixes: ["source", "sourceAfter"],
            parentPrefixes: ["sourceParent", "quarantineParent"],
          },
          label,
        );
        requireAutomationAuthorityReceiptIdentity(
          receipt,
          "source",
          staged.snapshot,
          label,
        );
        requireAutomationAuthorityReceiptParent(
          receipt,
          "sourceParent",
          directory,
          label,
        );
        requireAutomationAuthorityReceiptParent(
          receipt,
          "quarantineParent",
          directory,
          label,
        );
      } else {
        const result = runLeaseArchiveHelper(
          helper,
          "authority-exchange",
          [
            staged.entry,
            path.basename(normalizedFilePath),
            ...automationAuthorityFileIdentityArguments(source),
            ...automationAuthorityFileIdentityArguments(destination),
            ...automationAuthorityParentIdentityArguments(directory),
            ...automationAuthorityParentIdentityArguments(directory),
          ],
          [
            directory.descriptor,
            directory.descriptor,
            source.descriptor,
            destination.descriptor,
          ],
          undefined,
          helperTestPause,
        );
        receipt = parseAutomationAuthorityReceipt(
          result,
          {
            operation: "authority-exchange",
            names: {
              sourceName: staged.entry,
              destinationName: path.basename(normalizedFilePath),
            },
            identityPrefixes: [
              "source",
              "destination",
              "sourceAfter",
              "destinationAfter",
            ],
            parentPrefixes: ["sourceParent", "destinationParent"],
          },
          label,
        );
        requireAutomationAuthorityReceiptIdentity(
          receipt,
          "source",
          staged.snapshot,
          label,
        );
        requireAutomationAuthorityReceiptIdentity(
          receipt,
          "destination",
          previousSnapshot,
          label,
        );
        requireAutomationAuthorityReceiptParent(
          receipt,
          "sourceParent",
          directory,
          label,
        );
        requireAutomationAuthorityReceiptParent(
          receipt,
          "destinationParent",
          directory,
          label,
        );
      }
    } catch (error) {
      helperError = error;
    }
    const published = readAutomationAuthorityFileSnapshot(normalizedFilePath, {
      ...snapshotOptions,
      label,
    });
    requireAutomationAuthoritySnapshotDirectory(published, directory, label);
    if (
      published.missing ||
      !automationAuthorityStableGenerationMatches(published, staged.snapshot) ||
      automationAuthorityStableGenerationDigest(published) !==
        staged.successorStableDigest
    ) {
      if (helperError !== null) throw helperError;
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} did not publish its exact proposed generation.`,
      );
    }
    const stageAfter = readAutomationAuthorityStage(
      path.join(directoryPath, staged.entry),
      {
        privateRoot: normalizedPrivateRoot,
        maxBytes,
        allowedModes: reusableStageModes,
        label: `${label} post-publication staging generation`,
      },
    );
    requireAutomationAuthoritySnapshotDirectory(
      stageAfter,
      directory,
      `${label} post-publication staging generation`,
    );
    if (previousSnapshot.missing) {
      if (!stageAfter.missing) {
        if (helperError !== null) throw helperError;
        throw new AutomationControlError(
          "authority_generation_conflict",
          `${label} create-only staging path survived publication.`,
        );
      }
    } else if (
      stageAfter.missing ||
      !automationAuthorityStableGenerationMatches(stageAfter, previousSnapshot)
    ) {
      if (helperError !== null) throw helperError;
      throw new AutomationControlError(
        "authority_generation_conflict",
        `${label} exchange did not preserve its exact predecessor.`,
      );
    }
    if (receipt !== null) {
      requireAutomationAuthorityReceiptIdentity(
        receipt,
        "sourceAfter",
        published,
        label,
      );
      if (!previousSnapshot.missing) {
        requireAutomationAuthorityReceiptIdentity(
          receipt,
          "destinationAfter",
          stageAfter,
          label,
        );
      }
    }
    fsyncSync(directory.descriptor);
    requireAutomationAuthorityDirectoryGeneration(
      directory,
      previousSnapshot.directoryIdentity,
      `${label} parent directory`,
    );
    return published;
  } finally {
    if (destination !== undefined) closeSync(destination.descriptor);
    if (source !== undefined) closeSync(source.descriptor);
    closeSync(directory.descriptor);
  }
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

function leaseCleanupGenerationDigest(filePath, snapshot) {
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
        Object.keys(value ?? {})
          .sort()
          .join("\n") !==
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
      invokeLeaseTransactionCheckpoint(checkpoint, "lease-directory-created", {
        directoryPath: nextPath,
        parentPath,
      });
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
      leaseStateQuarantineDirectory(paths),
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
    Object.keys(value ?? {})
      .sort()
      .join("\n") !==
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
    "list-bounded",
    [
      LEASE_ARCHIVE_MAX_ENTRIES.toString(),
      Math.min(
        LEASE_ARCHIVE_LIST_MAX_BUFFER,
        LEASE_BOUNDED_DIRECTORY_MAX_BYTES,
      ).toString(),
      ...pinnedDirectoryArguments(binding),
    ],
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
      held.size < 0n ||
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

function inspectLeaseStateArchiveEntry(
  paths,
  parentBinding,
  entry,
  expectedDevice,
) {
  const entryPath = path.join(parentBinding.path, entry);
  let directory;
  try {
    directory = openPinnedLeaseArchiveDirectory(
      entryPath,
      `Lease state archive directory ${entryPath}`,
    );
    if (directory.identity.dev !== expectedDevice) {
      throw new Error("retired lease directory is on the wrong device");
    }
    const entries = readBoundedLeaseDirectoryEntries(entryPath, {
      maxEntries: 1,
      label: `Lease state archive directory ${entryPath}`,
      errorCode: "lease_archive_capacity_invalid",
    }).sort();
    if (
      entries.length > 1 ||
      (entries.length === 1 && entries[0] !== "lease.json")
    ) {
      throw new Error("retired lease directory has unsupported entries");
    }
    let size = 0;
    let oldestMtimeMs = Number(lstatSync(entryPath, { bigint: true }).mtimeMs);
    if (entries.length === 1) {
      const record = inspectLeaseArchiveEntry(
        directory,
        "lease.json",
        expectedDevice,
      );
      size = record.size;
      oldestMtimeMs = Math.min(oldestMtimeMs, record.mtimeMs);
      readPrivateBytes(
        path.join(entryPath, "lease.json"),
        "Retired lease state record",
        { privateRoot: paths.controlRoot },
      );
    }
    assertPinnedLeaseArchiveDirectory(directory);
    assertPinnedLeaseArchiveDirectory(parentBinding);
    return Object.freeze({ size, mtimeMs: oldestMtimeMs });
  } catch (error) {
    if (error instanceof AutomationControlError) throw error;
    throw new AutomationControlError(
      "lease_archive_capacity_invalid",
      `Lease state archive entry ${entryPath} is not one exact private lease directory.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    if (directory !== undefined) closeSync(directory.descriptor);
  }
}

export function inspectLeaseCleanupArchiveCapacity(
  stateRoot = undefined,
  { nowMs = Date.now(), reservation = undefined, limits = undefined } = {},
) {
  requireOutsideAutomationPlanningReadCallback(
    "Lease cleanup archive capacity inspection",
  );
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
      leaseStateQuarantineDirectory(paths),
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
      /^(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\.[0-9a-f]{64})?\.[0-9a-f]{64}\.json$/;
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
        const inspected = inspectLeaseArchiveEntry(binding, entry, stateDevice);
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
    const stateArchiveDirectory = leaseStateQuarantineDirectory(paths);
    const stateArchiveBinding = directoryBindings.find(
      (candidate) => candidate.path === stateArchiveDirectory,
    );
    const stateArchiveNamePattern = /^[0-9a-f]{64}\.[0-9a-f]{64}\.lease$/;
    const stateEntriesBefore = listPinnedLeaseArchiveDirectory(
      context,
      stateArchiveBinding,
    );
    for (const entry of stateEntriesBefore) {
      if (!stateArchiveNamePattern.test(entry)) {
        throw new AutomationControlError(
          "lease_archive_capacity_invalid",
          `Lease state archive ${path.join(stateArchiveDirectory, entry)} has an invalid name.`,
        );
      }
      const inspected = inspectLeaseStateArchiveEntry(
        paths,
        stateArchiveBinding,
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
    const stateEntriesAfter = listPinnedLeaseArchiveDirectory(
      context,
      stateArchiveBinding,
    );
    if (stateEntriesBefore.join("\0") !== stateEntriesAfter.join("\0")) {
      throw new AutomationControlError(
        "lease_archive_capacity_invalid",
        `${stateArchiveBinding.label} changed during capacity accounting.`,
      );
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

function leaseAtomicArchiveSpecifications(paths, transaction, archiveScope) {
  const files = leaseTransactionFiles(
    paths,
    transaction.name,
    transaction.operationId,
    transaction.operation,
  );
  const specifications = [];
  const add = (
    target,
    filePath,
    kind,
    evidenceClass,
    sourceIdentity = "temporary",
  ) => {
    if (filePath === null) return;
    const temporaryPath =
      sourceIdentity === "canonical"
        ? filePath
        : leaseAtomicTemporaryPath(filePath, transaction);
    const archivePrefix = leaseAtomicRetirementNamespace(
      transaction.operationId,
      temporaryPath,
      kind,
    );
    specifications.push(
      Object.freeze({
        operationId: transaction.operationId,
        target,
        filePath,
        temporaryPath,
        kind,
        evidenceClass,
        archivePrefix,
        selectionPrefix: `${transaction.operationId}.${archivePrefix}`,
      }),
    );
  };
  if (archiveScope === "transaction") {
    for (const side of ["before", "after"]) {
      const filePath = transaction.staging[`${side}Path`];
      const kind = `${side} staging`;
      add(
        `staging-${side}`,
        filePath,
        leaseAtomicSuccessorKind(kind),
        "successor",
      );
      add(
        `staging-${side}`,
        filePath,
        leaseAtomicPreWalCleanupKind(kind),
        "pre-wal-cleanup",
      );
      add(
        `staging-${side}`,
        filePath,
        "obsolete pre-WAL staging",
        "pre-wal-cleanup",
      );
      add(
        `staging-${side}`,
        filePath,
        "obsolete pre-WAL staging",
        "pre-wal-cleanup",
        "canonical",
      );
    }
    add("wal", files.transaction, "WAL", "canonical-or-successor");
    add("wal", files.transaction, leaseAtomicSuccessorKind("WAL"), "successor");
    add(
      "wal",
      files.transaction,
      leaseAtomicPreWalCleanupKind("WAL"),
      "pre-wal-cleanup",
    );
    add(
      "wal",
      files.transaction,
      leaseAtomicCompletionResidueKind("WAL"),
      "non-authoritative-residue",
    );
    const recordPath = leaseRecordPath(leasePathFor(paths, transaction.name));
    add(
      "record",
      recordPath,
      "canonical lease record",
      "canonical-or-successor",
    );
    add(
      "record",
      recordPath,
      leaseAtomicSuccessorKind("canonical lease record"),
      "successor",
    );
  } else {
    add("receipt", files.receipt, "receipt", "successor");
    add(
      "receipt",
      files.receipt,
      leaseAtomicSuccessorKind("receipt"),
      "successor",
    );
  }
  return Object.freeze(specifications);
}

function leaseAtomicArchiveSpecificationMatches(
  archivePath,
  specification,
  snapshot,
) {
  return (
    path.join(
      path.dirname(archivePath),
      `${specification.selectionPrefix}.${leaseCleanupGenerationDigest(
        specification.temporaryPath,
        snapshot,
      )}.json`,
    ) === archivePath
  );
}

function leaseCleanupArchivePrefixes(paths, transaction, archiveScope) {
  return Object.freeze([
    ...new Set([
      transaction.operationId,
      ...leaseAtomicArchiveSpecifications(paths, transaction, archiveScope).map(
        (specification) => specification.selectionPrefix,
      ),
    ]),
  ]);
}

function leaseCleanupQuarantinePathMatchesTransaction(
  paths,
  transaction,
  archiveScope,
  archivePath,
  filePath,
  snapshot,
) {
  if (
    leaseCleanupQuarantinePathMatches(
      archivePath,
      filePath,
      transaction.operationId,
      snapshot,
    )
  ) {
    return true;
  }
  const files = leaseTransactionFiles(
    paths,
    transaction.name,
    transaction.operationId,
    transaction.operation,
  );
  const canonicalPath =
    archiveScope === "transaction" ? files.transaction : files.receipt;
  if (archiveScope !== "transaction" || filePath !== canonicalPath) {
    return false;
  }
  const specification = leaseAtomicArchiveSpecifications(
    paths,
    transaction,
    archiveScope,
  ).find((candidate) => candidate.target === "wal" && candidate.kind === "WAL");
  return (
    specification !== undefined &&
    leaseAtomicArchiveSpecificationMatches(archivePath, specification, snapshot)
  );
}

function readLeaseCleanupArchiveEntries(
  paths,
  directoryPath,
  cleanupOperationIds,
) {
  if (!pathEntryExists(directoryPath)) return [];
  requirePrivateDirectory(directoryPath, "Lease cleanup quarantine directory");
  const operationIds = Array.isArray(cleanupOperationIds)
    ? [...new Set(cleanupOperationIds)]
    : [cleanupOperationIds];
  return readBoundedLeaseDirectoryEntries(directoryPath, {
    maxEntries: LEASE_ARCHIVE_MAX_ENTRIES,
    maxEncodedBytes: LEASE_BOUNDED_DIRECTORY_MAX_BYTES,
    label: "Lease cleanup quarantine directory",
    errorCode: "lease_archive_capacity_invalid",
  })
    .filter((entry) =>
      operationIds.some((value) => entry.startsWith(`${value}.`)),
    )
    .sort()
    .map((entry) => {
      if (
        !operationIds.some(
          (value) =>
            entry.startsWith(`${value}.`) &&
            /^[0-9a-f]{64}\.json$/.test(entry.slice(value.length + 1)),
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
        {
          allowEmpty: true,
          privateRoot: paths.controlRoot,
          includeMetadata: true,
          requireUtf8: false,
        },
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

function validateActiveLeaseTransactionSnapshot(paths, transaction, snapshot) {
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

function requireExactCompletedLeaseWalLineage(transaction, generations) {
  if (transaction.phase !== "complete") {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease transaction for ${transaction.name} has no completed WAL lineage.`,
    );
  }
  const expectedByPhase = new Map(
    ["prepared", "state-committed", "event-appended", "complete"].map(
      (phase) => [
        phase,
        phase === "complete"
          ? transaction
          : { ...transaction, phase, completedAt: null },
      ],
    ),
  );
  const observedPhases = new Map();
  for (const generation of generations) {
    const expected = expectedByPhase.get(generation.phase);
    if (expected === undefined || !canonicalValuesEqual(generation, expected)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Completed lease transaction for ${transaction.name} has an inexact WAL phase lineage.`,
      );
    }
    const observedCount = observedPhases.get(generation.phase) ?? 0;
    if (generation.phase !== "prepared" && observedCount !== 0) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Completed lease transaction for ${transaction.name} has duplicate committed WAL phases.`,
      );
    }
    observedPhases.set(generation.phase, observedCount + 1);
  }
  if (
    observedPhases.size !== expectedByPhase.size ||
    [...expectedByPhase.keys()].some(
      (phase) => (observedPhases.get(phase) ?? 0) === 0,
    )
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Completed lease transaction for ${transaction.name} does not retain every exact WAL phase.`,
    );
  }
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
    leaseCleanupArchivePrefixes(paths, proposed, "transaction"),
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
  const [retired] = retiredTransactions;
  if (
    retiredTransactions.some(
      (candidate) => !canonicalValuesEqual(candidate, retired),
    )
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease operation ${proposed.operationId} has multiple retired WAL identities.`,
    );
  }
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
      ({ quarantinePath, snapshot }) =>
        leaseCleanupQuarantinePathMatches(
          quarantinePath,
          retired.staging[`${side}Path`],
          proposed.operationId,
          snapshot,
        ) &&
        snapshot.bytes.length === descriptor.recordSize &&
        digestBytes(snapshot.bytes) === descriptor.recordDigest,
    );
    if (matches.length === 0) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Retired lease operation ${proposed.operationId} has ambiguous ${side} staging.`,
      );
    }
    for (const match of matches) {
      validateLeaseStagingSnapshot(retired, side, match.snapshot);
      if (!match.snapshot.bytes.equals(matches[0].snapshot.bytes)) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Retired lease operation ${proposed.operationId} has changed ${side} staging.`,
        );
      }
    }
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

function indexLeaseCleanupRequirements(requirements) {
  const indexed = new Map();
  for (const requirement of requirements) {
    const key = leaseCleanupStagingDescriptorKey(requirement.descriptor);
    const queue = indexed.get(key) ?? { items: [], consumed: 0 };
    queue.items.push(requirement);
    indexed.set(key, queue);
  }
  return indexed;
}

function consumeLeaseCleanupRequirement(indexed, descriptorKey) {
  const queue = indexed.get(descriptorKey);
  if (queue === undefined || queue.consumed >= queue.items.length) return null;
  const requirement = queue.items[queue.consumed];
  queue.consumed += 1;
  return requirement;
}

function leaseCleanupRequirementsComplete(indexed) {
  return [...indexed.values()].every(
    (queue) => queue.consumed === queue.items.length,
  );
}

export function consumeLeaseCleanupRequirementsForTest(count) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) {
    throw new AutomationControlError(
      "invalid_argument",
      "Lease cleanup requirement test count is outside its exact boundary.",
    );
  }
  const requirements = Array.from({ length: count }, (_, index) => ({
    descriptor: {
      recordSize: index + 1,
      recordDigest: index.toString(16).padStart(64, "0"),
    },
  }));
  const indexed = indexLeaseCleanupRequirements(requirements);
  let consumed = 0;
  for (const requirement of requirements) {
    if (
      consumeLeaseCleanupRequirement(
        indexed,
        leaseCleanupStagingDescriptorKey(requirement.descriptor),
      ) !== null
    ) {
      consumed += 1;
    }
  }
  return Object.freeze({
    indexed: requirements.length,
    consumed,
    complete: leaseCleanupRequirementsComplete(indexed),
  });
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
  requireCanonicalCompletedLeaseReceiptBytes(
    snapshot.bytes,
    receipt,
    "Archived lease transaction receipt",
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
  admittedCanonicalSnapshots = undefined,
  admittedCleanupArchives = undefined,
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
      target.canonicalSnapshot = admittedCanonicalSnapshots?.has(
        target.filePath,
      )
        ? admittedCanonicalSnapshots.get(target.filePath)
        : readCanonicalLeaseCleanupSnapshot(paths, target);
    }
  }

  const transactionArchiveDirectory = leaseCleanupQuarantineDirectory(
    files.transaction,
  );
  const receiptArchiveDirectory = leaseCleanupQuarantineDirectory(
    files.receipt,
  );
  const currentOperationArchives = (
    admittedCleanupArchives === undefined
      ? [
          ...readLeaseCleanupArchiveEntries(
            paths,
            transactionArchiveDirectory,
            leaseCleanupArchivePrefixes(paths, transaction, "transaction"),
          ).map((entry) =>
            Object.freeze({ ...entry, archiveScope: "transaction" }),
          ),
          ...readLeaseCleanupArchiveEntries(
            paths,
            receiptArchiveDirectory,
            leaseCleanupArchivePrefixes(paths, transaction, "receipt"),
          ).map((entry) =>
            Object.freeze({ ...entry, archiveScope: "receipt" }),
          ),
        ]
      : admittedCleanupArchives instanceof Map
        ? (admittedCleanupArchives.get(transaction.operationId) ?? [])
        : admittedCleanupArchives.filter(
            (entry) => entry.operationId === transaction.operationId,
          )
  ).sort((left, right) =>
    left.quarantinePath.localeCompare(right.quarantinePath),
  );
  const atomicOperationArchives = [];
  const canonicalOperationArchives = [];
  for (const entry of currentOperationArchives) {
    const matches = leaseAtomicArchiveSpecifications(
      paths,
      transaction,
      entry.archiveScope,
    ).filter((specification) =>
      leaseAtomicArchiveSpecificationMatches(
        entry.quarantinePath,
        specification,
        entry.snapshot,
      ),
    );
    if (matches.length > 1) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease cleanup archive ${entry.entry} has an ambiguous atomic namespace.`,
      );
    }
    if (matches.length === 0) {
      canonicalOperationArchives.push(entry);
      continue;
    }
    const [specification] = matches;
    if (specification.target === "wal" && specification.kind === "WAL") {
      try {
        parseRetiredLeaseTransactionSnapshot(
          paths,
          transaction,
          entry.snapshot,
        );
        canonicalOperationArchives.push(
          Object.freeze({ ...entry, atomicSpecification: specification }),
        );
        continue;
      } catch {
        // A noncanonical generation under the normal WAL namespace is
        // classified below and rejected by semantic atomic admission.
      }
    }
    atomicOperationArchives.push(Object.freeze({ ...entry, specification }));
  }
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
  const mappedTransactionArchives = canonicalOperationArchives
    .filter((entry) => entry.archiveScope === "transaction")
    .map((entry) => {
      const matches = transactionArchiveSpecs.filter((spec) =>
        leaseCleanupQuarantinePathMatchesTransaction(
          paths,
          transaction,
          "transaction",
          entry.quarantinePath,
          spec.filePath,
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
    const cleanupOperationId = path
      .basename(entry.quarantinePath)
      .split(".")[0];
    const atomicSpecification = entry.atomicSpecification;
    retiredArchives.push({
      filePath:
        atomicSpecification === undefined
          ? files.transaction
          : atomicSpecification.temporaryPath,
      archivePath: entry.quarantinePath,
      snapshot: entry.snapshot,
      ...(atomicSpecification === undefined
        ? { cleanupOperationId }
        : {
            validateArchivePath: (snapshot) =>
              leaseAtomicArchiveSpecificationMatches(
                entry.quarantinePath,
                atomicSpecification,
                snapshot,
              ),
          }),
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

  if (transaction.phase === "complete") {
    requireExactCompletedLeaseWalLineage(transaction, [
      transaction,
      ...retiredTransactions,
    ]);
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
        .filter(
          (retired) =>
            transaction.phase !== "complete" &&
            retired.staging[`${side}Path`] !== null,
        )
        .map((retired) => ({
          kind: "retired",
          transaction: retired,
          descriptor: retired[side],
        })),
    ];
    const requirementsByDescriptor =
      indexLeaseCleanupRequirements(requirements);
    const entries = mappedTransactionArchives.filter(
      ({ kind }) => kind === `staging-${side}`,
    );
    for (const entry of entries) {
      parseLeaseRecordBytes(entry.snapshot.bytes, transaction.name);
      const entryKey = `${entry.snapshot.bytes.length}:${digestBytes(
        entry.snapshot.bytes,
      )}`;
      const requirement = consumeLeaseCleanupRequirement(
        requirementsByDescriptor,
        entryKey,
      );
      const replayDuplicate =
        requirement === null &&
        transaction.phase === "complete" &&
        entryKey === leaseCleanupStagingDescriptorKey(transaction[side]);
      if (requirement === null && !replayDuplicate) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease ${side} cleanup archive ${entry.entry} has no exact current or retired generation.`,
        );
      }
      validateLeaseStagingSnapshot(
        requirement?.transaction ?? transaction,
        side,
        entry.snapshot,
      );
      if (requirement?.kind === "current") {
        assignLeaseCleanupArchive(target, entry);
        continue;
      }
      retiredArchives.push({
        filePath: files[side],
        archivePath: entry.quarantinePath,
        snapshot: entry.snapshot,
        label: replayDuplicate
          ? `Retried lease ${side} staging`
          : `Retired lease ${side} staging`,
        validateSnapshot: (snapshot) =>
          validateLeaseStagingSnapshot(
            requirement?.transaction ?? transaction,
            side,
            snapshot,
          ),
      });
    }
    if (!leaseCleanupRequirementsComplete(requirementsByDescriptor)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${side} cleanup archives do not cover every exact current and retired generation.`,
      );
    }
  }

  for (const entry of canonicalOperationArchives.filter(
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
      !leaseCleanupQuarantinePathMatchesTransaction(
        paths,
        transaction,
        "receipt",
        entry.quarantinePath,
        originalPath,
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

  const stagingBytesBySide = new Map();
  for (const side of ["before", "after"]) {
    const target = targetsByPath.get(files[side]);
    const snapshot = target?.canonicalSnapshot ?? target?.archiveSnapshot;
    if (snapshot !== null && snapshot !== undefined) {
      stagingBytesBySide.set(side, snapshot.bytes);
    }
  }
  const normalizedAtomicEvidence = atomicOperationArchives.map((entry) =>
    Object.freeze({
      archiveScope: entry.archiveScope,
      entry: entry.entry,
      quarantinePath: entry.quarantinePath,
      kind: "atomic-evidence",
      atomicTarget: entry.specification.target,
      atomicKind: entry.specification.kind,
      evidenceClass: entry.specification.evidenceClass,
      originalPath: entry.specification.temporaryPath,
      identity: entry.snapshot.identity,
      contentDigest: digestBytes(entry.snapshot.bytes),
      bytes: entry.snapshot.bytes,
    }),
  );
  validateLeaseAtomicEvidenceSet(
    transaction,
    normalizedAtomicEvidence,
    stagingBytesBySide,
  );
  for (const [index, entry] of atomicOperationArchives.entries()) {
    const evidence = normalizedAtomicEvidence[index];
    retiredArchives.push({
      filePath: entry.specification.temporaryPath,
      archivePath: entry.quarantinePath,
      snapshot: entry.snapshot,
      label: `Retired lease ${entry.specification.target} atomic evidence`,
      allowEmpty: entry.snapshot.bytes.length === 0,
      validateArchivePath: (snapshot) =>
        leaseAtomicArchiveSpecificationMatches(
          entry.quarantinePath,
          entry.specification,
          snapshot,
        ),
      validateSnapshot: (snapshot) => {
        if (!snapshot.bytes.equals(evidence.bytes)) {
          throw new AutomationControlError(
            "lease_transaction_conflict",
            `Lease atomic evidence ${entry.entry} changed generation.`,
          );
        }
        validateLeaseAtomicEvidenceSet(
          transaction,
          [{ ...evidence, bytes: snapshot.bytes }],
          stagingBytesBySide,
        );
      },
    });
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
    archiveDirectories: Object.freeze(leaseCleanupArchiveDirectories(paths)),
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
    const directoryPaths = new Set([
      paths.stateRoot,
      ...plan.archiveDirectories,
    ]);
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
        { allowEmpty: archive.allowEmpty === true },
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
    [
      path.basename(target.filePath),
      ...pinnedDirectoryArguments(sourceDirectory),
    ],
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
  const archivePathMatches =
    typeof archive.validateArchivePath === "function"
      ? archive.validateArchivePath(snapshot)
      : leaseCleanupQuarantinePathMatches(
          archive.archivePath,
          archive.filePath,
          archive.cleanupOperationId ?? operationId,
          snapshot,
        );
  if (!archive.snapshot.bytes.equals(bytes) || !archivePathMatches) {
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

function validateExactLeaseCleanupArchiveSet(context, plan, terminalTargets) {
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
  for (const [directoryPath, expected] of expectedByDirectory) {
    const directory = context.directoryByPath.get(directoryPath);
    const prefixes = new Set(
      [...expected.keys()].map((entry) => entry.slice(0, entry.indexOf("."))),
    );
    const actualEntries = listPinnedLeaseArchiveDirectory(context, directory)
      .filter((entry) =>
        [...prefixes].some((prefix) => entry.startsWith(`${prefix}.`)),
      )
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
    const initialReservation = remainingLeaseCleanupArchiveReservation(
      plan.targets,
    );
    invokeLeaseTransactionCheckpoint(
      checkpoint,
      "lease-cleanup-before-capacity-recheck",
      initialReservation,
    );
    if (initialReservation.entries > 0) {
      requireLeaseCleanupArchiveCapacity(paths, initialReservation);
    }
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
        "rename-durable",
        [
          path.basename(plannedTarget.filePath),
          path.basename(plannedTarget.archivePath),
          sourceBinding.identity.dev.toString(),
          sourceBinding.identity.ino.toString(),
          Number(sourceBinding.identity.mode & 0o7777n).toString(),
          sourceBinding.identity.nlink.toString(),
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
  requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
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
  requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
  transaction.phase = "complete";
  transaction.completedAt = nowIso(completedAtMs);
  writeLeaseTransactionFile(paths, files.transaction, transaction, checkpoint);
  writeLeaseTransactionFile(
    paths,
    files.receipt,
    transaction,
    checkpoint,
    "receipt",
  );
  invokeLeaseTransactionCheckpoint(checkpoint, "lease-receipt-written");
  const receiptBinding = openPinnedLeaseAtomicFile(
    files.receipt,
    privateJsonBytes(transaction),
    "Completed lease transaction receipt",
  );
  try {
    const cleanupPlan = buildLeaseCleanupPlan({
      paths,
      transaction,
      includeActive: true,
      requireActive: true,
      pruneReceipts: true,
    });
    executeLeaseCleanupPlan(paths, cleanupPlan, checkpoint, eventsGuard);
    assertPinnedLeaseAtomicFile(receiptBinding);
    return transaction;
  } finally {
    closeSync(receiptBinding.descriptor);
  }
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
  const recover = (activeEventsGuard) => {
    requireActiveLeaseEventsGuard(activeEventsGuard);
    requireOutcomeLedgerRepairFenceAllowsMutation(paths, activeEventsGuard);
    reconcileActiveLeaseTransactionArtifacts(paths, files, transaction);
    if (transaction.phase === "complete") {
      validateCompletedLeaseReceiptStaging(paths, transaction);
    } else {
      validateLeaseStaging(paths, transaction);
    }
    if (
      transaction.phase === "prepared" &&
      transaction.operation === "acquire" &&
      transaction.before.directoryExists === false
    ) {
      const leasePath = leasePathFor(paths, transaction.name);
      if (pathEntryExists(leasePath)) {
        const intermediate = readLeaseDirectorySnapshot(
          paths,
          transaction.name,
          leasePath,
        );
        if (
          intermediate.descriptor.directoryExists === true &&
          intermediate.descriptor.recordDigest === null
        ) {
          const matchedIntermediateEvent = matchingLeaseEventUnlocked(
            paths,
            transaction,
          );
          if (matchedIntermediateEvent.event !== null) {
            throw new AutomationControlError(
              "lease_transaction_conflict",
              `Prepared lease transaction for ${name} has an audit event before authority state publication.`,
            );
          }
          retireLeaseDirectoryDurable(
            paths,
            transaction,
            "aborted-empty-acquire",
            intermediate.descriptor,
          );
          abortPreparedLeaseTransaction(
            paths,
            files,
            transaction,
            undefined,
            activeEventsGuard,
          );
          return null;
        }
      }
    }
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
          paths,
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
      const receiptBinding = openPinnedLeaseAtomicFile(
        files.receipt,
        privateJsonBytes(transaction),
        "Completed lease transaction receipt",
      );
      try {
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
        assertPinnedLeaseAtomicFile(receiptBinding);
        return transaction;
      } finally {
        closeSync(receiptBinding.descriptor);
      }
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
      if (matchesAfter) {
        transaction.phase = "state-committed";
        writeLeaseTransactionFile(paths, files.transaction, transaction);
      }
    }

    if (!matchesAfter) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease transaction for ${name} conflicts with canonical state.`,
      );
    }
    if (transaction.phase === "event-appended" && matchedEvent.event === null) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease transaction for ${name} lost its recorded audit event.`,
      );
    }
    if (matchedEvent.event === null) {
      prepareControlEventAppend(
        matchedEvent.snapshot.bytes,
        matchedEvent.snapshot.recordCount,
        transaction.event,
      );
      appendEventLineUnlocked(paths, transaction.event, matchedEvent.snapshot, {
        eventsGuard: activeEventsGuard,
      });
    }
    if (transaction.phase === "state-committed") {
      transaction.phase = "event-appended";
      writeLeaseTransactionFile(paths, files.transaction, transaction);
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
  const files = leaseTransactionFiles(paths, name, operationId, operation);
  if (!pathEntryExists(files.receipt)) return null;
  const receiptBytes = readPrivateBytes(
    files.receipt,
    "Completed lease transaction receipt",
    { privateRoot: paths.controlRoot },
  );
  const transaction = parseLeaseTransactionBytes(receiptBytes, paths, name);
  requireCanonicalCompletedLeaseReceiptBytes(
    receiptBytes,
    transaction,
    "Completed lease transaction receipt",
  );
  if (
    transaction.phase !== "complete" ||
    transaction.operation !== operation ||
    transaction.operationId !== operationId
  ) {
    return null;
  }
  return Object.freeze({
    transaction,
    binding: openPinnedLeaseAtomicFile(
      files.receipt,
      receiptBytes,
      "Completed lease transaction receipt",
    ),
  });
}

function readExpectedLeaseStageEventsForOperation(
  paths,
  name,
  operation,
  eventsGuard,
) {
  const activePath = path.join(
    leaseTransactionDirectories(paths).transactions,
    `${name}.json`,
  );
  let transaction = readLeaseTransactionFile(activePath, paths, name);
  if (transaction === null) {
    const predecessor = readLeaseStateSnapshot(paths, name).descriptor;
    const temporaryPath = leaseAtomicTemporaryPath(activePath, {
      name,
      operation: operation.leaseOperation,
      operationId: operation.operationId,
      requestDigest: operation.requestDigest,
      tokenDigest: operation.tokenDigest,
      predecessor,
    });
    if (!pathEntryExists(temporaryPath)) return [];
    const bytes = readPrivateBytes(
      temporaryPath,
      "Lease active WAL temporary file",
      {
        allowEmpty: true,
        privateRoot: paths.controlRoot,
        requireUtf8: false,
      },
    );
    try {
      transaction = parseLeaseTransactionBytes(bytes, paths, name);
    } catch {
      return [];
    }
    if (!bytes.equals(privateJsonBytes(transaction))) return [];
  }
  if (
    transaction.operation !== operation.leaseOperation ||
    transaction.operationId !== operation.operationId ||
    transaction.requestDigest !== operation.requestDigest ||
    transaction.tokenDigest !== operation.tokenDigest ||
    !canonicalValuesEqual(transaction.request, operation.request)
  ) {
    return [];
  }
  if (transaction.phase !== "state-committed") return [];
  requireReadOnlyLeaseRecoveryState(paths, transaction, eventsGuard);
  return [transaction.event];
}

function requireCurrentLeaseOperationRecoveryMatch(
  paths,
  name,
  operation,
  operationId,
  request,
  requestDigest,
  tokenDigest,
  eventsGuard,
) {
  requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
  const activePath = path.join(
    leaseTransactionDirectories(paths).transactions,
    `${name}.json`,
  );
  const predecessor = readLeaseStateSnapshot(paths, name).descriptor;
  const activeTemporaryPath = leaseAtomicTemporaryPath(activePath, {
    name,
    operation,
    operationId,
    requestDigest,
    tokenDigest,
    predecessor,
  });
  const transaction = readLeaseTransactionFile(activePath, paths, name);
  if (transaction !== null) {
    if (
      transaction.operation !== operation ||
      transaction.operationId !== operationId
    ) {
      throw new AutomationControlError(
        "lease_transaction_pending",
        `Lease ${name} has a pending transaction that only its exact caller plan may recover.`,
        {
          pendingOperation: transaction.operation,
          pendingOperationId: transaction.operationId,
        },
      );
    }
    if (
      !canonicalValuesEqual(transaction.request, request) ||
      transaction.requestDigest !== requestDigest ||
      transaction.tokenDigest !== tokenDigest
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease operation ${operationId} was already used with a different ${operation} request.`,
      );
    }
    return;
  }
  const namespaceOperation = {
    name,
    operation,
    operationId,
    requestDigest,
    tokenDigest,
    predecessor,
  };
  const files = leaseTransactionFiles(paths, name, operationId, operation);
  const expectedPreWalTemporaryEntries = new Set(
    [files.before, files.after, files.transaction].map((filePath) =>
      path.basename(leaseAtomicTemporaryPath(filePath, namespaceOperation)),
    ),
  );
  if (pathEntryExists(path.dirname(activePath))) {
    for (const entry of readBoundedLeaseDirectoryEntries(
      path.dirname(activePath),
      {
        maxEntries: LEASE_TRANSACTION_DIRECTORY_MAX_ENTRIES,
        label: "Lease transaction directory",
        errorCode: "lease_transaction_conflict",
      },
    )) {
      if (
        leaseAtomicTemporaryEntryOperationId(entry) === operationId &&
        !expectedPreWalTemporaryEntries.has(entry)
      ) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease operation ${operationId} already has temporary material for a different request or token.`,
        );
      }
    }
  }
  if (!pathEntryExists(activeTemporaryPath)) return;
  const temporaryBytes = readPrivateBytes(
    activeTemporaryPath,
    "Lease active WAL temporary file",
    {
      allowEmpty: true,
      privateRoot: paths.controlRoot,
      requireUtf8: false,
    },
  );
  let temporaryTransaction;
  try {
    temporaryTransaction = parseLeaseTransactionBytes(
      temporaryBytes,
      paths,
      name,
    );
  } catch {
    return;
  }
  if (!temporaryBytes.equals(privateJsonBytes(temporaryTransaction))) return;
  if (
    temporaryTransaction.phase !== "prepared" ||
    temporaryTransaction.operation !== operation ||
    temporaryTransaction.operationId !== operationId ||
    !canonicalValuesEqual(temporaryTransaction.request, request) ||
    temporaryTransaction.requestDigest !== requestDigest ||
    temporaryTransaction.tokenDigest !== tokenDigest
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease operation ${operationId} has a conflicting recoverable WAL temporary file.`,
    );
  }
  validateLeaseStaging(paths, temporaryTransaction);
  const current = readLeaseStateSnapshot(paths, name);
  if (!leaseStateMatches(current.descriptor, temporaryTransaction.before)) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease operation ${operationId} prepared WAL temporary does not match canonical state.`,
    );
  }
  const matched = matchingLeaseEventUnlocked(paths, temporaryTransaction);
  if (matched.event !== null) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease operation ${operationId} prepared WAL temporary already has an audit event.`,
    );
  }
  const expectedEntries = new Set(
    [
      temporaryTransaction.staging.beforePath,
      temporaryTransaction.staging.afterPath,
      activeTemporaryPath,
    ]
      .filter((filePath) => filePath !== null)
      .map((filePath) => path.basename(filePath)),
  );
  for (const entry of readBoundedLeaseDirectoryEntries(
    path.dirname(activePath),
    {
      maxEntries: expectedEntries.size + 1,
      label: "Lease transaction directory",
      errorCode: "lease_transaction_conflict",
    },
  ).sort()) {
    if (entry === LEASE_CLEANUP_QUARANTINE_DIRECTORY) {
      requireExactPrivateArchiveDirectory(
        path.join(path.dirname(activePath), entry),
        "Lease transaction cleanup archive directory",
      );
      continue;
    }
    if (!expectedEntries.has(entry)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease operation ${operationId} prepared WAL temporary has unexpected sibling ${entry}.`,
      );
    }
  }
  if (files.transaction !== activePath) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease operation ${operationId} prepared WAL path is not canonical.`,
    );
  }
  const temporarySnapshot = readLeaseAtomicSnapshot(
    paths,
    activeTemporaryPath,
    "Lease active WAL temporary file",
  );
  if (!temporarySnapshot.bytes.equals(temporaryBytes)) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease operation ${operationId} active WAL temporary changed before recovery.`,
    );
  }
  if (pathEntryExists(activePath)) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Lease operation ${operationId} active WAL appeared before recovery.`,
    );
  }
  moveLeaseFileGenerationDurable(
    paths,
    activeTemporaryPath,
    activePath,
    temporarySnapshot,
    "Lease active WAL create-only recovery",
  );
}

function cleanupCompletedLeaseReceipt(
  paths,
  transaction,
  checkpoint = undefined,
  eventsGuard,
  receiptBinding,
) {
  assertPinnedLeaseAtomicFile(receiptBinding);
  const cleanupPlan = buildLeaseCleanupPlan({
    paths,
    transaction,
    includeActive: true,
    requireActive: false,
    pruneReceipts: false,
  });
  if (
    cleanupPlan.targets.every((target) => target.canonicalSnapshot === null)
  ) {
    assertPinnedLeaseAtomicFile(receiptBinding);
    return;
  }
  executeLeaseCleanupPlan(paths, cleanupPlan, checkpoint, eventsGuard);
  assertPinnedLeaseAtomicFile(receiptBinding);
}

function validateCompletedLeaseReceiptStaging(
  paths,
  transaction,
  {
    admittedCanonicalSnapshots = undefined,
    admittedCleanupArchives = undefined,
  } = {},
) {
  const cleanupPlan = buildLeaseCleanupPlan({
    paths,
    transaction,
    includeActive: true,
    requireActive: false,
    pruneReceipts: false,
    admittedCanonicalSnapshots,
    admittedCleanupArchives,
  });
  const records = { before: null, after: null };
  for (const side of ["before", "after"]) {
    const descriptor = transaction[side];
    if (descriptor.recordDigest === null) continue;
    const stagingPath = transaction.staging[`${side}Path`];
    const target = cleanupPlan.targets.find(
      (candidate) => candidate.filePath === stagingPath,
    );
    const snapshot = target?.canonicalSnapshot ?? target?.archiveSnapshot;
    if (target === undefined || snapshot === null || snapshot === undefined) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Completed lease receipt for ${transaction.name} has no exact retained ${side} state.`,
      );
    }
    validateLeaseStagingSnapshot(transaction, side, snapshot);
    records[side] = parseLeaseRecordBytes(snapshot.bytes, transaction.name);
  }
  validateLeaseTransactionStagedSemantics(transaction, records);
  return cleanupPlan;
}

function validateParsedCompletedLeaseReceiptHealthEvidence(
  transaction,
  admittedParsedCleanupEvidence,
  receiptContentDigest,
) {
  const evidence =
    admittedParsedCleanupEvidence.get(transaction.operationId) ?? [];
  const transactionEvidence = evidence.filter(
    (entry) => entry.archiveScope === "transaction",
  );
  const receiptEvidence = evidence.filter(
    (entry) => entry.archiveScope === "receipt",
  );
  const atomicEvidence = evidence.filter(
    (entry) => entry.kind === "atomic-evidence",
  );
  const parsedReceiptEvidence = receiptEvidence.filter(
    (entry) => entry.kind !== "atomic-evidence",
  );
  const originalReceiptPaths = new Set();
  for (const entry of parsedReceiptEvidence) {
    if (originalReceiptPaths.has(entry.originalPath)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease receipt cleanup archive has duplicate generation ${entry.originalPath}.`,
      );
    }
    originalReceiptPaths.add(entry.originalPath);
  }

  const walEvidence = transactionEvidence.filter(
    (entry) => entry.kind === "active-wal",
  );
  const currentWal = walEvidence.filter(
    (entry) =>
      entry.canonicalBytes &&
      canonicalValuesEqual(entry.transaction, transaction),
  );
  if (
    currentWal.length !== 1 ||
    currentWal[0].contentDigest !== receiptContentDigest
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Completed lease receipt for ${transaction.name} has not retired one exact completed WAL generation.`,
    );
  }
  const retiredTransactions = walEvidence
    .filter((entry) => entry !== currentWal[0])
    .map((entry) => entry.transaction);
  requireExactCompletedLeaseWalLineage(transaction, [
    transaction,
    ...retiredTransactions,
  ]);
  const records = { before: null, after: null };
  const stagingBytesBySide = new Map();
  for (const side of ["before", "after"]) {
    const currentRequired = transaction.staging[`${side}Path`] !== null;
    const requirements = [
      ...(currentRequired
        ? [{ kind: "current", transaction, descriptor: transaction[side] }]
        : []),
      ...retiredTransactions
        .filter(
          (retired) =>
            transaction.phase !== "complete" &&
            retired.staging[`${side}Path`] !== null,
        )
        .map((retired) => ({
          kind: "retired",
          transaction: retired,
          descriptor: retired[side],
        })),
    ];
    const requirementsByDescriptor =
      indexLeaseCleanupRequirements(requirements);
    const stagingEvidence = transactionEvidence.filter(
      (entry) => entry.kind === `staging-${side}`,
    );
    for (const entry of stagingEvidence) {
      const requirement = consumeLeaseCleanupRequirement(
        requirementsByDescriptor,
        entry.descriptorKey,
      );
      const replayDuplicate =
        requirement === null &&
        entry.descriptorKey ===
          leaseCleanupStagingDescriptorKey(transaction[side]);
      if (requirement === null && !replayDuplicate) {
        throw new AutomationControlError(
          "lease_transaction_conflict",
          `Lease ${side} cleanup archive ${entry.entry} has no exact current or retired generation.`,
        );
      }
      if (requirement?.kind === "current") {
        records[side] = entry.record;
        stagingBytesBySide.set(side, entry.bytes);
      } else if (!stagingBytesBySide.has(side)) {
        stagingBytesBySide.set(side, entry.bytes);
      }
    }
    if (!leaseCleanupRequirementsComplete(requirementsByDescriptor)) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease ${side} cleanup archives do not cover every exact current and retired generation.`,
      );
    }
  }
  if (
    transactionEvidence.some(
      (entry) =>
        ![
          "active-wal",
          "staging-before",
          "staging-after",
          "atomic-evidence",
        ].includes(entry.kind),
    )
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Completed lease receipt for ${transaction.name} has unsupported parsed cleanup evidence.`,
    );
  }
  validateLeaseAtomicEvidenceSet(
    transaction,
    atomicEvidence,
    stagingBytesBySide,
  );
  validateLeaseTransactionStagedSemantics(transaction, records);
  return Object.freeze({
    operationId: transaction.operationId,
    activeWal: currentWal[0],
    retiredTransactionCount: retiredTransactions.length,
    archivedReceiptCount: receiptEvidence.length,
  });
}

function validateCompletedLeaseReceiptHealthEvidence(
  paths,
  transaction,
  admission = undefined,
) {
  if (admission?.admittedParsedCleanupEvidence instanceof Map) {
    return validateParsedCompletedLeaseReceiptHealthEvidence(
      transaction,
      admission.admittedParsedCleanupEvidence,
      admission.receiptContentDigest,
    );
  }
  const cleanupPlan = validateCompletedLeaseReceiptStaging(
    paths,
    transaction,
    admission,
  );
  const activeWal = cleanupPlan.targets.find(
    (target) => target.kind === "active-wal",
  );
  if (
    activeWal === undefined ||
    activeWal.canonicalSnapshot !== null ||
    activeWal.archiveSnapshot === null
  ) {
    throw new AutomationControlError(
      "lease_transaction_conflict",
      `Completed lease receipt for ${transaction.name} has not retired one exact completed WAL generation.`,
    );
  }
  return cleanupPlan;
}

function verifyCompletedLeaseReceipt(
  paths,
  transaction,
  eventsGuard = undefined,
  receiptBinding,
) {
  const verifyReceipt = (activeEventsGuard) => {
    requireActiveLeaseEventsGuard(activeEventsGuard);
    assertPinnedLeaseAtomicFile(receiptBinding);
    const matched = matchingLeaseEventUnlocked(paths, transaction);
    if (matched.event === null) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Completed lease receipt for ${transaction.name} does not match canonical state and audit history.`,
      );
    }
    validateCompletedLeaseReceiptStaging(paths, transaction);
    requireReleaseLeaseStateRetirement(paths, transaction, {
      eventHistory: matched.snapshot.events,
    });
    assertPinnedLeaseAtomicFile(receiptBinding);
    return transaction;
  };
  if (eventsGuard !== undefined) {
    requireActiveLeaseEventsGuard(eventsGuard);
    return verifyReceipt(eventsGuard);
  }
  return withActiveLeaseEventsGuard(paths, verifyReceipt);
}

function replayCompletedLeaseReceipt({
  paths,
  name,
  operation,
  operationId,
  request,
  requestDigest,
  token,
  checkpoint,
  eventsGuard,
}) {
  const completedReceipt = readCompletedLeaseReceipt(
    paths,
    name,
    operation,
    operationId,
  );
  if (completedReceipt === null) return null;
  const { transaction, binding } = completedReceipt;
  try {
    if (
      !canonicalValuesEqual(transaction.request, request) ||
      transaction.requestDigest !== requestDigest ||
      transaction.tokenDigest !== secretDigest(token)
    ) {
      throw new AutomationControlError(
        "lease_transaction_conflict",
        `Lease operation ${operationId} was already used with a different ${operation} request.`,
      );
    }
    verifyCompletedLeaseReceipt(paths, transaction, eventsGuard, binding);
    cleanupCompletedLeaseReceipt(
      paths,
      transaction,
      checkpoint,
      eventsGuard,
      binding,
    );
    assertPinnedLeaseAtomicFile(binding);
    return leaseResultFromReceipt(transaction, token, true);
  } finally {
    closeSync(binding.descriptor);
  }
}

function prepareLeaseTransaction({
  paths,
  name,
  operation,
  operationId,
  request,
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
  requireOutcomeLedgerRepairFenceAllowsMutation(paths, eventsGuard);
  const files = leaseTransactionFiles(paths, name, operationId, operation);
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
    request: structuredClone(request),
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
      6 +
      Number(beforeBytes !== null) +
      Number(afterBytes !== null) +
      staleReceipts.length,
    bytes:
      (beforeBytes?.length ?? 0) +
      (afterBytes?.length ?? 0) +
      Math.max(...transactionVariantBytes) +
      transactionVariantBytes.slice(0, 3).reduce((sum, size) => sum + size, 0) +
      (beforeBytes?.length ?? 0) +
      Math.max(
        beforeBytes?.length ?? 0,
        afterBytes?.length ?? 0,
        ...transactionVariantBytes,
      ) +
      staleReceipts.reduce((sum, receipt) => sum + receipt.bytes.length, 0),
    oldestMtimeMs: staleReceipts.reduce(
      (oldest, receipt) => Math.min(oldest, receipt.mtimeMs),
      nowMs,
    ),
  });
  requireLeaseCleanupArchiveCapacity(paths, reservation);
  if (beforeBytes !== null) {
    writePrivateBytesAtomic(paths, files.before, beforeBytes, {
      operationId,
      transaction,
      checkpoint,
      kind: "before staging",
      retirementDirectory: leaseCleanupQuarantineDirectory(files.before),
    });
  }
  if (afterBytes !== null) {
    writePrivateBytesAtomic(paths, files.after, afterBytes, {
      operationId,
      transaction,
      checkpoint,
      kind: "after staging",
      retirementDirectory: leaseCleanupQuarantineDirectory(files.after),
    });
  }
  writeLeaseTransactionFile(paths, files.transaction, transaction, checkpoint);
  return { files, transaction, reservation };
}

function invokeLeaseTransactionCheckpoint(
  checkpoint,
  phase,
  details = undefined,
) {
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
    requireOutcomeLedgerRepairFenceAllowsMutation(paths, activeEventsGuard);
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
    prepareControlEventAppend(
      matched.snapshot.bytes,
      matched.snapshot.recordCount,
      transaction.event,
    );
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
    admitControlEventAuthorityStage(paths);
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
    admitControlEventAuthorityStage(paths);
    replaceLeaseStateFromTransaction(
      paths,
      transaction,
      "after",
      checkpoint,
      beforeStateCommit,
    );
    transaction.phase = "state-committed";
    writeLeaseTransactionFile(
      paths,
      files.transaction,
      transaction,
      checkpoint,
    );
    invokeLeaseTransactionCheckpoint(checkpoint, "lease-state-committed");
    appendEventLineUnlocked(paths, transaction.event, matched.snapshot, {
      beforeRename: () =>
        invokeLeaseTransactionCheckpoint(
          checkpoint,
          "lease-event-before-publication",
        ),
      eventsGuard: activeEventsGuard,
    });
    transaction.phase = "event-appended";
    writeLeaseTransactionFile(
      paths,
      files.transaction,
      transaction,
      checkpoint,
    );
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
    requireNoPendingLeaseTransaction(paths, name);
    const leasePath = leasePathFor(paths, name);
    if (!pathEntryExists(leasePath)) {
      return null;
    }
    const record = readLeaseRecord(leasePath);
    if (!record) {
      throw new AutomationControlError(
        "lease_repair_required",
        `Lease ${name} has a recordless authority directory and requires explicit owner-governed repair.`,
        { name },
      );
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

const TRUSTED_LAUNCHER_ATTESTATION_KEYS = Object.freeze(
  [
    "action",
    "actor",
    "challengeSha256",
    "channelVerified",
    "controlPid",
    "controlStartIdentity",
    "launcherIdentityVerified",
    "launcherPid",
    "launcherSha256",
    "launcherStartIdentity",
    "leaseName",
    "leaseOperationId",
    "protocol",
    "runtimeDigest",
    "runtimeIdentityVerified",
    "schemaVersion",
    "sessionId",
    "stateRoot",
    "tokenSha256",
    "ttlMs",
  ].sort(),
);

function trustedLauncherHasExactObjectKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\n") === keys.join("\n")
  );
}

function trustedLauncherChannelFailure(message, details = undefined) {
  throw new AutomationControlError(
    "actor_launcher_channel_invalid",
    message,
    details,
  );
}

function isNativeProcessStartIdentity(value, pid) {
  if (typeof value !== "string") return false;
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== String(pid)) return false;
  if (!/^[1-9][0-9]*$/.test(parts[1]) || !/^(0|[1-9][0-9]*)$/.test(parts[2])) {
    return false;
  }
  const microseconds = Number(parts[2]);
  return Number.isSafeInteger(microseconds) && microseconds <= 999_999;
}

export function validateTrustedLauncherChannelAttestation(
  attestation,
  {
    actor,
    action,
    stateRoot,
    leaseName,
    operationId,
    tokenSha256,
    ttlMs,
    launcherPid,
    controlPid,
    launcherSha256,
    runtimeDigest,
    challengeSha256,
  },
) {
  const expectedSessionId = createHash("sha256")
    .update(
      [
        ACTOR_LAUNCHER_CHANNEL_PROTOCOL,
        action,
        actor,
        stateRoot,
        leaseName,
        operationId,
        tokenSha256,
        String(ttlMs),
        attestation?.launcherStartIdentity,
        attestation?.controlStartIdentity,
        launcherSha256,
        runtimeDigest,
        challengeSha256,
        "",
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
  if (
    !trustedLauncherHasExactObjectKeys(
      attestation,
      TRUSTED_LAUNCHER_ATTESTATION_KEYS,
    ) ||
    attestation.schemaVersion !== AUTOMATION_CONTROL_SCHEMA_VERSION ||
    attestation.protocol !== ACTOR_LAUNCHER_CHANNEL_PROTOCOL ||
    attestation.action !== action ||
    attestation.actor !== actor ||
    attestation.stateRoot !== stateRoot ||
    attestation.leaseName !== leaseName ||
    attestation.leaseOperationId !== operationId ||
    attestation.tokenSha256 !== tokenSha256 ||
    attestation.ttlMs !== ttlMs ||
    attestation.launcherPid !== launcherPid ||
    attestation.controlPid !== controlPid ||
    !isNativeProcessStartIdentity(
      attestation.launcherStartIdentity,
      attestation.launcherPid,
    ) ||
    !isNativeProcessStartIdentity(
      attestation.controlStartIdentity,
      attestation.controlPid,
    ) ||
    attestation.launcherSha256 !== launcherSha256 ||
    attestation.runtimeDigest !== runtimeDigest ||
    attestation.challengeSha256 !== challengeSha256 ||
    attestation.sessionId !== expectedSessionId ||
    attestation.launcherIdentityVerified !== true ||
    attestation.runtimeIdentityVerified !== true ||
    attestation.channelVerified !== true
  ) {
    trustedLauncherChannelFailure(
      "Trusted launcher channel attestation does not match the installed actor contract.",
      { owner: actor },
    );
  }
  return attestation;
}

function verifyTrustedLauncherChannel({
  stateRoot,
  name,
  owner,
  action,
  operationId,
  token,
  ttlMs,
  challengeSha256,
  actorControlEntryPath,
}) {
  const policy = actorPolicy(owner);
  if (!["attest", "acquire"].includes(action)) {
    trustedLauncherChannelFailure(
      "The trusted launcher channel action is invalid.",
      { owner },
    );
  }
  if (!isGeneralAutomationActor(owner)) {
    throw new AutomationControlError(
      "actor_launcher_forbidden",
      `Actor ${owner} cannot use the general actor launcher channel.`,
      { owner },
    );
  }
  if (name !== policy.leaseName) {
    throw new AutomationControlError(
      "lease_policy_mismatch",
      `Actor ${owner} must acquire canonical lease ${policy.leaseName}.`,
      { owner, expectedLeaseName: policy.leaseName, name },
    );
  }
  if (ttlMs !== policy.maxLeaseLifetimeMs) {
    throw new AutomationControlError(
      "lease_ttl_invalid",
      `${owner} launcher leases must be exactly ${policy.maxLeaseLifetimeMs.toLocaleString()} ms.`,
      { owner, ttlMs },
    );
  }
  const normalizedOperationId = requireLeaseOperationId(operationId);
  requireCallerLeaseToken(token);
  const tokenSha256 = secretDigest(token);
  if (
    typeof challengeSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(challengeSha256)
  ) {
    trustedLauncherChannelFailure(
      "The launcher challenge must be one lowercase SHA-256 digest.",
    );
  }

  const installed = readInstalledActorBinding(stateRoot, owner, {
    leaseContract: {
      name: policy.leaseName,
      maxLifetimeMs: policy.maxLeaseLifetimeMs,
    },
  });
  if (!installed.ready) {
    throw new AutomationControlError(
      "actor_launcher_not_ready",
      `The trusted launcher for ${owner} is not ready: ${installed.reason}`,
      { owner, path: installed.path },
    );
  }

  let currentNodePath;
  let currentEntryPath;
  try {
    currentNodePath = realpathSync(process.execPath);
    currentEntryPath = realpathSync(actorControlEntryPath);
  } catch {
    trustedLauncherChannelFailure(
      "The actor control process is not running from the installed immutable runtime.",
    );
  }
  if (
    currentNodePath !== installed.binding.nodePath ||
    currentEntryPath !== installed.binding.actorControlEntryPath
  ) {
    trustedLauncherChannelFailure(
      "The actor control process does not match the installed immutable runtime.",
      {
        owner,
        expectedNodePath: installed.binding.nodePath,
        expectedEntryPath: installed.binding.actorControlEntryPath,
      },
    );
  }

  const result = spawnSync(
    installed.binding.launcherPath,
    [
      "--verify-control-channel",
      "--protocol",
      ACTOR_LAUNCHER_CHANNEL_PROTOCOL,
      "--channel-action",
      action,
      "--actor",
      owner,
      "--state-root",
      installed.stateRoot,
      "--lease-name",
      name,
      "--operation-id",
      normalizedOperationId,
      "--token-sha256",
      tokenSha256,
      "--ttl-seconds",
      String(ttlMs / 1_000),
      "--challenge-sha256",
      challengeSha256,
      "--control-pid",
      String(process.pid),
      "--channel-fd",
      "3",
    ],
    {
      cwd: "/",
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
      maxBuffer: 64 * 1_024,
      stdio: ["ignore", "pipe", "pipe", 3],
      timeout: TRUSTED_LAUNCHER_CHANNEL_TIMEOUT_MS,
      killSignal: "SIGKILL",
    },
  );
  if (result.error) {
    trustedLauncherChannelFailure(
      result.error.code === "ETIMEDOUT"
        ? `Trusted launcher channel verification exceeded ${TRUSTED_LAUNCHER_CHANNEL_TIMEOUT_MS.toLocaleString()} ms.`
        : `Trusted launcher channel verification failed: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    trustedLauncherChannelFailure(
      Number.isInteger(result.status)
        ? `Trusted launcher channel verification exited with status ${result.status.toLocaleString()}.`
        : "Trusted launcher channel verification ended without an exit status.",
    );
  }
  const stdout = String(result.stdout ?? "");
  if (
    Buffer.byteLength(stdout, "utf8") > MAX_TRUSTED_LAUNCHER_ATTESTATION_BYTES
  ) {
    trustedLauncherChannelFailure(
      "Trusted launcher channel verification exceeded its output bound.",
    );
  }
  let attestation;
  try {
    attestation = JSON.parse(stdout);
  } catch {
    trustedLauncherChannelFailure(
      "Trusted launcher channel verification did not return one JSON object.",
    );
  }
  validateTrustedLauncherChannelAttestation(attestation, {
    actor: owner,
    action,
    stateRoot: installed.stateRoot,
    leaseName: name,
    operationId: normalizedOperationId,
    tokenSha256,
    ttlMs,
    launcherPid: process.ppid,
    controlPid: process.pid,
    launcherSha256: installed.binding.launcherSha256,
    runtimeDigest: installed.runtimeDigest,
    challengeSha256,
  });

  return {
    installed,
    attestation,
    authorization: {
      marker: TRUSTED_LAUNCHER_AUTHORIZATION,
      launcherSha256: installed.binding.launcherSha256,
      actorRuntimeDigest: installed.runtimeDigest,
      launcherChannelProtocol: ACTOR_LAUNCHER_CHANNEL_PROTOCOL,
      launcherAttestationSha256: createHash("sha256")
        .update(stdout, "utf8")
        .digest("hex"),
      launcherSessionId: attestation.sessionId,
      leaseOperationId: normalizedOperationId,
      leaseTokenSha256: tokenSha256,
    },
  };
}

export function attestGeneralActorLauncherChannel(options) {
  const verified = verifyTrustedLauncherChannel(options);
  return {
    schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
    protocol: ACTOR_LAUNCHER_ATTESTATION_PROTOCOL,
    purpose: "automation-actor-launcher-readiness",
    actor: verified.attestation.actor,
    stateRoot: verified.installed.stateRoot,
    leaseName: verified.attestation.leaseName,
    maxLeaseLifetimeMs: verified.attestation.ttlMs,
    handoff: ACTOR_LAUNCHER_HANDOFF,
    channelProtocol: ACTOR_LAUNCHER_CHANNEL_PROTOCOL,
    launcherSha256: verified.authorization.launcherSha256,
    runtimeDigest: verified.authorization.actorRuntimeDigest,
    canonicalLeaseReady: true,
    mutatesState: false,
  };
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

function acquireLeaseAuthorized({
  stateRoot,
  name,
  owner,
  operationId,
  ttlMs,
  observerAuthority = undefined,
  providerAuthority = undefined,
  token,
  ownerCapabilityFile = undefined,
  ownerConfirmationFile = undefined,
  ownerCapabilityTaskId = undefined,
  ownerCapabilityIntentDigest = undefined,
  publisherCapabilityFile = undefined,
  scope = undefined,
  checkpoint = undefined,
  trustedLauncherAuthorization = null,
}) {
  const paths = automationControlPaths(stateRoot);
  const normalizedOperationId = requireLeaseOperationId(operationId);
  requireIdentifier(name, "lease name");
  requireNonemptyString(owner, "owner");
  requirePositiveInteger(ttlMs, "ttlMs");
  const policy = actorPolicy(owner);
  if (
    isGeneralAutomationActor(owner) &&
    trustedLauncherAuthorization?.marker !== TRUSTED_LAUNCHER_AUTHORIZATION
  ) {
    throw new AutomationControlError(
      "actor_launcher_required",
      `Actor ${owner} can acquire a lease only through its installed trusted launcher.`,
      { owner },
    );
  }
  if (
    !isGeneralAutomationActor(owner) &&
    trustedLauncherAuthorization !== null
  ) {
    throw new AutomationControlError(
      "actor_launcher_forbidden",
      `Actor ${owner} cannot use the general actor launcher channel.`,
      { owner },
    );
  }
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
  if (
    trustedLauncherAuthorization !== null &&
    (trustedLauncherAuthorization.leaseOperationId !== normalizedOperationId ||
      trustedLauncherAuthorization.leaseTokenSha256 !== secretDigest(token))
  ) {
    throw new AutomationControlError(
      "actor_launcher_channel_invalid",
      "The trusted launcher attestation does not bind this exact lease operation and token.",
      { owner },
    );
  }
  if (
    owner === "freed-pr-publisher" &&
    (ownerCapabilityFile !== undefined || ownerConfirmationFile !== undefined)
  ) {
    throw new AutomationControlError(
      "publisher_reusable_credential_forbidden",
      "The publisher rejects reusable actor and owner credentials.",
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
    owner === "freed-pr-publisher"
      ? normalizePublisherScope(scope, { requireLiveWorktree: false })
      : undefined;
  if (owner !== "freed-pr-publisher" && scope !== undefined) {
    throw new AutomationControlError(
      "publisher_scope_invalid",
      `Actor ${owner} cannot acquire a target-scoped lease.`,
    );
  }

  const request = {
    operation: "acquire",
    operationId: normalizedOperationId,
    name,
    owner,
    actorCredentialFile: null,
    actorCredentialTokenDigest: null,
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
    ...(trustedLauncherAuthorization === null
      ? {}
      : {
          launcherSha256: trustedLauncherAuthorization.launcherSha256,
          actorRuntimeDigest: trustedLauncherAuthorization.actorRuntimeDigest,
          launcherChannelProtocol:
            trustedLauncherAuthorization.launcherChannelProtocol,
        }),
  };
  const requestDigest = canonicalLeaseRequestDigest(request);

  return withLeaseMutationArchiveGuard(
    paths,
    name,
    {
      name,
      owner,
      leaseOperation: "acquire",
      operationId: normalizedOperationId,
      request,
      requestDigest,
      token,
      tokenDigest: secretDigest(token),
      ttlMs,
      ownerCapabilityFile,
      ownerConfirmationFile,
      ownerCapabilityTaskId,
      ownerCapabilityIntentDigest,
    },
    (eventsGuard) => {
      requireCurrentLeaseOperationRecoveryMatch(
        paths,
        name,
        "acquire",
        normalizedOperationId,
        request,
        requestDigest,
        secretDigest(token),
        eventsGuard,
      );
      ensurePrivateDirectory(paths.leases);
      recoverLeaseTransactionUnlocked(paths, name, Date.now(), eventsGuard);
      const completed = replayCompletedLeaseReceipt({
        paths,
        name,
        operation: "acquire",
        operationId: normalizedOperationId,
        request,
        requestDigest,
        token,
        checkpoint,
        eventsGuard,
      });
      if (completed !== null) {
        return completed;
      }
      requireNoPrunedLeaseOperationEvent(
        paths,
        normalizedOperationId,
        eventsGuard,
      );
      if (owner === "freed-pr-publisher") {
        normalizePublisherScope(publisherScope);
      }
      const operationNowMs = Date.now();
      const beforeState = readLeaseStateSnapshot(paths, name);
      if (
        beforeState.descriptor.directoryExists &&
        beforeState.record === null
      ) {
        throw new AutomationControlError(
          "lease_repair_required",
          `Lease ${name} has a recordless authority directory and requires explicit owner-governed repair.`,
          { name },
        );
      }
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

      if (beforeState.descriptor.directoryExists) {
        const existing = beforeState.record;
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
          if (!isLeaseExpired(existing, operationNowMs)) {
            throw new AutomationControlError(
              "lease_busy",
              `Legacy lease ${name} remains live and requires expiry or an owner-governed migration before credential upgrade.`,
              {
                name,
                owner: existing.owner,
                expiresAt: existing.expiresAt,
              },
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
                : "trusted-launcher-channel",
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
        ...(trustedLauncherAuthorization === null
          ? {}
          : {
              launcherSha256: trustedLauncherAuthorization.launcherSha256,
              actorRuntimeDigest:
                trustedLauncherAuthorization.actorRuntimeDigest,
              launcherChannelProtocol:
                trustedLauncherAuthorization.launcherChannelProtocol,
              launcherAttestationSha256:
                trustedLauncherAuthorization.launcherAttestationSha256,
              launcherSessionId: trustedLauncherAuthorization.launcherSessionId,
            }),
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
        requestDigest,
        credentialKind: record.credentialKind,
        ...(publisherCapability === null
          ? {}
          : { publisherCapabilityId: publisherCapability.capabilityId }),
        ...(publisherScope === undefined ? {} : { scope: publisherScope }),
        ...(trustedLauncherAuthorization === null
          ? {}
          : {
              launcherSha256: trustedLauncherAuthorization.launcherSha256,
              actorRuntimeDigest:
                trustedLauncherAuthorization.actorRuntimeDigest,
              launcherChannelProtocol:
                trustedLauncherAuthorization.launcherChannelProtocol,
              launcherAttestationSha256:
                trustedLauncherAuthorization.launcherAttestationSha256,
              launcherSessionId: trustedLauncherAuthorization.launcherSessionId,
            }),
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
        publisherCapability?.credentialSnapshot;
      const admittedCredentialPath =
        ownerCapability?.capabilityFile ??
        ownerConfirmation?.confirmationFile ??
        publisherCapability?.capabilityFile;
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
              : null;
      if (
        capability !== null &&
        !credentialBytesMatch(capability.sourcePath, capability)
      ) {
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
        request,
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

export function acquireLease(options) {
  const { actorCredentialToken = undefined, ...leaseOptions } = options;
  const owner = requireNonemptyString(leaseOptions.owner, "owner");
  actorPolicy(owner);
  if (isGeneralAutomationActor(owner)) {
    throw new AutomationControlError(
      "actor_launcher_required",
      `Actor ${owner} can acquire a lease only through its installed trusted launcher.`,
      { owner },
    );
  }
  if (actorCredentialToken !== undefined) {
    throw new AutomationControlError(
      owner === "freed-owner"
        ? "owner_reusable_credential_forbidden"
        : "publisher_reusable_credential_forbidden",
      owner === "freed-owner"
        ? "freed-owner does not accept a reusable actor credential."
        : "The publisher rejects reusable actor and owner credentials.",
    );
  }
  return acquireLeaseAuthorized(leaseOptions);
}

export function acquireGeneralActorLeaseFromTrustedLauncher(options) {
  const {
    action = "acquire",
    challengeSha256,
    actorControlEntryPath,
    actorCredentialToken = undefined,
    ...leaseOptions
  } = options;
  if (action !== "acquire") {
    throw new AutomationControlError(
      "invalid_argument",
      "Trusted launcher acquisition requires the acquire channel action.",
    );
  }
  if (actorCredentialToken !== undefined) {
    throw new AutomationControlError(
      "actor_reusable_credential_forbidden",
      "General automation actors do not accept reusable credentials.",
    );
  }
  const verified = verifyTrustedLauncherChannel({
    stateRoot: leaseOptions.stateRoot,
    name: leaseOptions.name,
    owner: leaseOptions.owner,
    action,
    operationId: leaseOptions.operationId,
    token: leaseOptions.token,
    ttlMs: leaseOptions.ttlMs,
    challengeSha256,
    actorControlEntryPath,
  });
  return acquireLeaseAuthorized({
    ...leaseOptions,
    trustedLauncherAuthorization: verified.authorization,
  });
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
  const request = {
    operation: "heartbeat",
    operationId: normalizedOperationId,
    name,
    tokenDigest: secretDigest(token),
    ttlMs: ttlMs ?? null,
  };
  const requestDigest = canonicalLeaseRequestDigest(request);

  return withLeaseMutationArchiveGuard(
    paths,
    name,
    {
      name,
      leaseOperation: "heartbeat",
      operationId: normalizedOperationId,
      request,
      requestDigest,
      token,
      tokenDigest: secretDigest(token),
    },
    (eventsGuard) => {
      requireCurrentLeaseOperationRecoveryMatch(
        paths,
        name,
        "heartbeat",
        normalizedOperationId,
        request,
        requestDigest,
        secretDigest(token),
        eventsGuard,
      );
      recoverLeaseTransactionUnlocked(paths, name, Date.now(), eventsGuard);
      const completed = replayCompletedLeaseReceipt({
        paths,
        name,
        operation: "heartbeat",
        operationId: normalizedOperationId,
        request,
        requestDigest,
        token,
        checkpoint,
        eventsGuard,
      });
      if (completed !== null) {
        return completed;
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
      if (record.owner === "freed-pr-publisher") {
        normalizePublisherScope(record.scope);
      }
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
        { expiresAt: nextRecord.expiresAt, requestDigest },
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
        request,
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
  const expectedScope = normalizePublisherScope(
    { ...scope, headSha: null },
    { requireLiveWorktree: false },
  );
  const normalizedHeadSha = String(headSha ?? "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalizedHeadSha)) {
    throw new AutomationControlError(
      "publisher_scope_invalid",
      "The publisher head must be one full commit SHA.",
    );
  }
  const request = {
    operation: "bind-head",
    operationId: normalizedOperationId,
    name,
    tokenDigest: secretDigest(token),
    scope: expectedScope,
    headSha: normalizedHeadSha,
  };
  const requestDigest = canonicalLeaseRequestDigest(request);

  return withLeaseMutationArchiveGuard(
    paths,
    name,
    {
      name,
      leaseOperation: "bind-head",
      operationId: normalizedOperationId,
      request,
      requestDigest,
      token,
      tokenDigest: secretDigest(token),
    },
    (eventsGuard) => {
      requireCurrentLeaseOperationRecoveryMatch(
        paths,
        name,
        "bind-head",
        normalizedOperationId,
        request,
        requestDigest,
        secretDigest(token),
        eventsGuard,
      );
      recoverLeaseTransactionUnlocked(paths, name, Date.now(), eventsGuard);
      const completed = replayCompletedLeaseReceipt({
        paths,
        name,
        operation: "bind-head",
        operationId: normalizedOperationId,
        request,
        requestDigest,
        token,
        checkpoint,
        eventsGuard,
      });
      if (completed !== null) {
        return completed;
      }
      requireNoPrunedLeaseOperationEvent(
        paths,
        normalizedOperationId,
        eventsGuard,
      );
      normalizePublisherScope(expectedScope);
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
      const alreadyBound = record.scope.headSha === normalizedHeadSha;
      const nextRecord = structuredClone(record);
      if (!alreadyBound) nextRecord.scope.headSha = normalizedHeadSha;
      const event = buildLeaseEvent(
        alreadyBound ? "lease_scope_binding_confirmed" : "lease_scope_bound",
        record.owner,
        name,
        { scope: nextRecord.scope, requestDigest },
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
        request,
        requestDigest,
        tokenDigest: secretDigest(token),
        beforeState,
        afterRecord: nextRecord,
        afterDirectoryExists: true,
        event,
        capability: null,
        takeover: null,
        resultReceipt: {
          bound: !alreadyBound,
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
  const request = {
    operation: "release",
    operationId: normalizedOperationId,
    name,
    tokenDigest: secretDigest(token),
  };
  const requestDigest = canonicalLeaseRequestDigest(request);

  return withLeaseMutationArchiveGuard(
    paths,
    name,
    {
      name,
      leaseOperation: "release",
      operationId: normalizedOperationId,
      request,
      requestDigest,
      token,
      tokenDigest: secretDigest(token),
    },
    (eventsGuard) => {
      requireCurrentLeaseOperationRecoveryMatch(
        paths,
        name,
        "release",
        normalizedOperationId,
        request,
        requestDigest,
        secretDigest(token),
        eventsGuard,
      );
      recoverLeaseTransactionUnlocked(paths, name, Date.now(), eventsGuard);
      const completed = replayCompletedLeaseReceipt({
        paths,
        name,
        operation: "release",
        operationId: normalizedOperationId,
        request,
        requestDigest,
        token,
        checkpoint,
        eventsGuard,
      });
      if (completed !== null) {
        return completed;
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
        { expired: isLeaseExpired(record, operationNowMs), requestDigest },
        operationNowMs,
        normalizedOperationId,
      );
      requireLeaseOperationEventAvailable(paths, event, eventsGuard);
      const prepared = prepareLeaseTransaction({
        paths,
        name,
        operation: "release",
        operationId: normalizedOperationId,
        request,
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
