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
        const request = (args as {
          request: { actorId: string; operationSigningBodyDigest: string };
        }).request;
        return {
          actorId: request.actorId,
          operationSigningBodyDigest: request.operationSigningBodyDigest,
          signature: "45".repeat(64),
        };
      }
      if (command === "enqueue_sqlite_library_follower_intent") {
        const request = (args as {
          request: { canonicalEnvelopeJson: string[] };
        }).request;
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
});
