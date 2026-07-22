import { createHash } from "node:crypto";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  AUTOMATION_CONTROL_SCHEMA_VERSION,
  CONTROL_EVENT_HISTORY_MAX_BYTES,
  CONTROL_EVENT_HISTORY_MAX_RECORDS,
  CONTROL_EVENT_MAX_LINE_BYTES,
  automationControlPaths,
  ownerGovernanceIntentDigest,
  readAutomationPlanningAdmission,
  requireAutomationPlanningReadBundle,
} from "./automation-control.mjs";
import {
  OUTCOME_LEDGER_REPAIR_ACTION,
  OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_GENERATION_KEYS,
  OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_PARENT_KEYS,
  OUTCOME_LEDGER_REPAIR_EVENT_PLAN_KEYS,
  OUTCOME_LEDGER_REPAIR_EVENT_TYPE,
  OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS,
  OUTCOME_LEDGER_REPAIR_PHASES,
  OUTCOME_LEDGER_REPAIR_POLICY,
  OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
  OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS,
  orderedOutcomeLedgerRepairEventPlan,
  orderedOutcomeLedgerRepairParameters,
  outcomeLedgerRepairEventId,
  outcomeLedgerRepairOperationSeed,
  parseOutcomeLedgerRepairReplacementTemporaryName,
  validateOutcomeLedgerRepairArchivedMaterialBytes,
} from "./outcome-ledger-repair-contract.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CANONICAL_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const TRANSACTION_TRANSITIONS = Object.freeze([
  Object.freeze(["fenced", "prepared"]),
  Object.freeze(["prepared", "replaced"]),
  Object.freeze(["replaced", "audited"]),
  Object.freeze(["audited", "complete"]),
]);

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

function requireParameters(value, { stateRoot, ledgerPath, taskId }) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    stableJson(Object.keys(value).sort()) !==
      stableJson(OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS) ||
    value.schemaVersion !== OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION ||
    value.policy !== OUTCOME_LEDGER_REPAIR_POLICY ||
    value.stateRoot !== stateRoot ||
    value.ledgerPath !== ledgerPath
  ) {
    throw new Error("transaction parameters have a conflicting shape or path");
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
    if (!SHA256_PATTERN.test(String(value[field] ?? ""))) {
      throw new Error(`transaction parameter ${field} is not canonical`);
    }
  }
  for (const field of [
    "eventHistorySize",
    "rejectedCount",
    "replacementSize",
    "sourceLineCount",
    "sourceSize",
    "trustedCount",
  ]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new Error(`transaction parameter ${field} is not bounded`);
    }
  }
  const parameters = orderedOutcomeLedgerRepairParameters(value);
  if (
    parameters.archiveDigest !== parameters.sourceDigest ||
    parameters.sourceLineCount !==
      parameters.trustedCount + parameters.rejectedCount ||
    sha256(stableJson(outcomeLedgerRepairOperationSeed(taskId, parameters))) !==
      parameters.operationId
  ) {
    throw new Error("transaction parameter identities do not agree");
  }
  return parameters;
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
    sourceArtifact: path.join(
      artifactDirectory,
      `source-${sourceDigest}.jsonl`,
    ),
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

function buildReceipt({ taskId, operationId, eventId, parameters, paths }) {
  const core = {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
    status: "complete",
    taskId,
    operationId,
    eventId,
    stateRoot: parameters.stateRoot,
    ledgerPath: parameters.ledgerPath,
    sourceArtifact: paths.sourceArtifact,
    trustedArtifact: paths.trustedArtifact,
    rejectedArtifact: paths.rejectedArtifact,
    decisionsArtifact: paths.decisionsArtifact,
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
  const receiptDigest = sha256(stableJson(core));
  return { ...core, receiptDigest };
}

function canonicalTransactionRecord({
  taskId,
  operationId,
  phase,
  intentDigest,
  eventId,
  eventPlan,
  parameters,
  receipt,
  paths,
}) {
  return {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
    taskId,
    operationId,
    phase,
    intentDigest,
    eventId,
    eventPlan: ["fenced", "prepared"].includes(phase) ? null : eventPlan,
    parameters,
    receipt,
    artifacts: {
      source: paths.sourceArtifact,
      trusted: paths.trustedArtifact,
      rejected: paths.rejectedArtifact,
      decisions: paths.decisionsArtifact,
      receipt: paths.receiptArtifact,
    },
  };
}

function canonicalTransactionBytes(plan, phase) {
  const eventPlan = ["fenced", "prepared"].includes(phase)
    ? null
    : (plan.eventPlan ?? plan.preparedTransitionEventPlan ?? null);
  return Buffer.from(
    `${JSON.stringify(
      canonicalTransactionRecord({ ...plan, phase, eventPlan }),
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function parseCanonicalJson(bytes, label) {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON`);
  }
}

function bytesFromAdmission(admission, label) {
  const encoded = admission?.bytesBase64;
  if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error(`${label} has no canonical admitted bytes`);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.toString("base64") !== encoded ||
    bytes.length !== admission.size ||
    sha256(bytes) !== admission.digest
  ) {
    throw new Error(`${label} admitted byte identity changed`);
  }
  return bytes;
}

function fileFromTreeEntry(entry, label, { allowedModes = [0o600] } = {}) {
  if (entry?.kind !== "file") throw new Error(`${label} is not a file`);
  const bytes = bytesFromAdmission(
    {
      bytesBase64: entry.bytesBase64,
      size: entry.identity?.size,
      digest: entry.digest,
    },
    label,
  );
  if (
    !allowedModes.includes(entry.identity?.mode) ||
    entry.identity?.nlink !== 1 ||
    !CANONICAL_DECIMAL_PATTERN.test(String(entry.identity?.dev ?? "")) ||
    !CANONICAL_DECIMAL_PATTERN.test(String(entry.identity?.ino ?? ""))
  ) {
    throw new Error(`${label} is not one private single-link generation`);
  }
  return { ...entry, bytes };
}

function admittedTree(bundle, directoryPath, { allowMissing = false } = {}) {
  if (process.env.FREED_TEST_TRACE_OUTCOME_REPAIR_TREE === "1") {
    console.error(`outcome repair tree admission: ${directoryPath}`);
  }
  const token = bundle.admitTree({
    directoryPath,
    label: "Outcome ledger repair artifact tree",
    allowMissing,
  });
  const tree = readAutomationPlanningAdmission(bundle, token);
  if (tree.missing) {
    if (!allowMissing) {
      throw new Error("artifact tree is unexpectedly missing");
    }
    return { tree, byPath: new Map() };
  }
  if (
    tree.kind !== "outcome-repair-tree" ||
    tree.filePath !== directoryPath ||
    tree.missing ||
    !Array.isArray(tree.entries)
  ) {
    throw new Error("artifact tree admission changed identity");
  }
  const byPath = new Map();
  for (const entry of tree.entries) {
    const isRoot = entry?.relativePath === "";
    if (
      typeof entry?.relativePath !== "string" ||
      byPath.has(entry.relativePath) ||
      (!isRoot && path.normalize(entry.relativePath) !== entry.relativePath) ||
      (!isRoot && path.isAbsolute(entry.relativePath)) ||
      (!isRoot && entry.relativePath.split(path.sep).includes(".."))
    ) {
      throw new Error("artifact tree contains a noncanonical path");
    }
    byPath.set(entry.relativePath, entry);
  }
  const root = byPath.get("");
  if (
    root?.kind !== "directory" ||
    root.identity?.mode !== 0o700 ||
    tree.entryCount !== byPath.size
  ) {
    throw new Error("artifact tree root is not one private directory");
  }
  return { tree, byPath };
}

function requireTreeFile(tree, relativePath, label, options = {}) {
  const entry = tree.byPath.get(relativePath);
  if (entry === undefined) throw new Error(`${label} is missing`);
  return fileFromTreeEntry(entry, label, options);
}

function optionalTreeFile(tree, relativePath, label, options = {}) {
  const entry = tree.byPath.get(relativePath);
  return entry === undefined ? null : fileFromTreeEntry(entry, label, options);
}

function validateMaterial(plan, tree, allowed) {
  const sourceName = path.basename(plan.paths.sourceArtifact);
  const source = requireTreeFile(tree, sourceName, "source artifact");
  const trusted = requireTreeFile(tree, "trusted.jsonl", "trusted artifact");
  const rejected = requireTreeFile(tree, "rejected.jsonl", "rejected artifact");
  const decisions = requireTreeFile(tree, "decisions.json", "decisions artifact");
  for (const name of [sourceName, "trusted.jsonl", "rejected.jsonl", "decisions.json"]) {
    allowed.add(name);
  }
  validateOutcomeLedgerRepairArchivedMaterialBytes({
    taskId: plan.taskId,
    parameters: plan.parameters,
    sourceBytes: source.bytes,
    trustedBytes: trusted.bytes,
    rejectedBytes: rejected.bytes,
    decisionBytes: decisions.bytes,
  });
  return { source, trusted, rejected, decisions };
}

function requireIdentityRecord(value, label, { allowedModes = [0o600] } = {}) {
  const keys = [
    "device",
    "digest",
    "inode",
    "linkCount",
    "mode",
    "path",
    "size",
    "uid",
  ];
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== keys.sort().join("\n") ||
    typeof value.path !== "string" ||
    typeof value.device !== "string" ||
    !CANONICAL_DECIMAL_PATTERN.test(value.device) ||
    typeof value.inode !== "string" ||
    !CANONICAL_DECIMAL_PATTERN.test(value.inode) ||
    !allowedModes.includes(value.mode) ||
    value.linkCount !== 1 ||
    !Number.isSafeInteger(value.uid) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    value.size > OUTCOME_LEDGER_REPAIR_MAX_BYTES ||
    !SHA256_PATTERN.test(String(value.digest ?? ""))
  ) {
    throw new Error(`${label} identity is invalid`);
  }
  return {
    path: value.path,
    device: value.device,
    inode: value.inode,
    uid: value.uid,
    mode: value.mode,
    linkCount: value.linkCount,
    size: value.size,
    digest: value.digest,
  };
}

function identityMatchesFile(identity, file, expectedBytes, { prefix = false } = {}) {
  const contentMatches = prefix
    ? file.bytes.length >= expectedBytes.length &&
      file.bytes.subarray(0, expectedBytes.length).equals(expectedBytes)
    : file.bytes.equals(expectedBytes);
  return (
    file.identity.dev === identity.device &&
    file.identity.ino === identity.inode &&
    file.identity.uid === identity.uid &&
    file.identity.mode === identity.mode &&
    file.identity.nlink === identity.linkCount &&
    (prefix ? file.identity.size >= identity.size : file.identity.size === identity.size) &&
    contentMatches &&
    (prefix || sha256(file.bytes) === identity.digest)
  );
}

function bundleLedgerFile(bundle) {
  const bytes = Buffer.from(bundle.outcomeLedger.text, "utf8");
  if (
    bytes.length !== bundle.outcomeLedger.size ||
    sha256(bytes) !== bundle.outcomeLedger.digest
  ) {
    throw new Error("canonical ledger bundle bytes changed");
  }
  return {
    bytes,
    identity: bundle.outcomeLedger.identity,
    missing: bundle.outcomeLedger.missing,
  };
}

