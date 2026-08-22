import { describe, expect, it } from "vitest";

import {
  parseLibraryCoreFilterScopeSummaryRequestV1,
  parseLibraryCoreFilterScopeSummaryResponseV1,
} from "./filter-scope-summary-contracts.js";

const source = {
  generationId: "a".repeat(64),
  projectionRevision: 3,
  transitionSequence: 3,
};

describe("Library Core filter scope summary contract", () => {
  it("accepts one exact Feed or provider author scope", () => {
    const feedRequest = {
      authorId: null,
      feedUrl: "https://example.com/feed",
      platform: null,
      queryId: "filter_scope_summary_v1" as const,
      schemaVersion: 1 as const,
    };
    expect(parseLibraryCoreFilterScopeSummaryRequestV1(feedRequest).ok).toBe(
      true,
    );
    expect(
      parseLibraryCoreFilterScopeSummaryResponseV1(
        {
          itemCount: 7,
          label: "Example",
          queryId: "filter_scope_summary_v1",
          schemaVersion: 1,
          source,
        },
        feedRequest,
      ),
    ).toMatchObject({ ok: true, value: { itemCount: 7, label: "Example" } });

    expect(
      parseLibraryCoreFilterScopeSummaryRequestV1({
        authorId: "author-1",
        feedUrl: null,
        platform: "x",
        queryId: "filter_scope_summary_v1",
        schemaVersion: 1,
      }).ok,
    ).toBe(true);
  });

  it("rejects mixed, empty, open, and oversized records", () => {
    expect(
      parseLibraryCoreFilterScopeSummaryRequestV1({
        authorId: "author-1",
        feedUrl: "https://example.com/feed",
        platform: "x",
        queryId: "filter_scope_summary_v1",
        schemaVersion: 1,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreFilterScopeSummaryRequestV1({
        authorId: null,
        feedUrl: "",
        platform: null,
        queryId: "filter_scope_summary_v1",
        schemaVersion: 1,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreFilterScopeSummaryResponseV1(
        {
          itemCount: 0,
          label: null,
          queryId: "filter_scope_summary_v1",
          schemaVersion: 1,
          source,
          sql: "SELECT 1",
        },
        {
          authorId: null,
          feedUrl: "https://example.com/feed",
          platform: null,
          queryId: "filter_scope_summary_v1",
          schemaVersion: 1,
        },
      ).ok,
    ).toBe(false);
  });
});
