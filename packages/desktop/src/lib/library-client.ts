/**
 * Freed Desktop Library client.
 *
 * Production calls native SQLite directly. No document worker or WASM database
 * runtime is loaded by this client.
 */

import { hashSavedUrl } from "@freed/capture-save/normalize";
import {
  CONTENT_SIGNAL_KEYS,
  CONTENT_SIGNAL_VERSION,
  collectSavedYouTubeVideoUrls,
  inferContentSignals,
  inferEventCandidate,
  type Account,
  type ContentSignal,
  type ContentSignalBackfillSummary,
  type DesktopClientRegistration,
  type FeedItem,
  type Person,
  type RssFeed,
  type SampleDataClearSummary,
  type UserPreferences,
} from "@freed/shared";
import type {
  LibraryMutationEvent,
  RssFeedRefreshUpdate,
  LibraryMutationRequest,
} from "./library-types";
import {
  LIBRARY_CORE_CHANGE_FEED_MAXIMUM_LIMIT,
  LIBRARY_CORE_CHANGE_FEED_QUERY_ID,
  LIBRARY_CORE_CHANGE_FEED_SCHEMA_VERSION,
  LIBRARY_CORE_LOCAL_CHANGE_FEED_QUERY_ID,
  LIBRARY_CORE_OPTIMISTIC_FIELDS_QUERY_ID,
  LIBRARY_CORE_OPTIMISTIC_FIELDS_SCHEMA_VERSION,
  LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
  LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
  type LibraryCoreChangeFeedResponseV1,
  type LibraryCoreLocalChangeFeedResponseV1,
  type LibraryCoreOptimisticFieldsResponseV1,
  type LibraryCoreRuntimeStateV1,
} from "@freed/shared/library-core";
import {
  registerLibraryAccessors,
  setLibrarySnapshot,
} from "@freed/ui/lib/debug-store";
import {
  dispatchSqliteMutation,
  commitDesktopLibraryFeedItemAnalysisSets,
  ensureFreshNormalizedDesktopLibrary,
  loadSqliteLibraryState,
  readSqliteItems,
  resetNormalizedLibrary,
} from "./sqlite-library";
import {
  readLibraryCoreAnalysisCandidateBatch,
  scanLibraryCoreBackgroundItems,
} from "./library-core-item-detail-runtime";
import { hasLegacyLibraryData } from "./legacy-library-presence";
import {
  createDesktopLibraryCoreOperationId,
  queryNormalizedLibrary,
} from "./library-core-normalized-query-client";
import { libraryMutationEventsFromChangeFeed } from "./library-core-change-feed-runtime";

export type { LibraryMutationEvent } from "./library-types";

type Subscriber = (
  state: LibraryCoreRuntimeStateV1,
  event: LibraryMutationEvent,
) => void;

const subscribers = new Set<Subscriber>();
let lastState: LibraryCoreRuntimeStateV1 | null = null;
let nextRequestId = 1;
let mutationQueue: Promise<void> = Promise.resolve();
let lastLocalChangeSequence = 0;

function registerSqliteDebugAccessors(): void {
  registerLibraryAccessors(
    () => lastState,
    () => JSON.stringify(lastState),
  );
}

function updateSqliteDebugSnapshot(state: LibraryCoreRuntimeStateV1): void {
  setLibrarySnapshot({
    libraryId: "sqlite-library",
    itemCount: state.totalItemCount,
    feedCount: state.rssFeedCount,
    savedAt: Date.now(),
  });
}

function publish(
  state: LibraryCoreRuntimeStateV1,
  event: LibraryMutationEvent,
): void {
  lastState = state;
  updateSqliteDebugSnapshot(state);
  for (const subscriber of subscribers) subscriber(state, event);
}

