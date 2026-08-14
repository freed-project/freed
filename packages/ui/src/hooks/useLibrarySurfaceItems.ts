import { useEffect, useMemo, useState } from "react";
import type { FeedItem } from "@freed/shared";
import {
  usePlatform,
  type LibrarySurface,
  type PlatformConfig,
} from "../context/PlatformContext.js";
import { useLegacyLibraryItems } from "./useLegacyLibraryItems.js";

type SurfaceReader = NonNullable<PlatformConfig["readLibrarySurfaceItems"]>;

interface CachedSurfaceItems {
  reader: SurfaceReader;
  sourceVersion: number;
  promise: Promise<FeedItem[]>;
  result: FeedItem[] | null;
}

interface VersionedSurfaceItems {
  sourceVersion: number;
  items: FeedItem[];
}

const surfaceCache = new Map<LibrarySurface, CachedSurfaceItems>();
const EMPTY_SURFACE_ITEMS: FeedItem[] = [];
Object.freeze(EMPTY_SURFACE_ITEMS);

function prepareSurfaceItems(
  reader: SurfaceReader,
  surface: LibrarySurface,
  sourceVersion: number,
): CachedSurfaceItems {
  const cached = surfaceCache.get(surface);
  if (cached?.reader === reader && cached.sourceVersion === sourceVersion) {
    return cached;
  }
  const entry: CachedSurfaceItems = {
    reader,
    sourceVersion,
    result: null,
    promise: Promise.resolve(null as never),
  };
  entry.promise = reader(surface).then((items) => {
    const result = [...items];
    entry.result = result;
    return result;
  });
  surfaceCache.set(surface, entry);
  return entry;
}

/** Return one bounded candidate set selected inside the platform row store. */
export function useLibrarySurfaceItems(
  surface: LibrarySurface,
  readFallbackItems: () => FeedItem[],
  sourceVersion: number,
): FeedItem[] {
  const { readLibrarySurfaceItems } = usePlatform();
  const [versionedItems, setVersionedItems] = useState<VersionedSurfaceItems | null>(() => {
    if (!readLibrarySurfaceItems) return null;
    const result = prepareSurfaceItems(
      readLibrarySurfaceItems,
      surface,
      sourceVersion,
    ).result;
    return result ? { sourceVersion, items: result } : null;
  });
  const [failedVersion, setFailedVersion] = useState<number | null>(null);
  const shouldFallback =
    !readLibrarySurfaceItems || failedVersion === sourceVersion;
  useLegacyLibraryItems(shouldFallback);
  const fallbackItems = useMemo(
    () => (shouldFallback ? readFallbackItems() : null),
    [readFallbackItems, shouldFallback],
  );

  useEffect(() => {
    let cancelled = false;
    if (!readLibrarySurfaceItems) {
      setVersionedItems(null);
      setFailedVersion(null);
      return () => {
        cancelled = true;
      };
    }

    setFailedVersion(null);
    const prepared = prepareSurfaceItems(
      readLibrarySurfaceItems,
      surface,
      sourceVersion,
    );
    if (prepared.result) {
      setVersionedItems({ sourceVersion, items: prepared.result });
    }
    prepared.promise
      .then((items) => {
        if (!cancelled) setVersionedItems({ sourceVersion, items });
      })
      .catch(() => {
        if (!cancelled) setFailedVersion(sourceVersion);
      });

    return () => {
      cancelled = true;
    };
  }, [readLibrarySurfaceItems, sourceVersion, surface]);

  if (fallbackItems) return fallbackItems;
  return versionedItems?.sourceVersion === sourceVersion
    ? versionedItems.items
    : versionedItems?.items ?? EMPTY_SURFACE_ITEMS;
}
