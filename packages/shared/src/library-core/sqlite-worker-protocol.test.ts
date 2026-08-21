import { describe, expect, it } from "vitest";
import { createLibraryCoreNormalizedCheckpointRecordV2 } from "./normalized-checkpoint-contracts.js";
import {
  createLibraryCoreSqliteAppendCheckpointPageWorkerRequest,
  createLibraryCoreSqliteBeginCheckpointWorkerRequest,
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
      cancellationId: "cancel-1" as never,
      cursor: null,
      limit: 64,
      queryId: "feed_page_v1",
      readerSessionId: "reader-1" as never,
      schemaVersion: 1,
    });
    expect(request.kind).toBe("query_feed_page");
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({ ...request, sql: "SELECT 1" }),
    ).toThrow(/identity is invalid/);
  });

  it("carries closed bounded normalized checkpoint stage requests", () => {
    const begin = createLibraryCoreSqliteBeginCheckpointWorkerRequest(
      "request-3",
      {
        authorityEpoch: "epoch-1",
        createdAt: 1_000,
        expectedCheckpointDigest: "a".repeat(64) as never,
        expectedRecordCount: 1,
        libraryId: "library-1",
        sourceRevision: 7,
        stageId: "stage-1",
      },
    );
    expect(begin.kind).toBe("begin_normalized_checkpoint_stage");
    const record = createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "00_checkpoint_header",
      primaryKey: "checkpoint",
      payload: {
        authorityEpoch: "epoch-1",
        checkpointId: "library-1:epoch-1:7",
        createdAtMs: 1_000,
        libraryId: "library-1",
        schemaVersion: 1,
        sourceRevision: 7,
      },
    });
    const append = createLibraryCoreSqliteAppendCheckpointPageWorkerRequest(
      "request-4",
      { records: [record], stageId: "stage-1" },
    );
    expect(append.kind).toBe("append_normalized_checkpoint_stage_page");
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({ ...append, sql: "SELECT 1" }),
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
