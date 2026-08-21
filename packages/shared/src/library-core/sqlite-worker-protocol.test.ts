import { describe, expect, it } from "vitest";
import { createLibraryCoreNormalizedCheckpointRecordV2 } from "./normalized-checkpoint-contracts.js";
import {
  createLibraryCoreSqliteAppendCheckpointPageWorkerRequest,
  createLibraryCoreSqliteActivateCheckpointWorkerRequest,
  createLibraryCoreSqliteBeginCheckpointWorkerRequest,
  createLibraryCoreSqliteQueryWorkerRequest,
  createLibraryCoreSqliteDeviceGraphLayoutMutationWorkerRequest,
  createLibraryCoreSqliteFollowerIntentCommitWorkerRequest,
  createLibraryCoreSqliteFollowerIntentPageWorkerRequest,
  createLibraryCoreSqliteFollowerIntentPublicationWorkerRequest,
  createLibraryCoreSqliteFollowerResultApplyWorkerRequest,
  createLibraryCoreSqliteWorkerRequest,
  parseLibraryCoreSqliteQueryResponse,
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
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-persons-graph", {
        queryId: "persons_graph_v1",
        recentWindow: { endMs: 200, startMs: 100 },
        rssFeedUrls: ["https://example.com/feed"],
        schemaVersion: 1,
        sources: [{ authorId: "author-1", platform: "x" }],
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
    const analyticsWindows = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        endMs: (index + 1) * 100,
        startMs: index * 100,
      }));
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-saved-analytics", {
        dailyWindows: analyticsWindows(7),
        hourlyWindows: analyticsWindows(24),
        queryId: "saved_analytics_v2",
        schemaVersion: 2,
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
      createLibraryCoreSqliteQueryWorkerRequest("request-account-timeline", {
        accountId: "account-1",
        cancellationId: "cancel-account-timeline-1",
        cursor: null,
        limit: 50,
        queryId: "account_timeline_v1",
        readerSessionId: "reader-account-timeline-1",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-search", {
        cancellationId: "cancel-search-1",
        cursor: null,
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
        friendsPredicateSchemaVersion: 1,
        identityMode: "all_content",
        limit: 32,
        query: "SQLite",
        queryId: "search_page_v1",
        readerSessionId: "reader-search-1",
        recommendationOrderSchemaVersion: 1,
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
      createLibraryCoreSqliteQueryWorkerRequest("request-map", {
        cancellationId: "cancel-map-1",
        limit: 500,
        queryId: "map_markers_v1",
        readerSessionId: "reader-map-1",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-story-wall", {
        cancellationId: "cancel-story-wall-1",
        limit: 100,
        queryId: "story_wall_candidates_v1",
        readerSessionId: "reader-story-wall-1",
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
        friendsPredicateSchemaVersion: 1,
        identityMode: "all_content",
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
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-saved-feed", {
        cancellationId: "cancel-saved-feed" as never,
        cursor: null,
        direction: "next",
        filter: {
          archivedOnly: false,
          authorId: null,
          feedUrl: null,
          platform: null,
          savedOnly: true,
          schemaVersion: 1,
          showHidden: false,
          signals: [],
          socialContentFilter: "all",
          tags: [],
        },
        limit: 64,
        queryId: "saved_feed_page_v2",
        readerSessionId: "reader-saved-feed" as never,
        schemaVersion: 2,
        sortMode: "shortest_read",
      }).kind,
    ).toBe("query");
  });

  it("validates native and browser query responses through one dispatcher", () => {
    const request = {
      queryId: "library_facet_summary_v1" as const,
      schemaVersion: 1 as const,
    };
    const response = {
      queryId: "library_facet_summary_v1",
      schemaVersion: 1,
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 0,
        transitionSequence: 0,
      },
      summary: {
        archivedCount: 0,
        sampleItemCount: 0,
        savedArchivedCount: 0,
        savedCount: 0,
        savedPlatformCount: 0,
        tags: [],
        totalCount: 0,
      },
    };
    expect(parseLibraryCoreSqliteQueryResponse(response, request)).toEqual(
      response,
    );
    expect(() =>
      parseLibraryCoreSqliteQueryResponse(
        { ...response, sql: "SELECT 1" },
        request,
      ),
    ).toThrow(/facet summary response is invalid/);
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

  it("snapshots bounded signed follower intent bytes", () => {
    const bytes = Uint8Array.of(1, 2, 3);
    const request = createLibraryCoreSqliteFollowerIntentCommitWorkerRequest(
      "request-intent",
      { envelopeBytes: [bytes] },
    );
    expect(request.kind).toBe("commit_follower_intent");
    if (request.kind !== "commit_follower_intent") {
      throw new Error("follower intent request lane is invalid");
    }
    bytes[0] = 9;
    expect(request.commit.envelopeBytes[0]).toEqual(Uint8Array.of(1, 2, 3));
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({ ...request, sql: "SELECT 1" }),
    ).toThrow(/identity is invalid/);
  });

  it("carries only closed actor-bound follower intent pages", () => {
    const request = createLibraryCoreSqliteFollowerIntentPageWorkerRequest(
      "request-intent-page",
      {
        actorId: "actor-1",
        cursor: null,
        limit: 128,
        schemaVersion: 1,
      },
    );
    expect(request.kind).toBe("page_follower_intents");
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({ ...request, sql: "SELECT 1" }),
    ).toThrow(/identity is invalid/);
  });

  it("carries only closed exact follower intent publications", () => {
    const request =
      createLibraryCoreSqliteFollowerIntentPublicationWorkerRequest(
        "request-intent-publication",
        {
          actorId: "actor-1",
          publishedAt: 1_000,
          transactionDigest: "a".repeat(64),
          transactionId: "transaction-1",
        },
      );
    expect(request.kind).toBe("publish_follower_intent");
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({ ...request, etag: "alias" }),
    ).toThrow(/identity is invalid/);
  });

  it("snapshots one bounded canonical follower result", () => {
    const bytes = Uint8Array.of(4, 5, 6);
    const request = createLibraryCoreSqliteFollowerResultApplyWorkerRequest(
      "request-result",
      { canonicalResultBytes: bytes },
    );
    expect(request.kind).toBe("apply_follower_result");
    if (request.kind !== "apply_follower_result") {
      throw new Error("follower result request lane is invalid");
    }
    bytes[0] = 9;
    expect(request.apply.canonicalResultBytes).toEqual(Uint8Array.of(4, 5, 6));
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
