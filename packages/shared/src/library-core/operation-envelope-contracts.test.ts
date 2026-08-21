import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  encodeLibraryCoreDigestInput,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS,
  PERSON_REACH_OUT_APPEND_TRANSACTION_MEMBER_SCHEMA,
  type LibraryCoreConstructionDigestDomain,
  type FeedItemReadAssignmentTransactionMemberInputV1,
} from "./operation-envelope-contracts.js";

const HEX = {
  library: "11".repeat(32),
  epoch: "22".repeat(32),
  actorA: "33".repeat(32),
  actorB: "44".repeat(32),
  chainA: "55".repeat(32),
  chainB: "66".repeat(32),
} as const;

function digest(
  domain: LibraryCoreConstructionDigestDomain,
  value: unknown,
): string {
  return createHash("sha256")
    .update(
      encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue),
    )
    .digest("hex");
}

function validInput(): FeedItemReadAssignmentTransactionMemberInputV1 {
  return {
    operation_id: "op:read:fixture:1",
    library_id: HEX.library,
    epoch: 1,
    epoch_id: HEX.epoch,
    actor_id: HEX.actorA,
    actor_sequence: 2,
    previous_actor_operation_id: "op:read:fixture:0",
    causal_frontier: [
      {
        actor_id: HEX.actorA,
        sequence: 1,
        operation_id: "op:read:fixture:0",
        chain_digest: HEX.chainA,
      },
      {
        actor_id: HEX.actorB,
        sequence: 9,
        operation_id: "op:other:fixture:9",
        chain_digest: HEX.chainB,
      },
    ],
    hlc_wall_ms: 1_000,
    hlc_counter: 0,
    transaction_id: "tx:read:fixture:1",
    transaction_member_index: 0,
    transaction_member_count: 1,
    entity_id: "rss:entry:fixture",
    payload: { read_at_ms: 900 },
    created_at_ms: 1_000,
  };
}

