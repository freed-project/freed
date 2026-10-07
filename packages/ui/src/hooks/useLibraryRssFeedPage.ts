import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RssFeed } from "@freed/shared";
import {
  encodeLibraryCoreIdentityPageCursorV1,
  libraryCoreRssFeedPageRowToRssFeedV1,
  type LibraryCoreRssFeedPageRowV1,
} from "@freed/shared/library-core";
import { usePlatform } from "../context/PlatformContext.js";

const RAW_PAGE_LIMIT = 128;

interface LoadedRssFeedPage {
  readonly reader?: ReturnType<typeof usePlatform>["queryLibraryCore"];
  readonly contextKey?: string;
  readonly sourceVersion?: number;
  readonly pageCursor?: string | null;
  readonly nextCursor: string | null;
  readonly rows: readonly LibraryCoreRssFeedPageRowV1[];
}

export interface LibraryRssFeedPageState {
  readonly error: string | null;
  readonly feeds: readonly RssFeed[];
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly loading: boolean;
  readonly pageNumber: number;
  readonly rows: readonly LibraryCoreRssFeedPageRowV1[];
  nextPage(): void;
  previousPage(): void;
}

function searchableText(row: LibraryCoreRssFeedPageRowV1): string {
  return [row.title, row.url, row.siteUrl ?? "", row.folder ?? ""]
    .join("\n")
    .toLocaleLowerCase();
}

function matches(
  row: LibraryCoreRssFeedPageRowV1,
  enabledOnly: boolean,
  includeUrls: ReadonlySet<string> | null,
  searchMatchUrls: ReadonlySet<string>,
  searchTerms: readonly string[],
): boolean {
  if (enabledOnly && !row.enabled) return false;
  if (includeUrls !== null && !includeUrls.has(row.url)) return false;
  if (searchTerms.length === 0) return true;
  if (searchMatchUrls.has(row.url)) return true;
  const candidate = searchableText(row);
  return searchTerms.every((term) => candidate.includes(term));
}

/**
 * Read one visible RSS subscription page from SQLite.
 *
 * Search and enabled filtering stream through bounded raw pages. React keeps
 * only the visible result rows plus opaque page-start cursors.
 */
