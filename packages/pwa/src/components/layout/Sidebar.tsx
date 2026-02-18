import { useState } from "react";
import { useAppStore } from "../../lib/store";
import {
  disconnect,
  clearStoredRelayUrl,
} from "../../lib/sync";
import { SyncConnectDialog } from "../SyncConnectDialog";
import { SettingsPanel } from "../SettingsPanel";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const sources = [
  { id: undefined, label: "All", icon: "🌊" },
  { id: "x", label: "X", icon: "𝕏" },
  { id: "rss", label: "RSS", icon: "📡" },
  { id: "saved", label: "Saved", icon: "📌", savedOnly: true },
];

export function Sidebar({ open, onClose }: SidebarProps) {
  const activeFilter = useAppStore((s) => s.activeFilter);
  const setFilter = useAppStore((s) => s.setFilter);
  const syncConnected = useAppStore((s) => s.syncConnected);
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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

  const handleConnectSync = () => {
    setShowSyncDialog(true);
  };

  const handleDisconnectSync = () => {
    clearStoredRelayUrl();
    disconnect();
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
          w-64 h-full
          bg-[#0a0a0a]/95 md:bg-[#0f0f0f]/80 backdrop-blur-xl
          border-r border-[rgba(255,255,255,0.08)]
          transform transition-transform duration-200 ease-in-out
          ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          overflow-y-auto
        `}
      >
        {/* Mobile header with close button */}
        <div className="md:hidden flex items-center justify-between p-4 border-b border-[rgba(255,255,255,0.08)]">
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

        <nav className="p-4">
          {/* Sources */}
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-2 px-3">
              Sources
            </h2>
            <ul className="space-y-1">
              {sources.map((source) => (
                <li key={source.id ?? "all"}>
                  <button
                    onClick={() => handleSourceClick(source)}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                      text-left text-sm transition-all
                      ${
                        isActive(source)
                          ? "bg-[#8b5cf6]/20 text-white border border-[#8b5cf6]/30"
                          : "text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                      }
                    `}
                  >
                    <span className="w-5 text-center">{source.icon}</span>
                    <span>{source.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Sync Status */}
          <div className="mb-6 p-3 rounded-xl bg-white/5 border border-[rgba(255,255,255,0.08)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Desktop Sync</span>
              <div className="flex items-center gap-2">
                <span
                  className={`sync-dot ${syncConnected ? "connected" : "disconnected"}`}
                />
                <span className="text-xs text-[#71717a]">
                  {syncConnected ? "Connected" : "Offline"}
                </span>
              </div>
            </div>
            {syncConnected ? (
              <button
                onClick={handleDisconnectSync}
                className="w-full text-xs px-3 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnectSync}
                className="w-full text-xs px-3 py-2 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 transition-colors"
              >
                Connect to Desktop
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-[rgba(255,255,255,0.08)]">
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
                    w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                    text-left text-sm transition-all
                    ${
                      activeFilter.showArchived
                        ? "bg-[#8b5cf6]/20 text-white border border-[#8b5cf6]/30"
                        : "text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                    }
                  `}
                >
                  <span className="w-5 text-center">📦</span>
                  <span>Archived</span>
                </button>
              </li>
            </ul>
          </div>

          {/* Settings */}
          <div className="pt-4 border-t border-[rgba(255,255,255,0.08)]">
            <button
              onClick={() => setShowSettings(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm text-[#a1a1aa] hover:bg-white/5 hover:text-white transition-all"
            >
              <span className="w-5 text-center">
                <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </span>
              <span>Settings</span>
            </button>
          </div>
        </nav>
      </aside>

      <SyncConnectDialog
        open={showSyncDialog}
        onClose={() => setShowSyncDialog(false)}
      />

      <SettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </>
  );
}
