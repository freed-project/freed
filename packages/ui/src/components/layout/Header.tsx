import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  countAuthorsWithRecentLocationUpdates,
  countFriendsWithRecentLocationUpdates,
  applyFeedSignalModesToFilter,
  FEED_SIGNAL_FILTER_PRESETS,
  filterFeedItems,
  resolveFeedSignalModesFromDisplay,
  type DisplayPreferences,
  type FeedSignalMode,
  type MapMode,
  type MapTimeMode,
  type SidebarMode,
  type SocialContentFilter,
  resolveMapMode,
} from "@freed/shared";
import { SearchField } from "../SearchField.js";
import { Tooltip } from "../Tooltip.js";
import {
  ArchiveIcon,
  AnimatedMenuIcon,
  FilterIcon,
  ReaderRailHideIcon,
  ReaderRailShowIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
} from "../icons.js";
import { useSearchResults } from "../../hooks/useSearchResults.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useIsMobileDevice } from "../../hooks/useIsMobileDevice.js";
import { useCommandSurfaceStore } from "../../lib/command-surface-store.js";
import { runFeedLayoutTransition } from "../../lib/view-transitions.js";
import {
  MACOS_TRAFFIC_LIGHT_INSET,
  useAppStore,
  usePlatform,
} from "../../context/PlatformContext.js";
import { getFilterLabel, getRetentionLabel } from "../../lib/feed-view-labels.js";
import {
  COMPACT_PRIMARY_SIDEBAR_WIDTH_PX,
  PRIMARY_SIDEBAR_GAP_WIDTH_PX,
  TOOLBAR_SIDEBAR_SLOT_PADDING_RIGHT_PX,
  px,
} from "./layoutConstants.js";

interface HeaderProps {
  mobileSidebarOpen: boolean;
  onMobileMenuToggle: () => void;
  desktopSidebarMode: SidebarMode;
  desktopSidebarDisplayMode?: SidebarMode;
  onDesktopSidebarToggle: () => void;
  friendsSidebarOpen: boolean;
  onFriendsSidebarToggle: () => void;
  friendsMobileSurface: "graph" | "details";
  onFriendsMobileSurfaceChange: (surface: "graph" | "details") => void;
}

type FriendsToolbarMode = MapMode | "details";
interface ToolbarOverflowAction {
  id: string;
  label: string;
  onClick: () => void;
  icon: ReactNode;
  active?: boolean;
  danger?: boolean;
}

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
const dragStyle = { WebkitAppRegion: "drag" } as CSSProperties;
const toolbarControlStyle = { ...noDrag, userSelect: "none" } as CSSProperties;
const TOOLBAR_DRAG_THRESHOLD_PX = 6;
const TOP_TOOLBAR_HEIGHT_PX =
  COMPACT_PRIMARY_SIDEBAR_WIDTH_PX + PRIMARY_SIDEBAR_GAP_WIDTH_PX / 2;
const TOOLBAR_ICON_BUTTON_CLASS =
  "theme-toolbar-icon-button rounded-lg";
const TOOLBAR_READER_LAYOUT_TOGGLE_BUTTON_CLASS =
  "theme-toolbar-reader-layout-button rounded-lg";
const READER_LAYOUT_CONTROL_BUTTON_SIZE_PX = 32;
const READER_LAYOUT_CONTROL_BUTTON_GAP_PX = 0;
const LAYOUT_CONTROL_SAFE_GAP_PX = 8;
const CLOSED_SIDEBAR_TOGGLE_LEFT_PX = 12;
const DEFAULT_LAYOUT_CONTROL_SAFE_LEFT_PX = 180;
const DEFAULT_LAYOUT_CONTROL_RESERVED_WIDTH_PX = 280;
const TOOLBAR_SLOT_WIDTH_CONTENT = "max-content";
const TOOLBAR_COLLAPSE_BREAKPOINT_PX = 1200;
const READER_BOOKMARK_INLINE_MIN_WIDTH_PX = 980;

function formatItemCount(count: number): string {
  return `${count.toLocaleString()} item${count === 1 ? "" : "s"}`;
}

