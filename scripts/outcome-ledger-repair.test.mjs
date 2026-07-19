import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  AUTOMATION_ACTOR_POLICIES,
  acquireLease,
  automationControlPaths,
  createTask,
  ownerGovernanceIntentDigest,
  processStartIdentity,
  readTask,
  releaseLease,
  transitionTask,
  withOutcomeLedgerRepairFinalizationGuard,
} from "./lib/automation-control.mjs";
import {
  planOutcomeLedgerRepair,
  repairOutcomeLedger,
} from "./lib/outcome-ledger-repair.mjs";
import { OUTCOME_LEDGER_REPAIR_MAX_BYTES } from "./lib/outcome-ledger-repair-contract.mjs";
import {
  appendOutcomeLedger,
  summarizeOutcomeLedger,
} from "./nightly-self-improve.mjs";
import { writeMeasuredOutcomeVerdict } from "./test-helpers/outcome-evidence.mjs";
import { installAutomationKernelGuardCutoverFixture } from "./test-helpers/automation-kernel-guard.mjs";

const TASK_ID = "authenticated-essay-capture-pr-642";
const CLI_PATH = path.join(import.meta.dirname, "outcome-ledger-repair.mjs");
const MODULE_URL = pathToFileURL(
  path.join(import.meta.dirname, "lib", "outcome-ledger-repair.mjs"),
).href;
const NIGHTLY_MODULE_URL = pathToFileURL(
  path.join(import.meta.dirname, "nightly-self-improve.mjs"),
).href;
const CONTROL_MODULE_URL = pathToFileURL(
  path.join(import.meta.dirname, "lib", "automation-control.mjs"),
).href;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function temporaryStateRoot(t) {
  const stateRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-outcome-ledger-repair-")),
  );
  t.after(() => rmSync(stateRoot, { recursive: true, force: true }));
  installAutomationKernelGuardCutoverFixture(stateRoot);
  const paths = automationControlPaths(stateRoot);
  mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
  chmodSync(paths.controlRoot, 0o700);
  writeFileSync(paths.events, "", { mode: 0o600 });
  chmodSync(paths.events, 0o600);
  const nowMs = Date.now();
  const controller = actorLease(stateRoot, "freed-stability-controller", nowMs);
  createTask({
    stateRoot,
    taskId: TASK_ID,
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: true },
    nowMs: nowMs + 1_000,
  });
  releaseLease({
    stateRoot,
    name: controller.leaseName,
    operationId: leaseMutationId("release:initial-controller"),
    token: controller.leaseToken,
    nowMs: nowMs + 2_000,
  });
  return { stateRoot, paths };
}

function writeLedger(paths, bytes, mode = 0o644) {
  writeFileSync(paths.outcomes, bytes, { mode });
  chmodSync(paths.outcomes, mode);
  return sha256(bytes);
}

function legacyLine(id, newline = "\n") {
  return Buffer.from(
    `${JSON.stringify({
      ts: "2026-07-03T00:12:53.374Z",
      id,
      kind: "stability-task",
      outcome: "shipped",
      notes: "Legacy unauthenticated outcome.",
      pr: "901",
    })}${newline}`,
    "utf8",
  );
}

const repairSessions = new Map();
let ownerLeaseSequence = 0;
let leaseMutationSequence = 0;

function leaseMutationId(label) {
  leaseMutationSequence += 1;
  return sha256(`${label}:${leaseMutationSequence}`);
}

function ownerRepairLease(
  stateRoot,
  plan,
  { nowMs = Date.now(), ttlMs = 10 * 60_000, taskId = TASK_ID } = {},
) {
  ownerLeaseSequence += 1;
  const confirmationId = `owner-repair-confirmation-${ownerLeaseSequence}`;
  const confirmationPath = path.join(stateRoot, `${confirmationId}.json`);
  const confirmation = {
    schemaVersion: 1,
    kind: "owner-confirmation",
    confirmationId,
    approvedBy: "AubreyF",
    ownerApprovalReference:
      "Owner approved this exact isolated outcome ledger repair test intent.",
    approvalSource: { kind: "current-task", reference: taskId },
    taskId,
    intent: plan.intent,
    intentDigest: plan.intentDigest,
    approvedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + Math.max(ttlMs, 60_000) + 1_000).toISOString(),
  };
  writeFileSync(confirmationPath, `${JSON.stringify(confirmation)}\n`, {
    mode: 0o600,
  });
  const acquired = acquireLease({
    stateRoot,
    name: "owner-governance",
    owner: "freed-owner",
    operationId: leaseMutationId("acquire:freed-owner"),
    token: `outcome-repair-owner-token-${ownerLeaseSequence}-${"x".repeat(64)}`,
    ttlMs,
    nowMs: nowMs + 1,
    ownerConfirmationFile: confirmationPath,
    ownerCapabilityTaskId: taskId,
    ownerCapabilityIntentDigest: plan.intentDigest,
  });
  return {
    actor: "freed-owner",
    leaseName: "owner-governance",
    leaseToken: acquired.lease.token,
  };
}

function withLeaseAlmostExpired(
  stateRoot,
  leaseName,
  remainingMs,
  operation,
) {
  const recordPath = path.join(
    automationControlPaths(stateRoot).leases,
    `${leaseName}.lease`,
    "lease.json",
  );
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const expiresAtMs = Date.parse(record.expiresAt);
  assert.ok(Number.isFinite(expiresAtMs));
  const liveDateNow = Date.now;
  const startedAtMs = liveDateNow();
  Date.now = () =>
    Math.floor(expiresAtMs - remainingMs + (liveDateNow() - startedAtMs));
  try {
    return operation();
  } finally {
    Date.now = liveDateNow;
  }
}

function ensurePrivateDirectoryTree(stateRoot, target) {
  const relative = path.relative(stateRoot, target);
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
  );
  let current = stateRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    chmodSync(current, 0o700);
  }
}

function transactionRecordForPlan(plan, phase) {
  return {
    schemaVersion: 1,
    policy: "freed-outcome-ledger-repair-v1",
    taskId: plan.taskId,
    operationId: plan.operationId,
    phase,
    intentDigest: plan.intentDigest,
    eventId: plan.eventId,
    parameters: plan.parameters,
    receipt: plan.receipt,
    artifacts: {
      source: plan.artifacts.sourceArtifact,
      trusted: plan.artifacts.trustedArtifact,
      rejected: plan.artifacts.rejectedArtifact,
      decisions: plan.artifacts.decisionsArtifact,
      receipt: plan.artifacts.receiptArtifact,
    },
  };
}

function transactionBytesForPlan(plan, phase = "prepared") {
  return Buffer.from(
    `${JSON.stringify(transactionRecordForPlan(plan, phase), null, 2)}\n`,
    "utf8",
  );
}

function repairAuditEvents(paths, eventId) {
  return readFileSync(paths.events, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.eventId === eventId);
}

function completedLegacyRepair(t, id = "completed-health-fixture") {
  const fixture = temporaryStateRoot(t);
  const source = legacyLine(id);
  const sourceDigest = writeLedger(fixture.paths, source);
  const session = repairSession(fixture.stateRoot, sourceDigest);
  const result = executeRepair({ stateRoot: fixture.stateRoot, sourceDigest });
  assert.equal(result.changed, true);
  assert.equal(
    summarizeOutcomeLedger(fixture.paths.outcomes, {
      stateRoot: fixture.stateRoot,
    }).sourceHealth.ledgerHealthy,
    true,
  );
  return { ...fixture, source, sourceDigest, ...session };
}

function completedMixedRepair(t, id = "completed-mixed-fixture") {
  const fixture = temporaryStateRoot(t);
  trustedMergedOutcome(fixture.stateRoot);
  const trustedBytes = readFileSync(fixture.paths.outcomes);
  const rejectedBytes = legacyLine(id);
  appendFileSync(fixture.paths.outcomes, rejectedBytes);
  chmodSync(fixture.paths.outcomes, 0o644);
  const source = Buffer.concat([trustedBytes, rejectedBytes]);
  const sourceDigest = sha256(source);
  const session = repairSession(fixture.stateRoot, sourceDigest);
  const result = executeRepair({ stateRoot: fixture.stateRoot, sourceDigest });
  assert.equal(result.changed, true);
  return {
    ...fixture,
    source,
    sourceDigest,
    trustedBytes,
    rejectedBytes,
    ...session,
  };
}

function waitForReadyChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("READY\n")) resolve();
    });
    child.once("exit", (code, signal) => {
      if (!stdout.includes("READY\n")) {
        reject(
          new Error(
            `Lock holder exited before readiness, code=${code}, signal=${signal}: ${stderr}`,
          ),
        );
      }
    });
    child.once("error", reject);
  });
}

function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function spawnReadyChild(t, script, { env = {} } = {}) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  return child;
}

function summaryHealthInChild({ stateRoot, ledgerPath, field }) {
  const childScript = `
    import { summarizeOutcomeLedger } from ${JSON.stringify(NIGHTLY_MODULE_URL)};
    const summary = summarizeOutcomeLedger(
      ${JSON.stringify(ledgerPath)},
      { stateRoot: ${JSON.stringify(stateRoot)} },
    );
    if (summary.sourceHealth[${JSON.stringify(field)}] !== false) {
      console.error(JSON.stringify(summary.sourceHealth));
      process.exit(2);
    }
  `;
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", childScript],
    { encoding: "utf8", timeout: 2_000 },
  );
}

function rewriteCompletedRepair({
  stateRoot,
  paths,
  plan,
  sourceBytes = readFileSync(plan.artifacts.sourceArtifact),
  trustedBytes = readFileSync(plan.artifacts.trustedArtifact),
  rejectedBytes = readFileSync(plan.artifacts.rejectedArtifact),
  sourceLineCount = plan.parameters.sourceLineCount,
  trustedCount = plan.parameters.trustedCount,
  rejectedCount = plan.parameters.rejectedCount,
  decisionLines = undefined,
}) {
  const originalRecord = JSON.parse(
    readFileSync(plan.artifacts.transaction, "utf8"),
  );
  const originalDecisions = JSON.parse(
    readFileSync(plan.artifacts.decisionsArtifact, "utf8"),
  );
  const taskId = originalRecord.taskId;
  const sourceDigest = sha256(sourceBytes);
  const parameterBase = {
    ...originalRecord.parameters,
    sourceDigest,
    archiveDigest: sourceDigest,
    sourceSize: sourceBytes.length,
    sourceLineCount,
    trustedCount,
    rejectedCount,
    replacementDigest: sha256(trustedBytes),
    replacementSize: trustedBytes.length,
  };
  const decisionManifest = {
    ...originalDecisions,
    taskId,
    sourceDigest,
    sourceSize: sourceBytes.length,
    sourceLineCount,
    eventHistoryDigest: parameterBase.eventHistoryDigest,
    eventHistorySize: parameterBase.eventHistorySize,
    trustedCount,
    rejectedCount,
    replacementDigest: parameterBase.replacementDigest,
    replacementSize: parameterBase.replacementSize,
    lines: decisionLines ?? originalDecisions.lines,
  };
  const decisionBytes = Buffer.from(
    `${JSON.stringify(decisionManifest, null, 2)}\n`,
    "utf8",
  );
  parameterBase.decisionsDigest = sha256(decisionBytes);
  const operationSeed = {
    schemaVersion: parameterBase.schemaVersion,
    policy: parameterBase.policy,
    stateRoot: parameterBase.stateRoot,
    ledgerPath: parameterBase.ledgerPath,
    taskId,
    sourceDigest: parameterBase.sourceDigest,
    sourceSize: parameterBase.sourceSize,
    sourceLineCount: parameterBase.sourceLineCount,
    eventHistoryDigest: parameterBase.eventHistoryDigest,
    eventHistorySize: parameterBase.eventHistorySize,
    trustedCount: parameterBase.trustedCount,
    rejectedCount: parameterBase.rejectedCount,
    replacementDigest: parameterBase.replacementDigest,
    replacementSize: parameterBase.replacementSize,
    decisionsDigest: parameterBase.decisionsDigest,
  };
  const operationId = sha256(stableJson(operationSeed));
  parameterBase.operationId = operationId;
  const artifactDirectory = path.join(
    stateRoot,
    "artifacts",
    "outcome-ledger-repair",
    taskId,
    sourceDigest,
    operationId,
  );
  const artifacts = {
    source: path.join(artifactDirectory, `source-${sourceDigest}.jsonl`),
    trusted: path.join(artifactDirectory, "trusted.jsonl"),
    rejected: path.join(artifactDirectory, "rejected.jsonl"),
    decisions: path.join(artifactDirectory, "decisions.json"),
    receipt: path.join(artifactDirectory, "receipt.json"),
  };
  const eventId = `outcome-history-repaired:${operationId}`;
  const receiptCore = {
    schemaVersion: 1,
    policy: "freed-outcome-ledger-repair-v1",
    status: "complete",
    taskId,
    operationId,
    eventId,
    stateRoot: parameterBase.stateRoot,
    ledgerPath: parameterBase.ledgerPath,
    sourceArtifact: artifacts.source,
    trustedArtifact: artifacts.trusted,
    rejectedArtifact: artifacts.rejected,
    decisionsArtifact: artifacts.decisions,
    sourceDigest: parameterBase.sourceDigest,
    sourceSize: parameterBase.sourceSize,
    sourceLineCount: parameterBase.sourceLineCount,
    eventHistoryDigest: parameterBase.eventHistoryDigest,
    eventHistorySize: parameterBase.eventHistorySize,
    trustedCount: parameterBase.trustedCount,
    rejectedCount: parameterBase.rejectedCount,
    replacementDigest: parameterBase.replacementDigest,
    replacementSize: parameterBase.replacementSize,
    archiveDigest: parameterBase.archiveDigest,
    decisionsDigest: parameterBase.decisionsDigest,
  };
  const receiptDigest = sha256(stableJson(receiptCore));
  const parameters = { ...parameterBase, receiptDigest };
  const receipt = { ...receiptCore, receiptDigest };
  const intent = {
    schemaVersion: 1,
    action: "outcome-ledger.repair",
    taskId,
    parameters,
  };
  const intentDigest = ownerGovernanceIntentDigest(intent);

  ensurePrivateDirectoryTree(stateRoot, artifactDirectory);
  for (const [filePath, bytes] of [
    [artifacts.source, sourceBytes],
    [artifacts.trusted, trustedBytes],
    [artifacts.rejected, rejectedBytes],
    [artifacts.decisions, decisionBytes],
    [
      artifacts.receipt,
      Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
    ],
  ]) {
    writeFileSync(filePath, bytes, { mode: 0o600 });
    chmodSync(filePath, 0o600);
  }

  const eventText = readFileSync(paths.events, "utf8");
  let matchingEventCount = 0;
  const rewrittenEventLines = eventText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const event = JSON.parse(line);
      if (event.eventId !== originalRecord.eventId) return line;
      matchingEventCount += 1;
      event.eventId = eventId;
      event.data.intentDigest = intentDigest;
      event.data.parameters = parameters;
      const authorization = event.data.authorization;
      if (authorization.credentialKind === "owner-confirmation") {
        authorization.ownerConfirmationIntentDigest = intentDigest;
      } else {
        authorization.ownerCapabilityIntentDigest = intentDigest;
      }
      return JSON.stringify(event);
    });
  assert.equal(matchingEventCount, 1);
  writeFileSync(paths.events, `${rewrittenEventLines.join("\n")}\n`, {
    mode: 0o600,
  });
  chmodSync(paths.events, 0o600);

  const transaction = {
    ...originalRecord,
    taskId,
    operationId,
    eventId,
    intentDigest,
    parameters,
    receipt,
    artifacts,
  };
  const transactionPath = path.join(
    plan.artifacts.transactionDirectory,
    `${operationId}.json`,
  );
  writeFileSync(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(transactionPath, 0o600);
  if (transactionPath !== plan.artifacts.transaction) {
    rmSync(plan.artifacts.transaction);
  }
  if (artifactDirectory !== plan.artifacts.artifactDirectory) {
    rmSync(plan.artifacts.artifactDirectory, { recursive: true, force: true });
  }
  return {
    artifactDirectory,
    artifacts,
    eventId,
    intent,
    intentDigest,
    operationId,
    parameters,
    receipt,
    transaction,
    transactionPath,
  };
}

function repairSession(stateRoot, sourceDigest) {
  const key = `${stateRoot}:${sourceDigest}`;
  let session = repairSessions.get(key);
  if (!session) {
    const plan = planOutcomeLedgerRepair({
      stateRoot,
      taskId: TASK_ID,
      expectedSourceDigest: sourceDigest,
    });
    session = { plan, owner: ownerRepairLease(stateRoot, plan) };
    repairSessions.set(key, session);
  }
  return session;
}

