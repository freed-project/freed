import {
  createDefaultPreferences,
  hasSampleDataFingerprint,
  sanitizeFeedItemWrite,
  sanitizeRssFeedWrite,
  type Account,
  type FeedItem,
  type Person,
  type RssFeed,
  type SampleDataClearSummary,
  type UserPreferences,
} from "@freed/shared";
import { sanitizeAccountWrite, sanitizePersonWrite } from "@freed/shared";
import {
  LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT,
  openLibraryCoreNormalizedFeedReaderV1,
  openLibraryCoreNormalizedSavedFeedReaderV1,
  readLibraryCoreNormalizedFacetSummaryV1,
  readLibraryCoreNormalizedAccountTimelineV1,
  readLibraryCoreNormalizedFeedSignalCountsV1,
  readLibraryCoreNormalizedItemDetailV1,
  readLibraryCoreNormalizedPersonTimelineV1,
  readLibraryCoreNormalizedPreferencesV1,
  readLibraryCoreNormalizedPersonsGraphV1,
  readLibraryCoreNormalizedFriendsLocationItemV1,
  readLibraryCoreNormalizedSavedAnalyticsV1,
  scanLibraryCoreNormalizedBackgroundItemsV1,
  searchLibraryCoreNormalizedItemsV1,
  executeLibraryCoreScopeActionV1,
  libraryCoreFeedBrowseFilterInputFromV1,
  readLibraryCoreNormalizedSurfaceItemsV1,
  parseLibraryCoreControlPointerV1,
  sha256LowerHex,
  type FeedItemUserStateAssignmentFieldV1,
  type LibraryCoreSelectedNormalizedCheckpointReceiptV2,
  type LibraryCoreRssFeedScopeActionKindV1,
  type LibraryCoreScopeActionRequestV1,
  type LibraryCoreScopeActionReceiptV1,
} from "@freed/shared/library-core";
import type { FilterOptions } from "@freed/shared";
import type {
  BoundedFeedReader,
  PlatformConfig,
  ScanLibraryItems,
  SearchLibraryItems,
} from "@freed/ui/context";
import {
  createGoogleDriveLibraryCoreAdapterV1,
  discoverPublishedGoogleDriveLibraryCoreControlV1,
  importLibraryCoreNormalizedCheckpointV2,
} from "@freed/sync/cloud/library-core";
import type { LibraryState } from "./library-state-types";
import { registerPwaFactoryResetQuiesceHandler } from "./factory-reset-coordinator";
import {
  appendPwaScopeActionStage,
  beginPwaScopeActionStage,
  closePwaScopeActionStage,
  finalizePwaScopeActionStage,
  pagePwaScopeActionStage,
  queryPwaNormalizedLibrary,
  readPwaNormalizedCheckpointReceipt,
  resetPwaNormalizedLibrary,
} from "./library-core-sqlite-runtime";
import { createPwaNormalizedCheckpointWriter } from "./library-core-pwa-normalized-checkpoint-writer";
import { PWA_LIBRARY_CORE_KEY_DATABASE_NAME } from "./library-core-browser-key-vault";
import { preparePwaLibraryCoreFollowerEnrollment } from "./library-core-pwa-follower-enrollment";
import {
  commitPwaLibraryCoreAccountRemove,
  commitPwaLibraryCoreAccountUpserts,
  commitPwaLibraryCoreFeedItemCaptures,
  commitPwaLibraryCoreFeedItemRemove,
  commitPwaLibraryCorePersonRemove,
  commitPwaLibraryCorePersonUpserts,
  commitPwaLibraryCorePreferencesPatch,
  commitPwaLibraryCoreReadAssignments,
  commitPwaLibraryCoreRssFeedRemove,
  commitPwaLibraryCoreRssFeedRemoves,
  commitPwaLibraryCoreRssFeedTitleAssignment,
  commitPwaLibraryCoreRssFeedUpsert,
  commitPwaLibraryCoreUserStateAssignments,
  PWA_LIBRARY_CORE_SQLITE_CAPTURE_BATCH_LIMIT,
  PWA_LIBRARY_CORE_SQLITE_RECORD_BATCH_LIMIT,
} from "./library-core-pwa-follower-mutations";

