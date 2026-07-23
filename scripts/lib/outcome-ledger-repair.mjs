import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  automationControlPaths,
  CONTROL_EVENT_HISTORY_MAX_BYTES,
  framePinnedLeaseArchiveHelperInvocation,
  ownerGovernanceIntentDigest,
  preflightOutcomeLedgerAuthorityStageForRepair,
  preauthorizeOutcomeLedgerRepair,
  preflightOutcomeLedgerRepairEvent,
  readAutomationPlanningAdmission,
  readPinnedLeaseArchiveHelperSource,
  reauthorizeOutcomeLedgerRepairLease,
  retireOutcomeLedgerAuthorityStageForRepair,
  validateOutcomeLedgerRepairEvent,
  withAutomationPlanningReadBundle,
  withMutationLeaseAuthority,
  withOutcomeLedgerRepairFenceCreationGuard,
  withOutcomeLedgerRepairFinalizationGuard,
  withOutcomeLedgerRepairRetirementGuard,
} from "./automation-control.mjs";
import {
  OUTCOME_LEDGER_REPAIR_ACTION,
  OUTCOME_LEDGER_REPAIR_DECISION_FORMAT,
  OUTCOME_LEDGER_REPAIR_EVENT_PLAN_KEYS,
  OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_GENERATION_KEYS,
  OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_PARENT_KEYS,
  OUTCOME_LEDGER_REPAIR_EVENT_TYPE,
  OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  OUTCOME_LEDGER_REPAIR_MAX_LINE_BYTES,
  OUTCOME_LEDGER_REPAIR_MAX_LINES,
  OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS,
  OUTCOME_LEDGER_REPAIR_PHASES,
  OUTCOME_LEDGER_REPAIR_POLICY,
  OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
  OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS,
  orderedOutcomeLedgerRepairEventPlan,
  orderedOutcomeLedgerRepairParameters,
  outcomeLedgerRepairDecisionReasonCode,
  outcomeLedgerRepairEventId,
  outcomeLedgerRepairOperationSeed,
  parseOutcomeLedgerRepairReplacementTemporaryName,
  validateOutcomeLedgerRepairArchivedMaterialBytes,
} from "./outcome-ledger-repair-contract.mjs";
import {
  summarizeOutcomeLedger,
  withOutcomeLedgerWriterLock,
} from "../nightly-self-improve.mjs";

const OUTCOME_REPAIR_MOVE_HELPER_SHA256 =
  "d23a65379acad43c7fb601d65fc150c29f1d214796121362f2a44c7e6c305a3e";
const OUTCOME_REPAIR_MOVE_PYTHON = "/usr/bin/python3";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CANONICAL_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const QUARANTINE_SUFFIX_PATTERN =
  "(?:\\.quarantine\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TRANSACTION_PHASES = new Set(OUTCOME_LEDGER_REPAIR_PHASES);
const TRANSACTION_TRANSITIONS = Object.freeze([
  Object.freeze(["fenced", "prepared"]),
  Object.freeze(["prepared", "replaced"]),
  Object.freeze(["replaced", "audited"]),
  Object.freeze(["audited", "complete"]),
]);
const REPAIR_DIRECTORY_MAX_ENTRIES = 4_096;
const REPAIR_DIRECTORY_MAX_ENCODED_BYTES = 16 * 1024 * 1024;
const REPAIR_ARTIFACT_DIRECTORY_MAX_ENTRIES = 256;
const REPAIR_INTENT_DIRECTORY_MAX_ENTRIES = 64;
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

