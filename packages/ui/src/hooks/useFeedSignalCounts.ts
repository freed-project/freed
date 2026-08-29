import { useEffect, useMemo, useState } from "react";
import type {
  FeedSignalMode,
  LibraryCoreFeedBrowseFilterInputV1,
} from "@freed/shared";
import {
  usePlatform,
  type ReadFeedSignalCounts,
} from "../context/PlatformContext.js";

export type FeedSignalCounts = Readonly<Record<FeedSignalMode, number>>;

const EMPTY_FEED_SIGNAL_COUNTS: FeedSignalCounts = Object.freeze({
  all: 0,
  inspiring: 0,
  events: 0,
  personal: 0,
  conversation: 0,
  news: 0,
});

interface CachedSignalCounts {
  reader: ReadFeedSignalCounts;
  requestKey: string;
  promise: Promise<FeedSignalCounts>;
  result: FeedSignalCounts | null;
}

interface VersionedSignalCounts {
  requestKey: string;
  counts: FeedSignalCounts;
}

let signalCountCache: CachedSignalCounts | null = null;

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
 * counting from the store array silently reports zero for every chip. The
 * platform-local aggregate reader is the only authority for these counts.
 */
export function useFeedSignalCounts(
  baseFilter: LibraryCoreFeedBrowseFilterInputV1,
  sourceVersion: number,
  /**
   * Hold every read until the library has loaded. The bounded scanner pins the
   * projection source, and asking for it before Library persistence is ready
   * makes the worker log a startup error.
   */
  enabled: boolean,
): FeedSignalCounts {
  const { readFeedSignalCounts } = usePlatform();
  const requestKey = useMemo(
    () => JSON.stringify([sourceVersion, baseFilter]),
    [baseFilter, sourceVersion],
  );
  const [versioned, setVersioned] = useState<VersionedSignalCounts | null>(
    () => {
      if (!readFeedSignalCounts) return null;
      const cached =
        signalCountCache?.reader === readFeedSignalCounts &&
        signalCountCache.requestKey === requestKey
          ? signalCountCache.result
          : null;
      return cached ? { requestKey, counts: cached } : null;
    },
  );
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !readFeedSignalCounts) {
      setVersioned(null);
      setFailedKey(null);
      return () => {
        cancelled = true;
      };
    }

    setFailedKey(null);
    const prepared = prepareNativeSignalCounts(
      readFeedSignalCounts,
      requestKey,
      baseFilter,
    );
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
  }, [enabled, readFeedSignalCounts, requestKey]);

  if (!enabled) return EMPTY_FEED_SIGNAL_COUNTS;
  if (!readFeedSignalCounts || failedKey === requestKey) {
    return EMPTY_FEED_SIGNAL_COUNTS;
  }
  return versioned?.requestKey === requestKey
    ? versioned.counts
    : EMPTY_FEED_SIGNAL_COUNTS;
}
