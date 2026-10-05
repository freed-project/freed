import { calculatePriority, createDefaultPreferences, type FeedItem } from "@freed/shared";
import type { LibraryCoreRuntimeStateV1 } from "@freed/shared/library-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analysisCandidates: vi.fn(),
  priorityCandidates: vi.fn(),
  commitPriorities: vi.fn(),
  commitAnalysis: vi.fn(),
  dispatch: vi.fn(),
  query: vi.fn(),
  readItems: vi.fn(),
}));

const state = (revision: number): LibraryCoreRuntimeStateV1 => ({
  archivedItemCount: 0,
  archivableCountByPlatform: {},
  enabledRssFeedCount: 0,
  friendPersonCount: 0,
  itemCountByPlatform: {},
  mapAllContentLocationCount: 0,
  mapFriendLocationCount: 0,
  preferences: createDefaultPreferences(),
  rssFeedCount: 0,
  searchCorpusVersion: revision,
  socialAccountCount: 0,
  totalArchivableCount: 0,
  totalItemCount: 1,
  totalUnreadCount: 1,
  unreadCountByPlatform: {},
});

vi.mock("./legacy-library-presence", () => ({
  hasLegacyLibraryData: vi.fn(async () => false),
}));

vi.mock("./library-core-item-detail-runtime", () => ({
  readLibraryCoreAnalysisCandidateBatch: mocks.analysisCandidates,
  readLibraryCorePriorityCandidateBatch: mocks.priorityCandidates,
  scanLibraryCoreBackgroundItems: vi.fn(),
}));

vi.mock("./library-core-normalized-query-client", () => ({
  createDesktopLibraryCoreOperationId: (prefix: string) => `${prefix}:id`,
  queryNormalizedLibrary: mocks.query,
}));

vi.mock("./sqlite-library", () => ({
  commitDesktopLibraryFeedItemAnalysisSets: mocks.commitAnalysis,
  commitDesktopLibraryFeedItemPriorities: mocks.commitPriorities,
  dispatchSqliteMutation: mocks.dispatch,
  ensureFreshNormalizedDesktopLibrary: vi.fn(async () => true),
  loadSqliteLibraryState: vi.fn(async () => state(1)),
  readSqliteItems: mocks.readItems,
  resetNormalizedLibrary: vi.fn(),
}));

import {
  backfillLibraryContentSignals,
  backfillLibraryPriorities,
  initializeDesktopLibraryRuntime,
  markLibraryItemAsRead,
  resetLocalLibrary,
  subscribeDesktopLibraryRuntime,
} from "./library-client";

