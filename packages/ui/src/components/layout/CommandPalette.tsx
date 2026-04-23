import { createPortal } from "react-dom";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { FilterOptions, Platform } from "@freed/shared";
import { TOP_SOURCE_ITEMS } from "../../lib/source-navigation.tsx";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { useSettingsStore } from "../../lib/settings-store.js";
import { useCommandSurfaceStore } from "../../lib/command-surface-store.js";
import { SearchField } from "../SearchField.js";
import { BottomSheet } from "../BottomSheet.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useSearchResults } from "../../hooks/useSearchResults.js";
import { buildSettingsSectionMetas } from "../../lib/settings-sections.js";
import { buildTopLevelTagFilters, collectAllTags } from "../../lib/tag-navigation.js";
import { applyFeedSearch, navigateToFeedView } from "../../lib/workspace-navigation.js";
import { buildCommandPaletteActions } from "../../lib/command-palette-registry.js";
import {
  filterCommandPaletteActions,
  type CommandPaletteAction,
} from "../../lib/command-palette.js";

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

export function CommandPalette() {
  const isMobile = useIsMobile();
  const paletteOpen = useCommandSurfaceStore((s) => s.paletteOpen);
  const closePalette = useCommandSurfaceStore((s) => s.closePalette);
  const openAddFeedDialog = useCommandSurfaceStore((s) => s.openAddFeedDialog);
  const openSavedContentDialog = useCommandSurfaceStore((s) => s.openSavedContentDialog);
  const openLibraryDialog = useCommandSurfaceStore((s) => s.openLibraryDialog);
  const openSettingsTo = useSettingsStore((s) => s.openTo);
  const settingsOpen = useSettingsStore((s) => s.open);
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
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const searchCorpusVersion = useAppStore((s) => s.searchCorpusVersion);
  const display = useAppStore((s) => s.preferences.display);

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

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [confirmAction, setConfirmAction] = useState<CommandPaletteAction | null>(null);
  const [confirmValue, setConfirmValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const confirmInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!paletteOpen) {
      setQuery("");
      setActiveIndex(-1);
      setConfirmAction(null);
      setConfirmValue("");
      return;
    }

    const focusTarget = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(focusTarget);
  }, [paletteOpen]);

  useEffect(() => {
    if (!confirmAction) return;
    const focusTarget = window.setTimeout(() => {
      confirmInputRef.current?.focus();
      confirmInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(focusTarget);
  }, [confirmAction]);

  useEffect(() => {
    if (!paletteOpen || isMobile) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, paletteOpen]);

  useEffect(() => {
    if (paletteOpen && settingsOpen) {
      closePalette();
    }
  }, [closePalette, paletteOpen, settingsOpen]);

  const actions = useMemo(
    () =>
      buildCommandPaletteActions({
        query,
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
        openImportLibraryDialog: importMarkdown
          ? () => openLibraryDialog("import")
          : null,
        openExportLibraryDialog: exportMarkdown
          ? () => openLibraryDialog("export")
          : null,
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
        closeReader:
          selectedItem
            ? () => setSelectedItem(null)
            : null,
        toggleCurrentItemSaved:
          selectedItem
            ? () => toggleSaved(selectedItem.globalId)
            : null,
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
          selectedItem && toggleLiked
            ? () => toggleLiked(selectedItem.globalId)
            : null,
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
      query,
    ],
  );

  const filteredActions = useMemo(
    () => filterCommandPaletteActions(actions, query),
    [actions, query],
  );
  const actionSections = useMemo(
    () => groupActionsBySection(filteredActions),
    [filteredActions],
  );

  useEffect(() => {
    if (confirmAction) return;
    setActiveIndex(filteredActions.length > 0 ? 0 : -1);
  }, [confirmAction, filteredActions]);

  if (!paletteOpen) {
    return null;
  }

  const selectedAction = activeIndex >= 0 ? filteredActions[activeIndex] ?? null : null;

  function handleClose() {
    closePalette();
  }

  async function runAction(action: CommandPaletteAction) {
    if (action.confirm) {
      setConfirmAction(action);
      setConfirmValue("");
      return;
    }

    closePalette();
    await action.run();
  }

  async function handleConfirmSubmit() {
    if (!confirmAction?.confirm) return;
    if (confirmValue !== confirmAction.confirm.token) return;
    closePalette();
    await confirmAction.run();
  }

  async function handleActionSelection(action: CommandPaletteAction) {
    try {
      await runAction(action);
    } catch {
      // Toast state is handled by the action runner.
    }
  }

  function handleActionKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
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

    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
      return;
    }

    if (filteredActions.length === 0) return;

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
    }
  }

  const panel = (
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
              htmlFor="command-palette-confirm"
              className="block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--theme-text-soft)]"
            >
              Type {confirmAction.confirm.token}
            </label>
            <input
              ref={confirmInputRef}
              id="command-palette-confirm"
              value={confirmValue}
              onChange={(event) => setConfirmValue(event.target.value)}
              onKeyDown={handleActionKeyDown}
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
          <SearchField
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleActionKeyDown}
            onClear={() => setQuery("")}
            placeholder="Type a command or search term"
            aria-label="Command palette"
            containerClassName="mb-3"
          />

          {actionSections.length > 0 ? (
            <div
              role="listbox"
              aria-label="Command palette actions"
              data-testid="command-palette-results"
              className="max-h-[min(60vh,28rem)] overflow-y-auto"
            >
              {actionSections.map((section) => (
                <div key={section.section} className="pb-3">
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
                          data-testid={`command-palette-action-${action.id}`}
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

  if (isMobile) {
    return (
      <BottomSheet open={paletteOpen} onClose={handleClose} title="Command Palette" maxWidth="sm:max-w-2xl">
        {panel}
      </BottomSheet>
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto p-4 pt-[max(3rem,10dvh)]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <div className="theme-elevated-overlay absolute inset-0" />
      <section
        className="theme-dialog-shell relative z-10 flex w-full max-w-2xl flex-col rounded-[28px] border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] p-4 shadow-[var(--theme-glow-lg)]"
        data-testid="command-palette-modal"
      >
        {panel}
      </section>
    </div>,
    document.body,
  );
}
