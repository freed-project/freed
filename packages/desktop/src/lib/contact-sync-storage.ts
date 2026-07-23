import {
  CONTACT_SYNC_STORAGE_KEY,
  createContactSyncStateForManualRepair,
  createEmptyContactSyncState,
  parseContactSyncState,
  serializeContactSyncState,
  type ContactSyncState,
} from "@freed/shared";

export function readContactSyncState(): ContactSyncState {
  if (typeof window === "undefined") {
    return createEmptyContactSyncState();
  }

  return parseContactSyncState(window.localStorage.getItem(CONTACT_SYNC_STORAGE_KEY)).state;
}

export function readContactSyncStateJson(): string {
  const fallback = serializeContactSyncState(createEmptyContactSyncState());
  if (typeof window === "undefined") return fallback;

  return window.localStorage.getItem(CONTACT_SYNC_STORAGE_KEY) ?? fallback;
}

export function writeContactSyncState(state: ContactSyncState): ContactSyncState {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, serializeContactSyncState(state));
  }

  return state;
}

export function writeContactSyncStateJson(raw: string | null | undefined): ContactSyncState {
  const parsed = parseContactSyncState(raw);
  if (
    typeof window !== "undefined"
    && raw !== null
    && raw !== undefined
    && (parsed.status === "corrupt" || parsed.status === "unsupported")
  ) {
    window.localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, raw);
    return parsed.state;
  }
  return writeContactSyncState(parsed.state);
}

export function setContactSyncError(
  message: string,
  code: ContactSyncState["lastErrorCode"] = "auth",
): ContactSyncState {
  let parsed: ReturnType<typeof parseContactSyncState>;
  try {
    parsed = typeof window === "undefined"
      ? parseContactSyncState(null)
      : parseContactSyncState(window.localStorage.getItem(CONTACT_SYNC_STORAGE_KEY));
  } catch {
    return createContactSyncStateForManualRepair("unavailable");
  }
  if (parsed.status === "corrupt" || parsed.status === "unsupported") {
    return parsed.state;
  }
  const current = parsed.state;
  return writeContactSyncState({
    ...current,
    authStatus: code === "missing_token" || code === "auth"
      ? "reconnect_required"
      : current.authStatus,
    syncStatus: "error",
    lastErrorCode: code,
    lastErrorMessage: message,
  });
}
