import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
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
  CONTROL_EVENT_HISTORY_MAX_RECORDS,
  acquireLease,
  automationControlPaths,
  consumeLeaseArchiveHelperInvocationCountForTest,
  createTask,
  framePinnedLeaseArchiveHelperInvocation,
  heartbeatLease,
  processStartIdentity,
  readTask,
  releaseLease,
  transitionTask,
  withAutomationPlanningReadBundle,
  withOutcomeLedgerRepairFinalizationGuard,
} from "./lib/automation-control.mjs";
import {
  planOutcomeLedgerRepair,
  repairOutcomeLedger,
} from "./lib/outcome-ledger-repair.mjs";
import {
  OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  OUTCOME_LEDGER_REPAIR_MAX_LINE_BYTES,
  OUTCOME_LEDGER_REPAIR_MAX_LINES,
  orderedOutcomeLedgerRepairEventPlan,
  orderedOutcomeLedgerRepairParameters,
  prepareOutcomeLedgerAppend,
} from "./lib/outcome-ledger-repair-contract.mjs";
import {
  appendOutcomeLedger,
  planOutcomeRecord,
  summarizeOutcomeLedger,
} from "./nightly-self-improve.mjs";
import { writeMeasuredOutcomeVerdict } from "./test-helpers/outcome-evidence.mjs";
import { installAutomationKernelGuardCutoverFixture } from "./test-helpers/automation-kernel-guard.mjs";
import {
  TRUSTED_ACTOR_CONTROL_MODULE_URL,
  acquireGeneralActorLeaseForTest,
} from "./test-helpers/trusted-actor-lease.mjs";

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
const MOVE_HELPER_PATH = path.join(
  import.meta.dirname,
  "lib",
  "lease-archive-move.py",
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pinnedRegularFileSnapshot(filePath) {
  const descriptor = openSync(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeNs, before.mtimeNs);
    assert.equal(after.ctimeNs, before.ctimeNs);
    return { bytes, identity: after };
  } finally {
    closeSync(descriptor);
  }
}

function isUnsafeAuthorityAdmission(error) {
  return (
    error instanceof Error &&
    /could not be admitted safely/i.test(error.message)
  );
}

function isRepairTopologySafetyError(error) {
  return (
    error instanceof Error &&
    /hard-linked|could not be admitted safely|operation directory has a foreign entry|topology is not one admitted repair file|unsafe outcome ledger repair (?:cleanup temporary preflight|file)/i.test(
      error.message,
    )
  );
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
  t.after(() => {
    if (process.env.FREED_TEST_KEEP_OUTCOME_REPAIR_STATE === "1") {
      console.error(`preserved outcome repair fixture: ${stateRoot}`);
      return;
    }
    rmSync(stateRoot, { recursive: true, force: true });
  });
  installAutomationKernelGuardCutoverFixture(stateRoot);
  const paths = automationControlPaths(stateRoot);
  mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
  chmodSync(paths.controlRoot, 0o700);
  writeFileSync(paths.events, "", { mode: 0o600 });
  chmodSync(paths.events, 0o600);
  writeFileSync(paths.outcomes, "", { mode: 0o600 });
  chmodSync(paths.outcomes, 0o600);
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
    expiresAt: new Date(
      nowMs + Math.max(ttlMs, 60_000) + 60 * 60_000,
    ).toISOString(),
  };
  writeFileSync(confirmationPath, `${JSON.stringify(confirmation)}\n`, {
    mode: 0o600,
  });
  const acquired = withFrozenDateNow(nowMs + 1, () =>
    acquireLease({
      stateRoot,
      name: "owner-governance",
      owner: "freed-owner",
      operationId: leaseMutationId("acquire:freed-owner"),
      token: `outcome-repair-owner-token-${ownerLeaseSequence}-${"x".repeat(64)}`,
      ttlMs,
      ownerConfirmationFile: confirmationPath,
      ownerCapabilityTaskId: taskId,
      ownerCapabilityIntentDigest: plan.intentDigest,
    }),
  );
  return {
    actor: "freed-owner",
    leaseName: "owner-governance",
    leaseToken: acquired.lease.token,
  };
}

function withLeaseAlmostExpired(stateRoot, leaseName, remainingMs, operation) {
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
  let eventPlan = null;
  if (!["fenced", "prepared"].includes(phase)) {
    const candidates = [
      plan.artifacts.transaction,
      plan.artifacts.completedTransaction,
      path.join(
        plan.artifacts.artifactDirectory,
        "transaction-staging",
        "transaction-prepared-to-replaced.json",
      ),
    ];
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8"));
        if (parsed?.eventPlan !== null && parsed?.eventPlan !== undefined) {
          eventPlan = orderedOutcomeLedgerRepairEventPlan(parsed.eventPlan);
          break;
        }
      } catch {
        continue;
      }
    }
    if (eventPlan === null) {
      throw new Error(`test plan has no bound event plan for ${phase}`);
    }
  }
  return {
    schemaVersion: 1,
    policy: "freed-outcome-ledger-repair-v1",
    taskId: plan.taskId,
    operationId: plan.operationId,
    phase,
    intentDigest: plan.intentDigest,
    eventId: plan.eventId,
    eventPlan,
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

function deterministicImmutableTemporaryPath(filePath, bytes) {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${sha256(bytes)}.tmp`,
  );
}

function snapshotTestTree(root) {
  const entries = [];
  const visit = (current, relativePath) => {
    const stats = lstatSync(current, { bigint: true });
    const common = {
      path: relativePath,
      mode: Number(stats.mode & 0o7777n),
      nlink: stats.nlink.toString(),
      size: stats.size.toString(),
      mtimeNs: stats.mtimeNs.toString(),
      ctimeNs: stats.ctimeNs.toString(),
    };
    if (stats.isDirectory()) {
      entries.push({ ...common, kind: "directory" });
      for (const name of readdirSync(current).sort()) {
        visit(
          path.join(current, name),
          relativePath === "" ? name : path.join(relativePath, name),
        );
      }
      return;
    }
    if (stats.isSymbolicLink()) {
      entries.push({
        ...common,
        kind: "symlink",
        target: readlinkSync(current),
      });
      return;
    }
    entries.push({
      ...common,
      kind: "file",
      digest: sha256(readFileSync(current)),
    });
  };
  visit(root, "");
  return entries;
}

function repairAuditEvents(paths, eventId) {
  return readFileSync(paths.events, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.eventId === eventId);
}

function removeAutomationAuthorityStages(filePath) {
  const directory = path.dirname(filePath);
  const prefix = `.${path.basename(filePath)}.authority.`;
  for (const name of readdirSync(directory)) {
    if (name.startsWith(prefix)) {
      rmSync(path.join(directory, name), { force: true });
    }
  }
}

function removeControlEventAuthorityStages(paths) {
  removeAutomationAuthorityStages(paths.events);
}

function rewriteControlEvent(paths, eventId, mutate) {
  removeControlEventAuthorityStages(paths);
  let matchCount = 0;
  const lines = readFileSync(paths.events, "utf8").split("\n");
  const rewritten = lines.map((line) => {
    if (!line) return line;
    const event = JSON.parse(line);
    if (event.eventId !== eventId) return line;
    matchCount += 1;
    mutate(event);
    return JSON.stringify(event);
  });
  assert.equal(matchCount, 1);
  const bytes = Buffer.from(rewritten.join("\n"), "utf8");
  writeFileSync(paths.events, bytes, { mode: 0o600 });
  chmodSync(paths.events, 0o600);
  return bytes;
}

function completedLegacyRepair(
  t,
  id = "completed-health-fixture",
  { beforePlan = () => {} } = {},
) {
  const fixture = temporaryStateRoot(t);
  beforePlan(fixture);
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

test("completed repair retires actionable root replacement residue", (t) => {
  const fixture = completedMixedRepair(
    t,
    "completed-root-replacement-residue",
  );
  const quarantineSuffix =
    ".quarantine.11111111-2222-4333-8444-555555555555" +
    ".quarantine.66666666-7777-4888-8999-aaaaaaaaaaaa";
  const temporaryPath =
    `${fixture.paths.outcomes}.${fixture.plan.operationId}.424206.repair.tmp` +
    quarantineSuffix;
  const temporaryBytes = fixture.trustedBytes.subarray(
    0,
    Math.min(fixture.trustedBytes.length, 64),
  );
  writeFileSync(temporaryPath, temporaryBytes, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);

  const ledgerBefore = readFileSync(fixture.paths.outcomes);
  const eventsBefore = readFileSync(fixture.paths.events);
  const retiredDirectory = path.join(
    fixture.plan.artifacts.artifactDirectory,
    "retired",
  );
  const retiredBefore = new Set(readdirSync(retiredDirectory));
  const unhealthy = summarizeOutcomeLedger(fixture.paths.outcomes, {
    stateRoot: fixture.stateRoot,
  });
  assert.equal(unhealthy.sourceHealth.outcomeLedgerTransactionsHealthy, true);
  assert.equal(unhealthy.sourceHealth.ledgerHealthy, false);
  assert.deepEqual(
    unhealthy.sourceHealth.pendingOutcomeLedgerRepairs,
    [
      {
        operationId: fixture.plan.operationId,
        taskId: TASK_ID,
        phase: "cleanup",
        recoverablePreparationResidue: false,
      },
    ],
  );

  const result = executeRepair({
    stateRoot: fixture.stateRoot,
    sourceDigest: fixture.sourceDigest,
  });
  assert.equal(result.changed, false);
  assert.equal(existsSync(temporaryPath), false);
  assert.deepEqual(readFileSync(fixture.paths.outcomes), ledgerBefore);
  assert.deepEqual(readFileSync(fixture.paths.events), eventsBefore);
  const retiredAfter = readdirSync(retiredDirectory).filter(
    (name) => !retiredBefore.has(name),
  );
  assert.equal(retiredAfter.length, 1);
  assert.match(
    retiredAfter[0],
    /^temporary-v2\.replacement\.424206\.[0-9a-f]{64}\.[0-9a-f]{64}\.archive$/,
  );
  const healthy = summarizeOutcomeLedger(fixture.paths.outcomes, {
    stateRoot: fixture.stateRoot,
  });
  assert.equal(healthy.sourceHealth.ledgerHealthy, true);
  assert.deepEqual(healthy.sourceHealth.pendingOutcomeLedgerRepairs, []);
});

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

function waitForNativeHelperPause(child, checkpoint) {
  return new Promise((resolve, reject) => {
    let signal = "";
    let stderr = "";
    child.stdio[4].setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdio[4].on("data", (chunk) => {
      signal += chunk;
      if (signal.includes(`${checkpoint}\n`)) resolve();
    });
    child.once("exit", (code, exitSignal) => {
      if (!signal.includes(`${checkpoint}\n`)) {
        reject(
          new Error(
            `Repair child exited before native pause, code=${code}, signal=${exitSignal}: ${stderr}`,
          ),
        );
      }
    });
    child.once("error", reject);
  });
}

function spawnNativePausedRepairChild(
  t,
  { stateRoot, sourceDigest, owner, pause, operation, source = "", destination = "" },
) {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import { repairOutcomeLedger } from ${JSON.stringify(MODULE_URL)};
        repairOutcomeLedger({
          stateRoot: process.env.FREED_TEST_STATE_ROOT,
          taskId: process.env.FREED_TEST_TASK_ID,
          expectedSourceDigest: process.env.FREED_TEST_SOURCE_DIGEST,
          actor: process.env.FREED_TEST_ACTOR,
          leaseName: process.env.FREED_TEST_LEASE_NAME,
          leaseToken: process.env.FREED_AUTOMATION_LEASE_TOKEN,
        });
      `,
    ],
    {
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FREED_TEST_STATE_ROOT: stateRoot,
        FREED_TEST_TASK_ID: TASK_ID,
        FREED_TEST_SOURCE_DIGEST: sourceDigest,
        FREED_TEST_ACTOR: owner.actor,
        FREED_TEST_LEASE_NAME: owner.leaseName,
        FREED_AUTOMATION_LEASE_TOKEN: owner.leaseToken,
        FREED_OUTCOME_REPAIR_MOVE_TEST_FDS: "3,4",
        FREED_OUTCOME_REPAIR_MOVE_TEST_PAUSE: pause,
        FREED_OUTCOME_REPAIR_MOVE_TEST_OPERATION: operation,
        FREED_OUTCOME_REPAIR_MOVE_TEST_SOURCE: source,
        FREED_OUTCOME_REPAIR_MOVE_TEST_DESTINATION: destination,
      },
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  return child;
}

function killPausedNativeHelper(child) {
  const lookup = spawnSync("/usr/bin/pgrep", ["-P", String(child.pid)], {
    encoding: "utf8",
  });
  assert.equal(lookup.status, 0, String(lookup.stderr));
  const pids = String(lookup.stdout)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
  assert.equal(pids.length, 1);
  process.kill(pids[0], "SIGKILL");
}

function releasePausedNativeHelper(child) {
  child.stdio[3].write("1");
}

function corruptSameSize(bytes) {
  assert.ok(bytes.length > 0);
  const corrupted = Buffer.from(bytes);
  corrupted[0] ^= 0xff;
  return corrupted;
}

function runNativeMoveHelper(operation, arguments_, descriptors) {
  return spawnSync(
    "/usr/bin/python3",
    [MOVE_HELPER_PATH, operation, ...arguments_.map(String)],
    {
      encoding: null,
      stdio: ["ignore", "pipe", "pipe", ...descriptors],
    },
  );
}

function spawnPausedNativeMoveHelper(
  t,
  { operation, arguments_, descriptors, pause, source = "", destination = "" },
) {
  const stdio = ["ignore", "pipe", "pipe", ...descriptors];
  while (stdio.length < 6) stdio.push("ignore");
  stdio.push("pipe", "pipe");
  const child = spawn(
    "/usr/bin/python3",
    [MOVE_HELPER_PATH, operation, ...arguments_.map(String)],
    {
      stdio,
      env: {
        ...process.env,
        FREED_REPAIR_MOVE_TEST_PAUSE: pause,
        FREED_REPAIR_MOVE_TEST_OPERATION: operation,
        FREED_REPAIR_MOVE_TEST_SOURCE: source,
        FREED_REPAIR_MOVE_TEST_DESTINATION: destination,
      },
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  return child;
}

function waitForDirectNativeHelperPause(child, checkpoint) {
  return new Promise((resolve, reject) => {
    let signal = "";
    let stderr = "";
    child.stdio[7].setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdio[7].on("data", (chunk) => {
      signal += chunk;
      if (signal.includes(`${checkpoint}\n`)) resolve();
    });
    child.once("exit", (code, exitSignal) => {
      if (!signal.includes(`${checkpoint}\n`)) {
        reject(
          new Error(
            `Native helper exited before pause, code=${code}, signal=${exitSignal}: ${stderr}`,
          ),
        );
      }
    });
    child.once("error", reject);
  });
}

function releaseDirectNativeHelper(child) {
  child.stdio[6].write("1");
}

function privateDirectoryFixture(t, label) {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), `freed-native-helper-${label}-`)),
  );
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const DIRECTORY_RETIREMENT_MAX_FILE_BYTES = 1024 * 1024;
const DIRECTORY_RETIREMENT_MAX_ENTRIES = 4;
const DIRECTORY_RETIREMENT_MAX_DEPTH = 1;
const DIRECTORY_RETIREMENT_MAX_AGGREGATE_BYTES = 1024 * 1024;

function snapshotRetirementDirectoryTree(sourceParentPath, sourceName) {
  const descriptor = openSync(
    sourceParentPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const sourceParent = fstatSync(descriptor);
  let result;
  try {
    result = runNativeMoveHelper(
      "snapshot-tree",
      [
        sourceName,
        0,
        DIRECTORY_RETIREMENT_MAX_FILE_BYTES,
        DIRECTORY_RETIREMENT_MAX_ENTRIES,
        DIRECTORY_RETIREMENT_MAX_DEPTH,
        DIRECTORY_RETIREMENT_MAX_AGGREGATE_BYTES,
        2 * DIRECTORY_RETIREMENT_MAX_FILE_BYTES,
        sourceParent.dev,
        sourceParent.ino,
        sourceParent.mode & 0o7777,
      ],
      [descriptor],
    );
  } finally {
    closeSync(descriptor);
  }
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  const receipt = JSON.parse(result.stdout.toString("utf8"));
  assert.equal(receipt.protocol, "freed-lease-archive-move-v1");
  assert.equal(receipt.operation, "snapshot-tree");
  assert.equal(receipt.parentDevice, String(sourceParent.dev));
  assert.equal(receipt.parentInode, String(sourceParent.ino));
  assert.equal(receipt.parentMode, String(sourceParent.mode & 0o7777));
  assert.match(receipt.treeDigest, /^[0-9a-f]{64}$/);
  return receipt.treeDigest;
}

function retireDirectoryArguments({
  sourceName,
  destinationName,
  source,
  sourceParent,
  destinationParent,
  treeDigest,
}) {
  return [
    sourceName,
    destinationName,
    source.dev,
    source.ino,
    source.mode & 0o7777,
    source.uid,
    sourceParent.dev,
    sourceParent.ino,
    destinationParent.dev,
    destinationParent.ino,
    treeDigest,
    DIRECTORY_RETIREMENT_MAX_FILE_BYTES,
    DIRECTORY_RETIREMENT_MAX_ENTRIES,
    DIRECTORY_RETIREMENT_MAX_DEPTH,
    DIRECTORY_RETIREMENT_MAX_AGGREGATE_BYTES,
  ];
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

function leaveRepairAudited(t, label) {
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
            if (checkpoint === "transaction-audited") {
              throw new Error(`leave ${label} before receipt`);
            }
          },
        },
      ),
    new RegExp(`leave ${label} before receipt`),
  );
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "audited",
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
  return { stateRoot, paths, sourceDigest, plan, owner };
}

function leavePreparedReplacementPublication(
  t,
  { label, checkpointName, zeroStage = false },
) {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine(label);
  const sourceDigest = writeLedger(paths, source);
  const session = repairSession(stateRoot, sourceDigest);
  assert.throws(
    () =>
      executeRepair(
        { stateRoot, sourceDigest },
        {
          checkpoint: (checkpoint) => {
            if (checkpoint === checkpointName) {
              throw new Error(`leave ${label} at ${checkpointName}`);
            }
          },
        },
      ),
    new RegExp(`leave ${label} at ${checkpointName}`),
  );
  const transaction = JSON.parse(
    readFileSync(session.plan.artifacts.transaction, "utf8"),
  );
  assert.equal(transaction.phase, "prepared");
  assert.equal(transaction.eventPlan, null);
  assert.equal(repairAuditEvents(paths, session.plan.eventId).length, 0);
  const stagingDirectory = path.join(
    session.plan.artifacts.artifactDirectory,
    "transaction-staging",
  );
  const intentDirectory = path.join(
    session.plan.artifacts.artifactDirectory,
    "publication-intents",
  );
  const transitionName = "transaction-prepared-to-replaced.json";
  const stagedEntries = readdirSync(stagingDirectory).filter((name) =>
    name.includes(transitionName),
  );
  assert.equal(stagedEntries.length, 1);
  if (zeroStage) {
    assert.match(stagedEntries[0], /^\..+\.tmp$/);
    truncateSync(path.join(stagingDirectory, stagedEntries[0]), 0);
  }
  return {
    stateRoot,
    paths,
    sourceDigest,
    ...session,
    stagingDirectory,
    intentDirectory,
    transitionName,
  };
}

test("replaced repair accepts its exact same-intent owner heartbeat before audit", (t) => {
  const fixture = leaveRepairReplaced(t, "same-intent-owner-heartbeat");
  const leaseRecord = JSON.parse(
    readFileSync(
      path.join(
        fixture.paths.leases,
        "owner-governance.lease",
        "lease.json",
      ),
      "utf8",
    ),
  );
  const heartbeatAtMs = Date.parse(leaseRecord.acquiredAt) + 1_000;
  withFrozenDateNow(heartbeatAtMs, () =>
    heartbeatLease({
      stateRoot: fixture.stateRoot,
      name: fixture.owner.leaseName,
      operationId: leaseMutationId("heartbeat:outcome-repair-recovery"),
      token: fixture.owner.leaseToken,
      ttlMs: leaseRecord.ttlMs - 1_000,
    }),
  );
  const recovered = withFrozenDateNow(heartbeatAtMs + 1, () =>
    repairOutcomeLedger({
      stateRoot: fixture.stateRoot,
      taskId: TASK_ID,
      expectedSourceDigest: fixture.sourceDigest,
      ...fixture.owner,
    }),
  );
  assert.equal(recovered.changed, true);
  assert.equal(
    summarizeOutcomeLedger(fixture.paths.outcomes, {
      stateRoot: fixture.stateRoot,
    }).sourceHealth.ledgerHealthy,
    true,
  );
});

