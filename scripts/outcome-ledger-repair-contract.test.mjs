import assert from "node:assert/strict";
import test from "node:test";

import {
  OUTCOME_LEDGER_REPAIR_ACTION,
  OUTCOME_LEDGER_REPAIR_ARTIFACT_KEYS,
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
} from "./lib/outcome-ledger-repair-contract.mjs";

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
