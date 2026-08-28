import { describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  bootstrap: vi.fn(),
}));

vi.mock("./library-core-desktop-role", () => ({
  readLibraryCoreDesktopRole: () => "primary",
}));

vi.mock("./library-core-cloud-sync", () => ({
  readPersistedSqliteLibraryCloudIdentity: vi.fn(async () => {
    mocks.calls.push("cloud-identity");
    return null;
  }),
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
    readSqliteLibrarySyncDescriptor: vi.fn(async () => {
      mocks.calls.push("descriptor");
      return {
        revision: 4,
        itemCount: 0,
        sourceDigest: "ab".repeat(32),
        shellJson: "{}",
        materializedDigest: "cd".repeat(32),
      };
    }),
    bootstrapSqliteLibraryAuthority: mocks.bootstrap.mockImplementation(
      async () => {
        mocks.calls.push("bootstrap");
      },
    ),
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

describe("local-only primary startup authority", () => {
  it("establishes explicit authority before exposing Library state", async () => {
    await initDoc();

    expect(mocks.calls).toEqual([
      "descriptor",
      "cloud-identity",
      "bootstrap",
      "load",
    ]);
    expect(mocks.bootstrap).toHaveBeenCalledWith({
      descriptor: {
        revision: 4,
        itemCount: 0,
        sourceDigest: "ab".repeat(32),
        shellJson: "{}",
        materializedDigest: "cd".repeat(32),
      },
      persistedCloudIdentity: null,
    });
  });
});
