import { useEffect, useState } from "react";
import {
  usePlatform,
  type PlatformConfig,
} from "../context/PlatformContext.js";

type LegacyLibraryItemsReader = NonNullable<
  PlatformConfig["acquireLegacyLibraryItems"]
>;

/**
 * Keep the full legacy item projection alive only while an unconverted
 * compatibility surface is mounted. PWA keeps its existing in-memory store,
 * while Freed Desktop releases the corpus after the last consumer unmounts.
 */
export function useLegacyLibraryItems(enabled = true): boolean {
  const { acquireLegacyLibraryItems } = usePlatform();
  const [readyReader, setReadyReader] =
    useState<LegacyLibraryItemsReader | null>(null);

  useEffect(() => {
    if (!enabled || !acquireLegacyLibraryItems) {
      setReadyReader(null);
      return;
    }
    let cancelled = false;
    let release: (() => void) | null = null;
    setReadyReader(null);
    void acquireLegacyLibraryItems()
      .then((nextRelease) => {
        if (cancelled) nextRelease();
        else {
          release = nextRelease;
          setReadyReader(() => acquireLegacyLibraryItems);
        }
      })
      .catch(() => {
        if (!cancelled) setReadyReader(null);
      });
    return () => {
      cancelled = true;
      release?.();
    };
  }, [acquireLegacyLibraryItems, enabled]);

  return (
    !enabled ||
    !acquireLegacyLibraryItems ||
    readyReader === acquireLegacyLibraryItems
  );
}
