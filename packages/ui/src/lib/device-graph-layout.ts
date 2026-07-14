import { useSyncExternalStore } from "react";
import type { Account, GraphPositionFields, Person } from "@freed/shared";
import {
  parseVersionedLocalStorage,
  readVersionedLocalStorage,
  writeVersionedLocalStorage,
  type VersionedLocalStorageCodec,
} from "./versioned-local-storage.js";

export const DEVICE_GRAPH_LAYOUT_STORAGE_KEY = "freed-device-graph-layout-v1";

export interface DeviceGraphLayoutRecord {
  readonly graphX: number;
  readonly graphY: number;
  readonly graphPinned: true;
  readonly graphUpdatedAt?: number;
}

export interface DeviceGraphLayoutSnapshot {
  readonly version: 1;
  readonly legacyMigrationCompleted: boolean;
  readonly persons: Readonly<Record<string, DeviceGraphLayoutRecord>>;
  readonly accounts: Readonly<Record<string, DeviceGraphLayoutRecord>>;
}

export interface DeviceGraphLayoutEntities {
  readonly persons: Record<string, Person>;
  readonly accounts: Record<string, Account>;
}

type GraphLayoutEntity = Pick<
  Person,
  "id" | "graphX" | "graphY" | "graphPinned" | "graphUpdatedAt"
>;

type Listener = () => void;

const EMPTY_SNAPSHOT: DeviceGraphLayoutSnapshot = {
  version: 1,
  legacyMigrationCompleted: false,
  persons: {},
  accounts: {},
};

let current: DeviceGraphLayoutSnapshot = EMPTY_SNAPSHOT;
let hydrated = false;
let storageListenerInstalled = false;
const listeners = new Set<Listener>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeLayoutRecord(value: unknown): DeviceGraphLayoutRecord | null {
  if (!isRecord(value) || value.graphPinned !== true) return null;
  const graphX = finiteNumber(value.graphX);
  const graphY = finiteNumber(value.graphY);
  if (graphX === null || graphY === null) return null;

  const graphUpdatedAt = finiteNumber(value.graphUpdatedAt);
  return {
    graphX,
    graphY,
    graphPinned: true,
    ...(graphUpdatedAt !== null && graphUpdatedAt >= 0 ? { graphUpdatedAt } : {}),
  };
}

function normalizeLayoutMap(value: unknown): Record<string, DeviceGraphLayoutRecord> {
  if (!isRecord(value)) return {};
  const normalized: Record<string, DeviceGraphLayoutRecord> = {};
  for (const [id, candidate] of Object.entries(value)) {
    if (!id) continue;
    const record = normalizeLayoutRecord(candidate);
    if (record) normalized[id] = record;
  }
  return normalized;
}

const STORAGE_CODEC: VersionedLocalStorageCodec<DeviceGraphLayoutSnapshot> = {
  version: 1,
  decode(value) {
    if (
      typeof value.legacyMigrationCompleted !== "boolean"
      || !isRecord(value.persons)
      || !isRecord(value.accounts)
    ) return null;
    return {
      version: 1,
      legacyMigrationCompleted: value.legacyMigrationCompleted,
      persons: normalizeLayoutMap(value.persons),
      accounts: normalizeLayoutMap(value.accounts),
    };
  },
  encode(value) {
    return {
      legacyMigrationCompleted: value.legacyMigrationCompleted,
      persons: value.persons,
      accounts: value.accounts,
    };
  },
};

function readStoredSnapshot() {
  return readVersionedLocalStorage(DEVICE_GRAPH_LAYOUT_STORAGE_KEY, STORAGE_CODEC);
}

function persistSnapshot(
  snapshot: DeviceGraphLayoutSnapshot,
  replaceUnsupportedVersion = false,
): boolean {
  return writeVersionedLocalStorage(
    DEVICE_GRAPH_LAYOUT_STORAGE_KEY,
    STORAGE_CODEC,
    snapshot,
    { replaceUnsupportedVersion },
  );
}

