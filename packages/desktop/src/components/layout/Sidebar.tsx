import { useState, useMemo } from "react";
import { useAppStore } from "../../lib/store";
import { connectX, loadStoredCookies, disconnectX } from "../../lib/x-auth";
import { captureXTimeline } from "../../lib/x-capture";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

const topSources = [
  { id: undefined, label: "All", icon: "🌊" },
  { id: "x", label: "X", icon: "𝕏" },
  { id: "rss", label: "RSS", icon: "📡" },
  { id: "saved", label: "Saved", icon: "📌", savedOnly: true },
];

export function Sidebar({ open, onClose, onOpenSettings }: SidebarProps) {
  const activeFilter = useAppStore((s) => s.activeFilter);
  const setFilter = useAppStore((s) => s.setFilter);
  const xAuth = useAppStore((s) => s.xAuth);
  const setXAuth = useAppStore((s) => s.setXAuth);
  const isLoading = useAppStore((s) => s.isLoading);
  const feeds = useAppStore((s) => s.feeds);
  const items = useAppStore((s) => s.items);
  const [xSyncing, setXSyncing] = useState(false);
  const [showXForm, setShowXForm] = useState(false);
  const [xCt0, setXCt0] = useState("");
  const [xAuthToken, setXAuthToken] = useState("");
  const [xFormError, setXFormError] = useState("");

  // Per-feed unread counts
  const feedUnreadCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      if (!item.rssSource) continue;
      if (item.userState.readAt || item.userState.hidden || item.userState.archived) continue;
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
    if (source.savedOnly) return activeFilter.savedOnly === true;
    return activeFilter.platform === source.id && !activeFilter.savedOnly;
  };

  const handleConnectX = async () => {
    setXFormError("");
    const cookies = connectX(xCt0, xAuthToken);
    if (!cookies) {
      setXFormError("Both ct0 and auth_token are required.");
      return;
    }
    setXAuth({ isAuthenticated: true, cookies });
    setShowXForm(false);
    setXCt0("");
    setXAuthToken("");
    // Immediately capture timeline after connecting
    setXSyncing(true);
    try {
      await captureXTimeline(cookies);
    } catch (error) {
      console.error("Failed to capture X timeline:", error);
    } finally {
      setXSyncing(false);
    }
  };

  const handleSyncX = async () => {
    const cookies = loadStoredCookies();
    if (!cookies) return;

    setXSyncing(true);
    try {
      await captureXTimeline(cookies);
    } catch (error) {
      console.error("Failed to capture X timeline:", error);
    } finally {
      setXSyncing(false);
    }
  };

  const handleDisconnectX = () => {
    disconnectX();
    setXAuth({ isAuthenticated: false });
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed md:relative z-50 md:z-auto
          w-60 h-full
          bg-glass-sidebar backdrop-blur-xl
          border-r border-glass-border
          transform transition-transform duration-200 ease-in-out
          ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          overflow-y-auto
        `}
      >
        <nav className="p-4 pt-2">
          {/* Sources */}
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-white/35 uppercase tracking-wider mb-2">
              Sources
            </h2>
            <ul className="space-y-1">
              {topSources.map((source) => (
                <li key={source.id ?? "all"}>
                  <button
                    onClick={() => handleSourceClick(source)}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2 rounded-lg
                      text-left text-sm transition-all
                      ${
                        isTopSourceActive(source)
                          ? "bg-[#8b5cf6]/20 text-white border border-[#8b5cf6]/30"
                          : "text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                      }
                    `}
                  >
                    <span className="w-5 text-center shrink-0">
                      {source.icon}
                    </span>
                    <span className="flex-1">{source.label}</span>
                    {source.id === "x" && xAuth.isAuthenticated && (
                      <span className="ml-auto w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Individual RSS feeds */}
          {feedList.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xs font-semibold text-white/35 uppercase tracking-wider mb-2">
                Feeds
              </h2>
              <ul className="space-y-0.5">
                {feedList.map((feed) => {
                  const unread = feedUnreadCounts[feed.url] ?? 0;
                  const isActive = activeFilter.feedUrl === feed.url;
                  return (
                    <li key={feed.url}>
                      <button
                        onClick={() => handleFeedClick(feed.url)}
                        className={`
                          w-full flex items-center gap-2 px-3 py-1.5 rounded-lg
                          text-left text-sm transition-all
                          ${
                            isActive
                              ? "bg-[#8b5cf6]/20 text-white border border-[#8b5cf6]/30"
                              : "text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                          }
                        `}
                      >
                        {feed.imageUrl ? (
                          <img
                            src={feed.imageUrl}
                            alt=""
                            className="w-3.5 h-3.5 rounded-sm flex-shrink-0 object-cover"
                          />
                        ) : (
                          <span className="w-3.5 h-3.5 flex-shrink-0 text-[10px] text-[#52525b] flex items-center justify-center">
                            📡
                          </span>
                        )}
                        <span className="flex-1 truncate text-xs">{feed.title}</span>
                        {unread > 0 && (
                          <span className="flex-shrink-0 text-[10px] tabular-nums bg-[#8b5cf6]/20 text-[#8b5cf6] px-1.5 py-0.5 rounded-full">
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

          {/* X Connection */}
          <div className="mb-6 p-3 rounded-xl bg-white/5 border border-[rgba(255,255,255,0.08)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">X / Twitter</span>
              {xAuth.isAuthenticated ? (
                <span className="text-xs text-green-400">Connected</span>
              ) : (
                <span className="text-xs text-[#71717a]">Not connected</span>
              )}
            </div>
            {xAuth.isAuthenticated ? (
              <div className="flex gap-2">
                <button
                  onClick={handleSyncX}
                  disabled={xSyncing || isLoading}
                  className="flex-1 text-xs px-2 py-1.5 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 disabled:opacity-50 transition-colors"
                >
                  {xSyncing ? "Syncing..." : "Sync Now"}
                </button>
                <button
                  onClick={handleDisconnectX}
                  className="text-xs px-2 py-1.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : showXForm ? (
              <div className="space-y-2">
                <p className="text-[10px] text-[#71717a] leading-relaxed">
                  Open x.com → DevTools → Application → Cookies → x.com
                </p>
                <input
                  type="text"
                  placeholder="ct0 cookie value"
                  value={xCt0}
                  onChange={(e) => setXCt0(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 bg-white/5 border border-[rgba(255,255,255,0.1)] rounded-lg text-white placeholder-[#52525b] focus:outline-none focus:border-[#8b5cf6]/50"
                />
                <input
                  type="text"
                  placeholder="auth_token cookie value"
                  value={xAuthToken}
                  onChange={(e) => setXAuthToken(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 bg-white/5 border border-[rgba(255,255,255,0.1)] rounded-lg text-white placeholder-[#52525b] focus:outline-none focus:border-[#8b5cf6]/50"
                />
                {xFormError && (
                  <p className="text-[10px] text-red-400">{xFormError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleConnectX}
                    className="flex-1 text-xs px-2 py-1.5 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 transition-colors"
                  >
                    Connect
                  </button>
                  <button
                    onClick={() => { setShowXForm(false); setXFormError(""); }}
                    className="text-xs px-2 py-1.5 bg-white/5 text-[#71717a] rounded-lg hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowXForm(true)}
                className="w-full text-xs px-2 py-1.5 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 transition-colors"
              >
                Connect X Account
              </button>
            )}
          </div>

          {/* Library */}
          <div>
            <h2 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-2">
              Library
            </h2>
            <ul className="space-y-1">
              <li>
                <button
                  onClick={() => setFilter({ showArchived: true })}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-lg
                    text-left text-sm transition-colors
                    ${
                      activeFilter.showArchived
                        ? "bg-[#8b5cf6]/20 text-white border border-[#8b5cf6]/30"
                        : "text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                    }
                  `}
                >
                  <span className="w-5 text-center shrink-0">📦</span>
                  <span>Archived</span>
                </button>
              </li>
            </ul>
          </div>

          {/* Settings */}
          <div className="mt-6 pt-6 border-t border-[rgba(255,255,255,0.08)]">
            <button
              onClick={onOpenSettings}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-[#a1a1aa] hover:bg-white/5 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Settings</span>
            </button>
          </div>
        </nav>
      </aside>
    </>
  );
}