function executeRepair(
  { stateRoot, sourceDigest },
  { checkpoint = () => {}, owner = undefined } = {},
) {
  const session = repairSession(stateRoot, sourceDigest);
  return repairOutcomeLedger(
    {
      stateRoot,
      taskId: TASK_ID,
      expectedSourceDigest: sourceDigest,
      ...(owner ?? session.owner),
    },
    { checkpoint },
  );
}

function leaveRepairReplaced(t, label) {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine(label);
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);
  assert.throws(
    () =>
      repairOutcomeLedger(
        {
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
          ...owner,
        },
        {
          checkpoint: (checkpoint) => {
            if (checkpoint === "transaction-replaced") {
              throw new Error(`leave ${label} unaudited`);
            }
          },
        },
      ),
    new RegExp(`leave ${label} unaudited`),
  );
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "replaced",
  );
  return { stateRoot, paths, sourceDigest, plan, owner };
}

function writeActorCredential(stateRoot, actor) {
  const token = `credential:${actor}:${"x".repeat(64)}`;
  const credentialPath = path.join(
    automationControlPaths(stateRoot).actorCredentials,
    `${actor}.json`,
  );
  mkdirSync(path.dirname(credentialPath), { recursive: true, mode: 0o700 });
  writeFileSync(
    credentialPath,
    `${JSON.stringify({
      schemaVersion: 1,
      actor,
      purpose: "automation-actor-lease",
      tokenSha256: sha256(token),
    })}\n`,
    { mode: 0o600 },
  );
  return token;
}

function actorLease(stateRoot, actor, nowMs) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const token = `${actor}:${nowMs}`;
  const currentTimeMs = Date.now();
  const leaseNowMs =
    nowMs >= currentTimeMs - 1_000 ? nowMs : currentTimeMs;
  acquireLease({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    operationId: leaseMutationId(`acquire:${actor}`),
    token,
    actorCredentialToken: writeActorCredential(stateRoot, actor),
    nowMs: leaseNowMs,
    ttlMs: policy.maxLeaseLifetimeMs,
  });
  return {
    actor,
    leaseName: policy.leaseName,
    leaseToken: token,
  };
}

function prepareValidatedTask(stateRoot, startMs = Date.now()) {
  const controller = actorLease(
    stateRoot,
    "freed-stability-controller",
    startMs,
  );
  const nightly = actorLease(stateRoot, "freed-nightly-runner", startMs);
  for (const [index, [toState, authentication]] of [
    ["triaged", controller],
    ["approved_for_pr", controller],
    ["implemented", nightly],
    ["validated", nightly],
  ].entries()) {
    transitionTask({
      stateRoot,
      taskId: TASK_ID,
      ...authentication,
      toState,
      nowMs: startMs + (index + 1) * 1_000,
    });
  }
  return { nightly, nowMs: startMs + 10_000 };
}

function validatedOutcomeFixture(t) {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const { nightly, nowMs } = prepareValidatedTask(stateRoot);
  return {
    stateRoot,
    paths,
    authentication: nightly,
    now: new Date(nowMs + 10_000),
    entry: {
      id: TASK_ID,
      taskId: TASK_ID,
      kind: "stability",
      outcome: "merged",
      evidenceDigest: "a".repeat(64),
    },
  };
}

function verificationOutcomeFixture(t, label) {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const { nightly, nowMs } = trustedMergedOutcome(stateRoot);
  const installedIdentity = {
    version: "26.7.1800",
    commitSha: "b".repeat(40),
    channel: "dev",
  };
  appendOutcomeLedger(
    paths.outcomes,
    {
      id: TASK_ID,
      taskId: TASK_ID,
      kind: "stability",
      outcome: "installed",
      installedIdentity,
      evidenceDigest: "c".repeat(64),
    },
    {
      stateRoot,
      authentication: nightly,
      now: new Date(nowMs + 60_000),
    },
  );
  transitionTask({
    stateRoot,
    taskId: TASK_ID,
    ...nightly,
    toState: "soaking",
    nowMs: nowMs + 120_000,
  });
  const evidenceWindowStartMs = nowMs + 121_000;
  const evidenceWindowEndMs = evidenceWindowStartMs + 6 * 60 * 60_000;
  const appendNow = new Date(evidenceWindowEndMs + 60_000);
  const verifier = actorLease(
    stateRoot,
    "freed-release-verifier",
    appendNow.getTime() - 1_000,
  );
  const evidenceWindowEnd = new Date(evidenceWindowEndMs).toISOString();
  const { verdictPath } = writeMeasuredOutcomeVerdict(stateRoot, {
    taskId: TASK_ID,
    version: installedIdentity.version,
    commitSha: installedIdentity.commitSha,
    channel: installedIdentity.channel,
    windowEnd: evidenceWindowEnd,
    outcome: "inconclusive",
    sourceStartMs: evidenceWindowStartMs,
  });
  return {
    stateRoot,
    paths,
    authentication: verifier,
    now: appendNow,
    entry: {
      id: TASK_ID,
      taskId: TASK_ID,
      kind: "stability",
      outcome: "inconclusive",
      notes: `checkpoint ${label}`,
      evidenceWindowEnd,
      verdictReference: verdictPath,
    },
  };
}

function parsedEvents(paths) {
  return readFileSync(paths.events, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function flatDirectorySnapshot(directoryPath) {
  if (!existsSync(directoryPath)) return { exists: false, entries: [] };
  return {
    exists: true,
    entries: readdirSync(directoryPath)
      .sort()
      .map((name) => ({
        name,
        bytes: readFileSync(path.join(directoryPath, name)),
      })),
  };
}

function appendJsonPaddingToSize(filePath, targetSize, type) {
  const currentSize = statSync(filePath).size;
  const totalPadding = targetSize - currentSize;
  assert.ok(totalPadding > 0);
  const prefix = Buffer.from(
    `{"type":${JSON.stringify(type)},"payload":"`,
    "utf8",
  );
  const suffix = Buffer.from('"}\n', "utf8");
  const minimumLineSize = prefix.length + suffix.length;
  const maximumLineSize = 512 * 1024;
  const chunks = [];
  let remaining = totalPadding;
  while (remaining > 0) {
    let lineSize = Math.min(maximumLineSize, remaining);
    const nextRemainder = remaining - lineSize;
    if (nextRemainder > 0 && nextRemainder < minimumLineSize) {
      lineSize -= minimumLineSize - nextRemainder;
    }
    assert.ok(lineSize >= minimumLineSize);
    chunks.push(
      Buffer.concat(
        [prefix, Buffer.alloc(lineSize - minimumLineSize, 0x78), suffix],
        lineSize,
      ),
    );
    remaining -= lineSize;
  }
  appendFileSync(filePath, Buffer.concat(chunks, totalPadding));
  assert.equal(statSync(filePath).size, targetSize);
}

function outcomeMutationSnapshot(stateRoot, paths) {
  return {
    manifest: readFileSync(paths.taskManifest),
    events: readFileSync(paths.events),
    ledger: readFileSync(paths.outcomes),
    task: readTask({ stateRoot, taskId: TASK_ID }),
    taskTransactions: flatDirectorySnapshot(paths.taskTransactions),
  };
}

function assertOutcomeMutationSnapshot(stateRoot, paths, expected) {
  assert.equal(
    readFileSync(paths.taskManifest).equals(expected.manifest),
    true,
  );
  assert.equal(readFileSync(paths.events).equals(expected.events), true);
  assert.equal(readFileSync(paths.outcomes).equals(expected.ledger), true);
  assert.deepEqual(readTask({ stateRoot, taskId: TASK_ID }), expected.task);
  assert.deepEqual(
    flatDirectorySnapshot(paths.taskTransactions),
    expected.taskTransactions,
  );
}

function trustedMergedOutcome(
  stateRoot,
  startMs = Date.now(),
) {
  const controller = actorLease(
    stateRoot,
    "freed-stability-controller",
    startMs,
  );
  const nightly = actorLease(stateRoot, "freed-nightly-runner", startMs);
  if (!readTask({ stateRoot, taskId: TASK_ID, nowMs: startMs + 1_000 })) {
    createTask({
      stateRoot,
      taskId: TASK_ID,
      ...controller,
      observerAuthority: "merge-safe",
      providerAuthority: "forbidden",
      details: { behavioral: true },
      nowMs: startMs + 1_000,
    });
  }
  for (const [index, [toState, authentication]] of [
    ["triaged", controller],
    ["approved_for_pr", controller],
    ["implemented", nightly],
    ["validated", nightly],
  ].entries()) {
    transitionTask({
      stateRoot,
      taskId: TASK_ID,
      ...authentication,
      toState,
      nowMs: startMs + (index + 2) * 1_000,
    });
  }
  appendOutcomeLedger(
    automationControlPaths(stateRoot).outcomes,
    {
      id: TASK_ID,
      taskId: TASK_ID,
      kind: "stability",
      outcome: "merged",
      evidenceDigest: "a".repeat(64),
    },
    {
      stateRoot,
      authentication: nightly,
      now: new Date(startMs + 10_000),
    },
  );
  return { nightly, nowMs: startMs + 10_000 };
}

test("plans a 0644 legacy ledger without mutating canonical state", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = Buffer.concat([
    legacyLine("W1-04"),
    legacyLine("W1-05", "\r\n"),
    legacyLine("W1-06", ""),
  ]);
  const sourceDigest = writeLedger(paths, source, 0o644);

  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });

  assert.equal(plan.parameters.sourceDigest, sourceDigest);
  assert.equal(plan.parameters.sourceSize, source.length);
  assert.equal(plan.parameters.sourceLineCount, 3);
  assert.equal(plan.parameters.trustedCount, 0);
  assert.equal(plan.parameters.rejectedCount, 3);
  assert.equal(plan.parameters.replacementDigest, sha256(Buffer.alloc(0)));
  assert.equal(plan.parameters.replacementSize, 0);
  assert.equal(readFileSync(paths.outcomes).equals(source), true);
  assert.equal(existsSync(plan.artifacts.sourceArtifact), false);
  assert.equal(existsSync(plan.artifacts.transaction), false);
});

test("source ledger mode admission accepts only the explicit compatibility matrix", async (t) => {
  for (const mode of [0o600, 0o640, 0o644]) {
    await t.test(`accepts ${mode.toString(8)}`, (t) => {
      const { stateRoot, paths } = temporaryStateRoot(t);
      const source = legacyLine(`accepted-mode-${mode.toString(8)}`);
      const sourceDigest = writeLedger(paths, source, mode);

      const plan = planOutcomeLedgerRepair({
        stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
      });

      assert.equal(plan.parameters.sourceDigest, sourceDigest);
      assert.equal(plan.parameters.sourceSize, source.length);
      assert.equal(statSync(paths.outcomes).mode & 0o7777, mode);
      assert.equal(readFileSync(paths.outcomes).equals(source), true);
      assert.equal(existsSync(plan.artifacts.artifactDirectory), false);
      assert.equal(existsSync(plan.artifacts.transactionDirectory), false);
    });
  }

  for (const mode of [0o755, 0o4644]) {
    await t.test(`rejects ${mode.toString(8)}`, (t) => {
      const { stateRoot, paths } = temporaryStateRoot(t);
      const source = legacyLine(`rejected-mode-${mode.toString(8)}`);
      const sourceDigest = writeLedger(paths, source, mode);
      assert.equal(statSync(paths.outcomes).mode & 0o7777, mode);

      assert.throws(
        () =>
          planOutcomeLedgerRepair({
            stateRoot,
            taskId: TASK_ID,
            expectedSourceDigest: sourceDigest,
          }),
        /Unsafe outcome ledger repair file/,
      );

      assert.equal(statSync(paths.outcomes).mode & 0o7777, mode);
      assert.equal(readFileSync(paths.outcomes).equals(source), true);
      assert.equal(
        existsSync(
          path.join(paths.controlRoot, "outcome-ledger-transactions"),
        ),
        false,
      );
      assert.equal(
        existsSync(path.join(stateRoot, "artifacts", "outcome-ledger-repair")),
        false,
      );
    });
  }
});

test("owner repair preserves a planned event prefix without a trailing newline", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("owner-prefix-without-final-newline");
  const sourceDigest = writeLedger(paths, source);
  const eventsWithNewline = readFileSync(paths.events);
  assert.equal(eventsWithNewline.at(-1), 0x0a);
  const plannedEventPrefix = eventsWithNewline.subarray(
    0,
    eventsWithNewline.length - 1,
  );
  writeFileSync(paths.events, plannedEventPrefix, { mode: 0o600 });

  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  assert.equal(plan.parameters.eventHistorySize, plannedEventPrefix.length);
  assert.equal(plan.parameters.eventHistoryDigest, sha256(plannedEventPrefix));
  const owner = ownerRepairLease(stateRoot, plan);
  const eventsAfterLease = readFileSync(paths.events);
  assert.equal(
    eventsAfterLease
      .subarray(0, plannedEventPrefix.length)
      .equals(plannedEventPrefix),
    true,
  );
  assert.equal(eventsAfterLease[plannedEventPrefix.length], 0x0a);

  const result = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...owner,
  });

  assert.equal(result.changed, true);
  assert.equal(readFileSync(paths.outcomes).length, 0);
  assert.equal(readFileSync(plan.artifacts.sourceArtifact).equals(source), true);
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
  assert.equal(
    readFileSync(paths.events)
      .subarray(0, plannedEventPrefix.length)
      .equals(plannedEventPrefix),
    true,
  );
});

test("control CLI exposes read-only plan and owner-governed repair", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  trustedMergedOutcome(stateRoot);
  const sourceBytes = readFileSync(paths.outcomes);
  const sourceDigest = sha256(sourceBytes);

  const planRun = spawnSync(
    process.execPath,
    [
      CLI_PATH,
      "plan",
      "--state-root",
      stateRoot,
      "--task-id",
      TASK_ID,
      "--source-digest",
      sourceDigest,
    ],
    { encoding: "utf8" },
  );
  assert.equal(planRun.status, 0, planRun.stderr);
  const planPayload = JSON.parse(planRun.stdout);
  assert.equal(planPayload.ok, true);
  assert.equal(planPayload.action, "outcome-ledger.plan");
  assert.equal(planPayload.result.parameters.sourceDigest, sourceDigest);
  assert.equal(readFileSync(paths.outcomes).equals(sourceBytes), true);

  const repairRun = spawnSync(
    process.execPath,
    [
      CLI_PATH,
      "repair",
      "--state-root",
      stateRoot,
      "--task-id",
      TASK_ID,
      "--source-digest",
      sourceDigest,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        FREED_AUTOMATION_LEASE_TOKEN: "invalid-owner-lease",
      },
    },
  );
  assert.equal(repairRun.status, 1);
  const repairPayload = JSON.parse(repairRun.stderr);
  assert.equal(repairPayload.ok, false);
  assert.equal(readFileSync(paths.outcomes).equals(sourceBytes), true);
  assert.equal(
    existsSync(path.join(paths.controlRoot, "outcome-ledger-transactions")),
    false,
  );

  const owner = ownerRepairLease(stateRoot, planPayload.result);
  const successfulRepair = spawnSync(
    process.execPath,
    [
      CLI_PATH,
      "repair",
      "--state-root",
      stateRoot,
      "--task-id",
      TASK_ID,
      "--source-digest",
      sourceDigest,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        FREED_AUTOMATION_LEASE_TOKEN: owner.leaseToken,
      },
    },
  );
  assert.equal(successfulRepair.status, 0, successfulRepair.stderr);
  const successfulPayload = JSON.parse(successfulRepair.stdout);
  assert.equal(successfulPayload.ok, true);
  assert.equal(successfulPayload.action, "outcome-ledger.repair");
  assert.equal(successfulPayload.result.changed, true);
  assert.equal(readFileSync(paths.outcomes).equals(sourceBytes), true);
});

test("dedicated repair CLI top-level help succeeds", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /outcome-ledger-repair\.mjs plan/);
  assert.match(result.stdout, /outcome-ledger-repair\.mjs repair/);
});