test("replaced repair fences an unrelated actor lease before mutation or audit", (t) => {
  const fixture = leaveRepairReplaced(t, "unrelated-lease-before-audit");
  const eventsBefore = readFileSync(fixture.paths.events);
  const leaseEntriesBefore = readdirSync(fixture.paths.leases).sort();
  assert.throws(
    () => actorLease(fixture.stateRoot, "freed-release-verifier", Date.now()),
    (error) => error?.code === "outcome_ledger_repair_pending",
  );
  assert.deepEqual(readFileSync(fixture.paths.events), eventsBefore);
  assert.deepEqual(readdirSync(fixture.paths.leases).sort(), leaseEntriesBefore);
  assert.equal(repairAuditEvents(fixture.paths, fixture.plan.eventId).length, 0);
});

test("audited repair recovers under a new same-intent owner lease without duplicating its event", (t) => {
  const fixture = leaveRepairAudited(t, "audited-owner-reacquire");
  const priorLease = JSON.parse(
    readFileSync(
      path.join(
        fixture.paths.leases,
        "owner-governance.lease",
        "lease.json",
      ),
      "utf8",
    ),
  );
  const reacquireAtMs = Date.parse(priorLease.expiresAt) + 1_000;
  const owner = withFrozenDateNow(reacquireAtMs + 2, () =>
    ownerRepairLease(fixture.stateRoot, fixture.plan, {
      nowMs: reacquireAtMs,
    }),
  );
  const recovered = withFrozenDateNow(reacquireAtMs + 3, () =>
    repairOutcomeLedger({
      stateRoot: fixture.stateRoot,
      taskId: TASK_ID,
      expectedSourceDigest: fixture.sourceDigest,
      ...owner,
    }),
  );
  assert.equal(recovered.changed, true);
  assert.equal(repairAuditEvents(fixture.paths, fixture.plan.eventId).length, 1);
  assert.equal(
    JSON.parse(
      readFileSync(fixture.plan.artifacts.completedTransaction, "utf8"),
    ).phase,
    "complete",
  );
  assert.equal(existsSync(fixture.plan.artifacts.transaction), false);
});

function actorLease(stateRoot, actor, nowMs) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const token = `${actor}:${nowMs}`;
  const currentTimeMs = Date.now();
  const leaseNowMs = nowMs >= currentTimeMs - 1_000 ? nowMs : currentTimeMs;
  withFrozenDateNow(leaseNowMs, () =>
    acquireGeneralActorLeaseForTest({
      stateRoot,
      name: policy.leaseName,
      owner: actor,
      operationId: leaseMutationId(`acquire:${actor}`),
      token,
      ttlMs: policy.maxLeaseLifetimeMs,
    }),
  );
  return {
    actor,
    leaseName: policy.leaseName,
    leaseToken: token,
  };
}

function prepareValidatedTask(stateRoot, startMs = Date.now()) {
  return withFrozenDateNow(startMs, () => {
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
  });
}

function withFrozenDateNow(nowMs, operation) {
  const originalDateNow = Date.now;
  Date.now = () => nowMs;
  try {
    return operation();
  } finally {
    Date.now = originalDateNow;
  }
}

function frozenLegacyActorCredentialOutcomeLines(paths) {
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
  return { transitionLine, outcomeEventLine, ledgerLine };
}

function installFrozenLegacyActorCredentialOutcome(
  t,
  { ledgerBytes = undefined, outcomeEventBytes = undefined } = {},
) {
  const startMs = Date.parse("2026-07-18T08:00:00.000Z");
  const { stateRoot, paths } = withFrozenDateNow(startMs - 10_000, () =>
    temporaryStateRoot(t),
  );
  withFrozenDateNow(startMs, () => prepareValidatedTask(stateRoot, startMs));
  const lines = frozenLegacyActorCredentialOutcomeLines(paths);
  const ledgerEntry = JSON.parse(lines.ledgerLine.toString("utf8"));
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
  removeAutomationAuthorityStages(paths.taskManifest);
  removeControlEventAuthorityStages(paths);
  removeAutomationAuthorityStages(paths.outcomes);
  writeFileSync(paths.taskManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  appendFileSync(
    paths.events,
    Buffer.concat([
      lines.transitionLine,
      outcomeEventBytes ?? lines.outcomeEventLine,
    ]),
  );
  const installedLedgerBytes = ledgerBytes ?? lines.ledgerLine;
  const sourceDigest = writeLedger(paths, installedLedgerBytes, 0o600);
  return {
    stateRoot,
    paths,
    sourceDigest,
    ...lines,
    ledgerEntry,
    eventsBeforePlan: readFileSync(paths.events),
  };
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
    entries: readdirSync(directoryPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            type: "directory",
            entries: flatDirectorySnapshot(entryPath).entries,
          };
        }
        if (entry.isFile()) {
          return {
            name: entry.name,
            type: "file",
            bytes: readFileSync(entryPath),
          };
        }
        if (entry.isSymbolicLink()) {
          return {
            name: entry.name,
            type: "symbolic-link",
            target: readlinkSync(entryPath),
          };
        }
        return { name: entry.name, type: "other" };
      }),
  };
}

function restoreFlatDirectorySnapshot(directoryPath, snapshot) {
  rmSync(directoryPath, { recursive: true, force: true });
  if (!snapshot.exists) return;
  mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  chmodSync(directoryPath, 0o700);
  const restoreEntries = (parent, entries) => {
    for (const entry of entries) {
      const entryPath = path.join(parent, entry.name);
      if (entry.type === "directory") {
        mkdirSync(entryPath, { mode: 0o700 });
        chmodSync(entryPath, 0o700);
        restoreEntries(entryPath, entry.entries);
      } else if (entry.type === "file") {
        writeFileSync(entryPath, entry.bytes, { mode: 0o600 });
        chmodSync(entryPath, 0o600);
      } else if (entry.type === "symbolic-link") {
        symlinkSync(entry.target, entryPath);
      } else {
        assert.fail(`Cannot restore unsupported fixture entry ${entry.name}.`);
      }
    }
  };
  restoreEntries(directoryPath, snapshot.entries);
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

function appendControlEventPaddingToRecordCount(paths, targetRecordCount) {
  removeControlEventAuthorityStages(paths);
  const existing = readFileSync(paths.events, "utf8");
  const existingRecordCount = existing
    .split(/\r?\n/)
    .filter((line) => line !== "").length;
  assert.ok(targetRecordCount > existingRecordCount);
  const lines = [];
  for (
    let index = existingRecordCount;
    index < targetRecordCount;
    index += 1
  ) {
    lines.push(
      JSON.stringify({
        schemaVersion: 1,
        eventId: `00000000-0000-4000-8000-${index
          .toString(16)
          .padStart(12, "0")}`,
        type: "test_capacity_padding",
        ts: "2026-07-22T00:00:00.000Z",
        actor: "freed-stability-controller",
        data: { index },
      }),
    );
  }
  appendFileSync(paths.events, `${lines.join("\n")}\n`);
  const finalRecordCount = readFileSync(paths.events, "utf8")
    .split(/\r?\n/)
    .filter((line) => line !== "").length;
  assert.equal(finalRecordCount, targetRecordCount);
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

function trustedMergedOutcome(stateRoot, startMs = Date.now()) {
  return withFrozenDateNow(startMs, () => {
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
  });
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

test("aggregate repair admission exhaustion is sticky across admission kinds", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const tree = path.join(stateRoot, "artifacts", "repair-budget-probe");
  ensurePrivateDirectoryTree(stateRoot, tree);
  for (let index = 0; index < 4_096; index += 1) {
    writeFileSync(path.join(tree, `entry-${index.toString().padStart(4, "0")}`), "", {
      mode: 0o600,
    });
  }
  const sentinel = path.join(stateRoot, "repair-budget-sentinel");
  symlinkSync(paths.events, sentinel);
  withAutomationPlanningReadBundle({ stateRoot }, (bundle) => {
    assert.throws(
      () =>
        bundle.admitTree({
          directoryPath: tree,
          label: "Oversized repair budget probe",
        }),
      /boundary|limit|entries|could not be listed/i,
    );
    assert.throws(
      () =>
        bundle.admitFile({
          filePath: sentinel,
          allowMissing: false,
          allowEmpty: true,
          maxBytes: 1,
          label: "Sticky repair budget sentinel",
        }),
      /exhausted their aggregate boundary/i,
    );
  });
});

test("outcome repair selection preserves its admitted retirement directory", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const transactionDirectory = path.join(
    paths.controlRoot,
    "outcome-ledger-transactions",
  );
  const retirementDirectory = path.join(
    transactionDirectory,
    ".authority-retirements",
  );
  mkdirSync(transactionDirectory, { mode: 0o700 });
  mkdirSync(retirementDirectory, { mode: 0o700 });
  writeFileSync(path.join(transactionDirectory, "pending.json"), "{}\n", {
    mode: 0o600,
  });

  withAutomationPlanningReadBundle({ stateRoot }, (bundle) => {
    assert.equal(bundle.outcomeRepairTransactions.missing, false);
    assert.equal(bundle.outcomeRepairTransactions.selectionCount, 1);
    assert.deepEqual(bundle.outcomeRepairTransactions.issues, []);
  });
});

test("repair tree planning pins every private physical ancestor generation", async (t) => {
  const fixture = (subtest, label) => {
    const { stateRoot } = temporaryStateRoot(subtest);
    const tree = path.join(
      stateRoot,
      "artifacts",
      "outcome-ledger-repair",
      TASK_ID,
      sha256(`source:${label}`),
      sha256(`operation:${label}`),
    );
    ensurePrivateDirectoryTree(stateRoot, tree);
    writeFileSync(path.join(tree, "artifact.json"), "{}\n", {
      mode: 0o600,
    });
    return {
      stateRoot,
      tree,
      artifacts: path.join(stateRoot, "artifacts"),
      ancestor: path.join(stateRoot, "artifacts", "outcome-ledger-repair"),
    };
  };
  const admit = ({ stateRoot, tree }, callback = () => {}) =>
    withAutomationPlanningReadBundle({ stateRoot }, (bundle) => {
      bundle.admitTree({
        directoryPath: tree,
        label: "Focused repair ancestor tree",
      });
      callback();
    });

  await t.test("a public intermediate ancestor is unhealthy", (subtest) => {
    const current = fixture(subtest, "public");
    chmodSync(current.ancestor, 0o755);
    assert.throws(
      () => admit(current),
      /private|ancestor|generation|0700/i,
    );
  });

  await t.test("a symlinked intermediate ancestor is rejected", (subtest) => {
    const current = fixture(subtest, "symlink");
    const redirected = path.join(current.stateRoot, "redirected-artifacts");
    renameSync(current.ancestor, redirected);
    symlinkSync(redirected, current.ancestor);
    assert.throws(
      () => admit(current),
      /private|ancestor|generation|pinned/i,
    );
  });

  await t.test(
    "an ancestor generation swap cannot preserve trust by moving the admitted tree inode",
    (subtest) => {
      const current = fixture(subtest, "generation-swap");
      const displaced = path.join(
        path.dirname(current.stateRoot),
        `${path.basename(current.stateRoot)}-displaced-artifacts`,
      );
      subtest.after(() =>
        rmSync(displaced, { recursive: true, force: true }),
      );
      assert.throws(
        () =>
          admit(current, () => {
            const relativeTree = path.relative(current.artifacts, current.tree);
            renameSync(current.artifacts, displaced);
            ensurePrivateDirectoryTree(
              current.stateRoot,
              path.dirname(current.tree),
            );
            renameSync(
              path.join(displaced, relativeTree),
              current.tree,
            );
            assert.equal(statSync(current.tree).isDirectory(), true);
          }),
        /ancestor|parent|generation|changed/i,
      );
    },
  );
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
        isUnsafeAuthorityAdmission,
      );

      assert.equal(statSync(paths.outcomes).mode & 0o7777, mode);
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
  }
});

test("repair normalizes unchanged trusted and empty ledgers to private mode", async (t) => {
  for (const mode of [0o640, 0o644]) {
    for (const sourceKind of ["trusted", "empty"]) {
      await t.test(`${sourceKind} ${mode.toString(8)}`, (t) => {
        const { stateRoot, paths } = temporaryStateRoot(t);
        if (sourceKind === "trusted") {
          trustedMergedOutcome(stateRoot);
        } else {
          writeFileSync(paths.outcomes, Buffer.alloc(0), { mode });
        }
        chmodSync(paths.outcomes, mode);
        const sourceBytes = readFileSync(paths.outcomes);
        const sourceIdentity = statSync(paths.outcomes);
        const sourceDigest = sha256(sourceBytes);
        const plan = planOutcomeLedgerRepair({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
        });
        assert.equal(plan.parameters.rejectedCount, 0);
        assert.equal(plan.parameters.replacementDigest, sourceDigest);
        assert.equal(plan.parameters.replacementSize, sourceBytes.length);
        const owner = ownerRepairLease(stateRoot, plan);

        const result = repairOutcomeLedger({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
          ...owner,
        });

        assert.equal(result.changed, true);
        assert.deepEqual(readFileSync(paths.outcomes), sourceBytes);
        const finalIdentity = statSync(paths.outcomes);
        assert.equal(finalIdentity.mode & 0o7777, 0o600);
        assert.notEqual(finalIdentity.ino, sourceIdentity.ino);
        assert.equal(
          JSON.parse(
            readFileSync(plan.artifacts.completedTransaction, "utf8"),
          ).phase,
          "complete",
        );
        assert.equal(existsSync(plan.artifacts.transaction), false);
        const health = summarizeOutcomeLedger(paths.outcomes, { stateRoot })
          .sourceHealth;
        assert.equal(health.outcomeLedgerTransactionsHealthy, true);
        assert.equal(health.ledgerHealthy, true);
      });
    }
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
  removeControlEventAuthorityStages(paths);
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
  assert.equal(
    readFileSync(plan.artifacts.sourceArtifact).equals(source),
    true,
  );
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
  const sourceSnapshot = pinnedRegularFileSnapshot(paths.outcomes);
  const sourceBytes = sourceSnapshot.bytes;
  const sourceDigest = sha256(sourceBytes);
  const sourceIdentity = sourceSnapshot.identity;

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
  assert.equal(
    pinnedRegularFileSnapshot(paths.outcomes).bytes.equals(sourceBytes),
    true,
  );

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
  assert.equal(
    pinnedRegularFileSnapshot(paths.outcomes).bytes.equals(sourceBytes),
    true,
  );
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
  const replacementSnapshot = pinnedRegularFileSnapshot(paths.outcomes);
  assert.equal(replacementSnapshot.bytes.equals(sourceBytes), true);
  const replacementIdentity = replacementSnapshot.identity;
  assert.notEqual(replacementIdentity.ino, sourceIdentity.ino);
  assert.equal(Number(replacementIdentity.mode & 0o7777n), 0o600);
  const publicationIntentPath = path.join(
    planPayload.result.artifacts.artifactDirectory,
    "publication-intents",
    "ledger-replacement.json",
  );
  const publicationIntent = JSON.parse(
    readFileSync(publicationIntentPath, "utf8"),
  );
  assert.equal(publicationIntent.predecessor.inode, String(sourceIdentity.ino));
  assert.equal(
    publicationIntent.replacement.inode,
    String(replacementIdentity.ino),
  );
  assert.notEqual(
    publicationIntent.predecessor.inode,
    publicationIntent.replacement.inode,
  );
  assert.equal(existsSync(publicationIntent.predecessor.archivePath), true);
  assert.equal(repairAuditEvents(paths, planPayload.result.eventId).length, 1);
});

test("byte-identical replacement recovery retains its published inode and audits once", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  trustedMergedOutcome(stateRoot);
  const sourceBytes = readFileSync(paths.outcomes);
  const sourceDigest = sha256(sourceBytes);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);
  let armed = true;

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
            if (armed && checkpoint === "replacement-renamed") {
              armed = false;
              throw new Error("crash after byte-identical replacement rename");
            }
          },
        },
      ),
    /crash after byte-identical replacement rename/,
  );

  const publishedIdentity = pinnedRegularFileSnapshot(paths.outcomes).identity;
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "prepared",
  );
  const publicationIntentPath = path.join(
    plan.artifacts.artifactDirectory,
    "publication-intents",
    "ledger-replacement.json",
  );
  const publicationIntent = JSON.parse(
    readFileSync(publicationIntentPath, "utf8"),
  );
  assert.equal(
    publicationIntent.replacement.inode,
    String(publishedIdentity.ino),
  );

  const recovered = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...owner,
  });
  assert.equal(recovered.changed, true);
  const recoveredSnapshot = pinnedRegularFileSnapshot(paths.outcomes);
  assert.equal(recoveredSnapshot.identity.ino, publishedIdentity.ino);
  assert.deepEqual(recoveredSnapshot.bytes, sourceBytes);
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
  const predecessorArchives = readdirSync(
    path.join(plan.artifacts.artifactDirectory, "retired"),
  ).filter(
    (entry) =>
      entry.startsWith("ledger-predecessor-") && entry.endsWith(".archive"),
  );
  assert.equal(predecessorArchives.length, 1);
  assert.equal(existsSync(publicationIntent.predecessor.archivePath), true);
});

test("byte-identical replacement recovery rejects a foreign canonical inode before classification", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  trustedMergedOutcome(stateRoot);
  const sourceBytes = readFileSync(paths.outcomes);
  const sourceDigest = sha256(sourceBytes);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);
  let armed = true;
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
            if (armed && checkpoint === "replacement-renamed") {
              armed = false;
              throw new Error("leave recovered replacement published");
            }
          },
        },
      ),
    /leave recovered replacement published/,
  );

  const publishedInode = pinnedRegularFileSnapshot(paths.outcomes).identity.ino;
  const displacedPath = `${paths.outcomes}.published-replacement`;
  let foreignInode = null;
  let swapped = false;
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
            if (swapped || checkpoint !== "before-replacement-classification") {
              return;
            }
            swapped = true;
            renameSync(paths.outcomes, displacedPath);
            writeFileSync(paths.outcomes, sourceBytes, {
              mode: 0o600,
              flag: "wx",
            });
            chmodSync(paths.outcomes, 0o600);
            foreignInode = pinnedRegularFileSnapshot(
              paths.outcomes,
            ).identity.ino;
          },
        },
      ),
    /changed after recovered replacement publication|topology changed during a read-only callback/i,
  );
  assert.equal(swapped, true);
  assert.notEqual(foreignInode, publishedInode);
  const displacedSnapshot = pinnedRegularFileSnapshot(displacedPath);
  const foreignSnapshot = pinnedRegularFileSnapshot(paths.outcomes);
  assert.equal(displacedSnapshot.identity.ino, publishedInode);
  assert.equal(foreignSnapshot.identity.ino, foreignInode);
  assert.deepEqual(foreignSnapshot.bytes, sourceBytes);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "prepared",
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
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
    decisions.lines.map((decision) => ({
      lineNumber: decision[0],
      offset: decision[1],
      length: decision[2],
      disposition: decision[4] === 0 ? "trusted" : "rejected",
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

test("repair and completed recovery keep lease helper work inside a finite budget", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("bounded-lease-helper-work");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);

  consumeLeaseArchiveHelperInvocationCountForTest();
  const repairStartedAt = Date.now();
  const repaired = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...owner,
  });
  const repairDurationMs = Date.now() - repairStartedAt;
  const repairHelperCalls = consumeLeaseArchiveHelperInvocationCountForTest();
  assert.equal(repaired.changed, true);
  t.diagnostic(
    `initial repair: ${repairHelperCalls.toLocaleString()} helper calls in ${repairDurationMs.toLocaleString()} ms`,
  );
  assert.ok(
    repairHelperCalls > 0 && repairHelperCalls <= 400,
    `initial repair used ${repairHelperCalls.toLocaleString()} lease helper calls`,
  );

  const recoveryStartedAt = Date.now();
  const recovered = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...owner,
  });
  const recoveryDurationMs = Date.now() - recoveryStartedAt;
  const recoveryHelperCalls =
    consumeLeaseArchiveHelperInvocationCountForTest();
  assert.equal(recovered.changed, false);
  t.diagnostic(
    `completed recovery: ${recoveryHelperCalls.toLocaleString()} helper calls in ${recoveryDurationMs.toLocaleString()} ms`,
  );
  assert.ok(
    recoveryHelperCalls > 0 && recoveryHelperCalls <= 64,
    `completed recovery used ${recoveryHelperCalls.toLocaleString()} lease helper calls`,
  );
});

