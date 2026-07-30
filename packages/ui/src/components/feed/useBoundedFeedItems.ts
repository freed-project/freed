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
}

const EMPTY_BOUNDED_FEED: BoundedFeedItemsState = {
  status: "idle",
  items: [],
  hasMore: false,
};

// Gate D keeps only a small scrolling window in React. Until the reader grows
// reverse paging, crossing this boundary returns to the existing Automerge
// path instead of quietly rebuilding an unbounded second feed in memory.
const MAX_RESIDENT_BOUNDED_FEED_ITEMS = 512;

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
  openReader,
  sourceVersion,
}: {
  activeFilter: FilterOptions;
  eligible: boolean;
  openReader: PlatformConfig["openBoundedFeedReader"];
  sourceVersion: number;
}): {
  readonly feed: BoundedFeedItemsState;
  loadMore(): void;
  patchItems(update: (item: FeedItem) => FeedItem | null): void;
} {
  const readerRef = useRef<BoundedFeedReader | null>(null);
  const loadRef = useRef<Promise<void> | null>(null);
  const residentItemCountRef = useRef(0);
  const [feed, setFeed] = useState<BoundedFeedItemsState>(EMPTY_BOUNDED_FEED);

  useEffect(() => {
    let cancelled = false;
    let openedReader: BoundedFeedReader | null = null;
    loadRef.current = null;
    residentItemCountRef.current = 0;
    const previous = readerRef.current;
    readerRef.current = null;
    if (previous) void previous.close().catch(() => undefined);

    if (!eligible || !openReader) {
      setFeed(EMPTY_BOUNDED_FEED);
      return () => {
        cancelled = true;
      };
    }

    setFeed({ status: "loading", items: [], hasMore: false });
    void openReader(activeFilter, Date.now())
      .then(async (reader) => {
        openedReader = reader;
        if (cancelled) {
          await reader.close().catch(() => undefined);
          return;
        }
        readerRef.current = reader;
        const firstPage = await reader.readNext();
        if (cancelled || readerRef.current !== reader) {
          await reader.close().catch(() => undefined);
          return;
        }
        const nextItems = [...firstPage];
        residentItemCountRef.current = nextItems.length;
        setFeed({
          status: "ready",
          items: nextItems,
          hasMore: nextItems.length < reader.totalCount,
        });
      })
      .catch(() => {
        const failedReader = openedReader;
        openedReader = null;
        if (failedReader) void failedReader.close().catch(() => undefined);
        if (!cancelled) {
          readerRef.current = null;
          setFeed({ status: "failed", items: [], hasMore: false });
        }
      });

    return () => {
      cancelled = true;
      const reader = readerRef.current;
      readerRef.current = null;
      if (reader) void reader.close().catch(() => undefined);
    };
  }, [activeFilter, eligible, openReader, sourceVersion]);

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
        const nextResidentCount = residentItemCountRef.current + page.length;
        if (
          page.length === 0 ||
          nextResidentCount > MAX_RESIDENT_BOUNDED_FEED_ITEMS
        ) {
          readerRef.current = null;
          residentItemCountRef.current = 0;
          void reader.close().catch(() => undefined);
          setFeed({ status: "failed", items: [], hasMore: false });
          return;
        }
        residentItemCountRef.current = nextResidentCount;
        setFeed((current) => {
          if (current.status !== "ready") return current;
          const items = [...current.items, ...page];
          return {
            status: "ready",
            items,
            hasMore: items.length < reader.totalCount,
          };
        });
      })
      .catch(() => {
        if (readerRef.current === reader) {
          readerRef.current = null;
          residentItemCountRef.current = 0;
          void reader.close().catch(() => undefined);
          setFeed({ status: "failed", items: [], hasMore: false });
        }
      })
      .finally(() => {
        if (loadRef.current === load) loadRef.current = null;
      });
    loadRef.current = load;
  }, [feed.hasMore, feed.status]);

  const patchItems = useCallback(
    (update: (item: FeedItem) => FeedItem | null) => {
      setFeed((current) => {
        if (current.status !== "ready") return current;
        const items = current.items
          .map(update)
          .filter((item): item is FeedItem => item !== null);
        residentItemCountRef.current = items.length;
        return items.every((item, index) => item === current.items[index])
          ? current
          : { ...current, items };
      });
    },
    [],
  );

  return { feed, loadMore, patchItems };
}
