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
        archivedCount: 2,
        sampleItemCount: 1,
        savedArchivedCount: 1,
        savedCount: 3,
        savedPlatformCount: 2,
        tags: ["alpha", "\ue000", "😀"],
        totalCount: 5,
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
      summary: {
        archivedCount: 2,
        sampleItemCount: 1,
        savedArchivedCount: 1,
        savedCount: 3,
        savedPlatformCount: 2,
        tags: ["alpha"],
        totalCount: 5,
      },
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