test("repair retains authenticated lines byte for byte and later appends survive retry", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const { nightly, nowMs } = trustedMergedOutcome(stateRoot);
  const trustedBytes = readFileSync(paths.outcomes);
  const rejectedBytes = legacyLine("legacy-after-trusted", "\r\n");
  removeAutomationAuthorityStages(paths.outcomes);
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
  const {
    stateRoot,
    paths,
    sourceDigest,
    transitionLine,
    outcomeEventLine,
    ledgerLine,
    ledgerEntry,
    eventsBeforePlan,
  } = installFrozenLegacyActorCredentialOutcome(t);

  const transition = JSON.parse(transitionLine.toString("utf8"));
  const outcomeEvent = JSON.parse(outcomeEventLine.toString("utf8"));
  assert.equal(Object.hasOwn(transition.data, "outcomeRequired"), false);
  assert.equal(
    outcomeEvent.data.outcomeDigest,
    ledgerEntry.authentication.outcomeDigest,
  );
  assert.equal(outcomeEvent.data.transitionEventId, transition.eventId);
  const { authentication: _authentication, ...digestibleEntry } = ledgerEntry;
  assert.equal(
    sha256(JSON.stringify(digestibleEntry)),
    ledgerEntry.authentication.outcomeDigest,
  );

  const summary = summarizeOutcomeLedger(paths.outcomes, { stateRoot });
  assert.equal(summary.sourceHealth.ledgerHealthy, true);
  assert.equal(summary.sourceHealth.pinnedLegacyOutcomeBundlesHealthy, true);
  assert.deepEqual(summary.sourceHealth.pinnedLegacyOutcomeBundleIssues, []);
  assert.deepEqual(summary.entries, [ledgerEntry]);
  assert.deepEqual(summary.rejectedEntries, []);

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
  assert.equal(
    repairedSummary.sourceHealth.pinnedLegacyOutcomeBundlesHealthy,
    true,
  );
  assert.deepEqual(repairedSummary.entries, [ledgerEntry]);
  assert.deepEqual(repairedSummary.rejectedEntries, []);
});

test("pinned legacy actor-credential outcome requires one exact ledger row", async (t) => {
  const expectedEventId =
    "outcome-recorded:16759d03db51dced7164ef0aaf9a9f53677010363b996a8cefb7ae54a2c5d9ea";
  const encodedLine = (value) =>
    Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  const assertRejectedBeforeRepairMutation = (fixture) => {
    const baseline = outcomeMutationSnapshot(fixture.stateRoot, fixture.paths);
    const transactionDirectory = path.join(
      fixture.paths.controlRoot,
      "outcome-ledger-transactions",
    );
    const artifactDirectory = path.join(
      fixture.stateRoot,
      "artifacts",
      "outcome-ledger-repair",
    );
    const transactionBaseline = flatDirectorySnapshot(transactionDirectory);
    const artifactDirectoryExisted = existsSync(artifactDirectory);
    const sourceDigest = sha256(readFileSync(fixture.paths.outcomes));
    assert.throws(
      () =>
        planOutcomeLedgerRepair({
          stateRoot: fixture.stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
        }),
      /pinned legacy outcome|requires healthy ledger, control event, and repair transaction sources/i,
    );
    assertOutcomeMutationSnapshot(fixture.stateRoot, fixture.paths, baseline);
    assert.deepEqual(
      flatDirectorySnapshot(transactionDirectory),
      transactionBaseline,
    );
    assert.equal(existsSync(artifactDirectory), artifactDirectoryExisted);
  };
  const assertPinnedBundleRejected = (fixture, expectedReferenceCount) => {
    const summary = summarizeOutcomeLedger(fixture.paths.outcomes, {
      stateRoot: fixture.stateRoot,
    });
    assert.equal(summary.sourceHealth.pinnedLegacyOutcomeBundlesHealthy, false);
    assert.ok(
      summary.sourceHealth.pinnedLegacyOutcomeBundleIssues.some(
        (issue) =>
          issue.includes(expectedEventId) &&
          issue.includes(
            `${expectedReferenceCount.toLocaleString()} ledger references`,
          ),
      ),
    );
    assertRejectedBeforeRepairMutation(fixture);
  };

  await t.test("missing row", (subtest) => {
    const fixture = installFrozenLegacyActorCredentialOutcome(subtest, {
      ledgerBytes: Buffer.alloc(0),
    });
    assertPinnedBundleRejected(fixture, 0);
  });

  await t.test("duplicate exact row", (subtest) => {
    const fixture = installFrozenLegacyActorCredentialOutcome(subtest);
    writeLedger(
      fixture.paths,
      Buffer.concat([fixture.ledgerLine, fixture.ledgerLine]),
      0o600,
    );
    const summary = summarizeOutcomeLedger(fixture.paths.outcomes, {
      stateRoot: fixture.stateRoot,
    });
    assert.equal(summary.entries.length, 1);
    assert.equal(summary.rejectedEntries.length, 1);
    assertPinnedBundleRejected(fixture, 2);
  });

  for (const variant of [
    {
      name: "unknown control event pointer",
      expectedReferenceCount: 0,
      mutate: (entry) => {
        entry.authentication.controlEventId =
          "22222222-2222-4222-8222-222222222222";
      },
    },
    {
      name: "transition pointer drift",
      expectedReferenceCount: 1,
      mutate: (entry) => {
        entry.authentication.transitionEventId =
          "33333333-3333-4333-8333-333333333333";
      },
    },
    {
      name: "digestible payload drift",
      expectedReferenceCount: 1,
      mutate: (entry) => {
        entry.notes = "Drifted pre-hardening authenticated ordinary outcome.";
      },
    },
    {
      name: "authentication digest drift",
      expectedReferenceCount: 1,
      mutate: (entry) => {
        entry.authentication.outcomeDigest = "f".repeat(64);
      },
    },
  ]) {
    await t.test(variant.name, (subtest) => {
      const fixture = installFrozenLegacyActorCredentialOutcome(subtest);
      const entry = structuredClone(fixture.ledgerEntry);
      variant.mutate(entry);
      writeLedger(fixture.paths, encodedLine(entry), 0o600);
      const summary = summarizeOutcomeLedger(fixture.paths.outcomes, {
        stateRoot: fixture.stateRoot,
      });
      assert.equal(summary.entries.length, 0);
      assert.equal(summary.rejectedEntries.length, 1);
      assertPinnedBundleRejected(fixture, variant.expectedReferenceCount);
    });
  }

  await t.test("UUID outcome event substitution", (subtest) => {
    const fixture = installFrozenLegacyActorCredentialOutcome(subtest);
    const substitutedEventId = "44444444-4444-4444-8444-444444444444";
    const event = JSON.parse(fixture.outcomeEventLine.toString("utf8"));
    event.eventId = substitutedEventId;
    const entry = structuredClone(fixture.ledgerEntry);
    entry.authentication.controlEventId = substitutedEventId;
    const originalEvents = readFileSync(fixture.paths.events);
    const frozenSuffixSize =
      fixture.transitionLine.length + fixture.outcomeEventLine.length;
    writeFileSync(
      fixture.paths.events,
      Buffer.concat([
        originalEvents.subarray(0, originalEvents.length - frozenSuffixSize),
        fixture.transitionLine,
        encodedLine(event),
      ]),
      { mode: 0o600 },
    );
    writeLedger(fixture.paths, encodedLine(entry), 0o600);
    assertPinnedBundleRejected(fixture, 0);
  });

  await t.test("missing ledger file blocks append admission", (subtest) => {
    const fixture = installFrozenLegacyActorCredentialOutcome(subtest);
    rmSync(fixture.paths.outcomes);
    const manifestBefore = readFileSync(fixture.paths.taskManifest);
    const eventsBefore = readFileSync(fixture.paths.events);
    const taskTransactionsBefore = flatDirectorySnapshot(
      fixture.paths.taskTransactions,
    );
    assert.throws(
      () =>
        planOutcomeRecord(
          fixture.paths.outcomes,
          {
            id: TASK_ID,
            taskId: TASK_ID,
            kind: "stability",
            outcome: "installed",
            evidenceDigest: "b".repeat(64),
            installedIdentity: {
              version: "26.7.1900-dev",
              commitSha: "c".repeat(40),
              channel: "dev",
            },
          },
          { stateRoot: fixture.stateRoot, now: new Date() },
        ),
      /fully authenticated, healthy outcome ledger within the supported repair boundary/i,
    );
    assert.equal(existsSync(fixture.paths.outcomes), false);
    assert.equal(
      readFileSync(fixture.paths.taskManifest).equals(manifestBefore),
      true,
    );
    assert.equal(readFileSync(fixture.paths.events).equals(eventsBefore), true);
    assert.deepEqual(
      flatDirectorySnapshot(fixture.paths.taskTransactions),
      taskTransactionsBefore,
    );
    assert.equal(
      existsSync(
        path.join(fixture.paths.controlRoot, "outcome-ledger-transactions"),
      ),
      false,
    );
    assert.equal(
      existsSync(
        path.join(fixture.stateRoot, "artifacts", "outcome-ledger-repair"),
      ),
      false,
    );
  });
});

test("repair planning rejects corrupted owner transition provenance before mutation", async (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const { nowMs } = prepareValidatedTask(stateRoot);
  const now = new Date(nowMs + 10_000);
  const entry = {
    id: TASK_ID,
    taskId: TASK_ID,
    kind: "stability",
    outcome: "merged",
    evidenceDigest: "9".repeat(64),
  };
  const ownerPlan = planOutcomeRecord(paths.outcomes, entry, {
    stateRoot,
    now,
  });
  const owner = ownerRepairLease(stateRoot, ownerPlan, {
    nowMs: now.getTime() - 1,
  });
  const recorded = appendOutcomeLedger(paths.outcomes, entry, {
    stateRoot,
    authentication: owner,
    ownerPlan,
    now,
  });
  const transitionEvent = parsedEvents(paths).find(
    (event) => event.eventId === recorded.authentication.transitionEventId,
  );
  assert.equal(transitionEvent?.type, "task_transitioned");
  assert.equal(transitionEvent.actor, "freed-owner");
  assert.equal(
    transitionEvent.data.authorizationProvenance.credentialKind,
    "owner-confirmation",
  );
  assert.equal(
    summarizeOutcomeLedger(paths.outcomes, { stateRoot }).sourceHealth
      .ledgerHealthy,
    true,
  );
  removeAutomationAuthorityStages(paths.taskManifest);
  removeControlEventAuthorityStages(paths);

  const baseline = outcomeMutationSnapshot(stateRoot, paths);
  const variants = [
    {
      name: "wrong approvedBy",
      mutate: (provenance) => {
        provenance.ownerConfirmationApprovedBy = "forged-owner";
      },
    },
    {
      name: "padded approval reference",
      mutate: (provenance) => {
        provenance.ownerConfirmationApprovalReference =
          ` ${provenance.ownerConfirmationApprovalReference}`;
      },
    },
    {
      name: "overlong confirmation lifetime",
      mutate: (provenance) => {
        provenance.ownerConfirmationExpiresAt = new Date(
          Date.parse(provenance.ownerConfirmationApprovedAt) +
            8 * 24 * 60 * 60_000,
        ).toISOString();
      },
    },
    {
      name: "transition before lease acquisition",
      mutate: (provenance, event) => {
        event.ts = new Date(
          Date.parse(provenance.leaseAcquiredAt) - 1,
        ).toISOString();
      },
    },
    {
      name: "transition at confirmation expiry",
      mutate: (provenance, event) => {
        provenance.ownerConfirmationExpiresAt = event.ts;
      },
    },
  ];

  for (const variant of variants) {
    await t.test(variant.name, () => {
      try {
        const corruptedEvents = rewriteControlEvent(
          paths,
          transitionEvent.eventId,
          (event) =>
            variant.mutate(event.data.authorizationProvenance, event),
        );
        const summary = summarizeOutcomeLedger(paths.outcomes, { stateRoot });
        assert.equal(summary.sourceHealth.controlEventsHealthy, false);
        assert.equal(summary.sourceHealth.ledgerHealthy, false);
        assert.equal(summary.entries.length, 0);
        assert.equal(summary.rejectedEntries.length, 1);
        assert.throws(
          () =>
            planOutcomeLedgerRepair({
              stateRoot,
              taskId: TASK_ID,
              expectedSourceDigest: sha256(baseline.ledger),
            }),
          /requires healthy ledger, control event, and repair transaction sources/i,
        );
        assert.deepEqual(readFileSync(paths.events), corruptedEvents);
        assert.deepEqual(readFileSync(paths.outcomes), baseline.ledger);
        assert.deepEqual(readFileSync(paths.taskManifest), baseline.manifest);
        assert.deepEqual(
          flatDirectorySnapshot(paths.taskTransactions),
          baseline.taskTransactions,
        );
      } finally {
        writeFileSync(paths.events, baseline.events, { mode: 0o600 });
        chmodSync(paths.events, 0o600);
      }
    });
  }
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
  const transactionBytes = readFileSync(plan.artifacts.completedTransaction);
  assert.equal(existsSync(plan.artifacts.transaction), false);
  const second = executeRepair({ stateRoot, sourceDigest });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(
    readFileSync(plan.artifacts.receiptArtifact).equals(receiptBytes),
    true,
  );
  assert.equal(
    readFileSync(plan.artifacts.completedTransaction).equals(
      transactionBytes,
    ),
    true,
  );
  assert.equal(existsSync(plan.artifacts.transaction), false);
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
      /topology changed during a read-only callback|source digest changed/,
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
      /topology changed during a read-only callback|prefix drifted|classification drifted/,
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
      withLeaseAlmostExpired(stateRoot, owner.leaseName, 500, () =>
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
  const firstResult = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...firstOwner,
  });
  assert.equal(firstResult.changed, true);
  const writerLockHolder = spawnReadyChild(
    t,
    `
      import { withOutcomeLedgerWriterLock } from ${JSON.stringify(NIGHTLY_MODULE_URL)};
      const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
      withOutcomeLedgerWriterLock(${JSON.stringify(paths.outcomes)}, () => {
        process.stdout.write("READY\\n");
        Atomics.wait(signal, 0, 0, 900);
      });
    `,
  );
  await waitForReadyChild(writerLockHolder);
  const waitedResult = repairOutcomeLedger({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...firstOwner,
  });
  const holderExit = await waitForChildExit(writerLockHolder);
  assert.equal(holderExit.code, 0);
  assert.equal(holderExit.signal, null);
  assert.equal(waitedResult.changed, false);
  assert.equal(readFileSync(paths.outcomes).length, 0);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.completedTransaction, "utf8"))
      .phase,
    "complete",
  );
  assert.equal(existsSync(plan.artifacts.transaction), false);
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
  const transactionBeforeWait = readFileSync(
    plan.artifacts.completedTransaction,
  );
  assert.equal(existsSync(plan.artifacts.transaction), false);
  const receiptBeforeWait = readFileSync(plan.artifacts.receiptArtifact);
  assert.throws(
    () =>
      withLeaseAlmostExpired(stateRoot, owner.leaseName, 500, () =>
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
    readFileSync(plan.artifacts.completedTransaction).equals(
      transactionBeforeWait,
    ),
    true,
  );
  assert.equal(existsSync(plan.artifacts.transaction), false);
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
      withLeaseAlmostExpired(stateRoot, expiringOwner.leaseName, 500, () =>
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
    JSON.parse(readFileSync(plan.artifacts.completedTransaction, "utf8"))
      .phase,
    "complete",
  );
  assert.equal(existsSync(plan.artifacts.transaction), false);
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

test("a prepared repair rejects a live legacy receipt temporary", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("prepared-live-receipt-temp");
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
  const receiptTemporaryPath = path.join(
    session.plan.artifacts.artifactDirectory,
    `.${path.basename(session.plan.artifacts.receiptArtifact)}.424215.tmp`,
  );
  writeFileSync(
    receiptTemporaryPath,
    Buffer.from(`${JSON.stringify(session.plan.receipt, null, 2)}\n`, "utf8"),
    { mode: 0o600 },
  );
  const ledgerBefore = readFileSync(paths.outcomes);
  const eventsBefore = readFileSync(paths.events);
  assert.throws(
    () => executeRepair({ stateRoot, sourceDigest }),
    /unexpected artifact tree entry|receipt|temporary/i,
  );
  assert.deepEqual(readFileSync(paths.outcomes), ledgerBefore);
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.equal(
    JSON.parse(readFileSync(session.plan.artifacts.transaction, "utf8")).phase,
    "prepared",
  );
  assert.equal(
    summarizeOutcomeLedger(paths.outcomes, { stateRoot }).sourceHealth
      .ledgerHealthy,
    false,
  );
  assert.equal(existsSync(receiptTemporaryPath), false);
  const retiredReceiptTemps = readdirSync(
    path.join(session.plan.artifacts.artifactDirectory, "retired"),
  ).filter(
    (entry) =>
      entry.startsWith("temporary-v2.receipt.424215.") &&
      entry.endsWith(".archive"),
  );
  assert.equal(retiredReceiptTemps.length, 1);
  const retiredLedger = readFileSync(paths.outcomes);
  const retiredEvents = readFileSync(paths.events);
  assert.throws(
    () => executeRepair({ stateRoot, sourceDigest }),
    /retired receipt temporary exists before audit/,
  );
  assert.deepEqual(readFileSync(paths.outcomes), retiredLedger);
  assert.deepEqual(readFileSync(paths.events), retiredEvents);
});

test("a post-fence foreign sibling blocks preparation without mutation", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("post-fence-foreign-sibling");
  const sourceDigest = writeLedger(paths, source);
  const session = repairSession(stateRoot, sourceDigest);
  assert.throws(
    () =>
      executeRepair(
        { stateRoot, sourceDigest },
        {
          checkpoint: (checkpoint) => {
            if (checkpoint === "transaction-fenced") {
              throw new Error("stop after transaction fenced");
            }
          },
        },
      ),
    /stop after transaction fenced/,
  );
  ensurePrivateDirectoryTree(
    stateRoot,
    session.plan.artifacts.artifactDirectory,
  );
  const sourceTemporaryPath = path.join(
    session.plan.artifacts.artifactDirectory,
    `.${path.basename(session.plan.artifacts.sourceArtifact)}.424216.tmp`,
  );
  const foreignPath = path.join(
    session.plan.artifacts.artifactDirectory,
    "foreign-sibling.bin",
  );
  writeFileSync(sourceTemporaryPath, source.subarray(0, 64), { mode: 0o600 });
  writeFileSync(foreignPath, "foreign", { mode: 0o600 });
  const ledgerBefore = readFileSync(paths.outcomes);
  const eventsBefore = readFileSync(paths.events);
  const inventoryBefore = readdirSync(
    session.plan.artifacts.artifactDirectory,
  ).sort();
  assert.throws(
    () => executeRepair({ stateRoot, sourceDigest }),
    /operation directory has a foreign entry/i,
  );
  assert.deepEqual(readFileSync(paths.outcomes), ledgerBefore);
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.deepEqual(
    readdirSync(session.plan.artifacts.artifactDirectory).sort(),
    inventoryBefore,
  );
  assert.equal(
    JSON.parse(readFileSync(session.plan.artifacts.transaction, "utf8")).phase,
    "fenced",
  );
  rmSync(foreignPath);
  assert.equal(executeRepair({ stateRoot, sourceDigest }).changed, true);
  assert.equal(existsSync(sourceTemporaryPath), false);
});

