import {
  readVersionedLocalStorage,
  writeVersionedLocalStorage,
  type VersionedLocalStorageCodec,
  type VersionedLocalStorageRead,
} from "@freed/ui/lib/versioned-local-storage";

export type ScheduledMetaProvider = "facebook" | "instagram";

export type MetaSyncScheduleOutcome =
  "success" | "empty" | "deferred" | "error" | "ignored" | "abandoned";

type MetaSyncScheduleRecord = {
  nextDueAt: number;
  lastAttemptStartedAt?: number;
  lastAttemptFinishedAt?: number;
  lastOutcome?: MetaSyncScheduleOutcome;
  lastStage?: string;
  inFlightAttemptId?: string;
  inFlightStartedAt?: number;
};

type StoredMetaSyncSchedule = Partial<
  Record<ScheduledMetaProvider, MetaSyncScheduleRecord>
>;

export type MetaSyncScheduleClaim =
  | {
      status: "claimed";
      attemptId: string;
      overdueMs: number;
      coalescedIntervals: number;
    }
  | {
      status: "not_due" | "busy" | "in_flight" | "storage_blocked";
      nextDueAt?: number;
    };

const STORAGE_KEY = "freed-device-meta-sync-schedule-v1";
const META_PROVIDERS = new Set<ScheduledMetaProvider>([
  "facebook",
  "instagram",
]);

function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function normalizeRecord(value: unknown): MetaSyncScheduleRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const nextDueAt = finiteTimestamp(candidate.nextDueAt);
  if (nextDueAt === null) return null;

  const normalized: MetaSyncScheduleRecord = { nextDueAt };
  for (const field of [
    "lastAttemptStartedAt",
    "lastAttemptFinishedAt",
    "inFlightStartedAt",
  ] as const) {
    if (!(field in candidate)) continue;
    const timestamp = finiteTimestamp(candidate[field]);
    if (timestamp === null) return null;
    normalized[field] = timestamp;
  }

  if ("lastOutcome" in candidate) {
    const allowed = new Set<MetaSyncScheduleOutcome>([
      "success",
      "empty",
      "deferred",
      "error",
      "ignored",
      "abandoned",
    ]);
    if (!allowed.has(candidate.lastOutcome as MetaSyncScheduleOutcome)) {
      return null;
    }
    normalized.lastOutcome = candidate.lastOutcome as MetaSyncScheduleOutcome;
  }
  if ("lastStage" in candidate) {
    if (typeof candidate.lastStage !== "string") return null;
    normalized.lastStage = candidate.lastStage.slice(0, 120);
  }
  if ("inFlightAttemptId" in candidate) {
    if (
      typeof candidate.inFlightAttemptId !== "string" ||
      candidate.inFlightAttemptId.length === 0 ||
      candidate.inFlightAttemptId.length > 120
    ) {
      return null;
    }
    normalized.inFlightAttemptId = candidate.inFlightAttemptId;
  }
  if (
    Boolean(normalized.inFlightAttemptId) !==
    Boolean(normalized.inFlightStartedAt !== undefined)
  ) {
    return null;
  }
  return normalized;
}

function normalizeStoredSchedule(
  value: unknown,
): StoredMetaSyncSchedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized: StoredMetaSyncSchedule = {};
  for (const [provider, record] of Object.entries(value)) {
    if (!META_PROVIDERS.has(provider as ScheduledMetaProvider)) return null;
    const normalizedRecord = normalizeRecord(record);
    if (!normalizedRecord) return null;
    normalized[provider as ScheduledMetaProvider] = normalizedRecord;
  }
  return normalized;
}

const STORAGE_CODEC: VersionedLocalStorageCodec<StoredMetaSyncSchedule> = {
  version: 1,
  decode(value) {
    return normalizeStoredSchedule(value.providers);
  },
  encode(providers) {
    return { providers };
  },
};

let current: StoredMetaSyncSchedule = {};
let hydrated = false;
let storageStatus: VersionedLocalStorageRead<StoredMetaSyncSchedule>["status"] =
  "missing";

