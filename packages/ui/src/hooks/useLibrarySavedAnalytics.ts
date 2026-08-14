import { useEffect, useMemo, useState } from "react";
import type { FeedItem } from "@freed/shared";
import {
  usePlatform,
  type LibrarySavedAnalytics,
  type LibrarySavedAnalyticsRequest,
  type PlatformConfig,
} from "../context/PlatformContext.js";
import {
  createLibrarySavedAnalyticsRequest,
  normalizeLibrarySavedAnalytics,
  summarizeLibrarySavedItems,
} from "../lib/saved-library-analytics.js";
import { useLegacyLibraryItems } from "./useLegacyLibraryItems.js";

type SavedAnalyticsReader = NonNullable<
  PlatformConfig["readLibrarySavedAnalytics"]
>;

interface CachedSavedAnalytics {
  reader: SavedAnalyticsReader;
  itemStateToken: object;
  sourceVersion: number;
  requestKey: string;
  promise: Promise<LibrarySavedAnalytics>;
  result: LibrarySavedAnalytics | null;
}

interface VersionedSavedAnalytics {
  itemStateToken: object;
  sourceVersion: number;
  requestKey: string;
  analytics: LibrarySavedAnalytics;
}

export interface LibrarySavedAnalyticsState {
  readonly analytics: LibrarySavedAnalytics | null;
  readonly loading: boolean;
  readonly request: LibrarySavedAnalyticsRequest;
}

let analyticsCache: CachedSavedAnalytics | null = null;

function analyticsRequestKey(request: LibrarySavedAnalyticsRequest): string {
  return [...request.dailyWindows, ...request.hourlyWindows]
    .map(({ startMs, endMs }) => `${startMs}:${endMs}`)
    .join("|");
}

function prepareSavedAnalytics(
  reader: SavedAnalyticsReader,
  itemStateToken: object,
  sourceVersion: number,
  request: LibrarySavedAnalyticsRequest,
  requestKey: string,
): CachedSavedAnalytics {
  if (
    analyticsCache?.reader === reader &&
    analyticsCache.itemStateToken === itemStateToken &&
    analyticsCache.sourceVersion === sourceVersion &&
    analyticsCache.requestKey === requestKey
  ) {
    return analyticsCache;
  }
  const entry: CachedSavedAnalytics = {
    reader,
    itemStateToken,
    sourceVersion,
    requestKey,
    result: null,
    promise: Promise.resolve(null as never),
  };
  entry.promise = reader(request).then((result) => {
    const normalized = normalizeLibrarySavedAnalytics(result);
    entry.result = normalized;
    return normalized;
  });
  analyticsCache = entry;
  return entry;
}

/** Read exact Saved overview aggregates without retaining the Library corpus. */
export function useLibrarySavedAnalytics(
  fallbackItems: readonly FeedItem[],
  sourceVersion: number,
): LibrarySavedAnalyticsState {
  const { readLibrarySavedAnalytics } = usePlatform();
  const request = useMemo(
    () => createLibrarySavedAnalyticsRequest(),
    [sourceVersion],
  );
  const requestKey = useMemo(() => analyticsRequestKey(request), [request]);
  const itemStateToken = useMemo(() => ({}), [fallbackItems]);
  const [versionedAnalytics, setVersionedAnalytics] =
    useState<VersionedSavedAnalytics | null>(() => {
      if (!readLibrarySavedAnalytics) return null;
      const result = prepareSavedAnalytics(
        readLibrarySavedAnalytics,
        itemStateToken,
        sourceVersion,
        request,
        requestKey,
      ).result;
      return result
        ? { itemStateToken, sourceVersion, requestKey, analytics: result }
        : null;
    });
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const shouldFallback =
    !readLibrarySavedAnalytics || failedKey === requestKey;
  const legacyItemsReady = useLegacyLibraryItems(shouldFallback);
  const fallback = useMemo(
    () =>
      shouldFallback && legacyItemsReady
        ? summarizeLibrarySavedItems(fallbackItems, request)
        : null,
    [fallbackItems, legacyItemsReady, request, shouldFallback],
  );

  useEffect(() => {
    let cancelled = false;
    if (!readLibrarySavedAnalytics) {
      setVersionedAnalytics(null);
      setFailedKey(null);
      return () => {
        cancelled = true;
      };
    }

    const prepared = prepareSavedAnalytics(
      readLibrarySavedAnalytics,
      itemStateToken,
      sourceVersion,
      request,
      requestKey,
    );
    setVersionedAnalytics(
      prepared.result
        ? {
            itemStateToken,
            sourceVersion,
            requestKey,
            analytics: prepared.result,
          }
        : null,
    );
    prepared.promise
      .then((analytics) => {
        if (!cancelled) {
          setFailedKey(null);
          setVersionedAnalytics({
            itemStateToken,
            sourceVersion,
            requestKey,
            analytics,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setFailedKey(requestKey);
      });

    return () => {
      cancelled = true;
    };
  }, [itemStateToken, readLibrarySavedAnalytics, request, requestKey, sourceVersion]);

  if (fallback) return { analytics: fallback, loading: false, request };
  const current =
    versionedAnalytics?.itemStateToken === itemStateToken &&
    versionedAnalytics.sourceVersion === sourceVersion &&
    versionedAnalytics.requestKey === requestKey
      ? versionedAnalytics.analytics
      : null;
  return { analytics: current, loading: current === null, request };
}
