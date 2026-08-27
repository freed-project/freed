import {
  decodeLibraryCoreCanonicalValue,
  type LibraryCoreFollowerIntentCommitV1,
} from "@freed/shared/library-core";
import type { Account, Person } from "@freed/shared";
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
  commitPwaLibraryCoreAccountRemove,
  commitPwaLibraryCoreAccountUpserts,
  commitPwaLibraryCoreFeedItemCaptures,
  commitPwaLibraryCoreFeedItemRemove,
  commitPwaLibraryCoreFriendReplace,
  commitPwaLibraryCorePersonRemove,
  commitPwaLibraryCorePersonUpserts,
  commitPwaLibraryCorePreferencesPatch,
  commitPwaLibraryCoreReadAssignments,
  commitPwaLibraryCoreRssFeedRemove,
  commitPwaLibraryCoreRssFeedRemoves,
  commitPwaLibraryCoreRssFeedTitleAssignment,
  commitPwaLibraryCoreRssFeedUpsert,
  commitPwaLibraryCoreUserStateAssignments,
} from "./library-core-pwa-follower-mutations";

const HEX = {
  actor: "11".repeat(32),
  chain: "22".repeat(32),
  epoch: "33".repeat(32),
  library: "44".repeat(32),
  publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
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

  it("commits bounded FeedItem captures with canonical fractional values", async () => {
    await commitPwaLibraryCoreFeedItemCaptures(
      [
        {
          globalId: "item:1",
          platform: "rss",
          contentType: "article",
          capturedAt: 1_000,
          publishedAt: 900,
          author: {
            id: "author:1",
            handle: "author",
            displayName: "Author",
          },
          content: { text: "Text", mediaUrls: [], mediaTypes: [] },
          location: {
            name: "Somewhere",
            source: "geo_tag",
            coordinates: { lat: 1.5, lng: -2.25 },
          },
          userState: {
            hidden: false,
            saved: false,
            archived: false,
            tags: [],
          },
          topics: [],
        },
      ],
      4_000,
    );

    const commit = mocks.commitFollowerIntent.mock.calls[0]![0];
    const envelope = decodeCommit(commit)[0]!;
    expect(envelope.operation_type).toBe("feed_item_capture_upsert");
    expect(envelope.payload).toMatchObject({
      item: {
        location: {
          coordinates: {
            lat: { codec: "ieee754_binary64_hex_v1" },
            lng: { codec: "ieee754_binary64_hex_v1" },
          },
        },
      },
    });
  });

  it("commits FeedItem tombstones through the same SQLite transaction path", async () => {
    await commitPwaLibraryCoreFeedItemRemove("item:1", 5_000);

    const commit = mocks.commitFollowerIntent.mock.calls[0]![0];
    expect(decodeCommit(commit)[0]).toMatchObject({
      entity_id: "item:1",
      operation_type: "feed_item_remove",
      payload: { removed_at_ms: 5_000 },
    });
  });

  it("uses registered SQLite intents for remaining normalized record writes", async () => {
    await commitPwaLibraryCoreRssFeedUpsert(
      {
        url: "https://example.test/feed",
        title: "Example",
        enabled: true,
        trackUnread: true,
      },
      6_000,
    );
    await commitPwaLibraryCoreRssFeedRemove(
      "https://example.test/feed",
      true,
      6_001,
    );
    await commitPwaLibraryCoreRssFeedTitleAssignment(
      "https://example.test/feed",
      "Renamed",
      6_002,
    );
    await commitPwaLibraryCorePreferencesPatch(
      { display: { archivePruneDays: 14 } } as never,
      6_003,
    );
    await commitPwaLibraryCorePersonUpserts(
      [
        {
          id: "person:1",
          name: "Person",
          relationshipStatus: "friend",
          careLevel: 3,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      6_004,
    );
    await commitPwaLibraryCorePersonRemove("person:1", 6_005);
    await commitPwaLibraryCoreAccountUpserts(
      [
        {
          id: "account:1",
          kind: "social",
          provider: "instagram",
          externalId: "one",
          discoveredFrom: "manual_entry",
          firstSeenAt: 1,
          lastSeenAt: 2,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      6_006,
    );
    await commitPwaLibraryCoreAccountRemove("account:1", 6_007);

    expect(
      mocks.commitFollowerIntent.mock.calls.map(
        ([commit]) => decodeCommit(commit)[0]!.operation_type,
      ),
    ).toEqual([
      "rss_feed_upsert",
      "rss_feed_remove_with_items",
      "rss_feed_title_assignment",
      "preferences_leaf_assignment",
      "person_upsert",
      "person_remove_and_accounts",
      "account_upsert",
      "account_remove",
    ]);
  });

  it("commits a bounded RSS removal page as one signed transaction", async () => {
    await commitPwaLibraryCoreRssFeedRemoves(
      ["https://a.example/feed", "https://b.example/feed"],
      false,
      7_000,
    );

    const commit = mocks.commitFollowerIntent.mock.calls[0]![0];
    const envelopes = decodeCommit(commit);
    expect(envelopes.map((envelope) => envelope.entity_id)).toEqual([
      "https://a.example/feed",
      "https://b.example/feed",
    ]);
    expect(envelopes.map((envelope) => envelope.operation_type)).toEqual([
      "rss_feed_remove_keep_items",
      "rss_feed_remove_keep_items",
    ]);
    expect(envelopes.map((envelope) => envelope.actor_sequence)).toEqual([
      4, 5,
    ]);
  });

  it("commits one signed Friend replacement instead of partial Person and Account writes", async () => {
    const person = {
      id: "person:friend",
      name: "Friend",
      relationshipStatus: "friend" as const,
      careLevel: 3,
      createdAt: 1,
      updatedAt: 2,
    } satisfies Person;
    const account = {
      id: "account:friend",
      personId: person.id,
      kind: "social" as const,
      provider: "instagram" as const,
      externalId: "friend",
      discoveredFrom: "manual_entry" as const,
      firstSeenAt: 1,
      lastSeenAt: 2,
      createdAt: 1,
      updatedAt: 2,
    } satisfies Account;
    await commitPwaLibraryCoreFriendReplace(person, [account], 8_000);

    expect(mocks.signFollowerOperation).toHaveBeenCalledOnce();
    const [envelope] = decodeCommit(
      mocks.commitFollowerIntent.mock.calls[0]![0],
    );
    expect(envelope).toMatchObject({
      entity_id: person.id,
      entity_type: "Person",
      operation_type: "friend_replace",
      payload: { accounts: [account], person },
      transaction_member_count: 1,
    });
  });
});
