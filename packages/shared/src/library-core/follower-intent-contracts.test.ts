import { describe, expect, it } from "vitest";
import {
  parseLibraryCoreFollowerIntentCommitV1,
  parseLibraryCoreFollowerIntentPageRequestV1,
  parseLibraryCoreFollowerIntentPageResponseV1,
} from "./follower-intent-contracts.js";

describe("follower intent commit contract", () => {
  it("snapshots bounded signed envelope bytes", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const parsed = parseLibraryCoreFollowerIntentCommitV1({
      envelopeBytes: [bytes],
    });
    bytes[0] = 9;
    expect(parsed.envelopeBytes[0]).toEqual(Uint8Array.from([1, 2, 3]));
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.envelopeBytes)).toBe(true);
  });

  it("rejects aliases, sparse arrays, unknown fields, and oversized members", () => {
    const sparse: Uint8Array[] = [];
    sparse.length = 1;
    expect(() =>
      parseLibraryCoreFollowerIntentCommitV1({ envelopeBytes: sparse }),
    ).toThrow(/Uint8Array/);
    expect(() =>
      parseLibraryCoreFollowerIntentCommitV1({
        envelopeBytes: [Uint8Array.of(1)],
        sql: "SELECT 1",
      }),
    ).toThrow(/field set/);
    expect(() =>
      parseLibraryCoreFollowerIntentCommitV1({
        envelopeBytes: [new Uint8Array(131_073)],
      }),
    ).toThrow(/131,072/);
  });
});

describe("follower intent page contract", () => {
  const record = {
    actorCounter: 1,
    actorId: "actor-1",
    canonicalEnvelopeJson: '{"operation_id":"operation-1"}',
    intentEpoch: 1,
    intentEpochId: "epoch-1",
    memberCount: 1,
    memberIndex: 0,
    operationId: "operation-1",
    state: "pending" as const,
    transactionDigest: "a".repeat(64),
    transactionId: "transaction-1",
  };

  it("closes actor-bound requests and exact member pages", () => {
    const request = parseLibraryCoreFollowerIntentPageRequestV1({
      actorId: "actor-1",
      cursor: null,
      limit: 128,
      schemaVersion: 1,
    });
    expect(Object.isFrozen(request)).toBe(true);
    const response = parseLibraryCoreFollowerIntentPageResponseV1({
      actorId: "actor-1",
      done: true,
      nextCursor: {
        actorCounter: 1,
        operationId: "operation-1",
        transactionId: "transaction-1",
      },
      records: [record],
      schemaVersion: 1,
    });
    expect(response.records).toEqual([record]);
    expect(Object.isFrozen(response.records)).toBe(true);
  });

  it("preserves one maximum-sized canonical member without splitting it", () => {
    const canonicalEnvelopeJson = `{"x":"${"a".repeat(131_064)}"}`;
    expect(new TextEncoder().encode(canonicalEnvelopeJson)).toHaveLength(
      131_072,
    );
    const response = parseLibraryCoreFollowerIntentPageResponseV1({
      actorId: "actor-1",
      done: true,
      nextCursor: {
        actorCounter: 1,
        operationId: "operation-1",
        transactionId: "transaction-1",
      },
      records: [{ ...record, canonicalEnvelopeJson }],
      schemaVersion: 1,
    });
    expect(response.records[0]?.canonicalEnvelopeJson).toBe(
      canonicalEnvelopeJson,
    );
  });

  it("rejects cursor aliases, cross-actor rows, reordering, and unknown fields", () => {
    expect(() =>
      parseLibraryCoreFollowerIntentPageRequestV1({
        actorId: "actor-1",
        cursor: null,
        limit: 129,
        schemaVersion: 1,
      }),
    ).toThrow(/invalid/);
    expect(() =>
      parseLibraryCoreFollowerIntentPageResponseV1({
        actorId: "actor-1",
        done: false,
        nextCursor: {
          actorCounter: 1,
          operationId: "operation-3",
          transactionId: "transaction-2",
        },
        records: [
          record,
          {
            ...record,
            actorCounter: 1,
            operationId: "operation-3",
            transactionId: "transaction-2",
          },
        ],
        schemaVersion: 1,
      }),
    ).toThrow(/record is invalid/);
    expect(() =>
      parseLibraryCoreFollowerIntentPageResponseV1({
        actorId: "actor-1",
        done: true,
        nextCursor: {
          actorCounter: 1,
          operationId: "operation-1",
          transactionId: "transaction-1",
        },
        records: [{ ...record, actorId: "actor-2" }],
        schemaVersion: 1,
      }),
    ).toThrow(/record is invalid/);
  });
});
