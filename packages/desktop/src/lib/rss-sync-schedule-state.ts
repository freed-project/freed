import {
  readVersionedLocalStorage,
  writeVersionedLocalStorage,
  type VersionedLocalStorageCodec,
} from "@freed/ui/lib/versioned-local-storage";

export const DEFAULT_RSS_SYNC_INTERVAL_MS = 3 * 60 * 60 * 1_000;
const MIN_RSS_SYNC_INTERVAL_MS = 5 * 60 * 1_000;
const MAX_RSS_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export interface RssSyncScheduleRecord {
  intervalMs: number;
  nextDueAt: number;
  lastAttemptAt?: number;
  lastSettledAt?: number;
}

const KEY = "freed-device-rss-sync-schedule-v1";

function validInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_RSS_SYNC_INTERVAL_MS &&
    value <= MAX_RSS_SYNC_INTERVAL_MS
  );
}

const CODEC: VersionedLocalStorageCodec<RssSyncScheduleRecord> = {
  version: 1,
  decode(value) {
    const record = value.record;
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const candidate = record as Record<string, unknown>;
    if (
      !validInterval(candidate.intervalMs) ||
      typeof candidate.nextDueAt !== "number" ||
      !Number.isFinite(candidate.nextDueAt) ||
      candidate.nextDueAt < 0
    ) {
      return null;
    }
    const normalized: RssSyncScheduleRecord = {
      intervalMs: candidate.intervalMs,
      nextDueAt: candidate.nextDueAt,
    };
    for (const field of ["lastAttemptAt", "lastSettledAt"] as const) {
      if (candidate[field] === undefined) continue;
      if (
        typeof candidate[field] !== "number" ||
        !Number.isFinite(candidate[field]) ||
        candidate[field] < 0
      ) {
        return null;
      }
      normalized[field] = candidate[field];
    }
    return normalized;
  },
  encode(record) {
    return { record };
  },
};

export function getRssSyncSchedule(now = Date.now()): RssSyncScheduleRecord | null {
  const state = readVersionedLocalStorage(KEY, CODEC);
  if (state.status === "supported") return state.value;
  if (state.status !== "missing") return null;
  const record = {
    intervalMs: DEFAULT_RSS_SYNC_INTERVAL_MS,
    nextDueAt: now + DEFAULT_RSS_SYNC_INTERVAL_MS,
  };
  return writeVersionedLocalStorage(KEY, CODEC, record) ? record : null;
}

export function setRssSyncInterval(intervalMs: number, now = Date.now()): boolean {
  if (!validInterval(intervalMs)) return false;
  const state = readVersionedLocalStorage(KEY, CODEC);
  if (state.status === "corrupt" || state.status === "unsupported") return false;
  const current = state.status === "supported" ? state.value : null;
  return writeVersionedLocalStorage(KEY, CODEC, {
    intervalMs,
    nextDueAt: Math.max(current?.nextDueAt ?? 0, now + intervalMs),
    lastAttemptAt: current?.lastAttemptAt,
    lastSettledAt: current?.lastSettledAt,
  });
}

export function claimRssSyncDue(now = Date.now()): RssSyncScheduleRecord | null {
  const state = getRssSyncSchedule(now);
  if (!state || state.nextDueAt > now) return null;
  const claimed = {
    ...state,
    nextDueAt: now + state.intervalMs,
    lastAttemptAt: now,
  };
  return writeVersionedLocalStorage(KEY, CODEC, claimed) ? claimed : null;
}

export function settleRssSync(now = Date.now()): boolean {
  const state = getRssSyncSchedule(now);
  return !!state && writeVersionedLocalStorage(KEY, CODEC, { ...state, lastSettledAt: now });
}

export function deferRssSyncClaim(claimedAt: number): boolean {
  const state = readVersionedLocalStorage(KEY, CODEC);
  if (
    state.status !== "supported" ||
    state.value.lastAttemptAt !== claimedAt
  ) {
    return false;
  }
  return writeVersionedLocalStorage(KEY, CODEC, {
    ...state.value,
    nextDueAt: Math.min(state.value.nextDueAt, claimedAt),
  });
}

export function clearRssSyncScheduleForFactoryReset(): boolean {
  try {
    window.localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
