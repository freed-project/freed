import {
  decodeLibraryCoreCanonicalValue,
  type LibraryCoreFollowerIntentCommitV1,
} from "@freed/shared/library-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commitFollowerIntent: vi.fn(),
  readFollowerMutationContext: vi.fn(),
  signFollowerOperation: vi.fn(),
}));

vi.mock("./library-core-browser-key-vault", () => ({
  signPwaLibraryCoreFollowerOperation: mocks.signFollowerOperation,
}));

vi.mock("./library-core-sqlite-runtime", () => ({
  commitPwaFollowerIntent: mocks.commitFollowerIntent,
  readPwaFollowerMutationContext: mocks.readFollowerMutationContext,
}));

import {
  commitPwaLibraryCoreReadAssignments,
  commitPwaLibraryCoreUserStateAssignments,
} from "./library-core-pwa-follower-mutations";

const HEX = {
  actor: "11".repeat(32),
  chain: "22".repeat(32),
  epoch: "33".repeat(32),
  library: "44".repeat(32),
  publicKey:
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  signature: "55".repeat(64),
} as const;

function decodeCommit(commit: LibraryCoreFollowerIntentCommitV1) {
  return commit.envelopeBytes.map((bytes) => {
    const value = decodeLibraryCoreCanonicalValue(bytes);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("test follower envelope is not a record");
    }
    return value as Readonly<Record<string, unknown>>;
  });
}

function receiptFor(commit: LibraryCoreFollowerIntentCommitV1) {
  const envelopes = decodeCommit(commit);
  const first = envelopes[0]!;
  const last = envelopes.at(-1)!;
  return {
    actorId: first.actor_id,
    firstCounter: first.actor_sequence,
    lastCounter: last.actor_sequence,
    memberCount: envelopes.length,
    optimisticFieldCount: envelopes.length,
    state: "pending",
    transactionId: first.transaction_id,
  };
}

describe("PWA SQLite follower mutations", () => {
  beforeEach(() => {
    mocks.commitFollowerIntent.mockReset();
    mocks.readFollowerMutationContext.mockReset();
    mocks.signFollowerOperation.mockReset();
    mocks.readFollowerMutationContext.mockResolvedValue({
      actor_id: HEX.actor,
      actor_public_key: HEX.publicKey,
      epoch: 2,
      epoch_id: HEX.epoch,
      library_id: HEX.library,
      next_actor_sequence: 4,
      observed_frontier: [],
      previous_actor_chain_digest: HEX.chain,
      previous_actor_operation_id: "operation:actor:3",
      schema_version: 1,
    });
    mocks.signFollowerOperation.mockResolvedValue(HEX.signature);
    mocks.commitFollowerIntent.mockImplementation(
      async (commit: LibraryCoreFollowerIntentCommitV1) => receiptFor(commit),
    );
  });

  it("constructs one signed SQLite transaction for deduplicated reads", async () => {
    await commitPwaLibraryCoreReadAssignments(
      ["item:1", "item:1", "item:2"],
      1_000,
    );

    expect(mocks.readFollowerMutationContext).toHaveBeenCalledOnce();
    expect(mocks.signFollowerOperation).toHaveBeenCalledTimes(2);
    expect(mocks.commitFollowerIntent).toHaveBeenCalledOnce();
    const commit = mocks.commitFollowerIntent.mock.calls[0]![0];
    const envelopes = decodeCommit(commit);
    expect(envelopes.map((envelope) => envelope.entity_id)).toEqual([
      "item:1",
      "item:2",
    ]);
    expect(envelopes.map((envelope) => envelope.actor_sequence)).toEqual([
      4, 5,
    ]);
    expect(envelopes.map((envelope) => envelope.operation_type)).toEqual([
      "feed_item_read_assignment",
      "feed_item_read_assignment",
    ]);
  });

  it("retries exact canonical bytes once after a lost SQLite response", async () => {
    mocks.commitFollowerIntent
      .mockRejectedValueOnce(new Error("SQLite worker request timed out"))
      .mockImplementationOnce(
        async (commit: LibraryCoreFollowerIntentCommitV1) => receiptFor(commit),
      );

    await commitPwaLibraryCoreUserStateAssignments(
      ["item:1", "item:2"],
      "saved",
      true,
      2_000,
    );

    expect(mocks.commitFollowerIntent).toHaveBeenCalledTimes(2);
    const first = mocks.commitFollowerIntent.mock.calls[0]![0];
    const second = mocks.commitFollowerIntent.mock.calls[1]![0];
    expect(second.envelopeBytes).toEqual(first.envelopeBytes);
    expect(decodeCommit(second).map((envelope) => envelope.payload)).toEqual([
      { assigned: true, assigned_at_ms: 2_000 },
      { assigned: true, assigned_at_ms: 2_000 },
    ]);
  });

  it("rejects a receipt that does not identify the committed transaction", async () => {
    mocks.commitFollowerIntent.mockResolvedValue({
      actorId: HEX.actor,
      firstCounter: 4,
      lastCounter: 4,
      memberCount: 1,
      optimisticFieldCount: 1,
      state: "pending",
      transactionId: "transaction:wrong",
    });

    await expect(
      commitPwaLibraryCoreUserStateAssignments(
        ["item:1"],
        "liked",
        true,
        3_000,
      ),
    ).rejects.toThrow(/receipt does not match/);
  });
});
