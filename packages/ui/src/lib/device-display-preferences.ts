import { useSyncExternalStore } from "react";
import type {
  DisplayPreferences,
  FeedSignalMode,
  MapMode,
  MapTimeMode,
  SavedContentSortMode,
  SidebarMode,
} from "@freed/shared";
import {
  parseVersionedLocalStorage,
  readVersionedLocalStorage,
  writeVersionedLocalStorage,
  type VersionedLocalStorageCodec,
} from "./versioned-local-storage.js";

export const DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY = "freed-device-display-preferences-v1";

export interface DeviceDisplayPreferences {
  sidebarWidth: number;
  sidebarMode: SidebarMode;
  friendsSidebarWidth: number;
  friendsSidebarOpen: boolean;
  friendsMode: MapMode;
  debugPanelWidth: number;
  mapMode?: MapMode;
  mapTimeMode: MapTimeMode;
  feedSignalModes: FeedSignalMode[];
  savedContentSortMode: SavedContentSortMode;
  dualColumnMode: boolean;
}

const DEFAULT_DEVICE_DISPLAY_PREFERENCES: DeviceDisplayPreferences = {
  sidebarWidth: 256,
  sidebarMode: "expanded",
  friendsSidebarWidth: 360,
  friendsSidebarOpen: true,
  friendsMode: "all_content",
  debugPanelWidth: 320,
  mapTimeMode: "current",
  feedSignalModes: [],
  savedContentSortMode: "date_saved",
  dualColumnMode: true,
};

type Listener = () => void;

const listeners = new Set<Listener>();
let current: DeviceDisplayPreferences = DEFAULT_DEVICE_DISPLAY_PREFERENCES;
let hydrated = false;
let storageListenerInstalled = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSidebarMode(value: unknown): value is SidebarMode {
  return value === "expanded" || value === "compact" || value === "closed";
}

function isMapMode(value: unknown): value is MapMode {
  return value === "friends" || value === "all_content";
}

function isMapTimeMode(value: unknown): value is MapTimeMode {
  return value === "current" || value === "future" || value === "past";
}

function isFeedSignalMode(value: unknown): value is FeedSignalMode {
  return value === "all"
    || value === "inspiring"
    || value === "events"
    || value === "personal"
    || value === "conversation"
    || value === "news";
}

function isSavedContentSortMode(value: unknown): value is SavedContentSortMode {
  return value === "date_saved"
    || value === "date_published"
    || value === "recommended"
    || value === "shortest_read";
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeDeviceDisplayPreferences(
  value: Partial<DeviceDisplayPreferences> | null | undefined,
): DeviceDisplayPreferences {
  const defaults = DEFAULT_DEVICE_DISPLAY_PREFERENCES;
  const feedSignalModes = Array.isArray(value?.feedSignalModes)
    ? Array.from(new Set(value.feedSignalModes.filter(isFeedSignalMode).filter((mode) => mode !== "all")))
    : defaults.feedSignalModes;
  const mapMode = isMapMode(value?.mapMode) ? value.mapMode : undefined;

  return {
    sidebarWidth: finiteNumber(value?.sidebarWidth, defaults.sidebarWidth),
    sidebarMode: isSidebarMode(value?.sidebarMode) ? value.sidebarMode : defaults.sidebarMode,
    friendsSidebarWidth: finiteNumber(value?.friendsSidebarWidth, defaults.friendsSidebarWidth),
    friendsSidebarOpen: typeof value?.friendsSidebarOpen === "boolean"
      ? value.friendsSidebarOpen
      : defaults.friendsSidebarOpen,
    friendsMode: isMapMode(value?.friendsMode) ? value.friendsMode : defaults.friendsMode,
    debugPanelWidth: finiteNumber(value?.debugPanelWidth, defaults.debugPanelWidth),
    ...(mapMode ? { mapMode } : {}),
    mapTimeMode: isMapTimeMode(value?.mapTimeMode) ? value.mapTimeMode : defaults.mapTimeMode,
    feedSignalModes,
    savedContentSortMode: isSavedContentSortMode(value?.savedContentSortMode)
      ? value.savedContentSortMode
      : defaults.savedContentSortMode,
    dualColumnMode: typeof value?.dualColumnMode === "boolean"
      ? value.dualColumnMode
      : defaults.dualColumnMode,
  };
}

const STORAGE_CODEC: VersionedLocalStorageCodec<DeviceDisplayPreferences> = {
  version: 1,
  decode(value) {
    return isRecord(value.values)
      ? normalizeDeviceDisplayPreferences(value.values)
      : null;
  },
  encode(values) {
    return { values };
  },
};

function readStoredPreferences() {
  return readVersionedLocalStorage(
    DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY,
    STORAGE_CODEC,
  );
}

function persistPreferences(
  values: DeviceDisplayPreferences,
  replaceUnsupportedVersion = false,
): boolean {
  return writeVersionedLocalStorage(
    DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY,
    STORAGE_CODEC,
    values,
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
    if (event.key !== DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY) return;
    const stored = parseVersionedLocalStorage(event.newValue, STORAGE_CODEC);
    hydrated = true;
    if (stored.status === "supported") current = stored.value;
    else if (stored.status === "missing") current = DEFAULT_DEVICE_DISPLAY_PREFERENCES;
    else return;
    emitChange();
  });
}

