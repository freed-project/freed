import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  encodeLibraryCoreDigestInput,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
} from "./canonical-codec.js";
import {
  FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  type FeedItemCaptureUpsertTransactionMemberInputV1,
  type FeedItemReadAssignmentTransactionMemberInputV1,
  type LibraryCoreConstructionDigestDomain,
} from "./operation-envelope-contracts.js";
import {
  finalizeLibraryCoreTransactionV1,
  isLibraryCoreFinalizedTransactionV1,
  type LibraryCoreOperationFinalizationDependencies,
} from "./operation-envelope-finalization.js";
import { assembleLibraryCoreTransactionV1 } from "./operation-transaction-contracts.js";

const HEX = {
  library: "11".repeat(32),
  epoch: "22".repeat(32),
  actor: "33".repeat(32),
  chain: "44".repeat(32),
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

function input(
  index: number,
  count: number,
  entityId = `rss:entry:${String(index)}`,
): FeedItemReadAssignmentTransactionMemberInputV1 {
  return {
    operation_id: `op:read:finalization:${String(index)}`,
    library_id: HEX.library,
    epoch: 1,
    epoch_id: HEX.epoch,
    actor_id: HEX.actor,
    actor_sequence: index + 1,
    previous_actor_operation_id:
      index === 0 ? null : `op:read:finalization:${String(index - 1)}`,
    causal_frontier: [],
    hlc_wall_ms: 1_000,
    hlc_counter: index,
    transaction_id: "tx:read:finalization:1",
    transaction_member_index: index,
    transaction_member_count: count,
    entity_id: entityId,
    payload: { read_at_ms: 900 + index },
    created_at_ms: 1_000,
  };
}

function assembled(count = 2, entityId?: (index: number) => string) {
  const members = Array.from({ length: count }, (_, index) =>
    FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
      input(index, count, entityId?.(index)),
      {
        digest(domain: LibraryCoreConstructionDigestDomain, value: unknown) {
          return digest(domain, value);
        },
      },
    ),
  );
  return assembleLibraryCoreTransactionV1(members, HEX.chain, {
    digest(domain, value) {
      return digest(domain, value);
    },
  });
}

function oversizedCaptureInput(): FeedItemCaptureUpsertTransactionMemberInputV1 {
  return {
    operation_id: "op:capture:oversized",
    library_id: HEX.library,
    epoch: 1,
    epoch_id: HEX.epoch,
    actor_id: HEX.actor,
    actor_sequence: 1,
    previous_actor_operation_id: null,
    causal_frontier: [],
    hlc_wall_ms: 1_000,
    hlc_counter: 0,
    transaction_id: "tx:capture:oversized",
    transaction_member_index: 0,
    transaction_member_count: 1,
    entity_id: "saved:oversized",
    payload: {
      item: {
        globalId: "saved:oversized",
        platform: "saved",
        contentType: "article",
        capturedAt: 1,
        publishedAt: 1,
        author: { id: "author", handle: "ada", displayName: "Ada" },
        content: {
          mediaUrls: Array.from(
            { length: 16 },
            (_, index) => `https://example.com/${String(index)}/${"x".repeat(8_070)}`,
          ),
          mediaTypes: Array.from({ length: 16 }, () => "image"),
        },
        topics: [],
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
      },
    },
    created_at_ms: 1_000,
  };
}

