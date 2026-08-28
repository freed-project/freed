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

import { useEffect, useMemo, useRef, useState } from "react";
import MiniSearch from "minisearch";
import {
  isFriendAuthoredItem,
  matchesLibraryCoreFeedBrowseFilterV1,
  normalizeLibraryCoreFeedBrowseFilterV1,
  sortByPriority,
} from "@freed/shared";
import {
  compareLibraryCoreSearchIdentityV1,
  isLibraryCoreSearchAccountAliasV1,
  isLibraryCoreSearchQueryV1,
  LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_LIMIT,
  LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_MAXIMUM_BYTES,
  LIBRARY_CORE_SEARCH_RETAINED_RESULT_LIMIT,
  type LibraryCoreSearchAccountAliasV1,
} from "@freed/shared/library-core";
import type {
  Account,
  FeedItem,
  FilterOptions,
  Friend,
  Person,
} from "@freed/shared";
import {
  usePlatform,
  type SearchLibraryItems,
} from "../context/PlatformContext.js";

const SEARCH_PRESERVED_TEXT_LIMIT = 1_200;
const SEARCH_INDEX_CHUNK_SIZE = 100;
const SEARCH_INDEX_RELEASE_DELAY_MS = 75;
const MAX_BOUNDED_SEARCH_RESULTS = LIBRARY_CORE_SEARCH_RETAINED_RESULT_LIMIT;

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

function searchText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function buildAccountAliasMap(
  accounts: Record<string, Account>,
): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const account of Object.values(accounts)) {
    if (account.kind !== "social") continue;
    const externalId = searchText(account.externalId);
    if (!externalId) continue;
    const values = [
      account.displayName,
      account.handle,
      account.handle?.startsWith("@") ? account.handle.slice(1) : undefined,
      externalId,
      externalId.slice(-8),
    ].filter((value): value is string => Boolean(value?.trim()));
    aliases.set(accountKey(account.provider, externalId), values.join(" "));
  }
  return aliases;
}

function accountSignature(accounts: Record<string, Account>): string {
  return Object.values(accounts)
    .filter(
      (account) => account.kind === "social" && searchText(account.externalId),
    )
    .map((account) =>
      [
        account.provider,
        searchText(account.externalId),
        account.displayName ?? "",
        account.handle ?? "",
      ].join(":"),
    )
    .sort()
    .join("|");
}

const searchTextEncoder = new TextEncoder();

function boundedAliasText(value: string): string {
  if (
    searchTextEncoder.encode(value).byteLength <=
    LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_MAXIMUM_BYTES
  ) {
    return value;
  }
  const scalars = Array.from(value);
  let low = 0;
  let high = scalars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      searchTextEncoder.encode(scalars.slice(0, middle).join("")).byteLength <=
      LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_MAXIMUM_BYTES
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return scalars.slice(0, low).join("");
}

function libraryCoreSearchAccountAliases(
  accounts: Record<string, Account>,
): readonly LibraryCoreSearchAccountAliasV1[] {
  const entries = Object.values(accounts)
    .filter(
      (account) => account.kind === "social" && searchText(account.externalId),
    )
    .sort((left, right) => {
      const leftKey = `${left.provider}:${searchText(left.externalId)}`;
      const rightKey = `${right.provider}:${searchText(right.externalId)}`;
      return (
        (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0) ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      );
    })
    .map((account) => {
      const authorId = searchText(account.externalId);
      const aliases = [
        account.displayName,
        account.handle,
        account.handle?.startsWith("@") ? account.handle.slice(1) : undefined,
        authorId,
        authorId.slice(-8),
      ]
        .filter((value): value is string => Boolean(value?.trim()))
        .join(" ");
      return {
        aliases: boundedAliasText(aliases),
        authorId,
        platform: account.provider,
      } satisfies LibraryCoreSearchAccountAliasV1;
    });
  const accepted = new Map<string, LibraryCoreSearchAccountAliasV1>();
  for (const entry of entries) {
    if (!isLibraryCoreSearchAccountAliasV1(entry)) continue;
    const key = accountKey(entry.platform, entry.authorId);
    if (!accepted.has(key)) accepted.set(key, Object.freeze(entry));
    if (accepted.size === LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_LIMIT) break;
  }
  return Object.freeze([...accepted.values()]);
}

