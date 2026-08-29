import { useEffect } from "react";
import type { FeedItem } from "@freed/shared";

/**
 * Clear a selected item only after one exact row-store lookup proves it absent.
 * Navigation never hydrates or subscribes to the Library corpus for membership.
 */
export function useSelectedLibraryItemValidity(input: {
  readonly enabled: boolean;
  readonly isInitialized: boolean;
  readonly readLibraryItemDetail: ((globalId: string) => Promise<FeedItem | null>) | undefined;
  readonly selectedItemId: string | null;
  readonly setSelectedItem: (globalId: string | null) => void;
}): void {
  useEffect(() => {
    if (
      !input.enabled ||
      !input.isInitialized ||
      !input.selectedItemId ||
      !input.readLibraryItemDetail
    ) {
      return;
    }
    let cancelled = false;
    void input.readLibraryItemDetail(input.selectedItemId)
      .then((item) => {
        if (!cancelled && item === null) input.setSelectedItem(null);
      })
      .catch(() => {
        // A failed point read proves nothing. Keep the current navigation.
      });
    return () => {
      cancelled = true;
    };
  }, [
    input.enabled,
    input.isInitialized,
    input.readLibraryItemDetail,
    input.selectedItemId,
    input.setSelectedItem,
  ]);
}
