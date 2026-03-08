/**
 * SourceIndicator -- subtle purple dot for authenticated social sources in the sidebar.
 * Shows a connected indicator for X, Facebook, and Instagram when authenticated.
 */

import { useAppStore } from "../lib/store";

export function XSourceIndicator({ sourceId }: { sourceId: string }) {
  const xAuth = useAppStore((s) => s.xAuth.isAuthenticated);
  const fbAuth = useAppStore((s) => s.fbAuth.isAuthenticated);
  const igAuth = useAppStore((s) => s.igAuth.isAuthenticated);

  const isConnected =
    (sourceId === "x" && xAuth) ||
    (sourceId === "facebook" && fbAuth) ||
    (sourceId === "instagram" && igAuth);

  if (!isConnected) return null;

  return (
    <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-[#8b5cf6]/50 flex-shrink-0" />
  );
}
