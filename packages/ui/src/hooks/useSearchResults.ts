/**
 * Full-text search over in-memory feed items using MiniSearch.
 *
 * The index is rebuilt only when the items array reference changes (i.e. on
 * every Automerge document update). Searching is a pure read over the index,
 * so it never triggers a rebuild.
 *
 * Preserved article text is truncated to 3 000 chars before indexing — full
 * articles can be 20 k+ words and the marginal recall gain past that point is
 * negligible while the indexing cost is not.
 */

import { useMemo } from "react";
import MiniSearch from "minisearch";
import { filterFeedItems, sortByPriority } from "@freed/shared";
import type { FeedItem, FilterOptions } from "@freed/shared";

const PRESERVED_TEXT_LIMIT = 3_000;

/** Flat document shape fed to MiniSearch (one per FeedItem). */
interface SearchDoc {
  id: string;
  text: string;
  linkTitle: string;
  linkDesc: string;
  authorName: string;
  authorHandle: string;
  feedTitle: string;
  preservedText: string;
  topics: string;
  tags: string;
  highlights: string;
}

function toSearchDoc(item: FeedItem): SearchDoc {
  return {
    id: item.globalId,
    text: item.content.text ?? "",
    linkTitle: item.content.linkPreview?.title ?? "",
    linkDesc: item.content.linkPreview?.description ?? "",
    authorName: item.author.displayName,
    authorHandle: item.author.handle,
    feedTitle: item.rssSource?.feedTitle ?? "",
    preservedText: item.preservedContent?.text?.slice(0, PRESERVED_TEXT_LIMIT) ?? "",
    topics: item.topics.join(" "),
    tags: (item.userState.tags ?? []).join(" "),
    highlights: (item.userState.highlights ?? [])
      .map((h) => `${h.text} ${h.note ?? ""}`)
      .join(" "),
  };
}

/** Fields indexed + per-field boosts applied at query time. */
const SEARCH_FIELDS: Array<keyof Omit<SearchDoc, "id">> = [
  "text",
  "linkTitle",
  "linkDesc",
  "authorName",
  "authorHandle",
  "feedTitle",
  "preservedText",
  "topics",
  "tags",
  "highlights",
];

const FIELD_BOOST: Partial<Record<keyof Omit<SearchDoc, "id">, number>> = {
  linkTitle: 4,
  topics: 3,
  tags: 3,
  authorName: 3,
  authorHandle: 3,
  text: 2,
  linkDesc: 2,
  feedTitle: 2,
  highlights: 2,
  preservedText: 1,
};

export interface SearchResults {
  /** Items to render — either the normal ranked+filtered list, or search results. */
  filteredItems: FeedItem[];
  /** True when there is a non-empty search query. */
  isSearching: boolean;
  /** Number of items matching the query after applying the active filter. */
  resultCount: number;
}

/**
 * Returns the set of items to display given the current search query and
 * active filter.
 *
 * - Empty query: normal ranked feed filtered by activeFilter.
 * - Non-empty query: MiniSearch results filtered by activeFilter, sorted by
 *   relevance score descending.
 */
export function useSearchResults(
  items: FeedItem[],
  searchQuery: string,
  activeFilter: FilterOptions,
): SearchResults {
  // Rebuild the index only when the items array changes.
  const index = useMemo(() => {
    const ms = new MiniSearch<SearchDoc>({
      idField: "id",
      fields: SEARCH_FIELDS as string[],
      storeFields: ["id"],
    });
    ms.addAll(items.map(toSearchDoc));
    return ms;
  }, [items]);

  return useMemo(() => {
    const trimmedQuery = searchQuery.trim();

    if (!trimmedQuery) {
      // Normal feed: apply active filter then sort by priority.
      const filtered = filterFeedItems(items, activeFilter);
      const byFeed = activeFilter.feedUrl
        ? filtered.filter((item) => item.rssSource?.feedUrl === activeFilter.feedUrl)
        : filtered;
      return { filteredItems: sortByPriority(byFeed), isSearching: false, resultCount: 0 };
    }

    // Search then filter — preserving MiniSearch's relevance ordering.
    const hits = index.search(trimmedQuery, {
      boost: FIELD_BOOST as Record<string, number>,
      fuzzy: 0.2,
      prefix: true,
    });

    const scoreById = new Map(hits.map((r) => [r.id as string, r.score]));
    const itemById = new Map(items.map((item) => [item.globalId, item]));

    // Map results back to FeedItems, preserving MiniSearch order.
    const matchingItems = hits
      .map((r) => itemById.get(r.id as string))
      .filter((item): item is FeedItem => item !== undefined);

    const filtered = filterFeedItems(matchingItems, activeFilter);
    const byFeed = activeFilter.feedUrl
      ? filtered.filter((item) => item.rssSource?.feedUrl === activeFilter.feedUrl)
      : filtered;

    // Sort by relevance score (MiniSearch already orders hits, but filterFeedItems
    // may reorder, so we re-sort explicitly).
    const sorted = [...byFeed].sort(
      (a, b) => (scoreById.get(b.globalId) ?? 0) - (scoreById.get(a.globalId) ?? 0),
    );

    return { filteredItems: sorted, isSearching: true, resultCount: sorted.length };
  }, [items, searchQuery, activeFilter, index]);
}
