import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  applyFeedSignalModesToFilter,
  FEED_SIGNAL_FILTER_PRESETS,
  filterFeedItems,
  resolveFeedSignalModesFromDisplay,
  type DisplayPreferences,
  type FeedSignalMode,
  type MapMode,
  type SavedContentSortMode,
  type SidebarMode,
  type SocialContentFilter,
  resolveMapMode,
} from "@freed/shared";
import { Tooltip } from "../Tooltip.js";
import { BackgroundActivityPopover } from "../BackgroundActivityPopover.js";
import {
  ArchiveIcon,
  CloseIcon,
  FilterIcon,
  MenuIcon,
  ReaderRailHideIcon,
  ReaderRailShowIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  SortIcon,
} from "../icons.js";
import { useSearchResults } from "../../hooks/useSearchResults.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useIsMobileDevice } from "../../hooks/useIsMobileDevice.js";
import { useBackgroundActivityStore } from "../../lib/background-activity-store.js";
import { useCommandSurfaceStore } from "../../lib/command-surface-store.js";
import { runFeedLayoutTransition } from "../../lib/view-transitions.js";
import {
  MACOS_TRAFFIC_LIGHT_INSET,
  MACOS_TRAFFIC_LIGHT_ROW_CENTER_Y,
  useAppStore,
  usePlatform,
} from "../../context/PlatformContext.js";
import { getFilterLabel, getRetentionLabel } from "../../lib/feed-view-labels.js";
import { useFeedCardDensity } from "../../lib/feed-card-density.js";
import {
  normalizeInterfaceZoom,
  scaleInterfaceChromePx,
  useInterfaceZoom,
} from "../../lib/interface-zoom.js";
import {
  FeedCardDensitySlider,
  InterfaceZoomSlider,
} from "../DisplayScaleControls.js";
import {
  collectArchivableFeedActionIds,
  collectUnreadFeedActionIds,
  getFeedActionCounts,
} from "../../lib/feed-action-scope.js";
import {
  dragRegionStyle as dragStyle,
  getPassiveDragRegionProps,
  noDragRegionStyle as noDrag,
} from "../../lib/native-drag-region.js";
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

const toolbarControlStyle = { ...noDrag, userSelect: "none" } as CSSProperties;
const TOP_TOOLBAR_HEIGHT_PX =
  COMPACT_PRIMARY_SIDEBAR_WIDTH_PX + PRIMARY_SIDEBAR_GAP_WIDTH_PX / 2;
const TOOLBAR_ICON_BUTTON_CLASS =
  "theme-toolbar-icon-button rounded-lg";
const TOOLBAR_READER_LAYOUT_TOGGLE_BUTTON_CLASS =
  "theme-toolbar-reader-layout-button rounded-lg";
const TOOLBAR_ICON_BUTTON_SIZE = "2.25rem";
const READER_LAYOUT_CONTROL_BUTTON_SIZE_PX = 32;
const READER_LAYOUT_CONTROL_ICON_SIZE_PX = 20;
const READER_LAYOUT_CONTROL_BUTTON_GAP_PX = 0;
const LAYOUT_CONTROL_SAFE_GAP_PX = 8;
const MENU_VIEWPORT_MARGIN_PX = 8;
const CLOSED_SIDEBAR_TOGGLE_LEFT_PX = 12;
const DEFAULT_LAYOUT_CONTROL_SAFE_LEFT_PX = 180;
const DEFAULT_LAYOUT_CONTROL_RESERVED_WIDTH_PX = 280;
const COLLAPSED_LAYOUT_CONTROL_EXTRA_WIDTH_PX = 72;
const TOOLBAR_SLOT_WIDTH_CONTENT = "max-content";
const TOOLBAR_COLLAPSE_BREAKPOINT_PX = 1200;
const READER_BOOKMARK_INLINE_MIN_WIDTH_PX = 980;
const SAVED_SORT_OPTIONS: Array<{ value: SavedContentSortMode; label: string }> = [
  { value: "date_saved", label: "Date saved" },
  { value: "date_published", label: "Date published" },
  { value: "recommended", label: "Recommended" },
  { value: "shortest_read", label: "Shortest read" },
];

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

