import type { Platform } from "@freed/shared";
import {
  readVersionedLocalStorage,
  writeVersionedLocalStorage,
  type VersionedLocalStorageCodec,
} from "@freed/ui/lib/versioned-local-storage";

const STORAGE_KEY = "freed-device-social-outbox-v1";
const MAX_RECORDS = 2_000;

const SOCIAL_OUTBOX_MAX_ATTEMPTS = 3;

export type SocialOutboxAction = "like" | "seen";

export interface SocialOutboxIntent {
  globalId: string;
  platform: Platform;
  action: SocialOutboxAction;
  intentAt: number;
}

export interface SocialOutboxRetryRecord extends SocialOutboxIntent {
  attempts: number;
  updatedAt: number;
  platformConfirmedAt?: number;
  explicitLocalIntent?: true;
}

interface StoredSocialOutboxState {
  version: 1;
  entries: Record<string, SocialOutboxRetryRecord>;
}

export type SocialOutboxAttemptDecision =
  | {
    kind: "attempt";
    attempt: number;
    maxAttempts: number;
    exhaustedAfterAttempt: boolean;
  }
  | {
    kind: "confirmed";
    confirmedAt: number;
  }
  | {
    kind: "exhausted";
    attempts: number;
  }
  | {
    kind: "capacity";
  };

let current: StoredSocialOutboxState = emptyState();
let hydrated = false;
const volatilePlatformConfirmations = new Map<string, number>();

function emptyState(): StoredSocialOutboxState {
  return { version: 1, entries: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function intentKey(intent: SocialOutboxIntent): string {
  return JSON.stringify([
    intent.action,
    intent.platform,
    intent.globalId,
    intent.intentAt,
  ]);
}

function normalizeIntent(value: unknown): SocialOutboxIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.globalId !== "string"
    || candidate.globalId.length === 0
    || candidate.globalId.length > 2_048
    || typeof candidate.platform !== "string"
    || candidate.platform.length === 0
    || candidate.platform.length > 64
    || (candidate.action !== "like" && candidate.action !== "seen")
    || typeof candidate.intentAt !== "number"
    || !Number.isFinite(candidate.intentAt)
    || candidate.intentAt < 0
  ) {
    return null;
  }
  return {
    globalId: candidate.globalId,
    platform: candidate.platform as Platform,
    action: candidate.action,
    intentAt: candidate.intentAt,
  };
}

function normalizeRecord(value: unknown): SocialOutboxRetryRecord | null {
  const intent = normalizeIntent(value);
  if (!intent || !value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.attempts !== "number"
    || !Number.isSafeInteger(candidate.attempts)
    || candidate.attempts < 0
    || candidate.attempts > SOCIAL_OUTBOX_MAX_ATTEMPTS
    || typeof candidate.updatedAt !== "number"
    || !Number.isFinite(candidate.updatedAt)
    || candidate.updatedAt < 0
  ) {
    return null;
  }
  const record: SocialOutboxRetryRecord = {
    ...intent,
    attempts: candidate.attempts,
    updatedAt: candidate.updatedAt,
  };
  if (
    typeof candidate.platformConfirmedAt === "number"
    && Number.isFinite(candidate.platformConfirmedAt)
    && candidate.platformConfirmedAt >= 0
  ) {
    record.platformConfirmedAt = candidate.platformConfirmedAt;
  }
  if (candidate.explicitLocalIntent === true) {
    record.explicitLocalIntent = true;
  }
  return record;
}

const STORAGE_CODEC: VersionedLocalStorageCodec<StoredSocialOutboxState> = {
  version: 1,
  decode(value) {
    if (!isRecord(value.entries)) return null;
    const sourceEntries = Object.entries(value.entries);
    if (sourceEntries.length > MAX_RECORDS) return null;
    const entries: Record<string, SocialOutboxRetryRecord> = {};
    for (const [key, value] of sourceEntries) {
      const record = normalizeRecord(value);
      if (!record || key !== intentKey(record) || key in entries) return null;
      entries[key] = record;
    }
    return { version: 1, entries };
  },
  encode(value) {
    return { entries: value.entries };
  },
};

