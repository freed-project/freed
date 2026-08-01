import { useEffect } from "react";
import { usePlatform } from "../context/PlatformContext.js";

/**
 * Keep the full legacy item projection alive only while an unconverted
 * compatibility surface is mounted. PWA keeps its existing in-memory store,
 * while Freed Desktop releases the corpus after the last consumer unmounts.
 */
export function useLegacyLibraryItems(enabled = true): void {
  const { acquireLegacyLibraryItems } = usePlatform();

  useEffect(() => {
    if (!enabled || !acquireLegacyLibraryItems) return;
    let cancelled = false;
    let release: (() => void) | null = null;
    void acquireLegacyLibraryItems()
      .then((nextRelease) => {
        if (cancelled) nextRelease();
        else release = nextRelease;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      release?.();
    };
  }, [acquireLegacyLibraryItems, enabled]);
}
