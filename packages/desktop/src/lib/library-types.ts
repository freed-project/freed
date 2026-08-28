/** SQLite Library state and operation contracts used by Freed Desktop. */

import type {
  Account,
  FeedItem,
  Person,
  RssFeed,
  UserPreferences,
} from "@freed/shared";

export type RssFeedRefreshUpdate = Pick<RssFeed, "url"> &
  Partial<Pick<RssFeed, "lastFetched" | "title" | "siteUrl">>;

export type LibraryMutationRequest =
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
  | {
      reqId: number;
      type: "BATCH_REFRESH_FEEDS";
      feeds: RssFeedRefreshUpdate[];
      items: FeedItem[];
    }
  | { reqId: number; type: "BATCH_IMPORT_ITEMS"; items: FeedItem[] }
  | { reqId: number; type: "HEAL_UNTITLED_FEEDS" };

export type LibraryMutationEvent =
  | {
      source: "state_update";
      mutation?: LibraryMutationRequest["type"];
      changedItemIds: null;
      changedItems?: undefined;
      requiresFullScan: true;
    }
  | {
      source: "preferences_patch";
      mutation?: LibraryMutationRequest["type"];
      changedItemIds: null;
      changedItems: [];
      requiresFullScan: false;
    }
  | {
      source: "item_patch";
      mutation?: LibraryMutationRequest["type"];
      changedItemIds: string[];
      changedItems: FeedItem[];
      requiresFullScan: false;
    }
  | {
      source: "feeds_patch";
      mutation?: LibraryMutationRequest["type"];
      changedItemIds: null;
      changedItems: [];
      requiresFullScan: false;
    };
