import type { ContactSyncState } from "./types.js";

export const CONTACT_SYNC_STORAGE_KEY = "freed_contact_sync";
export const CONTACT_SYNC_STATE_VERSION = 1;

export type ContactSyncStateParseResult =
  | {
      readonly status: "missing";
      readonly state: ContactSyncState;
    }
  | {
      readonly status: "valid";
      readonly format: "current" | "legacy";
      readonly raw: string;
      readonly state: ContactSyncState;
    }
  | {
      readonly status: "corrupt";
      readonly raw: string;
      readonly state: ContactSyncState;
    }
  | {
      readonly status: "unsupported";
      readonly raw: string;
      readonly version: unknown;
      readonly state: ContactSyncState;
    };

export function createEmptyContactSyncState(): ContactSyncState {
  const pendingSuggestions: ContactSyncState["pendingSuggestions"] = [];
  const dismissedSuggestionIds: string[] = [];
  return {
    authStatus: "reconnect_required",
    syncStatus: "idle",
    syncStartedAt: null,
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

export function createContactSyncStateForManualRepair(
  reason: "corrupt" | "unsupported" | "unavailable",
): ContactSyncState {
  const message = reason === "unsupported"
    ? "Stored Google Contacts sync state is from a newer version. Use Sync Now or reconnect Google to replace it."
    : reason === "unavailable"
      ? "Google Contacts sync state could not be read or saved. Use Sync Now or reconnect Google to retry."
      : "Stored Google Contacts sync state is damaged. Use Sync Now or reconnect Google to repair it.";
  return {
    ...createEmptyContactSyncState(),
    syncStatus: "error",
    lastErrorCode: "unknown",
    lastErrorMessage: message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isOptionalNullableTimestamp(value: unknown): boolean {
  return value === undefined
    || value === null
    || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isOptionalCount(value: unknown): boolean {
  return value === undefined
    || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function isGoogleContact(value: unknown): boolean {
  if (!isRecord(value) || typeof value.resourceName !== "string" || !isRecord(value.name)) {
    return false;
  }
  if (
    !isOptionalString(value.etag)
    || !isOptionalString(value.name.displayName)
    || !isOptionalString(value.name.givenName)
    || !isOptionalString(value.name.familyName)
    || !isOptionalString(value.name.middleName)
  ) {
    return false;
  }
  if (
    !Array.isArray(value.emails)
    || !value.emails.every((entry) =>
      isRecord(entry) && typeof entry.value === "string" && isOptionalString(entry.type))
    || !Array.isArray(value.phones)
    || !value.phones.every((entry) =>
      isRecord(entry) && typeof entry.value === "string" && isOptionalString(entry.type))
    || !Array.isArray(value.photos)
    || !value.photos.every((entry) =>
      isRecord(entry) && typeof entry.url === "string" && isOptionalBoolean(entry.default))
    || !Array.isArray(value.organizations)
    || !value.organizations.every((entry) =>
      isRecord(entry) && isOptionalString(entry.name) && isOptionalString(entry.title))
  ) {
    return false;
  }
  return value.metadata === undefined
    || (isRecord(value.metadata) && isOptionalBoolean(value.metadata.deleted));
}

function isIdentitySuggestion(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.kind === "merge_accounts" || value.kind === "attach_accounts_to_person")
    && (value.confidence === "high" || value.confidence === "medium")
    && Array.isArray(value.accountIds)
    && value.accountIds.every((accountId) => typeof accountId === "string")
    && isOptionalString(value.personId)
    && typeof value.label === "string"
    && isOptionalString(value.reason)
    && typeof value.createdAt === "number"
    && Number.isFinite(value.createdAt)
    && value.createdAt >= 0;
}

function isSupportedContactSyncRecord(value: Record<string, unknown>): boolean {
  return (
    (value.authStatus === undefined
      || value.authStatus === "connected"
      || value.authStatus === "reconnect_required")
    && (value.syncStatus === undefined
      || value.syncStatus === "idle"
      || value.syncStatus === "syncing"
      || value.syncStatus === "error")
    && isOptionalNullableTimestamp(value.syncStartedAt)
    && isOptionalNullableString(value.syncToken)
    && isOptionalNullableTimestamp(value.lastSyncedAt)
    && (value.lastErrorCode === undefined
      || value.lastErrorCode === "missing_token"
      || value.lastErrorCode === "auth"
      || value.lastErrorCode === "network"
      || value.lastErrorCode === "unknown")
    && isOptionalString(value.lastErrorMessage)
    && (value.cachedContacts === undefined
      || (Array.isArray(value.cachedContacts) && value.cachedContacts.every(isGoogleContact)))
    && (value.pendingSuggestions === undefined
      || (Array.isArray(value.pendingSuggestions)
        && value.pendingSuggestions.every(isIdentitySuggestion)))
    && (value.pendingMatches === undefined
      || (Array.isArray(value.pendingMatches)
        && value.pendingMatches.every(isRecord)))
    && (value.dismissedSuggestionIds === undefined
      || (Array.isArray(value.dismissedSuggestionIds)
        && value.dismissedSuggestionIds.every((id) => typeof id === "string")))
    && (value.dismissedMatches === undefined
      || (Array.isArray(value.dismissedMatches)
        && value.dismissedMatches.every((entry) => typeof entry === "string" || isRecord(entry))))
    && isOptionalCount(value.createdFriendCount)
    && isOptionalCount(value.autoLinkedCount)
    && isOptionalCount(value.autoCreatedCount)
  );
}

function normalizeContactSyncState(parsed: Record<string, unknown>): ContactSyncState {
  const pendingSource = parsed.pendingSuggestions ?? parsed.pendingMatches ?? [];
  const pendingSuggestions = (pendingSource as unknown[])
    .filter(isIdentitySuggestion) as ContactSyncState["pendingSuggestions"];
  const dismissedSource = parsed.dismissedSuggestionIds ?? parsed.dismissedMatches ?? [];
  const dismissedSuggestionIds = (dismissedSource as unknown[])
    .filter((value): value is string => typeof value === "string");
  const createdFriendCount = typeof parsed.createdFriendCount === "number"
    ? parsed.createdFriendCount
    : typeof parsed.autoCreatedCount === "number"
      ? parsed.autoCreatedCount
      : 0;
  return {
    authStatus: parsed.authStatus === "connected" ? "connected" : "reconnect_required",
    syncStatus: parsed.syncStatus === "syncing" || parsed.syncStatus === "error"
      ? parsed.syncStatus
      : "idle",
    syncStartedAt: typeof parsed.syncStartedAt === "number" ? parsed.syncStartedAt : null,
    syncToken: typeof parsed.syncToken === "string" ? parsed.syncToken : null,
    lastSyncedAt: typeof parsed.lastSyncedAt === "number" ? parsed.lastSyncedAt : null,
    lastErrorCode: parsed.lastErrorCode as ContactSyncState["lastErrorCode"],
    lastErrorMessage: typeof parsed.lastErrorMessage === "string"
      ? parsed.lastErrorMessage
      : undefined,
    cachedContacts: (parsed.cachedContacts ?? []) as ContactSyncState["cachedContacts"],
    pendingSuggestions,
    dismissedSuggestionIds,
    createdFriendCount,
    pendingMatches: pendingSuggestions,
    dismissedMatches: dismissedSuggestionIds,
    autoLinkedCount: typeof parsed.autoLinkedCount === "number" ? parsed.autoLinkedCount : 0,
    autoCreatedCount: createdFriendCount,
  };
}

export function serializeContactSyncState(state: ContactSyncState): string {
  return JSON.stringify({ version: CONTACT_SYNC_STATE_VERSION, ...state });
}

export function parseContactSyncState(
  raw: string | null | undefined,
): ContactSyncStateParseResult {
  if (raw === null || raw === undefined) {
    return { status: "missing", state: createEmptyContactSyncState() };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {
        status: "corrupt",
        raw,
        state: createContactSyncStateForManualRepair("corrupt"),
      };
    }
    if ("version" in parsed && parsed.version !== CONTACT_SYNC_STATE_VERSION) {
      return {
        status: "unsupported",
        raw,
        version: parsed.version,
        state: createContactSyncStateForManualRepair("unsupported"),
      };
    }
    if (!isSupportedContactSyncRecord(parsed)) {
      return {
        status: "corrupt",
        raw,
        state: createContactSyncStateForManualRepair("corrupt"),
      };
    }
    return {
      status: "valid",
      format: "version" in parsed ? "current" : "legacy",
      raw,
      state: normalizeContactSyncState(parsed),
    };
  } catch {
    return {
      status: "corrupt",
      raw,
      state: createContactSyncStateForManualRepair("corrupt"),
    };
  }
}
