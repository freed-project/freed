import { useState, useEffect, useRef, useMemo } from "react";
import { AddFeedDialog } from "../AddFeedDialog.js";
import { SavedContentDialog } from "../SavedContentDialog.js";
import { Tooltip } from "../Tooltip.js";
import {
  useAppStore,
  usePlatform,
  MACOS_TRAFFIC_LIGHT_INSET,
} from "../../context/PlatformContext.js";
import { useSettingsStore } from "../../lib/settings-store.js";
import {
  BASE_SECTION_METAS,
  UPDATES_SECTION_META,
  DANGER_SECTION_META,
  X_SECTION_META,
  FB_SECTION_META,
  IG_SECTION_META,
  LI_SECTION_META,
  type SectionMeta,
} from "../../lib/settings-sections.js";

interface HeaderProps {
  onMenuClick: () => void;
}

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
const dragStyle = { WebkitAppRegion: "drag" } as React.CSSProperties;

// ── Command palette action type ───────────────────────────────────────────────
// Foundation for a full in-app action launcher. Currently populated with
// settings navigation actions. Future categories: navigation, feeds, content.

interface CommandAction {
  id: string;
  /** Short human-readable label shown in the palette row. */
  label: string;
  /** Right-aligned breadcrumb hint, e.g. "Settings". */
  hint: string;
  /** Lowercase strings matched against the search query. */
  keywords: string[];
  onSelect: () => void;
}

