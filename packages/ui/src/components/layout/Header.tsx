import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  countAuthorsWithRecentLocationUpdates,
  countFriendsWithRecentLocationUpdates,
  getDefaultMapMode,
} from "@freed/shared";
import { AddFeedDialog } from "../AddFeedDialog.js";
import { SavedContentDialog } from "../SavedContentDialog.js";
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
import { runFeedLayoutTransition } from "../../lib/view-transitions.js";
import {
  MACOS_TRAFFIC_LIGHT_INSET,
  useAppStore,
  usePlatform,
} from "../../context/PlatformContext.js";
import { getFilterLabel } from "../../lib/feed-view-labels.js";

interface HeaderProps {
  onMenuClick: () => void;
  sidebarExpanded: boolean;
  onSidebarToggle: () => void;
}

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
const dragStyle = { WebkitAppRegion: "drag" } as CSSProperties;
const toolbarControlStyle = { ...noDrag, userSelect: "none" } as CSSProperties;
const TOOLBAR_DRAG_THRESHOLD_PX = 6;

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

export function Header({ onMenuClick, sidebarExpanded, onSidebarToggle }: HeaderProps) {
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
  const toggleSaved = useAppStore((s) => s.toggleSaved);
  const toggleArchived = useAppStore((s) => s.toggleArchived);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const setSelectedItem = useAppStore((s) => s.setSelectedItem);
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
  const effectiveMapMode = display.mapMode
    ?? getDefaultMapMode(mappedFriendCount, mappedAllContentCount);
  const effectiveFriendsMode = display.friendsMode ?? "all_content";
  const showIdentityModeControls = activeView === "feed" || activeView === "map";

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
        return `${friendCount.toLocaleString()} friends • ${pendingMatchCount.toLocaleString()} pending matches`;
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
    filteredItems.length,
    friendCount,
    effectiveMapMode,
    isSearching,
    mappedAllContentCount,
    mappedFriendCount,
    pendingMatchCount,
    resultCount,
    scopeLabel,
    selectedItem,
  ]);

  const handleIdentityModeChange = useCallback((mode: "friends" | "all_content") => {
    void updatePreferences({
      display: {
        ...(activeView === "map" ? { mapMode: mode } : { friendsMode: mode }),
      },
    } as Parameters<typeof updatePreferences>[0]);
  }, [activeView, updatePreferences]);

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

  const handleOpenReaderUrl = useCallback(() => {
    if (!selectedItem?.sourceUrl) return;
    if (openUrl) {
      openUrl(selectedItem.sourceUrl);
      return;
    }
    window.open(selectedItem.sourceUrl, "_blank", "noopener,noreferrer");
  }, [openUrl, selectedItem]);

  const showReaderLayoutToggle =
    !isMobile &&
    !!selectedItem;
  const canManuallyDragToolbarControls = !!(headerDragRegion && startWindowDrag);
  const showReaderRailToolbar =
    showReaderLayoutToggle &&
    display.reading.dualColumnMode;
  const macosTrafficLightInsetStyle = headerDragRegion
    ? ({ paddingLeft: `${MACOS_TRAFFIC_LIGHT_INSET}px` } as CSSProperties)
    : undefined;
  const sidebarSlotStyle =
    !isMobile && sidebarExpanded
      ? ({ width: "calc(var(--freed-sidebar-card-width, 240px) + 16px)", paddingRight: "8px" } as CSSProperties)
      : undefined;
  const leftToolbarStyle = sidebarSlotStyle
    ? {
        ...sidebarSlotStyle,
        ...macosTrafficLightInsetStyle,
        ...(headerDragRegion ? noDrag : {}),
      }
    : headerDragRegion
      ? {
          ...macosTrafficLightInsetStyle,
          ...noDrag,
        }
      : macosTrafficLightInsetStyle;
  const readerRailSlotStyle = showReaderLayoutToggle
    ? ({
        width: showReaderRailToolbar ? "var(--freed-reader-rail-width, 0px)" : "auto",
      } as CSSProperties)
    : undefined;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [savedContentOpen, setSavedContentOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
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
    if (addFeedOpen || savedContentOpen) {
      setDropdownOpen(false);
    }
  }, [addFeedOpen, savedContentOpen]);

  useEffect(() => () => {
    finishToolbarDragGesture();
    clearSuppressedToolbarClick();
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
            className={`theme-toolbar-cluster flex shrink-0 items-center ${showReaderLayoutToggle ? "gap-0" : "gap-2"}`}
          >
            <div
              className={`flex shrink-0 items-center gap-2 pl-3 sm:pl-4 ${sidebarSlotStyle ? "justify-between" : ""}`}
              style={leftToolbarStyle}
            >
              <Tooltip label="Menu" className="md:hidden">
                <button
                  onClick={onMenuClick}
                  {...getToolbarControlProps()}
                  className="rounded-lg p-1.5 transition-colors hover:bg-[var(--theme-bg-muted)]"
                  aria-label="Open menu"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              </Tooltip>

              <span
                data-testid="workspace-toolbar-wordmark"
                className="cursor-default select-none text-lg font-bold gradient-text font-logo"
              >
                FREED
              </span>

              <Tooltip label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"} className="hidden md:flex">
                <button
                  onClick={onSidebarToggle}
                  {...getToolbarControlProps()}
                  data-testid="desktop-sidebar-toggle"
                  className="theme-subtle-button rounded-lg p-1.5 transition-colors hover:bg-[var(--theme-bg-muted)]"
                  aria-label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
                >
                  {sidebarExpanded ? (
                    <SidebarCollapseIcon className="h-5 w-5" />
                  ) : (
                    <SidebarExpandIcon className="h-5 w-5" />
                  )}
                </button>
              </Tooltip>
            </div>

            <ToolbarAnimatedSlot
              visible={showReaderLayoutToggle}
              width={showReaderRailToolbar ? "var(--freed-reader-rail-width, 0px)" : "3rem"}
              className="theme-reader-rail-slot hidden shrink-0 md:flex items-center"
              style={headerDragRegion ? noDrag : undefined}
            >
              <div className="flex items-center" style={readerRailSlotStyle}>
                <Tooltip label={display.reading.dualColumnMode ? "Hide thumbnail rail" : "Show thumbnail rail"}>
                  <button
                    onClick={handleToggleDualColumn}
                    {...getToolbarControlProps()}
                    className="theme-subtle-button rounded-lg p-2 transition-colors hover:bg-[var(--theme-bg-muted)]"
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
              </div>
            </ToolbarAnimatedSlot>
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
                className="group flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--theme-bg-muted)]"
                aria-label="Back to list"
              >
                <span className="pointer-events-none flex shrink-0 items-center rounded-xl p-2">
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
            className="theme-toolbar-cluster flex shrink-0 items-center pr-3 sm:pr-4"
          >
            {selectedItem ? (
              <>
                <ToolbarAnimatedSlot visible={!isMobile} width="5.25rem" className="hidden lg:flex">
                  <Tooltip label={display.reading.focusMode ? "Disable focus mode" : "Enable focus mode"}>
                    <button
                      onClick={handleToggleFocusMode}
                      {...getToolbarControlProps()}
                      className={`rounded-lg px-2.5 py-2 text-sm font-bold transition-colors lg:inline-flex ${
                        display.reading.focusMode
                          ? "theme-accent-button"
                          : "theme-subtle-button hover:bg-[var(--theme-bg-muted)]"
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

                <ToolbarAnimatedSlot visible={true} width="3rem">
                  <Tooltip label={selectedItem.userState.saved ? "Remove bookmark" : "Bookmark"}>
                    <button
                      onClick={handleToggleReaderSaved}
                      {...getToolbarControlProps()}
                      className={`rounded-lg p-2 transition-colors ${
                        selectedItem.userState.saved
                          ? "theme-accent-button"
                          : "theme-subtle-button hover:bg-[var(--theme-bg-muted)]"
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

                <ToolbarAnimatedSlot visible={true} width="3rem">
                  <Tooltip label={selectedItem.userState.archived ? "Unarchive" : "Archive"}>
                    <button
                      onClick={handleToggleReaderArchived}
                      {...getToolbarControlProps()}
                      className={`rounded-lg p-2 transition-colors ${
                        selectedItem.userState.archived
                          ? "theme-status-pill-success hover:bg-[rgb(var(--theme-feedback-success-rgb)/0.18)]"
                          : "theme-subtle-button hover:bg-[var(--theme-bg-muted)]"
                      }`}
                      aria-label={selectedItem.userState.archived ? "Unarchive" : "Archive"}
                    >
                      <ArchiveIcon className="h-5 w-5" />
                    </button>
                  </Tooltip>
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={!!selectedItem.sourceUrl} width="5rem">
                  {selectedItem.sourceUrl ? (
                    <button
                      onClick={handleOpenReaderUrl}
                      {...getToolbarControlProps()}
                      className="theme-subtle-button inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm"
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

                <ToolbarAnimatedSlot visible={showIdentityModeControls} width="10.75rem" className="flex min-w-0">
                  {showIdentityModeControls ? (
                    <div className="flex min-w-0 items-center gap-2 overflow-x-auto py-1">
                      <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[color:var(--theme-border-subtle)] bg-[color:color-mix(in_oklab,var(--theme-bg-surface)_86%,transparent)] p-1">
                        {([
                          ["friends", "Friends"],
                          ["all_content", "All content"],
                        ] as const).map(([mode, label]) => {
                          const isActive = activeView === "map"
                            ? effectiveMapMode === mode
                            : effectiveFriendsMode === mode;

                          return (
                            <button
                              key={`${activeView}-${mode}`}
                              type="button"
                              onClick={() => handleIdentityModeChange(mode)}
                              {...getToolbarControlProps()}
                              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                                isActive ? "theme-chip-active" : "theme-chip"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={unreadCount > 0} width="9.5rem" className="hidden lg:flex">
                  {unreadCount > 0 ? (
                    <Tooltip label={`Mark all ${unreadCount.toLocaleString()} items as read`} className="hidden lg:flex">
                      <button
                        onClick={() => markAllAsRead(activeFilter.platform)}
                        {...getToolbarControlProps()}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{unreadCount.toLocaleString()} unread</span>
                      </button>
                    </Tooltip>
                  ) : null}
                </ToolbarAnimatedSlot>

                <ToolbarAnimatedSlot visible={archivableCount > 0} width="8rem" className="hidden lg:flex">
                  {archivableCount > 0 ? (
                    <Tooltip label={`Archive all ${archivableCount.toLocaleString()} read (unsaved) items`} className="hidden lg:flex">
                      <button
                        onClick={() => archiveAllReadUnsaved(activeFilter.platform, activeFilter.feedUrl)}
                        {...getToolbarControlProps()}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>{archivableCount.toLocaleString()} read</span>
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
