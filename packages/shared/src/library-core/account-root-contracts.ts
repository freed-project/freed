import { ACCOUNT_UPSERT_PAYLOAD_SCHEMA, type AccountUpsertPayloadV1 } from "./operation-payload-contracts.js";
import { parseLibraryCoreFeedPageSourceV1, type LibraryCoreFeedPageParseResult, type LibraryCoreFeedPageSourceV1 } from "./feed-page-contracts.js";

/** Complete editable roots have the same 64 KiB ceiling as a Account upsert. */
export const LIBRARY_CORE_ACCOUNT_ROOT_QUERY_ID = "account_root_v1" as const;
export interface LibraryCoreAccountRootRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_ACCOUNT_ROOT_QUERY_ID;
  readonly schemaVersion: 1;
  readonly accountId: string;
}
export interface LibraryCoreAccountRootResponseV1 {
  readonly queryId: typeof LIBRARY_CORE_ACCOUNT_ROOT_QUERY_ID;
  readonly schemaVersion: 1;
  readonly accountId: string;
  readonly account: AccountUpsertPayloadV1["account"] | null;
  readonly source: LibraryCoreFeedPageSourceV1;
}
const rootKeys = new Set(["id", "personId", "kind", "provider", "externalId", "handle", "displayName", "avatarUrl", "profileUrl", "email", "phone", "address", "importedAt", "firstSeenAt", "lastSeenAt", "discoveredFrom", "followRosterActive", "followRosterRoles", "followRosterSyncedAt", "sampleDataFingerprint", "createdAt", "updatedAt"]);
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length && keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    });
}

/** Request identities match the registered write contract, including Unicode IDs. */
export function parseLibraryCoreAccountRootRequestV1(value: unknown): LibraryCoreFeedPageParseResult<LibraryCoreAccountRootRequestV1> {
  if (!closed(value, ["queryId", "schemaVersion", "accountId"]) || value.queryId !== LIBRARY_CORE_ACCOUNT_ROOT_QUERY_ID || value.schemaVersion !== 1 ||
    typeof value.accountId !== "string" || value.accountId.length === 0 || value.accountId.length > 4096)
    return { ok: false, error: "Account root request is invalid" };
  return { ok: true, value: Object.freeze({ queryId: LIBRARY_CORE_ACCOUNT_ROOT_QUERY_ID, schemaVersion: 1, accountId: value.accountId }) };
}

/** No display truncation or child history is accepted as a complete replacement root. */
export function parseLibraryCoreAccountRootResponseV1(value: unknown, request: LibraryCoreAccountRootRequestV1): LibraryCoreFeedPageParseResult<LibraryCoreAccountRootResponseV1> {
  if (!parseLibraryCoreAccountRootRequestV1(request).ok || !closed(value, ["queryId", "schemaVersion", "accountId", "account", "source"]) ||
    value.queryId !== request.queryId || value.schemaVersion !== 1 || value.accountId !== request.accountId)
    return { ok: false, error: "Account root response is invalid" };
  const source = parseLibraryCoreFeedPageSourceV1(value.source);
  if (!source.ok) return { ok: false, error: "Account root source is invalid" };
  if (value.account === null) return { ok: true, value: Object.freeze({ queryId: request.queryId, schemaVersion: 1, accountId: request.accountId, account: null, source: source.value }) };
  if (typeof value.account !== "object" || Array.isArray(value.account) || Object.keys(value.account).some(key => !rootKeys.has(key)))
    return { ok: false, error: "Account root contains unknown fields" };
  const parsed = ACCOUNT_UPSERT_PAYLOAD_SCHEMA.validate({ account: value.account });
  if (!parsed.ok || parsed.value.account.id !== request.accountId || Object.keys(parsed.value.account).some(key => !rootKeys.has(key)))
    return { ok: false, error: "Account root is incomplete, oversized or invalid" };
  return { ok: true, value: Object.freeze({ queryId: request.queryId, schemaVersion: 1, accountId: request.accountId, account: parsed.value.account, source: source.value }) };
}
