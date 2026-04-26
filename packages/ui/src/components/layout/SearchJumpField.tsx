import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
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

export function SearchJumpField({
  compactSidebar = false,
  narrowSidebar = false,
  variant = "inline",
  inlineMarginBottomPx,
}: {
  compactSidebar?: boolean;
  narrowSidebar?: boolean;
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
  const inlinePlaceholder = narrowSidebar ? "Search" : "Search or run a command";
  const usesFloatingTrigger = variant === "trigger";
  const showFloatingField = usesFloatingTrigger && isTriggerOpen;
  const showInlineSurface = !usesFloatingTrigger && isFocused;
  const showCommandSurface = showFloatingField || showInlineSurface;

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
                placeholder="Search or run a command"
                aria-label="Search or run a command"
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
                            className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                              isActive
                                ? "bg-[var(--theme-bg-muted)] text-[var(--theme-text-primary)]"
                                : "text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                            }`}
                          >
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
          label="Search or run a command"
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
            aria-label="Search or run a command"
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
        marginBottom: `${inlineMarginBottomPx ?? (narrowSidebar ? 8 : 16)}px`,
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
        aria-label="Search or run a command"
        style={narrowSidebar && !inputValue ? { paddingRight: 0 } : undefined}
        inputClassName={
          compactSidebar
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
