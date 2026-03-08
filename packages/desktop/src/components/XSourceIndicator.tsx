/**
 * SourceIndicator -- green dot for authenticated social sources in the sidebar.
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
    <span className="ml-auto w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
  );
}