test("a post-fence foreign exact final blocks preparation before publication", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("post-fence-foreign-exact-final");
  const sourceDigest = writeLedger(paths, source);
  const session = repairSession(stateRoot, sourceDigest);
  assert.throws(
    () =>
      executeRepair(
        { stateRoot, sourceDigest },
        {
          checkpoint: (checkpoint) => {
            if (checkpoint === "transaction-fenced") {
              throw new Error("stop after transaction fenced");
            }
          },
        },
      ),
    /stop after transaction fenced/,
  );
  ensurePrivateDirectoryTree(
    stateRoot,
    session.plan.artifacts.artifactDirectory,
  );
  const sourceTemporaryPath = path.join(
    session.plan.artifacts.artifactDirectory,
    `.${path.basename(session.plan.artifacts.sourceArtifact)}.424217.tmp`,
  );
  writeFileSync(sourceTemporaryPath, source.subarray(0, 64), { mode: 0o600 });
  writeFileSync(session.plan.artifacts.rejectedArtifact, "foreign", {
    mode: 0o600,
  });
  const ledgerBefore = readFileSync(paths.outcomes);
  const eventsBefore = readFileSync(paths.events);
  const inventoryBefore = readdirSync(
    session.plan.artifacts.artifactDirectory,
  ).sort();
  assert.throws(
    () => executeRepair({ stateRoot, sourceDigest }),
    /fenced final has foreign bytes/i,
  );
  assert.deepEqual(readFileSync(paths.outcomes), ledgerBefore);
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.deepEqual(
    readdirSync(session.plan.artifacts.artifactDirectory).sort(),
    inventoryBefore,
  );
  assert.equal(existsSync(session.plan.artifacts.sourceArtifact), false);
  assert.equal(existsSync(session.plan.artifacts.trustedArtifact), false);
  assert.equal(
    JSON.parse(readFileSync(session.plan.artifacts.transaction, "utf8")).phase,
    "fenced",
  );
  rmSync(session.plan.artifacts.rejectedArtifact);
  assert.equal(executeRepair({ stateRoot, sourceDigest }).changed, true);
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

test("a fenced repair rejects legacy temps without exact lineage byte-stably", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("legacy-temp-fenced-crash");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  ensurePrivateDirectoryTree(stateRoot, plan.artifacts.transactionDirectory);
  ensurePrivateDirectoryTree(stateRoot, plan.artifacts.artifactDirectory);
  const transactionTemporaryPath = path.join(
    plan.artifacts.transactionDirectory,
    `.${path.basename(plan.artifacts.transaction)}.424211.tmp`,
  );
  const transactionPrefix = transactionBytesForPlan(plan).subarray(0, 257);
  const sourceTemporaryPath = path.join(
    plan.artifacts.artifactDirectory,
    `.${path.basename(plan.artifacts.sourceArtifact)}.424212.tmp`,
  );
  const replacementTemporaryPath =
    `${paths.outcomes}.${plan.operationId}.424213.repair.tmp`;
  writeFileSync(sourceTemporaryPath, source.subarray(0, 64), { mode: 0o600 });
  writeFileSync(replacementTemporaryPath, Buffer.alloc(0), { mode: 0o600 });
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
            if (checkpoint === "transaction-fenced") {
              throw new Error("simulated fenced process loss");
            }
          },
        },
      ),
    /simulated fenced process loss/,
  );
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "fenced",
  );
  writeFileSync(transactionTemporaryPath, transactionPrefix, { mode: 0o600 });
  assert.equal(existsSync(transactionTemporaryPath), true);
  assert.equal(existsSync(sourceTemporaryPath), true);
  assert.equal(existsSync(replacementTemporaryPath), true);

  const before = {
    transaction: readFileSync(plan.artifacts.transaction),
    transactionTemporary: readFileSync(transactionTemporaryPath),
    sourceTemporary: readFileSync(sourceTemporaryPath),
    replacementTemporary: readFileSync(replacementTemporaryPath),
    ledger: readFileSync(paths.outcomes),
  };
  assert.throws(
    () =>
      repairOutcomeLedger({
        stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
        ...owner,
      }),
    /unsupported transaction residue|premature entry|no exact lineage/i,
  );
  assert.deepEqual(readFileSync(plan.artifacts.transaction), before.transaction);
  assert.deepEqual(
    readFileSync(transactionTemporaryPath),
    before.transactionTemporary,
  );
  assert.deepEqual(readFileSync(sourceTemporaryPath), before.sourceTemporary);
  assert.deepEqual(
    readFileSync(replacementTemporaryPath),
    before.replacementTemporary,
  );
  assert.deepEqual(readFileSync(paths.outcomes), before.ledger);
});

test("an exact digest-named immutable temp recovers before intent publication", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("digest-named-immutable-temp-recovery");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  ensurePrivateDirectoryTree(stateRoot, plan.artifacts.artifactDirectory);
  const temporaryPath = deterministicImmutableTemporaryPath(
    plan.artifacts.sourceArtifact,
    source,
  );
  writeFileSync(temporaryPath, source, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  const stagedInode = statSync(temporaryPath).ino;
  const owner = ownerRepairLease(stateRoot, plan);
  let observedBeforePublication = false;

  const result = repairOutcomeLedger(
    {
      stateRoot,
      taskId: TASK_ID,
      expectedSourceDigest: sourceDigest,
      ...owner,
    },
    {
      checkpoint: (checkpoint) => {
        if (checkpoint !== "source-before-publish") return;
        observedBeforePublication = true;
        assert.equal(statSync(temporaryPath).ino, stagedInode);
        assert.equal(existsSync(plan.artifacts.sourceArtifact), false);
      },
    },
  );

  assert.equal(observedBeforePublication, true);
  assert.equal(result.changed, true);
  assert.equal(existsSync(temporaryPath), false);
  assert.equal(statSync(plan.artifacts.sourceArtifact).ino, stagedInode);
  assert.deepEqual(readFileSync(plan.artifacts.sourceArtifact), source);
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
});

test("owner expiry before single-link temp quarantine preserves every admitted byte", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("expired-single-link-temp-quarantine");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  ensurePrivateDirectoryTree(stateRoot, plan.artifacts.artifactDirectory);
  const temporaryPath = path.join(
    plan.artifacts.artifactDirectory,
    `.${path.basename(plan.artifacts.sourceArtifact)}.424213.tmp`,
  );
  const temporaryBytes = source;
  writeFileSync(temporaryPath, temporaryBytes, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  const temporaryInode = statSync(temporaryPath).ino;
  const owner = ownerRepairLease(stateRoot, plan);
  const eventsBefore = readFileSync(paths.events);
  const ledgerBefore = readFileSync(paths.outcomes);
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
            checkpoint: (checkpoint, metadata) => {
              if (
                expired ||
                checkpoint !== "repair-temp-cleanup-before-quarantine" ||
                metadata?.filePath !== temporaryPath
              ) {
                return;
              }
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
  assert.equal(statSync(temporaryPath).ino, temporaryInode);
  assert.deepEqual(readFileSync(temporaryPath), temporaryBytes);
  assert.deepEqual(readFileSync(paths.outcomes), ledgerBefore);
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "fenced",
  );
  const retiredDirectory = path.join(plan.artifacts.artifactDirectory, "retired");
  assert.equal(existsSync(retiredDirectory), true);
  assert.equal(
    readdirSync(retiredDirectory).some((entry) =>
      entry.startsWith("temporary-"),
    ),
    false,
  );
});

test("temporary cleanup keeps the listed directory generation through native move", async (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("temporary-directory-rename-swap");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  ensurePrivateDirectoryTree(stateRoot, plan.artifacts.transactionDirectory);
  const temporaryName = `.${path.basename(plan.artifacts.transaction)}.424214.tmp`;
  const temporaryBytes = transactionBytesForPlan(plan).subarray(0, 257);
  const temporaryPath = path.join(
    plan.artifacts.transactionDirectory,
    temporaryName,
  );
  writeFileSync(temporaryPath, temporaryBytes, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  const admittedInode = statSync(temporaryPath).ino;
  const owner = ownerRepairLease(stateRoot, plan);
  const eventsBefore = readFileSync(paths.events);
  const ledgerBefore = readFileSync(paths.outcomes);
  const child = spawnNativePausedRepairChild(t, {
    stateRoot,
    sourceDigest,
    owner,
    pause: "after-list-bounded-scan",
    operation: "list-bounded",
  });

  await waitForNativeHelperPause(child, "after-list-bounded-scan");
  const displacedDirectory = `${plan.artifacts.transactionDirectory}.admitted`;
  renameSync(plan.artifacts.transactionDirectory, displacedDirectory);
  mkdirSync(plan.artifacts.transactionDirectory, { mode: 0o700 });
  chmodSync(plan.artifacts.transactionDirectory, 0o700);
  const replacementPath = path.join(
    plan.artifacts.transactionDirectory,
    temporaryName,
  );
  writeFileSync(replacementPath, temporaryBytes, { mode: 0o600 });
  chmodSync(replacementPath, 0o600);
  const replacementInode = statSync(replacementPath).ino;
  assert.notEqual(replacementInode, admittedInode);

  releasePausedNativeHelper(child);
  const childExit = await waitForChildExit(child);
  assert.equal(childExit.code, 1);
  assert.equal(childExit.signal, null);

  const displacedTemporaryPath = path.join(displacedDirectory, temporaryName);
  assert.equal(statSync(displacedTemporaryPath).ino, admittedInode);
  assert.deepEqual(readFileSync(displacedTemporaryPath), temporaryBytes);
  assert.equal(statSync(replacementPath).ino, replacementInode);
  assert.deepEqual(readFileSync(replacementPath), temporaryBytes);
  assert.deepEqual(readFileSync(paths.outcomes), ledgerBefore);
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.equal(existsSync(plan.artifacts.transaction), false);
  const retiredDirectory = path.join(plan.artifacts.artifactDirectory, "retired");
  assert.equal(
    existsSync(retiredDirectory) &&
      readdirSync(retiredDirectory).some((entry) =>
        entry.startsWith("temporary-"),
      ),
    false,
  );
});

test("a foreign digest-named immutable temp fails before intent publication", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("foreign-digest-named-immutable-temp");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  ensurePrivateDirectoryTree(stateRoot, plan.artifacts.artifactDirectory);
  const temporaryPath = deterministicImmutableTemporaryPath(
    plan.artifacts.sourceArtifact,
    source,
  );
  const foreignBytes = Buffer.from("foreign deterministic staging bytes\n");
  writeFileSync(temporaryPath, foreignBytes, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  const owner = ownerRepairLease(stateRoot, plan);

  assert.throws(
    () =>
      repairOutcomeLedger({
        stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
        ...owner,
      }),
    /temp has foreign bytes|conflicting deterministic immutable/i,
  );
  assert.deepEqual(readFileSync(temporaryPath), foreignBytes);
  assert.deepEqual(readFileSync(paths.outcomes), source);
  assert.equal(existsSync(plan.artifacts.transaction), false);
  assert.equal(existsSync(plan.artifacts.sourceArtifact), false);
});

test("a foreign later preparation temp prevents every repair mutation", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("foreign-later-preparation-temp");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  ensurePrivateDirectoryTree(stateRoot, plan.artifacts.artifactDirectory);
  const sourceTemporaryPath = deterministicImmutableTemporaryPath(
    plan.artifacts.sourceArtifact,
    source,
  );
  writeFileSync(sourceTemporaryPath, source, { mode: 0o600 });
  const trustedTemporaryPath = deterministicImmutableTemporaryPath(
    plan.artifacts.trustedArtifact,
    Buffer.alloc(0),
  );
  const foreignBytes = Buffer.from("foreign later preparation bytes\n");
  writeFileSync(trustedTemporaryPath, foreignBytes, { mode: 0o600 });
  const owner = ownerRepairLease(stateRoot, plan);
  const eventsBefore = readFileSync(paths.events);
  const ledgerBefore = readFileSync(paths.outcomes);
  const sourceTemporaryBefore = readFileSync(sourceTemporaryPath);
  const trustedTemporaryBefore = readFileSync(trustedTemporaryPath);

  assert.throws(
    () =>
      repairOutcomeLedger({
        stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
        ...owner,
      }),
    /temp has foreign bytes|conflicting deterministic immutable/i,
  );
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.deepEqual(readFileSync(paths.outcomes), ledgerBefore);
  assert.deepEqual(readFileSync(sourceTemporaryPath), sourceTemporaryBefore);
  assert.deepEqual(readFileSync(trustedTemporaryPath), trustedTemporaryBefore);
  assert.equal(existsSync(plan.artifacts.transaction), false);
  assert.equal(existsSync(plan.artifacts.sourceArtifact), false);
  assert.equal(existsSync(plan.artifacts.trustedArtifact), false);
  assert.equal(
    existsSync(path.join(plan.artifacts.artifactDirectory, "retired")),
    false,
  );
});

test("new repair rejects unmatched operation-directory residue before its fence", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("foreign-operation-directory-entry");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  ensurePrivateDirectoryTree(stateRoot, plan.artifacts.artifactDirectory);
  const foreignPath = path.join(
    plan.artifacts.artifactDirectory,
    "foreign.bin",
  );
  const foreignBytes = Buffer.from("foreign operation residue\n");
  writeFileSync(foreignPath, foreignBytes, { mode: 0o600 });
  const owner = ownerRepairLease(stateRoot, plan);
  const eventsBefore = readFileSync(paths.events);
  const ledgerBefore = readFileSync(paths.outcomes);

  assert.throws(
    () =>
      repairOutcomeLedger({
        stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
        ...owner,
      }),
    /operation directory has a foreign entry/i,
  );
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.deepEqual(readFileSync(paths.outcomes), ledgerBefore);
  assert.deepEqual(readFileSync(foreignPath), foreignBytes);
  assert.equal(existsSync(plan.artifacts.transaction), false);
});

test("repair artifacts reject every hard-link alias byte-stably", async (t) => {
  await t.test("final and deterministic temp pair", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const source = legacyLine("immutable-post-link-recovery");
    const sourceDigest = writeLedger(paths, source);
    const session = repairSession(stateRoot, sourceDigest);
    assert.throws(
      () =>
        executeRepair(
          { stateRoot, sourceDigest },
          {
            checkpoint: (checkpoint) => {
              if (checkpoint === "source-archived") {
                throw new Error("stop after source archive");
              }
            },
          },
        ),
      /stop after source archive/,
    );
    const sourceArtifact = session.plan.artifacts.sourceArtifact;
    const temporaryPath = path.join(
      path.dirname(sourceArtifact),
      `.${path.basename(sourceArtifact)}.424207.tmp`,
    );
    linkSync(sourceArtifact, temporaryPath);
    const artifactBefore = readFileSync(sourceArtifact);
    const ledgerBefore = readFileSync(paths.outcomes);
    assert.equal(statSync(sourceArtifact).nlink, 2);
    assert.equal(statSync(temporaryPath).nlink, 2);

    assert.throws(
      () => executeRepair({ stateRoot, sourceDigest }),
      isRepairTopologySafetyError,
    );
    assert.equal(statSync(sourceArtifact).nlink, 2);
    assert.equal(statSync(temporaryPath).nlink, 2);
    assert.deepEqual(readFileSync(sourceArtifact), artifactBefore);
    assert.deepEqual(readFileSync(paths.outcomes), ledgerBefore);
  });

  await t.test("unrecognized foreign hard link", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const source = legacyLine("immutable-foreign-hard-link");
    const sourceDigest = writeLedger(paths, source);
    const session = repairSession(stateRoot, sourceDigest);
    assert.throws(
      () =>
        executeRepair(
          { stateRoot, sourceDigest },
          {
            checkpoint: (checkpoint) => {
              if (checkpoint === "source-archived") {
                throw new Error("stop after source archive");
              }
            },
          },
        ),
      /stop after source archive/,
    );
    const sourceArtifact = session.plan.artifacts.sourceArtifact;
    const foreignPath = path.join(
      path.dirname(sourceArtifact),
      "foreign-source-hard-link.jsonl",
    );
    linkSync(sourceArtifact, foreignPath);
    const artifactBefore = readFileSync(sourceArtifact);
    const ledgerBefore = readFileSync(paths.outcomes);

    assert.throws(
      () => executeRepair({ stateRoot, sourceDigest }),
      isRepairTopologySafetyError,
    );
    assert.equal(statSync(sourceArtifact).nlink, 2);
    assert.equal(statSync(foreignPath).nlink, 2);
    assert.deepEqual(readFileSync(sourceArtifact), artifactBefore);
    assert.deepEqual(readFileSync(paths.outcomes), ledgerBefore);
  });

  await t.test("completed receipt final and temp pair", () => {
    const fixture = completedLegacyRepair(t, "completed-receipt-link-window");
    const receiptPath = fixture.plan.artifacts.receiptArtifact;
    const temporaryPath = path.join(
      path.dirname(receiptPath),
      `.${path.basename(receiptPath)}.424208.tmp`,
    );
    const originalInode = statSync(receiptPath).ino;
    linkSync(receiptPath, temporaryPath);
    const receiptBefore = readFileSync(receiptPath);
    assert.equal(statSync(receiptPath).nlink, 2);
    assert.equal(statSync(temporaryPath).ino, originalInode);

    assert.throws(
      () =>
        executeRepair({
          stateRoot: fixture.stateRoot,
          sourceDigest: fixture.sourceDigest,
        }),
      isRepairTopologySafetyError,
    );
    assert.equal(statSync(receiptPath).nlink, 2);
    assert.equal(statSync(temporaryPath).nlink, 2);
    assert.deepEqual(readFileSync(receiptPath), receiptBefore);
  });

  await t.test("transaction temp hard-link alias", () => {
    const fixture = completedLegacyRepair(t, "transaction-temp-hard-link");
    const transactionPath = fixture.plan.artifacts.completedTransaction;
    const temporaryPath = path.join(
      path.dirname(transactionPath),
      `.${path.basename(transactionPath)}.424209.tmp`,
    );
    linkSync(transactionPath, temporaryPath);
    const transactionBefore = readFileSync(transactionPath);

    assert.throws(
      () =>
        executeRepair({
          stateRoot: fixture.stateRoot,
          sourceDigest: fixture.sourceDigest,
        }),
      isRepairTopologySafetyError,
    );
    assert.equal(statSync(transactionPath).nlink, 2);
    assert.equal(statSync(temporaryPath).nlink, 2);
    assert.deepEqual(readFileSync(transactionPath), transactionBefore);
  });

  await t.test("replacement temp hard-link alias", () => {
    const fixture = completedLegacyRepair(t, "replacement-temp-hard-link");
    const temporaryPath = `${fixture.paths.outcomes}.${fixture.plan.operationId}.424210.repair.tmp`;
    linkSync(fixture.paths.outcomes, temporaryPath);
    const ledgerBefore = readFileSync(fixture.paths.outcomes);

    assert.throws(
      () =>
        executeRepair({
          stateRoot: fixture.stateRoot,
          sourceDigest: fixture.sourceDigest,
        }),
      isRepairTopologySafetyError,
    );
    assert.equal(statSync(fixture.paths.outcomes).nlink, 2);
    assert.equal(statSync(temporaryPath).nlink, 2);
    assert.deepEqual(readFileSync(fixture.paths.outcomes), ledgerBefore);
  });
});

test("an unrelated transaction temp without exact lineage is rejected byte-identically", (t) => {
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
  const before = {
    temporary: readFileSync(unrelatedPath),
    ledger: readFileSync(paths.outcomes),
    events: readFileSync(paths.events),
  };
  assert.throws(
    () =>
      repairOutcomeLedger({
        stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
        ...owner,
      }),
    /transaction staging has no exact lineage/i,
  );
  assert.deepEqual(readFileSync(unrelatedPath), before.temporary);
  assert.deepEqual(readFileSync(paths.outcomes), before.ledger);
  assert.deepEqual(readFileSync(paths.events), before.events);
  assert.equal(existsSync(plan.artifacts.transaction), false);
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
  const replacementOwner = ownerRepairLease(stateRoot, session.plan);
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
  {
    name: "conflicting content",
    checkpoint: "event-audited",
    phase: "replaced",
  },
  { name: "duplicate content", checkpoint: "event-audited", phase: "replaced" },
  {
    name: "missing audited event",
    checkpoint: "transaction-audited",
    phase: "audited",
  },
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
    removeControlEventAuthorityStages(paths);
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
      JSON.parse(readFileSync(session.plan.artifacts.transaction, "utf8"))
        .phase,
      variant.phase,
    );
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
        releaseLease({
          stateRoot,
          name: session.owner.leaseName,
          operationId: leaseMutationId(
            `release:pending-audit-${variant.name}`,
          ),
          token: session.owner.leaseToken,
        }),
      (error) => error?.code === "outcome_ledger_repair_transaction_invalid",
    );
    assert.throws(
      () => executeRepair({ stateRoot, sourceDigest }),
      (error) => error?.code === "outcome_ledger_repair_transaction_invalid",
    );
    assert.equal(readFileSync(paths.events).equals(beforeEvents), true);
    assert.equal(readFileSync(paths.outcomes).equals(beforeLedger), true);
    assert.equal(
      readFileSync(session.plan.artifacts.transaction).equals(
        beforeTransaction,
      ),
      true,
    );
    assert.equal(existsSync(session.plan.artifacts.receiptArtifact), false);
  });
}

