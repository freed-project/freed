import orderVector from "../../../shared/src/library-core/friend-account-order-vector-v1.json";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";

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
  prepareDesktopRecoveryAccountTransaction,
  prepareDesktopRecoveryPersonTransaction,
  prepareDesktopRecoveryFriendTransaction,
  prepareDesktopRecoveryAccountPersonTransaction,
  prepareDesktopRecoveryAnnotationTransaction,
  prepareDesktopRecoveryRssUpsertTransaction,
  prepareDesktopRecoveryRssRemovalTransaction,
  prepareDesktopRecoveryItemRemovalTransaction,
  prepareDesktopRecoveryAccountRemovalTransaction,
  prepareDesktopRecoveryPersonRemovalTransaction,
  appendSqliteLibraryPersonReachOut,
  assignSqliteLibraryAccountToPerson,
  commitDesktopLibraryFeedItemAnalysisSets,
  commitDesktopLibrarySampleRemovalPlan,
  dispatchSqliteMutation,
  removeSqliteLibraryPerson,
  replaceSqliteLibraryFriend,
  upsertSqliteLibraryPerson,
  upsertSqliteLibraryAccount,
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
    linkPreviewUrl: null,
    locationName: null,
    mediaTypes: [],
    mediaUrls: [],
    platform: "rss",
    publishedAt: 1,
    rankingCareLevel: null,
    rankingEngagementReposts: null,
    rankingEngagementViews: null,
    readAt: null,
    readingTimeMinutes: null,
    rssSource: null,
    sampleDataFingerprint: null,
    saved: false,
    sourceUrl: null,
    tags: [],
    topics: [],
  };
}

function normalizedCard(globalId = ITEM_ID) {
  const {
    hidden: _hidden,
    rankingCareLevel: _rankingCareLevel,
    rankingEngagementReposts: _rankingEngagementReposts,
    rankingEngagementViews: _rankingEngagementViews,
    rssSource: _rssSource,
    sampleDataFingerprint: _sampleDataFingerprint,
    topics: _topics,
    ...card
  } = normalizedRow(globalId);
  return card;
}