function emitChange(): void {
  for (const listener of listeners) listener();
}

function installStorageListener(): void {
  if (storageListenerInstalled || typeof window === "undefined") return;
  storageListenerInstalled = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== DEVICE_GRAPH_LAYOUT_STORAGE_KEY) return;
    const stored = parseVersionedLocalStorage(event.newValue, STORAGE_CODEC);
    hydrated = true;
    if (stored.status === "supported") current = stored.value;
    else if (stored.status === "missing") current = EMPTY_SNAPSHOT;
    else return;
    emitChange();
  });
}

function updateSnapshot(
  snapshot: DeviceGraphLayoutSnapshot,
  replaceUnsupportedVersion = false,
): boolean {
  if (!persistSnapshot(snapshot, replaceUnsupportedVersion)) return false;
  current = snapshot;
  hydrated = true;
  emitChange();
  return true;
}

function sameLayout(
  left: DeviceGraphLayoutRecord | undefined,
  right: DeviceGraphLayoutRecord,
): boolean {
  return left?.graphX === right.graphX
    && left.graphY === right.graphY
    && left.graphPinned === right.graphPinned
    && left.graphUpdatedAt === right.graphUpdatedAt;
}

function setLayoutRecord(
  kind: "persons" | "accounts",
  id: string,
  graphX: number,
  graphY: number,
  graphUpdatedAt: number,
): boolean {
  if (!id) return false;
  const record = normalizeLayoutRecord({
    graphX,
    graphY,
    graphPinned: true,
    graphUpdatedAt,
  });
  if (!record) return false;

  const snapshot = getDeviceGraphLayout();
  if (sameLayout(snapshot[kind][id], record)) return true;
  return updateSnapshot({
    ...snapshot,
    [kind]: { ...snapshot[kind], [id]: record },
  });
}

function removeLayoutRecord(kind: "persons" | "accounts", id: string): boolean {
  const snapshot = getDeviceGraphLayout();
  if (!snapshot[kind][id]) return true;
  const next = { ...snapshot[kind] };
  delete next[id];
  return updateSnapshot({ ...snapshot, [kind]: next });
}

function layoutFromLegacyEntity(entity: GraphLayoutEntity): DeviceGraphLayoutRecord | null {
  return normalizeLayoutRecord(entity);
}

function applyLayoutOverlay<T extends GraphLayoutEntity>(
  entity: T,
  layout: DeviceGraphLayoutRecord | undefined,
): T {
  const hasLegacyLayout = "graphX" in entity
    || "graphY" in entity
    || "graphPinned" in entity
    || "graphUpdatedAt" in entity;
  if (!layout && !hasLegacyLayout) return entity;

  const {
    graphX: _graphX,
    graphY: _graphY,
    graphPinned: _graphPinned,
    graphUpdatedAt: _graphUpdatedAt,
    ...withoutLegacyLayout
  } = entity;
  return {
    ...withoutLegacyLayout,
    ...(layout ?? {}),
  } as T;
}

export function getDeviceGraphLayout(): DeviceGraphLayoutSnapshot {
  if (!hydrated) {
    const stored = readStoredSnapshot();
    current = stored.status === "supported" ? stored.value : EMPTY_SNAPSHOT;
    hydrated = true;
  }
  installStorageListener();
  return current;
}

export function getDevicePersonGraphLayout(id: string): DeviceGraphLayoutRecord | null {
  return getDeviceGraphLayout().persons[id] ?? null;
}

export function getDeviceAccountGraphLayout(id: string): DeviceGraphLayoutRecord | null {
  return getDeviceGraphLayout().accounts[id] ?? null;
}

export function setDevicePersonGraphPosition(
  id: string,
  graphX: number,
  graphY: number,
  graphUpdatedAt = Date.now(),
): boolean {
  return setLayoutRecord("persons", id, graphX, graphY, graphUpdatedAt);
}

