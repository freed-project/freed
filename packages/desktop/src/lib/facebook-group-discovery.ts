import { useSyncExternalStore } from "react";
import type { FbGroupInfo } from "@freed/shared";
import {
  parseVersionedLocalStorage,
  readVersionedLocalStorage,
  writeVersionedLocalStorage,
  type VersionedLocalStorageCodec,
} from "@freed/ui/lib/versioned-local-storage";
import { mergeFacebookGroupRecords } from "./facebook-groups";
import {
  recordFacebookGroupDiscoveryUpdate,
  type FacebookGroupDiscoverySource,
} from "./runtime-health-events";

export const FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY = "freed-device-facebook-groups-v1";

const MAX_GROUPS = 5_000;
const MAX_GROUP_ID_LENGTH = 512;
const MAX_GROUP_NAME_LENGTH = 2_000;
const MAX_GROUP_URL_LENGTH = 4_096;

interface StoredFacebookGroupDiscovery {
  legacyMigrationCompleted: true;
  knownGroups: Record<string, FbGroupInfo>;
}

export interface FacebookGroupDiscoveryUpdateResult {
  knownGroups: Record<string, FbGroupInfo>;
  changedCount: number;
  repairedNameCount: number;
  persisted: boolean;
}

export interface FacebookGroupDiscoveryRemovalResult {
  existed: boolean;
  persisted: boolean;
}

const EMPTY_DISCOVERY: StoredFacebookGroupDiscovery = {
  legacyMigrationCompleted: true,
  knownGroups: {},
};

const listeners = new Set<() => void>();
let current = EMPTY_DISCOVERY;
let hydrated = false;
let storageListenerInstalled = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeGroup(value: unknown): FbGroupInfo | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string"
    || value.id.length === 0
    || value.id.length > MAX_GROUP_ID_LENGTH
    || value.id === "__proto__"
    || value.id === "constructor"
    || value.id === "prototype"
    || typeof value.name !== "string"
    || value.name.length > MAX_GROUP_NAME_LENGTH
    || typeof value.url !== "string"
    || value.url.length > MAX_GROUP_URL_LENGTH
  ) {
    return null;
  }
  return { id: value.id, name: value.name, url: value.url };
}

function normalizeKnownGroups(value: unknown): Record<string, FbGroupInfo> | null {
  if (!isRecord(value)) return null;
  const source = Object.entries(value);
  if (source.length > MAX_GROUPS) return null;
  const knownGroups: Record<string, FbGroupInfo> = {};
  for (const [key, candidate] of source) {
    const group = normalizeGroup(candidate);
    if (!group || key !== group.id) return null;
    knownGroups[key] = group;
  }
  return knownGroups;
}

function sanitizeKnownGroups(value: Record<string, FbGroupInfo>): Record<string, FbGroupInfo> {
  const groups: Record<string, FbGroupInfo> = {};
  for (const candidate of Object.values(value).slice(0, MAX_GROUPS)) {
    const group = normalizeGroup(candidate);
    if (group) groups[group.id] = group;
  }
  return groups;
}

const STORAGE_CODEC: VersionedLocalStorageCodec<StoredFacebookGroupDiscovery> = {
  version: 1,
  decode(value) {
    if (value.legacyMigrationCompleted !== true) return null;
    const knownGroups = normalizeKnownGroups(value.knownGroups);
    return knownGroups ? { legacyMigrationCompleted: true, knownGroups } : null;
  },
  encode(value) {
    return {
      legacyMigrationCompleted: true,
      knownGroups: value.knownGroups,
    };
  },
};

function readStored() {
  return readVersionedLocalStorage(FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY, STORAGE_CODEC);
}

function emitChange(): void {
  for (const listener of listeners) listener();
}

function persist(
  knownGroups: Record<string, FbGroupInfo>,
  replaceUnsupportedVersion = false,
): boolean {
  const next: StoredFacebookGroupDiscovery = {
    legacyMigrationCompleted: true,
    knownGroups,
  };
  if (!writeVersionedLocalStorage(
    FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY,
    STORAGE_CODEC,
    next,
    { replaceUnsupportedVersion },
  )) {
    return false;
  }
  current = next;
  hydrated = true;
  emitChange();
  return true;
}

