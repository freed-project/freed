import { createElement, useEffect } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { createDefaultPreferences, type Account, type BaseAppState, type FeedItem, type FilterOptions, type Person } from "@freed/shared";
import type {
  LibraryCoreNormalizedQueryExecutor,
  LibraryCoreRssFeedPageRowV1,
  LibraryCoreAccountGraphRowV1,
} from "@freed/shared/library-core";
import type {
  BoundedFeedReader,
  PlatformConfig,
} from "../../../ui/src/context/PlatformContext.tsx";
import { PlatformProvider } from "../../../ui/src/context/PlatformContext.tsx";
import { SettingsDialog } from "../../../ui/src/components/SettingsDialog.tsx";
import { AppShell } from "../../../ui/src/components/layout/AppShell.tsx";
import { SearchJumpField } from "../../../ui/src/components/layout/SearchJumpField.tsx";
import {
  useLibraryCommandPaletteReader,
  type LibraryCommandPaletteReaderResult,
} from "../../../ui/src/hooks/useLibraryCommandPaletteReader.ts";
import {
  dedupeCommandPaletteActions,
  filterCommandPaletteActions,
  rankCommandPaletteAction,
  type CommandPaletteAction,
} from "../../../ui/src/lib/command-palette.ts";
import { buildCommandPaletteActions } from "../../../ui/src/lib/command-palette-registry.ts";
import { useCommandSurfaceStore } from "../../../ui/src/lib/command-surface-store.ts";
import { useSettingsStore } from "../../../ui/src/lib/settings-store.ts";

const noop = () => {};
const noopAsync = async () => {};
const EMPTY_FILTER: FilterOptions = {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function resetSurfaceStores() {
  useCommandSurfaceStore.setState({
    searchPaletteRequestId: 0,
    addFeedOpen: false,
    savedContentOpen: false,
    libraryDialogOpen: false,
    libraryDialogTab: "import",
  });
  useSettingsStore.setState({
    open: false,
    targetSection: null,
  });
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function createItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    globalId: overrides.globalId ?? "item-1",
    platform: overrides.platform ?? "rss",
    sourceUrl: overrides.sourceUrl ?? "https://example.com/article",
    author: overrides.author ?? {
      id: "author-1",
      displayName: "Author",
      handle: "@author",
    },
    content: overrides.content ?? {
      text: "Alpha article",
      linkPreview: {
        title: "Alpha article",
        description: "Alpha description",
        url: "https://example.com/article",
      },
    },
    userState: overrides.userState ?? {
      hidden: false,
      saved: false,
      archived: false,
      readAt: undefined,
      liked: false,
      tags: [],
      highlights: [],
    },
    topics: overrides.topics ?? [],
    rssSource: overrides.rssSource ?? {
      feedUrl: "https://alpha.example/feed.xml",
      feedTitle: "Alpha Feed",
    },
    contentType: overrides.contentType ?? "article",
    publishedAt: overrides.publishedAt ?? Date.now(),
    ...overrides,
  } as FeedItem;
}