async function publishCanonicalChangeFeed(
  state: LibraryCoreRuntimeStateV1,
  afterRevision: number,
  mutation?: LibraryMutationRequest["type"],
): Promise<boolean> {
  if (state.searchCorpusVersion <= afterRevision) return false;
  const readerSessionId = createDesktopLibraryCoreOperationId(
    "desktop-change-feed-reader",
  );
  const cancellationId = createDesktopLibraryCoreOperationId(
    "desktop-change-feed-cancel",
  );
  let cursor: string | null = null;
  let published = false;
  do {
    const response: LibraryCoreChangeFeedResponseV1 =
      await queryNormalizedLibrary({
        afterRevision,
        cancellationId,
        cursor,
        limit: LIBRARY_CORE_CHANGE_FEED_MAXIMUM_LIMIT,
        queryId: LIBRARY_CORE_CHANGE_FEED_QUERY_ID,
        readerSessionId,
        schemaVersion: LIBRARY_CORE_CHANGE_FEED_SCHEMA_VERSION,
      });
    if (response.source.projectionRevision !== state.searchCorpusVersion) {
      throw new Error(
        "SQLite Library changed while invalidations were loading",
      );
    }
    const changedItemIds = [
      ...new Set(
        response.rows.flatMap((row) =>
          row.topic === "feed_item" && row.entityId !== null
            ? [row.entityId]
            : [],
        ),
      ),
    ];
    const changedItems = await readSqliteItems(changedItemIds);
    const sourceCheck = await queryNormalizedLibrary({
      queryId: LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
      schemaVersion: LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
    });
    if (sourceCheck.source.projectionRevision !== state.searchCorpusVersion) {
      throw new Error(
        "SQLite Library changed while invalidation identities were resolving",
      );
    }
    for (const event of libraryMutationEventsFromChangeFeed(
      response.rows,
      changedItems,
      mutation,
    )) {
      publish(state, event);
      published = true;
    }
    cursor = response.nextCursor;
  } while (cursor !== null);
  return published;
}

async function readLocalChangeSequence(
  expectedCanonicalRevision: number,
): Promise<number> {
  const response: LibraryCoreOptimisticFieldsResponseV1 =
    await queryNormalizedLibrary({
      entityIds: [],
      queryId: LIBRARY_CORE_OPTIMISTIC_FIELDS_QUERY_ID,
      schemaVersion: LIBRARY_CORE_OPTIMISTIC_FIELDS_SCHEMA_VERSION,
    });
  if (response.source.projectionRevision !== expectedCanonicalRevision) {
    throw new Error("SQLite Library changed while local sequence was loading");
  }
  return response.source.transitionSequence;
}

async function publishLocalChangeFeed(
  state: LibraryCoreRuntimeStateV1,
  afterSequence: number,
  mutation?: LibraryMutationRequest["type"],
): Promise<{ readonly published: boolean; readonly sequence: number }> {
  const readerSessionId = createDesktopLibraryCoreOperationId(
    "desktop-local-change-reader",
  );
  const cancellationId = createDesktopLibraryCoreOperationId(
    "desktop-local-change-cancel",
  );
  let cursor: string | null = null;
  let published = false;
  let upperSequence = afterSequence;
  do {
    const response: LibraryCoreLocalChangeFeedResponseV1 =
      await queryNormalizedLibrary({
        afterRevision: afterSequence,
        cancellationId,
        cursor,
        limit: LIBRARY_CORE_CHANGE_FEED_MAXIMUM_LIMIT,
        queryId: LIBRARY_CORE_LOCAL_CHANGE_FEED_QUERY_ID,
        readerSessionId,
        schemaVersion: LIBRARY_CORE_CHANGE_FEED_SCHEMA_VERSION,
      });
    if (response.source.projectionRevision !== state.searchCorpusVersion) {
      throw new Error(
        "SQLite Library changed while local invalidations were loading",
      );
    }
    upperSequence = response.source.transitionSequence;
    const changedItemIds = [
      ...new Set(
        response.rows.flatMap((row) =>
          row.topic === "feed_item" && row.entityId !== null
            ? [row.entityId]
            : [],
        ),
      ),
    ];
    const changedItems = await readSqliteItems(changedItemIds);
    for (const event of libraryMutationEventsFromChangeFeed(
      response.rows,
      changedItems,
      mutation,
    )) {
      publish(state, event);
      published = true;
    }
    cursor = response.nextCursor;
  } while (cursor !== null);
  const currentSequence = await readLocalChangeSequence(
    state.searchCorpusVersion,
  );
  if (currentSequence !== upperSequence) {
    throw new Error(
      "SQLite Library changed while local invalidation identities were resolving",
    );
  }
  return Object.freeze({ published, sequence: currentSequence });
}

