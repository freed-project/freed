import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LibraryCoreRssItemSummaryResponseV1 } from "@freed/shared/library-core";
import {
  usePlatform,
  type LibraryFacetSummary,
  type PlatformConfig,
} from "../context/PlatformContext.js";

export type { LibraryFacetSummary } from "../context/PlatformContext.js";

type FacetReader = NonNullable<PlatformConfig["readLibraryFacetSummary"]>;

interface CachedFacetSummary {
  reader: FacetReader;
  sourceVersion: number;
  promise: Promise<LibraryFacetSummary>;
  result: LibraryFacetSummary | null;
}

interface VersionedFacetSummary {
  sourceVersion: number;
  reader: FacetReader;
  summary: LibraryFacetSummary;
}

let facetCache: CachedFacetSummary | null = null;

export type LibrarySummaryStatus = "unavailable" | "loading" | "refreshing" | "ready" | "error";

/** Count RSS-backed items without losing their original provider attribution. */
export function useLibraryRssItemSummaryState(sourceVersion: number, enabled = true) {
  const { queryLibraryCore } = usePlatform();
  const [result, setResult] = useState<{ version: number; reader: typeof queryLibraryCore; summary: LibraryCoreRssItemSummaryResponseV1 } | null>(null);
  const [failure, setFailure] = useState<{ version: number; reader: typeof queryLibraryCore } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFailure(null);
    if (!enabled || !queryLibraryCore) {
      setResult(null);
      return;
    }
    setResult(current => current?.reader === queryLibraryCore && current.version <= sourceVersion ? current : null);
    void queryLibraryCore({ queryId: "rss_item_summary_v1", schemaVersion: 1 })
      .then(summary => { if (!cancelled) setResult({ version: sourceVersion, reader: queryLibraryCore, summary }); })
      .catch(() => { if (!cancelled) setFailure({ version: sourceVersion, reader: queryLibraryCore }); });
    return () => { cancelled = true; };
  }, [enabled, queryLibraryCore, sourceVersion]);
  const summary = enabled && queryLibraryCore && result?.reader === queryLibraryCore && result.version <= sourceVersion ? result.summary : null;
  const status: LibrarySummaryStatus = !enabled || !queryLibraryCore ? "unavailable"
    : failure?.reader === queryLibraryCore && failure.version === sourceVersion ? "error"
    : summary && result?.version === sourceVersion ? "ready"
    : summary ? "refreshing" : "loading";
  return { summary: status === "error" ? null : summary, status };
}

export function useLibraryRssItemSummary(sourceVersion: number): LibraryCoreRssItemSummaryResponseV1 | null {
  const state = useLibraryRssItemSummaryState(sourceVersion);
  return state.status === "ready" ? state.summary : null;
}
const EMPTY_FACET_SUMMARY: LibraryFacetSummary = Object.freeze({
  archivedCount: 0,
  archivableCount: 0,
  contactAccountCount: 0,
  contactLinkedPersonCount: 0,
  enabledRssFeedCount: 0,
  friendPersonCount: 0,
  latestContactImportedAt: null,
  latestRssFeedFetchedAt: null,
  platformCounts: Object.freeze([]),
  rssFeedCount: 0,
  sampleAccountCount: 0,
  sampleFeedCount: 0,
  savedArchivedCount: 0,
  savedCount: 0,
  savedPlatformCount: 0,
  socialAccountCount: 0,
  sampleItemCount: 0,
  samplePersonCount: 0,
  tags: Object.freeze([]) as readonly string[],
  totalCount: 0,
  unreadCount: 0,
});

function prepareFacetSummary(
  reader: FacetReader,
  sourceVersion: number,
): CachedFacetSummary {
  if (
    facetCache?.reader === reader &&
    facetCache.sourceVersion === sourceVersion
  ) {
    return facetCache;
  }
  const entry: CachedFacetSummary = {
    reader,
    sourceVersion,
    result: null,
    promise: Promise.resolve(null as never),
  };
  entry.promise = reader().then((result) => {
    entry.result = result;
    return result;
  });
  facetCache = entry;
  return entry;
}

