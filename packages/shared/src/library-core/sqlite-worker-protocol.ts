import {
  parseLibraryCoreAccountDetailRequestV1,
  parseLibraryCoreAccountDetailResponseV1,
  type LibraryCoreAccountDetailRequestV1,
  type LibraryCoreAccountDetailResponseV1,
} from "./account-detail-contracts.js";
import {
  parseLibraryCoreAccountTimelineRequestV1,
  parseLibraryCoreAccountTimelineResponseV1,
  type LibraryCoreAccountTimelineRequestV1,
  type LibraryCoreAccountTimelineResponseV1,
} from "./account-timeline-contracts.js";
import {
  parseLibraryCoreAccountGraphPageRequestV1,
  parseLibraryCoreAccountGraphPageResponseV1,
  parseLibraryCorePersonGraphPageRequestV1,
  parseLibraryCorePersonGraphPageResponseV1,
  parseLibraryCoreRssFeedGraphPageRequestV1,
  parseLibraryCoreRssFeedGraphPageResponseV1,
  type LibraryCoreAccountGraphPageRequestV1,
  type LibraryCoreAccountGraphPageResponseV1,
  type LibraryCorePersonGraphPageRequestV1,
  type LibraryCorePersonGraphPageResponseV1,
  type LibraryCoreRssFeedGraphPageRequestV1,
  type LibraryCoreRssFeedGraphPageResponseV1,
} from "./friends-identity-page-contracts.js";
import {
  parseLibraryCoreChangeFeedRequestV1,
  parseLibraryCoreChangeFeedResponseV1,
  type LibraryCoreChangeFeedRequestV1,
  type LibraryCoreChangeFeedResponseV1,
} from "./change-feed-contracts.js";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
} from "./sqlite-contract.generated.js";
import type {
  LibraryCoreFeedPageRequestV1,
  LibraryCoreFeedPageResponseV1,
} from "./feed-page-contracts.js";
import {
  parseLibraryCoreFeedPageRequestV1,
  parseLibraryCoreFeedPageResponseV1,
} from "./feed-page-contracts.js";
import {
  parseLibraryCoreFeedBrowsePageRequestV3,
  parseLibraryCoreFeedBrowsePageResponseV3,
  type LibraryCoreFeedBrowsePageRequestV3,
  type LibraryCoreFeedBrowsePageResponseV3,
} from "./feed-browse-page-contracts.js";
import {
  parseLibraryCoreFacetSummaryRequestV1,
  parseLibraryCoreFacetSummaryResponseV1,
  type LibraryCoreFacetSummaryRequestV1,
  type LibraryCoreFacetSummaryResponseV1,
} from "./facet-summary-contracts.js";
import {
  parseLibraryCoreSavedAnalyticsRequestV2,
  parseLibraryCoreSavedAnalyticsResponseV2,
  type LibraryCoreSavedAnalyticsRequestV2,
  type LibraryCoreSavedAnalyticsResponseV2,
} from "./saved-analytics-v2-contracts.js";
import {
  parseLibraryCoreSavedFeedPageRequestV2,
  parseLibraryCoreSavedFeedPageResponseV2,
  type LibraryCoreSavedFeedPageRequestV2,
  type LibraryCoreSavedFeedPageResponseV2,
} from "./saved-feed-page-contracts.js";
import {
  parseLibraryCorePreferencesSnapshotRequestV1,
  parseLibraryCorePreferencesSnapshotResponseV1,
  type LibraryCorePreferencesSnapshotRequestV1,
  type LibraryCorePreferencesSnapshotResponseV1,
} from "./preferences-snapshot-contracts.js";
import {
  parseLibraryCoreItemDetailRequestV1,
  parseLibraryCoreItemDetailResponseV1,
  type LibraryCoreItemDetailRequestV1,
  type LibraryCoreItemDetailResponseV1,
} from "./item-detail-contracts.js";
import {
  parseLibraryCoreItemReaderBodyRequestV1,
  parseLibraryCoreItemReaderBodyResponseV1,
  type LibraryCoreItemReaderBodyRequestV1,
  type LibraryCoreItemReaderBodyResponseV1,
} from "./item-reader-body-contracts.js";
import {
  parseLibraryCoreItemScanRequestV1,
  parseLibraryCoreItemScanResponseV1,
  type LibraryCoreItemScanRequestV1,
  type LibraryCoreItemScanResponseV1,
} from "./item-scan-contracts.js";
import {
  parseLibraryCorePersonDetailRequestV1,
  parseLibraryCorePersonDetailResponseV1,
  type LibraryCorePersonDetailRequestV1,
  type LibraryCorePersonDetailResponseV1,
} from "./person-detail-contracts.js";
import {
  parseLibraryCorePersonTimelineRequestV1,
  parseLibraryCorePersonTimelineResponseV1,
  type LibraryCorePersonTimelineRequestV1,
  type LibraryCorePersonTimelineResponseV1,
} from "./person-timeline-contracts.js";
import {
  parseLibraryCoreBeginNormalizedCheckpointStageV2,
  parseLibraryCoreNormalizedCheckpointStageIdV2,
  parseLibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreBeginNormalizedCheckpointStageV2,
  type LibraryCoreNormalizedCheckpointActivationReceiptV2,
  type LibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreNormalizedCheckpointStageStatusV2,
} from "./normalized-checkpoint-stage-contracts.js";
import {
  parseLibraryCoreDeviceGraphLayoutMutationV1,
  type LibraryCoreDeviceGraphLayoutMutationResultV1,
  type LibraryCoreDeviceGraphLayoutMutationV1,
} from "./device-graph-layout-mutation-contracts.js";
import {
  parseLibraryCoreFollowerIntentCommitV1,
  type LibraryCoreFollowerIntentCommitResultV1,
  type LibraryCoreFollowerIntentCommitV1,
  parseLibraryCoreFollowerIntentPageRequestV1,
  parseLibraryCoreFollowerIntentPublicationV1,
  type LibraryCoreFollowerIntentPageRequestV1,
  type LibraryCoreFollowerIntentPageResponseV1,
  type LibraryCoreFollowerIntentPublicationReceiptV1,
  type LibraryCoreFollowerIntentPublicationV1,
} from "./follower-intent-contracts.js";
import {
  parseLibraryCoreFollowerResultApplyV1,
  type LibraryCoreFollowerResultApplyReceiptV1,
  type LibraryCoreFollowerResultApplyV1,
} from "./follower-result-contracts.js";
import {
  parseLibraryCoreMapMarkersRequestV1,
  parseLibraryCoreMapMarkersResponseV1,
  parseLibraryCoreStoryWallCandidatesRequestV1,
  parseLibraryCoreStoryWallCandidatesResponseV1,
  type LibraryCoreMapMarkersRequestV1,
  type LibraryCoreMapMarkersResponseV1,
  type LibraryCoreStoryWallCandidatesRequestV1,
  type LibraryCoreStoryWallCandidatesResponseV1,
} from "./secondary-surface-contracts.js";

