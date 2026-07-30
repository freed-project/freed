import {
  createDefaultPreferences,
  type FeedItem,
} from "@freed/shared";
import { describe, expect, it } from "vitest";

import type {
  DocState,
  LibraryCoreProjectionSourceV1,
} from "./automerge-types";
import {
  createHydratedLibraryCoreFeedBrowseProjectionClient,
} from "./library-core-feed-browse-hydrated-client";

function item(globalId: string, text = globalId): FeedItem {
  return {
    globalId,
    platform: "saved",
    contentType: "article",
    capturedAt: 1_000,
    publishedAt: 1_000,
    author: {
      id: "author",
      handle: "author",
      displayName: "Author",
    },
    content: {
      text,
      mediaUrls: [],
      mediaTypes: [],
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
  };
}

function state(
  items: FeedItem[],
  feedSourceOrderIds = items.map((entry) => entry.globalId),
): DocState {
  return {
    items,
    feedSourceOrderIds,
    preferences: createDefaultPreferences(),
    persons: {},
    accounts: {},
    docItemCount: feedSourceOrderIds.length,
  } as DocState;
}

const source: LibraryCoreProjectionSourceV1 = {
  schemaVersion: 1,
  documentId: "library",
  headsDigest: "a".repeat(64),
  headCount: 1,
  storageRevision: {
    generation: 2,
    saveRevision: 3,
  },
};

describe("hydrated Library Core browse projection client", () => {
  it("streams bounded pages while preserving the CRDT source tie-break", async () => {
    const captured = state(
      [item("saved:second"), item("saved:first")],
      ["saved:first", "saved:second"],
    );
    const client = createHydratedLibraryCoreFeedBrowseProjectionClient({
      getSource: async () => source,
      getState: () => captured,
    });
    const started = await client.begin("session", {}, 1_000);
    const batch = await client.nextBatch("session", 0);

    expect(started.binding.totalRows).toBe(2);
    expect(batch.done).toBe(true);
    expect(batch.rows.map((row) => [row.globalId, row.sourceSequence])).toEqual([
      ["saved:second", 1],
      ["saved:first", 0],
    ]);
  });

  it("caps every transfer at 128 rows", async () => {
    const items = Array.from({ length: 129 }, (_, index) =>
      item(`saved:${index.toLocaleString("en-US", {
        minimumIntegerDigits: 3,
        useGrouping: false,
      })}`),
    );
    const captured = state(items);
    const client = createHydratedLibraryCoreFeedBrowseProjectionClient({
      getSource: async () => source,
      getState: () => captured,
    });
    await client.begin("session", {}, 1_000);

    const first = await client.nextBatch("session", 0);
    const second = await client.nextBatch("session", 1);
    expect(first.rows).toHaveLength(128);
    expect(first.done).toBe(false);
    expect(second.rows).toHaveLength(1);
    expect(second.done).toBe(true);
  });

  it("fails closed when hydrated state moves during projection", async () => {
    const captured = state([item("saved:first")]);
    let current = captured;
    const client = createHydratedLibraryCoreFeedBrowseProjectionClient({
      getSource: async () => source,
      getState: () => current,
    });
    await client.begin("session", {}, 1_000);
    current = { ...captured };

    await expect(client.nextBatch("session", 0)).rejects.toThrow(
      "source changed",
    );
  });

  it("fails closed when hydrated state moves while source identity loads", async () => {
    const captured = state([item("saved:first")]);
    let current = captured;
    const client = createHydratedLibraryCoreFeedBrowseProjectionClient({
      getSource: async () => {
        current = { ...captured };
        return source;
      },
      getState: () => current,
    });

    await expect(client.begin("session", {}, 1_000)).rejects.toThrow(
      "source changed",
    );
  });
});