test("repair preserves exact physical source and rejected bytes", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = Buffer.concat([
    legacyLine("W1-04"),
    legacyLine("W1-05", "\r\n"),
    legacyLine("W1-06", ""),
  ]);
  const sourceDigest = writeLedger(paths, source, 0o644);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });

  const result = executeRepair({ stateRoot, sourceDigest });

  assert.equal(result.changed, true);
  assert.equal(readFileSync(paths.outcomes).length, 0);
  assert.equal(
    readFileSync(plan.artifacts.sourceArtifact).equals(source),
    true,
  );
  assert.equal(
    readFileSync(plan.artifacts.rejectedArtifact).equals(source),
    true,
  );
  assert.equal(readFileSync(plan.artifacts.trustedArtifact).length, 0);
  const decisions = JSON.parse(
    readFileSync(plan.artifacts.decisionsArtifact, "utf8"),
  );
  assert.deepEqual(
    decisions.lines.map(({ lineNumber, offset, length, disposition }) => ({
      lineNumber,
      offset,
      length,
      disposition,
    })),
    [
      {
        lineNumber: 1,
        offset: 0,
        length: legacyLine("W1-04").length,
        disposition: "rejected",
      },
      {
        lineNumber: 2,
        offset: legacyLine("W1-04").length,
        length: legacyLine("W1-05", "\r\n").length,
        disposition: "rejected",
      },
      {
        lineNumber: 3,
        offset: legacyLine("W1-04").length + legacyLine("W1-05", "\r\n").length,
        length: legacyLine("W1-06", "").length,
        disposition: "rejected",
      },
    ],
  );
});

test("repair retains authenticated lines byte for byte and later appends survive retry", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const { nightly, nowMs } = trustedMergedOutcome(stateRoot);
  const trustedBytes = readFileSync(paths.outcomes);
  const rejectedBytes = legacyLine("legacy-after-trusted", "\r\n");
  appendFileSync(paths.outcomes, rejectedBytes);
  chmodSync(paths.outcomes, 0o644);
  const sourceBytes = Buffer.concat([trustedBytes, rejectedBytes]);
  const sourceDigest = sha256(sourceBytes);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });

  assert.equal(plan.parameters.trustedCount, 1);
  assert.equal(plan.parameters.rejectedCount, 1);
  executeRepair({ stateRoot, sourceDigest });

  assert.equal(readFileSync(paths.outcomes).equals(trustedBytes), true);
  assert.equal(
    readFileSync(plan.artifacts.sourceArtifact).equals(sourceBytes),
    true,
  );
  assert.equal(
    readFileSync(plan.artifacts.trustedArtifact).equals(trustedBytes),
    true,
  );
  assert.equal(
    readFileSync(plan.artifacts.rejectedArtifact).equals(rejectedBytes),
    true,
  );

  appendOutcomeLedger(
    paths.outcomes,
    {
      id: TASK_ID,
      taskId: TASK_ID,
      kind: "stability",
      outcome: "installed",
      evidenceDigest: "c".repeat(64),
      installedIdentity: {
        version: "26.7.1800",
        commitSha: "b".repeat(40),
        channel: "dev",
      },
    },
    {
      stateRoot,
      authentication: nightly,
      now: new Date(nowMs + 60_000),
    },
  );
  const afterAuthenticatedAppend = readFileSync(paths.outcomes);
  assert.ok(afterAuthenticatedAppend.length > trustedBytes.length);
  assert.equal(
    summarizeOutcomeLedger(paths.outcomes, { stateRoot }).sourceHealth
      .ledgerHealthy,
    true,
  );

  const retry = executeRepair({ stateRoot, sourceDigest });
  assert.equal(retry.changed, false);
  assert.equal(
    readFileSync(paths.outcomes).equals(afterAuthenticatedAppend),
    true,
  );
});

test("pre-hardening ordinary outcome remains trusted and byte exact through repair", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  prepareValidatedTask(
    stateRoot,
    Date.parse("2026-07-18T08:00:00.000Z"),
  );

  // These three rows are deliberately frozen literals. Building them through
  // the current writer would erase the compatibility contract under test.
  const transitionLine = Buffer.from(
    '{"schemaVersion":1,"eventId":"11111111-2222-4333-8444-555555555555","type":"task_transitioned","ts":"2026-07-18T08:00:20.000Z","actor":"freed-nightly-runner","taskId":"authenticated-essay-capture-pr-642","taskRevision":6,"manifestRevision":6,"observerAuthority":"merge-safe","providerAuthority":"forbidden","data":{"fromState":"validated","toState":"merged","authorizationProvenance":{"leaseName":"nightly-writer","leaseAcquiredAt":"2026-07-18T08:00:00.000Z","credentialKind":"actor-credential"},"outcomeDigest":"07183438d93892d47c2e8c99cd32490d50389fe448208ff7b5450b3930cfb60f","mergedAt":"2026-07-18T08:00:20.000Z"}}\n',
    "utf8",
  );
  const outcomeEventLine = Buffer.from(
    '{"schemaVersion":1,"eventId":"outcome-recorded:16759d03db51dced7164ef0aaf9a9f53677010363b996a8cefb7ae54a2c5d9ea","type":"outcome_recorded","ts":"2026-07-18T08:00:20.000Z","actor":"freed-nightly-runner","taskId":"authenticated-essay-capture-pr-642","data":{"id":"legacy-authenticated-ordinary-outcome","taskId":"authenticated-essay-capture-pr-642","taskRevision":6,"taskState":"merged","kind":"stability","outcome":"merged","ledgerPath":"__OUTCOME_LEDGER_PATH__","leaseName":"nightly-writer","evidence":{"digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"outcomeDigest":"07183438d93892d47c2e8c99cd32490d50389fe448208ff7b5450b3930cfb60f","transitionEventId":"11111111-2222-4333-8444-555555555555"}}\n'.replace(
      '"__OUTCOME_LEDGER_PATH__"',
      JSON.stringify(paths.outcomes),
    ),
    "utf8",
  );
  const ledgerLine = Buffer.from(
    '{"schemaVersion":3,"ts":"2026-07-18T08:00:20.000Z","id":"legacy-authenticated-ordinary-outcome","taskId":"authenticated-essay-capture-pr-642","kind":"stability","outcome":"merged","notes":"Pre-hardening authenticated ordinary outcome.","evidence":{"digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"authentication":{"actor":"freed-nightly-runner","leaseName":"nightly-writer","controlEventId":"outcome-recorded:16759d03db51dced7164ef0aaf9a9f53677010363b996a8cefb7ae54a2c5d9ea","transitionEventId":"11111111-2222-4333-8444-555555555555","outcomeDigest":"07183438d93892d47c2e8c99cd32490d50389fe448208ff7b5450b3930cfb60f","taskRevision":6}}\n',
    "utf8",
  );

  const transition = JSON.parse(transitionLine.toString("utf8"));
  const outcomeEvent = JSON.parse(outcomeEventLine.toString("utf8"));
  const ledgerEntry = JSON.parse(ledgerLine.toString("utf8"));
  assert.equal(Object.hasOwn(transition.data, "outcomeRequired"), false);
  assert.equal(
    outcomeEvent.data.outcomeDigest,
    ledgerEntry.authentication.outcomeDigest,
  );
  assert.equal(
    outcomeEvent.data.transitionEventId,
    transition.eventId,
  );
  const { authentication: _authentication, ...digestibleEntry } = ledgerEntry;
  assert.equal(
    sha256(JSON.stringify(digestibleEntry)),
    ledgerEntry.authentication.outcomeDigest,
  );

  const manifest = JSON.parse(readFileSync(paths.taskManifest, "utf8"));
  const task = manifest.tasks.find((candidate) => candidate.taskId === TASK_ID);
  assert.equal(task.state, "validated");
  assert.equal(task.revision, 5);
  task.state = "merged";
  task.revision = 6;
  task.updatedAt = ledgerEntry.ts;
  task.mergedAt = ledgerEntry.ts;
  task.details = {
    ...task.details,
    latestOutcome: {
      outcome: ledgerEntry.outcome,
      evidence: ledgerEntry.evidence,
      evidenceWindowEnd: null,
      build: null,
      buildIdentity: null,
      installedIdentity: null,
      outcomeDigest: ledgerEntry.authentication.outcomeDigest,
      recordedAt: ledgerEntry.ts,
    },
  };
  delete task.pendingOutcome;
  manifest.revision += 1;
  manifest.updatedAt = ledgerEntry.ts;
  writeFileSync(paths.taskManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  appendFileSync(paths.events, Buffer.concat([transitionLine, outcomeEventLine]));
  const sourceDigest = writeLedger(paths, ledgerLine, 0o600);

  const summary = summarizeOutcomeLedger(paths.outcomes, { stateRoot });
  assert.equal(summary.sourceHealth.ledgerHealthy, true);
  assert.deepEqual(summary.entries, [ledgerEntry]);
  assert.deepEqual(summary.rejectedEntries, []);

  const eventsBeforePlan = readFileSync(paths.events);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  assert.equal(plan.parameters.trustedCount, 1);
  assert.equal(plan.parameters.rejectedCount, 0);
  assert.equal(plan.parameters.replacementDigest, sourceDigest);
  assert.equal(plan.parameters.replacementSize, ledgerLine.length);
  assert.equal(plan.parameters.eventHistoryDigest, sha256(eventsBeforePlan));
  assert.equal(plan.parameters.eventHistorySize, eventsBeforePlan.length);
  assert.equal(readFileSync(paths.outcomes).equals(ledgerLine), true);
  assert.equal(readFileSync(paths.events).equals(eventsBeforePlan), true);

  const result = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...ownerRepairLease(stateRoot, plan),
  });
  assert.equal(result.changed, true);
  assert.equal(readFileSync(paths.outcomes).equals(ledgerLine), true);
  assert.equal(
    readFileSync(paths.events)
      .subarray(0, eventsBeforePlan.length)
      .equals(eventsBeforePlan),
    true,
  );
  assert.equal(
    readFileSync(plan.artifacts.sourceArtifact).equals(ledgerLine),
    true,
  );
  assert.equal(
    readFileSync(plan.artifacts.trustedArtifact).equals(ledgerLine),
    true,
  );
  assert.equal(readFileSync(plan.artifacts.rejectedArtifact).length, 0);

  const repairedSummary = summarizeOutcomeLedger(paths.outcomes, {
    stateRoot,
  });
  assert.equal(repairedSummary.sourceHealth.ledgerHealthy, true);
  assert.deepEqual(repairedSummary.entries, [ledgerEntry]);
  assert.deepEqual(repairedSummary.rejectedEntries, []);
});

test("repair is exactly idempotent for a completed legacy-only operation", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("legacy-idempotent");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });

  const first = executeRepair({ stateRoot, sourceDigest });
  const receiptBytes = readFileSync(plan.artifacts.receiptArtifact);
  const transactionBytes = readFileSync(plan.artifacts.transaction);
  const second = executeRepair({ stateRoot, sourceDigest });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(
    readFileSync(plan.artifacts.receiptArtifact).equals(receiptBytes),
    true,
  );
  assert.equal(
    readFileSync(plan.artifacts.transaction).equals(transactionBytes),
    true,
  );
  assert.equal(readFileSync(paths.outcomes).length, 0);
});

test("source digest and event history drift fail before replacement", async (t) => {
  await t.test("source digest drift", () => {
    const fixture = temporaryStateRoot(t);
    const source = legacyLine("source-drift");
    const sourceDigest = writeLedger(fixture.paths, source);
    assert.throws(
      () =>
        executeRepair(
          { stateRoot: fixture.stateRoot, sourceDigest },
          {
            checkpoint: (checkpoint) => {
              if (checkpoint !== "owner-preauthorized") return;
              appendFileSync(fixture.paths.outcomes, legacyLine("late-line"));
            },
          },
        ),
      /source digest changed/,
    );
    assert.equal(
      readFileSync(fixture.paths.outcomes).equals(
        Buffer.concat([source, legacyLine("late-line")]),
      ),
      true,
    );
  });

  await t.test("event history drift", () => {
    const fixture = temporaryStateRoot(t);
    const source = legacyLine("event-drift");
    const sourceDigest = writeLedger(fixture.paths, source);
    const session = repairSession(fixture.stateRoot, sourceDigest);
    assert.throws(
      () =>
        executeRepair(
          { stateRoot: fixture.stateRoot, sourceDigest },
          {
            checkpoint: (checkpoint) => {
              if (checkpoint !== "owner-preauthorized") return;
              const events = readFileSync(fixture.paths.events);
              const prefix = events.subarray(
                0,
                session.plan.parameters.eventHistorySize,
              );
              const marker = Buffer.from("lease_acquired", "utf8");
              const markerOffset = prefix.indexOf(marker);
              assert.ok(markerOffset >= 0);
              events[markerOffset] = "m".charCodeAt(0);
              writeFileSync(fixture.paths.events, events, { mode: 0o600 });
            },
          },
        ),
      /prefix drifted|classification drifted/,
    );
    assert.equal(readFileSync(fixture.paths.outcomes).equals(source), true);
  });
});

test("failed owner authority creates no repair artifacts or replacement", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("authority-blocked");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });

  assert.throws(
    () =>
      repairOutcomeLedger(
        {
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
          actor: "freed-owner",
          leaseName: "owner-governance",
          leaseToken: "invalid-owner-lease",
        },
        {
          preauthorize: () => ({ bypassed: true }),
          appendEvent: () => ({ bypassed: true }),
        },
      ),
    /lease|authorized|missing/i,
  );
  assert.equal(readFileSync(paths.outcomes).equals(source), true);
  assert.equal(existsSync(plan.artifacts.artifactDirectory), false);
  assert.equal(existsSync(plan.artifacts.transactionDirectory), false);
});

test("owner lease expiry while waiting on a live outcome writer lock leaves no repair state", async (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("writer-lock-owner-expiry");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);
  const lockHolder = spawnReadyChild(
    t,
    `
      import { withOutcomeLedgerWriterLock } from ${JSON.stringify(NIGHTLY_MODULE_URL)};
      const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
      withOutcomeLedgerWriterLock(${JSON.stringify(paths.outcomes)}, () => {
        process.stdout.write("READY\\n");
        Atomics.wait(signal, 0, 0, 1_000);
      });
    `,
  );
  await waitForReadyChild(lockHolder);

  assert.throws(
    () =>
      withLeaseAlmostExpired(
        stateRoot,
        owner.leaseName,
        500,
        () =>
          repairOutcomeLedger({
            stateRoot,
            taskId: TASK_ID,
            expectedSourceDigest: sourceDigest,
            ...owner,
          }),
      ),
    /lease.*expired|expired.*lease/i,
  );
  const holderExit = await waitForChildExit(lockHolder);
  assert.equal(holderExit.code, 0);
  assert.equal(holderExit.signal, null);
  assert.equal(readFileSync(paths.outcomes).equals(source), true);
  assert.equal(existsSync(plan.artifacts.artifactDirectory), false);
  assert.equal(existsSync(plan.artifacts.transactionDirectory), false);
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
});

test("a repair waiter reacquires completed state under the writer lock", async (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("two-repair-writers-complete");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const firstOwner = ownerRepairLease(stateRoot, plan);
  const firstWriter = spawnReadyChild(
    t,
    `
      import { repairOutcomeLedger } from ${JSON.stringify(MODULE_URL)};
      const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
      repairOutcomeLedger(
        ${JSON.stringify({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
          ...firstOwner,
        })},
        {
          checkpoint: (checkpoint) => {
            if (checkpoint === "receipt-written") {
              process.stdout.write("READY\\n");
              Atomics.wait(signal, 0, 0, 900);
            }
          },
        },
      );
    `,
  );
  await waitForReadyChild(firstWriter);
  releaseLease({
    stateRoot,
    name: firstOwner.leaseName,
    operationId: leaseMutationId("release:wait-owner"),
    token: firstOwner.leaseToken,
  });
  const freshOwner = ownerRepairLease(stateRoot, plan, {
    nowMs: Date.now() + 10,
  });
  const waitedResult = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...freshOwner,
  });
  const firstExit = await waitForChildExit(firstWriter);
  assert.equal(firstExit.code, 0);
  assert.equal(firstExit.signal, null);
  assert.equal(waitedResult.changed, false);
  assert.equal(readFileSync(paths.outcomes).length, 0);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "complete",
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
  assert.equal(
    summarizeOutcomeLedger(paths.outcomes, { stateRoot }).sourceHealth
      .ledgerHealthy,
    true,
  );
});

