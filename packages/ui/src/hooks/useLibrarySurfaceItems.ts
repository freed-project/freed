import { useEffect, useState } from "react";
import type { FeedItem, LibraryMapLocationCandidate } from "@freed/shared";
import {
  usePlatform,
  type LibrarySurface,
  type PlatformConfig,
} from "../context/PlatformContext.js";

type SurfaceReader = NonNullable<PlatformConfig["readLibrarySurfaceItems"]>;
type MapReader = NonNullable<PlatformConfig["readLibraryMapCandidates"]>;

interface CachedRows<Row, Reader> {
  reader: Reader;
  sourceVersion: number;
  promise: Promise<Row[]>;
  result: Row[] | null;
}

interface VersionedRows<Row> {
  sourceVersion: number;
  rows: Row[];
}

const surfaceCache = new Map<
  LibrarySurface,
  CachedRows<FeedItem, SurfaceReader>
>();
const mapCandidatesCache = new Map<
  "map",
  CachedRows<LibraryMapLocationCandidate, MapReader>
>();
const EMPTY_SURFACE_ITEMS: FeedItem[] = [];
Object.freeze(EMPTY_SURFACE_ITEMS);
const EMPTY_MAP_CANDIDATES: LibraryMapLocationCandidate[] = [];
Object.freeze(EMPTY_MAP_CANDIDATES);

function prepareRows<Row, Reader, Key>(
  cache: Map<Key, CachedRows<Row, Reader>>,
  key: Key,
  reader: Reader,
  sourceVersion: number,
  load: (reader: Reader, key: Key) => Promise<readonly Row[]>,
): CachedRows<Row, Reader> {
  const cached = cache.get(key);
  if (cached?.reader === reader && cached.sourceVersion === sourceVersion) {
    return cached;
  }
  const entry: CachedRows<Row, Reader> = {
    reader,
    sourceVersion,
    result: null,
    promise: Promise.resolve(null as never),
  };
  entry.promise = load(reader, key).then((rows) => {
    const result = [...rows];
    entry.result = result;
    return result;
  });
  cache.set(key, entry);
  return entry;
}

function useVersionedRows<Row, Reader, Key>(
  cache: Map<Key, CachedRows<Row, Reader>>,
  key: Key,
  reader: Reader | undefined,
  sourceVersion: number,
  load: (reader: Reader, key: Key) => Promise<readonly Row[]>,
  emptyRows: readonly Row[],
): readonly Row[] {
  const [versionedRows, setVersionedRows] = useState<VersionedRows<Row> | null>(() => {
    if (!reader) return null;
    const result = prepareRows(
      cache,
      key,
      reader,
      sourceVersion,
      load,
    ).result;
    return result ? { sourceVersion, rows: result } : null;
  });
  const [failedVersion, setFailedVersion] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!reader) {
      setVersionedRows(null);
      setFailedVersion(null);
      return () => {
        cancelled = true;
      };
    }

    setFailedVersion(null);
    const prepared = prepareRows(
      cache,
      key,
      reader,
      sourceVersion,
      load,
    );
    if (prepared.result) {
      setVersionedRows({ sourceVersion, rows: prepared.result });
    }
    prepared.promise
      .then((rows) => {
        if (!cancelled) setVersionedRows({ sourceVersion, rows });
      })
      .catch(() => {
        if (!cancelled) setFailedVersion(sourceVersion);
      });

    return () => {
      cancelled = true;
    };
  }, [cache, key, load, reader, sourceVersion]);

  if (!reader || failedVersion === sourceVersion) {
    return emptyRows;
  }
  return versionedRows?.sourceVersion === sourceVersion
    ? versionedRows.rows
    : emptyRows;
}

function loadSurfaceItems(
  reader: SurfaceReader,
  surface: LibrarySurface,
): Promise<readonly FeedItem[]> {
  return reader(surface);
}

function loadMapCandidates(
  reader: MapReader,
): Promise<readonly LibraryMapLocationCandidate[]> {
  return reader();
}

/** Return one bounded Story Wall set selected inside SQLite. */
export function useLibrarySurfaceItems(
  surface: LibrarySurface,
  sourceVersion: number,
): readonly FeedItem[] {
  const { readLibrarySurfaceItems } = usePlatform();
  return useVersionedRows(
    surfaceCache,
    surface,
    readLibrarySurfaceItems,
    sourceVersion,
    loadSurfaceItems,
    EMPTY_SURFACE_ITEMS,
  );
}

/** Retain one bounded SQLite-selected Map candidate window in React. */
export function useLibraryMapCandidates(
  sourceVersion: number,
): readonly LibraryMapLocationCandidate[] {
  const { readLibraryMapCandidates } = usePlatform();
  return useVersionedRows(
    mapCandidatesCache,
    "map",
    readLibraryMapCandidates,
    sourceVersion,
    loadMapCandidates,
    EMPTY_MAP_CANDIDATES,
  );
}
