import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";

export const LIBRARY_CORE_PREFERENCES_SNAPSHOT_QUERY_ID =
  "preferences_snapshot_v1" as const;
export const LIBRARY_CORE_PREFERENCES_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_ROWS = 512;
export const LIBRARY_CORE_PREFERENCE_PATH_MAXIMUM_UTF8_BYTES = 4_096;
export const LIBRARY_CORE_PREFERENCE_TEXT_MAXIMUM_UTF8_BYTES = 8_192;
export const LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_RESPONSE_BYTES =
  2 * 1_048_576;

export const LIBRARY_CORE_PREFERENCES_SNAPSHOT_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_preferences_snapshot_request_v1",
  schemaVersion: LIBRARY_CORE_PREFERENCES_SNAPSHOT_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PREFERENCES_SNAPSHOT_QUERY_ID,
  canonicalKeys: Object.freeze(["queryId", "schemaVersion"]),
});

export const LIBRARY_CORE_PREFERENCES_SNAPSHOT_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_preferences_snapshot_response_v1",
  schemaVersion: LIBRARY_CORE_PREFERENCES_SNAPSHOT_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PREFERENCES_SNAPSHOT_QUERY_ID,
  canonicalKeys: Object.freeze(["queryId", "rows", "schemaVersion", "source"]),
  rowKeys: Object.freeze([
    "booleanValue",
    "integerValue",
    "path",
    "realValue",
    "textValue",
    "updatedAt",
    "valueType",
  ]),
  maximumRows: LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_ROWS,
  maximumResponseBytes:
    LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_PREFERENCES_SNAPSHOT_PROJECTION = Object.freeze({
  projectionId: "library_core_preference_node_v1",
  sourceTable: "preferences",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["path"]),
});

export const LIBRARY_CORE_PREFERENCES_SNAPSHOT_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_PREFERENCES_SNAPSHOT_NESTED_BOUNDS = Object.freeze({
  rows: Object.freeze({
    maximumItems: LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_ROWS,
    maximumPathUtf8Bytes: LIBRARY_CORE_PREFERENCE_PATH_MAXIMUM_UTF8_BYTES,
    maximumTextValueUtf8Bytes: LIBRARY_CORE_PREFERENCE_TEXT_MAXIMUM_UTF8_BYTES,
  }),
});

export const LIBRARY_CORE_PREFERENCES_SNAPSHOT_ORDER = Object.freeze({
  columns: Object.freeze(["path"]),
  direction: "asc",
  textCollation: "binary",
});

export type LibraryCorePreferenceValueType =
  "boolean" | "integer" | "null" | "real" | "text";

export interface LibraryCorePreferencesSnapshotRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_SCHEMA_VERSION;
}

export interface LibraryCorePreferenceNodeV1 {
  readonly booleanValue: boolean | null;
  readonly integerValue: number | null;
  readonly path: string;
  readonly realValue: number | null;
  readonly textValue: string | null;
  readonly updatedAt: number;
  readonly valueType: LibraryCorePreferenceValueType;
}

export interface LibraryCorePreferencesSnapshotResponseV1 {
  readonly queryId: typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_QUERY_ID;
  readonly rows: readonly LibraryCorePreferenceNodeV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

const REQUEST_KEYS =
  LIBRARY_CORE_PREFERENCES_SNAPSHOT_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS =
  LIBRARY_CORE_PREFERENCES_SNAPSHOT_RESPONSE_SCHEMA.canonicalKeys;
const ROW_KEYS = LIBRARY_CORE_PREFERENCES_SNAPSHOT_RESPONSE_SCHEMA.rowKeys;
const VALUE_TYPES = new Set<LibraryCorePreferenceValueType>([
  "boolean",
  "integer",
  "null",
  "real",
  "text",
]);
const textEncoder = new TextEncoder();

function closedRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: false, error });
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index]! - rightBytes[index]!;
    }
  }
  return leftBytes.length - rightBytes.length;
}

export function parseLibraryCorePreferencesSnapshotRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCorePreferencesSnapshotRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  if (
    !record ||
    record.queryId !== LIBRARY_CORE_PREFERENCES_SNAPSHOT_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_PREFERENCES_SNAPSHOT_SCHEMA_VERSION
  ) {
    return failure("preferences snapshot request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      queryId: LIBRARY_CORE_PREFERENCES_SNAPSHOT_QUERY_ID,
      schemaVersion: LIBRARY_CORE_PREFERENCES_SNAPSHOT_SCHEMA_VERSION,
    }),
  });
}

