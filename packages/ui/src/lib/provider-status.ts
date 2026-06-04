import type { ProviderHealthSnapshot } from "./debug-store.js";

export type ProviderStatusTone = "idle" | "healthy" | "warning" | "critical";

export function getProviderStatusToneClass(tone: ProviderStatusTone): string {
  return tone === "critical"
    ? "bg-red-500"
    : tone === "warning"
      ? "bg-amber-500"
      : "bg-emerald-500";
}

export function getHealthStatusLabel(snapshot?: ProviderHealthSnapshot | null): string {
  if (!snapshot) return "Not connected";

  if (snapshot.status === "paused") {
    if (snapshot.lastOutcome === "cooldown") {
      return "Cooling down";
    }
    return "Paused";
  }

  if (snapshot.lastOutcome === "cooldown") {
    return "Cooling down";
  }

  if (snapshot.lastOutcome === "provider_rate_limit") {
    return "Rate limit detected";
  }

  if (snapshot.lastOutcome === "empty") {
    return "No posts pulled";
  }

  if (snapshot.status === "healthy") {
    return "Healthy";
  }

  if (snapshot.status === "degraded") {
    return "Sync issue";
  }

  return "Idle";
}

export function hasAuthLikeIssue(error?: string | null): boolean {
  if (!error) return false;
  return (
    /\b401\b/i.test(error) ||
    /\b403\b/i.test(error) ||
    /unauthorized/i.test(error) ||
    /authenticate/i.test(error) ||
    /expired/i.test(error) ||
    /\bcookie\b/i.test(error) ||
    /\bsession\b/i.test(error) ||
    /\btoken\b/i.test(error) ||
    /\bauth\b/i.test(error) ||
    /not logged in/i.test(error)
  );
}

export function isTransientMemoryPressureIssue(error?: string | null): boolean {
  if (!error) return false;
  const normalized = error.toLocaleLowerCase();
  return normalized.includes("memory is high") && normalized.includes("after cleanup");
}

export function isTransientRuntimeDeferredIssue(error?: string | null): boolean {
  if (!error) return false;
  const normalized = error.toLocaleLowerCase();
  return (
    normalized.includes("runtime_deferred") ||
    normalized.includes("renderer safe mode") ||
    normalized.includes("background work is paused") ||
    normalized.includes("background work is cooling down") ||
    normalized.includes("app window to report healthy") ||
    normalized.includes("app recovers")
  );
}

export function isTransientProviderIssue(error?: string | null): boolean {
  return isTransientMemoryPressureIssue(error) || isTransientRuntimeDeferredIssue(error);
}

export function getProviderStatusTone({
  isConnected,
  authError,
  snapshot,
}: {
  isConnected: boolean;
  authError?: string | null;
  snapshot?: ProviderHealthSnapshot | null;
}): ProviderStatusTone {
  if (hasAuthLikeIssue(authError)) {
    return "critical";
  }
  const usableAuthError = isTransientProviderIssue(authError)
    ? undefined
    : authError;

  if (
    snapshot?.status === "paused" ||
    snapshot?.status === "degraded" ||
    snapshot?.lastOutcome === "empty" ||
    snapshot?.lastOutcome === "provider_rate_limit" ||
    (!!usableAuthError && !hasAuthLikeIssue(usableAuthError))
  ) {
    return "warning";
  }

  if (isConnected) {
    return "healthy";
  }

  return "idle";
}

export function getProviderStatusLabel({
  isConnected,
  authError,
  snapshot,
}: {
  isConnected: boolean;
  authError?: string | null;
  snapshot?: ProviderHealthSnapshot | null;
}): string {
  const tone = getProviderStatusTone({ isConnected, authError, snapshot });

  if (tone === "critical") {
    if (hasAuthLikeIssue(authError)) {
      return "Reconnect required";
    }
    return "Action required";
  }

  if (tone === "warning") {
    if (!snapshot || snapshot.status === "idle") {
      return "Sync issue";
    }
    return getHealthStatusLabel(snapshot);
  }

  if (tone === "healthy") {
    return "Connected";
  }

  return "Not connected";
}

export function getProviderStatusDetail({
  isConnected,
  authError,
  snapshot,
}: {
  isConnected: boolean;
  authError?: string | null;
  snapshot?: ProviderHealthSnapshot | null;
}): string | undefined {
  if (snapshot?.currentMessage) {
    return snapshot.currentMessage;
  }
  const usableAuthError = isTransientProviderIssue(authError)
    ? undefined
    : authError;

  if (hasAuthLikeIssue(usableAuthError)) {
    return usableAuthError ?? "Your session needs to be reconnected before sync can continue.";
  }

  if (snapshot?.lastError) {
    return snapshot.lastError;
  }

  if (usableAuthError) {
    return usableAuthError;
  }

  if (snapshot?.status === "healthy" || isConnected) {
    return "Sync looks healthy right now.";
  }

  return undefined;
}
