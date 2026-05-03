import { useEffect, useState } from "react";

export type FeedCardDensity = "compact" | "comfortable" | "expansive";

const STORAGE_KEY = "freed-feed-card-density";
const CHANGE_EVENT = "freed-feed-card-density-change";
const DEFAULT_DENSITY: FeedCardDensity = "comfortable";

export const FEED_CARD_DENSITY_OPTIONS: FeedCardDensity[] = [
  "compact",
  "comfortable",
  "expansive",
];

export const FEED_CARD_DENSITY_LABELS: Record<FeedCardDensity, string> = {
  compact: "Compact cards",
  comfortable: "Comfortable cards",
  expansive: "Expansive cards",
};

export const DESKTOP_FEED_CARD_HEIGHT_BY_DENSITY: Record<FeedCardDensity, number> = {
  compact: 172,
  comfortable: 220,
  expansive: 300,
};

export function isFeedCardDensity(value: string | null): value is FeedCardDensity {
  return value === "compact" || value === "comfortable" || value === "expansive";
}

export function getFeedCardDensity(): FeedCardDensity {
  if (typeof window === "undefined") return DEFAULT_DENSITY;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isFeedCardDensity(stored) ? stored : DEFAULT_DENSITY;
}

export function setFeedCardDensity(next: FeedCardDensity): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, next);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
}

export function useFeedCardDensity(): [FeedCardDensity, (next: FeedCardDensity) => void] {
  const [density, setDensityState] = useState<FeedCardDensity>(() => getFeedCardDensity());

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleChange = (event: Event) => {
      if (event instanceof CustomEvent && isFeedCardDensity(event.detail)) {
        setDensityState(event.detail);
        return;
      }
      setDensityState(getFeedCardDensity());
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setDensityState(isFeedCardDensity(event.newValue) ? event.newValue : DEFAULT_DENSITY);
    };

    window.addEventListener(CHANGE_EVENT, handleChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handleChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const setDensity = (next: FeedCardDensity) => {
    setFeedCardDensity(next);
    setDensityState(next);
  };

  return [density, setDensity];
}
