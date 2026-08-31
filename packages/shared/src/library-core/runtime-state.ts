import { createDefaultPreferences, type UserPreferences } from "../types.js";
import type { LibraryCoreFacetSummaryV1 } from "./facet-summary-contracts.js";

/**
 * The compact SQLite state retained by an application shell.
 *
 * This is not Library authority and contains no entity rows. It is one visible
 * preferences snapshot, trigger-maintained scalar counts, and invalidation
 * revisions used to reopen bounded queries.
 */
export interface LibraryCoreRuntimeStateV1 {
  readonly searchCorpusVersion: number;
  readonly preferences: UserPreferences;
  readonly totalUnreadCount: number;
  readonly unreadCountByPlatform: Readonly<Record<string, number>>;
  readonly totalItemCount: number;
  readonly itemCountByPlatform: Readonly<Record<string, number>>;
  readonly rssFeedCount: number;
  readonly enabledRssFeedCount: number;
  readonly archivedItemCount: number;
  readonly friendPersonCount: number;
  readonly socialAccountCount: number;
  readonly totalArchivableCount: number;
  readonly archivableCountByPlatform: Readonly<Record<string, number>>;
  readonly mapFriendLocationCount: number;
  readonly mapAllContentLocationCount: number;
}

export function createEmptyLibraryCoreRuntimeStateV1(): LibraryCoreRuntimeStateV1 {
  return Object.freeze({
    searchCorpusVersion: 0,
    preferences: createDefaultPreferences(),
    totalUnreadCount: 0,
    unreadCountByPlatform: Object.freeze({}),
    totalItemCount: 0,
    itemCountByPlatform: Object.freeze({}),
    rssFeedCount: 0,
    enabledRssFeedCount: 0,
    archivedItemCount: 0,
    friendPersonCount: 0,
    socialAccountCount: 0,
    totalArchivableCount: 0,
    archivableCountByPlatform: Object.freeze({}),
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
  });
}

export function libraryCoreRuntimeStateFromFacetSummaryV1(
  preferences: UserPreferences,
  summary: LibraryCoreFacetSummaryV1,
  sourceRevision: number,
): LibraryCoreRuntimeStateV1 {
  const itemCountByPlatform: Record<string, number> = {};
  const unreadCountByPlatform: Record<string, number> = {};
  const archivableCountByPlatform: Record<string, number> = {};
  for (const count of summary.platformCounts) {
    itemCountByPlatform[count.platform] = count.totalCount;
    unreadCountByPlatform[count.platform] = count.unreadCount;
    archivableCountByPlatform[count.platform] = count.archivableCount;
  }
  return Object.freeze({
    searchCorpusVersion: sourceRevision,
    preferences,
    totalUnreadCount: summary.unreadCount,
    unreadCountByPlatform: Object.freeze(unreadCountByPlatform),
    totalItemCount: summary.totalCount,
    itemCountByPlatform: Object.freeze(itemCountByPlatform),
    rssFeedCount: summary.rssFeedCount,
    enabledRssFeedCount: summary.enabledRssFeedCount,
    archivedItemCount: summary.archivedCount,
    friendPersonCount: summary.friendPersonCount,
    socialAccountCount: summary.socialAccountCount,
    totalArchivableCount: summary.archivableCount,
    archivableCountByPlatform: Object.freeze(archivableCountByPlatform),
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
  });
}
