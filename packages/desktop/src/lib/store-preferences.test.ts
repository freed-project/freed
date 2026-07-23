import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";
import {
  DEVICE_AI_PREFERENCES_STORAGE_KEY,
  resetDeviceAIPreferencesForTests,
} from "@freed/ui/lib/device-ai-preferences";
import {
  DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY,
  resetDeviceDisplayPreferencesForTests,
} from "@freed/ui/lib/device-display-preferences";

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
  quiesceDesktopAutomergeForFactoryReset: vi.fn(() => Promise.resolve()),
  subscribe: vi.fn(() => () => {}),
  getDocState: vi.fn(() => null),
  docAddFeedItems: vi.fn(),
  docAddSampleLibraryData: vi.fn(),
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
  docClearSampleData: vi.fn(() => Promise.resolve({ feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 })),
  docToggleArchived: vi.fn(),
  docArchiveAllReadUnsaved: vi.fn(),
  docUnarchiveSavedItems: vi.fn(),
  docDeleteAllArchived: vi.fn(),
  docPruneArchivedItems: vi.fn(),
  docUpdatePreferences: mockDocUpdatePreferences,
  docBackfillContentSignals: vi.fn(() => Promise.resolve({ updated: 0, remaining: 0 })),
  docDeduplicateFeedItems: vi.fn(),
  docHealUntitledFeedTitles: vi.fn(),
  docAddFriend: vi.fn(),
  docAddFriends: vi.fn(),
  docUpdateFriend: vi.fn(),
  docRemoveFriend: vi.fn(),
  docUpsertConnectionPersons: vi.fn(),
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
    window.localStorage.clear();
    resetDeviceDisplayPreferencesForTests();
    resetDeviceAIPreferencesForTests();
    mockDocUpdatePreferences.mockReset();
    mockRecordRuntimeError.mockReset();
    mockRecordBugReportEvent.mockReset();
    useAppStore.setState({ preferences: createDefaultPreferences() });
  });

  it("does not send device-local display preferences to Automerge", async () => {
    await useAppStore.getState().updatePreferences({
      display: {
        reading: {
          dualColumnMode: false,
        },
      },
    } as never);

    expect(useAppStore.getState().preferences.display.reading.dualColumnMode).toBeUndefined();
    expect(mockDocUpdatePreferences).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem("freed-device-display-preferences-v1") ?? "null"))
      .toMatchObject({ values: { dualColumnMode: false } });
  });

  it("rejects device-local preference writes when a newer record owns the key", async () => {
    const futureDisplay = JSON.stringify({ version: 2, values: { sidebarMode: "closed" } });
    window.localStorage.setItem(DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY, futureDisplay);
    resetDeviceDisplayPreferencesForTests();

    await expect(useAppStore.getState().updatePreferences({
      display: { sidebarMode: "compact" },
    } as never)).rejects.toThrow("could not save the display settings");

    expect(mockDocUpdatePreferences).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY)).toBe(futureDisplay);

    window.localStorage.removeItem(DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY);
    const futureAI = JSON.stringify({ version: 2, values: { provider: "future" } });
    window.localStorage.setItem(DEVICE_AI_PREFERENCES_STORAGE_KEY, futureAI);
    resetDeviceAIPreferencesForTests();

    await expect(useAppStore.getState().updatePreferences({
      ai: { provider: "integrated" },
    } as never)).rejects.toThrow("could not save the AI settings");

    expect(mockDocUpdatePreferences).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DEVICE_AI_PREFERENCES_STORAGE_KEY)).toBe(futureAI);
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
    expect(mockDocUpdatePreferences).toHaveBeenCalledWith({
      display: { animationIntensity: "none" },
    });
  });

  it("opens the full map for a person in one state transition", () => {
    useAppStore.setState({
      activeView: "friends",
      selectedPersonId: null,
      selectedAccountId: "account-ada",
      selectedFriendId: null,
      selectedItemId: "ig:ada:paris",
    });

    useAppStore.getState().openMapForPerson("friend-ada");

    expect(useAppStore.getState()).toMatchObject({
      activeView: "map",
      selectedPersonId: "friend-ada",
      selectedAccountId: null,
      selectedFriendId: "friend-ada",
      selectedItemId: null,
    });
  });

  it("records non-fatal diagnostics when persistence rejects", async () => {
    const error = new Error("[automerge-worker] request TIMEOUT op=UPDATE_PREFERENCES reqId=126");
    mockDocUpdatePreferences.mockRejectedValueOnce(error);

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

  it("ignores legacy map display updates", async () => {
    await expect(
      useAppStore.getState().updatePreferences({
        display: { mapMode: "all_content" },
      } as never),
    ).resolves.toBeUndefined();

    expect(mockDocUpdatePreferences).not.toHaveBeenCalled();
  });

  it("ignores legacy map time updates", async () => {
    await expect(
      useAppStore.getState().updatePreferences({
        display: { mapTimeMode: "future" },
      } as never),
    ).resolves.toBeUndefined();

    expect(mockDocUpdatePreferences).not.toHaveBeenCalled();
  });

  it("replaces Facebook exclusions without synchronizing local group discovery", async () => {
    useAppStore.setState((state) => ({
      preferences: {
        ...state.preferences,
        fbCapture: {
          knownGroups: {
            one: {
              id: "one",
              name: "One",
              url: "https://facebook.com/groups/one",
            },
          },
          excludedGroupIds: {
            one: true,
          },
        },
      },
    }));

    let resolvePersistence: (() => void) | undefined;
    mockDocUpdatePreferences.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolvePersistence = resolve;
      }),
    );

    const updatePromise = useAppStore.getState().updatePreferences({
      fbCapture: {
        knownGroups: {
          one: {
            id: "one",
            name: "One",
            url: "https://facebook.com/groups/one",
          },
        },
        excludedGroupIds: {},
      },
    } as never);

    expect(useAppStore.getState().preferences.fbCapture.excludedGroupIds).toEqual({});
    expect(useAppStore.getState().preferences.fbCapture.knownGroups).toEqual({
      one: {
        id: "one",
        name: "One",
        url: "https://facebook.com/groups/one",
      },
    });
    expect(mockDocUpdatePreferences).toHaveBeenCalledWith({
      fbCapture: {
        excludedGroupIds: {},
      },
    });

    resolvePersistence?.();
    await expect(updatePromise).resolves.toBeUndefined();
  });
});
