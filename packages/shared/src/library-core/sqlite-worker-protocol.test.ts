import { describe, expect, it } from "vitest";
import {
  createLibraryCoreSqliteFeedPageWorkerRequest,
  createLibraryCoreSqliteWorkerRequest,
  parseLibraryCoreSqliteWorkerRequest,
} from "./sqlite-worker-protocol.js";

describe("Library Core SQLite worker protocol", () => {
  it("creates a closed versioned request", () => {
    expect(createLibraryCoreSqliteWorkerRequest("open", "request-1")).toEqual({
      kind: "open",
      protocolVersion: 2,
      requestId: "request-1",
    });
  });

  it("carries only the closed feed-page query contract", () => {
    const request = createLibraryCoreSqliteFeedPageWorkerRequest("request-2", {
      cancellationId: "cancel-1",
      cursor: null,
      limit: 64,
      queryId: "feed_page_v1",
      readerSessionId: "reader-1",
      schemaVersion: 1,
    });
    expect(request.kind).toBe("query_feed_page");
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({ ...request, sql: "SELECT 1" }),
    ).toThrow(/identity is invalid/);
  });

  it("rejects unknown fields, versions, kinds, and unbounded identities", () => {
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({
        kind: "open",
        protocolVersion: 2,
        requestId: "request-1",
        sql: "DROP TABLE library_meta",
      }),
    ).toThrow(/identity is invalid/);
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({
        kind: "open",
        protocolVersion: 1,
        requestId: "request-1",
      }),
    ).toThrow(/identity is invalid/);
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({
        kind: "execute_sql",
        protocolVersion: 2,
        requestId: "request-1",
      }),
    ).toThrow(/identity is invalid/);
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({
        kind: "open",
        protocolVersion: 2,
        requestId: "x".repeat(256),
      }),
    ).toThrow(/identity is invalid/);
  });
});
