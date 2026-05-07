import { createElement, useEffect } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { Account, BaseAppState, FeedItem, FilterOptions, Person } from "@freed/shared";
import type { PlatformConfig } from "../../../ui/src/context/PlatformContext.tsx";
import { PlatformProvider } from "../../../ui/src/context/PlatformContext.tsx";
import { AppShell } from "../../../ui/src/components/layout/AppShell.tsx";
import { SearchJumpField } from "../../../ui/src/components/layout/SearchJumpField.tsx";
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
    feeds: overrides.feeds ?? {},
    persons: overrides.persons ?? {},
    accounts: overrides.accounts ?? {},
    friends: overrides.friends ?? {},
    preferences: overrides.preferences ?? ({
      display: {
        themeId: "midas",
        reading: {
          dualColumnMode: false,
          focusMode: false,
        },
        archivePruneDays: 30,
        sidebarMode: "expanded",
        friendsMode: "all_content",
        mapMode: "friends",
        mapTimeMode: "current",
      },
    } as BaseAppState["preferences"]),
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
    setActiveView: overrides.setActiveView ?? ((view: "feed" | "friends" | "map") => set({ activeView: view })),
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
    GoogleContactsSettingsContent: null,
    ...overrides,
  };
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
    changeInput(input!, "broken");
    await flush();

    expect(document.body.textContent).toContain("https://broken.example/feed.xml");
  });

  it("archives current scope read items with one visible ID batch", async () => {
    const archiveItems = vi.fn(async () => {});
    const toggleArchived = vi.fn(async () => {});
    const visibleReadPost = createItem({
      globalId: "instagram:visible-read-post",
      platform: "instagram",
      contentType: "post",
      userState: { hidden: false, saved: false, archived: false, readAt: 10, tags: [], highlights: [] },
    });
    const hiddenByContentFilter = createItem({
      globalId: "instagram:story-read",
      platform: "instagram",
      contentType: "story",
      userState: { hidden: false, saved: false, archived: false, readAt: 11, tags: [], highlights: [] },
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
      items: [visibleReadPost, hiddenByContentFilter, unreadPost, savedPost],
      archiveItems,
      toggleArchived,
    });
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
    changeInput(input!, "archive");
    await flush();

    const archiveAction = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Archive current scope read items"),
    );
    expect(archiveAction).not.toBeUndefined();
    click(archiveAction!);
    await flush();

    expect(archiveItems).toHaveBeenCalledTimes(1);
    expect(archiveItems).toHaveBeenCalledWith(["instagram:visible-read-post"]);
    expect(toggleArchived).not.toHaveBeenCalled();
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
    const platform = createPlatform(store);
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
