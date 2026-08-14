import { useEffect, useMemo, useState } from "react";
import { hasSampleDataFingerprint, type FeedItem } from "@freed/shared";
import {
  usePlatform,
  type LibraryFacetSummary,
  type PlatformConfig,
} from "../context/PlatformContext.js";
import { useLegacyLibraryItems } from "./useLegacyLibraryItems.js";

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
  summary: LibraryFacetSummary;
}

let facetCache: CachedFacetSummary | null = null;
const EMPTY_FACET_SUMMARY: LibraryFacetSummary = Object.freeze({
  archivedCount: 0,
  savedArchivedCount: 0,
  savedCount: 0,
  savedPlatformCount: 0,
  sampleItemCount: 0,
  tags: Object.freeze([]) as readonly string[],
  totalCount: 0,
});

function summarizeItems(items: readonly FeedItem[]): LibraryFacetSummary {
  let archivedCount = 0;
  let savedArchivedCount = 0;
  let savedCount = 0;
  let savedPlatformCount = 0;
  let sampleItemCount = 0;
  const tags = new Set<string>();
  for (const item of items) {
    if (item.userState.archived) archivedCount += 1;
    if (item.userState.saved) savedCount += 1;
    if (item.platform === "saved") savedPlatformCount += 1;
    if (hasSampleDataFingerprint(item)) sampleItemCount += 1;
    if (item.userState.saved && item.userState.archived) {
      savedArchivedCount += 1;
    }
    for (const tag of item.userState.tags) tags.add(tag);
  }
  return {
    archivedCount,
    savedArchivedCount,
    savedCount,
    savedPlatformCount,
    sampleItemCount,
    tags: Array.from(tags).sort(),
    totalCount: items.length,
  };
}

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
export function useLibraryFacetSummary(
  fallbackItems: FeedItem[],
  sourceVersion: number,
  enabled = true,
  allowLegacyFallback = true,
): LibraryFacetSummary {
  const { readLibraryFacetSummary } = usePlatform();
  const [versionedSummary, setVersionedSummary] = useState<VersionedFacetSummary | null>(() => {
    if (!enabled || !readLibraryFacetSummary) return null;
    const result = prepareFacetSummary(readLibraryFacetSummary, sourceVersion).result;
    return result ? { sourceVersion, summary: result } : null;
  });
  const [failedVersion, setFailedVersion] = useState<number | null>(null);
  const shouldFallback =
    enabled &&
    allowLegacyFallback &&
    (!readLibraryFacetSummary || failedVersion === sourceVersion);
  useLegacyLibraryItems(shouldFallback);
  const fallback = useMemo(
    () => (shouldFallback ? summarizeItems(fallbackItems) : null),
    [fallbackItems, shouldFallback],
  );

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !readLibraryFacetSummary) {
      setVersionedSummary(null);
      setFailedVersion(null);
      return () => {
        cancelled = true;
      };
    }

    setFailedVersion(null);
    const prepared = prepareFacetSummary(readLibraryFacetSummary, sourceVersion);
    if (prepared.result) {
      setVersionedSummary({ sourceVersion, summary: prepared.result });
    }
    prepared.promise
      .then((result) => {
        if (!cancelled) setVersionedSummary({ sourceVersion, summary: result });
      })
      .catch(() => {
        if (!cancelled) setFailedVersion(sourceVersion);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, readLibraryFacetSummary, sourceVersion]);

  if (!enabled) return EMPTY_FACET_SUMMARY;
  if (fallback) return fallback;
  return versionedSummary?.sourceVersion === sourceVersion
    ? versionedSummary.summary
    : versionedSummary?.summary ?? EMPTY_FACET_SUMMARY;
}
