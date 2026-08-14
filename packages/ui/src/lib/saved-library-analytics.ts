import type { FeedItem } from "@freed/shared";
import type {
  LibrarySavedAnalytics,
  LibrarySavedAnalyticsCount,
  LibrarySavedAnalyticsRequest,
  LibrarySavedAnalyticsWindow,
} from "../context/PlatformContext.js";

const DAILY_WINDOW_COUNT = 7;
const HOURLY_WINDOW_COUNT = 24;
const TOP_SOURCE_COUNT = 5;

function savedTimestamp(item: FeedItem): number {
  return item.userState.savedAt ?? item.capturedAt;
}

function savedSourceLabel(item: FeedItem): string {
  const source =
    item.content.linkPreview?.url ?? item.sourceUrl ?? item.author.handle;
  if (!source) return "Unknown";
  try {
    return new URL(source).hostname.replace(/^www\./, "");
  } catch {
    return source;
  }
}

function sortCounts(
  counts: readonly LibrarySavedAnalyticsCount[],
): LibrarySavedAnalyticsCount[] {
  return [...counts].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}

function countWithinWindows(
  savedItems: readonly FeedItem[],
  windows: readonly LibrarySavedAnalyticsWindow[],
): number[] {
  return windows.map(({ startMs, endMs }) =>
    savedItems.reduce((sum, item) => {
      const savedAt = savedTimestamp(item);
      return savedAt >= startMs && savedAt < endMs ? sum + 1 : sum;
    }, 0),
  );
}

/** Build the exact local-time windows used by the existing Saved overview. */
export function createLibrarySavedAnalyticsRequest(
  now = new Date(),
): LibrarySavedAnalyticsRequest {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dailyWindows = Array.from({ length: DAILY_WINDOW_COUNT }, (_, index) => {
    const start = new Date(today);
    start.setDate(today.getDate() - (DAILY_WINDOW_COUNT - 1 - index));
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    return { startMs: start.getTime(), endMs: end.getTime() };
  });

  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);
  const hourlyWindows = Array.from(
    { length: HOURLY_WINDOW_COUNT },
    (_, index) => {
      const start = new Date(currentHour);
      start.setHours(
        currentHour.getHours() - (HOURLY_WINDOW_COUNT - 1 - index),
      );
      const end = new Date(start);
      end.setHours(start.getHours() + 1);
      return { startMs: start.getTime(), endMs: end.getTime() };
    },
  );

  return { dailyWindows, hourlyWindows };
}

/** Apply the browser's locale ordering to native or compatibility aggregates. */
export function normalizeLibrarySavedAnalytics(
  analytics: LibrarySavedAnalytics,
): LibrarySavedAnalytics {
  return {
    ...analytics,
    dailyCounts: [...analytics.dailyCounts],
    hourlyCounts: [...analytics.hourlyCounts],
    sourceCounts: sortCounts(analytics.sourceCounts).slice(0, TOP_SOURCE_COUNT),
    contentMix: sortCounts(analytics.contentMix),
  };
}

/** Exact compatibility reducer for the legacy in-memory Saved overview. */
export function summarizeLibrarySavedItems(
  items: readonly FeedItem[],
  request: LibrarySavedAnalyticsRequest,
): LibrarySavedAnalytics {
  const savedItems = items
    .filter((item) => item.platform === "saved")
    .sort((a, b) => savedTimestamp(b) - savedTimestamp(a));
  const sourceCounts = new Map<string, number>();
  const contentMix = new Map<string, number>();

  for (const item of savedItems) {
    const source = savedSourceLabel(item);
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    contentMix.set(
      item.contentType,
      (contentMix.get(item.contentType) ?? 0) + 1,
    );
  }

  return normalizeLibrarySavedAnalytics({
    totalCount: savedItems.length,
    latestSavedAt: savedItems.length > 0 ? savedTimestamp(savedItems[0]) : null,
    dailyCounts: countWithinWindows(savedItems, request.dailyWindows),
    hourlyCounts: countWithinWindows(savedItems, request.hourlyWindows),
    sourceCounts: [...sourceCounts].map(([label, count]) => ({ label, count })),
    contentMix: [...contentMix].map(([label, count]) => ({ label, count })),
  });
}
