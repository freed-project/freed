import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences, type FeedItem } from "@freed/shared";
import type { DocState } from "./automerge-types";

const mocks = vi.hoisted(() => ({
  appendCalls: [] as string[][],
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => true),
  invoke: mocks.invoke,
}));

vi.mock("./runtime-health-events", () => ({
  recordRuntimeHealthEvent: vi.fn(),
}));

import { importLegacyLibraryIntoSqlite } from "./sqlite-library";

function stateWithItems(itemCount: number): DocState {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    globalId: `rss:item-${index.toLocaleString("en-US", { useGrouping: false })}`,
    platform: "rss",
    contentType: "post",
    publishedAt: index,
    capturedAt: index,
    author: { id: "author", displayName: "Author", handle: "author" },
    sourceUrl: `https://example.com/${index.toLocaleString("en-US", { useGrouping: false })}`,
    content: {
      text: "x".repeat(6_000),
      mediaUrls: [],
      mediaTypes: [],
    },
    topics: [],
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      liked: false,
      tags: [],
    },
  })) as FeedItem[];
  return {
    items,
    searchCorpusVersion: 0,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
    desktopClientIds: [],
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: itemCount,
    unreadCountByPlatform: { rss: itemCount },
    totalItemCount: itemCount,
    itemCountByPlatform: { rss: itemCount },
    totalArchivableCount: 0,
    archivableCountByPlatform: {},
    archivableFeedCounts: {},
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
    docItemCount: itemCount,
  };
}

describe("SQLite legacy import batching", () => {
  beforeEach(() => {
    mocks.appendCalls = [];
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "append_sqlite_library_import") {
        const encoded = (args as { request: { itemsBase64: string[] } }).request
          .itemsBase64;
        const items = encoded.map((item) =>
          new TextDecoder().decode(
            Uint8Array.from(atob(item), (character) => character.charCodeAt(0)),
          ),
        );
        // Model a platform transport that accepts fewer records than the
        // caller's normal bound. The importer must split and continue.
        if (items.length > 64) throw new Error("transport request rejected");
        mocks.appendCalls.push(items);
        return items.length;
      }
      if (command === "read_sqlite_library_shell") {
        return {
          shellJson: "{}",
          revision: 1,
          itemCount: 300,
          unreadCount: 300,
          archivableCount: 0,
          countsByPlatform: { rss: 300 },
          unreadByPlatform: { rss: 300 },
        };
      }
      return undefined;
    });
  });

  it("imports the complete corpus through bounded, splittable requests", async () => {
    const state = stateWithItems(300);
    await importLegacyLibraryIntoSqlite(state, {
      binary: new Uint8Array([1, 2, 3]),
      heads: ["head-1"],
      revision: { generation: 4, saveRevision: 9 },
      itemCount: 300,
      friendCount: 0,
    });

    expect(mocks.appendCalls.flat()).toHaveLength(300);
    expect(mocks.appendCalls.every((batch) => batch.length <= 64)).toBe(true);
    expect(
      mocks.appendCalls.every(
        (batch) =>
          batch.reduce((bytes, item) => bytes + new TextEncoder().encode(item).byteLength, 0) <=
          512 * 1_024,
      ),
    ).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("finalize_sqlite_library_import", {
      activatedAtMs: expect.any(Number),
    });
  });

  it("keeps non-BMP item text intact across the native command envelope", async () => {
    const state = stateWithItems(1);
    state.items[0]!.content.text = "Spain 🇪🇸 and Morocco 🇲🇦 with \\x text";

    await importLegacyLibraryIntoSqlite(state, {
      binary: new Uint8Array([1, 2, 3]),
      heads: ["head-1"],
      revision: { generation: 4, saveRevision: 9 },
      itemCount: 1,
      friendCount: 0,
    });

    expect(JSON.parse(mocks.appendCalls[0]![0]!).content.text).toBe(
      "Spain 🇪🇸 and Morocco 🇲🇦 with \\x text",
    );
  });

  it("preserves a legacy item while repairing isolated surrogate halves", async () => {
    const state = stateWithItems(1);
    state.items[0]!.content.text = "before\ud800after\udc00 🇪🇸";

    await importLegacyLibraryIntoSqlite(state, {
      binary: new Uint8Array([1, 2, 3]),
      heads: ["head-1"],
      revision: { generation: 4, saveRevision: 9 },
      itemCount: 1,
      friendCount: 0,
    });

    expect(JSON.parse(mocks.appendCalls[0]![0]!).content.text).toBe(
      "before�after� 🇪🇸",
    );
  });
});
