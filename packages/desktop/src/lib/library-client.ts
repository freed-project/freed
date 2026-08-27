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
  type ReachOutLog,
  type RssFeed,
  type SampleDataClearSummary,
  type UserPreferences,
} from "@freed/shared";
import type {
  DocChangeEvent,
  DocState,
  RssFeedRefreshUpdate,
  WorkerRequest,
} from "./library-types";
import { registerDocAccessors, setDocSnapshot } from "@freed/ui/lib/debug-store";
import {
  clearSqliteLibrary,
  dispatchSqliteMutation,
  ensureFreshNormalizedDesktopLibrary,
  loadSqliteLibraryState,
  readSqliteItems,
} from "./sqlite-library";
import { scanLibraryCoreBackgroundItems } from "./library-core-item-detail-runtime";
import { hasLegacyLibraryData } from "./legacy-library-presence";

export type { DocChangeEvent, DocState } from "./library-types";

export class StaleDocumentRevisionError extends Error {}

export const LIBRARY_CORE_RENDERER_ITEM_EVICTION_DISABLED_KEY =
  "freed.libraryCore.rendererItemEvictionV1.disabled";

type Subscriber = (state: DocState, event: DocChangeEvent) => void;

const subscribers = new Set<Subscriber>();
let lastState: DocState | null = null;
let nextRequestId = 1;
let mutationQueue: Promise<void> = Promise.resolve();

function registerSqliteDebugAccessors(): void {
  registerDocAccessors(
    () => lastState,
    () => JSON.stringify(lastState),
  );
}

function updateSqliteDebugSnapshot(state: DocState): void {
  setDocSnapshot({
    documentId: "sqlite-library",
    itemCount: state.totalItemCount,
    feedCount: Object.keys(state.feeds).length,
    binarySize: 0,
    savedAt: Date.now(),
  });
}

function publish(state: DocState, event: DocChangeEvent): void {
  lastState = state;
  updateSqliteDebugSnapshot(state);
  for (const subscriber of subscribers) subscriber(state, event);
}