export const LIBRARY_CORE_SQLITE_WORKER_MAXIMUM_PENDING_REQUESTS = 128 as const;

export type LibraryCoreSqliteQueryRequest =
  | LibraryCoreAccountDetailRequestV1
  | LibraryCoreAccountGraphPageRequestV1
  | LibraryCoreAccountTimelineRequestV1
  | LibraryCoreChangeFeedRequestV1
  | LibraryCoreFacetSummaryRequestV1
  | LibraryCoreFeedBrowsePageRequestV3
  | LibraryCoreFeedPageRequestV1
  | LibraryCoreItemDetailRequestV1
  | LibraryCoreItemReaderBodyRequestV1
  | LibraryCoreItemScanRequestV1
  | LibraryCoreMapMarkersRequestV1
  | LibraryCorePersonDetailRequestV1
  | LibraryCorePersonGraphPageRequestV1
  | LibraryCorePersonTimelineRequestV1
  | LibraryCoreRssFeedGraphPageRequestV1
  | LibraryCoreSavedAnalyticsRequestV2
  | LibraryCoreSavedFeedPageRequestV2
  | LibraryCoreStoryWallCandidatesRequestV1
  | LibraryCorePreferencesSnapshotRequestV1;

export type LibraryCoreSqliteQueryResponseFor<
  T extends LibraryCoreSqliteQueryRequest,