test("a near-expiry repair waiter cannot inherit authority for completed state", async (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("two-repair-writers-expired-waiter");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);
  const completed = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...owner,
  });
  assert.equal(completed.changed, true);
  const lockHolder = spawnReadyChild(
    t,
    `
      import { withOutcomeLedgerWriterLock } from ${JSON.stringify(NIGHTLY_MODULE_URL)};
      const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
      withOutcomeLedgerWriterLock(${JSON.stringify(paths.outcomes)}, () => {
        process.stdout.write("READY\\n");
        Atomics.wait(signal, 0, 0, 1_000);
      });
    `,
  );
  await waitForReadyChild(lockHolder);
  const ledgerBeforeWait = readFileSync(paths.outcomes);
  const eventsBeforeWait = readFileSync(paths.events);
  const transactionBeforeWait = readFileSync(plan.artifacts.transaction);
  const receiptBeforeWait = readFileSync(plan.artifacts.receiptArtifact);
  assert.throws(
    () =>
      withLeaseAlmostExpired(
        stateRoot,
        owner.leaseName,
        500,
        () =>
          repairOutcomeLedger({
            stateRoot,
            taskId: TASK_ID,
            expectedSourceDigest: sourceDigest,
            ...owner,
          }),
      ),
    /lease.*expired|expired.*lease/i,
  );
  const holderExit = await waitForChildExit(lockHolder);
  assert.equal(holderExit.code, 0);
  assert.equal(holderExit.signal, null);
  assert.equal(readFileSync(paths.outcomes).equals(ledgerBeforeWait), true);
  assert.equal(readFileSync(paths.events).equals(eventsBeforeWait), true);
  assert.equal(
    readFileSync(plan.artifacts.transaction).equals(transactionBeforeWait),
    true,
  );
  assert.equal(
    readFileSync(plan.artifacts.receiptArtifact).equals(receiptBeforeWait),
    true,
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
});

test("owner expiry inside a busy events kernel guard leaves no repair mutation", async (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("events-guard-owner-expiry");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const expiringOwner = ownerRepairLease(stateRoot, plan);
  const guardPath = path.join(paths.guards, "events.lock", "kernel.lock");
  const guardHolder = spawnReadyChild(
    t,
    `
      import { chmodSync, mkdirSync } from "node:fs";
      import { withKernelFileGuard } from ${JSON.stringify(CONTROL_MODULE_URL)};
      const guardPath = ${JSON.stringify(guardPath)};
      mkdirSync(${JSON.stringify(paths.guards)}, { recursive: true, mode: 0o700 });
      chmodSync(${JSON.stringify(paths.guards)}, 0o700);
      withKernelFileGuard(guardPath, () => {
        process.stdout.write("READY\\n");
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.wait(signal, 0, 0, 1_300);
      }, { label: "events" });
    `,
  );
  await waitForReadyChild(guardHolder);

  assert.throws(
    () =>
      withLeaseAlmostExpired(
        stateRoot,
        expiringOwner.leaseName,
        500,
        () =>
          repairOutcomeLedger({
            stateRoot,
            taskId: TASK_ID,
            expectedSourceDigest: sourceDigest,
            ...expiringOwner,
          }),
      ),
    /lease.*expired|expired.*lease/i,
  );
  const holderExit = await waitForChildExit(guardHolder);
  assert.equal(holderExit.code, 0);
  assert.equal(holderExit.signal, null);
  assert.equal(readFileSync(paths.outcomes).equals(source), true);
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
  assert.equal(existsSync(plan.artifacts.transaction), false);

  releaseLease({
    stateRoot,
    name: expiringOwner.leaseName,
    operationId: leaseMutationId("release:events-guard-expiring-owner"),
    token: expiringOwner.leaseToken,
  });
  const freshOwner = ownerRepairLease(stateRoot, plan, {
    nowMs: Date.now() + 10,
  });
  const recovered = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...freshOwner,
  });
  assert.equal(recovered.changed, true);
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "complete",
  );
  const replay = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...freshOwner,
  });
  assert.equal(replay.changed, false);
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
});

test("plan and repair reject a nonexistent canonical task without writes", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("nonexistent-task");
  const sourceDigest = writeLedger(paths, source);
  const nonexistentTaskId = "nonexistent-outcome-ledger-owner";

  assert.throws(
    () =>
      planOutcomeLedgerRepair({
        stateRoot,
        taskId: nonexistentTaskId,
        expectedSourceDigest: sourceDigest,
      }),
    /does not exist/,
  );
  assert.throws(
    () =>
      repairOutcomeLedger({
        stateRoot,
        taskId: nonexistentTaskId,
        expectedSourceDigest: sourceDigest,
        actor: "freed-owner",
        leaseName: "owner-governance",
        leaseToken: "invalid-owner-lease",
      }),
    /does not exist/,
  );
  assert.equal(readFileSync(paths.outcomes).equals(source), true);
  assert.equal(
    existsSync(path.join(paths.controlRoot, "outcome-ledger-transactions")),
    false,
  );
  assert.equal(
    existsSync(path.join(stateRoot, "artifacts", "outcome-ledger-repair")),
    false,
  );
});

test("a prepared transaction refuses a missing immutable archive", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("missing-prepared-archive");
  const sourceDigest = writeLedger(paths, source);
  const session = repairSession(stateRoot, sourceDigest);
  assert.throws(
    () =>
      executeRepair(
        { stateRoot, sourceDigest },
        {
          checkpoint: (checkpoint) => {
            if (checkpoint === "transaction-prepared") {
              throw new Error("stop after transaction prepared");
            }
          },
        },
      ),
    /stop after transaction prepared/,
  );
  rmSync(session.plan.artifacts.sourceArtifact);
  assert.throws(
    () => executeRepair({ stateRoot, sourceDigest }),
    /ENOENT|artifact|source/i,
  );
  assert.equal(readFileSync(paths.outcomes).equals(source), true);
  assert.equal(
    JSON.parse(readFileSync(session.plan.artifacts.transaction, "utf8")).phase,
    "prepared",
  );
});

test("exact-operation transaction, artifact, replacement, and quarantine temp prefixes recover", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  trustedMergedOutcome(stateRoot);
  const trustedBytes = readFileSync(paths.outcomes);
  const rejectedBytes = legacyLine("deterministic-temp-prefixes");
  appendFileSync(paths.outcomes, rejectedBytes);
  chmodSync(paths.outcomes, 0o644);
  const source = Buffer.concat([trustedBytes, rejectedBytes]);
  const sourceDigest = sha256(source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  ensurePrivateDirectoryTree(stateRoot, plan.artifacts.transactionDirectory);
  ensurePrivateDirectoryTree(stateRoot, plan.artifacts.artifactDirectory);
  const transactionPrefix = transactionBytesForPlan(plan).subarray(0, 257);
  const sourcePrefix = source.subarray(0, Math.min(source.length, 127));
  const replacementPrefix = trustedBytes.subarray(
    0,
    Math.min(trustedBytes.length, 127),
  );
  const quarantineId = "00000000-0000-4000-8000-000000000001";
  const orphanPaths = [
    [
      path.join(
        plan.artifacts.transactionDirectory,
        `.${path.basename(plan.artifacts.transaction)}.424201.tmp`,
      ),
      transactionPrefix,
    ],
    [
      path.join(
        plan.artifacts.transactionDirectory,
        `.${path.basename(plan.artifacts.transaction)}.424202.tmp.quarantine.${quarantineId}`,
      ),
      transactionPrefix,
    ],
    [
      path.join(
        plan.artifacts.artifactDirectory,
        `.${path.basename(plan.artifacts.sourceArtifact)}.424203.tmp`,
      ),
      sourcePrefix,
    ],
    [
      path.join(
        plan.artifacts.artifactDirectory,
        `.${path.basename(plan.artifacts.sourceArtifact)}.424204.tmp.quarantine.${quarantineId}`,
      ),
      sourcePrefix,
    ],
    [
      `${paths.outcomes}.${plan.operationId}.424205.repair.tmp`,
      replacementPrefix,
    ],
    [
      `${paths.outcomes}.${plan.operationId}.424206.repair.tmp.quarantine.${quarantineId}`,
      replacementPrefix,
    ],
  ];
  for (const [filePath, bytes] of orphanPaths) {
    writeFileSync(filePath, bytes, { mode: 0o600 });
    chmodSync(filePath, 0o600);
  }
  const owner = ownerRepairLease(stateRoot, plan);
  const result = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...owner,
  });
  assert.equal(result.changed, true);
  for (const [filePath] of orphanPaths)
    assert.equal(existsSync(filePath), false);
  assert.equal(readFileSync(paths.outcomes).equals(trustedBytes), true);
  assert.equal(
    summarizeOutcomeLedger(paths.outcomes, { stateRoot }).sourceHealth
      .ledgerHealthy,
    true,
  );
});

test("an unrelated safe transaction temp survives byte-identical without poisoning completion", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("unrelated-safe-transaction-temp");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  ensurePrivateDirectoryTree(stateRoot, plan.artifacts.transactionDirectory);
  const unrelatedOperationId = sha256("unrelated-safe-transaction-temp");
  assert.notEqual(unrelatedOperationId, plan.operationId);
  const unrelatedPath = path.join(
    plan.artifacts.transactionDirectory,
    `.${unrelatedOperationId}.json.515151.tmp`,
  );
  const unrelatedBytes = Buffer.from(
    "safe unrelated transaction temp\n",
    "utf8",
  );
  writeFileSync(unrelatedPath, unrelatedBytes, { mode: 0o600 });
  const owner = ownerRepairLease(stateRoot, plan);
  const result = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...owner,
  });
  assert.equal(result.changed, true);
  assert.equal(readFileSync(unrelatedPath).equals(unrelatedBytes), true);
  assert.equal(
    summarizeOutcomeLedger(paths.outcomes, { stateRoot }).sourceHealth
      .ledgerHealthy,
    true,
  );
  const replay = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...owner,
  });
  assert.equal(replay.changed, false);
  assert.equal(readFileSync(unrelatedPath).equals(unrelatedBytes), true);
});

test("a malformed matching transaction temp fails before canonical mutation", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("malformed-matching-temp");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  ensurePrivateDirectoryTree(stateRoot, plan.artifacts.transactionDirectory);
  const malformedPath = path.join(
    plan.artifacts.transactionDirectory,
    `.${path.basename(plan.artifacts.transaction)}.616161.tmp`,
  );
  const malformedBytes = Buffer.from("foreign malformed bytes", "utf8");
  writeFileSync(malformedPath, malformedBytes, { mode: 0o600 });
  const owner = ownerRepairLease(stateRoot, plan);
  assert.throws(
    () =>
      repairOutcomeLedger({
        stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
        ...owner,
      }),
    /temp has foreign bytes/,
  );
  assert.equal(readFileSync(paths.outcomes).equals(source), true);
  assert.equal(readFileSync(malformedPath).equals(malformedBytes), true);
  assert.equal(existsSync(plan.artifacts.artifactDirectory), false);
  assert.equal(existsSync(plan.artifacts.transaction), false);
});

test("an orphan outcome writer lock candidate cannot block a new repair writer", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("orphan-writer-candidate");
  const sourceDigest = writeLedger(paths, source);
  const candidatePath = `${paths.outcomes}.writer-lock.717171.00000000-0000-4000-8000-000000000002.tmp`;
  const candidateBytes = Buffer.from(
    "orphan candidate remains nonauthoritative\n",
  );
  writeFileSync(candidatePath, candidateBytes, { mode: 0o600 });
  const result = executeRepair({ stateRoot, sourceDigest });
  assert.equal(result.changed, true);
  assert.equal(readFileSync(candidatePath).equals(candidateBytes), true);
  assert.equal(readFileSync(paths.outcomes).length, 0);
});

test("event recovery accepts a fresh exact owner lease without duplicating audit", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("owner-lease-rollover");
  const sourceDigest = writeLedger(paths, source);
  const session = repairSession(stateRoot, sourceDigest);
  assert.throws(
    () =>
      executeRepair(
        { stateRoot, sourceDigest },
        {
          checkpoint: (checkpoint) => {
            if (checkpoint === "event-audited") {
              throw new Error("stop after first owner audit");
            }
          },
        },
      ),
    /stop after first owner audit/,
  );
  const firstEvent = readFileSync(paths.events, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((event) => event.eventId === session.plan.eventId);
  assert.ok(firstEvent);
  releaseLease({
    stateRoot,
    name: session.owner.leaseName,
    operationId: leaseMutationId("release:event-audited-owner"),
    token: session.owner.leaseToken,
  });
  const replacementOwner = ownerRepairLease(stateRoot, session.plan, {
    nowMs: Date.now() + 1_000,
  });
  const recovered = executeRepair(
    { stateRoot, sourceDigest },
    { owner: replacementOwner },
  );
  assert.equal(recovered.changed, true);
  const matchingEvents = readFileSync(paths.events, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.eventId === session.plan.eventId);
  assert.equal(matchingEvents.length, 1);
  assert.deepEqual(matchingEvents[0], firstEvent);
});

for (const variant of [
  { name: "conflicting content", checkpoint: "event-audited", phase: "replaced" },
  { name: "duplicate content", checkpoint: "event-audited", phase: "replaced" },
  { name: "missing audited event", checkpoint: "transaction-audited", phase: "audited" },
]) {
  test(`pending repair audit rejects ${variant.name} before receipt publication`, (t) => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const source = legacyLine(`pending-audit-${variant.name}`);
    const sourceDigest = writeLedger(paths, source);
    const session = repairSession(stateRoot, sourceDigest);
    assert.throws(
      () =>
        executeRepair(
          { stateRoot, sourceDigest },
          {
            checkpoint: (checkpoint) => {
              if (checkpoint === variant.checkpoint) {
                throw new Error(`stop at ${variant.checkpoint}`);
              }
            },
          },
        ),
      new RegExp(`stop at ${variant.checkpoint}`),
    );
    const eventLines = readFileSync(paths.events, "utf8").split("\n");
    const auditLineIndex = eventLines.findIndex((line) => {
      if (!line) return false;
      return JSON.parse(line).eventId === session.plan.eventId;
    });
    assert.notEqual(auditLineIndex, -1);
    if (variant.name === "conflicting content") {
      const conflictingEvent = JSON.parse(eventLines[auditLineIndex]);
      conflictingEvent.actor = "freed-stability-controller";
      eventLines[auditLineIndex] = JSON.stringify(conflictingEvent);
    } else if (variant.name === "duplicate content") {
      eventLines.splice(auditLineIndex + 1, 0, eventLines[auditLineIndex]);
    } else {
      eventLines.splice(auditLineIndex, 1);
    }
    writeFileSync(paths.events, eventLines.join("\n"), { mode: 0o600 });
    assert.equal(
      JSON.parse(readFileSync(session.plan.artifacts.transaction, "utf8")).phase,
      variant.phase,
    );
    releaseLease({
      stateRoot,
      name: session.owner.leaseName,
      operationId: leaseMutationId(`release:pending-audit-${variant.name}`),
      token: session.owner.leaseToken,
    });
    const replacementOwner = ownerRepairLease(stateRoot, session.plan, {
      nowMs: Date.now() + 1_000,
    });
    const beforeEvents = readFileSync(paths.events);
    const beforeLedger = readFileSync(paths.outcomes);
    const beforeTransaction = readFileSync(session.plan.artifacts.transaction);
    const summary = summarizeOutcomeLedger(paths.outcomes, {
      stateRoot,
      allowedPendingRepairOperationId: session.plan.operationId,
    });
    assert.equal(summary.sourceHealth.outcomeLedgerTransactionsHealthy, false);
    assert.throws(
      () =>
        executeRepair(
          { stateRoot, sourceDigest },
          { owner: replacementOwner },
        ),
      /requires healthy ledger, control event, and repair transaction sources/,
    );
    assert.equal(readFileSync(paths.events).equals(beforeEvents), true);
    assert.equal(readFileSync(paths.outcomes).equals(beforeLedger), true);
    assert.equal(
      readFileSync(session.plan.artifacts.transaction).equals(beforeTransaction),
      true,
    );
    assert.equal(existsSync(session.plan.artifacts.receiptArtifact), false);
  });
}

for (const checkpointName of ["transaction-audited", "receipt-written"]) {
  test(`owner expiry at ${checkpointName} cannot publish a later repair phase`, (t) => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const source = legacyLine(`owner-expiry-${checkpointName}`);
    const sourceDigest = writeLedger(paths, source);
    const plan = planOutcomeLedgerRepair({
      stateRoot,
      taskId: TASK_ID,
      expectedSourceDigest: sourceDigest,
    });
    const owner = ownerRepairLease(stateRoot, plan);
    const leaseRecordPath = path.join(
      paths.leases,
      `${owner.leaseName}.lease`,
      "lease.json",
    );
    const expiresAtMs = Date.parse(
      JSON.parse(readFileSync(leaseRecordPath, "utf8")).expiresAt,
    );
    const liveDateNow = Date.now;
    let expired = false;
    try {
      assert.throws(
        () =>
          repairOutcomeLedger(
            {
              stateRoot,
              taskId: TASK_ID,
              expectedSourceDigest: sourceDigest,
              ...owner,
            },
            {
              checkpoint: (checkpoint) => {
                if (checkpoint !== checkpointName || expired) return;
                expired = true;
                Date.now = () => expiresAtMs + 1;
              },
            },
          ),
        /lease.*expired|expired.*lease/i,
      );
    } finally {
      Date.now = liveDateNow;
    }
    assert.equal(expired, true);
    assert.equal(
      JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
      "audited",
    );
    assert.equal(
      existsSync(plan.artifacts.receiptArtifact),
      checkpointName === "receipt-written",
    );
    assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);

    releaseLease({
      stateRoot,
      name: owner.leaseName,
      operationId: leaseMutationId(`release:${checkpointName}-expired-owner`),
      token: owner.leaseToken,
    });
    const recoveryOwner = ownerRepairLease(stateRoot, plan);
    const recovered = repairOutcomeLedger({
      stateRoot,
      taskId: TASK_ID,
      expectedSourceDigest: sourceDigest,
      ...recoveryOwner,
    });
    assert.equal(recovered.changed, true);
    assert.equal(
      JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
      "complete",
    );
    assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
  });
}

