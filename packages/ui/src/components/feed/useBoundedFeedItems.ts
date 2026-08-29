import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedItem, FilterOptions } from "@freed/shared";
import type {
  BoundedFeedPage,
  BoundedFeedReader,
  PlatformConfig,
} from "../../context/PlatformContext.js";

export interface BoundedFeedItemsState {
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly items: FeedItem[];
  readonly hasMore: boolean;
  /** Whether an evicted page can still be restored above the resident window. */
  readonly hasPrevious: boolean;
  /** Number of source rows traversed before the first resident row. */
  readonly windowStartIndex: number;
  /** Exact count returned by the bounded SQLite reader. */
  readonly totalCount: number;
}

const EMPTY_BOUNDED_FEED: BoundedFeedItemsState = {
  status: "idle",
  items: [],
  hasMore: false,
  hasPrevious: false,
  windowStartIndex: 0,
  totalCount: 0,
};

interface ResidentPage {
  readonly items: FeedItem[];
  /** Source rows consumed by this page before local optimistic patches. */
  readonly sourceCount: number;
  /** Opaque edges for resuming traversal on either side of this page. */
  readonly previousCursor: string | null;
  readonly nextCursor: string | null;
}

/**
 * Own one bounded platform reader for the active feed view.
 *
 * The resident window is at most `maxResidentPages` whole reader pages. A
 * reader that offers `readPage` can restore an evicted leading page, so deep
 * scrolling evicts on both sides instead of growing one renderer-held list.
 *
 * Any source, filter, or reader failure closes the bounded session and fails
 * the current window. It never falls back to a full-corpus renderer path or
 * leaves the feed between two SQLite source revisions.
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
  /** Reject an oversized bounded page before it can enter React state. */
  maxPageItems: number;
  /** Whole reader pages kept in React at once. */
  maxResidentPages: number;
  openReader: PlatformConfig["openBoundedFeedReader"];
  rankingClockMs: number;
  sourceVersion: number;
}): {
  readonly feed: BoundedFeedItemsState;
  loadMore(): void;
  loadPrevious(): void;
  patchItems(update: (item: FeedItem) => FeedItem | null): void;
} {
  const readerRef = useRef<BoundedFeedReader | null>(null);
  const loadRef = useRef<Promise<void> | null>(null);
  const pagesRef = useRef<ResidentPage[]>([]);
  const windowStartIndexRef = useRef(0);
  const windowEndIndexRef = useRef(0);
  const closedReadersRef = useRef(new WeakSet<object>());
  const [feed, setFeed] = useState<BoundedFeedItemsState>(EMPTY_BOUNDED_FEED);

  const closeReader = useCallback(async (reader: BoundedFeedReader) => {
    if (closedReadersRef.current.has(reader)) return;
    closedReadersRef.current.add(reader);
    await reader.close().catch(() => undefined);
  }, []);

  const resetWindow = useCallback(() => {
    pagesRef.current = [];
    windowStartIndexRef.current = 0;
    windowEndIndexRef.current = 0;
  }, []);

  /** Publish the resident pages as one flat list plus its traversal bounds. */
  const publishWindow = useCallback((totalCount: number) => {
    const pages = pagesRef.current;
    setFeed({
      status: "ready",
      items: pages.flatMap((page) => page.items),
      hasMore: windowEndIndexRef.current < totalCount,
      hasPrevious:
        windowStartIndexRef.current > 0 &&
        (pages[0]?.previousCursor ?? null) !== null,
      windowStartIndex: windowStartIndexRef.current,
      totalCount,
    });
  }, []);

  const failClosed = useCallback(
    (reader: BoundedFeedReader) => {
      readerRef.current = null;
      resetWindow();
      void closeReader(reader);
      setFeed({
        status: "failed",
        items: [],
        hasMore: false,
        hasPrevious: false,
        windowStartIndex: 0,
        totalCount: 0,
      });
    },
    [closeReader, resetWindow],
  );

  useEffect(() => {
    let cancelled = false;
    let openedReader: BoundedFeedReader | null = null;
    loadRef.current = null;
    resetWindow();
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
      hasPrevious: false,
      windowStartIndex: 0,
      totalCount: 0,
    });
    void openReader(activeFilter, rankingClockMs)
      .then(async (reader) => {
        openedReader = reader;
        if (cancelled) {
          await closeReader(reader);
          return;
        }
        readerRef.current = reader;
        const firstPage: BoundedFeedPage = reader.readPage
          ? await reader.readPage(null, "next")
          : {
              items: await reader.readNext(),
              nextCursor: null,
              previousCursor: null,
            };
        if (cancelled || readerRef.current !== reader) {
          await closeReader(reader);
          return;
        }
        if (
          firstPage.items.length > maxPageItems ||
          firstPage.items.length > reader.totalCount ||
          (firstPage.items.length === 0 && reader.totalCount > 0)
        ) {
          readerRef.current = null;
          resetWindow();
          await closeReader(reader);
          setFeed({
            status: "failed",
            items: [],
            hasMore: false,
            hasPrevious: false,
            windowStartIndex: 0,
            totalCount: 0,
          });
          return;
        }
        pagesRef.current = [
          {
            items: [...firstPage.items],
            sourceCount: firstPage.items.length,
            previousCursor: firstPage.previousCursor,
            nextCursor: firstPage.nextCursor,
          },
        ];
        windowStartIndexRef.current = 0;
        windowEndIndexRef.current = firstPage.items.length;
        publishWindow(reader.totalCount);
      })
      .catch(() => {
        const failedReader = openedReader;
        openedReader = null;
        if (failedReader) void closeReader(failedReader);
        if (!cancelled) {
          readerRef.current = null;
          resetWindow();
          setFeed({
            status: "failed",
            items: [],
            hasMore: false,
            hasPrevious: false,
            windowStartIndex: 0,
            totalCount: 0,
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
    publishWindow,
    rankingClockMs,
    resetWindow,
    sourceVersion,
  ]);

  const loadMore = useCallback(() => {
    const reader = readerRef.current;
    if (!reader || feed.status !== "ready" || !feed.hasMore || loadRef.current) {
      return;
    }
    const trailingCursor =
      pagesRef.current[pagesRef.current.length - 1]?.nextCursor ?? null;
    const request: Promise<BoundedFeedPage> = reader.readPage
      ? reader.readPage(trailingCursor, "next")
      : reader
          .readNext()
          .then((items) => ({ items, nextCursor: null, previousCursor: null }));
    const load = request
      .then((page) => {
        if (readerRef.current !== reader) return;
        const nextWindowEnd = windowEndIndexRef.current + page.items.length;
        if (
          page.items.length === 0 ||
          nextWindowEnd > reader.totalCount ||
          page.items.length > maxPageItems
        ) {
          failClosed(reader);
          return;
        }
        const nextPages: ResidentPage[] = [
          ...pagesRef.current,
          {
            items: [...page.items],
            sourceCount: page.items.length,
            previousCursor: page.previousCursor,
            nextCursor: page.nextCursor,
          },
        ];
        while (nextPages.length > maxResidentPages) {
          windowStartIndexRef.current += nextPages.shift()?.sourceCount ?? 0;
        }
        pagesRef.current = nextPages;
        windowEndIndexRef.current = nextWindowEnd;
        publishWindow(reader.totalCount);
      })
      .catch(() => {
        if (readerRef.current === reader) failClosed(reader);
      })
      .finally(() => {
        if (loadRef.current === load) loadRef.current = null;
      });
    loadRef.current = load;
  }, [
    failClosed,
    feed.hasMore,
    feed.status,
    maxPageItems,
    maxResidentPages,
    publishWindow,
  ]);

  const loadPrevious = useCallback(() => {
    const reader = readerRef.current;
    const leadingCursor = pagesRef.current[0]?.previousCursor ?? null;
    if (
      !reader ||
      !reader.readPage ||
      feed.status !== "ready" ||
      !feed.hasPrevious ||
      leadingCursor === null ||
      loadRef.current
    ) {
      return;
    }
    const load = reader
      .readPage(leadingCursor, "previous")
      .then((page) => {
        if (readerRef.current !== reader) return;
        const leading = pagesRef.current[0];
        if (!leading) {
          failClosed(reader);
          return;
        }
        if (page.items.length === 0) {
          // Nothing precedes the resident window after all. Retire the leading
          // edge so the view stops offering a restore that cannot happen.
          pagesRef.current = [
            { ...leading, previousCursor: null },
            ...pagesRef.current.slice(1),
          ];
          publishWindow(reader.totalCount);
          return;
        }
        const nextWindowStart = windowStartIndexRef.current - page.items.length;
        if (page.items.length > maxPageItems || nextWindowStart < 0) {
          failClosed(reader);
          return;
        }
        const nextPages: ResidentPage[] = [
          {
            items: [...page.items],
            sourceCount: page.items.length,
            previousCursor: page.previousCursor,
            nextCursor: page.nextCursor,
          },
          ...pagesRef.current,
        ];
        while (nextPages.length > maxResidentPages) {
          windowEndIndexRef.current -= nextPages.pop()?.sourceCount ?? 0;
        }
        pagesRef.current = nextPages;
        windowStartIndexRef.current = nextWindowStart;
        publishWindow(reader.totalCount);
      })
      .catch(() => {
        if (readerRef.current === reader) failClosed(reader);
      })
      .finally(() => {
        if (loadRef.current === load) loadRef.current = null;
      });
    loadRef.current = load;
  }, [
    failClosed,
    feed.hasPrevious,
    feed.status,
    maxPageItems,
    maxResidentPages,
    publishWindow,
  ]);

  const patchItems = useCallback(
    (update: (item: FeedItem) => FeedItem | null) => {
      // The resident pages are the source of truth and are patched
      // synchronously. Deferring this into a state updater would let a page
      // load that resolves first publish rows without the optimistic edit.
      // Source counts stay fixed: an optimistic removal must not shift the
      // window offsets the reader resumes from.
      pagesRef.current = pagesRef.current.map((page) => ({
        ...page,
        items: page.items
          .map(update)
          .filter((item): item is FeedItem => item !== null),
      }));
      const items = pagesRef.current.flatMap((page) => page.items);
      setFeed((current) => {
        if (current.status !== "ready") return current;
        return items.length === current.items.length &&
          items.every((item, index) => item === current.items[index])
          ? current
          : { ...current, items };
      });
    },
    [],
  );

  return { feed, loadMore, loadPrevious, patchItems };
}
