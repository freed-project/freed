import {
  CONTACT_SYNC_STORAGE_KEY,
  createEmptyContactSyncState,
  parseContactSyncState,
  type ContactSyncState,
} from "@freed/shared";

export function readContactSyncState(): ContactSyncState {
  if (typeof window === "undefined") {
    return createEmptyContactSyncState();
  }

  return parseContactSyncState(window.localStorage.getItem(CONTACT_SYNC_STORAGE_KEY));
}

export function readContactSyncStateJson(): string {
  return JSON.stringify(readContactSyncState());
}

export function writeContactSyncState(state: ContactSyncState): ContactSyncState {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, JSON.stringify(state));
  }

  return state;
}

export function writeContactSyncStateJson(raw: string | null | undefined): ContactSyncState {
  const normalized = parseContactSyncState(raw);
  return writeContactSyncState(normalized);
}

export function setContactSyncError(
  message: string,
  code: ContactSyncState["lastErrorCode"] = "auth",
): ContactSyncState {
  const current = readContactSyncState();
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

export function clearContactSyncState(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(CONTACT_SYNC_STORAGE_KEY);
  }
}
