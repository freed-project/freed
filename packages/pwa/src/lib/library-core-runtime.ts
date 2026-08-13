import {
  createDefaultPreferences,
  friendFromPerson,
  sanitizeRssFeedWrite,
  type Account,
  type FeedItem,
  type Person,
  type RssFeed,
  type UserPreferences,
} from "@freed/shared";
import { sanitizePersonWrite } from "@freed/shared";
import {
  LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT,
  libraryCoreFeedCardToItemV1,
  normalizeLibraryCoreFeedBrowseFilterV1,
  parseLibraryCoreControlPointerV1,
  type LibraryCoreCanonicalValue,
  type FeedItemUserStateAssignmentFieldV1,
  type LibraryCoreOperationInstanceId,
} from "@freed/shared/library-core";
import type { FilterOptions } from "@freed/shared";
import type {
  BoundedFeedReader,
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
} from "@freed/sync/cloud";
import type { DocState } from "./automerge-types";
import { registerPwaFactoryResetQuiesceHandler } from "./factory-reset-coordinator";
import {
  createPwaLibraryCorePortableCheckpointStore,
  PWA_LIBRARY_CORE_PERSON_UPSERT_BATCH_LIMIT,
} from "./library-core-portable-checkpoint-store";
import { PwaLibraryCoreSearchIndex } from "./library-core-search-index";

export const PWA_LIBRARY_CORE_ENABLED_KEY =
  "freed.libraryCore.pwaIndexedDbV1.enabled";

const DATABASE_NAME = "freed-library-core-portable-v1";
const SEARCH_DATABASE_NAME = "freed-library-core-search-v1";
const MAXIMUM_INITIAL_FEED_ITEMS = 512;
const COLLECTION_PAGE_LIMIT = 128;
const LIBRARY_SCAN_PAGE_LIMIT = 32;
const MAXIMUM_INTENT_SEGMENTS_PER_SYNC = 128;
const MAXIMUM_RESULT_SEGMENTS_PER_SYNC = 128;

type LibraryCoreStateListener = (state: DocState) => void;

const listeners = new Set<LibraryCoreStateListener>();
let lastState: DocState | null = null;

let portableStore: ReturnType<
  typeof createPwaLibraryCorePortableCheckpointStore
> | null = null;
let searchIndex: PwaLibraryCoreSearchIndex | null = null;

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

function getSearchIndex(): PwaLibraryCoreSearchIndex {
  searchIndex ??= new PwaLibraryCoreSearchIndex({
    databaseName: SEARCH_DATABASE_NAME,
    indexedDb: globalThis.indexedDB,
    keyRange: globalThis.IDBKeyRange,
  });
  return searchIndex;
}

function emptyState(): DocState {
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
): DocState {
  const base = { ...emptyState(), ...shell } as DocState;
  const persons = base.persons as Record<string, Person>;
  const accounts = base.accounts as Record<string, Account>;
  return {
    ...base,
    items,
    friends: Object.fromEntries(
      Object.values(persons).map((person) => [
        person.id,
        friendFromPerson(person, accounts),
      ]),
    ),
  };
}

function materializedEntry(
  value: LibraryCoreCanonicalValue,
): { readonly registryKey: string; readonly row: unknown } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Readonly<Record<string, LibraryCoreCanonicalValue>>;
  if (
    typeof record.registry_key !== "string" ||
    typeof record.row !== "object" ||
    record.row === null ||
    Array.isArray(record.row)
  ) {
    return null;
  }
  return { registryKey: record.registry_key, row: record.row };
}

