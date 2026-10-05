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
  reader: SavedAnalyticsReader;
  sourceVersion: number;
  requestKey: string;
  analytics: LibrarySavedAnalytics;
}

export interface LibrarySavedAnalyticsState {
  readonly analytics: LibrarySavedAnalytics | null;
  readonly loading: boolean;
  readonly status: "loading" | "refreshing" | "ready" | "failed" | "unavailable";
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
        ? { reader: readLibrarySavedAnalytics, sourceVersion, requestKey, analytics: result }
        : null;
    });
  const [failedKey, setFailedKey] = useState<{ reader: SavedAnalyticsReader; sourceVersion: number; requestKey: string } | null>(null);

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
    setFailedKey(null);
    setVersionedAnalytics(previous =>
      prepared.result
        ? {
            reader: readLibrarySavedAnalytics,
            sourceVersion,
            requestKey,
            analytics: prepared.result,
          }
        : previous?.reader === readLibrarySavedAnalytics && previous.requestKey === requestKey && previous.sourceVersion <= sourceVersion ? previous : null,
    );
    prepared.promise
      .then((analytics) => {
        if (!cancelled) {
          setFailedKey(null);
          setVersionedAnalytics({
            reader: readLibrarySavedAnalytics,
            sourceVersion,
            requestKey,
            analytics,
          });
        }
      })
      .catch(() => {
        if (!cancelled) { setVersionedAnalytics(null); setFailedKey({ reader: readLibrarySavedAnalytics, sourceVersion, requestKey }); }
      });

    return () => {
      cancelled = true;
    };
  }, [readLibrarySavedAnalytics, request, requestKey, sourceVersion]);

  const failed = failedKey !== null && failedKey.reader === readLibrarySavedAnalytics && failedKey.sourceVersion === sourceVersion && failedKey.requestKey === requestKey;
  const retained = versionedAnalytics !== null && versionedAnalytics.reader === readLibrarySavedAnalytics && versionedAnalytics.requestKey === requestKey && versionedAnalytics.sourceVersion <= sourceVersion
    ? versionedAnalytics : null;
  const status = !readLibrarySavedAnalytics ? "unavailable" : failed ? "failed" : retained?.sourceVersion === sourceVersion ? "ready" : retained ? "refreshing" : "loading";
  return { analytics: failed ? null : retained?.analytics ?? null, loading: status === "loading", status, request };
}
