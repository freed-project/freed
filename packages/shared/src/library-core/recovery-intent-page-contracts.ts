import { decodeLibraryCoreCanonicalValue } from "./canonical-codec.js";
import {
  decodeLibraryCoreFeedPageCursorV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import { isLibraryCoreLowercaseHex64, isLibraryCoreOperationInstanceId } from "./protocol-scalars.js";
import {
  parseLibraryCoreGeneratedSqliteQueryRow,
  type LibraryCoreGeneratedSqliteQueryRow,
} from "./sqlite-contract.generated.js";

export interface LibraryCoreRecoveryIntentPageRequestV1 {
  readonly queryId: "recovery_intent_page_v1";
  readonly schemaVersion: 1;
  readonly recoveryId: string;
  readonly cancellationId: string;
  readonly readerSessionId: string;
  readonly cursor: string | null;
  readonly limit: number;
}
export interface LibraryCoreRecoveryIntentPageResponseV1 {
  readonly queryId: "recovery_intent_page_v1";
  readonly schemaVersion: 1;
  readonly recoveryId: string;
  readonly archiveDigest: string;
  readonly rows: readonly LibraryCoreGeneratedSqliteQueryRow<"recovery_intent_page_v1">[];
  readonly nextCursor: string | null;
  readonly source: LibraryCoreFeedPageSourceV1;
}

function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    });
}
const failure = <T>(error: string): LibraryCoreFeedPageParseResult<T> => ({ ok: false, error });

/** Archive pagination reuses the native/browser golden cursor codec. */
export function parseLibraryCoreRecoveryIntentPageRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreRecoveryIntentPageRequestV1> {
  if (!closed(value, ["queryId", "schemaVersion", "recoveryId", "cancellationId", "readerSessionId", "cursor", "limit"]) ||
      value.queryId !== "recovery_intent_page_v1" || value.schemaVersion !== 1 ||
      !isLibraryCoreLowercaseHex64(value.recoveryId) || !isLibraryCoreOperationInstanceId(value.cancellationId) ||
      !isLibraryCoreOperationInstanceId(value.readerSessionId) || !Number.isSafeInteger(value.limit) ||
      (value.limit as number) < 1 || (value.limit as number) > 64) {
    return failure("Recovery intent page request is invalid");
  }
  if (value.cursor !== null) {
    if (typeof value.cursor !== "string" || value.cursor.length > 512) return failure("Recovery cursor is invalid");
    const cursor = decodeLibraryCoreFeedPageCursorV1(value.cursor);
    const prefix = `recovery_intent_page_v1:${value.recoveryId}:`;
    if (!cursor.ok || !cursor.value.globalId.startsWith(prefix) ||
        !isLibraryCoreLowercaseHex64(cursor.value.globalId.slice(prefix.length)) ||
        cursor.value.projectionRevision !== cursor.value.transitionSequence) {
      return failure("Recovery cursor belongs to another query or archive");
    }
  }
  return { ok: true, value: Object.freeze({ ...value }) as unknown as LibraryCoreRecoveryIntentPageRequestV1 };
}

