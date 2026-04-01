import { useEffect, useRef, useCallback, useState } from "react";
import {
  CONTACT_SYNC_STORAGE_KEY,
  createEmptyContactSyncState,
  parseContactSyncState,
  type ContactMatch,
  type ContactSyncState,
} from "@freed/shared";
import {
  fetchGoogleContacts,
  mergeContactChanges,
  type GoogleContactsResult,
} from "@freed/shared/google-contacts";
import {
  buildFriendSourcesFromAuthorIds,
  createDeviceContactFromGoogleContact,
  mergeFriendSources,
  shouldAutoProcessMatch,
} from "@freed/shared/google-contacts-automation";
import { matchContacts } from "@freed/shared/contact-matching";
import { usePlatform } from "../context/PlatformContext.js";

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

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

function getPotentialIds(match: ContactMatch): string[] {
  return [
    ...(match.friend ? [match.friend.id] : []),
    ...match.authorIds,
  ];
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
    autoLinkedCount: 0,
    autoCreatedCount: 0,
  };
}

export function useContactSync() {
  const { store, googleContacts } = usePlatform();

  // Read live values for use in the sync callback. We store them in refs so
  // that runSync's deps stay stable and the interval does not reset on every
  // feed or friend update.
  const friends = store((s) => s.friends);
  const items = store((s) => s.items);
  const addFriend = store((s) => s.addFriend);
  const updateFriend = store((s) => s.updateFriend);
  const setPendingMatchCount = store((s) => s.setPendingMatchCount);

  const friendsRef = useRef(friends);
  const itemsRef = useRef(items);
  friendsRef.current = friends;
  itemsRef.current = items;

  const [syncState, setSyncState] = useState<ContactSyncState>(() => loadSyncState());
  const syncStateRef = useRef(syncState);
  syncStateRef.current = syncState;

  useEffect(() => {
    setPendingMatchCount(syncState.pendingMatches.length);
  }, [setPendingMatchCount, syncState.pendingMatches.length]);

  const commitSyncState = useCallback((nextState: ContactSyncState) => {
    syncStateRef.current = nextState;
    setSyncState(nextState);
    saveSyncState(nextState);
  }, []);

  const autoProcessMatches = useCallback(async (matches: ContactMatch[]) => {
    let autoLinkedCount = 0;
    let autoCreatedCount = 0;

    for (const match of matches) {
      const now = Date.now();
      const contact = createDeviceContactFromGoogleContact(match.contact, now);
      const newSources = buildFriendSourcesFromAuthorIds(itemsRef.current, match.authorIds);

      if (match.friend) {
        await updateFriend(match.friend.id, {
          contact,
          sources: mergeFriendSources(match.friend.sources ?? [], newSources),
          updatedAt: now,
        });
        autoLinkedCount += 1;
        continue;
      }

      if (newSources.length === 0) continue;

      await addFriend({
        id: crypto.randomUUID(),
        name: contact.name,
        sources: newSources,
        contact,
        careLevel: 3,
        createdAt: now,
        updatedAt: now,
      });
      autoCreatedCount += 1;
    }

    return { autoLinkedCount, autoCreatedCount };
  }, [addFriend, updateFriend]);

  const runSync = useCallback(async () => {
    const current = syncStateRef.current;
    const token = googleContacts?.getToken() ?? null;

    if (!token) {
      const nextState = withError(
        current,
        "missing_token",
        "Reconnect Google to sync contacts.",
      );
      commitSyncState(nextState);
      return nextState;
    }

    const startingState: ContactSyncState = {
      ...current,
      authStatus: "connected",
      syncStatus: "syncing",
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      autoLinkedCount: 0,
      autoCreatedCount: 0,
    };
    commitSyncState(startingState);

    try {
      const result: GoogleContactsResult = await fetchGoogleContacts(token, current.syncToken);
      const merged = mergeContactChanges(
        current.cachedContacts,
        result.contacts,
        result.deleted,
      );

      const allMatches = matchContacts(merged, friendsRef.current, itemsRef.current);
      const autoMatches = allMatches.filter(shouldAutoProcessMatch);
      const { autoLinkedCount, autoCreatedCount } = await autoProcessMatches(autoMatches);

      const dismissedSet = new Set(
        current.dismissedMatches.map(
          (entry) => `${entry.contactResourceName}:${entry.friendIdOrAuthorId}`,
        ),
      );

      const pendingMatches = allMatches.filter((match) => {
        if (shouldAutoProcessMatch(match)) return false;
        const potentialIds = getPotentialIds(match);
        if (potentialIds.length === 0) return false;
        return potentialIds.some(
          (id) => !dismissedSet.has(`${match.contact.resourceName}:${id}`),
        );
      });

      const nextState: ContactSyncState = {
        authStatus: "connected",
        syncStatus: "idle",
        syncToken: result.nextSyncToken,
        lastSyncedAt: Date.now(),
        cachedContacts: merged,
        pendingMatches,
        dismissedMatches: current.dismissedMatches,
        autoLinkedCount,
        autoCreatedCount,
      };

      commitSyncState(nextState);
      return nextState;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google Contacts sync failed.";
      const status = typeof err === "object" && err !== null && "status" in err
        ? (err as { status?: number }).status
        : undefined;
      const code = status === 401 || status === 403 ? "auth" : "network";
      const nextState = withError(current, code, message);
      commitSyncState(nextState);
      return nextState;
    }
  }, [autoProcessMatches, commitSyncState, googleContacts]);

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
          commitSyncState(
            withError(current, "missing_token", "Reconnect Google to sync contacts."),
          );
        }
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [commitSyncState, googleContacts, runSync]);

  const dismissMatch = useCallback(
    (contactResourceName: string, friendIdOrAuthorId: string) => {
      const current = syncStateRef.current;
      const dismissedMatches = [
        ...current.dismissedMatches,
        { contactResourceName, friendIdOrAuthorId },
      ];
      const dismissedSet = new Set(
        dismissedMatches.map(
          (entry) => `${entry.contactResourceName}:${entry.friendIdOrAuthorId}`,
        ),
      );
      const pendingMatches = current.pendingMatches.filter((match) => {
        const potentialIds = getPotentialIds(match);
        return potentialIds.some(
          (id) => !dismissedSet.has(`${match.contact.resourceName}:${id}`),
        );
      });
      commitSyncState({
        ...current,
        dismissedMatches,
        pendingMatches,
      });
    },
    [commitSyncState],
  );

  return {
    syncNow: runSync,
    syncState,
    getSyncState: () => syncStateRef.current,
    dismissMatch,
  };
}
