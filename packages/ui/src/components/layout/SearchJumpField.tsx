import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type { FilterOptions, Platform } from "@freed/shared";

import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { useSearchResults } from "../../hooks/useSearchResults.js";
import { buildCommandPaletteActions } from "../../lib/command-palette-registry.js";
import {
  filterCommandPaletteActions,
  type CommandPaletteAction,
} from "../../lib/command-palette.js";
import { useCommandSurfaceStore } from "../../lib/command-surface-store.js";
import { useSettingsStore } from "../../lib/settings-store.js";
import { buildSettingsSectionMetas } from "../../lib/settings-sections.js";
import { buildTopLevelTagFilters, collectAllTags } from "../../lib/tag-navigation.js";
import { applyFeedSearch, navigateToFeedView } from "../../lib/workspace-navigation.js";
import { SearchField } from "../SearchField.js";
import { Tooltip } from "../Tooltip.js";
import { TOP_SOURCE_ITEMS } from "../../lib/source-navigation.js";
import {
  AllIcon,
  ArchiveIcon,
  BookmarkIcon,
  ExternalLinkIcon,
  FacebookIcon,
  FilterIcon,
  GoogleContactsIcon,
  InstagramIcon,
  LinkedInIcon,
  MapPinIcon,
  RssIcon,
  TrashIcon,
  UsersIcon,
  XIcon,
} from "../icons.js";

function groupActionsBySection(actions: readonly CommandPaletteAction[]) {
  const sections: Array<{ section: string; actions: CommandPaletteAction[] }> = [];
  for (const action of actions) {
    const group = sections.find((candidate) => candidate.section === action.section);
    if (group) {
      group.actions.push(action);
      continue;
    }
    sections.push({ section: action.section, actions: [action] });
  }
  return sections;
}

function PaletteLineIcon({ children }: { children: ReactNode }) {
  return (
    <span
      data-testid="search-command-action-icon"
      className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--theme-text-muted)]"
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

