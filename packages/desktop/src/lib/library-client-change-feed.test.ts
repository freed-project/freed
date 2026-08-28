import { createDefaultPreferences, type FeedItem } from "@freed/shared";
import type { LibraryCoreRuntimeStateV1 } from "@freed/shared/library-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
  scanLibraryCoreBackgroundItems: vi.fn(),
}));

vi.mock("./library-core-normalized-query-client", () => ({
  createDesktopLibraryCoreOperationId: (prefix: string) => `${prefix}:id`,
  queryNormalizedLibrary: mocks.query,
}));

vi.mock("./sqlite-library", () => ({
  dispatchSqliteMutation: mocks.dispatch,
  ensureFreshNormalizedDesktopLibrary: vi.fn(async () => true),
  loadSqliteLibraryState: vi.fn(async () => state(1)),
  readSqliteItems: mocks.readItems,
  resetNormalizedLibrary: vi.fn(),
}));

import {
  initializeDesktopLibraryRuntime,
  markLibraryItemAsRead,
  resetLocalLibrary,
  subscribeDesktopLibraryRuntime,
} from "./library-client";

describe("Desktop Library client canonical invalidations", () => {
  beforeEach(async () => {
    await resetLocalLibrary();
    mocks.dispatch.mockReset();
    mocks.query.mockReset();
    mocks.readItems.mockReset();
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
