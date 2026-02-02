import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { SettingsPanel } from "../SettingsPanel";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#0a0a0a]">
      {/* Title bar - sits at top with traffic lights */}
      <div
        className="h-9 shrink-0 flex items-center border-b border-[rgba(255,255,255,0.08)] bg-[#0a0a0a]/80"
        data-tauri-drag-region
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="pl-[72px]">
          <span className="text-lg font-bold gradient-text">FREED</span>
        </div>
      </div>

      {/* Content area - fills remaining space */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Sidebar - desktop always visible, mobile slide-out */}
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* Main content area with header */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <Header onMenuClick={() => setSidebarOpen(true)} />
          <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        </div>
      </div>

      {/* Settings Panel */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
