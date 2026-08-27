/** SQLite Library state and operation contracts used by Freed Desktop. */

import type {
  Account,
  FeedItem,
  Person,
  ReachOutLog,
  RssFeed,
  UserPreferences,
  DesktopClientRegistration,
} from "@freed/shared";
import type { LibraryCoreFeedBrowseFilterInputV1 } from "@freed/shared/library-core";

export type RssFeedRefreshUpdate = Pick<RssFeed, "url"> &
  Partial<Pick<RssFeed, "lastFetched" | "title" | "siteUrl">>;

// ---------------------------------------------------------------------------
// Main thread → worker
// ---------------------------------------------------------------------------

export type WorkerRequest =
  // Lifecycle
  | {
      reqId: number;
      type: "INIT";
      desktopClientRegistration?: DesktopClientRegistration;
      rendererItemHydrationEnabled?: boolean;
    }
  | { reqId: number; type: "QUIESCE" }
  | { reqId: number; type: "CLEAR_LOCAL" }
  // Mutations shared with PWA
  | { reqId: number; type: "MARK_AS_READ"; globalId: string }
  | { reqId: number; type: "MARK_ITEMS_AS_READ"; globalIds: string[] }
  | { reqId: number; type: "MARK_ALL_AS_READ"; platform?: string }
  | { reqId: number; type: "TOGGLE_SAVED"; globalId: string }
  | { reqId: number; type: "TOGGLE_ARCHIVED"; globalId: string }
  | { reqId: number; type: "ARCHIVE_ITEMS"; globalIds: string[] }
  | { reqId: number; type: "TOGGLE_LIKED"; globalId: string }
  | {
      reqId: number;
      type: "CONFIRM_LIKED_SYNCED";
      globalId: string;
      syncedAt?: number;
    }
  | {
      reqId: number;
      type: "CONFIRM_SEEN_SYNCED";
      globalId: string;
      syncedAt?: number;
    }
  | { reqId: number; type: "ADD_FEED_ITEM"; item: FeedItem }
  | { reqId: number; type: "ADD_FEED_ITEMS"; items: FeedItem[] }
  | {
      reqId: number;
      type: "RECONCILE_YOUTUBE_CAPTURE";
      accounts: Account[];
      items: FeedItem[];
      options: { rosterComplete: boolean; capturedAt: number };
    }
  | {
      reqId: number;
      type: "RECONCILE_FOLLOW_ROSTER_CAPTURE";
      accounts: Account[];
      items: FeedItem[];
      options: { provider: "substack" | "medium"; capturedAt: number };
    }
  | {
      reqId: number;
      type: "ADD_SAMPLE_LIBRARY_DATA";
      feeds: RssFeed[];
      items: FeedItem[];
      persons: Person[];
      accounts: Account[];
    }
  | { reqId: number; type: "REMOVE_FEED_ITEM"; globalId: string }
  | { reqId: number; type: "CLEAR_SAMPLE_DATA" }
  | {
      reqId: number;
      type: "UPDATE_FEED_ITEM";
      globalId: string;
      updates: Partial<FeedItem>;
    }
  | {
      reqId: number;
      type: "ARCHIVE_ALL_READ_UNSAVED";
      platform?: string;
      feedUrl?: string;
    }
  | { reqId: number; type: "UNARCHIVE_SAVED_ITEMS" }
  | { reqId: number; type: "PRUNE_ARCHIVED_ITEMS"; maxAgeMs?: number }
  | { reqId: number; type: "DELETE_ALL_ARCHIVED" }
  | { reqId: number; type: "ADD_RSS_FEED"; feed: RssFeed }
  | {
      reqId: number;
      type: "REMOVE_RSS_FEED";
      url: string;
      includeItems?: boolean;
    }
  | {
      reqId: number;
      type: "UPDATE_RSS_FEED";
      url: string;
      updates: Partial<RssFeed>;
    }
  | { reqId: number; type: "REMOVE_ALL_FEEDS"; includeItems: boolean }
  | {
      reqId: number;
      type: "UPDATE_PREFERENCES";
      updates: Partial<UserPreferences>;
    }
  | { reqId: number; type: "ADD_PERSON"; person: Person }
  | { reqId: number; type: "ADD_PERSONS"; persons: Person[] }
  | {
      reqId: number;
      type: "UPDATE_PERSON";
      personId: string;
      updates: Partial<Person>;
    }
  | {
      reqId: number;
      type: "UPSERT_CONNECTION_PERSONS";
      candidates: Array<{ person: Person; accountIds: string[] }>;
    }
  | { reqId: number; type: "REMOVE_PERSON"; personId: string }
  | {
      reqId: number;
      type: "LOG_REACH_OUT";
      personId: string;
      entry: ReachOutLog;
    }
  | { reqId: number; type: "ADD_ACCOUNT"; account: Account }
  | { reqId: number; type: "ADD_ACCOUNTS"; accounts: Account[] }
  | {
      reqId: number;
      type: "UPDATE_ACCOUNT";
      accountId: string;
      updates: Partial<Account>;
    }
  | { reqId: number; type: "REMOVE_ACCOUNT"; accountId: string }
  // Desktop-specific mutations
  | {
      reqId: number;
      type: "BATCH_REFRESH_FEEDS";
      feeds: RssFeedRefreshUpdate[];
      items: FeedItem[];
    }
  | { reqId: number; type: "BATCH_IMPORT_ITEMS"; items: FeedItem[] }
  | { reqId: number; type: "HEAL_UNTITLED_FEEDS" }
  | { reqId: number; type: "DEDUPLICATE_ITEMS" }
  | { reqId: number; type: "BACKFILL_CONTENT_SIGNALS"; batchSize?: number }
  | { reqId: number; type: "GET_ALL_ITEM_IDS" }
  | { reqId: number; type: "GET_DOC_BINARY" }
  | { reqId: number; type: "GET_COMMITTED_DOC" }
  | { reqId: number; type: "GET_HEADS" }
  | { reqId: number; type: "GET_LIBRARY_CORE_PROJECTION_SOURCE" }
  | { reqId: number; type: "COMPARE_DOC"; binary: Uint8Array }
  | { reqId: number; type: "GET_SAVED_YOUTUBE_URLS" }
  | { reqId: number; type: "GET_ITEM_PRESERVED_TEXT"; globalId: string }
  | { reqId: number; type: "GET_ITEM_LEGACY_HTML"; globalId: string }
  | {
      reqId: number;
      type: "BEGIN_LIBRARY_CORE_PROJECTION";
      sessionId: string;
    }
  | {
      reqId: number;
      type: "NEXT_LIBRARY_CORE_PROJECTION_BATCH";
      sessionId: string;
      batchIndex: number;
    }
  | {
      reqId: number;
      type: "CANCEL_LIBRARY_CORE_PROJECTION";
      sessionId: string;
    }
  | {
      reqId: number;
      type: "BEGIN_LIBRARY_CORE_FEED_BROWSE_PROJECTION";
      sessionId: string;
      filter?: LibraryCoreFeedBrowseFilterInputV1;
      rankingClockMs: number;
    }
  | {
      reqId: number;
      type: "NEXT_LIBRARY_CORE_FEED_BROWSE_PROJECTION_BATCH";
      sessionId: string;
      batchIndex: number;
    }
  | {
      reqId: number;
      type: "CANCEL_LIBRARY_CORE_FEED_BROWSE_PROJECTION";
      sessionId: string;
    }
  | {
      reqId: number;
      type: "BEGIN_LIBRARY_CORE_EXTERNAL_EXPORT";
      sessionId: string;
    }
  | {
      reqId: number;
      type: "READ_LIBRARY_CORE_EXTERNAL_EXPORT_CHUNK";
      sessionId: string;
      offset: number;
    }
  | {
      reqId: number;
      type: "CONFIRM_LIBRARY_CORE_EXTERNAL_EXPORT";
      sessionId: string;
    }
  | {
      reqId: number;
      type: "CANCEL_LIBRARY_CORE_EXTERNAL_EXPORT";
      sessionId: string;
    }
  ;

export type LibraryMutationEvent =
  | {
      source: "state_update";
      mutation?: WorkerRequest["type"];
      changedItemIds: null;
      changedItems?: undefined;
      requiresFullScan: true;
    }
  | {
      source: "preferences_patch";
      mutation?: WorkerRequest["type"];
      changedItemIds: null;
      changedItems: [];
      requiresFullScan: false;
    }
  | {
      source: "item_patch";
      mutation?: WorkerRequest["type"];
      changedItemIds: string[];
      changedItems: FeedItem[];
      requiresFullScan: false;
    }
  | {
      source: "feeds_patch";
      mutation?: WorkerRequest["type"];
      changedItemIds: null;
      changedItems: [];
      requiresFullScan: false;
    };
