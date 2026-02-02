import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#121212]">
      {/* Header - fixed height */}
      <Header onMenuClick={() => setSidebarOpen(true)} />

      {/* Content area - fills remaining space */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Sidebar - desktop always visible, mobile slide-out */}
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main content - scrollable */}
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