function installStorageListener(): void {
  if (storageListenerInstalled || typeof window === "undefined") return;
  storageListenerInstalled = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY) return;
    const stored = parseVersionedLocalStorage(event.newValue, STORAGE_CODEC);
    hydrated = true;
    if (stored.status === "supported") current = stored.value;
    else if (stored.status === "missing") current = EMPTY_DISCOVERY;
    else return;
    emitChange();
  });
}

export function getFacebookGroupDiscovery(): Record<string, FbGroupInfo> {
  if (!hydrated) {
    const stored = readStored();
    current = stored.status === "supported" ? stored.value : EMPTY_DISCOVERY;
    hydrated = true;
  }
  installStorageListener();
  return current.knownGroups;
}

function recordUpdate(
  source: FacebookGroupDiscoverySource,
  input: {
    observedCount: number;
    storedCount: number;
    changedCount: number;
    removedCount: number;
  },
): void {
  recordFacebookGroupDiscoveryUpdate({ source, ...input });
}

export function updateFacebookGroupDiscovery(
  groups: readonly FbGroupInfo[],
  source: FacebookGroupDiscoverySource,
): FacebookGroupDiscoveryUpdateResult {
  const merge = mergeFacebookGroupRecords(getFacebookGroupDiscovery(), groups);
  if (merge.changedCount === 0) {
    return { ...merge, persisted: true };
  }
  const persisted = persist(merge.knownGroups);
  if (persisted) {
    recordUpdate(source, {
      observedCount: groups.length,
      storedCount: Object.keys(merge.knownGroups).length,
      changedCount: merge.changedCount,
      removedCount: 0,
    });
  }
  return { ...merge, persisted };
}

export function removeFacebookGroupDiscovery(
  groupId: string,
  source: FacebookGroupDiscoverySource = "membership_check",
): FacebookGroupDiscoveryRemovalResult {
  const stored = readStored();
  if (stored.status === "unsupported" || stored.status === "unavailable" || stored.status === "corrupt") {
    return { existed: false, persisted: false };
  }
  const currentGroups = stored.status === "supported" ? stored.value.knownGroups : {};
  if (!(groupId in currentGroups)) return { existed: false, persisted: true };
  const next = { ...currentGroups };
  delete next[groupId];
  if (!persist(next)) return { existed: true, persisted: false };
  recordUpdate(source, {
    observedCount: 0,
    storedCount: Object.keys(next).length,
    changedCount: 1,
    removedCount: 1,
  });
  return { existed: true, persisted: true };
}

export function migrateLegacyFacebookGroupDiscovery(
  knownGroups: Record<string, FbGroupInfo> | null | undefined,
): boolean {
  if (readStored().status !== "missing") return false;
  const next = sanitizeKnownGroups(knownGroups ?? {});
  if (!persist(next)) return false;
  recordUpdate("legacy_migration", {
    observedCount: Object.keys(knownGroups ?? {}).length,
    storedCount: Object.keys(next).length,
    changedCount: Object.keys(next).length,
    removedCount: 0,
  });
  return true;
}

export function clearFacebookGroupDiscovery(): boolean {
  const removedCount = Object.keys(getFacebookGroupDiscovery()).length;
  const cleared: StoredFacebookGroupDiscovery = {
    legacyMigrationCompleted: true,
    knownGroups: {},
  };
  const persisted = writeVersionedLocalStorage(
    FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY,
    STORAGE_CODEC,
    cleared,
    { replaceUnsupportedVersion: true, purgeRecoveryCopies: true },
  );
  if (!persisted) return false;
  current = cleared;
  hydrated = true;
  emitChange();
  recordUpdate("factory_reset", {
    observedCount: 0,
    storedCount: 0,
    changedCount: removedCount,
    removedCount,
  });
  return true;
}

export function useFacebookGroupDiscovery(): Record<string, FbGroupInfo> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getFacebookGroupDiscovery,
    () => EMPTY_DISCOVERY.knownGroups,
  );
}

export function resetFacebookGroupDiscoveryForTests(): void {
  current = EMPTY_DISCOVERY;
  hydrated = false;
  emitChange();
}
