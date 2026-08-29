import { useCallback, useEffect, useRef, useState } from "react";
import {
  LEGACY_CONTACT_SYNC_STORAGE_KEY,
  parseLegacyContactSyncStateForMigration,
  type ContactMatch,
  type IdentitySuggestion,
} from "@freed/shared";
import {
  LIBRARY_CORE_DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS,
  LIBRARY_CORE_DEVICE_CONTACT_MATCH_MAXIMUM_MEMBERS,
  LIBRARY_CORE_DEVICE_CONTACT_PAGE_MAXIMUM_ROWS,
  LIBRARY_CORE_DEVICE_CONTACT_REVIEW_MAXIMUM_ROWS,
  type LibraryCoreDeviceContactMutationExecutor,
  type LibraryCoreDeviceContactMutationReceiptV1,
  type LibraryCoreDeviceContactQueryExecutor,
  type LibraryCoreDeviceContactMatchPageResponseV1,
  type LibraryCoreDeviceContactStatusResponseV1,
  type LibraryCoreDeviceContactSuggestionCursorV1,
  type LibraryCoreDeviceContactSuggestionPageResponseV1,
  type LibraryCoreDeviceContactUnmatchedCursorV1,
  type LibraryCoreDeviceContactUnmatchedPageResponseV1,
  type LibraryCoreNormalizedQueryExecutor,
} from "@freed/shared/library-core";
import {
  fetchGoogleContacts,
  type GoogleContactsResult,
} from "@freed/shared/google-contacts";
import { matchContactsWithLibraryCore } from "@freed/shared/contact-matching";
import { usePlatform } from "../context/PlatformContext.js";
import {
  finishBackgroundActivity,
  startBackgroundActivity,
  updateBackgroundActivity,
} from "../lib/background-activity-store.js";
import {
  captureFactoryResetWriteEpoch,
  isFactoryResetWriteAllowed,
  trackFactoryResetSensitiveOperation,
} from "../lib/factory-reset.js";

const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const CONTACT_SYNC_TIMEOUT_MS = 60 * 1000;
const FOCUS_SYNC_LAUNCH_GRACE_MS = 5 * 60 * 1000;

const EMPTY_STATUS: LibraryCoreDeviceContactStatusResponseV1 = Object.freeze({
  activeContactCount: 0,
  activeGenerationId: null,
  authStatus: "reconnect_required",
  createdFriendCount: 0,
  lastErrorCode: null,
  lastErrorMessage: null,
  lastSyncedAt: null,
  pendingSuggestionCount: 0,
  queryId: "device_contact_status_v1",
  revision: 0,
  schemaVersion: 1,
  syncStartedAt: null,
  syncStatus: "idle",
  syncToken: null,
  updatedAt: 0,
});

function emptySuggestionPage(
  revision: number,
): LibraryCoreDeviceContactSuggestionPageResponseV1 {
  return Object.freeze({
    nextCursor: null,
    queryId: "device_contact_suggestion_page_v1",
    revision,
    rows: Object.freeze([]),
    schemaVersion: 1,
  });
}

