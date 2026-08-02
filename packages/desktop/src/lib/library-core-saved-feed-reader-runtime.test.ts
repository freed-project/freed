import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculatePriority,
  createDefaultPreferences,
  RECENCY_HORIZON_HOURS,
  type FeedItem,
} from "@freed/shared";
import type { LibraryCoreSavedFeedPageRequestV1 } from "@freed/shared/library-core";

import type {
  DocState,
  LibraryCoreFeedBrowseGenerationBindingV1,
  LibraryCoreFeedBrowseProjectionBatchV1,
  LibraryCoreProjectionSourceV1,
} from "./automerge-types";
import {
  LIBRARY_CORE_SAVED_FEED_READER_DISABLED_KEY,
  openBoundedDesktopSavedFeedReader,
  type LibraryCoreSavedFeedNativeClient,
} from "./library-core-saved-feed-reader-runtime";

vi.mock("./automerge", () => ({
  getDocState: vi.fn(() => null),
  getLibraryCoreProjectionSource: vi.fn(),
}));

const source: LibraryCoreProjectionSourceV1 = {
  schemaVersion: 1,
  documentId: "library-1",
  headsDigest: "b".repeat(64),
  headCount: 2,
  storageRevision: { generation: 12, saveRevision: 34 },
};

function item(
  globalId: string,
  saved: boolean,
  savedAt?: number,
  publishedAt = 1_780_000_000_000,
): FeedItem {
  return {
    globalId,
    platform: "saved",
    contentType: "article",
    capturedAt: 1_780_000_000_100,
    publishedAt,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: { text: globalId, mediaUrls: [], mediaTypes: [] },
    preservedContent: {
      text: "",
      wordCount: 600,
      readingTime: 3,
      preservedAt: 1_780_000_000_100,
    },
    userState: {
      hidden: false,
      saved,
      ...(savedAt === undefined ? {} : { savedAt }),
      archived: false,
      tags: [],
    },
    topics: [],
    // Deliberately stale. Native Saved recommendation must recalculate it at
    // the generation's pinned ranking clock.
    priority: 100,
  };
}

function state(items: readonly FeedItem[]): DocState {
  return {
    items: [],
    // The authenticated SQLite scan is globalId ordered. Saved must not retain
    // the legacy renderer source-sequence map merely to define ties.
    feedSourceOrderIds: undefined,
    accounts: {},
    persons: {},
    preferences: createDefaultPreferences(),
    docItemCount: items.length,
  } as unknown as DocState;
}