/** A page contains identities only. State flags never become outcome evidence. */
export function parseLibraryCoreRecoveryIntentPageResponseV1(
  value: unknown,
  request: LibraryCoreRecoveryIntentPageRequestV1,
): LibraryCoreFeedPageParseResult<LibraryCoreRecoveryIntentPageResponseV1> {
  if (!parseLibraryCoreRecoveryIntentPageRequestV1(request).ok ||
      !closed(value, ["queryId", "schemaVersion", "recoveryId", "archiveDigest", "rows", "nextCursor", "source"]) ||
      value.queryId !== request.queryId || value.schemaVersion !== 1 || value.recoveryId !== request.recoveryId ||
      !isLibraryCoreLowercaseHex64(value.archiveDigest) || !Array.isArray(value.rows) || value.rows.length > request.limit) {
    return failure("Recovery intent page response is invalid");
  }
  const source = parseLibraryCoreFeedPageSourceV1(value.source);
  if (!source.ok || source.value.transitionSequence !== source.value.projectionRevision) return failure("Recovery source is invalid");
  const binding = `recovery_intent_page_v1:${request.recoveryId}:${value.archiveDigest}`;
  const parseCursor = (token: unknown) => {
    if (typeof token !== "string" || token.length > 512) return null;
    const result = decodeLibraryCoreFeedPageCursorV1(token);
    return result.ok && result.value.globalId === binding && result.value.generationId === source.value.generationId &&
      result.value.projectionRevision === source.value.projectionRevision && result.value.transitionSequence === source.value.transitionSequence
      ? result.value : null;
  };
  const previous = request.cursor === null ? null : parseCursor(request.cursor);
  if (request.cursor !== null && previous === null) return failure("CURSOR_STALE");
  let ordinal = previous?.sortAt ?? -1;
  const identities = new Set<string>();
  const rows: LibraryCoreGeneratedSqliteQueryRow<"recovery_intent_page_v1">[] = [];
  for (const raw of value.rows) {
    const row = parseLibraryCoreGeneratedSqliteQueryRow("recovery_intent_page_v1", raw);
    if (!row || row.ordinal <= ordinal || identities.has(row.transactionId)) return failure("Recovery page ordering is invalid");
    ordinal = row.ordinal;
    identities.add(row.transactionId);
    rows.push(row);
  }
  if (value.nextCursor !== null) {
    const next = parseCursor(value.nextCursor);
    if (rows.length !== request.limit || !next || next.sortAt !== ordinal) return failure("Recovery continuation is invalid");
  }
  const result: LibraryCoreRecoveryIntentPageResponseV1 = Object.freeze({
    queryId: request.queryId, schemaVersion: 1, recoveryId: request.recoveryId,
    archiveDigest: value.archiveDigest, rows: Object.freeze(rows), source: source.value,
    nextCursor: value.nextCursor as string | null,
  });
  if (new TextEncoder().encode(JSON.stringify(result)).length > 131072) return failure("Recovery page exceeds its byte bound");
  return { ok: true, value: result };
}

export interface LibraryCoreRecoveryIntentReviewRequestV1 extends Omit<LibraryCoreRecoveryIntentPageRequestV1, "queryId"> {
  readonly queryId: "recovery_intent_review_v1";
  readonly includeOriginal?: boolean;
  readonly transactionId: string;
}
export type LibraryCoreArchivedIntentOutcomeV1 =
  | Readonly<{ state: "unresolved" }>
  | Readonly<{ state: "confirmed_accepted"; committed_revision: number }>
  | Readonly<{ state: "reported_rejected"; reason: string; result_digest: string }>;
export interface LibraryCoreRecoveryReissueReceiptV1 {
  readonly schemaVersion: 1;
  readonly recoveryId: string;
  readonly originalTransactionId: string;
  readonly replacementTransactionId: string;
  readonly replacementTransactionDigest: string;
  readonly replacementEpochId: string;
  readonly replacementActorId: string;
  readonly firstCounter: number;
  readonly lastCounter: number;
  readonly memberCount: number;
  readonly createdAt: number;
}

