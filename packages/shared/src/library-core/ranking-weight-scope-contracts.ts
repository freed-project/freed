import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import { parseLibraryCorePreferenceValueRequestV1 } from "./preference-value-contracts.js";

/** One bounded part of a candidate batch's weights, never the whole weight map. */
export interface LibraryCoreRankingWeightScopeRequestV1 {
  readonly queryId: "ranking_weight_scope_v1";
  readonly schemaVersion: 1;
  readonly paths: readonly (readonly string[])[];
  readonly generationId: string;
  readonly sourceRevision: number;
}

export interface LibraryCoreRankingWeightScopeResponseV1 {
  readonly queryId: "ranking_weight_scope_v1";
  readonly schemaVersion: 1;
  readonly paths: readonly (readonly string[])[];
  /** Null means absent. Invalid retained values must fail the entire read. */
  readonly values: readonly (number | null)[];
  readonly source: LibraryCoreFeedPageSourceV1;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAXIMUM_BYTES = 128 * 1024;
const invalid = (error: string): { ok: false; error: string } => ({ ok: false, error });

function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every(key => typeof key === "string" && keys.includes(key)
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
}

export function parseLibraryCoreRankingWeightScopeRequestV1(
  input: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreRankingWeightScopeRequestV1> {
  if (!closed(input, ["queryId", "schemaVersion", "paths", "generationId", "sourceRevision"])
    || input.queryId !== "ranking_weight_scope_v1" || input.schemaVersion !== 1
    || !Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 64)
    return invalid("ranking weight scope request is invalid");
  const sourceCheck = parseLibraryCorePreferenceValueRequestV1({ queryId: "preference_value_v1", schemaVersion: 1,
    path: ["weights", "recency"], generationId: input.generationId, sourceRevision: input.sourceRevision });
  if (!sourceCheck.ok) return sourceCheck;
  const paths: (readonly string[])[] = [];
  const seen = new Set<string>();
  for (const path of input.paths) {
    if (!Array.isArray(path) || !(path.length === 2 || path.length === 3)
      || Array.from(path).some(part => typeof part !== "string" || part.length > 4096
        || decoder.decode(encoder.encode(part)) !== part)) return invalid("ranking weight scope path is invalid");
    const selected = Object.freeze([...path]) as readonly string[];
    if (selected[0] !== "weights" || !(selected.length === 2 && selected[1] === "recency"
      || selected.length === 3 && ["authors", "platforms", "topics"].includes(selected[1]!)))
      return invalid("ranking weight scope path is invalid");
    const key = JSON.stringify(selected);
    if (seen.has(key)) return invalid("ranking weight scope contains duplicate paths");
    seen.add(key);
    paths.push(selected);
  }
  const value: LibraryCoreRankingWeightScopeRequestV1 = Object.freeze({ queryId: "ranking_weight_scope_v1", schemaVersion: 1,
    paths: Object.freeze(paths), generationId: input.generationId as string, sourceRevision: input.sourceRevision as number });
  if (encoder.encode(JSON.stringify(value)).length > MAXIMUM_BYTES) return invalid("ranking weight scope exceeds its byte bound");
  return { ok: true, value };
}

export function parseLibraryCoreRankingWeightScopeResponseV1(
  input: unknown,
  request: LibraryCoreRankingWeightScopeRequestV1,
): LibraryCoreFeedPageParseResult<LibraryCoreRankingWeightScopeResponseV1> {
  const checked = parseLibraryCoreRankingWeightScopeRequestV1(request);
  if (!checked.ok) return checked;
  if (!closed(input, ["queryId", "schemaVersion", "paths", "values", "source"])
    || input.queryId !== "ranking_weight_scope_v1" || input.schemaVersion !== 1
    || !Array.isArray(input.values) || input.values.length !== checked.value.paths.length
    || Array.from(input.values).some(value => value !== null && (typeof value !== "number" || !Number.isFinite(value))))
    return invalid("ranking weight scope response is invalid");
  const responseScope = parseLibraryCoreRankingWeightScopeRequestV1({ ...checked.value, paths: input.paths });
  if (!responseScope.ok || JSON.stringify(responseScope.value.paths) !== JSON.stringify(checked.value.paths))
    return invalid("ranking weight scope response paths differ");
  const source = parseLibraryCoreFeedPageSourceV1(input.source);
  if (!source.ok) return source;
  if (source.value.generationId !== request.generationId || source.value.projectionRevision !== request.sourceRevision
    || source.value.transitionSequence !== request.sourceRevision) return invalid("CURSOR_STALE");
  const value: LibraryCoreRankingWeightScopeResponseV1 = Object.freeze({ queryId: "ranking_weight_scope_v1", schemaVersion: 1,
    paths: checked.value.paths, values: Object.freeze([...input.values]), source: source.value });
  if (encoder.encode(JSON.stringify(value)).length > MAXIMUM_BYTES) return invalid("ranking weight scope exceeds its byte bound");
  return { ok: true, value };
}
