import type { UserPreferences } from "@freed/shared";

/** Bounded query invalidation and visible settings from PWA OPFS SQLite. */
export interface LibraryState {
  searchCorpusVersion: number;
  preferences: UserPreferences;
  totalUnreadCount: number;
  unreadCountByPlatform: Record<string, number>;
  totalItemCount: number;
  itemCountByPlatform: Record<string, number>;
  rssFeedCount: number;
  enabledRssFeedCount: number;
  archivedItemCount: number;
  friendPersonCount: number;
  socialAccountCount: number;
  totalArchivableCount: number;
  archivableCountByPlatform: Record<string, number>;
  mapFriendLocationCount: number;
  mapAllContentLocationCount: number;
}