describe("Desktop Library client canonical invalidations", () => {
  beforeEach(async () => {
    await resetLocalLibrary();
    mocks.dispatch.mockReset();
    mocks.analysisCandidates.mockReset();
    mocks.priorityCandidates.mockReset();
    mocks.commitPriorities.mockReset();
    mocks.commitAnalysis.mockReset();
    mocks.query.mockReset();
    mocks.readItems.mockReset();
  });

  it("commits scoped ranking weights and never commits a failed source read", async () => {
    const item: FeedItem = { author: { displayName: "Ada", handle: "ada", id: "ada" }, capturedAt: 100,
      content: { mediaTypes: [], mediaUrls: [], text: "A bounded ranking candidate" }, contentType: "post",
      globalId: "rank-1", platform: "saved", publishedAt: 100, topics: [],
      userState: { archived: false, hidden: false, saved: false, tags: [] } };
    const weights = { recency: 10, authors: { ada: 95 }, platforms: { saved: 80 }, topics: {} };
    mocks.priorityCandidates.mockResolvedValue({ items: [{ item, careLevel: 5 }], remaining: false, weights,
      source: { generationId: "a".repeat(64), projectionRevision: 1, transitionSequence: 1 } });
    mocks.commitPriorities.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue({ nextCursor: null, queryId: "local_change_feed_v1", rows: [], schemaVersion: 1,
      source: { generationId: "a".repeat(64), projectionRevision: 1, transitionSequence: 0 } });
    const result = await backfillLibraryPriorities(1000, 64, false);
    expect(result).toEqual({ queueWaitMs: expect.any(Number), passStartedAt: 1000, remaining: 0, updated: 1, source: { generationId: "a".repeat(64), projectionRevision: 1, transitionSequence: 1 } });
    expect(mocks.commitPriorities).toHaveBeenCalledWith([{ entityId: "rank-1",
      priorityBasisPoints: calculatePriority(item, weights, 1000, { careLevel: 5 }) * 100 }], 1000);
    mocks.priorityCandidates.mockRejectedValueOnce(new Error("CURSOR_STALE"));
    await expect(backfillLibraryPriorities(1001, 64, false)).rejects.toThrow("CURSOR_STALE");
    expect(mocks.commitPriorities).toHaveBeenCalledOnce();
  });

  it("measures only mutation-queue wait without changing priority ordering", async () => {
    let clock = 0;
    const timer = vi.spyOn(performance, "now").mockImplementation(() => clock);
    let entered!: () => void;
    const firstEntered = new Promise<void>(resolve => { entered = resolve; });
    const source = { generationId: "a".repeat(64), projectionRevision: 1, transitionSequence: 1 };
    mocks.query.mockResolvedValue({ queryId: "optimistic_fields_v1", schemaVersion: 1, source, rows: [] });
    await initializeDesktopLibraryRuntime();
    const batch = { items: [], remaining: false, weights: createDefaultPreferences().weights, source };
    let finish!: (value: typeof batch) => void;
    mocks.priorityCandidates.mockImplementationOnce(() => {
      entered();
      return new Promise(resolve => { finish = resolve; });
    }).mockResolvedValue(batch);
    try {
      const first = backfillLibraryPriorities(1000, 64, false, undefined, true);
      await firstEntered;
      clock = 1000;
      const second = backfillLibraryPriorities(1001, 64, false, undefined, true);
      expect(mocks.priorityCandidates).toHaveBeenCalledOnce();
      clock = 1250;
      finish(batch);
      expect((await first).queueWaitMs).toBe(0);
      expect((await second).queueWaitMs).toBe(250);
      expect(mocks.priorityCandidates.mock.calls.map(call => call[0])).toEqual([1000, 1001]);
      expect(mocks.commitPriorities).not.toHaveBeenCalled();
    } finally { timer.mockRestore(); }
  });

  it("infers one source-fenced SQLite analysis batch and commits it once", async () => {
    const item: FeedItem = {
      author: { displayName: "Ada", handle: "ada", id: "ada" },
      capturedAt: 100,
      content: {
        mediaTypes: [],
        mediaUrls: [],
        text: "Join the community workshop tomorrow at 10am.",
      },
      contentType: "post",
      globalId: "item-1",
      platform: "saved",
      publishedAt: 100,
      topics: [],
      userState: { archived: false, hidden: false, saved: false, tags: [] },
    };
    mocks.analysisCandidates.mockResolvedValue({
      items: [item],
      remaining: true,
      sourceRevision: 1,
    });
    mocks.commitAnalysis.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue({
      nextCursor: null,
      queryId: "local_change_feed_v1",
      rows: [],
      schemaVersion: 1,
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 1,
        transitionSequence: 0,
      },
    });

    const summary = await backfillLibraryContentSignals(100);

    expect(mocks.analysisCandidates).toHaveBeenCalledWith(3, 100);
    expect(mocks.commitAnalysis).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          contentSignals: expect.objectContaining({
            method: "rules",
            version: 3,
          }),
          entityId: "item-1",
        }),
      ],
      expect.any(Number),
    );
    expect(summary).toMatchObject({
      remaining: 1,
      scanned: 1,
      total: 1,
      updated: 1,
      version: 3,
    });
  });

  it("restarts candidate selection once when the SQLite source fence moves", async () => {
    mocks.analysisCandidates
      .mockResolvedValueOnce({
        items: [],
        remaining: false,
        sourceRevision: 0,
      })
      .mockResolvedValueOnce({
        items: [],
        remaining: false,
        sourceRevision: 1,
      });
    mocks.commitAnalysis.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue({
      nextCursor: null,
      queryId: "local_change_feed_v1",
      rows: [],
      schemaVersion: 1,
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 1,
        transitionSequence: 0,
      },
    });

    const summary = await backfillLibraryContentSignals(100);

    expect(mocks.analysisCandidates).toHaveBeenCalledTimes(2);
    expect(mocks.commitAnalysis).toHaveBeenCalledWith([], expect.any(Number));
    expect(summary).toMatchObject({ remaining: 0, scanned: 0, updated: 0 });
  });

  it("publishes a bounded SQLite change-feed page instead of the synthetic mutation row", async () => {
    const changedItem = { globalId: "item-1" } as FeedItem;
    let optimisticReadCount = 0;
    mocks.dispatch.mockResolvedValue({
      state: state(2),
      event: {
        source: "item_patch",
        mutation: "MARK_AS_READ",
        changedItemIds: ["synthetic-item"],
        changedItems: [{ globalId: "synthetic-item" }],
        requiresFullScan: false,
      },
    });
    mocks.query.mockImplementation(async (request: { queryId: string }) => {
      if (request.queryId === "optimistic_fields_v1") {
        optimisticReadCount += 1;
        return {
          queryId: "optimistic_fields_v1",
          rows: [],
          schemaVersion: 1,
          source: {
            generationId: "a".repeat(64),
            projectionRevision: optimisticReadCount === 1 ? 1 : 2,
            transitionSequence: 0,
          },
        };
      }
      if (request.queryId === "library_facet_summary_v1") {
        return {
          source: {
            generationId: "a".repeat(64),
            projectionRevision: 2,
            transitionSequence: 2,
          },
        };
      }
      if (request.queryId === "local_change_feed_v1") {
        return {
          nextCursor: null,
          queryId: "local_change_feed_v1",
          rows: [],
          schemaVersion: 1,
          source: {
            generationId: "a".repeat(64),
            projectionRevision: 2,
            transitionSequence: 0,
          },
        };
      }
      return {
        nextCursor: null,
        queryId: "change_feed_v1",
        rows: [
          {
            entityId: "item-1",
            ordinal: 0,
            resetRequired: false,
            revision: 2,
            topic: "feed_item",
          },
        ],
        schemaVersion: 1,
        source: {
          generationId: "a".repeat(64),
          projectionRevision: 2,
          transitionSequence: 2,
        },
      };
    });
    mocks.readItems.mockResolvedValue([changedItem]);
    await initializeDesktopLibraryRuntime();
    const events: unknown[] = [];
    const unsubscribe = subscribeDesktopLibraryRuntime((_runtime, event) => {
      events.push(event);
    });

    await markLibraryItemAsRead("item-1");
    unsubscribe();

    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        afterRevision: 1,
        cursor: null,
        limit: 512,
        queryId: "change_feed_v1",
      }),
    );
    expect(mocks.readItems).toHaveBeenCalledWith(["item-1"]);
    expect(events).toEqual([
      {
        source: "item_patch",
        mutation: "MARK_AS_READ",
        changedItemIds: ["item-1"],
        changedItems: [changedItem],
        requiresFullScan: false,
      },
    ]);
  });

  it("publishes device-local follower invalidations without a canonical revision", async () => {
    const changedItem = { globalId: "item-local" } as FeedItem;
    let optimisticReadCount = 0;
    mocks.dispatch.mockResolvedValue({
      state: state(1),
      event: {
        source: "item_patch",
        mutation: "MARK_AS_READ",
        changedItemIds: ["synthetic-item"],
        changedItems: [{ globalId: "synthetic-item" }],
        requiresFullScan: false,
      },
    });
    mocks.query.mockImplementation(async (request: { queryId: string }) => {
      if (request.queryId === "optimistic_fields_v1") {
        optimisticReadCount += 1;
        return {
          queryId: request.queryId,
          rows: [],
          schemaVersion: 1,
          source: {
            generationId: "a".repeat(64),
            projectionRevision: 1,
            transitionSequence: optimisticReadCount === 1 ? 0 : 1,
          },
        };
      }
      if (request.queryId === "local_change_feed_v1") {
        return {
          nextCursor: null,
          queryId: request.queryId,
          rows: [
            {
              entityId: "item-local",
              ordinal: 0,
              resetRequired: false,
              revision: 1,
              topic: "feed_item",
            },
          ],
          schemaVersion: 1,
          source: {
            generationId: "a".repeat(64),
            projectionRevision: 1,
            transitionSequence: 1,
          },
        };
      }
      throw new Error(`Unexpected query ${request.queryId}`);
    });
    mocks.readItems.mockResolvedValue([changedItem]);
    await initializeDesktopLibraryRuntime();
    const events: unknown[] = [];
    const unsubscribe = subscribeDesktopLibraryRuntime((_runtime, event) => {
      events.push(event);
    });

    await markLibraryItemAsRead("item-local");
    unsubscribe();

    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        afterRevision: 0,
        cursor: null,
        queryId: "local_change_feed_v1",
      }),
    );
    expect(mocks.query).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryId: "change_feed_v1" }),
    );
    expect(events).toEqual([
      {
        source: "item_patch",
        mutation: "MARK_AS_READ",
        changedItemIds: ["item-local"],
        changedItems: [changedItem],
        requiresFullScan: false,
      },
    ]);
  });
});
