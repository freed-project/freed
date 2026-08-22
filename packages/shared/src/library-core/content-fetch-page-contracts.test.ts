import { describe, expect, it } from "vitest";

import {
  encodeLibraryCoreContentFetchPageCursorV1,
  parseLibraryCoreContentFetchPageRequestV1,
  parseLibraryCoreContentFetchPageResponseV1,
} from "./content-fetch-page-contracts.js";

const generationId = "a".repeat(64);
const request = {
  cancellationId: "cancel-content-fetch-1",
  cursor: null,
  limit: 2,
  queryId: "content_fetch_claim_v1" as const,
  readerSessionId: "reader-content-fetch-1",
  schemaVersion: 1 as const,
};

const source = {
  generationId,
  projectionRevision: 7,
  transitionSequence: 7,
};

describe("Library Core content fetch pages", () => {
  it("accepts only closed bounded requests", () => {
    expect(parseLibraryCoreContentFetchPageRequestV1(request).ok).toBe(true);
    expect(
      parseLibraryCoreContentFetchPageRequestV1({ ...request, limit: 65 }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreContentFetchPageRequestV1({
        ...request,
        sql: "SELECT *",
      }).ok,
    ).toBe(false);
  });

  it("binds stable rows and the final cursor to one source revision", () => {
    const rows = [
      {
        capturedAt: 10,
        globalId: "item-a",
        linkUrl: "https://example.test/a",
        publishedAt: 30,
      },
      {
        capturedAt: 20,
        globalId: "item-b",
        linkUrl: "https://example.test/b",
        publishedAt: 30,
      },
    ];
    const nextCursor = encodeLibraryCoreContentFetchPageCursorV1({
      generationId: generationId as never,
      globalId: "item-b" as never,
      projectionRevision: 7,
      publishedAt: 30,
      transitionSequence: 7,
    });
    const response = {
      nextCursor,
      queryId: "content_fetch_claim_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source,
    };
    expect(
      parseLibraryCoreContentFetchPageResponseV1(response, request).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreContentFetchPageResponseV1(
        { ...response, rows: [...rows].reverse() },
        request,
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreContentFetchPageResponseV1(
        { ...response, rows: [rows[0]] },
        request,
      ).ok,
    ).toBe(false);
  });

  it("rejects decorated and oversized rows", () => {
    const base = {
      nextCursor: null,
      queryId: "content_fetch_claim_v1" as const,
      schemaVersion: 1 as const,
      source,
    };
    expect(
      parseLibraryCoreContentFetchPageResponseV1(
        {
          ...base,
          rows: [
            {
              capturedAt: 1,
              globalId: "item-1",
              linkUrl: "https://example.test",
              publishedAt: 1,
              preservedText: "whole body",
            },
          ],
        },
        request,
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreContentFetchPageResponseV1(
        {
          ...base,
          rows: [
            {
              capturedAt: 1,
              globalId: "item-1",
              linkUrl: `https://example.test/${"x".repeat(8_192)}`,
              publishedAt: 1,
            },
          ],
        },
        request,
      ).ok,
    ).toBe(false);
  });
});
