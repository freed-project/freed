import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  encodeLibraryCoreDigestInput,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
} from "./canonical-codec.js";
import {
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  type FeedItemReadAssignmentTransactionMemberInputV1,
  type LibraryCoreConstructionDigestDomain,
} from "./operation-envelope-contracts.js";
import {
  assembleLibraryCoreTransactionV1,
  isLibraryCoreAssembledTransactionV1,
} from "./operation-transaction-contracts.js";

const HEX = {
  library: "11".repeat(32),
  epoch: "22".repeat(32),
  actor: "33".repeat(32),
  chain: "44".repeat(32),
} as const;

function digest(
  domain: LibraryCoreConstructionDigestDomain,
  value: unknown,
): string {
  return createHash("sha256")
    .update(
      encodeLibraryCoreDigestInput(
        domain as LibraryCoreDigestDomain,
        value as LibraryCoreCanonicalValue,
      ),
    )
    .digest("hex");
}

function memberInput(
  index: number,
  count: number,
): FeedItemReadAssignmentTransactionMemberInputV1 {
  return {
    operation_id: `op:read:fixture:${String(index)}`,
    library_id: HEX.library,
    epoch: 1,
    epoch_id: HEX.epoch,
    actor_id: HEX.actor,
    actor_sequence: index + 2,
    previous_actor_operation_id:
      index === 0
        ? "op:read:fixture:previous"
        : `op:read:fixture:${String(index - 1)}`,
    causal_frontier: [],
    hlc_wall_ms: 1_000,
    hlc_counter: index,
    transaction_id: "tx:read:fixture:1",
    transaction_member_index: index,
    transaction_member_count: count,
    entity_id: `rss:entry:${String(index)}`,
    payload: { read_at_ms: 900 + index },
    created_at_ms: 1_000,
  };
}

function members(count: number) {
  return Array.from({ length: count }, (_, index) =>
    FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
      memberInput(index, count),
      { digest },
    ),
  );
}