function parseNode(value: unknown): LibraryCorePreferenceNodeV1 | null {
  const row = closedRecord(value, ROW_KEYS);
  if (
    !row ||
    typeof row.path !== "string" ||
    row.path.length === 0 ||
    textEncoder.encode(row.path).byteLength >
      LIBRARY_CORE_PREFERENCE_PATH_MAXIMUM_UTF8_BYTES ||
    typeof row.valueType !== "string" ||
    !VALUE_TYPES.has(row.valueType as LibraryCorePreferenceValueType) ||
    !Number.isSafeInteger(row.updatedAt) ||
    (row.updatedAt as number) < 0 ||
    (row.booleanValue !== null && typeof row.booleanValue !== "boolean") ||
    (row.integerValue !== null && !Number.isSafeInteger(row.integerValue)) ||
    (row.realValue !== null &&
      (typeof row.realValue !== "number" || !Number.isFinite(row.realValue))) ||
    (row.textValue !== null && typeof row.textValue !== "string") ||
    (typeof row.textValue === "string" &&
      textEncoder.encode(row.textValue).byteLength >
        LIBRARY_CORE_PREFERENCE_TEXT_MAXIMUM_UTF8_BYTES)
  ) {
    return null;
  }
  const populated = [
    row.booleanValue !== null,
    row.integerValue !== null,
    row.realValue !== null,
    row.textValue !== null,
  ];
  const expected = [
    row.valueType === "boolean",
    row.valueType === "integer",
    row.valueType === "real",
    row.valueType === "text",
  ];
  if (populated.some((present, index) => present !== expected[index])) {
    return null;
  }
  const prefix = (row.path as string).slice(0, 2);
  if (
    !["a:", "o:", "v:"].includes(prefix) ||
    !(row.path as string).slice(2).startsWith("$.") ||
    (prefix === "a:" &&
      (row.valueType !== "integer" ||
        (row.integerValue as number) < 0 ||
        (row.integerValue as number) >
          LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_ROWS)) ||
    (prefix === "o:" && row.valueType !== "null")
  ) {
    return null;
  }
  return Object.freeze({
    booleanValue: row.booleanValue as boolean | null,
    integerValue: row.integerValue as number | null,
    path: row.path,
    realValue: row.realValue as number | null,
    textValue: row.textValue as string | null,
    updatedAt: row.updatedAt as number,
    valueType: row.valueType as LibraryCorePreferenceValueType,
  });
}

type LibraryCorePreferencePathSegmentV1 = string | number;

function parsePreferencePathV1(path: string): LibraryCorePreferencePathSegmentV1[] {
  if (!path.startsWith("$.") && !path.startsWith("$[")) {
    throw new TypeError("preference path does not begin at the root");
  }
  const segments: LibraryCorePreferencePathSegmentV1[] = [];
  let offset = 1;
  while (offset < path.length) {
    if (path[offset] === ".") {
      offset += 1;
      if (path[offset] === '"') {
        const start = offset;
        offset += 1;
        let escaped = false;
        while (offset < path.length) {
          const character = path[offset]!;
          if (!escaped && character === '"') break;
          escaped = !escaped && character === "\\";
          if (character !== "\\") escaped = false;
          offset += 1;
        }
        if (offset >= path.length) {
          throw new TypeError("preference path has an unterminated key");
        }
        const key = JSON.parse(path.slice(start, offset + 1));
        if (typeof key !== "string") {
          throw new TypeError("preference path key is invalid");
        }
        segments.push(key);
        offset += 1;
      } else {
        const start = offset;
        while (
          offset < path.length &&
          path[offset] !== "." &&
          path[offset] !== "["
        ) {
          offset += 1;
        }
        if (offset === start) {
          throw new TypeError("preference path contains an empty key");
        }
        segments.push(path.slice(start, offset));
      }
      continue;
    }
    if (path[offset] === "[") {
      const close = path.indexOf("]", offset + 1);
      const value = close < 0 ? "" : path.slice(offset + 1, close);
      if (!/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new TypeError("preference path array index is invalid");
      }
      const index = Number(value);
      if (
        !Number.isSafeInteger(index) ||
        index >= LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_ROWS
      ) {
        throw new TypeError("preference path array index exceeds its bound");
      }
      segments.push(index);
      offset = close + 1;
      continue;
    }
    throw new TypeError("preference path separator is invalid");
  }
  if (segments.length === 0) {
    throw new TypeError("preference path cannot name the root");
  }
  return segments;
}

