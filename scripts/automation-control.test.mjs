import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as signPayload,
} from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  watch,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  AutomationControlError,
  AUTOMATION_ACTOR_POLICIES,
  CONTROL_EVENT_HISTORY_MAX_BYTES,
  CONTROL_EVENT_HISTORY_MAX_RECORDS,
  OBSERVER_AUTHORITIES,
  TASK_STATES,
  acquireLease as acquireLeasePublic,
  appendControlEvent,
  appendOutcomeControlEvent,
  automationControlPaths,
  bindPublisherLeaseHead as bindPublisherLeaseHeadLive,
  conservativeLeaseCleanupArchiveReservation,
  consumeLeaseArchiveHelperInvocationCountForTest,
  consumeLeaseCleanupRequirementsForTest,
  consumePendingLeaseTransactionInspectionCountForTest,
  createTask,
  finalizeTaskOutcome,
  heartbeatLease as heartbeatLeaseLive,
  inspectExactOutcomeControlHistory,
  inspectExactTaskLifecycleHistory,
  inspectExactTaskManifestHistoryParity,
  inspectLeaseTransactionEventHistory,
  inspectLeaseCleanupArchiveCapacity,
  inspectLease,
  isTaskTransitionAllowed,
  normalizeInstalledBuildIdentity,
  outcomeRecordedEventId,
  ownerGovernanceIntentDigest,
  partitionPrivateBatchSelectionForTest,
  preauthorizeOutcomeLedgerRepair,
  preflightOutcomeLedgerRepairEvent,
  readAutomationAuthorityFileSnapshot,
  readAutomationPlanningAdmission,
  readBoundedLeaseDirectoryEntriesForTest,
  readTask,
  readTaskManifest,
  releaseLease as releaseLeaseMutation,
  resolveAutomationStateRoot,
  transitionTask,
  updateTaskAuthorities,
  validateOutcomeLedgerRepairEvent,
  verifyOwnerCapabilityEnvelope,
  withAutomationOutcomeLedgerWriterGuard,
  withAutomationPlanningReadBundle,
  withKernelFileGuard,
  withMutationLeaseAuthority,
  withOutcomeLedgerRepairFinalizationGuard,
  withOutcomeRecordingGuards,
  writeAutomationAuthorityFile,
  writeJsonAtomic,
} from "./lib/automation-control.mjs";
import {
  OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  outcomeLedgerRepairOperationSeed,
} from "./lib/outcome-ledger-repair-contract.mjs";
import {
  planOutcomeLedgerRepair,
  repairOutcomeLedger,
} from "./lib/outcome-ledger-repair.mjs";
import {
  AUTOMATION_KERNEL_GUARD_INNER_FILE,
  AUTOMATION_KERNEL_GUARD_OWNER_FILE,
  automationKernelGuardMarkerBytes,
  inspectAutomationKernelGuardCutover,
  resolveAutomationKernelGuardFilesystemType,
} from "./lib/automation-kernel-guard-contract.mjs";
import { installAutomationKernelGuardCutoverFixture } from "./test-helpers/automation-kernel-guard.mjs";
import {
  providerApprovalAuthorizationDigest,
  validateProviderRiskApproval,
} from "./lib/provider-visible-paths.mjs";
import {
  ACTOR_LAUNCHER_CHANNEL_PROTOCOL,
  TEST_ACTOR_RUNTIME_DIGEST,
  TEST_LAUNCHER_ATTESTATION_SHA256,
  TEST_LAUNCHER_SESSION_ID,
  TEST_LAUNCHER_SHA256,
  TEST_TRUSTED_LAUNCHER_PROVENANCE,
  TRUSTED_ACTOR_CONTROL_MODULE_URL,
  TrustedActorAutomationControlError,
  acquireGeneralActorLeaseForTest,
} from "./test-helpers/trusted-actor-lease.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, "automation-control.mjs");
const ACTOR_CONTROL_PATH = path.join(__dirname, "automation-actor-control.mjs");

function acquireLeaseLive(options) {
  const policy = AUTOMATION_ACTOR_POLICIES[options.owner];
  if (
    policy?.maxLeaseLifetimeMs !== undefined &&
    !["freed-owner", "freed-pr-publisher"].includes(options.owner)
  ) {
    return acquireGeneralActorLeaseForTest(options);
  }
  return acquireLeasePublic(options);
}

function isAutomationControlError(error) {
  return (
    error instanceof AutomationControlError ||
    error instanceof TrustedActorAutomationControlError
  );
}

let leaseOperationSequence = 0;

function nextLeaseOperationId(label = "lease-test") {
  leaseOperationSequence += 1;
  return createHash("sha256")
    .update(`${label}:${leaseOperationSequence}`)
    .digest("hex");
}

function withTestDateNow(nowMs, operation) {
  if (nowMs === undefined) return operation();
  const liveDateNow = Date.now;
  Date.now = () => nowMs;
  try {
    return operation();
  } finally {
    Date.now = liveDateNow;
  }
}

function withMutableTestDateNow(nowMs, operation) {
  const liveDateNow = Date.now;
  let currentNowMs = nowMs;
  Date.now = () => currentNowMs;
  try {
    return operation((nextNowMs) => {
      currentNowMs = nextNowMs;
    });
  } finally {
    Date.now = liveDateNow;
  }
}

function acquireLeaseMutation(options) {
  const { nowMs, ...liveOptions } = options;
  return withTestDateNow(nowMs, () => acquireLeaseLive(liveOptions));
}

function heartbeatLeaseMutation(options) {
  const { nowMs, ...liveOptions } = options;
  return withTestDateNow(nowMs, () => heartbeatLeaseLive(liveOptions));
}

function bindPublisherLeaseHeadMutation(options) {
  const { nowMs, ...liveOptions } = options;
  return withTestDateNow(nowMs, () => bindPublisherLeaseHeadLive(liveOptions));
}

function acquireLease(options) {
  let publisherLeaseOperationId;
  if (
    options.operationId === undefined &&
    typeof options.publisherCapabilityFile === "string" &&
    existsSync(options.publisherCapabilityFile)
  ) {
    try {
      const envelope = JSON.parse(
        readFileSync(options.publisherCapabilityFile, "utf8"),
      );
      publisherLeaseOperationId = JSON.parse(
        Buffer.from(envelope.payloadBase64, "base64").toString("utf8"),
      ).leaseOperationId;
    } catch {
      publisherLeaseOperationId = undefined;
    }
  }
  const operationId =
    options.operationId ??
    publisherLeaseOperationId ??
    nextLeaseOperationId("acquire");
  return acquireLeaseMutation({
    ...options,
    operationId,
    token: options.token ?? `caller-retained-${operationId}`,
  });
}

function heartbeatLease(options) {
  return heartbeatLeaseMutation({
    ...options,
    operationId: options.operationId ?? nextLeaseOperationId("heartbeat"),
  });
}

function bindPublisherLeaseHead(options) {
  return bindPublisherLeaseHeadMutation({
    ...options,
    operationId: options.operationId ?? nextLeaseOperationId("bind-head"),
  });
}

function releaseLease(options) {
  const { nowMs, ...liveOptions } = options;
  return withTestDateNow(nowMs, () =>
    releaseLeaseMutation({
      ...liveOptions,
      operationId: liveOptions.operationId ?? nextLeaseOperationId("release"),
    }),
  );
}

function temporaryStateRoot() {
  const stateRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-automation-control-")),
  );
  installAutomationKernelGuardCutoverFixture(stateRoot);
  return stateRoot;
}

function temporaryUncutoverStateRoot() {
  return realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-automation-control-bare-")),
  );
}

function writeKernelGuardMarker(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, automationKernelGuardMarkerBytes(), { mode: 0o600 });
}

const ownerIntentsByDigest = new Map();

function ownerIntent(action, taskId, parameters) {
  const intent = {
    schemaVersion: 1,
    action,
    taskId,
    parameters,
  };
  const intentDigest = ownerGovernanceIntentDigest(intent);
  ownerIntentsByDigest.set(intentDigest, intent);
  return intentDigest;
}

function outcomeLedgerRepairParameters(stateRoot, taskId, overrides = {}) {
  const canonicalStateRoot = realpathSync(stateRoot);
  const parameters = {
    schemaVersion: 1,
    policy: "freed-outcome-ledger-repair-v1",
    stateRoot: canonicalStateRoot,
    ledgerPath: path.join(canonicalStateRoot, "outcomes.jsonl"),
    operationId: "",
    sourceDigest: "02".repeat(32),
    sourceSize: 4_096,
    sourceLineCount: 23,
    trustedCount: 0,
    rejectedCount: 23,
    replacementDigest: "03".repeat(32),
    replacementSize: 0,
    archiveDigest: "02".repeat(32),
    decisionsDigest: "04".repeat(32),
    receiptDigest: "05".repeat(32),
    eventHistoryDigest: "06".repeat(32),
    eventHistorySize: 2_048,
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "operationId")) {
    parameters.operationId = createHash("sha256")
      .update(
        JSON.stringify(
          canonicalTestValue(
            outcomeLedgerRepairOperationSeed(taskId, parameters),
          ),
        ),
      )
      .digest("hex");
  }
  return parameters;
}

function outcomeLedgerRepairParametersForCurrentEventHistory(
  stateRoot,
  taskId,
  overrides = {},
) {
  const eventsPath = automationControlPaths(stateRoot).events;
  const eventHistory = existsSync(eventsPath)
    ? readFileSync(eventsPath)
    : Buffer.alloc(0);
  return outcomeLedgerRepairParameters(stateRoot, taskId, {
    eventHistoryDigest: createHash("sha256").update(eventHistory).digest("hex"),
    eventHistorySize: eventHistory.length,
    ...overrides,
  });
}

function appendCanonicalControlEventFixtures(stateRoot, events, operationId) {
  const paths = automationControlPaths(stateRoot);
  const previousSnapshot = readAutomationAuthorityFileSnapshot(paths.events, {
    allowMissing: false,
    allowEmpty: false,
    privateRoot: paths.controlRoot,
    maxBytes: CONTROL_EVENT_HISTORY_MAX_BYTES,
    allowedModes: [0o600],
    label: "Control event history fixture",
  });
  const separator =
    previousSnapshot.bytes.at(-1) === 0x0a
      ? Buffer.alloc(0)
      : Buffer.from("\n");
  const appendedBytes = Buffer.from(
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
  writeAutomationAuthorityFile({
    filePath: paths.events,
    bytes: Buffer.concat([previousSnapshot.bytes, separator, appendedBytes]),
    previousSnapshot,
    operationId,
    privateRoot: paths.controlRoot,
    maxBytes: CONTROL_EVENT_HISTORY_MAX_BYTES,
    allowedModes: [0o600],
    label: "Control event history fixture",
  });
}

function signedOwnerCapability(
  stateRoot,
  taskId,
  intentDigest,
  leaseToken,
  {
    nowMs = Date.parse("2026-07-10T09:00:00Z"),
    ttlMs = 10 * 60_000,
    capabilityId = `owner-capability-${nowMs}`,
    privateKey = undefined,
  } = {},
) {
  const keyPair =
    privateKey === undefined ? generateKeyPairSync("ed25519") : { privateKey };
  const publicKey = createPublicKey(keyPair.privateKey);
  const publicKeyBase64 = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("base64");
  const payload = {
    schemaVersion: 1,
    capabilityId,
    issuer: "trusted-publisher-host",
    purpose: "owner-governance-capability",
    actor: "freed-owner",
    leaseName: "owner-governance",
    stateRoot: realpathSync(stateRoot),
    taskId,
    intentDigest,
    tokenSha256: createHash("sha256").update(leaseToken).digest("hex"),
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + 60_000).toISOString(),
    leaseTtlMs: ttlMs,
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return {
    envelope: {
      schemaVersion: 1,
      payloadBase64: payloadBytes.toString("base64"),
      signatureBase64: signPayload(
        null,
        payloadBytes,
        keyPair.privateKey,
      ).toString("base64"),
    },
    payload,
    privateKey: keyPair.privateKey,
    publicKeyBase64,
  };
}

function writeOwnerConfirmation(
  stateRoot,
  taskId,
  intent,
  {
    nowMs = Date.parse("2026-07-10T09:00:00Z"),
    confirmationId = `owner-confirmation-${nowMs}`,
    approvedBy = "AubreyF",
    approvedAtMs = nowMs,
    expiresAtMs = nowMs + 24 * 60 * 60_000,
    mode = 0o600,
  } = {},
) {
  const intentDigest = ownerGovernanceIntentDigest(intent);
  const confirmation = {
    schemaVersion: 1,
    kind: "owner-confirmation",
    confirmationId,
    approvedBy,
    ownerApprovalReference:
      "Owner explicitly approved this exact lifecycle operation in the current task.",
    approvalSource: {
      kind: "current-task",
      reference: taskId,
    },
    taskId,
    intent,
    intentDigest,
    approvedAt: new Date(approvedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
  const confirmationPath = path.join(stateRoot, `${confirmationId}.json`);
  writeFileSync(confirmationPath, `${JSON.stringify(confirmation)}\n`, {
    mode,
  });
  return { confirmation, confirmationPath, intentDigest };
}

function writeActorCredential(
  stateRoot,
  actor,
  token = `${actor}-persistent-secret-1234567890`,
) {
  const credentialPath = path.join(
    automationControlPaths(stateRoot).actorCredentials,
    `${actor}.json`,
  );
  mkdirSync(path.dirname(credentialPath), { recursive: true, mode: 0o700 });
  chmodSync(path.dirname(credentialPath), 0o700);
  writeFileSync(
    credentialPath,
    `${JSON.stringify({
      schemaVersion: 1,
      actor,
      purpose: "automation-actor-lease",
      tokenSha256: createHash("sha256").update(token).digest("hex"),
    })}\n`,
    { mode: 0o600 },
  );
  return token;
}

function writePublisherCapability(
  stateRoot,
  scope,
  {
    nowMs = Date.now(),
    ttlMs = 30 * 60_000,
    lifetimeMs = 60_000,
    capabilityId = `publisher-capability-${nowMs}`,
    privateKey = undefined,
    payloadScope = scope,
    leaseOperationId = nextLeaseOperationId("publisher-capability"),
    token = `caller-retained-${leaseOperationId}`,
    payloadTokenSha256 = createHash("sha256").update(token).digest("hex"),
    omitLeaseBinding = false,
  } = {},
) {
  const keyPair =
    privateKey === undefined ? generateKeyPairSync("ed25519") : { privateKey };
  const publicKey = keyPair.privateKey
    ? createPublicKey(keyPair.privateKey)
    : keyPair.publicKey;
  const rawPublicKey = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  const credentialPath = path.join(
    automationControlPaths(stateRoot).actorCredentials,
    "freed-pr-publisher.json",
  );
  mkdirSync(path.dirname(credentialPath), { recursive: true, mode: 0o700 });
  writeFileSync(
    credentialPath,
    `${JSON.stringify({
      schemaVersion: 1,
      actor: "freed-pr-publisher",
      purpose: "publisher-capability-signing",
      publicKeyBase64: rawPublicKey.toString("base64"),
    })}\n`,
    { mode: 0o600 },
  );
  const payload = {
    schemaVersion: 1,
    capabilityId,
    issuer: "freed-pr-publisher",
    leaseName: "pr-publisher",
    ...(omitLeaseBinding
      ? {}
      : {
          leaseOperationId,
          tokenSha256: payloadTokenSha256,
        }),
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + lifetimeMs).toISOString(),
    leaseTtlMs: ttlMs,
    scope: payloadScope,
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const capabilityPath = path.join(
    automationControlPaths(stateRoot).publisherCapabilitiesPending,
    `${capabilityId}.json`,
  );
  mkdirSync(path.dirname(capabilityPath), { recursive: true, mode: 0o700 });
  writeFileSync(
    capabilityPath,
    `${JSON.stringify({
      schemaVersion: 1,
      payloadBase64: payloadBytes.toString("base64"),
      signatureBase64: signPayload(
        null,
        payloadBytes,
        keyPair.privateKey,
      ).toString("base64"),
    })}\n`,
    { mode: 0o600 },
  );
  return {
    capabilityId,
    capabilityPath,
    privateKey: keyPair.privateKey,
    leaseOperationId,
    token,
    tokenSha256: payloadTokenSha256,
  };
}

function writeTrustedLauncherLease(
  stateRoot,
  actor,
  {
    token = `${actor}-trusted-launcher-token:${"x".repeat(32)}`,
    nowMs = Date.now(),
    ttlMs = AUTOMATION_ACTOR_POLICIES[actor]?.maxLeaseLifetimeMs,
    operationId = nextLeaseOperationId(`trusted-launcher-${actor}`),
    launcherSha256 = TEST_LAUNCHER_SHA256,
    actorRuntimeDigest = TEST_ACTOR_RUNTIME_DIGEST,
    launcherChannelProtocol = ACTOR_LAUNCHER_CHANNEL_PROTOCOL,
    launcherAttestationSha256 = TEST_LAUNCHER_ATTESTATION_SHA256,
    launcherSessionId = TEST_LAUNCHER_SESSION_ID,
    appendAcquireEvent = true,
  } = {},
) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const acquiredAtMs = nowMs;
  const heartbeatAtMs = nowMs;
  const leasePath = path.join(
    automationControlPaths(stateRoot).leases,
    `${policy.leaseName}.lease`,
  );
  mkdirSync(leasePath, { recursive: true, mode: 0o700 });
  const record = {
    schemaVersion: 1,
    name: policy.leaseName,
    owner: actor,
    token,
    observerAuthority: policy.observerAuthority,
    providerAuthority: policy.providerAuthority,
    credentialKind: "trusted-launcher-channel",
    launcherSha256,
    actorRuntimeDigest,
    launcherChannelProtocol,
    launcherAttestationSha256,
    launcherSessionId,
    acquiredAt: new Date(acquiredAtMs).toISOString(),
    heartbeatAt: new Date(heartbeatAtMs).toISOString(),
    expiresAt: new Date(heartbeatAtMs + ttlMs).toISOString(),
    ttlMs,
  };
  writeFileSync(
    path.join(leasePath, "lease.json"),
    `${JSON.stringify(record)}\n`,
    { mode: 0o600 },
  );
  if (appendAcquireEvent) {
    const eventsPath = automationControlPaths(stateRoot).events;
    mkdirSync(path.dirname(eventsPath), { recursive: true, mode: 0o700 });
    appendFileSync(
      eventsPath,
      `${JSON.stringify({
        schemaVersion: 1,
        eventId: `lease:${operationId}`,
        type: "lease_acquired",
        ts: record.acquiredAt,
        actor,
        leaseName: policy.leaseName,
        data: {
          expiresAt: record.expiresAt,
          observerAuthority: record.observerAuthority,
          providerAuthority: record.providerAuthority,
          requestDigest: createHash("sha256")
            .update(`trusted-launcher-request:${operationId}`)
            .digest("hex"),
          credentialKind: record.credentialKind,
          launcherSha256,
          actorRuntimeDigest,
          launcherChannelProtocol,
          launcherAttestationSha256,
          launcherSessionId,
        },
      })}\n`,
      { mode: 0o600 },
    );
  }
  return { actor, leaseName: policy.leaseName, leaseToken: token, record };
}

function writeLegacyLease(
  stateRoot,
  actor,
  { owner = actor, token = `${actor}-legacy-token`, nowMs = Date.now() } = {},
) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const ttlMs = 60 * 60_000;
  const acquiredAtMs = nowMs - 60_000;
  const heartbeatAtMs = nowMs - 30_000;
  const leasePath = path.join(
    automationControlPaths(stateRoot).leases,
    `${policy.leaseName}.lease`,
  );
  mkdirSync(leasePath, { recursive: true, mode: 0o700 });
  const record = {
    schemaVersion: 1,
    name: policy.leaseName,
    owner,
    token,
    observerAuthority: policy.observerAuthority,
    providerAuthority: policy.providerAuthority,
    acquiredAt: new Date(acquiredAtMs).toISOString(),
    heartbeatAt: new Date(heartbeatAtMs).toISOString(),
    expiresAt: new Date(heartbeatAtMs + ttlMs).toISOString(),
    ttlMs,
  };
  writeFileSync(
    path.join(leasePath, "lease.json"),
    `${JSON.stringify(record)}\n`,
    { mode: 0o600 },
  );
  return { leasePath, policy, record };
}

function writePersistentActorLease(
  stateRoot,
  actor,
  {
    token = `${actor}-legacy-persistent-token`,
    nowMs = Date.now(),
    ttlMs = 60_000,
  } = {},
) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  assert.ok(policy, `missing actor policy for ${actor}`);
  const leasePath = path.join(
    automationControlPaths(stateRoot).leases,
    `${policy.leaseName}.lease`,
  );
  mkdirSync(leasePath, { recursive: true, mode: 0o700 });
  const record = {
    schemaVersion: 1,
    name: policy.leaseName,
    owner: actor,
    token,
    observerAuthority: policy.observerAuthority,
    providerAuthority: policy.providerAuthority,
    credentialKind: "persistent-actor",
    acquiredAt: new Date(nowMs).toISOString(),
    heartbeatAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    ttlMs,
  };
  writeFileSync(
    path.join(leasePath, "lease.json"),
    `${JSON.stringify(record)}\n`,
    { mode: 0o600 },
  );
  return { actor, leaseName: policy.leaseName, leaseToken: token, record };
}

function readControlEvents(stateRoot) {
  const eventsPath = automationControlPaths(stateRoot).events;
  if (!existsSync(eventsPath)) return [];
  const text = readFileSync(eventsPath, "utf8");
  if (text.trim() === "") return [];
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

function leaseTransactionPaths(stateRoot, name, operation, operationId) {
  const leases = automationControlPaths(stateRoot).leases;
  return {
    active: path.join(leases, ".transactions", `${name}.json`),
    before: path.join(
      leases,
      ".transactions",
      `${name}.${operationId}.before.json`,
    ),
    after: path.join(
      leases,
      ".transactions",
      `${name}.${operationId}.after.json`,
    ),
    receipt: path.join(
      leases,
      ".transaction-receipts",
      `${name}.${operation}.${operationId}.json`,
    ),
  };
}

function leaseCleanupQuarantineDirectory(filePath) {
  return path.join(path.dirname(filePath), ".lease-cleanup-quarantine");
}

function leaseCleanupQuarantines(filePath, operationId) {
  const directoryPath = leaseCleanupQuarantineDirectory(filePath);
  if (!existsSync(directoryPath)) return [];
  return readdirSync(directoryPath)
    .filter(
      (entry) => entry.startsWith(`${operationId}.`) && entry.endsWith(".json"),
    )
    .map((entry) => path.join(directoryPath, entry));
}

function exactLeaseCleanupQuarantines(filePath, operationId) {
  return leaseCleanupQuarantines(filePath, operationId).filter(
    (archivePath) => {
      const bytes = readFileSync(archivePath);
      const stats = lstatSync(archivePath, { bigint: true });
      return (
        path.basename(archivePath) ===
        `${operationId}.${leaseCleanupGenerationDigestForIdentity(
          filePath,
          stats,
          bytes,
        )}.json`
      );
    },
  );
}

function exactLeaseCleanupQuarantine(filePath, operationId) {
  const matches = exactLeaseCleanupQuarantines(filePath, operationId);
  assert.equal(
    matches.length,
    1,
    `${path.basename(filePath)} must have one exact cleanup archive`,
  );
  return matches[0];
}

function leaseTransactionWalArchivePaths(transactionPaths, operationId) {
  const directoryPath = leaseCleanupQuarantineDirectory(
    transactionPaths.active,
  );
  return readdirSync(directoryPath)
    .map((entry) => path.join(directoryPath, entry))
    .filter((archivePath) => {
      try {
        const value = JSON.parse(readFileSync(archivePath, "utf8"));
        return (
          value.kind === "lease-transaction" &&
          value.operationId === operationId
        );
      } catch {
        return false;
      }
    });
}

function completedLeaseWalArchivePath(transactionPaths, operationId) {
  const matches = leaseTransactionWalArchivePaths(
    transactionPaths,
    operationId,
  ).filter((archivePath) => {
    try {
      const value = JSON.parse(readFileSync(archivePath, "utf8"));
      return value.kind === "lease-transaction" && value.phase === "complete";
    } catch {
      return false;
    }
  });
  assert.equal(matches.length, 1);
  return matches[0];
}

function rewriteCompletedLeaseTransaction(
  transactionPaths,
  operationId,
  mutate,
) {
  const receiptBefore = readFileSync(transactionPaths.receipt);
  const transaction = JSON.parse(receiptBefore.toString("utf8"));
  mutate(transaction);
  const rewrittenBytes = Buffer.from(
    `${JSON.stringify(transaction, null, 2)}\n`,
  );
  assert.equal(rewrittenBytes.length, receiptBefore.length);

  const completeWalPath = completedLeaseWalArchivePath(
    transactionPaths,
    operationId,
  );
  assert.deepEqual(readFileSync(completeWalPath), receiptBefore);
  writeFileSync(transactionPaths.receipt, rewrittenBytes, { mode: 0o600 });
  writeFileSync(completeWalPath, rewrittenBytes, { mode: 0o600 });
  const identity = lstatSync(completeWalPath, { bigint: true });
  const renamedWalPath = path.join(
    path.dirname(completeWalPath),
    `${operationId}.${leaseCleanupGenerationDigestForIdentity(
      transactionPaths.active,
      identity,
      rewrittenBytes,
    )}.json`,
  );
  renameSync(completeWalPath, renamedWalPath);
  return Object.freeze({ transaction, rewrittenBytes, renamedWalPath });
}

function rewriteControlEvent(stateRoot, eventId, mutate) {
  const eventsPath = automationControlPaths(stateRoot).events;
  const bytesBefore = readFileSync(eventsPath);
  let matches = 0;
  const rewrittenLines = bytesBefore
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => {
      const event = JSON.parse(line);
      if (event.eventId === eventId) {
        matches += 1;
        mutate(event);
      }
      return JSON.stringify(event);
    });
  assert.equal(matches, 1);
  const rewrittenBytes = Buffer.from(`${rewrittenLines.join("\n")}\n`);
  assert.equal(rewrittenBytes.length, bytesBefore.length);
  writeFileSync(eventsPath, rewrittenBytes, { mode: 0o600 });
  return rewrittenBytes;
}

function writeLeaseCleanupCapacityFixture(
  stateRoot,
  {
    operationId = "a".repeat(64),
    generationDigest = "b".repeat(64),
    bytes = Buffer.from("{}\n"),
  } = {},
) {
  const transactions = path.join(
    automationControlPaths(stateRoot).leases,
    ".transactions",
  );
  const receipts = path.join(
    automationControlPaths(stateRoot).leases,
    ".transaction-receipts",
  );
  const archiveDirectory = leaseCleanupQuarantineDirectory(
    path.join(transactions, "archive.json"),
  );
  const receiptArchiveDirectory = leaseCleanupQuarantineDirectory(
    path.join(receipts, "archive.json"),
  );
  const stateArchiveDirectory = path.join(
    automationControlPaths(stateRoot).leases,
    ".lease-state-quarantine",
  );
  mkdirSync(archiveDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(receiptArchiveDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(stateArchiveDirectory, { recursive: true, mode: 0o700 });
  for (const directory of [
    automationControlPaths(stateRoot).leases,
    transactions,
    receipts,
    archiveDirectory,
    receiptArchiveDirectory,
    stateArchiveDirectory,
  ]) {
    chmodSync(directory, 0o700);
  }
  const archivePath = path.join(
    archiveDirectory,
    `${operationId}.${generationDigest}.json`,
  );
  writeFileSync(archivePath, bytes, { mode: 0o600 });
  return archivePath;
}

function canonicalTestValue(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalTestValue(entry));
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalTestValue(value[key])]),
  );
}

function automationAuthoritySnapshotDescriptorForTest(snapshot) {
  if (snapshot.missing) return { missing: true };
  return {
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
    digest: createHash("sha256").update(snapshot.bytes).digest("hex"),
  };
}

function automationAuthorityStableGenerationDigestForTest(filePath) {
  const stats = lstatSync(filePath, { bigint: true });
  const descriptor = {
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    mode: Number(stats.mode & 0o7777n),
    nlink: Number(stats.nlink),
    uid: Number(stats.uid),
    gid: Number(stats.gid),
    size: Number(stats.size),
    mtimeNs: stats.mtimeNs.toString(),
    digest: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalTestValue(descriptor)))
    .digest("hex");
}

function authorityRetirementPathForTest({
  filePath,
  snapshot,
  operationId,
  retirementBasename = path.basename(filePath),
}) {
  const generation = automationAuthoritySnapshotDescriptorForTest(snapshot);
  const operationNamespace = createHash("sha256")
    .update(
      JSON.stringify(
        canonicalTestValue({
          purpose: "automation-authority-file-retirement-v1",
          filePath: path.resolve(filePath),
          operationId,
          generation,
          parent: snapshot.directoryIdentity,
        }),
      ),
    )
    .digest("hex");
  const generationDigest = createHash("sha256")
    .update(
      JSON.stringify(
        canonicalTestValue({
          purpose: "automation-authority-generation-retirement-v1",
          filePath: path.resolve(filePath),
          generation,
        }),
      ),
    )
    .digest("hex");
  return path.join(
    path.dirname(filePath),
    ".authority-retirements",
    `${retirementBasename}.${operationNamespace}.${generationDigest}.retired`,
  );
}

function leaseCleanupGenerationDigestForFile(originalPath, filePath) {
  const stats = lstatSync(filePath);
  return leaseCleanupGenerationDigestForIdentity(
    originalPath,
    stats,
    readFileSync(filePath),
    { exact: false },
  );
}

function leaseCleanupGenerationDigestForIdentity(
  originalPath,
  identity,
  bytes,
  { exact = true } = {},
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalTestValue({
          filePath: originalPath,
          device: exact
            ? BigInt(identity.dev).toString()
            : Number(identity.dev),
          inode: exact ? BigInt(identity.ino).toString() : Number(identity.ino),
          mode: Number(identity.mode),
          links: Number(identity.nlink),
          uid: Number(identity.uid),
          gid: Number(identity.gid),
          size: Number(identity.size),
          contentDigest: createHash("sha256").update(bytes).digest("hex"),
        }),
      ),
    )
    .digest("hex");
}

function publishExactLeaseCleanupFixture(
  temporaryPath,
  originalPath,
  operationId,
) {
  const archivePath = path.join(
    path.dirname(temporaryPath),
    `${operationId}.${leaseCleanupGenerationDigestForFile(
      originalPath,
      temporaryPath,
    )}.json`,
  );
  renameSync(temporaryPath, archivePath);
  return archivePath;
}

function snapshotFilesystemEntry(filePath) {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const metadata = {
    mode: stats.mode & 0o777,
    nlink: stats.nlink,
  };
  if (stats.isSymbolicLink()) {
    return {
      type: "symlink",
      ...metadata,
      target: readlinkSync(filePath),
    };
  }
  if (stats.isDirectory()) {
    return {
      type: "directory",
      ...metadata,
      entries: readdirSync(filePath)
        .sort()
        .map((entry) => [
          entry,
          snapshotFilesystemEntry(path.join(filePath, entry)),
        ]),
    };
  }
  if (stats.isFile()) {
    return {
      type: "file",
      ...metadata,
      bytesBase64: readFileSync(filePath).toString("base64"),
    };
  }
  return {
    type: "special",
    ...metadata,
    fifo: stats.isFIFO(),
    socket: stats.isSocket(),
  };
}

function snapshotLeaseAuthorityState(stateRoot) {
  const paths = automationControlPaths(stateRoot);
  return {
    events: snapshotFilesystemEntry(paths.events),
    leases: snapshotFilesystemEntry(paths.leases),
  };
}

function snapshotTaskMutationState(stateRoot) {
  const paths = automationControlPaths(stateRoot);
  return {
    manifest: snapshotFilesystemEntry(paths.taskManifest),
    events: snapshotFilesystemEntry(paths.events),
    transactions: snapshotFilesystemEntry(paths.taskTransactions),
    outcomes: snapshotFilesystemEntry(paths.outcomes),
  };
}

function testLeaseAuthorityWindow(stateRoot, leaseName) {
  const record = JSON.parse(
    readFileSync(
      path.join(
        automationControlPaths(stateRoot).leases,
        `${leaseName}.lease`,
        "lease.json",
      ),
      "utf8",
    ),
  );
  return {
    acquiredAtMs: Date.parse(record.acquiredAt),
    expiresAtMs: Date.parse(record.expiresAt),
  };
}

function assertLeaseEventTimeRejected(stateRoot, operation, message) {
  const before = snapshotTaskMutationState(stateRoot);
  assert.throws(
    operation,
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_event_time_invalid",
    message,
  );
  assert.deepEqual(snapshotTaskMutationState(stateRoot), before, message);
}

function throwAtLeaseCheckpoint(target) {
  let thrown = false;
  return (phase) => {
    if (!thrown && phase === target) {
      thrown = true;
      throw new Error(`lease checkpoint ${target}`);
    }
  };
}

function runLeaseMutationProcessLoss({
  exportName,
  options,
  phase,
  kind = undefined,
  occurrence = 1,
}) {
  const usesTrustedGeneralActorAcquire =
    exportName === "acquireLease" &&
    options.owner !== "freed-owner" &&
    options.owner !== "freed-pr-publisher" &&
    AUTOMATION_ACTOR_POLICIES[options.owner]?.maxLeaseLifetimeMs !== undefined;
  const moduleUrl = usesTrustedGeneralActorAcquire
    ? TRUSTED_ACTOR_CONTROL_MODULE_URL
    : new URL("./lib/automation-control.mjs", import.meta.url).href;
  const importedExportName = usesTrustedGeneralActorAcquire
    ? "acquireGeneralActorLeaseForTest"
    : exportName;
  const source = `
    import { ${importedExportName} } from ${JSON.stringify(moduleUrl)};
    const options = ${JSON.stringify(options)};
    let matchingCheckpointCount = 0;
    options.checkpoint = (phase, details) => {
      if (
        phase === ${JSON.stringify(phase)} &&
        (${JSON.stringify(kind ?? null)} === null || details?.kind === ${JSON.stringify(kind ?? null)})
      ) {
        matchingCheckpointCount += 1;
        if (matchingCheckpointCount === ${JSON.stringify(occurrence)}) {
          process.kill(process.pid, "SIGKILL");
        }
      }
    };
    ${importedExportName}(options);
    process.exitCode = 91;
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    {
      cwd: __dirname,
      encoding: "utf8",
      env: { ...process.env },
      timeout: 30_000,
    },
  );
  assert.equal(result.signal, "SIGKILL", result.stderr || result.stdout);
}

function retireReadyAuthorityWitnessForLegacyFixture(filePath) {
  const directory = path.dirname(filePath);
  const prefix = `.${path.basename(filePath)}.authority.`;
  const entries = readdirSync(directory).filter((entry) =>
    entry.startsWith(prefix),
  );
  assert.equal(entries.length, 1, JSON.stringify(entries));
  assert.match(
    entries[0].slice(prefix.length),
    /^[0-9a-f]{64}\.[0-9a-f]{64}\.tmp$/,
  );
  rmSync(path.join(directory, entries[0]));
}

function readEvents(stateRoot) {
  const eventsPath = automationControlPaths(stateRoot).events;
  return readFileSync(eventsPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function pinnedLegacyRuntimeObserverTakeover() {
  return {
    schemaVersion: 1,
    eventId: "349350ac-eb71-4c6d-b861-36860ffd2be2",
    type: "lease_taken_over",
    ts: "2026-07-14T14:14:20.779Z",
    actor: "freed-runtime-observer",
    leaseName: "runtime-observer",
    data: {
      expiresAt: "2026-07-14T14:44:20.779Z",
      observerAuthority: "observe-only",
      providerAuthority: "forbidden",
      credentialKind: "persistent-actor",
      actorCredentialPath:
        "/Users/aubreyfalconer/.freed/automation/control/actor-credentials/freed-runtime-observer.json",
      previous: {
        owner: "freed-runtime-observer",
        expiredAt: "2026-07-14T07:48:56.707Z",
        heartbeatAt: "2026-07-14T07:18:56.707Z",
      },
    },
  };
}

function leaseHistoryCorruptionEvent(sourceEvent, variant, label) {
  if (variant === "duplicate") return structuredClone(sourceEvent);
  if (variant === "conflicting") {
    const conflicting = structuredClone(sourceEvent);
    conflicting.data.expiresAt = new Date(
      Date.parse(conflicting.data.expiresAt) + 1,
    ).toISOString();
    return conflicting;
  }
  assert.equal(variant, "malformed-reserved");
  return {
    schemaVersion: 1,
    eventId: `lease:${createHash("sha256").update(label).digest("hex")}`,
    type: "unrelated_diagnostic",
    ts: sourceEvent.ts,
    actor: sourceEvent.actor,
    leaseName: sourceEvent.leaseName,
    data: {},
  };
}

function appendLeaseHistoryCorruption(stateRoot, sourceEvent, variant, label) {
  const corruption = leaseHistoryCorruptionEvent(sourceEvent, variant, label);
  appendFileSync(
    automationControlPaths(stateRoot).events,
    `${JSON.stringify(corruption)}\n`,
    { mode: 0o600 },
  );
  return corruption;
}

function assertLeaseHistoryRejectsMutation(
  stateRoot,
  operation,
  label,
  expectedCodes = ["control_event_history_invalid"],
) {
  const before = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    operation,
    (error) =>
      isAutomationControlError(error) && expectedCodes.includes(error.code),
    label,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), before, label);
}

function actorLease(
  stateRoot,
  actor,
  {
    nowMs = Date.now(),
    token = `${actor}-caller-retained-${"x".repeat(32)}`,
    ownerTaskId = undefined,
    ownerIntentDigest = undefined,
  } = {},
) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const currentTimeMs = Date.now();
  const leaseNowMs =
    nowMs >= currentTimeMs - 5 * 60_000 && nowMs <= currentTimeMs + 1_000
      ? nowMs
      : currentTimeMs;
  assert.ok(policy, `missing actor policy for ${actor}`);
  if (actor === "freed-owner") {
    assert.match(ownerTaskId ?? "", /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    assert.match(ownerIntentDigest ?? "", /^[0-9a-f]{64}$/);
    const intent = ownerIntentsByDigest.get(ownerIntentDigest);
    assert.ok(intent, `missing owner intent for ${ownerIntentDigest}`);
    const confirmationId = `owner-test-${createHash("sha256")
      .update(`${stateRoot}:${ownerTaskId}:${leaseNowMs}:${ownerIntentDigest}`)
      .digest("hex")}`;
    const { confirmationPath } = writeOwnerConfirmation(
      stateRoot,
      ownerTaskId,
      intent,
      { nowMs: leaseNowMs, confirmationId },
    );
    const leaseToken =
      Buffer.byteLength(token, "utf8") >= 32
        ? token
        : `${token}:${"x".repeat(32)}`;
    const acquired = acquireLease({
      stateRoot,
      name: policy.leaseName,
      owner: actor,
      ttlMs: 10 * 60_000,
      nowMs: leaseNowMs,
      token: leaseToken,
      ownerConfirmationFile: confirmationPath,
      ownerCapabilityTaskId: ownerTaskId,
      ownerCapabilityIntentDigest: ownerIntentDigest,
    });
    assert.equal(acquired.lease.credentialKind, "owner-confirmation");
    return { actor, leaseName: policy.leaseName, leaseToken };
  }
  assert.equal(policy.maxLeaseLifetimeMs, 30 * 60_000);
  const operationId = nextLeaseOperationId(`actor-lease-${actor}`);
  const acquired = acquireLeaseMutation({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    operationId,
    ttlMs: policy.maxLeaseLifetimeMs,
    nowMs: leaseNowMs,
    token,
  });
  assert.equal(acquired.lease.credentialKind, "trusted-launcher-channel");
  return { actor, leaseName: policy.leaseName, leaseToken: token };
}

function ownerLeaseAcquisition(stateRoot) {
  const matches = readEvents(stateRoot).filter(
    (event) =>
      event.type === "lease_acquired" &&
      event.actor === "freed-owner" &&
      event.leaseName === "owner-governance",
  );
  assert.equal(matches.length, 1);
  return matches[0];
}

function completeGuardedOutcome({
  stateRoot,
  taskId,
  authentication,
  outcome,
  nowMs,
  details = {},
  beforeFinalize = () => {},
}) {
  const paths = automationControlPaths(stateRoot);
  const evidence = { digest: "a".repeat(64) };
  const installedIdentity =
    outcome === "installed"
      ? normalizeInstalledBuildIdentity(details.installedIdentity)
      : null;
  const cleanEntry = {
    schemaVersion: 3,
    ts: new Date(nowMs).toISOString(),
    id: taskId,
    taskId,
    kind: "stability",
    outcome,
    notes: "",
    evidence,
    ...(installedIdentity === null
      ? {}
      : {
          build: installedIdentity.version,
          buildIdentity: installedIdentity,
        }),
  };
  const outcomeDigest = createHash("sha256")
    .update(JSON.stringify(cleanEntry))
    .digest("hex");
  return withMutationLeaseAuthority(
    { stateRoot, taskId, ...authentication },
    (authorityContext) =>
      withOutcomeRecordingGuards(
        { stateRoot, nowMs, authorityContext },
        (control) => {
          const transition = control.transitionTask({
            stateRoot,
            taskId,
            ...authentication,
            toState: outcome,
            details: {
              ...details,
              latestOutcome: {
                outcome,
                evidence,
                ...(installedIdentity === null
                  ? {}
                  : {
                      build: installedIdentity.version,
                      buildIdentity: installedIdentity,
                      installedIdentity,
                    }),
                outcomeDigest,
                recordedAt: cleanEntry.ts,
              },
            },
            nowMs,
          });
          const controlEventId = outcomeRecordedEventId({
            taskId,
            taskRevision: transition.task.revision,
            outcomeDigest,
            transitionEventId: transition.event.eventId,
          });
          const controlEventData = {
            ledgerPath: paths.outcomes,
            leaseName: authentication.leaseName,
            id: cleanEntry.id,
            taskId,
            taskRevision: transition.task.revision,
            taskState: outcome,
            kind: cleanEntry.kind,
            outcome,
            outcomeDigest,
            transitionEventId: transition.event.eventId,
            evidence,
          };
          control.appendOutcomeControlEvent({
            stateRoot,
            taskId,
            ...authentication,
            eventId: controlEventId,
            data: controlEventData,
            nowMs,
          });
          appendFileSync(
            paths.outcomes,
            `${JSON.stringify({
              ...cleanEntry,
              authentication: {
                actor: authentication.actor,
                leaseName: authentication.leaseName,
                controlEventId,
                transitionEventId: transition.event.eventId,
                outcomeDigest,
                taskRevision: transition.task.revision,
              },
            })}\n`,
            { mode: 0o600 },
          );
          beforeFinalize({
            paths,
            transition,
            outcomeDigest,
            controlEventId,
          });
          control.finalizeTaskOutcome({
            stateRoot,
            taskId,
            ...authentication,
            outcome,
            outcomeDigest,
            taskRevision: transition.task.revision,
            nowMs,
          });
          return transition;
        },
      ),
  );
}

function withTestOutcomeRecordingGuards(
  { stateRoot, taskId, authentication, nowMs = Date.now() },
  callback,
) {
  return withMutationLeaseAuthority(
    { stateRoot, taskId, ...authentication },
    (authorityContext) =>
      withOutcomeRecordingGuards(
        { stateRoot, nowMs, authorityContext },
        callback,
      ),
  );
}

function prepareLegacyOutcomeBackfillFixture({
  stateRoot,
  taskId,
  outcome,
  nowMs,
  installedIdentity = undefined,
}) {
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  const scaffolding = actorLease(stateRoot, "freed-scaffolding-maintainer", {
    nowMs,
  });
  const runner = actorLease(stateRoot, "freed-nightly-runner", { nowMs });
  let tick = 1;
  const nextNow = () => nowMs + tick++;
  createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nextNow(),
  });
  transitionTask({
    stateRoot,
    taskId,
    ...controller,
    toState: "triaged",
    nowMs: nextNow(),
  });
  transitionTask({
    stateRoot,
    taskId,
    ...controller,
    toState: "approved_for_pr",
    nowMs: nextNow(),
  });
  transitionTask({
    stateRoot,
    taskId,
    ...scaffolding,
    toState: "implemented",
    nowMs: nextNow(),
  });
  transitionTask({
    stateRoot,
    taskId,
    ...scaffolding,
    toState: "validated",
    nowMs: nextNow(),
  });
  if (outcome === "installed") {
    completeGuardedOutcome({
      stateRoot,
      taskId,
      authentication: runner,
      outcome: "merged",
      nowMs: nextNow(),
    });
  }
  completeGuardedOutcome({
    stateRoot,
    taskId,
    authentication: runner,
    outcome,
    ...(outcome === "installed" ? { details: { installedIdentity } } : {}),
    nowMs: nextNow(),
  });

  const paths = automationControlPaths(stateRoot);
  const manifest = JSON.parse(readFileSync(paths.taskManifest, "utf8"));
  const task = manifest.tasks.find((candidate) => candidate.taskId === taskId);
  delete task.details.latestOutcome;
  delete task.pendingOutcome;

  const events = readEvents(stateRoot);
  const legacyTransition = events.find(
    (event) =>
      event.type === "task_transitioned" &&
      event.taskId === taskId &&
      event.taskRevision === task.revision &&
      event.data?.toState === outcome,
  );
  assert.ok(legacyTransition);
  manifest.revision = legacyTransition.manifestRevision;
  manifest.updatedAt = legacyTransition.ts;
  const manifestSnapshot = readAutomationAuthorityFileSnapshot(
    paths.taskManifest,
    {
      allowMissing: false,
      allowEmpty: false,
      privateRoot: paths.controlRoot,
      maxBytes: 16 * 1024 * 1024,
      allowedModes: [0o600],
      label: "Legacy backfill fixture task manifest",
    },
  );
  writeJsonAtomic(paths.taskManifest, manifest, {
    expectedSnapshot: manifestSnapshot,
    operationId: `test-legacy-backfill-manifest:${taskId}:${outcome}`,
    privateRoot: paths.controlRoot,
    label: "Legacy backfill fixture task manifest",
  });
  delete legacyTransition.data.outcomeDigest;
  delete legacyTransition.data.outcomeRequired;
  const retainedEvents = events.filter(
    (event) =>
      event.eventId === legacyTransition.eventId ||
      event.taskId !== taskId ||
      !(
        (event.type === "outcome_recorded" &&
          event.data?.outcome === outcome) ||
        (event.type === "outcome_reservation_finalized" &&
          event.data?.outcome === outcome)
      ),
  );
  const retainedEventBytes = Buffer.from(
    `${retainedEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
  const eventSnapshot = readAutomationAuthorityFileSnapshot(paths.events, {
    allowMissing: false,
    allowEmpty: false,
    privateRoot: paths.controlRoot,
    maxBytes: CONTROL_EVENT_HISTORY_MAX_BYTES,
    allowedModes: [0o600],
    label: "Legacy backfill fixture event history",
  });
  writeAutomationAuthorityFile({
    filePath: paths.events,
    bytes: retainedEventBytes,
    previousSnapshot: eventSnapshot,
    operationId: `test-legacy-backfill-events:${taskId}:${outcome}`,
    privateRoot: paths.controlRoot,
    maxBytes: CONTROL_EVENT_HISTORY_MAX_BYTES,
    allowedModes: [0o600],
    label: "Legacy backfill fixture event history",
  });

  const ledgerEntries = readFileSync(paths.outcomes, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => !(entry.taskId === taskId && entry.outcome === outcome));
  writeFileSync(
    paths.outcomes,
    ledgerEntries.length === 0
      ? ""
      : `${ledgerEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    { mode: 0o600 },
  );

  retireReadyAuthorityWitnessForLegacyFixture(paths.taskManifest);
  retireReadyAuthorityWitnessForLegacyFixture(paths.events);

  return {
    authentication: runner,
    controllerAuthentication: controller,
    legacyTransitionEventId: legacyTransition.eventId,
    paths,
    task: readTask({ stateRoot, taskId }),
  };
}

function createOutcomeLedgerRepairTask(stateRoot, taskId, nowMs) {
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nowMs + 1,
  });
}

function leaveOutcomeLedgerRepairFenced(label) {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const taskId = `fenced-owner-lease-${label}`;
  createOutcomeLedgerRepairTask(stateRoot, taskId, nowMs - 1_000);
  const paths = automationControlPaths(stateRoot);
  const source = Buffer.from(
    `${JSON.stringify({
      ts: new Date(nowMs - 2_000).toISOString(),
      id: `legacy-${label}`,
      kind: "stability-task",
      outcome: "shipped",
      notes: "Legacy unauthenticated outcome.",
    })}\n`,
    "utf8",
  );
  writeFileSync(paths.outcomes, source, { mode: 0o600 });
  chmodSync(paths.outcomes, 0o600);
  const sourceDigest = createHash("sha256").update(source).digest("hex");
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId,
    expectedSourceDigest: sourceDigest,
  });
  const ownerConfirmation = writeOwnerConfirmation(
    stateRoot,
    taskId,
    plan.intent,
    {
      nowMs,
      confirmationId: `fence-${label}`,
    },
  );
  const ownerToken = `fence-${label}-owner-${"x".repeat(40)}`;
  const ownerAcquisition = acquireLeaseLive({
    stateRoot,
    name: "owner-governance",
    owner: "freed-owner",
    operationId: nextLeaseOperationId(`fence-${label}-owner-acquire`),
    ttlMs: 10 * 60_000,
    token: ownerToken,
    ownerConfirmationFile: ownerConfirmation.confirmationPath,
    ownerCapabilityTaskId: taskId,
    ownerCapabilityIntentDigest: plan.intentDigest,
  });
  const owner = {
    actor: "freed-owner",
    leaseName: ownerAcquisition.lease.name,
    leaseToken: ownerToken,
  };
  assert.throws(
    () =>
      repairOutcomeLedger(
        {
          stateRoot,
          taskId,
          expectedSourceDigest: sourceDigest,
          ...owner,
        },
        {
          checkpoint: (checkpoint) => {
            if (checkpoint === "transaction-fenced") {
              throw new Error(`leave ${label} fenced`);
            }
          },
        },
      ),
    new RegExp(`leave ${label} fenced`),
  );
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "fenced",
  );
  return { stateRoot, taskId, sourceDigest, plan, owner };
}

function runCli(args, { env = process.env } = {}) {
  const operationId = nextLeaseOperationId("cli");
  return JSON.parse(
    execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: "utf8",
      env: {
        ...env,
        FREED_AUTOMATION_LEASE_OPERATION_ID:
          env.FREED_AUTOMATION_LEASE_OPERATION_ID ?? operationId,
        ...(env.FREED_AUTOMATION_LEASE_TOKEN !== undefined ||
        env.FREED_OWNER_LEASE_TOKEN !== undefined
          ? {}
          : { FREED_AUTOMATION_LEASE_TOKEN: `caller-retained-${operationId}` }),
      },
    }),
  );
}

function spawnCli(args, { env = process.env, supplyLeaseToken = true } = {}) {
  const operationId = nextLeaseOperationId("spawn-cli");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: {
        ...env,
        FREED_AUTOMATION_LEASE_OPERATION_ID:
          env.FREED_AUTOMATION_LEASE_OPERATION_ID ?? operationId,
        ...(!supplyLeaseToken ||
        env.FREED_AUTOMATION_LEASE_TOKEN !== undefined ||
        env.FREED_OWNER_LEASE_TOKEN !== undefined
          ? {}
          : { FREED_AUTOMATION_LEASE_TOKEN: `caller-retained-${operationId}` }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function waitForPathSync(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(filePath) && Date.now() < deadline) {
    Atomics.wait(waitArray, 0, 0, 10);
  }
  assert.equal(existsSync(filePath), true, `Timed out waiting for ${filePath}`);
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

test("state root defaults under the user automation directory and supports explicit roots", () => {
  assert.equal(
    resolveAutomationStateRoot(),
    path.join(os.homedir(), ".freed", "automation"),
  );
  const explicit = path.join(os.tmpdir(), "freed-control-explicit");
  assert.equal(resolveAutomationStateRoot(explicit), explicit);
  assert.equal(
    resolveAutomationStateRoot("~/.freed/automation-test"),
    path.join(os.homedir(), ".freed", "automation-test"),
  );
});

test("kernel guards preserve the old directory sentinel and lock the permanent inner file", () => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  const guardPath = path.join(paths.guards, "tasks.lock");
  const ownerPath = path.join(guardPath, AUTOMATION_KERNEL_GUARD_OWNER_FILE);
  const innerPath = path.join(guardPath, AUTOMATION_KERNEL_GUARD_INNER_FILE);

  const manifest = readTaskManifest({ stateRoot });
  const guardStats = lstatSync(guardPath);

  assert.equal(manifest.revision, 0);
  assert.equal(guardStats.isDirectory(), true);
  assert.equal(guardStats.isSymbolicLink(), false);
  assert.equal(guardStats.mode & 0o777, 0o700);
  for (const markerPath of [ownerPath, innerPath]) {
    const markerStats = lstatSync(markerPath);
    assert.equal(markerStats.isFile(), true);
    assert.equal(markerStats.isSymbolicLink(), false);
    assert.equal(markerStats.mode & 0o777, 0o600);
    assert.deepEqual(
      readFileSync(markerPath),
      automationKernelGuardMarkerBytes(),
    );
  }
});

test("kernel guard cutover admits only an explicit local filesystem type", () => {
  const stateRoot = temporaryStateRoot();

  assert.equal(inspectAutomationKernelGuardCutover(stateRoot).ready, true);
  assert.equal(
    inspectAutomationKernelGuardCutover(stateRoot, {
      resolveFilesystemType: () => "apfs",
    }).ready,
    true,
  );

  for (const filesystemType of [
    "nfs",
    "smbfs",
    "cifs",
    "afp",
    "afpfs",
    "webdav",
    "webdavfs",
    "unknown",
  ]) {
    const inspection = inspectAutomationKernelGuardCutover(stateRoot, {
      resolveFilesystemType: () => filesystemType,
    });
    assert.equal(inspection.ready, false, filesystemType);
    assert.match(
      inspection.problems.join("\n"),
      new RegExp(`unsupported filesystem type ${filesystemType}`),
    );
  }

  const failed = inspectAutomationKernelGuardCutover(stateRoot, {
    resolveFilesystemType: () => {
      throw new Error("filesystem query failed");
    },
  });
  assert.equal(failed.ready, false);
  assert.match(
    failed.problems.join("\n"),
    /filesystem type could not be admitted: filesystem query failed/,
  );
});

test("kernel guard filesystem resolver has explicit macOS and Linux allowlists", () => {
  const stateRoot = temporaryStateRoot();
  assert.equal(
    resolveAutomationKernelGuardFilesystemType(stateRoot, {
      platform: "darwin",
      statfs: () => ({ type: 0x1an }),
    }),
    "apfs",
  );
  for (const [type, expected] of [
    [0xef53n, "ext"],
    [0x01021994n, "tmpfs"],
    [0x58465342n, "xfs"],
    [0x794c7630n, "overlayfs"],
    [0x9123683en, "btrfs"],
  ]) {
    assert.equal(
      resolveAutomationKernelGuardFilesystemType(stateRoot, {
        platform: "linux",
        statfs: () => ({ type }),
      }),
      expected,
    );
  }
  for (const type of [0x6969n, 0xff534d42n, 0x65735546n]) {
    assert.throws(
      () =>
        resolveAutomationKernelGuardFilesystemType(stateRoot, {
          platform: "linux",
          statfs: () => ({ type }),
        }),
      /not in the linux local allowlist/,
    );
  }
  assert.throws(
    () =>
      resolveAutomationKernelGuardFilesystemType(stateRoot, {
        platform: "win32",
        statfs: () => ({ type: 0n }),
      }),
    /platform win32 has no local filesystem allowlist/,
  );
});

test("kernel guard cutover rejects extra entries inside a canonical guard directory", () => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  const extraPath = path.join(paths.guards, "events.lock", "unexpected.json");
  writeFileSync(extraPath, "{}\n", { mode: 0o600 });

  const inspection = inspectAutomationKernelGuardCutover(stateRoot);

  assert.equal(inspection.ready, false);
  assert.match(
    inspection.problems.join("\n"),
    /does not contain exactly the owner sentinel and inner kernel lock/,
  );
});

test("control mutations fail closed before touching a state root without a cutover receipt", () => {
  const stateRoot = temporaryUncutoverStateRoot();
  const before = readdirSync(stateRoot);

  assert.throws(
    () => readTaskManifest({ stateRoot }),
    (error) =>
      error?.code === "invalid_state" &&
      /cutover is incomplete/.test(error.message),
  );
  assert.deepEqual(readdirSync(stateRoot), before);
});

test("outcome writer runtime preserves its permanent marker and requires the cutover receipt", () => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  const writerPath = `${paths.outcomes}.writer-lock`;
  const receiptPath = path.join(paths.controlRoot, "kernel-guard-cutover.json");
  const beforeStats = lstatSync(writerPath);
  const beforeBytes = readFileSync(writerPath);
  let calls = 0;

  withAutomationOutcomeLedgerWriterGuard(
    paths.outcomes,
    () => {
      calls += 1;
    },
    { stateRoot },
  );
  assert.equal(calls, 1);
  assert.equal(lstatSync(writerPath).ino, beforeStats.ino);
  assert.deepEqual(readFileSync(writerPath), beforeBytes);

  chmodSync(receiptPath, 0o644);
  try {
    assert.throws(
      () =>
        withAutomationOutcomeLedgerWriterGuard(
          paths.outcomes,
          () => {
            calls += 1;
          },
          { stateRoot },
        ),
      /cutover is incomplete/,
    );
  } finally {
    chmodSync(receiptPath, 0o600);
  }
  assert.equal(calls, 1);
});

test("outcome writer snapshot cache invalidates a same-inode rewrite", () => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  const fixtureDirectory = path.join(paths.controlRoot, "snapshot-cache");
  mkdirSync(fixtureDirectory, { mode: 0o700 });
  const filePath = path.join(fixtureDirectory, "snapshot-cache.json");
  const firstBytes = Buffer.from('{"generation":"first!"}\n');
  const secondBytes = Buffer.from('{"generation":"second"}\n');
  assert.equal(firstBytes.length, secondBytes.length);
  writeFileSync(filePath, firstBytes, { mode: 0o600 });

  withAutomationOutcomeLedgerWriterGuard(
    paths.outcomes,
    () => {
      consumeLeaseArchiveHelperInvocationCountForTest();
      const first = readAutomationAuthorityFileSnapshot(filePath, {
        privateRoot: paths.controlRoot,
        label: "Outcome writer snapshot cache fixture",
      });
      const firstHelperCalls =
        consumeLeaseArchiveHelperInvocationCountForTest();
      assert.ok(firstHelperCalls > 0);

      const cached = readAutomationAuthorityFileSnapshot(filePath, {
        privateRoot: paths.controlRoot,
        label: "Outcome writer snapshot cache fixture",
      });
      assert.equal(consumeLeaseArchiveHelperInvocationCountForTest(), 0);
      assert.deepEqual(cached.bytes, firstBytes);

      assert.throws(
        () =>
          readAutomationAuthorityFileSnapshot(
            path.relative(process.cwd(), filePath),
            {
              privateRoot: paths.controlRoot,
              label: "Outcome writer snapshot cache fixture",
            },
          ),
        (error) =>
          error instanceof AutomationControlError &&
          error.code === "invalid_state",
      );
      chmodSync(paths.controlRoot, 0o755);
      try {
        assert.throws(
          () =>
            readAutomationAuthorityFileSnapshot(filePath, {
              privateRoot: paths.controlRoot,
              label: "Outcome writer snapshot cache fixture",
            }),
          (error) =>
            error instanceof AutomationControlError &&
            error.code === "invalid_state",
        );
      } finally {
        chmodSync(paths.controlRoot, 0o700);
      }
      consumeLeaseArchiveHelperInvocationCountForTest();

      writeFileSync(filePath, secondBytes, { mode: 0o600 });
      assert.equal(lstatSync(filePath).ino, Number(first.identity.ino));
      const rewritten = readAutomationAuthorityFileSnapshot(filePath, {
        privateRoot: paths.controlRoot,
        label: "Outcome writer snapshot cache fixture",
      });
      assert.ok(consumeLeaseArchiveHelperInvocationCountForTest() > 0);
      assert.deepEqual(rewritten.bytes, secondBytes);
    },
    { stateRoot },
  );
});

test("a SIGKILL process loss releases the kernel guard for one recovery", () => {
  const stateRoot = temporaryStateRoot();
  const guardPath = path.join(stateRoot, "sigkill-kernel.lock");
  writeKernelGuardMarker(guardPath);
  const moduleUrl = new URL("./lib/automation-control.mjs", import.meta.url)
    .href;
  const killed = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { withKernelFileGuard } from ${JSON.stringify(moduleUrl)}; withKernelFileGuard(${JSON.stringify(guardPath)}, () => process.kill(process.pid, "SIGKILL"));`,
    ],
    { stdio: "ignore" },
  );

  return new Promise((resolve, reject) => {
    killed.once("error", reject);
    killed.once("close", (code, signal) => {
      try {
        assert.equal(code, null);
        assert.equal(signal, "SIGKILL");
        let recoveries = 0;
        withKernelFileGuard(guardPath, () => {
          recoveries += 1;
        });
        assert.equal(recoveries, 1);
        assert.equal(lstatSync(guardPath).isFile(), true);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
});

test("a live kernel guard blocks a contender without changing its inode", () => {
  const stateRoot = temporaryStateRoot();
  const guardPath = path.join(stateRoot, "contended-kernel.lock");
  writeKernelGuardMarker(guardPath);
  const moduleUrl = new URL("./lib/automation-control.mjs", import.meta.url)
    .href;

  withKernelFileGuard(guardPath, () => {
    const before = lstatSync(guardPath);
    const ownerBytes = readFileSync(guardPath, "utf8");
    const contender = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { performance } from "node:perf_hooks"; import { withKernelFileGuard } from ${JSON.stringify(moduleUrl)}; const started = performance.now(); try { withKernelFileGuard(${JSON.stringify(guardPath)}, () => process.stdout.write("entered"), { timeoutMs: 25, now: () => 0 }); } catch (error) { process.stdout.write(JSON.stringify({ code: error?.code ?? "error", elapsedMs: performance.now() - started })); }`,
      ],
      { encoding: "utf8", timeout: 2_000 },
    );
    const contention = JSON.parse(contender);
    const after = lstatSync(guardPath);
    assert.equal(contention.code, "guard_timeout");
    assert.ok(contention.elapsedMs >= 20);
    assert.ok(contention.elapsedMs < 2_000);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(readFileSync(guardPath, "utf8"), ownerBytes);
  });
});

test("kernel guard callbacks must be synchronous", () => {
  const stateRoot = temporaryStateRoot();
  const guardPath = path.join(stateRoot, "kernel-callback.lock");
  writeKernelGuardMarker(guardPath);

  assert.throws(
    () => withKernelFileGuard(guardPath, async () => undefined),
    /callbacks must be synchronous/,
  );
});

test("low-level kernel guards reject missing and inexact permanent markers", () => {
  const stateRoot = temporaryStateRoot();
  const guardPath = path.join(stateRoot, "exact-marker.lock");

  assert.throws(
    () => withKernelFileGuard(guardPath, () => undefined),
    (error) => error?.code === "ENOENT",
  );
  const markerBytes = automationKernelGuardMarkerBytes();
  for (const bytes of [
    Buffer.alloc(0),
    markerBytes.subarray(0, markerBytes.length - 1),
    Buffer.concat([markerBytes, Buffer.from(" ")]),
  ]) {
    writeFileSync(guardPath, bytes, { mode: 0o600 });
    assert.throws(
      () => withKernelFileGuard(guardPath, () => undefined),
      /exact permanent kernel-lock marker/,
    );
  }
});

test("outcome repair finalization guard rejects a missing canonical transaction before callback", () => {
  const stateRoot = temporaryStateRoot();
  const taskId = "repair-event-guard-scope";
  const nowMs = Date.now();
  createOutcomeLedgerRepairTask(stateRoot, taskId, nowMs - 1_000);
  const parameters = outcomeLedgerRepairParametersForCurrentEventHistory(
    stateRoot,
    taskId,
  );
  const ownerIntentDigest = ownerIntent(
    "outcome-ledger.repair",
    taskId,
    parameters,
  );
  const owner = actorLease(stateRoot, "freed-owner", {
    nowMs,
    ownerTaskId: taskId,
    ownerIntentDigest,
  });
  const authority = { stateRoot, taskId, ownerIntentDigest, ...owner };
  const paths = automationControlPaths(stateRoot);
  const eventsBefore = readFileSync(paths.events);
  let called = false;

  assert.throws(
    () =>
      withMutationLeaseAuthority(authority, (authorityContext) =>
        withOutcomeLedgerRepairFinalizationGuard(
          {
            stateRoot,
            taskId,
            ...owner,
            parameters,
            authorityContext,
            transactionPath: path.join(
              paths.controlRoot,
              "outcome-ledger-transactions",
              `${parameters.operationId}.json`,
            ),
          },
          () => {
            called = true;
          },
        ),
      ),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "outcome_ledger_repair_transaction_invalid",
  );
  assert.equal(called, false);
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.equal(
    readEvents(stateRoot).some(
      (event) =>
        event.eventId === `outcome-history-repaired:${parameters.operationId}`,
    ),
    false,
  );
});

test("outcome recording guard helpers cannot escape their synchronous scope", () => {
  const stateRoot = temporaryStateRoot();
  const authentication = actorLease(stateRoot, "freed-stability-controller");
  const authority = { stateRoot, ...authentication };
  let escaped;

  withMutationLeaseAuthority(authority, (authorityContext) =>
    withOutcomeRecordingGuards({ stateRoot, authorityContext }, (helpers) => {
      escaped = helpers;
    }),
  );

  assert.throws(
    () => escaped.readTask("escaped-task"),
    /scope is no longer active/,
  );
  withMutationLeaseAuthority(authority, (authorityContext) =>
    assert.throws(
      () =>
        withOutcomeRecordingGuards(
          { stateRoot, authorityContext },
          async () => undefined,
        ),
      /callback must be synchronous/,
    ),
  );
});

test("lease mutation authority cannot escape or continue asynchronously", () => {
  const stateRoot = temporaryStateRoot();
  const authentication = actorLease(stateRoot, "freed-stability-controller");
  const authority = { stateRoot, ...authentication };
  let escaped;

  withMutationLeaseAuthority(authority, (authorityContext) => {
    escaped = authorityContext;
  });
  assert.throws(
    () => escaped.authorize(authority),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_authority_inactive",
  );
  assert.throws(
    () => withMutationLeaseAuthority(authority, async () => undefined),
    /callback must be synchronous/,
  );
});

test("lease authority brackets its record read with exactly two pending transaction scans", () => {
  const source = readFileSync(
    path.join(__dirname, "lib", "automation-control.mjs"),
    "utf8",
  );
  const start = source.indexOf("function requireMutationLeaseUnlocked(");
  const end = source.indexOf(
    "\nfunction requireMutationAuthorityContext(",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const authorizationSource = source.slice(start, end);
  const firstPendingCheck = authorizationSource.indexOf(
    "requireNoPendingLeaseTransaction(paths, leaseName);",
  );
  const leaseRead = authorizationSource.indexOf(
    "const record = readLeaseRecord(leasePath);",
  );
  const secondPendingCheck = authorizationSource.indexOf(
    "requireNoPendingLeaseTransaction(paths, leaseName);",
    firstPendingCheck + 1,
  );
  assert.ok(firstPendingCheck >= 0);
  assert.ok(firstPendingCheck < leaseRead);
  assert.ok(leaseRead < secondPendingCheck);
  assert.equal(
    authorizationSource.indexOf(
      "requireNoPendingLeaseTransaction(paths, leaseName);",
      secondPendingCheck + 1,
    ),
    -1,
  );
  assert.doesNotMatch(authorizationSource, /checkpoint|callback|await/);

  const stateRoot = temporaryStateRoot();
  const authentication = actorLease(stateRoot, "freed-stability-controller");
  consumeLeaseArchiveHelperInvocationCountForTest();
  consumePendingLeaseTransactionInspectionCountForTest();
  assert.equal(
    withMutationLeaseAuthority({ stateRoot, ...authentication }, () => true),
    true,
  );
  assert.equal(consumePendingLeaseTransactionInspectionCountForTest(), 2);
  const activeHelperCalls = consumeLeaseArchiveHelperInvocationCountForTest();
  assert.ok(activeHelperCalls > 0 && activeHelperCalls <= 4);

  const paths = automationControlPaths(stateRoot);
  const transactionDirectory = path.join(paths.leases, ".transactions");
  const receiptDirectory = path.join(paths.leases, ".transaction-receipts");
  const receiptEntry = readdirSync(receiptDirectory).find(
    (entry) =>
      entry.startsWith(`${authentication.leaseName}.acquire.`) &&
      entry.endsWith(".json"),
  );
  assert.ok(receiptEntry);
  const pendingPath = path.join(
    transactionDirectory,
    `${authentication.leaseName}.json`,
  );
  writeFileSync(
    pendingPath,
    readFileSync(path.join(receiptDirectory, receiptEntry)),
    { mode: 0o600 },
  );
  let callbackCalled = false;
  consumePendingLeaseTransactionInspectionCountForTest();
  assert.throws(
    () =>
      withMutationLeaseAuthority({ stateRoot, ...authentication }, () => {
        callbackCalled = true;
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_pending",
  );
  assert.equal(callbackCalled, false);
  assert.equal(consumePendingLeaseTransactionInspectionCountForTest(), 1);
  rmSync(pendingPath);
});

test("lease authority cache invalidates when a pending transaction appears", () => {
  const stateRoot = temporaryStateRoot();
  const authentication = actorLease(stateRoot, "freed-stability-controller");
  const paths = automationControlPaths(stateRoot);
  const transactionDirectory = path.join(paths.leases, ".transactions");
  const receiptDirectory = path.join(paths.leases, ".transaction-receipts");
  const receiptEntry = readdirSync(receiptDirectory).find(
    (entry) =>
      entry.startsWith(`${authentication.leaseName}.acquire.`) &&
      entry.endsWith(".json"),
  );
  assert.ok(receiptEntry);
  const pendingPath = path.join(
    transactionDirectory,
    `${authentication.leaseName}.json`,
  );

  withMutationLeaseAuthority(
    { stateRoot, ...authentication },
    (authorityContext) => {
      consumePendingLeaseTransactionInspectionCountForTest();
      authorityContext.reauthorize();
      assert.equal(consumePendingLeaseTransactionInspectionCountForTest(), 0);

      writeFileSync(
        pendingPath,
        readFileSync(path.join(receiptDirectory, receiptEntry)),
        { mode: 0o600 },
      );
      assert.throws(
        () => authorityContext.reauthorize(),
        (error) =>
          error instanceof AutomationControlError &&
          error.code === "lease_transaction_pending",
      );
      assert.equal(consumePendingLeaseTransactionInspectionCountForTest(), 1);
    },
  );
  rmSync(pendingPath);
});

test("lease authority cache invalidates a same-inode record rewrite", () => {
  const stateRoot = temporaryStateRoot();
  const authentication = actorLease(stateRoot, "freed-stability-controller");
  const paths = automationControlPaths(stateRoot);
  const recordPath = path.join(
    paths.leases,
    `${authentication.leaseName}.lease`,
    "lease.json",
  );

  withMutationLeaseAuthority(
    { stateRoot, ...authentication },
    (authorityContext) => {
      consumePendingLeaseTransactionInspectionCountForTest();
      const returned = authorityContext.reauthorize();
      assert.equal(consumePendingLeaseTransactionInspectionCountForTest(), 0);
      returned.lease.token = "z".repeat(returned.lease.token.length);
      assert.equal(
        authorityContext.reauthorize().lease.token,
        authentication.leaseToken,
      );
      assert.equal(consumePendingLeaseTransactionInspectionCountForTest(), 0);

      const recordStats = lstatSync(recordPath);
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      record.token = "y".repeat(record.token.length);
      writeFileSync(recordPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      assert.equal(lstatSync(recordPath).ino, recordStats.ino);
      assert.throws(
        () => authorityContext.reauthorize(),
        (error) =>
          error instanceof AutomationControlError &&
          error.code === "lease_token_mismatch",
      );
      assert.equal(consumePendingLeaseTransactionInspectionCountForTest(), 2);
    },
  );
});

test("exported acquisition cannot persist caller-controlled future authority time", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const operationId = nextLeaseOperationId("future-authority-time");
  const token = `future-authority-time-${"x".repeat(32)}`;
  const beforeMs = Date.now();
  const acquired = acquireLeaseLive({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    nowMs: beforeMs + 24 * 60 * 60_000,
    token,
    actorCredentialToken,
  });
  const afterMs = Date.now();
  const acquiredAtMs = Date.parse(acquired.lease.acquiredAt);

  assert.ok(acquiredAtMs >= beforeMs);
  assert.ok(acquiredAtMs <= afterMs);
  assert.ok(acquiredAtMs < beforeMs + 60_000);
  assert.equal(
    withMutationLeaseAuthority(
      {
        stateRoot,
        actor,
        leaseName: policy.leaseName,
        leaseToken: token,
      },
      () => true,
    ),
    true,
  );
});

test("exported heartbeat cannot revive a lease expired on the live clock", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `stale-heartbeat-${"x".repeat(32)}`;
  const acquiredAtMs = Date.now();
  acquireLeaseMutation({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    operationId: nextLeaseOperationId("stale-heartbeat-acquire"),
    ttlMs: 60_000,
    nowMs: acquiredAtMs,
    token,
    actorCredentialToken,
  });
  const expiredAtMs = acquiredAtMs + 60_001;
  assert.equal(
    inspectLease({
      stateRoot,
      name: policy.leaseName,
      nowMs: expiredAtMs,
    }).expired,
    true,
  );

  const heartbeatOperationId = nextLeaseOperationId("stale-heartbeat");
  assert.throws(
    () =>
      withTestDateNow(expiredAtMs, () =>
        heartbeatLeaseLive({
          stateRoot,
          name: policy.leaseName,
          operationId: heartbeatOperationId,
          token,
          ttlMs: policy.maxLeaseLifetimeMs,
          nowMs: acquiredAtMs + 50,
        }),
      ),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
  assert.equal(
    existsSync(
      leaseTransactionPaths(
        stateRoot,
        policy.leaseName,
        "heartbeat",
        heartbeatOperationId,
      ).active,
    ),
    false,
  );
  assert.throws(
    () =>
      withTestDateNow(expiredAtMs, () =>
        withMutationLeaseAuthority(
          {
            stateRoot,
            actor,
            leaseName: policy.leaseName,
            leaseToken: token,
          },
          () => true,
        ),
      ),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
});

test("exported publisher head binding rejects live lease expiry", () => {
  const stateRoot = temporaryStateRoot();
  const expiredAcquiredAtMs = Date.now() - 31 * 60_000;
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(stateRoot),
    branch: "fix/live-bind-expiry",
    base: "dev",
    baseSha: "a".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  const capability = writePublisherCapability(stateRoot, scope, {
    nowMs: expiredAcquiredAtMs,
    leaseOperationId: nextLeaseOperationId("expired-bind-acquire"),
  });
  withTestDateNow(expiredAcquiredAtMs, () =>
    acquireLeaseLive({
      stateRoot,
      name: "pr-publisher",
      owner: "freed-pr-publisher",
      operationId: capability.leaseOperationId,
      ttlMs: 30 * 60_000,
      token: capability.token,
      publisherCapabilityFile: capability.capabilityPath,
      scope,
    }),
  );
  const bindOperationId = nextLeaseOperationId("expired-bind");

  assert.throws(
    () =>
      bindPublisherLeaseHeadLive({
        stateRoot,
        operationId: bindOperationId,
        token: capability.token,
        scope,
        headSha: "b".repeat(40),
        nowMs: expiredAcquiredAtMs + 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
  assert.equal(
    existsSync(
      leaseTransactionPaths(
        stateRoot,
        "pr-publisher",
        "bind-head",
        bindOperationId,
      ).active,
    ),
    false,
  );
});

test("heartbeat rechecks live expiry after waiting for the event guard", async () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `heartbeat-event-wait-${"x".repeat(32)}`;
  acquireLeaseLive({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    operationId: nextLeaseOperationId("heartbeat-event-wait-acquire"),
    ttlMs: 60_000,
    token,
    actorCredentialToken,
  });
  const paths = automationControlPaths(stateRoot);
  const leaseRecordPath = path.join(
    paths.leases,
    `${policy.leaseName}.lease`,
    "lease.json",
  );
  const expiringRecord = JSON.parse(readFileSync(leaseRecordPath, "utf8"));
  expiringRecord.expiresAt = new Date(Date.now() + 1_000).toISOString();
  writeFileSync(leaseRecordPath, `${JSON.stringify(expiringRecord)}\n`, {
    mode: 0o600,
  });
  const guardPath = path.join(
    paths.guards,
    "events.lock",
    AUTOMATION_KERNEL_GUARD_INNER_FILE,
  );
  const readyPath = path.join(stateRoot, "heartbeat-event-wait-ready");
  const moduleUrl = new URL("./lib/automation-control.mjs", import.meta.url)
    .href;
  const holder = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { writeFileSync } from "node:fs"; import { withKernelFileGuard } from ${JSON.stringify(moduleUrl)}; const wait = new Int32Array(new SharedArrayBuffer(4)); withKernelFileGuard(${JSON.stringify(guardPath)}, () => { writeFileSync(${JSON.stringify(readyPath)}, "ready", { mode: 0o600 }); Atomics.wait(wait, 0, 0, 1200); });`,
    ],
    { stdio: "ignore" },
  );
  waitForPathSync(readyPath);
  const operationId = nextLeaseOperationId("heartbeat-event-wait");
  const eventsBefore = readFileSync(paths.events);

  assert.throws(
    () =>
      heartbeatLeaseLive({
        stateRoot,
        name: policy.leaseName,
        operationId,
        token,
        ttlMs: policy.maxLeaseLifetimeMs,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.equal(
    existsSync(
      leaseTransactionPaths(
        stateRoot,
        policy.leaseName,
        "heartbeat",
        operationId,
      ).active,
    ),
    false,
  );
  assert.throws(
    () =>
      withMutationLeaseAuthority(
        {
          stateRoot,
          actor,
          leaseName: policy.leaseName,
          leaseToken: token,
        },
        () => true,
      ),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
  const result = await waitForChild(holder);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
});

test("lease mutation authority rechecks real expiry after waiting for its guard", async () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-runtime-observer";
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const operationId = nextLeaseOperationId("expiry-after-wait");
  const token = `expiry-after-wait-${"x".repeat(32)}`;
  const acquiredAt = Date.now();
  acquireLeaseMutation({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    operationId,
    ttlMs: 1_000,
    nowMs: acquiredAt,
    token,
    actorCredentialToken,
  });
  const paths = automationControlPaths(stateRoot);
  const guardPath = path.join(
    paths.guards,
    `lease-${policy.leaseName}.lock`,
    AUTOMATION_KERNEL_GUARD_INNER_FILE,
  );
  const readyPath = path.join(stateRoot, "expiry-guard-ready");
  const moduleUrl = new URL("./lib/automation-control.mjs", import.meta.url)
    .href;
  const holder = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { writeFileSync } from "node:fs"; import { withKernelFileGuard } from ${JSON.stringify(moduleUrl)}; const wait = new Int32Array(new SharedArrayBuffer(4)); withKernelFileGuard(${JSON.stringify(guardPath)}, () => { writeFileSync(${JSON.stringify(readyPath)}, "ready", { mode: 0o600 }); Atomics.wait(wait, 0, 0, 1200); });`,
    ],
    { stdio: "ignore" },
  );
  waitForPathSync(readyPath);
  const eventsBefore = readFileSync(paths.events);

  assert.throws(
    () =>
      appendControlEvent({
        stateRoot,
        type: "must-not-append-after-expiry",
        actor,
        leaseName: policy.leaseName,
        leaseToken: token,
        nowMs: acquiredAt,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  const result = await waitForChild(holder);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
});

test("control event append rechecks real lease expiry after waiting for the event guard", async () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-runtime-observer";
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const operationId = nextLeaseOperationId("event-expiry-after-wait");
  const token = `event-expiry-after-wait-${"x".repeat(32)}`;
  const acquiredAt = Date.now();
  acquireLeaseMutation({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    operationId,
    ttlMs: 1_000,
    nowMs: acquiredAt,
    token,
    actorCredentialToken,
  });
  const paths = automationControlPaths(stateRoot);
  const guardPath = path.join(
    paths.guards,
    "events.lock",
    AUTOMATION_KERNEL_GUARD_INNER_FILE,
  );
  const readyPath = path.join(stateRoot, "event-expiry-guard-ready");
  const moduleUrl = new URL("./lib/automation-control.mjs", import.meta.url)
    .href;
  const holder = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { writeFileSync } from "node:fs"; import { withKernelFileGuard } from ${JSON.stringify(moduleUrl)}; const wait = new Int32Array(new SharedArrayBuffer(4)); withKernelFileGuard(${JSON.stringify(guardPath)}, () => { writeFileSync(${JSON.stringify(readyPath)}, "ready", { mode: 0o600 }); Atomics.wait(wait, 0, 0, 1200); });`,
    ],
    { stdio: "ignore" },
  );
  waitForPathSync(readyPath);
  const eventsBefore = readFileSync(paths.events);

  assert.throws(
    () =>
      appendControlEvent({
        stateRoot,
        type: "must-not-append-after-event-wait",
        actor,
        leaseName: policy.leaseName,
        leaseToken: token,
        nowMs: acquiredAt,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  const result = await waitForChild(holder);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
});

test("task creation rechecks real lease expiry after waiting for the task guard", async () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-runtime-observer";
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const operationId = nextLeaseOperationId("task-expiry-after-wait");
  const token = `task-expiry-after-wait-${"x".repeat(32)}`;
  const acquiredAt = Date.now();
  acquireLeaseMutation({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    operationId,
    ttlMs: 1_000,
    nowMs: acquiredAt,
    token,
    actorCredentialToken,
  });
  const paths = automationControlPaths(stateRoot);
  const guardPath = path.join(
    paths.guards,
    "tasks.lock",
    AUTOMATION_KERNEL_GUARD_INNER_FILE,
  );
  const readyPath = path.join(stateRoot, "task-expiry-guard-ready");
  const moduleUrl = new URL("./lib/automation-control.mjs", import.meta.url)
    .href;
  const holder = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { writeFileSync } from "node:fs"; import { withKernelFileGuard } from ${JSON.stringify(moduleUrl)}; const wait = new Int32Array(new SharedArrayBuffer(4)); withKernelFileGuard(${JSON.stringify(guardPath)}, () => { writeFileSync(${JSON.stringify(readyPath)}, "ready", { mode: 0o600 }); Atomics.wait(wait, 0, 0, 1200); });`,
    ],
    { stdio: "ignore" },
  );
  waitForPathSync(readyPath);
  const eventsBefore = readFileSync(paths.events);
  const manifestExisted = existsSync(paths.taskManifest);
  const manifestBefore = manifestExisted
    ? readFileSync(paths.taskManifest)
    : null;

  assert.throws(
    () =>
      createTask({
        stateRoot,
        taskId: "must-not-create-after-task-wait",
        actor,
        leaseName: policy.leaseName,
        leaseToken: token,
        observerAuthority: "observe-only",
        providerAuthority: "forbidden",
        details: { behavioral: false },
        nowMs: acquiredAt,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.equal(existsSync(paths.taskManifest), manifestExisted);
  if (manifestBefore) {
    assert.deepEqual(readFileSync(paths.taskManifest), manifestBefore);
  }
  const result = await waitForChild(holder);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
});

test("release and replacement wait until the authorized mutation scope commits", async () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-runtime-observer";
  const authentication = actorLease(stateRoot, actor);
  const authority = { stateRoot, ...authentication };
  const startedPath = path.join(stateRoot, "replacement-started");
  const completedPath = path.join(stateRoot, "replacement-completed");
  const commitPath = path.join(stateRoot, "authority-mutation-committed");
  const replacementToken = `replacement-${"y".repeat(32)}`;
  const releaseOperationId = "91".repeat(32);
  const acquireOperationId = "92".repeat(32);
  const moduleUrl = TRUSTED_ACTOR_CONTROL_MODULE_URL;
  const maxLeaseLifetimeMs =
    AUTOMATION_ACTOR_POLICIES[actor].maxLeaseLifetimeMs;
  let contender;

  withMutationLeaseAuthority(authority, (authorityContext) => {
    authorityContext.authorize(authority);
    contender = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { writeFileSync } from "node:fs"; import { acquireGeneralActorLeaseForTest, releaseLease } from ${JSON.stringify(moduleUrl)}; writeFileSync(${JSON.stringify(startedPath)}, "started", { mode: 0o600 }); releaseLease({ stateRoot: ${JSON.stringify(stateRoot)}, name: ${JSON.stringify(authentication.leaseName)}, operationId: ${JSON.stringify(releaseOperationId)}, token: ${JSON.stringify(authentication.leaseToken)}, nowMs: Date.now() }); acquireGeneralActorLeaseForTest({ stateRoot: ${JSON.stringify(stateRoot)}, name: ${JSON.stringify(authentication.leaseName)}, owner: ${JSON.stringify(actor)}, operationId: ${JSON.stringify(acquireOperationId)}, ttlMs: ${JSON.stringify(maxLeaseLifetimeMs)}, token: ${JSON.stringify(replacementToken)} }); writeFileSync(${JSON.stringify(completedPath)}, "completed", { mode: 0o600 });`,
      ],
      { stdio: "ignore" },
    );
    waitForPathSync(startedPath);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    authorityContext.authorize(authority);
    writeFileSync(commitPath, "committed", { mode: 0o600 });
    assert.equal(existsSync(completedPath), false);
  });

  const result = await waitForChild(contender);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(readFileSync(commitPath, "utf8"), "committed");
  assert.equal(readFileSync(completedPath, "utf8"), "completed");
  assert.equal(
    inspectLease({
      stateRoot,
      name: authentication.leaseName,
      includeToken: true,
    }).token,
    replacementToken,
  );
});

test("task mutations atomically replace one sorted current manifest and append versioned events", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  createTask({
    stateRoot,
    taskId: "P1-05",
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "approval-required",
    details: { behavioral: true, metricId: "novel-items-not-persisted" },
    nowMs: nowMs + 1,
  });
  createTask({
    stateRoot,
    taskId: "P0-01",
    ...controller,
    observerAuthority: "pr-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nowMs + 2,
  });

  const transition = transitionTask({
    stateRoot,
    taskId: "P1-05",
    ...controller,
    toState: "triaged",
    expectedRevision: 1,
    nowMs: nowMs + 3,
  });

  assert.equal(transition.manifestRevision, 3);
  assert.equal(transition.task.revision, 2);
  assert.equal(transition.task.state, "triaged");
  const manifest = readTaskManifest({ stateRoot });
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.revision, 3);
  assert.deepEqual(
    manifest.tasks.map((task) => task.taskId),
    ["P0-01", "P1-05"],
  );
  assert.equal(manifest.tasks[1].observerAuthority, "plan-only");
  assert.equal(manifest.tasks[1].providerAuthority, "approval-required");

  const files = readdirSync(
    path.dirname(automationControlPaths(stateRoot).taskManifest),
  );
  const readyAuthorityWitnesses = files.filter((name) => name.endsWith(".tmp"));
  assert.equal(readyAuthorityWitnesses.length, 2, JSON.stringify(files));
  assert.ok(
    readyAuthorityWitnesses.every((name) =>
      /^\.(?:current-tasks\.json|events\.jsonl)\.authority\.[0-9a-f]{64}\.[0-9a-f]{64}\.tmp$/.test(
        name,
      ),
    ),
    JSON.stringify(files),
  );
  const events = readEvents(stateRoot);
  assert.deepEqual(
    events.map((event) => event.type),
    ["lease_acquired", "task_created", "task_created", "task_transitioned"],
  );
  assert.ok(
    events.every(
      (event) => event.schemaVersion === 1 && event.eventId && event.ts,
    ),
  );
});

test("a pending task transaction recovers once and rejects stale resurrection", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  const created = createTask({
    stateRoot,
    taskId: "recoverable-task",
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nowMs + 1,
  });

  const paths = automationControlPaths(stateRoot);
  const current = readTaskManifest({ stateRoot });
  const targetManifest = structuredClone(current);
  const targetTask = targetManifest.tasks[0];
  const transitionAt = new Date(nowMs + 2).toISOString();
  targetTask.state = "triaged";
  targetTask.revision = 2;
  targetTask.updatedAt = transitionAt;
  targetManifest.revision = current.revision + 1;
  targetManifest.updatedAt = transitionAt;
  const event = {
    schemaVersion: 1,
    eventId: "d9b3b385-5434-4ca5-8cff-0c10e3aa0b18",
    type: "task_transitioned",
    ts: transitionAt,
    actor: "freed-stability-controller",
    taskId: targetTask.taskId,
    taskRevision: targetTask.revision,
    manifestRevision: targetManifest.revision,
    observerAuthority: targetTask.observerAuthority,
    providerAuthority: targetTask.providerAuthority,
    data: {
      fromState: "observed",
      toState: "triaged",
      authorizationProvenance: structuredClone(
        created.event.data.authorizationProvenance,
      ),
    },
  };
  const transaction = {
    schemaVersion: 1,
    transactionId: "0f2496f9-6a8f-41ab-a01a-990e2bf53a9c",
    preparedAt: transitionAt,
    previousManifestRevision: current.revision,
    targetManifest,
    event,
  };
  mkdirSync(paths.taskTransactions, { recursive: true });
  const transactionPath = path.join(
    paths.taskTransactions,
    `${String(targetManifest.revision).padStart(12, "0")}-${transaction.transactionId}.json`,
  );
  writeFileSync(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`, {
    mode: 0o600,
  });
  const predecessor = readAutomationAuthorityFileSnapshot(paths.taskManifest, {
    privateRoot: paths.controlRoot,
    label: "Current task manifest",
  });
  const proposedBytes = Buffer.from(
    `${JSON.stringify(targetManifest, null, 2)}\n`,
  );
  const stagePath = path.join(
    paths.controlRoot,
    authorityStageNameForTest({
      filePath: paths.taskManifest,
      proposedBytes,
      operationId: `task-manifest:${transaction.transactionId}`,
      previousSnapshot: predecessor,
    }),
  );
  writeFileSync(stagePath, proposedBytes, { mode: 0o600, flag: "wx" });

  const recovered = readTaskManifest({ stateRoot });
  assert.equal(recovered.revision, 2);
  assert.equal(recovered.tasks[0].state, "triaged");
  assert.equal(
    readEvents(stateRoot).filter((item) => item.eventId === event.eventId)
      .length,
    1,
  );
  assert.equal(existsSync(transactionPath), false);

  writeFileSync(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`, {
    mode: 0o600,
  });
  const manifestBeforeResurrection = readFileSync(paths.taskManifest);
  const eventsBeforeResurrection = readFileSync(paths.events);
  assert.throws(
    () => readTaskManifest({ stateRoot }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "authority_generation_conflict" &&
      /no unique exact task transaction lineage/i.test(error.details?.cause),
  );
  assert.deepEqual(readFileSync(paths.taskManifest), manifestBeforeResurrection);
  assert.deepEqual(readFileSync(paths.events), eventsBeforeResurrection);
  assert.equal(
    readEvents(stateRoot).filter((item) => item.eventId === event.eventId)
      .length,
    1,
  );
  assert.equal(existsSync(transactionPath), true);
});

test("task transaction recovery rejects conflicting and duplicate audit events before mutation", async (t) => {
  const prepareFixture = (variant) => {
    const stateRoot = temporaryStateRoot();
    const nowMs = Date.now();
    const controller = actorLease(stateRoot, "freed-stability-controller", {
      nowMs,
    });
    const taskId = `recoverable-task-${variant}`;
    const created = createTask({
      stateRoot,
      taskId,
      ...controller,
      observerAuthority: "plan-only",
      providerAuthority: "forbidden",
      details: { behavioral: false },
      nowMs: nowMs + 1,
    });
    const paths = automationControlPaths(stateRoot);
    const current = readTaskManifest({ stateRoot });
    const targetManifest = structuredClone(current);
    const targetTask = targetManifest.tasks[0];
    const transitionAt = new Date(nowMs + 2).toISOString();
    targetTask.state = "triaged";
    targetTask.revision += 1;
    targetTask.updatedAt = transitionAt;
    targetManifest.revision += 1;
    targetManifest.updatedAt = transitionAt;
    const event = {
      schemaVersion: 1,
      eventId:
        variant === "conflicting"
          ? "96b79b91-2967-4269-af40-69b8f520fa87"
          : "62c65941-aa40-4232-84b5-4125a0ab098d",
      type: "task_transitioned",
      ts: transitionAt,
      actor: "freed-stability-controller",
      taskId,
      taskRevision: targetTask.revision,
      manifestRevision: targetManifest.revision,
      observerAuthority: targetTask.observerAuthority,
      providerAuthority: targetTask.providerAuthority,
      data: {
        fromState: "observed",
        toState: "triaged",
        authorizationProvenance: structuredClone(
          created.event.data.authorizationProvenance,
        ),
      },
    };
    const transaction = {
      schemaVersion: 1,
      transactionId: `recoverable-transaction-${variant}`,
      preparedAt: transitionAt,
      previousManifestRevision: current.revision,
      targetManifest,
      event,
    };
    mkdirSync(paths.taskTransactions, { recursive: true });
    const transactionPath = path.join(
      paths.taskTransactions,
      `${String(targetManifest.revision).padStart(12, "0")}-${transaction.transactionId}.json`,
    );
    writeFileSync(
      transactionPath,
      `${JSON.stringify(transaction, null, 2)}\n`,
      { mode: 0o600 },
    );
    return { stateRoot, paths, event, transactionPath };
  };

  for (const variant of ["conflicting", "duplicate"]) {
    await t.test(variant, () => {
      const fixture = prepareFixture(variant);
      retireReadyAuthorityWitnessForLegacyFixture(fixture.paths.events);
      const conflictingEvent = {
        ...fixture.event,
        data: { ...fixture.event.data, toState: "approved_for_pr" },
      };
      const injectedEvents =
        variant === "duplicate"
          ? [fixture.event, fixture.event]
          : [conflictingEvent];
      appendFileSync(
        fixture.paths.events,
        `${injectedEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
      );
      const manifestBefore = readFileSync(fixture.paths.taskManifest);
      const eventsBefore = readFileSync(fixture.paths.events);
      const transactionBefore = readFileSync(fixture.transactionPath);

      assert.throws(
        () => readTaskManifest({ stateRoot: fixture.stateRoot }),
        (error) =>
          error instanceof AutomationControlError &&
          error.code ===
            (variant === "duplicate"
              ? "control_event_duplicate"
              : "control_event_conflict"),
      );
      assert.deepEqual(
        readFileSync(fixture.paths.taskManifest),
        manifestBefore,
      );
      assert.deepEqual(readFileSync(fixture.paths.events), eventsBefore);
      assert.equal(existsSync(fixture.transactionPath), true);
      assert.deepEqual(
        readFileSync(fixture.transactionPath),
        transactionBefore,
      );
    });
  }
});

test("task recovery admits manifest and transaction authority files safely", async (t) => {
  const controlModuleUrl = new URL(
    "./lib/automation-control.mjs",
    import.meta.url,
  ).href;
  const assertReadFailsClosed = (stateRoot, expectedCode) => {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
          import { readTaskManifest } from ${JSON.stringify(controlModuleUrl)};
          try {
            readTaskManifest({ stateRoot: ${JSON.stringify(stateRoot)} });
            process.exit(2);
          } catch (error) {
            if (error?.code !== ${JSON.stringify(expectedCode)}) {
              console.error(error?.stack ?? error);
              process.exit(3);
            }
          }
        `,
      ],
      { encoding: "utf8", timeout: 2_000 },
    );
    assert.notEqual(child.error?.code, "ETIMEDOUT");
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr);
  };
  const makeHostile = (filePath, shape, stateRoot) => {
    let externalPath = null;
    if (shape === "mode") {
      chmodSync(filePath, 0o640);
    } else if (shape === "symlink") {
      externalPath = path.join(
        stateRoot,
        `${path.basename(filePath)}-symlink-target`,
      );
      renameSync(filePath, externalPath);
      symlinkSync(externalPath, filePath);
    } else if (shape === "hardlink") {
      externalPath = path.join(
        stateRoot,
        `${path.basename(filePath)}-hardlink-alias`,
      );
      linkSync(filePath, externalPath);
    } else if (shape === "oversize") {
      truncateSync(filePath, CONTROL_EVENT_HISTORY_MAX_BYTES + 1);
    } else if (shape === "invalid-utf8") {
      writeFileSync(filePath, Buffer.from([0xff]), { mode: 0o600 });
    } else {
      rmSync(filePath);
      execFileSync("mkfifo", [filePath]);
      chmodSync(filePath, 0o600);
    }
    return externalPath;
  };

  for (const kind of ["manifest", "transaction"]) {
    for (const shape of [
      "mode",
      "symlink",
      "hardlink",
      "oversize",
      "invalid-utf8",
      "fifo",
    ]) {
      await t.test(`${kind}-${shape}`, () => {
        const stateRoot = temporaryStateRoot();
        const controller = actorLease(stateRoot, "freed-stability-controller");
        createTask({
          stateRoot,
          taskId: `authority-read-${kind}-${shape}`,
          ...controller,
          observerAuthority: "plan-only",
          providerAuthority: "forbidden",
          details: { behavioral: false },
        });
        const paths = automationControlPaths(stateRoot);
        let authorityPath = paths.taskManifest;
        if (kind === "transaction") {
          mkdirSync(paths.taskTransactions, { recursive: true, mode: 0o700 });
          authorityPath = path.join(
            paths.taskTransactions,
            `hostile-${shape}.json`,
          );
          writeFileSync(authorityPath, "{}\n", { mode: 0o600 });
        }
        const manifestBefore = readFileSync(paths.taskManifest);
        const eventsBefore = readFileSync(paths.events);
        const externalPath = makeHostile(authorityPath, shape, stateRoot);

        assertReadFailsClosed(
          stateRoot,
          kind === "manifest" ? "authority_generation_conflict" : "invalid_state",
        );
        assert.deepEqual(readFileSync(paths.events), eventsBefore);
        if (kind === "transaction") {
          assert.deepEqual(readFileSync(paths.taskManifest), manifestBefore);
        }
        if (shape === "symlink") {
          assert.equal(lstatSync(authorityPath).isSymbolicLink(), true);
          assert.equal(existsSync(externalPath), true);
        } else if (shape === "hardlink") {
          assert.equal(lstatSync(authorityPath).nlink, 2);
          assert.equal(existsSync(externalPath), true);
        } else if (shape === "fifo") {
          assert.equal(lstatSync(authorityPath).isFIFO(), true);
        }
      });
    }
  }
});

test("task creation and same-state transition retries are idempotent", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const observer = actorLease(stateRoot, "freed-runtime-observer", { nowMs });
  const input = {
    stateRoot,
    taskId: "W1-01",
    ...observer,
    observerAuthority: "observe-only",
    providerAuthority: "forbidden",
    details: { behavioral: false, evidence: "digest-1" },
    nowMs,
  };
  const created = createTask(input);
  const retried = createTask(input);
  const transition = transitionTask({
    stateRoot,
    taskId: "W1-01",
    ...observer,
    toState: "observed",
    expectedRevision: 1,
  });

  assert.equal(created.changed, true);
  assert.equal(retried.changed, false);
  assert.equal(transition.changed, false);
  assert.equal(readTaskManifest({ stateRoot }).revision, 1);
  assert.equal(readEvents(stateRoot).length, 2);

  const controller = actorLease(stateRoot, "freed-stability-controller");
  createTask({
    stateRoot,
    taskId: "same-state-triaged",
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });
  transitionTask({
    stateRoot,
    taskId: "same-state-triaged",
    ...controller,
    toState: "triaged",
  });
  const paths = automationControlPaths(stateRoot);
  const manifestBeforeRetry = readFileSync(paths.taskManifest);
  const eventsBeforeRetry = readFileSync(paths.events);
  const noOpRetry = transitionTask({
    stateRoot,
    taskId: "same-state-triaged",
    ...controller,
    toState: "triaged",
  });
  assert.equal(noOpRetry.changed, false);
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "same-state-triaged",
        ...controller,
        toState: "triaged",
        details: { behavioral: false, evidence: "new-evidence" },
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "invalid_transition",
  );
  assert.deepEqual(readFileSync(paths.taskManifest), manifestBeforeRetry);
  assert.deepEqual(readFileSync(paths.events), eventsBeforeRetry);
});

test("task transitions reject skipped states and stale revisions", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const runner = actorLease(stateRoot, "freed-nightly-runner");
  createTask({
    stateRoot,
    taskId: "P0-02",
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });

  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "P0-02",
        ...runner,
        toState: "implemented",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "invalid_transition",
  );
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "P0-02",
        ...controller,
        toState: "triaged",
        expectedRevision: 2,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "revision_conflict",
  );
  assert.equal(readTask({ stateRoot, taskId: "P0-02" }).state, "observed");
});

test("stored task authority is a lifecycle ceiling", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const scaffolding = actorLease(stateRoot, "freed-scaffolding-maintainer");
  const runner = actorLease(stateRoot, "freed-nightly-runner");

  createTask({
    stateRoot,
    taskId: "observe-ceiling",
    ...controller,
    observerAuthority: "observe-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "observe-ceiling",
        ...controller,
        toState: "triaged",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "task_authority_insufficient",
  );

  createTask({
    stateRoot,
    taskId: "plan-ceiling",
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });
  transitionTask({
    stateRoot,
    taskId: "plan-ceiling",
    ...controller,
    toState: "triaged",
  });
  transitionTask({
    stateRoot,
    taskId: "plan-ceiling",
    ...controller,
    toState: "approved_for_pr",
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "plan-ceiling",
        ...scaffolding,
        toState: "implemented",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "task_authority_insufficient",
  );

  createTask({
    stateRoot,
    taskId: "pr-ceiling",
    ...controller,
    observerAuthority: "pr-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });
  transitionTask({
    stateRoot,
    taskId: "pr-ceiling",
    ...controller,
    toState: "triaged",
  });
  transitionTask({
    stateRoot,
    taskId: "pr-ceiling",
    ...controller,
    toState: "approved_for_pr",
  });
  transitionTask({
    stateRoot,
    taskId: "pr-ceiling",
    ...scaffolding,
    toState: "implemented",
  });
  transitionTask({
    stateRoot,
    taskId: "pr-ceiling",
    ...scaffolding,
    toState: "validated",
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "pr-ceiling",
        ...runner,
        toState: "merged",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "task_authority_insufficient",
  );
});

test("task mutations require policy-bound leases and new tasks start observed", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");

  assert.throws(
    () =>
      createTask({
        stateRoot,
        taskId: "unsafe-terminal-create",
        ...controller,
        state: "merged",
        observerAuthority: "merge-safe",
        providerAuthority: "forbidden",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "invalid_initial_state",
  );
  assert.throws(
    () =>
      createTask({
        stateRoot,
        taskId: "missing-lease",
        actor: "freed-stability-controller",
        observerAuthority: "plan-only",
        providerAuthority: "forbidden",
        details: { behavioral: false },
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "invalid_identifier",
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "invented-writer",
        owner: "invented-actor",
        ttlMs: 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_not_authorized",
  );
});

test("current mutation admission rejects a not-yet-active lease without mutation", () => {
  const stateRoot = temporaryStateRoot();
  const acquiredAtMs = Date.now() + 60_000;
  const actor = "freed-stability-controller";
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const leaseToken = `future-lease-${"x".repeat(32)}`;
  acquireLeaseMutation({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    operationId: nextLeaseOperationId("future-current-admission"),
    ttlMs: 10 * 60_000,
    nowMs: acquiredAtMs,
    token: leaseToken,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const before = snapshotLeaseAuthorityState(stateRoot);

  assert.throws(
    () =>
      appendControlEvent({
        stateRoot,
        type: "future-lease-must-not-authorize",
        actor,
        leaseName: policy.leaseName,
        leaseToken,
        nowMs: acquiredAtMs,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_not_active",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), before);
});

test("stored lease timestamps must use the canonical ISO representation", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  const leaseRecordPath = path.join(
    automationControlPaths(stateRoot).leases,
    `${controller.leaseName}.lease`,
    "lease.json",
  );
  const canonicalBytes = readFileSync(leaseRecordPath);

  for (const field of ["acquiredAt", "heartbeatAt", "expiresAt"]) {
    const record = JSON.parse(canonicalBytes.toString("utf8"));
    record[field] = record[field].replace(/Z$/, "+00:00");
    writeFileSync(leaseRecordPath, `${JSON.stringify(record)}\n`, {
      mode: 0o600,
    });
    const before = snapshotLeaseAuthorityState(stateRoot);
    assert.throws(
      () =>
        appendControlEvent({
          stateRoot,
          type: `noncanonical-${field.toLowerCase()}`,
          ...controller,
          nowMs: nowMs + 1,
        }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "invalid_state",
      field,
    );
    assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), before, field);
    writeFileSync(leaseRecordPath, canonicalBytes, { mode: 0o600 });
  }
});

test("task lifecycle events stay inside their exact lease authority window", () => {
  const stateRoot = temporaryStateRoot();
  const baseMs = Date.now();
  const taskId = "lease-event-time-window";
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs: baseMs,
  });
  const controllerWindow = testLeaseAuthorityWindow(
    stateRoot,
    controller.leaseName,
  );
  const controllerBoundaries = [
    {
      label: "before acquisition",
      nowMs: controllerWindow.acquiredAtMs - 1,
    },
    { label: "at expiry", nowMs: controllerWindow.expiresAtMs },
  ];

  for (const boundary of controllerBoundaries) {
    assertLeaseEventTimeRejected(
      stateRoot,
      () =>
        createTask({
          stateRoot,
          taskId,
          ...controller,
          observerAuthority: "merge-safe",
          providerAuthority: "forbidden",
          details: { behavioral: false },
          nowMs: boundary.nowMs,
        }),
      `create ${boundary.label}`,
    );
  }

  createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: controllerWindow.acquiredAtMs,
  });

  for (const boundary of controllerBoundaries) {
    assertLeaseEventTimeRejected(
      stateRoot,
      () =>
        transitionTask({
          stateRoot,
          taskId,
          ...controller,
          toState: "triaged",
          nowMs: boundary.nowMs,
        }),
      `transition ${boundary.label}`,
    );
  }

  const authorityUpdate = {
    observerAuthority: "plan-only",
    reason: "verify the exact lease event clock boundary",
    expectedRevision: 1,
  };
  const owner = actorLease(stateRoot, "freed-owner", {
    nowMs: baseMs,
    ownerTaskId: taskId,
    ownerIntentDigest: ownerIntent("task.authorize", taskId, {
      observerAuthority: authorityUpdate.observerAuthority,
      providerAuthority: null,
      reason: authorityUpdate.reason,
      approvalReference: null,
      expectedRevision: authorityUpdate.expectedRevision,
    }),
  });
  const ownerWindow = testLeaseAuthorityWindow(stateRoot, owner.leaseName);
  const ownerBoundaries = [
    { label: "before acquisition", nowMs: ownerWindow.acquiredAtMs - 1 },
    { label: "at expiry", nowMs: ownerWindow.expiresAtMs },
  ];

  for (const boundary of ownerBoundaries) {
    assertLeaseEventTimeRejected(
      stateRoot,
      () =>
        updateTaskAuthorities({
          stateRoot,
          taskId,
          ...owner,
          ...authorityUpdate,
          nowMs: boundary.nowMs,
        }),
      `authority update ${boundary.label}`,
    );
  }
});

test("direct control, outcome, and repair audit paths reject lease clock boundaries byte-stably", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const taskId = "direct-event-time-window";
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs,
  });
  const controllerWindow = testLeaseAuthorityWindow(
    stateRoot,
    controller.leaseName,
  );
  const controllerBoundaries = [
    {
      label: "before acquisition",
      nowMs: controllerWindow.acquiredAtMs - 1,
    },
    { label: "at expiry", nowMs: controllerWindow.expiresAtMs },
  ];
  for (const boundary of controllerBoundaries) {
    assertLeaseEventTimeRejected(
      stateRoot,
      () =>
        appendControlEvent({
          stateRoot,
          type: `direct-control-${boundary.label.replaceAll(" ", "-")}`,
          ...controller,
          taskId,
          nowMs: boundary.nowMs,
        }),
      `direct control ${boundary.label}`,
    );
    assertLeaseEventTimeRejected(
      stateRoot,
      () =>
        appendOutcomeControlEvent({
          stateRoot,
          taskId,
          ...controller,
          eventId: `direct-outcome-${boundary.label.replaceAll(" ", "-")}`,
          data: { id: taskId },
          nowMs: boundary.nowMs,
        }),
      `direct outcome ${boundary.label}`,
    );
  }

  const repairRoot = temporaryStateRoot();
  const repairTaskId = "direct-repair-event-time-window";
  const repairTaskNowMs = Date.now();
  createOutcomeLedgerRepairTask(repairRoot, repairTaskId, repairTaskNowMs);
  const parameters = outcomeLedgerRepairParameters(repairRoot, repairTaskId);
  const owner = actorLease(repairRoot, "freed-owner", {
    nowMs: Date.now(),
    ownerTaskId: repairTaskId,
    ownerIntentDigest: ownerIntent(
      "outcome-ledger.repair",
      repairTaskId,
      parameters,
    ),
  });
  const ownerWindow = testLeaseAuthorityWindow(repairRoot, owner.leaseName);
  for (const boundary of [
    { label: "before acquisition", nowMs: ownerWindow.acquiredAtMs - 1 },
    { label: "at expiry", nowMs: ownerWindow.expiresAtMs },
  ]) {
    assertLeaseEventTimeRejected(
      repairRoot,
      () =>
        preflightOutcomeLedgerRepairEvent({
          stateRoot: repairRoot,
          taskId: repairTaskId,
          ...owner,
          parameters,
          nowMs: boundary.nowMs,
        }),
      `repair audit ${boundary.label}`,
    );
  }
});

test("actor policies enforce lifecycle ownership and fresh-evidence reopening", () => {
  const stateRoot = temporaryStateRoot();
  const baseMs = Date.now();
  const observer = actorLease(stateRoot, "freed-runtime-observer", {
    nowMs: baseMs,
  });
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs: baseMs,
  });
  const scaffolding = actorLease(stateRoot, "freed-scaffolding-maintainer", {
    nowMs: baseMs,
  });
  const runner = actorLease(stateRoot, "freed-nightly-runner", {
    nowMs: baseMs,
  });
  const verifier = actorLease(stateRoot, "freed-release-verifier", {
    nowMs: baseMs,
  });

  createTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: baseMs,
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-lifecycle",
        ...observer,
        toState: "triaged",
        nowMs: baseMs + 60_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_not_authorized",
  );
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...controller,
    toState: "triaged",
    nowMs: baseMs + 60_000,
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...controller,
    toState: "approved_for_pr",
    nowMs: baseMs + 2 * 60_000,
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...scaffolding,
    toState: "implemented",
    nowMs: baseMs + 3 * 60_000,
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...scaffolding,
    toState: "validated",
    nowMs: baseMs + 4 * 60_000,
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-lifecycle",
        ...scaffolding,
        toState: "merged",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_not_authorized",
  );
  completeGuardedOutcome({
    stateRoot,
    taskId: "policy-lifecycle",
    authentication: runner,
    outcome: "merged",
    nowMs: baseMs + 5 * 60_000,
  });
  completeGuardedOutcome({
    stateRoot,
    taskId: "policy-lifecycle",
    authentication: runner,
    outcome: "installed",
    details: {
      behavioral: false,
      installedIdentity: {
        version: "26.7.100-dev",
        commitSha: "1".repeat(40),
        channel: "dev",
      },
    },
    nowMs: baseMs + 6 * 60_000,
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...runner,
    toState: "soaking",
    nowMs: baseMs + 7 * 60_000,
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-lifecycle",
        ...runner,
        toState: "verified_effective",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_not_authorized",
  );
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-lifecycle",
        ...verifier,
        toState: "verified_effective",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "outcome_record_required",
  );
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-lifecycle",
        ...verifier,
        toState: "verified_effective",
        details: {
          behavioral: false,
          latestOutcome: {
            outcome: "verified_effective",
            outcomeDigest: "a".repeat(64),
          },
        },
        nowMs: baseMs + 8 * 60_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "outcome_record_required",
  );
  assert.equal(
    readTask({ stateRoot, taskId: "policy-lifecycle" }).pendingOutcome,
    undefined,
  );

  createTask({
    stateRoot,
    taskId: "policy-reopen",
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: baseMs + 8.5 * 60_000,
  });
  completeGuardedOutcome({
    stateRoot,
    taskId: "policy-reopen",
    authentication: controller,
    outcome: "governance_blocked",
    nowMs: baseMs + 8 * 60_000 + 40_000,
  });
  transitionTask({
    stateRoot,
    taskId: "policy-reopen",
    ...controller,
    toState: "closed",
    nowMs: baseMs + 9 * 60_000,
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-reopen",
        ...controller,
        toState: "triaged",
        details: {
          evidenceWindowEnd: new Date(
            baseMs + 9 * 60_000 - 1_000,
          ).toISOString(),
        },
        nowMs: baseMs + 10 * 60_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "stale_reopen_evidence",
  );
  const reopenController = withTestDateNow(baseMs + 60 * 60_000, () =>
    actorLease(stateRoot, "freed-stability-controller", {
      nowMs: baseMs + 60 * 60_000,
    }),
  );
  const reopened = transitionTask({
    stateRoot,
    taskId: "policy-reopen",
    ...reopenController,
    toState: "triaged",
    details: {
      evidenceWindowEnd: new Date(baseMs + 60 * 60_000).toISOString(),
    },
    nowMs: baseMs + 61 * 60_000,
  });
  assert.equal(reopened.task.state, "triaged");
});

test("outcome recording guards reserve nonverification transitions until durable", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  const runner = actorLease(stateRoot, "freed-nightly-runner", { nowMs });
  const taskId = "guarded-merged-outcome";
  createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nowMs + 1,
  });
  transitionTask({
    stateRoot,
    taskId,
    ...controller,
    toState: "triaged",
    nowMs: nowMs + 2,
  });
  transitionTask({
    stateRoot,
    taskId,
    ...controller,
    toState: "approved_for_pr",
    nowMs: nowMs + 3,
  });
  transitionTask({
    stateRoot,
    taskId,
    ...runner,
    toState: "implemented",
    nowMs: nowMs + 4,
  });
  transitionTask({
    stateRoot,
    taskId,
    ...runner,
    toState: "validated",
    nowMs: nowMs + 5,
  });
  const outcomeDigest = "b".repeat(64);
  const merged = withTestOutcomeRecordingGuards(
    {
      stateRoot,
      taskId,
      authentication: runner,
      nowMs: nowMs + 6,
    },
    (control) =>
      control.transitionTask({
        stateRoot,
        taskId,
        ...runner,
        toState: "merged",
        details: {
          behavioral: false,
          latestOutcome: {
            outcome: "merged",
            outcomeDigest,
          },
        },
        nowMs: nowMs + 6,
      }),
  );

  assert.deepEqual(merged.task.pendingOutcome, {
    outcome: "merged",
    outcomeDigest,
    taskRevision: merged.task.revision,
  });
  assert.equal(merged.event.data.outcomeRequired, true);
  assert.equal(merged.event.data.outcomeDigest, outcomeDigest);
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId,
        ...runner,
        toState: "installed",
        nowMs: nowMs + 7,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "outcome_pending",
  );
  assert.deepEqual(readTask({ stateRoot, taskId }).pendingOutcome, {
    outcome: "merged",
    outcomeDigest,
    taskRevision: merged.task.revision,
  });
});

test("every outcome state rejects direct transition before mutation", () => {
  const cases = [
    { outcome: "merged", preparation: "validated", actor: "runner" },
    { outcome: "installed", preparation: "merged", actor: "runner" },
    {
      outcome: "verified_effective",
      preparation: "soaking",
      actor: "verifier",
    },
    {
      outcome: "verified_neutral",
      preparation: "soaking",
      actor: "verifier",
    },
    { outcome: "regressed", preparation: "soaking", actor: "verifier" },
    { outcome: "inconclusive", preparation: "soaking", actor: "verifier" },
    {
      outcome: "governance_blocked",
      preparation: "observed",
      actor: "controller",
    },
    {
      outcome: "superseded",
      preparation: "observed",
      actor: "controller",
    },
    {
      outcome: "implementation_failed",
      preparation: "implemented",
      actor: "scaffolding",
    },
  ];

  for (const { outcome, preparation, actor } of cases) {
    const stateRoot = temporaryStateRoot();
    const nowMs = Date.now();
    const taskId = `direct-${outcome}`;
    const controller = actorLease(stateRoot, "freed-stability-controller", {
      nowMs,
    });
    const scaffolding = actorLease(stateRoot, "freed-scaffolding-maintainer", {
      nowMs,
    });
    const runner = actorLease(stateRoot, "freed-nightly-runner", { nowMs });
    const verifier = actorLease(stateRoot, "freed-release-verifier", {
      nowMs,
    });
    const authentications = { controller, scaffolding, runner, verifier };
    let tick = 1;
    const nextNow = () => nowMs + tick++;

    createTask({
      stateRoot,
      taskId,
      ...controller,
      observerAuthority: "merge-safe",
      providerAuthority: "forbidden",
      details: { behavioral: false },
      nowMs: nextNow(),
    });
    if (
      ["validated", "merged", "soaking", "implemented"].includes(preparation)
    ) {
      transitionTask({
        stateRoot,
        taskId,
        ...controller,
        toState: "triaged",
        nowMs: nextNow(),
      });
      transitionTask({
        stateRoot,
        taskId,
        ...controller,
        toState: "approved_for_pr",
        nowMs: nextNow(),
      });
      transitionTask({
        stateRoot,
        taskId,
        ...scaffolding,
        toState: "implemented",
        nowMs: nextNow(),
      });
    }
    if (["validated", "merged", "soaking"].includes(preparation)) {
      transitionTask({
        stateRoot,
        taskId,
        ...scaffolding,
        toState: "validated",
        nowMs: nextNow(),
      });
    }
    if (["merged", "soaking"].includes(preparation)) {
      completeGuardedOutcome({
        stateRoot,
        taskId,
        authentication: runner,
        outcome: "merged",
        nowMs: nextNow(),
      });
    }
    if (preparation === "soaking") {
      completeGuardedOutcome({
        stateRoot,
        taskId,
        authentication: runner,
        outcome: "installed",
        details: {
          installedIdentity: {
            version: "26.7.100-dev",
            commitSha: "7".repeat(40),
            channel: "dev",
          },
        },
        nowMs: nextNow(),
      });
      transitionTask({
        stateRoot,
        taskId,
        ...runner,
        toState: "soaking",
        nowMs: nextNow(),
      });
    }

    const paths = automationControlPaths(stateRoot);
    const snapshot = {
      manifest: readFileSync(paths.taskManifest),
      events: readFileSync(paths.events),
      outcomes: existsSync(paths.outcomes)
        ? readFileSync(paths.outcomes)
        : undefined,
      taskTransactions: existsSync(paths.taskTransactions)
        ? readdirSync(paths.taskTransactions).sort()
        : [],
    };
    assert.throws(
      () =>
        transitionTask({
          stateRoot,
          taskId,
          ...authentications[actor],
          toState: outcome,
          ...(outcome === "installed"
            ? {
                details: {
                  installedIdentity: {
                    version: "26.7.101-dev",
                    commitSha: "8".repeat(40),
                    channel: "dev",
                  },
                },
              }
            : {}),
          nowMs: nextNow(),
        }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "outcome_record_required",
      outcome,
    );
    assert.deepEqual(
      readFileSync(paths.taskManifest),
      snapshot.manifest,
      outcome,
    );
    assert.deepEqual(readFileSync(paths.events), snapshot.events, outcome);
    assert.deepEqual(
      existsSync(paths.outcomes) ? readFileSync(paths.outcomes) : undefined,
      snapshot.outcomes,
      outcome,
    );
    assert.deepEqual(
      existsSync(paths.taskTransactions)
        ? readdirSync(paths.taskTransactions).sort()
        : [],
      snapshot.taskTransactions,
      outcome,
    );
  }
});

test("installed legacy backfill requires the exact canonical installed identity", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const taskId = "installed-backfill-identity";
  const installedIdentity = {
    version: "26.7.100-dev",
    commitSha: "8".repeat(40),
    channel: "dev",
    artifactDigest: "9".repeat(64),
  };
  const fixture = prepareLegacyOutcomeBackfillFixture({
    stateRoot,
    taskId,
    outcome: "installed",
    installedIdentity,
    nowMs,
  });
  const observer = actorLease(stateRoot, "freed-runtime-observer", {
    nowMs: nowMs + 50,
  });
  createTask({
    stateRoot,
    taskId: "backfill-other-task",
    ...observer,
    observerAuthority: "observe-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nowMs + 51,
  });
  const before = {
    manifest: readFileSync(fixture.paths.taskManifest),
    events: readFileSync(fixture.paths.events),
    outcomes: readFileSync(fixture.paths.outcomes),
    taskTransactions: existsSync(fixture.paths.taskTransactions)
      ? readdirSync(fixture.paths.taskTransactions).sort()
      : [],
  };
  const outcomeDigest = "a".repeat(64);
  const mismatches = [
    {
      installedIdentity: {
        version: installedIdentity.version,
        commitSha: installedIdentity.commitSha,
        channel: installedIdentity.channel,
      },
    },
    {
      buildIdentity: {
        ...installedIdentity,
        artifactDigest: "b".repeat(64),
      },
    },
  ];

  for (const suppliedIdentity of mismatches) {
    assert.throws(
      () =>
        withTestOutcomeRecordingGuards(
          {
            stateRoot,
            taskId,
            authentication: fixture.authentication,
            nowMs: nowMs + 100,
          },
          (control) =>
            control.reserveCurrentTaskOutcome({
              stateRoot,
              taskId,
              ...fixture.authentication,
              outcome: "installed",
              legacyTransitionEventId: fixture.legacyTransitionEventId,
              expectedRevision: fixture.task.revision,
              details: {
                latestOutcome: {
                  outcome: "installed",
                  outcomeDigest,
                  ...suppliedIdentity,
                },
              },
              nowMs: nowMs + 100,
            }),
        ),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "outcome_reservation_mismatch",
    );
    assert.deepEqual(readFileSync(fixture.paths.taskManifest), before.manifest);
    assert.deepEqual(readFileSync(fixture.paths.events), before.events);
    assert.deepEqual(readFileSync(fixture.paths.outcomes), before.outcomes);
    assert.deepEqual(
      existsSync(fixture.paths.taskTransactions)
        ? readdirSync(fixture.paths.taskTransactions).sort()
        : [],
      before.taskTransactions,
    );
  }
});

test("outcome reservation and finalization events stay inside the lease window", () => {
  const baseMs = Date.now();
  const stateRoot = temporaryStateRoot();
  const taskId = "lease-event-time-outcome";
  const fixture = prepareLegacyOutcomeBackfillFixture({
    stateRoot,
    taskId,
    outcome: "merged",
    nowMs: baseMs,
  });
  const leaseWindow = testLeaseAuthorityWindow(
    stateRoot,
    fixture.authentication.leaseName,
  );
  const boundaries = [
    { label: "before acquisition", nowMs: leaseWindow.acquiredAtMs - 1 },
    { label: "at expiry", nowMs: leaseWindow.expiresAtMs },
  ];
  const evidence = { digest: "e".repeat(64) };
  const outcomeDigest = "f".repeat(64);

  for (const boundary of boundaries) {
    assertLeaseEventTimeRejected(
      stateRoot,
      () =>
        withTestOutcomeRecordingGuards(
          {
            stateRoot,
            taskId,
            authentication: fixture.authentication,
            nowMs: boundary.nowMs,
          },
          (control) =>
            control.reserveCurrentTaskOutcome({
              stateRoot,
              taskId,
              ...fixture.authentication,
              outcome: "merged",
              legacyTransitionEventId: fixture.legacyTransitionEventId,
              expectedRevision: fixture.task.revision,
              details: {
                latestOutcome: {
                  outcome: "merged",
                  evidence,
                  outcomeDigest,
                  recordedAt: new Date(boundary.nowMs).toISOString(),
                },
              },
              nowMs: boundary.nowMs,
            }),
        ),
      `reservation ${boundary.label}`,
    );
  }

  const validNowMs = leaseWindow.acquiredAtMs + 100;
  const cleanEntry = {
    schemaVersion: 3,
    ts: new Date(validNowMs).toISOString(),
    id: taskId,
    taskId,
    kind: "stability",
    outcome: "merged",
    notes: "",
    evidence,
  };
  let reservation;
  let controlEventId;
  withTestOutcomeRecordingGuards(
    {
      stateRoot,
      taskId,
      authentication: fixture.authentication,
      nowMs: validNowMs,
    },
    (control) => {
      reservation = control.reserveCurrentTaskOutcome({
        stateRoot,
        taskId,
        ...fixture.authentication,
        outcome: "merged",
        legacyTransitionEventId: fixture.legacyTransitionEventId,
        expectedRevision: fixture.task.revision,
        details: {
          latestOutcome: {
            outcome: "merged",
            evidence,
            outcomeDigest,
            recordedAt: cleanEntry.ts,
          },
        },
        nowMs: validNowMs,
      });
      controlEventId = outcomeRecordedEventId({
        taskId,
        taskRevision: reservation.task.revision,
        outcomeDigest,
        transitionEventId: reservation.event.eventId,
      });
      control.appendOutcomeControlEvent({
        stateRoot,
        taskId,
        ...fixture.authentication,
        eventId: controlEventId,
        data: {
          ledgerPath: fixture.paths.outcomes,
          leaseName: fixture.authentication.leaseName,
          id: cleanEntry.id,
          taskId,
          taskRevision: reservation.task.revision,
          taskState: "merged",
          kind: cleanEntry.kind,
          outcome: "merged",
          outcomeDigest,
          transitionEventId: reservation.event.eventId,
          evidence,
        },
        nowMs: validNowMs,
      });
    },
  );
  appendFileSync(
    fixture.paths.outcomes,
    `${JSON.stringify({
      ...cleanEntry,
      authentication: {
        actor: fixture.authentication.actor,
        leaseName: fixture.authentication.leaseName,
        controlEventId,
        transitionEventId: reservation.event.eventId,
        outcomeDigest,
        taskRevision: reservation.task.revision,
      },
    })}\n`,
    { mode: 0o600 },
  );

  for (const boundary of boundaries) {
    assertLeaseEventTimeRejected(
      stateRoot,
      () =>
        withTestOutcomeRecordingGuards(
          {
            stateRoot,
            taskId,
            authentication: fixture.authentication,
            nowMs: boundary.nowMs,
          },
          (control) =>
            control.finalizeTaskOutcome({
              stateRoot,
              taskId,
              ...fixture.authentication,
              outcome: "merged",
              outcomeDigest,
              taskRevision: reservation.task.revision,
              nowMs: boundary.nowMs,
            }),
        ),
      `finalization ${boundary.label}`,
    );
  }
});

test("legacy outcome backfill rejects inexact lifecycle history before mutation", async (t) => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const taskId = "backfill-exact-history";
  const fixture = prepareLegacyOutcomeBackfillFixture({
    stateRoot,
    taskId,
    outcome: "merged",
    nowMs,
  });
  createTask({
    stateRoot,
    taskId: "backfill-other-task",
    ...fixture.controllerAuthentication,
    observerAuthority: "observe-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nowMs + 50,
  });
  const canonicalEvents = readEvents(stateRoot);
  const canonicalHistory = inspectExactOutcomeControlHistory(canonicalEvents, {
    ledgerPath: fixture.paths.outcomes,
  });
  assert.equal(
    canonicalHistory.healthy,
    true,
    canonicalHistory.issues.join("\n"),
  );
  assert.deepEqual(
    [...canonicalHistory.transitions.keys()],
    [fixture.legacyTransitionEventId],
  );
  const legacyTransition = canonicalEvents.find(
    (event) => event.eventId === fixture.legacyTransitionEventId,
  );
  assert.ok(legacyTransition);
  assert.ok(
    readTaskManifest({ stateRoot }).revision >
      legacyTransition.manifestRevision,
  );
  const canonicalEventBytes = readFileSync(fixture.paths.events);
  const canonicalManifestBytes = readFileSync(fixture.paths.taskManifest);
  const canonicalOutcomeBytes = readFileSync(fixture.paths.outcomes);
  const canonicalTransactions = existsSync(fixture.paths.taskTransactions)
    ? readdirSync(fixture.paths.taskTransactions).sort()
    : [];
  const outcomeDigest = "d".repeat(64);

  const cases = [
    {
      name: "extra event key",
      mutate(events, legacyIndex) {
        events[legacyIndex].unexpected = true;
      },
    },
    {
      name: "duplicate event identity",
      mutate(events, legacyIndex) {
        events.push(structuredClone(events[legacyIndex]));
      },
    },
    {
      name: "noncanonical deterministic identity",
      mutate(events, legacyIndex) {
        const eventId = `task-outcome-reserved:${"e".repeat(64)}`;
        events[legacyIndex].eventId = eventId;
        return eventId;
      },
    },
    {
      name: "invalid provenance",
      mutate(events, legacyIndex) {
        events[legacyIndex].data.authorizationProvenance.leaseName =
          "release-verifier";
      },
    },
    {
      name: "authority mismatch",
      mutate(events, legacyIndex) {
        events[legacyIndex].observerAuthority = "observe-only";
      },
    },
    {
      name: "wrong physical ordering",
      mutate(events, legacyIndex) {
        const [legacy] = events.splice(legacyIndex, 1);
        const firstTaskEvent = events.findIndex(
          (event) => event.taskId === taskId,
        );
        events.splice(firstTaskEvent, 0, legacy);
      },
    },
    {
      name: "lifecycle state discontinuity",
      mutate(events, legacyIndex) {
        events[legacyIndex].data.fromState = "observed";
      },
    },
    {
      name: "manifest revision discontinuity",
      mutate(events, legacyIndex) {
        events[legacyIndex].manifestRevision -= 1;
      },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      const events = structuredClone(canonicalEvents);
      const legacyIndex = events.findIndex(
        (event) => event.eventId === fixture.legacyTransitionEventId,
      );
      assert.notEqual(legacyIndex, -1);
      const legacyTransitionEventId =
        testCase.mutate(events, legacyIndex) ?? fixture.legacyTransitionEventId;
      writeFileSync(
        fixture.paths.events,
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        { mode: 0o600 },
      );
      const tamperedEventBytes = readFileSync(fixture.paths.events);
      assert.throws(
        () =>
          withTestOutcomeRecordingGuards(
            {
              stateRoot,
              taskId,
              authentication: fixture.authentication,
              nowMs: nowMs + 100,
            },
            (control) =>
              control.reserveCurrentTaskOutcome({
                stateRoot,
                taskId,
                ...fixture.authentication,
                outcome: "merged",
                legacyTransitionEventId,
                expectedRevision: fixture.task.revision,
                details: {
                  latestOutcome: {
                    outcome: "merged",
                    evidence: { digest: "f".repeat(64) },
                    outcomeDigest,
                    recordedAt: new Date(nowMs + 100).toISOString(),
                  },
                },
                nowMs: nowMs + 100,
              }),
          ),
        (error) =>
          error instanceof AutomationControlError &&
          error.code === "outcome_reservation_mismatch",
      );
      assert.deepEqual(
        readFileSync(fixture.paths.taskManifest),
        canonicalManifestBytes,
      );
      assert.deepEqual(readFileSync(fixture.paths.events), tamperedEventBytes);
      assert.deepEqual(
        readFileSync(fixture.paths.outcomes),
        canonicalOutcomeBytes,
      );
      assert.deepEqual(
        existsSync(fixture.paths.taskTransactions)
          ? readdirSync(fixture.paths.taskTransactions).sort()
          : [],
        canonicalTransactions,
      );
      writeFileSync(fixture.paths.events, canonicalEventBytes, { mode: 0o600 });
    });
  }

  const reserved = withTestOutcomeRecordingGuards(
    {
      stateRoot,
      taskId,
      authentication: fixture.authentication,
      nowMs: nowMs + 100,
    },
    (control) =>
      control.reserveCurrentTaskOutcome({
        stateRoot,
        taskId,
        ...fixture.authentication,
        outcome: "merged",
        legacyTransitionEventId: fixture.legacyTransitionEventId,
        expectedRevision: fixture.task.revision,
        details: {
          latestOutcome: {
            outcome: "merged",
            evidence: { digest: "f".repeat(64) },
            outcomeDigest,
            recordedAt: new Date(nowMs + 100).toISOString(),
          },
        },
        nowMs: nowMs + 100,
      }),
  );
  assert.equal(reserved.changed, true);
  assert.equal(reserved.task.revision, fixture.task.revision + 1);
});

test("exact lifecycle history rejects physically preceding future acquisitions", async (t) => {
  for (const credentialKind of [
    "persistent-actor",
    "owner-signed-capability",
  ]) {
    await t.test(credentialKind, () => {
      const stateRoot = temporaryStateRoot();
      const nowMs = Date.now();
      const taskId = `future-acquisition-${credentialKind}`;
      const details = { behavioral: false };
      const observerAuthority = "merge-safe";
      const providerAuthority = "forbidden";
      const authentication =
        credentialKind === "persistent-actor"
          ? actorLease(stateRoot, "freed-stability-controller", { nowMs })
          : actorLease(stateRoot, "freed-owner", {
              nowMs,
              ownerTaskId: taskId,
              ownerIntentDigest: ownerIntent("task.create", taskId, {
                state: "observed",
                observerAuthority,
                providerAuthority,
                approvalReference: null,
                details,
              }),
            });
      createTask({
        stateRoot,
        taskId,
        ...authentication,
        observerAuthority,
        providerAuthority,
        details,
        nowMs: nowMs + 1,
      });
      const events = readEvents(stateRoot);
      const taskEvent = events.find(
        (event) => event.type === "task_created" && event.taskId === taskId,
      );
      assert.ok(taskEvent);
      const provenance = taskEvent.data.authorizationProvenance;
      const acquisition = events.find(
        (event) =>
          event.type === "lease_acquired" &&
          event.actor === authentication.actor &&
          event.leaseName === authentication.leaseName &&
          event.ts === provenance.leaseAcquiredAt,
      );
      assert.ok(acquisition);
      const futureTimestamp = new Date(
        Date.parse(taskEvent.ts) + 1_000,
      ).toISOString();
      acquisition.ts = futureTimestamp;
      provenance.leaseAcquiredAt = futureTimestamp;
      const inspection = inspectExactTaskLifecycleHistory(events);
      assert.equal(inspection.healthy, false);
      assert.match(inspection.issues.join("\n"), /lifecycle creation/);
    });
  }
});

test("exact lifecycle history rejects a missing physical prefix and misplaced legacy credential compatibility", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const authentication = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  createTask({
    stateRoot,
    taskId: "history-prefix-first",
    ...authentication,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nowMs + 1,
  });
  createTask({
    stateRoot,
    taskId: "history-prefix-second",
    ...authentication,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nowMs + 2,
  });
  const events = readEvents(stateRoot);
  const taskEventTypes = new Set([
    "outcome_reservation_created",
    "outcome_reservation_finalized",
    "task_authority_updated",
    "task_created",
    "task_transitioned",
  ]);
  const missingPrefix = events.filter(
    (event) =>
      !taskEventTypes.has(event.type) ||
      event.taskId === "history-prefix-second",
  );
  const prefixInspection = inspectExactTaskLifecycleHistory(missingPrefix);
  assert.equal(prefixInspection.healthy, false);
  assert.match(
    prefixInspection.issues.join("\n"),
    /physical task manifest revision/,
  );

  const forgedCompatibility = structuredClone(events);
  const creation = forgedCompatibility.find(
    (event) =>
      event.type === "task_created" && event.taskId === "history-prefix-first",
  );
  assert.ok(creation);
  creation.data.authorizationProvenance.credentialKind = "actor-credential";
  const compatibilityInspection =
    inspectExactTaskLifecycleHistory(forgedCompatibility);
  assert.equal(compatibilityInspection.healthy, false);
  assert.match(compatibilityInspection.issues.join("\n"), /lifecycle creation/);
});

test(
  "exact lifecycle history indexes one shared lease acquisition in linear time",
  { timeout: 10_000 },
  () => {
    const actor = "freed-stability-controller";
    const policy = AUTOMATION_ACTOR_POLICIES[actor];
    const leaseAcquiredAt = "2026-07-19T12:00:00.000Z";
    const taskTimestamp = "2026-07-19T12:00:01.000Z";
    const acquisition = {
      schemaVersion: 1,
      eventId: `lease:${"a".repeat(64)}`,
      type: "lease_acquired",
      ts: leaseAcquiredAt,
      actor,
      leaseName: policy.leaseName,
      data: {
        credentialKind: "persistent-actor",
        expiresAt: "2026-07-19T12:30:00.000Z",
        observerAuthority: policy.observerAuthority,
        providerAuthority: policy.providerAuthority,
        requestDigest: "b".repeat(64),
        actorCredentialPath: path.resolve(
          os.tmpdir(),
          "control",
          "actor-credentials",
          `${actor}.json`,
        ),
      },
    };
    const taskCount = 20_000;
    const taskEvents = Array.from({ length: taskCount }, (_, index) => ({
      schemaVersion: 1,
      eventId: `00000000-0000-4000-8000-${index
        .toString(16)
        .padStart(12, "0")}`,
      type: "task_created",
      ts: taskTimestamp,
      actor,
      taskId: `linear-history-${index}`,
      taskRevision: 1,
      manifestRevision: index + 1,
      observerAuthority: "merge-safe",
      providerAuthority: "forbidden",
      data: {
        behavioral: false,
        state: "observed",
        authorizationProvenance: {
          leaseName: policy.leaseName,
          leaseAcquiredAt,
          credentialKind: "persistent-actor",
        },
      },
    }));
    const inspection = inspectExactTaskLifecycleHistory([
      acquisition,
      ...taskEvents,
    ]);
    assert.equal(inspection.healthy, true, inspection.issues.join("\n"));
    assert.equal(inspection.currentByTask.size, taskCount);
    assert.equal(inspection.lastManifestRevision, taskCount);

    const ambiguousAcquisition = inspectExactTaskLifecycleHistory([
      acquisition,
      { ...acquisition, eventId: `lease:${"b".repeat(64)}` },
      taskEvents[0],
    ]);
    assert.equal(ambiguousAcquisition.healthy, false);
    assert.match(ambiguousAcquisition.issues.join("\n"), /lifecycle creation/);
  },
);

test("task lifecycle history owns behavioral classification and exact manifest parity", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-stability-controller";
  const taskId = "event-backed-behavioral-parity";
  const nowMs = Date.now();
  const authentication = actorLease(stateRoot, actor, { nowMs });
  createTask({
    stateRoot,
    taskId,
    ...authentication,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: true },
    nowMs: nowMs + 1,
  });
  transitionTask({
    stateRoot,
    taskId,
    ...authentication,
    toState: "triaged",
    expectedRevision: 1,
    nowMs: nowMs + 2,
  });
  const events = readEvents(stateRoot);
  const manifest = readTaskManifest({ stateRoot });
  const creation = events.find(
    (event) => event.type === "task_created" && event.taskId === taskId,
  );
  assert.ok(creation);
  assert.equal(creation.data.behavioral, true);

  const lifecycle = inspectExactTaskLifecycleHistory(events);
  assert.equal(lifecycle.healthy, true, lifecycle.issues.join("\n"));
  assert.equal(lifecycle.currentByTask.get(taskId).behavioral, true);
  assert.equal(
    inspectExactTaskManifestHistoryParity(events, manifest).healthy,
    true,
  );

  const withoutBehavioral = structuredClone(events);
  delete withoutBehavioral.find(
    (event) => event.type === "task_created" && event.taskId === taskId,
  ).data.behavioral;
  assert.equal(
    inspectExactTaskLifecycleHistory(withoutBehavioral).healthy,
    false,
  );

  const eventFlip = structuredClone(events);
  eventFlip.find(
    (event) => event.type === "task_created" && event.taskId === taskId,
  ).data.behavioral = false;
  const flippedHistory = inspectExactTaskLifecycleHistory(eventFlip);
  assert.equal(flippedHistory.healthy, true, flippedHistory.issues.join("\n"));
  assert.equal(
    inspectExactTaskManifestHistoryParity(eventFlip, manifest).healthy,
    false,
  );

  const manifestFlip = structuredClone(manifest);
  manifestFlip.tasks[0].behavioral = false;
  manifestFlip.tasks[0].details.behavioral = false;
  const flippedManifest = inspectExactTaskManifestHistoryParity(
    events,
    manifestFlip,
  );
  assert.equal(flippedManifest.healthy, false);
  assert.match(flippedManifest.issues.join("\n"), /history cursor/);

  const renamedTask = structuredClone(manifest);
  renamedTask.tasks[0].taskId = `${taskId}-renamed`;
  const idMismatch = inspectExactTaskManifestHistoryParity(events, renamedTask);
  assert.equal(idMismatch.healthy, false);
  assert.match(idMismatch.issues.join("\n"), /absent from/);

  const staleRevision = structuredClone(manifest);
  staleRevision.revision += 1;
  const revisionMismatch = inspectExactTaskManifestHistoryParity(
    events,
    staleRevision,
  );
  assert.equal(revisionMismatch.healthy, false);
  assert.match(
    revisionMismatch.issues.join("\n"),
    /does not match exact history revision/,
  );

  const authorityDrift = structuredClone(manifest);
  authorityDrift.tasks[0].observerAuthority = "pr-only";
  const authorityMismatch = inspectExactTaskManifestHistoryParity(
    events,
    authorityDrift,
  );
  assert.equal(authorityMismatch.healthy, false);
  assert.match(authorityMismatch.issues.join("\n"), /history cursor/);

  const omittedBehavioralTask = structuredClone(manifest);
  omittedBehavioralTask.tasks = [];
  const omission = inspectExactTaskManifestHistoryParity(
    events,
    omittedBehavioralTask,
  );
  assert.equal(omission.healthy, false);
  assert.match(omission.issues.join("\n"), /absent from the manifest/);
});

test("empty revision zero manifest has exact empty history parity", () => {
  const manifest = {
    schemaVersion: 1,
    revision: 0,
    updatedAt: "2026-07-20T00:00:00.000Z",
    tasks: [],
  };
  const inspection = inspectExactTaskManifestHistoryParity([], manifest);
  assert.equal(inspection.healthy, true, inspection.issues.join("\n"));
  assert.equal(inspection.lastManifestRevision, null);
  assert.equal(inspection.currentByTask.size, 0);
});

test("exact lifecycle history admits only the pinned legacy lease acquisition bridge", () => {
  const legacyAcquisition = pinnedLegacyRuntimeObserverTakeover();
  const taskCreation = {
    schemaVersion: 1,
    eventId: "d6bb94e6-148b-4168-8d99-469efcda8f82",
    type: "task_created",
    ts: "2026-07-14T14:29:53.394Z",
    actor: "freed-runtime-observer",
    taskId: "sync-health-youtube-attempt-divergence",
    taskRevision: 1,
    manifestRevision: 1,
    observerAuthority: "observe-only",
    providerAuthority: "forbidden",
    data: {
      state: "observed",
      authorizationProvenance: {
        leaseName: "runtime-observer",
        leaseAcquiredAt: "2026-07-14T14:14:20.779Z",
        credentialKind: "persistent-actor",
      },
    },
  };
  const exact = inspectExactTaskLifecycleHistory([
    legacyAcquisition,
    taskCreation,
  ]);
  assert.equal(exact.healthy, true, exact.issues.join("\n"));

  const driftedAcquisition = structuredClone(legacyAcquisition);
  driftedAcquisition.data.actorCredentialPath += ".drift";
  const drifted = inspectExactTaskLifecycleHistory([
    driftedAcquisition,
    taskCreation,
  ]);
  assert.equal(drifted.healthy, false);
  assert.match(drifted.issues.join("\n"), /lifecycle creation/);

  const inventedAcquisition = structuredClone(legacyAcquisition);
  inventedAcquisition.eventId = "11111111-2222-4333-8444-555555555555";
  const invented = inspectExactTaskLifecycleHistory([
    inventedAcquisition,
    taskCreation,
  ]);
  assert.equal(invented.healthy, false);
  assert.match(invented.issues.join("\n"), /lifecycle creation/);

  const currentIdentityWithoutRequestDigest =
    structuredClone(legacyAcquisition);
  currentIdentityWithoutRequestDigest.eventId = `lease:${"a".repeat(64)}`;
  const unboundCurrent = inspectExactTaskLifecycleHistory([
    currentIdentityWithoutRequestDigest,
    taskCreation,
  ]);
  assert.equal(unboundCurrent.healthy, false);
  assert.match(unboundCurrent.issues.join("\n"), /lifecycle creation/);
});

test("the complete installed legacy control history is byte pinned and drift sensitive", () => {
  const fixtureBytes = readFileSync(
    path.join(__dirname, "fixtures", "legacy-control-event-history.jsonl"),
  );
  assert.equal(
    createHash("sha256").update(fixtureBytes).digest("hex"),
    "5d5ecd8e07be93f87df845bfa19fa3b930c8c1c1c9ed4b9d1048dd7715248d2e",
  );
  const events = fixtureBytes
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  const leaseIndexes = events.flatMap((event, index) =>
    event.type.startsWith("lease_") ? [index] : [],
  );
  assert.equal(events.length, 30);
  assert.equal(leaseIndexes.length, 21);
  const lifecycle = inspectExactTaskLifecycleHistory(events);
  const outcomes = inspectExactOutcomeControlHistory(events);
  assert.equal(lifecycle.healthy, true, lifecycle.issues.join("\n"));
  assert.equal(outcomes.healthy, true, outcomes.issues.join("\n"));
  assert.equal(
    lifecycle.currentByTask.get("sync-health-youtube-attempt-divergence")
      .behavioral,
    false,
  );
  assert.equal(
    lifecycle.currentByTask.get("authenticated-essay-capture-pr-642")
      .behavioral,
    true,
  );

  for (const creationIndex of [4, 11]) {
    const upgradedLegacy = structuredClone(events);
    upgradedLegacy[creationIndex].data.behavioral = creationIndex === 11;
    const inspection = inspectExactTaskLifecycleHistory(upgradedLegacy);
    assert.equal(inspection.healthy, false, creationIndex.toLocaleString());
    assert.match(inspection.issues.join("\n"), /lifecycle creation/);
  }

  const pinnedOrphan = inspectExactTaskLifecycleHistory([events[26]]);
  assert.equal(pinnedOrphan.healthy, true, pinnedOrphan.issues.join("\n"));
  assert.equal(
    pinnedOrphan.currentByTask.get("authenticated-essay-capture-pr-642")
      .behavioral,
    true,
  );

  for (const leaseIndex of leaseIndexes) {
    const driftedEvents = structuredClone(events);
    const driftedEvent = driftedEvents[leaseIndex];
    assert.match(
      driftedEvent.eventId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    driftedEvent.data.drifted = true;
    const inspection = inspectExactTaskLifecycleHistory(driftedEvents);
    assert.equal(inspection.healthy, false, driftedEvent.eventId);
  }
});

test("current lease acquisition events require exact credential-specific structure", async (t) => {
  await t.test("rejects an invented general-actor credential kind", () => {
    const stateRoot = temporaryStateRoot();
    actorLease(stateRoot, "freed-runtime-observer");
    const invented = structuredClone(readEvents(stateRoot)[0]);
    invented.data.credentialKind = "invented-actor-credential";

    const inspection = inspectExactTaskLifecycleHistory([invented]);
    assert.equal(inspection.healthy, false);
    assert.match(inspection.issues.join("\n"), /canonical lease control event/);
  });

  await t.test("rejects the retired actor-credential acquisition kind", () => {
    const stateRoot = temporaryStateRoot();
    actorLease(stateRoot, "freed-runtime-observer");
    const retired = structuredClone(readEvents(stateRoot)[0]);
    retired.data.credentialKind = "actor-credential";

    const inspection = inspectExactTaskLifecycleHistory([retired]);
    assert.equal(inspection.healthy, false);
    assert.match(inspection.issues.join("\n"), /canonical lease control event/);
  });

  await t.test("rejects malformed owner confirmation provenance", () => {
    const stateRoot = temporaryStateRoot();
    actorLease(stateRoot, "freed-owner", {
      ownerTaskId: "strict-owner-provenance",
      ownerIntentDigest: ownerIntent(
        "task.authorize",
        "strict-owner-provenance",
        {
          observerAuthority: "merge-safe",
          providerAuthority: null,
          reason: "Exercise exact owner confirmation provenance.",
          approvalReference: null,
          expectedRevision: 1,
        },
      ),
    });
    const malformed = structuredClone(ownerLeaseAcquisition(stateRoot));
    malformed.data.ownerConfirmationId = 7;

    const inspection = inspectExactTaskLifecycleHistory([malformed]);
    assert.equal(inspection.healthy, false);
    assert.match(inspection.issues.join("\n"), /canonical lease control event/);
  });

  await t.test(
    "binds a general actor to exact trusted launcher provenance",
    () => {
      const stateRoot = temporaryStateRoot();
      const actor = "freed-runtime-observer";
      actorLease(stateRoot, actor);
      const acquisition = readEvents(stateRoot)[0];
      assert.equal(acquisition.data.credentialKind, "trusted-launcher-channel");
      assert.equal(acquisition.data.launcherSha256, TEST_LAUNCHER_SHA256);
      assert.equal(
        acquisition.data.actorRuntimeDigest,
        TEST_ACTOR_RUNTIME_DIGEST,
      );
      assert.equal(
        acquisition.data.launcherChannelProtocol,
        ACTOR_LAUNCHER_CHANNEL_PROTOCOL,
      );
      assert.equal(
        acquisition.data.launcherAttestationSha256,
        TEST_LAUNCHER_ATTESTATION_SHA256,
      );
      assert.equal(
        acquisition.data.launcherSessionId,
        TEST_LAUNCHER_SESSION_ID,
      );
      assert.equal(
        Object.hasOwn(acquisition.data, "actorCredentialPath"),
        false,
      );

      for (const field of [
        "launcherSha256",
        "actorRuntimeDigest",
        "launcherChannelProtocol",
        "launcherAttestationSha256",
        "launcherSessionId",
      ]) {
        const drifted = structuredClone(acquisition);
        drifted.data[field] =
          field === "launcherChannelProtocol" ? "retired-channel" : "invalid";
        const inspection = inspectExactTaskLifecycleHistory([drifted]);
        assert.equal(inspection.healthy, false, field);
        assert.match(
          inspection.issues.join("\n"),
          /canonical lease control event/,
        );
      }
    },
  );

  await t.test("requires the exact publisher lease lifetime", () => {
    const stateRoot = temporaryStateRoot();
    const actor = "freed-pr-publisher";
    const policy = AUTOMATION_ACTOR_POLICIES[actor];
    const acquiredAt = "2026-07-19T20:00:00.000Z";
    const acquisition = {
      schemaVersion: 1,
      eventId: `lease:${createHash("sha256")
        .update("exact-publisher-lifetime")
        .digest("hex")}`,
      type: "lease_acquired",
      ts: acquiredAt,
      actor,
      leaseName: policy.leaseName,
      data: {
        credentialKind: "signed-capability",
        expiresAt: new Date(Date.parse(acquiredAt) + 30 * 60_000).toISOString(),
        observerAuthority: policy.observerAuthority,
        providerAuthority: policy.providerAuthority,
        requestDigest: "c".repeat(64),
        publisherCapabilityId: "publisher-exact-lifetime",
        scope: {
          schemaVersion: 2,
          repo: "freed-project/freed",
          worktree: realpathSync(stateRoot),
          branch: "fix/exact-publisher-lifetime",
          base: "dev",
          baseSha: "a".repeat(40),
          headSha: null,
          publishMode: "feature-pr",
        },
      },
    };
    const exact = inspectExactTaskLifecycleHistory([acquisition]);
    assert.equal(exact.healthy, true, exact.issues.join("\n"));

    for (const driftMs of [-1, 1]) {
      const drifted = structuredClone(acquisition);
      drifted.data.expiresAt = new Date(
        Date.parse(acquisition.data.expiresAt) + driftMs,
      ).toISOString();
      const inspection = inspectExactTaskLifecycleHistory([drifted]);
      assert.equal(inspection.healthy, false, driftMs.toLocaleString());
      assert.match(
        inspection.issues.join("\n"),
        /canonical lease control event/,
      );
    }
  });
});

test("trusted launcher response-loss recovery admits a fresh channel session", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-runtime-observer";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = nextLeaseOperationId("trusted-launcher-response-loss");
  const token = `trusted-launcher-response-loss-${"x".repeat(48)}`;
  const options = {
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: AUTOMATION_ACTOR_POLICIES[actor].maxLeaseLifetimeMs,
    token,
    launcherAttestationSha256: TEST_LAUNCHER_ATTESTATION_SHA256,
    launcherSessionId: TEST_LAUNCHER_SESSION_ID,
  };

  assert.throws(
    () =>
      acquireLeaseLive({
        ...options,
        checkpoint: throwAtLeaseCheckpoint("lease-state-committed"),
      }),
    /lease checkpoint lease-state-committed/,
  );

  const paths = automationControlPaths(stateRoot);
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  );
  assert.equal(existsSync(transactionPaths.active), true);
  const recovered = acquireLeaseLive({
    ...options,
    launcherAttestationSha256: "e".repeat(64),
    launcherSessionId: "f".repeat(64),
  });

  assert.equal(recovered.recovered, true);
  assert.equal(recovered.lease.token, token);
  assert.equal(
    recovered.lease.launcherAttestationSha256,
    TEST_LAUNCHER_ATTESTATION_SHA256,
  );
  assert.equal(recovered.lease.launcherSessionId, TEST_LAUNCHER_SESSION_ID);
  const persisted = inspectLease({
    stateRoot,
    name,
    includeToken: true,
  });
  assert.equal(
    persisted.launcherAttestationSha256,
    TEST_LAUNCHER_ATTESTATION_SHA256,
  );
  assert.equal(persisted.launcherSessionId, TEST_LAUNCHER_SESSION_ID);
  assert.equal(
    readEvents(stateRoot).filter(
      (event) => event.eventId === `lease:${operationId}`,
    ).length,
    1,
  );
  assert.equal(existsSync(transactionPaths.active), false);
  assert.equal(existsSync(transactionPaths.receipt), true);

  const receiptBeforeReplay = readFileSync(transactionPaths.receipt);
  const eventsBeforeReplay = readFileSync(paths.events);
  const replay = acquireLeaseLive({
    ...options,
    launcherAttestationSha256: "1".repeat(64),
    launcherSessionId: "2".repeat(64),
  });
  assert.equal(replay.recovered, true);
  assert.equal(
    replay.lease.launcherAttestationSha256,
    TEST_LAUNCHER_ATTESTATION_SHA256,
  );
  assert.equal(replay.lease.launcherSessionId, TEST_LAUNCHER_SESSION_ID);
  assert.deepEqual(readFileSync(transactionPaths.receipt), receiptBeforeReplay);
  assert.deepEqual(readFileSync(paths.events), eventsBeforeReplay);
});

test("owner-confirmation heartbeats cannot outlive their confirmation", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-owner";
  const taskId = "owner-confirmation-heartbeat-boundary";
  const acquiredAtMs = Date.parse("2026-07-19T21:00:00Z");
  const confirmationExpiresAtMs = acquiredAtMs + 120_000;
  const intent = {
    schemaVersion: 1,
    action: "task.create",
    taskId,
    parameters: {
      state: "observed",
      observerAuthority: "merge-safe",
      providerAuthority: "forbidden",
      approvalReference: null,
      details: { behavioral: false },
    },
  };
  const confirmation = writeOwnerConfirmation(stateRoot, taskId, intent, {
    nowMs: acquiredAtMs,
    confirmationId: "owner-confirmation-heartbeat-boundary",
    expiresAtMs: confirmationExpiresAtMs,
  });
  acquireLeaseMutation({
    stateRoot,
    name: "owner-governance",
    owner: actor,
    operationId: nextLeaseOperationId("owner-confirmation-heartbeat-acquire"),
    ttlMs: 60_000,
    nowMs: acquiredAtMs + 1_000,
    token: `owner-confirmation-heartbeat-${"x".repeat(40)}`,
    ownerConfirmationFile: confirmation.confirmationPath,
    ownerCapabilityTaskId: taskId,
    ownerCapabilityIntentDigest: confirmation.intentDigest,
  });
  const acquisition = readEvents(stateRoot)[0];
  assert.equal(acquisition.data.credentialKind, "owner-confirmation");
  const heartbeat = {
    schemaVersion: 1,
    eventId: `lease:${createHash("sha256")
      .update("owner-confirmation-heartbeat-boundary")
      .digest("hex")}`,
    type: "lease_heartbeat",
    ts: new Date(acquiredAtMs + 30_000).toISOString(),
    actor,
    leaseName: "owner-governance",
    data: {
      expiresAt: new Date(confirmationExpiresAtMs).toISOString(),
      requestDigest: "d".repeat(64),
    },
  };
  const exact = inspectExactTaskLifecycleHistory([acquisition, heartbeat]);
  assert.equal(exact.healthy, true, exact.issues.join("\n"));

  const overrun = structuredClone(heartbeat);
  overrun.data.expiresAt = new Date(confirmationExpiresAtMs + 1).toISOString();
  const drifted = inspectExactTaskLifecycleHistory([acquisition, overrun]);
  assert.equal(drifted.healthy, false);
  assert.match(
    drifted.issues.join("\n"),
    /extend one active canonical lease lifetime/,
  );
});

test("lease health rejects unrelated duplicate conflicting and malformed reserved events", async (t) => {
  const stateRoot = temporaryStateRoot();
  actorLease(stateRoot, "freed-runtime-observer");
  const exact = readEvents(stateRoot);
  assert.equal(inspectExactTaskLifecycleHistory(exact).healthy, true);
  assert.equal(inspectExactOutcomeControlHistory(exact).healthy, true);

  for (const variant of ["duplicate", "conflicting", "malformed-reserved"]) {
    await t.test(variant, () => {
      const events = [
        ...structuredClone(exact),
        leaseHistoryCorruptionEvent(exact[0], variant, `health-${variant}`),
      ];
      const lifecycle = inspectExactTaskLifecycleHistory(events);
      const outcomes = inspectExactOutcomeControlHistory(events);
      assert.equal(lifecycle.healthy, false);
      assert.equal(outcomes.healthy, false);
      assert.match(
        [...lifecycle.issues, ...outcomes.issues].join("\n"),
        /canonical lease control event/,
      );
    });
  }
});

test("private batch selection partitions 100,000 names with one template and one request per chunk", () => {
  const names = Array.from(
    { length: 100_000 },
    (_, index) => `archive-${index.toString().padStart(6, "0")}.json`,
  );
  const partitioned = partitionPrivateBatchSelectionForTest(names);
  assert.equal(partitioned.selectedNameCount, 100_000);
  assert.equal(partitioned.requestBuildCount, partitioned.chunkCount + 1);
  assert.ok(partitioned.chunkCount > 1);
  assert.ok(partitioned.maximumChunkSize <= 4_096);
});

test("lease cleanup consumes 100,000 staged generations through indexed queues", () => {
  const result = consumeLeaseCleanupRequirementsForTest(100_000);
  assert.deepEqual(result, {
    indexed: 100_000,
    consumed: 100_000,
    complete: true,
  });
});

test("lease transaction history requires one complete private storage topology", async (t) => {
  const storageRoots = (stateRoot) => {
    const leases = automationControlPaths(stateRoot).leases;
    return {
      transactions: path.join(leases, ".transactions"),
      receipts: path.join(leases, ".transaction-receipts"),
    };
  };
  const initializeRoot = (root, includeQuarantine = true) => {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    if (!includeQuarantine) return;
    const quarantine = path.join(root, ".lease-cleanup-quarantine");
    mkdirSync(quarantine, { mode: 0o700 });
    chmodSync(quarantine, 0o700);
  };
  const removeStorageRoots = (roots) => {
    rmSync(roots.transactions, { recursive: true, force: true });
    rmSync(roots.receipts, { recursive: true, force: true });
  };

  await t.test("both roots absent before kernel cutover is healthy", () => {
    const stateRoot = temporaryUncutoverStateRoot();
    const roots = storageRoots(stateRoot);
    assert.equal(existsSync(roots.transactions), false);
    assert.equal(existsSync(roots.receipts), false);
    const inspection = inspectLeaseTransactionEventHistory({
      stateRoot,
      events: [],
    });
    assert.equal(inspection.healthy, true, inspection.issues.join("\n"));
    assert.equal(inspection.retainedReceiptCount, 0);
    assert.equal(inspection.pendingTransactionArtifactCount, 0);
  });

  await t.test(
    "legacy guards and writer lock preserve pre-cutover compatibility",
    () => {
      const stateRoot = temporaryUncutoverStateRoot();
      const paths = automationControlPaths(stateRoot);
      const legacyGuard = path.join(paths.guards, "tasks.lock");
      mkdirSync(legacyGuard, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(legacyGuard, "owner.json"), "{}\n", {
        mode: 0o600,
      });
      writeFileSync(
        path.join(stateRoot, "outcomes.jsonl.writer-lock"),
        "{}\n",
        {
          mode: 0o600,
        },
      );
      const inspection = inspectLeaseTransactionEventHistory({
        stateRoot,
        events: [],
      });
      assert.equal(inspection.healthy, true, inspection.issues.join("\n"));
    },
  );

  await t.test(
    "invalid existing cutover evidence cannot use legacy absence",
    () => {
      const stateRoot = temporaryUncutoverStateRoot();
      const paths = automationControlPaths(stateRoot);
      mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
      writeFileSync(
        path.join(paths.controlRoot, "kernel-guard-cutover.json"),
        "{}\n",
        { mode: 0o600 },
      );
      const inspection = inspectLeaseTransactionEventHistory({
        stateRoot,
        events: [],
      });
      assert.equal(inspection.healthy, false);
      assert.match(
        inspection.issues.join("\n"),
        /missing beside invalid kernel guard cutover evidence/,
      );
    },
  );

  await t.test("transactional events cannot use legacy absence", () => {
    const stateRoot = temporaryUncutoverStateRoot();
    const operationId = nextLeaseOperationId("missing-transaction-storage");
    const inspection = inspectLeaseTransactionEventHistory({
      stateRoot,
      events: [
        {
          schemaVersion: 1,
          eventId: `lease:${operationId}`,
          type: "lease_heartbeat",
          ts: "2026-07-19T22:00:00.000Z",
          actor: "freed-release-verifier",
          leaseName: "release-verifier",
          data: { expiresAt: "2026-07-19T22:01:00.000Z" },
        },
      ],
    });
    assert.equal(inspection.healthy, false);
    assert.match(
      inspection.issues.join("\n"),
      /missing despite retained transactional lease events/,
    );
  });

  await t.test("both roots absent after kernel cutover is unhealthy", () => {
    const stateRoot = temporaryStateRoot();
    const roots = storageRoots(stateRoot);
    removeStorageRoots(roots);
    assert.equal(existsSync(roots.transactions), false);
    assert.equal(existsSync(roots.receipts), false);
    const inspection = inspectLeaseTransactionEventHistory({
      stateRoot,
      events: [],
    });
    assert.equal(inspection.healthy, false);
    assert.equal(inspection.retainedReceiptCount, 0);
    assert.equal(inspection.pendingTransactionArtifactCount, 0);
    assert.match(
      inspection.issues.join("\n"),
      /directories are missing after kernel guard cutover/,
    );
  });

  for (const presentRoot of ["transactions", "receipts"]) {
    await t.test(`only ${presentRoot} present is unhealthy`, () => {
      const stateRoot = temporaryStateRoot();
      const roots = storageRoots(stateRoot);
      removeStorageRoots(roots);
      initializeRoot(roots[presentRoot]);
      assert.equal(existsSync(roots[presentRoot]), true);
      assert.equal(
        existsSync(
          roots[presentRoot === "transactions" ? "receipts" : "transactions"],
        ),
        false,
      );
      const inspection = inspectLeaseTransactionEventHistory({
        stateRoot,
        events: [],
      });
      assert.equal(inspection.healthy, false);
      assert.equal(inspection.pendingTransactionArtifactCount, 0);
      assert.match(inspection.issues.join("\n"), /must initialize together/);
    });
  }

  for (const missingQuarantine of ["transactions", "receipts"]) {
    await t.test(
      `${missingQuarantine} cleanup quarantine missing is unhealthy`,
      () => {
        const stateRoot = temporaryStateRoot();
        const roots = storageRoots(stateRoot);
        removeStorageRoots(roots);
        initializeRoot(
          roots.transactions,
          missingQuarantine !== "transactions",
        );
        initializeRoot(roots.receipts, missingQuarantine !== "receipts");
        assert.equal(existsSync(roots.transactions), true);
        assert.equal(existsSync(roots.receipts), true);
        assert.equal(
          existsSync(
            path.join(roots[missingQuarantine], ".lease-cleanup-quarantine"),
          ),
          false,
        );
        assert.equal(
          existsSync(
            path.join(
              roots[
                missingQuarantine === "transactions"
                  ? "receipts"
                  : "transactions"
              ],
              ".lease-cleanup-quarantine",
            ),
          ),
          true,
        );
        const inspection = inspectLeaseTransactionEventHistory({
          stateRoot,
          events: [],
        });
        assert.equal(inspection.healthy, false);
        assert.equal(inspection.pendingTransactionArtifactCount, 0);
        assert.match(
          inspection.issues.join("\n"),
          missingQuarantine === "transactions"
            ? /transaction cleanup archive directory is missing/
            : /receipt cleanup archive directory is missing/,
        );
      },
    );
  }
});

test("lease transaction history converts storage probe failures into unhealthy results", async (t) => {
  await t.test(
    "existence probe cannot traverse a non-directory ancestor",
    () => {
      const stateRoot = temporaryStateRoot();
      const paths = automationControlPaths(stateRoot);
      rmSync(paths.leases, { recursive: true });
      writeFileSync(paths.leases, "not-a-directory\n", { mode: 0o600 });
      const beforeInspection = snapshotLeaseAuthorityState(stateRoot);
      let inspection;

      assert.doesNotThrow(() => {
        inspection = inspectLeaseTransactionEventHistory({
          stateRoot,
          events: [],
        });
      });
      assert.equal(inspection.healthy, false);
      assert.equal(inspection.retainedReceiptCount, 0);
      assert.equal(inspection.pendingTransactionArtifactCount, 0);
      assert.match(
        inspection.issues.join("\n"),
        /lease transaction history is unavailable|not a directory/i,
      );
      assert.deepEqual(
        snapshotLeaseAuthorityState(stateRoot),
        beforeInspection,
      );
    },
  );

  await t.test(
    "storage root cannot escape through a symlinked ancestor",
    () => {
      const stateRoot = temporaryStateRoot();
      const paths = automationControlPaths(stateRoot);
      const transactions = path.join(paths.leases, ".transactions");
      const externalTransactions = temporaryUncutoverStateRoot();
      chmodSync(externalTransactions, 0o700);
      rmSync(transactions, { recursive: true });
      symlinkSync(externalTransactions, transactions, "dir");
      const beforeInspection = snapshotLeaseAuthorityState(stateRoot);
      let inspection;

      assert.doesNotThrow(() => {
        inspection = inspectLeaseTransactionEventHistory({
          stateRoot,
          events: [],
        });
      });
      assert.equal(inspection.healthy, false);
      assert.equal(inspection.retainedReceiptCount, 0);
      assert.equal(inspection.pendingTransactionArtifactCount, 0);
      assert.match(
        inspection.issues.join("\n"),
        /lease transaction history is unavailable|private directory|pinned/i,
      );
      assert.deepEqual(
        snapshotLeaseAuthorityState(stateRoot),
        beforeInspection,
      );
    },
  );
});

test("lease root inventory separates pinned legacy history from active transactions", async (t) => {
  const currentLeaseFixture = (label) => {
    const stateRoot = temporaryStateRoot();
    const actor = "freed-release-verifier";
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const operationId = nextLeaseOperationId(`lease-root-${label}`);
    acquireLeaseMutation({
      stateRoot,
      name,
      owner: actor,
      operationId,
      ttlMs: 60_000,
      nowMs: Date.parse("2026-07-19T22:00:00.000Z"),
      token: `lease-root-${label}-${"x".repeat(40)}`,
      actorCredentialToken: writeActorCredential(stateRoot, actor),
    });
    return {
      stateRoot,
      name,
      operationId,
      events: readEvents(stateRoot),
      leasePath: path.join(
        automationControlPaths(stateRoot).leases,
        `${name}.lease`,
      ),
      receiptPath: leaseTransactionPaths(
        stateRoot,
        name,
        "acquire",
        operationId,
      ).receipt,
    };
  };

  await t.test(
    "an exact pinned legacy active lease needs no transactional directory",
    () => {
      const stateRoot = temporaryStateRoot();
      const legacy = pinnedLegacyRuntimeObserverTakeover();
      const legacyLeasePath = path.join(
        automationControlPaths(stateRoot).leases,
        `${legacy.leaseName}.lease`,
      );
      assert.equal(existsSync(legacyLeasePath), false);
      const inspection = inspectLeaseTransactionEventHistory({
        stateRoot,
        events: [legacy],
      });
      assert.equal(inspection.healthy, true, inspection.issues.join("\n"));
      assert.equal(inspection.retainedReceiptCount, 0);
    },
  );

  await t.test("an active transactional receipt binds its directory", () => {
    const fixture = currentLeaseFixture("exact");
    assert.equal(existsSync(fixture.leasePath), true);
    const inspection = inspectLeaseTransactionEventHistory({
      stateRoot: fixture.stateRoot,
      events: fixture.events,
    });
    assert.equal(inspection.healthy, true, inspection.issues.join("\n"));
    assert.equal(inspection.retainedReceiptCount, 1);
  });

  await t.test("an orphan top-level lease directory is rejected", () => {
    const stateRoot = temporaryStateRoot();
    const orphan = path.join(
      automationControlPaths(stateRoot).leases,
      "orphan.lease",
    );
    mkdirSync(orphan, { mode: 0o700 });
    const inspection = inspectLeaseTransactionEventHistory({
      stateRoot,
      events: [],
    });
    assert.equal(inspection.healthy, false);
    assert.match(
      inspection.issues.join("\n"),
      /Lease authority directory batch admission failed/,
    );
  });

  await t.test(
    "a malformed or missing current receipt cannot become legacy",
    async (receiptTest) => {
      for (const variant of ["malformed", "missing"]) {
        await receiptTest.test(variant, () => {
          const fixture = currentLeaseFixture(`receipt-${variant}`);
          if (variant === "malformed") {
            writeFileSync(fixture.receiptPath, "{\n", { mode: 0o600 });
          } else {
            rmSync(fixture.receiptPath);
          }
          const inspection = inspectLeaseTransactionEventHistory({
            stateRoot: fixture.stateRoot,
            events: fixture.events,
          });
          assert.equal(existsSync(fixture.leasePath), true);
          assert.equal(inspection.healthy, false);
          assert.match(
            inspection.issues.join("\n"),
            variant === "malformed"
              ? /lease transaction receipt .* is invalid/
              : /required retained lease transaction receipt .* is missing/,
          );
          assert.doesNotMatch(
            inspection.issues.join("\n"),
            /Lease authority directory batch admission failed/,
          );
        });
      }
    },
  );

  await t.test("a missing active transactional directory is rejected", () => {
    const fixture = currentLeaseFixture("missing-directory");
    rmSync(fixture.leasePath, { recursive: true });
    const inspection = inspectLeaseTransactionEventHistory({
      stateRoot: fixture.stateRoot,
      events: fixture.events,
    });
    assert.equal(inspection.healthy, false);
    assert.match(
      inspection.issues.join("\n"),
      /Lease authority directory batch admission failed|final transactional authority/,
    );
  });
});

test("retained completed lease receipts bind continuous health to exact events", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const acquiredAtMs = Date.parse("2026-07-19T22:00:00Z");
  const token = `retained-event-binding-${"x".repeat(40)}`;
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("retained-event-binding-acquire"),
    ttlMs: 60_000,
    nowMs: acquiredAtMs,
    token,
    actorCredentialToken,
  });
  const heartbeatOperationId = nextLeaseOperationId(
    "retained-event-binding-heartbeat",
  );
  heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: heartbeatOperationId,
    token,
    ttlMs: 60_000,
    nowMs: acquiredAtMs + 1_000,
  });
  const exactEvents = readEvents(stateRoot);
  const cleanupBatchScopes = [];
  const exact = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: exactEvents,
    checkpoint(phase, details) {
      if (phase === "lease-history-cleanup-batch-selection") {
        cleanupBatchScopes.push(details.archiveScope);
      }
    },
  });
  assert.equal(exact.healthy, true, exact.issues.join("\n"));
  assert.deepEqual(cleanupBatchScopes, ["transaction", "receipt"]);
  assert.equal(exact.retainedReceiptCount, 2);
  assert.equal(exact.pendingTransactionArtifactCount, 0);

  const driftedEvents = structuredClone(exactEvents);
  const driftedHeartbeat = driftedEvents.find(
    (event) => event.eventId === `lease:${heartbeatOperationId}`,
  );
  assert.ok(driftedHeartbeat);
  driftedHeartbeat.data.expiresAt = new Date(
    Date.parse(driftedHeartbeat.data.expiresAt) + 1,
  ).toISOString();
  const structurallyValid = inspectExactTaskLifecycleHistory(driftedEvents);
  assert.equal(
    structurallyValid.healthy,
    true,
    structurallyValid.issues.join("\n"),
  );
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);
  const drifted = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: driftedEvents,
  });
  assert.equal(drifted.healthy, false);
  assert.equal(drifted.pendingTransactionArtifactCount, 0);
  assert.match(
    drifted.issues.join("\n"),
    /does not match one exact control event/,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);
});

test("retained release receipts remain healthy and replayable after a later acquire", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const acquiredAtMs = Date.parse("2026-07-19T22:30:00Z");
  const firstToken = `release-reacquire-first-${"x".repeat(40)}`;
  const secondToken = `release-reacquire-second-${"x".repeat(40)}`;
  const releaseOperationId = nextLeaseOperationId("release-reacquire-release");

  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("release-reacquire-first"),
    ttlMs: 60_000,
    nowMs: acquiredAtMs,
    token: firstToken,
    actorCredentialToken,
  });
  releaseLease({
    stateRoot,
    name,
    operationId: releaseOperationId,
    token: firstToken,
    nowMs: acquiredAtMs + 1_000,
  });
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("release-reacquire-second"),
    ttlMs: 60_000,
    nowMs: acquiredAtMs + 2_000,
    token: secondToken,
    actorCredentialToken,
  });
  heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: nextLeaseOperationId("release-reacquire-heartbeat"),
    token: secondToken,
    ttlMs: 60_000,
    nowMs: acquiredAtMs + 3_000,
  });

  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: readEvents(stateRoot),
  });
  assert.equal(inspection.healthy, true, inspection.issues.join("\n"));
  const transactionArchive = path.join(
    automationControlPaths(stateRoot).leases,
    ".transactions",
    ".lease-cleanup-quarantine",
  );
  const releaseWalEntry = readdirSync(transactionArchive).find((entry) => {
    if (!entry.startsWith(`${releaseOperationId}.`)) return false;
    try {
      const value = JSON.parse(
        readFileSync(path.join(transactionArchive, entry), "utf8"),
      );
      return value.kind === "lease-transaction";
    } catch {
      return false;
    }
  });
  assert.ok(releaseWalEntry);
  const overAge = new Date("2020-01-01T00:00:00.000Z");
  utimesSync(path.join(transactionArchive, releaseWalEntry), overAge, overAge);
  const beforeReplay = snapshotLeaseAuthorityState(stateRoot);
  const replay = releaseLease({
    stateRoot,
    name,
    operationId: releaseOperationId,
    token: firstToken,
    nowMs: acquiredAtMs + 4_000,
  });
  assert.equal(replay.recovered, true);
  assert.equal(
    inspectLease({
      stateRoot,
      name,
      nowMs: acquiredAtMs + 4_000,
      includeToken: true,
    }).token,
    secondToken,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeReplay);

  rmSync(path.join(automationControlPaths(stateRoot).leases, `${name}.lease`), {
    recursive: true,
  });
  const deleted = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: readEvents(stateRoot),
  });
  assert.equal(deleted.healthy, false);
  assert.match(
    deleted.issues.join("\n"),
    /Lease authority directory batch admission failed|final transactional authority/,
  );
});

test("continuous lease health binds final authority to exact content and one leases root generation", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const token = `final-authority-binding-${"x".repeat(40)}`;
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("final-authority-binding"),
    ttlMs: 60_000,
    nowMs: Date.parse("2026-07-19T23:00:00Z"),
    token,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const paths = automationControlPaths(stateRoot);
  const leasePath = path.join(paths.leases, `${name}.lease`);
  const recordPath = path.join(leasePath, "lease.json");
  const originalBytes = readFileSync(recordPath);
  const originalRecord = JSON.parse(originalBytes.toString("utf8"));
  const events = readEvents(stateRoot);

  for (const variant of ["token", "ttlMs"]) {
    const replacement = structuredClone(originalRecord);
    if (variant === "token") {
      replacement.token = `replacement-token-${"y".repeat(40)}`;
    } else {
      replacement.ttlMs += 1;
    }
    writeFileSync(recordPath, `${JSON.stringify(replacement, null, 2)}\n`, {
      mode: 0o600,
    });
    const inspection = inspectLeaseTransactionEventHistory({
      stateRoot,
      events,
    });
    assert.equal(inspection.healthy, false, variant);
    assert.match(
      inspection.issues.join("\n"),
      /after descriptor|final transactional authority/,
      variant,
    );
    writeFileSync(recordPath, originalBytes, { mode: 0o600 });
  }

  rmSync(leasePath, { recursive: true });
  const deleted = inspectLeaseTransactionEventHistory({ stateRoot, events });
  assert.equal(deleted.healthy, false);
  assert.match(
    deleted.issues.join("\n"),
    /Lease authority directory batch admission failed|final transactional authority/,
  );
  mkdirSync(leasePath, { mode: 0o700 });
  writeFileSync(recordPath, originalBytes, { mode: 0o600 });
  const restored = inspectLeaseTransactionEventHistory({ stateRoot, events });
  assert.equal(restored.healthy, true, restored.issues.join("\n"));

  const beforeSwap = snapshotLeaseAuthorityState(stateRoot);
  const displaced = `${paths.leases}.admitted-root`;
  let swapped = false;
  const swappedInspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events,
    checkpoint(phase) {
      if (phase !== "lease-history-before-final-revalidation" || swapped) {
        return;
      }
      swapped = true;
      renameSync(paths.leases, displaced);
      cpSync(displaced, paths.leases, {
        recursive: true,
        preserveTimestamps: true,
      });
      const pending = [paths.leases];
      while (pending.length > 0) {
        const current = pending.pop();
        const stats = lstatSync(current);
        if (stats.isDirectory()) {
          chmodSync(current, 0o700);
          for (const child of readdirSync(current)) {
            pending.push(path.join(current, child));
          }
        } else {
          chmodSync(current, 0o600);
        }
      }
    },
  });
  assert.equal(swapped, true);
  assert.equal(swappedInspection.healthy, false);
  assert.match(
    swappedInspection.issues.join("\n"),
    /changed after inspection|changed after descriptor admission/,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeSwap);
  rmSync(displaced, { recursive: true });
});

test("retained release replay follows a later publisher bind transaction", () => {
  const stateRoot = temporaryStateRoot();
  const name = "pr-publisher";
  const nowMs = Date.parse("2026-07-19T23:30:00Z");
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(stateRoot),
    branch: "fix/release-reacquire-bind",
    base: "dev",
    baseSha: "a".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  const firstOperationId = nextLeaseOperationId("publisher-release-first");
  const firstToken = `publisher-release-first-${"x".repeat(40)}`;
  const firstCapability = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-release-first-capability",
    leaseOperationId: firstOperationId,
    token: firstToken,
  });
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: "freed-pr-publisher",
    operationId: firstOperationId,
    ttlMs: 30 * 60_000,
    nowMs,
    token: firstToken,
    publisherCapabilityFile: firstCapability.capabilityPath,
    scope,
  });
  const releaseOperationId = nextLeaseOperationId("publisher-release");
  releaseLease({
    stateRoot,
    name,
    operationId: releaseOperationId,
    token: firstToken,
    nowMs: nowMs + 1_000,
  });

  const secondOperationId = nextLeaseOperationId("publisher-release-second");
  const secondToken = `publisher-release-second-${"y".repeat(40)}`;
  const secondCapability = writePublisherCapability(stateRoot, scope, {
    nowMs: nowMs + 2_000,
    capabilityId: "publisher-release-second-capability",
    privateKey: firstCapability.privateKey,
    leaseOperationId: secondOperationId,
    token: secondToken,
  });
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: "freed-pr-publisher",
    operationId: secondOperationId,
    ttlMs: 30 * 60_000,
    nowMs: nowMs + 2_000,
    token: secondToken,
    publisherCapabilityFile: secondCapability.capabilityPath,
    scope,
  });
  bindPublisherLeaseHeadMutation({
    stateRoot,
    operationId: nextLeaseOperationId("publisher-release-bind"),
    token: secondToken,
    scope,
    headSha: "b".repeat(40),
    nowMs: nowMs + 3_000,
  });

  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: readEvents(stateRoot),
  });
  assert.equal(inspection.healthy, true, inspection.issues.join("\n"));
  const beforeReplay = snapshotLeaseAuthorityState(stateRoot);
  const replay = releaseLease({
    stateRoot,
    name,
    operationId: releaseOperationId,
    token: firstToken,
    nowMs: nowMs + 4_000,
  });
  assert.equal(replay.recovered, true);
  assert.equal(
    inspectLease({
      stateRoot,
      name,
      nowMs: nowMs + 4_000,
      includeToken: true,
    }).token,
    secondToken,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeReplay);
});

test("a transactional heartbeat after the pinned legacy acquire still binds private state", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-runtime-observer";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const token = `pinned-legacy-heartbeat-${"x".repeat(40)}`;
  const initialOperationId = nextLeaseOperationId("pinned-legacy-bootstrap");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: initialOperationId,
    ttlMs: 60_000,
    nowMs: Date.parse("2026-07-14T14:14:20.779Z"),
    token,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const paths = automationControlPaths(stateRoot);
  rmSync(
    leaseTransactionPaths(stateRoot, name, "acquire", initialOperationId)
      .receipt,
  );
  const legacyAcquisition = pinnedLegacyRuntimeObserverTakeover();
  writeFileSync(paths.events, `${JSON.stringify(legacyAcquisition)}\n`, {
    mode: 0o600,
  });
  const recordPath = path.join(paths.leases, `${name}.lease`, "lease.json");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  record.acquiredAt = legacyAcquisition.ts;
  record.heartbeatAt = legacyAcquisition.ts;
  record.expiresAt = legacyAcquisition.data.expiresAt;
  record.ttlMs = 30 * 60_000;
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: nextLeaseOperationId("pinned-legacy-heartbeat"),
    token,
    ttlMs: 60_000,
    nowMs: Date.parse("2026-07-14T14:15:20.779Z"),
  });
  const events = readEvents(stateRoot);
  const exact = inspectLeaseTransactionEventHistory({ stateRoot, events });
  assert.equal(exact.healthy, true, exact.issues.join("\n"));

  const current = JSON.parse(readFileSync(recordPath, "utf8"));
  current.token = `pinned-legacy-replacement-${"y".repeat(40)}`;
  writeFileSync(recordPath, `${JSON.stringify(current, null, 2)}\n`, {
    mode: 0o600,
  });
  const tampered = inspectLeaseTransactionEventHistory({ stateRoot, events });
  assert.equal(tampered.healthy, false);
  assert.match(
    tampered.issues.join("\n"),
    /after descriptor|final transactional authority/,
  );
});

test("malformed canonical lease receipts return unhealthy without throwing", async (t) => {
  for (const variant of ["invalid-json", "invalid-shape"]) {
    await t.test(variant, () => {
      const stateRoot = temporaryStateRoot();
      const actor = "freed-release-verifier";
      const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
      const operationId = nextLeaseOperationId(`malformed-receipt-${variant}`);
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs: Date.parse("2026-07-19T22:10:00Z"),
        token: `malformed-receipt-${variant}-${"x".repeat(40)}`,
        actorCredentialToken: writeActorCredential(stateRoot, actor),
      });
      const receiptPath = leaseTransactionPaths(
        stateRoot,
        name,
        "acquire",
        operationId,
      ).receipt;
      if (variant === "invalid-json") {
        writeFileSync(receiptPath, "{\n", { mode: 0o600 });
      } else {
        const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
        delete receipt.requestDigest;
        writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, {
          mode: 0o600,
        });
      }
      const events = readEvents(stateRoot);
      const beforeInspection = snapshotLeaseAuthorityState(stateRoot);
      let inspection;

      assert.doesNotThrow(() => {
        inspection = inspectLeaseTransactionEventHistory({
          stateRoot,
          events,
        });
      });
      assert.equal(inspection.healthy, false);
      assert.equal(inspection.retainedReceiptCount, 0);
      assert.equal(inspection.pendingTransactionArtifactCount, 0);
      assert.match(
        inspection.issues.join("\n"),
        /lease transaction receipt .* is invalid/,
      );
      assert.deepEqual(
        snapshotLeaseAuthorityState(stateRoot),
        beforeInspection,
      );
    });
  }
});

test("an unexpected top-level lease receipt sibling is unhealthy", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = nextLeaseOperationId("unexpected-receipt-sibling");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    nowMs: Date.parse("2026-07-19T22:15:00Z"),
    token: `unexpected-receipt-sibling-${"x".repeat(40)}`,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const receiptPath = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  ).receipt;
  const unexpectedPath = path.join(
    path.dirname(receiptPath),
    "unexpected-receipt-sibling.json",
  );
  writeFileSync(unexpectedPath, "{}\n", { mode: 0o600 });
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);
  let inspection;

  assert.doesNotThrow(() => {
    inspection = inspectLeaseTransactionEventHistory({
      stateRoot,
      events: readEvents(stateRoot),
    });
  });
  assert.equal(inspection.healthy, false);
  assert.equal(inspection.retainedReceiptCount, 1);
  assert.equal(inspection.pendingTransactionArtifactCount, 0);
  assert.match(
    inspection.issues.join("\n"),
    /lease transaction receipt unexpected-receipt-sibling\.json has an invalid name/,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);
});

test("a retained lease receipt rejects a duplicate exact event ID", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = nextLeaseOperationId("duplicate-receipt-event");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    nowMs: Date.parse("2026-07-19T22:20:00Z"),
    token: `duplicate-receipt-event-${"x".repeat(40)}`,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const events = readEvents(stateRoot);
  assert.equal(events.length, 1);
  events.push(structuredClone(events[0]));
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);

  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events,
  });
  assert.equal(inspection.healthy, false);
  assert.equal(inspection.retainedReceiptCount, 1);
  assert.equal(inspection.pendingTransactionArtifactCount, 0);
  assert.match(
    inspection.issues.join("\n"),
    /does not match one exact control event/,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);
});

test("a retained lease receipt rejects a missing exact event", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = nextLeaseOperationId("missing-receipt-event");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    nowMs: Date.parse("2026-07-19T22:25:00Z"),
    token: `missing-receipt-event-${"x".repeat(40)}`,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);

  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: [],
  });
  assert.equal(inspection.healthy, false);
  assert.equal(inspection.retainedReceiptCount, 1);
  assert.equal(inspection.pendingTransactionArtifactCount, 0);
  assert.match(
    inspection.issues.join("\n"),
    /does not match one exact control event/,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);
});

test("transactional lease events require their newest retained receipts", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = nextLeaseOperationId("missing-required-receipt");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    nowMs: Date.parse("2026-07-19T22:27:00Z"),
    token: `missing-required-receipt-${"x".repeat(40)}`,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const receiptPath = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  ).receipt;
  rmSync(receiptPath);
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);

  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: readEvents(stateRoot),
  });
  assert.equal(inspection.healthy, false);
  assert.equal(inspection.retainedReceiptCount, 0);
  assert.equal(inspection.pendingTransactionArtifactCount, 0);
  assert.match(
    inspection.issues.join("\n"),
    /required retained lease transaction receipt .* is missing/,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);
});

test("receipt pruning keeps nonempty quarantine healthy and counts only canonical receipts", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const acquiredAtMs = Date.parse("2026-07-19T22:30:00Z");
  const token = `receipt-pruning-health-${"x".repeat(40)}`;
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("receipt-pruning-acquire"),
    ttlMs: 30 * 60_000,
    nowMs: acquiredAtMs,
    token,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const heartbeatOperationIds = [];
  for (let index = 0; index < 10; index += 1) {
    if (index === 8) {
      for (const [
        receiptIndex,
        operationId,
      ] of heartbeatOperationIds.entries()) {
        const reversedMtime = new Date(
          Date.parse("2026-07-19T23:30:00Z") - receiptIndex * 1_000,
        );
        utimesSync(
          leaseTransactionPaths(stateRoot, name, "heartbeat", operationId)
            .receipt,
          reversedMtime,
          reversedMtime,
        );
      }
    }
    const operationId = nextLeaseOperationId(
      `receipt-pruning-heartbeat-${index}`,
    );
    heartbeatOperationIds.push(operationId);
    heartbeatLeaseMutation({
      stateRoot,
      name,
      operationId,
      token,
      ttlMs: 30 * 60_000,
      nowMs: acquiredAtMs + index + 1,
    });
  }
  const receiptDirectory = path.join(
    automationControlPaths(stateRoot).leases,
    ".transaction-receipts",
  );
  const quarantineDirectory = path.join(
    receiptDirectory,
    ".lease-cleanup-quarantine",
  );
  const canonicalReceiptEntries = readdirSync(receiptDirectory).filter(
    (entry) => entry !== ".lease-cleanup-quarantine",
  );
  const quarantinedReceiptEntries = readdirSync(quarantineDirectory);
  assert.equal(canonicalReceiptEntries.length, 9);
  assert.ok(quarantinedReceiptEntries.length > 0);
  for (const [index, operationId] of heartbeatOperationIds.entries()) {
    assert.equal(
      canonicalReceiptEntries.includes(
        path.basename(
          leaseTransactionPaths(stateRoot, name, "heartbeat", operationId)
            .receipt,
        ),
      ),
      index >= 2,
      `heartbeat receipt ${index.toLocaleString()} retention mismatch`,
    );
  }
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);
  const descriptorDirectory =
    process.platform === "linux" ? "/proc/self/fd" : "/dev/fd";
  const descriptorCountBefore = readdirSync(descriptorDirectory).length;
  let descriptorCountAtCheckpoint = null;

  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: readEvents(stateRoot),
    checkpoint(phase) {
      if (phase === "lease-history-before-final-revalidation") {
        descriptorCountAtCheckpoint = readdirSync(descriptorDirectory).length;
      }
    },
  });
  assert.equal(inspection.healthy, true, inspection.issues.join("\n"));
  assert.equal(inspection.retainedReceiptCount, canonicalReceiptEntries.length);
  assert.notEqual(
    inspection.retainedReceiptCount,
    canonicalReceiptEntries.length + quarantinedReceiptEntries.length,
  );
  assert.equal(inspection.pendingTransactionArtifactCount, 0);
  assert.ok(Number.isSafeInteger(descriptorCountAtCheckpoint));
  assert.ok(
    descriptorCountAtCheckpoint <= descriptorCountBefore + 8,
    `lease history held ${Number(
      descriptorCountAtCheckpoint - descriptorCountBefore,
    ).toLocaleString()} extra descriptors at its checkpoint`,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);

  const archivedReceiptPath = path.join(
    quarantineDirectory,
    quarantinedReceiptEntries[0],
  );
  const archivedReceiptBytes = readFileSync(archivedReceiptPath);
  const archivedReceipt = JSON.parse(archivedReceiptBytes.toString("utf8"));
  const restoredReceiptPath = leaseTransactionPaths(
    stateRoot,
    archivedReceipt.name,
    archivedReceipt.operation,
    archivedReceipt.operationId,
  ).receipt;
  writeFileSync(restoredReceiptPath, archivedReceiptBytes, { mode: 0o600 });
  const beforeOverRetentionInspection = snapshotLeaseAuthorityState(stateRoot);
  const overRetention = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: readEvents(stateRoot),
  });
  assert.equal(overRetention.healthy, false);
  assert.equal(overRetention.retainedReceiptCount, 10);
  assert.match(
    overRetention.issues.join("\n"),
    /is outside its retained event suffix/,
  );
  assert.deepEqual(
    snapshotLeaseAuthorityState(stateRoot),
    beforeOverRetentionInspection,
  );
});

test("pending canonical lease transaction artifacts make continuous history unhealthy", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `pending-history-artifact-${"x".repeat(40)}`;
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("pending-history-acquire"),
    ttlMs: 60_000,
    nowMs: Date.now(),
    token,
    actorCredentialToken,
  });
  const heartbeatOperationId = nextLeaseOperationId(
    "pending-history-heartbeat",
  );
  runLeaseMutationProcessLoss({
    exportName: "heartbeatLease",
    options: {
      stateRoot,
      name,
      operationId: heartbeatOperationId,
      token,
      ttlMs: 60_000,
    },
    phase: "lease-event-appended",
  });
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    heartbeatOperationId,
  );
  assert.equal(existsSync(transactionPaths.active), true);
  const events = readEvents(stateRoot);
  const semanticHistory = inspectExactTaskLifecycleHistory(events);
  assert.equal(
    semanticHistory.healthy,
    true,
    semanticHistory.issues.join("\n"),
  );
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);

  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events,
  });
  assert.equal(inspection.healthy, false);
  assert.ok(inspection.pendingTransactionArtifactCount > 0);
  assert.match(
    inspection.issues.join("\n"),
    /pending lease transaction artifact/,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);
});

test("lease transaction history detects a same-inode same-length terminal receipt rewrite", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const acquiredAtMs = Date.parse("2026-07-19T22:30:00Z");
  const token = `terminal-receipt-rewrite-${"x".repeat(40)}`;
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("terminal-receipt-acquire"),
    ttlMs: 60_000,
    nowMs: acquiredAtMs,
    token,
    actorCredentialToken,
  });
  const heartbeatOperationId = nextLeaseOperationId(
    "terminal-receipt-heartbeat",
  );
  heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: heartbeatOperationId,
    token,
    ttlMs: 60_000,
    nowMs: acquiredAtMs + 1_000,
  });
  const events = readEvents(stateRoot);
  const heartbeatEvent = events.find(
    (event) => event.eventId === `lease:${heartbeatOperationId}`,
  );
  assert.ok(heartbeatEvent);
  const receiptPath = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    heartbeatOperationId,
  ).receipt;
  const receiptBefore = readFileSync(receiptPath);
  const identityBefore = lstatSync(receiptPath, { bigint: true });
  const originalExpiry = heartbeatEvent.data.expiresAt;
  const driftedExpiry = new Date(Date.parse(originalExpiry) + 1).toISOString();
  const receiptText = receiptBefore.toString("utf8");
  const expiryOffset = receiptText.indexOf(originalExpiry);
  assert.ok(expiryOffset >= 0);
  const racedReceipt = Buffer.from(
    `${receiptText.slice(0, expiryOffset)}${driftedExpiry}${receiptText.slice(
      expiryOffset + originalExpiry.length,
    )}`,
  );
  assert.equal(racedReceipt.length, receiptBefore.length);
  let checkpointCount = 0;
  let racedAuthorityState;

  const paths = automationControlPaths(stateRoot);
  const inspection = withAutomationOutcomeLedgerWriterGuard(
    paths.outcomes,
    () =>
      inspectLeaseTransactionEventHistory({
        stateRoot,
        events,
        checkpoint(phase) {
          if (phase !== "lease-history-before-final-revalidation") return;
          checkpointCount += 1;
          writeFileSync(receiptPath, racedReceipt, { mode: 0o600 });
          const identityAfter = lstatSync(receiptPath, { bigint: true });
          assert.equal(identityAfter.ino, identityBefore.ino);
          assert.equal(identityAfter.size, identityBefore.size);
          racedAuthorityState = snapshotLeaseAuthorityState(stateRoot);
        },
      }),
    { stateRoot },
  );
  assert.equal(checkpointCount, 1);
  assert.equal(inspection.healthy, false);
  assert.equal(inspection.pendingTransactionArtifactCount, 0);
  assert.match(inspection.issues.join("\n"), /changed after inspection/);
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), racedAuthorityState);
});

test("lease transaction history detects a same-inode same-length retained staging rewrite", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const acquiredAtMs = Date.parse("2026-07-19T22:45:00Z");
  const token = `retained-staging-rewrite-${"x".repeat(40)}`;
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("retained-staging-acquire"),
    ttlMs: 60_000,
    nowMs: acquiredAtMs,
    token,
    actorCredentialToken,
  });
  const heartbeatOperationId = nextLeaseOperationId(
    "retained-staging-heartbeat",
  );
  heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: heartbeatOperationId,
    token,
    ttlMs: 60_000,
    nowMs: acquiredAtMs + 1_000,
  });
  const events = readEvents(stateRoot);
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    heartbeatOperationId,
  );
  const afterArchives = exactLeaseCleanupQuarantines(
    transactionPaths.after,
    heartbeatOperationId,
  );
  assert.equal(afterArchives.length, 1);
  const archivePath = afterArchives[0];
  const archiveBefore = readFileSync(archivePath);
  const identityBefore = lstatSync(archivePath, { bigint: true });
  const archiveRecord = JSON.parse(archiveBefore.toString("utf8"));
  const originalExpiry = archiveRecord.expiresAt;
  const driftedExpiry = new Date(Date.parse(originalExpiry) + 1).toISOString();
  const archiveText = archiveBefore.toString("utf8");
  const expiryOffset = archiveText.indexOf(originalExpiry);
  assert.ok(expiryOffset >= 0);
  const racedArchive = Buffer.from(
    `${archiveText.slice(0, expiryOffset)}${driftedExpiry}${archiveText.slice(
      expiryOffset + originalExpiry.length,
    )}`,
  );
  assert.equal(racedArchive.length, archiveBefore.length);
  let checkpointCount = 0;
  let racedAuthorityState;

  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events,
    checkpoint(phase) {
      if (phase !== "lease-history-before-final-revalidation") return;
      checkpointCount += 1;
      writeFileSync(archivePath, racedArchive, { mode: 0o600 });
      const identityAfter = lstatSync(archivePath, { bigint: true });
      assert.equal(identityAfter.ino, identityBefore.ino);
      assert.equal(identityAfter.size, identityBefore.size);
      racedAuthorityState = snapshotLeaseAuthorityState(stateRoot);
    },
  });
  assert.equal(checkpointCount, 1);
  assert.equal(inspection.healthy, false);
  assert.equal(inspection.pendingTransactionArtifactCount, 0);
  assert.match(inspection.issues.join("\n"), /changed after inspection/);
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), racedAuthorityState);
});

test("receipt-only lease recovery is not continuous health evidence without its completed WAL", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const acquiredAtMs = Date.parse("2026-07-19T23:00:00Z");
  const token = `receipt-only-health-${"x".repeat(40)}`;
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("receipt-only-health-acquire"),
    ttlMs: 60_000,
    nowMs: acquiredAtMs,
    token,
    actorCredentialToken,
  });
  const heartbeatOperationId = nextLeaseOperationId(
    "receipt-only-health-heartbeat",
  );
  const heartbeatOptions = {
    stateRoot,
    name,
    operationId: heartbeatOperationId,
    token,
    ttlMs: 60_000,
    nowMs: acquiredAtMs + 1_000,
  };
  heartbeatLeaseMutation(heartbeatOptions);
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    heartbeatOperationId,
  );
  assert.equal(existsSync(transactionPaths.active), false);
  const activeWalArchives = exactLeaseCleanupQuarantines(
    transactionPaths.active,
    heartbeatOperationId,
  );
  assert.equal(activeWalArchives.length, 1);
  rmSync(activeWalArchives[0]);
  assert.equal(existsSync(transactionPaths.receipt), true);
  assert.equal(existsSync(transactionPaths.before), false);
  assert.equal(existsSync(transactionPaths.after), false);
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);
  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: readEvents(stateRoot),
  });
  assert.equal(inspection.healthy, false);
  assert.equal(inspection.pendingTransactionArtifactCount, 0);
  assert.match(
    inspection.issues.join("\n"),
    /has not retired one exact completed WAL generation/,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);

  const recovered = heartbeatLeaseMutation(heartbeatOptions);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.lease.token, token);
});

test("a digest-only completed receipt and WAL rewrite fails canonical request admission", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const acquiredAtMs = Date.parse("2026-07-19T23:15:00Z");
  const token = `receipt-request-digest-drift-${"x".repeat(40)}`;
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("receipt-digest-acquire"),
    ttlMs: 60_000,
    nowMs: acquiredAtMs,
    token,
    actorCredentialToken,
  });
  const heartbeatOperationId = nextLeaseOperationId("receipt-digest-heartbeat");
  heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: heartbeatOperationId,
    token,
    ttlMs: 60_000,
    nowMs: acquiredAtMs + 1_000,
  });
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    heartbeatOperationId,
  );
  rewriteCompletedLeaseTransaction(
    transactionPaths,
    heartbeatOperationId,
    (transaction) => {
      const originalDigest = transaction.requestDigest;
      const replacementDigest = `${originalDigest[0] === "0" ? "1" : "0"}${originalDigest.slice(1)}`;
      transaction.requestDigest = replacementDigest;
      transaction.event.data.requestDigest = replacementDigest;
    },
  );
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);

  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: readEvents(stateRoot),
  });
  assert.equal(inspection.healthy, false);
  assert.equal(inspection.pendingTransactionArtifactCount, 0);
  assert.match(inspection.issues.join("\n"), /inexact canonical request/);
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);
});

test("a completed lease transaction cannot predate its preparation", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = nextLeaseOperationId("completion-before-preparation");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    nowMs: Date.parse("2026-07-20T01:05:00Z"),
    token: `completion-before-preparation-${"x".repeat(40)}`,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  );
  rewriteCompletedLeaseTransaction(
    transactionPaths,
    operationId,
    (transaction) => {
      transaction.completedAt = new Date(
        Date.parse(transaction.preparedAt) - 1,
      ).toISOString();
    },
  );
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);
  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: readEvents(stateRoot),
  });
  assert.equal(inspection.healthy, false);
  assert.match(inspection.issues.join("\n"), /unsupported shape/);
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);
});

test("a persisted lease request digest drift fails exact event binding", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = nextLeaseOperationId("persisted-event-request-drift");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    nowMs: Date.parse("2026-07-20T01:00:00Z"),
    token: `persisted-event-request-drift-${"x".repeat(40)}`,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  rewriteControlEvent(stateRoot, `lease:${operationId}`, (event) => {
    const originalDigest = event.data.requestDigest;
    event.data.requestDigest = `${originalDigest[0] === "0" ? "1" : "0"}${originalDigest.slice(1)}`;
  });
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);
  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: readEvents(stateRoot),
  });
  assert.equal(inspection.healthy, false);
  assert.match(
    inspection.issues.join("\n"),
    /does not match one exact control event/,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);
});

test("a coordinated completed release rewrite fails exact WAL lineage", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const nowMs = Date.parse("2026-07-20T01:15:00Z");
  const token = `coordinated-release-rewrite-${"x".repeat(40)}`;
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("coordinated-release-base"),
    ttlMs: 60_000,
    nowMs,
    token,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const operationId = nextLeaseOperationId("coordinated-release-rewrite");
  releaseLease({
    stateRoot,
    name,
    operationId,
    token,
    nowMs: nowMs + 1_000,
  });
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "release",
    operationId,
  );
  const earlierWalBytes = new Map(
    leaseTransactionWalArchivePaths(transactionPaths, operationId)
      .filter((archivePath) => {
        const transaction = JSON.parse(readFileSync(archivePath, "utf8"));
        return transaction.phase !== "complete";
      })
      .map((archivePath) => [archivePath, readFileSync(archivePath)]),
  );
  assert.equal(earlierWalBytes.size, 3);
  const rewritten = rewriteCompletedLeaseTransaction(
    transactionPaths,
    operationId,
    (transaction) => {
      const originalTokenDigest = transaction.request.tokenDigest;
      const replacementTokenDigest = `${originalTokenDigest[0] === "0" ? "1" : "0"}${originalTokenDigest.slice(1)}`;
      transaction.request.tokenDigest = replacementTokenDigest;
      transaction.tokenDigest = replacementTokenDigest;
      transaction.requestDigest = createHash("sha256")
        .update(JSON.stringify(canonicalTestValue(transaction.request)))
        .digest("hex");
      transaction.event.data.requestDigest = transaction.requestDigest;
    },
  );
  rewriteControlEvent(stateRoot, `lease:${operationId}`, (event) => {
    event.data.requestDigest = rewritten.transaction.requestDigest;
  });
  for (const [archivePath, bytes] of earlierWalBytes) {
    assert.deepEqual(readFileSync(archivePath), bytes);
  }
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);
  const inspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: readEvents(stateRoot),
  });
  assert.equal(inspection.healthy, false);
  assert.match(
    inspection.issues.join("\n"),
    /unknown (?:operation )?namespace(?:s)?|missing exact WAL phase lineage/,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);
});

test("completed takeover replay rejects a control event that contradicts the audited predecessor", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const acquiredAtMs = Date.parse("2026-07-19T19:00:00Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("audited-predecessor-acquire"),
    ttlMs: 1_000,
    nowMs: acquiredAtMs,
    token: `audited-predecessor-old-${"x".repeat(40)}`,
    actorCredentialToken,
  });
  const takeoverOperationId = nextLeaseOperationId(
    "audited-predecessor-takeover",
  );
  const takeoverOptions = {
    stateRoot,
    name,
    owner: actor,
    operationId: takeoverOperationId,
    ttlMs: 60_000,
    nowMs: acquiredAtMs + 1_001,
    token: `audited-predecessor-new-${"y".repeat(40)}`,
    actorCredentialToken,
  };
  const takeover = acquireLeaseMutation(takeoverOptions);
  assert.equal(takeover.takeover, true);
  assert.equal(takeover.previous.owner, actor);
  const exactEvents = readEvents(stateRoot);
  assert.deepEqual(
    exactEvents.map((event) => event.type),
    ["lease_acquired", "lease_taken_over"],
  );
  const exactInspection = inspectExactTaskLifecycleHistory(exactEvents);
  assert.equal(
    exactInspection.healthy,
    true,
    exactInspection.issues.join("\n"),
  );
  const firstAuditedTakeover = [structuredClone(exactEvents[1])];
  const firstAuditedInspection =
    inspectExactTaskLifecycleHistory(firstAuditedTakeover);
  assert.equal(
    firstAuditedInspection.healthy,
    true,
    firstAuditedInspection.issues.join("\n"),
  );
  firstAuditedTakeover[0].data.previous.owner = "freed-runtime-observer";
  const crossActorFirstInspection =
    inspectExactTaskLifecycleHistory(firstAuditedTakeover);
  assert.equal(crossActorFirstInspection.healthy, false);
  assert.match(
    crossActorFirstInspection.issues.join("\n"),
    /line 1 is not one exact canonical lease control event/,
  );
  const collapsedPreviousLifetime = structuredClone(exactEvents);
  collapsedPreviousLifetime[1].data.previous.heartbeatAt =
    collapsedPreviousLifetime[1].data.previous.expiredAt;
  const collapsedInspection = inspectExactTaskLifecycleHistory(
    collapsedPreviousLifetime,
  );
  assert.equal(collapsedInspection.healthy, false);
  assert.match(
    collapsedInspection.issues.join("\n"),
    /line 2 is not one exact canonical lease control event/,
  );
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    takeoverOperationId,
  );
  const retainedReceipt = JSON.parse(
    readFileSync(transactionPaths.receipt, "utf8"),
  );
  assert.equal(retainedReceipt.takeover.owner, actor);
  assert.equal(retainedReceipt.event.data.previous.owner, actor);

  const driftedEvents = structuredClone(exactEvents);
  driftedEvents[1].data.previous.owner = "freed-runtime-observer";
  writeFileSync(
    automationControlPaths(stateRoot).events,
    `${driftedEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    { mode: 0o600 },
  );
  const driftedInspection = inspectExactTaskLifecycleHistory(driftedEvents);
  assert.equal(driftedInspection.healthy, false);
  assert.match(
    driftedInspection.issues.join("\n"),
    /line 2 is not one exact canonical lease control event/,
  );
  const beforeReplay = snapshotLeaseAuthorityState(stateRoot);

  assert.throws(
    () => acquireLeaseMutation(takeoverOptions),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "authority_generation_conflict",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeReplay);
});

test("historical publisher scope validation is path-independent and enforces binding order", async (t) => {
  const stateRoot = temporaryStateRoot();
  const scopeWorktree = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-historical-publisher-scope-")),
  );
  t.after(() => rmSync(scopeWorktree, { recursive: true, force: true }));
  const nowMs = Date.parse("2026-07-18T20:00:00Z");
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: scopeWorktree,
    branch: "fix/historical-publisher-scope",
    base: "dev",
    baseSha: "a".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  const token = `historical-publisher-scope-${"x".repeat(40)}`;
  const acquireOperationId = nextLeaseOperationId(
    "historical-publisher-acquire",
  );
  const capability = writePublisherCapability(stateRoot, scope, {
    nowMs,
    leaseOperationId: acquireOperationId,
    token,
  });
  acquireLeaseMutation({
    stateRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    operationId: acquireOperationId,
    ttlMs: 30 * 60_000,
    nowMs,
    token,
    publisherCapabilityFile: capability.capabilityPath,
    scope,
  });
  const headSha = "b".repeat(40);
  bindPublisherLeaseHeadMutation({
    stateRoot,
    operationId: nextLeaseOperationId("historical-publisher-bind"),
    token,
    scope,
    headSha,
    nowMs: nowMs + 1_000,
  });
  bindPublisherLeaseHeadMutation({
    stateRoot,
    operationId: nextLeaseOperationId("historical-publisher-confirm"),
    token,
    scope,
    headSha,
    nowMs: nowMs + 2_000,
  });
  const exact = readEvents(stateRoot);
  assert.deepEqual(
    exact.map((event) => event.type),
    ["lease_acquired", "lease_scope_bound", "lease_scope_binding_confirmed"],
  );
  assert.equal(inspectExactTaskLifecycleHistory(exact).healthy, true);

  rmSync(scopeWorktree, { recursive: true });
  assert.equal(
    inspectExactTaskLifecycleHistory(exact).healthy,
    true,
    "historical scope validation must not require the old worktree to exist",
  );

  const invalidHistories = new Map();
  const preboundAcquisition = structuredClone(exact);
  preboundAcquisition[0].data.scope.headSha = headSha;
  invalidHistories.set("acquisition starts with a bound head", [
    preboundAcquisition[0],
  ]);

  const confirmationBeforeBinding = structuredClone(exact);
  invalidHistories.set("confirmation precedes binding", [
    confirmationBeforeBinding[0],
    confirmationBeforeBinding[2],
  ]);

  const repeatedBinding = structuredClone(exact);
  repeatedBinding[2].type = "lease_scope_bound";
  invalidHistories.set(
    "binding repeats after the head is bound",
    repeatedBinding,
  );

  const driftedConfirmation = structuredClone(exact);
  driftedConfirmation[2].data.scope.headSha = "c".repeat(40);
  invalidHistories.set(
    "confirmation changes the already-bound head",
    driftedConfirmation,
  );

  for (const [label, events] of invalidHistories) {
    const inspection = inspectExactTaskLifecycleHistory(events);
    assert.equal(inspection.healthy, false, label);
    assert.match(
      inspection.issues.join("\n"),
      /canonical (?:lease control event|publisher lease)/,
    );
  }
});

test("publisher receipts, retired authority, health, and exact replay survive worktree cleanup", (t) => {
  const stateRoot = temporaryStateRoot();
  const scopeWorktree = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-publisher-receipt-scope-")),
  );
  t.after(() => rmSync(scopeWorktree, { recursive: true, force: true }));
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: scopeWorktree,
    branch: "fix/publisher-receipt-scope",
    base: "dev",
    baseSha: "a".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  const token = `publisher-receipt-scope-${"x".repeat(40)}`;
  const acquireOperationId = nextLeaseOperationId(
    "publisher-receipt-scope-acquire",
  );
  const capability = writePublisherCapability(stateRoot, scope, {
    leaseOperationId: acquireOperationId,
    token,
  });
  const acquireOptions = {
    stateRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    operationId: acquireOperationId,
    ttlMs: 30 * 60_000,
    token,
    publisherCapabilityFile: capability.capabilityPath,
    scope,
  };
  assert.equal(acquireLeaseLive(acquireOptions).acquired, true);
  const bindOperationId = nextLeaseOperationId("publisher-receipt-scope-bind");
  const headSha = "b".repeat(40);
  const bindOptions = {
    stateRoot,
    operationId: bindOperationId,
    token,
    scope,
    headSha,
  };
  assert.equal(bindPublisherLeaseHeadLive(bindOptions).bound, true);
  const releaseOperationId = nextLeaseOperationId(
    "publisher-receipt-scope-release",
  );
  const releaseOptions = {
    stateRoot,
    name: "pr-publisher",
    operationId: releaseOperationId,
    token,
  };
  assert.equal(releaseLeaseMutation(releaseOptions).released, true);

  rmSync(scopeWorktree, { recursive: true });
  const exactEvents = readEvents(stateRoot);
  const health = inspectLeaseTransactionEventHistory({
    stateRoot,
    events: exactEvents,
  });
  assert.equal(health.healthy, true, health.issues.join("\n"));
  assert.equal(inspectLease({ stateRoot, name: "pr-publisher" }), null);
  const stableState = snapshotLeaseAuthorityState(stateRoot);
  assert.equal(acquireLeaseLive(acquireOptions).recovered, true);
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), stableState);
  assert.equal(bindPublisherLeaseHeadLive(bindOptions).recovered, true);
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), stableState);
  assert.equal(releaseLeaseMutation(releaseOptions).recovered, true);
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), stableState);

  const freshOperationId = nextLeaseOperationId(
    "publisher-receipt-scope-fresh-acquire",
  );
  const freshCapability = writePublisherCapability(stateRoot, scope, {
    leaseOperationId: freshOperationId,
    token: `${token}-fresh`,
  });
  const beforeFresh = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () =>
      acquireLeaseLive({
        ...acquireOptions,
        operationId: freshOperationId,
        token: `${token}-fresh`,
        publisherCapabilityFile: freshCapability.capabilityPath,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_scope_invalid",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeFresh);
});

test("every lease mutation and completed replay fails closed on unrelated invalid lease history", async (t) => {
  const baseNowMs = Date.parse("2026-07-19T01:00:00Z");
  const seedGeneralLease = (stateRoot, actor, label, nowMs = baseNowMs) => {
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const actorCredentialToken = writeActorCredential(stateRoot, actor);
    const token = `${label}-${"x".repeat(48)}`;
    acquireLeaseMutation({
      stateRoot,
      name,
      owner: actor,
      operationId: nextLeaseOperationId(`${label}-acquire`),
      ttlMs: 10 * 60_000,
      nowMs,
      token,
      actorCredentialToken,
    });
    return {
      actor,
      actorCredentialToken,
      name,
      sourceEvent: readEvents(stateRoot).at(-1),
      stateRoot,
      token,
    };
  };
  const seedPublisherLease = (label, nowMs = baseNowMs) => {
    const stateRoot = temporaryStateRoot();
    const scope = {
      schemaVersion: 2,
      repo: "freed-project/freed",
      worktree: realpathSync(stateRoot),
      branch: `fix/${label}`,
      base: "dev",
      baseSha: "d".repeat(40),
      headSha: null,
      publishMode: "feature-pr",
    };
    const operationId = nextLeaseOperationId(`${label}-acquire`);
    const token = `${label}-${"p".repeat(48)}`;
    const capability = writePublisherCapability(stateRoot, scope, {
      nowMs,
      leaseOperationId: operationId,
      token,
    });
    acquireLeaseMutation({
      stateRoot,
      name: "pr-publisher",
      owner: "freed-pr-publisher",
      operationId,
      ttlMs: 30 * 60_000,
      nowMs,
      token,
      publisherCapabilityFile: capability.capabilityPath,
      scope,
    });
    return {
      scope,
      sourceEvent: readEvents(stateRoot).at(-1),
      stateRoot,
      token,
    };
  };

  const scenarios = [
    {
      label: "acquire mutation",
      corruption: "duplicate",
      prepare: () => {
        const stateRoot = temporaryStateRoot();
        const sentinel = seedGeneralLease(
          stateRoot,
          "freed-runtime-observer",
          "acquire-mutation-sentinel",
        );
        const actor = "freed-release-verifier";
        const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
        const actorCredentialToken = writeActorCredential(stateRoot, actor);
        return {
          stateRoot,
          sourceEvent: sentinel.sourceEvent,
          operation: () =>
            acquireLeaseMutation({
              stateRoot,
              name,
              owner: actor,
              operationId: nextLeaseOperationId("invalid-history-acquire"),
              ttlMs: 60_000,
              nowMs: baseNowMs + 1_000,
              token: `invalid-history-acquire-${"a".repeat(40)}`,
              actorCredentialToken,
            }),
        };
      },
    },
    {
      label: "heartbeat mutation",
      corruption: "conflicting",
      prepare: () => {
        const stateRoot = temporaryStateRoot();
        const lease = seedGeneralLease(
          stateRoot,
          "freed-release-verifier",
          "heartbeat-mutation",
        );
        return {
          stateRoot,
          sourceEvent: lease.sourceEvent,
          operation: () =>
            heartbeatLeaseMutation({
              stateRoot,
              name: lease.name,
              operationId: nextLeaseOperationId("invalid-history-heartbeat"),
              token: lease.token,
              ttlMs: 60_000,
              nowMs: baseNowMs + 1_000,
            }),
        };
      },
    },
    {
      label: "publisher head-binding mutation",
      corruption: "malformed-reserved",
      prepare: () => {
        const lease = seedPublisherLease("invalid-history-bind");
        return {
          stateRoot: lease.stateRoot,
          sourceEvent: lease.sourceEvent,
          operation: () =>
            bindPublisherLeaseHeadMutation({
              stateRoot: lease.stateRoot,
              operationId: nextLeaseOperationId("invalid-history-bind"),
              token: lease.token,
              scope: lease.scope,
              headSha: "e".repeat(40),
              nowMs: baseNowMs + 1_000,
            }),
        };
      },
    },
    {
      label: "release mutation",
      corruption: "duplicate",
      prepare: () => {
        const stateRoot = temporaryStateRoot();
        const lease = seedGeneralLease(
          stateRoot,
          "freed-release-verifier",
          "release-mutation",
        );
        return {
          stateRoot,
          sourceEvent: lease.sourceEvent,
          operation: () =>
            releaseLeaseMutation({
              stateRoot,
              name: lease.name,
              operationId: nextLeaseOperationId("invalid-history-release"),
              token: lease.token,
              nowMs: baseNowMs + 1_000,
            }),
        };
      },
    },
    {
      label: "acquire replay",
      corruption: "conflicting",
      prepare: () => {
        const stateRoot = temporaryStateRoot();
        const sentinel = seedGeneralLease(
          stateRoot,
          "freed-runtime-observer",
          "acquire-replay-sentinel",
        );
        const actor = "freed-release-verifier";
        const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
        const operationId = nextLeaseOperationId(
          "invalid-history-acquire-replay",
        );
        const token = `invalid-history-acquire-replay-${"a".repeat(40)}`;
        const actorCredentialToken = writeActorCredential(stateRoot, actor);
        const options = {
          stateRoot,
          name,
          owner: actor,
          operationId,
          ttlMs: 60_000,
          nowMs: baseNowMs + 1_000,
          token,
          actorCredentialToken,
        };
        assert.throws(
          () =>
            acquireLeaseMutation({
              ...options,
              checkpoint: throwAtLeaseCheckpoint("lease-complete"),
            }),
          /lease checkpoint lease-complete/,
        );
        return {
          stateRoot,
          sourceEvent: sentinel.sourceEvent,
          operation: () =>
            acquireLeaseMutation({ ...options, nowMs: baseNowMs + 2_000 }),
        };
      },
    },
    {
      label: "heartbeat replay",
      corruption: "malformed-reserved",
      prepare: () => {
        const stateRoot = temporaryStateRoot();
        const lease = seedGeneralLease(
          stateRoot,
          "freed-release-verifier",
          "heartbeat-replay",
        );
        const operationId = nextLeaseOperationId(
          "invalid-history-heartbeat-replay",
        );
        const options = {
          stateRoot,
          name: lease.name,
          operationId,
          token: lease.token,
          ttlMs: 60_000,
          nowMs: baseNowMs + 1_000,
        };
        assert.throws(
          () =>
            heartbeatLeaseMutation({
              ...options,
              checkpoint: throwAtLeaseCheckpoint("lease-complete"),
            }),
          /lease checkpoint lease-complete/,
        );
        return {
          stateRoot,
          sourceEvent: lease.sourceEvent,
          operation: () =>
            heartbeatLeaseMutation({ ...options, nowMs: baseNowMs + 2_000 }),
        };
      },
    },
    {
      label: "publisher head-binding replay",
      corruption: "duplicate",
      prepare: () => {
        const lease = seedPublisherLease("invalid-history-bind-replay");
        const operationId = nextLeaseOperationId("invalid-history-bind-replay");
        const options = {
          stateRoot: lease.stateRoot,
          operationId,
          token: lease.token,
          scope: lease.scope,
          headSha: "f".repeat(40),
          nowMs: baseNowMs + 1_000,
        };
        assert.throws(
          () =>
            bindPublisherLeaseHeadMutation({
              ...options,
              checkpoint: throwAtLeaseCheckpoint("lease-complete"),
            }),
          /lease checkpoint lease-complete/,
        );
        return {
          stateRoot: lease.stateRoot,
          sourceEvent: lease.sourceEvent,
          operation: () =>
            bindPublisherLeaseHeadMutation({
              ...options,
              nowMs: baseNowMs + 2_000,
            }),
        };
      },
    },
    {
      label: "release replay",
      corruption: "conflicting",
      prepare: () => {
        const stateRoot = temporaryStateRoot();
        const lease = seedGeneralLease(
          stateRoot,
          "freed-release-verifier",
          "release-replay",
        );
        const operationId = nextLeaseOperationId(
          "invalid-history-release-replay",
        );
        const options = {
          stateRoot,
          name: lease.name,
          operationId,
          token: lease.token,
          nowMs: baseNowMs + 1_000,
        };
        assert.throws(
          () =>
            releaseLease({
              ...options,
              checkpoint: throwAtLeaseCheckpoint("lease-complete"),
            }),
          /lease checkpoint lease-complete/,
        );
        return {
          stateRoot,
          sourceEvent: lease.sourceEvent,
          operation: () =>
            releaseLease({ ...options, nowMs: baseNowMs + 2_000 }),
        };
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.label, () => {
      const prepared = scenario.prepare();
      appendLeaseHistoryCorruption(
        prepared.stateRoot,
        prepared.sourceEvent,
        scenario.corruption,
        scenario.label,
      );
      assertLeaseHistoryRejectsMutation(
        prepared.stateRoot,
        prepared.operation,
        scenario.label,
        scenario.label.endsWith("replay")
          ? ["authority_generation_conflict"]
          : ["control_event_history_invalid"],
      );
    });
  }
});

test("only the frozen actor-credential outcome bundle crosses the legacy history bridge", async (t) => {
  const taskId = "authenticated-essay-capture-pr-642";
  const transitionId = "11111111-2222-4333-8444-555555555555";
  const outcomeEventId =
    "outcome-recorded:16759d03db51dced7164ef0aaf9a9f53677010363b996a8cefb7ae54a2c5d9ea";
  const outcomeDigest =
    "07183438d93892d47c2e8c99cd32490d50389fe448208ff7b5450b3930cfb60f";
  const policyEvent = (actor, acquiredAt, expiresAt, operationId) => {
    const policy = AUTOMATION_ACTOR_POLICIES[actor];
    return {
      schemaVersion: 1,
      eventId: `lease:${operationId}`,
      type: "lease_acquired",
      ts: acquiredAt,
      actor,
      leaseName: policy.leaseName,
      data: {
        credentialKind: "persistent-actor",
        expiresAt,
        observerAuthority: policy.observerAuthority,
        providerAuthority: policy.providerAuthority,
        requestDigest: operationId,
        actorCredentialPath: path.resolve(
          os.tmpdir(),
          "control",
          "actor-credentials",
          `${actor}.json`,
        ),
      },
    };
  };
  const provenance = (actor, leaseAcquiredAt) => ({
    leaseName: AUTOMATION_ACTOR_POLICIES[actor].leaseName,
    leaseAcquiredAt,
    credentialKind: "persistent-actor",
  });
  const buildHistory = (ledgerPath) => {
    const controller = "freed-stability-controller";
    const scaffolding = "freed-scaffolding-maintainer";
    const controllerAcquiredAt = "2026-07-18T07:59:00.000Z";
    const scaffoldingAcquiredAt = "2026-07-18T07:59:04.000Z";
    const common = {
      schemaVersion: 1,
      taskId,
      observerAuthority: "merge-safe",
      providerAuthority: "forbidden",
    };
    const transitionLine =
      '{"schemaVersion":1,"eventId":"11111111-2222-4333-8444-555555555555","type":"task_transitioned","ts":"2026-07-18T08:00:20.000Z","actor":"freed-nightly-runner","taskId":"authenticated-essay-capture-pr-642","taskRevision":6,"manifestRevision":6,"observerAuthority":"merge-safe","providerAuthority":"forbidden","data":{"fromState":"validated","toState":"merged","authorizationProvenance":{"leaseName":"nightly-writer","leaseAcquiredAt":"2026-07-18T08:00:00.000Z","credentialKind":"actor-credential"},"outcomeDigest":"07183438d93892d47c2e8c99cd32490d50389fe448208ff7b5450b3930cfb60f","mergedAt":"2026-07-18T08:00:20.000Z"}}';
    const outcomeEventLine =
      '{"schemaVersion":1,"eventId":"outcome-recorded:16759d03db51dced7164ef0aaf9a9f53677010363b996a8cefb7ae54a2c5d9ea","type":"outcome_recorded","ts":"2026-07-18T08:00:20.000Z","actor":"freed-nightly-runner","taskId":"authenticated-essay-capture-pr-642","data":{"id":"legacy-authenticated-ordinary-outcome","taskId":"authenticated-essay-capture-pr-642","taskRevision":6,"taskState":"merged","kind":"stability","outcome":"merged","ledgerPath":"__OUTCOME_LEDGER_PATH__","leaseName":"nightly-writer","evidence":{"digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"outcomeDigest":"07183438d93892d47c2e8c99cd32490d50389fe448208ff7b5450b3930cfb60f","transitionEventId":"11111111-2222-4333-8444-555555555555"}}'.replace(
        '"__OUTCOME_LEDGER_PATH__"',
        JSON.stringify(ledgerPath),
      );
    const transition = JSON.parse(transitionLine);
    const outcomeEvent = JSON.parse(outcomeEventLine);
    const events = [
      policyEvent(
        controller,
        controllerAcquiredAt,
        "2026-07-18T08:29:00.000Z",
        "1".repeat(64),
      ),
      {
        ...common,
        eventId: "00000000-0000-4000-8000-000000000001",
        type: "task_created",
        ts: "2026-07-18T07:59:01.000Z",
        actor: controller,
        taskRevision: 1,
        manifestRevision: 1,
        data: {
          behavioral: true,
          state: "observed",
          authorizationProvenance: provenance(controller, controllerAcquiredAt),
        },
      },
      ...[
        ["observed", "triaged", 2],
        ["triaged", "approved_for_pr", 3],
      ].map(([fromState, toState, revision]) => ({
        ...common,
        eventId: `00000000-0000-4000-8000-${revision
          .toString()
          .padStart(12, "0")}`,
        type: "task_transitioned",
        ts: `2026-07-18T07:59:0${revision}.000Z`,
        actor: controller,
        taskRevision: revision,
        manifestRevision: revision,
        data: {
          fromState,
          toState,
          authorizationProvenance: provenance(controller, controllerAcquiredAt),
        },
      })),
      policyEvent(
        scaffolding,
        scaffoldingAcquiredAt,
        "2026-07-18T08:29:04.000Z",
        "2".repeat(64),
      ),
      ...[
        ["approved_for_pr", "implemented", 4, "05"],
        ["implemented", "validated", 5, "06"],
      ].map(([fromState, toState, revision, second]) => ({
        ...common,
        eventId: `00000000-0000-4000-8000-${revision
          .toString()
          .padStart(12, "0")}`,
        type: "task_transitioned",
        ts: `2026-07-18T07:59:${second}.000Z`,
        actor: scaffolding,
        taskRevision: revision,
        manifestRevision: revision,
        data: {
          fromState,
          toState,
          authorizationProvenance: provenance(
            scaffolding,
            scaffoldingAcquiredAt,
          ),
        },
      })),
      transition,
      outcomeEvent,
    ];
    return { events, transition, outcomeEvent };
  };

  const ledgerPath = path.resolve(os.tmpdir(), "pinned-legacy-outcomes.jsonl");
  const frozen = buildHistory(ledgerPath);
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(canonicalTestValue(frozen.transition)))
      .digest("hex"),
    "e45e99465a1bf906ef8d21a540c724155609d22445be95eab21702970a092cca",
  );
  const accepted = inspectExactOutcomeControlHistory(frozen.events, {
    ledgerPath,
  });
  assert.equal(accepted.healthy, true, accepted.issues.join("\n"));
  assert.deepEqual(
    [...accepted.requiredPinnedLegacyOutcomeEventIds],
    [outcomeEventId],
  );
  assert.equal(accepted.outcomes.get(outcomeEventId)?.eventId, outcomeEventId);

  await t.test(
    "rejects arbitrary merged and installed events without provenance",
    () => {
      const mergedHistory = buildHistory(ledgerPath);
      const merged = structuredClone(mergedHistory.transition);
      merged.eventId = "00000000-0000-4000-8000-000000000099";
      delete merged.data.authorizationProvenance;
      mergedHistory.events.splice(-2, 1, merged);
      assert.equal(
        inspectExactTaskLifecycleHistory(mergedHistory.events).healthy,
        false,
      );

      const installedHistory = buildHistory(ledgerPath);
      installedHistory.events.pop();
      installedHistory.events.push({
        schemaVersion: 1,
        eventId: "00000000-0000-4000-8000-000000000100",
        type: "task_transitioned",
        ts: "2026-07-18T08:00:21.000Z",
        actor: "freed-nightly-runner",
        taskId,
        taskRevision: 7,
        manifestRevision: 7,
        observerAuthority: "merge-safe",
        providerAuthority: "forbidden",
        data: {
          fromState: "merged",
          toState: "installed",
          installedAt: "2026-07-18T08:00:21.000Z",
          installedBuild: "26.7.1800",
          installedIdentity: {
            version: "26.7.1800",
            commitSha: "b".repeat(40),
            channel: "dev",
            artifactDigest: "c".repeat(64),
          },
        },
      });
      assert.equal(
        inspectExactTaskLifecycleHistory(installedHistory.events).healthy,
        false,
      );
    },
  );

  await t.test("rejects an actor-credential lookalike", () => {
    const lookalike = buildHistory(ledgerPath);
    lookalike.events.at(-2).eventId = "00000000-0000-4000-8000-000000000101";
    assert.equal(
      inspectExactTaskLifecycleHistory(lookalike.events).healthy,
      false,
    );
  });

  for (const variant of ["missing", "duplicate", "drift", "nondeterministic"]) {
    await t.test(`rejects ${variant} pinned outcome event`, () => {
      const candidate = buildHistory(ledgerPath);
      if (variant === "missing") {
        candidate.events.pop();
      } else if (variant === "duplicate") {
        candidate.events.push(structuredClone(candidate.outcomeEvent));
      } else if (variant === "drift") {
        candidate.events.at(-1).data.evidence.digest = "b".repeat(64);
      } else {
        candidate.events.at(-1).eventId =
          "00000000-0000-4000-8000-000000000102";
      }
      const inspection = inspectExactOutcomeControlHistory(candidate.events, {
        ledgerPath,
      });
      assert.equal(inspection.healthy, false);
      assert.equal(
        inspection.requiredPinnedLegacyOutcomeEventIds.has(outcomeEventId),
        true,
      );
    });
  }

  assert.equal(
    outcomeRecordedEventId({
      taskId,
      taskRevision: 6,
      outcomeDigest,
      transitionEventId: transitionId,
    }),
    outcomeEventId,
  );
});

test("shared outcome history enforces exact records, evidence, ledger identity, policy, and scope", async (t) => {
  const ledgerPath = path.resolve(
    os.tmpdir(),
    "freed-shared-outcome-history.jsonl",
  );
  let eventSequence = 0;
  const nextEventId = () => {
    eventSequence += 1;
    return `00000000-0000-4000-8000-${eventSequence
      .toString(16)
      .padStart(12, "0")}`;
  };
  const leaseAcquisition = (actor, leaseAcquiredAt) => {
    const policy = AUTOMATION_ACTOR_POLICIES[actor];
    return {
      schemaVersion: 1,
      eventId: `lease:${createHash("sha256")
        .update(`${actor}:${leaseAcquiredAt}`)
        .digest("hex")}`,
      type: "lease_acquired",
      ts: leaseAcquiredAt,
      actor,
      leaseName: policy.leaseName,
      data: {
        credentialKind: "persistent-actor",
        expiresAt: "2026-07-19T12:30:00.000Z",
        observerAuthority: policy.observerAuthority,
        providerAuthority: policy.providerAuthority,
        requestDigest: createHash("sha256")
          .update(`request:${actor}:${leaseAcquiredAt}`)
          .digest("hex"),
        actorCredentialPath: path.resolve(
          os.tmpdir(),
          "control",
          "actor-credentials",
          `${actor}.json`,
        ),
      },
    };
  };
  const authorizationProvenance = (actor, leaseAcquiredAt) => ({
    leaseName: AUTOMATION_ACTOR_POLICIES[actor].leaseName,
    leaseAcquiredAt,
    credentialKind: "persistent-actor",
  });
  const canonicalOutcomeHistory = ({ actor, outcome, evidence }) => {
    const creator =
      actor === "freed-scaffolding-maintainer"
        ? actor
        : "freed-stability-controller";
    const leaseAcquiredAt = "2026-07-19T12:00:00.000Z";
    const taskId = `shared-${actor}-${outcome}`;
    const observerAuthority =
      AUTOMATION_ACTOR_POLICIES[creator].observerAuthority;
    const providerAuthority = "forbidden";
    const outcomeDigest = createHash("sha256")
      .update(`${taskId}:${outcome}`)
      .digest("hex");
    const creationEvent = {
      schemaVersion: 1,
      eventId: nextEventId(),
      type: "task_created",
      ts: "2026-07-19T12:00:01.000Z",
      actor: creator,
      taskId,
      taskRevision: 1,
      manifestRevision: 1,
      observerAuthority,
      providerAuthority,
      data: {
        behavioral: true,
        state: "observed",
        authorizationProvenance: authorizationProvenance(
          creator,
          leaseAcquiredAt,
        ),
      },
    };
    const transitionEvent = {
      schemaVersion: 1,
      eventId: nextEventId(),
      type: "task_transitioned",
      ts: "2026-07-19T12:00:02.000Z",
      actor,
      taskId,
      taskRevision: 2,
      manifestRevision: 2,
      observerAuthority,
      providerAuthority,
      data: {
        fromState: "observed",
        toState: outcome,
        outcomeRequired: true,
        outcomeDigest,
        authorizationProvenance: authorizationProvenance(
          actor,
          leaseAcquiredAt,
        ),
      },
    };
    const outcomeEvent = {
      schemaVersion: 1,
      eventId: outcomeRecordedEventId({
        taskId,
        taskRevision: transitionEvent.taskRevision,
        outcomeDigest,
        transitionEventId: transitionEvent.eventId,
      }),
      type: "outcome_recorded",
      ts: "2026-07-19T12:00:03.000Z",
      actor,
      taskId,
      data: {
        ledgerPath,
        leaseName: AUTOMATION_ACTOR_POLICIES[actor].leaseName,
        id: taskId,
        taskId,
        taskRevision: transitionEvent.taskRevision,
        taskState: outcome,
        kind: "stability",
        outcome,
        outcomeDigest,
        transitionEventId: transitionEvent.eventId,
        evidence,
      },
    };
    return [
      leaseAcquisition(creator, leaseAcquiredAt),
      ...(actor === creator ? [] : [leaseAcquisition(actor, leaseAcquiredAt)]),
      creationEvent,
      transitionEvent,
      outcomeEvent,
    ];
  };

  for (const policyCase of [
    {
      actor: "freed-scaffolding-maintainer",
      outcome: "governance_blocked",
    },
    { actor: "freed-nightly-runner", outcome: "superseded" },
  ]) {
    await t.test(`${policyCase.actor} may record ${policyCase.outcome}`, () => {
      const events = canonicalOutcomeHistory({
        ...policyCase,
        evidence: { digest: "a".repeat(64) },
      });
      const inspection = inspectExactOutcomeControlHistory(events, {
        ledgerPath,
      });
      assert.equal(inspection.healthy, true, inspection.issues.join("\n"));
      assert.equal(inspection.outcomes.size, 1);
      assert.equal(inspection.transitions.size, 1);
    });
  }

  const heartbeatExtendedHistory = () => {
    const events = canonicalOutcomeHistory({
      actor: "freed-scaffolding-maintainer",
      outcome: "governance_blocked",
      evidence: { digest: "9".repeat(64) },
    });
    const acquisition = events.find(
      (event) =>
        event.type === "lease_acquired" &&
        event.actor === "freed-scaffolding-maintainer",
    );
    assert.ok(acquisition);
    acquisition.data.expiresAt = "2026-07-19T12:00:02.500Z";
    const outcomeIndex = events.findIndex(
      (event) => event.type === "outcome_recorded",
    );
    assert.notEqual(outcomeIndex, -1);
    const heartbeat = {
      schemaVersion: 1,
      eventId: `lease:${"9".repeat(64)}`,
      type: "lease_heartbeat",
      ts: "2026-07-19T12:00:02.250Z",
      actor: "freed-scaffolding-maintainer",
      leaseName:
        AUTOMATION_ACTOR_POLICIES["freed-scaffolding-maintainer"].leaseName,
      data: {
        expiresAt: "2026-07-19T12:00:04.000Z",
        requestDigest: "9".repeat(64),
      },
    };
    events.splice(outcomeIndex, 0, heartbeat);
    const transition = events.find(
      (event) =>
        event.type === "task_transitioned" &&
        event.data?.toState === "governance_blocked",
    );
    assert.ok(transition);
    const finalized = {
      schemaVersion: 1,
      eventId: "00000000-0000-4000-8000-00000000f001",
      type: "outcome_reservation_finalized",
      ts: "2026-07-19T12:00:03.500Z",
      actor: transition.actor,
      taskId: transition.taskId,
      taskRevision: transition.taskRevision,
      manifestRevision: transition.manifestRevision + 1,
      observerAuthority: transition.observerAuthority,
      providerAuthority: transition.providerAuthority,
      data: {
        outcome: transition.data.toState,
        outcomeDigest: transition.data.outcomeDigest,
        taskRevision: transition.taskRevision,
      },
    };
    events.push(finalized);
    return { events, heartbeat, finalized };
  };
  const canonicalLeaseRelease = (timestamp) => ({
    schemaVersion: 1,
    eventId: `lease:${createHash("sha256")
      .update(`release-event:${timestamp}`)
      .digest("hex")}`,
    type: "lease_released",
    ts: timestamp,
    actor: "freed-scaffolding-maintainer",
    leaseName:
      AUTOMATION_ACTOR_POLICIES["freed-scaffolding-maintainer"].leaseName,
    data: {
      expired: false,
      requestDigest: createHash("sha256")
        .update(`release-request:${timestamp}`)
        .digest("hex"),
    },
  });

  await t.test(
    "reconstructs one canonical heartbeat for outcome recording and finalization",
    () => {
      const fixture = heartbeatExtendedHistory();
      const inspection = inspectExactOutcomeControlHistory(fixture.events, {
        ledgerPath,
      });
      assert.equal(inspection.healthy, true, inspection.issues.join("\n"));
      assert.equal(inspection.outcomes.size, 1);
    },
  );

  for (const variant of [
    "outcome before acquisition",
    "outcome at expiry",
    "finalization before acquisition",
    "finalization at expiry",
    "duplicate heartbeat",
    "noncanonical heartbeat",
    "heartbeat at prior expiry",
    "heartbeat beyond absolute lifetime",
    "outcome after release without reacquire",
    "finalization after release without reacquire",
  ]) {
    await t.test(`rejects ${variant} in continuous outcome history`, () => {
      const fixture = heartbeatExtendedHistory();
      const outcome = fixture.events.find(
        (event) => event.type === "outcome_recorded",
      );
      assert.ok(outcome);
      if (variant === "outcome before acquisition") {
        outcome.ts = "2026-07-19T11:59:59.999Z";
      } else if (variant === "outcome at expiry") {
        outcome.ts = fixture.heartbeat.data.expiresAt;
      } else if (variant === "finalization before acquisition") {
        fixture.finalized.ts = "2026-07-19T11:59:59.999Z";
      } else if (variant === "finalization at expiry") {
        fixture.finalized.ts = fixture.heartbeat.data.expiresAt;
      } else if (variant === "duplicate heartbeat") {
        const heartbeatIndex = fixture.events.indexOf(fixture.heartbeat);
        fixture.events.splice(
          heartbeatIndex + 1,
          0,
          structuredClone(fixture.heartbeat),
        );
      } else if (variant === "noncanonical heartbeat") {
        fixture.heartbeat.ts = fixture.heartbeat.ts.replace(/Z$/, "+00:00");
      } else if (variant === "heartbeat at prior expiry") {
        fixture.heartbeat.ts = "2026-07-19T12:00:02.500Z";
      } else if (variant === "heartbeat beyond absolute lifetime") {
        fixture.heartbeat.data.expiresAt = "2026-07-19T12:30:00.001Z";
      } else if (variant === "outcome after release without reacquire") {
        const outcomeIndex = fixture.events.indexOf(outcome);
        assert.notEqual(outcomeIndex, -1);
        fixture.events.splice(
          outcomeIndex,
          0,
          canonicalLeaseRelease("2026-07-19T12:00:02.750Z"),
        );
        fixture.events.splice(fixture.events.indexOf(fixture.finalized), 1);
      } else {
        const finalizedIndex = fixture.events.indexOf(fixture.finalized);
        assert.notEqual(finalizedIndex, -1);
        fixture.events.splice(
          finalizedIndex,
          0,
          canonicalLeaseRelease("2026-07-19T12:00:03.250Z"),
        );
      }
      const inspection = inspectExactOutcomeControlHistory(fixture.events, {
        ledgerPath,
      });
      assert.equal(inspection.healthy, false);
      if (variant === "outcome after release without reacquire") {
        assert.equal(
          inspection.leaseHistoryHealthy,
          true,
          inspection.leaseHistoryIssues.join("\n"),
        );
        assert.match(
          inspection.issues.join("\n"),
          /has no exact preceding canonical outcome transition/,
        );
      } else if (variant === "finalization after release without reacquire") {
        assert.equal(
          inspection.leaseHistoryHealthy,
          true,
          inspection.leaseHistoryIssues.join("\n"),
        );
        assert.match(
          inspection.issues.join("\n"),
          /is not the exact completion of its task outcome reservation/,
        );
      }
    });
  }

  const canonicalEvents = canonicalOutcomeHistory({
    actor: "freed-scaffolding-maintainer",
    outcome: "governance_blocked",
    evidence: { digest: "b".repeat(64) },
  });
  const outcomeIndex = canonicalEvents.findIndex(
    (event) => event.type === "outcome_recorded",
  );
  assert.notEqual(outcomeIndex, -1);
  for (const evidenceCase of [
    { label: "empty", evidence: {} },
    {
      label: "extra key",
      evidence: { digest: "b".repeat(64), unexpected: true },
    },
    { label: "uppercase digest", evidence: { digest: "B".repeat(64) } },
    {
      label: "padded verdict reference",
      evidence: { verdictReference: " /tmp/outcome-verdict.json " },
    },
    {
      label: "missing digest or reference",
      evidence: { verdictFingerprint: "c".repeat(64) },
    },
  ]) {
    await t.test(`rejects ${evidenceCase.label} evidence`, () => {
      const events = structuredClone(canonicalEvents);
      events[outcomeIndex].data.evidence = evidenceCase.evidence;
      const inspection = inspectExactOutcomeControlHistory(events, {
        ledgerPath,
      });
      assert.equal(inspection.healthy, false);
      assert.match(
        inspection.issues.join("\n"),
        new RegExp(`line ${(outcomeIndex + 1).toLocaleString()}`),
      );
    });
  }

  await t.test("rejects a different absolute ledger path", () => {
    const inspection = inspectExactOutcomeControlHistory(canonicalEvents, {
      ledgerPath: path.resolve(os.tmpdir(), "other-outcomes.jsonl"),
    });
    assert.equal(inspection.healthy, false);
    assert.match(
      inspection.issues.join("\n"),
      new RegExp(`line ${(outcomeIndex + 1).toLocaleString()}`),
    );
  });

  await t.test(
    "preserves malformed and blank parser sentinels by physical line",
    () => {
      const events = structuredClone(canonicalEvents);
      events.splice(1, 0, null);
      events.splice(3, 0, "\r");
      const inspection = inspectExactOutcomeControlHistory(events, {
        ledgerPath,
      });
      assert.equal(inspection.healthy, false);
      assert.match(
        inspection.issues.join("\n"),
        /line 2 is not one control event object/,
      );
      assert.match(
        inspection.issues.join("\n"),
        /line 4 is not one control event object/,
      );
    },
  );

  await t.test("rejects a sparse physical event slot", () => {
    const events = new Array(1);
    const inspection = inspectExactOutcomeControlHistory(events, {
      ledgerPath,
    });
    assert.equal(inspection.healthy, false);
    assert.match(
      inspection.issues.join("\n"),
      /line 1 is not one control event object/,
    );
  });

  await t.test("excludes ordinary non-outcome transitions", () => {
    const actor = "freed-stability-controller";
    const policy = AUTOMATION_ACTOR_POLICIES[actor];
    const leaseAcquiredAt = "2026-07-19T12:00:00.000Z";
    const events = [
      leaseAcquisition(actor, leaseAcquiredAt),
      {
        schemaVersion: 1,
        eventId: nextEventId(),
        type: "task_created",
        ts: "2026-07-19T12:00:01.000Z",
        actor,
        taskId: "shared-ordinary-transition",
        taskRevision: 1,
        manifestRevision: 1,
        observerAuthority: policy.observerAuthority,
        providerAuthority: policy.providerAuthority,
        data: {
          behavioral: false,
          state: "observed",
          authorizationProvenance: authorizationProvenance(
            actor,
            leaseAcquiredAt,
          ),
        },
      },
      {
        schemaVersion: 1,
        eventId: nextEventId(),
        type: "task_transitioned",
        ts: "2026-07-19T12:00:02.000Z",
        actor,
        taskId: "shared-ordinary-transition",
        taskRevision: 2,
        manifestRevision: 2,
        observerAuthority: policy.observerAuthority,
        providerAuthority: policy.providerAuthority,
        data: {
          fromState: "observed",
          toState: "triaged",
          authorizationProvenance: authorizationProvenance(
            actor,
            leaseAcquiredAt,
          ),
        },
      },
    ];
    const inspection = inspectExactOutcomeControlHistory(events, {
      ledgerPath,
    });
    assert.equal(inspection.healthy, true, inspection.issues.join("\n"));
    assert.equal(inspection.transitions.size, 0);
    assert.equal(inspection.outcomes.size, 0);
  });
});

test("freed-owner outcome event and finalization steps require one composite guard", () => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  const nowMs = Date.now();
  const taskId = "owner-outcome-step-boundary";
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs,
  });
  const snapshot = () => ({
    manifest: readFileSync(paths.taskManifest),
    events: readFileSync(paths.events),
    outcomes: existsSync(paths.outcomes) ? readFileSync(paths.outcomes) : null,
    taskTransactions: existsSync(paths.taskTransactions)
      ? Object.fromEntries(
          readdirSync(paths.taskTransactions)
            .sort()
            .map((name) => {
              const entryPath = path.join(paths.taskTransactions, name);
              try {
                return [name, readFileSync(entryPath)];
              } catch (error) {
                if (error?.code === "EISDIR") return [name, null];
                throw error;
              }
            }),
        )
      : {},
  });
  const eventId = "owner-outcome-step-event";
  const eventData = { id: taskId };
  const ownerEvent = actorLease(stateRoot, "freed-owner", {
    nowMs: nowMs + 1,
    token: "owner-outcome-event-token",
    ownerTaskId: taskId,
    ownerIntentDigest: ownerIntent("event.append", taskId, {
      type: "outcome_recorded",
      data: eventData,
    }),
  });
  const beforeEvent = snapshot();
  assert.throws(
    () =>
      appendOutcomeControlEvent({
        stateRoot,
        taskId,
        ...ownerEvent,
        eventId,
        data: eventData,
        nowMs: nowMs + 2,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_intent_required",
  );
  assert.deepEqual(snapshot(), beforeEvent);
  releaseLease({
    stateRoot,
    name: ownerEvent.leaseName,
    token: ownerEvent.leaseToken,
    nowMs: nowMs + 3,
  });

  const outcomeDigest = "a".repeat(64);
  const ownerFinalize = actorLease(stateRoot, "freed-owner", {
    nowMs: nowMs + 4,
    token: "owner-outcome-finalize-token",
    ownerTaskId: taskId,
    ownerIntentDigest: ownerIntent("task.finalize-outcome", taskId, {
      outcome: "merged",
      outcomeDigest,
      taskRevision: 1,
    }),
  });
  const beforeFinalize = snapshot();
  assert.throws(
    () =>
      finalizeTaskOutcome({
        stateRoot,
        taskId,
        ...ownerFinalize,
        outcome: "merged",
        outcomeDigest,
        taskRevision: 1,
        nowMs: nowMs + 5,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_intent_required",
  );
  assert.deepEqual(snapshot(), beforeFinalize);
});

test("outcome finalization admits canonical ledger and event snapshots safely", async (t) => {
  const prepareValidatedTask = (stateRoot, taskId, nowMs) => {
    const controller = actorLease(stateRoot, "freed-stability-controller", {
      nowMs,
    });
    const scaffolding = actorLease(stateRoot, "freed-scaffolding-maintainer", {
      nowMs,
    });
    const runner = actorLease(stateRoot, "freed-nightly-runner", { nowMs });
    createTask({
      stateRoot,
      taskId,
      ...controller,
      observerAuthority: "merge-safe",
      providerAuthority: "forbidden",
      details: { behavioral: false },
      nowMs: nowMs + 1,
    });
    transitionTask({
      stateRoot,
      taskId,
      ...controller,
      toState: "triaged",
      nowMs: nowMs + 2,
    });
    transitionTask({
      stateRoot,
      taskId,
      ...controller,
      toState: "approved_for_pr",
      nowMs: nowMs + 3,
    });
    transitionTask({
      stateRoot,
      taskId,
      ...scaffolding,
      toState: "implemented",
      nowMs: nowMs + 4,
    });
    transitionTask({
      stateRoot,
      taskId,
      ...scaffolding,
      toState: "validated",
      nowMs: nowMs + 5,
    });
    return runner;
  };

  for (const shape of [
    "ledger-mode",
    "ledger-symlink",
    "ledger-hardlink",
    "ledger-invalid-utf8",
    "ledger-oversize",
    "events-mode",
    "events-hardlink",
    "events-blank-line",
    "events-fifo",
  ]) {
    await t.test(shape, () => {
      const stateRoot = temporaryStateRoot();
      const taskId = `safe-outcome-finalization-${shape}`;
      const nowMs = Date.now();
      const runner = prepareValidatedTask(stateRoot, taskId, nowMs);
      let manifestBefore;
      let hostileTarget = null;
      assert.throws(
        () =>
          completeGuardedOutcome({
            stateRoot,
            taskId,
            authentication: runner,
            outcome: "merged",
            nowMs: nowMs + 6,
            beforeFinalize: ({ paths }) => {
              manifestBefore = readFileSync(paths.taskManifest);
              if (shape.startsWith("events-")) {
                retireReadyAuthorityWitnessForLegacyFixture(paths.events);
              }
              if (shape === "ledger-mode") {
                chmodSync(paths.outcomes, 0o660);
              } else if (shape === "ledger-symlink") {
                hostileTarget = path.join(
                  stateRoot,
                  "redirected-outcomes.jsonl",
                );
                renameSync(paths.outcomes, hostileTarget);
                symlinkSync(hostileTarget, paths.outcomes);
              } else if (shape === "ledger-hardlink") {
                hostileTarget = path.join(stateRoot, "linked-outcomes.jsonl");
                linkSync(paths.outcomes, hostileTarget);
              } else if (shape === "ledger-invalid-utf8") {
                writeFileSync(paths.outcomes, Buffer.from([0xff]), {
                  mode: 0o600,
                });
              } else if (shape === "ledger-oversize") {
                truncateSync(
                  paths.outcomes,
                  OUTCOME_LEDGER_REPAIR_MAX_BYTES + 1,
                );
              } else if (shape === "events-mode") {
                chmodSync(paths.events, 0o640);
              } else if (shape === "events-hardlink") {
                hostileTarget = path.join(stateRoot, "linked-events.jsonl");
                linkSync(paths.events, hostileTarget);
              } else if (shape === "events-blank-line") {
                appendFileSync(paths.events, "\n");
              } else {
                rmSync(paths.events);
                execFileSync("mkfifo", [paths.events]);
                chmodSync(paths.events, 0o600);
              }
            },
          }),
        (error) =>
          isAutomationControlError(error) &&
          error.code ===
            (shape.startsWith("events-")
              ? "authority_generation_conflict"
              : "outcome_not_durable"),
      );
      const paths = automationControlPaths(stateRoot);
      assert.deepEqual(readFileSync(paths.taskManifest), manifestBefore);
      if (shape === "ledger-symlink") {
        assert.equal(lstatSync(paths.outcomes).isSymbolicLink(), true);
        assert.equal(existsSync(hostileTarget), true);
      }
      if (shape === "ledger-hardlink") {
        assert.equal(lstatSync(paths.outcomes).nlink, 2);
        assert.equal(existsSync(hostileTarget), true);
      }
      if (shape === "events-hardlink") {
        assert.equal(lstatSync(paths.events).nlink, 2);
        assert.equal(existsSync(hostileTarget), true);
      }
      if (shape === "events-fifo") {
        assert.equal(lstatSync(paths.events).isFIFO(), true);
      }
    });
  }
});

test("outcome finalization rejects inexact history without mutating the manifest", async (t) => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  const nowMs = Date.now();
  const taskId = "finalize-exact-history";
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  const scaffolding = actorLease(stateRoot, "freed-scaffolding-maintainer", {
    nowMs,
  });
  const runner = actorLease(stateRoot, "freed-nightly-runner", { nowMs });
  createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nowMs + 1,
  });
  transitionTask({
    stateRoot,
    taskId,
    ...controller,
    toState: "triaged",
    nowMs: nowMs + 2,
  });
  transitionTask({
    stateRoot,
    taskId,
    ...controller,
    toState: "approved_for_pr",
    nowMs: nowMs + 3,
  });
  transitionTask({
    stateRoot,
    taskId,
    ...scaffolding,
    toState: "implemented",
    nowMs: nowMs + 4,
  });
  transitionTask({
    stateRoot,
    taskId,
    ...scaffolding,
    toState: "validated",
    nowMs: nowMs + 5,
  });

  const evidence = { digest: "7".repeat(64) };
  const cleanEntry = {
    schemaVersion: 3,
    ts: new Date(nowMs + 6).toISOString(),
    id: taskId,
    taskId,
    kind: "stability",
    outcome: "merged",
    notes: "",
    evidence,
  };
  const outcomeDigest = createHash("sha256")
    .update(JSON.stringify(cleanEntry))
    .digest("hex");
  const pending = withTestOutcomeRecordingGuards(
    { stateRoot, taskId, authentication: runner, nowMs: nowMs + 6 },
    (control) => {
      const transition = control.transitionTask({
        stateRoot,
        taskId,
        ...runner,
        toState: "merged",
        details: {
          behavioral: false,
          latestOutcome: {
            outcome: "merged",
            evidence,
            outcomeDigest,
            recordedAt: cleanEntry.ts,
          },
        },
        nowMs: nowMs + 6,
      });
      const controlEventId = outcomeRecordedEventId({
        taskId,
        taskRevision: transition.task.revision,
        outcomeDigest,
        transitionEventId: transition.event.eventId,
      });
      control.appendOutcomeControlEvent({
        stateRoot,
        taskId,
        ...runner,
        eventId: controlEventId,
        data: {
          ledgerPath: paths.outcomes,
          leaseName: runner.leaseName,
          id: cleanEntry.id,
          taskId,
          taskRevision: transition.task.revision,
          taskState: "merged",
          kind: cleanEntry.kind,
          outcome: "merged",
          outcomeDigest,
          transitionEventId: transition.event.eventId,
          evidence,
        },
        nowMs: nowMs + 6,
      });
      appendFileSync(
        paths.outcomes,
        `${JSON.stringify({
          ...cleanEntry,
          authentication: {
            actor: runner.actor,
            leaseName: runner.leaseName,
            controlEventId,
            transitionEventId: transition.event.eventId,
            outcomeDigest,
            taskRevision: transition.task.revision,
          },
        })}\n`,
        { mode: 0o600 },
      );
      return { transition, controlEventId };
    },
  );

  const observer = actorLease(stateRoot, "freed-runtime-observer", {
    nowMs: nowMs + 7,
  });
  createTask({
    stateRoot,
    taskId: "finalize-other-task",
    ...observer,
    observerAuthority: "observe-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nowMs + 8,
  });

  retireReadyAuthorityWitnessForLegacyFixture(paths.events);

  const canonicalEvents = readEvents(stateRoot);
  const canonicalEventBytes = readFileSync(paths.events);
  const canonicalLedgerEntries = readFileSync(paths.outcomes, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const canonicalLedgerBytes = readFileSync(paths.outcomes);
  const canonicalManifestBytes = readFileSync(paths.taskManifest);
  const canonicalTransactions = existsSync(paths.taskTransactions)
    ? readdirSync(paths.taskTransactions).sort()
    : [];

  const cases = [
    {
      name: "extra control event key",
      mutate(events, ledgerEntries, indexes) {
        events[indexes.control].unexpected = true;
      },
    },
    {
      name: "duplicate control event identity",
      mutate(events, ledgerEntries, indexes) {
        events.push(structuredClone(events[indexes.control]));
      },
    },
    {
      name: "noncanonical deterministic control identity",
      mutate(events, ledgerEntries, indexes) {
        const eventId = "11111111-2222-4333-8444-555555555555";
        events[indexes.control].eventId = eventId;
        ledgerEntries[0].authentication.controlEventId = eventId;
      },
    },
    {
      name: "invalid transition provenance",
      mutate(events, ledgerEntries, indexes) {
        events[indexes.transition].data.authorizationProvenance.leaseName =
          "release-verifier";
      },
    },
    {
      name: "empty outcome evidence",
      mutate(events, ledgerEntries, indexes) {
        events[indexes.control].data.evidence = {};
      },
    },
    {
      name: "extra outcome evidence key",
      mutate(events, ledgerEntries, indexes) {
        events[indexes.control].data.evidence.unexpected = true;
      },
    },
    {
      name: "uppercase outcome evidence digest",
      mutate(events, ledgerEntries, indexes) {
        events[indexes.control].data.evidence.digest = "A".repeat(64);
      },
    },
    {
      name: "padded outcome verdict reference",
      mutate(events, ledgerEntries, indexes) {
        events[indexes.control].data.evidence = {
          verdictReference: " /tmp/outcome-verdict.json ",
        };
      },
    },
    {
      name: "future persistent actor acquisition",
      mutate(events, ledgerEntries, indexes) {
        const transition = events[indexes.transition];
        const futureTimestamp = new Date(
          Date.parse(transition.ts) + 1_000,
        ).toISOString();
        const acquisition = events.find(
          (event) =>
            event.type === "lease_acquired" &&
            event.actor === transition.actor &&
            event.leaseName ===
              transition.data.authorizationProvenance.leaseName &&
            event.ts ===
              transition.data.authorizationProvenance.leaseAcquiredAt,
        );
        assert.ok(acquisition);
        acquisition.ts = futureTimestamp;
        transition.data.authorizationProvenance.leaseAcquiredAt =
          futureTimestamp;
      },
    },
    {
      name: "transition authority mismatch",
      mutate(events, ledgerEntries, indexes) {
        events[indexes.transition].observerAuthority = "observe-only";
      },
    },
    {
      name: "wrong physical ordering",
      mutate(events, ledgerEntries, indexes) {
        const [controlEvent] = events.splice(indexes.control, 1);
        const transitionIndex = events.findIndex(
          (event) => event.eventId === pending.transition.event.eventId,
        );
        events.splice(transitionIndex, 0, controlEvent);
      },
    },
    {
      name: "lifecycle state discontinuity",
      mutate(events, ledgerEntries, indexes) {
        events[indexes.transition].data.fromState = "observed";
      },
    },
    {
      name: "lifecycle revision discontinuity",
      mutate(events, ledgerEntries, indexes) {
        events[indexes.transition].taskRevision += 1;
      },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      const events = structuredClone(canonicalEvents);
      const ledgerEntries = structuredClone(canonicalLedgerEntries);
      const indexes = {
        transition: events.findIndex(
          (event) => event.eventId === pending.transition.event.eventId,
        ),
        control: events.findIndex(
          (event) => event.eventId === pending.controlEventId,
        ),
      };
      assert.notEqual(indexes.transition, -1);
      assert.notEqual(indexes.control, -1);
      testCase.mutate(events, ledgerEntries, indexes);
      const historyInspection = inspectExactOutcomeControlHistory(events, {
        ledgerPath: paths.outcomes,
      });
      assert.equal(
        historyInspection.healthy,
        false,
        `${testCase.name} unexpectedly retained a healthy history`,
      );
      writeFileSync(
        paths.events,
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        { mode: 0o600 },
      );
      writeFileSync(
        paths.outcomes,
        `${ledgerEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        { mode: 0o600 },
      );
      const tamperedEventBytes = readFileSync(paths.events);
      const tamperedLedgerBytes = readFileSync(paths.outcomes);
      assert.throws(
        () =>
          withTestOutcomeRecordingGuards(
            { stateRoot, taskId, authentication: runner, nowMs: nowMs + 9 },
            (control) =>
              control.finalizeTaskOutcome({
                stateRoot,
                taskId,
                ...runner,
                outcome: "merged",
                outcomeDigest,
                taskRevision: pending.transition.task.revision,
                nowMs: nowMs + 9,
              }),
          ),
        (error) =>
          isAutomationControlError(error) &&
          ["authority_generation_conflict", "outcome_not_durable"].includes(
            error.code,
          ),
      );
      assert.deepEqual(
        readFileSync(paths.taskManifest),
        canonicalManifestBytes,
      );
      assert.deepEqual(readFileSync(paths.events), tamperedEventBytes);
      assert.deepEqual(readFileSync(paths.outcomes), tamperedLedgerBytes);
      assert.deepEqual(
        existsSync(paths.taskTransactions)
          ? readdirSync(paths.taskTransactions).sort()
          : [],
        canonicalTransactions,
      );
      writeFileSync(paths.events, canonicalEventBytes, { mode: 0o600 });
      writeFileSync(paths.outcomes, canonicalLedgerBytes, { mode: 0o600 });
    });
  }

  const finalized = withTestOutcomeRecordingGuards(
    { stateRoot, taskId, authentication: runner, nowMs: nowMs + 9 },
    (control) =>
      control.finalizeTaskOutcome({
        stateRoot,
        taskId,
        ...runner,
        outcome: "merged",
        outcomeDigest,
        taskRevision: pending.transition.task.revision,
        nowMs: nowMs + 9,
      }),
  );
  assert.equal(finalized.changed, true);
  assert.equal(finalized.task.pendingOutcome, undefined);
});

test("legacy backfill finalization rejects a tampered reservation event ID", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const taskId = "backfill-reservation-event-id";
  const fixture = prepareLegacyOutcomeBackfillFixture({
    stateRoot,
    taskId,
    outcome: "merged",
    nowMs,
  });
  const evidence = { digest: "c".repeat(64) };
  const cleanEntry = {
    schemaVersion: 3,
    ts: new Date(nowMs + 100).toISOString(),
    id: taskId,
    taskId,
    kind: "stability",
    outcome: "merged",
    notes: "",
    evidence,
  };
  const outcomeDigest = createHash("sha256")
    .update(JSON.stringify(cleanEntry))
    .digest("hex");
  let reservation;
  let controlEventId;
  withTestOutcomeRecordingGuards(
    {
      stateRoot,
      taskId,
      authentication: fixture.authentication,
      nowMs: nowMs + 100,
    },
    (control) => {
      reservation = control.reserveCurrentTaskOutcome({
        stateRoot,
        taskId,
        ...fixture.authentication,
        outcome: "merged",
        legacyTransitionEventId: fixture.legacyTransitionEventId,
        expectedRevision: fixture.task.revision,
        details: {
          latestOutcome: {
            outcome: "merged",
            evidence,
            outcomeDigest,
            recordedAt: cleanEntry.ts,
          },
        },
        nowMs: nowMs + 100,
      });
      controlEventId = outcomeRecordedEventId({
        taskId,
        taskRevision: reservation.task.revision,
        outcomeDigest,
        transitionEventId: reservation.event.eventId,
      });
      control.appendOutcomeControlEvent({
        stateRoot,
        taskId,
        ...fixture.authentication,
        eventId: controlEventId,
        data: {
          ledgerPath: fixture.paths.outcomes,
          leaseName: fixture.authentication.leaseName,
          id: cleanEntry.id,
          taskId,
          taskRevision: reservation.task.revision,
          taskState: "merged",
          kind: cleanEntry.kind,
          outcome: "merged",
          outcomeDigest,
          transitionEventId: reservation.event.eventId,
          evidence,
        },
        nowMs: nowMs + 100,
      });
      appendFileSync(
        fixture.paths.outcomes,
        `${JSON.stringify({
          ...cleanEntry,
          authentication: {
            actor: fixture.authentication.actor,
            leaseName: fixture.authentication.leaseName,
            controlEventId,
            transitionEventId: reservation.event.eventId,
            outcomeDigest,
            taskRevision: reservation.task.revision,
          },
        })}\n`,
        { mode: 0o600 },
      );
    },
  );

  const tamperedEventId = `task-outcome-reserved:${"d".repeat(64)}`;
  const events = readEvents(stateRoot);
  const reservationEvent = events.find(
    (event) => event.eventId === reservation.event.eventId,
  );
  const outcomeEvent = events.find((event) => event.eventId === controlEventId);
  reservationEvent.eventId = tamperedEventId;
  outcomeEvent.data.transitionEventId = tamperedEventId;
  writeFileSync(
    fixture.paths.events,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    { mode: 0o600 },
  );
  retireReadyAuthorityWitnessForLegacyFixture(fixture.paths.events);
  const ledgerEntries = readFileSync(fixture.paths.outcomes, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  ledgerEntries.find(
    (entry) => entry.authentication?.outcomeDigest === outcomeDigest,
  ).authentication.transitionEventId = tamperedEventId;
  writeFileSync(
    fixture.paths.outcomes,
    `${ledgerEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    { mode: 0o600 },
  );

  const before = {
    manifest: readFileSync(fixture.paths.taskManifest),
    events: readFileSync(fixture.paths.events),
    outcomes: readFileSync(fixture.paths.outcomes),
  };
  assert.throws(
    () =>
      withTestOutcomeRecordingGuards(
        {
          stateRoot,
          taskId,
          authentication: fixture.authentication,
          nowMs: nowMs + 101,
        },
        (control) =>
          control.finalizeTaskOutcome({
            stateRoot,
            taskId,
            ...fixture.authentication,
            outcome: "merged",
            outcomeDigest,
            taskRevision: reservation.task.revision,
            nowMs: nowMs + 101,
          }),
      ),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "outcome_not_durable",
  );
  assert.deepEqual(readFileSync(fixture.paths.taskManifest), before.manifest);
  assert.deepEqual(readFileSync(fixture.paths.events), before.events);
  assert.deepEqual(readFileSync(fixture.paths.outcomes), before.outcomes);
});

test("provider-required tasks cannot enter implementation before owner authorization", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const runner = actorLease(stateRoot, "freed-nightly-runner");
  const owner = actorLease(stateRoot, "freed-owner", {
    ownerTaskId: "provider-change",
    ownerIntentDigest: ownerIntent("task.authorize", "provider-change", {
      observerAuthority: null,
      providerAuthority: "approved",
      reason: "Owner approved the exact provider diff.",
      approvalReference: "provider-risk-facebook-extractor",
      expectedRevision: null,
    }),
  });
  createTask({
    stateRoot,
    taskId: "provider-change",
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "approval-required",
    details: { behavioral: true },
  });
  transitionTask({
    stateRoot,
    taskId: "provider-change",
    ...controller,
    toState: "triaged",
  });
  transitionTask({
    stateRoot,
    taskId: "provider-change",
    ...controller,
    toState: "approved_for_pr",
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "provider-change",
        ...runner,
        toState: "implemented",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "provider_approval_required",
  );
  assert.throws(
    () =>
      updateTaskAuthorities({
        stateRoot,
        taskId: "provider-change",
        ...runner,
        providerAuthority: "approved",
        reason: "attempted self approval",
        approvalReference: "fake",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_not_authorized",
  );
  updateTaskAuthorities({
    stateRoot,
    taskId: "provider-change",
    ...owner,
    providerAuthority: "approved",
    reason: "Owner approved the exact provider diff.",
    approvalReference: "provider-risk-facebook-extractor",
  });
  const implemented = transitionTask({
    stateRoot,
    taskId: "provider-change",
    ...runner,
    toState: "implemented",
  });
  assert.equal(implemented.task.state, "implemented");
});

test("governance and failure states return through conservative reconciliation paths", () => {
  assert.ok(TASK_STATES.includes("governance_blocked"));
  assert.ok(TASK_STATES.includes("superseded"));
  assert.ok(TASK_STATES.includes("implementation_failed"));
  assert.ok(TASK_STATES.includes("closed"));

  assert.equal(isTaskTransitionAllowed("observed", "governance_blocked"), true);
  assert.equal(isTaskTransitionAllowed("governance_blocked", "triaged"), true);
  assert.equal(
    isTaskTransitionAllowed("implemented", "implementation_failed"),
    true,
  );
  assert.equal(
    isTaskTransitionAllowed("implementation_failed", "triaged"),
    true,
  );
  assert.equal(isTaskTransitionAllowed("triaged", "superseded"), true);
  assert.equal(isTaskTransitionAllowed("superseded", "closed"), true);
  assert.equal(isTaskTransitionAllowed("verified_effective", "closed"), true);

  assert.equal(isTaskTransitionAllowed("observed", "closed"), false);
  assert.equal(
    isTaskTransitionAllowed("governance_blocked", "implemented"),
    false,
  );
  assert.equal(
    isTaskTransitionAllowed("implementation_failed", "validated"),
    false,
  );
  assert.equal(isTaskTransitionAllowed("superseded", "triaged"), false);
  assert.equal(isTaskTransitionAllowed("closed", "triaged"), true);
  assert.equal(isTaskTransitionAllowed("closed", "observed"), false);
  assert.equal(isTaskTransitionAllowed("verified_neutral", "closed"), false);
});

test("behavioral classification and the installed soak slot are immutable control invariants", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const runner = actorLease(stateRoot, "freed-nightly-runner");
  const outcomeBaseMs = Date.now();

  assert.throws(
    () =>
      createTask({
        stateRoot,
        taskId: "missing-classification",
        ...controller,
        observerAuthority: "merge-safe",
        providerAuthority: "forbidden",
        details: {},
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavioral_classification_required",
  );

  for (const taskId of ["behavior-a", "behavior-b"]) {
    createTask({
      stateRoot,
      taskId,
      ...controller,
      observerAuthority: "merge-safe",
      providerAuthority: "forbidden",
      details: { behavioral: true },
    });
    transitionTask({ stateRoot, taskId, ...controller, toState: "triaged" });
  }
  transitionTask({
    stateRoot,
    taskId: "behavior-a",
    ...controller,
    toState: "approved_for_pr",
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-b",
        ...controller,
        toState: "approved_for_pr",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavior_slot_conflict",
  );
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-a",
        ...runner,
        toState: "implemented",
        details: { behavioral: false },
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavioral_classification_immutable",
  );

  transitionTask({
    stateRoot,
    taskId: "behavior-a",
    ...runner,
    toState: "implemented",
  });
  transitionTask({
    stateRoot,
    taskId: "behavior-a",
    ...runner,
    toState: "validated",
  });
  completeGuardedOutcome({
    stateRoot,
    taskId: "behavior-a",
    authentication: runner,
    outcome: "merged",
    nowMs: outcomeBaseMs,
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-a",
        ...runner,
        toState: "superseded",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavior_outcome_required",
  );
  assert.throws(
    () =>
      completeGuardedOutcome({
        stateRoot,
        taskId: "behavior-a",
        authentication: runner,
        outcome: "installed",
        nowMs: outcomeBaseMs + 60_000,
      }),
    /installedIdentity/,
  );
  const installed = completeGuardedOutcome({
    stateRoot,
    taskId: "behavior-a",
    authentication: runner,
    outcome: "installed",
    details: {
      behavioral: true,
      installedIdentity: {
        version: "26.7.100-dev",
        commitSha: "2".repeat(40),
        channel: "dev",
      },
    },
    nowMs: outcomeBaseMs + 60_000,
  });
  assert.equal(installed.task.installedBuild, "26.7.100-dev");
  assert.deepEqual(installed.task.installedIdentity, {
    version: "26.7.100-dev",
    commitSha: "2".repeat(40),
    channel: "dev",
  });
  assert.equal(
    installed.task.installedAt,
    new Date(outcomeBaseMs + 60_000).toISOString(),
  );
  const soaking = transitionTask({
    stateRoot,
    taskId: "behavior-a",
    ...runner,
    toState: "soaking",
    nowMs: outcomeBaseMs + 5 * 60_000,
  });
  assert.equal(
    soaking.task.soakStartedAt,
    new Date(outcomeBaseMs + 5 * 60_000).toISOString(),
  );
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-a",
        ...runner,
        toState: "superseded",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavior_outcome_required",
  );
  completeGuardedOutcome({
    stateRoot,
    taskId: "behavior-a",
    authentication: runner,
    outcome: "governance_blocked",
    nowMs: outcomeBaseMs + 6 * 60_000,
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-a",
        ...controller,
        toState: "closed",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavior_outcome_required",
  );
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "behavior-a",
        ...controller,
        toState: "triaged",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "behavior_outcome_required",
  );

  for (const type of [
    "lease_acquired",
    "lease_credential_upgraded",
    "lease_heartbeat",
    "lease_released",
    "lease_scope_binding_confirmed",
    "lease_scope_bound",
    "lease_taken_over",
    "outcome_history_repaired",
    "outcome_recorded",
    "outcome_reservation_created",
    "outcome_reservation_finalized",
    "task_authority_updated",
    "task_created",
    "task_transitioned",
  ]) {
    assert.throws(
      () =>
        appendControlEvent({
          stateRoot,
          type,
          ...controller,
          taskId: "behavior-a",
          data: {},
        }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "reserved_event_type",
    );
  }
  for (const eventId of [
    `lease:${"a".repeat(64)}`,
    `outcome-history-repaired:${"b".repeat(64)}`,
    `outcome-recorded:${"c".repeat(64)}`,
    `task-outcome-reserved:${"d".repeat(64)}`,
  ]) {
    assert.throws(
      () =>
        appendControlEvent({
          stateRoot,
          type: "observer_note",
          eventId,
          ...controller,
          taskId: "behavior-a",
          data: {},
        }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "reserved_event_id",
    );
  }

  const manifestPath = automationControlPaths(stateRoot).taskManifest;
  const corruptManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  corruptManifest.tasks.find(
    (task) => task.taskId === "behavior-a",
  ).details.behavioral = false;
  writeFileSync(manifestPath, `${JSON.stringify(corruptManifest)}\n`);
  assert.throws(
    () => readTaskManifest({ stateRoot }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "authority_generation_conflict",
  );
});

test("new writes reject release authority while legacy records downgrade to merge-safe", () => {
  assert.deepEqual(OBSERVER_AUTHORITIES, [
    "observe-only",
    "plan-only",
    "pr-only",
    "merge-safe",
  ]);
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  assert.throws(
    () =>
      createTask({
        stateRoot,
        taskId: "legacy-new-write",
        ...controller,
        observerAuthority: "release",
        providerAuthority: "forbidden",
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "invalid_value",
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "nightly-writer",
        owner: "freed-nightly-runner",
        ttlMs: 1_000,
        observerAuthority: "release",
        providerAuthority: "forbidden",
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_policy_mismatch",
  );

  const paths = automationControlPaths(stateRoot);
  mkdirSync(path.dirname(paths.taskManifest), { recursive: true });
  writeFileSync(
    paths.taskManifest,
    `${JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      updatedAt: "2026-07-10T10:00:00.000Z",
      tasks: [
        {
          schemaVersion: 1,
          taskId: "legacy-release-task",
          state: "triaged",
          revision: 1,
          observerAuthority: "release",
          providerAuthority: "forbidden",
          createdAt: "2026-07-10T10:00:00.000Z",
          updatedAt: "2026-07-10T10:00:00.000Z",
          details: {},
        },
      ],
    })}\n`,
    { mode: 0o600 },
  );

  const legacyTask = readTask({ stateRoot, taskId: "legacy-release-task" });
  assert.equal(legacyTask.observerAuthority, "merge-safe");
});

test("provider approval requires a reference and authority changes are audited", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const approval = {
    schemaVersion: 1,
    approvalId: "provider-risk-p1-04-facebook-lifecycle",
    approvedBy: "AubreyF",
    ownerApprovalReference: "Owner approved the exact P1-04 provider diff.",
    approvalSource: { kind: "control-task", reference: "P1-04" },
    approvedAt: new Date(nowMs - 60_000).toISOString(),
    expiresAt: new Date(nowMs + 86_400_000).toISOString(),
    providers: ["facebook"],
    observableBehavior:
      "Changes the existing Facebook provider lifecycle behavior.",
    fingerprintingRisk:
      "Changed lifecycle timing could make the session easier to distinguish.",
    lowestProfileAlternative:
      "Keep the existing lifecycle and collect passive diagnostics.",
    diffSha: "a".repeat(40),
    paths: ["packages/desktop/src-tauri/src/fb-extract.js"],
    pathScopes: [
      {
        path: "packages/desktop/src-tauri/src/fb-extract.js",
        providers: ["facebook"],
      },
    ],
  };
  const authorizationDigest = providerApprovalAuthorizationDigest(approval);
  createTask({
    stateRoot,
    taskId: "P1-04",
    ...controller,
    observerAuthority: "pr-only",
    providerAuthority: "approval-required",
    details: { behavioral: true },
    nowMs: nowMs + 1_000,
  });
  transitionTask({
    stateRoot,
    taskId: "P1-04",
    ...controller,
    toState: "triaged",
    expectedRevision: 1,
    nowMs: nowMs + 2_000,
  });
  const owner = actorLease(stateRoot, "freed-owner", {
    ownerTaskId: "P1-04",
    ownerIntentDigest: ownerIntent("task.authorize", "P1-04", {
      observerAuthority: "merge-safe",
      providerAuthority: "approved",
      reason: "Scoped provider lifecycle work approved.",
      approvalReference: authorizationDigest,
      expectedRevision: 2,
    }),
  });
  const ownerLeaseRecord = JSON.parse(
    readFileSync(
      path.join(
        automationControlPaths(stateRoot).leases,
        "owner-governance.lease/lease.json",
      ),
      "utf8",
    ),
  );
  const ownerLeaseAcquiredAtMs = Date.parse(ownerLeaseRecord.acquiredAt);
  assert.throws(
    () =>
      updateTaskAuthorities({
        stateRoot,
        taskId: "P1-04",
        ...owner,
        providerAuthority: "approved",
        reason: "Provider lifecycle work approved.",
      }),
    /approvalReference/,
  );
  assert.throws(
    () =>
      updateTaskAuthorities({
        stateRoot,
        taskId: "P1-04",
        ...owner,
        observerAuthority: "merge-safe",
        providerAuthority: "approved",
        reason: "A different, unsigned governance intent.",
        approvalReference: authorizationDigest,
        expectedRevision: 2,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_capability_intent_mismatch",
  );

  const update = updateTaskAuthorities({
    stateRoot,
    taskId: "P1-04",
    ...owner,
    observerAuthority: "merge-safe",
    providerAuthority: "approved",
    reason: "Scoped provider lifecycle work approved.",
    approvalReference: authorizationDigest,
    expectedRevision: 2,
    nowMs: ownerLeaseAcquiredAtMs + 1_000,
  });
  assert.equal(update.task.observerAuthority, "merge-safe");
  assert.equal(update.task.providerAuthority, "approved");
  const event = readEvents(stateRoot).at(-1);
  assert.equal(event.type, "task_authority_updated");
  assert.equal(event.data.approvalReference, authorizationDigest);
  assert.equal(
    event.data.authorizationProvenance.leaseName,
    "owner-governance",
  );
  assert.equal(
    event.data.authorizationProvenance.credentialKind,
    "owner-confirmation",
  );
  assert.match(
    event.data.authorizationProvenance.ownerConfirmationId,
    /^owner-test-/,
  );
  assert.equal(
    event.data.authorizationProvenance.ownerConfirmationTaskId,
    "P1-04",
  );
  transitionTask({
    stateRoot,
    taskId: "P1-04",
    ...controller,
    toState: "approved_for_pr",
    expectedRevision: 3,
    nowMs: ownerLeaseAcquiredAtMs + 2_000,
  });
  const controlManifest = readTaskManifest({ stateRoot });
  const controlEvents = readEvents(stateRoot);
  const signedControlEvents = structuredClone(controlEvents);
  const authorizationEvent = signedControlEvents.find(
    (candidate) => candidate.type === "task_authority_updated",
  );
  assert.ok(authorizationEvent);
  assert.equal(authorizationEvent.actor, "freed-owner");
  assert.equal(authorizationEvent.taskId, "P1-04");
  assert.equal(authorizationEvent.providerAuthority, "approved");
  assert.equal(
    authorizationEvent.providerApprovalReference,
    authorizationDigest,
  );
  const provenance = authorizationEvent.data.authorizationProvenance;
  const matchingOwnerLeaseEvent = signedControlEvents.find(
    (candidate) =>
      candidate.type === "lease_acquired" &&
      candidate.actor === "freed-owner" &&
      candidate.leaseName === "owner-governance" &&
      candidate.data.credentialKind === "owner-confirmation" &&
      candidate.data.ownerConfirmationId === provenance.ownerConfirmationId &&
      candidate.ts === provenance.leaseAcquiredAt,
  );
  assert.ok(matchingOwnerLeaseEvent);
  const ownerCapabilityId = `provider-owner-${createHash("sha256")
    .update(approval.approvalId)
    .digest("hex")}`;
  const signedProvenance = {
    leaseName: provenance.leaseName,
    leaseAcquiredAt: provenance.leaseAcquiredAt,
    credentialKind: "owner-signed-capability",
    ownerCapabilityId,
    ownerCapabilityTaskId: "P1-04",
    ownerCapabilityIntentDigest: ownerLeaseRecord.ownerConfirmationIntentDigest,
  };
  matchingOwnerLeaseEvent.data = {
    expiresAt: matchingOwnerLeaseEvent.data.expiresAt,
    observerAuthority: matchingOwnerLeaseEvent.data.observerAuthority,
    providerAuthority: matchingOwnerLeaseEvent.data.providerAuthority,
    requestDigest: matchingOwnerLeaseEvent.data.requestDigest,
    credentialKind: "owner-signed-capability",
    ownerCapabilityId,
    ownerCapabilityTaskId: "P1-04",
    ownerCapabilityIntentDigest: ownerLeaseRecord.ownerConfirmationIntentDigest,
  };
  authorizationEvent.data.authorizationProvenance = signedProvenance;
  const validatedApproval = validateProviderRiskApproval(
    approval,
    approval.paths,
    {
      now: ownerLeaseAcquiredAtMs + 3_000,
      diffSha: approval.diffSha,
      controlManifest,
      controlEvents: signedControlEvents,
    },
  );
  assert.equal(validatedApproval.authorizationDigest, authorizationDigest);
});

test("approved provider tasks require and retain an owner approval reference at creation", () => {
  const stateRoot = temporaryStateRoot();
  const owner = actorLease(stateRoot, "freed-owner", {
    ownerTaskId: "approved-with-reference",
    ownerIntentDigest: ownerIntent("task.create", "approved-with-reference", {
      state: "observed",
      observerAuthority: "merge-safe",
      providerAuthority: "approved",
      approvalReference: "owner-task-019f-provider-scope",
      details: { behavioral: true },
    }),
  });
  assert.throws(
    () =>
      createTask({
        stateRoot,
        taskId: "approved-without-reference",
        ...owner,
        observerAuthority: "merge-safe",
        providerAuthority: "approved",
      }),
    /approvalReference/,
  );

  const created = createTask({
    stateRoot,
    taskId: "approved-with-reference",
    ...owner,
    observerAuthority: "merge-safe",
    providerAuthority: "approved",
    approvalReference: "owner-task-019f-provider-scope",
    details: { behavioral: true },
  });
  assert.equal(
    created.task.providerApprovalReference,
    "owner-task-019f-provider-scope",
  );
  const event = readEvents(stateRoot).at(-1);
  assert.equal(
    event.providerApprovalReference,
    "owner-task-019f-provider-scope",
  );
  assert.equal(event.data.approvalReference, "owner-task-019f-provider-scope");
});

test("owner capability signature is bound to task, intent, state root, and lease token", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-10T14:00:00Z");
  const taskId = "owner-capability-task";
  const intentDigest = ownerIntent("task.authorize", taskId, {
    observerAuthority: "merge-safe",
    providerAuthority: null,
    reason: "Approve the reviewed local task.",
    approvalReference: null,
    expectedRevision: 1,
  });
  const leaseToken = "owner-capability-lease-token-1234567890";
  const signed = signedOwnerCapability(
    stateRoot,
    taskId,
    intentDigest,
    leaseToken,
    { nowMs, ttlMs: 60_000 },
  );
  const verified = verifyOwnerCapabilityEnvelope({
    envelope: signed.envelope,
    publicKeyBase64: signed.publicKeyBase64,
    stateRoot,
    taskId,
    intentDigest,
    leaseToken,
    ttlMs: 60_000,
    nowMs: nowMs + 1_000,
  });
  assert.equal(verified.taskId, taskId);
  assert.equal(verified.intentDigest, intentDigest);

  const forged = signedOwnerCapability(
    stateRoot,
    taskId,
    intentDigest,
    leaseToken,
    { nowMs, ttlMs: 60_000 },
  );
  assert.throws(
    () =>
      verifyOwnerCapabilityEnvelope({
        envelope: forged.envelope,
        publicKeyBase64: signed.publicKeyBase64,
        stateRoot,
        taskId,
        intentDigest,
        leaseToken,
        ttlMs: 60_000,
        nowMs: nowMs + 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_capability_signature_invalid",
  );
  assert.throws(
    () =>
      verifyOwnerCapabilityEnvelope({
        envelope: signed.envelope,
        publicKeyBase64: signed.publicKeyBase64,
        stateRoot,
        taskId: "different-task",
        intentDigest,
        leaseToken,
        ttlMs: 60_000,
        nowMs: nowMs + 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_capability_invalid",
  );
});

test("current-task owner confirmation acquires one exact audited governance lease", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const taskId = "current-task-owner-confirmation";
  const details = {
    behavioral: true,
    metricId: "renderer-recovery-count",
  };
  const intent = {
    schemaVersion: 1,
    action: "task.create",
    taskId,
    parameters: {
      state: "observed",
      observerAuthority: "merge-safe",
      providerAuthority: "approved",
      approvalReference: "sha256:approved-provider-diff",
      details,
    },
  };
  const intentDigest = ownerGovernanceIntentDigest(intent);
  const { confirmation, confirmationPath } = writeOwnerConfirmation(
    stateRoot,
    taskId,
    intent,
    { nowMs },
  );
  const acquired = acquireLease({
    stateRoot,
    name: "owner-governance",
    owner: "freed-owner",
    ttlMs: 60_000,
    nowMs: nowMs + 1_000,
    ownerConfirmationFile: confirmationPath,
    ownerCapabilityTaskId: taskId,
    ownerCapabilityIntentDigest: intentDigest,
  });
  assert.equal(acquired.lease.credentialKind, "owner-confirmation");
  assert.equal(acquired.lease.ownerConfirmationTaskId, taskId);
  assert.equal(acquired.lease.ownerConfirmationIntentDigest, intentDigest);
  assert.match(acquired.lease.ownerConfirmationDigest, /^[0-9a-f]{64}$/);
  assert.equal(acquired.lease.ownerConfirmationReference, taskId);
  assert.equal(acquired.lease.ownerConfirmationApprovedBy, "AubreyF");
  assert.equal(
    acquired.lease.ownerConfirmationApprovalReference,
    confirmation.ownerApprovalReference,
  );
  assert.equal(
    acquired.lease.ownerConfirmationApprovedAt,
    confirmation.approvedAt,
  );
  assert.equal(
    acquired.lease.ownerConfirmationExpiresAt,
    confirmation.expiresAt,
  );

  const created = createTask({
    stateRoot,
    taskId,
    actor: "freed-owner",
    leaseName: "owner-governance",
    leaseToken: acquired.lease.token,
    observerAuthority: "merge-safe",
    providerAuthority: "approved",
    approvalReference: "sha256:approved-provider-diff",
    details,
    nowMs: nowMs + 2_000,
  });
  assert.equal(created.task.state, "observed");
  assert.equal(
    created.event.data.authorizationProvenance.credentialKind,
    "owner-confirmation",
  );
  assert.equal(
    created.event.data.authorizationProvenance.ownerConfirmationDigest,
    acquired.lease.ownerConfirmationDigest,
  );
  assert.throws(
    () =>
      createTask({
        stateRoot,
        taskId: "different-current-task",
        actor: "freed-owner",
        leaseName: "owner-governance",
        leaseToken: acquired.lease.token,
        observerAuthority: "merge-safe",
        providerAuthority: "forbidden",
        details: { behavioral: false },
        nowMs: nowMs + 3_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_capability_intent_mismatch",
  );

  releaseLease({
    stateRoot,
    name: "owner-governance",
    token: acquired.lease.token,
    nowMs: nowMs + 4_000,
  });
  const transitionIntent = {
    schemaVersion: 1,
    action: "task.transition",
    taskId,
    parameters: {
      toState: "triaged",
      expectedRevision: 1,
      details: null,
    },
  };
  const transitionConfirmation = writeOwnerConfirmation(
    stateRoot,
    taskId,
    transitionIntent,
    {
      nowMs,
      confirmationId: "owner-confirmation-transition",
    },
  );
  const transitionLease = acquireLease({
    stateRoot,
    name: "owner-governance",
    owner: "freed-owner",
    ttlMs: 60_000,
    nowMs: nowMs + 5_000,
    ownerConfirmationFile: transitionConfirmation.confirmationPath,
    ownerCapabilityTaskId: taskId,
    ownerCapabilityIntentDigest: transitionConfirmation.intentDigest,
  });
  const transitioned = transitionTask({
    stateRoot,
    taskId,
    actor: "freed-owner",
    leaseName: "owner-governance",
    leaseToken: transitionLease.lease.token,
    toState: "triaged",
    expectedRevision: 1,
    nowMs: nowMs + 6_000,
  });
  assert.equal(transitioned.task.state, "triaged");
  assert.equal(
    transitioned.event.data.authorizationProvenance.ownerConfirmationDigest,
    transitionLease.lease.ownerConfirmationDigest,
  );
});

test("current-task owner confirmation rejects stale, forged, and permissive records", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-10T14:00:00Z");
  const taskId = "invalid-owner-confirmation";
  const intent = {
    schemaVersion: 1,
    action: "task.create",
    taskId,
    parameters: {
      state: "observed",
      observerAuthority: "merge-safe",
      providerAuthority: "forbidden",
      approvalReference: null,
      details: { behavioral: false },
    },
  };
  const intentDigest = ownerGovernanceIntentDigest(intent);
  const acquire = (confirmationPath) =>
    acquireLease({
      stateRoot,
      name: "owner-governance",
      owner: "freed-owner",
      ttlMs: 60_000,
      nowMs,
      ownerConfirmationFile: confirmationPath,
      ownerCapabilityTaskId: taskId,
      ownerCapabilityIntentDigest: intentDigest,
    });

  const expired = writeOwnerConfirmation(stateRoot, taskId, intent, {
    nowMs,
    confirmationId: "expired-owner-confirmation",
    approvedAtMs: nowMs - 120_000,
    expiresAtMs: nowMs - 60_000,
  });
  assert.throws(
    () => acquire(expired.confirmationPath),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_confirmation_invalid",
  );

  const forged = writeOwnerConfirmation(stateRoot, taskId, intent, {
    nowMs,
    confirmationId: "forged-owner-confirmation",
    approvedBy: "SomeoneElse",
  });
  assert.throws(
    () => acquire(forged.confirmationPath),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_confirmation_invalid",
  );

  const tampered = writeOwnerConfirmation(stateRoot, taskId, intent, {
    nowMs,
    confirmationId: "tampered-owner-confirmation",
  });
  tampered.confirmation.intent.parameters.details.behavioral = true;
  writeFileSync(
    tampered.confirmationPath,
    `${JSON.stringify(tampered.confirmation)}\n`,
    { mode: 0o600 },
  );
  assert.throws(
    () => acquire(tampered.confirmationPath),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_confirmation_invalid",
  );

  const permissive = writeOwnerConfirmation(stateRoot, taskId, intent, {
    nowMs,
    confirmationId: "permissive-owner-confirmation",
    mode: 0o644,
  });
  assert.throws(
    () => acquire(permissive.confirmationPath),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_confirmation_permissions_invalid",
  );
});

test("same-UID owner bootstrap files cannot authenticate governance", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-10T14:00:00Z");
  const forgedPath = path.join(
    automationControlPaths(stateRoot).controlRoot,
    "owner-bootstrap.json",
  );
  mkdirSync(path.dirname(forgedPath), { recursive: true });
  writeFileSync(
    forgedPath,
    `${JSON.stringify({
      schemaVersion: 1,
      grantId: "same-uid-forgery",
      actor: "freed-owner",
      purpose: "owner-governance-lease",
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 60_000).toISOString(),
      tokenSha256: createHash("sha256").update("forged-token").digest("hex"),
    })}\n`,
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "owner-governance",
        owner: "freed-owner",
        ttlMs: 60_000,
        nowMs,
        token: "forged-token-caller-retained-1234567890",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_capability_required",
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "owner-governance",
        owner: "freed-owner",
        ttlMs: 60_000,
        nowMs,
        token: "forged-token-caller-retained-1234567890",
        ownerCapabilityFile: forgedPath,
        ownerCapabilityTaskId: "forged-task",
        ownerCapabilityIntentDigest: "a".repeat(64),
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_capability_trust_invalid",
  );
});

test("general actor public acquisition always requires the trusted launcher", () => {
  const stateRoot = temporaryStateRoot();
  assert.throws(
    () =>
      acquireLeasePublic({
        stateRoot,
        name: "nightly-writer",
        owner: "freed-nightly-runner",
        operationId: nextLeaseOperationId("public-actor-rejected"),
        ttlMs: 60_000,
        token: `public-actor-rejected-${"x".repeat(32)}`,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_launcher_required",
  );
  assert.throws(
    () =>
      acquireLeasePublic({
        stateRoot,
        name: "nightly-writer",
        owner: "freed-nightly-runner",
        operationId: nextLeaseOperationId("public-credential-rejected"),
        ttlMs: 60_000,
        token: `public-credential-rejected-${"x".repeat(32)}`,
        actorCredentialToken: "retired-persistent-actor-secret-1234567890",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_launcher_required",
  );
  assert.equal(
    existsSync(automationControlPaths(stateRoot).actorCredentials),
    false,
  );
});

test("trusted launcher leases enforce a 30-minute absolute lifetime", () => {
  const maxLeaseLifetimeMs = 30 * 60_000;
  const nowMs = Date.parse("2026-07-10T14:30:00Z");
  const generalActors = Object.keys(AUTOMATION_ACTOR_POLICIES).filter(
    (actor) => !["freed-owner", "freed-pr-publisher"].includes(actor),
  );

  assert.deepEqual(generalActors.sort(), [
    "freed-nightly-runner",
    "freed-release-verifier",
    "freed-runtime-observer",
    "freed-scaffolding-maintainer",
    "freed-stability-controller",
  ]);
  assert.equal(
    AUTOMATION_ACTOR_POLICIES["freed-owner"].maxLeaseLifetimeMs,
    undefined,
  );
  assert.equal(
    AUTOMATION_ACTOR_POLICIES["freed-pr-publisher"].maxLeaseLifetimeMs,
    undefined,
  );

  for (const actor of generalActors) {
    const policy = AUTOMATION_ACTOR_POLICIES[actor];
    assert.equal(policy.maxLeaseLifetimeMs, maxLeaseLifetimeMs);
    const invalidRoot = temporaryStateRoot();
    writeTrustedLauncherLease(invalidRoot, actor, {
      nowMs,
      ttlMs: maxLeaseLifetimeMs + 1,
      appendAcquireEvent: false,
    });
    assert.throws(
      () => inspectLease({ stateRoot: invalidRoot, name: policy.leaseName }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "invalid_state",
    );

    const stateRoot = temporaryStateRoot();
    const acquired = writeTrustedLauncherLease(stateRoot, actor, {
      nowMs,
      token: `${actor}-bounded-token-caller-retained-1234567890`,
      ttlMs: maxLeaseLifetimeMs,
    });
    assert.equal(acquired.record.credentialKind, "trusted-launcher-channel");
    assert.equal(
      acquired.record.expiresAt,
      new Date(nowMs + maxLeaseLifetimeMs).toISOString(),
    );

    const heartbeat = heartbeatLease({
      stateRoot,
      name: policy.leaseName,
      token: acquired.leaseToken,
      ttlMs: maxLeaseLifetimeMs,
      nowMs: nowMs + 20 * 60_000,
    });
    assert.equal(
      heartbeat.lease.expiresAt,
      new Date(nowMs + maxLeaseLifetimeMs).toISOString(),
    );
  }
});

test("owner lease lifetime cannot outlive its fixed limit", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "owner-governance",
        owner: "freed-owner",
        ttlMs: 16 * 60_000,
        nowMs,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_lease_ttl_exceeded",
  );

  const acquired = actorLease(stateRoot, "freed-owner", {
    nowMs,
    token: "owner-lifetime-lease-token",
    ownerTaskId: "owner-lifetime-task",
    ownerIntentDigest: ownerIntent("task.authorize", "owner-lifetime-task", {
      observerAuthority: "merge-safe",
      providerAuthority: null,
      reason: "Exercise the fixed owner lease lifetime.",
      approvalReference: null,
      expectedRevision: 1,
    }),
  });
  const heartbeat = heartbeatLease({
    stateRoot,
    name: "owner-governance",
    token: acquired.leaseToken,
    ttlMs: 10 * 60_000,
    nowMs: nowMs + 9 * 60_000,
  });
  assert.equal(
    heartbeat.lease.expiresAt,
    new Date(nowMs + 15 * 60_000).toISOString(),
  );
  assert.throws(
    () =>
      heartbeatLease({
        stateRoot,
        name: "owner-governance",
        token: acquired.leaseToken,
        ttlMs: 60_000,
        nowMs: nowMs + 15 * 60_000,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
});

test("publisher lease has a fixed absolute lifetime", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-10T15:00:00Z");
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(stateRoot),
    branch: "fix/publisher-scope-test",
    base: "dev",
    baseSha: "a".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 31 * 60_000,
        nowMs,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_ttl_invalid",
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_scope_required",
  );

  const capability = writePublisherCapability(stateRoot, scope, { nowMs });
  const acquired = acquireLease({
    stateRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    ttlMs: 30 * 60_000,
    nowMs,
    publisherCapabilityFile: capability.capabilityPath,
    scope,
  });
  assert.equal(acquired.lease.credentialKind, "signed-capability");
  assert.equal(acquired.lease.publisherCapabilityId, capability.capabilityId);
  assert.equal(existsSync(capability.capabilityPath), false);
  const bound = bindPublisherLeaseHead({
    stateRoot,
    token: acquired.lease.token,
    scope,
    headSha: "b".repeat(40),
    nowMs: nowMs + 1_000,
  });
  assert.equal(bound.lease.scope.headSha, "b".repeat(40));
  assert.throws(
    () =>
      bindPublisherLeaseHead({
        stateRoot,
        token: acquired.lease.token,
        scope,
        headSha: "c".repeat(40),
        nowMs: nowMs + 2_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_head_mismatch",
  );
  const heartbeat = heartbeatLease({
    stateRoot,
    name: "pr-publisher",
    token: acquired.lease.token,
    ttlMs: 30 * 60_000,
    nowMs: nowMs + 19 * 60_000,
  });
  assert.equal(
    heartbeat.lease.expiresAt,
    new Date(nowMs + 30 * 60_000).toISOString(),
  );
});

test("publisher capability binds the caller-owned lease operation and token digest", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-10T15:10:00Z");
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(stateRoot),
    branch: "fix/publisher-capability-binding",
    base: "dev",
    baseSha: "a".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };

  const legacy = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-old-shape",
    omitLeaseBinding: true,
  });
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        operationId: legacy.leaseOperationId,
        token: legacy.token,
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: legacy.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_capability_invalid",
  );

  const operationMismatch = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-operation-mismatch",
  });
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        operationId: nextLeaseOperationId("publisher-mismatch"),
        token: operationMismatch.token,
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: operationMismatch.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_capability_invalid",
  );

  const tokenMismatch = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-token-mismatch",
  });
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        operationId: tokenMismatch.leaseOperationId,
        token: `${tokenMismatch.token}-different`,
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: tokenMismatch.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_capability_invalid",
  );

  const valid = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-bound",
  });
  const acquired = acquireLease({
    stateRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    operationId: valid.leaseOperationId,
    token: valid.token,
    ttlMs: 30 * 60_000,
    nowMs,
    publisherCapabilityFile: valid.capabilityPath,
    scope,
  });
  assert.equal(acquired.lease.token, valid.token);
  assert.equal(acquired.lease.publisherCapabilityId, valid.capabilityId);
  assert.equal(existsSync(valid.capabilityPath), false);
});

test("publisher scope binds distinct governed main modes", () => {
  const nowMs = Date.parse("2026-07-10T15:20:00Z");
  const releaseStateRoot = temporaryStateRoot();
  const releaseScope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(releaseStateRoot),
    branch: "chore/release-v26.7.1001",
    base: "main",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    publishMode: "production-release-prep",
  };
  const releaseCapability = writePublisherCapability(
    releaseStateRoot,
    releaseScope,
    {
      nowMs,
    },
  );
  const releaseLease = acquireLease({
    stateRoot: releaseStateRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    ttlMs: 30 * 60_000,
    nowMs,
    publisherCapabilityFile: releaseCapability.capabilityPath,
    scope: releaseScope,
  });
  assert.equal(releaseLease.lease.scope.publishMode, "production-release-prep");
  const releaseHistory = inspectExactTaskLifecycleHistory(
    readEvents(releaseStateRoot),
  );
  assert.equal(releaseHistory.healthy, true, releaseHistory.issues.join("\n"));

  const promotionStateRoot = temporaryStateRoot();
  const promotionScope = {
    ...releaseScope,
    worktree: realpathSync(promotionStateRoot),
    branch: "chore/promote-dev-to-main-v26.7.1001",
    publishMode: "production-promotion",
  };
  const promotionCapability = writePublisherCapability(
    promotionStateRoot,
    promotionScope,
    { nowMs },
  );
  const promotionLease = acquireLease({
    stateRoot: promotionStateRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    ttlMs: 30 * 60_000,
    nowMs,
    publisherCapabilityFile: promotionCapability.capabilityPath,
    scope: promotionScope,
  });
  assert.equal(promotionLease.lease.scope.publishMode, "production-promotion");
  const promotionHistory = inspectExactTaskLifecycleHistory(
    readEvents(promotionStateRoot),
  );
  assert.equal(
    promotionHistory.healthy,
    true,
    promotionHistory.issues.join("\n"),
  );

  const mismatchedStateRoot = temporaryStateRoot();
  const mismatchedScope = {
    ...releaseScope,
    worktree: realpathSync(mismatchedStateRoot),
    publishMode: "production-promotion",
  };
  const mismatchedCapability = writePublisherCapability(
    mismatchedStateRoot,
    mismatchedScope,
    { nowMs },
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot: mismatchedStateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: mismatchedCapability.capabilityPath,
        scope: mismatchedScope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_scope_invalid",
  );
});

test("publisher acquisition rejects reusable credentials, tampering, permissive files, and replay", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-10T15:30:00Z");
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(stateRoot),
    branch: "fix/publisher-capability-test",
    base: "dev",
    baseSha: "d".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  writeActorCredential(stateRoot, "freed-pr-publisher");
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
        actorCredentialToken: "publisher-persistent-secret-1234567890",
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_reusable_credential_forbidden",
  );

  const wrongLifetime = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-wrong-lifetime",
    lifetimeMs: 61_000,
  });
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: wrongLifetime.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_capability_invalid",
  );

  const extraScope = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-extra-scope",
    payloadScope: { ...scope, command: "unexpected" },
  });
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: extraScope.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_scope_invalid",
  );

  const permissive = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-permissions",
  });
  chmodSync(permissive.capabilityPath, 0o644);
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: permissive.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_capability_permissions_invalid",
  );

  const tampered = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-tampered",
  });
  const tamperedEnvelope = JSON.parse(
    readFileSync(tampered.capabilityPath, "utf8"),
  );
  tamperedEnvelope.signatureBase64 = Buffer.alloc(64, 7).toString("base64");
  writeFileSync(
    tampered.capabilityPath,
    `${JSON.stringify(tamperedEnvelope)}\n`,
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs,
        publisherCapabilityFile: tampered.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_capability_signature_invalid",
  );

  const replay = writePublisherCapability(stateRoot, scope, {
    nowMs,
    capabilityId: "publisher-capability-replay",
  });
  const replayEnvelope = readFileSync(replay.capabilityPath, "utf8");
  const acquired = acquireLease({
    stateRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    ttlMs: 30 * 60_000,
    nowMs,
    publisherCapabilityFile: replay.capabilityPath,
    scope,
  });
  releaseLease({
    stateRoot,
    name: "pr-publisher",
    token: acquired.lease.token,
    nowMs: nowMs + 1_000,
  });
  writeFileSync(replay.capabilityPath, replayEnvelope, { mode: 0o600 });
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        ttlMs: 30 * 60_000,
        nowMs: nowMs + 2_000,
        operationId: nextLeaseOperationId("publisher-replay"),
        token: "different-publisher-replay-token-1234567890",
        publisherCapabilityFile: replay.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "publisher_capability_invalid",
  );
});

test("lease validation rejects a permissive bearer record", () => {
  const stateRoot = temporaryStateRoot();
  const lease = actorLease(stateRoot, "freed-release-verifier");
  const leasePath = path.join(
    automationControlPaths(stateRoot).leases,
    `${lease.leaseName}.lease/lease.json`,
  );
  chmodSync(leasePath, 0o644);
  assert.throws(
    () =>
      heartbeatLease({
        stateRoot,
        name: lease.leaseName,
        token: lease.leaseToken,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_permissions_invalid",
  );
});

test("lease validation rejects a permissive lease directory", () => {
  const stateRoot = temporaryStateRoot();
  const lease = actorLease(stateRoot, "freed-release-verifier");
  const leaseDirectory = path.join(
    automationControlPaths(stateRoot).leases,
    `${lease.leaseName}.lease`,
  );
  chmodSync(leaseDirectory, 0o755);
  assert.throws(
    () =>
      heartbeatLease({
        stateRoot,
        name: lease.leaseName,
        token: lease.leaseToken,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "invalid_state_permissions",
  );
});

test("an authenticated actor upgrades only its own exact expired legacy lease", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-scaffolding-maintainer";
  const nowMs = Date.parse("2026-07-10T16:00:00Z");
  const legacy = writeLegacyLease(stateRoot, actor, {
    nowMs: nowMs - 2 * 60 * 60_000,
  });
  const inspectedLegacy = inspectLease({
    stateRoot,
    name: legacy.policy.leaseName,
    nowMs,
  });
  assert.equal(inspectedLegacy.status, "expired");
  assert.equal(inspectedLegacy.expired, true);
  assert.equal(inspectedLegacy.legacyUncredentialed, true);
  assert.equal(Object.hasOwn(inspectedLegacy, "token"), false);
  const acquired = acquireLease({
    stateRoot,
    name: legacy.policy.leaseName,
    owner: actor,
    ttlMs: 60_000,
    nowMs,
    token: "scaffolding-upgraded-token-caller-retained-1234567890",
  });

  assert.equal(acquired.takeover, true);
  assert.equal(acquired.credentialUpgrade, true);
  assert.equal(acquired.previous.legacyUncredentialed, true);
  assert.equal(acquired.lease.credentialKind, "trusted-launcher-channel");
  for (const [field, value] of Object.entries(
    TEST_TRUSTED_LAUNCHER_PROVENANCE,
  )) {
    assert.equal(acquired.lease[field], value, field);
  }
  assert.equal(
    acquired.lease.token,
    "scaffolding-upgraded-token-caller-retained-1234567890",
  );
  const upgradeEvent = readEvents(stateRoot).at(-1);
  assert.equal(upgradeEvent.type, "lease_credential_upgraded");
  assert.equal(upgradeEvent.data.credentialUpgrade, true);
  for (const [field, value] of Object.entries(
    TEST_TRUSTED_LAUNCHER_PROVENANCE,
  )) {
    assert.equal(upgradeEvent.data[field], value, field);
  }
  assert.throws(
    () =>
      heartbeatLease({
        stateRoot,
        name: legacy.policy.leaseName,
        token: legacy.record.token,
        nowMs: nowMs + 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_token_mismatch",
  );
  assert.throws(
    () =>
      releaseLease({
        stateRoot,
        name: legacy.policy.leaseName,
        token: legacy.record.token,
        nowMs: nowMs + 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_token_mismatch",
  );
});

test("legacy lease upgrade rejects unauthenticated, cross-actor, and token-reuse attempts", () => {
  const unauthenticatedRoot = temporaryStateRoot();
  const actor = "freed-scaffolding-maintainer";
  const unauthenticatedNowMs = Date.now();
  const unauthenticated = writeLegacyLease(unauthenticatedRoot, actor, {
    nowMs: unauthenticatedNowMs - 2 * 60 * 60_000,
  });
  assert.throws(
    () =>
      acquireLeasePublic({
        stateRoot: unauthenticatedRoot,
        name: unauthenticated.policy.leaseName,
        owner: actor,
        operationId: nextLeaseOperationId("unauthenticated-legacy-upgrade"),
        ttlMs: 60_000,
        token: "unauthenticated-upgrade-token-caller-retained-1234567890",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_launcher_required",
  );

  const crossActorRoot = temporaryStateRoot();
  const crossActorNowMs = Date.now();
  const crossActor = writeLegacyLease(crossActorRoot, actor, {
    owner: "freed-nightly-runner",
    nowMs: crossActorNowMs - 2 * 60 * 60_000,
  });
  assert.throws(
    () =>
      acquireLease({
        stateRoot: crossActorRoot,
        name: crossActor.policy.leaseName,
        owner: actor,
        ttlMs: 60_000,
        nowMs: crossActorNowMs,
        token: "cross-actor-upgrade-token-caller-retained-1234567890",
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "invalid_state" &&
      /identity or authority is invalid/.test(error.message),
  );

  const tokenReuseRoot = temporaryStateRoot();
  const tokenReuseNowMs = Date.parse("2026-07-10T17:00:00Z");
  const tokenReuse = writeLegacyLease(tokenReuseRoot, actor, {
    nowMs: tokenReuseNowMs - 2 * 60 * 60_000,
  });
  assert.throws(
    () =>
      acquireLease({
        stateRoot: tokenReuseRoot,
        name: tokenReuse.policy.leaseName,
        owner: actor,
        ttlMs: 60_000,
        nowMs: tokenReuseNowMs,
        token: tokenReuse.record.token,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_token_reuse",
  );
});

test("deleted authorization fields never create a current lease upgrade path", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-scaffolding-maintainer";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const nowMs = Date.parse("2026-07-10T17:30:00Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("credential-deletion-source"),
    ttlMs: 60_000,
    nowMs,
    token: `credential-deletion-source-${"x".repeat(40)}`,
  });
  const acquisition = readEvents(stateRoot).at(-1);
  assert.equal(acquisition.data.credentialKind, "trusted-launcher-channel");
  for (const [field, value] of Object.entries(
    TEST_TRUSTED_LAUNCHER_PROVENANCE,
  )) {
    assert.equal(acquisition.data[field], value, field);
  }
  const recordPath = path.join(
    automationControlPaths(stateRoot).leases,
    `${name}.lease`,
    "lease.json",
  );
  const downgraded = JSON.parse(readFileSync(recordPath, "utf8"));
  assert.equal(downgraded.credentialKind, "trusted-launcher-channel");
  delete downgraded.credentialKind;
  writeFileSync(recordPath, `${JSON.stringify(downgraded, null, 2)}\n`, {
    mode: 0o600,
  });
  const before = snapshotLeaseAuthorityState(stateRoot);

  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId: nextLeaseOperationId("credential-deletion-attempt"),
        ttlMs: 60_000,
        nowMs: nowMs + 1_000,
        token: `credential-deletion-replacement-${"y".repeat(40)}`,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "invalid_state" &&
      /unsupported record/.test(error.message),
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), before);
});

test("named leases are exclusive and inspection redacts the token", () => {
  const stateRoot = temporaryStateRoot();
  const actorCredentialToken = writeActorCredential(
    stateRoot,
    "freed-nightly-runner",
  );
  const first = acquireLease({
    stateRoot,
    name: "nightly-writer",
    owner: "freed-nightly-runner",
    ttlMs: 60_000,
    nowMs: 1_000,
    token: "token-a-caller-retained-12345678901234567890",
    actorCredentialToken,
  });
  assert.equal(first.acquired, true);
  assert.equal(first.takeover, false);
  assert.equal(
    first.lease.token,
    "token-a-caller-retained-12345678901234567890",
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "nightly-writer",
        owner: "freed-nightly-runner",
        ttlMs: 60_000,
        nowMs: 2_000,
        token: "token-b-caller-retained-12345678901234567890",
        actorCredentialToken,
      }),
    (error) =>
      isAutomationControlError(error) && error.code === "lease_busy",
  );
  const inspected = inspectLease({
    stateRoot,
    name: "nightly-writer",
    nowMs: 2_000,
  });
  assert.equal(inspected.owner, "freed-nightly-runner");
  assert.equal(inspected.status, "active");
  assert.equal(Object.hasOwn(inspected, "token"), false);
});

test("expired lease takeover is safe and old tokens cannot touch the replacement", () => {
  const stateRoot = temporaryStateRoot();
  const actorCredentialToken = writeActorCredential(
    stateRoot,
    "freed-release-verifier",
  );
  acquireLease({
    stateRoot,
    name: "release-verifier",
    owner: "freed-release-verifier",
    ttlMs: 1_000,
    nowMs: 10_000,
    token: "old-token-caller-retained-12345678901234567890",
    actorCredentialToken,
  });
  const takeover = acquireLease({
    stateRoot,
    name: "release-verifier",
    owner: "freed-release-verifier",
    ttlMs: 5_000,
    nowMs: 11_001,
    token: "new-token-caller-retained-12345678901234567890",
    actorCredentialToken,
  });
  assert.equal(takeover.takeover, true);
  assert.equal(takeover.previous.owner, "freed-release-verifier");
  assert.equal(
    takeover.lease.token,
    "new-token-caller-retained-12345678901234567890",
  );
  assert.throws(
    () =>
      heartbeatLease({
        stateRoot,
        name: "release-verifier",
        token: "old-token",
        nowMs: 11_100,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_token_mismatch",
  );
  assert.throws(
    () =>
      releaseLease({
        stateRoot,
        name: "release-verifier",
        token: "old-token",
        nowMs: 11_100,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_token_mismatch",
  );
  assert.equal(
    inspectLease({ stateRoot, name: "release-verifier", nowMs: 11_100 }).owner,
    "freed-release-verifier",
  );
  assert.deepEqual(
    readEvents(stateRoot).map((event) => event.type),
    ["lease_acquired", "lease_taken_over"],
  );
});

test("lease heartbeat extends a live lease and release is token checked", () => {
  const stateRoot = temporaryStateRoot();
  const actorCredentialToken = writeActorCredential(
    stateRoot,
    "freed-runtime-observer",
  );
  acquireLease({
    stateRoot,
    name: "runtime-observer",
    owner: "freed-runtime-observer",
    ttlMs: 1_000,
    nowMs: 20_000,
    token: "observer-token-caller-retained-12345678901234567890",
    actorCredentialToken,
  });
  const heartbeat = heartbeatLease({
    stateRoot,
    name: "runtime-observer",
    token: "observer-token-caller-retained-12345678901234567890",
    ttlMs: 4_000,
    nowMs: 20_500,
  });
  assert.equal(heartbeat.lease.heartbeatAt, "1970-01-01T00:00:20.500Z");
  assert.equal(heartbeat.lease.expiresAt, "1970-01-01T00:00:24.500Z");
  assert.throws(
    () =>
      releaseLease({
        stateRoot,
        name: "runtime-observer",
        token: "wrong-token",
        nowMs: 21_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_token_mismatch",
  );
  const released = releaseLease({
    stateRoot,
    name: "runtime-observer",
    token: "observer-token-caller-retained-12345678901234567890",
    nowMs: 21_000,
  });
  assert.equal(released.released, true);
  assert.equal(
    inspectLease({ stateRoot, name: "runtime-observer", nowMs: 21_000 }),
    null,
  );
  assert.deepEqual(
    readEvents(stateRoot).map((event) => event.type),
    ["lease_acquired", "lease_heartbeat", "lease_released"],
  );
});

test("expired leases cannot be revived by heartbeat", () => {
  const stateRoot = temporaryStateRoot();
  const actorCredentialToken = writeActorCredential(
    stateRoot,
    "freed-release-verifier",
  );
  acquireLease({
    stateRoot,
    name: "release-verifier",
    owner: "freed-release-verifier",
    ttlMs: 1_000,
    nowMs: 30_000,
    token: "verifier-token-caller-retained-12345678901234567890",
    actorCredentialToken,
  });
  assert.throws(
    () =>
      heartbeatLease({
        stateRoot,
        name: "release-verifier",
        token: "verifier-token-caller-retained-12345678901234567890",
        nowMs: 31_001,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
});

test("lease inspection and CLI show reject dangling and special canonical lease entries", async () => {
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;

  for (const shape of ["dangling-symlink", "fifo"]) {
    const stateRoot = temporaryStateRoot();
    const paths = automationControlPaths(stateRoot);
    mkdirSync(paths.leases, { recursive: true, mode: 0o700 });
    chmodSync(paths.leases, 0o700);
    const leasePath = path.join(paths.leases, `${name}.lease`);
    if (shape === "dangling-symlink") {
      symlinkSync(path.join(paths.leases, "missing-lease"), leasePath);
    } else {
      execFileSync("mkfifo", [leasePath]);
      chmodSync(leasePath, 0o600);
    }

    assert.throws(
      () => inspectLease({ stateRoot, name }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "lease_permissions_invalid",
      `${shape} must not be reported as an absent lease`,
    );

    const cli = await spawnCli(
      ["lease", "show", "--state-root", stateRoot, "--name", name],
      { supplyLeaseToken: false },
    );
    assert.equal(cli.code, 1);
    assert.equal(cli.stdout, "");
    const failure = JSON.parse(cli.stderr);
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, "lease_permissions_invalid");
    assert.equal(
      lstatSync(leasePath).isSymbolicLink(),
      shape === "dangling-symlink",
    );
    assert.equal(lstatSync(leasePath).isFIFO(), shape === "fifo");
  }
});

test("private lease readers reject FIFOs symlinks unsafe ancestry and invalid UTF-8", () => {
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;

  for (const shape of ["fifo", "symlink", "invalid-utf8"]) {
    const stateRoot = temporaryStateRoot();
    const paths = automationControlPaths(stateRoot);
    const transactions = path.join(paths.leases, ".transactions");
    mkdirSync(transactions, { recursive: true, mode: 0o700 });
    chmodSync(transactions, 0o700);
    const active = path.join(transactions, `${name}.json`);
    if (shape === "fifo") {
      execFileSync("mkfifo", [active]);
      chmodSync(active, 0o600);
    } else if (shape === "symlink") {
      const target = path.join(stateRoot, "transaction-target.json");
      writeFileSync(target, "{}\n", { mode: 0o600 });
      symlinkSync(target, active);
    } else {
      writeFileSync(active, Buffer.from([0xff]), { mode: 0o600 });
    }
    const startedAt = Date.now();
    assert.throws(
      () => inspectLease({ stateRoot, name, nowMs: 40_000 }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "lease_transaction_invalid",
    );
    assert.ok(Date.now() - startedAt < 1_000);
  }

  const ancestryRoot = temporaryStateRoot();
  const ancestryPaths = automationControlPaths(ancestryRoot);
  const externalTransactions = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-lease-transactions-")),
  );
  chmodSync(externalTransactions, 0o700);
  writeFileSync(path.join(externalTransactions, `${name}.json`), "{}\n", {
    mode: 0o600,
  });
  mkdirSync(ancestryPaths.leases, { recursive: true, mode: 0o700 });
  chmodSync(ancestryPaths.leases, 0o700);
  rmSync(path.join(ancestryPaths.leases, ".transactions"), {
    recursive: true,
  });
  symlinkSync(
    externalTransactions,
    path.join(ancestryPaths.leases, ".transactions"),
    "dir",
  );
  assert.throws(
    () => inspectLease({ stateRoot: ancestryRoot, name, nowMs: 40_000 }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "invalid_state_permissions",
  );

});

test("dangling active lease transaction symlinks fail closed before authority", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const token = `dangling-active-transaction-${"x".repeat(32)}`;
  acquireLeaseLive({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("dangling-active-acquire"),
    ttlMs: 60_000,
    token,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    nextLeaseOperationId("dangling-active-placeholder"),
  );
  symlinkSync(
    path.join(path.dirname(transactionPaths.active), "missing-target.json"),
    transactionPaths.active,
  );
  let callbackEntered = false;

  assert.throws(
    () =>
      withMutationLeaseAuthority(
        {
          stateRoot,
          actor,
          leaseName: name,
          leaseToken: token,
        },
        () => {
          callbackEntered = true;
        },
      ),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_invalid",
  );
  assert.equal(callbackEntered, false);
  assert.equal(lstatSync(transactionPaths.active).isSymbolicLink(), true);
});

test("lease cleanup archive accounting enforces count, bytes, age, local device, and free headroom", () => {
  const stateRoot = temporaryStateRoot();
  const archivePath = writeLeaseCleanupCapacityFixture(stateRoot);
  const nowMs = Date.parse("2026-07-18T12:00:00.000Z");
  utimesSync(archivePath, new Date(nowMs - 2_000), new Date(nowMs - 2_000));

  const healthy = inspectLeaseCleanupArchiveCapacity(stateRoot, { nowMs });
  assert.equal(healthy.ready, true);
  assert.equal(healthy.count, 1);
  assert.equal(healthy.bytes, 3);
  assert.equal(healthy.oldestAgeMs, 2_000);
  assert.ok(healthy.availableBytes > 0);
  assert.notEqual(healthy.filesystemType, "unknown");

  const projected = inspectLeaseCleanupArchiveCapacity(stateRoot, {
    nowMs,
    reservation: {
      entries: 2,
      bytes: 5,
      oldestMtimeMs: nowMs - 3_000,
    },
    limits: { maxEntries: 2, maxBytes: 7, maxAgeMs: 2_999 },
  });
  assert.equal(projected.ready, false);
  assert.equal(projected.projectedCount, 3);
  assert.equal(projected.projectedBytes, 8);
  assert.equal(projected.projectedOldestAgeMs, 3_000);
  assert.match(projected.problems.join("\n"), /entry limit/);
  assert.match(projected.problems.join("\n"), /byte limit/);
  assert.match(projected.problems.join("\n"), /oldest-age limit/);

  const countBound = inspectLeaseCleanupArchiveCapacity(stateRoot, {
    nowMs,
    limits: { maxEntries: 0 },
  });
  assert.equal(countBound.ready, false);
  assert.match(countBound.problems.join("\n"), /entry limit/);

  const byteBound = inspectLeaseCleanupArchiveCapacity(stateRoot, {
    nowMs,
    limits: { maxBytes: 2 },
  });
  assert.equal(byteBound.ready, false);
  assert.match(byteBound.problems.join("\n"), /byte limit/);

  const ageBound = inspectLeaseCleanupArchiveCapacity(stateRoot, {
    nowMs,
    limits: { maxAgeMs: 1_999 },
  });
  assert.equal(ageBound.ready, false);
  assert.match(ageBound.problems.join("\n"), /oldest-age limit/);

  const freeBound = inspectLeaseCleanupArchiveCapacity(stateRoot, {
    nowMs,
    limits: { minFreeBytes: Number.MAX_SAFE_INTEGER },
  });
  assert.equal(freeBound.ready, false);
  assert.match(freeBound.problems.join("\n"), /free-space headroom/);
});

test("lease archive capacity counts retained lease directories and record bytes", () => {
  const stateRoot = temporaryStateRoot();
  const fileArchive = writeLeaseCleanupCapacityFixture(stateRoot);
  const stateArchiveRoot = path.join(
    automationControlPaths(stateRoot).leases,
    ".lease-state-quarantine",
  );
  const retainedDirectory = path.join(
    stateArchiveRoot,
    `${"c".repeat(64)}.${"d".repeat(64)}.lease`,
  );
  mkdirSync(retainedDirectory, { mode: 0o700 });
  const retainedRecord = path.join(retainedDirectory, "lease.json");
  writeFileSync(retainedRecord, '{"retained":true}\n', { mode: 0o600 });
  const nowMs = Date.parse("2026-07-18T12:00:00.000Z");
  const old = new Date(nowMs - 4_000);
  utimesSync(retainedDirectory, old, old);
  utimesSync(retainedRecord, old, old);
  utimesSync(fileArchive, new Date(nowMs - 2_000), new Date(nowMs - 2_000));

  const inspection = inspectLeaseCleanupArchiveCapacity(stateRoot, { nowMs });
  assert.equal(inspection.ready, true);
  assert.equal(inspection.count, 2);
  assert.equal(
    inspection.bytes,
    Buffer.byteLength("{}\n") + Buffer.byteLength('{"retained":true}\n'),
  );
  assert.equal(inspection.oldestAgeMs, 4_000);
});

test("lease cleanup generation digests preserve bigint device and inode identity", () => {
  const bytes = Buffer.from("bigint-generation\n");
  const identity = {
    dev: 9_007_199_254_740_992n,
    ino: 9_007_199_254_740_992n,
    mode: 0o100600,
    nlink: 1,
    uid: process.getuid(),
    gid: process.getgid(),
    size: bytes.length,
  };
  const first = leaseCleanupGenerationDigestForIdentity(
    "/private/control/leases/source.json",
    identity,
    bytes,
  );
  const second = leaseCleanupGenerationDigestForIdentity(
    "/private/control/leases/source.json",
    { ...identity, ino: identity.ino + 1n },
    bytes,
  );
  assert.notEqual(first, second);
  const source = readFileSync(
    path.join(__dirname, "lib", "automation-control.mjs"),
    "utf8",
  );
  assert.match(
    source,
    /device: BigInt\(snapshot\.identity\.dev\)\.toString\(\)/,
  );
  assert.match(
    source,
    /inode: BigInt\(snapshot\.identity\.ino\)\.toString\(\)/,
  );
});

test("lease cleanup writes exact bigint archive generation names", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = nextLeaseOperationId("exact-generation-name");
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  );
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    nowMs: Date.parse("2026-07-18T12:30:00.000Z"),
    token: `exact-generation-name-${"x".repeat(48)}`,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const exactArchivePaths = exactLeaseCleanupQuarantines(
    transactionPaths.after,
    operationId,
  );
  assert.equal(
    exactArchivePaths.length,
    1,
    "the after staging generation must have one exact archive name",
  );
});

test("lease cleanup archive capacity fails before any new transaction staging", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const operationId = nextLeaseOperationId("archive-capacity-acquire");
  const nowMs = Date.parse("2026-07-18T12:00:00.000Z");
  const archivePath = writeLeaseCleanupCapacityFixture(stateRoot);
  const old = new Date(nowMs - 367 * 24 * 60 * 60 * 1_000);
  utimesSync(archivePath, old, old);
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  );

  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs,
        token: `archive-capacity-${"x".repeat(48)}`,
        actorCredentialToken,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_archive_capacity_exceeded" &&
      /oldest-age limit/.test(error.message),
  );
  assert.equal(existsSync(transactionPaths.before), false);
  assert.equal(existsSync(transactionPaths.after), false);
  assert.equal(existsSync(transactionPaths.active), false);
  assert.equal(existsSync(automationControlPaths(stateRoot).events), false);
});

test("exported archive inspection is read-only when archive storage is missing", () => {
  const stateRoot = temporaryUncutoverStateRoot();
  const before = snapshotFilesystemEntry(stateRoot);
  assert.throws(
    () => inspectLeaseCleanupArchiveCapacity(stateRoot),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_archive_capacity_invalid",
  );
  assert.deepEqual(snapshotFilesystemEntry(stateRoot), before);
});

test("planned stale receipt age is admitted before staging", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const token = `stale-receipt-age-${"x".repeat(48)}`;
  const startedAt = Date.parse("2026-07-18T12:00:00.000Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("stale-receipt-age-acquire"),
    ttlMs: 30 * 60_000,
    nowMs: startedAt,
    token,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const heartbeatOperationIds = [];
  for (let index = 0; index < 8; index += 1) {
    const heartbeatOperationId = nextLeaseOperationId(
      `stale-receipt-age-${index}`,
    );
    heartbeatOperationIds.push(heartbeatOperationId);
    heartbeatLeaseMutation({
      stateRoot,
      name,
      operationId: heartbeatOperationId,
      token,
      ttlMs: 30 * 60_000,
      nowMs: startedAt + index + 1,
    });
  }
  const receiptDirectory = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    nextLeaseOperationId("unused-receipt-path"),
  );
  const heartbeatReceiptDirectory = path.dirname(receiptDirectory.receipt);
  const heartbeatReceipts = readdirSync(heartbeatReceiptDirectory)
    .filter((entry) => entry.startsWith(`${name}.heartbeat.`))
    .sort();
  assert.equal(heartbeatReceipts.length, 8);
  const stalePath = path.join(
    heartbeatReceiptDirectory,
    `${name}.heartbeat.${heartbeatOperationIds[0]}.json`,
  );
  assert.equal(heartbeatReceipts.includes(path.basename(stalePath)), true);
  const tooOld = new Date(startedAt - 367 * 24 * 60 * 60 * 1_000);
  utimesSync(stalePath, tooOld, tooOld);
  const operationId = nextLeaseOperationId("stale-receipt-age-current");
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    operationId,
  );
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        token,
        ttlMs: 30 * 60_000,
        nowMs: startedAt + 10,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_archive_capacity_exceeded" &&
      /oldest-age limit/.test(error.message),
  );
  assert.equal(existsSync(transactionPaths.before), false);
  assert.equal(existsSync(transactionPaths.after), false);
  assert.equal(existsSync(transactionPaths.active), false);
});

test("pending lease WAL blocks another lease and preserves exact recovery headroom", () => {
  const stateRoot = temporaryStateRoot();
  const actorA = "freed-release-verifier";
  const actorB = "freed-runtime-observer";
  const nameA = AUTOMATION_ACTOR_POLICIES[actorA].leaseName;
  const nameB = AUTOMATION_ACTOR_POLICIES[actorB].leaseName;
  const operationA = nextLeaseOperationId("pending-reservation-a");
  const operationB = nextLeaseOperationId("pending-reservation-b");
  const tokenA = `pending-reservation-a-${"x".repeat(40)}`;
  const tokenB = `pending-reservation-b-${"y".repeat(40)}`;
  const nowMs = Date.parse("2026-07-18T13:00:00.000Z");
  const credentialA = writeActorCredential(stateRoot, actorA);
  const credentialB = writeActorCredential(stateRoot, actorB);
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name: nameA,
        owner: actorA,
        operationId: operationA,
        ttlMs: 60_000,
        nowMs,
        token: tokenA,
        actorCredentialToken: credentialA,
        checkpoint: throwAtLeaseCheckpoint("lease-prepared"),
      }),
    /lease checkpoint lease-prepared/,
  );
  const nearAgePath = writeLeaseCleanupCapacityFixture(stateRoot, {
    operationId: "c".repeat(64),
    generationDigest: "d".repeat(64),
    bytes: Buffer.from("near-age\n"),
  });
  const nearAge = new Date(nowMs - 365 * 24 * 60 * 60 * 1_000);
  utimesSync(nearAgePath, nearAge, nearAge);
  const beforeB = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name: nameB,
        owner: actorB,
        operationId: operationB,
        ttlMs: 60_000,
        nowMs: nowMs + 1,
        token: tokenB,
        actorCredentialToken: credentialB,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_pending",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeB);
  const recovered = acquireLeaseMutation({
    stateRoot,
    name: nameA,
    owner: actorA,
    operationId: operationA,
    ttlMs: 60_000,
    nowMs: nowMs + 2,
    token: tokenA,
    actorCredentialToken: credentialA,
  });
  assert.equal(recovered.acquired, true);
  assert.equal(existsSync(nearAgePath), true);
});

test("unexplained transaction entries fail closed before staging", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const token = `unexplained-transaction-${"x".repeat(40)}`;
  const nowMs = Date.parse("2026-07-18T13:30:00.000Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("unexplained-entry-acquire"),
    ttlMs: 60_000,
    nowMs,
    token,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const operationId = nextLeaseOperationId("unexplained-entry-heartbeat");
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    operationId,
  );
  const unexplained = path.join(
    path.dirname(transactionPaths.active),
    "unknown.json",
  );
  writeFileSync(unexplained, "{}\n", { mode: 0o600 });
  const before = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        token,
        ttlMs: 60_000,
        nowMs: nowMs + 1,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_pending",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), before);
  assert.equal(existsSync(transactionPaths.active), false);
});

test("lease receipt retention rejects hostile entries before any authority mutation", () => {
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const fixtures = [
    "fifo",
    "symlink",
    "dangling-symlink",
    "permissive-file",
    "hard-link",
    "malformed-json",
    "name-mismatch",
    "path-mismatch",
  ];

  for (const fixture of fixtures) {
    const stateRoot = temporaryStateRoot();
    const token = `hostile-receipt-${fixture}-${"x".repeat(48)}`;
    const startedAt = Date.now();
    acquireLeaseMutation({
      stateRoot,
      name,
      owner: actor,
      operationId: nextLeaseOperationId(`${fixture}-acquire`),
      ttlMs: 30 * 60_000,
      nowMs: startedAt,
      token,
      actorCredentialToken: writeActorCredential(stateRoot, actor),
    });
    const validOperationId = nextLeaseOperationId(`${fixture}-valid`);
    heartbeatLeaseMutation({
      stateRoot,
      name,
      operationId: validOperationId,
      token,
      ttlMs: 30 * 60_000,
      nowMs: startedAt + 1,
    });
    const validReceipt = leaseTransactionPaths(
      stateRoot,
      name,
      "heartbeat",
      validOperationId,
    ).receipt;
    const validReceiptBytes = readFileSync(validReceipt);
    const hostileOperationId = nextLeaseOperationId(`${fixture}-hostile`);
    const hostileReceipt = leaseTransactionPaths(
      stateRoot,
      name,
      "heartbeat",
      hostileOperationId,
    ).receipt;

    if (fixture === "fifo") {
      execFileSync("mkfifo", [hostileReceipt]);
      chmodSync(hostileReceipt, 0o600);
    } else if (fixture === "symlink") {
      symlinkSync(validReceipt, hostileReceipt);
    } else if (fixture === "dangling-symlink") {
      symlinkSync(
        path.join(path.dirname(hostileReceipt), "missing-receipt.json"),
        hostileReceipt,
      );
    } else if (fixture === "hard-link") {
      linkSync(validReceipt, hostileReceipt);
    } else if (fixture === "malformed-json") {
      writeFileSync(hostileReceipt, "{\n", { mode: 0o600 });
    } else if (fixture === "name-mismatch") {
      const transaction = JSON.parse(validReceiptBytes.toString("utf8"));
      transaction.name = "runtime-observer";
      writeFileSync(
        hostileReceipt,
        `${JSON.stringify(transaction, null, 2)}\n`,
        { mode: 0o600 },
      );
    } else {
      writeFileSync(hostileReceipt, validReceiptBytes, { mode: 0o600 });
      if (fixture === "permissive-file") {
        chmodSync(hostileReceipt, 0o644);
      }
    }

    const attemptedOperationId = nextLeaseOperationId(`${fixture}-attempt`);
    const attemptedPaths = leaseTransactionPaths(
      stateRoot,
      name,
      "heartbeat",
      attemptedOperationId,
    );
    const before = snapshotLeaseAuthorityState(stateRoot);
    assert.throws(
      () =>
        heartbeatLeaseMutation({
          stateRoot,
          name,
          operationId: attemptedOperationId,
          token,
          ttlMs: 30 * 60_000,
          nowMs: startedAt + 2,
        }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "lease_transaction_invalid",
      `${fixture} must fail before preparing a lease transaction`,
    );
    assert.deepEqual(
      snapshotLeaseAuthorityState(stateRoot),
      before,
      `${fixture} must leave lease, event, receipt, staging, and WAL state unchanged`,
    );
    for (const filePath of Object.values(attemptedPaths)) {
      assert.equal(existsSync(filePath), false);
    }
  }
});

test("lease receipt pruning preserves the current retry under tied mtimes", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = "caller-retained-receipt-retention-token-1234567890";
  const startedAt = Date.parse("2026-07-10T17:00:00Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: "aa".repeat(32),
    ttlMs: 30 * 60_000,
    nowMs: startedAt,
    token,
    actorCredentialToken,
  });

  const retainedOperationIds = [];
  for (let index = 0; index < 8; index += 1) {
    const operationId = createHash("sha256")
      .update(`retained-heartbeat:${index}`)
      .digest("hex");
    retainedOperationIds.push(operationId);
    heartbeatLeaseMutation({
      stateRoot,
      name,
      operationId,
      token,
      ttlMs: 30 * 60_000,
      nowMs: startedAt + (index + 1) * 1_000,
    });
  }

  const currentOperationId = "ff".repeat(32);
  const currentReceipt = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    currentOperationId,
  ).receipt;
  const tiedTime = new Date("2026-01-01T00:00:00.000Z");
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId: currentOperationId,
        token,
        ttlMs: 30 * 60_000,
        nowMs: startedAt + 9_000,
        checkpoint: (phase) => {
          if (phase !== "lease-receipt-written") return;
          const receiptDirectory = path.dirname(currentReceipt);
          for (const entry of readdirSync(receiptDirectory)) {
            if (
              entry.startsWith(`${name}.heartbeat.`) &&
              entry.endsWith(".json")
            ) {
              utimesSync(
                path.join(receiptDirectory, entry),
                tiedTime,
                tiedTime,
              );
            }
          }
          throw new Error("receipt retention checkpoint");
        },
      }),
    /receipt retention checkpoint/,
  );

  const recovered = heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: currentOperationId,
    token,
    ttlMs: 30 * 60_000,
    nowMs: startedAt + 10_000,
  });
  assert.equal(recovered.recovered, true);
  assert.equal(existsSync(currentReceipt), true);
  const heartbeatReceipts = readdirSync(path.dirname(currentReceipt)).filter(
    (entry) =>
      entry.startsWith(`${name}.heartbeat.`) && entry.endsWith(".json"),
  );
  const expectedReceipts = [
    path.basename(currentReceipt),
    ...retainedOperationIds
      .slice(-7)
      .map((operationId) => `${name}.heartbeat.${operationId}.json`)
  ].sort();
  assert.deepEqual(heartbeatReceipts.sort(), expectedReceipts);
  const archivedReceipts = leaseCleanupQuarantines(
    currentReceipt,
    currentOperationId,
  );
  assert.equal(archivedReceipts.length, 1);
  const archivedReceipt = JSON.parse(readFileSync(archivedReceipts[0], "utf8"));
  const expectedArchivedOperationId = retainedOperationIds[0];
  assert.equal(archivedReceipt.operationId, expectedArchivedOperationId);
  const archivedReceiptsBeforeReplay = snapshotFilesystemEntry(
    leaseCleanupQuarantineDirectory(currentReceipt),
  );

  const eventsBeforeReplay = readFileSync(
    automationControlPaths(stateRoot).events,
  );
  const replay = heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: currentOperationId,
    token,
    ttlMs: 30 * 60_000,
    nowMs: startedAt + 11_000,
  });
  assert.equal(replay.recovered, true);
  assert.deepEqual(
    readFileSync(automationControlPaths(stateRoot).events),
    eventsBeforeReplay,
  );
  assert.deepEqual(
    snapshotFilesystemEntry(leaseCleanupQuarantineDirectory(currentReceipt)),
    archivedReceiptsBeforeReplay,
  );
});

test("lease receipt pruning preserves a replacement installed after final descriptor close", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `receipt-swap-${"x".repeat(48)}`;
  const startedAt = Date.parse("2026-07-11T01:00:00Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("receipt-swap-acquire"),
    ttlMs: 30 * 60_000,
    nowMs: startedAt,
    token,
    actorCredentialToken,
  });
  for (let index = 0; index < 8; index += 1) {
    heartbeatLeaseMutation({
      stateRoot,
      name,
      operationId: nextLeaseOperationId(`receipt-swap-seed-${index}`),
      token,
      ttlMs: 30 * 60_000,
      nowMs: startedAt + index + 1,
    });
  }

  const operationId = nextLeaseOperationId("receipt-swap-current");
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    operationId,
  );
  let swap = null;
  const savedPath = path.join(stateRoot, ".receipt-swap-saved");
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        token,
        ttlMs: 30 * 60_000,
        nowMs: startedAt + 9,
        checkpoint: (phase, details) => {
          if (
            swap !== null ||
            phase !== "lease-cleanup-admitted" ||
            !details.filePath.includes(
              `${path.sep}.transaction-receipts${path.sep}`,
            )
          ) {
            return;
          }
          const stalePath = details.filePath;
          const staleBytes = readFileSync(stalePath);
          const currentBytes = readFileSync(transactionPaths.receipt);
          renameSync(stalePath, savedPath);
          renameSync(transactionPaths.receipt, stalePath);
          swap = {
            currentBytes,
            quarantinePath: details.quarantinePath,
            stalePath,
            staleBytes,
          };
        },
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.ok(swap);
  assert.equal(existsSync(transactionPaths.active), true);
  assert.equal(existsSync(transactionPaths.receipt), false);
  assert.equal(existsSync(swap.quarantinePath), false);
  assert.deepEqual(readFileSync(swap.stalePath), swap.currentBytes);
  renameSync(swap.stalePath, transactionPaths.receipt);
  renameSync(savedPath, swap.stalePath);
  assert.deepEqual(readFileSync(swap.stalePath), swap.staleBytes);

  const recovered = heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId,
    token,
    ttlMs: 30 * 60_000,
    nowMs: startedAt + 10,
  });
  assert.equal(recovered.recovered, true);
  assert.equal(existsSync(transactionPaths.active), false);
  assert.equal(existsSync(transactionPaths.receipt), true);
  assert.equal(existsSync(swap.quarantinePath), true);
  assert.deepEqual(readFileSync(swap.quarantinePath), swap.staleBytes);
});

test("lease receipt terminal archive recovers after rename", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `receipt-quarantine-${"x".repeat(48)}`;
  const startedAt = Date.parse("2026-07-11T01:30:00Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("receipt-quarantine-acquire"),
    ttlMs: 30 * 60_000,
    nowMs: startedAt,
    token,
    actorCredentialToken,
  });
  for (let index = 0; index < 8; index += 1) {
    heartbeatLeaseMutation({
      stateRoot,
      name,
      operationId: nextLeaseOperationId(`receipt-quarantine-seed-${index}`),
      token,
      ttlMs: 30 * 60_000,
      nowMs: startedAt + index + 1,
    });
  }
  const operationId = nextLeaseOperationId("receipt-quarantine-current");
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    operationId,
  );
  let quarantinePath = null;
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        token,
        ttlMs: 30 * 60_000,
        nowMs: startedAt + 9,
        checkpoint: (phase, details) => {
          if (
            quarantinePath !== null ||
            phase !== "lease-cleanup-quarantined" ||
            !details.filePath.includes(
              `${path.sep}.transaction-receipts${path.sep}`,
            )
          ) {
            return;
          }
          quarantinePath = details.quarantinePath;
          throw new Error("receipt quarantine checkpoint");
        },
      }),
    /receipt quarantine checkpoint/,
  );
  assert.ok(quarantinePath);
  assert.equal(existsSync(quarantinePath), true);
  const archivedBytes = readFileSync(quarantinePath);
  assert.equal(existsSync(transactionPaths.active), true);

  const recovered = heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId,
    token,
    ttlMs: 30 * 60_000,
    nowMs: startedAt + 10,
  });
  assert.equal(recovered.recovered, true);
  assert.equal(existsSync(quarantinePath), true);
  assert.deepEqual(readFileSync(quarantinePath), archivedBytes);
  assert.equal(existsSync(transactionPaths.active), false);
  assert.equal(existsSync(transactionPaths.receipt), true);
});

test("lease cleanup preserves a replacement installed after terminal archive validation", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `quarantine-validation-swap-${"x".repeat(40)}`;
  const startedAt = Date.parse("2026-07-11T01:45:00Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("quarantine-validation-swap-acquire"),
    ttlMs: 30 * 60_000,
    nowMs: startedAt,
    token,
    actorCredentialToken,
  });
  for (let index = 0; index < 8; index += 1) {
    heartbeatLeaseMutation({
      stateRoot,
      name,
      operationId: nextLeaseOperationId(
        `quarantine-validation-swap-seed-${index}`,
      ),
      token,
      ttlMs: 30 * 60_000,
      nowMs: startedAt + index + 1,
    });
  }

  const operationId = nextLeaseOperationId(
    "quarantine-validation-swap-current",
  );
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    operationId,
  );
  let swap = null;
  const savedPath = path.join(stateRoot, ".quarantine-swap-saved");
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        token,
        ttlMs: 30 * 60_000,
        nowMs: startedAt + 9,
        checkpoint: (phase, details) => {
          if (
            swap !== null ||
            phase !== "lease-cleanup-validated" ||
            !details.filePath.includes(
              `${path.sep}.transaction-receipts${path.sep}`,
            )
          ) {
            return;
          }
          const savedQuarantineBytes = readFileSync(details.quarantinePath);
          const currentBytes = readFileSync(transactionPaths.receipt);
          renameSync(details.quarantinePath, savedPath);
          renameSync(transactionPaths.receipt, details.quarantinePath);
          swap = {
            currentBytes,
            quarantinePath: details.quarantinePath,
            savedQuarantineBytes,
          };
        },
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.ok(swap);
  assert.equal(existsSync(transactionPaths.active), false);
  const terminalArchivePaths = [
    exactLeaseCleanupQuarantine(transactionPaths.before, operationId),
    exactLeaseCleanupQuarantine(transactionPaths.after, operationId),
    exactLeaseCleanupQuarantine(transactionPaths.active, operationId),
  ];
  assert.equal(new Set(terminalArchivePaths).size, 3);
  assert.equal(existsSync(transactionPaths.receipt), false);
  assert.deepEqual(readFileSync(swap.quarantinePath), swap.currentBytes);
  renameSync(swap.quarantinePath, transactionPaths.receipt);
  renameSync(savedPath, swap.quarantinePath);

  const recovered = heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId,
    token,
    ttlMs: 30 * 60_000,
    nowMs: startedAt + 10,
  });
  assert.equal(recovered.recovered, true);
  assert.equal(existsSync(transactionPaths.active), false);
  assert.equal(existsSync(transactionPaths.receipt), true);
  assert.equal(existsSync(swap.quarantinePath), true);
  assert.deepEqual(
    readFileSync(swap.quarantinePath),
    swap.savedQuarantineBytes,
  );
});

test("completed receipt validation precedes every staging cleanup mutation", () => {
  for (const transactionState of ["active", "receipt-only"]) {
    for (const scenario of [
      "request-mismatch",
      "token-mismatch",
      "event-missing",
      "event-conflict",
    ]) {
      const stateRoot = temporaryStateRoot();
      const actor = "freed-release-verifier";
      const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
      const actorCredentialToken = writeActorCredential(stateRoot, actor);
      const token = `receipt-validation-${scenario}-${"x".repeat(40)}`;
      const operationId = nextLeaseOperationId(
        `receipt-validation-${transactionState}-${scenario}`,
      );
      const nowMs = Date.parse("2026-07-11T02:00:00Z");
      assert.throws(
        () =>
          acquireLeaseMutation({
            stateRoot,
            name,
            owner: actor,
            operationId,
            ttlMs: 60_000,
            nowMs,
            token,
            actorCredentialToken,
            checkpoint: throwAtLeaseCheckpoint("lease-receipt-written"),
          }),
        /lease checkpoint lease-receipt-written/,
      );
      const transactionPaths = leaseTransactionPaths(
        stateRoot,
        name,
        "acquire",
        operationId,
      );
      if (transactionState === "receipt-only") {
        rmSync(transactionPaths.active);
      }
      const paths = automationControlPaths(stateRoot);
      if (scenario === "event-missing") {
        writeFileSync(paths.events, "", { mode: 0o600 });
      } else if (scenario === "event-conflict") {
        const events = readControlEvents(stateRoot);
        events[0].data.expiresAt = new Date(nowMs + 1).toISOString();
        writeFileSync(
          paths.events,
          `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
          { mode: 0o600 },
        );
      }
      const before = snapshotLeaseAuthorityState(stateRoot);
      const cleanupQuarantineCountBefore = leaseCleanupQuarantines(
        transactionPaths.after,
        operationId,
      ).length;
      assert.throws(
        () =>
          acquireLeaseMutation({
            stateRoot,
            name,
            owner: actor,
            operationId,
            ttlMs: scenario === "request-mismatch" ? 60_001 : 60_000,
            nowMs: nowMs + 10,
            token:
              scenario === "token-mismatch"
                ? `different-${"y".repeat(48)}`
                : token,
            actorCredentialToken,
          }),
        (error) =>
          isAutomationControlError(error) &&
          error.code ===
            (scenario === "event-conflict"
              ? "control_event_conflict"
              : "lease_transaction_conflict"),
        `${transactionState}:${scenario}`,
      );
      assert.deepEqual(
        snapshotLeaseAuthorityState(stateRoot),
        before,
        `${transactionState}:${scenario}`,
      );
      assert.equal(
        existsSync(transactionPaths.after),
        true,
        `${transactionState}:${scenario}`,
      );
      assert.equal(
        leaseCleanupQuarantines(transactionPaths.after, operationId).length,
        cleanupQuarantineCountBefore,
        `${transactionState}:${scenario}`,
      );
    }
  }
});

test("completed lease receipt recovery binds the exact retained staged state", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `retained-state-replay-${"x".repeat(40)}`;
  const nowMs = Date.parse("2026-07-11T02:30:00Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("retained-state-acquire"),
    ttlMs: 60_000,
    nowMs,
    token,
    actorCredentialToken,
  });
  const operationId = nextLeaseOperationId("retained-state-heartbeat");
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        token,
        ttlMs: 60_000,
        nowMs: nowMs + 1_000,
        checkpoint: throwAtLeaseCheckpoint("lease-receipt-written"),
      }),
    /lease checkpoint lease-receipt-written/,
  );
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    operationId,
  );
  const exactReceiptBytes = readFileSync(transactionPaths.receipt);
  rmSync(transactionPaths.active);
  const forgedReceipt = JSON.parse(exactReceiptBytes.toString("utf8"));
  forgedReceipt.resultReceipt.lease.acquiredAt = new Date(
    nowMs - 1,
  ).toISOString();
  writeFileSync(
    transactionPaths.receipt,
    `${JSON.stringify(forgedReceipt, null, 2)}\n`,
    { mode: 0o600 },
  );
  const events = readEvents(stateRoot);
  const semanticHistory = inspectExactTaskLifecycleHistory(events);
  assert.equal(
    semanticHistory.healthy,
    true,
    semanticHistory.issues.join("\n"),
  );
  const beforeInspection = snapshotLeaseAuthorityState(stateRoot);
  const receiptInspection = inspectLeaseTransactionEventHistory({
    stateRoot,
    events,
  });
  assert.equal(receiptInspection.healthy, false);
  assert.equal(receiptInspection.pendingTransactionArtifactCount, 2);
  assert.equal(existsSync(transactionPaths.before), true);
  assert.equal(existsSync(transactionPaths.after), true);
  assert.match(
    receiptInspection.issues.join("\n"),
    /requires exact recovery|outside its exact retained validated receipt suffix/,
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeInspection);
  const beforeReplay = snapshotLeaseAuthorityState(stateRoot);

  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        token,
        ttlMs: 60_000,
        nowMs: nowMs + 2_000,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict" &&
      /inexact WAL phase lineage/.test(error.message),
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeReplay);

  writeFileSync(transactionPaths.receipt, exactReceiptBytes, { mode: 0o600 });
  const recovered = heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId,
    token,
    ttlMs: 60_000,
    nowMs: nowMs + 3_000,
  });
  assert.equal(recovered.recovered, true);
  assert.equal(
    recovered.lease.heartbeatAt,
    new Date(nowMs + 1_000).toISOString(),
  );
});

test("complete lease WAL recovery validates retained state before cleanup", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `complete-wal-replay-${"x".repeat(40)}`;
  const nowMs = Date.parse("2026-07-11T02:45:00Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("complete-wal-acquire"),
    ttlMs: 60_000,
    nowMs,
    token,
    actorCredentialToken,
  });
  const operationId = nextLeaseOperationId("complete-wal-heartbeat");
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        token,
        ttlMs: 60_000,
        nowMs: nowMs + 1_000,
        checkpoint: throwAtLeaseCheckpoint("lease-receipt-written"),
      }),
    /lease checkpoint lease-receipt-written/,
  );
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    operationId,
  );
  const exactActiveBytes = readFileSync(transactionPaths.active);
  const exactReceiptBytes = readFileSync(transactionPaths.receipt);
  const exactAfterBytes = readFileSync(transactionPaths.after);
  const canonicalLeasePath = path.join(
    automationControlPaths(stateRoot).leases,
    `${name}.lease`,
    "lease.json",
  );
  const exactCanonicalLeaseBytes = readFileSync(canonicalLeasePath);
  const forgedAfter = JSON.parse(exactAfterBytes.toString("utf8"));
  forgedAfter.acquiredAt = new Date(nowMs - 1).toISOString();
  const forgedAfterBytes = Buffer.from(
    `${JSON.stringify(forgedAfter, null, 2)}\n`,
    "utf8",
  );
  const forgedTransaction = JSON.parse(exactActiveBytes.toString("utf8"));
  forgedTransaction.after.recordDigest = createHash("sha256")
    .update(forgedAfterBytes)
    .digest("hex");
  forgedTransaction.after.recordSize = forgedAfterBytes.length;
  forgedTransaction.resultReceipt.lease.acquiredAt = forgedAfter.acquiredAt;
  const forgedBytes = Buffer.from(
    `${JSON.stringify(forgedTransaction, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(transactionPaths.after, forgedAfterBytes, { mode: 0o600 });
  writeFileSync(canonicalLeasePath, forgedAfterBytes, { mode: 0o600 });
  writeFileSync(transactionPaths.active, forgedBytes, { mode: 0o600 });
  writeFileSync(transactionPaths.receipt, forgedBytes, { mode: 0o600 });
  const cleanupCountsBeforeReplay = new Map(
    [
      transactionPaths.before,
      transactionPaths.after,
      transactionPaths.active,
    ].map((filePath) => [
      filePath,
      leaseCleanupQuarantines(filePath, operationId).length,
    ]),
  );
  const beforeReplay = snapshotLeaseAuthorityState(stateRoot);

  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        token,
        ttlMs: 60_000,
        nowMs: nowMs + 2_000,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict" &&
      /inexact WAL phase lineage/.test(error.message),
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeReplay);
  for (const filePath of [
    transactionPaths.before,
    transactionPaths.after,
    transactionPaths.active,
  ]) {
    assert.equal(
      leaseCleanupQuarantines(filePath, operationId).length,
      cleanupCountsBeforeReplay.get(filePath),
    );
  }

  writeFileSync(transactionPaths.active, exactActiveBytes, { mode: 0o600 });
  writeFileSync(transactionPaths.receipt, exactReceiptBytes, { mode: 0o600 });
  writeFileSync(transactionPaths.after, exactAfterBytes, { mode: 0o600 });
  writeFileSync(canonicalLeasePath, exactCanonicalLeaseBytes, { mode: 0o600 });
  const recovered = heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId,
    token,
    ttlMs: 60_000,
    nowMs: nowMs + 3_000,
  });
  assert.equal(recovered.recovered, true);
});

test("staging cleanup rejects a swapped WAL generation against the held source inode", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `staging-swap-${"x".repeat(48)}`;
  const operationId = nextLeaseOperationId("staging-swap-acquire");
  const nowMs = Date.parse("2026-07-11T03:00:00Z");
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs,
        token,
        actorCredentialToken,
        checkpoint: throwAtLeaseCheckpoint("lease-receipt-written"),
      }),
    /lease checkpoint lease-receipt-written/,
  );
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  );
  rmSync(transactionPaths.active);

  const originalStagingBytes = readFileSync(transactionPaths.after);
  const replacementBytes = Buffer.from("replacement staging generation\n");
  let swap = null;
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs: nowMs + 2,
        token,
        actorCredentialToken,
        checkpoint: (phase, details) => {
          if (
            swap !== null ||
            phase !== "lease-cleanup-admitted" ||
            details.filePath !== transactionPaths.after
          ) {
            return;
          }
          rmSync(transactionPaths.after);
          writeFileSync(transactionPaths.after, replacementBytes, {
            mode: 0o600,
          });
          swap = {
            quarantinePath: details.quarantinePath,
          };
        },
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.ok(swap);
  assert.equal(existsSync(swap.quarantinePath), false);
  assert.deepEqual(readFileSync(transactionPaths.after), replacementBytes);
  rmSync(transactionPaths.after);
  writeFileSync(transactionPaths.after, originalStagingBytes, { mode: 0o600 });

  const recovered = acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    nowMs: nowMs + 3,
    token,
    actorCredentialToken,
  });
  assert.equal(recovered.recovered, true);
  assert.equal(existsSync(transactionPaths.after), false);
});

test("lease cleanup quarantine crash retries exactly and preserves unrelated generations", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `quarantine-retry-${"x".repeat(48)}`;
  const operationId = nextLeaseOperationId("quarantine-retry-acquire");
  const nowMs = Date.parse("2026-07-11T04:00:00Z");
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs,
        token,
        actorCredentialToken,
        checkpoint: throwAtLeaseCheckpoint("lease-cleanup-quarantined"),
      }),
    /lease checkpoint lease-cleanup-quarantined/,
  );
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  );
  const quarantines = leaseCleanupQuarantines(
    transactionPaths.after,
    operationId,
  );
  assert.equal(quarantines.length, 4);
  assert.equal(existsSync(transactionPaths.after), false);
  assert.equal(existsSync(transactionPaths.active), true);
  const quarantineDirectory = leaseCleanupQuarantineDirectory(
    transactionPaths.after,
  );
  const unrelatedPath = path.join(
    quarantineDirectory,
    `${"ab".repeat(32)}.${"cd".repeat(32)}.json`,
  );
  writeFileSync(unrelatedPath, "unrelated-generation\n", { mode: 0o600 });
  const unrelatedBytes = readFileSync(unrelatedPath);

  const recovered = acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    nowMs: nowMs + 1,
    token,
    actorCredentialToken,
  });
  assert.equal(recovered.recovered, true);
  assert.equal(existsSync(transactionPaths.active), false);
  assert.equal(existsSync(transactionPaths.after), false);
  assert.equal(
    quarantines.every((filePath) => existsSync(filePath)),
    true,
  );
  assert.equal(
    leaseCleanupQuarantines(transactionPaths.after, operationId).length,
    5,
  );
  assert.deepEqual(readFileSync(unrelatedPath), unrelatedBytes);
});

test("lease cleanup no-overwrite archive preserves a destination created after admission", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `cleanup-collision-${"x".repeat(48)}`;
  const operationId = nextLeaseOperationId("cleanup-collision-acquire");
  const nowMs = Date.parse("2026-07-11T04:15:00Z");
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  );
  let collision = null;
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs,
        token,
        actorCredentialToken,
        checkpoint: (phase, details) => {
          if (
            collision !== null ||
            phase !== "lease-cleanup-admitted" ||
            details.kind !== "staging-after"
          ) {
            return;
          }
          collision = {
            archivePath: details.archivePath,
            archiveBytes: Buffer.from("destination-created-after-admission\n"),
            sourceBytes: readFileSync(transactionPaths.after),
          };
          writeFileSync(collision.archivePath, collision.archiveBytes, {
            mode: 0o600,
          });
        },
        }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.ok(collision);
  assert.deepEqual(readFileSync(transactionPaths.after), collision.sourceBytes);
  assert.deepEqual(readFileSync(collision.archivePath), collision.archiveBytes);
  assert.equal(existsSync(transactionPaths.active), true);

  const beforeReplay = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs: nowMs + 1,
        token,
        actorCredentialToken,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeReplay);
});

test("lease cleanup rejects same-inode byte drift before native rename", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const operationId = nextLeaseOperationId("cleanup-same-inode-drift");
  const nowMs = Date.parse("2026-07-11T04:17:00Z");
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  );
  let drift = null;
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs,
        token: `cleanup-same-inode-${"x".repeat(48)}`,
        actorCredentialToken,
        checkpoint: (phase, details) => {
          if (
            drift !== null ||
            phase !== "lease-cleanup-admitted" ||
            details.kind !== "staging-after"
          ) {
            return;
          }
          const original = readFileSync(details.filePath);
          const inode = lstatSync(details.filePath).ino;
          const changed = Buffer.from(original);
          changed[0] = changed[0] === 0x7b ? 0x5b : 0x7b;
          writeFileSync(details.filePath, changed);
          assert.equal(lstatSync(details.filePath).ino, inode);
          drift = {
            archivePath: details.archivePath,
            changed,
            inode,
            authorityAfterExternalWrite: snapshotLeaseAuthorityState(stateRoot),
          };
        },
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict" &&
      /changed content after descriptor admission/.test(error.message),
  );
  assert.ok(drift);
  assert.equal(lstatSync(transactionPaths.after).ino, drift.inode);
  assert.deepEqual(readFileSync(transactionPaths.after), drift.changed);
  assert.equal(existsSync(drift.archivePath), false);
  assert.deepEqual(
    snapshotLeaseAuthorityState(stateRoot),
    drift.authorityAfterExternalWrite,
  );
});

test("capacity injected after target admission prevents its rename", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = nextLeaseOperationId("cleanup-capacity-after-admission");
  const nowMs = Date.parse("2026-07-11T04:18:00Z");
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  );
  let injected = null;
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs,
        token: `cleanup-capacity-admission-${"x".repeat(40)}`,
        actorCredentialToken: writeActorCredential(stateRoot, actor),
        checkpoint: (phase, details) => {
          if (
            injected !== null ||
            phase !== "lease-cleanup-admitted" ||
            details.kind !== "staging-after"
          ) {
            return;
          }
          const archivePath = path.join(
            path.dirname(details.archivePath),
            `${"e".repeat(64)}.${"f".repeat(64)}.json`,
          );
          writeFileSync(archivePath, "old-capacity\n", { mode: 0o600 });
          const old = new Date(nowMs - 367 * 24 * 60 * 60 * 1_000);
          utimesSync(archivePath, old, old);
          injected = {
            archivePath,
            targetArchivePath: details.archivePath,
            sourceBytes: readFileSync(details.filePath),
          };
        },
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_archive_capacity_exceeded",
  );
  assert.ok(injected);
  assert.deepEqual(readFileSync(transactionPaths.after), injected.sourceBytes);
  assert.equal(existsSync(injected.targetArchivePath), false);
  assert.equal(existsSync(injected.archivePath), true);
});

test("final global capacity check rejects post-rename archive consumption", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = nextLeaseOperationId("cleanup-final-capacity");
  const nowMs = Date.parse("2026-07-11T04:19:00Z");
  const token = `cleanup-final-capacity-${"x".repeat(48)}`;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  let injected = null;
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs,
        token,
        actorCredentialToken,
        checkpoint: (phase, details) => {
          if (
            injected !== null ||
            phase !== "lease-cleanup-validated" ||
            details.kind !== "active-wal"
          ) {
            return;
          }
          const archivePath = path.join(
            path.dirname(details.archivePath),
            `${"1".repeat(64)}.${"2".repeat(64)}.json`,
          );
          writeFileSync(archivePath, "old-final-capacity\n", { mode: 0o600 });
          const old = new Date(nowMs - 367 * 24 * 60 * 60 * 1_000);
          utimesSync(archivePath, old, old);
          injected = archivePath;
        },
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_archive_capacity_exceeded",
  );
  assert.ok(injected);
  assert.equal(existsSync(injected), true);
  const archiveDirectory = path.dirname(injected);
  const archivesBeforeReplay = readdirSync(archiveDirectory).sort();
  const recovered = acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    nowMs: nowMs + 1,
    token,
    actorCredentialToken,
  });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.lease.token, token);
  assert.equal(inspectLease({ stateRoot, name }).owner, actor);
  assert.equal(
    readControlEvents(stateRoot).filter(
      (event) => event.eventId === `lease:${operationId}`,
    ).length,
    1,
  );
  assert.deepEqual(readdirSync(archiveDirectory).sort(), archivesBeforeReplay);
});

test("lease cleanup pins source and destination directory generations across the full plan", async (t) => {
  for (const scenario of ["destination-directory", "source-parent"]) {
    await t.test(scenario, () => {
      const stateRoot = temporaryStateRoot();
      const actor = "freed-release-verifier";
      const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
      const actorCredentialToken = writeActorCredential(stateRoot, actor);
      const operationId = nextLeaseOperationId(`cleanup-${scenario}`);
      const nowMs = Date.parse("2026-07-11T04:20:00Z");
      let swap = null;

      assert.throws(
        () =>
          acquireLeaseMutation({
            stateRoot,
            name,
            owner: actor,
            operationId,
            ttlMs: 60_000,
            nowMs,
            token: `cleanup-${scenario}-${"x".repeat(48)}`,
            actorCredentialToken,
            checkpoint: (phase, details) => {
              if (
                swap !== null ||
                phase !== "lease-cleanup-admitted" ||
                details.kind !== "staging-before"
              ) {
                return;
              }
              const sourceBytes = readFileSync(details.filePath);
              if (scenario === "destination-directory") {
                const directory = path.dirname(details.archivePath);
                const displaced = `${directory}.displaced`;
                renameSync(directory, displaced);
                mkdirSync(directory, { mode: 0o700 });
                swap = { sourceBytes, sourcePath: details.filePath, displaced };
              } else {
                const directory = path.dirname(details.filePath);
                const displaced = `${directory}.displaced`;
                renameSync(directory, displaced);
                mkdirSync(directory, { mode: 0o700 });
                mkdirSync(path.join(directory, ".lease-cleanup-quarantine"), {
                  mode: 0o700,
                });
                swap = {
                  sourceBytes,
                  sourcePath: path.join(
                    displaced,
                    path.basename(details.filePath),
                  ),
                  displaced,
                };
              }
            },
          }),
        (error) =>
          isAutomationControlError(error) &&
          error.code === "lease_transaction_conflict" &&
          /changed after descriptor admission/.test(error.message),
      );
      assert.ok(swap);
      assert.deepEqual(readFileSync(swap.sourcePath), swap.sourceBytes);
      assert.equal(
        readdirSync(swap.displaced, { recursive: true }).some((entry) =>
          String(entry).startsWith(`${operationId}.`),
        ),
        false,
      );
    });
  }
});

test("descriptor-relative archive ancestry rejects symlinked intermediate directories", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const paths = automationControlPaths(stateRoot);
  const outside = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-archive-outside-")),
  );
  chmodSync(outside, 0o700);
  rmSync(paths.leases, { recursive: true });
  symlinkSync(outside, paths.leases);
  const outsideBefore = snapshotFilesystemEntry(outside);
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId: nextLeaseOperationId("archive-symlink-ancestry"),
        ttlMs: 60_000,
        nowMs: Date.parse("2026-07-11T04:21:00Z"),
        token: `archive-symlink-ancestry-${"x".repeat(40)}`,
        actorCredentialToken,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "invalid_state_permissions",
  );
  assert.deepEqual(snapshotFilesystemEntry(outside), outsideBefore);
  assert.equal(lstatSync(paths.leases).isSymbolicLink(), true);
});

test("descriptor-relative archive ancestry rejects a swapped held parent without outside writes", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const paths = automationControlPaths(stateRoot);
  const outside = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-archive-parent-outside-")),
  );
  chmodSync(outside, 0o700);
  const outsideBefore = snapshotFilesystemEntry(outside);
  let displaced = null;
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId: nextLeaseOperationId("archive-parent-swap"),
        ttlMs: 60_000,
        nowMs: Date.parse("2026-07-11T04:22:00Z"),
        token: `archive-parent-swap-${"x".repeat(48)}`,
        actorCredentialToken,
        checkpoint: (phase, details) => {
          if (
            displaced !== null ||
            phase !== "lease-directory-parent-synced" ||
            details.directoryPath !== path.join(paths.leases, ".transactions")
          ) {
            return;
          }
          displaced = `${paths.leases}.displaced`;
          renameSync(paths.leases, displaced);
          symlinkSync(outside, paths.leases);
        },
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.ok(displaced);
  assert.deepEqual(snapshotFilesystemEntry(outside), outsideBefore);
  assert.equal(existsSync(path.join(displaced, ".transactions")), true);
});

test("durable archive ancestry repairs EEXIST parent syncs on retry", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const token = `archive-eexist-sync-${"x".repeat(48)}`;
  const nowMs = Date.parse("2026-07-11T04:23:00Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("archive-eexist-acquire"),
    ttlMs: 60_000,
    nowMs,
    token,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const parentSyncs = [];
  heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: nextLeaseOperationId("archive-eexist-heartbeat"),
    token,
    ttlMs: 60_000,
    nowMs: nowMs + 1,
    checkpoint: (phase, details) => {
      if (phase === "lease-directory-parent-synced") {
        parentSyncs.push(details);
      }
    },
  });
  assert.ok(parentSyncs.length >= 5);
  assert.equal(
    parentSyncs.every((details) => details.created === false),
    true,
  );
});

test("lease cleanup descriptor readback rejects a same-name destination inode replacement", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const operationId = nextLeaseOperationId("cleanup-readback-replacement");
  const nowMs = Date.parse("2026-07-11T04:25:00Z");
  let replacement = null;

  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs,
        token: `cleanup-readback-${"x".repeat(48)}`,
        actorCredentialToken,
        checkpoint: (phase, details) => {
          if (
            replacement !== null ||
            phase !== "lease-cleanup-renamed" ||
            details.kind !== "staging-after"
          ) {
            return;
          }
          const displacedPath = `${details.archivePath}.displaced`;
          const originalBytes = readFileSync(details.archivePath);
          const replacementBytes = Buffer.from("same-name-replacement\n");
          renameSync(details.archivePath, displacedPath);
          writeFileSync(details.archivePath, replacementBytes, { mode: 0o600 });
          replacement = {
            archivePath: details.archivePath,
            displacedPath,
            originalBytes,
            replacementBytes,
          };
        },
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.ok(replacement);
  assert.deepEqual(
    readFileSync(replacement.archivePath),
    replacement.replacementBytes,
  );
  assert.deepEqual(
    readFileSync(replacement.displacedPath),
    replacement.originalBytes,
  );
});

test("lease cleanup syncs destination before source and rejects post-plan archives", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const nowMs = Date.parse("2026-07-11T04:27:00Z");
  const successfulOperationId = nextLeaseOperationId("cleanup-sync-order");
  const phasesByKind = new Map();
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: successfulOperationId,
    ttlMs: 60_000,
    nowMs,
    token: `cleanup-sync-order-${"x".repeat(48)}`,
    actorCredentialToken,
    checkpoint: (phase, details) => {
      if (!phase.startsWith("lease-cleanup-") || details?.kind === undefined) {
        return;
      }
      const phases = phasesByKind.get(details.kind) ?? [];
      phases.push(phase);
      phasesByKind.set(details.kind, phases);
    },
  });
  for (const phases of phasesByKind.values()) {
    const archiveIndex = phases.indexOf("lease-cleanup-archive-synced");
    const sourceIndex = phases.indexOf("lease-cleanup-source-synced");
    assert.ok(archiveIndex >= 0);
    assert.ok(sourceIndex > archiveIndex);
  }

  const injectedOperationId = nextLeaseOperationId(
    "cleanup-post-plan-injection",
  );
  let injectedPath = null;
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId: injectedOperationId,
        ttlMs: 60_000,
        nowMs: nowMs + 1,
        token: `cleanup-sync-order-${"x".repeat(48)}`,
        checkpoint: (phase, details) => {
          if (injectedPath !== null || phase !== "lease-cleanup-validated") {
            return;
          }
          injectedPath = path.join(
            path.dirname(details.archivePath),
            `${injectedOperationId}.${"f".repeat(64)}.json`,
          );
          writeFileSync(injectedPath, "{}\n", { mode: 0o600 });
        },
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_conflict" &&
      /archive set changed after immutable planning/.test(error.message),
  );
  assert.ok(injectedPath);
  assert.equal(existsSync(injectedPath), true);
});

test("active WAL cleanup rejects a raw replacement against the held source inode", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `active-wal-swap-${"x".repeat(48)}`;
  const operationId = nextLeaseOperationId("active-wal-swap-acquire");
  const nowMs = Date.parse("2026-07-11T04:30:00Z");
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  );
  let swap = null;
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs,
        token,
        actorCredentialToken,
        checkpoint: (phase, details) => {
          if (
            swap !== null ||
            phase !== "lease-cleanup-admitted" ||
            details.kind !== "active-wal"
          ) {
            return;
          }
          const savedActivePath = `${transactionPaths.active}.saved`;
          const rawReplacement = Buffer.from("raw-active-wal-replacement\n");
          const originalBytes = readFileSync(transactionPaths.active);
          renameSync(transactionPaths.active, savedActivePath);
          writeFileSync(transactionPaths.active, rawReplacement, {
            mode: 0o600,
          });
          swap = {
            archivePath: details.archivePath,
            originalBytes,
            rawReplacement,
            savedActivePath,
          };
        },
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.ok(swap);
  assert.equal(existsSync(transactionPaths.active), true);
  assert.equal(existsSync(swap.archivePath), false);
  assert.deepEqual(readFileSync(transactionPaths.active), swap.rawReplacement);
  assert.deepEqual(readFileSync(swap.savedActivePath), swap.originalBytes);
});

test("lease cleanup retries every rename and directory sync crash idempotently", () => {
  for (const targetKind of ["staging-after", "active-wal"]) {
    for (const phase of [
      "lease-cleanup-renamed",
      "lease-cleanup-source-synced",
      "lease-cleanup-archive-synced",
    ]) {
      const stateRoot = temporaryStateRoot();
      const actor = "freed-release-verifier";
      const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
      const actorCredentialToken = writeActorCredential(stateRoot, actor);
      const token = `cleanup-crash-${targetKind}-${phase}-${"x".repeat(24)}`;
      const operationId = nextLeaseOperationId(
        `cleanup-crash-${targetKind}-${phase}`,
      );
      const nowMs = Date.parse("2026-07-11T04:45:00Z");
      const transactionPaths = leaseTransactionPaths(
        stateRoot,
        name,
        "acquire",
        operationId,
      );
      let crashedArchivePath = null;
      assert.throws(
        () =>
          acquireLeaseMutation({
            stateRoot,
            name,
            owner: actor,
            operationId,
            ttlMs: 60_000,
            nowMs,
            token,
            actorCredentialToken,
            checkpoint: (checkpointPhase, details) => {
              if (
                crashedArchivePath === null &&
                checkpointPhase === phase &&
                details.kind === targetKind
              ) {
                crashedArchivePath = details.archivePath;
                throw new Error(`cleanup crash ${targetKind} ${phase}`);
              }
            },
          }),
        new RegExp(`cleanup crash ${targetKind} ${phase}`),
      );
      assert.ok(crashedArchivePath, `${targetKind}:${phase}`);
      assert.equal(
        existsSync(crashedArchivePath),
        true,
        `${targetKind}:${phase}`,
      );
      const crashedArchiveBytes = readFileSync(crashedArchivePath);
      assert.equal(
        existsSync(
          targetKind === "active-wal"
            ? transactionPaths.active
            : transactionPaths.after,
        ),
        false,
        `${targetKind}:${phase}`,
      );

      const recovered = acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs: nowMs + 1,
        token,
        actorCredentialToken,
      });
      assert.equal(recovered.recovered, true, `${targetKind}:${phase}`);
      assert.equal(existsSync(transactionPaths.after), false);
      assert.equal(existsSync(transactionPaths.active), false);
      assert.deepEqual(readFileSync(crashedArchivePath), crashedArchiveBytes);
      assert.equal(
        leaseCleanupQuarantines(transactionPaths.active, operationId).length,
        5,
        `${targetKind}:${phase}`,
      );

      const archiveBeforeReplay = snapshotFilesystemEntry(
        leaseCleanupQuarantineDirectory(transactionPaths.active),
      );
      const eventsBeforeReplay = readFileSync(
        automationControlPaths(stateRoot).events,
      );
      const replay = acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        nowMs: nowMs + 2,
        token,
        actorCredentialToken,
      });
      assert.equal(replay.recovered, true, `${targetKind}:${phase}`);
      assert.deepEqual(
        snapshotFilesystemEntry(
          leaseCleanupQuarantineDirectory(transactionPaths.active),
        ),
        archiveBeforeReplay,
      );
      assert.deepEqual(
        readFileSync(automationControlPaths(stateRoot).events),
        eventsBeforeReplay,
      );
    }
  }
});

test("lease cleanup preflights every mixed current-operation archive before mutation", () => {
  for (const scenario of [
    "invalid-before",
    "invalid-after",
    "wrong-digest",
    "conflicting-mapping",
    "wrong-path",
  ]) {
    const stateRoot = temporaryStateRoot();
    const actor = "freed-release-verifier";
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const actorCredentialToken = writeActorCredential(stateRoot, actor);
    const token = `archive-preflight-${scenario}-${"x".repeat(32)}`;
    const operationId = nextLeaseOperationId(`archive-preflight-${scenario}`);
    const nowMs = Date.parse("2026-07-11T05:00:00Z");
    const transactionPaths = leaseTransactionPaths(
      stateRoot,
      name,
      "acquire",
      operationId,
    );
    assert.throws(
      () =>
        acquireLeaseMutation({
          stateRoot,
          name,
          owner: actor,
          operationId,
          ttlMs: 60_000,
          nowMs,
          token,
          actorCredentialToken,
          checkpoint: (phase, details) => {
            if (
              phase === "lease-cleanup-renamed" &&
              details.kind === "staging-after"
            ) {
              throw new Error(`preflight setup ${scenario}`);
            }
          },
        }),
      new RegExp(`preflight setup ${scenario}`),
    );
    const validArchive = exactLeaseCleanupQuarantine(
      transactionPaths.after,
      operationId,
    );
    const archiveDirectory = path.dirname(validArchive);
    if (scenario === "invalid-before" || scenario === "invalid-after") {
      const suffix = scenario === "invalid-before" ? "!" : "zz";
      writeFileSync(
        path.join(archiveDirectory, `${operationId}.${suffix}.json`),
        readFileSync(validArchive),
        { mode: 0o600 },
      );
    } else if (scenario === "wrong-digest") {
      writeFileSync(
        path.join(archiveDirectory, `${operationId}.${"0".repeat(64)}.json`),
        readFileSync(validArchive),
        { mode: 0o600 },
      );
    } else {
      const temporaryPath = path.join(
        archiveDirectory,
        `.preflight-${scenario}.tmp`,
      );
      const validArchiveBytes = readFileSync(validArchive);
      if (scenario === "conflicting-mapping") {
        const conflictingRecord = JSON.parse(
          validArchiveBytes.toString("utf8"),
        );
        conflictingRecord.token = `${conflictingRecord.token}-conflict`;
        writeFileSync(
          temporaryPath,
          `${JSON.stringify(conflictingRecord, null, 2)}\n`,
          { mode: 0o600 },
        );
      } else {
        writeFileSync(temporaryPath, validArchiveBytes, { mode: 0o600 });
      }
      publishExactLeaseCleanupFixture(
        temporaryPath,
        scenario === "conflicting-mapping"
          ? transactionPaths.after
          : transactionPaths.before,
        operationId,
      );
    }

    const beforeReplay = snapshotLeaseAuthorityState(stateRoot);
    assert.throws(
      () =>
        acquireLeaseMutation({
          stateRoot,
          name,
          owner: actor,
          operationId,
          ttlMs: 60_000,
          nowMs: nowMs + 1,
          token,
          actorCredentialToken,
        }),
      (error) =>
        isAutomationControlError(error) &&
        error.code === "lease_transaction_conflict",
      scenario,
    );
    assert.deepEqual(
      snapshotLeaseAuthorityState(stateRoot),
      beforeReplay,
      scenario,
    );
    assert.equal(existsSync(transactionPaths.active), true, scenario);
  }
});

test("lease cleanup rejects a wrong-side staging archive before mutation", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `wrong-side-archive-${"x".repeat(48)}`;
  const startedAt = Date.parse("2026-07-11T05:15:00Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("wrong-side-acquire"),
    ttlMs: 60_000,
    nowMs: startedAt,
    token,
    actorCredentialToken,
  });
  const operationId = nextLeaseOperationId("wrong-side-heartbeat");
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    operationId,
  );
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        ttlMs: 60_000,
        nowMs: startedAt + 1,
        token,
        checkpoint: (phase, details) => {
          if (
            phase === "lease-cleanup-renamed" &&
            details.kind === "staging-before"
          ) {
            throw new Error("wrong side setup");
          }
        },
      }),
    /wrong side setup/,
  );
  const validBeforeArchive = exactLeaseCleanupQuarantine(
    transactionPaths.before,
    operationId,
  );
  const temporaryPath = path.join(
    path.dirname(validBeforeArchive),
    ".wrong-side.tmp",
  );
  writeFileSync(temporaryPath, readFileSync(validBeforeArchive), {
    mode: 0o600,
  });
  publishExactLeaseCleanupFixture(
    temporaryPath,
    transactionPaths.after,
    operationId,
  );

  const beforeReplay = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        ttlMs: 60_000,
        nowMs: startedAt + 2,
        token,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeReplay);
  assert.equal(existsSync(transactionPaths.after), true);
  assert.equal(existsSync(transactionPaths.active), true);
});

test("lease cleanup rejects a wrong-operation receipt archive before mutation", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `wrong-operation-archive-${"x".repeat(40)}`;
  const startedAt = Date.parse("2026-07-11T05:30:00Z");
  const acquireOperationId = nextLeaseOperationId("wrong-operation-acquire");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: acquireOperationId,
    ttlMs: 30 * 60_000,
    nowMs: startedAt,
    token,
    actorCredentialToken,
  });
  for (let index = 0; index < 8; index += 1) {
    heartbeatLeaseMutation({
      stateRoot,
      name,
      operationId: nextLeaseOperationId(`wrong-operation-seed-${index}`),
      ttlMs: 30 * 60_000,
      nowMs: startedAt + index + 1,
      token,
    });
  }
  const operationId = nextLeaseOperationId("wrong-operation-current");
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    operationId,
  );
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        ttlMs: 30 * 60_000,
        nowMs: startedAt + 9,
        token,
        checkpoint: (phase, details) => {
          if (
            phase === "lease-cleanup-renamed" &&
            details.kind === "stale-receipt"
          ) {
            throw new Error("wrong operation setup");
          }
        },
      }),
    /wrong operation setup/,
  );
  const acquireReceipt = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    acquireOperationId,
  ).receipt;
  const receiptArchiveDirectory = leaseCleanupQuarantineDirectory(
    transactionPaths.receipt,
  );
  const temporaryPath = path.join(
    receiptArchiveDirectory,
    ".wrong-operation.tmp",
  );
  writeFileSync(temporaryPath, readFileSync(acquireReceipt), { mode: 0o600 });
  publishExactLeaseCleanupFixture(temporaryPath, acquireReceipt, operationId);

  const beforeReplay = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        ttlMs: 30 * 60_000,
        nowMs: startedAt + 10,
        token,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_conflict",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeReplay);
  assert.equal(existsSync(transactionPaths.active), true);
});

test("a ninth-old heartbeat retry fails cleanly without leaving an active WAL", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const token = `ninth-old-heartbeat-${"x".repeat(32)}`;
  const startedAt = Date.now();
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("ninth-old-acquire"),
    ttlMs: 30 * 60_000,
    nowMs: startedAt,
    token,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const operations = [];
  for (let index = 0; index < 9; index += 1) {
    const operationId = nextLeaseOperationId(`ninth-old-heartbeat-${index}`);
    const nowMs = startedAt + index + 1;
    heartbeatLeaseMutation({
      stateRoot,
      name,
      operationId,
      token,
      ttlMs: 30 * 60_000,
      nowMs,
    });
    operations.push({ operationId, nowMs });
  }
  const pruned = operations.find(
    ({ operationId }) =>
      !existsSync(
        leaseTransactionPaths(stateRoot, name, "heartbeat", operationId)
          .receipt,
      ),
  );
  assert.ok(pruned);
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    pruned.operationId,
  );
  const eventsBefore = readFileSync(automationControlPaths(stateRoot).events);

  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId: pruned.operationId,
        token,
        ttlMs: 30 * 60_000,
        nowMs: pruned.nowMs,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_receipt_unavailable",
  );
  assert.equal(existsSync(transactionPaths.active), false);
  assert.deepEqual(
    readFileSync(automationControlPaths(stateRoot).events),
    eventsBefore,
  );
  assert.equal(
    withMutationLeaseAuthority(
      {
        stateRoot,
        actor,
        leaseName: name,
        leaseToken: token,
      },
      () => true,
    ),
    true,
  );
});

test("lease acquisition recovers every durable checkpoint without exposing its token", () => {
  const phases = [
    "lease-prepared",
    "lease-credential-committed",
    "lease-state-committed",
    "lease-event-appended",
    "lease-receipt-written",
    "lease-complete",
  ];
  for (const [index, phase] of phases.entries()) {
    const stateRoot = temporaryStateRoot();
    const actor = "freed-release-verifier";
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const actorCredentialToken = writeActorCredential(stateRoot, actor);
    const operationId = createHash("sha256")
      .update(`acquire-crash:${phase}`)
      .digest("hex");
    const token = `caller-retained-acquire-token-${index}-1234567890`;
    const nowMs = Date.parse("2026-07-10T18:00:00Z") + index * 1_000;
    assert.throws(
      () =>
        acquireLeaseMutation({
          stateRoot,
          name,
          owner: actor,
          operationId,
          ttlMs: 60_000,
          nowMs,
          token,
          actorCredentialToken,
          checkpoint: throwAtLeaseCheckpoint(phase),
        }),
      new RegExp(`lease checkpoint ${phase}`),
    );
    const transactionPaths = leaseTransactionPaths(
      stateRoot,
      name,
      "acquire",
      operationId,
    );
    for (const filePath of [
      transactionPaths.active,
      transactionPaths.receipt,
    ]) {
      if (!existsSync(filePath)) continue;
      assert.equal(readFileSync(filePath, "utf8").includes(token), false);
    }
    assert.equal(
      JSON.stringify(readControlEvents(stateRoot)).includes(token),
      false,
    );

    const recovered = acquireLeaseMutation({
      stateRoot,
      name,
      owner: actor,
      operationId,
      ttlMs: 60_000,
      nowMs,
      token,
      actorCredentialToken,
    });
    assert.equal(recovered.acquired, true);
    assert.equal(recovered.lease.token, token);
    assert.equal(existsSync(transactionPaths.active), false);
    assert.equal(existsSync(transactionPaths.receipt), true);
    assert.equal(
      readFileSync(transactionPaths.receipt, "utf8").includes(token),
      false,
    );
    assert.equal(
      readControlEvents(stateRoot).filter(
        (event) => event.eventId === `lease:${operationId}`,
      ).length,
      1,
    );

    const manifestBeforeReplay = existsSync(
      automationControlPaths(stateRoot).taskManifest,
    )
      ? readFileSync(automationControlPaths(stateRoot).taskManifest)
      : null;
    const eventsBeforeReplay = readFileSync(
      automationControlPaths(stateRoot).events,
    );
    const receiptBeforeReplay = readFileSync(transactionPaths.receipt);
    const replay = acquireLeaseMutation({
      stateRoot,
      name,
      owner: actor,
      operationId,
      ttlMs: 60_000,
      nowMs: nowMs + 1_000,
      token,
      actorCredentialToken,
    });
    assert.equal(replay.recovered, true);
    assert.deepEqual(
      readFileSync(automationControlPaths(stateRoot).events),
      eventsBeforeReplay,
    );
    assert.deepEqual(
      readFileSync(transactionPaths.receipt),
      receiptBeforeReplay,
    );
    if (manifestBeforeReplay !== null) {
      assert.deepEqual(
        readFileSync(automationControlPaths(stateRoot).taskManifest),
        manifestBeforeReplay,
      );
    }
  }
});

test("lease acquisition recovers real process loss at atomic and canonical state windows", () => {
  const windows = [
    {
      phase: "lease-atomic-temporary-synced",
      kind: "after staging",
    },
    {
      phase: "lease-atomic-before-create-rename",
      kind: "after staging",
    },
    { phase: "lease-atomic-renamed", kind: "after staging" },
    { phase: "lease-atomic-temporary-synced", kind: "WAL" },
    { phase: "lease-atomic-before-exchange", kind: "WAL" },
    { phase: "lease-atomic-exchanged", kind: "WAL" },
    {
      phase: "lease-atomic-before-generation-retirement",
      kind: "WAL",
    },
    { phase: "lease-atomic-generation-retired", kind: "WAL" },
    { phase: "lease-state-directory-created" },
    {
      phase: "lease-atomic-temporary-synced",
      kind: "canonical lease record",
    },
    { phase: "lease-atomic-renamed", kind: "canonical lease record" },
    { phase: "lease-atomic-temporary-synced", kind: "receipt" },
    {
      phase: "lease-atomic-before-create-rename",
      kind: "receipt",
    },
    { phase: "lease-cleanup-renamed", kind: "active-wal" },
    {
      phase: "lease-cleanup-archive-synced",
      kind: "active-wal",
    },
  ];
  for (const [index, window] of windows.entries()) {
    const stateRoot = temporaryStateRoot();
    const actor = "freed-release-verifier";
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const operationId = createHash("sha256")
      .update(`lease-process-loss:${window.phase}:${window.kind ?? "none"}`)
      .digest("hex");
    const token = `process-loss-acquire-${index}-${"x".repeat(40)}`;
    const actorCredentialToken = writeActorCredential(stateRoot, actor);
    runLeaseMutationProcessLoss({
      exportName: "acquireLease",
      options: {
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 30 * 60_000,
        token,
        actorCredentialToken,
      },
      ...window,
    });

    if (index === 0) {
      const competingActor = "freed-runtime-observer";
      const competingName = AUTOMATION_ACTOR_POLICIES[competingActor].leaseName;
      const competingCredential = writeActorCredential(
        stateRoot,
        competingActor,
      );
      const beforeCompetingAttempt = snapshotLeaseAuthorityState(stateRoot);
      assert.throws(
        () =>
          acquireLeaseLive({
            stateRoot,
            name: competingName,
            owner: competingActor,
            operationId: createHash("sha256")
              .update("competing-pre-wal-process-loss")
              .digest("hex"),
            ttlMs: 30 * 60_000,
            token: `competing-pre-wal-${"x".repeat(40)}`,
            actorCredentialToken: competingCredential,
          }),
        (error) =>
          isAutomationControlError(error) &&
          error.code === "lease_transaction_pending",
      );
      assert.deepEqual(
        snapshotLeaseAuthorityState(stateRoot),
        beforeCompetingAttempt,
      );
    }

    const recovered = acquireLeaseLive({
      stateRoot,
      name,
      owner: actor,
      operationId,
      ttlMs: 30 * 60_000,
      token,
      actorCredentialToken,
    });
    assert.equal(recovered.acquired, true);
    assert.equal(recovered.lease.token, token);
    assert.equal(
      readControlEvents(stateRoot).filter(
        (event) => event.eventId === `lease:${operationId}`,
      ).length,
      1,
    );
    const paths = leaseTransactionPaths(
      stateRoot,
      name,
      "acquire",
      operationId,
    );
    assert.equal(existsSync(paths.active), false);
    assert.equal(existsSync(paths.receipt), true);
    const transactionEntries = readdirSync(path.dirname(paths.active)).sort();
    assert.deepEqual(transactionEntries, [".lease-cleanup-quarantine"]);
    const leasePath = path.join(
      automationControlPaths(stateRoot).leases,
      `${name}.lease`,
    );
    assert.deepEqual(readdirSync(leasePath), ["lease.json"]);

    const stableState = snapshotLeaseAuthorityState(stateRoot);
    const replay = acquireLeaseLive({
      stateRoot,
      name,
      owner: actor,
      operationId,
      ttlMs: 30 * 60_000,
      token,
      actorCredentialToken,
    });
    assert.equal(replay.recovered, true);
    assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), stableState);
  }
});

test("fenced outcome repair recovers exact owner lease state published before its WAL phase", async (t) => {
  await t.test("acquire", () => {
    const fixture = leaveOutcomeLedgerRepairFenced("prepared-acquire");
    releaseLeaseMutation({
      stateRoot: fixture.stateRoot,
      name: fixture.owner.leaseName,
      operationId: nextLeaseOperationId("fenced-initial-owner-release"),
      token: fixture.owner.leaseToken,
    });
    const confirmation = writeOwnerConfirmation(
      fixture.stateRoot,
      fixture.taskId,
      fixture.plan.intent,
      {
        nowMs: Date.now(),
        confirmationId: "fenced-prepared-acquire",
      },
    );
    const operationId = nextLeaseOperationId("fenced-prepared-owner-acquire");
    const token = `fenced-prepared-owner-acquire-${"x".repeat(40)}`;
    const options = {
      stateRoot: fixture.stateRoot,
      name: "owner-governance",
      owner: "freed-owner",
      operationId,
      ttlMs: 10 * 60_000,
      token,
      ownerConfirmationFile: confirmation.confirmationPath,
      ownerCapabilityTaskId: fixture.taskId,
      ownerCapabilityIntentDigest: fixture.plan.intentDigest,
    };
    runLeaseMutationProcessLoss({
      exportName: "acquireLease",
      options,
      phase: "lease-atomic-renamed",
      kind: "canonical lease record",
    });
    const files = leaseTransactionPaths(
      fixture.stateRoot,
      "owner-governance",
      "acquire",
      operationId,
    );
    assert.equal(
      JSON.parse(readFileSync(files.active, "utf8")).phase,
      "prepared",
    );
    assert.equal(
      readControlEvents(fixture.stateRoot).some(
        (event) => event.eventId === `lease:${operationId}`,
      ),
      false,
    );
    for (const conflicting of [
      { ...options, token: `${token}-different` },
      { ...options, ttlMs: options.ttlMs - 1 },
      {
        ...options,
        ownerCapabilityTaskId: `${fixture.taskId}-different`,
        ownerCapabilityIntentDigest: "f".repeat(64),
      },
    ]) {
      const before = snapshotLeaseAuthorityState(fixture.stateRoot);
      assert.throws(
        () => acquireLeaseLive(conflicting),
        (error) =>
          error instanceof AutomationControlError &&
          error.code === "lease_transaction_conflict",
      );
      assert.deepEqual(snapshotLeaseAuthorityState(fixture.stateRoot), before);
    }
    const recovered = acquireLeaseLive(options);
    assert.equal(recovered.acquired, true);
    assert.equal(recovered.lease.token, token);
    assert.equal(existsSync(files.active), false);
    assert.equal(existsSync(files.receipt), true);
    assert.equal(
      readControlEvents(fixture.stateRoot).filter(
        (event) => event.eventId === `lease:${operationId}`,
      ).length,
      1,
    );
  });

  await t.test("heartbeat", () => {
    const fixture = leaveOutcomeLedgerRepairFenced("prepared-heartbeat");
    const operationId = nextLeaseOperationId("fenced-prepared-owner-heartbeat");
    const options = {
      stateRoot: fixture.stateRoot,
      name: fixture.owner.leaseName,
      operationId,
      token: fixture.owner.leaseToken,
      ttlMs: 10 * 60_000,
    };
    runLeaseMutationProcessLoss({
      exportName: "heartbeatLease",
      options,
      phase: "lease-atomic-renamed",
      kind: "canonical lease record",
    });
    const files = leaseTransactionPaths(
      fixture.stateRoot,
      fixture.owner.leaseName,
      "heartbeat",
      operationId,
    );
    assert.equal(
      JSON.parse(readFileSync(files.active, "utf8")).phase,
      "prepared",
    );
    assert.equal(
      readControlEvents(fixture.stateRoot).some(
        (event) => event.eventId === `lease:${operationId}`,
      ),
      false,
    );
    assert.throws(
      () =>
        heartbeatLeaseLive({ ...options, token: `${options.token}-different` }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "lease_transaction_conflict",
    );
    const recovered = heartbeatLeaseLive(options);
    assert.equal(recovered.heartbeated, true);
    assert.equal(existsSync(files.active), false);
    assert.equal(existsSync(files.receipt), true);
    assert.equal(
      readControlEvents(fixture.stateRoot).filter(
        (event) => event.eventId === `lease:${operationId}`,
      ).length,
      1,
    );
  });

  await t.test("release", () => {
    const fixture = leaveOutcomeLedgerRepairFenced("prepared-release");
    const operationId = nextLeaseOperationId("fenced-prepared-owner-release");
    const options = {
      stateRoot: fixture.stateRoot,
      name: fixture.owner.leaseName,
      operationId,
      token: fixture.owner.leaseToken,
    };
    runLeaseMutationProcessLoss({
      exportName: "releaseLease",
      options,
      phase: "lease-state-directory-retired",
    });
    const files = leaseTransactionPaths(
      fixture.stateRoot,
      fixture.owner.leaseName,
      "release",
      operationId,
    );
    assert.equal(
      JSON.parse(readFileSync(files.active, "utf8")).phase,
      "prepared",
    );
    assert.equal(
      readControlEvents(fixture.stateRoot).some(
        (event) => event.eventId === `lease:${operationId}`,
      ),
      false,
    );
    assert.throws(
      () =>
        releaseLeaseMutation({
          ...options,
          token: `${options.token}-different`,
        }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "lease_transaction_conflict",
    );
    const recovered = releaseLeaseMutation(options);
    assert.equal(recovered.released, true);
    assert.equal(
      inspectLease({
        stateRoot: fixture.stateRoot,
        name: fixture.owner.leaseName,
      }),
      null,
    );
    assert.equal(existsSync(files.active), false);
    assert.equal(existsSync(files.receipt), true);
    assert.equal(
      readControlEvents(fixture.stateRoot).filter(
        (event) => event.eventId === `lease:${operationId}`,
      ).length,
      1,
    );
  });
});

test("heartbeat recovers finalized pre-WAL staging with regenerated timestamps", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const token = `heartbeat-finalized-pre-wal-${"x".repeat(40)}`;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  acquireLeaseLive({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("heartbeat-finalized-pre-wal-acquire"),
    ttlMs: 30 * 60_000,
    token,
    actorCredentialToken,
  });
  const operationId = nextLeaseOperationId("heartbeat-finalized-pre-wal");
  runLeaseMutationProcessLoss({
    exportName: "heartbeatLease",
    options: {
      stateRoot,
      name,
      operationId,
      token,
      ttlMs: 30 * 60_000,
    },
    phase: "lease-atomic-renamed",
    kind: "after staging",
  });

  const recovered = heartbeatLeaseLive({
    stateRoot,
    name,
    operationId,
    token,
    ttlMs: 30 * 60_000,
  });
  assert.equal(recovered.heartbeated, true);
  assert.equal(
    readControlEvents(stateRoot).filter(
      (event) => event.eventId === `lease:${operationId}`,
    ).length,
    1,
  );
  const paths = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    operationId,
  );
  assert.equal(existsSync(paths.active), false);
  assert.equal(existsSync(paths.receipt), true);
});

test("all four lease mutations recover the final native WAL exchange window", () => {
  const actor = "freed-release-verifier";

  {
    const stateRoot = temporaryStateRoot();
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const operationId = nextLeaseOperationId("native-exchange-acquire");
    const token = `native-exchange-acquire-${"x".repeat(40)}`;
    const actorCredentialToken = writeActorCredential(stateRoot, actor);
    const options = {
      stateRoot,
      name,
      owner: actor,
      operationId,
      ttlMs: 30 * 60_000,
      token,
      actorCredentialToken,
    };
    runLeaseMutationProcessLoss({
      exportName: "acquireLease",
      options,
      phase: "lease-atomic-exchanged",
      kind: "WAL",
    });
    assert.equal(acquireLeaseLive(options).acquired, true);
    assert.equal(
      readControlEvents(stateRoot).filter(
        (event) => event.eventId === `lease:${operationId}`,
      ).length,
      1,
    );
  }

  {
    const stateRoot = temporaryStateRoot();
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const token = `native-exchange-heartbeat-${"x".repeat(40)}`;
    const actorCredentialToken = writeActorCredential(stateRoot, actor);
    acquireLeaseLive({
      stateRoot,
      name,
      owner: actor,
      operationId: nextLeaseOperationId("native-exchange-heartbeat-acquire"),
      ttlMs: 30 * 60_000,
      token,
      actorCredentialToken,
    });
    const operationId = nextLeaseOperationId("native-exchange-heartbeat");
    const options = {
      stateRoot,
      name,
      operationId,
      token,
      ttlMs: 30 * 60_000,
    };
    runLeaseMutationProcessLoss({
      exportName: "heartbeatLease",
      options,
      phase: "lease-atomic-exchanged",
      kind: "WAL",
    });
    assert.equal(heartbeatLeaseLive(options).heartbeated, true);
    assert.equal(
      readControlEvents(stateRoot).filter(
        (event) => event.eventId === `lease:${operationId}`,
      ).length,
      1,
    );
  }

  {
    const stateRoot = temporaryStateRoot();
    const scope = {
      schemaVersion: 2,
      repo: "freed-project/freed",
      worktree: realpathSync(stateRoot),
      branch: "fix/native-exchange-bind",
      base: "dev",
      baseSha: "d".repeat(40),
      headSha: null,
      publishMode: "feature-pr",
    };
    const token = `native-exchange-bind-${"x".repeat(40)}`;
    const acquireOperationId = nextLeaseOperationId(
      "native-exchange-bind-acquire",
    );
    const capability = writePublisherCapability(stateRoot, scope, {
      leaseOperationId: acquireOperationId,
      token,
    });
    acquireLeaseLive({
      stateRoot,
      name: "pr-publisher",
      owner: "freed-pr-publisher",
      operationId: acquireOperationId,
      ttlMs: 30 * 60_000,
      token,
      publisherCapabilityFile: capability.capabilityPath,
      scope,
    });
    const operationId = nextLeaseOperationId("native-exchange-bind");
    const options = {
      stateRoot,
      operationId,
      token,
      scope,
      headSha: "e".repeat(40),
    };
    runLeaseMutationProcessLoss({
      exportName: "bindPublisherLeaseHead",
      options,
      phase: "lease-atomic-exchanged",
      kind: "WAL",
    });
    assert.equal(bindPublisherLeaseHeadLive(options).bound, true);
    assert.equal(
      readControlEvents(stateRoot).filter(
        (event) => event.eventId === `lease:${operationId}`,
      ).length,
      1,
    );
  }

  {
    const stateRoot = temporaryStateRoot();
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const token = `native-exchange-release-${"x".repeat(40)}`;
    const actorCredentialToken = writeActorCredential(stateRoot, actor);
    acquireLeaseLive({
      stateRoot,
      name,
      owner: actor,
      operationId: nextLeaseOperationId("native-exchange-release-acquire"),
      ttlMs: 30 * 60_000,
      token,
      actorCredentialToken,
    });
    const operationId = nextLeaseOperationId("native-exchange-release");
    const options = { stateRoot, name, operationId, token };
    runLeaseMutationProcessLoss({
      exportName: "releaseLease",
      options,
      phase: "lease-atomic-exchanged",
      kind: "WAL",
    });
    assert.equal(releaseLeaseMutation(options).released, true);
    assert.equal(inspectLease({ stateRoot, name }), null);
    assert.equal(
      readControlEvents(stateRoot).filter(
        (event) => event.eventId === `lease:${operationId}`,
      ).length,
      1,
    );
  }
});

test("wrong authority cannot mutate prepared or successor WAL temporaries", () => {
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  for (const occurrence of [1, 2]) {
    const stateRoot = temporaryStateRoot();
    const operationId = createHash("sha256")
      .update(`wal-authority-order-${occurrence.toLocaleString()}`)
      .digest("hex");
    const token = `wal-authority-token-${occurrence.toLocaleString()}-${"x".repeat(40)}`;
    const actorCredentialToken = writeActorCredential(stateRoot, actor);
    const options = {
      stateRoot,
      name,
      owner: actor,
      operationId,
      ttlMs: 30 * 60_000,
      token,
      actorCredentialToken,
    };
    runLeaseMutationProcessLoss({
      exportName: "acquireLease",
      options,
      phase: "lease-atomic-temporary-synced",
      kind: "WAL",
      occurrence,
    });
    const beforeWrongAuthority = snapshotLeaseAuthorityState(stateRoot);
    assert.throws(
      () =>
        acquireLeaseLive({
          ...options,
          token: `wrong-wal-authority-${occurrence.toLocaleString()}-${"y".repeat(40)}`,
        }),
      (error) =>
        isAutomationControlError(error) &&
        error.code === "lease_transaction_conflict",
    );
    assert.deepEqual(
      snapshotLeaseAuthorityState(stateRoot),
      beforeWrongAuthority,
    );
    const recovered = acquireLeaseLive(options);
    assert.equal(recovered.acquired, true);
    assert.equal(recovered.lease.token, token);
    assert.equal(
      readControlEvents(stateRoot).filter(
        (event) => event.eventId === `lease:${operationId}`,
      ).length,
      1,
    );
  }
});

test("same operation pre-WAL sibling namespace drift fails closed", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = nextLeaseOperationId("pre-wal-namespace-drift");
  const token = `pre-wal-namespace-drift-${"x".repeat(40)}`;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const options = {
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 30 * 60_000,
    token,
    actorCredentialToken,
  };
  runLeaseMutationProcessLoss({
    exportName: "acquireLease",
    options,
    phase: "lease-atomic-temporary-partial",
    kind: "after staging",
  });
  const transactionDirectory = path.join(
    automationControlPaths(stateRoot).leases,
    ".transactions",
  );
  const temporaryEntries = readdirSync(transactionDirectory).filter(
    (entry) =>
      entry.startsWith(".lease-atomic.") &&
      entry.includes(`.${operationId}.`) &&
      entry.endsWith(".tmp"),
  );
  assert.equal(temporaryEntries.length, 1);
  const parts = temporaryEntries[0].split(".");
  assert.equal(parts.length, 6);
  const namespace = parts[4];
  parts[4] = `${namespace[0] === "0" ? "1" : "0"}${namespace.slice(1)}`;
  const originalPath = path.join(transactionDirectory, temporaryEntries[0]);
  const driftedPath = path.join(transactionDirectory, parts.join("."));
  renameSync(originalPath, driftedPath);

  const beforeRecovery = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () => acquireLeaseLive(options),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeRecovery);
});

test("atomic lease writer preserves a replacement temporary generation", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = createHash("sha256")
    .update("atomic-temporary-generation-swap")
    .digest("hex");
  const token = `atomic-generation-token-${"x".repeat(40)}`;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  let replacementPath;
  let admittedPath;
  assert.throws(
    () =>
      acquireLeaseLive({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 30 * 60_000,
        token,
        actorCredentialToken,
        checkpoint(phase, details) {
          if (
            phase !== "lease-atomic-temporary-synced" ||
            details?.kind !== "after staging" ||
            replacementPath !== undefined
          ) {
            return;
          }
          replacementPath = details.temporaryPath;
          admittedPath = `${replacementPath}.admitted`;
          const bytes = readFileSync(replacementPath);
          renameSync(replacementPath, admittedPath);
          writeFileSync(replacementPath, bytes, { mode: 0o600 });
        },
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.equal(existsSync(replacementPath), false);
  assert.equal(existsSync(admittedPath), true);
  const retirementDirectory = path.join(
    path.dirname(replacementPath),
    ".lease-cleanup-quarantine",
  );
  const retiredEntries = readdirSync(retirementDirectory);
  assert.equal(retiredEntries.length, 1);
  const retiredPath = path.join(retirementDirectory, retiredEntries[0]);
  assert.notEqual(lstatSync(retiredPath).ino, lstatSync(admittedPath).ino);
  assert.deepEqual(readFileSync(retiredPath), readFileSync(admittedPath));
  rmSync(admittedPath);
  assert.equal(inspectLease({ stateRoot, name }), null);
});

test("active WAL recovery preflights every sibling before cleanup", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = createHash("sha256")
    .update("active-wal-full-set-preflight")
    .digest("hex");
  const token = `active-wal-full-set-${"x".repeat(40)}`;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const options = {
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 30 * 60_000,
    token,
    actorCredentialToken,
  };
  runLeaseMutationProcessLoss({
    exportName: "acquireLease",
    options,
    phase: "lease-atomic-temporary-synced",
    kind: "WAL",
    occurrence: 2,
  });
  const paths = leaseTransactionPaths(stateRoot, name, "acquire", operationId);
  const successorEntries = readdirSync(path.dirname(paths.active)).filter(
    (entry) =>
      entry.startsWith(".lease-atomic.") &&
      entry.includes(`.${operationId}.`) &&
      entry.endsWith(".tmp"),
  );
  assert.equal(successorEntries.length, 1);
  const successorTemporary = path.join(
    path.dirname(paths.active),
    successorEntries[0],
  );
  assert.equal(existsSync(paths.active), true);
  assert.equal(existsSync(successorTemporary), true);
  const unexpectedPath = path.join(
    path.dirname(paths.active),
    "late-unexpected-entry.json",
  );
  writeFileSync(unexpectedPath, "{}\n", { mode: 0o600 });
  const beforeRecovery = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () => acquireLeaseLive(options),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_pending",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeRecovery);
  rmSync(unexpectedPath);
  const recovered = acquireLeaseLive(options);
  assert.equal(recovered.acquired, true);
  assert.equal(recovered.lease.token, token);
});

test("one-use credential and release intermediates recover real process loss", () => {
  const nowMs = Date.now();
  for (const phase of [
    "lease-credential-directory-created",
    "lease-credential-directory-parent-synced",
    "lease-credential-renamed",
    "lease-credential-destination-synced",
  ]) {
    const publisherRoot = temporaryStateRoot();
    const scope = {
      schemaVersion: 2,
      repo: "freed-project/freed",
      worktree: realpathSync(publisherRoot),
      branch: "fix/lease-process-loss",
      base: "dev",
      baseSha: "d".repeat(40),
      headSha: null,
      publishMode: "feature-pr",
    };
    const operationId = createHash("sha256")
      .update(`credential-process-loss:${phase}`)
      .digest("hex");
    const token = `process-loss-publisher-${phase}-${"x".repeat(32)}`;
    const capability = writePublisherCapability(publisherRoot, scope, {
      nowMs,
      leaseOperationId: operationId,
      token,
    });
    runLeaseMutationProcessLoss({
      exportName: "acquireLease",
      options: {
        stateRoot: publisherRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        operationId,
        ttlMs: 30 * 60_000,
        token,
        publisherCapabilityFile: capability.capabilityPath,
        scope,
      },
      phase,
    });
    const publisherRecovered = acquireLeaseLive({
      stateRoot: publisherRoot,
      name: "pr-publisher",
      owner: "freed-pr-publisher",
      operationId,
      ttlMs: 30 * 60_000,
      token,
      publisherCapabilityFile: capability.capabilityPath,
      scope,
    });
    assert.equal(publisherRecovered.acquired, true);
    assert.equal(existsSync(capability.capabilityPath), false);
    assert.equal(
      existsSync(
        path.join(
          automationControlPaths(publisherRoot).publisherCapabilitiesConsumed,
          `${capability.capabilityId}.json`,
        ),
      ),
      true,
    );
  }

  for (const phase of [
    "lease-state-before-directory-retirement",
    "lease-state-directory-retired",
    "lease-state-removal-renamed",
    "lease-state-removal-parent-synced",
  ]) {
    const stateRoot = temporaryStateRoot();
    const actor = "freed-release-verifier";
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const actorCredentialToken = writeActorCredential(stateRoot, actor);
    const releaseToken = `process-loss-release-${phase}-${"x".repeat(32)}`;
    acquireLeaseLive({
      stateRoot,
      name,
      owner: actor,
      operationId: createHash("sha256")
        .update(`process-loss-release-acquire:${phase}`)
        .digest("hex"),
      ttlMs: 30 * 60_000,
      token: releaseToken,
      actorCredentialToken,
    });
    const releaseOperationId = createHash("sha256")
      .update(`process-loss-release:${phase}`)
      .digest("hex");
    runLeaseMutationProcessLoss({
      exportName: "releaseLease",
      options: {
        stateRoot,
        name,
        operationId: releaseOperationId,
        token: releaseToken,
      },
      phase,
    });
    const released = releaseLeaseMutation({
      stateRoot,
      name,
      operationId: releaseOperationId,
      token: releaseToken,
    });
    assert.equal(released.released, true);
    assert.equal(inspectLease({ stateRoot, name }), null);
    assert.equal(
      readControlEvents(stateRoot).filter(
        (event) => event.eventId === `lease:${releaseOperationId}`,
      ).length,
      1,
    );
    const removalPath = path.join(
      automationControlPaths(stateRoot).leases,
      `.${name}.lease.${releaseOperationId}.removed`,
    );
    assert.equal(existsSync(removalPath), false);
    const stateArchivePath = path.join(
      automationControlPaths(stateRoot).leases,
      ".lease-state-quarantine",
    );
    const retiredEntries = readdirSync(stateArchivePath);
    assert.equal(retiredEntries.length, 1);
    assert.match(retiredEntries[0], /^[0-9a-f]{64}\.[0-9a-f]{64}\.lease$/);
    assert.deepEqual(
      readdirSync(path.join(stateArchivePath, retiredEntries[0])),
      ["lease.json"],
    );
    const stableState = snapshotLeaseAuthorityState(stateRoot);
    const replay = releaseLeaseMutation({
      stateRoot,
      name,
      operationId: releaseOperationId,
      token: releaseToken,
    });
    assert.equal(replay.recovered, true);
    assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), stableState);
  }
});

test("lease acquisition binds file-backed authorization to one admitted inode", () => {
  const nowMs = Date.now();
  const cases = [];

  {
    const stateRoot = temporaryStateRoot();
    const operationId = createHash("sha256")
      .update("credential-inode-publisher")
      .digest("hex");
    const token = `credential-inode-publisher-${"x".repeat(40)}`;
    const scope = {
      schemaVersion: 2,
      repo: "freed-project/freed",
      worktree: realpathSync(stateRoot),
      branch: "fix/credential-inode",
      base: "dev",
      baseSha: "c".repeat(40),
      headSha: null,
      publishMode: "feature-pr",
    };
    const capability = writePublisherCapability(stateRoot, scope, {
      nowMs,
      leaseOperationId: operationId,
      token,
    });
    cases.push({
      label: "publisher",
      stateRoot,
      name: "pr-publisher",
      operation: {
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        operationId,
        ttlMs: 30 * 60_000,
        token,
        publisherCapabilityFile: capability.capabilityPath,
        scope,
      },
      sourcePath: capability.capabilityPath,
    });
  }

  {
    const stateRoot = temporaryStateRoot();
    const taskId = "credential-inode-owner";
    const intent = {
      schemaVersion: 1,
      action: "task.create",
      taskId,
      parameters: { state: "observed" },
    };
    const confirmation = writeOwnerConfirmation(stateRoot, taskId, intent, {
      nowMs,
      confirmationId: "credential-inode-owner-confirmation",
    });
    cases.push({
      label: "owner-confirmation",
      stateRoot,
      name: "owner-governance",
      operation: {
        stateRoot,
        name: "owner-governance",
        owner: "freed-owner",
        operationId: createHash("sha256")
          .update("credential-inode-owner")
          .digest("hex"),
        ttlMs: 60_000,
        token: `credential-inode-owner-${"x".repeat(40)}`,
        ownerConfirmationFile: confirmation.confirmationPath,
        ownerCapabilityTaskId: taskId,
        ownerCapabilityIntentDigest: confirmation.intentDigest,
      },
      sourcePath: confirmation.confirmationPath,
    });
  }

  for (const fixture of cases) {
    const sourceBytes = readFileSync(fixture.sourcePath);
    const displacedPath = `${fixture.sourcePath}.${fixture.label}.displaced`;
    assert.throws(
      () =>
        acquireLeaseLive({
          ...fixture.operation,
          checkpoint: (phase) => {
            if (phase !== "lease-credential-authorized") return;
            renameSync(fixture.sourcePath, displacedPath);
            writeFileSync(fixture.sourcePath, sourceBytes, { mode: 0o600 });
          },
        }),
      (error) =>
        isAutomationControlError(error) &&
        error.code === "lease_transaction_conflict",
      fixture.label,
    );
    assert.equal(readControlEvents(fixture.stateRoot).length, 0);
    assert.equal(
      existsSync(
        path.join(
          automationControlPaths(fixture.stateRoot).leases,
          `${fixture.name}.lease`,
        ),
      ),
      false,
    );
    assert.equal(
      existsSync(
        leaseTransactionPaths(
          fixture.stateRoot,
          fixture.name,
          "acquire",
          fixture.operation.operationId,
        ).active,
      ),
      false,
    );
  }
});

test("prepared WAL permanently binds its caller operation identity", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const operationId = createHash("sha256")
    .update("retired-operation-identity")
    .digest("hex");
  const token = `retired-operation-token-${"x".repeat(40)}`;
  const original = {
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 30 * 60_000,
    token,
    actorCredentialToken,
  };
  assert.throws(
    () =>
      acquireLeaseLive({
        ...original,
        checkpoint: throwAtLeaseCheckpoint("lease-prepared"),
      }),
    /lease checkpoint lease-prepared/,
  );
  const paths = leaseTransactionPaths(stateRoot, name, "acquire", operationId);
  assert.equal(existsSync(paths.active), true);
  const pendingState = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () => inspectLease({ stateRoot, name }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_pending",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), pendingState);
  const beforeConflict = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () =>
      acquireLeaseLive({
        ...original,
        ttlMs: 29 * 60_000,
        token: `changed-retired-operation-${"y".repeat(40)}`,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeConflict);
  assert.equal(existsSync(paths.active), true);

  const recovered = acquireLeaseLive(original);
  assert.equal(recovered.acquired, true);
  assert.equal(recovered.lease.token, token);
  assert.equal(existsSync(paths.active), false);
  assert.equal(
    readControlEvents(stateRoot).filter(
      (event) => event.eventId === `lease:${operationId}`,
    ).length,
    1,
  );
});

test("all four lease mutations recover post-state failure with one exact event", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-runtime-observer";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = "caller-retained-runtime-token-1234567890";
  const acquiredAt = Date.now();
  const acquireOperationId = "a1".repeat(32);
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId: acquireOperationId,
        ttlMs: 10 * 60_000,
        nowMs: acquiredAt,
        token,
        actorCredentialToken,
        checkpoint: throwAtLeaseCheckpoint("lease-state-committed"),
      }),
    /lease checkpoint lease-state-committed/,
  );
  assert.throws(
    () =>
      appendControlEvent({
        stateRoot,
        type: "lease-authority-recovered",
        actor,
        leaseName: name,
        leaseToken: token,
        nowMs: acquiredAt + 1,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_pending",
  );
  const acquired = acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: acquireOperationId,
    ttlMs: 10 * 60_000,
    nowMs: acquiredAt + 2,
    token,
    actorCredentialToken,
  });
  assert.equal(acquired.recovered, true);
  const recoveredAuthorityEvent = appendControlEvent({
    stateRoot,
    type: "lease-authority-recovered",
    actor,
    leaseName: name,
    leaseToken: token,
    nowMs: acquiredAt + 3,
  });
  assert.equal(recoveredAuthorityEvent.type, "lease-authority-recovered");
  assert.equal(
    readControlEvents(stateRoot).filter(
      (event) => event.eventId === `lease:${acquireOperationId}`,
    ).length,
    1,
  );
  const inspected = inspectLease({ stateRoot, name, nowMs: acquiredAt + 3 });
  assert.equal(inspected.owner, actor);

  const heartbeatOperationId = "b2".repeat(32);
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId: heartbeatOperationId,
        token,
        nowMs: acquiredAt + 60_000,
        checkpoint: throwAtLeaseCheckpoint("lease-state-committed"),
      }),
    /lease checkpoint lease-state-committed/,
  );
  const heartbeated = heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: heartbeatOperationId,
    token,
    nowMs: acquiredAt + 60_001,
  });
  assert.equal(heartbeated.recovered, true);

  const releaseOperationId = "c3".repeat(32);
  assert.throws(
    () =>
      releaseLease({
        stateRoot,
        name,
        operationId: releaseOperationId,
        token,
        nowMs: acquiredAt + 120_000,
        checkpoint: throwAtLeaseCheckpoint("lease-state-committed"),
      }),
    /lease checkpoint lease-state-committed/,
  );
  assert.throws(
    () =>
      appendControlEvent({
        stateRoot,
        type: "lease-release-pending",
        actor,
        leaseName: name,
        leaseToken: token,
        nowMs: acquiredAt + 120_001,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_pending",
  );
  assert.equal(
    readControlEvents(stateRoot).filter(
      (event) => event.eventId === `lease:${releaseOperationId}`,
    ).length,
    0,
  );
  const released = releaseLease({
    stateRoot,
    name,
    operationId: releaseOperationId,
    token,
    nowMs: acquiredAt + 120_002,
  });
  assert.equal(released.recovered, true);
  assert.equal(
    readControlEvents(stateRoot).filter(
      (event) => event.eventId === `lease:${releaseOperationId}`,
    ).length,
    1,
  );
  assert.equal(inspectLease({ stateRoot, name }), null);

  for (const operationId of [
    acquireOperationId,
    heartbeatOperationId,
    releaseOperationId,
  ]) {
    assert.equal(
      readControlEvents(stateRoot).filter(
        (event) => event.eventId === `lease:${operationId}`,
      ).length,
      1,
    );
  }

  const publisherRoot = temporaryStateRoot();
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(publisherRoot),
    branch: "fix/lease-bind-recovery",
    base: "dev",
    baseSha: "d".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  const publisherToken = "caller-retained-publisher-token-1234567890";
  const capability = writePublisherCapability(publisherRoot, scope, {
    nowMs: acquiredAt,
    leaseOperationId: "d4".repeat(32),
    token: publisherToken,
  });
  acquireLeaseMutation({
    stateRoot: publisherRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    operationId: "d4".repeat(32),
    ttlMs: 30 * 60_000,
    nowMs: acquiredAt,
    token: publisherToken,
    publisherCapabilityFile: capability.capabilityPath,
    scope,
  });
  const bindOperationId = "e5".repeat(32);
  const headSha = "e".repeat(40);
  assert.throws(
    () =>
      bindPublisherLeaseHeadMutation({
        stateRoot: publisherRoot,
        operationId: bindOperationId,
        token: publisherToken,
        scope,
        headSha,
        nowMs: acquiredAt + 1_000,
        checkpoint: throwAtLeaseCheckpoint("lease-state-committed"),
      }),
    /lease checkpoint lease-state-committed/,
  );
  const bound = bindPublisherLeaseHeadMutation({
    stateRoot: publisherRoot,
    operationId: bindOperationId,
    token: publisherToken,
    scope,
    headSha,
    nowMs: acquiredAt + 1_001,
  });
  assert.equal(bound.recovered, true);
  assert.equal(bound.lease.scope.headSha, headSha);
  assert.equal(
    readControlEvents(publisherRoot).filter(
      (event) => event.eventId === `lease:${bindOperationId}`,
    ).length,
    1,
  );
});

test("post-state acquisition recovery does not depend on mutable capability storage", () => {
  const nowMs = Date.now();
  const cases = [];

  {
    const stateRoot = temporaryStateRoot();
    const operationId = nextLeaseOperationId("post-state-publisher-capability");
    const token = `post-state-publisher-${"x".repeat(40)}`;
    const scope = {
      schemaVersion: 2,
      repo: "freed-project/freed",
      worktree: realpathSync(stateRoot),
      branch: "fix/post-state-credential-recovery",
      base: "dev",
      baseSha: "d".repeat(40),
      headSha: null,
      publishMode: "feature-pr",
    };
    const capability = writePublisherCapability(stateRoot, scope, {
      nowMs,
      leaseOperationId: operationId,
      token,
    });
    cases.push({
      label: "publisher capability",
      stateRoot,
      name: "pr-publisher",
      operationId,
      operation: {
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        operationId,
        ttlMs: 30 * 60_000,
        token,
        publisherCapabilityFile: capability.capabilityPath,
        scope,
      },
      mutateCredential: (transaction) => {
        const replacement = path.join(
          stateRoot,
          "post-state-publisher-capability-replacement.json",
        );
        writeFileSync(replacement, "{}\n", { mode: 0o600 });
        rmSync(transaction.capability.consumedPath);
        symlinkSync(replacement, transaction.capability.consumedPath);
      },
    });
  }

  {
    const stateRoot = temporaryStateRoot();
    const taskId = "post-state-owner-confirmation";
    const intent = {
      schemaVersion: 1,
      action: "task.create",
      taskId,
      parameters: { state: "observed" },
    };
    const confirmation = writeOwnerConfirmation(stateRoot, taskId, intent, {
      nowMs,
      confirmationId: "post-state-owner-confirmation",
    });
    const operationId = nextLeaseOperationId("post-state-owner-confirmation");
    cases.push({
      label: "owner confirmation",
      stateRoot,
      name: "owner-governance",
      operationId,
      operation: {
        stateRoot,
        name: "owner-governance",
        owner: "freed-owner",
        operationId,
        ttlMs: 60_000,
        token: `post-state-owner-${"x".repeat(40)}`,
        ownerConfirmationFile: confirmation.confirmationPath,
        ownerCapabilityTaskId: taskId,
        ownerCapabilityIntentDigest: confirmation.intentDigest,
      },
      mutateCredential: (transaction) => {
        rmSync(transaction.capability.sourcePath);
      },
    });
  }

  for (const fixture of cases) {
    runLeaseMutationProcessLoss({
      exportName: "acquireLease",
      options: fixture.operation,
      phase: "lease-state-committed",
    });
    const files = leaseTransactionPaths(
      fixture.stateRoot,
      fixture.name,
      "acquire",
      fixture.operationId,
    );
    const transaction = JSON.parse(readFileSync(files.active, "utf8"));
    fixture.mutateCredential(transaction);

    const recovered = acquireLeaseLive(fixture.operation);
    assert.equal(recovered.acquired, true, fixture.label);
    assert.equal(
      readControlEvents(fixture.stateRoot).filter(
        (event) => event.eventId === `lease:${fixture.operationId}`,
      ).length,
      1,
      fixture.label,
    );
    assert.equal(existsSync(files.active), false, fixture.label);
    assert.equal(existsSync(files.receipt), true, fixture.label);
  }
});

test("completed actor acquisition receipt replay survives credential rotation", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const operationId = nextLeaseOperationId(
    "completed-actor-credential-rotation",
  );
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const options = {
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 30 * 60_000,
    token: `completed-actor-rotation-${"x".repeat(40)}`,
    actorCredentialToken,
  };
  const acquired = acquireLeaseLive(options);
  assert.equal(acquired.acquired, true);
  const files = leaseTransactionPaths(stateRoot, name, "acquire", operationId);
  assert.equal(existsSync(files.active), false);
  assert.equal(existsSync(files.receipt), true);
  writeActorCredential(
    stateRoot,
    actor,
    `rotated-completed-actor-${"y".repeat(40)}`,
  );
  const stableState = snapshotLeaseAuthorityState(stateRoot);

  const replay = acquireLeaseLive(options);
  assert.equal(replay.recovered, true);
  assert.equal(replay.lease.token, options.token);
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), stableState);
});

test("historical credential paths are lexical while prepared recovery rejects symlinks", async (t) => {
  await t.test("completed owner confirmation source", () => {
    const stateRoot = temporaryStateRoot();
    const taskId = "completed-owner-confirmation-symlink";
    const intent = {
      schemaVersion: 1,
      action: "task.create",
      taskId,
      parameters: { state: "observed" },
    };
    const confirmation = writeOwnerConfirmation(stateRoot, taskId, intent, {
      nowMs: Date.now(),
      confirmationId: "completed-owner-confirmation-symlink",
    });
    const options = {
      stateRoot,
      name: "owner-governance",
      owner: "freed-owner",
      operationId: nextLeaseOperationId("completed-owner-confirmation-symlink"),
      ttlMs: 10 * 60_000,
      token: `completed-owner-confirmation-symlink-${"x".repeat(40)}`,
      ownerConfirmationFile: confirmation.confirmationPath,
      ownerCapabilityTaskId: taskId,
      ownerCapabilityIntentDigest: confirmation.intentDigest,
    };
    assert.equal(acquireLeaseLive(options).acquired, true);
    const replacement = path.join(
      stateRoot,
      "owner-confirmation-replacement.json",
    );
    writeFileSync(replacement, "{}\n", { mode: 0o600 });
    rmSync(confirmation.confirmationPath);
    symlinkSync(replacement, confirmation.confirmationPath);

    const health = inspectLeaseTransactionEventHistory({
      stateRoot,
      events: readEvents(stateRoot),
    });
    assert.equal(health.healthy, true, health.issues.join("\n"));
    const stableState = snapshotLeaseAuthorityState(stateRoot);
    assert.equal(acquireLeaseLive(options).recovered, true);
    assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), stableState);
  });

  await t.test("completed publisher pending and consumed paths", () => {
    const stateRoot = temporaryStateRoot();
    const scope = {
      schemaVersion: 2,
      repo: "freed-project/freed",
      worktree: realpathSync(stateRoot),
      branch: "fix/completed-publisher-credential-symlink",
      base: "dev",
      baseSha: "a".repeat(40),
      headSha: null,
      publishMode: "feature-pr",
    };
    const operationId = nextLeaseOperationId(
      "completed-publisher-credential-symlink",
    );
    const token = `completed-publisher-credential-symlink-${"x".repeat(40)}`;
    const capability = writePublisherCapability(stateRoot, scope, {
      leaseOperationId: operationId,
      token,
    });
    const options = {
      stateRoot,
      name: "pr-publisher",
      owner: "freed-pr-publisher",
      operationId,
      ttlMs: 30 * 60_000,
      token,
      publisherCapabilityFile: capability.capabilityPath,
      scope,
    };
    assert.equal(acquireLeaseLive(options).acquired, true);
    const files = leaseTransactionPaths(
      stateRoot,
      "pr-publisher",
      "acquire",
      operationId,
    );
    const transaction = JSON.parse(readFileSync(files.receipt, "utf8"));
    const replacement = path.join(
      stateRoot,
      "publisher-capability-replacement.json",
    );
    writeFileSync(replacement, "{}\n", { mode: 0o600 });
    symlinkSync(replacement, transaction.capability.sourcePath);
    rmSync(transaction.capability.consumedPath);
    symlinkSync(replacement, transaction.capability.consumedPath);

    const health = inspectLeaseTransactionEventHistory({
      stateRoot,
      events: readEvents(stateRoot),
    });
    assert.equal(health.healthy, true, health.issues.join("\n"));
    const stableState = snapshotLeaseAuthorityState(stateRoot);
    assert.equal(acquireLeaseLive(options).recovered, true);
    assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), stableState);
  });

  for (const fixture of [
    {
      label: "pending source",
      phase: "lease-prepared",
      tamper: (transaction) => transaction.capability.sourcePath,
    },
    {
      label: "consumed destination",
      phase: "lease-credential-committed",
      tamper: (transaction) => transaction.capability.consumedPath,
    },
  ]) {
    await t.test(`prepared publisher ${fixture.label}`, () => {
      const stateRoot = temporaryStateRoot();
      const scope = {
        schemaVersion: 2,
        repo: "freed-project/freed",
        worktree: realpathSync(stateRoot),
        branch: `fix/prepared-publisher-${fixture.label.replaceAll(" ", "-")}`,
        base: "dev",
        baseSha: "b".repeat(40),
        headSha: null,
        publishMode: "feature-pr",
      };
      const operationId = nextLeaseOperationId(
        `prepared-publisher-${fixture.label}`,
      );
      const token = `prepared-publisher-${fixture.label}-${"x".repeat(40)}`;
      const capability = writePublisherCapability(stateRoot, scope, {
        leaseOperationId: operationId,
        token,
      });
      const options = {
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        operationId,
        ttlMs: 30 * 60_000,
        token,
        publisherCapabilityFile: capability.capabilityPath,
        scope,
      };
      runLeaseMutationProcessLoss({
        exportName: "acquireLease",
        options,
        phase: fixture.phase,
      });
      const files = leaseTransactionPaths(
        stateRoot,
        "pr-publisher",
        "acquire",
        operationId,
      );
      const transaction = JSON.parse(readFileSync(files.active, "utf8"));
      const tamperedPath = fixture.tamper(transaction);
      const replacement = path.join(
        stateRoot,
        `prepared-${fixture.label.replaceAll(" ", "-")}.json`,
      );
      writeFileSync(replacement, "{}\n", { mode: 0o600 });
      rmSync(tamperedPath);
      symlinkSync(replacement, tamperedPath);
      const before = snapshotLeaseAuthorityState(stateRoot);
      assert.throws(
        () => acquireLeaseLive(options),
        (error) =>
          error instanceof AutomationControlError &&
          [
            "lease_permissions_invalid",
            "lease_transaction_conflict",
            "lease_transaction_invalid",
          ].includes(error.code),
      );
      assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), before);
    });
  }
});

test("completed acquire and bind receipts replay after later heartbeats", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = "caller-retained-replay-token-1234567890";
  const nowMs = Date.parse("2026-07-10T20:00:00Z");
  const acquireOperationId = "f6".repeat(32);
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: acquireOperationId,
    ttlMs: 10 * 60_000,
    nowMs,
    token,
    actorCredentialToken,
  });
  heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: "07".repeat(32),
    token,
    nowMs: nowMs + 60_000,
  });
  const eventsBeforeAcquireReplay = readFileSync(
    automationControlPaths(stateRoot).events,
  );
  const acquireReplay = acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: acquireOperationId,
    ttlMs: 10 * 60_000,
    nowMs: nowMs + 60_001,
    token,
    actorCredentialToken,
  });
  assert.equal(acquireReplay.recovered, true);
  assert.deepEqual(
    readFileSync(automationControlPaths(stateRoot).events),
    eventsBeforeAcquireReplay,
  );

  const publisherRoot = temporaryStateRoot();
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(publisherRoot),
    branch: "fix/lease-bind-replay",
    base: "dev",
    baseSha: "a".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  const publisherToken = "caller-retained-bind-replay-token-1234567890";
  const capability = writePublisherCapability(publisherRoot, scope, {
    nowMs,
    leaseOperationId: "18".repeat(32),
    token: publisherToken,
  });
  acquireLeaseMutation({
    stateRoot: publisherRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    operationId: "18".repeat(32),
    ttlMs: 30 * 60_000,
    nowMs,
    token: publisherToken,
    publisherCapabilityFile: capability.capabilityPath,
    scope,
  });
  const bindOperationId = "29".repeat(32);
  const headSha = "b".repeat(40);
  bindPublisherLeaseHeadMutation({
    stateRoot: publisherRoot,
    operationId: bindOperationId,
    token: publisherToken,
    scope,
    headSha,
    nowMs: nowMs + 1_000,
  });
  heartbeatLeaseMutation({
    stateRoot: publisherRoot,
    name: "pr-publisher",
    operationId: "3a".repeat(32),
    token: publisherToken,
    nowMs: nowMs + 2_000,
  });
  const eventsBeforeBindReplay = readFileSync(
    automationControlPaths(publisherRoot).events,
  );
  const bindReplay = bindPublisherLeaseHeadMutation({
    stateRoot: publisherRoot,
    operationId: bindOperationId,
    token: publisherToken,
    scope,
    headSha,
    nowMs: nowMs + 2_001,
  });
  assert.equal(bindReplay.recovered, true);
  assert.deepEqual(
    readFileSync(automationControlPaths(publisherRoot).events),
    eventsBeforeBindReplay,
  );
});

test("already-bound publisher head records and replays every durable phase", () => {
  const nowMs = Date.parse("2026-07-10T20:30:00Z");
  const phases = [
    "lease-prepared",
    "lease-state-committed",
    "lease-event-appended",
    "lease-complete",
  ];
  for (const [index, phase] of phases.entries()) {
    const stateRoot = temporaryStateRoot();
    const scope = {
      schemaVersion: 2,
      repo: "freed-project/freed",
      worktree: realpathSync(stateRoot),
      branch: `fix/already-bound-${index.toLocaleString()}`,
      base: "dev",
      baseSha: "a".repeat(40),
      headSha: null,
      publishMode: "feature-pr",
    };
    const token = `caller-retained-already-bound-${index.toLocaleString()}-${"x".repeat(40)}`;
    const acquireOperationId = createHash("sha256")
      .update(`already-bound-acquire-${index.toLocaleString()}`)
      .digest("hex");
    const capability = writePublisherCapability(stateRoot, scope, {
      nowMs,
      leaseOperationId: acquireOperationId,
      token,
    });
    acquireLeaseMutation({
      stateRoot,
      name: "pr-publisher",
      owner: "freed-pr-publisher",
      operationId: acquireOperationId,
      ttlMs: 30 * 60_000,
      nowMs,
      token,
      publisherCapabilityFile: capability.capabilityPath,
      scope,
    });
    const headSha = "b".repeat(40);
    bindPublisherLeaseHeadMutation({
      stateRoot,
      operationId: createHash("sha256")
        .update(`already-bound-initial-${index.toLocaleString()}`)
        .digest("hex"),
      token,
      scope,
      headSha,
      nowMs: nowMs + 1_000,
    });

    const operationId = createHash("sha256")
      .update(`already-bound-retry-${index.toLocaleString()}`)
      .digest("hex");
    assert.throws(
      () =>
        bindPublisherLeaseHeadMutation({
          stateRoot,
          operationId,
          token,
          scope,
          headSha,
          nowMs: nowMs + 2_000,
          checkpoint: throwAtLeaseCheckpoint(phase),
        }),
      new RegExp(`lease checkpoint ${phase}`),
    );
    const recovered = bindPublisherLeaseHeadMutation({
      stateRoot,
      operationId,
      token,
      scope,
      headSha,
      nowMs: nowMs + 3_000,
    });
    assert.equal(recovered.bound, false);
    assert.equal(recovered.lease.scope.headSha, headSha);
    const completedReplay = bindPublisherLeaseHeadMutation({
      stateRoot,
      operationId,
      token,
      scope,
      headSha,
      nowMs: nowMs + 3_001,
    });
    assert.equal(completedReplay.recovered, true);
    assert.equal(completedReplay.bound, false);
    const matchingEvents = readControlEvents(stateRoot).filter(
      (event) => event.eventId === `lease:${operationId}`,
    );
    assert.equal(matchingEvents.length, 1);
    assert.equal(matchingEvents[0].type, "lease_scope_binding_confirmed");

    const beforeConflict = snapshotLeaseAuthorityState(stateRoot);
    assert.throws(
      () =>
        bindPublisherLeaseHeadMutation({
          stateRoot,
          operationId,
          token,
          scope,
          headSha: "c".repeat(40),
          nowMs: nowMs + 4_000,
        }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "lease_transaction_conflict",
    );
    assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeConflict);
  }
});

test("audited lease operations never reinterpret missing replay receipts", () => {
  const nowMs = Date.now();
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `missing-receipt-acquire-${"x".repeat(40)}`;
  const acquireOperationId = createHash("sha256")
    .update("missing-acquire-receipt")
    .digest("hex");
  acquireLeaseLive({
    stateRoot,
    name,
    owner: actor,
    operationId: acquireOperationId,
    ttlMs: 30 * 60_000,
    token,
    actorCredentialToken,
  });
  const acquireReceipt = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    acquireOperationId,
  ).receipt;
  rmSync(acquireReceipt);
  const beforeAcquireReplay = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () =>
      acquireLeaseLive({
        stateRoot,
        name,
        owner: actor,
        operationId: acquireOperationId,
        ttlMs: 30 * 60_000,
        token,
        actorCredentialToken,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_receipt_unavailable",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeAcquireReplay);

  const releaseOperationId = createHash("sha256")
    .update("missing-release-receipt")
    .digest("hex");
  releaseLeaseMutation({
    stateRoot,
    name,
    operationId: releaseOperationId,
    token,
  });
  rmSync(
    leaseTransactionPaths(stateRoot, name, "release", releaseOperationId)
      .receipt,
  );
  const beforeReleaseReplay = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () =>
      releaseLeaseMutation({
        stateRoot,
        name,
        operationId: releaseOperationId,
        token,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_receipt_unavailable",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeReleaseReplay);

  const publisherRoot = temporaryStateRoot();
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(publisherRoot),
    branch: "fix/missing-bind-receipt",
    base: "dev",
    baseSha: "b".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  const publisherToken = `missing-bind-receipt-${"x".repeat(40)}`;
  const publisherAcquireOperationId = createHash("sha256")
    .update("missing-bind-acquire")
    .digest("hex");
  const capability = writePublisherCapability(publisherRoot, scope, {
    nowMs,
    leaseOperationId: publisherAcquireOperationId,
    token: publisherToken,
  });
  acquireLeaseLive({
    stateRoot: publisherRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    operationId: publisherAcquireOperationId,
    ttlMs: 30 * 60_000,
    token: publisherToken,
    publisherCapabilityFile: capability.capabilityPath,
    scope,
  });
  const bindOperationId = createHash("sha256")
    .update("missing-bind-receipt")
    .digest("hex");
  const headSha = "e".repeat(40);
  bindPublisherLeaseHeadLive({
    stateRoot: publisherRoot,
    operationId: bindOperationId,
    token: publisherToken,
    scope,
    headSha,
  });
  rmSync(
    leaseTransactionPaths(
      publisherRoot,
      "pr-publisher",
      "bind-head",
      bindOperationId,
    ).receipt,
  );
  const beforeBindReplay = snapshotLeaseAuthorityState(publisherRoot);
  assert.throws(
    () =>
      bindPublisherLeaseHeadLive({
        stateRoot: publisherRoot,
        operationId: bindOperationId,
        token: publisherToken,
        scope,
        headSha,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_receipt_unavailable",
  );
  assert.deepEqual(
    snapshotLeaseAuthorityState(publisherRoot),
    beforeBindReplay,
  );
});

test("identical-state heartbeat recovery follows its durable phase and event", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = "caller-retained-identical-heartbeat-1234567890";
  const nowMs = Date.parse("2026-07-10T21:00:00Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: "4b".repeat(32),
    ttlMs: 60_000,
    nowMs,
    token,
    actorCredentialToken,
  });
  const operationId = "5c".repeat(32);
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        token,
        ttlMs: 60_000,
        nowMs,
        checkpoint: throwAtLeaseCheckpoint("lease-event-appended"),
      }),
    /lease checkpoint lease-event-appended/,
  );
  const recovered = heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId,
    token,
    ttlMs: 60_000,
    nowMs,
  });
  assert.equal(recovered.recovered, true);
  assert.equal(
    readControlEvents(stateRoot).filter(
      (event) => event.eventId === `lease:${operationId}`,
    ).length,
    1,
  );
});

test("one-use lease capability rollback requires exclusive source identity", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-10T22:00:00Z");
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(stateRoot),
    branch: "fix/lease-capability-rollback",
    base: "dev",
    baseSha: "c".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  const operationId = "6d".repeat(32);
  const token = "caller-retained-capability-rollback-1234567890";
  const capability = writePublisherCapability(stateRoot, scope, {
    nowMs,
    leaseOperationId: operationId,
    token,
  });
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        operationId,
        ttlMs: 30 * 60_000,
        nowMs,
        token,
        publisherCapabilityFile: capability.capabilityPath,
        scope,
        checkpoint: throwAtLeaseCheckpoint("lease-credential-committed"),
      }),
    /lease checkpoint lease-credential-committed/,
  );
  const consumedPath = path.join(
    automationControlPaths(stateRoot).publisherCapabilitiesConsumed,
    `${capability.capabilityId}.json`,
  );
  assert.equal(existsSync(capability.capabilityPath), false);
  assert.equal(existsSync(consumedPath), true);
  writeFileSync(capability.capabilityPath, readFileSync(consumedPath), {
    mode: 0o600,
  });
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        operationId,
        ttlMs: 30 * 60_000,
        nowMs: nowMs + 1,
        token,
        publisherCapabilityFile: capability.capabilityPath,
        scope,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_conflict",
  );
  assert.equal(
    existsSync(
      path.join(automationControlPaths(stateRoot).leases, "pr-publisher.lease"),
    ),
    false,
  );
  assert.equal(readControlEvents(stateRoot).length, 0);
});

test("one-use capability and expired takeover roll back before state commit", () => {
  const nowMs = Date.parse("2026-07-10T22:30:00Z");
  const publisherRoot = temporaryStateRoot();
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(publisherRoot),
    branch: "fix/lease-capability-recovery",
    base: "dev",
    baseSha: "f".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  const operationId = "8f".repeat(32);
  const token = "caller-retained-capability-recovery-1234567890";
  const capability = writePublisherCapability(publisherRoot, scope, {
    nowMs,
    leaseOperationId: operationId,
    token,
  });
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot: publisherRoot,
        name: "pr-publisher",
        owner: "freed-pr-publisher",
        operationId,
        ttlMs: 30 * 60_000,
        nowMs,
        token,
        publisherCapabilityFile: capability.capabilityPath,
        scope,
        checkpoint: throwAtLeaseCheckpoint("lease-credential-committed"),
      }),
    /lease checkpoint lease-credential-committed/,
  );
  const consumedPath = path.join(
    automationControlPaths(publisherRoot).publisherCapabilitiesConsumed,
    `${capability.capabilityId}.json`,
  );
  assert.equal(existsSync(capability.capabilityPath), false);
  assert.equal(existsSync(consumedPath), true);
  assert.equal(
    existsSync(
      path.join(
        automationControlPaths(publisherRoot).leases,
        "pr-publisher.lease",
      ),
    ),
    false,
  );
  const recovered = acquireLeaseMutation({
    stateRoot: publisherRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    operationId,
    ttlMs: 30 * 60_000,
    nowMs: nowMs + 1,
    token,
    publisherCapabilityFile: capability.capabilityPath,
    scope,
  });
  assert.equal(recovered.acquired, true);
  assert.equal(existsSync(capability.capabilityPath), false);
  assert.equal(existsSync(consumedPath), true);
  assert.equal(
    readControlEvents(publisherRoot).filter(
      (event) => event.eventId === `lease:${operationId}`,
    ).length,
    1,
  );

  const takeoverRoot = temporaryStateRoot();
  const actor = "freed-scaffolding-maintainer";
  const legacy = writeLegacyLease(takeoverRoot, actor, {
    nowMs: nowMs - 2 * 60 * 60_000,
  });
  const beforeBytes = readFileSync(path.join(legacy.leasePath, "lease.json"));
  const actorCredentialToken = writeActorCredential(takeoverRoot, actor);
  const takeoverOperationId = "90".repeat(32);
  const takeoverToken = "caller-retained-takeover-recovery-1234567890";
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot: takeoverRoot,
        name: legacy.policy.leaseName,
        owner: actor,
        operationId: takeoverOperationId,
        ttlMs: 60_000,
        nowMs,
        token: takeoverToken,
        actorCredentialToken,
        checkpoint: throwAtLeaseCheckpoint("lease-credential-committed"),
      }),
    /lease checkpoint lease-credential-committed/,
  );
  assert.deepEqual(
    readFileSync(path.join(legacy.leasePath, "lease.json")),
    beforeBytes,
  );
  assert.equal(readControlEvents(takeoverRoot).length, 0);
  const takeover = acquireLeaseMutation({
    stateRoot: takeoverRoot,
    name: legacy.policy.leaseName,
    owner: actor,
    operationId: takeoverOperationId,
    ttlMs: 60_000,
    nowMs: nowMs + 1,
    token: takeoverToken,
    actorCredentialToken,
  });
  assert.equal(takeover.takeover, true);
  assert.equal(takeover.lease.token, takeoverToken);
  assert.equal(
    readControlEvents(takeoverRoot).filter(
      (event) => event.eventId === `lease:${takeoverOperationId}`,
    ).length,
    1,
  );
});

test("heartbeat bind and release replay exact results after response loss", () => {
  const nowMs = Date.parse("2026-07-10T23:00:00Z");
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = "caller-retained-response-loss-token-1234567890";
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: "a0".repeat(32),
    ttlMs: 10 * 60_000,
    nowMs,
    token,
    actorCredentialToken,
  });
  const heartbeatOperationId = "b1".repeat(32);
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId: heartbeatOperationId,
        token,
        nowMs: nowMs + 1_000,
        checkpoint: throwAtLeaseCheckpoint("lease-complete"),
      }),
    /lease checkpoint lease-complete/,
  );
  const heartbeatEvents = readFileSync(
    automationControlPaths(stateRoot).events,
  );
  const heartbeatReplay = heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: heartbeatOperationId,
    token,
    nowMs: nowMs + 2_000,
  });
  assert.equal(heartbeatReplay.recovered, true);
  assert.deepEqual(
    readFileSync(automationControlPaths(stateRoot).events),
    heartbeatEvents,
  );

  const releaseOperationId = "c2".repeat(32);
  assert.throws(
    () =>
      releaseLease({
        stateRoot,
        name,
        operationId: releaseOperationId,
        token,
        nowMs: nowMs + 3_000,
        checkpoint: throwAtLeaseCheckpoint("lease-complete"),
      }),
    /lease checkpoint lease-complete/,
  );
  const releaseEvents = readFileSync(automationControlPaths(stateRoot).events);
  const releaseReplay = releaseLease({
    stateRoot,
    name,
    operationId: releaseOperationId,
    token,
    nowMs: nowMs + 4_000,
  });
  assert.equal(releaseReplay.recovered, true);
  assert.deepEqual(
    readFileSync(automationControlPaths(stateRoot).events),
    releaseEvents,
  );

  const publisherRoot = temporaryStateRoot();
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(publisherRoot),
    branch: "fix/lease-bind-response-loss",
    base: "dev",
    baseSha: "1".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  const publisherToken = "caller-retained-bind-response-loss-1234567890";
  const capability = writePublisherCapability(publisherRoot, scope, {
    nowMs,
    leaseOperationId: "d3".repeat(32),
    token: publisherToken,
  });
  acquireLeaseMutation({
    stateRoot: publisherRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    operationId: "d3".repeat(32),
    ttlMs: 30 * 60_000,
    nowMs,
    token: publisherToken,
    publisherCapabilityFile: capability.capabilityPath,
    scope,
  });
  const bindOperationId = "e4".repeat(32);
  const headSha = "2".repeat(40);
  assert.throws(
    () =>
      bindPublisherLeaseHeadMutation({
        stateRoot: publisherRoot,
        operationId: bindOperationId,
        token: publisherToken,
        scope,
        headSha,
        nowMs: nowMs + 1_000,
        checkpoint: throwAtLeaseCheckpoint("lease-complete"),
      }),
    /lease checkpoint lease-complete/,
  );
  const bindEvents = readFileSync(automationControlPaths(publisherRoot).events);
  const bindReplay = bindPublisherLeaseHeadMutation({
    stateRoot: publisherRoot,
    operationId: bindOperationId,
    token: publisherToken,
    scope,
    headSha,
    nowMs: nowMs + 2_000,
  });
  assert.equal(bindReplay.recovered, true);
  assert.deepEqual(
    readFileSync(automationControlPaths(publisherRoot).events),
    bindEvents,
  );
});

test("lease transaction rejects launcher and event contract drift", () => {
  for (const drift of ["launcher", "event"]) {
    const stateRoot = temporaryStateRoot();
    const actor = "freed-release-verifier";
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const token = `caller-retained-${drift}-drift-token-1234567890`;
    const operationId = createHash("sha256").update(drift).digest("hex");
    assert.throws(
      () =>
        acquireLeaseMutation({
          stateRoot,
          name,
          owner: actor,
          operationId,
          ttlMs: 60_000,
          nowMs: Date.parse("2026-07-10T23:30:00Z"),
          token,
          checkpoint: throwAtLeaseCheckpoint("lease-prepared"),
        }),
      /lease checkpoint lease-prepared/,
    );
    const files = leaseTransactionPaths(
      stateRoot,
      name,
      "acquire",
      operationId,
    );
    const transaction = JSON.parse(readFileSync(files.active, "utf8"));
    if (drift === "launcher") {
      transaction.request.launcherSha256 = "f".repeat(64);
    } else {
      transaction.event.data.expiresAt = "2026-07-10T23:30:01.000Z";
    }
    writeFileSync(files.active, `${JSON.stringify(transaction, null, 2)}\n`, {
      mode: 0o600,
    });
    assert.throws(
      () => inspectLease({ stateRoot, name }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "lease_transaction_invalid",
    );
    assert.equal(readControlEvents(stateRoot).length, 0);
    assert.equal(
      existsSync(
        path.join(automationControlPaths(stateRoot).leases, `${name}.lease`),
      ),
      false,
    );
  }
});

test("lease state publication rechecks expiry after canonical temporary sync", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `expiry-publication-${"x".repeat(40)}`;
  const acquiredAtMs = Date.parse("2026-07-12T01:00:00Z");
  acquireLeaseMutation({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("expiry-publication-acquire"),
    ttlMs: 1_000,
    nowMs: acquiredAtMs,
    token,
    actorCredentialToken,
  });
  const leaseRecordPath = path.join(
    automationControlPaths(stateRoot).leases,
    `${name}.lease`,
    "lease.json",
  );
  const leaseBefore = readFileSync(leaseRecordPath);
  const operationId = nextLeaseOperationId("expiry-publication-heartbeat");

  assert.throws(
    () =>
      withMutableTestDateNow(acquiredAtMs + 500, (setNowMs) =>
        heartbeatLeaseLive({
          stateRoot,
          name,
          operationId,
          token,
          ttlMs: 1_000,
          checkpoint(phase, details) {
            if (
              phase === "lease-atomic-temporary-synced" &&
              details?.kind === "canonical lease record"
            ) {
              setNowMs(acquiredAtMs + 1_001);
            }
          },
        }),
      ),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
  assert.deepEqual(readFileSync(leaseRecordPath), leaseBefore);
  assert.equal(
    readControlEvents(stateRoot).some(
      (event) => event.eventId === `lease:${operationId}`,
    ),
    false,
  );
  const files = leaseTransactionPaths(
    stateRoot,
    name,
    "heartbeat",
    operationId,
  );
  assert.equal(existsSync(files.active), true);
  assert.throws(
    () =>
      heartbeatLeaseMutation({
        stateRoot,
        name,
        operationId,
        token,
        ttlMs: 1_000,
        nowMs: acquiredAtMs + 1_001,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "lease_expired",
  );
  assert.equal(existsSync(files.active), false);
  assert.deepEqual(readFileSync(leaseRecordPath), leaseBefore);
});

test("only the exact caller plan may recover a pending lease transaction", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const operationId = nextLeaseOperationId("exact-plan-acquire");
  const token = `exact-plan-token-${"x".repeat(40)}`;
  const options = {
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    token,
    actorCredentialToken,
  };
  assert.throws(
    () =>
      acquireLeaseLive({
        ...options,
        checkpoint: throwAtLeaseCheckpoint("lease-state-committed"),
      }),
    /lease checkpoint lease-state-committed/,
  );
  const pendingState = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () =>
      acquireLeaseLive({
        ...options,
        operationId: nextLeaseOperationId("competing-acquire"),
        token: `competing-token-${"y".repeat(40)}`,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_pending",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), pendingState);
  assert.throws(
    () => inspectLease({ stateRoot, name }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_pending",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), pendingState);
  assert.throws(
    () =>
      withMutationLeaseAuthority(
        {
          stateRoot,
          actor,
          leaseName: name,
          leaseToken: token,
        },
        () => true,
      ),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_pending",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), pendingState);
  const recovered = acquireLeaseLive(options);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.lease.token, token);
});

test("recordless lease authority requires explicit repair regardless of age", () => {
  for (const age of ["young", "old"]) {
    const stateRoot = temporaryStateRoot();
    const bootstrapActor = "freed-stability-controller";
    const bootstrapName = AUTOMATION_ACTOR_POLICIES[bootstrapActor].leaseName;
    acquireLeaseMutation({
      stateRoot,
      name: bootstrapName,
      owner: bootstrapActor,
      operationId: nextLeaseOperationId(`recordless-bootstrap-${age}`),
      ttlMs: 60_000,
      nowMs: Date.parse("2026-07-20T01:00:00Z"),
      token: `recordless-bootstrap-${age}-${"b".repeat(40)}`,
      actorCredentialToken: writeActorCredential(stateRoot, bootstrapActor),
    });
    const actor = "freed-release-verifier";
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const leasePath = path.join(
      automationControlPaths(stateRoot).leases,
      `${name}.lease`,
    );
    mkdirSync(leasePath, { mode: 0o700 });
    const timestamp =
      age === "young" ? new Date() : new Date("2020-01-01T00:00:00Z");
    utimesSync(leasePath, timestamp, timestamp);
    const before = snapshotLeaseAuthorityState(stateRoot);
    const options = {
      stateRoot,
      name,
      owner: actor,
      operationId: nextLeaseOperationId(`recordless-${age}`),
      ttlMs: 60_000,
      token: `recordless-${age}-${"x".repeat(40)}`,
      actorCredentialToken: `missing-credential-${age}-${"y".repeat(32)}`,
    };
    assert.throws(
      () => acquireLeaseLive(options),
      (error) =>
        isAutomationControlError(error) &&
        error.code === "lease_repair_required",
      age,
    );
    assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), before, age);
    assert.throws(
      () => inspectLease({ stateRoot, name }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "lease_repair_required",
      age,
    );
    assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), before, age);
  }
});

test("acquire recovery derives takeover claims from exact before staging", () => {
  for (const drift of ["takeover", "credential-upgrade"]) {
    const stateRoot = temporaryStateRoot();
    const actor = "freed-release-verifier";
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const actorCredentialToken = writeActorCredential(stateRoot, actor);
    const operationId = nextLeaseOperationId(`acquire-history-${drift}`);
    const token = `acquire-history-${drift}-${"x".repeat(40)}`;
    const options = {
      stateRoot,
      name,
      owner: actor,
      operationId,
      ttlMs: 60_000,
      token,
      actorCredentialToken,
    };
    assert.throws(
      () =>
        acquireLeaseLive({
          ...options,
          checkpoint: throwAtLeaseCheckpoint("lease-prepared"),
        }),
      /lease checkpoint lease-prepared/,
    );
    const files = leaseTransactionPaths(
      stateRoot,
      name,
      "acquire",
      operationId,
    );
    const transaction = JSON.parse(readFileSync(files.active, "utf8"));
    if (drift === "takeover") {
      const previous = {
        owner: actor,
        expiredAt: new Date(
          Date.parse(transaction.preparedAt) - 1_000,
        ).toISOString(),
        heartbeatAt: new Date(
          Date.parse(transaction.preparedAt) - 2_000,
        ).toISOString(),
      };
      transaction.takeover = previous;
      transaction.resultReceipt.takeover = true;
      transaction.resultReceipt.previous = previous;
      transaction.event.type = "lease_taken_over";
      transaction.event.data.previous = previous;
    } else {
      transaction.resultReceipt.credentialUpgrade = true;
      transaction.event.type = "lease_credential_upgraded";
      transaction.event.data.credentialUpgrade = true;
    }
    writeFileSync(files.active, `${JSON.stringify(transaction, null, 2)}\n`, {
      mode: 0o600,
    });
    const driftedState = snapshotLeaseAuthorityState(stateRoot);
    assert.throws(
      () => acquireLeaseLive(options),
      (error) =>
        isAutomationControlError(error) &&
        error.code === "lease_transaction_conflict" &&
        /inconsistent staged state/.test(error.message),
      drift,
    );
    assert.deepEqual(
      snapshotLeaseAuthorityState(stateRoot),
      driftedState,
      drift,
    );
  }
});

test("completed receipt generation stays pinned through cleanup and return", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const operationId = nextLeaseOperationId("receipt-return-pin");
  const token = `receipt-return-pin-${"x".repeat(40)}`;
  const receiptPath = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  ).receipt;
  const displacedPath = `${receiptPath}.displaced`;
  let swapped = false;
  assert.throws(
    () =>
      acquireLeaseLive({
        stateRoot,
        name,
        owner: actor,
        operationId,
        ttlMs: 60_000,
        token,
        actorCredentialToken,
        checkpoint(phase) {
          if (phase !== "lease-cleanup-before-capacity-recheck" || swapped) {
            return;
          }
          swapped = true;
          const bytes = readFileSync(receiptPath);
          renameSync(receiptPath, displacedPath);
          writeFileSync(receiptPath, bytes, { mode: 0o600 });
        },
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict" &&
      /Completed lease transaction receipt changed/.test(error.message),
  );
  assert.equal(swapped, true);
  assert.notEqual(lstatSync(receiptPath).ino, lstatSync(displacedPath).ino);
  assert.equal(
    readControlEvents(stateRoot).filter(
      (event) => event.eventId === `lease:${operationId}`,
    ).length,
    1,
  );
  const recovered = acquireLeaseLive({
    stateRoot,
    name,
    owner: actor,
    operationId,
    ttlMs: 60_000,
    token,
    actorCredentialToken,
  });
  assert.equal(recovered.recovered, true);
});

test("release replay requires its exact retained authority directory", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const token = `retained-release-directory-${"x".repeat(40)}`;
  acquireLeaseLive({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("retained-release-directory-acquire"),
    ttlMs: 30 * 60_000,
    token,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
  });
  const operationId = nextLeaseOperationId("retained-release-directory");
  const options = { stateRoot, name, operationId, token };
  assert.equal(releaseLeaseMutation(options).released, true);
  const archiveRoot = path.join(
    automationControlPaths(stateRoot).leases,
    ".lease-state-quarantine",
  );
  const entries = readdirSync(archiveRoot);
  assert.equal(entries.length, 1);
  const archivePath = path.join(archiveRoot, entries[0]);
  const displacedPath = `${archivePath}.displaced`;
  renameSync(archivePath, displacedPath);
  const beforeReplay = snapshotLeaseAuthorityState(stateRoot);

  assert.throws(
    () => releaseLeaseMutation(options),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_conflict",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeReplay);
  assert.equal(existsSync(displacedPath), true);
});

test("lease directory scan fails at the first entry beyond its exact bound", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const token = `lease-directory-bound-${"x".repeat(40)}`;
  acquireLeaseLive({
    stateRoot,
    name,
    owner: actor,
    operationId: nextLeaseOperationId("lease-directory-bound"),
    ttlMs: 60_000,
    token,
    actorCredentialToken,
  });
  assert.equal(
    heartbeatLeaseLive({
      stateRoot,
      name,
      operationId: nextLeaseOperationId("lease-directory-exact-bound"),
      token,
    }).heartbeated,
    true,
  );
  const leasePath = path.join(
    automationControlPaths(stateRoot).leases,
    `${name}.lease`,
  );
  const extraPath = path.join(leasePath, "unexpected.json");
  writeFileSync(extraPath, "{}\n", { mode: 0o600 });
  assert.throws(
    () =>
      heartbeatLeaseLive({
        stateRoot,
        name,
        operationId: nextLeaseOperationId("lease-directory-over-bound"),
        token,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_transaction_invalid" &&
      /one bounded directory generation/.test(error.message),
  );
  rmSync(extraPath);
  assert.equal(inspectLease({ stateRoot, name }).owner, actor);
});

test("descriptor-held bounded lease directory scans reject path swaps and add/remove races", async (t) => {
  const controlModuleUrl = new URL(
    "./lib/automation-control.mjs",
    import.meta.url,
  ).href;

  for (const variant of ["path swap", "add/remove race"]) {
    await t.test(variant, async (subtest) => {
      const root = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), "freed-bounded-lease-scan-race-")),
      );
      const directoryPath = path.join(root, "scan");
      const displacedPath = path.join(root, "scan-admitted");
      const baselinePath = path.join(directoryPath, "baseline.json");
      const baselineBytes = Buffer.from('{"baseline":true}\n');
      mkdirSync(directoryPath, { mode: 0o700 });
      writeFileSync(baselinePath, baselineBytes, { mode: 0o600 });
      if (variant === "add/remove race") {
        const oldTime = new Date("2020-01-01T00:00:00.000Z");
        utimesSync(directoryPath, oldTime, oldTime);
      }
      const admittedIdentity = lstatSync(directoryPath, { bigint: true });
      const checkpoint = "after-list-bounded-scan";
      const childSource = `
        import { readBoundedLeaseDirectoryEntriesForTest } from ${JSON.stringify(controlModuleUrl)};
        try {
          const entries = readBoundedLeaseDirectoryEntriesForTest(
            ${JSON.stringify(directoryPath)},
            {
              maxEntries: 8,
              maxEncodedBytes: 4096,
              label: "Bounded lease directory race fixture",
              errorCode: "lease_transaction_conflict",
              helperTestPause: {
                checkpoint: ${JSON.stringify(checkpoint)},
                operation: "list-bounded",
                source: "",
                destination: "",
                releaseDescriptor: 3,
                signalDescriptor: 4,
              },
            },
          );
          process.stderr.write("UNEXPECTED_BOUNDED_SCAN:" + JSON.stringify(entries) + "\\n");
          process.exitCode = 22;
        } catch (error) {
          process.stderr.write("BOUNDED_SCAN_ERROR_CODE:" + String(error?.code ?? "unknown") + "\\n");
          process.exitCode = 23;
        }
      `;
      const child = spawn(
        process.execPath,
        ["--input-type=module", "--eval", childSource],
        {
          cwd: __dirname,
          stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
        },
      );
      subtest.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        rmSync(root, { recursive: true, force: true });
      });
      let childError = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        childError += chunk;
      });
      const childResult = waitForChild(child);
      await waitForAuthorityHelperPause(child, checkpoint);

      if (variant === "path swap") {
        renameSync(directoryPath, displacedPath);
        mkdirSync(directoryPath, { mode: 0o700 });
        writeFileSync(baselinePath, baselineBytes, { mode: 0o600 });
        assert.notEqual(
          lstatSync(directoryPath, { bigint: true }).ino,
          admittedIdentity.ino,
        );
      } else {
        const transientPath = path.join(directoryPath, "transient.json");
        writeFileSync(transientPath, "{}\n", { mode: 0o600 });
        rmSync(transientPath);
        const racedIdentity = lstatSync(directoryPath, { bigint: true });
        assert.notEqual(racedIdentity.mtimeNs, admittedIdentity.mtimeNs);
        assert.deepEqual(readdirSync(directoryPath), ["baseline.json"]);
      }

      child.stdio[3].end("1");
      const result = await childResult;
      assert.equal(result.signal, null, childError);
      assert.equal(result.code, 23, childError);
      assert.match(
        childError,
        /BOUNDED_SCAN_ERROR_CODE:lease_transaction_conflict/,
      );
      assert.deepEqual(readFileSync(baselinePath), baselineBytes);
      if (variant === "path swap") {
        assert.deepEqual(
          readFileSync(path.join(displacedPath, "baseline.json")),
          baselineBytes,
        );
      }
    });
  }
});

test("caller operation identity and acquire token are mandatory", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name: AUTOMATION_ACTOR_POLICIES[actor].leaseName,
        owner: actor,
        ttlMs: 60_000,
        token: "caller-token-without-operation-id",
        actorCredentialToken,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_operation_id_required",
  );
  for (const operationId of [
    ` ${"7e".repeat(32)}`,
    "7E".repeat(32),
    "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
  ]) {
    assert.throws(
      () =>
        acquireLeaseMutation({
          stateRoot,
          name: AUTOMATION_ACTOR_POLICIES[actor].leaseName,
          owner: actor,
          operationId,
          ttlMs: 60_000,
          token: "caller-token-with-noncanonical-operation-id",
          actorCredentialToken,
        }),
      (error) =>
        isAutomationControlError(error) &&
        error.code === "lease_operation_id_required",
    );
  }
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot,
        name: AUTOMATION_ACTOR_POLICIES[actor].leaseName,
        owner: actor,
        operationId: "7e".repeat(32),
        ttlMs: 60_000,
        actorCredentialToken,
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "lease_token_required",
  );
});

test("CLI emits structured JSON for task and lease operations", () => {
  const stateRoot = temporaryStateRoot();
  const controllerLease = acquireGeneralActorLeaseForTest({
    stateRoot,
    name: "stability-controller",
    owner: "freed-stability-controller",
    operationId: nextLeaseOperationId("cli-controller-acquire"),
    ttlMs: 60_000,
    token: `cli-controller-${"x".repeat(40)}`,
  });
  const created = runCli([
    "task",
    "create",
    "--state-root",
    stateRoot,
    "--id",
    "P0-03",
    "--actor",
    "freed-stability-controller",
    "--lease-name",
    "stability-controller",
    "--lease-token",
    controllerLease.lease.token,
    "--observer-authority",
    "plan-only",
    "--provider-authority",
    "forbidden",
    "--details-json",
    '{"behavioral":false,"metricId":"control-state"}',
  ]);
  assert.equal(created.ok, true);
  assert.equal(created.action, "task.create");
  assert.equal(created.result.task.taskId, "P0-03");

  const lease = acquireGeneralActorLeaseForTest({
    stateRoot,
    name: "nightly-writer",
    owner: "freed-nightly-runner",
    operationId: nextLeaseOperationId("cli-nightly-acquire"),
    ttlMs: 60_000,
    token: `cli-nightly-${"x".repeat(40)}`,
  });
  assert.equal(lease.lease.owner, "freed-nightly-runner");
  assert.equal(lease.lease.observerAuthority, "merge-safe");
  assert.equal(lease.lease.providerAuthority, "approval-required");
  assert.ok(lease.lease.token);

  const shown = runCli([
    "lease",
    "show",
    "--state-root",
    stateRoot,
    "--name",
    "nightly-writer",
  ]);
  assert.equal(shown.result.owner, "freed-nightly-runner");
  assert.equal(Object.hasOwn(shown.result, "token"), false);

  const heartbeated = runCli(
    [
      "lease",
      "heartbeat",
      "--state-root",
      stateRoot,
      "--name",
      "nightly-writer",
      "--ttl-seconds",
      "60",
    ],
    {
      env: {
        ...process.env,
        FREED_AUTOMATION_LEASE_TOKEN: lease.lease.token,
      },
    },
  );
  assert.equal(heartbeated.result.heartbeated, true);
});

test("outcome ledger repair preauthorization binds one exact receipt to the owner lease", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const taskId = "outcome-ledger-history-repair";
  createOutcomeLedgerRepairTask(stateRoot, taskId, nowMs - 1_000);
  const parameters = outcomeLedgerRepairParametersForCurrentEventHistory(
    stateRoot,
    taskId,
  );
  const intentDigest = ownerIntent("outcome-ledger.repair", taskId, parameters);
  const owner = actorLease(stateRoot, "freed-owner", {
    nowMs,
    ownerTaskId: taskId,
    ownerIntentDigest: intentDigest,
  });

  const authorization = preauthorizeOutcomeLedgerRepair({
    stateRoot,
    taskId,
    ...owner,
    parameters,
    nowMs: nowMs + 1_000,
  });
  assert.equal(authorization.action, "outcome-ledger.repair");
  assert.equal(authorization.taskId, taskId);
  assert.equal(authorization.intentDigest, intentDigest);
  assert.equal(
    authorization.eventId,
    `outcome-history-repaired:${parameters.operationId}`,
  );
  assert.deepEqual(
    Object.keys(authorization.parameters),
    Object.keys(parameters).sort(),
  );
  assert.deepEqual(authorization.parameters, {
    ...Object.fromEntries(
      Object.keys(parameters)
        .sort()
        .map((key) => [key, parameters[key]]),
    ),
  });
  assert.equal(
    authorization.authorizationProvenance.credentialKind,
    "owner-confirmation",
  );

  assert.throws(
    () =>
      preauthorizeOutcomeLedgerRepair({
        stateRoot,
        taskId,
        ...owner,
        actor: "freed-stability-controller",
        leaseName: "stability-controller",
        parameters,
        nowMs: nowMs + 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_not_authorized",
  );
  assert.throws(
    () =>
      preauthorizeOutcomeLedgerRepair({
        stateRoot,
        taskId,
        ...owner,
        leaseName: "stability-controller",
        parameters,
        nowMs: nowMs + 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_not_authorized",
  );
  assert.throws(
    () => {
      const differentTaskId = "different-outcome-ledger-repair";
      const differentParameters = outcomeLedgerRepairParameters(
        stateRoot,
        differentTaskId,
      );
      preauthorizeOutcomeLedgerRepair({
        stateRoot,
        taskId: differentTaskId,
        ...owner,
        parameters: differentParameters,
        nowMs: nowMs + 1_000,
      });
    },
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_capability_intent_mismatch",
  );
});

test("outcome ledger repair preauthorization rejects noncanonical receipt parameters", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const taskId = "outcome-ledger-history-repair-invalid";
  createOutcomeLedgerRepairTask(stateRoot, taskId, nowMs - 1_000);
  const parameters = outcomeLedgerRepairParameters(stateRoot, taskId);
  const owner = actorLease(stateRoot, "freed-owner", {
    nowMs,
    ownerTaskId: taskId,
    ownerIntentDigest: ownerIntent("outcome-ledger.repair", taskId, parameters),
  });
  const authorize = (candidate) =>
    preauthorizeOutcomeLedgerRepair({
      stateRoot,
      taskId,
      ...owner,
      parameters: candidate,
      nowMs: nowMs + 1_000,
    });

  const invalidParameters = [
    { ...parameters, extra: true },
    { ...parameters, policy: "freed-outcome-ledger-repair-v2" },
    { ...parameters, stateRoot: `${parameters.stateRoot}/.` },
    { ...parameters, ledgerPath: path.join(parameters.stateRoot, "other") },
    { ...parameters, sourceDigest: "AA".repeat(32) },
    { ...parameters, eventHistorySize: -1 },
    { ...parameters, trustedCount: 1 },
    { ...parameters, archiveDigest: "07".repeat(32) },
  ];
  for (const candidate of invalidParameters) {
    assert.throws(
      () => authorize(candidate),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "outcome_ledger_repair_intent_invalid",
    );
  }

  class ReceiptParameters {}
  const nonPlain = Object.assign(new ReceiptParameters(), parameters);
  assert.throws(
    () => authorize(nonPlain),
    (error) =>
      error instanceof AutomationControlError && error.code === "invalid_value",
  );
});

test("outcome ledger repair event preflight is deterministic and read-only", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const taskId = "outcome-ledger-history-repair-event";
  createOutcomeLedgerRepairTask(stateRoot, taskId, nowMs - 1_000);
  const parameters = outcomeLedgerRepairParametersForCurrentEventHistory(
    stateRoot,
    taskId,
  );
  const intentDigest = ownerIntent("outcome-ledger.repair", taskId, parameters);
  const owner = actorLease(stateRoot, "freed-owner", {
    nowMs,
    ownerTaskId: taskId,
    ownerIntentDigest: intentDigest,
  });
  const acquiredAtMs = Date.parse(ownerLeaseAcquisition(stateRoot).ts);
  const input = { stateRoot, taskId, ...owner, parameters };
  const eventsPath = automationControlPaths(stateRoot).events;
  const eventsBefore = readFileSync(eventsPath);
  assert.equal(
    createHash("sha256")
      .update(eventsBefore.subarray(0, parameters.eventHistorySize))
      .digest("hex"),
    parameters.eventHistoryDigest,
    "owner acquisition must preserve the planned event-history prefix",
  );

  const first = preflightOutcomeLedgerRepairEvent({
    ...input,
    nowMs: acquiredAtMs + 1_000,
  });
  assert.deepEqual(
    readFileSync(eventsPath),
    eventsBefore,
    "first preflight must not change event history",
  );
  const retry = preflightOutcomeLedgerRepairEvent({
    ...input,
    nowMs: acquiredAtMs + 20_000,
  });
  assert.equal(first.existing, false);
  assert.equal(retry.existing, false);
  assert.equal(first.event.type, "outcome_history_repaired");
  assert.equal(
    first.event.eventId,
    `outcome-history-repaired:${parameters.operationId}`,
  );
  assert.equal(first.event.ts, new Date(acquiredAtMs).toISOString());
  assert.equal(retry.event.ts, first.event.ts);
  assert.deepEqual(Object.keys(first.event.data).sort(), [
    "authorization",
    "intentDigest",
    "parameters",
  ]);
  assert.equal(first.event.data.intentDigest, intentDigest);
  assert.deepEqual(first.event.data.parameters, {
    ...Object.fromEntries(
      Object.keys(parameters)
        .sort()
        .map((key) => [key, parameters[key]]),
    ),
  });
  assert.deepEqual(readFileSync(eventsPath), eventsBefore);
  assert.equal(
    readEvents(stateRoot).filter(
      (event) => event.eventId === first.event.eventId,
    ).length,
    0,
  );
  assert.throws(
    () =>
      appendControlEvent({
        ...input,
        type: "outcome_history_repaired",
        data: {},
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "reserved_event_type",
  );
});

test("outcome ledger repair audit requires one exact preceding owner acquisition", () => {
  const nowMs = Date.parse("2026-07-18T10:12:00Z");
  const stateRoot = temporaryStateRoot();
  const taskId = "outcome-ledger-repair-acquisition-history";
  const { parameters, intentDigest, owner } = withTestDateNow(nowMs, () => {
    createOutcomeLedgerRepairTask(stateRoot, taskId, nowMs - 1_000);
    const parameters = outcomeLedgerRepairParameters(stateRoot, taskId);
    const intentDigest = ownerIntent(
      "outcome-ledger.repair",
      taskId,
      parameters,
    );
    const owner = actorLease(stateRoot, "freed-owner", {
      nowMs,
      ownerTaskId: taskId,
      ownerIntentDigest: intentDigest,
    });
    return { parameters, intentDigest, owner };
  });
  const input = { stateRoot, taskId, ...owner, parameters };
  const eventsPath = automationControlPaths(stateRoot).events;
  const baseline = readControlEvents(stateRoot);
  const acquisitionIndex = baseline.findIndex(
    (event) =>
      event.type === "lease_acquired" &&
      event.actor === "freed-owner" &&
      event.leaseName === "owner-governance",
  );
  assert.notEqual(acquisitionIndex, -1);
  const acquiredAtMs = Date.parse(baseline[acquisitionIndex].ts);
  const auditAtMs = acquiredAtMs + 1_000;

  const variants = [
    {
      label: "acquisition after audit",
      mutate: (event) => {
        event.ts = new Date(auditAtMs + 1_000).toISOString();
      },
    },
    {
      label: "audit at lease expiry",
      mutate: (event) => {
        event.data.expiresAt = new Date(auditAtMs).toISOString();
      },
    },
    {
      label: "spliced owner credential",
      mutate: (event) => {
        if (event.data.ownerCapabilityId !== undefined) {
          event.data.ownerCapabilityId = "spliced-owner-capability";
        } else {
          event.data.ownerConfirmationId = "spliced-owner-confirmation";
        }
      },
    },
  ];

  for (const variant of variants) {
    const events = structuredClone(baseline);
    variant.mutate(events[acquisitionIndex]);
    writeFileSync(
      eventsPath,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      { mode: 0o600 },
    );
    const before = readFileSync(eventsPath);
    assert.throws(
      () =>
        withTestDateNow(auditAtMs, () =>
          preflightOutcomeLedgerRepairEvent({
            ...input,
            nowMs: auditAtMs,
          }),
        ),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "outcome_ledger_repair_event_invalid",
      variant.label,
    );
    assert.deepEqual(readFileSync(eventsPath), before, variant.label);
  }
});

test("outcome ledger repair event preflight rejects conflicting and duplicate identities", () => {
  const nowMs = Date.now();

  const conflictingRoot = temporaryStateRoot();
  const conflictingTaskId = "outcome-ledger-history-repair-conflict";
  createOutcomeLedgerRepairTask(
    conflictingRoot,
    conflictingTaskId,
    nowMs - 1_000,
  );
  const conflictingParameters =
    outcomeLedgerRepairParametersForCurrentEventHistory(
      conflictingRoot,
      conflictingTaskId,
    );
  const conflictingOwner = actorLease(conflictingRoot, "freed-owner", {
    nowMs,
    ownerTaskId: conflictingTaskId,
    ownerIntentDigest: ownerIntent(
      "outcome-ledger.repair",
      conflictingTaskId,
      conflictingParameters,
    ),
  });
  const conflictingAcquiredAtMs = Date.parse(
    ownerLeaseAcquisition(conflictingRoot).ts,
  );
  const conflictingInput = {
    stateRoot: conflictingRoot,
    taskId: conflictingTaskId,
    ...conflictingOwner,
    parameters: conflictingParameters,
  };
  const conflictingEvent = structuredClone(
    preflightOutcomeLedgerRepairEvent({
      ...conflictingInput,
      nowMs: conflictingAcquiredAtMs + 1_000,
    }).event,
  );
  conflictingEvent.ts = new Date(
    Date.parse(conflictingEvent.ts) + 1,
  ).toISOString();
  appendCanonicalControlEventFixtures(
    conflictingRoot,
    [conflictingEvent],
    "test-outcome-repair-event-conflict",
  );
  assert.throws(
    () =>
      preflightOutcomeLedgerRepairEvent({
        ...conflictingInput,
        nowMs: conflictingAcquiredAtMs + 2_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "control_event_conflict",
  );

  const duplicateRoot = temporaryStateRoot();
  const duplicateTaskId = "outcome-ledger-history-repair-duplicate";
  createOutcomeLedgerRepairTask(duplicateRoot, duplicateTaskId, nowMs - 1_000);
  const duplicateParameters =
    outcomeLedgerRepairParametersForCurrentEventHistory(
      duplicateRoot,
      duplicateTaskId,
    );
  const duplicateOwner = actorLease(duplicateRoot, "freed-owner", {
    nowMs,
    ownerTaskId: duplicateTaskId,
    ownerIntentDigest: ownerIntent(
      "outcome-ledger.repair",
      duplicateTaskId,
      duplicateParameters,
    ),
  });
  const duplicateAcquiredAtMs = Date.parse(
    ownerLeaseAcquisition(duplicateRoot).ts,
  );
  const duplicateInput = {
    stateRoot: duplicateRoot,
    taskId: duplicateTaskId,
    ...duplicateOwner,
    parameters: duplicateParameters,
  };
  const event = preflightOutcomeLedgerRepairEvent({
    ...duplicateInput,
    nowMs: duplicateAcquiredAtMs + 1_000,
  }).event;
  appendCanonicalControlEventFixtures(
    duplicateRoot,
    [event, event],
    "test-outcome-repair-event-duplicate",
  );
  assert.throws(
    () =>
      preflightOutcomeLedgerRepairEvent({
        ...duplicateInput,
        nowMs: duplicateAcquiredAtMs + 2_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "control_event_duplicate",
  );
});

test("control event appends atomically preserve exact existing bytes and newline boundaries", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  const paths = automationControlPaths(stateRoot);
  const existing = JSON.stringify({
    schemaVersion: 1,
    eventId: "existing-control-event",
    type: "existing_event",
    ts: "2026-07-18T10:20:00.000Z",
    actor: "freed-runtime-observer",
    data: { exact: "bytes" },
  });
  writeFileSync(paths.events, existing);

  const appended = appendControlEvent({
    stateRoot,
    type: "test_event",
    ...controller,
    data: { appended: true },
    eventId: "new-control-event",
    nowMs: nowMs + 1_000,
  });
  const bytes = readFileSync(paths.events, "utf8");
  assert.equal(bytes, `${existing}\n${JSON.stringify(appended)}\n`);
  const readyWitnesses = readdirSync(paths.controlRoot).filter((name) =>
    name.endsWith(".tmp"),
  );
  assert.equal(readyWitnesses.length, 1);
  assert.match(
    readyWitnesses[0],
    /^\.events\.jsonl\.authority\.[0-9a-f]{64}\.[0-9a-f]{64}\.tmp$/,
  );
});

test("control event append preserves history when its private parent becomes unsafe", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("Permission failure cannot be induced while running as root.");
    return;
  }
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-18T10:25:00Z");
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  const paths = automationControlPaths(stateRoot);
  const before = readFileSync(paths.events);
  chmodSync(paths.controlRoot, 0o500);
  try {
    assert.throws(
      () =>
        appendControlEvent({
          stateRoot,
          type: "must_not_tear_history",
          ...controller,
          data: { attempted: true },
          nowMs: nowMs + 1_000,
        }),
      (error) =>
        error?.code === "invalid_state" ||
        error?.code === "lease_permissions_invalid" ||
        ["EACCES", "EPERM", "EROFS"].includes(error?.code),
    );
  } finally {
    chmodSync(paths.controlRoot, 0o700);
  }
  assert.deepEqual(readFileSync(paths.events), before);
  assert.equal(
    readdirSync(paths.controlRoot).some((name) => name.endsWith(".tmp")),
    false,
  );
});

test("CLI computes the canonical owner governance intent digest", () => {
  const intent = {
    schemaVersion: 1,
    action: "task.authorize",
    taskId: "owner-digest-task",
    parameters: {
      observerAuthority: "merge-safe",
      providerAuthority: null,
      reason: "Approve the reviewed task.",
      approvalReference: null,
      expectedRevision: 1,
    },
  };
  const result = runCli([
    "owner",
    "intent-digest",
    "--intent-json",
    JSON.stringify(intent),
  ]);
  assert.equal(result.result.intentDigest, ownerGovernanceIntentDigest(intent));
});

test("CLI accepts a current-task owner confirmation without a broker token", () => {
  const stateRoot = temporaryStateRoot();
  const taskId = "cli-current-task-owner";
  const details = {
    behavioral: false,
    metricId: "renderer-recovery-count",
  };
  const intent = {
    schemaVersion: 1,
    action: "task.create",
    taskId,
    parameters: {
      state: "observed",
      observerAuthority: "merge-safe",
      providerAuthority: "forbidden",
      approvalReference: null,
      details,
    },
  };
  const intentDigest = ownerGovernanceIntentDigest(intent);
  const { confirmationPath } = writeOwnerConfirmation(
    stateRoot,
    taskId,
    intent,
    { nowMs: Date.now(), confirmationId: "cli-owner-confirmation" },
  );
  const lease = runCli([
    "lease",
    "acquire",
    "--state-root",
    stateRoot,
    "--name",
    "owner-governance",
    "--owner",
    "freed-owner",
    "--ttl-seconds",
    "60",
    "--owner-confirmation-file",
    confirmationPath,
    "--owner-task-id",
    taskId,
    "--owner-intent-digest",
    intentDigest,
  ]);
  assert.equal(lease.result.lease.credentialKind, "owner-confirmation");
  assert.ok(lease.result.lease.token);

  const created = runCli([
    "task",
    "create",
    "--state-root",
    stateRoot,
    "--id",
    taskId,
    "--actor",
    "freed-owner",
    "--lease-name",
    "owner-governance",
    "--lease-token",
    lease.result.lease.token,
    "--observer-authority",
    "merge-safe",
    "--provider-authority",
    "forbidden",
    "--details-json",
    JSON.stringify(details),
  ]);
  assert.equal(created.result.task.taskId, taskId);
});

test("CLI cannot mint freed-owner without an approved owner source", async () => {
  const stateRoot = temporaryStateRoot();
  const args = [
    "lease",
    "acquire",
    "--state-root",
    stateRoot,
    "--name",
    "owner-governance",
    "--owner",
    "freed-owner",
    "--ttl-seconds",
    "60",
  ];
  const missing = await spawnCli(args, { supplyLeaseToken: false });
  assert.equal(missing.code, 1);
  assert.equal(JSON.parse(missing.stderr).error.code, "invalid_argument");

  const noCapability = await spawnCli(args, {
    env: {
      ...process.env,
      FREED_OWNER_LEASE_TOKEN: "cli-owner-lease-token-123456789012345",
      FREED_OWNER_BOOTSTRAP_TOKEN: "ignored-same-uid-bootstrap-token",
    },
  });
  assert.equal(noCapability.code, 1);
  assert.equal(
    JSON.parse(noCapability.stderr).error.code,
    "owner_capability_required",
  );
});

test("concurrent direct CLI acquisition cannot bypass the trusted actor launcher", async () => {
  const stateRoot = temporaryStateRoot();
  const attempts = await Promise.all(
    Array.from({ length: 6 }, () =>
      spawnCli(
        [
          "lease",
          "acquire",
          "--state-root",
          stateRoot,
          "--name",
          "nightly-writer",
          "--owner",
          "freed-nightly-runner",
          "--ttl-seconds",
          "60",
        ],
        {},
      ),
    ),
  );

  const successes = attempts.filter((attempt) => attempt.code === 0);
  const failures = attempts.filter((attempt) => attempt.code !== 0);
  assert.equal(successes.length, 0);
  assert.equal(failures.length, 6);
  assert.ok(
    failures.every((attempt) =>
      ["actor_launcher_required"].includes(JSON.parse(attempt.stderr).error.code),
    ),
    JSON.stringify(
      failures.map((attempt) => ({
        code: attempt.code,
        stderr: attempt.stderr,
      })),
    ),
  );
  assert.equal(inspectLease({ stateRoot, name: "nightly-writer" }), null);
});

test("production lease event publication rejects destination and parent swaps", async (t) => {
  for (const variant of ["destination", "parent"]) {
    await t.test(variant, () => {
      const stateRoot = temporaryStateRoot();
      const actor = "freed-release-verifier";
      const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
      const actorCredentialToken = writeActorCredential(stateRoot, actor);
      const token = `live-event-${variant}-${"x".repeat(48)}`;
      const startedAt = Date.now();
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId: nextLeaseOperationId(`live-event-${variant}-acquire`),
        ttlMs: 60_000,
        nowMs: startedAt,
        token,
        actorCredentialToken,
      });
      const operationId = nextLeaseOperationId(
        `live-event-${variant}-heartbeat`,
      );
      const paths = automationControlPaths(stateRoot);
      const admittedBytes = readFileSync(paths.events);
      const swappedBytes = Buffer.concat([
        admittedBytes,
        Buffer.from(
          `${JSON.stringify({
            schemaVersion: 1,
            eventId: `swapped-live-event-${variant}`,
            type: "test_event_swap",
            ts: new Date(startedAt).toISOString(),
            actor: "test-fixture",
          })}\n`,
        ),
      ]);
      const savedPath = path.join(
        stateRoot,
        variant === "destination"
          ? "live-events-original.jsonl"
          : "live-control-original",
      );
      let swapped = false;

      assert.throws(
        () =>
          heartbeatLeaseMutation({
            stateRoot,
            name,
            operationId,
            token,
            ttlMs: 60_000,
            nowMs: startedAt + 1,
            checkpoint: (phase) => {
              if (swapped || phase !== "lease-event-before-publication") {
                return;
              }
              swapped = true;
              if (variant === "destination") {
                renameSync(paths.events, savedPath);
              } else {
                renameSync(paths.controlRoot, savedPath);
                mkdirSync(paths.controlRoot, { mode: 0o700 });
              }
              writeFileSync(paths.events, swappedBytes, { mode: 0o600 });
            },
          }),
        (error) =>
          error instanceof AutomationControlError &&
          [
            "authority_generation_conflict",
            "lease_transaction_conflict",
          ].includes(error.code),
      );

      assert.equal(swapped, true);
      assert.deepEqual(readFileSync(paths.events), swappedBytes);
      const preservedEventsPath =
        variant === "destination"
          ? savedPath
          : path.join(savedPath, path.basename(paths.events));
      const preservedEvents = readFileSync(preservedEventsPath);
      if (variant === "destination") {
        assert.deepEqual(preservedEvents, admittedBytes);
      } else {
        assert.deepEqual(
          preservedEvents.subarray(0, admittedBytes.length),
          admittedBytes,
        );
      }

      if (variant === "destination") {
        rmSync(paths.events);
        renameSync(savedPath, paths.events);
      } else {
        rmSync(paths.controlRoot, { recursive: true, force: true });
        renameSync(savedPath, paths.controlRoot);
      }
      const retry = () =>
        heartbeatLeaseMutation({
          stateRoot,
          name,
          operationId,
          token,
          ttlMs: 60_000,
          nowMs: startedAt + 1,
        });
      if (variant === "destination") {
        assert.throws(
          retry,
          (error) =>
            error instanceof AutomationControlError &&
            [
              "authority_generation_conflict",
              "lease_transaction_conflict",
            ].includes(error.code),
        );
        assert.equal(
          readEvents(stateRoot).filter(
            (event) => event.eventId === `lease:${operationId}`,
          ).length,
          0,
        );
      } else {
        const recovered = retry();
        assert.equal(recovered.recovered, true);
        assert.equal(
          readEvents(stateRoot).filter(
            (event) => event.eventId === `lease:${operationId}`,
          ).length,
          1,
        );
      }
    });
  }
});

test("production lease recovery rejects destination and parent swaps", async (t) => {
  const controlModuleUrl = new URL(
    "./lib/automation-control.mjs",
    import.meta.url,
  ).href;

  for (const variant of ["destination", "parent"]) {
    await t.test(variant, async () => {
      const stateRoot = temporaryStateRoot();
      const actor = "freed-release-verifier";
      const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
      const actorCredentialToken = writeActorCredential(stateRoot, actor);
      const token = `recovery-event-${variant}-${"x".repeat(48)}`;
      const startedAt = Date.now();
      acquireLeaseMutation({
        stateRoot,
        name,
        owner: actor,
        operationId: nextLeaseOperationId(`recovery-event-${variant}-acquire`),
        ttlMs: 60_000,
        nowMs: startedAt,
        token,
        actorCredentialToken,
      });
      const operationId = nextLeaseOperationId(
        `recovery-event-${variant}-heartbeat`,
      );
      assert.throws(
        () =>
          heartbeatLeaseMutation({
            stateRoot,
            name,
            operationId,
            token,
            ttlMs: 60_000,
            nowMs: startedAt + 1,
            checkpoint: throwAtLeaseCheckpoint("lease-state-committed"),
          }),
        /lease checkpoint lease-state-committed/,
      );

      const paths = automationControlPaths(stateRoot);
      const fillerTimestamp = new Date(startedAt).toISOString();
      const filler = Array.from({ length: 40_000 }, (_, index) =>
        JSON.stringify({
          schemaVersion: 1,
          eventId: `recovery-race-filler-${variant}-${index}`,
          type: "test_recovery_filler",
          ts: fillerTimestamp,
          actor: "test-fixture",
        }),
      ).join("\n");
      appendFileSync(paths.events, `${filler}\n`);
      const admittedBytes = readFileSync(paths.events);
      const swappedBytes = Buffer.from(
        `${JSON.stringify({
          schemaVersion: 1,
          eventId: `swapped-recovery-event-${variant}`,
          type: "test_event_swap",
          ts: fillerTimestamp,
          actor: "test-fixture",
        })}\n`,
      );
      const savedPath = path.join(
        stateRoot,
        variant === "destination"
          ? "recovery-events-original.jsonl"
          : "recovery-control-original",
      );
      let attacked = false;
      let attackError = null;
      const watcher = watch(paths.controlRoot, (_eventType, filename) => {
        const entry = String(filename ?? "");
        const stagePrefix = ".events.jsonl.authority.";
        const stageSuffix = entry.startsWith(stagePrefix)
          ? entry.slice(stagePrefix.length)
          : "";
        const authorityStage =
          /^[0-9a-f]{64}\.staging$/.test(stageSuffix) ||
          /^[0-9a-f]{64}\.[0-9a-f]{64}\.tmp$/.test(stageSuffix);
        if (attacked || !authorityStage) {
          return;
        }
        attacked = true;
        try {
          if (variant === "destination") {
            renameSync(paths.events, savedPath);
          } else {
            renameSync(paths.controlRoot, savedPath);
            mkdirSync(paths.controlRoot, { mode: 0o700 });
          }
          writeFileSync(paths.events, swappedBytes, { mode: 0o600 });
        } catch (error) {
          attackError = error;
        }
      });
      const childSource = `
        import { heartbeatLease } from ${JSON.stringify(controlModuleUrl)};
        try {
          heartbeatLease(${JSON.stringify({
            stateRoot,
            name,
            operationId,
            token,
            ttlMs: 60_000,
          })});
          process.exit(2);
        } catch (error) {
          if (!["authority_generation_conflict", "lease_transaction_conflict"].includes(error?.code)) {
            console.error(error?.stack ?? error);
            process.exit(3);
          }
        }
      `;
      const child = spawn(
        process.execPath,
        ["--input-type=module", "--eval", childSource],
        { cwd: __dirname, stdio: ["ignore", "ignore", "pipe"] },
      );
      let childError = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        childError += chunk;
      });
      const result = await waitForChild(child);
      watcher.close();

      if (attackError !== null) throw attackError;
      assert.equal(attacked, true);
      assert.equal(result.signal, null);
      assert.equal(result.code, 0, childError);
      assert.deepEqual(readFileSync(paths.events), swappedBytes);
      const preservedEventsPath =
        variant === "destination"
          ? savedPath
          : path.join(savedPath, path.basename(paths.events));
      assert.deepEqual(readFileSync(preservedEventsPath), admittedBytes);
    });
  }
});

test("production task manifest publication rejects destination and parent swaps", async (t) => {
  for (const variant of ["destination", "parent"]) {
    await t.test(variant, () => {
      const stateRoot = temporaryStateRoot();
      const controller = actorLease(stateRoot, "freed-stability-controller");
      createTask({
        stateRoot,
        taskId: `manifest-publication-${variant}`,
        ...controller,
        observerAuthority: "plan-only",
        providerAuthority: "forbidden",
        details: { behavioral: false },
      });
      const paths = automationControlPaths(stateRoot);
      const admitted = readAutomationAuthorityFileSnapshot(paths.taskManifest, {
        privateRoot: paths.controlRoot,
        label: "Current task manifest",
      });
      const manifest = JSON.parse(admitted.bytes.toString("utf8"));
      manifest.updatedAt = new Date(Date.now() + 1).toISOString();
      const proposedBytes = Buffer.from(
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      const swappedBytes = Buffer.from(
        `${JSON.stringify({ swapped: `task-manifest-${variant}` })}\n`,
      );
      const savedPath = path.join(
        stateRoot,
        variant === "destination"
          ? "manifest-original.json"
          : "manifest-control-original",
      );
      let swapped = false;

      assert.throws(
        () =>
          writeAutomationAuthorityFile({
            filePath: paths.taskManifest,
            bytes: proposedBytes,
            previousSnapshot: admitted,
            operationId: `task-manifest-publication-${variant}`,
            privateRoot: paths.controlRoot,
            label: "Current task manifest",
            beforePublish: () => {
              swapped = true;
              if (variant === "destination") {
                renameSync(paths.taskManifest, savedPath);
              } else {
                renameSync(paths.controlRoot, savedPath);
                mkdirSync(paths.controlRoot, { mode: 0o700 });
              }
              writeFileSync(paths.taskManifest, swappedBytes, { mode: 0o600 });
            },
          }),
        (error) =>
          error instanceof AutomationControlError &&
          [
            "authority_generation_conflict",
            "lease_transaction_conflict",
          ].includes(error.code),
      );

      assert.equal(swapped, true);
      assert.deepEqual(readFileSync(paths.taskManifest), swappedBytes);
      const preservedManifestPath =
        variant === "destination"
          ? savedPath
          : path.join(savedPath, path.basename(paths.taskManifest));
      assert.deepEqual(
        readFileSync(preservedManifestPath),
        variant === "destination" ? admitted.bytes : proposedBytes,
      );
    });
  }
});

test("writeJsonAtomic never repairs a drifted expected-snapshot parent", async (t) => {
  for (const variant of ["mode", "replacement"]) {
    await t.test(variant, () => {
      const stateRoot = temporaryStateRoot();
      const paths = automationControlPaths(stateRoot);
      mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
      const filePath = path.join(paths.controlRoot, `parent-${variant}.json`);
      const predecessor = { generation: `before-${variant}` };
      writeFileSync(filePath, `${JSON.stringify(predecessor, null, 2)}\n`, {
        mode: 0o600,
      });
      const admitted = readAutomationAuthorityFileSnapshot(filePath, {
        privateRoot: paths.controlRoot,
        label: `Expected-snapshot parent ${variant} fixture`,
      });
      const savedParent = path.join(stateRoot, `parent-${variant}.saved`);
      if (variant === "replacement") {
        renameSync(paths.controlRoot, savedParent);
        mkdirSync(paths.controlRoot, { mode: 0o755 });
        writeFileSync(filePath, admitted.bytes, { mode: 0o600 });
        writeFileSync(
          path.join(paths.controlRoot, "foreign-parent-marker"),
          "foreign parent\n",
          { mode: 0o600 },
        );
      } else {
        chmodSync(paths.controlRoot, 0o755);
      }
      const parentBefore = lstatSync(paths.controlRoot, { bigint: true });
      const entriesBefore = readdirSync(paths.controlRoot).sort();
      const fileBefore = readFileSync(filePath);
      const markerPath = path.join(paths.controlRoot, "foreign-parent-marker");
      const markerBefore = existsSync(markerPath)
        ? readFileSync(markerPath)
        : null;

      assert.throws(
        () =>
          writeJsonAtomic(
            filePath,
            { generation: `after-${variant}` },
            {
              expectedSnapshot: admitted,
              operationId: `expected-parent-${variant}`,
              privateRoot: paths.controlRoot,
              label: `Expected-snapshot parent ${variant} fixture`,
            },
          ),
        (error) =>
          error instanceof AutomationControlError &&
          [
            "authority_generation_conflict",
            "lease_transaction_conflict",
          ].includes(error.code),
      );

      const parentAfter = lstatSync(paths.controlRoot, { bigint: true });
      assert.equal(parentAfter.dev, parentBefore.dev);
      assert.equal(parentAfter.ino, parentBefore.ino);
      assert.equal(parentAfter.mode, parentBefore.mode);
      assert.equal(parentAfter.ctimeNs, parentBefore.ctimeNs);
      assert.deepEqual(readdirSync(paths.controlRoot).sort(), entriesBefore);
      assert.deepEqual(readFileSync(filePath), fileBefore);
      if (markerBefore !== null) {
        assert.deepEqual(readFileSync(markerPath), markerBefore);
      }
      if (variant === "replacement") {
        assert.deepEqual(
          readFileSync(path.join(savedParent, path.basename(filePath))),
          admitted.bytes,
        );
      }
    });
  }
});

test("descriptor-bound authority reads reject timed parent substitution", async (t) => {
  const controlModuleUrl = new URL(
    "./lib/automation-control.mjs",
    import.meta.url,
  ).href;

  for (const variant of ["present", "missing"]) {
    await t.test(variant, async (subtest) => {
      const stateRoot = temporaryStateRoot();
      const paths = automationControlPaths(stateRoot);
      mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
      const filePath = path.join(
        paths.controlRoot,
        `descriptor-parent-${variant}.json`,
      );
      const admittedBytes = Buffer.from(
        `${JSON.stringify({ generation: `admitted-${variant}` })}\n`,
      );
      if (variant === "present") {
        writeFileSync(filePath, admittedBytes, { mode: 0o600 });
      }
      const checkpoint =
        variant === "present"
          ? "after-authority-entry-inventory-lstat-before-open"
          : "after-authority-entry-inventory-first-missing-proof";
      const savedParent = path.join(
        stateRoot,
        `descriptor-parent-${variant}.saved`,
      );
      const childSource = `
        import { readAutomationAuthorityFileSnapshot } from ${JSON.stringify(controlModuleUrl)};
        try {
          readAutomationAuthorityFileSnapshot(${JSON.stringify(filePath)}, {
            allowMissing: ${variant === "missing" ? "true" : "false"},
            privateRoot: ${JSON.stringify(paths.controlRoot)},
            label: ${JSON.stringify(`Descriptor parent ${variant} fixture`)},
            invalidCode: "authority_generation_conflict",
            helperTestPause: {
              checkpoint: ${JSON.stringify(checkpoint)},
              operation: "authority-entry-inventory",
              source: ${JSON.stringify(path.basename(filePath))},
              destination: "",
              releaseDescriptor: 3,
              signalDescriptor: 4,
            },
          });
          console.error("AUTHORITY_UNEXPECTED_SUCCESS");
          process.exit(22);
        } catch (error) {
          console.error("AUTHORITY_ERROR_CODE:" + String(error?.code ?? "unknown"));
          process.exit(23);
        }
      `;
      const child = spawn(
        process.execPath,
        ["--input-type=module", "--eval", childSource],
        {
          cwd: __dirname,
          stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
        },
      );
      subtest.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill();
      });
      let childError = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        childError += chunk;
      });
      const childResult = waitForChild(child);
      await waitForAuthorityHelperPause(child, checkpoint);

      const admittedParentIdentity = lstatSync(paths.controlRoot, {
        bigint: true,
      });
      renameSync(paths.controlRoot, savedParent);
      mkdirSync(paths.controlRoot, { mode: 0o700 });
      writeFileSync(filePath, admittedBytes, { mode: 0o600 });
      const foreignParentIdentity = lstatSync(paths.controlRoot, {
        bigint: true,
      });
      const foreignFileIdentity = lstatSync(filePath, { bigint: true });
      child.stdio[3].end("1");
      const result = await childResult;

      assert.equal(result.signal, null, childError);
      assert.equal(result.code, 23, childError);
      assert.match(
        childError,
        /AUTHORITY_ERROR_CODE:(authority_generation_conflict|lease_transaction_conflict)/,
      );
      const foreignParentAfter = lstatSync(paths.controlRoot, {
        bigint: true,
      });
      const foreignFileAfter = lstatSync(filePath, { bigint: true });
      assert.equal(foreignParentAfter.dev, foreignParentIdentity.dev);
      assert.equal(foreignParentAfter.ino, foreignParentIdentity.ino);
      assert.equal(foreignFileAfter.dev, foreignFileIdentity.dev);
      assert.equal(foreignFileAfter.ino, foreignFileIdentity.ino);
      assert.deepEqual(readFileSync(filePath), admittedBytes);
      const savedParentAfter = lstatSync(savedParent, { bigint: true });
      assert.equal(savedParentAfter.dev, admittedParentIdentity.dev);
      assert.equal(savedParentAfter.ino, admittedParentIdentity.ino);
      if (variant === "present") {
        assert.deepEqual(
          readFileSync(path.join(savedParent, path.basename(filePath))),
          admittedBytes,
        );
      } else {
        assert.equal(
          existsSync(path.join(savedParent, path.basename(filePath))),
          false,
        );
      }
    });
  }
});

test("authority publication never mistakes a same-content foreign destination for recovery", () => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
  const filePath = path.join(paths.controlRoot, "foreign-destination.json");
  const predecessorBytes = Buffer.from('{"generation":"predecessor"}\n');
  const proposedBytes = Buffer.from('{"generation":"proposed"}\n');
  const preservedPath = path.join(stateRoot, "foreign-destination.saved");
  writeFileSync(filePath, predecessorBytes, { mode: 0o600 });
  const predecessor = readAutomationAuthorityFileSnapshot(filePath, {
    privateRoot: paths.controlRoot,
    label: "Foreign destination fixture",
  });

  renameSync(filePath, preservedPath);
  writeFileSync(filePath, proposedBytes, { mode: 0o600 });
  const foreignIdentity = lstatSync(filePath, { bigint: true });

  assert.throws(
    () =>
      writeAutomationAuthorityFile({
        filePath,
        bytes: proposedBytes,
        previousSnapshot: predecessor,
        operationId: nextLeaseOperationId("foreign-destination"),
        privateRoot: paths.controlRoot,
        label: "Foreign destination fixture",
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "authority_generation_conflict",
  );
  assert.deepEqual(readFileSync(filePath), proposedBytes);
  assert.deepEqual(readFileSync(preservedPath), predecessorBytes);
  const survivingIdentity = lstatSync(filePath, { bigint: true });
  assert.equal(survivingIdentity.dev, foreignIdentity.dev);
  assert.equal(survivingIdentity.ino, foreignIdentity.ino);
});

test("post-exchange retry rejects a same-content foreign canonical generation", async (t) => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
  const filePath = path.join(paths.controlRoot, "foreign-successor.json");
  const predecessorBytes = Buffer.from('{"generation":"predecessor"}\n');
  const proposedBytes = Buffer.from('{"generation":"successor"}\n');
  const preservedSuccessorPath = path.join(
    stateRoot,
    "foreign-successor.saved",
  );
  const operationId = nextLeaseOperationId("foreign-successor");
  writeFileSync(filePath, predecessorBytes, { mode: 0o600 });
  const predecessor = readAutomationAuthorityFileSnapshot(filePath, {
    privateRoot: paths.controlRoot,
    label: "Foreign successor fixture",
  });
  const controlModuleUrl = new URL(
    "./lib/automation-control.mjs",
    import.meta.url,
  ).href;
  const checkpoint = "after-authority-exchange-syscall-before-sync";
  const childSource = `
    import {
      readAutomationAuthorityFileSnapshot,
      writeAutomationAuthorityFile,
    } from ${JSON.stringify(controlModuleUrl)};
    const filePath = ${JSON.stringify(filePath)};
    const privateRoot = ${JSON.stringify(paths.controlRoot)};
    const proposedBytes = Buffer.from(${JSON.stringify(proposedBytes.toString("base64"))}, "base64");
    const previousSnapshot = readAutomationAuthorityFileSnapshot(filePath, {
      privateRoot,
      label: "Foreign successor fixture",
    });
    try {
      writeAutomationAuthorityFile({
        filePath,
        bytes: proposedBytes,
        previousSnapshot,
        operationId: ${JSON.stringify(operationId)},
        privateRoot,
        label: "Foreign successor fixture",
        helperTestPause: {
          checkpoint: ${JSON.stringify(checkpoint)},
          operation: "authority-exchange",
          releaseDescriptor: 3,
          signalDescriptor: 4,
        },
      });
      console.error("AUTHORITY_UNEXPECTED_SUCCESS");
      process.exit(22);
    } catch (error) {
      console.error("AUTHORITY_ERROR_CODE:" + String(error?.code ?? "unknown"));
      process.exit(23);
    }
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", childSource],
    {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  let childError = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    childError += chunk;
  });
  const childResult = waitForChild(child);
  await waitForAuthorityHelperPause(child, checkpoint);

  const stagePrefix = `.${path.basename(filePath)}.authority.`;
  const provisionalStageName = authorityStageNameForTest({
    filePath,
    proposedBytes,
    operationId,
    previousSnapshot: predecessor,
  });
  const namespaceDigest = provisionalStageName.slice(
    stagePrefix.length,
    -".staging".length,
  );
  const successorStableDigest =
    automationAuthorityStableGenerationDigestForTest(filePath);
  const proofEntries = readdirSync(paths.controlRoot).filter(
    (name) =>
      name.startsWith(stagePrefix) &&
      /^[0-9a-f]{64}\.[0-9a-f]{64}\.tmp$/.test(name.slice(stagePrefix.length)),
  );
  assert.deepEqual(proofEntries, [
    `${stagePrefix}${namespaceDigest}.${successorStableDigest}.tmp`,
  ]);
  const proofPath = path.join(paths.controlRoot, proofEntries[0]);
  const proofBefore = readFileSync(proofPath);
  assert.deepEqual(proofBefore, predecessorBytes);

  renameSync(filePath, preservedSuccessorPath);
  writeFileSync(filePath, proposedBytes, { mode: 0o600 });
  const foreignIdentity = lstatSync(filePath, { bigint: true });
  const preservedSuccessorIdentity = lstatSync(preservedSuccessorPath, {
    bigint: true,
  });
  assert.notEqual(foreignIdentity.ino, preservedSuccessorIdentity.ino);
  child.stdio[3].end("1");
  const result = await childResult;
  assert.equal(result.signal, null, childError);
  assert.equal(result.code, 23, childError);
  assert.match(
    childError,
    /AUTHORITY_ERROR_CODE:(authority_generation_conflict|lease_transaction_conflict)/,
  );

  assert.throws(
    () =>
      writeAutomationAuthorityFile({
        filePath,
        bytes: proposedBytes,
        previousSnapshot: predecessor,
        operationId,
        privateRoot: paths.controlRoot,
        label: "Foreign successor fixture",
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "authority_generation_conflict",
  );
  const foreignAfter = lstatSync(filePath, { bigint: true });
  assert.equal(foreignAfter.dev, foreignIdentity.dev);
  assert.equal(foreignAfter.ino, foreignIdentity.ino);
  assert.deepEqual(readFileSync(filePath), proposedBytes);
  assert.deepEqual(readFileSync(preservedSuccessorPath), proposedBytes);
  assert.deepEqual(readFileSync(proofPath), proofBefore);
});

test("create-only cross-process retry fails closed after consuming its inode witness", async (t) => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
  const filePath = path.join(
    paths.controlRoot,
    "create-only-response-loss.json",
  );
  const proposedBytes = Buffer.from('{"generation":"created"}\n');
  const operationId = nextLeaseOperationId("create-only-response-loss");
  const missing = readAutomationAuthorityFileSnapshot(filePath, {
    allowMissing: true,
    privateRoot: paths.controlRoot,
    label: "Create-only response-loss fixture",
  });
  assert.equal(missing.missing, true);
  const controlModuleUrl = new URL(
    "./lib/automation-control.mjs",
    import.meta.url,
  ).href;
  const checkpoint = "after-authority-retire-syscall-before-sync";
  const childSource = `
    import {
      readAutomationAuthorityFileSnapshot,
      writeAutomationAuthorityFile,
    } from ${JSON.stringify(controlModuleUrl)};
    const filePath = ${JSON.stringify(filePath)};
    const privateRoot = ${JSON.stringify(paths.controlRoot)};
    const bytes = Buffer.from(${JSON.stringify(proposedBytes.toString("base64"))}, "base64");
    const previousSnapshot = readAutomationAuthorityFileSnapshot(filePath, {
      allowMissing: true,
      privateRoot,
      label: "Create-only response-loss fixture",
    });
    writeAutomationAuthorityFile({
      filePath,
      bytes,
      previousSnapshot,
      operationId: ${JSON.stringify(operationId)},
      privateRoot,
      label: "Create-only response-loss fixture",
      helperTestPause: {
        checkpoint: ${JSON.stringify(checkpoint)},
        operation: "authority-retire",
        destination: ${JSON.stringify(path.basename(filePath))},
        releaseDescriptor: 3,
        signalDescriptor: 4,
      },
    });
    process.exit(22);
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", childSource],
    {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  let childError = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    childError += chunk;
  });
  const childResult = waitForChild(child);
  await waitForAuthorityHelperPause(child, checkpoint);
  assert.deepEqual(readFileSync(filePath), proposedBytes);
  const publishedIdentity = lstatSync(filePath, { bigint: true });
  const helperExit = waitForAuthorityHelperExit(child);
  child.kill("SIGKILL");
  child.stdio[3].end();
  const result = await childResult;
  await helperExit;
  assert.equal(result.signal, "SIGKILL", childError);

  assert.throws(
    () =>
      writeAutomationAuthorityFile({
        filePath,
        bytes: proposedBytes,
        previousSnapshot: missing,
        operationId,
        privateRoot: paths.controlRoot,
        label: "Create-only response-loss fixture",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "authority_generation_conflict",
  );
  const publishedAfter = lstatSync(filePath, { bigint: true });
  assert.equal(publishedAfter.dev, publishedIdentity.dev);
  assert.equal(publishedAfter.ino, publishedIdentity.ino);
  assert.deepEqual(readFileSync(filePath), proposedBytes);
  assert.deepEqual(
    readdirSync(paths.controlRoot).filter((name) =>
      name.startsWith(`.${path.basename(filePath)}.authority.`),
    ),
    [],
  );
});

function stageAuthorityTemporary({
  filePath,
  bytes,
  operationId,
  privateRoot,
  label,
}) {
  const controlModuleUrl = new URL(
    "./lib/automation-control.mjs",
    import.meta.url,
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import {
          readAutomationAuthorityFileSnapshot,
          writeAutomationAuthorityFile,
        } from ${JSON.stringify(controlModuleUrl)};
        const filePath = ${JSON.stringify(filePath)};
        const privateRoot = ${JSON.stringify(privateRoot)};
        const bytes = Buffer.from(${JSON.stringify(Buffer.from(bytes).toString("base64"))}, "base64");
        const previousSnapshot = readAutomationAuthorityFileSnapshot(filePath, {
          allowMissing: true,
          allowEmpty: true,
          privateRoot,
          label: ${JSON.stringify(label)},
        });
        writeAutomationAuthorityFile({
          filePath,
          bytes,
          previousSnapshot,
          operationId: ${JSON.stringify(operationId)},
          privateRoot,
          label: ${JSON.stringify(label)},
          beforePublish: () => process.kill(process.pid, "SIGKILL"),
        });
        process.exit(2);
      `,
    ],
    { cwd: __dirname, encoding: "utf8", timeout: 10_000 },
  );
  assert.notEqual(child.error?.code, "ETIMEDOUT");
  assert.equal(child.signal, "SIGKILL", child.stderr);
  const prefix = `.${path.basename(filePath)}.authority.`;
  const candidates = readdirSync(path.dirname(filePath)).filter((name) => {
    if (!name.startsWith(prefix) || !name.endsWith(".tmp")) return false;
    const readyIdentity = name.slice(prefix.length, -".tmp".length);
    return /^[0-9a-f]{64}\.[0-9a-f]{64}$/.test(readyIdentity);
  });
  assert.equal(candidates.length, 1, `${label} must leave one operation temp`);
  return path.join(path.dirname(filePath), candidates[0]);
}

function authorityStageNameForTest({
  filePath,
  proposedBytes,
  operationId,
  previousSnapshot,
}) {
  const previous = previousSnapshot.missing
    ? { missing: true }
    : {
        missing: false,
        dev: String(previousSnapshot.identity.dev),
        ino: String(previousSnapshot.identity.ino),
        mode: Number(previousSnapshot.identity.mode),
        nlink: Number(previousSnapshot.identity.nlink),
        uid: Number(previousSnapshot.identity.uid),
        gid: Number(previousSnapshot.identity.gid),
        size: Number(previousSnapshot.identity.size),
        mtimeNs: String(previousSnapshot.identity.mtimeNs),
        ctimeNs: String(previousSnapshot.identity.ctimeNs),
        digest: createHash("sha256")
          .update(previousSnapshot.bytes)
          .digest("hex"),
      };
  const namespaceDigest = createHash("sha256")
    .update(
      JSON.stringify(
        canonicalTestValue({
          purpose: "automation-authority-file-publication-v3",
          filePath: path.resolve(filePath),
          operationId,
          proposedDigest: createHash("sha256")
            .update(proposedBytes)
            .digest("hex"),
          previous,
          parent: previousSnapshot.directoryIdentity,
        }),
      ),
    )
    .digest("hex");
  return `.${path.basename(filePath)}.authority.${namespaceDigest}.staging`;
}

function waitForAuthorityHelperPause(child, checkpoint) {
  return new Promise((resolve, reject) => {
    let signal = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${checkpoint}`));
    }, 10_000);
    const onData = (chunk) => {
      signal += String(chunk);
      if (!signal.includes(`${checkpoint}\n`)) return;
      clearTimeout(timeout);
      child.removeListener("exit", onExit);
      resolve();
    };
    const onExit = (code, exitSignal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Authority writer exited before ${checkpoint}: code=${code}, signal=${exitSignal}`,
        ),
      );
    };
    child.stdio[4].on("data", onData);
    child.once("exit", onExit);
  });
}

function waitForAuthorityHelperExit(child) {
  const signalStream = child.stdio[4];
  if (signalStream.destroyed || signalStream.readableEnded) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the authority helper to exit"));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timeout);
      signalStream.removeListener("end", finish);
      signalStream.removeListener("close", finish);
      signalStream.removeListener("error", fail);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    signalStream.once("end", finish);
    signalStream.once("close", finish);
    signalStream.once("error", fail);
  });
}

test("a ready control-event stage blocks a later lease before mutation", () => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
  const nowMs = Date.now();
  const predecessorEvent = {
    schemaVersion: 1,
    eventId: "ready-stage-predecessor-event",
    type: "authority_stage_probe",
    ts: new Date(nowMs).toISOString(),
    actor: "freed-stability-controller",
    data: {},
  };
  const stagedEvent = {
    ...predecessorEvent,
    eventId: "ready-stage-unpublished-event",
    ts: new Date(nowMs + 1).toISOString(),
  };
  const predecessorBytes = Buffer.from(`${JSON.stringify(predecessorEvent)}\n`);
  const proposedBytes = Buffer.concat([
    predecessorBytes,
    Buffer.from(`${JSON.stringify(stagedEvent)}\n`),
  ]);
  writeFileSync(paths.events, predecessorBytes, { mode: 0o600 });
  const readyStagePath = stageAuthorityTemporary({
    filePath: paths.events,
    bytes: proposedBytes,
    operationId: `control-event:${stagedEvent.eventId}`,
    privateRoot: paths.controlRoot,
    label: "Control event history",
  });

  const actor = "freed-runtime-observer";
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const before = {
    credential: snapshotFilesystemEntry(paths.actorCredentials),
    leases: snapshotFilesystemEntry(paths.leases),
    events: snapshotFilesystemEntry(paths.events),
    readyStage: snapshotFilesystemEntry(readyStagePath),
  };
  const checkpoints = [];

  assert.throws(
    () =>
      acquireLeaseLive({
        stateRoot,
        name: policy.leaseName,
        owner: actor,
        operationId: nextLeaseOperationId("ready-stage-blocks-lease"),
        ttlMs: policy.maxLeaseLifetimeMs,
        token: `ready-stage-blocks-lease-${"x".repeat(40)}`,
        actorCredentialToken,
        checkpoint: (phase) => checkpoints.push(phase),
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "authority_generation_conflict",
  );
  assert.deepEqual(checkpoints, []);
  assert.deepEqual(
    {
      credential: snapshotFilesystemEntry(paths.actorCredentials),
      leases: snapshotFilesystemEntry(paths.leases),
      events: snapshotFilesystemEntry(paths.events),
      readyStage: snapshotFilesystemEntry(readyStagePath),
    },
    before,
  );
});

test("a foreign pending event stage cannot publish an exact current-operation pre-WAL temporary", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const operationId = nextLeaseOperationId("foreign-stage-pre-wal");
  const token = `foreign-stage-pre-wal-${"x".repeat(40)}`;
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const options = {
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    operationId,
    ttlMs: policy.maxLeaseLifetimeMs,
    token,
    actorCredentialToken,
  };
  runLeaseMutationProcessLoss({
    exportName: "acquireLease",
    options,
    phase: "lease-atomic-temporary-synced",
    kind: "WAL",
  });

  const paths = automationControlPaths(stateRoot);
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    policy.leaseName,
    "acquire",
    operationId,
  );
  assert.equal(existsSync(transactionPaths.active), false);
  const transactionDirectory = path.dirname(transactionPaths.active);
  const walTemporaryEntries = readdirSync(transactionDirectory).filter(
    (entry) =>
      entry.startsWith(".lease-atomic.") &&
      entry.includes(`.${operationId}.`) &&
      entry.endsWith(".tmp"),
  );
  assert.equal(walTemporaryEntries.length, 1);
  const walTemporaryPath = path.join(
    transactionDirectory,
    walTemporaryEntries[0],
  );
  const foreignEvent = {
    schemaVersion: 1,
    eventId: "foreign-pre-wal-pending-event",
    type: "authority_stage_probe",
    ts: new Date().toISOString(),
    actor: "freed-stability-controller",
    data: {},
  };
  const eventStagePath = stageAuthorityTemporary({
    filePath: paths.events,
    bytes: Buffer.from(`${JSON.stringify(foreignEvent)}\n`),
    operationId: `control-event:${foreignEvent.eventId}`,
    privateRoot: paths.controlRoot,
    label: "Control event history",
  });
  const credentialPath = path.join(paths.actorCredentials, `${actor}.json`);
  const leaseStatePath = path.join(paths.leases, `${policy.leaseName}.lease`);
  const before = {
    walTemporary: snapshotFilesystemEntry(walTemporaryPath),
    credential: snapshotFilesystemEntry(credentialPath),
    leaseState: snapshotFilesystemEntry(leaseStatePath),
    leaseAuthority: snapshotFilesystemEntry(paths.leases),
    canonicalEvents: snapshotFilesystemEntry(paths.events),
    eventStage: snapshotFilesystemEntry(eventStagePath),
    canonicalWal: snapshotFilesystemEntry(transactionPaths.active),
  };
  const checkpoints = [];

  assert.throws(
    () =>
      acquireLeaseLive({
        ...options,
        checkpoint: (phase) => checkpoints.push(phase),
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "authority_generation_conflict",
  );
  assert.deepEqual(checkpoints, []);
  assert.deepEqual(
    {
      walTemporary: snapshotFilesystemEntry(walTemporaryPath),
      credential: snapshotFilesystemEntry(credentialPath),
      leaseState: snapshotFilesystemEntry(leaseStatePath),
      leaseAuthority: snapshotFilesystemEntry(paths.leases),
      canonicalEvents: snapshotFilesystemEntry(paths.events),
      eventStage: snapshotFilesystemEntry(eventStagePath),
      canonicalWal: snapshotFilesystemEntry(transactionPaths.active),
    },
    before,
  );
});

test("a foreign pending event stage preserves one-use capability paths before pre-WAL recovery", () => {
  const stateRoot = temporaryStateRoot();
  const operationId = nextLeaseOperationId("foreign-stage-one-use-pre-wal");
  const token = `foreign-stage-one-use-pre-wal-${"x".repeat(40)}`;
  const scope = {
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: realpathSync(stateRoot),
    branch: "fix/foreign-stage-one-use-pre-wal",
    base: "dev",
    baseSha: "f".repeat(40),
    headSha: null,
    publishMode: "feature-pr",
  };
  const capability = writePublisherCapability(stateRoot, scope, {
    leaseOperationId: operationId,
    token,
  });
  const options = {
    stateRoot,
    name: "pr-publisher",
    owner: "freed-pr-publisher",
    operationId,
    ttlMs: 30 * 60_000,
    token,
    publisherCapabilityFile: capability.capabilityPath,
    scope,
  };
  runLeaseMutationProcessLoss({
    exportName: "acquireLease",
    options,
    phase: "lease-atomic-temporary-synced",
    kind: "WAL",
  });

  const paths = automationControlPaths(stateRoot);
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    "pr-publisher",
    "acquire",
    operationId,
  );
  assert.equal(existsSync(transactionPaths.active), false);
  const transactionDirectory = path.dirname(transactionPaths.active);
  const walTemporaryEntries = readdirSync(transactionDirectory).filter(
    (entry) =>
      entry.startsWith(".lease-atomic.") &&
      entry.includes(`.${operationId}.`) &&
      entry.endsWith(".tmp"),
  );
  assert.equal(walTemporaryEntries.length, 1);
  const walTemporaryPath = path.join(
    transactionDirectory,
    walTemporaryEntries[0],
  );
  const foreignEvent = {
    schemaVersion: 1,
    eventId: "foreign-one-use-pre-wal-pending-event",
    type: "authority_stage_probe",
    ts: new Date().toISOString(),
    actor: "freed-stability-controller",
    data: {},
  };
  const eventStagePath = stageAuthorityTemporary({
    filePath: paths.events,
    bytes: Buffer.from(`${JSON.stringify(foreignEvent)}\n`),
    operationId: `control-event:${foreignEvent.eventId}`,
    privateRoot: paths.controlRoot,
    label: "Control event history",
  });
  const consumedPath = path.join(
    paths.publisherCapabilitiesConsumed,
    `${capability.capabilityId}.json`,
  );
  const leaseStatePath = path.join(paths.leases, "pr-publisher.lease");
  const before = {
    walTemporary: snapshotFilesystemEntry(walTemporaryPath),
    capabilitySource: snapshotFilesystemEntry(capability.capabilityPath),
    capabilityConsumed: snapshotFilesystemEntry(consumedPath),
    capabilityPendingDirectory: snapshotFilesystemEntry(
      paths.publisherCapabilitiesPending,
    ),
    capabilityConsumedDirectory: snapshotFilesystemEntry(
      paths.publisherCapabilitiesConsumed,
    ),
    leaseState: snapshotFilesystemEntry(leaseStatePath),
    leaseAuthority: snapshotFilesystemEntry(paths.leases),
    canonicalEvents: snapshotFilesystemEntry(paths.events),
    eventStage: snapshotFilesystemEntry(eventStagePath),
    canonicalWal: snapshotFilesystemEntry(transactionPaths.active),
  };
  assert.equal(before.capabilitySource?.type, "file");
  assert.equal(before.capabilityConsumed, null);
  const checkpoints = [];

  assert.throws(
    () =>
      acquireLeaseLive({
        ...options,
        checkpoint: (phase) => checkpoints.push(phase),
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "authority_generation_conflict",
  );
  assert.deepEqual(checkpoints, []);
  assert.deepEqual(
    {
      walTemporary: snapshotFilesystemEntry(walTemporaryPath),
      capabilitySource: snapshotFilesystemEntry(capability.capabilityPath),
      capabilityConsumed: snapshotFilesystemEntry(consumedPath),
      capabilityPendingDirectory: snapshotFilesystemEntry(
        paths.publisherCapabilitiesPending,
      ),
      capabilityConsumedDirectory: snapshotFilesystemEntry(
        paths.publisherCapabilitiesConsumed,
      ),
      leaseState: snapshotFilesystemEntry(leaseStatePath),
      leaseAuthority: snapshotFilesystemEntry(paths.leases),
      canonicalEvents: snapshotFilesystemEntry(paths.events),
      eventStage: snapshotFilesystemEntry(eventStagePath),
      canonicalWal: snapshotFilesystemEntry(transactionPaths.active),
    },
    before,
  );
});

test("a prepared lease cannot adopt its predicted partial event stage before credential consumption", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const operationId = nextLeaseOperationId("prepared-partial-event-stage");
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const paths = automationControlPaths(stateRoot);
  const transactionPaths = leaseTransactionPaths(
    stateRoot,
    policy.leaseName,
    "acquire",
    operationId,
  );
  const credentialPath = path.join(paths.actorCredentials, `${actor}.json`);
  const leaseStatePath = path.join(paths.leases, `${policy.leaseName}.lease`);
  const checkpoints = [];
  let provisionalPath;
  let preparedBefore;

  assert.throws(
    () =>
      acquireLeaseLive({
        stateRoot,
        name: policy.leaseName,
        owner: actor,
        operationId,
        ttlMs: policy.maxLeaseLifetimeMs,
        token: `prepared-partial-event-stage-${"x".repeat(40)}`,
        actorCredentialToken,
        checkpoint: (phase) => {
          checkpoints.push(phase);
          if (phase !== "lease-prepared") return;
          const transaction = JSON.parse(
            readFileSync(transactionPaths.active, "utf8"),
          );
          assert.equal(transaction.phase, "prepared");
          const predecessor = readAutomationAuthorityFileSnapshot(
            paths.events,
            {
              allowMissing: true,
              allowEmpty: true,
              privateRoot: paths.controlRoot,
              label: "Control event history",
            },
          );
          const proposedBytes = Buffer.concat([
            predecessor.bytes,
            Buffer.from(`${JSON.stringify(transaction.event)}\n`),
          ]);
          provisionalPath = path.join(
            paths.controlRoot,
            authorityStageNameForTest({
              filePath: paths.events,
              proposedBytes,
              operationId: `control-event:${transaction.event.eventId}`,
              previousSnapshot: predecessor,
            }),
          );
          writeFileSync(
            provisionalPath,
            proposedBytes.subarray(0, Math.max(1, proposedBytes.length - 23)),
            { mode: 0o600 },
          );
          preparedBefore = {
            transaction: snapshotFilesystemEntry(transactionPaths.active),
            credential: snapshotFilesystemEntry(credentialPath),
            leaseState: snapshotFilesystemEntry(leaseStatePath),
            leaseAuthority: snapshotFilesystemEntry(paths.leases),
            canonicalEvents: snapshotFilesystemEntry(paths.events),
            eventStage: snapshotFilesystemEntry(provisionalPath),
          };
        },
      }),
    (error) =>
      isAutomationControlError(error) &&
      error.code === "authority_generation_conflict",
  );
  assert.ok(preparedBefore);
  assert.equal(checkpoints.at(-1), "lease-prepared");
  assert.equal(checkpoints.includes("lease-credential-committed"), false);
  assert.deepEqual(
    {
      transaction: snapshotFilesystemEntry(transactionPaths.active),
      credential: snapshotFilesystemEntry(credentialPath),
      leaseState: snapshotFilesystemEntry(leaseStatePath),
      leaseAuthority: snapshotFilesystemEntry(paths.leases),
      canonicalEvents: snapshotFilesystemEntry(paths.events),
      eventStage: snapshotFilesystemEntry(provisionalPath),
    },
    preparedBefore,
  );
});

test("a forged settled control-event stage is rejected before the next append", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const paths = automationControlPaths(stateRoot);
  const firstEvent = appendControlEvent({
    stateRoot,
    type: "authority_stage_probe",
    actor: controller.actor,
    leaseName: controller.leaseName,
    leaseToken: controller.leaseToken,
    eventId: "settled-event-stage-first",
    data: { generation: "first" },
  });
  assert.equal(firstEvent.eventId, "settled-event-stage-first");

  const stagePrefix = `.${path.basename(paths.events)}.authority.`;
  const readyEntries = readdirSync(paths.controlRoot).filter(
    (entry) =>
      entry.startsWith(stagePrefix) &&
      /^[0-9a-f]{64}\.[0-9a-f]{64}\.tmp$/.test(entry.slice(stagePrefix.length)),
  );
  assert.equal(readyEntries.length, 1);
  const readyStagePath = path.join(paths.controlRoot, readyEntries[0]);
  const forgedBytes = Buffer.from('{"forged":"settled-event-stage"}\n');
  writeFileSync(readyStagePath, forgedBytes, { mode: 0o600 });
  const before = {
    events: snapshotFilesystemEntry(paths.events),
    readyStage: snapshotFilesystemEntry(readyStagePath),
  };

  assert.throws(
    () =>
      appendControlEvent({
        stateRoot,
        type: "authority_stage_probe",
        actor: controller.actor,
        leaseName: controller.leaseName,
        leaseToken: controller.leaseToken,
        eventId: "settled-event-stage-second",
        data: { generation: "second" },
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "authority_generation_conflict",
  );
  assert.deepEqual(
    {
      events: snapshotFilesystemEntry(paths.events),
      readyStage: snapshotFilesystemEntry(readyStagePath),
    },
    before,
  );
});

test("a forged settled task-manifest stage is rejected before the next task mutation", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const paths = automationControlPaths(stateRoot);
  const createFixtureTask = (taskId) =>
    createTask({
      stateRoot,
      taskId,
      ...controller,
      observerAuthority: "plan-only",
      providerAuthority: "forbidden",
      details: { behavioral: false },
    });
  createFixtureTask("settled-manifest-stage-first");
  createFixtureTask("settled-manifest-stage-second");

  const stagePrefix = `.${path.basename(paths.taskManifest)}.authority.`;
  const readyEntries = readdirSync(paths.controlRoot).filter(
    (entry) =>
      entry.startsWith(stagePrefix) &&
      /^[0-9a-f]{64}\.[0-9a-f]{64}\.tmp$/.test(entry.slice(stagePrefix.length)),
  );
  assert.equal(readyEntries.length, 1);
  const readyStagePath = path.join(paths.controlRoot, readyEntries[0]);
  const forgedBytes = Buffer.from('{"forged":"settled-manifest-stage"}\n');
  writeFileSync(readyStagePath, forgedBytes, { mode: 0o600 });
  const before = {
    authority: snapshotTaskMutationState(stateRoot),
    readyStage: snapshotFilesystemEntry(readyStagePath),
  };

  assert.throws(
    () => createFixtureTask("settled-manifest-stage-third"),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "authority_generation_conflict",
  );
  assert.deepEqual(
    {
      authority: snapshotTaskMutationState(stateRoot),
      readyStage: snapshotFilesystemEntry(readyStagePath),
    },
    before,
  );
});

test("same-operation lease recovery rewrites its partial provisional event stage", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-release-verifier";
  const authentication = actorLease(stateRoot, actor);
  const operationId = nextLeaseOperationId("partial-provisional-lease-event");
  const options = {
    stateRoot,
    name: authentication.leaseName,
    operationId,
    token: authentication.leaseToken,
    ttlMs: AUTOMATION_ACTOR_POLICIES[actor].maxLeaseLifetimeMs,
  };
  runLeaseMutationProcessLoss({
    exportName: "heartbeatLease",
    options,
    phase: "lease-state-committed",
  });

  const paths = automationControlPaths(stateRoot);
  const transactionPath = leaseTransactionPaths(
    stateRoot,
    authentication.leaseName,
    "heartbeat",
    operationId,
  ).active;
  const transaction = JSON.parse(readFileSync(transactionPath, "utf8"));
  assert.equal(transaction.phase, "state-committed");
  const predecessor = readAutomationAuthorityFileSnapshot(paths.events, {
    privateRoot: paths.controlRoot,
    label: "Control event history",
  });
  const proposedBytes = Buffer.concat([
    predecessor.bytes,
    Buffer.from(`${JSON.stringify(transaction.event)}\n`),
  ]);
  const provisionalName = authorityStageNameForTest({
    filePath: paths.events,
    proposedBytes,
    operationId: `control-event:${transaction.event.eventId}`,
    previousSnapshot: predecessor,
  });
  const provisionalPath = path.join(paths.controlRoot, provisionalName);
  writeFileSync(
    provisionalPath,
    proposedBytes.subarray(0, Math.max(1, proposedBytes.length - 17)),
    { mode: 0o600 },
  );

  const recovered = heartbeatLeaseLive(options);
  assert.equal(recovered.recovered, true);
  assert.equal(
    readEvents(stateRoot).filter(
      (event) => event.eventId === transaction.event.eventId,
    ).length,
    1,
  );
  assert.equal(existsSync(transactionPath), false);
  assert.equal(existsSync(provisionalPath), false);
});

test("same-operation task recovery rewrites its partial provisional manifest stage", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  const taskId = "partial-provisional-manifest-task";
  createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nowMs + 1,
  });

  const paths = automationControlPaths(stateRoot);
  const current = readTaskManifest({ stateRoot });
  const targetManifest = structuredClone(current);
  const targetTask = targetManifest.tasks.find(
    (candidate) => candidate.taskId === taskId,
  );
  const transitionAt = new Date(nowMs + 2).toISOString();
  targetTask.state = "triaged";
  targetTask.revision += 1;
  targetTask.updatedAt = transitionAt;
  targetManifest.revision += 1;
  targetManifest.updatedAt = transitionAt;
  const leaseRecord = JSON.parse(
    readFileSync(
      path.join(paths.leases, `${controller.leaseName}.lease`, "lease.json"),
      "utf8",
    ),
  );
  const event = {
    schemaVersion: 1,
    eventId: "10000000-2000-4000-8000-000000000003",
    type: "task_transitioned",
    ts: transitionAt,
    actor: controller.actor,
    taskId,
    taskRevision: targetTask.revision,
    manifestRevision: targetManifest.revision,
    observerAuthority: targetTask.observerAuthority,
    providerAuthority: targetTask.providerAuthority,
      data: {
        fromState: "observed",
        toState: "triaged",
        authorizationProvenance: {
          leaseName: leaseRecord.name,
          leaseAcquiredAt: leaseRecord.acquiredAt,
          credentialKind: leaseRecord.credentialKind,
          launcherSha256: leaseRecord.launcherSha256,
          actorRuntimeDigest: leaseRecord.actorRuntimeDigest,
          launcherChannelProtocol: leaseRecord.launcherChannelProtocol,
          launcherAttestationSha256:
            leaseRecord.launcherAttestationSha256,
          launcherSessionId: leaseRecord.launcherSessionId,
        },
      },
    };
    const transaction = {
      schemaVersion: 1,
      transactionId: "10000000-2000-4000-8000-000000000004",
    preparedAt: transitionAt,
    previousManifestRevision: current.revision,
    targetManifest,
    event,
  };
  mkdirSync(paths.taskTransactions, { recursive: true, mode: 0o700 });
  const transactionPath = path.join(
    paths.taskTransactions,
    `${String(targetManifest.revision).padStart(12, "0")}-${transaction.transactionId}.json`,
  );
  writeFileSync(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`, {
    mode: 0o600,
  });
  const predecessor = readAutomationAuthorityFileSnapshot(paths.taskManifest, {
    privateRoot: paths.controlRoot,
    label: "Current task manifest",
  });
  const proposedBytes = Buffer.from(
    `${JSON.stringify(targetManifest, null, 2)}\n`,
  );
  const provisionalName = authorityStageNameForTest({
    filePath: paths.taskManifest,
    proposedBytes,
    operationId: `task-manifest:${transaction.transactionId}`,
    previousSnapshot: predecessor,
  });
  const provisionalPath = path.join(paths.controlRoot, provisionalName);
  writeFileSync(
    provisionalPath,
    proposedBytes.subarray(0, Math.max(1, proposedBytes.length - 19)),
    { mode: 0o600 },
  );

  const recovered = readTaskManifest({ stateRoot });
  assert.equal(recovered.revision, targetManifest.revision);
  assert.equal(recovered.tasks[0].state, "triaged");
  assert.equal(
    readEvents(stateRoot).filter(
      (candidate) => candidate.eventId === event.eventId,
    ).length,
    1,
  );
  assert.equal(existsSync(transactionPath), false);
  assert.equal(existsSync(provisionalPath), false);
});

test("authority stage retries preserve a foreign final-window generation", async (t) => {
  for (const variant of ["create", "rewrite"]) {
    await t.test(variant, async (subtest) => {
      const stateRoot = temporaryStateRoot();
      const paths = automationControlPaths(stateRoot);
      mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
      const filePath = path.join(
        paths.controlRoot,
        `stage-final-window-${variant}.json`,
      );
      const predecessorBytes = Buffer.from(
        `${JSON.stringify({ generation: `before-${variant}` })}\n`,
      );
      const proposedBytes = Buffer.from(
        `${JSON.stringify({ generation: `after-${variant}` })}\n`,
      );
      const foreignBytes = Buffer.from(
        `${JSON.stringify({ generation: `foreign-${variant}` })}\n`,
      );
      const operationId = nextLeaseOperationId(`stage-final-window-${variant}`);
      writeFileSync(filePath, predecessorBytes, { mode: 0o600 });
      const predecessor = readAutomationAuthorityFileSnapshot(filePath, {
        privateRoot: paths.controlRoot,
        label: `Stage final-window ${variant} fixture`,
      });
      const stageName = authorityStageNameForTest({
        filePath,
        proposedBytes,
        operationId,
        previousSnapshot: predecessor,
      });
      const stagePath = path.join(paths.controlRoot, stageName);
      const displacedStagePath = path.join(
        stateRoot,
        `stage-final-window-${variant}.admitted`,
      );
      if (variant === "rewrite") {
        writeFileSync(
          stagePath,
          proposedBytes.subarray(0, proposedBytes.length - 3),
          { mode: 0o600 },
        );
      }
      const checkpoint =
        variant === "create"
          ? "after-authority-stage-create-final-validation-before-syscall"
          : "after-authority-stage-rewrite-final-validation-before-truncate";
      const operation =
        variant === "create"
          ? "authority-stage-create"
          : "authority-stage-rewrite";
      const controlModuleUrl = new URL(
        "./lib/automation-control.mjs",
        import.meta.url,
      ).href;
      const childSource = `
        import {
          readAutomationAuthorityFileSnapshot,
          writeAutomationAuthorityFile,
        } from ${JSON.stringify(controlModuleUrl)};
        const filePath = ${JSON.stringify(filePath)};
        const privateRoot = ${JSON.stringify(paths.controlRoot)};
        const bytes = Buffer.from(${JSON.stringify(proposedBytes.toString("base64"))}, "base64");
        const previousSnapshot = readAutomationAuthorityFileSnapshot(filePath, {
          privateRoot,
          label: ${JSON.stringify(`Stage final-window ${variant} fixture`)},
        });
        try {
          writeAutomationAuthorityFile({
            filePath,
            bytes,
            previousSnapshot,
            operationId: ${JSON.stringify(operationId)},
            privateRoot,
            label: ${JSON.stringify(`Stage final-window ${variant} fixture`)},
            helperTestPause: {
              checkpoint: ${JSON.stringify(checkpoint)},
              operation: ${JSON.stringify(operation)},
              source: ${JSON.stringify(stageName)},
              destination: ${JSON.stringify(stageName)},
              releaseDescriptor: 3,
              signalDescriptor: 4,
            },
          });
          process.exit(0);
        } catch (error) {
          console.error("AUTHORITY_ERROR_CODE:" + String(error?.code ?? "unknown"));
          process.exit(23);
        }
      `;
      const child = spawn(
        process.execPath,
        ["--input-type=module", "--eval", childSource],
        {
          cwd: __dirname,
          stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
        },
      );
      subtest.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill();
      });
      let childError = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        childError += chunk;
      });
      const childResult = waitForChild(child);
      await waitForAuthorityHelperPause(child, checkpoint);
      if (variant === "rewrite") {
        renameSync(stagePath, displacedStagePath);
      } else {
        assert.equal(existsSync(stagePath), false);
      }
      writeFileSync(stagePath, foreignBytes, { mode: 0o600 });
      const foreignIdentity = lstatSync(stagePath, { bigint: true });
      child.stdio[3].end("1");
      const result = await childResult;
      assert.equal(result.signal, null, childError);
      assert.ok(
        result.code === 0 ||
          (result.code === 23 &&
            /AUTHORITY_ERROR_CODE:(authority_generation_conflict|lease_transaction_conflict)/.test(
              childError,
            )),
        childError,
      );

      const candidatePaths = [];
      if (existsSync(stagePath)) candidatePaths.push(stagePath);
      const retirementDirectory = path.join(
        paths.controlRoot,
        ".authority-retirements",
      );
      if (existsSync(retirementDirectory)) {
        candidatePaths.push(
          ...readdirSync(retirementDirectory).map((name) =>
            path.join(retirementDirectory, name),
          ),
        );
      }
      const foreignSurvivors = candidatePaths.filter((candidatePath) => {
        const stats = lstatSync(candidatePath, { bigint: true });
        return (
          stats.isFile() &&
          stats.dev === foreignIdentity.dev &&
          stats.ino === foreignIdentity.ino
        );
      });
      assert.equal(foreignSurvivors.length, 1);
      assert.deepEqual(readFileSync(foreignSurvivors[0]), foreignBytes);
    });
  }
});

test("authority stage creation writes bounded chunks before publication", async (t) => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
  const filePath = path.join(paths.controlRoot, "stage-chunk-boundary.json");
  const proposedBytes = Buffer.allocUnsafe(65_537);
  for (let index = 0; index < proposedBytes.length; index += 1) {
    proposedBytes[index] = 0x20 + ((index * 131 + (index >>> 8)) % 95);
  }
  const operationId = nextLeaseOperationId("stage-chunk-boundary");
  const previousSnapshot = readAutomationAuthorityFileSnapshot(filePath, {
    allowMissing: true,
    privateRoot: paths.controlRoot,
    label: "Authority stage chunk boundary fixture",
  });
  assert.equal(previousSnapshot.missing, true);
  const stageName = authorityStageNameForTest({
    filePath,
    proposedBytes,
    operationId,
    previousSnapshot,
  });
  const stagePath = path.join(paths.controlRoot, stageName);
  const checkpoint = "after-authority-stage-partial-write";
  const controlModuleUrl = new URL(
    "./lib/automation-control.mjs",
    import.meta.url,
  ).href;
  const childSource = `
    import {
      readAutomationAuthorityFileSnapshot,
      writeAutomationAuthorityFile,
    } from ${JSON.stringify(controlModuleUrl)};
    const filePath = ${JSON.stringify(filePath)};
    const privateRoot = ${JSON.stringify(paths.controlRoot)};
    const bytes = Buffer.from(${JSON.stringify(proposedBytes.toString("base64"))}, "base64");
    const previousSnapshot = readAutomationAuthorityFileSnapshot(filePath, {
      allowMissing: true,
      privateRoot,
      label: "Authority stage chunk boundary fixture",
    });
    writeAutomationAuthorityFile({
      filePath,
      bytes,
      previousSnapshot,
      operationId: ${JSON.stringify(operationId)},
      privateRoot,
      label: "Authority stage chunk boundary fixture",
      helperTestPause: {
        checkpoint: ${JSON.stringify(checkpoint)},
        operation: "authority-stage-create",
        source: ${JSON.stringify(stageName)},
        destination: ${JSON.stringify(stageName)},
        releaseDescriptor: 3,
        signalDescriptor: 4,
      },
    });
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", childSource],
    {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  let childError = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    childError += chunk;
  });
  const childResult = waitForChild(child);
  await waitForAuthorityHelperPause(child, checkpoint);

  assert.equal(existsSync(filePath), false);
  const partialStats = lstatSync(stagePath);
  assert.equal(partialStats.isFile(), true);
  assert.equal(partialStats.mode & 0o7777, 0o600);
  assert.equal(partialStats.nlink, 1);
  assert.equal(partialStats.size, 65_536);
  assert.deepEqual(readFileSync(stagePath), proposedBytes.subarray(0, 65_536));

  child.stdio[3].end("1");
  const result = await childResult;
  await waitForAuthorityHelperExit(child);
  assert.equal(result.signal, null, childError);
  assert.equal(result.code, 0, childError);
  const publishedStats = lstatSync(filePath);
  assert.equal(publishedStats.isFile(), true);
  assert.equal(publishedStats.mode & 0o7777, 0o600);
  assert.equal(publishedStats.nlink, 1);
  assert.deepEqual(readFileSync(filePath), proposedBytes);
  assert.equal(
    createHash("sha256").update(readFileSync(filePath)).digest("hex"),
    createHash("sha256").update(proposedBytes).digest("hex"),
  );
  assert.deepEqual(
    readdirSync(paths.controlRoot).filter((name) =>
      name.startsWith(`.${path.basename(filePath)}.authority.`),
    ),
    [],
  );
});

test("authority temp namespace binds the full predecessor generation", () => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
  const filePath = path.join(paths.controlRoot, "predecessor-bound.json");
  const predecessorBytes = Buffer.from('{"generation":"same-bytes"}\n');
  const proposedBytes = Buffer.from('{"generation":"next"}\n');
  const preservedPath = path.join(stateRoot, "predecessor-bound.saved");
  const operationId = nextLeaseOperationId("predecessor-bound");
  writeFileSync(filePath, predecessorBytes, { mode: 0o600 });
  const firstPredecessor = readAutomationAuthorityFileSnapshot(filePath, {
    privateRoot: paths.controlRoot,
    label: "Predecessor-bound fixture",
  });
  const firstTemporaryPath = stageAuthorityTemporary({
    filePath,
    bytes: proposedBytes,
    operationId,
    privateRoot: paths.controlRoot,
    label: "Predecessor-bound fixture",
  });
  const firstTemporaryBytes = readFileSync(firstTemporaryPath);

  renameSync(filePath, preservedPath);
  writeFileSync(filePath, predecessorBytes, { mode: 0o600 });
  const secondPredecessor = readAutomationAuthorityFileSnapshot(filePath, {
    privateRoot: paths.controlRoot,
    label: "Predecessor-bound fixture",
  });
  assert.notEqual(
    secondPredecessor.identity.ino,
    firstPredecessor.identity.ino,
  );

  assert.throws(
    () =>
      writeAutomationAuthorityFile({
        filePath,
        bytes: proposedBytes,
        previousSnapshot: secondPredecessor,
        operationId,
        privateRoot: paths.controlRoot,
        label: "Predecessor-bound fixture",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "authority_generation_conflict",
  );
  assert.deepEqual(readFileSync(filePath), predecessorBytes);
  assert.deepEqual(readFileSync(preservedPath), predecessorBytes);
  assert.deepEqual(readFileSync(firstTemporaryPath), firstTemporaryBytes);
});

test("authority temp namespace binds predecessor content on the same inode", () => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
  const filePath = path.join(paths.controlRoot, "predecessor-content.json");
  const firstBytes = Buffer.from('{"generation":"first!"}\n');
  const secondBytes = Buffer.from('{"generation":"second"}\n');
  const proposedBytes = Buffer.from('{"generation":"next!!"}\n');
  assert.equal(firstBytes.length, secondBytes.length);
  const operationId = nextLeaseOperationId("predecessor-content");
  writeFileSync(filePath, firstBytes, { mode: 0o600 });
  const firstPredecessor = readAutomationAuthorityFileSnapshot(filePath, {
    privateRoot: paths.controlRoot,
    label: "Predecessor-content fixture",
  });
  const firstTemporaryPath = stageAuthorityTemporary({
    filePath,
    bytes: proposedBytes,
    operationId,
    privateRoot: paths.controlRoot,
    label: "Predecessor-content fixture",
  });
  const firstTemporaryBytes = readFileSync(firstTemporaryPath);

  writeFileSync(filePath, secondBytes, { mode: 0o600 });
  const secondPredecessor = readAutomationAuthorityFileSnapshot(filePath, {
    privateRoot: paths.controlRoot,
    label: "Predecessor-content fixture",
  });
  assert.equal(secondPredecessor.identity.ino, firstPredecessor.identity.ino);
  assert.notDeepEqual(secondPredecessor.bytes, firstPredecessor.bytes);

  assert.throws(
    () =>
      writeAutomationAuthorityFile({
        filePath,
        bytes: proposedBytes,
        previousSnapshot: secondPredecessor,
        operationId,
        privateRoot: paths.controlRoot,
        label: "Predecessor-content fixture",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "authority_generation_conflict",
  );
  assert.deepEqual(readFileSync(filePath), secondBytes);
  assert.deepEqual(readFileSync(firstTemporaryPath), firstTemporaryBytes);
});

test("empty and partial same-operation authority temps recover only while provisional", async (t) => {
  for (const variant of ["empty", "partial"]) {
    await t.test(variant, () => {
      const stateRoot = temporaryStateRoot();
      const paths = automationControlPaths(stateRoot);
      mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
      const filePath = path.join(
        paths.controlRoot,
        `same-operation-${variant}.json`,
      );
      const predecessorBytes = Buffer.from(
        `${JSON.stringify({ generation: `before-${variant}` })}\n`,
      );
      const proposedBytes = Buffer.from(
        `${JSON.stringify({ generation: `after-${variant}` })}\n`,
      );
      writeFileSync(filePath, predecessorBytes, { mode: 0o600 });
      const predecessor = readAutomationAuthorityFileSnapshot(filePath, {
        privateRoot: paths.controlRoot,
        label: `Same-operation ${variant} fixture`,
      });
      const operationId = nextLeaseOperationId(`same-operation-${variant}`);
      const temporaryPath = path.join(
        paths.controlRoot,
        authorityStageNameForTest({
          filePath,
          proposedBytes,
          operationId,
          previousSnapshot: predecessor,
        }),
      );
      const strandedBytes =
        variant === "empty"
          ? Buffer.alloc(0)
          : proposedBytes.subarray(0, Math.max(1, proposedBytes.length - 3));
      writeFileSync(temporaryPath, strandedBytes, { mode: 0o600 });

      const published = writeAutomationAuthorityFile({
        filePath,
        bytes: proposedBytes,
        previousSnapshot: predecessor,
        operationId,
        privateRoot: paths.controlRoot,
        label: `Same-operation ${variant} fixture`,
      });

      const readyPrefix = `.${path.basename(filePath)}.authority.`;
      const readyEntries = readdirSync(paths.controlRoot).filter(
        (name) =>
          name.startsWith(readyPrefix) &&
          /^[0-9a-f]{64}\.[0-9a-f]{64}\.tmp$/.test(
            name.slice(readyPrefix.length),
          ),
      );
      assert.equal(readyEntries.length, 1);

      assert.deepEqual(published.bytes, proposedBytes);
      assert.deepEqual(readFileSync(filePath), proposedBytes);
      assert.equal(existsSync(temporaryPath), false);
      assert.deepEqual(
        readFileSync(path.join(paths.controlRoot, readyEntries[0])),
        predecessorBytes,
      );
    });
  }
});

test("empty and partial ready authority witnesses fail closed unchanged", async (t) => {
  for (const variant of ["empty", "partial"]) {
    await t.test(variant, () => {
      const stateRoot = temporaryStateRoot();
      const paths = automationControlPaths(stateRoot);
      mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
      const filePath = path.join(
        paths.controlRoot,
        `ready-witness-${variant}.json`,
      );
      const predecessorBytes = Buffer.from(
        `${JSON.stringify({ generation: `before-${variant}` })}\n`,
      );
      const proposedBytes = Buffer.from(
        `${JSON.stringify({ generation: `after-${variant}` })}\n`,
      );
      writeFileSync(filePath, predecessorBytes, { mode: 0o600 });
      const predecessor = readAutomationAuthorityFileSnapshot(filePath, {
        privateRoot: paths.controlRoot,
        label: `Ready witness ${variant} fixture`,
      });
      const operationId = nextLeaseOperationId(`ready-witness-${variant}`);
      const readyPath = stageAuthorityTemporary({
        filePath,
        bytes: proposedBytes,
        operationId,
        privateRoot: paths.controlRoot,
        label: `Ready witness ${variant} fixture`,
      });
      const corruptedBytes =
        variant === "empty"
          ? Buffer.alloc(0)
          : proposedBytes.subarray(0, Math.max(1, proposedBytes.length - 3));
      writeFileSync(readyPath, corruptedBytes, { mode: 0o600 });
      const corruptedIdentity = lstatSync(readyPath, { bigint: true });

      assert.throws(
        () =>
          writeAutomationAuthorityFile({
            filePath,
            bytes: proposedBytes,
            previousSnapshot: predecessor,
            operationId,
            privateRoot: paths.controlRoot,
            label: `Ready witness ${variant} fixture`,
          }),
        (error) =>
          error instanceof AutomationControlError &&
          error.code === "authority_generation_conflict",
      );

      const corruptedAfter = lstatSync(readyPath, { bigint: true });
      assert.equal(corruptedAfter.dev, corruptedIdentity.dev);
      assert.equal(corruptedAfter.ino, corruptedIdentity.ino);
      assert.equal(corruptedAfter.mode, corruptedIdentity.mode);
      assert.equal(corruptedAfter.ctimeNs, corruptedIdentity.ctimeNs);
      assert.deepEqual(readFileSync(readyPath), corruptedBytes);
      assert.deepEqual(readFileSync(filePath), predecessorBytes);
    });
  }
});

test("random task pre-WAL authority temps are bounded and cannot wedge later mutation", async (t) => {
  for (const variant of ["complete", "partial"]) {
    await t.test(variant, () => {
      const stateRoot = temporaryStateRoot();
      const controller = actorLease(stateRoot, "freed-stability-controller");
      const taskId = `pre-wal-${variant}`;
      createTask({
        stateRoot,
        taskId,
        ...controller,
        observerAuthority: "plan-only",
        providerAuthority: "forbidden",
        details: { behavioral: false },
      });
      const paths = automationControlPaths(stateRoot);
      const creationEvent = readEvents(stateRoot).find(
        (event) => event.type === "task_created" && event.taskId === taskId,
      );
      assert.ok(creationEvent?.data?.authorizationProvenance);
      const current = readTaskManifest({ stateRoot });
      const manifestBefore = readFileSync(paths.taskManifest);
      const eventsBefore = readFileSync(paths.events);
      const retirementDirectory = path.join(
        paths.taskTransactions,
        ".authority-retirements",
      );
      const retirementEntriesBefore = new Set(readdirSync(retirementDirectory));
      const targetManifest = structuredClone(current);
      const targetTask = targetManifest.tasks.find(
        (candidate) => candidate.taskId === taskId,
      );
      const transitionAt = new Date(Date.now() + 1).toISOString();
      targetTask.state = "triaged";
      targetTask.revision += 1;
      targetTask.updatedAt = transitionAt;
      targetManifest.revision += 1;
      targetManifest.updatedAt = transitionAt;
      const transactionId =
        variant === "complete"
          ? "10000000-2000-4000-8000-000000000001"
          : "10000000-2000-4000-8000-000000000002";
      const transaction = {
        schemaVersion: 1,
        transactionId,
        preparedAt: transitionAt,
        previousManifestRevision: current.revision,
        targetManifest,
        event: {
          schemaVersion: 1,
          eventId:
            variant === "complete"
              ? "10000000-2000-4000-8000-000000000005"
              : "10000000-2000-4000-8000-000000000006",
          type: "task_transitioned",
          ts: transitionAt,
          actor: controller.actor,
          taskId,
          taskRevision: targetTask.revision,
          manifestRevision: targetManifest.revision,
          observerAuthority: targetTask.observerAuthority,
          providerAuthority: targetTask.providerAuthority,
          data: {
            fromState: "observed",
            toState: "triaged",
            authorizationProvenance: structuredClone(
              creationEvent.data.authorizationProvenance,
            ),
          },
        },
      };
      const transactionBytes = Buffer.from(
        `${JSON.stringify(transaction, null, 2)}\n`,
      );
      const transactionPath = path.join(
        paths.taskTransactions,
        `${String(targetManifest.revision).padStart(12, "0")}-${transactionId}.json`,
      );
      const missing = readAutomationAuthorityFileSnapshot(transactionPath, {
        allowMissing: true,
        privateRoot: paths.controlRoot,
        label: `Pre-WAL ${variant} task transaction`,
      });
      assert.equal(missing.missing, true);
      const temporaryPath = stageAuthorityTemporary({
        filePath: transactionPath,
        bytes: transactionBytes,
        operationId: `task-transaction:${transactionId}`,
        privateRoot: paths.controlRoot,
        label: `Pre-WAL ${variant} task transaction`,
      });
      const strandedBytes =
        variant === "complete"
          ? transactionBytes
          : transactionBytes.subarray(0, transactionBytes.length - 7);
      if (variant === "partial") {
        writeFileSync(temporaryPath, strandedBytes, { mode: 0o600 });
      }

      const recovered = readTaskManifest({ stateRoot });
      const recoveredTask = recovered.tasks.find(
        (candidate) => candidate.taskId === taskId,
      );
      if (variant === "complete") {
        assert.deepEqual(recovered, targetManifest);
        assert.deepEqual(
          readFileSync(paths.taskManifest),
          Buffer.from(`${JSON.stringify(targetManifest, null, 2)}\n`),
        );
        assert.deepEqual(
          readFileSync(paths.events),
          Buffer.concat([
            eventsBefore,
            Buffer.from(`${JSON.stringify(transaction.event)}\n`),
          ]),
        );
        assert.equal(
          readEvents(stateRoot).filter(
            (event) => event.eventId === transaction.event.eventId,
          ).length,
          1,
        );
      } else {
        assert.deepEqual(recovered, current);
        assert.equal(recoveredTask.state, "observed");
        assert.deepEqual(readFileSync(paths.taskManifest), manifestBefore);
        assert.deepEqual(readFileSync(paths.events), eventsBefore);
      }
      assert.equal(existsSync(temporaryPath), false);
      assert.equal(existsSync(transactionPath), false);
      const newRetirementEntries = readdirSync(retirementDirectory).filter(
        (name) => !retirementEntriesBefore.has(name),
      );
      assert.equal(newRetirementEntries.length, 1);
      const retiredName = newRetirementEntries[0];
      const transactionBasename = path.basename(transactionPath);
      const retiredBasename =
        variant === "complete"
          ? transactionBasename
          : "raw-task-pre-wal";
      assert.ok(retiredName.startsWith(`${retiredBasename}.`));
      assert.match(
        retiredName.slice(retiredBasename.length + 1),
        /^[0-9a-f]{64}\.[0-9a-f]{64}\.retired$/,
      );
      const retiredPath = path.join(retirementDirectory, retiredName);
      const retiredStats = lstatSync(retiredPath);
      assert.equal(retiredStats.isFile(), true);
      assert.equal(retiredStats.mode & 0o7777, 0o600);
      assert.equal(retiredStats.nlink, 1);
      assert.deepEqual(readFileSync(retiredPath), strandedBytes);

      const later = createTask({
        stateRoot,
        taskId: `after-pre-wal-${variant}`,
        ...controller,
        observerAuthority: "plan-only",
        providerAuthority: "forbidden",
        details: { behavioral: false },
      });
      assert.equal(later.task.taskId, `after-pre-wal-${variant}`);
    });
  }
});

test("completed task WALs are retired without destruction", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const taskId = "task-wal-nondestructive-retirement";
  const created = createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });
  const paths = automationControlPaths(stateRoot);
  const retirementDirectory = path.join(
    paths.taskTransactions,
    ".authority-retirements",
  );
  const activeEntries = readdirSync(paths.taskTransactions).filter((name) =>
    name.endsWith(".json"),
  );
  assert.deepEqual(activeEntries, []);
  const retirementEntries = readdirSync(retirementDirectory);
  assert.equal(retirementEntries.length, 1);
  const retiredPath = path.join(retirementDirectory, retirementEntries[0]);
  const retiredBytes = readFileSync(retiredPath);
  const retiredTransaction = JSON.parse(retiredBytes.toString("utf8"));
  const transactionBasename = `${String(created.manifestRevision).padStart(12, "0")}-${retiredTransaction.transactionId}.json`;
  assert.ok(retirementEntries[0].startsWith(`${transactionBasename}.`));
  assert.match(
    retirementEntries[0].slice(transactionBasename.length + 1),
    /^[0-9a-f]{64}\.[0-9a-f]{64}\.retired$/,
  );
  const expectedTransaction = {
    schemaVersion: 1,
    transactionId: retiredTransaction.transactionId,
    preparedAt: created.event.ts,
    previousManifestRevision: created.manifestRevision - 1,
    targetManifest: readTaskManifest({ stateRoot }),
    event: created.event,
  };
  assert.deepEqual(
    retiredBytes,
    Buffer.from(`${JSON.stringify(expectedTransaction, null, 2)}\n`),
  );
  const retiredStats = lstatSync(retiredPath);
  assert.equal(retiredStats.isFile(), true);
  assert.equal(retiredStats.mode & 0o7777, 0o600);
  assert.equal(retiredStats.nlink, 1);
});

test("generic authority publication never invokes destructive durable primitives", () => {
  const moduleSource = readFileSync(
    path.join(__dirname, "lib", "automation-control.mjs"),
    "utf8",
  );
  const closureStart = moduleSource.indexOf(
    "function parseAutomationAuthorityReceipt(",
  );
  const closureEnd = moduleSource.indexOf(
    "function readPinnedLeaseArchivePath(",
    closureStart,
  );
  assert.notEqual(closureStart, -1);
  assert.ok(closureEnd > closureStart);
  const writerClosure = moduleSource.slice(closureStart, closureEnd);
  assert.doesNotMatch(writerClosure, /replace-durable/);
  assert.doesNotMatch(writerClosure, /remove-durable/);
  for (const safeOperation of [
    "authority-stage-create",
    "authority-stage-rewrite",
    "authority-exchange",
    "authority-retire",
  ]) {
    assert.match(writerClosure, new RegExp(`"${safeOperation}"`));
  }
});

test("production task WAL cleanup preserves a swapped canonical generation", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const taskId = "task-wal-generation-cleanup";
  createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });
  const paths = automationControlPaths(stateRoot);
  const current = JSON.parse(readFileSync(paths.taskManifest, "utf8"));
  const targetManifest = structuredClone(current);
  const targetTask = targetManifest.tasks.find(
    (candidate) => candidate.taskId === taskId,
  );
  const transitionAt = new Date(Date.now() + 1).toISOString();
  targetTask.state = "triaged";
  targetTask.revision += 1;
  targetTask.updatedAt = transitionAt;
  targetManifest.revision += 1;
  targetManifest.updatedAt = transitionAt;
  const event = {
    schemaVersion: 1,
    eventId: "b9479448-0479-45d4-a4fc-e9b7d3249687",
    type: "task_transitioned",
    ts: transitionAt,
    actor: controller.actor,
    taskId,
    taskRevision: targetTask.revision,
    manifestRevision: targetManifest.revision,
    observerAuthority: targetTask.observerAuthority,
    providerAuthority: targetTask.providerAuthority,
    data: {
      authorizationProvenance: structuredClone(
        readControlEvents(stateRoot).find(
          (candidate) =>
            candidate.type === "task_created" && candidate.taskId === taskId,
        ).data.authorizationProvenance,
      ),
      fromState: "observed",
      toState: "triaged",
    },
  };
  const transaction = {
    schemaVersion: 1,
    transactionId: "task-wal-generation-cleanup",
    preparedAt: transitionAt,
    previousManifestRevision: current.revision,
    targetManifest,
    event,
  };
  mkdirSync(paths.taskTransactions, { recursive: true, mode: 0o700 });
  chmodSync(paths.taskTransactions, 0o700);
  const transactionPath = path.join(
    paths.taskTransactions,
    `${String(targetManifest.revision).padStart(12, "0")}-${transaction.transactionId}.json`,
  );
  const originalBytes = Buffer.from(
    `${JSON.stringify(transaction, null, 2)}\n`,
  );
  writeFileSync(transactionPath, originalBytes, { mode: 0o600 });
  const replacementBytes = Buffer.from('{"swapped":"task-wal"}\n');
  const savedPath = path.join(
    paths.taskTransactions,
    "task-wal-generation-cleanup.saved",
  );
  let swapped = false;

  assert.throws(
    () =>
      withMutationLeaseAuthority(
        { stateRoot, ...controller },
        (authorityContext) => {
          const reauthorize = authorityContext.reauthorize;
          authorityContext.reauthorize = () => {
            const manifestRevision = JSON.parse(
              readFileSync(paths.taskManifest, "utf8"),
            ).revision;
            const eventPublished = readControlEvents(stateRoot).some(
              (candidate) => candidate.eventId === event.eventId,
            );
            if (
              !swapped &&
              manifestRevision === targetManifest.revision &&
              eventPublished &&
              existsSync(transactionPath)
            ) {
              renameSync(transactionPath, savedPath);
              writeFileSync(transactionPath, replacementBytes, {
                mode: 0o600,
              });
              swapped = true;
            }
            return reauthorize();
          };
          return withOutcomeRecordingGuards(
            {
              stateRoot,
              nowMs: Date.now(),
              authorityContext,
            },
            () => null,
          );
        },
      ),
    (error) =>
      error instanceof AutomationControlError &&
      ["authority_generation_conflict", "lease_transaction_conflict"].includes(
        error.code,
      ),
  );

  assert.equal(swapped, true);
  assert.deepEqual(readFileSync(transactionPath), replacementBytes);
  assert.deepEqual(readFileSync(savedPath), originalBytes);
  assert.equal(
    JSON.parse(readFileSync(paths.taskManifest, "utf8")).revision,
    targetManifest.revision,
  );
  assert.equal(
    readControlEvents(stateRoot).filter(
      (candidate) => candidate.eventId === event.eventId,
    ).length,
    1,
  );
});

test("automation planning read bundle exposes only frozen plain values and expires every admission", () => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  const otherStateRoot = temporaryStateRoot();
  const otherPaths = automationControlPaths(otherStateRoot);
  const transactionDirectory = path.join(
    paths.controlRoot,
    "outcome-ledger-transactions",
  );
  mkdirSync(transactionDirectory, { recursive: true, mode: 0o700 });
  const transactionName = `${"a".repeat(64)}.json`;
  const transactionPath = path.join(transactionDirectory, transactionName);
  writeFileSync(transactionPath, '{"test":true}\n', { mode: 0o600 });
  const expectedIdentity = lstatSync(transactionPath);
  let escapedBundle;
  let escapedAdmission;

  const result = withAutomationPlanningReadBundle(
    { stateRoot, nowMs: Date.parse("2026-07-20T12:00:00.000Z") },
    (bundle) => {
      escapedBundle = bundle;
      assert.equal(Object.isFrozen(bundle), true);
      assert.equal(Object.isFrozen(bundle.taskManifest), true);
      assert.equal(Object.isFrozen(bundle.controlEvents), true);
      assert.equal(Object.isFrozen(bundle.outcomeLedger), true);
      assert.equal(bundle.outcomeRepairTransactions.admissions.length, 1);
      escapedAdmission = bundle.outcomeRepairTransactions.admissions[0];
      const admitted = readAutomationPlanningAdmission(
        bundle,
        escapedAdmission,
      );
      assert.equal(admitted.text, '{"test":true}\n');
      assert.equal(admitted.identity.dev, String(expectedIdentity.dev));
      assert.equal(admitted.identity.ino, String(expectedIdentity.ino));
      assert.equal(admitted.identity.nlink, 1);
      assert.equal(admitted.identity.size, expectedIdentity.size);
      assert.equal(Object.isFrozen(admitted), true);
      assert.equal(Object.isFrozen(admitted.identity), true);

      const blocked = (operation) =>
        assert.throws(
          operation,
          (error) =>
            error instanceof AutomationControlError &&
            error.code === "invalid_state" &&
            /planning read callback/.test(error.message),
        );
      blocked(() =>
        readAutomationAuthorityFileSnapshot(paths.events, {
          allowMissing: true,
          privateRoot: paths.controlRoot,
        }),
      );
      blocked(() =>
        writeJsonAtomic(path.join(paths.controlRoot, "blocked.json"), {}),
      );
      blocked(() =>
        writeJsonAtomic(
          path.join(otherPaths.controlRoot, "cross-root-blocked.json"),
          {},
        ),
      );
      blocked(() =>
        withAutomationPlanningReadBundle(
          { stateRoot: otherStateRoot },
          () => null,
        ),
      );
      blocked(() =>
        writeAutomationAuthorityFile({
          filePath: paths.events,
          bytes: Buffer.alloc(0),
        }),
      );
      blocked(() => withKernelFileGuard("/unused", () => null));
      blocked(() =>
        inspectLeaseTransactionEventHistory({ stateRoot, events: [] }),
      );
      blocked(() => inspectLeaseCleanupArchiveCapacity(stateRoot));
      blocked(() => conservativeLeaseCleanupArchiveReservation(stateRoot));
      blocked(() =>
        readBoundedLeaseDirectoryEntriesForTest(paths.controlRoot, {
          maxEntries: 1,
          maxEncodedBytes: 128,
          label: "blocked planning callback scan",
        }),
      );
      return {
        nested: { exact: true },
        map: new Map([["key", { value: 1 }]]),
      };
    },
  );

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.nested), true);
  assert.equal(Object.isFrozen(result.map), true);
  assert.deepEqual(result.map, [["key", { value: 1 }]]);
  assert.throws(
    () => readAutomationPlanningAdmission(escapedBundle, escapedAdmission),
    (error) =>
      error instanceof AutomationControlError && error.code === "invalid_state",
  );
  assert.throws(
    () =>
      escapedBundle.admitFile({
        filePath: paths.outcomes,
        allowMissing: true,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "invalid_state",
  );
});

test("automation planning lease history cache invalidates a new pending transaction", () => {
  const stateRoot = temporaryStateRoot();
  const authentication = actorLease(stateRoot, "freed-release-verifier");
  const paths = automationControlPaths(stateRoot);
  const operationId = nextLeaseOperationId(
    "planning-lease-history-cache-heartbeat",
  );

  withAutomationOutcomeLedgerWriterGuard(
    paths.outcomes,
    (writerGuardContext) => {
      const before = withAutomationPlanningReadBundle(
        { stateRoot, writerGuardContext },
        (bundle) => bundle.leaseTransactionHistory,
      );
      assert.equal(before.healthy, true, before.issues.join("\n"));
      assert.equal(before.pendingTransactionArtifactCount, 0);

      runLeaseMutationProcessLoss({
        exportName: "heartbeatLease",
        options: {
          stateRoot,
          name: authentication.leaseName,
          operationId,
          token: authentication.leaseToken,
          ttlMs: 60_000,
        },
        phase: "lease-prepared",
      });

      const after = withAutomationPlanningReadBundle(
        { stateRoot, writerGuardContext },
        (bundle) => bundle.leaseTransactionHistory,
      );
      assert.equal(after.healthy, false);
      assert.ok(after.pendingTransactionArtifactCount > 0);
      assert.match(
        after.issues.join("\n"),
        /pending lease transaction artifact/,
      );
    },
    { stateRoot },
  );
});

test("the first control event may create history but record 100,001 is rejected byte-stably", () => {
  const firstRoot = temporaryStateRoot();
  const firstPaths = automationControlPaths(firstRoot);
  assert.equal(existsSync(firstPaths.events), false);
  actorLease(firstRoot, "freed-runtime-observer", {
    nowMs: Date.parse("2026-07-20T12:10:00.000Z"),
  });
  assert.equal(readFileSync(firstPaths.events, "utf8").trim().length > 0, true);

  const stateRoot = temporaryStateRoot();
  const nowMs = Date.now();
  const controller = actorLease(stateRoot, "freed-stability-controller", {
    nowMs,
  });
  const paths = automationControlPaths(stateRoot);
  const compactRecord = "{}\n";
  writeFileSync(
    paths.events,
    compactRecord.repeat(CONTROL_EVENT_HISTORY_MAX_RECORDS - 1),
    { mode: 0o600 },
  );
  appendControlEvent({
    stateRoot,
    type: "record_boundary_final_slot",
    ...controller,
    eventId: "record-boundary-final-slot",
    nowMs: nowMs + 1_000,
  });
  const before = readFileSync(paths.events);
  assert.equal(
    before.toString("utf8").split("\n").filter(Boolean).length,
    CONTROL_EVENT_HISTORY_MAX_RECORDS,
  );
  assert.throws(
    () =>
      appendControlEvent({
        stateRoot,
        type: "record_boundary_probe",
        ...controller,
        eventId: "record-boundary-probe",
        nowMs: nowMs + 2_000,
      }),
    (error) =>
      error instanceof AutomationControlError && error.code === "invalid_state",
  );
  assert.deepEqual(readFileSync(paths.events), before);
});

test("automation planning result accessors run before terminal generation proof", () => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  assert.equal(existsSync(paths.outcomes), false);
  assert.throws(
    () =>
      withAutomationPlanningReadBundle(
        { stateRoot, nowMs: Date.parse("2026-07-20T12:30:00.000Z") },
        () => ({
          get mutateDuringClone() {
            writeFileSync(paths.outcomes, "{}\n", { mode: 0o600 });
            return true;
          },
        }),
      ),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "authority_generation_conflict",
  );
});

test("automation planning directory-name cache invalidates an added private entry", () => {
  const stateRoot = temporaryStateRoot();
  const paths = automationControlPaths(stateRoot);
  const addedPath = path.join(paths.controlRoot, "uninspected-private.json");
  assert.equal(existsSync(addedPath), false);
  assert.throws(
    () =>
      withAutomationPlanningReadBundle(
        { stateRoot, nowMs: Date.parse("2026-07-20T12:35:00.000Z") },
        () => ({
          get mutateDirectoryDuringClone() {
            writeFileSync(addedPath, "{}\n", { mode: 0o600 });
            return true;
          },
        }),
      ),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "authority_generation_conflict",
  );
  assert.equal(existsSync(addedPath), true);
});

test("automation planning results reject executable values", () => {
  const stateRoot = temporaryStateRoot();
  assert.throws(
    () =>
      withAutomationPlanningReadBundle(
        { stateRoot, nowMs: Date.parse("2026-07-20T12:40:00.000Z") },
        () => ({ unsafe: () => true }),
      ),
    (error) =>
      error instanceof AutomationControlError && error.code === "invalid_state",
  );
});

test("completed task WAL retirement recovers without new retirement headroom", (t) => {
  const stateRoot = temporaryStateRoot();
  t.after(() => rmSync(stateRoot, { recursive: true, force: true }));
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const taskId = "task-wal-completed-retirement";
  createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });
  const paths = automationControlPaths(stateRoot);
  const createdEvent = readControlEvents(stateRoot).find(
    (candidate) =>
      candidate.type === "task_created" && candidate.taskId === taskId,
  );
  assert.ok(createdEvent);
  const current = JSON.parse(readFileSync(paths.taskManifest, "utf8"));
  const targetManifest = structuredClone(current);
  const targetTask = targetManifest.tasks.find(
    (candidate) => candidate.taskId === taskId,
  );
  const transitionAt = new Date(Date.now() + 1).toISOString();
  targetTask.state = "triaged";
  targetTask.revision += 1;
  targetTask.updatedAt = transitionAt;
  targetManifest.revision += 1;
  targetManifest.updatedAt = transitionAt;
  const event = {
    schemaVersion: 1,
    eventId: "9df73d2f-b10e-4c62-8e9a-7e48404f09c8",
    type: "task_transitioned",
    ts: transitionAt,
    actor: controller.actor,
    taskId,
    taskRevision: targetTask.revision,
    manifestRevision: targetManifest.revision,
    observerAuthority: targetTask.observerAuthority,
    providerAuthority: targetTask.providerAuthority,
    data: {
      fromState: "observed",
      toState: "triaged",
      authorizationProvenance: structuredClone(
        createdEvent.data.authorizationProvenance,
      ),
    },
  };
  const transaction = {
    schemaVersion: 1,
    transactionId: "task-wal-completed-retirement",
    preparedAt: transitionAt,
    previousManifestRevision: current.revision,
    targetManifest,
    event,
  };
  mkdirSync(paths.taskTransactions, { recursive: true, mode: 0o700 });
  chmodSync(paths.taskTransactions, 0o700);
  const transactionPath = path.join(
    paths.taskTransactions,
    `${String(targetManifest.revision).padStart(12, "0")}-${transaction.transactionId}.json`,
  );
  const transactionBytes = Buffer.from(
    `${JSON.stringify(transaction, null, 2)}\n`,
  );
  writeFileSync(transactionPath, transactionBytes, { mode: 0o600 });
  const transactionSnapshot = readAutomationAuthorityFileSnapshot(
    transactionPath,
    {
      privateRoot: paths.controlRoot,
      label: `Task transaction ${transaction.transactionId}`,
    },
  );
  const retirementPath = authorityRetirementPathForTest({
    filePath: transactionPath,
    snapshot: transactionSnapshot,
    operationId: `task-transaction-retire:${transaction.transactionId}`,
  });
  const retirementDirectory = path.dirname(retirementPath);
  const capacityEntryBytes = 128 * 1024 * 1024;
  let completedRetirement = false;

  withMutationLeaseAuthority(
    { stateRoot, ...controller },
    (authorityContext) => {
      const reauthorize = authorityContext.reauthorize;
      authorityContext.reauthorize = () => {
        const manifestRevision = JSON.parse(
          readFileSync(paths.taskManifest, "utf8"),
        ).revision;
        const eventPublished = readControlEvents(stateRoot).some(
          (candidate) => candidate.eventId === event.eventId,
        );
        if (
          !completedRetirement &&
          manifestRevision === targetManifest.revision &&
          eventPublished &&
          existsSync(transactionPath)
        ) {
          mkdirSync(retirementDirectory, { recursive: true, mode: 0o700 });
          chmodSync(retirementDirectory, 0o700);
          renameSync(transactionPath, retirementPath);
          for (let index = 0; index < 32; index += 1) {
            const namespace = createHash("sha256")
              .update(`completed-retirement-capacity-namespace:${index}`)
              .digest("hex");
            const generation = createHash("sha256")
              .update(`completed-retirement-capacity-generation:${index}`)
              .digest("hex");
            const capacityPath = path.join(
              retirementDirectory,
              `capacity-${String(index).padStart(2, "0")}.${namespace}.${generation}.retired`,
            );
            writeFileSync(capacityPath, Buffer.alloc(0), { mode: 0o600 });
            truncateSync(capacityPath, capacityEntryBytes);
          }
          completedRetirement = true;
        }
        return reauthorize();
      };
      return withOutcomeRecordingGuards(
        {
          stateRoot,
          nowMs: Date.now(),
          authorityContext,
        },
        () => null,
      );
    },
  );

  assert.equal(completedRetirement, true);
  assert.equal(existsSync(transactionPath), false);
  assert.deepEqual(readFileSync(retirementPath), transactionBytes);
  const retiredStats = lstatSync(retirementPath);
  assert.equal(retiredStats.isFile(), true);
  assert.equal(retiredStats.mode & 0o7777, 0o600);
  const capacityEntries = readdirSync(retirementDirectory).filter((name) =>
    name.startsWith("capacity-"),
  );
  assert.equal(capacityEntries.length, 32);
  assert.ok(
    capacityEntries.every(
      (name) =>
        lstatSync(path.join(retirementDirectory, name)).size ===
        capacityEntryBytes,
    ),
  );
  assert.equal(
    JSON.parse(readFileSync(paths.taskManifest, "utf8")).revision,
    targetManifest.revision,
  );
  assert.equal(
    readControlEvents(stateRoot).filter(
      (candidate) => candidate.eventId === event.eventId,
    ).length,
    1,
  );
});