describe("Library Core operation envelope finalization", () => {
  it("signs exact domain inputs and returns immutable final envelopes", async () => {
    const signingInputs: string[] = [];
    const result = await finalizeLibraryCoreTransactionV1(assembled(), {
      async signOperation(bytes) {
        signingInputs.push(new TextDecoder().decode(bytes));
        return HEX.signature;
      },
      digest(domain, value) {
        return digest(domain, value);
      },
    });

    expect(signingInputs).toHaveLength(2);
    for (const signingInput of signingInputs) {
      expect(signingInput).toMatch(
        /^freed\.library-core\.v1\/signature\/operation-envelope\u0000\{"operation_signing_body_digest":"[0-9a-f]{64}"\}$/,
      );
    }
    expect(result.members).toHaveLength(2);
    expect(result.members[0].envelope).toMatchObject({
      operation_type: "feed_item_read_assignment",
      signature_algorithm: "ed25519",
      signature: HEX.signature,
    });
    expect(result.members[0].envelope_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.canonical_envelope_bytes).toBeGreaterThan(
      assembled().canonical_member_bytes,
    );
    expect(isLibraryCoreFinalizedTransactionV1(result)).toBe(true);
    expect(Object.getOwnPropertySymbols(result)).toHaveLength(0);
    expect(
      isLibraryCoreFinalizedTransactionV1(
        Object.freeze(Object.create(result)),
      ),
    ).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.members)).toBe(true);
    expect(Object.isFrozen(result.members[0])).toBe(true);
    expect(Object.isFrozen(result.members[0].envelope)).toBe(true);
  });

  it("rejects an assembled lookalike before signing", async () => {
    const genuine = assembled(1);
    const signOperation = vi.fn(async () => HEX.signature);
    for (const forged of [
      Object.freeze({ ...genuine }),
      Object.freeze(Object.create(genuine)),
    ]) {
      await expect(
        finalizeLibraryCoreTransactionV1(forged, {
          signOperation,
          digest(domain, value) {
            return digest(domain, value);
          },
        }),
      ).rejects.toThrow(/closed assembly contract/);
    }
    expect(signOperation).not.toHaveBeenCalled();
  });

  it("returns no result for rejected or malformed signatures and digests", async () => {
    const transaction = assembled(1);
    await expect(
      finalizeLibraryCoreTransactionV1(transaction, {
        async signOperation() {
          throw new Error("signer unavailable");
        },
        digest(domain, value) {
          return digest(domain, value);
        },
      }),
    ).rejects.toThrow(/signer unavailable/);

    await expect(
      finalizeLibraryCoreTransactionV1(transaction, {
        async signOperation() {
          return "invalid";
        },
        digest(domain, value) {
          return digest(domain, value);
        },
      }),
    ).rejects.toThrow(/128 lowercase/);

    await expect(
      finalizeLibraryCoreTransactionV1(transaction, {
        async signOperation() {
          return HEX.signature;
        },
        digest() {
          return "invalid";
        },
      }),
    ).rejects.toThrow(/invalid digest/);
  });

  it("snapshots signer and digest capabilities before the first await", async () => {
    const transaction = assembled(2);
    const dependencies: LibraryCoreOperationFinalizationDependencies = {
      async signOperation() {
        (
          dependencies as {
            signOperation: () => Promise<string>;
            digest: () => string;
          }
        ).signOperation = async () => "invalid";
        (
          dependencies as {
            signOperation: () => Promise<string>;
            digest: () => string;
          }
        ).digest = () => "invalid";
        await Promise.resolve();
        return HEX.signature;
      },
      digest(domain, value) {
        return digest(domain, value);
      },
    };

    await expect(
      finalizeLibraryCoreTransactionV1(transaction, dependencies),
    ).resolves.toMatchObject({
      members: [{ envelope: { signature: HEX.signature } }, {}],
    });
  });

  it("rejects an oversized final envelope transaction before signing", async () => {
    const transaction = assembled(
      1_000,
      (index) => `${String(index)}:${"x".repeat(3_200)}`,
    );
    const signOperation = vi.fn(async () => HEX.signature);

    await expect(
      finalizeLibraryCoreTransactionV1(transaction, {
        signOperation,
        digest(domain, value) {
          return digest(domain, value);
        },
      }),
    ).rejects.toThrow(/4,194,304/);
    expect(signOperation).not.toHaveBeenCalled();
  });

  it("rejects oversized capture payloads before transaction assembly", () => {
    expect(() =>
      FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
        oversizedCaptureInput(),
        {
          digest(domain: LibraryCoreConstructionDigestDomain, value: unknown) {
            return digest(domain, value);
          },
        },
      ),
    ).toThrow(/98,304/);
  });
});
