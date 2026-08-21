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
  parseLibraryCoreBeginNormalizedCheckpointStageV2,
  parseLibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreBeginNormalizedCheckpointStageV2,
  type LibraryCoreNormalizedCheckpointActivationReceiptV2,
  type LibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreNormalizedCheckpointStageStatusV2,
} from "./normalized-checkpoint-stage-contracts.js";

export const LIBRARY_CORE_SQLITE_WORKER_MAXIMUM_PENDING_REQUESTS = 128 as const;

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
      kind: "query_feed_page";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      query: LibraryCoreFeedPageRequestV1;
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

export type LibraryCoreSqliteWorkerResponse =
  | Readonly<{
      ok: true;
      requestId: string;
      status: LibraryCoreSqliteWorkerStatus;
    }>
  | Readonly<{
      ok: true;
      requestId: string;
      result:
        | LibraryCoreFeedPageResponseV1
        | LibraryCoreNormalizedCheckpointStageStatusV2
        | LibraryCoreNormalizedCheckpointActivationReceiptV2;
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
    value.kind === "query_feed_page"
      ? ["kind", "protocolVersion", "query", "requestId"]
      : value.kind === "begin_normalized_checkpoint_stage"
        ? ["kind", "protocolVersion", "requestId", "stage"]
        : value.kind === "append_normalized_checkpoint_stage_page"
          ? ["kind", "page", "protocolVersion", "requestId"]
          : ["kind", "protocolVersion", "requestId"];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    ![
      "append_normalized_checkpoint_stage_page",
      "begin_normalized_checkpoint_stage",
      "close",
      "open",
      "query_feed_page",
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

export function createLibraryCoreSqliteFeedPageWorkerRequest(
  requestId: string,
  query: LibraryCoreFeedPageRequestV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "query_feed_page",
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
