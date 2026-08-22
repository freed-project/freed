import type {
  Account,
  FeedItem,
  Friend,
  Person,
  RssFeed,
  UserPreferences,
} from "@freed/shared";

/** Bounded UI state hydrated from the PWA OPFS SQLite Library. */
export interface LibraryState {
  items: FeedItem[];
  searchCorpusVersion: number;
  feeds: Record<string, RssFeed>;
  persons: Record<string, Person>;
  accounts: Record<string, Account>;
  friends: Record<string, Friend>;
  preferences: UserPreferences;
  feedUnreadCounts: Record<string, number>;
  feedTotalCounts: Record<string, number>;
  totalUnreadCount: number;
  unreadCountByPlatform: Record<string, number>;
  totalItemCount: number;
  itemCountByPlatform: Record<string, number>;
  totalArchivableCount: number;
  archivableCountByPlatform: Record<string, number>;
  archivableFeedCounts: Record<string, number>;
  mapFriendLocationCount: number;
  mapAllContentLocationCount: number;
}