> = T extends LibraryCoreFacetSummaryRequestV1
  ? LibraryCoreFacetSummaryResponseV1
  : T extends LibraryCoreAccountDetailRequestV1
    ? LibraryCoreAccountDetailResponseV1
    : T extends LibraryCoreAccountGraphPageRequestV1
      ? LibraryCoreAccountGraphPageResponseV1
      : T extends LibraryCoreAccountTimelineRequestV1
        ? LibraryCoreAccountTimelineResponseV1
        : T extends LibraryCoreChangeFeedRequestV1
          ? LibraryCoreChangeFeedResponseV1
          : T extends LibraryCoreFeedBrowsePageRequestV3
            ? LibraryCoreFeedBrowsePageResponseV3
            : T extends LibraryCoreFeedPageRequestV1
              ? LibraryCoreFeedPageResponseV1
              : T extends LibraryCoreItemDetailRequestV1
                ? LibraryCoreItemDetailResponseV1
                : T extends LibraryCoreItemReaderBodyRequestV1
                  ? LibraryCoreItemReaderBodyResponseV1
                  : T extends LibraryCoreItemScanRequestV1
                    ? LibraryCoreItemScanResponseV1
                    : T extends LibraryCoreMapMarkersRequestV1
                      ? LibraryCoreMapMarkersResponseV1
                      : T extends LibraryCorePersonDetailRequestV1
                        ? LibraryCorePersonDetailResponseV1
                        : T extends LibraryCorePersonGraphPageRequestV1
                          ? LibraryCorePersonGraphPageResponseV1
                          : T extends LibraryCorePersonTimelineRequestV1
                            ? LibraryCorePersonTimelineResponseV1
                            : T extends LibraryCoreRssFeedGraphPageRequestV1
                              ? LibraryCoreRssFeedGraphPageResponseV1
                              : T extends LibraryCoreSavedAnalyticsRequestV2
                                ? LibraryCoreSavedAnalyticsResponseV2
                                : T extends LibraryCoreSavedFeedPageRequestV2
                                  ? LibraryCoreSavedFeedPageResponseV2
                                  : T extends LibraryCoreStoryWallCandidatesRequestV1
                                    ? LibraryCoreStoryWallCandidatesResponseV1
                                    : T extends LibraryCorePreferencesSnapshotRequestV1
                                      ? LibraryCorePreferencesSnapshotResponseV1
                                      : never;

/** Validates one native or browser query response against its exact request. */
export function parseLibraryCoreSqliteQueryResponse<
  T extends LibraryCoreSqliteQueryRequest,
>(value: unknown, request: T): LibraryCoreSqliteQueryResponseFor<T> {
  const parsed =
    request.queryId === "account_detail_v1"
      ? parseLibraryCoreAccountDetailResponseV1(value, request)
      : request.queryId === "account_graph_page_v1"
        ? parseLibraryCoreAccountGraphPageResponseV1(value, request)
        : request.queryId === "account_timeline_v1"
          ? parseLibraryCoreAccountTimelineResponseV1(value, request)
          : request.queryId === "change_feed_v1"
            ? parseLibraryCoreChangeFeedResponseV1(value, request)
            : request.queryId === "library_facet_summary_v1"
              ? parseLibraryCoreFacetSummaryResponseV1(value)
              : request.queryId === "feed_browse_page_v3"
                ? parseLibraryCoreFeedBrowsePageResponseV3(value, request)
                : request.queryId === "feed_page_v1"
                  ? parseLibraryCoreFeedPageResponseV1(value, request)
                  : request.queryId === "item_detail_v1"
                    ? parseLibraryCoreItemDetailResponseV1(value, request)
                    : request.queryId === "item_reader_body_v1"
                      ? parseLibraryCoreItemReaderBodyResponseV1(value, request)
                      : request.queryId === "background_item_page_v1"
                        ? parseLibraryCoreItemScanResponseV1(value, request)
                        : request.queryId === "map_markers_v1"
                          ? parseLibraryCoreMapMarkersResponseV1(value, request)
                          : request.queryId === "person_detail_v1"
                            ? parseLibraryCorePersonDetailResponseV1(
                                value,
                                request,
                              )
                            : request.queryId === "person_graph_page_v1"
                              ? parseLibraryCorePersonGraphPageResponseV1(
                                  value,
                                  request,
                                )
                              : request.queryId === "person_timeline_v1"
                                ? parseLibraryCorePersonTimelineResponseV1(
                                    value,
                                    request,
                                  )
                                : request.queryId === "preferences_snapshot_v1"
                                  ? parseLibraryCorePreferencesSnapshotResponseV1(
                                      value,
                                    )
                                  : request.queryId === "rss_feed_graph_page_v1"
                                    ? parseLibraryCoreRssFeedGraphPageResponseV1(
                                        value,
                                        request,
                                      )
                                    : request.queryId === "saved_analytics_v2"
                                      ? parseLibraryCoreSavedAnalyticsResponseV2(
                                          value,
                                        )
                                      : request.queryId === "saved_feed_page_v2"
                                        ? parseLibraryCoreSavedFeedPageResponseV2(
                                            value,
                                            request,
                                          )
                                        : parseLibraryCoreStoryWallCandidatesResponseV1(
                                            value,
                                            request,
                                          );
  if (!parsed.ok) {
    throw new TypeError(parsed.error);
  }
  return parsed.value as LibraryCoreSqliteQueryResponseFor<T>;
}