for (const scenario of [
  {
    name: "zero-byte successor temporary",
    checkpointName: "transaction-replaced-staging-partial",
    zeroStage: true,
  },
  {
    name: "partial successor temporary",
    checkpointName: "transaction-replaced-staging-partial",
  },
  {
    name: "canonical successor without intent",
    checkpointName: "transaction-replaced-staging-durable",
  },
  {
    name: "partial publication intent",
    checkpointName: "transaction-replaced-intent-partial",
  },
  {
    name: "canonical publication intent",
    checkpointName: "transaction-replaced-intent-durable",
  },
]) {
  test(`owner lease recovery commits ${scenario.name} before its lifecycle event`, (t) => {
    const fixture = leavePreparedReplacementPublication(t, {
      label: `prepared-bridge-${scenario.name}`,
      checkpointName: scenario.checkpointName,
      zeroStage: scenario.zeroStage === true,
    });
    const heartbeatOperationId = leaseMutationId(
      `prepared-bridge-heartbeat:${scenario.name}`,
    );
    const leaseRecord = JSON.parse(
      readFileSync(
        path.join(
          fixture.paths.leases,
          `${fixture.owner.leaseName}.lease`,
          "lease.json",
        ),
        "utf8",
      ),
    );
    withFrozenDateNow(Date.parse(leaseRecord.acquiredAt) + 1_000, () =>
      heartbeatLease({
        stateRoot: fixture.stateRoot,
        name: fixture.owner.leaseName,
        operationId: heartbeatOperationId,
        token: fixture.owner.leaseToken,
        ttlMs: leaseRecord.ttlMs - 1_000,
      }),
    );

    const eventLines = readFileSync(fixture.paths.events, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const repairMatches = eventLines
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.eventId === fixture.plan.eventId);
    const heartbeatMatches = eventLines
      .map((event, index) => ({ event, index }))
      .filter(
        ({ event }) => event.eventId === `lease:${heartbeatOperationId}`,
      );
    assert.equal(repairMatches.length, 1);
    assert.equal(heartbeatMatches.length, 1);
    assert.equal(heartbeatMatches[0].index, repairMatches[0].index + 1);
    assert.deepEqual(readdirSync(fixture.stagingDirectory).sort(), [
      fixture.transitionName,
    ]);
    assert.deepEqual(
      readdirSync(fixture.intentDirectory).sort(),
      [
        "ledger-replacement.json",
        "transaction-fenced-to-prepared.json",
        fixture.transitionName,
      ].sort(),
    );
    const pending = JSON.parse(
      readFileSync(fixture.plan.artifacts.transaction, "utf8"),
    );
    assert.equal(pending.phase, "prepared");
    assert.equal(pending.eventPlan, null);
  });
}

const committedPreparedTopologyCases = [
    {
      name: "duplicate successor temporary",
      expectedError: /requires one exact successor staging generation/i,
      mutate: (fixture) => {
        const canonicalPath = path.join(
          fixture.stagingDirectory,
          fixture.transitionName,
        );
        const bytes = readFileSync(canonicalPath);
        const duplicatePath = deterministicImmutableTemporaryPath(
          canonicalPath,
          bytes,
        );
        writeFileSync(duplicatePath, bytes, { mode: 0o600 });
        chmodSync(duplicatePath, 0o600);
        return duplicatePath;
      },
    },
    {
      name: "foreign successor sibling",
      expectedError: /requires one exact successor staging generation/i,
      mutate: (fixture) => {
        const foreignPath = path.join(
          fixture.stagingDirectory,
          "foreign-successor.json",
        );
        writeFileSync(foreignPath, "foreign\n", { mode: 0o600 });
        chmodSync(foreignPath, 0o600);
        return foreignPath;
      },
    },
    {
      name: "duplicate intent temporary",
      expectedError: /intent family is not exact/i,
      mutate: (fixture) => {
        const canonicalPath = path.join(
          fixture.intentDirectory,
          fixture.transitionName,
        );
        const bytes = readFileSync(canonicalPath);
        const duplicatePath = deterministicImmutableTemporaryPath(
          canonicalPath,
          bytes,
        );
        writeFileSync(duplicatePath, bytes, { mode: 0o600 });
        chmodSync(duplicatePath, 0o600);
        return duplicatePath;
      },
    },
    {
      name: "foreign intent sibling",
      expectedError: /intent family is not exact/i,
      mutate: (fixture) => {
        const foreignPath = path.join(
          fixture.intentDirectory,
          "foreign-intent.json",
        );
        writeFileSync(foreignPath, "foreign\n", { mode: 0o600 });
        chmodSync(foreignPath, 0o600);
        return foreignPath;
      },
    },
    {
      name: "occupied prepared predecessor archive",
      expectedError: /premature prepared predecessor archive/i,
      mutate: (fixture) => {
        const intent = JSON.parse(
          readFileSync(
            path.join(fixture.intentDirectory, fixture.transitionName),
            "utf8",
          ),
        );
        writeFileSync(intent.archivePath, "foreign\n", { mode: 0o600 });
        chmodSync(intent.archivePath, 0o600);
        return intent.archivePath;
      },
    },
    {
      name: "corrupt ledger replacement predecessor archive",
      expectedError: /ledger predecessor archive changed/i,
      mutate: (fixture) => {
        const intent = JSON.parse(
          readFileSync(
            path.join(fixture.intentDirectory, "ledger-replacement.json"),
            "utf8",
          ),
        );
        writeFileSync(intent.predecessor.archivePath, "corrupt\n", {
          mode: 0o600,
        });
        chmodSync(intent.predecessor.archivePath, 0o600);
        return intent.predecessor.archivePath;
      },
    },
    {
      name: "corrupt fenced predecessor archive",
      expectedError: /fenced predecessor archive changed/i,
      mutate: (fixture) => {
        const intent = JSON.parse(
          readFileSync(
            path.join(
              fixture.intentDirectory,
              "transaction-fenced-to-prepared.json",
            ),
            "utf8",
          ),
        );
        writeFileSync(intent.archivePath, "corrupt\n", { mode: 0o600 });
        chmodSync(intent.archivePath, 0o600);
        return intent.archivePath;
      },
    },
];

for (const scenario of committedPreparedTopologyCases) {
  test(`committed prepared event plan rejects ${scenario.name} before lease mutation`, (t) => {
      const fixture = leavePreparedReplacementPublication(t, {
        label: `prepared-topology-${scenario.name}`,
        checkpointName: "transaction-replaced-intent-durable",
      });
      const foreignPath = scenario.mutate(fixture);
      const heartbeatOperationId = leaseMutationId(
        `prepared-topology-heartbeat:${scenario.name}`,
      );
      const before = {
        events: readFileSync(fixture.paths.events),
        ledger: readFileSync(fixture.paths.outcomes),
        pending: readFileSync(fixture.plan.artifacts.transaction),
        foreign: readFileSync(foreignPath),
        artifacts: snapshotTestTree(
          fixture.plan.artifacts.artifactDirectory,
        ),
        controlRoot: snapshotTestTree(fixture.paths.controlRoot),
        leases: snapshotTestTree(fixture.paths.leases),
      };
      assert.throws(
        () =>
          heartbeatLease({
            stateRoot: fixture.stateRoot,
            name: fixture.owner.leaseName,
            operationId: heartbeatOperationId,
            token: fixture.owner.leaseToken,
            ttlMs: 10 * 60_000,
          }),
        scenario.expectedError,
      );
      assert.deepEqual(readFileSync(fixture.paths.events), before.events);
      assert.deepEqual(readFileSync(fixture.paths.outcomes), before.ledger);
      assert.deepEqual(
        readFileSync(fixture.plan.artifacts.transaction),
        before.pending,
      );
      assert.deepEqual(readFileSync(foreignPath), before.foreign);
      assert.deepEqual(
        snapshotTestTree(fixture.plan.artifacts.artifactDirectory),
        before.artifacts,
      );
      assert.deepEqual(
        snapshotTestTree(fixture.paths.controlRoot),
        before.controlRoot,
      );
      assert.deepEqual(snapshotTestTree(fixture.paths.leases), before.leases);
      assert.equal(
        snapshotTestTree(fixture.paths.leases).some((entry) =>
          entry.path.includes(heartbeatOperationId),
        ),
        false,
      );
  });
}

test("prepared repair publication reauthorizes after every checkpoint", async (t) => {
  const checkpoints = [
    {
      name: "transaction-fenced-before-rename",
      published: [],
      transactionPhase: null,
    },
    {
      name: "transaction-fenced",
      published: [],
      transactionPhase: "fenced",
    },
    {
      name: "source-before-publish",
      published: [],
      transactionPhase: "fenced",
    },
    {
      name: "source-archived",
      published: ["sourceArtifact"],
      transactionPhase: "fenced",
    },
    {
      name: "trusted-archived",
      published: ["sourceArtifact", "trustedArtifact"],
      transactionPhase: "fenced",
    },
    {
      name: "rejected-archived",
      published: [
        "sourceArtifact",
        "trustedArtifact",
        "rejectedArtifact",
      ],
      transactionPhase: "fenced",
    },
    {
      name: "decisions-archived",
      published: [
        "sourceArtifact",
        "trustedArtifact",
        "rejectedArtifact",
        "decisionsArtifact",
      ],
      transactionPhase: "fenced",
    },
    ...[
      "transaction-prepared-staging-directory-durable",
      "transaction-prepared-intent-directory-durable",
      "transaction-prepared-retired-directory-durable",
      "transaction-prepared-staging-partial",
      "transaction-prepared-staging-durable",
      "transaction-prepared-intent-partial",
      "transaction-prepared-intent-durable",
    ].map((name) => ({
      name,
      published: [
        "sourceArtifact",
        "trustedArtifact",
        "rejectedArtifact",
        "decisionsArtifact",
      ],
      transactionPhase: "fenced",
    })),
    ...[
      "transaction-prepared-exchanged",
      "transaction-prepared-predecessor-archived",
      "transaction-prepared-publication-recovered",
      "transaction-prepared",
    ].map((name) => ({
      name,
      published: [
        "sourceArtifact",
        "trustedArtifact",
        "rejectedArtifact",
        "decisionsArtifact",
      ],
      transactionPhase: "prepared",
    })),
  ];
  for (const authorityLoss of ["expiry", "revocation"]) {
    for (const checkpointCase of checkpoints) {
      await t.test(`${authorityLoss} at ${checkpointCase.name}`, (t) => {
        const { stateRoot, paths } = temporaryStateRoot(t);
        const source = legacyLine(
          `prepared-${authorityLoss}-${checkpointCase.name}`,
        );
        const sourceDigest = writeLedger(paths, source);
        const plan = planOutcomeLedgerRepair({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
        });
        const owner = ownerRepairLease(stateRoot, plan);
        const leaseDirectory = path.join(
          paths.leases,
          `${owner.leaseName}.lease`,
        );
        const expiresAtMs = Date.parse(
          JSON.parse(
            readFileSync(path.join(leaseDirectory, "lease.json"), "utf8"),
          ).expiresAt,
        );
        const baselineEvents = readFileSync(paths.events);
        const liveDateNow = Date.now;
        let triggered = false;
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
                    if (triggered || checkpoint !== checkpointCase.name) {
                      return;
                    }
                    triggered = true;
                    if (authorityLoss === "expiry") {
                      Date.now = () => expiresAtMs + 1;
                    } else {
                      rmSync(leaseDirectory, { recursive: true, force: true });
                    }
                  },
                },
              ),
            (error) =>
              error?.code ===
              (authorityLoss === "expiry" ? "lease_expired" : "lease_not_found"),
          );
        } finally {
          Date.now = liveDateNow;
        }

        assert.equal(triggered, true);
        assert.deepEqual(readFileSync(paths.outcomes), source);
        assert.deepEqual(readFileSync(paths.events), baselineEvents);
        for (const artifact of [
          "sourceArtifact",
          "trustedArtifact",
          "rejectedArtifact",
          "decisionsArtifact",
        ]) {
          assert.equal(
            existsSync(plan.artifacts[artifact]),
            checkpointCase.published.includes(artifact),
            artifact,
          );
        }
        assert.equal(
          existsSync(plan.artifacts.transaction),
          checkpointCase.transactionPhase !== null,
        );
        if (checkpointCase.transactionPhase !== null) {
          assert.equal(
            JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
            checkpointCase.transactionPhase,
          );
        }
        assert.equal(existsSync(plan.artifacts.receiptArtifact), false);
        assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
      });
    }
  }
});

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
      JSON.parse(readFileSync(plan.artifacts.completedTransaction, "utf8"))
        .phase,
      "complete",
    );
    assert.equal(existsSync(plan.artifacts.transaction), false);
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
  const temporaryPath = `${paths.outcomes}.${plan.operationId}.${plan.parameters.replacementDigest}.repair.tmp`;
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
  assert.equal(existsSync(temporaryPath), true);
  assert.equal(readFileSync(temporaryPath).length, 0);
  const temporaryStats = lstatSync(temporaryPath);
  assert.equal(temporaryStats.isFile(), true);
  assert.equal(temporaryStats.mode & 0o7777, 0o600);
  assert.equal(temporaryStats.nlink, 1);
  assert.deepEqual(
    readdirSync(stateRoot).filter((entry) =>
      entry.startsWith(`${path.basename(paths.outcomes)}.${plan.operationId}.`),
    ),
    [path.basename(temporaryPath)],
  );
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "prepared",
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
});

test("repair staged writers preserve foreign temporary replacements", async (t) => {
  const cases = [
    {
      label: "immutable source",
      checkpointName: "source-before-publish",
      temporaryPath: (fixture) =>
        deterministicImmutableTemporaryPath(
          fixture.plan.artifacts.sourceArtifact,
          fixture.source,
        ),
      finalPath: (fixture) => fixture.plan.artifacts.sourceArtifact,
    },
    {
      label: "transaction JSON",
      checkpointName: "transaction-fenced-before-rename",
      temporaryPath: (fixture) =>
        deterministicImmutableTemporaryPath(
          fixture.plan.artifacts.transaction,
          transactionBytesForPlan(fixture.plan, "fenced"),
        ),
      finalPath: (fixture) => fixture.plan.artifacts.transaction,
    },
    {
      label: "canonical replacement",
      checkpointName: "replacement-synced",
      temporaryPath: (fixture) =>
        `${fixture.paths.outcomes}.${fixture.plan.operationId}.${fixture.plan.parameters.replacementDigest}.repair.tmp`,
      finalPath: (fixture) => fixture.paths.outcomes,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.label, () => {
      const fixture = temporaryStateRoot(t);
      const source = legacyLine(`staged-swap-${scenario.label}`);
      const sourceDigest = writeLedger(fixture.paths, source);
      const session = repairSession(fixture.stateRoot, sourceDigest);
      const state = { ...fixture, ...session, source };
      const temporaryPath = scenario.temporaryPath(state);
      const displacedPath = `${temporaryPath}.owned`;
      const foreignBytes = Buffer.from(
        `foreign temporary bytes for ${scenario.label}\n`,
        "utf8",
      );
      let swapped = false;

      assert.throws(
        () =>
          executeRepair(
            { stateRoot: fixture.stateRoot, sourceDigest },
            {
              checkpoint: (checkpoint) => {
                if (
                  swapped ||
                  checkpoint !== scenario.checkpointName
                ) {
                  return;
                }
                try {
                  renameSync(temporaryPath, displacedPath);
                } catch (error) {
                  if (error?.code === "ENOENT") {
                    return;
                  }
                  throw error;
                }
                writeFileSync(temporaryPath, foreignBytes, {
                  mode: 0o600,
                  flag: "wx",
                });
                swapped = true;
              },
            },
          ),
        /topology changed during a read-only callback|temporary generation changed|preserved a foreign temporary path/i,
      );
      assert.equal(swapped, true);
      assert.equal(existsSync(temporaryPath), true);
      assert.deepEqual(readFileSync(temporaryPath), foreignBytes);
      assert.equal(existsSync(displacedPath), true);
      assert.deepEqual(readFileSync(fixture.paths.outcomes), source);
      if (scenario.label !== "canonical replacement") {
        assert.equal(existsSync(scenario.finalPath(state)), false);
      }
    });
  }
});

test("final temporary admission rejects new hard links before publication", async (t) => {
  for (const scenario of [
    {
      label: "transaction",
      checkpointName: "transaction-fenced-before-rename",
      temporaryPath: (fixture) =>
        deterministicImmutableTemporaryPath(
          fixture.plan.artifacts.transaction,
          transactionBytesForPlan(fixture.plan, "fenced"),
        ),
      expectedTransactionPhase: null,
    },
    {
      label: "replacement",
      checkpointName: "replacement-synced",
      temporaryPath: (fixture) =>
        `${fixture.paths.outcomes}.${fixture.plan.operationId}.${fixture.plan.parameters.replacementDigest}.repair.tmp`,
      expectedTransactionPhase: "prepared",
    },
  ]) {
    await t.test(scenario.label, (subtest) => {
      const fixture = temporaryStateRoot(subtest);
      const source = legacyLine(`hard-link-after-admission-${scenario.label}`);
      const sourceDigest = writeLedger(fixture.paths, source);
      const session = repairSession(fixture.stateRoot, sourceDigest);
      const state = { ...fixture, ...session };
      const temporaryPath = scenario.temporaryPath(state);
      const aliasPath = `${temporaryPath}.foreign-link`;
      let linked = false;

      assert.throws(
        () =>
          executeRepair(
            { stateRoot: fixture.stateRoot, sourceDigest },
            {
              checkpoint: (checkpoint) => {
                if (
                  linked ||
                  checkpoint !== scenario.checkpointName ||
                  !existsSync(temporaryPath)
                ) {
                  return;
                }
                linkSync(temporaryPath, aliasPath);
                linked = true;
              },
            },
          ),
        /changed before staging|generation changed|topology is not one admitted repair file|hard-linked/i,
      );

      assert.equal(linked, true);
      assert.equal(statSync(temporaryPath).nlink, 2);
      assert.equal(statSync(aliasPath).nlink, 2);
      assert.equal(statSync(temporaryPath).ino, statSync(aliasPath).ino);
      assert.deepEqual(readFileSync(fixture.paths.outcomes), source);
      if (scenario.expectedTransactionPhase === null) {
        assert.equal(existsSync(session.plan.artifacts.transaction), false);
      } else {
        assert.equal(
          JSON.parse(
            readFileSync(session.plan.artifacts.transaction, "utf8"),
          ).phase,
          scenario.expectedTransactionPhase,
        );
      }
    });
  }
});

test("cleanup preserves a replacement swapped onto the quarantine path", (t) => {
  const fixture = temporaryStateRoot(t);
  const source = legacyLine("cleanup-quarantine-path-swap");
  const sourceDigest = writeLedger(fixture.paths, source);
  const session = repairSession(fixture.stateRoot, sourceDigest);
  ensurePrivateDirectoryTree(
    fixture.stateRoot,
    session.plan.artifacts.artifactDirectory,
  );
  const temporaryPath = path.join(
    session.plan.artifacts.artifactDirectory,
    `.${path.basename(session.plan.artifacts.sourceArtifact)}.717171.tmp`,
  );
  const ownedBytes = source;
  writeFileSync(temporaryPath, ownedBytes, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  const ownedInode = statSync(temporaryPath).ino;
  const foreignBytes = Buffer.from("foreign cleanup replacement\n", "utf8");
  let quarantinePath = null;
  let displacedPath = null;
  let foreignInode = null;

  assert.throws(
    () =>
      executeRepair(
        { stateRoot: fixture.stateRoot, sourceDigest },
        {
          checkpoint: (checkpoint, details) => {
            if (
              quarantinePath !== null ||
              checkpoint !== "repair-temp-cleanup-before-unlink" ||
              details?.filePath !== temporaryPath
            ) {
              return;
            }
            quarantinePath = details.quarantinePath;
            displacedPath = `${quarantinePath}.owned`;
            renameSync(quarantinePath, displacedPath);
            writeFileSync(quarantinePath, foreignBytes, { mode: 0o600 });
            chmodSync(quarantinePath, 0o600);
            foreignInode = statSync(quarantinePath).ino;
          },
        },
      ),
    /quarantined temporary generation changed|topology changed during a read-only callback/i,
  );

  assert.notEqual(quarantinePath, null);
  assert.equal(
    existsSync(temporaryPath),
    false,
    JSON.stringify({
      temporaryPath,
      quarantinePath,
      displacedPath,
      artifactEntries: readdirSync(session.plan.artifacts.artifactDirectory),
    }),
  );
  assert.equal(statSync(displacedPath).ino, ownedInode);
  assert.deepEqual(readFileSync(displacedPath), ownedBytes);
  assert.equal(statSync(quarantinePath).ino, foreignInode);
  assert.deepEqual(readFileSync(quarantinePath), foreignBytes);
  assert.deepEqual(readFileSync(fixture.paths.outcomes), source);
  assert.equal(
    JSON.parse(readFileSync(session.plan.artifacts.transaction, "utf8")).phase,
    "fenced",
  );
});

test("a conflicting deterministic event suffix before replacement preserves the canonical ledger", (t) => {
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
    /topology changed during a read-only callback|requires healthy ledger, control event, and repair transaction sources/,
  );
  assert.equal(injected, true);
  assert.equal(readFileSync(paths.outcomes).equals(source), true);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "prepared",
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
});

test("a canonical ledger replacement before final classification is preserved", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("pre-classification-ledger-replacement");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);
  const replacement = legacyLine("foreign-canonical-ledger-generation");
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
            writeFileSync(paths.outcomes, replacement, { mode: 0o600 });
          },
        },
      ),
    /topology changed during a read-only callback|differs from source and replacement|changed generation before classification/,
  );
  assert.equal(injected, true);
  assert.equal(readFileSync(paths.outcomes).equals(replacement), true);
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.transaction, "utf8")).phase,
    "prepared",
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
});