type LibraryCoreStateListener = (state: LibraryState) => void;

const listeners = new Set<LibraryCoreStateListener>();
let lastState: LibraryState | null = null;

const NORMALIZED_READER_RUNTIME = Object.freeze({
  query: queryPwaNormalizedLibrary,
  randomId: () => crypto.randomUUID(),
});

export async function readPwaLibraryCoreSelectedCheckpointReceipt(): Promise<LibraryCoreSelectedNormalizedCheckpointReceiptV2 | null> {
  return (await readPwaNormalizedCheckpointReceipt()).receipt;
}

function emptyState(): LibraryState {
  return {
    items: [],
    searchCorpusVersion: 0,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: 0,
    unreadCountByPlatform: {},
    totalItemCount: 0,
    itemCountByPlatform: {},
    totalArchivableCount: 0,
    archivableCountByPlatform: {},
    archivableFeedCounts: {},
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
  };
}

async function readSelectedState(): Promise<LibraryState | null> {
  const selected = await readPwaLibraryCoreSelectedCheckpointReceipt();
  if (!selected) return null;
  const [reader, preferences, facetSummary] = await Promise.all([
    openLibraryCoreNormalizedFeedReaderV1(
      NORMALIZED_READER_RUNTIME,
      {},
      Date.now(),
    ),
    readLibraryCoreNormalizedPreferencesV1(NORMALIZED_READER_RUNTIME),
    readLibraryCoreNormalizedFacetSummaryV1(NORMALIZED_READER_RUNTIME),
  ]);
  let items: readonly FeedItem[];
  try {
    items = await reader.readNext();
  } finally {
    await reader.close();
  }
  const current = await readPwaLibraryCoreSelectedCheckpointReceipt();
  if (
    current === null ||
    current.checkpointDigest !== selected.checkpointDigest ||
    current.sourceRevision !== selected.sourceRevision
  ) {
    throw new Error("Selected PWA Library changed while reading its window");
  }
  const itemCountByPlatform = Object.fromEntries(
    facetSummary.platformCounts.map((entry) => [
      entry.platform,
      entry.totalCount,
    ]),
  );
  const unreadCountByPlatform = Object.fromEntries(
    facetSummary.platformCounts.map((entry) => [
      entry.platform,
      entry.unreadCount,
    ]),
  );
  const archivableCountByPlatform = Object.fromEntries(
    facetSummary.platformCounts.map((entry) => [
      entry.platform,
      entry.archivableCount,
    ]),
  );
  return Object.freeze({
    ...emptyState(),
    items: [...items],
    preferences,
    searchCorpusVersion: selected.sourceRevision,
    totalArchivableCount: facetSummary.archivableCount,
    totalItemCount: facetSummary.totalCount,
    totalUnreadCount: facetSummary.unreadCount,
    archivableCountByPlatform,
    itemCountByPlatform,
    unreadCountByPlatform,
  });
}

function publishState(state: LibraryState): void {
  lastState = state;
  for (const listener of listeners) listener(state);
}

export function isPwaLibraryCoreEnabled(): boolean {
  return true;
}

export function subscribePwaLibraryCoreState(
  listener: LibraryCoreStateListener,
): () => void {
  listeners.add(listener);
  if (lastState) listener(lastState);
  return () => listeners.delete(listener);
}

export async function initializePwaLibraryCoreState(): Promise<LibraryState> {
  const state = (await readSelectedState()) ?? emptyState();
  publishState(state);
  return state;
}

/** Establish the isolated signed Library used by local sample-data previews. */
export async function ensurePwaLibraryCoreLocalSampleState(): Promise<void> {
  const state = await readSelectedState();
  if (state) publishState(state);
}

