import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeLibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowsePageRequestV1,
  type LibraryCoreFeedBrowsePageRequestV2,
} from "@freed/shared/library-core";

import {
  getLibraryCoreProjectionSource,
  materializeLibraryCoreFeedBrowseGeneration,
} from "./automerge";
import {
  LIBRARY_CORE_FEED_BROWSE_READER_DISABLED_KEY,
  LIBRARY_CORE_FRIENDS_FEED_READER_DISABLED_KEY,
  openBoundedDesktopFeedReader,
  openBoundedDesktopFriendsFeedReader,
  openLibraryCoreFeedBrowseReader,
  type LibraryCoreFeedBrowseReaderNativeClient,
} from "./library-core-feed-browse-reader-runtime";
import type {
  LibraryCoreFeedBrowseGenerationBindingV1,
  LibraryCoreProjectionSourceV1,
} from "./automerge-types";

vi.mock("./automerge", () => ({
  getLibraryCoreProjectionSource: vi.fn(),
  materializeLibraryCoreFeedBrowseGeneration: vi.fn(),
}));

const filter = normalizeLibraryCoreFeedBrowseFilterV1({
  platform: "x",
  savedOnly: true,
});
const source: LibraryCoreProjectionSourceV1 = {
  schemaVersion: 1,
  documentId: "library-1",
  headsDigest: "b".repeat(64),
  headCount: 2,
  storageRevision: { generation: 12, saveRevision: 34 },
};
const binding: LibraryCoreFeedBrowseGenerationBindingV1 = {
  generationId: "a".repeat(64),
  sourceDocumentId: source.documentId,
  sourceHeadsDigest: source.headsDigest,
  sourceHeadCount: source.headCount,
  transitionSequence: source.storageRevision.generation,
  projectionRevision: source.storageRevision.saveRevision,
  filterJson: JSON.stringify(filter),
  rankingClockMs: 1_780_000_100_000,
  recommendationOrderSchemaVersion: 1,
  totalRows: 1,
};

function feedCard() {
  return {
    archived: false,
    authorAvatarUrl: null,
    authorDisplayName: null,
    authorHandle: null,
    authorId: null,
    capturedAt: 1_780_000_000_001,
    contentSignalTags: [],
    contentText: "Bounded",
    contentType: "post",
    engagementComments: null,
    engagementLikes: null,
    eventConfidenceBasisPoints: null,
    eventStartsAt: null,
    globalId: "x:item-1",
    liked: false,
    likedAt: null,
    likedSyncedAt: null,
    linkPreviewTitle: null,
    locationName: null,
    mediaTypes: [],
    mediaUrls: [],
    platform: "x",
    publishedAt: 1_780_000_000_000,
    readAt: null,
    readingTimeMinutes: null,
    saved: true,
    sourceUrl: null,
    tags: [],
  };
}

function nativeClient(): LibraryCoreFeedBrowseReaderNativeClient {
  return {
    getSelection: vi.fn(async () => null),
    select: vi.fn(async () => ({
      binding,
      byteLength: 4_096,
      fileDigest: "c".repeat(64),
      selectionSequence: 1,
    })),
    read: vi.fn(
      async (
        request:
          | LibraryCoreFeedBrowsePageRequestV1
          | LibraryCoreFeedBrowsePageRequestV2,
      ) => ({
        filter,
        ...(request.queryId === "feed_browse_page_v2"
          ? {
              friendsPredicateSchemaVersion:
                request.friendsPredicateSchemaVersion,
              identityMode: request.identityMode,
            }
          : {}),
        nextCursor: null,
        nextOrder: null,
        queryId: request.queryId,
        rankingClockMs: request.rankingClockMs,
        recommendationOrderSchemaVersion:
          request.recommendationOrderSchemaVersion,
        rows: [feedCard()],
        schemaVersion: request.schemaVersion,
        source: {
          generationId: binding.generationId,
          transitionSequence: binding.transitionSequence,
          projectionRevision: binding.projectionRevision,
        },
        totalCount: 1,
      }),
    ),
    cancel: vi.fn(async () => undefined),
  };
}