describe("Library Core transaction assembly", () => {
  it("derives one aggregate digest, sequential actor chain, and signing bodies", () => {
    const result = assembleLibraryCoreTransactionV1(members(2), HEX.chain, {
      digest,
    });

    expect(result.transaction_body).toStrictEqual({
      transaction_id: "tx:read:fixture:1",
      transaction_member_count: 2,
      actor_id: HEX.actor,
      initial_previous_actor_operation_id: "op:read:fixture:previous",
      initial_previous_actor_chain_digest: HEX.chain,
      transaction_member_digests: [
        "d3159c0068a42afb70f5da3171f91bf5e5d50cdd4d59f9d779ed9df9237d79fa",
        "4d2b3e4632c7dfea277cfa8d3dfc2e5b6e2d0ce849d48a1f96c39249b51dc6c7",
      ],
    });
    expect(result.transaction_digest).toBe(
      "21e51c2c98e710d3a9b7695a79454f0a8fc88ae9e56fa0af2e6ce2c6e1790c80",
    );
    expect(
      result.members.map((member) => ({
        previous: member.signing_body.previous_actor_chain_digest,
        chain: member.signing_body.actor_chain_digest,
        signing: member.signing_body_digest,
      })),
    ).toStrictEqual([
      {
        previous: HEX.chain,
        chain:
          "b406319ebdf4cdec8ea12beb27cb69a737bce7746c249b4b0774295ce3c5b363",
        signing:
          "17e8c65a953036bbda1aee14d42d50243899fdd434274a3422e61838dbc0bd6e",
      },
      {
        previous:
          "b406319ebdf4cdec8ea12beb27cb69a737bce7746c249b4b0774295ce3c5b363",
        chain:
          "c0e96ebddd4f95cb74b4a3434c3924a33b85d65d9bc972562482879bdc17dabf",
        signing:
          "ec6a42d47bd8c78d7095a62e76542b07f8099a6a2ac57580ed95784bdce85471",
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.transaction_body)).toBe(true);
    expect(
      Object.isFrozen(result.transaction_body.transaction_member_digests),
    ).toBe(true);
    expect(Object.isFrozen(result.members)).toBe(true);
    expect(Object.isFrozen(result.members[0].signing_body)).toBe(true);
    expect(result.canonical_member_bytes).toBeGreaterThan(0);
    expect(isLibraryCoreAssembledTransactionV1(result)).toBe(true);
    expect(Object.getOwnPropertySymbols(result)).toHaveLength(0);
    expect(
      isLibraryCoreAssembledTransactionV1(Object.freeze(Object.create(result))),
    ).toBe(false);
    expect(Object.keys(result)).not.toContain(
      "assembled-library-core-transaction-v1",
    );
  });

  it("rejects gaps, reordering, mixed identities, and broken predecessor links", () => {
    const base = members(2);
    for (const candidate of [
      [...base].reverse(),
      [
        base[0],
        FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
          { ...memberInput(1, 2), actor_id: "55".repeat(32) },
          { digest },
        ),
      ],
      [
        base[0],
        FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
          {
            ...memberInput(1, 2),
            actor_sequence: 4,
          },
          { digest },
        ),
      ],
      [
        base[0],
        FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
          {
            ...memberInput(1, 2),
            previous_actor_operation_id: "op:wrong",
          },
          { digest },
        ),
      ],
    ]) {
      expect(() =>
        assembleLibraryCoreTransactionV1(candidate, HEX.chain, { digest }),
      ).toThrow();
    }
  });

  it("rejects a frozen lookalike that bypassed member construction", () => {
    const genuine = members(1)[0];
    const forged = Object.freeze({
      body: genuine.body,
      member_digest: genuine.member_digest,
    });
    expect(() =>
      assembleLibraryCoreTransactionV1([forged], HEX.chain, { digest }),
    ).toThrow(/closed member construction schema/);
  });

  it("assembles only the dense element descriptors it snapshots", () => {
    const genuine = members(1);
    let numericReads = 0;
    const adversarial = new Proxy(genuine, {
      get(target, property, receiver) {
        if (property === "0") {
          numericReads += 1;
          return Object.freeze({
            body: target[0].body,
            member_digest: target[0].member_digest,
          });
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(
      assembleLibraryCoreTransactionV1(adversarial, HEX.chain, { digest })
        .members,
    ).toHaveLength(1);
    expect(numericReads).toBe(0);
  });

  it("captures the transaction digest capability once", () => {
    let digestReads = 0;
    const dependencies = {
      get digest() {
        digestReads += 1;
        return digest;
      },
    };

    const result = assembleLibraryCoreTransactionV1(
      members(2),
      HEX.chain,
      dependencies,
    );

    expect(result.members).toHaveLength(2);
    expect(digestReads).toBe(1);
  });

  it("rejects empty, sparse, oversized, and invalid-chain inputs", () => {
    expect(() =>
      assembleLibraryCoreTransactionV1([], HEX.chain, { digest }),
    ).toThrow(/between 1 and 1,000/);

    const sparse = new Array(2);
    sparse[1] = members(1)[0];
    expect(() =>
      assembleLibraryCoreTransactionV1(sparse, HEX.chain, { digest }),
    ).toThrow(/dense/);

    const oversized = Array.from({ length: 1_000 }, (_, index) =>
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          ...memberInput(index, 1_000),
          entity_id: `${String(index)}:${"x".repeat(4_080)}`,
        },
        { digest },
      ),
    );
    expect(() =>
      assembleLibraryCoreTransactionV1(oversized, HEX.chain, { digest }),
    ).toThrow(/4,194,304/);

    expect(() =>
      assembleLibraryCoreTransactionV1(members(1), "invalid", { digest }),
    ).toThrow(/64 lowercase/);
  });

  it("rejects invalid transaction, chain, or signing digest output", () => {
    for (const failedDomain of [
      "transaction",
      "actor-chain",
      "operation-signing-body",
    ]) {
      expect(() =>
        assembleLibraryCoreTransactionV1(members(1), HEX.chain, {
          digest(domain, value) {
            return domain === failedDomain ? "invalid" : digest(domain, value);
          },
        }),
      ).toThrow(/digest dependency result/);
    }
  });
});
