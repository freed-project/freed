import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_LIMIT,
  decodeLibraryCoreFriendsDirectoryCursorV1,
  encodeLibraryCoreFriendsDirectoryCursorV1,
  libraryCoreFriendsDirectoryBindingDigestV1,
  type LibraryCoreFeedPageSourceV1,
  type LibraryCoreFriendsDirectoryFilterV1,
  type LibraryCoreFriendsDirectoryPageRequestV1,
  type LibraryCoreFriendsDirectoryRowV1,
  type LibraryCoreFriendsDirectorySortV1,
} from "@freed/shared/library-core";

import { usePlatform } from "../context/PlatformContext.js";

const SEARCH_DEBOUNCE_MS = 150;

interface DirectoryState {
  readonly attemptKey: string;
  readonly baseRequest: LibraryCoreFriendsDirectoryPageRequestV1;
  readonly loadingPage: boolean;
  readonly nextCursor: string | null;
  readonly pageCursor: string | null;
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
  const [state, setState] = useState<DirectoryState | null>(null);

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
      setState({
        attemptKey,
        baseRequest: request,
        loadingPage: false,
        nextCursor: null,
        pageCursor: null,
        rows: [],
        source: null,
        status: "loading",
        totalCount: 0,
      });
      void queryLibraryCore(request)
        .then((response) => {
          if (cancelled) return;
          setState({
            attemptKey,
            baseRequest: request,
            loadingPage: false,
            nextCursor: response.nextCursor,
            pageCursor: null,
            rows: response.rows,
            source: response.source,
            status: "ready",
            totalCount: response.totalCount,
          });
        })
        .catch(() => {
          if (cancelled) return;
          setState({
            attemptKey,
            baseRequest: request,
            loadingPage: false,
            nextCursor: null,
            pageCursor: null,
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
  }, [attemptKey, limit, queryLibraryCore, search, sort, sortedFilters]);

  const readPage = useCallback(
    (cursor: string | null) => {
      if (
        !queryLibraryCore ||
        !state ||
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

  const current = state?.attemptKey === attemptKey ? state : null;
  const currentCursor = current?.pageCursor
    ? decodeLibraryCoreFriendsDirectoryCursorV1(current.pageCursor)
    : null;
  const currentOffset = currentCursor?.ok ? currentCursor.value.offset : 0;
  const previousCursor = useMemo(() => {
    if (!current?.source || currentOffset === 0) return null;
    const previousOffset = Math.max(0, currentOffset - limit);
    if (previousOffset === 0) return "";
    return encodeLibraryCoreFriendsDirectoryCursorV1({
      bindingDigest: libraryCoreFriendsDirectoryBindingDigestV1(
        current.baseRequest,
      ),
      generationId: current.source.generationId,
      offset: previousOffset,
      projectionRevision: current.source.projectionRevision,
      transitionSequence: current.source.transitionSequence,
    });
  }, [current, currentOffset, limit]);

  return {
    hasNext: current?.nextCursor !== null && current?.nextCursor !== undefined,
    hasPrevious: previousCursor !== null,
    loading: !current || current.status === "loading",
    loadingPage: current?.loadingPage ?? false,
    pageNumber: Math.floor(currentOffset / limit) + 1,
    rows: current?.rows ?? [],
    totalCount: current?.totalCount ?? 0,
    nextPage: () => {
      if (current?.nextCursor) readPage(current.nextCursor);
    },
    previousPage: () => {
      if (previousCursor !== null) readPage(previousCursor || null);
    },
  };
}
