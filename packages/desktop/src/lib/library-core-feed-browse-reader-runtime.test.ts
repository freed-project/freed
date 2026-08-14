import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";

const mocks = vi.hoisted(() => ({
  querySqliteItems: vi.fn(),
}));

vi.mock("./sqlite-library", () => ({
  querySqliteItems: mocks.querySqliteItems,
}));
vi.mock("./library-client", () => ({
  getDocState: vi.fn(() => null),
}));

const { openBoundedDesktopFeedReader, readDesktopFeedSignalCounts } = await import(
  "./library-core-feed-browse-reader-runtime"
);

describe("SQLite bounded feed reader", () => {
  beforeEach(() => {
    mocks.querySqliteItems.mockReset();
  });

  it("opens the ordinary feed from one bounded native query", async () => {
    const item = { globalId: "first" } as FeedItem;
    mocks.querySqliteItems.mockResolvedValue({
      items: [item],
      nextOffset: 64,
      totalCount: 20_085,
    });

    const reader = await openBoundedDesktopFeedReader(
      {
        socialContentFilter: "posts",
        signals: ["essay"],
        tags: ["favorite"],
      },
      Date.now(),
    );

    expect(reader.totalCount).toBe(20_085);
    expect(mocks.querySqliteItems).toHaveBeenCalledOnce();
    expect(mocks.querySqliteItems).toHaveBeenCalledWith(
      expect.objectContaining({
        archived: false,
        excludeContentType: "story",
        limit: 64,
        offset: 0,
        signals: ["essay"],
        tags: ["favorite"],
      }),
    );

    await expect(reader.readPage(null, "next")).resolves.toEqual({
      items: [item],
      nextCursor: "sqlite:64",
      previousCursor: null,
    });
    expect(mocks.querySqliteItems).toHaveBeenCalledOnce();
  });

  it("counts signal presets without streaming item pages", async () => {
    mocks.querySqliteItems.mockResolvedValue({
      items: [],
      nextOffset: null,
      totalCount: 42,
    });

    const counts = await readDesktopFeedSignalCounts({ platform: "rss" });

    expect(counts.all).toBe(42);
    expect(mocks.querySqliteItems).toHaveBeenCalledTimes(6);
    for (const [options] of mocks.querySqliteItems.mock.calls) {
      expect(options).toEqual(expect.objectContaining({
        includeTotalCount: true,
        limit: 1,
        platform: "rss",
      }));
    }
  });
});
