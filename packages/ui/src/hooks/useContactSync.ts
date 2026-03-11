import { useEffect, useRef, useCallback } from "react";
import { fetchGoogleContacts, mergeContactChanges } from "@freed/shared/google-contacts";
import { matchContacts } from "@freed/shared/contact-matching";
import type { ContactSyncState } from "@freed/shared";
import { usePlatform } from "../context/PlatformContext.js";

const STORAGE_KEY = "freed_contact_sync";
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function loadSyncState(): ContactSyncState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ContactSyncState;
  } catch { /* ignore parse errors */ }
  return {
    syncToken: null,
    lastSyncedAt: null,
    cachedContacts: [],
    pendingMatches: [],
    dismissedMatches: [],
  };
}

function saveSyncState(state: ContactSyncState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore storage errors */ }
}

export function useContactSync() {
  const { store, googleContacts } = usePlatform();

  // Read live values for use in the sync callback. We store them in refs so
  // that runSync's useCallback deps stay stable — if we captured friends/items
  // directly in the dep array, every feed or friend update would recreate
  // runSync and reset the 15-minute setInterval.
  const friends = store((s) => s.friends);
  const items = store((s) => s.items);
  const setPendingMatchCount = store((s) => s.setPendingMatchCount);

  const friendsRef = useRef(friends);
  const itemsRef = useRef(items);
  // Assign synchronously so the refs are always current by the time any async
  // code reads them, even without an extra useEffect round-trip.
  friendsRef.current = friends;
  itemsRef.current = items;

  const syncStateRef = useRef<ContactSyncState>(loadSyncState());

  const runSync = useCallback(async () => {
    const token = googleContacts?.getToken();
    if (!token) return;

    try {
      const current = syncStateRef.current;
      const result = await fetchGoogleContacts(token, current.syncToken);
      const merged = mergeContactChanges(
        current.cachedContacts,
        result.contacts,
        result.deleted
      );

      // Read from refs so we always get the latest store values without
      // taking them as useCallback deps (which would reset the interval).
      const allMatches = matchContacts(merged, friendsRef.current, itemsRef.current);

      const dismissedSet = new Set(
        current.dismissedMatches.map(
          (d) => `${d.contactResourceName}:${d.friendIdOrAuthorId}`
        )
      );

      const pending = allMatches.filter((m) => {
        if (!m.friend && m.authorIds.length === 0) return false;
        const potentialIds = [
          ...(m.friend ? [m.friend.id] : []),
          ...m.authorIds,
        ];
        return potentialIds.some(
          (id) => !dismissedSet.has(`${m.contact.resourceName}:${id}`)
        );
      });

      const nextState: ContactSyncState = {
        syncToken: result.nextSyncToken,
        lastSyncedAt: Date.now(),
        cachedContacts: merged,
        pendingMatches: pending,
        dismissedMatches: current.dismissedMatches,
      };

      syncStateRef.current = nextState;
      saveSyncState(nextState);
      setPendingMatchCount(pending.length);
    } catch (err) {
      console.warn("[useContactSync] sync failed:", err);
    }
  // Only stable references in deps — googleContacts and setPendingMatchCount
  // are both stable across renders, so this callback never re-creates.
  }, [googleContacts, setPendingMatchCount]);

  // 15-minute interval — stable because runSync is stable.
  useEffect(() => {
    const id = setInterval(runSync, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [runSync]);

  // Re-sync immediately when the user returns to the app.
  useEffect(() => {
    window.addEventListener("focus", runSync);
    return () => window.removeEventListener("focus", runSync);
  }, [runSync]);

  const dismissMatch = useCallback(
    (contactResourceName: string, friendIdOrAuthorId: string) => {
      const current = syncStateRef.current;
      const dismissed = [
        ...current.dismissedMatches,
        { contactResourceName, friendIdOrAuthorId },
      ];
      const dismissedSet = new Set(
        dismissed.map(d => `${d.contactResourceName}:${d.friendIdOrAuthorId}`)
      );
      const remainingPending = current.pendingMatches.filter((m) => {
        const potentials = [
          ...(m.friend ? [m.friend.id] : []),
          ...m.authorIds,
        ];
        return potentials.some(id => !dismissedSet.has(`${m.contact.resourceName}:${id}`));
      });
      const next: ContactSyncState = {
        ...current,
        dismissedMatches: dismissed,
        pendingMatches: remainingPending,
      };
      syncStateRef.current = next;
      saveSyncState(next);
      setPendingMatchCount(remainingPending.length);
    },
    [setPendingMatchCount]
  );

  return {
    syncNow: runSync,
    getSyncState: () => syncStateRef.current,
    dismissMatch,
  };
}