test("a byte-identical inode swap after final classification is preserved", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("post-classification-byte-identical-inode-swap");
  const sourceDigest = writeLedger(paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);
  const displacedPath = `${paths.outcomes}.classified-source`;
  let originalInode = null;
  let foreignInode = null;
  let transactionBefore = null;
  let eventsBefore = null;
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
              checkpoint !== "after-replacement-classification" ||
              injected
            ) {
              return;
            }
            injected = true;
            const admitted = statSync(paths.outcomes);
            originalInode = admitted.ino;
            transactionBefore = readFileSync(plan.artifacts.transaction);
            eventsBefore = readFileSync(paths.events);
            renameSync(paths.outcomes, displacedPath);
            writeFileSync(paths.outcomes, source, {
              mode: admitted.mode & 0o7777,
            });
            chmodSync(paths.outcomes, admitted.mode & 0o7777);
            foreignInode = statSync(paths.outcomes).ino;
          },
        },
      ),
    /topology changed during a read-only callback|predecessor generation changed/i,
  );

  assert.equal(injected, true);
  assert.notEqual(foreignInode, originalInode);
  assert.equal(statSync(paths.outcomes).ino, foreignInode);
  assert.deepEqual(readFileSync(paths.outcomes), source);
  assert.equal(statSync(displacedPath).ino, originalInode);
  assert.deepEqual(readFileSync(displacedPath), source);
  assert.deepEqual(readFileSync(plan.artifacts.transaction), transactionBefore);
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 0);
});

test("a conflicting deterministic suffix after replacement cannot become audited", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  trustedMergedOutcome(stateRoot);
  const trustedBytes = readFileSync(paths.outcomes);
  const rejectedBytes = legacyLine("post-replacement-classification-change");
  appendFileSync(paths.outcomes, rejectedBytes);
  const source = Buffer.concat([trustedBytes, rejectedBytes]);
  const sourceDigest = sha256(source);
  const entry = JSON.parse(trustedBytes.toString("utf8").trim());
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
  removeControlEventAuthorityStages(paths);
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
    /requires healthy ledger, control event, and repair transaction sources/,
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
  appendControlEventPaddingToRecordCount(
    paths,
    CONTROL_EVENT_HISTORY_MAX_RECORDS - 1,
  );
  const plan = planOutcomeLedgerRepair({
    stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(stateRoot, plan);

  const manifestBefore = readFileSync(paths.taskManifest);
  const taskBefore = readTask({ stateRoot, taskId: TASK_ID });
  const eventsBefore = readFileSync(paths.events);
  const eventDigestBefore = sha256(eventsBefore);
  assert.equal(
    eventsBefore.reduce(
      (count, byte) => count + (byte === 0x0a ? 1 : 0),
      0,
    ),
    CONTROL_EVENT_HISTORY_MAX_RECORDS,
  );
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
  assert.equal(statSync(paths.events).size, eventsBefore.length);
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
  const coordinationRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-repair-event-guard-")),
  );
  t.after(() => rmSync(coordinationRoot, { recursive: true, force: true }));
  const attemptPath = path.join(coordinationRoot, "suffix-writer-attempted");
  const donePath = path.join(coordinationRoot, "suffix-writer-complete");
  const rejectedPath = path.join(coordinationRoot, "suffix-writer-rejected");
  const auditedPath = path.join(
    coordinationRoot,
    "repair-transaction-audited",
  );
  const suffixEventId = "77777777-7777-4777-8777-777777777777";

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
  let repairStderr = "";
  repairChild.stderr.on("data", (chunk) => {
    repairStderr += String(chunk);
  });
  await waitForReadyChild(repairChild);

  const suffixChild = spawnReadyChild(
    t,
    `
      import { writeFileSync } from "node:fs";
      import { appendControlEvent } from ${JSON.stringify(TRUSTED_ACTOR_CONTROL_MODULE_URL)};
      writeFileSync(${JSON.stringify(attemptPath)}, "attempted\\n");
      process.stdout.write("READY\\n");
      try {
        appendControlEvent({
          stateRoot: ${JSON.stringify(stateRoot)},
          type: "repair_guard_suffix_appended",
          taskId: ${JSON.stringify(TASK_ID)},
          eventId: ${JSON.stringify(suffixEventId)},
          ...${JSON.stringify(controller)},
          data: { reason: "prove final repair guard exclusion" },
          nowMs: ${JSON.stringify(controllerNowMs + 1_000)},
        });
        throw new Error("concurrent suffix writer was not fenced");
      } catch (error) {
        if (error?.code !== "outcome_ledger_repair_pending") throw error;
        writeFileSync(
          ${JSON.stringify(rejectedPath)},
          JSON.stringify({ code: error.code, phase: error.details?.phase }) + "\\n",
        );
      }
    `,
  );
  let suffixStderr = "";
  suffixChild.stderr.on("data", (chunk) => {
    suffixStderr += String(chunk);
  });
  await waitForReadyChild(suffixChild);

  const [repairExit, suffixExit] = await Promise.all([
    waitForChildExit(repairChild),
    waitForChildExit(suffixChild),
  ]);
  assert.deepEqual(repairExit, { code: 0, signal: null }, repairStderr);
  assert.deepEqual(suffixExit, { code: 0, signal: null }, suffixStderr);
  assert.equal(existsSync(auditedPath), true);
  assert.equal(existsSync(donePath), false);
  assert.deepEqual(
    JSON.parse(readFileSync(rejectedPath, "utf8")),
    { code: "outcome_ledger_repair_pending", phase: "prepared" },
  );
  assert.equal(
    JSON.parse(readFileSync(plan.artifacts.completedTransaction, "utf8"))
      .phase,
    "complete",
  );
  assert.equal(existsSync(plan.artifacts.transaction), false);

  const suffixRetry = spawnReadyChild(
    t,
    `
      import { writeFileSync } from "node:fs";
      import { appendControlEvent } from ${JSON.stringify(TRUSTED_ACTOR_CONTROL_MODULE_URL)};
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
      process.stdout.write("READY\\n");
    `,
  );
  await waitForReadyChild(suffixRetry);
  assert.deepEqual(await waitForChildExit(suffixRetry), {
    code: 0,
    signal: null,
  });
  assert.equal(existsSync(donePath), true);
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
      /outcome ledger repair|pending repair|repair transaction|fully authenticated, healthy outcome ledger/i,
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
    assert.equal(
      readdirSync(stateRoot).some((entry) =>
        entry.startsWith(`.${path.basename(paths.outcomes)}.authority.`),
      ),
      false,
    );
    const authorityRetirements = path.join(
      stateRoot,
      ".authority-retirements",
    );
    assert.equal(existsSync(authorityRetirements), true);
    assert.equal(
      readdirSync(authorityRetirements).some(
        (entry) =>
          entry.startsWith(`${path.basename(paths.outcomes)}.`) &&
          entry.endsWith(".retired"),
      ),
      true,
    );
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

test("repair rejects a foreign outcome authority witness before ledger mutation", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const source = legacyLine("foreign-outcome-authority-witness");
  const sourceDigest = writeLedger(paths, source);
  const session = repairSession(stateRoot, sourceDigest);
  const witnessPath = path.join(
    stateRoot,
    `.${path.basename(paths.outcomes)}.authority.${"a".repeat(64)}.${"b".repeat(64)}.tmp`,
  );
  const witnessBytes = Buffer.from("foreign predecessor witness\n", "utf8");
  writeFileSync(witnessPath, witnessBytes, { mode: 0o600 });
  const beforeLedger = readFileSync(paths.outcomes);

  assert.throws(
    () => executeRepair({ stateRoot, sourceDigest }),
    /predecessor authority witness is outside the authenticated replacement prefix/,
  );
  assert.equal(readFileSync(paths.outcomes).equals(beforeLedger), true);
  assert.equal(readFileSync(witnessPath).equals(witnessBytes), true);
  assert.equal(existsSync(session.plan.artifacts.transaction), false);
  assert.equal(existsSync(session.plan.artifacts.artifactDirectory), false);
});

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

test("transaction-bound repair audit invalidates a rewritten pending event stage", (t) => {
  const { stateRoot, paths, plan, owner } = leaveRepairReplaced(
    t,
    "transaction-bound-pending-stage-rewrite",
  );
  const transactionBefore = readFileSync(plan.artifacts.transaction);
  const transaction = JSON.parse(transactionBefore.toString("utf8"));
  const eventsBefore = readFileSync(paths.events);
  const separator =
    eventsBefore.length > 0 && eventsBefore.at(-1) !== 0x0a
      ? Buffer.from("\n")
      : Buffer.alloc(0);
  const proposedBytes = Buffer.concat([
    eventsBefore,
    separator,
    Buffer.from(`${JSON.stringify(transaction.eventPlan.event)}\n`),
  ]);
  const existingStages = readdirSync(paths.controlRoot).filter((entry) =>
    entry.startsWith(".events.jsonl.authority."),
  );
  assert.equal(existingStages.length, 1);
  rmSync(path.join(paths.controlRoot, existingStages[0]));
  const stagePath = path.join(
    paths.controlRoot,
    `.events.jsonl.authority.${transaction.eventPlan.stageNamespace}.staging`,
  );
  writeFileSync(stagePath, proposedBytes, { mode: 0o600 });
  const stageStats = lstatSync(stagePath);
  const invalidBytes = Buffer.alloc(proposedBytes.length, 0x78);
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
        ({ beforeFinalizationMutation }) => {
          callbackCalled = true;
          writeFileSync(stagePath, invalidBytes, { mode: 0o600 });
          const rewrittenStats = lstatSync(stagePath);
          assert.equal(rewrittenStats.ino, stageStats.ino);
          assert.equal(rewrittenStats.size, stageStats.size);
          assert.throws(
            () => beforeFinalizationMutation(),
            (error) => error?.code === "authority_generation_conflict",
          );
        },
      ),
    (error) => error?.code === "authority_generation_conflict",
  );

  assert.equal(callbackCalled, true);
  assert.deepEqual(readFileSync(paths.events), eventsBefore);
  assert.deepEqual(readFileSync(plan.artifacts.transaction), transactionBefore);
  assert.deepEqual(readFileSync(stagePath), invalidBytes);
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
        (error) => error?.code === "outcome_ledger_repair_transaction_invalid",
      );
      assert.equal(callbackCalled, false);
      assert.deepEqual(readFileSync(fixture.paths.events), eventsBefore);
      assert.equal(
        JSON.parse(readFileSync(fixture.plan.artifacts.transaction, "utf8"))
          .phase,
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
    JSON.parse(readFileSync(plan.artifacts.completedTransaction, "utf8"))
      .phase,
    "complete",
  );
  assert.equal(existsSync(plan.artifacts.transaction), false);
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
});

test("transaction-bound repair audit helpers are synchronous and expire with their guard", (t) => {
  const asyncFixture = leaveRepairReplaced(t, "transaction-bound-audit-async");
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

  const scopeFixture = leaveRepairReplaced(t, "transaction-bound-audit-scope");
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
    JSON.parse(readFileSync(plan.artifacts.completedTransaction, "utf8"))
      .phase,
    "complete",
  );
  assert.equal(existsSync(plan.artifacts.transaction), false);
  const summary = summarizeOutcomeLedger(paths.outcomes, { stateRoot });
  assert.equal(summary.sourceHealth.controlEventsHealthy, true);
  assert.equal(summary.sourceHealth.ledgerHealthy, true);

  const ledgerAfterRecovery = readFileSync(paths.outcomes);
  const eventsAfterRecovery = readFileSync(paths.events);
  const transactionAfterRecovery = readFileSync(
    plan.artifacts.completedTransaction,
  );
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
    readFileSync(plan.artifacts.completedTransaction).equals(
      transactionAfterRecovery,
    ),
    true,
  );
  assert.equal(
    readFileSync(plan.artifacts.receiptArtifact).equals(receiptAfterRecovery),
    true,
  );
  assert.equal(repairAuditEvents(paths, plan.eventId).length, 1);
});

