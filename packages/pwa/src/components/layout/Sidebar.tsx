import { useAppStore } from "../../lib/store";

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
        <nav className="p-4">
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
                      text-left text-sm transition-colors
                      ${
                        isActive(source)
                          ? "bg-accent/20 text-white"
                          : "text-white/70 hover:bg-white/5 hover:text-white"
                      }
                    `}
                  >
                    <span>{source.icon}</span>
                    <span>{source.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-semibold text-white/35 uppercase tracking-wider mb-2">
              Folders
            </h2>
            <ul className="space-y-1">
              <li>
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors">
                  <span>📁</span>
                  <span>Tech</span>
                </button>
              </li>
              <li>
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors">
                  <span>📁</span>
                  <span>Friends</span>
                </button>
              </li>
            </ul>
          </div>

          <div className="mt-6 pt-6 border-t border-glass-border">
            <h2 className="text-xs font-semibold text-white/35 uppercase tracking-wider mb-2">
              Actions
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
                        ? "bg-accent/20 text-white"
                        : "text-white/70 hover:bg-white/5 hover:text-white"
                    }
                  `}
                >
                  <span>📦</span>
                  <span>Archived</span>
                </button>
              </li>
            </ul>
          </div>
        </nav>
      </aside>
    </>
  );
}