function canonicalLeaseControlEventBytes(event) {
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

function indexControlEventHistory(bundle) {
  const bytes = Buffer.from(bundle.controlEventHistory.text, "utf8");
  if (
    bytes.length !== bundle.controlEventHistory.size ||
    sha256(bytes) !== bundle.controlEventHistory.digest
  ) {
    throw new Error("control event history bundle bytes changed");
  }
  const records = [];
  const recordsByEventId = new Map();
  const recordsByStart = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const newline = bytes.indexOf(0x0a, offset);
    const end = newline === -1 ? bytes.length : newline + 1;
    let contentEnd = newline === -1 ? end : newline;
    if (contentEnd > offset && bytes[contentEnd - 1] === 0x0d) {
      contentEnd -= 1;
    }
    const raw = bytes.subarray(offset, end);
    const content = bytes.subarray(offset, contentEnd);
    if (content.length === 0) {
      throw new Error("control event history contains a blank physical record");
    }
    const event = parseCanonicalJson(content, "control event history record");
    const record = Object.freeze({
      index: records.length,
      start: offset,
      end,
      raw,
      event,
    });
    records.push(record);
    recordsByStart.set(record.start, record);
    if (typeof event?.eventId === "string") {
      const matches = recordsByEventId.get(event.eventId) ?? [];
      matches.push(record);
      recordsByEventId.set(event.eventId, matches);
    }
    offset = end;
  }
  if (
    records.length !== bundle.controlEventRecordCount ||
    records.length !== bundle.controlEvents.length ||
    records.some(
      (record, index) =>
        stableJson(record.event) !== stableJson(bundle.controlEvents[index]),
    )
  ) {
    throw new Error("control event history bundle index changed");
  }
  if (bundle.outcomeControlHistory.ownerLeaseLineageHealthy !== true) {
    throw new Error("canonical owner lease event history is unhealthy");
  }
  const ownerLeaseLineageByRecordIndex = new Map();
  for (const [rawIndex, descriptor] of Object.entries(
    bundle.outcomeControlHistory.ownerLeaseLineageByRecordIndex ?? {},
  )) {
    const index = Number(rawIndex);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= records.length ||
      !["acquisition", "heartbeat", "release"].includes(descriptor?.kind) ||
      !Number.isSafeInteger(descriptor?.acquisitionIndex) ||
      stableJson(descriptor.event) !== stableJson(records[index].event)
    ) {
      throw new Error("canonical owner lease lineage index is invalid");
    }
    ownerLeaseLineageByRecordIndex.set(index, descriptor);
  }
  const ownerLineageKeys = new Array(records.length).fill(null);
  for (const [index, descriptor] of ownerLeaseLineageByRecordIndex) {
    const acquisition = ownerLeaseLineageByRecordIndex.get(
      descriptor.acquisitionIndex,
    );
    if (
      acquisition?.kind !== "acquisition" ||
      acquisition.acquisitionIndex !== descriptor.acquisitionIndex
    ) {
      throw new Error("canonical owner lease lineage lost its acquisition");
    }
    const credentialKind = acquisition.event.data?.credentialKind;
    const taskId =
      credentialKind === "owner-signed-capability"
        ? acquisition.event.data.ownerCapabilityTaskId
        : credentialKind === "owner-confirmation"
          ? acquisition.event.data.ownerConfirmationTaskId
          : null;
    const intentDigest =
      credentialKind === "owner-signed-capability"
        ? acquisition.event.data.ownerCapabilityIntentDigest
        : credentialKind === "owner-confirmation"
          ? acquisition.event.data.ownerConfirmationIntentDigest
          : null;
    if (
      acquisition.event.actor !== "freed-owner" ||
      acquisition.event.leaseName !== "owner-governance" ||
      !IDENTIFIER_PATTERN.test(String(taskId ?? "")) ||
      !SHA256_PATTERN.test(String(intentDigest ?? "")) ||
      !records[index].raw.equals(
        canonicalLeaseControlEventBytes(descriptor.event),
      )
    ) {
      throw new Error("canonical owner lease lineage is not exact raw history");
    }
    ownerLineageKeys[index] = `${taskId}\0${intentDigest}`;
  }
  const ownerLineageRunEndByIndex = new Array(records.length).fill(null);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const key = ownerLineageKeys[index];
    if (key === null) continue;
    ownerLineageRunEndByIndex[index] =
      ownerLineageKeys[index + 1] === key
        ? ownerLineageRunEndByIndex[index + 1]
        : index + 1;
  }
  return Object.freeze({
    bytes,
    records,
    recordsByEventId,
    recordsByStart,
    ownerLeaseLineageByRecordIndex,
    ownerLineageKeys,
    ownerLineageRunEndByIndex,
  });
}

function validateBoundEventHistory(plan, eventHistory) {
  const size = plan.parameters.eventHistorySize;
  if (
    size > eventHistory.bytes.length ||
    sha256(eventHistory.bytes.subarray(0, size)) !==
      plan.parameters.eventHistoryDigest
  ) {
    throw new Error("repair event history prefix does not match its plan");
  }
}

function validatePreRepairEventSuffix(
  plan,
  eventHistory,
  repairRecord,
) {
  validateBoundEventHistory(plan, eventHistory);
  const prefixSize = plan.parameters.eventHistorySize;
  const separatorSize =
    prefixSize > 0 && eventHistory.bytes[prefixSize - 1] !== 0x0a ? 1 : 0;
  if (separatorSize === 1 && eventHistory.bytes[prefixSize] !== 0x0a) {
    throw new Error("repair history suffix separator changed");
  }
  const suffixStart = prefixSize + separatorSize;
  const firstRecord = eventHistory.recordsByStart.get(suffixStart);
  const repairIndex = repairRecord?.index ?? eventHistory.records.length;
  const firstDescriptor =
    firstRecord === undefined
      ? undefined
      : eventHistory.ownerLeaseLineageByRecordIndex.get(firstRecord.index);
  const expectedKey = `${plan.taskId}\0${plan.intentDigest}`;
  const runEnd =
    firstRecord === undefined
      ? null
      : eventHistory.ownerLineageRunEndByIndex[firstRecord.index];
  let activeAcquisition = null;
  let maximumLifecycleTimestampMs = Number.NEGATIVE_INFINITY;
  for (
    let index = firstRecord?.index ?? repairIndex;
    index < repairIndex;
    index += 1
  ) {
    const descriptor = eventHistory.ownerLeaseLineageByRecordIndex.get(index);
    if (descriptor?.kind === "acquisition") {
      activeAcquisition = descriptor;
      maximumLifecycleTimestampMs = Date.parse(descriptor.event.ts);
    } else if (
      descriptor?.kind === "heartbeat" &&
      activeAcquisition?.acquisitionIndex === descriptor.acquisitionIndex
    ) {
      maximumLifecycleTimestampMs = Math.max(
        maximumLifecycleTimestampMs,
        Date.parse(descriptor.event.ts),
      );
    } else if (
      descriptor?.kind === "release" &&
      activeAcquisition?.acquisitionIndex === descriptor.acquisitionIndex
    ) {
      activeAcquisition = null;
    } else {
      activeAcquisition = null;
      break;
    }
  }
  if (
    firstRecord === undefined ||
    firstDescriptor?.kind !== "acquisition" ||
    eventHistory.ownerLineageKeys[firstRecord.index] !== expectedKey ||
    runEnd !== repairIndex ||
    activeAcquisition?.kind !== "acquisition" ||
    eventHistory.ownerLineageKeys[activeAcquisition.acquisitionIndex] !==
      expectedKey ||
    !Number.isFinite(maximumLifecycleTimestampMs)
  ) {
    throw new Error(
      "repair history suffix is not one exact plan-bound owner lease lifecycle",
    );
  }
  return Object.freeze({
    acquisition: activeAcquisition.event,
    deterministicTimestamp: new Date(
      maximumLifecycleTimestampMs,
    ).toISOString(),
  });
}

function repairAuthorizationFromOwnerAcquisition(event) {
  const common = {
    leaseName: event.leaseName,
    leaseAcquiredAt: event.ts,
    credentialKind: event.data.credentialKind,
  };
  if (event.data.credentialKind === "owner-signed-capability") {
    return {
      ...common,
      ownerCapabilityId: event.data.ownerCapabilityId,
      ownerCapabilityTaskId: event.data.ownerCapabilityTaskId,
      ownerCapabilityIntentDigest: event.data.ownerCapabilityIntentDigest,
    };
  }
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

function canonicalRepairAuthorization(value) {
  const common = {
    leaseName: value.leaseName,
    leaseAcquiredAt: value.leaseAcquiredAt,
    credentialKind: value.credentialKind,
  };
  if (value.credentialKind === "owner-signed-capability") {
    return {
      ...common,
      ownerCapabilityId: value.ownerCapabilityId,
      ownerCapabilityTaskId: value.ownerCapabilityTaskId,
      ownerCapabilityIntentDigest: value.ownerCapabilityIntentDigest,
    };
  }
  return {
    ...common,
    ownerConfirmationId: value.ownerConfirmationId,
    ownerConfirmationTaskId: value.ownerConfirmationTaskId,
    ownerConfirmationIntentDigest: value.ownerConfirmationIntentDigest,
    ownerConfirmationDigest: value.ownerConfirmationDigest,
    ownerConfirmationReference: value.ownerConfirmationReference,
    ownerConfirmationApprovedBy: value.ownerConfirmationApprovedBy,
    ownerConfirmationApprovalReference:
      value.ownerConfirmationApprovalReference,
    ownerConfirmationApprovedAt: value.ownerConfirmationApprovedAt,
    ownerConfirmationExpiresAt: value.ownerConfirmationExpiresAt,
  };
}

function canonicalRepairEventBytes(plan, event) {
  return Buffer.from(
    `${JSON.stringify({
      schemaVersion: event.schemaVersion,
      eventId: plan.eventId,
      type: OUTCOME_LEDGER_REPAIR_EVENT_TYPE,
      ts: event.ts,
      actor: "freed-owner",
      taskId: plan.taskId,
      data: {
        intentDigest: plan.intentDigest,
        parameters: orderedOutcomeLedgerRepairParameters(plan.parameters),
        authorization: canonicalRepairAuthorization(event.data.authorization),
      },
    })}\n`,
    "utf8",
  );
}

function exactObjectKeys(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    stableJson(Object.keys(value).sort()) === stableJson(expectedKeys)
  );
}

