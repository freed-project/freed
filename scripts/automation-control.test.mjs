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
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AutomationControlError,
  AUTOMATION_ACTOR_POLICIES,
  OBSERVER_AUTHORITIES,
  TASK_STATES,
  acquireLease as acquireLeaseLive,
  appendControlEvent,
  appendOutcomeControlEvent,
  automationControlPaths,
  bindPublisherLeaseHead as bindPublisherLeaseHeadLive,
  createTask,
  finalizeTaskOutcome,
  heartbeatLease as heartbeatLeaseLive,
  inspectLeaseCleanupArchiveCapacity,
  inspectLease,
  isTaskTransitionAllowed,
  normalizeInstalledBuildIdentity,
  ownerGovernanceIntentDigest,
  preauthorizeOutcomeLedgerRepair,
  preflightOutcomeLedgerRepairEvent,
  readTask,
  readTaskManifest,
  releaseLease as releaseLeaseMutation,
  resolveAutomationStateRoot,
  transitionTask,
  updateTaskAuthorities,
  verifyOwnerCapabilityEnvelope,
  withAutomationOutcomeLedgerWriterGuard,
  withKernelFileGuard,
  withMutationLeaseAuthority,
  withOutcomeLedgerRepairFinalizationGuard,
  withOutcomeRecordingGuards,
} from "./lib/automation-control.mjs";
import { outcomeLedgerRepairOperationSeed } from "./lib/outcome-ledger-repair-contract.mjs";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, "automation-control.mjs");

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
  return withTestDateNow(nowMs, () =>
    bindPublisherLeaseHeadLive(liveOptions),
  );
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
      operationId:
        liveOptions.operationId ?? nextLeaseOperationId("release"),
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

function ownerIntent(action, taskId, parameters) {
  return ownerGovernanceIntentDigest({
    schemaVersion: 1,
    action,
    taskId,
    parameters,
  });
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

function writeLegacyLease(
  stateRoot,
  actor,
  { owner = actor, token = `${actor}-legacy-token`, nowMs = Date.now() } = {},
) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
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
    acquiredAt: new Date(nowMs - 60_000).toISOString(),
    heartbeatAt: new Date(nowMs - 30_000).toISOString(),
    expiresAt: new Date(nowMs + 60 * 60_000).toISOString(),
    ttlMs: 60 * 60_000,
  };
  writeFileSync(
    path.join(leasePath, "lease.json"),
    `${JSON.stringify(record)}\n`,
    {
      mode: 0o600,
    },
  );
  return { leasePath, policy, record };
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
  mkdirSync(archiveDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(receiptArchiveDirectory, { recursive: true, mode: 0o700 });
  for (const directory of [
    automationControlPaths(stateRoot).leases,
    transactions,
    receipts,
    archiveDirectory,
    receiptArchiveDirectory,
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
          device: exact ? BigInt(identity.dev).toString() : Number(identity.dev),
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
}) {
  const moduleUrl = new URL("./lib/automation-control.mjs", import.meta.url).href;
  const source = `
    import { ${exportName} } from ${JSON.stringify(moduleUrl)};
    const options = ${JSON.stringify(options)};
    options.checkpoint = (phase, details) => {
      if (
        phase === ${JSON.stringify(phase)} &&
        (${JSON.stringify(kind ?? null)} === null || details?.kind === ${JSON.stringify(kind ?? null)})
      ) {
        process.kill(process.pid, "SIGKILL");
      }
    };
    ${exportName}(options);
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

function readEvents(stateRoot) {
  const eventsPath = automationControlPaths(stateRoot).events;
  return readFileSync(eventsPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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
    nowMs >= currentTimeMs - 1_000 ? nowMs : currentTimeMs;
  assert.ok(policy, `missing actor policy for ${actor}`);
  if (actor === "freed-owner") {
    assert.match(ownerTaskId ?? "", /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    assert.match(ownerIntentDigest ?? "", /^[0-9a-f]{64}$/);
    const leasePath = path.join(
      automationControlPaths(stateRoot).leases,
      `${policy.leaseName}.lease`,
    );
    mkdirSync(leasePath, { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(leasePath, "lease.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        name: policy.leaseName,
        owner: actor,
        token,
        observerAuthority: policy.observerAuthority,
        providerAuthority: policy.providerAuthority,
        credentialKind: "owner-signed-capability",
        ownerCapabilityId: `owner-test-${nowMs}`,
        ownerCapabilityTaskId: ownerTaskId,
        ownerCapabilityIntentDigest: ownerIntentDigest,
        acquiredAt: new Date(leaseNowMs).toISOString(),
        heartbeatAt: new Date(leaseNowMs).toISOString(),
        expiresAt: new Date(leaseNowMs + 10 * 60_000).toISOString(),
        ttlMs: 10 * 60_000,
      })}\n`,
      { mode: 0o600 },
    );
    return { actor, leaseName: policy.leaseName, leaseToken: token };
  }
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  assert.equal(policy.maxLeaseLifetimeMs, 30 * 60_000);
  acquireLease({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    ttlMs: policy.maxLeaseLifetimeMs,
    nowMs: leaseNowMs,
    token,
    actorCredentialToken,
  });
  return { actor, leaseName: policy.leaseName, leaseToken: token };
}

