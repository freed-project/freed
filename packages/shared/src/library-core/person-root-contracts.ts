import { PERSON_UPSERT_PAYLOAD_SCHEMA, type PersonUpsertPayloadV1 } from "./operation-payload-contracts.js";
import { parseLibraryCoreFeedPageSourceV1, type LibraryCoreFeedPageParseResult, type LibraryCoreFeedPageSourceV1 } from "./feed-page-contracts.js";

/** Complete editable roots have the same 64 KiB ceiling as a Person upsert. */
export const LIBRARY_CORE_PERSON_ROOT_QUERY_ID = "person_root_v1" as const;
export interface LibraryCorePersonRootRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_PERSON_ROOT_QUERY_ID;
  readonly schemaVersion: 1;
  readonly personId: string;
}
export interface LibraryCorePersonRootResponseV1 {
  readonly queryId: typeof LIBRARY_CORE_PERSON_ROOT_QUERY_ID;
  readonly schemaVersion: 1;
  readonly personId: string;
  readonly person: PersonUpsertPayloadV1["person"] | null;
  readonly source: LibraryCoreFeedPageSourceV1;
}
const rootKeys = new Set(["id", "name", "avatarUrl", "bio", "relationshipStatus", "careLevel", "reachOutIntervalDays", "tags", "notes", "sampleDataFingerprint", "createdAt", "updatedAt"]);
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length && keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    });
}

/** Request identities match the registered write contract, including Unicode IDs. */
export function parseLibraryCorePersonRootRequestV1(value: unknown): LibraryCoreFeedPageParseResult<LibraryCorePersonRootRequestV1> {
  if (!closed(value, ["queryId", "schemaVersion", "personId"]) || value.queryId !== LIBRARY_CORE_PERSON_ROOT_QUERY_ID || value.schemaVersion !== 1 ||
    typeof value.personId !== "string" || value.personId.length === 0 || value.personId.length > 4096)
    return { ok: false, error: "Person root request is invalid" };
  return { ok: true, value: Object.freeze({ queryId: LIBRARY_CORE_PERSON_ROOT_QUERY_ID, schemaVersion: 1, personId: value.personId }) };
}

/** No display truncation or child history is accepted as a complete replacement root. */
export function parseLibraryCorePersonRootResponseV1(value: unknown, request: LibraryCorePersonRootRequestV1): LibraryCoreFeedPageParseResult<LibraryCorePersonRootResponseV1> {
  if (!parseLibraryCorePersonRootRequestV1(request).ok || !closed(value, ["queryId", "schemaVersion", "personId", "person", "source"]) ||
    value.queryId !== request.queryId || value.schemaVersion !== 1 || value.personId !== request.personId)
    return { ok: false, error: "Person root response is invalid" };
  const source = parseLibraryCoreFeedPageSourceV1(value.source);
  if (!source.ok) return { ok: false, error: "Person root source is invalid" };
  if (value.person === null) return { ok: true, value: Object.freeze({ queryId: request.queryId, schemaVersion: 1, personId: request.personId, person: null, source: source.value }) };
  const parsed = PERSON_UPSERT_PAYLOAD_SCHEMA.validate({ person: value.person });
  if (!parsed.ok || parsed.value.person.id !== request.personId || Object.keys(parsed.value.person).some(key => !rootKeys.has(key)))
    return { ok: false, error: "Person root is incomplete, oversized or invalid" };
  return { ok: true, value: Object.freeze({ queryId: request.queryId, schemaVersion: 1, personId: request.personId, person: parsed.value.person, source: source.value }) };
}
