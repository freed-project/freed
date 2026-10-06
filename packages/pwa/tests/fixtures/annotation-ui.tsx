import React from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import { createDefaultPreferences, type BaseAppState, type FeedItem, type FilterOptions } from "@freed/shared";
import { LibraryCoreAnnotationHydrationError, type LibraryCoreHydratedAnnotations } from "@freed/shared/library-core";
import { PlatformProvider, type PlatformConfig } from "../../../ui/src/context/PlatformContext";
import { AppShell } from "../../../ui/src/components/layout/AppShell";
import { FeedView } from "../../../ui/src/components/feed/FeedView";
import { useCommandSurfaceStore } from "../../../ui/src/lib/command-surface-store";
const noop = () => {};
const noopAsync = async () => {};
function createTestStore(overrides: Partial<BaseAppState> = {}) {
  return create<BaseAppState>((set) => ({
    searchCorpusVersion: overrides.searchCorpusVersion ?? 0,
    libraryItemVersion: overrides.libraryItemVersion,
    preferences: overrides.preferences ?? createDefaultPreferences(),
    totalUnreadCount: overrides.totalUnreadCount ?? 0,
    unreadCountByPlatform: overrides.unreadCountByPlatform ?? {},
    totalItemCount: overrides.totalItemCount ?? 0,
    itemCountByPlatform: overrides.itemCountByPlatform ?? {},
    rssFeedCount: overrides.rssFeedCount ?? 0,
    enabledRssFeedCount: overrides.enabledRssFeedCount ?? 0,
    archivedItemCount: overrides.archivedItemCount ?? 0,
    friendPersonCount: overrides.friendPersonCount ?? 0,
    socialAccountCount: overrides.socialAccountCount ?? 0,
    totalArchivableCount: overrides.totalArchivableCount ?? 0,
    archivableCountByPlatform: overrides.archivableCountByPlatform ?? {},
    visibleFeedTotalCount: overrides.visibleFeedTotalCount ?? 0,
    mapFriendLocationCount: overrides.mapFriendLocationCount ?? 0,
    mapAllContentLocationCount: overrides.mapAllContentLocationCount ?? 0,
    setMapLocationCounts: overrides.setMapLocationCounts ?? (() => {}),
    isLoading: false,
    isSyncing: false,
    isInitialized: true,
    error: null,
    activeFilter: overrides.activeFilter ?? {},
    selectedItemId: overrides.selectedItemId ?? null,
    selectedPersonId: null,
    selectedAccountId: null,
    initialize: overrides.initialize ?? noopAsync,
    addItems: overrides.addItems ?? noopAsync,
    updateItem: overrides.updateItem ?? noopAsync,
    markAsRead: overrides.markAsRead ?? noopAsync,
    markItemsAsRead: overrides.markItemsAsRead ?? noopAsync,
    markAllAsRead: overrides.markAllAsRead ?? noopAsync,
    toggleSaved: overrides.toggleSaved ?? noopAsync,
    toggleArchived: overrides.toggleArchived ?? noopAsync,
    archiveItems: overrides.archiveItems ?? noopAsync,
    archiveAllReadUnsaved: overrides.archiveAllReadUnsaved ?? noopAsync,
    unarchiveSavedItems: overrides.unarchiveSavedItems ?? noopAsync,
    deleteAllArchived: overrides.deleteAllArchived ?? noopAsync,
    removeItem: overrides.removeItem ?? noopAsync,
    clearSampleData:
      overrides.clearSampleData
      ?? (async () => ({ feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 })),
    addSampleLibraryData: overrides.addSampleLibraryData ?? noopAsync,
    toggleLiked: overrides.toggleLiked ?? noopAsync,
    addFeed: overrides.addFeed ?? noopAsync,
    removeFeed: overrides.removeFeed ?? noopAsync,
    renameFeed: overrides.renameFeed ?? noopAsync,
    removeAllFeeds: overrides.removeAllFeeds ?? noopAsync,
    updatePreferences: overrides.updatePreferences ?? noopAsync,
    setFilter: overrides.setFilter ?? ((filter: FilterOptions) => set({ activeFilter: filter })),
    setSelectedItem: overrides.setSelectedItem ?? ((id: string | null) => set({ selectedItemId: id })),
    setSelectedPerson: overrides.setSelectedPerson ?? noop,
    setSelectedAccount: overrides.setSelectedAccount ?? noop,
    setLoading: overrides.setLoading ?? noop,
    setSyncing: overrides.setSyncing ?? noop,
    setError: overrides.setError ?? noop,
    setVisibleFeedTotalCount: overrides.setVisibleFeedTotalCount ?? noop,
    searchQuery: overrides.searchQuery ?? "",
    setSearchQuery: overrides.setSearchQuery ?? ((query: string) => set({ searchQuery: query })),
    activeView: overrides.activeView ?? "feed",
    setActiveView: overrides.setActiveView ?? ((view: "feed" | "friends" | "map" | "storyWall") => set({ activeView: view })),
    openMapForPerson:
      overrides.openMapForPerson
      ?? ((personId: string) =>
        set({
          activeView: "map",
          selectedPersonId: personId,
          selectedAccountId: null,
          selectedItemId: null,
        })),
    pendingMatchCount: 0,
    setPendingMatchCount: noop,
  }));
}
function createPlatform(store: PlatformConfig["store"], overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    store,
    SourceIndicator: null,
    HeaderSyncIndicator: null,
    SettingsExtraSections: null,
    LegalSettingsContent: null,
    FeedEmptyState: null,
    XSettingsContent: null,
    FacebookSettingsContent: null,
    InstagramSettingsContent: null,
    LinkedInSettingsContent: null,
    SubstackSettingsContent: null,
    MediumSettingsContent: null,
    GoogleContactsSettingsContent: null,
    ...overrides,
  };
}

