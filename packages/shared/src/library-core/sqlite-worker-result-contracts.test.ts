import { describe, expect, it } from "vitest";
import {
  parseLibraryCoreFollowerActorEnrollmentContextV2,
  parseLibraryCoreFollowerActorEnrollmentReceiptV2,
} from "./follower-actor-enrollment-contracts.js";
import {
  parseLibraryCoreFollowerIntentCommitResultV1,
  parseLibraryCoreFollowerIntentPublicationReceiptV1,
} from "./follower-intent-contracts.js";
import { parseLibraryCoreFollowerResultApplyReceiptV1 } from "./follower-result-contracts.js";
import { parseLibraryCoreNormalizedIntentTransportPublicationReceiptV2 } from "./normalized-intent-segment-contracts.js";
import { parseLibraryCoreNormalizedOperationImportReceiptV2 } from "./normalized-operation-replication-contracts.js";
import { parseLibraryCoreNormalizedResultTransportImportReceiptV2 } from "./normalized-result-segment-contracts.js";
import {
  parseLibraryCoreScopeActionStagePageV1,
  parseLibraryCoreScopeActionStageStatusV1,
} from "./scope-action-contracts.js";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
} from "./sqlite-contract.generated.js";
import { parseLibraryCoreSqliteWorkerStatus } from "./sqlite-worker-protocol.js";

type ThrowingParser = (value: unknown) => unknown;

const HEX_1 = "11".repeat(32);
const HEX_2 = "22".repeat(32);
const HEX_3 = "33".repeat(32);

const closedReceipts: readonly Readonly<{
  readonly label: string;
  readonly parse: ThrowingParser;
  readonly value: Readonly<Record<string, unknown>>;
}>[] = [
  {
    label: "scope status",
    parse: parseLibraryCoreScopeActionStageStatusV1,
    value: { memberCount: 2, stageId: "scope-1", state: "ready" },
  },
  {
    label: "scope page",
    parse: parseLibraryCoreScopeActionStagePageV1,
    value: {
      entityIds: ["item-1", "item-2"],
      nextOrdinal: 1,
      stageId: "scope-1",
    },
  },
  {
    label: "intent commit",
    parse: parseLibraryCoreFollowerIntentCommitResultV1,
    value: {
      actorId: HEX_1,
      firstCounter: 4,
      lastCounter: 5,
      memberCount: 2,
      optimisticFieldCount: 2,
      state: "pending",
      transactionId: "transaction-1",
    },
  },
  {
    label: "intent publication",
    parse: parseLibraryCoreFollowerIntentPublicationReceiptV1,
    value: {
      actorId: HEX_1,
      publishedAt: 10,
      state: "published",
      transactionId: "transaction-1",
    },
  },
  {
    label: "follower result",
    parse: parseLibraryCoreFollowerResultApplyReceiptV1,
    value: {
      actorId: HEX_1,
      resultDigest: HEX_2,
      resultSequence: 1,
      sourceRevision: 4,
      status: "accepted",
      transactionId: "transaction-1",
    },
  },
  {
    label: "normalized intent publication",
    parse: parseLibraryCoreNormalizedIntentTransportPublicationReceiptV2,
    value: {
      actorId: HEX_1,
      firstActorCounter: 1,
      lastActorCounter: 2,
      newlyPublishedTransactionCount: 2,
      nextActorCounter: 3,
      publishedAt: 10,
      semanticSegmentDigest: HEX_2,
      storedSegmentDigest: HEX_3,
    },
  },
  {
    label: "normalized result import",
    parse: parseLibraryCoreNormalizedResultTransportImportReceiptV2,
    value: {
      acceptedTransactionCount: 1,
      actorId: HEX_1,
      firstResultSequence: 1,
      lastResultSequence: 2,
      nextResultSequence: 3,
      receivedAt: 10,
      rejectedTransactionCount: 1,
      resultCount: 2,
      semanticSegmentDigest: HEX_2,
      storedSegmentDigest: HEX_3,
    },
  },
  {
    label: "normalized operation import",
    parse: parseLibraryCoreNormalizedOperationImportReceiptV2,
    value: {
      appliedThroughRevision: 8,
      appliedTransactionCount: 2,
      receivedAt: 10,
      stagedRecordCount: 3,
      stagedTransactionCount: 2,
    },
  },
  {
    label: "follower enrollment context",
    parse: parseLibraryCoreFollowerActorEnrollmentContextV2,
    value: {
      authority: {
        authority_key_id: HEX_1,
        authority_public_key: HEX_2,
        epoch: 1,
        epoch_id: HEX_3,
        library_id: HEX_1,
        observed_frontier: [],
      },
      request: null,
      schemaVersion: 2,
    },
  },
  {
    label: "follower enrollment receipt",
    parse: parseLibraryCoreFollowerActorEnrollmentReceiptV2,
    value: {
      actorChainGenesis: HEX_1,
      actorId: HEX_2,
      actorPublicKey: HEX_3,
      enrolledAt: 10,
      enrollmentCertificateDigest: HEX_1,
    },
  },
  {
    label: "worker status",
    parse: parseLibraryCoreSqliteWorkerStatus,
    value: {
      connectionGeneration: 1,
      contractVersion: LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
      engine: "sqlite-wasm-opfs-sahpool",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      schemaSha256: LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
      schemaVersion: LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
      sqliteVersion: "3.50.4",
      storage: "opfs",
    },
  },
];

describe("SQLite worker result contracts", () => {
  for (const receipt of closedReceipts) {
    it(`accepts and snapshots the closed ${receipt.label}`, () => {
      const parsed = receipt.parse(receipt.value);
      expect(parsed).toEqual(receipt.value);
      expect(Object.isFrozen(parsed)).toBe(true);
    });

    it(`rejects an unknown field in the ${receipt.label}`, () => {
      expect(() =>
        receipt.parse({ ...receipt.value, unknown: true }),
      ).toThrow();
    });
  }
});
