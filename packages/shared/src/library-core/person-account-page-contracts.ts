import { decodeLibraryCoreCanonicalBase64, encodeLibraryCoreCanonicalBase64 } from "./canonical-base64.js";
import { decodeLibraryCoreCanonicalValue, encodeLibraryCoreCanonicalValue } from "./canonical-codec.js";
import { parseLibraryCoreFeedPageSourceV1, type LibraryCoreFeedPageSourceV1, type LibraryCoreFeedPageParseResult } from "./feed-page-contracts.js";
import { compareLibraryCoreUtf8V1 } from "./operation-payload-contracts.js";

const queryId = "person_account_page_v1" as const;
export interface LibraryCorePersonAccountPageRequestV1 {
  readonly queryId: typeof queryId;
  readonly schemaVersion: 1;
  readonly personId: string;
  readonly limit: number;
  readonly cursor: string | null;
}
export interface LibraryCorePersonAccountPageResponseV1 {
  readonly queryId: typeof queryId;
  readonly schemaVersion: 1;
  readonly personId: string;
  readonly rows: readonly { readonly accountId: string }[];
  readonly nextCursor: string | null;
  readonly source: LibraryCoreFeedPageSourceV1;
}
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length && keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    });
}
const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && new TextEncoder().encode(value).length <= 4096;
const failure = (error: string) => ({ ok: false as const, error });

/** Opaque canonical tuple binds the Person, binary key and canonical source. */
export function encodeLibraryCorePersonAccountCursorV1(personId: string, accountId: string, source: LibraryCoreFeedPageSourceV1): string {
  if (!identity(personId) || !identity(accountId) || !parseLibraryCoreFeedPageSourceV1(source).ok || source.transitionSequence !== source.projectionRevision)
    throw new TypeError("Invalid Person account cursor");
  return encodeLibraryCoreCanonicalBase64(encodeLibraryCoreCanonicalValue([1, queryId, personId, source.generationId, source.projectionRevision, accountId], { maximumBytes: 50000 }));
}
export function decodeLibraryCorePersonAccountCursorV1(token: string, personId: string): { accountId: string; source: LibraryCoreFeedPageSourceV1 } {
  if (typeof token !== "string" || token.length > 66668) throw new TypeError("Invalid Person account cursor");
  const tuple = decodeLibraryCoreCanonicalValue(decodeLibraryCoreCanonicalBase64(token), { maximumBytes: 50000 });
  if (!Array.isArray(tuple) || tuple.length !== 6 || tuple[0] !== 1 || tuple[1] !== queryId || tuple[2] !== personId || !identity(tuple[5]))
    throw new TypeError("Invalid Person account cursor");
  const source = parseLibraryCoreFeedPageSourceV1({ generationId: tuple[3], projectionRevision: tuple[4], transitionSequence: tuple[4] });
  if (!source.ok) throw new TypeError(source.error);
  return { accountId: tuple[5], source: source.value };
}
export function parseLibraryCorePersonAccountPageRequestV1(value: unknown): LibraryCoreFeedPageParseResult<LibraryCorePersonAccountPageRequestV1> {
  if (!closed(value, ["queryId", "schemaVersion", "personId", "limit", "cursor"]) || value.queryId !== queryId || value.schemaVersion !== 1 ||
    !identity(value.personId) || !Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 64 || !(value.cursor === null || typeof value.cursor === "string"))
    return failure("Person account page request is invalid");
  try { if (value.cursor !== null) decodeLibraryCorePersonAccountCursorV1(value.cursor, value.personId); }
  catch { return failure("Person account cursor is invalid"); }
  return { ok: true, value: Object.freeze({ ...value }) as unknown as LibraryCorePersonAccountPageRequestV1 };
}
export function parseLibraryCorePersonAccountPageResponseV1(value: unknown, request: LibraryCorePersonAccountPageRequestV1): LibraryCoreFeedPageParseResult<LibraryCorePersonAccountPageResponseV1> {
  if (!parseLibraryCorePersonAccountPageRequestV1(request).ok || !closed(value, ["queryId", "schemaVersion", "personId", "rows", "nextCursor", "source"]) ||
    value.queryId !== queryId || value.schemaVersion !== 1 || value.personId !== request.personId || !Array.isArray(value.rows) || value.rows.length > request.limit)
    return failure("Person account page response is invalid");
  const source = parseLibraryCoreFeedPageSourceV1(value.source);
  if (!source.ok || source.value.projectionRevision !== source.value.transitionSequence) return failure("Person account source is invalid");
  let previous = "";
  if (request.cursor !== null) {
    const cursor = decodeLibraryCorePersonAccountCursorV1(request.cursor, request.personId);
    if (cursor.source.generationId !== source.value.generationId || cursor.source.projectionRevision !== source.value.projectionRevision) return failure("CURSOR_STALE");
    previous = cursor.accountId;
  }
  const rows: { accountId: string }[] = [];
  for (const row of value.rows) {
    if (!closed(row, ["accountId"]) || !identity(row.accountId) || compareLibraryCoreUtf8V1(previous, row.accountId) >= 0) return failure("Person account order is invalid");
    previous = row.accountId; rows.push(Object.freeze({ accountId: row.accountId }));
  }
  const expected = rows.length === request.limit ? encodeLibraryCorePersonAccountCursorV1(request.personId, previous, source.value) : null;
  if (value.nextCursor !== null && value.nextCursor !== expected) return failure("Person account continuation is invalid");
  return { ok: true, value: Object.freeze({ queryId, schemaVersion: 1, personId: request.personId, rows: Object.freeze(rows), nextCursor: value.nextCursor as string | null, source: source.value }) };
}
