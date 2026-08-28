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
import type { LibraryCoreRuntimeStateV1 } from "@freed/shared/library-core";
import { registerLibraryAccessors, setLibrarySnapshot } from "@freed/ui/lib/debug-store";
import {
  dispatchSqliteMutation,
  ensureFreshNormalizedDesktopLibrary,
  loadSqliteLibraryState,
  readSqliteItems,
  resetNormalizedLibrary,
} from "./sqlite-library";
import { scanLibraryCoreBackgroundItems } from "./library-core-item-detail-runtime";
import { hasLegacyLibraryData } from "./legacy-library-presence";

export type { LibraryMutationEvent } from "./library-types";

export const LIBRARY_CORE_RENDERER_ITEM_EVICTION_DISABLED_KEY =
  "freed.libraryCore.rendererItemEvictionV1.disabled";

type Subscriber = (
  state: LibraryCoreRuntimeStateV1,
  event: LibraryMutationEvent,
) => void;

const subscribers = new Set<Subscriber>();
let lastState: LibraryCoreRuntimeStateV1 | null = null;
let nextRequestId = 1;
let mutationQueue: Promise<void> = Promise.resolve();

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

async function ensureInitialized(): Promise<LibraryCoreRuntimeStateV1> {
  if (lastState) return lastState;
  let normalizedSelected = await ensureFreshNormalizedDesktopLibrary(false);
  let legacyDataPresent = false;
  if (!normalizedSelected) {
    legacyDataPresent = await hasLegacyLibraryData();
    normalizedSelected = await ensureFreshNormalizedDesktopLibrary(
      !legacyDataPresent,
    );
  }
  if (!normalizedSelected) {
    throw new Error(
      legacyDataPresent
        ? "Freed Desktop could not complete the one-time SQLite Library transition. The historical source remains untouched."
        : "Freed Desktop could not establish SQLite Library authority.",
    );
  }
  const state = await loadSqliteLibraryState();
  lastState = state;
  registerSqliteDebugAccessors();
  updateSqliteDebugSnapshot(state);
  return state;
}

async function dispatch(message: LibraryMutationRequest): Promise<unknown> {
  let result: unknown;
  const operation = mutationQueue.then(async () => {
    await ensureInitialized();
    const dispatched = await dispatchSqliteMutation(message);
    result = dispatched.result;
    publish(dispatched.state, dispatched.event);
  });
  mutationQueue = operation.catch(() => undefined);
  await operation;
  return result;
}

function request<T extends { readonly type: LibraryMutationRequest["type"] }>(message: T): Promise<unknown> {
  return dispatch({ ...message, reqId: nextRequestId++ } as unknown as LibraryMutationRequest);
}

