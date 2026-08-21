import {
  createDefaultPreferences,
  friendFromPerson,
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
  readLibraryCoreNormalizedSavedAnalyticsV1,
  searchLibraryCoreNormalizedItemsV1,
  readLibraryCoreNormalizedSurfaceItemsV1,
  parseLibraryCoreControlPointerV1,
  type LibraryCoreCanonicalValue,
  type FeedItemUserStateAssignmentFieldV1,
  type LibraryCoreOperationInstanceId,
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
  createGoogleDriveLibraryCoreIntentAdapterV1,
  createGoogleDriveLibraryCoreResultAdapterV1,
  discoverGoogleDriveLibraryCoreActorEnrollmentsV1,
  discoverGoogleDriveLibraryCoreResultHeadV1,
  discoverGoogleDriveLibraryCoreResultSegmentsV1,
  discoverPublishedGoogleDriveLibraryCoreControlV1,
  importLibraryCorePortableCheckpointV1,
  importLibraryCoreResultSegmentV1,
  provisionGoogleDriveLibraryCoreIntentHeadV1,
  publishLibraryCoreIntentCandidateV1,
} from "@freed/sync/cloud/library-core";
import type { LibraryState } from "./library-state-types";
import { registerPwaFactoryResetQuiesceHandler } from "./factory-reset-coordinator";
import {
  createPwaLibraryCorePortableCheckpointStore,
  PWA_LIBRARY_CORE_FEED_ITEM_UPSERT_BATCH_LIMIT,
  PWA_LIBRARY_CORE_PERSON_UPSERT_BATCH_LIMIT,
  PWA_LIBRARY_CORE_ACCOUNT_UPSERT_BATCH_LIMIT,
  type PwaLibraryCoreSelectedCheckpointReceiptV1,
  type PwaLibraryCoreIntentOverlayRecoveryStateV1,
} from "./library-core-portable-checkpoint-store";
import { createPwaLibraryCoreIndexedDbReaders } from "./library-core-indexeddb-readers";
import {
  queryPwaNormalizedLibrary,
  resetPwaNormalizedLibrary,
} from "./library-core-sqlite-runtime";

const DATABASE_NAME = "freed-library-core-portable-v1";
const READ_MODEL_DATABASE_NAME = "freed-library-core-read-model-v1";
const MAXIMUM_INITIAL_FEED_ITEMS = 512;
const COLLECTION_PAGE_LIMIT = 128;
const LIBRARY_SCAN_PAGE_LIMIT = 32;
const MAXIMUM_INTENT_SEGMENTS_PER_SYNC = 128;
const MAXIMUM_RESULT_SEGMENTS_PER_SYNC = 128;

type LibraryCoreStateListener = (state: LibraryState) => void;

const listeners = new Set<LibraryCoreStateListener>();
let lastState: LibraryState | null = null;

let portableStore: ReturnType<
  typeof createPwaLibraryCorePortableCheckpointStore
> | null = null;
let indexedDbReaders: ReturnType<
  typeof createPwaLibraryCoreIndexedDbReaders
> | null = null;
let libraryReadModelRevision = 0;
const READY_INTENT_OVERLAY_RECOVERY = Object.freeze({
  canonicalEnvelopeBytes: 0,
  countsAreLowerBounds: false,
  operationCount: 0,
  schemaVersion: 1,
  status: "ready",
  transactionCount: 0,
}) satisfies PwaLibraryCoreIntentOverlayRecoveryStateV1;
let intentOverlayRecoveryState: PwaLibraryCoreIntentOverlayRecoveryStateV1 =
  READY_INTENT_OVERLAY_RECOVERY;
const NORMALIZED_READER_RUNTIME = Object.freeze({
  query: queryPwaNormalizedLibrary,
  randomId: () => crypto.randomUUID(),
});

function getPortableStore(): ReturnType<
  typeof createPwaLibraryCorePortableCheckpointStore
> {
  portableStore ??= createPwaLibraryCorePortableCheckpointStore({
    databaseName: DATABASE_NAME,
    indexedDb: globalThis.indexedDB,
    keyRange: globalThis.IDBKeyRange,
    subtle: globalThis.crypto.subtle,
  });
  return portableStore;
}
function getIndexedDbReaders(): ReturnType<
  typeof createPwaLibraryCoreIndexedDbReaders
