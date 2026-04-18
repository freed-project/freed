import type { ContactSyncState } from "./types.js";

export const CONTACT_SYNC_STORAGE_KEY = "freed_contact_sync";

export function createEmptyContactSyncState(): ContactSyncState {
  const pendingSuggestions: ContactSyncState["pendingSuggestions"] = [];
  const dismissedSuggestionIds: string[] = [];
  return {
    authStatus: "reconnect_required",
    syncStatus: "idle",
    syncToken: null,
    lastSyncedAt: null,
    lastErrorCode: undefined,
    lastErrorMessage: undefined,
    cachedContacts: [],
    pendingSuggestions,
    dismissedSuggestionIds,
    createdFriendCount: 0,
    pendingMatches: pendingSuggestions,
    dismissedMatches: dismissedSuggestionIds,
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
    const pendingSuggestions = parsed.pendingSuggestions ?? parsed.pendingMatches ?? [];
    const dismissedSuggestionIds = parsed.dismissedSuggestionIds ?? parsed.dismissedMatches ?? [];
    const createdFriendCount = parsed.createdFriendCount ?? parsed.autoCreatedCount ?? 0;
    return {
      authStatus: parsed.authStatus ?? "reconnect_required",
      syncStatus: parsed.syncStatus ?? "idle",
      syncToken: parsed.syncToken ?? null,
      lastSyncedAt: parsed.lastSyncedAt ?? null,
      lastErrorCode: parsed.lastErrorCode,
      lastErrorMessage: parsed.lastErrorMessage,
      cachedContacts: parsed.cachedContacts ?? [],
      pendingSuggestions,
      dismissedSuggestionIds,
      createdFriendCount,
      pendingMatches: pendingSuggestions,
      dismissedMatches: dismissedSuggestionIds,
      autoLinkedCount: parsed.autoLinkedCount ?? 0,
      autoCreatedCount: createdFriendCount,
    };
  } catch {
    return createEmptyContactSyncState();
  }
}