/** Both mutation acknowledgments and registered review share this closed receipt. */
export function parseLibraryCoreRecoveryReissueReceiptV1(
  value: unknown,
  original: Readonly<{ recoveryId: string; transactionId: string; memberCount: number }>,
): LibraryCoreFeedPageParseResult<LibraryCoreRecoveryReissueReceiptV1> {
  const keys = ["schemaVersion", "recoveryId", "originalTransactionId", "replacementTransactionId", "replacementTransactionDigest", "replacementEpochId", "replacementActorId", "firstCounter", "lastCounter", "memberCount", "createdAt"];
  if (!closed(value, keys) || value.schemaVersion !== 1 || value.recoveryId !== original.recoveryId ||
      value.originalTransactionId !== original.transactionId ||
      !isLibraryCoreOperationInstanceId(value.replacementTransactionId) || value.replacementTransactionId === original.transactionId ||
      ![value.replacementTransactionDigest, value.replacementEpochId, value.replacementActorId].every(isLibraryCoreLowercaseHex64) ||
      ![value.firstCounter, value.lastCounter, value.memberCount, value.createdAt].every(Number.isSafeInteger) ||
      (value.firstCounter as number) < 1 || (value.memberCount as number) < 1 || (value.memberCount as number) > 1000 ||
      value.lastCounter !== (value.firstCounter as number) + (value.memberCount as number) - 1 ||
      value.memberCount !== original.memberCount || (value.createdAt as number) < 0) return failure("Recovery returned a mismatched receipt");
  return { ok: true, value: Object.freeze({ ...value }) as unknown as LibraryCoreRecoveryReissueReceiptV1 };
}

export interface LibraryCoreRecoveryIntentReviewResponseV1 {
  readonly queryId: "recovery_intent_review_v1";
  readonly schemaVersion: 1;
  readonly recoveryId: string;
  readonly archiveDigest: string;
  readonly transactionId: string;
  readonly transactionDigest: string;
  readonly memberCount: number;
  readonly outcome: LibraryCoreArchivedIntentOutcomeV1;
  readonly replacement: LibraryCoreRecoveryReissueReceiptV1 | null;
  readonly rows: readonly LibraryCoreGeneratedSqliteQueryRow<"recovery_intent_review_v1">[];
  readonly nextCursor: string | null;
  readonly source: LibraryCoreFeedPageSourceV1;
}

/** Review selectors cannot contain SQL, caller-supplied evidence or edit payloads. */
export function parseLibraryCoreRecoveryIntentReviewRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreRecoveryIntentReviewRequestV1> {
  const hasOriginal = value !== null && typeof value === "object" && Object.hasOwn(value, "includeOriginal");
  if (!closed(value, ["queryId", "schemaVersion", "recoveryId", "transactionId", "cancellationId", "readerSessionId", "cursor", "limit", ...(hasOriginal ? ["includeOriginal"] : [])]) ||
      (hasOriginal && typeof value.includeOriginal !== "boolean") ||
      value.queryId !== "recovery_intent_review_v1" || typeof value.transactionId !== "string" ||
      new TextEncoder().encode(value.transactionId).length < 1 || new TextEncoder().encode(value.transactionId).length > 255 ||
      (value.limit as number) > 16) return failure("Recovery review request is invalid");
  const base = parseLibraryCoreRecoveryIntentPageRequestV1({
    queryId: "recovery_intent_page_v1", schemaVersion: value.schemaVersion, recoveryId: value.recoveryId,
    cancellationId: value.cancellationId, readerSessionId: value.readerSessionId, cursor: null, limit: value.limit,
  });
  if (!base.ok) return failure(base.error);
  if (value.cursor !== null) {
    if (typeof value.cursor !== "string" || value.cursor.length > 512) return failure("Recovery review cursor is invalid");
    const parsed = decodeLibraryCoreFeedPageCursorV1(value.cursor);
    const prefix = `recovery_intent_review_v1:${value.recoveryId}:`;
    const suffix = parsed.ok && parsed.value.globalId.startsWith(prefix) ? parsed.value.globalId.slice(prefix.length).split(":") : [];
    if (!parsed.ok || suffix.length !== (value.includeOriginal ? 3 : 2) || !suffix.slice(0, 2).every(isLibraryCoreLowercaseHex64) ||
        (value.includeOriginal === true && suffix[2] !== "original") ||
        parsed.value.sortAt > 999) return failure("Recovery review cursor scope is invalid");
  }
  return { ok: true, value: Object.freeze({ ...value }) as unknown as LibraryCoreRecoveryIntentReviewRequestV1 };
}