function createTestStore(overrides: Partial<BaseAppState> = {}) {
  return create<BaseAppState>((set) => ({
    items: overrides.items ?? [],
    searchCorpusVersion: overrides.searchCorpusVersion ?? 0,
    libraryItemVersion: overrides.libraryItemVersion,
    feeds: overrides.feeds ?? {},
    persons: overrides.persons ?? {},
    accounts: overrides.accounts ?? {},
    friends: overrides.friends ?? {},
    preferences: overrides.preferences ?? createDefaultPreferences(),
    feedUnreadCounts: overrides.feedUnreadCounts ?? {},
    feedTotalCounts: overrides.feedTotalCounts ?? {},
    totalUnreadCount: overrides.totalUnreadCount ?? 0,
    unreadCountByPlatform: overrides.unreadCountByPlatform ?? {},
    totalItemCount: overrides.totalItemCount ?? (overrides.items?.length ?? 0),
    itemCountByPlatform: overrides.itemCountByPlatform ?? {},
    totalArchivableCount: overrides.totalArchivableCount ?? 0,
    archivableCountByPlatform: overrides.archivableCountByPlatform ?? {},
    archivableFeedCounts: overrides.archivableFeedCounts ?? {},
    mapFriendLocationCount: overrides.mapFriendLocationCount ?? 0,
    mapAllContentLocationCount: overrides.mapAllContentLocationCount ?? 0,
    isLoading: false,
    isSyncing: false,
    isInitialized: true,
    error: null,
    activeFilter: overrides.activeFilter ?? {},
    selectedItemId: overrides.selectedItemId ?? null,
    selectedPersonId: null,
    selectedAccountId: null,
    selectedFriendId: null,
    initialize: overrides.initialize ?? noopAsync,
    addItems: overrides.addItems ?? noopAsync,
    updateItem: overrides.updateItem ?? noopAsync,
    markAsRead: overrides.markAsRead ?? noopAsync,
    markItemsAsRead:
      overrides.markItemsAsRead
      ?? (async (ids: string[]) => {
        set((state) => ({
          items: state.items.map((item) =>
            ids.includes(item.globalId)
              ? {
                  ...item,
                  userState: {
                    ...item.userState,
                    readAt: item.userState.readAt ?? Date.now(),
                  },
                }
              : item,
          ),
        }));
      }),
    markAllAsRead: overrides.markAllAsRead ?? noopAsync,
    toggleSaved:
      overrides.toggleSaved
      ?? (async (id: string) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.globalId === id
              ? { ...item, userState: { ...item.userState, saved: !item.userState.saved } }
              : item,
          ),
        }));
      }),
    toggleArchived:
      overrides.toggleArchived
      ?? (async (id: string) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.globalId === id
              ? { ...item, userState: { ...item.userState, archived: !item.userState.archived } }
              : item,
          ),
        }));
      }),
    archiveItems:
      overrides.archiveItems
      ?? (async (ids: string[]) => {
        set((state) => ({
          items: state.items.map((item) =>
            ids.includes(item.globalId)
              ? { ...item, userState: { ...item.userState, archived: true, archivedAt: Date.now() } }
              : item,
          ),
        }));
      }),
    archiveAllReadUnsaved: overrides.archiveAllReadUnsaved ?? noopAsync,
    unarchiveSavedItems:
      overrides.unarchiveSavedItems
      ?? (async () => {
        set((state) => ({
          items: state.items.map((item) =>
            item.userState.saved
              ? { ...item, userState: { ...item.userState, archived: false } }
              : item,
          ),
        }));
      }),
    deleteAllArchived:
      overrides.deleteAllArchived
      ?? (async () => {
        set((state) => ({
          items: state.items.filter((item) => !item.userState.archived || item.userState.saved),
        }));
      }),
    removeItem: overrides.removeItem ?? noopAsync,
    clearSampleData:
      overrides.clearSampleData
      ?? (async () => ({ feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 })),
    addSampleLibraryData: overrides.addSampleLibraryData ?? noopAsync,
    toggleLiked:
      overrides.toggleLiked
      ?? (async (id: string) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.globalId === id
              ? { ...item, userState: { ...item.userState, liked: !item.userState.liked } }
              : item,
          ),
        }));
      }),
    addFeed: overrides.addFeed ?? noopAsync,
    removeFeed: overrides.removeFeed ?? noopAsync,
    renameFeed: overrides.renameFeed ?? noopAsync,
    removeAllFeeds: overrides.removeAllFeeds ?? noopAsync,
    addPerson: overrides.addPerson ?? noopAsync,
    addPersons: overrides.addPersons ?? noopAsync,
    updatePerson: overrides.updatePerson ?? noopAsync,
    removePerson: overrides.removePerson ?? noopAsync,
    addFriend: overrides.addFriend ?? noopAsync,
    addFriends: overrides.addFriends ?? noopAsync,
    updateFriend: overrides.updateFriend ?? noopAsync,
    removeFriend: overrides.removeFriend ?? noopAsync,
    logReachOut: overrides.logReachOut ?? noopAsync,
    addAccount: overrides.addAccount ?? noopAsync,
    addAccounts: overrides.addAccounts ?? noopAsync,
    updateAccount: overrides.updateAccount ?? noopAsync,
    removeAccount: overrides.removeAccount ?? noopAsync,
    linkAccountToPerson: overrides.linkAccountToPerson ?? noopAsync,
    createConnectionPersonFromAccounts:
      overrides.createConnectionPersonFromAccounts
      ?? (async () => "connection-person-id"),
    createConnectionPersonsFromCandidates:
      overrides.createConnectionPersonsFromCandidates
      ?? (async () => 0),
    updatePreferences: overrides.updatePreferences ?? noopAsync,
    setFilter: overrides.setFilter ?? ((filter: FilterOptions) => set({ activeFilter: filter })),
    setSelectedItem: overrides.setSelectedItem ?? ((id: string | null) => set({ selectedItemId: id })),
    setSelectedPerson: overrides.setSelectedPerson ?? noop,
    setSelectedAccount: overrides.setSelectedAccount ?? noop,
    setSelectedFriend: overrides.setSelectedFriend ?? noop,
    setLoading: overrides.setLoading ?? noop,
    setSyncing: overrides.setSyncing ?? noop,
    setError: overrides.setError ?? noop,
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
          selectedFriendId: personId,
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

function identityQueryFromStore(
  store: PlatformConfig["store"],
): LibraryCoreNormalizedQueryExecutor {
  return (async (request: { queryId: string; limit?: number }) => {
    const state = store.getState() as Pick<
      BaseAppState,
      "accounts" | "feeds" | "persons"
    >;
    const source = {
      generationId: "a".repeat(64),
      projectionRevision: 1,
      transitionSequence: 1,
    };
    if (request.queryId === "rss_feed_page_v1") {
      const rows: LibraryCoreRssFeedPageRowV1[] = Object.values(state.feeds)
        .map((feed) => ({
          activityCount: 0,
          enabled: feed.enabled !== false,
          folder: feed.folder ?? null,
          imageUrl: feed.imageUrl ?? null,
          lastFetched: feed.lastFetched ?? null,
          latestActivityAt: null,
          pollInterval: feed.pollInterval ?? null,
          sampleBatchId: null,
          sampleGeneratedAt: null,
          sampleGeneratorVersion: null,
          siteUrl: feed.siteUrl ?? null,
          title: typeof feed.title === "string" && feed.title.trim()
            ? feed.title
            : feed.url,
          trackUnread: feed.trackUnread === true,
          unreadCount: 0,
          updatedAt: 1,
          url: feed.url,
        }))
        .sort((left, right) => left.url.localeCompare(right.url))
        .slice(0, request.limit ?? 128);
      return {
        layoutRevision: 1,
        nextCursor: null,
        queryId: "rss_feed_page_v1",
        rows,
        schemaVersion: 1,
        source,
      };
    }
    if (request.queryId === "account_graph_page_v1") {
      const rows: LibraryCoreAccountGraphRowV1[] = Object.values(state.accounts)
        .filter((account) => typeof account.externalId === "string")
        .map((account) => ({
          activityCount: 0,
          avatarUrl: account.avatarUrl ?? null,
          discoveredFrom: account.discoveredFrom,
          displayName: account.displayName ?? null,
          externalId: account.externalId,
          firstSeenAt: account.firstSeenAt,
          followRosterActive: account.followRosterActive ?? null,
          graphPinned: false,
          graphUpdatedAt: null,
          graphX: null,
          graphY: null,
          handle: account.handle ?? null,
          id: account.id,
          kind: account.kind,
          lastSeenAt: account.lastSeenAt,
          latestActivityAt: null,
          personId: account.personId ?? null,
          personName: account.personId
            ? state.persons[account.personId]?.name ?? null
            : null,
          provider: account.provider,
          updatedAt: account.updatedAt,
        }))
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, request.limit ?? 128);
      return {
        layoutRevision: 1,
        nextCursor: null,
        queryId: "account_graph_page_v1",
        rows,
        schemaVersion: 1,
        source,
      };
    }
    throw new Error(`Unexpected identity query: ${request.queryId}`);
  }) as unknown as LibraryCoreNormalizedQueryExecutor;
}

