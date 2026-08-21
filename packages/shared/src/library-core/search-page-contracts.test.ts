import { describe, expect, it } from "vitest";
import {
  decodeLibraryCoreSearchPageCursorV1,
  encodeLibraryCoreSearchPageCursorV1,
  libraryCoreSearchPageRequestDigestV1,
  parseLibraryCoreSearchPageRequestV1,
  parseLibraryCoreSearchPageResponseV1,
} from "./search-page-contracts.js";

const filter = Object.freeze({
  archivedOnly: false,
  authorId: null,
  feedUrl: null,
  platform: null,
  savedOnly: false,
  schemaVersion: 1 as const,
  showHidden: false,
  signals: Object.freeze([]),
  socialContentFilter: "all" as const,
  tags: Object.freeze([]),
});

const request = Object.freeze({
  cancellationId: "search-cancel",
  cursor: null,
  filter,
  friendsPredicateSchemaVersion: 1 as const,
  identityMode: "all_content" as const,
  limit: 32,
  query: "SQLite architecture",
  queryId: "search_page_v1" as const,
  readerSessionId: "search-reader",
  recommendationOrderSchemaVersion: 1 as const,
  schemaVersion: 1 as const,
});

describe("Library Core search page contract", () => {
  it("binds an opaque scan cursor to the exact query, filter, and source", () => {
    expect(parseLibraryCoreSearchPageRequestV1(request).ok).toBe(true);
    expect(libraryCoreSearchPageRequestDigestV1(request)).toBe(
      "5aceb922b5490c747e1453b87623add2482561f353921c833b39cb02c938b1cf",
    );
    const cursor = encodeLibraryCoreSearchPageCursorV1({
      generationId: "a".repeat(64) as never,
      globalId: "x:item-256" as never,
      projectionRevision: 7,
      searchDigest: libraryCoreSearchPageRequestDigestV1(request),
      sortAt: 0,
      transitionSequence: 7,
    });
    expect(decodeLibraryCoreSearchPageCursorV1(cursor).ok).toBe(true);
    expect(
      parseLibraryCoreSearchPageRequestV1({ ...request, cursor }).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreSearchPageRequestV1({
        ...request,
        cursor,
        query: "different",
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreSearchPageResponseV1(
        {
          nextCursor: cursor,
          queryId: "search_page_v1",
          rows: [],
          scannedRows: 256,
          schemaVersion: 1,
          source: {
            generationId: "a".repeat(64),
            projectionRevision: 7,
            transitionSequence: 7,
          },
        },
        request,
      ).ok,
    ).toBe(true);
  });

  it("rejects empty-token requests and scans beyond the fixed bound", () => {
    expect(
      parseLibraryCoreSearchPageRequestV1({ ...request, query: "   " }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreSearchPageResponseV1(
        {
          nextCursor: null,
          queryId: "search_page_v1",
          rows: [],
          scannedRows: 257,
          schemaVersion: 1,
          source: {
            generationId: "a".repeat(64),
            projectionRevision: 7,
            transitionSequence: 7,
          },
        },
        request,
      ).ok,
    ).toBe(false);
  });
});
