import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_LIMIT,
  type LibraryCoreFeedPageSourceV1,
  type LibraryCoreFriendsDirectoryFilterV1,
  type LibraryCoreFriendsDirectoryPageRequestV1,
  type LibraryCoreFriendsDirectoryRowV1,
  type LibraryCoreFriendsDirectoryPageResponseV1,
  type LibraryCoreFriendsDirectorySortV1,
} from "@freed/shared/library-core";

import { usePlatform } from "../context/PlatformContext.js";

const SEARCH_DEBOUNCE_MS = 150;

interface DirectoryState {
  readonly attemptKey: string;
  readonly reader: ReturnType<typeof usePlatform>["queryLibraryCore"];
  readonly contextKey: string;
  readonly version: number;
  readonly baseRequest: LibraryCoreFriendsDirectoryPageRequestV1;
  readonly loadingPage: boolean;
  readonly nextCursor: string | null;
  readonly pageCursor: string | null;
  readonly previousPageStarts: readonly (string | null)[];
  readonly rows: readonly LibraryCoreFriendsDirectoryRowV1[];
  readonly source: LibraryCoreFeedPageSourceV1 | null;
  readonly status: "loading" | "ready" | "failed";
  readonly totalCount: number;
}

export interface LibraryFriendsDirectoryState {
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly loading: boolean;
  readonly loadingPage: boolean;
  readonly pageNumber: number;
  readonly rows: readonly LibraryCoreFriendsDirectoryRowV1[];
  readonly totalCount: number;
  nextPage(): void;
  previousPage(): void;
}

function operationId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

/** Retain one visible SQLite page for the Friends directory. */
export function useLibraryFriendsDirectory({
  filters,
  search,
  sort,
  sourceVersion,
  limit = LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_LIMIT,
}: {
  readonly filters: readonly LibraryCoreFriendsDirectoryFilterV1[];
  readonly search: string;
  readonly sort: LibraryCoreFriendsDirectorySortV1;
  readonly sourceVersion: number;
  readonly limit?: number;
}): LibraryFriendsDirectoryState {
  const { queryLibraryCore } = usePlatform();
  const readerSessionId = useRef(operationId("friends-directory-reader"));
  const filterKey = [...filters].sort().join("\u0000");
  const sortedFilters = useMemo(
    () =>
      Object.freeze(
        filterKey === ""
          ? []
          : (filterKey.split(
              "\u0000",
            ) as LibraryCoreFriendsDirectoryFilterV1[]),
      ),
    [filterKey],
  );
  const attemptKey = useMemo(
    () => JSON.stringify([sourceVersion, sortedFilters, search, sort, limit]),
    [limit, search, sort, sortedFilters, sourceVersion],
  );
  const contextKey = JSON.stringify([sortedFilters, search, sort, limit]);
  const [state, setState] = useState<DirectoryState | null>(null);

  const retained = state !== null && state.reader === queryLibraryCore && state.contextKey === contextKey && state.version <= sourceVersion ? state : null;
  const latest = useRef({ attemptKey, reader: queryLibraryCore });
  latest.current = { attemptKey, reader: queryLibraryCore };
  const snapshot = useRef(retained); snapshot.current = retained;

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!queryLibraryCore) {
        setState(null);
        return;
      }
      const request: LibraryCoreFriendsDirectoryPageRequestV1 = {
        cancellationId: operationId("friends-directory-query"),
        cursor: null,
        filters: sortedFilters,
        limit,
        nowMs: Date.now(),
        queryId: "friends_directory_page_v1",
        readerSessionId: readerSessionId.current,
        schemaVersion: 1,
        search,
        sort,
      };
      const prior = snapshot.current;
      const targetPage = prior?.previousPageStarts.length ?? 0;
      const provenance = { attemptKey, reader: queryLibraryCore, contextKey, version: sourceVersion };
      if (!prior) setState({ ...provenance, baseRequest: request, loadingPage: false, nextCursor: null, pageCursor: null, previousPageStarts: [], rows: [], source: null, status: "loading", totalCount: 0 });
      void (async () => {
        let cursor: string | null = null;
        const starts: (string | null)[] = [];
        for (let index = 0; ; index++) {
          const response: LibraryCoreFriendsDirectoryPageResponseV1 = await queryLibraryCore({ ...request, cursor });
          if (cancelled) return;
          if (index >= targetPage || response.nextCursor === null) {
            setState({ ...provenance, baseRequest: request, loadingPage: false, nextCursor: response.nextCursor, pageCursor: cursor, previousPageStarts: starts, rows: response.rows, source: response.source, status: "ready", totalCount: response.totalCount });
            return;
          }
          starts.push(cursor); cursor = response.nextCursor;
        }
      })()
        .catch(() => {
          if (cancelled) return;
          setState({
            ...provenance,
            baseRequest: request,
            loadingPage: false,
            nextCursor: null,
            pageCursor: null,
            previousPageStarts: [],
            rows: [],
            source: null,
            status: "failed",
            totalCount: 0,
          });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [attemptKey, limit, queryLibraryCore, search, sort, sortedFilters, contextKey, sourceVersion]);

  const readPage = useCallback(
    (cursor: string | null, previousPageStarts: readonly (string | null)[]) => {
      if (
        !queryLibraryCore ||
        !state ||
        latest.current.reader !== queryLibraryCore ||
        latest.current.attemptKey !== attemptKey ||
        state.reader !== queryLibraryCore ||
        state.attemptKey !== attemptKey ||
        state.status !== "ready" ||
        state.loadingPage ||
        cursor === state.pageCursor
      ) {
        return;
      }
      const pageCursor = state.pageCursor;
      const source = state.source;
      setState({ ...state, loadingPage: true });
      void queryLibraryCore({ ...state.baseRequest, cursor })
        .then((response) => {
          setState((current) => {
            if (
              !current ||
              latest.current.reader !== queryLibraryCore ||
              latest.current.attemptKey !== attemptKey ||
              current.attemptKey !== attemptKey ||
              current.pageCursor !== pageCursor ||
              current.source !== source
            ) {
              return current;
            }
            return {
              ...current,
              loadingPage: false,
              nextCursor: response.nextCursor,
              pageCursor: cursor,
              previousPageStarts,
              rows: response.rows,
              source: response.source,
              totalCount: response.totalCount,
            };
          });
        })
        .catch(() => {
          setState((current) =>
            current?.attemptKey === attemptKey
              ? { ...current, loadingPage: false }
              : current,
          );
        });
    },
    [attemptKey, queryLibraryCore, state],
  );

  const current = retained;
  const ready = current?.attemptKey === attemptKey && current.status === "ready" && !current.loadingPage;
  const previousPageStarts = current?.previousPageStarts ?? [];

  return {
    hasNext: ready && current?.nextCursor !== null && current?.nextCursor !== undefined,
    hasPrevious: ready && previousPageStarts.length > 0,
    loading: !current || current.status === "loading",
    loadingPage: Boolean(current && (current.attemptKey !== attemptKey || current.loadingPage)),
    pageNumber: previousPageStarts.length + 1,
    rows: current?.rows ?? [],
    totalCount: current?.totalCount ?? 0,
    nextPage: () => {
      if (ready && current?.nextCursor) {
        readPage(current.nextCursor, [
          ...current.previousPageStarts,
          current.pageCursor,
        ]);
      }
    },
    previousPage: () => {
      if (ready && previousPageStarts.length > 0) {
        readPage(
          previousPageStarts.at(-1) ?? null,
          previousPageStarts.slice(0, -1),
        );
      }
    },
  };
}
