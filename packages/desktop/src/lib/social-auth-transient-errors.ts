import { isTransientProviderIssue } from "@freed/ui/lib/provider-status";

export interface StoredSocialAuthState {
  isAuthenticated: boolean;
  lastCheckedAt?: number;
  lastCapturedAt?: number;
  lastCaptureError?: string;
  pausedUntil?: number;
  pauseReason?: string;
  pauseLevel?: 1 | 2 | 3;
}

export type StoredSocialAuthRead<T extends StoredSocialAuthState> =
  | { status: "missing" }
  | { status: "supported"; state: T; source: Record<string, unknown> }
  | { status: "corrupt" }
  | { status: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalTimestamp(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalPauseLevel(
  value: unknown,
): value is 1 | 2 | 3 | undefined {
  return value === undefined || value === 1 || value === 2 || value === 3;
}

export function readStoredSocialAuthState<T extends StoredSocialAuthState>(
  storageKey: string,
): StoredSocialAuthRead<T> {
  let stored: string | null;
  try {
    stored = localStorage.getItem(storageKey);
  } catch {
    return { status: "unavailable" };
  }

  if (stored === null) return { status: "missing" };

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.isAuthenticated !== "boolean" ||
      !isOptionalTimestamp(parsed.lastCheckedAt) ||
      !isOptionalTimestamp(parsed.lastCapturedAt) ||
      !isOptionalString(parsed.lastCaptureError) ||
      !isOptionalTimestamp(parsed.pausedUntil) ||
      !isOptionalString(parsed.pauseReason) ||
      !isOptionalPauseLevel(parsed.pauseLevel)
    ) {
      return { status: "corrupt" };
    }

    const state = clearTransientLastCaptureError({
      isAuthenticated: parsed.isAuthenticated,
      lastCheckedAt: parsed.lastCheckedAt,
      lastCapturedAt: parsed.lastCapturedAt,
      lastCaptureError: parsed.lastCaptureError,
      pausedUntil: parsed.pausedUntil,
      pauseReason: parsed.pauseReason,
      pauseLevel: parsed.pauseLevel,
    });
    return { status: "supported", state: state as T, source: parsed };
  } catch {
    return { status: "corrupt" };
  }
}

export function persistDisconnectedSocialAuthStateForFactoryReset(
  storageKey: string,
  providerLabel: string,
): void {
  const current = readStoredSocialAuthState(storageKey);
  if (current.status === "unavailable") {
    throw new Error(`${providerLabel} auth storage is unavailable`);
  }
  if (current.status === "corrupt") return;

  const source = current.status === "supported" ? current.source : {};
  const preserved = { ...source };
  delete preserved.lastCaptureError;
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      ...preserved,
      isAuthenticated: false,
      lastCheckedAt: Date.now(),
    }),
  );
}

export function clearTransientLastCaptureError<
  T extends { lastCaptureError?: string },
>(state: T): T {
  if (!isTransientProviderIssue(state.lastCaptureError)) return state;
  return { ...state, lastCaptureError: undefined };
}
