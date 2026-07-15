import { isTransientProviderIssue } from "@freed/ui/lib/provider-status";

export interface StoredSocialAuthState {
  isAuthenticated: boolean;
  lastCheckedAt?: number;
  lastCapturedAt?: number;
  lastCaptureError?: string;
  captureCooldownUntil?: number;
  pausedUntil?: number;
  pauseReason?: string;
  pauseLevel?: 1 | 2 | 3;
}

export type StoredSocialAuthRead<T extends StoredSocialAuthState> =
  | { status: "missing" }
  | { status: "supported"; state: T }
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

function persistentFailureSummary(message: string | undefined): string | undefined {
  if (!message || isTransientProviderIssue(message)) return undefined;
  const normalized = message.toLocaleLowerCase();
  if (
    normalized.includes("auth")
    || normalized.includes("cookie")
    || normalized.includes("login")
    || normalized.includes("signed out")
  ) {
    return "Provider authentication needs attention.";
  }
  if (
    normalized.includes("rate limit")
    || normalized.includes("too many requests")
    || normalized.includes("429")
  ) {
    return "Provider requests are temporarily paused.";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "The provider request timed out.";
  }
  if (
    normalized.includes("extract")
    || normalized.includes("parse")
    || normalized.includes("page")
    || normalized.includes("placeholder")
  ) {
    return "Freed could not read the provider page.";
  }
  if (
    normalized.includes("empty")
    || normalized.includes("no posts")
    || normalized.includes("no items")
    || normalized.includes("no new")
  ) {
    return "The provider returned no new items.";
  }
  return "The last provider sync failed.";
}

function persistentPauseSummary(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const normalized = message.toLocaleLowerCase();
  if (normalized.includes("rate") || normalized.includes("429")) {
    return "Provider rate limiting was detected.";
  }
  if (normalized.includes("storage")) {
    return "Local provider health storage needs attention.";
  }
  return "Provider work is temporarily paused.";
}

function finiteStoredTimestamp(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Keep fast startup hints in browser storage without copying raw provider
 * responses, OAuth errors, cookies, or diagnostic text into clear text.
 * Detailed failures remain in the bounded device-local provider health ledger.
 */
function prepareSocialAuthStateForStorage(
  state: StoredSocialAuthState,
): StoredSocialAuthState {
  const lastCheckedAt = finiteStoredTimestamp(state.lastCheckedAt);
  const lastCapturedAt = finiteStoredTimestamp(state.lastCapturedAt);
  const captureCooldownUntil = finiteStoredTimestamp(state.captureCooldownUntil);
  const pausedUntil = finiteStoredTimestamp(state.pausedUntil);
  const lastCaptureError = persistentFailureSummary(state.lastCaptureError);
  const pauseReason = persistentPauseSummary(state.pauseReason);
  const pauseLevel = isOptionalPauseLevel(state.pauseLevel)
    ? state.pauseLevel
    : undefined;

  return {
    isAuthenticated: state.isAuthenticated === true,
    ...(lastCheckedAt === undefined ? {} : { lastCheckedAt }),
    ...(lastCapturedAt === undefined ? {} : { lastCapturedAt }),
    ...(lastCaptureError === undefined ? {} : { lastCaptureError }),
    ...(captureCooldownUntil === undefined ? {} : { captureCooldownUntil }),
    ...(pausedUntil === undefined ? {} : { pausedUntil }),
    ...(pauseReason === undefined ? {} : { pauseReason }),
    ...(pauseLevel === undefined ? {} : { pauseLevel }),
  };
}

export function serializeSocialAuthStateForStorage(
  state: StoredSocialAuthState,
): string {
  return JSON.stringify(prepareSocialAuthStateForStorage(state));
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
      !isOptionalTimestamp(parsed.captureCooldownUntil) ||
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
      captureCooldownUntil: parsed.captureCooldownUntil,
      pausedUntil: parsed.pausedUntil,
      pauseReason: parsed.pauseReason,
      pauseLevel: parsed.pauseLevel,
    });
    const prepared = prepareSocialAuthStateForStorage(state);
    const serialized = JSON.stringify(prepared);
    if (stored !== serialized) {
      try {
        localStorage.setItem(storageKey, serialized);
      } catch {
        return { status: "unavailable" };
      }
    }
    return {
      status: "supported",
      state: prepared as T,
    };
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
  const prepared = current.status === "supported"
    ? prepareSocialAuthStateForStorage(current.state)
    : { isAuthenticated: false };
  const preserved = { ...prepared };
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

function clearTransientLastCaptureError<
  T extends { lastCaptureError?: string },
>(state: T): T {
  if (!isTransientProviderIssue(state.lastCaptureError)) return state;
  return { ...state, lastCaptureError: undefined };
}