export function useLibraryRssFeedPage({
  enabled = true,
  enabledOnly = false,
  includeUrls = null,
  pageSize,
  search = "",
  searchMatchUrls = new Set<string>(),
  sourceVersion,
}: {
  readonly enabled?: boolean;
  readonly enabledOnly?: boolean;
  readonly includeUrls?: ReadonlySet<string> | null;
  readonly pageSize: number;
  readonly search?: string;
  readonly searchMatchUrls?: ReadonlySet<string>;
  readonly sourceVersion: number;
}): LibraryRssFeedPageState {
  const { queryLibraryCore } = usePlatform();
  const boundedPageSize = Math.max(1, Math.min(RAW_PAGE_LIMIT, pageSize));
  const searchTerms = useMemo(
    () =>
      search
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    [search],
  );
  const includeUrlKey = includeUrls === null
    ? null
    : JSON.stringify([...includeUrls].sort());
  const stableIncludeUrls = useMemo<ReadonlySet<string> | null>(
    () => includeUrlKey === null
      ? null
      : new Set(JSON.parse(includeUrlKey) as string[]),
    [includeUrlKey],
  );
  const searchMatchUrlKey = JSON.stringify([...searchMatchUrls].sort());
  const stableSearchMatchUrls = useMemo<ReadonlySet<string>>(
    () => new Set(JSON.parse(searchMatchUrlKey) as string[]),
    [searchMatchUrlKey],
  );
  const queryKey = useMemo(
    () => JSON.stringify({
      enabled,
      enabledOnly,
      includeUrlKey,
      searchMatchUrlKey,
      searchTerms,
      sourceVersion,
    }),
    [
      enabled,
      enabledOnly,
      includeUrlKey,
      searchMatchUrlKey,
      searchTerms,
      sourceVersion,
    ],
  );
  const contextKey = JSON.stringify({ enabled, enabledOnly, includeUrlKey, searchMatchUrlKey, searchTerms, boundedPageSize });
  const [pageStartCursor, setPageStartCursor] = useState<string | null>(null);
  const [previousPageStarts, setPreviousPageStarts] = useState<
    readonly (string | null)[]
  >([]);
  const [page, setPage] = useState<LoadedRssFeedPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ reader: typeof queryLibraryCore; contextKey: string; version: number; message: string } | null>(null);
  const error = failure !== null && failure.reader === queryLibraryCore && failure.contextKey === contextKey && failure.version === sourceVersion ? failure.message : null;
  const attemptRef = useRef(0);

  const matchesContext = enabled && page !== null && page.reader === queryLibraryCore && page.contextKey === contextKey && (page.sourceVersion ?? Infinity) <= sourceVersion;
  const visiblePage = matchesContext ? page : null;
  const pageCurrent = matchesContext && page?.sourceVersion === sourceVersion;
  const latest = useRef({ pageCurrent, page, loading, queryLibraryCore });
  latest.current = { pageCurrent, page, loading, queryLibraryCore };

  useEffect(() => {
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    let cancelled = false;
    if (!enabled) {
      setPage(null);
      setLoading(false);
      setFailure(null);
      return () => {
        cancelled = true;
      };
    }
    if (!queryLibraryCore) {
      setPage(null);
      setLoading(false);
      setFailure({ reader: queryLibraryCore, contextKey, version: sourceVersion, message: "SQLite RSS Feed query is unavailable" });
      return () => {
        cancelled = true;
      };
    }
    if (pageCurrent && page?.pageCursor === pageStartCursor) return;
    setLoading(true);
    setFailure(null);
    const sameContext = matchesContext;
    const targetPage = sameContext ? previousPageStarts.length : 0;
    const refreshing = !pageCurrent;
    const readVisible = async (start: string | null): Promise<LoadedRssFeedPage> => {
      const rows: LibraryCoreRssFeedPageRowV1[] = [];
      let cursor = start;
      let nextCursor: string | null = null;
      for (;;) {
        const response = await queryLibraryCore({
          cancellationId: `rss-feed-page-cancel:${crypto.randomUUID()}`,
          cursor,
          limit: RAW_PAGE_LIMIT,
          queryId: "rss_feed_page_v1",
          readerSessionId: `rss-feed-page-reader:${crypto.randomUUID()}`,
          schemaVersion: 1,
        });
        for (let index = 0; index < response.rows.length; index += 1) {
          const row = response.rows[index]!;
          const consumedCursor = encodeLibraryCoreIdentityPageCursorV1({
            entityId: row.url,
            generationId: response.source.generationId,
            layoutRevision: response.layoutRevision,
            projectionRevision: response.source.projectionRevision,
            transitionSequence: response.source.transitionSequence,
          });
          if (
            matches(
              row,
              enabledOnly,
              stableIncludeUrls,
              stableSearchMatchUrls,
              searchTerms,
            )
          ) rows.push(row);
          if (rows.length === boundedPageSize) {
            nextCursor =
              index < response.rows.length - 1 || response.nextCursor !== null
                ? consumedCursor
                : null;
            return { nextCursor, rows: Object.freeze(rows) };
          }
          cursor = consumedCursor;
        }
        if (response.nextCursor === null) {
          return { nextCursor: null, rows: Object.freeze(rows) };
        }
        cursor = response.nextCursor;
      }
    };
    void (async () => {
      let cursor = refreshing ? null : pageStartCursor;
      const starts: (string | null)[] = [];
      for (let index = 0; ; index++) {
        const loaded = await readVisible(cursor);
        if (cancelled) return null;
        if (!refreshing || index >= targetPage || loaded.nextCursor === null) return { ...loaded, reader: queryLibraryCore, contextKey, sourceVersion, pageCursor: cursor, starts: refreshing ? starts : previousPageStarts };
        starts.push(cursor); cursor = loaded.nextCursor;
      }
    })()
      .then((loaded) => {
        if (cancelled || attemptRef.current !== attempt || !loaded) return;
        setPage(loaded);
        setPageStartCursor(loaded.pageCursor);
        setPreviousPageStarts(loaded.starts);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled || attemptRef.current !== attempt) return;
        setPage(null);
        setLoading(false);
        setFailure({ reader: queryLibraryCore, contextKey, version: sourceVersion, message: reason instanceof Error ? reason.message : String(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [
    boundedPageSize,
    contextKey,
    sourceVersion,
    enabled,
    enabledOnly,
    pageStartCursor,
    queryKey,
    queryLibraryCore,
    searchTerms,
    stableIncludeUrls,
    stableSearchMatchUrls,
  ]);

  const nextPage = useCallback(() => {
    if (!page?.nextCursor || loading || !latest.current.pageCurrent || latest.current.page !== page || latest.current.queryLibraryCore !== queryLibraryCore) return;
    setPreviousPageStarts((current) => [...current, pageStartCursor]);
    setPageStartCursor(page.nextCursor);
  }, [loading, page, pageStartCursor, queryLibraryCore]);

  const previousPage = useCallback(() => {
    if (previousPageStarts.length === 0 || loading || !latest.current.pageCurrent || latest.current.page !== page || latest.current.queryLibraryCore !== queryLibraryCore) return;
    const target = previousPageStarts.at(-1) ?? null;
    setPreviousPageStarts((current) => current.slice(0, -1));
    setPageStartCursor(target);
  }, [loading, previousPageStarts, page, queryLibraryCore]);

  const rows = visiblePage?.rows ?? [];
  return {
    error,
    feeds: rows.map(libraryCoreRssFeedPageRowToRssFeedV1),
    hasNext: pageCurrent && !loading && page?.nextCursor !== null && page?.nextCursor !== undefined,
    hasPrevious: pageCurrent && !loading && previousPageStarts.length > 0,
    loading: enabled && Boolean(queryLibraryCore) && ((!pageCurrent && error === null) || loading),
    nextPage,
    pageNumber: visiblePage ? previousPageStarts.length + 1 : 1,
    previousPage,
    rows,
  };
}
