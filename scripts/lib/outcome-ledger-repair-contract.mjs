export const OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION = 1;
export const OUTCOME_LEDGER_REPAIR_POLICY =
  "freed-outcome-ledger-repair-v1";
export const OUTCOME_LEDGER_REPAIR_ACTION = "outcome-ledger.repair";
export const OUTCOME_LEDGER_REPAIR_EVENT_TYPE =
  "outcome_history_repaired";
export const OUTCOME_LEDGER_REPAIR_MAX_BYTES = 16 * 1024 * 1024;
export const OUTCOME_LEDGER_REPAIR_MAX_LINES = 100_000;

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

export const OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS = Object.freeze(
  [
    "artifacts",
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