function outcomeRepairDecisionHeader(taskId, parameters) {
  return {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
    format: OUTCOME_LEDGER_REPAIR_DECISION_FORMAT,
    taskId,
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
}

function outcomeRepairDecisionTuple(line, decision) {
  const disposition = decision.disposition === "trusted" ? 0 : 1;
  const reasonCode = outcomeLedgerRepairDecisionReasonCode(
    decision.disposition,
    decision.reason,
  );
  return [
    line.lineNumber,
    line.offset,
    line.length,
    line.digest,
    disposition,
    reasonCode,
  ];
}

function encodeOutcomeRepairDecisionManifest(taskId, parameters, lines, decisions) {
  if (lines.length !== decisions.length) {
    throw new Error("Outcome ledger repair decisions lost source occurrences.");
  }
  const manifest = {
    ...outcomeRepairDecisionHeader(taskId, parameters),
    lines: decisions.map((decision, index) =>
      outcomeRepairDecisionTuple(lines[index], decision),
    ),
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
  if (bytes.length > OUTCOME_LEDGER_REPAIR_MAX_BYTES) {
    throw new Error(
      "Outcome ledger repair decisions exceed the canonical per-file byte boundary.",
    );
  }
  return bytes;
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

function readBoundedDirectoryEntries(
  directoryPath,
  {
    maxEntries = REPAIR_DIRECTORY_MAX_ENTRIES,
    label = "Outcome ledger repair directory",
  } = {},
) {
  const directory = opendirSync(directoryPath);
  const entries = [];
  try {
    while (true) {
      const entry = directory.readSync();
      if (entry === null) return entries;
      if (entries.length >= maxEntries) {
        throw new Error(`${label} exceeds its entry boundary: ${directoryPath}`);
      }
      entries.push(entry);
    }
  } finally {
    directory.closeSync();
  }
}

function requirePrivateDirectory(
  directoryPath,
  { create = false, beforeMutation = () => {} } = {},
) {
  if (create && !existsAsPath(directoryPath)) {
    const parent = path.dirname(directoryPath);
    requirePrivateDirectory(parent);
    try {
      beforeMutation();
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
    const expectedLinkCount = 1;
    if (
      realpathSync(filePath) !== filePath ||
      !before.isFile() ||
      before.uid !== currentUid() ||
      before.nlink !== expectedLinkCount ||
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
      after.nlink !== expectedLinkCount ||
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
      pathStats.nlink !== expectedLinkCount ||
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

function immutableRepairTemporaryPath(filePath, bytes) {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${sha256(bytes)}.tmp`,
  );
}

function safeReadImmutableRepairArtifact(
  filePath,
  options = {},
) {
  return safeReadRegularFile(filePath, options);
}

function physicalJsonLines(bytes) {
  const lines = [];
  let offset = 0;
  let lineNumber = 1;
  while (offset < bytes.length) {
    const newline = bytes.indexOf(0x0a, offset);
    const end = newline === -1 ? bytes.length : newline + 1;
    const raw = bytes.subarray(offset, end);
    if (raw.length > OUTCOME_LEDGER_REPAIR_MAX_LINE_BYTES) {
      throw new Error(
        `Outcome ledger line ${lineNumber.toLocaleString()} exceeds the supported physical byte boundary.`,
      );
    }
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
    transaction: path.join(transactionDirectory, "pending.json"),
    completedTransaction: path.join(
      transactionDirectory,
      `${operationId}.json`,
    ),
  };
}

function repairTopologyDirectoryIdentity(directoryPath, label) {
  const stats = lstatSync(directoryPath);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid() ||
    (stats.mode & 0o7777) !== 0o700 ||
    realpathSync(directoryPath) !== directoryPath
  ) {
    throw new Error(`${label} is not one private canonical directory.`);
  }
  return {
    kind: "directory",
    path: directoryPath,
    device: String(stats.dev),
    inode: String(stats.ino),
    uid: stats.uid,
    mode: stats.mode & 0o7777,
  };
}

function repairTopologyFileIdentity(
  filePath,
  label,
  { maxBytes = OUTCOME_LEDGER_REPAIR_MAX_BYTES } = {},
) {
  const stats = lstatSync(filePath);
  const mode = stats.mode & 0o7777;
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUid() ||
    ![0o600, 0o640, 0o644].includes(mode) ||
    stats.nlink !== 1 ||
    stats.size < 0 ||
    stats.size > maxBytes ||
    realpathSync(filePath) !== filePath
  ) {
    throw new Error(`${label} is not one admitted repair file.`);
  }
  const pinned = openPinnedRepairFile(filePath, {
    expectedLinkCount: stats.nlink,
    exactMode: mode,
    maxBytes,
    label,
  });
  try {
    return {
      kind: "file",
      path: filePath,
      device: String(pinned.identity.device),
      inode: String(pinned.identity.inode),
      uid: pinned.identity.uid,
      mode: pinned.identity.mode,
      linkCount: pinned.identity.linkCount,
      size: pinned.bytes.length,
      digest: sha256(pinned.bytes),
    };
  } finally {
    closeSync(pinned.descriptor);
  }
}

function captureRepairDirectoryTree(
  directoryPath,
  { maxEntries, label },
) {
  if (!existsAsPath(directoryPath)) {
    return [{ kind: "missing", path: directoryPath }];
  }
  const records = [repairTopologyDirectoryIdentity(directoryPath, label)];
  const pending = [directoryPath];
  let entryCount = 0;
  while (pending.length > 0) {
    const current = pending.shift();
    const entries = readBoundedDirectoryEntries(current, {
      maxEntries,
      label,
    }).sort((left, right) => left.name.localeCompare(right.name));
    entryCount += entries.length;
    if (entryCount > maxEntries) {
      throw new Error(`${label} exceeds its complete topology boundary.`);
    }
    for (const entry of entries) {
      if (
        !entry.name ||
        entry.name === "." ||
        entry.name === ".." ||
        entry.name.includes(path.sep) ||
        entry.name.includes("\0")
      ) {
        throw new Error(`${label} contains an invalid entry name.`);
      }
      const filePath = path.join(current, entry.name);
      const stats = lstatSync(filePath);
      if (stats.isDirectory() && !stats.isSymbolicLink()) {
        records.push(repairTopologyDirectoryIdentity(filePath, label));
        pending.push(filePath);
      } else if (stats.isFile() && !stats.isSymbolicLink()) {
        records.push(repairTopologyFileIdentity(filePath, label));
      } else {
        throw new Error(`${label} contains an unsafe topology entry: ${filePath}`);
      }
    }
  }
  return records;
}

function repairTopologyAncestorRecords(stateRoot, targetPath) {
  const records = [];
  const relative = path.relative(stateRoot, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Outcome ledger repair topology escapes the state root.");
  }
  let current = stateRoot;
  records.push(
    repairTopologyDirectoryIdentity(
      current,
      "Outcome ledger repair topology ancestor",
    ),
  );
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!existsAsPath(current)) {
      records.push({ kind: "missing", path: current });
      break;
    }
    records.push(
      repairTopologyDirectoryIdentity(
        current,
        "Outcome ledger repair topology ancestor",
      ),
    );
  }
  return records;
}

function captureRepairTopology(plan) {
  const paths = plan.artifacts;
  const records = [];
  const ancestorTargets = [
    paths.controlRoot,
    paths.transactionDirectory,
    paths.artifactDirectory,
  ];
  for (const target of ancestorTargets) {
    records.push(...repairTopologyAncestorRecords(paths.stateRoot, target));
  }
  for (const [filePath, maxBytes] of [
    [paths.outcomes, OUTCOME_LEDGER_REPAIR_MAX_BYTES],
    [paths.events, CONTROL_EVENT_HISTORY_MAX_BYTES],
    [paths.taskManifest, OUTCOME_LEDGER_REPAIR_MAX_BYTES],
  ]) {
    records.push(
      existsAsPath(filePath)
        ? repairTopologyFileIdentity(
            filePath,
            "Outcome ledger repair authority topology",
            { maxBytes },
          )
        : { kind: "missing", path: filePath },
    );
  }
  records.push(
    ...captureRepairDirectoryTree(paths.transactionDirectory, {
      maxEntries: REPAIR_DIRECTORY_MAX_ENTRIES,
      label: "Outcome ledger repair transaction topology",
    }),
    ...captureRepairDirectoryTree(paths.artifactDirectory, {
      maxEntries: REPAIR_ARTIFACT_DIRECTORY_MAX_ENTRIES,
      label: "Outcome ledger repair artifact topology",
    }),
  );
  const replacementName = path.basename(ledgerReplacementTemporaryPath(plan));
  for (const entry of readBoundedDirectoryEntries(paths.stateRoot, {
    maxEntries: REPAIR_DIRECTORY_MAX_ENTRIES,
    label: "Outcome ledger repair state topology",
  })
    .filter(
      (entry) =>
        entry.name === replacementName ||
        entry.name.startsWith(`${replacementName}.quarantine.`),
    )
    .sort((left, right) => left.name.localeCompare(right.name))) {
    records.push(
      repairTopologyFileIdentity(
        path.join(paths.stateRoot, entry.name),
        "Outcome ledger repair replacement topology",
      ),
    );
  }
  return stableJson(
    records.sort((left, right) =>
      `${left.path}:${left.kind}`.localeCompare(`${right.path}:${right.kind}`),
    ),
  );
}

function invokeReadOnlyRepairCallback(plan, callback, ...arguments_) {
  const before = captureRepairTopology(plan);
  let result;
  try {
    result = callback(...arguments_);
    if (result && typeof result.then === "function") {
      throw new Error("Outcome ledger repair callbacks must be synchronous.");
    }
    return result;
  } finally {
    const after = captureRepairTopology(plan);
    if (after !== before) {
      throw new Error(
        "Outcome ledger repair topology changed during a read-only callback.",
      );
    }
  }
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
  return orderedOutcomeLedgerRepairParameters(parameters);
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

function repairFileIdentity(stats) {
  return {
    device: stats.dev,
    inode: stats.ino,
    uid: stats.uid,
    mode: stats.mode & 0o7777,
    linkCount: stats.nlink,
    size: stats.size,
  };
}

function repairFileIdentityMatches(stats, identity) {
  return (
    stats.dev === identity.device &&
    stats.ino === identity.inode &&
    stats.uid === identity.uid &&
    (stats.mode & 0o7777) === identity.mode &&
    stats.size === identity.size
  );
}

function readPinnedRepairBytes(descriptor, expectedSize) {
  const buffer = Buffer.alloc(expectedSize + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const count = readSync(
      descriptor,
      buffer,
      offset,
      buffer.length - offset,
      offset,
    );
    if (count === 0) break;
    offset += count;
  }
  if (offset !== expectedSize) {
    throw new Error("Outcome ledger repair file size changed while read.");
  }
  return buffer.subarray(0, offset);
}

function requirePinnedRepairFile(
  filePath,
  descriptor,
  identity,
  expectedBytes,
  {
    expectedLinkCount = 1,
    label = "Outcome ledger repair file",
  } = {},
) {
  const requireIdentity = () => {
    const opened = fstatSync(descriptor);
    const current = lstatSync(filePath);
    if (
      !opened.isFile() ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      !repairFileIdentityMatches(opened, identity) ||
      !repairFileIdentityMatches(current, identity) ||
      opened.nlink !== expectedLinkCount ||
      current.nlink !== expectedLinkCount ||
      realpathSync(filePath) !== filePath
    ) {
      throw new Error(`${label} generation changed: ${filePath}`);
    }
  };
  requireIdentity();
  const actualBytes = readPinnedRepairBytes(descriptor, expectedBytes.length);
  requireIdentity();
  if (!actualBytes.equals(expectedBytes)) {
    throw new Error(`${label} bytes changed: ${filePath}`);
  }
}

function openPinnedRepairFile(
  filePath,
  {
    expectedLinkCount = 1,
    exactMode = null,
    allowReadonlyGroupWorld = false,
    maxBytes = OUTCOME_LEDGER_REPAIR_MAX_BYTES,
    label = "Outcome ledger repair file",
  } = {},
) {
  const descriptor = openSync(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stats = fstatSync(descriptor);
    const mode = stats.mode & 0o7777;
    if (
      !stats.isFile() ||
      stats.uid !== currentUid() ||
      stats.nlink !== expectedLinkCount ||
      stats.size < 0 ||
      stats.size > maxBytes ||
      (exactMode !== null && mode !== exactMode) ||
      (exactMode === null &&
        allowReadonlyGroupWorld &&
        ![0o600, 0o640, 0o644].includes(mode)) ||
      (exactMode === null && !allowReadonlyGroupWorld && mode !== 0o600)
    ) {
      throw new Error(`Unsafe ${label.toLowerCase()}: ${filePath}`);
    }
    const identity = repairFileIdentity(stats);
    const bytes = readPinnedRepairBytes(descriptor, identity.size);
    requirePinnedRepairFile(filePath, descriptor, identity, bytes, {
      expectedLinkCount,
      label,
    });
    return {
      descriptor,
      identity,
      bytes,
      digest: sha256(bytes),
      size: bytes.length,
      device: identity.device,
      inode: identity.inode,
      mode: identity.mode,
    };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function repairDirectoryIdentity(stats) {
  return {
    device: stats.dev,
    inode: stats.ino,
    uid: stats.uid,
    mode: stats.mode & 0o7777,
  };
}

function requirePinnedRepairDirectory(directoryPath, pinned, label) {
  const opened = fstatSync(pinned.descriptor);
  const current = lstatSync(directoryPath);
  if (
    !opened.isDirectory() ||
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    opened.dev !== pinned.identity.device ||
    opened.ino !== pinned.identity.inode ||
    opened.uid !== pinned.identity.uid ||
    (opened.mode & 0o7777) !== pinned.identity.mode ||
    current.dev !== pinned.identity.device ||
    current.ino !== pinned.identity.inode ||
    current.uid !== pinned.identity.uid ||
    (current.mode & 0o7777) !== pinned.identity.mode ||
    realpathSync(directoryPath) !== directoryPath
  ) {
    throw new Error(`${label} generation changed: ${directoryPath}`);
  }
}

function openPinnedRepairDirectory(directoryPath, label) {
  requirePrivateDirectory(directoryPath);
  const descriptor = openSync(
    directoryPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const identity = repairDirectoryIdentity(fstatSync(descriptor));
    const pinned = { descriptor, identity };
    requirePinnedRepairDirectory(directoryPath, pinned, label);
    return pinned;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function listPinnedRepairDirectory(
  directoryPath,
  pinnedDirectory,
  {
    maxEntries = REPAIR_DIRECTORY_MAX_ENTRIES,
    label = "Outcome ledger repair directory",
  } = {},
) {
  requirePinnedRepairDirectory(directoryPath, pinnedDirectory, label);
  const helperSource = readPinnedLeaseArchiveHelperSource(undefined, {
    expectedDigest: OUTCOME_REPAIR_MOVE_HELPER_SHA256,
  });
  const pauseCheckpoint =
    process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_PAUSE ?? "";
  const useTestDescriptors =
    pauseCheckpoint !== "" &&
    process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_FDS === "3,4";
  const framed = framePinnedLeaseArchiveHelperInvocation(
    helperSource,
    "list-bounded",
    [
      String(maxEntries),
      String(REPAIR_DIRECTORY_MAX_ENCODED_BYTES),
      String(pinnedDirectory.identity.device),
      String(pinnedDirectory.identity.inode),
    ],
    { expectedDigest: OUTCOME_REPAIR_MOVE_HELPER_SHA256 },
  );
  const result = spawnSync(
    OUTCOME_REPAIR_MOVE_PYTHON,
    framed.argv,
    {
      env: {
        HOME: process.env.HOME ?? "",
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin",
        ...(useTestDescriptors
          ? {
              FREED_REPAIR_MOVE_TEST_PAUSE: pauseCheckpoint,
              FREED_REPAIR_MOVE_TEST_OPERATION:
                process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_OPERATION ?? "",
              FREED_REPAIR_MOVE_TEST_SOURCE:
                process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_SOURCE ?? "",
              FREED_REPAIR_MOVE_TEST_DESTINATION:
                process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_DESTINATION ?? "",
            }
          : {}),
      },
      input: framed.input,
      maxBuffer: REPAIR_DIRECTORY_MAX_ENCODED_BYTES + 1,
      stdio: [
        "pipe",
        "pipe",
        "pipe",
        pinnedDirectory.descriptor,
        ...(useTestDescriptors ? ["ignore", "ignore", 3, 4] : []),
      ],
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    throw new Error(
      `${label} bounded listing failed${stderr ? `: ${stderr}` : "."}`,
    );
  }
  const encoded = Buffer.from(result.stdout ?? Buffer.alloc(0));
  if (encoded.length > REPAIR_DIRECTORY_MAX_ENCODED_BYTES) {
    throw new Error(`${label} exceeds its encoded byte boundary.`);
  }
  const entries =
    encoded.length === 0 ? [] : decoder.decode(encoded).split("\0");
  if (
    entries.length > maxEntries ||
    entries.some(
      (entry) =>
        !entry ||
        entry === "." ||
        entry === ".." ||
        entry.includes(path.sep) ||
        entry.includes("\0"),
    )
  ) {
    throw new Error(`${label} returned an invalid bounded listing.`);
  }
  requirePinnedRepairDirectory(directoryPath, pinnedDirectory, label);
  return entries;
}

function runDurableRepairMove(
  sourcePath,
  destinationPath,
  pinnedSource,
  expectedBytes,
  { sourceDirectory: heldSourceDirectory = null } = {},
) {
  const sourceDirectoryPath = path.dirname(sourcePath);
  const destinationDirectoryPath = path.dirname(destinationPath);
  let sourceDirectory;
  let destinationDirectory;
  let closeSourceDirectory = false;
  try {
    sourceDirectory =
      heldSourceDirectory ??
      openPinnedRepairDirectory(
        sourceDirectoryPath,
        "Outcome ledger repair move source directory",
      );
    closeSourceDirectory = heldSourceDirectory === null;
    destinationDirectory = openPinnedRepairDirectory(
      destinationDirectoryPath,
      "Outcome ledger repair move destination directory",
    );
    requirePinnedRepairFile(
      sourcePath,
      pinnedSource.descriptor,
      pinnedSource.identity,
      expectedBytes,
      {
        expectedLinkCount: pinnedSource.identity.linkCount,
        label: "Outcome ledger repair durable move source",
      },
    );
    if (existsAsPath(destinationPath)) {
      throw new Error(
        `Outcome ledger repair durable move destination exists: ${destinationPath}`,
      );
    }
    requirePinnedRepairDirectory(
      sourceDirectoryPath,
      sourceDirectory,
      "Outcome ledger repair move source directory",
    );
    requirePinnedRepairDirectory(
      destinationDirectoryPath,
      destinationDirectory,
      "Outcome ledger repair move destination directory",
    );
    const helperSource = readPinnedLeaseArchiveHelperSource(undefined, {
      expectedDigest: OUTCOME_REPAIR_MOVE_HELPER_SHA256,
    });
    const pauseCheckpoint =
      process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_PAUSE ?? "";
    const useTestDescriptors =
      pauseCheckpoint !== "" &&
      process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_FDS === "3,4";
    const framed = framePinnedLeaseArchiveHelperInvocation(
      helperSource,
      "rename-durable",
      [
        path.basename(sourcePath),
        path.basename(destinationPath),
        String(pinnedSource.identity.device),
        String(pinnedSource.identity.inode),
        String(pinnedSource.identity.mode),
        String(pinnedSource.identity.linkCount),
        String(expectedBytes.length),
        sha256(expectedBytes),
        String(sourceDirectory.identity.device),
        String(sourceDirectory.identity.inode),
        String(destinationDirectory.identity.device),
        String(destinationDirectory.identity.inode),
      ],
      { expectedDigest: OUTCOME_REPAIR_MOVE_HELPER_SHA256 },
    );
    const result = spawnSync(
      OUTCOME_REPAIR_MOVE_PYTHON,
      framed.argv,
      {
        env: {
          HOME: process.env.HOME ?? "",
          LANG: "C",
          LC_ALL: "C",
          PATH: "/usr/bin:/bin",
          ...(useTestDescriptors
            ? {
                FREED_REPAIR_MOVE_TEST_PAUSE: pauseCheckpoint,
                FREED_REPAIR_MOVE_TEST_OPERATION:
                  process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_OPERATION ?? "",
                FREED_REPAIR_MOVE_TEST_SOURCE:
                  process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_SOURCE ?? "",
                FREED_REPAIR_MOVE_TEST_DESTINATION:
                  process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_DESTINATION ?? "",
              }
            : {}),
        },
        input: framed.input,
        maxBuffer: 1024 * 1024,
        stdio: [
          "pipe",
          "pipe",
          "pipe",
          sourceDirectory.descriptor,
          destinationDirectory.descriptor,
          pinnedSource.descriptor,
          ...(useTestDescriptors ? [3, 4] : []),
        ],
      },
    );
    if (result.error !== undefined || result.status !== 0) {
      const stderr = String(result.stderr ?? "").trim();
      throw new Error(
        `Outcome ledger repair durable move failed${stderr ? `: ${stderr}` : "."}`,
      );
    }
    let receipt;
    try {
      receipt = JSON.parse(String(result.stdout ?? ""));
    } catch {
      throw new Error("Outcome ledger repair durable move receipt is invalid.");
    }
    if (
      receipt?.protocol !== "freed-lease-archive-move-v1" ||
      receipt.device !== String(pinnedSource.identity.device) ||
      receipt.inode !== String(pinnedSource.identity.inode) ||
      receipt.size !== String(expectedBytes.length) ||
      receipt.digest !== sha256(expectedBytes)
    ) {
      throw new Error("Outcome ledger repair durable move receipt changed.");
    }
    if (existsAsPath(sourcePath)) {
      throw new Error(
        `Outcome ledger repair durable move source survived: ${sourcePath}`,
      );
    }
    requirePinnedRepairFile(
      destinationPath,
      pinnedSource.descriptor,
      pinnedSource.identity,
      expectedBytes,
      {
        expectedLinkCount: pinnedSource.identity.linkCount,
        label: "Outcome ledger repair durable move destination",
      },
    );
  } finally {
    if (destinationDirectory !== undefined) {
      closeSync(destinationDirectory.descriptor);
    }
    if (closeSourceDirectory && sourceDirectory !== undefined) {
      closeSync(sourceDirectory.descriptor);
    }
  }
}

function runDurableRepairExchange(
  sourcePath,
  destinationPath,
  pinnedSource,
  sourceBytes,
  pinnedDestination,
  destinationBytes,
  {
    sourceDirectory: heldSourceDirectory = null,
    destinationDirectory: heldDestinationDirectory = null,
  } = {},
) {
  const sourceDirectoryPath = path.dirname(sourcePath);
  const destinationDirectoryPath = path.dirname(destinationPath);
  let sourceDirectory;
  let destinationDirectory;
  let closeSourceDirectory = false;
  let closeDestinationDirectory = false;
  try {
    sourceDirectory =
      heldSourceDirectory ??
      openPinnedRepairDirectory(
        sourceDirectoryPath,
        "Outcome ledger repair exchange source directory",
      );
    closeSourceDirectory = heldSourceDirectory === null;
    destinationDirectory =
      heldDestinationDirectory ??
      openPinnedRepairDirectory(
        destinationDirectoryPath,
        "Outcome ledger repair exchange destination directory",
      );
    closeDestinationDirectory = heldDestinationDirectory === null;
    requirePinnedRepairFile(
      sourcePath,
      pinnedSource.descriptor,
      pinnedSource.identity,
      sourceBytes,
      {
        expectedLinkCount: pinnedSource.identity.linkCount,
        label: "Outcome ledger repair exchange source",
      },
    );
    requirePinnedRepairFile(
      destinationPath,
      pinnedDestination.descriptor,
      pinnedDestination.identity,
      destinationBytes,
      {
        expectedLinkCount: pinnedDestination.identity.linkCount,
        label: "Outcome ledger repair exchange destination",
      },
    );
    const helperSource = readPinnedLeaseArchiveHelperSource(undefined, {
      expectedDigest: OUTCOME_REPAIR_MOVE_HELPER_SHA256,
    });
    const pauseCheckpoint =
      process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_PAUSE ?? "";
    const useTestDescriptors =
      pauseCheckpoint !== "" &&
      process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_FDS === "3,4";
    const framed = framePinnedLeaseArchiveHelperInvocation(
      helperSource,
      "exchange-durable",
      [
        path.basename(sourcePath),
        path.basename(destinationPath),
        String(pinnedSource.identity.device),
        String(pinnedSource.identity.inode),
        String(pinnedSource.identity.mode),
        String(pinnedSource.identity.linkCount),
        String(sourceBytes.length),
        sha256(sourceBytes),
        String(pinnedDestination.identity.device),
        String(pinnedDestination.identity.inode),
        String(pinnedDestination.identity.mode),
        String(pinnedDestination.identity.linkCount),
        String(destinationBytes.length),
        sha256(destinationBytes),
        String(sourceDirectory.identity.device),
        String(sourceDirectory.identity.inode),
        String(destinationDirectory.identity.device),
        String(destinationDirectory.identity.inode),
      ],
      { expectedDigest: OUTCOME_REPAIR_MOVE_HELPER_SHA256 },
    );
    const result = spawnSync(
      OUTCOME_REPAIR_MOVE_PYTHON,
      framed.argv,
      {
        env: {
          HOME: process.env.HOME ?? "",
          LANG: "C",
          LC_ALL: "C",
          PATH: "/usr/bin:/bin",
          ...(useTestDescriptors
            ? {
                FREED_REPAIR_MOVE_TEST_PAUSE: pauseCheckpoint,
                FREED_REPAIR_MOVE_TEST_OPERATION:
                  process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_OPERATION ?? "",
                FREED_REPAIR_MOVE_TEST_SOURCE:
                  process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_SOURCE ?? "",
                FREED_REPAIR_MOVE_TEST_DESTINATION:
                  process.env.FREED_OUTCOME_REPAIR_MOVE_TEST_DESTINATION ?? "",
              }
            : {}),
        },
        input: framed.input,
        maxBuffer: 1024 * 1024,
        stdio: [
          "pipe",
          "pipe",
          "pipe",
          sourceDirectory.descriptor,
          destinationDirectory.descriptor,
          pinnedSource.descriptor,
          ...(useTestDescriptors ? [3, 4] : []),
        ],
      },
    );
    if (result.error !== undefined || result.status !== 0) {
      const stderr = String(result.stderr ?? "").trim();
      throw new Error(
        `Outcome ledger repair durable exchange failed${stderr ? `: ${stderr}` : "."}`,
      );
    }
    let receipt;
    try {
      receipt = JSON.parse(String(result.stdout ?? ""));
    } catch {
      throw new Error("Outcome ledger repair durable exchange receipt is invalid.");
    }
    if (
      receipt?.protocol !== "freed-lease-archive-move-v1" ||
      receipt.sourceDevice !== String(pinnedSource.identity.device) ||
      receipt.sourceInode !== String(pinnedSource.identity.inode) ||
      receipt.sourceDigest !== sha256(sourceBytes) ||
      receipt.destinationDevice !==
        String(pinnedDestination.identity.device) ||
      receipt.destinationInode !==
        String(pinnedDestination.identity.inode) ||
      receipt.destinationDigest !== sha256(destinationBytes)
    ) {
      throw new Error("Outcome ledger repair durable exchange receipt changed.");
    }
    requirePinnedRepairFile(
      destinationPath,
      pinnedSource.descriptor,
      pinnedSource.identity,
      sourceBytes,
      {
        expectedLinkCount: pinnedSource.identity.linkCount,
        label: "Outcome ledger repair exchanged successor",
      },
    );
    requirePinnedRepairFile(
      sourcePath,
      pinnedDestination.descriptor,
      pinnedDestination.identity,
      destinationBytes,
      {
        expectedLinkCount: pinnedDestination.identity.linkCount,
        label: "Outcome ledger repair exchanged predecessor",
      },
    );
  } finally {
    if (closeDestinationDirectory && destinationDirectory !== undefined) {
      closeSync(destinationDirectory.descriptor);
    }
    if (closeSourceDirectory && sourceDirectory !== undefined) {
      closeSync(sourceDirectory.descriptor);
    }
  }
}

function requirePinnedPredecessor(filePath, predecessor) {
  if (predecessor === null) {
    if (existsAsPath(filePath)) {
      throw new Error(
        `Outcome ledger repair destination appeared before publication: ${filePath}`,
      );
    }
    return;
  }
  requirePinnedRepairFile(
    filePath,
    predecessor.descriptor,
    predecessor.identity,
    predecessor.bytes,
    { label: "Outcome ledger repair predecessor" },
  );
}

function quarantinePinnedRepairTemporary(
  filePath,
  descriptor,
  identity,
  expectedBytes,
  {
    checkpoint = () => {},
    checkpointName = "repair-temp-cleanup",
    retirementDirectory,
    stateRoot,
    plan = null,
    beforeMutation = () => {},
    sourceDirectory = null,
    retirementLineage = null,
  } = {},
) {
  requirePinnedRepairFile(filePath, descriptor, identity, expectedBytes, {
    expectedLinkCount: 1,
    label: "Outcome ledger repair temporary",
  });
  const generation = retirementLineage?.generation;
  const sourceClass = retirementLineage?.sourceClass;
  const quarantineSuffixDigest = retirementLineage?.quarantineSuffixDigest;
  const hasLegacyLineage = retirementLineage !== null;
  if (
    hasLegacyLineage &&
    (retirementLineage.operationId !== plan?.operationId ||
      ![
        "decisions",
        "receipt",
        "rejected",
        "replacement",
        "source",
        "transaction",
        "trusted",
      ].includes(sourceClass) ||
      !/^(?:[0-9]{1,20}|[0-9a-f]{64})$/.test(String(generation ?? "")) ||
      !SHA256_PATTERN.test(String(quarantineSuffixDigest ?? "")) ||
      typeof retirementLineage.targetPath !== "string")
  ) {
    throw new Error(
      "Outcome ledger repair cleanup has invalid legacy retirement lineage.",
    );
  }
  const lineage = hasLegacyLineage
    ? {
        schemaVersion: 1,
        kind: "outcome-ledger-repair-temporary-retirement",
        operationId: plan.operationId,
        sourceClass,
        targetPath: retirementLineage.targetPath,
        generation,
        quarantineSuffixDigest,
      }
    : null;
  const retirementId = sha256(
    stableJson({
      ...(lineage === null ? { filePath } : { lineage }),
      device: String(identity.device),
      inode: String(identity.inode),
      mode: identity.mode,
      linkCount: 1,
      size: expectedBytes.length,
      digest: sha256(expectedBytes),
    }),
  );
  if (typeof retirementDirectory !== "string") {
    throw new Error(
      "Outcome ledger repair cleanup requires an operation-owned retirement directory.",
    );
  }
  requirePrivateDescendantDirectories(stateRoot, retirementDirectory, {
    create: true,
    beforeMutation,
  });
  const quarantinePath = path.join(
    retirementDirectory,
    lineage === null
      ? `temporary-${retirementId}.archive`
      : `temporary-v2.${sourceClass}.${generation}.${quarantineSuffixDigest}.${retirementId}.archive`,
  );
  checkpoint(`${checkpointName}-before-quarantine`, {
    filePath,
    quarantinePath,
  });
  requirePinnedRepairFile(filePath, descriptor, identity, expectedBytes, {
    expectedLinkCount: 1,
    label: "Outcome ledger repair temporary",
  });
  if (existsAsPath(quarantinePath)) {
    throw new Error(
      `Outcome ledger repair cleanup quarantine already exists: ${quarantinePath}`,
    );
  }
  beforeMutation();
  runDurableRepairMove(
    filePath,
    quarantinePath,
    { descriptor, identity },
    expectedBytes,
    { sourceDirectory },
  );
  requirePinnedRepairFile(
    quarantinePath,
    descriptor,
    identity,
    expectedBytes,
    {
      expectedLinkCount: 1,
      label: "Outcome ledger repair quarantined temporary",
    },
  );
  checkpoint(`${checkpointName}-before-unlink`, {
    filePath,
    quarantinePath,
  });
  requirePinnedRepairFile(
    quarantinePath,
    descriptor,
    identity,
    expectedBytes,
    {
      expectedLinkCount: 1,
      label: "Outcome ledger repair quarantined temporary",
    },
  );
}

function removeExactOwnedRepairTemporary(
  filePath,
  finalPath,
  descriptor,
  identity,
  expectedBytes,
  {
    checkpoint = () => {},
    retirementDirectory,
    stateRoot,
    plan,
    beforeMutation = () => {},
  } = {},
) {
  if (identity === null || !existsAsPath(filePath)) return;
  const current = lstatSync(filePath);
  if (
    current.isSymbolicLink() ||
    !current.isFile() ||
    !repairFileIdentityMatches(current, identity)
  ) {
    throw new Error(
      `Outcome ledger repair preserved a foreign temporary path: ${filePath}`,
    );
  }
  if (current.nlink !== 1) {
    throw new Error(
      `Outcome ledger repair refuses a hard-linked temporary artifact: ${filePath}`,
    );
  }
  quarantinePinnedRepairTemporary(
    filePath,
    descriptor,
    identity,
    expectedBytes,
    {
      checkpoint,
      retirementDirectory,
      stateRoot,
      plan,
      beforeMutation,
    },
  );
}

function openOrCreateImmutableRepairTemporary(
  temporaryPath,
  bytes,
  beforeMutation,
  partialCheckpoint = null,
) {
  let descriptor;
  try {
    try {
      beforeMutation();
      descriptor = openSync(
        temporaryPath,
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      descriptor = openSync(
        temporaryPath,
        constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    }
    const initialStats = fstatSync(descriptor);
    const initialIdentity = repairFileIdentity(initialStats);
    const namedStats = lstatSync(temporaryPath);
    if (
      !initialStats.isFile() ||
      !namedStats.isFile() ||
      namedStats.isSymbolicLink() ||
      initialStats.uid !== currentUid() ||
      initialStats.nlink !== 1 ||
      namedStats.nlink !== 1 ||
      initialIdentity.mode !== 0o600 ||
      initialIdentity.size < 0 ||
      initialIdentity.size > bytes.length ||
      !repairFileIdentityMatches(namedStats, initialIdentity) ||
      realpathSync(temporaryPath) !== temporaryPath
    ) {
      throw new Error(
        `Unsafe deterministic immutable repair temporary: ${temporaryPath}`,
      );
    }
    const initialBytes = readPinnedRepairBytes(
      descriptor,
      initialIdentity.size,
    );
    if (!bytes.subarray(0, initialBytes.length).equals(initialBytes)) {
      throw new Error(
        `Conflicting deterministic immutable repair temporary: ${temporaryPath}`,
      );
    }
    if (initialBytes.length !== bytes.length) {
      beforeMutation();
      const beforeWrite = fstatSync(descriptor);
      const beforeWritePath = lstatSync(temporaryPath);
      if (
        !repairFileIdentityMatches(beforeWrite, initialIdentity) ||
        !repairFileIdentityMatches(beforeWritePath, initialIdentity) ||
        beforeWrite.nlink !== 1 ||
        beforeWritePath.nlink !== 1 ||
        realpathSync(temporaryPath) !== temporaryPath
      ) {
        throw new Error(
          `Deterministic immutable repair temporary changed before staging: ${temporaryPath}`,
        );
      }
      ftruncateSync(descriptor, 0);
      if (partialCheckpoint !== null && bytes.length > 0) {
        const partialLength = Math.max(1, Math.floor(bytes.length / 2));
        let partialOffset = 0;
        while (partialOffset < partialLength) {
          partialOffset += writeSync(
            descriptor,
            bytes,
            partialOffset,
            partialLength - partialOffset,
            partialOffset,
          );
        }
        fchmodSync(descriptor, 0o600);
        fsyncSync(descriptor);
        syncDirectory(path.dirname(temporaryPath));
        partialCheckpoint();
        ftruncateSync(descriptor, 0);
      }
      let writeOffset = 0;
      while (writeOffset < bytes.length) {
        writeOffset += writeSync(
          descriptor,
          bytes,
          writeOffset,
          bytes.length - writeOffset,
          writeOffset,
        );
      }
      fchmodSync(descriptor, 0o600);
      fsyncSync(descriptor);
      syncDirectory(path.dirname(temporaryPath));
    }
    const identity = repairFileIdentity(fstatSync(descriptor));
    requirePinnedRepairFile(temporaryPath, descriptor, identity, bytes, {
      label: "Outcome ledger repair deterministic immutable temporary",
    });
    return { descriptor, identity };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function writeImmutable(
  filePath,
  bytes,
  {
    beforePublish = () => {},
    partialCheckpoint = null,
    retirementDirectory,
    stateRoot,
  } = {},
) {
  const parentDirectory = path.dirname(filePath);
  requirePrivateDirectory(parentDirectory, {
    create: true,
    beforeMutation: beforePublish,
  });
  if (existsAsPath(filePath)) {
    const existing = safeReadImmutableRepairArtifact(filePath, {
      maxBytes: Math.max(bytes.length, 1) + 1,
      exactMode: 0o600,
    }).bytes;
    if (!existing.equals(bytes)) {
      throw new Error(`Conflicting immutable repair artifact: ${filePath}`);
    }
    return;
  }
  const temporaryPath = immutableRepairTemporaryPath(filePath, bytes);
  let descriptor;
  let ownedIdentity = null;
  let publicationAuthorized = false;
  try {
    const staged = openOrCreateImmutableRepairTemporary(
      temporaryPath,
      bytes,
      beforePublish,
      partialCheckpoint,
    );
    descriptor = staged.descriptor;
    ownedIdentity = staged.identity;
    fsyncSync(descriptor);
    syncDirectory(path.dirname(temporaryPath));
    requirePinnedRepairFile(
      temporaryPath,
      descriptor,
      ownedIdentity,
      bytes,
      { label: "Outcome ledger repair immutable temporary" },
    );
    beforePublish();
    publicationAuthorized = true;
    requirePinnedRepairFile(
      temporaryPath,
      descriptor,
      ownedIdentity,
      bytes,
      { label: "Outcome ledger repair immutable temporary" },
    );
    if (!existsAsPath(filePath)) {
      runDurableRepairMove(
        temporaryPath,
        filePath,
        { descriptor, identity: ownedIdentity },
        bytes,
      );
      requirePinnedRepairFile(
        filePath,
        descriptor,
        ownedIdentity,
        bytes,
        {
          label: "Outcome ledger repair immutable publication",
        },
      );
    } else {
      const existing = safeReadImmutableRepairArtifact(filePath, {
        maxBytes: Math.max(bytes.length, 1) + 1,
        exactMode: 0o600,
      }).bytes;
      if (!existing.equals(bytes)) {
        throw new Error(`Conflicting immutable repair artifact: ${filePath}`);
      }
    }
  } finally {
    try {
      if (
        publicationAuthorized &&
        descriptor !== undefined &&
        ownedIdentity !== null &&
        existsAsPath(temporaryPath)
      ) {
        beforePublish();
        removeExactOwnedRepairTemporary(
          temporaryPath,
          filePath,
          descriptor,
          ownedIdentity,
          bytes,
          {
            retirementDirectory,
            stateRoot,
            beforeMutation: beforePublish,
          },
        );
      }
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}

function writeJsonAtomic(
  filePath,
  value,
  {
    beforeRename = () => {},
    retirementDirectory,
    stateRoot,
  } = {},
) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (existsAsPath(filePath)) {
    const existing = safeReadRegularFile(filePath, {
      exactMode: 0o600,
      maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
    }).bytes;
    if (!existing.equals(bytes)) {
      throw new Error(
        `Outcome ledger repair refuses to overwrite JSON publication: ${filePath}`,
      );
    }
    return;
  }
  writeImmutable(filePath, bytes, {
    beforePublish: beforeRename,
    retirementDirectory,
    stateRoot,
  });
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
  { create = false, beforeMutation = () => {} } = {},
) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Outcome ledger repair directory escapes the state root.");
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    requirePrivateDirectory(current, { create, beforeMutation });
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

function classifyCurrentLedger({
  stateRoot,
  taskId,
  expectedSourceDigest,
  eventHistoryPrefixDigest = undefined,
  eventHistoryPrefixSize = undefined,
  allowedPendingOperationId = null,
  sourceBytes = undefined,
  expectedCanonicalLedger = undefined,
  planningBundle = null,
  writerGuardContext = null,
  allowExactFencedLegacyTemps = false,
}) {
  const root = canonicalStateRoot(stateRoot);
  const paths = automationControlPaths(root);
  if (planningBundle === null) {
    let classified;
    withAutomationPlanningReadBundle(
      {
        stateRoot: root,
        ledgerPath: paths.outcomes,
        writerGuardContext,
      },
      (bundle) => {
        classified = classifyCurrentLedger({
          stateRoot: root,
          taskId,
          expectedSourceDigest,
          eventHistoryPrefixDigest,
          eventHistoryPrefixSize,
          allowedPendingOperationId,
          sourceBytes,
          expectedCanonicalLedger,
          planningBundle: bundle,
          writerGuardContext,
          allowExactFencedLegacyTemps,
        });
        return null;
      },
    );
    return classified;
  }
  const taskMatches = planningBundle.taskManifest.tasks.filter(
    (candidate) => candidate?.taskId === taskId,
  );
  if (
    taskMatches.length !== 1 ||
    !Number.isSafeInteger(taskMatches[0]?.revision)
  ) {
    throw new Error(`Outcome ledger repair task ${taskId} does not exist.`);
  }
  const task = {
    taskId: taskMatches[0].taskId,
    state: taskMatches[0].state,
    revision: taskMatches[0].revision,
  };
  const ledgerIdentity = planningBundle.outcomeLedger.identity;
  const canonicalLedger = {
    bytes: Buffer.from(planningBundle.outcomeLedger.text, "utf8"),
    digest: planningBundle.outcomeLedger.digest,
    size: planningBundle.outcomeLedger.size,
    device: ledgerIdentity === null ? null : String(ledgerIdentity.dev),
    inode: ledgerIdentity === null ? null : String(ledgerIdentity.ino),
    mode: ledgerIdentity?.mode ?? null,
  };
  if (
    expectedCanonicalLedger !== undefined &&
    (canonicalLedger.digest !== expectedCanonicalLedger.digest ||
      canonicalLedger.size !== expectedCanonicalLedger.size ||
      String(canonicalLedger.device) !==
        String(expectedCanonicalLedger.device) ||
      String(canonicalLedger.inode) !== String(expectedCanonicalLedger.inode) ||
      canonicalLedger.mode !== expectedCanonicalLedger.mode)
  ) {
    throw new Error(
      "Canonical outcome ledger changed generation before classification.",
    );
  }
  if (sourceBytes !== undefined && expectedCanonicalLedger === undefined) {
    throw new Error(
      "Archived outcome ledger classification requires an exact canonical generation binding.",
    );
  }
  let analysisLedgerAdmission = null;
  let source = canonicalLedger;
  if (sourceBytes !== undefined) {
    if (
      allowedPendingOperationId === null ||
      !SHA256_PATTERN.test(allowedPendingOperationId)
    ) {
      throw new Error(
        "Archived outcome ledger classification requires its pending repair identity.",
      );
    }
    analysisLedgerAdmission = planningBundle.admitFile({
      filePath: repairPaths(
        root,
        taskId,
        allowedPendingOperationId,
        expectedSourceDigest,
      ).sourceArtifact,
      allowMissing: false,
      allowEmpty: true,
      maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
      allowedModes: [0o600],
      label: "Outcome ledger repair archived source",
    });
    const admittedSource = readAutomationPlanningAdmission(
      planningBundle,
      analysisLedgerAdmission,
    );
    const admittedBytes = Buffer.from(admittedSource.bytesBase64, "base64");
    if (!admittedBytes.equals(Buffer.from(sourceBytes))) {
      throw new Error(
        "Archived outcome ledger source changed from its classified repair material.",
      );
    }
    source = {
      bytes: admittedBytes,
      digest: admittedSource.digest,
      size: admittedSource.size,
    };
  }
  if (source.digest !== expectedSourceDigest) {
    throw new Error(
      `Outcome ledger source digest changed: expected ${expectedSourceDigest}, found ${source.digest}.`,
    );
  }
  const eventIdentity = planningBundle.controlEventHistory.identity;
  const events = {
    bytes: Buffer.from(planningBundle.controlEventHistory.text, "utf8"),
    digest: planningBundle.controlEventHistory.digest,
    size: planningBundle.controlEventHistory.size,
    device: eventIdentity === null ? null : String(eventIdentity.dev),
    inode: eventIdentity === null ? null : String(eventIdentity.ino),
    mode: eventIdentity?.mode ?? null,
  };
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
  const summary = summarizeOutcomeLedger(paths.outcomes, {
    stateRoot: root,
    allowedPendingRepairOperationId: allowedPendingOperationId,
    planningBundle,
    analysisLedgerAdmission,
  });
  const unexpectedPendingRepairs =
    summary.sourceHealth.pendingOutcomeLedgerRepairs.filter(
      (repair) => repair.operationId !== allowedPendingOperationId,
    );
  const expectedFencedRecovery =
    allowedPendingOperationId !== null &&
    summary.sourceHealth.pendingOutcomeLedgerRepairs.length === 1 &&
    summary.sourceHealth.pendingOutcomeLedgerRepairs[0].operationId ===
      allowedPendingOperationId &&
    summary.sourceHealth.pendingOutcomeLedgerRepairs[0].phase === "fenced" &&
    summary.sourceHealth.pendingOutcomeLedgerRepairs[0]
      .recoverablePreparationResidue === true &&
    summary.sourceHealth.outcomeLedgerTransactionIssues.length === 1;
  const recoverableUncommittedFenceStaging =
    allowedPendingOperationId === null &&
    summary.sourceHealth.pendingOutcomeLedgerRepairs.length === 0 &&
    summary.sourceHealth.outcomeLedgerTransactionIssues.length > 0 &&
    summary.sourceHealth.outcomeLedgerTransactionIssues.every((issue) =>
      /^\.pending\.json\.(?:\d+|[0-9a-f]{64})\.tmp(?:\.quarantine\.[0-9a-f-]{36})*: transaction staging has no exact lineage$/.test(
        issue,
      ),
    );
  const repairTransactionHealthAccepted =
    summary.sourceHealth.outcomeLedgerTransactionsHealthy ||
    expectedFencedRecovery ||
    recoverableUncommittedFenceStaging;
  if (
    !summary.sourceHealth.ledgerSyntaxHealthy ||
    !summary.sourceHealth.ledgerPhysicalBoundaryHealthy ||
    !summary.sourceHealth.controlEventsHealthy ||
    !summary.sourceHealth.pinnedLegacyOutcomeBundlesHealthy ||
    (!repairTransactionHealthAccepted && !allowExactFencedLegacyTemps) ||
    unexpectedPendingRepairs.length > 0 ||
    (allowedPendingOperationId === null &&
      summary.sourceHealth.pendingOutcomeLedgerRepairs.length > 0)
  ) {
    throw new Error(
      `Outcome ledger repair requires healthy ledger, control event, and repair transaction sources: ${JSON.stringify({
        ledgerSyntaxHealthy: summary.sourceHealth.ledgerSyntaxHealthy,
        ledgerPhysicalBoundaryHealthy:
          summary.sourceHealth.ledgerPhysicalBoundaryHealthy,
        controlEventsHealthy: summary.sourceHealth.controlEventsHealthy,
        pinnedLegacyOutcomeBundlesHealthy:
          summary.sourceHealth.pinnedLegacyOutcomeBundlesHealthy,
        outcomeLedgerTransactionsHealthy:
          summary.sourceHealth.outcomeLedgerTransactionsHealthy,
        outcomeLedgerTransactionIssues:
          summary.sourceHealth.outcomeLedgerTransactionIssues,
        pendingOutcomeLedgerRepairs:
          summary.sourceHealth.pendingOutcomeLedgerRepairs,
      })}`,
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
  const decisionParameters = {
    sourceDigest: source.digest,
    sourceSize: source.size,
    sourceLineCount: lines.length,
    eventHistoryDigest: boundEventHistoryDigest,
    eventHistorySize: boundEventHistorySize,
    trustedCount: trustedLines.length,
    rejectedCount: rejectedLines.length,
    replacementDigest: sha256(trustedBytes),
    replacementSize: trustedBytes.length,
  };
  const decisionBytes = encodeOutcomeRepairDecisionManifest(
    taskId,
    decisionParameters,
    lines,
    decisions,
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
  const classified = {
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
  if (!repairTransactionHealthAccepted && allowExactFencedLegacyTemps) {
    preflightRepairTemporaryFiles(classified, { fencedRecovery: true });
    const legacyArtifactName = `(?:${[
      path.basename(classified.artifacts.sourceArtifact),
      path.basename(classified.artifacts.trustedArtifact),
      path.basename(classified.artifacts.rejectedArtifact),
      path.basename(classified.artifacts.decisionsArtifact),
    ]
      .map(escapeRegularExpression)
      .join("|")})`;
    const legacyGeneration = "(?:[0-9]{1,20}|[0-9a-f]{64})";
    const quarantineSuffix =
      "(?:\\.quarantine\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*";
    const legacyArtifactIssue = new RegExp(
      `^pending\\.json: fenced (?:repair contains premature entry|prepared transition contains foreign entry) \\.${legacyArtifactName}\\.${legacyGeneration}\\.tmp${quarantineSuffix}$`,
    );
    const exactFencedResidueIssue =
      /^pending\.json: fenced repair has (?:partial preparation|prepared transition) residue that requires exact repair recovery$/;
    if (
      summary.sourceHealth.outcomeLedgerTransactionIssues.length === 0 ||
      !summary.sourceHealth.outcomeLedgerTransactionIssues.every(
        (issue) =>
          legacyArtifactIssue.test(issue) ||
          exactFencedResidueIssue.test(issue),
      )
    ) {
      throw new Error(
        `Fenced outcome ledger repair has unsupported transaction residue: ${JSON.stringify(
          summary.sourceHealth.outcomeLedgerTransactionIssues,
        )}`,
      );
    }
  }
  return classified;
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

function publicationFileIdentity(filePath, identity, bytes) {
  return {
    path: filePath,
    device: String(identity.device),
    inode: String(identity.inode),
    uid: identity.uid,
    mode: identity.mode,
    linkCount: identity.linkCount,
    size: bytes.length,
    digest: sha256(bytes),
  };
}

function canonicalPublicationIdentityRecord(identity) {
  return {
    path: identity.path,
    device: identity.device,
    inode: identity.inode,
    uid: identity.uid,
    mode: identity.mode,
    linkCount: identity.linkCount,
    size: identity.size,
    digest: identity.digest,
  };
}

function repairRetirementDirectory(plan) {
  return path.join(plan.artifacts.artifactDirectory, "retired");
}

function ledgerReplacementTemporaryPath(plan) {
  return `${plan.artifacts.outcomes}.${plan.operationId}.${sha256(
    plan.material.trustedBytes,
  )}.repair.tmp`;
}

function openOrCreateReplacementTemporary(
  temporaryPath,
  bytes,
  beforeMutation,
) {
  let descriptor;
  let created = false;
  try {
    try {
      beforeMutation();
      descriptor = openSync(
        temporaryPath,
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      created = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      descriptor = openSync(
        temporaryPath,
        constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    }
    const initial = fstatSync(descriptor);
    const initialMode = initial.mode & 0o7777;
    if (
      !initial.isFile() ||
      initial.uid !== currentUid() ||
      initial.nlink !== 1 ||
      initialMode !== 0o600 ||
      initial.size < 0 ||
      initial.size > bytes.length ||
      realpathSync(temporaryPath) !== temporaryPath
    ) {
      throw new Error(
        `Unsafe outcome ledger repair replacement temporary: ${temporaryPath}`,
      );
    }
    const initialBytes = readPinnedRepairBytes(descriptor, initial.size);
    const named = lstatSync(temporaryPath);
    if (
      named.isSymbolicLink() ||
      !repairFileIdentityMatches(named, repairFileIdentity(initial)) ||
      named.nlink !== 1 ||
      !bytes.subarray(0, initialBytes.length).equals(initialBytes)
    ) {
      throw new Error(
        `Conflicting deterministic replacement temporary: ${temporaryPath}`,
      );
    }
    if (created || initialBytes.length !== bytes.length) {
      beforeMutation();
      const beforeWrite = fstatSync(descriptor);
      const beforeWritePath = lstatSync(temporaryPath);
      if (
        !repairFileIdentityMatches(beforeWrite, repairFileIdentity(initial)) ||
        !repairFileIdentityMatches(
          beforeWritePath,
          repairFileIdentity(initial),
        ) ||
        beforeWrite.nlink !== 1 ||
        beforeWritePath.nlink !== 1 ||
        realpathSync(temporaryPath) !== temporaryPath
      ) {
        throw new Error(
          `Outcome ledger repair replacement temporary changed before staging: ${temporaryPath}`,
        );
      }
      ftruncateSync(descriptor, 0);
      writeFileSync(descriptor, bytes);
      fchmodSync(descriptor, 0o600);
      fsyncSync(descriptor);
      syncDirectory(path.dirname(temporaryPath));
    }
    const identity = repairFileIdentity(fstatSync(descriptor));
    requirePinnedRepairFile(temporaryPath, descriptor, identity, bytes, {
      label: "Outcome ledger repair replacement temporary",
    });
    return { descriptor, identity };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function writeReplacementAtomic(
  plan,
  checkpoint,
  beforeRename,
  predecessor,
) {
  const ledgerPath = plan.artifacts.outcomes;
  const operationId = plan.operationId;
  const bytes = plan.material.trustedBytes;
  const temporaryPath = ledgerReplacementTemporaryPath(plan);
  const publicationIntentPath = ledgerReplacementPublicationIntentPath(plan);
  const retirementDirectory = repairRetirementDirectory(plan);
  let descriptor;
  let ownedIdentity = null;
  let preserveTemporaryForRecovery = false;
  try {
    const staged = openOrCreateReplacementTemporary(
      temporaryPath,
      bytes,
      beforeRename,
    );
    descriptor = staged.descriptor;
    ownedIdentity = staged.identity;
    requirePinnedPredecessor(ledgerPath, predecessor);
    checkpoint("replacement-synced");
    requirePinnedRepairFile(
      temporaryPath,
      descriptor,
      ownedIdentity,
      bytes,
      { label: "Outcome ledger repair replacement temporary" },
    );
    requirePinnedPredecessor(ledgerPath, predecessor);
    const publicationIntentDirectory = path.join(
      plan.artifacts.artifactDirectory,
      "publication-intents",
    );
    const publicationArchiveDirectory = retirementDirectory;
    requirePrivateDescendantDirectories(
      plan.artifacts.stateRoot,
      publicationIntentDirectory,
      { create: true, beforeMutation: beforeRename },
    );
    requirePrivateDescendantDirectories(
      plan.artifacts.stateRoot,
      publicationArchiveDirectory,
      { create: true, beforeMutation: beforeRename },
    );
    if (predecessor.identity.mode !== 0o600) {
      beforeRename();
      requirePinnedPredecessor(ledgerPath, predecessor);
      fchmodSync(predecessor.descriptor, 0o600);
      fsyncSync(predecessor.descriptor);
      syncDirectory(path.dirname(ledgerPath));
      predecessor.identity = repairFileIdentity(
        fstatSync(predecessor.descriptor),
      );
      predecessor.device = predecessor.identity.device;
      predecessor.inode = predecessor.identity.inode;
      predecessor.mode = predecessor.identity.mode;
      predecessor.size = predecessor.identity.size;
      checkpoint("replacement-predecessor-private");
      requirePinnedPredecessor(ledgerPath, predecessor);
    }
    const predecessorIdentity = publicationFileIdentity(
      ledgerPath,
      predecessor.identity,
      predecessor.bytes,
    );
    const replacementIdentity = publicationFileIdentity(
      temporaryPath,
      ownedIdentity,
      bytes,
    );
    const archiveId = sha256(
      stableJson({
        operationId,
        target: ledgerPath,
        predecessor: predecessorIdentity,
      }),
    );
    const predecessorArchivePath = path.join(
      publicationArchiveDirectory,
      `ledger-predecessor-${archiveId}.archive`,
    );
    const publicationIntentBytes = ledgerReplacementPublicationIntentBytes(
      plan,
      predecessorIdentity,
      replacementIdentity,
      predecessorArchivePath,
    );
    preserveTemporaryForRecovery = true;
    writeImmutable(publicationIntentPath, publicationIntentBytes, {
      beforePublish: beforeRename,
      partialCheckpoint: () => {
        checkpoint("replacement-intent-partial");
        beforeRename();
      },
      retirementDirectory,
      stateRoot: plan.artifacts.stateRoot,
    });
    checkpoint("replacement-intent-durable");
    requirePinnedRepairFile(
      temporaryPath,
      descriptor,
      ownedIdentity,
      bytes,
      { label: "Outcome ledger repair replacement temporary" },
    );
    requirePinnedPredecessor(ledgerPath, predecessor);
    beforeRename();
    requirePinnedRepairFile(
      temporaryPath,
      descriptor,
      ownedIdentity,
      bytes,
      { label: "Outcome ledger repair replacement temporary" },
    );
    requirePinnedPredecessor(ledgerPath, predecessor);
    runDurableRepairMove(
      ledgerPath,
      predecessorArchivePath,
      predecessor,
      predecessor.bytes,
    );
    checkpoint("replacement-predecessor-archived");
    requirePinnedRepairFile(
      predecessorArchivePath,
      predecessor.descriptor,
      predecessor.identity,
      predecessor.bytes,
      { label: "Outcome ledger repair archived canonical predecessor" },
    );
    beforeRename();
    requirePinnedRepairFile(
      temporaryPath,
      descriptor,
      ownedIdentity,
      bytes,
      { label: "Outcome ledger repair replacement temporary" },
    );
    if (existsAsPath(ledgerPath)) {
      throw new Error(
        "Outcome ledger repair canonical path reappeared before replacement publication.",
      );
    }
    runDurableRepairMove(
      temporaryPath,
      ledgerPath,
      { descriptor, identity: ownedIdentity },
      bytes,
    );
    requirePinnedRepairFile(ledgerPath, descriptor, ownedIdentity, bytes, {
      label: "Outcome ledger repair replacement publication",
    });
    checkpoint("replacement-renamed");
    requirePinnedRepairFile(ledgerPath, descriptor, ownedIdentity, bytes, {
      label: "Outcome ledger repair replacement publication",
    });
    syncDirectory(path.dirname(ledgerPath));
    checkpoint("replacement-directory-synced");
    requirePinnedRepairFile(ledgerPath, descriptor, ownedIdentity, bytes, {
      label: "Outcome ledger repair replacement publication",
    });
  } finally {
    try {
      if (
        descriptor !== undefined &&
        ownedIdentity !== null &&
        !preserveTemporaryForRecovery &&
        existsAsPath(temporaryPath)
      ) {
        beforeRename();
        removeExactOwnedRepairTemporary(
          temporaryPath,
          ledgerPath,
          descriptor,
          ownedIdentity,
          bytes,
          {
            retirementDirectory,
            stateRoot: plan.artifacts.stateRoot,
            beforeMutation: beforeRename,
          },
        );
      }
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}

function ledgerReplacementPublicationIntentPath(plan) {
  return path.join(
    plan.artifacts.artifactDirectory,
    "publication-intents",
    "ledger-replacement.json",
  );
}

function ledgerReplacementPublicationIntentRecord(
  plan,
  predecessor,
  replacement,
  archivePath,
) {
  return {
    schemaVersion: 1,
    kind: "outcome-ledger-replacement-publication",
    operationId: plan.operationId,
    targetPath: plan.artifacts.outcomes,
    predecessor: {
      ...canonicalPublicationIdentityRecord(predecessor),
      archivePath,
    },
    replacement: canonicalPublicationIdentityRecord(replacement),
  };
}

function ledgerReplacementPublicationIntentBytes(
  plan,
  predecessor,
  replacement,
  archivePath,
) {
  return Buffer.from(
    `${JSON.stringify(
      ledgerReplacementPublicationIntentRecord(
        plan,
        predecessor,
        replacement,
        archivePath,
      ),
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function requirePublicationIdentityRecord(
  value,
  label,
  {
    maxBytes = OUTCOME_LEDGER_REPAIR_MAX_BYTES,
    allowedLinkCounts = [1],
  } = {},
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    stableJson(Object.keys(value).sort()) !==
      stableJson(
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
      ) ||
    typeof value.path !== "string" ||
    !CANONICAL_DECIMAL_PATTERN.test(value.device) ||
    !CANONICAL_DECIMAL_PATTERN.test(value.inode) ||
    ![0o600, 0o640, 0o644].includes(value.mode) ||
    !allowedLinkCounts.includes(value.linkCount) ||
    !Number.isSafeInteger(value.uid) ||
    value.uid !== currentUid() ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    value.size > maxBytes ||
    !SHA256_PATTERN.test(value.digest)
  ) {
    throw new Error(`Outcome ledger repair ${label} identity is invalid.`);
  }
  return value;
}

function readLedgerReplacementPublicationIntent(plan) {
  const intentPath = ledgerReplacementPublicationIntentPath(plan);
  if (!existsAsPath(intentPath)) return null;
  const admitted = safeReadRegularFile(intentPath, {
    exactMode: 0o600,
    maxBytes: 64 * 1024,
  });
  let intent;
  try {
    intent = JSON.parse(decoder.decode(admitted.bytes));
  } catch {
    throw new Error(
      "Outcome ledger repair publication intent is not canonical UTF-8 JSON.",
    );
  }
  if (
    !intent ||
    typeof intent !== "object" ||
    Array.isArray(intent) ||
    stableJson(Object.keys(intent).sort()) !==
      stableJson(
        [
          "kind",
          "operationId",
          "predecessor",
          "replacement",
          "schemaVersion",
          "targetPath",
        ].sort(),
      ) ||
    intent.schemaVersion !== 1 ||
    intent.kind !== "outcome-ledger-replacement-publication" ||
    intent.operationId !== plan.operationId ||
    intent.targetPath !== plan.artifacts.outcomes
  ) {
    throw new Error("Outcome ledger repair publication intent is invalid.");
  }
  const { archivePath, ...predecessorIdentity } = intent.predecessor ?? {};
  const predecessor = requirePublicationIdentityRecord(
    predecessorIdentity,
    "publication predecessor",
  );
  const replacement = requirePublicationIdentityRecord(
    intent.replacement,
    "publication replacement",
  );
  const retiredDirectory = repairRetirementDirectory(plan);
  const archiveId = sha256(
    stableJson({
      operationId: plan.operationId,
      target: plan.artifacts.outcomes,
      predecessor,
    }),
  );
  const expectedArchivePath = path.join(
    retiredDirectory,
    `ledger-predecessor-${archiveId}.archive`,
  );
  const expectedReplacementPath = ledgerReplacementTemporaryPath(plan);
  if (
    archivePath !== expectedArchivePath ||
    predecessor.path !== plan.artifacts.outcomes ||
    predecessor.size !== plan.parameters.sourceSize ||
    predecessor.digest !== plan.parameters.sourceDigest ||
    replacement.path !== expectedReplacementPath ||
    replacement.mode !== 0o600 ||
    replacement.size !== plan.parameters.replacementSize ||
    replacement.digest !== plan.parameters.replacementDigest
  ) {
    throw new Error("Outcome ledger repair publication intent conflicts with the plan.");
  }
  if (
    !admitted.bytes.equals(
      ledgerReplacementPublicationIntentBytes(
        plan,
        predecessor,
        replacement,
        expectedArchivePath,
      ),
    )
  ) {
    throw new Error(
      "Outcome ledger repair publication intent is not exact canonical JSON.",
    );
  }
  return {
    intentPath,
    archivePath,
    predecessor,
    replacement,
  };
}

function publicationIdentityMatches(pinned, record, expectedBytes) {
  return (
    String(pinned.identity.device) === record.device &&
    String(pinned.identity.inode) === record.inode &&
    pinned.identity.uid === record.uid &&
    pinned.identity.mode === record.mode &&
    pinned.identity.linkCount === record.linkCount &&
    pinned.identity.size === record.size &&
    pinned.bytes.equals(expectedBytes) &&
    sha256(pinned.bytes) === record.digest
  );
}

function openPublicationIdentity(filePath, record, expectedBytes, label) {
  const pinned = openPinnedRepairFile(filePath, {
    expectedLinkCount: record.linkCount,
    exactMode: record.mode,
    maxBytes: Math.max(record.size, 1) + 1,
    label,
  });
  if (!publicationIdentityMatches(pinned, record, expectedBytes)) {
    closeSync(pinned.descriptor);
    throw new Error(`Outcome ledger repair ${label} changed identity.`);
  }
  return pinned;
}

function recoverLedgerReplacementPublication(
  plan,
  { checkpoint = () => {}, beforeMutation = () => {} } = {},
) {
  const publication = readLedgerReplacementPublicationIntent(plan);
  if (publication === null) return null;
  requirePrivateDescendantDirectories(
    plan.artifacts.stateRoot,
    path.dirname(publication.intentPath),
  );
  requirePrivateDescendantDirectories(
    plan.artifacts.stateRoot,
    path.dirname(publication.archivePath),
  );
  let canonical = null;
  let archive = null;
  let replacement = null;
  try {
    canonical = existsAsPath(plan.artifacts.outcomes)
      ? openPinnedRepairFile(plan.artifacts.outcomes, {
          allowReadonlyGroupWorld: true,
          maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
          label: "Outcome ledger repair publication canonical",
        })
      : null;
    archive = existsAsPath(publication.archivePath)
      ? openPublicationIdentity(
          publication.archivePath,
          publication.predecessor,
          plan.material.sourceBytes,
          "publication predecessor archive",
        )
      : null;
    replacement = existsAsPath(publication.replacement.path)
      ? openPublicationIdentity(
          publication.replacement.path,
          publication.replacement,
          plan.material.trustedBytes,
          "publication replacement temporary",
        )
      : null;
    const canonicalIsPredecessor =
      canonical !== null &&
      publicationIdentityMatches(
        canonical,
        publication.predecessor,
        plan.material.sourceBytes,
      );
    const canonicalIsReplacement =
      canonical !== null &&
      publicationIdentityMatches(
        canonical,
        publication.replacement,
        plan.material.trustedBytes,
      );
    if (
      canonical !== null &&
      !canonicalIsPredecessor &&
      !canonicalIsReplacement
    ) {
      throw new Error(
        "Outcome ledger repair publication canonical contains a foreign generation.",
      );
    }
    if (canonicalIsReplacement && archive !== null && replacement === null) {
      checkpoint("replacement-publication-recovered");
      return publication.replacement;
    }
    let predecessorAtArchive = archive;
    if (canonicalIsPredecessor && archive === null && replacement !== null) {
      beforeMutation();
      runDurableRepairMove(
        plan.artifacts.outcomes,
        publication.archivePath,
        canonical,
        plan.material.sourceBytes,
      );
      predecessorAtArchive = canonical;
      checkpoint("replacement-predecessor-archive-recovered");
    } else if (
      canonical !== null ||
      archive === null ||
      replacement === null
    ) {
      throw new Error(
        "Outcome ledger repair publication intent has an invalid recovery state.",
      );
    }
    requirePinnedRepairFile(
      publication.archivePath,
      predecessorAtArchive.descriptor,
      predecessorAtArchive.identity,
      plan.material.sourceBytes,
      { label: "Outcome ledger repair recovered predecessor archive" },
    );
    if (existsAsPath(plan.artifacts.outcomes)) {
      throw new Error(
        "Outcome ledger repair canonical reappeared during publication recovery.",
      );
    }
    beforeMutation();
    runDurableRepairMove(
      publication.replacement.path,
      plan.artifacts.outcomes,
      replacement,
      plan.material.trustedBytes,
    );
    checkpoint("replacement-publication-recovered");
    requirePinnedRepairFile(
      plan.artifacts.outcomes,
      replacement.descriptor,
      replacement.identity,
      plan.material.trustedBytes,
      { label: "Outcome ledger repair recovered canonical replacement" },
    );
    return publication.replacement;
  } finally {
    const descriptors = new Set(
      [canonical, archive, replacement]
        .filter((value) => value !== null)
        .map((value) => value.descriptor),
    );
    for (const descriptor of descriptors) closeSync(descriptor);
  }
}

function canonicalRepairEventPlan(plan) {
  const eventPlan = plan.eventPlan;
  const event = eventPlan?.event;
  if (
    stableJson(Object.keys(eventPlan ?? {}).sort()) !==
      stableJson(OUTCOME_LEDGER_REPAIR_EVENT_PLAN_KEYS) ||
    !SHA256_PATTERN.test(String(eventPlan.historyDigest ?? "")) ||
    !Number.isSafeInteger(eventPlan.historyRecordCount) ||
    eventPlan.historyRecordCount < 0 ||
    !Number.isSafeInteger(eventPlan.historySize) ||
    eventPlan.historySize < 0 ||
    eventPlan.historySize < plan.parameters.eventHistorySize ||
    !SHA256_PATTERN.test(String(eventPlan.stageNamespace ?? "")) ||
    stableJson(Object.keys(eventPlan.historyGeneration ?? {}).sort()) !==
      stableJson(OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_GENERATION_KEYS) ||
    stableJson(Object.keys(eventPlan.historyParent ?? {}).sort()) !==
      stableJson(OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_PARENT_KEYS) ||
    stableJson(Object.keys(eventPlan.replacementGeneration ?? {}).sort()) !==
      stableJson(OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_GENERATION_KEYS) ||
    stableJson(Object.keys(eventPlan.replacementParent ?? {}).sort()) !==
      stableJson(OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_PARENT_KEYS) ||
    stableJson(Object.keys(event ?? {}).sort()) !==
      stableJson(
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
    event.schemaVersion !== OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION ||
    event.eventId !== plan.eventId ||
    event.type !== OUTCOME_LEDGER_REPAIR_EVENT_TYPE ||
    event.actor !== "freed-owner" ||
    event.taskId !== plan.taskId ||
    !Number.isFinite(Date.parse(String(event.ts ?? ""))) ||
    new Date(Date.parse(event.ts)).toISOString() !== event.ts ||
    event.data?.intentDigest !== plan.intentDigest ||
    stableJson(event.data?.parameters) !== stableJson(plan.parameters)
  ) {
    throw new Error(
      "Outcome ledger repair transaction event plan is not exact and canonical.",
    );
  }
  return orderedOutcomeLedgerRepairEventPlan(eventPlan);
}

function transactionRecord(plan, phase) {
  const parameters = orderedOutcomeLedgerRepairParameters(plan.parameters);
  const { receipt } = buildReceipt({
    taskId: plan.taskId,
    operationId: plan.operationId,
    eventId: plan.eventId,
    parameters,
    artifacts: plan.artifacts,
  });
  return {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
    taskId: plan.taskId,
    operationId: plan.operationId,
    phase,
    intentDigest: plan.intentDigest,
    eventId: plan.eventId,
    eventPlan: ["fenced", "prepared"].includes(phase)
      ? null
      : canonicalRepairEventPlan(plan),
    parameters,
    receipt,
    artifacts: {
      source: plan.artifacts.sourceArtifact,
      trusted: plan.artifacts.trustedArtifact,
      rejected: plan.artifacts.rejectedArtifact,
      decisions: plan.artifacts.decisionsArtifact,
      receipt: plan.artifacts.receiptArtifact,
    },
  };
}

function transactionRecordBytes(plan, phase) {
  return Buffer.from(
    `${JSON.stringify(transactionRecord(plan, phase), null, 2)}\n`,
    "utf8",
  );
}

function transactionTransitionPaths(plan, fromPhase, toPhase) {
  const stagingDirectory = path.join(
    plan.artifacts.artifactDirectory,
    "transaction-staging",
  );
  const intentDirectory = path.join(
    plan.artifacts.artifactDirectory,
    "publication-intents",
  );
  const transitionName = `transaction-${fromPhase}-to-${toPhase}`;
  return {
    stagingDirectory,
    stagingPath: path.join(stagingDirectory, `${transitionName}.json`),
    intentDirectory,
    intentPath: path.join(intentDirectory, `${transitionName}.json`),
  };
}

function transactionTransitionIntentRecord(
  plan,
  fromPhase,
  toPhase,
  predecessor,
  successor,
  archivePath,
) {
  return {
    schemaVersion: 1,
    kind: "outcome-ledger-transaction-publication",
    operationId: plan.operationId,
    fromPhase,
    toPhase,
    targetPath: plan.artifacts.transaction,
    predecessor: canonicalPublicationIdentityRecord(predecessor),
    successor: canonicalPublicationIdentityRecord(successor),
    archivePath,
  };
}

function transactionTransitionIntentBytes(
  plan,
  fromPhase,
  toPhase,
  predecessor,
  successor,
  archivePath,
) {
  return Buffer.from(
    `${JSON.stringify(
      transactionTransitionIntentRecord(
        plan,
        fromPhase,
        toPhase,
        predecessor,
        successor,
        archivePath,
      ),
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function readTransactionTransitionIntent(plan, fromPhase, toPhase) {
  const paths = transactionTransitionPaths(plan, fromPhase, toPhase);
  if (!existsAsPath(paths.intentPath)) return null;
  const admitted = safeReadRegularFile(paths.intentPath, {
    exactMode: 0o600,
    maxBytes: 64 * 1024,
  });
  let intent;
  try {
    intent = JSON.parse(decoder.decode(admitted.bytes));
  } catch {
    throw new Error(
      "Outcome ledger repair transaction publication intent is not canonical UTF-8 JSON.",
    );
  }
  if (
    !intent ||
    typeof intent !== "object" ||
    Array.isArray(intent) ||
    stableJson(Object.keys(intent).sort()) !==
      stableJson(
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
    intent.schemaVersion !== 1 ||
    intent.kind !== "outcome-ledger-transaction-publication" ||
    intent.operationId !== plan.operationId ||
    intent.fromPhase !== fromPhase ||
    intent.toPhase !== toPhase ||
    intent.targetPath !== plan.artifacts.transaction
  ) {
    throw new Error("Outcome ledger repair transaction publication intent is invalid.");
  }
  const identityOptions = {
    maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  };
  const predecessor = requirePublicationIdentityRecord(
    intent.predecessor,
    "transaction publication predecessor",
    identityOptions,
  );
  const successor = requirePublicationIdentityRecord(
    intent.successor,
    "transaction publication successor",
    identityOptions,
  );
  const predecessorBytes = transactionRecordBytes(plan, fromPhase);
  const successorBytes = transactionRecordBytes(plan, toPhase);
  const archiveId = sha256(
    stableJson({
      operationId: plan.operationId,
      fromPhase,
      toPhase,
      predecessor,
      successor,
    }),
  );
  const expectedArchivePath = path.join(
    repairRetirementDirectory(plan),
    `transaction-${fromPhase}-predecessor-${archiveId}.archive`,
  );
  if (
    predecessor.path !== plan.artifacts.transaction ||
    predecessor.mode !== 0o600 ||
    predecessor.size !== predecessorBytes.length ||
    predecessor.digest !== sha256(predecessorBytes) ||
    successor.path !== paths.stagingPath ||
    successor.mode !== 0o600 ||
    successor.size !== successorBytes.length ||
    successor.digest !== sha256(successorBytes) ||
    intent.archivePath !== expectedArchivePath
  ) {
    throw new Error(
      "Outcome ledger repair transaction publication intent conflicts with the plan.",
    );
  }
  if (
    !admitted.bytes.equals(
      transactionTransitionIntentBytes(
        plan,
        fromPhase,
        toPhase,
        predecessor,
        successor,
        expectedArchivePath,
      ),
    )
  ) {
    throw new Error(
      "Outcome ledger repair transaction publication intent is not exact canonical JSON.",
    );
  }
  return {
    ...paths,
    archivePath: expectedArchivePath,
    predecessor,
    successor,
    predecessorBytes,
    successorBytes,
  };
}

function recoverTransactionTransition(
  plan,
  fromPhase,
  toPhase,
  { checkpoint = () => {}, beforeMutation = () => {} } = {},
) {
  const publication = readTransactionTransitionIntent(
    plan,
    fromPhase,
    toPhase,
  );
  if (publication === null) return null;
  requirePrivateDescendantDirectories(
    plan.artifacts.stateRoot,
    publication.stagingDirectory,
  );
  requirePrivateDescendantDirectories(
    plan.artifacts.stateRoot,
    publication.intentDirectory,
  );
  requirePrivateDescendantDirectories(
    plan.artifacts.stateRoot,
    path.dirname(publication.archivePath),
  );
  let canonical;
  let staging;
  let archive;
  try {
    canonical = openPinnedRepairFile(plan.artifacts.transaction, {
      exactMode: 0o600,
      maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
      label: "Outcome ledger repair transaction canonical",
    });
    if (existsAsPath(publication.stagingPath)) {
      staging = openPinnedRepairFile(publication.stagingPath, {
        exactMode: 0o600,
        maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
        label: "Outcome ledger repair transaction staging",
      });
    }
    if (existsAsPath(publication.archivePath)) {
      archive = openPublicationIdentity(
        publication.archivePath,
        publication.predecessor,
        publication.predecessorBytes,
        "transaction predecessor archive",
      );
    }
    const canonicalIsPredecessor = publicationIdentityMatches(
      canonical,
      publication.predecessor,
      publication.predecessorBytes,
    );
    const canonicalIsSuccessor = publicationIdentityMatches(
      canonical,
      publication.successor,
      publication.successorBytes,
    );
    const stagingIsPredecessor =
      staging !== undefined &&
      publicationIdentityMatches(
        staging,
        publication.predecessor,
        publication.predecessorBytes,
      );
    const stagingIsSuccessor =
      staging !== undefined &&
      publicationIdentityMatches(
        staging,
        publication.successor,
        publication.successorBytes,
      );
    let predecessorAtStaging = null;
    if (
      canonicalIsPredecessor &&
      stagingIsSuccessor &&
      archive === undefined
    ) {
      beforeMutation();
      runDurableRepairExchange(
        publication.stagingPath,
        plan.artifacts.transaction,
        staging,
        publication.successorBytes,
        canonical,
        publication.predecessorBytes,
      );
      predecessorAtStaging = canonical;
      checkpoint(`transaction-${toPhase}-exchanged`);
    } else if (
      canonicalIsSuccessor &&
      stagingIsPredecessor &&
      archive === undefined
    ) {
      predecessorAtStaging = staging;
    } else if (
      canonicalIsSuccessor &&
      staging === undefined &&
      archive !== undefined
    ) {
      checkpoint(`transaction-${toPhase}-publication-recovered`);
      return transactionRecord(plan, toPhase);
    } else {
      throw new Error(
        "Outcome ledger repair transaction publication has an invalid recovery state.",
      );
    }
    beforeMutation();
    runDurableRepairMove(
      publication.stagingPath,
      publication.archivePath,
      predecessorAtStaging,
      publication.predecessorBytes,
    );
    checkpoint(`transaction-${toPhase}-predecessor-archived`);
    requirePinnedRepairFile(
      publication.archivePath,
      predecessorAtStaging.descriptor,
      predecessorAtStaging.identity,
      publication.predecessorBytes,
      { label: "Outcome ledger repair transaction predecessor archive" },
    );
    checkpoint(`transaction-${toPhase}-publication-recovered`);
    return transactionRecord(plan, toPhase);
  } finally {
    const descriptors = new Set(
      [canonical, staging, archive]
        .filter((value) => value !== undefined)
        .map((value) => value.descriptor),
    );
    for (const descriptor of descriptors) closeSync(descriptor);
  }
}

function canonicalTransactionRecord(plan) {
  const admitted = safeReadRegularFile(plan.artifacts.transaction, {
    exactMode: 0o600,
    maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  });
  let record;
  try {
    record = JSON.parse(decoder.decode(admitted.bytes));
  } catch {
    throw new Error("Outcome ledger repair canonical transaction is invalid JSON.");
  }
  if (
    !TRANSACTION_PHASES.has(record?.phase) ||
    !admitted.bytes.equals(transactionRecordBytes(plan, record.phase))
  ) {
    throw new Error("Outcome ledger repair canonical transaction changed.");
  }
  return transactionRecord(plan, record.phase);
}

function recoverTransactionPublications(
  plan,
  { checkpoint = () => {}, beforeMutation = () => {} } = {},
) {
  let record = canonicalTransactionRecord(plan);
  for (let attempt = 0; attempt <= TRANSACTION_TRANSITIONS.length; attempt += 1) {
    const previous = TRANSACTION_TRANSITIONS.find(
      ([, toPhase]) => toPhase === record.phase,
    );
    if (
      previous !== undefined &&
      readTransactionTransitionIntent(plan, ...previous) !== null
    ) {
      recoverTransactionTransition(plan, ...previous, {
        checkpoint,
        beforeMutation,
      });
      record = canonicalTransactionRecord(plan);
    }
    const next = TRANSACTION_TRANSITIONS.find(
      ([fromPhase]) => fromPhase === record.phase,
    );
    if (
      next === undefined ||
      readTransactionTransitionIntent(plan, ...next) === null
    ) {
      return record;
    }
    record = recoverTransactionTransition(plan, ...next, {
      checkpoint,
      beforeMutation,
    });
  }
  throw new Error("Outcome ledger repair transaction publication did not converge.");
}

function publishTransactionPhase(
  plan,
  toPhase,
  { checkpoint = () => {}, beforeMutation = () => {} } = {},
) {
  let current = recoverTransactionPublications(plan, {
    checkpoint,
    beforeMutation,
  });
  if (current.phase === toPhase) return current;
  const transition = TRANSACTION_TRANSITIONS.find(
    ([fromPhase, nextPhase]) =>
      fromPhase === current.phase && nextPhase === toPhase,
  );
  if (transition === undefined) {
    throw new Error(
      `Outcome ledger repair transaction cannot advance from ${current.phase} to ${toPhase}.`,
    );
  }
  const [fromPhase] = transition;
  const paths = transactionTransitionPaths(plan, fromPhase, toPhase);
  const retirementDirectory = repairRetirementDirectory(plan);
  requirePrivateDescendantDirectories(
    plan.artifacts.stateRoot,
    paths.stagingDirectory,
    { create: true, beforeMutation },
  );
  checkpoint(`transaction-${toPhase}-staging-directory-durable`);
  requirePrivateDescendantDirectories(
    plan.artifacts.stateRoot,
    paths.intentDirectory,
    { create: true, beforeMutation },
  );
  checkpoint(`transaction-${toPhase}-intent-directory-durable`);
  requirePrivateDescendantDirectories(
    plan.artifacts.stateRoot,
    retirementDirectory,
    { create: true, beforeMutation },
  );
  checkpoint(`transaction-${toPhase}-retired-directory-durable`);
  const successorBytes = transactionRecordBytes(plan, toPhase);
  const publicationOptions = {
    beforePublish: beforeMutation,
    retirementDirectory,
    stateRoot: plan.artifacts.stateRoot,
  };
  writeImmutable(paths.stagingPath, successorBytes, {
    ...publicationOptions,
    partialCheckpoint: () => {
      checkpoint(`transaction-${toPhase}-staging-partial`);
      beforeMutation();
    },
  });
  checkpoint(`transaction-${toPhase}-staging-durable`);
  let predecessor;
  let successor;
  try {
    predecessor = openPinnedRepairFile(plan.artifacts.transaction, {
      exactMode: 0o600,
      maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
      label: "Outcome ledger repair transaction predecessor",
    });
    successor = openPinnedRepairFile(paths.stagingPath, {
      exactMode: 0o600,
      maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
      label: "Outcome ledger repair transaction successor",
    });
    const predecessorBytes = transactionRecordBytes(plan, fromPhase);
    if (!predecessor.bytes.equals(predecessorBytes)) {
      throw new Error("Outcome ledger repair transaction predecessor drifted.");
    }
    const predecessorIdentity = publicationFileIdentity(
      plan.artifacts.transaction,
      predecessor.identity,
      predecessorBytes,
    );
    const successorIdentity = publicationFileIdentity(
      paths.stagingPath,
      successor.identity,
      successorBytes,
    );
    const archiveId = sha256(
      stableJson({
        operationId: plan.operationId,
        fromPhase,
        toPhase,
        predecessor: predecessorIdentity,
        successor: successorIdentity,
      }),
    );
    const archivePath = path.join(
      retirementDirectory,
      `transaction-${fromPhase}-predecessor-${archiveId}.archive`,
    );
    writeImmutable(
      paths.intentPath,
      transactionTransitionIntentBytes(
        plan,
        fromPhase,
        toPhase,
        predecessorIdentity,
        successorIdentity,
        archivePath,
      ),
      {
        beforePublish: beforeMutation,
        partialCheckpoint: () => {
          checkpoint(`transaction-${toPhase}-intent-partial`);
          beforeMutation();
        },
        ...publicationOptions,
      },
    );
    checkpoint(`transaction-${toPhase}-intent-durable`);
  } finally {
    if (successor !== undefined) closeSync(successor.descriptor);
    if (predecessor !== undefined) closeSync(predecessor.descriptor);
  }
  current = recoverTransactionPublications(plan, {
    checkpoint,
    beforeMutation,
  });
  if (current.phase !== toPhase) {
    throw new Error("Outcome ledger repair transaction phase did not advance.");
  }
  return current;
}

function writeRepairFence(
  plan,
  checkpoint,
  reauthorize,
  {
    authorityContext,
    actor,
    leaseName,
    leaseToken,
    writerGuardContext,
  },
) {
  withOutcomeLedgerRepairFenceCreationGuard(
    {
      stateRoot: plan.artifacts.stateRoot,
      authorityContext,
      actor,
      leaseName,
      leaseToken,
      taskId: plan.taskId,
      taskRevision: plan.task.revision,
      taskState: plan.task.state,
      parameters: plan.parameters,
      transactionPath: plan.artifacts.transaction,
      writerGuardContext,
    },
    ({ beforeFenceMutation }) => {
      const beforeMutation = () => {
        reauthorize();
        beforeFenceMutation();
      };
      beforeMutation();
      requirePrivateDescendantDirectories(
        plan.artifacts.stateRoot,
        plan.artifacts.transactionDirectory,
        { create: true, beforeMutation },
      );
      writeJsonAtomic(
        plan.artifacts.transaction,
        transactionRecord(plan, "fenced"),
        {
          beforeRename: () => {
            checkpoint("transaction-fenced-before-rename");
            beforeMutation();
          },
          stateRoot: plan.artifacts.stateRoot,
        },
      );
      checkpoint("transaction-fenced");
    },
  );
}

function writePreparedArtifacts(
  plan,
  checkpoint,
  reauthorize,
  writerGuardContext,
) {
  const retirementDirectory = repairRetirementDirectory(plan);
  const publicationOptions = {
    retirementDirectory,
    stateRoot: plan.artifacts.stateRoot,
  };
  reauthorize();
  preflightRepairTemporaryFiles(plan, { fencedRecovery: true });
  requirePrivateDescendantDirectories(
    plan.artifacts.stateRoot,
    plan.artifacts.artifactDirectory,
    { create: true, beforeMutation: reauthorize },
  );
  reauthorize();
  writeImmutable(plan.artifacts.sourceArtifact, plan.material.sourceBytes, {
    beforePublish: () => {
      checkpoint("source-before-publish");
      reauthorize();
    },
    ...publicationOptions,
  });
  checkpoint("source-archived");
  reauthorize();
  writeImmutable(
    plan.artifacts.trustedArtifact,
    plan.material.trustedBytes,
    { beforePublish: reauthorize, ...publicationOptions },
  );
  checkpoint("trusted-archived");
  reauthorize();
  writeImmutable(
    plan.artifacts.rejectedArtifact,
    plan.material.rejectedBytes,
    { beforePublish: reauthorize, ...publicationOptions },
  );
  checkpoint("rejected-archived");
  reauthorize();
  writeImmutable(
    plan.artifacts.decisionsArtifact,
    plan.material.decisionBytes,
    { beforePublish: reauthorize, ...publicationOptions },
  );
  checkpoint("decisions-archived");
  reauthorize();
  preflightRepairTemporaryFiles(plan, { fencedRecovery: true });
  cleanupRepairTemporaryFiles(plan, checkpoint, reauthorize);
  checkpoint("prepared-temporaries-retired");
  reauthorize();
  const revalidatedPlan = classifyCurrentLedger({
    stateRoot: plan.artifacts.stateRoot,
    taskId: plan.taskId,
    expectedSourceDigest: plan.parameters.sourceDigest,
    eventHistoryPrefixDigest: plan.parameters.eventHistoryDigest,
    eventHistoryPrefixSize: plan.parameters.eventHistorySize,
    allowedPendingOperationId: plan.operationId,
    writerGuardContext,
  });
  if (
    !exactParametersEqual(revalidatedPlan.parameters, plan.parameters) ||
    revalidatedPlan.intentDigest !== plan.intentDigest ||
    !exactClassifiedMaterialEqual(revalidatedPlan.material, plan.material)
  ) {
    throw new Error(
      "Fenced outcome ledger repair changed before prepared publication.",
    );
  }
  reauthorize();
  const transaction = publishTransactionPhase(plan, "prepared", {
    checkpoint,
    beforeMutation: reauthorize,
  });
  if (transaction.phase !== "prepared") {
    throw new Error("Outcome ledger repair transaction did not prepare.");
  }
  checkpoint("transaction-prepared");
  reauthorize();
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
  const sourceBytes = safeReadImmutableRepairArtifact(paths.sourceArtifact, {
    exactMode: 0o600,
  }).bytes;
  const trustedBytes = safeReadImmutableRepairArtifact(paths.trustedArtifact, {
    exactMode: 0o600,
  }).bytes;
  const rejectedBytes = safeReadImmutableRepairArtifact(paths.rejectedArtifact, {
    exactMode: 0o600,
  }).bytes;
  const decisionBytes = safeReadImmutableRepairArtifact(paths.decisionsArtifact, {
    exactMode: 0o600,
    maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  }).bytes;
  validateOutcomeLedgerRepairArchivedMaterialBytes({
    taskId: record.taskId,
    parameters,
    sourceBytes,
    trustedBytes,
    rejectedBytes,
    decisionBytes,
  });
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
  for (const entry of readBoundedDirectoryEntries(directory, {
    maxEntries: REPAIR_DIRECTORY_MAX_ENTRIES,
    label: "Outcome ledger repair transaction directory",
  })) {
    const filePath = path.join(directory, entry.name);
    if (
      entry.name === ".authority-retirements" &&
      entry.isDirectory()
    ) {
      requirePrivateDirectory(filePath);
      continue;
    }
    if (
      new RegExp(
        `^\\.(?:[0-9a-f]{64}|pending)\\.json\\.(?:\\d+|[0-9a-f]{64})\\.tmp${QUARANTINE_SUFFIX_PATTERN}$`,
      ).test(entry.name)
    ) {
      safeReadRegularFile(filePath, {
        exactMode: 0o600,
        maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
      });
      continue;
    }
    const isPending = entry.name === "pending.json";
    const completedMatch = /^([0-9a-f]{64})\.json$/.exec(entry.name);
    if (!entry.isFile() || (!isPending && completedMatch === null)) {
      throw new Error(
        `Unexpected outcome ledger transaction entry: ${entry.name}`,
      );
    }
    const admitted = safeReadRegularFile(filePath, {
      exactMode: 0o600,
      maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
    });
    let record;
    try {
      record = JSON.parse(decoder.decode(admitted.bytes));
    } catch {
      throw new Error(
        `Invalid outcome ledger transaction JSON: ${entry.name}`,
      );
    }
    if (
      record?.schemaVersion !== OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION ||
      record?.policy !== OUTCOME_LEDGER_REPAIR_POLICY ||
      !TRANSACTION_PHASES.has(record?.phase) ||
      typeof record?.taskId !== "string" ||
      (!isPending && record?.operationId !== completedMatch[1]) ||
      (!isPending && record?.phase !== "complete") ||
      stableJson(Object.keys(record).sort()) !==
        stableJson(OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS)
    ) {
      throw new Error(
        `Invalid outcome ledger transaction identity: ${entry.name}`,
      );
    }
    requireTaskId(record.taskId);
    const parameters = validateRepairParameters(record.parameters, {
      stateRoot,
      taskId: record.taskId,
    });
    const expectedPaths = repairPaths(
      stateRoot,
      record.taskId,
      record.operationId,
      parameters.sourceDigest,
    );
    const expectedReceiptResult = buildReceipt({
      taskId: record.taskId,
      operationId: record.operationId,
      eventId: record.eventId,
      parameters: orderedOutcomeLedgerRepairParameters(parameters),
      artifacts: expectedPaths,
    });
    const expectedReceipt = expectedReceiptResult.receipt;
    const expectedIntent = {
      schemaVersion: 1,
      action: OUTCOME_LEDGER_REPAIR_ACTION,
      taskId: record.taskId,
      parameters: orderedOutcomeLedgerRepairParameters(parameters),
    };
    const canonicalPlan = {
      taskId: record.taskId,
      operationId: record.operationId,
      eventId: record.eventId,
      eventPlan: record.eventPlan,
      intentDigest: record.intentDigest,
      parameters,
      artifacts: expectedPaths,
      receipt: expectedReceipt,
    };
    if (
      filePath !==
        (isPending
          ? expectedPaths.transaction
          : expectedPaths.completedTransaction) ||
      record.operationId !== parameters.operationId ||
      record.eventId !== outcomeLedgerRepairEventId(record.operationId) ||
      expectedReceiptResult.receiptDigest !== parameters.receiptDigest ||
      record.intentDigest !== ownerGovernanceIntentDigest(expectedIntent) ||
      !admitted.bytes.equals(
        transactionRecordBytes(canonicalPlan, record.phase),
      )
    ) {
      throw new Error(
        `Outcome ledger transaction is not exact canonical JSON: ${entry.name}`,
      );
    }
    record = transactionRecord(canonicalPlan, record.phase);
    if (
      record?.taskId === taskId &&
      record?.parameters?.sourceDigest === sourceDigest
    ) {
      matches.push({ filePath, record });
    } else if (isPending) {
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

function matchRepairTemporaryCandidate(candidate, entry) {
  return candidate.matchName?.(entry) ?? candidate.pattern?.exec(entry) ?? null;
}

function removeOwnedRepairTemps(
  directory,
  candidates,
  maxBytes,
  checkpoint = () => {},
  {
    retirementDirectory,
    stateRoot,
    plan,
    beforeMutation = () => {},
  } = {},
) {
  if (!existsAsPath(directory)) return;
  const pinnedDirectory = openPinnedRepairDirectory(
    directory,
    "Outcome ledger repair temporary directory",
  );
  let changed = false;
  try {
    const entries = listPinnedRepairDirectory(directory, pinnedDirectory, {
      maxEntries: REPAIR_DIRECTORY_MAX_ENTRIES,
      label: "Outcome ledger repair temporary directory",
    });
    for (const entry of entries) {
      let candidate = null;
      let candidateMatch = null;
      for (const current of candidates) {
        const match = matchRepairTemporaryCandidate(current, entry);
        if (match !== null) {
          candidate = current;
          candidateMatch = match;
          break;
        }
      }
      if (candidate === null) continue;
      if (
        SHA256_PATTERN.test(candidateMatch[1]) &&
        !candidate.allowedGenerationDigests.includes(candidateMatch[1])
      ) {
        throw new Error(
          `Outcome ledger repair temp has a foreign deterministic namespace: ${path.join(directory, entry)}`,
        );
      }
      requirePinnedRepairDirectory(
        directory,
        pinnedDirectory,
        "Outcome ledger repair temporary directory",
      );
      const filePath = path.join(directory, entry);
      const temporaryStats = lstatSync(filePath);
      if (temporaryStats.nlink !== 1) {
        throw new Error(
          `Outcome ledger repair refuses a hard-linked temporary artifact: ${filePath}`,
        );
      }
      const pinned = openPinnedRepairFile(filePath, {
        expectedLinkCount: 1,
        exactMode: 0o600,
        maxBytes,
        label: "Outcome ledger repair cleanup temporary",
      });
      const expectedOptions = candidate.expectedBytes.map((bytes) =>
        Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
      );
      try {
        requirePinnedRepairDirectory(
          directory,
          pinnedDirectory,
          "Outcome ledger repair temporary directory",
        );
        if (
          !expectedOptions.some(
            (expected) =>
              pinned.bytes.length <= expected.length &&
              expected.subarray(0, pinned.bytes.length).equals(pinned.bytes),
          )
        ) {
          throw new Error(
            `Outcome ledger repair temp has foreign bytes: ${filePath}`,
          );
        }
        const recoverableDeterministicBytes =
          candidate.recoverDeterministicImmutable === true &&
          !existsAsPath(candidate.finalPath)
            ? expectedOptions.find(
                (expected) =>
                  pinned.bytes.equals(expected) &&
                  immutableRepairTemporaryPath(candidate.finalPath, expected) ===
                    filePath,
              )
            : undefined;
        if (recoverableDeterministicBytes !== undefined) continue;
        quarantinePinnedRepairTemporary(
          filePath,
          pinned.descriptor,
          pinned.identity,
          pinned.bytes,
          {
            checkpoint,
            checkpointName: "repair-temp-cleanup",
            retirementDirectory,
            stateRoot,
            plan,
            beforeMutation,
            sourceDirectory: pinnedDirectory,
            retirementLineage:
              candidate.retirementClass === undefined
                ? null
                : {
                    operationId: plan.operationId,
                    sourceClass: candidate.retirementClass,
                    targetPath: candidate.finalPath,
                    generation: candidateMatch[1],
                    quarantineSuffixDigest: sha256(
                      candidateMatch[2] ?? "",
                    ),
                  },
          },
        );
        changed = true;
      } finally {
        closeSync(pinned.descriptor);
      }
    }
    if (changed) {
      requirePinnedRepairDirectory(
        directory,
        pinnedDirectory,
        "Outcome ledger repair temporary directory",
      );
      fsyncSync(pinnedDirectory.descriptor);
      requirePinnedRepairDirectory(
        directory,
        pinnedDirectory,
        "Outcome ledger repair temporary directory",
      );
    }
  } finally {
    closeSync(pinnedDirectory.descriptor);
  }
}

function repairTemporaryCleanupGroups(plan) {
  const { artifacts: paths } = plan;
  const transactionTempPattern = new RegExp(
    `^\\.${escapeRegularExpression(path.basename(paths.transaction))}\\.([0-9]{1,20}|[0-9a-f]{64})\\.tmp(${QUARANTINE_SUFFIX_PATTERN})$`,
  );
  const transactionPhases =
    plan.eventPlan === null || plan.eventPlan === undefined
      ? ["fenced", "prepared"]
      : [...TRANSACTION_PHASES];
  const transactionBytes = transactionPhases.map((phase) =>
    Buffer.from(
      `${JSON.stringify(transactionRecord(plan, phase), null, 2)}\n`,
      "utf8",
    ),
  );
  const transactionCandidates = [
      {
        pattern: transactionTempPattern,
        expectedBytes: transactionBytes,
        finalPath: paths.transaction,
        recoverDeterministicImmutable: true,
        retirementClass: "transaction",
        allowedGenerationDigests: transactionBytes.map((bytes) => sha256(bytes)),
        allowedBeforeFirstFence: true,
      },
    ];
  const artifactCandidates = [
    [paths.sourceArtifact, plan.material.sourceBytes],
    [paths.trustedArtifact, plan.material.trustedBytes],
    [paths.rejectedArtifact, plan.material.rejectedBytes],
    [paths.decisionsArtifact, plan.material.decisionBytes],
    [paths.receiptArtifact, plan.material.receiptBytes],
  ].map(([filePath, expectedBytes]) => ({
    pattern: new RegExp(
      `^\\.${escapeRegularExpression(path.basename(filePath))}\\.([0-9]{1,20}|[0-9a-f]{64})\\.tmp(${QUARANTINE_SUFFIX_PATTERN})$`,
    ),
    expectedBytes: [expectedBytes],
    finalPath: filePath,
    recoverDeterministicImmutable: true,
    retirementClass:
      filePath === paths.sourceArtifact
        ? "source"
        : filePath === paths.trustedArtifact
          ? "trusted"
          : filePath === paths.rejectedArtifact
            ? "rejected"
            : filePath === paths.decisionsArtifact
              ? "decisions"
              : "receipt",
    allowedGenerationDigests: [sha256(expectedBytes)],
    allowedBeforeFirstFence: filePath !== paths.receiptArtifact,
  }));
  const replacementCandidates = [
      {
        matchName(entry) {
          const parsed = parseOutcomeLedgerRepairReplacementTemporaryName(
            entry,
            {
              ledgerBasename: path.basename(paths.outcomes),
              operationId: plan.operationId,
            },
          );
          return parsed === null
            ? null
            : [entry, parsed.generation, parsed.quarantineSuffix];
        },
        expectedBytes: [plan.material.trustedBytes],
        finalPath: paths.outcomes,
        retirementClass: "replacement",
        allowedGenerationDigests: [plan.parameters.replacementDigest],
        allowedBeforeFirstFence: true,
      },
    ];
  return [
    {
      directory: paths.transactionDirectory,
      candidates: transactionCandidates,
    },
    { directory: paths.artifactDirectory, candidates: artifactCandidates },
    { directory: paths.stateRoot, candidates: replacementCandidates },
  ];
}

function preflightOwnedRepairTemps(
  directory,
  candidates,
  maxBytes,
  {
    rejectUnmatched = false,
    beforeFirstFence = false,
    fencedRecovery = false,
    allowedUnmatchedFiles = new Map(),
    allowedUnmatchedDirectories = new Set(),
  } = {},
) {
  if (!existsAsPath(directory)) return;
  const pinnedDirectory = openPinnedRepairDirectory(
    directory,
    "Outcome ledger repair temporary preflight directory",
  );
  try {
    const entries = listPinnedRepairDirectory(directory, pinnedDirectory, {
      maxEntries: REPAIR_DIRECTORY_MAX_ENTRIES,
      label: "Outcome ledger repair temporary preflight directory",
    });
    const completeAllowedFileSet = [...allowedUnmatchedFiles.keys()].every(
      (name) => entries.includes(name),
    );
    for (const entry of entries) {
      let candidate = null;
      let candidateMatch = null;
      for (const current of candidates) {
        const match = matchRepairTemporaryCandidate(current, entry);
        if (match !== null) {
          candidate = current;
          candidateMatch = match;
          break;
        }
      }
      if (candidate === null) {
        const allowedFileBytes = allowedUnmatchedFiles.get(entry);
        if (allowedFileBytes !== undefined) {
          const filePath = path.join(directory, entry);
          const pinned = openPinnedRepairFile(filePath, {
            expectedLinkCount: 1,
            exactMode: 0o600,
            maxBytes,
            label: "Outcome ledger repair fenced final",
          });
          try {
            if (!pinned.bytes.equals(allowedFileBytes)) {
              throw new Error(
                `Outcome ledger repair fenced final has foreign bytes: ${filePath}`,
              );
            }
          } finally {
            closeSync(pinned.descriptor);
          }
          continue;
        }
        if (allowedUnmatchedDirectories.has(entry)) {
          if (!completeAllowedFileSet) {
            throw new Error(
              `Outcome ledger repair fenced recovery has a premature directory: ${path.join(directory, entry)}`,
            );
          }
          const child = openPinnedRepairDirectory(
            path.join(directory, entry),
            "Outcome ledger repair fenced child directory",
          );
          closeSync(child.descriptor);
          continue;
        }
        if (rejectUnmatched) {
          throw new Error(
            `Outcome ledger repair operation directory has a foreign entry: ${path.join(directory, entry)}`,
          );
        }
        continue;
      }
      if (beforeFirstFence && candidate.allowedBeforeFirstFence !== true) {
        throw new Error(
          `Outcome ledger repair operation directory has a premature entry: ${path.join(directory, entry)}`,
        );
      }
      if (fencedRecovery && candidate.allowedBeforeFirstFence !== true) {
        throw new Error(
          `Outcome ledger repair fenced recovery has a premature entry: ${path.join(directory, entry)}`,
        );
      }
      const generation = candidateMatch[1];
      if (
        SHA256_PATTERN.test(generation) &&
        !candidate.allowedGenerationDigests.includes(generation)
      ) {
        throw new Error(
          `Outcome ledger repair temp has a foreign deterministic namespace: ${path.join(directory, entry)}`,
        );
      }
      requirePinnedRepairDirectory(
        directory,
        pinnedDirectory,
        "Outcome ledger repair temporary preflight directory",
      );
      const filePath = path.join(directory, entry);
      const pinned = openPinnedRepairFile(filePath, {
        expectedLinkCount: 1,
        exactMode: 0o600,
        maxBytes,
        label: "Outcome ledger repair cleanup temporary preflight",
      });
      try {
        const expectedOptions = candidate.expectedBytes.map((bytes) =>
          Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
        );
        if (
          !expectedOptions.some(
            (expected) =>
              pinned.bytes.length <= expected.length &&
              expected.subarray(0, pinned.bytes.length).equals(pinned.bytes),
          )
        ) {
          throw new Error(
            `Outcome ledger repair temp has foreign bytes: ${filePath}`,
          );
        }
      } finally {
        closeSync(pinned.descriptor);
      }
    }
    requirePinnedRepairDirectory(
      directory,
      pinnedDirectory,
      "Outcome ledger repair temporary preflight directory",
    );
  } finally {
    closeSync(pinnedDirectory.descriptor);
  }
}

function preflightRepairTemporaryFiles(
  plan,
  { beforeFirstFence = false, fencedRecovery = false } = {},
) {
  const fencedArtifactFiles = new Map([
    [
      path.basename(plan.artifacts.sourceArtifact),
      plan.material.sourceBytes,
    ],
    [
      path.basename(plan.artifacts.trustedArtifact),
      plan.material.trustedBytes,
    ],
    [
      path.basename(plan.artifacts.rejectedArtifact),
      plan.material.rejectedBytes,
    ],
    [
      path.basename(plan.artifacts.decisionsArtifact),
      plan.material.decisionBytes,
    ],
  ]);
  const fencedArtifactDirectories = new Set([
    "publication-intents",
    "retired",
    "transaction-staging",
  ]);
  for (const group of repairTemporaryCleanupGroups(plan)) {
    const operationArtifactDirectory =
      group.directory === plan.artifacts.artifactDirectory;
    preflightOwnedRepairTemps(
      group.directory,
      group.candidates,
      OUTCOME_LEDGER_REPAIR_MAX_BYTES,
      {
        beforeFirstFence,
        fencedRecovery,
        rejectUnmatched:
          operationArtifactDirectory && (beforeFirstFence || fencedRecovery),
        allowedUnmatchedFiles:
          fencedRecovery && operationArtifactDirectory
            ? fencedArtifactFiles
            : new Map(),
        allowedUnmatchedDirectories:
          fencedRecovery && operationArtifactDirectory
            ? fencedArtifactDirectories
            : new Set(),
      },
    );
  }
}

function cleanupRepairTemporaryFiles(
  plan,
  checkpoint = () => {},
  beforeMutation = () => {},
) {
  const cleanupOptions = {
    retirementDirectory: repairRetirementDirectory(plan),
    stateRoot: plan.artifacts.stateRoot,
    plan,
    beforeMutation,
  };
  const groups = repairTemporaryCleanupGroups(plan);
  for (const group of groups) {
    preflightOwnedRepairTemps(
      group.directory,
      group.candidates,
      OUTCOME_LEDGER_REPAIR_MAX_BYTES,
    );
  }
  for (const group of groups) {
    removeOwnedRepairTemps(
      group.directory,
      group.candidates,
      OUTCOME_LEDGER_REPAIR_MAX_BYTES,
      checkpoint,
      cleanupOptions,
    );
  }
}

function repairReplacementTemporaryCleanupGroup(plan) {
  const group = repairTemporaryCleanupGroups(plan).find(
    (candidate) => candidate.directory === plan.artifacts.stateRoot,
  );
  if (group === undefined) {
    throw new Error(
      "Outcome ledger repair replacement cleanup contract is missing.",
    );
  }
  return group;
}

function hasActionableRepairReplacementTemporary(plan) {
  const group = repairReplacementTemporaryCleanupGroup(plan);
  const pinnedDirectory = openPinnedRepairDirectory(
    group.directory,
    "Outcome ledger repair replacement temporary inventory",
  );
  try {
    const deterministicName =
      `${path.basename(plan.artifacts.outcomes)}.${plan.operationId}.` +
      `${plan.parameters.replacementDigest}.repair.tmp`;
    const entries = listPinnedRepairDirectory(
      group.directory,
      pinnedDirectory,
      {
        maxEntries: REPAIR_DIRECTORY_MAX_ENTRIES,
        label: "Outcome ledger repair replacement temporary inventory",
      },
    );
    const actionable = entries.some(
      (entry) =>
        entry !== deterministicName &&
        group.candidates.some(
          (candidate) =>
            matchRepairTemporaryCandidate(candidate, entry) !== null,
        ),
    );
    requirePinnedRepairDirectory(
      group.directory,
      pinnedDirectory,
      "Outcome ledger repair replacement temporary inventory",
    );
    return actionable;
  } finally {
    closeSync(pinnedDirectory.descriptor);
  }
}

function cleanupRepairReplacementTemporaryFiles(
  plan,
  checkpoint = () => {},
  beforeMutation = () => {},
) {
  const group = repairReplacementTemporaryCleanupGroup(plan);
  const cleanupOptions = {
    retirementDirectory: repairRetirementDirectory(plan),
    stateRoot: plan.artifacts.stateRoot,
    plan,
    beforeMutation,
  };
  preflightOwnedRepairTemps(
    group.directory,
    group.candidates,
    OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  );
  removeOwnedRepairTemps(
    group.directory,
    group.candidates,
    OUTCOME_LEDGER_REPAIR_MAX_BYTES,
    checkpoint,
    cleanupOptions,
  );
}

function recoverPlanFromTransaction({
  stateRoot,
  taskId,
  sourceDigest,
  writerGuardContext = null,
}) {
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
  if (record.phase !== "fenced") {
    requirePrivateDescendantDirectories(
      expectedPaths.stateRoot,
      expectedPaths.artifactDirectory,
    );
  }
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
    (["fenced", "prepared"].includes(record.phase)
      ? record.eventPlan !== null
      : record.eventPlan === null) ||
    filePath !==
      (path.basename(filePath) === "pending.json"
        ? expectedPaths.transaction
        : expectedPaths.completedTransaction) ||
    record.artifacts?.source !== expectedPaths.sourceArtifact ||
    record.artifacts?.trusted !== expectedPaths.trustedArtifact ||
    record.artifacts?.rejected !== expectedPaths.rejectedArtifact ||
    record.artifacts?.decisions !== expectedPaths.decisionsArtifact ||
    record.artifacts?.receipt !== expectedPaths.receiptArtifact
  ) {
    throw new Error("Outcome ledger repair transaction has conflicting identity.");
  }
  if (record.phase === "fenced") {
    const classified = classifyCurrentLedger({
      stateRoot,
      taskId,
      expectedSourceDigest: sourceDigest,
      eventHistoryPrefixDigest: parameters.eventHistoryDigest,
      eventHistoryPrefixSize: parameters.eventHistorySize,
      allowedPendingOperationId: record.operationId,
      writerGuardContext,
      allowExactFencedLegacyTemps: true,
    });
    if (
      !exactParametersEqual(classified.parameters, parameters) ||
      classified.intentDigest !== record.intentDigest
    ) {
      throw new Error(
        "Fenced outcome ledger repair no longer matches exact reclassification.",
      );
    }
    return { ...classified, transaction: record };
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
    const existingReceipt = safeReadImmutableRepairArtifact(
      expectedPaths.receiptArtifact,
      { exactMode: 0o600 },
    ).bytes;
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
    eventPlan: record.eventPlan,
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

function retireCompletedRepairTransaction(
  plan,
  checkpoint,
  beforeMutation,
  {
    authorityContext,
    actor,
    leaseName,
    leaseToken,
    writerGuardContext,
  },
) {
  const sourcePath = plan.artifacts.transaction;
  const targetPath = plan.artifacts.completedTransaction;
  if (!existsAsPath(sourcePath)) {
    const completed = safeReadRegularFile(targetPath, {
      exactMode: 0o600,
      maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
    });
    if (!completed.bytes.equals(transactionRecordBytes(plan, "complete"))) {
      throw new Error("Completed outcome ledger repair transaction changed.");
    }
    return;
  }
  if (existsAsPath(targetPath)) {
    throw new Error(
      "Outcome ledger repair has both pending and completed transaction records.",
    );
  }
  withOutcomeLedgerRepairRetirementGuard(
    {
      stateRoot: plan.artifacts.stateRoot,
      authorityContext,
      actor,
      leaseName,
      leaseToken,
      taskId: plan.taskId,
      parameters: plan.parameters,
      transactionPath: sourcePath,
      writerGuardContext,
    },
    ({ beforeRetirementMutation }) => {
      const expectedBytes = transactionRecordBytes(plan, "complete");
      const source = openPinnedRepairFile(sourcePath, {
        exactMode: 0o600,
        maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
        label: "Complete pending outcome ledger repair transaction",
      });
      try {
        if (!source.bytes.equals(expectedBytes)) {
          throw new Error(
            "Pending outcome ledger repair transaction is not complete.",
          );
        }
        checkpoint("transaction-retirement-before-rename");
        beforeMutation();
        beforeRetirementMutation();
        runDurableRepairMove(
          sourcePath,
          targetPath,
          { descriptor: source.descriptor, identity: source.identity },
          expectedBytes,
        );
        checkpoint("transaction-retired");
      } finally {
        closeSync(source.descriptor);
      }
    },
  );
}

function verifyCompletedRepair(
  plan,
  {
    requireComplete = true,
    expectedPendingPhase = "audited",
    writerGuardContext = null,
    planningBundle = null,
  } = {},
) {
  if (planningBundle === null) {
    withAutomationPlanningReadBundle(
      {
        stateRoot: plan.parameters.stateRoot,
        ledgerPath: plan.artifacts.outcomes,
        writerGuardContext,
      },
      (bundle) => {
        verifyCompletedRepair(plan, {
          requireComplete,
          expectedPendingPhase,
          writerGuardContext,
          planningBundle: bundle,
        });
        return null;
      },
    );
    return;
  }
  const current = {
    bytes: Buffer.from(planningBundle.outcomeLedger.text, "utf8"),
  };
  if (
    plan.material.trustedBytes.length > 0 &&
    !current.bytes.subarray(0, plan.material.trustedBytes.length).equals(
      plan.material.trustedBytes,
    )
  ) {
    throw new Error("Canonical outcomes no longer preserve retained trusted lines.");
  }
  const events = {
    bytes: Buffer.from(planningBundle.controlEventHistory.text, "utf8"),
    size: planningBundle.controlEventHistory.size,
  };
  if (
    events.size < plan.parameters.eventHistorySize ||
    sha256(events.bytes.subarray(0, plan.parameters.eventHistorySize)) !==
      plan.parameters.eventHistoryDigest
  ) {
    throw new Error("Completed outcome ledger repair event prefix drifted.");
  }
  const eventHistory = planningBundle.controlEvents;
  const repairEvents = eventHistory.filter(
    (event) => event?.eventId === plan.eventId,
  );
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
    eventHistory,
  });
  const summary = summarizeOutcomeLedger(plan.artifacts.outcomes, {
    stateRoot: plan.parameters.stateRoot,
    allowedPendingRepairOperationId: requireComplete
      ? null
      : plan.operationId,
    planningBundle,
  });
  const pendingRepairs = summary.sourceHealth.pendingOutcomeLedgerRepairs;
  const pendingStateValid = requireComplete
    ? pendingRepairs.length === 0
    : pendingRepairs.length === 1 &&
      pendingRepairs[0].operationId === plan.operationId &&
      pendingRepairs[0].phase === expectedPendingPhase;
  if (
    !summary.sourceHealth.ledgerSyntaxHealthy ||
    !summary.sourceHealth.ledgerPhysicalBoundaryHealthy ||
    !summary.sourceHealth.controlEventsHealthy ||
    !summary.sourceHealth.pinnedLegacyOutcomeBundlesHealthy ||
    !summary.sourceHealth.outcomeLedgerTransactionsHealthy ||
    !pendingStateValid ||
    (requireComplete && !summary.sourceHealth.ledgerHealthy) ||
    summary.rejectedEntries.length !== 0 ||
    summary.entries.length < plan.parameters.trustedCount
  ) {
    throw new Error(
      `Completed outcome ledger repair no longer validates: ${JSON.stringify({
        sourceHealth: summary.sourceHealth,
        pendingRepairs,
        rejectedEntryCount: summary.rejectedEntries.length,
        trustedEntryCount: summary.entries.length,
        expectedTrustedCount: plan.parameters.trustedCount,
      })}`,
    );
  }
  return summary;
}

function ownerLeaseEventPrefixes(stateRoot, taskId) {
  const eventsPath = automationControlPaths(stateRoot).events;
  const snapshot = safeReadRegularFile(eventsPath, {
    exactMode: 0o600,
    maxBytes: CONTROL_EVENT_HISTORY_MAX_BYTES,
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
      const guardedCheckpoint = (...arguments_) =>
        invokeReadOnlyRepairCallback(plan, checkpoint, ...arguments_);
      guardedCheckpoint("owner-preauthorized");
      return withOutcomeLedgerWriterLock(
        plan.artifacts.outcomes,
        (writerGuardContext) => {
    const lockedTransaction = findTransaction(
      root,
      normalizedTaskId,
      sourceDigest,
    );
    let transaction = lockedTransaction?.record ?? null;
    const reauthorizeCurrentRepair = () =>
      invokeReadOnlyRepairCallback(plan, () =>
        reauthorizeOutcomeLedgerRepairLease({
          stateRoot: root,
          authorityContext,
          actor,
          leaseName,
          leaseToken,
          taskId: normalizedTaskId,
          parameters: plan.parameters,
        }),
      );
    if (transaction) {
      const recoveredPlan = recoverPlanFromTransaction({
        stateRoot: root,
        taskId: normalizedTaskId,
        sourceDigest,
        writerGuardContext,
      });
      if (
        !recoveredPlan ||
        !exactParametersEqual(recoveredPlan.parameters, plan.parameters)
      ) {
        throw new Error("Outcome ledger repair transaction drifted before repair.");
      }
      plan = recoveredPlan;
      transaction = recoveredPlan.transaction;
      preflightOutcomeLedgerAuthorityStageForRepair({
        stateRoot: root,
        sourceBytes: plan.material.sourceBytes,
        replacementBytes: plan.material.trustedBytes,
      });
      if (transaction.phase === "fenced") {
        preflightRepairTemporaryFiles(plan, { fencedRecovery: true });
        writePreparedArtifacts(
          plan,
          guardedCheckpoint,
          reauthorizeCurrentRepair,
          writerGuardContext,
        );
        const preparedPlan = recoverPlanFromTransaction({
          stateRoot: root,
          taskId: normalizedTaskId,
          sourceDigest,
          writerGuardContext,
        });
        if (!preparedPlan || preparedPlan.transaction.phase !== "prepared") {
          throw new Error(
            "Fenced outcome ledger repair did not recover to prepared.",
          );
        }
        plan = preparedPlan;
        transaction = preparedPlan.transaction;
      }
    } else {
      const lockedPlan = classifyCurrentLedger({
        stateRoot: root,
        taskId: normalizedTaskId,
        expectedSourceDigest: sourceDigest,
        eventHistoryPrefixDigest: plan.parameters.eventHistoryDigest,
        eventHistoryPrefixSize: plan.parameters.eventHistorySize,
        writerGuardContext,
      });
      if (!exactParametersEqual(lockedPlan.parameters, plan.parameters)) {
        throw new Error("Outcome ledger classification drifted before repair.");
      }
      plan = lockedPlan;
      preflightOutcomeLedgerAuthorityStageForRepair({
        stateRoot: root,
        sourceBytes: plan.material.sourceBytes,
        replacementBytes: plan.material.trustedBytes,
      });
      preflightRepairTemporaryFiles(plan, { beforeFirstFence: true });
      preflightOutcomeLedgerRepairEvent({
        stateRoot: root,
        authorityContext,
        actor,
        leaseName,
        leaseToken,
        taskId: normalizedTaskId,
        parameters: plan.parameters,
      });
      writeRepairFence(
        plan,
        guardedCheckpoint,
        reauthorizeCurrentRepair,
        {
          authorityContext,
          actor,
          leaseName,
          leaseToken,
          writerGuardContext,
        },
      );
      writePreparedArtifacts(
        plan,
        guardedCheckpoint,
        reauthorizeCurrentRepair,
        writerGuardContext,
      );
      const recoveredPlan = recoverPlanFromTransaction({
        stateRoot: root,
        taskId: normalizedTaskId,
        sourceDigest,
        writerGuardContext,
      });
      if (!recoveredPlan) {
        throw new Error("Prepared outcome ledger repair transaction is missing.");
      }
      plan = recoveredPlan;
      transaction = recoveredPlan.transaction;
    }

    const retireLedgerAuthorityStage = (beforeRemove) => {
      const authorityRetirement =
        retireOutcomeLedgerAuthorityStageForRepair({
          stateRoot: root,
          operationId: plan.operationId,
          replacementBytes: plan.material.trustedBytes,
          beforeRemove: () => {
            guardedCheckpoint(
              "outcome-ledger-authority-stage-before-retirement",
            );
            beforeRemove();
          },
        });
      if (authorityRetirement.retired) {
        guardedCheckpoint("outcome-ledger-authority-stage-retired");
      }
    };

    reauthorizeCurrentRepair();
    if (
      transaction?.phase === "complete" &&
      !existsAsPath(plan.artifacts.transaction) &&
      existsAsPath(plan.artifacts.completedTransaction)
    ) {
      retireLedgerAuthorityStage(reauthorizeCurrentRepair);
      if (hasActionableRepairReplacementTemporary(plan)) {
        verifyCompletedRepair(plan, {
          requireComplete: false,
          expectedPendingPhase: "cleanup",
          writerGuardContext,
        });
        cleanupRepairReplacementTemporaryFiles(
          plan,
          guardedCheckpoint,
          reauthorizeCurrentRepair,
        );
      }
      verifyCompletedRepair(plan, { writerGuardContext });
      guardedCheckpoint("transaction-retirement-recovered");
      return {
        changed: false,
        receipt: plan.receipt,
        intentDigest: plan.intentDigest,
      };
    }
    const finalizationGuardOptions = {
      stateRoot: root,
      authorityContext,
      actor,
      leaseName,
      leaseToken,
      taskId: normalizedTaskId,
      parameters: plan.parameters,
      transactionPath: plan.artifacts.transaction,
    };
    let recoveredLedgerReplacementPublication = null;
    withOutcomeLedgerRepairFinalizationGuard(
      finalizationGuardOptions,
      ({ beforeFinalizationMutation, committedRepairEventPlan }) => {
        const beforeMutation = () => {
          reauthorizeCurrentRepair();
          beforeFinalizationMutation();
        };
        const committedPlan = committedRepairEventPlan();
        if (committedPlan !== null) plan.eventPlan = committedPlan;
        transaction = recoverTransactionPublications(plan, {
          checkpoint: guardedCheckpoint,
          beforeMutation,
        });
        recoveredLedgerReplacementPublication =
          recoverLedgerReplacementPublication(plan, {
            checkpoint: guardedCheckpoint,
            beforeMutation,
          });
        if (transaction.phase === "complete") {
          retireLedgerAuthorityStage(beforeMutation);
          cleanupRepairTemporaryFiles(
            plan,
            guardedCheckpoint,
            beforeMutation,
          );
        } else {
          validateArchivedMaterial(transaction, plan.artifacts);
          cleanupRepairTemporaryFiles(
            plan,
            guardedCheckpoint,
            beforeMutation,
          );
        }
      },
    );
    if (transaction.phase === "complete") {
      verifyCompletedRepair(plan, {
        requireComplete: false,
        expectedPendingPhase: "retiring",
        writerGuardContext,
      });
      retireCompletedRepairTransaction(
        plan,
        guardedCheckpoint,
        reauthorizeCurrentRepair,
        {
          authorityContext,
          actor,
          leaseName,
          leaseToken,
          writerGuardContext,
        },
      );
      verifyCompletedRepair(plan, { writerGuardContext });
      return {
        changed: false,
        receipt: plan.receipt,
        intentDigest: plan.intentDigest,
      };
    }

    const current = safeReadRegularFile(plan.artifacts.outcomes, {
      allowReadonlyGroupWorld: true,
    });
    if (
      ![
        plan.parameters.sourceDigest,
        plan.parameters.replacementDigest,
      ].includes(current.digest)
    ) {
      throw new Error("Canonical outcome ledger differs from source and replacement.");
    }
    const reauthorizeRepair = reauthorizeCurrentRepair;

    if (transaction.phase !== "complete") {
      guardedCheckpoint("before-replacement-classification");
      const finalCurrent = openPinnedRepairFile(plan.artifacts.outcomes, {
        allowReadonlyGroupWorld: true,
        maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
        label: "Outcome ledger repair classified canonical source",
      });
      try {
        const requireClassifiedCanonicalSource = () =>
          requirePinnedPredecessor(plan.artifacts.outcomes, finalCurrent);
        const hasSourceLedger =
          recoveredLedgerReplacementPublication === null &&
          finalCurrent.digest === plan.parameters.sourceDigest &&
          finalCurrent.size === plan.parameters.sourceSize &&
          finalCurrent.bytes.equals(plan.material.sourceBytes);
        const sourceAndReplacementMaterialDiffer =
          plan.parameters.sourceDigest !==
            plan.parameters.replacementDigest ||
          plan.parameters.sourceSize !== plan.parameters.replacementSize ||
          !plan.material.sourceBytes.equals(plan.material.trustedBytes);
        const recoveredReplacementIdentityMatches =
          recoveredLedgerReplacementPublication !== null &&
          publicationIdentityMatches(
            finalCurrent,
            recoveredLedgerReplacementPublication,
            plan.material.trustedBytes,
          );
        if (
          recoveredLedgerReplacementPublication !== null &&
          !recoveredReplacementIdentityMatches
        ) {
          throw new Error(
            "Canonical outcome ledger changed after recovered replacement publication.",
          );
        }
        const hasReplacementLedger =
          (sourceAndReplacementMaterialDiffer ||
            recoveredReplacementIdentityMatches) &&
          finalCurrent.identity.mode === 0o600 &&
          finalCurrent.digest === plan.parameters.replacementDigest &&
          finalCurrent.size === plan.parameters.replacementSize &&
          finalCurrent.bytes.equals(plan.material.trustedBytes);
        if (!hasSourceLedger && !hasReplacementLedger) {
          throw new Error(
            "Canonical outcome ledger differs from source and replacement.",
          );
        }
        const finalClassification = classifyCurrentLedger({
          stateRoot: root,
          taskId: normalizedTaskId,
          expectedSourceDigest: sourceDigest,
          eventHistoryPrefixDigest: plan.parameters.eventHistoryDigest,
          eventHistoryPrefixSize: plan.parameters.eventHistorySize,
          allowedPendingOperationId: plan.operationId,
          sourceBytes: hasSourceLedger
            ? undefined
            : plan.material.sourceBytes,
          expectedCanonicalLedger: finalCurrent,
          writerGuardContext,
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
        guardedCheckpoint("after-replacement-classification");
        requireClassifiedCanonicalSource();
        withOutcomeLedgerRepairFinalizationGuard(
          finalizationGuardOptions,
          ({
            beforeFinalizationMutation,
            bindRepairEventPlan,
            reconstructPreparedRepairEventPlan,
            preflightRepairEvent,
            appendRepairEvent,
          }) => {
            const beforeMutation = () => {
              reauthorizeRepair();
              beforeFinalizationMutation();
            };
            const bindPreparedEventPlan = () => {
              const reconstructed = reconstructPreparedRepairEventPlan();
              plan.eventPlan = reconstructed;
              const bound = bindRepairEventPlan();
              if (stableJson(bound) !== stableJson(reconstructed)) {
                throw new Error(
                  "Outcome ledger repair reconstructed event plan changed before binding.",
                );
              }
              plan.eventPlan = bound;
            };
            requireClassifiedCanonicalSource();
            if (hasReplacementLedger && transaction.phase === "prepared") {
              if (plan.eventPlan === null || plan.eventPlan === undefined) {
                bindPreparedEventPlan();
              }
              transaction = publishTransactionPhase(plan, "replaced", {
                checkpoint: guardedCheckpoint,
                beforeMutation,
              });
              guardedCheckpoint("transaction-replaced");
              requireClassifiedCanonicalSource();
            }
            invokeReadOnlyRepairCallback(plan, preflightRepairEvent);
            requireClassifiedCanonicalSource();
            reauthorizeRepair();
            requireClassifiedCanonicalSource();
            if (hasSourceLedger && !hasReplacementLedger) {
              writeReplacementAtomic(
                plan,
                guardedCheckpoint,
                beforeMutation,
                finalCurrent,
              );
              if (plan.eventPlan === null || plan.eventPlan === undefined) {
                bindPreparedEventPlan();
              }
              transaction = publishTransactionPhase(plan, "replaced", {
                checkpoint: guardedCheckpoint,
                beforeMutation,
              });
              guardedCheckpoint("transaction-replaced");
            }
            if (
              !["replaced", "audited", "complete"].includes(
                transaction.phase,
              )
            ) {
              throw new Error(
                "Outcome ledger repair cannot retire authority before replacement publication.",
              );
            }
            retireLedgerAuthorityStage(beforeMutation);
            if (!["audited", "complete"].includes(transaction.phase)) {
              appendRepairEvent();
              captureRepairTopology(plan);
              if (hasReplacementLedger) requireClassifiedCanonicalSource();
              guardedCheckpoint("event-audited");
              transaction = publishTransactionPhase(plan, "audited", {
                checkpoint: guardedCheckpoint,
                beforeMutation,
              });
              guardedCheckpoint("transaction-audited");
            }
            writeImmutable(
              plan.artifacts.receiptArtifact,
              plan.material.receiptBytes,
              {
                beforePublish: beforeMutation,
                retirementDirectory: repairRetirementDirectory(plan),
                stateRoot: plan.artifacts.stateRoot,
              },
            );
            guardedCheckpoint("receipt-written");
          },
        );
        verifyCompletedRepair(plan, {
          requireComplete: false,
          writerGuardContext,
        });
        withOutcomeLedgerRepairFinalizationGuard(
          finalizationGuardOptions,
          ({ beforeFinalizationMutation }) => {
            const beforeMutation = () => {
              reauthorizeRepair();
              beforeFinalizationMutation();
            };
            transaction = publishTransactionPhase(plan, "complete", {
              checkpoint: guardedCheckpoint,
              beforeMutation,
            });
            guardedCheckpoint("transaction-complete");
          },
        );
      } finally {
        closeSync(finalCurrent.descriptor);
      }
    }

    verifyCompletedRepair(plan, {
      requireComplete: false,
      expectedPendingPhase: "retiring",
      writerGuardContext,
    });
    retireCompletedRepairTransaction(
      plan,
      guardedCheckpoint,
      reauthorizeRepair,
      {
        authorityContext,
        actor,
        leaseName,
        leaseToken,
        writerGuardContext,
      },
    );
    verifyCompletedRepair(plan, { writerGuardContext });
    reauthorizeRepair();
    return { changed: true, receipt: plan.receipt, intentDigest: plan.intentDigest };
        },
      );
    },
  );
}