function nativeClient() {
  let binding: LibraryCoreFeedBrowseGenerationBindingV1 | null = null;
  let appended: LibraryCoreFeedBrowseProjectionBatchV1 | null = null;
  const native: LibraryCoreSavedFeedNativeClient = {
    begin: vi.fn(async (input) => {
      binding = input.binding;
      return {
        generationId: input.binding.generationId,
        nextBatchIndex: 0,
        writtenRows: 0,
        totalRows: input.binding.totalRows,
        complete: false,
        sealedFileDigest: null,
        sealedByteLength: null,
      };
    }),
    append: vi.fn(async (batch) => {
      appended = batch;
      return {
        generationId: batch.binding.generationId,
        nextBatchIndex: batch.batchIndex + 1,
        writtenRows: batch.projectedRows,
        totalRows: batch.binding.totalRows,
        complete: false,
        sealedFileDigest: null,
        sealedByteLength: null,
      };
    }),
    finalize: vi.fn(async () => {
      if (!binding) throw new Error("missing binding");
      return {
        generationId: binding.generationId,
        nextBatchIndex: 1,
        writtenRows: binding.totalRows,
        totalRows: binding.totalRows,
        complete: true,
        sealedFileDigest: "c".repeat(64),
        sealedByteLength: 4_096,
      };
    }),
    cancel: vi.fn(async () => {
      throw new Error("unexpected cancel");
    }),
    getSelection: vi.fn(async () => null),
    select: vi.fn(async (input) => ({
      binding: input.binding,
      byteLength: 4_096,
      fileDigest: "c".repeat(64),
      selectionSequence: 1,
    })),
    read: vi.fn(async (request: LibraryCoreSavedFeedPageRequestV1) => {
      if (!binding || !appended) throw new Error("missing generation");
      const envelope = JSON.parse(binding.filterJson) as {
        filter: LibraryCoreSavedFeedPageRequestV1["filter"];
      };
      return {
        filter: envelope.filter,
        nextCursor: null,
        queryId: request.queryId,
        rankingClockMs: request.rankingClockMs,
        rows: appended.rows.map((row) => JSON.parse(row.cardJson)),
        schemaVersion: request.schemaVersion,
        sortMode: request.sortMode,
        source: {
          generationId: binding.generationId,
          projectionRevision: binding.projectionRevision,
          transitionSequence: binding.transitionSequence,
        },
        totalCount: binding.totalRows,
      };
    }),
    cancelReader: vi.fn(async () => undefined),
  };
  return { native, getAppended: () => appended };
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Library Core Saved reader runtime", () => {
  it("scans the source twice, persists only Saved cards, and restores Saved fields", async () => {
    const rankingClockMs = 1_780_000_100_000;
    const horizonMs = RECENCY_HORIZON_HOURS * 60 * 60 * 1_000;
    const kept = item(
      "saved:kept",
      true,
      1_780_000_000_200,
      rankingClockMs - horizonMs,
    );
    kept.userState.liked = true;
    kept.userState.likedAt = 1_780_000_000_150;
    kept.userState.likedSyncedAt = -1;
    const items = [
      kept,
      item("saved:ignored", false),
    ];
    const hydrated = state(items);
    const scans: Array<{ closed: boolean }> = [];
    const { native, getAppended } = nativeClient();
    const reader = await openBoundedDesktopSavedFeedReader(
      {},
      "recommended",
      rankingClockMs,
      {
        getSource: vi.fn(async () => source),
        getState: () => hydrated,
        openScan: vi.fn(async () => {
          const record = { closed: false };
          scans.push(record);
          let emitted = false;
          return {
            nextPage: vi.fn(async () => {
              if (emitted) return { items: [], done: true };
              emitted = true;
              return { items, done: true };
            }),
            close: vi.fn(async () => {
              record.closed = true;
            }),
          };
        }),
        native,
      },
    );

    expect(reader.totalCount).toBe(1);
    expect(scans).toHaveLength(2);
    expect(scans.every((scan) => scan.closed)).toBe(true);
    expect(getAppended()?.rows.map((row) => row.globalId)).toEqual([
      "saved:kept",
    ]);
    const beginInput = vi.mocked(native.begin).mock.calls[0]?.[0];
    expect(JSON.parse(beginInput?.binding.filterJson ?? "null")).toMatchObject({
      sortMode: "recommended",
      sortOrderSchemaVersion: 1,
    });
    expect(getAppended()?.rows[0]?.priority).toBe(
      calculatePriority(
        kept,
        createDefaultPreferences().weights,
        rankingClockMs,
      ),
    );
    expect(getAppended()?.rows[0]?.priority).not.toBe(kept.priority);
    const page = await reader.readNext();
    expect(page).toHaveLength(1);
    expect(page[0]?.userState.savedAt).toBe(1_780_000_000_200);
    expect(page[0]?.userState.likedSyncedAt).toBe(-1);
    expect(page[0]?.preservedContent?.readingTime).toBe(3);
    expect(native.read).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 128, sortMode: "recommended" }),
    );
    await reader.close();
  });

  it("honors the device-local rollback before scanning the corpus", async () => {
    localStorage.setItem(LIBRARY_CORE_SAVED_FEED_READER_DISABLED_KEY, "1");
    const openScan = vi.fn();
    const { native } = nativeClient();
    await expect(
      openBoundedDesktopSavedFeedReader({}, "date_saved", 1, {
        getSource: vi.fn(async () => source),
        getState: () => state([]),
        openScan,
        native,
      }),
    ).rejects.toThrow("bounded Saved reader is disabled");
    expect(openScan).not.toHaveBeenCalled();
    expect(native.begin).not.toHaveBeenCalled();
  });

  it("serializes concurrent opens from React StrictMode", async () => {
    const hydrated = state([item("saved:kept", true)]);
    const { native } = nativeClient();
    const dependencies = {
      getSource: vi.fn(async () => source),
      getState: () => hydrated,
      openScan: vi.fn(async () => {
        let emitted = false;
        return {
          nextPage: vi.fn(async () => {
            if (emitted) return { items: [], done: true };
            emitted = true;
            return { items: [item("saved:kept", true)], done: true };
          }),
          close: vi.fn(async () => undefined),
        };
      }),
      native,
    };

    const readers = await Promise.all([
      openBoundedDesktopSavedFeedReader({}, "date_saved", 1, dependencies),
      openBoundedDesktopSavedFeedReader({}, "date_saved", 2, dependencies),
    ]);
    expect(native.begin).toHaveBeenCalledTimes(2);
    await Promise.all(readers.map((reader) => reader.close()));
  });
});