function SavedSortSelect({
  value,
  onChange,
  fullWidth = false,
  style,
}: {
  value: SavedContentSortMode;
  onChange: (value: SavedContentSortMode) => void;
  fullWidth?: boolean;
  style?: CSSProperties;
}) {
  return (
    <Tooltip label="Sort saved content" className={fullWidth ? "w-full" : undefined}>
      <div
        data-testid="saved-sort-control"
        className={`theme-toolbar-select-control ${fullWidth ? "w-full" : ""}`}
        style={{
          ...(fullWidth ? { width: "100%" } : {}),
          ...style,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <SortIcon className="h-4 w-4" />
        <select
          data-testid="saved-sort-select"
          value={value}
          onChange={(event) => onChange(event.target.value as SavedContentSortMode)}
          aria-label="Sort saved content"
        >
          {SAVED_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </Tooltip>
  );
}

function joinTitleParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function signalTitlePart(modes: readonly FeedSignalMode[]): string | null {
  if (modes.length === 0) return null;
  if (modes.length > 2) return "Filtered";
  const labels = modes.map((mode) =>
    mode === "conversation"
      ? "Conversations"
      : FEED_SIGNAL_FILTER_PRESETS.find((preset) => preset.mode === mode)?.label ?? "Filtered"
  );
  return joinTitleParts(labels);
}

function contentKindTitlePart(filter: { platform?: string; feedUrl?: string; socialContentFilter?: SocialContentFilter }): string | null {
  if (filter.feedUrl || filter.platform === "rss") return "Articles";
  if (filter.socialContentFilter === "stories") return "Stories";
  if (filter.socialContentFilter === "posts") return "Posts";
  return null;
}

function contextualFeedTitle({
  filter,
  scopeLabel,
  activeSignalModes,
  allSignalsSelected,
}: {
  filter: { platform?: string; feedUrl?: string; socialContentFilter?: SocialContentFilter; savedOnly?: boolean; archivedOnly?: boolean };
  scopeLabel: string;
  activeSignalModes: readonly FeedSignalMode[];
  allSignalsSelected: boolean;
}): string {
  if (filter.savedOnly || filter.archivedOnly) return scopeLabel;

  const signalPart = allSignalsSelected ? null : signalTitlePart(activeSignalModes);
  const kindPart = contentKindTitlePart(filter);
  const providerPart =
    filter.platform && filter.platform !== "rss"
      ? scopeLabel
      : null;
  const hasContentFilter = !!signalPart || filter.socialContentFilter === "posts" || filter.socialContentFilter === "stories";

  if (!providerPart && !hasContentFilter) return scopeLabel;
  return [...(providerPart ? [providerPart] : []), ...(signalPart ? [signalPart] : []), ...(kindPart ? [kindPart] : [])].join(" ");
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
  const feedTotalCounts = useAppStore((s) => s.feedTotalCounts);
  const totalItemCount = useAppStore((s) => s.totalItemCount);
  const itemCountByPlatform = useAppStore((s) => s.itemCountByPlatform);
  const persons = useAppStore((s) => s.persons);
  const accounts = useAppStore((s) => s.accounts);
  const friends = useAppStore((s) => s.friends);
  const activeView = useAppStore((s) => s.activeView);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const searchCorpusVersion = useAppStore((s) => s.searchCorpusVersion);
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const pendingMatchCount = useAppStore((s) => s.pendingMatchCount);
  const markItemsAsRead = useAppStore((s) => s.markItemsAsRead);
  const unarchiveSavedItems = useAppStore((s) => s.unarchiveSavedItems);
  const deleteAllArchived = useAppStore((s) => s.deleteAllArchived);
  const toggleSaved = useAppStore((s) => s.toggleSaved);
  const toggleArchived = useAppStore((s) => s.toggleArchived);
  const archiveItems = useAppStore((s) => s.archiveItems);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const setSelectedItem = useAppStore((s) => s.setSelectedItem);
  const setFilter = useAppStore((s) => s.setFilter);
  const display = useAppStore((s) => s.preferences.display);
  const activeSearchQuery = searchQuery.trim();
  const [feedCardDensity, setFeedCardDensity] = useFeedCardDensity();
  const [interfaceZoom, setInterfaceZoom] = useInterfaceZoom();
  const topToolbarHeightPx = scaleInterfaceChromePx(TOP_TOOLBAR_HEIGHT_PX, interfaceZoom);
  const toolbarGapHalfPx = scaleInterfaceChromePx(PRIMARY_SIDEBAR_GAP_WIDTH_PX / 2, interfaceZoom);
  const toolbarSlotPaddingRightPx = scaleInterfaceChromePx(TOOLBAR_SIDEBAR_SLOT_PADDING_RIGHT_PX, interfaceZoom);
  const toolbarControlCenterYPx =
    MACOS_TRAFFIC_LIGHT_ROW_CENTER_Y + Math.round((topToolbarHeightPx - TOP_TOOLBAR_HEIGHT_PX) / 2);

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
  const activeBackgroundActivityCount = useBackgroundActivityStore((s) => Object.keys(s.active).length);
  const backgroundActivityActive = activeBackgroundActivityCount > 0;
  const [activityPopoverOpen, setActivityPopoverOpen] = useState(false);
  const activityButtonRef = useRef<HTMLButtonElement | null>(null);
  const showBackgroundActivityControl = backgroundActivityActive || activityPopoverOpen;

  const scopeLabel = useMemo(() => getFilterLabel(activeFilter, feeds, accounts), [accounts, activeFilter, feeds]);
  const friendCount = useMemo(
    () => Object.values(persons).filter((person) => person.relationshipStatus === "friend").length,
    [persons],
  );
  const mappedFriendCount = useAppStore((s) => s.mapFriendLocationCount);
  const mappedAllContentCount = useAppStore((s) => s.mapAllContentLocationCount);
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
  const showWorkspaceIdentityControls =
    activeView === "friends" ||
    activeView === "map" ||
    (activeView === "feed" && !selectedItem);
  const showFeedBulkActions = activeView === "feed";
  const showFeedSignalFilter = activeView === "feed" && !selectedItem;
  const showSavedSortControl = showFeedSignalFilter && activeFilter.savedOnly === true;
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
  const showInlineSocialContentControls =
    showSocialContentControls && !collapseToolbarViewControls;
  const showFeedCardDensityControl =
    activeView === "feed" &&
    !selectedItem &&
    !isMobile;
  const hideMobileDrawerToolbarActions = mobileSidebarOpen;
  const showCollapsedFeedControlMenu =
    showFeedSignalFilter ||
    showSavedSortControl ||
    showFeedCardDensityControl;
  const showCollapsedToolbarFilterMenu =
    !hideMobileDrawerToolbarActions &&
    !selectedItem &&
    (
      showCollapsedFeedControlMenu ||
      (collapseToolbarViewControls && (
        showWorkspaceIdentityControls ||
        showSocialContentControls ||
        showSavedSortControl
      ))
    );
  const showInlineFeedSignalFilter =
    !hideMobileDrawerToolbarActions &&
    showFeedSignalFilter &&
    !showCollapsedToolbarFilterMenu;
  const showInlineSavedSortControl =
    showSavedSortControl && !showCollapsedToolbarFilterMenu;
  const showFilterMenuFeedCardDensityControl =
    showFeedCardDensityControl;
  const showInlineReaderBookmark =
    !!selectedItem && !isBelowReaderBookmarkToolbar;
  const collapsedReaderBaseActionWidthRem = selectedItem?.sourceUrl
    ? showInlineReaderBookmark ? 11 : 8.5
    : showInlineReaderBookmark ? 6.5 : 3.5;
  const collapsedReaderActionWidthRem =
    collapsedReaderBaseActionWidthRem + (showBackgroundActivityControl ? 2.75 : 0);
  const collapsedReaderTitleStyle = selectedItem && isBelowLargeToolbar
    ? ({ paddingRight: `${collapsedReaderActionWidthRem}rem` } as CSSProperties)
    : undefined;
  const collapsedReaderActionStyle = selectedItem && isBelowLargeToolbar
    ? ({ width: `${collapsedReaderActionWidthRem}rem` } as CSSProperties)
    : undefined;

  const {
    unreadCount,
    archivableCount,
  } = useMemo(() => getFeedActionCounts(filteredItems), [filteredItems]);

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

  const fullScopeItemCount = useMemo(() => {
    if (
      activeFilter.authorId ||
      activeFilter.savedOnly ||
      activeFilter.archivedOnly ||
      activeFilter.socialContentFilter ||
      (activeFilter.tags?.length ?? 0) > 0 ||
      (activeFilter.signals?.length ?? 0) > 0
    ) {
      return null;
    }
    if (activeFilter.feedUrl) {
      return feedTotalCounts[activeFilter.feedUrl] ?? null;
    }
    if (activeFilter.platform) {
      if (activeFilter.platform === "rss") {
        return Object.values(feedTotalCounts).reduce(
          (total, count) => total + count,
          0,
        );
      }
      return itemCountByPlatform[activeFilter.platform] ?? null;
    }
    return totalItemCount;
  }, [
    activeFilter.archivedOnly,
    activeFilter.authorId,
    activeFilter.feedUrl,
    activeFilter.platform,
    activeFilter.savedOnly,
    activeFilter.signals,
    activeFilter.socialContentFilter,
    activeFilter.tags,
    feedTotalCounts,
    itemCountByPlatform,
    totalItemCount,
  ]);

  const currentListSubtitle = useMemo(() => {
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
    return formatItemCount(fullScopeItemCount ?? filteredItems.length);
  }, [
    activeView,
    effectiveFriendsMode,
    filteredItems.length,
    friendCount,
    fullScopeItemCount,
    effectiveMapMode,
    isSearching,
    mappedAllContentCount,
    mappedFriendCount,
    pendingMatchCount,
    resultCount,
    socialAccountCount,
    scopeLabel,
  ]);

  const currentSubtitle = useMemo(() => {
    if (selectedItem) {
      const source = selectedItem.platform
        ? selectedItem.platform.toLocaleUpperCase()
        : scopeLabel;
      return `${selectedItem.author.displayName} • ${source}`;
    }
    return currentListSubtitle;
  }, [currentListSubtitle, scopeLabel, selectedItem]);

  const [signalFilterMenuOpen, setSignalFilterMenuOpen] = useState(false);
  const signalFilterMenuRef = useRef<HTMLDivElement>(null);
  const signalFilterButtonRef = useRef<HTMLButtonElement>(null);
  const [signalFilterMenuPosition, setSignalFilterMenuPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const [signalFilterMenuZoomDrag, setSignalFilterMenuZoomDrag] = useState<{
    baselineZoom: number;
    left: number;
    top: number;
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
  const handleSignalFilterZoomDragStart = useCallback((baselineZoom: number) => {
    const bounds = signalFilterMenuRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }
    setSignalFilterMenuZoomDrag({
      baselineZoom,
      left: bounds.left,
      top: bounds.top,
    });
  }, []);
  const handleSignalFilterZoomDragEnd = useCallback(() => {
    setSignalFilterMenuZoomDrag(null);
  }, []);
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
  const savedContentSortMode = display.savedContentSortMode ?? "date_saved";
  const contextualListTitle = useMemo(() => {
    if (activeView !== "feed") return currentListTitle;
    return contextualFeedTitle({
      filter: activeFilter,
      scopeLabel,
      activeSignalModes: activeFeedSignalModes,
      allSignalsSelected: allFeedSignalsSelected,
    });
  }, [
    activeFeedSignalModes,
    activeFilter,
    activeView,
    allFeedSignalsSelected,
    currentListTitle,
    scopeLabel,
  ]);
  const currentTitle = useMemo(() => {
    if (selectedItem) {
      return selectedItem.content.linkPreview?.title
        ?? selectedItem.content.text?.slice(0, 90)
        ?? selectedItem.author.displayName;
    }
    if (isSearching) return `Search: ${activeSearchQuery}`;
    return contextualListTitle;
  }, [activeSearchQuery, contextualListTitle, isSearching, selectedItem]);
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
    setActivityPopoverOpen(false);
    setToolbarOverflowMenuOpen((value) => !value);
  }, [updateToolbarOverflowMenuPosition]);

  const handleToggleBackgroundActivity = useCallback(() => {
    setSignalFilterMenuOpen(false);
    setToolbarOverflowMenuOpen(false);
    setActivityPopoverOpen((value) => !value);
  }, []);

  const handleIdentityModeChange = useCallback((key: "friendsMode" | "mapMode", mode: MapMode) => {
    updateDisplayPreference({ [key]: mode });
  }, [updateDisplayPreference]);

  const handleFriendsToolbarModeChange = useCallback((mode: FriendsToolbarMode) => {
    if (mode === "details") {
      flushSync(() => {
        onFriendsMobileSurfaceChange("details");
      });
      return;
    }
    flushSync(() => {
      handleIdentityModeChange("friendsMode", mode);
      onFriendsMobileSurfaceChange("graph");
    });
  }, [handleIdentityModeChange, onFriendsMobileSurfaceChange]);

  const handleSavedContentSortModeChange = useCallback((mode: SavedContentSortMode) => {
    updateDisplayPreference({ savedContentSortMode: mode });
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

  const handleMarkFilteredUnreadAsRead = useCallback(() => {
    void markItemsAsRead(collectUnreadFeedActionIds(filteredItems));
  }, [filteredItems, markItemsAsRead]);

  const handleArchiveFilteredRead = useCallback(() => {
    void archiveItems(collectArchivableFeedActionIds(filteredItems));
  }, [archiveItems, filteredItems]);

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

    }

    if (!selectedItem && showFeedBulkActions && unreadCount > 0) {
      actions.push({
        id: "mark-read",
        label: `Mark ${unreadCount.toLocaleString()} unread as read`,
        onClick: handleMarkFilteredUnreadAsRead,
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      });
    }

    if (!selectedItem && showFeedBulkActions && archivableCount > 0) {
      actions.push({
        id: "archive-read",
        label: `Archive ${archivableCount.toLocaleString()} read items`,
        onClick: handleArchiveFilteredRead,
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ),
      });
    }

    return actions;
  }, [
    archivableCount,
    deleteConfirmArmed,
    display.reading.focusMode,
    handleArchiveFilteredRead,
    handleDeleteArchivedClick,
    handleMarkFilteredUnreadAsRead,
    handleOpenReaderUrl,
    handleToggleFocusMode,
    handleToggleReaderSaved,
    handleToggleReaderArchived,
    handleUnarchiveSavedClick,
    isBelowLargeToolbar,
    savedArchivedCount,
    selectedItem,
    showInlineReaderBookmark,
    showArchivedDeleteAction,
    showArchivedToolbar,
    showFeedBulkActions,
    unreadCount,
  ]);
  const showToolbarOverflowMenuButton =
    !hideMobileDrawerToolbarActions &&
    toolbarOverflowActions.length > 0;

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
  const [previewToggleMounted, setPreviewToggleMounted] = useState(false);
  const showFriendsSidebarToggle = activeView === "friends" && !isMobile;
  const friendsToolbarValue: FriendsToolbarMode =
    isMobile && activeView === "friends" && friendsMobileSurface === "details"
      ? "details"
      : effectiveFriendsMode;
  const identityToolbarDataTestId =
    activeView === "map"
      ? "map-toolbar-scope"
      : activeView === "feed"
        ? "feed-toolbar-lens"
        : "friends-toolbar-lens";
  const mobileIdentityToolbarDataTestId =
    activeView === "map"
      ? "mobile-map-toolbar-scope"
      : activeView === "feed"
        ? "mobile-feed-toolbar-lens"
        : "mobile-friends-toolbar-lens";
  const identityToolbarOptions =
    activeView === "friends" && isMobile
      ? [
          { value: "friends", label: "Friends" },
          { value: "all_content", label: "All content" },
          { value: "details", label: "Details" },
        ]
      : [
          { value: "friends", label: "Friends" },
          { value: "all_content", label: "All content" },
        ];
  const identityToolbarValue = activeView === "map" ? effectiveMapMode : friendsToolbarValue;
  const handleToolbarIdentityModeChange = useCallback((mode: FriendsToolbarMode) => {
    if (activeView === "map") {
      handleIdentityModeChange("mapMode", mode as MapMode);
      return;
    }
    if (activeView === "friends") {
      handleFriendsToolbarModeChange(mode);
      return;
    }
    handleIdentityModeChange("friendsMode", mode as MapMode);
  }, [
    activeView,
    handleFriendsToolbarModeChange,
    handleIdentityModeChange,
  ]);
  const macosTrafficLightInsetStyle = headerDragRegion
    ? ({ paddingLeft: `${MACOS_TRAFFIC_LIGHT_INSET}px` } as CSSProperties)
    : undefined;
  const sidebarHandleCenterline = "var(--freed-sidebar-handle-centerline, 264px)";
  const toolbarBoundaryWidth = `calc(${sidebarHandleCenterline} + ${px(toolbarGapHalfPx)})`;
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
    paddingRight: px(toolbarSlotPaddingRightPx),
  } as CSSProperties;
  const layoutControlClusterStyle = {
    left: 0,
    width: px(layoutControlMetrics.reservedWidthPx),
    pointerEvents: "none",
    ...(headerDragRegion ? noDrag : {}),
  } as CSSProperties;
  const sidebarTogglePositionStyle = {
    left: px(layoutControlMetrics.sidebarToggleLeftPx),
    pointerEvents: "auto",
    ...(headerDragRegion ? noDrag : {}),
  } as CSSProperties;
  const previewTogglePositionStyle = {
    left: px(layoutControlMetrics.previewToggleLeftPx),
    pointerEvents: "auto",
    ...(headerDragRegion ? noDrag : {}),
  } as CSSProperties;
  const layoutControlCenterlineStyle = headerDragRegion
    ? ({
        position: "absolute",
        top: px(toolbarControlCenterYPx),
        transform: "translateY(-50%)",
      } as CSSProperties)
    : undefined;
  const layoutControlWrapperClass = headerDragRegion
    ? "absolute inline-flex"
    : "absolute top-1/2 inline-flex -translate-y-1/2";
  const toolbarContainerStyle = {
    ...(headerDragRegion ? dragStyle : {}),
    boxSizing: "border-box",
    height: px(topToolbarHeightPx),
    minHeight: px(topToolbarHeightPx),
    width: "100%",
    maxWidth: "100%",
    ["--freed-top-toolbar-height" as string]: px(topToolbarHeightPx),
    ["--freed-toolbar-control-center-y" as string]: px(toolbarControlCenterYPx),
  } as CSSProperties;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const layoutControlHostRef = useRef<HTMLDivElement | null>(null);
  const previewToggleButtonRef = useRef<HTMLButtonElement | null>(null);
  const wordmarkRef = useRef<HTMLSpanElement | null>(null);
  const sidebarHandleCenterlineStyleRef = useRef<string | null>(null);

  const handlePreviewToggleButtonRef = useCallback((node: HTMLButtonElement | null) => {
    previewToggleButtonRef.current = node;
    setPreviewToggleMounted(Boolean(node));
  }, []);

  const getToolbarControlProps = useCallback((style?: CSSProperties) => ({
    style: headerDragRegion
      ? ({ ...style, ...toolbarControlStyle } as CSSProperties)
      : style,
  }), [
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
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", updateToolbarOverflowMenuPosition);
    };
  }, [toolbarOverflowMenuOpen, updateToolbarOverflowMenuPosition]);

  useEffect(() => {
    if (toolbarOverflowActions.length > 0) return;
    setToolbarOverflowMenuOpen(false);
  }, [toolbarOverflowActions.length]);

  useEffect(() => {
    if (!hideMobileDrawerToolbarActions) return;
    setToolbarOverflowMenuOpen(false);
    setSignalFilterMenuOpen(false);
  }, [hideMobileDrawerToolbarActions]);

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
        "--freed-sidebar-handle-centerline",
      );
      const fallbackHandleCenterPx = parsePixelValue(
        sidebarHandleCenterlineStyleRef.current,
        264,
      );
      const resizeHandle = document.querySelector(
        '[data-testid="app-sidebar-resize-handle"]',
      ) as HTMLElement | null;
      const resizeHandleRect = resizeHandle?.getBoundingClientRect() ?? null;
      const handleCenterPx = resizeHandleRect
        ? resizeHandleRect.left + resizeHandleRect.width / 2 - hostRect.left
        : fallbackHandleCenterPx;
      const previewToggleButton = previewToggleButtonRef.current;
      const previewToggleVisible =
        !!previewToggleButton && previewToggleButton.getClientRects().length > 0;
      const readerLayoutControlButtonCount = previewToggleVisible ? 2 : 1;
      const readerLayoutControlPairWidthPx =
        READER_LAYOUT_CONTROL_BUTTON_SIZE_PX * readerLayoutControlButtonCount +
        READER_LAYOUT_CONTROL_BUTTON_GAP_PX * (readerLayoutControlButtonCount - 1);
      const idealSidebarToggleLeftPx = visibleDesktopSidebarMode === "closed"
        ? CLOSED_SIDEBAR_TOGGLE_LEFT_PX
        : handleCenterPx - readerLayoutControlPairWidthPx / 2;
      const collapsedSidebarToggleLeftPx = Math.min(
        idealSidebarToggleLeftPx,
        safeLeftPx + COLLAPSED_LAYOUT_CONTROL_EXTRA_WIDTH_PX,
      );
      const sidebarToggleLeftPx = Math.ceil(
        Math.max(isBelowLargeToolbar ? collapsedSidebarToggleLeftPx : idealSidebarToggleLeftPx, safeLeftPx),
      );
      const previewToggleLeftPx = Math.ceil(
        sidebarToggleLeftPx + READER_LAYOUT_CONTROL_BUTTON_SIZE_PX + READER_LAYOUT_CONTROL_BUTTON_GAP_PX,
      );
      const readerLayoutControlVisualInsetPx =
        (READER_LAYOUT_CONTROL_BUTTON_SIZE_PX - READER_LAYOUT_CONTROL_ICON_SIZE_PX) / 2;
      const toolbarBoundaryWidthPx =
        sidebarToggleLeftPx +
        readerLayoutControlPairWidthPx -
        (selectedItem ? readerLayoutControlVisualInsetPx : 0);
      const toolbarSlotPaddingRightPx = selectedItem
        ? 0
        : TOOLBAR_SIDEBAR_SLOT_PADDING_RIGHT_PX;
      const reservedWidthPx = Math.ceil(
        Math.max(
          toolbarBoundaryWidthPx + toolbarSlotPaddingRightPx,
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
    isBelowLargeToolbar,
    isMobileDevice,
    previewToggleMounted,
    selectedItem,
    showDesktopReaderLayoutToggle,
    showReaderLayoutToggle,
    visibleDesktopSidebarMode,
  ]);

  useEffect(() => {
    if (addFeedOpen || savedContentOpen) {
      setDropdownOpen(false);
    }
  }, [addFeedOpen, savedContentOpen]);

  useEffect(() => {
    if (!signalFilterMenuOpen) {
      setSignalFilterMenuZoomDrag(null);
    }
  }, [signalFilterMenuOpen]);

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
    if (deleteConfirmTimerRef.current) {
      window.clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }
  }, []);

  const toolbarOverflowMenuTop = toolbarOverflowMenuPosition?.top ?? 60;
  const signalFilterMenuTop = signalFilterMenuPosition?.top ?? 60;
  const toolbarOverflowMenuStyle = {
    top: toolbarOverflowMenuTop,
    right: toolbarOverflowMenuPosition?.right ?? 8,
    ["--theme-menu-top" as string]: `${toolbarOverflowMenuTop}px`,
    ["--theme-menu-viewport-margin" as string]: `${MENU_VIEWPORT_MARGIN_PX}px`,
    ...(headerDragRegion ? noDrag : {}),
  } as CSSProperties;
  const signalFilterMenuStyle = {
    top: signalFilterMenuZoomDrag?.top ?? signalFilterMenuTop,
    ...(signalFilterMenuZoomDrag
      ? {
          left: signalFilterMenuZoomDrag.left,
          right: "auto",
          transform: `scale(${signalFilterMenuZoomDrag.baselineZoom / normalizeInterfaceZoom(interfaceZoom)})`,
          transformOrigin: "top left",
        }
      : { right: signalFilterMenuPosition?.right ?? 8 }),
    ["--theme-menu-top" as string]: `${signalFilterMenuTop}px`,
    ["--theme-menu-viewport-margin" as string]: `${MENU_VIEWPORT_MARGIN_PX}px`,
    ...(headerDragRegion ? noDrag : {}),
  } as CSSProperties;
  const newMenuStyle = {
    ["--theme-menu-max-height" as string]: "calc(100dvh - 2rem)",
    ...(headerDragRegion ? noDrag : {}),
  } as CSSProperties;

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
            className={`theme-toolbar-cluster theme-toolbar-cluster-tight flex h-full shrink-0 items-center ${isMobileDevice ? "pl-2" : ""}`}
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
                    {mobileSidebarOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
                  </button>
                </Tooltip>
              ) : null}

              <div
                data-testid="workspace-toolbar-logo-drag-region"
                className="flex h-full min-w-0 flex-1 items-center pl-3 sm:pl-4"
                {...getPassiveDragRegionProps(headerDragRegion, toolbarLogoRowStyle)}
              >
                <span
                  ref={wordmarkRef}
                  data-testid="workspace-toolbar-wordmark"
                  className="cursor-default select-none text-lg font-bold gradient-text font-logo"
                  {...getPassiveDragRegionProps(headerDragRegion)}
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
                  <Tooltip
                    label={desktopSidebarToggleLabel}
                    className={layoutControlWrapperClass}
                    triggerStyle={{ ...sidebarTogglePositionStyle, ...layoutControlCenterlineStyle }}
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

                  {showDesktopReaderLayoutToggle ? (
                    <Tooltip
                      label={display.reading.dualColumnMode ? "Hide Previews" : "Show Previews"}
                      className={layoutControlWrapperClass}
                      triggerStyle={{ ...previewTogglePositionStyle, ...layoutControlCenterlineStyle }}
                    >
                      <button
                        ref={handlePreviewToggleButtonRef}
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
                  ) : null}

                </div>
              ) : null}
            </div>
          </div>

          <div
            className="min-w-0 basis-0 flex-1 overflow-hidden"
            style={headerDragRegion
              ? ({ ...collapsedReaderTitleStyle, ...dragStyle } as CSSProperties)
              : collapsedReaderTitleStyle}
            {...(headerDragRegion ? { "data-tauri-drag-region": true } : {})}
          >
            {selectedItem ? (
              <button
                onClick={handleCloseReader}
                {...getToolbarControlProps()}
                data-testid="workspace-toolbar-reader-back"
                className="group flex w-full min-w-0 items-center justify-center rounded-lg px-1 py-1 text-center transition-colors hover:bg-[var(--theme-bg-muted)]"
                aria-label="Back to list"
              >
                <div
                  data-testid="workspace-toolbar-reader-title-block"
                  className="flex min-w-0 max-w-full cursor-default select-none items-center justify-center gap-2 text-center"
                  {...getPassiveDragRegionProps(headerDragRegion)}
                >
                  <span className="flex h-8 w-5 shrink-0 items-center justify-center rounded-lg">
                    <svg
                      data-testid="workspace-toolbar-reader-back-icon"
                      className="h-4 w-4 shrink-0 text-[var(--theme-text-muted)] transition-colors group-hover:text-[var(--theme-text-secondary)]"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </span>
                  <p
                    className="truncate text-sm font-medium text-[var(--theme-text-secondary)]"
                    {...getPassiveDragRegionProps(headerDragRegion)}
                  >
                    {contextualListTitle}
                    <span
                      className="mx-1.5 font-normal text-[var(--theme-text-muted)]"
                      {...getPassiveDragRegionProps(headerDragRegion)}
                    >
                      •
                    </span>
                    <span
                      className="font-normal text-[var(--theme-text-muted)]"
                      {...getPassiveDragRegionProps(headerDragRegion)}
                    >
                      {currentListSubtitle}
                    </span>
                  </p>
                </div>
              </button>
            ) : (
              <div
                data-testid="workspace-toolbar-title-block"
                className="flex min-w-0 cursor-default select-none justify-center px-1 text-center"
                {...getPassiveDragRegionProps(headerDragRegion)}
              >
                <p
                  className="truncate text-center text-sm font-semibold text-[var(--theme-text-secondary)]"
                  {...getPassiveDragRegionProps(headerDragRegion)}
                >
                  {currentTitle}
                  <span
                    className="mx-1.5 font-normal text-[var(--theme-text-muted)]"
                    {...getPassiveDragRegionProps(headerDragRegion)}
                  >
                    •
                  </span>
                  <span
                    className="font-normal text-[var(--theme-text-muted)]"
                    {...getPassiveDragRegionProps(headerDragRegion)}
                  >
                    {currentSubtitle}
                  </span>
                </p>
              </div>
            )}
          </div>

          <div
            className={selectedItem
              ? isBelowLargeToolbar
                ? "theme-toolbar-cluster theme-toolbar-cluster-tight absolute right-0 top-1/2 z-10 flex shrink-0 -translate-y-1/2 items-center justify-end pr-2"
                : "theme-toolbar-cluster theme-toolbar-cluster-tight ml-auto flex min-w-max shrink-0 items-center pr-2"
              : "theme-toolbar-cluster theme-toolbar-cluster-tight flex min-w-max shrink-0 items-center pr-2"}
            style={collapsedReaderActionStyle}
          >
            <ToolbarAnimatedSlot
              visible={showBackgroundActivityControl}
              width={TOOLBAR_ICON_BUTTON_SIZE}
            >
              {showBackgroundActivityControl ? (
                <Tooltip label="Background activity">
                  <button
                    ref={activityButtonRef}
                    type="button"
                    onClick={handleToggleBackgroundActivity}
                    {...getToolbarControlProps()}
                    data-testid="background-activity-trigger"
                    className={`${TOOLBAR_ICON_BUTTON_CLASS} ${
                      activityPopoverOpen
                        ? "theme-toolbar-button-active"
                        : isMobileDevice
                          ? "theme-toolbar-button-ghost"
                          : "theme-toolbar-button-neutral"
                    } text-[var(--theme-accent-secondary)]`}
                    aria-haspopup="dialog"
                    aria-expanded={activityPopoverOpen}
                    aria-label="Show background activity"
                  >
                    <span
                      className={`h-3.5 w-3.5 rounded-full border border-current border-t-transparent ${
                        backgroundActivityActive ? "animate-spin" : ""
                      }`}
                    />
                  </button>
                </Tooltip>
              ) : null}
            </ToolbarAnimatedSlot>

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
                      className={`inline-flex h-9 w-full items-center justify-center rounded-lg px-2.5 py-0 text-sm font-bold leading-none ${
                        display.reading.focusMode
                          ? "theme-toolbar-button-active"
                          : "theme-toolbar-button-neutral"
                      }`}
                      aria-pressed={display.reading.focusMode}
                      aria-label="Toggle focus reading mode"
                    >
                      <span className="inline-flex items-baseline leading-none" aria-hidden="true">
                        <span className="font-black">F</span>
                        <span className="text-xs font-light">ocus</span>
                      </span>
                    </button>
                  </Tooltip>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={showInlineReaderBookmark} width={TOOLBAR_ICON_BUTTON_SIZE}>
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
                  width={TOOLBAR_ICON_BUTTON_SIZE}
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

                <ToolbarAnimatedSlot visible={!isBelowLargeToolbar} width={TOOLBAR_ICON_BUTTON_SIZE} className="hidden lg:flex">
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

                {selectedItem.sourceUrl ? (
                  <ToolbarAnimatedSlot visible={true} width="4.5rem" style={{ order: 99 }}>
                    <button
                      onClick={handleOpenReaderUrl}
                      {...getToolbarControlProps({ width: "4.5rem" })}
                      className="theme-toolbar-button-neutral inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 py-0 text-sm"
                      aria-label="Open"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5h5m0 0v5m0-5L10 14M5 9v10h10" />
                      </svg>
                      <span>Open</span>
                    </button>
                  </ToolbarAnimatedSlot>
                ) : null}
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
                      dataTestId={identityToolbarDataTestId}
                      options={identityToolbarOptions}
                      value={identityToolbarValue}
                      onChange={(mode) => handleToolbarIdentityModeChange(mode as FriendsToolbarMode)}
                      compact={activeView === "friends" && isMobile}
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
                      className="theme-toolbar-button-ghost inline-flex h-9 items-center rounded-lg px-3 py-0 text-sm"
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
                      className={`inline-flex h-9 items-center rounded-lg px-3 py-0 text-sm transition-colors ${
                        deleteConfirmArmed
                          ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                          : "theme-toolbar-button-ghost"
                      }`}
                    >
                      {deleteConfirmArmed ? "Confirm delete?" : "Delete archived"}
                    </button>
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

                <ToolbarAnimatedSlot visible={showInlineSavedSortControl} width="10.75rem" className="hidden lg:flex">
                  {showInlineSavedSortControl ? (
                    <SavedSortSelect
                      value={savedContentSortMode}
                      onChange={handleSavedContentSortModeChange}
                      style={headerDragRegion ? toolbarControlStyle : undefined}
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
                          className={`${isMobile ? "theme-toolbar-button-ghost shadow-none" : "theme-toolbar-button-neutral shadow-sm"} inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold`}
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
                        className={`${TOOLBAR_ICON_BUTTON_CLASS} theme-toolbar-button-ghost`}
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
                  width={
                    showToolbarOverflowMenuButton && showCollapsedToolbarFilterMenu
                      ? TOOLBAR_SLOT_WIDTH_CONTENT
                      : TOOLBAR_ICON_BUTTON_SIZE
                  }
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

      <BackgroundActivityPopover
        anchorElement={activityButtonRef.current}
        open={activityPopoverOpen && activityButtonRef.current !== null}
        onClose={() => setActivityPopoverOpen(false)}
      />

      {toolbarOverflowMenuOpen && showToolbarOverflowMenuButton ? (
        <div
          ref={toolbarOverflowMenuRef}
          data-testid="toolbar-overflow-menu"
          role="menu"
          className="theme-dialog-shell theme-menu-shell fixed z-[300] w-[16rem] max-w-[calc(100vw-1rem)] py-1.5 shadow-2xl shadow-black/35"
          style={toolbarOverflowMenuStyle}
        >
          {toolbarOverflowActions.length > 0 ? (
            <div data-testid="toolbar-overflow-actions-section" className="pt-2">
              <p className="px-4 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-muted)]">
                Actions
              </p>
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
        </div>
      ) : null}

      {signalFilterMenuOpen && (showFeedSignalFilter || showCollapsedToolbarFilterMenu) ? (
        <div
          ref={signalFilterMenuRef}
          data-testid="feed-signal-filter-menu"
          role="menu"
          className="theme-dialog-shell theme-menu-shell fixed z-[300] w-[20rem] max-w-[calc(100vw-1rem)] py-2 shadow-2xl shadow-black/35"
          style={signalFilterMenuStyle}
        >
          {showFilterMenuFeedCardDensityControl ? (
            <div
              data-testid="feed-filter-density-section"
              className="border-b border-[var(--theme-border-subtle)] px-3 pb-3 pt-1"
            >
              <p className="mb-2 px-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-muted)]">
                Card density
              </p>
              <FeedCardDensitySlider
                value={feedCardDensity}
                onChange={setFeedCardDensity}
                fullWidth
                style={headerDragRegion ? toolbarControlStyle : undefined}
              />
              <div className="mt-3">
                <div className="mb-2 flex items-center justify-between gap-3 px-1">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-muted)]">
                    Interface zoom
                  </p>
                  <span
                    data-testid="interface-zoom-value"
                    className="text-[0.68rem] font-semibold tabular-nums text-[var(--theme-text-soft)]"
                  >
                    {interfaceZoom.toLocaleString()}%
                  </span>
                </div>
                <InterfaceZoomSlider
                  value={interfaceZoom}
                  onChange={setInterfaceZoom}
                  fullWidth
                  style={headerDragRegion ? toolbarControlStyle : undefined}
                  dragStabilization="parent"
                  onDragStart={handleSignalFilterZoomDragStart}
                  onDragEnd={handleSignalFilterZoomDragEnd}
                />
              </div>
            </div>
          ) : null}

          {collapseToolbarViewControls && showCollapsedToolbarFilterMenu && showSocialContentControls ? (
            <div className={`${showFeedSignalFilter ? "border-b border-[var(--theme-border-subtle)]" : ""} px-3 pb-3 pt-1`}>
              <p className="mb-2 px-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-muted)]">
                Format
              </p>
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

          {collapseToolbarViewControls && showCollapsedToolbarFilterMenu && showWorkspaceIdentityControls ? (
            <div className={`${showSavedSortControl || showFeedSignalFilter ? "border-b border-[var(--theme-border-subtle)]" : ""} px-3 py-3`}>
              <p className="mb-2 px-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-muted)]">
                Connections
              </p>
              <ToolbarToggleGroup
                dataTestId={mobileIdentityToolbarDataTestId}
                options={identityToolbarOptions}
                value={identityToolbarValue}
                onChange={(mode) => handleToolbarIdentityModeChange(mode as FriendsToolbarMode)}
                compact
                fullWidth
              />
            </div>
          ) : null}

          {showCollapsedToolbarFilterMenu && showSavedSortControl ? (
            <div className={`${showFeedSignalFilter ? "border-b border-[var(--theme-border-subtle)]" : ""} px-3 py-3`}>
              <p className="mb-2 px-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-muted)]">
                Sort
              </p>
              <SavedSortSelect
                value={savedContentSortMode}
                onChange={handleSavedContentSortModeChange}
                fullWidth
                style={headerDragRegion ? toolbarControlStyle : undefined}
              />
            </div>
          ) : null}

          {showFeedSignalFilter ? (
            <div>
              <div className="px-3 pt-3">
                <p className="px-1 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-muted)]">
                  Classification
                </p>
              </div>
              {[everythingSignalPreset, ...selectableFeedSignalPresets].map((preset) => {
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
                    className={`flex w-full items-start gap-3 py-2.5 pl-7 pr-6 text-left transition-colors hover:bg-[var(--theme-bg-muted)] ${
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
                      <span className="block text-xs leading-4 text-[var(--theme-text-muted)]">
                        {preset.description}
                      </span>
                    </span>
                    <span className="mt-0.5 shrink-0 text-xs tabular-nums text-[var(--theme-text-muted)]">
                      {feedSignalCounts[preset.mode].toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {showNewButton && (
        <div
          ref={dropdownRef}
          className="fixed bottom-5 right-5 z-[90] sm:bottom-6 sm:right-6"
          style={headerDragRegion ? noDrag : undefined}
        >
          {dropdownOpen && (
            <div
              className="theme-floating-panel theme-menu-shell absolute bottom-[calc(100%+0.875rem)] right-0 flex min-w-[12rem] flex-col py-1 shadow-2xl shadow-black/40"
              style={newMenuStyle}
            >
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
