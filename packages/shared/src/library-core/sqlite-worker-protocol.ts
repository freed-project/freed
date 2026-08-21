import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
} from "./sqlite-contract.generated.js";

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
  if (
    keys.length !== 3 ||
    keys[0] !== "kind" ||
    keys[1] !== "protocolVersion" ||
    keys[2] !== "requestId" ||
    !["close", "open", "status"].includes(String(value.kind)) ||
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
  kind: LibraryCoreSqliteWorkerRequest["kind"],
  requestId: string,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}