function bundleAuthorityGeneration(source, label) {
  if (
    source?.missing !== false ||
    source.identity === null ||
    typeof source.identity !== "object" ||
    !CANONICAL_DECIMAL_PATTERN.test(String(source.identity.dev ?? "")) ||
    !CANONICAL_DECIMAL_PATTERN.test(String(source.identity.ino ?? "")) ||
    !Number.isSafeInteger(source.identity.mode) ||
    !Number.isSafeInteger(source.identity.nlink) ||
    !Number.isSafeInteger(source.identity.uid) ||
    !Number.isSafeInteger(source.identity.gid) ||
    !Number.isSafeInteger(source.identity.size) ||
    !CANONICAL_DECIMAL_PATTERN.test(String(source.identity.mtimeNs ?? "")) ||
    !CANONICAL_DECIMAL_PATTERN.test(String(source.identity.ctimeNs ?? "")) ||
    !SHA256_PATTERN.test(String(source.digest ?? ""))
  ) {
    throw new Error(`${label} bundle generation is invalid`);
  }
  return {
    missing: false,
    dev: String(source.identity.dev),
    ino: String(source.identity.ino),
    mode: 0o100000 | Number(source.identity.mode),
    nlink: Number(source.identity.nlink),
    uid: Number(source.identity.uid),
    gid: Number(source.identity.gid),
    size: Number(source.identity.size),
    mtimeNs: String(source.identity.mtimeNs),
    ctimeNs: String(source.identity.ctimeNs),
    digest: source.digest,
  };
}

function bundleAuthorityParent(source, label) {
  const parent = source?.directoryIdentity;
  if (
    parent === null ||
    typeof parent !== "object" ||
    !CANONICAL_DECIMAL_PATTERN.test(String(parent.dev ?? "")) ||
    !CANONICAL_DECIMAL_PATTERN.test(String(parent.ino ?? "")) ||
    !Number.isSafeInteger(parent.mode) ||
    !Number.isSafeInteger(parent.uid)
  ) {
    throw new Error(`${label} bundle parent is invalid`);
  }
  return {
    dev: String(parent.dev),
    ino: String(parent.ino),
    mode: 0o040000 | Number(parent.mode),
    uid: Number(parent.uid),
  };
}

function requireBoundEventPlanGeneration(
  value,
  label,
  { expectedSize, expectedDigest },
) {
  if (
    !exactObjectKeys(
      value,
      OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_GENERATION_KEYS,
    ) ||
    value.missing !== false ||
    !CANONICAL_DECIMAL_PATTERN.test(String(value.dev ?? "")) ||
    !CANONICAL_DECIMAL_PATTERN.test(String(value.ino ?? "")) ||
    !Number.isSafeInteger(value.mode) ||
    (value.mode & 0o170000) !== 0o100000 ||
    (value.mode & 0o7777) !== 0o600 ||
    value.nlink !== 1 ||
    !Number.isSafeInteger(value.uid) ||
    value.uid < 0 ||
    !Number.isSafeInteger(value.gid) ||
    value.gid < 0 ||
    value.size !== expectedSize ||
    !CANONICAL_DECIMAL_PATTERN.test(String(value.mtimeNs ?? "")) ||
    !CANONICAL_DECIMAL_PATTERN.test(String(value.ctimeNs ?? "")) ||
    value.digest !== expectedDigest
  ) {
    throw new Error(`${label} generation is invalid`);
  }
  return value;
}

function requireBoundEventPlanParent(value, label) {
  if (
    !exactObjectKeys(
      value,
      OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_PARENT_KEYS,
    ) ||
    !CANONICAL_DECIMAL_PATTERN.test(String(value.dev ?? "")) ||
    !CANONICAL_DECIMAL_PATTERN.test(String(value.ino ?? "")) ||
    !Number.isSafeInteger(value.mode) ||
    (value.mode & 0o170000) !== 0o040000 ||
    (value.mode & 0o7777) !== 0o700 ||
    !Number.isSafeInteger(value.uid) ||
    value.uid < 0
  ) {
    throw new Error(`${label} parent is invalid`);
  }
  return value;
}

function deterministicRepairEvent(plan, boundary) {
  return {
    schemaVersion: AUTOMATION_CONTROL_SCHEMA_VERSION,
    eventId: plan.eventId,
    type: OUTCOME_LEDGER_REPAIR_EVENT_TYPE,
    ts: boundary.deterministicTimestamp,
    actor: "freed-owner",
    taskId: plan.taskId,
    data: {
      intentDigest: plan.intentDigest,
      parameters: orderedOutcomeLedgerRepairParameters(plan.parameters),
      authorization: repairAuthorizationFromOwnerAcquisition(
        boundary.acquisition,
      ),
    },
  };
}

function eventHistoryPrefixRecordCount(eventHistory, size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > eventHistory.bytes.length) {
    throw new Error("repair event plan history size is invalid");
  }
  const prefix = eventHistory.bytes.subarray(0, size);
  let offset = 0;
  let count = 0;
  while (offset < prefix.length) {
    const newline = prefix.indexOf(0x0a, offset);
    const end = newline === -1 ? prefix.length : newline + 1;
    let contentEnd = newline === -1 ? end : newline;
    if (contentEnd > offset && prefix[contentEnd - 1] === 0x0d) {
      contentEnd -= 1;
    }
    const content = prefix.subarray(offset, contentEnd);
    if (content.length === 0) {
      throw new Error("repair event plan history contains a blank physical record");
    }
    parseCanonicalJson(content, "repair event plan history record");
    count += 1;
    offset = end;
  }
  return count;
}

function eventPlanStageNamespace(plan, eventPlan, proposedBytes) {
  return sha256(
    stableJson({
      purpose: "automation-authority-file-publication-v3",
      filePath: plan.paths.events,
      operationId: `control-event:${plan.eventId}`,
      proposedDigest: sha256(proposedBytes),
      previous: eventPlan.historyGeneration,
      parent: eventPlan.historyParent,
    }),
  );
}

function validateBoundRepairEventPlan(plan, candidate, bundle, eventHistory) {
  if (
    !exactObjectKeys(candidate, OUTCOME_LEDGER_REPAIR_EVENT_PLAN_KEYS) ||
    !SHA256_PATTERN.test(String(candidate.historyDigest ?? "")) ||
    !Number.isSafeInteger(candidate.historyRecordCount) ||
    candidate.historyRecordCount < 0 ||
    !Number.isSafeInteger(candidate.historySize) ||
    candidate.historySize < plan.parameters.eventHistorySize ||
    !SHA256_PATTERN.test(String(candidate.stageNamespace ?? ""))
  ) {
    throw new Error("repair transaction has an invalid bound event plan");
  }
  const prefix = eventHistory.bytes.subarray(0, candidate.historySize);
  if (
    prefix.length !== candidate.historySize ||
    sha256(prefix) !== candidate.historyDigest ||
    eventHistoryPrefixRecordCount(eventHistory, candidate.historySize) !==
      candidate.historyRecordCount
  ) {
    throw new Error("repair event plan history boundary changed");
  }
  requireBoundEventPlanGeneration(
    candidate.historyGeneration,
    "repair event history",
    {
      expectedSize: candidate.historySize,
      expectedDigest: candidate.historyDigest,
    },
  );
  requireBoundEventPlanParent(
    candidate.historyParent,
    "repair event history",
  );
  requireBoundEventPlanGeneration(
    candidate.replacementGeneration,
    "repair replacement",
    {
      expectedSize: plan.parameters.replacementSize,
      expectedDigest: plan.parameters.replacementDigest,
    },
  );
  requireBoundEventPlanParent(
    candidate.replacementParent,
    "repair replacement",
  );
  const currentHistoryGeneration = bundleAuthorityGeneration(
    bundle.controlEventHistory,
    "control event history",
  );
  const currentHistoryParent = bundleAuthorityParent(
    bundle.controlEventHistory,
    "control event history",
  );
  const currentReplacementGeneration = bundleAuthorityGeneration(
    bundle.outcomeLedger,
    "outcome ledger replacement",
  );
  const currentReplacementParent = bundleAuthorityParent(
    bundle.outcomeLedger,
    "outcome ledger replacement",
  );
  if (
    (!plan.completedAdmission &&
      stableJson(candidate.replacementGeneration) !==
        stableJson(currentReplacementGeneration)) ||
    stableJson(candidate.replacementParent) !==
      stableJson(currentReplacementParent) ||
    stableJson(candidate.historyParent) !==
      stableJson(currentHistoryParent)
  ) {
    throw new Error("repair event plan authority generations changed");
  }
  const matches = eventHistory.recordsByEventId.get(plan.eventId) ?? [];
  if (matches.length > 1) {
    throw new Error("repair event plan has duplicate audit events");
  }
  if (matches.length === 0 && eventHistory.bytes.length !== candidate.historySize) {
    throw new Error("repair event plan history advanced before its audit event");
  }
  const repairRecord = matches[0] ?? null;
  const boundary = validatePreRepairEventSuffix(
    plan,
    eventHistory,
    repairRecord,
  );
  const expectedEvent = deterministicRepairEvent(plan, boundary);
  if (stableJson(candidate.event) !== stableJson(expectedEvent)) {
    throw new Error("repair event plan body is not deterministically authorized");
  }
  const eventBytes = Buffer.from(`${JSON.stringify(expectedEvent)}\n`, "utf8");
  const separator =
    prefix.length > 0 && prefix[prefix.length - 1] !== 0x0a
      ? Buffer.from("\n", "utf8")
      : Buffer.alloc(0);
  const proposedBytes = Buffer.concat([prefix, separator, eventBytes]);
  if (
    eventBytes.length > CONTROL_EVENT_MAX_LINE_BYTES ||
    candidate.historyRecordCount + 1 > CONTROL_EVENT_HISTORY_MAX_RECORDS ||
    proposedBytes.length > CONTROL_EVENT_HISTORY_MAX_BYTES
  ) {
    throw new Error("repair event plan has no durable control history capacity");
  }
  if (
    eventPlanStageNamespace(plan, candidate, proposedBytes) !==
    candidate.stageNamespace
  ) {
    throw new Error("repair event plan staging namespace changed");
  }
  if (repairRecord === null) {
    if (
      stableJson(candidate.historyGeneration) !==
      stableJson(currentHistoryGeneration)
    ) {
      throw new Error("repair event plan predecessor generation changed");
    }
  } else if (
    repairRecord.index !== candidate.historyRecordCount ||
    repairRecord.start !== candidate.historySize + separator.length ||
    !repairRecord.raw.equals(eventBytes) ||
    eventHistory.bytes.length < proposedBytes.length ||
    !eventHistory.bytes.subarray(0, proposedBytes.length).equals(proposedBytes)
  ) {
    throw new Error("repair audit event is not the immediate exact plan successor");
  }
  return orderedOutcomeLedgerRepairEventPlan(candidate);
}

