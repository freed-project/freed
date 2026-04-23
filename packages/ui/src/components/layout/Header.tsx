import {
  useState,
  useEffect,
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
  getDefaultMapMode,
  type DisplayPreferences,
  type MapMode,
  type MapTimeMode,
  type SidebarMode,
} from "@freed/shared";
import { AddFeedDialog } from "../AddFeedDialog.js";
import { SavedContentDialog } from "../SavedContentDialog.js";
import { SearchField } from "../SearchField.js";
import { Tooltip } from "../Tooltip.js";
import {
  ArchiveIcon,
  ReaderRailHideIcon,
  ReaderRailShowIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
} from "../icons.js";
import { useSearchResults } from "../../hooks/useSearchResults.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useIsMobileDevice } from "../../hooks/useIsMobileDevice.js";
import { runFeedLayoutTransition } from "../../lib/view-transitions.js";
import {
  MACOS_TRAFFIC_LIGHT_INSET,
  useAppStore,
  usePlatform,
} from "../../context/PlatformContext.js";
import { getFilterLabel, getRetentionLabel } from "../../lib/feed-view-labels.js";
import {
  TOOLBAR_BOUNDARY_BUTTON_GAP_PX,
  TOOLBAR_ICON_BUTTON_SIZE_PX,
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

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
const dragStyle = { WebkitAppRegion: "drag" } as CSSProperties;
const toolbarControlStyle = { ...noDrag, userSelect: "none" } as CSSProperties;
const TOOLBAR_DRAG_THRESHOLD_PX = 6;
const MIN_DESKTOP_TOOLBAR_IDENTITY_SLOT_WIDTH_PX = 176;
const TOOLBAR_ICON_BUTTON_CLASS =
  "theme-toolbar-icon-button rounded-lg";

function formatItemCount(count: number): string {
  return `${count.toLocaleString()} item${count === 1 ? "" : "s"}`;
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
  dataTestId,
  getButtonProps,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  compact?: boolean;
  dataTestId?: string;
  getButtonProps?: () => ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <div
      data-testid={dataTestId}
      className={`theme-toolbar-segmented inline-flex items-center ${compact ? "theme-toolbar-segmented-compact" : ""}`}
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
            className={`theme-toolbar-segment whitespace-nowrap ${
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

  const canAddRss = !!addRssFeed;
  const canSaveContent = !!(saveUrl || importMarkdown || exportMarkdown);
  const showNewButton = canAddRss || canSaveContent;

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
  const effectiveMapMode = display.mapMode
    ?? getDefaultMapMode(mappedFriendCount, mappedAllContentCount);
  const effectiveFriendsMode = display.friendsMode ?? "all_content";
  const showWorkspaceIdentityControls = activeView === "friends" || activeView === "map";
  const showMapTimeControls = activeView === "map";
  const showFeedBulkActions = activeView === "feed";
  const showArchivedToolbar = activeView === "feed" && activeFilter.archivedOnly === true;
  const showArchivedDeleteAction = showArchivedToolbar && (display.archivePruneDays ?? 30) > 0;

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

  const currentTitle = useMemo(() => {
    if (selectedItem) {
      return selectedItem.content.linkPreview?.title
        ?? selectedItem.content.text?.slice(0, 90)
        ?? selectedItem.author.displayName;
    }
    if (activeView === "friends") return "Friends";
    if (activeView === "map") return "Map";
    return scopeLabel;
  }, [activeView, scopeLabel, selectedItem]);

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

  const updateDisplayPreference = useCallback((patch: Partial<DisplayPreferences>) => {
    void updatePreferences({
      display: patch,
    } as Parameters<typeof updatePreferences>[0]);
  }, [updatePreferences]);

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
    void updatePreferences({
      display: {
        ...display,
        reading: {
          ...display.reading,
          dualColumnMode: !display.reading.dualColumnMode,
        },
      },
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

  const showReaderLayoutToggle =
    !isMobile &&
    !!selectedItem;
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
  const minimumToolbarIdentitySlotWidthPx =
    MIN_DESKTOP_TOOLBAR_IDENTITY_SLOT_WIDTH_PX + (headerDragRegion ? MACOS_TRAFFIC_LIGHT_INSET : 0);
  const sidebarHandleCenterline = "var(--freed-sidebar-handle-centerline, 264px)";
  const boundaryButtonOffsetPx = TOOLBAR_ICON_BUTTON_SIZE_PX + TOOLBAR_BOUNDARY_BUTTON_GAP_PX / 2;
  const leadingToolbarSlotWidth =
    !isMobileDevice
      ? `max(${px(minimumToolbarIdentitySlotWidthPx)}, calc(${sidebarHandleCenterline} + ${px(
          TOOLBAR_ICON_BUTTON_SIZE_PX + TOOLBAR_BOUNDARY_BUTTON_GAP_PX / 2 + TOOLBAR_SIDEBAR_SLOT_PADDING_RIGHT_PX,
        )}))`
      : undefined;
  const leftToolbarStyle = !isMobileDevice
    ? ({
        position: "relative",
        width: leadingToolbarSlotWidth,
        minWidth: leadingToolbarSlotWidth,
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
  const boundaryButtonCommonStyle = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
  } as CSSProperties;
  const collapseButtonStyle = {
    ...boundaryButtonCommonStyle,
    left: `calc(${sidebarHandleCenterline} - ${px(boundaryButtonOffsetPx + TOOLBAR_SIDEBAR_SLOT_PADDING_RIGHT_PX)})`,
  } as CSSProperties;
  const readerRailButtonStyle = {
    ...boundaryButtonCommonStyle,
    left: `calc(${sidebarHandleCenterline} + ${px(TOOLBAR_BOUNDARY_BUTTON_GAP_PX / 2 - TOOLBAR_SIDEBAR_SLOT_PADDING_RIGHT_PX)})`,
  } as CSSProperties;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [savedContentOpen, setSavedContentOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const leftToolbarSlotRef = useRef<HTMLDivElement | null>(null);
  const wordmarkRef = useRef<HTMLSpanElement | null>(null);
  const toolbarSearchInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarDragGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    target: HTMLElement;
  } | null>(null);
  const suppressedToolbarClickRef = useRef<EventTarget | null>(null);
  const suppressedToolbarClickTimeoutRef = useRef<number | null>(null);
  const [minimumBoundaryButtonLeftPx, setMinimumBoundaryButtonLeftPx] = useState(
    minimumToolbarIdentitySlotWidthPx,
  );

  useEffect(() => {
    const slotElement = leftToolbarSlotRef.current;
    const wordmarkElement = wordmarkRef.current;
    if (!slotElement || !wordmarkElement) return;

    const updateBoundaryButtonClamp = () => {
      const slotRect = slotElement.getBoundingClientRect();
      const wordmarkRect = wordmarkElement.getBoundingClientRect();
      const minimumLeft = Math.max(
        0,
        Math.ceil(wordmarkRect.right - slotRect.left + TOOLBAR_BOUNDARY_BUTTON_GAP_PX * 2),
      );
      setMinimumBoundaryButtonLeftPx(minimumLeft);
    };

    updateBoundaryButtonClamp();

    const observer = new ResizeObserver(() => {
      updateBoundaryButtonClamp();
    });

    observer.observe(slotElement);
    observer.observe(wordmarkElement);
    window.addEventListener("resize", updateBoundaryButtonClamp);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBoundaryButtonClamp);
    };
  }, [minimumToolbarIdentitySlotWidthPx]);

  const clampedCollapseButtonStyle = {
    ...collapseButtonStyle,
    left: `max(${px(minimumBoundaryButtonLeftPx)}, ${collapseButtonStyle.left})`,
  } as CSSProperties;

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
    if (!showToolbarSearch) return;
    toolbarSearchInputRef.current?.focus();
    toolbarSearchInputRef.current?.setSelectionRange(searchQuery.length, searchQuery.length);
  }, [showToolbarSearch]);

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
        className={`sticky top-0 z-30 flex-shrink-0 ${
          headerDragRegion ? "" : "theme-attached-topbar-host pt-[env(safe-area-inset-top)]"
        }`}
      >
        <div
          data-testid="workspace-toolbar"
          className={`theme-floating-panel theme-attached-topbar flex min-h-[58px] items-center px-0 ${showReaderLayoutToggle ? "gap-0" : "gap-3"}`}
          {...(headerDragRegion
            ? {
                "data-tauri-drag-region": true,
                style: dragStyle,
              }
            : {})}
        >
          <div
            className={`theme-toolbar-cluster theme-toolbar-cluster-tight flex shrink-0 items-center ${showReaderLayoutToggle ? "gap-0" : "gap-2"}`}
          >
            <div
              className="relative flex h-full shrink-0 items-center"
              ref={leftToolbarSlotRef}
              style={leftToolbarStyle}
            >
              {isMobileDevice ? (
              <Tooltip label="Menu">
                <button
                  onClick={onMobileMenuToggle}
                  {...getToolbarControlProps()}
                  className={`${TOOLBAR_ICON_BUTTON_CLASS} ${
                    mobileSidebarOpen ? "theme-toolbar-button-active" : "theme-toolbar-button-neutral"
                  }`}
                  aria-label={mobileSidebarOpen ? "Close menu" : "Open menu"}
                  aria-pressed={mobileSidebarOpen}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
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
              <Tooltip
                label={visibleDesktopSidebarMode === "closed" ? "Expand sidebar" : "Collapse sidebar"}
                className="absolute"
                triggerStyle={clampedCollapseButtonStyle}
              >
                <button
                  onClick={onDesktopSidebarToggle}
                  {...getToolbarControlProps()}
                  data-testid="desktop-sidebar-toggle"
                  className={`${TOOLBAR_ICON_BUTTON_CLASS} theme-toolbar-button-neutral`}
                  aria-label={visibleDesktopSidebarMode === "closed" ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {visibleDesktopSidebarMode === "closed" ? (
                    <SidebarExpandIcon className="h-5 w-5" />
                  ) : (
                    <SidebarCollapseIcon className="h-5 w-5" />
                  )}
                </button>
              </Tooltip>
              ) : null}

              {showReaderLayoutToggle ? (
                <Tooltip
                  label={display.reading.dualColumnMode ? "Hide thumbnail rail" : "Show thumbnail rail"}
                  className="absolute"
                  triggerStyle={readerRailButtonStyle}
                >
                  <button
                    onClick={handleToggleDualColumn}
                    {...getToolbarControlProps()}
                    className={`${TOOLBAR_ICON_BUTTON_CLASS} ${
                      display.reading.dualColumnMode
                        ? "theme-toolbar-button-active"
                        : "theme-toolbar-button-neutral"
                    }`}
                    aria-pressed={display.reading.dualColumnMode}
                    aria-label={display.reading.dualColumnMode ? "Hide thumbnail rail" : "Show thumbnail rail"}
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
          </div>

          <div
            className="min-w-0 flex-1"
            {...(headerDragRegion ? { "data-tauri-drag-region": true, style: dragStyle } : {})}
          >
            {selectedItem ? (
              <button
                onClick={handleCloseReader}
                {...getToolbarControlProps()}
                data-testid="workspace-toolbar-reader-back"
                className="group flex w-full min-w-0 items-center gap-1 rounded-xl pl-0.5 pr-1.5 py-1.5 text-left transition-colors hover:bg-[var(--theme-bg-muted)]"
                aria-label="Back to list"
              >
                <span className="pointer-events-none flex shrink-0 items-center rounded-xl p-1.5">
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
                  <p className="truncate text-sm font-medium text-[var(--theme-text-primary)]">{currentTitle}</p>
                  <p className="truncate text-xs text-[var(--theme-text-muted)]">{currentSubtitle}</p>
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
                <p className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">{currentTitle}</p>
                <p className="truncate text-xs text-[var(--theme-text-muted)]">{currentSubtitle}</p>
              </div>
            )}
          </div>

          <div
            className="theme-toolbar-cluster theme-toolbar-cluster-tight flex shrink-0 items-center pr-2 sm:pr-2.5"
          >
            {selectedItem ? (
              <>
                <ToolbarAnimatedSlot visible={!isMobile} width="5.25rem" className="hidden lg:flex">
                  <Tooltip label={display.reading.focusMode ? "Disable focus mode" : "Enable focus mode"}>
                    <button
                      onClick={handleToggleFocusMode}
                      {...getToolbarControlProps()}
                      className={`rounded-lg px-2.5 py-2 text-sm font-bold lg:inline-flex ${
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
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={true} width="2.5rem">
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
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={true} width="2.5rem">
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
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={!!selectedItem.sourceUrl} width="4.5rem">
                  {selectedItem.sourceUrl ? (
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
                  ) : null}
                </ToolbarAnimatedSlot>
              </>
            ) : (
              <>
                <ToolbarAnimatedSlot visible={!!HeaderSyncIndicator} width="4.5rem" className="hidden md:flex">
                  {HeaderSyncIndicator ? (
                    <div className="hidden md:flex">
                      <HeaderSyncIndicator />
                    </div>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot
                  visible={showWorkspaceIdentityControls}
                  width={activeView === "friends" && isMobile ? "13.75rem" : "12rem"}
                >
                  {showWorkspaceIdentityControls ? (
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

                <ToolbarAnimatedSlot visible={showMapTimeControls} width="14rem">
                  {showMapTimeControls ? (
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

                <ToolbarAnimatedSlot visible={showArchivedToolbar} width="11rem" className="hidden xl:flex">
                  {showArchivedToolbar ? (
                    <span className="text-xs text-[var(--theme-text-muted)]">
                      {getRetentionLabel(display.archivePruneDays ?? 30)}
                    </span>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot
                  visible={showArchivedToolbar && savedArchivedCount > 0}
                  width="11rem"
                  className="hidden lg:flex"
                >
                  {showArchivedToolbar && savedArchivedCount > 0 ? (
                    <button
                      onClick={handleUnarchiveSavedClick}
                      {...getToolbarControlProps()}
                      className="theme-toolbar-button-ghost rounded-lg px-3 py-1.5 text-sm"
                    >
                      Unarchive saved
                    </button>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={showArchivedDeleteAction} width="11rem" className="hidden lg:flex">
                  {showArchivedDeleteAction ? (
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

                <ToolbarAnimatedSlot visible={showFeedBulkActions && unreadCount > 0} width="9.5rem" className="hidden lg:flex">
                  {showFeedBulkActions && unreadCount > 0 ? (
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

                <ToolbarAnimatedSlot visible={showFeedBulkActions && archivableCount > 0} width="8rem" className="hidden lg:flex">
                  {showFeedBulkActions && archivableCount > 0 ? (
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

                <ToolbarAnimatedSlot visible={showFriendsSidebarToggle} width="3rem" className="hidden md:flex">
                  {showFriendsSidebarToggle ? (
                    <Tooltip label={friendsSidebarOpen ? "Hide details" : "Show details"}>
                      <button
                        onClick={onFriendsSidebarToggle}
                        {...getToolbarControlProps()}
                        data-testid="friends-sidebar-toggle"
                        className={`rounded-lg p-2 ${
                          friendsSidebarOpen
                            ? "theme-toolbar-button-active"
                            : "theme-toolbar-button-neutral"
                        }`}
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

              </>
            )}
          </div>
        </div>
      </header>

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
                    setAddFeedOpen(true);
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
                    setSavedContentOpen(true);
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

      <AddFeedDialog open={addFeedOpen} onClose={() => setAddFeedOpen(false)} />
      <SavedContentDialog
        open={savedContentOpen}
        onClose={() => setSavedContentOpen(false)}
      />
    </>
  );
}