export function subscribeDesktopLibraryRuntime(callback: Subscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function setRelayClientCount(_count: number): void {}

export async function initializeDesktopLibraryRuntime(
  _registration?: DesktopClientRegistration,
): Promise<LibraryCoreRuntimeStateV1> {
  return ensureInitialized();
}

export function getDesktopLibraryRuntimeState(): LibraryCoreRuntimeStateV1 | null {
  return lastState;
}

export async function reloadDesktopLibraryRuntimeState(): Promise<LibraryCoreRuntimeStateV1> {
  const state = await loadSqliteLibraryState();
  publish(state, {
    source: "state_update",
    mutation: undefined,
    changedItemIds: null,
    requiresFullScan: true,
  });
  return state;
}

export async function getSavedYouTubeVideoUrls(): Promise<string[]> {
  const items: FeedItem[] = [];
  await scanAllItems((page) => items.push(...page));
  return collectSavedYouTubeVideoUrls(items);
}

async function scanAllItems(visit: (page: FeedItem[]) => void): Promise<void> {
  await scanLibraryCoreBackgroundItems((page) => {
    visit([...page]);
    return "continue";
  });
}

export async function getAllItemIds(): Promise<string[]> {
  const ids: string[] = [];
  await scanAllItems((page) => ids.push(...page.map((item) => item.globalId)));
  return ids;
}

export async function getItemPreservedText(globalId: string): Promise<string | null> {
  const [item] = await readSqliteItems([globalId]);
  return item?.preservedContent?.text ?? null;
}

export async function resetLocalLibrary(): Promise<void> {
  await resetNormalizedLibrary();
  lastState = null;
}

export function quiesceDesktopLibraryForFactoryReset(): Promise<void> {
  return mutationQueue;
}

export const addLibraryFeedItem = (item: FeedItem) => request({ type: "ADD_FEED_ITEM", item }).then(() => {});
export const addLibraryFeedItems = (items: FeedItem[]) => request({ type: "ADD_FEED_ITEMS", items }).then(() => {});
export const removeLibraryFeedItem = (globalId: string) => request({ type: "REMOVE_FEED_ITEM", globalId }).then(() => {});
export const updateLibraryFeedItem = (globalId: string, updates: Partial<FeedItem>) => request({ type: "UPDATE_FEED_ITEM", globalId, updates }).then(() => {});
export const markLibraryItemAsRead = (globalId: string) => request({ type: "MARK_AS_READ", globalId }).then(() => {});
export const markLibraryItemsAsRead = (globalIds: string[]) => globalIds.length === 0 ? Promise.resolve() : request({ type: "MARK_ITEMS_AS_READ", globalIds }).then(() => {});
export const markAllLibraryItemsAsRead = (platform?: string) => request({ type: "MARK_ALL_AS_READ", platform }).then(() => {});
export const toggleLibraryItemSaved = (globalId: string) => request({ type: "TOGGLE_SAVED", globalId }).then(() => {});
export const toggleLibraryItemArchived = (globalId: string) => request({ type: "TOGGLE_ARCHIVED", globalId }).then(() => {});
export const archiveLibraryItems = (globalIds: string[]) => globalIds.length === 0 ? Promise.resolve() : request({ type: "ARCHIVE_ITEMS", globalIds }).then(() => {});
export const toggleLibraryItemLiked = (globalId: string) => request({ type: "TOGGLE_LIKED", globalId }).then(() => {});
export const confirmLibraryItemLikedSynced = (globalId: string, syncedAt?: number) => request({ type: "CONFIRM_LIKED_SYNCED", globalId, syncedAt }).then(() => {});
export const confirmLibraryItemSeenSynced = (globalId: string, syncedAt?: number) => request({ type: "CONFIRM_SEEN_SYNCED", globalId, syncedAt }).then(() => {});
export const archiveAllReadUnsavedLibraryItems = (platform?: string, feedUrl?: string) => request({ type: "ARCHIVE_ALL_READ_UNSAVED", platform, feedUrl }).then(() => {});
export const unarchiveSavedLibraryItems = () => request({ type: "UNARCHIVE_SAVED_ITEMS" }).then(() => {});
export const pruneArchivedLibraryItems = (maxAgeMs?: number) => request({ type: "PRUNE_ARCHIVED_ITEMS", maxAgeMs }).then(() => {});
export const deleteAllArchivedLibraryItems = () => request({ type: "DELETE_ALL_ARCHIVED" }).then(() => {});
export const addLibraryRssFeed = (feed: RssFeed) => request({ type: "ADD_RSS_FEED", feed }).then(() => {});
export const removeLibraryRssFeed = (url: string, includeItems = false) => request({ type: "REMOVE_RSS_FEED", url, includeItems }).then(() => {});
export const updateLibraryRssFeed = (url: string, updates: Partial<RssFeed>) => request({ type: "UPDATE_RSS_FEED", url, updates }).then(() => {});
export const removeAllLibraryFeeds = (includeItems: boolean) => request({ type: "REMOVE_ALL_FEEDS", includeItems }).then(() => {});
export const updateLibraryPreferences = (updates: Partial<UserPreferences>) => request({ type: "UPDATE_PREFERENCES", updates }).then(() => {});
export const reconcileYouTubeLibraryCapture = (
  accounts: Account[],
  items: FeedItem[],
  options: { rosterComplete: boolean; capturedAt: number },
) => request({ type: "RECONCILE_YOUTUBE_CAPTURE", accounts, items, options }).then(() => {});

export const reconcileFollowRosterLibraryCapture = (
  accounts: Account[],
  items: FeedItem[],
  options: { provider: "substack" | "medium"; capturedAt: number },
) => request({ type: "RECONCILE_FOLLOW_ROSTER_CAPTURE", accounts, items, options }).then(() => {});

export const addSampleLibraryData = (data: {
  feeds: RssFeed[];
  items: FeedItem[];
  persons: Person[];
  accounts: Account[];
}) => request({ type: "ADD_SAMPLE_LIBRARY_DATA", ...data }).then(() => {});

export async function clearSampleLibraryData(): Promise<SampleDataClearSummary> {
  return await request({ type: "CLEAR_SAMPLE_DATA" }) as SampleDataClearSummary;
}

export async function refreshLibraryFeeds(
  feeds: RssFeedRefreshUpdate[],
  items: FeedItem[],
): Promise<void> {
  await request({ type: "BATCH_REFRESH_FEEDS", feeds, items });
}

export async function importLibraryItems(
  items: FeedItem[],
  onChunk?: (chunkIndex: number, totalChunks: number) => void,
): Promise<void> {
  await request({ type: "BATCH_IMPORT_ITEMS", items });
  onChunk?.(1, 1);
}

export const healUntitledLibraryFeedTitles = () => request({ type: "HEAL_UNTITLED_FEEDS" }).then(() => {});
export const deduplicateLibraryFeedItems = () => request({ type: "DEDUPLICATE_ITEMS" }).then(() => {});

export async function backfillLibraryContentSignals(
  _batchSize = 200,
): Promise<ContentSignalBackfillSummary> {
  return {
    version: CONTENT_SIGNAL_VERSION,
    total: lastState?.totalItemCount ?? 0,
    scanned: 0,
    updated: 0,
    remaining: 0,
    counts: Object.fromEntries(CONTENT_SIGNAL_KEYS.map((signal) => [signal, 0])) as Record<ContentSignal, number>,
    multiSignalCount: 0,
    untaggedCount: 0,
    samples: {},
  };
}

export async function addLibraryStubItem(url: string, tags: string[] = []): Promise<FeedItem> {
  const globalId = `saved:${hashSavedUrl(url)}`;
  const now = Date.now();
  let hostname = url;
  try { hostname = new URL(url).hostname; } catch {}
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
    userState: { hidden: false, saved: true, savedAt: now, archived: false, tags },
    topics: [],
  };
  await addLibraryFeedItem(item);
  return item;
}
