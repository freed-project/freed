import { useSyncExternalStore } from "react";
import type { AIPreferences } from "@freed/shared";
import {
  parseVersionedLocalStorage,
  readVersionedLocalStorage,
  writeVersionedLocalStorage,
  type VersionedLocalStorageCodec,
} from "./versioned-local-storage.js";

export type DeviceAIProvider = NonNullable<AIPreferences["provider"]>;

export interface DeviceAIPreferences {
  provider: DeviceAIProvider;
  model: string;
  ollamaUrl: string;
}

export const DEVICE_AI_PREFERENCES_STORAGE_KEY = "freed-device-ai-preferences-v1";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_DEVICE_AI_PREFERENCES: DeviceAIPreferences = {
  provider: "none",
  model: "",
  ollamaUrl: DEFAULT_OLLAMA_URL,
};

const listeners = new Set<() => void>();
let current = DEFAULT_DEVICE_AI_PREFERENCES;
let hydrated = false;
let storageListenerInstalled = false;

function isProvider(value: unknown): value is DeviceAIProvider {
  return value === "none"
    || value === "integrated"
    || value === "ollama"
    || value === "openai"
    || value === "anthropic"
    || value === "gemini";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(value: Partial<DeviceAIPreferences> | null | undefined): DeviceAIPreferences {
  return {
    provider: isProvider(value?.provider) ? value.provider : DEFAULT_DEVICE_AI_PREFERENCES.provider,
    model: typeof value?.model === "string" ? value.model : DEFAULT_DEVICE_AI_PREFERENCES.model,
    ollamaUrl: typeof value?.ollamaUrl === "string"
      ? value.ollamaUrl
      : DEFAULT_OLLAMA_URL,
  };
}

const STORAGE_CODEC: VersionedLocalStorageCodec<DeviceAIPreferences> = {
  version: 1,
  decode(value) {
    return isRecord(value.values)
      ? normalize(value.values)
      : null;
  },
  encode(values) {
    return { legacyMigrationCompleted: true, values };
  },
};

function readStored() {
  return readVersionedLocalStorage(DEVICE_AI_PREFERENCES_STORAGE_KEY, STORAGE_CODEC);
}

function persist(
  value: DeviceAIPreferences,
  replaceUnsupportedVersion = false,
): boolean {
  return writeVersionedLocalStorage(
    DEVICE_AI_PREFERENCES_STORAGE_KEY,
    STORAGE_CODEC,
    value,
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
    if (event.key !== DEVICE_AI_PREFERENCES_STORAGE_KEY) return;
    const stored = parseVersionedLocalStorage(event.newValue, STORAGE_CODEC);
    hydrated = true;
    if (stored.status === "supported") current = stored.value;
    else if (stored.status === "missing") current = DEFAULT_DEVICE_AI_PREFERENCES;
    else return;
    emitChange();
  });
}

export function getDeviceAIPreferences(): DeviceAIPreferences {
  if (!hydrated) {
    const stored = readStored();
    current = stored.status === "supported"
      ? stored.value
      : DEFAULT_DEVICE_AI_PREFERENCES;
    hydrated = true;
  }
  installStorageListener();
  return current;
}

export function setDeviceAIPreferences(value: Partial<DeviceAIPreferences>): boolean {
  const next = normalize({ ...getDeviceAIPreferences(), ...value });
  if (!persist(next)) return false;
  current = next;
  hydrated = true;
  emitChange();
  return true;
}

/** Reset device-local AI runtime choices without changing synchronized intent. */
export function clearDeviceAIPreferences(): boolean {
  if (!writeVersionedLocalStorage(
    DEVICE_AI_PREFERENCES_STORAGE_KEY,
    STORAGE_CODEC,
    DEFAULT_DEVICE_AI_PREFERENCES,
    { replaceUnsupportedVersion: true, purgeRecoveryCopies: true },
  )) return false;
  current = DEFAULT_DEVICE_AI_PREFERENCES;
  hydrated = true;
  emitChange();
  return true;
}

export function migrateLegacyDeviceAIPreferences(value: AIPreferences | null | undefined): boolean {
  if (readStored().status !== "missing") return false;
  const migrated = normalize({
    provider: value?.provider,
    model: value?.model,
    ollamaUrl: value?.ollamaUrl,
  });
  if (!persist(migrated)) return false;
  current = migrated;
  hydrated = true;
  emitChange();
  return true;
}

export function subscribeDeviceAIPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDeviceAIPreferences(): [
  DeviceAIPreferences,
  (value: Partial<DeviceAIPreferences>) => boolean,
] {
  const value = useSyncExternalStore(
    subscribeDeviceAIPreferences,
    getDeviceAIPreferences,
    () => DEFAULT_DEVICE_AI_PREFERENCES,
  );
  return [value, setDeviceAIPreferences];
}

export function resetDeviceAIPreferencesForTests(): void {
  current = DEFAULT_DEVICE_AI_PREFERENCES;
  hydrated = false;
  emitChange();
}