export type LibraryCoreSqliteWorkerRequest =
  | Readonly<{
      kind: "open";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "status";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "close";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "query";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      query: LibraryCoreSqliteQueryRequest;
      requestId: string;
    }>
  | Readonly<{
      kind: "mutate_device_graph_layout";
      mutation: LibraryCoreDeviceGraphLayoutMutationV1;
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      commit: LibraryCoreFollowerIntentCommitV1;
      kind: "commit_follower_intent";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "page_follower_intents";
      page: LibraryCoreFollowerIntentPageRequestV1;
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "publish_follower_intent";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      publication: LibraryCoreFollowerIntentPublicationV1;
      requestId: string;
    }>
  | Readonly<{
      apply: LibraryCoreFollowerResultApplyV1;
      kind: "apply_follower_result";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "begin_normalized_checkpoint_stage";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
      stage: LibraryCoreBeginNormalizedCheckpointStageV2;
    }>
  | Readonly<{
      kind: "append_normalized_checkpoint_stage_page";
      page: LibraryCoreNormalizedCheckpointStagePageV2;
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "activate_normalized_checkpoint_stage";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
      stageId: string;
    }>;

export interface LibraryCoreSqliteWorkerStatus {
  readonly connectionGeneration: number;
  readonly contractVersion: typeof LIBRARY_CORE_SQLITE_CONTRACT_VERSION;
  readonly engine: "sqlite-wasm-opfs-sahpool";
  readonly protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
  readonly schemaSha256: typeof LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256;
  readonly schemaVersion: typeof LIBRARY_CORE_SQLITE_SCHEMA_VERSION;
  readonly sqliteVersion: string;
  readonly storage: "opfs";
}

export type LibraryCoreSqliteWorkerResult =
  | LibraryCoreAccountDetailResponseV1
  | LibraryCoreAccountGraphPageResponseV1
  | LibraryCoreAccountTimelineResponseV1
  | LibraryCoreChangeFeedResponseV1
  | LibraryCoreFacetSummaryResponseV1
  | LibraryCoreFeedBrowsePageResponseV3
  | LibraryCoreFeedPageResponseV1
  | LibraryCoreItemDetailResponseV1
  | LibraryCoreItemReaderBodyResponseV1
  | LibraryCoreItemScanResponseV1
  | LibraryCoreMapMarkersResponseV1
  | LibraryCorePersonDetailResponseV1
  | LibraryCorePersonGraphPageResponseV1
  | LibraryCorePersonTimelineResponseV1
  | LibraryCoreRssFeedGraphPageResponseV1
  | LibraryCoreSavedAnalyticsResponseV2
  | LibraryCoreSavedFeedPageResponseV2
  | LibraryCoreStoryWallCandidatesResponseV1
  | LibraryCorePreferencesSnapshotResponseV1
  | LibraryCoreNormalizedCheckpointStageStatusV2
  | LibraryCoreNormalizedCheckpointActivationReceiptV2
  | LibraryCoreDeviceGraphLayoutMutationResultV1
  | LibraryCoreFollowerIntentCommitResultV1
  | LibraryCoreFollowerIntentPageResponseV1
  | LibraryCoreFollowerIntentPublicationReceiptV1
  | LibraryCoreFollowerResultApplyReceiptV1;

export type LibraryCoreSqliteWorkerResponse =
  | Readonly<{
      ok: true;
      requestId: string;
      status: LibraryCoreSqliteWorkerStatus;
    }>
  | Readonly<{
      ok: true;
      requestId: string;
      result: LibraryCoreSqliteWorkerResult;
    }>
  | Readonly<{
      code:
        | "invalid_request"
        | "library_busy"
        | "sqlite_initialization_failed"
        | "sqlite_integrity_failed";
      message: string;
      ok: false;
      requestId: string;
    }>;

function isClosedRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function parseLibraryCoreSqliteWorkerRequest(
  value: unknown,
): LibraryCoreSqliteWorkerRequest {
  if (!isClosedRecord(value)) {
    throw new TypeError("SQLite worker request must be a closed record");
  }
  const keys = Object.keys(value).sort();
  const expectedKeys =
    value.kind === "query"
      ? ["kind", "protocolVersion", "query", "requestId"]
      : value.kind === "mutate_device_graph_layout"
        ? ["kind", "mutation", "protocolVersion", "requestId"]
        : value.kind === "commit_follower_intent"
          ? ["commit", "kind", "protocolVersion", "requestId"]
          : value.kind === "page_follower_intents"
            ? ["kind", "page", "protocolVersion", "requestId"]
            : value.kind === "publish_follower_intent"
              ? ["kind", "protocolVersion", "publication", "requestId"]
              : value.kind === "apply_follower_result"
                ? ["apply", "kind", "protocolVersion", "requestId"]
                : value.kind === "begin_normalized_checkpoint_stage"
                  ? ["kind", "protocolVersion", "requestId", "stage"]
                  : value.kind === "append_normalized_checkpoint_stage_page"
                    ? ["kind", "page", "protocolVersion", "requestId"]
                    : value.kind === "activate_normalized_checkpoint_stage"
                      ? ["kind", "protocolVersion", "requestId", "stageId"]
                      : ["kind", "protocolVersion", "requestId"];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    ![
      "activate_normalized_checkpoint_stage",
      "apply_follower_result",
      "append_normalized_checkpoint_stage_page",
      "begin_normalized_checkpoint_stage",
      "close",
      "commit_follower_intent",
      "mutate_device_graph_layout",
      "open",
      "page_follower_intents",
      "publish_follower_intent",
      "query",
      "status",
    ].includes(String(value.kind)) ||
    value.protocolVersion !== LIBRARY_CORE_SQLITE_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    value.requestId.length === 0 ||
    value.requestId.length > 255
  ) {
    throw new TypeError("SQLite worker request identity is invalid");
  }
  if (value.kind === "begin_normalized_checkpoint_stage") {
    parseLibraryCoreBeginNormalizedCheckpointStageV2(value.stage);
  } else if (value.kind === "append_normalized_checkpoint_stage_page") {
    parseLibraryCoreNormalizedCheckpointStagePageV2(value.page);
  } else if (value.kind === "activate_normalized_checkpoint_stage") {
    parseLibraryCoreNormalizedCheckpointStageIdV2(value.stageId);
  } else if (value.kind === "query") {
    const query = isClosedRecord(value.query)
      ? value.query.queryId === "account_detail_v1"
        ? parseLibraryCoreAccountDetailRequestV1(value.query)
        : value.query.queryId === "account_graph_page_v1"
          ? parseLibraryCoreAccountGraphPageRequestV1(value.query)
          : value.query.queryId === "account_timeline_v1"
            ? parseLibraryCoreAccountTimelineRequestV1(value.query)
            : value.query.queryId === "library_facet_summary_v1"
              ? parseLibraryCoreFacetSummaryRequestV1(value.query)
              : value.query.queryId === "change_feed_v1"
                ? parseLibraryCoreChangeFeedRequestV1(value.query)
                : value.query.queryId === "feed_browse_page_v3"
                  ? parseLibraryCoreFeedBrowsePageRequestV3(value.query)
                  : value.query.queryId === "item_detail_v1"
                    ? parseLibraryCoreItemDetailRequestV1(value.query)
                    : value.query.queryId === "item_reader_body_v1"
                      ? parseLibraryCoreItemReaderBodyRequestV1(value.query)
                      : value.query.queryId === "background_item_page_v1"
                        ? parseLibraryCoreItemScanRequestV1(value.query)
                        : value.query.queryId === "map_markers_v1"
                          ? parseLibraryCoreMapMarkersRequestV1(value.query)
                          : value.query.queryId === "person_detail_v1"
                            ? parseLibraryCorePersonDetailRequestV1(value.query)
                            : value.query.queryId === "person_graph_page_v1"
                              ? parseLibraryCorePersonGraphPageRequestV1(
                                  value.query,
                                )
                              : value.query.queryId === "person_timeline_v1"
                                ? parseLibraryCorePersonTimelineRequestV1(
                                    value.query,
                                  )
                                : value.query.queryId ===
                                    "rss_feed_graph_page_v1"
                                  ? parseLibraryCoreRssFeedGraphPageRequestV1(
                                      value.query,
                                    )
                                  : value.query.queryId === "saved_analytics_v2"
                                    ? parseLibraryCoreSavedAnalyticsRequestV2(
                                        value.query,
                                      )
                                    : value.query.queryId ===
                                        "saved_feed_page_v2"
                                      ? parseLibraryCoreSavedFeedPageRequestV2(
                                          value.query,
                                        )
                                      : value.query.queryId ===
                                          "story_wall_candidates_v1"
                                        ? parseLibraryCoreStoryWallCandidatesRequestV1(
                                            value.query,
                                          )
                                        : value.query.queryId ===
                                            "preferences_snapshot_v1"
                                          ? parseLibraryCorePreferencesSnapshotRequestV1(
                                              value.query,
                                            )
                                          : parseLibraryCoreFeedPageRequestV1(
                                              value.query,
                                            )
      : parseLibraryCoreFeedPageRequestV1(value.query);
    if (!query.ok) throw new TypeError(query.error);
  } else if (value.kind === "mutate_device_graph_layout") {
    const mutation = parseLibraryCoreDeviceGraphLayoutMutationV1(
      value.mutation,
    );
    if (!mutation.ok) throw new TypeError(mutation.error);
  } else if (value.kind === "commit_follower_intent") {
    const commit = parseLibraryCoreFollowerIntentCommitV1(value.commit);
    return Object.freeze({
      commit,
      kind: "commit_follower_intent",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  } else if (value.kind === "page_follower_intents") {
    return Object.freeze({
      kind: "page_follower_intents",
      page: parseLibraryCoreFollowerIntentPageRequestV1(value.page),
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  } else if (value.kind === "publish_follower_intent") {
    return Object.freeze({
      kind: "publish_follower_intent",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      publication: parseLibraryCoreFollowerIntentPublicationV1(
        value.publication,
      ),
      requestId: value.requestId,
    });
  } else if (value.kind === "apply_follower_result") {
    return Object.freeze({
      apply: parseLibraryCoreFollowerResultApplyV1(value.apply),
      kind: "apply_follower_result",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  }
  return value as unknown as LibraryCoreSqliteWorkerRequest;
}

export function createLibraryCoreSqliteFollowerResultApplyWorkerRequest(
  requestId: string,
  apply: LibraryCoreFollowerResultApplyV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    apply,
    kind: "apply_follower_result",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteFollowerIntentCommitWorkerRequest(
  requestId: string,
  commit: LibraryCoreFollowerIntentCommitV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    commit,
    kind: "commit_follower_intent",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteFollowerIntentPageWorkerRequest(
  requestId: string,
  page: LibraryCoreFollowerIntentPageRequestV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "page_follower_intents",
    page,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteFollowerIntentPublicationWorkerRequest(
  requestId: string,
  publication: LibraryCoreFollowerIntentPublicationV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "publish_follower_intent",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    publication,
    requestId,
  });
}

export function createLibraryCoreSqliteWorkerRequest(
  kind: "close" | "open" | "status",
  requestId: string,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteQueryWorkerRequest<
  T extends LibraryCoreSqliteQueryRequest,
>(requestId: string, query: T): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "query",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    query,
    requestId,
  });
}

export function createLibraryCoreSqliteDeviceGraphLayoutMutationWorkerRequest(
  requestId: string,
  mutation: LibraryCoreDeviceGraphLayoutMutationV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "mutate_device_graph_layout",
    mutation,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteBeginCheckpointWorkerRequest(
  requestId: string,
  stage: LibraryCoreBeginNormalizedCheckpointStageV2,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "begin_normalized_checkpoint_stage",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
    stage,
  });
}

export function createLibraryCoreSqliteAppendCheckpointPageWorkerRequest(
  requestId: string,
  page: LibraryCoreNormalizedCheckpointStagePageV2,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "append_normalized_checkpoint_stage_page",
    page,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteActivateCheckpointWorkerRequest(
  requestId: string,
  stageId: string,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "activate_normalized_checkpoint_stage",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
    stageId,
  });
}
