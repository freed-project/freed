import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  OUTCOME_LEDGER_REPAIR_ACTION,
  OUTCOME_LEDGER_REPAIR_ARTIFACT_KEYS,
  OUTCOME_LEDGER_REPAIR_DECISION_FORMAT,
  OUTCOME_LEDGER_REPAIR_EVENT_TYPE,
  OUTCOME_LEDGER_REPAIR_MAX_BYTES,
  OUTCOME_LEDGER_REPAIR_MAX_LINES,
  OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS,
  OUTCOME_LEDGER_REPAIR_PHASES,
  OUTCOME_LEDGER_REPAIR_POLICY,
  OUTCOME_LEDGER_REPAIR_RECEIPT_KEYS,
  OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
  OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS,
  outcomeLedgerRepairEventId,
  outcomeLedgerRepairOperationSeed,
  parseOutcomeLedgerRepairReplacementTemporaryName,
  validateOutcomeLedgerRepairArchivedMaterialBytes,
} from "./lib/outcome-ledger-repair-contract.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function archivedMaterialParameters({
  sourceBytes,
  trustedBytes,
  decisionBytes,
  sourceLineCount,
  trustedCount,
  rejectedCount,
}) {
  return {
    schemaVersion: OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION,
    policy: OUTCOME_LEDGER_REPAIR_POLICY,
    stateRoot: "/private/state",
    ledgerPath: "/private/state/outcomes.jsonl",
    operationId: "1".repeat(64),
    sourceDigest: sha256(sourceBytes),
    sourceSize: sourceBytes.length,
    sourceLineCount,
    eventHistoryDigest: "2".repeat(64),
    eventHistorySize: 0,
    trustedCount,
    rejectedCount,
    replacementDigest: sha256(trustedBytes),
    replacementSize: trustedBytes.length,
    archiveDigest: sha256(sourceBytes),
    decisionsDigest: sha256(decisionBytes),
    receiptDigest: "3".repeat(64),
  };
}

