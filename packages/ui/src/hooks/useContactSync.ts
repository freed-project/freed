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
import {
  finishBackgroundActivity,
  startBackgroundActivity,
  updateBackgroundActivity,
} from "../lib/background-activity-store.js";

const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const CONTACT_SYNC_TIMEOUT_MS = 60 * 1000;
const STALE_SYNCING_MS = 2 * CONTACT_SYNC_TIMEOUT_MS;
const FOCUS_SYNC_LAUNCH_GRACE_MS = 5 * 60 * 1000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs.toLocaleString()} ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
}

function loadSyncState(): ContactSyncState {
  try {
    const parsed = parseContactSyncState(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY));
    if (
      parsed.syncStatus === "syncing" &&
      (!parsed.syncStartedAt || Date.now() - parsed.syncStartedAt > STALE_SYNCING_MS)
    ) {
      return {
        ...parsed,
        syncStatus: parsed.lastSyncedAt ? "idle" : "error",
        syncStartedAt: null,
        lastErrorCode: parsed.lastSyncedAt ? undefined : "network",
        lastErrorMessage: parsed.lastSyncedAt
          ? undefined
          : "Google Contacts sync did not finish. Try syncing again.",
      };
    }
    return parsed;
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
    syncStartedAt: null,
    lastErrorCode: code,
    lastErrorMessage: message,
    createdFriendCount: current.createdFriendCount ?? 0,
  };
}

function getErrorStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: number }).status
    : undefined;
}

function isAuthSyncError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /auth|token|client_secret|oauth/i.test(message);
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
  const syncPromiseRef = useRef<Promise<ContactSyncState> | null>(null);
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    setPendingMatchCount(syncState.pendingSuggestions.length);
  }, [setPendingMatchCount, syncState.pendingSuggestions.length]);

  const commitSyncState = useCallback((nextState: ContactSyncState) => {
    syncStateRef.current = nextState;
    setSyncState(nextState);
    saveSyncState(nextState);
  }, []);

  const runSync = useCallback((options: { force?: boolean } = {}) => {
    if (syncPromiseRef.current) return syncPromiseRef.current;

    let syncPromise!: Promise<ContactSyncState>;
    syncPromise = (async () => {
      const current = syncStateRef.current;
      const now = Date.now();
      if (!options.force && current.syncStatus === "syncing") {
        const nextState: ContactSyncState = current.lastSyncedAt
          ? { ...current, syncStatus: "idle", syncStartedAt: null }
          : withError(current, "network", "Google Contacts sync did not finish. Try syncing again.");
        commitSyncState(nextState);
        return nextState;
      }

      if (
        !options.force &&
        current.syncStatus !== "error" &&
        current.lastSyncedAt &&
        now - current.lastSyncedAt < SYNC_INTERVAL_MS
      ) {
        return current;
      }

      const activityId = startBackgroundActivity({
        id: "channel:googleContacts",
        kind: "channel",
        channelId: "googleContacts",
        label: "Google Contacts",
        message: "Checking Google Contacts token.",
      });
      const contactsApi = googleContacts;
      let token: string | null = null;
      if (contactsApi) {
        try {
          token = await withTimeout(
            Promise.resolve(contactsApi.getToken()),
            CONTACT_SYNC_TIMEOUT_MS,
            "Google Contacts token lookup",
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Google Contacts token lookup failed.";
          const nextState = withError(current, "auth", message);
          commitSyncState(nextState);
          finishBackgroundActivity(activityId, "error", `Google Contacts token lookup failed: ${message}`);
          return nextState;
        }
      }

      if (!token) {
        const nextState = withError(current, "missing_token", "Reconnect Google to sync contacts.");
        commitSyncState(nextState);
        finishBackgroundActivity(activityId, "error", "Reconnect Google to sync contacts.");
        return nextState;
      }

      commitSyncState({
        ...current,
        authStatus: "connected",
        syncStatus: "syncing",
        syncStartedAt: now,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
      });
      updateBackgroundActivity(activityId, {
        message: "Fetching Google Contacts.",
        log: true,
      });

      try {
        const contactsPromise: Promise<GoogleContactsResult> = contactsApi?.fetchContacts
          ? contactsApi.fetchContacts(token, current.syncToken)
          : fetchGoogleContacts(token, current.syncToken);
        const result = await withTimeout(
          contactsPromise,
          CONTACT_SYNC_TIMEOUT_MS,
          "Google Contacts sync",
        );
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
          syncStartedAt: null,
          syncToken: result.nextSyncToken,
          lastSyncedAt: Date.now(),
          cachedContacts: merged,
          pendingSuggestions,
          dismissedSuggestionIds: current.dismissedSuggestionIds,
          createdFriendCount: current.createdFriendCount,
        };

        commitSyncState(nextState);
        finishBackgroundActivity(
          activityId,
          "success",
          `Google Contacts sync finished with ${result.contacts.length.toLocaleString()} contact${result.contacts.length === 1 ? "" : "s"}.`,
        );
        return nextState;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Google Contacts sync failed.";
        const code = isAuthSyncError(error) ? "auth" : "network";
        const nextState = withError(syncStateRef.current, code, message);
        commitSyncState(nextState);
        finishBackgroundActivity(activityId, "error", `Google Contacts sync failed: ${message}`);
        return nextState;
      }
    })().finally(() => {
      if (syncPromiseRef.current === syncPromise) {
        syncPromiseRef.current = null;
      }
    });

    syncPromiseRef.current = syncPromise;
    return syncPromise;
  }, [commitSyncState, googleContacts]);

  useEffect(() => {
    if (!googleContacts) return undefined;
    const id = setInterval(() => {
      void runSync();
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [googleContacts, runSync]);

  useEffect(() => {
    if (!googleContacts) return undefined;
    const onFocus = () => {
      if (Date.now() - mountedAtRef.current < FOCUS_SYNC_LAUNCH_GRACE_MS) return;
      void runSync();
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
