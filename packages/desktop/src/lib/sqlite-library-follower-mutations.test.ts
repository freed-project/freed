import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";
import type { DocState } from "./library-types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  enqueuedEnvelopes: [] as string[],
  scopeActionKind: null as string | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

import {
  dispatchSqliteMutation,
  replaceSqliteLibraryFriend,
} from "./sqlite-library";

const ITEM_ID = "rss:follower-item";

function normalizedRow(globalId = ITEM_ID) {
  return {
    archived: false,
    authorAvatarUrl: null,
    authorDisplayName: "Author",
    authorHandle: "author",
    authorId: "author",
    capturedAt: 1,
    contentSignalTags: [],
    contentText: globalId,
    contentType: "article",
    engagementComments: null,
    engagementLikes: null,
    eventConfidenceBasisPoints: null,
    eventStartsAt: null,
    globalId,
    hidden: false,
    liked: false,
    likedAt: null,
    likedSyncedAt: null,
    linkPreviewTitle: null,
    locationName: null,
    mediaTypes: [],
    mediaUrls: [],
    platform: "rss",
    publishedAt: 1,
    readAt: null,
    readingTimeMinutes: null,
    rssSource: null,
    sampleDataFingerprint: null,
    saved: false,
    sourceUrl: null,
    tags: [],
  };
}

function normalizedCard(globalId = ITEM_ID) {
  const {
    hidden: _hidden,
    rssSource: _rssSource,
    sampleDataFingerprint: _sampleDataFingerprint,
    ...card
  } = normalizedRow(globalId);
  return card;
}

function state(): DocState {
  return {
    items: [],
    searchCorpusVersion: 1,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
    desktopClientIds: [],
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: 1,
    unreadCountByPlatform: { rss: 1 },
    totalItemCount: 1,
    itemCountByPlatform: { rss: 1 },
    totalArchivableCount: 1,
    archivableCountByPlatform: { rss: 1 },
    archivableFeedCounts: {},
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
    docItemCount: 1,
  };
}

