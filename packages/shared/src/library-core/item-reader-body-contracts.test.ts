import { describe, expect, it } from "vitest";
import { encodeLibraryCoreCanonicalBase64 } from "./canonical-base64.js";
import {
  parseLibraryCoreItemReaderBodyRequestV1,
  parseLibraryCoreItemReaderBodyResponseV1,
} from "./item-reader-body-contracts.js";

const request = {
  bodyKind: "preserved" as const,
  globalId: "item-1",
  limitBytes: 4,
  offsetBytes: 2,
  queryId: "item_reader_body_v1" as const,
  schemaVersion: 1 as const,
};

describe("item reader body contracts", () => {
  it("accepts one canonical bounded byte range", () => {
    expect(parseLibraryCoreItemReaderBodyRequestV1(request).ok).toBe(true);
    expect(
      parseLibraryCoreItemReaderBodyResponseV1(
        {
          body: {
            blobDigest: "a".repeat(64),
            bytesBase64: encodeLibraryCoreCanonicalBase64(
              Uint8Array.from([2, 3, 4, 5]),
            ),
            contentLength: 10,
            endOffset: 6,
            startOffset: 2,
            storage: "blob",
          },
          queryId: "item_reader_body_v1",
          schemaVersion: 1,
          source: {
            generationId: "b".repeat(64),
            projectionRevision: 7,
            transitionSequence: 7,
          },
        },
        request,
      ).ok,
    ).toBe(true);
  });

  it("rejects noncanonical bytes and ranges outside the request", () => {
    const response = {
      body: {
        blobDigest: null,
        bytesBase64: "AA==",
        contentLength: 10,
        endOffset: 3,
        startOffset: 2,
        storage: "inline",
      },
      queryId: "item_reader_body_v1",
      schemaVersion: 1,
      source: {
        generationId: "b".repeat(64),
        projectionRevision: 7,
        transitionSequence: 7,
      },
    };
    expect(
      parseLibraryCoreItemReaderBodyResponseV1(
        { ...response, body: { ...response.body, bytesBase64: "AA" } },
        request,
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreItemReaderBodyResponseV1(
        { ...response, body: { ...response.body, endOffset: 7 } },
        request,
      ).ok,
    ).toBe(false);
  });
});
