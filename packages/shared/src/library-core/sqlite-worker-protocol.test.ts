import { describe, expect, it } from "vitest";
import { createLibraryCoreNormalizedCheckpointRecordV2 } from "./normalized-checkpoint-contracts.js";
import { encodeLibraryCoreCanonicalValue } from "./canonical-codec.js";
import { createLibraryCoreImmutableObjectKey } from "./immutable-transport-contracts.js";
import {
  normalizedResultSegmentHeaderFromBodyV2,
  parseLibraryCoreNormalizedResultSegmentBodyV2,
  parseLibraryCoreNormalizedResultTransportImportV2,
} from "./normalized-result-segment-contracts.js";
import { parseLibraryCoreNormalizedIntentTransportPublicationV2 } from "./normalized-intent-segment-contracts.js";
import {
  createLibraryCoreSqliteAppendCheckpointPageWorkerRequest,
  createLibraryCoreSqliteAppendScopeActionWorkerRequest,
  createLibraryCoreSqliteActivateCheckpointWorkerRequest,
  createLibraryCoreSqliteReadCheckpointReceiptWorkerRequest,
  createLibraryCoreSqliteBeginCheckpointWorkerRequest,
  createLibraryCoreSqliteBeginScopeActionWorkerRequest,
  createLibraryCoreSqliteCloseScopeActionWorkerRequest,
  createLibraryCoreSqliteQueryWorkerRequest,
  createLibraryCoreSqliteDeviceGraphLayoutMutationWorkerRequest,
  createLibraryCoreSqliteFollowerIntentCommitWorkerRequest,
  createLibraryCoreSqliteFollowerIntentPageWorkerRequest,
  createLibraryCoreSqliteFollowerIntentPublicationWorkerRequest,
  createLibraryCoreSqliteFollowerResultApplyWorkerRequest,
  createLibraryCoreSqliteNormalizedIntentTransportPublicationWorkerRequest,
  createLibraryCoreSqliteNormalizedResultTransportImportWorkerRequest,
  createLibraryCoreSqliteFollowerActorEnrollmentContextWorkerRequest,
  createLibraryCoreSqliteInstallFollowerActorEnrollmentWorkerRequest,
  createLibraryCoreSqliteStoreFollowerActorRequestWorkerRequest,
  createLibraryCoreSqliteFinalizeScopeActionWorkerRequest,
  createLibraryCoreSqliteFollowerMutationContextWorkerRequest,
  createLibraryCoreSqliteFollowerTransportContextWorkerRequest,
  createLibraryCoreSqliteFollowerTransportPageWorkerRequest,
  createLibraryCoreSqlitePageScopeActionWorkerRequest,
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

  it("requests the active follower mutation context without carrying authority", () => {
    expect(
      createLibraryCoreSqliteFollowerMutationContextWorkerRequest(
        "request-context",
      ),
    ).toStrictEqual({
      kind: "follower_mutation_context",
      protocolVersion: 2,
      requestId: "request-context",
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
        queryId: "rss_feed_page_v1",
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
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-filter-scope", {
        authorId: "author-1",
        feedUrl: null,
        platform: "x",
        queryId: "filter_scope_summary_v1",
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
      createLibraryCoreSqliteQueryWorkerRequest("request-content-fetch", {
        cancellationId: "cancel-content-fetch-1",
        cursor: null,
        limit: 64,
        queryId: "content_fetch_claim_v1",
        readerSessionId: "reader-content-fetch-1",
        schemaVersion: 1,
      }).kind,
    ).toBe("query");
    expect(
      createLibraryCoreSqliteQueryWorkerRequest("request-provider-media", {
        cancellationId: "cancel-provider-media-1",
        cursor: null,
        limit: 64,
        provider: "facebook",
        queryId: "provider_media_page_v1",
        readerSessionId: "reader-provider-media-1",
        savedOnly: false,
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
        archivableCount: 0,
        enabledRssFeedCount: 0,
        friendPersonCount: 0,
        platformCounts: [],
        rssFeedCount: 0,
        sampleAccountCount: 0,
        sampleFeedCount: 0,
        sampleItemCount: 0,
        samplePersonCount: 0,
        savedArchivedCount: 0,
        savedCount: 0,
        savedPlatformCount: 0,
        socialAccountCount: 0,
        tags: [],
        totalCount: 0,
        unreadCount: 0,
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

    const filterScopeRequest = {
      authorId: null,
      feedUrl: "https://example.com/feed",
      platform: null,
      queryId: "filter_scope_summary_v1" as const,
      schemaVersion: 1 as const,
    };
    const filterScopeResponse = {
      itemCount: 4,
      label: "Example",
      queryId: "filter_scope_summary_v1",
      schemaVersion: 1,
      source: response.source,
    };
    expect(
      parseLibraryCoreSqliteQueryResponse(
        filterScopeResponse,
        filterScopeRequest,
      ),
    ).toEqual(filterScopeResponse);
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

  it("carries only bounded normalized follower transport reads", () => {
    expect(
      createLibraryCoreSqliteFollowerTransportContextWorkerRequest(
        "request-follower-transport",
      ).kind,
    ).toBe("follower_transport_context");
    const request = createLibraryCoreSqliteFollowerTransportPageWorkerRequest(
      "request-follower-transport-page",
      {
        actorId: "a".repeat(64) as never,
        firstActorCounter: 9,
        limit: 128,
        schemaVersion: 2,
      },
    );
    expect(request.kind).toBe("page_follower_transport");
    if (request.kind !== "page_follower_transport") {
      throw new Error("follower transport page request lane is invalid");
    }
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({
        ...request,
        page: { ...request.page, limit: 129 },
      }),
    ).toThrow(/page request is invalid/);
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

  it("carries closed normalized intent and result transport receipts", () => {
    const actorId = "a".repeat(64);
    const libraryId = "b".repeat(64);
    const epochId = "c".repeat(64);
    const storedIntentDigest = "d".repeat(64);
    const intent =
      createLibraryCoreSqliteNormalizedIntentTransportPublicationWorkerRequest(
        "request-normalized-intent",
        parseLibraryCoreNormalizedIntentTransportPublicationV2({
          header: {
            actor_id: actorId,
            canonical_envelope_bytes: 1,
            first_actor_counter: 1,
            format: "freed_normalized_intent_segment_v2",
            kind: "normalized_intent_segment_header",
            last_actor_counter: 1,
            library_id: libraryId,
            previous_segment_digest: null,
            protocol: "normalized_intent_segments_v2",
            protocol_version: 2,
            record_count: 1,
            segment_digest: "e".repeat(64),
            storage_epoch_id: epochId,
          },
          publishedAt: 100,
          reference: {
            descriptor: {
              byteLength: 1,
              contentDigest: storedIntentDigest,
              objectKey: createLibraryCoreImmutableObjectKey({
                actorId,
                digest: storedIntentDigest,
                epochId,
                firstSequence: 1,
                kind: "intent_segment",
                lastSequence: 1,
                libraryId,
              }),
            },
            transportObjectId: "intent-object-1",
          },
        }),
      );
    expect(intent.kind).toBe("publish_normalized_follower_intent_transport");

    const result = {
      actor_id: actorId,
      authoritative_source_revision: 1,
      authority_key_id: "f".repeat(64),
      canonical_operation_ids: ["operation-1"],
      epoch: 1,
      epoch_id: epochId,
      format: "freed_follower_result_v1" as const,
      intent_epoch: 1,
      intent_epoch_id: epochId,
      library_id: libraryId,
      original_result_digest: null,
      previous_result_digest: null,
      receipt_ids: ["receipt-1"],
      rejection_reason: null,
      replacement_fields: [],
      resolved_at_ms: 100,
      result_body_digest: "1".repeat(64),
      result_sequence: 1,
      schema_version: 1 as const,
      signature: "2".repeat(128),
      signature_algorithm: "ed25519" as const,
      status: "accepted" as const,
      transaction_digest: "3".repeat(64),
      transaction_id: "transaction-1",
    };
    const canonicalBytes = encodeLibraryCoreCanonicalValue(result).byteLength;
    const body = parseLibraryCoreNormalizedResultSegmentBodyV2({
      actor_id: actorId,
      canonical_result_bytes: canonicalBytes,
      first_result_sequence: 1,
      format: "freed_normalized_result_segment_v2",
      kind: "normalized_result_segment_body",
      last_result_sequence: 1,
      library_id: libraryId,
      previous_segment_digest: null,
      protocol: "normalized_result_segments_v2",
      protocol_version: 2,
      result_count: 1,
      results: [result],
      storage_epoch_id: epochId,
    });
    const storedResultDigest = "4".repeat(64);
    const imported =
      createLibraryCoreSqliteNormalizedResultTransportImportWorkerRequest(
        "request-normalized-result",
        parseLibraryCoreNormalizedResultTransportImportV2({
          header: normalizedResultSegmentHeaderFromBodyV2(body, "5".repeat(64)),
          receivedAt: 101,
          reference: {
            descriptor: {
              byteLength: canonicalBytes,
              contentDigest: storedResultDigest,
              objectKey: createLibraryCoreImmutableObjectKey({
                actorId,
                digest: storedResultDigest,
                epochId,
                firstSequence: 1,
                kind: "result_segment",
                lastSequence: 1,
                libraryId,
              }),
            },
            transportObjectId: "result-object-1",
          },
          results: [result],
        }),
      );
    expect(imported.kind).toBe("import_normalized_follower_result_transport");
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({ ...imported, sql: "SELECT 1" }),
    ).toThrow(/identity is invalid/);
  });

  it("snapshots the closed follower enrollment lifecycle", () => {
    expect(
      createLibraryCoreSqliteFollowerActorEnrollmentContextWorkerRequest(
        "request-enrollment-context",
      ),
    ).toEqual({
      kind: "read_follower_actor_enrollment_context",
      protocolVersion: 2,
      requestId: "request-enrollment-context",
    });
    const requestBytes = Uint8Array.of(123, 125);
    const store = createLibraryCoreSqliteStoreFollowerActorRequestWorkerRequest(
      "request-enrollment-store",
      { canonicalRequestBytes: requestBytes, createdAt: 100 },
    );
    requestBytes[0] = 0;
    expect(store.kind).toBe("store_follower_actor_request");
    if (store.kind !== "store_follower_actor_request") {
      throw new Error("follower actor request lane is invalid");
    }
    expect(store.store.canonicalRequestBytes).toEqual(Uint8Array.of(123, 125));
    const certificateBytes = Uint8Array.of(123, 125);
    const install =
      createLibraryCoreSqliteInstallFollowerActorEnrollmentWorkerRequest(
        "request-enrollment-install",
        { canonicalCertificateBytes: certificateBytes, enrolledAt: 101 },
      );
    certificateBytes[0] = 0;
    expect(install.kind).toBe("install_follower_actor_enrollment");
    if (install.kind !== "install_follower_actor_enrollment") {
      throw new Error("follower actor enrollment lane is invalid");
    }
    expect(install.install.canonicalCertificateBytes).toEqual(
      Uint8Array.of(123, 125),
    );
  });

  it("carries closed bounded normalized checkpoint stage requests", () => {
    const begin = createLibraryCoreSqliteBeginCheckpointWorkerRequest(
      "request-3",
      {
        authorityEpoch: "epoch-1",
        createdAt: 1_000,
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
      createLibraryCoreSqliteActivateCheckpointWorkerRequest("request-5", {
        followerReceipt: null,
        replaceExisting: false,
        stageId: "stage-1",
      }).kind,
    ).toBe("activate_normalized_checkpoint_stage");
    expect(
      createLibraryCoreSqliteReadCheckpointReceiptWorkerRequest("request-6")
        .kind,
    ).toBe("read_normalized_checkpoint_receipt");
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({ ...append, sql: "SELECT 1" }),
    ).toThrow(/identity is invalid/);
  });

  it("carries only closed bounded SQLite scope action stages", () => {
    const scope = {
      action: "read" as const,
      filter: {
        archivedOnly: false,
        authorId: null,
        feedUrl: null,
        platform: null,
        savedOnly: false,
        schemaVersion: 1 as const,
        showHidden: false,
        signals: [],
        socialContentFilter: "all" as const,
        tags: [],
      },
      identityMode: "all_content" as const,
      query: null,
      schemaVersion: 1 as const,
    };
    expect(
      createLibraryCoreSqliteBeginScopeActionWorkerRequest(
        "begin-scope",
        "stage-1",
        scope,
        1_000,
      ).kind,
    ).toBe("begin_scope_action");
    expect(
      createLibraryCoreSqliteBeginScopeActionWorkerRequest(
        "begin-rss-scope",
        "rss-stage-1",
        { action: "rss_feeds_remove_with_items", schemaVersion: 1 },
        1_000,
      ).kind,
    ).toBe("begin_scope_action");
    const append = createLibraryCoreSqliteAppendScopeActionWorkerRequest(
      "append-scope",
      "stage-1",
      0,
      ["item-1", "item-2"],
    );
    expect(append.kind).toBe("append_scope_action");
    expect(
      createLibraryCoreSqliteFinalizeScopeActionWorkerRequest(
        "finalize-scope",
        "stage-1",
        2,
      ).kind,
    ).toBe("finalize_scope_action");
    expect(
      createLibraryCoreSqlitePageScopeActionWorkerRequest(
        "page-scope",
        "stage-1",
        -1,
      ).kind,
    ).toBe("page_scope_action");
    expect(
      createLibraryCoreSqliteCloseScopeActionWorkerRequest(
        "close-scope",
        "stage-1",
      ).kind,
    ).toBe("close_scope_action");
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({ ...append, sql: "SELECT 1" }),
    ).toThrow(/identity is invalid/);
    expect(() =>
      createLibraryCoreSqliteAppendScopeActionWorkerRequest(
        "oversized-scope",
        "stage-1",
        0,
        Array.from({ length: 257 }, (_, index) => `item-${String(index)}`),
      ),
    ).toThrow(/append request is invalid/);
    expect(() =>
      createLibraryCoreSqliteAppendScopeActionWorkerRequest(
        "oversized-identity",
        "stage-1",
        0,
        ["x".repeat(4_097)],
      ),
    ).toThrow(/append request is invalid/);
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