describe("SQLite editable follower mutations", () => {
  beforeEach(() => {
    mocks.enqueuedEnvelopes = [];
    mocks.scopeActionKind = null;
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "normalized_library_primary_mutation_context") {
        throw new Error("normalized SQLite authority is not selected");
      }
      if (command === "normalized_library_follower_mutation_context") {
        return {
          libraryId: "ab".repeat(32),
          epoch: 1,
          epochId: "cd".repeat(32),
          actorId: "12".repeat(32),
          actorPublicKey: "23".repeat(32),
          nextCounter: 1,
          previousOperationId: null,
          previousChainDigest: "34".repeat(32),
          observedFrontier: [],
        };
      }
      if (command === "sign_normalized_library_follower_operation") {
        const request = (
          args as {
            request: { actorId: string; operationSigningBodyDigest: string };
          }
        ).request;
        return {
          actorId: request.actorId,
          operationSigningBodyDigest: request.operationSigningBodyDigest,
          signature: "45".repeat(64),
        };
      }
      if (command === "enqueue_normalized_library_follower_intent") {
        const request = (
          args as {
            request: { canonicalEnvelopeJson: string[] };
          }
        ).request;
        mocks.enqueuedEnvelopes = request.canonicalEnvelopeJson;
        return {
          transactionId: "desktop-follower-read:test",
          actorId: "12".repeat(32),
          firstCounter: 1,
          lastCounter: 1,
          memberCount: 1,
          optimisticFieldCount: 0,
          state: "pending",
        };
      }
      if (command === "query_normalized_library") {
        const request = (
          args as { request: { queryId: string; schemaVersion: number } }
        ).request;
        const source = {
          generationId: "bc".repeat(32),
          projectionRevision: 2,
          transitionSequence: 2,
        };
        if (request.queryId === "library_facet_summary_v1") {
          return {
            queryId: request.queryId,
            schemaVersion: request.schemaVersion,
            source,
            summary: {
              archivedCount: 0,
              archivableCount: 1,
              contactAccountCount: 0,
              contactLinkedPersonCount: 0,
              enabledRssFeedCount: 0,
              friendPersonCount: 0,
              latestContactImportedAt: null,
              latestRssFeedFetchedAt: null,
              platformCounts: [
                {
                  archivableCount: 1,
                  latestCapturedAt: 1,
                  latestPublishedAt: 1,
                  platform: "rss",
                  totalCount: 1,
                  unreadCount: 0,
                },
              ],
              rssFeedCount: 0,
              sampleAccountCount: 0,
              sampleFeedCount: 0,
              sampleItemCount: 0,
              samplePersonCount: 0,
              savedArchivedCount: 0,
              savedCount: 0,
              savedPlatformCount: 0,
              socialAccountCount: 0,
              tags: [],
              totalCount: 1,
              unreadCount: 0,
            },
          };
        }
        if (request.queryId === "item_detail_v1") {
          return {
            item: {
              card: normalizedCard(),
              contentBody: { blobDigest: null, storage: "inline" },
              preservedBody: { blobDigest: null, storage: "none" },
            },
            queryId: request.queryId,
            schemaVersion: request.schemaVersion,
            source,
          };
        }
        if (request.queryId === "background_item_page_v1") {
          return {
            nextCursor: null,
            queryId: request.queryId,
            rows: [normalizedRow(), normalizedRow("rss:follower-item-2")],
            schemaVersion: request.schemaVersion,
            source,
          };
        }
      }
      throw new Error(`Unexpected native command: ${command}`);
    });
  });

  it("signs and enqueues a read intent without using writer mutation authority", async () => {
    const result = await dispatchSqliteMutation(
      { reqId: 1, type: "MARK_AS_READ", globalId: ITEM_ID },
      state(),
    );

    const parsed = mocks.enqueuedEnvelopes.map((value) => JSON.parse(value));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      operation_type: "feed_item_read_assignment",
      actor_id: "12".repeat(32),
      actor_sequence: 1,
      entity_id: ITEM_ID,
    });
    expect(parsed[0].payload.read_at_ms).toEqual(expect.any(Number));
    expect(result.event).toMatchObject({
      source: "item_patch",
      mutation: "MARK_AS_READ",
      changedItemIds: [ITEM_ID],
    });
    expect(result.state.searchCorpusVersion).toBe(2);
  });

  it("routes saved state through the follower intent outbox", async () => {
    await dispatchSqliteMutation(
      { reqId: 2, type: "TOGGLE_SAVED", globalId: ITEM_ID },
      state(),
    );

    const parsed = mocks.enqueuedEnvelopes.map((value) => JSON.parse(value));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      operation_type: "feed_item_saved_assignment",
      actor_id: "12".repeat(32),
      actor_sequence: 1,
      entity_id: ITEM_ID,
      payload: { assigned: true },
    });
    expect(parsed[0].payload.assigned_at_ms).toEqual(expect.any(Number));
  });

  it("routes RSS edits through a signed intent without replacing the shell", async () => {
    const feed = {
      url: "https://example.com/feed.xml",
      title: "Example",
      siteUrl: "https://example.com",
      enabled: true,
      lastFetched: 1,
      trackUnread: true,
    };
    const result = await dispatchSqliteMutation(
      { reqId: 3, type: "ADD_RSS_FEED", feed },
      state(),
    );

    const parsed = mocks.enqueuedEnvelopes.map((value) => JSON.parse(value));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      operation_type: "rss_feed_upsert",
      entity_id: feed.url,
      payload: { feed },
    });
    expect(result.state.feeds[feed.url]).toEqual(feed);
  });

  it("expands a bulk read action into one signed transaction", async () => {
    await dispatchSqliteMutation(
      { reqId: 4, type: "MARK_ALL_AS_READ", platform: "rss" },
      state(),
    );

    const parsed = mocks.enqueuedEnvelopes.map((value) => JSON.parse(value));
    expect(parsed).toHaveLength(2);
    expect(parsed.map((value) => value.entity_id)).toEqual([
      ITEM_ID,
      "rss:follower-item-2",
    ]);
    expect(
      parsed.every(
        (value) => value.operation_type === "feed_item_read_assignment",
      ),
    ).toBe(true);
  });
});

