import { describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
}));

vi.mock("./library-core-desktop-role", () => ({
  readLibraryCoreDesktopRole: () => "follower",
}));

vi.mock("./sqlite-library", async (importOriginal) => {
  const original = await importOriginal<typeof import("./sqlite-library")>();
  return {
    ...original,
    sqliteLibraryStatus: vi.fn(async () => ({
      active: true,
      revision: 4,
      expectedItemCount: 0,
      importedItemCount: 0,
      sourceGeneration: 2,
      sourceRevision: 3,
      sourceDigest: "ab".repeat(32),
    })),
    recoverSqliteLibraryFollowerOverlay: vi.fn(async () => {
      mocks.calls.push("recover");
      return {
        transactionCount: 1,
        operationCount: 1,
        materializedRowCount: 1,
        revisionAdvanced: true,
      };
    }),
    loadSqliteLibraryState: vi.fn(async () => {
      mocks.calls.push("load");
      return {
        items: [],
        searchCorpusVersion: 5,
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
        docItemCount: 0,
      };
    }),
  };
});

import { initDoc } from "./library-client";

describe("editable follower startup recovery", () => {
  it("replays durable local edits before exposing the active checkpoint", async () => {
    await initDoc();

    expect(mocks.calls).toEqual(["recover", "load"]);
  });
});