function parseOutcome(value: unknown, revision: number): LibraryCoreArchivedIntentOutcomeV1 | null {
  if (closed(value, ["state"]) && value.state === "unresolved") return Object.freeze({ state: "unresolved" });
  if (closed(value, ["state", "committed_revision"]) && value.state === "confirmed_accepted" &&
      Number.isSafeInteger(value.committed_revision) && (value.committed_revision as number) >= 0 && (value.committed_revision as number) <= revision) {
    return Object.freeze({ state: "confirmed_accepted", committed_revision: value.committed_revision as number });
  }
  if (closed(value, ["state", "reason", "result_digest"]) && value.state === "reported_rejected" &&
      typeof value.reason === "string" && ["actor_retired", "capability_denied", "precondition_failed", "target_missing", "target_tombstoned"].includes(value.reason) &&
      isLibraryCoreLowercaseHex64(value.result_digest)) return Object.freeze({ state: "reported_rejected", reason: value.reason, result_digest: value.result_digest });
  return null;
}

/** Enforce one verified transaction, one source snapshot and contiguous members. */
export function parseLibraryCoreRecoveryIntentReviewResponseV1(
  value: unknown, request: LibraryCoreRecoveryIntentReviewRequestV1,
): LibraryCoreFeedPageParseResult<LibraryCoreRecoveryIntentReviewResponseV1> {
  if (!parseLibraryCoreRecoveryIntentReviewRequestV1(request).ok ||
      !closed(value, ["queryId", "schemaVersion", "recoveryId", "archiveDigest", "transactionId", "transactionDigest", "memberCount", "outcome", "replacement", "rows", "nextCursor", "source"]) ||
      value.queryId !== request.queryId || value.schemaVersion !== 1 || value.recoveryId !== request.recoveryId || value.transactionId !== request.transactionId ||
      !isLibraryCoreLowercaseHex64(value.archiveDigest) || !isLibraryCoreLowercaseHex64(value.transactionDigest) ||
      !Number.isSafeInteger(value.memberCount) || (value.memberCount as number) < 1 || (value.memberCount as number) > 1000 ||
      !Array.isArray(value.rows) || value.rows.length > request.limit) return failure("Recovery review response is invalid");
  const source = parseLibraryCoreFeedPageSourceV1(value.source);
  if (!source.ok) return failure("Recovery review source is invalid");
  const outcome = parseOutcome(value.outcome, source.value.projectionRevision);
  if (!outcome) return failure("Recovery outcome evidence is invalid");
  const replacement = value.replacement === null ? null : parseLibraryCoreRecoveryReissueReceiptV1(value.replacement,
    { recoveryId: request.recoveryId, transactionId: request.transactionId, memberCount: value.memberCount as number });
  if (replacement !== null && !replacement.ok) return failure("Recovery replacement receipt is invalid");
  const binding = `recovery_intent_review_v1:${request.recoveryId}:${value.archiveDigest}:${value.transactionDigest}${request.includeOriginal ? ":original" : ""}`;
  const cursor = (token: unknown) => {
    if (typeof token !== "string" || token.length > 512) return null;
    const parsed = decodeLibraryCoreFeedPageCursorV1(token);
    return parsed.ok && parsed.value.globalId === binding && parsed.value.generationId === source.value.generationId &&
      parsed.value.projectionRevision === source.value.projectionRevision && parsed.value.transitionSequence === source.value.transitionSequence ? parsed.value : null;
  };
  const previous = request.cursor === null ? null : cursor(request.cursor);
  if (request.cursor !== null && !previous) return failure("CURSOR_STALE");
  const start = previous ? previous.sortAt + 1 : 0;
  const end = start + value.rows.length;
  if (start >= (value.memberCount as number) || end > (value.memberCount as number) || value.rows.length === 0 ||
      (!request.includeOriginal && value.rows.length !== Math.min(request.limit, (value.memberCount as number) - start))) return failure("Recovery review members are incomplete");
  const rows: LibraryCoreGeneratedSqliteQueryRow<"recovery_intent_review_v1">[] = [];
  for (const raw of value.rows) {
    const row = parseLibraryCoreGeneratedSqliteQueryRow("recovery_intent_review_v1", raw);
    if (!row || row.memberIndex !== start + rows.length) return failure("Recovery review member order changed");
    if (request.includeOriginal) {
      if (row.originalEnvelopeJson === null) return failure("Recovery editor envelope is missing");
      try {
        const decoded = decodeLibraryCoreCanonicalValue(Uint8Array.from(new TextEncoder().encode(row.originalEnvelopeJson)), { maximumBytes: 131072 });
        if (decoded === null || Array.isArray(decoded) || typeof decoded !== "object") return failure("Recovery editor envelope is not an object");
        const envelope = decoded as Readonly<Record<string, unknown>>;
        if (envelope.transaction_id !== request.transactionId || envelope.transaction_digest !== value.transactionDigest ||
          envelope.transaction_member_index !== row.memberIndex || envelope.transaction_member_count !== value.memberCount ||
          envelope.operation_type !== row.operationType || envelope.entity_id !== row.entityId ||
          envelope.schema_version !== 1 || typeof envelope.entity_type !== "string" ||
          !Array.isArray(envelope.blob_references) || envelope.payload === null || typeof envelope.payload !== "object" || Array.isArray(envelope.payload))
          return failure("Recovery editor envelope identity changed");
      } catch { return failure("Recovery editor envelope is not canonical"); }
    } else if (row.originalEnvelopeJson !== null) return failure("Unexpected recovery editor envelope");
    if (row.operationType === "feed_item_read_assignment" && (row.readAt === null || row.assigned !== null || row.assignedAt !== null)) return failure("Recovery read assignment is invalid");
    if (["feed_item_saved_assignment", "feed_item_archive_assignment", "feed_item_like_assignment"].includes(row.operationType) &&
        (row.assigned === null || row.assignedAt === null || row.readAt !== null)) return failure("Recovery assignment is invalid");
    rows.push(row);
  }
  if (end < (value.memberCount as number)) {
    if (cursor(value.nextCursor)?.sortAt !== end - 1) return failure("Recovery review continuation is invalid");
  } else if (value.nextCursor !== null) return failure("Recovery review has an extra continuation");
  const result: LibraryCoreRecoveryIntentReviewResponseV1 = Object.freeze({
    queryId: request.queryId, schemaVersion: 1, recoveryId: request.recoveryId, archiveDigest: value.archiveDigest,
    transactionId: request.transactionId, transactionDigest: value.transactionDigest, memberCount: value.memberCount as number,
    outcome, replacement: replacement?.value ?? null, rows: Object.freeze(rows), nextCursor: value.nextCursor as string | null, source: source.value,
  });
  if (new TextEncoder().encode(JSON.stringify(result)).length > 524288) return failure("Recovery review exceeds its byte bound");
  return { ok: true, value: result };
}