describe("Library Core feed browse reader runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(materializeLibraryCoreFeedBrowseGeneration).mockResolvedValue({
      binding,
      filter,
      status: {
        generationId: binding.generationId,
        nextBatchIndex: 1,
        writtenRows: 1,
        totalRows: 1,
        complete: true,
        sealedFileDigest: "c".repeat(64),
        sealedByteLength: 4_096,
      },
    });
    vi.mocked(getLibraryCoreProjectionSource).mockResolvedValue(source);
  });

  it("selects one exact source and parses one bounded page", async () => {
    const native = nativeClient();
    const session = await openLibraryCoreFeedBrowseReader(
      { platform: "x", savedOnly: true },
      binding.rankingClockMs,
      native,
    );
    const page = await session.readNext(64);
    expect(page.rows.map((row) => row.globalId)).toEqual(["x:item-1"]);
    expect(native.select).toHaveBeenCalledOnce();
    expect(native.read).toHaveBeenCalledOnce();
    await session.close();
  });

  it("binds the Friends identity contract into the v2 materializer and page request", async () => {
    const native = nativeClient();
    const session = await openLibraryCoreFeedBrowseReader(
      { platform: "x" },
      binding.rankingClockMs,
      native,
      "friends",
    );
    const page = await session.readNext(128);

    expect(materializeLibraryCoreFeedBrowseGeneration).toHaveBeenCalledWith(
      { platform: "x" },
      binding.rankingClockMs,
      "friends",
    );
    expect(native.read).toHaveBeenCalledWith(
      expect.objectContaining({
        friendsPredicateSchemaVersion: 1,
        identityMode: "friends",
        limit: 128,
        queryId: "feed_browse_page_v2",
        schemaVersion: 2,
      }),
    );
    expect(page.rows.map((row) => row.globalId)).toEqual(["x:item-1"]);
    expect(session.identityMode).toBe("friends");
    await session.close();
  });

  it("fails closed when the durable source changes before selection", async () => {
    vi.mocked(getLibraryCoreProjectionSource).mockResolvedValueOnce({
      ...source,
      storageRevision: { generation: 12, saveRevision: 35 },
    });
    await expect(
      openLibraryCoreFeedBrowseReader({}, binding.rankingClockMs, nativeClient()),
    ).rejects.toThrow("source changed before selection");
  });

  it("fails closed when the durable source changes after selection", async () => {
    vi.mocked(getLibraryCoreProjectionSource)
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce({
        ...source,
        storageRevision: { generation: 12, saveRevision: 35 },
      });
    await expect(
      openLibraryCoreFeedBrowseReader({}, binding.rankingClockMs, nativeClient()),
    ).rejects.toThrow("source changed after selection");
  });

  it("keeps the device-local rollback switch ahead of all projection work", async () => {
    localStorage.setItem(LIBRARY_CORE_FEED_BROWSE_READER_DISABLED_KEY, "1");
    await expect(openBoundedDesktopFeedReader({}, binding.rankingClockMs)).rejects.toThrow(
      "bounded feed reader is disabled",
    );
    expect(materializeLibraryCoreFeedBrowseGeneration).not.toHaveBeenCalled();
    localStorage.removeItem(LIBRARY_CORE_FEED_BROWSE_READER_DISABLED_KEY);
  });

  it("keeps the Friends rollback switch ahead of all projection work", async () => {
    localStorage.setItem(LIBRARY_CORE_FRIENDS_FEED_READER_DISABLED_KEY, "1");
    await expect(
      openBoundedDesktopFriendsFeedReader({}, binding.rankingClockMs),
    ).rejects.toThrow("bounded Friends feed reader is disabled");
    expect(materializeLibraryCoreFeedBrowseGeneration).not.toHaveBeenCalled();
    localStorage.removeItem(LIBRARY_CORE_FRIENDS_FEED_READER_DISABLED_KEY);
  });
});
