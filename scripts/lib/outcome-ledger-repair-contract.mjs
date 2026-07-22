import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

export const OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION = 1;
export const OUTCOME_LEDGER_REPAIR_POLICY =
  "freed-outcome-ledger-repair-v1";
export const OUTCOME_LEDGER_REPAIR_ACTION = "outcome-ledger.repair";
export const OUTCOME_LEDGER_REPAIR_EVENT_TYPE =
  "outcome_history_repaired";
export const OUTCOME_LEDGER_REPAIR_MAX_BYTES = 16 * 1024 * 1024;
export const OUTCOME_LEDGER_REPAIR_MAX_LINE_BYTES = 1024 * 1024;
export const OUTCOME_LEDGER_REPAIR_MAX_LINES = 100_000;
export const OUTCOME_LEDGER_REPAIR_DECISION_FORMAT =
  "freed-outcome-ledger-repair-decisions-fixed-tuples-v1";
const OUTCOME_LEDGER_REPAIR_QUARANTINE_SUFFIX_PATTERN =
  /^(?:\.quarantine\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*$/;

export function parseOutcomeLedgerRepairReplacementTemporaryName(
  name,
  { ledgerBasename, operationId },
) {
  if (
    typeof name !== "string" ||
    typeof ledgerBasename !== "string" ||
    ledgerBasename.length === 0 ||
    ledgerBasename.includes("/") ||
    ledgerBasename.includes("\0") ||
    !/^[0-9a-f]{64}$/.test(String(operationId ?? ""))
  ) {
    return null;
  }
  const prefix = `${ledgerBasename}.${operationId}.`;
  if (!name.startsWith(prefix)) return null;
  const match = /^([0-9]{1,20}|[0-9a-f]{64})\.repair\.tmp(.*)$/.exec(
    name.slice(prefix.length),
  );
  if (
    match === null ||
    !OUTCOME_LEDGER_REPAIR_QUARANTINE_SUFFIX_PATTERN.test(match[2])
  ) {
    return null;
  }
  return Object.freeze({
    generation: match[1],
    quarantineSuffix: match[2],
  });
}

export function requireOutcomeLedgerPhysicalBoundary(bytes) {
  let lineCount = 0;
  let offset = 0;
  while (offset < bytes.length) {
    const newline = bytes.indexOf(0x0a, offset);
    const end = newline === -1 ? bytes.length : newline;
    const physicalLineBytes =
      newline === -1 ? bytes.length - offset : newline + 1 - offset;
    if (physicalLineBytes > OUTCOME_LEDGER_REPAIR_MAX_LINE_BYTES) {
      throw new Error(
        "Outcome ledger contains a physical line beyond the supported byte boundary.",
      );
    }
    let contentEnd = end;
    if (contentEnd > offset && bytes[contentEnd - 1] === 0x0d) {
      contentEnd -= 1;
    }
    let hasContent = false;
    for (let index = offset; index < contentEnd; index += 1) {
      if (![0x09, 0x0b, 0x0c, 0x20].includes(bytes[index])) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      throw new Error("Outcome ledger contains a blank interior physical line.");
    }
    lineCount += 1;
    if (lineCount > OUTCOME_LEDGER_REPAIR_MAX_LINES) {
      throw new Error(
        "Outcome ledger exceeds the supported physical line boundary.",
      );
    }
    offset = newline === -1 ? bytes.length : newline + 1;
  }
  return lineCount;
}

export function prepareOutcomeLedgerAppend(admittedLedgerBytes, entry) {
  const separator =
    admittedLedgerBytes.length > 0 &&
    admittedLedgerBytes[admittedLedgerBytes.length - 1] !== 0x0a
      ? Buffer.from("\n", "utf8")
      : Buffer.alloc(0);
  const entryBytes = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
  const prospectiveSize =
    admittedLedgerBytes.length + separator.length + entryBytes.length;
  const existingLineCount =
    requireOutcomeLedgerPhysicalBoundary(admittedLedgerBytes);
  if (
    entryBytes.length > OUTCOME_LEDGER_REPAIR_MAX_LINE_BYTES ||
    prospectiveSize > OUTCOME_LEDGER_REPAIR_MAX_BYTES ||
    existingLineCount + 1 > OUTCOME_LEDGER_REPAIR_MAX_LINES
  ) {
    throw new Error(
      "Outcome ledger append would exceed the supported repair boundary.",
    );
  }
  return { separator, entryBytes };
}
export const OUTCOME_LEDGER_REPAIR_DECISION_REASON_CODES = Object.freeze({
  authenticated_outcome_provenance: 0,
  malformed_ledger_line: 1,
  missing_authenticated_provenance: 2,
  control_event_history_unavailable: 3,
  replayed_outcome_control_event: 4,
  invalid_outcome_evidence: 5,
  replayed_task_outcome_evidence: 6,
  outcome_control_event_mismatch: 7,
});
export const OUTCOME_LEDGER_REPAIR_DECISION_REASON_DESCRIPTIONS =
  Object.freeze([
    "Authenticated outcome provenance",
    "Malformed outcome ledger line",
    "Missing authenticated outcome provenance",
    "Control event history is missing or malformed",
    "Replayed outcome control event",
    "Invalid outcome evidence",
    "Replayed task outcome evidence",
    "Outcome does not match its authenticated control event",
  ]);
export const OUTCOME_LEDGER_REPAIR_DECISION_TUPLE_FIELDS = Object.freeze([
  "lineNumber",
  "offset",
  "length",
  "rawDigest",
  "disposition",
  "reasonCode",
]);

export function stableOutcomeRepairJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableOutcomeRepairJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableOutcomeRepairJson(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const archivedMaterialDecoder = new TextDecoder("utf-8", { fatal: true });

function archivedMaterialSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function archivedMaterialDecisionHeader(taskId, parameters) {
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

function archivedMaterialPhysicalJsonLines(bytes) {
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
      text = archivedMaterialDecoder.decode(content);
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
      digest: archivedMaterialSha256(raw),
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

export function validateOutcomeLedgerRepairArchivedMaterialBytes({
  taskId,
  parameters,
  sourceBytes,
  trustedBytes,
  rejectedBytes,
  decisionBytes,
}) {
  if (
    typeof taskId !== "string" ||
    taskId.length === 0 ||
    parameters === null ||
    typeof parameters !== "object" ||
    Array.isArray(parameters) ||
    ![sourceBytes, trustedBytes, rejectedBytes, decisionBytes].every(
      (bytes) =>
        Buffer.isBuffer(bytes) &&
        bytes.length <= OUTCOME_LEDGER_REPAIR_MAX_BYTES,
    )
  ) {
    throw new Error(
      "Outcome ledger repair archived material exceeds its canonical boundary.",
    );
  }
  if (
    sourceBytes.length !== parameters.sourceSize ||
    archivedMaterialSha256(sourceBytes) !== parameters.sourceDigest ||
    trustedBytes.length !== parameters.replacementSize ||
    archivedMaterialSha256(trustedBytes) !== parameters.replacementDigest ||
    archivedMaterialSha256(decisionBytes) !== parameters.decisionsDigest
  ) {
    throw new Error("Outcome ledger repair artifacts do not match their digests.");
  }
  const sourceLines = archivedMaterialPhysicalJsonLines(sourceBytes);
  if (sourceLines.length !== parameters.sourceLineCount) {
    throw new Error("Outcome ledger repair decisions lost source occurrences.");
  }
  let manifest;
  try {
    manifest = JSON.parse(archivedMaterialDecoder.decode(decisionBytes));
  } catch {
    throw new Error(
      "Outcome ledger repair decisions artifact is not valid UTF-8 JSON.",
    );
  }
  const { lines, ...actualHeader } = manifest ?? {};
  const expectedHeader = archivedMaterialDecisionHeader(taskId, parameters);
  if (
    stableOutcomeRepairJson(actualHeader) !==
      stableOutcomeRepairJson(expectedHeader) ||
    !Array.isArray(lines) ||
    lines.length !== sourceLines.length ||
    lines.length !== parameters.sourceLineCount
  ) {
    throw new Error("Outcome ledger repair decisions artifact identity changed.");
  }
  const trustedParts = [];
  const rejectedParts = [];
  for (const [index, sourceLine] of sourceLines.entries()) {
    const tuple = lines[index];
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 6 ||
      tuple[0] !== sourceLine.lineNumber ||
      tuple[1] !== sourceLine.offset ||
      tuple[2] !== sourceLine.length ||
      tuple[3] !== sourceLine.digest ||
      ![0, 1].includes(tuple[4]) ||
      !Number.isSafeInteger(tuple[5]) ||
      tuple[5] < 0 ||
      tuple[5] >= OUTCOME_LEDGER_REPAIR_DECISION_REASON_DESCRIPTIONS.length ||
      (tuple[4] === 0 && tuple[5] !== 0) ||
      (tuple[4] === 1 && tuple[5] === 0)
    ) {
      throw new Error(
        "Outcome ledger repair decisions artifact occurrence identity changed.",
      );
    }
    (tuple[4] === 0 ? trustedParts : rejectedParts).push(sourceLine.raw);
  }
  const canonicalDecisionBytes = Buffer.from(
    `${JSON.stringify({
      ...expectedHeader,
      lines: lines.map((tuple) => [...tuple]),
    })}\n`,
    "utf8",
  );
  if (!decisionBytes.equals(canonicalDecisionBytes)) {
    throw new Error(
      "Outcome ledger repair decisions artifact is not canonical compact JSON.",
    );
  }
  if (
    trustedParts.length !== parameters.trustedCount ||
    rejectedParts.length !== parameters.rejectedCount ||
    !trustedBytes.equals(Buffer.concat(trustedParts)) ||
    !rejectedBytes.equals(Buffer.concat(rejectedParts))
  ) {
    throw new Error("Outcome ledger repair archived bytes changed.");
  }
  return Object.freeze({
    sourceLineCount: sourceLines.length,
    trustedCount: trustedParts.length,
    rejectedCount: rejectedParts.length,
  });
}

export function outcomeLedgerRepairDecisionReasonCode(
  disposition,
  reason,
) {
  const codes = OUTCOME_LEDGER_REPAIR_DECISION_REASON_CODES;
  if (disposition === "trusted") {
    return codes.authenticated_outcome_provenance;
  }
  if (
    typeof reason === "string" &&
    reason.startsWith("malformed outcome ledger line ")
  ) {
    return codes.malformed_ledger_line;
  }
  return (
    {
      "missing authenticated outcome provenance":
        codes.missing_authenticated_provenance,
      "control event history is missing or malformed":
        codes.control_event_history_unavailable,
      "replayed outcome control event":
        codes.replayed_outcome_control_event,
      "replayed task outcome evidence":
        codes.replayed_task_outcome_evidence,
      "outcome does not match its authenticated control event":
        codes.outcome_control_event_mismatch,
    }[reason] ?? codes.invalid_outcome_evidence
  );
}

export const OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS = Object.freeze(
  [
    "archiveDigest",
    "decisionsDigest",
    "eventHistoryDigest",
    "eventHistorySize",
    "ledgerPath",
    "operationId",
    "policy",
    "receiptDigest",
    "rejectedCount",
    "replacementDigest",
    "replacementSize",
    "schemaVersion",
    "sourceDigest",
    "sourceLineCount",
    "sourceSize",
    "stateRoot",
    "trustedCount",
  ].sort(),
);

export function orderedOutcomeLedgerRepairParameters(parameters) {
  return Object.fromEntries(
    OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS.map((key) => [
      key,
      parameters[key],
    ]),
  );
}

export const OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS = Object.freeze(
  [
    "artifacts",
    "eventPlan",
    "eventId",
    "intentDigest",
    "operationId",
    "parameters",
    "phase",
    "policy",
    "receipt",
    "schemaVersion",
    "taskId",
  ].sort(),
);

export const OUTCOME_LEDGER_REPAIR_EVENT_PLAN_KEYS = Object.freeze(
  [
    "event",
    "historyDigest",
    "historyGeneration",
    "historyParent",
    "historyRecordCount",
    "historySize",
    "replacementGeneration",
    "replacementParent",
    "stageNamespace",
  ].sort(),
);

export const OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_GENERATION_KEYS =
  Object.freeze(
    [
      "ctimeNs",
      "dev",
      "digest",
      "gid",
      "ino",
      "missing",
      "mode",
      "mtimeNs",
      "nlink",
      "size",
      "uid",
    ].sort(),
  );

export const OUTCOME_LEDGER_REPAIR_EVENT_HISTORY_PARENT_KEYS = Object.freeze(
  ["dev", "ino", "mode", "uid"].sort(),
);

function orderedOutcomeLedgerRepairAuthorization(authorization) {
  const common = {
    leaseName: authorization?.leaseName,
    leaseAcquiredAt: authorization?.leaseAcquiredAt,
    credentialKind: authorization?.credentialKind,
  };
  if (authorization?.credentialKind === "owner-signed-capability") {
    return {
      ...common,
      ownerCapabilityId: authorization.ownerCapabilityId,
      ownerCapabilityTaskId: authorization.ownerCapabilityTaskId,
      ownerCapabilityIntentDigest: authorization.ownerCapabilityIntentDigest,
    };
  }
  if (authorization?.credentialKind === "owner-confirmation") {
    return {
      ...common,
      ownerConfirmationId: authorization.ownerConfirmationId,
      ownerConfirmationTaskId: authorization.ownerConfirmationTaskId,
      ownerConfirmationIntentDigest:
        authorization.ownerConfirmationIntentDigest,
      ownerConfirmationDigest: authorization.ownerConfirmationDigest,
      ownerConfirmationReference: authorization.ownerConfirmationReference,
      ownerConfirmationApprovedBy: authorization.ownerConfirmationApprovedBy,
      ownerConfirmationApprovalReference:
        authorization.ownerConfirmationApprovalReference,
      ownerConfirmationApprovedAt: authorization.ownerConfirmationApprovedAt,
      ownerConfirmationExpiresAt: authorization.ownerConfirmationExpiresAt,
    };
  }
  return structuredClone(authorization);
}

function orderedOutcomeLedgerRepairEvent(event) {
  return {
    schemaVersion: event?.schemaVersion,
    eventId: event?.eventId,
    type: event?.type,
    ts: event?.ts,
    actor: event?.actor,
    taskId: event?.taskId,
    data: {
      intentDigest: event?.data?.intentDigest,
      parameters: orderedOutcomeLedgerRepairParameters(
        event?.data?.parameters ?? {},
      ),
      authorization: orderedOutcomeLedgerRepairAuthorization(
        event?.data?.authorization,
      ),
    },
  };
}

function orderedOutcomeLedgerRepairGeneration(generation) {
  return {
    missing: generation?.missing,
    dev: generation?.dev,
    ino: generation?.ino,
    mode: generation?.mode,
    nlink: generation?.nlink,
    uid: generation?.uid,
    gid: generation?.gid,
    size: generation?.size,
    mtimeNs: generation?.mtimeNs,
    ctimeNs: generation?.ctimeNs,
    digest: generation?.digest,
  };
}

function orderedOutcomeLedgerRepairParent(parent) {
  return {
    dev: parent?.dev,
    ino: parent?.ino,
    mode: parent?.mode,
    uid: parent?.uid,
  };
}

export function orderedOutcomeLedgerRepairEventPlan(eventPlan) {
  return {
    event: orderedOutcomeLedgerRepairEvent(eventPlan?.event),
    historyDigest: eventPlan?.historyDigest,
    historyGeneration: orderedOutcomeLedgerRepairGeneration(
      eventPlan?.historyGeneration,
    ),
    historyParent: orderedOutcomeLedgerRepairParent(eventPlan?.historyParent),
    historyRecordCount: eventPlan?.historyRecordCount,
    historySize: eventPlan?.historySize,
    replacementGeneration: orderedOutcomeLedgerRepairGeneration(
      eventPlan?.replacementGeneration,
    ),
    replacementParent: orderedOutcomeLedgerRepairParent(
      eventPlan?.replacementParent,
    ),
    stageNamespace: eventPlan?.stageNamespace,
  };
}

export const OUTCOME_LEDGER_REPAIR_ARTIFACT_KEYS = Object.freeze(
  ["decisions", "receipt", "rejected", "source", "trusted"].sort(),
);

export const OUTCOME_LEDGER_REPAIR_RECEIPT_KEYS = Object.freeze(
  [
    "archiveDigest",
    "decisionsArtifact",
    "decisionsDigest",
    "eventHistoryDigest",
    "eventHistorySize",
    "eventId",
    "ledgerPath",
    "operationId",
    "policy",
    "receiptDigest",
    "rejectedArtifact",
    "rejectedCount",
    "replacementDigest",
    "replacementSize",
    "schemaVersion",
    "sourceArtifact",
    "sourceDigest",
    "sourceLineCount",
    "sourceSize",
    "stateRoot",
    "status",
    "taskId",
    "trustedArtifact",
    "trustedCount",
  ].sort(),
);

export const OUTCOME_LEDGER_REPAIR_PHASES = Object.freeze([
  "fenced",
  "prepared",
  "replaced",
  "audited",
  "complete",
]);

export function outcomeLedgerRepairEventId(operationId) {
  return `outcome-history-repaired:${operationId}`;
}

export function outcomeLedgerRepairOperationSeed(taskId, parameters) {
  return {
    schemaVersion: parameters.schemaVersion,
    policy: parameters.policy,
    stateRoot: parameters.stateRoot,
    ledgerPath: parameters.ledgerPath,
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
    decisionsDigest: parameters.decisionsDigest,
  };
}
