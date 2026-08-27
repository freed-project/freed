import { createDefaultPreferences } from "@freed/shared";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
}));

vi.mock("./legacy-library-presence", () => ({
  hasLegacyLibraryData: vi.fn(async () => false),
  shouldBlockForLegacyLibrary: vi.fn(() => false),
}));

vi.mock("./library-core-desktop-role", () => ({
  readLibraryCoreDesktopRole: () => "primary",
}));

vi.mock("./library-core-cloud-sync", () => ({
  readPersistedSqliteLibraryCloudIdentity: vi.fn(async () => {
    throw new Error("fresh normalized startup must not read legacy authority hints");
  }),
}));

vi.mock("./sqlite-library", async (importOriginal) => {
  const original = await importOriginal<typeof import("./sqlite-library")>();
  return {
    ...original,
    ensureFreshNormalizedDesktopLibrary: vi.fn(async (historicalDataAbsent: boolean) => {
      mocks.calls.push(`select:${String(historicalDataAbsent)}`);
      return historicalDataAbsent;
    }),
    loadSqliteLibraryState: vi.fn(async () => {
      mocks.calls.push("load");
      return {
        items: [],
        searchCorpusVersion: 0,
        feeds: {},
        persons: {},
        accounts: {},
        friends: {},
        preferences: createDefaultPreferences(),
        desktopClientIds: [],
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
    }),
  };
});

import { initializeDesktopLibraryRuntime } from "./library-client";

describe("fresh normalized Desktop startup", () => {
  it("selects native SQLite without creating or bootstrapping a historical Library", async () => {
    await initializeDesktopLibraryRuntime();

    expect(mocks.calls).toEqual(["select:false", "select:true", "load"]);
  });
});
