import { useEffect, useRef, useCallback, useState } from "react";
import {
  CONTACT_SYNC_STORAGE_KEY,
  createEmptyContactSyncState,
  parseContactSyncState,
  type ContactMatch,
  type ContactSyncState,
  type FeedItem,
  type IdentitySuggestion,
} from "@freed/shared";
import {
  fetchGoogleContacts,
  mergeContactChanges,
  type GoogleContactsResult,
} from "@freed/shared/google-contacts";
import { buildSocialAccountsFromAuthorIds } from "@freed/shared/google-contacts-automation";
import { matchContacts } from "@freed/shared/contact-matching";
import { usePlatform } from "../context/PlatformContext.js";

const SYNC_INTERVAL_MS = 15 * 60 * 1000;

function loadSyncState(): ContactSyncState {
  try {
    return parseContactSyncState(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY));
  } catch {
    return createEmptyContactSyncState();
  }
}

function saveSyncState(state: ContactSyncState): void {
  try {
    localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors.
  }
}

function suggestionIdForMatch(match: ContactMatch): string {
  const authorKey = [...match.authorIds].sort().join(",");
  return `google:${match.contact.resourceName}:person:${match.person?.id ?? "none"}:authors:${authorKey}`;
}

function buildSuggestion(match: ContactMatch, items: FeedItem[]): IdentitySuggestion | null {
  if (!match.person && match.authorIds.length === 0) return null;
  const suggestionId = suggestionIdForMatch(match);
  const label = match.contact.name.displayName ?? match.contact.name.givenName ?? "Unknown";
  const accountIds = buildSocialAccountsFromAuthorIds(items, match.authorIds).map((account) => account.id);
  return {
    id: suggestionId,
    kind: match.person ? "attach_accounts_to_person" : "merge_accounts",
    confidence: match.confidence,
    accountIds,
    personId: match.person?.id,
    label,
    reason: match.person
      ? "Contact may belong to an existing person."
      : "Contact may match one or more captured social accounts.",
    createdAt: Date.now(),
  };
}

function withError(
  current: ContactSyncState,
  code: ContactSyncState["lastErrorCode"],
  message: string,
): ContactSyncState {
  return {
    ...current,
    authStatus: code === "missing_token" || code === "auth"
      ? "reconnect_required"
      : current.authStatus,
    syncStatus: "error",
    lastErrorCode: code,
    lastErrorMessage: message,
    createdFriendCount: current.createdFriendCount ?? 0,
  };
}

export function useContactSync() {
  const { store, googleContacts } = usePlatform();

  const persons = store((state) => state.persons);
  const accounts = store((state) => state.accounts);
  const items = store((state) => state.items);
  const setPendingMatchCount = store((state) => state.setPendingMatchCount);

  const personsRef = useRef(persons);
  const accountsRef = useRef(accounts);
  const itemsRef = useRef(items);
  personsRef.current = persons;
  accountsRef.current = accounts;
  itemsRef.current = items;

  const [syncState, setSyncState] = useState<ContactSyncState>(() => loadSyncState());
  const syncStateRef = useRef(syncState);
  syncStateRef.current = syncState;
  const matchesRef = useRef<Map<string, ContactMatch>>(new Map());

  useEffect(() => {
    setPendingMatchCount(syncState.pendingSuggestions.length);
  }, [setPendingMatchCount, syncState.pendingSuggestions.length]);

  const commitSyncState = useCallback((nextState: ContactSyncState) => {
    syncStateRef.current = nextState;
    setSyncState(nextState);
    saveSyncState(nextState);
  }, []);

  const runSync = useCallback(async () => {
    const current = syncStateRef.current;
    const token = googleContacts?.getToken() ?? null;

    if (!token) {
      const nextState = withError(current, "missing_token", "Reconnect Google to sync contacts.");
      commitSyncState(nextState);
      return nextState;
    }

    commitSyncState({
      ...current,
      authStatus: "connected",
      syncStatus: "syncing",
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
    });

    try {
      const result: GoogleContactsResult = await fetchGoogleContacts(token, current.syncToken);
      const merged = mergeContactChanges(current.cachedContacts, result.contacts, result.deleted);
      const allMatches = matchContacts(
        merged,
        personsRef.current,
        accountsRef.current,
        itemsRef.current,
      );
      matchesRef.current = new Map(
        allMatches.map((match) => [suggestionIdForMatch(match), match])
      );

      const pendingSuggestions = allMatches
        .map((match) => buildSuggestion(match, itemsRef.current))
        .filter((suggestion): suggestion is IdentitySuggestion => suggestion !== null)
        .filter((suggestion) => !current.dismissedSuggestionIds.includes(suggestion.id));

      const nextState: ContactSyncState = {
        authStatus: "connected",
        syncStatus: "idle",
        syncToken: result.nextSyncToken,
        lastSyncedAt: Date.now(),
        cachedContacts: merged,
        pendingSuggestions,
        dismissedSuggestionIds: current.dismissedSuggestionIds,
        createdFriendCount: current.createdFriendCount,
      };

      commitSyncState(nextState);
      return nextState;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Contacts sync failed.";
      const status = typeof error === "object" && error !== null && "status" in error
        ? (error as { status?: number }).status
        : undefined;
      const code = status === 401 || status === 403 ? "auth" : "network";
      const nextState = withError(current, code, message);
      commitSyncState(nextState);
      return nextState;
    }
  }, [commitSyncState, googleContacts]);

  useEffect(() => {
    if (!googleContacts) return undefined;
    const id = setInterval(() => {
      if (googleContacts.getToken()) {
        void runSync();
      }
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [googleContacts, runSync]);

  useEffect(() => {
    if (!googleContacts) return undefined;
    const onFocus = () => {
      if (googleContacts.getToken()) {
        void runSync();
      } else {
        const current = syncStateRef.current;
        if (current.authStatus !== "reconnect_required" || current.syncStatus !== "error") {
          commitSyncState(withError(current, "missing_token", "Reconnect Google to sync contacts."));
        }
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [commitSyncState, googleContacts, runSync]);

  const dismissSuggestion = useCallback((suggestionId: string) => {
    const current = syncStateRef.current;
    const dismissedSuggestionIds = Array.from(new Set([...current.dismissedSuggestionIds, suggestionId]));
    commitSyncState({
      ...current,
      dismissedSuggestionIds,
      pendingSuggestions: current.pendingSuggestions.filter((suggestion) => suggestion.id !== suggestionId),
    });
  }, [commitSyncState]);

  const ensureAccountsForSuggestion = useCallback((match: ContactMatch) => {
    return buildSocialAccountsFromAuthorIds(itemsRef.current, match.authorIds);
  }, []);

  return {
    syncNow: runSync,
    syncState,
    getSyncState: () => syncStateRef.current,
    dismissSuggestion,
    ensureAccountsForSuggestion,
    getMatchForSuggestion: (suggestionId: string) => matchesRef.current.get(suggestionId) ?? null,
  };
}
