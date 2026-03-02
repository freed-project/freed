/**
 * XSourceIndicator — green dot for authenticated X source in sidebar
 */

import { useAppStore } from "../lib/store";

export function XSourceIndicator({ sourceId }: { sourceId: string }) {
  const isAuthenticated = useAppStore((s) => s.xAuth.isAuthenticated);

  if (sourceId !== "x" || !isAuthenticated) return null;

  return (
    <span className="ml-auto w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
  );
}
