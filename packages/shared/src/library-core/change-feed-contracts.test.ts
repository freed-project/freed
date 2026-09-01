import { describe, expect, it } from "vitest";

import {
  decodeLibraryCoreChangeFeedCursorV1,
  encodeLibraryCoreChangeFeedCursorV1,
  parseLibraryCoreChangeFeedRequestV1,
  parseLibraryCoreChangeFeedResponseV1,
  parseLibraryCoreLocalChangeFeedRequestV1,
  parseLibraryCoreLocalChangeFeedResponseV1,
  type LibraryCoreChangeFeedCursorV1,
} from "./change-feed-contracts.js";

const generationId = "a".repeat(64) as never;
const request = {
  afterRevision: 3,
  cancellationId: "cancel-changes-1",
  cursor: null,
  limit: 2,
  queryId: "change_feed_v1" as const,
  readerSessionId: "reader-changes-1",
  schemaVersion: 1 as const,
};

describe("Library Core change feed", () => {
  it("round-trips the original frontier, pinned upper bound, and row key", () => {
    const cursor = {
      afterRevision: 3,
      generationId,
      ordinal: 7,
      revision: 5,
      upperRevision: 8,
    } satisfies LibraryCoreChangeFeedCursorV1;
    expect(
      decodeLibraryCoreChangeFeedCursorV1(
        encodeLibraryCoreChangeFeedCursorV1(cursor),
      ),
    ).toEqual({ ok: true, value: cursor });
  });

  it("accepts one closed bounded ordered page and rejects changed cursor scope", () => {
    expect(parseLibraryCoreChangeFeedRequestV1(request).ok).toBe(true);
    expect(
      parseLibraryCoreChangeFeedRequestV1({ ...request, limit: 513 }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreChangeFeedRequestV1({ ...request, sql: "SELECT 1" }).ok,
    ).toBe(false);
    const rows = [
      {
        entityId: "item-1",
        ordinal: 0,
        resetRequired: false,
        revision: 4,
        topic: "feed_item",
      },
      {
        entityId: null,
        ordinal: 0,
        resetRequired: true,
        revision: 5,
        topic: "library",
      },
    ];
    const nextCursor = encodeLibraryCoreChangeFeedCursorV1({
      afterRevision: 3,
      generationId,
      ordinal: 0,
      revision: 5,
      upperRevision: 8,
    });
    const response = {
      nextCursor,
      queryId: "change_feed_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: 8,
        transitionSequence: 8,
      },
    };
    expect(parseLibraryCoreChangeFeedResponseV1(response, request).ok).toBe(
      true,
    );
    expect(
      parseLibraryCoreChangeFeedResponseV1(
        { ...response, rows: [...rows].reverse() },
        request,
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreChangeFeedRequestV1({
        ...request,
        afterRevision: 4,
        cursor: nextCursor,
      }).ok,
    ).toBe(false);
    const resetResponse = {
      nextCursor: null,
      queryId: "change_feed_v1" as const,
      rows: [
        {
          entityId: null,
          ordinal: 0,
          resetRequired: true,
          revision: 8,
          topic: "library",
        },
      ],
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: 8,
        transitionSequence: 8,
      },
    };
    expect(
      parseLibraryCoreChangeFeedResponseV1(resetResponse, request).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreChangeFeedResponseV1(
        {
          ...resetResponse,
          rows: [{ ...resetResponse.rows[0], resetRequired: false }],
        },
        request,
      ).ok,
    ).toBe(false);
  });

  it("keeps device-local sequences on a distinct closed query identity", () => {
    const localRequest = {
      ...request,
      afterRevision: 0,
      queryId: "local_change_feed_v1" as const,
    };
    const localResponse = {
      nextCursor: null,
      queryId: "local_change_feed_v1" as const,
      rows: [
        {
          entityId: "item-1",
          ordinal: 0,
          resetRequired: false,
          revision: 1,
          topic: "feed_item",
        },
      ],
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: 1,
        transitionSequence: 1,
      },
    };
    expect(parseLibraryCoreLocalChangeFeedRequestV1(localRequest).ok).toBe(
      true,
    );
    expect(
      parseLibraryCoreLocalChangeFeedResponseV1(localResponse, localRequest).ok,
    ).toBe(true);
    expect(parseLibraryCoreChangeFeedRequestV1(localRequest).ok).toBe(false);
    expect(
      parseLibraryCoreChangeFeedResponseV1(localResponse, localRequest).ok,
    ).toBe(false);
  });
});
