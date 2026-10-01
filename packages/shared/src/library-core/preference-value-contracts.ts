import { parseLibraryCoreGeneratedSqliteQueryRow } from "./sqlite-contract.generated.js";
import { libraryCorePreferenceNodesToValueV1, parseLibraryCorePreferencesSnapshotResponseV1, type LibraryCorePreferenceNodeV1 } from "./preferences-snapshot-contracts.js";
import { decodeLibraryCoreFractionalNumbersV1, isLibraryCoreBinary64V1 } from "./fractional-number-codec.js";
import type { LibraryCoreFeedPageParseResult, LibraryCoreFeedPageSourceV1 } from "./feed-page-contracts.js";

/** One selected setting, never a complete preference collection. */
export interface LibraryCorePreferenceValueRequestV1 {
  readonly queryId: "preference_value_v1";
  readonly schemaVersion: 1;
  readonly path: readonly string[];
  readonly generationId: string;
  readonly sourceRevision: number;
}
export interface LibraryCorePreferenceValueResponseV1 {
  readonly queryId: "preference_value_v1";
  readonly schemaVersion: 1;
  readonly path: readonly string[];
  readonly kind: "absent" | "value" | "object_group";
  /** The selected root is remapped to $._ by the registered SQL. */
  readonly rows: readonly LibraryCorePreferenceNodeV1[];
  readonly source: LibraryCoreFeedPageSourceV1;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const invalid = (error: string): { ok: false; error: string } => ({ ok: false, error });
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every(key => typeof key === "string" && keys.includes(key)
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
}
function validPath(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 32
    && Array.from(value).every(part => typeof part === "string" && decoder.decode(encoder.encode(part)) === part)
    && encoder.encode(JSON.stringify(value)).length <= 8192;
}
export function parseLibraryCorePreferenceValueRequestV1(value: unknown): LibraryCoreFeedPageParseResult<LibraryCorePreferenceValueRequestV1> {
  if (!closed(value, ["queryId", "schemaVersion", "path", "generationId", "sourceRevision"])
    || value.queryId !== "preference_value_v1" || value.schemaVersion !== 1 || !validPath(value.path)
    || typeof value.generationId !== "string" || !/^[a-f0-9]{64}$/.test(value.generationId)
    || typeof value.sourceRevision !== "number" || !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 0)
    return invalid("preference value request is invalid");
  return { ok: true, value: Object.freeze({ queryId: "preference_value_v1", schemaVersion: 1,
    path: Object.freeze([...value.path]), generationId: value.generationId, sourceRevision: value.sourceRevision }) };
}
/** SQLite json_tree derives fullkey from this skeleton, using mutation path rules. */
export function libraryCorePreferenceSelectionJsonV1(request: LibraryCorePreferenceValueRequestV1): string {
  const parsed = parseLibraryCorePreferenceValueRequestV1(request);
  if (!parsed.ok) throw new TypeError(parsed.error);
  let node: unknown = null;
  for (let index = parsed.value.path.length - 1; index >= 0; index -= 1) {
    const parent = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(parent, parsed.value.path[index]!, { enumerable: true, value: node });
    node = parent;
  }
  return JSON.stringify(node);
}
function completeValue(value: unknown): boolean {
  if (Array.isArray(value)) return Array.from({ length: value.length }, (_, i) => i).every(i => Object.hasOwn(value, i) && completeValue(value[i]));
  return value === null || typeof value !== "object" || Object.values(value).every(completeValue);
}
function valueNodeCount(value: unknown): number {
  return 1 + (value !== null && typeof value === "object" ? Object.values(value).reduce<number>((count, child) => count + valueNodeCount(child), 0) : 0);
}
export function parseLibraryCorePreferenceValueResponseV1(value: unknown, input: LibraryCorePreferenceValueRequestV1): LibraryCoreFeedPageParseResult<LibraryCorePreferenceValueResponseV1> {
  const request = parseLibraryCorePreferenceValueRequestV1(input);
  if (!request.ok) return request;
  if (!closed(value, ["queryId", "schemaVersion", "path", "kind", "rows", "source"])
    || value.queryId !== "preference_value_v1" || value.schemaVersion !== 1 || !validPath(value.path)
    || JSON.stringify(value.path) !== JSON.stringify(request.value.path)
    || !["absent", "value", "object_group"].includes(value.kind as string)) return invalid("preference value response is invalid");
  if (!Array.isArray(value.rows) || value.rows.length > 512 || value.rows.some(row => !parseLibraryCoreGeneratedSqliteQueryRow("preference_value_v1", row))) return invalid("preference value rows are invalid");
  const snapshot = parseLibraryCorePreferencesSnapshotResponseV1({ queryId: "preferences_snapshot_v1", schemaVersion: 1, rows: value.rows, source: value.source });
  if (!snapshot.ok) return snapshot;
  if (snapshot.value.source.generationId !== request.value.generationId || snapshot.value.source.projectionRevision !== request.value.sourceRevision
    || snapshot.value.source.transitionSequence !== request.value.sourceRevision) return invalid("CURSOR_STALE");
  try {
    const tree = libraryCorePreferenceNodesToValueV1(snapshot.value.rows);
    const selected = tree._;
    if (Object.keys(tree).some(key => key !== "_") || !completeValue(selected)) return invalid("preference value scope or completeness is invalid");
    if (value.kind === "absent") {
      if (snapshot.value.rows.length !== 0) return invalid("absent preference contains rows");
    } else if (value.kind === "object_group") {
      if (snapshot.value.rows.length !== 1 || snapshot.value.rows[0]!.path !== "o:$._") return invalid("preference group summary is invalid");
    } else {
      if (!Object.hasOwn(tree, "_") || selected !== null && typeof selected === "object" && !Array.isArray(selected) && !isLibraryCoreBinary64V1(selected)) return invalid("preference value is not a complete assignment");
      if (valueNodeCount(selected) !== snapshot.value.rows.length) return invalid("preference value contains duplicate semantic paths");
      decodeLibraryCoreFractionalNumbersV1(selected);
    }
  } catch { return invalid("preference value nodes are invalid"); }
  const response: LibraryCorePreferenceValueResponseV1 = Object.freeze({ queryId: "preference_value_v1", schemaVersion: 1,
    path: Object.freeze([...value.path]), kind: value.kind as LibraryCorePreferenceValueResponseV1["kind"], rows: snapshot.value.rows, source: snapshot.value.source });
  if (encoder.encode(JSON.stringify(response)).length > 2 * 1048576) return invalid("preference value response exceeds its byte bound");
  return { ok: true, value: response };
}

/** Classify bounded SQLite rows without expanding an arbitrary object group. */
export function createLibraryCorePreferenceValueResponseV1(request: LibraryCorePreferenceValueRequestV1, rows: readonly LibraryCorePreferenceNodeV1[], source: LibraryCoreFeedPageSourceV1): LibraryCorePreferenceValueResponseV1 {
  const ordered = [...rows].sort((a, b) => {
    const left = encoder.encode(a.path), right = encoder.encode(b.path);
    for (let i = 0; i < Math.min(left.length, right.length); i += 1) if (left[i] !== right[i]) return left[i]! - right[i]!;
    return left.length - right.length;
  });
  const checked = parseLibraryCorePreferencesSnapshotResponseV1({ queryId: "preferences_snapshot_v1", schemaVersion: 1, rows: ordered, source });
  if (!checked.ok) throw new TypeError(checked.error);
  const roots = checked.value.rows.filter(row => row.path.slice(2) === "$._");
  if (roots.length > 1 || roots.length === 0 && rows.length !== 0) throw new TypeError("preference value has conflicting roots");
  let kind: LibraryCorePreferenceValueResponseV1["kind"] = roots.length === 0 ? "absent" : "value";
  let selectedRows = checked.value.rows;
  if (roots[0]?.path.startsWith("o:")) {
    const bits = selectedRows.find(row => row.path === "v:$._.bits" && row.valueType === "text");
    const codec = selectedRows.find(row => row.path === "v:$._.codec" && row.valueType === "text");
    if (!(selectedRows.length === 3 && bits && codec && isLibraryCoreBinary64V1({ bits: bits.textValue, codec: codec.textValue }))) {
      kind = "object_group"; selectedRows = [roots[0]];
    }
  }
  const parsed = parseLibraryCorePreferenceValueResponseV1({ queryId: "preference_value_v1", schemaVersion: 1, path: request.path, kind, rows: selectedRows, source }, request);
  if (!parsed.ok) throw new TypeError(parsed.error);
  return parsed.value;
}
