import { useEffect, useState } from "react";

export type ReaderOfflineCacheMode =
  | "saved_only"
  | "everything_opened"
  | "recent_feed"
  | "manual_only";

export const DEFAULT_READER_OFFLINE_CACHE_MODE: ReaderOfflineCacheMode = "saved_only";

const STORAGE_KEY = "freed.reader.offlineCacheMode";

export const READER_OFFLINE_CACHE_MODE_LABELS: Record<ReaderOfflineCacheMode, string> = {
  saved_only: "Saved Only",
  everything_opened: "Everything Opened",
  recent_feed: "Recent Feed",
  manual_only: "Manual Only",
};

export const READER_OFFLINE_CACHE_MODE_DESCRIPTIONS: Record<ReaderOfflineCacheMode, string> = {
  saved_only: "Pin saved items forever on this device and cache opened items normally.",
  everything_opened: "Pin every item you open on this device until you clear the cache.",
  recent_feed: "Pin saved items and prefetch recent feed items within the local cache budget.",
  manual_only: "Only cache saved items or items you explicitly preserve offline.",
};

export function isReaderOfflineCacheMode(value: string | null): value is ReaderOfflineCacheMode {
  return (
    value === "saved_only" ||
    value === "everything_opened" ||
    value === "recent_feed" ||
    value === "manual_only"
  );
}

export function getReaderOfflineCacheMode(): ReaderOfflineCacheMode {
  if (typeof window === "undefined") return DEFAULT_READER_OFFLINE_CACHE_MODE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isReaderOfflineCacheMode(stored) ? stored : DEFAULT_READER_OFFLINE_CACHE_MODE;
}

export function setReaderOfflineCacheMode(mode: ReaderOfflineCacheMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export function shouldPinOpenedReaderItem(mode: ReaderOfflineCacheMode): boolean {
  return mode === "everything_opened" || mode === "recent_feed";
}

export function useReaderOfflineCacheMode(): [ReaderOfflineCacheMode, (mode: ReaderOfflineCacheMode) => void] {
  const [mode, setModeState] = useState<ReaderOfflineCacheMode>(() => getReaderOfflineCacheMode());

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setModeState(isReaderOfflineCacheMode(event.newValue) ? event.newValue : DEFAULT_READER_OFFLINE_CACHE_MODE);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setMode = (next: ReaderOfflineCacheMode) => {
    setReaderOfflineCacheMode(next);
    setModeState(next);
  };

  return [mode, setMode];
}