function buildPreparedRepairEventPlan(plan, bundle, eventHistory) {
  if ((eventHistory.recordsByEventId.get(plan.eventId) ?? []).length !== 0) {
    throw new Error("uncommitted prepared repair already has an audit event");
  }
  const boundary = validatePreRepairEventSuffix(plan, eventHistory, null);
  const event = deterministicRepairEvent(plan, boundary);
  const historyGeneration = bundleAuthorityGeneration(
    bundle.controlEventHistory,
    "control event history",
  );
  const historyParent = bundleAuthorityParent(
    bundle.controlEventHistory,
    "control event history",
  );
  const replacementGeneration = bundleAuthorityGeneration(
    bundle.outcomeLedger,
    "outcome ledger replacement",
  );
  const replacementParent = bundleAuthorityParent(
    bundle.outcomeLedger,
    "outcome ledger replacement",
  );
  const eventBytes = Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
  const separator =
    eventHistory.bytes.length > 0 &&
    eventHistory.bytes[eventHistory.bytes.length - 1] !== 0x0a
      ? Buffer.from("\n", "utf8")
      : Buffer.alloc(0);
  const proposedBytes = Buffer.concat([
    eventHistory.bytes,
    separator,
    eventBytes,
  ]);
  if (
    eventBytes.length > CONTROL_EVENT_MAX_LINE_BYTES ||
    eventHistory.records.length + 1 > CONTROL_EVENT_HISTORY_MAX_RECORDS ||
    proposedBytes.length > CONTROL_EVENT_HISTORY_MAX_BYTES
  ) {
    throw new Error("prepared repair event has no durable history capacity");
  }
  const candidate = orderedOutcomeLedgerRepairEventPlan({
    event,
    historyDigest: sha256(eventHistory.bytes),
    historyGeneration,
    historyParent,
    historyRecordCount: eventHistory.records.length,
    historySize: eventHistory.bytes.length,
    replacementGeneration,
    replacementParent,
    stageNamespace: "",
  });
  candidate.stageNamespace = eventPlanStageNamespace(
    plan,
    candidate,
    proposedBytes,
  );
  return orderedOutcomeLedgerRepairEventPlan(candidate);
}

function validateRepairEvent(plan, bundle, eventHistory) {
  const rawMatches = eventHistory.recordsByEventId.get(plan.eventId) ?? [];
  const indexed = bundle.outcomeRepairEventsById?.[plan.eventId];
  const effectivePhase =
    plan.phase === "prepared" && plan.preparedTransitionCommitted
      ? "replaced"
      : plan.phase;
  const eventPlan =
    plan.eventPlan ??
    (plan.preparedTransitionCommitted
      ? plan.preparedTransitionEventPlan
      : null);
  const required = ["audited", "complete"].includes(effectivePhase);
  const permitted =
    effectivePhase === "fenced"
      ? [0]
      : effectivePhase === "prepared"
        ? [0]
        : effectivePhase === "replaced"
          ? [0, 1]
          : [1];
  if (!permitted.includes(rawMatches.length)) {
    throw new Error("repair audit event multiplicity conflicts with phase");
  }
  if (
    ["replaced", "audited", "complete"].includes(effectivePhase) &&
    eventPlan === null
  ) {
    throw new Error("repair audit phase has no committed event plan");
  }
  const boundary = validatePreRepairEventSuffix(
    plan,
    eventHistory,
    rawMatches[0] ?? null,
  );
  if (rawMatches.length === 0) {
    if (indexed !== undefined) {
      throw new Error("repair audit event index exists without raw history");
    }
    return null;
  }
  const rawRecord = rawMatches[0];
  if (
    indexed === undefined ||
    indexed.recordIndex !== rawRecord.index ||
    stableJson(indexed.event) !== stableJson(rawRecord.event) ||
    !rawRecord.raw.equals(canonicalRepairEventBytes(plan, indexed.event)) ||
    (eventPlan !== null &&
      stableJson(indexed.event) !== stableJson(eventPlan.event))
  ) {
    throw new Error("repair audit event is not the indexed exact event body");
  }
  const event = indexed.event;
  if (
    event.type !== OUTCOME_LEDGER_REPAIR_EVENT_TYPE ||
    event.taskId !== plan.taskId ||
    stableJson(event.data?.parameters) !== stableJson(plan.parameters) ||
    event.data?.intentDigest !== plan.intentDigest ||
    stableJson(canonicalRepairAuthorization(event.data?.authorization)) !==
      stableJson(
        repairAuthorizationFromOwnerAcquisition(boundary.acquisition),
      ) ||
    event.ts !== boundary.deterministicTimestamp ||
    (required && indexed.recordIndex < 0)
  ) {
    throw new Error("repair audit event does not match its transaction");
  }
  return indexed;
}

function publicationIdentityRecord(identity) {
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

function samePublicationGeneration(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.uid === right.uid &&
    left.mode === right.mode &&
    left.linkCount === right.linkCount &&
    left.size === right.size &&
    left.digest === right.digest
  );
}

function ledgerPublicationIntentMaterial(plan, predecessor, replacement) {
  const archiveId = sha256(
    stableJson({
      operationId: plan.operationId,
      target: plan.paths.outcomes,
      predecessor,
    }),
  );
  const archiveName = path.join(
    "retired",
    `ledger-predecessor-${archiveId}.archive`,
  );
  const archivePath = path.join(plan.paths.artifactDirectory, archiveName);
  const intent = {
    schemaVersion: 1,
    kind: "outcome-ledger-replacement-publication",
    operationId: plan.operationId,
    targetPath: plan.paths.outcomes,
    predecessor: { ...publicationIdentityRecord(predecessor), archivePath },
    replacement: publicationIdentityRecord(replacement),
  };
  return {
    archiveName,
    archivePath,
    intent,
    bytes: Buffer.from(`${JSON.stringify(intent, null, 2)}\n`, "utf8"),
  };
}

function validateLedgerPublication(plan, bundle, tree, material, allowed) {
  const ledger = bundleLedgerFile(bundle);
  const intentName = path.join("publication-intents", "ledger-replacement.json");
  const intentFile = optionalTreeFile(tree, intentName, "ledger publication intent");
  const temporaryPath = `${plan.paths.outcomes}.${plan.operationId}.${plan.parameters.replacementDigest}.repair.tmp`;
  const temporaryAdmission = readAutomationPlanningAdmission(
    bundle,
    bundle.admitFile({
      filePath: temporaryPath,
      allowMissing: true,
      allowEmpty: true,
      maxBytes: OUTCOME_LEDGER_REPAIR_MAX_BYTES,
      allowedModes: [0o600],
      label: "Outcome ledger repair deterministic replacement stage",
    }),
  );
  const temporary = temporaryAdmission.missing
    ? null
    : {
        bytes: bytesFromAdmission(temporaryAdmission, "replacement stage"),
        identity: temporaryAdmission.identity,
      };
  const sourceLedger =
    !ledger.missing &&
    ledger.bytes.equals(material.source.bytes) &&
    [0o600, 0o640, 0o644].includes(ledger.identity?.mode) &&
    ledger.identity?.nlink === 1;
  if (intentFile === null) {
    if (plan.phase !== "prepared" || !sourceLedger) {
      throw new Error("repair phase lacks its durable ledger publication intent");
    }
    if (
      temporary !== null &&
      !material.trusted.bytes
        .subarray(0, temporary.bytes.length)
        .equals(temporary.bytes)
    ) {
      throw new Error("pre-intent replacement stage is not an exact prefix");
    }
    let intentTemporary = null;
    if (
      temporary !== null &&
      temporary.bytes.equals(material.trusted.bytes) &&
      ledger.identity?.mode === 0o600
    ) {
      const predecessor = treePublicationIdentity(plan.paths.outcomes, ledger);
      const replacement = treePublicationIdentity(temporaryPath, temporary);
      const expectedIntent = ledgerPublicationIntentMaterial(
        plan,
        predecessor,
        replacement,
      );
      const intentTemporaryName = path.join(
        "publication-intents",
        immutableTemporaryName(
          path.join(
            plan.paths.artifactDirectory,
            "publication-intents",
            "ledger-replacement.json",
          ),
          expectedIntent.bytes,
        ),
      );
      intentTemporary = optionalTreeFile(
        tree,
        intentTemporaryName,
        "ledger publication intent temporary",
      );
      if (intentTemporary !== null) {
        allowed.add(intentTemporaryName);
        if (
          intentTemporary.bytes.length > expectedIntent.bytes.length ||
          !expectedIntent.bytes
            .subarray(0, intentTemporary.bytes.length)
            .equals(intentTemporary.bytes)
        ) {
          throw new Error(
            "ledger publication intent temporary is not an exact prefix",
          );
        }
      }
    }
    return {
      topology:
        intentTemporary !== null
          ? "prepared-intent-stage"
          : temporary === null
            ? "prepared-source"
            : "prepared-stage",
    };
  }
  allowed.add(intentName);
  const intent = parseCanonicalJson(intentFile.bytes, "ledger publication intent");
  const predecessorValue = intent?.predecessor;
  const { archivePath, ...predecessorInput } = predecessorValue ?? {};
  const predecessor = requireIdentityRecord(
    predecessorInput,
    "ledger predecessor",
    { allowedModes: [0o600, 0o640, 0o644] },
  );
  const replacement = requireIdentityRecord(intent?.replacement, "ledger successor");
  const boundEventPlan = plan.eventPlan ?? plan.preparedTransitionEventPlan;
  const boundReplacement = boundEventPlan?.replacementGeneration;
  const expectedIntent = ledgerPublicationIntentMaterial(
    plan,
    predecessor,
    replacement,
  );
  const intentTemporaryName = path.join(
    "publication-intents",
    immutableTemporaryName(
      path.join(
        plan.paths.artifactDirectory,
        "publication-intents",
        "ledger-replacement.json",
      ),
      expectedIntent.bytes,
    ),
  );
  if (
    optionalTreeFile(
      tree,
      intentTemporaryName,
      "published ledger publication intent temporary",
    ) !== null
  ) {
    throw new Error("ledger publication has duplicate intent staging");
  }
  if (
    !intentFile.bytes.equals(expectedIntent.bytes) ||
    intent.schemaVersion !== 1 ||
    intent.kind !== "outcome-ledger-replacement-publication" ||
    intent.operationId !== plan.operationId ||
    intent.targetPath !== plan.paths.outcomes ||
    archivePath !== expectedIntent.archivePath ||
    predecessor.path !== plan.paths.outcomes ||
    predecessor.size !== plan.parameters.sourceSize ||
    predecessor.digest !== plan.parameters.sourceDigest ||
    replacement.path !== temporaryPath ||
    replacement.size !== plan.parameters.replacementSize ||
    replacement.digest !== plan.parameters.replacementDigest ||
    (boundReplacement !== undefined &&
      (String(boundReplacement.dev) !== replacement.device ||
        String(boundReplacement.ino) !== replacement.inode ||
        Number(boundReplacement.uid) !== replacement.uid ||
        (Number(boundReplacement.mode) & 0o7777) !== replacement.mode ||
        Number(boundReplacement.nlink) !== replacement.linkCount ||
        Number(boundReplacement.size) !== replacement.size ||
        boundReplacement.digest !== replacement.digest))
  ) {
    throw new Error("ledger publication intent is not exact canonical lineage");
  }
  const archive = optionalTreeFile(
    tree,
    expectedIntent.archiveName,
    "ledger predecessor archive",
    { allowedModes: [0o600, 0o640, 0o644] },
  );
  if (archive !== null) allowed.add(expectedIntent.archiveName);
  const archiveIsSource =
    archive !== null &&
    identityMatchesFile(predecessor, archive, material.source.bytes);
  const canonicalIsSource =
    sourceLedger &&
    ledger.identity.dev === predecessor.device &&
    ledger.identity.ino === predecessor.inode &&
    ledger.identity.uid === predecessor.uid &&
    ledger.identity.mode === predecessor.mode &&
    ledger.identity.nlink === predecessor.linkCount;
  const canonicalIsOriginalReplacementGeneration =
    !ledger.missing &&
    ledger.identity?.mode === 0o600 &&
    ledger.identity?.nlink === 1 &&
    ledger.identity.dev === replacement.device &&
    ledger.identity.ino === replacement.inode &&
    ledger.identity.uid === replacement.uid &&
    ledger.bytes.length >= material.trusted.bytes.length &&
    ledger.bytes.subarray(0, material.trusted.bytes.length).equals(material.trusted.bytes);
  const completedLedgerHasTrustedPrefix =
    plan.phase === "complete" &&
    !ledger.missing &&
    ledger.identity?.mode === 0o600 &&
    ledger.identity?.nlink === 1 &&
    ledger.bytes.length >= material.trusted.bytes.length &&
    ledger.bytes.subarray(0, material.trusted.bytes.length).equals(material.trusted.bytes);
  if (
    plan.phase === "complete" &&
    !ledger.missing &&
    ledger.identity?.mode !== 0o600
  ) {
    throw new Error(
      "completed repair requires a private canonical ledger with mode 0600",
    );
  }
  const temporaryIsReplacement =
    temporary !== null &&
    temporary.identity.dev === replacement.device &&
    temporary.identity.ino === replacement.inode &&
    temporary.identity.uid === replacement.uid &&
    temporary.identity.mode === replacement.mode &&
    temporary.identity.nlink === replacement.linkCount &&
    temporary.bytes.equals(material.trusted.bytes);
  if (canonicalIsSource && archive === null && temporaryIsReplacement) {
    if (plan.phase !== "prepared") throw new Error("ledger intent topology is stale");
    return { topology: "prepared-intent" };
  }
  if (ledger.missing && archiveIsSource && temporaryIsReplacement) {
    if (plan.phase !== "prepared") throw new Error("ledger archive topology is stale");
    return { topology: "prepared-predecessor-archived" };
  }
  if (
    (canonicalIsOriginalReplacementGeneration ||
      completedLedgerHasTrustedPrefix) &&
    archiveIsSource &&
    temporary === null
  ) {
    if (plan.phase !== "complete" && ledger.bytes.length !== material.trusted.bytes.length) {
      throw new Error("pending repair ledger gained an unauthorized suffix");
    }
    return { topology: `${plan.phase}-replacement-published` };
  }
  throw new Error("ledger publication topology conflicts with transaction phase");
}

