import { describe, expect, it } from "vitest";

import {
  decodeLibraryCorePersonTimelineCursorV1,
  encodeLibraryCorePersonTimelineCursorV1,
  libraryCorePersonTimelinePersonDigestV1,
  parseLibraryCorePersonTimelineRequestV1,
  parseLibraryCorePersonTimelineResponseV1,
  type LibraryCorePersonTimelineRequestV1,
} from "./person-timeline-contracts.js";
import type {
  LibraryCoreEntityId,
  LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";

const PERSON_ID = "person-1" as LibraryCoreEntityId;
const OTHER_PERSON_ID = "person-2" as LibraryCoreEntityId;
const GENERATION_ID = "a".repeat(64) as LibraryCoreLowercaseHex64;

function request(
  overrides: Partial<LibraryCorePersonTimelineRequestV1> = {},
): LibraryCorePersonTimelineRequestV1 {
  return {
    cancellationId: "cancel-person-timeline-1",
    cursor: null,
    limit: 50,
    personId: PERSON_ID,
    queryId: "person_timeline_v1",
    readerSessionId: "reader-person-timeline-1",
    schemaVersion: 1,
    ...overrides,
  };
}

function cursor(personId = PERSON_ID) {
  return encodeLibraryCorePersonTimelineCursorV1({
    generationId: GENERATION_ID,
    globalId: "item-1" as LibraryCoreEntityId,
    personDigest: libraryCorePersonTimelinePersonDigestV1(personId),
    projectionRevision: 7,
    sortAt: 100,
    transitionSequence: 7,
  });
}

describe("Library Core person timeline contract v1", () => {
  it("binds the opaque page cursor to one person and one source fence", () => {
    const encoded = cursor();
    const decoded = decodeLibraryCorePersonTimelineCursorV1(encoded);
    expect(decoded.ok).toBe(true);
    expect(
      parseLibraryCorePersonTimelineRequestV1(
        request({ cursor: encoded, personId: OTHER_PERSON_ID }),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("different person"),
    });
  });

  it("rejects open records and accepts an exact bounded request", () => {
    expect(parseLibraryCorePersonTimelineRequestV1(request()).ok).toBe(true);
    expect(
      parseLibraryCorePersonTimelineRequestV1({
        ...request(),
        arbitrarySql: "SELECT *",
      }).ok,
    ).toBe(false);
  });

  it("requires response cursors to retain the request person and source revision", () => {
    const input = request();
    expect(
      parseLibraryCorePersonTimelineResponseV1(
        {
          nextCursor: null,
          queryId: "person_timeline_v1",
          rows: [],
          schemaVersion: 1,
          source: {
            generationId: GENERATION_ID,
            projectionRevision: 7,
            transitionSequence: 7,
          },
          totalCount: 0,
        },
        input,
      ).ok,
    ).toBe(true);
    expect(
      parseLibraryCorePersonTimelineResponseV1(
        {
          nextCursor: cursor(OTHER_PERSON_ID),
          queryId: "person_timeline_v1",
          rows: [],
          schemaVersion: 1,
          source: {
            generationId: GENERATION_ID,
            projectionRevision: 7,
            transitionSequence: 7,
          },
          totalCount: 0,
        },
        input,
      ).ok,
    ).toBe(false);
  });
});