function toSearchDoc(
  item: FeedItem,
  accountAliases: Map<string, string>,
): SearchDoc {
  return {
    id: item.globalId,
    text: item.content.text ?? "",
    linkTitle: item.content.linkPreview?.title ?? "",
    linkDesc: item.content.linkPreview?.description ?? "",
    authorName: item.author.displayName,
    authorHandle: item.author.handle,
    feedTitle: item.rssSource?.feedTitle ?? "",
    accountAliases:
      accountAliases.get(accountKey(item.platform, item.author.id)) ?? "",
    preservedText:
      item.preservedContent?.text?.slice(0, SEARCH_PRESERVED_TEXT_LIMIT) ?? "",
    topics: [...item.topics, ...(item.contentSignals?.tags ?? [])].join(" "),
    semanticText: [
      item.eventCandidate?.title,
      item.eventCandidate?.locationName,
      item.eventCandidate?.evidence,
      item.location?.name,
    ]
      .filter(Boolean)
      .join(" "),
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
const searchItemByIdCache = new WeakMap<FeedItem[], Map<string, FeedItem>>();

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
  if (sharedSearchIndexCache?.key === key)
    return sharedSearchIndexCache.promise;

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
  return sharedSearchIndexCache?.key === key
    ? sharedSearchIndexCache.index
    : null;
}

function getSearchItemById(
  items: FeedItem[],
  trimmedQuery: string,
): Map<string, FeedItem> | null {
  if (!trimmedQuery) return null;

  let cached = searchItemByIdCache.get(items);
  if (!cached) {
    cached = new Map(items.map((item) => [item.globalId, item]));
    searchItemByIdCache.set(items, cached);
  }
  return cached;
}

function searchOptionsForQuery(query: string) {
  const longestTermLength = Math.max(
    0,
    ...query.split(/\s+/).map((term) => term.length),
  );
  return {
    boost: FIELD_BOOST as Record<string, number>,
    fuzzy: longestTermLength >= 4 ? 0.2 : false,
    prefix: true,
  };
}

function priorityValue(item: FeedItem): number {
  return item.priority ?? 0;
}

function filterBrowseItems(args: {
  items: FeedItem[];
  activeFilter: FilterOptions;
  identityMode: "friends" | "all_content";
  persons: Record<string, Person>;
  accounts: Record<string, Account>;
  friends: Record<string, Friend>;
}): FeedItem[] {
  let filtered: FeedItem[] | null = null;
  let ordered = true;
  let previousPriority = Number.POSITIVE_INFINITY;
  const normalizedFilter = normalizeLibraryCoreFeedBrowseFilterV1(
    args.activeFilter,
  );

  for (let index = 0; index < args.items.length; index += 1) {
    const item = args.items[index];
    const passesFilter = itemPassesBrowseFilter(item, {
      ...args,
      normalizedFilter,
    });

    if (!passesFilter) {
      if (!filtered) filtered = args.items.slice(0, index);
      continue;
    }

    const priority = priorityValue(item);
    if (priority > previousPriority) ordered = false;
    previousPriority = priority;

    filtered?.push(item);
  }

  const result = filtered ?? args.items;
  return ordered ? result : sortByPriority(result);
}

function itemPassesBrowseFilter(
  item: FeedItem,
  args: {
    activeFilter: FilterOptions;
    identityMode: "friends" | "all_content";
    persons: Record<string, Person>;
    accounts: Record<string, Account>;
    friends: Record<string, Friend>;
    normalizedFilter?: ReturnType<
      typeof normalizeLibraryCoreFeedBrowseFilterV1
    >;
  },
): boolean {
  const passesIdentity =
    args.identityMode !== "friends" ||
    isFriendAuthoredItem(item, args.persons, args.accounts, args.friends);
  return (
    passesIdentity &&
    matchesLibraryCoreFeedBrowseFilterV1(
      item,
      args.normalizedFilter ??
        normalizeLibraryCoreFeedBrowseFilterV1(args.activeFilter),
    )
  );
}

interface RankedPersistentItem {
  readonly item: FeedItem;
  readonly score: number;
}

function comparePersistentSearchItems(
  left: RankedPersistentItem,
  right: RankedPersistentItem,
): number {
  return (
    priorityValue(right.item) - priorityValue(left.item) ||
    right.score - left.score ||
    compareLibraryCoreSearchIdentityV1(left.item.globalId, right.item.globalId)
  );
}

function insertBoundedPersistentSearchItem(
  items: RankedPersistentItem[],
  candidate: RankedPersistentItem,
): void {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const current = items[middle];
    if (current && comparePersistentSearchItems(current, candidate) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  items.splice(low, 0, candidate);
  if (items.length > MAX_BOUNDED_SEARCH_RESULTS) items.pop();
}

async function computePersistentSearchResults(args: {
  searcher: SearchLibraryItems;
  searchCorpusVersion: number;
  trimmedQuery: string;
  activeFilter: FilterOptions;
  identityMode: "friends" | "all_content";
  persons: Record<string, Person>;
  accounts: Record<string, Account>;
  friends: Record<string, Friend>;
  signal: AbortSignal;
}): Promise<SearchResults> {
  const normalizedFilter = normalizeLibraryCoreFeedBrowseFilterV1(
    args.activeFilter,
  );
  const retained: RankedPersistentItem[] = [];
  let resultCount = 0;
  await args.searcher(
    args.trimmedQuery,
    args.searchCorpusVersion,
    (matches) => {
      for (const match of matches) {
        if (
          !itemPassesBrowseFilter(match.item, {
            ...args,
            normalizedFilter,
          })
        ) {
          continue;
        }
        resultCount += 1;
        insertBoundedPersistentSearchItem(retained, match);
      }
      return "continue";
    },
    {
      accountAliases: libraryCoreSearchAccountAliases(args.accounts),
      signal: args.signal,
    },
  );
  return {
    filteredItems: retained.map(({ item }) => item),
    isSearching: true,
    resultCount,
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
  /** The governed persistent search path refused or failed this query. */
  searchUnavailable?: boolean;
}

interface PersistentSearchResult {
  readonly requestKey: string;
  readonly result: SearchResults;
}

interface SearchResultCache {
  items: FeedItem[];
  trimmedQuery: string;
  activeFilter: FilterOptions;
  identityMode: "friends" | "all_content";
  persons: Record<string, Person>;
  accounts: Record<string, Account>;
  friends: Record<string, Friend>;
  index: MiniSearch<SearchDoc> | null;
  itemById: Map<string, FeedItem> | null;
  result: SearchResults;
}

let lastSearchResultCache: SearchResultCache | null = null;

function computeSearchResults(args: {
  items: FeedItem[];
  trimmedQuery: string;
  activeFilter: FilterOptions;
  identityMode: "friends" | "all_content";
  persons: Record<string, Person>;
  accounts: Record<string, Account>;
  friends: Record<string, Friend>;
  index: MiniSearch<SearchDoc> | null;
  itemById: Map<string, FeedItem> | null;
}): SearchResults {
  const cached = lastSearchResultCache;
  if (
    cached &&
    cached.items === args.items &&
    cached.trimmedQuery === args.trimmedQuery &&
    cached.activeFilter === args.activeFilter &&
    cached.identityMode === args.identityMode &&
    cached.persons === args.persons &&
    cached.accounts === args.accounts &&
    cached.friends === args.friends &&
    cached.index === args.index &&
    cached.itemById === args.itemById
  ) {
    return cached.result;
  }

  let result: SearchResults;
  if (!args.trimmedQuery) {
    // Normal feed: filter and check worker-provided priority order in one pass.
    // This avoids an extra full-corpus scan during cold load for large libraries.
    result = {
      filteredItems: filterBrowseItems({
        items: args.items,
        activeFilter: args.activeFilter,
        identityMode: args.identityMode,
        persons: args.persons,
        accounts: args.accounts,
        friends: args.friends,
      }),
      isSearching: false,
      resultCount: 0,
    };
  } else if (!args.index || !args.itemById) {
    result = { filteredItems: [], isSearching: true, resultCount: 0 };
  } else {
    // Search then filter, preserving MiniSearch's relevance ordering.
    const hits = args.index.search(
      args.trimmedQuery,
      searchOptionsForQuery(args.trimmedQuery),
    );

    const matchingItems: FeedItem[] = [];
    for (const hit of hits) {
      const item = args.itemById.get(hit.id as string);
      if (item) matchingItems.push(item);
    }

    const byFeed = filterBrowseItems({
      items: matchingItems,
      activeFilter: args.activeFilter,
      identityMode: args.identityMode,
      persons: args.persons,
      accounts: args.accounts,
      friends: args.friends,
    });

    result = {
      filteredItems: byFeed,
      isSearching: true,
      resultCount: byFeed.length,
    };
  }

  lastSearchResultCache = { ...args, result };
  return result;
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
  resultSourceVersion = searchCorpusVersion,
): SearchResults {
  const { scanLibraryItems, searchLibraryItems, store } = usePlatform();
  const trimmedQuery = searchQuery.trim();
  const searchQueryValid = isLibraryCoreSearchQueryV1(trimmedQuery);
  const activeFilterSignature = JSON.stringify(
    normalizeLibraryCoreFeedBrowseFilterV1(activeFilter),
  );
  const accountIndexSignature = accountSignature(accounts);
  const scannedRequestKey = JSON.stringify([
    searchCorpusVersion,
    resultSourceVersion,
    trimmedQuery,
    activeFilterSignature,
    accountIndexSignature,
    identityMode,
  ]);
  const activeFilterRef = useRef(activeFilter);
  activeFilterRef.current = activeFilter;
  const [index, setIndex] = useState<MiniSearch<SearchDoc> | null>(() =>
    getPreparedSearchIndex(items, searchCorpusVersion, accounts),
  );
  const [persistentResult, setPersistentResult] =
    useState<PersistentSearchResult | null>(null);
  const [persistentFailed, setPersistentFailed] = useState(false);
  const persistentSearchActive = Boolean(
    searchLibraryItems && searchQueryValid,
  );
  const itemById = useMemo(
    () =>
      persistentSearchActive || scanLibraryItems
        ? null
        : getSearchItemById(items, trimmedQuery),
    [items, persistentSearchActive, scanLibraryItems, trimmedQuery],
  );

  useEffect(() => {
    let cancelled = false;
    if (!trimmedQuery || !searchLibraryItems) {
      setPersistentResult(null);
      setPersistentFailed(false);
      return () => {
        cancelled = true;
      };
    }

    if (!isLibraryCoreSearchQueryV1(trimmedQuery)) {
      setPersistentResult(null);
      setPersistentFailed(true);
      return () => {
        cancelled = true;
      };
    }

    const graphSnapshot = store.getState();
    const controller = new AbortController();
    setPersistentResult(null);
    computePersistentSearchResults({
      searcher: searchLibraryItems,
      searchCorpusVersion,
      trimmedQuery,
      activeFilter: activeFilterRef.current,
      identityMode,
      persons: graphSnapshot.persons as Record<string, Person>,
      accounts: graphSnapshot.accounts as Record<string, Account>,
      friends: graphSnapshot.friends as Record<string, Friend>,
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) {
          setPersistentResult({ requestKey: scannedRequestKey, result });
          setPersistentFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) setPersistentFailed(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    accountIndexSignature,
    activeFilterSignature,
    identityMode,
    scannedRequestKey,
    searchCorpusVersion,
    searchLibraryItems,
    store,
    trimmedQuery,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (
      !trimmedQuery ||
      !searchQueryValid ||
      persistentSearchActive ||
      Boolean(scanLibraryItems)
    ) {
      setIndex(null);
      if (!trimmedQuery) releaseSearchIndexSoon();
      else sharedSearchIndexCache = null;
      return () => {
        cancelled = true;
      };
    }

    const prepared = getPreparedSearchIndex(
      items,
      searchCorpusVersion,
      accounts,
    );
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
  }, [
    accounts,
    items,
    persistentSearchActive,
    scanLibraryItems,
    searchCorpusVersion,
    searchQueryValid,
    trimmedQuery,
  ]);

  const fallbackResult = useMemo(
    () =>
      computeSearchResults({
        items,
        trimmedQuery: searchQueryValid ? trimmedQuery : "",
        activeFilter,
        identityMode,
        persons,
        accounts,
        friends,
        index,
        itemById,
      }),
    [
      accounts,
      activeFilter,
      friends,
      identityMode,
      index,
      itemById,
      items,
      persons,
      trimmedQuery,
      searchQueryValid,
    ],
  );

  if (trimmedQuery && !searchQueryValid) {
    return {
      filteredItems: [],
      isSearching: true,
      resultCount: 0,
      searchUnavailable: true,
    };
  }

  if (trimmedQuery && scanLibraryItems && !searchLibraryItems) {
    return {
      filteredItems: [],
      isSearching: true,
      resultCount: 0,
      searchUnavailable: true,
    };
  }

  if (trimmedQuery && persistentSearchActive) {
    if (persistentFailed) {
      return {
        filteredItems: [],
        isSearching: true,
        resultCount: 0,
        searchUnavailable: true,
      };
    }
    return (
      (persistentResult?.requestKey === scannedRequestKey
        ? persistentResult.result
        : null) ?? {
        filteredItems: [],
        isSearching: true,
        resultCount: 0,
      }
    );
  }

  return fallbackResult;
}
