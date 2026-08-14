import { useEffect, useMemo, useState } from "react";
import {
  FEED_SIGNAL_FILTER_PRESETS,
  filterFeedItems,
  type FeedItem,
  type FeedSignalMode,
  type LibraryCoreFeedBrowseFilterInputV1,
} from "@freed/shared";
import {
  usePlatform,
  type ReadFeedSignalCounts,
  type ScanLibraryItems,
} from "../context/PlatformContext.js";
import { useLegacyLibraryItems } from "./useLegacyLibraryItems.js";

export type FeedSignalCounts = Readonly<Record<FeedSignalMode, number>>;

const EMPTY_FEED_SIGNAL_COUNTS: FeedSignalCounts = Object.freeze({
  all: 0,
  inspiring: 0,
  events: 0,
  personal: 0,
  conversation: 0,
  news: 0,
});

const SELECTABLE_PRESETS = FEED_SIGNAL_FILTER_PRESETS.filter(
  (preset) => preset.mode !== "all",
);

interface CachedSignalCounts {
  reader: ScanLibraryItems | ReadFeedSignalCounts;
  requestKey: string;
  promise: Promise<FeedSignalCounts>;
  result: FeedSignalCounts | null;
}

interface VersionedSignalCounts {
  requestKey: string;
  counts: FeedSignalCounts;
}

let signalCountCache: CachedSignalCounts | null = null;

/**
 * Count every signal preset in one bounded pass.
 *
 * Each page is filtered and discarded, so the corpus is never resident. Doing
 * all presets in a single traversal keeps this to one scan per source revision
 * instead of one scan per chip.
 */
async function countBySignalPreset(
  scanner: ScanLibraryItems,
  baseFilter: LibraryCoreFeedBrowseFilterInputV1,
): Promise<FeedSignalCounts> {
  const counts: Record<FeedSignalMode, number> = {
    all: 0,
    inspiring: 0,
    events: 0,
    personal: 0,
    conversation: 0,
    news: 0,
  };
  await scanner((page) => {
    const pageItems = [...page];
    counts.all += filterFeedItems(pageItems, baseFilter).length;
    for (const preset of SELECTABLE_PRESETS) {
      counts[preset.mode] += filterFeedItems(pageItems, {
        ...baseFilter,
        signals: [...preset.signals],
      }).length;
    }
    return "continue";
  });
  return Object.freeze(counts);
}

function prepareSignalCounts(
  scanner: ScanLibraryItems,
  requestKey: string,
  baseFilter: LibraryCoreFeedBrowseFilterInputV1,
): CachedSignalCounts {
  if (
    signalCountCache?.reader === scanner &&
    signalCountCache.requestKey === requestKey
  ) {
    return signalCountCache;
  }
  const entry: CachedSignalCounts = {
    reader: scanner,
    requestKey,
    result: null,
    promise: Promise.resolve(EMPTY_FEED_SIGNAL_COUNTS),
  };
  entry.promise = countBySignalPreset(scanner, baseFilter).then((counts) => {
    entry.result = counts;
    return counts;
  });
  signalCountCache = entry;
  return entry;
}

function prepareNativeSignalCounts(
  reader: ReadFeedSignalCounts,
  requestKey: string,
  baseFilter: LibraryCoreFeedBrowseFilterInputV1,
): CachedSignalCounts {
  if (
    signalCountCache?.reader === reader &&
    signalCountCache.requestKey === requestKey
  ) {
    return signalCountCache;
  }
  const entry: CachedSignalCounts = {
    reader,
    requestKey,
    result: null,
    promise: Promise.resolve(EMPTY_FEED_SIGNAL_COUNTS),
  };
  entry.promise = reader(baseFilter).then((counts) => {
    entry.result = counts;
    return counts;
  });
  signalCountCache = entry;
  return entry;
}

/**
 * Feed-signal chip counts for the current filter, without holding the corpus.
 *
 * The renderer evicts the full item projection on the healthy Desktop path, so
 * counting from the store array silently reports zero for every chip. Prefer a
 * platform-local aggregate reader. Stream bounded pages only on adapters that
 * do not expose one.
 */
export function useFeedSignalCounts(
  fallbackItems: FeedItem[],
  baseFilter: LibraryCoreFeedBrowseFilterInputV1,
  sourceVersion: number,
  /**
   * Hold every read until the library has loaded. The bounded scanner pins the
   * projection source, and asking for it before Library persistence is ready
   * makes the worker log a startup error.
   */
  enabled: boolean,
): FeedSignalCounts {
  const { readFeedSignalCounts, scanLibraryItems } = usePlatform();
  const requestKey = useMemo(
    () => JSON.stringify([sourceVersion, baseFilter]),
    [baseFilter, sourceVersion],
  );
  const [versioned, setVersioned] = useState<VersionedSignalCounts | null>(
    () => {
      const reader = readFeedSignalCounts ?? scanLibraryItems;
      if (!reader) return null;
      const cached =
        signalCountCache?.reader === reader &&
        signalCountCache.requestKey === requestKey
          ? signalCountCache.result
          : null;
      return cached ? { requestKey, counts: cached } : null;
    },
  );
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const shouldFallback =
    enabled &&
    ((!readFeedSignalCounts && !scanLibraryItems) || failedKey === requestKey);
  useLegacyLibraryItems(shouldFallback);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || (!readFeedSignalCounts && !scanLibraryItems)) {
      setVersioned(null);
      setFailedKey(null);
      return () => {
        cancelled = true;
      };
    }

    setFailedKey(null);
    const prepared = readFeedSignalCounts
      ? prepareNativeSignalCounts(readFeedSignalCounts, requestKey, baseFilter)
      : prepareSignalCounts(scanLibraryItems!, requestKey, baseFilter);
    if (prepared.result) setVersioned({ requestKey, counts: prepared.result });
    prepared.promise
      .then((counts) => {
        if (!cancelled) setVersioned({ requestKey, counts });
      })
      .catch(() => {
        if (!cancelled) setFailedKey(requestKey);
      });

    return () => {
      cancelled = true;
    };
    // baseFilter is already folded into requestKey; depending on the object
    // identity would rescan on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, readFeedSignalCounts, requestKey, scanLibraryItems]);

  const fallbackCounts = useMemo(() => {
    if (!shouldFallback) return null;
    const counts: Record<FeedSignalMode, number> = {
      all: filterFeedItems(fallbackItems, baseFilter).length,
      inspiring: 0,
      events: 0,
      personal: 0,
      conversation: 0,
      news: 0,
    };
    for (const preset of SELECTABLE_PRESETS) {
      counts[preset.mode] = filterFeedItems(fallbackItems, {
        ...baseFilter,
        signals: [...preset.signals],
      }).length;
    }
    return Object.freeze(counts);
  }, [baseFilter, fallbackItems, shouldFallback]);

  if (!enabled) return EMPTY_FEED_SIGNAL_COUNTS;
  if (fallbackCounts) return fallbackCounts;
  return versioned?.requestKey === requestKey
    ? versioned.counts
    : (versioned?.counts ?? EMPTY_FEED_SIGNAL_COUNTS);
}
