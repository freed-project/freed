/**
 * Lazy access to the retired PWA Automerge runtime.
 *
 * SQLite Library Core is the normal product path. Keeping this boundary lazy
 * prevents the legacy worker and WASM runtime from joining the active bundle
 * graph while rollback and factory-reset support still exist.
 */

type LegacyAutomergeModule = typeof import("./automerge");
type AsyncLegacyMethod = (...args: never[]) => Promise<unknown>;

let legacyAutomergeModule: Promise<LegacyAutomergeModule> | null = null;

export function loadLegacyAutomerge(): Promise<LegacyAutomergeModule> {
  legacyAutomergeModule ??= import("./automerge");
  return legacyAutomergeModule;
}

function legacyMethod<Name extends keyof LegacyAutomergeModule>(
  name: Name,
): LegacyAutomergeModule[Name] {
  return ((...args: never[]) =>
    loadLegacyAutomerge().then((module) =>
      (module[name] as AsyncLegacyMethod)(...args),
    )) as LegacyAutomergeModule[Name];
}

export const docAddFeedItems = legacyMethod("docAddFeedItems");
export const docAddSampleLibraryData = legacyMethod("docAddSampleLibraryData");
export const docAddRssFeed = legacyMethod("docAddRssFeed");
export const docRemoveRssFeed = legacyMethod("docRemoveRssFeed");
export const docRemoveAllFeeds = legacyMethod("docRemoveAllFeeds");
export const docUpdateRssFeed = legacyMethod("docUpdateRssFeed");
export const docUpdateFeedItem = legacyMethod("docUpdateFeedItem");
export const docBackfillContentSignals = legacyMethod(
  "docBackfillContentSignals",
);
export const docMarkAsRead = legacyMethod("docMarkAsRead");
export const docMarkItemsAsRead = legacyMethod("docMarkItemsAsRead");
export const docMarkAllAsRead = legacyMethod("docMarkAllAsRead");
export const docToggleSaved = legacyMethod("docToggleSaved");
export const docRemoveFeedItem = legacyMethod("docRemoveFeedItem");
export const docClearSampleData = legacyMethod("docClearSampleData");
export const docToggleArchived = legacyMethod("docToggleArchived");
export const docArchiveItems = legacyMethod("docArchiveItems");
export const docToggleLiked = legacyMethod("docToggleLiked");
export const docArchiveAllReadUnsaved = legacyMethod(
  "docArchiveAllReadUnsaved",
);
export const docUnarchiveSavedItems = legacyMethod("docUnarchiveSavedItems");
export const docDeleteAllArchived = legacyMethod("docDeleteAllArchived");
export const docPruneArchivedItems = legacyMethod("docPruneArchivedItems");
export const docUpdatePreferences = legacyMethod("docUpdatePreferences");
export const docAddAccount = legacyMethod("docAddAccount");
export const docAddAccounts = legacyMethod("docAddAccounts");
export const docAddPerson = legacyMethod("docAddPerson");
export const docAddPersons = legacyMethod("docAddPersons");
export const docUpdateAccount = legacyMethod("docUpdateAccount");
export const docUpdatePerson = legacyMethod("docUpdatePerson");
export const docUpsertConnectionPersons = legacyMethod(
  "docUpsertConnectionPersons",
);
export const docRemoveAccount = legacyMethod("docRemoveAccount");
export const docRemovePerson = legacyMethod("docRemovePerson");
export const docLogReachOut = legacyMethod("docLogReachOut");
export const docAddStubItem = legacyMethod("docAddStubItem");
export const clearLocalDocAfterPwaQuiesce = legacyMethod(
  "clearLocalDocAfterPwaQuiesce",
);
export const getItemLegacyHtml = legacyMethod("getItemLegacyHtml");
