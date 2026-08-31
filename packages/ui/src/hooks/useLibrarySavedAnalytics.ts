import { useEffect, useMemo, useState } from "react";
import {
  usePlatform,
  type LibrarySavedAnalytics,
  type LibrarySavedAnalyticsRequest,
  type PlatformConfig,
} from "../context/PlatformContext.js";
import {
  createLibrarySavedAnalyticsRequest,
  normalizeLibrarySavedAnalytics,
} from "../lib/saved-library-analytics.js";

type SavedAnalyticsReader = NonNullable<
  PlatformConfig["readLibrarySavedAnalytics"]
>;

interface CachedSavedAnalytics {
  reader: SavedAnalyticsReader;
  sourceVersion: number;
  requestKey: string;
  promise: Promise<LibrarySavedAnalytics>;
  result: LibrarySavedAnalytics | null;
}

interface VersionedSavedAnalytics {
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
  sourceVersion: number,
  request: LibrarySavedAnalyticsRequest,
  requestKey: string,
): CachedSavedAnalytics {
  if (
    analyticsCache?.reader === reader &&
    analyticsCache.sourceVersion === sourceVersion &&
    analyticsCache.requestKey === requestKey
  ) {
    return analyticsCache;
  }
  const entry: CachedSavedAnalytics = {
    reader,
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
  sourceVersion: number,
): LibrarySavedAnalyticsState {
  const { readLibrarySavedAnalytics } = usePlatform();
  const request = useMemo(
    () => createLibrarySavedAnalyticsRequest(),
    [sourceVersion],
  );
  const requestKey = useMemo(() => analyticsRequestKey(request), [request]);
  const [versionedAnalytics, setVersionedAnalytics] =
    useState<VersionedSavedAnalytics | null>(() => {
      if (!readLibrarySavedAnalytics) return null;
      const result = prepareSavedAnalytics(
        readLibrarySavedAnalytics,
        sourceVersion,
        request,
        requestKey,
      ).result;
      return result
        ? { sourceVersion, requestKey, analytics: result }
        : null;
    });
  const [failedKey, setFailedKey] = useState<string | null>(null);

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
      sourceVersion,
      request,
      requestKey,
    );
    setVersionedAnalytics(
      prepared.result
        ? {
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
  }, [readLibrarySavedAnalytics, request, requestKey, sourceVersion]);

  if (!readLibrarySavedAnalytics || failedKey === requestKey) {
    return { analytics: null, loading: false, request };
  }
  const current =
    versionedAnalytics?.sourceVersion === sourceVersion &&
    versionedAnalytics.requestKey === requestKey
      ? versionedAnalytics.analytics
      : null;
  return { analytics: current, loading: current === null, request };
}