function preferenceNodeValueV1(node: LibraryCorePreferenceNodeV1): unknown {
  if (node.path.startsWith("o:")) return Object.create(null);
  if (node.path.startsWith("a:")) {
    return new Array(node.integerValue ?? 0);
  }
  switch (node.valueType) {
    case "boolean":
      return node.booleanValue;
    case "integer":
      return node.integerValue;
    case "real":
      return node.realValue;
    case "text":
      return node.textValue;
    case "null":
      return null;
  }
}

function definePreferenceChildV1(
  parent: unknown,
  segment: LibraryCorePreferencePathSegmentV1,
  value: unknown,
): void {
  if (Array.isArray(parent)) {
    if (
      typeof segment !== "number" ||
      segment < 0 ||
      segment >= parent.length
    ) {
      throw new TypeError("preference array child is outside its container");
    }
    parent[segment] = value;
    return;
  }
  if (
    typeof parent !== "object" ||
    parent === null ||
    typeof segment !== "string"
  ) {
    throw new TypeError("preference object child has no matching container");
  }
  Object.defineProperty(parent, segment, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/** Reassemble one bounded preference tree from normalized SQLite nodes. */
export function libraryCorePreferenceNodesToValueV1(
  rows: readonly LibraryCorePreferenceNodeV1[],
): Readonly<Record<string, unknown>> {
  const decoded = rows.map((row) => ({
    node: row,
    logicalPath: row.path.slice(2),
    segments: parsePreferencePathV1(row.path.slice(2)),
  }));
  const logicalPaths = new Set<string>();
  for (const entry of decoded) {
    if (logicalPaths.has(entry.logicalPath)) {
      throw new TypeError("preference snapshot defines one path more than once");
    }
    logicalPaths.add(entry.logicalPath);
  }
  decoded.sort(
    (left, right) =>
      left.segments.length - right.segments.length ||
      compareUtf8(left.node.path, right.node.path),
  );
  const root = Object.create(null) as Record<string, unknown>;
  const values = new Map<string, unknown>([["$", root]]);
  for (const entry of decoded) {
    const parentPath = entry.logicalPath.replace(/(?:\.[^.[]+|\."(?:[^"\\]|\\.)*"|\[[0-9]+\])$/, "");
    const parent = values.get(parentPath);
    if (parent === undefined) {
      throw new TypeError("preference snapshot is missing a parent container");
    }
    const value = preferenceNodeValueV1(entry.node);
    definePreferenceChildV1(
      parent,
      entry.segments[entry.segments.length - 1]!,
      value,
    );
    values.set(entry.logicalPath, value);
  }
  return Object.freeze(root);
}

export function parseLibraryCorePreferencesSnapshotResponseV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCorePreferencesSnapshotResponseV1> {
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (
    !record ||
    !source.ok ||
    record.queryId !== LIBRARY_CORE_PREFERENCES_SNAPSHOT_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_PREFERENCES_SNAPSHOT_SCHEMA_VERSION ||
    !Array.isArray(record.rows) ||
    record.rows.length > LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_ROWS
  ) {
    return failure("preferences snapshot response is invalid");
  }
  const rows: LibraryCorePreferenceNodeV1[] = [];
  for (const candidate of record.rows) {
    const row = parseNode(candidate);
    if (
      !row ||
      (rows.at(-1) && compareUtf8(rows.at(-1)!.path, row.path) >= 0)
    ) {
      return failure("preferences snapshot rows are invalid");
    }
    rows.push(row);
  }
  const response = Object.freeze({
    queryId: LIBRARY_CORE_PREFERENCES_SNAPSHOT_QUERY_ID,
    rows: Object.freeze(rows),
    schemaVersion: LIBRARY_CORE_PREFERENCES_SNAPSHOT_SCHEMA_VERSION,
    source: source.value,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("preferences snapshot response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
