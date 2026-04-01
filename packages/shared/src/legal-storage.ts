import {
  coerceLegalAcceptanceRecord,
  createAcceptanceRecord,
  type LegalAcceptanceRecord,
  type LegalSurface,
} from "./legal";

export interface StorageReader {
  getItem(key: string): string | null;
}

export interface StorageWriter extends StorageReader {
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function readAcceptanceFromStorage(
  storage: StorageReader,
  key: string,
): LegalAcceptanceRecord | null {
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    return coerceLegalAcceptanceRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeAcceptanceToStorage(
  storage: StorageWriter,
  key: string,
  version: string,
  surface: LegalSurface,
): LegalAcceptanceRecord {
  const record = createAcceptanceRecord(version, surface);
  storage.setItem(key, JSON.stringify(record));
  return record;
}