test("owner lease revocation at replacement sync preserves the canonical ledger", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("replacement-synced-owner-revocation");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);
  const temporaryPath = `${paths.outcomes}.${plan.operationId}.${process.pid}.repair.tmp`;
  let revoked = false;

  assert.throws(
    () =>
      repairOutcomeLedger(
        {
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
          ...owner,
        },
        {
          checkpoint: (checkpoint) => {
            if (checkpoint !== "replacement-synced") return;
            rmSync(path.join(paths.leases, `${owner.leaseName}.lease`), {
              recursive: true,
              force: true,
            });
            revoked = true;
          },
        },
      ),
    (error) => error?.code === "lease_not_found",
  );

  assert.equal(revoked, true);
  assert.equal(readFileSync(paths.outcomes).equals(source), true);
  assert.equal(existsSync(temporaryPath), false);
  assert.equal(
    readdirSync(stateRoot).some((entry) =>
      entry.startsWith(`${path.basename(paths.outcomes)}.${plan.operationId}.`),
    ),
    false,
  );
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "prepared",
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
});

test("a classification-changing event suffix before replacement preserves the canonical ledger", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  trustedMergedOutcome(stateRoot);
  const source = readFileSync(paths.outcomes);
  const sourceDigest = sha256(source);
  const entry = JSON.parse(source.toString("utf8").trim());
  const controlEvent = readFileSync(paths.events, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((event) => event.eventId === entry.authentication.controlEventId);
  assert.ok(controlEvent);
  const conflictingSuffix = structuredClone(controlEvent);
  conflictingSuffix.data.outcomeDigest = "f".repeat(64);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);
  let injected = false;
  assert.throws(
    () =>
      repairOutcomeLedger(
        {
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
          ...owner,
        },
        {
          checkpoint: (checkpoint) => {
            if (
              checkpoint !== "before-replacement-classification" ||
              injected
            ) {
              return;
            }
            injected = true;
            appendFileSync(
              paths.events,
              `${JSON.stringify(conflictingSuffix)}\n`,
            );
          },
        },
      ),
    /classification drifted before repair audit/,
  );
  assert.equal(injected, true);
  assert.equal(readFileSync(paths.outcomes).equals(source), true);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "prepared",
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
});

test("a classification-changing suffix after replacement cannot become audited", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  trustedMergedOutcome(stateRoot);
  const trustedBytes = readFileSync(paths.outcomes);
  const rejectedBytes = legacyLine("post-replacement-classification-change");
  appendFileSync(paths.outcomes, rejectedBytes);
  const source = Buffer.concat([trustedBytes, rejectedBytes]);
  const sourceDigest = sha256(source);
  const entry = JSON.parse(
    trustedBytes.toString("utf8").trim(),
  );
  const controlEvent = parsedEvents(paths).find(
    (event) => event.eventId === entry.authentication.controlEventId,
  );
  assert.ok(controlEvent);
  const conflictingSuffix = structuredClone(controlEvent);
  conflictingSuffix.data.outcomeDigest = "f".repeat(64);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const firstOwner = ownerRepairLease(stateRoot, plan);

  assert.throws(
    () =>
      repairOutcomeLedger(
        {
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
          ...firstOwner,
        },
        {
          checkpoint: (checkpoint) => {
            if (checkpoint === "replacement-directory-synced") {
              throw new Error("leave replacement with prepared transaction");
            }
          },
        },
      ),
    /leave replacement with prepared transaction/,
  );
  assert.notEqual(sourceDigest, plan.parameters.replacementDigest);
  assert.equal(readFileSync(paths.outcomes).equals(trustedBytes), true);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "prepared",
  );
  appendFileSync(paths.events, `${JSON.stringify(conflictingSuffix)}\n`);
  releaseLease({
    stateRoot,
    name: firstOwner.leaseName,
    operationId: leaseMutationId("release:post-replacement-owner"),
    token: firstOwner.leaseToken,
  });
  const recoveryOwner = ownerRepairLease(stateRoot, plan);

  assert.throws(
    () =>
      repairOutcomeLedger({
        stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
        ...recoveryOwner,
      }),
    /classification drifted before repair audit/,
  );
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "prepared",
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
});

test("repair audit capacity is preflighted before ledger transaction or event mutation", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("repair-audit-capacity-preflight");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);
  const eventCap = 128 * 1024 * 1024;
  const targetSize = eventCap - 128;
  appendJsonPaddingToSize(
    paths.events,
    targetSize,
    "repair_audit_capacity_padding",
  );

  const manifestBefore = readFileSync(paths.taskManifest);
  const taskBefore = readTask({ stateRoot, taskId: TASK_ID });
  const eventDigestBefore = sha256(readFileSync(paths.events));
  const repairTransactionsBefore = flatDirectorySnapshot(
    plan.artifacts.transactionDirectory,
  );

  assert.throws(
    () =>
      repairOutcomeLedger({
        stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
        ...owner,
      }),
    /audit event.*durable history capacity|control event.*history boundary/i,
  );

  assert.equal(readFileSync(paths.outcomes).equals(source), true);
  assert.equal(statSync(paths.events).size, targetSize);
  assert.equal(sha256(readFileSync(paths.events)), eventDigestBefore);
  assert.equal(readFileSync(paths.taskManifest).equals(manifestBefore), true);
  assert.deepEqual(readTask({ stateRoot, taskId: TASK_ID }), taskBefore);
  assert.deepEqual(
    flatDirectorySnapshot(plan.artifacts.transactionDirectory),
    repairTransactionsBefore,
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
});

test("the repair event guard excludes a concurrent suffix writer through transaction audit", async (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const controllerNowMs = Date.now();
  const controller = actorLease(
    stateRoot,
    "freed-stability-controller",
    controllerNowMs,
  );
  const source = legacyLine("repair-event-guard-exclusion");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);
  const attemptPath = path.join(stateRoot, "suffix-writer-attempted");
  const donePath = path.join(stateRoot, "suffix-writer-complete");
  const auditedPath = path.join(stateRoot, "repair-transaction-audited");
  const suffixEventId = "repair-final-guard-concurrent-suffix";

  const repairChild = spawnReadyChild(
    t,
    `
      import { existsSync, writeFileSync } from "node:fs";
      import { repairOutcomeLedger } from ${JSON.stringify(MODULE_URL)};
      const signal = new Int32Array(
        new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
      );
      const wait = (ms) => Atomics.wait(signal, 0, 0, ms);
      const result = repairOutcomeLedger(
        {
          stateRoot: ${JSON.stringify(stateRoot)},
          taskId: ${JSON.stringify(TASK_ID)},
          expectedSourceDigest: ${JSON.stringify(sourceDigest)},
          ...${JSON.stringify(owner)},
        },
        {
          checkpoint(checkpoint) {
            if (checkpoint === "before-replacement-classification") {
              process.stdout.write("READY\\n");
              const deadline = Date.now() + 4_000;
              while (
                !existsSync(${JSON.stringify(attemptPath)}) &&
                Date.now() < deadline
              ) {
                wait(10);
              }
              if (!existsSync(${JSON.stringify(attemptPath)})) {
                throw new Error("concurrent suffix writer never attempted");
              }
              wait(500);
            }
            if (checkpoint === "transaction-audited") {
              if (existsSync(${JSON.stringify(donePath)})) {
                throw new Error(
                  "concurrent suffix writer entered before transaction audit",
                );
              }
              writeFileSync(${JSON.stringify(auditedPath)}, "audited\\n");
            }
          },
        },
      );
      if (!result.changed) throw new Error("repair did not change the ledger");
    `,
  );
  await waitForReadyChild(repairChild);

  const suffixChild = spawnReadyChild(
    t,
    `
      import { writeFileSync } from "node:fs";
      import { appendControlEvent } from ${JSON.stringify(CONTROL_MODULE_URL)};
      writeFileSync(${JSON.stringify(attemptPath)}, "attempted\\n");
      process.stdout.write("READY\\n");
      appendControlEvent({
        stateRoot: ${JSON.stringify(stateRoot)},
        type: "repair_guard_suffix_appended",
        taskId: ${JSON.stringify(TASK_ID)},
        eventId: ${JSON.stringify(suffixEventId)},
        ...${JSON.stringify(controller)},
        data: { reason: "prove final repair guard exclusion" },
        nowMs: ${JSON.stringify(controllerNowMs + 1_000)},
      });
      writeFileSync(${JSON.stringify(donePath)}, "complete\\n");
    `,
  );
  await waitForReadyChild(suffixChild);

  const [repairExit, suffixExit] = await Promise.all([
    waitForChildExit(repairChild),
    waitForChildExit(suffixChild),
  ]);
  assert.deepEqual(repairExit, { code: 0, signal: null });
  assert.deepEqual(suffixExit, { code: 0, signal: null });
  assert.equal(existsSync(auditedPath), true);
  assert.equal(existsSync(donePath), true);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "complete",
  );
  const events = parsedEvents(paths);
  const repairEventIndex = events.findIndex(
    (event) => event.eventId === plan.eventId,
  );
  const suffixEventIndex = events.findIndex(
    (event) => event.eventId === suffixEventId,
  );
  assert.ok(repairEventIndex >= 0);
  assert.ok(suffixEventIndex > repairEventIndex);
});

test("a pending repair for one task blocks a second task without corrupting the first", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const secondTaskId = "secondary-outcome-ledger-repair";
  const controller = actorLease(
    stateRoot,
    "freed-stability-controller",
    Date.now(),
  );
  createTask({
    stateRoot,
    taskId: secondTaskId,
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: true },
    nowMs: Date.now() + 1,
  });
  releaseLease({
    stateRoot,
    name: controller.leaseName,
    operationId: leaseMutationId("release:two-task-controller"),
    token: controller.leaseToken,
  });
  const source = legacyLine("two-task-interleaving");
  const sourceDigest = writeLedger(paths, source);
  const firstPlan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const firstOwner = ownerRepairLease(stateRoot, firstPlan);
  assert.throws(
    () =>
      repairOutcomeLedger(
        {
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
          ...firstOwner,
        },
        {
          checkpoint: (checkpoint) => {
            if (checkpoint === "transaction-prepared") {
              throw new Error("leave the first task prepared");
            }
          },
        },
      ),
    /leave the first task prepared/,
  );
  releaseLease({
    stateRoot,
    name: firstOwner.leaseName,
    operationId: leaseMutationId("release:first-repair-owner"),
    token: firstOwner.leaseToken,
  });
  assert.throws(
    () =>
      planOutcomeLedgerRepair({
        stateRoot,
        taskId: secondTaskId,
        expectedSourceDigest: sourceDigest,
      }),
    /requires healthy ledger, control event, and repair transaction sources/,
  );
  assert.equal(readFileSync(paths.outcomes).equals(source), true);
  assert.equal(
    JSON.parse(readFileSync(firstPlan.artifacts.transaction, "utf8")).phase,
    "prepared",
  );
  const recoveryOwner = ownerRepairLease(stateRoot, firstPlan);
  const recovered = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...recoveryOwner,
  });
  assert.equal(recovered.changed, true);
  assert.equal(repairAuditEvents(paths, firstPlan.eventId).length, 1);
});

for (const checkpointName of [
  "replacement-directory-synced",
  "transaction-replaced",
]) {
  test(`ordinary outcome append fails closed after ${checkpointName}`, (t) => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const { nightly, nowMs } = trustedMergedOutcome(stateRoot);
    const trustedBytes = readFileSync(paths.outcomes);
    const rejectedBytes = legacyLine(`append-interleaving-${checkpointName}`);
    appendFileSync(paths.outcomes, rejectedBytes);
    chmodSync(paths.outcomes, 0o644);
    const sourceDigest = sha256(Buffer.concat([trustedBytes, rejectedBytes]));
    const plan = planOutcomeLedgerRepair({
      stateRoot,
      taskId: TASK_ID,
      expectedSourceDigest: sourceDigest,
    });
    const owner = ownerRepairLease(stateRoot, plan);
    assert.throws(
      () =>
        repairOutcomeLedger(
          {
            stateRoot,
            taskId: TASK_ID,
            expectedSourceDigest: sourceDigest,
            ...owner,
          },
          {
            checkpoint: (checkpoint) => {
              if (checkpoint === checkpointName) {
                throw new Error(`simulate loss after ${checkpointName}`);
              }
            },
          },
        ),
      new RegExp(`simulate loss after ${checkpointName}`),
    );
    assert.equal(readFileSync(paths.outcomes).equals(trustedBytes), true);
    assert.equal(
      JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
      checkpointName === "transaction-replaced" ? "replaced" : "prepared",
    );
    const taskManifestBeforeBlockedAppend = readFileSync(paths.taskManifest);
    const eventsBeforeBlockedAppend = readFileSync(paths.events);
    const installedEntry = {
      id: TASK_ID,
      taskId: TASK_ID,
      kind: "stability",
      outcome: "installed",
      evidenceDigest: "d".repeat(64),
      installedIdentity: {
        version: "26.7.1801",
        commitSha: "e".repeat(40),
        channel: "dev",
      },
    };
    const installedOptions = {
      stateRoot,
      authentication: nightly,
      now: new Date(nowMs + 60_000),
    };
    assert.throws(
      () =>
        appendOutcomeLedger(paths.outcomes, installedEntry, installedOptions),
      /outcome ledger repair|pending repair|repair transaction/i,
    );
    assert.equal(readFileSync(paths.outcomes).equals(trustedBytes), true);
    assert.equal(
      readFileSync(paths.taskManifest).equals(taskManifestBeforeBlockedAppend),
      true,
    );
    assert.equal(
      readFileSync(paths.events).equals(eventsBeforeBlockedAppend),
      true,
    );

    const recovered = repairOutcomeLedger({
      stateRoot,
      taskId: TASK_ID,
      expectedSourceDigest: sourceDigest,
      ...owner,
    });
    assert.equal(recovered.changed, true);
    const installed = appendOutcomeLedger(
      paths.outcomes,
      installedEntry,
      installedOptions,
    );
    const ledgerAfterInstall = readFileSync(paths.outcomes);
    const repeated = appendOutcomeLedger(
      paths.outcomes,
      installedEntry,
      installedOptions,
    );
    assert.equal(
      repeated.authentication.outcomeDigest,
      installed.authentication.outcomeDigest,
    );
    assert.equal(readFileSync(paths.outcomes).equals(ledgerAfterInstall), true);
    assert.equal(
      summarizeOutcomeLedger(paths.outcomes, { stateRoot }).entries.filter(
        (candidate) => candidate.outcome === "installed",
      ).length,
      1,
    );
  });
}

