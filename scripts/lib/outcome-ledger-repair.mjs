import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  automationControlPaths,
  ownerGovernanceIntentDigest,
  preauthorizeOutcomeLedgerRepair,
  preflightOutcomeLedgerRepairEvent,
  reauthorizeOutcomeLedgerRepairLease,
  validateOutcomeLedgerRepairEvent,
  withMutationLeaseAuthority,
  withOutcomeLedgerRepairFinalizationGuard,
} from "./automation-control.mjs";
import {
  OUTCOME_LEDGER_REPAIR_ACTION,
  OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  OUTCOME_LEDGER_REPAIR_MAX_LINES,
  OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS,
  OUTCOME_LEDGER_REPAIR_PHASES,
  OUTCOME_LEDGER_REPAIR_POLICY,
  OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
  OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS,
  outcomeLedgerRepairEventId,
  outcomeLedgerRepairOperationSeed,
} from "./outcome-ledger-repair-contract.mjs";
import {
  summarizeOutcomeLedger,
  withOutcomeLedgerWriterLock,
} from "../nightly-self-improve.mjs";

const OUTCOME_CONTROL_EVENT_MAX_BYTES = 128 * 1024 * 1024;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const QUARANTINE_SUFFIX_PATTERN =
  "(?:\\.quarantine\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TRANSACTION_PHASES = new Set(OUTCOME_LEDGER_REPAIR_PHASES);
const decoder = new TextDecoder("utf-8", { fatal: true });

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireSha256(value, field) {
  const normalized = String(value ?? "").toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}

function requireTaskId(taskId) {
  if (typeof taskId !== "string" || !IDENTIFIER_PATTERN.test(taskId)) {
    throw new Error("Outcome ledger repair requires a stable task ID.");
  }
  return taskId;
}

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : -1;
}