export function setDeviceAccountGraphPosition(
  id: string,
  graphX: number,
  graphY: number,
  graphUpdatedAt = Date.now(),
): boolean {
  return setLayoutRecord("accounts", id, graphX, graphY, graphUpdatedAt);
}

function applyGraphPositionUpdate(
  kind: "persons" | "accounts",
  id: string,
  update: Partial<GraphPositionFields>,
): boolean {
  if (!("graphX" in update)
    && !("graphY" in update)
    && !("graphPinned" in update)
    && !("graphUpdatedAt" in update)) return false;
  if (update.graphPinned === false) return removeLayoutRecord(kind, id);
  const currentLayout = kind === "persons"
    ? getDevicePersonGraphLayout(id)
    : getDeviceAccountGraphLayout(id);
  const graphX = update.graphX ?? currentLayout?.graphX;
  const graphY = update.graphY ?? currentLayout?.graphY;
  if (!Number.isFinite(graphX) || !Number.isFinite(graphY)) return false;
  return setLayoutRecord(
    kind,
    id,
    graphX as number,
    graphY as number,
    update.graphUpdatedAt ?? Date.now(),
  );
}

/** Route legacy Person update calls into this device's graph layout. */
export function applyDevicePersonGraphPositionUpdate(
  id: string,
  update: Partial<GraphPositionFields>,
): boolean {
  return applyGraphPositionUpdate("persons", id, update);
}

/** Route legacy Account update calls into this device's graph layout. */
export function applyDeviceAccountGraphPositionUpdate(
  id: string,
  update: Partial<GraphPositionFields>,
): boolean {
  return applyGraphPositionUpdate("accounts", id, update);
}

/**
 * Remove local positions whose synchronized entities no longer exist.
 * Call this only with a document state that the worker has successfully
 * persisted or adopted, so a failed mutation cannot erase a recoverable pin.
 */
export function pruneDeviceGraphLayout(
  persons: Readonly<Record<string, Person>>,
  accounts: Readonly<Record<string, Account>>,
): boolean {
  const snapshot = getDeviceGraphLayout();
  let nextPersons: Record<string, DeviceGraphLayoutRecord> | null = null;
  let nextAccounts: Record<string, DeviceGraphLayoutRecord> | null = null;

  for (const id of Object.keys(snapshot.persons)) {
    if (Object.prototype.hasOwnProperty.call(persons, id)) continue;
    nextPersons ??= { ...snapshot.persons };
    delete nextPersons[id];
  }

  for (const id of Object.keys(snapshot.accounts)) {
    if (Object.prototype.hasOwnProperty.call(accounts, id)) continue;
    nextAccounts ??= { ...snapshot.accounts };
    delete nextAccounts[id];
  }

  if (!nextPersons && !nextAccounts) return false;
  return updateSnapshot({
    ...snapshot,
    persons: nextPersons ?? snapshot.persons,
    accounts: nextAccounts ?? snapshot.accounts,
  });
}

/**
 * Restore pins for account IDs that survived a successful remove and re-add
 * replacement. IDs omitted by the replacement stay pruned.
 */
export function restoreReplacedDeviceAccountGraphPositions(
  retainedAccountIds: Iterable<string>,
  beforeReplacement: DeviceGraphLayoutSnapshot,
): boolean {
  const snapshot = getDeviceGraphLayout();
  let nextAccounts: Record<string, DeviceGraphLayoutRecord> | null = null;

  for (const id of new Set(retainedAccountIds)) {
    const record = beforeReplacement.accounts[id];
    if (!record || snapshot.accounts[id]) continue;
    nextAccounts ??= { ...snapshot.accounts };
    nextAccounts[id] = record;
  }

  if (!nextAccounts) return false;
  return updateSnapshot({ ...snapshot, accounts: nextAccounts });
}

