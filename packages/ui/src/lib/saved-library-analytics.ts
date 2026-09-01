import type {
  LibrarySavedAnalytics,
  LibrarySavedAnalyticsCount,
  LibrarySavedAnalyticsRequest,
} from "../context/PlatformContext.js";

const DAILY_WINDOW_COUNT = 7;
const HOURLY_WINDOW_COUNT = 24;
const TOP_SOURCE_COUNT = 5;

function sortCounts(
  counts: readonly LibrarySavedAnalyticsCount[],
): LibrarySavedAnalyticsCount[] {
  return [...counts].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
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

/** Apply the browser's locale ordering to typed SQLite aggregates. */
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
