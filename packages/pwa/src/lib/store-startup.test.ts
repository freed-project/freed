import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences, type ContentSignalBackfillSummary, type SampleLibraryData } from "@freed/shared";
import type { DocState } from "./automerge-types";

const automerge = vi.hoisted(() => {
  const resolved = () => vi.fn(() => Promise.resolve());
  return {
    initDoc: vi.fn(),
    subscribe: vi.fn(),
    docAddFeedItems: resolved(),
    docAddSampleLibraryData: resolved(),
    docAddRssFeed: resolved(),
    docRemoveRssFeed: resolved(),
    docRemoveAllFeeds: resolved(),
    docUpdateRssFeed: resolved(),
    docUpdateFeedItem: resolved(),
    docBackfillContentSignals: vi.fn(),
    docMarkAsRead: resolved(),
    docMarkItemsAsRead: resolved(),
    docMarkAllAsRead: resolved(),
    docToggleSaved: resolved(),
    docRemoveFeedItem: resolved(),
    docClearSampleData: vi.fn(() => Promise.resolve({ feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 })),
    docToggleArchived: resolved(),
    docToggleLiked: resolved(),
    docArchiveAllReadUnsaved: resolved(),
    docUnarchiveSavedItems: resolved(),
    docDeleteAllArchived: resolved(),
    docPruneArchivedItems: resolved(),
    docUpdatePreferences: resolved(),
    docAddAccount: resolved(),
    docAddAccounts: resolved(),
    docAddPerson: resolved(),
    docAddPersons: resolved(),
    docUpdateAccount: resolved(),
    docUpdatePerson: resolved(),
    docUpsertConnectionPersons: resolved(),
    docRemoveAccount: resolved(),
    docRemovePerson: resolved(),
    docLogReachOut: resolved(),
  };
});

vi.mock("./automerge", () => automerge);

vi.mock("./reader-cache", () => ({
  pinReaderItemInPwa: vi.fn(),
}));

vi.mock("@freed/ui/lib/bug-report", () => ({
  recordBugReportEvent: vi.fn(),
  recordRuntimeError: vi.fn(),
}));

import { useAppStore } from "./store";

function makeDocState(): DocState {
  return {
    items: [],
    searchCorpusVersion: 0,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: 0,
    unreadCountByPlatform: {},
    totalItemCount: 0,
    itemCountByPlatform: {},
    totalArchivableCount: 0,
    archivableCountByPlatform: {},
    archivableFeedCounts: {},
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
  };
}

function makeBackfillSummary(
  updated: number,
  remaining: number,
): ContentSignalBackfillSummary {
  return {
    version: 3,
    total: updated + remaining,
    scanned: updated,
    updated,
    remaining,
    counts: {} as ContentSignalBackfillSummary["counts"],
    multiSignalCount: 0,
    untaggedCount: 0,
    samples: {},
  };
}

describe("PWA store startup maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
    automerge.initDoc.mockResolvedValue(makeDocState());
    automerge.docBackfillContentSignals.mockResolvedValue(makeBackfillSummary(0, 0));
  });

  it("backfills content signals after initialization until no stale items remain", async () => {
    automerge.docBackfillContentSignals
      .mockResolvedValueOnce(makeBackfillSummary(200, 5))
      .mockResolvedValueOnce(makeBackfillSummary(5, 0));

    await useAppStore.getState().initialize();

    await vi.waitFor(() => {
      expect(automerge.docPruneArchivedItems).toHaveBeenCalledWith(30 * 24 * 60 * 60 * 1000);
      expect(automerge.docBackfillContentSignals).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(automerge.docBackfillContentSignals).toHaveBeenCalledTimes(2);
    });
    expect(automerge.docBackfillContentSignals).toHaveBeenNthCalledWith(1, 200);
    expect(automerge.docBackfillContentSignals).toHaveBeenNthCalledWith(2, 200);
  });

  it("does not mutate the local document before cloud sync catches up", async () => {
    localStorage.setItem("freed_cloud_provider", "gdrive");

    await useAppStore.getState().initialize();

    await vi.waitFor(() => {
      expect(automerge.initDoc).toHaveBeenCalledTimes(1);
    });
    expect(automerge.docPruneArchivedItems).not.toHaveBeenCalled();
    expect(automerge.docBackfillContentSignals).not.toHaveBeenCalled();
  });

  it("delegates sample data clearing to the worker", async () => {
    const summary = { feeds: 1, items: 2, persons: 3, accounts: 4, total: 10 };
    automerge.docClearSampleData.mockResolvedValueOnce(summary);

    await expect(useAppStore.getState().clearSampleData()).resolves.toEqual(summary);
    expect(automerge.docClearSampleData).toHaveBeenCalledTimes(1);
  });

  it("delegates sample library data to one worker mutation", async () => {
    const data: SampleLibraryData = {
      feeds: [
        {
          url: "https://sample.freed.wtf/feed.xml",
          title: "Sample Feed",
          enabled: true,
          trackUnread: true,
          lastFetched: 1,
        },
      ],
      items: [],
      friends: [
        {
          id: "friend-1",
          name: "Ada Lovelace",
          relationshipStatus: "friend",
          careLevel: 5,
          bio: "Sample friend",
          tags: ["sample"],
          sources: [
            {
              platform: "instagram",
              authorId: "ada",
              handle: "ada",
              displayName: "Ada Lovelace",
              profileUrl: "https://instagram.com/ada",
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };

    await useAppStore.getState().addSampleLibraryData(data);

    expect(automerge.docAddSampleLibraryData).toHaveBeenCalledTimes(1);
    expect(automerge.docAddRssFeed).not.toHaveBeenCalled();
    expect(automerge.docAddFeedItems).not.toHaveBeenCalled();
    expect(automerge.docAddPersons).not.toHaveBeenCalled();
    expect(automerge.docAddAccounts).not.toHaveBeenCalled();
    expect(automerge.docAddSampleLibraryData).toHaveBeenCalledWith(
      expect.objectContaining({
        feeds: data.feeds,
        items: data.items,
        persons: expect.arrayContaining([expect.objectContaining({ id: "friend-1" })]),
        accounts: expect.arrayContaining([expect.objectContaining({ provider: "instagram" })]),
      }),
    );
  });
});