/** Remove every local pin without reopening the one-time legacy migration. */
export function clearDeviceGraphLayout(): boolean {
  const cleared: DeviceGraphLayoutSnapshot = {
    version: 1,
    legacyMigrationCompleted: true,
    persons: {},
    accounts: {},
  };
  if (!writeVersionedLocalStorage(
    DEVICE_GRAPH_LAYOUT_STORAGE_KEY,
    STORAGE_CODEC,
    cleared,
    { replaceUnsupportedVersion: true, purgeRecoveryCopies: true },
  )) return false;
  current = cleared;
  hydrated = true;
  emitChange();
  return true;
}

/**
 * Import valid legacy Automerge pins once. Existing local pins always win, and
 * the completion marker prevents later stale synced fields from replaying.
 */
export function migrateLegacyDeviceGraphLayout(
  persons: Readonly<Record<string, Person>>,
  accounts: Readonly<Record<string, Account>>,
): boolean {
  const stored = readStoredSnapshot();
  if (
    stored.status === "unsupported"
    || stored.status === "corrupt"
    || stored.status === "unavailable"
  ) return false;
  const snapshot = getDeviceGraphLayout();
  if (snapshot.legacyMigrationCompleted) return false;

  const nextPersons = { ...snapshot.persons };
  for (const person of Object.values(persons)) {
    if (!person.id || nextPersons[person.id]) continue;
    const layout = layoutFromLegacyEntity(person);
    if (layout) nextPersons[person.id] = layout;
  }

  const nextAccounts = { ...snapshot.accounts };
  for (const account of Object.values(accounts)) {
    if (!account.id || nextAccounts[account.id]) continue;
    const layout = layoutFromLegacyEntity(account);
    if (layout) nextAccounts[account.id] = layout;
  }

  const migrated: DeviceGraphLayoutSnapshot = {
    version: 1,
    legacyMigrationCompleted: true,
    persons: nextPersons,
    accounts: nextAccounts,
  };
  if (!persistSnapshot(migrated)) return false;
  current = migrated;
  hydrated = true;
  emitChange();
  return true;
}

export function applyDeviceGraphLayoutToPerson(
  person: Person,
  snapshot: DeviceGraphLayoutSnapshot = getDeviceGraphLayout(),
): Person {
  return applyLayoutOverlay(person, snapshot.persons[person.id]);
}

export function applyDeviceGraphLayoutToAccount(
  account: Account,
  snapshot: DeviceGraphLayoutSnapshot = getDeviceGraphLayout(),
): Account {
  return applyLayoutOverlay(account, snapshot.accounts[account.id]);
}

/**
 * Remove every legacy synchronized position before applying this device's
 * local position. Callers never receive raw Automerge graph placement.
 */
export function applyDeviceGraphLayout(
  persons: Readonly<Record<string, Person>>,
  accounts: Readonly<Record<string, Account>>,
  snapshot: DeviceGraphLayoutSnapshot = getDeviceGraphLayout(),
): DeviceGraphLayoutEntities {
  return {
    persons: Object.fromEntries(
      Object.entries(persons).map(([id, person]) => [
        id,
        applyDeviceGraphLayoutToPerson(person, snapshot),
      ]),
    ),
    accounts: Object.fromEntries(
      Object.entries(accounts).map(([id, account]) => [
        id,
        applyDeviceGraphLayoutToAccount(account, snapshot),
      ]),
    ),
  };
}

export function subscribeDeviceGraphLayout(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDeviceGraphLayout(): DeviceGraphLayoutSnapshot {
  return useSyncExternalStore(
    subscribeDeviceGraphLayout,
    getDeviceGraphLayout,
    () => EMPTY_SNAPSHOT,
  );
}

export function resetDeviceGraphLayoutForTests(): void {
  current = EMPTY_SNAPSHOT;
  hydrated = false;
  emitChange();
}