function readState(): StoredSocialOutboxState {
  if (hydrated) return current;
  hydrated = true;
  const stored = readVersionedLocalStorage(STORAGE_KEY, STORAGE_CODEC);
  current = stored.status === "supported" ? stored.value : emptyState();
  return current;
}

function persistState(
  next: StoredSocialOutboxState,
  replaceUnsupportedVersion = false,
  purgeRecoveryCopies = false,
): boolean {
  if (!writeVersionedLocalStorage(
    STORAGE_KEY,
    STORAGE_CODEC,
    next,
    { replaceUnsupportedVersion, purgeRecoveryCopies },
  )) {
    return false;
  }
  current = next;
  hydrated = true;
  return true;
}

function withoutOlderIntents(
  entries: Record<string, SocialOutboxRetryRecord>,
  intent: SocialOutboxIntent,
): Record<string, SocialOutboxRetryRecord> {
  const key = intentKey(intent);
  const next = { ...entries };
  for (const [candidateKey, record] of Object.entries(entries)) {
    if (
      candidateKey !== key
      && record.action === intent.action
      && record.globalId === intent.globalId
    ) {
      delete next[candidateKey];
    }
  }
  return next;
}

/**
 * Remember a like intent created on this Desktop. A legacy -1 value can then
 * remain terminal for old intent while this exact new intent proceeds even if
 * a stale Automerge merge briefly reintroduces the old sentinel.
 */
export function recordExplicitSocialOutboxIntent(
  intent: SocialOutboxIntent,
  now: number = Date.now(),
): boolean {
  const normalized = normalizeIntent(intent);
  if (!normalized) return false;
  const entries = withoutOlderIntents(readState().entries, normalized);
  const key = intentKey(normalized);
  const existing = entries[key];
  if (!existing && Object.keys(entries).length >= MAX_RECORDS) return false;
  entries[key] = {
    ...normalized,
    attempts: existing?.attempts ?? 0,
    updatedAt: now,
    ...(existing?.platformConfirmedAt !== undefined
      ? { platformConfirmedAt: existing.platformConfirmedAt }
      : {}),
    explicitLocalIntent: true,
  };
  return persistState({ version: 1, entries });
}

export function getExplicitSocialOutboxIntent(
  globalId: string,
  action: SocialOutboxAction,
): SocialOutboxIntent | null {
  for (const record of Object.values(readState().entries)) {
    if (
      record.explicitLocalIntent
      && record.globalId === globalId
      && record.action === action
    ) {
      return {
        globalId: record.globalId,
        platform: record.platform,
        action: record.action,
        intentAt: record.intentAt,
      };
    }
  }
  return null;
}

/**
 * Reserve one provider attempt and persist it before provider code runs.
 * This makes a crash count against the local retry budget instead of replaying
 * an uncertain action after restart.
 */
export function beginSocialOutboxAttempt(
  intent: SocialOutboxIntent,
  now: number = Date.now(),
): SocialOutboxAttemptDecision {
  const normalized = normalizeIntent(intent);
  if (!normalized) return { kind: "capacity" };
  const key = intentKey(normalized);
  const volatileConfirmedAt = volatilePlatformConfirmations.get(key);
  if (volatileConfirmedAt !== undefined) {
    return { kind: "confirmed", confirmedAt: volatileConfirmedAt };
  }
  const entries = withoutOlderIntents(readState().entries, normalized);
  const existing = entries[key];
  if (existing?.platformConfirmedAt !== undefined) {
    return { kind: "confirmed", confirmedAt: existing.platformConfirmedAt };
  }
  if ((existing?.attempts ?? 0) >= SOCIAL_OUTBOX_MAX_ATTEMPTS) {
    return { kind: "exhausted", attempts: existing!.attempts };
  }
  if (!existing && Object.keys(entries).length >= MAX_RECORDS) return { kind: "capacity" };
  const attempt = (existing?.attempts ?? 0) + 1;
  entries[key] = {
    ...normalized,
    attempts: attempt,
    updatedAt: now,
    ...(existing?.explicitLocalIntent ? { explicitLocalIntent: true } : {}),
  };
  if (!persistState({ version: 1, entries })) return { kind: "capacity" };
  return {
    kind: "attempt",
    attempt,
    maxAttempts: SOCIAL_OUTBOX_MAX_ATTEMPTS,
    exhaustedAfterAttempt: attempt >= SOCIAL_OUTBOX_MAX_ATTEMPTS,
  };
}