describe("SQLite Primary mutations", () => {
  beforeEach(() => {
    mocks.enqueuedEnvelopes = [];
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "normalized_library_primary_mutation_context") {
        return {
          libraryId: "ab".repeat(32),
          epoch: 1,
          epochId: "cd".repeat(32),
          actorId: "12".repeat(32),
          actorPublicKey: "23".repeat(32),
          nextCounter: 1,
          previousOperationId: null,
          previousChainDigest: "34".repeat(32),
          observedFrontier: [],
        };
      }
      if (command === "normalized_library_follower_mutation_context") {
        return {
          libraryId: "ab".repeat(32),
          epoch: 1,
          epochId: "cd".repeat(32),
          actorId: "78".repeat(32),
          actorPublicKey: "89".repeat(32),
          nextCounter: 1,
          previousOperationId: null,
          previousChainDigest: "9a".repeat(32),
          observedFrontier: [],
        };
      }
      if (command === "sign_normalized_library_operation") {
        const request = (
          args as {
            request: { actorId: string; operationSigningBodyDigest: string };
          }
        ).request;
        return {
          actorId: request.actorId,
          operationSigningBodyDigest: request.operationSigningBodyDigest,
          signature: "45".repeat(64),
        };
      }
      if (command === "sign_normalized_library_follower_operation") {
        const request = (
          args as {
            request: { actorId: string; operationSigningBodyDigest: string };
          }
        ).request;
        return {
          actorId: request.actorId,
          operationSigningBodyDigest: request.operationSigningBodyDigest,
          signature: "9b".repeat(64),
        };
      }
      if (command === "enqueue_normalized_library_follower_intent") {
        const request = (
          args as { request: { canonicalEnvelopeJson: string[] } }
        ).request;
        mocks.enqueuedEnvelopes = request.canonicalEnvelopeJson;
        return {
          transactionId: "desktop-library-like:test",
          actorId: "78".repeat(32),
          firstCounter: 1,
          lastCounter: 1,
          memberCount: 1,
          optimisticFieldCount: 0,
          state: "pending",
        };
      }
      if (command === "commit_normalized_library_transaction") {
        const request = (
          args as {
            request: { canonicalEnvelopeJson: string[] };
          }
        ).request;
        mocks.enqueuedEnvelopes = request.canonicalEnvelopeJson;
        const envelope = JSON.parse(request.canonicalEnvelopeJson[0]) as {
          actor_id: string;
          transaction_id: string;
          transaction_digest: string;
        };
        return {
          transactionId: envelope.transaction_id,
          transactionDigest: envelope.transaction_digest,
          actorId: envelope.actor_id,
          memberCount: request.canonicalEnvelopeJson.length,
          firstCounter: 1,
          lastCounter: 1,
          committedOperationId: "op:primary:1",
          committedChainDigest: "56".repeat(32),
          previousRevision: 1,
          committedRevision: 2,
          committedAt: 1_000,
          followerResultDigest: "67".repeat(32),
          followerResultSequence: 1,
          canonicalFollowerResultJson: "{}",
          invalidations: [
            {
              ordinal: 0,
              topic: "feed_item",
              entityId: ITEM_ID,
              resetRequired: false,
            },
          ],
        };
      }
      if (command === "freeze_normalized_rss_feed_scope") {
        mocks.scopeActionKind = (args as { actionKind: string }).actionKind;
        return {
          memberCount: 2,
          stageId: (args as { stageId: string }).stageId,
          state: "ready",
        };
      }
      if (command === "page_normalized_scope_action") {
        const request = args as { afterOrdinal: number; stageId: string };
        return {
          entityIds:
            request.afterOrdinal < 0
              ? mocks.scopeActionKind === "rss_feeds_heal_untitled_frozen"
                ? ["https://feeds.example.com/rss"]
                : [
                    "https://one.example/feed.xml",
                    "https://two.example/feed.xml",
                  ]
              : [],
          nextOrdinal: request.afterOrdinal < 0 ? 1 : request.afterOrdinal,
          stageId: request.stageId,
        };
      }
      if (command === "close_normalized_scope_action") return undefined;
      if (command === "query_normalized_library") {
        const request = (
          args as { request: { queryId: string; schemaVersion: number } }
        ).request;
        const source = {
          generationId: "bc".repeat(32),
          projectionRevision: 2,
          transitionSequence: 2,
        };
        if (request.queryId === "library_facet_summary_v1") {
          return {
            queryId: request.queryId,
            schemaVersion: request.schemaVersion,
            source,
            summary: {
              archivedCount: 0,
              archivableCount: 0,
              contactAccountCount: 0,
              contactLinkedPersonCount: 0,
              enabledRssFeedCount: 0,
              friendPersonCount: 0,
              latestContactImportedAt: null,
              latestRssFeedFetchedAt: null,
              platformCounts: [
                {
                  archivableCount: 0,
                  latestCapturedAt: 1,
                  latestPublishedAt: 1,
                  platform: "rss",
                  totalCount: 1,
                  unreadCount: 0,
                },
              ],
              rssFeedCount: 0,
              sampleAccountCount: 0,
              sampleFeedCount: 0,
              sampleItemCount: 0,
              samplePersonCount: 0,
              savedArchivedCount: 0,
              savedCount: 0,
              savedPlatformCount: 0,
              socialAccountCount: 0,
              tags: [],
              totalCount: 1,
              unreadCount: 0,
            },
          };
        }
        if (request.queryId === "item_detail_v1") {
          return {
            item: null,
            queryId: request.queryId,
            schemaVersion: request.schemaVersion,
            source,
          };
        }
        if (request.queryId === "person_detail_v1") {
          return {
            linkedAccountCount: 0,
            linkedAccounts: [],
            person: {
              avatarUrl: null,
              bio: null,
              careLevel: 3,
              createdAt: 10,
              id: "person-1",
              name: "Ada",
              notes: null,
              reachOutIntervalDays: null,
              reachOuts: [],
              relationshipStatus: "friend",
              sampleBatchId: null,
              sampleGeneratedAt: null,
              sampleGeneratorVersion: null,
              tags: ["mathematician"],
              updatedAt: 20,
            },
            queryId: request.queryId,
            schemaVersion: request.schemaVersion,
            source,
          };
        }
        if (request.queryId === "rss_feed_detail_v1") {
          return {
            feed: {
              enabled: true,
              folder: "Research",
              imageUrl: "https://example.com/icon.png",
              lastFetched: 100,
              pollInterval: 30,
              sampleBatchId: "sample-batch",
              sampleGeneratedAt: 10,
              sampleGeneratorVersion: 1,
              siteUrl: "https://example.com",
              title: "Existing Feed",
              trackUnread: true,
              updatedAt: 20,
              url: "https://example.com/feed.xml",
            },
            queryId: request.queryId,
            schemaVersion: request.schemaVersion,
            source,
          };
        }
      }
      throw new Error(`Unexpected native command: ${command}`);
    });
  });

  it("commits a read assignment through the selected normalized Primary", async () => {
    await dispatchSqliteMutation(
      { reqId: 5, type: "MARK_AS_READ", globalId: ITEM_ID },
      state(),
    );

    const [envelope] = mocks.enqueuedEnvelopes.map((value) =>
      JSON.parse(value),
    );
    expect(envelope).toMatchObject({
      operation_type: "feed_item_read_assignment",
      actor_id: "12".repeat(32),
      actor_sequence: 1,
      entity_id: ITEM_ID,
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "commit_normalized_library_transaction",
      expect.objectContaining({
        request: expect.objectContaining({
          libraryId: "ab".repeat(32),
          canonicalEnvelopeJson: expect.any(Array),
        }),
      }),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "normalized_library_follower_mutation_context",
      expect.anything(),
    );
  });

  it.each([
    ["CONFIRM_LIKED_SYNCED", "feed_item_like_sync_receipt"],
    ["CONFIRM_SEEN_SYNCED", "feed_item_seen_sync_receipt"],
  ] as const)(
    "commits %s as a typed normalized provider receipt",
    async (requestType, operationType) => {
      await dispatchSqliteMutation(
        {
          reqId: 6,
          type: requestType,
          globalId: ITEM_ID,
          syncedAt: 1_783_000_000_000,
        },
        state(),
      );

      const [envelope] = mocks.enqueuedEnvelopes.map((value) =>
        JSON.parse(value),
      );
      expect(envelope).toMatchObject({
        operation_type: operationType,
        entity_id: ITEM_ID,
        payload: { synced_at_ms: 1_783_000_000_000 },
      });
      expect(mocks.invoke).toHaveBeenCalledWith(
        "commit_normalized_library_transaction",
        expect.objectContaining({
          request: expect.objectContaining({
            canonicalEnvelopeJson: expect.any(Array),
          }),
        }),
      );
    },
  );

  it("reads an exact Person before applying a partial normalized update", async () => {
    await dispatchSqliteMutation(
      {
        reqId: 6,
        type: "UPDATE_PERSON",
        personId: "person-1",
        updates: { notes: "Follow up next week" },
      },
      state(),
    );

    const [envelope] = mocks.enqueuedEnvelopes.map((value) =>
      JSON.parse(value),
    );
    expect(envelope).toMatchObject({
      operation_type: "person_upsert",
      entity_id: "person-1",
      payload: {
        person: {
          id: "person-1",
          name: "Ada",
          notes: "Follow up next week",
          tags: ["mathematician"],
        },
      },
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "query_normalized_library",
      expect.objectContaining({
        request: expect.objectContaining({
          personId: "person-1",
          queryId: "person_detail_v1",
        }),
      }),
    );
  });

  it("submits one atomic Friend replacement through the Primary", async () => {
    await replaceSqliteLibraryFriend(
      {
        id: "person-1",
        name: "Ada Updated",
        relationshipStatus: "friend",
        careLevel: 5,
        createdAt: 10,
        updatedAt: 30,
      },
      [],
      30,
    );

    expect(mocks.enqueuedEnvelopes).toHaveLength(1);
    expect(JSON.parse(mocks.enqueuedEnvelopes[0]!)).toMatchObject({
      entity_id: "person-1",
      entity_type: "Person",
      operation_type: "friend_replace",
      payload: {
        accounts: [],
        person: {
          id: "person-1",
          name: "Ada Updated",
          relationshipStatus: "friend",
          careLevel: 5,
          createdAt: 10,
          updatedAt: 30,
        },
      },
      transaction_member_count: 1,
    });
  });

  it("reads an exact RSS Feed before applying a partial normalized update", async () => {
    await dispatchSqliteMutation(
      {
        reqId: 7,
        type: "UPDATE_RSS_FEED",
        url: "https://example.com/feed.xml",
        updates: { title: "Renamed Feed" },
      },
      state(),
    );

    const [envelope] = mocks.enqueuedEnvelopes.map((value) =>
      JSON.parse(value),
    );
    expect(envelope).toMatchObject({
      operation_type: "rss_feed_upsert",
      entity_id: "https://example.com/feed.xml",
      payload: {
        feed: {
          enabled: true,
          folder: "Research",
          imageUrl: "https://example.com/icon.png",
          lastFetched: 100,
          pollInterval: 30,
          sampleDataFingerprint: {
            batchId: "sample-batch",
            generatedAt: 10,
            generatorVersion: 1,
            marker: "freed.sample-data.v1",
          },
          siteUrl: "https://example.com",
          title: "Renamed Feed",
          trackUnread: true,
          url: "https://example.com/feed.xml",
        },
      },
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "query_normalized_library",
      expect.objectContaining({
        request: expect.objectContaining({
          queryId: "rss_feed_detail_v1",
          url: "https://example.com/feed.xml",
        }),
      }),
    );
  });

  it("removes the complete frozen RSS Feed scope without a renderer feed map", async () => {
    await dispatchSqliteMutation(
      { includeItems: false, reqId: 8, type: "REMOVE_ALL_FEEDS" },
      state(),
    );

    const envelopes = mocks.enqueuedEnvelopes.map((value) => JSON.parse(value));
    expect(envelopes).toHaveLength(2);
    expect(envelopes.map((value) => value.entity_id)).toEqual([
      "https://one.example/feed.xml",
      "https://two.example/feed.xml",
    ]);
    expect(
      envelopes.every(
        (value) => value.operation_type === "rss_feed_remove_keep_items",
      ),
    ).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "freeze_normalized_rss_feed_scope",
      expect.objectContaining({
        actionKind: "rss_feeds_remove_keep_items",
        requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("repairs the complete frozen untitled RSS scope with title assignments", async () => {
    await dispatchSqliteMutation(
      { reqId: 9, type: "HEAL_UNTITLED_FEEDS" },
      state(),
    );

    const [envelope] = mocks.enqueuedEnvelopes.map((value) =>
      JSON.parse(value),
    );
    expect(envelope).toMatchObject({
      entity_id: "https://feeds.example.com/rss",
      operation_type: "rss_feed_title_assignment",
      payload: { title: "example.com" },
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "freeze_normalized_rss_feed_scope",
      expect.objectContaining({
        actionKind: "rss_feeds_heal_untitled_frozen",
      }),
    );
  });

  it("keeps provider-visible likes off the Primary path", async () => {
    await dispatchSqliteMutation(
      { reqId: 6, type: "TOGGLE_LIKED", globalId: ITEM_ID },
      state(),
    );

    const [envelope] = mocks.enqueuedEnvelopes.map((value) =>
      JSON.parse(value),
    );
    expect(envelope).toMatchObject({
      operation_type: "feed_item_like_assignment",
      actor_id: "78".repeat(32),
      entity_id: ITEM_ID,
    });
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "sign_normalized_library_operation",
      ),
    ).toBe(false);
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "commit_normalized_library_transaction",
      ),
    ).toBe(false);
  });
});