function boundedReader(items: readonly FeedItem[]): BoundedFeedReader {
  let read = false;
  return {
    totalCount: items.length,
    async readNext() {
      if (read) return [];
      read = true;
      return items;
    },
    async close() {},
  };
}

function boundedReaderFactory(
  items: readonly FeedItem[],
): NonNullable<PlatformConfig["openBoundedFeedReader"]> {
  return async () => boundedReader(items);
}

function ShortcutProbe({ onShortcut }: { onShortcut: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "j") {
        onShortcut();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onShortcut]);

  return null;
}

function LibraryCommandPaletteReaderProbe({
  commandScopeItems,
  inputValue,
  onResult,
  searchQuery,
  sourceVersion = 0,
}: {
  commandScopeItems: FeedItem[];
  inputValue: string;
  onResult: (result: LibraryCommandPaletteReaderResult) => void;
  searchQuery: string;
  sourceVersion?: number;
}) {
  onResult(useLibraryCommandPaletteReader({
    activeFilter: EMPTY_FILTER,
    activeView: "feed",
    commandScopeItems,
    enabled: true,
    identityMode: "all_content",
    inputValue,
    searchQuery,
    selectedItemId: null,
    sourceVersion,
  }));
  return null;
}

function click(element: Element) {
  act(() => {
    (element as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function changeInput(element: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function keydown(target: EventTarget, key: string, options: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function renderNode(node: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });

  return {
    root,
    container,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("command palette", () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    resetSurfaceStores();
    document.body.innerHTML = "";
    setViewportWidth(1280);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes("max-width") ? window.innerWidth <= 767 : false,
        media: query,
        onchange: null,
        addListener: noop,
        removeListener: noop,
        addEventListener: noop,
        removeEventListener: noop,
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    vi.restoreAllMocks();
    resetSurfaceStores();
    document.body.innerHTML = "";
  });

  it("ranks and dedupes actions, keeping feed search fallback last", () => {
    const actions: CommandPaletteAction[] = [
      { id: "alpha", title: "Alpha", section: "Go to", keywords: ["first"], run: noop },
      { id: "alpha", title: "Alpha duplicate", section: "Go to", keywords: ["dup"], run: noop },
      { id: "beta", title: "Beta", section: "Go to", keywords: ["alpha"], run: noop },
      {
        id: "search-feed",
        title: 'Search feed for "alpha"',
        section: "Search",
        keywords: ["alpha"],
        run: noop,
        fallback: true,
      },
    ];

    expect(dedupeCommandPaletteActions(actions).map((action) => action.id)).toEqual([
      "alpha",
      "beta",
      "search-feed",
    ]);
    expect(rankCommandPaletteAction(actions[0], "alpha")).toBeGreaterThan(
      rankCommandPaletteAction(actions[1], "alpha"),
    );
    expect(filterCommandPaletteActions(actions, "alpha").map((action) => action.id)).toEqual([
      "alpha",
      "beta",
      "search-feed",
    ]);
  });

  it("builds contextual actions only when the relevant inputs exist", () => {
    const deleteArchived = vi.fn(async () => {});
    const openImport = vi.fn();

    const actions = buildCommandPaletteActions({
      query: "privacy",
      activeView: "friends",
      activeFilter: {},
      settingsSections: [{ id: "appearance", label: "Appearance", keywords: ["theme"] }],
      topSources: [{ id: "rss", label: "Feeds" }],
      feeds: [{ url: "https://alpha.example/feed.xml", title: "Alpha Feed" }],
      tagFilters: [{ label: "Research", tags: ["Research", "Research/AI"] }],
      currentSourceId: null,
      selectedItem: null,
      unreadScopeCount: 0,
      archivableScopeCount: 0,
      savedArchivedCount: 0,
      archivedCount: 2,
      openSettingsTo: noop,
      navigateToFeed: noop,
      navigateToFriends: noop,
      navigateToMap: noop,
      applyFeedSearch: noop,
      openAddFeedDialog: null,
      openSavedContentDialog: null,
      openImportLibraryDialog: openImport,
      openExportLibraryDialog: null,
      deleteAllArchived: deleteArchived,
      activeCloudProviderLabel: () => "Dropbox",
    });

    expect(actions.some((action) => action.id === "create-import-markdown")).toBe(true);
    expect(actions.some((action) => action.id === "create-add-rss")).toBe(false);
    expect(actions.some((action) => action.id === "item-open-original")).toBe(false);
    expect(actions.find((action) => action.id === "danger-delete-archived")?.confirm?.token).toBe("DELETE");
    expect(actions.at(-1)?.id).toBe("search-feed");
  });

  it("hides feed and danger suggestions until the user types", () => {
    const common = {
      activeView: "feed" as const,
      activeFilter: {},
      settingsSections: [],
      topSources: [{ id: "rss" as const, label: "Feeds" }],
      feeds: [{ url: "https://alpha.example/feed.xml", title: "Alpha Feed" }],
      tagFilters: [],
      currentSourceId: null,
      selectedItem: null,
      unreadScopeCount: 0,
      archivableScopeCount: 0,
      savedArchivedCount: 0,
      archivedCount: 2,
      openSettingsTo: noop,
      navigateToFeed: noop,
      navigateToFriends: noop,
      navigateToMap: noop,
      applyFeedSearch: noop,
      deleteAllArchived: noop,
    };

    const blankActions = filterCommandPaletteActions(buildCommandPaletteActions({ ...common, query: "" }), "");
    expect(blankActions.some((action) => action.id.startsWith("go-feed-"))).toBe(false);
    expect(blankActions.some((action) => action.id.startsWith("danger-"))).toBe(false);

    const typedActions = filterCommandPaletteActions(buildCommandPaletteActions({ ...common, query: "alpha" }), "alpha");
    expect(typedActions.some((action) => action.id === "go-feed-https://alpha.example/feed.xml")).toBe(true);
    expect(typedActions.some((action) => action.id === "danger-delete-archived")).toBe(false);

    const dangerActions = filterCommandPaletteActions(buildCommandPaletteActions({ ...common, query: "delete" }), "delete");
    expect(dangerActions.some((action) => action.id === "danger-delete-archived")).toBe(true);
  });

  it("adds typed social channel suggestions that navigate to an author filter", () => {
    const navigateToFeed = vi.fn();
    const account: Account = {
      id: "social:x:rob",
      kind: "social",
      provider: "x",
      externalId: "rob",
      handle: "@rob",
      displayName: "Rob Beschizza",
      firstSeenAt: 1,
      lastSeenAt: 1,
      discoveredFrom: "captured_item",
      createdAt: 1,
      updatedAt: 1,
    };

    const actions = buildCommandPaletteActions({
      query: "besch",
      activeView: "feed",
      activeFilter: {},
      settingsSections: [],
      topSources: [],
      feeds: [],
      socialChannels: [{ account, personName: "Rob" }],
      tagFilters: [],
      currentSourceId: null,
      selectedItem: null,
      unreadScopeCount: 0,
      archivableScopeCount: 0,
      savedArchivedCount: 0,
      archivedCount: 0,
      openSettingsTo: noop,
      navigateToFeed,
      navigateToFriends: noop,
      navigateToMap: noop,
      applyFeedSearch: noop,
    });

    const channelAction = actions.find((action) => action.id === "go-channel-x-rob");
    expect(channelAction?.title).toBe("Rob Beschizza");
    channelAction?.run();
    expect(navigateToFeed).toHaveBeenCalledWith({ platform: "x", authorId: "rob" });
  });

  it("adds typed social profile navigation and promotion actions", async () => {
    const navigateToSocialProfileFriends = vi.fn();
    const navigateToSocialProfileMap = vi.fn();
    const promoteSocialProfile = vi.fn();
    const account: Account = {
      id: "social:instagram:kr3ture_music",
      personId: "person-kr3ture",
      kind: "social",
      provider: "instagram",
      externalId: "kr3ture_music",
      handle: "@kr3ture_music",
      displayName: "kr3ture_music",
      firstSeenAt: 1,
      lastSeenAt: 1,
      discoveredFrom: "captured_item",
      createdAt: 1,
      updatedAt: 1,
    };
    const person: Person = {
      id: "person-kr3ture",
      name: "Kr3ture",
      relationshipStatus: "connection",
      careLevel: 2,
      createdAt: 1,
      updatedAt: 1,
    };

    const actions = buildCommandPaletteActions({
      query: "kr3tu",
      activeView: "feed",
      activeFilter: {},
      settingsSections: [],
      topSources: [],
      feeds: [],
      socialChannels: [{ account, person }],
      tagFilters: [],
      currentSourceId: null,
      selectedItem: null,
      unreadScopeCount: 0,
      archivableScopeCount: 0,
      savedArchivedCount: 0,
      archivedCount: 0,
      openSettingsTo: noop,
      navigateToFeed: noop,
      navigateToFriends: noop,
      navigateToMap: noop,
      navigateToSocialProfileFriends,
      navigateToSocialProfileMap,
      promoteSocialProfile,
      applyFeedSearch: noop,
    });

    const friendsAction = actions.find((action) => action.id === "go-profile-friends-social:instagram:kr3ture_music");
    expect(friendsAction?.title).toBe("Kr3ture's Friends view");
    friendsAction?.run();
    expect(navigateToSocialProfileFriends).toHaveBeenCalledWith(account, "person-kr3ture");

    const mapAction = actions.find((action) => action.id === "go-profile-map-social:instagram:kr3ture_music");
    expect(mapAction?.title).toBe("Kr3ture on Map");
    mapAction?.run();
    expect(navigateToSocialProfileMap).toHaveBeenCalledWith(account, "person-kr3ture");

    await actions.find((action) => action.id === "promote-profile-friend-social:instagram:kr3ture_music")?.run();
    expect(promoteSocialProfile).toHaveBeenCalledWith(account, 3);

    await actions.find((action) => action.id === "promote-profile-close-friend-social:instagram:kr3ture_music")?.run();
    expect(promoteSocialProfile).toHaveBeenCalledWith(account, 5);
  });

  it("focuses the sidebar search from AppShell with Cmd/Ctrl+K", async () => {
    const shortcutSpy = vi.fn();
    const store = createTestStore();
    const platform = createPlatform(store);
    const render = renderNode(
      createElement(
        PlatformProvider,
        {
          value: platform,
          children: createElement(
            AppShell,
            null,
            createElement(ShortcutProbe, { onShortcut: shortcutSpy }),
          ),
        },
      ),
    );
    cleanups.push(render.cleanup);

    keydown(window, "k", { metaKey: true });
    await flush();

    const searchInput = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(searchInput).not.toBeNull();
    expect(document.activeElement).toBe(searchInput);
    expect(document.querySelector("[data-testid='command-palette-modal']")).toBeNull();

    keydown(searchInput!, "j");
    expect(shortcutSpy).not.toHaveBeenCalled();
  });

  it("shows command actions inside the search palette and can run explicit feed search", async () => {
    const store = createTestStore({
      activeView: "friends",
      activeFilter: { platform: "rss", feedUrl: "https://alpha.example/feed.xml" },
      feeds: {
        "https://alpha.example/feed.xml": {
          url: "https://alpha.example/feed.xml",
          title: "Alpha Feed",
          enabled: true,
        } as BaseAppState["feeds"][string],
      },
    });
    const platform = createPlatform(store, {
      queryLibraryCore: identityQueryFromStore(store),
    });
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();
    changeInput(input!, "privacy");
    await flush();

    const searchAction = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes('Search feed for "privacy"'),
    );
    expect(searchAction).not.toBeUndefined();
    click(searchAction!);
    await flush();

    expect(store.getState().activeView).toBe("feed");
    expect(store.getState().searchQuery).toBe("privacy");
    expect(store.getState().activeFilter).toEqual({
      platform: "rss",
      feedUrl: "https://alpha.example/feed.xml",
    });
  });

  it("omits AI settings from the search palette when the platform cannot manage AI", async () => {
    const store = createTestStore();
    const platform = createPlatform(store);
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();
    changeInput(input!, "ai");
    await flush();

    const aiSettingsAction = document.querySelector("[data-testid='search-command-action-go-settings-ai']");
    expect(aiSettingsAction).toBeNull();
    expect(document.body.textContent).not.toContain("AI settings");
  });

  it("omits AI settings from the settings nav when the platform cannot manage AI", async () => {
    const store = createTestStore();
    const platform = createPlatform(store);
    const render = renderNode(
      createElement(
        PlatformProvider,
        {
          value: platform,
          children: createElement(SettingsDialog, { open: true, onClose: noop }),
        },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    expect(document.querySelector('[data-section="ai"]')).toBeNull();
    expect(Array.from(document.querySelectorAll("button")).some((button) => button.textContent === "AI")).toBe(false);
  });

  it("keeps AI settings in the search palette when the platform can manage AI", async () => {
    const store = createTestStore();
    const platform = createPlatform(store, {
      secureStorage: {
        getApiKey: async () => null,
        setApiKey: noopAsync,
        clearApiKey: noopAsync,
      },
    });
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();
    changeInput(input!, "ai");
    await flush();

    expect(document.querySelector("[data-testid='search-command-action-go-settings-ai']")).not.toBeNull();
  });

  it("renders with malformed stored feed and account labels", async () => {
    const store = createTestStore({
      feeds: {
        "https://broken.example/feed.xml": {
          url: "https://broken.example/feed.xml",
          title: undefined,
          enabled: true,
        } as unknown as BaseAppState["feeds"][string],
      },
      accounts: {
        "social:x:broken": {
          id: "social:x:broken",
          kind: "social",
          provider: "x",
          externalId: undefined,
          firstSeenAt: 1,
          lastSeenAt: 1,
          discoveredFrom: "captured_item",
          createdAt: 1,
          updatedAt: 1,
        } as unknown as Account,
      },
    });
    const platform = createPlatform(store, {
      queryLibraryCore: identityQueryFromStore(store),
    });
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();
    changeInput(input!, "broken");
    await flush();

    expect(document.body.textContent).toContain("https://broken.example/feed.xml");
  });

  it("archives current scope read items from bounded SQLite pages", async () => {
    const archiveItems = vi.fn(async () => {});
    const executeLibraryScopeAction = vi.fn(async () => ({
      affectedCount: 1,
      batchCount: 1,
      schemaVersion: 1 as const,
    }));
    const toggleArchived = vi.fn(async () => {});
    const visibleReadPost = createItem({
      globalId: "instagram:visible-read-post",
      platform: "instagram",
      contentType: "post",
      userState: { hidden: false, saved: false, archived: false, readAt: 10, tags: [], highlights: [] },
    });
    const unreadPost = createItem({
      globalId: "instagram:unread-post",
      platform: "instagram",
      contentType: "post",
      userState: { hidden: false, saved: false, archived: false, tags: [], highlights: [] },
    });
    const savedPost = createItem({
      globalId: "instagram:saved-post",
      platform: "instagram",
      contentType: "post",
      userState: { hidden: false, saved: true, archived: false, readAt: 12, tags: [], highlights: [] },
    });
    const store = createTestStore({
      activeFilter: { platform: "instagram", socialContentFilter: "posts" },
      items: [visibleReadPost, unreadPost, savedPost],
      archiveItems,
      toggleArchived,
    });
    const scopedItems = [visibleReadPost, unreadPost, savedPost];
    const platform = createPlatform(store, {
      executeLibraryScopeAction,
      openBoundedFeedReader: boundedReaderFactory(scopedItems),
    });
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();

    const archiveAction = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Archive current scope read items"),
    );
    expect(archiveAction).not.toBeUndefined();
    click(archiveAction!);
    await flush();

    expect(executeLibraryScopeAction).toHaveBeenCalledTimes(1);
    expect(executeLibraryScopeAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "archive", query: null }),
    );
    expect(archiveItems).not.toHaveBeenCalled();
    expect(toggleArchived).not.toHaveBeenCalled();
  });

  it("rejects a captured bulk action when the visible query is not committed", async () => {
    const archiveItems = vi.fn(async () => {});
    const executeLibraryScopeAction = vi.fn(async () => ({
      affectedCount: 1,
      batchCount: 1,
      schemaVersion: 1 as const,
    }));
    const scopedItem = createItem({
      globalId: "query-result",
      content: { text: "cats and dogs", mediaUrls: [], mediaTypes: [] },
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        readAt: 10,
        tags: [],
        highlights: [],
      },
    });
    const store = createTestStore({
      archiveItems,
      items: [scopedItem],
      searchQuery: "cats",
    });
    const platform = createPlatform(store, { executeLibraryScopeAction });
    let result: LibraryCommandPaletteReaderResult | null = null;
    const currentResult = () => result;
    const onResult = (next: LibraryCommandPaletteReaderResult) => {
      result = next;
    };
    const probe = (inputValue: string, sourceVersion = 0) =>
      createElement(
        PlatformProvider,
        {
          value: platform,
          children: createElement(LibraryCommandPaletteReaderProbe, {
            commandScopeItems: [scopedItem],
            inputValue,
            onResult,
            searchQuery: "cats",
            sourceVersion,
          }),
        },
      );
    const render = renderNode(probe("cats"));
    cleanups.push(render.cleanup);
    await flush();

    expect(currentResult()?.archivableScopeCount).toBe(1);
    const capturedAction = currentResult()!.archiveScopeRead;
    await act(async () => {
      await capturedAction();
    });
    expect(executeLibraryScopeAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "archive", query: "cats" }),
    );
    executeLibraryScopeAction.mockClear();

    act(() => render.root.render(probe("dogs")));
    await flush();
    expect(currentResult()?.archivableScopeCount).toBe(0);

    await act(async () => {
      await capturedAction();
    });
    expect(executeLibraryScopeAction).not.toHaveBeenCalled();

    act(() => render.root.render(probe("")));
    await flush();
    expect(currentResult()?.archivableScopeCount).toBe(0);
    await act(async () => {
      await capturedAction();
    });
    expect(executeLibraryScopeAction).not.toHaveBeenCalled();

    act(() => render.root.render(probe("cats", 1)));
    await flush();
    expect(currentResult()?.archivableScopeCount).toBe(1);
    await act(async () => {
      await capturedAction();
    });
    expect(executeLibraryScopeAction).not.toHaveBeenCalled();
    expect(archiveItems).not.toHaveBeenCalled();
  });

  it("reads SearchJump facets and simple-scope counts without hydrating the Desktop corpus", async () => {
    const openBoundedFeedReader = vi.fn(boundedReaderFactory([]));
    const store = createTestStore({
      items: [],
      totalArchivableCount: 9,
      totalUnreadCount: 17,
    });
    const platform = createPlatform(store, {
      openBoundedFeedReader,
      readLibraryFacetSummary: async () => ({
        archivedCount: 3,
        archivableCount: 0,
        platformCounts: [
          {
            archivableCount: 0,
            platform: "rss",
            totalCount: 3,
            unreadCount: 0,
          },
        ],
        sampleAccountCount: 0,
        sampleFeedCount: 0,
        sampleItemCount: 0,
        samplePersonCount: 0,
        savedArchivedCount: 2,
        savedCount: 2,
        savedPlatformCount: 0,
        tags: ["Architecture", "Research", "Secret"],
        totalCount: 3,
        unreadCount: 0,
      }),
    });
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    expect(openBoundedFeedReader).not.toHaveBeenCalled();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();

    expect(document.querySelector("[data-testid='search-command-action-scope-mark-read']")).not.toBeNull();
    expect(document.querySelector("[data-testid='search-command-action-scope-archive-read']")).not.toBeNull();
    expect(document.querySelector("[data-testid='search-command-action-go-tag-Architecture']")).not.toBeNull();
    expect(document.querySelector("[data-testid='search-command-action-go-tag-Research']")).not.toBeNull();
    expect(document.querySelector("[data-testid='search-command-action-go-tag-Secret']")).not.toBeNull();
    expect(document.querySelector("[data-testid='search-command-action-scope-unarchive-saved']")).not.toBeNull();
    expect(openBoundedFeedReader).not.toHaveBeenCalled();
  });

  it("uses canonical RSS membership and bounded pages for its bulk action", async () => {
    const archiveItems = vi.fn(async () => {});
    const executeLibraryScopeAction = vi.fn(async () => ({
      affectedCount: 1,
      batchCount: 1,
      schemaVersion: 1 as const,
    }));
    const visibleReadPost = createItem({
      globalId: "instagram:visible-read-post",
      platform: "instagram",
      contentType: "article",
      userState: { hidden: false, saved: false, archived: false, readAt: 10, tags: [], highlights: [] },
    });
    const savedPost = createItem({
      globalId: "instagram:saved-post",
      platform: "rss",
      contentType: "article",
      userState: { hidden: false, saved: true, archived: false, readAt: 12, tags: [], highlights: [] },
    });
    const scopedItems = [visibleReadPost, savedPost];
    const store = createTestStore({
      activeFilter: { platform: "rss" },
      archiveItems,
      items: [],
    });
    const openBoundedFeedReader = vi.fn(boundedReaderFactory(scopedItems));
    const platform = createPlatform(store, {
      executeLibraryScopeAction,
      openBoundedFeedReader,
    });
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();

    expect(openBoundedFeedReader).toHaveBeenCalledOnce();
    expect(openBoundedFeedReader).toHaveBeenCalledWith(
      { platform: "rss" },
      expect.any(Number),
    );
    changeInput(input!, "archive");
    await flush();
    expect(
      document.querySelector("[data-testid='search-command-action-scope-archive-read']"),
    ).toBeNull();
    expect(archiveItems).not.toHaveBeenCalled();

    changeInput(input!, "");
    await flush();
    const archiveAction = document.querySelector(
      "[data-testid='search-command-action-scope-archive-read']",
    );
    expect(archiveAction).not.toBeNull();
    click(archiveAction!);
    await flush();

    expect(executeLibraryScopeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "archive",
        filter: expect.objectContaining({ platform: "rss" }),
        query: null,
      }),
    );
    expect(archiveItems).not.toHaveBeenCalled();

    executeLibraryScopeAction.mockRejectedValueOnce(
      new Error("mutation unavailable"),
    );
    click(archiveAction!);
    await flush();
    await flush();
    expect(executeLibraryScopeAction).toHaveBeenCalledTimes(2);
  });

  it("fails closed across SQLite reader errors and recovers on a newer source", async () => {
    let readerFails = true;
    let detailFails = true;
    const selectedItem = createItem({ globalId: "selected" });
    const store = createTestStore({
      activeFilter: { tags: ["Research"] },
      items: [],
      libraryItemVersion: 1,
      selectedItemId: "selected",
    });
    const openBoundedFeedReader = vi.fn<
      NonNullable<PlatformConfig["openBoundedFeedReader"]>
    >(
      async () => {
        if (readerFails) throw new Error("reader unavailable");
        return boundedReader([]);
      },
    );
    const readLibraryItemDetail = vi.fn<NonNullable<PlatformConfig["readLibraryItemDetail"]>>(
      async () => {
        if (detailFails) throw new Error("detail unavailable");
        return selectedItem;
      },
    );
    const platform = createPlatform(store, {
      openBoundedFeedReader,
      readLibraryItemDetail,
      readLibraryFacetSummary: async () => ({
        archivedCount: 0,
        archivableCount: 0,
        platformCounts: [],
        sampleAccountCount: 0,
        sampleFeedCount: 0,
        sampleItemCount: 0,
        samplePersonCount: 0,
        savedArchivedCount: 0,
        savedCount: 0,
        savedPlatformCount: 0,
        tags: ["Research"],
        totalCount: 0,
        unreadCount: 0,
      }),
    });
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();
    await flush();
    expect(
      document.querySelector("[data-testid='search-command-action-item-toggle-saved']"),
    ).toBeNull();

    act(() => store.setState({ persons: {}, accounts: {}, friends: {} }));
    await flush();
    expect(openBoundedFeedReader).toHaveBeenCalledOnce();
    expect(readLibraryItemDetail).toHaveBeenCalledOnce();

    act(() => store.setState({ libraryItemVersion: 2 }));
    expect(
      document.querySelector("[data-testid='search-command-action-item-toggle-saved']"),
    ).toBeNull();
    await flush();
    await flush();
    expect(openBoundedFeedReader).toHaveBeenCalledTimes(2);
    expect(readLibraryItemDetail).toHaveBeenCalledTimes(2);

    readerFails = false;
    detailFails = false;
    act(() => store.setState({ libraryItemVersion: 3 }));
    await flush();
    await flush();
    expect(
      document.querySelector("[data-testid='search-command-action-item-toggle-saved']"),
    ).not.toBeNull();
    expect(openBoundedFeedReader).toHaveBeenCalledTimes(3);
    expect(readLibraryItemDetail).toHaveBeenCalledTimes(3);
  });

  it("closes an in-flight bounded scope reader when SearchJump unmounts", async () => {
    const close = vi.fn(async () => {});
    const readNext = vi.fn(async () => new Promise<readonly FeedItem[]>(() => {}));
    const openBoundedFeedReader = vi.fn(async () => ({
      totalCount: 17_000,
      readNext,
      close,
    }));
    const store = createTestStore({ activeFilter: { tags: ["Research"] } });
    const platform = createPlatform(store, {
      readLibraryFacetSummary: async () => ({
        archivedCount: 0,
        archivableCount: 0,
        platformCounts: [
          {
            archivableCount: 0,
            platform: "rss",
            totalCount: 17_000,
            unreadCount: 0,
          },
        ],
        sampleAccountCount: 0,
        sampleFeedCount: 0,
        sampleItemCount: 0,
        samplePersonCount: 0,
        savedArchivedCount: 0,
        savedCount: 0,
        savedPlatformCount: 0,
        tags: ["Research"],
        totalCount: 17_000,
        unreadCount: 0,
      }),
      openBoundedFeedReader,
    });
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    await flush();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();
    expect(openBoundedFeedReader).toHaveBeenCalledOnce();
    expect(readNext).toHaveBeenCalledOnce();

    render.cleanup();
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the newest source-fenced selected item and ignores a stale detail response", async () => {
    let resolveFirst: ((item: FeedItem) => void) | null = null;
    let resolveSecond: ((item: FeedItem) => void) | null = null;
    const first = new Promise<FeedItem>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<FeedItem>((resolve) => {
      resolveSecond = resolve;
    });
    const readLibraryItemDetail = vi
      .fn<NonNullable<PlatformConfig["readLibraryItemDetail"]>>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const store = createTestStore({
      items: [],
      libraryItemVersion: 1,
      selectedItemId: "selected",
    });
    const platform = createPlatform(store, {
      readLibraryItemDetail,
    });
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();
    act(() => store.setState({ libraryItemVersion: 2 }));
    await flush();

    await act(async () => {
      resolveSecond!(createItem({
        globalId: "selected",
        userState: { hidden: false, saved: true, archived: false, tags: [], highlights: [] },
      }));
      await second;
    });
    await act(async () => {
      resolveFirst!(createItem({ globalId: "selected" }));
      await first;
    });

    expect(readLibraryItemDetail).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[data-testid='search-command-action-item-toggle-saved']")?.textContent)
      .toContain("Unsave current item");

    readLibraryItemDetail.mockResolvedValueOnce(createItem({
      globalId: "selected",
      userState: {
        hidden: true,
        saved: false,
        archived: false,
        tags: [],
        highlights: [],
      },
    }));
    act(() => store.setState({ libraryItemVersion: 3 }));
    await flush();
    expect(
      document.querySelector("[data-testid='search-command-action-item-toggle-saved']"),
    ).not.toBeNull();
  });

  it("renders command action icons and keeps reset confirmation mounted after blur", async () => {
    const resetDevice = vi.fn(async () => {});
    const store = createTestStore();
    const platform = createPlatform(store, { factoryReset: resetDevice });
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();

    const feedAction = document.querySelector("[data-testid='search-command-action-go-unified-feed']");
    expect(feedAction?.querySelector("[data-testid='search-command-action-icon'] svg")).not.toBeNull();

    changeInput(input!, "reset");
    await flush();

    const resetAction = document.querySelector("[data-testid='search-command-action-danger-reset-device']");
    expect(resetAction?.querySelector("[data-testid='search-command-action-icon'] svg")).not.toBeNull();
    click(resetAction!);
    act(() => input!.blur());
    await flush();

    expect(document.body.textContent).toContain("Reset this device?");
    expect(document.querySelector<HTMLInputElement>("#search-command-confirm")).not.toBeNull();
    expect(resetDevice).not.toHaveBeenCalled();
  });

  it("shows destructive confirmation and refuses to run before the token matches", async () => {
    const archivedItem = createItem({
      globalId: "archived-1",
      userState: {
        hidden: false,
        saved: false,
        archived: true,
        readAt: Date.now(),
        liked: false,
        tags: [],
        highlights: [],
      },
    });
    const deleteArchived = vi.fn(async () => {});
    const store = createTestStore({
      items: [archivedItem],
      deleteAllArchived: deleteArchived,
    });
    const platform = createPlatform(store, {
      readLibraryFacetSummary: async () => ({
        archivedCount: 1,
        archivableCount: 0,
        platformCounts: [
          {
            archivableCount: 0,
            platform: "rss",
            totalCount: 1,
            unreadCount: 0,
          },
        ],
        sampleAccountCount: 0,
        sampleFeedCount: 0,
        sampleItemCount: 0,
        samplePersonCount: 0,
        savedArchivedCount: 0,
        savedCount: 0,
        savedPlatformCount: 0,
        tags: [],
        totalCount: 1,
        unreadCount: 0,
      }),
    });
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();
    changeInput(input!, "delete");
    await flush();

    const deleteAction = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Delete all archived items"),
    );
    expect(deleteAction).not.toBeUndefined();
    click(deleteAction!);
    await flush();

    expect(deleteArchived).not.toHaveBeenCalled();
    const confirmInput = document.querySelector<HTMLInputElement>("#search-command-confirm");
    expect(confirmInput).not.toBeNull();

    changeInput(confirmInput!, "nope");
    keydown(confirmInput!, "Enter");
    await flush();
    expect(deleteArchived).not.toHaveBeenCalled();

    changeInput(confirmInput!, "DELETE");
    const confirmButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Delete archived items"),
    );
    expect(confirmButton).not.toBeUndefined();
    click(confirmButton!);
    await flush();

    expect(deleteArchived).toHaveBeenCalledTimes(1);
  });

  it("navigates to a feed destination and then applies explicit search without losing the feed scope", async () => {
    const store = createTestStore({
      activeView: "friends",
      feeds: {
        "https://alpha.example/feed.xml": {
          url: "https://alpha.example/feed.xml",
          title: "Alpha Feed",
          enabled: true,
        } as BaseAppState["feeds"][string],
      },
    });
    const platform = createPlatform(store, {
      queryLibraryCore: identityQueryFromStore(store),
    });
    const render = renderNode(
      createElement(
        PlatformProvider,
        { value: platform, children: createElement(SearchJumpField) },
      ),
    );
    cleanups.push(render.cleanup);
    await flush();

    let input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();
    changeInput(input!, "alpha");
    await flush();

    const feedAction = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Alpha Feed"),
    );
    expect(feedAction).not.toBeUndefined();
    click(feedAction!);
    await flush();

    expect(store.getState().activeView).toBe("feed");
    expect(store.getState().activeFilter).toEqual({
      platform: "rss",
      feedUrl: "https://alpha.example/feed.xml",
    });
    expect(store.getState().searchQuery).toBe("");

    input = document.querySelector<HTMLInputElement>('input[aria-label="Search or run"]');
    expect(input).not.toBeNull();
    act(() => input!.focus());
    await flush();

    changeInput(input!, "alpha");
    await flush();

    const searchAction = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes('Search current feed for "alpha"'),
    );
    expect(searchAction).not.toBeUndefined();
    click(searchAction!);
    await flush();

    expect(store.getState().activeFilter).toEqual({
      platform: "rss",
      feedUrl: "https://alpha.example/feed.xml",
    });
    expect(store.getState().searchQuery).toBe("alpha");
  });
});
