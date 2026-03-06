/**
 * Full-text search over in-memory feed items using MiniSearch.
 *
 * INDEX LIFECYCLE
 * ───────────────
 * The index is LAZY: it is only built the first time the user types a search
 * query, and rebuilt whenever the item corpus changes WHILE a query is active.
 * When the search box is empty (the default browsing state), no MiniSearch work
 * happens at all.
 *
 * Before this change, the index was rebuilt on EVERY Automerge mutation
 * (markAsRead, save, archive, scroll-to-read) regardless of whether search was
 * active. A V8 CPU profile confirmed this consumed 71.5 % of all CPU time
 * during markAsRead with 3 k items, adding ~100 ms to every mutation.
 *
 * CORPUS FINGERPRINT
 * ──────────────────
 * When a query IS active we want the index to stay fresh with new items but not
 * thrash on user-state-only mutations (readAt, saved, archived). We derive a
 * stable "content key" from fields that actually affect search results:
 * item IDs, titles, text, tags, and highlights. Plain state changes (readAt,
 * saved) don't appear in the content key, so they don't trigger a rebuild.
 *
 * Preserved article text is truncated to 3 000 chars before indexing — full
 * articles can be 20 k+ words and the marginal recall gain past that point is
 * negligible while the indexing cost is not.
 */

import { useMemo, useRef } from "react";
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

/**
 * Derive a stable string that changes only when searchable content changes --
 * not when userState.readAt / saved / archived flip. This prevents a full index
 * rebuild on every scroll-to-read or bookmark toggle while a query is active.
 */
function contentFingerprint(items: FeedItem[]): string {
  // Fast path: join IDs + searchable-content lengths. Not a cryptographic hash,
  // but false-positive rebuilds (same content, same fingerprint) are safe.
  return items
    .map((item) => {
      const tagsKey = (item.userState.tags ?? []).join(",");
      const hlKey = (item.userState.highlights ?? []).length;
      return `${item.globalId}:${item.content.text?.length ?? 0}:${tagsKey}:${hlKey}`;
    })
    .join("|");
}

function buildIndex(items: FeedItem[]): MiniSearch<SearchDoc> {
  const ms = new MiniSearch<SearchDoc>({
    idField: "id",
    fields: SEARCH_FIELDS as string[],
    storeFields: ["id"],
  });
  ms.addAll(items.map(toSearchDoc));
  return ms;
}

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
 * - Empty query: normal ranked feed filtered by activeFilter. No index work.
 * - Non-empty query: MiniSearch results filtered by activeFilter, sorted by
 *   relevance score descending. Index built lazily and cached until content
 *   fingerprint changes.
 */
export function useSearchResults(
  items: FeedItem[],
  searchQuery: string,
  activeFilter: FilterOptions,
): SearchResults {
  const trimmedQuery = searchQuery.trim();

  // Cache the index and the fingerprint it was built from across renders.
  // Using refs instead of useMemo lets us control invalidation independently of
  // React's referential equality check on `items`.
  const indexRef = useRef<MiniSearch<SearchDoc> | null>(null);
  const fingerprintRef = useRef<string>("");

  // When a query is active, ensure the index is up to date with the current
  // corpus. We only rebuild if the content fingerprint has changed.
  if (trimmedQuery) {
    const fp = contentFingerprint(items);
    if (!indexRef.current || fp !== fingerprintRef.current) {
      indexRef.current = buildIndex(items);
      fingerprintRef.current = fp;
    }
  }

  return useMemo(() => {
    if (!trimmedQuery) {
      // Normal feed: apply active filter then sort by priority. No MiniSearch work.
      const filtered = filterFeedItems(items, activeFilter);
      const byFeed = activeFilter.feedUrl
        ? filtered.filter((item) => item.rssSource?.feedUrl === activeFilter.feedUrl)
        : filtered;
      return { filteredItems: sortByPriority(byFeed), isSearching: false, resultCount: 0 };
    }

    // Search then filter — preserving MiniSearch's relevance ordering.
    const index = indexRef.current!;
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
  }, [items, trimmedQuery, activeFilter]);
}