function emptyUnmatchedPage(
  revision: number,
): LibraryCoreDeviceContactUnmatchedPageResponseV1 {
  return Object.freeze({
    nextCursor: null,
    queryId: "device_contact_unmatched_page_v1",
    revision,
    rows: Object.freeze([]),
    schemaVersion: 1,
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `${label} timed out after ${timeoutMs.toLocaleString()} ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
}

function suggestionIdForMatch(match: ContactMatch): string {
  const accountKey = [...match.accountIds].sort().join(",");
  return `google:${match.contact.resourceName}:person:${match.personId ?? "none"}:accounts:${accountKey}`;
}

function buildSuggestion(
  match: ContactMatch,
  createdAt: number,
): IdentitySuggestion | null {
  if (!match.personId && match.accountIds.length === 0) return null;
  return {
    accountIds: match.accountIds,
    confidence: match.confidence,
    createdAt,
    id: suggestionIdForMatch(match),
    kind: match.personId ? "attach_accounts_to_person" : "merge_accounts",
    label:
      match.contact.name.displayName ??
      match.contact.name.givenName ??
      "Unknown",
    ...(match.personId ? { personId: match.personId } : {}),
    reason: match.personId
      ? "Contact may belong to an existing person."
      : "Contact may match one or more captured social accounts.",
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

function legacySuggestionResourceName(suggestionId: string): string | null {
  if (!suggestionId.startsWith("google:")) return null;
  const marker = suggestionId.indexOf(":person:", "google:".length);
  return marker > "google:".length
    ? suggestionId.slice("google:".length, marker)
    : null;
}

async function appendContactDeltas(
  mutate: LibraryCoreDeviceContactMutationExecutor,
  generationId: string,
  result: GoogleContactsResult,
  updatedAt: number,
): Promise<LibraryCoreDeviceContactMutationReceiptV1 | null> {
  const changedResources = new Set(
    result.contacts.map((contact) => contact.resourceName),
  );
  const changes = [
    ...result.deleted
      .filter((resourceName) => !changedResources.has(resourceName))
      .map((resourceName) => ({ deletedResourceName: resourceName } as const)),
    ...result.contacts.map((contact) => ({ contact } as const)),
  ];
  let receipt: LibraryCoreDeviceContactMutationReceiptV1 | null = null;
  for (
    let offset = 0, batchOrdinal = 0;
    offset < changes.length;
    offset += LIBRARY_CORE_DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS, batchOrdinal += 1
  ) {
    const batch = changes.slice(
      offset,
      offset + LIBRARY_CORE_DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS,
    );
    receipt = await mutate({
      batchOrdinal,
      contacts: batch.flatMap((entry) =>
        "contact" in entry ? [entry.contact] : [],
      ),
      deletedResourceNames: batch.flatMap((entry) =>
        "deletedResourceName" in entry ? [entry.deletedResourceName] : [],
      ),
      generationId,
      mutationKind: "device_contact_delta_append_v1",
      schemaVersion: 1,
      updatedAt,
    });
  }
  return receipt;
}

async function matchBuildingGeneration(
  queryContacts: LibraryCoreDeviceContactQueryExecutor,
  mutate: LibraryCoreDeviceContactMutationExecutor,
  queryLibraryCore: LibraryCoreNormalizedQueryExecutor,
  generationId: string,
): Promise<void> {
  let afterResourceName: string | null = null;
  for (;;) {
    const page: LibraryCoreDeviceContactMatchPageResponseV1 = await queryContacts({
      afterResourceName,
      generationId,
      limit: LIBRARY_CORE_DEVICE_CONTACT_PAGE_MAXIMUM_ROWS,
      queryId: "device_contact_match_page_v1",
      schemaVersion: 1,
    });
    if (page.rows.length === 0) return;
    const matchedAt = Date.now();
    const matches = await matchContactsWithLibraryCore(
      page.rows,
      queryLibraryCore,
    );
    for (
      let offset = 0;
      offset < matches.length;
      offset += LIBRARY_CORE_DEVICE_CONTACT_MATCH_MAXIMUM_MEMBERS
    ) {
      await mutate({
        generationId,
        matchedAt,
        matches: matches
          .slice(
            offset,
            offset + LIBRARY_CORE_DEVICE_CONTACT_MATCH_MAXIMUM_MEMBERS,
          )
          .map((match) => ({
            resourceName: match.contact.resourceName,
            suggestion: buildSuggestion(match, matchedAt),
          })),
        mutationKind: "device_contact_match_append_v1",
        schemaVersion: 1,
      });
    }
    if (page.nextCursor === null) return;
    afterResourceName = page.nextCursor;
  }
}

async function importLegacyContactStateOnce(
  queryContacts: LibraryCoreDeviceContactQueryExecutor,
  mutate: LibraryCoreDeviceContactMutationExecutor,
): Promise<void> {
  const raw = localStorage.getItem(LEGACY_CONTACT_SYNC_STORAGE_KEY);
  if (raw === null) return;
  const parsed = parseLegacyContactSyncStateForMigration(raw);
  const current = await queryContacts({
    queryId: "device_contact_status_v1",
    schemaVersion: 1,
  });
  if (
    parsed.status === "corrupt" ||
    parsed.status === "unsupported" ||
    current.activeGenerationId !== null
  ) {
    localStorage.removeItem(LEGACY_CONTACT_SYNC_STORAGE_KEY);
    return;
  }
  const legacy = parsed.state;
  if (legacy.cachedContacts.length === 0 && !legacy.syncToken) {
    localStorage.removeItem(LEGACY_CONTACT_SYNC_STORAGE_KEY);
    return;
  }

  const now = Date.now();
  const generationId = `contacts:migration:${crypto.randomUUID()}`;
  await mutate({
    generationId,
    mutationKind: "device_contact_generation_begin_v1",
    schemaVersion: 1,
    startedAt: now,
  });
  let lastReceipt: LibraryCoreDeviceContactMutationReceiptV1 | null = null;
  for (
    let offset = 0, batchOrdinal = 0;
    offset < legacy.cachedContacts.length;
    offset += LIBRARY_CORE_DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS, batchOrdinal += 1
  ) {
    lastReceipt = await mutate({
      batchOrdinal,
      contacts: legacy.cachedContacts.slice(
        offset,
        offset + LIBRARY_CORE_DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS,
      ),
      deletedResourceNames: [],
      generationId,
      mutationKind: "device_contact_delta_append_v1",
      schemaVersion: 1,
      updatedAt: now,
    });
  }
  const suggestionsByResource = new Map(
    legacy.pendingSuggestions.flatMap((suggestion) => {
      const resourceName = legacySuggestionResourceName(suggestion.id);
      return resourceName ? [[resourceName, suggestion] as const] : [];
    }),
  );
  for (
    let offset = 0;
    offset < legacy.cachedContacts.length;
    offset += LIBRARY_CORE_DEVICE_CONTACT_MATCH_MAXIMUM_MEMBERS
  ) {
    await mutate({
      generationId,
      matchedAt: now,
      matches: legacy.cachedContacts
        .slice(offset, offset + LIBRARY_CORE_DEVICE_CONTACT_MATCH_MAXIMUM_MEMBERS)
        .map((contact) => ({
          resourceName: contact.resourceName,
          suggestion: suggestionsByResource.get(contact.resourceName) ?? null,
        })),
      mutationKind: "device_contact_match_append_v1",
      schemaVersion: 1,
    });
  }
  await mutate({
    activatedAt: now,
    expectedContactCount:
      lastReceipt?.stagedContactCount ?? legacy.cachedContacts.length,
    generationId,
    mutationKind: "device_contact_generation_activate_v1",
    nextSyncToken: legacy.syncToken ?? "",
    schemaVersion: 1,
  });
  for (const suggestionId of legacy.dismissedSuggestionIds) {
    await mutate({
      dismissedAt: now,
      mutationKind: "device_contact_suggestion_dismiss_v1",
      schemaVersion: 1,
      suggestionId,
    });
  }
  if (
    legacy.authStatus === "reconnect_required" ||
    legacy.syncStatus === "error"
  ) {
    await mutate({
      authStatus: legacy.authStatus,
      errorCode: legacy.lastErrorCode ?? "unknown",
      errorMessage:
        legacy.lastErrorMessage ?? "Reconnect Google to sync contacts.",
      mutationKind: "device_contact_status_set_v1",
      schemaVersion: 1,
      syncStartedAt: null,
      syncStatus: "error",
      updatedAt: now,
    });
  }
  localStorage.removeItem(LEGACY_CONTACT_SYNC_STORAGE_KEY);
}

export function useContactSync() {
  const {
    googleContacts,
    mutateDeviceContacts,
    queryDeviceContacts,
    queryLibraryCore,
    store,
  } = usePlatform();
  const setPendingMatchCount = store((state) => state.setPendingMatchCount);
  const [syncState, setSyncState] =
    useState<LibraryCoreDeviceContactStatusResponseV1>(EMPTY_STATUS);
  const [suggestionPage, setSuggestionPage] = useState(() =>
    emptySuggestionPage(0),
  );
  const [unmatchedPage, setUnmatchedPage] = useState(() =>
    emptyUnmatchedPage(0),
  );
  const syncStateRef = useRef(syncState);
  syncStateRef.current = syncState;
  const syncPromiseRef =
    useRef<Promise<LibraryCoreDeviceContactStatusResponseV1> | null>(null);
  const mountedAtRef = useRef(Date.now());
  const suggestionCursorRef =
    useRef<LibraryCoreDeviceContactSuggestionCursorV1 | null>(null);
  const unmatchedCursorRef =
    useRef<LibraryCoreDeviceContactUnmatchedCursorV1 | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!queryDeviceContacts) return syncStateRef.current;
    const next = await queryDeviceContacts({
      queryId: "device_contact_status_v1",
      schemaVersion: 1,
    });
    syncStateRef.current = next;
    setSyncState(next);
    return next;
  }, [queryDeviceContacts]);

  const loadSuggestionPage = useCallback(
    async (cursor: LibraryCoreDeviceContactSuggestionCursorV1 | null) => {
      if (!queryDeviceContacts || syncStateRef.current.activeGenerationId === null) {
        const empty = emptySuggestionPage(syncStateRef.current.revision);
        suggestionCursorRef.current = null;
        setSuggestionPage(empty);
        return empty;
      }
      const page = await queryDeviceContacts({
        cursor,
        limit: LIBRARY_CORE_DEVICE_CONTACT_REVIEW_MAXIMUM_ROWS,
        queryId: "device_contact_suggestion_page_v1",
        schemaVersion: 1,
      });
      suggestionCursorRef.current = cursor;
      setSuggestionPage(page);
      return page;
    },
    [queryDeviceContacts],
  );

  const loadUnmatchedPage = useCallback(
    async (cursor: LibraryCoreDeviceContactUnmatchedCursorV1 | null) => {
      if (!queryDeviceContacts || syncStateRef.current.activeGenerationId === null) {
        const empty = emptyUnmatchedPage(syncStateRef.current.revision);
        unmatchedCursorRef.current = null;
        setUnmatchedPage(empty);
        return empty;
      }
      const page = await queryDeviceContacts({
        cursor,
        limit: LIBRARY_CORE_DEVICE_CONTACT_REVIEW_MAXIMUM_ROWS,
        queryId: "device_contact_unmatched_page_v1",
        schemaVersion: 1,
      });
      unmatchedCursorRef.current = cursor;
      setUnmatchedPage(page);
      return page;
    },
    [queryDeviceContacts],
  );

  const refreshReview = useCallback(async () => {
    await Promise.all([loadSuggestionPage(null), loadUnmatchedPage(null)]);
  }, [loadSuggestionPage, loadUnmatchedPage]);

  useEffect(() => {
    setPendingMatchCount(syncState.pendingSuggestionCount);
  }, [setPendingMatchCount, syncState.pendingSuggestionCount]);

  useEffect(() => {
    if (!queryDeviceContacts || !mutateDeviceContacts) return;
    let cancelled = false;
    void (async () => {
      try {
        let status = await queryDeviceContacts({
          queryId: "device_contact_status_v1",
          schemaVersion: 1,
        });
        if (status.syncStatus === "syncing") {
          await mutateDeviceContacts({
            authStatus: status.authStatus,
            errorCode: "network",
            errorMessage: "Google Contacts sync was interrupted. Try syncing again.",
            mutationKind: "device_contact_status_set_v1",
            schemaVersion: 1,
            syncStartedAt: null,
            syncStatus: "error",
            updatedAt: Date.now(),
          });
        }
        await importLegacyContactStateOnce(
          queryDeviceContacts,
          mutateDeviceContacts,
        );
        status = await queryDeviceContacts({
          queryId: "device_contact_status_v1",
          schemaVersion: 1,
        });
        if (!cancelled) {
          syncStateRef.current = status;
          setSyncState(status);
          if (status.activeGenerationId !== null) await refreshReview();
        }
      } catch (error) {
        if (cancelled) return;
        setSyncState({
          ...EMPTY_STATUS,
          lastErrorCode: "unknown",
          lastErrorMessage:
            error instanceof Error
              ? error.message
              : "The local contact Library is unavailable.",
          syncStatus: "error",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mutateDeviceContacts, queryDeviceContacts, refreshReview]);

  const runSync = useCallback(
    (options: { force?: boolean } = {}) => {
      if (syncPromiseRef.current) return syncPromiseRef.current;
      const resetEpoch = captureFactoryResetWriteEpoch();
      if (resetEpoch === null) return Promise.resolve(syncStateRef.current);
      let tracked!: Promise<LibraryCoreDeviceContactStatusResponseV1>;
      const operation = (async () => {
        const current = syncStateRef.current;
        if (!googleContacts || !mutateDeviceContacts || !queryDeviceContacts) {
          return current;
        }
        if (
          !options.force &&
          current.syncStatus !== "error" &&
          current.lastSyncedAt !== null &&
          Date.now() - current.lastSyncedAt < SYNC_INTERVAL_MS
        ) {
          return current;
        }
        if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
        const startedAt = Date.now();
        const activityId = startBackgroundActivity({
          channelId: "googleContacts",
          id: "channel:googleContacts",
          kind: "channel",
          label: "Google Contacts",
          message: "Checking Google Contacts token.",
        });
        await mutateDeviceContacts({
          authStatus: current.authStatus,
          errorCode: null,
          errorMessage: null,
          mutationKind: "device_contact_status_set_v1",
          schemaVersion: 1,
          syncStartedAt: startedAt,
          syncStatus: "syncing",
          updatedAt: startedAt,
        });
        await refreshStatus();
        try {
          const token = await withTimeout(
            Promise.resolve(googleContacts.getToken()),
            CONTACT_SYNC_TIMEOUT_MS,
            "Google Contacts token lookup",
          );
          if (!token) {
            throw Object.assign(
              new Error("Reconnect Google to sync contacts."),
              { contactErrorCode: "missing_token" as const },
            );
          }
          updateBackgroundActivity(activityId, {
            log: true,
            message: "Fetching Google Contacts.",
          });
          const contactsPromise: Promise<GoogleContactsResult> =
            googleContacts.fetchContacts
              ? googleContacts.fetchContacts(token, current.syncToken)
              : fetchGoogleContacts(token, current.syncToken);
          const result = await withTimeout(
            contactsPromise,
            CONTACT_SYNC_TIMEOUT_MS,
            "Google Contacts sync",
          );
          if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
          const generationId = `contacts:${startedAt.toLocaleString("en-US", { useGrouping: false })}:${crypto.randomUUID()}`;
          let receipt = await mutateDeviceContacts({
            generationId,
            mutationKind: "device_contact_generation_begin_v1",
            schemaVersion: 1,
            startedAt,
          });
          receipt =
            (await appendContactDeltas(
              mutateDeviceContacts,
              generationId,
              result,
              Date.now(),
            )) ?? receipt;
          if (receipt.stagedContactCount > 0) {
            if (!queryLibraryCore) {
              throw new Error("The SQLite Library query boundary is unavailable.");
            }
            await matchBuildingGeneration(
              queryDeviceContacts,
              mutateDeviceContacts,
              queryLibraryCore,
              generationId,
            );
          }
          await mutateDeviceContacts({
            activatedAt: Date.now(),
            expectedContactCount: receipt.stagedContactCount,
            generationId,
            mutationKind: "device_contact_generation_activate_v1",
            nextSyncToken: result.nextSyncToken,
            schemaVersion: 1,
          });
          const status = await refreshStatus();
          await refreshReview();
          finishBackgroundActivity(
            activityId,
            "success",
            `Google Contacts sync finished with ${result.contacts.length.toLocaleString()} changed contact${result.contacts.length === 1 ? "" : "s"}.`,
          );
          return status;
        } catch (error) {
          if (!isFactoryResetWriteAllowed(resetEpoch)) return current;
          const message =
            error instanceof Error
              ? error.message
              : "Google Contacts sync failed.";
          const declaredCode =
            typeof error === "object" &&
            error !== null &&
            "contactErrorCode" in error
              ? error.contactErrorCode
              : null;
          const errorCode =
            declaredCode === "missing_token"
              ? declaredCode
              : isAuthSyncError(error)
                ? "auth"
                : "network";
          await mutateDeviceContacts({
            authStatus:
              errorCode === "auth" || errorCode === "missing_token"
                ? "reconnect_required"
                : syncStateRef.current.authStatus,
            errorCode,
            errorMessage: message,
            mutationKind: "device_contact_status_set_v1",
            schemaVersion: 1,
            syncStartedAt: null,
            syncStatus: "error",
            updatedAt: Date.now(),
          });
          const status = await refreshStatus();
          finishBackgroundActivity(
            activityId,
            "error",
            `Google Contacts sync failed: ${message}`,
          );
          return status;
        }
      })();
      tracked = trackFactoryResetSensitiveOperation(operation).finally(() => {
        if (syncPromiseRef.current === tracked) syncPromiseRef.current = null;
      });
      syncPromiseRef.current = tracked;
      return tracked;
    },
    [
      googleContacts,
      mutateDeviceContacts,
      queryDeviceContacts,
      queryLibraryCore,
      refreshReview,
      refreshStatus,
    ],
  );

  useEffect(() => {
    if (!googleContacts) return undefined;
    const id = setInterval(() => void runSync(), SYNC_INTERVAL_MS);
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
  }, [googleContacts, runSync]);

  const dismissSuggestion = useCallback(
    async (suggestionId: string) => {
      if (!mutateDeviceContacts) return;
      await mutateDeviceContacts({
        dismissedAt: Date.now(),
        mutationKind: "device_contact_suggestion_dismiss_v1",
        schemaVersion: 1,
        suggestionId,
      });
      await Promise.all([
        refreshStatus(),
        loadSuggestionPage(suggestionCursorRef.current),
      ]);
    },
    [loadSuggestionPage, mutateDeviceContacts, refreshStatus],
  );

  return {
    dismissSuggestion,
    loadNextSuggestionPage: () =>
      suggestionPage.nextCursor
        ? loadSuggestionPage(suggestionPage.nextCursor)
        : Promise.resolve(suggestionPage),
    loadNextUnmatchedPage: () =>
      unmatchedPage.nextCursor
        ? loadUnmatchedPage(unmatchedPage.nextCursor)
        : Promise.resolve(unmatchedPage),
    refreshReview,
    resetSuggestionPage: () => loadSuggestionPage(null),
    resetUnmatchedPage: () => loadUnmatchedPage(null),
    suggestionPage,
    syncNow: runSync,
    syncState,
    unmatchedPage,
  };
}