function buildSettingsActions(
  sections: readonly SectionMeta[],
  openTo: (id: string) => void,
): CommandAction[] {
  return sections.map((s) => ({
    id: `settings-${s.id}`,
    label: s.label,
    hint: "Settings",
    keywords: s.keywords,
    onSelect: () => openTo(s.id),
  }));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Header({ onMenuClick }: HeaderProps) {
  const {
    HeaderSyncIndicator,
    headerDragRegion,
    addRssFeed,
    saveUrl,
    importMarkdown,
    exportMarkdown,
    checkForUpdates,
    factoryReset,
    XSettingsContent,
    FacebookSettingsContent,
    InstagramSettingsContent,
    LinkedInSettingsContent,
  } = usePlatform();

  const openSettingsTo = useSettingsStore((s) => s.openTo);

  const canAddRss = !!addRssFeed;
  const canSaveContent = !!(saveUrl || importMarkdown || exportMarkdown);
  const showNewButton = canAddRss || canSaveContent;

  const markAllAsRead = useAppStore((s) => s.markAllAsRead);
  const archiveAllReadUnsaved = useAppStore((s) => s.archiveAllReadUnsaved);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const totalUnreadCount = useAppStore((s) => s.totalUnreadCount);
  const unreadCountByPlatform = useAppStore((s) => s.unreadCountByPlatform);
  const totalArchivableCount = useAppStore((s) => s.totalArchivableCount);
  const archivableCountByPlatform = useAppStore(
    (s) => s.archivableCountByPlatform,
  );
  const archivableFeedCounts = useAppStore((s) => s.archivableFeedCounts);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);

  // inputValue drives the visible input; searchQuery in the store is debounced
  // so MiniSearch isn't invoked on every keystroke.
  const [inputValue, setInputValue] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setSearchQuery(inputValue);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, setSearchQuery]);

  function clearSearch() {
    setInputValue("");
    setSearchQuery("");
  }

  // Derive display count from pre-computed store values — no items iteration.
  // savedOnly and archivedOnly views don't show these actions.
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

  // ── + New dropdown ─────────────────────────────────────────────────────────

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [savedContentOpen, setSavedContentOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // ── Command palette ────────────────────────────────────────────────────────

  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // All available command actions. Currently settings navigation only;
  // future versions will include feed subscription, navigation, and more.
  const allCommandActions = useMemo((): CommandAction[] => {
    const sections: SectionMeta[] = [
      ...BASE_SECTION_METAS,
      ...(XSettingsContent ? [X_SECTION_META] : []),
      ...(FacebookSettingsContent ? [FB_SECTION_META] : []),
      ...(InstagramSettingsContent ? [IG_SECTION_META] : []),
      ...(LinkedInSettingsContent ? [LI_SECTION_META] : []),
      ...(checkForUpdates ? [UPDATES_SECTION_META] : []),
      ...(factoryReset ? [DANGER_SECTION_META] : []),
    ];
    return buildSettingsActions(sections, openSettingsTo);
  }, [
    checkForUpdates,
    factoryReset,
    XSettingsContent,
    FacebookSettingsContent,
    InstagramSettingsContent,
    LinkedInSettingsContent,
    openSettingsTo,
  ]);

  const filteredActions = useMemo(() => {
    const q = inputValue.toLowerCase().trim();
    if (!q) return allCommandActions;
    return allCommandActions
      .filter(
        (a) =>
          a.label.toLowerCase().includes(q) ||
          a.keywords.some((k) => k.includes(q)),
      )
      .slice(0, 6);
  }, [inputValue, allCommandActions]);

  // Reset keyboard selection whenever the filtered list changes.
  useEffect(() => {
    setActiveIndex(-1);
  }, [inputValue]);

  const showPalette = isFocused && filteredActions.length > 0;

  function handleActionSelect(action: CommandAction) {
    setIsFocused(false);
    setActiveIndex(-1);
    action.onSelect();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      // First Escape collapses the palette; second clears the query and blurs.
      if (showPalette) {
        setIsFocused(false);
        setActiveIndex(-1);
      } else {
        clearSearch();
        e.currentTarget.blur();
      }
      return;
    }

    if (!showPalette) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filteredActions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? filteredActions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      const action = filteredActions[activeIndex];
      if (action) handleActionSelect(action);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <header
        className={`sticky top-0 flex-shrink-0 bg-[#0a0a0a] z-30 border-b border-[rgba(255,255,255,0.08)] ${
          headerDragRegion ? "" : "pt-[env(safe-area-inset-top)]"
        } px-1`}
        {...(headerDragRegion
          ? {
              "data-tauri-drag-region": true,
              style: { WebkitAppRegion: "drag" } as React.CSSProperties,
            }
          : {})}
      >
        <div
          className="h-[55px] flex items-center pl-3 pr-1 gap-6"
          style={
            headerDragRegion
              ? ({
                  paddingLeft: MACOS_TRAFFIC_LIGHT_INSET,
                  WebkitAppRegion: "drag",
                } as React.CSSProperties)
              : undefined
          }
          {...(headerDragRegion ? { "data-tauri-drag-region": true } : {})}
        >
          {/* Mobile menu button */}
          <Tooltip label="Menu" className="md:hidden">
            <button
              onClick={onMenuClick}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
              aria-label="Open menu"
              style={headerDragRegion ? noDrag : undefined}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </Tooltip>

          {/* FREED logo */}
          <div
            className="flex items-center flex-shrink-0"
            style={headerDragRegion ? noDrag : undefined}
          >
            <span className="text-lg font-bold gradient-text font-logo">
              FREED
            </span>
          </div>

          {/* Search / command bar — fills all remaining center space */}
          <div
            className="flex flex-1 items-center justify-center min-w-0 ml-2"
            {...(headerDragRegion
              ? { "data-tauri-drag-region": true, style: dragStyle }
              : {})}
          >
            <div
              className="relative w-full"
              style={headerDragRegion ? noDrag : undefined}
            >
              {/* Search icon */}
              <svg
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#3f3f46]"
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

              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => {
                  // Delay so onMouseDown on palette items fires first.
                  setTimeout(() => setIsFocused(false), 150);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search or jump to..."
                aria-label="Search or run a command"
                aria-expanded={showPalette}
                aria-haspopup="listbox"
                className="w-full bg-transparent border border-white/[0.06] rounded-lg pl-8 pr-7 py-1.5 text-sm text-white/70 placeholder-transparent sm:placeholder-[#3f3f46] focus:outline-none hover:border-white/[0.11] hover:bg-white/[0.02] focus:border-white/[0.16] focus:bg-white/[0.04] transition-colors"
              />

              {/* Clear button — only visible when there's input */}
              {inputValue && (
                <button
                  onClick={clearSearch}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10 transition-colors"
                >
                  <svg
                    className="w-3 h-3 text-[#52525b]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}

              {/* Command palette dropdown — desktop only; quick actions aren't useful on mobile */}
              {showPalette && (
                <div
                  role="listbox"
                  aria-label="Quick actions"
                  className="hidden sm:block absolute left-0 right-0 top-full mt-1.5 bg-[#161616] border border-[rgba(255,255,255,0.1)] rounded-xl shadow-2xl shadow-black/70 overflow-hidden z-50 py-1"
                >
                  {!inputValue && (
                    <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold text-[#3f3f46] uppercase tracking-wider">
                      Quick actions
                    </p>
                  )}
                  {filteredActions.map((action, i) => (
                    <button
                      key={action.id}
                      role="option"
                      aria-selected={i === activeIndex}
                      // preventDefault stops the input from losing focus before onClick fires.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleActionSelect(action)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                        i === activeIndex
                          ? "bg-white/[0.06] text-white"
                          : "text-[#a1a1aa] hover:bg-white/[0.04] hover:text-white"
                      }`}
                    >
                      <svg
                        className="w-3.5 h-3.5 text-[#52525b] shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      <span className="flex-1 truncate">{action.label}</span>
                      <span className="text-xs text-[#3f3f46] shrink-0">
                        {action.hint}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div
            className="flex items-center gap-2 flex-shrink-0 ml-[-6px]"
            style={headerDragRegion ? noDrag : undefined}
          >
            {HeaderSyncIndicator && <HeaderSyncIndicator />}

            {unreadCount > 0 && (
              <Tooltip label={`Mark all ${unreadCount.toLocaleString()} items as read`} className="hidden sm:flex">
                <button
                  onClick={() => markAllAsRead(activeFilter.platform)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[#71717a] hover:bg-white/5 hover:text-white transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>{unreadCount.toLocaleString()} unread</span>
                </button>
              </Tooltip>
            )}

            {archivableCount > 0 && (
              <Tooltip label={`Archive all ${archivableCount.toLocaleString()} read items`} className="hidden sm:flex">
                <button
                  onClick={() =>
                    archiveAllReadUnsaved(
                      activeFilter.platform,
                      activeFilter.feedUrl,
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[#71717a] hover:bg-white/5 hover:text-white transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>{archivableCount.toLocaleString()} read</span>
                </button>
              </Tooltip>
            )}

            {/* + New dropdown */}
            {showNewButton && (
              <div ref={dropdownRef} className="relative">
                <Tooltip label="Add new content">
                  <button
                    onClick={() => setDropdownOpen((v) => !v)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors"
                    aria-haspopup="true"
                    aria-expanded={dropdownOpen}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    <span className="text-sm font-medium hidden sm:inline">
                      New
                    </span>
                    <svg
                      className={`w-3 h-3 transition-transform hidden sm:block ${dropdownOpen ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                </Tooltip>

                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-44 bg-[#161616] border border-[rgba(255,255,255,0.1)] rounded-xl shadow-2xl shadow-black/70 overflow-hidden z-50 py-1">
                    {canAddRss && (
                      <button
                        onClick={() => {
                          setDropdownOpen(false);
                          setAddFeedOpen(true);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-[#a1a1aa] hover:bg-white/5 hover:text-white transition-colors text-left"
                      >
                        <svg
                          className="w-4 h-4 text-orange-400 shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7M6 17a1 1 0 110 2 1 1 0 010-2z"
                          />
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
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-[#a1a1aa] hover:bg-white/5 hover:text-white transition-colors text-left"
                      >
                        <svg
                          className="w-4 h-4 text-[#8b5cf6] shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                          />
                        </svg>
                        Saved Content
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <AddFeedDialog open={addFeedOpen} onClose={() => setAddFeedOpen(false)} />
      <SavedContentDialog
        open={savedContentOpen}
        onClose={() => setSavedContentOpen(false)}
      />
    </>
  );
}