function parsePixelValue(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ToolbarAnimatedSlot({
  visible,
  width,
  flushStartMargin = false,
  className = "",
  style,
  children,
}: {
  visible: boolean;
  width: string;
  flushStartMargin?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const slotStyle = {
    ["--toolbar-slot-width" as string]: width,
    ...(flushStartMargin ? { marginInlineStart: 0 } : {}),
    ...style,
  } as CSSProperties;

  return (
    <div
      className={`theme-toolbar-slot ${visible ? "theme-toolbar-slot-visible" : "theme-toolbar-slot-hidden"} ${className}`}
      style={slotStyle}
      aria-hidden={visible ? undefined : true}
    >
      {children}
    </div>
  );
}

function ToolbarToggleGroup<T extends string>({
  options,
  value,
  onChange,
  compact = false,
  fullWidth = false,
  dataTestId,
  getButtonProps,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  compact?: boolean;
  fullWidth?: boolean;
  dataTestId?: string;
  getButtonProps?: () => ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <div
      data-testid={dataTestId}
      className={`theme-toolbar-segmented ${fullWidth ? "flex w-full" : "inline-flex"} items-center ${compact ? "theme-toolbar-segmented-compact" : ""}`}
      role="tablist"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={`theme-toolbar-segment whitespace-nowrap ${fullWidth ? "flex-1" : ""} ${
              selected ? "theme-toolbar-segment-active" : "theme-toolbar-segment-inactive"
            }`}
            {...getButtonProps?.()}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ToolbarOverflowIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="6" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="18" cy="12" r="1.8" />
    </svg>
  );
}

export function Header({
  mobileSidebarOpen,
  onMobileMenuToggle,
  desktopSidebarMode,
  desktopSidebarDisplayMode,
  onDesktopSidebarToggle,
  friendsSidebarOpen,
  onFriendsSidebarToggle,
  friendsMobileSurface,
  onFriendsMobileSurfaceChange,
}: HeaderProps) {
  const {
    HeaderSyncIndicator,
    headerDragRegion,
    startWindowDrag,
    addRssFeed,
    saveUrl,
    importMarkdown,
    exportMarkdown,
    openUrl,
  } = usePlatform();
  const isMobile = useIsMobile();
  const isMobileDevice = useIsMobileDevice();
  const visibleDesktopSidebarMode = desktopSidebarDisplayMode ?? desktopSidebarMode;
  const desktopSidebarToggleLabel = visibleDesktopSidebarMode === "closed"
    ? "Show sidebar"
    : visibleDesktopSidebarMode === "compact"
      ? "Hide sidebar"
      : "Minimal sidebar";

  const canAddRss = !!addRssFeed;
  const canSaveContent = !!(saveUrl || importMarkdown || exportMarkdown);
  const showNewButton = canAddRss || canSaveContent;
  const addFeedOpen = useCommandSurfaceStore((s) => s.addFeedOpen);
  const savedContentOpen = useCommandSurfaceStore((s) => s.savedContentOpen);
  const openAddFeedDialog = useCommandSurfaceStore((s) => s.openAddFeedDialog);
  const openSavedContentDialog = useCommandSurfaceStore((s) => s.openSavedContentDialog);

  const items = useAppStore((s) => s.items);
  const feeds = useAppStore((s) => s.feeds);
  const persons = useAppStore((s) => s.persons);
  const accounts = useAppStore((s) => s.accounts);
  const friends = useAppStore((s) => s.friends);
  const activeView = useAppStore((s) => s.activeView);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const searchCorpusVersion = useAppStore((s) => s.searchCorpusVersion);
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const totalUnreadCount = useAppStore((s) => s.totalUnreadCount);
  const unreadCountByPlatform = useAppStore((s) => s.unreadCountByPlatform);
  const totalArchivableCount = useAppStore((s) => s.totalArchivableCount);
  const archivableCountByPlatform = useAppStore((s) => s.archivableCountByPlatform);
  const archivableFeedCounts = useAppStore((s) => s.archivableFeedCounts);
  const pendingMatchCount = useAppStore((s) => s.pendingMatchCount);
  const markAllAsRead = useAppStore((s) => s.markAllAsRead);
  const archiveAllReadUnsaved = useAppStore((s) => s.archiveAllReadUnsaved);
  const unarchiveSavedItems = useAppStore((s) => s.unarchiveSavedItems);
  const deleteAllArchived = useAppStore((s) => s.deleteAllArchived);
  const toggleSaved = useAppStore((s) => s.toggleSaved);
  const toggleArchived = useAppStore((s) => s.toggleArchived);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const setSelectedItem = useAppStore((s) => s.setSelectedItem);
  const setFilter = useAppStore((s) => s.setFilter);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const display = useAppStore((s) => s.preferences.display);

  const { filteredItems, isSearching, resultCount } = useSearchResults(
    items,
    searchQuery,
    activeFilter,
    searchCorpusVersion,
    display.friendsMode ?? "all_content",
    persons,
    accounts,
    friends,
  );
  const selectedItem = useMemo(
    () => (selectedItemId ? items.find((item) => item.globalId === selectedItemId) ?? null : null),
    [items, selectedItemId],
  );

  const scopeLabel = useMemo(() => getFilterLabel(activeFilter, feeds), [activeFilter, feeds]);
  const friendCount = useMemo(() => Object.keys(friends).length, [friends]);
  const mappedFriendCount = useMemo(
    () => countFriendsWithRecentLocationUpdates(items, friends),
    [friends, items],
  );
  const mappedAllContentCount = useMemo(
    () => countAuthorsWithRecentLocationUpdates(items),
    [items],
  );
  const socialAccountCount = useMemo(
    () => Object.values(accounts).filter((account) => account.kind === "social").length,
    [accounts],
  );
  const savedArchivedCount = useMemo(
    () => items.filter((item) => item.userState.saved && item.userState.archived).length,
    [items],
  );
  const effectiveMapMode = resolveMapMode(
    display.mapMode,
    mappedFriendCount,
    mappedAllContentCount,
  );
  const effectiveFriendsMode = display.friendsMode ?? "all_content";
  const [isBelowLargeToolbar, setIsBelowLargeToolbar] = useState(
    () => typeof window !== "undefined" && window.innerWidth < TOOLBAR_COLLAPSE_BREAKPOINT_PX,
  );
  const [isBelowReaderBookmarkToolbar, setIsBelowReaderBookmarkToolbar] = useState(
    () => typeof window !== "undefined" && window.innerWidth < READER_BOOKMARK_INLINE_MIN_WIDTH_PX,
  );
  const showWorkspaceIdentityControls = activeView === "friends" || activeView === "map";
  const showMapTimeControls = activeView === "map";
  const showFeedBulkActions = activeView === "feed";
  const showFeedSignalFilter = activeView === "feed" && !selectedItem;
  const showArchivedToolbar = activeView === "feed" && activeFilter.archivedOnly === true;
  const showArchivedDeleteAction = showArchivedToolbar && (display.archivePruneDays ?? 30) > 0;
  const showSocialContentControls =
    activeView === "feed" &&
    !selectedItem &&
    !activeFilter.feedUrl &&
    !activeFilter.savedOnly &&
    !activeFilter.archivedOnly &&
    (!activeFilter.platform ||
      activeFilter.platform === "facebook" ||
      activeFilter.platform === "instagram");
  const socialContentFilter: SocialContentFilter = activeFilter.socialContentFilter ?? "all";
  const collapseToolbarViewControls =
    !selectedItem &&
    (isMobile || isBelowLargeToolbar);
  const showInlineWorkspaceIdentityControls =
    showWorkspaceIdentityControls && !collapseToolbarViewControls;
  const showInlineMapTimeControls =
    showMapTimeControls && !collapseToolbarViewControls;
  const showInlineSocialContentControls =
    showSocialContentControls && !collapseToolbarViewControls;
  const showCollapsedToolbarFilterMenu =
    !selectedItem &&
    (
      (collapseToolbarViewControls && (
        showWorkspaceIdentityControls ||
        showMapTimeControls ||
        showSocialContentControls
      )) ||
      ((isMobile || collapseToolbarViewControls) && showFeedSignalFilter)
    );
  const showInlineFeedSignalFilter =
    showFeedSignalFilter && !showCollapsedToolbarFilterMenu;
  const showInlineReaderBookmark =
    !!selectedItem && !isBelowReaderBookmarkToolbar;

  const unreadCount =
    activeFilter.savedOnly || activeFilter.archivedOnly
      ? 0
      : activeFilter.platform
        ? (unreadCountByPlatform[activeFilter.platform] ?? 0)
        : totalUnreadCount;

  const archivableCount =
    activeFilter.savedOnly || activeFilter.archivedOnly
      ? 0
      : activeFilter.feedUrl
        ? (archivableFeedCounts[activeFilter.feedUrl] ?? 0)
        : activeFilter.platform
          ? (archivableCountByPlatform[activeFilter.platform] ?? 0)
          : totalArchivableCount;

  const handleSocialContentFilterChange = useCallback(
    (value: SocialContentFilter) => {
      const nextFilter = { ...activeFilter };
      if (value === "all") {
        delete nextFilter.socialContentFilter;
      } else {
        nextFilter.socialContentFilter = value;
      }
      setFilter(nextFilter);
    },
    [activeFilter, setFilter],
  );

  const currentListTitle = useMemo(() => {
    if (activeView === "friends") return "Friends";
    if (activeView === "map") return "Map";
    return scopeLabel;
  }, [activeView, scopeLabel]);

  const currentTitle = useMemo(() => {
    if (selectedItem) {
      return selectedItem.content.linkPreview?.title
        ?? selectedItem.content.text?.slice(0, 90)
        ?? selectedItem.author.displayName;
    }
    return currentListTitle;
  }, [currentListTitle, selectedItem]);

  const currentSubtitle = useMemo(() => {
    if (selectedItem) {
      const source = selectedItem.platform
        ? selectedItem.platform.toLocaleUpperCase()
        : scopeLabel;
      return `${selectedItem.author.displayName} • ${source}`;
    }
    if (activeView === "friends") {
      if (pendingMatchCount > 0) {
        if (effectiveFriendsMode === "all_content") {
          return `${friendCount.toLocaleString()} friends • ${socialAccountCount.toLocaleString()} accounts • ${pendingMatchCount.toLocaleString()} pending suggestions`;
        }
        return `${friendCount.toLocaleString()} friends • ${pendingMatchCount.toLocaleString()} pending suggestions`;
      }
      if (effectiveFriendsMode === "all_content") {
        return `${friendCount.toLocaleString()} friends • ${socialAccountCount.toLocaleString()} accounts`;
      }
      return `${friendCount.toLocaleString()} friends`;
    }
    if (activeView === "map") {
      if (effectiveMapMode === "all_content") {
        return `${mappedAllContentCount.toLocaleString()} accounts on the map`;
      }
      return `${mappedFriendCount.toLocaleString()} friends on the map`;
    }
    if (isSearching) {
      return `${resultCount.toLocaleString()} result${resultCount === 1 ? "" : "s"} in ${scopeLabel}`;
    }
    return formatItemCount(filteredItems.length);
  }, [
    activeView,
    effectiveFriendsMode,
    filteredItems.length,
    friendCount,
    effectiveMapMode,
    isSearching,
    mappedAllContentCount,
    mappedFriendCount,
    pendingMatchCount,
    resultCount,
    socialAccountCount,
    scopeLabel,
    selectedItem,
  ]);

  const [signalFilterMenuOpen, setSignalFilterMenuOpen] = useState(false);
  const signalFilterMenuRef = useRef<HTMLDivElement>(null);
  const signalFilterButtonRef = useRef<HTMLButtonElement>(null);
  const [signalFilterMenuPosition, setSignalFilterMenuPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const [signalFilterFeedback, setSignalFilterFeedback] = useState<{
    mode: FeedSignalMode;
    tick: number;
  } | null>(null);
  const [toolbarOverflowMenuOpen, setToolbarOverflowMenuOpen] = useState(false);
  const toolbarOverflowMenuRef = useRef<HTMLDivElement>(null);
  const toolbarOverflowButtonRef = useRef<HTMLButtonElement>(null);
  const [toolbarOverflowMenuPosition, setToolbarOverflowMenuPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const updateDisplayPreference = useCallback((patch: Partial<DisplayPreferences>) => {
    void updatePreferences({
      display: patch,
    } as Parameters<typeof updatePreferences>[0]);
  }, [updatePreferences]);

  const activeFeedSignalModes = useMemo(
    () => resolveFeedSignalModesFromDisplay(display),
    [display],
  );
  const activeFeedSignalModeSet = useMemo(
    () => new Set(activeFeedSignalModes),
    [activeFeedSignalModes],
  );
  const selectableFeedSignalPresets = useMemo(
    () => FEED_SIGNAL_FILTER_PRESETS.filter((preset) => preset.mode !== "all"),
    [],
  );
  const selectableFeedSignalModes = useMemo(
    () => selectableFeedSignalPresets.map((preset) => preset.mode),
    [selectableFeedSignalPresets],
  );
  const everythingSignalPreset = FEED_SIGNAL_FILTER_PRESETS[0];
  const allFeedSignalsSelected =
    activeFeedSignalModes.length === 0 ||
    activeFeedSignalModes.length === selectableFeedSignalModes.length;
  const feedSignalFilterLabel = activeFeedSignalModes.length === 0
    ? "Everything"
    : activeFeedSignalModes.length === 1
      ? FEED_SIGNAL_FILTER_PRESETS.find((preset) => preset.mode === activeFeedSignalModes[0])?.label ?? "Custom"
      : `${activeFeedSignalModes.length.toLocaleString()} filters`;
  const feedSignalCountBaseFilter = useMemo(() => {
    const nextFilter = { ...activeFilter };
    delete nextFilter.signals;
    return nextFilter;
  }, [activeFilter]);
  const feedSignalCounts = useMemo(() => {
    const counts: Record<FeedSignalMode, number> = {
      all: filterFeedItems(items, feedSignalCountBaseFilter).length,
      inspiring: 0,
      events: 0,
      personal: 0,
      conversation: 0,
      news: 0,
    };
    for (const preset of selectableFeedSignalPresets) {
      counts[preset.mode] = filterFeedItems(items, {
        ...feedSignalCountBaseFilter,
        signals: [...preset.signals],
      }).length;
    }
    return counts;
  }, [feedSignalCountBaseFilter, items, selectableFeedSignalPresets]);

  const handleFeedSignalModeChange = useCallback((mode: FeedSignalMode) => {
    setSignalFilterFeedback({ mode, tick: Date.now() });
    const nextModes = (() => {
      if (mode === "all") return [];
      const currentModes = allFeedSignalsSelected
        ? selectableFeedSignalModes
        : activeFeedSignalModes;
      const next = currentModes.includes(mode)
        ? currentModes.filter((candidate) => candidate !== mode)
        : [...currentModes, mode];
      return next.length === selectableFeedSignalModes.length ? [] : next;
    })();
    setFilter(applyFeedSignalModesToFilter(activeFilter, nextModes));
    updateDisplayPreference({
      feedSignalMode: nextModes.length === 1 ? nextModes[0] : "all",
      feedSignalModes: nextModes,
    });
  }, [
    activeFeedSignalModes,
    activeFilter,
    allFeedSignalsSelected,
    selectableFeedSignalModes,
    setFilter,
    updateDisplayPreference,
  ]);

  const updateSignalFilterMenuPosition = useCallback(() => {
    const button = signalFilterButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setSignalFilterMenuPosition({
      top: Math.round(rect.bottom + 8),
      right: Math.max(8, Math.round(window.innerWidth - rect.right)),
    });
  }, []);

  const toggleSignalFilterMenu = useCallback(() => {
    updateSignalFilterMenuPosition();
    setToolbarOverflowMenuOpen(false);
    setSignalFilterMenuOpen((value) => !value);
  }, [updateSignalFilterMenuPosition]);

  const updateToolbarOverflowMenuPosition = useCallback(() => {
    const button = toolbarOverflowButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setToolbarOverflowMenuPosition({
      top: Math.round(rect.bottom + 8),
      right: Math.max(8, Math.round(window.innerWidth - rect.right)),
    });
  }, []);

  const toggleToolbarOverflowMenu = useCallback(() => {
    updateToolbarOverflowMenuPosition();
    setSignalFilterMenuOpen(false);
    setToolbarOverflowMenuOpen((value) => !value);
  }, [updateToolbarOverflowMenuPosition]);

  const handleIdentityModeChange = useCallback((key: "friendsMode" | "mapMode", mode: MapMode) => {
    updateDisplayPreference({ [key]: mode });
  }, [updateDisplayPreference]);

  const handleFriendsToolbarModeChange = useCallback((mode: FriendsToolbarMode) => {
    if (mode === "details") {
      onFriendsMobileSurfaceChange("details");
      return;
    }
    handleIdentityModeChange("friendsMode", mode);
    onFriendsMobileSurfaceChange("graph");
  }, [handleIdentityModeChange, onFriendsMobileSurfaceChange]);

  const handleMapTimeModeChange = useCallback((mode: MapTimeMode) => {
    updateDisplayPreference({ mapTimeMode: mode });
  }, [updateDisplayPreference]);

  const handleCloseReader = useCallback(() => {
    if (display.reading.dualColumnMode && !isMobile && selectedItemId) {
      runFeedLayoutTransition(() => {
        setSelectedItem(null);
      });
      return;
    }
    setSelectedItem(null);
  }, [display.reading.dualColumnMode, isMobile, selectedItemId, setSelectedItem]);

  const handleToggleReaderSaved = useCallback(() => {
    if (!selectedItem) return;
    toggleSaved(selectedItem.globalId);
  }, [selectedItem, toggleSaved]);

  const handleToggleReaderArchived = useCallback(() => {
    if (!selectedItem) return;
    const wasArchived = selectedItem.userState.archived;
    toggleArchived(selectedItem.globalId);
    if (!wasArchived) {
      setSelectedItem(null);
    }
  }, [selectedItem, setSelectedItem, toggleArchived]);

  const handleToggleFocusMode = useCallback(() => {
    void updatePreferences({
      display: {
        ...display,
        reading: {
          ...display.reading,
          focusMode: !display.reading.focusMode,
        },
      },
    });
  }, [display, updatePreferences]);

  const handleToggleDualColumn = useCallback(() => {
    runFeedLayoutTransition(() => {
      void updatePreferences({
        display: {
          ...display,
          reading: {
            ...display.reading,
            dualColumnMode: !display.reading.dualColumnMode,
          },
        },
      });
    });
  }, [display, updatePreferences]);

  const [deleteConfirmArmed, setDeleteConfirmArmed] = useState(false);
  const deleteConfirmTimerRef = useRef<number | null>(null);

  const handleOpenReaderUrl = useCallback(() => {
    if (!selectedItem?.sourceUrl) return;
    if (openUrl) {
      openUrl(selectedItem.sourceUrl);
      return;
    }
    window.open(selectedItem.sourceUrl, "_blank", "noopener,noreferrer");
  }, [openUrl, selectedItem]);

  const handleDeleteArchivedClick = useCallback(() => {
    if (!deleteConfirmArmed) {
      setDeleteConfirmArmed(true);
      if (deleteConfirmTimerRef.current) {
        window.clearTimeout(deleteConfirmTimerRef.current);
      }
      deleteConfirmTimerRef.current = window.setTimeout(() => {
        setDeleteConfirmArmed(false);
        deleteConfirmTimerRef.current = null;
      }, 3000);
      return;
    }
    if (deleteConfirmTimerRef.current) {
      window.clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }
    setDeleteConfirmArmed(false);
    void deleteAllArchived();
  }, [deleteAllArchived, deleteConfirmArmed]);

  const handleUnarchiveSavedClick = useCallback(() => {
    void unarchiveSavedItems();
  }, [unarchiveSavedItems]);

  const toolbarOverflowActions = useMemo<ToolbarOverflowAction[]>(() => {
    const actions: ToolbarOverflowAction[] = [];

    if (selectedItem && isBelowLargeToolbar) {
      actions.push({
        id: "focus",
        label: display.reading.focusMode ? "Disable focus mode" : "Enable focus mode",
        onClick: handleToggleFocusMode,
        active: display.reading.focusMode,
        icon: (
          <span className="inline-flex h-5 w-5 items-center justify-center text-sm font-black" aria-hidden="true">
            F
          </span>
        ),
      });

      if (!showInlineReaderBookmark) {
        actions.push({
          id: "bookmark-reader",
          label: selectedItem.userState.saved ? "Remove bookmark" : "Bookmark",
          onClick: handleToggleReaderSaved,
          active: selectedItem.userState.saved,
          icon: (
            <svg
              className="h-5 w-5"
              fill={selectedItem.userState.saved ? "currentColor" : "none"}
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          ),
        });
      }

      if (selectedItem.sourceUrl) {
        actions.push({
          id: "open",
          label: "Open",
          onClick: handleOpenReaderUrl,
          icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5h5m0 0v5m0-5L10 14M5 9v10h10" />
            </svg>
          ),
        });
      }

      actions.push({
        id: "archive-reader",
        label: selectedItem.userState.archived ? "Unarchive" : "Archive",
        onClick: handleToggleReaderArchived,
        active: selectedItem.userState.archived,
        icon: <ArchiveIcon className="h-5 w-5" />,
      });
    }

    if (!selectedItem && isBelowLargeToolbar) {
      if (showArchivedToolbar && savedArchivedCount > 0) {
        actions.push({
          id: "unarchive-saved",
          label: `Unarchive saved (${savedArchivedCount.toLocaleString()})`,
          onClick: handleUnarchiveSavedClick,
          icon: <ArchiveIcon className="h-5 w-5" />,
        });
      }

      if (showArchivedDeleteAction) {
        actions.push({
          id: "delete-archived",
          label: deleteConfirmArmed ? "Confirm delete?" : "Delete archived",
          onClick: handleDeleteArchivedClick,
          danger: deleteConfirmArmed,
          icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3" />
            </svg>
          ),
        });
      }

      if (showFeedBulkActions && unreadCount > 0) {
        actions.push({
          id: "mark-read",
          label: `Mark ${unreadCount.toLocaleString()} unread as read`,
          onClick: () => markAllAsRead(activeFilter.platform),
          icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
        });
      }

      if (showFeedBulkActions && archivableCount > 0) {
        actions.push({
          id: "archive-read",
          label: `Archive ${archivableCount.toLocaleString()} read items`,
          onClick: () => archiveAllReadUnsaved(activeFilter.platform, activeFilter.feedUrl),
          icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ),
        });
      }
    }

    return actions;
  }, [
    activeFilter.feedUrl,
    activeFilter.platform,
    archiveAllReadUnsaved,
    archivableCount,
    deleteConfirmArmed,
    display.reading.focusMode,
    handleDeleteArchivedClick,
    handleOpenReaderUrl,
    handleToggleFocusMode,
    handleToggleReaderSaved,
    handleToggleReaderArchived,
    handleUnarchiveSavedClick,
    isBelowLargeToolbar,
    markAllAsRead,
    savedArchivedCount,
    selectedItem,
    showInlineReaderBookmark,
    showArchivedDeleteAction,
    showArchivedToolbar,
    showFeedBulkActions,
    unreadCount,
  ]);
  const showToolbarOverflowMenuButton = toolbarOverflowActions.length > 0;

  const showReaderLayoutToggle =
    !isMobile &&
    !!selectedItem;
  const showDesktopReaderLayoutToggle =
    showReaderLayoutToggle && visibleDesktopSidebarMode !== "closed";
  const [layoutControlMetrics, setLayoutControlMetrics] = useState({
    sidebarToggleLeftPx: DEFAULT_LAYOUT_CONTROL_SAFE_LEFT_PX,
    previewToggleLeftPx: DEFAULT_LAYOUT_CONTROL_SAFE_LEFT_PX + READER_LAYOUT_CONTROL_BUTTON_SIZE_PX,
    reservedWidthPx: DEFAULT_LAYOUT_CONTROL_RESERVED_WIDTH_PX,
  });
  const activeSearchQuery = searchQuery.trim();
  const showToolbarSearch = !selectedItem && activeSearchQuery.length > 0;
  const showFriendsSidebarToggle = activeView === "friends" && !isMobile;
  const friendsToolbarValue: FriendsToolbarMode =
    isMobile && activeView === "friends" && friendsMobileSurface === "details"
      ? "details"
      : effectiveFriendsMode;
  const canManuallyDragToolbarControls = !!(headerDragRegion && startWindowDrag);
  const macosTrafficLightInsetStyle = headerDragRegion
    ? ({ paddingLeft: `${MACOS_TRAFFIC_LIGHT_INSET}px` } as CSSProperties)
    : undefined;
  const sidebarHandleCenterline = "var(--freed-sidebar-toolbar-centerline, var(--freed-sidebar-handle-centerline, 264px))";
  const toolbarBoundaryWidth = `calc(${sidebarHandleCenterline} + ${px(PRIMARY_SIDEBAR_GAP_WIDTH_PX / 2)})`;
  const leftToolbarWidth = !isMobileDevice
    ? px(layoutControlMetrics.reservedWidthPx)
    : toolbarBoundaryWidth;
  const leftToolbarStyle = !isMobileDevice
    ? ({
        position: "relative",
        width: leftToolbarWidth,
        minWidth: leftToolbarWidth,
        ...(headerDragRegion ? noDrag : {}),
      } as CSSProperties)
    : headerDragRegion
      ? {
          ...macosTrafficLightInsetStyle,
          ...noDrag,
        }
      : macosTrafficLightInsetStyle;
  const toolbarLogoRowStyle = {
    paddingLeft: headerDragRegion ? `${MACOS_TRAFFIC_LIGHT_INSET}px` : undefined,
    paddingRight: px(TOOLBAR_SIDEBAR_SLOT_PADDING_RIGHT_PX),
  } as CSSProperties;
  const layoutControlClusterStyle = {
    left: 0,
    width: px(layoutControlMetrics.reservedWidthPx),
    ...(headerDragRegion ? noDrag : {}),
  } as CSSProperties;
  const sidebarTogglePositionStyle = {
    left: px(layoutControlMetrics.sidebarToggleLeftPx),
    ...(headerDragRegion ? noDrag : {}),
  } as CSSProperties;
  const previewTogglePositionStyle = {
    left: px(layoutControlMetrics.previewToggleLeftPx),
    ...(headerDragRegion ? noDrag : {}),
  } as CSSProperties;
  const toolbarContainerStyle = {
    ...(headerDragRegion ? dragStyle : {}),
    height: px(TOP_TOOLBAR_HEIGHT_PX),
    minHeight: px(TOP_TOOLBAR_HEIGHT_PX),
    width: "100%",
    maxWidth: "100%",
  } as CSSProperties;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toolbarSearchInputRef = useRef<HTMLInputElement | null>(null);
  const layoutControlHostRef = useRef<HTMLDivElement | null>(null);
  const wordmarkRef = useRef<HTMLSpanElement | null>(null);
  const sidebarHandleCenterlineStyleRef = useRef<string | null>(null);
  const toolbarDragGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    target: HTMLElement;
  } | null>(null);
  const suppressedToolbarClickRef = useRef<EventTarget | null>(null);
  const suppressedToolbarClickTimeoutRef = useRef<number | null>(null);

  const clearSuppressedToolbarClick = useCallback(() => {
    suppressedToolbarClickRef.current = null;
    if (suppressedToolbarClickTimeoutRef.current !== null) {
      window.clearTimeout(suppressedToolbarClickTimeoutRef.current);
      suppressedToolbarClickTimeoutRef.current = null;
    }
  }, []);

  const scheduleSuppressedToolbarClickClear = useCallback(() => {
    if (suppressedToolbarClickTimeoutRef.current !== null) {
      window.clearTimeout(suppressedToolbarClickTimeoutRef.current);
    }
    suppressedToolbarClickTimeoutRef.current = window.setTimeout(() => {
      suppressedToolbarClickRef.current = null;
      suppressedToolbarClickTimeoutRef.current = null;
    }, 250);
  }, []);

  const finishToolbarDragGesture = useCallback((pointerId?: number) => {
    const gesture = toolbarDragGestureRef.current;
    if (!gesture) return;
    if (pointerId !== undefined && gesture.pointerId !== pointerId) return;
    toolbarDragGestureRef.current = null;
  }, []);

  const handleToolbarControlPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!canManuallyDragToolbarControls) return;
    if (event.button !== 0 || !event.isPrimary || event.pointerType === "touch") return;

    clearSuppressedToolbarClick();
    toolbarDragGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target: event.currentTarget,
    };
  }, [canManuallyDragToolbarControls, clearSuppressedToolbarClick]);

  const handleWindowToolbarPointerMove = useCallback((event: PointerEvent) => {
    const gesture = toolbarDragGestureRef.current;
    if (!gesture || !startWindowDrag) return;
    if (gesture.pointerId !== event.pointerId) return;

    const travelDistance = Math.hypot(
      event.clientX - gesture.startX,
      event.clientY - gesture.startY,
    );

    if (travelDistance <= TOOLBAR_DRAG_THRESHOLD_PX) return;

    suppressedToolbarClickRef.current = gesture.target;
    scheduleSuppressedToolbarClickClear();
    finishToolbarDragGesture(gesture.pointerId);
    void startWindowDrag().catch(() => {
      clearSuppressedToolbarClick();
    });
  }, [
    clearSuppressedToolbarClick,
    finishToolbarDragGesture,
    scheduleSuppressedToolbarClickClear,
    startWindowDrag,
  ]);

  const handleWindowToolbarPointerEnd = useCallback((event: PointerEvent) => {
    finishToolbarDragGesture(event.pointerId);
  }, [finishToolbarDragGesture]);

  const handleToolbarControlClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (suppressedToolbarClickRef.current !== event.currentTarget) return;
    clearSuppressedToolbarClick();
    event.preventDefault();
    event.stopPropagation();
  }, [clearSuppressedToolbarClick]);

  const getToolbarControlProps = useCallback((style?: CSSProperties) => ({
    ...(canManuallyDragToolbarControls
      ? {
          onPointerDown: handleToolbarControlPointerDown,
          onClickCapture: handleToolbarControlClickCapture,
        }
      : {}),
    style: headerDragRegion
      ? ({ ...style, ...toolbarControlStyle } as CSSProperties)
      : style,
  }), [
    canManuallyDragToolbarControls,
    handleToolbarControlClickCapture,
    handleToolbarControlPointerDown,
    headerDragRegion,
  ]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [dropdownOpen]);

  useEffect(() => {
    const updateToolbarBreakpoints = () => {
      setIsBelowLargeToolbar(window.innerWidth < TOOLBAR_COLLAPSE_BREAKPOINT_PX);
      setIsBelowReaderBookmarkToolbar(window.innerWidth < READER_BOOKMARK_INLINE_MIN_WIDTH_PX);
    };

    updateToolbarBreakpoints();
    window.addEventListener("resize", updateToolbarBreakpoints);
    return () => window.removeEventListener("resize", updateToolbarBreakpoints);
  }, []);

  useEffect(() => {
    if (!signalFilterMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        signalFilterMenuRef.current &&
        !signalFilterMenuRef.current.contains(e.target as Node)
        && signalFilterButtonRef.current &&
        !signalFilterButtonRef.current.contains(e.target as Node)
      ) {
        setSignalFilterMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSignalFilterMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", updateSignalFilterMenuPosition);
    window.addEventListener("scroll", updateSignalFilterMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", updateSignalFilterMenuPosition);
      window.removeEventListener("scroll", updateSignalFilterMenuPosition, true);
    };
  }, [signalFilterMenuOpen, updateSignalFilterMenuPosition]);

  useEffect(() => {
    if (!toolbarOverflowMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        toolbarOverflowMenuRef.current &&
        !toolbarOverflowMenuRef.current.contains(e.target as Node)
        && toolbarOverflowButtonRef.current &&
        !toolbarOverflowButtonRef.current.contains(e.target as Node)
      ) {
        setToolbarOverflowMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setToolbarOverflowMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", updateToolbarOverflowMenuPosition);
    window.addEventListener("scroll", updateToolbarOverflowMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", updateToolbarOverflowMenuPosition);
      window.removeEventListener("scroll", updateToolbarOverflowMenuPosition, true);
    };
  }, [toolbarOverflowMenuOpen, updateToolbarOverflowMenuPosition]);

  useEffect(() => {
    if (toolbarOverflowActions.length > 0) return;
    setToolbarOverflowMenuOpen(false);
  }, [toolbarOverflowActions.length]);

  useEffect(() => {
    if (!showToolbarSearch) return;
    toolbarSearchInputRef.current?.focus();
    toolbarSearchInputRef.current?.setSelectionRange(searchQuery.length, searchQuery.length);
  }, [showToolbarSearch]);

  useLayoutEffect(() => {
    if (isMobileDevice) return undefined;

    let active = true;
    const updateLayoutControlMetrics = () => {
      const host = layoutControlHostRef.current;
      const wordmark = wordmarkRef.current;
      if (!host || !wordmark) return;

      const hostRect = host.getBoundingClientRect();
      const wordmarkRect = wordmark.getBoundingClientRect();
      const safeLeftPx = Math.ceil(
        wordmarkRect.right - hostRect.left + LAYOUT_CONTROL_SAFE_GAP_PX,
      );
      const rootStyles = window.getComputedStyle(document.documentElement);
      sidebarHandleCenterlineStyleRef.current = rootStyles.getPropertyValue(
        "--freed-sidebar-toolbar-centerline",
      ) || rootStyles.getPropertyValue(
        "--freed-sidebar-handle-centerline",
      );
      const fallbackHandleCenterPx = parsePixelValue(
        sidebarHandleCenterlineStyleRef.current,
        264,
      );
      const sidebarRightEdgePx = fallbackHandleCenterPx;
      const idealSidebarToggleLeftPx = visibleDesktopSidebarMode === "closed"
        ? CLOSED_SIDEBAR_TOGGLE_LEFT_PX
        : sidebarRightEdgePx - READER_LAYOUT_CONTROL_BUTTON_SIZE_PX;
      const sidebarToggleLeftPx = Math.ceil(Math.max(idealSidebarToggleLeftPx, safeLeftPx));
      const previewToggleLeftPx = Math.ceil(
        sidebarToggleLeftPx + READER_LAYOUT_CONTROL_BUTTON_SIZE_PX + READER_LAYOUT_CONTROL_BUTTON_GAP_PX,
      );
      const toolbarBoundaryWidthPx = previewToggleLeftPx + READER_LAYOUT_CONTROL_BUTTON_SIZE_PX;
      const reservedWidthPx = Math.ceil(
        Math.max(
          toolbarBoundaryWidthPx + TOOLBAR_SIDEBAR_SLOT_PADDING_RIGHT_PX,
          toolbarBoundaryWidthPx,
        ),
      );

      setLayoutControlMetrics((current) => {
        if (
          Math.abs(current.sidebarToggleLeftPx - sidebarToggleLeftPx) < 1 &&
          Math.abs(current.previewToggleLeftPx - previewToggleLeftPx) < 1 &&
          Math.abs(current.reservedWidthPx - reservedWidthPx) < 1
        ) {
          return current;
        }

        return { sidebarToggleLeftPx, previewToggleLeftPx, reservedWidthPx };
      });
    };

    updateLayoutControlMetrics();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateLayoutControlMetrics);
    if (layoutControlHostRef.current) {
      resizeObserver?.observe(layoutControlHostRef.current);
    }
    if (wordmarkRef.current) {
      resizeObserver?.observe(wordmarkRef.current);
    }

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            const nextHandleCenterlineStyle = window
              .getComputedStyle(document.documentElement)
              .getPropertyValue("--freed-sidebar-toolbar-centerline") || window
              .getComputedStyle(document.documentElement)
              .getPropertyValue("--freed-sidebar-handle-centerline");
            if (nextHandleCenterlineStyle === sidebarHandleCenterlineStyleRef.current) {
              return;
            }
            updateLayoutControlMetrics();
          });
    mutationObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });

    void document.fonts?.ready.then(() => {
      if (active) updateLayoutControlMetrics();
    });
    window.addEventListener("resize", updateLayoutControlMetrics);
    window.addEventListener("mousemove", updateLayoutControlMetrics);
    window.addEventListener("pointermove", updateLayoutControlMetrics);

    return () => {
      active = false;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", updateLayoutControlMetrics);
      window.removeEventListener("mousemove", updateLayoutControlMetrics);
      window.removeEventListener("pointermove", updateLayoutControlMetrics);
    };
  }, [
    isMobileDevice,
    visibleDesktopSidebarMode,
  ]);

  useEffect(() => {
    if (addFeedOpen || savedContentOpen) {
      setDropdownOpen(false);
    }
  }, [addFeedOpen, savedContentOpen]);

  useEffect(() => {
    if (activeFilter.archivedOnly) {
      return;
    }
    if (deleteConfirmTimerRef.current) {
      window.clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }
    setDeleteConfirmArmed(false);
  }, [activeFilter.archivedOnly]);

  useEffect(() => () => {
    finishToolbarDragGesture();
    clearSuppressedToolbarClick();
    if (deleteConfirmTimerRef.current) {
      window.clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }
  }, [clearSuppressedToolbarClick, finishToolbarDragGesture]);

  useEffect(() => {
    if (!canManuallyDragToolbarControls) return;

    window.addEventListener("pointermove", handleWindowToolbarPointerMove);
    window.addEventListener("pointerup", handleWindowToolbarPointerEnd);
    window.addEventListener("pointercancel", handleWindowToolbarPointerEnd);

    return () => {
      window.removeEventListener("pointermove", handleWindowToolbarPointerMove);
      window.removeEventListener("pointerup", handleWindowToolbarPointerEnd);
      window.removeEventListener("pointercancel", handleWindowToolbarPointerEnd);
    };
  }, [
    canManuallyDragToolbarControls,
    handleWindowToolbarPointerEnd,
    handleWindowToolbarPointerMove,
  ]);

  return (
    <>
      <header
        className={`sticky top-0 z-30 min-w-0 w-full max-w-full flex-shrink-0 overflow-hidden ${
          headerDragRegion ? "" : "theme-attached-topbar-host pt-[env(safe-area-inset-top)]"
        }`}
      >
    <div
      data-testid="workspace-toolbar"
          className="theme-floating-panel theme-attached-topbar relative flex w-full min-w-0 max-w-full items-center px-0 gap-2"
          {...(headerDragRegion
            ? {
                "data-tauri-drag-region": true,
              }
            : {})}
          style={toolbarContainerStyle}
        >
          <div
            className="theme-toolbar-cluster theme-toolbar-cluster-tight flex shrink-0 items-center"
          >
            <div
              ref={layoutControlHostRef}
              className="relative flex h-full shrink-0 items-center"
              style={leftToolbarStyle}
            >
              {isMobileDevice ? (
              <Tooltip label="Menu">
                <button
                  onClick={onMobileMenuToggle}
                  {...getToolbarControlProps()}
                  className={`${TOOLBAR_ICON_BUTTON_CLASS} theme-toolbar-button-ghost`}
                  aria-label={mobileSidebarOpen ? "Close menu" : "Open menu"}
                  aria-pressed={mobileSidebarOpen}
                >
                  <AnimatedMenuIcon open={mobileSidebarOpen} className="h-5 w-5" />
                </button>
              </Tooltip>
              ) : null}

              <div className="flex h-full items-center pl-3 sm:pl-4" style={toolbarLogoRowStyle}>
                <span
                  ref={wordmarkRef}
                  data-testid="workspace-toolbar-wordmark"
                  className="cursor-default select-none text-lg font-bold gradient-text font-logo"
                >
                  FREED
                </span>
              </div>

              {!isMobileDevice ? (
                <div
                  data-testid="desktop-layout-control-cluster"
                  className="absolute inset-y-0"
                  style={layoutControlClusterStyle}
                >
                  <span
                    className="absolute top-1/2 inline-flex -translate-y-1/2"
                    style={sidebarTogglePositionStyle}
                  >
                    <Tooltip
                      label={desktopSidebarToggleLabel}
                    >
                      <button
                        onClick={onDesktopSidebarToggle}
                        {...getToolbarControlProps()}
                        data-testid="desktop-sidebar-toggle"
                        className={TOOLBAR_READER_LAYOUT_TOGGLE_BUTTON_CLASS}
                        aria-label={desktopSidebarToggleLabel}
                      >
                        {visibleDesktopSidebarMode === "closed" ? (
                          <SidebarExpandIcon className="h-5 w-5" />
                        ) : (
                          <SidebarCollapseIcon className="h-5 w-5" />
                        )}
                      </button>
                    </Tooltip>
                  </span>

                  {showDesktopReaderLayoutToggle ? (
                    <span
                      className="absolute top-1/2 inline-flex -translate-y-1/2"
                      style={previewTogglePositionStyle}
                    >
                      <Tooltip label={display.reading.dualColumnMode ? "Hide Previews" : "Show Previews"}>
                        <button
                          onClick={handleToggleDualColumn}
                          {...getToolbarControlProps()}
                          className={TOOLBAR_READER_LAYOUT_TOGGLE_BUTTON_CLASS}
                          aria-pressed={display.reading.dualColumnMode}
                          aria-label={display.reading.dualColumnMode ? "Hide Previews" : "Show Previews"}
                        >
                          {display.reading.dualColumnMode ? (
                            <ReaderRailHideIcon className="h-5 w-5" />
                          ) : (
                            <ReaderRailShowIcon className="h-5 w-5" />
                          )}
                        </button>
                      </Tooltip>
                    </span>
                  ) : null}

                </div>
              ) : null}
            </div>
          </div>

          <div
            className={`min-w-0 basis-0 flex-1 overflow-hidden ${selectedItem && isBelowLargeToolbar ? "pr-14" : ""}`}
            {...(headerDragRegion ? { "data-tauri-drag-region": true, style: dragStyle } : {})}
          >
            {selectedItem ? (
              <button
                onClick={handleCloseReader}
                {...getToolbarControlProps()}
                data-testid="workspace-toolbar-reader-back"
                className="group flex w-full min-w-0 items-center gap-1 rounded-lg px-1 py-1 text-left transition-colors hover:bg-[var(--theme-bg-muted)]"
                aria-label="Back to list"
              >
                <span className="pointer-events-none flex shrink-0 items-center rounded-lg p-1.5">
                  <svg
                    className="h-4 w-4 shrink-0 text-[var(--theme-text-muted)] transition-colors group-hover:text-[var(--theme-text-secondary)]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </span>
                <div
                  data-testid="workspace-toolbar-reader-title-block"
                  className="pointer-events-none min-w-0 flex-1 cursor-default select-none"
                >
                  <p className="truncate text-sm font-medium text-[var(--theme-text-secondary)]">
                    {currentListTitle}
                  </p>
                </div>
              </button>
            ) : showToolbarSearch ? (
              <div className="px-1" style={headerDragRegion ? noDrag : undefined}>
                <SearchField
                  ref={toolbarSearchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  onClear={() => setSearchQuery("")}
                  placeholder="Search"
                  aria-label="Search all sources"
                  containerClassName="w-full"
                  inputClassName="h-10 rounded-xl bg-[var(--theme-bg-input)] text-sm"
                />
              </div>
            ) : (
              <div
                data-testid="workspace-toolbar-title-block"
                className="min-w-0 cursor-default select-none px-1"
              >
                <p className="truncate text-sm font-semibold text-[var(--theme-text-secondary)]">
                  {currentTitle}
                  <span className="mx-1.5 font-normal text-[var(--theme-text-muted)]">•</span>
                  <span className="font-normal text-[var(--theme-text-muted)]">{currentSubtitle}</span>
                </p>
              </div>
            )}
          </div>

          <div
            className={selectedItem
              ? isBelowLargeToolbar
                ? `theme-toolbar-cluster theme-toolbar-cluster-tight absolute right-0 top-1/2 z-10 flex shrink-0 -translate-y-1/2 items-center justify-end pr-2 ${showInlineReaderBookmark ? "w-[6.5rem]" : "w-14"}`
                : "theme-toolbar-cluster theme-toolbar-cluster-tight ml-auto flex min-w-max shrink-0 items-center pr-2"
              : "theme-toolbar-cluster theme-toolbar-cluster-tight flex min-w-max shrink-0 items-center pr-2 sm:pr-2.5"}
          >
            {selectedItem ? (
              <>
                <ToolbarAnimatedSlot visible={!isMobile && !isBelowLargeToolbar} width="4.5rem" className="hidden lg:flex">
                  {!isBelowLargeToolbar ? (
                  <Tooltip label={display.reading.focusMode ? "Disable focus mode" : "Enable focus mode"}>
                    <button
                      onClick={handleToggleFocusMode}
                      {...getToolbarControlProps()}
                      style={{
                        ...(headerDragRegion ? toolbarControlStyle : undefined),
                        width: "4.5rem",
                      }}
                      className={`w-full justify-center rounded-lg px-2.5 py-2 text-sm font-bold lg:inline-flex ${
                        display.reading.focusMode
                          ? "theme-toolbar-button-active"
                          : "theme-toolbar-button-neutral"
                      }`}
                      aria-pressed={display.reading.focusMode}
                      aria-label="Toggle focus reading mode"
                    >
                      <span aria-hidden="true">
                        <span className="font-black">F</span>
                        <span className="text-xs font-light">ocus</span>
                      </span>
                    </button>
                  </Tooltip>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={showInlineReaderBookmark} width="2.5rem">
                  {showInlineReaderBookmark ? (
                    <Tooltip label={selectedItem.userState.saved ? "Remove bookmark" : "Bookmark"}>
                      <button
                        onClick={handleToggleReaderSaved}
                        {...getToolbarControlProps()}
                        className={`${TOOLBAR_ICON_BUTTON_CLASS} ${
                          selectedItem.userState.saved
                            ? "theme-toolbar-button-active"
                            : "theme-toolbar-button-neutral"
                        }`}
                        aria-label={selectedItem.userState.saved ? "Unsave" : "Save"}
                      >
                        <svg
                          className="h-5 w-5"
                          fill={selectedItem.userState.saved ? "currentColor" : "none"}
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                        </svg>
                      </button>
                    </Tooltip>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot
                  visible={showToolbarOverflowMenuButton}
                  width="2.5rem"
                  flushStartMargin={isBelowLargeToolbar && !showInlineReaderBookmark}
                  style={{ order: 98 }}
                >
                  {showToolbarOverflowMenuButton ? (
                    <Tooltip label="More actions">
                      <button
                        ref={toolbarOverflowButtonRef}
                        type="button"
                        onClick={toggleToolbarOverflowMenu}
                        {...getToolbarControlProps()}
                        data-testid="toolbar-overflow-button"
                        className={`${TOOLBAR_ICON_BUTTON_CLASS} ${
                          isMobileDevice ? "theme-toolbar-button-ghost" : "theme-toolbar-button-neutral"
                        }`}
                        aria-haspopup="menu"
                        aria-expanded={toolbarOverflowMenuOpen}
                        aria-label="More actions"
                      >
                        <ToolbarOverflowIcon />
                      </button>
                    </Tooltip>
                  ) : null}
                </ToolbarAnimatedSlot>

                {selectedItem.sourceUrl && !isBelowLargeToolbar ? (
                  <ToolbarAnimatedSlot visible={true} width="4.5rem" className="hidden lg:flex">
                    <button
                      onClick={handleOpenReaderUrl}
                      {...getToolbarControlProps()}
                      className="theme-toolbar-button-neutral inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm"
                      aria-label="Open"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5h5m0 0v5m0-5L10 14M5 9v10h10" />
                      </svg>
                      <span className="hidden lg:inline">Open</span>
                    </button>
                  </ToolbarAnimatedSlot>
                ) : null}

                <ToolbarAnimatedSlot visible={!isBelowLargeToolbar} width="2.5rem" className="hidden lg:flex">
                  {!isBelowLargeToolbar ? (
                  <Tooltip label={selectedItem.userState.archived ? "Unarchive" : "Archive"}>
                    <button
                      onClick={handleToggleReaderArchived}
                      {...getToolbarControlProps()}
                      className={`${TOOLBAR_ICON_BUTTON_CLASS} ${
                        selectedItem.userState.archived
                          ? "theme-toolbar-button-success-active"
                          : "theme-toolbar-button-neutral"
                      }`}
                      aria-label={selectedItem.userState.archived ? "Unarchive" : "Archive"}
                    >
                      <ArchiveIcon className="h-5 w-5" />
                    </button>
                  </Tooltip>
                  ) : null}
                </ToolbarAnimatedSlot>
              </>
            ) : (
              <>
                <ToolbarAnimatedSlot visible={!!HeaderSyncIndicator} width={TOOLBAR_SLOT_WIDTH_CONTENT} className="hidden md:flex">
                  {HeaderSyncIndicator ? (
                    <div className="hidden md:flex">
                      <HeaderSyncIndicator />
                    </div>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot
                  visible={showInlineWorkspaceIdentityControls}
                  width={TOOLBAR_SLOT_WIDTH_CONTENT}
                >
                  {showInlineWorkspaceIdentityControls ? (
                    <ToolbarToggleGroup
                      dataTestId={activeView === "map" ? "map-toolbar-scope" : "friends-toolbar-lens"}
                      options={
                        activeView === "friends" && isMobile
                          ? [
                              { value: "friends", label: "Friends" },
                              { value: "all_content", label: "All content" },
                              { value: "details", label: "Details" },
                            ]
                          : [
                              { value: "friends", label: "Friends" },
                              { value: "all_content", label: "All content" },
                            ]
                      }
                      value={activeView === "map" ? effectiveMapMode : friendsToolbarValue}
                      onChange={(mode) => {
                        if (activeView === "map") {
                          handleIdentityModeChange("mapMode", mode as MapMode);
                          return;
                        }
                        handleFriendsToolbarModeChange(mode as FriendsToolbarMode);
                      }}
                      compact={activeView === "friends" && isMobile}
                      getButtonProps={getToolbarControlProps}
                    />
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={showInlineMapTimeControls} width={TOOLBAR_SLOT_WIDTH_CONTENT}>
                  {showInlineMapTimeControls ? (
                    <ToolbarToggleGroup
                      dataTestId="map-toolbar-timeframe"
                      options={[
                        { value: "current", label: "Current" },
                        { value: "future", label: "Future" },
                        { value: "past", label: "Past" },
                      ]}
                      value={display.mapTimeMode ?? "current"}
                      onChange={handleMapTimeModeChange}
                      compact
                      getButtonProps={getToolbarControlProps}
                    />
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={showArchivedToolbar && !isBelowLargeToolbar} width={TOOLBAR_SLOT_WIDTH_CONTENT} className="hidden xl:flex">
                  {showArchivedToolbar && !isBelowLargeToolbar ? (
                    <span className="text-xs text-[var(--theme-text-muted)]">
                      {getRetentionLabel(display.archivePruneDays ?? 30)}
                    </span>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot
                  visible={showArchivedToolbar && savedArchivedCount > 0 && !isBelowLargeToolbar}
                  width={TOOLBAR_SLOT_WIDTH_CONTENT}
                  className="hidden lg:flex"
                >
                  {showArchivedToolbar && savedArchivedCount > 0 && !isBelowLargeToolbar ? (
                    <button
                      onClick={handleUnarchiveSavedClick}
                      {...getToolbarControlProps()}
                      className="theme-toolbar-button-ghost rounded-lg px-3 py-1.5 text-sm"
                    >
                      Unarchive saved
                    </button>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={showArchivedDeleteAction && !isBelowLargeToolbar} width={TOOLBAR_SLOT_WIDTH_CONTENT} className="hidden lg:flex">
                  {showArchivedDeleteAction && !isBelowLargeToolbar ? (
                    <button
                      onClick={handleDeleteArchivedClick}
                      {...getToolbarControlProps()}
                      className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                        deleteConfirmArmed
                          ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                          : "theme-toolbar-button-ghost"
                      }`}
                    >
                      {deleteConfirmArmed ? "Confirm delete?" : "Delete archived"}
                    </button>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={showFeedBulkActions && unreadCount > 0 && !isBelowLargeToolbar} width={TOOLBAR_SLOT_WIDTH_CONTENT} className="hidden lg:flex">
                  {showFeedBulkActions && unreadCount > 0 && !isBelowLargeToolbar ? (
                    <Tooltip label={`Mark all ${unreadCount.toLocaleString()} items as read`} className="hidden lg:flex">
                      <button
                        onClick={() => markAllAsRead(activeFilter.platform)}
                        {...getToolbarControlProps()}
                        className="theme-toolbar-button-ghost flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{unreadCount.toLocaleString()} unread</span>
                      </button>
                    </Tooltip>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={showFeedBulkActions && archivableCount > 0 && !isBelowLargeToolbar} width={TOOLBAR_SLOT_WIDTH_CONTENT} className="hidden lg:flex">
                  {showFeedBulkActions && archivableCount > 0 && !isBelowLargeToolbar ? (
                    <Tooltip label={`Archive all ${archivableCount.toLocaleString()} read (unsaved) items`} className="hidden lg:flex">
                      <button
                        onClick={() => archiveAllReadUnsaved(activeFilter.platform, activeFilter.feedUrl)}
                        {...getToolbarControlProps()}
                        className="theme-toolbar-button-ghost flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>{archivableCount.toLocaleString()} read</span>
                      </button>
                    </Tooltip>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={showInlineSocialContentControls} width={TOOLBAR_SLOT_WIDTH_CONTENT}>
                  {showInlineSocialContentControls ? (
                    <ToolbarToggleGroup
                      dataTestId="social-content-toolbar-filter"
                      options={[
                        { value: "all", label: "All" },
                        { value: "posts", label: "Posts" },
                        { value: "stories", label: "Stories" },
                      ]}
                      value={socialContentFilter}
                      onChange={handleSocialContentFilterChange}
                      compact
                      getButtonProps={getToolbarControlProps}
                    />
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={showInlineFeedSignalFilter} width={TOOLBAR_SLOT_WIDTH_CONTENT}>
                  {showInlineFeedSignalFilter ? (
                    <div className="relative flex">
                      <Tooltip label="Filter feed">
                        <button
                          ref={signalFilterButtonRef}
                          type="button"
                          onClick={toggleSignalFilterMenu}
                          {...getToolbarControlProps()}
                          data-testid="feed-signal-filter-button"
                          className="theme-toolbar-button-neutral inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold shadow-sm"
                          aria-haspopup="menu"
                          aria-expanded={signalFilterMenuOpen}
                          aria-label="Filter feed"
                        >
                          <FilterIcon className="h-4 w-4" />
                          <span className="hidden md:inline">{feedSignalFilterLabel}</span>
                        </button>
                      </Tooltip>
                    </div>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={showFriendsSidebarToggle} width={TOOLBAR_SLOT_WIDTH_CONTENT} className="hidden md:flex">
                  {showFriendsSidebarToggle ? (
                    <Tooltip label={friendsSidebarOpen ? "Hide details" : "Show details"}>
                      <button
                        onClick={onFriendsSidebarToggle}
                        {...getToolbarControlProps()}
                        data-testid="friends-sidebar-toggle"
                        className="theme-toolbar-button-ghost rounded-lg p-2"
                        aria-pressed={friendsSidebarOpen}
                        aria-label={friendsSidebarOpen ? "Hide details" : "Show details"}
                      >
                        {friendsSidebarOpen ? (
                          <ReaderRailShowIcon className="h-5 w-5" />
                        ) : (
                          <ReaderRailHideIcon className="h-5 w-5" />
                        )}
                      </button>
                    </Tooltip>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot
                  visible={showToolbarOverflowMenuButton || showCollapsedToolbarFilterMenu}
                  width={showToolbarOverflowMenuButton && showCollapsedToolbarFilterMenu ? "5.375rem" : "2.5rem"}
                >
                  {showToolbarOverflowMenuButton || showCollapsedToolbarFilterMenu ? (
                    <div className="flex items-center gap-2">
                      {showToolbarOverflowMenuButton ? (
                        <Tooltip label="More actions">
                          <button
                            ref={toolbarOverflowButtonRef}
                            type="button"
                            onClick={toggleToolbarOverflowMenu}
                            {...getToolbarControlProps()}
                            data-testid="toolbar-overflow-button"
                            className={`${TOOLBAR_ICON_BUTTON_CLASS} ${
                              isMobileDevice ? "theme-toolbar-button-ghost" : "theme-toolbar-button-neutral"
                            }`}
                            aria-haspopup="menu"
                            aria-expanded={toolbarOverflowMenuOpen}
                            aria-label="More actions"
                          >
                            <ToolbarOverflowIcon />
                          </button>
                        </Tooltip>
                      ) : null}
                      {showCollapsedToolbarFilterMenu ? (
                        <Tooltip label="Filter view">
                          <button
                            ref={signalFilterButtonRef}
                            type="button"
                            onClick={toggleSignalFilterMenu}
                            {...getToolbarControlProps()}
                            data-testid="mobile-toolbar-filter-button"
                            className={`${TOOLBAR_ICON_BUTTON_CLASS} ${
                              isMobileDevice ? "theme-toolbar-button-ghost" : "theme-toolbar-button-neutral"
                            }`}
                            aria-haspopup="menu"
                            aria-expanded={signalFilterMenuOpen}
                            aria-label="Filter view"
                          >
                            <FilterIcon className="h-5 w-5" />
                          </button>
                        </Tooltip>
                      ) : null}
                    </div>
                  ) : null}
                </ToolbarAnimatedSlot>

              </>
            )}
          </div>
        </div>
      </header>

      {toolbarOverflowMenuOpen && showToolbarOverflowMenuButton ? (
        <div
          ref={toolbarOverflowMenuRef}
          data-testid="toolbar-overflow-menu"
          role="menu"
          className="theme-dialog-shell fixed z-[300] w-[16rem] max-w-[calc(100vw-1rem)] overflow-hidden py-1.5 shadow-2xl shadow-black/35"
          style={{
            top: toolbarOverflowMenuPosition?.top ?? 60,
            right: toolbarOverflowMenuPosition?.right ?? 8,
            ...(headerDragRegion ? noDrag : {}),
          }}
        >
          {toolbarOverflowActions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              onClick={() => {
                action.onClick();
                if (action.id !== "delete-archived" || action.danger) {
                  setToolbarOverflowMenuOpen(false);
                }
              }}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-[var(--theme-bg-muted)] ${
                action.danger
                  ? "text-red-400"
                  : action.active
                    ? "text-[var(--theme-text-primary)]"
                    : "text-[var(--theme-text-secondary)]"
              }`}
            >
              <span className="shrink-0 text-current">{action.icon}</span>
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {signalFilterMenuOpen && (showFeedSignalFilter || showCollapsedToolbarFilterMenu) ? (
        <div
          ref={signalFilterMenuRef}
          data-testid="feed-signal-filter-menu"
          role="menu"
          className="theme-dialog-shell fixed z-[300] w-[20rem] max-w-[calc(100vw-1rem)] overflow-hidden py-2 shadow-2xl shadow-black/35"
          style={{
            top: signalFilterMenuPosition?.top ?? 60,
            right: signalFilterMenuPosition?.right ?? 8,
            ...(headerDragRegion ? noDrag : {}),
          }}
        >
          {showCollapsedToolbarFilterMenu && showSocialContentControls ? (
            <div className={`${showFeedSignalFilter ? "border-b border-[var(--theme-border-subtle)]" : ""} px-3 pb-3 pt-1`}>
              <ToolbarToggleGroup
                dataTestId="mobile-social-content-toolbar-filter"
                options={[
                  { value: "all", label: "All" },
                  { value: "posts", label: "Posts" },
                  { value: "stories", label: "Stories" },
                ]}
                value={socialContentFilter}
                onChange={handleSocialContentFilterChange}
                compact
                fullWidth
              />
            </div>
          ) : null}

          {showCollapsedToolbarFilterMenu && showWorkspaceIdentityControls ? (
            <div className={`${showMapTimeControls || showFeedSignalFilter ? "border-b border-[var(--theme-border-subtle)]" : ""} px-3 py-3`}>
              <p className="mb-2 px-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-muted)]">
                View
              </p>
              <ToolbarToggleGroup
                dataTestId={activeView === "map" ? "mobile-map-toolbar-scope" : "mobile-friends-toolbar-lens"}
                options={
                  activeView === "friends"
                    ? [
                        { value: "friends", label: "Friends" },
                        { value: "all_content", label: "All content" },
                        { value: "details", label: "Details" },
                      ]
                    : [
                        { value: "friends", label: "Friends" },
                        { value: "all_content", label: "All content" },
                      ]
                }
                value={activeView === "map" ? effectiveMapMode : friendsToolbarValue}
                onChange={(mode) => {
                  if (activeView === "map") {
                    handleIdentityModeChange("mapMode", mode as MapMode);
                    return;
                  }
                  handleFriendsToolbarModeChange(mode as FriendsToolbarMode);
                }}
                compact
                fullWidth
              />
            </div>
          ) : null}

          {showCollapsedToolbarFilterMenu && showMapTimeControls ? (
            <div className="px-3 py-3">
              <p className="mb-2 px-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-muted)]">
                Time
              </p>
              <ToolbarToggleGroup
                dataTestId="mobile-map-toolbar-timeframe"
                options={[
                  { value: "current", label: "Current" },
                  { value: "future", label: "Future" },
                  { value: "past", label: "Past" },
                ]}
                value={display.mapTimeMode ?? "current"}
                onChange={handleMapTimeModeChange}
                compact
                fullWidth
              />
            </div>
          ) : null}

          {showFeedSignalFilter ? [everythingSignalPreset, ...selectableFeedSignalPresets].map((preset) => {
            const selected = preset.mode === "all"
              ? allFeedSignalsSelected
              : allFeedSignalsSelected || activeFeedSignalModeSet.has(preset.mode);
            const feedbackKey = signalFilterFeedback?.mode === preset.mode
              ? signalFilterFeedback.tick
              : 0;
            return (
              <button
                key={preset.mode}
                type="button"
                role="menuitemcheckbox"
                aria-checked={selected}
                onClick={() => handleFeedSignalModeChange(preset.mode)}
                className={`flex w-full items-start gap-4 py-3.5 pl-7 pr-6 text-left transition-colors hover:bg-[var(--theme-bg-muted)] ${
                  selected ? "text-[var(--theme-text-primary)]" : "text-[var(--theme-text-secondary)]"
                }`}
              >
                <span
                  key={`${preset.mode}-${selected ? "checked" : "empty"}-${feedbackKey}`}
                  className={`feed-signal-checkbox mt-0.5 ${selected ? "feed-signal-checkbox-checked" : ""} ${
                    feedbackKey ? "feed-signal-checkbox-feedback" : ""
                  }`}
                  aria-hidden="true"
                >
                  {selected ? (
                    <svg className="feed-signal-check-icon h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{preset.label}</span>
                  <span className="block text-xs leading-5 text-[var(--theme-text-muted)]">
                    {preset.description}
                  </span>
                </span>
                <span className="mt-0.5 shrink-0 text-xs tabular-nums text-[var(--theme-text-muted)]">
                  {feedSignalCounts[preset.mode].toLocaleString()}
                </span>
              </button>
            );
          }) : null}
        </div>
      ) : null}

      {showNewButton && (
        <div
          ref={dropdownRef}
          className="fixed bottom-5 right-5 z-[90] sm:bottom-6 sm:right-6"
          style={headerDragRegion ? noDrag : undefined}
        >
          {dropdownOpen && (
            <div className="theme-floating-panel absolute bottom-[calc(100%+0.875rem)] right-0 flex min-w-[12rem] flex-col overflow-hidden py-1 shadow-2xl shadow-black/40">
              {canAddRss && (
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    openAddFeedDialog();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                >
                  <svg className="theme-icon-action h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7M6 17a1 1 0 110 2 1 1 0 010-2z" />
                  </svg>
                  RSS Feed
                </button>
              )}
              {canSaveContent && (
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    openSavedContentDialog();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                >
                  <svg className="theme-icon-action h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                  Saved Content
                </button>
              )}
            </div>
          )}

          <Tooltip label="Add new...">
            <button
              onClick={() => setDropdownOpen((value) => !value)}
              className="theme-fab-button flex h-14 w-14 items-center justify-center rounded-full transition-transform hover:scale-[1.02] active:scale-[0.98]"
              aria-haspopup="true"
              aria-expanded={dropdownOpen}
              aria-label="New"
            >
              <svg className={`h-6 w-6 transition-transform ${dropdownOpen ? "rotate-45" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </Tooltip>
        </div>
      )}
    </>
  );
}
