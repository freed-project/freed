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
  searchTerms: readonly string[],
): boolean {
  if (enabledOnly && !row.enabled) return false;
  if (includeUrls !== null && !includeUrls.has(row.url)) return false;
  if (searchTerms.length === 0) return true;
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
  sourceVersion,
}: {
  readonly enabled?: boolean;
  readonly enabledOnly?: boolean;
  readonly includeUrls?: ReadonlySet<string> | null;
  readonly pageSize: number;
  readonly search?: string;
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
  const queryKey = useMemo(
    () => JSON.stringify({
      enabled,
      enabledOnly,
      includeUrlKey,
      searchTerms,
      sourceVersion,
    }),
    [enabled, enabledOnly, includeUrlKey, searchTerms, sourceVersion],
  );
  const [pageStartCursor, setPageStartCursor] = useState<string | null>(null);
  const [previousPageStarts, setPreviousPageStarts] = useState<
    readonly (string | null)[]
  >([]);
  const [page, setPage] = useState<LoadedRssFeedPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    setPageStartCursor(null);
    setPreviousPageStarts([]);
    setPage(null);
    setError(null);
  }, [queryKey]);

  useEffect(() => {
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    let cancelled = false;
    if (!enabled) {
      setPage(null);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }
    if (!queryLibraryCore) {
      setPage(null);
      setLoading(false);
      setError("SQLite RSS Feed query is unavailable");
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    void (async (): Promise<LoadedRssFeedPage> => {
      const rows: LibraryCoreRssFeedPageRowV1[] = [];
      let cursor = pageStartCursor;
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
          if (matches(row, enabledOnly, stableIncludeUrls, searchTerms)) rows.push(row);
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
    })()
      .then((loaded) => {
        if (cancelled || attemptRef.current !== attempt) return;
        setPage(loaded);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled || attemptRef.current !== attempt) return;
        setPage(null);
        setLoading(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [
    boundedPageSize,
    enabled,
    enabledOnly,
    pageStartCursor,
    queryKey,
    queryLibraryCore,
    searchTerms,
    stableIncludeUrls,
  ]);

  const nextPage = useCallback(() => {
    if (!page?.nextCursor || loading) return;
    setPreviousPageStarts((current) => [...current, pageStartCursor]);
    setPageStartCursor(page.nextCursor);
  }, [loading, page?.nextCursor, pageStartCursor]);

  const previousPage = useCallback(() => {
    if (previousPageStarts.length === 0 || loading) return;
    const target = previousPageStarts.at(-1) ?? null;
    setPreviousPageStarts((current) => current.slice(0, -1));
    setPageStartCursor(target);
  }, [loading, previousPageStarts]);

  const rows = page?.rows ?? [];
  return {
    error,
    feeds: rows.map(libraryCoreRssFeedPageRowToRssFeedV1),
    hasNext: page?.nextCursor !== null && page?.nextCursor !== undefined,
    hasPrevious: previousPageStarts.length > 0,
    loading,
    nextPage,
    pageNumber: previousPageStarts.length + 1,
    previousPage,
    rows,
  };
}