async function readSelectedState(): Promise<DocState | null> {
  const store = getPortableStore();
  const shell = await store.readSelectedMaterializedRow(
    "00_library_shell",
    "shell",
  );
  if (!shell) return null;

  const items: FeedItem[] = [];
  let afterOrdinal: number | null = null;
  do {
    const page = await store.readSelectedCollectionPage({
      afterOrdinal,
      collection: "materialized_rows",
      limit: COLLECTION_PAGE_LIMIT,
    });
    for (const entry of page.entries) {
      const materialized = materializedEntry(entry.value);
      if (materialized?.registryKey === "10_feed_items") {
        items.push(materialized.row as FeedItem);
        if (items.length >= MAXIMUM_INITIAL_FEED_ITEMS) break;
      }
    }
    afterOrdinal = page.nextOrdinal;
  } while (afterOrdinal !== null && items.length < MAXIMUM_INITIAL_FEED_ITEMS);

  return stateFromShell(shell, items);
}

function publishState(state: DocState): void {
  lastState = state;
  for (const listener of listeners) listener(state);
}

export function isPwaLibraryCoreEnabled(): boolean {
  try {
    return localStorage.getItem(PWA_LIBRARY_CORE_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function subscribePwaLibraryCoreState(
  listener: LibraryCoreStateListener,
): () => void {
  listeners.add(listener);
  if (lastState) listener(lastState);
  return () => listeners.delete(listener);
}

export async function initializePwaLibraryCoreState(): Promise<DocState> {
  const state = (await readSelectedState()) ?? emptyState();
  publishState(state);
  return state;
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
    await refreshPersistentSearchItems(batch);
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
  if (searchIndex && lastState) {
    await searchIndex.removeItems(lastState.searchCorpusVersion, [globalId]);
  }
}

/** Queue one signed FeedItem capture and expose it from local IndexedDB. */
export async function enqueuePwaLibraryCoreFeedItemCapture(
  item: FeedItem,
): Promise<void> {
  await getPortableStore().enqueueFeedItemCapture(item);
  if (searchIndex && lastState) {
    await searchIndex.updateItems(lastState.searchCorpusVersion, [item]);
  }
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
  await refreshPersistentSearchItems(globalIds);
}

async function refreshPersistentSearchItems(
  globalIds: readonly string[],
): Promise<void> {
  if (!searchIndex || !lastState) return;
  const items: FeedItem[] = [];
  for (const globalId of globalIds) {
    const row = await getPortableStore().readSelectedMaterializedRow(
      "10_feed_items",
      globalId,
    );
    if (row?.globalId === globalId) items.push(row as unknown as FeedItem);
  }
  await searchIndex.updateItems(lastState.searchCorpusVersion, items);
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
  let afterOrdinal: number | null = null;
  do {
    const page = await store.readSelectedCollectionPage({
      afterOrdinal,
      collection: "materialized_rows",
      limit: LIBRARY_SCAN_PAGE_LIMIT,
    });
    const items: FeedItem[] = [];
    for (const entry of page.entries) {
      const materialized = materializedEntry(entry.value);
      if (materialized?.registryKey === "10_feed_items") {
        items.push(materialized.row as FeedItem);
      }
    }
    if (items.length > 0 && (await visit(Object.freeze(items))) === "stop") {
      return;
    }
    afterOrdinal = page.nextOrdinal;
  } while (afterOrdinal !== null);
};

/** Search the selected Library through a persistent IndexedDB projection. */
export const searchPwaLibraryCoreItems: SearchLibraryItems = async (
  query,
  searchCorpusVersion,
  visit,
) => {
  const index = getSearchIndex();
  await index.ensureBuilt(searchCorpusVersion, scanPwaLibraryCoreItems);
  await index.search(query, searchCorpusVersion, visit);
};

/** Read one complete FeedItem from the selected IndexedDB generation. */
export async function readPwaLibraryCoreItemDetail(
  globalId: string,
): Promise<FeedItem | null> {
  const row = await getPortableStore().readSelectedMaterializedRow(
    "10_feed_items",
    globalId,
  );
  if (row === null) return null;
  if (row.globalId !== globalId) {
    throw new Error("Selected PWA Library item identity is inconsistent");
  }
  return row as unknown as FeedItem;
}

function supportsPortableFeedFilter(filter: FilterOptions): boolean {
  const normalized = normalizeLibraryCoreFeedBrowseFilterV1(filter);
  return (
    !normalized.archivedOnly &&
    normalized.authorId === null &&
    normalized.feedUrl === null &&
    normalized.platform === null &&
    !normalized.savedOnly &&
    !normalized.showHidden &&
    normalized.signals.length === 0 &&
    normalized.socialContentFilter === "all" &&
    normalized.tags.length === 0
  );
}

/** Open the complete ordinary feed directly from the selected IndexedDB generation. */
export async function openPwaLibraryCoreFeedReader(
  filter: FilterOptions,
): Promise<BoundedFeedReader> {
  if (!supportsPortableFeedFilter(filter)) {
    throw new Error(
      "This SQLite Library filter does not have a bounded PWA reader yet",
    );
  }
  const store = getPortableStore();
  const readerSessionId = crypto.randomUUID();
  let cursor: string | null = null;
  let closed = false;
  let lastCancellationId = crypto.randomUUID();
  let firstPage: Awaited<ReturnType<typeof store.readSelectedFeedPage>> | null =
    await store.readSelectedFeedPage({
      cancellationId: lastCancellationId,
      cursor: null,
      limit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
      queryId: "feed_page_v1",
      readerSessionId,
      schemaVersion: 1,
    });
  if (!firstPage.ok) throw new Error(firstPage.message);
  cursor = firstPage.value.nextCursor;
  const totalCount = firstPage.value.totalCount;
  return Object.freeze({
    totalCount,
    async readNext() {
      if (closed) return Object.freeze([]);
      if (firstPage) {
        const page = firstPage;
        firstPage = null;
        if (!page.ok) throw new Error(page.message);
        return Object.freeze(page.value.rows.map(libraryCoreFeedCardToItemV1));
      }
      if (cursor === null) return Object.freeze([]);
      lastCancellationId = crypto.randomUUID();
      const page = await store.readSelectedFeedPage({
        cancellationId: lastCancellationId,
        cursor,
        limit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
        queryId: "feed_page_v1",
        readerSessionId,
        schemaVersion: 1,
      });
      if (!page.ok) throw new Error(page.message);
      cursor = page.value.nextCursor;
      return Object.freeze(page.value.rows.map(libraryCoreFeedCardToItemV1));
    },
    async close() {
      store.cancelSelectedFeedReader(readerSessionId, lastCancellationId);
      closed = true;
      firstPage = null;
      cursor = null;
    },
  });
}

/**
 * Import the sole published immutable Desktop checkpoint into IndexedDB.
 * This is the production PWA Library path. Setting the activation key to
 * `"0"` is the local emergency rollback switch.
 */
export async function syncPwaLibraryCoreFromGoogleDrive(input: {
  readonly accessToken: string;
  readonly signal?: AbortSignal;
}): Promise<DocState> {
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
  await importLibraryCorePortableCheckpointV1({
    adapter,
    generation: pointer.generation,
    libraryId: pointer.libraryId,
    manifest: pointer.manifest,
    storageEpoch: pointer.storageEpoch,
    subtle: crypto.subtle,
    writer: getPortableStore(),
  });
  const store = getPortableStore();
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
  const state = await readSelectedState();
  if (!state) {
    throw new Error("Imported SQLite Library checkpoint has no readable shell");
  }
  if (searchIndex) {
    if (lastState?.searchCorpusVersion !== state.searchCorpusVersion) {
      await searchIndex.invalidate();
    } else {
      await searchIndex.updateItems(state.searchCorpusVersion, state.items);
    }
  }
  publishState(state);
  return state;
}

registerPwaFactoryResetQuiesceHandler(
  "library-core-indexeddb",
  async () => {
    await portableStore?.quiesce();
    portableStore = null;
    await searchIndex?.close();
    searchIndex = null;
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
    await deleteDatabase(DATABASE_NAME);
    await deleteDatabase(SEARCH_DATABASE_NAME);
  },
  25,
);
