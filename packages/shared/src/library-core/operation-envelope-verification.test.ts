import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
} from "./canonical-codec.js";
import {
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  type FeedItemReadAssignmentTransactionMemberInputV1,
} from "./operation-envelope-contracts.js";
import { finalizeLibraryCoreTransactionV1 } from "./operation-envelope-finalization.js";
import {
  isLibraryCoreVerifiedOperationTransactionV1,
  verifyLibraryCoreOperationTransactionV1,
} from "./operation-envelope-verification.js";
import { assembleLibraryCoreTransactionV1 } from "./operation-transaction-contracts.js";

const HEX = {
  library: "11".repeat(32),
  epoch: "22".repeat(32),
  actor: "33".repeat(32),
  chain: "44".repeat(32),
  publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  signature: "55".repeat(64),
} as const;

function digest(domain: string, value: unknown): string {
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
    operation_id: `op:read:verification:${index.toLocaleString("en-US")}`,
    library_id: HEX.library,
    epoch: 1,
    epoch_id: HEX.epoch,
    actor_id: HEX.actor,
    actor_sequence: index + 1,
    previous_actor_operation_id:
      index === 0
        ? null
        : `op:read:verification:${(index - 1).toLocaleString("en-US")}`,
    causal_frontier: [],
    hlc_wall_ms: 1_000,
    hlc_counter: index,
    transaction_id: "tx:read:verification:1",
    transaction_member_index: index,
    transaction_member_count: count,
    entity_id: `rss:entry:${index.toLocaleString("en-US")}`,
    payload: { read_at_ms: 900 + index },
    created_at_ms: 1_000,
  };
}

async function fixture() {
  const memberConstructions = Array.from({ length: 2 }, (_, index) =>
    FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
      memberInput(index, 2),
      { digest },
    ),
  );
  const assembled = assembleLibraryCoreTransactionV1(
    memberConstructions,
    HEX.chain,
    { digest },
  );
  const finalized = await finalizeLibraryCoreTransactionV1(assembled, {
    async signOperation() {
      return HEX.signature;
    },
    digest,
  });
  return finalized.members.map((member) =>
    encodeLibraryCoreCanonicalValue(member.envelope as never),
  );
}

function acceptedActorState() {
  return {
    library_id: HEX.library,
    epoch: 1,
    epoch_id: HEX.epoch,
    actor_id: HEX.actor,
    actor_public_key: HEX.publicKey,
    next_actor_sequence: 1,
    previous_actor_operation_id: null,
    previous_actor_chain_digest: HEX.chain,
  };
}