/** Commit a signed, durable PWA read-state intent to OPFS SQLite. */
export async function enqueuePwaLibraryCoreReadAssignments(
  globalIds: readonly string[],
): Promise<void> {
  const uniqueIds = [...new Set(globalIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;
  const readAtMs = Date.now();
  for (
    let start = 0;
    start < uniqueIds.length;
    start += LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT
  ) {
    const batch = uniqueIds.slice(
      start,
      start + LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT,
    );
    await commitPwaLibraryCoreReadAssignments(batch, readAtMs);
  }
}

/** Queue complete-library read intents through bounded SQLite scans. */
export async function enqueuePwaLibraryCoreMarkAllAsRead(
  platform?: string,
): Promise<void> {
  let pending: string[] = [];
  await scanPwaLibraryCoreItems(async (items) => {
    for (const item of items) {
      if (
        item.userState.hidden ||
        item.userState.archived ||
        item.userState.readAt ||
        (platform && item.platform !== platform)
      ) {
        continue;
      }
      pending.push(item.globalId);
      if (pending.length === LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT) {
        const batch = pending;
        pending = [];
        await enqueuePwaLibraryCoreReadAssignments(batch);
      }
    }
    return "continue" as const;
  });
  await enqueuePwaLibraryCoreReadAssignments(pending);
}

/** Queue explicit item archives without waking the legacy worker. */
export async function enqueuePwaLibraryCoreArchiveItems(
  globalIds: readonly string[],
): Promise<void> {
  const assignments: string[] = [];
  for (const globalId of new Set(globalIds.filter(Boolean))) {
    const item = await readLibraryCoreNormalizedItemDetailV1(
      NORMALIZED_READER_RUNTIME,
      globalId,
    );
    if (
      !item ||
      item.userState.hidden ||
      item.userState.archived ||
      item.userState.saved ||
      !item.userState.readAt
    ) {
      continue;
    }
    assignments.push(globalId);
    if (assignments.length === LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT) {
      await enqueuePwaLibraryCoreUserStateAssignments(
        assignments.splice(0),
        "archived",
        true,
      );
    }
  }
  await enqueuePwaLibraryCoreUserStateAssignments(
    assignments,
    "archived",
    true,
  );
}

/** Archive every eligible item through bounded SQLite scans and intents. */
export async function enqueuePwaLibraryCoreArchiveAllReadUnsaved(
  platform?: string,
  feedUrl?: string,
): Promise<void> {
  let pending: string[] = [];
  await scanPwaLibraryCoreItems(async (items) => {
    for (const item of items) {
      if (
        item.userState.hidden ||
        item.userState.archived ||
        item.userState.saved ||
        !item.userState.readAt ||
        (platform && item.platform !== platform) ||
        (feedUrl && item.rssSource?.feedUrl !== feedUrl)
      ) {
        continue;
      }
      pending.push(item.globalId);
      if (pending.length === LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT) {
        const batch = pending;
        pending = [];
        await enqueuePwaLibraryCoreUserStateAssignments(
          batch,
          "archived",
          true,
        );
      }
    }
    return "continue" as const;
  });
  await enqueuePwaLibraryCoreUserStateAssignments(pending, "archived", true);
}

/** Repair every saved and archived item through bounded SQLite scans. */
export async function enqueuePwaLibraryCoreUnarchiveSavedItems(): Promise<void> {
  let pending: string[] = [];
  await scanPwaLibraryCoreItems(async (items) => {
    for (const item of items) {
      if (!item.userState.saved || !item.userState.archived) continue;
      pending.push(item.globalId);
      if (pending.length === LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT) {
        const batch = pending;
        pending = [];
        await enqueuePwaLibraryCoreUserStateAssignments(
          batch,
          "archived",
          false,
        );
      }
    }
    return "continue" as const;
  });
  await enqueuePwaLibraryCoreUserStateAssignments(pending, "archived", false);
  const state = await readSelectedState();
  if (state) publishState(state);
}

/** Delete every archived, unsaved item through bounded SQLite scans. */
export async function enqueuePwaLibraryCoreDeleteAllArchived(): Promise<void> {
  await scanPwaLibraryCoreItems(async (items) => {
    for (const item of items) {
      if (!item.userState.archived || item.userState.saved) continue;
      await enqueuePwaLibraryCoreFeedItemRemove(item.globalId);
    }
    return "continue" as const;
  });
  const state = await readSelectedState();
  if (state) publishState(state);
}

/** Queue the explicit state selected by a local toggle gesture. */
export async function enqueuePwaLibraryCoreUserStateToggle(
  globalId: string,
  field: FeedItemUserStateAssignmentFieldV1,
): Promise<void> {
  const item = await readLibraryCoreNormalizedItemDetailV1(
    NORMALIZED_READER_RUNTIME,
    globalId,
  );
  if (!item) throw new Error("PWA assignment targets an unavailable FeedItem");
  await enqueuePwaLibraryCoreUserStateAssignment(
    globalId,
    field,
    item.userState[field] !== true,
  );
}

/** Queue one signed, idempotent PWA user-state assignment. */
export async function enqueuePwaLibraryCoreUserStateAssignment(
  globalId: string,
  field: FeedItemUserStateAssignmentFieldV1,
  assigned: boolean,
): Promise<void> {
  await enqueuePwaLibraryCoreUserStateAssignments([globalId], field, assigned);
}

/** Commit one signed FeedItem removal to OPFS SQLite. */
export async function enqueuePwaLibraryCoreFeedItemRemove(
  globalId: string,
): Promise<void> {
  if (!globalId) throw new TypeError("remove entity ID is required");
  await commitPwaLibraryCoreFeedItemRemove(globalId, Date.now());
}

/** Commit one signed FeedItem capture to OPFS SQLite. */
export async function enqueuePwaLibraryCoreFeedItemCapture(
  item: FeedItem,
): Promise<void> {
  await enqueuePwaLibraryCoreFeedItemCaptures([item]);
}

/** Commit bounded signed FeedItem captures to OPFS SQLite. */
export async function enqueuePwaLibraryCoreFeedItemCaptures(
  items: readonly FeedItem[],
): Promise<void> {
  if (items.length === 0) return;
  let batch: FeedItem[] = [];
  let identities = new Set<string>();
  const flush = async () => {
    if (batch.length === 0) return;
    await commitPwaLibraryCoreFeedItemCaptures(batch, Date.now());
    batch = [];
    identities = new Set<string>();
  };
  for (const input of items) {
    const item = sanitizeFeedItemWrite(input) as FeedItem;
    if (
      batch.length === PWA_LIBRARY_CORE_SQLITE_CAPTURE_BATCH_LIMIT ||
      identities.has(item.globalId)
    ) {
      await flush();
    }
    batch.push(item);
    identities.add(item.globalId);
  }
  await flush();
}

/** Commit one signed RSS feed upsert to OPFS SQLite. */
export async function enqueuePwaLibraryCoreRssFeedUpsert(
  input: RssFeed,
): Promise<void> {
  const feed = sanitizeRssFeedWrite(input) as RssFeed;
  await commitPwaLibraryCoreRssFeedUpsert(feed, Date.now());
}

/** Queue one signed RSS removal, optionally removing its local feed items. */
export async function enqueuePwaLibraryCoreRssFeedRemove(
  url: string,
  includeItems: boolean,
): Promise<void> {
  await commitPwaLibraryCoreRssFeedRemove(url, includeItems, Date.now());
}

/** Freeze the complete RSS scope in SQLite, then emit bounded signed removals. */
export async function removeAllPwaLibraryCoreRssFeeds(
  includeItems: boolean,
): Promise<number> {
  const action: LibraryCoreRssFeedScopeActionKindV1 = includeItems
    ? "rss_feeds_remove_with_items"
    : "rss_feeds_remove_keep_items";
  const stageId = `pwa-rss-scope:${crypto.randomUUID()}`;
  const status = await beginPwaScopeActionStage(stageId, {
    action,
    schemaVersion: 1,
  });
  if (status.state !== "ready") {
    await closePwaScopeActionStage(stageId);
    throw new Error("PWA RSS Feed scope did not freeze atomically");
  }
  try {
    let afterOrdinal = -1;
    for (;;) {
      const page = await pagePwaScopeActionStage(stageId, afterOrdinal);
      if (page.entityIds.length === 0) break;
      for (let offset = 0; offset < page.entityIds.length; offset += 256) {
        await commitPwaLibraryCoreRssFeedRemoves(
          page.entityIds.slice(offset, offset + 256),
          includeItems,
          Date.now(),
        );
      }
      if (page.nextOrdinal <= afterOrdinal) {
        throw new Error("PWA RSS Feed scope page did not advance");
      }
      afterOrdinal = page.nextOrdinal;
    }
    return status.memberCount;
  } finally {
    await closePwaScopeActionStage(stageId);
  }
}

/** Assign one RSS title without reading or replacing the complete feed row. */
export async function enqueuePwaLibraryCoreRssFeedTitleAssignment(
  url: string,
  title: string,
): Promise<void> {
  const sanitized = sanitizeRssFeedWrite({ title });
  await commitPwaLibraryCoreRssFeedTitleAssignment(
    url,
    sanitized.title ?? title,
    Date.now(),
  );
}

/** Remove only fingerprinted sample records from the selected Library Core store. */
export async function clearPwaLibraryCoreSampleData(): Promise<SampleDataClearSummary> {
  const state = lastState ?? (await readSelectedState()) ?? emptyState();
  const feedUrls = Object.values(state.feeds)
    .filter(hasSampleDataFingerprint)
    .map((feed) => feed.url);
  const personIds = new Set(
    Object.values(state.persons)
      .filter(hasSampleDataFingerprint)
      .map((person) => person.id),
  );
  const sampleAccountIds = Object.values(state.accounts)
    .filter(hasSampleDataFingerprint)
    .map((account) => account.id);
  const realLinkedAccounts = Object.values(state.accounts).filter(
    (account) =>
      !hasSampleDataFingerprint(account) &&
      account.personId !== undefined &&
      personIds.has(account.personId),
  );
  const itemIds: string[] = [];
  await scanPwaLibraryCoreItems((items) => {
    for (const item of items) {
      if (hasSampleDataFingerprint(item)) itemIds.push(item.globalId);
    }
    return "continue";
  });

  const updatedAt = Date.now();
  await enqueuePwaLibraryCoreAccountUpserts(
    realLinkedAccounts.map(({ personId, ...account }) => {
      void personId;
      return {
        ...account,
        updatedAt,
      };
    }),
  );
  for (const accountId of sampleAccountIds) {
    await enqueuePwaLibraryCoreAccountRemove(accountId);
  }
  for (const personId of personIds) {
    await enqueuePwaLibraryCorePersonRemove(personId);
  }
  for (const url of feedUrls) {
    await enqueuePwaLibraryCoreRssFeedRemove(url, false);
  }
  for (const itemId of itemIds) {
    await enqueuePwaLibraryCoreFeedItemRemove(itemId);
  }

  return {
    feeds: feedUrls.length,
    items: itemIds.length,
    persons: personIds.size,
    accounts: sampleAccountIds.length,
    total:
      feedUrls.length +
      itemIds.length +
      personIds.size +
      sampleAccountIds.length,
  };
}

/** Commit one synchronized preference patch to OPFS SQLite. */
export async function enqueuePwaLibraryCorePreferencesPatch(
  updates: Partial<UserPreferences>,
): Promise<void> {
  await commitPwaLibraryCorePreferencesPatch(updates, Date.now());
}

/** Commit one whole sanitized Person to OPFS SQLite. */
export async function enqueuePwaLibraryCorePersonUpsert(
  person: Person,
): Promise<void> {
  await enqueuePwaLibraryCorePersonUpserts([person]);
}

/** Commit bounded whole sanitized Persons to OPFS SQLite. */
export async function enqueuePwaLibraryCorePersonUpserts(
  persons: readonly Person[],
): Promise<void> {
  const synchronized = persons.map(
    (person) => sanitizePersonWrite(person) as Person,
  );
  for (
    let offset = 0;
    offset < synchronized.length;
    offset += PWA_LIBRARY_CORE_SQLITE_RECORD_BATCH_LIMIT
  ) {
    await commitPwaLibraryCorePersonUpserts(
      synchronized.slice(
        offset,
        offset + PWA_LIBRARY_CORE_SQLITE_RECORD_BATCH_LIMIT,
      ),
      Date.now(),
    );
  }
}

/** Commit one atomic Person and linked-account removal to OPFS SQLite. */
export async function enqueuePwaLibraryCorePersonRemove(
  personId: string,
): Promise<void> {
  await commitPwaLibraryCorePersonRemove(personId, Date.now());
}

/** Commit one whole sanitized Account to OPFS SQLite. */
export async function enqueuePwaLibraryCoreAccountUpsert(
  account: Account,
): Promise<void> {
  await enqueuePwaLibraryCoreAccountUpserts([account]);
}

/** Commit bounded whole sanitized Accounts to OPFS SQLite. */
export async function enqueuePwaLibraryCoreAccountUpserts(
  accounts: readonly Account[],
): Promise<void> {
  const synchronized = accounts.map(
    (account) => sanitizeAccountWrite(account) as Account,
  );
  for (
    let offset = 0;
    offset < synchronized.length;
    offset += PWA_LIBRARY_CORE_SQLITE_RECORD_BATCH_LIMIT
  ) {
    await commitPwaLibraryCoreAccountUpserts(
      synchronized.slice(
        offset,
        offset + PWA_LIBRARY_CORE_SQLITE_RECORD_BATCH_LIMIT,
      ),
      Date.now(),
    );
  }
}

/** Commit one Account removal to OPFS SQLite. */
export async function enqueuePwaLibraryCoreAccountRemove(
  accountId: string,
): Promise<void> {
  await commitPwaLibraryCoreAccountRemove(accountId, Date.now());
}

async function enqueuePwaLibraryCoreUserStateAssignments(
  globalIds: readonly string[],
  field: FeedItemUserStateAssignmentFieldV1,
  assigned: boolean,
): Promise<void> {
  if (globalIds.length === 0) return;
  const assignedAtMs = Date.now();
  await commitPwaLibraryCoreUserStateAssignments(
    globalIds,
    field,
    assigned,
    assignedAtMs,
  );
}

/** Visit compact background metadata directly through PWA OPFS SQLite. */
export const scanPwaLibraryCoreItems: ScanLibraryItems = (visit) =>
  scanLibraryCoreNormalizedBackgroundItemsV1(NORMALIZED_READER_RUNTIME, visit);

/** Search the selected Library directly through normalized OPFS SQLite. */
export const searchPwaLibraryCoreItems: SearchLibraryItems = async (
  query,
  _searchCorpusVersion,
  visit,
  options,
) =>
  searchLibraryCoreNormalizedItemsV1(
    NORMALIZED_READER_RUNTIME,
    {
      filter: options?.filter ?? {},
      identityMode: options?.identityMode ?? "all_content",
      query,
      signal: options?.signal,
    },
    visit,
  );

/** Resolve a complete SQLite scope and emit only bounded explicit intents. */
export async function executePwaLibraryCoreScopeAction(
  request: LibraryCoreScopeActionRequestV1,
): Promise<LibraryCoreScopeActionReceiptV1> {
  const filter = libraryCoreFeedBrowseFilterInputFromV1(request.filter);
  let stagedCount = 0;
  return executeLibraryCoreScopeActionV1(request, {
    scan: async (visit) => {
      if (request.query !== null) {
        await searchLibraryCoreNormalizedItemsV1(
          NORMALIZED_READER_RUNTIME,
          {
            filter,
            identityMode: request.identityMode,
            query: request.query,
          },
          async (matches) => {
            await visit(matches.map((match) => match.item));
            return "continue" as const;
          },
        );
        return;
      }
      const reader = await openLibraryCoreNormalizedFeedReaderV1(
        NORMALIZED_READER_RUNTIME,
        filter,
        Date.now(),
        request.identityMode,
      );
      try {
        for (;;) {
          const items = await reader.readNext();
          if (items.length === 0) return;
          await visit(items);
        }
      } finally {
        await reader.close();
      }
    },
    beginStage: async (stageRequest) => {
      const stageId = `scope-action:${crypto.randomUUID()}`;
      stagedCount = 0;
      await beginPwaScopeActionStage(stageId, stageRequest);
      return stageId;
    },
    appendStage: async (stageId, entityIds) => {
      await appendPwaScopeActionStage(stageId, stagedCount, entityIds);
      stagedCount += entityIds.length;
    },
    finalizeStage: (stageId) =>
      finalizePwaScopeActionStage(stageId, stagedCount),
    readStage: async (stageId, afterOrdinal) => {
      const page = await pagePwaScopeActionStage(stageId, afterOrdinal);
      return {
        entityIds: page.entityIds,
        nextOrdinal: page.nextOrdinal,
      };
    },
    closeStage: closePwaScopeActionStage,
    commitBatch: async (action, entityIds) => {
      if (action === "read") {
        await enqueuePwaLibraryCoreReadAssignments(entityIds);
      } else {
        await enqueuePwaLibraryCoreUserStateAssignments(
          entityIds,
          "archived",
          true,
        );
      }
    },
  });
}

/** Read one compact item detail through normalized SQLite. */
export async function readPwaLibraryCoreItemDetail(
  globalId: string,
): Promise<FeedItem | null> {
  return readLibraryCoreNormalizedItemDetailV1(
    NORMALIZED_READER_RUNTIME,
    globalId,
  );
}

/** Open a filtered feed through the shared bounded SQLite query adapter. */
export async function openPwaLibraryCoreFeedReader(
  filter: FilterOptions,
  rankingClockMs = Date.now(),
): Promise<BoundedFeedReader> {
  return openLibraryCoreNormalizedFeedReaderV1(
    NORMALIZED_READER_RUNTIME,
    filter,
    rankingClockMs,
  );
}

/** Open the complete Person-first Friends feed through bounded SQLite pages. */
export async function openPwaLibraryCoreFriendsFeedReader(
  filter: FilterOptions,
  rankingClockMs: number,
): Promise<BoundedFeedReader> {
  return openLibraryCoreNormalizedFeedReaderV1(
    NORMALIZED_READER_RUNTIME,
    filter,
    rankingClockMs,
    "friends",
  );
}

/** Open every Saved sort mode through the shared bounded SQLite query adapter. */
export async function openPwaLibraryCoreSavedFeedReader(
  filter: FilterOptions,
  sortMode: Parameters<
    NonNullable<PlatformConfig["openBoundedSavedFeedReader"]>
  >[1],
  rankingClockMs: number,
): Promise<BoundedFeedReader> {
  if (!Number.isSafeInteger(rankingClockMs) || rankingClockMs < 0) {
    throw new RangeError("saved feed ranking clock is invalid");
  }
  return openLibraryCoreNormalizedSavedFeedReaderV1(
    NORMALIZED_READER_RUNTIME,
    filter,
    sortMode,
  );
}

/** Read exact full-library facets without consulting the renderer window. */
export const readPwaLibraryCoreFacetSummary: NonNullable<
  PlatformConfig["readLibraryFacetSummary"]
> = () => readLibraryCoreNormalizedFacetSummaryV1(NORMALIZED_READER_RUNTIME);

/** Count every signal chip through bounded normalized SQLite queries. */
export const readPwaLibraryCoreFeedSignalCounts: NonNullable<
  PlatformConfig["readFeedSignalCounts"]
> = (filter) =>
  readLibraryCoreNormalizedFeedSignalCountsV1(
    NORMALIZED_READER_RUNTIME,
    filter,
    Date.now(),
  );

/** Read exact Saved overview aggregates through normalized SQLite. */
export const readPwaLibraryCoreSavedAnalytics: NonNullable<
  PlatformConfig["readLibrarySavedAnalytics"]
> = (request) =>
  readLibraryCoreNormalizedSavedAnalyticsV1(NORMALIZED_READER_RUNTIME, request);

/** Read compact Friends graph activity through bounded SQLite aggregates. */
export const readPwaLibraryCoreFriendsGraph: NonNullable<
  PlatformConfig["readLibraryFriendsGraph"]
> = (request) =>
  readLibraryCoreNormalizedPersonsGraphV1(NORMALIZED_READER_RUNTIME, request);

/** Read one bounded Person timeline page through normalized SQLite. */
export const readPwaLibraryCorePersonTimeline: NonNullable<
  PlatformConfig["readLibraryPersonTimeline"]
> = (request) =>
  typeof request.accountId === "string"
    ? readLibraryCoreNormalizedAccountTimelineV1(
        NORMALIZED_READER_RUNTIME,
        request,
      )
    : readLibraryCoreNormalizedPersonTimelineV1(
        NORMALIZED_READER_RUNTIME,
        request,
      );

/** Resolve one exact location item against its Friends source token. */
export const readPwaLibraryCoreFriendsLocationItem: NonNullable<
  PlatformConfig["readLibraryFriendsLocationItem"]
> = (request) =>
  readLibraryCoreNormalizedFriendsLocationItemV1(
    NORMALIZED_READER_RUNTIME,
    request,
  );

/** Read bounded Map or Story Wall candidates through normalized SQLite. */
export const readPwaLibraryCoreSurfaceItems: NonNullable<
  PlatformConfig["readLibrarySurfaceItems"]
> = (surface) =>
  readLibraryCoreNormalizedSurfaceItemsV1(NORMALIZED_READER_RUNTIME, surface);

async function publishSelectedStateAfterLibraryCoreSync(): Promise<LibraryState> {
  const state = await readSelectedState();
  if (!state) {
    throw new Error("Imported SQLite Library checkpoint is not selected");
  }
  publishState(state);
  return state;
}

/** Import the published normalized Desktop checkpoint into OPFS SQLite. */
export async function syncPwaLibraryCoreFromGoogleDrive(input: {
  readonly accessToken: string;
  readonly signal?: AbortSignal;
}): Promise<LibraryState> {
  const discovered = await discoverPublishedGoogleDriveLibraryCoreControlV1({
    accessToken: input.accessToken,
    signal: input.signal,
  });
  if (!discovered) {
    throw new Error("No published SQLite Library was found in Google Drive");
  }
  const decoded = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(discovered.control.bytes),
  );
  const pointer = parseLibraryCoreControlPointerV1(decoded);
  if (pointer.libraryId !== discovered.libraryId) {
    throw new Error("Discovered Library identity changed during control read");
  }
  const adapter = createGoogleDriveLibraryCoreAdapterV1({
    accessToken: input.accessToken,
    controlFileId: discovered.controlFileId,
    libraryId: pointer.libraryId,
    signal: input.signal,
  });
  const controlRevision = sha256LowerHex(discovered.control.bytes);
  await importLibraryCoreNormalizedCheckpointV2({
    adapter,
    generation: pointer.generation,
    libraryId: pointer.libraryId,
    manifest: pointer.manifest,
    storageEpoch: pointer.storageEpoch,
    subtle: crypto.subtle,
    writer: createPwaNormalizedCheckpointWriter({
      checkpointGeneration: pointer.generation,
      controlRevision,
      installedAt: Date.now(),
      writerActorId: pointer.writerId,
    }),
  });
  await preparePwaLibraryCoreFollowerEnrollment();
  return publishSelectedStateAfterLibraryCoreSync();
}

registerPwaFactoryResetQuiesceHandler(
  "library-core-storage",
  async () => {
    await resetPwaNormalizedLibrary();
    lastState = null;
    const deleteDatabase = (databaseName: string) =>
      new Promise<void>((resolve, reject) => {
        const request = globalThis.indexedDB.deleteDatabase(databaseName);
        request.addEventListener("success", () => resolve(), { once: true });
        request.addEventListener(
          "error",
          () =>
            reject(request.error ?? new Error("SQLite Library reset failed")),
          { once: true },
        );
        request.addEventListener(
          "blocked",
          () =>
            reject(
              new Error("SQLite Library reset was blocked by another tab"),
            ),
          { once: true },
        );
      });
    await deleteDatabase(PWA_LIBRARY_CORE_KEY_DATABASE_NAME);
  },
  25,
);
