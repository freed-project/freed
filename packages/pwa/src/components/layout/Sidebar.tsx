import { useState, useMemo, useCallback, useRef } from "react";
import { useAppStore, usePlatform } from "../../context/PlatformContext";
import { SettingsPanel } from "../SettingsPanel";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;

const topSources = [
  { id: undefined, label: "All", icon: "🌊" },
  { id: "x", label: "X", icon: "𝕏" },
  { id: "rss", label: "RSS", icon: "📡" },
  { id: "saved", label: "Saved", icon: "📌", savedOnly: true },
];

const comingSoonSources = [
  { id: "facebook", label: "Facebook", icon: "📘" },
  { id: "instagram", label: "Instagram", icon: "📷" },
  { id: "map", label: "Map", icon: "🗺️" },
];

export function Sidebar({ open, onClose }: SidebarProps) {
  const { SidebarConnectionSection, SourceIndicator } = usePlatform();
  const activeFilter = useAppStore((s) => s.activeFilter);
  const setFilter = useAppStore((s) => s.setFilter);
  const feeds = useAppStore((s) => s.feeds);
  const items = useAppStore((s) => s.items);
  const sidebarWidth = useAppStore((s) => s.preferences.display.sidebarWidth) ?? DEFAULT_WIDTH;
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const [showSettings, setShowSettings] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragging = useRef(false);

  const width = dragWidth ?? sidebarWidth;

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startW = width;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + ev.clientX - startX));
        setDragWidth(next);
      };
      const onUp = (ev: MouseEvent) => {
        dragging.current = false;
        const final = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + ev.clientX - startX));
        setDragWidth(null);
        updatePreferences({ display: { sidebarWidth: final } } as Parameters<typeof updatePreferences>[0]);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [width, updatePreferences],
  );

  const feedUnreadCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      if (!item.rssSource) continue;
      if (
        item.userState.readAt ||
        item.userState.hidden ||
        item.userState.archived
      )
        continue;
      const url = item.rssSource.feedUrl;
      counts[url] = (counts[url] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  const feedList = Object.values(feeds).filter((f) => f.enabled);

  const handleSourceClick = (source: (typeof topSources)[0]) => {
    if (source.savedOnly) {
      setFilter({ savedOnly: true });
    } else {
      setFilter({ platform: source.id });
    }
    onClose();
  };

  const handleFeedClick = (feedUrl: string) => {
    setFilter({ platform: "rss", feedUrl });
    onClose();
  };

  const isTopSourceActive = (source: (typeof topSources)[0]) => {
    if (activeFilter.feedUrl) return false;
    if (activeFilter.showArchived) return false;
    if (source.savedOnly) return activeFilter.savedOnly === true;
    return activeFilter.platform === source.id && !activeFilter.savedOnly;
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed md:relative z-50 md:z-auto
          h-full
          bg-[#0a0a0a]/95 md:bg-[#0f0f0f]/80 backdrop-blur-xl
          border-r border-[rgba(255,255,255,0.08)]
          transform transition-transform duration-200 ease-in-out
          ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          flex flex-col min-h-0
        `}
        style={{ width: `${width}px` }}
      >
        {/* Mobile header with close button */}
        <div className="md:hidden flex items-center justify-between p-4 border-b border-[rgba(255,255,255,0.08)] shrink-0">
          <span className="text-lg font-bold gradient-text">FREED</span>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <nav className="flex-1 min-h-0 flex flex-col p-4 overflow-y-auto">
          {SidebarConnectionSection && <SidebarConnectionSection />}

          {/* Sources */}
          <div className="shrink-0 mb-4">
            <h2 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-2 px-3">
              Sources
            </h2>
            <ul className="space-y-1">
              {topSources.map((source) => (
                <li key={source.id ?? "all"}>
                  <button
                    onClick={() => handleSourceClick(source)}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2 rounded-lg
                      text-left text-sm transition-all border
                      ${
                        isTopSourceActive(source)
                          ? "bg-[#8b5cf6]/20 text-white border-[#8b5cf6]/30"
                          : "border-transparent text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                      }
                    `}
                  >
                    <span className="w-5 text-center">{source.icon}</span>
                    <span className="flex-1">{source.label}</span>
                    {SourceIndicator && (
                      <SourceIndicator sourceId={source.id ?? "all"} />
                    )}
                  </button>
                </li>
              ))}
              {comingSoonSources.map((source) => (
                <li key={source.id}>
                  <div className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[#52525b] cursor-default">
                    <span className="w-5 text-center opacity-50">{source.icon}</span>
                    <span className="flex-1">{source.label}</span>
                    <span className="text-[10px] uppercase tracking-wider bg-white/5 px-1.5 py-0.5 rounded">
                      soon
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Feeds */}
          {feedList.length > 0 && (
            <div className="shrink-0 mb-4">
              <h2 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-2 px-3">
                Feeds
              </h2>
              <ul className="space-y-0.5 overflow-y-auto max-h-[40vh]">
                {feedList.map((feed) => {
                  const unread = feedUnreadCounts[feed.url] ?? 0;
                  const isActive = activeFilter.feedUrl === feed.url;
                  return (
                    <li key={feed.url}>
                      <button
                        onClick={() => handleFeedClick(feed.url)}
                        className={`
                          w-full flex items-center gap-2 px-3 py-2 rounded-lg
                          text-left text-sm transition-all border
                          ${
                            isActive
                              ? "bg-[#8b5cf6]/20 text-white border-[#8b5cf6]/30"
                              : "border-transparent text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                          }
                        `}
                      >
                        {feed.imageUrl ? (
                          <img
                            src={feed.imageUrl}
                            alt=""
                            className="w-4 h-4 rounded-sm shrink-0 object-cover"
                          />
                        ) : (
                          <span className="w-4 h-4 shrink-0 flex items-center justify-center text-[10px] text-[#52525b]">
                            📡
                          </span>
                        )}
                        <span className="flex-1 truncate text-xs">
                          {feed.title}
                        </span>
                        {unread > 0 && (
                          <span className="shrink-0 text-[10px] tabular-nums bg-[#8b5cf6]/20 text-[#8b5cf6] px-1.5 py-0.5 rounded-full">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Library */}
          <div className="shrink-0 mb-4">
            <h2 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-2 px-3">
              Library
            </h2>
            <ul className="space-y-1">
              <li>
                <button
                  onClick={() => {
                    setFilter({ showArchived: true });
                    onClose();
                  }}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-lg
                    text-left text-sm transition-all border
                    ${
                      activeFilter.showArchived
                        ? "bg-[#8b5cf6]/20 text-white border-[#8b5cf6]/30"
                        : "border-transparent text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                    }
                  `}
                >
                  <span className="w-5 text-center">📦</span>
                  <span>Archived</span>
                </button>
              </li>
            </ul>
          </div>

          {/* Settings — pushed to bottom */}
          <div className="mt-auto shrink-0">
            <button
              onClick={() => setShowSettings(true)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-[#a1a1aa] hover:bg-white/5 hover:text-white transition-all"
            >
              <span className="w-5 text-center">
                <svg
                  className="w-4 h-4 inline"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
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
              </span>
              <span>Settings</span>
            </button>
          </div>
        </nav>

        {/* Resize handle — desktop only */}
        <div
          className="hidden md:block absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[#8b5cf6]/30 active:bg-[#8b5cf6]/50 transition-colors z-10"
          onMouseDown={handleDragStart}
        />
      </aside>

      <SettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </>
  );
}