for (const checkpointName of [
  "outcome-transition-resolved",
  "outcome-control-event-appended",
  "outcome-ledger-appended",
  "outcome-finalized",
]) {
  test(`ordinary outcome retry is exact after ${checkpointName}`, (t) => {
    const fixture = verificationOutcomeFixture(t, checkpointName);
    let thrown = false;
    assert.throws(
      () =>
        appendOutcomeLedger(fixture.paths.outcomes, fixture.entry, {
          stateRoot: fixture.stateRoot,
          authentication: fixture.authentication,
          now: fixture.now,
          checkpoint: (checkpoint) => {
            if (checkpoint === checkpointName && !thrown) {
              thrown = true;
              throw new Error(`simulate crash after ${checkpointName}`);
            }
          },
        }),
      new RegExp(`simulate crash after ${checkpointName}`),
    );
    assert.equal(thrown, true);

    const recovered = appendOutcomeLedger(
      fixture.paths.outcomes,
      fixture.entry,
      {
        stateRoot: fixture.stateRoot,
        authentication: fixture.authentication,
        now: fixture.now,
      },
    );
    const manifestAfterRecovery = readFileSync(fixture.paths.taskManifest);
    const eventsAfterRecovery = readFileSync(fixture.paths.events);
    const ledgerAfterRecovery = readFileSync(fixture.paths.outcomes);
    const idempotent = appendOutcomeLedger(
      fixture.paths.outcomes,
      fixture.entry,
      {
        stateRoot: fixture.stateRoot,
        authentication: fixture.authentication,
        now: fixture.now,
      },
    );

    assert.deepEqual(idempotent, recovered);
    assert.equal(
      readFileSync(fixture.paths.taskManifest).equals(manifestAfterRecovery),
      true,
    );
    assert.equal(
      readFileSync(fixture.paths.events).equals(eventsAfterRecovery),
      true,
    );
    assert.equal(
      readFileSync(fixture.paths.outcomes).equals(ledgerAfterRecovery),
      true,
    );

    const events = parsedEvents(fixture.paths);
    const matchingTransitions = events.filter(
      (event) =>
        event.eventId === recovered.authentication.transitionEventId &&
        event.type === "task_transitioned",
    );
    const matchingOutcomeEvents = events.filter(
      (event) =>
        event.eventId === recovered.authentication.controlEventId &&
        event.type === "outcome_recorded",
    );
    const matchingFinalizations = events.filter(
      (event) =>
        event.type === "outcome_reservation_finalized" &&
        event.taskId === TASK_ID &&
        event.data?.outcomeDigest === recovered.authentication.outcomeDigest,
    );
    const matchingLedgerEntries = summarizeOutcomeLedger(
      fixture.paths.outcomes,
      { stateRoot: fixture.stateRoot },
    ).entries.filter(
      (entry) =>
        entry.taskId === TASK_ID &&
        entry.outcome === fixture.entry.outcome &&
        entry.authentication?.outcomeDigest ===
          recovered.authentication.outcomeDigest,
    );
    assert.equal(matchingTransitions.length, 1);
    assert.equal(matchingOutcomeEvents.length, 1);
    assert.equal(matchingFinalizations.length, 1);
    assert.equal(matchingLedgerEntries.length, 1);
    const task = readTask({
      stateRoot: fixture.stateRoot,
      taskId: TASK_ID,
    });
    assert.equal(task.state, fixture.entry.outcome);
    assert.equal(task.pendingOutcome, undefined);
    assert.equal(
      task.details.latestOutcome.outcomeDigest,
      recovered.authentication.outcomeDigest,
    );
  });
}

test("transaction-bound repair audit rejects missing prepared artifacts before callback", (t) => {
  const { stateRoot, paths, plan, owner } = leaveRepairReplaced(
    t,
    "transaction-bound-audit-artifacts",
  );
  rmSync(plan.artifacts.sourceArtifact);
  const eventsBefore = readFileSync(paths.events);
  let callbackCalled = false;

  assert.throws(
    () =>
      withOutcomeLedgerRepairFinalizationGuard(
        {
          stateRoot,
          taskId: TASK_ID,
          ...owner,
          parameters: plan.parameters,
          transactionPath: plan.artifacts.transaction,
        },
        ({ appendRepairEvent }) => {
          callbackCalled = true;
          appendRepairEvent();
        },
      ),
    /source artifact is missing from the prepared repair/i,
  );
  assert.equal(callbackCalled, false);
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
});

test("transaction-bound repair audit authenticates every prepared artifact", async (t) => {
  for (const artifact of ["trusted", "rejected", "decisions", "receipt"]) {
    await t.test(artifact, (t) => {
      const fixture = leaveRepairReplaced(
        t,
        `transaction-bound-audit-${artifact}`,
      );
      const artifactPath =
        artifact === "trusted"
          ? fixture.plan.artifacts.trustedArtifact
          : artifact === "rejected"
            ? fixture.plan.artifacts.rejectedArtifact
            : artifact === "decisions"
              ? fixture.plan.artifacts.decisionsArtifact
              : fixture.plan.artifacts.receiptArtifact;
      writeFileSync(artifactPath, `tampered ${artifact}\n`, { mode: 0o600 });
      const eventsBefore = readFileSync(fixture.paths.events);
      let callbackCalled = false;

      assert.throws(
        () =>
          withOutcomeLedgerRepairFinalizationGuard(
            {
              stateRoot: fixture.stateRoot,
              taskId: TASK_ID,
              ...fixture.owner,
              parameters: fixture.plan.parameters,
              transactionPath: fixture.plan.artifacts.transaction,
            },
            () => {
              callbackCalled = true;
            },
          ),
        (error) =>
          error?.code === "outcome_ledger_repair_transaction_invalid",
      );
      assert.equal(callbackCalled, false);
      assert.deepEqual(readFileSync(fixture.paths.events), eventsBefore);
      assert.equal(
        JSON.parse(
          readFileSync(fixture.plan.artifacts.transaction, "utf8"),
        ).phase,
        "replaced",
      );
      assert.equal(
        repairAuditEvents(fixture.paths, fixture.plan.eventId).length,
        0,
      );
    });
  }
});

test("an empty source ledger completes through the transaction-bound audit", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const sourceDigest = writeLedger(paths, Buffer.alloc(0), 0o600);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  assert.equal(plan.parameters.sourceSize, 0);
  assert.equal(plan.parameters.sourceLineCount, 0);
  assert.equal(plan.parameters.replacementSize, 0);
  const owner = ownerRepairLease(stateRoot, plan);

  const result = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...owner,
  });

  assert.equal(result.changed, true);
  assert.equal(readFileSync(paths.outcomes).length, 0);
  assert.equal(readFileSync(plan.artifacts.sourceArtifact).length, 0);
  assert.equal(readFileSync(plan.artifacts.trustedArtifact).length, 0);
  assert.equal(readFileSync(plan.artifacts.rejectedArtifact).length, 0);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "complete",
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
});

test("transaction-bound repair audit helpers are synchronous and expire with their guard", (t) => {
  const asyncFixture = leaveRepairReplaced(
    t,
    "transaction-bound-audit-async",
  );
  assert.throws(
    () =>
      withOutcomeLedgerRepairFinalizationGuard(
        {
          stateRoot: asyncFixture.stateRoot,
          taskId: TASK_ID,
          ...asyncFixture.owner,
          parameters: asyncFixture.plan.parameters,
          transactionPath: asyncFixture.plan.artifacts.transaction,
        },
        async () => undefined,
      ),
    /callback must be synchronous/i,
  );
  assert.equal(
    repairAuditEvents(asyncFixture.paths, asyncFixture.plan.eventId).length,
    0,
  );

  const scopeFixture = leaveRepairReplaced(
    t,
    "transaction-bound-audit-scope",
  );
  let escaped;
  const event = withOutcomeLedgerRepairFinalizationGuard(
    {
      stateRoot: scopeFixture.stateRoot,
      taskId: TASK_ID,
      ...scopeFixture.owner,
      parameters: scopeFixture.plan.parameters,
      transactionPath: scopeFixture.plan.artifacts.transaction,
    },
    (helpers) => {
      escaped = helpers;
      helpers.preflightRepairEvent();
      const appended = helpers.appendRepairEvent();
      const transaction = JSON.parse(
        readFileSync(scopeFixture.plan.artifacts.transaction, "utf8"),
      );
      transaction.phase = "audited";
      writeFileSync(
        scopeFixture.plan.artifacts.transaction,
        `${JSON.stringify(transaction, null, 2)}\n`,
        { mode: 0o600 },
      );
      return appended;
    },
  );
  assert.equal(event.eventId, scopeFixture.plan.eventId);
  assert.equal(
    repairAuditEvents(scopeFixture.paths, scopeFixture.plan.eventId).length,
    1,
  );
  assert.throws(
    () => escaped.preflightRepairEvent(),
    /scope is no longer active/i,
  );
  assert.throws(
    () => escaped.appendRepairEvent(),
    /scope is no longer active/i,
  );
});

test("SIGKILL after transaction replacement releases guards and repairs exactly once", async (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("sigkill-after-transaction-replaced");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const firstOwner = ownerRepairLease(stateRoot, plan);
  const child = spawnReadyChild(
    t,
    `
      import { writeSync } from "node:fs";
      import { repairOutcomeLedger } from ${JSON.stringify(MODULE_URL)};
      repairOutcomeLedger(
        {
          stateRoot: process.env.FREED_TEST_STATE_ROOT,
          taskId: process.env.FREED_TEST_TASK_ID,
          expectedSourceDigest: process.env.FREED_TEST_SOURCE_DIGEST,
          actor: process.env.FREED_TEST_ACTOR,
          leaseName: process.env.FREED_TEST_LEASE_NAME,
          leaseToken: process.env.FREED_AUTOMATION_LEASE_TOKEN,
        },
        {
          checkpoint: (checkpoint) => {
            if (checkpoint !== "transaction-replaced") return;
            writeSync(1, "READY\\n");
            process.kill(process.pid, "SIGKILL");
          },
        },
      );
    `,
    {
      env: {
        FREED_TEST_STATE_ROOT: stateRoot,
        FREED_TEST_TASK_ID: TASK_ID,
        FREED_TEST_SOURCE_DIGEST: sourceDigest,
        FREED_TEST_ACTOR: firstOwner.actor,
        FREED_TEST_LEASE_NAME: firstOwner.leaseName,
        FREED_AUTOMATION_LEASE_TOKEN: firstOwner.leaseToken,
      },
    },
  );

  await waitForReadyChild(child);
  const childExit = await waitForChildExit(child);
  assert.equal(childExit.code, null);
  assert.equal(childExit.signal, "SIGKILL");
  assert.equal(readFileSync(paths.outcomes).length, 0);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "replaced",
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);

  releaseLease({
    stateRoot,
    name: firstOwner.leaseName,
    operationId: leaseMutationId("release:sigkill-owner"),
    token: firstOwner.leaseToken,
  });
  const recoveryOwner = ownerRepairLease(stateRoot, plan, {
    nowMs: Date.now() + 1_000,
  });
  const recovered = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...recoveryOwner,
  });
  assert.equal(recovered.changed, true);
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "complete",
  );
  const summary = summarizeOutcomeLedger(paths.outcomes, { stateRoot });
  assert.equal(summary.sourceHealth.controlEventsHealthy, true);
  assert.equal(summary.sourceHealth.ledgerHealthy, true);

  const ledgerAfterRecovery = readFileSync(paths.outcomes);
  const eventsAfterRecovery = readFileSync(paths.events);
  const transactionAfterRecovery = readFileSync(plan.artifacts.transaction);
  const receiptAfterRecovery = readFileSync(plan.artifacts.receiptArtifact);
  const idempotent = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...recoveryOwner,
  });
  assert.equal(idempotent.changed, false);
  assert.equal(readFileSync(paths.outcomes).equals(ledgerAfterRecovery), true);
  assert.equal(readFileSync(paths.events).equals(eventsAfterRecovery), true);
  assert.equal(
    readFileSync(plan.artifacts.transaction).equals(transactionAfterRecovery),
    true,
  );
  assert.equal(
    readFileSync(plan.artifacts.receiptArtifact).equals(receiptAfterRecovery),
    true,
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
});

test("SIGKILL after an ordinary ledger append recovers one complete outcome", async (t) => {
  const fixture = validatedOutcomeFixture(t);
  const child = spawnReadyChild(
    t,
    `
      import { writeSync } from "node:fs";
      import { appendOutcomeLedger } from ${JSON.stringify(NIGHTLY_MODULE_URL)};
      appendOutcomeLedger(
        process.env.FREED_TEST_LEDGER_PATH,
        JSON.parse(process.env.FREED_TEST_OUTCOME_ENTRY),
        {
          stateRoot: process.env.FREED_TEST_STATE_ROOT,
          authentication: {
            actor: process.env.FREED_TEST_ACTOR,
            leaseName: process.env.FREED_TEST_LEASE_NAME,
            leaseToken: process.env.FREED_AUTOMATION_LEASE_TOKEN,
          },
          now: new Date(process.env.FREED_TEST_NOW),
          checkpoint: (checkpoint) => {
            if (checkpoint !== "outcome-ledger-appended") return;
            writeSync(1, "READY\\n");
            process.kill(process.pid, "SIGKILL");
          },
        },
      );
    `,
    {
      env: {
        FREED_TEST_LEDGER_PATH: fixture.paths.outcomes,
        FREED_TEST_OUTCOME_ENTRY: JSON.stringify(fixture.entry),
        FREED_TEST_STATE_ROOT: fixture.stateRoot,
        FREED_TEST_ACTOR: fixture.authentication.actor,
        FREED_TEST_LEASE_NAME: fixture.authentication.leaseName,
        FREED_AUTOMATION_LEASE_TOKEN: fixture.authentication.leaseToken,
        FREED_TEST_NOW: fixture.now.toISOString(),
      },
    },
  );

  await waitForReadyChild(child);
  const childExit = await waitForChildExit(child);
  assert.equal(childExit.code, null);
  assert.equal(childExit.signal, "SIGKILL");
  const strandedTask = readTask({
    stateRoot: fixture.stateRoot,
    taskId: TASK_ID,
  });
  assert.equal(strandedTask.state, "merged");
  assert.ok(strandedTask.pendingOutcome);

  const recovered = appendOutcomeLedger(
    fixture.paths.outcomes,
    fixture.entry,
    {
      stateRoot: fixture.stateRoot,
      authentication: fixture.authentication,
      now: fixture.now,
    },
  );
  const recoverySnapshot = outcomeMutationSnapshot(
    fixture.stateRoot,
    fixture.paths,
  );
  const idempotent = appendOutcomeLedger(
    fixture.paths.outcomes,
    fixture.entry,
    {
      stateRoot: fixture.stateRoot,
      authentication: fixture.authentication,
      now: fixture.now,
    },
  );
  assert.deepEqual(idempotent, recovered);
  assertOutcomeMutationSnapshot(
    fixture.stateRoot,
    fixture.paths,
    recoverySnapshot,
  );

  const events = parsedEvents(fixture.paths);
  assert.equal(
    events.filter(
      (event) =>
        event.type === "task_transitioned" &&
        event.eventId === recovered.authentication.transitionEventId,
    ).length,
    1,
  );
  assert.equal(
    events.filter(
      (event) =>
        event.type === "outcome_recorded" &&
        event.eventId === recovered.authentication.controlEventId,
    ).length,
    1,
  );
  assert.equal(
    events.filter(
      (event) =>
        event.type === "outcome_reservation_finalized" &&
        event.taskId === TASK_ID &&
        event.data?.outcomeDigest === recovered.authentication.outcomeDigest,
    ).length,
    1,
  );
  const summary = summarizeOutcomeLedger(fixture.paths.outcomes, {
    stateRoot: fixture.stateRoot,
  });
  assert.equal(summary.sourceHealth.controlEventsHealthy, true);
  assert.equal(summary.sourceHealth.ledgerHealthy, true);
  assert.equal(
    summary.entries.filter(
      (entry) =>
        entry.taskId === TASK_ID &&
        entry.outcome === "merged" &&
        entry.authentication?.outcomeDigest ===
          recovered.authentication.outcomeDigest,
    ).length,
    1,
  );
  const completedTask = readTask({
    stateRoot: fixture.stateRoot,
    taskId: TASK_ID,
  });
  assert.equal(completedTask.state, "merged");
  assert.equal(completedTask.pendingOutcome, undefined);
  assert.equal(
    completedTask.details.latestOutcome.outcomeDigest,
    recovered.authentication.outcomeDigest,
  );
});

test("outcome append accepts the exact ledger cap and fails the next byte without mutation", (t) => {
  const ledgerCap = 16 * 1024 * 1024;
  const pilot = validatedOutcomeFixture(t);
  appendOutcomeLedger(
    pilot.paths.outcomes,
    { ...pilot.entry, notes: "" },
    {
      stateRoot: pilot.stateRoot,
      authentication: pilot.authentication,
      now: pilot.now,
    },
  );
  const emptyNotesLineSize = statSync(pilot.paths.outcomes).size;
  assert.ok(emptyNotesLineSize < ledgerCap);

  const fixture = validatedOutcomeFixture(t);
  const paddingLength = ledgerCap - emptyNotesLineSize;
  appendOutcomeLedger(
    fixture.paths.outcomes,
    { ...fixture.entry, notes: "x".repeat(paddingLength) },
    {
      stateRoot: fixture.stateRoot,
      authentication: fixture.authentication,
      now: fixture.now,
    },
  );
  assert.equal(statSync(fixture.paths.outcomes).size, ledgerCap);
  assert.equal(
    summarizeOutcomeLedger(fixture.paths.outcomes, {
      stateRoot: fixture.stateRoot,
    }).sourceHealth.ledgerHealthy,
    true,
  );

  const manifestBeforeFailure = readFileSync(fixture.paths.taskManifest);
  const eventsBeforeFailure = readFileSync(fixture.paths.events);
  const ledgerBeforeFailure = readFileSync(fixture.paths.outcomes);
  assert.throws(
    () =>
      appendOutcomeLedger(
        fixture.paths.outcomes,
        {
          id: TASK_ID,
          taskId: TASK_ID,
          kind: "stability",
          outcome: "installed",
          evidenceDigest: "c".repeat(64),
          installedIdentity: {
            version: "26.7.1802",
            commitSha: "d".repeat(40),
            channel: "dev",
          },
        },
        {
          stateRoot: fixture.stateRoot,
          authentication: fixture.authentication,
          now: new Date(fixture.now.getTime() + 60_000),
        },
      ),
    /supported repair boundary|outcome ledger append/i,
  );
  assert.equal(
    readFileSync(fixture.paths.taskManifest).equals(manifestBeforeFailure),
    true,
  );
  assert.equal(
    readFileSync(fixture.paths.events).equals(eventsBeforeFailure),
    true,
  );
  assert.equal(
    readFileSync(fixture.paths.outcomes).equals(ledgerBeforeFailure),
    true,
  );
});

