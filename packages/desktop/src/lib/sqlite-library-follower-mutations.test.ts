import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences, type FeedItem } from "@freed/shared";
import type { DocState } from "./library-types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  enqueuedEnvelopes: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

import { dispatchSqliteMutation } from "./sqlite-library";

const ITEM_ID = "rss:follower-item";

function item(readAt?: number): FeedItem {
  return {
    globalId: ITEM_ID,
    platform: "rss",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: { text: ITEM_ID, mediaUrls: [], mediaTypes: [] },
    topics: [],
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
      ...(readAt === undefined ? {} : { readAt }),
    },
  };
}

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
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "normalized_library_primary_mutation_context") {
        throw new Error("normalized SQLite authority is not selected");
      }
      if (command === "sqlite_library_follower_intent_context") {
        return {
          authority: {
            library_id: "ab".repeat(32),
            epoch: 1,
            epoch_id: "cd".repeat(32),
            authority_key_id: "de".repeat(32),
            authority_public_key: "ef".repeat(32),
            observed_frontier: [],
          },
          actorId: "12".repeat(32),
          actorPublicKey: "23".repeat(32),
          nextIntentSequence: 1,
          previousOperationId: null,
          previousChainDigest: "34".repeat(32),
        };
      }
      if (command === "sign_sqlite_library_follower_operation") {
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
      if (command === "enqueue_sqlite_library_follower_intent") {
        const request = (
          args as {
            request: { canonicalEnvelopeJson: string[] };
          }
        ).request;
        mocks.enqueuedEnvelopes = request.canonicalEnvelopeJson;
        return {
          transactionId: "desktop-follower-read:test",
          firstIntentSequence: 1,
          lastIntentSequence: 1,
          operationCount: 1,
          status: "enqueued",
        };
      }
      if (command === "read_sqlite_library_counts") {
        return {
          revision: 2,
          itemCount: 1,
          unreadCount: 0,
          archivableCount: 1,
          countsByPlatform: { rss: 1 },
          unreadByPlatform: {},
          archivableByPlatform: { rss: 1 },
          feedCounts: {},
          unreadFeedCounts: {},
          archivableFeedCounts: {},
        };
      }
      if (command === "read_sqlite_library_items") {
        return [JSON.stringify(item(1_000))];
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
      if (command === "query_sqlite_library_items") {
        return {
          itemsJson: [
            JSON.stringify(item()),
            JSON.stringify({ ...item(), globalId: "rss:follower-item-2" }),
          ],
          nextOffset: null,
          totalCount: 2,
        };
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
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "mutate_sqlite_library_items",
      expect.anything(),
    );
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
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "mutate_sqlite_library_items",
      expect.anything(),
    );
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
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "replace_sqlite_library_shell",
      expect.anything(),
    );
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
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "mutate_sqlite_library_items",
      expect.anything(),
    );
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
      if (command === "sqlite_library_follower_intent_context") {
        return {
          authority: {
            library_id: "ab".repeat(32),
            epoch: 1,
            epoch_id: "cd".repeat(32),
            authority_key_id: "de".repeat(32),
            authority_public_key: "ef".repeat(32),
            observed_frontier: [],
          },
          actorId: "78".repeat(32),
          actorPublicKey: "89".repeat(32),
          nextIntentSequence: 1,
          previousOperationId: null,
          previousChainDigest: "9a".repeat(32),
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
      if (command === "sign_sqlite_library_follower_operation") {
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
      if (command === "enqueue_sqlite_library_follower_intent") {
        const request = (
          args as { request: { canonicalEnvelopeJson: string[] } }
        ).request;
        mocks.enqueuedEnvelopes = request.canonicalEnvelopeJson;
        return {
          transactionId: "desktop-library-like:test",
          firstIntentSequence: 1,
          lastIntentSequence: 1,
          operationCount: 1,
          status: "enqueued",
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
              sampleItemCount: 0,
              savedArchivedCount: 0,
              savedCount: 0,
              savedPlatformCount: 0,
              tags: [],
              totalCount: 1,
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
      if (command === "read_sqlite_library_counts") {
        return {
          revision: 2,
          itemCount: 1,
          unreadCount: 0,
          archivableCount: 1,
          countsByPlatform: { rss: 1 },
          unreadByPlatform: {},
          archivableByPlatform: { rss: 1 },
          feedCounts: {},
          unreadFeedCounts: {},
          archivableFeedCounts: {},
        };
      }
      if (command === "read_sqlite_library_items") {
        return [JSON.stringify(item(1_000))];
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
      "sqlite_library_follower_intent_context",
      expect.anything(),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "mutate_sqlite_library_items",
      expect.anything(),
    );
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) =>
          command === "read_sqlite_library_counts" ||
          command === "read_sqlite_library_items",
      ),
    ).toBe(false);
  });

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
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "replace_sqlite_library_shell",
      expect.anything(),
    );
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
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "replace_sqlite_library_shell",
      expect.anything(),
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