async function ensureInitialized(): Promise<DocState> {
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

async function dispatch(message: WorkerRequest): Promise<unknown> {
  let result: unknown;
  const operation = mutationQueue.then(async () => {
    const current = await ensureInitialized();
    const dispatched = await dispatchSqliteMutation(message, current);
    result = dispatched.result;
    publish(dispatched.state, dispatched.event);
  });
  mutationQueue = operation.catch(() => undefined);
  await operation;
  return result;
}

function request<T extends { readonly type: WorkerRequest["type"] }>(message: T): Promise<unknown> {
  return dispatch({ ...message, reqId: nextRequestId++ } as unknown as WorkerRequest);
}

export function subscribe(callback: Subscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function setRelayClientCount(_count: number): void {}

export async function initDoc(
  _registration?: DesktopClientRegistration,
): Promise<DocState> {
  return ensureInitialized();
}

export function getDocState(): DocState | null {
  return lastState;
}

export async function reloadSqliteLibraryState(): Promise<DocState> {
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

export async function getItemLegacyHtml(globalId: string): Promise<string | null> {
  const [item] = await readSqliteItems([globalId]);
  return item?.preservedContent?.html ?? null;
}

export async function clearLocalDoc(): Promise<void> {
  await clearSqliteLibrary();
  lastState = null;
}

export function quiesceDesktopLibraryForFactoryReset(): Promise<void> {
  return mutationQueue;
}

export const docAddFeedItem = (item: FeedItem) => request({ type: "ADD_FEED_ITEM", item }).then(() => {});
export const docAddFeedItems = (items: FeedItem[]) => request({ type: "ADD_FEED_ITEMS", items }).then(() => {});
export const docRemoveFeedItem = (globalId: string) => request({ type: "REMOVE_FEED_ITEM", globalId }).then(() => {});
export const docUpdateFeedItem = (globalId: string, updates: Partial<FeedItem>) => request({ type: "UPDATE_FEED_ITEM", globalId, updates }).then(() => {});
export const docMarkAsRead = (globalId: string) => request({ type: "MARK_AS_READ", globalId }).then(() => {});
export const docMarkItemsAsRead = (globalIds: string[]) => globalIds.length === 0 ? Promise.resolve() : request({ type: "MARK_ITEMS_AS_READ", globalIds }).then(() => {});
export const docMarkAllAsRead = (platform?: string) => request({ type: "MARK_ALL_AS_READ", platform }).then(() => {});
export const docToggleSaved = (globalId: string) => request({ type: "TOGGLE_SAVED", globalId }).then(() => {});
export const docToggleArchived = (globalId: string) => request({ type: "TOGGLE_ARCHIVED", globalId }).then(() => {});
export const docArchiveItems = (globalIds: string[]) => globalIds.length === 0 ? Promise.resolve() : request({ type: "ARCHIVE_ITEMS", globalIds }).then(() => {});
export const docToggleLiked = (globalId: string) => request({ type: "TOGGLE_LIKED", globalId }).then(() => {});
export const docConfirmLikedSynced = (globalId: string, syncedAt?: number) => request({ type: "CONFIRM_LIKED_SYNCED", globalId, syncedAt }).then(() => {});
export const docConfirmSeenSynced = (globalId: string, syncedAt?: number) => request({ type: "CONFIRM_SEEN_SYNCED", globalId, syncedAt }).then(() => {});
export const docArchiveAllReadUnsaved = (platform?: string, feedUrl?: string) => request({ type: "ARCHIVE_ALL_READ_UNSAVED", platform, feedUrl }).then(() => {});
export const docUnarchiveSavedItems = () => request({ type: "UNARCHIVE_SAVED_ITEMS" }).then(() => {});
export const docPruneArchivedItems = (maxAgeMs?: number) => request({ type: "PRUNE_ARCHIVED_ITEMS", maxAgeMs }).then(() => {});
export const docDeleteAllArchived = () => request({ type: "DELETE_ALL_ARCHIVED" }).then(() => {});
export const docAddRssFeed = (feed: RssFeed) => request({ type: "ADD_RSS_FEED", feed }).then(() => {});
export const docRemoveRssFeed = (url: string, includeItems = false) => request({ type: "REMOVE_RSS_FEED", url, includeItems }).then(() => {});
export const docUpdateRssFeed = (url: string, updates: Partial<RssFeed>) => request({ type: "UPDATE_RSS_FEED", url, updates }).then(() => {});
export const docRemoveAllFeeds = (includeItems: boolean) => request({ type: "REMOVE_ALL_FEEDS", includeItems }).then(() => {});
export const docUpdatePreferences = (updates: Partial<UserPreferences>) => request({ type: "UPDATE_PREFERENCES", updates }).then(() => {});
export const docAddPerson = (person: Person) => request({ type: "ADD_PERSON", person }).then(() => {});
export const docAddPersons = (persons: Person[]) => request({ type: "ADD_PERSONS", persons }).then(() => {});
export const docUpdatePerson = (personId: string, updates: Partial<Person>) => request({ type: "UPDATE_PERSON", personId, updates }).then(() => {});
export const docUpsertConnectionPersons = (candidates: Array<{ person: Person; accountIds: string[] }>) => candidates.length === 0 ? Promise.resolve() : request({ type: "UPSERT_CONNECTION_PERSONS", candidates }).then(() => {});
export const docRemovePerson = (personId: string) => request({ type: "REMOVE_PERSON", personId }).then(() => {});
export const docLogReachOut = (personId: string, entry: ReachOutLog) => request({ type: "LOG_REACH_OUT", personId, entry }).then(() => {});
export const docAddAccount = (account: Account) => request({ type: "ADD_ACCOUNT", account }).then(() => {});
export const docAddAccounts = (accounts: Account[]) => request({ type: "ADD_ACCOUNTS", accounts }).then(() => {});
export const docUpdateAccount = (accountId: string, updates: Partial<Account>) => request({ type: "UPDATE_ACCOUNT", accountId, updates }).then(() => {});
export const docRemoveAccount = (accountId: string) => request({ type: "REMOVE_ACCOUNT", accountId }).then(() => {});
export const docAddFriend = docAddPerson;
export const docAddFriends = docAddPersons;
export const docUpdateFriend = docUpdatePerson;
export const docRemoveFriend = docRemovePerson;

export const docReconcileYouTubeCapture = (
  accounts: Account[],
  items: FeedItem[],
  options: { rosterComplete: boolean; capturedAt: number },
) => request({ type: "RECONCILE_YOUTUBE_CAPTURE", accounts, items, options }).then(() => {});

export const docReconcileFollowRosterCapture = (
  accounts: Account[],
  items: FeedItem[],
  options: { provider: "substack" | "medium"; capturedAt: number },
) => request({ type: "RECONCILE_FOLLOW_ROSTER_CAPTURE", accounts, items, options }).then(() => {});

export const docAddSampleLibraryData = (data: {
  feeds: RssFeed[];
  items: FeedItem[];
  persons: Person[];
  accounts: Account[];
}) => request({ type: "ADD_SAMPLE_LIBRARY_DATA", ...data }).then(() => {});

export async function docClearSampleData(): Promise<SampleDataClearSummary> {
  return await request({ type: "CLEAR_SAMPLE_DATA" }) as SampleDataClearSummary;
}

export async function docBatchRefreshFeeds(
  feeds: RssFeedRefreshUpdate[],
  items: FeedItem[],
): Promise<void> {
  await request({ type: "BATCH_REFRESH_FEEDS", feeds, items });
}

export async function docBatchImportItems(
  items: FeedItem[],
  onChunk?: (chunkIndex: number, totalChunks: number) => void,
): Promise<void> {
  await request({ type: "BATCH_IMPORT_ITEMS", items });
  onChunk?.(1, 1);
}

export const docHealUntitledFeedTitles = () => request({ type: "HEAL_UNTITLED_FEEDS" }).then(() => {});
export const docDeduplicateFeedItems = () => request({ type: "DEDUPLICATE_ITEMS" }).then(() => {});

export async function docBackfillContentSignals(
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

export async function docAddStubItem(url: string, tags: string[] = []): Promise<FeedItem> {
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
  await docAddFeedItem(item);
  return item;
}
