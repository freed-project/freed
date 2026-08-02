import { createDefaultPreferences, type FeedItem } from "@freed/shared";
import { describe, expect, it } from "vitest";

import type {
  DocState,
  LibraryCoreProjectionSourceV1,
} from "./automerge-types";
import {
  createHydratedLibraryCoreFeedBrowseProjectionClient,
  createScannedLibraryCoreFeedBrowseProjectionClient,
} from "./library-core-feed-browse-hydrated-client";
import type { LibraryCoreItemScanSession } from "./library-core-item-detail-runtime";

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
    expect(batch.rows.map((row) => [row.globalId, row.sourceSequence])).toEqual(
      [
        ["saved:second", 1],
        ["saved:first", 0],
      ],
    );
  });

  it("caps every transfer at 128 rows", async () => {
    const items = Array.from({ length: 129 }, (_, index) =>
      item(
        `saved:${index.toLocaleString("en-US", {
          minimumIntegerDigits: 3,
          useGrouping: false,
        })}`,
      ),
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

describe("scanned Library Core browse projection client", () => {
  it("counts and emits one bounded source page per transfer without reading renderer items", async () => {
    const scannedItems = Array.from({ length: 129 }, (_, index) =>
      item(
        `saved:${index.toLocaleString("en-US", {
          minimumIntegerDigits: 3,
          useGrouping: false,
        })}`,
      ),
    );
    const captured = state(
      [],
      scannedItems.map((entry) => entry.globalId),
    );
    const pages = [
      scannedItems.slice(0, 64),
      scannedItems.slice(64, 128),
      scannedItems.slice(128),
    ];
    let openedScans = 0;
    const openScan = async (): Promise<LibraryCoreItemScanSession> => {
      openedScans += 1;
      let pageIndex = 0;
      return {
        async nextPage() {
          const items = pages[pageIndex] ?? [];
          pageIndex += 1;
          return { items, done: pageIndex >= pages.length };
        },
        async close() {},
      };
    };
    const client = createScannedLibraryCoreFeedBrowseProjectionClient({
      getSource: async () => source,
      getState: () => captured,
      openScan,
    });

    const started = await client.begin("session", {}, 1_000);
    const first = await client.nextBatch("session", 0);
    const second = await client.nextBatch("session", 1);
    const third = await client.nextBatch("session", 2);

    expect(started.binding.totalRows).toBe(129);
    expect(openedScans).toBe(2);
    expect(first.rows).toHaveLength(64);
    expect(first.done).toBe(false);
    expect(second.rows).toHaveLength(64);
    expect(second.done).toBe(false);
    expect(third.rows).toHaveLength(1);
    expect(third.done).toBe(true);
    expect(
      [...first.rows, ...second.rows, ...third.rows].map(
        (entry) => entry.globalId,
      ),
    ).toEqual(scannedItems.map((entry) => entry.globalId));
  });

  it("applies one compiled inclusion predicate in both scan passes without renumbering source order", async () => {
    const scannedItems = [
      item("saved:friend"),
      item("saved:other"),
      item("saved:friend-two"),
    ];
    const captured = state([], [
      "saved:other",
      "saved:friend-two",
      "saved:friend",
    ]);
    let predicateBuilds = 0;
    let openedScans = 0;
    const openScan = async (): Promise<LibraryCoreItemScanSession> => {
      openedScans += 1;
      let done = false;
      return {
        async nextPage() {
          if (done) return { items: [], done: true };
          done = true;
          return { items: scannedItems, done: true };
        },
        async close() {},
      };
    };
    const client = createScannedLibraryCoreFeedBrowseProjectionClient({
      getSource: async () => source,
      getState: () => captured,
      openScan,
      strategy: {
        generationDomain: "friends-test-generation-v1",
        bindingFilterJson: (filter) =>
          JSON.stringify({ filter, identityMode: "friends" }),
        createItemPredicate: () => {
          predicateBuilds += 1;
          return (entry) => entry.globalId.startsWith("saved:friend");
        },
      },
    });

    const started = await client.begin("friends-session", {}, 1_000);
    const batch = await client.nextBatch("friends-session", 0);

    expect(predicateBuilds).toBe(1);
    expect(openedScans).toBe(2);
    expect(started.binding.totalRows).toBe(2);
    expect(JSON.parse(started.binding.filterJson)).toEqual({
      filter: started.filter,
      identityMode: "friends",
    });
    expect(batch.done).toBe(true);
    expect(batch.rows.map((row) => [row.globalId, row.sourceSequence])).toEqual([
      ["saved:friend", 2],
      ["saved:friend-two", 1],
    ]);
  });

  it("rescans source order per emitted page without retaining a corpus-sized sequence map", async () => {
    const corpusSize = 1_024;
    const sourceIds = Array.from(
      { length: corpusSize },
      (_, index) => `saved:source:${index}`,
    );
    let sourceIdReads = 0;
    const observedSourceIds = new Proxy(sourceIds, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          sourceIdReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const pages = [
      [item(sourceIds[corpusSize - 1])],
      [item(sourceIds[7])],
    ];
    const captured = state([], observedSourceIds);
    const openScan = async (): Promise<LibraryCoreItemScanSession> => {
      let pageIndex = 0;
      return {
        async nextPage() {
          const items = pages[pageIndex] ?? [];
          pageIndex += 1;
          return { items, done: pageIndex >= pages.length };
        },
        async close() {},
      };
    };
    const client = createScannedLibraryCoreFeedBrowseProjectionClient({
      getSource: async () => source,
      getState: () => captured,
      openScan,
    });

    await client.begin("bounded-sequence-session", {}, 1_000);
    expect(sourceIdReads).toBe(0);

    const first = await client.nextBatch("bounded-sequence-session", 0);
    expect(sourceIdReads).toBe(corpusSize);
    expect(first.rows.map((row) => [row.globalId, row.sourceSequence])).toEqual([
      [sourceIds[corpusSize - 1], corpusSize - 1],
    ]);

    const second = await client.nextBatch("bounded-sequence-session", 1);
    expect(sourceIdReads).toBe(corpusSize * 2);
    expect(
      second.rows.map((row) => [row.globalId, row.sourceSequence]),
    ).toEqual([[sourceIds[7], 7]]);
    expect(second.done).toBe(true);
  });

  it("never combines partially matching scan pages past the writer ceiling", async () => {
    const pages = Array.from({ length: 3 }, (_, pageIndex) =>
      Array.from({ length: 64 }, (_, rowIndex) => {
        const entry = item(`saved:${pageIndex}:${rowIndex}`);
        return {
          ...entry,
          userState: {
            ...entry.userState,
            saved: rowIndex < 50,
          },
        };
      }),
    );
    const captured = state([], []);
    const openScan = async (): Promise<LibraryCoreItemScanSession> => {
      let pageIndex = 0;
      return {
        async nextPage() {
          const items = pages[pageIndex] ?? [];
          pageIndex += 1;
          return { items, done: pageIndex >= pages.length };
        },
        async close() {},
      };
    };
    const client = createScannedLibraryCoreFeedBrowseProjectionClient({
      getSource: async () => source,
      getState: () => captured,
      openScan,
      strategy: {
        generationDomain: "saved-test-generation-v1",
        bindingFilterJson: (filter) => JSON.stringify(filter),
        projectRow: ({ item: entry }) => ({
          priority: 0,
          publishedAt: 0,
          sourceSequence: 0,
          globalId: entry.globalId,
          cardJson: JSON.stringify({ globalId: entry.globalId }),
        }),
      },
    });

    const started = await client.begin(
      "partial-session",
      { savedOnly: true },
      1_000,
    );
    const batches = [
      await client.nextBatch("partial-session", 0),
      await client.nextBatch("partial-session", 1),
      await client.nextBatch("partial-session", 2),
    ];

    expect(started.binding.totalRows).toBe(150);
    expect(batches.map((batch) => batch.rows.length)).toEqual([50, 50, 50]);
    expect(batches.map((batch) => batch.done)).toEqual([false, false, true]);
    expect(
      Math.max(...batches.map((batch) => batch.rows.length)),
    ).toBeLessThanOrEqual(128);
  });

  it("fails closed when scanned items are absent from the source order", async () => {
    const captured = state([], ["saved:first"]);
    const openScan = async (): Promise<LibraryCoreItemScanSession> => {
      let done = false;
      return {
        async nextPage() {
          if (done) return { items: [], done: true };
          done = true;
          return { items: [item("saved:unknown")], done: true };
        },
        async close() {},
      };
    };
    const client = createScannedLibraryCoreFeedBrowseProjectionClient({
      getSource: async () => source,
      getState: () => captured,
      openScan,
    });
    await client.begin("session", {}, 1_000);

    await expect(client.nextBatch("session", 0)).rejects.toThrow(
      "no source sequence",
    );
  });
});
