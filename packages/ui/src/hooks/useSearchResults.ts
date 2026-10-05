import { useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeLibraryCoreFeedBrowseFilterV1,
  type FeedItem,
  type FilterOptions,
} from "@freed/shared";
import {
  compareLibraryCoreSearchIdentityV1,
  isLibraryCoreSearchQueryV1,
  LIBRARY_CORE_SEARCH_RETAINED_RESULT_LIMIT,
} from "@freed/shared/library-core";
import {
  usePlatform,
  type SearchLibraryItems,
} from "../context/PlatformContext.js";

export interface SearchResults {
  /** The bounded visible search window retained by React. */
  filteredItems: FeedItem[];
  /** True when the user has entered a non-empty query. */
  isSearching: boolean;
  /** Total SQLite matches, including matches outside the visible window. */
  resultCount: number;
  /** The governed SQLite search path refused or failed this query. */
  searchUnavailable?: boolean;
  /** Presentation may be retained; pending results do not admit bulk actions. */
  status?: "idle" | "loading" | "refreshing" | "ready" | "failed";
  resultsCurrent?: boolean;
}

interface RankedSearchItem {
  readonly item: FeedItem;
  readonly score: number;
}

interface PersistentSearchResult {
  readonly requestKey: string;
  readonly contextKey: string;
  readonly searcher: SearchLibraryItems;
  readonly searchCorpusVersion: number;
  readonly resultSourceVersion: number;
  readonly result: SearchResults;
}

const EMPTY_SEARCH_ITEMS: FeedItem[] = [];
Object.freeze(EMPTY_SEARCH_ITEMS);

const EMPTY_BROWSE_RESULT: SearchResults = Object.freeze({
  filteredItems: EMPTY_SEARCH_ITEMS,
  isSearching: false,
  status: "idle",
  resultsCurrent: false,
  resultCount: 0,
});

function priorityValue(item: FeedItem): number {
  return item.priority ?? 0;
}

function compareSearchItems(
  left: RankedSearchItem,
  right: RankedSearchItem,
): number {
  return (
    priorityValue(right.item) - priorityValue(left.item) ||
    right.score - left.score ||
    compareLibraryCoreSearchIdentityV1(left.item.globalId, right.item.globalId)
  );
}

function insertBoundedSearchItem(
  items: RankedSearchItem[],
  candidate: RankedSearchItem,
): void {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const current = items[middle];
    if (current && compareSearchItems(current, candidate) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  items.splice(low, 0, candidate);
  if (items.length > LIBRARY_CORE_SEARCH_RETAINED_RESULT_LIMIT) items.pop();
}

async function readSearchResults(args: {
  searcher: SearchLibraryItems;
  searchCorpusVersion: number;
  trimmedQuery: string;
  activeFilter: FilterOptions;
  identityMode: "friends" | "all_content";
  signal: AbortSignal;
}): Promise<SearchResults> {
  const retained: RankedSearchItem[] = [];
  let resultCount = 0;

  await args.searcher(
    args.trimmedQuery,
    args.searchCorpusVersion,
    (matches) => {
      for (const match of matches) {
        resultCount += 1;
        insertBoundedSearchItem(retained, match);
      }
      return "continue";
    },
    {
      filter: args.activeFilter,
      identityMode: args.identityMode,
      signal: args.signal,
    },
  );

  return {
    filteredItems: retained.map(({ item }) => item),
    isSearching: true,
    resultCount,
  };
}

/**
 * Reads a bounded search window from the platform's normalized SQLite source.
 * Empty queries return no items because ordinary browsing has its own bounded
 * query. Search never indexes or scans a renderer-held Library corpus.
 */
export function useSearchResults(
  searchQuery: string,
  activeFilter: FilterOptions,
  searchCorpusVersion: number,
  identityMode: "friends" | "all_content",
  resultSourceVersion = searchCorpusVersion,
): SearchResults {
  const { searchLibraryItems } = usePlatform();
  const trimmedQuery = searchQuery.trim();
  const searchQueryValid = isLibraryCoreSearchQueryV1(trimmedQuery);
  const candidate = normalizeLibraryCoreFeedBrowseFilterV1(activeFilter);
  const signature = JSON.stringify(candidate);
  const stableFilter = useRef({ signature, input: activeFilter, normalized: candidate });
  if (stableFilter.current.signature !== signature) stableFilter.current = { signature, input: activeFilter, normalized: candidate };
  const normalizedFilter = stableFilter.current.normalized;
  const stableActiveFilter = stableFilter.current.input;
  const contextKey = JSON.stringify([trimmedQuery, normalizedFilter, identityMode]);
  const requestKey = useMemo(
    () =>
      JSON.stringify([
        searchCorpusVersion,
        resultSourceVersion,
        trimmedQuery,
        normalizedFilter,
        identityMode,
      ]),
    [
      identityMode,
      normalizedFilter,
      resultSourceVersion,
      searchCorpusVersion,
      trimmedQuery,
    ],
  );
  const [persistentResult, setPersistentResult] =
    useState<PersistentSearchResult | null>(null);
  const [persistentFailedKey, setPersistentFailedKey] = useState<{ requestKey: string; searcher: SearchLibraryItems } | null>(null);

  useEffect(() => {
    if (!trimmedQuery || !searchQueryValid || !searchLibraryItems) {
      setPersistentResult(null);
      setPersistentFailedKey(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setPersistentResult(previous => previous?.searcher === searchLibraryItems && previous.contextKey === contextKey
      && previous.searchCorpusVersion <= searchCorpusVersion && previous.resultSourceVersion <= resultSourceVersion ? previous : null);
    setPersistentFailedKey(null);

    readSearchResults({
      searcher: searchLibraryItems,
      searchCorpusVersion,
      trimmedQuery,
      activeFilter: stableActiveFilter,
      identityMode,
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) {
          setPersistentResult({ requestKey, contextKey, searcher: searchLibraryItems, searchCorpusVersion, resultSourceVersion, result });
          setPersistentFailedKey(null);
        }
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) {
          setPersistentResult(null);
          setPersistentFailedKey({ requestKey, searcher: searchLibraryItems });
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    stableActiveFilter,
    contextKey,
    resultSourceVersion,
    identityMode,
    normalizedFilter,
    requestKey,
    searchCorpusVersion,
    searchLibraryItems,
    searchQueryValid,
    trimmedQuery,
  ]);

  if (!trimmedQuery) return EMPTY_BROWSE_RESULT;

  if (!searchQueryValid || !searchLibraryItems) {
    return {
      filteredItems: EMPTY_SEARCH_ITEMS,
      isSearching: true,
      resultCount: 0,
      searchUnavailable: true,
      status: "failed",
      resultsCurrent: false,
    };
  }

  if (persistentFailedKey?.requestKey === requestKey && persistentFailedKey.searcher === searchLibraryItems) {
    return {
      filteredItems: EMPTY_SEARCH_ITEMS,
      isSearching: true,
      resultCount: 0,
      searchUnavailable: true,
      status: "failed",
      resultsCurrent: false,
    };
  }

  const retained = persistentResult?.contextKey === contextKey && persistentResult.searcher === searchLibraryItems
    && persistentResult.searchCorpusVersion <= searchCorpusVersion && persistentResult.resultSourceVersion <= resultSourceVersion ? persistentResult : null;
  const current = retained?.requestKey === requestKey;
  return retained ? { ...retained.result, status: current ? "ready" : "refreshing", resultsCurrent: current }
    : { filteredItems: EMPTY_SEARCH_ITEMS, isSearching: true, resultCount: 0, status: "loading", resultsCurrent: false };
}
