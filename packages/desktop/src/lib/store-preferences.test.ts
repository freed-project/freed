import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDocUpdatePreferences,
  mockRecordRuntimeError,
  mockRecordBugReportEvent,
} = vi.hoisted(() => ({
  mockDocUpdatePreferences: vi.fn(),
  mockRecordRuntimeError: vi.fn(),
  mockRecordBugReportEvent: vi.fn(),
}));

vi.mock("./automerge", () => ({
  initDoc: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  getDocState: vi.fn(() => null),
  docAddFeedItems: vi.fn(),
  docAddRssFeed: vi.fn(),
  docRemoveRssFeed: vi.fn(),
  docRemoveAllFeeds: vi.fn(),
  docUpdateRssFeed: vi.fn(),
  docUpdateFeedItem: vi.fn(),
  docMarkAsRead: vi.fn(),
  docMarkItemsAsRead: vi.fn(),
  docMarkAllAsRead: vi.fn(),
  docToggleSaved: vi.fn(),
  docRemoveFeedItem: vi.fn(),
  docToggleArchived: vi.fn(),
  docArchiveAllReadUnsaved: vi.fn(),
  docUnarchiveSavedItems: vi.fn(),
  docDeleteAllArchived: vi.fn(),
  docPruneArchivedItems: vi.fn(),
  docUpdatePreferences: mockDocUpdatePreferences,
  docDeduplicateFeedItems: vi.fn(),
  docHealUntitledFeedTitles: vi.fn(),
  docAddFriend: vi.fn(),
  docAddFriends: vi.fn(),
  docUpdateFriend: vi.fn(),
  docRemoveFriend: vi.fn(),
  docLogReachOut: vi.fn(),
  docToggleLiked: vi.fn(),
  docConfirmLikedSynced: vi.fn(),
  docConfirmSeenSynced: vi.fn(),
}));

vi.mock("@freed/ui/lib/bug-report", async () => {
  const actual = await vi.importActual<typeof import("@freed/ui/lib/bug-report")>("@freed/ui/lib/bug-report");
  return {
    ...actual,
    recordRuntimeError: mockRecordRuntimeError,
    recordBugReportEvent: mockRecordBugReportEvent,
  };
});

import { useAppStore } from "./store";

describe("store.updatePreferences", () => {
  beforeEach(() => {
    mockDocUpdatePreferences.mockReset();
    mockRecordRuntimeError.mockReset();
    mockRecordBugReportEvent.mockReset();
  });

  it("records non-fatal diagnostics when persistence rejects", async () => {
    const error = new Error("[automerge-worker] request TIMEOUT op=UPDATE_PREFERENCES reqId=126");
    mockDocUpdatePreferences.mockRejectedValueOnce(error);

    await expect(
      useAppStore.getState().updatePreferences({
        display: { sidebarWidth: 320 },
      } as never),
    ).resolves.toBeUndefined();

    expect(mockRecordRuntimeError).toHaveBeenCalledWith({
      source: "desktop:updatePreferences",
      error,
      fatal: false,
    });
    expect(mockRecordBugReportEvent).toHaveBeenCalledWith(
      "desktop:updatePreferences",
      "error",
      "Preference update failed",
      error.message,
    );
  });
});