function transitionPaths(plan, fromPhase, toPhase) {
  const name = `transaction-${fromPhase}-to-${toPhase}`;
  return {
    stagingName: path.join("transaction-staging", `${name}.json`),
    stagingPath: path.join(plan.paths.artifactDirectory, "transaction-staging", `${name}.json`),
    intentName: path.join("publication-intents", `${name}.json`),
    intentPath: path.join(plan.paths.artifactDirectory, "publication-intents", `${name}.json`),
  };
}

function resolvePreparedTransitionEventPlan(
  plan,
  tree,
  bundle,
  eventHistory,
) {
  if (plan.phase !== "prepared") {
    return Object.freeze({
      eventPlan: plan.eventPlan,
      committed: false,
      residue: false,
    });
  }
  const paths = transitionPaths(plan, "prepared", "replaced");
  const staging = optionalTreeFile(
    tree,
    paths.stagingName,
    "prepared-to-replaced successor staging",
  );
  const intent = optionalTreeFile(
    tree,
    paths.intentName,
    "prepared-to-replaced publication intent",
  );
  const stagingTemporaryPrefix = path.join(
    "transaction-staging",
    `.${path.basename(paths.stagingPath)}.`,
  );
  const intentTemporaryPrefix = path.join(
    "publication-intents",
    `.${path.basename(paths.intentPath)}.`,
  );
  const stagingTemporaries = [...tree.byPath.keys()].filter(
    (relativePath) =>
      relativePath.startsWith(stagingTemporaryPrefix) &&
      relativePath.endsWith(".tmp"),
  );
  const intentTemporaries = [...tree.byPath.keys()].filter(
    (relativePath) =>
      relativePath.startsWith(intentTemporaryPrefix) &&
      relativePath.endsWith(".tmp"),
  );
  const hasResidue =
    staging !== null ||
    intent !== null ||
    stagingTemporaries.length > 0 ||
    intentTemporaries.length > 0;
  if (!hasResidue) {
    return Object.freeze({
      eventPlan: null,
      committed: false,
      residue: false,
    });
  }
  if (
    stagingTemporaries.length > 1 ||
    intentTemporaries.length > 1 ||
    (staging === null && stagingTemporaries.length === 0) ||
    (intent !== null && staging === null) ||
    (intentTemporaries.length > 0 && staging === null)
  ) {
    throw new Error("prepared-to-replaced residue has an invalid topology");
  }

  let eventPlan;
  if (staging !== null) {
    const stagedRecord = parseCanonicalJson(
      staging.bytes,
      "prepared-to-replaced successor staging",
    );
    if (stagedRecord?.phase !== "replaced") {
      throw new Error("prepared-to-replaced staging has the wrong phase");
    }
    eventPlan = validateBoundRepairEventPlan(
      plan,
      stagedRecord.eventPlan,
      bundle,
      eventHistory,
    );
    const rebuilt = canonicalTransactionBytes(
      { ...plan, eventPlan, preparedTransitionEventPlan: eventPlan },
      "replaced",
    );
    if (!staging.bytes.equals(rebuilt)) {
      throw new Error(
        "prepared-to-replaced staging is not exact canonical raw JSON",
      );
    }
  } else {
    eventPlan = buildPreparedRepairEventPlan(plan, bundle, eventHistory);
  }

  if (intent === null) {
    const reconstructed = buildPreparedRepairEventPlan(
      plan,
      bundle,
      eventHistory,
    );
    if (stableJson(eventPlan) !== stableJson(reconstructed)) {
      throw new Error(
        "uncommitted prepared-to-replaced staging changed its deterministic event plan",
      );
    }
  }
  return Object.freeze({
    eventPlan: orderedOutcomeLedgerRepairEventPlan(eventPlan),
    committed: intent !== null,
    residue: true,
  });
}

function transitionIntentMaterial(
  plan,
  fromPhase,
  toPhase,
  predecessor,
  successor,
) {
  const archiveId = sha256(
    stableJson({
      operationId: plan.operationId,
      fromPhase,
      toPhase,
      predecessor,
      successor,
    }),
  );
  const archiveName = path.join(
    "retired",
    `transaction-${fromPhase}-predecessor-${archiveId}.archive`,
  );
  const archivePath = path.join(plan.paths.artifactDirectory, archiveName);
  const intent = {
    schemaVersion: 1,
    kind: "outcome-ledger-transaction-publication",
    operationId: plan.operationId,
    fromPhase,
    toPhase,
    targetPath: plan.paths.transaction,
    predecessor: publicationIdentityRecord(predecessor),
    successor: publicationIdentityRecord(successor),
    archivePath,
  };
  return {
    archiveName,
    archivePath,
    intent,
    bytes: Buffer.from(`${JSON.stringify(intent, null, 2)}\n`, "utf8"),
  };
}

function validateTransitionLineage(plan, canonical, tree, allowed) {
  const currentIndex = OUTCOME_LEDGER_REPAIR_PHASES.indexOf(plan.phase);
  const parsedIntents = [];
  for (const [index, [fromPhase, toPhase]] of TRANSACTION_TRANSITIONS.entries()) {
    const paths = transitionPaths(plan, fromPhase, toPhase);
    const successorBytes = canonicalTransactionBytes(plan, toPhase);
    const stagingTemporaryName = path.join(
      "transaction-staging",
      immutableTemporaryName(paths.stagingPath, successorBytes),
    );
    const intentFile = optionalTreeFile(
      tree,
      paths.intentName,
      "transaction phase intent",
    );
    const staging = optionalTreeFile(
      tree,
      paths.stagingName,
      "transaction phase staging",
    );
    const stagingTemporary = optionalTreeFile(
      tree,
      stagingTemporaryName,
      "transaction phase staging temporary",
    );
    if (staging !== null) allowed.add(paths.stagingName);
    if (stagingTemporary !== null) allowed.add(stagingTemporaryName);
    if (staging !== null && stagingTemporary !== null) {
      throw new Error(`transaction ${toPhase} has duplicate successor staging`);
    }
    if (
      stagingTemporary !== null &&
      (stagingTemporary.bytes.length > successorBytes.length ||
        !successorBytes
          .subarray(0, stagingTemporary.bytes.length)
          .equals(stagingTemporary.bytes))
    ) {
      throw new Error(
        `transaction ${toPhase} staging temporary is not an exact prefix`,
      );
    }
    if (intentFile === null) {
      if (
        index < currentIndex ||
        index > currentIndex ||
        (staging === null && stagingTemporary === null)
      ) {
        if (index < currentIndex) {
          throw new Error(`transaction ${toPhase} lineage intent is missing`);
        }
        if (
          index > currentIndex &&
          (staging !== null || stagingTemporary !== null)
        ) {
          throw new Error(`future transaction ${toPhase} staging exists`);
        }
        parsedIntents.push(null);
        continue;
      }
      if (stagingTemporary !== null) {
        parsedIntents.push(null);
        continue;
      }
      if (!staging.bytes.equals(successorBytes)) {
        throw new Error(`transaction ${toPhase} pre-intent staging changed`);
      }
      const predecessorBytes = canonicalTransactionBytes(plan, fromPhase);
      if (!canonical.bytes.equals(predecessorBytes)) {
        throw new Error(
          `transaction ${toPhase} pre-intent predecessor is not canonical`,
        );
      }
      const predecessor = treePublicationIdentity(
        plan.paths.transaction,
        canonical,
      );
      const successor = treePublicationIdentity(paths.stagingPath, staging);
      const expectedIntent = transitionIntentMaterial(
        plan,
        fromPhase,
        toPhase,
        predecessor,
        successor,
      );
      const intentTemporaryName = path.join(
        "publication-intents",
        immutableTemporaryName(paths.intentPath, expectedIntent.bytes),
      );
      const intentTemporary = optionalTreeFile(
        tree,
        intentTemporaryName,
        "transaction phase intent temporary",
      );
      if (intentTemporary !== null) {
        allowed.add(intentTemporaryName);
        if (
          intentTemporary.bytes.length > expectedIntent.bytes.length ||
          !expectedIntent.bytes
            .subarray(0, intentTemporary.bytes.length)
            .equals(intentTemporary.bytes)
        ) {
          throw new Error(
            `transaction ${toPhase} intent temporary is not an exact prefix`,
          );
        }
      }
      parsedIntents.push(null);
      continue;
    }
    allowed.add(paths.intentName);
    const intent = parseCanonicalJson(intentFile.bytes, "transaction phase intent");
    const predecessor = requireIdentityRecord(
      intent?.predecessor,
      "transaction predecessor",
    );
    const successor = requireIdentityRecord(intent?.successor, "transaction successor");
    const predecessorBytes = canonicalTransactionBytes(plan, fromPhase);
    const expectedIntent = transitionIntentMaterial(
      plan,
      fromPhase,
      toPhase,
      predecessor,
      successor,
    );
    const intentTemporaryName = path.join(
      "publication-intents",
      immutableTemporaryName(paths.intentPath, expectedIntent.bytes),
    );
    if (
      optionalTreeFile(
        tree,
        intentTemporaryName,
        "published transaction phase intent temporary",
      ) !== null
    ) {
      throw new Error(`transaction ${toPhase} has duplicate intent staging`);
    }
    if (
      !intentFile.bytes.equals(expectedIntent.bytes) ||
      predecessor.path !== plan.paths.transaction ||
      predecessor.size !== predecessorBytes.length ||
      predecessor.digest !== sha256(predecessorBytes) ||
      successor.path !== paths.stagingPath ||
      successor.size !== successorBytes.length ||
      successor.digest !== sha256(successorBytes) ||
      intent.archivePath !== expectedIntent.archivePath
    ) {
      throw new Error(`transaction ${toPhase} intent is not exact canonical lineage`);
    }
    const archive = optionalTreeFile(
      tree,
      expectedIntent.archiveName,
      "transaction predecessor archive",
    );
    if (archive !== null) allowed.add(expectedIntent.archiveName);
    const archiveIsPredecessor =
      archive !== null && identityMatchesFile(predecessor, archive, predecessorBytes);
    const stagingIsPredecessor =
      staging !== null && identityMatchesFile(predecessor, staging, predecessorBytes);
    const stagingIsSuccessor =
      staging !== null && identityMatchesFile(successor, staging, successorBytes);
    if (index < currentIndex - 1) {
      if (!archiveIsPredecessor || staging !== null) {
        throw new Error(`transaction ${toPhase} predecessor is not durably archived`);
      }
    } else if (index === currentIndex - 1) {
      const finalized = archiveIsPredecessor && staging === null;
      const postExchange = archive === null && stagingIsPredecessor;
      if (!finalized && !postExchange) {
        throw new Error(`transaction ${toPhase} recovery topology is invalid`);
      }
      if (!identityMatchesFile(successor, canonical, successorBytes)) {
        throw new Error(`transaction ${toPhase} successor is not canonical`);
      }
    } else if (index === currentIndex) {
      if (archive !== null || !stagingIsSuccessor) {
        throw new Error(`transaction ${toPhase} pre-exchange topology is invalid`);
      }
      if (!identityMatchesFile(predecessor, canonical, predecessorBytes)) {
        throw new Error(`transaction ${toPhase} predecessor is not canonical`);
      }
    } else {
      throw new Error(`future transaction ${toPhase} intent exists`);
    }
    parsedIntents.push({ predecessor, successor });
  }
  for (let index = 0; index + 1 < parsedIntents.length; index += 1) {
    const left = parsedIntents[index];
    const right = parsedIntents[index + 1];
    if (
      left !== null &&
      right !== null &&
      !samePublicationGeneration(left.successor, right.predecessor)
    ) {
      throw new Error("transaction phase successor chain forked");
    }
  }
}