function archivedDecisionHeader(taskId, parameters) {
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

test("outcome ledger repair contract is exact and immutable", () => {
  assert.equal(OUTCOME_LEDGER_REPAIR_SCHEMA_VERSION, 1);
  assert.equal(
    OUTCOME_LEDGER_REPAIR_POLICY,
    "freed-outcome-ledger-repair-v1",
  );
  assert.equal(OUTCOME_LEDGER_REPAIR_ACTION, "outcome-ledger.repair");
  assert.equal(
    OUTCOME_LEDGER_REPAIR_EVENT_TYPE,
    "outcome_history_repaired",
  );
  assert.equal(OUTCOME_LEDGER_REPAIR_MAX_BYTES, 16 * 1024 * 1024);
  assert.equal(OUTCOME_LEDGER_REPAIR_MAX_LINES, 100_000);
  assert.deepEqual(OUTCOME_LEDGER_REPAIR_PHASES, [
    "fenced",
    "prepared",
    "replaced",
    "audited",
    "complete",
  ]);
  for (const value of [
    OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS,
    OUTCOME_LEDGER_REPAIR_ARTIFACT_KEYS,
    OUTCOME_LEDGER_REPAIR_RECEIPT_KEYS,
    OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS,
    OUTCOME_LEDGER_REPAIR_PHASES,
  ]) {
    assert.equal(Object.isFrozen(value), true);
    assert.equal(new Set(value).size, value.length);
  }
  assert.deepEqual(
    OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS,
    [...OUTCOME_LEDGER_REPAIR_PARAMETER_KEYS].sort(),
  );
  assert.deepEqual(
    OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS,
    [...OUTCOME_LEDGER_REPAIR_TRANSACTION_KEYS].sort(),
  );
});

test("outcome ledger repair identities use one canonical shape", () => {
  const parameters = {
    schemaVersion: 1,
    policy: "freed-outcome-ledger-repair-v1",
    stateRoot: "/private/state",
    ledgerPath: "/private/state/outcomes.jsonl",
    sourceDigest: "1".repeat(64),
    sourceSize: 10,
    sourceLineCount: 2,
    eventHistoryDigest: "2".repeat(64),
    eventHistorySize: 20,
    trustedCount: 1,
    rejectedCount: 1,
    replacementDigest: "3".repeat(64),
    replacementSize: 5,
    decisionsDigest: "4".repeat(64),
  };
  assert.deepEqual(outcomeLedgerRepairOperationSeed("repair-task", parameters), {
    ...parameters,
    taskId: "repair-task",
  });
  assert.equal(
    outcomeLedgerRepairEventId("a".repeat(64)),
    `outcome-history-repaired:${"a".repeat(64)}`,
  );
});

test("replacement temporary names use one shared actionable namespace", () => {
  const operationId = "a".repeat(64);
  const ledgerBasename = "outcomes.jsonl";
  assert.deepEqual(
    parseOutcomeLedgerRepairReplacementTemporaryName(
      `${ledgerBasename}.${operationId}.424206.repair.tmp`,
      { ledgerBasename, operationId },
    ),
    { generation: "424206", quarantineSuffix: "" },
  );
  assert.deepEqual(
    parseOutcomeLedgerRepairReplacementTemporaryName(
      `${ledgerBasename}.${operationId}.${"b".repeat(64)}.repair.tmp` +
        ".quarantine.11111111-2222-4333-8444-555555555555" +
        ".quarantine.66666666-7777-4888-8999-aaaaaaaaaaaa",
      { ledgerBasename, operationId },
    ),
    {
      generation: "b".repeat(64),
      quarantineSuffix:
        ".quarantine.11111111-2222-4333-8444-555555555555" +
        ".quarantine.66666666-7777-4888-8999-aaaaaaaaaaaa",
    },
  );
  for (const name of [
    `${ledgerBasename}.${"c".repeat(64)}.424206.repair.tmp`,
    `${ledgerBasename}.${operationId}.123456789012345678901.repair.tmp`,
    `${ledgerBasename}.${operationId}.424206.repair.tmp.quarantine.not-a-uuid`,
    `${ledgerBasename}.${operationId}.424206.repair.tmp.foreign`,
  ]) {
    assert.equal(
      parseOutcomeLedgerRepairReplacementTemporaryName(name, {
        ledgerBasename,
        operationId,
      }),
      null,
    );
  }
});

test("shared archived material validation reconstructs decision dispositions", () => {
  const taskId = "shared-archived-material-counts";
  const trustedLine = Buffer.from('{"trusted":true}\n', "utf8");
  const rejectedLine = Buffer.from('{"trusted":false}\n', "utf8");
  const sourceBytes = Buffer.concat([trustedLine, rejectedLine]);
  const trustedBytes = trustedLine;
  const rejectedBytes = rejectedLine;
  const placeholderDecisionBytes = Buffer.from("{}\n", "utf8");
  let parameters = archivedMaterialParameters({
    sourceBytes,
    trustedBytes,
    decisionBytes: placeholderDecisionBytes,
    sourceLineCount: 2,
    trustedCount: 2,
    rejectedCount: 0,
  });
  const decisionBytes = Buffer.from(
    `${JSON.stringify({
      ...archivedDecisionHeader(taskId, parameters),
      lines: [
        [1, 0, trustedLine.length, sha256(trustedLine), 0, 0],
        [
          2,
          trustedLine.length,
          rejectedLine.length,
          sha256(rejectedLine),
          1,
          1,
        ],
      ],
    })}\n`,
    "utf8",
  );
  parameters = { ...parameters, decisionsDigest: sha256(decisionBytes) };

  assert.throws(
    () =>
      validateOutcomeLedgerRepairArchivedMaterialBytes({
        taskId,
        parameters,
        sourceBytes,
        trustedBytes,
        rejectedBytes,
        decisionBytes,
      }),
    /archived bytes changed/i,
  );
});

test("shared archived material validation rejects invalid UTF-8 source bytes", () => {
  const sourceBytes = Buffer.from([0xff]);
  const trustedBytes = Buffer.alloc(0);
  const rejectedBytes = Buffer.from(sourceBytes);
  const decisionBytes = Buffer.from("{}\n", "utf8");
  const parameters = archivedMaterialParameters({
    sourceBytes,
    trustedBytes,
    decisionBytes,
    sourceLineCount: 1,
    trustedCount: 0,
    rejectedCount: 1,
  });

  assert.throws(
    () =>
      validateOutcomeLedgerRepairArchivedMaterialBytes({
        taskId: "shared-archived-material-utf8",
        parameters,
        sourceBytes,
        trustedBytes,
        rejectedBytes,
        decisionBytes,
      }),
    /not valid UTF-8/i,
  );
});

test("shared archived material validation rejects 100,001 physical lines", () => {
  const sourceBytes = Buffer.from("{}\n".repeat(100_001), "utf8");
  const trustedBytes = Buffer.alloc(0);
  const rejectedBytes = Buffer.from(sourceBytes);
  const decisionBytes = Buffer.from("{}\n", "utf8");
  const parameters = archivedMaterialParameters({
    sourceBytes,
    trustedBytes,
    decisionBytes,
    sourceLineCount: 100_001,
    trustedCount: 0,
    rejectedCount: 100_001,
  });

  assert.throws(
    () =>
      validateOutcomeLedgerRepairArchivedMaterialBytes({
        taskId: "shared-archived-material-line-cap",
        parameters,
        sourceBytes,
        trustedBytes,
        rejectedBytes,
        decisionBytes,
      }),
    /too many physical lines/i,
  );
});
