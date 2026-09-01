import {
  readLibraryCoreNormalizedAccountDetailV1,
  readLibraryCoreNormalizedPersonDetailV1,
  type LibraryCoreDeviceGraphLayoutMutationExecutor,
  type LibraryCoreNormalizedQueryExecutor,
} from "@freed/shared/library-core";
import {
  readVersionedLocalStorage,
  type VersionedLocalStorageCodec,
} from "./versioned-local-storage.js";

export const DEVICE_GRAPH_LAYOUT_STORAGE_KEY = "freed-device-graph-layout-v1";

interface LegacyDeviceGraphLayoutRecord {
  readonly graphX: number;
  readonly graphY: number;
  readonly graphUpdatedAt: number;
}

interface LegacyDeviceGraphLayoutSnapshot {
  readonly persons: Readonly<Record<string, LegacyDeviceGraphLayoutRecord>>;
  readonly accounts: Readonly<Record<string, LegacyDeviceGraphLayoutRecord>>;
}

export interface LegacyDeviceGraphLayoutMigrationRuntime {
  readonly mutate: LibraryCoreDeviceGraphLayoutMutationExecutor;
  readonly query: LibraryCoreNormalizedQueryExecutor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLayoutRecord(
  value: unknown,
): LegacyDeviceGraphLayoutRecord | null {
  if (!isRecord(value) || value.graphPinned !== true) return null;
  const graphX = value.graphX;
  const graphY = value.graphY;
  const graphUpdatedAt = value.graphUpdatedAt ?? 0;
  if (
    typeof graphX !== "number" ||
    !Number.isFinite(graphX) ||
    Math.abs(graphX) > 1_000_000_000 ||
    typeof graphY !== "number" ||
    !Number.isFinite(graphY) ||
    Math.abs(graphY) > 1_000_000_000 ||
    typeof graphUpdatedAt !== "number" ||
    !Number.isSafeInteger(graphUpdatedAt) ||
    graphUpdatedAt < 0
  ) {
    return null;
  }
  return Object.freeze({ graphX, graphY, graphUpdatedAt });
}

function normalizeLayoutMap(
  value: unknown,
): Readonly<Record<string, LegacyDeviceGraphLayoutRecord>> {
  if (!isRecord(value)) return Object.freeze({});
  const normalized: Record<string, LegacyDeviceGraphLayoutRecord> = {};
  for (const [id, candidate] of Object.entries(value)) {
    if (id.length === 0 || id.length > 2_048) continue;
    const record = normalizeLayoutRecord(candidate);
    if (record) normalized[id] = record;
  }
  return Object.freeze(normalized);
}

const LEGACY_STORAGE_CODEC: VersionedLocalStorageCodec<LegacyDeviceGraphLayoutSnapshot> = {
  version: 1,
  decode(value) {
    if (!isRecord(value.persons) || !isRecord(value.accounts)) return null;
    return Object.freeze({
      persons: normalizeLayoutMap(value.persons),
      accounts: normalizeLayoutMap(value.accounts),
    });
  },
  encode(value) {
    return { persons: value.persons, accounts: value.accounts };
  },
};

/** Delete the retired localStorage authority and every recovery copy. */
export function clearLegacyDeviceGraphLayoutImport(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const prefix = `${DEVICE_GRAPH_LAYOUT_STORAGE_KEY}.recovery.`;
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key === DEVICE_GRAPH_LAYOUT_STORAGE_KEY || key?.startsWith(prefix)) {
        keys.push(key);
      }
    }
    for (const key of keys) window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Import the retired localStorage pins once into device-local SQLite.
 *
 * Exact SQLite point reads discard pins whose synchronized entity no longer
 * exists. Any query or mutation failure preserves the historical record for a
 * later retry. Successful completion deletes the monolithic storage key.
 */
export async function migrateLegacyDeviceGraphLayoutToSqlite(
  runtime: LegacyDeviceGraphLayoutMigrationRuntime,
): Promise<number> {
  const stored = readVersionedLocalStorage(
    DEVICE_GRAPH_LAYOUT_STORAGE_KEY,
    LEGACY_STORAGE_CODEC,
  );
  if (stored.status === "missing" || stored.status === "unavailable") return 0;
  if (stored.status !== "supported") {
    if (!clearLegacyDeviceGraphLayoutImport()) {
      throw new Error("Freed could not discard the retired graph layout record");
    }
    return 0;
  }

  const reader = Object.freeze({
    query: runtime.query,
    randomId: () => crypto.randomUUID(),
  });
  let imported = 0;
  for (const [entityId, record] of Object.entries(stored.value.persons).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (!(await readLibraryCoreNormalizedPersonDetailV1(reader, entityId))) {
      continue;
    }
    const result = await runtime.mutate({
      entityId,
      graphX: record.graphX,
      graphY: record.graphY,
      mutationId: "person_graph_position_set_v1",
      schemaVersion: 1,
      updatedAt: record.graphUpdatedAt,
    });
    if (result.changed) imported += 1;
  }
  for (const [entityId, record] of Object.entries(stored.value.accounts).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (!(await readLibraryCoreNormalizedAccountDetailV1(reader, entityId))) {
      continue;
    }
    const result = await runtime.mutate({
      entityId,
      graphX: record.graphX,
      graphY: record.graphY,
      mutationId: "account_graph_position_set_v1",
      schemaVersion: 1,
      updatedAt: record.graphUpdatedAt,
    });
    if (result.changed) imported += 1;
  }
  if (!clearLegacyDeviceGraphLayoutImport()) {
    throw new Error("Freed could not retire the imported graph layout record");
  }
  return imported;
}