function immutableTemporaryName(filePath, bytes) {
  return `.${path.basename(filePath)}.${sha256(bytes)}.tmp`;
}

function validateReceipt(plan, tree, allowed) {
  const receipt = optionalTreeFile(tree, "receipt.json", "repair receipt");
  const expectedBytes = Buffer.from(
    `${JSON.stringify(plan.receipt, null, 2)}\n`,
    "utf8",
  );
  const temporaryName = immutableTemporaryName(
    plan.paths.receiptArtifact,
    expectedBytes,
  );
  const temporary = optionalTreeFile(tree, temporaryName, "repair receipt staging");
  if (temporary !== null) allowed.add(temporaryName);
  if (receipt !== null) allowed.add("receipt.json");
  if (plan.phase === "complete") {
    if (receipt === null || !receipt.bytes.equals(expectedBytes) || temporary !== null) {
      throw new Error("complete repair does not have one exact receipt");
    }
  } else if (plan.phase === "audited") {
    if (
      (receipt !== null && !receipt.bytes.equals(expectedBytes)) ||
      (temporary !== null &&
        !expectedBytes.subarray(0, temporary.bytes.length).equals(temporary.bytes)) ||
      (receipt !== null && temporary !== null)
    ) {
      throw new Error("audited repair receipt publication is inconsistent");
    }
  } else if (receipt !== null || temporary !== null) {
    throw new Error("repair receipt exists before audit");
  }
}

function retirementTemporaryCandidates(plan, material) {
  const immutableCandidate = (filePath, bytes) => [
    path.join(path.dirname(filePath), immutableTemporaryName(filePath, bytes)),
    bytes,
  ];
  const candidates = [
    immutableCandidate(plan.paths.sourceArtifact, material.source.bytes),
    immutableCandidate(plan.paths.trustedArtifact, material.trusted.bytes),
    immutableCandidate(plan.paths.rejectedArtifact, material.rejected.bytes),
    immutableCandidate(plan.paths.decisionsArtifact, material.decisions.bytes),
  ];
  if (["audited", "complete"].includes(plan.phase)) {
    candidates.push(immutableCandidate(
      plan.paths.receiptArtifact,
      Buffer.from(`${JSON.stringify(plan.receipt, null, 2)}\n`, "utf8"),
    ));
  }
  candidates.push(
    [
      `${plan.paths.outcomes}.${plan.operationId}.${plan.parameters.replacementDigest}.repair.tmp`,
      material.trusted.bytes,
    ],
  );
  for (const phase of canonicalTransactionPhases(plan)) {
    const bytes = canonicalTransactionBytes(plan, phase);
    candidates.push(immutableCandidate(plan.paths.transaction, bytes));
  }
  const ledgerIntentPath = path.join(
    plan.paths.artifactDirectory,
    "publication-intents",
    "ledger-replacement.json",
  );
  const ledgerIntent = optionalTreeFile(
    material.tree,
    path.join("publication-intents", "ledger-replacement.json"),
    "ledger publication intent",
  );
  if (ledgerIntent !== null) {
    candidates.push(immutableCandidate(ledgerIntentPath, ledgerIntent.bytes));
  }
  for (const [fromPhase, toPhase] of TRANSACTION_TRANSITIONS) {
    const paths = transitionPaths(plan, fromPhase, toPhase);
    const stagingBytes = canonicalTransactionBytes(plan, toPhase);
    candidates.push(immutableCandidate(paths.stagingPath, stagingBytes));
    const intent = optionalTreeFile(
      material.tree,
      paths.intentName,
      "transaction phase intent",
    );
    if (intent !== null) {
      candidates.push(immutableCandidate(paths.intentPath, intent.bytes));
    }
  }
  return candidates;
}

function acceptExactRetiredTemporaries(plan, tree, material, allowed) {
  const candidates = retirementTemporaryCandidates(plan, {
    ...material,
    tree,
  });
  for (const [relativePath, entry] of tree.byPath) {
    const legacyMatch =
      /^retired\/temporary-v2\.([a-z]+)\.([0-9]{1,20}|[0-9a-f]{64})\.([0-9a-f]{64})\.([0-9a-f]{64})\.archive$/.exec(
        relativePath,
      );
    if (legacyMatch !== null) {
      const [, sourceClass, generation, quarantineSuffixDigest, archiveId] =
        legacyMatch;
      const receiptBytes = Buffer.from(
        `${JSON.stringify(plan.receipt, null, 2)}\n`,
        "utf8",
      );
      const legacyCandidates = new Map([
        [
          "transaction",
          {
            targetPath: plan.paths.transaction,
            expectedBytes: canonicalTransactionPhases(plan).map((phase) =>
              canonicalTransactionBytes(plan, phase),
            ),
          },
        ],
        [
          "source",
          {
            targetPath: plan.paths.sourceArtifact,
            expectedBytes: [material.source.bytes],
          },
        ],
        [
          "trusted",
          {
            targetPath: plan.paths.trustedArtifact,
            expectedBytes: [material.trusted.bytes],
          },
        ],
        [
          "rejected",
          {
            targetPath: plan.paths.rejectedArtifact,
            expectedBytes: [material.rejected.bytes],
          },
        ],
        [
          "decisions",
          {
            targetPath: plan.paths.decisionsArtifact,
            expectedBytes: [material.decisions.bytes],
          },
        ],
        [
          "receipt",
          {
            targetPath: plan.paths.receiptArtifact,
            expectedBytes: [receiptBytes],
          },
        ],
        [
          "replacement",
          {
            targetPath: plan.paths.outcomes,
            expectedBytes: [material.trusted.bytes],
          },
        ],
      ]);
      const candidate = legacyCandidates.get(sourceClass);
      if (candidate === undefined) {
        throw new Error("retired temporary has an unknown source class");
      }
      if (
        sourceClass === "receipt" &&
        !["audited", "complete"].includes(plan.phase)
      ) {
        throw new Error("retired receipt temporary exists before audit");
      }
      const file = fileFromTreeEntry(entry, "retired legacy repair temporary");
      if (
        !candidate.expectedBytes.some(
          (expected) =>
            file.bytes.length <= expected.length &&
            expected.subarray(0, file.bytes.length).equals(file.bytes),
        )
      ) {
        throw new Error("retired legacy temporary changed plan-bound bytes");
      }
      const lineage = {
        schemaVersion: 1,
        kind: "outcome-ledger-repair-temporary-retirement",
        operationId: plan.operationId,
        sourceClass,
        targetPath: candidate.targetPath,
        generation,
        quarantineSuffixDigest,
      };
      const expectedArchiveId = sha256(
        stableJson({
          lineage,
          device: String(file.identity.dev),
          inode: String(file.identity.ino),
          mode: file.identity.mode,
          linkCount: 1,
          size: file.bytes.length,
          digest: sha256(file.bytes),
        }),
      );
      if (archiveId !== expectedArchiveId) {
        throw new Error("retired legacy temporary lineage changed");
      }
      allowed.add(relativePath);
      continue;
    }
    const match = /^retired\/temporary-([0-9a-f]{64})\.archive$/.exec(relativePath);
    if (match === null) continue;
    const file = fileFromTreeEntry(entry, "retired repair temporary");
    const accepted = candidates.some(([filePath, expectedBytes]) => {
      if (
        file.bytes.length > expectedBytes.length ||
        !expectedBytes.subarray(0, file.bytes.length).equals(file.bytes)
      ) {
        return false;
      }
      const retirementId = sha256(
        stableJson({
          filePath,
          device: String(file.identity.dev),
          inode: String(file.identity.ino),
          mode: file.identity.mode,
          linkCount: 1,
          size: file.bytes.length,
          digest: sha256(file.bytes),
        }),
      );
      return retirementId === match[1];
    });
    if (!accepted) throw new Error("retired temporary has no exact owned lineage");
    allowed.add(relativePath);
  }
}