test("outcome append accepts the exact event cap and preflight failure is byte-stable", (t) => {
  const eventCap = 128 * 1024 * 1024;
  const { stateRoot, paths } = temporaryStateRoot(t);
  const { nightly, nowMs } = trustedMergedOutcome(stateRoot);
  const eventSize = statSync(paths.events).size;
  const prefix = Buffer.from(
    '{"type":"event_boundary_padding","payload":"',
    "utf8",
  );
  const suffix = Buffer.from('"}\n', "utf8");
  const payloadSize = eventCap - eventSize - prefix.length - suffix.length;
  assert.ok(payloadSize > 0);
  appendFileSync(
    paths.events,
    Buffer.concat([prefix, Buffer.alloc(payloadSize, 0x78), suffix]),
  );
  assert.equal(statSync(paths.events).size, eventCap);
  assert.equal(
    summarizeOutcomeLedger(paths.outcomes, { stateRoot }).sourceHealth
      .ledgerHealthy,
    true,
  );

  const manifestBeforeFailure = readFileSync(paths.taskManifest);
  const eventsBeforeFailure = readFileSync(paths.events);
  const ledgerBeforeFailure = readFileSync(paths.outcomes);
  assert.throws(
    () =>
      appendOutcomeLedger(
        paths.outcomes,
        {
          id: TASK_ID,
          taskId: TASK_ID,
          kind: "stability",
          outcome: "installed",
          evidenceDigest: "e".repeat(64),
          installedIdentity: {
            version: "26.7.1803",
            commitSha: "f".repeat(40),
            channel: "dev",
          },
        },
        {
          stateRoot,
          authentication: nightly,
          now: new Date(nowMs + 60_000),
        },
      ),
    /repair boundary|unsafe|control event|supported/i,
  );
  assert.equal(
    readFileSync(paths.taskManifest).equals(manifestBeforeFailure),
    true,
  );
  assert.equal(readFileSync(paths.events).equals(eventsBeforeFailure), true);
  assert.equal(readFileSync(paths.outcomes).equals(ledgerBeforeFailure), true);
});