describe("Library Core read-assignment transaction-member schema", () => {
  it("constructs one exact immutable member body and domain-separated digest", () => {
    const input = validInput();
    const result =
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(input, {
        digest,
      });

    expect(result.body).toStrictEqual({
      operation_id: "op:read:fixture:1",
      library_id: HEX.library,
      epoch: 1,
      epoch_id: HEX.epoch,
      schema_version: 1,
      actor_id: HEX.actorA,
      actor_sequence: 2,
      previous_actor_operation_id: "op:read:fixture:0",
      causal_frontier: input.causal_frontier,
      hlc_wall_ms: 1_000,
      hlc_counter: 0,
      transaction_id: "tx:read:fixture:1",
      transaction_member_index: 0,
      transaction_member_count: 1,
      operation_type: "feed_item_read_assignment",
      entity_type: "FeedItem",
      entity_id: "rss:entry:fixture",
      payload: { read_at_ms: 900 },
      payload_digest:
        "974ea35667cab4f2c8320fe2b1a182c11f69d1ac9813aede57441b9c6eec8e79",
      blob_references: [],
      created_at_ms: 1_000,
      signature_algorithm: "ed25519",
    });
    expect(result.member_digest).toBe(
      "fffc8dcd76ff6405455b70481f45619ed913860728cd29a67a81d04f21f6d1cd",
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.body)).toBe(true);
    expect(Object.isFrozen(result.body.payload)).toBe(true);
    expect(Object.isFrozen(result.body.causal_frontier)).toBe(true);
    expect(Object.isFrozen(result.body.causal_frontier[0])).toBe(true);
    expect(Object.isFrozen(result.body.blob_references)).toBe(true);
    expect(Object.getOwnPropertySymbols(result)).toHaveLength(0);
  });

  it("snapshots caller-owned values before later mutation", () => {
    const input = validInput();
    const result =
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(input, {
        digest,
      });
    (input.payload as { read_at_ms: number }).read_at_ms = 123;
    (input.causal_frontier as Array<{ operation_id: string }>)[0].operation_id =
      "op:mutated";

    expect(result.body.payload.read_at_ms).toBe(900);
    expect(result.body.causal_frontier[0].operation_id).toBe(
      "op:read:fixture:0",
    );
  });

  it("uses validated descriptors and one captured digest capability", () => {
    const source = validInput() as unknown as Record<string, unknown>;
    const frontier = source.causal_frontier as unknown[];
    let frontierLengthReads = 0;
    source.causal_frontier = new Proxy(frontier, {
      get(target, property, receiver) {
        if (property === "length") frontierLengthReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    let digestReads = 0;
    const dependencies = {
      get digest() {
        digestReads += 1;
        return digest;
      },
    };

    const result =
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        new Proxy(source, {
          get(_target, property) {
            throw new Error(`unexpected property read: ${String(property)}`);
          },
        }) as never,
        dependencies,
      );

    expect(result.body.causal_frontier).toHaveLength(2);
    expect(frontierLengthReads).toBe(0);
    expect(digestReads).toBe(1);
  });

  it("rejects malformed identity, sequence, payload, and member bounds", () => {
    for (const patch of [
      { library_id: "AB".repeat(32) },
      { epoch: 0 },
      { actor_sequence: 0 },
      { actor_sequence: 1, previous_actor_operation_id: "op:unexpected" },
      { actor_sequence: 2, previous_actor_operation_id: null },
      { transaction_member_count: 0 },
      { transaction_member_count: 1_001 },
      { transaction_member_index: 1 },
      { entity_id: "" },
      { payload: { read_at_ms: -1 } },
      { created_at_ms: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(() =>
        FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
          { ...validInput(), ...patch },
          { digest },
        ),
      ).toThrow();
    }
  });

  it("requires a dense, bounded, strictly sorted causal frontier", () => {
    const frontier = validInput().causal_frontier as unknown[];
    expect(() =>
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        { ...validInput(), causal_frontier: [...frontier].reverse() },
        { digest },
      ),
    ).toThrow(/strictly sorted/);

    expect(() =>
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          ...validInput(),
          causal_frontier: [...frontier, frontier[1]],
        },
        { digest },
      ),
    ).toThrow(/strictly sorted/);

    const actorTip = frontier[0] as {
      actor_id: string;
      sequence: number;
      operation_id: string;
      chain_digest: string;
    };
    expect(() =>
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          ...validInput(),
          causal_frontier: [
            actorTip,
            {
              ...actorTip,
              sequence: actorTip.sequence + 1,
              operation_id: "op:read:fixture:1",
              chain_digest: HEX.chainB,
            },
          ],
        },
        { digest },
      ),
    ).toThrow(/only one accepted tip per actor/);

    const sparse = new Array(2);
    sparse[1] = frontier[0];
    expect(() =>
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        { ...validInput(), causal_frontier: sparse },
        { digest },
      ),
    ).toThrow(/dense/);

    expect(() =>
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          ...validInput(),
          causal_frontier: new Array(
            LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS + 1,
          ).fill(frontier[0]),
        },
        { digest },
      ),
    ).toThrow(/4,096 tips/);
  });

  it("rejects invalid digest dependency output", () => {
    expect(() =>
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        validInput(),
        { digest: () => "not-a-digest" },
      ),
    ).toThrow(/payload digest/);

    expect(() =>
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        validInput(),
        {
          digest(domain, value) {
            return domain === "operation-payload"
              ? digest(domain, value)
              : "not-a-digest";
          },
        },
      ),
    ).toThrow(/member digest/);
  });
});

describe("Library Core reach-out transaction-member schema", () => {
  it("constructs a stable Person event whose operation ID becomes row identity", () => {
    const input = {
      ...validInput(),
      operation_id: "op:reach-out:fixture:1",
      transaction_id: "tx:reach-out:fixture:1",
      entity_id: "person:fixture",
      payload: {
        channel: "text",
        logged_at_ms: 1_783_000_000_000,
        notes: "Checked in",
      },
    };
    const result =
      PERSON_REACH_OUT_APPEND_TRANSACTION_MEMBER_SCHEMA.construct(input, {
        digest,
      });

    expect(result.body).toMatchObject({
      operation_id: "op:reach-out:fixture:1",
      operation_type: "person_reach_out_append",
      entity_type: "Person",
      entity_id: "person:fixture",
      payload: input.payload,
    });
    expect(result.member_digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
