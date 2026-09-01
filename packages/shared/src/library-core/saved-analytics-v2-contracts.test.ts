import { describe, expect, it } from "vitest";
import {
  parseLibraryCoreSavedAnalyticsRequestV2,
  parseLibraryCoreSavedAnalyticsResponseV2,
} from "./saved-analytics-v2-contracts.js";

function windows(count: number, width: number) {
  return Array.from({ length: count }, (_, index) => ({
    endMs: (index + 1) * width,
    startMs: index * width,
  }));
}

const request = {
  dailyWindows: windows(7, 86_400_000),
  hourlyWindows: windows(24, 3_600_000),
  queryId: "saved_analytics_v2" as const,
  schemaVersion: 2 as const,
};

describe("saved analytics v2 contracts", () => {
  it("accepts only the closed contiguous window request", () => {
    expect(parseLibraryCoreSavedAnalyticsRequestV2(request).ok).toBe(true);
    expect(
      parseLibraryCoreSavedAnalyticsRequestV2({
        ...request,
        hourlyWindows: request.hourlyWindows.map((window, index) =>
          index === 12 ? { ...window, startMs: window.startMs + 1 } : window,
        ),
      }),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreSavedAnalyticsRequestV2({ ...request, sql: "SELECT 1" }),
    ).toMatchObject({ ok: false });
  });

  it("accepts a bounded source-fenced aggregate and rejects changed ordering", () => {
    const response = {
      contentMix: [
        { count: 1, label: "article" },
        { count: 2, label: "video" },
      ],
      dailyCounts: [0, 0, 0, 0, 1, 1, 1],
      hourlyCounts: Array.from({ length: 24 }, (_, index) =>
        index >= 21 ? 1 : 0,
      ),
      latestSavedAt: 82_800_000,
      queryId: "saved_analytics_v2",
      schemaVersion: 2,
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 9,
        transitionSequence: 9,
      },
      sourceCounts: [
        { count: 1, label: "rss" },
        { count: 2, label: "saved" },
      ],
      totalCount: 3,
    };
    expect(parseLibraryCoreSavedAnalyticsResponseV2(response).ok).toBe(true);
    expect(
      parseLibraryCoreSavedAnalyticsResponseV2({
        ...response,
        sourceCounts: [...response.sourceCounts].reverse(),
      }),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreSavedAnalyticsResponseV2({
        ...response,
        dailyCounts: [...response.dailyCounts, 0],
      }),
    ).toMatchObject({ ok: false });
  });
});
