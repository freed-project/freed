import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";

const {
  mockUpdateLibraryPreferences,
  mockRecordRuntimeError,
  mockRecordBugReportEvent,
} = vi.hoisted(() => ({
  mockUpdateLibraryPreferences: vi.fn(),
  mockRecordRuntimeError: vi.fn(),
  mockRecordBugReportEvent: vi.fn(),
}));

vi.mock("./library-client", () => ({
  initializeDesktopLibraryRuntime: vi.fn(),
  quiesceDesktopLibraryForFactoryReset: vi.fn(() => Promise.resolve()),
  subscribeDesktopLibraryRuntime: vi.fn(() => () => {}),
  getDesktopLibraryRuntimeState: vi.fn(() => null),
  addLibraryFeedItems: vi.fn(),
  addSampleLibraryData: vi.fn(),
  addLibraryRssFeed: vi.fn(),
  removeLibraryRssFeed: vi.fn(),
  removeAllLibraryFeeds: vi.fn(),
  updateLibraryRssFeed: vi.fn(),
  updateLibraryFeedItem: vi.fn(),
  markLibraryItemAsRead: vi.fn(),
  markLibraryItemsAsRead: vi.fn(),
  markAllLibraryItemsAsRead: vi.fn(),
  toggleLibraryItemSaved: vi.fn(),
  removeLibraryFeedItem: vi.fn(),
  clearSampleLibraryData: vi.fn(() => Promise.resolve({ feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 })),
  toggleLibraryItemArchived: vi.fn(),
  archiveAllReadUnsavedLibraryItems: vi.fn(),
  unarchiveSavedLibraryItems: vi.fn(),
  deleteAllArchivedLibraryItems: vi.fn(),
  pruneArchivedLibraryItems: vi.fn(),
  updateLibraryPreferences: mockUpdateLibraryPreferences,
  backfillLibraryContentSignals: vi.fn(() => Promise.resolve({ updated: 0, remaining: 0 })),
  healUntitledLibraryFeedTitles: vi.fn(),
  toggleLibraryItemLiked: vi.fn(),
  confirmLibraryItemLikedSynced: vi.fn(),
  confirmLibraryItemSeenSynced: vi.fn(),
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
    window.localStorage.clear();
    mockUpdateLibraryPreferences.mockReset();
    mockRecordRuntimeError.mockReset();
    mockRecordBugReportEvent.mockReset();
    useAppStore.setState({ preferences: createDefaultPreferences() });
  });

  it("rejects installation-local fields at the synchronized mutation boundary", async () => {
    await expect(useAppStore.getState().updatePreferences({
      display: {
        reading: {
          dualColumnMode: false,
        },
      },
    } as never)).rejects.toThrow("unsupported fields");

    expect(mockUpdateLibraryPreferences).not.toHaveBeenCalled();
    await expect(useAppStore.getState().updatePreferences({
      display: { sidebarMode: "compact" },
    } as never)).rejects.toThrow("unsupported fields");
    await expect(useAppStore.getState().updatePreferences({
      ai: { provider: "integrated" },
    } as never)).rejects.toThrow("unsupported fields");

    expect(mockUpdateLibraryPreferences).not.toHaveBeenCalled();
  });

  it("defaults animations to detailed", () => {
    expect(useAppStore.getState().preferences.display.animationIntensity).toBe("detailed");
  });

  it("persists animation preference updates", async () => {
    await expect(
      useAppStore.getState().updatePreferences({
        display: { animationIntensity: "none" },
      } as never),
    ).resolves.toBeUndefined();

    expect(useAppStore.getState().preferences.display.animationIntensity).toBe("none");
    expect(mockUpdateLibraryPreferences).toHaveBeenCalledWith({
      display: { animationIntensity: "none" },
    });
  });

  it("opens the full map for a person in one state transition", () => {
    useAppStore.setState({
      activeView: "friends",
      selectedPersonId: null,
      selectedAccountId: "account-ada",
      selectedItemId: "ig:ada:paris",
    });

    useAppStore.getState().openMapForPerson("friend-ada");

    expect(useAppStore.getState()).toMatchObject({
      activeView: "map",
      selectedPersonId: "friend-ada",
      selectedAccountId: null,
      selectedItemId: null,
    });
  });

  it("records non-fatal diagnostics when persistence rejects", async () => {
    const error = new Error("[library-core] request TIMEOUT op=UPDATE_PREFERENCES reqId=126");
    mockUpdateLibraryPreferences.mockRejectedValueOnce(error);

    await expect(
      useAppStore.getState().updatePreferences({
        display: { showEngagementCounts: true },
      } as never),
    ).rejects.toBe(error);

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
    expect(useAppStore.getState().preferences.display.showEngagementCounts).toBe(false);
  });

  it("rejects historical map display updates", async () => {
    await expect(
      useAppStore.getState().updatePreferences({
        display: { mapMode: "all_content" },
      } as never),
    ).rejects.toThrow("unsupported fields");

    expect(mockUpdateLibraryPreferences).not.toHaveBeenCalled();
  });

  it("rejects historical map time updates", async () => {
    await expect(
      useAppStore.getState().updatePreferences({
        display: { mapTimeMode: "future" },
      } as never),
    ).rejects.toThrow("unsupported fields");

    expect(mockUpdateLibraryPreferences).not.toHaveBeenCalled();
  });

  it("updates Facebook exclusions only through the final synchronized shape", async () => {
    useAppStore.setState((state) => ({
      preferences: {
        ...state.preferences,
        fbCapture: {
          excludedGroupIds: {
            one: true,
          },
        },
      },
    }));

    await expect(useAppStore.getState().updatePreferences({
      fbCapture: {
        knownGroups: {
          one: {
            id: "one",
            name: "One",
            url: "https://facebook.com/groups/one",
          },
        },
      },
    } as never)).rejects.toThrow("unsupported fields");

    let resolvePersistence: (() => void) | undefined;
    mockUpdateLibraryPreferences.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolvePersistence = resolve;
      }),
    );

    const updatePromise = useAppStore.getState().updatePreferences({
      fbCapture: {
        excludedGroupIds: {},
      },
    } as never);

    expect(useAppStore.getState().preferences.fbCapture.excludedGroupIds).toEqual({});
    expect(mockUpdateLibraryPreferences).toHaveBeenCalledWith({
      fbCapture: {
        excludedGroupIds: {},
      },
    });

    resolvePersistence?.();
    await expect(updatePromise).resolves.toBeUndefined();
  });
});