test("the append call recovers a pending task transaction and records one outcome", (t) => {
  const fixture = validatedOutcomeFixture(t);
  const entry = { ...fixture.entry, notes: "pending transaction recovery" };
  const options = {
    stateRoot: fixture.stateRoot,
    authentication: fixture.authentication,
    now: fixture.now,
  };
  const manifestBefore = readFileSync(fixture.paths.taskManifest);
  const eventsBefore = readFileSync(fixture.paths.events);
  assert.throws(
    () =>
      appendOutcomeLedger(fixture.paths.outcomes, entry, {
        ...options,
        checkpoint: (checkpoint) => {
          if (checkpoint === "outcome-transition-resolved") {
            throw new Error("simulate loss before task transaction cleanup");
          }
        },
      }),
    /simulate loss before task transaction cleanup/,
  );
  const targetManifest = JSON.parse(
    readFileSync(fixture.paths.taskManifest, "utf8"),
  );
  const transitionEvent = parsedEvents(fixture.paths).find(
    (event) =>
      event.type === "task_transitioned" &&
      event.taskId === TASK_ID &&
      event.data?.toState === "merged" &&
      event.data?.outcomeRequired === true,
  );
  assert.ok(transitionEvent);

  writeFileSync(fixture.paths.taskManifest, manifestBefore, { mode: 0o600 });
  writeFileSync(fixture.paths.events, eventsBefore, { mode: 0o600 });
  rmSync(fixture.paths.outcomes, { force: true });
  ensurePrivateDirectoryTree(fixture.stateRoot, fixture.paths.taskTransactions);
  const transaction = {
    schemaVersion: 1,
    transactionId: "pending-outcome-append-recovery",
    preparedAt: transitionEvent.ts,
    previousManifestRevision: JSON.parse(manifestBefore.toString("utf8"))
      .revision,
    targetManifest,
    event: transitionEvent,
  };
  const transactionPath = path.join(
    fixture.paths.taskTransactions,
    `${String(targetManifest.revision).padStart(12, "0")}-pending-outcome-append-recovery.json`,
  );
  writeFileSync(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`, {
    mode: 0o600,
  });

  const recovered = appendOutcomeLedger(fixture.paths.outcomes, entry, options);
  assert.equal(existsSync(transactionPath), false);
  assert.equal(
    recovered.authentication.transitionEventId,
    transitionEvent.eventId,
  );
  const manifestAfterRecovery = readFileSync(fixture.paths.taskManifest);
  const eventsAfterRecovery = readFileSync(fixture.paths.events);
  const ledgerAfterRecovery = readFileSync(fixture.paths.outcomes);
  const idempotent = appendOutcomeLedger(
    fixture.paths.outcomes,
    entry,
    options,
  );
  assert.deepEqual(idempotent, recovered);
  assert.equal(
    readFileSync(fixture.paths.taskManifest).equals(manifestAfterRecovery),
    true,
  );
  assert.equal(
    readFileSync(fixture.paths.events).equals(eventsAfterRecovery),
    true,
  );
  assert.equal(
    readFileSync(fixture.paths.outcomes).equals(ledgerAfterRecovery),
    true,
  );
  const events = parsedEvents(fixture.paths);
  assert.equal(
    events.filter(
      (event) => event.eventId === recovered.authentication.transitionEventId,
    ).length,
    1,
  );
  assert.equal(
    events.filter(
      (event) => event.eventId === recovered.authentication.controlEventId,
    ).length,
    1,
  );
  assert.equal(
    summarizeOutcomeLedger(fixture.paths.outcomes, {
      stateRoot: fixture.stateRoot,
    }).entries.filter(
      (candidate) =>
        candidate.authentication?.outcomeDigest ===
        recovered.authentication.outcomeDigest,
    ).length,
    1,
  );
  assert.equal(
    readTask({ stateRoot: fixture.stateRoot, taskId: TASK_ID }).state,
    "merged",
  );
});

test("an installed outcome id above the control event line cap fails before mutation", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const { nightly, nowMs } = trustedMergedOutcome(stateRoot, Date.now());
  const oversizedId = "i".repeat(1024 * 1024 + 128);
  assert.equal(Buffer.byteLength(oversizedId), 1024 * 1024 + 128);
  const before = outcomeMutationSnapshot(stateRoot, paths);

  assert.throws(
    () =>
      appendOutcomeLedger(
        paths.outcomes,
        {
          id: oversizedId,
          taskId: TASK_ID,
          kind: "stability",
          outcome: "installed",
          evidenceDigest: "1".repeat(64),
          installedIdentity: {
            version: "26.7.1804",
            commitSha: "2".repeat(40),
            channel: "dev",
          },
        },
        {
          stateRoot,
          authentication: nightly,
          now: new Date(nowMs + 60_000),
        },
      ),
    /outcome control event.*supported line boundary/i,
  );

  assertOutcomeMutationSnapshot(stateRoot, paths, before);
});

test("an installed identity version above the control event line cap fails before task transition mutation", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const { nightly, nowMs } = trustedMergedOutcome(stateRoot, Date.now());
  const oversizedVersion = "3".repeat(1024 * 1024 + 128);
  assert.equal(Buffer.byteLength(oversizedVersion), 1024 * 1024 + 128);
  const before = outcomeMutationSnapshot(stateRoot, paths);

  assert.throws(
    () =>
      appendOutcomeLedger(
        paths.outcomes,
        {
          id: TASK_ID,
          taskId: TASK_ID,
          kind: "stability",
          outcome: "installed",
          evidenceDigest: "4".repeat(64),
          installedIdentity: {
            version: oversizedVersion,
            commitSha: "5".repeat(40),
            channel: "dev",
          },
        },
        {
          stateRoot,
          authentication: nightly,
          now: new Date(nowMs + 60_000),
        },
      ),
    /control event append.*supported history boundary/i,
  );

  assertOutcomeMutationSnapshot(stateRoot, paths, before);
});

test("an existing ledger with an interior blank and 100,001 physical lines is unhealthy and blocks append", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const { nightly, nowMs } = trustedMergedOutcome(stateRoot, Date.now());
  const trustedLine = readFileSync(paths.outcomes);
  const malformedLedger = Buffer.concat([
    trustedLine,
    Buffer.from("\n", "utf8"),
    Buffer.from("{}\n".repeat(99_999), "utf8"),
  ]);
  assert.equal(
    malformedLedger.reduce((count, byte) => count + (byte === 0x0a ? 1 : 0), 0),
    100_001,
  );
  writeFileSync(paths.outcomes, malformedLedger, { mode: 0o600 });
  chmodSync(paths.outcomes, 0o600);

  const summary = summarizeOutcomeLedger(paths.outcomes, { stateRoot });
  assert.equal(summary.sourceHealth.ledgerSyntaxHealthy, false);
  assert.equal(summary.sourceHealth.ledgerHealthy, false);
  assert.deepEqual(summary.sourceHealth.malformedLedgerLines, [2]);
  const before = outcomeMutationSnapshot(stateRoot, paths);

  assert.throws(
    () =>
      appendOutcomeLedger(
        paths.outcomes,
        {
          id: TASK_ID,
          taskId: TASK_ID,
          kind: "stability",
          outcome: "installed",
          evidenceDigest: "6".repeat(64),
          installedIdentity: {
            version: "26.7.1805",
            commitSha: "7".repeat(40),
            channel: "dev",
          },
        },
        {
          stateRoot,
          authentication: nightly,
          now: new Date(nowMs + 60_000),
        },
      ),
    /blank interior physical line|supported physical line boundary/i,
  );

  assertOutcomeMutationSnapshot(stateRoot, paths, before);
});

test("safe source admission rejects symlinks, writable files, oversize files, and invalid bytes", async (t) => {
  await t.test("symlink", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const target = path.join(stateRoot, "legacy-target.jsonl");
    writeFileSync(target, legacyLine("symlink-target"), { mode: 0o600 });
    symlinkSync(target, paths.outcomes);
    assert.throws(
      () =>
        planOutcomeLedgerRepair({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sha256(readFileSync(target)),
        }),
      /ELOOP|Unsafe outcome ledger repair file/,
    );
  });

  await t.test("group writable", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const source = legacyLine("writable");
    const sourceDigest = writeLedger(paths, source, 0o664);
    assert.throws(
      () =>
        planOutcomeLedgerRepair({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
        }),
      /Unsafe outcome ledger repair file/,
    );
  });

  await t.test("oversize", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    writeFileSync(paths.outcomes, "", { mode: 0o600 });
    truncateSync(paths.outcomes, OUTCOME_LEDGER_REPAIR_MAX_BYTES + 1);
    assert.throws(
      () =>
        planOutcomeLedgerRepair({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: "0".repeat(64),
        }),
      /Unsafe outcome ledger repair file/,
    );
  });

  await t.test("invalid UTF-8", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const source = Buffer.from([
      0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d, 0x0a,
    ]);
    const sourceDigest = writeLedger(paths, source, 0o600);
    assert.throws(
      () =>
        planOutcomeLedgerRepair({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
        }),
      /not valid UTF-8/,
    );
  });

  await t.test("blank physical line", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const source = Buffer.concat([
      legacyLine("before-blank"),
      Buffer.from("\n", "utf8"),
    ]);
    const sourceDigest = writeLedger(paths, source, 0o600);
    assert.throws(
      () =>
        planOutcomeLedgerRepair({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
        }),
      /line 2 is blank/,
    );
  });

  await t.test("malformed JSON", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const source = Buffer.from('{"incomplete":true\n', "utf8");
    const sourceDigest = writeLedger(paths, source, 0o600);
    assert.throws(
      () =>
        planOutcomeLedgerRepair({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
        }),
      /line 1 is malformed JSON/,
    );
  });
});

test("FIFO admission is bounded in a child process", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const created = spawnSync("mkfifo", [paths.outcomes], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  const childScript = `
    import { planOutcomeLedgerRepair } from ${JSON.stringify(MODULE_URL)};
    try {
      planOutcomeLedgerRepair({
        stateRoot: ${JSON.stringify(stateRoot)},
        taskId: ${JSON.stringify(TASK_ID)},
        expectedSourceDigest: ${JSON.stringify("0".repeat(64))},
      });
      process.exit(2);
    } catch (error) {
      if (!/Unsafe outcome ledger repair file/.test(String(error?.message))) {
        console.error(error?.stack ?? error);
        process.exit(3);
      }
    }
  `;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", childScript],
    { encoding: "utf8", timeout: 2_000 },
  );
  assert.notEqual(child.error?.code, "ETIMEDOUT");
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
});

test("nightly summary rejects canonical outcome and event FIFOs without hanging", async (t) => {
  await t.test("outcomes FIFO", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const created = spawnSync("mkfifo", [paths.outcomes], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    const child = summaryHealthInChild({
      stateRoot,
      ledgerPath: paths.outcomes,
      field: "ledgerSyntaxHealthy",
    });
    assert.notEqual(child.error?.code, "ETIMEDOUT");
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr);
  });

  await t.test("events FIFO", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    writeLedger(paths, legacyLine("events-fifo-ledger"));
    rmSync(paths.events);
    const created = spawnSync("mkfifo", [paths.events], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    const child = summaryHealthInChild({
      stateRoot,
      ledgerPath: paths.outcomes,
      field: "controlEventsHealthy",
    });
    assert.notEqual(child.error?.code, "ETIMEDOUT");
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr);
  });
});

test("nightly summary rejects canonical outcome and event symlinks without following them", async (t) => {
  await t.test("outcomes symlink", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const target = path.join(stateRoot, "valid-outcomes-target.jsonl");
    writeFileSync(target, `${JSON.stringify({ syntactically: "valid" })}\n`, {
      mode: 0o600,
    });
    symlinkSync(target, paths.outcomes);
    const child = summaryHealthInChild({
      stateRoot,
      ledgerPath: paths.outcomes,
      field: "ledgerSyntaxHealthy",
    });
    assert.notEqual(child.error?.code, "ETIMEDOUT");
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr);
  });

  await t.test("events symlink", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    writeLedger(paths, legacyLine("events-symlink-ledger"));
    const target = path.join(stateRoot, "valid-events-target.jsonl");
    writeFileSync(target, readFileSync(paths.events), { mode: 0o600 });
    rmSync(paths.events);
    symlinkSync(target, paths.events);
    const child = summaryHealthInChild({
      stateRoot,
      ledgerPath: paths.outcomes,
      field: "controlEventsHealthy",
    });
    assert.notEqual(child.error?.code, "ETIMEDOUT");
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr);
  });
});

test("completed repair health fails closed for missing or reformatted evidence", async (t) => {
  await t.test("missing source archive", () => {
    const fixture = completedLegacyRepair(t, "missing-complete-source");
    rmSync(fixture.plan.artifacts.sourceArtifact);
    assert.throws(
      () =>
        executeRepair({
          stateRoot: fixture.stateRoot,
          sourceDigest: fixture.sourceDigest,
        }),
      /source|artifact|ENOENT/i,
    );
    assert.equal(
      summarizeOutcomeLedger(fixture.paths.outcomes, {
        stateRoot: fixture.stateRoot,
      }).sourceHealth.ledgerHealthy,
      false,
    );
  });

  await t.test("missing decisions archive", () => {
    const fixture = completedLegacyRepair(t, "missing-complete-decisions");
    rmSync(fixture.plan.artifacts.decisionsArtifact);
    assert.throws(
      () =>
        executeRepair({
          stateRoot: fixture.stateRoot,
          sourceDigest: fixture.sourceDigest,
        }),
      /decision|artifact|ENOENT/i,
    );
    assert.equal(
      summarizeOutcomeLedger(fixture.paths.outcomes, {
        stateRoot: fixture.stateRoot,
      }).sourceHealth.ledgerHealthy,
      false,
    );
  });

  await t.test("receipt formatting drift", () => {
    const fixture = completedLegacyRepair(t, "receipt-formatting-drift");
    const receipt = JSON.parse(
      readFileSync(fixture.plan.artifacts.receiptArtifact, "utf8"),
    );
    const compactBytes = Buffer.from(`${JSON.stringify(receipt)}\n`, "utf8");
    assert.equal(stableJson(receipt), stableJson(fixture.plan.receipt));
    assert.equal(
      compactBytes.equals(readFileSync(fixture.plan.artifacts.receiptArtifact)),
      false,
    );
    writeFileSync(fixture.plan.artifacts.receiptArtifact, compactBytes, {
      mode: 0o600,
    });
    assert.throws(
      () =>
        executeRepair({
          stateRoot: fixture.stateRoot,
          sourceDigest: fixture.sourceDigest,
        }),
      /receipt bytes changed|receipt drifted/i,
    );
    const health = summarizeOutcomeLedger(fixture.paths.outcomes, {
      stateRoot: fixture.stateRoot,
    }).sourceHealth;
    assert.equal(health.ledgerHealthy, false);
    assert.ok(
      health.outcomeLedgerTransactionIssues.some((issue) =>
        /receipt drifted/.test(issue),
      ),
    );
  });

  await t.test("missing audit event", () => {
    const fixture = completedLegacyRepair(t, "missing-complete-audit");
    const retained = readFileSync(fixture.paths.events, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => JSON.parse(line).eventId !== fixture.plan.eventId);
    writeFileSync(fixture.paths.events, `${retained.join("\n")}\n`, {
      mode: 0o600,
    });
    assert.equal(
      repairAuditEvents(fixture.paths, fixture.plan.eventId).length,
      0,
    );
    assert.throws(
      () =>
        executeRepair({
          stateRoot: fixture.stateRoot,
          sourceDigest: fixture.sourceDigest,
        }),
      /exactly one audit event|no longer validates/i,
    );
    assert.equal(
      summarizeOutcomeLedger(fixture.paths.outcomes, {
        stateRoot: fixture.stateRoot,
      }).sourceHealth.ledgerHealthy,
      false,
    );
  });
});

test("a completed repair event cannot outlive its canonical transaction", (t) => {
  const fixture = completedLegacyRepair(t, "missing-complete-transaction");
  rmSync(fixture.plan.artifacts.transaction);
  assert.equal(existsSync(fixture.plan.artifacts.sourceArtifact), true);
  assert.equal(existsSync(fixture.plan.artifacts.receiptArtifact), true);
  assert.equal(
    repairAuditEvents(fixture.paths, fixture.plan.eventId).length,
    1,
  );
  const health = summarizeOutcomeLedger(fixture.paths.outcomes, {
    stateRoot: fixture.stateRoot,
  }).sourceHealth;
  assert.equal(health.ledgerHealthy, false);
  assert.ok(
    health.outcomeLedgerTransactionIssues.some(
      (issue) =>
        issue.includes(fixture.plan.eventId) &&
        /missing|orphan|transaction/i.test(issue),
    ),
  );
});

test("nightly health rejects raw 0xff inside an otherwise complete transaction", (t) => {
  const fixture = completedLegacyRepair(t, "invalid-utf8-transaction");
  const validBytes = readFileSync(fixture.plan.artifacts.transaction);
  const invalidBytes = Buffer.concat([
    validBytes.subarray(0, validBytes.length - 1),
    Buffer.from([0xff]),
    validBytes.subarray(validBytes.length - 1),
  ]);
  writeFileSync(fixture.plan.artifacts.transaction, invalidBytes, {
    mode: 0o600,
  });
  const health = summarizeOutcomeLedger(fixture.paths.outcomes, {
    stateRoot: fixture.stateRoot,
  }).sourceHealth;
  assert.equal(health.ledgerHealthy, false);
  assert.ok(
    health.outcomeLedgerTransactionIssues.some((issue) => /UTF-8/i.test(issue)),
  );
});

test("a completed transaction rejects a traversal task ID before artifact path use", (t) => {
  const fixture = completedLegacyRepair(t, "traversal-task-id");
  const record = JSON.parse(
    readFileSync(fixture.plan.artifacts.transaction, "utf8"),
  );
  record.taskId = "../../../../out-of-root-probe";
  writeFileSync(
    fixture.plan.artifacts.transaction,
    `${JSON.stringify(record, null, 2)}\n`,
    { mode: 0o600 },
  );
  const health = summarizeOutcomeLedger(fixture.paths.outcomes, {
    stateRoot: fixture.stateRoot,
  }).sourceHealth;
  assert.equal(health.ledgerHealthy, false);
  assert.ok(
    health.outcomeLedgerTransactionIssues.some((issue) =>
      /identity is invalid|invalid transaction record/i.test(issue),
    ),
  );
  assert.equal(
    health.outcomeLedgerTransactionIssues.some((issue) =>
      /ENOENT|out-of-root-probe/.test(issue),
    ),
    false,
  );
  assert.throws(
    () =>
      executeRepair({
        stateRoot: fixture.stateRoot,
        sourceDigest: fixture.sourceDigest,
      }),
    /stable task ID|transaction identity|parameter identities/i,
  );
});

test("completed repair retry and nightly health reject redirected or public ancestors", async (t) => {
  await t.test("symlinked artifact ancestor", () => {
    const fixture = completedLegacyRepair(t, "symlinked-artifact-ancestor");
    const ancestor = path.join(
      fixture.stateRoot,
      "artifacts",
      "outcome-ledger-repair",
      TASK_ID,
    );
    const redirected = path.join(fixture.stateRoot, "redirected-artifacts");
    renameSync(ancestor, redirected);
    symlinkSync(redirected, ancestor);
    assert.throws(
      () =>
        executeRepair({
          stateRoot: fixture.stateRoot,
          sourceDigest: fixture.sourceDigest,
        }),
      /private canonical|artifact directory is unsafe/i,
    );
    assert.equal(
      summarizeOutcomeLedger(fixture.paths.outcomes, {
        stateRoot: fixture.stateRoot,
      }).sourceHealth.ledgerHealthy,
      false,
    );
  });

  await t.test("artifact ancestor mode drift", () => {
    const fixture = completedLegacyRepair(t, "artifact-ancestor-mode-drift");
    const ancestor = path.join(
      fixture.stateRoot,
      "artifacts",
      "outcome-ledger-repair",
    );
    chmodSync(ancestor, 0o755);
    try {
      assert.throws(
        () =>
          executeRepair({
            stateRoot: fixture.stateRoot,
            sourceDigest: fixture.sourceDigest,
          }),
        /private canonical|artifact directory is unsafe/i,
      );
      assert.equal(
        summarizeOutcomeLedger(fixture.paths.outcomes, {
          stateRoot: fixture.stateRoot,
        }).sourceHealth.ledgerHealthy,
        false,
      );
    } finally {
      chmodSync(ancestor, 0o700);
    }
  });

  await t.test("control root mode drift", () => {
    const fixture = completedLegacyRepair(t, "control-root-mode-drift");
    chmodSync(fixture.paths.controlRoot, 0o755);
    try {
      assert.throws(
        () =>
          executeRepair({
            stateRoot: fixture.stateRoot,
            sourceDigest: fixture.sourceDigest,
          }),
        /private canonical|private physical directory|unsafe/i,
      );
      assert.equal(
        summarizeOutcomeLedger(fixture.paths.outcomes, {
          stateRoot: fixture.stateRoot,
        }).sourceHealth.ledgerHealthy,
        false,
      );
    } finally {
      chmodSync(fixture.paths.controlRoot, 0o700);
    }
  });
});

test("completed repair health counts reconstructed decision dispositions", (t) => {
  const fixture = completedMixedRepair(t, "disposition-count-drift");
  const rewritten = rewriteCompletedRepair({
    stateRoot: fixture.stateRoot,
    paths: fixture.paths,
    plan: fixture.plan,
    trustedCount: 2,
    rejectedCount: 0,
  });
  const decisions = JSON.parse(
    readFileSync(rewritten.artifacts.decisions, "utf8"),
  );
  assert.equal(
    decisions.lines.filter((line) => line.disposition === "trusted").length,
    1,
  );
  assert.equal(
    decisions.lines.filter((line) => line.disposition === "rejected").length,
    1,
  );
  assert.equal(rewritten.parameters.trustedCount, 2);
  assert.equal(rewritten.parameters.rejectedCount, 0);
  const health = summarizeOutcomeLedger(fixture.paths.outcomes, {
    stateRoot: fixture.stateRoot,
  }).sourceHealth;
  assert.equal(health.ledgerHealthy, false);
  assert.ok(
    health.outcomeLedgerTransactionIssues.some((issue) =>
      /raw archives drifted|disposition count/i.test(issue),
    ),
    JSON.stringify(health.outcomeLedgerTransactionIssues),
  );
});

test("completed repair health rejects invalid UTF-8 and over-limit source archives", async (t) => {
  await t.test("exact raw 0xff source archive", () => {
    const fixture = completedLegacyRepair(t, "invalid-utf8-source-archive");
    const invalidBytes = Buffer.from([0xff]);
    const rewritten = rewriteCompletedRepair({
      stateRoot: fixture.stateRoot,
      paths: fixture.paths,
      plan: fixture.plan,
      sourceBytes: invalidBytes,
      rejectedBytes: invalidBytes,
      sourceLineCount: 1,
      trustedCount: 0,
      rejectedCount: 1,
    });
    const health = summarizeOutcomeLedger(fixture.paths.outcomes, {
      stateRoot: fixture.stateRoot,
    }).sourceHealth;
    assert.equal(health.ledgerHealthy, false);
    assert.ok(
      health.outcomeLedgerTransactionIssues.some((issue) =>
        /UTF-8/i.test(issue),
      ),
      JSON.stringify(health.outcomeLedgerTransactionIssues),
    );
    assert.throws(
      () =>
        repairOutcomeLedger({
          stateRoot: fixture.stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: rewritten.parameters.sourceDigest,
          ...fixture.owner,
        }),
      /UTF-8/i,
    );
  });

  await t.test("more than 100,000 physical lines", () => {
    const fixture = completedLegacyRepair(t, "over-limit-source-lines");
    const sourceBytes = Buffer.from("{}\n".repeat(100_001), "utf8");
    const rewritten = rewriteCompletedRepair({
      stateRoot: fixture.stateRoot,
      paths: fixture.paths,
      plan: fixture.plan,
      sourceBytes,
      rejectedBytes: sourceBytes,
      sourceLineCount: 100_001,
      trustedCount: 0,
      rejectedCount: 100_001,
    });
    const health = summarizeOutcomeLedger(fixture.paths.outcomes, {
      stateRoot: fixture.stateRoot,
    }).sourceHealth;
    assert.equal(health.ledgerHealthy, false);
    assert.ok(
      health.outcomeLedgerTransactionIssues.some((issue) =>
        /too many physical lines|100,000/i.test(issue),
      ),
      JSON.stringify(health.outcomeLedgerTransactionIssues),
    );
    assert.throws(
      () =>
        repairOutcomeLedger({
          stateRoot: fixture.stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: rewritten.parameters.sourceDigest,
          ...fixture.owner,
        }),
      /too many physical lines|100,000/i,
    );
  });
});

test("completed repair retry and nightly health share the bound event prefix", (t) => {
  const fixture = completedLegacyRepair(t, "shared-event-prefix-drift");
  const events = readFileSync(fixture.paths.events);
  const prefix = events.subarray(0, fixture.plan.parameters.eventHistorySize);
  const marker = Buffer.from('"eventId":"', "utf8");
  const markerOffset = prefix.indexOf(marker);
  assert.ok(markerOffset >= 0);
  const mutationOffset = markerOffset + marker.length;
  events[mutationOffset] =
    events[mutationOffset] === "a".charCodeAt(0)
      ? "b".charCodeAt(0)
      : "a".charCodeAt(0);
  writeFileSync(fixture.paths.events, events, { mode: 0o600 });
  const summary = summarizeOutcomeLedger(fixture.paths.outcomes, {
    stateRoot: fixture.stateRoot,
  });
  assert.equal(summary.sourceHealth.controlEventsHealthy, true);
  assert.equal(summary.sourceHealth.ledgerHealthy, false);
  assert.ok(
    summary.sourceHealth.outcomeLedgerTransactionIssues.some((issue) =>
      /event prefix drifted/i.test(issue),
    ),
  );
  assert.throws(
    () =>
      executeRepair({
        stateRoot: fixture.stateRoot,
        sourceDigest: fixture.sourceDigest,
      }),
    /event prefix drifted|no longer validates/i,
  );
});

test("an exact raw 0xff event suffix is rejected by nightly and completed retry", (t) => {
  const fixture = completedLegacyRepair(t, "invalid-utf8-event-suffix");
  appendFileSync(fixture.paths.events, Buffer.from([0xff]));
  const summary = summarizeOutcomeLedger(fixture.paths.outcomes, {
    stateRoot: fixture.stateRoot,
  });
  assert.equal(summary.sourceHealth.controlEventsHealthy, false);
  assert.equal(summary.sourceHealth.ledgerHealthy, false);
  assert.throws(
    () =>
      executeRepair({
        stateRoot: fixture.stateRoot,
        sourceDigest: fixture.sourceDigest,
      }),
    /UTF-8|control event/i,
  );
});

test("a valid append-only event suffix above 16 MiB stays accepted below 128 MiB", (t) => {
  const fixture = completedLegacyRepair(t, "large-valid-event-suffix");
  const beforeSize = statSync(fixture.paths.events).size;
  const targetSize = 17 * 1024 * 1024;
  const prefix = Buffer.from(
    '{"type":"unrelated_append_only_suffix","payload":"',
    "utf8",
  );
  const suffix = Buffer.from('"}\n', "utf8");
  const payloadSize = targetSize - beforeSize - prefix.length - suffix.length;
  assert.ok(payloadSize > 0);
  appendFileSync(
    fixture.paths.events,
    Buffer.concat([prefix, Buffer.alloc(payloadSize, 0x78), suffix]),
  );
  const grownSize = statSync(fixture.paths.events).size;
  assert.ok(grownSize > 16 * 1024 * 1024);
  assert.ok(grownSize < 128 * 1024 * 1024);
  const summary = summarizeOutcomeLedger(fixture.paths.outcomes, {
    stateRoot: fixture.stateRoot,
  });
  assert.equal(summary.sourceHealth.controlEventsHealthy, true);
  assert.equal(summary.sourceHealth.ledgerHealthy, true);
  const replay = executeRepair({
    stateRoot: fixture.stateRoot,
    sourceDigest: fixture.sourceDigest,
  });
  assert.equal(replay.changed, false);
  assert.equal(
    repairAuditEvents(fixture.paths, fixture.plan.eventId).length,
    1,
  );
});

for (const checkpointName of [
  "source-archived",
  "trusted-archived",
  "rejected-archived",
  "decisions-archived",
  "transaction-prepared",
  "replacement-synced",
  "replacement-renamed",
  "replacement-directory-synced",
  "transaction-replaced",
  "event-audited",
  "transaction-audited",
  "receipt-written",
  "transaction-complete",
]) {
  test(`recovers idempotently after ${checkpointName}`, (t) => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const source = legacyLine(`crash-${checkpointName}`);
    const sourceDigest = writeLedger(paths, source);
    let armed = true;
    const plan = repairSession(stateRoot, sourceDigest).plan;
    assert.throws(
      () =>
        executeRepair(
          { stateRoot, sourceDigest },
          {
            checkpoint: (checkpoint) => {
              if (armed && checkpoint === checkpointName) {
                armed = false;
                throw new Error(`simulated crash at ${checkpointName}`);
              }
            },
          },
        ),
      new RegExp(`simulated crash at ${checkpointName}`),
    );

    const recovered = executeRepair({ stateRoot, sourceDigest });
    assert.equal(
      recovered.changed,
      checkpointName === "transaction-complete" ? false : true,
    );
    assert.equal(readFileSync(paths.outcomes).length, 0);
    assert.equal(
      readFileSync(paths.events, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((event) => event.eventId === plan.eventId).length,
      1,
    );
    assert.equal(
      summarizeOutcomeLedger(paths.outcomes, { stateRoot }).sourceHealth
        .ledgerHealthy,
      true,
    );

    const replay = executeRepair({ stateRoot, sourceDigest });
    assert.equal(replay.changed, false);
    assert.equal(
      readFileSync(paths.events, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((event) => event.eventId === plan.eventId).length,
      1,
    );
  });
}