function acceptExactLiveRepairTemporaries(plan, tree, material, allowed) {
  const candidates = [
    [plan.paths.sourceArtifact, material.source.bytes],
    [plan.paths.trustedArtifact, material.trusted.bytes],
    [plan.paths.rejectedArtifact, material.rejected.bytes],
    [plan.paths.decisionsArtifact, material.decisions.bytes],
  ].map(([filePath, expectedBytes]) => ({
    name: path.basename(filePath),
    expectedBytes,
    digest: sha256(expectedBytes),
  }));
  const quarantineSuffix =
    "(?:\\.quarantine\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*";
  for (const [relativePath, entry] of tree.byPath) {
    if (allowed.has(relativePath) || relativePath.includes(path.sep)) continue;
    const candidate = candidates.find(({ name }) =>
      new RegExp(
        `^\\.${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\.([0-9]{1,20}|[0-9a-f]{64})\\.tmp(${quarantineSuffix})$`,
      ).test(relativePath),
    );
    if (candidate === undefined) continue;
    const match = new RegExp(
      `^\\.${candidate.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\.([0-9]{1,20}|[0-9a-f]{64})\\.tmp(${quarantineSuffix})$`,
    ).exec(relativePath);
    if (
      match === null ||
      (SHA256_PATTERN.test(match[1]) && match[1] !== candidate.digest)
    ) {
      throw new Error("live repair temporary has a foreign namespace");
    }
    const file = fileFromTreeEntry(entry, "live repair temporary");
    if (
      file.bytes.length > candidate.expectedBytes.length ||
      !candidate.expectedBytes
        .subarray(0, file.bytes.length)
        .equals(file.bytes)
    ) {
      throw new Error("live repair temporary changed plan-bound bytes");
    }
    allowed.add(relativePath);
  }
}

function validateArtifactInventory(plan, tree, material, allowed) {
  for (const directory of ["publication-intents", "transaction-staging", "retired"]) {
    const entry = tree.byPath.get(directory);
    if (entry === undefined) continue;
    if (entry.kind !== "directory" || entry.identity?.mode !== 0o700) {
      throw new Error(`artifact ${directory} is not one private directory`);
    }
    allowed.add(directory);
  }
  acceptExactRetiredTemporaries(plan, tree, material, allowed);
  for (const relativePath of tree.byPath.keys()) {
    if (!allowed.has(relativePath)) {
      throw new Error(`unexpected artifact tree entry ${relativePath || "."}`);
    }
  }
}

function treePublicationIdentity(filePath, file) {
  return {
    path: filePath,
    device: String(file.identity.dev),
    inode: String(file.identity.ino),
    uid: file.identity.uid,
    mode: file.identity.mode,
    linkCount: file.identity.nlink,
    size: file.bytes.length,
    digest: sha256(file.bytes),
  };
}