function syncDirectory(directoryPath) {
  let descriptor;
  try {
    descriptor = openSync(
      directoryPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    fsyncSync(descriptor);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requirePrivateDirectory(directoryPath, { create = false } = {}) {
  if (create && !existsAsPath(directoryPath)) {
    const parent = path.dirname(directoryPath);
    requirePrivateDirectory(parent);
    try {
      mkdirSync(directoryPath, { mode: 0o700 });
      syncDirectory(parent);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  const stats = lstatSync(directoryPath);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid() ||
    (stats.mode & 0o777) !== 0o700 ||
    realpathSync(directoryPath) !== directoryPath
  ) {
    throw new Error(
      `Outcome ledger repair directory must be a private canonical directory: ${directoryPath}`,
    );
  }
  if (create) syncDirectory(path.dirname(directoryPath));
}

function safeReadRegularFile(
  filePath,
  {
    maxBytes = OUTCOME_LEDGER_REPAIR_MAX_BYTES,
    exactMode = null,
    allowReadonlyGroupWorld = false,
  } = {},
) {
  if (
    typeof constants.O_NOFOLLOW !== "number" ||
    typeof constants.O_NONBLOCK !== "number"
  ) {
    throw new Error("Safe nonblocking file admission is unavailable.");
  }
  const descriptor = openSync(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(descriptor);
    const mode = before.mode & 0o7777;
    if (
      realpathSync(filePath) !== filePath ||
      !before.isFile() ||
      before.uid !== currentUid() ||
      before.size < 0 ||
      before.size > maxBytes ||
      (exactMode !== null && mode !== exactMode) ||
      (exactMode === null &&
        allowReadonlyGroupWorld &&
        ![0o600, 0o640, 0o644].includes(mode)) ||
      (exactMode === null && !allowReadonlyGroupWorld && mode !== 0o600)
    ) {
      throw new Error(`Unsafe outcome ledger repair file: ${filePath}`);
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
    if (
      offset !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new Error(`Outcome ledger repair source changed while read: ${filePath}`);
    }
    const pathStats = lstatSync(filePath);
    if (
      pathStats.isSymbolicLink() ||
      pathStats.dev !== before.dev ||
      pathStats.ino !== before.ino ||
      realpathSync(filePath) !== filePath
    ) {
      throw new Error(`Outcome ledger repair source path changed: ${filePath}`);
    }
    return {
      bytes: buffer.subarray(0, offset),
      digest: sha256(buffer.subarray(0, offset)),
      size: offset,
      device: before.dev,
      inode: before.ino,
      mode,
    };
  } finally {
    closeSync(descriptor);
  }
}

function physicalJsonLines(bytes) {
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
    const content = raw.subarray(0, contentEnd);
    let text;
    try {
      text = decoder.decode(content);
    } catch {
      throw new Error(
        `Outcome ledger line ${lineNumber.toLocaleString()} is not valid UTF-8.`,
      );
    }
    if (!text.trim()) {
      throw new Error(
        `Outcome ledger line ${lineNumber.toLocaleString()} is blank.`,
      );
    }
    try {
      JSON.parse(text);
    } catch {
      throw new Error(
        `Outcome ledger line ${lineNumber.toLocaleString()} is malformed JSON.`,
      );
    }
    lines.push({
      lineNumber,
      offset,
      length: raw.length,
      digest: sha256(raw),
      raw,
    });
    if (lines.length > OUTCOME_LEDGER_REPAIR_MAX_LINES) {
      throw new Error("Outcome ledger contains too many physical lines.");
    }
    offset = end;
    lineNumber += 1;
  }
  return lines;
}

function repairPaths(stateRoot, taskId, operationId, sourceDigest) {
  const control = automationControlPaths(stateRoot);
  const artifactDirectory = path.join(
    control.stateRoot,
    "artifacts",
    "outcome-ledger-repair",
    taskId,
    sourceDigest,
    operationId,
  );
  const transactionDirectory = path.join(
    control.controlRoot,
    "outcome-ledger-transactions",
  );
  return {
    ...control,
    artifactDirectory,
    sourceArtifact: path.join(artifactDirectory, `source-${sourceDigest}.jsonl`),
    trustedArtifact: path.join(artifactDirectory, "trusted.jsonl"),
    rejectedArtifact: path.join(artifactDirectory, "rejected.jsonl"),
    decisionsArtifact: path.join(artifactDirectory, "decisions.json"),
    receiptArtifact: path.join(artifactDirectory, "receipt.json"),
    transactionDirectory,
    transaction: path.join(transactionDirectory, `${operationId}.json`),
  };
}

function requireNonnegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a nonnegative safe integer.`);
  }
  return value;
}

function validateRepairParameters(parameters, { stateRoot, taskId }) {
  if (
    !parameters ||
    typeof parameters !== "object" ||
    Array.isArray(parameters) ||
    stableJson(Object.keys(parameters).sort()) !==
      stableJson(OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS)
  ) {
    throw new Error("Outcome ledger repair parameters have an invalid shape.");
  }
  if (
    parameters.schemaVersion !== OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION ||
    parameters.policy !== OUTCOME_LEDGER_REPAIR_POLICY ||
    parameters.stateRoot !== stateRoot ||
    parameters.ledgerPath !== automationControlPaths(stateRoot).outcomes
  ) {
    throw new Error("Outcome ledger repair parameters have conflicting identity.");
  }
  for (const field of [
    "archiveDigest",
    "decisionsDigest",
    "eventHistoryDigest",
    "operationId",
    "receiptDigest",
    "replacementDigest",
    "sourceDigest",
  ]) {
    requireSha256(parameters[field], field);
  }
  for (const field of [
    "eventHistorySize",
    "rejectedCount",
    "replacementSize",
    "sourceLineCount",
    "sourceSize",
    "trustedCount",
  ]) {
    requireNonnegativeInteger(parameters[field], field);
  }
  if (
    parameters.archiveDigest !== parameters.sourceDigest ||
    parameters.sourceLineCount !==
      parameters.trustedCount + parameters.rejectedCount ||
    sha256(stableJson(outcomeLedgerRepairOperationSeed(taskId, parameters))) !==
      parameters.operationId
  ) {
    throw new Error("Outcome ledger repair parameter identities do not agree.");
  }
  return parameters;
}

function buildReceipt({ taskId, operationId, eventId, parameters, artifacts }) {
  const receiptCore = {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
    status: "complete",
    taskId,
    operationId,
    eventId,
    stateRoot: parameters.stateRoot,
    ledgerPath: parameters.ledgerPath,
    sourceArtifact: artifacts.sourceArtifact,
    trustedArtifact: artifacts.trustedArtifact,
    rejectedArtifact: artifacts.rejectedArtifact,
    decisionsArtifact: artifacts.decisionsArtifact,
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
  const receiptDigest = sha256(stableJson(receiptCore));
  return {
    receipt: { ...receiptCore, receiptDigest },
    receiptDigest,
  };
}

function writeImmutable(filePath, bytes, { beforePublish = () => {} } = {}) {
  requirePrivateDirectory(path.dirname(filePath), { create: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, bytes);
    fchmodSync(descriptor, 0o600);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    beforePublish();
    try {
      linkSync(temporaryPath, filePath);
      syncDirectory(path.dirname(filePath));
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = safeReadRegularFile(filePath, {
        maxBytes: Math.max(bytes.length, 1) + 1,
        exactMode: 0o600,
      }).bytes;
      if (!existing.equals(bytes)) {
        throw new Error(`Conflicting immutable repair artifact: ${filePath}`);
      }
      syncDirectory(path.dirname(filePath));
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

function writeJsonAtomic(filePath, value, { beforeRename = () => {} } = {}) {
  requirePrivateDirectory(path.dirname(filePath), { create: true });
  if (existsAsPath(filePath)) {
    safeReadRegularFile(filePath, { exactMode: 0o600 });
  }
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, bytes);
    fchmodSync(descriptor, 0o600);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    beforeRename();
    renameSync(temporaryPath, filePath);
    syncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

function existsAsPath(filePath) {
  try {
    lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function readJsonArtifact(
  filePath,
  maxBytes = OUTCOME_LEDGER_REPAIR_MAX_BYTES,
) {
  const snapshot = safeReadRegularFile(filePath, {
    exactMode: 0o600,
    maxBytes,
  });
  try {
    return JSON.parse(decoder.decode(snapshot.bytes));
  } catch {
    throw new Error(`Repair artifact is not valid JSON: ${filePath}`);
  }
}

function requirePrivateDescendantDirectories(
  root,
  target,
  { create = false } = {},
) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Outcome ledger repair directory escapes the state root.");
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    requirePrivateDirectory(current, { create });
  }
}

function canonicalStateRoot(stateRoot) {
  const resolved = automationControlPaths(stateRoot).stateRoot;
  if (realpathSync(resolved) !== resolved) {
    throw new Error("Outcome ledger repair requires a canonical state root.");
  }
  requirePrivateDirectory(resolved);
  requirePrivateDirectory(path.join(resolved, "control"));
  return resolved;
}

function requireExistingTaskSnapshot(stateRoot, taskId) {
  const taskManifestPath = automationControlPaths(stateRoot).taskManifest;
  const snapshot = safeReadRegularFile(taskManifestPath, {
    exactMode: 0o600,
    maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  });
  let manifest;
  try {
    manifest = JSON.parse(decoder.decode(snapshot.bytes));
  } catch {
    throw new Error("Outcome ledger repair requires a valid task manifest.");
  }
  if (
    manifest?.schemaVersion !== 1 ||
    !Array.isArray(manifest.tasks) ||
    manifest.tasks.some(
      (task) =>
        !task ||
        typeof task !== "object" ||
        typeof task.taskId !== "string" ||
        !Number.isSafeInteger(task.revision),
    )
  ) {
    throw new Error("Outcome ledger repair requires a valid task manifest.");
  }
  const matches = manifest.tasks.filter((task) => task.taskId === taskId);
  if (matches.length !== 1) {
    throw new Error(`Outcome ledger repair task ${taskId} does not exist.`);
  }
  const task = matches[0];
  return {
    taskId: task.taskId,
    state: task.state,
    revision: task.revision,
  };
}

function classifyCurrentLedger({
  stateRoot,
  taskId,
  expectedSourceDigest,
  eventHistoryPrefixDigest = undefined,
  eventHistoryPrefixSize = undefined,
  allowedPendingOperationId = null,
  sourceBytes = undefined,
}) {
  const root = canonicalStateRoot(stateRoot);
  const paths = automationControlPaths(root);
  const task = requireExistingTaskSnapshot(root, taskId);
  const source =
    sourceBytes === undefined
      ? safeReadRegularFile(paths.outcomes, {
          allowReadonlyGroupWorld: true,
        })
      : {
          bytes: Buffer.from(sourceBytes),
          digest: sha256(sourceBytes),
          size: sourceBytes.length,
        };
  if (source.digest !== expectedSourceDigest) {
    throw new Error(
      `Outcome ledger source digest changed: expected ${expectedSourceDigest}, found ${source.digest}.`,
    );
  }
  const events = safeReadRegularFile(paths.events, {
    exactMode: 0o600,
    maxBytes: OUTCOME_CONTROL_EVENT_MAX_BYTES,
  });
  const boundEventHistorySize =
    eventHistoryPrefixSize === undefined
      ? events.size
      : requireNonnegativeInteger(
          eventHistoryPrefixSize,
          "eventHistoryPrefixSize",
        );
  if (boundEventHistorySize > events.size) {
    throw new Error("Control event history is shorter than the approved prefix.");
  }
  const boundEventHistoryDigest = sha256(
    events.bytes.subarray(0, boundEventHistorySize),
  );
  if (
    eventHistoryPrefixDigest !== undefined &&
    boundEventHistoryDigest !== eventHistoryPrefixDigest
  ) {
    throw new Error("Control event history prefix drifted before repair.");
  }
  const lines = physicalJsonLines(source.bytes);
  const ledgerText = decoder.decode(source.bytes);
  const eventHistoryText = decoder.decode(events.bytes);
  const summary = summarizeOutcomeLedger(paths.outcomes, {
    stateRoot: root,
    ledgerText,
    eventHistoryText,
    allowedPendingRepairOperationId: allowedPendingOperationId,
  });
  const unexpectedPendingRepairs =
    summary.sourceHealth.pendingOutcomeLedgerRepairs.filter(
      (repair) => repair.operationId !== allowedPendingOperationId,
    );
  if (
    !summary.sourceHealth.ledgerSyntaxHealthy ||
    !summary.sourceHealth.controlEventsHealthy ||
    !summary.sourceHealth.outcomeLedgerTransactionsHealthy ||
    unexpectedPendingRepairs.length > 0 ||
    (allowedPendingOperationId === null &&
      summary.sourceHealth.pendingOutcomeLedgerRepairs.length > 0)
  ) {
    throw new Error(
      "Outcome ledger repair requires healthy ledger, control event, and repair transaction sources.",
    );
  }
  if (summary.lineDecisions.length !== lines.length) {
    throw new Error("Outcome ledger line classification lost physical identity.");
  }
  const decisions = summary.lineDecisions.map((decision, index) => {
    const line = lines[index];
    if (decision.lineNumber !== line.lineNumber) {
      throw new Error("Outcome ledger line classification changed occurrence order.");
    }
    return {
      lineNumber: line.lineNumber,
      offset: line.offset,
      length: line.length,
      rawDigest: line.digest,
      disposition: decision.disposition,
      reason: decision.reason,
    };
  });
  const trustedLines = lines.filter(
    (_line, index) => decisions[index].disposition === "trusted",
  );
  const rejectedLines = lines.filter(
    (_line, index) => decisions[index].disposition === "rejected",
  );
  const trustedBytes = Buffer.concat(trustedLines.map((line) => line.raw));
  const rejectedBytes = Buffer.concat(rejectedLines.map((line) => line.raw));
  const decisionManifest = {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
    taskId,
    sourceDigest: source.digest,
    sourceSize: source.size,
    sourceLineCount: lines.length,
    eventHistoryDigest: boundEventHistoryDigest,
    eventHistorySize: boundEventHistorySize,
    trustedCount: trustedLines.length,
    rejectedCount: rejectedLines.length,
    replacementDigest: sha256(trustedBytes),
    replacementSize: trustedBytes.length,
    lines: decisions,
  };
  const decisionBytes = Buffer.from(
    `${JSON.stringify(decisionManifest, null, 2)}\n`,
    "utf8",
  );
  const decisionsDigest = sha256(decisionBytes);
  const operationSeed = outcomeLedgerRepairOperationSeed(taskId, {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
    stateRoot: root,
    ledgerPath: paths.outcomes,
    sourceDigest: source.digest,
    sourceSize: source.size,
    sourceLineCount: lines.length,
    eventHistoryDigest: boundEventHistoryDigest,
    eventHistorySize: boundEventHistorySize,
    trustedCount: trustedLines.length,
    rejectedCount: rejectedLines.length,
    replacementDigest: sha256(trustedBytes),
    replacementSize: trustedBytes.length,
    decisionsDigest,
  });
  const operationId = sha256(stableJson(operationSeed));
  const artifacts = repairPaths(root, taskId, operationId, source.digest);
  const eventId = outcomeLedgerRepairEventId(operationId);
  const parameterBase = {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
    stateRoot: root,
    ledgerPath: paths.outcomes,
    operationId,
    sourceDigest: source.digest,
    sourceSize: source.size,
    sourceLineCount: lines.length,
    eventHistoryDigest: boundEventHistoryDigest,
    eventHistorySize: boundEventHistorySize,
    trustedCount: trustedLines.length,
    rejectedCount: rejectedLines.length,
    replacementDigest: sha256(trustedBytes),
    replacementSize: trustedBytes.length,
    archiveDigest: source.digest,
    decisionsDigest,
  };
  const { receipt, receiptDigest } = buildReceipt({
    taskId,
    operationId,
    eventId,
    parameters: { ...parameterBase, receiptDigest: "" },
    artifacts,
  });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const parameters = validateRepairParameters(
    { ...parameterBase, receiptDigest },
    { stateRoot: root, taskId },
  );
  const intent = {
    schemaVersion: 1,
    action: OUTCOME_LEDGER_REPAIR_ACTION,
    taskId,
    parameters,
  };
  return {
    taskId,
    task,
    operationId,
    eventId,
    parameters,
    intent,
    intentDigest: ownerGovernanceIntentDigest(intent),
    artifacts,
    receipt,
    summary,
    material: {
      sourceBytes: source.bytes,
      trustedBytes,
      rejectedBytes,
      decisionBytes,
      receiptBytes,
    },
  };
}

function publicPlan(plan) {
  return {
    taskId: plan.taskId,
    task: plan.task,
    operationId: plan.operationId,
    eventId: plan.eventId,
    parameters: plan.parameters,
    intent: plan.intent,
    intentDigest: plan.intentDigest,
    artifacts: plan.artifacts,
    receipt: plan.receipt,
  };
}

export function planOutcomeLedgerRepair({
  stateRoot,
  taskId,
  expectedSourceDigest,
}) {
  return publicPlan(
    classifyCurrentLedger({
      stateRoot,
      taskId: requireTaskId(taskId),
      expectedSourceDigest: requireSha256(
        expectedSourceDigest,
        "expectedSourceDigest",
      ),
    }),
  );
}

function writeReplacementAtomic(
  ledgerPath,
  operationId,
  bytes,
  checkpoint,
  beforeRename,
) {
  const temporaryPath = `${ledgerPath}.${operationId}.${process.pid}.repair.tmp`;
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, bytes);
    fchmodSync(descriptor, 0o600);
    fsyncSync(descriptor);
    checkpoint("replacement-synced");
    closeSync(descriptor);
    descriptor = undefined;
    beforeRename();
    renameSync(temporaryPath, ledgerPath);
    checkpoint("replacement-renamed");
    syncDirectory(path.dirname(ledgerPath));
    checkpoint("replacement-directory-synced");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

function transactionRecord(plan, phase) {
  return {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
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

function writePreparedArtifacts(plan, checkpoint) {
  requirePrivateDescendantDirectories(
    plan.artifacts.stateRoot,
    plan.artifacts.artifactDirectory,
    { create: true },
  );
  requirePrivateDescendantDirectories(
    plan.artifacts.stateRoot,
    plan.artifacts.transactionDirectory,
    { create: true },
  );
  writeImmutable(plan.artifacts.sourceArtifact, plan.material.sourceBytes);
  checkpoint("source-archived");
  writeImmutable(plan.artifacts.trustedArtifact, plan.material.trustedBytes);
  checkpoint("trusted-archived");
  writeImmutable(plan.artifacts.rejectedArtifact, plan.material.rejectedBytes);
  checkpoint("rejected-archived");
  writeImmutable(plan.artifacts.decisionsArtifact, plan.material.decisionBytes);
  checkpoint("decisions-archived");
  writeJsonAtomic(plan.artifacts.transaction, transactionRecord(plan, "prepared"));
  checkpoint("transaction-prepared");
}

function exactParametersEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

function exactClassifiedMaterialEqual(left, right) {
  return ["sourceBytes", "trustedBytes", "rejectedBytes", "decisionBytes"].every(
    (field) => left[field].equals(right[field]),
  );
}

function validateArchivedMaterial(record, paths) {
  const parameters = record.parameters;
  const sourceBytes = safeReadRegularFile(paths.sourceArtifact, {
    exactMode: 0o600,
  }).bytes;
  const trustedBytes = safeReadRegularFile(paths.trustedArtifact, {
    exactMode: 0o600,
  }).bytes;
  const rejectedBytes = safeReadRegularFile(paths.rejectedArtifact, {
    exactMode: 0o600,
  }).bytes;
  const decisionBytes = safeReadRegularFile(paths.decisionsArtifact, {
    exactMode: 0o600,
    maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES * 8,
  }).bytes;
  if (
    sourceBytes.length !== parameters.sourceSize ||
    sha256(sourceBytes) !== parameters.sourceDigest ||
    trustedBytes.length !== parameters.replacementSize ||
    sha256(trustedBytes) !== parameters.replacementDigest ||
    sha256(decisionBytes) !== parameters.decisionsDigest
  ) {
    throw new Error("Outcome ledger repair artifacts do not match their digests.");
  }
  let manifest;
  try {
    manifest = JSON.parse(decoder.decode(decisionBytes));
  } catch {
    throw new Error("Outcome ledger repair decisions are not valid JSON.");
  }
  const manifestHeader = {
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
  const { lines: decisions, ...actualHeader } = manifest ?? {};
  if (
    stableJson(actualHeader) !== stableJson(manifestHeader) ||
    !Array.isArray(decisions)
  ) {
    throw new Error("Outcome ledger repair decision identity changed.");
  }
  const sourceLines = physicalJsonLines(sourceBytes);
  if (
    sourceLines.length !== parameters.sourceLineCount ||
    decisions.length !== sourceLines.length
  ) {
    throw new Error("Outcome ledger repair decisions lost source occurrences.");
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
      decision?.rawDigest !== line.digest ||
      !["trusted", "rejected"].includes(decision?.disposition) ||
      typeof decision?.reason !== "string" ||
      decision.reason.length === 0
    ) {
      throw new Error("Outcome ledger repair decision occurrence changed.");
    }
    if (decision.disposition === "trusted") {
      trustedCount += 1;
      trustedParts.push(line.raw);
    } else {
      rejectedCount += 1;
      rejectedParts.push(line.raw);
    }
  }
  const reconstructedTrusted = Buffer.concat(trustedParts);
  const reconstructedRejected = Buffer.concat(rejectedParts);
  if (
    trustedCount !== parameters.trustedCount ||
    rejectedCount !== parameters.rejectedCount ||
    !trustedBytes.equals(reconstructedTrusted) ||
    !rejectedBytes.equals(reconstructedRejected)
  ) {
    throw new Error("Outcome ledger repair archived bytes changed.");
  }
  return { sourceBytes, trustedBytes, rejectedBytes, decisionBytes };
}

function findTransaction(stateRoot, taskId, sourceDigest) {
  const directory = path.join(
    automationControlPaths(stateRoot).controlRoot,
    "outcome-ledger-transactions",
  );
  if (!existsAsPath(directory)) return null;
  requirePrivateDirectory(directory);
  const matches = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (
      new RegExp(
        `^\\.[0-9a-f]{64}\\.json\\.\\d+\\.tmp${QUARANTINE_SUFFIX_PATTERN}$`,
      ).test(entry.name)
    ) {
      safeReadRegularFile(filePath, {
        exactMode: 0o600,
        maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES * 8,
      });
      continue;
    }
    if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/.test(entry.name)) {
      throw new Error(
        `Unexpected outcome ledger transaction entry: ${entry.name}`,
      );
    }
    const record = readJsonArtifact(filePath);
    if (
      record?.schemaVersion !== OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION ||
      record?.policy !== OUTCOME_LEDGER_REPAIR_POLICY ||
      !TRANSACTION_PHASES.has(record?.phase) ||
      typeof record?.taskId !== "string" ||
      record?.operationId !== path.basename(entry.name, ".json") ||
      stableJson(Object.keys(record).sort()) !==
        stableJson(OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS)
    ) {
      throw new Error(
        `Invalid outcome ledger transaction identity: ${entry.name}`,
      );
    }
    validateRepairParameters(record.parameters, {
      stateRoot,
      taskId: record.taskId,
    });
    if (
      record?.taskId === taskId &&
      record?.parameters?.sourceDigest === sourceDigest
    ) {
      matches.push({ filePath, record });
    } else if (record.phase !== "complete") {
      throw new Error(
        `Another outcome ledger repair remains pending: ${entry.name}`,
      );
    }
  }
  if (matches.length > 1) {
    throw new Error("Multiple outcome ledger repair transactions claim one source.");
  }
  return matches[0] ?? null;
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeOwnedRepairTemps(directory, candidates, maxBytes) {
  if (!existsAsPath(directory)) return;
  requirePrivateDirectory(directory);
  let changed = false;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = candidates.find(({ pattern }) => pattern.test(entry.name));
    if (!candidate) continue;
    const filePath = path.join(directory, entry.name);
    const snapshot = safeReadRegularFile(filePath, {
      exactMode: 0o600,
      maxBytes,
    });
    const expectedOptions = candidate.expectedBytes.map((bytes) =>
      Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    );
    if (
      !expectedOptions.some(
        (expected) =>
          snapshot.bytes.length <= expected.length &&
          expected.subarray(0, snapshot.bytes.length).equals(snapshot.bytes),
      )
    ) {
      throw new Error(`Outcome ledger repair temp has foreign bytes: ${filePath}`);
    }
    const quarantinePath = `${filePath}.quarantine.${randomUUID()}`;
    renameSync(filePath, quarantinePath);
    const quarantined = safeReadRegularFile(quarantinePath, {
      exactMode: 0o600,
      maxBytes,
    });
    if (
      quarantined.device !== snapshot.device ||
      quarantined.inode !== snapshot.inode ||
      !quarantined.bytes.equals(snapshot.bytes)
    ) {
      throw new Error(
        `Outcome ledger repair temp changed during quarantine: ${filePath}`,
      );
    }
    rmSync(quarantinePath);
    changed = true;
  }
  if (changed) syncDirectory(directory);
}

function cleanupRepairTemporaryFiles(plan) {
  const { artifacts: paths } = plan;
  const transactionTempPattern = new RegExp(
    `^\\.${escapeRegularExpression(path.basename(paths.transaction))}\\.\\d+\\.tmp${QUARANTINE_SUFFIX_PATTERN}$`,
  );
  const transactionBytes = [...TRANSACTION_PHASES].map((phase) =>
    Buffer.from(
      `${JSON.stringify(transactionRecord(plan, phase), null, 2)}\n`,
      "utf8",
    ),
  );
  removeOwnedRepairTemps(
    paths.transactionDirectory,
    [
      { pattern: transactionTempPattern, expectedBytes: transactionBytes },
    ],
    OUTCOME_LEDGER_REPAIR_MAX_BYTES * 8,
  );
  const artifactCandidates = [
    [paths.sourceArtifact, plan.material.sourceBytes],
    [paths.trustedArtifact, plan.material.trustedBytes],
    [paths.rejectedArtifact, plan.material.rejectedBytes],
    [paths.decisionsArtifact, plan.material.decisionBytes],
    [paths.receiptArtifact, plan.material.receiptBytes],
  ].map(([filePath, expectedBytes]) => ({
    pattern: new RegExp(
      `^\\.${escapeRegularExpression(path.basename(filePath))}\\.\\d+\\.tmp${QUARANTINE_SUFFIX_PATTERN}$`,
    ),
    expectedBytes: [expectedBytes],
  }));
  removeOwnedRepairTemps(
    paths.artifactDirectory,
    artifactCandidates,
    OUTCOME_LEDGER_REPAIR_MAX_BYTES * 8,
  );
  removeOwnedRepairTemps(
    paths.stateRoot,
    [
      {
        pattern: new RegExp(
          `^${escapeRegularExpression(path.basename(paths.outcomes))}\\.${escapeRegularExpression(plan.operationId)}\\.\\d+\\.repair\\.tmp${QUARANTINE_SUFFIX_PATTERN}$`,
        ),
        expectedBytes: [plan.material.trustedBytes],
      },
    ],
    OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  );
}

function recoverPlanFromTransaction({ stateRoot, taskId, sourceDigest }) {
  const match = findTransaction(stateRoot, taskId, sourceDigest);
  if (!match) return null;
  const { filePath, record } = match;
  const parameters = validateRepairParameters(record.parameters, {
    stateRoot,
    taskId,
  });
  const expectedPaths = repairPaths(
    stateRoot,
    taskId,
    record.operationId,
    sourceDigest,
  );
  requirePrivateDescendantDirectories(
    expectedPaths.stateRoot,
    expectedPaths.artifactDirectory,
  );
  requirePrivateDescendantDirectories(
    expectedPaths.stateRoot,
    expectedPaths.transactionDirectory,
  );
  if (
    record.schemaVersion !== OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION ||
    record.policy !== OUTCOME_LEDGER_REPAIR_POLICY ||
    !TRANSACTION_PHASES.has(record.phase) ||
    stableJson(Object.keys(record).sort()) !==
      stableJson(OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS) ||
    record.operationId !== parameters.operationId ||
    record.eventId !== outcomeLedgerRepairEventId(parameters.operationId) ||
    filePath !== expectedPaths.transaction ||
    record.artifacts?.source !== expectedPaths.sourceArtifact ||
    record.artifacts?.trusted !== expectedPaths.trustedArtifact ||
    record.artifacts?.rejected !== expectedPaths.rejectedArtifact ||
    record.artifacts?.decisions !== expectedPaths.decisionsArtifact ||
    record.artifacts?.receipt !== expectedPaths.receiptArtifact
  ) {
    throw new Error("Outcome ledger repair transaction has conflicting identity.");
  }
  const material = validateArchivedMaterial(record, expectedPaths);
  const expectedReceipt = buildReceipt({
    taskId,
    operationId: record.operationId,
    eventId: record.eventId,
    parameters,
    artifacts: expectedPaths,
  });
  if (
    expectedReceipt.receiptDigest !== parameters.receiptDigest ||
    stableJson(record.receipt) !== stableJson(expectedReceipt.receipt)
  ) {
    throw new Error("Outcome ledger repair receipt conflicts with the transaction.");
  }
  const receiptBytes = Buffer.from(
    `${JSON.stringify(expectedReceipt.receipt, null, 2)}\n`,
    "utf8",
  );
  if (existsAsPath(expectedPaths.receiptArtifact)) {
    const existingReceipt = safeReadRegularFile(expectedPaths.receiptArtifact, {
      exactMode: 0o600,
    }).bytes;
    if (!existingReceipt.equals(receiptBytes)) {
      throw new Error("Outcome ledger repair receipt bytes changed.");
    }
  } else if (record.phase === "complete") {
    throw new Error("Completed outcome ledger repair is missing its receipt.");
  }
  const intent = {
    schemaVersion: 1,
    action: OUTCOME_LEDGER_REPAIR_ACTION,
    taskId,
    parameters,
  };
  if (ownerGovernanceIntentDigest(intent) !== record.intentDigest) {
    throw new Error("Outcome ledger repair transaction intent digest changed.");
  }
  return {
    taskId,
    operationId: record.operationId,
    eventId: record.eventId,
    parameters,
    intent,
    intentDigest: record.intentDigest,
    artifacts: expectedPaths,
    receipt: expectedReceipt.receipt,
    summary: null,
    material: { ...material, receiptBytes },
    transaction: record,
  };
}

function verifyCompletedRepair(plan, { requireComplete = true } = {}) {
  const current = safeReadRegularFile(plan.artifacts.outcomes, {
    exactMode: 0o600,
  });
  if (
    plan.material.trustedBytes.length > 0 &&
    !current.bytes.subarray(0, plan.material.trustedBytes.length).equals(
      plan.material.trustedBytes,
    )
  ) {
    throw new Error("Canonical outcomes no longer preserve retained trusted lines.");
  }
  const events = safeReadRegularFile(plan.artifacts.events, {
    exactMode: 0o600,
    maxBytes: OUTCOME_CONTROL_EVENT_MAX_BYTES,
  });
  if (
    events.size < plan.parameters.eventHistorySize ||
    sha256(events.bytes.subarray(0, plan.parameters.eventHistorySize)) !==
      plan.parameters.eventHistoryDigest
  ) {
    throw new Error("Completed outcome ledger repair event prefix drifted.");
  }
  const repairEvents = decoder
    .decode(events.bytes)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((event) => event?.eventId === plan.eventId);
  if (repairEvents.length !== 1) {
    throw new Error(
      "Completed outcome ledger repair requires exactly one audit event.",
    );
  }
  validateOutcomeLedgerRepairEvent(repairEvents[0], {
    stateRoot: plan.parameters.stateRoot,
    taskId: plan.taskId,
    parameters: plan.parameters,
    intentDigest: plan.intentDigest,
  });
  const summary = summarizeOutcomeLedger(plan.artifacts.outcomes, {
    stateRoot: plan.parameters.stateRoot,
    ledgerText: decoder.decode(current.bytes),
    eventHistoryText: decoder.decode(events.bytes),
    allowedPendingRepairOperationId: requireComplete
      ? null
      : plan.operationId,
  });
  const pendingRepairs = summary.sourceHealth.pendingOutcomeLedgerRepairs;
  const pendingStateValid = requireComplete
    ? pendingRepairs.length === 0
    : pendingRepairs.length === 1 &&
      pendingRepairs[0].operationId === plan.operationId &&
      pendingRepairs[0].phase === "audited";
  if (
    !summary.sourceHealth.ledgerSyntaxHealthy ||
    !summary.sourceHealth.controlEventsHealthy ||
    !summary.sourceHealth.outcomeLedgerTransactionsHealthy ||
    !pendingStateValid ||
    (requireComplete && !summary.sourceHealth.ledgerHealthy) ||
    summary.rejectedEntries.length !== 0 ||
    summary.entries.length < plan.parameters.trustedCount
  ) {
    throw new Error("Completed outcome ledger repair no longer validates.");
  }
  return summary;
}

function ownerLeaseEventPrefixes(stateRoot, taskId) {
  const eventsPath = automationControlPaths(stateRoot).events;
  const snapshot = safeReadRegularFile(eventsPath, {
    exactMode: 0o600,
    maxBytes: OUTCOME_CONTROL_EVENT_MAX_BYTES,
  });
  const candidates = [];
  let offset = 0;
  while (offset < snapshot.bytes.length) {
    const newline = snapshot.bytes.indexOf(0x0a, offset);
    const end = newline === -1 ? snapshot.bytes.length : newline + 1;
    const raw = snapshot.bytes.subarray(offset, end);
    let contentEnd = raw.length;
    if (contentEnd > 0 && raw[contentEnd - 1] === 0x0a) contentEnd -= 1;
    if (contentEnd > 0 && raw[contentEnd - 1] === 0x0d) contentEnd -= 1;
    const text = decoder.decode(raw.subarray(0, contentEnd));
    if (!text.trim()) {
      throw new Error("Control event history contains a blank physical line.");
    }
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      throw new Error("Control event history contains malformed JSON.");
    }
    const eventTaskId =
      event?.data?.ownerCapabilityTaskId ??
      event?.data?.ownerConfirmationTaskId;
    const intentDigest =
      event?.data?.ownerCapabilityIntentDigest ??
      event?.data?.ownerConfirmationIntentDigest;
    if (
      ["lease_acquired", "lease_taken_over"].includes(event?.type) &&
      event?.actor === "freed-owner" &&
      event?.leaseName === "owner-governance" &&
      eventTaskId === taskId &&
      typeof intentDigest === "string" &&
      SHA256_PATTERN.test(intentDigest)
    ) {
      candidates.push({
        size: offset,
        digest: sha256(snapshot.bytes.subarray(0, offset)),
        intentDigest,
      });
      if (offset > 0 && snapshot.bytes[offset - 1] === 0x0a) {
        candidates.push({
          size: offset - 1,
          digest: sha256(snapshot.bytes.subarray(0, offset - 1)),
          intentDigest,
        });
      }
    }
    offset = end;
  }
  return candidates
    .filter(
      (candidate, index, values) =>
        values.findIndex(
          (value) =>
            value.size === candidate.size &&
            value.intentDigest === candidate.intentDigest,
        ) === index,
    )
    .reverse();
}

function authorizeNewRepairPlan({
  stateRoot,
  taskId,
  sourceDigest,
  actor,
  leaseName,
  leaseToken,
}) {
  const authorize = (plan) => {
    const authorization = preauthorizeOutcomeLedgerRepair({
      stateRoot,
      actor,
      leaseName,
      leaseToken,
      taskId,
      parameters: plan.parameters,
    });
    return { plan, authorization };
  };
  const currentPlan = classifyCurrentLedger({
    stateRoot,
    taskId,
    expectedSourceDigest: sourceDigest,
  });
  try {
    return authorize(currentPlan);
  } catch (error) {
    if (error?.code !== "owner_capability_intent_mismatch") throw error;
    const originalError = error;
    for (const prefix of ownerLeaseEventPrefixes(stateRoot, taskId)) {
      const candidate = classifyCurrentLedger({
        stateRoot,
        taskId,
        expectedSourceDigest: sourceDigest,
        eventHistoryPrefixDigest: prefix.digest,
        eventHistoryPrefixSize: prefix.size,
      });
      if (candidate.intentDigest !== prefix.intentDigest) continue;
      try {
        return authorize(candidate);
      } catch (candidateError) {
        if (candidateError?.code !== "owner_capability_intent_mismatch") {
          throw candidateError;
        }
      }
    }
    throw originalError;
  }
}

export function repairOutcomeLedger(
  {
    stateRoot,
    taskId,
    expectedSourceDigest,
    actor,
    leaseName,
    leaseToken,
  },
  { checkpoint = () => {} } = {},
) {
  const root = canonicalStateRoot(stateRoot);
  const normalizedTaskId = requireTaskId(taskId);
  const sourceDigest = requireSha256(
    expectedSourceDigest,
    "expectedSourceDigest",
  );
  const existingPlan = findTransaction(root, normalizedTaskId, sourceDigest)
    ? recoverPlanFromTransaction({
        stateRoot: root,
        taskId: normalizedTaskId,
        sourceDigest,
      })
    : null;
  let plan;
  if (existingPlan) {
    plan = existingPlan;
    preauthorizeOutcomeLedgerRepair({
      stateRoot: root,
      actor,
      leaseName,
      leaseToken,
      taskId: normalizedTaskId,
      parameters: plan.parameters,
    });
  } else {
    plan = authorizeNewRepairPlan({
      stateRoot: root,
      taskId: normalizedTaskId,
      sourceDigest,
      actor,
      leaseName,
      leaseToken,
    }).plan;
  }
  return withMutationLeaseAuthority(
    {
      stateRoot: root,
      actor,
      leaseName,
      leaseToken,
      taskId: normalizedTaskId,
      ownerIntentDigest: plan.intentDigest,
    },
    (authorityContext) => {
      checkpoint("owner-preauthorized");
      return withOutcomeLedgerWriterLock(plan.artifacts.outcomes, () => {
    const lockedTransaction = findTransaction(
      root,
      normalizedTaskId,
      sourceDigest,
    );
    let transaction = lockedTransaction?.record ?? null;
    if (transaction) {
      const recoveredPlan = recoverPlanFromTransaction({
        stateRoot: root,
        taskId: normalizedTaskId,
        sourceDigest,
      });
      if (
        !recoveredPlan ||
        !exactParametersEqual(recoveredPlan.parameters, plan.parameters)
      ) {
        throw new Error("Outcome ledger repair transaction drifted before repair.");
      }
      plan = recoveredPlan;
      transaction = recoveredPlan.transaction;
      if (transaction.phase === "complete") {
        reauthorizeOutcomeLedgerRepairLease({
          stateRoot: root,
          authorityContext,
          actor,
          leaseName,
          leaseToken,
          taskId: normalizedTaskId,
          parameters: plan.parameters,
        });
        verifyCompletedRepair(plan);
        return {
          changed: false,
          receipt: plan.receipt,
          intentDigest: plan.intentDigest,
        };
      }
    } else {
      const lockedPlan = classifyCurrentLedger({
        stateRoot: root,
        taskId: normalizedTaskId,
        expectedSourceDigest: sourceDigest,
        eventHistoryPrefixDigest: plan.parameters.eventHistoryDigest,
        eventHistoryPrefixSize: plan.parameters.eventHistorySize,
      });
      if (!exactParametersEqual(lockedPlan.parameters, plan.parameters)) {
        throw new Error("Outcome ledger classification drifted before repair.");
      }
      plan = lockedPlan;
      preauthorizeOutcomeLedgerRepair({
        stateRoot: root,
        authorityContext,
        actor,
        leaseName,
        leaseToken,
        taskId: normalizedTaskId,
        parameters: plan.parameters,
      });
      preflightOutcomeLedgerRepairEvent({
        stateRoot: root,
        authorityContext,
        actor,
        leaseName,
        leaseToken,
        taskId: normalizedTaskId,
        parameters: plan.parameters,
      });
      cleanupRepairTemporaryFiles(plan);
      preauthorizeOutcomeLedgerRepair({
        stateRoot: root,
        authorityContext,
        actor,
        leaseName,
        leaseToken,
        taskId: normalizedTaskId,
        parameters: plan.parameters,
      });
      writePreparedArtifacts(plan, checkpoint);
      const recoveredPlan = recoverPlanFromTransaction({
        stateRoot: root,
        taskId: normalizedTaskId,
        sourceDigest,
      });
      if (!recoveredPlan) {
        throw new Error("Prepared outcome ledger repair transaction is missing.");
      }
      plan = recoveredPlan;
      transaction = recoveredPlan.transaction;
    }

    validateArchivedMaterial(transaction, plan.artifacts);
    preauthorizeOutcomeLedgerRepair({
      stateRoot: root,
      authorityContext,
      actor,
      leaseName,
      leaseToken,
      taskId: normalizedTaskId,
      parameters: plan.parameters,
    });
    cleanupRepairTemporaryFiles(plan);

    const current = safeReadRegularFile(plan.artifacts.outcomes, {
      allowReadonlyGroupWorld: true,
    });
    const hasSourceLedger = current.digest === plan.parameters.sourceDigest;
    const hasReplacementLedger =
      current.digest === plan.parameters.replacementDigest;
    if (!hasSourceLedger && !hasReplacementLedger) {
      throw new Error("Canonical outcome ledger differs from source and replacement.");
    }
    const repairAuthorityOptions = {
      stateRoot: root,
      actor,
      leaseName,
      leaseToken,
      taskId: normalizedTaskId,
      parameters: plan.parameters,
      authorityContext,
    };
    const reauthorizeRepair = () =>
      reauthorizeOutcomeLedgerRepairLease(repairAuthorityOptions);

    if (transaction.phase !== "complete") {
      preauthorizeOutcomeLedgerRepair({
        stateRoot: root,
        authorityContext,
        actor,
        leaseName,
        leaseToken,
        taskId: normalizedTaskId,
        parameters: plan.parameters,
      });
      withOutcomeLedgerRepairFinalizationGuard(
        {
          stateRoot: root,
          authorityContext,
          actor,
          leaseName,
          leaseToken,
          taskId: normalizedTaskId,
          parameters: plan.parameters,
          transactionPath: plan.artifacts.transaction,
        },
        ({ preflightRepairEvent, appendRepairEvent }) => {
          checkpoint("before-replacement-classification");
          const finalClassification = classifyCurrentLedger({
            stateRoot: root,
            taskId: normalizedTaskId,
            expectedSourceDigest: sourceDigest,
            eventHistoryPrefixDigest: plan.parameters.eventHistoryDigest,
            eventHistoryPrefixSize: plan.parameters.eventHistorySize,
            allowedPendingOperationId: plan.operationId,
            sourceBytes: plan.material.sourceBytes,
          });
          if (
            !exactParametersEqual(
              finalClassification.parameters,
              plan.parameters,
            ) ||
            !exactClassifiedMaterialEqual(
              finalClassification.material,
              plan.material,
            )
          ) {
            throw new Error(
              "Outcome ledger classification drifted before repair audit.",
            );
          }
          if (hasReplacementLedger && transaction.phase === "prepared") {
            transaction = transactionRecord(plan, "replaced");
            writeJsonAtomic(plan.artifacts.transaction, transaction, {
              beforeRename: reauthorizeRepair,
            });
            checkpoint("transaction-replaced");
          }
          preflightRepairEvent();
          reauthorizeRepair();
          if (hasSourceLedger) {
            writeReplacementAtomic(
              plan.artifacts.outcomes,
              plan.operationId,
              plan.material.trustedBytes,
              checkpoint,
              reauthorizeRepair,
            );
            transaction = transactionRecord(plan, "replaced");
            writeJsonAtomic(plan.artifacts.transaction, transaction, {
              beforeRename: reauthorizeRepair,
            });
            checkpoint("transaction-replaced");
          }
          if (!["audited", "complete"].includes(transaction.phase)) {
            appendRepairEvent();
            checkpoint("event-audited");
            transaction = transactionRecord(plan, "audited");
            writeJsonAtomic(plan.artifacts.transaction, transaction, {
              beforeRename: reauthorizeRepair,
            });
            checkpoint("transaction-audited");
          }
        },
      );
    }

    writeImmutable(plan.artifacts.receiptArtifact, plan.material.receiptBytes, {
      beforePublish: reauthorizeRepair,
    });
    checkpoint("receipt-written");
    verifyCompletedRepair(plan, { requireComplete: false });
    transaction = transactionRecord(plan, "complete");
    writeJsonAtomic(plan.artifacts.transaction, transaction, {
      beforeRename: reauthorizeRepair,
    });
    checkpoint("transaction-complete");
    verifyCompletedRepair(plan);
    reauthorizeRepair();
    return { changed: true, receipt: plan.receipt, intentDigest: plan.intentDigest };
      });
    },
  );
}