describe("Library Core operation transaction verification", () => {
  it("reconstructs and verifies one complete immutable transaction from canonical bytes", async () => {
    const envelopeBytes = await fixture();
    const messages: string[] = [];
    const result = await verifyLibraryCoreOperationTransactionV1(
      envelopeBytes,
      acceptedActorState(),
      {
        digest,
        async verifySignature(input) {
          messages.push(new TextDecoder().decode(input.message));
          return true;
        },
      },
    );

    expect(messages).toHaveLength(2);
    expect(messages).toEqual([
      expect.stringMatching(
        /^freed\.library-core\.v1\/signature\/operation-envelope\u0000/,
      ),
      expect.stringMatching(
        /^freed\.library-core\.v1\/signature\/operation-envelope\u0000/,
      ),
    ]);
    expect(result.members).toHaveLength(2);
    expect(result.members[0].canonical_envelope_json).toBe(
      new TextDecoder().decode(envelopeBytes[0]),
    );
    expect(result.canonical_envelope_bytes).toBe(
      envelopeBytes[0].byteLength + envelopeBytes[1].byteLength,
    );
    expect(isLibraryCoreVerifiedOperationTransactionV1(result)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.members)).toBe(true);
    expect(Object.isFrozen(result.members[0])).toBe(true);
    expect(Object.isFrozen(result.members[0].envelope)).toBe(true);
    expect(Object.isFrozen(result.accepted_actor_state)).toBe(true);
    expect(Object.getOwnPropertySymbols(result)).toStrictEqual([]);
    expect(
      isLibraryCoreVerifiedOperationTransactionV1(Object.freeze({ ...result })),
    ).toBe(false);
    expect(
      isLibraryCoreVerifiedOperationTransactionV1(
        Object.freeze(Object.create(result)),
      ),
    ).toBe(false);
  });

  it("rejects noncanonical, duplicate, and derived-field tampering before signature verification", async () => {
    const envelopeBytes = await fixture();
    const verifySignature = vi.fn(async () => true);
    const parsedEnvelope = JSON.parse(
      new TextDecoder().decode(envelopeBytes[0]),
    ) as Record<string, unknown>;
    await expect(
      verifyLibraryCoreOperationTransactionV1(
        [
          new TextEncoder().encode(
            JSON.stringify({
              signature: parsedEnvelope.signature,
              ...parsedEnvelope,
            }),
          ),
        ],
        acceptedActorState(),
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/not RFC 8785 canonical/);

    const canonical = new TextDecoder().decode(envelopeBytes[0]);
    const duplicate = canonical.replace(
      /"signature":"([0-9a-f]+)"/,
      '"signature":"$1","signature":"$1"',
    );
    await expect(
      verifyLibraryCoreOperationTransactionV1(
        [new TextEncoder().encode(duplicate)],
        acceptedActorState(),
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/duplicate object name/);

    const decoded = JSON.parse(canonical) as Record<string, unknown>;
    decoded.payload_digest = "77".repeat(32);
    await expect(
      verifyLibraryCoreOperationTransactionV1(
        [encodeLibraryCoreCanonicalValue(decoded as never), envelopeBytes[1]],
        acceptedActorState(),
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/derived canonical value/);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  it("rejects stale actor tips and incomplete or reordered transactions before signature verification", async () => {
    const envelopeBytes = await fixture();
    const verifySignature = vi.fn(async () => true);
    await expect(
      verifyLibraryCoreOperationTransactionV1(
        envelopeBytes,
        {
          ...acceptedActorState(),
          previous_actor_chain_digest: "88".repeat(32),
        },
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/derived canonical value/);
    await expect(
      verifyLibraryCoreOperationTransactionV1(
        envelopeBytes.slice(0, 1),
        acceptedActorState(),
        { digest, verifySignature },
      ),
    ).rejects.toThrow();
    await expect(
      verifyLibraryCoreOperationTransactionV1(
        [...envelopeBytes].reverse(),
        acceptedActorState(),
        { digest, verifySignature },
      ),
    ).rejects.toThrow();
    expect(verifySignature).not.toHaveBeenCalled();
  });

  it("fails closed at the first invalid actor signature", async () => {
    const envelopeBytes = await fixture();
    const verifySignature = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(
      verifyLibraryCoreOperationTransactionV1(
        envelopeBytes,
        acceptedActorState(),
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/envelope\[1\] signature/);
    expect(verifySignature).toHaveBeenCalledTimes(2);
  });

  it("uses validated actor-state and envelope-array descriptors", async () => {
    const sourceState = acceptedActorState();
    const proxiedState = new Proxy(sourceState, {
      get(_target, property) {
        throw new Error(`unexpected actor-state read: ${String(property)}`);
      },
    });
    const envelopes = await fixture();
    let lengthReads = 0;
    const proxiedEnvelopes = new Proxy(envelopes, {
      get(target, property, receiver) {
        if (property === "length") lengthReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(
      verifyLibraryCoreOperationTransactionV1(proxiedEnvelopes, proxiedState, {
        digest,
        verifySignature: async () => true,
      }),
    ).resolves.toMatchObject({
      members: [{}, {}],
    });
    expect(lengthReads).toBe(0);
  });

  it("uses digest and verifier capabilities captured before the first await", async () => {
    const envelopes = await fixture();
    let calls = 0;
    const dependencies = {
      digest,
      async verifySignature() {
        calls += 1;
        if (calls === 1) {
          dependencies.digest = () => {
            throw new Error("swapped digest");
          };
          dependencies.verifySignature = async () => {
            throw new Error("swapped verifier");
          };
        }
        return true;
      },
    };

    await expect(
      verifyLibraryCoreOperationTransactionV1(
        envelopes,
        acceptedActorState(),
        dependencies,
      ),
    ).resolves.toMatchObject({
      members: [{}, {}],
    });
    expect(calls).toBe(2);
  });
});
