import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedItem, FilterOptions } from "@freed/shared";
import type {
  BoundedFeedReader,
  PlatformConfig,
} from "../../context/PlatformContext.js";

export interface BoundedFeedItemsState {
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly items: FeedItem[];
  readonly hasMore: boolean;
  /** Number of source rows traversed before the first resident row. */
  readonly windowStartIndex: number;
}

const EMPTY_BOUNDED_FEED: BoundedFeedItemsState = {
  status: "idle",
  items: [],
  hasMore: false,
  windowStartIndex: 0,
};

// Gate D keeps only a small scrolling window in React. Until the reader grows
// reverse paging, crossing this boundary returns to the existing Automerge
// path instead of quietly rebuilding an unbounded second feed in memory.
const MAX_RESIDENT_BOUNDED_FEED_ITEMS = 512;

interface ResidentPage {
  readonly items: FeedItem[];
  /** Source rows consumed by this page before local optimistic patches. */
  readonly sourceCount: number;
}

/**
 * Own one bounded platform reader for the active feed view.
 *
 * Any source, filter, or reader failure closes the bounded session and returns
 * the caller to its existing in-memory path. SQLite is never allowed to leave
 * the shared feed stuck between two source revisions.
 */
export function useBoundedFeedItems({
  activeFilter,
  eligible,
  maxPageItems,
  maxResidentPages,
  openReader,
  rankingClockMs,
  sourceVersion,
}: {
  activeFilter: FilterOptions;
  eligible: boolean;
  /**
   * When set, evict the oldest whole page instead of falling back after 512
   * rows. Saved uses two 128-row pages so traversal remains bounded.
   */
  maxResidentPages?: number;
  /** Reject an oversized bounded page before it can enter React state. */
  maxPageItems?: number;
  openReader: PlatformConfig["openBoundedFeedReader"];
  rankingClockMs: number;
  sourceVersion: number;
}): {
  readonly feed: BoundedFeedItemsState;
  loadMore(): void;
  patchItems(update: (item: FeedItem) => FeedItem | null): void;
} {
  const readerRef = useRef<BoundedFeedReader | null>(null);
  const loadRef = useRef<Promise<void> | null>(null);
  const loadedItemCountRef = useRef(0);
  const pagesRef = useRef<ResidentPage[]>([]);
  const residentItemCountRef = useRef(0);
  const windowStartIndexRef = useRef(0);
  const closedReadersRef = useRef(new WeakSet<object>());
  const [feed, setFeed] = useState<BoundedFeedItemsState>(EMPTY_BOUNDED_FEED);

  const closeReader = useCallback(async (reader: BoundedFeedReader) => {
    if (closedReadersRef.current.has(reader)) return;
    closedReadersRef.current.add(reader);
    await reader.close().catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let openedReader: BoundedFeedReader | null = null;
    loadRef.current = null;
    loadedItemCountRef.current = 0;
    pagesRef.current = [];
    residentItemCountRef.current = 0;
    windowStartIndexRef.current = 0;
    const previous = readerRef.current;
    readerRef.current = null;
    if (previous) void closeReader(previous);

    if (!eligible || !openReader) {
      setFeed(EMPTY_BOUNDED_FEED);
      return () => {
        cancelled = true;
      };
    }

    setFeed({
      status: "loading",
      items: [],
      hasMore: false,
      windowStartIndex: 0,
    });
    void openReader(activeFilter, rankingClockMs)
      .then(async (reader) => {
        openedReader = reader;
        if (cancelled) {
          await closeReader(reader);
          return;
        }
        readerRef.current = reader;
        const firstPage = await reader.readNext();
        if (cancelled || readerRef.current !== reader) {
          await closeReader(reader);
          return;
        }
        if (
          (maxPageItems !== undefined && firstPage.length > maxPageItems) ||
          firstPage.length > reader.totalCount ||
          (firstPage.length === 0 && reader.totalCount > 0)
        ) {
          readerRef.current = null;
          await closeReader(reader);
          setFeed({
            status: "failed",
            items: [],
            hasMore: false,
            windowStartIndex: 0,
          });
          return;
        }
        const nextItems = [...firstPage];
        loadedItemCountRef.current = firstPage.length;
        pagesRef.current = [
          { items: nextItems, sourceCount: firstPage.length },
        ];
        residentItemCountRef.current = nextItems.length;
        setFeed({
          status: "ready",
          items: nextItems,
          hasMore: loadedItemCountRef.current < reader.totalCount,
          windowStartIndex: 0,
        });
      })
      .catch(() => {
        const failedReader = openedReader;
        openedReader = null;
        if (failedReader) void closeReader(failedReader);
        if (!cancelled) {
          readerRef.current = null;
          setFeed({
            status: "failed",
            items: [],
            hasMore: false,
            windowStartIndex: 0,
          });
        }
      });

    return () => {
      cancelled = true;
      const reader = readerRef.current;
      readerRef.current = null;
      if (reader) void closeReader(reader);
    };
  }, [
    activeFilter,
    closeReader,
    eligible,
    maxPageItems,
    maxResidentPages,
    openReader,
    rankingClockMs,
    sourceVersion,
  ]);

  const loadMore = useCallback(() => {
    const reader = readerRef.current;
    if (
      !reader ||
      feed.status !== "ready" ||
      !feed.hasMore ||
      loadRef.current
    ) {
      return;
    }
    const load = reader
      .readNext()
      .then((page) => {
        if (readerRef.current !== reader) return;
        const nextLoadedCount = loadedItemCountRef.current + page.length;
        if (
          page.length === 0 ||
          nextLoadedCount > reader.totalCount ||
          (maxPageItems !== undefined && page.length > maxPageItems)
        ) {
          readerRef.current = null;
          loadedItemCountRef.current = 0;
          pagesRef.current = [];
          residentItemCountRef.current = 0;
          windowStartIndexRef.current = 0;
          void closeReader(reader);
          setFeed({
            status: "failed",
            items: [],
            hasMore: false,
            windowStartIndex: 0,
          });
          return;
        }

        if (maxResidentPages !== undefined) {
          const nextPages: ResidentPage[] = [
            ...pagesRef.current,
            { items: [...page], sourceCount: page.length },
          ];
          let evictedSourceCount = 0;
          while (nextPages.length > maxResidentPages) {
            evictedSourceCount += nextPages.shift()?.sourceCount ?? 0;
          }
          pagesRef.current = nextPages;
          loadedItemCountRef.current = nextLoadedCount;
          windowStartIndexRef.current += evictedSourceCount;
          const items = nextPages.flatMap((entry) => entry.items);
          residentItemCountRef.current = items.length;
          setFeed({
            status: "ready",
            items,
            hasMore: nextLoadedCount < reader.totalCount,
            windowStartIndex: windowStartIndexRef.current,
          });
          return;
        }

        const nextResidentCount = residentItemCountRef.current + page.length;
        if (nextResidentCount > MAX_RESIDENT_BOUNDED_FEED_ITEMS) {
          readerRef.current = null;
          loadedItemCountRef.current = 0;
          pagesRef.current = [];
          residentItemCountRef.current = 0;
          windowStartIndexRef.current = 0;
          void closeReader(reader);
          setFeed({
            status: "failed",
            items: [],
            hasMore: false,
            windowStartIndex: 0,
          });
          return;
        }
        loadedItemCountRef.current = nextLoadedCount;
        residentItemCountRef.current = nextResidentCount;
        setFeed((current) => {
          if (current.status !== "ready") return current;
          const items = [...current.items, ...page];
          return {
            status: "ready",
            items,
            hasMore: nextLoadedCount < reader.totalCount,
            windowStartIndex: current.windowStartIndex,
          };
        });
      })
      .catch(() => {
        if (readerRef.current === reader) {
          readerRef.current = null;
          loadedItemCountRef.current = 0;
          pagesRef.current = [];
          residentItemCountRef.current = 0;
          windowStartIndexRef.current = 0;
          void closeReader(reader);
          setFeed({
            status: "failed",
            items: [],
            hasMore: false,
            windowStartIndex: 0,
          });
        }
      })
      .finally(() => {
        if (loadRef.current === load) loadRef.current = null;
      });
    loadRef.current = load;
  }, [closeReader, feed.hasMore, feed.status, maxPageItems, maxResidentPages]);

  const patchItems = useCallback(
    (update: (item: FeedItem) => FeedItem | null) => {
      setFeed((current) => {
        if (current.status !== "ready") return current;
        let items: FeedItem[];
        if (maxResidentPages !== undefined) {
          pagesRef.current = pagesRef.current.map((page) => ({
            ...page,
            items: page.items
              .map(update)
              .filter((item): item is FeedItem => item !== null),
          }));
          items = pagesRef.current.flatMap((page) => page.items);
        } else {
          items = current.items
            .map(update)
            .filter((item): item is FeedItem => item !== null);
        }
        residentItemCountRef.current = items.length;
        return items.length === current.items.length &&
          items.every((item, index) => item === current.items[index])
          ? current
          : { ...current, items };
      });
    },
    [maxResidentPages],
  );

  return { feed, loadMore, patchItems };
}
