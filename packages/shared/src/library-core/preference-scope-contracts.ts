import { parseLibraryCoreFeedPageSourceV1, type LibraryCoreFeedPageSourceV1, type LibraryCoreFeedPageParseResult } from "./feed-page-contracts.js";
import { parseLibraryCorePreferenceValueRequestV1, parseLibraryCorePreferenceValueResponseV1,
  type LibraryCorePreferenceValueResponseV1 } from "./preference-value-contracts.js";

/** Explicit selected values at one source, never an implicitly complete map. */
export interface LibraryCorePreferenceScopeRequestV1 {
  readonly queryId: "preference_scope_v1";
  readonly schemaVersion: 1;
  readonly paths: readonly (readonly string[])[];
  readonly generationId: string;
  readonly sourceRevision: number;
}
export interface LibraryCorePreferenceScopeResponseV1 {
  readonly queryId: "preference_scope_v1";
  readonly schemaVersion: 1;
  readonly results: readonly LibraryCorePreferenceValueResponseV1[];
  readonly source: LibraryCoreFeedPageSourceV1;
}
const encoder = new TextEncoder();
const invalid = (error: string): { ok: false; error: string } => ({ ok: false, error });
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every(key => typeof key === "string" && keys.includes(key)
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
}
export function parseLibraryCorePreferenceScopeRequestV1(input: unknown): LibraryCoreFeedPageParseResult<LibraryCorePreferenceScopeRequestV1> {
  if (!closed(input, ["queryId", "schemaVersion", "paths", "generationId", "sourceRevision"])
    || input.queryId !== "preference_scope_v1" || input.schemaVersion !== 1
    || !Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 64)
    return invalid("preference scope request is invalid");
  const paths: (readonly string[])[] = [];
  const seen = new Set<string>();
  for (const path of input.paths) {
    const parsed = parseLibraryCorePreferenceValueRequestV1({ queryId: "preference_value_v1", schemaVersion: 1,
      path, generationId: input.generationId, sourceRevision: input.sourceRevision });
    if (!parsed.ok) return parsed;
    const identity = JSON.stringify(parsed.value.path);
    if (seen.has(identity)) return invalid("preference scope contains duplicate paths");
    seen.add(identity); paths.push(parsed.value.path);
  }
  const value: LibraryCorePreferenceScopeRequestV1 = Object.freeze({ queryId: "preference_scope_v1", schemaVersion: 1,
    paths: Object.freeze(paths), generationId: input.generationId as string, sourceRevision: input.sourceRevision as number });
  if (encoder.encode(JSON.stringify(value)).length > 128 * 1024) return invalid("preference scope request exceeds its byte bound");
  return { ok: true, value };
}
export function parseLibraryCorePreferenceScopeResponseV1(input: unknown, request: LibraryCorePreferenceScopeRequestV1): LibraryCoreFeedPageParseResult<LibraryCorePreferenceScopeResponseV1> {
  const checked = parseLibraryCorePreferenceScopeRequestV1(request);
  if (!checked.ok) return checked;
  if (!closed(input, ["queryId", "schemaVersion", "results", "source"]) || input.queryId !== "preference_scope_v1"
    || input.schemaVersion !== 1 || !Array.isArray(input.results) || input.results.length !== checked.value.paths.length)
    return invalid("preference scope response is invalid");
  const source = parseLibraryCoreFeedPageSourceV1(input.source);
  if (!source.ok) return source;
  if (source.value.generationId !== request.generationId || source.value.projectionRevision !== request.sourceRevision
    || source.value.transitionSequence !== request.sourceRevision) return invalid("CURSOR_STALE");
  const results: LibraryCorePreferenceValueResponseV1[] = [];
  let bytes = 0;
  for (let index = 0; index < input.results.length; index += 1) {
    const parsed = parseLibraryCorePreferenceValueResponseV1(input.results[index], { queryId: "preference_value_v1", schemaVersion: 1,
      path: checked.value.paths[index]!, generationId: request.generationId, sourceRevision: request.sourceRevision });
    if (!parsed.ok) return parsed;
    bytes += encoder.encode(JSON.stringify(parsed.value)).length;
    if (bytes > 2 * 1048576) return invalid("preference scope response exceeds its byte bound");
    results.push(parsed.value);
  }
  const value: LibraryCorePreferenceScopeResponseV1 = Object.freeze({ queryId: "preference_scope_v1", schemaVersion: 1, results: Object.freeze(results), source: source.value });
  if (encoder.encode(JSON.stringify(value)).length > 2 * 1048576) return invalid("preference scope response exceeds its byte bound");
  return { ok: true, value };
}
