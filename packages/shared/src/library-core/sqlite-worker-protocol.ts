import {
  parseLibraryCoreAccountDetailRequestV1,
  type LibraryCoreAccountDetailRequestV1,
  type LibraryCoreAccountDetailResponseV1,
} from "./account-detail-contracts.js";
import {
  parseLibraryCoreChangeFeedRequestV1,
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
import { parseLibraryCoreFeedPageRequestV1 } from "./feed-page-contracts.js";
import {
  parseLibraryCoreFacetSummaryRequestV1,
  type LibraryCoreFacetSummaryRequestV1,
  type LibraryCoreFacetSummaryResponseV1,
} from "./facet-summary-contracts.js";
import {
  parseLibraryCorePreferencesSnapshotRequestV1,
  type LibraryCorePreferencesSnapshotRequestV1,
  type LibraryCorePreferencesSnapshotResponseV1,
} from "./preferences-snapshot-contracts.js";
import {
  parseLibraryCoreItemDetailRequestV1,
  type LibraryCoreItemDetailRequestV1,
  type LibraryCoreItemDetailResponseV1,
} from "./item-detail-contracts.js";
import {
  parseLibraryCoreItemReaderBodyRequestV1,
  type LibraryCoreItemReaderBodyRequestV1,
  type LibraryCoreItemReaderBodyResponseV1,
} from "./item-reader-body-contracts.js";
import {
  parseLibraryCoreItemScanRequestV1,
  type LibraryCoreItemScanRequestV1,
  type LibraryCoreItemScanResponseV1,
} from "./item-scan-contracts.js";
import {
  parseLibraryCorePersonDetailRequestV1,
  type LibraryCorePersonDetailRequestV1,
  type LibraryCorePersonDetailResponseV1,
} from "./person-detail-contracts.js";
import {
  parseLibraryCoreBeginNormalizedCheckpointStageV2,
  parseLibraryCoreNormalizedCheckpointStageIdV2,
  parseLibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreBeginNormalizedCheckpointStageV2,
  type LibraryCoreNormalizedCheckpointActivationReceiptV2,
  type LibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreNormalizedCheckpointStageStatusV2,
} from "./normalized-checkpoint-stage-contracts.js";

export const LIBRARY_CORE_SQLITE_WORKER_MAXIMUM_PENDING_REQUESTS = 128 as const;

export type LibraryCoreSqliteQueryRequest =
  | LibraryCoreAccountDetailRequestV1
  | LibraryCoreChangeFeedRequestV1
  | LibraryCoreFacetSummaryRequestV1
  | LibraryCoreFeedPageRequestV1
  | LibraryCoreItemDetailRequestV1
  | LibraryCoreItemReaderBodyRequestV1
  | LibraryCoreItemScanRequestV1
  | LibraryCorePersonDetailRequestV1
  | LibraryCorePreferencesSnapshotRequestV1;

export type LibraryCoreSqliteQueryResponseFor<
  T extends LibraryCoreSqliteQueryRequest,
> = T extends LibraryCoreFacetSummaryRequestV1
  ? LibraryCoreFacetSummaryResponseV1
  : T extends LibraryCoreAccountDetailRequestV1
    ? LibraryCoreAccountDetailResponseV1
    : T extends LibraryCoreChangeFeedRequestV1
      ? LibraryCoreChangeFeedResponseV1
      : T extends LibraryCoreFeedPageRequestV1
        ? LibraryCoreFeedPageResponseV1
        : T extends LibraryCoreItemDetailRequestV1
          ? LibraryCoreItemDetailResponseV1
          : T extends LibraryCoreItemReaderBodyRequestV1
            ? LibraryCoreItemReaderBodyResponseV1
            : T extends LibraryCoreItemScanRequestV1
              ? LibraryCoreItemScanResponseV1
              : T extends LibraryCorePersonDetailRequestV1
                ? LibraryCorePersonDetailResponseV1
                : T extends LibraryCorePreferencesSnapshotRequestV1
                  ? LibraryCorePreferencesSnapshotResponseV1
                  : never;

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
  | LibraryCoreChangeFeedResponseV1
  | LibraryCoreFacetSummaryResponseV1
  | LibraryCoreFeedPageResponseV1
  | LibraryCoreItemDetailResponseV1
  | LibraryCoreItemReaderBodyResponseV1
  | LibraryCoreItemScanResponseV1
  | LibraryCorePersonDetailResponseV1
  | LibraryCorePreferencesSnapshotResponseV1
  | LibraryCoreNormalizedCheckpointStageStatusV2
  | LibraryCoreNormalizedCheckpointActivationReceiptV2;

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
      "append_normalized_checkpoint_stage_page",
      "begin_normalized_checkpoint_stage",
      "close",
      "open",
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
        : value.query.queryId === "library_facet_summary_v1"
          ? parseLibraryCoreFacetSummaryRequestV1(value.query)
          : value.query.queryId === "change_feed_v1"
            ? parseLibraryCoreChangeFeedRequestV1(value.query)
            : value.query.queryId === "item_detail_v1"
              ? parseLibraryCoreItemDetailRequestV1(value.query)
              : value.query.queryId === "item_reader_body_v1"
                ? parseLibraryCoreItemReaderBodyRequestV1(value.query)
                : value.query.queryId === "background_item_page_v1"
                  ? parseLibraryCoreItemScanRequestV1(value.query)
                  : value.query.queryId === "person_detail_v1"
                    ? parseLibraryCorePersonDetailRequestV1(value.query)
                    : value.query.queryId === "preferences_snapshot_v1"
                      ? parseLibraryCorePreferencesSnapshotRequestV1(
                          value.query,
                        )
                      : parseLibraryCoreFeedPageRequestV1(value.query)
      : parseLibraryCoreFeedPageRequestV1(value.query);
    if (!query.ok) throw new TypeError(query.error);
  }
  return value as unknown as LibraryCoreSqliteWorkerRequest;
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