function completeGuardedOutcome({
  stateRoot,
  taskId,
  authentication,
  outcome,
  nowMs,
  details = {},
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
          const controlEventId = `test-outcome:${outcomeDigest}`;
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
  const scaffolding = actorLease(
    stateRoot,
    "freed-scaffolding-maintainer",
    { nowMs },
  );
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
    ...(outcome === "installed"
      ? { details: { installedIdentity } }
      : {}),
    nowMs: nextNow(),
  });

  const paths = automationControlPaths(stateRoot);
  const manifest = JSON.parse(readFileSync(paths.taskManifest, "utf8"));
  const task = manifest.tasks.find((candidate) => candidate.taskId === taskId);
  delete task.details.latestOutcome;
  delete task.pendingOutcome;
  writeFileSync(paths.taskManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });

  const events = readEvents(stateRoot);
  const legacyTransition = events.find(
    (event) =>
      event.type === "task_transitioned" &&
      event.taskId === taskId &&
      event.taskRevision === task.revision &&
      event.data?.toState === outcome,
  );
  assert.ok(legacyTransition);
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
  writeFileSync(
    paths.events,
    `${retainedEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    { mode: 0o600 },
  );

  const ledgerEntries = readFileSync(paths.outcomes, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter(
      (entry) => !(entry.taskId === taskId && entry.outcome === outcome),
    );
  writeFileSync(
    paths.outcomes,
    ledgerEntries.length === 0
      ? ""
      : `${ledgerEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    { mode: 0o600 },
  );

  return {
    authentication: runner,
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

function spawnCli(
  args,
  { env = process.env, supplyLeaseToken = true } = {},
) {
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
  const nowMs = Date.parse("2026-07-18T09:55:00Z");
  createOutcomeLedgerRepairTask(stateRoot, taskId, nowMs - 1_000);
  const parameters = outcomeLedgerRepairParameters(stateRoot, taskId);
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
        event.eventId ===
        `outcome-history-repaired:${parameters.operationId}`,
    ),
    false,
  );
});