async function ensureInitialized(): Promise<LibraryCoreRuntimeStateV1> {
  if (lastState) return lastState;
  let normalizedSelected = await ensureFreshNormalizedDesktopLibrary(false);
  let legacyDataPresent = false;
  if (!normalizedSelected) {
    legacyDataPresent = await hasLegacyLibraryData();
    normalizedSelected =
      await ensureFreshNormalizedDesktopLibrary(!legacyDataPresent);
  }
  if (!normalizedSelected) {
    throw new Error(
      legacyDataPresent
        ? "Freed Desktop could not complete the one-time SQLite Library transition. The historical source remains untouched."
        : "Freed Desktop could not establish SQLite Library authority.",
    );
  }
  const state = await loadSqliteLibraryState();
  lastLocalChangeSequence = await readLocalChangeSequence(
    state.searchCorpusVersion,
  );
  lastState = state;
  registerSqliteDebugAccessors();
  updateSqliteDebugSnapshot(state);
  return state;
}

async function dispatch(message: LibraryMutationRequest): Promise<unknown> {
  let result: unknown;
  const operation = mutationQueue.then(async () => {
    await ensureInitialized();
    const previousRevision = lastState?.searchCorpusVersion ?? 0;
    const previousLocalSequence = lastLocalChangeSequence;
    const dispatched = await dispatchSqliteMutation(message);
    result = dispatched.result;
    let published = false;
    if (dispatched.state.searchCorpusVersion > previousRevision) {
      try {
        published = await publishCanonicalChangeFeed(
          dispatched.state,
          previousRevision,
          message.type,
        );
      } catch {
        // The mutation is already durable. Publish one bounded reset instead
        // of reporting a false mutation failure after an invalidation race.
      }
    }
    try {
      const local = await publishLocalChangeFeed(
        dispatched.state,
        previousLocalSequence,
        message.type,
      );
      lastLocalChangeSequence = local.sequence;
      published = local.published || published;
    } catch {
      lastLocalChangeSequence = await readLocalChangeSequence(
        dispatched.state.searchCorpusVersion,
      );
      publish(dispatched.state, {
        source: "state_update",
        mutation: message.type,
        changedItemIds: null,
        requiresFullScan: true,
      });
      return;
    }
    if (published) return;
    // A pending follower intent does not advance canonical authority. Its
    // local optimistic hint remains device-local until an accepted result
    // enters the canonical change feed.
    publish(dispatched.state, dispatched.event);
  });
  mutationQueue = operation.catch(() => undefined);
  await operation;
  return result;
}

function request<T extends { readonly type: LibraryMutationRequest["type"] }>(
  message: T,
): Promise<unknown> {
  return dispatch({
    ...message,
    reqId: nextRequestId++,
  } as unknown as LibraryMutationRequest);
}

export function subscribeDesktopLibraryRuntime(
  callback: Subscriber,
): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export async function initializeDesktopLibraryRuntime(
  _registration?: DesktopClientRegistration,
): Promise<LibraryCoreRuntimeStateV1> {
  return ensureInitialized();
}

export function getDesktopLibraryRuntimeState(): LibraryCoreRuntimeStateV1 | null {
  return lastState;
}

export async function reloadDesktopLibraryRuntimeState(): Promise<LibraryCoreRuntimeStateV1> {
  const previousRevision = lastState?.searchCorpusVersion ?? null;
  const previousLocalSequence = lastLocalChangeSequence;
  const state = await loadSqliteLibraryState();
  let published = false;
  if (
    previousRevision !== null &&
    state.searchCorpusVersion > previousRevision
  ) {
    try {
      published = await publishCanonicalChangeFeed(state, previousRevision);
    } catch {
      // This call still publishes a row-free reset from the authoritative
      // state, so every bounded reader reopens without a false sync failure.
    }
  }
  try {
    const local = await publishLocalChangeFeed(state, previousLocalSequence);
    lastLocalChangeSequence = local.sequence;
    published = local.published || published;
  } catch {
    lastLocalChangeSequence = await readLocalChangeSequence(
      state.searchCorpusVersion,
    );
  }
  if (published) return state;
  publish(state, {
    source: "state_update",
    mutation: undefined,
    changedItemIds: null,
    requiresFullScan: true,
  });
  return state;
}

export async function getSavedYouTubeVideoUrls(): Promise<string[]> {
  const urls: string[] = [];
  await scanLibraryCoreBackgroundItems((page) => {
    urls.push(...collectSavedYouTubeVideoUrls(page));
    return "continue";
  });
  return urls;
}

export async function getItemPreservedText(
  globalId: string,
): Promise<string | null> {
  const [item] = await readSqliteItems([globalId]);
  return item?.preservedContent?.text ?? null;
}

