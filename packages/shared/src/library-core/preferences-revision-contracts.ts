import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";

export interface LibraryCorePreferencesRevisionRequestV1 {
  readonly queryId: "preferences_revision_v1";
  readonly schemaVersion: 1;
}

/** Compare generation and revision together; checkpoint import clears invalidations. */
export interface LibraryCorePreferencesRevisionResponseV1 {
  readonly queryId: "preferences_revision_v1";
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly source: LibraryCoreFeedPageSourceV1;
}

function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every(key => typeof key === "string" && keys.includes(key)
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
}

export function parseLibraryCorePreferencesRevisionRequestV1(
  input: unknown,
): LibraryCoreFeedPageParseResult<LibraryCorePreferencesRevisionRequestV1> {
  if (!closed(input, ["queryId", "schemaVersion"]) || input.queryId !== "preferences_revision_v1" || input.schemaVersion !== 1)
    return { ok: false, error: "preference revision request is invalid" };
  return { ok: true, value: Object.freeze({ queryId: "preferences_revision_v1", schemaVersion: 1 }) };
}

export function parseLibraryCorePreferencesRevisionResponseV1(
  input: unknown,
): LibraryCoreFeedPageParseResult<LibraryCorePreferencesRevisionResponseV1> {
  if (!closed(input, ["queryId", "schemaVersion", "revision", "source"])
    || input.queryId !== "preferences_revision_v1" || input.schemaVersion !== 1
    || typeof input.revision !== "number" || !Number.isSafeInteger(input.revision) || input.revision < 0)
    return { ok: false, error: "preference revision response is invalid" };
  const source = parseLibraryCoreFeedPageSourceV1(input.source);
  if (!source.ok) return source;
  if (input.revision > source.value.projectionRevision || source.value.transitionSequence !== source.value.projectionRevision)
    return { ok: false, error: "preference revision source is inconsistent" };
  return { ok: true, value: Object.freeze({ queryId: "preferences_revision_v1", schemaVersion: 1,
    revision: input.revision, source: source.value }) };
}
