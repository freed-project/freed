import { useState } from "react";
import { useAppStore } from "../../lib/store";
import { openXLogin, loadStoredCookies, disconnectX } from "../../lib/x-auth";
import { captureXTimeline } from "../../lib/x-capture";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

const sources = [
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
  const [xSyncing, setXSyncing] = useState(false);

  const handleSourceClick = (source: (typeof sources)[0]) => {
    if (source.savedOnly) {
      setFilter({ savedOnly: true });
    } else {
      setFilter({ platform: source.id });
    }
    onClose();
  };

  const isActive = (source: (typeof sources)[0]) => {
    if (source.savedOnly) {
      return activeFilter.savedOnly === true;
    }
    return activeFilter.platform === source.id && !activeFilter.savedOnly;
  };

  const handleConnectX = async () => {
    const cookies = await openXLogin();
    if (cookies) {
      setXAuth({ isAuthenticated: true, cookies });
      // Immediately capture timeline after connecting
      setXSyncing(true);
      try {
        await captureXTimeline(cookies);
      } catch (error) {
        console.error("Failed to capture X timeline:", error);
      } finally {
        setXSyncing(false);
      }
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
        `}
      >
        <nav className="p-4 pt-2">
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-white/35 uppercase tracking-wider mb-2">
              Sources
            </h2>
            <ul className="space-y-1">
              {sources.map((source) => (
                <li key={source.id ?? "all"}>
                  <button
                    onClick={() => handleSourceClick(source)}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2 rounded-lg
                      text-left text-sm transition-all
                      ${
                        isActive(source)
                          ? "bg-[#8b5cf6]/20 text-white border border-[#8b5cf6]/30"
                          : "text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                      }
                    `}
                  >
                    <span className="w-5 text-center shrink-0">
                      {source.icon}
                    </span>
                    <span>{source.label}</span>
                    {source.id === "x" && xAuth.isAuthenticated && (
                      <span className="ml-auto w-2 h-2 rounded-full bg-green-500" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

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
            ) : (
              <button
                onClick={handleConnectX}
                className="w-full text-xs px-2 py-1.5 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 transition-colors"
              >
                Connect X Account
              </button>
            )}
          </div>

          <div>
            <h2 className="text-xs font-semibold text-white/35 uppercase tracking-wider mb-2">
              Folders
            </h2>
            <ul className="space-y-1">
              <li>
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors">
                  <span className="w-5 text-center shrink-0">📁</span>
                  <span>Tech</span>
                </button>
              </li>
              <li>
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors">
                  <span className="w-5 text-center shrink-0">📁</span>
                  <span>Friends</span>
                </button>
              </li>
            </ul>
          </div>

          <div className="mt-6 pt-6 border-t border-[rgba(255,255,255,0.08)]">
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
