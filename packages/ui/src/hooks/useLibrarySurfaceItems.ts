import { useEffect, useState } from "react";
import type {
  LibraryMapLocationCandidate,
  StoryWallCandidate,
} from "@freed/shared";
import {
  usePlatform,
  type PlatformConfig,
} from "../context/PlatformContext.js";

type StoryWallReader = NonNullable<
  PlatformConfig["readLibraryStoryWallCandidates"]
>;
type MapReader = NonNullable<PlatformConfig["readLibraryMapCandidates"]>;

interface CachedRows<Row, Reader> {
  reader: Reader;
  sourceVersion: number;
  promise: Promise<Row[]>;
  result: Row[] | null;
}

interface VersionedRows<Row, Reader> {
  reader: Reader;
  sourceVersion: number;
  rows: Row[];
}

const storyWallCache = new Map<
  "story_wall",
  CachedRows<StoryWallCandidate, StoryWallReader>
>();
const mapCandidatesCache = new Map<
  "map",
  CachedRows<LibraryMapLocationCandidate, MapReader>
>();
const EMPTY_STORY_WALL_CANDIDATES: StoryWallCandidate[] = [];
Object.freeze(EMPTY_STORY_WALL_CANDIDATES);
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
  const [versionedRows, setVersionedRows] = useState<VersionedRows<Row, Reader> | null>(
    () => {
      if (!reader) return null;
      const result = prepareRows(
        cache,
        key,
        reader,
        sourceVersion,
        load,
      ).result;
      return result ? { reader, sourceVersion, rows: result } : null;
    },
  );
  const [failedVersion, setFailedVersion] = useState<{ reader: Reader; sourceVersion: number } | null>(null);

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
    const prepared = prepareRows(cache, key, reader, sourceVersion, load);
    if (prepared.result) {
      setVersionedRows({ reader, sourceVersion, rows: prepared.result });
    }
    prepared.promise
      .then((rows) => {
        if (!cancelled) setVersionedRows({ reader, sourceVersion, rows });
      })
      .catch(() => {
        if (!cancelled) { setVersionedRows(null); setFailedVersion({ reader, sourceVersion }); }
      });

    return () => {
      cancelled = true;
    };
  }, [cache, key, load, reader, sourceVersion]);

  if (!reader || (failedVersion?.reader === reader && failedVersion.sourceVersion === sourceVersion)) {
    return emptyRows;
  }
  return versionedRows?.reader === reader && versionedRows.sourceVersion <= sourceVersion
    ? versionedRows.rows : emptyRows;
}

function loadStoryWallCandidates(
  reader: StoryWallReader,
): Promise<readonly StoryWallCandidate[]> {
  return reader();
}

function loadMapCandidates(
  reader: MapReader,
): Promise<readonly LibraryMapLocationCandidate[]> {
  return reader();
}

/** Return one bounded Story Wall set selected inside SQLite. */
export function useLibraryStoryWallCandidates(
  sourceVersion: number,
): readonly StoryWallCandidate[] {
  const { readLibraryStoryWallCandidates } = usePlatform();
  return useVersionedRows(
    storyWallCache,
    "story_wall",
    readLibraryStoryWallCandidates,
    sourceVersion,
    loadStoryWallCandidates,
    EMPTY_STORY_WALL_CANDIDATES,
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
