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
 * Preserved article text is truncated to 1 200 chars before indexing — full
 * articles can be 20 k+ words and the marginal recall gain past the opening
 * section is small while the memory cost of duplicating that text is not.
 */

import { useEffect, useMemo, useState } from "react";
import MiniSearch from "minisearch";
import { filterFeedItems, isFriendAuthoredItem, sortByPriority } from "@freed/shared";
import type { Account, FeedItem, FilterOptions, Friend, Person } from "@freed/shared";

const SEARCH_PRESERVED_TEXT_LIMIT = 1_200;
const SEARCH_INDEX_CHUNK_SIZE = 250;
const SEARCH_INDEX_RELEASE_DELAY_MS = 75;

/** Flat document shape fed to MiniSearch (one per FeedItem). */
interface SearchDoc {
  id: string;
  text: string;
  linkTitle: string;
  linkDesc: string;
  authorName: string;
  authorHandle: string;
  feedTitle: string;
  accountAliases: string;
  preservedText: string;
  topics: string;
  semanticText: string;
  tags: string;
  highlights: string;
}

function accountKey(platform: string, authorId: string): string {
  return `${platform}:${authorId}`;
}

function buildAccountAliasMap(accounts: Record<string, Account>): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const account of Object.values(accounts)) {
    if (account.kind !== "social") continue;
    const values = [
      account.displayName,
      account.handle,
      account.handle?.startsWith("@") ? account.handle.slice(1) : undefined,
      account.externalId,
      account.externalId.slice(-8),
    ].filter((value): value is string => Boolean(value?.trim()));
    aliases.set(accountKey(account.provider, account.externalId), values.join(" "));
  }
  return aliases;
}

function accountSignature(accounts: Record<string, Account>): string {
  return Object.values(accounts)
    .filter((account) => account.kind === "social")
    .map((account) => [
      account.provider,
      account.externalId,
      account.displayName ?? "",
      account.handle ?? "",
    ].join(":"))
    .sort()
    .join("|");
}

function toSearchDoc(item: FeedItem, accountAliases: Map<string, string>): SearchDoc {
  return {
    id: item.globalId,
    text: item.content.text ?? "",
    linkTitle: item.content.linkPreview?.title ?? "",
    linkDesc: item.content.linkPreview?.description ?? "",
    authorName: item.author.displayName,
    authorHandle: item.author.handle,
    feedTitle: item.rssSource?.feedTitle ?? "",
    accountAliases: accountAliases.get(accountKey(item.platform, item.author.id)) ?? "",
    preservedText: item.preservedContent?.text?.slice(0, SEARCH_PRESERVED_TEXT_LIMIT) ?? "",
    topics: [...item.topics, ...(item.contentSignals?.tags ?? [])].join(" "),
    semanticText: [
      item.eventCandidate?.title,
      item.eventCandidate?.locationName,
      item.eventCandidate?.evidence,
      item.location?.name,
    ].filter(Boolean).join(" "),
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
  "accountAliases",
  "preservedText",
  "topics",
  "semanticText",
  "tags",
  "highlights",
];

const FIELD_BOOST: Partial<Record<keyof Omit<SearchDoc, "id">, number>> = {
  linkTitle: 4,
  topics: 3,
  semanticText: 3,
  tags: 3,
  authorName: 3,
  authorHandle: 3,
  accountAliases: 3,
  text: 2,
  linkDesc: 2,
  feedTitle: 2,
  highlights: 2,
  preservedText: 1,
};

function createIndex(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    idField: "id",
    fields: SEARCH_FIELDS as string[],
    storeFields: ["id"],
  });
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

async function buildSearchDocs(
  items: FeedItem[],
  accounts: Record<string, Account>,
): Promise<SearchDoc[]> {
  const aliases = buildAccountAliasMap(accounts);
  const docs: SearchDoc[] = [];
  for (let index = 0; index < items.length; index += SEARCH_INDEX_CHUNK_SIZE) {
    const chunk = items.slice(index, index + SEARCH_INDEX_CHUNK_SIZE);
    for (const item of chunk) {
      docs.push(toSearchDoc(item, aliases));
    }
    await yieldToBrowser();
  }
  return docs;
}

async function buildIndex(
  items: FeedItem[],
  accounts: Record<string, Account>,
): Promise<MiniSearch<SearchDoc>> {
  const docs = await buildSearchDocs(items, accounts);
  const ms = createIndex();
  await ms.addAllAsync(docs, { chunkSize: SEARCH_INDEX_CHUNK_SIZE });
  return ms;
}

interface SharedSearchIndexCache {
  key: string;
  index: MiniSearch<SearchDoc> | null;
  promise: Promise<MiniSearch<SearchDoc>>;
}

let sharedSearchIndexCache: SharedSearchIndexCache | null = null;
let releaseSearchIndexTimer: ReturnType<typeof setTimeout> | null = null;

function searchIndexKey(
  items: FeedItem[],
  searchCorpusVersion: number,
  accounts: Record<string, Account>,
): string {
  return `${searchCorpusVersion}:${items.length}:${accountSignature(accounts)}`;
}

export function releaseSearchIndexSoon(): void {
  if (releaseSearchIndexTimer) clearTimeout(releaseSearchIndexTimer);
  releaseSearchIndexTimer = setTimeout(() => {
    sharedSearchIndexCache = null;
    releaseSearchIndexTimer = null;
  }, SEARCH_INDEX_RELEASE_DELAY_MS);
}

