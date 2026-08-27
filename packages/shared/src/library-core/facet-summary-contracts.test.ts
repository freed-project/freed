import { describe, expect, it } from "vitest";

import {
  parseLibraryCoreFacetSummaryRequestV1,
  parseLibraryCoreFacetSummaryResponseV1,
} from "./facet-summary-contracts.js";

const source = {
  generationId: "a".repeat(64),
  projectionRevision: 7,
  transitionSequence: 7,
};

const summary = {
  archivedCount: 2,
  archivableCount: 1,
  contactAccountCount: 2,
  contactLinkedPersonCount: 1,
  enabledRssFeedCount: 2,
  friendPersonCount: 3,
  latestContactImportedAt: 500,
  latestRssFeedFetchedAt: 400,
  platformCounts: [
    {
      archivableCount: 1,
      latestCapturedAt: 300,
      latestPublishedAt: 200,
      platform: "rss",
      totalCount: 5,
      unreadCount: 2,
    },
  ],
  rssFeedCount: 4,
  sampleAccountCount: 1,
  sampleFeedCount: 1,
  sampleItemCount: 1,
  samplePersonCount: 1,
  savedArchivedCount: 1,
  savedCount: 3,
  savedPlatformCount: 2,
  socialAccountCount: 5,
  tags: ["alpha"],
  totalCount: 5,
  unreadCount: 2,
};

describe("Library Core facet summary contract", () => {
  it("snapshots one closed bounded response in SQLite binary tag order", () => {
    expect(
      parseLibraryCoreFacetSummaryRequestV1({
        queryId: "library_facet_summary_v1",
        schemaVersion: 1,
      }).ok,
    ).toBe(true);
    const parsed = parseLibraryCoreFacetSummaryResponseV1({
      queryId: "library_facet_summary_v1",
      schemaVersion: 1,
      source,
      summary: {
        ...summary,
        tags: ["alpha", "\ue000", "😀"],
      },
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        summary: { tags: ["alpha", "\ue000", "😀"] },
      },
    });
  });

  it("rejects duplicate, nonbinary, oversized, and inconsistent values", () => {
    const response = {
      queryId: "library_facet_summary_v1",
      schemaVersion: 1,
      source,
      summary,
    };
    expect(
      parseLibraryCoreFacetSummaryResponseV1({
        ...response,
        summary: { ...response.summary, tags: ["😀", "\ue000"] },
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreFacetSummaryResponseV1({
        ...response,
        summary: { ...response.summary, tags: ["alpha", "alpha"] },
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreFacetSummaryResponseV1({
        ...response,
        summary: { ...response.summary, tags: ["x".repeat(1_025)] },
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreFacetSummaryResponseV1({
        ...response,
        summary: {
          ...response.summary,
          tags: Array.from({ length: 4_097 }, (_, index) =>
            index.toString().padStart(4, "0"),
          ),
        },
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreFacetSummaryResponseV1({
        ...response,
        summary: { ...response.summary, savedArchivedCount: 4 },
      }).ok,
    ).toBe(false);
  });
});
