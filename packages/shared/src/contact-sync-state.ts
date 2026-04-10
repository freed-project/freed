import type { ContactSyncState } from "./types.js";

export const CONTACT_SYNC_STORAGE_KEY = "freed_contact_sync";

export function createEmptyContactSyncState(): ContactSyncState {
  return {
    syncToken: null,
    lastSyncedAt: null,
    cachedContacts: [],
    pendingMatches: [],
    dismissedMatches: [],
  };
}

export function parseContactSyncState(raw: string | null | undefined): ContactSyncState {
  if (!raw) {
    return createEmptyContactSyncState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ContactSyncState>;
    return {
      syncToken: parsed.syncToken ?? null,
      lastSyncedAt: parsed.lastSyncedAt ?? null,
      cachedContacts: parsed.cachedContacts ?? [],
      pendingMatches: parsed.pendingMatches ?? [],
      dismissedMatches: parsed.dismissedMatches ?? [],
    };
  } catch {
    return createEmptyContactSyncState();
  }
}