test("native bounded directory listing enforces both caps before output", async (t) => {
  const root = privateDirectoryFixture(t, "bounded-list");
  writeFileSync(path.join(root, "zeta"), "z\n", { mode: 0o600 });
  writeFileSync(path.join(root, "alpha"), "a\n", { mode: 0o600 });
  const generation = statSync(root);

  await t.test("exact entry and encoded byte caps", () => {
    const expected = Buffer.from("alpha\0zeta", "utf8");
    const descriptor = openSync(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    let result;
    try {
      result = runNativeMoveHelper(
        "list-bounded",
        [2, expected.length, generation.dev, generation.ino],
        [descriptor],
      );
    } finally {
      closeSync(descriptor);
    }
    assert.equal(result.status, 0, result.stderr.toString("utf8"));
    assert.deepEqual(result.stdout, expected);
  });

  writeFileSync(path.join(root, "middle"), "m\n", { mode: 0o600 });
  const expandedGeneration = statSync(root);
  const expectedExpanded = Buffer.from("alpha\0middle\0zeta", "utf8");

  await t.test("entry cap plus one is never emitted", () => {
    const descriptor = openSync(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    let result;
    try {
      result = runNativeMoveHelper(
        "list-bounded",
        [2, expectedExpanded.length, expandedGeneration.dev, expandedGeneration.ino],
        [descriptor],
      );
    } finally {
      closeSync(descriptor);
    }
    assert.equal(result.status, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr.toString("utf8"), /entry boundary/i);
  });

  await t.test("encoded byte cap plus one is never emitted", () => {
    const descriptor = openSync(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    let result;
    try {
      result = runNativeMoveHelper(
        "list-bounded",
        [3, expectedExpanded.length - 1, expandedGeneration.dev, expandedGeneration.ino],
        [descriptor],
      );
    } finally {
      closeSync(descriptor);
    }
    assert.equal(result.status, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr.toString("utf8"), /encoded byte boundary/i);
  });

  await t.test("compiled maxima cannot be expanded by the caller", () => {
    const descriptor = openSync(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    let result;
    try {
      result = runNativeMoveHelper(
        "list-bounded",
        [100_001, 16 * 1024 * 1024 + 1, expandedGeneration.dev, expandedGeneration.ino],
        [descriptor],
      );
    } finally {
      closeSync(descriptor);
    }
    assert.equal(result.status, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr.toString("utf8"), /compiled boundary/i);
  });

  await t.test("directory generation is revalidated after the scan", async (subtest) => {
    const isolated = privateDirectoryFixture(subtest, "bounded-list-race");
    writeFileSync(path.join(isolated, "admitted"), "a\n", { mode: 0o600 });
    const isolatedGeneration = statSync(isolated);
    const descriptor = openSync(
      isolated,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const child = spawnPausedNativeMoveHelper(subtest, {
      operation: "list-bounded",
      arguments_: [10, 4_096, isolatedGeneration.dev, isolatedGeneration.ino],
      descriptors: [descriptor],
      pause: "after-list-bounded-scan",
    });
    closeSync(descriptor);
    let stdout = Buffer.alloc(0);
    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
    });
    await waitForDirectNativeHelperPause(child, "after-list-bounded-scan");
    writeFileSync(path.join(isolated, "late"), "late\n", { mode: 0o600 });
    releaseDirectNativeHelper(child);
    const childExit = await waitForChildExit(child);
    assert.equal(childExit.code, 1);
    assert.equal(childExit.signal, null);
    assert.equal(stdout.length, 0);
  });
});

test("native durable directory retirement is exclusive and generation bound", async (t) => {
  await t.test("moves one admitted directory without replacing another inode", () => {
    const root = privateDirectoryFixture(t, "retire-success");
    const sourceParentPath = path.join(root, "active");
    const destinationParentPath = path.join(root, "retired");
    mkdirSync(sourceParentPath, { mode: 0o700 });
    mkdirSync(destinationParentPath, { mode: 0o700 });
    const sourceName = "lease-generation";
    const destinationName = "lease-generation.archive";
    const sourcePath = path.join(sourceParentPath, sourceName);
    const destinationPath = path.join(destinationParentPath, destinationName);
    mkdirSync(sourcePath, { mode: 0o700 });
    writeFileSync(path.join(sourcePath, "lease.json"), "lease\n", { mode: 0o600 });
    const source = statSync(sourcePath);
    const sourceParent = statSync(sourceParentPath);
    const destinationParent = statSync(destinationParentPath);
    const treeDigest = snapshotRetirementDirectoryTree(
      sourceParentPath,
      sourceName,
    );
    const descriptors = [sourceParentPath, destinationParentPath, sourcePath].map(
      (value) =>
        openSync(
          value,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        ),
    );
    let result;
    try {
      result = runNativeMoveHelper(
        "retire-directory-durable",
        retireDirectoryArguments({
          sourceName,
          destinationName,
          source,
          sourceParent,
          destinationParent,
          treeDigest,
        }),
        descriptors,
      );
    } finally {
      for (const descriptor of descriptors) closeSync(descriptor);
    }
    assert.equal(result.status, 0, result.stderr.toString("utf8"));
    assert.equal(existsSync(sourcePath), false);
    assert.equal(statSync(destinationPath).ino, source.ino);
    assert.equal(
      readFileSync(path.join(destinationPath, "lease.json"), "utf8"),
      "lease\n",
    );
    assert.deepEqual(JSON.parse(result.stdout.toString("utf8")), {
      device: String(source.dev),
      inode: String(source.ino),
      mode: String(source.mode & 0o7777),
      protocol: "freed-lease-archive-move-v1",
      treeDigest,
      uid: String(source.uid),
    });
  });

  await t.test("an occupied destination survives byte exact", () => {
    const root = privateDirectoryFixture(t, "retire-occupied");
    const sourceParentPath = path.join(root, "active");
    const destinationParentPath = path.join(root, "retired");
    mkdirSync(sourceParentPath, { mode: 0o700 });
    mkdirSync(destinationParentPath, { mode: 0o700 });
    const sourceName = "lease-generation";
    const destinationName = "lease-generation.archive";
    const sourcePath = path.join(sourceParentPath, sourceName);
    const destinationPath = path.join(destinationParentPath, destinationName);
    mkdirSync(sourcePath, { mode: 0o700 });
    mkdirSync(destinationPath, { mode: 0o700 });
    writeFileSync(path.join(sourcePath, "source"), "source\n", { mode: 0o600 });
    writeFileSync(path.join(destinationPath, "destination"), "destination\n", {
      mode: 0o600,
    });
    const source = statSync(sourcePath);
    const destination = statSync(destinationPath);
    const sourceParent = statSync(sourceParentPath);
    const destinationParent = statSync(destinationParentPath);
    const treeDigest = snapshotRetirementDirectoryTree(
      sourceParentPath,
      sourceName,
    );
    const descriptors = [sourceParentPath, destinationParentPath, sourcePath].map(
      (value) =>
        openSync(
          value,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        ),
    );
    let result;
    try {
      result = runNativeMoveHelper(
        "retire-directory-durable",
        retireDirectoryArguments({
          sourceName,
          destinationName,
          source,
          sourceParent,
          destinationParent,
          treeDigest,
        }),
        descriptors,
      );
    } finally {
      for (const descriptor of descriptors) closeSync(descriptor);
    }
    assert.equal(result.status, 17);
    assert.equal(result.stdout.length, 0);
    assert.equal(statSync(sourcePath).ino, source.ino);
    assert.equal(statSync(destinationPath).ino, destination.ino);
    assert.equal(readFileSync(path.join(sourcePath, "source"), "utf8"), "source\n");
    assert.equal(
      readFileSync(path.join(destinationPath, "destination"), "utf8"),
      "destination\n",
    );
  });

  await t.test("pre-syscall source drift fails without moving either name", async (subtest) => {
    const root = privateDirectoryFixture(subtest, "retire-pre-race");
    const sourceParentPath = path.join(root, "active");
    const destinationParentPath = path.join(root, "retired");
    mkdirSync(sourceParentPath, { mode: 0o700 });
    mkdirSync(destinationParentPath, { mode: 0o700 });
    const sourceName = "lease-generation";
    const destinationName = "lease-generation.archive";
    const sourcePath = path.join(sourceParentPath, sourceName);
    const destinationPath = path.join(destinationParentPath, destinationName);
    mkdirSync(sourcePath, { mode: 0o700 });
    const source = statSync(sourcePath);
    const sourceParent = statSync(sourceParentPath);
    const destinationParent = statSync(destinationParentPath);
    const treeDigest = snapshotRetirementDirectoryTree(
      sourceParentPath,
      sourceName,
    );
    const descriptors = [sourceParentPath, destinationParentPath, sourcePath].map(
      (value) =>
        openSync(
          value,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        ),
    );
    const child = spawnPausedNativeMoveHelper(subtest, {
      operation: "retire-directory-durable",
      arguments_: retireDirectoryArguments({
        sourceName,
        destinationName,
        source,
        sourceParent,
        destinationParent,
        treeDigest,
      }),
      descriptors,
      pause: "before-retire-directory-syscall",
      source: sourceName,
      destination: destinationName,
    });
    for (const descriptor of descriptors) closeSync(descriptor);
    await waitForDirectNativeHelperPause(child, "before-retire-directory-syscall");
    chmodSync(sourcePath, 0o755);
    releaseDirectNativeHelper(child);
    const childExit = await waitForChildExit(child);
    assert.equal(childExit.code, 1);
    assert.equal(childExit.signal, null);
    assert.equal(existsSync(sourcePath), true);
    assert.equal(existsSync(destinationPath), false);
  });

  await t.test("post-syscall destination replacement is preserved and rejected", async (subtest) => {
    const root = privateDirectoryFixture(subtest, "retire-post-race");
    const sourceParentPath = path.join(root, "active");
    const destinationParentPath = path.join(root, "retired");
    mkdirSync(sourceParentPath, { mode: 0o700 });
    mkdirSync(destinationParentPath, { mode: 0o700 });
    const sourceName = "lease-generation";
    const destinationName = "lease-generation.archive";
    const sourcePath = path.join(sourceParentPath, sourceName);
    const destinationPath = path.join(destinationParentPath, destinationName);
    const displacedPath = path.join(destinationParentPath, "displaced-generation");
    mkdirSync(sourcePath, { mode: 0o700 });
    const source = statSync(sourcePath);
    const sourceParent = statSync(sourceParentPath);
    const destinationParent = statSync(destinationParentPath);
    const treeDigest = snapshotRetirementDirectoryTree(
      sourceParentPath,
      sourceName,
    );
    const descriptors = [sourceParentPath, destinationParentPath, sourcePath].map(
      (value) =>
        openSync(
          value,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        ),
    );
    const child = spawnPausedNativeMoveHelper(subtest, {
      operation: "retire-directory-durable",
      arguments_: retireDirectoryArguments({
        sourceName,
        destinationName,
        source,
        sourceParent,
        destinationParent,
        treeDigest,
      }),
      descriptors,
      pause: "after-retire-directory-before-destination-sync",
      source: sourceName,
      destination: destinationName,
    });
    for (const descriptor of descriptors) closeSync(descriptor);
    await waitForDirectNativeHelperPause(
      child,
      "after-retire-directory-before-destination-sync",
    );
    assert.equal(existsSync(sourcePath), false);
    assert.equal(statSync(destinationPath).ino, source.ino);
    renameSync(destinationPath, displacedPath);
    mkdirSync(destinationPath, { mode: 0o700 });
    const foreign = statSync(destinationPath);
    releaseDirectNativeHelper(child);
    const childExit = await waitForChildExit(child);
    assert.equal(childExit.code, 1);
    assert.equal(childExit.signal, null);
    assert.equal(statSync(displacedPath).ino, source.ino);
    assert.equal(statSync(destinationPath).ino, foreign.ino);
  });
});

test("native exchange rejects two names for the same inode", (t) => {
  const directory = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-repair-same-inode-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  chmodSync(directory, 0o700);
  const sourcePath = path.join(directory, "source.json");
  const destinationPath = path.join(directory, "destination.json");
  const bytes = Buffer.from("same inode must never be exchanged\n", "utf8");
  writeFileSync(sourcePath, bytes, { mode: 0o600 });
  chmodSync(sourcePath, 0o600);
  linkSync(sourcePath, destinationPath);
  const directoryStats = statSync(directory);
  const fileStats = statSync(sourcePath);
  const directoryDescriptor = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const sourceDescriptor = openSync(
    sourcePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const identityArguments = [
      String(fileStats.dev),
      String(fileStats.ino),
      String(fileStats.mode & 0o7777),
      String(fileStats.nlink),
      String(bytes.length),
      sha256(bytes),
    ];
    const helperSource = readFileSync(MOVE_HELPER_PATH, "utf8");
    const framed = framePinnedLeaseArchiveHelperInvocation(
      helperSource,
      "exchange-durable",
      [
        path.basename(sourcePath),
        path.basename(destinationPath),
        ...identityArguments,
        ...identityArguments,
        String(directoryStats.dev),
        String(directoryStats.ino),
        String(directoryStats.dev),
        String(directoryStats.ino),
      ],
      { expectedDigest: sha256(Buffer.from(helperSource, "utf8")) },
    );
    const result = spawnSync(
      "/usr/bin/python3",
      framed.argv,
      {
        encoding: "utf8",
        input: framed.input,
        stdio: [
          "pipe",
          "pipe",
          "pipe",
          directoryDescriptor,
          directoryDescriptor,
          sourceDescriptor,
        ],
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /two distinct inodes/);
    assert.equal(statSync(sourcePath).ino, fileStats.ino);
    assert.equal(statSync(destinationPath).ino, fileStats.ino);
    assert.deepEqual(readFileSync(sourcePath), bytes);
    assert.deepEqual(readFileSync(destinationPath), bytes);
  } finally {
    closeSync(sourceDescriptor);
    closeSync(directoryDescriptor);
  }
});

test("native rename revalidates source bytes after the pre-syscall pause", async (t) => {
  const fixture = temporaryStateRoot(t);
  const source = legacyLine("native-rename-pre-syscall-digest");
  const sourceDigest = writeLedger(fixture.paths, source);
  const plan = planOutcomeLedgerRepair({
    stateRoot: fixture.stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
  });
  const owner = ownerRepairLease(fixture.stateRoot, plan);
  const child = spawnNativePausedRepairChild(t, {
    stateRoot: fixture.stateRoot,
    sourceDigest,
    owner,
    pause: "before-rename-syscall",
    operation: "rename-durable",
    source: path.basename(fixture.paths.outcomes),
  });

  await waitForNativeHelperPause(child, "before-rename-syscall");
  writeFileSync(fixture.paths.outcomes, corruptSameSize(source), {
    mode: 0o600,
  });
  releasePausedNativeHelper(child);
  const childExit = await waitForChildExit(child);
  assert.equal(childExit.code, 1);
  assert.equal(childExit.signal, null);
  writeFileSync(fixture.paths.outcomes, source, { mode: 0o600 });
  chmodSync(fixture.paths.outcomes, 0o600);

  const recovered = repairOutcomeLedger({
    stateRoot: fixture.stateRoot,
    taskId: TASK_ID,
    expectedSourceDigest: sourceDigest,
    ...owner,
  });
  assert.equal(recovered.changed, true);
  assert.equal(readFileSync(fixture.paths.outcomes).length, 0);
  assert.equal(repairAuditEvents(fixture.paths, plan.eventId).length, 1);
});

test("native exchange revalidates both descriptors before and after the syscall", async (t) => {
  for (const checkpoint of [
    "before-exchange-syscall",
    "after-exchange-before-destination-sync",
  ]) {
    await t.test(checkpoint, async (subtest) => {
      const fixture = temporaryStateRoot(subtest);
      const source = legacyLine(`native-exchange-digest-${checkpoint}`);
      const sourceDigest = writeLedger(fixture.paths, source);
      const plan = planOutcomeLedgerRepair({
        stateRoot: fixture.stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
      });
      const owner = ownerRepairLease(fixture.stateRoot, plan);
      const child = spawnNativePausedRepairChild(subtest, {
        stateRoot: fixture.stateRoot,
        sourceDigest,
        owner,
        pause: checkpoint,
        operation: "exchange-durable",
        destination: path.basename(plan.artifacts.transaction),
      });

      await waitForNativeHelperPause(child, checkpoint);
      const expectedPhase =
        checkpoint === "before-exchange-syscall" ? "prepared" : "replaced";
      const expectedBytes = transactionBytesForPlan(plan, expectedPhase);
      assert.deepEqual(readFileSync(plan.artifacts.transaction), expectedBytes);
      writeFileSync(
        plan.artifacts.transaction,
        corruptSameSize(expectedBytes),
        { mode: 0o600 },
      );
      releasePausedNativeHelper(child);
      const childExit = await waitForChildExit(child);
      assert.equal(childExit.code, 1);
      assert.equal(childExit.signal, null);
      writeFileSync(plan.artifacts.transaction, expectedBytes, { mode: 0o600 });
      chmodSync(plan.artifacts.transaction, 0o600);

      const recovered = repairOutcomeLedger({
        stateRoot: fixture.stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
        ...owner,
      });
      assert.equal(recovered.changed, true);
      assert.equal(readFileSync(fixture.paths.outcomes).length, 0);
      assert.equal(repairAuditEvents(fixture.paths, plan.eventId).length, 1);
    });
  }
});

test("replacement and phase archives retain exact distinct inode generations", (t) => {
  const fixture = temporaryStateRoot(t);
  const source = legacyLine("exact-two-inode-archive-chain");
  const sourceDigest = writeLedger(fixture.paths, source);
  const session = repairSession(fixture.stateRoot, sourceDigest);
  const result = executeRepair({
    stateRoot: fixture.stateRoot,
    sourceDigest,
  });
  assert.equal(result.changed, true);
  const retiredDirectory = path.join(
    session.plan.artifacts.artifactDirectory,
    "retired",
  );
  const retiredEntries = readdirSync(retiredDirectory);
  const ledgerArchiveName = retiredEntries.find(
    (entry) =>
      entry.startsWith("ledger-predecessor-") && entry.endsWith(".archive"),
  );
  assert.ok(ledgerArchiveName);
  const ledgerArchivePath = path.join(retiredDirectory, ledgerArchiveName);
  assert.deepEqual(readFileSync(ledgerArchivePath), source);
  assert.notEqual(
    statSync(ledgerArchivePath).ino,
    statSync(fixture.paths.outcomes).ino,
  );
  const phaseInodes = [
    statSync(session.plan.artifacts.completedTransaction).ino,
  ];
  assert.deepEqual(
    readFileSync(session.plan.artifacts.completedTransaction),
    transactionBytesForPlan(session.plan, "complete"),
  );
  for (const phase of ["prepared", "replaced", "audited"]) {
    const archiveName = retiredEntries.find(
      (entry) =>
        entry.startsWith(`transaction-${phase}-predecessor-`) &&
        entry.endsWith(".archive"),
    );
    assert.ok(archiveName, phase);
    const archivePath = path.join(retiredDirectory, archiveName);
    assert.deepEqual(
      readFileSync(archivePath),
      transactionBytesForPlan(session.plan, phase),
      phase,
    );
    phaseInodes.push(statSync(archivePath).ino);
  }
  assert.equal(new Set(phaseInodes).size, 4);
});

for (const move of [
  {
    label: "canonical predecessor archive",
    source: ({ paths }) => path.basename(paths.outcomes),
    destination: () => "",
  },
  {
    label: "canonical replacement publication",
    source: () => "",
    destination: ({ paths }) => path.basename(paths.outcomes),
  },
]) {
  for (const pause of [
    "before-rename-syscall",
    "after-rename-before-destination-sync",
    "after-destination-sync",
    "after-source-sync",
    "after-postcheck",
  ]) {
    test(`SIGKILL inside native ${move.label} at ${pause} recovers without loss`, async (t) => {
      const fixture = temporaryStateRoot(t);
      const source = legacyLine(`native-sigkill-${move.label}-${pause}`);
      const sourceDigest = writeLedger(fixture.paths, source);
      const plan = planOutcomeLedgerRepair({
        stateRoot: fixture.stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
      });
      const owner = ownerRepairLease(fixture.stateRoot, plan);
      const child = spawnNativePausedRepairChild(t, {
        stateRoot: fixture.stateRoot,
        sourceDigest,
        owner,
        pause,
        operation: "rename-durable",
        source: move.source(fixture),
        destination: move.destination(fixture),
      });

      await waitForNativeHelperPause(child, pause);
      killPausedNativeHelper(child);
      const childExit = await waitForChildExit(child);
      assert.equal(childExit.code, 1);
      assert.equal(childExit.signal, null);

      const recovered = repairOutcomeLedger({
        stateRoot: fixture.stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
        ...owner,
      });
      assert.equal(recovered.changed, true);
      assert.equal(readFileSync(fixture.paths.outcomes).length, 0);
      assert.equal(
        JSON.parse(
          readFileSync(plan.artifacts.completedTransaction, "utf8"),
        ).phase,
        "complete",
      );
      assert.equal(existsSync(plan.artifacts.transaction), false);
      assert.equal(repairAuditEvents(fixture.paths, plan.eventId).length, 1);
      const retired = readdirSync(
        path.join(plan.artifacts.artifactDirectory, "retired"),
      );
      assert.equal(
        retired.filter((entry) => entry.startsWith("ledger-predecessor-")).length,
        1,
      );
    });
  }
}

for (const pause of [
  "before-exchange-syscall",
  "after-exchange-before-destination-sync",
  "after-exchange-destination-sync",
  "after-exchange-source-sync",
  "after-exchange-postcheck",
]) {
  test(`SIGKILL inside native transaction exchange at ${pause} recovers the phase chain`, async (t) => {
    const fixture = temporaryStateRoot(t);
    const source = legacyLine(`native-transaction-sigkill-${pause}`);
    const sourceDigest = writeLedger(fixture.paths, source);
    const plan = planOutcomeLedgerRepair({
      stateRoot: fixture.stateRoot,
      taskId: TASK_ID,
      expectedSourceDigest: sourceDigest,
    });
    const owner = ownerRepairLease(fixture.stateRoot, plan);
    const child = spawnNativePausedRepairChild(t, {
      stateRoot: fixture.stateRoot,
      sourceDigest,
      owner,
      pause,
      operation: "exchange-durable",
      destination: path.basename(plan.artifacts.transaction),
    });

    await waitForNativeHelperPause(child, pause);
    killPausedNativeHelper(child);
    const childExit = await waitForChildExit(child);
    assert.equal(childExit.code, 1);
    assert.equal(childExit.signal, null);

    const recovered = repairOutcomeLedger({
      stateRoot: fixture.stateRoot,
      taskId: TASK_ID,
      expectedSourceDigest: sourceDigest,
      ...owner,
    });
    assert.equal(recovered.changed, true);
    assert.equal(readFileSync(fixture.paths.outcomes).length, 0);
    assert.equal(
      JSON.parse(readFileSync(plan.artifacts.completedTransaction, "utf8"))
        .phase,
      "complete",
    );
    assert.equal(existsSync(plan.artifacts.transaction), false);
    assert.equal(repairAuditEvents(fixture.paths, plan.eventId).length, 1);
  });
}

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

  const recovered = appendOutcomeLedger(fixture.paths.outcomes, fixture.entry, {
      stateRoot: fixture.stateRoot,
      authentication: fixture.authentication,
      now: fixture.now,
  });
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

test("outcome append accepts the exact aggregate byte cap and rejects the next entry", () => {
  const finalEntry = { boundary: "exact-aggregate-cap" };
  const finalEntryBytes = Buffer.from(`${JSON.stringify(finalEntry)}\n`, "utf8");
  let remaining = OUTCOME_LEDGER_REPAIR_MAX_BYTES - finalEntryBytes.length;
  const lines = [];
  while (remaining > 0) {
    let lineSize = Math.min(OUTCOME_LEDGER_REPAIR_MAX_LINE_BYTES, remaining);
    const tailSize = remaining - lineSize;
    if (tailSize > 0 && tailSize < 3) lineSize -= 3 - tailSize;
    assert.ok(lineSize >= 3);
    lines.push(Buffer.from(`"${"x".repeat(lineSize - 3)}"\n`, "utf8"));
    remaining -= lineSize;
  }
  const ledgerBeforeAppend = Buffer.concat(lines);
  const admitted = prepareOutcomeLedgerAppend(ledgerBeforeAppend, finalEntry);
  const ledgerAtCap = Buffer.concat([
    ledgerBeforeAppend,
    admitted.separator,
    admitted.entryBytes,
  ]);
  assert.equal(ledgerAtCap.length, OUTCOME_LEDGER_REPAIR_MAX_BYTES);
  const ledgerBeforeFailure = Buffer.from(ledgerAtCap);
  assert.throws(
    () => prepareOutcomeLedgerAppend(ledgerAtCap, { boundary: "over-cap" }),
    /supported repair boundary/i,
  );
  assert.deepEqual(ledgerAtCap, ledgerBeforeFailure);
});

test("outcome append accepts the exact event cap and preflight failure is byte-stable", (t) => {
  const eventCap = 128 * 1024 * 1024;
  const { stateRoot, paths } = temporaryStateRoot(t);
  const { nightly, nowMs } = trustedMergedOutcome(stateRoot);
  removeAutomationAuthorityStages(paths.taskManifest);
  removeControlEventAuthorityStages(paths);
  appendJsonPaddingToSize(paths.events, eventCap, "event_boundary_padding");
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

test("repair planning accepts the exact physical line boundary matrix", async (t) => {
  for (const lineCount of [
    OUTCOME_LEDGER_REPAIR_MAX_LINES - 1,
    OUTCOME_LEDGER_REPAIR_MAX_LINES,
  ]) {
    await t.test(lineCount.toLocaleString(), () => {
      const { stateRoot, paths } = temporaryStateRoot(t);
      const source = Buffer.from("{}\n".repeat(lineCount), "utf8");
      const sourceDigest = writeLedger(paths, source, 0o600);
      const plan = planOutcomeLedgerRepair({
        stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
      });
      assert.equal(plan.parameters.sourceLineCount, lineCount);
      assert.equal(plan.parameters.sourceSize, source.length);
      assert.equal(readFileSync(paths.outcomes).equals(source), true);
    });
  }
});

test("repair planning rejects an interior whitespace line at the exact cap byte-stably", (t) => {
  const { stateRoot, paths } = temporaryStateRoot(t);
  const beforeCount = OUTCOME_LEDGER_REPAIR_MAX_LINES - 2;
  const source = Buffer.concat([
    Buffer.from("{}\n".repeat(beforeCount), "utf8"),
    Buffer.from(" \t \n", "utf8"),
    Buffer.from("{}\n", "utf8"),
  ]);
  const sourceDigest = writeLedger(paths, source, 0o600);
  assert.throws(
    () =>
      planOutcomeLedgerRepair({
        stateRoot,
        taskId: TASK_ID,
        expectedSourceDigest: sourceDigest,
      }),
    new RegExp(`line ${(beforeCount + 1).toLocaleString()} is blank`, "i"),
  );
  assert.equal(readFileSync(paths.outcomes).equals(source), true);
});

test("outcome append at the exact physical line cap fails before mutation", (t) => {
  const ledgerBelowCap = Buffer.from(
    "{}\n".repeat(OUTCOME_LEDGER_REPAIR_MAX_LINES - 1),
    "utf8",
  );
  const belowCapBefore = Buffer.from(ledgerBelowCap);
  const admitted = prepareOutcomeLedgerAppend(ledgerBelowCap, {
    boundary: "last-slot",
  });
  assert.equal(admitted.separator.length, 0);
  assert.deepEqual(ledgerBelowCap, belowCapBefore);
  assert.equal(
    Buffer.concat([ledgerBelowCap, admitted.entryBytes])
      .toString("utf8")
      .split("\n")
      .filter(Boolean).length,
    OUTCOME_LEDGER_REPAIR_MAX_LINES,
  );

  const ledgerAtCap = Buffer.concat([ledgerBelowCap, admitted.entryBytes]);
  const atCapBefore = Buffer.from(ledgerAtCap);
  assert.throws(
    () => prepareOutcomeLedgerAppend(ledgerAtCap, { boundary: "over-cap" }),
    /supported repair boundary/i,
  );
  assert.deepEqual(ledgerAtCap, atCapBefore);
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
  const taskTransactionsBefore = flatDirectorySnapshot(
    fixture.paths.taskTransactions,
  );
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

  restoreFlatDirectorySnapshot(
    fixture.paths.taskTransactions,
    taskTransactionsBefore,
  );
  removeAutomationAuthorityStages(fixture.paths.taskManifest);
  removeControlEventAuthorityStages(fixture.paths);
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

test("an installed identity version above the outcome ledger line cap fails before task transition mutation", (t) => {
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
    /outcome ledger append.*supported repair boundary/i,
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
    /fully authenticated, healthy outcome ledger.*supported repair boundary/i,
  );

  assertOutcomeMutationSnapshot(stateRoot, paths, before);
});

test("safe source admission rejects symlinks, writable files, oversize files, and invalid bytes", async (t) => {
  await t.test("symlink", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const target = path.join(stateRoot, "legacy-target.jsonl");
    writeFileSync(target, legacyLine("symlink-target"), { mode: 0o600 });
    rmSync(paths.outcomes);
    symlinkSync(target, paths.outcomes);
    assert.throws(
      () =>
        planOutcomeLedgerRepair({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sha256(readFileSync(target)),
        }),
      isUnsafeAuthorityAdmission,
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
      isUnsafeAuthorityAdmission,
    );
  });

  await t.test("hard-linked ledger", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const source = legacyLine("hard-linked-ledger");
    const sourceDigest = writeLedger(paths, source, 0o600);
    const alias = path.join(stateRoot, "outcomes-hard-link.jsonl");
    linkSync(paths.outcomes, alias);
    assert.throws(
      () =>
        planOutcomeLedgerRepair({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
        }),
      isUnsafeAuthorityAdmission,
    );
    assert.equal(readFileSync(paths.outcomes).equals(source), true);
  });

  await t.test("hard-linked event history", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const source = legacyLine("hard-linked-events");
    const sourceDigest = writeLedger(paths, source, 0o600);
    linkSync(paths.events, path.join(stateRoot, "events-hard-link.jsonl"));
    assert.throws(
      () =>
        planOutcomeLedgerRepair({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
        }),
      isUnsafeAuthorityAdmission,
    );
    assert.equal(readFileSync(paths.outcomes).equals(source), true);
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
      isUnsafeAuthorityAdmission,
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
      isUnsafeAuthorityAdmission,
    );
  });

  await t.test("oversized physical line", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const source = Buffer.from(
      `${JSON.stringify({ padding: "x".repeat(OUTCOME_LEDGER_REPAIR_MAX_LINE_BYTES) })}\n`,
      "utf8",
    );
    assert.ok(source.length > OUTCOME_LEDGER_REPAIR_MAX_LINE_BYTES);
    const sourceDigest = writeLedger(paths, source, 0o600);
    const before = readFileSync(paths.outcomes);
    assert.throws(
      () =>
        planOutcomeLedgerRepair({
          stateRoot,
          taskId: TASK_ID,
          expectedSourceDigest: sourceDigest,
        }),
      /physical byte boundary/i,
    );
    assert.equal(readFileSync(paths.outcomes).equals(before), true);
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
  rmSync(paths.outcomes);
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
      console.error(error?.stack ?? error);
      process.exit(3);
    }
  `;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", childScript],
    { encoding: "utf8", timeout: 2_000 },
  );
  assert.notEqual(child.error?.code, "ETIMEDOUT");
  assert.equal(child.signal, null);
  assert.notEqual(child.status, 0, child.stderr);
  assert.match(
    child.stderr,
    /not a regular file|authority-entry-inventory|unsafe .*file|could not be admitted safely/i,
  );
});

test("nightly summary rejects canonical outcome and event FIFOs without hanging", async (t) => {
  await t.test("outcomes FIFO", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    rmSync(paths.outcomes);
    const created = spawnSync("mkfifo", [paths.outcomes], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    const child = summaryHealthInChild({
      stateRoot,
      ledgerPath: paths.outcomes,
      field: "ledgerSyntaxHealthy",
    });
    assert.notEqual(child.error?.code, "ETIMEDOUT");
    assert.equal(child.signal, null);
    assert.notEqual(child.status, 0, child.stderr);
    assert.match(
      child.stderr,
      /not a regular file|authority-entry-inventory|unsafe .*file/i,
    );
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
    assert.notEqual(child.status, 0, child.stderr);
    assert.match(
      child.stderr,
      /not a regular file|authority-entry-inventory|unsafe .*file/i,
    );
  });
});

test("nightly summary rejects canonical outcome and event symlinks without following them", async (t) => {
  await t.test("outcomes symlink", () => {
    const { stateRoot, paths } = temporaryStateRoot(t);
    const target = path.join(stateRoot, "valid-outcomes-target.jsonl");
    writeFileSync(target, `${JSON.stringify({ syntactically: "valid" })}\n`, {
      mode: 0o600,
    });
    rmSync(paths.outcomes);
    symlinkSync(target, paths.outcomes);
    const child = summaryHealthInChild({
      stateRoot,
      ledgerPath: paths.outcomes,
      field: "ledgerSyntaxHealthy",
    });
    assert.notEqual(child.error?.code, "ETIMEDOUT");
    assert.equal(child.signal, null);
    assert.notEqual(child.status, 0, child.stderr);
    assert.match(
      child.stderr,
      /symbolic link|symlink|ELOOP|authority-entry-inventory|admitted safely/i,
    );
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
    assert.notEqual(child.status, 0, child.stderr);
    assert.match(
      child.stderr,
      /symbolic link|symlink|ELOOP|authority-entry-inventory|admitted safely/i,
    );
  });
});

test("completed repair health fails closed for missing or reformatted evidence", async (t) => {
  await t.test("live legacy preparation temporary", () => {
    const fixture = completedLegacyRepair(t, "complete-live-legacy-temp");
    const temporaryPath = path.join(
      fixture.plan.artifacts.artifactDirectory,
      `.${path.basename(fixture.plan.artifacts.sourceArtifact)}.424214.tmp`,
    );
    writeFileSync(
      temporaryPath,
      readFileSync(fixture.plan.artifacts.sourceArtifact).subarray(0, 64),
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        executeRepair({
          stateRoot: fixture.stateRoot,
          sourceDigest: fixture.sourceDigest,
        }),
      /unexpected artifact tree entry|temporary/i,
    );
    assert.equal(
      summarizeOutcomeLedger(fixture.paths.outcomes, {
        stateRoot: fixture.stateRoot,
      }).sourceHealth.ledgerHealthy,
      false,
    );
  });

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
        /one exact receipt|receipt drifted/.test(issue),
      ),
    );
  });

  await t.test("missing audit event", () => {
    const fixture = completedLegacyRepair(t, "missing-complete-audit");
    const retained = readFileSync(fixture.paths.events, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => JSON.parse(line).eventId !== fixture.plan.eventId);
    removeControlEventAuthorityStages(fixture.paths);
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

test("repair audit event raw bytes use the shared parameter order", (t) => {
  const fixture = completedLegacyRepair(t, "repair-event-raw-byte-order");
  const rawLine = readFileSync(fixture.paths.events)
    .toString("utf8")
    .split("\n")
    .find((line) => {
      if (!line) return false;
      return JSON.parse(line).eventId === fixture.plan.eventId;
    });
  assert.ok(rawLine);
  const event = JSON.parse(rawLine);
  const expected = {
    schemaVersion: event.schemaVersion,
    eventId: fixture.plan.eventId,
    type: event.type,
    ts: event.ts,
    actor: "freed-owner",
    taskId: fixture.plan.taskId,
    data: {
      intentDigest: fixture.plan.intentDigest,
      parameters: orderedOutcomeLedgerRepairParameters(
        fixture.plan.parameters,
      ),
      authorization: event.data.authorization,
    },
  };
  assert.equal(`${rawLine}\n`, `${JSON.stringify(expected)}\n`);
  assert.equal(
    summarizeOutcomeLedger(fixture.paths.outcomes, {
      stateRoot: fixture.stateRoot,
    }).sourceHealth.ledgerHealthy,
    true,
  );
});

test("completed repair transactions require exact private mode in replay and health", async (t) => {
  for (const mode of [0o640, 0o644]) {
    await t.test(mode.toString(8), () => {
      const fixture = completedLegacyRepair(
        t,
        `complete-mode-${mode.toString(8)}`,
      );
      const transactionPath = fixture.plan.artifacts.completedTransaction;
      const transactionBytes = readFileSync(transactionPath);
      const ledgerBytes = readFileSync(fixture.paths.outcomes);
      const eventBytes = readFileSync(fixture.paths.events);
      chmodSync(transactionPath, mode);
      const transactionStats = statSync(transactionPath);
      assert.throws(
        () =>
          executeRepair({
            stateRoot: fixture.stateRoot,
            sourceDigest: fixture.sourceDigest,
          }),
        /unsafe outcome ledger repair file/i,
      );
      const health = summarizeOutcomeLedger(fixture.paths.outcomes, {
        stateRoot: fixture.stateRoot,
      }).sourceHealth;
      assert.equal(health.ledgerHealthy, false);
      assert.equal(health.outcomeLedgerTransactionsHealthy, false);
      assert.ok(
        health.outcomeLedgerTransactionIssues.some(
          (issue) =>
            /transaction inventory admission failed/i.test(issue) &&
            /unsupported exact mode/i.test(issue),
        ),
        JSON.stringify(health.outcomeLedgerTransactionIssues),
      );
      assert.deepEqual(
        readFileSync(transactionPath),
        transactionBytes,
      );
      assert.deepEqual(readFileSync(fixture.paths.outcomes), ledgerBytes);
      assert.deepEqual(readFileSync(fixture.paths.events), eventBytes);
      const finalTransactionStats = statSync(transactionPath);
      assert.equal(finalTransactionStats.ino, transactionStats.ino);
      assert.equal(finalTransactionStats.mode & 0o7777, mode);
    });
  }
});

test("completed repair canonical ledger requires exact private mode in replay and health", async (t) => {
  for (const mode of [0o640, 0o644]) {
    await t.test(mode.toString(8), () => {
      const fixture = completedLegacyRepair(
        t,
        `complete-ledger-mode-${mode.toString(8)}`,
      );
      const ledgerBytes = readFileSync(fixture.paths.outcomes);
      const transactionPath = fixture.plan.artifacts.completedTransaction;
      const transactionBytes = readFileSync(transactionPath);
      const eventBytes = readFileSync(fixture.paths.events);
      chmodSync(fixture.paths.outcomes, mode);
      const ledgerStats = statSync(fixture.paths.outcomes);
      assert.throws(
        () =>
          executeRepair({
            stateRoot: fixture.stateRoot,
            sourceDigest: fixture.sourceDigest,
          }),
        /unsafe outcome ledger repair file|private canonical ledger|publication canonical contains a foreign generation/i,
      );
      const health = summarizeOutcomeLedger(fixture.paths.outcomes, {
        stateRoot: fixture.stateRoot,
      }).sourceHealth;
      assert.equal(health.ledgerHealthy, false);
      assert.equal(health.outcomeLedgerTransactionsHealthy, false);
      assert.ok(
        health.outcomeLedgerTransactionIssues.some((issue) =>
          /private canonical ledger/i.test(issue),
        ),
      );
      assert.deepEqual(readFileSync(fixture.paths.outcomes), ledgerBytes);
      assert.deepEqual(
        readFileSync(transactionPath),
        transactionBytes,
      );
      assert.deepEqual(readFileSync(fixture.paths.events), eventBytes);
      const finalLedgerStats = statSync(fixture.paths.outcomes);
      assert.equal(finalLedgerStats.ino, ledgerStats.ino);
      assert.equal(finalLedgerStats.mode & 0o7777, mode);
    });
  }
});

test("completed repair canonical event history requires exact private mode in replay and health", async (t) => {
  for (const mode of [0o640, 0o644]) {
    await t.test(mode.toString(8), () => {
      const fixture = completedLegacyRepair(
        t,
        `complete-events-mode-${mode.toString(8)}`,
      );
      const events = readFileSync(fixture.paths.events);
      chmodSync(fixture.paths.events, mode);
      assert.throws(
        () =>
          executeRepair({
            stateRoot: fixture.stateRoot,
            sourceDigest: fixture.sourceDigest,
          }),
        /unsafe outcome ledger repair file|control event history|authority-entry-inventory/i,
      );
      assert.deepEqual(readFileSync(fixture.paths.events), events);
      assert.equal(statSync(fixture.paths.events).mode & 0o7777, mode);
      assert.throws(
        () =>
          summarizeOutcomeLedger(fixture.paths.outcomes, {
            stateRoot: fixture.stateRoot,
          }),
        /authority entry inventory|control event history|mode|admitted safely|unsafe/i,
      );
    });
  }
});

test("completed repair audit rejects exact owner confirmation provenance corruption", async (t) => {
  const fixture = completedLegacyRepair(t, "complete-owner-provenance");
  const baselineEvents = readFileSync(fixture.paths.events);
  const baselineLedger = readFileSync(fixture.paths.outcomes);
  const transactionPath = fixture.plan.artifacts.completedTransaction;
  const baselineTransaction = readFileSync(transactionPath);
  const auditEvent = repairAuditEvents(fixture.paths, fixture.plan.eventId)[0];
  assert.equal(
    auditEvent?.data?.authorization?.credentialKind,
    "owner-confirmation",
  );

  const variants = [
    {
      name: "wrong approvedBy",
      mutate: (provenance) => {
        provenance.ownerConfirmationApprovedBy = "forged-owner";
      },
    },
    {
      name: "invalid confirmation ID",
      mutate: (provenance) => {
        provenance.ownerConfirmationId = "../forged-confirmation";
      },
    },
    {
      name: "mismatched task ID",
      mutate: (provenance) => {
        provenance.ownerConfirmationTaskId = `${TASK_ID}-forged`;
      },
    },
    {
      name: "padded confirmation reference",
      mutate: (provenance) => {
        provenance.ownerConfirmationReference =
          `${provenance.ownerConfirmationReference} `;
      },
    },
    {
      name: "padded approval reference",
      mutate: (provenance) => {
        provenance.ownerConfirmationApprovalReference =
          ` ${provenance.ownerConfirmationApprovalReference}`;
      },
    },
    {
      name: "overlong confirmation lifetime",
      mutate: (provenance) => {
        provenance.ownerConfirmationExpiresAt = new Date(
          Date.parse(provenance.ownerConfirmationApprovedAt) +
            8 * 24 * 60 * 60_000,
        ).toISOString();
      },
    },
    {
      name: "audit before lease acquisition",
      mutate: (provenance, event) => {
        event.ts = new Date(
          Date.parse(provenance.leaseAcquiredAt) - 1,
        ).toISOString();
      },
    },
    {
      name: "audit at confirmation expiry",
      mutate: (provenance, event) => {
        provenance.ownerConfirmationExpiresAt = event.ts;
      },
    },
  ];

  for (const variant of variants) {
    await t.test(variant.name, () => {
      try {
        const corruptedEvents = rewriteControlEvent(
          fixture.paths,
          fixture.plan.eventId,
          (event) => variant.mutate(event.data.authorization, event),
        );
        assert.throws(
          () =>
            executeRepair({
              stateRoot: fixture.stateRoot,
              sourceDigest: fixture.sourceDigest,
            }),
          /authorization provenance is invalid|confirmation provenance does not match the intent|authorization does not match one exact preceding owner lease acquisition|repair event does not match/i,
        );
        const health = summarizeOutcomeLedger(fixture.paths.outcomes, {
          stateRoot: fixture.stateRoot,
        }).sourceHealth;
        assert.equal(health.outcomeLedgerTransactionsHealthy, false);
        assert.equal(health.ledgerHealthy, false);
        assert.ok(
          health.outcomeLedgerTransactionIssues.some((issue) =>
            /authorization provenance is invalid|confirmation provenance does not match the intent|authorization does not match one exact preceding owner lease acquisition|matching (?:complete|canonical) transaction (?:is )?missing or invalid/i.test(
              issue,
            ),
          ),
        );
        assert.deepEqual(readFileSync(fixture.paths.events), corruptedEvents);
        assert.deepEqual(readFileSync(fixture.paths.outcomes), baselineLedger);
        assert.deepEqual(
          readFileSync(transactionPath),
          baselineTransaction,
        );
      } finally {
        removeControlEventAuthorityStages(fixture.paths);
        writeFileSync(fixture.paths.events, baselineEvents, { mode: 0o600 });
        chmodSync(fixture.paths.events, 0o600);
      }
    });
  }
});

test("a completed repair event cannot outlive its canonical transaction", (t) => {
  const fixture = completedLegacyRepair(t, "missing-complete-transaction");
  rmSync(fixture.plan.artifacts.completedTransaction);
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
  const transactionPath = fixture.plan.artifacts.completedTransaction;
  const validBytes = readFileSync(transactionPath);
  const invalidBytes = Buffer.concat([
    validBytes.subarray(0, validBytes.length - 1),
    Buffer.from([0xff]),
    validBytes.subarray(validBytes.length - 1),
  ]);
  writeFileSync(transactionPath, invalidBytes, {
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
  const transactionPath = fixture.plan.artifacts.completedTransaction;
  const record = JSON.parse(
    readFileSync(transactionPath, "utf8"),
  );
  record.taskId = "../../../../out-of-root-probe";
  writeFileSync(
    transactionPath,
    `${JSON.stringify(record, null, 2)}\n`,
    { mode: 0o600 },
  );
  const health = summarizeOutcomeLedger(fixture.paths.outcomes, {
    stateRoot: fixture.stateRoot,
  }).sourceHealth;
  assert.equal(health.ledgerHealthy, false);
  assert.ok(
    health.outcomeLedgerTransactionIssues.some((issue) =>
      /identity is invalid|invalid transaction record|invalid outer shape/i.test(
        issue,
      ),
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
    /stable task ID/i,
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
      assert.throws(
        () =>
          summarizeOutcomeLedger(fixture.paths.outcomes, {
            stateRoot: fixture.stateRoot,
          }),
        /private|control root|authority|mode|admitted safely|kernel guard cutover/i,
      );
    } finally {
      chmodSync(fixture.paths.controlRoot, 0o700);
    }
  });
});

test("completed repair retry and nightly health reject bound event prefix drift", (t) => {
  const probeMarker = Buffer.from(
    '"type":"event_prefix_probe","payload":"',
    "utf8",
  );
  const fixture = completedLegacyRepair(t, "shared-event-prefix-drift", {
    beforePlan: ({ paths }) => {
      removeAutomationAuthorityStages(paths.taskManifest);
      removeControlEventAuthorityStages(paths);
      appendFileSync(
        paths.events,
        Buffer.from('{"type":"event_prefix_probe","payload":"a"}\n', "utf8"),
      );
    },
  });
  const events = readFileSync(fixture.paths.events);
  const prefix = events.subarray(0, fixture.plan.parameters.eventHistorySize);
  const markerOffset = prefix.indexOf(probeMarker);
  assert.ok(markerOffset >= 0);
  const mutationOffset = markerOffset + probeMarker.length;
  events[mutationOffset] =
    events[mutationOffset] === "a".charCodeAt(0)
      ? "b".charCodeAt(0)
      : "a".charCodeAt(0);
  removeAutomationAuthorityStages(fixture.paths.taskManifest);
  removeControlEventAuthorityStages(fixture.paths);
  writeFileSync(fixture.paths.events, events, { mode: 0o600 });
  const summary = summarizeOutcomeLedger(fixture.paths.outcomes, {
    stateRoot: fixture.stateRoot,
  });
  assert.equal(summary.sourceHealth.controlEventsHealthy, true);
  assert.equal(summary.sourceHealth.ledgerHealthy, false);
  assert.ok(
    summary.sourceHealth.outcomeLedgerTransactionIssues.some((issue) =>
      /event prefix drifted|repair event plan history boundary changed/i.test(
        issue,
      ),
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
  assert.throws(
    () =>
      summarizeOutcomeLedger(fixture.paths.outcomes, {
        stateRoot: fixture.stateRoot,
      }),
    /UTF-8|control event history/i,
  );
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
  const targetSize = 17 * 1024 * 1024;
  const fixture = completedLegacyRepair(t, "large-valid-event-suffix", {
    beforePlan: ({ paths }) => {
      removeAutomationAuthorityStages(paths.taskManifest);
      removeControlEventAuthorityStages(paths);
      appendJsonPaddingToSize(
        paths.events,
        targetSize,
        "large_preexisting_event_history",
      );
    },
  });
  const beforeSize = statSync(fixture.paths.events).size;
  heartbeatLease({
    stateRoot: fixture.stateRoot,
    name: fixture.owner.leaseName,
    operationId: leaseMutationId("heartbeat:large-event-suffix"),
    token: fixture.owner.leaseToken,
  });
  const grownSize = statSync(fixture.paths.events).size;
  assert.ok(grownSize > beforeSize);
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
  "replacement-intent-durable",
  "replacement-predecessor-archived",
  "replacement-renamed",
  "replacement-directory-synced",
  "transaction-replaced-intent-durable",
  "transaction-replaced-exchanged",
  "transaction-replaced-predecessor-archived",
  "transaction-replaced",
  "event-audited",
  "transaction-audited-intent-durable",
  "transaction-audited-exchanged",
  "transaction-audited-predecessor-archived",
  "transaction-audited",
  "receipt-written",
  "transaction-complete-intent-durable",
  "transaction-complete-exchanged",
  "transaction-complete-predecessor-archived",
  "transaction-complete",
  "transaction-retirement-before-rename",
  "transaction-retired",
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
      checkpointName.startsWith("transaction-complete") ||
        checkpointName.startsWith("transaction-retir")
        ? false
        : true,
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
