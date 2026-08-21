import { describe, expect, it } from "vitest";
import { createLibraryCoreNormalizedCheckpointRecordV2 } from "./normalized-checkpoint-contracts.js";
import {
  createLibraryCoreSqliteAppendCheckpointPageWorkerRequest,
  createLibraryCoreSqliteActivateCheckpointWorkerRequest,
  createLibraryCoreSqliteBeginCheckpointWorkerRequest,
  createLibraryCoreSqliteQueryWorkerRequest,
  createLibraryCoreSqliteDeviceGraphLayoutMutationWorkerRequest,
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

  it("carries only registered closed query contracts", () => {
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-account", {
        accountId: "account-1",
        queryId: "account_detail_v1",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-person-graph", {
        cancellationId: "cancel-person-graph",
        cursor: null,
        limit: 64,
        queryId: "person_graph_page_v1",
        readerSessionId: "reader-person-graph",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-account-graph", {
        cancellationId: "cancel-account-graph",
        cursor: null,
        limit: 64,
        queryId: "account_graph_page_v1",
        readerSessionId: "reader-account-graph",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-rss-feed-graph", {
        cancellationId: "cancel-rss-feed-graph",
        cursor: null,
        limit: 64,
        queryId: "rss_feed_graph_page_v1",
        readerSessionId: "reader-rss-feed-graph",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    const request = createLibraryCoreSqliteQueryWorkerRequest("request-2", {
      cancellationId: "cancel-1" as never,
      cursor: null,
      limit: 64,
      queryId: "feed_page_v1",
      readerSessionId: "reader-1" as never,
      schemaVersion: 1,
    });
    expect(request.kind).toBe("query");
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({ ...request, sql: "SELECT 1" }),
    ).toThrow(/identity is invalid/);
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-facets", {
        queryId: "library_facet_summary_v1",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-item", {
        globalId: "item-1",
        queryId: "item_detail_v1",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-item-body", {
        bodyKind: "content",
        globalId: "item-1",
        limitBytes: 65_536,
        offsetBytes: 0,
        queryId: "item_reader_body_v1",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-person", {
        personId: "person-1",
        queryId: "person_detail_v1",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-person-timeline", {
        cancellationId: "cancel-person-timeline-1",
        cursor: null,
        limit: 50,
        personId: "person-1",
        queryId: "person_timeline_v1",
        readerSessionId: "reader-person-timeline-1",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-item-scan", {
        cancellationId: "cancel-scan-1",
        cursor: null,
        limit: 64,
        queryId: "background_item_page_v1",
        readerSessionId: "reader-scan-1",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-change-feed", {
        afterRevision: 0,
        cancellationId: "cancel-changes-1",
        cursor: null,
        limit: 128,
        queryId: "change_feed_v1",
        readerSessionId: "reader-changes-1",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    const browse = createLibraryCoreSqliteQueryWorkerRequest(
      "request-feed-browse",
      {
        cancellationId: "cancel-feed-browse" as never,
        cursor: null,
        direction: "next",
        filter: {
          archivedOnly: false,
          authorId: null,
          feedUrl: null,
          platform: null,
          savedOnly: false,
          schemaVersion: 1,
          showHidden: false,
          signals: [],
          socialContentFilter: "all",
          tags: [],
        },
        limit: 64,
        queryId: "feed_browse_page_v3",
        rankingClockMs: 1_000,
        readerSessionId: "reader-feed-browse" as never,
        recommendationOrderSchemaVersion: 1,
        schemaVersion: 3,
      },
    );
    expect(browse.kind).toBe("query");
    if (browse.kind !== "query") throw new Error("browse query is invalid");
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({
        ...browse,
        query: { ...browse.query, sourceSequence: 7 },
      }),
    ).toThrow(/browse request fields do not match schema version 3/);
  });

  it("carries only closed device-local graph mutations", () => {
    const request =
      createLibraryCoreSqliteDeviceGraphLayoutMutationWorkerRequest(
        "request-layout",
        {
          entityId: "person-1",
          graphX: 12.5,
          graphY: -8.25,
          mutationId: "person_graph_position_set_v1",
          schemaVersion: 1,
          updatedAt: 42,
        },
      );
    expect(request.kind).toBe("mutate_device_graph_layout");
    if (request.kind !== "mutate_device_graph_layout") {
      throw new Error("device graph layout request lane is invalid");
    }
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({
        ...request,
        mutation: { ...request.mutation, canonicalRevision: 8 },
      }),
    ).toThrow(/device graph layout mutation is invalid/);
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
    expect(
      createLibraryCoreSqliteActivateCheckpointWorkerRequest(
        "request-5",
        "stage-1",
      ).kind,
    ).toBe("activate_normalized_checkpoint_stage");
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