> {
  indexedDbReaders ??= createPwaLibraryCoreIndexedDbReaders({
    databaseName: READ_MODEL_DATABASE_NAME,
    indexedDb: globalThis.indexedDB,
    keyRange: globalThis.IDBKeyRange,
    subtle: globalThis.crypto.subtle,
    scanItems: scanPwaLibraryCoreItems,
    readItem: readPwaLibraryCoreItemDetail,
    getState: () => lastState ?? emptyState(),
    getSourceRevision: () => libraryReadModelRevision,
  });
  return indexedDbReaders;
}

export async function readPwaLibraryCoreSelectedCheckpointReceipt(): Promise<PwaLibraryCoreSelectedCheckpointReceiptV1 | null> {
  return getPortableStore().readSelectedCheckpointReceipt();
}

export function readPwaLibraryCoreIntentOverlayRecoveryState(): PwaLibraryCoreIntentOverlayRecoveryStateV1 {
  return intentOverlayRecoveryState;
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

function stateFromShell(
  shell: Readonly<Record<string, LibraryCoreCanonicalValue>>,
  items: FeedItem[],
  counts: Pick<
    LibraryState,
    | "archivableCountByPlatform"
    | "archivableFeedCounts"
    | "feedTotalCounts"
    | "feedUnreadCounts"
    | "itemCountByPlatform"
    | "totalArchivableCount"
    | "totalItemCount"
    | "totalUnreadCount"
    | "unreadCountByPlatform"
  >,
): LibraryState {
  const base = { ...emptyState(), ...shell } as LibraryState;
  const persons = base.persons as Record<string, Person>;
  const accounts = base.accounts as Record<string, Account>;
  return {
    ...base,
    ...counts,
    items,
    friends: Object.fromEntries(
      Object.values(persons).map((person) => [
        person.id,
        friendFromPerson(person, accounts),
      ]),
    ),
  };
}

async function readSelectedState(): Promise<LibraryState | null> {
  const store = getPortableStore();
  const selected = await store.readSelectedCheckpointReceipt();
  if (!selected) return null;
  const shell = await store.readSelectedMaterializedRow(
    "00_library_shell",
    "shell",
  );
  if (!shell) return null;

  const items: FeedItem[] = [];
  const feedUnreadCounts: Record<string, number> = {};
  const feedTotalCounts: Record<string, number> = {};
  const unreadCountByPlatform: Record<string, number> = {};
  const itemCountByPlatform: Record<string, number> = {};
  const archivableCountByPlatform: Record<string, number> = {};
  const archivableFeedCounts: Record<string, number> = {};
  let totalUnreadCount = 0;
  let totalItemCount = 0;
  let totalArchivableCount = 0;
  const bump = (record: Record<string, number>, key: string) => {
    record[key] = (record[key] ?? 0) + 1;
  };
  let cursor: string | null = null;
  do {
    const page = await store.readSelectedMaterializedPage({
      cursor,
      limit: COLLECTION_PAGE_LIMIT,
    });
    for (const entry of page.entries) {
      if (entry.registryKey === "10_feed_items") {
        const item = entry.row as unknown as FeedItem;
        if (items.length < MAXIMUM_INITIAL_FEED_ITEMS) items.push(item);
        if (item.userState.hidden || item.userState.archived) continue;
        totalItemCount += 1;
        bump(itemCountByPlatform, item.platform);
        if (item.rssSource) bump(feedTotalCounts, item.rssSource.feedUrl);
        if (!item.userState.readAt) {
          totalUnreadCount += 1;
          bump(unreadCountByPlatform, item.platform);
          if (item.rssSource) bump(feedUnreadCounts, item.rssSource.feedUrl);
        } else if (!item.userState.saved) {
          totalArchivableCount += 1;
          bump(archivableCountByPlatform, item.platform);
          if (item.rssSource)
            bump(archivableFeedCounts, item.rssSource.feedUrl);
        }
      }
    }
    cursor = page.nextCursor;
  } while (cursor !== null);

  const current = await store.readSelectedCheckpointReceipt();
  if (
    !current ||
    current.generationId !== selected.generationId ||
    current.selectionSequence !== selected.selectionSequence
  ) {
    throw new Error("Selected PWA Library changed while reading its state");
  }

  return {
    ...stateFromShell(shell, items, {
      archivableCountByPlatform,
      archivableFeedCounts,
      feedTotalCounts,
      feedUnreadCounts,
      itemCountByPlatform,
      totalArchivableCount,
      totalItemCount,
      totalUnreadCount,
      unreadCountByPlatform,
    }),
    searchCorpusVersion: selected.selectionSequence,
  };
}

function publishState(state: LibraryState): void {
  libraryReadModelRevision += 1;
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
  intentOverlayRecoveryState =
    await getPortableStore().reapplySelectedIntentOverlay();
  const state = (await readSelectedState()) ?? emptyState();
  publishState(state);
  return state;
}

/** Establish the isolated signed Library used by local sample-data previews. */
export async function ensurePwaLibraryCoreLocalSampleState(): Promise<void> {
  await getPortableStore().bootstrapFeaturePreviewAuthority();
  const state = await readSelectedState();
  if (state) publishState(state);
}

/** Queue a signed, durable PWA read-state intent without touching Automerge. */
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
    await getPortableStore().enqueueReadAssignments({
      entityIds: batch,
      readAtMs,
    });
  }
}