function readAll(): StoredMetaSyncSchedule {
  if (hydrated) return current;
  hydrated = true;
  const stored = readVersionedLocalStorage(STORAGE_KEY, STORAGE_CODEC);
  storageStatus = stored.status;
  current = stored.status === "supported" ? stored.value : {};
  return current;
}

function writeAll(state: StoredMetaSyncSchedule): boolean {
  const persisted = writeVersionedLocalStorage(
    STORAGE_KEY,
    STORAGE_CODEC,
    state,
  );
  if (persisted) {
    current = state;
    storageStatus = "supported";
  } else if (storageStatus !== "unsupported" && storageStatus !== "corrupt") {
    storageStatus = "unavailable";
  }
  return persisted;
}

function storageBlocked(): boolean {
  readAll();
  return (
    storageStatus === "unsupported" ||
    storageStatus === "corrupt" ||
    storageStatus === "unavailable"
  );
}

export function ensureMetaSyncSchedules(firstDueAt: number): boolean {
  const state = readAll();
  if (storageBlocked()) return false;
  let changed = false;
  const next = { ...state };
  for (const provider of META_PROVIDERS) {
    if (next[provider]) continue;
    next[provider] = { nextDueAt: firstDueAt };
    changed = true;
  }
  return !changed || writeAll(next);
}

export function claimMetaSyncScheduleAttempt(input: {
  provider: ScheduledMetaProvider;
  attemptId: string;
  now: number;
  intervalMs: number;
  inFlightLeaseMs: number;
}): MetaSyncScheduleClaim {
  const state = readAll();
  if (storageBlocked()) return { status: "storage_blocked" };

  let next = state;
  let clearedStaleLease = false;
  for (const provider of META_PROVIDERS) {
    const record = next[provider];
    if (!record?.inFlightAttemptId || record.inFlightStartedAt === undefined) {
      continue;
    }
    if (input.now - record.inFlightStartedAt < input.inFlightLeaseMs) {
      return {
        status: provider === input.provider ? "in_flight" : "busy",
        nextDueAt: record.nextDueAt,
      };
    }
    next = {
      ...next,
      [provider]: {
        ...record,
        lastAttemptFinishedAt: input.now,
        lastOutcome: "abandoned",
        lastStage: "renderer_restart",
        inFlightAttemptId: undefined,
        inFlightStartedAt: undefined,
      },
    };
    clearedStaleLease = true;
  }

  if (clearedStaleLease && !writeAll(next)) {
    return { status: "storage_blocked" };
  }

  const record = next[input.provider];
  if (!record) return { status: "storage_blocked" };
  if (record.nextDueAt > input.now) {
    return { status: "not_due", nextDueAt: record.nextDueAt };
  }

  const overdueMs = Math.max(0, input.now - record.nextDueAt);
  const coalescedIntervals = Math.floor(overdueMs / input.intervalMs);
  const claimed: MetaSyncScheduleRecord = {
    ...record,
    nextDueAt: input.now + input.intervalMs,
    lastAttemptStartedAt: input.now,
    inFlightAttemptId: input.attemptId,
    inFlightStartedAt: input.now,
  };
  if (!writeAll({ ...next, [input.provider]: claimed })) {
    return { status: "storage_blocked" };
  }
  return {
    status: "claimed",
    attemptId: input.attemptId,
    overdueMs,
    coalescedIntervals,
  };
}

export function settleMetaSyncScheduleAttempt(input: {
  provider: ScheduledMetaProvider;
  attemptId: string;
  finishedAt: number;
  outcome: MetaSyncScheduleOutcome;
  stage?: string;
}): boolean {
  const state = readAll();
  if (storageBlocked()) return false;
  const record = state[input.provider];
  if (!record || record.inFlightAttemptId !== input.attemptId) return false;
  return writeAll({
    ...state,
    [input.provider]: {
      ...record,
      lastAttemptFinishedAt: input.finishedAt,
      lastOutcome: input.outcome,
      lastStage: input.stage?.slice(0, 120),
      inFlightAttemptId: undefined,
      inFlightStartedAt: undefined,
    },
  });
}

export function resetMetaSyncScheduleStateForTests(): void {
  current = {};
  hydrated = false;
  storageStatus = "missing";
}
