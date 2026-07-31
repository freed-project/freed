import { describe, expect, it, vi } from "vitest";
import type { FeedItemRow } from "@freed/shared/projection";
import type { LibraryCoreProjectionSourceV1 } from "./automerge-types";
import { readLibraryCoreItemDetail } from "./library-core-item-detail-runtime";

const source: LibraryCoreProjectionSourceV1 = {
  schemaVersion: 1,
  documentId: "library-document",
  headsDigest: "1".repeat(64),
  headCount: 2,
  storageRevision: { generation: 3, saveRevision: 4 },
};

const row: FeedItemRow = {
  globalId: "rss:item-1",
  platform: "rss",
  contentType: "article",
  publishedAt: 42,
  capturedAt: 43,
  authorId: "author-1",
  authorDisplayName: "Writer",
  authorHandle: "writer",
  sourceUrl: "https://example.test/item-1",
  hidden: 0,
  saved: 1,
  archived: 0,
  readAt: null,
  archivedAt: null,
  likedAt: null,
  tags: "[]",
  contentBlob: "{\"text\":\"preview\"}",
  preservedBlob: "{\"text\":\"complete body\",\"readingTime\":7}",
  rest: "{\"__userState\":{\"liked\":false}}",
};

function response(item: FeedItemRow | null = row) {
  return {
    item,
    queryId: "item_detail_v1",
    schemaVersion: 1,
    source: {
      documentId: source.documentId,
      generationId: "2".repeat(64),
      headCount: source.headCount,
      headsDigest: source.headsDigest,
      projectionRevision: 5,
      storageGeneration: source.storageRevision.generation,
      storageSaveRevision: source.storageRevision.saveRevision,
      transitionSequence: 6,
    },
  };
}

describe("Desktop Library Core item detail runtime", () => {
  it("reconstructs one complete item from the selected SQLite row", async () => {
    const getSource = vi.fn().mockResolvedValue(source);
    const readNative = vi.fn().mockResolvedValue(response());

    const item = await readLibraryCoreItemDetail(
      row.globalId,
      getSource,
      readNative,
    );

    expect(item).toMatchObject({
      globalId: row.globalId,
      platform: "rss",
      preservedContent: { text: "complete body", readingTime: 7 },
      userState: { saved: true, liked: false },
    });
    expect(getSource).toHaveBeenCalledTimes(2);
    expect(readNative).toHaveBeenCalledWith({
      globalId: row.globalId,
      queryId: "item_detail_v1",
      schemaVersion: 1,
    });
  });

  it("returns null without inventing a missing item", async () => {
    await expect(
      readLibraryCoreItemDetail(
        "rss:missing",
        vi.fn().mockResolvedValue(source),
        vi.fn().mockResolvedValue(response(null)),
      ),
    ).resolves.toBeNull();
  });

  it("rejects a selected generation that is stale before or during the read", async () => {
    const moved = {
      ...source,
      headsDigest: "3".repeat(64),
    };
    await expect(
      readLibraryCoreItemDetail(
        row.globalId,
        vi.fn().mockResolvedValue(moved),
        vi.fn().mockResolvedValue(response()),
      ),
    ).rejects.toThrow("source is stale");

    const getSource = vi
      .fn()
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(moved);
    await expect(
      readLibraryCoreItemDetail(
        row.globalId,
        getSource,
        vi.fn().mockResolvedValue(response()),
      ),
    ).rejects.toThrow("source changed during read");
  });

  it("rejects decorated responses and mismatched item identities", async () => {
    await expect(
      readLibraryCoreItemDetail(
        row.globalId,
        vi.fn().mockResolvedValue(source),
        vi.fn().mockResolvedValue({ ...response(), extra: true }),
      ),
    ).rejects.toThrow("response is invalid");
    await expect(
      readLibraryCoreItemDetail(
        row.globalId,
        vi.fn().mockResolvedValue(source),
        vi.fn().mockResolvedValue(response({ ...row, globalId: "rss:other" })),
      ),
    ).rejects.toThrow("row is invalid");
  });
});
