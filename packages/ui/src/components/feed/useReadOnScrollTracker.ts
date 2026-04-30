import { useCallback, useEffect, useRef } from "react";
import { recordBugReportEvent } from "../../lib/bug-report.js";
import {
  collectUnreadIdsFromRows,
  getListViewportMetrics,
  getNewlyPassedRowEnd,
  getRemainingUnreadIds,
  hasReachedListBottom,
  type ReadTrackRow,
  type VirtualRowRange,
} from "./read-on-scroll.js";

type ReadScrollVirtualizer = {
  getVirtualItems: () => VirtualRowRange[];
  getTotalSize: () => number;
  options?: {
    scrollMargin?: number;
  };
};

type ReadScrollMetrics = {
  rawScrollTop: number;
  viewportHeight: number;
  scrollMargin?: number;
};

type ReadScrollSource = "element" | "window";
type ReadScrollSurface = "primary-feed" | "mobile-feed" | "compact-feed";

type ReadTrackItem = {
  globalId: string;
  userState: {
    readAt?: number;
  };
};

interface ReadListSession<TItem extends ReadTrackItem> {
  key: string;
  items: TItem[];
  reachedBottom: boolean;
}

interface UseReadOnScrollTrackerOptions<TItem extends ReadTrackItem> {
  surface: ReadScrollSurface;
  listKey: string;
  rows: Array<ReadTrackRow<TItem>>;
  items: TItem[];
  markReadOnScroll: boolean;
  getScrollMetrics: (scrollSource: ReadScrollSource, virtualizer: ReadScrollVirtualizer) => ReadScrollMetrics;
  markItemsAsRead: (ids: string[]) => Promise<void>;
}

function formatIdTail(id: string): string {
  return `...${id.slice(-8)}`;
}

function recordReadScrollDiagnostic(
  message: string,
  detail: Record<string, unknown>,
): void {
  recordBugReportEvent(
    "feed:read-scroll",
    "info",
    message,
    JSON.stringify(detail),
  );
}

export function useReadOnScrollTracker<TItem extends ReadTrackItem>({
  surface,
  listKey,
  rows,
  items,
  markReadOnScroll,
  getScrollMetrics,
  markItemsAsRead,
}: UseReadOnScrollTrackerOptions<TItem>) {
  const maxPassedRowIndexRef = useRef(-1);
  const listSessionRef = useRef<ReadListSession<TItem>>({
    key: listKey,
    items,
    reachedBottom: false,
  });

  const flushReadIds = useCallback((ids: string[], reason: string) => {
    if (ids.length === 0) return;

    const startedAt = performance.now();
    recordReadScrollDiagnostic(
      `Queued ${ids.length.toLocaleString()} read mark${ids.length === 1 ? "" : "s"}`,
      {
        surface,
        reason,
        queuedCount: ids.length,
        itemIdTails: ids.slice(0, 5).map(formatIdTail),
      },
    );

    void markItemsAsRead(ids)
      .then(() => {
        recordReadScrollDiagnostic(
          `Flushed ${ids.length.toLocaleString()} read mark${ids.length === 1 ? "" : "s"}`,
          {
            surface,
            reason,
            batchCount: ids.length,
            durationMs: Math.round(performance.now() - startedAt),
            itemIdTails: ids.slice(0, 5).map(formatIdTail),
          },
        );
      })
      .catch((error: unknown) => {
        recordBugReportEvent(
          "feed:read-scroll",
          "error",
          `Failed to flush ${ids.length.toLocaleString()} read mark${ids.length === 1 ? "" : "s"}`,
          error instanceof Error ? error.message : String(error),
        );
      });
  }, [markItemsAsRead, surface]);

  const collectUnreadIdsFromVisibleRows = useCallback((startIndex: number, endIndex: number) => {
    return collectUnreadIdsFromRows(rows, startIndex, endIndex);
  }, [rows]);

  const finalizeListSession = useCallback((session: ReadListSession<TItem>) => {
    if (!markReadOnScroll || !session.reachedBottom) return;
    flushReadIds(getRemainingUnreadIds(session.items), "session-finalize");
  }, [flushReadIds, markReadOnScroll]);

  const markRemainingUnreadInSession = useCallback(() => {
    const session = listSessionRef.current;
    if (session.reachedBottom) return;
    session.reachedBottom = true;
    flushReadIds(getRemainingUnreadIds(session.items), "list-bottom");
  }, [flushReadIds]);

  const processReadOnScroll = useCallback((
    virtualizer: ReadScrollVirtualizer,
    scrollSource: ReadScrollSource,
  ) => {
    if (!markReadOnScroll) return;

    const vItems = virtualizer.getVirtualItems();
    if (vItems.length === 0) return;

    const rawMetrics = getScrollMetrics(scrollSource, virtualizer);
    const { scrollTop, viewportBottom } = getListViewportMetrics(
      rawMetrics.rawScrollTop,
      rawMetrics.viewportHeight,
      rawMetrics.scrollMargin ?? virtualizer.options?.scrollMargin ?? 0,
    );

    const previousPassedRowIndex = maxPassedRowIndexRef.current;
    const newlyPassedEnd = getNewlyPassedRowEnd(
      vItems,
      scrollTop,
      rows.length,
      previousPassedRowIndex,
    );

    if (newlyPassedEnd !== null) {
      const unreadIds = collectUnreadIdsFromVisibleRows(
        previousPassedRowIndex + 1,
        newlyPassedEnd,
      );
      maxPassedRowIndexRef.current = newlyPassedEnd;
      recordReadScrollDiagnostic("Processed read-on-scroll boundary", {
        surface,
        scrollSource,
        rowCount: rows.length,
        scrollTop: Math.round(scrollTop),
        viewportHeight: Math.round(rawMetrics.viewportHeight),
        totalSize: Math.round(virtualizer.getTotalSize()),
        firstVirtualRowIndex: vItems[0]?.index ?? null,
        firstVirtualRowEnd: Math.round(vItems[0]?.end ?? 0),
        previousPassedRowIndex,
        newlyPassedRowIndex: newlyPassedEnd,
        unreadCandidateCount: unreadIds.length,
        markReadOnScroll,
      });
      flushReadIds(unreadIds, "passed-rows");
    }

    if (hasReachedListBottom(rows.length, viewportBottom, virtualizer.getTotalSize())) {
      recordReadScrollDiagnostic("Reached read-on-scroll list bottom", {
        surface,
        scrollSource,
        rowCount: rows.length,
        viewportBottom: Math.round(viewportBottom),
        totalSize: Math.round(virtualizer.getTotalSize()),
        markReadOnScroll,
      });
      markRemainingUnreadInSession();
    }
  }, [
    collectUnreadIdsFromVisibleRows,
    flushReadIds,
    getScrollMetrics,
    markReadOnScroll,
    markRemainingUnreadInSession,
    rows.length,
    surface,
  ]);

  useEffect(() => {
    const session = listSessionRef.current;
    if (session.key !== listKey) {
      finalizeListSession(session);
      listSessionRef.current = {
        key: listKey,
        items,
        reachedBottom: false,
      };
      maxPassedRowIndexRef.current = -1;
      return;
    }
    session.items = items;
  }, [finalizeListSession, items, listKey]);

  useEffect(() => {
    return () => {
      finalizeListSession(listSessionRef.current);
    };
  }, [finalizeListSession]);

  return processReadOnScroll;
}
