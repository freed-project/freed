/**
 * @vitest-environment jsdom
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FeedItem } from "@freed/shared";
import type {
  BoundedFeedReader,
  PlatformConfig,
} from "../../context/PlatformContext";
import {
  useBoundedFeedItems,
  type BoundedFeedItemsState,
} from "./useBoundedFeedItems";

const EMPTY_FILTER = {};

function item(globalId: string): FeedItem {
  return {
    globalId,
    platform: "rss",
    contentType: "article",
    author: { id: "author-1" },
    content: { text: globalId },
    publishedAt: 1,
    capturedAt: 1,
    media: [],
    topics: [],
    userState: { saved: false, archived: false, hidden: false, tags: [] },
  };
}

function Harness({
  maxPageItems,
  maxResidentPages,
  onReady,
  openReader,
  rankingClockMs = 123_456,
  sourceVersion = 1,
}: {
  maxPageItems?: number;
  maxResidentPages?: number;
  onReady: (value: {
    feed: BoundedFeedItemsState;
    loadMore(): void;
    patchItems(update: (item: FeedItem) => FeedItem | null): void;
  }) => void;
  openReader: NonNullable<PlatformConfig["openBoundedFeedReader"]>;
  rankingClockMs?: number;
  sourceVersion?: number;
}) {
  const value = useBoundedFeedItems({
    activeFilter: EMPTY_FILTER,
    eligible: true,
    maxPageItems,
    maxResidentPages,
    openReader,
    rankingClockMs,
    sourceVersion,
  });

  useEffect(() => {
    onReady(value);
  }, [onReady, value]);

  return null;
}

describe("useBoundedFeedItems", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
    vi.restoreAllMocks();
  });

  function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }

  it("paginates one bounded reader and closes it on unmount", async () => {
    mount();
    const close = vi.fn(async () => undefined);
    const readNext = vi
      .fn<BoundedFeedReader["readNext"]>()
      .mockResolvedValueOnce([item("one")])
      .mockResolvedValueOnce([item("two")]);
    const openReader = vi.fn(async () => ({
      totalCount: 2,
      readNext,
      close,
    }));
    let current: ReturnType<typeof useBoundedFeedItems> | null = null;

    await act(async () => {
      root!.render(
        <Harness
          openReader={openReader}
          onReady={(value) => {
            current = value;
          }}
        />,
      );
    });
    await vi.waitFor(() => {
      expect(current?.feed.status).toBe("ready");
    });
    expect(current?.feed.items.map((entry) => entry.globalId)).toEqual(["one"]);
    expect(current?.feed.hasMore).toBe(true);
    expect(openReader).toHaveBeenCalledWith(EMPTY_FILTER, 123_456);

    await act(async () => {
      current?.patchItems((entry) =>
        entry.globalId === "one"
          ? {
              ...entry,
              userState: { ...entry.userState, saved: true },
            }
          : entry,
      );
      current?.loadMore();
    });
    await vi.waitFor(() => {
      expect(current?.feed.items.map((entry) => entry.globalId)).toEqual([
        "one",
        "two",
      ]);
    });
    expect(current?.feed.hasMore).toBe(false);
    expect(current?.feed.items[0]?.userState.saved).toBe(true);

    await act(async () => {
      root?.unmount();
    });
    root = null;
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes a reader whose first bounded page fails and exposes legacy fallback", async () => {
    mount();
    const close = vi.fn(async () => undefined);
    const openReader = vi.fn(async () => ({
      totalCount: 1,
      readNext: vi.fn(async () => {
        throw new Error("stale source");
      }),
      close,
    }));
    let current: ReturnType<typeof useBoundedFeedItems> | null = null;

    await act(async () => {
      root!.render(
        <Harness
          openReader={openReader}
          onReady={(value) => {
            current = value;
          }}
        />,
      );
    });
    await vi.waitFor(() => {
      expect(current?.feed.status).toBe("failed");
    });
    expect(current?.feed.items).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("replaces and closes the reader when the authoritative source changes", async () => {
    mount();
    const firstClose = vi.fn(async () => undefined);
    const secondClose = vi.fn(async () => undefined);
    const openReader = vi
      .fn<NonNullable<PlatformConfig["openBoundedFeedReader"]>>()
      .mockResolvedValueOnce({
        totalCount: 1,
        readNext: vi.fn(async () => [item("first")]),
        close: firstClose,
      })
      .mockResolvedValueOnce({
        totalCount: 1,
        readNext: vi.fn(async () => [item("second")]),
        close: secondClose,
      });
    let current: ReturnType<typeof useBoundedFeedItems> | null = null;
    const onReady = (value: ReturnType<typeof useBoundedFeedItems>) => {
      current = value;
    };

    await act(async () => {
      root!.render(
        <Harness openReader={openReader} sourceVersion={1} onReady={onReady} />,
      );
    });
    await vi.waitFor(() => {
      expect(current?.feed.items[0]?.globalId).toBe("first");
    });

    await act(async () => {
      root!.render(
        <Harness openReader={openReader} sourceVersion={2} onReady={onReady} />,
      );
    });
    await vi.waitFor(() => {
      expect(current?.feed.items[0]?.globalId).toBe("second");
    });
    expect(firstClose).toHaveBeenCalledOnce();
  });

  it("cancels an unresolved replaced page without publishing its stale rows", async () => {
    mount();
    const firstClose = vi.fn(async () => undefined);
    const secondClose = vi.fn(async () => undefined);
    let resolveFirstPage: ((items: readonly FeedItem[]) => void) | null = null;
    const firstPage = new Promise<readonly FeedItem[]>((resolve) => {
      resolveFirstPage = resolve;
    });
    const openReader = vi
      .fn<NonNullable<PlatformConfig["openBoundedFeedReader"]>>()
      .mockResolvedValueOnce({
        totalCount: 1,
        readNext: vi.fn(() => firstPage),
        close: firstClose,
      })
      .mockResolvedValueOnce({
        totalCount: 1,
        readNext: vi.fn(async () => [item("current")]),
        close: secondClose,
      });
    let current: ReturnType<typeof useBoundedFeedItems> | null = null;
    const onReady = (value: ReturnType<typeof useBoundedFeedItems>) => {
      current = value;
    };

    await act(async () => {
      root!.render(
        <Harness openReader={openReader} sourceVersion={1} onReady={onReady} />,
      );
    });
    await vi.waitFor(() => expect(openReader).toHaveBeenCalledOnce());

    await act(async () => {
      root!.render(
        <Harness openReader={openReader} sourceVersion={2} onReady={onReady} />,
      );
    });
    await vi.waitFor(() => {
      expect(current?.feed.items[0]?.globalId).toBe("current");
    });
    expect(firstClose).toHaveBeenCalledOnce();

    await act(async () => {
      resolveFirstPage?.([item("stale")]);
      await firstPage;
    });
    expect(current?.feed.items.map((entry) => entry.globalId)).toEqual([
      "current",
    ]);
    expect(firstClose).toHaveBeenCalledOnce();
  });

  it("traverses beyond 256 rows while retaining only two 128-row pages", async () => {
    mount();
    const close = vi.fn(async () => undefined);
    const pages = Array.from({ length: 4 }, (_, pageIndex) =>
      Array.from({ length: 128 }, (_, itemIndex) =>
        item(`page-${pageIndex}-item-${itemIndex}`),
      ),
    );
    const readNext = vi.fn<BoundedFeedReader["readNext"]>();
    for (const page of pages) readNext.mockResolvedValueOnce(page);
    const openReader = vi.fn(async () => ({
      totalCount: 512,
      readNext,
      close,
    }));
    let current: ReturnType<typeof useBoundedFeedItems> | null = null;

    await act(async () => {
      root!.render(
        <Harness
          maxPageItems={128}
          maxResidentPages={2}
          openReader={openReader}
          onReady={(value) => {
            current = value;
          }}
        />,
      );
    });
    await vi.waitFor(() => {
      expect(current?.feed.items).toHaveLength(128);
    });

    await act(async () => current?.loadMore());
    await vi.waitFor(() => {
      expect(current?.feed.items).toHaveLength(256);
    });
    expect(current?.feed.windowStartIndex).toBe(0);

    await act(async () => current?.loadMore());
    await vi.waitFor(() => {
      expect(current?.feed.windowStartIndex).toBe(128);
    });
    expect(current?.feed.items).toHaveLength(256);
    expect(current?.feed.items[0]?.globalId).toBe("page-1-item-0");
    expect(current?.feed.items.at(-1)?.globalId).toBe("page-2-item-127");
    expect(current?.feed.status).toBe("ready");

    await act(async () => current?.loadMore());
    await vi.waitFor(() => {
      expect(current?.feed.hasMore).toBe(false);
    });
    expect(current?.feed.windowStartIndex).toBe(256);
    expect(current?.feed.items).toHaveLength(256);
    expect(current?.feed.items[0]?.globalId).toBe("page-2-item-0");
    expect(current?.feed.items.at(-1)?.globalId).toBe("page-3-item-127");
    expect(current?.feed.status).toBe("ready");
    expect(readNext).toHaveBeenCalledTimes(4);
    expect(close).not.toHaveBeenCalled();
  });

  it("falls back before bounded pages can grow into an unbounded React feed", async () => {
    mount();
    const close = vi.fn(async () => undefined);
    const pages = Array.from({ length: 5 }, (_, pageIndex) =>
      Array.from({ length: 128 }, (_, itemIndex) =>
        item(`page-${pageIndex}-item-${itemIndex}`),
      ),
    );
    const readNext = vi.fn<BoundedFeedReader["readNext"]>();
    for (const page of pages) readNext.mockResolvedValueOnce(page);
    const openReader = vi.fn(async () => ({
      totalCount: 640,
      readNext,
      close,
    }));
    let current: ReturnType<typeof useBoundedFeedItems> | null = null;

    await act(async () => {
      root!.render(
        <Harness
          openReader={openReader}
          onReady={(value) => {
            current = value;
          }}
        />,
      );
    });
    await vi.waitFor(() => {
      expect(current?.feed.items).toHaveLength(128);
    });

    for (const expectedLength of [256, 384, 512]) {
      await act(async () => {
        current?.loadMore();
      });
      await vi.waitFor(() => {
        expect(current?.feed.items).toHaveLength(expectedLength);
      });
    }

    await act(async () => {
      current?.loadMore();
    });
    await vi.waitFor(() => {
      expect(current?.feed.status).toBe("failed");
    });
    expect(current?.feed.items).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
  });
});
