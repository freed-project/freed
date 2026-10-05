import { describe, expect, it } from "vitest";
import {
  parseLibraryCoreItemAnnotationsRequestV1,
  parseLibraryCoreItemAnnotationsResponseV1,
} from "./item-annotations-contracts.js";
import {
  parseLibraryCoreRssItemSummaryRequestV1,
  parseLibraryCoreRssItemSummaryResponseV1,
} from "./rss-item-summary-contracts.js";

const source = {
  generationId: "a".repeat(64),
  projectionRevision: 7,
  transitionSequence: 7,
};
const request = {
  globalId: "item-1",
  queryId: "item_annotations_v1",
  schemaVersion: 1,
} as const;
const highlight = {
  createdAt: 123,
  note: "Keep this",
  text: "Quoted text",
  textBlobDigest: null,
};
const annotations = {
  ...request,
  source,
  tags: ["favorite"],
  highlights: [highlight],
};

describe("selected item annotations", () => {
  it("accepts inline notes and separate blob references without expanding feed cards", () => {
    expect(parseLibraryCoreItemAnnotationsRequestV1(request).ok).toBe(true);
    expect(
      parseLibraryCoreItemAnnotationsResponseV1(annotations, request).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreItemAnnotationsResponseV1(
        {
          ...annotations,
          highlights: [
            { ...highlight, text: null, textBlobDigest: "b".repeat(64) },
          ],
        },
        request,
      ).ok,
    ).toBe(true);
  });

  it("rejects mismatched identity, surplus fields, unsafe values, and oversized collections", () => {
    expect(
      parseLibraryCoreItemAnnotationsRequestV1({ ...request, extra: true }).ok,
    ).toBe(false);
    for (const patch of [
      { globalId: "other" },
      { extra: true },
      { source: { ...source, projectionRevision: -1 } },
      { tags: Array.from({ length: 65 }, (_, i) => `tag-${i}`) },
      { highlights: Array.from({ length: 65 }, () => highlight) },
      { highlights: [{ ...highlight, note: "x".repeat(8193) }] },
      { highlights: [{ ...highlight, textBlobDigest: "b".repeat(64) }] },
    ])
      expect(
        parseLibraryCoreItemAnnotationsResponseV1(
          { ...annotations, ...patch },
          request,
        ).ok,
      ).toBe(false);
  });
});

describe("RSS navigation summary", () => {
  const request = { queryId: "rss_item_summary_v1", schemaVersion: 1 };
  it("accepts zero counts and provider-overlapping RSS totals", () => {
    expect(parseLibraryCoreRssItemSummaryRequestV1(request).ok).toBe(true);
    for (const totalCount of [0, 3])
      expect(
        parseLibraryCoreRssItemSummaryResponseV1({
          ...request,
          source,
          totalCount,
          unreadCount: 0,
        }).ok,
      ).toBe(true);
  });
  it("rejects unsupported parameters and impossible counts", () => {
    expect(
      parseLibraryCoreRssItemSummaryRequestV1({ ...request, platform: "rss" })
        .ok,
    ).toBe(false);
    for (const [totalCount, unreadCount] of [
      [-1, 0],
      [1, 2],
      [1.5, 0],
      [1, -1],
    ]) {
      expect(
        parseLibraryCoreRssItemSummaryResponseV1({
          ...request,
          source,
          totalCount,
          unreadCount,
        }).ok,
      ).toBe(false);
    }
  });
});