export async function resetLocalLibrary(): Promise<void> {
  await resetNormalizedLibrary();
  lastState = null;
  lastLocalChangeSequence = 0;
}

export function quiesceDesktopLibraryForFactoryReset(): Promise<void> {
  return mutationQueue;
}

export const addLibraryFeedItem = (item: FeedItem) =>
  request({ type: "ADD_FEED_ITEM", item }).then(() => {});
export const addLibraryFeedItems = (items: FeedItem[]) =>
  request({ type: "ADD_FEED_ITEMS", items }).then(() => {});
export const removeLibraryFeedItem = (globalId: string) =>
  request({ type: "REMOVE_FEED_ITEM", globalId }).then(() => {});
export const updateLibraryFeedItem = (
  globalId: string,
  updates: Partial<FeedItem>,
) => request({ type: "UPDATE_FEED_ITEM", globalId, updates }).then(() => {});
export const markLibraryItemAsRead = (globalId: string) =>
  request({ type: "MARK_AS_READ", globalId }).then(() => {});
export const markLibraryItemsAsRead = (globalIds: string[]) =>
  globalIds.length === 0
    ? Promise.resolve()
    : request({ type: "MARK_ITEMS_AS_READ", globalIds }).then(() => {});
export const markAllLibraryItemsAsRead = (platform?: string) =>
  request({ type: "MARK_ALL_AS_READ", platform }).then(() => {});
export const toggleLibraryItemSaved = (globalId: string) =>
  request({ type: "TOGGLE_SAVED", globalId }).then(() => {});
export const toggleLibraryItemArchived = (globalId: string) =>
  request({ type: "TOGGLE_ARCHIVED", globalId }).then(() => {});
export const archiveLibraryItems = (globalIds: string[]) =>
  globalIds.length === 0
    ? Promise.resolve()
    : request({ type: "ARCHIVE_ITEMS", globalIds }).then(() => {});
export const toggleLibraryItemLiked = (globalId: string) =>
  request({ type: "TOGGLE_LIKED", globalId }).then(() => {});
export const confirmLibraryItemLikedSynced = (
  globalId: string,
  syncedAt?: number,
) =>
  request({ type: "CONFIRM_LIKED_SYNCED", globalId, syncedAt }).then(() => {});
export const confirmLibraryItemSeenSynced = (
  globalId: string,
  syncedAt?: number,
) =>
  request({ type: "CONFIRM_SEEN_SYNCED", globalId, syncedAt }).then(() => {});
export const archiveAllReadUnsavedLibraryItems = (
  platform?: string,
  feedUrl?: string,
) =>
  request({ type: "ARCHIVE_ALL_READ_UNSAVED", platform, feedUrl }).then(
    () => {},
  );
export const unarchiveSavedLibraryItems = () =>
  request({ type: "UNARCHIVE_SAVED_ITEMS" }).then(() => {});
export const pruneArchivedLibraryItems = (maxAgeMs?: number) =>
  request({ type: "PRUNE_ARCHIVED_ITEMS", maxAgeMs }).then(() => {});
export const deleteAllArchivedLibraryItems = () =>
  request({ type: "DELETE_ALL_ARCHIVED" }).then(() => {});
export const addLibraryRssFeed = (feed: RssFeed) =>
  request({ type: "ADD_RSS_FEED", feed }).then(() => {});
export const removeLibraryRssFeed = (url: string, includeItems = false) =>
  request({ type: "REMOVE_RSS_FEED", url, includeItems }).then(() => {});
export const updateLibraryRssFeed = (url: string, updates: Partial<RssFeed>) =>
  request({ type: "UPDATE_RSS_FEED", url, updates }).then(() => {});
export const removeAllLibraryFeeds = (includeItems: boolean) =>
  request({ type: "REMOVE_ALL_FEEDS", includeItems }).then(() => {});
export const updateLibraryPreferences = (updates: Partial<UserPreferences>) =>
  request({ type: "UPDATE_PREFERENCES", updates }).then(() => {});
export const reconcileYouTubeLibraryCapture = (
  accounts: Account[],
  items: FeedItem[],
  options: { rosterComplete: boolean; capturedAt: number },
) =>
  request({ type: "RECONCILE_YOUTUBE_CAPTURE", accounts, items, options }).then(
    () => {},
  );

export const reconcileFollowRosterLibraryCapture = (
  accounts: Account[],
  items: FeedItem[],
  options: { provider: "substack" | "medium"; capturedAt: number },
) =>
  request({
    type: "RECONCILE_FOLLOW_ROSTER_CAPTURE",
    accounts,
    items,
    options,
  }).then(() => {});