/** Return exact Library counts and tags without retaining row identities or bodies. */
export function useLibraryFacetSummaryState(
  sourceVersion: number,
  enabled = true,
) {
  const { readLibraryFacetSummary } = usePlatform();
  const [versionedSummary, setVersionedSummary] = useState<VersionedFacetSummary | null>(() => {
    if (!enabled || !readLibraryFacetSummary) return null;
    const result = prepareFacetSummary(readLibraryFacetSummary, sourceVersion).result;
    return result ? { sourceVersion, reader: readLibraryFacetSummary, summary: result } : null;
  });
  const [failure, setFailure] = useState<{ sourceVersion: number; reader: FacetReader } | null>(null);
  const needsFreshRead = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !readLibraryFacetSummary) {
      setVersionedSummary(null);
      needsFreshRead.current = true;
      setFailure(null);
      return () => {
        cancelled = true;
      };
    }

    setFailure(null);
    setVersionedSummary(current => current?.reader === readLibraryFacetSummary && current.sourceVersion <= sourceVersion ? current : null);
    if (needsFreshRead.current) {
      facetCache = null;
      needsFreshRead.current = false;
    }
    const prepared = prepareFacetSummary(readLibraryFacetSummary, sourceVersion);
    if (prepared.result) {
      setVersionedSummary({ sourceVersion, reader: readLibraryFacetSummary, summary: prepared.result });
    }
    prepared.promise
      .then((result) => {
        if (!cancelled) setVersionedSummary({ sourceVersion, reader: readLibraryFacetSummary, summary: result });
      })
      .catch(() => {
        if (!cancelled) setFailure({ sourceVersion, reader: readLibraryFacetSummary });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, readLibraryFacetSummary, sourceVersion]);

  const available = enabled && !!readLibraryFacetSummary;
  const retained = available && versionedSummary?.reader === readLibraryFacetSummary
    && versionedSummary.sourceVersion <= sourceVersion ? versionedSummary : null;
  const status: LibrarySummaryStatus = !available ? "unavailable"
    : failure?.reader === readLibraryFacetSummary && failure.sourceVersion === sourceVersion ? "error"
    : retained?.sourceVersion === sourceVersion ? "ready"
    : retained ? "refreshing" : "loading";
  return { summary: status === "error" ? EMPTY_FACET_SUMMARY : retained?.summary ?? EMPTY_FACET_SUMMARY, status };
}

/** Current-version accessor; callers may use these counts to enable actions. */
export function useLibraryFacetSummary(sourceVersion: number, enabled = true): LibraryFacetSummary {
  const state = useLibraryFacetSummaryState(sourceVersion, enabled);
  return state.status === "ready" ? state.summary : EMPTY_FACET_SUMMARY;
}

const EMPTY_NAVIGATION_RESOURCE = Object.freeze({ status: "unavailable" as const, committed: null, activation: 0, attempts: 0, error: null });
const noSubscription = () => () => {};
const emptyResourceSnapshot = () => EMPTY_NAVIGATION_RESOURCE;

/** Desktop consumes one published snapshot; platforms without it retain their query API. */
export function useLibraryNavigationCounts(sourceVersion: number) {
  const { libraryCountResource } = usePlatform();
  const resource = useSyncExternalStore(libraryCountResource?.subscribe ?? noSubscription,
    libraryCountResource?.getSnapshot ?? emptyResourceSnapshot,
    libraryCountResource?.getSnapshot ?? emptyResourceSnapshot);
  const facets = useLibraryFacetSummaryState(sourceVersion, !libraryCountResource);
  const rss = useLibraryRssItemSummaryState(sourceVersion, !libraryCountResource);
  if (!libraryCountResource) return { facets, rss };
  return {
    facets: { summary: resource.committed?.facets ?? EMPTY_FACET_SUMMARY, status: resource.status },
    rss: { summary: resource.committed?.rss ?? null, status: resource.status },
  };
}
