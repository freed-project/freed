import type { ContactSyncState } from "./types.js";

export const CONTACT_SYNC_STORAGE_KEY = "freed_contact_sync";

export function createEmptyContactSyncState(): ContactSyncState {
  return {
    authStatus: "reconnect_required",
    syncStatus: "idle",
    syncToken: null,
    lastSyncedAt: null,
    lastErrorCode: undefined,
    lastErrorMessage: undefined,
    cachedContacts: [],
    pendingMatches: [],
    dismissedMatches: [],
    autoLinkedCount: 0,
    autoCreatedCount: 0,
  };
}

export function parseContactSyncState(raw: string | null | undefined): ContactSyncState {
  if (!raw) {
    return createEmptyContactSyncState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ContactSyncState>;
    return {
      authStatus: parsed.authStatus ?? "reconnect_required",
      syncStatus: parsed.syncStatus ?? "idle",
      syncToken: parsed.syncToken ?? null,
      lastSyncedAt: parsed.lastSyncedAt ?? null,
      lastErrorCode: parsed.lastErrorCode,
      lastErrorMessage: parsed.lastErrorMessage,
      cachedContacts: parsed.cachedContacts ?? [],
      pendingMatches: parsed.pendingMatches ?? [],
      dismissedMatches: parsed.dismissedMatches ?? [],
      autoLinkedCount: parsed.autoLinkedCount ?? 0,
      autoCreatedCount: parsed.autoCreatedCount ?? 0,
    };
  } catch {
    return createEmptyContactSyncState();
  }
}