export const addSampleLibraryData = (data: {
  feeds: RssFeed[];
  items: FeedItem[];
  persons: Person[];
  accounts: Account[];
}) => request({ type: "ADD_SAMPLE_LIBRARY_DATA", ...data }).then(() => {});

export async function clearSampleLibraryData(): Promise<SampleDataClearSummary> {
  return (await request({
    type: "CLEAR_SAMPLE_DATA",
  })) as SampleDataClearSummary;
}

export async function refreshLibraryFeeds(
  feeds: RssFeedRefreshUpdate[],
  items: FeedItem[],
): Promise<void> {
  await request({ type: "BATCH_REFRESH_FEEDS", feeds, items });
}

export async function importLibraryItems(
  items: FeedItem[],
): Promise<readonly string[]> {
  const result = await request({ type: "BATCH_IMPORT_ITEMS", items });
  if (
    !Array.isArray(result) ||
    result.some((globalId) => typeof globalId !== "string")
  ) {
    throw new TypeError("SQLite import returned invalid inserted identities");
  }
  return Object.freeze([...result] as string[]);
}

export const healUntitledLibraryFeedTitles = () =>
  request({ type: "HEAL_UNTITLED_FEEDS" }).then(() => {});

export async function backfillLibraryContentSignals(
  batchSize = 200,
): Promise<ContentSignalBackfillSummary> {
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1_000
  ) {
    throw new TypeError("content signal batch size is invalid");
  }
  let summary!: ContentSignalBackfillSummary;
  const operation = mutationQueue.then(async () => {
    await ensureInitialized();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let batch: Awaited<
        ReturnType<typeof readLibraryCoreAnalysisCandidateBatch>
      >;
      try {
        batch = await readLibraryCoreAnalysisCandidateBatch(
          CONTENT_SIGNAL_VERSION,
          batchSize,
        );
      } catch (error) {
        if (attempt === 0) continue;
        throw error;
      }
      const beforeCommit = await loadSqliteLibraryState();
      if (beforeCommit.searchCorpusVersion !== batch.sourceRevision) {
        if (attempt === 0) continue;
        throw new Error(
          "Library source changed while selecting semantic analysis candidates",
        );
      }
      const inferredAt = Date.now();
      const analyses = batch.items.map((item) => {
        const contentSignals = inferContentSignals(item, inferredAt);
        return {
          contentSignals,
          entityId: item.globalId,
          eventCandidate:
            inferEventCandidate(item, contentSignals, inferredAt) ?? undefined,
        };
      });
      await commitDesktopLibraryFeedItemAnalysisSets(analyses, inferredAt);
      const state = await reloadDesktopLibraryRuntimeState();
      const counts = Object.fromEntries(
        CONTENT_SIGNAL_KEYS.map((signal) => [
          signal,
          analyses.reduce(
            (count, analysis) =>
              count + Number(analysis.contentSignals.tags.includes(signal)),
            0,
          ),
        ]),
      ) as Record<ContentSignal, number>;
      summary = {
        version: CONTENT_SIGNAL_VERSION,
        total: state.totalItemCount,
        scanned: batch.items.length,
        updated: batch.items.length,
        remaining: batch.remaining ? 1 : 0,
        counts,
        multiSignalCount: analyses.filter(
          (analysis) => analysis.contentSignals.tags.length > 1,
        ).length,
        untaggedCount: analyses.filter(
          (analysis) => analysis.contentSignals.tags.length === 0,
        ).length,
        samples: {},
      };
      return;
    }
  });
  mutationQueue = operation.catch(() => undefined);
  await operation;
  return summary;
}

export async function addLibraryStubItem(
  url: string,
  tags: string[] = [],
): Promise<FeedItem> {
  const globalId = `saved:${hashSavedUrl(url)}`;
  const now = Date.now();
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {}
  const item: FeedItem = {
    globalId,
    platform: "saved",
    contentType: "article",
    capturedAt: now,
    publishedAt: now,
    author: { id: hostname, handle: hostname, displayName: hostname },
    content: {
      text: url,
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: { url, title: url },
    },
    userState: {
      hidden: false,
      saved: true,
      savedAt: now,
      archived: false,
      tags,
    },
    topics: [],
  };
  await addLibraryFeedItem(item);
  return item;
}
