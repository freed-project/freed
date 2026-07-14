import { useEffect, useRef, useCallback, useState } from "react";
import {
  CONTACT_SYNC_STORAGE_KEY,
  CONTACT_SYNC_STATE_VERSION,
  createContactSyncStateForManualRepair,
  parseContactSyncState,
  serializeContactSyncState,
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
import {
  writeVersionedLocalStorage,
  type VersionedLocalStorageCodec,
} from "../lib/versioned-local-storage.js";
import {
  captureFactoryResetWriteEpoch,
  isFactoryResetWriteAllowed,
  trackFactoryResetSensitiveOperation,
} from "../lib/factory-reset.js";

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

interface LoadedContactSyncState {
  state: ContactSyncState;
  requiresManualRepair: boolean;
}

const CONTACT_SYNC_STORAGE_CODEC: VersionedLocalStorageCodec<ContactSyncState> = {
  version: CONTACT_SYNC_STATE_VERSION,
  decode(value) {
    const parsed = parseContactSyncState(JSON.stringify(value));
    return parsed.status === "valid" && parsed.format === "current"
      ? parsed.state
      : null;
  },
  encode(value) {
    const encoded = JSON.parse(serializeContactSyncState(value)) as Record<string, unknown>;
    delete encoded.version;
    return encoded;
  },
};

function loadSyncState(): LoadedContactSyncState {
  try {
    const parsed = parseContactSyncState(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY));
    if (parsed.status === "corrupt" || parsed.status === "unsupported") {
      return { state: parsed.state, requiresManualRepair: true };
    }
    const state = parsed.state;
    if (
      state.syncStatus === "syncing" &&
      (!state.syncStartedAt || Date.now() - state.syncStartedAt > STALE_SYNCING_MS)
    ) {
      return {
        state: {
          ...state,
          syncStatus: state.lastSyncedAt ? "idle" : "error",
          syncStartedAt: null,
          lastErrorCode: state.lastSyncedAt ? undefined : "network",
          lastErrorMessage: state.lastSyncedAt
            ? undefined
            : "Google Contacts sync did not finish. Try syncing again.",
        },
        requiresManualRepair: false,
      };
    }
    return { state, requiresManualRepair: false };
  } catch {
    return {
      state: createContactSyncStateForManualRepair("unavailable"),
      requiresManualRepair: true,
    };
  }
}