export interface LibraryCoreRecoveryArchivePageRequestV1 extends Omit<LibraryCoreRecoveryIntentPageRequestV1, "queryId" | "recoveryId"> {
  readonly queryId: "recovery_archive_page_v1";
}
export interface LibraryCoreRecoveryArchivePageResponseV1 {
  readonly queryId: "recovery_archive_page_v1";
  readonly schemaVersion: 1;
  readonly handoffId: string;
  readonly rows: readonly LibraryCoreGeneratedSqliteQueryRow<"recovery_archive_page_v1">[];
  readonly nextCursor: string | null;
  readonly source: LibraryCoreFeedPageSourceV1;
}
function archiveCursor(token: unknown) {
  if (typeof token !== "string" || token.length > 512) return null;
  const parsed = decodeLibraryCoreFeedPageCursorV1(token);
  if (!parsed.ok) return null;
  const [query, handoff, last, extra] = parsed.value.globalId.split(":");
  return query === "recovery_archive_page_v1" && extra === undefined &&
    isLibraryCoreLowercaseHex64(handoff) && isLibraryCoreLowercaseHex64(last) &&
    parsed.value.sortAt === 0 && parsed.value.projectionRevision === parsed.value.transitionSequence
    ? { ...parsed.value, handoff, last } : null;
}
export function parseLibraryCoreRecoveryArchivePageRequestV1(value: unknown): LibraryCoreFeedPageParseResult<LibraryCoreRecoveryArchivePageRequestV1> {
  if (!closed(value, ["queryId", "schemaVersion", "cancellationId", "readerSessionId", "cursor", "limit"]) ||
    value.queryId !== "recovery_archive_page_v1" || value.schemaVersion !== 1 ||
    !isLibraryCoreOperationInstanceId(value.cancellationId) || !isLibraryCoreOperationInstanceId(value.readerSessionId) ||
    !Number.isSafeInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 64 ||
    value.cursor !== null && !archiveCursor(value.cursor)) return failure("Recovery archive request is invalid");
  return { ok: true, value: Object.freeze({ ...value }) as unknown as LibraryCoreRecoveryArchivePageRequestV1 };
}
/** Discovery metadata is not an acceptance receipt or permission to reapply. */
export function parseLibraryCoreRecoveryArchivePageResponseV1(value: unknown, request: LibraryCoreRecoveryArchivePageRequestV1): LibraryCoreFeedPageParseResult<LibraryCoreRecoveryArchivePageResponseV1> {
  if (!parseLibraryCoreRecoveryArchivePageRequestV1(request).ok ||
    !closed(value, ["queryId", "schemaVersion", "handoffId", "rows", "nextCursor", "source"]) ||
    value.queryId !== request.queryId || value.schemaVersion !== 1 || !isLibraryCoreLowercaseHex64(value.handoffId) ||
    !Array.isArray(value.rows) || value.rows.length > request.limit) return failure("Recovery archive response is invalid");
  const source = parseLibraryCoreFeedPageSourceV1(value.source);
  if (!source.ok || source.value.transitionSequence !== source.value.projectionRevision) return failure("Recovery archive source is invalid");
  const bound = (token: unknown) => {
    const cursor = archiveCursor(token);
    return cursor && cursor.handoff === value.handoffId && cursor.generationId === source.value.generationId &&
      cursor.projectionRevision === source.value.projectionRevision ? cursor : null;
  };
  const previous = request.cursor === null ? null : bound(request.cursor);
  if (request.cursor !== null && !previous) return failure("CURSOR_STALE");
  let after = previous?.last ?? "";
  const rows: LibraryCoreGeneratedSqliteQueryRow<"recovery_archive_page_v1">[] = [];
  for (const raw of value.rows) {
    const row = parseLibraryCoreGeneratedSqliteQueryRow("recovery_archive_page_v1", raw);
    if (!row || ![row.recoveryId, row.predecessorEpochId, row.successorEpochId].every(isLibraryCoreLowercaseHex64) || row.recoveryId <= after)
      return failure("Recovery archive ordering or identity is invalid");
    rows.push(row); after = row.recoveryId;
  }
  if (value.nextCursor !== null) {
    const next = bound(value.nextCursor);
    if (!next || rows.length !== request.limit || next.last !== after) return failure("Recovery archive continuation is invalid");
  }
  const result: LibraryCoreRecoveryArchivePageResponseV1 = Object.freeze({ queryId: request.queryId, schemaVersion: 1,
    handoffId: value.handoffId, rows: Object.freeze(rows), nextCursor: value.nextCursor as string | null, source: source.value });
  if (new TextEncoder().encode(JSON.stringify(result)).length > 131072) return failure("Recovery archive response exceeds its byte bound");
  return { ok: true, value: result };
}