/** Queue complete-library read intents through bounded IndexedDB scans. */
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
    const row = await getPortableStore().readSelectedMaterializedRow(
      "10_feed_items",
      globalId,
    );
    const item = row as unknown as FeedItem | null;
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

/** Archive every eligible item through bounded IndexedDB scans and intents. */
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

/** Repair every saved and archived item through bounded IndexedDB scans. */
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

/** Delete every archived, unsaved item through bounded IndexedDB scans. */
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
  const row = await getPortableStore().readSelectedMaterializedRow(
    "10_feed_items",
    globalId,
  );
  const item = row as unknown as FeedItem | null;
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

/** Queue one signed FeedItem removal and remove it from local IndexedDB. */
export async function enqueuePwaLibraryCoreFeedItemRemove(
  globalId: string,
): Promise<void> {
  if (!globalId) throw new TypeError("remove entity ID is required");
  await getPortableStore().enqueueFeedItemRemove({
    entityId: globalId,
    removedAtMs: Date.now(),
  });
}

/** Queue one signed FeedItem capture and expose it from local IndexedDB. */
export async function enqueuePwaLibraryCoreFeedItemCapture(
  item: FeedItem,
): Promise<void> {
  await enqueuePwaLibraryCoreFeedItemCaptures([item]);
}

/** Queue bounded signed FeedItem captures and expose them from IndexedDB. */
export async function enqueuePwaLibraryCoreFeedItemCaptures(
  items: readonly FeedItem[],
): Promise<void> {
  if (items.length === 0) return;
  let batch: FeedItem[] = [];
  let identities = new Set<string>();
  const flush = async () => {
    if (batch.length === 0) return;
    await getPortableStore().enqueueFeedItemCaptures(batch);
    batch = [];
    identities = new Set<string>();
  };
  for (const input of items) {
    const item = sanitizeFeedItemWrite(input) as FeedItem;
    if (
      batch.length === PWA_LIBRARY_CORE_FEED_ITEM_UPSERT_BATCH_LIMIT ||
      identities.has(item.globalId)
    ) {
      await flush();
    }
    batch.push(item);
    identities.add(item.globalId);
  }
  await flush();
  const state = await readSelectedState();
  if (state) publishState(state);
}

/** Queue one signed RSS feed upsert and update the selected IndexedDB shell. */
export async function enqueuePwaLibraryCoreRssFeedUpsert(
  input: RssFeed,
): Promise<void> {
  const feed = sanitizeRssFeedWrite(input) as RssFeed;
  await getPortableStore().enqueueRssFeedUpsert(feed);
  const state = await readSelectedState();
  if (state) publishState(state);
}