function PaletteSvgIcon({
  children,
  fill = "none",
  strokeWidth = 2,
}: {
  children: ReactNode;
  fill?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function getCommandPaletteIcon(action: CommandPaletteAction): ReactNode {
  const iconClass = "h-4 w-4";

  if (action.id === "go-unified-feed" || action.id === "go-source-all") {
    return <AllIcon className={iconClass} />;
  }
  if (action.id === "go-saved" || action.id === "go-settings-saved" || action.id === "item-toggle-saved") {
    return <BookmarkIcon className={iconClass} />;
  }
  if (action.id === "go-archived" || action.id === "item-toggle-archived" || action.id === "scope-unarchive-saved") {
    return <ArchiveIcon className={iconClass} />;
  }
  if (action.id === "go-friends") {
    return <UsersIcon className={iconClass} />;
  }
  if (action.id === "go-map") {
    return <MapPinIcon className={iconClass} />;
  }
  if (action.id === "go-source-rss" || action.id.startsWith("go-feed-") || action.id === "go-settings-feeds" || action.id === "scope-sync-rss") {
    return <RssIcon className={iconClass} />;
  }
  if (action.id === "go-source-x" || action.id === "go-settings-x") {
    return <XIcon className={iconClass} />;
  }
  if (action.id === "go-source-facebook" || action.id === "go-settings-facebook") {
    return <FacebookIcon className={iconClass} />;
  }
  if (action.id === "go-source-instagram" || action.id === "go-settings-instagram") {
    return <InstagramIcon className={iconClass} />;
  }
  if (action.id === "go-source-linkedin" || action.id === "go-settings-linkedin") {
    return <LinkedInIcon className={iconClass} />;
  }
  if (action.id === "go-settings-googleContacts") {
    return <GoogleContactsIcon className={iconClass} />;
  }
  if (action.id === "go-settings-danger" || action.id.startsWith("danger-")) {
    return <TrashIcon className={iconClass} />;
  }
  if (action.id.startsWith("go-tag-")) {
    return (
      <PaletteSvgIcon>
        <path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7.2-7.2V4h9.4l7.8 7.8a2 2 0 010 1.6z" />
        <circle cx="7.5" cy="7.5" r="1.5" />
      </PaletteSvgIcon>
    );
  }
  if (action.id.startsWith("go-settings-")) {
    return (
      <PaletteSvgIcon>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 00.34 1.88l.04.04a2 2 0 01-2.83 2.83l-.04-.04A1.7 1.7 0 0015 19.4a1.7 1.7 0 00-1 1.55V21a2 2 0 01-4 0v-.05a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.88.34l-.04.04a2 2 0 01-2.83-2.83l.04-.04A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.55-1H3a2 2 0 010-4h.05A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.34-1.88l-.04-.04a2 2 0 012.83-2.83l.04.04A1.7 1.7 0 009 4.6a1.7 1.7 0 001-1.55V3a2 2 0 014 0v.05a1.7 1.7 0 001 1.55 1.7 1.7 0 001.88-.34l.04-.04a2 2 0 012.83 2.83l-.04.04A1.7 1.7 0 0019.4 9a1.7 1.7 0 001.55 1H21a2 2 0 010 4h-.05a1.7 1.7 0 00-1.55 1z" />
      </PaletteSvgIcon>
    );
  }
  if (action.id === "create-add-rss" || action.id === "create-save-url") {
    return (
      <PaletteSvgIcon>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </PaletteSvgIcon>
    );
  }
  if (action.id === "create-import-markdown") {
    return (
      <PaletteSvgIcon>
        <path d="M12 3v12" />
        <path d="M8 11l4 4 4-4" />
        <path d="M5 21h14" />
      </PaletteSvgIcon>
    );
  }
  if (action.id === "create-export-markdown") {
    return (
      <PaletteSvgIcon>
        <path d="M12 21V9" />
        <path d="M8 13l4-4 4 4" />
        <path d="M5 3h14" />
      </PaletteSvgIcon>
    );
  }
  if (action.id === "item-open-original") {
    return <ExternalLinkIcon className={iconClass} />;
  }
  if (action.id === "item-close-reader") {
    return (
      <PaletteSvgIcon>
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </PaletteSvgIcon>
    );
  }
  if (action.id === "item-toggle-liked") {
    return (
      <PaletteSvgIcon>
        <path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 000-7.8z" />
      </PaletteSvgIcon>
    );
  }
  if (action.id === "scope-mark-read" || action.id === "scope-archive-read") {
    return (
      <PaletteSvgIcon>
        <path d="M20 6L9 17l-5-5" />
      </PaletteSvgIcon>
    );
  }
  if (action.id.startsWith("scope-sync-source-")) {
    return (
      <PaletteSvgIcon>
        <path d="M21 12a9 9 0 01-15.5 6.2" />
        <path d="M3 12A9 9 0 0118.5 5.8" />
        <path d="M18.5 2.8v3h-3" />
        <path d="M5.5 21.2v-3h3" />
      </PaletteSvgIcon>
    );
  }
  if (action.id === "scope-check-updates") {
    return (
      <PaletteSvgIcon>
        <path d="M12 3v12" />
        <path d="M7 10l5 5 5-5" />
        <path d="M5 21h14" />
      </PaletteSvgIcon>
    );
  }
  if (action.id === "search-feed") {
    return (
      <PaletteSvgIcon>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </PaletteSvgIcon>
    );
  }
  if (action.section === "Search") {
    return <FilterIcon className={iconClass} />;
  }

  return (
    <PaletteSvgIcon>
      <path d="M9 18l6-6-6-6" />
    </PaletteSvgIcon>
  );
}

export function SearchJumpField({
  compactSidebar = false,
  narrowSidebar = false,
  mobileSidebar = false,
  variant = "inline",
  inlineMarginBottomPx,
}: {
  compactSidebar?: boolean;
  narrowSidebar?: boolean;
  mobileSidebar?: boolean;
  variant?: "inline" | "trigger";
  inlineMarginBottomPx?: number;
}) {
  const platform = usePlatform();
  const {
    addRssFeed,
    saveUrl,
    importMarkdown,
    exportMarkdown,
    syncRssNow,
    syncSourceNow,
    checkForUpdates,
    factoryReset,
    activeCloudProviderLabel,
    openUrl,
    XSettingsContent,
    FacebookSettingsContent,
    InstagramSettingsContent,
    LinkedInSettingsContent,
    GoogleContactsSettingsContent,
  } = platform;
  const searchPaletteRequestId = useCommandSurfaceStore((s) => s.searchPaletteRequestId);
  const openAddFeedDialog = useCommandSurfaceStore((s) => s.openAddFeedDialog);
  const openSavedContentDialog = useCommandSurfaceStore((s) => s.openSavedContentDialog);
  const openLibraryDialog = useCommandSurfaceStore((s) => s.openLibraryDialog);
  const openSettingsTo = useSettingsStore((s) => s.openTo);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const items = useAppStore((s) => s.items);
  const feeds = useAppStore((s) => s.feeds);
  const persons = useAppStore((s) => s.persons);
  const accounts = useAppStore((s) => s.accounts);
  const friends = useAppStore((s) => s.friends);
  const activeView = useAppStore((s) => s.activeView);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const setFilter = useAppStore((s) => s.setFilter);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const setSelectedItem = useAppStore((s) => s.setSelectedItem);
  const setSelectedPerson = useAppStore((s) => s.setSelectedPerson);
  const toggleSaved = useAppStore((s) => s.toggleSaved);
  const toggleArchived = useAppStore((s) => s.toggleArchived);
  const toggleLiked = useAppStore((s) => s.toggleLiked);
  const markItemsAsRead = useAppStore((s) => s.markItemsAsRead);
  const unarchiveSavedItems = useAppStore((s) => s.unarchiveSavedItems);
  const deleteAllArchived = useAppStore((s) => s.deleteAllArchived);
  const searchCorpusVersion = useAppStore((s) => s.searchCorpusVersion);
  const display = useAppStore((s) => s.preferences.display);
  const [inputValue, setInputValue] = useState(searchQuery);
  const [isFocused, setIsFocused] = useState(false);
  const [isTriggerOpen, setIsTriggerOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [confirmAction, setConfirmAction] = useState<CommandPaletteAction | null>(null);
  const [confirmValue, setConfirmValue] = useState("");
  const [palettePosition, setPalettePosition] = useState<CSSProperties>({
    left: 12,
    top: 12,
    visibility: "hidden",
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inlineAnchorRef = useRef<HTMLDivElement | null>(null);
  const inlineInputRef = useRef<HTMLInputElement | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerPaletteRef = useRef<HTMLDivElement | null>(null);
  const floatingInputRef = useRef<HTMLInputElement | null>(null);
  const confirmInputRef = useRef<HTMLInputElement | null>(null);
  const lastSearchPaletteRequestIdRef = useRef(searchPaletteRequestId);
  const hasActiveSearch = searchQuery.trim().length > 0;
  const inlinePlaceholder = narrowSidebar ? "Search" : "Search or run";
  const usesFloatingTrigger = variant === "trigger";
  const showFloatingField = usesFloatingTrigger && isTriggerOpen;
  const showInlineSurface = !usesFloatingTrigger && isFocused;
  const showCommandSurface = showFloatingField || showInlineSurface || !!confirmAction;

  const selectedItem = useMemo(
    () => (selectedItemId ? items.find((item) => item.globalId === selectedItemId) ?? null : null),
    [items, selectedItemId],
  );

  const { filteredItems } = useSearchResults(
    items,
    searchQuery,
    activeFilter,
    searchCorpusVersion,
    display.friendsMode ?? "all_content",
    persons,
    accounts,
    friends,
  );

  const unreadScopeIds = useMemo(
    () => filteredItems.filter((item) => !item.userState.readAt).map((item) => item.globalId),
    [filteredItems],
  );
  const archivableScopeItems = useMemo(
    () =>
      filteredItems.filter(
        (item) => !!item.userState.readAt && !item.userState.saved && !item.userState.archived,
      ),
    [filteredItems],
  );
  const savedArchivedCount = useMemo(
    () => items.filter((item) => item.userState.saved && item.userState.archived).length,
    [items],
  );
  const archivedCount = useMemo(
    () => items.filter((item) => item.userState.archived && !item.userState.saved).length,
    [items],
  );
  const enabledFeeds = useMemo(
    () =>
      Object.values(feeds)
        .filter((feed) => feed.enabled)
        .sort((left, right) => left.title.localeCompare(right.title)),
    [feeds],
  );
  const allTags = useMemo(() => collectAllTags(items), [items]);
  const tagFilters = useMemo(() => buildTopLevelTagFilters(allTags), [allTags]);
  const settingsSections = useMemo(
    () =>
      buildSettingsSectionMetas({
        hasGoogleContacts: !!GoogleContactsSettingsContent,
        hasX: !!XSettingsContent,
        hasFacebook: !!FacebookSettingsContent,
        hasInstagram: !!InstagramSettingsContent,
        hasLinkedIn: !!LinkedInSettingsContent,
        hasUpdateChecks: !!checkForUpdates,
        hasFactoryReset: !!factoryReset,
      }),
    [
      FacebookSettingsContent,
      GoogleContactsSettingsContent,
      InstagramSettingsContent,
      LinkedInSettingsContent,
      XSettingsContent,
      checkForUpdates,
      factoryReset,
    ],
  );
  const currentSourceId = useMemo<Platform | null>(() => {
    if (activeView !== "feed") return null;
    if (activeFilter.platform) return activeFilter.platform as Platform;
    if (activeFilter.feedUrl) return "rss";
    return null;
  }, [activeFilter.feedUrl, activeFilter.platform, activeView]);

  const closeCommandSurface = useCallback(() => {
    setConfirmAction(null);
    setConfirmValue("");
    setIsTriggerOpen(false);
  }, []);

  const actions = useMemo(
    () =>
      buildCommandPaletteActions({
        query: inputValue,
        activeView,
        activeFilter,
        settingsSections,
        topSources: TOP_SOURCE_ITEMS.map((source) => ({
          id: (source.id ?? undefined) as Platform | undefined,
          label: source.label,
        })),
        feeds: enabledFeeds.map((feed) => ({
          url: feed.url,
          title: feed.title,
        })),
        tagFilters,
        currentSourceId,
        selectedItem,
        unreadScopeCount: activeView === "feed" ? unreadScopeIds.length : 0,
        archivableScopeCount: activeView === "feed" ? archivableScopeItems.length : 0,
        savedArchivedCount,
        archivedCount,
        openSettingsTo,
        navigateToFeed: (filter: FilterOptions) =>
          navigateToFeedView(
            {
              setActiveView,
              setSelectedPerson,
              setSelectedItem,
              setFilter,
            },
            filter,
          ),
        navigateToFriends: () => {
          setSelectedItem(null);
          setSelectedPerson(null);
          setActiveView("friends");
        },
        navigateToMap: () => {
          setSelectedItem(null);
          setSelectedPerson(null);
          setActiveView("map");
        },
        applyFeedSearch: (nextQuery: string) =>
          applyFeedSearch(
            {
              setActiveView,
              setSelectedPerson,
              setSelectedItem,
              setSearchQuery,
            },
            nextQuery,
          ),
        openAddFeedDialog: addRssFeed ? () => openAddFeedDialog() : null,
        openSavedContentDialog: saveUrl ? () => openSavedContentDialog() : null,
        openImportLibraryDialog: importMarkdown ? () => openLibraryDialog("import") : null,
        openExportLibraryDialog: exportMarkdown ? () => openLibraryDialog("export") : null,
        openCurrentItemUrl:
          selectedItem?.sourceUrl
            ? () => {
                if (openUrl) {
                  openUrl(selectedItem.sourceUrl!);
                  return;
                }
                window.open(selectedItem.sourceUrl!, "_blank", "noopener,noreferrer");
              }
            : null,
        closeReader: selectedItem ? () => setSelectedItem(null) : null,
        toggleCurrentItemSaved: selectedItem ? () => toggleSaved(selectedItem.globalId) : null,
        toggleCurrentItemArchived:
          selectedItem
            ? async () => {
                const wasArchived = selectedItem.userState.archived;
                await toggleArchived(selectedItem.globalId);
                if (!wasArchived) {
                  setSelectedItem(null);
                }
              }
            : null,
        toggleCurrentItemLiked:
          selectedItem && toggleLiked ? () => toggleLiked(selectedItem.globalId) : null,
        markScopeRead:
          activeView === "feed" && unreadScopeIds.length > 0
            ? () => markItemsAsRead(unreadScopeIds)
            : null,
        archiveScopeRead:
          activeView === "feed" && archivableScopeItems.length > 0
            ? async () => {
                for (const item of archivableScopeItems) {
                  await toggleArchived(item.globalId);
                }
              }
            : null,
        unarchiveSavedItems,
        syncRssNow,
        syncCurrentSource: syncSourceNow,
        checkForUpdates,
        deleteAllArchived,
        factoryReset,
        activeCloudProviderLabel,
      }),
    [
      activeCloudProviderLabel,
      activeFilter,
      activeView,
      addRssFeed,
      archivableScopeItems,
      archivedCount,
      checkForUpdates,
      currentSourceId,
      deleteAllArchived,
      enabledFeeds,
      factoryReset,
      inputValue,
      markItemsAsRead,
      openAddFeedDialog,
      openSavedContentDialog,
      openSettingsTo,
      openUrl,
      importMarkdown,
      exportMarkdown,
      saveUrl,
      savedArchivedCount,
      selectedItem,
      setActiveView,
      setFilter,
      setSearchQuery,
      setSelectedItem,
      setSelectedPerson,
      settingsSections,
      syncRssNow,
      syncSourceNow,
      tagFilters,
      toggleArchived,
      toggleLiked,
      toggleSaved,
      unreadScopeIds,
      unarchiveSavedItems,
      openLibraryDialog,
    ],
  );

  const filteredActions = useMemo(
    () => filterCommandPaletteActions(actions, inputValue),
    [actions, inputValue],
  );
  const actionSections = useMemo(
    () => groupActionsBySection(filteredActions),
    [filteredActions],
  );
  const selectedAction = activeIndex >= 0 ? filteredActions[activeIndex] ?? null : null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setSearchQuery(inputValue);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, setSearchQuery]);

  useEffect(() => {
    setInputValue((current) => {
      if (searchQuery === current) return current;
      if (searchQuery === "" || current === "") return searchQuery;
      return current;
    });
  }, [searchQuery]);

  useEffect(() => {
    if (!usesFloatingTrigger) {
      setIsTriggerOpen(false);
    }
  }, [usesFloatingTrigger]);

  useEffect(() => {
    if (confirmAction) return;
    setActiveIndex(filteredActions.length > 0 ? 0 : -1);
  }, [confirmAction, filteredActions]);

  useEffect(() => {
    if (!confirmAction) return;
    const focusTarget = window.setTimeout(() => {
      confirmInputRef.current?.focus();
      confirmInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(focusTarget);
  }, [confirmAction]);

  useEffect(() => {
    if (!showFloatingField) return;
    const focusInput = () => {
      floatingInputRef.current?.focus();
      floatingInputRef.current?.select();
    };
    const animationFrame = window.requestAnimationFrame(focusInput);
    const immediateFocus = window.setTimeout(focusInput, 0);
    const settledFocus = window.setTimeout(focusInput, 50);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(immediateFocus);
      window.clearTimeout(settledFocus);
    };
  }, [mounted, showFloatingField]);

  useEffect(() => {
    if (searchPaletteRequestId === lastSearchPaletteRequestIdRef.current) return;
    lastSearchPaletteRequestIdRef.current = searchPaletteRequestId;
    if (usesFloatingTrigger) {
      setIsTriggerOpen(true);
      return;
    }
    inlineInputRef.current?.focus();
    inlineInputRef.current?.select();
  }, [searchPaletteRequestId, usesFloatingTrigger]);

  useEffect(() => {
    if (!showCommandSurface) {
      return undefined;
    }

    const updatePosition = () => {
      const anchor = usesFloatingTrigger ? triggerButtonRef.current : inlineAnchorRef.current;
      if (!anchor || !triggerPaletteRef.current) return;

      const anchorRect = anchor.getBoundingClientRect();
      const fieldRect = triggerPaletteRef.current.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = usesFloatingTrigger ? 10 : 8;
      const sidebarRect = anchor.closest('[data-testid="app-sidebar"]')?.getBoundingClientRect();
      const maxTop = Math.max(
        viewportPadding,
        window.innerHeight - viewportPadding - fieldRect.height,
      );
      const top = Math.min(
        Math.max(viewportPadding, usesFloatingTrigger ? (sidebarRect?.top ?? anchorRect.top) : anchorRect.top),
        maxTop,
      );
      const maxLeft = Math.max(
        viewportPadding,
        window.innerWidth - viewportPadding - fieldRect.width,
      );

      setPalettePosition({
        left: Math.min(anchorRect.right + gap, maxLeft),
        top,
        visibility: "visible",
      });
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (
        triggerButtonRef.current?.contains(event.target as Node) ||
        inlineAnchorRef.current?.contains(event.target as Node) ||
        triggerPaletteRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setIsFocused(false);
      closeCommandSurface();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsFocused(false);
      closeCommandSurface();
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeCommandSurface, showCommandSurface, usesFloatingTrigger]);

  function clearSearch() {
    setInputValue("");
    setSearchQuery("");
  }

  async function handleConfirmSubmit() {
    if (!confirmAction?.confirm) return;
    if (confirmValue !== confirmAction.confirm.token) return;
    closeCommandSurface();
    await confirmAction.run();
  }

  async function runAction(action: CommandPaletteAction) {
    if (action.confirm) {
      setConfirmAction(action);
      setConfirmValue("");
      return;
    }

    closeCommandSurface();
    await action.run();
  }

  async function handleActionSelection(action: CommandPaletteAction) {
    try {
      await runAction(action);
    } catch {
      // Action runners own their toast state.
    }
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();

    if (confirmAction?.confirm) {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmAction(null);
        setConfirmValue("");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void handleConfirmSubmit();
      }
      return;
    }

    if (showCommandSurface && filteredActions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => {
          const nextIndex = index < 0 ? 0 : index + 1;
          return nextIndex % filteredActions.length;
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => {
          if (index <= 0) return filteredActions.length - 1;
          return index - 1;
        });
        return;
      }

      if (event.key === "Enter" && selectedAction) {
        event.preventDefault();
        void handleActionSelection(selectedAction);
        return;
      }
    }

    if (event.key !== "Escape") return;

    if (showCommandSurface) {
      event.preventDefault();
      setIsFocused(false);
      closeCommandSurface();
      return;
    }

    if (inputValue) {
      event.preventDefault();
      clearSearch();
      return;
    }

    event.currentTarget.blur();
  }

  function renderActionSurface(includeInput: boolean) {
    return (
      <div className="flex flex-col">
        {confirmAction?.confirm ? (
          <div className="space-y-4 p-1">
            <div className="space-y-1">
              <p className="text-base font-semibold text-[var(--theme-text-primary)]">
                {confirmAction.confirm.title}
              </p>
              <p className="text-sm text-[var(--theme-text-muted)]">
                {confirmAction.confirm.description}
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="search-command-confirm"
                className="block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--theme-text-soft)]"
              >
                Type {confirmAction.confirm.token}
              </label>
              <input
                ref={confirmInputRef}
                id="search-command-confirm"
                value={confirmValue}
                onChange={(event) => setConfirmValue(event.target.value)}
                onKeyDown={handleInputKeyDown}
                className="theme-input w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmAction(null);
                  setConfirmValue("");
                }}
                className="theme-toolbar-button-ghost rounded-lg px-3 py-2 text-sm"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleConfirmSubmit();
                }}
                disabled={confirmValue !== confirmAction.confirm.token}
                className="btn-primary rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirmAction.confirm.confirmLabel}
              </button>
            </div>
          </div>
        ) : (
          <>
            {includeInput ? (
              <SearchField
                ref={floatingInputRef}
                autoFocus
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={handleInputKeyDown}
                onClear={clearSearch}
                placeholder="Search or run"
                aria-label="Search or run"
                containerClassName="mb-3"
              />
            ) : null}

            {actionSections.length > 0 ? (
              <div
                role="listbox"
                aria-label="Search commands"
                data-testid="search-command-results"
                className="max-h-[min(60vh,28rem)] overflow-y-auto"
              >
                {actionSections.map((section) => (
                  <div key={section.section} className="pb-3 last:pb-0">
                    <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-soft)]">
                      {section.section}
                    </p>
                    <div className="space-y-1">
                      {section.actions.map((action) => {
                        const index = filteredActions.findIndex((candidate) => candidate.id === action.id);
                        const isActive = index === activeIndex;
                        const actionIcon = getCommandPaletteIcon(action);
                        return (
                          <button
                            key={action.id}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            data-testid={`search-command-action-${action.id}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => {
                              void handleActionSelection(action);
                            }}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                              isActive
                                ? "bg-[var(--theme-bg-muted)] text-[var(--theme-text-primary)]"
                                : "text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                            }`}
                          >
                            <PaletteLineIcon>{actionIcon}</PaletteLineIcon>
                            <span className="min-w-0 flex-1 truncate">{action.title}</span>
                            {action.confirm ? (
                              <span className="shrink-0 rounded-md border border-[var(--theme-border-subtle)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--theme-text-soft)]">
                                Confirm
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--theme-border-subtle)] px-4 py-5 text-center text-sm text-[var(--theme-text-muted)]">
                No matching commands.
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const commandSurface = mounted && showCommandSurface
    ? createPortal(
        <div
          ref={triggerPaletteRef}
          data-testid={usesFloatingTrigger ? "compact-sidebar-search-palette" : "sidebar-search-command-palette"}
          className="theme-dialog-shell fixed z-[320] w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-[var(--card-radius)] border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] p-2 shadow-2xl shadow-black/50"
          style={palettePosition}
        >
          {renderActionSurface(usesFloatingTrigger)}
        </div>,
        document.body,
      )
    : null;

  if (usesFloatingTrigger) {
    const triggerActive = showFloatingField || hasActiveSearch;

    return (
      <div className={compactSidebar ? "relative z-20 mb-[2px] w-full" : "relative z-20 mb-3 flex justify-center"}>
        <Tooltip
          label="Search or run"
          side={compactSidebar ? "right" : undefined}
          className={compactSidebar ? "flex w-full" : undefined}
        >
          <button
            ref={triggerButtonRef}
            type="button"
            data-testid="compact-sidebar-search-trigger"
            onClick={() => setIsTriggerOpen((value) => !value)}
            className={compactSidebar
              ? `relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[var(--card-radius)] border transition-colors ${
                  triggerActive
                    ? "border-[var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[var(--theme-text-primary)]"
                    : "border-transparent bg-transparent text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                }`
              : `relative flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--theme-border-subtle)] bg-transparent text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-border-quiet)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)] ${
                  showFloatingField ? "border-[var(--theme-border-strong)] bg-[var(--theme-bg-muted)] text-[var(--theme-text-primary)]" : ""
                }`}
            aria-label="Search or run"
            aria-expanded={showFloatingField}
            aria-pressed={triggerActive}
            aria-haspopup="dialog"
          >
            <svg
              className="h-[18px] w-[18px]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </button>
        </Tooltip>
        {commandSurface}
      </div>
    );
  }

  return (
    <div
      ref={inlineAnchorRef}
      data-testid="sidebar-search-field-wrapper"
      className="relative z-20"
      style={{
        marginBottom: `${inlineMarginBottomPx ?? (mobileSidebar ? 14 : narrowSidebar ? 8 : 16)}px`,
        transition: "margin-bottom 180ms ease",
      }}
    >
      <SearchField
        ref={inlineInputRef}
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          window.setTimeout(() => {
            if (!triggerPaletteRef.current?.matches(":hover")) {
              setIsFocused(false);
            }
          }, 150);
        }}
        onKeyDown={handleInputKeyDown}
        onClear={clearSearch}
        placeholder={inlinePlaceholder}
        aria-label="Search or run"
        style={narrowSidebar && !inputValue ? { paddingRight: 0 } : undefined}
        inputClassName={
          mobileSidebar
            ? "h-12 rounded-xl pl-10 pr-8 text-base"
            : compactSidebar
            ? "pl-7 pr-6"
            : narrowSidebar
              ? inputValue
                ? "pl-7 pr-6"
                : "pl-7 pr-0"
              : "pl-8 pr-5"
        }
        data-expanded={isFocused ? "true" : "false"}
      />
      {commandSurface}
    </div>
  );
}