function validateFencedPreparedTransitionResidue(
  plan,
  canonical,
  tree,
  allowed,
) {
  const paths = transitionPaths(plan, "fenced", "prepared");
  const directoryNames = [
    "transaction-staging",
    "publication-intents",
    "retired",
  ];
  const directoryPresent = directoryNames.map((name) =>
    tree.byPath.has(name),
  );
  for (const [index, present] of directoryPresent.entries()) {
    if (!present) continue;
    if (index === 1 && !directoryPresent[0]) {
      throw new Error("fenced prepared transition directories are out of order");
    }
    const entry = tree.byPath.get(directoryNames[index]);
    if (entry.kind !== "directory" || entry.identity?.mode !== 0o700) {
      throw new Error(
        `fenced prepared transition ${directoryNames[index]} is not private`,
      );
    }
    allowed.add(directoryNames[index]);
  }

  const successorBytes = canonicalTransactionBytes(plan, "prepared");
  const stagingTemporaryName = path.join(
    "transaction-staging",
    immutableTemporaryName(paths.stagingPath, successorBytes),
  );
  const staging = optionalTreeFile(
    tree,
    paths.stagingName,
    "fenced prepared transaction staging",
  );
  const stagingTemporary = optionalTreeFile(
    tree,
    stagingTemporaryName,
    "fenced prepared transaction temporary",
  );
  if (staging !== null) allowed.add(paths.stagingName);
  if (stagingTemporary !== null) allowed.add(stagingTemporaryName);
  if (staging !== null && stagingTemporary !== null) {
    throw new Error("fenced prepared transition has duplicate successor staging");
  }
  if (
    (staging !== null || stagingTemporary !== null) &&
    directoryPresent.some((present) => !present)
  ) {
    throw new Error("fenced prepared staging precedes its private directories");
  }
  if (staging !== null && !staging.bytes.equals(successorBytes)) {
    throw new Error("fenced prepared successor staging changed bytes");
  }
  if (
    stagingTemporary !== null &&
    (stagingTemporary.bytes.length > successorBytes.length ||
      !successorBytes
        .subarray(0, stagingTemporary.bytes.length)
        .equals(stagingTemporary.bytes))
  ) {
    throw new Error("fenced prepared successor temporary is not an exact prefix");
  }

  const intent = optionalTreeFile(
    tree,
    paths.intentName,
    "fenced prepared transaction intent",
  );
  let intentTemporary = null;
  if (intent !== null || staging !== null) {
    if (staging === null) {
      throw new Error("fenced prepared intent precedes full successor staging");
    }
    const predecessor = treePublicationIdentity(
      plan.paths.transaction,
      canonical,
    );
    const successor = treePublicationIdentity(paths.stagingPath, staging);
    const archiveId = sha256(
      stableJson({
        operationId: plan.operationId,
        fromPhase: "fenced",
        toPhase: "prepared",
        predecessor,
        successor,
      }),
    );
    const archivePath = path.join(
      plan.paths.artifactDirectory,
      "retired",
      `transaction-fenced-predecessor-${archiveId}.archive`,
    );
    const expectedIntentBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "outcome-ledger-transaction-publication",
        operationId: plan.operationId,
        fromPhase: "fenced",
        toPhase: "prepared",
        targetPath: plan.paths.transaction,
        predecessor: publicationIdentityRecord(predecessor),
        successor: publicationIdentityRecord(successor),
        archivePath,
      }, null, 2)}\n`,
      "utf8",
    );
    const intentTemporaryName = path.join(
      "publication-intents",
      immutableTemporaryName(paths.intentPath, expectedIntentBytes),
    );
    intentTemporary = optionalTreeFile(
      tree,
      intentTemporaryName,
      "fenced prepared transaction intent temporary",
    );
    if (intent !== null) allowed.add(paths.intentName);
    if (intentTemporary !== null) allowed.add(intentTemporaryName);
    if (intent !== null && intentTemporary !== null) {
      throw new Error("fenced prepared transition has duplicate intent staging");
    }
    if (intent !== null && !intent.bytes.equals(expectedIntentBytes)) {
      throw new Error("fenced prepared transaction intent changed bytes");
    }
    if (
      intentTemporary !== null &&
      (intentTemporary.bytes.length > expectedIntentBytes.length ||
        !expectedIntentBytes
          .subarray(0, intentTemporary.bytes.length)
          .equals(intentTemporary.bytes))
    ) {
      throw new Error("fenced prepared intent temporary is not an exact prefix");
    }
  } else {
    const unexpectedIntentEntries = [...tree.byPath.keys()].filter(
      (relativePath) =>
        relativePath === paths.intentName ||
        relativePath.startsWith(
          path.join("publication-intents", `.${path.basename(paths.intentPath)}.`),
        ),
    );
    if (unexpectedIntentEntries.length > 0) {
      throw new Error("fenced prepared intent has no exact successor generation");
    }
  }

  for (const relativePath of tree.byPath.keys()) {
    if (!allowed.has(relativePath)) {
      throw new Error(
        `fenced prepared transition contains foreign entry ${relativePath || "."}`,
      );
    }
  }
  return directoryPresent.some(Boolean) ||
    staging !== null ||
    stagingTemporary !== null ||
    intent !== null ||
    intentTemporary !== null;
}

function validateFencedArtifactTree(plan, canonical, bundle, eventHistory) {
  const tree = admittedTree(bundle, plan.paths.artifactDirectory, {
    allowMissing: true,
  });
  validateRepairEvent(plan, bundle, eventHistory);
  if (tree.tree.missing) {
    return {
      tree,
      material: null,
      issues: [],
      recoverablePreparationResidue: false,
    };
  }
  const artifactNames = [
    path.basename(plan.paths.sourceArtifact),
    "trusted.jsonl",
    "rejected.jsonl",
    "decisions.json",
  ];
  const present = artifactNames.filter((name) => tree.byPath.has(name));
  if (tree.byPath.size === 1) {
    return {
      tree,
      material: null,
      issues: [],
      recoverablePreparationResidue: false,
    };
  }
  let recoverablePreparationResidue = true;
  const recognizedFinals = new Set(artifactNames);
  const nonPreparationEntries = [];
  for (const [relativePath, entry] of tree.byPath) {
    if (relativePath === "") continue;
    if (recognizedFinals.has(relativePath)) {
      const file = fileFromTreeEntry(entry, "fenced preparation artifact");
      if (
        relativePath === path.basename(plan.paths.sourceArtifact) &&
        (file.bytes.length !== plan.parameters.sourceSize ||
          sha256(file.bytes) !== plan.parameters.sourceDigest)
      ) {
        throw new Error("fenced source artifact conflicts with its plan");
      }
      if (
        relativePath === "trusted.jsonl" &&
        (file.bytes.length !== plan.parameters.replacementSize ||
          sha256(file.bytes) !== plan.parameters.replacementDigest)
      ) {
        throw new Error("fenced trusted artifact conflicts with its plan");
      }
      if (
        relativePath === "decisions.json" &&
        sha256(file.bytes) !== plan.parameters.decisionsDigest
      ) {
        throw new Error("fenced decisions artifact conflicts with its plan");
      }
      continue;
    }
    const temporary = /^\.(source-[0-9a-f]{64}\.jsonl|trusted\.jsonl|rejected\.jsonl|decisions\.json)\.([0-9a-f]{64})\.tmp$/.exec(
      relativePath,
    );
    if (temporary === null) {
      nonPreparationEntries.push(relativePath);
      continue;
    }
    const file = fileFromTreeEntry(entry, "fenced preparation staging");
    const retryCandidateIdentity =
      (temporary[1] === path.basename(plan.paths.sourceArtifact) &&
        temporary[2] === plan.parameters.sourceDigest) ||
      (temporary[1] === "trusted.jsonl" &&
        temporary[2] === plan.parameters.replacementDigest) ||
      temporary[1] === "rejected.jsonl" ||
      (temporary[1] === "decisions.json" &&
        temporary[2] === plan.parameters.decisionsDigest);
    if (!retryCandidateIdentity) {
      recoverablePreparationResidue = false;
    }
  }
  if (present.length !== artifactNames.length) {
    if (nonPreparationEntries.length > 0) {
      throw new Error(
        `fenced repair contains premature entry ${nonPreparationEntries[0]}`,
      );
    }
    return {
      tree,
      material: null,
      issues: [
        "fenced repair has partial preparation residue that requires exact repair recovery",
      ],
      recoverablePreparationResidue,
    };
  }
  const allowed = new Set([""]);
  const material = validateMaterial(plan, tree, allowed);
  const retired = tree.byPath.get("retired");
  if (retired !== undefined) {
    if (retired.kind !== "directory" || retired.identity?.mode !== 0o700) {
      throw new Error("fenced repair retired evidence is not private");
    }
    allowed.add("retired");
  }
  acceptExactLiveRepairTemporaries(plan, tree, material, allowed);
  acceptExactRetiredTemporaries(plan, tree, material, allowed);
  const ledger = bundleLedgerFile(bundle);
  if (
    ledger.missing ||
    ![0o600, 0o640, 0o644].includes(ledger.identity?.mode) ||
    ledger.identity?.nlink !== 1 ||
    !ledger.bytes.equals(material.source.bytes)
  ) {
    throw new Error("fenced repair no longer preserves its canonical source ledger");
  }
  const transitionResidue = validateFencedPreparedTransitionResidue(
    plan,
    canonical,
    tree,
    allowed,
  );
  return {
    tree,
    material,
    issues: transitionResidue
      ? [
          "fenced repair has prepared transition residue that requires exact repair recovery",
        ]
      : [],
    recoverablePreparationResidue: transitionResidue,
  };
}

function validateCanonicalTransaction(bundle, admission, eventHistory) {
  const bytes = bytesFromAdmission(admission, "repair transaction");
  const record = parseCanonicalJson(bytes, "repair transaction");
  if (
    record === null ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    Object.keys(record).sort().join("\n") !==
      [...OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS].sort().join("\n") ||
    !IDENTIFIER_PATTERN.test(String(record.taskId ?? "")) ||
    !OUTCOME_LEDGER_REPAIR_PHASES.includes(record.phase)
  ) {
    throw new Error("repair transaction has an invalid outer shape");
  }
  const parameters = requireParameters(record.parameters, {
    stateRoot: bundle.stateRoot,
    ledgerPath: bundle.ledgerPath,
    taskId: record.taskId,
  });
  const paths = repairPaths(
    bundle.stateRoot,
    record.taskId,
    parameters.operationId,
    parameters.sourceDigest,
  );
  const eventId = outcomeLedgerRepairEventId(parameters.operationId);
  const receipt = buildReceipt({
    taskId: record.taskId,
    operationId: parameters.operationId,
    eventId,
    parameters,
    paths,
  });
  const intent = {
    schemaVersion: 1,
    action: OUTCOME_LEDGER_REPAIR_ACTION,
    taskId: record.taskId,
    parameters,
  };
  const isPendingAdmission = admission.name === "pending.json";
  const isCompletedAdmission =
    admission.name === `${parameters.operationId}.json`;
  const plan = {
    taskId: record.taskId,
    operationId: parameters.operationId,
    phase: record.phase,
    intentDigest: ownerGovernanceIntentDigest(intent),
    eventId,
    parameters,
    receipt,
    paths,
    eventPlan: null,
    preparedTransitionEventPlan: null,
    preparedTransitionCommitted: false,
    completedAdmission: isCompletedAdmission,
  };
  if (["fenced", "prepared"].includes(record.phase)) {
    if (record.eventPlan !== null) {
      throw new Error("repair transaction binds its event plan too early");
    }
  } else {
    plan.eventPlan = validateBoundRepairEventPlan(
      plan,
      record.eventPlan,
      bundle,
      eventHistory,
    );
  }
  const expectedBytes = canonicalTransactionBytes(plan, record.phase);
  if (
    (!isPendingAdmission && !isCompletedAdmission) ||
    (isPendingAdmission && admission.filePath !== paths.transaction) ||
    (isCompletedAdmission && admission.filePath !== paths.completedTransaction) ||
    (isCompletedAdmission && record.phase !== "complete") ||
    record.operationId !== parameters.operationId ||
    record.eventId !== eventId ||
    record.intentDigest !== plan.intentDigest ||
    parameters.receiptDigest !== receipt.receiptDigest ||
    !bytes.equals(expectedBytes)
  ) {
    throw new Error("repair transaction is not exact canonical raw JSON");
  }
  const canonical = {
    bytes,
    identity: admission.identity,
  };
  if (
    canonical.identity?.mode !== 0o600 ||
    canonical.identity?.nlink !== 1
  ) {
    throw new Error("repair transaction is not one private generation");
  }
  if (record.phase === "fenced") {
    const fenced = validateFencedArtifactTree(
      plan,
      canonical,
      bundle,
      eventHistory,
    );
    return {
      plan,
      pending: true,
      active: true,
      issues: fenced.issues,
      recoverablePreparationResidue:
        fenced.recoverablePreparationResidue,
      summary: Object.freeze({
        operationId: plan.operationId,
        taskId: plan.taskId,
        phase: plan.phase,
      }),
    };
  }
  const tree = admittedTree(bundle, paths.artifactDirectory);
  const allowed = new Set([""]);
  const material = validateMaterial(plan, tree, allowed);
  const preparedTransition = resolvePreparedTransitionEventPlan(
    plan,
    tree,
    bundle,
    eventHistory,
  );
  plan.preparedTransitionEventPlan = preparedTransition.eventPlan;
  plan.preparedTransitionCommitted = preparedTransition.committed;
  validateLedgerPublication(plan, bundle, tree, material, allowed);
  validateRepairEvent(plan, bundle, eventHistory);
  validateTransitionLineage(plan, canonical, tree, allowed);
  validateReceipt(plan, tree, allowed);
  validateArtifactInventory(plan, tree, material, allowed);
  return {
    plan,
    pending: isPendingAdmission,
    active: isPendingAdmission,
    issues: [],
    recoverablePreparationResidue: false,
    summary: Object.freeze({
      operationId: plan.operationId,
      taskId: plan.taskId,
      phase: plan.phase,
    }),
  };
}

function expectedTransactionTemporaryNames(plan) {
  return new Map(
    canonicalTransactionPhases(plan).map((phase) => {
      const bytes = canonicalTransactionBytes(plan, phase);
      return [immutableTemporaryName(plan.paths.transaction, bytes), bytes];
    }),
  );
}

function canonicalTransactionPhases(plan) {
  return plan.eventPlan !== null || plan.preparedTransitionEventPlan !== null
    ? OUTCOME_LEDGER_REPAIR_PHASES
    : ["fenced", "prepared"];
}

function freezeResult(value) {
  return Object.freeze({
    exists: value.exists,
    healthy: value.healthy,
    pending: Object.freeze(value.pending.map((entry) => Object.freeze(entry))),
    issues: Object.freeze([...value.issues]),
  });
}

export function validateOutcomeLedgerRepairTransactionsFromPlanningBundle(bundle) {
  requireAutomationPlanningReadBundle(bundle);
  const eventHistory = indexControlEventHistory(bundle);
  const transactionState = bundle.outcomeRepairTransactions;
  const issues = [...transactionState.issues];
  const pending = [];
  const validated = new Map();
  const admissions = transactionState.admissions.map((token) =>
    readAutomationPlanningAdmission(bundle, token),
  );
  const canonicalAdmissions = admissions.filter((admission) =>
    /^(?:[0-9a-f]{64}|pending)\.json$/.test(admission.name),
  );
  let active = null;
  for (const admission of canonicalAdmissions) {
    try {
      const validation = validateCanonicalTransaction(
        bundle,
        admission,
        eventHistory,
      );
      if (validated.has(validation.plan.operationId)) {
        throw new Error("duplicate canonical transaction identity");
      }
      validated.set(validation.plan.operationId, validation);
      for (const issue of validation.issues) {
        issues.push(`${admission.name}: ${issue}`);
      }
      if (validation.active) {
        if (active !== null) {
          throw new Error("multiple active repair transactions are present");
        }
        active = validation;
      }
    } catch (error) {
      const cause =
        error &&
        typeof error === "object" &&
        typeof error.details?.cause === "string"
          ? `: ${error.details.cause}`
          : "";
      issues.push(
        `${admission.name}: ${error instanceof Error ? error.message : String(error)}${cause}`,
      );
    }
  }
  if (active !== null) {
    pending.push(
      Object.freeze({
        operationId: active.plan.operationId,
        taskId: active.plan.taskId,
        phase:
          active.plan.phase === "complete" ? "retiring" : active.plan.phase,
        recoverablePreparationResidue:
          active.plan.phase === "fenced" &&
          active.recoverablePreparationResidue === true,
      }),
    );
  }
  const pendingOperationIds = new Set(
    pending.map((entry) => entry.operationId),
  );
  const ledgerBasename = path.basename(bundle.ledgerPath);
  for (const validation of validated.values()) {
    const { operationId, replacementDigest } = validation.plan.parameters;
    const deterministicName =
      `${ledgerBasename}.${operationId}.${replacementDigest}.repair.tmp`;
    const hasActionableReplacementResidue = bundle.stateRootNames.some(
      (name) =>
        name !== deterministicName &&
        parseOutcomeLedgerRepairReplacementTemporaryName(name, {
          ledgerBasename,
          operationId,
        }) !== null,
    );
    if (
      hasActionableReplacementResidue &&
      !pendingOperationIds.has(operationId)
    ) {
      pending.push(
        Object.freeze({
          operationId,
          taskId: validation.plan.taskId,
          phase: "cleanup",
          recoverablePreparationResidue: false,
        }),
      );
      pendingOperationIds.add(operationId);
    }
  }
  const expectedTemporaryNames = new Map();
  for (const validation of validated.values()) {
    for (const [name, bytes] of expectedTransactionTemporaryNames(
      validation.plan,
    )) {
      if (expectedTemporaryNames.has(name)) {
        issues.push(`${name}: duplicate transaction staging identity`);
      } else {
        expectedTemporaryNames.set(name, bytes);
      }
    }
  }
  for (const admission of admissions) {
    if (/^(?:[0-9a-f]{64}|pending)\.json$/.test(admission.name)) continue;
    try {
      const expected = expectedTemporaryNames.get(admission.name);
      const admittedBytes = bytesFromAdmission(
        admission,
        "transaction staging",
      );
      const acceptedDeterministic =
        expected !== undefined &&
        admittedBytes.equals(expected);
      const legacyName =
        /^\.pending\.json\.(?:[0-9]{1,20}|[0-9a-f]{64})\.tmp(?:\.quarantine\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*$/.test(
          admission.name,
        );
      const operationMarker =
        active === null
          ? null
          : Buffer.from(
              `"operationId": "${active.plan.operationId}"`,
              "utf8",
            );
      const acceptedLegacy =
        legacyName &&
        active !== null &&
        operationMarker !== null &&
        admittedBytes.includes(operationMarker) &&
        canonicalTransactionPhases(active.plan).some((phase) => {
          const phaseBytes = canonicalTransactionBytes(active.plan, phase);
          return (
            admittedBytes.length <= phaseBytes.length &&
            phaseBytes.subarray(0, admittedBytes.length).equals(admittedBytes)
          );
        });
      if (!acceptedDeterministic && !acceptedLegacy) {
        issues.push(`${admission.name}: transaction staging has no exact lineage`);
      }
    } catch (error) {
      issues.push(`${admission.name}: transaction staging has no exact lineage`);
    }
  }
  const repairEvents = eventHistory.records.filter(
    (record) => record.event?.type === OUTCOME_LEDGER_REPAIR_EVENT_TYPE,
  );
  for (const record of repairEvents) {
    const operationId = String(record.event?.eventId ?? "").replace(
      /^outcome-history-repaired:/,
      "",
    );
    if (!validated.has(operationId)) {
      issues.push(
        `${String(record.event?.eventId ?? "unknown repair event")}: matching canonical transaction is missing or invalid`,
      );
    }
  }
  return freezeResult({
    exists: admissions.length > 0 || repairEvents.length > 0,
    healthy: issues.length === 0,
    pending,
    issues,
  });
}