export function prepareSearchIndex(
  items: FeedItem[],
  searchCorpusVersion: number,
  accounts: Record<string, Account>,
): Promise<MiniSearch<SearchDoc>> {
  if (releaseSearchIndexTimer) {
    clearTimeout(releaseSearchIndexTimer);
    releaseSearchIndexTimer = null;
  }

  const key = searchIndexKey(items, searchCorpusVersion, accounts);
  if (sharedSearchIndexCache?.key === key) return sharedSearchIndexCache.promise;

  const promise = buildIndex(items, accounts)
    .then((index) => {
      if (sharedSearchIndexCache?.key === key) {
        sharedSearchIndexCache.index = index;
      }
      return index;
    })
    .catch((error) => {
      if (sharedSearchIndexCache?.key === key) {
        sharedSearchIndexCache = null;
      }
      throw error;
    });

  sharedSearchIndexCache = { key, index: null, promise };
  return promise;
}

function getPreparedSearchIndex(
  items: FeedItem[],
  searchCorpusVersion: number,
  accounts: Record<string, Account>,
): MiniSearch<SearchDoc> | null {
  const key = searchIndexKey(items, searchCorpusVersion, accounts);
  return sharedSearchIndexCache?.key === key ? sharedSearchIndexCache.index : null;
}

function searchOptionsForQuery(query: string) {
  const longestTermLength = Math.max(0, ...query.split(/\s+/).map((term) => term.length));
  return {
    boost: FIELD_BOOST as Record<string, number>,
    fuzzy: longestTermLength >= 4 ? 0.2 : false,
    prefix: true,
  };
}

function buildEmptyIndex(): MiniSearch<SearchDoc> {
  const ms = new MiniSearch<SearchDoc>({
    idField: "id",
    fields: SEARCH_FIELDS as string[],
    storeFields: ["id"],
  });
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
  searchCorpusVersion: number,
  identityMode: "friends" | "all_content",
  persons: Record<string, Person>,
  accounts: Record<string, Account>,
  friends: Record<string, Friend>,
): SearchResults {
  const trimmedQuery = searchQuery.trim();
  const [index, setIndex] = useState<MiniSearch<SearchDoc> | null>(() =>
    getPreparedSearchIndex(items, searchCorpusVersion, accounts),
  );
  const itemById = useMemo(() => new Map(items.map((item) => [item.globalId, item])), [items]);

  useEffect(() => {
    let cancelled = false;
    if (!trimmedQuery) {
      setIndex(null);
      releaseSearchIndexSoon();
      return () => {
        cancelled = true;
      };
    }

    const prepared = getPreparedSearchIndex(items, searchCorpusVersion, accounts);
    if (prepared) {
      setIndex(prepared);
      return () => {
        cancelled = true;
      };
    }

    setIndex(null);
    prepareSearchIndex(items, searchCorpusVersion, accounts)
      .then((nextIndex) => {
        if (!cancelled) setIndex(nextIndex);
      })
      .catch(() => {
        if (!cancelled) setIndex(buildEmptyIndex());
      });

    return () => {
      cancelled = true;
    };
  }, [accounts, items, searchCorpusVersion, trimmedQuery]);

  return useMemo(() => {
    const filterIdentityMode = (candidateItems: FeedItem[]): FeedItem[] =>
      identityMode === "friends"
        ? candidateItems.filter((item) => isFriendAuthoredItem(item, persons, accounts, friends))
        : candidateItems;

    if (!trimmedQuery) {
      // Normal feed: apply active filter then sort by priority. No MiniSearch work.
      const filtered = filterFeedItems(filterIdentityMode(items), activeFilter);
      const byFeed = activeFilter.feedUrl
        ? filtered.filter((item) => item.rssSource?.feedUrl === activeFilter.feedUrl)
        : filtered;
      return { filteredItems: sortByPriority(byFeed), isSearching: false, resultCount: 0 };
    }

    // Search then filter — preserving MiniSearch's relevance ordering.
    if (!index) {
      return { filteredItems: [], isSearching: true, resultCount: 0 };
    }

    const hits = index.search(trimmedQuery, searchOptionsForQuery(trimmedQuery));

    const scoreById = new Map(hits.map((r) => [r.id as string, r.score]));

    // Map results back to FeedItems, preserving MiniSearch order.
    const matchingItems = hits
      .map((r) => itemById.get(r.id as string))
      .filter((item): item is FeedItem => item !== undefined);

    const filtered = filterFeedItems(filterIdentityMode(matchingItems), activeFilter);
    const byFeed = activeFilter.feedUrl
      ? filtered.filter((item) => item.rssSource?.feedUrl === activeFilter.feedUrl)
      : filtered;

    // Sort by relevance score (MiniSearch already orders hits, but filterFeedItems
    // may reorder, so we re-sort explicitly).
    const sorted = [...byFeed].sort(
      (a, b) => (scoreById.get(b.globalId) ?? 0) - (scoreById.get(a.globalId) ?? 0),
    );

    return { filteredItems: sorted, isSearching: true, resultCount: sorted.length };
  }, [accounts, activeFilter, friends, identityMode, index, itemById, items, persons, trimmedQuery]);
}
