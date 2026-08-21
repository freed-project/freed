import { isLibraryCoreEntityId, isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";

export const LIBRARY_CORE_DEVICE_GRAPH_LAYOUT_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_DEVICE_GRAPH_LAYOUT_MUTATION_IDS = Object.freeze([
  "account_graph_position_clear_v1",
  "account_graph_position_set_v1",
  "person_graph_position_clear_v1",
  "person_graph_position_set_v1",
] as const);

export type LibraryCoreDeviceGraphLayoutMutationId =
  (typeof LIBRARY_CORE_DEVICE_GRAPH_LAYOUT_MUTATION_IDS)[number];

export interface LibraryCoreDeviceGraphPositionSetV1 {
  readonly entityId: string;
  readonly graphX: number;
  readonly graphY: number;
  readonly mutationId:
    | "account_graph_position_set_v1"
    | "person_graph_position_set_v1";
  readonly schemaVersion: 1;
  readonly updatedAt: number;
}

export interface LibraryCoreDeviceGraphPositionClearV1 {
  readonly entityId: string;
  readonly mutationId:
    | "account_graph_position_clear_v1"
    | "person_graph_position_clear_v1";
  readonly schemaVersion: 1;
}

export type LibraryCoreDeviceGraphLayoutMutationV1 =
  | LibraryCoreDeviceGraphPositionSetV1
  | LibraryCoreDeviceGraphPositionClearV1;

export interface LibraryCoreDeviceGraphLayoutMutationResultV1 {
  readonly changed: boolean;
  readonly layoutRevision: number;
  readonly mutationId: LibraryCoreDeviceGraphLayoutMutationId;
  readonly schemaVersion: 1;
}

export type LibraryCoreDeviceGraphLayoutParseResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ error: string; ok: false }>;

function snapshotRecord(value: unknown): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !descriptors[key]?.enumerable ||
        !("value" in descriptors[key]),
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    keys.map((key) => [key, descriptors[key as string]!.value]),
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => expectedKeys.includes(key))
  );
}

function boundedCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1_000_000_000
  );
}

export function parseLibraryCoreDeviceGraphLayoutMutationV1(
  value: unknown,
): LibraryCoreDeviceGraphLayoutParseResult<LibraryCoreDeviceGraphLayoutMutationV1> {
  const candidate = snapshotRecord(value);
  const set =
    candidate?.mutationId === "account_graph_position_set_v1" ||
    candidate?.mutationId === "person_graph_position_set_v1";
  const expectedKeys = set
    ? ["entityId", "graphX", "graphY", "mutationId", "schemaVersion", "updatedAt"]
    : ["entityId", "mutationId", "schemaVersion"];
  if (
    !candidate ||
    !hasExactKeys(candidate, expectedKeys) ||
    !LIBRARY_CORE_DEVICE_GRAPH_LAYOUT_MUTATION_IDS.includes(
      candidate.mutationId as LibraryCoreDeviceGraphLayoutMutationId,
    ) ||
    candidate.schemaVersion !== LIBRARY_CORE_DEVICE_GRAPH_LAYOUT_SCHEMA_VERSION ||
    !isLibraryCoreEntityId(candidate.entityId) ||
    (set &&
      (!boundedCoordinate(candidate.graphX) ||
        !boundedCoordinate(candidate.graphY) ||
        !isLibraryCoreNonnegativeSafeInteger(candidate.updatedAt)))
  ) {
    return Object.freeze({
      error: "device graph layout mutation is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({ ...candidate }) as unknown as LibraryCoreDeviceGraphLayoutMutationV1,
  });
}

export function parseLibraryCoreDeviceGraphLayoutMutationResultV1(
  value: unknown,
): LibraryCoreDeviceGraphLayoutParseResult<LibraryCoreDeviceGraphLayoutMutationResultV1> {
  const candidate = snapshotRecord(value);
  if (
    !candidate ||
    !hasExactKeys(candidate, [
      "changed",
      "layoutRevision",
      "mutationId",
      "schemaVersion",
    ]) ||
    typeof candidate.changed !== "boolean" ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.layoutRevision) ||
    !LIBRARY_CORE_DEVICE_GRAPH_LAYOUT_MUTATION_IDS.includes(
      candidate.mutationId as LibraryCoreDeviceGraphLayoutMutationId,
    ) ||
    candidate.schemaVersion !== LIBRARY_CORE_DEVICE_GRAPH_LAYOUT_SCHEMA_VERSION
  ) {
    return Object.freeze({
      error: "device graph layout mutation result is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      changed: candidate.changed,
      layoutRevision: candidate.layoutRevision,
      mutationId: candidate.mutationId as LibraryCoreDeviceGraphLayoutMutationId,
      schemaVersion: 1,
    }),
  });
}
