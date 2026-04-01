import {
  CONTACT_SYNC_STORAGE_KEY,
  createEmptyContactSyncState,
  parseContactSyncState,
  type ContactSyncState,
} from "@freed/shared";

export function readContactSyncState(): ContactSyncState {
  if (typeof window === "undefined") {
    return createEmptyContactSyncState();
  }

  return parseContactSyncState(window.localStorage.getItem(CONTACT_SYNC_STORAGE_KEY));
}

export function readContactSyncStateJson(): string {
  return JSON.stringify(readContactSyncState());
}

export function writeContactSyncStateJson(raw: string | null | undefined): ContactSyncState {
  const normalized = parseContactSyncState(raw);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, JSON.stringify(normalized));
  }

  return normalized;
}

export function clearContactSyncState(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(CONTACT_SYNC_STORAGE_KEY);
  }
}