describe("SQLite editable follower mutations", () => {
  beforeEach(() => {
    mocks.enqueuedEnvelopes = [];
    mocks.scopeActionKind = null;
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "normalized_desktop_installation_status") {
        return { state: "editable_consumer", role: "follower", libraryId: "ab".repeat(32), authorityEpochId: "cd".repeat(32), actorId: "12".repeat(32) };
      }
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
          optimisticFieldCount: 1,
          state: "pending",
        };
      }
      if (command === "query_normalized_library") {
        const request = (
          args as { request: { queryId: string; schemaVersion: number; globalId?: string } }
        ).request;
        const source = {
          generationId: "bc".repeat(32),
          projectionRevision: 2,
          transitionSequence: 2,
        };
        if (request.queryId === "rss_item_summary_v1") {
          return { queryId: request.queryId, schemaVersion: request.schemaVersion, source, totalCount: 1, unreadCount: 0 };
        }
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
        if (request.queryId === "preferences_snapshot_v1") {
          return {
            queryId: request.queryId,
            rows: [],
            schemaVersion: request.schemaVersion,
            source,
          };
        }
        if (request.queryId === "item_annotations_v1") {
          return {
            queryId: request.queryId,
            schemaVersion: 1,
            globalId: request.globalId,
            source,
            tags: [],
            highlights: [],
          };
        }
        if (request.queryId === "item_detail_v1") {
          return {
            item: {
              card: normalizedCard(),
              contentBody: { blobDigest: null, storage: "inline" },
              mediaBlobDigests: [],
              preservedBody: { blobDigest: null, storage: "none" },
            },
            queryId: request.queryId,
            schemaVersion: request.schemaVersion,
            source,
          };
        }
        if (request.queryId === "optimistic_fields_v1") {
          return {
            queryId: request.queryId,
            rows: [],
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

  it("carries the annotation snapshot through signing and rejects stale admission without resigning", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "enqueue_normalized_library_follower_intent") {
        const request = (args as { request: { expectedSource: unknown } }).request;
        expect(request.expectedSource).toEqual({ generationId: "bc".repeat(32), projectionRevision: 2, transitionSequence: 2 });
        throw new Error("LOCAL_ADMISSION_SOURCE_STALE");
      }
      return original(command, args);
    });
    await expect(dispatchSqliteMutation({ type: "UPDATE_SAVED_ITEM_NOTE", globalId: ITEM_ID, note: "changed", reqId: 20 })).rejects.toThrow("LOCAL_ADMISSION_SOURCE_STALE");
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "sign_normalized_library_follower_operation")).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "enqueue_normalized_library_follower_intent")).toHaveLength(1);
  });

  it("signs Friend recovery account IDs in native binary order without reordering the caller", async () => {
    const person = { id: "person:one", name: "First", relationshipStatus: "friend" as const, careLevel: 3 as const, createdAt: 1, updatedAt: 2 };
    const accounts = [...orderVector.binaryOrder].reverse().map(id => ({ id, personId: person.id, kind: "social" as const, provider: "instagram" as const,
      externalId: "selected", discoveredFrom: "manual_entry" as const, firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2 }));
    const frames = await prepareDesktopRecoveryFriendTransaction(person, accounts);
    expect(JSON.parse(frames[0]!).payload.accounts.map((account: { id: string }) => account.id)).toEqual(orderVector.binaryOrder);
    expect(accounts.map(account => account.id)).toEqual([...orderVector.binaryOrder].reverse());
  });

  it("snapshots a complete Friend selection before signing and never enqueues outside recovery", async () => {
    const person = { id: "person:one", name: "First", relationshipStatus: "friend" as const, careLevel: 3 as const, createdAt: 12, updatedAt: 13 };
    const account = { id: "account:one", personId: person.id, kind: "social" as const, provider: "instagram" as const, externalId: "one", discoveredFrom: "manual_entry" as const, firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2, followRosterRoles: ["following" as const] };
    const pending = prepareDesktopRecoveryFriendTransaction(person, [account]);
    person.name = "Changed"; account.followRosterRoles.length = 0;
    const frames = await pending;
    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0]!)).toMatchObject({ operation_type: "friend_replace", transaction_member_count: 1,
      payload: { person: { name: "First", createdAt: 12 }, accounts: [{ id: account.id, followRosterRoles: ["following"], createdAt: 1 }] } });
    expect(mocks.enqueuedEnvelopes).toEqual([]);
    await expect(prepareDesktopRecoveryFriendTransaction(person, [account, account])).rejects.toThrow("invalid or oversized");
  });

  it("snapshots complete Account roots and keeps duplicate targets without ordinary enqueue", async () => {
    const account = { id: "account:one", displayName: "First", kind: "social" as const, provider: "x" as const, externalId: "external:one", discoveredFrom: "manual_entry" as const, firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2, address: "a".repeat(20000) };
    const review = {} as Parameters<typeof prepareDesktopRecoveryAccountTransaction>[1];
    const pending = prepareDesktopRecoveryAccountTransaction([account, { ...account, displayName: "Second" }], review);
    account.displayName = "Changed";
    const values = (await pending).map(frame => JSON.parse(frame));
    expect(values.map(value => value.payload.account.displayName)).toEqual(["First", "Second"]);
    expect(values.map(value => value.entity_id)).toEqual(["account:one", "account:one"]);
    expect(values.every(value => value.payload.account.address.length === 20000 && value.payload.account.updatedAt > 2 && value.operation_type === "account_upsert")).toBe(true);
    expect(mocks.enqueuedEnvelopes).toEqual([]);
  });

  it("snapshots whole Person roots before key access and preserves ordered duplicate targets", async () => {
    const person = { id: "person:one", name: "First", relationshipStatus: "friend" as const, careLevel: 3 as const, tags: ["retained"], notes: "notes", createdAt: 12, updatedAt: 13 };
    const pending = prepareDesktopRecoveryPersonTransaction([person, { ...person, name: "Second" }]);
    person.name = "Changed"; person.tags.push("late mutation");
    const values = (await pending).map(frame => JSON.parse(frame));
    expect(values.map(value => value.payload.person.name)).toEqual(["First", "Second"]);
    expect(values.map(value => value.payload.person.tags)).toEqual([["retained"], ["retained"]]);
    expect(values.map(value => [value.entity_id, value.transaction_member_index, value.transaction_member_count])).toEqual([["person:one", 0, 2], ["person:one", 1, 2]]);
    expect(values.every(value => value.operation_type === "person_upsert" && value.payload.person.createdAt === 12 && value.payload.person.updatedAt > 13)).toBe(true);
    expect(mocks.enqueuedEnvelopes).toEqual([]);
    await expect(prepareDesktopRecoveryPersonTransaction([])).rejects.toThrow("member bound");
  });

  it("signs the entire RSS recovery transaction in order without enqueue or deduplication", async () => {
    const feeds = [
      { url: "https://example.com/feed", title: "First", enabled: false, trackUnread: true, lastFetched: 700, pollInterval: 60 },
      { url: "https://example.com/feed", title: "Second", enabled: true, trackUnread: false },
    ];
    const frames = await prepareDesktopRecoveryRssUpsertTransaction(feeds);
    const envelopes = frames.map((frame) => JSON.parse(frame));
    expect(envelopes.map((envelope) => envelope.payload.feed)).toEqual(feeds);
    expect(envelopes.map((envelope) => [envelope.operation_type, envelope.transaction_member_index, envelope.transaction_member_count])).toEqual([
      ["rss_feed_upsert", 0, 2], ["rss_feed_upsert", 1, 2],
    ]);
    expect(mocks.enqueuedEnvelopes).toEqual([]);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "commit_normalized_library_transaction")).toBe(false);
  });

  it("signs all ordered account links without deduplication or ordinary enqueue", async () => {
    const assignments = [{ accountId: "account-2", personId: "person-2" }, { accountId: "account-2", personId: null }];
    const frames = await prepareDesktopRecoveryAccountPersonTransaction(assignments);
    expect(frames.map(frame => { const e = JSON.parse(frame); return [e.operation_type, e.entity_id, e.payload.person_id, e.transaction_member_index, e.transaction_member_count]; })).toEqual([
      ["account_person_assignment", "account-2", "person-2", 0, 2], ["account_person_assignment", "account-2", null, 1, 2],
    ]);
    expect(mocks.enqueuedEnvelopes).toEqual([]);
    await expect(prepareDesktopRecoveryAccountPersonTransaction([])).rejects.toThrow("member bound");
  });

  it("prepares every preference patch with fresh signatures and no ordinary enqueue", async () => {
    const { prepareDesktopRecoveryPreferenceTransaction } = await import("./sqlite-library");
    const patches = [{ display: { reading: {}, showEngagementCounts: false } }, { display: { showEngagementCounts: true } }];
    const pending = prepareDesktopRecoveryPreferenceTransaction(patches);
    patches[0]!.display.showEngagementCounts = true;
    const values = (await pending).map(value => JSON.parse(value));
    expect(values.map(value => value.payload.updates)).toEqual([{ display: { reading: {}, showEngagementCounts: false } }, { display: { showEngagementCounts: true } }]);
    expect(values.map(value => value.transaction_member_index)).toEqual([0, 1]);
    expect(values.every(value => value.operation_type === "preferences_leaf_assignment" && value.entity_id === "preferences")).toBe(true);
    expect(values[1].actor_sequence).toBe(values[0].actor_sequence + 1);
    expect(values[1].previous_actor_operation_id).toBe(values[0].operation_id);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "enqueue_normalized_library_follower_intent")).toHaveLength(0);
    await expect(prepareDesktopRecoveryPreferenceTransaction([{ display: { unsupported: true } }])).rejects.toThrow();
  });

  it("snapshots reach-out history with fresh signing time and ordered duplicate targets", async () => {
    const { prepareDesktopRecoveryReachOutTransaction } = await import("./sqlite-library");
    const event = { channel: "email" as const, logged_at_ms: 1000, notes: "Historical" };
    const drafts = [0, 1].map(i => ({ personId: "person:event", originalOperationId: `old:${i}`, archived: event, event }));
    const pending = prepareDesktopRecoveryReachOutTransaction(drafts);
    event.logged_at_ms = 9999; event.notes = "Changed later";
    const values = (await pending).map(value => JSON.parse(value));
    expect(values.map(value => value.entity_id)).toEqual(["person:event", "person:event"]);
    expect(values.map(value => value.transaction_member_index)).toEqual([0, 1]);
    for (const value of values) {
      expect(value.operation_type).toBe("person_reach_out_append");
      expect(value.payload).toEqual({ channel: "email", logged_at_ms: 1000, notes: "Historical" });
      expect(value.created_at_ms).toBeGreaterThan(1000);
    }
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "enqueue_normalized_library_follower_intent")).toHaveLength(0);
  });

  it("prepares complete annotation recovery without enqueue or descriptor loss", async () => {
    const highlights = [
      { createdAt: 1, note: "Whole item note", text: "\u2063", textBlobDigest: null },
      { createdAt: 2, note: "Preserved note", text: "Original quotation", textBlobDigest: null },
      { createdAt: 3, note: null, text: null, textBlobDigest: "a".repeat(64) },
    ];
    const frames = await prepareDesktopRecoveryAnnotationTransaction([
      { entityId: ITEM_ID, highlights, tags: ["alpha", "zebra"] },
      { entityId: "rss:second", highlights: [], tags: [] },
    ]);
    const values = frames.map((frame) => JSON.parse(frame));
    expect(values[0].payload.highlights).toEqual(highlights);
    expect(values[0].payload.tags).toEqual(["alpha", "zebra"]);
    expect(values.map((value) => value.entity_id)).toEqual([ITEM_ID, "rss:second"]);
    expect(values.map((value) => value.transaction_member_index)).toEqual([0, 1]);
    expect(values.every((value) => value.transaction_member_count === 2)).toBe(true);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "sign_normalized_library_follower_operation")).toHaveLength(2);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "enqueue_normalized_library_follower_intent")).toHaveLength(0);
  });

  it("prepares whole unsubscribe recovery only after deletion confirmation and never ordinary enqueue", async () => {
    const urls = ["https://example.com/one", "https://example.com/two"];
    await expect(prepareDesktopRecoveryRssRemovalTransaction(urls, true, false)).rejects.toThrow("Confirm article deletion");
    expect(mocks.invoke).not.toHaveBeenCalled();
    for (const includeItems of [true, false]) {
      const frames = await prepareDesktopRecoveryRssRemovalTransaction(urls, includeItems, includeItems);
      const values = frames.map((frame) => JSON.parse(frame));
      expect(values.map((value) => value.entity_id)).toEqual(urls);
      expect(values.every((value) => value.operation_type === (includeItems ? "rss_feed_remove_with_items" : "rss_feed_remove_keep_items"))).toBe(true);
      expect(values.map((value) => value.transaction_member_index)).toEqual([0, 1]);
      expect(values.every((value) => value.transaction_member_count === 2 && value.payload.removed_at_ms > 0)).toBe(true);
    }
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "enqueue_normalized_library_follower_intent")).toHaveLength(0);
  });

  it("signs the complete ordered item deletion only after confirmation, without enqueue", async () => {
    const ids = [ITEM_ID, "rss:second", ITEM_ID];
    await expect(prepareDesktopRecoveryItemRemovalTransaction(ids, false)).rejects.toThrow("Confirm item deletion");
    expect(mocks.invoke).not.toHaveBeenCalled();
    const frames = await prepareDesktopRecoveryItemRemovalTransaction(ids, true);
    const values = frames.map((frame) => JSON.parse(frame));
    expect(values.map((value) => value.entity_id)).toEqual(ids);
    expect(values.map((value) => value.transaction_member_index)).toEqual([0, 1, 2]);
    expect(values.every((value) => value.operation_type === "feed_item_remove" && value.transaction_member_count === 3 && value.payload.removed_at_ms > 0)).toBe(true);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "enqueue_normalized_library_follower_intent")).toHaveLength(0);
  });

  it.each([
    ["person_remove_and_accounts", prepareDesktopRecoveryPersonRemovalTransaction, "Confirm people"],
    ["account_remove", prepareDesktopRecoveryAccountRemovalTransaction, "Confirm account"],
  ] as const)("snapshots every ordered %s deletion before context lookup and never enqueues", async (operation, prepare, confirmation) => {
    const ids = ["person:one", "person:two", "person:one"];
    await expect(prepare(ids, false)).rejects.toThrow(confirmation);
    expect(mocks.invoke).not.toHaveBeenCalled();
    const pending = prepare(ids, true);
    ids.splice(0, ids.length, "person:changed");
    const values = (await pending).map(frame => JSON.parse(frame));
    expect(values.map(value => value.entity_id)).toEqual(["person:one", "person:two", "person:one"]);
    expect(values.map(value => value.transaction_member_index)).toEqual([0, 1, 2]);
    expect(values.every(value => value.operation_type === operation && value.transaction_member_count === 3 && value.payload.removed_at_ms > 0)).toBe(true);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "enqueue_normalized_library_follower_intent")).toHaveLength(0);
  });

  it("signs and enqueues a read intent without using writer mutation authority", async () => {
    const result = await dispatchSqliteMutation({
      reqId: 1,
      type: "MARK_AS_READ",
      globalId: ITEM_ID,
    });

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
    await dispatchSqliteMutation({
      reqId: 2,
      type: "TOGGLE_SAVED",
      globalId: ITEM_ID,
    });

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

  it("routes RSS edits through a signed intent without constructing a shell", async () => {
    const feed = {
      url: "https://example.com/feed.xml",
      title: "Example",
      siteUrl: "https://example.com",
      enabled: true,
      lastFetched: 1,
      trackUnread: true,
    };
    const result = await dispatchSqliteMutation({
      reqId: 3,
      type: "ADD_RSS_FEED",
      feed,
    });

    const parsed = mocks.enqueuedEnvelopes.map((value) => JSON.parse(value));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      operation_type: "rss_feed_upsert",
      entity_id: feed.url,
      payload: { feed },
    });
    expect(result.state).not.toHaveProperty("feeds");
  });

  it("expands a bulk read action into one signed transaction", async () => {
    await dispatchSqliteMutation({
      reqId: 4,
      type: "MARK_ALL_AS_READ",
      platform: "rss",
    });

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
      if (command === "normalized_desktop_installation_status") {
        return { state: "standalone_primary", role: "primary", libraryId: "ab".repeat(32), authorityEpochId: "cd".repeat(32), actorId: "12".repeat(32) };
      }
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
      if (command === "sign_normalized_library_operations") {
        const request = (
          args as {
            request: { actorId: string; operationSigningBodyDigests: string[] };
          }
        ).request;
        return request.operationSigningBodyDigests.map((digest) => ({
          actorId: request.actorId,
          operationSigningBodyDigest: digest,
          signature: "45".repeat(64),
        }));
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
          optimisticFieldCount: 2,
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
          args as { request: { queryId: string; schemaVersion: number; personId?: string } }
        ).request;
        const source = {
          generationId: "bc".repeat(32),
          projectionRevision: 2,
          transitionSequence: 2,
        };
        if (request.queryId === "rss_item_summary_v1") {
          return { queryId: request.queryId, schemaVersion: request.schemaVersion, source, totalCount: 1, unreadCount: 0 };
        }
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
        if (request.queryId === "preferences_snapshot_v1") {
          return {
            queryId: request.queryId,
            rows: [],
            schemaVersion: request.schemaVersion,
            source,
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
        if (request.queryId === "person_root_v1") return { queryId: request.queryId, schemaVersion: 1, personId: request.personId, source,
          person: { id: request.personId, name: "Ada", careLevel: 3, createdAt: 10, updatedAt: 20, relationshipStatus: "friend", tags: ["mathematician"] } };
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

  it("passes the original annotation source to Primary commit without stale resigning", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "query_normalized_library") {
        const request = (args as { request: { queryId: string; globalId: string } }).request;
        if (request.queryId === "item_annotations_v1") return { queryId: request.queryId, schemaVersion: 1, globalId: request.globalId, source: { generationId: "bc".repeat(32), projectionRevision: 2, transitionSequence: 2 }, tags: [], highlights: [] };
      }
      if (command === "commit_normalized_library_transaction") {
        const request = (args as { request: { expectedSource: unknown } }).request;
        expect(request.expectedSource).toEqual({ generationId: "bc".repeat(32), projectionRevision: 2, transitionSequence: 2 });
        throw new Error("LOCAL_ADMISSION_SOURCE_STALE");
      }
      return original(command, args);
    });
    await expect(dispatchSqliteMutation({ type: "UPDATE_SAVED_ITEM_NOTE", globalId: ITEM_ID, note: "changed", reqId: 20 })).rejects.toThrow("LOCAL_ADMISSION_SOURCE_STALE");
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "sign_normalized_library_operations")).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "commit_normalized_library_transaction")).toHaveLength(1);
  });

  it("prepares Primary archive recovery with the selected actor and never commits outside recovery", async () => {
    const frames = await prepareDesktopRecoveryItemRemovalTransaction(["rss:first", "rss:second"], true, true);
    expect(frames.map(frame => JSON.parse(frame).actor_id)).toEqual(["12".repeat(32), "12".repeat(32)]);
    expect(frames.map(frame => JSON.parse(frame).entity_id)).toEqual(["rss:first", "rss:second"]);
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands).toContain("normalized_library_primary_mutation_context");
    expect(commands).not.toContain("normalized_library_follower_mutation_context");
    expect(commands).not.toContain("enqueue_normalized_library_follower_intent");
    expect(commands).not.toContain("commit_normalized_library_transaction");
  });

  it("does not fall back to the consumer when explicit Primary recovery is fenced", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("native handoff fences this authority operation"));
    await expect(prepareDesktopRecoveryItemRemovalTransaction(["rss:first"], true, true)).rejects.toThrow("fences");
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(["normalized_library_primary_mutation_context"]);
  });

  it("encodes fractional synchronized preferences in the canonical envelope", async () => {
    const storyWall = createDefaultPreferences().storyWall;
    await dispatchSqliteMutation({
      reqId: 5,
      type: "UPDATE_PREFERENCES",
      updates: {
        weights: { ...createDefaultPreferences().weights, topics: { alpha: 0.125 } },
        storyWall: {
          ...storyWall,
          style: { ...storyWall.style, mediaDensity: 0.95 },
        },
      },
    });
    const [envelope] = mocks.enqueuedEnvelopes.map((value) =>
      JSON.parse(value),
    );
    expect(envelope.payload.updates.weights.topics.alpha).toEqual({ bits: "3fc0000000000000", codec: "ieee754_binary64_hex_v1" });
    expect(envelope.operation_type).toBe("preferences_leaf_assignment");
    expect(envelope.payload.updates.storyWall.style.mediaDensity).not.toBe(
      0.95,
    );
    expect(envelope.payload.updates.storyWall.style.mediaDensity).toEqual({
      bits: "3fee666666666666",
      codec: "ieee754_binary64_hex_v1",
    });
  });

  it.each([
    {
      displayName: "Ada Lovelace",
      existingPerson: false,
      expectedReplacements: 1,
    },
    {
      displayName: "Science Daily",
      existingPerson: false,
      expectedReplacements: 0,
    },
    {
      displayName: "Ada Lovelace",
      existingPerson: true,
      expectedReplacements: 0,
    },
  ])(
    "reconciles $displayName without replacing an existing Person ($existingPerson)",
    async ({ displayName, existingPerson, expectedReplacements }) => {
      const original = mocks.invoke.getMockImplementation()!;
      mocks.invoke.mockImplementation(async (command, args) => {
        if (command === "query_normalized_library") {
          const { request } = args;
          if (request.queryId === "account_detail_v1")
            return {
              queryId: request.queryId,
              schemaVersion: 1,
              account: null,
              source: {
                generationId: "bc".repeat(32),
                projectionRevision: 2,
                transitionSequence: 2,
              },
            };
          if (request.queryId === "person_root_v1") {
            const response = await original(command, args);
            return {
              ...response,
              person: existingPerson
                ? { ...response.person, id: request.personId }
                : null,
            };
          }
        }
        return original(command, args);
      });
      await dispatchSqliteMutation({
        reqId: 5,
        type: "RECONCILE_FOLLOW_ROSTER_CAPTURE",
        items: [],
        options: { provider: "substack", capturedAt: 100 },
        accounts: [
          {
            id: "substack:ada",
            kind: "social",
            provider: "substack",
            externalId: "ada",
            displayName,
            discoveredFrom: "follow_roster",
            firstSeenAt: 100,
            lastSeenAt: 100,
            createdAt: 100,
            updatedAt: 100,
          },
        ],
      });
      const envelopes = mocks.invoke.mock.calls
        .filter(
          ([command]) => command === "commit_normalized_library_transaction",
        )
        .flatMap(([, args]) =>
          args.request.canonicalEnvelopeJson.map((value: string) =>
            JSON.parse(value),
          ),
        );
      const replacements = envelopes.filter(
        (envelope) => envelope.operation_type === "friend_replace",
      );
      expect(replacements).toHaveLength(expectedReplacements);
      if (expectedReplacements)
        expect(replacements[0].payload).toMatchObject({
          person: { name: "Ada Lovelace", relationshipStatus: "connection" },
          accounts: [{ id: "substack:ada", externalId: "ada" }],
        });
    },
  );

  it("commits a read assignment through the selected normalized Primary", async () => {
    await dispatchSqliteMutation({
      reqId: 5,
      type: "MARK_AS_READ",
      globalId: ITEM_ID,
    });

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
      await dispatchSqliteMutation({
        reqId: 6,
        type: requestType,
        globalId: ITEM_ID,
        syncedAt: 1_783_000_000_000,
      });

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

  it("submits one atomic Friend replacement through the Primary", async () => {
    await replaceSqliteLibraryFriend(
      {
        id: "person-1",
        name: "Ada Updated",
        relationshipStatus: "friend",
        careLevel: 5,
        reachOutLog: [{ channel: "text", loggedAt: 39 }],
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

  it("submits closed Person and Account mutations without a renderer store", async () => {
    await upsertSqliteLibraryPerson(
      {
        id: "person-2",
        name: "Grace",
        relationshipStatus: "friend",
        careLevel: 5,
        createdAt: 40,
        updatedAt: 40,
      },
      40,
    );
    expect(JSON.parse(mocks.enqueuedEnvelopes[0]!)).toMatchObject({
      entity_id: "person-2",
      operation_type: "person_upsert",
    });
    expect(
      JSON.parse(mocks.enqueuedEnvelopes[0]!).payload.person,
    ).not.toHaveProperty("reachOutLog");

    await appendSqliteLibraryPersonReachOut(
      "person-2",
      { channel: "text", loggedAt: 41, notes: "Hello" },
      42,
    );
    expect(JSON.parse(mocks.enqueuedEnvelopes[0]!)).toMatchObject({
      entity_id: "person-2",
      operation_type: "person_reach_out_append",
      payload: {
        channel: "text",
        logged_at_ms: 41,
        notes: "Hello",
      },
    });

    await assignSqliteLibraryAccountToPerson("account-2", "person-2", 43);
    expect(JSON.parse(mocks.enqueuedEnvelopes[0]!)).toMatchObject({
      entity_id: "account-2",
      operation_type: "account_person_assignment",
      payload: { assigned_at_ms: 43, person_id: "person-2" },
    });

    await upsertSqliteLibraryAccount(
      {
        id: "account-3",
        kind: "social",
        provider: "instagram",
        externalId: "grace",
        discoveredFrom: "captured_item",
        firstSeenAt: 43,
        lastSeenAt: 43,
        createdAt: 43,
        updatedAt: 43,
      },
      43,
    );
    expect(JSON.parse(mocks.enqueuedEnvelopes[0]!)).toMatchObject({
      entity_id: "account-3",
      operation_type: "account_upsert",
    });

    await removeSqliteLibraryPerson("person-2", 44);
    expect(JSON.parse(mocks.enqueuedEnvelopes[0]!)).toMatchObject({
      entity_id: "person-2",
      operation_type: "person_remove_and_accounts",
      payload: { removed_at_ms: 44 },
    });
  });

  it.each(["primary", "follower"])("renames an RSS feed as %s without resending polling settings or fetch history", async (role) => {
    if (role === "follower") {
      const previous = mocks.invoke.getMockImplementation()!;
      mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
        if (command === "normalized_library_primary_mutation_context") {
          throw new Error("normalized SQLite authority is not selected");
        }
        return previous(command, args);
      });
    }
    await dispatchSqliteMutation({
      reqId: 7,
      type: "UPDATE_RSS_FEED",
      url: "https://example.com/feed.xml",
      updates: { title: "Renamed Feed" },
    });

    const [envelope] = mocks.enqueuedEnvelopes.map((value) => JSON.parse(value));
    expect(envelope).toMatchObject({
      operation_type: "rss_feed_title_assignment",
      entity_id: "https://example.com/feed.xml",
    });
    expect(envelope.payload).toEqual({
      assigned_at_ms: expect.any(Number),
      title: "Renamed Feed",
    });
    expect(mocks.enqueuedEnvelopes).toHaveLength(1);
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands.filter((command) => command === "enqueue_normalized_library_follower_intent"))
      .toHaveLength(role === "follower" ? 1 : 0);
    expect(commands.filter((command) => command === "commit_normalized_library_transaction"))
      .toHaveLength(role === "primary" ? 1 : 0);
  });

  it("reads an exact RSS Feed before applying another partial normalized update", async () => {
    await dispatchSqliteMutation({
      reqId: 7,
      type: "UPDATE_RSS_FEED",
      url: "https://example.com/feed.xml",
      updates: { enabled: false, title: "Renamed Feed" },
    });

    const [envelope] = mocks.enqueuedEnvelopes.map((value) =>
      JSON.parse(value),
    );
    expect(envelope).toMatchObject({
      operation_type: "rss_feed_upsert",
      entity_id: "https://example.com/feed.xml",
      payload: {
        feed: {
          enabled: false,
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
    await dispatchSqliteMutation({
      includeItems: false,
      reqId: 8,
      type: "REMOVE_ALL_FEEDS",
    });

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
    await dispatchSqliteMutation({ reqId: 9, type: "HEAL_UNTITLED_FEEDS" });

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
    await dispatchSqliteMutation({
      reqId: 6,
      type: "TOGGLE_LIKED",
      globalId: ITEM_ID,
    });

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
        ([command]) => command === "sign_normalized_library_operations",
      ),
    ).toBe(false);
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "commit_normalized_library_transaction",
      ),
    ).toBe(false);
  });

  it("signs every member of an analysis transaction in one native batch", async () => {
    await commitDesktopLibraryFeedItemAnalysisSets(
      ["rss:analysis-1", "rss:analysis-2", "rss:analysis-3"].map(
        (entityId) => ({
          contentSignals: undefined,
          entityId,
          eventCandidate: undefined,
        }),
      ),
      1_000,
    );

    const signingCalls = mocks.invoke.mock.calls.filter(
      ([command]) => command === "sign_normalized_library_operations",
    );
    expect(signingCalls).toHaveLength(1);
    expect(signingCalls[0]?.[1]).toMatchObject({
      request: {
        actorId: "12".repeat(32),
        operationSigningBodyDigests: [
          expect.stringMatching(/^[0-9a-f]{64}$/),
          expect.stringMatching(/^[0-9a-f]{64}$/),
          expect.stringMatching(/^[0-9a-f]{64}$/),
        ],
      },
    });
  });

  it("clears large sample identity sets in bounded Account-first transactions", async () => {
    await commitDesktopLibrarySampleRemovalPlan(
      {
        feedUrls: [],
        itemIds: [],
        personIds: Array.from({ length: 300 }, (_, index) => `person-${index}`),
        realLinkedAccounts: [],
        sampleAccountIds: Array.from(
          { length: 300 },
          (_, index) => `account-${index}`,
        ),
      },
      1_000,
    );

    const signingBatchSizes = mocks.invoke.mock.calls
      .filter(([command]) => command === "sign_normalized_library_operations")
      .map(
        ([, args]) =>
          (
            args as {
              request: { operationSigningBodyDigests: readonly string[] };
            }
          ).request.operationSigningBodyDigests.length,
      );
    expect(signingBatchSizes).toEqual([256, 44, 256, 44]);

    const committedOperationTypes = mocks.invoke.mock.calls
      .filter(
        ([command]) => command === "commit_normalized_library_transaction",
      )
      .map(([, args]) => {
        const firstEnvelope = (
          args as { request: { canonicalEnvelopeJson: readonly string[] } }
        ).request.canonicalEnvelopeJson[0];
        return JSON.parse(firstEnvelope ?? "null").operation_type;
      });
    expect(committedOperationTypes).toEqual([
      "account_remove",
      "account_remove",
      "person_remove_and_accounts",
      "person_remove_and_accounts",
    ]);
  });
});
