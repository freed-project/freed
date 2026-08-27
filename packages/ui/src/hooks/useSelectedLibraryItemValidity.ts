import { useEffect } from "react";
import { usePlatform } from "../context/PlatformContext.js";

/**
 * Clear a selected item only after one exact row-store lookup proves it absent.
 * Navigation never hydrates or subscribes to the Library corpus for membership.
 */
export function useSelectedLibraryItemValidity(enabled: boolean): void {
  const { readLibraryItemDetail, store } = usePlatform();
  const isInitialized = store((state) => state.isInitialized);
  const selectedItemId = store((state) => state.selectedItemId);
  const setSelectedItem = store((state) => state.setSelectedItem);

  useEffect(() => {
    if (
      !enabled ||
      !isInitialized ||
      !selectedItemId ||
      !readLibraryItemDetail
    ) {
      return;
    }
    let cancelled = false;
    void readLibraryItemDetail(selectedItemId)
      .then((item) => {
        if (!cancelled && item === null) setSelectedItem(null);
      })
      .catch(() => {
        // A failed point read proves nothing. Keep the current navigation.
      });
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    isInitialized,
    readLibraryItemDetail,
    selectedItemId,
    setSelectedItem,
  ]);
}