export function mount(resident: boolean) {
  const item: FeedItem = { globalId: "saved:fixture", platform: "saved", sourceUrl: "https://example.invalid/saved",
    capturedAt: 1, publishedAt: 1, contentType: "article", author: { id: "a", handle: "a", displayName: "Fixture" },
    content: { text: "Authenticated reader detail", mediaUrls: [], mediaTypes: [] }, topics: [],
    userState: { saved: true, hidden: false, archived: false, tags: [], highlights: [{ createdAt: 1, text: "\u2063", note: "Original note" }] } };
  let annotations: LibraryCoreHydratedAnnotations = { state: "ready", editState: "ready", highlights: item.userState.highlights!, originals: {
    queryId: "item_annotations_v1", schemaVersion: 1, globalId: item.globalId,
    source: { generationId: "a".repeat(64) as never, projectionRevision: 2, transitionSequence: 2 }, tags: [],
    highlights: [{ createdAt: 1, text: "\u2063", textBlobDigest: null, note: "Original note" }],
  } };
  const store = createTestStore({ selectedItemId: item.globalId, libraryItemVersion: 2 });
  let failure: LibraryCoreHydratedAnnotations["state"] | null = null;
  let settle: (() => void) | undefined;
  const submissions: unknown[] = [];
  const platform = createPlatform(store, {
    openBoundedFeedReader: async () => { let read = false; return { totalCount: resident ? 1 : 0,
      readNext: async () => { if (read) return []; read = true; return resident ? [{ ...item, content: { ...item.content, text: "Resident incomplete card" }, userState: { ...item.userState, highlights: [] } }] : []; }, close: noopAsync }; },
    readLibraryItemDetail: async () => {
      if (!settle && store.getState().libraryItemVersion === 2) await new Promise<void>(resolve => { settle = resolve; });
      if (failure) throw new LibraryCoreAnnotationHydrationError({ ...annotations, state: failure, highlights: null });
      return { item, annotations };
    },
    saveUrl: async () => ({ globalId: item.globalId }),
    updateSavedContent: async (_item, input) => { submissions.push(input); throw new Error("LOCAL_ADMISSION_SOURCE_STALE: reopen the item"); },
  });
  const container = document.createElement("div"); document.body.append(container);
  createRoot(container).render(<PlatformProvider value={platform}><AppShell><FeedView /></AppShell></PlatformProvider>);
  return {
    ready: () => settle?.(), submissions,
    pending: (value: boolean) => { annotations = { ...annotations, editState: value ? "pending" : "ready" }; store.setState({ libraryItemVersion: (store.getState().libraryItemVersion ?? 0) + 1 }); },
    openSnapshot: () => useCommandSurfaceStore.setState({ savedContentOpen: true, savedContentEditItem: item, savedContentInitialUrl: item.sourceUrl!, savedContentAnnotations: annotations }),
    fail: (state: typeof failure) => { failure = state; store.setState({ libraryItemVersion: (store.getState().libraryItemVersion ?? 0) + 1 }); },
    event: (complete: boolean) => window.dispatchEvent(new CustomEvent("freed:edit-saved-content", { detail: { item, ...(complete ? { annotations } : {}) } })),
    close: () => useCommandSurfaceStore.getState().closeSavedContentDialog(),
    openWithoutSnapshot: () => useCommandSurfaceStore.setState({ savedContentOpen: true, savedContentEditItem: item, savedContentInitialUrl: item.sourceUrl!, savedContentAnnotations: null }),
  };
}