test("outcome recording guard helpers cannot escape their synchronous scope", () => {
  const stateRoot = temporaryStateRoot();
  const authentication = actorLease(
    stateRoot,
    "freed-stability-controller",
  );
  const authority = { stateRoot, ...authentication };
  let escaped;

  withMutationLeaseAuthority(authority, (authorityContext) =>
    withOutcomeRecordingGuards(
      { stateRoot, authorityContext },
      (helpers) => {
        escaped = helpers;
      },
    ),
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
  const authentication = actorLease(
    stateRoot,
    "freed-stability-controller",
  );
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
    ttlMs: 1_000,
    token,
    actorCredentialToken,
  });
  const paths = automationControlPaths(stateRoot);
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
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const authority = { stateRoot, ...authentication };
  const startedPath = path.join(stateRoot, "replacement-started");
  const completedPath = path.join(stateRoot, "replacement-completed");
  const commitPath = path.join(stateRoot, "authority-mutation-committed");
  const replacementToken = `replacement-${"y".repeat(32)}`;
  const releaseOperationId = "91".repeat(32);
  const acquireOperationId = "92".repeat(32);
  const moduleUrl = new URL("./lib/automation-control.mjs", import.meta.url)
    .href;
  let contender;

  withMutationLeaseAuthority(authority, (authorityContext) => {
    authorityContext.authorize(authority);
    contender = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { writeFileSync } from "node:fs"; import { acquireLease, releaseLease } from ${JSON.stringify(moduleUrl)}; writeFileSync(${JSON.stringify(startedPath)}, "started", { mode: 0o600 }); releaseLease({ stateRoot: ${JSON.stringify(stateRoot)}, name: ${JSON.stringify(authentication.leaseName)}, operationId: ${JSON.stringify(releaseOperationId)}, token: ${JSON.stringify(authentication.leaseToken)}, nowMs: Date.now() }); acquireLease({ stateRoot: ${JSON.stringify(stateRoot)}, name: ${JSON.stringify(authentication.leaseName)}, owner: ${JSON.stringify(actor)}, operationId: ${JSON.stringify(acquireOperationId)}, ttlMs: 60000, nowMs: Date.now(), token: ${JSON.stringify(replacementToken)}, actorCredentialToken: ${JSON.stringify(actorCredentialToken)} }); writeFileSync(${JSON.stringify(completedPath)}, "completed", { mode: 0o600 });`,
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
  const controller = actorLease(stateRoot, "freed-stability-controller");
  createTask({
    stateRoot,
    taskId: "P1-05",
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "approval-required",
    details: { behavioral: true, metricId: "novel-items-not-persisted" },
    nowMs: Date.parse("2026-07-10T10:00:00Z"),
  });
  createTask({
    stateRoot,
    taskId: "P0-01",
    ...controller,
    observerAuthority: "pr-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: Date.parse("2026-07-10T10:01:00Z"),
  });

  const transition = transitionTask({
    stateRoot,
    taskId: "P1-05",
    ...controller,
    toState: "triaged",
    expectedRevision: 1,
    nowMs: Date.parse("2026-07-10T10:02:00Z"),
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
  assert.equal(
    files.some((name) => name.endsWith(".tmp")),
    false,
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

test("a pending task transaction recovers manifest state and exactly one audit event", () => {
  const stateRoot = temporaryStateRoot();
  const controller = actorLease(stateRoot, "freed-stability-controller");
  createTask({
    stateRoot,
    taskId: "recoverable-task",
    ...controller,
    observerAuthority: "plan-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
  });

  const paths = automationControlPaths(stateRoot);
  const current = readTaskManifest({ stateRoot });
  const targetManifest = structuredClone(current);
  const targetTask = targetManifest.tasks[0];
  const transitionAt = "2026-07-10T10:05:00.000Z";
  targetTask.state = "triaged";
  targetTask.revision = 2;
  targetTask.updatedAt = transitionAt;
  targetManifest.revision = current.revision + 1;
  targetManifest.updatedAt = transitionAt;
  const event = {
    schemaVersion: 1,
    eventId: "recoverable-event",
    type: "task_transitioned",
    ts: transitionAt,
    actor: "freed-stability-controller",
    taskId: targetTask.taskId,
    taskRevision: targetTask.revision,
    manifestRevision: targetManifest.revision,
    observerAuthority: targetTask.observerAuthority,
    providerAuthority: targetTask.providerAuthority,
    data: { fromState: "observed", toState: "triaged" },
  };
  const transaction = {
    schemaVersion: 1,
    transactionId: "recoverable-transaction",
    preparedAt: transitionAt,
    previousManifestRevision: current.revision,
    targetManifest,
    event,
  };
  mkdirSync(paths.taskTransactions, { recursive: true });
  const transactionPath = path.join(
    paths.taskTransactions,
    "000000000002-recoverable.json",
  );
  writeFileSync(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`);

  const recovered = readTaskManifest({ stateRoot });
  assert.equal(recovered.revision, 2);
  assert.equal(recovered.tasks[0].state, "triaged");
  assert.equal(
    readEvents(stateRoot).filter((item) => item.eventId === event.eventId)
      .length,
    1,
  );
  assert.equal(existsSync(transactionPath), false);

  writeFileSync(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`);
  readTaskManifest({ stateRoot });
  assert.equal(
    readEvents(stateRoot).filter((item) => item.eventId === event.eventId)
      .length,
    1,
  );
  assert.equal(existsSync(transactionPath), false);
});

test("task creation and same-state transition retries are idempotent", () => {
  const stateRoot = temporaryStateRoot();
  const observer = actorLease(stateRoot, "freed-runtime-observer");
  const input = {
    stateRoot,
    taskId: "W1-01",
    ...observer,
    observerAuthority: "observe-only",
    providerAuthority: "forbidden",
    details: { behavioral: false, evidence: "digest-1" },
    nowMs: Date.parse("2026-07-10T11:00:00Z"),
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

test("actor policies enforce lifecycle ownership and fresh-evidence reopening", () => {
  const stateRoot = temporaryStateRoot();
  const observer = actorLease(stateRoot, "freed-runtime-observer");
  const controller = actorLease(stateRoot, "freed-stability-controller");
  const scaffolding = actorLease(stateRoot, "freed-scaffolding-maintainer");
  const runner = actorLease(stateRoot, "freed-nightly-runner");
  const verifier = actorLease(stateRoot, "freed-release-verifier");

  createTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: Date.parse("2026-07-10T10:00:00Z"),
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-lifecycle",
        ...observer,
        toState: "triaged",
        nowMs: Date.parse("2026-07-10T10:01:00Z"),
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
    nowMs: Date.parse("2026-07-10T10:01:00Z"),
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...controller,
    toState: "approved_for_pr",
    nowMs: Date.parse("2026-07-10T10:02:00Z"),
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...scaffolding,
    toState: "implemented",
    nowMs: Date.parse("2026-07-10T10:03:00Z"),
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...scaffolding,
    toState: "validated",
    nowMs: Date.parse("2026-07-10T10:04:00Z"),
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
    nowMs: Date.parse("2026-07-10T10:05:00Z"),
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
    nowMs: Date.parse("2026-07-10T10:06:00Z"),
  });
  transitionTask({
    stateRoot,
    taskId: "policy-lifecycle",
    ...runner,
    toState: "soaking",
    nowMs: Date.parse("2026-07-10T10:07:00Z"),
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
        nowMs: Date.parse("2026-07-10T10:08:00Z"),
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
    nowMs: Date.parse("2026-07-10T10:08:30Z"),
  });
  completeGuardedOutcome({
    stateRoot,
    taskId: "policy-reopen",
    authentication: controller,
    outcome: "governance_blocked",
    nowMs: Date.parse("2026-07-10T10:08:40Z"),
  });
  transitionTask({
    stateRoot,
    taskId: "policy-reopen",
    ...controller,
    toState: "closed",
    nowMs: Date.parse("2026-07-10T10:09:00Z"),
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot,
        taskId: "policy-reopen",
        ...controller,
        toState: "triaged",
        details: { evidenceWindowEnd: "2026-07-10T10:08:59Z" },
        nowMs: Date.parse("2026-07-10T10:10:00Z"),
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "stale_reopen_evidence",
  );
  const reopened = transitionTask({
    stateRoot,
    taskId: "policy-reopen",
    ...controller,
    toState: "triaged",
    details: { evidenceWindowEnd: "2026-07-10T11:00:00Z" },
    nowMs: Date.parse("2026-07-10T11:01:00Z"),
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
    const scaffolding = actorLease(
      stateRoot,
      "freed-scaffolding-maintainer",
      { nowMs },
    );
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
    if (["validated", "merged", "soaking", "implemented"].includes(preparation)) {
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
    assert.deepEqual(readFileSync(paths.taskManifest), snapshot.manifest, outcome);
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
            .map((name) => [
              name,
              readFileSync(path.join(paths.taskTransactions, name)),
            ]),
        )
      : {},
  });
  const before = snapshot();
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
  assert.deepEqual(snapshot(), before);

  const outcomeDigest = "a".repeat(64);
  const ownerFinalize = actorLease(stateRoot, "freed-owner", {
    nowMs: nowMs + 3,
    token: "owner-outcome-finalize-token",
    ownerTaskId: taskId,
    ownerIntentDigest: ownerIntent("task.finalize-outcome", taskId, {
      outcome: "merged",
      outcomeDigest,
      taskRevision: 1,
    }),
  });
  assert.throws(
    () =>
      finalizeTaskOutcome({
        stateRoot,
        taskId,
        ...ownerFinalize,
        outcome: "merged",
        outcomeDigest,
        taskRevision: 1,
        nowMs: nowMs + 4,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "owner_intent_required",
  );
  assert.deepEqual(snapshot(), before);
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
  const controlEventId = `test-outcome:${outcomeDigest}`;
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
    nowMs: Date.parse("2026-07-10T11:55:00Z"),
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
        nowMs: Date.parse("2026-07-10T12:00:00Z"),
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
    nowMs: Date.parse("2026-07-10T12:00:00Z"),
  });
  assert.equal(installed.task.installedBuild, "26.7.100-dev");
  assert.deepEqual(installed.task.installedIdentity, {
    version: "26.7.100-dev",
    commitSha: "2".repeat(40),
    channel: "dev",
  });
  assert.equal(installed.task.installedAt, "2026-07-10T12:00:00.000Z");
  const soaking = transitionTask({
    stateRoot,
    taskId: "behavior-a",
    ...runner,
    toState: "soaking",
    nowMs: Date.parse("2026-07-10T12:05:00Z"),
  });
  assert.equal(soaking.task.soakStartedAt, "2026-07-10T12:05:00.000Z");
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
    nowMs: Date.parse("2026-07-10T12:06:00Z"),
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

  assert.throws(
    () =>
      appendControlEvent({
        stateRoot,
        type: "outcome_recorded",
        ...controller,
        taskId: "behavior-a",
        data: {},
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "reserved_event_type",
  );

  const manifestPath = automationControlPaths(stateRoot).taskManifest;
  const corruptManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  corruptManifest.tasks.find(
    (task) => task.taskId === "behavior-a",
  ).details.behavioral = false;
  writeFileSync(manifestPath, `${JSON.stringify(corruptManifest)}\n`);
  assert.throws(
    () => readTaskManifest({ stateRoot }),
    (error) =>
      error instanceof AutomationControlError && error.code === "invalid_state",
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
      error instanceof AutomationControlError &&
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
  appendFileSync(
    automationControlPaths(stateRoot).events,
    `${JSON.stringify({
      schemaVersion: 1,
      eventId: "provider-owner-capability-lease",
      type: "lease_acquired",
      ts: ownerLeaseRecord.acquiredAt,
      actor: "freed-owner",
      leaseName: "owner-governance",
      data: {
        credentialKind: ownerLeaseRecord.credentialKind,
        ownerCapabilityId: ownerLeaseRecord.ownerCapabilityId,
        ownerCapabilityTaskId: ownerLeaseRecord.ownerCapabilityTaskId,
        ownerCapabilityIntentDigest:
          ownerLeaseRecord.ownerCapabilityIntentDigest,
      },
    })}\n`,
  );
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
    "owner-signed-capability",
  );
  assert.match(
    event.data.authorizationProvenance.ownerCapabilityId,
    /^owner-test-/,
  );
  assert.equal(
    event.data.authorizationProvenance.ownerCapabilityTaskId,
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
  const authorizationEvent = controlEvents.find(
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
  const matchingOwnerLeaseEvent = controlEvents.find(
    (candidate) =>
      candidate.type === "lease_acquired" &&
      candidate.actor === "freed-owner" &&
      candidate.leaseName === "owner-governance" &&
      candidate.data.credentialKind === "owner-signed-capability" &&
      candidate.data.ownerCapabilityId === provenance.ownerCapabilityId &&
      candidate.data.ownerCapabilityTaskId === provenance.ownerCapabilityTaskId &&
      candidate.data.ownerCapabilityIntentDigest ===
        provenance.ownerCapabilityIntentDigest &&
      candidate.ts === provenance.leaseAcquiredAt,
  );
  assert.ok(matchingOwnerLeaseEvent);
  const validatedApproval = validateProviderRiskApproval(
    approval,
    approval.paths,
    {
      now: ownerLeaseAcquiredAtMs + 3_000,
      diffSha: approval.diffSha,
      controlManifest,
      controlEvents,
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

test("non-owner lease acquisition requires the matching persistent actor credential", () => {
  const stateRoot = temporaryStateRoot();
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "nightly-writer",
        owner: "freed-nightly-runner",
        ttlMs: 60_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_credential_required",
  );

  const actorCredentialToken = writeActorCredential(
    stateRoot,
    "freed-nightly-runner",
  );
  assert.throws(
    () =>
      acquireLease({
        stateRoot,
        name: "nightly-writer",
        owner: "freed-nightly-runner",
        ttlMs: 60_000,
        actorCredentialToken: "wrong-persistent-actor-secret-1234567890",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_credential_mismatch",
  );
  const acquired = acquireLease({
    stateRoot,
    name: "nightly-writer",
    owner: "freed-nightly-runner",
    ttlMs: 60_000,
    actorCredentialToken,
  });
  assert.equal(acquired.lease.credentialKind, "persistent-actor");
});

test("general actor policies enforce a 30-minute absolute lease lifetime", () => {
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
    const stateRoot = temporaryStateRoot();
    const policy = AUTOMATION_ACTOR_POLICIES[actor];
    const actorCredentialToken = writeActorCredential(stateRoot, actor);
    assert.equal(policy.maxLeaseLifetimeMs, maxLeaseLifetimeMs);

    assert.throws(
      () =>
        acquireLease({
          stateRoot,
          name: policy.leaseName,
          owner: actor,
          ttlMs: maxLeaseLifetimeMs + 1,
          nowMs,
          token: `${actor}-overlong-token-caller-retained-1234567890`,
          actorCredentialToken,
        }),
      (error) =>
        error instanceof AutomationControlError &&
        error.code === "lease_ttl_exceeded",
    );

    const acquired = acquireLease({
      stateRoot,
      name: policy.leaseName,
      owner: actor,
      ttlMs: maxLeaseLifetimeMs,
      nowMs,
      token: `${actor}-bounded-token-caller-retained-1234567890`,
      actorCredentialToken,
    });
    assert.equal(acquired.lease.credentialKind, "persistent-actor");
    assert.equal(
      acquired.lease.expiresAt,
      new Date(nowMs + maxLeaseLifetimeMs).toISOString(),
    );

    const heartbeat = heartbeatLease({
      stateRoot,
      name: policy.leaseName,
      token: acquired.lease.token,
      ttlMs: maxLeaseLifetimeMs,
      nowMs: nowMs + 20 * 60_000,
    });
    assert.equal(
      heartbeat.lease.expiresAt,
      new Date(nowMs + maxLeaseLifetimeMs).toISOString(),
    );
  }
});

test("owner lease lifetime cannot outlive its signed capability limit", () => {
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
    ownerIntentDigest: "a".repeat(64),
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

test("an authenticated actor upgrades only its own live legacy lease", () => {
  const stateRoot = temporaryStateRoot();
  const actor = "freed-scaffolding-maintainer";
  const nowMs = Date.parse("2026-07-10T16:00:00Z");
  const legacy = writeLegacyLease(stateRoot, actor, { nowMs });
  const inspectedLegacy = inspectLease({
    stateRoot,
    name: legacy.policy.leaseName,
    nowMs,
  });
  assert.equal(inspectedLegacy.status, "active");
  assert.equal(inspectedLegacy.legacyUncredentialed, true);
  assert.equal(Object.hasOwn(inspectedLegacy, "token"), false);
  const actorCredentialToken = writeActorCredential(stateRoot, actor);
  const acquired = acquireLease({
    stateRoot,
    name: legacy.policy.leaseName,
    owner: actor,
    ttlMs: 60_000,
    nowMs,
    token: "scaffolding-upgraded-token-caller-retained-1234567890",
    actorCredentialToken,
  });

  assert.equal(acquired.takeover, true);
  assert.equal(acquired.credentialUpgrade, true);
  assert.equal(acquired.previous.legacyUncredentialed, true);
  assert.equal(acquired.lease.credentialKind, "persistent-actor");
  assert.equal(
    acquired.lease.token,
    "scaffolding-upgraded-token-caller-retained-1234567890",
  );
  const upgradeEvent = readEvents(stateRoot).at(-1);
  assert.equal(upgradeEvent.type, "lease_credential_upgraded");
  assert.equal(upgradeEvent.data.credentialUpgrade, true);
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
  const unauthenticated = writeLegacyLease(unauthenticatedRoot, actor);
  assert.throws(
    () =>
      acquireLease({
        stateRoot: unauthenticatedRoot,
        name: unauthenticated.policy.leaseName,
        owner: actor,
        ttlMs: 60_000,
        token: "unauthenticated-upgrade-token-caller-retained-1234567890",
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_credential_required",
  );

  const crossActorRoot = temporaryStateRoot();
  const crossActor = writeLegacyLease(crossActorRoot, actor, {
    owner: "freed-nightly-runner",
  });
  const actorCredentialToken = writeActorCredential(crossActorRoot, actor);
  assert.throws(
    () =>
      acquireLease({
        stateRoot: crossActorRoot,
        name: crossActor.policy.leaseName,
        owner: actor,
        ttlMs: 60_000,
        token: "cross-actor-upgrade-token-caller-retained-1234567890",
        actorCredentialToken,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "legacy_lease_owner_mismatch",
  );

  const tokenReuseRoot = temporaryStateRoot();
  const tokenReuse = writeLegacyLease(tokenReuseRoot, actor);
  const tokenReuseCredential = writeActorCredential(tokenReuseRoot, actor);
  assert.throws(
    () =>
      acquireLease({
        stateRoot: tokenReuseRoot,
        name: tokenReuse.policy.leaseName,
        owner: actor,
        ttlMs: 60_000,
        token: tokenReuse.record.token,
        actorCredentialToken: tokenReuseCredential,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_token_reuse",
  );
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
      error instanceof AutomationControlError && error.code === "lease_busy",
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
      [
        "lease",
        "show",
        "--state-root",
        stateRoot,
        "--name",
        name,
      ],
      { supplyLeaseToken: false },
    );
    assert.equal(cli.code, 1);
    assert.equal(cli.stdout, "");
    const failure = JSON.parse(cli.stderr);
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, "lease_permissions_invalid");
    assert.equal(lstatSync(leasePath).isSymbolicLink(), shape === "dangling-symlink");
    assert.equal(lstatSync(leasePath).isFIFO(), shape === "fifo");
  }
});

test("private lease readers reject FIFOs symlinks unsafe ancestry and mode drift", () => {
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
  symlinkSync(
    externalTransactions,
    path.join(ancestryPaths.leases, ".transactions"),
    "dir",
  );
  assert.throws(
    () => inspectLease({ stateRoot: ancestryRoot, name, nowMs: 40_000 }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_invalid",
  );

  const credentialRoot = temporaryStateRoot();
  const credentialToken = writeActorCredential(credentialRoot, actor);
  const credentialPath = path.join(
    automationControlPaths(credentialRoot).actorCredentials,
    `${actor}.json`,
  );
  chmodSync(credentialPath, 0o644);
  assert.throws(
    () =>
      acquireLeaseMutation({
        stateRoot: credentialRoot,
        name,
        owner: actor,
        operationId: "f0".repeat(32),
        ttlMs: 60_000,
        nowMs: 40_000,
        token: "caller-retained-safe-reader-token-1234567890",
        actorCredentialToken: credentialToken,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "actor_credential_invalid",
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
  assert.match(source, /device: BigInt\(snapshot\.identity\.dev\)\.toString\(\)/);
  assert.match(source, /inode: BigInt\(snapshot\.identity\.ino\)\.toString\(\)/);
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
  const [archivePath] = leaseCleanupQuarantines(
    transactionPaths.after,
    operationId,
  );
  const stats = lstatSync(archivePath, { bigint: true });
  const expected = leaseCleanupGenerationDigestForIdentity(
    transactionPaths.after,
    stats,
    readFileSync(archivePath),
  );
  assert.equal(
    path.basename(archivePath),
    `${operationId}.${expected}.json`,
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
      error instanceof AutomationControlError &&
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
  for (let index = 0; index < 8; index += 1) {
    heartbeatLeaseMutation({
      stateRoot,
      name,
      operationId: nextLeaseOperationId(`stale-receipt-age-${index}`),
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
    heartbeatReceipts[0],
  );
  const tooOld = new Date(
    startedAt - 367 * 24 * 60 * 60 * 1_000,
  );
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
      error instanceof AutomationControlError &&
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
              utimesSync(path.join(receiptDirectory, entry), tiedTime, tiedTime);
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
      .map((operationId) => `${name}.heartbeat.${operationId}.json`)
      .sort()
      .reverse()
      .slice(0, 7),
  ].sort();
  assert.deepEqual(heartbeatReceipts.sort(), expectedReceipts);
  const archivedReceipts = leaseCleanupQuarantines(
    currentReceipt,
    currentOperationId,
  );
  assert.equal(archivedReceipts.length, 1);
  const archivedReceipt = JSON.parse(readFileSync(archivedReceipts[0], "utf8"));
  const expectedArchivedOperationId = retainedOperationIds
    .map((operationId) => `${name}.heartbeat.${operationId}.json`)
    .sort()
    .reverse()
    .slice(7)[0]
    .split(".")
    .at(-2);
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
            !details.filePath.includes(`${path.sep}.transaction-receipts${path.sep}`)
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
      error instanceof AutomationControlError &&
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
            !details.filePath.includes(`${path.sep}.transaction-receipts${path.sep}`)
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
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_conflict",
  );
  assert.ok(swap);
  assert.equal(existsSync(transactionPaths.active), false);
  assert.equal(
    leaseCleanupQuarantines(transactionPaths.active, operationId).length,
    3,
  );
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
          error instanceof AutomationControlError &&
          ["lease_transaction_conflict", "control_event_conflict"].includes(
            error.code,
          ),
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
        0,
        `${transactionState}:${scenario}`,
      );
    }
  }
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
      error instanceof AutomationControlError &&
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
  assert.equal(quarantines.length, 1);
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
  assert.equal(quarantines.every((filePath) => existsSync(filePath)), true);
  assert.equal(
    leaseCleanupQuarantines(transactionPaths.after, operationId).length,
    2,
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
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_conflict",
  );
  assert.ok(collision);
  assert.deepEqual(readFileSync(transactionPaths.after), collision.sourceBytes);
  assert.deepEqual(
    readFileSync(collision.archivePath),
    collision.archiveBytes,
  );
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
      error instanceof AutomationControlError &&
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
      error instanceof AutomationControlError &&
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
          const old = new Date(
            nowMs - 367 * 24 * 60 * 60 * 1_000,
          );
          utimesSync(archivePath, old, old);
          injected = {
            archivePath,
            targetArchivePath: details.archivePath,
            sourceBytes: readFileSync(details.filePath),
          };
        },
      }),
    (error) =>
      error instanceof AutomationControlError &&
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
        token: `cleanup-final-capacity-${"x".repeat(48)}`,
        actorCredentialToken: writeActorCredential(stateRoot, actor),
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
          const old = new Date(
            nowMs - 367 * 24 * 60 * 60 * 1_000,
          );
          utimesSync(archivePath, old, old);
          injected = archivePath;
        },
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_archive_capacity_exceeded",
  );
  assert.ok(injected);
  assert.equal(existsSync(injected), true);
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
                details.kind !== "staging-after"
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
                mkdirSync(
                  path.join(directory, ".lease-cleanup-quarantine"),
                  { mode: 0o700 },
                );
                swap = {
                  sourceBytes,
                  sourcePath: path.join(displaced, path.basename(details.filePath)),
                  displaced,
                };
              }
            },
          }),
        (error) =>
          error instanceof AutomationControlError &&
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
      error instanceof AutomationControlError &&
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
            phase !== "lease-directory-created" ||
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
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_conflict",
  );
  assert.ok(displaced);
  assert.deepEqual(snapshotFilesystemEntry(outside), outsideBefore);
  assert.equal(
    existsSync(path.join(displaced, ".transactions")),
    true,
  );
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
  assert.equal(parentSyncs.every((details) => details.created === false), true);
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
      error instanceof AutomationControlError &&
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

  const injectedOperationId = nextLeaseOperationId("cleanup-post-plan-injection");
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
      error instanceof AutomationControlError &&
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
      assert.equal(existsSync(crashedArchivePath), true, `${targetKind}:${phase}`);
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
        2,
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
    "duplicate-mapping",
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
    const validArchive = leaseCleanupQuarantines(
      transactionPaths.after,
      operationId,
    )[0];
    assert.ok(validArchive);
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
      writeFileSync(temporaryPath, readFileSync(validArchive), { mode: 0o600 });
      publishExactLeaseCleanupFixture(
        temporaryPath,
        scenario === "duplicate-mapping"
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
        error instanceof AutomationControlError &&
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
  const validBeforeArchive = leaseCleanupQuarantines(
    transactionPaths.before,
    operationId,
  )[0];
  const temporaryPath = path.join(
    path.dirname(validBeforeArchive),
    ".wrong-side.tmp",
  );
  writeFileSync(temporaryPath, readFileSync(validBeforeArchive), { mode: 0o600 });
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
      error instanceof AutomationControlError &&
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
  publishExactLeaseCleanupFixture(
    temporaryPath,
    acquireReceipt,
    operationId,
  );

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
        leaseTransactionPaths(
          stateRoot,
          name,
          "heartbeat",
          operationId,
        ).receipt,
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
    for (const filePath of [transactionPaths.active, transactionPaths.receipt]) {
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
    assert.equal(readFileSync(transactionPaths.receipt, "utf8").includes(token), false);
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
    const eventsBeforeReplay = readFileSync(automationControlPaths(stateRoot).events);
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
    assert.deepEqual(readFileSync(automationControlPaths(stateRoot).events), eventsBeforeReplay);
    assert.deepEqual(readFileSync(transactionPaths.receipt), receiptBeforeReplay);
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
    { phase: "lease-atomic-temporary-synced", kind: "WAL" },
    { phase: "lease-state-directory-created" },
    {
      phase: "lease-atomic-temporary-synced",
      kind: "canonical lease record",
    },
    { phase: "lease-atomic-renamed", kind: "canonical lease record" },
    { phase: "lease-atomic-temporary-synced", kind: "receipt" },
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
      const competingName =
        AUTOMATION_ACTOR_POLICIES[competingActor].leaseName;
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
          error instanceof AutomationControlError &&
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
    "lease-state-removal-renamed",
    "lease-state-removal-record-deleted",
    "lease-state-removal-deleted",
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

test("lease acquisition binds authorization to one admitted credential inode", () => {
  const nowMs = Date.now();
  const cases = [];

  {
    const stateRoot = temporaryStateRoot();
    const actor = "freed-release-verifier";
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const credentialToken = writeActorCredential(stateRoot, actor);
    cases.push({
      label: "actor",
      stateRoot,
      name,
      operation: {
        stateRoot,
        name,
        owner: actor,
        operationId: createHash("sha256")
          .update("credential-inode-actor")
          .digest("hex"),
        ttlMs: 30 * 60_000,
        token: `credential-inode-actor-${"x".repeat(40)}`,
        actorCredentialToken: credentialToken,
      },
      sourcePath: path.join(
        automationControlPaths(stateRoot).actorCredentials,
        `${actor}.json`,
      ),
    });
  }

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
        error instanceof AutomationControlError &&
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

test("retired prepared WAL permanently binds its caller operation identity", () => {
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
  assert.equal(inspectLease({ stateRoot, name }), null);
  const paths = leaseTransactionPaths(
    stateRoot,
    name,
    "acquire",
    operationId,
  );
  assert.equal(existsSync(paths.active), false);
  const beforeConflict = snapshotLeaseAuthorityState(stateRoot);
  assert.throws(
    () =>
      acquireLeaseLive({
        ...original,
        ttlMs: 29 * 60_000,
        token: `changed-retired-operation-${"y".repeat(40)}`,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "lease_transaction_conflict",
  );
  assert.deepEqual(snapshotLeaseAuthorityState(stateRoot), beforeConflict);
  assert.equal(existsSync(paths.active), false);

  const recovered = acquireLeaseLive(original);
  assert.equal(recovered.acquired, true);
  assert.equal(recovered.lease.token, token);
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
  const recoveredAuthorityEvent = appendControlEvent({
    stateRoot,
    type: "lease-authority-recovered",
    actor,
    leaseName: name,
    leaseToken: token,
    nowMs: acquiredAt + 1,
  });
  assert.equal(recoveredAuthorityEvent.type, "lease-authority-recovered");
  assert.equal(
    readControlEvents(stateRoot).filter(
      (event) => event.eventId === `lease:${acquireOperationId}`,
    ).length,
    1,
  );
  const inspected = inspectLease({ stateRoot, name, nowMs: acquiredAt + 1 });
  assert.equal(inspected.owner, actor);
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
      error.code === "lease_not_found",
  );
  assert.equal(
    readControlEvents(stateRoot).filter(
      (event) => event.eventId === `lease:${releaseOperationId}`,
    ).length,
    1,
  );
  const released = releaseLease({
    stateRoot,
    name,
    operationId: releaseOperationId,
    token,
    nowMs: acquiredAt + 120_002,
  });
  assert.equal(released.recovered, true);
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
      error instanceof AutomationControlError &&
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
    leaseTransactionPaths(
      stateRoot,
      name,
      "release",
      releaseOperationId,
    ).receipt,
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
  assert.deepEqual(snapshotLeaseAuthorityState(publisherRoot), beforeBindReplay);
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
      path.join(
        automationControlPaths(stateRoot).leases,
        "pr-publisher.lease",
      ),
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
  const heartbeatEvents = readFileSync(automationControlPaths(stateRoot).events);
  const heartbeatReplay = heartbeatLeaseMutation({
    stateRoot,
    name,
    operationId: heartbeatOperationId,
    token,
    nowMs: nowMs + 2_000,
  });
  assert.equal(heartbeatReplay.recovered, true);
  assert.deepEqual(readFileSync(automationControlPaths(stateRoot).events), heartbeatEvents);

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
  assert.deepEqual(readFileSync(automationControlPaths(stateRoot).events), releaseEvents);

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

test("lease transaction rejects credential-root and event contract drift", () => {
  for (const drift of ["credential-root", "event"]) {
    const stateRoot = temporaryStateRoot();
    const actor = "freed-release-verifier";
    const name = AUTOMATION_ACTOR_POLICIES[actor].leaseName;
    const actorCredentialToken = writeActorCredential(stateRoot, actor);
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
          actorCredentialToken,
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
    if (drift === "credential-root") {
      transaction.capability.sourcePath = path.join(
        stateRoot,
        `${actor}.json`,
      );
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
      error instanceof AutomationControlError &&
      error.code === "lease_operation_id_required",
  );
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
      error instanceof AutomationControlError &&
      error.code === "lease_token_required",
  );
});

test("CLI emits structured JSON for task and lease operations", () => {
  const stateRoot = temporaryStateRoot();
  const controllerCredential = writeActorCredential(
    stateRoot,
    "freed-stability-controller",
  );
  const controllerLease = runCli(
    [
      "lease",
      "acquire",
      "--state-root",
      stateRoot,
      "--name",
      "stability-controller",
      "--owner",
      "freed-stability-controller",
      "--ttl-seconds",
      "60",
    ],
    {
      env: {
        ...process.env,
        FREED_AUTOMATION_ACTOR_TOKEN: controllerCredential,
      },
    },
  );
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
    controllerLease.result.lease.token,
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

  const nightlyCredential = writeActorCredential(
    stateRoot,
    "freed-nightly-runner",
  );
  const lease = runCli(
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
    {
      env: { ...process.env, FREED_AUTOMATION_ACTOR_TOKEN: nightlyCredential },
    },
  );
  assert.equal(lease.ok, true);
  assert.equal(lease.result.lease.owner, "freed-nightly-runner");
  assert.equal(lease.result.lease.observerAuthority, "merge-safe");
  assert.equal(lease.result.lease.providerAuthority, "approval-required");
  assert.ok(lease.result.lease.token);

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
        FREED_AUTOMATION_LEASE_TOKEN: lease.result.lease.token,
      },
    },
  );
  assert.equal(heartbeated.result.heartbeated, true);
});

test("outcome ledger repair preauthorization binds one exact receipt to the owner lease", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-18T10:00:00Z");
  const taskId = "outcome-ledger-history-repair";
  createOutcomeLedgerRepairTask(stateRoot, taskId, nowMs - 1_000);
  const parameters = outcomeLedgerRepairParameters(stateRoot, taskId);
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
    "owner-signed-capability",
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
  const nowMs = Date.parse("2026-07-18T10:05:00Z");
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
  const nowMs = Date.parse("2026-07-18T10:10:00Z");
  const taskId = "outcome-ledger-history-repair-event";
  createOutcomeLedgerRepairTask(stateRoot, taskId, nowMs - 1_000);
  const parameters = outcomeLedgerRepairParameters(stateRoot, taskId);
  const intentDigest = ownerIntent("outcome-ledger.repair", taskId, parameters);
  const owner = actorLease(stateRoot, "freed-owner", {
    nowMs,
    ownerTaskId: taskId,
    ownerIntentDigest: intentDigest,
  });
  const input = { stateRoot, taskId, ...owner, parameters };
  const eventsPath = automationControlPaths(stateRoot).events;
  const eventsBefore = readFileSync(eventsPath);

  const first = preflightOutcomeLedgerRepairEvent({
    ...input,
    nowMs: nowMs + 1_000,
  });
  const retry = preflightOutcomeLedgerRepairEvent({
    ...input,
    nowMs: nowMs + 20_000,
  });
  assert.equal(first.existing, false);
  assert.equal(retry.existing, false);
  assert.equal(first.event.type, "outcome_history_repaired");
  assert.equal(
    first.event.eventId,
    `outcome-history-repaired:${parameters.operationId}`,
  );
  assert.equal(first.event.ts, "2026-07-18T10:10:01.000Z");
  assert.equal(retry.event.ts, "2026-07-18T10:10:20.000Z");
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

test("outcome ledger repair event preflight rejects conflicting and duplicate identities", () => {
  const nowMs = Date.parse("2026-07-18T10:15:00Z");

  const conflictingRoot = temporaryStateRoot();
  const conflictingTaskId = "outcome-ledger-history-repair-conflict";
  createOutcomeLedgerRepairTask(
    conflictingRoot,
    conflictingTaskId,
    nowMs - 1_000,
  );
  const conflictingParameters = outcomeLedgerRepairParameters(
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
  const conflictingEventId = `outcome-history-repaired:${conflictingParameters.operationId}`;
  const conflictingPaths = automationControlPaths(conflictingRoot);
  mkdirSync(path.dirname(conflictingPaths.events), { recursive: true });
  writeFileSync(
    conflictingPaths.events,
    `${JSON.stringify({
      schemaVersion: 1,
      eventId: conflictingEventId,
      type: "outcome_history_repaired",
      ts: new Date(nowMs).toISOString(),
      actor: "freed-owner",
      taskId: conflictingTaskId,
      data: { intentDigest: "ff".repeat(32), parameters: {} },
    })}\n`,
  );
  assert.throws(
    () =>
      preflightOutcomeLedgerRepairEvent({
        stateRoot: conflictingRoot,
        taskId: conflictingTaskId,
        ...conflictingOwner,
        parameters: conflictingParameters,
        nowMs: nowMs + 1_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "control_event_conflict",
  );

  const duplicateRoot = temporaryStateRoot();
  const duplicateTaskId = "outcome-ledger-history-repair-duplicate";
  createOutcomeLedgerRepairTask(duplicateRoot, duplicateTaskId, nowMs - 1_000);
  const duplicateParameters = outcomeLedgerRepairParameters(
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
  const duplicateInput = {
    stateRoot: duplicateRoot,
    taskId: duplicateTaskId,
    ...duplicateOwner,
    parameters: duplicateParameters,
  };
  const event = preflightOutcomeLedgerRepairEvent({
    ...duplicateInput,
    nowMs: nowMs + 1_000,
  }).event;
  appendFileSync(
    automationControlPaths(duplicateRoot).events,
    `${JSON.stringify(event)}\n${JSON.stringify(event)}\n`,
  );
  assert.throws(
    () =>
      preflightOutcomeLedgerRepairEvent({
        ...duplicateInput,
        nowMs: nowMs + 2_000,
      }),
    (error) =>
      error instanceof AutomationControlError &&
      error.code === "control_event_duplicate",
  );
});

test("control event appends atomically preserve exact existing bytes and newline boundaries", () => {
  const stateRoot = temporaryStateRoot();
  const nowMs = Date.parse("2026-07-18T10:20:00Z");
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
  assert.equal(
    readdirSync(paths.controlRoot).some((name) => name.endsWith(".tmp")),
    false,
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

test("concurrent CLI acquisition produces one lease owner", async () => {
  const stateRoot = temporaryStateRoot();
  const actorCredentialToken = writeActorCredential(
    stateRoot,
    "freed-nightly-runner",
  );
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
        {
          env: {
            ...process.env,
            FREED_AUTOMATION_ACTOR_TOKEN: actorCredentialToken,
          },
        },
      ),
    ),
  );

  const successes = attempts.filter((attempt) => attempt.code === 0);
  const failures = attempts.filter((attempt) => attempt.code !== 0);
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 5);
  assert.ok(
    failures.every(
      (attempt) => JSON.parse(attempt.stderr).error.code === "lease_busy",
    ),
    JSON.stringify(
      failures.map((attempt) => ({
        code: attempt.code,
        stderr: attempt.stderr,
      })),
    ),
  );
  const inspected = runCli([
    "lease",
    "show",
    "--state-root",
    stateRoot,
    "--name",
    "nightly-writer",
  ]);
  assert.equal(inspected.result.status, "active");
});
