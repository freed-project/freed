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
      result: LibraryCoreFeedPageResponseV1;
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
  const query = value.kind === "query_feed_page";
  const expectedKeys = query
    ? ["kind", "protocolVersion", "query", "requestId"]
    : ["kind", "protocolVersion", "requestId"];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    !["close", "open", "query_feed_page", "status"].includes(
      String(value.kind),
    ) ||
    value.protocolVersion !== LIBRARY_CORE_SQLITE_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    value.requestId.length === 0 ||
    value.requestId.length > 255
  ) {
    throw new TypeError("SQLite worker request identity is invalid");
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