/** Queue one signed RSS removal, optionally removing its local feed items. */
export async function enqueuePwaLibraryCoreRssFeedRemove(
  url: string,
  includeItems: boolean,
): Promise<void> {
  await getPortableStore().enqueueRssFeedRemove({
    includeItems,
    removedAtMs: Date.now(),
    url,
  });
  const state = await readSelectedState();
  if (state) publishState(state);
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

/** Queue one synchronized preference patch and update the selected shell. */
export async function enqueuePwaLibraryCorePreferencesPatch(
  updates: Partial<UserPreferences>,
): Promise<void> {
  await getPortableStore().enqueuePreferencesLeafAssignment(updates);
  const state = await readSelectedState();
  if (state) publishState(state);
}

/** Queue one whole sanitized Person and update the selected IndexedDB shell. */
export async function enqueuePwaLibraryCorePersonUpsert(
  person: Person,
): Promise<void> {
  await enqueuePwaLibraryCorePersonUpserts([person]);
}

/** Queue one bounded batch of whole sanitized Persons and update the selected shell. */
export async function enqueuePwaLibraryCorePersonUpserts(
  persons: readonly Person[],
): Promise<void> {
  const synchronized = persons.map(
    (person) => sanitizePersonWrite(person) as Person,
  );
  for (
    let offset = 0;
    offset < synchronized.length;
    offset += PWA_LIBRARY_CORE_PERSON_UPSERT_BATCH_LIMIT
  ) {
    await getPortableStore().enqueuePersonUpserts(
      synchronized.slice(
        offset,
        offset + PWA_LIBRARY_CORE_PERSON_UPSERT_BATCH_LIMIT,
      ),
    );
  }
  const state = await readSelectedState();
  if (state) publishState(state);
}

/** Queue one atomic Person and linked-account removal and refresh the shell. */
export async function enqueuePwaLibraryCorePersonRemove(
  personId: string,
): Promise<void> {
  await getPortableStore().enqueuePersonRemove(personId, Date.now());
  const state = await readSelectedState();
  if (state) publishState(state);
}

/** Queue one whole sanitized Account and update the selected IndexedDB shell. */
export async function enqueuePwaLibraryCoreAccountUpsert(
  account: Account,
): Promise<void> {
  await enqueuePwaLibraryCoreAccountUpserts([account]);
}

/** Queue one bounded batch of whole sanitized Accounts and update the selected shell. */
export async function enqueuePwaLibraryCoreAccountUpserts(
  accounts: readonly Account[],
): Promise<void> {
  const synchronized = accounts.map(
    (account) => sanitizeAccountWrite(account) as Account,
  );
  for (
    let offset = 0;
    offset < synchronized.length;
    offset += PWA_LIBRARY_CORE_ACCOUNT_UPSERT_BATCH_LIMIT
  ) {
    await getPortableStore().enqueueAccountUpserts(
      synchronized.slice(
        offset,
        offset + PWA_LIBRARY_CORE_ACCOUNT_UPSERT_BATCH_LIMIT,
      ),
    );
  }
  const state = await readSelectedState();
  if (state) publishState(state);
}

/** Queue one Account removal and refresh the selected IndexedDB shell. */
export async function enqueuePwaLibraryCoreAccountRemove(
  accountId: string,
): Promise<void> {
  await getPortableStore().enqueueAccountRemove(accountId, Date.now());
  const state = await readSelectedState();
  if (state) publishState(state);
}

async function enqueuePwaLibraryCoreUserStateAssignments(
  globalIds: readonly string[],
  field: FeedItemUserStateAssignmentFieldV1,
  assigned: boolean,
): Promise<void> {
  if (globalIds.length === 0) return;
  const assignedAtMs = Date.now();
  await getPortableStore().enqueueUserStateAssignments(
    globalIds.map((entityId) => ({
      assigned,
      assignedAtMs,
      entityId,
      field,
    })),
  );
}

/**
 * Visit the complete selected PWA Library one bounded IndexedDB page at a time.
 *
 * Shared search, facet, and command surfaces already consume this contract
 * without retaining the scanned corpus. Keeping the adapter here means an
 * active Library Core PWA never has to restart Automerge merely to search
 * beyond its initial renderer window.
 */
export const scanPwaLibraryCoreItems: ScanLibraryItems = async (visit) => {
  const store = getPortableStore();
  const readModelRevision = libraryReadModelRevision;
  let cursor: string | null = null;
  let source: Readonly<{
    generationId: string;
    selectionSequence: number;
  }> | null = null;
  const assertSourceCurrent = async () => {
    if (libraryReadModelRevision !== readModelRevision) {
      throw new Error("Selected PWA Library changed during its bounded scan");
    }
    if (!source) return;
    const selected = await store.readSelectedCheckpointReceipt();
    if (
      !selected ||
      selected.generationId !== source.generationId ||
      selected.selectionSequence !== source.selectionSequence
    ) {
      throw new Error("Selected PWA Library changed during its bounded scan");
    }
  };
  do {
    const page = await store.readSelectedMaterializedPage({
      cursor,
      limit: LIBRARY_SCAN_PAGE_LIMIT,
    });
    if (source === null) source = page.source;
    else if (
      page.source.generationId !== source.generationId ||
      page.source.selectionSequence !== source.selectionSequence
    ) {
      throw new Error("Selected PWA Library changed during its bounded scan");
    }
    const items: FeedItem[] = [];
    for (const entry of page.entries) {
      if (entry.registryKey === "10_feed_items") {
        items.push(entry.row as unknown as FeedItem);
      }
    }
    if (items.length > 0 && (await visit(Object.freeze(items))) === "stop") {
      await assertSourceCurrent();
      return;
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  await assertSourceCurrent();
};

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

/** Open the complete Person-first Friends feed through bounded IndexedDB pages. */
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
  _rankingClockMs: number,
): Promise<BoundedFeedReader> {
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

/** Read compact Friends graph activity from bounded IndexedDB scans. */
export const readPwaLibraryCoreFriendsGraph: NonNullable<
  PlatformConfig["readLibraryFriendsGraph"]
> = (request) => getIndexedDbReaders().readFriendsGraph(request);

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
> = (request) => getIndexedDbReaders().readFriendsLocationItem(request);

/** Read bounded Map or Story Wall candidates through normalized SQLite. */
export const readPwaLibraryCoreSurfaceItems: NonNullable<
  PlatformConfig["readLibrarySurfaceItems"]
> = (surface) =>
  readLibraryCoreNormalizedSurfaceItemsV1(NORMALIZED_READER_RUNTIME, surface);

async function publishSelectedStateAfterLibraryCoreSync(): Promise<LibraryState> {
  const state = await readSelectedState();
  if (!state) {
    throw new Error("Imported SQLite Library checkpoint has no readable shell");
  }
  publishState(state);
  return state;
}

/**
 * Import the sole published immutable Desktop checkpoint into IndexedDB.
 * This is the production PWA Library path. Setting the activation key to
 * `"0"` is the local emergency rollback switch.
 */
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
  const store = getPortableStore();
  await importLibraryCorePortableCheckpointV1({
    adapter,
    generation: pointer.generation,
    libraryId: pointer.libraryId,
    manifest: pointer.manifest,
    storageEpoch: pointer.storageEpoch,
    subtle: crypto.subtle,
    writer: store,
  });
  intentOverlayRecoveryState = await store.readIntentOverlayRecoveryState();
  if (readPwaLibraryCoreIntentOverlayRecoveryState().status !== "ready") {
    return publishSelectedStateAfterLibraryCoreSync();
  }
  const acceptedAuthority = await store.readSelectedAcceptedAuthorityState();
  if (acceptedAuthority === null) {
    throw new Error(
      "Imported SQLite Library checkpoint has no accepted authority",
    );
  }
  const enrollments = await discoverGoogleDriveLibraryCoreActorEnrollmentsV1({
    accessToken: input.accessToken,
    epochId: acceptedAuthority.epoch_id,
    libraryId: acceptedAuthority.library_id,
    signal: input.signal,
  });
  for (const enrollment of enrollments) {
    await store.installActorEnrollment({
      acceptedAuthorityState: acceptedAuthority,
      certificateBytes: enrollment.bytes,
    });
  }
  const enrollment = await store.preparePwaActorEnrollmentRequest();
  if (enrollment && enrollment.publishedReference === null) {
    const uploaded = await adapter.putImmutable(enrollment.immutableObject);
    const reference = Object.freeze({
      descriptor: enrollment.immutableObject.descriptor,
      transportObjectId: uploaded.transportObjectId,
    });
    await adapter.verifyImmutable(reference);
    await store.recordPwaActorEnrollmentRequestPublication({
      actorId: enrollment.actorId,
      authorityStateDigest: enrollment.authorityStateDigest,
      libraryId: enrollment.acceptedAuthorityState
        .library_id as unknown as LibraryCoreOperationInstanceId,
      reference,
    });
  }
  const pendingActors = await store.readPendingIntentActors({
    epochId: pointer.storageEpoch,
    libraryId: pointer.libraryId,
  });
  for (const actor of pendingActors) {
    let candidate = await store.readUnpublishedIntentSegmentCandidate(actor);
    if (candidate === null) continue;
    const provisioned = await provisionGoogleDriveLibraryCoreIntentHeadV1({
      accessToken: input.accessToken,
      head: candidate.expectedHead,
      signal: input.signal,
    });
    const intentAdapter = createGoogleDriveLibraryCoreIntentAdapterV1({
      accessToken: input.accessToken,
      actorId: actor.actorId,
      controlFileId: discovered.controlFileId,
      epochId: actor.epochId,
      intentHeadFileId: provisioned.intentHeadFileId,
      libraryId: pointer.libraryId,
      signal: input.signal,
    });
    let publishedSegmentCount = 0;
    while (candidate !== null) {
      if (publishedSegmentCount >= MAXIMUM_INTENT_SEGMENTS_PER_SYNC) {
        throw new Error("PWA intent publication exceeded its sync bound");
      }
      const published = await publishLibraryCoreIntentCandidateV1({
        adapter: intentAdapter,
        candidate,
        subtle: crypto.subtle,
      });
      if (published.status === "conflict") {
        throw new Error(
          `PWA intent head changed for actor ...${actor.actorId.slice(-8)}`,
        );
      }
      await store.recordIntentSegmentPublication(published);
      publishedSegmentCount += 1;
      candidate = await store.readUnpublishedIntentSegmentCandidate(actor);
    }
  }
  const resultActors = await store.readIntentActors({
    epochId: pointer.storageEpoch,
    libraryId: pointer.libraryId,
  });
  for (const actor of resultActors) {
    const locator = await discoverGoogleDriveLibraryCoreResultHeadV1({
      accessToken: input.accessToken,
      actorId: actor.actorId,
      epochId: pointer.storageEpoch,
      libraryId: pointer.libraryId,
      signal: input.signal,
    });
    if (locator === null) continue;
    const resultAdapter = createGoogleDriveLibraryCoreResultAdapterV1({
      accessToken: input.accessToken,
      actorId: actor.actorId,
      controlFileId: discovered.controlFileId,
      epochId: pointer.storageEpoch,
      libraryId: pointer.libraryId,
      resultHeadFileId: locator.resultHeadFileId,
      signal: input.signal,
    });
    const resultHead = (await resultAdapter.readResultHead()).head;
    if (resultHead.epoch_id !== pointer.storageEpoch) {
      throw new Error("PWA result head belongs to a retired writer epoch");
    }
    const discoveredSegments =
      await discoverGoogleDriveLibraryCoreResultSegmentsV1({
        accessToken: input.accessToken,
        actorId: actor.actorId,
        epochId: pointer.storageEpoch,
        libraryId: pointer.libraryId,
        signal: input.signal,
      });
    const cursor = await store.readResultImportCursor(actor);
    const segments = discoveredSegments.filter(
      (segment) => segment.lastResultSequence >= cursor.nextResultSequence,
    );
    if (segments.length > MAXIMUM_RESULT_SEGMENTS_PER_SYNC) {
      throw new Error("PWA pending result import exceeded its sync bound");
    }
    let nextResultSequence = cursor.nextResultSequence;
    let previousSegmentDigest = cursor.latestSegmentDigest;
    for (const segment of segments) {
      if (segment.firstResultSequence !== nextResultSequence) {
        throw new Error("PWA result segment chain has a gap or overlap");
      }
      await importLibraryCoreResultSegmentV1({
        actorId: actor.actorId,
        adapter: resultAdapter,
        expectedFirstResultSequence: nextResultSequence,
        expectedPreviousSegmentDigest: previousSegmentDigest,
        libraryId: pointer.libraryId,
        reference: segment.reference,
        storageEpoch: pointer.storageEpoch,
        subtle: crypto.subtle,
        writer: store,
      });
      nextResultSequence = segment.lastResultSequence + 1;
      previousSegmentDigest = segment.reference.descriptor.contentDigest;
      if (nextResultSequence >= resultHead.next_result_sequence) break;
    }
    if (
      nextResultSequence !== resultHead.next_result_sequence ||
      previousSegmentDigest !== resultHead.latest_segment_digest
    ) {
      throw new Error("PWA result objects do not match the actor result head");
    }
  }
  return publishSelectedStateAfterLibraryCoreSync();
}

registerPwaFactoryResetQuiesceHandler(
  "library-core-storage",
  async () => {
    await resetPwaNormalizedLibrary();
    await indexedDbReaders?.quiesce();
    indexedDbReaders = null;
    await portableStore?.quiesce();
    portableStore = null;
    lastState = null;
    libraryReadModelRevision = 0;
    intentOverlayRecoveryState = READY_INTENT_OVERLAY_RECOVERY;
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
    await deleteDatabase(DATABASE_NAME);
    await deleteDatabase(READ_MODEL_DATABASE_NAME);
  },
  25,
);
