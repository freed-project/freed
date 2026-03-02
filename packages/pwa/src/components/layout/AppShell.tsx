import { useState, type ReactNode } from "react";
import { usePlatform } from "../../context/PlatformContext";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { TitleBar } = usePlatform();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#121212]">
      {/* Optional platform title bar (e.g. Tauri chrome with drag region) */}
      {TitleBar && <TitleBar />}

      {/* Header - fixed height */}
      <Header onMenuClick={() => setSidebarOpen(true)} />

      {/* Content area - fills remaining space */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Sidebar - desktop always visible, mobile slide-out */}
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main content */}
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