export function getDeviceDisplayPreferences(): DeviceDisplayPreferences {
  if (!hydrated) {
    const stored = readStoredPreferences();
    current = stored.status === "supported"
      ? stored.value
      : DEFAULT_DEVICE_DISPLAY_PREFERENCES;
    hydrated = true;
  }
  installStorageListener();
  return current;
}

export function setDeviceDisplayPreferences(update: Partial<DeviceDisplayPreferences>): boolean {
  const next = normalizeDeviceDisplayPreferences({
    ...getDeviceDisplayPreferences(),
    ...update,
  });
  if (!persistPreferences(next)) return false;
  current = next;
  hydrated = true;
  emitChange();
  return true;
}

/** Reset device-local display choices without touching synchronized preferences. */
export function clearDeviceDisplayPreferences(): boolean {
  if (!writeVersionedLocalStorage(
    DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY,
    STORAGE_CODEC,
    DEFAULT_DEVICE_DISPLAY_PREFERENCES,
    { replaceUnsupportedVersion: true, purgeRecoveryCopies: true },
  )) return false;
  current = DEFAULT_DEVICE_DISPLAY_PREFERENCES;
  hydrated = true;
  emitChange();
  return true;
}

export function migrateLegacyDeviceDisplayPreferences(display: DisplayPreferences): boolean {
  if (readStoredPreferences().status !== "missing") return false;

  const legacyModes = Array.isArray(display.feedSignalModes)
    ? display.feedSignalModes
    : display.feedSignalMode && display.feedSignalMode !== "all"
      ? [display.feedSignalMode]
      : [];
  const migrated = normalizeDeviceDisplayPreferences({
    sidebarWidth: display.sidebarWidth,
    sidebarMode: display.sidebarMode,
    friendsSidebarWidth: display.friendsSidebarWidth,
    friendsSidebarOpen: display.friendsSidebarOpen,
    friendsMode: display.friendsMode,
    debugPanelWidth: display.debugPanelWidth,
    mapMode: display.mapMode,
    mapTimeMode: display.mapTimeMode,
    feedSignalModes: legacyModes,
    savedContentSortMode: display.savedContentSortMode,
    dualColumnMode: display.reading.dualColumnMode,
  });
  if (!persistPreferences(migrated)) return false;
  current = migrated;
  hydrated = true;
  emitChange();
  return true;
}

export function useDeviceDisplayPreferences(): [
  DeviceDisplayPreferences,
  (update: Partial<DeviceDisplayPreferences>) => boolean,
] {
  const preferences = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getDeviceDisplayPreferences,
    () => DEFAULT_DEVICE_DISPLAY_PREFERENCES,
  );
  return [preferences, setDeviceDisplayPreferences];
}

export function resetDeviceDisplayPreferencesForTests(): void {
  current = DEFAULT_DEVICE_DISPLAY_PREFERENCES;
  hydrated = false;
  emitChange();
}