/** Persist a positive provider result until its Automerge acknowledgement lands. */
export function markSocialOutboxPlatformConfirmed(
  intent: SocialOutboxIntent,
  confirmedAt: number = Date.now(),
): boolean {
  const normalized = normalizeIntent(intent);
  if (!normalized) return false;
  const key = intentKey(normalized);
  // Provider success is terminal even when device storage fails between the
  // provider response and the synchronized acknowledgement. Keep a volatile
  // marker before attempting the durable write so this runtime retries only
  // the acknowledgement, never the provider action.
  volatilePlatformConfirmations.set(key, confirmedAt);
  const entries = { ...readState().entries };
  const existing = entries[key];
  entries[key] = {
    ...normalized,
    attempts: existing?.attempts ?? 0,
    updatedAt: confirmedAt,
    platformConfirmedAt: confirmedAt,
    ...(existing?.explicitLocalIntent ? { explicitLocalIntent: true } : {}),
  };
  const next = { version: 1 as const, entries };
  return persistState(next);
}

/** Remove local retry state after the positive acknowledgement is synchronized. */
export function completeSocialOutboxIntent(intent: SocialOutboxIntent): void {
  const normalized = normalizeIntent(intent);
  if (!normalized) return;
  const key = intentKey(normalized);
  volatilePlatformConfirmations.delete(key);
  const entries = { ...readState().entries };
  if (!(key in entries)) return;
  delete entries[key];
  persistState({ version: 1, entries });
}

/**
 * Remove records that no longer correspond to a pending document intent.
 * Full outbox scans call this before draining, so completed, deleted, and
 * historical sentinel actions cannot grow the device-local ledger forever.
 */
export function pruneSocialOutboxState(activeIntents: readonly SocialOutboxIntent[]): void {
  const activeKeys = new Set(
    activeIntents.map(normalizeIntent)
      .filter((intent): intent is SocialOutboxIntent => intent !== null)
      .map(intentKey),
  );
  const entries = { ...readState().entries };
  let changed = false;
  for (const key of Object.keys(entries)) {
    if (!activeKeys.has(key)) {
      delete entries[key];
      changed = true;
    }
  }
  for (const key of volatilePlatformConfirmations.keys()) {
    if (!activeKeys.has(key)) volatilePlatformConfirmations.delete(key);
  }
  if (changed) persistState({ version: 1, entries });
}

/** Clear every device-local social outbox retry record during factory reset. */
export function clearSocialOutboxState(): boolean {
  const cleared = emptyState();
  const persisted = persistState(cleared, true, true);
  if (persisted) volatilePlatformConfirmations.clear();
  return persisted;
}

export function getSocialOutboxRecordForTests(
  intent: SocialOutboxIntent,
): Readonly<SocialOutboxRetryRecord> | null {
  const normalized = normalizeIntent(intent);
  if (!normalized) return null;
  return readState().entries[intentKey(normalized)] ?? null;
}

export function resetSocialOutboxStateForTests(): void {
  current = emptyState();
  hydrated = false;
  volatilePlatformConfirmations.clear();
}
