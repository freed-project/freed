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
  subscribeDesktopLibraryRuntime,
} from "./library-client";

describe("Desktop Library client canonical invalidations", () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.query.mockReset();
    mocks.readItems.mockReset();
  });

  it("publishes a bounded SQLite change-feed page instead of the synthetic mutation row", async () => {
    const changedItem = { globalId: "item-1" } as FeedItem;
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
    mocks.query.mockResolvedValue({
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
});
