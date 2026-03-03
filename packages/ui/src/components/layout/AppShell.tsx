import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar.js";
import { Header } from "./Header.js";
import { DebugPanel } from "../DebugPanel.js";
import { useDebugStore } from "../../lib/debug-store.js";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const debugVisible = useDebugStore((s) => s.visible);
  const toggleDebug = useDebugStore((s) => s.toggle);

  // Cmd/Ctrl+Shift+D keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "D" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleDebug();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleDebug]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#121212] pb-[env(safe-area-inset-bottom)]">
      <Header onMenuClick={() => setSidebarOpen(true)} />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      </div>

      {debugVisible && <DebugPanel />}
    </div>
  );
}