function saveSyncState(
  state: ContactSyncState,
  options: { allowLedgerRepair?: boolean } = {},
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const existing = parseContactSyncState(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY));
    if (existing.status === "corrupt" || existing.status === "unsupported") {
      if (!options.allowLedgerRepair) return false;
      return writeVersionedLocalStorage(
        CONTACT_SYNC_STORAGE_KEY,
        CONTACT_SYNC_STORAGE_CODEC,
        state,
        { replaceUnsupportedVersion: true },
      );
    }
    localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, serializeContactSyncState(state));
    return true;
  } catch {
    return false;
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

  const [loadedSyncState] = useState<LoadedContactSyncState>(() => loadSyncState());
  const [syncState, setSyncState] = useState<ContactSyncState>(loadedSyncState.state);
  const syncStateRef = useRef(syncState);
  syncStateRef.current = syncState;
  const ledgerRepairRequiredRef = useRef(loadedSyncState.requiresManualRepair);
  const matchesRef = useRef<Map<string, ContactMatch>>(new Map());
  const syncPromiseRef = useRef<Promise<ContactSyncState> | null>(null);
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    setPendingMatchCount(syncState.pendingSuggestions.length);
  }, [setPendingMatchCount, syncState.pendingSuggestions.length]);

  const commitSyncState = useCallback((
    nextState: ContactSyncState,
    options: { allowLedgerRepair?: boolean } = {},
  ): boolean => {
    if (ledgerRepairRequiredRef.current && !options.allowLedgerRepair) return false;
    if (!saveSyncState(nextState, options)) {
      const unavailableState = createContactSyncStateForManualRepair("unavailable");
      ledgerRepairRequiredRef.current = true;
      syncStateRef.current = unavailableState;
      setSyncState(unavailableState);
      return false;
    }
    ledgerRepairRequiredRef.current = false;
    syncStateRef.current = nextState;
    setSyncState(nextState);
    return true;
  }, []);

  const runSync = useCallback((options: { force?: boolean } = {}) => {
    if (syncPromiseRef.current) return syncPromiseRef.current;
    const resetEpoch = captureFactoryResetWriteEpoch();
    if (resetEpoch === null) return Promise.resolve(syncStateRef.current);

    let syncPromise!: Promise<ContactSyncState>;
    const operation = (async () => {
      const current = syncStateRef.current;
      if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
      if (!options.force && ledgerRepairRequiredRef.current) return current;
      if (!options.force) {
        let persistedLedger: ReturnType<typeof parseContactSyncState> | null = null;
        try {
          persistedLedger = parseContactSyncState(
            localStorage.getItem(CONTACT_SYNC_STORAGE_KEY),
          );
        } catch {
          // The same fail-closed state below handles unavailable storage.
        }
        if (
          persistedLedger === null
          || persistedLedger.status === "corrupt"
          || persistedLedger.status === "unsupported"
        ) {
          const repairState = persistedLedger?.state
            ?? createContactSyncStateForManualRepair("unavailable");
          ledgerRepairRequiredRef.current = true;
          syncStateRef.current = repairState;
          setSyncState(repairState);
          return repairState;
        }
      }
      const commitOptions = { allowLedgerRepair: options.force === true };
      const now = Date.now();
      if (!options.force && current.syncStatus === "syncing") {
        const nextState: ContactSyncState = current.lastSyncedAt
          ? { ...current, syncStatus: "idle", syncStartedAt: null }
          : withError(current, "network", "Google Contacts sync did not finish. Try syncing again.");
        if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
        return commitSyncState(nextState, commitOptions)
          ? nextState
          : syncStateRef.current;
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
          if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
          token = await withTimeout(
            Promise.resolve(contactsApi.getToken()),
            CONTACT_SYNC_TIMEOUT_MS,
            "Google Contacts token lookup",
          );
          if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
        } catch (error) {
          if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
          const message = error instanceof Error ? error.message : "Google Contacts token lookup failed.";
          const nextState = withError(current, "auth", message);
          const persisted = commitSyncState(nextState, commitOptions);
          finishBackgroundActivity(
            activityId,
            "error",
            persisted
              ? `Google Contacts token lookup failed: ${message}`
              : "Google Contacts sync state could not be saved.",
          );
          return persisted ? nextState : syncStateRef.current;
        }
      }

      if (!token) {
        if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
        const nextState = withError(current, "missing_token", "Reconnect Google to sync contacts.");
        const persisted = commitSyncState(nextState, commitOptions);
        finishBackgroundActivity(
          activityId,
          "error",
          persisted
            ? "Reconnect Google to sync contacts."
            : "Google Contacts sync state could not be saved.",
        );
        return persisted ? nextState : syncStateRef.current;
      }

      if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
      const syncingPersisted = commitSyncState({
        ...current,
        authStatus: "connected",
        syncStatus: "syncing",
        syncStartedAt: now,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
      }, commitOptions);
      if (!syncingPersisted) {
        finishBackgroundActivity(activityId, "error", "Google Contacts sync state could not be saved.");
        return syncStateRef.current;
      }
      updateBackgroundActivity(activityId, {
        message: "Fetching Google Contacts.",
        log: true,
      });

      try {
        if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
        const contactsPromise: Promise<GoogleContactsResult> = contactsApi?.fetchContacts
          ? contactsApi.fetchContacts(token, current.syncToken)
          : fetchGoogleContacts(token, current.syncToken);
        const result = await withTimeout(
          contactsPromise,
          CONTACT_SYNC_TIMEOUT_MS,
          "Google Contacts sync",
        );
        if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
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

        if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
        if (!commitSyncState(nextState, commitOptions)) {
          finishBackgroundActivity(activityId, "error", "Google Contacts sync state could not be saved.");
          return syncStateRef.current;
        }
        finishBackgroundActivity(
          activityId,
          "success",
          `Google Contacts sync finished with ${result.contacts.length.toLocaleString()} contact${result.contacts.length === 1 ? "" : "s"}.`,
        );
        return nextState;
      } catch (error) {
        if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
        const message = error instanceof Error ? error.message : "Google Contacts sync failed.";
        const code = isAuthSyncError(error) ? "auth" : "network";
        const nextState = withError(syncStateRef.current, code, message);
        const persisted = commitSyncState(nextState, commitOptions);
        finishBackgroundActivity(
          activityId,
          "error",
          persisted
            ? `Google Contacts sync failed: ${message}`
            : "Google Contacts sync state could not be saved.",
        );
        return persisted ? nextState : syncStateRef.current;
      }
    })();
    syncPromise = trackFactoryResetSensitiveOperation(operation).finally(() => {
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
    if (ledgerRepairRequiredRef.current) return;
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
